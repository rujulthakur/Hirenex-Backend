import { isApproved } from '../domain/approval';
import type { JobStatus } from '../types/enums';
import { ApprovalRequiredError } from '../utils/errors';

/**
 * Reusable guard. Throws APPROVAL_REQUIRED (HTTP 409/contract status from the error class) unless HR has
 * approved the shortlist. Used by schedule, invite preview/send, and any code path that could email a candidate.
 */
export function requireApproved(job: { status: JobStatus }): void {
  if (!isApproved(job.status)) throw new ApprovalRequiredError();
}
