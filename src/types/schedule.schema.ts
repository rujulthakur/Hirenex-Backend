import { z } from 'zod';
import { SLOT_STATUSES } from './enums';
import { ianaZoneSchema, isoDateSchema, objectIdSchema } from './common';

export const slotSchema = z.object({
  id: objectIdSchema,
  jobId: objectIdSchema,
  interviewerId: objectIdSchema,
  start: isoDateSchema,
  end: isoDateSchema,
  timeZone: ianaZoneSchema,
  status: z.enum(SLOT_STATUSES),
  candidateId: objectIdSchema.optional(),
});
export type SlotDto = z.infer<typeof slotSchema>;

export const unavailableSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((v) => new Date(v.from) < new Date(v.to), { message: 'from must be before to', path: ['to'] });

export const approveSchema = z.object({
  shortlistIds: z.array(objectIdSchema).min(1),
  waitlistIds: z.array(objectIdSchema).default([]),
});

export const rerankSchema = z.object({
  weights: z.record(z.string().min(1), z.number().min(0).max(100)),
});

export const repairShapeSchema = z.object({
  before: z.array(z.unknown()),
  after: z.array(z.unknown()),
  moved: z.array(z.object({ candidateId: objectIdSchema, fromSlotId: objectIdSchema, toSlotId: objectIdSchema })),
  unplaced: z.array(objectIdSchema),
});
