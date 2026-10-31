import { DEMO_USER_EMAIL, DEMO_USER_NAME } from '../config/constants';
import { env } from '../config/env';
import { googleVerifier, type GoogleVerifier } from '../integrations/google/googleVerifier';
import { refreshTokenRepository } from '../repositories/refreshToken.repository';
import { userRepository } from '../repositories/user.repository';
import type { AuthUser } from '../types/auth.schema';
import type { Role } from '../types/enums';
import { auditService, type AuditService } from './audit.service';
import { otpService, type OtpService } from './otp.service';
import { createSession, revokeSession, type SessionTokens } from './session.service';
import { tryVerifyRefreshToken } from './token.service';
import { sha256Hex } from '../utils/crypto';
import { NotFoundError, UnauthenticatedError } from '../utils/errors';

export interface RequestContext {
  /** Keyed hash of the caller IP; the raw IP is never stored. */
  ipHash: string;
}

export interface LoginResult {
  user: AuthUser;
  session: SessionTokens;
}

export interface SessionInfo {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface AuthServiceDeps {
  otp: OtpService;
  audit: AuditService;
  interviewerEmails: readonly string[];
  /** DEMO_MODE flag. Injected so tests can flip it. */
  demoMode: boolean;
  google?: GoogleVerifier;
}

export function createAuthService(deps: AuthServiceDeps) {
  const roleFor = (email: string): Role => (deps.interviewerEmails.includes(email) ? 'interviewer' : 'hr_admin');
  const nameFor = (email: string): string => email.split('@')[0] ?? email;

  return {
    /** Always resolves the same way for any email (no account enumeration). */
    async sendOtp(email: string): Promise<void> {
      await deps.otp.send(email);
    },

    async verifyOtp(email: string, code: string, ctx: RequestContext): Promise<LoginResult> {
      await deps.otp.verify(email, code);
      const user = await userRepository.upsertOnLogin({ email, name: nameFor(email), role: roleFor(email) });
      await deps.audit.append({
        actor: { id: user.id, role: user.role, name: user.name },
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        payload: { method: 'otp', ipHash: ctx.ipHash },
      });
      const session = await createSession(user);
      return { user, session };
    },

    /** Google sign-in: verify the ID token, link by email (or create), same session + audit as OTP. */
    async googleLogin(idToken: string, ctx: RequestContext): Promise<LoginResult> {
      if (!deps.google) throw new UnauthenticatedError('Google sign-in is not available.');
      const identity = await deps.google.verify(idToken);
      const user = await userRepository.upsertFromGoogle({
        email: identity.email,
        name: identity.name,
        googleSub: identity.sub,
        role: roleFor(identity.email),
      });
      if (!user) throw new UnauthenticatedError('This email is already linked to a different Google account.');
      await deps.audit.append({
        actor: { id: user.id, role: user.role, name: user.name },
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        payload: { method: 'google', ipHash: ctx.ipHash },
      });
      const session = await createSession(user);
      return { user, session };
    },

    /** One-click judge login. 404 (not 403) when DEMO_MODE is off so the route looks absent. Every use is audited. */
    async demoLogin(ctx: RequestContext): Promise<LoginResult> {
      if (!deps.demoMode) throw new NotFoundError();
      const user = await userRepository.upsertOnLogin({
        email: DEMO_USER_EMAIL,
        name: DEMO_USER_NAME,
        role: 'demo_hr',
        isDemo: true,
      });
      await deps.audit.append({
        actor: { id: user.id, role: user.role, name: user.name },
        action: 'demo.login',
        entityType: 'user',
        entityId: user.id,
        payload: { ipHash: ctx.ipHash },
      });
      const session = await createSession(user);
      return { user, session };
    },

    /**
     * Refresh with rotation. Every call issues a NEW refresh token in the same family and marks the old one replaced.
     * Presenting an already-replaced (or revoked) token = reuse: revoke the whole family and all the user's sessions.
     */
    async refresh(refreshToken: string | undefined, ctx?: RequestContext, deviceLabel?: string): Promise<LoginResult> {
      const fail = (): never => {
        throw new UnauthenticatedError('Your session has expired. Please sign in again.');
      };
      if (!refreshToken) return fail();
      const claims = tryVerifyRefreshToken(refreshToken);
      if (!claims) return fail();
      const oldHash = sha256Hex(refreshToken);
      const record = await refreshTokenRepository.findByHash(oldHash);
      if (!record) return fail();
      if (record.userId.toString() !== claims.sub) return fail();
      if (record.expiresAt.getTime() <= Date.now()) return fail();

      const user = await userRepository.findById(claims.sub);
      if (!user) return fail();

      const reuse = async (): Promise<never> => {
        await refreshTokenRepository.revokeFamily(record.family);
        await refreshTokenRepository.revokeAllForUser(user.id);
        await deps.audit.append({
          actor: { id: user.id, role: user.role, name: user.name },
          action: 'auth.refresh_reuse_detected',
          entityType: 'user',
          entityId: user.id,
          payload: { family: record.family, ...(ctx ? { ipHash: ctx.ipHash } : {}) },
        });
        return fail();
      };

      if (record.replacedBy || record.revokedAt) return reuse();

      const session = await createSession(user, record.family, deviceLabel ?? record.deviceLabel);
      const claimed = await refreshTokenRepository.markReplaced(oldHash, sha256Hex(session.refreshToken));
      if (!claimed) {
        // Lost a race with another use of the same token: treat as reuse and kill the new token too.
        return reuse();
      }
      return { user, session };
    },

    /** Active sessions for Settings (device label, createdAt, lastUsedAt). `current` marks the presenting cookie. */
    async listSessions(userId: string, currentRefreshToken?: string): Promise<SessionInfo[]> {
      const rows = await refreshTokenRepository.listActiveForUser(userId);
      const currentHash = currentRefreshToken ? sha256Hex(currentRefreshToken) : undefined;
      return rows.map((r) => ({
        id: r._id.toString(),
        deviceLabel: r.deviceLabel ?? 'Unknown device',
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: (r.lastUsedAt ?? r.createdAt).toISOString(),
        current: currentHash !== undefined && r.tokenHash === currentHash,
      }));
    },

    async logout(actor: AuthUser | null, refreshToken: string | undefined, ctx: RequestContext): Promise<void> {
      await revokeSession(refreshToken);
      if (actor) {
        await deps.audit.append({
          actor: { id: actor.id, role: actor.role, name: actor.name },
          action: 'auth.logout',
          entityType: 'user',
          entityId: actor.id,
          payload: { ipHash: ctx.ipHash },
        });
      }
    },
  };
}

export const authService = createAuthService({
  otp: otpService,
  audit: auditService,
  interviewerEmails: env.INTERVIEWER_EMAILS,
  demoMode: env.DEMO_MODE,
  google: googleVerifier,
});
export type AuthService = typeof authService;
