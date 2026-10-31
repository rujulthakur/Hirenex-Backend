import type { Request, Response } from 'express';
import type { AuditActor } from '../services/audit.service';
import { swapService } from '../services/swap.service';
import { UnauthenticatedError } from '../utils/errors';

function actorOf(req: Request): AuditActor {
  if (!req.user) throw new UnauthenticatedError();
  return { id: req.user.id, role: req.user.role, name: req.user.name };
}

/** POST /candidates/:id/swap-test -> { data: {redactedIdentical, original{total}, swapped{total}, delta, rescoredDelta, limitNote} } */
export async function swapTestController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await swapService.run(String(req.params['id']), actorOf(req)) });
}

/* ---- analytics + notifications (Prompt 13) ---- */
import { analyticsService } from '../services/analytics.service';
import { notificationService } from '../services/notification.service';
import { paginationQuerySchema } from '../utils/pagination';

/** GET /jobs/:id/analytics */
export async function analyticsController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await analyticsService.forJob(String(req.params['id'])) });
}

/** GET /notifications */
export async function listNotificationsController(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthenticatedError();
  const q = paginationQuerySchema.parse(req.query);
  const r = await notificationService.list(req.user.id, q);
  res.status(200).json({ data: r.items, meta: { ...r.meta, unread: r.unread } });
}

/** POST /notifications/read {ids?} */
export async function readNotificationsController(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthenticatedError();
  res.status(200).json({ data: await notificationService.markRead(req.user.id, (req.body as { ids?: string[] }).ids) });
}

import { probeService } from '../services/probe.service';
/** POST /candidates/:id/probes (extra endpoint: contract change request). */
export async function probesController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await probeService.generate(String(req.params['id']), actorOf(req)) });
}

import { z } from 'zod';
import { SUMMARY_RANGES, hrSummaryService } from '../services/hrSummary.service';
const summaryQuery = z.object({ range: z.enum(SUMMARY_RANGES).default('30d'), passMark: z.coerce.number().min(0).max(100).default(60) });

/** GET /analytics/summary?range=30d&passMark=60 -> { data: HrSummary } */
export async function hrSummaryController(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthenticatedError();
  const q = summaryQuery.parse(req.query);
  res.status(200).json({ data: await hrSummaryService.forOwner(req.user.id, q.range, q.passMark) });
}
