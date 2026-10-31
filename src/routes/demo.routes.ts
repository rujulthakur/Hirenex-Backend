import { Router } from 'express';
import { z } from 'zod';
import { fastForwardController, qrController, resetController, seedController } from '../controllers/demo.controller';
import { authenticate } from '../middleware/authenticate';
import { authorizeGroup } from '../middleware/authorize';
import { requireDemoMode } from '../middleware/demoGate';
import { createRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { objectIdSchema } from '../types/common';
import { asyncHandler } from '../utils/asyncHandler';

const demoLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
const seedBody = z.object({ usePrescored: z.boolean().default(false) });

/** Mounted at /demo. The gate runs FIRST: with DEMO_MODE=false these routes answer 404 as if they did not exist. */
export const demoRouter = Router();
demoRouter.use(requireDemoMode());
demoRouter.post('/seed', authenticate, authorizeGroup('demo'), demoLimiter, validate({ body: seedBody }), asyncHandler(seedController));
demoRouter.post('/reset', authenticate, authorizeGroup('demo'), demoLimiter, asyncHandler(resetController));
demoRouter.get('/qr', authenticate, authorizeGroup('demo'), demoLimiter, asyncHandler(qrController));

const ffBody = z.object({ jobId: objectIdSchema, kind: z.enum(['24h', '1h']).default('24h') });
demoRouter.post('/fast-forward', authenticate, authorizeGroup('demo'), demoLimiter, validate({ body: ffBody }), asyncHandler(fastForwardController));
