import { Types } from 'mongoose';
import { computeImpact, type BiasPanel } from '../domain/impactRatio';
import { SyntheticLabelModel } from '../models/auditOnly/syntheticLabel.model';

/**
 * AUDIT-ONLY service: the ONLY non-seed code allowed to import syntheticLabels (see .eslintrc.cjs). The result is
 * read-only analytics. It never feeds back into scoring, ranking, shortlisting or scheduling.
 * "Selected" = reached shortlisted or later (shortlisted, invited, confirmed, declined). Waitlisted/scored are not.
 */
export const SELECTED_STAGES = ['shortlisted', 'invited', 'confirmed', 'declined'] as const;

async function forJob(jobId: string): Promise<BiasPanel> {
  const rows = await SyntheticLabelModel.aggregate<{ _id: string; total: number; shortlisted: number }>([
    { $match: { jobId: new Types.ObjectId(jobId) } },
    { $lookup: { from: 'candidates', localField: 'candidateId', foreignField: '_id', as: 'c' } },
    { $unwind: '$c' },
    { $match: { 'c.deletedAt': { $exists: false } } },
    { $group: { _id: '$group', total: { $sum: 1 }, shortlisted: { $sum: { $cond: [{ $in: ['$c.stage', SELECTED_STAGES as unknown as string[]] }, 1, 0] } } } },
  ]);
  return computeImpact(rows.map((r) => ({ group: r._id, total: r.total, shortlisted: r.shortlisted })));
}

export const biasPanelService = { forJob };
