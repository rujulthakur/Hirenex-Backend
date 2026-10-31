import { Router } from 'express';
import { z } from 'zod';
import { swapTestController } from '../controllers/fairness.controller';
import { authenticate } from '../middleware/authenticate';
import { authorizeGroup } from '../middleware/authorize';
import { createRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { objectIdSchema } from '../types/common';
import { asyncHandler } from '../utils/asyncHandler';

const idParams = z.object({ id: objectIdSchema });
// Each swap test makes one real LLM call, so it is limited.
const swapLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

/** Mounted at /candidates. HR only. */
export const candidateFairnessRouter = Router();
candidateFairnessRouter.post('/:id/swap-test', authenticate, authorizeGroup('candidates'), swapLimiter, validate({ params: idParams }), asyncHandler(swapTestController));

/* ---- analytics + notifications (Prompt 13) ---- */
import { analyticsController, listNotificationsController, readNotificationsController } from '../controllers/fairness.controller';
import { markReadSchema } from '../types/ops.schema';

/** Mounted at /jobs. */
export const jobAnalyticsRouter = Router();
jobAnalyticsRouter.get('/:id/analytics', authenticate, authorizeGroup('analytics'), validate({ params: idParams }), asyncHandler(analyticsController));

/** Mounted at /notifications. HR roles (notifications group). */
export const notificationRouter = Router();
notificationRouter.get('/', authenticate, authorizeGroup('notifications'), asyncHandler(listNotificationsController));
notificationRouter.post('/read', authenticate, authorizeGroup('notifications'), validate({ body: markReadSchema }), asyncHandler(readNotificationsController));

import { probesController } from '../controllers/fairness.controller';
candidateFairnessRouter.post('/:id/probes', authenticate, authorizeGroup('candidates'), swapLimiter, validate({ params: idParams }), asyncHandler(probesController));

import { hrSummaryController } from '../controllers/fairness.controller';
/** Mounted at /analytics. HR only. */
export const hrAnalyticsRouter = Router();
hrAnalyticsRouter.get('/summary', authenticate, authorizeGroup('analytics'), asyncHandler(hrSummaryController));
