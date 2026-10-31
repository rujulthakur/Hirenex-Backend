import pLimit from 'p-limit';
import { Types } from 'mongoose';
import { applyVerification, deriveFlags, summarizeCandidate, type ProposedCriterion } from '../domain/scoring';
import { getModelName } from '../integrations/llm';
import { computeCriteriaHash } from '../domain/cacheKey';
import { candidateScoringRepository, type ScoringCandidate } from '../repositories/candidateScoring.repository';
import { jobRepository, type JobLean } from '../repositories/job.repository';
import { runRepository } from '../repositories/run.repository';
import { scoreRepository } from '../repositories/score.repository';
import type { CandidateFlag } from '../types/enums';
import { ConflictError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';
import { auditService, type AuditActor } from './audit.service';
import { proposeScores } from './llmScoring.service';
import { rankingService } from './ranking.service';
import { notificationService } from './notification.service';
import { summarizeText, traceService } from './trace.service';

/** Candidates scored in parallel. The LLM gateway has its own limit of 3, this just keeps memory small. */
export const SCORING_CONCURRENCY = 3;

/** Flags derived from scoring. They are recomputed on every run so rescoring never leaves stale badges. */
const DERIVED_FLAGS: readonly CandidateFlag[] = ['unverified_evidence', 'incomplete', 'needs_review'];

export interface RunStatusDto {
  runId: string;
  state: string;
  done: number;
  total: number;
  failures: Array<{ candidateId?: string; fileName?: string; reason: string }>;
}

function jobText(job: JobLean): string {
  return [job.description, ...job.criteria.map((c) => `${c.name} ${c.description ?? ''}`)].join('\n');
}

function withoutDerived(flags: ReadonlyArray<CandidateFlag>): CandidateFlag[] {
  return flags.filter((f) => !DERIVED_FLAGS.includes(f));
}

async function processCandidate(runId: string, job: JobLean, cand: ScoringCandidate): Promise<void> {
  const jobId = String(job._id);
  const candidateId = String(cand._id);

  // parse_resume already happened at upload; scan_hidden_text results are stored on the candidate. We trace
  // the step so the live trace shows the full agent order (the shield ran before redaction, on the original).
  await traceService.wrap(
    runId,
    'scan_hidden_text',
    async () => cand.flags,
    summarizeText('stored shield result', cand.redactedText),
    {
      jobId,
      describe: (r) => {
        const flags = r as CandidateFlag[];
        const hidden = flags.includes('hidden_text_found');
        const inj = flags.includes('injection_phrase_found');
        return { outputSummary: `hidden text: ${hidden ? 'found' : 'none'}; injection phrases: ${inj ? 'found' : 'none'}` };
      },
    },
  );

  const result = await proposeScores({
    jobId,
    runId,
    textHash: cand.textHash,
    redactedText: cand.redactedText,
    jobTitle: job.title,
    criteria: job.criteria.map((c) => ({ id: c.id, name: c.name, weight: c.weight, description: c.description ?? '' })),
    criteriaHash: job.criteriaHash,
    requiredSkills: job.requiredSkills,
    preferredSkills: job.preferredSkills,
  });

  if (result.status === 'needs_review') {
    // Never guess: no score, a badge, and HR sees it.
    await candidateScoringRepository.setFlags(candidateId, [...withoutDerived(cand.flags), 'needs_review']);
    throw new Error(`needs_review: ${result.reason}`.slice(0, 280));
  }

  const proposals: ProposedCriterion[] = result.output.criteria.map((c) => ({
    criterionId: c.criterionId,
    score: c.score,
    quote: c.quote,
    confidence: c.confidence,
    missing: c.missing,
    reason: c.reason,
  }));

  // verify_quotes: PURE code decides. A quote that is not in the redacted text scores 0.
  const verified = await traceService.wrap(
    runId,
    'verify_quotes',
    async () => {
      const scored = applyVerification(job.criteria, proposals, cand.redactedText, jobText(job));
      return { scored, summary: summarizeCandidate(job.criteria, scored, job.requiredSkills) };
    },
    summarizeText('redacted resume', cand.redactedText),
    {
      jobId,
      describe: (r) => {
        const v = r as { scored: Array<{ verified: boolean }>; summary: { unverifiedCount: number } };
        const ok = v.scored.filter((s) => s.verified).length;
        return { outputSummary: `${ok} verified, ${v.summary.unverifiedCount} unverified of ${v.scored.length} criteria` };
      },
    },
  );

  const { scored, summary } = verified;
  const flags = [...withoutDerived(cand.flags), ...deriveFlags(summary)];

  await scoreRepository.upsert({
    candidateId,
    jobId,
    perCriterion: scored,
    total: summary.total,
    promptId: result.promptId,
    model: result.model,
    cacheKey: result.cacheKey,
    ...(result.cachedFrom ? { cachedFrom: result.cachedFrom } : {}),
    rawOutput: result.output,
  });

  await candidateScoringRepository.applyScore(candidateId, {
    parsedSkills: result.output.skills,
    yearsExperience: result.output.yearsExperience,
    projects: result.output.projects.map((p) => (p.description ? `${p.name}: ${p.description}` : p.name)),
    totalScore: summary.total,
    coverage: summary.coverage,
    verifiedEvidenceCount: summary.verifiedEvidenceCount,
    flags,
    markScored: true,
  });
}

async function execute(runId: string, job: JobLean, candidates: ScoringCandidate[], actor: AuditActor): Promise<void> {
  const jobId = String(job._id);
  try {
    await runRepository.markRunning(runId);
    const limit = pLimit(SCORING_CONCURRENCY);
    await Promise.all(
      candidates.map((cand) =>
        limit(async () => {
          try {
            await processCandidate(runId, job, cand);
          } catch (err) {
            // One bad candidate never stops the run.
            const reason = err instanceof Error ? err.message : 'Scoring failed';
            logger.warn('candidate scoring failed', { runId, candidateId: String(cand._id), reason });
            await runRepository.addFailure(runId, { candidateId: String(cand._id), fileName: cand.fileName, reason });
          } finally {
            await runRepository.incrementDone(runId);
          }
        }),
      ),
    );

    await traceService.wrap(runId, 'rank', () => rankingService.rankJob(jobId), `${candidates.length} candidates`, {
      jobId,
      describe: (r) => ({ outputSummary: `ranked ${(r as unknown[]).length} candidates (deterministic tie rule)` }),
    });

    const fresh = await jobRepository.findById(jobId);
    if (fresh && (fresh.status === 'draft' || fresh.status === 'open')) await jobRepository.setStatus(jobId, 'scored');

    await runRepository.finish(runId, 'done');
    const run = await runRepository.findById(runId);
    await auditService.append({
      actor,
      action: 'score.run',
      entityType: 'job',
      entityId: jobId,
      jobId,
      payload: { runId, phase: 'finished', total: run?.total ?? candidates.length, failures: run?.failures.length ?? 0 },
    });
    const failed = run?.failures.length ?? 0;
    const scoredCount = Math.max(0, (run?.total ?? candidates.length) - failed);
    await notificationService.notify(actor.id, 'scoring_done', 'Scoring finished', `${scoredCount} resume${scoredCount === 1 ? '' : 's'} scored for ${job.title}.${failed ? ` ${failed} could not be scored.` : ''}`, `/app/jobs/${jobId}/candidates`);
  } catch (err) {
    logger.error('scoring run failed', { runId, err: err instanceof Error ? err.message : String(err) });
    await runRepository.addFailure(runId, { reason: err instanceof Error ? err.message : 'Run failed' });
    await runRepository.finish(runId, 'failed');
    await notificationService.notify(actor.id, 'scoring_failed', 'Scoring did not finish', `Scoring stopped for ${job.title}. Open the job and try again.`, `/app/jobs/${jobId}/upload`);
  }
}

/** POST /jobs/:id/score -> 202 { runId }. The run continues in-process; the client polls the status endpoint. */
async function startScoring(jobId: string, actor: AuditActor): Promise<{ runId: string }> {
  const job = await jobRepository.findById(jobId);
  if (!job) throw new NotFoundError('Job not found');
  if (await runRepository.hasActive(jobId, 'scoring')) throw new ConflictError('A scoring run is already in progress for this job');

  const candidates = await candidateScoringRepository.listScorable(jobId);
  if (candidates.length === 0) throw new ConflictError('There are no readable resumes to score. Upload resumes first.');

  const runId = await runRepository.create(jobId, 'scoring', candidates.length);
  await auditService.append({
    actor,
    action: 'score.run',
    entityType: 'job',
    entityId: jobId,
    jobId,
    payload: { runId, phase: 'started', total: candidates.length, model: getModelName(), criteriaHash: job.criteriaHash || computeCriteriaHash(job.criteria) },
  });

  void execute(runId, job, candidates, actor);
  return { runId };
}

/** GET /jobs/:id/score/status -> { runId, state, done, total, failures }. */
async function getStatus(jobId: string): Promise<RunStatusDto> {
  if (!Types.ObjectId.isValid(jobId)) throw new NotFoundError('Job not found');
  const run = await runRepository.latestForJob(jobId, 'scoring');
  if (!run) throw new NotFoundError('No scoring run has been started for this job');
  return {
    runId: String(run._id),
    state: run.state,
    done: run.done,
    total: run.total,
    failures: run.failures.map((f) => ({
      ...(f.candidateId ? { candidateId: f.candidateId } : {}),
      ...(f.fileName ? { fileName: f.fileName } : {}),
      reason: f.reason,
    })),
  };
}

export const scoringRunService = { startScoring, getStatus };
