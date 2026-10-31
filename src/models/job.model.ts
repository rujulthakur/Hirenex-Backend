import { Schema, model, Types, InferSchemaType } from 'mongoose';
import { JOB_STATUSES, MEETING_FORMATS } from '../types/enums';

/**
 * jobs. criteriaHash = sha256 of the canonical criteria list; it is part of the LLM cache key so changing
 * criteria invalidates cached scores. Query patterns: list by owner newest first; read by _id.
 */
const criterionSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    weight: { type: Number, required: true, min: 1, max: 100 },
    description: { type: String, default: '' },
  },
  { _id: false },
);

const constraintsSchema = new Schema(
  {
    dates: { type: [String], required: true },
    dailyStart: { type: String, required: true },
    dailyEnd: { type: String, required: true },
    breaks: { type: [new Schema({ start: String, end: String }, { _id: false })], default: [] },
    timeZone: { type: String, required: true },
    format: { type: String, enum: MEETING_FORMATS, required: true },
    meetingLink: { type: String },
    location: { type: String },
  },
  { _id: false },
);

const jobSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, maxlength: 10_000 },
    requiredSkills: { type: [String], default: [] },
    preferredSkills: { type: [String], default: [] },
    criteria: {
      type: [criterionSchema],
      validate: {
        validator: (list: Array<{ weight: number }>) =>
          list.length >= 3 && Math.round(list.reduce((s, c) => s + c.weight, 0) * 100) / 100 === 100,
        message: 'criteria need at least 3 entries with weights summing to 100',
      },
    },
    capacity: { type: Number, required: true, min: 1 },
    waitlistSize: { type: Number, required: true, min: 0, default: 0 },
    interviewMinutes: { type: Number, required: true, min: 10 },
    constraints: { type: constraintsSchema, required: true },
    status: { type: String, enum: JOB_STATUSES, required: true, default: 'draft' },
    approvedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    criteriaHash: { type: String, required: true },
  },
  { timestamps: true },
);
jobSchema.index({ ownerId: 1, createdAt: -1 });
jobSchema.index({ status: 1, createdAt: -1 });

export type JobDoc = InferSchemaType<typeof jobSchema> & { _id: Types.ObjectId };
export const JobModel = model('Job', jobSchema, 'jobs');
