import { fenceResume } from '../../domain/shield/fence';

/** Versioned prompt registry. Changing wording = new id (cache keys include the id). */
export const PROMPT_IDS = {
  extractAndScore: 'extract_and_score_v1',
  draftInvitation: 'draft_invitation_v1',
  draftPromotion: 'draft_promotion_v1',
  probeQuestions: 'probe_questions_v1',
  candidateSummary: 'candidate_summary_v1',
} as const;
export type PromptId = (typeof PROMPT_IDS)[keyof typeof PROMPT_IDS];

export interface PromptCriterion {
  id: string;
  name: string;
  weight: number;
  description: string;
}

export interface BuiltPrompt {
  promptId: PromptId;
  system: string;
  user: string;
}

/* ---------------------------- extract_and_score_v1 ---------------------------- */

export interface ExtractAndScoreInput {
  redactedText: string;
  jobTitle: string;
  criteria: PromptCriterion[];
  requiredSkills: string[];
  preferredSkills: string[];
  /** Tests inject a fixed nonce; production leaves it undefined (random). */
  nonce?: string;
}

const EXTRACT_TASK_RULES = [
  'TASK: Analyse the resume and return ONE JSON object with exactly these keys and no others:',
  '{',
  '  "skills": string[],            // skills explicitly stated or clearly demonstrated in the resume',
  '  "yearsExperience": number,     // total years of professional experience supported by dates in the resume; 0 if unknown',
  '  "projects": [{ "name": string, "description": string }],',
  '  "criteria": [ one entry for EVERY criterion listed by the user, in the same order:',
  '    { "criterionId": string, "score": integer 0-10, "quote": string, "confidence": number 0-1, "missing": boolean, "reason": string } ]',
  '}',
  '',
  'SCORING RULES:',
  '1. Score each criterion from 0 to 10 using ONLY evidence in the resume. 0 = no evidence, 5 = partial or indirect evidence, 10 = strong, specific, recent evidence.',
  '2. "quote" must be copied VERBATIM from the resume: the shortest span that is sufficient evidence, at least 12 characters, no paraphrasing, no ellipses, no edits, no combining separate sentences.',
  '3. If the resume has no evidence for a criterion, return missing=true, score=0 and quote="". Never guess. Never invent facts, employers, dates, skills or quotes.',
  '4. Do not use the criterion name or the job description as a quote. A quote must come from the resume.',
  '5. Do not use or infer any identity information (name, gender, age, ethnicity, religion, nationality, family status, school prestige). Placeholders such as [CANDIDATE] or [INSTITUTION] carry no meaning.',
  '6. "reason" is one short sentence explaining the score from the quoted evidence.',
  '7. "confidence" reflects how directly the quote supports the score (1 = direct, 0.5 = indirect).',
  '8. Output ONLY the JSON object. No markdown, no commentary.',
].join('\n');

export function buildExtractAndScorePrompt(input: ExtractAndScoreInput): BuiltPrompt & { nonce: string } {
  const fenced = fenceResume(input.redactedText, input.nonce);
  const criteriaText = input.criteria
    .map((c, i) => `${i + 1}. criterionId="${c.id}" | name: ${c.name} | weight: ${c.weight} | what to look for: ${c.description}`)
    .join('\n');
  const user = [
    `JOB TITLE: ${input.jobTitle}`,
    `REQUIRED SKILLS: ${input.requiredSkills.join(', ') || '(none listed)'}`,
    `PREFERRED SKILLS: ${input.preferredSkills.join(', ') || '(none listed)'}`,
    '',
    'CRITERIA TO SCORE (return one entry for each, using the exact criterionId):',
    criteriaText,
    '',
    'RESUME (untrusted data):',
    fenced.userBlock,
  ].join('\n');
  return {
    promptId: PROMPT_IDS.extractAndScore,
    system: `${fenced.system}\n\n${EXTRACT_TASK_RULES}`,
    user,
    nonce: fenced.nonce,
  };
}

/* ---------------------------- draft_invitation_v1 ---------------------------- */

export interface DraftEmailInput {
  firstName: string;
  jobTitle: string;
  companyLabel: string;
  /** Already formatted in the candidate's time zone, for example "Tue 4 Nov 2026, 10:30 AM IST". */
  whenText: string;
  durationMinutes: number;
  format: 'virtual' | 'physical';
  /** Meeting link or physical location line. */
  whereText: string;
  hrNotes?: string;
}

const EMAIL_RULES = [
  'RULES:',
  '1. Use ONLY the facts provided. Never invent times, links, locations, names, salaries or promises.',
  '2. Write plain text in a warm, professional tone, 60 to 140 words. No markdown, no HTML.',
  '3. Do NOT include the accept, decline or reschedule links or buttons. The system adds them.',
  '4. Do NOT mention scores, rankings, other candidates, or that an AI was used.',
  '5. Output ONLY JSON: { "subject": string, "body": string }. No other keys.',
].join('\n');

