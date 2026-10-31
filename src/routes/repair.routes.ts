import { Router } from 'express';
import { z } from 'zod';
import { portalDeclineController, portalRescheduleController, repairsController, unavailableController } from '../controllers/repair.controller';
import { authenticate } from '../middleware/authenticate';
import { authorizeGroup } from '../middleware/authorize';
import { createRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { objectIdSchema } from '../types/common';
import { portalTokenParamsSchema, rescheduleNoteSchema } from '../types/invite.schema';
import { unavailableSchema } from '../types/schedule.schema';
import { asyncHandler } from '../utils/asyncHandler';

const jobParams = z.object({ id: objectIdSchema });
const interviewerParams = z.object({ id: objectIdSchema, iid: objectIdSchema });
const portalLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

/** Mounted at /jobs. HR only (scheduleWrite group: hr_admin, demo_hr). */
export const jobRepairRouter = Router();
jobRepairRouter.post(
  '/:id/interviewers/:iid/unavailable',
  authenticate,
  authorizeGroup('scheduleWrite'),
  validate({ params: interviewerParams, body: unavailableSchema }),
  asyncHandler(unavailableController),
);
jobRepairRouter.get('/:id/repairs', authenticate, authorizeGroup('scheduleWrite'), validate({ params: jobParams }), asyncHandler(repairsController));

/** Mounted at /portal. Public: the signed token in the URL is the only credential, so it is rate limited. */
export const portalRepairRouter = Router();
portalRepairRouter.post('/:token/decline', portalLimiter, validate({ params: portalTokenParamsSchema }), asyncHandler(portalDeclineController));
portalRepairRouter.post('/:token/reschedule', portalLimiter, validate({ params: portalTokenParamsSchema, body: rescheduleNoteSchema }), asyncHandler(portalRescheduleController));
