import { Router } from 'express';
import { z } from 'zod';
import { cancelMeetingController, capacityController, getMeetingSettingsController, listMeetingsController, putMeetingSettingsController, sendMeetingsController } from '../controllers/meeting.controller';
import { getProfileController, putProfileController } from '../controllers/profile.controller';
import { profilePatchSchema } from '../types/profile.schema';
import { authenticate } from '../middleware/authenticate';
import { authorizeGroup } from '../middleware/authorize';
import { createRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { objectIdSchema } from '../types/common';
import { meetingSettingsSchema, sendMeetingsSchema } from '../types/meeting.schema';
import { asyncHandler } from '../utils/asyncHandler';
import { hiringService } from '../services/hiring.service';

const params = z.object({ id: objectIdSchema });
const sendLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

/** Mounted at /jobs. HR only. */
export const jobMeetingRouter = Router();
jobMeetingRouter.get('/:id/meetings', authenticate, authorizeGroup('invites'), validate({ params }), asyncHandler(listMeetingsController));
jobMeetingRouter.post('/:id/meetings', authenticate, authorizeGroup('invites'), sendLimiter, validate({ params, body: sendMeetingsSchema }), asyncHandler(sendMeetingsController));

/** Mounted at /meetings. */
export const meetingRouter = Router();
meetingRouter.get('/capacity', authenticate, authorizeGroup('invites'), asyncHandler(capacityController));
meetingRouter.delete('/:id', authenticate, authorizeGroup('invites'), validate({ params }), asyncHandler(cancelMeetingController));

/** Mounted at /settings. */
export const settingsRouter = Router();
settingsRouter.get('/meetings', authenticate, authorizeGroup('invites'), asyncHandler(getMeetingSettingsController));
settingsRouter.put('/meetings', authenticate, authorizeGroup('invites'), validate({ body: meetingSettingsSchema }), asyncHandler(putMeetingSettingsController));
settingsRouter.get('/profile', authenticate, authorizeGroup('invites'), asyncHandler(getProfileController));
settingsRouter.put('/profile', authenticate, authorizeGroup('invites'), validate({ body: profilePatchSchema }), asyncHandler(putProfileController));

/** Review timeline settings (auto-reject days, hold days, candidate emails). */
const hiringSettingsSchema = z
  .object({ autoRejectEnabled: z.boolean(), autoRejectDays: z.number().int().min(1).max(30), holdDays: z.number().int().min(1).max(30), emailCandidates: z.boolean() })
  .partial()
  .strict();
settingsRouter.get('/hiring', authenticate, authorizeGroup('invites'), asyncHandler(async (req, res) => {
  res.status(200).json({ data: await hiringService.getSettings(req.user!.id) });
}));
settingsRouter.put('/hiring', authenticate, authorizeGroup('invites'), validate({ body: hiringSettingsSchema }), asyncHandler(async (req, res) => {
  res.status(200).json({ data: await hiringService.saveSettings(req.user!.id, req.body as Partial<import('../services/hiring.service').HiringSettings>) });
}));
