import { describe, expect, it } from 'vitest';
import { generateSlots, isValidZone, slotsPerDay, type SlotGridInput } from '../../src/domain/slots';

const hhmm = (d: Date, zone: string): string => d.toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false });

const kolkata = { id: 'kol', timeZone: 'Asia/Kolkata', availability: [] };
const base: SlotGridInput = {
  dates: ['2026-11-02'],
  dailyStart: '09:00',
  dailyEnd: '12:00',
  breaks: [{ start: '10:00', end: '10:30' }],
  timeZone: 'Asia/Kolkata',
  interviewMinutes: 60,
  interviewers: [kolkata],
};

describe('generateSlots: hours, breaks, grid', () => {
  it('skips slots that overlap a break (60 min)', () => {
    const s = generateSlots(base);
    expect(s.map((x) => hhmm(x.start, 'Asia/Kolkata'))).toEqual(['09:00', '11:00']);
  });
  it('30 minute grid keeps exact half-hour offsets for Asia/Kolkata (UTC+5:30)', () => {
    const s = generateSlots({ ...base, interviewMinutes: 30 });
    expect(s.map((x) => hhmm(x.start, 'Asia/Kolkata'))).toEqual(['09:00', '09:30', '10:30', '11:00', '11:30']);
    expect(s[0]!.start.toISOString()).toBe('2026-11-02T03:30:00.000Z');
    expect(s[0]!.localStart.endsWith('+05:30')).toBe(true);
  });
  it('never leaves working hours and snaps to the duration grid', () => {
    const s = generateSlots({ ...base, breaks: [], interviewMinutes: 45 });
    const first = s[0]!.start.getTime();
    for (const x of s) {
      expect((x.start.getTime() - first) % (45 * 60_000)).toBe(0);
      expect(x.end.getTime() - x.start.getTime()).toBe(45 * 60_000);
      expect(x.end.getTime()).toBeLessThanOrEqual(new Date('2026-11-02T06:30:00Z').getTime());
    }
    expect(s).toHaveLength(4); // 09:00, 09:45, 10:30, 11:15 (11:15 + 45 = 12:00)
  });
  it('a duration longer than the day yields no slots; bad input yields none', () => {
    expect(generateSlots({ ...base, interviewMinutes: 240 })).toEqual([]);
    expect(generateSlots({ ...base, interviewMinutes: 0 })).toEqual([]);
    expect(generateSlots({ ...base, timeZone: 'Not/AZone' })).toEqual([]);
  });
  it('de-duplicates dates and sorts output', () => {
    const s = generateSlots({ ...base, dates: ['2026-11-03', '2026-11-02', '2026-11-02'], breaks: [] });
    expect(s).toHaveLength(6);
    expect(s.map((x) => x.start.getTime())).toEqual([...s.map((x) => x.start.getTime())].sort((a, b) => a - b));
  });
  it('regeneration is deterministic (idempotent input -> identical grid)', () => {
    expect(generateSlots(base)).toEqual(generateSlots(base));
  });
});

describe('generateSlots: three time zones intersected with availability', () => {
  const input: SlotGridInput = {
    ...base,
    breaks: [],
    interviewers: [
      kolkata,
      // 22:30-23:59 New York on 1 Nov = 03:30Z-04:59Z on 2 Nov (EST after DST ended on 1 Nov)
      { id: 'nyc', timeZone: 'America/New_York', availability: [{ date: '2026-11-01', start: '22:30', end: '23:59' }] },
      // 04:00-06:30 London (GMT in November) = 04:00Z-06:30Z
      { id: 'lon', timeZone: 'Europe/London', availability: [{ date: '2026-11-02', start: '04:00', end: '06:30' }] },
    ],
  };
  const slots = generateSlots(input);
  const of = (id: string): typeof slots => slots.filter((s) => s.interviewerId === id);

  it('each interviewer only gets slots inside their own availability, in their own zone', () => {
    expect(of('kol')).toHaveLength(3);
    expect(of('nyc').map((s) => s.start.toISOString())).toEqual(['2026-11-02T03:30:00.000Z']);
    expect(of('lon').map((s) => s.start.toISOString())).toEqual(['2026-11-02T04:30:00.000Z', '2026-11-02T05:30:00.000Z']);
  });
  it('carries the interviewer local display time and zone', () => {
    const n = of('nyc')[0]!;
    expect(n.timeZone).toBe('America/New_York');
    expect(n.localStart.startsWith('2026-11-01T22:30:00.000-05:00')).toBe(true);
    const l = of('lon')[0]!;
    expect(l.localStart.startsWith('2026-11-02T04:30:00.000+00:00')).toBe(true);
  });
  it('all interviewers share one UTC grid', () => {
    const origin = of('kol')[0]!.start.getTime();
    for (const s of slots) expect((s.start.getTime() - origin) % 3_600_000).toBe(0);
  });
  it('an interviewer whose windows do not touch the job hours gets nothing', () => {
    const none = generateSlots({ ...input, interviewers: [{ id: 'x', timeZone: 'Asia/Kolkata', availability: [{ date: '2026-12-25', start: '09:00', end: '12:00' }] }] });
    expect(none).toEqual([]);
  });
});

describe('generateSlots: DST change days', () => {
  const ny = { id: 'ny', timeZone: 'America/New_York', availability: [] };
  const dst = (date: string): SlotGridInput => ({
    dates: [date],
    dailyStart: '00:00',
    dailyEnd: '04:00',
    breaks: [],
    timeZone: 'America/New_York',
    interviewMinutes: 60,
    interviewers: [ny],
  });
  it('fall back (1 Nov 2026): the 00:00-04:00 window is 5 real hours, so 5 slots', () => {
    const s = generateSlots(dst('2026-11-01'));
    expect(s).toHaveLength(5);
    expect(s[0]!.start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(s[4]!.end.toISOString()).toBe('2026-11-01T09:00:00.000Z');
  });
  it('spring forward (8 Mar 2026): the window is 3 real hours, so 3 slots', () => {
    expect(generateSlots(dst('2026-03-08'))).toHaveLength(3);
  });
  it('a normal day has 4 slots', () => {
    expect(generateSlots(dst('2026-06-10'))).toHaveLength(4);
  });
});

describe('helpers', () => {
  it('isValidZone', () => {
    expect(isValidZone('Asia/Kolkata')).toBe(true);
    expect(isValidZone('Mars/Olympus')).toBe(false);
  });
  it('slotsPerDay counts one interviewer on one day, breaks included', () => {
    expect(slotsPerDay(base, '2026-11-02')).toBe(2);
  });
});
