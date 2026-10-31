import { createHash, randomBytes } from 'node:crypto';

/**
 * PURE (plus a CSPRNG call). Portal tokens: 32 random bytes as base64url. Only the SHA-256 hash is stored, so a
 * database leak cannot be turned into working links. Expiry is the EARLIER of 7 days or the interview start.
 */
export const TOKEN_BYTES = 32;
export const TOKEN_MAX_AGE_MS = 7 * 86_400_000;

export interface MintedToken {
  raw: string;
  hash: string;
  expiresAt: Date;
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function computeExpiry(nowMs: number, interviewStartMs: number): Date {
  return new Date(Math.min(nowMs + TOKEN_MAX_AGE_MS, interviewStartMs));
}

export function mintToken(nowMs: number, interviewStartMs: number): MintedToken {
  const raw = randomBytes(TOKEN_BYTES).toString('base64url');
  return { raw, hash: hashToken(raw), expiresAt: computeExpiry(nowMs, interviewStartMs) };
}

export function isExpired(expiresAt: Date, nowMs: number): boolean {
  return expiresAt.getTime() <= nowMs;
}

/** Link placed in emails: PORTAL_BASE_URL/c/:token (no trailing slash issues). */
export function portalLink(baseUrl: string, raw: string, action?: 'accept' | 'decline' | 'reschedule'): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/c/${raw}${action ? `?action=${action}` : ''}`;
}
