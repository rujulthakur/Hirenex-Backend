import { Schema, model, Types, InferSchemaType } from 'mongoose';
import { EMAIL_STATUSES, INVITE_RESPONSES } from '../types/enums';

/**
 * invites. Only the SHA-256 of the portal token is stored (tokenHash, unique); the raw token exists only in the
 * email link. expiresAt = earlier of 7 days or interview start. supersededBy points to the replacing invite
 * (old tokens are treated as expired). kind: invite | promotion | reschedule.
 * Query patterns: findOne({tokenHash}) for the portal; find({jobId}) for the status table; findOne({slotId}).
 */
export const INVITE_KINDS = ['invite', 'promotion', 'reschedule'] as const;
export type InviteKind = (typeof INVITE_KINDS)[number];

const inviteSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true },
    slotId: { type: Schema.Types.ObjectId, ref: 'Slot', required: true },
    tokenHash: { type: String, required: true, unique: true, minlength: 64, maxlength: 64 },
    expiresAt: { type: Date, required: true },
    subject: { type: String, required: true, maxlength: 300 },
    body: { type: String, required: true, maxlength: 20_000 },
    emailStatus: { type: String, enum: EMAIL_STATUSES, required: true, default: 'draft' },
    previewUrl: { type: String },
    response: { type: String, enum: INVITE_RESPONSES, required: true, default: 'pending' },
    respondedAt: { type: Date },
    supersededBy: { type: Schema.Types.ObjectId, ref: 'Invite' },
    kind: { type: String, enum: INVITE_KINDS, required: true, default: 'invite' },
  },
  { timestamps: true },
);
inviteSchema.index({ jobId: 1, emailStatus: 1 });
inviteSchema.index({ jobId: 1, candidateId: 1 });
inviteSchema.index({ slotId: 1 });

export type InviteDoc = InferSchemaType<typeof inviteSchema> & { _id: Types.ObjectId };
export const InviteModel = model('Invite', inviteSchema, 'invites');
