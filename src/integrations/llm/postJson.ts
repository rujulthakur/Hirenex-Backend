import { LlmHttpError } from './types';

/**
 * POST JSON with a hard timeout. Network errors and timeouts become LlmHttpError(status 0) so the
 * retry layer treats them as retryable. Error messages never include headers (API keys) or the
 * request body (resume text).
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LlmHttpError(res.status, `Provider returned HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as unknown;
  } catch (err) {
    if (err instanceof LlmHttpError) throw err;
    const reason = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network error';
    throw new LlmHttpError(0, `Provider call failed: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}
