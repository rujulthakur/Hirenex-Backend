import type { AssignSlot } from './assignment';

/**
 * Tries the planned slot first, then falls back to the next earliest open slot.
 * `tryBook` performs the ATOMIC conditional update (status "open" -> "booked") and returns false when someone
 * else already took the slot (SLOT_TAKEN). Returns the slot that was booked, or null when none could be booked.
 * The injected function keeps this testable without a database.
 */
export async function bookWithRetry(
  candidateId: string,
  preferred: AssignSlot,
  alternatives: ReadonlyArray<AssignSlot>,
  tryBook: (slotId: string, candidateId: string) => Promise<boolean>,
): Promise<AssignSlot | null> {
  const order = [preferred, ...[...alternatives].filter((s) => s.id !== preferred.id).sort((a, b) => a.start - b.start)];
  for (const slot of order) {
    if (await tryBook(slot.id, candidateId)) return slot;
  }
  return null;
}
