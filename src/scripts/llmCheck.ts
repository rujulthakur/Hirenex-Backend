/**
 * npm run llm:check
 * Sends one tiny JSON request through the SAME gateway the scorer uses and prints the result.
 * Use it right after you paste your key into .env to confirm Groq (or Gemini) really answers.
 */
import { z } from 'zod';
import { env } from '../config/env';
import { getLlmClient } from '../integrations/llm';

const schema = z.object({ ok: z.boolean(), echo: z.string() }).strict();

async function main(): Promise<void> {
  const hasKey = env.LLM_PROVIDER === 'groq' ? Boolean(env.GROQ_API_KEY) : Boolean(env.GEMINI_API_KEY);
  process.stdout.write(`Provider: ${env.LLM_PROVIDER}  Model: ${env.LLM_MODEL}  Key present: ${hasKey}\n`);
  if (!hasKey) {
    process.stdout.write(`FAIL: ${env.LLM_PROVIDER === 'groq' ? 'GROQ_API_KEY' : 'GEMINI_API_KEY'} is empty in .env\n`);
    process.exit(1);
  }
  const started = Date.now();
  const res = await getLlmClient().generateJson(
    'llm_check',
    'You return ONLY a JSON object, no markdown.',
    'Return JSON exactly like {"ok": true, "echo": "trusthire"}.',
    schema,
  );
  process.stdout.write(`PASS in ${Date.now() - started} ms: ${JSON.stringify(res.data)} (tokens in/out ${res.usage.tokensIn}/${res.usage.tokensOut})\n`);
}

main().catch((err: unknown) => {
  process.stdout.write(`FAIL: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
