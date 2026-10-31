import { describe, expect, it } from 'vitest';
import { dueReminders, fastForwardReminders, isReminderEligible, type ReminderCandidateInvite } from '../../src/domain/reminders';

const NOW = Date.UTC(2026, 10, 1, 9, 0, 0);
const H = 3_600_000;
const inv = (over: Partial<ReminderCandidateInvite>): ReminderCandidateInvite => ({ inviteId: 'a', slotStartMs: NOW + 10 * H, emailStatus: 'sent', response: 'pending', superseded: false, ...over });

describe('reminders', () => {
  it('skips drafts, declined, superseded and past interviews', () => {
    expect(isReminderEligible(inv({ emailStatus: 'draft' }), NOW)).toBe(false);
    expect(isReminderEligible(inv({ response: 'declined' }), NOW)).toBe(false);
    expect(isReminderEligible(inv({ superseded: true }), NOW)).toBe(false);
    expect(isReminderEligible(inv({ slotStartMs: NOW - 1 }), NOW)).toBe(false);
    expect(isReminderEligible(inv({ emailStatus: 'viewed', response: 'accepted' }), NOW)).toBe(true);
  });
  it('24h and 1h windows', () => {
    const rows = [inv({ inviteId: 'near', slotStartMs: NOW + 30 * 60_000 }), inv({ inviteId: 'day', slotStartMs: NOW + 20 * H }), inv({ inviteId: 'far', slotStartMs: NOW + 48 * H })];
    expect(dueReminders(rows, '24h', NOW).sort()).toEqual(['day', 'near']);
    expect(dueReminders(rows, '1h', NOW)).toEqual(['near']);
  });
  it('fast-forward includes every eligible invite', () => {
    expect(fastForwardReminders([inv({ inviteId: 'far', slotStartMs: NOW + 48 * H }), inv({ inviteId: 'x', response: 'declined' })], NOW)).toEqual(['far']);
  });
});
