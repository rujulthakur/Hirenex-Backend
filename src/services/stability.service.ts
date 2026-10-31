import { Types } from 'mongoose';
import { applyVerification, computeTotal, type ProposedCriterion } from '../domain/scoring';
import { cutoffTotal, detectFlips, nearCutoff, type TotalRow } from '../domain/stability';
import { hashText, normalizeText } from '../domain/text';
import { addFlag, candidateScoringRepository } from '../repositories/candidateScoring.repository';
import { jobRepository } from '../repositories/job.repository';
import { NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';
import { auditService, type AuditActor } from './audit.service';
import { proposeScores } from './llmScoring.service';

export interface StabilityResult {
  checked: number;
  flipped: string[];
  skipped: string | null;
}

/**
 * P2 stability check. For candidates within STABILITY_MARGIN of the shortlist cutoff, rescore ONCE uncached.
 * If the rescored total lands on the other side of the cutoff, flag 'rank_unstable' for human review.
 * FLAG ONLY: stored scores, totals and ranks are never changed here. AI failures are skipped, never fatal.
 */
export async function runStabilityCheck(jobId: string, actor: AuditActor): Promise<StabilityResult> {
  const job = await jobRepository.findById(jobId);
  if (!job) throw new NotFoundError('Job not found');
  const ranked = await candidateScoringRepository.listRankable(jobId);
  const rows: TotalRow[] = [...ranked]
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
    .map((c) => ({ id: String(c._id), total: c.totalScore }));
  const cut = cutoffTotal(rows, job.capacity);
  if (cut === null) return { checked: 0, flipped: [], skipped: 'Fewer candidates than capacity, nothing is cut.' };

  const targets = nearCutoff(rows, job.capacity);
  const jobText = [job.description, ...job.criteria.map((c) => `${c.name} ${c.description ?? ''}`)].join('\n');
  const before: TotalRow[] = [];
  const after: TotalRow[] = [];

  for (const id of targets) {
    try {
      const cand = await candidateScoringRepository.findById(id);
      if (!cand) continue;
      const res = await proposeScores({
        jobId,
        runId: new Types.ObjectId().toString(),
        textHash: hashText(normalizeText(cand.redactedText)),
        redactedText: cand.redactedText,
        jobTitle: job.title,
        criteria: job.criteria.map((c) => ({ id: c.id, name: c.name, weight: c.weight, description: c.description ?? '' })),
        criteriaHash: job.criteriaHash,
        requiredSkills: job.requiredSkills,
        preferredSkills: job.preferredSkills,
        bypassCache: true,
        nonce: `stab-${Date.now()}-${id}`,
      });
      if (res.status !== 'scored') continue;
      const proposals: ProposedCriterion[] = res.output.criteria.map((c) => ({ criterionId: c.criterionId, score: c.score, quote: c.quote, confidence: c.confidence, missing: c.missing, reason: c.reason }));
      const verified = applyVerification(job.criteria, proposals, cand.redactedText, jobText);
      before.push(rows.find((r) => r.id === id) as TotalRow);
      after.push({ id, total: computeTotal(job.criteria, verified) });
    } catch (err) {
      logger.warn('stability rescore skipped', { message: (err as Error).message });
    }
  }

  const flipped = detectFlips(cut, before, after).filter((f) => f.flipped);
  for (const f of flipped) {
    await addFlag(f.id, 'rank_unstable');
    await auditService.append({ actor, action: 'candidate.rank_unstable', entityType: 'candidate', entityId: f.id, jobId, payload: { before: f.before, after: f.after, cutoff: cut } });
  }
  return { checked: before.length, flipped: flipped.map((f) => f.id), skipped: null };
}
