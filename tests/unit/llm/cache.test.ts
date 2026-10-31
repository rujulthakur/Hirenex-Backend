import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const h = vi.hoisted(() => ({
  env: { DEMO_MODE: false, LLM_PROVIDER: 'gemini', LLM_MODEL: 'm' } as Record<string, unknown>,
  findCacheHit: vi.fn(),
  traces: [] as Array<{ tool: string; report: Record<string, unknown> }>,
}));

vi.mock('../../../src/config/env', () => ({ env: h.env }));
vi.mock('../../../src/repositories/score.repository', () => ({ scoreRepository: { findCacheHit: h.findCacheHit } }));
vi.mock('../../../src/services/trace.service', () => ({
  summarizeText: (label: string, text: string) => `${label}: ${text.length} chars`,
  traceService: {
    wrap: async (_run: string, tool: string, fn: () => Promise<unknown>, _in: string, meta: { describe?: (r: unknown) => Record<string, unknown> }) => {
      const result = await fn();
      h.traces.push({ tool, report: meta.describe?.(result) ?? {} });
      return result;
    },
  },
}));

import { computeCacheKey, computeCriteriaHash } from '../../../src/domain/cacheKey';
import { setLlmClient } from '../../../src/integrations/llm';
import { createMockLlmClient } from '../../../src/integrations/llm/mock';
import { setPrescoredForTests } from '../../../src/integrations/llm/prescored';
import { LlmSchemaError, type LlmClient } from '../../../src/integrations/llm/types';
import { proposeScores, type ScoreRequest } from '../../../src/services/llmScoring.service';
import { AiUnavailableError } from '../../../src/utils/errors';

const criteria = [
  { id: 'c1', name: 'Backend', weight: 50, description: 'Node services' },
  { id: 'c2', name: 'Databases', weight: 50, description: 'MongoDB usage' },
];
const RESUME = 'Built Node.js services with MongoDB for five years.';

function req(over: Partial<ScoreRequest> = {}): ScoreRequest {
  return {
    jobId: '64b000000000000000000001',
    runId: 'run1',
    textHash: 'hash1',
    redactedText: RESUME,
    jobTitle: 'Backend Engineer',
    criteria,
    criteriaHash: computeCriteriaHash(criteria),
    requiredSkills: ['Node.js'],
    preferredSkills: [],
    nonce: 'abc123',
    ...over,
  };
}

const validRaw = {
  skills: ['Node.js'],
  yearsExperience: 5,
  projects: [],
  criteria: [{ criterionId: 'c1', score: 7, quote: 'Built Node.js services', confidence: 0.9, missing: false, reason: 'ok' }],
};

beforeEach(() => {
  h.env.DEMO_MODE = false;
  h.findCacheHit.mockReset();
  h.findCacheHit.mockResolvedValue(null);
  h.traces.length = 0;
  setPrescoredForTests({});
  setLlmClient(null);
});

