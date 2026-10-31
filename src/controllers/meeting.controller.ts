import type { Request, Response } from 'express';
import { meetingService } from '../services/meeting.service';
import { UnauthenticatedError } from '../utils/errors';

const uid = (req: Request): string => {
  if (!req.user) throw new UnauthenticatedError();
  return req.user.id;
};
const id = (req: Request): string => String(req.params['id']);

export async function getMeetingSettingsController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await meetingService.getSettings(uid(req)) });
}
export async function putMeetingSettingsController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await meetingService.saveSettings(uid(req), req.body as Record<string, never>) });
}
export async function capacityController(req: Request, res: Response): Promise<void> {
  const { date, total, free, settings } = await meetingService.capacity(uid(req));
  res.status(200).json({ data: { date, total, free, settings } });
}
export async function listMeetingsController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await meetingService.list(uid(req), id(req)) });
}
export async function sendMeetingsController(req: Request, res: Response): Promise<void> {
  const body = req.body as { candidateIds: string[] };
  res.status(200).json({ data: await meetingService.sendInvites(uid(req), id(req), body.candidateIds) });
}
export async function cancelMeetingController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await meetingService.cancel(uid(req), id(req)) });
}
