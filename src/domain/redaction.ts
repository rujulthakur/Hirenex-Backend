/**
 * PURE. Blind redaction: removes identity fields and proxies BEFORE any AI sees the resume.
 *
 * DECISION on schools: institution names are a strong socio-economic / caste / region proxy, so they
 * are replaced with [INSTITUTION] and ONLY the degree level (Bachelor, Master, PhD, Diploma) and the
 * field of study stay. Graduation years and affiliations are removed because they reveal age and
 * community. Job dates (2019 - 2023 at a company) stay: they are needed to judge experience.
 */
export interface RedactionResult {
  redactedText: string;
  removedCategories: string[];
}

const SECTION_HEADINGS = /^(experience|work experience|employment|education|skills|technical skills|projects|summary|profile|objective|certifications?|achievements|publications|languages|interests)\s*:?\s*$/i;
const AFFILIATION_HEADING = /^(clubs?|affiliations?|memberships?|societies|extracurriculars?|extra[- ]curricular activities|fraternit(?:y|ies)|sororit(?:y|ies)|community)\s*[:\-]?\s*(.*)$/i;
const AFFILIATION_INLINE = /\b(fraternity|sorority|alumni association|rotary club|lions club|greek life|sigma|chapter president)\b/i;
const EDU_LINE = /\b(b\.?\s?tech|b\.?\s?e\b|b\.?\s?sc|bachelor|master|m\.?\s?tech|m\.?\s?sc|mba|ph\.?d|diploma|university|college|institute|school|graduat|class of|batch|alumni)/i;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b(?:linkedin|github|gitlab|twitter|x|instagram|facebook|medium)\.com\/\S+/gi;
const HANDLE = /(?<![\w.])@[A-Za-z0-9_]{3,30}\b/g;
const PHONE = /(?<!\d)(\+?\d[\d\s().-]{8,}\d)(?!\d)/g;
const DOB = /\b(date of birth|d\.?o\.?b\.?|born(?: on)?)\s*[:\-]?\s*[\w ,/.-]{4,25}/gi;
const AGE = /\b(age\s*[:\-]?\s*\d{2}|\d{2}\s*(?:years?|yrs?)\s*old|aged\s+\d{2})\b/gi;
const STREET = /\b\d{1,5}[A-Za-z]?[,\s]+(?:[A-Za-z0-9.'-]+\s+){1,4}(?:street|st\.|road|rd\.|avenue|ave\.|lane|ln\.|nagar|colony|sector|block|marg|chowk|apartment|apt\.|flat)\b[^\n]{0,40}/gi;
const ADDRESS_LABEL = /\b(address|resident of|residing at|permanent address|current address)\s*[:\-]?[^\n]{0,80}/gi;
const PIN = /\b(?:pin(?:code)?\s*[:\-]?\s*)?\d{6}\b|\b\d{5}(?:-\d{4})?\b(?=\s*(?:,|\n|$))/gi;
const PHOTO = /\b(photo(?:graph)?|passport[- ]size photo|profile (?:picture|photo)|headshot)\b[^\n]{0,30}/gi;
const GENDER = /\b(he|she|his|her|hers|him|himself|herself|mr|mrs|ms|miss|mx|male|female|man|woman|husband|wife|gentleman|lady)\b\.?/gi;
const INSTITUTION = /\b(?:[A-Z][\w.&'-]*\s+){0,5}(?:University|Institute|College|School|Academy|Polytechnic)\b(?:\s+of\s+(?:[A-Z][\w.&'-]*\s*){1,4})?/g;
const YEAR = /\b(?:19|20)\d{2}\b/g;

const FILENAME_STOP = new Set(['resume', 'cv', 'final', 'new', 'copy', 'updated', 'docx', 'pdf', 'profile', 'draft', 'v1', 'v2']);
const NAME_STOP = new Set(['candidate', 'resume', 'curriculum', 'vitae', 'summary', 'profile', 'experience', 'education', 'skills', 'projects']);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** PURE. Name tokens from the header block (first non-empty line) and the file name. */
export function detectNameTokens(text: string, fileName: string): string[] {
  const tokens = new Set<string>();
  const first = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const words = first.split(/\s+/);
  const looksLikeName =
    words.length >= 1 && words.length <= 4 && words.every((w) => /^[A-Z][A-Za-z'.-]{1,}$/.test(w)) && !SECTION_HEADINGS.test(first);
  if (looksLikeName) {
    for (const w of words) {
      if (w.length >= 3 && !NAME_STOP.has(w.toLowerCase())) tokens.add(w);
    }
  }
  const base = fileName.replace(/\.[^.]+$/, '');
  for (const t of base.split(/[^A-Za-z]+/)) {
    if (t.length >= 3 && !FILENAME_STOP.has(t.toLowerCase())) tokens.add(t);
  }
  return [...tokens];
}

export function redact(input: string, fileName: string): RedactionResult {
  const removed = new Set<string>();
  const sub = (text: string, re: RegExp, token: string, category: string): string =>
    text.replace(re, () => {
      removed.add(category);
      return token;
    });

  const nameTokens = detectNameTokens(input, fileName);
  let text = input;

  // 1. Line-level removal: affiliation sections, then the header name line.
  const lines = text.split('\n');
  const kept: string[] = [];
  let inAffiliation = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (inAffiliation) {
      if (trimmed === '' || SECTION_HEADINGS.test(trimmed)) inAffiliation = false;
      else {
        removed.add('affiliation');
        continue;
      }
    }
    const heading = AFFILIATION_HEADING.exec(trimmed);
    if (heading && trimmed.length < 120) {
      removed.add('affiliation');
      kept.push('[AFFILIATION REMOVED]');
      inAffiliation = true;
      continue;
    }
    if (AFFILIATION_INLINE.test(trimmed)) {
      removed.add('affiliation');
      kept.push('[AFFILIATION REMOVED]');
      continue;
    }
    kept.push(line);
  }
  text = kept.join('\n');

  // 2. Contact details and personal data.
  text = sub(text, EMAIL, '[EMAIL]', 'email');
  text = sub(text, URL_RE, '[URL]', 'url');
  text = sub(text, HANDLE, '[HANDLE]', 'handle');
  text = sub(text, DOB, '[DOB]', 'dob');
  text = sub(text, AGE, '[AGE]', 'age');
  // Only treat a digit run as a phone number when it has 10+ digits, so job date ranges like
  // "2021 - 2024" are NOT redacted (the scorer needs them to judge experience).
  text = text.replace(PHONE, (m) => {
    if (m.replace(/\D/g, '').length < 10) return m;
    removed.add('phone');
    return '[PHONE]';
  });
  text = sub(text, ADDRESS_LABEL, '[ADDRESS]', 'address');
  text = sub(text, STREET, '[ADDRESS]', 'address');
  text = sub(text, PIN, '[ADDRESS]', 'address');
  text = sub(text, PHOTO, '[PHOTO]', 'photo');

  // 3. Education proxies, only on education-like lines: school names and graduation years.
  text = text
    .split('\n')
    .map((line) => {
      if (!EDU_LINE.test(line)) return line;
      let l = sub(line, INSTITUTION, '[INSTITUTION]', 'school');
      l = sub(l, YEAR, '', 'graduation_year');
      return l.replace(/\(\s*[-–—]?\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\s*[-–—]\s*$/, '').trimEnd();
    })
    .join('\n');

  // 4. Name tokens everywhere, then gender words and titles.
  if (nameTokens.length > 0) {
    const nameRe = new RegExp(`\\b(?:${nameTokens.map(escapeRe).join('|')})\\b`, 'gi');
    text = sub(text, nameRe, '[CANDIDATE]', 'name');
  }
  text = sub(text, GENDER, '[GENDER]', 'gender');

  text = text.replace(/(\[CANDIDATE\])(\s+\[CANDIDATE\])+/g, '$1');
  return { redactedText: text, removedCategories: [...removed] };
}
