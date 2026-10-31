import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env';

const valid: NodeJS.ProcessEnv = {
  MONGODB_URI: 'mongodb://localhost/x',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  CORS_ORIGINS: 'http://a.test, http://b.test',
  APP_BASE_URL: 'http://localhost:4000',
  PORTAL_BASE_URL: 'http://localhost:5173',
  DEMO_MODE: 'true',
};

describe('parseEnv', () => {
  it('accepts a valid environment and applies defaults', () => {
    const result = parseEnv(valid);
    if (!result.ok) throw new Error(result.problems.join(','));
    expect(result.env.PORT).toBe(4000);
    expect(result.env.DEMO_MODE).toBe(true);
    expect(result.env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('lists every missing variable', () => {
    const result = parseEnv({});
    if (result.ok) throw new Error('expected failure');
    const text = result.problems.join('\n');
    expect(text).toContain('MONGODB_URI');
    expect(text).toContain('JWT_ACCESS_SECRET');
    expect(text).toContain('APP_BASE_URL');
  });

  it('rejects short JWT secrets and treats empty strings as unset', () => {
    const result = parseEnv({ ...valid, JWT_ACCESS_SECRET: 'short', REDIS_URL: '' });
    if (result.ok) throw new Error('expected failure');
    const text = result.problems.join('\n');
    expect(text).toContain('JWT_ACCESS_SECRET');
    expect(text).toContain('REDIS_URL');
  });
});
