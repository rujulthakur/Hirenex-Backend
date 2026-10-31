import { Types } from 'mongoose';
import { InviteModel, type InviteKind } from '../models/invite.model';
import type { InviteResponse } from '../types/enums';
import { sha256Hex } from '../utils/crypto';

export interface InviteLean {
  _id: Types.ObjectId;
  jobId: Types.ObjectId;
  candidateId: Types.ObjectId;
  slotId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  subject: string;
  body: string;
  emailStatus: string;
  response: InviteResponse;
  respondedAt?: Date;
  supersededBy?: Types.ObjectId;
  kind: InviteKind;
}

export interface NewInviteDraft {
  jobId: string;
  candidateId: string;
  slotId: string;
  tokenHash: string;
  expiresAt: Date;
  subject: string;
  body: string;
  kind: InviteKind;
}

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

/** Portal lookup. The raw token is hashed here; only the hash is ever stored or queried. */
async function findByRawToken(rawToken: string): Promise<InviteLean | null> {
  return InviteModel.findOne({ tokenHash: sha256Hex(rawToken) }).lean<InviteLean | null>().exec();
}

async function findById(inviteId: string): Promise<InviteLean | null> {
  if (!Types.ObjectId.isValid(inviteId)) return null;
  return InviteModel.findById(inviteId).lean<InviteLean | null>().exec();
}

/** Newest live (not superseded) invite for a candidate in a job. */
async function findLiveForCandidate(jobId: string, candidateId: string): Promise<InviteLean | null> {
  return InviteModel.findOne({ jobId: oid(jobId), candidateId: oid(candidateId), supersededBy: { $exists: false } })
    .sort({ createdAt: -1 })
    .lean<InviteLean | null>()
    .exec();
}

/**
 * IDEMPOTENCY GUARD. One conditional update: the response only changes while it is still "pending" (or for a
 * reschedule request, still "pending" or "accepted"). A null result means somebody already responded, so the
 * caller must NOT repeat any side effect (a replayed decline can never promote twice).
 */
async function respondIfPending(inviteId: string, response: Exclude<InviteResponse, 'pending'>, allowFrom: InviteResponse[] = ['pending']): Promise<InviteLean | null> {
  return InviteModel.findOneAndUpdate(
    { _id: oid(inviteId), response: { $in: allowFrom }, supersededBy: { $exists: false } },
    { $set: { response, respondedAt: new Date() } },
    { new: true },
  )
    .lean<InviteLean | null>()
    .exec();
}

async function createDraft(d: NewInviteDraft): Promise<InviteLean> {
  const doc = await InviteModel.create({
    jobId: oid(d.jobId),
    candidateId: oid(d.candidateId),
    slotId: oid(d.slotId),
    tokenHash: d.tokenHash,
    expiresAt: d.expiresAt,
    subject: d.subject,
    body: d.body,
    emailStatus: 'draft',
    response: 'pending',
    kind: d.kind,
  });
  return doc.toObject() as InviteLean;
}

/**
 * Expire the old tokens of a candidate: every live invite except `keepId` points at the replacement
 * (supersededBy) and its expiry is pulled to now, so the portal answers TOKEN_EXPIRED for them.
 */
async function supersedeOthers(jobId: string, candidateId: string, keepId: string): Promise<number> {
  const res = await InviteModel.updateMany(
    { jobId: oid(jobId), candidateId: oid(candidateId), _id: { $ne: oid(keepId) }, supersededBy: { $exists: false } },
    { $set: { supersededBy: oid(keepId), expiresAt: new Date() } },
  ).exec();
  return res.modifiedCount;
}

/** Keeps an invite's slot pointer current when a candidate is moved to another slot. */
async function repointSlot(inviteId: string, slotId: string): Promise<void> {
  await InviteModel.updateOne({ _id: oid(inviteId) }, { $set: { slotId: oid(slotId) } }).exec();
}

/** Draft-only: swaps in the real token hash and expiry when HR sends. Returns false if it is no longer a draft. */
async function setTokenWhileDraft(inviteId: string, tokenHash: string, expiresAt: Date): Promise<boolean> {
  const res = await InviteModel.updateOne({ _id: oid(inviteId), emailStatus: { $in: ['draft', 'queued', 'failed'] } }, { $set: { tokenHash, expiresAt } }).exec();
  return res.modifiedCount === 1;
}

async function listByJob(jobId: string): Promise<InviteLean[]> {
  return InviteModel.find({ jobId: oid(jobId) }).sort({ createdAt: 1 }).lean<InviteLean[]>().exec();
}

/** Edit lock: only while still a draft. Null = already queued/sent, so the edit is refused. */
async function patchWhileDraft(inviteId: string, patch: { subject?: string; body?: string }): Promise<InviteLean | null> {
  return InviteModel.findOneAndUpdate({ _id: oid(inviteId), emailStatus: 'draft' }, { $set: patch }, { new: true }).lean<InviteLean | null>().exec();
}

/** Atomic claim: draft|failed -> queued. Two parallel sends cannot both claim the same invite. */
async function claimForSend(inviteId: string): Promise<boolean> {
  const res = await InviteModel.updateOne({ _id: oid(inviteId), emailStatus: { $in: ['draft', 'failed'] }, supersededBy: { $exists: false } }, { $set: { emailStatus: 'queued' } }).exec();
  return res.modifiedCount === 1;
}

async function markDelivery(inviteId: string, ok: boolean, previewUrl?: string): Promise<void> {
  await InviteModel.updateOne({ _id: oid(inviteId) }, { $set: { emailStatus: ok ? 'sent' : 'failed', ...(previewUrl ? { previewUrl } : {}) } }).exec();
}

/** Portal open: sent -> viewed (never downgrades anything else). */
async function markViewed(inviteId: string): Promise<void> {
  await InviteModel.updateOne({ _id: oid(inviteId), emailStatus: 'sent' }, { $set: { emailStatus: 'viewed' } }).exec();
}

export const inviteRepository = { listByJob, patchWhileDraft, claimForSend, markDelivery, markViewed, setTokenWhileDraft, findByRawToken, findById, findLiveForCandidate, respondIfPending, createDraft, supersedeOthers, repointSlot };
