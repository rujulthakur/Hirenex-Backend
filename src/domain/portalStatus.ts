/**
 * PURE. Candidate-facing status in plain language. Built from VERIFIED scores only (a quote the code found in the
 * resume). It never exposes raw numbers, ranks, weights or other candidates. "humanReviewed" is passed in and is
 * true only when HR opened or overrode the evidence.
 */
export const MATCH_MIN_SCORE = 6;

export interface PortalCriterion {
  id: string;
  name: string;
}
export interface PortalScore {
  criterionId: string;
  score: number;
  verified: boolean;
  missing: boolean;
}

export interface PortalStatus {
  matched: string[];
  missing: string[];
  humanReviewed: boolean;
  summary: string;
}

export function buildPortalStatus(criteria: ReadonlyArray<PortalCriterion>, scores: ReadonlyArray<PortalScore>, humanReviewed: boolean): PortalStatus {
  const byId = new Map(scores.map((s) => [s.criterionId, s]));
  const matched: string[] = [];
  const missing: string[] = [];
  for (const c of criteria) {
    const s = byId.get(c.id);
    const ok = !!s && s.verified && !s.missing && s.score >= MATCH_MIN_SCORE;
    (ok ? matched : missing).push(c.name);
  }
  const summary =
    matched.length === 0
      ? 'We could not yet find clear evidence for the main skills of this role in your resume.'
      : missing.length === 0
        ? 'Your resume clearly showed evidence for all the skills we looked for.'
        : `Your resume clearly showed evidence for ${matched.length} of ${criteria.length} skills we looked for.`;
  return { matched, missing, humanReviewed, summary };
}
