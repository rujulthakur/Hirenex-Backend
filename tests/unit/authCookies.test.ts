import { describe, expect, it } from 'vitest';
import { buildCookieOptions } from '../../src/utils/authCookies';
import { ACCESS_TTL_SECONDS, REFRESH_COOKIE_PATH, REFRESH_TTL_SECONDS } from '../../src/config/constants';

describe('buildCookieOptions', () => {
  it('is always httpOnly', () => {
    expect(buildCookieOptions('access', { NODE_ENV: 'development', COOKIE_SAMESITE: 'lax' }).httpOnly).toBe(true);
    expect(buildCookieOptions('refresh', { NODE_ENV: 'production', COOKIE_SAMESITE: 'none' }).httpOnly).toBe(true);
  });
  it('is Secure in production and whenever SameSite=None', () => {
    expect(buildCookieOptions('access', { NODE_ENV: 'production', COOKIE_SAMESITE: 'lax' }).secure).toBe(true);
    expect(buildCookieOptions('access', { NODE_ENV: 'development', COOKIE_SAMESITE: 'none' }).secure).toBe(true);
    expect(buildCookieOptions('access', { NODE_ENV: 'development', COOKIE_SAMESITE: 'lax' }).secure).toBe(false);
  });
  it('passes SameSite and domain through', () => {
    const o = buildCookieOptions('access', { NODE_ENV: 'production', COOKIE_SAMESITE: 'none', COOKIE_DOMAIN: '.example.com' });
    expect(o.sameSite).toBe('none');
    expect(o.domain).toBe('.example.com');
  });
  it('scopes the refresh cookie to the auth path and uses the right lifetimes', () => {
    const cfg = { NODE_ENV: 'production', COOKIE_SAMESITE: 'lax' } as const;
    const access = buildCookieOptions('access', cfg);
    const refresh = buildCookieOptions('refresh', cfg);
    expect(access.path).toBe('/');
    expect(refresh.path).toBe(REFRESH_COOKIE_PATH);
    expect(access.maxAge).toBe(ACCESS_TTL_SECONDS * 1000);
    expect(refresh.maxAge).toBe(REFRESH_TTL_SECONDS * 1000);
  });
  it('omits maxAge when clearing', () => {
    expect(buildCookieOptions('access', { NODE_ENV: 'production', COOKIE_SAMESITE: 'lax' }, false).maxAge).toBeUndefined();
  });
});
