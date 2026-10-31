import { Router } from 'express';
import { z } from 'zod';
import { getScheduleController, scheduleStatusController, shortfallController, startScheduleController } from '../controllers/schedule.controller';
import { authenticate } from '../middleware/authenticate';
import { authorizeGroup } from '../middleware/authorize';
import { createRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { objectIdSchema } from '../types/common';
import { asyncHandler } from '../utils/asyncHandler';

const idParams = z.object({ id: objectIdSchema });
const startLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

/** Mounted at /jobs. Every WRITE needs HR; READ is open to interviewers (filtered to their own slots in the service). */
export const jobScheduleRouter = Router();
jobScheduleRouter.post('/:id/schedule', authenticate, authorizeGroup('scheduleWrite'), startLimiter, validate({ params: idParams }), asyncHandler(startScheduleController));
jobScheduleRouter.get('/:id/schedule/status', authenticate, authorizeGroup('scheduleWrite'), validate({ params: idParams }), asyncHandler(scheduleStatusController));
jobScheduleRouter.get('/:id/schedule', authenticate, authorizeGroup('scheduleRead'), validate({ params: idParams }), asyncHandler(getScheduleController));
jobScheduleRouter.get('/:id/shortfall', authenticate, authorizeGroup('scheduleWrite'), validate({ params: idParams }), asyncHandler(shortfallController));
