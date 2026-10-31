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

/** The configured model name, used in cache keys and traces. */
export function getModelName(): string {
  return override?.provider === 'mock' ? 'mock-model' : env.LLM_MODEL;
}

/** Returns the client chosen by LLM_PROVIDER. Throws AI_UNAVAILABLE when no key is configured. */
export function getLlmClient(): LlmClient {
  if (override) return override;
  if (cached) return cached;
  if (env.LLM_PROVIDER === 'gemini' && env.GEMINI_API_KEY) {
    cached = createLlmClient(createGeminiTransport(env.GEMINI_API_KEY, env.LLM_MODEL));
  } else if (env.LLM_PROVIDER === 'groq' && env.GROQ_API_KEY) {
    cached = createLlmClient(createGroqTransport(env.GROQ_API_KEY, env.LLM_MODEL));
  } else {
    throw new AiUnavailableError('No LLM provider is configured');
  }
  return cached;
}

export type { LlmClient, LlmJsonResult, LlmUsage } from './types';
export { LlmSchemaError } from './types';
