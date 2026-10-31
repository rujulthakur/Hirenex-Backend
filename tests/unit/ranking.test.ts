import { describe, expect, it } from 'vitest';
import { computeTotal } from '../../src/domain/scoring';
import { cutShortlist, rankCandidates, type RankInput } from '../../src/domain/ranking';

const c = (id: string, over: Partial<RankInput> = {}): RankInput => ({ id, total: 70, coverage: 0.5, verifiedEvidenceCount: 3, yearsExperience: 4, uploadOrder: 1, ...over });

describe('rankCandidates tie rule', () => {
  it('orders by total desc first', () => {
    expect(rankCandidates([c('a', { total: 60 }), c('b', { total: 80 })]).map((r) => r.id)).toEqual(['b', 'a']);
  });
  it('then coverage, evidence count, years, then earliest upload', () => {
    const steps: Array<[Partial<RankInput>, Partial<RankInput>, string]> = [
      [{ coverage: 0.9 }, { coverage: 0.5 }, 'required-skill coverage'],
      [{ verifiedEvidenceCount: 6 }, { verifiedEvidenceCount: 3 }, 'verified evidence count'],
      [{ yearsExperience: 9 }, { yearsExperience: 4 }, 'years of experience'],
      [{ uploadOrder: 1 }, { uploadOrder: 2 }, 'upload order'],
    ];
    for (const [better, worse, step] of steps) {
      const out = rankCandidates([c('worse', worse), c('better', better)]);
      expect(out[0]!.id).toBe('better');
      expect(out[0]!.tieBreakTrace.join(' ')).toContain(step);
      expect(out[1]!.tieBreakTrace.join(' ')).toContain(step);
    }
  });
  it('gives no tie trace when totals differ', () => {
    expect(rankCandidates([c('a', { total: 61 }), c('b', { total: 62 })]).every((r) => r.tieBreakTrace.length === 0)).toBe(true);
  });
  it('rank is 1-based and contiguous', () => {
    expect(rankCandidates([c('a'), c('b', { uploadOrder: 2 }), c('d', { uploadOrder: 3 })]).map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});

/** Small seeded PRNG so the property test is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('property: ranking is deterministic and order independent', () => {
  it('same input, any input order -> identical output (200 random cases)', () => {
    const rnd = mulberry32(42);
    for (let run = 0; run < 200; run++) {
      const n = 2 + Math.floor(rnd() * 25);
      const list: RankInput[] = Array.from({ length: n }, (_, i) => ({
        id: `id${i}`,
        total: Math.floor(rnd() * 4) * 10, // many ties on purpose
        coverage: Math.floor(rnd() * 3) / 2,
        verifiedEvidenceCount: Math.floor(rnd() * 3),
        yearsExperience: Math.floor(rnd() * 3),
        uploadOrder: i + 1,
      }));
      const shuffled = [...list].sort(() => rnd() - 0.5);
      const a = rankCandidates(list);
      expect(rankCandidates(list)).toEqual(a);
      expect(rankCandidates(shuffled).map((r) => r.id)).toEqual(a.map((r) => r.id));
      for (let i = 1; i < a.length; i++) expect(a[i - 1]!.total).toBeGreaterThanOrEqual(a[i]!.total);
    }
  });
});

describe('cutShortlist', () => {
  it('cuts at capacity then takes the next waitlistSize', () => {
    const ranked = rankCandidates(Array.from({ length: 10 }, (_, i) => c(`c${i}`, { total: 100 - i })));
    const cut = cutShortlist(ranked, 3, 2);
    expect(cut.shortlist.map((r) => r.id)).toEqual(['c0', 'c1', 'c2']);
    expect(cut.waitlist.map((r) => r.id)).toEqual(['c3', 'c4']);
  });
  it('handles a short list and zero waitlist', () => {
    const ranked = rankCandidates([c('a'), c('b', { uploadOrder: 2 })]);
    expect(cutShortlist(ranked, 5, 3)).toEqual({ shortlist: ranked, waitlist: [] });
    expect(cutShortlist(ranked, 1, 0).waitlist).toEqual([]);
  });
});

describe('rerank equivalence (pure maths behind POST /rerank)', () => {
  const criteria = [{ id: 'x', weight: 50 }, { id: 'y', weight: 50 }];
  const scores = { a: [{ criterionId: 'x', score: 10 }, { criterionId: 'y', score: 2 }], b: [{ criterionId: 'x', score: 4 }, { criterionId: 'y', score: 9 }] };
  const order = (w: { x: number; y: number }): string[] =>
    rankCandidates(
      (['a', 'b'] as const).map((id, i) => c(id, { total: computeTotal([{ id: 'x', weight: w.x }, { id: 'y', weight: w.y }], scores[id]), uploadOrder: i + 1 })),
    ).map((r) => r.id);
  it('unchanged weights reproduce the stored order; shifted weights can flip it, with no LLM involved', () => {
    expect(computeTotal(criteria, scores.a)).toBe(60);
    expect(order({ x: 50, y: 50 })).toEqual(['b', 'a'].sort((p, q) => computeTotal(criteria, scores[q as 'a']) - computeTotal(criteria, scores[p as 'a'])));
    expect(order({ x: 90, y: 10 })).toEqual(['a', 'b']);
    expect(order({ x: 10, y: 90 })).toEqual(['b', 'a']);
  });
});
