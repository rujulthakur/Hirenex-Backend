import { detectNameTokens, redact } from './redaction';
import { hashText, normalizeText } from './text';

/**
 * PURE. Fairness swap test. Replaces the candidate's name and gender words in the ORIGINAL text with a fixed
 * neutral mapping, runs the SAME redaction, and compares hashes of both redacted texts. Identical hashes show the
 * identity fields never reach the scorer. It does NOT prove all bias is removed (see SWAP_LIMIT_NOTE).
 */
export const SWAP_LIMIT_NOTE = 'This shows identity fields do not reach the scorer; it does not prove all bias is removed.';
export const NEUTRAL_NAME = 'Alex Morgan';
export const NEUTRAL_FILE_NAME = 'candidate_resume.pdf';

/** Fixed mapping (lower-case key). Case of the first letter is preserved when applied. */
export const GENDER_SWAP: Readonly<Record<string, string>> = {
  he: 'they',
  she: 'they',
  his: 'their',
  her: 'their',
  hers: 'theirs',
  him: 'them',
  himself: 'themself',
  herself: 'themself',
  mr: '',
  mrs: '',
  ms: '',
  miss: '',
  mx: '',
  male: 'person',
  female: 'person',
  man: 'person',
  woman: 'person',
  husband: 'spouse',
  wife: 'spouse',
  gentleman: 'person',
  lady: 'person',
};

const GENDER_RE = new RegExp(`\\b(${Object.keys(GENDER_SWAP).join('|')})\\b\\.?`, 'gi');
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matchCase(from: string, to: string): string {
  if (!to) return to;
  return from[0] && from[0] === from[0].toUpperCase() && from[0] !== from[0].toLowerCase() ? to.charAt(0).toUpperCase() + to.slice(1) : to;
}

export interface SwapResult {
  swappedText: string;
  swappedFileName: string;
  nameTokens: string[];
  genderWordsSwapped: number;
}

export function swapIdentity(original: string, fileName: string): SwapResult {
  const nameTokens = detectNameTokens(original, fileName);
  let text = original;
  const first = text.split('\n').findIndex((l) => l.trim().length > 0);
  // The header name line becomes the neutral name; other mentions of the name tokens are replaced too.
  if (first >= 0 && nameTokens.length > 0) {
    const lines = text.split('\n');
    const words = (lines[first] ?? '').trim().split(/\s+/);
    if (words.some((w) => nameTokens.includes(w))) lines[first] = NEUTRAL_NAME;
    text = lines.join('\n');
  }
  for (const t of nameTokens) text = text.replace(new RegExp(`\\b${escapeRe(t)}\\b`, 'g'), NEUTRAL_NAME.split(' ')[0] as string);
  let count = 0;
  text = text.replace(GENDER_RE, (m) => {
    count += 1;
    const key = m.replace(/\.$/, '').toLowerCase();
    return matchCase(m, GENDER_SWAP[key] ?? m);
  });
  return { swappedText: text, swappedFileName: NEUTRAL_FILE_NAME, nameTokens, genderWordsSwapped: count };
}

export function redactedHash(text: string, fileName: string): string {
  return hashText(normalizeText(redact(text, fileName).redactedText));
}

export interface SwapComparison {
  redactedIdentical: boolean;
  originalHash: string;
  swappedHash: string;
  swappedText: string;
}

/** Redacts both versions the same way and compares hashes. */
export function compareRedactions(original: string, fileName: string): SwapComparison {
  const swap = swapIdentity(original, fileName);
  const originalHash = redactedHash(original, fileName);
  const swappedHash = redactedHash(swap.swappedText, swap.swappedFileName);
  return { redactedIdentical: originalHash === swappedHash, originalHash, swappedHash, swappedText: swap.swappedText };
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;
/** Honest delta: swapped minus original, rounded to 2 places. Never forced to zero. */
export const scoreDelta = (original: number, swapped: number): number => round2(swapped - original);
