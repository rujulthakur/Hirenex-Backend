import { Schema, model, Types, InferSchemaType } from 'mongoose';

/**
 * interviewers (per job). Each has its own IANA zone. PUT replaces the whole list for a job.
 * Query patterns: find({jobId}); deleteMany({jobId}) on replace.
 */
const interviewerSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    timeZone: { type: String, required: true },
    availability: {
      type: [new Schema({ date: String, start: String, end: String }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true },
);
interviewerSchema.index({ jobId: 1 });

export type InterviewerDoc = InferSchemaType<typeof interviewerSchema> & { _id: Types.ObjectId };
export const InterviewerModel = model('Interviewer', interviewerSchema, 'interviewers');
