import { APP_NAME } from '../config/constants';
import { HIRING_DEFAULTS, PENDING_STAGES } from '../config/hiringDefaults';
import { renderEmail, type TemplateFacts } from '../domain/emailTemplates';
import { firstNameFromText } from '../domain/repairDrafts';
import { canTransition } from '../domain/stages';
import { getCandidateMailer } from '../integrations/mailer/candidateMailer';
import { CandidateModel } from '../models/candidate.model';
import { JobModel } from '../models/job.model';
import { UserModel } from '../models/user.model';
import { candidateRepository } from '../repositories/candidate.repository';
import { candidateScoringRepository } from '../repositories/candidateScoring.repository';
import type { CandidateStage } from '../types/enums';
import { ConflictError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';
import { auditService, SYSTEM_ACTOR, type AuditActor } from './audit.service';
import { candidateService } from './candidate.service';
import { testAddressFor } from './invite.service';
import { notificationService } from './notification.service';

const DAY = 86_400_000;

export interface HiringSettings {
  autoRejectEnabled: boolean;
  autoRejectDays: number;
  holdDays: number;
  emailCandidates: boolean;
}
export type DecisionAction = 'hold' | 'reject' | 'reopen';

async function getSettings(userId: string): Promise<HiringSettings> {
  const u = await UserModel.findById(userId).select({ hiringSettings: 1 }).lean<{ hiringSettings?: Partial<HiringSettings> } | null>().exec();
  return { ...HIRING_DEFAULTS, ...(u?.hiringSettings ?? {}) };
}

async function saveSettings(userId: string, patch: Partial<HiringSettings>): Promise<HiringSettings> {
  const $set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined).map(([k, v]) => [`hiringSettings.${k}`, v]));
  if (Object.keys($set).length > 0) await UserModel.updateOne({ _id: userId }, { $set }).exec();
  return getSettings(userId);
}

/** Candidate email only ever goes to the Ethereal test inbox (see candidateMailer). Never throws. */
async function mailCandidate(candidateId: string, jobTitle: string, kind: 'hold' | 'reject', holdDays: number): Promise<void> {
  try {
    const firstName = firstNameFromText(await candidateScoringRepository.getOriginalText(candidateId));
    const facts: TemplateFacts = { firstName, jobTitle, companyLabel: APP_NAME, whenText: '', durationMinutes: 0, format: 'virtual', whereText: '' };
    const body =
      kind === 'hold'
        ? `Hello ${firstName},\n\nThank you for applying for the ${jobTitle} role at ${APP_NAME}. You are on our waiting list. We will review your application again within ${holdDays} days and will contact you if we can offer you an interview.`
        : `Hello ${firstName},\n\nThank you for applying for the ${jobTitle} role at ${APP_NAME}. After review, we will not be moving forward with your application this time. We appreciate your interest and wish you every success.`;
    const mail = renderEmail(kind === 'hold' ? 'decision_waitlist' : 'decision_not_selected', facts, null, body);
    await getCandidateMailer().send({ to: testAddressFor(candidateId), subject: mail.subject, text: mail.text, html: mail.html });
  } catch (e) {
    logger.warn('decision email failed', { message: (e as Error).message });
  }
}

/** HR decision. The stage change is atomic (filtered on the current stage), so a double click or a sweep at the same moment cannot double-apply. */
async function decide(candidateId: string, action: DecisionAction, actor: AuditActor) {
  const c = await candidateRepository.findLive(candidateId);
  if (!c) throw new NotFoundError('Candidate not found');
  const job = await JobModel.findById(c.jobId).select({ ownerId: 1, title: 1 }).lean<{ ownerId: unknown; title: string } | null>().exec();
  if (!job) throw new NotFoundError('Job not found');
  const s = await getSettings(String(job.ownerId));

  const prev = (c as { prevStage?: CandidateStage }).prevStage;
  const restore: CandidateStage = prev && (PENDING_STAGES as readonly string[]).includes(prev) ? prev : c.totalScore != null ? 'scored' : 'applied';
  const to: CandidateStage = action === 'hold' ? 'on_hold' : action === 'reject' ? 'rejected' : restore;
  if (c.stage === to) return candidateService.get(candidateId);
  const reopenOk = c.stage === 'on_hold' || c.stage === 'rejected';
  if (!canTransition(c.stage, to) || (action === 'reopen' && !reopenOk)) {
    throw new ConflictError(`A candidate in "${c.stage.replace('_', ' ')}" cannot be moved this way.`);
  }

  const now = new Date();
  // Remember where the candidate came from (keep the older value when moving hold -> reject).
  const remember = (PENDING_STAGES as readonly string[]).includes(c.stage) ? { prevStage: c.stage } : {};
  const set: Record<string, unknown> =
    action === 'hold'
      ? { stage: to, holdUntil: new Date(now.getTime() + s.holdDays * DAY), decidedAt: now, decidedBy: 'hr', ...remember }
      : action === 'reject'
        ? { stage: to, decidedAt: now, decidedBy: 'hr', rejectionReason: 'hr_rejected', ...remember }
        : { stage: to, reviewStartedAt: now };
  const unset: Record<string, 1> = action === 'hold' ? {} : action === 'reject' ? { holdUntil: 1 } : { holdUntil: 1, rejectionReason: 1, decidedAt: 1, decidedBy: 1, prevStage: 1 };

  const res = await CandidateModel.updateOne({ _id: c._id, stage: c.stage }, { $set: set, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) }).exec();
  if (res.modifiedCount !== 1) throw new ConflictError('This candidate was just updated. Refresh and try again.');
  await auditService.append({ actor, action: `candidate.${action}`, entityType: 'candidate', entityId: candidateId, jobId: String(c.jobId), oldValue: { stage: c.stage }, newValue: { stage: to } });
  if (action !== 'reopen' && s.emailCandidates) await mailCandidate(candidateId, job.title, action, s.holdDays);
  return candidateService.get(candidateId);
}

