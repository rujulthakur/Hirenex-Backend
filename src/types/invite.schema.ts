import { z } from 'zod';
import { EMAIL_STATUSES, INVITE_RESPONSES } from './enums';
import { objectIdSchema } from './common';

export const patchInviteSchema = z
  .object({
    subject: z.string().min(1).max(300).optional(),
    body: z.string().min(1).max(20_000).optional(),
  })
  .refine((v) => v.subject !== undefined || v.body !== undefined, { message: 'Provide subject or body' });

export const rescheduleNoteSchema = z.object({ note: z.string().min(1).max(500) });

export const portalTokenParamsSchema = z.object({ token: z.string().min(20).max(100) });

export const inviteDtoSchema = z.object({
  id: objectIdSchema,
  candidateId: objectIdSchema,
  slotId: objectIdSchema,
  emailStatus: z.enum(EMAIL_STATUSES),
  response: z.enum(INVITE_RESPONSES),
  previewUrl: z.string().url().optional(),
  kind: z.enum(['invite', 'promotion', 'reschedule']),
});
export type InviteDto = z.infer<typeof inviteDtoSchema>;
