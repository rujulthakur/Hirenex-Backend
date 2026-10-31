import type { RequestHandler } from 'express';

/**
 * NoSQL injection control (mongo-sanitize equivalent, no extra dependency). Removes any object key that starts with "$"
 * or contains "." from body, query and params BEFORE validation. zod then rejects unknown shapes, and repositories only
 * ever pass validated scalars or escaped literals into queries. Two layers: strip operators, then validate types.
 */
export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 20) return null;
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith('$') || key.includes('.')) continue;
      out[key] = sanitizeValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

export const sanitizeRequest: RequestHandler = (req, _res, next) => {
  if (req.body !== undefined && req.body !== null) req.body = sanitizeValue(req.body);
  const q = sanitizeValue(req.query) as Record<string, unknown>;
  for (const k of Object.keys(req.query)) delete (req.query as Record<string, unknown>)[k];
  Object.assign(req.query, q);
  const p = sanitizeValue(req.params) as Record<string, unknown>;
  for (const k of Object.keys(req.params)) delete (req.params as Record<string, unknown>)[k];
  Object.assign(req.params, p);
  next();
};
