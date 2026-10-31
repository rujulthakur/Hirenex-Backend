import { Types } from 'mongoose';
import { SlotModel } from '../models/slot.model';
import type { SlotStatus } from '../types/enums';
import type { GeneratedSlot } from '../domain/slots';

export interface SlotLean {
  _id: Types.ObjectId;
  jobId: Types.ObjectId;
  interviewerId: Types.ObjectId;
  start: Date;
  end: Date;
  timeZone: string;
  status: SlotStatus;
  candidateId?: Types.ObjectId;
}

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

/**
 * Idempotent: the unique (interviewerId, start) index rejects slots that already exist, and we ignore those
 * duplicate-key errors. Running schedule twice never doubles the grid.
 */
async function insertMissing(jobId: string, slots: ReadonlyArray<GeneratedSlot>): Promise<number> {
  if (slots.length === 0) return 0;
  const docs = slots.map((s) => ({
    jobId: oid(jobId),
    interviewerId: oid(s.interviewerId),
    start: s.start,
    end: s.end,
    timeZone: s.timeZone,
    status: 'open' as const,
  }));
  try {
    const res = await SlotModel.insertMany(docs, { ordered: false });
    return res.length;
  } catch (err) {
    const e = err as { code?: number; insertedDocs?: unknown[]; writeErrors?: Array<{ err?: { code?: number } }> };
    const allDup = e.code === 11000 || (e.writeErrors ?? []).every((w) => w.err?.code === 11000);
    if (!allDup) throw err;
    return e.insertedDocs?.length ?? 0;
  }
}

async function countForJob(jobId: string): Promise<number> {
  return SlotModel.countDocuments({ jobId: oid(jobId) }).exec();
}

async function countOpen(jobId: string): Promise<number> {
  return SlotModel.countDocuments({ jobId: oid(jobId), status: 'open' }).exec();
}

async function listOpen(jobId: string): Promise<SlotLean[]> {
  return SlotModel.find({ jobId: oid(jobId), status: 'open' }).sort({ start: 1 }).lean<SlotLean[]>().exec();
}

async function listForJob(jobId: string, interviewerId?: string): Promise<SlotLean[]> {
  const filter: Record<string, unknown> = { jobId: oid(jobId) };
  if (interviewerId) filter['interviewerId'] = oid(interviewerId);
  return SlotModel.find(filter).sort({ interviewerId: 1, start: 1 }).lean<SlotLean[]>().exec();
}

/** Booked slots per interviewer, for the least-loaded tie rule. */
async function bookedLoad(jobId: string): Promise<Map<string, number>> {
  const rows = await SlotModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { jobId: oid(jobId), status: 'booked' } },
    { $group: { _id: '$interviewerId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

async function bookedCandidateIds(jobId: string): Promise<Set<string>> {
  const rows = await SlotModel.find({ jobId: oid(jobId), status: 'booked', candidateId: { $exists: true } })
    .select({ candidateId: 1 })
    .lean<Array<{ candidateId: Types.ObjectId }>>()
    .exec();
  return new Set(rows.map((r) => String(r.candidateId)));
}

/**
 * ATOMIC BOOKING. One conditional update: it only succeeds while the slot is still open. A null result means
 * somebody else won (the caller maps that to SLOT_TAKEN and retries the next best slot). The unique
 * (interviewerId, start) index is the second guard against double-booking.
 */
async function book(slotId: string, candidateId: string): Promise<SlotLean | null> {
  if (!Types.ObjectId.isValid(slotId)) return null;
  return SlotModel.findOneAndUpdate(
    { _id: oid(slotId), status: 'open' },
    { $set: { status: 'booked', candidateId: oid(candidateId) } },
    { new: true },
  )
    .lean<SlotLean | null>()
    .exec();
}

/** Frees a booked slot, only if it is still booked by that candidate (repair engine, Prompt 11). */
async function free(slotId: string, candidateId: string): Promise<boolean> {
  const res = await SlotModel.updateOne(
    { _id: oid(slotId), status: 'booked', candidateId: oid(candidateId) },
    { $set: { status: 'open' }, $unset: { candidateId: '' } },
  ).exec();
  return res.modifiedCount === 1;
}

async function findByIds(ids: ReadonlyArray<string>): Promise<SlotLean[]> {
  const valid = ids.filter((i) => Types.ObjectId.isValid(i));
  if (valid.length === 0) return [];
  return SlotModel.find({ _id: { $in: valid.map(oid) } }).lean<SlotLean[]>().exec();
}

async function listBooked(jobId: string): Promise<SlotLean[]> {
  return SlotModel.find({ jobId: oid(jobId), status: 'booked', candidateId: { $exists: true } }).sort({ start: 1 }).lean<SlotLean[]>().exec();
}

export const slotRepository = { findByIds, listBooked, insertMissing, countForJob, countOpen, listOpen, listForJob, bookedLoad, bookedCandidateIds, book, free };
