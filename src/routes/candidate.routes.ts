import { Router } from 'express';
import { z } from 'zod';
import {
  decideCandidateController, deleteCandidateController, getCandidateController, listCandidatesController, patchCandidateController,
} from '../controllers/candidate.controller';
import { authenticate } from '../middleware/authenticate';
import { authorizeGroup } from '../middleware/authorize';
import { createRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { listCandidatesQuerySchema, patchCandidateSchema } from '../types/candidate.schema';
import { objectIdSchema } from '../types/common';
import { asyncHandler } from '../utils/asyncHandler';

const idParams = z.object({ id: objectIdSchema });
const writeLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });

/** Mounted at /jobs: GET /jobs/:id/candidates?stage&q&sort&page&limit */
export const jobCandidateRouter = Router();
jobCandidateRouter.get('/:id/candidates', authenticate, authorizeGroup('candidates'), validate({ params: idParams, query: listCandidatesQuerySchema }), asyncHandler(listCandidatesController));

/** Mounted at /candidates: detail, notes, soft delete. */
export const candidateCrudRouter = Router();
candidateCrudRouter.get('/:id', authenticate, authorizeGroup('candidates'), validate({ params: idParams }), asyncHandler(getCandidateController));
candidateCrudRouter.patch('/:id', authenticate, authorizeGroup('candidates'), writeLimiter, validate({ params: idParams, body: patchCandidateSchema }), asyncHandler(patchCandidateController));
candidateCrudRouter.delete('/:id', authenticate, authorizeGroup('candidates'), writeLimiter, validate({ params: idParams }), asyncHandler(deleteCandidateController));

const decisionBody = z.object({ action: z.enum(['hold', 'reject', 'reopen']) });
/** HR decision: put on hold (waiting list), reject, or move back to review. Emails the candidate for hold and reject. */
candidateCrudRouter.post('/:id/decision', authenticate, authorizeGroup('candidates'), writeLimiter, validate({ params: idParams, body: decisionBody }), asyncHandler(decideCandidateController));