/**
 * Auto decisions. (1) No HR action within autoRejectDays -> rejected. (2) On hold past holdUntil -> rejected.
 * Idempotent: every update is filtered on the stage it read, so running twice (or on two servers) is safe.
 */
async function sweep(now: Date = new Date()): Promise<{ rejected: number; expiredHolds: number }> {
  let rejected = 0;
  let expiredHolds = 0;
  const users = await UserModel.find({ isDemo: false }).select({ _id: 1, hiringSettings: 1 }).lean<Array<{ _id: unknown; hiringSettings?: Partial<HiringSettings> }>>().exec();
  for (const u of users) {
    const s: HiringSettings = { ...HIRING_DEFAULTS, ...(u.hiringSettings ?? {}) };
    if (!s.autoRejectEnabled) continue;
    const jobs = await JobModel.find({ ownerId: u._id }).select({ _id: 1, title: 1 }).lean<Array<{ _id: unknown; title: string }>>().exec();
    if (jobs.length === 0) continue;
    const jobIds = jobs.map((j) => j._id);
    const titles = new Map(jobs.map((j) => [String(j._id), j.title]));
    const cutoff = new Date(now.getTime() - s.autoRejectDays * DAY);

    const stale = await CandidateModel.find({
      jobId: { $in: jobIds },
      deletedAt: { $exists: false },
      stage: { $in: PENDING_STAGES },
      $or: [{ reviewStartedAt: { $lt: cutoff } }, { reviewStartedAt: { $exists: false }, createdAt: { $lt: cutoff } }],
    }).select({ _id: 1, jobId: 1, stage: 1 }).limit(500).lean().exec();
    const expired = await CandidateModel.find({ jobId: { $in: jobIds }, deletedAt: { $exists: false }, stage: 'on_hold', holdUntil: { $lt: now } })
      .select({ _id: 1, jobId: 1, stage: 1 }).limit(500).lean().exec();

    const autoReject = async (c: { _id: unknown; jobId: unknown; stage: string }, reason: 'no_response' | 'hold_expired'): Promise<boolean> => {
      const r = await CandidateModel.updateOne(
        { _id: c._id, stage: c.stage },
        { $set: { stage: 'rejected', rejectionReason: reason, decidedAt: now, decidedBy: 'system', ...((PENDING_STAGES as readonly string[]).includes(c.stage) ? { prevStage: c.stage } : {}) }, $unset: { holdUntil: 1 } },
      ).exec();
      if (r.modifiedCount !== 1) return false; // HR changed it first: leave it alone
      await auditService.append({ actor: SYSTEM_ACTOR, action: 'candidate.auto_reject', entityType: 'candidate', entityId: String(c._id), jobId: String(c.jobId), oldValue: { stage: c.stage }, newValue: { stage: 'rejected', reason } });
      if (s.emailCandidates) await mailCandidate(String(c._id), titles.get(String(c.jobId)) ?? 'the role', 'reject', s.holdDays);
      return true;
    };

    let a = 0;
    let b = 0;
    for (const c of stale) if (await autoReject(c, 'no_response')) a += 1;
    for (const c of expired) if (await autoReject(c, 'hold_expired')) b += 1;
    rejected += a;
    expiredHolds += b;
    if (a + b > 0) {
      await notificationService.notify(
        String(u._id), 'auto_reject', 'Resumes auto-rejected',
        `${a} had no action for ${s.autoRejectDays} day(s) and ${b} finished their ${s.holdDays}-day hold. Candidates were emailed.`,
        '/app/candidates',
      );
    }
  }
  return { rejected, expiredHolds };
}

/** Runs a few seconds after boot, then every 15 minutes. Timers are unref'd so they never block shutdown. */
export function startHiringSweeper(): void {
  const run = (): void => {
    void sweep().catch((e: Error) => logger.error('hiring sweep failed', { message: e.message }));
  };
  setTimeout(run, 30_000).unref();
  setInterval(run, 15 * 60_000).unref();
}

export const hiringService = { getSettings, saveSettings, decide, sweep };
