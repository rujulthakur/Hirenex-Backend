import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { ACCESS_TTL_SECONDS, JWT_ISSUER, REFRESH_TTL_SECONDS } from '../config/constants';
import { env } from '../config/env';
import {
  accessClaimsSchema,
  refreshClaimsSchema,
  type AccessClaims,
  type AuthUser,
  type RefreshClaims,
} from '../types/auth.schema';
import { UnauthenticatedError } from '../utils/errors';

const ALGORITHM = 'HS256' as const;
const ACCESS_AUDIENCE = 'access';
const REFRESH_AUDIENCE = 'refresh';

export function signAccessToken(user: AuthUser): string {
  return jwt.sign({ role: user.role }, env.JWT_ACCESS_SECRET, {
    algorithm: ALGORITHM,
    subject: user.id,
    issuer: JWT_ISSUER,
    audience: ACCESS_AUDIENCE,
    expiresIn: ACCESS_TTL_SECONDS,
  });
}

/** Returns validated claims or null (bad signature, expired, wrong audience, wrong shape). */
export function tryVerifyAccessToken(token: string): AccessClaims | null {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: [ALGORITHM],
      issuer: JWT_ISSUER,
      audience: ACCESS_AUDIENCE,
    });
    const parsed = accessClaimsSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function verifyAccessToken(token: string): AccessClaims {
  const claims = tryVerifyAccessToken(token);
  if (!claims) throw new UnauthenticatedError('Your session has expired. Please sign in again.');
  return claims;
}

export interface IssuedRefreshToken {
  token: string;
  family: string;
  expiresAt: Date;
}

/** Refresh token = signed JWT carrying the rotation family and a unique jti. Only its SHA-256 is stored. */
export function issueRefreshToken(userId: string, family: string = randomUUID()): IssuedRefreshToken {
  const token = jwt.sign({ fam: family }, env.JWT_REFRESH_SECRET, {
    algorithm: ALGORITHM,
    subject: userId,
    issuer: JWT_ISSUER,
    audience: REFRESH_AUDIENCE,
    expiresIn: REFRESH_TTL_SECONDS,
    jwtid: randomUUID(),
  });
  return { token, family, expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000) };
}

export function tryVerifyRefreshToken(token: string): RefreshClaims | null {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      algorithms: [ALGORITHM],
      issuer: JWT_ISSUER,
      audience: REFRESH_AUDIENCE,
    });
    const parsed = refreshClaimsSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
