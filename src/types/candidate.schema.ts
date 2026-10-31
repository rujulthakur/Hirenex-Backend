import { z } from 'zod';
import { CANDIDATE_FLAGS, CANDIDATE_STAGES, HIDDEN_FINDING_TYPES } from './enums';
import { objectIdSchema } from './common';

export const listCandidatesQuerySchema = z.object({
  stage: z.enum(CANDIDATE_STAGES).optional(),
  q: z.string().max(100).optional(),
  history: z.enum(['1', 'true']).optional(),
  sort: z.string().regex(/^-?[a-zA-Z]+$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const patchCandidateSchema = z.object({ notes: z.string().max(2000) });

export const hiddenFindingSchema = z.object({
  type: z.enum(HIDDEN_FINDING_TYPES),
  text: z.string().max(2000),
  location: z.string().max(200),
});

export const candidateFlagSchema = z.enum(CANDIDATE_FLAGS);

export const overrideScoreSchema = z.object({
  score: z.number().int().min(0).max(10),
  reason: z.string().min(10, 'Reason must be at least 10 characters').max(500),
});
export const scoreParamsSchema = z.object({ id: objectIdSchema, criterionId: z.string().min(1) });

export const perCriterionScoreSchema = z.object({
  criterionId: z.string(),
  score: z.number().int().min(0).max(10),
  quote: z.string(),
  location: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).nullable(),
  verified: z.boolean(),
  confidence: z.number().min(0).max(1),
  missing: z.boolean(),
  authority: z.enum(['ai', 'code', 'human']),
  overriddenBy: objectIdSchema.optional(),
  overrideReason: z.string().optional(),
  originalScore: z.number().int().min(0).max(10).optional(),
});
export type PerCriterionScore = z.infer<typeof perCriterionScoreSchema>;
