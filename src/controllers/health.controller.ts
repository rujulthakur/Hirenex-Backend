import type { Request, Response } from 'express';
import { getHealth } from '../services/health.service';

export async function healthController(_req: Request, res: Response): Promise<void> {
  const report = await getHealth();
  // 503 only when the database is down; a missing Redis is "degraded" but the app can still serve.
  res.status(report.status === 'down' ? 503 : 200).json({ data: report });
}
