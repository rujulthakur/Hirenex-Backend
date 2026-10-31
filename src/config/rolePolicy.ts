import type { Role } from '../types/enums';

/**
 * Rule table: which roles may call which route group.
 *   'public'  = no cookie needed (portal routes use their own signed token; auth entry points are open)
 *   'session' = any signed-in role
 *   Role[]    = only those roles
 *
 * | route group                                                         | hr_admin | demo_hr | interviewer            | public |
 * |---------------------------------------------------------------------|----------|---------|------------------------|--------|
 * | auth entry (send-otp, verify-otp, google, demo-login, refresh)      |          |         |                        | yes    |
 * | auth session (me, logout)                                           | yes      | yes     | yes                    |        |
 * | jobs, resumes, candidates, scoring, shortlist, invites, audit,      | yes      | yes     | no                     |        |
 * |   analytics, trace, notifications, demo (seed/reset/qr)             |          |         |                        |        |
 * | schedule READ (GET /jobs/:id/schedule)                              | yes      | yes     | own slots only (filter)|        |
 * | schedule WRITE (schedule, unavailable, repairs, shortfall)          | yes      | yes     | no                     |        |
 * | portal (/portal/:token/*)                                           |          |         |                        | yes    |
 */
export const HR_ROLES: readonly Role[] = ['hr_admin', 'demo_hr'];
export const ALL_ROLES: readonly Role[] = ['hr_admin', 'demo_hr', 'interviewer'];

export const ROLE_POLICY = {
  authEntry: 'public',
  authSession: 'session',
  jobs: HR_ROLES,
  resumes: HR_ROLES,
  candidates: HR_ROLES,
  scoring: HR_ROLES,
  shortlist: HR_ROLES,
  scheduleRead: ALL_ROLES,
  scheduleWrite: HR_ROLES,
  invites: HR_ROLES,
  audit: HR_ROLES,
  analytics: HR_ROLES,
  trace: HR_ROLES,
  notifications: HR_ROLES,
  demo: HR_ROLES,
  portal: 'public',
} as const satisfies Record<string, 'public' | 'session' | readonly Role[]>;

export type RouteGroup = keyof typeof ROLE_POLICY;
