import type { Request, Response } from 'express';
import type { AuditActor } from '../services/audit.service';
import { scheduleService } from '../services/schedule.service';
import { UnauthenticatedError } from '../utils/errors';

const jobId = (req: Request): string => String(req.params['id']);

function actorOf(req: Request): AuditActor {
  if (!req.user) throw new UnauthenticatedError();
  return { id: req.user.id, role: req.user.role, name: req.user.name };
}

/** POST /jobs/:id/schedule -> 202 { data: { runId } }. */
export async function startScheduleController(req: Request, res: Response): Promise<void> {
  res.status(202).json({ data: await scheduleService.startSchedule(jobId(req), actorOf(req)) });
}

/** GET /jobs/:id/schedule/status (poll the latest scheduling run). Contract change request: extra endpoint. */
export async function scheduleStatusController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await scheduleService.getRunStatus(jobId(req)) });
}

/** GET /jobs/:id/schedule. Interviewers only receive their own slots. */
export async function getScheduleController(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthenticatedError();
  res.status(200).json({ data: await scheduleService.getSchedule(jobId(req), { role: req.user.role, name: req.user.name }) });
}

/** GET /jobs/:id/shortfall -> {needed, available, deficit, fixes[]}. */
export async function shortfallController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await scheduleService.getShortfall(jobId(req)) });
}
