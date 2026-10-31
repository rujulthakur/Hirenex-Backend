import { candidateRepository, type CandidateLean } from '../repositories/candidate.repository';
import type { CandidateFlag, CandidateStage, FileType } from '../types/enums';
import { ConflictError, NotFoundError } from '../utils/errors';
import { parseSort } from '../utils/pagination';
import { auditService, type AuditActor } from './audit.service';

export interface CandidateRowDto {
  id: string;
  jobId: string;
  fileName: string;
  fileType: FileType;
  stage: CandidateStage;
  rank?: number;
  totalScore?: number;
  coverage?: number;
  verifiedEvidenceCount?: number;
  yearsExperience?: number;
  flags: CandidateFlag[];
  uploadOrder: number;
  /** Start of the auto-reject clock (restarted when HR moves a candidate back to review). */
  reviewClockStart?: string;
  holdUntil?: string;
  rejectionReason?: 'hr_rejected' | 'no_response' | 'hold_expired';
  /** Contact and summary details extracted from the resume for the HR view. */
  profile?: { name: string; email: string; phone: string; location: string; links: string[]; skills: string[]; keyPoints: string[] };
}

export interface CandidateDetailDto extends CandidateRowDto {
  /** REDACTED text only. The original text lives in candidateTexts and never reaches an API payload. */
  redactedText: string;
  parsedSkills: string[];
  projects: string[];
  hiddenFindings: Array<{ type: string; text: string; location: string }>;
  tieBreakTrace?: string[];
  notes: string;
}

const SORTABLE = ['rank', 'totalScore', 'uploadOrder', 'fileName', 'stage', 'createdAt'] as const;

export function toRow(c: CandidateLean): CandidateRowDto {
  return {
    id: String(c._id),
    jobId: String(c.jobId),
    fileName: c.fileName,
    fileType: c.fileType,
    stage: c.stage,
    ...(c.rank != null ? { rank: c.rank } : {}),
    ...(c.totalScore != null ? { totalScore: c.totalScore } : {}),
    ...(c.coverage != null ? { coverage: c.coverage } : {}),
    ...(c.verifiedEvidenceCount != null ? { verifiedEvidenceCount: c.verifiedEvidenceCount } : {}),
    ...(c.yearsExperience != null ? { yearsExperience: c.yearsExperience } : {}),
    flags: c.flags as CandidateFlag[],
    uploadOrder: c.uploadOrder,
    ...((c.reviewStartedAt ?? (c as { createdAt?: Date }).createdAt) ? { reviewClockStart: new Date((c.reviewStartedAt ?? (c as { createdAt?: Date }).createdAt) as Date).toISOString() } : {}),
    ...(c.holdUntil ? { holdUntil: c.holdUntil.toISOString() } : {}),
    ...(c.rejectionReason ? { rejectionReason: c.rejectionReason } : {}),
    ...(c.profile ? { profile: { name: c.profile.name ?? '', email: c.profile.email ?? '', phone: c.profile.phone ?? '', location: c.profile.location ?? '', links: c.profile.links ?? [], skills: c.profile.skills ?? [], keyPoints: c.profile.keyPoints ?? [] } } : {}),
  };
}

export function toDetail(c: CandidateLean): CandidateDetailDto {
  return {
    ...toRow(c),
    redactedText: c.redactedText ?? '',
    parsedSkills: c.parsedSkills,
    projects: c.projects,
    hiddenFindings: c.hiddenFindings.map((h) => ({ type: h.type, text: h.text, location: h.location })),
    ...(c.tieBreakTrace ? { tieBreakTrace: c.tieBreakTrace } : {}),
    notes: c.notes ?? '',
  };
}

async function list(
  jobId: string,
  q: { stage?: CandidateStage; q?: string; history?: string; sort?: string; page: number; limit: number },
): Promise<{ items: CandidateRowDto[]; total: number }> {
  const sort = parseSort(q.sort, SORTABLE, { rank: 1, uploadOrder: 1 });
  const filter = { ...(q.stage ? { stage: q.stage } : {}), ...(q.q ? { q: q.q } : {}), ...(q.history ? { history: true } : {}) };
  const { items, total } = await candidateRepository.listForJob(jobId, filter, sort, (q.page - 1) * q.limit, q.limit);
  return { items: items.map(toRow), total };
}

async function get(candidateId: string): Promise<CandidateDetailDto> {
  const c = await candidateRepository.findLive(candidateId);
  if (!c) throw new NotFoundError('Candidate not found');
  return toDetail(c);
}

async function setNotes(candidateId: string, notes: string, actor: AuditActor): Promise<CandidateDetailDto> {
  const before = await candidateRepository.findLive(candidateId);
  if (!before) throw new NotFoundError('Candidate not found');
  const after = await candidateRepository.setNotes(candidateId, notes);
  if (!after) throw new NotFoundError('Candidate not found');
  // Notes text is not copied into the audit log, only its length, so free text never leaks into the chain.
  await auditService.append({ actor, action: 'candidate.note', entityType: 'candidate', entityId: candidateId, jobId: String(before.jobId), payload: { oldLength: (before.notes ?? '').length, newLength: notes.length } });
  return toDetail(after);
}

/** Soft delete. Refused while the candidate holds a booked slot: decline or reschedule first so the repair engine runs. */
async function remove(candidateId: string, actor: AuditActor): Promise<{ deleted: true }> {
  const c = await candidateRepository.findLive(candidateId);
  if (!c) throw new NotFoundError('Candidate not found');
  if (await candidateRepository.hasBookedSlot(candidateId)) {
    throw new ConflictError('This candidate has a booked interview slot. Resolve the booking (decline or reschedule) before deleting.');
  }
  await candidateRepository.softDelete(candidateId);
  await auditService.append({ actor, action: 'candidate.delete', entityType: 'candidate', entityId: candidateId, jobId: String(c.jobId), oldValue: { stage: c.stage, fileName: c.fileName } });
  return { deleted: true };
}

export const candidateService = { list, get, setNotes, remove };
