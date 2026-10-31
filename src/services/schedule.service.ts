import { Types } from 'mongoose';
import { assignCandidates, countConflicts, type AssignSlot } from '../domain/assignment';
import { bookWithRetry } from '../domain/booking';
import { computeShortfall, type ShortfallReport } from '../domain/shortfall';
import { generateSlots, slotsPerDay, type SlotGridInput } from '../domain/slots';
import { candidateScoringRepository } from '../repositories/candidateScoring.repository';
import { interviewerRepository, type InterviewerLean } from '../repositories/interviewer.repository';
import { jobRepository, type JobLean } from '../repositories/job.repository';
import { runRepository } from '../repositories/run.repository';
import { slotRepository, type SlotLean } from '../repositories/slot.repository';
import type { Role } from '../types/enums';
import { ConflictError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';
import { auditService, type AuditActor } from './audit.service';
import { requireApproved } from './approval.guard';
import { traceService } from './trace.service';

export { bookWithRetry };

function gridInput(job: JobLean, interviewers: InterviewerLean[]): SlotGridInput {
  return {
    dates: job.constraints.dates,
    dailyStart: job.constraints.dailyStart,
    dailyEnd: job.constraints.dailyEnd,
    breaks: job.constraints.breaks.map((b) => ({ start: String(b.start), end: String(b.end) })),
    timeZone: job.constraints.timeZone,
    interviewMinutes: job.interviewMinutes,
    interviewers: interviewers.map((i) => ({ id: String(i._id), timeZone: i.timeZone, availability: i.availability })),
  };
}

/** Shortlisted candidates in rank order that do not have a booked slot yet. */
async function candidatesNeedingSlots(jobId: string): Promise<string[]> {
  const [rows, booked] = await Promise.all([candidateScoringRepository.listRankable(jobId), slotRepository.bookedCandidateIds(jobId)]);
  return rows
    .filter((c) => c.stage === 'shortlisted' && !booked.has(String(c._id)))
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.uploadOrder - b.uploadOrder)
    .map((c) => String(c._id));
}

async function loadJob(jobId: string): Promise<JobLean> {
  const job = await jobRepository.findById(jobId);
  if (!job) throw new NotFoundError('Job not found');
  return job;
}

async function execute(runId: string, job: JobLean, candidateIds: string[], actor: AuditActor): Promise<void> {
  const jobId = String(job._id);
  try {
    await runRepository.markRunning(runId);
    const interviewers = await interviewerRepository.findByJob(jobId);
    if (interviewers.length === 0) throw new Error('No interviewers are set up for this job');

    // Idempotent slot generation.
    const generated = generateSlots(gridInput(job, interviewers));
    const inserted = await traceService.wrap(runId, 'schedule', () => slotRepository.insertMissing(jobId, generated), `${generated.length} slots in grid`, {
      jobId,
      describe: (r) => ({ outputSummary: `${r as number} new slots stored (existing slots kept)` }),
    });
    logger.info('slot grid ready', { runId, generated: generated.length, inserted });

    const open = await slotRepository.listOpen(jobId);
    const planSlots: AssignSlot[] = open.map((s) => ({ id: String(s._id), interviewerId: String(s.interviewerId), start: s.start.getTime() }));
    const plan = assignCandidates(candidateIds, planSlots, await slotRepository.bookedLoad(jobId));

    const planned = new Set(plan.assignments.map((a) => a.slotId));
    const spare = planSlots.filter((s) => !planned.has(s.id));
    const slotById = new Map(planSlots.map((s) => [s.id, s]));
    const tryBook = async (slotId: string, candidateId: string): Promise<boolean> => (await slotRepository.book(slotId, candidateId)) !== null;

    let booked = 0;
    const unplaced = [...plan.unplaced];
    for (const a of plan.assignments) {
      try {
        const slot = await bookWithRetry(a.candidateId, slotById.get(a.slotId) as AssignSlot, spare, tryBook);
        if (!slot) {
          unplaced.push(a.candidateId);
        } else {
          booked += 1;
          const idx = spare.findIndex((s) => s.id === slot.id);
          if (idx >= 0) spare.splice(idx, 1);
          await auditService.append({
            actor,
            action: 'slot.booked',
            entityType: 'slot',
            entityId: slot.id,
            jobId,
            newValue: { candidateId: a.candidateId, interviewerId: slot.interviewerId, start: new Date(slot.start).toISOString() },
          });
        }
      } finally {
        await runRepository.incrementDone(runId);
      }
    }
    for (const candidateId of plan.unplaced) {
      await runRepository.addFailure(runId, { candidateId, reason: 'No open slot available (see shortfall report)' });
      await runRepository.incrementDone(runId);
    }
    for (const candidateId of unplaced.filter((c) => !plan.unplaced.includes(c))) {
      await runRepository.addFailure(runId, { candidateId, reason: 'All remaining slots were taken (see shortfall report)' });
    }

    const fresh = await jobRepository.findById(jobId);
    if (fresh && fresh.status === 'approved') await jobRepository.setStatus(jobId, 'scheduled');

    await runRepository.finish(runId, 'done');
    await auditService.append({
      actor,
      action: 'schedule.run',
      entityType: 'job',
      entityId: jobId,
      jobId,
      payload: { runId, phase: 'finished', booked, unplaced: unplaced.length, newSlots: inserted },
    });
  } catch (err) {
    logger.error('scheduling run failed', { runId, err: err instanceof Error ? err.message : String(err) });
    await runRepository.addFailure(runId, { reason: err instanceof Error ? err.message : 'Scheduling failed' });
    await runRepository.finish(runId, 'failed');
  }
}

