import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = vi.hoisted(() => ({ list: [] as Record<string, unknown>[], failWrites: false, lastLimit: 0 }));

vi.mock('../../src/models/aiTrace.model', () => ({
  AiTraceModel: {
    create: vi.fn(async (row: Record<string, unknown>) => {
      if (rows.failWrites) throw new Error('db down');
      rows.list.push(row);
    }),
    find: vi.fn(() => ({
      sort: () => ({
        limit: (n: number) => {
          rows.lastLimit = n;
          return { lean: async () => rows.list.slice(0, n) };
        },
      }),
    })),
  },
}));

import { summarizeText, traceService } from '../../src/services/trace.service';

const JOB = 'a'.repeat(24);

beforeEach(() => {
  rows.list = [];
  rows.failWrites = false;
});

describe('traceService.wrap', () => {
  it('records a successful call with duration, model, promptId and tokens', async () => {
    const out = await traceService.wrap('run1', 'score', async () => ({ score: 7 }), 'resume: 120 chars', {
      jobId: JOB,
      promptId: 'score.v1',
      describe: () => ({ outputSummary: 'score=7', model: 'gemini-x', tokensIn: 100, tokensOut: 20 }),
    });
    expect(out).toEqual({ score: 7 });
    expect(rows.list).toHaveLength(1);
    expect(rows.list[0]).toMatchObject({
      runId: 'run1', tool: 'score', status: 'ok', model: 'gemini-x', promptId: 'score.v1', tokensIn: 100, tokensOut: 20, outputSummary: 'score=7',
    });
    expect(rows.list[0]!['durationMs']).toBeGreaterThanOrEqual(0);
  });

  it('records fallback status when the call reports it', async () => {
    await traceService.wrap('r', 'score', async () => 1, 'x', { jobId: JOB, describe: () => ({ status: 'fallback' }) });
    expect(rows.list[0]!['status']).toBe('fallback');
  });

  it('records failures and re-throws the original error', async () => {
    const boom = new Error('provider 500');
    await expect(traceService.wrap('r', 'parse_resume', async () => { throw boom; }, 'x', { jobId: JOB, model: 'm' })).rejects.toBe(boom);
    expect(rows.list[0]).toMatchObject({ status: 'error', error: 'provider 500', model: 'm', tool: 'parse_resume' });
  });

  it('never stores raw text: summarizeText keeps only length and a short hash', () => {
    const text = 'Jane Doe, 10 years of Rust, secret@email.com';
    const s = summarizeText('resume', text);
    expect(s).toContain(`${text.length} chars`);
    expect(s).not.toContain('Jane');
    expect(s).not.toContain('secret');
  });

  it('clips long summaries to 300 chars', async () => {
    await traceService.wrap('r', 't', async () => 1, 'x'.repeat(1000), { jobId: JOB });
    expect((rows.list[0]!['inputSummary'] as string).length).toBeLessThanOrEqual(300);
  });

  it('a failing trace write never breaks the traced call', async () => {
    rows.failWrites = true;
    await expect(traceService.wrap('r', 't', async () => 'fine', 'x', { jobId: JOB })).resolves.toBe('fine');
  });
});

describe('traceService.listForJob', () => {
  it('caps the limit at 100', async () => {
    await traceService.listForJob(JOB, 5000);
    expect(rows.lastLimit).toBe(100);
  });
});
