import { resolveProvider } from './index';

export type LlmStatusName = 'gemini' | 'groq' | 'unconfigured';

/**
 * Reports the configured provider by checking that its key exists.
 * Never calls the LLM (health checks must be free and fast). The gateway arrives in Prompt 8.
 */
export function getLlmStatus(): LlmStatusName {
  return resolveProvider() ?? 'unconfigured';
}
