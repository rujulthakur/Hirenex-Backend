import { Router } from 'express';
import { z } from 'zod';
import { copyCandidatesController, uploadResumesController } from '../controllers/resume.controller';
import { authenticate } from '../middleware/authenticate';
import { authorizeGroup } from '../middleware/authorize';
import { createRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { MAX_UPLOAD_FILES, resumeUpload } from '../middleware/upload';
import { objectIdSchema } from '../types/common';
import { asyncHandler } from '../utils/asyncHandler';

const uploadLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

/** Mounted at /jobs: POST /jobs/:id/resumes (multipart, field "files", up to 50 files, 5 MB each). */
export const jobResumeRouter = Router();
jobResumeRouter.post(
  '/:id/resumes',
  authenticate,
  authorizeGroup('resumes'),
  uploadLimiter,
  validate({ params: z.object({ id: objectIdSchema }) }),
  resumeUpload.array('files', MAX_UPLOAD_FILES),
  asyncHandler(uploadResumesController),
);

/** POST /jobs/:id/copy-candidates: reuse resumes already uploaded for another opening. */
jobResumeRouter.post(
  '/:id/copy-candidates',
  authenticate,
  authorizeGroup('resumes'),
  uploadLimiter,
  validate({
    params: z.object({ id: objectIdSchema }),
    body: z.object({ fromJobId: objectIdSchema, candidateIds: z.array(objectIdSchema).max(200).optional() }),
  }),
  asyncHandler(copyCandidatesController),
);
