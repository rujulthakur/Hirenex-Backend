import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { authorize, authorizeGroup } from '../../src/middleware/authorize';
import { requireDemoMode } from '../../src/middleware/demoGate';
import { ROLE_POLICY } from '../../src/config/rolePolicy';
import type { Role } from '../../src/types/enums';

function run(mw: ReturnType<typeof authorize>, role?: Role): unknown {
  const req = { user: role ? { id: 'a'.repeat(24), email: 'x@y.z', name: 'x', role, isDemo: false } : undefined } as unknown as Request;
  const next = vi.fn();
  mw(req, {} as Response, next);
  return next.mock.calls[0]?.[0];
}

describe('authorize', () => {
  it('rejects anonymous users with UNAUTHENTICATED', () => {
    expect(run(authorize('hr_admin'))).toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('rejects a role outside the list with FORBIDDEN', () => {
    expect(run(authorize('hr_admin', 'demo_hr'), 'interviewer')).toMatchObject({ code: 'FORBIDDEN' });
  });
  it('allows a listed role', () => {
    expect(run(authorize('hr_admin'), 'hr_admin')).toBeUndefined();
  });
});

describe('rule table (authorizeGroup)', () => {
  it('lets hr_admin and demo_hr into HR groups, blocks interviewers', () => {
    for (const group of ['jobs', 'candidates', 'scoring', 'shortlist', 'invites', 'audit', 'scheduleWrite'] as const) {
      expect(run(authorizeGroup(group), 'hr_admin')).toBeUndefined();
      expect(run(authorizeGroup(group), 'demo_hr')).toBeUndefined();
      expect(run(authorizeGroup(group), 'interviewer')).toMatchObject({ code: 'FORBIDDEN' });
    }
  });
  it('lets interviewers read the schedule', () => {
    expect(run(authorizeGroup('scheduleRead'), 'interviewer')).toBeUndefined();
  });
  it('session groups need a signed-in user of any role', () => {
    expect(run(authorizeGroup('authSession'))).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(run(authorizeGroup('authSession'), 'interviewer')).toBeUndefined();
  });
  it('portal and auth entry are public in the table', () => {
    expect(ROLE_POLICY.portal).toBe('public');
    expect(ROLE_POLICY.authEntry).toBe('public');
  });
});

describe('requireDemoMode', () => {
  it('404s when disabled and passes when enabled', () => {
    const off = vi.fn();
    requireDemoMode(() => false)({} as Request, {} as Response, off);
    expect(off.mock.calls[0]?.[0]).toMatchObject({ code: 'NOT_FOUND' });
    const on = vi.fn();
    requireDemoMode(() => true)({} as Request, {} as Response, on);
    expect(on.mock.calls[0]?.[0]).toBeUndefined();
  });
});
