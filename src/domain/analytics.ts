/**
 * PURE. Shapes the raw aggregation rows into the analytics payload. All numbers come from Mongo aggregation
 * pipelines on indexed fields (jobId, stage, status); this file only normalises and does the arithmetic.
 */
export const FUNNEL_STAGES = ['applied', 'scored', 'shortlisted', 'waitlisted', 'on_hold', 'invited', 'confirmed', 'declined', 'rejected'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

const r2 = (n: number): number => Math.round(n * 100) / 100;

export function normalizeFunnel(rows: ReadonlyArray<{ _id: string; n: number }>): Record<FunnelStage, number> {
  const out = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0])) as Record<FunnelStage, number>;
  for (const r of rows) if ((FUNNEL_STAGES as readonly string[]).includes(r._id)) out[r._id as FunnelStage] = r.n;
  return out;
}

/** Average hours a candidate has spent from creation to their last stage change, per CURRENT stage (approximation: no stage history is stored). */
export function normalizeTimeInStage(rows: ReadonlyArray<{ _id: string; avgMs: number }>): Record<FunnelStage, number> {
  const out = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0])) as Record<FunnelStage, number>;
  for (const r of rows) if ((FUNNEL_STAGES as readonly string[]).includes(r._id)) out[r._id as FunnelStage] = r2(r.avgMs / 3_600_000);
  return out;
}

export interface UtilizationRow {
  interviewerId: string;
  day: string;
  booked: number;
  total: number;
  utilization: number;
}

/** booked / total slots per interviewer per day. Blocked slots do not count as capacity. */
export function computeUtilization(rows: ReadonlyArray<{ interviewerId: string; day: string; booked: number; total: number }>): UtilizationRow[] {
  return rows
    .map((r) => ({ ...r, utilization: r.total > 0 ? r2(r.booked / r.total) : 0 }))
    .sort((a, b) => a.interviewerId.localeCompare(b.interviewerId) || a.day.localeCompare(b.day));
}

export interface TrustMeter {
  verifiedQuotePct: number;
  openFlags: number;
  injectionsCaught: number;
  hiddenTextCaught: number;
}

/** verifiedQuotePct = verified quotes / quotes actually proposed (criteria marked missing are not quotes). */
export function computeTrustMeter(input: { verifiedQuotes: number; proposedQuotes: number; openFlags: number; injections: number; hiddenText: number }): TrustMeter {
  return {
    verifiedQuotePct: input.proposedQuotes > 0 ? r2((input.verifiedQuotes / input.proposedQuotes) * 100) : 0,
    openFlags: input.openFlags,
    injectionsCaught: input.injections,
    hiddenTextCaught: input.hiddenText,
  };
}
