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
