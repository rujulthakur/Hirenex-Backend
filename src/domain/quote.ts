/**
 * PURE. Evidence-receipt verification. The LLM proposes a quote; this code decides whether it is real.
 *
 * A quote is VERIFIED only when, after normalisation (NFKC, lowercase, unified quotes and dashes,
 * bullets and zero-width characters removed, whitespace collapsed), it:
 *   1. is at least MIN_QUOTE_CHARS long,
 *   2. is not just a redaction placeholder,
 *   3. does not merely repeat the criterion name or text from the job description, and
 *   4. is a substring of the REDACTED resume text the model saw.
 * The match is mapped back to start/end offsets in the stored redacted text so the UI can highlight it.
 */
export const MIN_QUOTE_CHARS = 12;

export interface QuoteLocation {
  start: number;
  end: number;
}

export type QuoteFailure = 'too_short' | 'placeholder_only' | 'repeats_criterion' | 'repeats_job_text' | 'not_found';

export interface QuoteCheck {
  verified: boolean;
  location: QuoteLocation | null;
  reason?: QuoteFailure;
}

export interface QuoteContext {
  criterionName?: string;
  /** Job description plus criterion descriptions. A quote contained in this text proves nothing about the candidate. */
  jobText?: string;
}

interface Normalized {
  text: string;
  /** For each normalized char: index of its source code point in the original string. */
  starts: number[];
  /** For each normalized char: exclusive end index of its source code point. */
  ends: number[];
}

const QUOTES: Record<string, string> = { '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'", '\u2032': "'", '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u201F': '"', '\u2033': '"', '`': "'" };
const DASHES = /[\u2010-\u2015\u2212]/;
const BULLETS = /[\u2022\u2023\u25E6\u25AA\u25AB\u25CF\u2219\u00B7\u25A0\u25A1]/;
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD\u180E]/;
const SPACE = /\s/;

export function normalizeWithMap(input: string): Normalized {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let idx = 0;
  for (const cp of input) {
    const start = idx;
    const end = idx + cp.length;
    idx = end;
    for (const raw of cp.normalize('NFKC').toLowerCase()) {
      let c = raw;
      if (INVISIBLE.test(c)) continue;
      if (QUOTES[c] !== undefined) c = QUOTES[c]!;
      else if (DASHES.test(c)) c = '-';
      else if (BULLETS.test(c) || SPACE.test(c)) c = ' ';
      if (c === ' ' && (chars.length === 0 || chars[chars.length - 1] === ' ')) continue;
      chars.push(c);
      starts.push(start);
      ends.push(end);
    }
  }
  while (chars.length > 0 && chars[chars.length - 1] === ' ') {
    chars.pop();
    starts.pop();
    ends.pop();
  }
  return { text: chars.join(''), starts, ends };
}

export function normalizeQuote(input: string): string {
  return normalizeWithMap(input).text;
}

const PLACEHOLDER = /\[[A-Z][A-Z ]*\]/g;

export function verifyQuote(quote: string, redactedText: string, ctx: QuoteContext = {}): QuoteCheck {
  const q = normalizeQuote(quote);
  if (q.length < MIN_QUOTE_CHARS) return { verified: false, location: null, reason: 'too_short' };
  if (quote.replace(PLACEHOLDER, '').trim().length < MIN_QUOTE_CHARS) return { verified: false, location: null, reason: 'placeholder_only' };

  if (ctx.criterionName) {
    const name = normalizeQuote(ctx.criterionName);
    if (name.length > 0 && (q === name || name.includes(q))) return { verified: false, location: null, reason: 'repeats_criterion' };
  }
  if (ctx.jobText && normalizeQuote(ctx.jobText).includes(q)) return { verified: false, location: null, reason: 'repeats_job_text' };

  const hay = normalizeWithMap(redactedText);
  const at = hay.text.indexOf(q);
  if (at < 0) return { verified: false, location: null, reason: 'not_found' };
  const last = at + q.length - 1;
  return { verified: true, location: { start: hay.starts[at]!, end: hay.ends[last]! } };
}
