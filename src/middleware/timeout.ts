import type { RequestHandler } from 'express';

/**
 * Request timeout. If a handler has not answered in time, reply 503 INTERNAL-style envelope so the client is not left
 * hanging (Render also cuts long requests). Uploads get a longer limit. Long work (scoring, scheduling) returns 202 and runs in-process.
 */
export function requestTimeout(defaultMs: number, uploadMs: number): RequestHandler {
  return (req, res, next) => {
    const ms = req.path.endsWith('/resumes') ? uploadMs : defaultMs;
    const timer = setTimeout(() => {
      if (res.headersSent) return;
      res.status(503).json({ error: { code: 'INTERNAL', message: 'The request took too long. Please try again.', details: [] } });
    }, ms);
    timer.unref();
    const clear = (): void => clearTimeout(timer);
    res.on('finish', clear);
    res.on('close', clear);
    next();
  };
}
