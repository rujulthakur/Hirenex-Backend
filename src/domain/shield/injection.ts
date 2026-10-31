/**
 * PURE. Injection phrase scanner. It FLAGS, it never rejects, and it never changes the text
 * (the only exception is neutralizeControlChars, which strips invisible obfuscation characters).
 */
export type Severity = 'low' | 'medium' | 'high';

export interface InjectionFinding {
  rule: string;
  severity: Severity;
  start: number;
  end: number;
  match: string;
}

interface Rule {
  rule: string;
  severity: Severity;
  re: RegExp;
}

const RULES: readonly Rule[] = [
  { rule: 'ignore_previous', severity: 'high', re: /\b(ignore|forget|disregard|override)\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier|preceding)\s+(instructions?|prompts?|rules?|context)/gi },
  { rule: 'you_are_now', severity: 'high', re: /\byou\s+are\s+now\s+(a|an|the|in|my)\b/gi },
  { rule: 'system_prompt', severity: 'medium', re: /\b(system\s+prompt|developer\s+message|hidden\s+instructions?)\b/gi },
  { rule: 'disregard_rubric', severity: 'high', re: /\b(disregard|ignore|skip|bypass)\s+(the\s+|this\s+)?(rubric|criteria|scoring|evaluation|guidelines?)/gi },
  { rule: 'perfect_score', severity: 'high', re: /\b(give|award|assign|rate|score)\s+(this\s+|the\s+)?(candidate|applicant|resume|cv|me)\b[^.\n]{0,40}\b(100\s*\/\s*100|10\s*\/\s*10|full\s+marks|perfect\s+score|maximum\s+score|highest\s+score)/gi },
  { rule: 'score_100', severity: 'high', re: /\b100\s*\/\s*100\b/g },
  { rule: 'score_10_of_10', severity: 'high', re: /\b(score|rate|rating)\s*(of\s*|:?\s*)?(10\s*(out\s+of|\/)\s*10)\b|\b10\s+out\s+of\s+10\b/gi },
  { rule: 'do_not_flag', severity: 'high', re: /\b(do\s+not|don'?t|never)\s+(flag|report|reject|penali[sz]e|verify|check)\b/gi },
  { rule: 'mark_verified', severity: 'high', re: /\bmark\s+(this\s+|all\s+|every\s+)?(\w+\s+)?(as\s+)?(verified|valid|true|qualified)\b/gi },
  { rule: 'output_json', severity: 'medium', re: /\b(output|respond|reply|return)\s+(only\s+|with\s+)?(valid\s+)?json\b/gi },
  { rule: 'role_tag', severity: 'high', re: /(<\|?\s*(system|assistant|user|im_start|im_end)\s*\|?>|\[\/?(INST|SYS)\]|^\s*(system|assistant)\s*:)/gim },
  { rule: 'recommend_hire', severity: 'medium', re: /\b(hire|select|shortlist|rank)\s+(this\s+candidate|me)\s+(first|immediately|at\s+once|no\s+matter)/gi },
  { rule: 'base64_blob', severity: 'medium', re: /(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{80,}={0,2}(?![A-Za-z0-9+/=])/g },
];

/** Zero-width, bidi controls and other invisible format characters used for obfuscation. */
const CONTROL_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD\u180E]/g;

/** Latin text containing Cyrillic or Greek letters inside a single word = homoglyph abuse. */
const HOMOGLYPH_WORD_RE = /\b(?=\w*[A-Za-z])(?=\w*[\u0370-\u03FF\u0400-\u04FF])[\w\u0370-\u03FF\u0400-\u04FF]{3,}\b/g;

const SEVERITY_ORDER: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

export function neutralizeControlChars(text: string): string {
  return text.replace(CONTROL_RE, '');
}

function collect(text: string, rule: Rule): InjectionFinding[] {
  const out: InjectionFinding[] = [];
  const re = new RegExp(rule.re.source, rule.re.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    out.push({ rule: rule.rule, severity: rule.severity, start: m.index, end: m.index + m[0].length, match: m[0].slice(0, 200) });
  }
  return out;
}

/** Scans the text AFTER stripping control characters (so zero-width splits cannot hide a phrase). */
export function scanInjection(input: string): { findings: InjectionFinding[]; count: number; maxSeverity: Severity | null } {
  const findings: InjectionFinding[] = [];

  const controls = input.match(CONTROL_RE);
  if (controls && controls.length >= 3) {
    findings.push({ rule: 'control_chars', severity: 'medium', start: 0, end: 0, match: `${controls.length} invisible characters` });
  }

  const text = neutralizeControlChars(input);
  for (const rule of RULES) findings.push(...collect(text, rule));

  const homoglyphs = text.match(HOMOGLYPH_WORD_RE);
  if (homoglyphs && homoglyphs.length > 0) {
    findings.push({ rule: 'homoglyph_abuse', severity: 'medium', start: 0, end: 0, match: homoglyphs.slice(0, 3).join(', ') });
  }

  findings.sort((a, b) => a.start - b.start || a.rule.localeCompare(b.rule));
  const maxSeverity = findings.reduce<Severity | null>(
    (acc, f) => (acc === null || SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[acc] ? f.severity : acc),
    null,
  );
  return { findings, count: findings.length, maxSeverity };
}
