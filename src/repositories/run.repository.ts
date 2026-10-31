import { Types } from 'mongoose';
import { RunModel, type RunDoc, type RunState, type RunType } from '../models/run.model';

export type RunLean = RunDoc;

export interface RunFailure {
  candidateId?: string;
  fileName?: string;
  reason: string;
}

/** Creates a run in state "queued" and returns its id. */
async function create(jobId: string, type: RunType, total: number): Promise<string> {
  const doc = await RunModel.create({ jobId: new Types.ObjectId(jobId), type, state: 'queued', done: 0, total, failures: [] });
  return String(doc._id);
}

async function findById(runId: string): Promise<RunLean | null> {
  if (!Types.ObjectId.isValid(runId)) return null;
  return RunModel.findById(runId).lean<RunLean | null>().exec();
}

/** Latest run of a type for a job (used by GET /jobs/:id/score/status). */
async function latestForJob(jobId: string, type: RunType): Promise<RunLean | null> {
  return RunModel.findOne({ jobId: new Types.ObjectId(jobId), type })
    .sort({ createdAt: -1 })
    .lean<RunLean | null>()
    .exec();
}

/** True when a queued or running run of this type already exists for the job. */
async function hasActive(jobId: string, type: RunType): Promise<boolean> {
  const found = await RunModel.exists({ jobId: new Types.ObjectId(jobId), type, state: { $in: ['queued', 'running'] } });
  return found !== null;
}

async function markRunning(runId: string): Promise<void> {
  await RunModel.updateOne({ _id: new Types.ObjectId(runId) }, { $set: { state: 'running', startedAt: new Date() } }).exec();
}

async function incrementDone(runId: string): Promise<void> {
  await RunModel.updateOne({ _id: new Types.ObjectId(runId) }, { $inc: { done: 1 } }).exec();
}

async function addFailure(runId: string, failure: RunFailure): Promise<void> {
  await RunModel.updateOne(
    { _id: new Types.ObjectId(runId) },
    { $push: { failures: { ...failure, reason: failure.reason.slice(0, 300) } } },
  ).exec();
}

async function finish(runId: string, state: Extract<RunState, 'done' | 'failed'>): Promise<void> {
  await RunModel.updateOne({ _id: new Types.ObjectId(runId) }, { $set: { state, finishedAt: new Date() } }).exec();
}

export const runRepository = { create, findById, latestForJob, hasActive, markRunning, incrementDone, addFailure, finish };
