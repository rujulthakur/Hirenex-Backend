import { getRedis } from './redis';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface OtpRecord {
  hash: string;
  attempts: number;
}

/**
 * Storage port for OTP state. Redis is used ONLY for this, rate limits and the email throttle.
 * Keys are derived from a hash of the email, so no address is ever a Redis key.
 */
export interface OtpStore {
  /** Counts one send in the window and returns the new count (rate limit input). */
  recordSend(emailKey: string, windowSeconds: number): Promise<number>;
  /** Stores a fresh code hash (replacing any older one) with a TTL and attempts reset to 0. */
  saveCode(emailKey: string, codeHash: string, ttlSeconds: number): Promise<void>;
  /** Atomically counts one verification attempt and returns the record, or null if no live code. */
  registerAttempt(emailKey: string): Promise<OtpRecord | null>;
  /** Deletes the code and returns true only for the caller that actually removed it (one-time use). */
  consume(emailKey: string): Promise<boolean>;
  /** Deletes the code without reporting (used when attempts are exhausted). */
  discard(emailKey: string): Promise<void>;
}

const codeKey = (k: string): string => `otp:code:${k}`;
const sendKey = (k: string): string => `otp:sends:${k}`;

const REGISTER_ATTEMPT_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then return nil end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
local hash = redis.call('HGET', KEYS[1], 'hash')
return {hash, attempts}
`;

function unavailable(err: unknown): AppError {
  logger.warn('otp store unavailable', { message: err instanceof Error ? err.message : 'unknown' });
  return new AppError(
    'INTERNAL',
    'Email sign-in is temporarily unavailable. Use the demo login instead.',
    [],
    503,
  );
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw unavailable(err);
  }
}

export class RedisOtpStore implements OtpStore {
  recordSend(emailKey: string, windowSeconds: number): Promise<number> {
    return guard(async () => {
      const redis = getRedis();
      const key = sendKey(emailKey);
      const count = await redis.incr(key);
      if (count === 1 || (await redis.ttl(key)) === -1) await redis.expire(key, windowSeconds);
      return count;
    });
  }

  saveCode(emailKey: string, codeHash: string, ttlSeconds: number): Promise<void> {
    return guard(async () => {
      const key = codeKey(emailKey);
      await getRedis()
        .multi()
        .del(key)
        .hset(key, { hash: codeHash, attempts: '0' })
        .expire(key, ttlSeconds)
        .exec();
    });
  }

  registerAttempt(emailKey: string): Promise<OtpRecord | null> {
    return guard(async () => {
      const reply = (await getRedis().eval(REGISTER_ATTEMPT_LUA, 1, codeKey(emailKey))) as
        | [string, number]
        | null;
      if (!reply) return null;
      return { hash: String(reply[0]), attempts: Number(reply[1]) };
    });
  }

  consume(emailKey: string): Promise<boolean> {
    return guard(async () => (await getRedis().del(codeKey(emailKey))) === 1);
  }

  discard(emailKey: string): Promise<void> {
    return guard(async () => {
      await getRedis().del(codeKey(emailKey));
    });
  }
}

export const otpStore: OtpStore = new RedisOtpStore();
