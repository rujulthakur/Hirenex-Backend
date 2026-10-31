/** PURE reminder planning (P2). Which invites should get which reminder right now. */
export type ReminderKind = '24h' | '1h';

export interface ReminderCandidateInvite {
  inviteId: string;
  slotStartMs: number;
  emailStatus: string;
  response: string;
  superseded: boolean;
}

export const REMINDER_LEAD_MS: Readonly<Record<ReminderKind, number>> = { '24h': 24 * 3_600_000, '1h': 3_600_000 };

/** Invites that were sent, not declined, not superseded, and whose interview is still ahead. */
export function isReminderEligible(i: ReminderCandidateInvite, nowMs: number): boolean {
  if (i.superseded) return false;
  if (i.emailStatus !== 'sent' && i.emailStatus !== 'viewed') return false;
  if (i.response === 'declined') return false;
  return i.slotStartMs > nowMs;
}

/** Real schedule: due when the interview is within the lead time (and still in the future). */
export function dueReminders(invites: readonly ReminderCandidateInvite[], kind: ReminderKind, nowMs: number): string[] {
  return invites
    .filter((i) => isReminderEligible(i, nowMs) && i.slotStartMs - nowMs <= REMINDER_LEAD_MS[kind])
    .map((i) => i.inviteId);
}

/** Demo fast-forward: every eligible invite is treated as due. */
export function fastForwardReminders(invites: readonly ReminderCandidateInvite[], nowMs: number): string[] {
  return invites.filter((i) => isReminderEligible(i, nowMs)).map((i) => i.inviteId);
}
