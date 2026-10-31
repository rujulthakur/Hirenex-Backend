import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import { createApp } from './app';
import { closeMongo, connectMongo } from './config/db';
import { env } from './config/env';
import { APP_NAME } from './config/constants';
import { closeRedis, connectRedis } from './integrations/redis';
import { logger } from './utils/logger';
import { installShield } from './domain/shield';

async function main(): Promise<void> {
  installShield();
  await connectMongo();
  const redisOk = await connectRedis();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`${APP_NAME} API listening`, {
      port: env.PORT,
      env: env.NODE_ENV,
      demoMode: env.DEMO_MODE,
      redis: redisOk ? 'up' : 'down',
    });
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(() => {
      Promise.allSettled([closeMongo(), closeRedis()]).then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', { reason: reason instanceof Error ? reason.message : String(reason) });
  });
}

main().catch((err: unknown) => {
  logger.error('fatal startup error', { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
