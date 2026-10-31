import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLlmClient } from '../../../src/integrations/llm/gatewayClient';
import { extractJson } from '../../../src/integrations/llm/jsonExtract';
import { createScriptedTransport, httpError } from '../../../src/integrations/llm/mock';
import { backoffDelay, isRetryableError } from '../../../src/integrations/llm/retry';
import { LlmSchemaError, type LlmTransport } from '../../../src/integrations/llm/types';
import { AiUnavailableError } from '../../../src/utils/errors';

const schema = z.object({ a: z.number() }).strict();
const noSleep = (): Promise<void> => Promise.resolve();

function client(script: Array<string | Error>, sleep = noSleep) {
  const transport = createScriptedTransport(script);
  return { transport, llm: createLlmClient(transport, { sleep, random: () => 0.5 }) };
}

describe('gateway: success paths', () => {
  it('returns validated data, model and usage', async () => {
    const { llm, transport } = client(['{"a":1}']);
    const res = await llm.generateJson('p', 'sys', 'user', schema);
    expect(res.data).toEqual({ a: 1 });
    expect(res.model).toBe('scripted-model');
    expect(res.usage).toEqual({ tokensIn: 10, tokensOut: 5 });
    expect(transport.callCount()).toBe(1);
    expect(transport.requests[0]!.json).toBe(true);
  });

  it('accepts JSON wrapped in markdown fences or prose', async () => {
    const { llm } = client(['Here you go:\n```json\n{"a": 2}\n```']);
    expect((await llm.generateJson('p', 's', 'u', schema)).data.a).toBe(2);
  });
});

describe('gateway: schema failure handling', () => {
  it('retries ONCE with the validation errors, then succeeds', async () => {
    const { llm, transport } = client(['{"a":"not a number"}', '{"a":1}']);
    const res = await llm.generateJson('p', 's', 'original user prompt', schema);
    expect(res.data.a).toBe(1);
    expect(transport.callCount()).toBe(2);
    expect(transport.requests[1]!.user).toContain('original user prompt');
    expect(transport.requests[1]!.user).toContain('rejected because');
    expect(res.usage).toEqual({ tokensIn: 20, tokensOut: 10 });
  });

  it('throws LlmSchemaError after the second failure (caller marks needs_review)', async () => {
    const { llm, transport } = client(['{"a":"x"}', '{"a":"y"}']);
    await expect(llm.generateJson('p', 's', 'u', schema)).rejects.toBeInstanceOf(LlmSchemaError);
    expect(transport.callCount()).toBe(2);
  });

  it('rejects extra keys (strict schema)', async () => {
    const { llm } = client(['{"a":1,"extra":true}', '{"a":1,"extra":true}']);
    await expect(llm.generateJson('p', 's', 'u', schema)).rejects.toBeInstanceOf(LlmSchemaError);
  });

  it('treats non-JSON text as a schema failure, not as unavailable', async () => {
    const { llm } = client(['I cannot do that.', 'Still no JSON.']);
    await expect(llm.generateJson('p', 's', 'u', schema)).rejects.toBeInstanceOf(LlmSchemaError);
  });
});

describe('gateway: retry behaviour', () => {
  it('retries on 429 then succeeds, sleeping once', async () => {
    const sleep = vi.fn(noSleep);
    const { llm, transport } = client([httpError(429), '{"a":1}'], sleep);
    expect((await llm.generateJson('p', 's', 'u', schema)).data.a).toBe(1);
    expect(transport.callCount()).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('retries on network errors (status 0)', async () => {
    const { llm, transport } = client([httpError(0), httpError(0), '{"a":1}']);
    await llm.generateJson('p', 's', 'u', schema);
    expect(transport.callCount()).toBe(3);
  });

  it('gives up after 3 retries (4 calls) with AI_UNAVAILABLE', async () => {
    const { llm, transport } = client([httpError(500)]);
    const err = await llm.generateJson('p', 's', 'u', schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect((err as AiUnavailableError).code).toBe('AI_UNAVAILABLE');
    expect(transport.callCount()).toBe(4);
  });

  it('does not retry other 4xx errors', async () => {
    const { llm, transport } = client([httpError(400)]);
    await expect(llm.generateJson('p', 's', 'u', schema)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(transport.callCount()).toBe(1);
  });

  it('isRetryableError and backoffDelay behave', () => {
    expect(isRetryableError(httpError(429))).toBe(true);
    expect(isRetryableError(httpError(503))).toBe(true);
    expect(isRetryableError(httpError(0))).toBe(true);
    expect(isRetryableError(httpError(401))).toBe(false);
    expect(isRetryableError(new Error('x'))).toBe(false);
    expect(backoffDelay(0, 500, 8000, () => 0.999)).toBeLessThan(500);
    expect(backoffDelay(10, 500, 8000, () => 0.999)).toBeLessThan(8000);
    expect(backoffDelay(3, 500, 8000, () => 0)).toBe(0);
  });
});

describe('gateway: concurrency limit', () => {
  it('never runs more than 3 provider calls at once', async () => {
    let active = 0;
    let peak = 0;
    const transport: LlmTransport = {
      provider: 't',
      model: 'm',
      async complete() {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 15));
        active -= 1;
        return { text: '{"a":1}', usage: { tokensIn: 1, tokensOut: 1 }, model: 'm' };
      },
    };
    const llm = createLlmClient(transport, { sleep: noSleep });
    await Promise.all(Array.from({ length: 10 }, () => llm.generateJson('p', 's', 'u', schema)));
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
});

describe('extractJson', () => {
  it.each([
    ['plain', '{"a":1}', { a: 1 }],
    ['fenced', '```json\n{"a":1}\n```', { a: 1 }],
    ['prose around', 'Sure! {"a":1} Hope that helps.', { a: 1 }],
    ['braces inside strings', 'x {"a":"}{ tricky"} y', { a: '}{ tricky' }],
    ['array', 'result: [1,2,3]', [1, 2, 3]],
  ])('%s', (_n, raw, expected) => {
    expect(extractJson(raw)).toEqual(expected);
  });

  it('throws when there is no JSON', () => {
    expect(() => extractJson('no json here')).toThrow(SyntaxError);
  });
});
