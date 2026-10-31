import type { Request, Response } from 'express';
import { candidateCopyService } from '../services/candidateCopy.service';
import { ingestionService } from '../services/ingestion.service';
import { UnauthenticatedError, UploadRejectedError } from '../utils/errors';

/** POST /jobs/:id/resumes. Returns the per-file results {fileName, status, candidateId?, flags[], reason?}. */
export async function uploadResumesController(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthenticatedError();
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) throw new UploadRejectedError('No files received. Use the multipart field named "files".');

  const results = await ingestionService.ingestBatch(
    String(req.params['id']),
    files.map((f) => ({ originalname: f.originalname, buffer: f.buffer })),
    { id: req.user.id, role: req.user.role, name: req.user.name },
  );
  res.status(200).json({ data: results });
}

/** POST /jobs/:id/copy-candidates {fromJobId, candidateIds?}: score resumes from another opening for this one. */
export async function copyCandidatesController(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthenticatedError();
  const body = req.body as { fromJobId: string; candidateIds?: string[] };
  const out = await candidateCopyService.copyToJob(String(req.params['id']), body.fromJobId, body.candidateIds, {
    id: req.user.id,
    role: req.user.role,
    name: req.user.name,
  });
  res.status(200).json({ data: out });
}
