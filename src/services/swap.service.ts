import { Types } from 'mongoose';
import { computeTotal, applyVerification, type ProposedCriterion } from '../domain/scoring';
import { compareRedactions, SWAP_LIMIT_NOTE, scoreDelta, round2 } from '../domain/swap';
import { hashText, normalizeText } from '../domain/text';
import { redact } from '../domain/redaction';
import { candidateScoringRepository } from '../repositories/candidateScoring.repository';
import { jobRepository } from '../repositories/job.repository';
import { scoreRepository } from '../repositories/score.repository';
import { NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';
import { auditService, type AuditActor } from './audit.service';
import { proposeScores } from './llmScoring.service';

export interface SwapTestResult {
  redactedIdentical: boolean;
  original: { total: number };
  swapped: { total: number };
  delta: number;
  /** Fresh, UNCACHED model run on the swapped redacted text vs the original total. null when the LLM was unavailable. */
  rescoredDelta: number | null;
  rescoredTotal: number | null;
  limitNote: string;
  note?: string;
}

/**
 * POST /candidates/:id/swap-test.
 *  1. Swap name + gender words in the ORIGINAL text with a fixed neutral mapping, run the same redaction, compare hashes.
 *  2. Fresh LLM call with the cache bypassed (temperature 0 in the adapters) on the swapped redacted text, verified
 *     by the same pure quote check, so the result is not trivially identical. Any non-zero delta is reported as is.
 */
async function run(candidateId: string, actor: AuditActor): Promise<SwapTestResult> {
  const cand = await candidateScoringRepository.findById(candidateId);
  if (!cand) throw new NotFoundError('Candidate not found');
  const score = await scoreRepository.findByCandidate(candidateId);
  if (!score) throw new NotFoundError('This candidate has not been scored yet');
  const original = await candidateScoringRepository.getOriginalText(candidateId);
  if (!original) throw new NotFoundError('Original text is not available for this candidate');
  const job = await jobRepository.findById(String(cand.jobId));
  if (!job) throw new NotFoundError('Job not found');

  const cmp = compareRedactions(original, cand.fileName);
  const originalTotal = score.total;

  // Fresh rescore of the swapped, redacted text (cache bypassed).
  let rescoredTotal: number | null = null;
  let note: string | undefined;
  try {
    const swappedRedacted = redact(cmp.swappedText, 'candidate_resume.pdf').redactedText;
    const res = await proposeScores({
      jobId: String(job._id),
      runId: new Types.ObjectId().toString(),
      textHash: hashText(normalizeText(swappedRedacted)),
      redactedText: swappedRedacted,
      jobTitle: job.title,
      criteria: job.criteria.map((c) => ({ id: c.id, name: c.name, weight: c.weight, description: c.description ?? '' })),
      criteriaHash: job.criteriaHash,
      requiredSkills: job.requiredSkills,
      preferredSkills: job.preferredSkills,
      bypassCache: true,
      nonce: `swap-${Date.now()}`,
    });
    if (res.status === 'scored') {
      const proposals: ProposedCriterion[] = res.output.criteria.map((c) => ({ criterionId: c.criterionId, score: c.score, quote: c.quote, confidence: c.confidence, missing: c.missing, reason: c.reason }));
      const jobText = [job.description, ...job.criteria.map((c) => `${c.name} ${c.description ?? ''}`)].join('\n');
      const verified = applyVerification(job.criteria, proposals, swappedRedacted, jobText);
      rescoredTotal = computeTotal(job.criteria, verified);
    } else {
      note = 'The fresh rescore needed human review, so no rescored delta is reported.';
    }
  } catch (err) {
    logger.warn('swap test rescore unavailable', { message: (err as Error).message });
    note = 'The AI service was unavailable, so only the redaction hash comparison is reported.';
  }

  // With identical redacted text the scorer input is identical, so the swapped total equals the original total.
  const swappedTotal = cmp.redactedIdentical ? originalTotal : rescoredTotal ?? originalTotal;
  const result: SwapTestResult = {
    redactedIdentical: cmp.redactedIdentical,
    original: { total: round2(originalTotal) },
    swapped: { total: round2(swappedTotal) },
    delta: scoreDelta(originalTotal, swappedTotal),
    rescoredDelta: rescoredTotal === null ? null : scoreDelta(originalTotal, rescoredTotal),
    rescoredTotal: rescoredTotal === null ? null : round2(rescoredTotal),
    limitNote: SWAP_LIMIT_NOTE,
    ...(note ? { note } : {}),
  };
  await auditService.append({ actor, action: 'swap.test', entityType: 'candidate', entityId: candidateId, jobId: String(cand.jobId), payload: { redactedIdentical: result.redactedIdentical, delta: result.delta, rescoredDelta: result.rescoredDelta } });
  return result;
}

export const swapService = { run };
