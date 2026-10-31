import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import {
  API_PREFIX,
  CSRF_HEADER_NAME,
  GLOBAL_RATE_LIMIT,
  JSON_BODY_LIMIT,
  REQUEST_ID_HEADER,
  REQUEST_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
} from './config/constants';
import { env } from './config/env';
import { csrfHeader } from './middleware/csrfHeader';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { createRateLimiter } from './middleware/rateLimit';
import { requestId } from './middleware/requestId';
import { sanitizeRequest } from './middleware/sanitize';
import { requestTimeout } from './middleware/timeout';
import { apiRouter } from './routes';
import { logger } from './utils/logger';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // Render/Vercel sit behind one proxy hop: needed for correct req.ip and Secure cookies.
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(requestTimeout(REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS));
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        // No Origin header = same-origin, curl or server-to-server: allowed (CSRF header still applies).
        if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new Error('CORS_ORIGIN_NOT_ALLOWED'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', CSRF_HEADER_NAME, REQUEST_ID_HEADER],
      exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
      maxAge: 600,
    }),
  );
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  morgan.token('rid', (req) => (req as express.Request).id);
  app.use(
    morgan(':method :url :status :res[content-length] - :response-time ms rid=:rid', {
      stream: { write: (line: string) => logger.info(line.trim()) },
      skip: (req) => req.url?.endsWith('/health') === true,
    }),
  );

  // Keep-alive probe for uptime monitors (cron-job.org, UptimeRobot). Cheap on purpose: no DB, no Redis, no auth,
  // and mounted before the rate limiter so monitoring can never be throttled. GET and HEAD both work.
  // Deep check (db + redis + llm): GET /api/v1/health.
  app.get(['/health', '/healthz'], (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()), time: new Date().toISOString() });
  });

  app.use(createRateLimiter(GLOBAL_RATE_LIMIT));
  app.use(API_PREFIX, sanitizeRequest);
  app.use(API_PREFIX, csrfHeader);
  app.use(API_PREFIX, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
