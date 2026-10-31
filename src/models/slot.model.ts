import { Schema, model, Types, InferSchemaType } from 'mongoose';
import { SLOT_STATUSES } from '../types/enums';

/**
 * slots (UTC grid). timeZone is the interviewer's IANA zone so the client can render local time.
 * Atomic booking = findOneAndUpdate({_id, status:'open'}, {status:'booked', candidateId}); the unique
 * (interviewerId, start) index is the second guard against double-booking.
 * Query patterns: open slots for a job ordered by start; slots grouped by interviewer for the timeline.
 */
const slotSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    interviewerId: { type: Schema.Types.ObjectId, ref: 'Interviewer', required: true },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    timeZone: { type: String, required: true },
    status: { type: String, enum: SLOT_STATUSES, required: true, default: 'open' },
    candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate' },
  },
  { timestamps: true },
);
slotSchema.index({ interviewerId: 1, start: 1 }, { unique: true });
slotSchema.index({ jobId: 1, status: 1, start: 1 });
slotSchema.index({ jobId: 1, candidateId: 1 }, { sparse: true });

export type SlotDoc = InferSchemaType<typeof slotSchema> & { _id: Types.ObjectId };
export const SlotModel = model('Slot', slotSchema, 'slots');
