import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/integrations/redis', () => ({
  pingRedis: vi.fn().mockResolvedValue(true),
  connectRedis: vi.fn().mockResolvedValue(true),
  closeRedis: vi.fn().mockResolvedValue(undefined),
  getRedis: vi.fn(),
}));

import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  const mod = await import('../../src/app');
  app = mod.createApp();
});

describe('GET /api/v1/health', () => {
  it('reports db, redis and llm inside the data envelope (db is not connected in this test)', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(503);
    expect(res.body.data).toEqual({ status: 'down', db: 'down', redis: 'up', llm: 'unconfigured' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('GET /health (keep-alive probe)', () => {
  it('answers 200 without touching db or redis, for GET and HEAD', async () => {
    const get = await request(app).get('/health');
    expect(get.status).toBe(200);
    expect(get.body.status).toBe('ok');
    expect(typeof get.body.uptimeSeconds).toBe('number');
    const head = await request(app).head('/healthz');
    expect(head.status).toBe(200);
  });
});

describe('platform behaviour', () => {
  it('returns the contract error envelope for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects state-changing requests without the CSRF header', async () => {
    const res = await request(app).post('/api/v1/anything').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('lets a request with the CSRF header through to routing (then 404)', async () => {
    const res = await request(app).post('/api/v1/anything').set('X-Requested-By', 'trusthire').send({});
    expect(res.status).toBe(404);
  });

  it('maps malformed JSON to VALIDATION_FAILED', async () => {
    const res = await request(app)
      .post('/api/v1/anything')
      .set('X-Requested-By', 'trusthire')
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('blocks disallowed CORS origins and allows listed ones with credentials', async () => {
    const bad = await request(app).get('/api/v1/health').set('Origin', 'http://evil.test');
    expect(bad.status).toBe(403);
    const good = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5173');
    expect(good.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(good.headers['access-control-allow-credentials']).toBe('true');
  });
});
