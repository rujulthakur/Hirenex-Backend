import { env } from '../../config/env';

export type LlmStatusName = 'gemini' | 'groq' | 'unconfigured';

/**
 * Reports the configured provider by checking that its key exists.
 * Never calls the LLM (health checks must be free and fast). The gateway arrives in Prompt 8.
 */
export function getLlmStatus(): LlmStatusName {
  if (env.LLM_PROVIDER === 'gemini' && env.GEMINI_API_KEY) return 'gemini';
  if (env.LLM_PROVIDER === 'groq' && env.GROQ_API_KEY) return 'groq';
  return 'unconfigured';
}
