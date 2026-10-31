import { env } from '../config/env';
import { computeCacheKey } from '../domain/cacheKey';
import { getLlmClient, getModelName } from '../integrations/llm';
import { getPrescored, isPrescoredOnly } from '../integrations/llm/prescored';
import { buildExtractAndScorePrompt, PROMPT_IDS, type PromptCriterion } from '../integrations/llm/prompts';
import { extractAndScoreSchema, type ExtractAndScoreOutput } from '../integrations/llm/schemas';
import { LlmSchemaError, type LlmUsage } from '../integrations/llm/types';
import { scoreRepository } from '../repositories/score.repository';
import { AiUnavailableError } from '../utils/errors';
import { summarizeText, traceService } from './trace.service';

export interface ScoreRequest {
  jobId: string;
  runId: string;
  textHash: string;
  /** The REDACTED text only. Original text never reaches the LLM. */
  redactedText: string;
  jobTitle: string;
  criteria: PromptCriterion[];
  criteriaHash: string;
  requiredSkills: string[];
  preferredSkills: string[];
  /** Swap test sets this so the call is a genuinely fresh model run. */
  bypassCache?: boolean;
  nonce?: string;
}

export type ScoreSource = 'llm' | 'cache' | 'prescored';

export type ScoreResult =
  | {
      status: 'scored';
      output: ExtractAndScoreOutput;
      source: ScoreSource;
      cacheKey: string;
      /** Id of the score document this result was copied from (cache hits only). */
      cachedFrom?: string;
      usage: LlmUsage;
      model: string;
      promptId: string;
    }
  | { status: 'needs_review'; reason: string; promptId: string; model: string };

const NO_USAGE: LlmUsage = { tokensIn: 0, tokensOut: 0 };

function summarize(out: ExtractAndScoreOutput): string {
  return `${out.criteria.length} criteria scored, ${out.skills.length} skills, ${out.projects.length} projects`;
}

/**
 * The LLM only PROPOSES here. Quote verification, totals and ranking happen later in pure code.
 * Order: cache (unless bypassed) -> LLM (traced, retried by the gateway) -> on schema failure
 * "needs_review" (never a guessed score) -> on AI_UNAVAILABLE in DEMO_MODE, the prescored fixture.
 */
export async function proposeScores(req: ScoreRequest): Promise<ScoreResult> {
  const model = getModelName();
  const promptId = PROMPT_IDS.extractAndScore;
  const cacheKey = computeCacheKey({ redactedText: req.redactedText, criteriaHash: req.criteriaHash, promptId, model });
  const inputSummary = summarizeText('redacted resume', req.redactedText);
  const meta = { jobId: req.jobId, model, promptId };

  if (isPrescoredOnly() && !req.bypassCache) {
    const fixture = getPrescored(req.textHash);
    if (fixture) {
      await traceService.wrap(req.runId, 'score', async () => fixture, inputSummary, {
        ...meta,
        describe: () => ({ outputSummary: `prescored fixture used by demo mode (${summarize(fixture)})`, status: 'fallback' }),
      });
      return { status: 'scored', output: fixture, source: 'prescored', cacheKey, usage: NO_USAGE, model, promptId };
    }
  }

  if (!req.bypassCache) {
    const hit = await scoreRepository.findCacheHit(cacheKey);
    const parsed = hit ? extractAndScoreSchema.safeParse(hit.rawOutput) : null;
    if (hit && parsed?.success) {
      const output = parsed.data;
      await traceService.wrap(req.runId, 'score', async () => output, inputSummary, {
        ...meta,
        describe: () => ({ outputSummary: `cache hit (${summarize(output)})`, tokensIn: 0, tokensOut: 0 }),
      });
      return { status: 'scored', output, source: 'cache', cacheKey, cachedFrom: String(hit.id), usage: NO_USAGE, model, promptId };
    }
  }

  const prompt = buildExtractAndScorePrompt({
    redactedText: req.redactedText,
    jobTitle: req.jobTitle,
    criteria: req.criteria,
    requiredSkills: req.requiredSkills,
    preferredSkills: req.preferredSkills,
    nonce: req.nonce,
  });

  try {
    const res = await traceService.wrap(
      req.runId,
      'score',
      () => getLlmClient().generateJson(promptId, prompt.system, prompt.user, extractAndScoreSchema),
      inputSummary,
      {
        ...meta,
        describe: (r) => {
          const result = r as { data: ExtractAndScoreOutput; usage: LlmUsage; model: string };
          return {
            outputSummary: summarize(result.data),
            model: result.model,
            tokensIn: result.usage.tokensIn,
            tokensOut: result.usage.tokensOut,
          };
        },
      },
    );
    return { status: 'scored', output: res.data, source: 'llm', cacheKey, usage: res.usage, model: res.model, promptId };
  } catch (err) {
    if (err instanceof LlmSchemaError) {
      return { status: 'needs_review', reason: err.issues.slice(0, 3).join('; '), promptId, model };
    }
    if (err instanceof AiUnavailableError && env.DEMO_MODE) {
      const fixture = getPrescored(req.textHash);
      if (fixture) {
        await traceService.wrap(req.runId, 'score', async () => fixture, inputSummary, {
          ...meta,
          describe: () => ({
            outputSummary: `LLM unavailable, used prescored fixture (${summarize(fixture)})`,
            status: 'fallback',
          }),
        });
        return { status: 'scored', output: fixture, source: 'prescored', cacheKey, usage: NO_USAGE, model, promptId };
      }
    }
    throw err;
  }
}
