import type { Request, Response } from 'express';
import { inviteService } from '../services/invite.service';
import { portalService } from '../services/portal.service';
import type { AuditActor } from '../services/audit.service';
import { UnauthenticatedError } from '../utils/errors';

function actorOf(req: Request): AuditActor {
  if (!req.user) throw new UnauthenticatedError();
  return { id: req.user.id, role: req.user.role, name: req.user.name };
}
const p = (req: Request, k: string): string => String(req.params[k]);

export async function previewInvitesController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await inviteService.preview(p(req, 'id'), actorOf(req)) });
}
export async function sendInvitesController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await inviteService.send(p(req, 'id'), actorOf(req)) });
}
export async function listInvitesController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await inviteService.list(p(req, 'id')) });
}
export async function editInviteController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await inviteService.edit(p(req, 'id'), req.body as { subject?: string; body?: string }, actorOf(req)) });
}

/* portal (public; the token is the credential) */
export async function portalViewController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await portalService.view(p(req, 'token')) });
}
export async function portalAcceptController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await portalService.accept(p(req, 'token')) });
}
export async function portalStatusController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await portalService.status(p(req, 'token')) });
}
