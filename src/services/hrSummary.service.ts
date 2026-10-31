import { Types } from 'mongoose';
import { CandidateModel } from '../models/candidate.model';
import { JobModel } from '../models/job.model';

export const SUMMARY_RANGES = ['7d', '30d', '90d', '180d', '365d', 'all'] as const;
export type SummaryRange = (typeof SUMMARY_RANGES)[number];

const DAYS: Record<Exclude<SummaryRange, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90, '180d': 180, '365d': 365 };
const MAX_ROWS = 5000;

export interface SummaryRow {
  name: string;
  email: string;
  phone: string;
  job: string;
  score: number | null;
  result: 'passed' | 'failed' | 'not_scored';
  invited: boolean;
  uploadedAt: string;
}

export interface HrSummary {
  range: SummaryRange;
  from: string | null;
  passMark: number;
  applied: number;
  interviewed: number;
  passed: number;
  failed: number;
  notScored: number;
  rows: SummaryRow[];
}

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** PURE. First day included for a range, or null for "all time". */
export function rangeStart(range: SummaryRange, now: Date = new Date()): Date | null {
  if (range === 'all') return null;
  return new Date(now.getTime() - DAYS[range] * 24 * 60 * 60 * 1000);
}

/** PURE. Scores are stored 0 to 10; HR sees and sets the pass mark out of 100. */
export function classify(totalScore: number | null | undefined, passMark: number): 'passed' | 'failed' | 'not_scored' {
  if (totalScore === null || totalScore === undefined) return 'not_scored';
  return totalScore * 10 >= passMark ? 'passed' : 'failed';
}

/** GET /analytics/summary. Simple company-wide numbers for the HR user: applied, interviewed, passed, failed. */
async function forOwner(ownerId: string, range: SummaryRange, passMark: number): Promise<HrSummary> {
  const jobs = await JobModel.find({ ownerId: new Types.ObjectId(ownerId) }).select({ title: 1 }).lean<Raw[]>();
  const titleById = new Map(jobs.map((j) => [String(j._id), String(j.title ?? '')]));
  const from = rangeStart(range);
  const match: Raw = { jobId: { $in: jobs.map((j) => j._id) }, deletedAt: { $exists: false } };
  if (from) match['createdAt'] = { $gte: from };

  const cands = await CandidateModel.find(match).sort({ createdAt: -1 }).limit(MAX_ROWS)
    .select({ jobId: 1, profile: 1, fileName: 1, totalScore: 1, stage: 1, createdAt: 1 }).lean<Raw[]>();

  const out: HrSummary = { range, from: from ? from.toISOString() : null, passMark, applied: cands.length, interviewed: 0, passed: 0, failed: 0, notScored: 0, rows: [] };
  for (const c of cands) {
    const result = classify(c.totalScore, passMark);
    const invited = c.stage === 'invited' || c.stage === 'confirmed';
    if (invited) out.interviewed += 1;
    if (result === 'passed') out.passed += 1;
    else if (result === 'failed') out.failed += 1;
    else out.notScored += 1;
    out.rows.push({
      name: c.profile?.name || c.fileName || 'Candidate',
      email: c.profile?.email ?? '',
      phone: c.profile?.phone ?? '',
      job: titleById.get(String(c.jobId)) ?? '',
      score: c.totalScore == null ? null : Math.round(c.totalScore * 10),
      result,
      invited,
      uploadedAt: new Date(c.createdAt).toISOString(),
    });
  }
  return out;
}

export const hrSummaryService = { forOwner };
