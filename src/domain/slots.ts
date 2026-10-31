import { DateTime } from 'luxon';

/**
 * PURE (no I/O). Slot generation with Luxon.
 *
 * The grid is anchored at dailyStart in the JOB time zone and stepped by interviewMinutes in real elapsed time,
 * so every interviewer shares the same UTC grid (even half-hour zones like Asia/Kolkata) and DST days stay correct
 * (a spring-forward day simply has fewer slots, a fall-back day more). A slot is kept only when it
 *   1. lies fully inside [dailyStart, dailyEnd] of the job day,
 *   2. does not overlap any mandatory break (breaks are in the job time zone), and
 *   3. lies fully inside one of the interviewer's availability windows (each window is in THAT interviewer's zone).
 * An interviewer with no availability windows at all is treated as available for all job hours.
 * Slots are returned in UTC with the interviewer's local display time attached.
 */
export interface BreakWindow {
  start: string;
  end: string;
}
export interface AvailabilityWindow {
  date: string;
  start: string;
  end: string;
}
export interface SlotInterviewer {
  id: string;
  timeZone: string;
  availability: ReadonlyArray<AvailabilityWindow>;
}
export interface SlotGridInput {
  dates: ReadonlyArray<string>;
  dailyStart: string;
  dailyEnd: string;
  breaks: ReadonlyArray<BreakWindow>;
  timeZone: string;
  interviewMinutes: number;
  interviewers: ReadonlyArray<SlotInterviewer>;
}
export interface GeneratedSlot {
  interviewerId: string;
  start: Date;
  end: Date;
  /** The interviewer's IANA zone. */
  timeZone: string;
  /** ISO 8601 with the interviewer's local offset, e.g. 2026-11-02T14:30:00.000+05:30. */
  localStart: string;
  localEnd: string;
}

interface Interval {
  start: number;
  end: number;
}

function instant(date: string, hhmm: string, zone: string): number | null {
  const dt = DateTime.fromISO(`${date}T${hhmm}`, { zone });
  return dt.isValid ? dt.toMillis() : null;
}

function interval(date: string, from: string, to: string, zone: string): Interval | null {
  const s = instant(date, from, zone);
  const e = instant(date, to, zone);
  return s !== null && e !== null && e > s ? { start: s, end: e } : null;
}

const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && b.start < a.end;
const contains = (outer: Interval, inner: Interval): boolean => outer.start <= inner.start && inner.end <= outer.end;

export function isValidZone(zone: string): boolean {
  return DateTime.local().setZone(zone).isValid;
}

export function generateSlots(input: SlotGridInput): GeneratedSlot[] {
  if (!Number.isFinite(input.interviewMinutes) || input.interviewMinutes <= 0) return [];
  if (!isValidZone(input.timeZone)) return [];
  const step = input.interviewMinutes * 60_000;
  const out: GeneratedSlot[] = [];

  const windowsByInterviewer = new Map<string, Interval[] | null>();
  for (const iv of input.interviewers) {
    if (iv.availability.length === 0) {
      windowsByInterviewer.set(iv.id, null); // unrestricted
      continue;
    }
    const list: Interval[] = [];
    for (const w of iv.availability) {
      if (!isValidZone(iv.timeZone)) continue;
      const i = interval(w.date, w.start, w.end, iv.timeZone);
      if (i) list.push(i);
    }
    windowsByInterviewer.set(iv.id, list);
  }

  for (const date of Array.from(new Set(input.dates)).sort()) {
    const day = interval(date, input.dailyStart, input.dailyEnd, input.timeZone);
    if (!day) continue;
    const breaks = input.breaks
      .map((b) => interval(date, b.start, b.end, input.timeZone))
      .filter((b): b is Interval => b !== null);

    for (let t = day.start; t + step <= day.end; t += step) {
      const slot: Interval = { start: t, end: t + step };
      if (breaks.some((b) => overlaps(slot, b))) continue;
      for (const iv of input.interviewers) {
        if (!isValidZone(iv.timeZone)) continue;
        const windows = windowsByInterviewer.get(iv.id) ?? null;
        if (windows !== null && !windows.some((w) => contains(w, slot))) continue;
        out.push({
          interviewerId: iv.id,
          start: new Date(slot.start),
          end: new Date(slot.end),
          timeZone: iv.timeZone,
          localStart: DateTime.fromMillis(slot.start, { zone: iv.timeZone }).toISO() ?? '',
          localEnd: DateTime.fromMillis(slot.end, { zone: iv.timeZone }).toISO() ?? '',
        });
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime() || (a.interviewerId < b.interviewerId ? -1 : a.interviewerId > b.interviewerId ? 1 : 0));
}

/** Number of slots one interviewer can offer on one job day (no availability restriction). Used by shortfall maths. */
export function slotsPerDay(input: Pick<SlotGridInput, 'dailyStart' | 'dailyEnd' | 'breaks' | 'timeZone' | 'interviewMinutes'>, date: string): number {
  return generateSlots({
    ...input,
    dates: [date],
    interviewers: [{ id: 'x', timeZone: input.timeZone, availability: [] }],
  }).length;
}
