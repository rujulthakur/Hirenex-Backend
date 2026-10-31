import type { Request, Response } from 'express';
import { approvalService } from '../services/approval.service';
import type { AuditActor } from '../services/audit.service';
import { overrideService } from '../services/override.service';
import { rankingService } from '../services/ranking.service';
import { scoringRunService } from '../services/scoringRun.service';
import { UnauthenticatedError } from '../utils/errors';

/** Controllers only translate HTTP <-> service calls. No business logic here. */
function actorOf(req: Request): AuditActor {
  if (!req.user) throw new UnauthenticatedError();
  return { id: req.user.id, role: req.user.role, name: req.user.name };
}

const param = (req: Request, name: string): string => String(req.params[name]);

/** POST /jobs/:id/score -> 202 { data: { runId } }. */
export async function startScoringController(req: Request, res: Response): Promise<void> {
  const out = await scoringRunService.startScoring(param(req, 'id'), actorOf(req));
  res.status(202).json({ data: out });
}

/** GET /jobs/:id/score/status -> { runId, state, done, total, failures }. */
export async function scoringStatusController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await scoringRunService.getStatus(param(req, 'id')) });
}

/** GET /jobs/:id/shortlist. */
export async function shortlistController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await rankingService.getShortlist(param(req, 'id')) });
}

/** POST /jobs/:id/rerank {weights}. Preview only, nothing saved. */
export async function rerankController(req: Request, res: Response): Promise<void> {
  const body = req.body as { weights: Record<string, number> };
  res.status(200).json({ data: await rankingService.rerank(param(req, 'id'), body.weights) });
}

/** POST /jobs/:id/approve {shortlistIds, waitlistIds}. */
export async function approveController(req: Request, res: Response): Promise<void> {
  const body = req.body as { shortlistIds: string[]; waitlistIds: string[] };
  const out = await approvalService.approve(param(req, 'id'), body.shortlistIds, body.waitlistIds ?? [], actorOf(req));
  res.status(200).json({ data: out });
}

/** GET /candidates/:id/scores. */
export async function candidateScoresController(req: Request, res: Response): Promise<void> {
  res.status(200).json({ data: await overrideService.getScores(param(req, 'id')) });
}

/** PATCH /candidates/:id/scores/:criterionId {score, reason}. Audited, returns the audit seq. */
export async function overrideScoreController(req: Request, res: Response): Promise<void> {
  const body = req.body as { score: number; reason: string };
  const out = await overrideService.overrideScore(param(req, 'id'), param(req, 'criterionId'), body.score, body.reason, actorOf(req));
  res.status(200).json({ data: out });
}
