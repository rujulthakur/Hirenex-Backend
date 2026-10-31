import { refreshTokenRepository } from '../repositories/refreshToken.repository';
import type { AuthUser } from '../types/auth.schema';
import { sha256Hex } from '../utils/crypto';
import { issueRefreshToken, signAccessToken } from './token.service';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

/** Issues an access JWT plus a refresh JWT whose SHA-256 hash is stored in refreshTokens. */
export async function createSession(user: AuthUser, family?: string, deviceLabel?: string): Promise<SessionTokens> {
  const refresh = issueRefreshToken(user.id, family);
  await refreshTokenRepository.create({
    userId: user.id,
    tokenHash: sha256Hex(refresh.token),
    family: refresh.family,
    expiresAt: refresh.expiresAt,
    ...(deviceLabel ? { deviceLabel } : {}),
  });
  return { accessToken: signAccessToken(user), refreshToken: refresh.token };
}

/** Short, human label from a User-Agent header (never stored raw). */
export function deviceLabelFromUserAgent(ua: string | undefined): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return `${browser} on ${os}`;
}

/** Logout: revoke the presented refresh token (if any). Safe to call with garbage. */
export async function revokeSession(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  await refreshTokenRepository.revokeByHash(sha256Hex(refreshToken));
}
