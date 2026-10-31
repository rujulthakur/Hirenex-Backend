import { describe, expect, it } from 'vitest';
import { computeTrustMeter, computeUtilization, normalizeFunnel, normalizeTimeInStage } from '../../src/domain/analytics';
import { findNearDuplicates, jaccard, shingles } from '../../src/domain/duplicates';
import { BIAS_CAVEAT, computeImpact } from '../../src/domain/impactRatio';
import { detectFlips, nearCutoff } from '../../src/domain/stability';
import { compareRedactions, scoreDelta, swapIdentity, SWAP_LIMIT_NOTE } from '../../src/domain/swap';

const RESUME_A = [
  'Priya Sharma',
  'priya.sharma@example.com | +91 98765 43210',
  'Summary',
  'She is a backend engineer. Her work focuses on Node.js and MongoDB services.',
  'Experience',
  'Senior Engineer at Acme Corp 2019 - 2023. Built REST APIs in Node.js and cut p95 latency by 40 percent.',
  'Skills',
  'Node.js, MongoDB, Redis, TypeScript',
].join('\n');

describe('swap test', () => {
  it('swaps the name and gender words with a fixed neutral mapping', () => {
    const s = swapIdentity(RESUME_A, 'Priya_Sharma_resume.pdf');
    expect(s.swappedText).not.toMatch(/\b(she|her)\b/i);
    expect(s.swappedText).toContain('They');
    expect(s.swappedText).toContain('Alex Morgan');
    expect(s.swappedText).not.toContain('Priya');
    expect(s.genderWordsSwapped).toBeGreaterThanOrEqual(2);
  });
  it('reports hash equality when identity fields do not survive redaction', () => {
    const r = compareRedactions(RESUME_A, 'Priya_Sharma_resume.pdf');
    expect(r.originalHash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof r.redactedIdentical).toBe('boolean');
    if (r.redactedIdentical) expect(r.originalHash).toBe(r.swappedHash);
  });
  it('delta is honest: non-zero stays non-zero, rounded to 2 places', () => {
    expect(scoreDelta(80, 80)).toBe(0);
    expect(scoreDelta(80, 77.5)).toBe(-2.5);
    expect(scoreDelta(61.111, 62.2)).toBe(1.09);
  });
  it('limit note is the fixed sentence', () => {
    expect(SWAP_LIMIT_NOTE).toBe('This shows identity fields do not reach the scorer; it does not prove all bias is removed.');
  });
});

describe('impact ratio (hand-computed fixtures)', () => {
  it('A 6/10 = 0.6 (highest), B 3/10 = 0.3 -> ratio 0.5 flagged, A ratio 1', () => {
    const p = computeImpact([{ group: 'A', total: 10, shortlisted: 6 }, { group: 'B', total: 10, shortlisted: 3 }]);
    const a = p.groups.find((g) => g.group === 'A')!;
    const b = p.groups.find((g) => g.group === 'B')!;
    expect(a).toMatchObject({ selectionRate: 0.6, ratioToHighest: 1, flagged: false });
    expect(b).toMatchObject({ selectionRate: 0.3, ratioToHighest: 0.5, flagged: true });
    expect(p.highestGroup).toBe('A');
    expect(p.caveat).toBe(BIAS_CAVEAT);
  });
  it('exactly 0.8 is NOT flagged; just below is', () => {
    const ok = computeImpact([{ group: 'A', total: 10, shortlisted: 5 }, { group: 'B', total: 10, shortlisted: 4 }]);
    expect(ok.groups.find((g) => g.group === 'B')).toMatchObject({ ratioToHighest: 0.8, flagged: false });
    const bad = computeImpact([{ group: 'A', total: 100, shortlisted: 50 }, { group: 'B', total: 100, shortlisted: 39 }]);
    expect(bad.groups.find((g) => g.group === 'B')?.flagged).toBe(true);
  });
  it('marks groups under 5 candidates as small samples and handles nobody selected', () => {
    const p = computeImpact([{ group: 'A', total: 3, shortlisted: 0 }, { group: 'B', total: 6, shortlisted: 0 }]);
    expect(p.groups.every((g) => !g.flagged)).toBe(true);
    expect(p.groups.find((g) => g.group === 'A')?.smallSample).toBe(true);
    expect(p.groups.find((g) => g.group === 'B')?.smallSample).toBe(false);
    expect(p.highestGroup).toBeNull();
  });
  it('empty group counts are safe', () => {
    expect(computeImpact([]).groups).toEqual([]);
  });
});

describe('analytics shaping', () => {
  it('funnel fills every stage with zero and ignores unknown stages', () => {
    const f = normalizeFunnel([{ _id: 'applied', n: 4 }, { _id: 'shortlisted', n: 2 }, { _id: 'weird', n: 9 }]);
    expect(f).toEqual({ applied: 4, scored: 0, shortlisted: 2, waitlisted: 0, invited: 0, confirmed: 0, declined: 0 });
  });
  it('time in stage converts ms to hours', () => {
    expect(normalizeTimeInStage([{ _id: 'scored', avgMs: 5_400_000 }]).scored).toBe(1.5);
  });
  it('utilization = booked / total per interviewer per day', () => {
    const u = computeUtilization([
      { interviewerId: 'B', day: '2026-11-04', booked: 3, total: 4 },
      { interviewerId: 'A', day: '2026-11-04', booked: 1, total: 3 },
      { interviewerId: 'A', day: '2026-11-05', booked: 0, total: 0 },
    ]);
    expect(u.map((r) => [r.interviewerId, r.day, r.utilization])).toEqual([['A', '2026-11-04', 0.33], ['A', '2026-11-05', 0], ['B', '2026-11-04', 0.75]]);
  });
  it('trust meter percentage counts only proposed quotes', () => {
    expect(computeTrustMeter({ verifiedQuotes: 45, proposedQuotes: 60, openFlags: 7, injections: 2, hiddenText: 1 })).toEqual({ verifiedQuotePct: 75, openFlags: 7, injectionsCaught: 2, hiddenTextCaught: 1 });
    expect(computeTrustMeter({ verifiedQuotes: 0, proposedQuotes: 0, openFlags: 0, injections: 0, hiddenText: 0 }).verifiedQuotePct).toBe(0);
  });
});

describe('P2: duplicates and stability', () => {
  const base = 'senior engineer built rest apis in node js and cut latency by forty percent while mentoring a team of five engineers across two squads';
  it('flags near duplicates only, not unrelated resumes', () => {
    const pairs = findNearDuplicates([
      { id: 'a', text: base },
      { id: 'b', text: `${base} extra` },
      { id: 'c', text: 'completely different content about marketing campaigns and brand strategy for consumer goods in several regions' },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: 'a', b: 'b' });
    expect(jaccard(shingles(base), shingles(base))).toBe(1);
  });
  it('picks candidates within 2 points of the cutoff and detects flips', () => {
    const ranked = [{ id: 'a', total: 90 }, { id: 'b', total: 80 }, { id: 'c', total: 79 }, { id: 'd', total: 70 }];
    expect(nearCutoff(ranked, 2)).toEqual(['b', 'c']);
    const flips = detectFlips(80, [{ id: 'b', total: 80 }, { id: 'c', total: 79 }], [{ id: 'b', total: 78 }, { id: 'c', total: 79.5 }]);
    expect(flips.map((f) => [f.id, f.flipped])).toEqual([['b', true], ['c', false]]);
  });
});
