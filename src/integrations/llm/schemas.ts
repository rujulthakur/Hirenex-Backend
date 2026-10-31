import { z } from 'zod';

/** Strict output schemas (no extra keys) for every prompt in the registry. */

/**
 * The scoring answer is validated leniently on purpose: models often return 7.5 instead of 7, a string instead of a
 * number, null for an empty quote, or one extra key. None of that makes the answer wrong, so we clean it up here
 * instead of throwing the whole resume away. What still fails: no criteria at all, or no usable criterionId.
 * Code (quote verification) remains the authority on whether a score counts.
 */
const toNumber = (fallback: number) => (v: unknown): unknown => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'string') {
    const n = Number(v.trim().replace(/\/10$/, ''));
    return Number.isFinite(n) ? n : fallback;
  }
  return v;
};
const toBool = (v: unknown): unknown => (typeof v === 'string' ? /^(true|yes|1)$/i.test(v.trim()) : v ?? false);
const clampInt = (min: number, max: number) => (n: number): number => Math.min(max, Math.max(min, Math.round(n)));

export const criterionScoreSchema = z
  .object({
    criterionId: z.preprocess((v) => (typeof v === 'number' ? String(v) : v), z.string().trim().min(1)),
    score: z.preprocess(toNumber(0), z.number()).transform(clampInt(0, 10)),
    quote: z.preprocess((v) => (typeof v === 'string' ? v : ''), z.string()).transform((q) => q.slice(0, 600)),
    confidence: z.preprocess(toNumber(0.5), z.number()).transform((n) => Math.min(1, Math.max(0, n))),
    missing: z.preprocess(toBool, z.boolean()),
    reason: z.preprocess((v) => (typeof v === 'string' ? v : ''), z.string()).transform((r) => r.slice(0, 500)),
  })
  .transform((c) => (c.missing ? { ...c, score: 0 } : c));

const lenientStrings = (max: number, maxLen: number) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter((x) => x.length > 0) : []),
    z.array(z.string()),
  ).transform((a) => a.map((x) => x.slice(0, maxLen)).slice(0, max));

const projectSchema = z.preprocess(
  (v) => (typeof v === 'string' ? { name: v, description: '' } : v),
  z.object({
    name: z.preprocess((v) => (typeof v === 'string' ? v.trim() : ''), z.string().min(1)).transform((n) => n.slice(0, 160)),
    description: z.preprocess((v) => (typeof v === 'string' ? v : ''), z.string()).transform((d) => d.slice(0, 500)),
  }),
);

export const extractAndScoreSchema = z.object({
  skills: lenientStrings(60, 80),
  yearsExperience: z.preprocess(toNumber(0), z.number()).transform((n) => Math.min(60, Math.max(0, n))),
  projects: z
    .preprocess((v) => (Array.isArray(v) ? v.filter((p) => projectSchema.safeParse(p).success) : []), z.array(projectSchema))
    .transform((a) => a.slice(0, 20)),
  criteria: z.array(criterionScoreSchema).min(1),
});
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

/** Job document reading. Lenient like the scoring schema: clean up harmless quirks, only fail when nothing usable came back. */
const strList = (max: number) =>
  z
    .preprocess((v) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []), z.array(z.string()))
    .transform((a) => a.slice(0, max));
const optNumber = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
}, z.number().optional());

export const jobImportSchema = z.object({
  title: z.preprocess((v) => (typeof v === 'string' ? v.trim() : ''), z.string()),
  description: z.preprocess((v) => (typeof v === 'string' ? v.trim() : ''), z.string()),
  requiredSkills: strList(40),
  preferredSkills: strList(40),
  criteria: z
    .preprocess(
      (v) =>
        Array.isArray(v)
          ? v
              .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
              .map((c) => ({
                name: typeof c.name === 'string' ? c.name : '',
                weight: typeof c.weight === 'string' ? Number(c.weight) || 1 : typeof c.weight === 'number' ? c.weight : 1,
                description: typeof c.description === 'string' ? c.description : '',
              }))
          : [],
      z.array(z.object({ name: z.string(), weight: z.number(), description: z.string() })),
    )
    .transform((a) => a.slice(0, 12)),
  openings: optNumber,
  interviewMinutes: optNumber,
});
export type JobImportOutput = z.infer<typeof jobImportSchema>;
