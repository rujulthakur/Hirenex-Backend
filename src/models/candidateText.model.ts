import { Schema, model, Types, InferSchemaType } from 'mongoose';

/**
 * candidateTexts. ORIGINAL (un-redacted) resume text lives here and nowhere else, so it can never leak into
 * API payloads, LLM calls or logs by accident. Read only by: email personalisation (first name) and the swap test.
 * Rule: repositories never join this collection into candidate list/detail responses.
 */
const candidateTextSchema = new Schema(
  {
    candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true, unique: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    text: { type: String, required: true, select: false },
  },
  { timestamps: true },
);
candidateTextSchema.index({ jobId: 1 });

export type CandidateTextDoc = InferSchemaType<typeof candidateTextSchema> & { _id: Types.ObjectId };
export const CandidateTextModel = model('CandidateText', candidateTextSchema, 'candidateTexts');