/** POST /jobs/:id/schedule -> 202 { runId }. Requires an approved job. */
async function startSchedule(jobId: string, actor: AuditActor): Promise<{ runId: string }> {
  const job = await loadJob(jobId);
  requireApproved(job);
  if (await runRepository.hasActive(jobId, 'scheduling')) throw new ConflictError('A scheduling run is already in progress for this job');
  const candidateIds = await candidatesNeedingSlots(jobId);
  const runId = await runRepository.create(jobId, 'scheduling', candidateIds.length);
  await auditService.append({
    actor,
    action: 'schedule.run',
    entityType: 'job',
    entityId: jobId,
    jobId,
    payload: { runId, phase: 'started', candidates: candidateIds.length },
  });
  void execute(runId, job, candidateIds, actor);
  return { runId };
}

/** GET /jobs/:id/schedule/status helper for polling the latest scheduling run. */
async function getRunStatus(jobId: string): Promise<{ runId: string; state: string; done: number; total: number; failures: Array<{ candidateId?: string; reason: string }> }> {
  const run = await runRepository.latestForJob(jobId, 'scheduling');
  if (!run) throw new NotFoundError('No scheduling run has been started for this job');
  return {
    runId: String(run._id),
    state: run.state,
    done: run.done,
    total: run.total,
    failures: run.failures.map((f) => ({ ...(f.candidateId ? { candidateId: f.candidateId } : {}), reason: f.reason })),
  };
}

export interface ScheduleSlotDto {
  id: string;
  jobId: string;
  interviewerId: string;
  start: string;
  end: string;
  timeZone: string;
  status: string;
  candidateId?: string;
}

export interface ScheduleView {
  jobTimeZone: string;
  breaks: Array<{ start: string; end: string }>;
  interviewers: Array<{ interviewerId: string; name: string; timeZone: string; slots: ScheduleSlotDto[] }>;
  /** Shortlisted candidates without a slot. They stay shortlisted with this clear marker. */
  unscheduled: string[];
  conflictCount: number;
}

const toDto = (s: SlotLean): ScheduleSlotDto => ({
  id: String(s._id),
  jobId: String(s.jobId),
  interviewerId: String(s.interviewerId),
  start: s.start.toISOString(),
  end: s.end.toISOString(),
  timeZone: s.timeZone,
  status: s.status,
  ...(s.candidateId ? { candidateId: String(s.candidateId) } : {}),
});

/**
 * GET /jobs/:id/schedule. Slots grouped by interviewer, breaks, unscheduled list and a computed conflictCount (must be 0).
 * Interviewer role: only the slots of the interviewer whose name matches the signed-in user (name match, case-insensitive).
 */
async function getSchedule(jobId: string, viewer: { role: Role; name: string }): Promise<ScheduleView> {
  const job = await loadJob(jobId);
  const interviewers = await interviewerRepository.findByJob(jobId);
  const slots = await slotRepository.listForJob(jobId);

  const visible = viewer.role === 'interviewer' ? interviewers.filter((i) => i.name.trim().toLowerCase() === viewer.name.trim().toLowerCase()) : interviewers;
  const unscheduled = viewer.role === 'interviewer' ? [] : await candidatesNeedingSlots(jobId);

  const conflictCount = countConflicts(
    slots
      .filter((s) => s.status === 'booked')
      .map((s) => ({ interviewerId: String(s.interviewerId), start: s.start.getTime(), end: s.end.getTime(), ...(s.candidateId ? { candidateId: String(s.candidateId) } : {}) })),
  );

  return {
    jobTimeZone: job.constraints.timeZone,
    breaks: job.constraints.breaks.map((b) => ({ start: String(b.start), end: String(b.end) })),
    interviewers: visible.map((i) => ({
      interviewerId: String(i._id),
      name: i.name,
      timeZone: i.timeZone,
      slots: slots.filter((s) => String(s.interviewerId) === String(i._id)).map(toDto),
    })),
    unscheduled,
    conflictCount,
  };
}

/** GET /jobs/:id/shortfall -> {needed, available, fixes[]}. Works before the grid exists (uses an in-memory grid). */
async function getShortfall(jobId: string): Promise<ShortfallReport> {
  const job = await loadJob(jobId);
  const interviewers = await interviewerRepository.findByJob(jobId);
  const needed = (await candidatesNeedingSlots(jobId)).length;
  const stored = await slotRepository.countForJob(jobId);
  const available = stored > 0 ? await slotRepository.countOpen(jobId) : generateSlots(gridInput(job, interviewers)).length;
  const base = gridInput(job, interviewers);
  const perDay = job.constraints.dates[0] ? slotsPerDay(base, job.constraints.dates[0]) : 0;
  return computeShortfall({
    needed,
    available,
    interviewerCount: interviewers.length,
    dayCount: new Set(job.constraints.dates).size,
    slotsPerInterviewerDay: perDay,
    interviewMinutes: job.interviewMinutes,
  });
}

export const isObjectId = (id: string): boolean => Types.ObjectId.isValid(id);
export const scheduleService = { startSchedule, getRunStatus, getSchedule, getShortfall };
