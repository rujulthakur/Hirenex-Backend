import { LlmHttpError } from './types';

export interface RetryOptions {
  /** Retries after the first attempt (spec: max 3). */
  maxRetries: number;
  baseMs: number;
  maxMs: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** PURE. Full-jitter exponential backoff: random in [0, min(maxMs, baseMs * 2^attempt)). */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number, random: () => number): number {
  return Math.floor(random() * Math.min(maxMs, baseMs * 2 ** attempt));
}

/** PURE. Retry on 429, 5xx and network/timeout errors (status 0). Never on other 4xx. */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof LlmHttpError) return err.status === 0 || err.status === 429 || err.status >= 500;
  return false;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= opts.maxRetries || !isRetryableError(err)) throw err;
      await sleep(backoffDelay(attempt, opts.baseMs, opts.maxMs, random));
      attempt += 1;
    }
  }
}
