import Redis from 'ioredis';
import { env } from '../config/env';
import { HEALTH_PROBE_TIMEOUT_MS } from '../config/constants';
import { logger } from '../utils/logger';

let client: Redis | null = null;

/**
 * Redis is used ONLY for OTP codes, rate limits and the email throttle.
 * lazyConnect + bounded retries so a missing Redis degrades features instead of crashing the app.
 */
export function getRedis(): Redis {
  if (client) return client;
  client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
  });
  client.on('error', (err: Error) => {
    logger.warn('redis error', { message: err.message });
  });
  return client;
}

export async function connectRedis(): Promise<boolean> {
  try {
    const redis = getRedis();
    if (redis.status === 'wait') await redis.connect();
    return true;
  } catch (err) {
    logger.warn('redis unavailable at boot; OTP login and email throttle are degraded', {
      message: err instanceof Error ? err.message : 'unknown',
    });
    return false;
  }
}

export async function pingRedis(): Promise<boolean> {
  try {
    const redis = getRedis();
    if (redis.status === 'wait') await redis.connect();
    const reply = await Promise.race<string>([
      redis.ping(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('redis ping timeout')), HEALTH_PROBE_TIMEOUT_MS),
      ),
    ]);
    return reply === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
  client = null;
}
