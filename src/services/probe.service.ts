import { ScoreModel } from '../models/score.model';
import { getLlmClient } from '../integrations/llm';
import { buildProbeQuestionsPrompt } from '../integrations/llm/prompts';
import { probeQuestionsSchema } from '../integrations/llm/schemas';
import { candidateScoringRepository } from '../repositories/candidateScoring.repository';
import { jobRepository } from '../repositories/job.repository';
import { scoreRepository } from '../repositories/score.repository';
import { NotFoundError } from '../utils/errors';
import { auditService, type AuditActor } from './audit.service';

/**
 * Probe questions (probe_questions_v1): built from CLAIMED vs DEMONSTRATED skills. Evidence status comes from the
 * code-verified scores, so a claimed skill with no verified quote is exactly what the questions target. The input
 * is the REDACTED text only. The result is stored on the score doc.
 */
async function generate(candidateId: string, actor: AuditActor): Promise<{ candidateId: string; probeQuestions: string[] }> {
  const cand = await candidateScoringRepository.findById(candidateId);
  if (!cand) throw new NotFoundError('Candidate not found');
  const score = await scoreRepository.findByCandidate(candidateId);
  if (!score) throw new NotFoundError('This candidate has not been scored yet');
  const job = await jobRepository.findById(String(cand.jobId));
  if (!job) throw new NotFoundError('Job not found');

  const byId = new Map(score.perCriterion.map((c) => [c.criterionId, c]));
  const evidence = job.criteria.map((c) => {
    const s = byId.get(c.id);
    return { criterionName: c.name, verifiedQuote: s?.verified ? s.quote : '', missing: !s || s.missing || !s.verified };
  });
  const claimedSkills = [...new Set([...job.requiredSkills, ...job.preferredSkills])];
  const built = buildProbeQuestionsPrompt({ redactedText: cand.redactedText, jobTitle: job.title, evidence, claimedSkills });
  const res = await getLlmClient().generateJson(built.promptId, built.system, built.user, probeQuestionsSchema);
  const probeQuestions = res.data.questions.slice(0, 5);

  await ScoreModel.updateOne({ candidateId: score.candidateId }, { $set: { probeQuestions } }).exec();
  await auditService.append({ actor, action: 'probes.generate', entityType: 'candidate', entityId: candidateId, jobId: String(cand.jobId), payload: { count: probeQuestions.length, promptId: built.promptId } });
  return { candidateId, probeQuestions };
}

export const probeService = { generate };
