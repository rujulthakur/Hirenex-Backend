import { describe, expect, it } from 'vitest';
import {
  applyOverride,
  applyVerification,
  computeCoverage,
  computeTotal,
  deriveFlags,
  OverrideError,
  summarizeCandidate,
  type JobCriterion,
  type ProposedCriterion,
} from '../../src/domain/scoring';

const CRITERIA: JobCriterion[] = [
  { id: 'c1', name: 'Backend depth', weight: 50, description: '' },
  { id: 'c2', name: 'Databases', weight: 30, description: '' },
  { id: 'c3', name: 'Communication', weight: 20, description: '' },
];
const TEXT = 'Built Node.js services with Express for three years.\nDesigned MongoDB schemas and indexes for reporting.\nPresented weekly demos to stakeholders.';
const JOB_TEXT = 'Senior backend engineer role';

const proposal = (id: string, quote: string, score: number, over: Partial<ProposedCriterion> = {}): ProposedCriterion => ({
  criterionId: id, score, quote, confidence: 0.9, missing: false, ...over,
});

describe('computeTotal', () => {
  it('weights scores on a 0-100 scale', () => {
    expect(computeTotal(CRITERIA, [{ criterionId: 'c1', score: 10 }, { criterionId: 'c2', score: 10 }, { criterionId: 'c3', score: 10 }])).toBe(100);
    expect(computeTotal(CRITERIA, [{ criterionId: 'c1', score: 8 }, { criterionId: 'c2', score: 5 }, { criterionId: 'c3', score: 10 }])).toBe(75);
  });
  it('treats missing criteria as 0 and rounds to one decimal', () => {
    expect(computeTotal(CRITERIA, [{ criterionId: 'c1', score: 10 }])).toBe(50);
    expect(computeTotal([{ id: 'a', weight: 1 }, { id: 'b', weight: 2 }], [{ criterionId: 'a', score: 1 }, { criterionId: 'b', score: 1 }])).toBe(10);
    expect(computeTotal([{ id: 'a', weight: 1 }, { id: 'b', weight: 2 }], [{ criterionId: 'a', score: 10 }, { criterionId: 'b', score: 0 }])).toBe(33.3);
  });
  it('clamps out of range scores and handles zero weights', () => {
    expect(computeTotal([{ id: 'a', weight: 10 }], [{ criterionId: 'a', score: 99 }])).toBe(100);
    expect(computeTotal([{ id: 'a', weight: 0 }], [{ criterionId: 'a', score: 5 }])).toBe(0);
  });
});

describe('applyVerification (adversarial model output)', () => {
  it('forces a fabricated quote to score 0 and marks it unverified', () => {
    const out = applyVerification(CRITERIA, [proposal('c1', 'Won the Turing award for backend systems', 10)], TEXT, JOB_TEXT);
    const c1 = out.find((c) => c.criterionId === 'c1')!;
    expect(c1).toMatchObject({ score: 0, verified: false, authority: 'code', missing: false });
    expect(deriveFlags(summarizeCandidate(CRITERIA, out, []))).toContain('unverified_evidence');
  });
  it('keeps a real quote with its score and location', () => {
    const out = applyVerification(CRITERIA, [proposal('c2', 'Designed MongoDB schemas and indexes', 8)], TEXT, JOB_TEXT);
    const c2 = out.find((c) => c.criterionId === 'c2')!;
    expect(c2).toMatchObject({ score: 8, verified: true, authority: 'ai' });
    expect(TEXT.slice(c2.location!.start, c2.location!.end)).toBe('Designed MongoDB schemas and indexes');
  });
  it('model cannot add or drop criteria: one result per job criterion', () => {
    const out = applyVerification(CRITERIA, [proposal('zzz', 'Built Node.js services with Express', 10)], TEXT, JOB_TEXT);
    expect(out.map((c) => c.criterionId)).toEqual(['c1', 'c2', 'c3']);
    expect(out.every((c) => c.missing)).toBe(true);
  });
  it('missing evidence is score 0 + missing, and the candidate is badged incomplete, not rejected', () => {
    const out = applyVerification(CRITERIA, [proposal('c1', 'Built Node.js services with Express', 9), proposal('c2', '', 0, { missing: true })], TEXT, JOB_TEXT);
    const s = summarizeCandidate(CRITERIA, out, []);
    expect(s.incomplete).toBe(true);
    expect(s.total).toBe(45);
    expect(deriveFlags(s)).toEqual(['incomplete']);
  });
});

describe('coverage and evidence counts', () => {
  it('counts required skills mentioned in VERIFIED quotes only', () => {
    const out = applyVerification(
      CRITERIA,
      [proposal('c1', 'Built Node.js services with Express', 9), proposal('c2', 'Invented MongoDB mastery claim here', 9)],
      TEXT,
      JOB_TEXT,
    );
    expect(computeCoverage(['Node.js', 'MongoDB'], out)).toBe(0.5);
    expect(computeCoverage([], out)).toBe(1);
    expect(summarizeCandidate(CRITERIA, out, ['Node.js']).verifiedEvidenceCount).toBe(1);
  });
});

describe('applyOverride', () => {
  const base = applyVerification(CRITERIA, [proposal('c1', 'Built Node.js services with Express', 6)], TEXT, JOB_TEXT);
  it('stores originalScore once, authority human, and recomputes the total', () => {
    const { updated, previous } = applyOverride(base, 'c1', 9, 'Reviewed portfolio, clearly stronger', 'u1');
    expect(previous.score).toBe(6);
    const c1 = updated.find((c) => c.criterionId === 'c1')!;
    expect(c1).toMatchObject({ score: 9, authority: 'human', originalScore: 6, overriddenBy: 'u1' });
    expect(computeTotal(CRITERIA, updated)).toBe(45);
    const again = applyOverride(updated, 'c1', 7, 'Second look, slightly lower score', 'u1').updated.find((c) => c.criterionId === 'c1')!;
    expect(again.originalScore).toBe(6);
  });
  it('rejects short reasons, bad scores and unknown criteria', () => {
    expect(() => applyOverride(base, 'c1', 9, 'short', 'u1')).toThrow(OverrideError);
    expect(() => applyOverride(base, 'c1', 11, 'long enough reason here', 'u1')).toThrow(OverrideError);
    expect(() => applyOverride(base, 'c1', 5.5, 'long enough reason here', 'u1')).toThrow(OverrideError);
    expect(() => applyOverride(base, 'nope', 5, 'long enough reason here', 'u1')).toThrow(OverrideError);
  });
});
