import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';

vi.stubEnv('DEMO_MODE', 'false');
vi.mock('../../src/integrations/redis', () => ({
  pingRedis: vi.fn().mockResolvedValue(true),
  connectRedis: vi.fn().mockResolvedValue(true),
  closeRedis: vi.fn().mockResolvedValue(undefined),
  getRedis: vi.fn(),
}));

let app: Express;
beforeAll(async () => {
  app = (await import('../../src/app')).createApp();
});

describe('POST /auth/demo-login (DEMO_MODE=false)', () => {
  it('answers 404 NOT_FOUND and sets no cookies', async () => {
    const res = await request(app).post('/api/v1/auth/demo-login').set('X-Requested-By', 'trusthire').send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
