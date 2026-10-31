/**
 * PURE. Bias panel maths (four-fifths rule style). Per group: selection rate = shortlisted / total. Each group's
 * ratio is its rate divided by the HIGHEST group rate. A ratio below 0.8 is flagged. Small samples get a caveat,
 * because with a handful of candidates a single decision swings the ratio.
 */
export const IMPACT_THRESHOLD = 0.8;
export const MIN_GROUP_SAMPLE = 5;
export const BIAS_CAVEAT =
  'Synthetic groups and small samples: with fewer than 5 candidates in a group one decision changes the ratio a lot. This is a screening signal for human review, not proof of bias or fairness.';

export interface GroupCount {
  group: string;
  total: number;
  shortlisted: number;
}

export interface GroupImpact extends GroupCount {
  selectionRate: number;
  ratioToHighest: number;
  flagged: boolean;
  smallSample: boolean;
}

export interface BiasPanel {
  groups: GroupImpact[];
  threshold: number;
  highestGroup: string | null;
  caveat: string;
}

const r4 = (n: number): number => Math.round(n * 10_000) / 10_000;

export function computeImpact(counts: ReadonlyArray<GroupCount>): BiasPanel {
  const rates = counts.map((c) => ({ ...c, selectionRate: c.total > 0 ? c.shortlisted / c.total : 0 }));
  const max = rates.reduce((m, g) => Math.max(m, g.selectionRate), 0);
  const top = rates.find((g) => g.selectionRate === max && max > 0);
  const groups: GroupImpact[] = rates
    .map((g) => {
      const ratio = max > 0 ? g.selectionRate / max : 1; // nobody selected anywhere: no disparity to flag
      return { ...g, selectionRate: r4(g.selectionRate), ratioToHighest: r4(ratio), flagged: max > 0 && ratio < IMPACT_THRESHOLD, smallSample: g.total < MIN_GROUP_SAMPLE };
    })
    .sort((a, b) => a.group.localeCompare(b.group));
  return { groups, threshold: IMPACT_THRESHOLD, highestGroup: top?.group ?? null, caveat: BIAS_CAVEAT };
}
