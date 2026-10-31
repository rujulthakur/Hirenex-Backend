import { createHash } from 'node:crypto';

/** Minimum extracted characters for a resume to be scored. Below this we flag "unreadable_scan". */
export const MIN_READABLE_CHARS = 200;

/**
 * PURE. Normalises extracted text: NFKC, strips NUL, unifies line endings, collapses runs of spaces/tabs
 * and blank lines (keeps single line breaks so headers and bullets stay readable).
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** PURE. SHA-256 hex of the normalised text; used for the (jobId, textHash) duplicate guard. */
export function hashText(normalized: string): string {
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/** PURE. True when the text is too short to be a real text resume (e.g. an image-only scan). */
export function isUnreadable(normalized: string): boolean {
  return normalized.length < MIN_READABLE_CHARS;
}
