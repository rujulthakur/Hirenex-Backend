import { z } from 'zod';
import { ianaZoneSchema, objectIdSchema, timeOfDaySchema } from './common';

export const sendMeetingsSchema = z.object({ candidateIds: z.array(objectIdSchema).min(1).max(100) });

export const meetingSettingsSchema = z
  .object({
    windowStart: timeOfDaySchema,
    windowEnd: timeOfDaySchema,
    slotMinutes: z.number().int().min(10).max(180),
    meetLink: z.string().url().max(500).refine((u) => u.startsWith('https://'), 'Use a full https:// link').or(z.literal('')),
    timeZone: ianaZoneSchema,
    companyName: z.string().trim().max(120),
  })
  .partial();
