import { Types } from 'mongoose';
import { RepairModel, type RepairTrigger } from '../models/repair.model';
import { NotificationModel } from '../models/notification.model';
import { SlotModel } from '../models/slot.model';
import { UserModel } from '../models/user.model';
import type { Placement, RepairSlot } from '../domain/repair';

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

export interface RepairSave {
  jobId: string;
  trigger: RepairTrigger;
  before: Placement[];
  after: Placement[];
  moved: Array<{ candidateId: string; fromSlotId: string; toSlotId: string }>;
  unplaced: string[];
  promotedCandidateId?: string;
  note: string;
}

export interface RepairLean {
  _id: Types.ObjectId;
  jobId: Types.ObjectId;
  trigger: RepairTrigger;
  before: Array<{ slotId: Types.ObjectId; interviewerId: Types.ObjectId; candidateId?: Types.ObjectId; start: Date; end: Date }>;
  after: Array<{ slotId: Types.ObjectId; interviewerId: Types.ObjectId; candidateId?: Types.ObjectId; start: Date; end: Date }>;
  moved: Array<{ candidateId: Types.ObjectId; fromSlotId: Types.ObjectId; toSlotId: Types.ObjectId }>;
  unplaced: Types.ObjectId[];
  promotedCandidateId?: Types.ObjectId;
  note?: string;
  ts: Date;
}

const toPlacement = (p: Placement) => ({
  slotId: oid(p.slotId),
  interviewerId: oid(p.interviewerId),
  ...(p.candidateId ? { candidateId: oid(p.candidateId) } : {}),
  start: new Date(p.start),
  end: new Date(p.end),
});

async function save(r: RepairSave): Promise<RepairLean> {
  const doc = await RepairModel.create({
    jobId: oid(r.jobId),
    trigger: r.trigger,
    before: r.before.map(toPlacement),
    after: r.after.map(toPlacement),
    moved: r.moved.map((m) => ({ candidateId: oid(m.candidateId), fromSlotId: oid(m.fromSlotId), toSlotId: oid(m.toSlotId) })),
    unplaced: r.unplaced.map(oid),
    ...(r.promotedCandidateId ? { promotedCandidateId: oid(r.promotedCandidateId) } : {}),
    note: r.note.slice(0, 300),
  });
  return doc.toObject() as unknown as RepairLean;
}

async function latestForJob(jobId: string, limit = 10): Promise<RepairLean[]> {
  return RepairModel.find({ jobId: oid(jobId) }).sort({ ts: -1 }).limit(limit).lean<RepairLean[]>().exec();
}

/** Every slot of the job as plain numbers, the input of the pure repair planners. */
async function slotsForJob(jobId: string): Promise<RepairSlot[]> {
  const rows = await SlotModel.find({ jobId: oid(jobId) })
    .lean<Array<{ _id: Types.ObjectId; interviewerId: Types.ObjectId; start: Date; end: Date; status: RepairSlot['status']; candidateId?: Types.ObjectId }>>()
    .exec();
  return rows.map((s) => ({
    id: String(s._id),
    interviewerId: String(s.interviewerId),
    start: s.start.getTime(),
    end: s.end.getTime(),
    status: s.status,
    ...(s.candidateId ? { candidateId: String(s.candidateId) } : {}),
  }));
}

/** Blocks a slot only if it is still open or booked by `expectCandidateId` (conditional, so races are safe). */
async function blockSlot(slotId: string, expectCandidateId?: string): Promise<boolean> {
  const filter = expectCandidateId ? { _id: oid(slotId), status: 'booked', candidateId: oid(expectCandidateId) } : { _id: oid(slotId), status: 'open' };
  const res = await SlotModel.updateOne(filter, { $set: { status: 'blocked' }, $unset: { candidateId: '' } }).exec();
  return res.modifiedCount === 1;
}

/** Atomic hand-over of a booked slot from the declining candidate to the promoted one. */
async function handOver(slotId: string, fromCandidateId: string, toCandidateId: string): Promise<boolean> {
  const res = await SlotModel.updateOne(
    { _id: oid(slotId), status: 'booked', candidateId: oid(fromCandidateId) },
    { $set: { candidateId: oid(toCandidateId) } },
  ).exec();
  return res.modifiedCount === 1;
}

/** In-app notification for every HR user (hr_admin and demo_hr). Best-effort: never blocks a repair. */
async function notifyHr(type: string, title: string, body: string): Promise<number> {
  const hr = await UserModel.find({ role: { $in: ['hr_admin', 'demo_hr'] } }).select({ _id: 1 }).lean<Array<{ _id: Types.ObjectId }>>().exec();
  if (hr.length === 0) return 0;
  await NotificationModel.insertMany(hr.map((u) => ({ userId: u._id, type, title: title.slice(0, 160), body: body.slice(0, 600) })));
  return hr.length;
}

export const repairRepository = { save, latestForJob, slotsForJob, blockSlot, handOver, notifyHr };
