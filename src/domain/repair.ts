import { countConflicts } from './assignment';

/**
 * PURE (no I/O). Repair planning. The service applies each planned move with an ATOMIC conditional update and
 * falls back to "unplaced" if a move loses a race, so these plans are proposals that code then verifies.
 *
 *  - planDecline: free the declined candidate's slot and give it to the top-ranked approved WAITLISTED candidate.
 *  - planUnavailable: block an interviewer's slots in a range and move ONLY the affected candidates (MINIMAL
 *    MOVEMENT), in rank order, to the nearest open slot (same day first, then earliest). Everyone else is untouched.
 */
export type RepairSlotStatus = 'open' | 'booked' | 'blocked';

export interface RepairSlot {
  id: string;
  interviewerId: string;
  start: number; // epoch ms
  end: number;
  status: RepairSlotStatus;
  candidateId?: string;
}

export interface Move {
  candidateId: string;
  fromSlotId: string;
  toSlotId: string;
}

const DAY_MS = 86_400_000;
const dayKey = (ms: number): number => Math.floor(ms / DAY_MS);

/* ------------------------------ decline ------------------------------ */

export interface DeclinePlan {
  /** The slot the declined candidate held, or null if they had none. */
  slotId: string | null;
  /** Top waitlisted candidate who gets the slot, or null when the waitlist is empty. */
  promotedCandidateId: string | null;
  /** What the slot looks like once the repair is applied. */
  slotStatusAfter: 'open' | 'booked';
  note: string;
}

/**
 * `waitlistRanked` = approved waitlisted candidates, best first. Candidates who already hold a slot are skipped,
 * so nobody can end up with two slots.
 */
export function planDecline(slots: ReadonlyArray<RepairSlot>, declinedCandidateId: string, waitlistRanked: ReadonlyArray<string>): DeclinePlan {
  const held = slots.find((s) => s.status === 'booked' && s.candidateId === declinedCandidateId);
  if (!held) return { slotId: null, promotedCandidateId: null, slotStatusAfter: 'open', note: 'The declining candidate held no slot, so nothing was freed.' };

  const bookedIds = new Set(slots.filter((s) => s.status === 'booked' && s.candidateId).map((s) => s.candidateId as string));
  const next = waitlistRanked.find((id) => id !== declinedCandidateId && !bookedIds.has(id));
  if (!next) return { slotId: held.id, promotedCandidateId: null, slotStatusAfter: 'open', note: 'The waitlist is empty, so the slot returned to open.' };
  return { slotId: held.id, promotedCandidateId: next, slotStatusAfter: 'booked', note: 'The top waitlisted candidate was promoted into the same slot.' };
}

/* ------------------------- interviewer unavailable ------------------------- */

export interface UnavailablePlan {
  /** Every slot of that interviewer overlapping the range (open or booked). They all become "blocked". */
  blockedSlotIds: string[];
  moved: Move[];
  /** Affected candidates that no open slot could take. They stay shortlisted and flagged unscheduled. */
  unplaced: string[];
}

export function planUnavailable(
  slots: ReadonlyArray<RepairSlot>,
  interviewerId: string,
  from: number,
  to: number,
  /** Candidate ids in rank order (best first). Unknown ids sort last, then by id. */
  rankOrder: ReadonlyArray<string>,
): UnavailablePlan {
  const inRange = (s: RepairSlot): boolean => s.interviewerId === interviewerId && s.status !== 'blocked' && s.start < to && s.end > from;
  const blocked = slots.filter(inRange);
  const blockedIds = new Set(blocked.map((s) => s.id));

  const affected = blocked.filter((s) => s.status === 'booked' && s.candidateId);
  const rankIndex = new Map(rankOrder.map((id, i) => [id, i]));
  const rankOf = (id: string): number => rankIndex.get(id) ?? Number.MAX_SAFE_INTEGER;
  affected.sort((a, b) => rankOf(a.candidateId as string) - rankOf(b.candidateId as string) || (a.candidateId as string).localeCompare(b.candidateId as string));

  const pool = slots.filter((s) => s.status === 'open' && !blockedIds.has(s.id)).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const taken = new Set<string>();
  const moved: Move[] = [];
  const unplaced: string[] = [];

  for (const a of affected) {
    const candidateId = a.candidateId as string;
    const free = pool.filter((s) => !taken.has(s.id));
    const sameDay = free.find((s) => dayKey(s.start) === dayKey(a.start));
    const pick = sameDay ?? free[0];
    if (!pick) {
      unplaced.push(candidateId);
      continue;
    }
    taken.add(pick.id);
    moved.push({ candidateId, fromSlotId: a.id, toSlotId: pick.id });
  }
  return { blockedSlotIds: Array.from(blockedIds), moved, unplaced };
}

/* ------------------------------ snapshots ------------------------------ */

export interface Placement {
  slotId: string;
  interviewerId: string;
  candidateId?: string;
  start: number;
  end: number;
}

/** The booked slots, in time order: the "before" and "after" snapshots shown on the timeline diff. */
export function snapshotBooked(slots: ReadonlyArray<RepairSlot>): Placement[] {
  return slots
    .filter((s) => s.status === 'booked')
    .map((s) => ({ slotId: s.id, interviewerId: s.interviewerId, ...(s.candidateId ? { candidateId: s.candidateId } : {}), start: s.start, end: s.end }))
    .sort((a, b) => a.start - b.start || a.slotId.localeCompare(b.slotId));
}

/** Applies a decline plan to an in-memory slot list (used by tests and the invariant check). */
export function applyDecline(slots: ReadonlyArray<RepairSlot>, declinedCandidateId: string, plan: DeclinePlan): RepairSlot[] {
  return slots.map((s) => {
    if (s.id !== plan.slotId || s.candidateId !== declinedCandidateId) return { ...s };
    if (plan.promotedCandidateId) return { ...s, status: 'booked', candidateId: plan.promotedCandidateId };
    const { candidateId: _dropped, ...rest } = s;
    return { ...rest, status: 'open' };
  });
}

/** Applies an unavailable plan to an in-memory slot list. */
export function applyUnavailable(slots: ReadonlyArray<RepairSlot>, plan: UnavailablePlan): RepairSlot[] {
  const blocked = new Set(plan.blockedSlotIds);
  const moves = new Map(plan.moved.map((m) => [m.toSlotId, m.candidateId]));
  return slots.map((s) => {
    if (blocked.has(s.id)) {
      const { candidateId: _dropped, ...rest } = s;
      return { ...rest, status: 'blocked' };
    }
    const mover = moves.get(s.id);
    if (mover) return { ...s, status: 'booked', candidateId: mover };
    return { ...s };
  });
}

/** Invariant: no interviewer double-booked and no candidate holding two slots. Must be 0 after ANY repair. */
export function conflictsAfter(slots: ReadonlyArray<RepairSlot>): number {
  return countConflicts(
    slots
      .filter((s) => s.status === 'booked')
      .map((s) => ({ interviewerId: s.interviewerId, start: s.start, end: s.end, ...(s.candidateId ? { candidateId: s.candidateId } : {}) })),
  );
}
