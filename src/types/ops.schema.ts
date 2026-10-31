import { z } from 'zod';
import { objectIdSchema } from './common';

export const runStatusSchema = z.object({
  runId: objectIdSchema,
  state: z.enum(['queued', 'running', 'done', 'failed']),
  done: z.number().int().min(0),
  total: z.number().int().min(0),
  failures: z.array(z.object({ candidateId: z.string().optional(), fileName: z.string().optional(), reason: z.string() })),
});

export const aiTraceSchema = z.object({
  tool: z.string(),
  inputSummary: z.string(),
  outputSummary: z.string(),
  durationMs: z.number().min(0),
  status: z.enum(['ok', 'error', 'fallback']),
  model: z.string().optional(),
  promptId: z.string().optional(),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
  error: z.string().optional(),
  ts: z.string().datetime(),
});

export const notificationDtoSchema = z.object({
  id: objectIdSchema,
  type: z.string(),
  title: z.string(),
  body: z.string(),
  readAt: z.string().datetime().optional(),
  ts: z.string().datetime(),
});
export const markReadSchema = z.object({ ids: z.array(objectIdSchema).optional() });

export const syntheticLabelInputSchema = z.object({ candidateId: objectIdSchema, group: z.string().min(1).max(40) });
