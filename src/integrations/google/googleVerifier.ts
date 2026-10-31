import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env';
import { AppError, UnauthenticatedError } from '../../utils/errors';

/** What we trust from a verified Google ID token. */
export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}

/** Port so tests can mock the verifier (no network in tests). */
export interface GoogleVerifier {
  verify(idToken: string): Promise<GoogleIdentity>;
}

export interface GoogleClaims {
  iss?: string;
  aud?: string;
  exp?: number;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

const ALLOWED_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const REJECT_MESSAGE = 'Google sign-in could not be verified. Try again or use an email code.';

/**
 * PURE. The library already checks signature, audience and expiry; we re-check audience, issuer, expiry and
 * email_verified explicitly so the rules are visible, testable and do not depend on library defaults.
 */
export function validateGoogleClaims(claims: GoogleClaims, clientId: string, nowSeconds: number): GoogleIdentity {
  if (claims.aud !== clientId) throw new UnauthenticatedError(REJECT_MESSAGE);
  if (!claims.iss || !ALLOWED_ISSUERS.includes(claims.iss)) throw new UnauthenticatedError(REJECT_MESSAGE);
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) throw new UnauthenticatedError(REJECT_MESSAGE);
  if (claims.email_verified !== true) throw new UnauthenticatedError('Your Google email address is not verified.');
  if (!claims.sub || !claims.email) throw new UnauthenticatedError(REJECT_MESSAGE);
  const email = claims.email.trim().toLowerCase();
  return { sub: claims.sub, email, name: (claims.name ?? email.split('@')[0] ?? email).trim() };
}

export class GoogleAuthLibraryVerifier implements GoogleVerifier {
  private readonly client = new OAuth2Client();

  async verify(idToken: string): Promise<GoogleIdentity> {
    const clientId = env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new AppError('INTERNAL', 'Google sign-in is not configured on this server.', [], 503);
    }
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: clientId });
      return validateGoogleClaims((ticket.getPayload() ?? {}) as GoogleClaims, clientId, Math.floor(Date.now() / 1000));
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new UnauthenticatedError(REJECT_MESSAGE);
    }
  }
}

export const googleVerifier: GoogleVerifier = new GoogleAuthLibraryVerifier();
