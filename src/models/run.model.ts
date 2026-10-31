import { Schema, model, Types, InferSchemaType } from 'mongoose';

/**
 * runs: progress of long in-process jobs (scoring, scheduling). The client polls every 3 s.
 * Query patterns: findById(runId); latest run of a type for a job.
 */
export const RUN_TYPES = ['scoring', 'scheduling'] as const;
export const RUN_STATES = ['queued', 'running', 'done', 'failed'] as const;
export type RunType = (typeof RUN_TYPES)[number];
export type RunState = (typeof RUN_STATES)[number];

const runSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    type: { type: String, enum: RUN_TYPES, required: true },
    state: { type: String, enum: RUN_STATES, required: true, default: 'queued' },
    done: { type: Number, required: true, default: 0, min: 0 },
    total: { type: Number, required: true, default: 0, min: 0 },
    failures: {
      type: [
        new Schema(
          {
            candidateId: { type: String },
            fileName: { type: String },
            reason: { type: String, required: true, maxlength: 300 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true },
);
runSchema.index({ jobId: 1, type: 1, createdAt: -1 });

export type RunDoc = InferSchemaType<typeof runSchema> & { _id: Types.ObjectId };
export const RunModel = model('Run', runSchema, 'runs');
