import { Types } from 'mongoose';
import { InterviewerModel } from '../models/interviewer.model';

export interface InterviewerLean {
  _id: Types.ObjectId;
  jobId: Types.ObjectId;
  name: string;
  timeZone: string;
  availability: Array<{ date: string; start: string; end: string }>;
}

async function findByJob(jobId: string): Promise<InterviewerLean[]> {
  return InterviewerModel.find({ jobId: new Types.ObjectId(jobId) }).sort({ _id: 1 }).lean<InterviewerLean[]>().exec();
}

async function findById(interviewerId: string): Promise<InterviewerLean | null> {
  if (!Types.ObjectId.isValid(interviewerId)) return null;
  return InterviewerModel.findById(interviewerId).lean<InterviewerLean | null>().exec();
}

async function replaceForJob(
  jobId: string,
  list: ReadonlyArray<{ name: string; timeZone: string; availability: Array<{ date: string; start: string; end: string }> }>,
): Promise<InterviewerLean[]> {
  const oid = new Types.ObjectId(jobId);
  await InterviewerModel.deleteMany({ jobId: oid }).exec();
  await InterviewerModel.insertMany(list.map((i) => ({ ...i, jobId: oid })));
  return findByJob(jobId);
}

export const interviewerRepository = { findByJob, findById, replaceForJob };
