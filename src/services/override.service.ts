import { ScoreModel } from '../models/score.model';
import { applyOverride, deriveFlags, OverrideError, summarizeCandidate, type ScoredCriterion } from '../domain/scoring';
import { candidateScoringRepository } from '../repositories/candidateScoring.repository';
import { jobRepository } from '../repositories/job.repository';
import { scoreRepository, type ScoreLean } from '../repositories/score.repository';
import type { CandidateFlag } from '../types/enums';
import { NotFoundError, ValidationError } from '../utils/errors';
import { auditService, type AuditActor } from './audit.service';
import { rankingService } from './ranking.service';

const DERIVED_FLAGS: readonly CandidateFlag[] = ['unverified_evidence', 'incomplete', 'needs_review'];

export interface ScoresDto {
  candidateId: string;
  total: number;
  promptId: string;
  model: string;
  probeQuestions: string[];
  perCriterion: Array<{
    criterionId: string;
    score: number;
    quote: string;
    location: { start: number; end: number } | null;
    verified: boolean;
    confidence: number;
    missing: boolean;
    authority: 'ai' | 'code' | 'human';
    overriddenBy?: string;
    overrideReason?: string;
    originalScore?: number;
  }>;
}

function toScored(c: ScoreLean['perCriterion'][number]): ScoredCriterion {
  return {
    criterionId: c.criterionId,
    score: c.score,
    quote: c.quote ?? '',
    location: c.location ?? null,
    verified: c.verified,
    confidence: c.confidence,
    missing: c.missing,
    authority: c.authority,
    ...(c.overriddenBy ? { overriddenBy: String(c.overriddenBy) } : {}),
    ...(c.overrideReason ? { overrideReason: c.overrideReason } : {}),
    ...(c.originalScore !== undefined ? { originalScore: c.originalScore } : {}),
  };
}

/** GET /candidates/:id/scores. Per criterion {score, quote, location, verified, confidence, missing, authority}. */
async function getScores(candidateId: string): Promise<ScoresDto> {
  const cand = await candidateScoringRepository.findById(candidateId);
  if (!cand) throw new NotFoundError('Candidate not found');
  const doc = await scoreRepository.findByCandidate(candidateId);
  if (!doc) throw new NotFoundError('This candidate has not been scored yet');
  await ScoreModel.updateOne({ candidateId: doc.candidateId, evidenceOpenedAt: { $exists: false } }, { $set: { evidenceOpenedAt: new Date() } }).exec().catch(() => undefined);
  return {
    candidateId,
    total: doc.total,
    promptId: doc.promptId,
    model: doc.model,
    probeQuestions: doc.probeQuestions ?? [],
    perCriterion: doc.perCriterion.map((c) => {
      const s = toScored(c);
      return {
        criterionId: s.criterionId,
        score: s.score,
        quote: s.quote,
        location: s.location,
        verified: s.verified,
        confidence: s.confidence,
        missing: s.missing,
        authority: s.authority,
        ...(s.overriddenBy ? { overriddenBy: s.overriddenBy } : {}),
        ...(s.overrideReason ? { overrideReason: s.overrideReason } : {}),
        ...(s.originalScore !== undefined ? { originalScore: s.originalScore } : {}),
      };
    }),
  };
}

export interface OverrideResult {
  candidateId: string;
  criterionId: string;
  oldScore: number;
  newScore: number;
  total: number;
  rank: number | null;
  auditSeq: number;
}

/**
 * PATCH /candidates/:id/scores/:criterionId. HR override: reason required (min 10 chars), stores originalScore,
 * authority "human", recomputes the total and the ranking, audits old and new values, returns the audit seq.
 */
async function overrideScore(
  candidateId: string,
  criterionId: string,
  newScore: number,
  reason: string,
  actor: AuditActor,
): Promise<OverrideResult> {
  const cand = await candidateScoringRepository.findById(candidateId);
  if (!cand) throw new NotFoundError('Candidate not found');
  const jobId = String(cand.jobId);
  const job = await jobRepository.findById(jobId);
  if (!job) throw new NotFoundError('Job not found');
  const doc = await scoreRepository.findByCandidate(candidateId);
  if (!doc) throw new NotFoundError('This candidate has not been scored yet');

  let updated: ScoredCriterion[];
  let previous: ScoredCriterion;
  try {
    ({ updated, previous } = applyOverride(doc.perCriterion.map(toScored), criterionId, newScore, reason, actor.id));
  } catch (err) {
    if (err instanceof OverrideError) throw new ValidationError(err.message, [{ path: 'score/reason', message: err.message }]);
    throw err;
  }

  const summary = summarizeCandidate(job.criteria, updated, job.requiredSkills);
  const flags = [...cand.flags.filter((f) => !DERIVED_FLAGS.includes(f)), ...deriveFlags(summary)];

  await scoreRepository.saveCriteria(candidateId, updated, summary.total);
  await candidateScoringRepository.applySummary(candidateId, {
    totalScore: summary.total,
    coverage: summary.coverage,
    verifiedEvidenceCount: summary.verifiedEvidenceCount,
    flags,
  });
  const ranked = await rankingService.rankJob(jobId);
  const mine = ranked.find((r) => r.id === candidateId);

  const receipt = await auditService.append({
    actor,
    action: 'score.override',
    entityType: 'candidate',
    entityId: candidateId,
    jobId,
    oldValue: { criterionId, score: previous.score, authority: previous.authority, total: doc.total },
    newValue: { criterionId, score: newScore, authority: 'human', total: summary.total },
    payload: { reason: reason.trim() },
  });

  return {
    candidateId,
    criterionId,
    oldScore: previous.score,
    newScore,
    total: summary.total,
    rank: mine?.rank ?? null,
    auditSeq: receipt.seq,
  };
}

export const overrideService = { getScores, overrideScore };
