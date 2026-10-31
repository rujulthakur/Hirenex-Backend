/** Contract v1 enums. Exact strings; do not rename. */
export const CANDIDATE_STAGES = [
  'applied',
  'scored',
  'shortlisted',
  'waitlisted',
  'on_hold',
  'invited',
  'confirmed',
  'declined',
  'rejected',
] as const;
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

export const JOB_STATUSES = ['draft', 'open', 'scored', 'approved', 'scheduled', 'invited'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const SLOT_STATUSES = ['open', 'booked', 'blocked'] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

/** 'draft' is internal (invite not yet sent); contract values are queued | sent | viewed | failed. */
export const EMAIL_STATUSES = ['draft', 'queued', 'sent', 'viewed', 'failed'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const INVITE_RESPONSES = ['pending', 'accepted', 'declined', 'reschedule_requested'] as const;
export type InviteResponse = (typeof INVITE_RESPONSES)[number];

export const ROLES = ['hr_admin', 'interviewer', 'demo_hr'] as const;
export type Role = (typeof ROLES)[number];

export const AUTHORITIES = ['ai', 'code', 'human'] as const;
export type Authority = (typeof AUTHORITIES)[number];

export const MEETING_FORMATS = ['virtual', 'physical'] as const;
export type MeetingFormat = (typeof MEETING_FORMATS)[number];

export const FILE_TYPES = ['pdf', 'docx'] as const;
export type FileType = (typeof FILE_TYPES)[number];

/** Badges are flags on a candidate, not stages. */
export const CANDIDATE_FLAGS = [
  'flagged',
  'unverified_evidence',
  'incomplete',
  'hidden_text_found',
  'injection_phrase_found',
  'unreadable_scan',
  'needs_review',
  'near_duplicate',
  'rank_unstable',
] as const;
export type CandidateFlag = (typeof CANDIDATE_FLAGS)[number];

export const HIDDEN_FINDING_TYPES = [
  'white_text',
  'tiny_font',
  'vanish',
  'comment',
  'header_footer',
  'doc_property',
  'offpage',
  'metadata',
] as const;
export type HiddenFindingType = (typeof HIDDEN_FINDING_TYPES)[number];
