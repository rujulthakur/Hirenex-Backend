import { Schema, model, Types, InferSchemaType } from 'mongoose';

/**
 * syntheticLabels: AUDIT-ONLY. Synthetic group per candidate, used ONLY by the bias impact panel.
 * It must never influence scoring, ranking, shortlisting or scheduling. Enforced by an ESLint
 * no-restricted-imports rule (see .eslintrc.cjs): only the bias-panel service, the seeder and tests may import it.
 * It is intentionally NOT re-exported from src/models/index.ts.
 */
const syntheticLabelSchema = new Schema(
  {
    candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true, unique: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    group: { type: String, required: true, maxlength: 40 },
  },
  { timestamps: true },
);
syntheticLabelSchema.index({ jobId: 1, group: 1 });

export type SyntheticLabelDoc = InferSchemaType<typeof syntheticLabelSchema> & { _id: Types.ObjectId };
export const SyntheticLabelModel = model('SyntheticLabel', syntheticLabelSchema, 'syntheticLabels');
