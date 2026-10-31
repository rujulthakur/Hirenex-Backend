/**
 * PURE. Assignment of the approved shortlist to open slots.
 *  - candidates are processed in RANK order (best first);
 *  - each candidate gets the EARLIEST open slot;
 *  - among slots starting at the same time, prefer the LEAST-LOADED interviewer (existing bookings + assigned so far);
 *  - remaining ties break on interviewer id then slot id, so the output is fully deterministic;
 *  - no candidate gets two slots and no slot is used twice;
 *  - anyone who cannot be placed is returned in `unplaced` (never silently dropped).
 */
export interface AssignSlot {
  id: string;
  interviewerId: string;
  start: number; // epoch ms
}
export interface Assignment {
  candidateId: string;
  slotId: string;
  interviewerId: string;
}
export interface AssignmentResult {
  assignments: Assignment[];
  unplaced: string[];
}

export function assignCandidates(
  rankedCandidateIds: ReadonlyArray<string>,
  openSlots: ReadonlyArray<AssignSlot>,
  /** Existing booked count per interviewer id (so repeated runs stay balanced). */
  existingLoad: ReadonlyMap<string, number> = new Map(),
): AssignmentResult {
  const load = new Map<string, number>(existingLoad);
  const free = [...openSlots].sort((a, b) => a.start - b.start || (a.interviewerId < b.interviewerId ? -1 : a.interviewerId > b.interviewerId ? 1 : a.id < b.id ? -1 : 1));
  const used = new Set<string>();
  const seen = new Set<string>();
  const assignments: Assignment[] = [];
  const unplaced: string[] = [];

  for (const candidateId of rankedCandidateIds) {
    if (seen.has(candidateId)) continue; // never two slots for one candidate
    seen.add(candidateId);

    let best: AssignSlot | null = null;
    for (const slot of free) {
      if (used.has(slot.id)) continue;
      if (best === null) {
        best = slot;
        continue;
      }
      if (slot.start > best.start) break; // sorted: nothing earlier remains
      const a = load.get(slot.interviewerId) ?? 0;
      const b = load.get(best.interviewerId) ?? 0;
      if (a < b) best = slot;
    }
    if (best === null) {
      unplaced.push(candidateId);
      continue;
    }
    used.add(best.id);
    load.set(best.interviewerId, (load.get(best.interviewerId) ?? 0) + 1);
    assignments.push({ candidateId, slotId: best.id, interviewerId: best.interviewerId });
  }
  return { assignments, unplaced };
}

/** Invariant checker used by tests and by GET /schedule: counts double-booked interviewers and candidates. */
export function countConflicts(
  booked: ReadonlyArray<{ interviewerId: string; start: number; end: number; candidateId?: string }>,
): number {
  let conflicts = 0;
  const byInterviewer = new Map<string, Array<{ start: number; end: number }>>();
  const byCandidate = new Map<string, number>();
  for (const s of booked) {
    const list = byInterviewer.get(s.interviewerId) ?? [];
    for (const other of list) if (s.start < other.end && other.start < s.end) conflicts += 1;
    list.push({ start: s.start, end: s.end });
    byInterviewer.set(s.interviewerId, list);
    if (s.candidateId) {
      const n = (byCandidate.get(s.candidateId) ?? 0) + 1;
      byCandidate.set(s.candidateId, n);
      if (n > 1) conflicts += 1;
    }
  }
  return conflicts;
}
