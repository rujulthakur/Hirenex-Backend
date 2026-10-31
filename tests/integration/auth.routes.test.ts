import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';

vi.mock('../../src/integrations/redis', () => ({
  pingRedis: vi.fn().mockResolvedValue(true),
  connectRedis: vi.fn().mockResolvedValue(true),
  closeRedis: vi.fn().mockResolvedValue(undefined),
  getRedis: vi.fn(),
}));

const USER = { id: 'a'.repeat(24), email: 'demo.judge@x.test', name: 'Judge (demo)', role: 'demo_hr', isDemo: true };
vi.mock('../../src/services/auth.service', () => ({
  authService: {
    sendOtp: vi.fn().mockResolvedValue(undefined),
    verifyOtp: vi.fn().mockResolvedValue({ user: USER, session: { accessToken: 'AT', refreshToken: 'RT' } }),
    demoLogin: vi.fn().mockResolvedValue({ user: USER, session: { accessToken: 'AT', refreshToken: 'RT' } }),
    refresh: vi.fn().mockResolvedValue({ user: USER, session: { accessToken: 'AT2', refreshToken: 'RT2' } }),
    logout: vi.fn().mockResolvedValue(undefined),
  },
}));

let app: Express;
beforeAll(async () => {
  app = (await import('../../src/app')).createApp();
});

const post = (path: string) => request(app).post(path).set('X-Requested-By', 'trusthire');

describe('POST /auth/demo-login (DEMO_MODE=true)', () => {
  it('returns the user and sets httpOnly access + path-scoped refresh cookies', async () => {
    const res = await post('/api/v1/auth/demo-login').send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(USER);
    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    const access = cookies.find((c) => c.startsWith('th_access='));
    const refresh = cookies.find((c) => c.startsWith('th_refresh='));
    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/SameSite=Lax/i);
    expect(access).toMatch(/Path=\/;/);
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/Path=\/api\/v1\/auth/);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates: sets a new access cookie AND a new refresh cookie', async () => {
    const res = await post('/api/v1/auth/refresh').set('Cookie', 'th_refresh=RT').send({});
    expect(res.status).toBe(200);
    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(cookies.some((c) => c.startsWith('th_access='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('th_refresh=RT2'))).toBe(true);
  });
});

describe('OTP routes', () => {
  it('send-otp returns the same generic body for any email', async () => {
    const a = await post('/api/v1/auth/send-otp').send({ email: 'a@example.com' });
    const b = await post('/api/v1/auth/send-otp').send({ email: 'b@example.com' });
    expect(a.status).toBe(200);
    expect(a.body).toEqual(b.body);
    expect(a.body.data).toEqual({ sent: true });
  });
  it('validates bodies', async () => {
    const bad = await post('/api/v1/auth/send-otp').send({ email: 'nope' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    const badCode = await post('/api/v1/auth/verify-otp').send({ email: 'a@example.com', code: '12' });
    expect(badCode.status).toBe(400);
  });
  it('requires the CSRF header on POST', async () => {
    const res = await request(app).post('/api/v1/auth/send-otp').send({ email: 'a@example.com' });
    expect(res.status).toBe(403);
  });
});

describe('GET /auth/me', () => {
  it('is UNAUTHENTICATED without a cookie', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