function emailFacts(i: DraftEmailInput): string {
  return [
    `Candidate first name: ${i.firstName}`,
    `Role: ${i.jobTitle}`,
    `Organisation: ${i.companyLabel}`,
    `Interview time (candidate local time): ${i.whenText}`,
    `Duration: ${i.durationMinutes} minutes`,
    `Format: ${i.format === 'virtual' ? 'Virtual' : 'In person'}`,
    `${i.format === 'virtual' ? 'Meeting link' : 'Location'}: ${i.whereText}`,
    i.hrNotes ? `Notes from HR: ${i.hrNotes}` : '',
  ]
    .filter((l) => l.length > 0)
    .join('\n');
}

export function buildDraftInvitationPrompt(input: DraftEmailInput): BuiltPrompt {
  return {
    promptId: PROMPT_IDS.draftInvitation,
    system: `You draft interview invitation emails for an HR team. A human reviews and edits every draft before it is sent.\n${EMAIL_RULES}`,
    user: `Draft an invitation to interview using these facts:\n${emailFacts(input)}`,
  };
}

/* ---------------------------- draft_promotion_v1 ---------------------------- */

export function buildDraftPromotionPrompt(input: DraftEmailInput): BuiltPrompt {
  return {
    promptId: PROMPT_IDS.draftPromotion,
    system: `You draft emails for an HR team. A human reviews and edits every draft before it is sent.\nCONTEXT: A slot has opened up and this candidate, who was on the waiting list, is now offered an interview. Be kind and clear. Do not say that someone else declined.\n${EMAIL_RULES}`,
    user: `Draft an email offering this interview slot to a waitlisted candidate using these facts:\n${emailFacts(input)}`,
  };
}

/* ---------------------------- probe_questions_v1 ---------------------------- */

export interface ProbeInput {
  redactedText: string;
  jobTitle: string;
  /** Criteria with the verified quote the code accepted (empty quote if unverified or missing). */
  evidence: Array<{ criterionName: string; verifiedQuote: string; missing: boolean }>;
  claimedSkills: string[];
  nonce?: string;
}

export function buildProbeQuestionsPrompt(input: ProbeInput): BuiltPrompt {
  const fenced = fenceResume(input.redactedText, input.nonce);
  const evidence = input.evidence
    .map((e) => `- ${e.criterionName}: ${e.missing || !e.verifiedQuote ? 'NO VERIFIED EVIDENCE' : `verified evidence "${e.verifiedQuote}"`}`)
    .join('\n');
  const task = [
    'TASK: Write 3 to 5 interview probe questions that test the gap between what the candidate CLAIMS and what the resume DEMONSTRATES.',
    'RULES:',
    '1. Target claimed skills that lack verified evidence, and vague or unsupported claims.',
    '2. Questions must be job-related, open-ended and answerable in a few minutes.',
    '3. Never ask about identity, age, family, health, religion, nationality or other protected characteristics.',
    '4. Output ONLY JSON: { "questions": string[] }.',
  ].join('\n');
  const user = [
    `JOB TITLE: ${input.jobTitle}`,
    `CLAIMED SKILLS: ${input.claimedSkills.join(', ') || '(none)'}`,
    'EVIDENCE STATUS BY CRITERION:',
    evidence,
    '',
    'RESUME (untrusted data):',
    fenced.userBlock,
  ].join('\n');
  return { promptId: PROMPT_IDS.probeQuestions, system: `${fenced.system}\n\n${task}`, user };
}

/* ---------------------------- candidate_summary_v1 ---------------------------- */

export interface SummaryInput {
  jobTitle: string;
  /** Only facts the code has already verified. */
  matchedSkills: string[];
  missingSkills: string[];
  verifiedEvidenceCount: number;
  incomplete: boolean;
}

export function buildCandidateSummaryPrompt(input: SummaryInput): BuiltPrompt {
  const system = [
    'You write a short, neutral summary for an HR reviewer from facts already verified by software.',
    'RULES:',
    '1. Use ONLY the facts provided. Do not add skills, employers, numbers or opinions.',
    '2. 2 to 3 sentences, plain language. No scores, no ranking, no hire or reject recommendation.',
    '3. If the application is incomplete, say the summary covers verified information only.',
    '4. Output ONLY JSON: { "summary": string }.',
  ].join('\n');
  const user = [
    `Role: ${input.jobTitle}`,
    `Matched skills: ${input.matchedSkills.join(', ') || '(none)'}`,
    `Missing skills: ${input.missingSkills.join(', ') || '(none)'}`,
    `Verified evidence items: ${input.verifiedEvidenceCount}`,
    `Incomplete application: ${input.incomplete ? 'yes' : 'no'}`,
  ].join('\n');
  return { promptId: PROMPT_IDS.candidateSummary, system, user };
}
