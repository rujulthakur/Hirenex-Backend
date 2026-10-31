import { Schema, model, Types, InferSchemaType } from 'mongoose';
import { EMAIL_STATUSES } from '../types/enums';

export const MEETING_STATUSES = ['scheduled', 'cancelled'] as const;

/**
 * meetings. One row per invited candidate. The HR user is the only interviewer, so a meeting is just a time window
 * and the shared Google Meet link that was current when the invite was sent.
 */
const meetingSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    meetLink: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: MEETING_STATUSES, required: true, default: 'scheduled' },
    emailStatus: { type: String, enum: EMAIL_STATUSES, required: true, default: 'queued' },
    previewUrl: { type: String },
  },
  { timestamps: true },
);
meetingSchema.index({ ownerId: 1, status: 1, start: 1 });
meetingSchema.index({ jobId: 1, status: 1, start: 1 });
meetingSchema.index({ candidateId: 1, status: 1 });
// Hard guarantee against two interviews at the same time for one HR user, even if two sends run together.
meetingSchema.index({ ownerId: 1, start: 1 }, { unique: true, partialFilterExpression: { status: 'scheduled' } });

export type MeetingDoc = InferSchemaType<typeof meetingSchema> & { _id: Types.ObjectId };
export const MeetingModel = model('Meeting', meetingSchema, 'meetings');
