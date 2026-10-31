import { isMongoConnected } from '../config/db';
import { getLlmStatus, type LlmStatusName } from '../integrations/llm/status';
import { pingRedis } from '../integrations/redis';

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  db: 'up' | 'down';
  redis: 'up' | 'down';
  llm: LlmStatusName;
}

export async function getHealth(): Promise<HealthReport> {
  const dbUp = isMongoConnected();
  const redisUp = await pingRedis();
  const status: HealthReport['status'] = !dbUp ? 'down' : redisUp ? 'ok' : 'degraded';
  return { status, db: dbUp ? 'up' : 'down', redis: redisUp ? 'up' : 'down', llm: getLlmStatus() };
}
