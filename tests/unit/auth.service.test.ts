import { beforeEach, describe, expect, it, vi } from 'vitest';

const { upsertOnLogin, findById, findByHash, createSession, markReplaced, revokeFamily, revokeAllForUser, listActiveForUser } = vi.hoisted(() => ({
  upsertOnLogin: vi.fn(),
  findById: vi.fn(),
  findByHash: vi.fn(),
  createSession: vi.fn(),
  markReplaced: vi.fn(),
  revokeFamily: vi.fn(),
  revokeAllForUser: vi.fn(),
  listActiveForUser: vi.fn(),
}));

vi.mock('../../src/repositories/user.repository', () => ({ userRepository: { upsertOnLogin, findById } }));
vi.mock('../../src/repositories/refreshToken.repository', () => ({ refreshTokenRepository: { findByHash, markReplaced, revokeFamily, revokeAllForUser, listActiveForUser } }));
vi.mock('../../src/services/session.service', () => ({ createSession, revokeSession: vi.fn() }));

import { createAuthService } from '../../src/services/auth.service';
import { issueRefreshToken } from '../../src/services/token.service';
import { sha256Hex } from '../../src/utils/crypto';
import { FakeMailer, MemoryOtpStore } from '../helpers/memoryOtp';
import { createOtpService } from '../../src/services/otp.service';

const USER = { id: 'a'.repeat(24), email: 'demo.judge@x.test', name: 'Judge (demo)', role: 'demo_hr' as const, isDemo: true };
const audit = { append: vi.fn().mockResolvedValue({ seq: 1, hash: 'h' }) };

function build(demoMode: boolean) {
  const mailer = new FakeMailer();
  const otp = createOtpService({ store: new MemoryOtpStore(), mailer, pepper: 'p' });
  return { mailer, svc: createAuthService({ otp, audit, interviewerEmails: ['iv@example.com'], demoMode }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  upsertOnLogin.mockResolvedValue(USER);
  createSession.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' });
});

describe('demo-login gating', () => {
  it('is NOT_FOUND when DEMO_MODE is off and touches nothing', async () => {
    await expect(build(false).svc.demoLogin({ ipHash: 'ip' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(upsertOnLogin).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });
  it('signs in the seeded demo_hr user and audits EVERY use with the ip hash', async () => {
    const svc = build(true).svc;
    await svc.demoLogin({ ipHash: 'ip1' });
    await svc.demoLogin({ ipHash: 'ip2' });
    expect(upsertOnLogin).toHaveBeenCalledWith(expect.objectContaining({ role: 'demo_hr', isDemo: true }));
    expect(audit.append).toHaveBeenCalledTimes(2);
    expect(audit.append.mock.calls[0]?.[0]).toMatchObject({ action: 'demo.login', payload: { ipHash: 'ip1' } });
  });
});

describe('verifyOtp role assignment and audit', () => {
  it('logs in, audits auth.login and defaults to hr_admin; allow-listed email becomes interviewer', async () => {
    const { svc, mailer } = build(false);
    upsertOnLogin.mockImplementation(async (i: { email: string; role: string }) => ({ ...USER, email: i.email, role: i.role }));
    await svc.sendOtp('hr@example.com');
    await svc.verifyOtp('hr@example.com', mailer.last(), { ipHash: 'ip' });
    expect(upsertOnLogin).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'hr_admin' }));
    await svc.sendOtp('iv@example.com');
    await svc.verifyOtp('iv@example.com', mailer.last(), { ipHash: 'ip' });
    expect(upsertOnLogin).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'interviewer' }));
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login' }));
  });
  it('sendOtp resolves identically for known and unknown emails (enumeration safety)', async () => {
    const { svc } = build(false);
    await expect(svc.sendOtp('known@example.com')).resolves.toBeUndefined();
    await expect(svc.sendOtp('unknown@example.com')).resolves.toBeUndefined();
  });
});

const live = (issued: { expiresAt: Date }, extra: object = {}) => ({
  userId: { toString: () => USER.id },
  expiresAt: issued.expiresAt,
  family: 'family-0001',
  ...extra,
});

