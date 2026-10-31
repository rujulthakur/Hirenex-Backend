import { env } from '../../config/env';
import { AiUnavailableError } from '../../utils/errors';
import { createGeminiTransport } from './gemini.adapter';
import { createLlmClient } from './gatewayClient';
import { createGroqTransport } from './groq.adapter';
import type { LlmClient } from './types';

let override: LlmClient | null = null;
let cached: LlmClient | null = null;

/** Tests and demo mode inject a client here (for example the mock). Pass null to reset. */
export function setLlmClient(client: LlmClient | null): void {
  override = client;
  cached = null;
}

/** Uses the configured provider if its key exists; otherwise falls back to whichever key IS set (so a wrong LLM_PROVIDER no longer breaks AI). */
export function resolveProvider(): 'gemini' | 'groq' | null {
  const hasG = Boolean(env.GEMINI_API_KEY?.trim());
  const hasQ = Boolean(env.GROQ_API_KEY?.trim());
  if (env.LLM_PROVIDER === 'gemini' && hasG) return 'gemini';
  if (env.LLM_PROVIDER === 'groq' && hasQ) return 'groq';
  if (hasQ) return 'groq';
  if (hasG) return 'gemini';
  return null;
}

/** A model name from the other provider (or an empty one) is swapped for that provider's default. */
function modelFor(provider: 'gemini' | 'groq'): string {
  const m = env.LLM_MODEL;
  if (provider === 'groq' && /^gemini/i.test(m)) return 'llama-3.3-70b-versatile';
  if (provider === 'gemini' && !/^gemini/i.test(m)) return 'gemini-3.8-flash';
  return m;
}

/** The configured model name, used in cache keys and traces. */
export function getModelName(): string {
  return override?.provider === 'mock' ? 'mock-model' : modelFor(resolveProvider() ?? env.LLM_PROVIDER);
}

/** Returns the client for the resolved provider. Throws AI_UNAVAILABLE only when neither key is set. */
export function getLlmClient(): LlmClient {
  if (override) return override;
  if (cached) return cached;
  const p = resolveProvider();
  if (p === 'gemini') cached = createLlmClient(createGeminiTransport(env.GEMINI_API_KEY!.trim(), modelFor('gemini')));
  else if (p === 'groq') cached = createLlmClient(createGroqTransport(env.GROQ_API_KEY!.trim(), modelFor('groq')));
  else throw new AiUnavailableError('No AI key found. Set GROQ_API_KEY or GEMINI_API_KEY in the backend .env (or Render environment), then restart.');
  return cached;
}

export type { LlmClient, LlmJsonResult, LlmUsage } from './types';
export { LlmSchemaError } from './types';
