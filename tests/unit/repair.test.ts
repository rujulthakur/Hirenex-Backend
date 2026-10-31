import { describe, expect, it } from 'vitest';
import {
  applyDecline,
  applyUnavailable,
  conflictsAfter,
  planDecline,
  planUnavailable,
  snapshotBooked,
  type RepairSlot,
} from '../../src/domain/repair';
import { firstNameFromText, promotionTemplate, rescheduleTemplate } from '../../src/domain/repairDrafts';

const H = 3_600_000;
const slot = (id: string, interviewerId: string, hour: number, status: RepairSlot['status'] = 'open', candidateId?: string): RepairSlot => ({
  id,
  interviewerId,
  start: hour * H,
  end: (hour + 1) * H,
  status,
  ...(candidateId ? { candidateId } : {}),
});

describe('decline repair', () => {
  const slots = [slot('s1', 'A', 9, 'booked', 'c1'), slot('s2', 'A', 10, 'booked', 'c2'), slot('s3', 'B', 9)];

  it('promotes the top waitlisted candidate into the SAME slot', () => {
    const plan = planDecline(slots, 'c1', ['w1', 'w2']);
    expect(plan).toMatchObject({ slotId: 's1', promotedCandidateId: 'w1', slotStatusAfter: 'booked' });
    const after = applyDecline(slots, 'c1', plan);
    expect(after.find((s) => s.id === 's1')).toMatchObject({ status: 'booked', candidateId: 'w1' });
    expect(conflictsAfter(after)).toBe(0);
  });

  it('returns the slot to open when the waitlist is empty and says so', () => {
    const plan = planDecline(slots, 'c1', []);
    expect(plan.promotedCandidateId).toBeNull();
    expect(plan.slotStatusAfter).toBe('open');
    expect(plan.note).toMatch(/waitlist is empty/i);
    const after = applyDecline(slots, 'c1', plan);
    expect(after.find((s) => s.id === 's1')).toMatchObject({ status: 'open' });
    expect(after.find((s) => s.id === 's1')?.candidateId).toBeUndefined();
  });

  it('skips waitlisted candidates who already hold a slot (nobody gets two)', () => {
    const plan = planDecline(slots, 'c1', ['c2', 'w1']);
    expect(plan.promotedCandidateId).toBe('w1');
  });

  it('is idempotent: replaying a decline after it was applied promotes nobody else', () => {
    const first = planDecline(slots, 'c1', ['w1', 'w2']);
    const once = applyDecline(slots, 'c1', first);
    const replay = planDecline(once, 'c1', ['w2']); // c1 no longer holds a slot
    expect(replay.slotId).toBeNull();
    expect(replay.promotedCandidateId).toBeNull();
    const twice = applyDecline(once, 'c1', replay);
    expect(twice).toEqual(once);
  });

  it('does nothing when the decliner held no slot', () => {
    const plan = planDecline(slots, 'ghost', ['w1']);
    expect(plan.slotId).toBeNull();
    expect(plan.promotedCandidateId).toBeNull();
  });
});

describe('interviewer unavailable repair', () => {
  it('moves ONLY affected candidates, in rank order, preferring the same day then earliest', () => {
    const slots = [
      slot('a9', 'A', 9, 'booked', 'c1'),
      slot('a10', 'A', 10, 'booked', 'c2'),
      slot('b9', 'B', 9, 'booked', 'c3'), // unaffected
      slot('b10', 'B', 10),
      slot('b11', 'B', 11),
      slot('b33', 'B', 33), // next day
    ];
    const plan = planUnavailable(slots, 'A', 9 * H, 11 * H, ['c3', 'c1', 'c2']);
    expect(plan.blockedSlotIds.sort()).toEqual(['a10', 'a9']);
    expect(plan.moved).toEqual([
      { candidateId: 'c1', fromSlotId: 'a9', toSlotId: 'b10' },
      { candidateId: 'c2', fromSlotId: 'a10', toSlotId: 'b11' },
    ]);
    expect(plan.unplaced).toEqual([]);
    expect(plan.moved.some((m) => m.candidateId === 'c3')).toBe(false);
  });

  it('partial placement: lists who could not be placed', () => {
    const slots = [slot('a9', 'A', 9, 'booked', 'c1'), slot('a10', 'A', 10, 'booked', 'c2'), slot('b9', 'B', 9)];
    const plan = planUnavailable(slots, 'A', 0, 100 * H, ['c1', 'c2']);
    expect(plan.moved).toEqual([{ candidateId: 'c1', fromSlotId: 'a9', toSlotId: 'b9' }]);
    expect(plan.unplaced).toEqual(['c2']);
  });

  it('never picks a slot inside the blocked range and ignores blocked slots', () => {
    const slots = [slot('a9', 'A', 9, 'booked', 'c1'), slot('a10', 'A', 10), slot('x', 'B', 10, 'blocked'), slot('b12', 'B', 12)];
    const plan = planUnavailable(slots, 'A', 9 * H, 11 * H, ['c1']);
    expect(plan.moved[0]?.toSlotId).toBe('b12');
  });

  it('unaffected bookings are byte-for-byte identical after the repair (minimal movement)', () => {
    const slots = [slot('a9', 'A', 9, 'booked', 'c1'), slot('b9', 'B', 9, 'booked', 'c2'), slot('b10', 'B', 10, 'booked', 'c3'), slot('b11', 'B', 11)];
    const plan = planUnavailable(slots, 'A', 9 * H, 10 * H, ['c1', 'c2', 'c3']);
    const after = applyUnavailable(slots, plan);
    for (const id of ['b9', 'b10']) expect(after.find((s) => s.id === id)).toEqual(slots.find((s) => s.id === id));
  });
});

