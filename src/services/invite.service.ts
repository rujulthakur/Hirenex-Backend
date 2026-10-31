import { DateTime } from 'luxon';
import { APP_NAME } from '../config/constants';
import { env } from '../config/env';
import { buildIcs } from '../domain/ics';
import { renderEmail, type TemplateFacts } from '../domain/emailTemplates';
import { mintToken, portalLink } from '../domain/portalToken';
import { firstNameFromText } from '../domain/repairDrafts';
import { getLlmClient } from '../integrations/llm';
import { buildDraftInvitationPrompt } from '../integrations/llm/prompts';
import { draftEmailSchema } from '../integrations/llm/schemas';
import { getCandidateMailer } from '../integrations/mailer/candidateMailer';
import { candidateScoringRepository } from '../repositories/candidateScoring.repository';
import { inviteRepository, type InviteLean } from '../repositories/invite.repository';
import { jobRepository, type JobLean } from '../repositories/job.repository';
import { slotRepository, type SlotLean } from '../repositories/slot.repository';
import { sha256Hex } from '../utils/crypto';
import { ConflictError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';
import { auditService, type AuditActor } from './audit.service';
import { requireApproved } from './approval.guard';

export interface InviteRow {
  id: string;
  candidateId: string;
  slotId: string;
  emailStatus: string;
  response: string;
  previewUrl?: string;
  kind: string;
  subject: string;
  body: string;
}

const toRow = (i: InviteLean & { previewUrl?: string }): InviteRow => ({
  id: String(i._id),
  candidateId: String(i.candidateId),
  slotId: String(i.slotId),
  emailStatus: i.emailStatus,
  response: i.response,
  ...(i.previewUrl ? { previewUrl: i.previewUrl } : {}),
  kind: i.kind,
  subject: i.subject,
  body: i.body,
});

async function loadJob(jobId: string): Promise<JobLean> {
  const job = await jobRepository.findById(jobId);
  if (!job) throw new NotFoundError('Job not found');
  return job;
}

/** Candidates are synthetic and have no real address; every candidate email goes to a placeholder test address. */
export const testAddressFor = (candidateId: string): string => `candidate-${candidateId}@candidates.test`;

export async function factsForSlot(job: JobLean, candidateId: string, slot: SlotLean): Promise<TemplateFacts> {
  const original = await candidateScoringRepository.getOriginalText(candidateId);
  const virtual = job.constraints.format === 'virtual';
  return {
    firstName: firstNameFromText(original),
    jobTitle: job.title,
    companyLabel: APP_NAME,
    // Candidates have no stored zone, so times render in the job's zone (stated in the text via the zone abbreviation).
    whenText: DateTime.fromJSDate(slot.start, { zone: job.constraints.timeZone }).toFormat('ccc d LLL yyyy, h:mm a ZZZZ'),
    durationMinutes: job.interviewMinutes,
    format: virtual ? 'virtual' : 'physical',
    whereText: virtual ? job.constraints.meetingLink ?? 'link to follow' : job.constraints.location ?? 'location to follow',
  };
}

/** LLM drafts the body inside the template (draft_invitation_v1); pure template on any failure. */
async function draftBody(facts: TemplateFacts): Promise<{ subject?: string; body?: string; drafter: 'llm' | 'template' }> {
  try {
    const built = buildDraftInvitationPrompt(facts);
    const res = await getLlmClient().generateJson(built.promptId, built.system, built.user, draftEmailSchema);
    return { subject: res.data.subject, body: res.data.body, drafter: 'llm' };
  } catch (err) {
    logger.warn('invite draft fell back to template', { message: (err as Error).message });
    return { drafter: 'template' };
  }
}

/** GET /jobs/:id/invites/preview: APPROVAL_REQUIRED unless approved. Creates one draft per booked candidate without a live invite. */
async function preview(jobId: string, actor: AuditActor): Promise<InviteRow[]> {
  const job = await loadJob(jobId);
  requireApproved(job);
  const existing = await inviteRepository.listByJob(jobId);
  const hasLive = new Set(existing.filter((i) => !i.supersededBy).map((i) => String(i.candidateId)));
  const booked = await slotRepository.listBooked(jobId);

  for (const slot of booked) {
    const cid = String(slot.candidateId);
    if (hasLive.has(cid)) continue;
    const facts = await factsForSlot(job, cid, slot);
    const drafted = await draftBody(facts);
    const rendered = renderEmail('invitation', facts, null, drafted.body, drafted.subject);
    const invite = await inviteRepository.createDraft({
      jobId,
      candidateId: cid,
      slotId: String(slot._id),
      tokenHash: sha256Hex(`draft:${cid}:${Date.now()}:${Math.random()}`),
      expiresAt: mintToken(Date.now(), slot.start.getTime()).expiresAt,
      subject: rendered.subject,
      body: (drafted.body ?? renderEmail('invitation', facts, null).text.split('\n\n')[0]) as string,
      kind: 'invite',
    });
    await auditService.append({ actor, action: 'invite.draft', entityType: 'invite', entityId: String(invite._id), jobId, payload: { candidateId: cid, drafter: drafted.drafter } });
  }
  return (await inviteRepository.listByJob(jobId)).map(toRow);
}

/** PATCH /invites/:id: subject/body only while status is draft. Locked after send. */
async function edit(inviteId: string, patch: { subject?: string; body?: string }, actor: AuditActor): Promise<InviteRow> {
  const current = await inviteRepository.findById(inviteId);
  if (!current) throw new NotFoundError('Invite not found');
  const updated = await inviteRepository.patchWhileDraft(inviteId, patch);
  if (!updated) throw new ConflictError('This invite was already sent and can no longer be edited');
  await auditService.append({
    actor,
    action: 'invite.edit',
    entityType: 'invite',
    entityId: inviteId,
    jobId: String(current.jobId),
    oldValue: { subject: current.subject },
    newValue: { subject: updated.subject, bodyChanged: patch.body !== undefined },
  });
  return toRow(updated);
}

/** POST /jobs/:id/invites/send: guard requireApproved; sends ONLY drafts (or retries failed). Never sends twice. */
async function send(jobId: string, actor: AuditActor): Promise<{ sent: number; failed: number; invites: InviteRow[] }> {
  const job = await loadJob(jobId);
  requireApproved(job);
  const mailer = getCandidateMailer();
  const all = await inviteRepository.listByJob(jobId);
  const pending = all.filter((i) => !i.supersededBy && (i.emailStatus === 'draft' || i.emailStatus === 'failed'));
  const slots = new Map((await slotRepository.findByIds(pending.map((i) => String(i.slotId)))).map((s) => [String(s._id), s]));

  let sent = 0;
  let failed = 0;
  const invitedIds: string[] = [];
  for (const inv of pending) {
    const slot = slots.get(String(inv.slotId));
    if (!slot) {
      failed += 1;
      continue;
    }
    if (!(await inviteRepository.claimForSend(String(inv._id)))) continue; // someone else is sending it
    const cid = String(inv.candidateId);
    const token = mintToken(Date.now(), slot.start.getTime());
    await inviteRepository.setTokenWhileDraft(String(inv._id), token.hash, token.expiresAt);
    const facts = await factsForSlot(job, cid, slot);
    const kind = inv.kind === 'promotion' ? 'promotion' : inv.kind === 'reschedule' ? 'reschedule' : 'invitation';
    const rendered = renderEmail(
      kind,
      facts,
      { accept: portalLink(env.PORTAL_BASE_URL, token.raw, 'accept'), decline: portalLink(env.PORTAL_BASE_URL, token.raw, 'decline'), reschedule: portalLink(env.PORTAL_BASE_URL, token.raw, 'reschedule') },
      inv.body,
      inv.subject,
    );
    const ics = buildIcs({
      uid: `${String(inv._id)}@${APP_NAME.toLowerCase()}`,
      title: `${job.title} interview`,
      startMs: slot.start.getTime(),
      endMs: slot.end.getTime(),
      format: facts.format,
      whereText: facts.whereText,
      url: portalLink(env.PORTAL_BASE_URL, token.raw),
    });
    const result = await mailer
      .send({ to: testAddressFor(cid), subject: rendered.subject, text: rendered.text, html: rendered.html, ...(ics ? { attachments: [{ filename: 'interview.ics', content: ics, contentType: 'text/calendar' }] } : {}) })
      .catch((e: Error) => ({ ok: false, error: e.message }) as { ok: boolean; previewUrl?: string; error?: string });
    await inviteRepository.markDelivery(String(inv._id), result.ok, result.previewUrl);
    if (result.ok) {
      sent += 1;
      invitedIds.push(cid);
    } else {
      failed += 1;
    }
    await auditService.append({ actor, action: 'invite.delivery', entityType: 'invite', entityId: String(inv._id), jobId, payload: { candidateId: cid, ok: result.ok, previewUrl: result.previewUrl ?? null, error: result.error ?? null } });
  }
  await candidateScoringRepository.setStages(jobId, invitedIds, 'invited');
  await auditService.append({ actor, action: 'invite.send', entityType: 'job', entityId: jobId, jobId, payload: { sent, failed } });
  return { sent, failed, invites: (await inviteRepository.listByJob(jobId)).map(toRow) };
}

async function list(jobId: string): Promise<InviteRow[]> {
  await loadJob(jobId);
  return (await inviteRepository.listByJob(jobId)).filter((i) => !i.supersededBy).map(toRow);
}

export const inviteService = { preview, edit, send, list };
