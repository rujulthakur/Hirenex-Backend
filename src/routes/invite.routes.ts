import { Router } from 'express';
import { z } from 'zod';
import { editInviteController, listInvitesController, portalAcceptController, portalStatusController, portalViewController, previewInvitesController, sendInvitesController } from '../controllers/invite.controller';
import { authenticate } from '../middleware/authenticate';
import { authorizeGroup } from '../middleware/authorize';
import { createRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { objectIdSchema } from '../types/common';
import { patchInviteSchema, portalTokenParamsSchema } from '../types/invite.schema';
import { asyncHandler } from '../utils/asyncHandler';

const jobParams = z.object({ id: objectIdSchema });
const sendLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
const portalLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });

/** Mounted at /jobs. HR only. */
export const jobInviteRouter = Router();
jobInviteRouter.get('/:id/invites/preview', authenticate, authorizeGroup('invites'), validate({ params: jobParams }), asyncHandler(previewInvitesController));
jobInviteRouter.post('/:id/invites/send', authenticate, authorizeGroup('invites'), sendLimiter, validate({ params: jobParams }), asyncHandler(sendInvitesController));
jobInviteRouter.get('/:id/invites', authenticate, authorizeGroup('invites'), validate({ params: jobParams }), asyncHandler(listInvitesController));

/** Mounted at /invites. */
export const inviteRouter = Router();
inviteRouter.patch('/:id', authenticate, authorizeGroup('invites'), validate({ params: jobParams, body: patchInviteSchema }), asyncHandler(editInviteController));

/** Mounted at /portal (shares the mount with portalRepairRouter: decline + reschedule live there). */
export const portalRouter = Router();
portalRouter.get('/:token', portalLimiter, validate({ params: portalTokenParamsSchema }), asyncHandler(portalViewController));
portalRouter.get('/:token/status', portalLimiter, validate({ params: portalTokenParamsSchema }), asyncHandler(portalStatusController));
portalRouter.post('/:token/accept', portalLimiter, validate({ params: portalTokenParamsSchema }), asyncHandler(portalAcceptController));
