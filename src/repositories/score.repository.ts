import { Types } from 'mongoose';
import { ScoreModel } from '../models/score.model';
import type { ScoredCriterion } from '../domain/scoring';

export interface CacheHit {
  id: Types.ObjectId;
  rawOutput: unknown;
  model: string;
  promptId: string;
}

export interface ScoreLean {
  _id: Types.ObjectId;
  candidateId: Types.ObjectId;
  jobId: Types.ObjectId;
  perCriterion: Array<Omit<ScoredCriterion, 'overriddenBy' | 'location'> & { location?: { start: number; end: number } | null; overriddenBy?: Types.ObjectId }>;
  total: number;
  promptId: string;
  model: string;
  probeQuestions: string[];
}

export interface UpsertScoreInput {
  candidateId: string;
  jobId: string;
  perCriterion: ScoredCriterion[];
  total: number;
  promptId: string;
  model: string;
  cacheKey?: string;
  cachedFrom?: string;
  rawOutput?: unknown;
}

/** Converts domain criteria (string overriddenBy) into model shape. */
function toModelCriteria(list: ReadonlyArray<ScoredCriterion>): unknown[] {
  return list.map((c) => ({
    ...c,
    location: c.location ?? null,
    overriddenBy: c.overriddenBy && Types.ObjectId.isValid(c.overriddenBy) ? new Types.ObjectId(c.overriddenBy) : undefined,
  }));
}

export const scoreRepository = {
  /** Cache lookup by key. Uses the sparse cacheKey index; lean read. */
  async findCacheHit(cacheKey: string): Promise<CacheHit | null> {
    const doc = await ScoreModel.findOne({ cacheKey, rawOutput: { $exists: true } })
      .select({ rawOutput: 1, model: 1, promptId: 1 })
      .lean()
      .exec();
    if (!doc) return null;
    return { id: doc._id as Types.ObjectId, rawOutput: doc.rawOutput as unknown, model: doc.model, promptId: doc.promptId };
  },

  /** One score document per candidate (unique candidateId). Rescoring replaces it. */
  async upsert(input: UpsertScoreInput): Promise<void> {
    const set: Record<string, unknown> = {
      jobId: new Types.ObjectId(input.jobId),
      perCriterion: toModelCriteria(input.perCriterion),
      total: input.total,
      promptId: input.promptId,
      model: input.model,
    };
    if (input.cacheKey) set['cacheKey'] = input.cacheKey;
    if (input.rawOutput !== undefined) set['rawOutput'] = input.rawOutput;
    const update: Record<string, unknown> = { $set: set };
    if (input.cachedFrom && Types.ObjectId.isValid(input.cachedFrom)) set['cachedFrom'] = new Types.ObjectId(input.cachedFrom);
    else update['$unset'] = { cachedFrom: '' };
    await ScoreModel.updateOne({ candidateId: new Types.ObjectId(input.candidateId) }, update, { upsert: true }).exec();
  },

  async findByCandidate(candidateId: string): Promise<ScoreLean | null> {
    if (!Types.ObjectId.isValid(candidateId)) return null;
    return ScoreModel.findOne({ candidateId: new Types.ObjectId(candidateId) })
      .select({ rawOutput: 0 })
      .lean<ScoreLean | null>()
      .exec();
  },

  /** All scores of a job, without rawOutput. Used for ranking and rerank (no LLM). */
  async findByJob(jobId: string): Promise<ScoreLean[]> {
    return ScoreModel.find({ jobId: new Types.ObjectId(jobId) })
      .select({ rawOutput: 0 })
      .lean<ScoreLean[]>()
      .exec();
  },

  /** Persists recomputed criteria + total after an HR override. */
  async saveCriteria(candidateId: string, perCriterion: ScoredCriterion[], total: number): Promise<void> {
    await ScoreModel.updateOne(
      { candidateId: new Types.ObjectId(candidateId) },
      { $set: { perCriterion: toModelCriteria(perCriterion), total } },
    ).exec();
  },
};
