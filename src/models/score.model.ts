import { Schema, model, Types, InferSchemaType } from 'mongoose';
import { AUTHORITIES } from '../types/enums';

/**
 * scores. One document per candidate. cacheKey = sha256(redactedText + criteriaHash + promptId + model);
 * a hit lets the gateway skip the LLM and records cachedFrom. Query patterns: findOne({candidateId});
 * find({jobId}) for ranking and rerank (no LLM); findOne({cacheKey}) for cache lookups.
 */
const perCriterionSchema = new Schema(
  {
    criterionId: { type: String, required: true },
    score: { type: Number, required: true, min: 0, max: 10, validate: Number.isInteger },
    quote: { type: String, default: '' },
    location: {
      type: new Schema({ start: Number, end: Number }, { _id: false }),
      default: null,
    },
    verified: { type: Boolean, required: true, default: false },
    confidence: { type: Number, min: 0, max: 1, default: 0 },
    missing: { type: Boolean, required: true, default: false },
    authority: { type: String, enum: AUTHORITIES, required: true, default: 'ai' },
    overriddenBy: { type: Schema.Types.ObjectId, ref: 'User' },
    overrideReason: { type: String },
    originalScore: { type: Number, min: 0, max: 10 },
  },
  { _id: false },
);

const scoreSchema = new Schema(
  {
    candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true, unique: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    perCriterion: { type: [perCriterionSchema], default: [] },
    total: { type: Number, required: true, min: 0, max: 100 },
    promptId: { type: String, required: true },
    model: { type: String, required: true },
    cacheKey: { type: String },
    /** Set when HR opens the evidence drawer (GET /candidates/:id/scores). Feeds the portal's "a human reviewed this". */
    evidenceOpenedAt: { type: Date },
    cachedFrom: { type: Schema.Types.ObjectId, ref: 'Score' },
    /** Validated LLM output (skills, years, projects, per-criterion proposals) kept for cache hits. Never exposed by the API. */
    rawOutput: { type: Schema.Types.Mixed },
    probeQuestions: { type: [String], default: [] },
  },
  { timestamps: true },
);
scoreSchema.index({ jobId: 1 });
scoreSchema.index({ cacheKey: 1 }, { sparse: true });

export type ScoreDoc = InferSchemaType<typeof scoreSchema> & { _id: Types.ObjectId };
export const ScoreModel = model('Score', scoreSchema, 'scores');
