import { Schema, model, Types, InferSchemaType } from 'mongoose';

/**
 * aiTraces: one row per agent tool call (parse_resume, scan_hidden_text, score, verify_quotes, rank, schedule).
 * Never stores raw resume text: only lengths, hashes and short summaries. TTL 30 days.
 * Query patterns: latest 100 for a job (jobId, ts desc); all rows for a run.
 */
export const TRACE_STATUSES = ['ok', 'error', 'fallback'] as const;

const aiTraceSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    runId: { type: String, required: true },
    tool: { type: String, required: true },
    inputSummary: { type: String, default: '', maxlength: 300 },
    outputSummary: { type: String, default: '', maxlength: 300 },
    durationMs: { type: Number, required: true, min: 0 },
    status: { type: String, enum: TRACE_STATUSES, required: true },
    model: { type: String },
    promptId: { type: String },
    tokensIn: { type: Number },
    tokensOut: { type: Number },
    error: { type: String, maxlength: 300 },
    ts: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);
aiTraceSchema.index({ jobId: 1, ts: -1 });
aiTraceSchema.index({ runId: 1, ts: 1 });
aiTraceSchema.index({ ts: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export type AiTraceDoc = InferSchemaType<typeof aiTraceSchema> & { _id: Types.ObjectId };
export const AiTraceModel = model('AiTrace', aiTraceSchema, 'aiTraces');
