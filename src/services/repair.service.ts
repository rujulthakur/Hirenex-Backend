import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { APP_NAME } from '../config/constants';
import {
  applyDecline,
  planDecline,
  planUnavailable,
  snapshotBooked,
  type Placement,
} from '../domain/repair';
import { firstNameFromText, promotionTemplate, rescheduleTemplate, type EmailDraft, type RepairDraftFacts } from '../domain/repairDrafts';
import { getLlmClient } from '../integrations/llm';
import { draftEmailSchema } from '../integrations/llm/schemas';
import { buildDraftPromotionPrompt, buildDraftInvitationPrompt } from '../integrations/llm/prompts';
import { candidateScoringRepository } from '../repositories/candidateScoring.repository';
import { interviewerRepository } from '../repositories/interviewer.repository';
import { inviteRepository, type InviteLean } from '../repositories/invite.repository';
import { jobRepository, type JobLean } from '../repositories/job.repository';
import { repairRepository, type RepairLean } from '../repositories/repair.repository';
import { slotRepository } from '../repositories/slot.repository';
import { sha256Hex } from '../utils/crypto';
import { ConflictError, NotFoundError, TokenExpiredError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { auditService, SYSTEM_ACTOR, type AuditActor } from './audit.service';
import { requireApproved } from './approval.guard';

const WEEK_MS = 7 * 86_400_000;

export interface DeclineResult {
  status: 'declined' | 'already_declined';
  promotedCandidateId: string | null;
  slotStatusAfter: 'open' | 'booked';
  note: string;
}

export interface UnavailableResult {
  blockedSlots: number;
  moved: Array<{ candidateId: string; fromSlotId: string; toSlotId: string }>;
  unplaced: string[];
  note: string;
}

export interface RepairView {
  before: Placement[];
  after: Placement[];
  moved: Array<{ candidateId: string; fromSlotId: string; toSlotId: string }>;
  unplaced: string[];
  trigger?: string;
  note?: string;
  ts?: string;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/* ------------------------------- helpers ------------------------------- */

async function loadJob(jobId: string): Promise<JobLean> {
  const job = await jobRepository.findById(jobId);
  if (!job) throw new NotFoundError('Job not found');
  return job;
}

/** Portal tokens: unknown -> NOT_FOUND, superseded or past expiry -> TOKEN_EXPIRED. */
async function resolveInvite(rawToken: string): Promise<InviteLean> {
  const invite = await inviteRepository.findByRawToken(rawToken);
  if (!invite) throw new NotFoundError('This link is not valid');
  return invite;
}
function assertLive(invite: InviteLean): void {
  if (invite.supersededBy || invite.expiresAt.getTime() < Date.now()) throw new TokenExpiredError();
}

function candidateActor(candidateId: string): AuditActor {
  return { id: candidateId, role: 'candidate', name: 'Candidate (portal link)' };
}

async function factsFor(job: JobLean, candidateId: string, startMs: number): Promise<RepairDraftFacts> {
  const original = await candidateScoringRepository.getOriginalText(candidateId);
  const zone = job.constraints.timeZone;
  const format = job.constraints.format === 'virtual' ? 'virtual' : 'physical';
  const where = format === 'virtual' ? job.constraints.meetingLink ?? 'link to follow' : job.constraints.location ?? 'location to follow';
  return {
    firstName: firstNameFromText(original),
    jobTitle: job.title,
    companyLabel: APP_NAME,
    whenText: DateTime.fromMillis(startMs, { zone }).toFormat("ccc d LLL yyyy, h:mm a ZZZZ"),
    durationMinutes: job.interviewMinutes,
    format,
    whereText: where,
  };
}

/** LLM drafts the body; any failure falls back to the pure template, so a repair never waits on AI. */
async function draftEmail(kind: 'promotion' | 'reschedule', facts: RepairDraftFacts): Promise<{ draft: EmailDraft; usedLlm: boolean }> {
  const fallback = kind === 'promotion' ? promotionTemplate(facts) : rescheduleTemplate(facts);
  try {
    const input = { ...facts, hrNotes: kind === 'reschedule' ? 'The interview time changed because of a scheduling change on our side. Apologise briefly.' : undefined };
    const built = kind === 'promotion' ? buildDraftPromotionPrompt(input) : buildDraftInvitationPrompt(input);
    const res = await getLlmClient().generateJson(built.promptId, built.system, built.user, draftEmailSchema);
    return { draft: { subject: res.data.subject, body: res.data.body }, usedLlm: true };
  } catch (err) {
    logger.warn('repair email draft fell back to template', { err: (err as Error).message, kind });
    return { draft: fallback, usedLlm: false };
  }
}

/**
 * Creates a DRAFT invite (never sent here: HR reviews and sends it from the Invites screen). The stored hash is a
 * placeholder; the Prompt 12 send step mints the real token (and its hash) at send time, because the raw token
 * may only ever live in the email link.
 */
async function createRepairDraft(job: JobLean, candidateId: string, slotId: string, slotStartMs: number, kind: 'promotion' | 'reschedule'): Promise<{ invite: InviteLean; usedLlm: boolean }> {
  const facts = await factsFor(job, candidateId, slotStartMs);
  const { draft, usedLlm } = await draftEmail(kind, facts);
  const invite = await inviteRepository.createDraft({
    jobId: String(job._id),
    candidateId,
    slotId,
    tokenHash: sha256Hex(`draft:${randomUUID()}`),
    expiresAt: new Date(Math.min(Date.now() + WEEK_MS, slotStartMs)),
    subject: draft.subject,
    body: draft.body,
    kind,
  });
  await inviteRepository.supersedeOthers(String(job._id), candidateId, String(invite._id));
  return { invite, usedLlm };
}

/* ------------------------------- 1. decline ------------------------------- */

async function decline(rawToken: string): Promise<DeclineResult> {
  const invite = await resolveInvite(rawToken);
  const jobId = String(invite.jobId);
  const declinedId = String(invite.candidateId);

  // Replay guard #1: already declined -> acknowledge, change nothing.
  if (invite.response === 'declined') return { status: 'already_declined', promotedCandidateId: null, slotStatusAfter: 'open', note: 'This invitation was already declined.' };
  assertLive(invite);

  // Replay guard #2: the atomic update only succeeds while the response is still "pending" (or accepted).
  const claimed = await inviteRepository.respondIfPending(String(invite._id), 'declined', ['pending', 'accepted']);
  if (!claimed) {
    const fresh = await inviteRepository.findById(String(invite._id));
    if (fresh?.response === 'declined') return { status: 'already_declined', promotedCandidateId: null, slotStatusAfter: 'open', note: 'This invitation was already declined.' };
    throw new ConflictError('This invitation can no longer be declined');
  }

  const actor = candidateActor(declinedId);
  const job = await loadJob(jobId);
  await auditService.append({ actor, action: 'invite.declined', entityType: 'invite', entityId: String(invite._id), jobId, oldValue: { response: invite.response }, newValue: { response: 'declined' } });
  await candidateScoringRepository.setStages(jobId, [declinedId], 'declined');
  await auditService.append({ actor, action: 'candidate.stage', entityType: 'candidate', entityId: declinedId, jobId, newValue: { stage: 'declined' } });

  const slots = await repairRepository.slotsForJob(jobId);
  const before = snapshotBooked(slots);
  const rankable = await candidateScoringRepository.listRankable(jobId);
  const waitlistRanked = rankable
    .filter((c) => c.stage === 'waitlisted')
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.uploadOrder - b.uploadOrder)
    .map((c) => String(c._id));

  const plan = planDecline(slots, declinedId, waitlistRanked);
  let promoted: string | null = null;
  let slotStatusAfter: 'open' | 'booked' = 'open';
  let note = plan.note;

  if (plan.slotId && plan.promotedCandidateId) {
    // ATOMIC: slot changes hands only while the decliner still holds it.
    const ok = await repairRepository.handOver(plan.slotId, declinedId, plan.promotedCandidateId);
    if (ok) {
      promoted = plan.promotedCandidateId;
      slotStatusAfter = 'booked';
      await candidateScoringRepository.setStages(jobId, [promoted], 'shortlisted');
      await auditService.append({ actor: SYSTEM_ACTOR, action: 'repair.promote', entityType: 'slot', entityId: plan.slotId, jobId, oldValue: { candidateId: declinedId }, newValue: { candidateId: promoted } });
      const slot = slots.find((s) => s.id === plan.slotId);
      const { invite: draft, usedLlm } = await createRepairDraft(job, promoted, plan.slotId, slot?.start ?? Date.now(), 'promotion');
      await auditService.append({ actor: SYSTEM_ACTOR, action: 'invite.draft_created', entityType: 'invite', entityId: String(draft._id), jobId, payload: { kind: 'promotion', candidateId: promoted, drafter: usedLlm ? 'llm' : 'template' } });
    } else {
      note = 'The slot changed while repairing, so no one was promoted. Please review the schedule.';
    }
  } else if (plan.slotId) {
    await slotRepository.free(plan.slotId, declinedId);
    await auditService.append({ actor: SYSTEM_ACTOR, action: 'repair.slot_opened', entityType: 'slot', entityId: plan.slotId, jobId, payload: { reason: 'waitlist_empty' } });
  }

  const after = snapshotBooked(await repairRepository.slotsForJob(jobId));
  const repair = await repairRepository.save({
    jobId,
    trigger: 'decline',
    before,
    after,
    moved: promoted && plan.slotId ? [{ candidateId: promoted, fromSlotId: plan.slotId, toSlotId: plan.slotId }] : [],
    unplaced: [],
    ...(promoted ? { promotedCandidateId: promoted } : {}),
    note,
  });
  await auditService.append({ actor: SYSTEM_ACTOR, action: 'repair.recorded', entityType: 'repair', entityId: String(repair._id), jobId, payload: { trigger: 'decline', promoted, note } });
  await repairRepository
    .notifyHr('repair.decline', 'A candidate declined', promoted ? 'The top waitlisted candidate was promoted into the same slot. Review the draft invite.' : 'The slot is open again because the waitlist is empty.')
    .catch((e: Error) => logger.warn('notify failed', { err: e.message }));

  return { status: 'declined', promotedCandidateId: promoted, slotStatusAfter, note };
}

/* ------------------------- 2. interviewer unavailable ------------------------- */

async function markUnavailable(jobId: string, interviewerId: string, range: { from: string; to: string }, actor: AuditActor): Promise<UnavailableResult> {
  const job = await loadJob(jobId);
  requireApproved(job);
  const interviewer = await interviewerRepository.findById(interviewerId);
  if (!interviewer || String(interviewer.jobId) !== jobId) throw new NotFoundError('Interviewer not found for this job');
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) throw new ValidationError('"to" must be after "from"');

  const slots = await repairRepository.slotsForJob(jobId);
  const before = snapshotBooked(slots);
  const rankable = await candidateScoringRepository.listRankable(jobId);
  const rankOrder = rankable.filter((c) => c.rank !== undefined).sort((a, b) => (a.rank as number) - (b.rank as number)).map((c) => String(c._id));
  const plan = planUnavailable(slots, interviewerId, from, to, rankOrder);
  const slotById = new Map(slots.map((s) => [s.id, s]));

  const moved: UnavailableResult['moved'] = [];
  const unplaced = [...plan.unplaced];
  const movingFrom = new Map(plan.moved.map((m) => [m.fromSlotId, m]));

  // 1) Moves: book the NEW slot first (atomic), then block the old one. If the new slot was taken, the candidate is unplaced.
  for (const m of plan.moved) {
    const got = await slotRepository.book(m.toSlotId, m.candidateId);
    if (!got) {
      unplaced.push(m.candidateId);
      movingFrom.delete(m.fromSlotId);
    } else {
      moved.push(m);
    }
  }
  // 2) Block every affected slot (open ones, vacated ones, and those of unplaced candidates).
  let blockedCount = 0;
  for (const id of plan.blockedSlotIds) {
    const s = slotById.get(id);
    const ok = await repairRepository.blockSlot(id, s?.status === 'booked' ? s.candidateId : undefined);
    if (ok) blockedCount += 1;
  }
  // 3) Reschedule drafts for moved candidates; their old tokens expire inside createRepairDraft.
  for (const m of moved) {
    const target = slotById.get(m.toSlotId);
    const { invite, usedLlm } = await createRepairDraft(job, m.candidateId, m.toSlotId, target?.start ?? Date.now(), 'reschedule');
    await auditService.append({ actor: SYSTEM_ACTOR, action: 'invite.draft_created', entityType: 'invite', entityId: String(invite._id), jobId, payload: { kind: 'reschedule', candidateId: m.candidateId, drafter: usedLlm ? 'llm' : 'template' } });
    await auditService.append({ actor, action: 'repair.move', entityType: 'candidate', entityId: m.candidateId, jobId, oldValue: { slotId: m.fromSlotId }, newValue: { slotId: m.toSlotId } });
  }
  for (const c of unplaced) {
    await auditService.append({ actor, action: 'repair.unplaced', entityType: 'candidate', entityId: c, jobId, payload: { reason: 'no_open_slot' } });
  }

  const note = `Interviewer ${interviewer.name} marked unavailable: ${blockedCount} slots blocked, ${moved.length} candidates moved, ${unplaced.length} unplaced.`;
  const after = snapshotBooked(await repairRepository.slotsForJob(jobId));
  const repair = await repairRepository.save({ jobId, trigger: 'interviewer_unavailable', before, after, moved, unplaced, note });
  await auditService.append({ actor, action: 'repair.unavailable', entityType: 'interviewer', entityId: interviewerId, jobId, payload: { from: range.from, to: range.to, repairId: String(repair._id), moved: moved.length, unplaced: unplaced.length } });
  await repairRepository.notifyHr('repair.unavailable', 'Interviewer unavailable', note).catch((e: Error) => logger.warn('notify failed', { err: e.message }));
  return { blockedSlots: blockedCount, moved, unplaced, note };
}

