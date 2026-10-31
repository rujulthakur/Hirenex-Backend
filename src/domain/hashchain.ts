import { createHash } from 'node:crypto';

/** PURE. Audit hash chain: hash = SHA-256(prevHash + canonicalJSON(entry without hash)). */
export const GENESIS_HASH = '0'.repeat(64);

export interface HashableEntry {
  seq: number;
  ts: string;
  actor: { id: string; role: string; name: string };
  action: string;
  entityType: string;
  entityId: string;
  jobId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  payload?: unknown;
  prevHash: string;
}

/** Shape of a stored row as it comes back from the database (dates and ObjectIds not yet stringified). */
export interface StoredAuditLike {
  seq: number;
  ts: Date | string;
  actor: { id: string; role: string; name: string };
  action: string;
  entityType: string;
  entityId: string;
  jobId?: { toString(): string } | string | null;
  oldValue?: unknown;
  newValue?: unknown;
  payload?: unknown;
  prevHash: string;
  hash: string;
}

/** Deterministic JSON: sorted object keys, undefined dropped from objects, Dates as ISO strings. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown> & { toJSON?: () => unknown };
    if (typeof obj.toJSON === 'function') return canonicalJson(obj.toJSON());
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  return 'null';
}

export function computeHash(entry: HashableEntry): string {
  return createHash('sha256')
    .update(entry.prevHash + canonicalJson(entry), 'utf8')
    .digest('hex');
}

/** Converts a stored row into the exact structure that was hashed at write time. */
export function toHashable(row: StoredAuditLike): HashableEntry {
  const entry: HashableEntry = {
    seq: row.seq,
    ts: row.ts instanceof Date ? row.ts.toISOString() : row.ts,
    actor: { id: row.actor.id, role: row.actor.role, name: row.actor.name },
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    prevHash: row.prevHash,
  };
  if (row.jobId !== undefined && row.jobId !== null) entry.jobId = row.jobId.toString();
  if (row.oldValue !== undefined) entry.oldValue = row.oldValue;
  if (row.newValue !== undefined) entry.newValue = row.newValue;
  if (row.payload !== undefined) entry.payload = row.payload;
  return entry;
}

export interface ChainVerdict {
  valid: boolean;
  brokenAtSeq?: number;
}

/** Entries must be in ascending seq order. Reports the FIRST seq where the chain stops being consistent. */
export function verifyChain(entries: readonly StoredAuditLike[]): ChainVerdict {
  let expectedPrev = GENESIS_HASH;
  let expectedSeq: number | null = null;
  for (const row of entries) {
    if (expectedSeq !== null && row.seq !== expectedSeq) return { valid: false, brokenAtSeq: row.seq };
    if (row.prevHash !== expectedPrev) return { valid: false, brokenAtSeq: row.seq };
    if (computeHash(toHashable(row)) !== row.hash) return { valid: false, brokenAtSeq: row.seq };
    expectedPrev = row.hash;
    expectedSeq = row.seq + 1;
  }
  return { valid: true };
}
