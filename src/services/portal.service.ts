import { buildPortalStatus, type PortalStatus } from '../domain/portalStatus';
import { candidateScoringRepository } from '../repositories/candidateScoring.repository';
import { inviteRepository, type InviteLean } from '../repositories/invite.repository';
import { jobRepository } from '../repositories/job.repository';
import { scoreRepository } from '../repositories/score.repository';
import { slotRepository } from '../repositories/slot.repository';
import { ScoreModel } from '../models/score.model';
import { ConflictError, NotFoundError, TokenExpiredError } from '../utils/errors';
import { auditService } from './audit.service';
import { repairService } from './repair.service';
import { factsForSlot } from './invite.service';

export interface PortalView {
  firstName: string;
  jobTitle: string;
  whenText: string;
  startUtc: string;
  endUtc: string;
  timeZone: string;
  durationMinutes: number;
  format: 'virtual' | 'physical';
  whereText: string;
  response: string;
  kind: string;
}

/** Unknown token -> NOT_FOUND; superseded or past expiry -> TOKEN_EXPIRED. */
async function resolve(rawToken: string): Promise<InviteLean> {
  const invite = await inviteRepository.findByRawToken(rawToken);
  if (!invite) throw new NotFoundError('This link is not valid');
  if (invite.supersededBy || invite.expiresAt.getTime() <= Date.now()) throw new TokenExpiredError();
  return invite;
}

/** GET /portal/:token. Opening it marks the email as viewed (idempotent). */
async function view(rawToken: string): Promise<PortalView> {
  const invite = await resolve(rawToken);
  const job = await jobRepository.findById(String(invite.jobId));
  const [slot] = await slotRepository.findByIds([String(invite.slotId)]);
  if (!job || !slot) throw new NotFoundError('This interview is no longer available');
  await inviteRepository.markViewed(String(invite._id));
  const facts = await factsForSlot(job, String(invite.candidateId), slot);
  return {
    firstName: facts.firstName,
    jobTitle: job.title,
    whenText: facts.whenText,
    startUtc: slot.start.toISOString(),
    endUtc: slot.end.toISOString(),
    timeZone: job.constraints.timeZone,
    durationMinutes: facts.durationMinutes,
    format: facts.format,
    whereText: facts.whereText,
    response: invite.response,
    kind: invite.kind,
  };
}

/** POST /portal/:token/accept: stage confirmed, slot unchanged. Idempotent (accepting twice is a no-op). */
async function accept(rawToken: string): Promise<{ status: 'accepted' | 'already_accepted' }> {
  const invite = await resolve(rawToken);
  if (invite.response === 'accepted') return { status: 'already_accepted' };
  const claimed = await inviteRepository.respondIfPending(String(invite._id), 'accepted', ['pending']);
  if (!claimed) throw new ConflictError('This invitation can no longer be accepted');
  const jobId = String(invite.jobId);
  const cid = String(invite.candidateId);
  await candidateScoringRepository.setStages(jobId, [cid], 'confirmed');
  await auditService.append({ actor: { id: cid, role: 'candidate', name: 'Candidate (portal link)' }, action: 'portal.accept', entityType: 'invite', entityId: String(invite._id), jobId, newValue: { response: 'accepted', stage: 'confirmed' } });
  return { status: 'accepted' };
}

/** POST /portal/:token/decline: delegates to the repair engine (promotes the top waitlisted candidate). */
async function decline(rawToken: string): Promise<{ status: 'declined' | 'already_declined' }> {
  const r = await repairService.decline(rawToken);
  return { status: r.status };
}

async function reschedule(rawToken: string, note: string): Promise<{ status: 'reschedule_requested' | 'already_requested' }> {
  return repairService.requestReschedule(rawToken, note);
}

/** GET /portal/:token/status: plain-language matched and missing skills from VERIFIED scores. No raw numbers. */
async function status(rawToken: string): Promise<PortalStatus> {
  const invite = await resolve(rawToken);
  const job = await jobRepository.findById(String(invite.jobId));
  if (!job) throw new NotFoundError('Job not found');
  const score = await scoreRepository.findByCandidate(String(invite.candidateId));
  const reviewedDoc = await ScoreModel.findOne({ candidateId: invite.candidateId }).select({ evidenceOpenedAt: 1 }).lean<{ evidenceOpenedAt?: Date } | null>().exec();
  const overridden = !!score?.perCriterion.some((c) => c.authority === 'human');
  const humanReviewed = overridden || !!reviewedDoc?.evidenceOpenedAt;
  return buildPortalStatus(
    job.criteria.map((c) => ({ id: String(c.id), name: String(c.name) })),
    (score?.perCriterion ?? []).map((c) => ({ criterionId: c.criterionId, score: c.score, verified: c.verified, missing: c.missing })),
    humanReviewed,
  );
}

export const portalService = { view, accept, decline, reschedule, status };
