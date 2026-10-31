import { Schema, model, Types, InferSchemaType } from 'mongoose';
import { CANDIDATE_FLAGS, CANDIDATE_STAGES, FILE_TYPES, HIDDEN_FINDING_TYPES } from '../types/enums';

/**
 * candidates. Holds REDACTED text only; original text is in candidateTexts (originalTextRef).
 * Query patterns: list by job + stage + rank/total; search by q; duplicate check on (jobId, uploadedBy, textHash).
 */
const candidateSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    fileName: { type: String, required: true, maxlength: 255 },
    fileType: { type: String, enum: FILE_TYPES, required: true },
    textHash: { type: String, required: true, minlength: 64, maxlength: 64 },
    /** Account that uploaded this resume. Duplicate detection is scoped to (jobId, uploadedBy, textHash). */
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    originalTextRef: { type: Schema.Types.ObjectId, ref: 'CandidateText' },
    redactedText: { type: String, default: '' },
    /** Contact and summary details for the HR view, extracted from the original text at upload. Never sent to the scoring model. */
    profile: {
      type: new Schema(
        {
          name: { type: String, default: '' },
          email: { type: String, default: '' },
          phone: { type: String, default: '' },
          location: { type: String, default: '' },
          links: { type: [String], default: [] },
          skills: { type: [String], default: [] },
          keyPoints: { type: [String], default: [] },
        },
        { _id: false },
      ),
      default: undefined,
    },
    parsedSkills: { type: [String], default: [] },
    yearsExperience: { type: Number, min: 0, max: 60 },
    projects: { type: [String], default: [] },
    flags: { type: [String], enum: CANDIDATE_FLAGS, default: [] },
    hiddenFindings: {
      type: [
        new Schema(
          {
            type: { type: String, enum: HIDDEN_FINDING_TYPES, required: true },
            text: { type: String, required: true },
            location: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    stage: { type: String, enum: CANDIDATE_STAGES, required: true, default: 'applied' },
    rank: { type: Number },
    totalScore: { type: Number },
    tieBreakTrace: { type: [String], default: undefined },
    coverage: { type: Number, min: 0, max: 1 },
    verifiedEvidenceCount: { type: Number, min: 0 },
    uploadOrder: { type: Number, required: true },
    notes: { type: String, default: '', maxlength: 2000 },
    /** Review timeline. reviewStartedAt restarts the auto-reject clock (set when HR moves a candidate back to review); otherwise createdAt is used. */
    reviewStartedAt: { type: Date },
    holdUntil: { type: Date },
    /** Stage the candidate was in before HR (or the sweeper) put them on hold or rejected them. "Back to review" restores it. */
    prevStage: { type: String, enum: CANDIDATE_STAGES },
    decidedAt: { type: Date },
    decidedBy: { type: String, enum: ['hr', 'system'] },
    rejectionReason: { type: String, enum: ['hr_rejected', 'no_response', 'hold_expired'] },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
candidateSchema.index({ jobId: 1, uploadedBy: 1, textHash: 1 }, { unique: true });
candidateSchema.index({ jobId: 1, stage: 1, rank: 1 });
candidateSchema.index({ jobId: 1, totalScore: -1 });
candidateSchema.index({ jobId: 1, uploadOrder: 1 });
candidateSchema.index({ jobId: 1, deletedAt: 1 });
candidateSchema.index({ stage: 1, createdAt: 1 });
candidateSchema.index({ stage: 1, holdUntil: 1 });

export type CandidateDoc = InferSchemaType<typeof candidateSchema> & { _id: Types.ObjectId };
export const CandidateModel = model('Candidate', candidateSchema, 'candidates');