/* ------------------------------ 3. reschedule ------------------------------ */

async function requestReschedule(rawToken: string, note: string): Promise<{ status: 'reschedule_requested' | 'already_requested' }> {
  const invite = await resolveInvite(rawToken);
  if (invite.response === 'reschedule_requested') return { status: 'already_requested' };
  assertLive(invite);
  const claimed = await inviteRepository.respondIfPending(String(invite._id), 'reschedule_requested', ['pending', 'accepted']);
  if (!claimed) throw new ConflictError('This invitation can no longer be changed');
  const jobId = String(invite.jobId);
  const candidateId = String(invite.candidateId);
  await auditService.append({ actor: candidateActor(candidateId), action: 'invite.reschedule_requested', entityType: 'invite', entityId: String(invite._id), jobId, payload: { note: note.slice(0, 500) } });
  await repairRepository.notifyHr('repair.reschedule_request', 'Reschedule requested', `A candidate asked for another time: "${note.slice(0, 300)}". No automatic move was made.`).catch((e: Error) => logger.warn('notify failed', { err: e.message }));
  return { status: 'reschedule_requested' };
}

/* ------------------------------- 4. read ------------------------------- */

const placementDto = (p: RepairLean['before'][number]): Placement => ({
  slotId: String(p.slotId),
  interviewerId: String(p.interviewerId),
  ...(p.candidateId ? { candidateId: String(p.candidateId) } : {}),
  start: p.start.getTime(),
  end: p.end.getTime(),
});

