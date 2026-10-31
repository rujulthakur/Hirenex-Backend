import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';

vi.mock('../../src/integrations/redis', () => ({
  pingRedis: vi.fn().mockResolvedValue(true),
  connectRedis: vi.fn().mockResolvedValue(true),
  closeRedis: vi.fn().mockResolvedValue(undefined),
  getRedis: vi.fn(),
}));
const USER = { id: 'a'.repeat(24), email: 'hr@example.com', name: 'Hira', role: 'hr_admin', isDemo: false };
vi.mock('../../src/services/auth.service', () => ({
  authService: { googleLogin: vi.fn().mockResolvedValue({ user: USER, session: { accessToken: 'AT', refreshToken: 'RT' } }) },
}));

let app: Express;
beforeAll(async () => {
  app = (await import('../../src/app')).createApp();
});
const post = () => request(app).post('/api/v1/auth/google').set('X-Requested-By', 'trusthire');

describe('POST /auth/google', () => {
  it('sets httpOnly cookies and returns the user', async () => {
    const res = await post().send({ idToken: 'x'.repeat(40) });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(USER);
    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(cookies.filter((c) => /HttpOnly/i.test(c))).toHaveLength(2);
  });
  it('validates the body', async () => {
    const res = await post().send({ idToken: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});
