import { normalizeQuote, verifyQuote, type QuoteContext, type QuoteLocation } from './quote';

/**
 * PURE. Everything numeric in scoring lives here. The LLM only PROPOSES per-criterion scores and
 * quotes; this module verifies them, forces unverified scores to 0, and computes totals.
 */
export type Authority = 'ai' | 'code' | 'human';

export interface JobCriterion {
  id: string;
  name: string;
  weight: number;
  description?: string;
}

export interface ProposedCriterion {
  criterionId: string;
  score: number;
  quote: string;
  confidence: number;
  missing: boolean;
  reason?: string;
}

export interface ScoredCriterion {
  criterionId: string;
  /** Integer 0-10. */
  score: number;
  quote: string;
  location: QuoteLocation | null;
  verified: boolean;
  confidence: number;
  missing: boolean;
  /** ai = AI proposed and code verified; code = code forced it (0); human = HR override. */
  authority: Authority;
  overriddenBy?: string;
  overrideReason?: string;
  originalScore?: number;
}

export interface ScoringSummary {
  /** 0-100, one decimal. */
  total: number;
  /** verified required skills / required skills, 0-1. */
  coverage: number;
  verifiedEvidenceCount: number;
  unverifiedCount: number;
  incomplete: boolean;
}

const clampScore = (n: number): number => Math.min(10, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));
const round1 = (n: number): number => Math.round((n + Number.EPSILON) * 10) / 10;

/** total = 10 * sum(weight_i * score_i) / sum(weight_i), rounded to 1 decimal, 0-100 scale. */
export function computeTotal(
  criteria: ReadonlyArray<{ id: string; weight: number }>,
  scores: ReadonlyArray<{ criterionId: string; score: number }>,
): number {
  const byId = new Map(scores.map((s) => [s.criterionId, s.score]));
  let num = 0;
  let den = 0;
  for (const c of criteria) {
    num += c.weight * clampScore(byId.get(c.id) ?? 0);
    den += c.weight;
  }
  return den > 0 ? round1((10 * num) / den) : 0;
}

/**
 * Applies code verification to the model's proposals, one result per JOB criterion (the model cannot
 * add or drop criteria). Missing evidence = 0 + missing. A quote that fails verification = 0 + unverified.
 */
export function applyVerification(
  criteria: ReadonlyArray<JobCriterion>,
  proposals: ReadonlyArray<ProposedCriterion>,
  redactedText: string,
  jobText: string,
): ScoredCriterion[] {
  const byId = new Map(proposals.map((p) => [p.criterionId, p]));
  return criteria.map((c): ScoredCriterion => {
    const p = byId.get(c.id);
    if (!p || p.missing) {
      return { criterionId: c.id, score: 0, quote: '', location: null, verified: false, confidence: p?.confidence ?? 0, missing: true, authority: 'code' };
    }
    const ctx: QuoteContext = { criterionName: c.name, jobText };
    const check = verifyQuote(p.quote, redactedText, ctx);
    if (!check.verified) {
      return { criterionId: c.id, score: 0, quote: p.quote, location: null, verified: false, confidence: p.confidence, missing: false, authority: 'code' };
    }
    return { criterionId: c.id, score: clampScore(p.score), quote: p.quote, location: check.location, verified: true, confidence: p.confidence, missing: false, authority: 'ai' };
  });
}

function containsSkill(normalizedText: string, skill: string): boolean {
  const s = normalizeQuote(skill);
  if (s.length === 0) return false;
  const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(normalizedText);
}

/** Coverage = verified required skills / total required skills. A skill is verified when a VERIFIED quote mentions it. */
export function computeCoverage(requiredSkills: ReadonlyArray<string>, scored: ReadonlyArray<ScoredCriterion>): number {
  if (requiredSkills.length === 0) return 1;
  const evidence = scored.filter((c) => c.verified).map((c) => normalizeQuote(c.quote)).join(' | ');
  const hit = requiredSkills.filter((s) => containsSkill(evidence, s)).length;
  return Math.round((hit / requiredSkills.length) * 1000) / 1000;
}

export function summarizeCandidate(
  criteria: ReadonlyArray<{ id: string; weight: number }>,
  scored: ReadonlyArray<ScoredCriterion>,
  requiredSkills: ReadonlyArray<string>,
): ScoringSummary {
  return {
    total: computeTotal(criteria, scored),
    coverage: computeCoverage(requiredSkills, scored),
    verifiedEvidenceCount: scored.filter((c) => c.verified).length,
    unverifiedCount: scored.filter((c) => !c.verified && !c.missing).length,
    incomplete: scored.some((c) => c.missing),
  };
}

export type ScoreFlag = 'unverified_evidence' | 'incomplete';

/** Badges derived from the scores. Incomplete candidates are scored on verified data only, never rejected. */
export function deriveFlags(summary: ScoringSummary): ScoreFlag[] {
  const flags: ScoreFlag[] = [];
  if (summary.unverifiedCount > 0) flags.push('unverified_evidence');
  if (summary.incomplete) flags.push('incomplete');
  return flags;
}

export const MIN_OVERRIDE_REASON = 10;

export class OverrideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverrideError';
  }
}

/** HR override: stores originalScore (first time only), authority "human", reason and who did it. */
export function applyOverride(
  scored: ReadonlyArray<ScoredCriterion>,
  criterionId: string,
  newScore: number,
  reason: string,
  userId: string,
): { updated: ScoredCriterion[]; previous: ScoredCriterion } {
  if (!Number.isInteger(newScore) || newScore < 0 || newScore > 10) throw new OverrideError('Score must be an integer from 0 to 10');
  if (reason.trim().length < MIN_OVERRIDE_REASON) throw new OverrideError(`Reason must be at least ${MIN_OVERRIDE_REASON} characters`);
  const previous = scored.find((c) => c.criterionId === criterionId);
  if (!previous) throw new OverrideError('Unknown criterion');
  const updated = scored.map((c) =>
    c.criterionId === criterionId
      ? { ...c, score: newScore, authority: 'human' as const, overriddenBy: userId, overrideReason: reason.trim(), originalScore: c.originalScore ?? c.score }
      : c,
  );
  return { updated, previous };
}
