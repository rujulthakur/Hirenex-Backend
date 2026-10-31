import { Router } from 'express';
import { z } from 'zod';
import {
  createJobController, getInterviewersController, importJobController, getJobController, listJobsController, putInterviewersController, updateJobController,
} from '../controllers/job.controller';
import { authenticate } from '../middleware/authenticate';
import { authorizeGroup } from '../middleware/authorize';
import { createRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { documentUpload } from '../middleware/upload';
import { JOB_STATUSES } from '../types/enums';
import { createJobSchema, jobParamsSchema, replaceInterviewersSchema, updateJobSchema } from '../types/job.schema';
import { paginationQuerySchema } from '../utils/pagination';
import { asyncHandler } from '../utils/asyncHandler';

const writeLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });
const listQuery = paginationQuerySchema.extend({ status: z.enum(JOB_STATUSES).optional() });

/** Mounted at /jobs. HR roles only (group "jobs"). */
export const jobRouter = Router();
jobRouter.get('/', authenticate, authorizeGroup('jobs'), validate({ query: listQuery }), asyncHandler(listJobsController));
jobRouter.post('/', authenticate, authorizeGroup('jobs'), writeLimiter, validate({ body: createJobSchema }), asyncHandler(createJobController));
jobRouter.post('/import', authenticate, authorizeGroup('jobs'), createRateLimiter({ windowMs: 60_000, max: 10 }), documentUpload.single('file'), asyncHandler(importJobController));
jobRouter.get('/:id', authenticate, authorizeGroup('jobs'), validate({ params: jobParamsSchema }), asyncHandler(getJobController));
jobRouter.patch('/:id', authenticate, authorizeGroup('jobs'), writeLimiter, validate({ params: jobParamsSchema, body: updateJobSchema }), asyncHandler(updateJobController));
jobRouter.get('/:id/interviewers', authenticate, authorizeGroup('jobs'), validate({ params: jobParamsSchema }), asyncHandler(getInterviewersController));
jobRouter.put('/:id/interviewers', authenticate, authorizeGroup('jobs'), writeLimiter, validate({ params: jobParamsSchema, body: replaceInterviewersSchema }), asyncHandler(putInterviewersController));
