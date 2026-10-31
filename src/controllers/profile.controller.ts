import type { Request, Response } from 'express';
import { profileService } from '../services/profile.service';
import type { ProfilePatch } from '../types/profile.schema';
import { UnauthenticatedError } from '../utils/errors';

const uid = (req: Request): string => {
  if (!req.user) throw new UnauthenticatedError();
  return req.user.id;
};

/** GET /settings/profile -> { data: { name, avatar, preferences } } */
export async function getProfileController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await profileService.get(uid(req)) });
}

/** PUT /settings/profile (partial). Saves the name, photo and personal settings on the account. */
export async function putProfileController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await profileService.save(uid(req), req.body as ProfilePatch) });
}