describe('refresh rotation', () => {
  it('rejects a missing or garbage token', async () => {
    const { svc } = build(true);
    await expect(svc.refresh(undefined)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(svc.refresh('not.a.jwt')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('issues a NEW session in the same family and marks the old token replaced', async () => {
    const { svc } = build(true);
    const issued = issueRefreshToken(USER.id, 'family-0001');
    findByHash.mockResolvedValue(live(issued));
    findById.mockResolvedValue(USER);
    markReplaced.mockResolvedValue(true);
    createSession.mockResolvedValue({ accessToken: 'at2', refreshToken: 'rt2' });
    const out = await svc.refresh(issued.token);
    expect(findByHash).toHaveBeenCalledWith(sha256Hex(issued.token));
    expect(createSession).toHaveBeenCalledWith(USER, 'family-0001', undefined);
    expect(markReplaced).toHaveBeenCalledWith(sha256Hex(issued.token), sha256Hex('rt2'));
    expect(out.session.refreshToken).toBe('rt2');
    expect(out.user.id).toBe(USER.id);
    expect(revokeFamily).not.toHaveBeenCalled();
  });

  it('rotation chain: each rotation replaces the previous token', async () => {
    const { svc } = build(true);
    findById.mockResolvedValue(USER);
    markReplaced.mockResolvedValue(true);
    const t1 = issueRefreshToken(USER.id, 'family-0001');
    findByHash.mockResolvedValue(live(t1));
    createSession.mockResolvedValueOnce({ accessToken: 'a2', refreshToken: 'rt2' });
    await svc.refresh(t1.token);
    const t2 = issueRefreshToken(USER.id, 'family-0001');
    findByHash.mockResolvedValue(live(t2));
    createSession.mockResolvedValueOnce({ accessToken: 'a3', refreshToken: 'rt3' });
    await svc.refresh(t2.token);
    expect(markReplaced).toHaveBeenNthCalledWith(1, sha256Hex(t1.token), sha256Hex('rt2'));
    expect(markReplaced).toHaveBeenNthCalledWith(2, sha256Hex(t2.token), sha256Hex('rt3'));
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  it('REUSE of an already-replaced token revokes the family and all sessions, and audits', async () => {
    const { svc } = build(true);
    const old = issueRefreshToken(USER.id, 'family-0001');
    findByHash.mockResolvedValue(live(old, { replacedBy: 'x'.repeat(64) }));
    findById.mockResolvedValue(USER);
    await expect(svc.refresh(old.token, { ipHash: 'iphash' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(revokeFamily).toHaveBeenCalledWith('family-0001');
    expect(revokeAllForUser).toHaveBeenCalledWith(USER.id);
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.refresh_reuse_detected' }));
    expect(createSession).not.toHaveBeenCalled();
  });

  it('a lost race (markReplaced false) is treated as reuse', async () => {
    const { svc } = build(true);
    const issued = issueRefreshToken(USER.id, 'family-0001');
    findByHash.mockResolvedValue(live(issued));
    findById.mockResolvedValue(USER);
    markReplaced.mockResolvedValue(false);
    createSession.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    await expect(svc.refresh(issued.token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(revokeFamily).toHaveBeenCalledWith('family-0001');
  });

  it('a revoked token is treated as reuse; expired or unknown tokens are plain failures', async () => {
    const { svc } = build(true);
    const issued = issueRefreshToken(USER.id, 'family-0001');
    findById.mockResolvedValue(USER);
    findByHash.mockResolvedValue(live(issued, { revokedAt: new Date() }));
    await expect(svc.refresh(issued.token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(revokeFamily).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();
    findByHash.mockResolvedValue(live({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(svc.refresh(issued.token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    findByHash.mockResolvedValue(null);
    await expect(svc.refresh(issued.token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(revokeFamily).not.toHaveBeenCalled();
  });
});

describe('listSessions', () => {
  it('maps active sessions and flags the current one', async () => {
    const { svc } = build(true);
    const d = new Date('2026-01-01T00:00:00Z');
    listActiveForUser.mockResolvedValue([
      { _id: { toString: () => 's1' }, tokenHash: sha256Hex('cur'), deviceLabel: 'Chrome on Windows', createdAt: d, lastUsedAt: d },
      { _id: { toString: () => 's2' }, tokenHash: sha256Hex('other'), createdAt: d },
    ]);
    const out = await svc.listSessions(USER.id, 'cur');
    expect(out[0]).toMatchObject({ id: 's1', deviceLabel: 'Chrome on Windows', current: true });
    expect(out[1]).toMatchObject({ id: 's2', deviceLabel: 'Unknown device', current: false });
  });
});
