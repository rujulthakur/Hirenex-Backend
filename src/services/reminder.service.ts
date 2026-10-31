import { APP_NAME } from '../config/constants';
import { fastForwardReminders, dueReminders, type ReminderKind } from '../domain/reminders';
import { renderEmail } from '../domain/emailTemplates';
import { getCandidateMailer } from '../integrations/mailer/candidateMailer';
import { inviteRepository } from '../repositories/invite.repository';
import { jobRepository } from '../repositories/job.repository';
import { slotRepository } from '../repositories/slot.repository';
import { NotFoundError } from '../utils/errors';
import { auditService, type AuditActor } from './audit.service';
import { requireApproved } from './approval.guard';
import { factsForSlot, testAddressFor } from './invite.service';

/** Single-instance dedupe (same assumption as the audit mutex): one reminder per invite and kind. */
const alreadySent = new Set<string>();

/**
 * Sends 24h/1h reminders to the TEST inbox. Raw portal tokens are never stored (hash only), so reminders carry no
 * action buttons; they point candidates back to the original invitation email. HR-triggered only (nothing is automatic).
 * fastForward=true (demo) treats every eligible invite as due.
 */
async function run(jobId: string, kind: ReminderKind, fastForward: boolean, actor: AuditActor): Promise<{ sent: number; skipped: number }> {
  const job = await jobRepository.findById(jobId);
  if (!job) throw new NotFoundError('Job not found');
  requireApproved(job);
  const now = Date.now();
  const invites = (await inviteRepository.listByJob(jobId)).filter((i) => !i.supersededBy);
  const slots = new Map((await slotRepository.findByIds(invites.map((i) => String(i.slotId)))).map((s) => [String(s._id), s]));
  const rows = invites.flatMap((i) => {
    const slot = slots.get(String(i.slotId));
    return slot ? [{ inviteId: String(i._id), slotStartMs: slot.start.getTime(), emailStatus: i.emailStatus, response: i.response, superseded: false }] : [];
  });
  const due = new Set(fastForward ? fastForwardReminders(rows, now) : dueReminders(rows, kind, now));
  const mailer = getCandidateMailer();
  let sent = 0;
  let skipped = 0;
  for (const inv of invites) {
    const id = String(inv._id);
    const key = `${id}:${kind}`;
    const slot = slots.get(String(inv.slotId));
    if (!due.has(id) || !slot || alreadySent.has(key)) {
      skipped += 1;
      continue;
    }
    alreadySent.add(key);
    const cid = String(inv.candidateId);
    const facts = await factsForSlot(job, cid, slot);
    const rendered = renderEmail('reminder', facts, null);
    const res = await mailer.send({ to: testAddressFor(cid), subject: rendered.subject, text: rendered.text, html: rendered.html }).catch((e: Error) => ({ ok: false, error: e.message }) as { ok: boolean; previewUrl?: string; error?: string });
    if (res.ok) sent += 1;
    else {
      alreadySent.delete(key);
      skipped += 1;
    }
  }
  await auditService.append({ actor, action: 'demo.reminders', entityType: 'job', entityId: jobId, jobId, payload: { kind, fastForward, sent, skipped, company: APP_NAME } });
  return { sent, skipped };
}

export const reminderService = { run };
