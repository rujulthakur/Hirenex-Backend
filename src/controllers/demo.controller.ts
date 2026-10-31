import type { Request, Response } from 'express';
import { reminderService } from '../services/reminder.service';
import { demoService } from '../services/demo.service';
import type { AuditActor } from '../services/audit.service';
import { UnauthenticatedError } from '../utils/errors';

function actorOf(req: Request): AuditActor {
  if (!req.user) throw new UnauthenticatedError();
  return { id: req.user.id, role: req.user.role, name: req.user.name };
}

/** POST /demo/seed {usePrescored?} */
export async function seedController(req: Request, res: Response): Promise<void> {
  const body = req.body as { usePrescored: boolean };
  res.status(200).json({ data: await demoService.seed(actorOf(req), { usePrescored: body.usePrescored }) });
}

/** POST /demo/reset */
export async function resetController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await demoService.reset(actorOf(req)) });
}

/** GET /demo/qr */
export async function qrController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await demoService.qr(actorOf(req)) });
}

/** POST /demo/fast-forward {jobId, kind} : demo-only reminder fast-forward (CONTRACT CHANGE REQUEST: extra endpoint). */
export async function fastForwardController(req: Request, res: Response): Promise<void> {
  const body = req.body as { jobId: string; kind: '24h' | '1h' };
  res.status(200).json({ data: await reminderService.run(body.jobId, body.kind, true, actorOf(req)) });
}