describe('cache key', () => {
  const base = { redactedText: 'text', criteriaHash: 'ch', promptId: 'p1', model: 'm1' };
  it('is deterministic', () => {
    expect(computeCacheKey(base)).toBe(computeCacheKey({ ...base }));
    expect(computeCacheKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });
  it.each([
    ['text', { redactedText: 'other' }],
    ['criteria', { criteriaHash: 'other' }],
    ['prompt version', { promptId: 'p2' }],
    ['model', { model: 'm2' }],
  ])('changes when %s changes', (_n, change) => {
    expect(computeCacheKey({ ...base, ...change })).not.toBe(computeCacheKey(base));
  });
  it('separator prevents boundary collisions', () => {
    expect(computeCacheKey({ ...base, redactedText: 'ab', criteriaHash: 'c' })).not.toBe(
      computeCacheKey({ ...base, redactedText: 'a', criteriaHash: 'bc' }),
    );
  });
  it('criteria hash ignores order but not weights', () => {
    expect(computeCriteriaHash([...criteria].reverse())).toBe(computeCriteriaHash(criteria));
    expect(computeCriteriaHash([{ ...criteria[0]!, weight: 60 }, criteria[1]!])).not.toBe(computeCriteriaHash(criteria));
  });
});

describe('proposeScores: cache', () => {
  it('MISS calls the LLM once and returns source llm with the computed cache key', async () => {
    const mock = createMockLlmClient();
    setLlmClient(mock);
    const res = await proposeScores(req());
    expect(res.status).toBe('scored');
    if (res.status !== 'scored') return;
    expect(res.source).toBe('llm');
    expect(mock.calls).toHaveLength(1);
    expect(res.cacheKey).toBe(computeCacheKey({ redactedText: RESUME, criteriaHash: computeCriteriaHash(criteria), promptId: 'extract_and_score_v1', model: 'mock-model' }));
    expect(res.usage.tokensIn).toBeGreaterThan(0);
  });

  it('HIT skips the LLM and reports cachedFrom', async () => {
    const mock = createMockLlmClient();
    setLlmClient(mock);
    h.findCacheHit.mockResolvedValue({ id: 'score123', rawOutput: validRaw, model: 'mock-model', promptId: 'extract_and_score_v1' });
    const res = await proposeScores(req());
    expect(mock.calls).toHaveLength(0);
    expect(res.status === 'scored' && res.source).toBe('cache');
    expect(res.status === 'scored' && res.cachedFrom).toBe('score123');
    expect(h.traces[0]!.report.outputSummary).toContain('cache hit');
  });

  it('ignores a corrupt cached document and calls the LLM', async () => {
    const mock = createMockLlmClient();
    setLlmClient(mock);
    h.findCacheHit.mockResolvedValue({ id: 'bad', rawOutput: { nope: true }, model: 'x', promptId: 'y' });
    const res = await proposeScores(req());
    expect(mock.calls).toHaveLength(1);
    expect(res.status === 'scored' && res.source).toBe('llm');
  });

  it('bypassCache never reads the cache (swap test needs a fresh rescore)', async () => {
    const mock = createMockLlmClient();
    setLlmClient(mock);
    h.findCacheHit.mockResolvedValue({ id: 'score123', rawOutput: validRaw, model: 'mock-model', promptId: 'x' });
    const res = await proposeScores(req({ bypassCache: true }));
    expect(h.findCacheHit).not.toHaveBeenCalled();
    expect(mock.calls).toHaveLength(1);
    expect(res.status === 'scored' && res.source).toBe('llm');
  });
});

describe('proposeScores: failure handling', () => {
  const failing = (err: Error): LlmClient => ({
    provider: 'mock',
    generateJson: async <T,>(): Promise<never> => {
      throw err;
    },
  });

  it('schema failure becomes needs_review, never a guessed score', async () => {
    setLlmClient(failing(new LlmSchemaError('extract_and_score_v1', ['criteria.0.score: Expected number'])));
    const res = await proposeScores(req());
    expect(res.status).toBe('needs_review');
    expect(res.status === 'needs_review' && res.reason).toContain('criteria.0.score');
  });

  it('AI_UNAVAILABLE outside demo mode is rethrown', async () => {
    setLlmClient(failing(new AiUnavailableError()));
    await expect(proposeScores(req())).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('AI_UNAVAILABLE in demo mode uses the prescored fixture and says so in the trace', async () => {
    h.env.DEMO_MODE = true;
    setPrescoredForTests({ hash1: validRaw as never });
    setLlmClient(failing(new AiUnavailableError()));
    const res = await proposeScores(req());
    expect(res.status === 'scored' && res.source).toBe('prescored');
    const t = h.traces.at(-1)!;
    expect(t.report.status).toBe('fallback');
    expect(String(t.report.outputSummary)).toContain('prescored');
  });

  it('demo mode without a fixture still throws', async () => {
    h.env.DEMO_MODE = true;
    setLlmClient(failing(new AiUnavailableError()));
    await expect(proposeScores(req({ textHash: 'unknown' }))).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('passes token usage to the trace report', async () => {
    setLlmClient(createMockLlmClient());
    await proposeScores(req());
    const t = h.traces.at(-1)!;
    expect(t.tool).toBe('score');
    expect(t.report.tokensIn).toBeGreaterThan(0);
    expect(t.report.tokensOut).toBe(100);
    expect(z.string().safeParse(t.report.outputSummary).success).toBe(true);
  });
});
