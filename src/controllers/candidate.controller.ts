import type { Request, Response } from 'express';
import { candidateService } from '../services/candidate.service';
import { hiringService } from '../services/hiring.service';
import type { AuditActor } from '../services/audit.service';
import { buildMeta } from '../utils/pagination';
import { UnauthenticatedError } from '../utils/errors';
import type { CandidateStage } from '../types/enums';

function actorOf(req: Request): AuditActor {
  if (!req.user) throw new UnauthenticatedError();
  return { id: req.user.id, role: req.user.role, name: req.user.name };
}
const id = (req: Request): string => String(req.params['id']);

export async function listCandidatesController(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as { stage?: CandidateStage; q?: string; history?: string; sort?: string; page: number; limit: number };
  const { items, total } = await candidateService.list(id(req), q);
  res.status(200).json({ data: items, meta: buildMeta(q.page, q.limit, total) });
}
export async function getCandidateController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await candidateService.get(id(req)) });
}
export async function patchCandidateController(req: Request, res: Response): Promise<void> {
  const body = req.body as { notes: string };
  res.status(200).json({ data: await candidateService.setNotes(id(req), body.notes, actorOf(req)) });
}
export async function deleteCandidateController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await candidateService.remove(id(req), actorOf(req)) });
}

export async function decideCandidateController(req: Request, res: Response): Promise<void> {
  const { action } = req.body as { action: 'hold' | 'reject' | 'reopen' };
  res.status(200).json({ data: await hiringService.decide(id(req), action, actorOf(req)) });
}
