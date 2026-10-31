import { describe, expect, it } from 'vitest';
import { assignCandidates, countConflicts, type AssignSlot } from '../../src/domain/assignment';
import { bookWithRetry } from '../../src/domain/booking';
import { computeShortfall } from '../../src/domain/shortfall';

const H = 3_600_000;
const slot = (id: string, interviewerId: string, hour: number): AssignSlot => ({ id, interviewerId, start: hour * H });

describe('assignCandidates', () => {
  it('gives the best-ranked candidate the earliest slot', () => {
    const r = assignCandidates(['c1', 'c2'], [slot('s2', 'i1', 2), slot('s1', 'i1', 1)]);
    expect(r.assignments).toEqual([
      { candidateId: 'c1', slotId: 's1', interviewerId: 'i1' },
      { candidateId: 'c2', slotId: 's2', interviewerId: 'i1' },
    ]);
  });
  it('among slots at the same time prefers the least-loaded interviewer', () => {
    const slots = [slot('a1', 'A', 1), slot('b1', 'B', 1), slot('a2', 'A', 2), slot('b2', 'B', 2)];
    const r = assignCandidates(['c1', 'c2'], slots);
    expect(new Set(r.assignments.map((a) => a.interviewerId)).size).toBe(2); // spread, not stacked
    const heavy = assignCandidates(['c1'], slots, new Map([['A', 5]]));
    expect(heavy.assignments[0]!.interviewerId).toBe('B');
  });
  it('lists unplaced candidates instead of dropping them', () => {
    const r = assignCandidates(['c1', 'c2', 'c3'], [slot('s1', 'i1', 1)]);
    expect(r.assignments).toHaveLength(1);
    expect(r.unplaced).toEqual(['c2', 'c3']);
  });
  it('never gives one candidate two slots, even if listed twice', () => {
    const r = assignCandidates(['c1', 'c1'], [slot('s1', 'i1', 1), slot('s2', 'i1', 2)]);
    expect(r.assignments).toHaveLength(1);
  });
  it('is deterministic regardless of slot input order', () => {
    const slots = [slot('s3', 'B', 1), slot('s1', 'A', 1), slot('s2', 'A', 2)];
    expect(assignCandidates(['x', 'y'], slots)).toEqual(assignCandidates(['x', 'y'], [...slots].reverse()));
  });
});

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('property: no double-booking invariant (300 random inputs)', () => {
  it('assignments never reuse a slot, a candidate, or overlap an interviewer', () => {
    const rnd = mulberry32(7);
    for (let run = 0; run < 300; run++) {
      const interviewers = 1 + Math.floor(rnd() * 4);
      const slots: AssignSlot[] = [];
      for (let i = 0; i < interviewers; i++) {
        const count = Math.floor(rnd() * 8);
        for (let k = 0; k < count; k++) slots.push({ id: `s-${i}-${k}`, interviewerId: `i${i}`, start: k * H });
      }
      const candidates = Array.from({ length: Math.floor(rnd() * 20) }, (_, i) => `c${i}`);
      const r = assignCandidates(candidates, slots);
      expect(r.assignments.length + r.unplaced.length).toBe(candidates.length);
      expect(new Set(r.assignments.map((a) => a.slotId)).size).toBe(r.assignments.length);
      const byId = new Map(slots.map((s) => [s.id, s]));
      const booked = r.assignments.map((a) => ({ interviewerId: a.interviewerId, start: byId.get(a.slotId)!.start, end: byId.get(a.slotId)!.start + H, candidateId: a.candidateId }));
      expect(countConflicts(booked)).toBe(0);
      expect(r.assignments.length).toBe(Math.min(candidates.length, slots.length));
    }
  });
});

describe('countConflicts', () => {
  it('detects overlapping bookings and a candidate with two slots', () => {
    expect(countConflicts([{ interviewerId: 'a', start: 0, end: H }, { interviewerId: 'a', start: H / 2, end: 1.5 * H }])).toBe(1);
    expect(countConflicts([{ interviewerId: 'a', start: 0, end: H, candidateId: 'c' }, { interviewerId: 'b', start: 0, end: H, candidateId: 'c' }])).toBe(1);
    expect(countConflicts([{ interviewerId: 'a', start: 0, end: H }, { interviewerId: 'a', start: H, end: 2 * H }])).toBe(0);
  });
});

describe('atomic booking (conditional update semantics)', () => {
  /** Fake store with the same contract as findOneAndUpdate({_id, status:'open'}): check and set in one synchronous step. */
  function makeStore(ids: string[]): { tryBook: (slotId: string, candidateId: string) => Promise<boolean>; owners: Map<string, string> } {
    const owners = new Map<string, string>();
    const open = new Set(ids);
    return {
      owners,
      tryBook: async (slotId, candidateId) => {
        await Promise.resolve(); // yield so the 20 callers really interleave
        if (!open.has(slotId)) return false;
        open.delete(slotId);
        owners.set(slotId, candidateId);
        return true;
      },
    };
  }

  it('20 parallel bookings of ONE slot: exactly one winner', async () => {
    const store = makeStore(['s1']);
    const only = slot('s1', 'i1', 1);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => bookWithRetry(`c${i}`, only, [], store.tryBook)));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(store.owners.size).toBe(1);
  });

  it('losers fall back to the next best slot, so 20 candidates over 20 slots all get distinct slots', async () => {
    const slots = Array.from({ length: 20 }, (_, i) => slot(`s${i}`, 'i1', i));
    const store = makeStore(slots.map((s) => s.id));
    const results = await Promise.all(slots.map((_, i) => bookWithRetry(`c${i}`, slots[0]!, slots, store.tryBook)));
    expect(results.every((r) => r !== null)).toBe(true);
    expect(new Set(results.map((r) => r!.id)).size).toBe(20);
    expect(new Set(store.owners.values()).size).toBe(20);
  });

  it('returns null when every slot is taken', async () => {
    const store = makeStore([]);
    expect(await bookWithRetry('c', slot('s1', 'i', 1), [slot('s2', 'i', 2)], store.tryBook)).toBeNull();
  });
});

describe('computeShortfall', () => {
  it('has no fixes when slots suffice', () => {
    expect(computeShortfall({ needed: 5, available: 5, interviewerCount: 2, dayCount: 1, slotsPerInterviewerDay: 4, interviewMinutes: 30 })).toEqual({ needed: 5, available: 5, deficit: 0, fixes: [] });
  });
  it('computes days, interviewers and minutes from the deficit', () => {
    const r = computeShortfall({ needed: 10, available: 4, interviewerCount: 2, dayCount: 2, slotsPerInterviewerDay: 3, interviewMinutes: 30 });
    expect(r.deficit).toBe(6);
    expect(r.fixes.map((f) => [f.kind, f.amount])).toEqual([
      ['add_days', 1],
      ['add_interviewers', 1],
      ['extend_daily_hours', 60],
    ]);
  });
  it('rounds up and skips fixes that cannot be computed (no interviewers)', () => {
    const r = computeShortfall({ needed: 13, available: 0, interviewerCount: 0, dayCount: 2, slotsPerInterviewerDay: 3, interviewMinutes: 30 });
    expect(r.fixes.map((f) => [f.kind, f.amount])).toEqual([['add_interviewers', 3]]);
  });
});
