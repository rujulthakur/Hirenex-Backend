import { describe, expect, it } from 'vitest';
import { buildMeta, paginationQuerySchema, parseSort, toPageOptions } from '../../src/utils/pagination';

describe('pagination helper', () => {
  it('applies defaults and coerces strings', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(paginationQuerySchema.parse({ page: '3', limit: '50' })).toMatchObject({ page: 3, limit: 50 });
  });

  it('rejects limits above the cap', () => {
    expect(paginationQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
  });

  it('computes skip and meta', () => {
    expect(toPageOptions({ page: 3, limit: 20 }).skip).toBe(40);
    expect(buildMeta(3, 20, 95)).toEqual({ page: 3, limit: 20, total: 95 });
  });

  it('parses allow-listed sort fields only', () => {
    const allowed = ['totalScore', 'rank'];
    const fallback = { rank: 1 } as const;
    expect(parseSort('-totalScore,rank', allowed, fallback)).toEqual({ totalScore: -1, rank: 1 });
    expect(parseSort('-secretField', allowed, fallback)).toEqual(fallback);
    expect(parseSort(undefined, allowed, fallback)).toEqual(fallback);
  });
});
