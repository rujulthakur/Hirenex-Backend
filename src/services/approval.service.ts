import { isApproved, validateApproval } from '../domain/approval';
import { candidateScoringRepository } from '../repositories/candidateScoring.repository';
import { jobRepository } from '../repositories/job.repository';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { auditService, type AuditActor } from './audit.service';

export interface ApprovalResult {
  jobId: string;
  status: 'approved';
  shortlistIds: string[];
  waitlistIds: string[];
  approvedAt: string;
  auditSeq: number;
}

/**
 * POST /jobs/:id/approve {shortlistIds, waitlistIds}. HUMAN gate: validates ids belong to the job, sizes are within
 * capacity and waitlistSize, no overlaps. Sets stages, job status "approved", approvedAt/approvedBy, and audits.
 * Everything that can email a candidate (schedule, invites, portal email) calls requireApproved(job) afterwards.
 */
async function approve(jobId: string, shortlistIds: string[], waitlistIds: string[], actor: AuditActor): Promise<ApprovalResult> {
  const job = await jobRepository.findById(jobId);
  if (!job) throw new NotFoundError('Job not found');
  if (isApproved(job.status)) throw new ConflictError('This job has already been approved');

  const stageById = await candidateScoringRepository.stageMap(jobId);
  const check = validateApproval({ stageById, shortlistIds, waitlistIds, capacity: job.capacity, waitlistSize: job.waitlistSize });
  if (!check.ok) throw new ValidationError('The approval request is not valid', check.errors.map((message) => ({ message })));

  // Atomic status flip: two parallel approvals cannot both win.
  const won = await jobRepository.markApproved(jobId, actor.id);
  if (!won) throw new ConflictError('This job has already been approved');

  await candidateScoringRepository.setStages(jobId, shortlistIds, 'shortlisted');
  await candidateScoringRepository.setStages(jobId, waitlistIds, 'waitlisted');

  const approvedAt = new Date().toISOString();
  const receipt = await auditService.append({
    actor,
    action: 'shortlist.approve',
    entityType: 'job',
    entityId: jobId,
    jobId,
    oldValue: { status: job.status },
    newValue: { status: 'approved' },
    payload: { shortlistIds, waitlistIds, shortlistCount: shortlistIds.length, waitlistCount: waitlistIds.length },
  });

  return { jobId, status: 'approved', shortlistIds, waitlistIds, approvedAt, auditSeq: receipt.seq };
}

export const approvalService = { approve };
