import { Types, type FilterQuery } from 'mongoose';
import { SlotModel } from '../models/slot.model';
import type { CandidateDoc } from '../models/candidate.model';
import { CandidateModel } from '../models/candidate.model';
import { CandidateTextModel } from '../models/candidateText.model';
import type { CandidateFlag, CandidateStage, FileType } from '../types/enums';
import type { HiddenFinding } from '../services/ingestion/shieldAdapter';
import type { CandidateProfile } from '../services/ingestion/profileExtract';

export interface NewCandidateInput {
  jobId: string;
  fileName: string;
  fileType: FileType;
  textHash: string;
  uploadedBy?: string;
  originalText: string;
  redactedText: string;
  flags: CandidateFlag[];
  hiddenFindings: HiddenFinding[];
  profile?: CandidateProfile;
}

export type CreateResult =
  | { created: true; candidateId: string }
  | { created: false; duplicateOf: string };

async function nextUploadOrder(jobId: string): Promise<number> {
  const last = await CandidateModel.findOne({ jobId: new Types.ObjectId(jobId) })
    .sort({ uploadOrder: -1 })
    .select({ uploadOrder: 1 })
    .lean<{ uploadOrder: number } | null>();
  return (last?.uploadOrder ?? 0) + 1;
}

/** Duplicate lookup is scoped to the uploading account: the same resume from another account is NOT a duplicate. */
async function findByHash(jobId: string, textHash: string, uploadedBy?: string): Promise<string | null> {
  const found = await CandidateModel.findOne({
    jobId: new Types.ObjectId(jobId),
    textHash,
    deletedAt: { $exists: false },
    uploadedBy: uploadedBy && Types.ObjectId.isValid(uploadedBy) ? new Types.ObjectId(uploadedBy) : null,
  })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId } | null>();
  return found ? String(found._id) : null;
}

/**
 * Creates the candidate (REDACTED text only) and its original text in a separate collection.
 * The unique (jobId, textHash) index is the final duplicate guard under parallel uploads.
 */
async function create(input: NewCandidateInput): Promise<CreateResult> {
  const existing = await findByHash(input.jobId, input.textHash, input.uploadedBy);
  if (existing) return { created: false, duplicateOf: existing };

  const jobId = new Types.ObjectId(input.jobId);
  // A resume HR deleted earlier must not block uploading it again: purge the soft-deleted copy so the unique hash index is free.
  const gone = await CandidateModel.find({
    jobId,
    textHash: input.textHash,
    uploadedBy: input.uploadedBy && Types.ObjectId.isValid(input.uploadedBy) ? new Types.ObjectId(input.uploadedBy) : null,
    deletedAt: { $exists: true },
  }).select({ _id: 1 }).lean<Array<{ _id: Types.ObjectId }>>();
  if (gone.length > 0) {
    await CandidateTextModel.deleteMany({ candidateId: { $in: gone.map((g) => g._id) } });
    await CandidateModel.deleteMany({ _id: { $in: gone.map((g) => g._id) } });
  }
  const candidateId = new Types.ObjectId();
  const textId = new Types.ObjectId();
  try {
    const uploadOrder = await nextUploadOrder(input.jobId);
    await CandidateModel.create({
      _id: candidateId,
      jobId,
      fileName: input.fileName.slice(0, 255),
      fileType: input.fileType,
      textHash: input.textHash,
      ...(input.uploadedBy && Types.ObjectId.isValid(input.uploadedBy) ? { uploadedBy: new Types.ObjectId(input.uploadedBy) } : {}),
      originalTextRef: textId,
      redactedText: input.redactedText,
      flags: input.flags,
      hiddenFindings: input.hiddenFindings,
      ...(input.profile ? { profile: { name: input.profile.name, email: input.profile.email, phone: input.profile.phone, location: input.profile.location, links: input.profile.links, skills: input.profile.skills, keyPoints: input.profile.keyPoints }, ...(input.profile.yearsExperience !== undefined ? { yearsExperience: input.profile.yearsExperience } : {}) } : {}),
      stage: 'applied',
      uploadOrder,
    });
  } catch (err) {
    const dup = (err as { code?: number }).code === 11000;
    if (dup) {
      const again = await findByHash(input.jobId, input.textHash, input.uploadedBy);
      if (again) return { created: false, duplicateOf: again };
    }
    throw err;
  }
  await CandidateTextModel.create({ _id: textId, candidateId, jobId, text: input.originalText });
  return { created: true, candidateId: String(candidateId) };
}


/* ---- Prompt 15: candidate reads and writes for the API ---- */

export type CandidateLean = CandidateDoc;

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface CandidateListFilter {
  stage?: CandidateStage;
  q?: string;
  /** true = History view: show everything. Default dashboard hides expired saved/rejected candidates. */
  history?: boolean;
}

async function listForJob(
  jobId: string,
  filter: CandidateListFilter,
  sort: Record<string, 1 | -1>,
  skip: number,
  limit: number,
): Promise<{ items: CandidateLean[]; total: number }> {
  const query: FilterQuery<CandidateDoc> = { jobId: new Types.ObjectId(jobId), deletedAt: { $exists: false } };
  if (filter.stage) query.stage = filter.stage;
  if (!filter.history) {
    const now = Date.now();
    // Dashboard stays clear: rejected leave after 1 hour, saved (waiting list) after 7 days. History still shows them.
    query.$and = [
      { $or: [{ stage: { $ne: 'rejected' } }, { decidedAt: { $gte: new Date(now - 3_600_000) } }] },
      { $or: [{ stage: { $ne: 'on_hold' } }, { decidedAt: { $gte: new Date(now - 7 * 86_400_000) } }] },
    ];
  }
  // q is matched as an ESCAPED literal on the file name, never as a user-supplied regex or operator.
  if (filter.q) {
    const rx = { $regex: escapeRegex(filter.q), $options: 'i' };
    query.$or = [{ fileName: rx }, { 'profile.name': rx }, { 'profile.email': rx }];
  }
  const [items, total] = await Promise.all([
    CandidateModel.find(query).select({ redactedText: 0 }).sort(sort).skip(skip).limit(limit).lean<CandidateLean[]>().exec(),
    CandidateModel.countDocuments(query).exec(),
  ]);
  return { items, total };
}

async function findLive(candidateId: string): Promise<CandidateLean | null> {
  if (!Types.ObjectId.isValid(candidateId)) return null;
  return CandidateModel.findOne({ _id: new Types.ObjectId(candidateId), deletedAt: { $exists: false } }).lean<CandidateLean | null>().exec();
}

async function setNotes(candidateId: string, notes: string): Promise<CandidateLean | null> {
  return CandidateModel.findOneAndUpdate(
    { _id: new Types.ObjectId(candidateId), deletedAt: { $exists: false } },
    { $set: { notes } },
    { new: true },
  ).lean<CandidateLean | null>().exec();
}

/** Soft delete. Returns false if already deleted. The (jobId, textHash) unique index still applies, so the same file is reported as a duplicate afterwards. */
async function softDelete(candidateId: string): Promise<boolean> {
  const res = await CandidateModel.updateOne(
    { _id: new Types.ObjectId(candidateId), deletedAt: { $exists: false } },
    { $set: { deletedAt: new Date() } },
  ).exec();
  return res.modifiedCount === 1;
}

async function hasBookedSlot(candidateId: string): Promise<boolean> {
  return (await SlotModel.exists({ candidateId: new Types.ObjectId(candidateId), status: 'booked' })) !== null;
}


export const candidateRepository = { create, findByHash, listForJob, findLive, setNotes, softDelete, hasBookedSlot };
