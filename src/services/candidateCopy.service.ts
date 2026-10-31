import { Types } from 'mongoose';
import { CandidateModel } from '../models/candidate.model';
import { candidateRepository } from '../repositories/candidate.repository';
import { candidateScoringRepository } from '../repositories/candidateScoring.repository';
import { jobRepository } from '../repositories/job.repository';
import type { CandidateFlag } from '../types/enums';
import { ConflictError, NotFoundError } from '../utils/errors';
import { auditService, type AuditActor } from './audit.service';
import type { CandidateProfile } from './ingestion/profileExtract';

/** Score badges belong to one opening. They are rebuilt when the copy is scored, so they are not carried over. */
const SCORE_FLAGS: readonly CandidateFlag[] = ['unverified_evidence', 'incomplete', 'needs_review'];

export interface CopyResult {
  added: number;
  skipped: number;
  candidateIds: string[];
}

/**
 * Puts resumes that were already uploaded for one opening into another opening, so they can be scored against
 * that opening's skills and criteria. Nothing is re-read from a file: the stored text is reused, and a resume
 * that is already in the target opening is skipped. The source candidates and their scores are not touched.
 */
async function copyToJob(targetJobId: string, fromJobId: string, candidateIds: string[] | undefined, actor: AuditActor): Promise<CopyResult> {
  if (targetJobId === fromJobId) throw new ConflictError('Pick a different opening to score these resumes for.');
  const [target, source] = await Promise.all([jobRepository.findById(targetJobId), jobRepository.findById(fromJobId)]);
  if (!target || !source) throw new NotFoundError('Opening not found');

  const query: Record<string, unknown> = {
    jobId: new Types.ObjectId(fromJobId),
    deletedAt: { $exists: false },
    flags: { $ne: 'unreadable_scan' },
  };
  if (candidateIds && candidateIds.length > 0) query['_id'] = { $in: candidateIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id)) };

  const rows = await CandidateModel.find(query).sort({ uploadOrder: 1 }).lean();

  let added = 0;
  let skipped = 0;
  const createdIds: string[] = [];
  for (const row of rows) {
    const original = await candidateScoringRepository.getOriginalText(String(row._id));
    if (original === null || !row.redactedText) {
      skipped += 1;
      continue;
    }
    const profile = row.profile
      ? ({
          name: row.profile.name ?? '',
          email: row.profile.email ?? '',
          phone: row.profile.phone ?? '',
          location: row.profile.location ?? '',
          links: row.profile.links ?? [],
          skills: row.profile.skills ?? [],
          keyPoints: row.profile.keyPoints ?? [],
        } satisfies CandidateProfile)
      : undefined;
    const res = await candidateRepository.create({
      jobId: targetJobId,
      fileName: row.fileName,
      fileType: row.fileType,
      textHash: row.textHash,
      uploadedBy: row.uploadedBy ? String(row.uploadedBy) : actor.id,
      originalText: original,
      redactedText: row.redactedText,
      flags: (row.flags as CandidateFlag[]).filter((f) => !SCORE_FLAGS.includes(f)),
      hiddenFindings: row.hiddenFindings ?? [],
      ...(profile ? { profile } : {}),
    });
    if (res.created) {
      added += 1;
      createdIds.push(res.candidateId);
    } else {
      skipped += 1;
    }
  }

  await auditService.append({
    actor,
    action: 'resume.upload',
    entityType: 'job',
    entityId: targetJobId,
    jobId: targetJobId,
    payload: { copiedFrom: fromJobId, added, skipped },
  });
  return { added, skipped, candidateIds: createdIds };
}

export const candidateCopyService = { copyToJob };
