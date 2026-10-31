import type { CandidateStage, JobStatus } from '../types/enums';

/**
 * PURE. Approval gate rules. "Nothing is emailed before HR approves a shortlist AND a ranked waitlist."
 */
export const APPROVED_JOB_STATUSES: readonly JobStatus[] = ['approved', 'scheduled', 'invited'];

export function isApproved(status: JobStatus): boolean {
  return APPROVED_JOB_STATUSES.includes(status);
}

export interface ApprovalInput {
  /** Candidate id -> current stage, for every non-deleted candidate of THIS job. */
  stageById: ReadonlyMap<string, CandidateStage>;
  shortlistIds: ReadonlyArray<string>;
  waitlistIds: ReadonlyArray<string>;
  capacity: number;
  waitlistSize: number;
}

export interface ApprovalCheck {
  ok: boolean;
  errors: string[];
}

/** Stages from which a candidate may be put on the shortlist or waitlist. */
const SELECTABLE: readonly CandidateStage[] = ['scored', 'shortlisted', 'waitlisted'];

export function validateApproval(input: ApprovalInput): ApprovalCheck {
  const errors: string[] = [];
  const { shortlistIds, waitlistIds } = input;

  if (shortlistIds.length === 0) errors.push('The shortlist must contain at least one candidate');
  if (shortlistIds.length > input.capacity) errors.push(`The shortlist has ${shortlistIds.length} candidates but capacity is ${input.capacity}`);
  if (waitlistIds.length > input.waitlistSize) errors.push(`The waitlist has ${waitlistIds.length} candidates but the limit is ${input.waitlistSize}`);

  if (new Set(shortlistIds).size !== shortlistIds.length) errors.push('The shortlist contains duplicate ids');
  if (new Set(waitlistIds).size !== waitlistIds.length) errors.push('The waitlist contains duplicate ids');

  const shortSet = new Set(shortlistIds);
  const overlap = waitlistIds.filter((id) => shortSet.has(id));
  if (overlap.length > 0) errors.push(`Candidates cannot be on both lists: ${overlap.join(', ')}`);

  for (const id of [...shortlistIds, ...waitlistIds]) {
    const stage = input.stageById.get(id);
    if (stage === undefined) errors.push(`Candidate ${id} does not belong to this job`);
    else if (!SELECTABLE.includes(stage)) errors.push(`Candidate ${id} is in stage "${stage}" and cannot be selected`);
  }
  return { ok: errors.length === 0, errors };
}
