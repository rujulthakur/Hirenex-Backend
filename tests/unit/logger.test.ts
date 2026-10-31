import { describe, expect, it } from 'vitest';
import { redact } from '../../src/utils/logger';

describe('log redaction', () => {
  it('redacts sensitive keys at any depth, case-insensitively', () => {
    const out = redact({
      user: 'a',
      Authorization: 'Bearer abc',
      nested: { otpCode: '123456', accessToken: 'x', ok: 1 },
      list: [{ cookie: 'c' }],
    }) as Record<string, unknown>;
    expect(out.Authorization).toBe('[REDACTED]');
    expect(out.nested).toEqual({ otpCode: '[REDACTED]', accessToken: '[REDACTED]', ok: 1 });
    expect(out.list).toEqual([{ cookie: '[REDACTED]' }]);
    expect(out.user).toBe('a');
  });
});
