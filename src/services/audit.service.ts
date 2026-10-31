import type { Role } from '../types/enums';
import { AuditLogModel } from '../models/auditLog.model';
import { CounterModel } from '../models/counter.model';
import { GENESIS_HASH, computeHash, type HashableEntry } from '../domain/hashchain';
import { Mutex } from '../utils/mutex';
import type { StoredAuditLike } from '../domain/hashchain';
import { verifyChain, type ChainVerdict } from '../domain/hashchain';
import type { FilterQuery } from 'mongoose';
import type { AuditLogDoc } from '../models/auditLog.model';
import { Types } from 'mongoose';

export const AUDIT_COUNTER_ID = 'auditLogs';

export interface AuditActor {
  id: string;
  role: Role | 'system' | 'candidate';
  name: string;
}

export interface AuditAppendInput {
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId: string;
  jobId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  payload?: unknown;
}

export interface AuditReceipt {
  seq: number;
  hash: string;
}

export const SYSTEM_ACTOR: AuditActor = { id: 'system', role: 'system', name: 'System' };

/**
 * Why a mutex is enough: with ONE server instance, appends are serialised in-process, so each entry reads the
 * true latest hash. The unique index on seq is the second guard: a second instance racing us would hit a
 * duplicate-key error instead of silently forking the chain. 
 */
const mutex = new Mutex();

async function append(input: AuditAppendInput): Promise<AuditReceipt> {
  return mutex.run(async () => {
    const last = await AuditLogModel.findOne()
      .sort({ seq: -1 })
      .select({ seq: 1, hash: 1 })
      .lean<{ seq: number; hash: string } | null>();
    const prevHash = last?.hash ?? GENESIS_HASH;

    const counter = await CounterModel.findOneAndUpdate(
      { _id: AUDIT_COUNTER_ID },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    ).lean<{ seq: number } | null>();
    const seq = counter?.seq ?? (last?.seq ?? 0) + 1;

    const ts = new Date();
    const entry: HashableEntry = {
      seq,
      ts: ts.toISOString(),
      actor: { id: input.actor.id, role: input.actor.role, name: input.actor.name },
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      prevHash,
    };
    if (input.jobId !== undefined) entry.jobId = input.jobId;
    if (input.oldValue !== undefined) entry.oldValue = input.oldValue;
    if (input.newValue !== undefined) entry.newValue = input.newValue;
    if (input.payload !== undefined) entry.payload = input.payload;
    const hash = computeHash(entry);

    try {
      await AuditLogModel.create({ ...entry, ts, hash });
    } catch (err) {
      // Give the number back (safe inside the mutex) so a failed write does not leave a gap in the chain.
      await CounterModel.updateOne({ _id: AUDIT_COUNTER_ID }, { $inc: { seq: -1 } });
      throw err;
    }
    return { seq, hash };
  });
}

export interface AuditListFilter {
  jobId: string;
  actor?: string | undefined;
  action?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page: number;
  limit: number;
}

export interface AuditListResult {
  items: AuditLogDoc[];
  total: number;
}

/** Newest first. `actor` matches actor id or name (exact). Date range applies to ts. */
async function list(f: AuditListFilter): Promise<AuditListResult> {
  const q: FilterQuery<AuditLogDoc> = { jobId: new Types.ObjectId(f.jobId) };
  if (f.actor) q.$or = [{ 'actor.id': f.actor }, { 'actor.name': f.actor }];
  if (f.action) q.action = f.action;
  if (f.from || f.to) {
    q.ts = {
      ...(f.from ? { $gte: new Date(f.from) } : {}),
      ...(f.to ? { $lte: new Date(f.to) } : {}),
    };
  }
  const [items, total] = await Promise.all([
    AuditLogModel.find(q)
      .sort({ seq: -1 })
      .skip((f.page - 1) * f.limit)
      .limit(f.limit)
      .lean<AuditLogDoc[]>(),
    AuditLogModel.countDocuments(q),
  ]);
  return { items, total };
}

const VERIFY_BATCH = 1000;

/** Streams the whole chain in ascending seq order, in batches, so memory stays flat. */
async function* iterateAll(): AsyncGenerator<AuditLogDoc> {
  let afterSeq = 0;
  for (;;) {
    const batch = await AuditLogModel.find({ seq: { $gt: afterSeq } })
      .sort({ seq: 1 })
      .limit(VERIFY_BATCH)
      .lean<AuditLogDoc[]>();
    if (batch.length === 0) return;
    for (const row of batch) yield row;
    afterSeq = batch[batch.length - 1]!.seq;
  }
}

/** Recomputes the whole chain. Pure verification is delegated to domain/hashchain.verifyChain. */
async function verify(): Promise<ChainVerdict & { entries: number }> {
  const rows: StoredAuditLike[] = [];
  for await (const row of iterateAll()) rows.push(row as unknown as StoredAuditLike);
  return { ...verifyChain(rows), entries: rows.length };
}

/** Records the verification itself in the chain (after verifying, so it never changes its own verdict). */
async function verifyAndRecord(actor: AuditActor): Promise<ChainVerdict & { entries: number }> {
  const verdict = await verify();
  await append({
    actor,
    action: 'audit.verify',
    entityType: 'audit',
    entityId: 'chain',
    payload: { valid: verdict.valid, brokenAtSeq: verdict.brokenAtSeq ?? null, entries: verdict.entries },
  });
  return verdict;
}

export const CSV_HEADER = ['seq', 'ts', 'actorId', 'actorRole', 'actorName', 'action', 'entityType', 'entityId', 'jobId', 'payload', 'prevHash', 'hash'];

/** CSV cell with quotes escaped, and formula-injection neutralised (=, +, -, @ prefixes). */
export function csvCell(value: unknown): string {
  let text = value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function auditRowToCsv(row: AuditLogDoc): string {
  const ts = row.ts instanceof Date ? row.ts.toISOString() : String(row.ts);
  return [
    row.seq, ts, row.actor.id, row.actor.role, row.actor.name, row.action, row.entityType, row.entityId,
    row.jobId ? row.jobId.toString() : '', row.payload ?? '', row.prevHash, row.hash,
  ].map(csvCell).join(',');
}

export const auditService = { append, list, verify, verifyAndRecord, iterateAll };
export type AuditService = typeof auditService;
