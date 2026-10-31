import { DateTime } from 'luxon';

export interface SlotWindow {
  start: Date;
  end: Date;
}

/** PURE. Tomorrow's calendar date (YYYY-MM-DD) in the given zone. Interviews are never booked for the same day. */
export function tomorrowIn(zone: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone }).plus({ days: 1 }).toFormat('yyyy-MM-dd');
}

/** PURE. Back-to-back slots of `minutes` between HH:mm and HH:mm on `date` in `zone`. Only whole slots count. */
export function daySlots(date: string, zone: string, windowStart: string, windowEnd: string, minutes: number): SlotWindow[] {
  const start = DateTime.fromFormat(`${date} ${windowStart}`, 'yyyy-MM-dd HH:mm', { zone });
  const end = DateTime.fromFormat(`${date} ${windowEnd}`, 'yyyy-MM-dd HH:mm', { zone });
  if (!start.isValid || !end.isValid || minutes < 5 || end <= start) return [];
  const out: SlotWindow[] = [];
  for (let t = start; t.plus({ minutes }) <= end; t = t.plus({ minutes })) {
    out.push({ start: t.toJSDate(), end: t.plus({ minutes }).toJSDate() });
  }
  return out;
}

/** PURE. Slots that do not overlap any already-booked window. */
export function freeSlots(all: SlotWindow[], taken: SlotWindow[]): SlotWindow[] {
  return all.filter((s) => !taken.some((t) => t.start < s.end && t.end > s.start));
}