describe('invariant: no double booking after any repair (property test)', () => {
  function rng(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }

  it('holds across 300 random schedules, declines and unavailability ranges', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const interviewers = ['A', 'B', 'C'];
      const slots: RepairSlot[] = [];
      let cid = 0;
      for (const iv of interviewers) {
        for (let h = 0; h < 8; h++) {
          const booked = r() < 0.5;
          slots.push(slot(`${iv}${h}`, iv, h + (r() < 0.3 ? 24 : 0) , booked ? 'booked' : 'open', booked ? `c${cid++}` : undefined));
        }
      }
      expect(conflictsAfter(slots)).toBe(0);
      const booked = slots.filter((s) => s.status === 'booked');
      const rank = booked.map((s) => s.candidateId as string).sort(() => r() - 0.5);

      // decline repair
      const decliner = booked[Math.floor(r() * booked.length)]?.candidateId ?? 'none';
      const dPlan = planDecline(slots, decliner, ['w1', 'w2', ...rank.slice(0, 2)]);
      expect(conflictsAfter(applyDecline(slots, decliner, dPlan))).toBe(0);

      // unavailable repair
      const from = Math.floor(r() * 10) * H;
      const to = from + (1 + Math.floor(r() * 12)) * H;
      const iv = interviewers[Math.floor(r() * 3)] as string;
      const uPlan = planUnavailable(slots, iv, from, to, rank);
      const after = applyUnavailable(slots, uPlan);
      expect(conflictsAfter(after)).toBe(0);

      // every affected candidate is either moved or unplaced, never both, never lost
      const affected = booked.filter((s) => uPlan.blockedSlotIds.includes(s.id)).map((s) => s.candidateId as string);
      expect([...uPlan.moved.map((m) => m.candidateId), ...uPlan.unplaced].sort()).toEqual([...affected].sort());
      // unaffected candidates keep their exact slot
      const unaffected = booked.filter((s) => !uPlan.blockedSlotIds.includes(s.id));
      for (const u of unaffected) expect(after.find((s) => s.id === u.id)).toMatchObject({ status: 'booked', candidateId: u.candidateId });
      // booked count is preserved minus unplaced
      expect(snapshotBooked(after).length).toBe(booked.length - uPlan.unplaced.length);
    }
  });
});

describe('repair email drafts (deterministic fallback)', () => {
  const facts = { firstName: 'Asha', jobTitle: 'Backend Engineer', companyLabel: 'TrustHire', whenText: 'Tue 4 Nov 2026, 10:30 AM IST', durationMinutes: 45, format: 'virtual' as const, whereText: 'https://meet.example/abc' };

  it('promotion template has the facts, no links to buttons, and does not mention another candidate', () => {
    const d = promotionTemplate(facts);
    expect(d.body).toContain('Asha');
    expect(d.body).toContain('Tue 4 Nov 2026, 10:30 AM IST');
    expect(d.body.toLowerCase()).not.toContain('declined');
    expect(d.body).not.toMatch(/\/c\//);
  });
  it('reschedule template says the time changed and that the old link stops working', () => {
    const d = rescheduleTemplate(facts);
    expect(d.body).toMatch(/moved/);
    expect(d.body).toMatch(/previous link no longer works/);
  });
  it('first name comes from the first line of the original text', () => {
    expect(firstNameFromText('asha Verma\nSenior engineer')).toBe('Asha');
    expect(firstNameFromText('')).toBe('there');
    expect(firstNameFromText('1234 5678')).toBe('there');
  });
});
