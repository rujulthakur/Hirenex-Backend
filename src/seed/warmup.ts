/**
 * npm run demo:warmup   (run ~10 minutes before presenting)
 * Pings /health, primes the Ethereal account (via a throwaway Ethereal message creation) and the LLM (one tiny call).
 * Uses only the public HTTP API plus the mailer/LLM ports; prints OK/WARN per check, never fails the shell.
 */
import { getCandidateMailer } from '../integrations/mailer/candidateMailer';
import { getLlmClient } from '../integrations/llm';
import { z } from 'zod';

const BASE = process.env['DEMO_BASE_URL'] ?? 'http://localhost:4000/api/v1';
const line = (ok: boolean, label: string, detail: string): void => {
  process.stdout.write(`${ok ? 'OK  ' : 'WARN'} ${label}: ${detail}\n`);
};

async function main(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/health`);
    const body = (await res.json()) as { data?: { status?: string; db?: string; redis?: string; llm?: string } };
    line(res.ok, 'health', JSON.stringify(body.data ?? body));
  } catch (e) {
    line(false, 'health', `unreachable (${(e as Error).message})`);
  }

  try {
    const result = await getCandidateMailer().send({ to: 'warmup@candidates.test', subject: 'Warm-up (test inbox)', text: 'Warm-up message. Synthetic data.', html: '<p>Warm-up message. Synthetic data.</p>' });
    line(result.ok, 'test inbox (Ethereal)', result.ok ? `ready ${result.previewUrl ?? ''}` : 'send failed');
  } catch (e) {
    line(false, 'test inbox (Ethereal)', (e as Error).message);
  }

  try {
    const t0 = Date.now();
    await getLlmClient().generateJson('warmup', 'Reply with JSON only.', 'Return {"ok":true}.', z.object({ ok: z.boolean() }).strict());
    line(true, 'LLM', `responded in ${Date.now() - t0} ms`);
  } catch (e) {
    line(false, 'LLM', `${(e as Error).message}. Demo mode will use prescored fixtures.`);
  }
}

void main();
