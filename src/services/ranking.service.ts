import { computeTotal } from '../domain/scoring';
import { isApproved } from '../domain/approval';
import { cutShortlist, rankCandidates, TIE_RULE_TEXT, type RankInput, type Ranked } from '../domain/ranking';
import { candidateScoringRepository, type RankableCandidate } from '../repositories/candidateScoring.repository';
import { jobRepository } from '../repositories/job.repository';
import { scoreRepository } from '../repositories/score.repository';
import type { CandidateFlag, CandidateStage } from '../types/enums';
import { NotFoundError, ValidationError } from '../utils/errors';

export interface ShortlistItem {
  candidateId: string;
  fileName: string;
  rank: number;
  totalScore: number;
  coverage: number;
  verifiedEvidenceCount: number;
  yearsExperience: number;
  flags: CandidateFlag[];
  stage: CandidateStage;
  tieBreakTrace: string[];
}

export interface ShortlistView {
  shortlist: ShortlistItem[];
  waitlist: ShortlistItem[];
  tieRule: string;
  approved: boolean;
  capacity: number;
  waitlistSize: number;
}

function toInput(c: RankableCandidate, total: number): RankInput {
  return {
    id: String(c._id),
    total,
    coverage: c.coverage,
    verifiedEvidenceCount: c.verifiedEvidenceCount,
    yearsExperience: c.yearsExperience,
    uploadOrder: c.uploadOrder,
  };
}

function toItem(r: Ranked, byId: Map<string, RankableCandidate>): ShortlistItem {
  const c = byId.get(r.id);
  return {
    candidateId: r.id,
    fileName: c?.fileName ?? '',
    rank: r.rank,
    totalScore: r.total,
    coverage: r.coverage,
    verifiedEvidenceCount: r.verifiedEvidenceCount,
    yearsExperience: r.yearsExperience,
    flags: c?.flags ?? [],
    stage: c?.stage ?? 'scored',
    tieBreakTrace: r.tieBreakTrace,
  };
}

async function loadJob(jobId: string): Promise<NonNullable<Awaited<ReturnType<typeof jobRepository.findById>>>> {
  const job = await jobRepository.findById(jobId);
  if (!job) throw new NotFoundError('Job not found');
  return job;
}

/** Recomputes ranks from stored totals and persists rank + tieBreakTrace. Deterministic. */
async function rankJob(jobId: string): Promise<Ranked[]> {
  const rows = await candidateScoringRepository.listRankable(jobId);
  const ranked = rankCandidates(rows.map((c) => toInput(c, c.totalScore)));
  await candidateScoringRepository.saveRanking(ranked.map((r) => ({ id: r.id, rank: r.rank, tieBreakTrace: r.tieBreakTrace })));
  return ranked;
}

function buildView(
  ranked: Ranked[],
  byId: Map<string, RankableCandidate>,
  capacity: number,
  waitlistSize: number,
  approved: boolean,
): ShortlistView {
  const items = ranked.map((r) => toItem(r, byId));
  if (approved) {
    // After approval, the lists are what HR approved, not a fresh cut.
    return {
      shortlist: items.filter((i) => i.stage === 'shortlisted' || i.stage === 'invited' || i.stage === 'confirmed' || i.stage === 'declined'),
      waitlist: items.filter((i) => i.stage === 'waitlisted'),
      tieRule: TIE_RULE_TEXT,
      approved,
      capacity,
      waitlistSize,
    };
  }
  const cut = cutShortlist(items, capacity, waitlistSize);
  return { shortlist: cut.shortlist, waitlist: cut.waitlist, tieRule: TIE_RULE_TEXT, approved, capacity, waitlistSize };
}

/** GET /jobs/:id/shortlist. */
async function getShortlist(jobId: string): Promise<ShortlistView> {
  const job = await loadJob(jobId);
  const rows = await candidateScoringRepository.listRankable(jobId);
  const byId = new Map(rows.map((c) => [String(c._id), c]));
  const ranked = rankCandidates(rows.map((c) => toInput(c, c.totalScore)));
  return buildView(ranked, byId, job.capacity, job.waitlistSize, isApproved(job.status));
}

/** POST /jobs/:id/rerank. Preview only: recomputes in memory from stored per-criterion scores. No LLM, nothing saved. */
async function rerank(jobId: string, weights: Record<string, number>): Promise<ShortlistView> {
  const job = await loadJob(jobId);
  const known = new Set(job.criteria.map((c) => c.id));
  const unknown = Object.keys(weights).filter((k) => !known.has(k));
  if (unknown.length > 0) throw new ValidationError('Unknown criterion ids in weights', unknown.map((id) => ({ criterionId: id })));
  const criteria = job.criteria.map((c) => ({ id: c.id, weight: weights[c.id] ?? c.weight }));
  if (criteria.every((c) => c.weight === 0)) throw new ValidationError('At least one weight must be above zero');

  const rows = await candidateScoringRepository.listRankable(jobId);
  const byId = new Map(rows.map((c) => [String(c._id), c]));
  const scores = await scoreRepository.findByJob(jobId);
  const scoreByCandidate = new Map(scores.map((s) => [String(s.candidateId), s]));

  const inputs = rows.map((c) => {
    const s = scoreByCandidate.get(String(c._id));
    const total = s ? computeTotal(criteria, s.perCriterion) : c.totalScore;
    return toInput(c, total);
  });
  const ranked = rankCandidates(inputs);
  return buildView(ranked, byId, job.capacity, job.waitlistSize, false);
}

export const rankingService = { rankJob, getShortlist, rerank };
