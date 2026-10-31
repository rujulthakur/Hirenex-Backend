import { z } from 'zod';
import { objectIdSchema } from './common';

export const auditQuerySchema = z.object({
  actor: z.string().max(80).optional(),
  action: z.string().max(80).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export const auditEntrySchema = z.object({
  seq: z.number().int().min(1),
  ts: z.string().datetime(),
  actor: z.object({ id: z.string(), role: z.string(), name: z.string() }),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  jobId: objectIdSchema.optional(),
  oldValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
  payload: z.unknown().optional(),
  prevHash: z.string().length(64),
  hash: z.string().length(64),
});
export type AuditEntryDto = z.infer<typeof auditEntrySchema>;

/** Action names used across the system. */
export const AUDIT_ACTIONS = [
  'auth.login', 'auth.logout', 'auth.refresh_reuse_detected', 'job.create', 'job.update', 'resume.upload', 'score.run',
  'score.override', 'shortlist.approve', 'schedule.run', 'slot.booked', 'repair.decline',
  'repair.unavailable', 'invite.draft', 'invite.edit', 'invite.send', 'invite.delivery', 'portal.accept',
  'portal.decline', 'portal.reschedule', 'candidate.delete', 'candidate.note', 'demo.seed', 'demo.reset', 'demo.qr', 'demo.reminders', 'candidate.near_duplicate', 'candidate.rank_unstable', 'demo.login',
  'audit.verify',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
