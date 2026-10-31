import { Router } from 'express';
import { z } from 'zod';
import {
  approveController,
  candidateScoresController,
  overrideScoreController,
  rerankController,
  scoringStatusController,
  shortlistController,
  startScoringController,
} from '../controllers/scoring.controller';
import { authenticate } from '../middleware/authenticate';
import { authorizeGroup } from '../middleware/authorize';
import { createRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { objectIdSchema } from '../types/common';
import { overrideScoreSchema, scoreParamsSchema } from '../types/candidate.schema';
import { approveSchema, rerankSchema } from '../types/schedule.schema';
import { asyncHandler } from '../utils/asyncHandler';

const idParams = z.object({ id: objectIdSchema });
const scoreStartLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

/** Mounted at /jobs: scoring, shortlist, rerank, approve. */
export const jobScoringRouter = Router();
jobScoringRouter.post('/:id/score', authenticate, authorizeGroup('scoring'), scoreStartLimiter, validate({ params: idParams }), asyncHandler(startScoringController));
jobScoringRouter.get('/:id/score/status', authenticate, authorizeGroup('scoring'), validate({ params: idParams }), asyncHandler(scoringStatusController));
jobScoringRouter.get('/:id/shortlist', authenticate, authorizeGroup('shortlist'), validate({ params: idParams }), asyncHandler(shortlistController));
jobScoringRouter.post('/:id/rerank', authenticate, authorizeGroup('shortlist'), validate({ params: idParams, body: rerankSchema }), asyncHandler(rerankController));
jobScoringRouter.post('/:id/approve', authenticate, authorizeGroup('shortlist'), validate({ params: idParams, body: approveSchema }), asyncHandler(approveController));

/** Mounted at /candidates: score receipts and HR overrides. */
export const candidateScoringRouter = Router();
candidateScoringRouter.get('/:id/scores', authenticate, authorizeGroup('candidates'), validate({ params: idParams }), asyncHandler(candidateScoresController));
candidateScoringRouter.patch(
  '/:id/scores/:criterionId',
  authenticate,
  authorizeGroup('candidates'),
  validate({ params: scoreParamsSchema, body: overrideScoreSchema }),
  asyncHandler(overrideScoreController),
);
