import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AppError,
  ERROR_CODES,
  ERROR_STATUS,
  ApprovalRequiredError,
  SlotTakenError,
  TokenExpiredError,
  normalizeError,
  toEnvelope,
} from '../../src/utils/errors';

describe('error mapping', () => {
  it('has an HTTP status for every contract error code', () => {
    for (const code of ERROR_CODES) expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    expect(ERROR_CODES).toHaveLength(12);
  });

  it('maps typed errors to the contract envelope', () => {
    const env = toEnvelope(new ApprovalRequiredError());
    expect(env.error.code).toBe('APPROVAL_REQUIRED');
    expect(env.error.details).toEqual([]);
    expect(new SlotTakenError().status).toBe(409);
    expect(new TokenExpiredError().status).toBe(410);
  });

  it('turns zod errors into VALIDATION_FAILED with per-field details', () => {
    const parsed = z.object({ email: z.string().email() }).safeParse({ email: 'nope' });
    if (parsed.success) throw new Error('expected failure');
    const err = normalizeError(parsed.error);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.status).toBe(400);
    expect(err.details).toEqual([{ path: 'email', message: expect.any(String) }]);
  });

  it('hides the message of unknown errors', () => {
    const err = normalizeError(new Error('db password is hunter2'));
    expect(err.code).toBe('INTERNAL');
    expect(err.message).not.toContain('hunter2');
  });

  it('maps malformed JSON and oversize bodies', () => {
    expect(normalizeError({ type: 'entity.parse.failed' }).code).toBe('VALIDATION_FAILED');
    const big = normalizeError({ type: 'entity.too.large' });
    expect(big.status).toBe(413);
  });

  it('maps multer errors to UPLOAD_REJECTED', () => {
    const err = normalizeError({ name: 'MulterError', code: 'LIMIT_FILE_SIZE' });
    expect(err.code).toBe('UPLOAD_REJECTED');
  });

  it('passes AppError through unchanged', () => {
    const original = new AppError('CONFLICT', 'x');
    expect(normalizeError(original)).toBe(original);
  });
});
