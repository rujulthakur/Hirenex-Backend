import type { RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validates and REPLACES body/query/params with the parsed (stripped, coerced, defaulted) values.
 * Failures raise a ZodError which the error handler maps to VALIDATION_FAILED.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      if (schemas.query) req.query = schemas.query.parse(req.query) as typeof req.query;
      if (schemas.body) req.body = schemas.body.parse(req.body) as typeof req.body;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Helper for controllers: read an already-validated value with its schema type. */
export function typed<S extends ZodTypeAny>(_schema: S, value: unknown): z.infer<S> {
  return value as z.infer<S>;
}
