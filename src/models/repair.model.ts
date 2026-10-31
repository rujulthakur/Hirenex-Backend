import { Schema, model, Types, InferSchemaType } from 'mongoose';

/**
 * repairs: before/after snapshots of the schedule around a decline or an interviewer becoming unavailable.
 * Query patterns: latest repairs for a job (jobId, ts desc) for the timeline diff.
 */
export const REPAIR_TRIGGERS = ['decline', 'interviewer_unavailable'] as const;
export type RepairTrigger = (typeof REPAIR_TRIGGERS)[number];

const placementSchema = new Schema(
  {
    slotId: { type: Schema.Types.ObjectId, ref: 'Slot', required: true },
    interviewerId: { type: Schema.Types.ObjectId, ref: 'Interviewer', required: true },
    candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate' },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
  },
  { _id: false },
);

const movedSchema = new Schema(
  {
    candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true },
    fromSlotId: { type: Schema.Types.ObjectId, ref: 'Slot', required: true },
    toSlotId: { type: Schema.Types.ObjectId, ref: 'Slot', required: true },
  },
  { _id: false },
);

const repairSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    trigger: { type: String, enum: REPAIR_TRIGGERS, required: true },
    before: { type: [placementSchema], default: [] },
    after: { type: [placementSchema], default: [] },
    moved: { type: [movedSchema], default: [] },
    unplaced: { type: [{ type: Schema.Types.ObjectId, ref: 'Candidate' }], default: [] },
    promotedCandidateId: { type: Schema.Types.ObjectId, ref: 'Candidate' },
    note: { type: String, maxlength: 300 },
    ts: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);
repairSchema.index({ jobId: 1, ts: -1 });

export type RepairDoc = InferSchemaType<typeof repairSchema> & { _id: Types.ObjectId };
export const RepairModel = model('Repair', repairSchema, 'repairs');