/** Latest repair in the shape the frontend expects: {before[], after[], moved[], unplaced[]} (+ metadata). Times are ISO strings. */
async function latest(jobId: string): Promise<RepairView & { history: Array<{ id: string; trigger: string; ts: string; note?: string }> }> {
  await loadJob(jobId);
  const rows = await repairRepository.latestForJob(jobId, 10);
  const top = rows[0];
  const toIso = (p: Placement) => ({ ...p, start: iso(p.start), end: iso(p.end) });
  const history = rows.map((r) => ({ id: String(r._id), trigger: r.trigger, ts: r.ts.toISOString(), ...(r.note ? { note: r.note } : {}) }));
  if (!top) return { before: [], after: [], moved: [], unplaced: [], history } as never;
  return {
    before: top.before.map(placementDto).map(toIso),
    after: top.after.map(placementDto).map(toIso),
    moved: top.moved.map((m) => ({ candidateId: String(m.candidateId), fromSlotId: String(m.fromSlotId), toSlotId: String(m.toSlotId) })),
    unplaced: top.unplaced.map(String),
    trigger: top.trigger,
    note: top.note ?? '',
    ts: top.ts.toISOString(),
    history,
  } as never;
}

export { applyDecline };
export const repairService = { decline, markUnavailable, requestReschedule, latest };
