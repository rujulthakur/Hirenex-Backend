import pLimit from 'p-limit';
import type { ZodType, ZodTypeDef } from 'zod';
import { AiUnavailableError } from '../../utils/errors';
import { extractJson } from './jsonExtract';
import { withRetry } from './retry';
import {
  LlmSchemaError,
  type LlmClient,
  type LlmJsonResult,
  type LlmTransport,
  type LlmUsage,
} from './types';

export interface GatewayOptions {
  concurrency?: number;
  timeoutMs?: number;
  maxRetries?: number;
  baseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return { tokensIn: a.tokensIn + b.tokensIn, tokensOut: a.tokensOut + b.tokensOut };
}

function describeFailure(err: unknown): string[] {
  if (err instanceof SyntaxError) return [`output was not valid JSON (${err.message})`];
  if (err && typeof err === 'object' && 'issues' in err && Array.isArray((err as { issues: unknown }).issues)) {
    return (err as { issues: Array<{ path: Array<string | number>; message: string }> }).issues.map(
      (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
    );
  }
  return ['unknown validation failure'];
}

/**
 * Wraps a raw provider transport with: concurrency limit (default 3), timeout, retry with
 * exponential backoff + jitter on 429/5xx (max 3), strict JSON extraction, zod validation, and ONE
 * corrective retry that feeds the validation errors back. After retries are exhausted the call
 * throws AI_UNAVAILABLE; if the model answers but never validates, it throws LlmSchemaError so the
 * caller can mark the candidate "needs_review" instead of guessing.
 */
export function createLlmClient(transport: LlmTransport, options: GatewayOptions = {}): LlmClient {
  const limit = pLimit(options.concurrency ?? 3);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retryOpts = {
    maxRetries: options.maxRetries ?? 3,
    baseMs: options.baseMs ?? 500,
    maxMs: options.maxMs ?? 8_000,
    sleep: options.sleep,
    random: options.random,
  };

  const call = async (system: string, user: string): Promise<{ text: string; usage: LlmUsage; model: string }> => {
    try {
      return await withRetry(
        () => limit(() => transport.complete({ system, user, json: true, timeoutMs })),
        retryOpts,
      );
    } catch {
      throw new AiUnavailableError();
    }
  };

  return {
    provider: transport.provider,
    async generateJson<T>(
      promptId: string,
      system: string,
      user: string,
      schema: ZodType<T, ZodTypeDef, unknown>,
    ): Promise<LlmJsonResult<T>> {
      let usage: LlmUsage = { tokensIn: 0, tokensOut: 0 };
      let lastIssues: string[] = [];
      let prompt = user;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const res = await call(system, prompt);
        usage = addUsage(usage, res.usage);
        try {
          const parsed = schema.parse(extractJson(res.text));
          return { data: parsed, usage, model: res.model };
        } catch (err) {
          lastIssues = describeFailure(err);
          prompt = `${user}\n\nYour previous answer was rejected because: ${lastIssues.join('; ')}.\nReturn corrected JSON only, matching the required schema exactly, with no extra keys.`;
        }
      }
      throw new LlmSchemaError(promptId, lastIssues);
    },
  };
}
