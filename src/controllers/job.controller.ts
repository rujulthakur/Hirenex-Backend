import type { Request, Response } from 'express';
import { jobService } from '../services/job.service';
import type { AuditActor } from '../services/audit.service';
import { buildMeta } from '../utils/pagination';
import { UnauthenticatedError } from '../utils/errors';
import type { CreateJobInput, ReplaceInterviewersInput, UpdateJobInput } from '../types/job.schema';
import type { JobStatus } from '../types/enums';

function actorOf(req: Request): AuditActor {
  if (!req.user) throw new UnauthenticatedError();
  return { id: req.user.id, role: req.user.role, name: req.user.name };
}
const id = (req: Request): string => String(req.params['id']);

export async function listJobsController(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as { page: number; limit: number; status?: JobStatus };
  const { items, total } = await jobService.list(q.page, q.limit, q.status);
  res.status(200).json({ data: items, meta: buildMeta(q.page, q.limit, total) });
}
export async function createJobController(req: Request, res: Response): Promise<void> {
  res.status(201).json({ data: await jobService.create(req.body as CreateJobInput, actorOf(req)) });
}
export async function getJobController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await jobService.get(id(req)) });
}
export async function updateJobController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await jobService.update(id(req), req.body as UpdateJobInput, actorOf(req)) });
}
export async function getInterviewersController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await jobService.getInterviewers(id(req)) });
}
export async function putInterviewersController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await jobService.replaceInterviewers(id(req), req.body as ReplaceInterviewersInput, actorOf(req)) });
}
