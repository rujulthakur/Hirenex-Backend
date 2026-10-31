/**
 * PURE and stable. Tie rule (shown on screen):
 *   total score desc, then required-skill coverage desc, then verified evidence count desc,
 *   then years of experience desc, then upload order asc (earliest upload wins).
 * Same input always gives the same output. Candidate id is a last deterministic guard only.
 */
export const TIE_RULE_TEXT =
  'Ranked by total score, then required-skill coverage, then verified evidence count, then years of experience, then upload order.';

export interface RankInput {
  id: string;
  total: number;
  coverage: number;
  verifiedEvidenceCount: number;
  yearsExperience: number;
  uploadOrder: number;
}

export interface Ranked extends RankInput {
  /** 1-based position. */
  rank: number;
  /** One line per neighbour this candidate tied with on total, naming the step that decided it. */
  tieBreakTrace: string[];
}

interface Step {
  name: string;
  /** Negative when a should rank above b. */
  cmp: (a: RankInput, b: RankInput) => number;
  describe: (a: RankInput, b: RankInput) => string;
}

const STEPS: readonly Step[] = [
  { name: 'required-skill coverage', cmp: (a, b) => b.coverage - a.coverage, describe: (a, b) => `${a.coverage} vs ${b.coverage}` },
  { name: 'verified evidence count', cmp: (a, b) => b.verifiedEvidenceCount - a.verifiedEvidenceCount, describe: (a, b) => `${a.verifiedEvidenceCount} vs ${b.verifiedEvidenceCount}` },
  { name: 'years of experience', cmp: (a, b) => b.yearsExperience - a.yearsExperience, describe: (a, b) => `${a.yearsExperience} vs ${b.yearsExperience}` },
  { name: 'upload order', cmp: (a, b) => a.uploadOrder - b.uploadOrder, describe: (a, b) => `#${a.uploadOrder} vs #${b.uploadOrder}` },
];

export function compareCandidates(a: RankInput, b: RankInput): number {
  if (a.total !== b.total) return b.total - a.total;
  for (const step of STEPS) {
    const c = step.cmp(a, b);
    if (c !== 0) return c;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The first step (after total) that separates a from b, or null if total already did. */
function decidingStep(a: RankInput, b: RankInput): string {
  if (a.total !== b.total) return 'total score';
  for (const step of STEPS) {
    if (step.cmp(a, b) !== 0) return `${step.name} (${step.describe(a, b)})`;
  }
  return 'candidate id';
}

export function rankCandidates(input: ReadonlyArray<RankInput>): Ranked[] {
  const sorted = [...input].sort(compareCandidates);
  return sorted.map((c, i) => {
    const trace: string[] = [];
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    if (prev && prev.total === c.total) trace.push(`Tied on total ${c.total} with rank ${i}; decided by ${decidingStep(c, prev)}`);
    if (next && next.total === c.total) trace.push(`Tied on total ${c.total} with rank ${i + 2}; decided by ${decidingStep(c, next)}`);
    return { ...c, rank: i + 1, tieBreakTrace: trace };
  });
}

export interface ShortlistCut<T> {
  shortlist: T[];
  waitlist: T[];
}

/** Cuts an already ranked list at capacity, then takes the next waitlistSize as the waitlist. */
export function cutShortlist<T>(ranked: ReadonlyArray<T>, capacity: number, waitlistSize: number): ShortlistCut<T> {
  const cap = Math.max(0, capacity);
  return {
    shortlist: ranked.slice(0, cap),
    waitlist: ranked.slice(cap, cap + Math.max(0, waitlistSize)),
  };
}
