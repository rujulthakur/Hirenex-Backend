/**
 * PURE. P2 stability check. Candidates within 2 points of the shortlist cutoff are rescored once (uncached by the
 * service); if the rescore changes whether they are above the cutoff, the rank flipped and a human reviews it.
 */
export const STABILITY_MARGIN = 2;

export interface TotalRow {
  id: string;
  total: number;
}

/** Cutoff = total of the last shortlisted candidate (best-first list, capacity N). Null if nothing is cut. */
export function cutoffTotal(rankedBestFirst: ReadonlyArray<TotalRow>, capacity: number): number | null {
  if (capacity <= 0 || rankedBestFirst.length < capacity) return null;
  return (rankedBestFirst[capacity - 1] as TotalRow).total;
}

export function nearCutoff(rankedBestFirst: ReadonlyArray<TotalRow>, capacity: number, margin = STABILITY_MARGIN): string[] {
  const cut = cutoffTotal(rankedBestFirst, capacity);
  if (cut === null) return [];
  return rankedBestFirst.filter((r) => Math.abs(r.total - cut) <= margin).map((r) => r.id);
}

export interface FlipReport {
  id: string;
  before: number;
  after: number;
  flipped: boolean;
}

/** A flip = the candidate was on one side of the cutoff before and on the other after the rescore. */
export function detectFlips(cutoff: number, before: ReadonlyArray<TotalRow>, after: ReadonlyArray<TotalRow>): FlipReport[] {
  const afterById = new Map(after.map((a) => [a.id, a.total]));
  return before
    .filter((b) => afterById.has(b.id))
    .map((b) => {
      const a = afterById.get(b.id) as number;
      return { id: b.id, before: b.total, after: a, flipped: b.total >= cutoff !== a >= cutoff };
    });
}
