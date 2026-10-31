import { Types, type FilterQuery } from 'mongoose';
import type { CreateJobInput } from '../types/job.schema';
import { JobModel, type JobDoc } from '../models/job.model';
import type { JobStatus } from '../types/enums';

export type JobLean = JobDoc;

async function findById(jobId: string): Promise<JobLean | null> {
  if (!Types.ObjectId.isValid(jobId)) return null;
  return JobModel.findById(jobId).lean<JobLean | null>().exec();
}

async function setStatus(jobId: string, status: JobStatus): Promise<void> {
  await JobModel.updateOne({ _id: new Types.ObjectId(jobId) }, { $set: { status } }).exec();
}

/** Atomically approves the job. Returns false if it was already approved (idempotent guard). */
async function markApproved(jobId: string, userId: string): Promise<boolean> {
  const res = await JobModel.updateOne(
    { _id: new Types.ObjectId(jobId), status: { $in: ['draft', 'open', 'scored'] } },
    { $set: { status: 'approved', approvedAt: new Date(), approvedBy: new Types.ObjectId(userId) } },
  ).exec();
  return res.modifiedCount === 1;
}


/* ---- Prompt 15: jobs CRUD ---- */

export interface JobListFilter {
  status?: JobStatus;
}

async function list(filter: JobListFilter, skip: number, limit: number): Promise<{ items: JobLean[]; total: number }> {
  const q: FilterQuery<JobDoc> = {};
  if (filter.status) q.status = filter.status;
  const [items, total] = await Promise.all([
    JobModel.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean<JobLean[]>().exec(),
    JobModel.countDocuments(q).exec(),
  ]);
  return { items, total };
}

async function create(input: CreateJobInput, ownerId: string, criteriaHash: string): Promise<JobLean> {
  const doc = await JobModel.create({ ...input, status: 'open', ownerId: new Types.ObjectId(ownerId), criteriaHash });
  return doc.toObject() as JobLean;
}

async function update(jobId: string, patch: Record<string, unknown>): Promise<JobLean | null> {
  return JobModel.findByIdAndUpdate(new Types.ObjectId(jobId), { $set: patch }, { new: true, runValidators: true }).lean<JobLean | null>().exec();
}


export const jobRepository = { findById, setStatus, markApproved, list, create, update };
