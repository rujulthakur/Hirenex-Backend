import type { Request, Response } from 'express';
import type { AuditActor } from '../services/audit.service';
import { repairService } from '../services/repair.service';
import { UnauthenticatedError } from '../utils/errors';

function actorOf(req: Request): AuditActor {
  if (!req.user) throw new UnauthenticatedError();
  return { id: req.user.id, role: req.user.role, name: req.user.name };
}

/** POST /jobs/:id/interviewers/:iid/unavailable {from,to} -> 200 { data: { blockedSlots, moved[], unplaced[], note } } */
export async function unavailableController(req: Request, res: Response): Promise<void> {
  const { from, to } = req.body as { from: string; to: string };
  res.status(200).json({ data: await repairService.markUnavailable(String(req.params['id']), String(req.params['iid']), { from, to }, actorOf(req)) });
}

/** GET /jobs/:id/repairs -> { data: { before[], after[], moved[], unplaced[], ... } } */
export async function repairsController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await repairService.latest(String(req.params['id'])) });
}

/** POST /portal/:token/decline (public, the signed token is the credential). */
export async function portalDeclineController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await repairService.decline(String(req.params['token'])) });
}

/** POST /portal/:token/reschedule {note} -> no automatic move, HR is notified. */
export async function portalRescheduleController(req: Request, res: Response): Promise<void> {
  const { note } = req.body as { note: string };
  res.status(200).json({ data: await repairService.requestReschedule(String(req.params['token']), note) });
}
