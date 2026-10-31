import { Types } from 'mongoose';
import { CandidateModel } from '../models/candidate.model';
import { CandidateTextModel } from '../models/candidateText.model';
import type { CandidateFlag, CandidateStage } from '../types/enums';

export interface ScoringCandidate {
  _id: Types.ObjectId;
  jobId: Types.ObjectId;
  fileName: string;
  textHash: string;
  redactedText: string;
  flags: CandidateFlag[];
  stage: CandidateStage;
  uploadOrder: number;
  yearsExperience?: number;
}

export interface RankableCandidate {
  _id: Types.ObjectId;
  stage: CandidateStage;
  totalScore: number;
  coverage: number;
  verifiedEvidenceCount: number;
  yearsExperience: number;
  uploadOrder: number;
  flags: CandidateFlag[];
  fileName: string;
  rank?: number;
  tieBreakTrace?: string[];
}

export interface ScoreApplication {
  parsedSkills: string[];
  yearsExperience: number;
  projects: string[];
  totalScore: number;
  coverage: number;
  verifiedEvidenceCount: number;
  flags: CandidateFlag[];
  /** When true and the candidate is still "applied", move it to "scored". */
  markScored: boolean;
}

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

/** Candidates that can be scored: not deleted, not unreadable scans. */
async function listScorable(jobId: string): Promise<ScoringCandidate[]> {
  return CandidateModel.find({ jobId: oid(jobId), deletedAt: { $exists: false }, flags: { $ne: 'unreadable_scan' } })
    .sort({ uploadOrder: 1 })
    .select({ jobId: 1, fileName: 1, textHash: 1, redactedText: 1, flags: 1, stage: 1, uploadOrder: 1, yearsExperience: 1 })
    .lean<ScoringCandidate[]>()
    .exec();
}

async function findById(candidateId: string): Promise<(ScoringCandidate & { notes?: string }) | null> {
  if (!Types.ObjectId.isValid(candidateId)) return null;
  return CandidateModel.findOne({ _id: oid(candidateId), deletedAt: { $exists: false } })
    .lean<(ScoringCandidate & { notes?: string }) | null>()
    .exec();
}

/** Candidates that already have a total (ranking input). */
async function listRankable(jobId: string): Promise<RankableCandidate[]> {
  const rows = await CandidateModel.find({
    jobId: oid(jobId),
    deletedAt: { $exists: false },
    totalScore: { $exists: true },
    stage: { $in: ['scored', 'shortlisted', 'waitlisted'] },
  })
    .select({ stage: 1, totalScore: 1, coverage: 1, verifiedEvidenceCount: 1, yearsExperience: 1, uploadOrder: 1, flags: 1, fileName: 1, rank: 1, tieBreakTrace: 1 })
    .lean<Array<Partial<RankableCandidate> & { _id: Types.ObjectId }>>()
    .exec();
  return rows.map((r) => ({
    _id: r._id,
    stage: r.stage as CandidateStage,
    totalScore: r.totalScore ?? 0,
    coverage: r.coverage ?? 0,
    verifiedEvidenceCount: r.verifiedEvidenceCount ?? 0,
    yearsExperience: r.yearsExperience ?? 0,
    uploadOrder: r.uploadOrder ?? 0,
    flags: r.flags ?? [],
    fileName: r.fileName ?? '',
    ...(r.rank !== undefined ? { rank: r.rank } : {}),
    ...(r.tieBreakTrace ? { tieBreakTrace: r.tieBreakTrace } : {}),
  }));
}

/** Stage lookup for every live candidate of a job (approval validation). */
async function stageMap(jobId: string): Promise<Map<string, CandidateStage>> {
  const rows = await CandidateModel.find({ jobId: oid(jobId), deletedAt: { $exists: false } })
    .select({ stage: 1 })
    .lean<Array<{ _id: Types.ObjectId; stage: CandidateStage }>>()
    .exec();
  return new Map(rows.map((r) => [String(r._id), r.stage]));
}

async function applyScore(candidateId: string, a: ScoreApplication): Promise<void> {
  await CandidateModel.updateOne(
    { _id: oid(candidateId) },
    {
      $set: {
        parsedSkills: a.parsedSkills,
        yearsExperience: a.yearsExperience,
        projects: a.projects,
        totalScore: a.totalScore,
        coverage: a.coverage,
        verifiedEvidenceCount: a.verifiedEvidenceCount,
        flags: a.flags,
      },
    },
  ).exec();
  if (a.markScored) {
    await CandidateModel.updateOne({ _id: oid(candidateId), stage: 'applied' }, { $set: { stage: 'scored' } }).exec();
  }
}

/** Override path: total/coverage/evidence/flags only (stage and parsed data untouched). */
async function applySummary(
  candidateId: string,
  s: { totalScore: number; coverage: number; verifiedEvidenceCount: number; flags: CandidateFlag[] },
): Promise<void> {
  await CandidateModel.updateOne({ _id: oid(candidateId) }, { $set: s }).exec();
}

/** Sets the full flag list (used when scoring cannot produce a score, e.g. needs_review). */
async function setFlags(candidateId: string, flags: CandidateFlag[]): Promise<void> {
  await CandidateModel.updateOne({ _id: oid(candidateId) }, { $set: { flags } }).exec();
}

async function saveRanking(ranked: ReadonlyArray<{ id: string; rank: number; tieBreakTrace: string[] }>): Promise<void> {
  if (ranked.length === 0) return;
  await CandidateModel.bulkWrite(
    ranked.map((r) => ({
      updateOne: { filter: { _id: oid(r.id) }, update: { $set: { rank: r.rank, tieBreakTrace: r.tieBreakTrace } } },
    })),
  );
}

async function setStages(jobId: string, ids: ReadonlyArray<string>, stage: CandidateStage): Promise<void> {
  if (ids.length === 0) return;
  await CandidateModel.updateMany({ jobId: oid(jobId), _id: { $in: ids.map(oid) } }, { $set: { stage } }).exec();
}

/** Original text is only for the swap test and the portal first name. Never returned by the API. */
async function getOriginalText(candidateId: string): Promise<string | null> {
  const doc = await CandidateTextModel.findOne({ candidateId: oid(candidateId) })
    .select({ text: 1 })
    .lean<{ text: string } | null>()
    .exec();
  return doc?.text ?? null;
}

export const candidateScoringRepository = {
  listScorable,
  findById,
  listRankable,
  stageMap,
  applyScore,
  applySummary,
  setFlags,
  saveRanking,
  setStages,
  getOriginalText,
};

/** Adds one badge without touching anything else ($addToSet keeps it idempotent). */
export async function addFlag(candidateId: string, flag: CandidateFlag): Promise<void> {
  await CandidateModel.updateOne({ _id: oid(candidateId) }, { $addToSet: { flags: flag } }).exec();
}
