import { Types } from 'mongoose';
import { computeTrustMeter, computeUtilization, normalizeFunnel, normalizeTimeInStage } from '../domain/analytics';
import { CandidateModel } from '../models/candidate.model';
import { ScoreModel } from '../models/score.model';
import { SlotModel } from '../models/slot.model';
import { jobRepository } from '../repositories/job.repository';
import { NotFoundError } from '../utils/errors';
import { biasPanelService } from './biasPanel.service';

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);
const LIVE = { deletedAt: { $exists: false } };

/** GET /jobs/:id/analytics. Every number comes from an aggregation pipeline on indexed fields. */
async function forJob(jobId: string) {
  const job = await jobRepository.findById(jobId);
  if (!job) throw new NotFoundError('Job not found');
  const jid = oid(jobId);

  const [funnelRows, timeRows, utilRows, quoteRows, flagRows, bias] = await Promise.all([
    CandidateModel.aggregate<{ _id: string; n: number }>([{ $match: { jobId: jid, ...LIVE } }, { $group: { _id: '$stage', n: { $sum: 1 } } }]),
    CandidateModel.aggregate<{ _id: string; avgMs: number }>([
      { $match: { jobId: jid, ...LIVE } },
      { $group: { _id: '$stage', avgMs: { $avg: { $subtract: ['$updatedAt', '$createdAt'] } } } },
    ]),
    SlotModel.aggregate<{ _id: { i: Types.ObjectId; day: string }; booked: number; total: number }>([
      { $match: { jobId: jid, status: { $in: ['open', 'booked'] } } },
      {
        $group: {
          _id: { i: '$interviewerId', day: { $dateToString: { format: '%Y-%m-%d', date: '$start', timezone: job.constraints.timeZone } } },
          booked: { $sum: { $cond: [{ $eq: ['$status', 'booked'] }, 1, 0] } },
          total: { $sum: 1 },
        },
      },
    ]),
    ScoreModel.aggregate<{ _id: null; proposed: number; verified: number }>([
      { $match: { jobId: jid } },
      { $unwind: '$perCriterion' },
      { $match: { 'perCriterion.missing': false } },
      { $group: { _id: null, proposed: { $sum: 1 }, verified: { $sum: { $cond: ['$perCriterion.verified', 1, 0] } } } },
    ]),
    CandidateModel.aggregate<{ _id: null; openFlags: number; injections: number; hidden: number }>([
      { $match: { jobId: jid, ...LIVE } },
      {
        $group: {
          _id: null,
          openFlags: { $sum: { $size: '$flags' } },
          injections: { $sum: { $cond: [{ $in: ['injection_phrase_found', '$flags'] }, 1, 0] } },
          hidden: { $sum: { $cond: [{ $in: ['hidden_text_found', '$flags'] }, 1, 0] } },
        },
      },
    ]),
    biasPanelService.forJob(jobId),
  ]);

  const q = quoteRows[0];
  const f = flagRows[0];
  return {
    funnel: normalizeFunnel(funnelRows),
    timeInStageHours: normalizeTimeInStage(timeRows),
    interviewerUtilization: computeUtilization(utilRows.map((r) => ({ interviewerId: String(r._id.i), day: r._id.day, booked: r.booked, total: r.total }))),
    trustMeter: computeTrustMeter({ verifiedQuotes: q?.verified ?? 0, proposedQuotes: q?.proposed ?? 0, openFlags: f?.openFlags ?? 0, injections: f?.injections ?? 0, hiddenText: f?.hidden ?? 0 }),
    biasPanel: bias,
  };
}

export const analyticsService = { forJob };
