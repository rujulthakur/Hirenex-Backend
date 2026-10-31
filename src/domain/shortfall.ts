/**
 * PURE. Shortfall report: when open slots < shortlist size, say exactly what would close the gap.
 * All fix amounts are computed numbers, never guesses:
 *   add_days              extra job days needed at the current per-day rate
 *   add_interviewers      extra interviewers needed at the current per-interviewer rate
 *   extend_daily_hours    extra minutes per day (rounded up to whole interviews) needed across all interviewers
 */
export interface ShortfallInput {
  /** Shortlisted candidates that still need a slot. */
  needed: number;
  /** Open slots right now. */
  available: number;
  interviewerCount: number;
  dayCount: number;
  /** Slots one interviewer offers on a typical job day (no availability restriction). */
  slotsPerInterviewerDay: number;
  interviewMinutes: number;
}

export interface ShortfallFix {
  kind: 'add_days' | 'add_interviewers' | 'extend_daily_hours';
  amount: number;
  unit: 'days' | 'interviewers' | 'minutes_per_day';
  description: string;
}

export interface ShortfallReport {
  needed: number;
  available: number;
  deficit: number;
  fixes: ShortfallFix[];
}

export function computeShortfall(i: ShortfallInput): ShortfallReport {
  const needed = Math.max(0, i.needed);
  const available = Math.max(0, i.available);
  const deficit = Math.max(0, needed - available);
  if (deficit === 0) return { needed, available, deficit, fixes: [] };

  const fixes: ShortfallFix[] = [];
  const perDay = i.interviewerCount * i.slotsPerInterviewerDay;
  if (perDay > 0) {
    const days = Math.ceil(deficit / perDay);
    fixes.push({ kind: 'add_days', amount: days, unit: 'days', description: `Add ${days} more interview day${days === 1 ? '' : 's'} at the current rate of ${perDay} slots per day.` });
  }
  const perInterviewer = i.dayCount * i.slotsPerInterviewerDay;
  if (perInterviewer > 0) {
    const n = Math.ceil(deficit / perInterviewer);
    fixes.push({ kind: 'add_interviewers', amount: n, unit: 'interviewers', description: `Add ${n} more interviewer${n === 1 ? '' : 's'} (each offers ${perInterviewer} slots over ${i.dayCount} day${i.dayCount === 1 ? '' : 's'}).` });
  }
  const parallel = i.interviewerCount * i.dayCount;
  if (parallel > 0 && i.interviewMinutes > 0) {
    const perLane = Math.ceil(deficit / parallel);
    const minutes = perLane * i.interviewMinutes;
    fixes.push({ kind: 'extend_daily_hours', amount: minutes, unit: 'minutes_per_day', description: `Extend each interviewer's day by ${minutes} minutes (${perLane} extra interview${perLane === 1 ? '' : 's'} per interviewer per day).` });
  }
  return { needed, available, deficit, fixes };
}
