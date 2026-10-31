import QRCode from 'qrcode';
import { env } from '../config/env';
import { hasPrescored, setPrescoredOnly } from '../integrations/llm/prescored';
import { mintToken, portalLink } from '../domain/portalToken';
import { assignSyntheticLabels, createDemoJob, latestDemoJob, pickSandboxInvite, replaceInviteTokenHash, wipeDemoJobs, type WipeCounts } from '../seed/demoData';
import { generateDemoFiles } from '../seed/generateResumes';
import { ConflictError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';
import { auditService, type AuditActor } from './audit.service';
import { ingestionService, type FileResult } from './ingestion.service';
import { scoringRunService } from './scoringRun.service';

export interface SeedResult {
  jobId: string;
  reused: boolean;
  uploaded: number;
  accepted: number;
  unreadable: number;
  flagged: Array<{ fileName: string; flags: string[] }>;
  labelsAssigned: number;
  scoring: { runId: string; usedPrescored: boolean } | null;
  note: string;
}

export interface ResetResult {
  wiped: WipeCounts;
  newJobId: string;
  auditChainKept: true;
  note: string;
}

const PRESCORE_POLL_MS = 1_000;
const PRESCORE_MAX_MS = 5 * 60_000;

/** Prescored-only mode is switched off again when the scoring run finishes (or after a safety timeout). */
function releasePrescoredWhenDone(jobId: string): void {
  const started = Date.now();
  const tick = async (): Promise<void> => {
    try {
      const status = await scoringRunService.getStatus(jobId);
      if (status.state !== 'running' && status.state !== 'queued') return setPrescoredOnly(false);
    } catch {
      return setPrescoredOnly(false);
    }
    if (Date.now() - started > PRESCORE_MAX_MS) return setPrescoredOnly(false);
    setTimeout(() => void tick(), PRESCORE_POLL_MS).unref();
  };
  setTimeout(() => void tick(), PRESCORE_POLL_MS).unref();
}

/**
 * POST /demo/seed. Idempotent: if a demo job with resumes already exists it is returned untouched.
 * Files go through the REAL ingestion pipeline (parse, shield, redact). usePrescored=true scores from the
 * fixtures so the demo never depends on the LLM.
 */
async function seed(actor: AuditActor, options: { usePrescored: boolean }): Promise<SeedResult> {
  const existing = await latestDemoJob();
  if (existing && existing.candidateCount > 0) {
    return { jobId: existing.jobId, reused: true, uploaded: 0, accepted: 0, unreadable: 0, flagged: [], labelsAssigned: 0, scoring: null, note: 'A demo job already exists. Use POST /demo/reset for a fresh one.' };
  }
  const jobId = existing?.jobId ?? (await createDemoJob(actor.id));
  const files = await generateDemoFiles();
  const results: FileResult[] = await ingestionService.ingestBatch(jobId, files.map((f) => ({ originalname: f.fileName, buffer: f.buffer })), actor);
  const labelsAssigned = await assignSyntheticLabels(jobId);

  let scoring: SeedResult['scoring'] = null;
  let note = 'Resumes uploaded. Start scoring with POST /jobs/:id/score.';
  if (options.usePrescored) {
    if (hasPrescored()) {
      setPrescoredOnly(true);
      try {
        const { runId } = await scoringRunService.startScoring(jobId, actor);
        scoring = { runId, usedPrescored: true };
        releasePrescoredWhenDone(jobId);
        note = 'Scoring started from prescored fixtures (no LLM call).';
      } catch (err) {
        setPrescoredOnly(false);
        throw err;
      }
    } else {
      note = 'usePrescored was requested but src/seed/prescored.json is empty. Run npm run demo:prescore once. Resumes were uploaded only.';
      logger.warn('demo seed: no prescored fixtures available');
    }
  }

  await auditService.append({
    actor, action: 'demo.seed', entityType: 'job', entityId: jobId, jobId,
    payload: { uploaded: results.length, accepted: results.filter((r) => r.status === 'accepted').length, usePrescored: options.usePrescored, labelsAssigned },
  });
  return {
    jobId,
    reused: false,
    uploaded: results.length,
    accepted: results.filter((r) => r.status === 'accepted').length,
    unreadable: results.filter((r) => r.status === 'unreadable').length,
    flagged: results.filter((r) => r.flags.length > 0).map((r) => ({ fileName: r.fileName, flags: r.flags })),
    labelsAssigned,
    scoring,
    note,
  };
}

/**
 * POST /demo/reset. Wipes demo JOB data (jobs, resumes, scores, slots, invites, traces, labels), never users and
 * NEVER the audit chain: deleting entries would break the hash chain and the tamper-evidence story, and the reset
 * itself must be visible in the log. We append "demo.reset" and start a NEW empty demo job instead.
 */
async function reset(actor: AuditActor): Promise<ResetResult> {
  setPrescoredOnly(false);
  const wiped = await wipeDemoJobs();
  const newJobId = await createDemoJob(actor.id);
  await auditService.append({ actor, action: 'demo.reset', entityType: 'job', entityId: newJobId, jobId: newJobId, payload: { ...wiped } });
  return { wiped, newJobId, auditChainKept: true, note: 'Demo data wiped. The audit log was kept; a new empty demo job is ready for upload.' };
}

/**
 * GET /demo/qr -> { url, qrDataUrl } for the portal link of a prepared SANDBOX invite (synthetic candidate only).
 * The raw token is never stored, so a fresh one is minted and its hash replaces the invite's hash. The earlier
 * email link for that one sandbox invite stops working; acceptable for a demo-only route.
 */
async function qr(actor: AuditActor): Promise<{ url: string; qrDataUrl: string; candidateId: string; jobId: string }> {
  const job = await latestDemoJob();
  if (!job) throw new NotFoundError('No demo job found. Call POST /demo/seed first.');
  const invite = await pickSandboxInvite(job.jobId);
  if (!invite) throw new ConflictError('No invitation exists yet. Approve, schedule and preview invites first.');
  const token = mintToken(Date.now(), invite.expiresAt.getTime());
  await replaceInviteTokenHash(invite.inviteId, token.hash, invite.expiresAt);
  const url = portalLink(env.PORTAL_BASE_URL, token.raw);
  const qrDataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
  await auditService.append({ actor, action: 'demo.qr', entityType: 'invite', entityId: invite.inviteId, jobId: job.jobId, payload: { candidateId: invite.candidateId } });
  return { url, qrDataUrl, candidateId: invite.candidateId, jobId: job.jobId };
}

export const demoService = { seed, reset, qr };
