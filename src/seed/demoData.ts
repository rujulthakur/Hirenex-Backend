import { Types } from 'mongoose';
import { AiTraceModel } from '../models/aiTrace.model';
import { CandidateModel } from '../models/candidate.model';
import { CandidateTextModel } from '../models/candidateText.model';
import { InterviewerModel } from '../models/interviewer.model';
import { InviteModel } from '../models/invite.model';
import { JobModel } from '../models/job.model';
import { NotificationModel } from '../models/notification.model';
import { RepairModel } from '../models/repair.model';
import { RunModel } from '../models/run.model';
import { ScoreModel } from '../models/score.model';
import { SlotModel } from '../models/slot.model';
import { SyntheticLabelModel } from '../models/auditOnly/syntheticLabel.model';
import { computeCriteriaHash } from '../domain/cacheKey';
import {
  DEMO_BREAKS, DEMO_CAPACITY, DEMO_CRITERIA, DEMO_DAILY_END, DEMO_DAILY_START, DEMO_INTERVIEWERS, DEMO_INTERVIEW_MINUTES,
  DEMO_JOB_DESCRIPTION, DEMO_JOB_TITLE, DEMO_MEETING_LINK, DEMO_PREFERRED_SKILLS, DEMO_REQUIRED_SKILLS, DEMO_TIME_ZONE, DEMO_WAITLIST, demoDates,
} from './demoJob';
import { buildDemoSpecs } from './resumeSpecs';

/**
 * Seed-side database access. This folder is the ONLY place (besides the bias panel service) allowed to import
 * syntheticLabels, so label assignment and label wiping live here. Labels are audit-only and never reach scoring.
 */
export interface DemoJobRef {
  jobId: string;
  candidateCount: number;
}

export async function findDemoJobs(): Promise<Array<{ _id: Types.ObjectId; createdAt: Date }>> {
  return JobModel.find({ title: DEMO_JOB_TITLE }).sort({ createdAt: -1 }).select({ _id: 1, createdAt: 1 }).lean<Array<{ _id: Types.ObjectId; createdAt: Date }>>().exec();
}

export async function latestDemoJob(): Promise<DemoJobRef | null> {
  const [job] = await findDemoJobs();
  if (!job) return null;
  const candidateCount = await CandidateModel.countDocuments({ jobId: job._id });
  return { jobId: String(job._id), candidateCount };
}

/** Creates the demo job (criteria sum to 100, capacity 8, waitlist 4) and its 3 interviewers in 3 zones. */
export async function createDemoJob(ownerId: string, now: Date = new Date()): Promise<string> {
  const dates = demoDates(now);
  const criteria = DEMO_CRITERIA.map((c) => ({ ...c }));
  const job = await JobModel.create({
    title: DEMO_JOB_TITLE,
    description: DEMO_JOB_DESCRIPTION,
    requiredSkills: [...DEMO_REQUIRED_SKILLS],
    preferredSkills: [...DEMO_PREFERRED_SKILLS],
    criteria,
    capacity: DEMO_CAPACITY,
    waitlistSize: DEMO_WAITLIST,
    interviewMinutes: DEMO_INTERVIEW_MINUTES,
    constraints: {
      dates,
      dailyStart: DEMO_DAILY_START,
      dailyEnd: DEMO_DAILY_END,
      breaks: DEMO_BREAKS.map((b) => ({ ...b })),
      timeZone: DEMO_TIME_ZONE,
      format: 'virtual',
      meetingLink: DEMO_MEETING_LINK,
    },
    status: 'open',
    ownerId: new Types.ObjectId(ownerId),
    criteriaHash: computeCriteriaHash(criteria),
  });
  await InterviewerModel.insertMany(
    DEMO_INTERVIEWERS.map((i) => ({
      jobId: job._id,
      name: i.name,
      timeZone: i.timeZone,
      availability: i.windows.map((w) => ({ date: dates[w.day], start: w.start, end: w.end })),
    })),
  );
  return String(job._id);
}

/** Assigns the synthetic group per candidate (matched by file name). Idempotent (upsert by candidateId). */
export async function assignSyntheticLabels(jobId: string): Promise<number> {
  const groupByFile = new Map(buildDemoSpecs().map((s) => [s.fileName, s.group]));
  const candidates = await CandidateModel.find({ jobId: new Types.ObjectId(jobId) }).select({ _id: 1, fileName: 1 }).lean<Array<{ _id: Types.ObjectId; fileName: string }>>().exec();
  let n = 0;
  for (const c of candidates) {
    const group = groupByFile.get(c.fileName);
    if (!group) continue;
    await SyntheticLabelModel.updateOne({ candidateId: c._id }, { $set: { jobId: new Types.ObjectId(jobId), group } }, { upsert: true });
    n += 1;
  }
  return n;
}

export interface WipeCounts {
  jobs: number;
  candidates: number;
  scores: number;
  slots: number;
  invites: number;
  traces: number;
}

/** Deletes demo JOB data only. Never touches users, refresh tokens, counters or the audit log. */
export async function wipeDemoJobs(): Promise<WipeCounts> {
  const jobs = await findDemoJobs();
  const ids = jobs.map((j) => j._id);
  if (ids.length === 0) return { jobs: 0, candidates: 0, scores: 0, slots: 0, invites: 0, traces: 0 };
  const by = { jobId: { $in: ids } };
  const [candidates, scores, slots, invites, traces] = await Promise.all([
    CandidateModel.deleteMany(by),
    ScoreModel.deleteMany(by),
    SlotModel.deleteMany(by),
    InviteModel.deleteMany(by),
    AiTraceModel.deleteMany(by),
  ]);
  await Promise.all([
    CandidateTextModel.deleteMany(by),
    InterviewerModel.deleteMany(by),
    RunModel.deleteMany(by),
    RepairModel.deleteMany(by),
    SyntheticLabelModel.deleteMany(by),
    NotificationModel.deleteMany({ jobId: { $in: ids } }),
  ]);
  const jobsRes = await JobModel.deleteMany({ _id: { $in: ids } });
  return {
    jobs: jobsRes.deletedCount,
    candidates: candidates.deletedCount,
    scores: scores.deletedCount,
    slots: slots.deletedCount,
    invites: invites.deletedCount,
    traces: traces.deletedCount,
  };
}

export interface SandboxInvite {
  inviteId: string;
  candidateId: string;
  expiresAt: Date;
}

/** Picks the first live (not superseded) invite of the job, preferring sent ones. */
export async function pickSandboxInvite(jobId: string): Promise<SandboxInvite | null> {
  const invites = await InviteModel.find({ jobId: new Types.ObjectId(jobId), supersededBy: { $exists: false }, response: 'pending' })
    .sort({ createdAt: 1 })
    .select({ _id: 1, candidateId: 1, expiresAt: 1, emailStatus: 1 })
    .lean<Array<{ _id: Types.ObjectId; candidateId: Types.ObjectId; expiresAt: Date; emailStatus: string }>>()
    .exec();
  const sent = invites.find((i) => i.emailStatus === 'sent' || i.emailStatus === 'viewed') ?? invites[0];
  if (!sent) return null;
  return { inviteId: String(sent._id), candidateId: String(sent.candidateId), expiresAt: sent.expiresAt };
}

/** Sandbox only: overwrite the stored token hash so we can show a working link. The previous email link stops working. */
export async function replaceInviteTokenHash(inviteId: string, tokenHash: string, expiresAt: Date): Promise<void> {
  await InviteModel.updateOne({ _id: new Types.ObjectId(inviteId) }, { $set: { tokenHash, expiresAt } });
}
