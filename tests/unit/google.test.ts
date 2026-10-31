import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateGoogleClaims, type GoogleClaims } from '../../src/integrations/google/googleVerifier';

const { upsertOnLogin, upsertFromGoogle, createSession } = vi.hoisted(() => ({
  upsertOnLogin: vi.fn(),
  upsertFromGoogle: vi.fn(),
  createSession: vi.fn(),
}));
vi.mock('../../src/repositories/user.repository', () => ({ userRepository: { upsertOnLogin, upsertFromGoogle, findById: vi.fn() } }));
vi.mock('../../src/repositories/refreshToken.repository', () => ({ refreshTokenRepository: { findByHash: vi.fn() } }));
vi.mock('../../src/services/session.service', () => ({ createSession, revokeSession: vi.fn() }));

import { createAuthService } from '../../src/services/auth.service';
import { createOtpService } from '../../src/services/otp.service';
import { FakeMailer, MemoryOtpStore } from '../helpers/memoryOtp';
import { UnauthenticatedError } from '../../src/utils/errors';

const CLIENT = 'client-123.apps.googleusercontent.com';
const NOW = 1_800_000_000;
const good: GoogleClaims = {
  iss: 'https://accounts.google.com',
  aud: CLIENT,
  exp: NOW + 600,
  sub: 'g-sub-1',
  email: 'HR@Example.com',
  email_verified: true,
  name: 'Hira R',
};

describe('validateGoogleClaims', () => {
  it('accepts a valid token and lowercases the email', () => {
    expect(validateGoogleClaims(good, CLIENT, NOW)).toEqual({ sub: 'g-sub-1', email: 'hr@example.com', name: 'Hira R' });
  });
  it('rejects the wrong audience', () => {
    expect(() => validateGoogleClaims({ ...good, aud: 'other-client' }, CLIENT, NOW)).toThrow(UnauthenticatedError);
  });
  it('rejects a bad issuer', () => {
    expect(() => validateGoogleClaims({ ...good, iss: 'https://evil.test' }, CLIENT, NOW)).toThrow(UnauthenticatedError);
    expect(validateGoogleClaims({ ...good, iss: 'accounts.google.com' }, CLIENT, NOW).sub).toBe('g-sub-1');
  });
  it('rejects an expired token', () => {
    expect(() => validateGoogleClaims({ ...good, exp: NOW - 1 }, CLIENT, NOW)).toThrow(UnauthenticatedError);
  });
  it('requires email_verified', () => {
    expect(() => validateGoogleClaims({ ...good, email_verified: false }, CLIENT, NOW)).toThrow(UnauthenticatedError);
    expect(() => validateGoogleClaims({ ...good, email_verified: undefined }, CLIENT, NOW)).toThrow(UnauthenticatedError);
  });
  it('requires sub and email', () => {
    expect(() => validateGoogleClaims({ ...good, sub: undefined }, CLIENT, NOW)).toThrow(UnauthenticatedError);
    expect(() => validateGoogleClaims({ ...good, email: undefined }, CLIENT, NOW)).toThrow(UnauthenticatedError);
  });
});

const USER = { id: 'a'.repeat(24), email: 'hr@example.com', name: 'Hira R', role: 'hr_admin' as const, isDemo: false };
const audit = { append: vi.fn().mockResolvedValue({ seq: 1, hash: 'h' }) };

function build(verify: () => Promise<{ sub: string; email: string; name: string }>) {
  const otp = createOtpService({ store: new MemoryOtpStore(), mailer: new FakeMailer(), pepper: 'p' });
  return createAuthService({ otp, audit, interviewerEmails: ['iv@example.com'], demoMode: false, google: { verify } });
}

beforeEach(() => {
  vi.clearAllMocks();
  upsertFromGoogle.mockResolvedValue(USER);
  createSession.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' });
});

describe('authService.googleLogin', () => {
  it('links by email, audits method=google and issues a session', async () => {
    const svc = build(async () => ({ sub: 's1', email: 'hr@example.com', name: 'Hira R' }));
    const out = await svc.googleLogin('x'.repeat(30), { ipHash: 'ip' });
    expect(upsertFromGoogle).toHaveBeenCalledWith({ email: 'hr@example.com', name: 'Hira R', googleSub: 's1', role: 'hr_admin' });
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login', payload: { method: 'google', ipHash: 'ip' } }));
    expect(out.session.accessToken).toBe('at');
  });
  it('gives allow-listed emails the interviewer role', async () => {
    const svc = build(async () => ({ sub: 's2', email: 'iv@example.com', name: 'Iv' }));
    await svc.googleLogin('x'.repeat(30), { ipHash: 'ip' });
    expect(upsertFromGoogle).toHaveBeenCalledWith(expect.objectContaining({ role: 'interviewer' }));
  });
  it('propagates a verifier rejection (e.g. wrong audience) without creating a user or session', async () => {
    const svc = build(async () => {
      throw new UnauthenticatedError('bad');
    });
    await expect(svc.googleLogin('x'.repeat(30), { ipHash: 'ip' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(upsertFromGoogle).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });
  it('refuses when the email is already linked to a different Google account', async () => {
    upsertFromGoogle.mockResolvedValue(null);
    const svc = build(async () => ({ sub: 's3', email: 'hr@example.com', name: 'x' }));
    await expect(svc.googleLogin('x'.repeat(30), { ipHash: 'ip' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(createSession).not.toHaveBeenCalled();
  });
});
