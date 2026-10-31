import { z } from 'zod';

/** Strict output schemas (no extra keys) for every prompt in the registry. */

export const criterionScoreSchema = z
  .object({
    criterionId: z.string().min(1),
    score: z.number().int().min(0).max(10),
    quote: z.string().max(600),
    confidence: z.number().min(0).max(1),
    missing: z.boolean(),
    reason: z.string().max(500),
  })
  .strict()
  .refine((c) => !c.missing || c.score === 0, { message: 'missing=true requires score 0', path: ['score'] });

export const extractAndScoreSchema = z
  .object({
    skills: z.array(z.string().min(1).max(80)).max(60),
    yearsExperience: z.number().min(0).max(60),
    projects: z
      .array(z.object({ name: z.string().min(1).max(160), description: z.string().max(500) }).strict())
      .max(20),
    criteria: z.array(criterionScoreSchema).min(1),
  })
  .strict();
export type ExtractAndScoreOutput = z.infer<typeof extractAndScoreSchema>;

export const draftEmailSchema = z
  .object({
    subject: z.string().min(3).max(160),
    body: z.string().min(20).max(2000),
  })
  .strict();
export type DraftEmailOutput = z.infer<typeof draftEmailSchema>;

export const probeQuestionsSchema = z
  .object({ questions: z.array(z.string().min(10).max(300)).min(3).max(5) })
  .strict();
export type ProbeQuestionsOutput = z.infer<typeof probeQuestionsSchema>;

export const candidateSummarySchema = z
  .object({ summary: z.string().min(20).max(700) })
  .strict();
export type CandidateSummaryOutput = z.infer<typeof candidateSummarySchema>;
