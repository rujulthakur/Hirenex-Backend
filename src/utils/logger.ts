import winston from 'winston';
import { LOG_REDACT_KEYS } from '../config/constants';

const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return LOG_REDACT_KEYS.some((needle) => lower.includes(needle));
}

/** Deep-copies a value, replacing anything under a sensitive key. Exported for tests. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

const redactFormat = winston.format((info) => {
  // Mutate in place: building a new object would drop winston's Symbol(level)/Symbol(message) keys.
  for (const key of Object.keys(info)) {
    if (key === 'level' || key === 'message') continue;
    (info as Record<string, unknown>)[key] = isSensitiveKey(key) ? REDACTED : redact((info as Record<string, unknown>)[key]);
  }
  return info;
});

// NODE_ENV is read directly (not through env.ts) so the logger can be used while env is still loading.
const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

export const logger = winston.createLogger({
  level: isTest ? 'error' : isProduction ? 'info' : 'debug',
  format: isProduction
    ? winston.format.combine(winston.format.timestamp(), redactFormat(), winston.format.json())
    : winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        redactFormat(),
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const extra = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
          return `${String(timestamp)} ${level}: ${String(message)}${extra}`;
        }),
      ),
  transports: [new winston.transports.Console()],
});
