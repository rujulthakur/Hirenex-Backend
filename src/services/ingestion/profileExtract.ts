/**
 * PURE. Pulls the contact and summary details an HR user wants to see (name, email, phone, place, skills,
 * key points) out of the ORIGINAL resume text. This runs at upload time only. The scoring model never sees
 * these fields: it still scores the redacted text, so blind scoring is unchanged.
 */
export interface CandidateProfile {
  name: string;
  email: string;
  phone: string;
  location: string;
  links: string[];
  skills: string[];
  keyPoints: string[];
  yearsExperience?: number;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /\+?\d[\d\s().-]{8,17}\d/g;
const URL_RE = /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in|github\.com)\/[A-Za-z0-9_\-./]+/gi;

const HEADINGS = new Set([
  'resume', 'curriculum vitae', 'cv', 'summary', 'profile', 'objective', 'career objective', 'contact', 'education',
  'experience', 'skills', 'projects', 'work experience', 'personal details', 'about me', 'technical skills',
]);

const SKILL_TERMS = [
  'JavaScript', 'TypeScript', 'React', 'React Native', 'Next.js', 'Vue', 'Angular', 'Svelte', 'Node.js', 'Express', 'NestJS',
  'HTML', 'CSS', 'Tailwind CSS', 'Sass', 'Redux', 'GraphQL', 'REST', 'Python', 'Django', 'Flask', 'FastAPI', 'Java',
  'Spring Boot', 'Kotlin', 'Swift', 'C++', 'C#', '.NET', 'Go', 'Rust', 'PHP', 'Laravel', 'Ruby', 'Rails', 'SQL', 'MySQL',
  'PostgreSQL', 'MongoDB', 'Redis', 'Firebase', 'Supabase', 'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform',
  'CI/CD', 'Jenkins', 'Git', 'GitHub', 'Linux', 'Figma', 'Jest', 'Cypress', 'Playwright', 'Testing', 'Accessibility',
  'Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch', 'Pandas', 'NumPy', 'Data Analysis', 'Power BI', 'Tableau',
  'Excel', 'Tally', 'SEO', 'Agile', 'Scrum', 'Jira', 'Communication', 'Leadership', 'Project Management', 'Sales',
  'Recruitment', 'Customer Support', 'Content Writing', 'Photoshop', 'Illustrator', 'Salesforce', 'SAP', 'Kafka',
];

const SKILL_RES: Array<[string, RegExp]> = SKILL_TERMS.map((t) => {
  const esc = t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return [t, new RegExp(`(?<![A-Za-z0-9+#])${esc}(?![A-Za-z0-9+#])`, 'i')];
});

const ACTION_RE = /\b(built|developed|designed|led|created|launched|improved|reduced|increased|managed|implemented|delivered|optimized|deployed|automated|achieved|won|ranked)\b/i;

function lines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}

function pickName(ls: string[]): string {
  for (const raw of ls.slice(0, 8)) {
    const l = raw.replace(/^(name\s*[:\-]\s*)/i, '').trim();
    if (EMAIL_RE.test(l) || /\d/.test(l) || /https?:|www\./i.test(l) || l.length > 40) continue;
    if (HEADINGS.has(l.toLowerCase())) continue;
    const words = l.split(/\s+/);
    if (words.length < 1 || words.length > 4) continue;
    if (!words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w))) continue;
    // Title-case ALL CAPS names so they read well in a list.
    const tidy = l === l.toUpperCase() ? words.map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ') : l;
    return tidy;
  }
  return '';
}

function pickLocation(ls: string[]): string {
  const labelled = ls.slice(0, 40).find((l) => /^(location|address|city|place)\s*[:\-]/i.test(l));
  if (labelled) return labelled.replace(/^[^:\-]+[:\-]\s*/, '').slice(0, 80);
  for (const l of ls.slice(0, 12)) {
    for (const part of l.split(/[|•·]/)) {
      const p = part.trim();
      if (EMAIL_RE.test(p) || /https?:|www\./i.test(p) || p.replace(/\D/g, '').length >= 8) continue;
      const m = /^([A-Z][A-Za-z .]{2,30}),\s*([A-Z][A-Za-z .]{2,30})(?:,\s*[A-Za-z .]{2,20})?$/.exec(p);
      if (m && !HEADINGS.has(p.toLowerCase())) return p;
    }
  }
  return '';
}

function pickPhone(text: string): string {
  const head = text.slice(0, 1500);
  const found = head.match(PHONE_RE) ?? text.match(PHONE_RE) ?? [];
  for (const f of found) {
    const digits = f.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 13) return f.trim();
  }
  return '';
}

function pickSkills(text: string): string[] {
  const out: string[] = [];
  for (const [term, re] of SKILL_RES) if (re.test(text)) out.push(term);
  // Terms listed under a "Skills" heading but missing from the dictionary.
  const m = /(?:^|\n)\s*(?:technical\s+)?skills\s*:?\s*\n?([^\n]*(?:\n(?!\s*(?:experience|education|projects|work|summary|certifications)\b)[^\n]*){0,4})/i.exec(text);
  if (m?.[1]) {
    for (const tok of m[1].split(/[,;•·|\n]/).map((t) => t.replace(/^[\s\-–:]+|[\s.]+$/g, '').trim())) {
      if (tok.length >= 2 && tok.length <= 28 && /^[A-Za-z0-9 .+#/&-]+$/.test(tok) && !out.some((o) => o.toLowerCase() === tok.toLowerCase())) out.push(tok);
    }
  }
  return out.slice(0, 16);
}

function pickKeyPoints(ls: string[]): string[] {
  const body = ls.filter((l) => l.length >= 35 && l.length <= 220 && !EMAIL_RE.test(l));
  const scored = body.map((l, idx) => ({
    l: l.replace(/^[•\-–*▪●]\s*/, ''),
    idx,
    s: (/\d/.test(l) ? 2 : 0) + (/%|\bk\b|\blakh|\bcrore|\bmillion|users|clients/i.test(l) ? 1 : 0) + (ACTION_RE.test(l) ? 2 : 0),
  }));
  return scored
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s || a.idx - b.idx)
    .slice(0, 5)
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.l);
}

function pickYears(text: string): number | undefined {
  const m = /(\d{1,2})(?:\.\d)?\s*\+?\s*(?:years?|yrs?)\b/i.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 50 ? n : undefined;
}

export function extractProfile(text: string, fileName: string): CandidateProfile {
  const ls = lines(text);
  const nameFromFile = fileName.replace(/\.(pdf|docx)$/i, '').replace(/[_-]+/g, ' ').replace(/\bresume\b|\bcv\b/gi, '').replace(/\s+/g, ' ').trim();
  const years = pickYears(text);
  return {
    name: pickName(ls) || nameFromFile,
    email: EMAIL_RE.exec(text)?.[0] ?? '',
    phone: pickPhone(text),
    location: pickLocation(ls),
    links: Array.from(new Set((text.match(URL_RE) ?? []).map((u) => u.trim()))).slice(0, 3),
    skills: pickSkills(text),
    keyPoints: pickKeyPoints(ls),
    ...(years !== undefined ? { yearsExperience: years } : {}),
  };
}
