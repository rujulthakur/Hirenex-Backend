import { z } from 'zod';
import { JOB_STATUSES, MEETING_FORMATS } from './enums';
import { dateOnlySchema, ianaZoneSchema, objectIdSchema, timeOfDaySchema } from './common';

export const criterionSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  weight: z.number().min(1).max(100),
  description: z.string().max(500).default(''),
});

export const constraintsSchema = z
  .object({
    dates: z.array(dateOnlySchema).min(1).max(31),
    dailyStart: timeOfDaySchema,
    dailyEnd: timeOfDaySchema,
    breaks: z.array(z.object({ start: timeOfDaySchema, end: timeOfDaySchema })).max(6).default([]),
    timeZone: ianaZoneSchema,
    format: z.enum(MEETING_FORMATS),
    meetingLink: z.string().url().optional(),
    location: z.string().max(200).optional(),
  })
  .refine((c) => c.dailyStart < c.dailyEnd, { message: 'dailyStart must be before dailyEnd', path: ['dailyEnd'] })
  .refine((c) => c.format !== 'virtual' || !!c.meetingLink, {
    message: 'meetingLink is required for virtual interviews',
    path: ['meetingLink'],
  })
  .refine((c) => c.format !== 'physical' || !!c.location, {
    message: 'location is required for physical interviews',
    path: ['location'],
  });

const criteriaListSchema = z
  .array(criterionSchema)
  .min(3, 'At least 3 criteria are required')
  .refine((list) => Math.round(list.reduce((sum, c) => sum + c.weight, 0) * 100) / 100 === 100, {
    message: 'Criteria weights must sum to 100',
  })
  .refine((list) => new Set(list.map((c) => c.id)).size === list.length, {
    message: 'Criterion ids must be unique',
  });

export const createJobSchema = z.object({
  title: z.string().min(2).max(160),
  description: z.string().min(10).max(10_000),
  requiredSkills: z.array(z.string().min(1).max(60)).min(1).max(40),
  preferredSkills: z.array(z.string().min(1).max(60)).max(40).default([]),
  criteria: criteriaListSchema,
  capacity: z.number().int().min(1).max(200),
  waitlistSize: z.number().int().min(0).max(200).default(0),
  interviewMinutes: z.number().int().min(10).max(240),
  constraints: constraintsSchema,
});
export type CreateJobInput = z.infer<typeof createJobSchema>;

export const updateJobSchema = createJobSchema.partial().extend({
  status: z.enum(JOB_STATUSES).optional(),
});
export type UpdateJobInput = z.infer<typeof updateJobSchema>;

export const jobParamsSchema = z.object({ id: objectIdSchema });

export const interviewerInputSchema = z.object({
  name: z.string().min(1).max(120),
  timeZone: ianaZoneSchema,
  availability: z
    .array(z.object({ date: dateOnlySchema, start: timeOfDaySchema, end: timeOfDaySchema }))
    .min(1)
    .max(62),
});
export const replaceInterviewersSchema = z.object({
  interviewers: z.array(interviewerInputSchema).min(1).max(20),
});
export type ReplaceInterviewersInput = z.infer<typeof replaceInterviewersSchema>;
