import { Types } from 'mongoose';
import { RefreshTokenModel, type RefreshTokenDoc } from '../models/refreshToken.model';

export interface NewRefreshToken {
  userId: string;
  tokenHash: string;
  family: string;
  expiresAt: Date;
  deviceLabel?: string;
}

export const refreshTokenRepository = {
  async create(input: NewRefreshToken): Promise<void> {
    await RefreshTokenModel.create({
      userId: new Types.ObjectId(input.userId),
      tokenHash: input.tokenHash,
      family: input.family,
      expiresAt: input.expiresAt,
      deviceLabel: input.deviceLabel ?? 'Unknown device',
      lastUsedAt: new Date(),
    });
  },

  findByHash(tokenHash: string): Promise<RefreshTokenDoc | null> {
    return RefreshTokenModel.findOne({ tokenHash }).lean<RefreshTokenDoc | null>();
  },

  /** Marks one token revoked (logout). Idempotent. */
  async revokeByHash(tokenHash: string): Promise<void> {
    await RefreshTokenModel.updateOne({ tokenHash, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
  },

  /**
   * Atomically marks a live token as replaced. Returns false when it was already replaced or revoked
   * (i.e. someone is presenting an old token: reuse). The conditional update makes concurrent refreshes safe.
   */
  async markReplaced(tokenHash: string, replacedByHash: string): Promise<boolean> {
    const res = await RefreshTokenModel.updateOne(
      { tokenHash, replacedBy: { $exists: false }, revokedAt: { $exists: false } },
      { $set: { replacedBy: replacedByHash, lastUsedAt: new Date() } },
    );
    return res.modifiedCount === 1;
  },

  /** Live (not revoked, not replaced, not expired) sessions of a user, newest first. */
  listActiveForUser(userId: string): Promise<RefreshTokenDoc[]> {
    return RefreshTokenModel.find({
      userId: new Types.ObjectId(userId),
      revokedAt: { $exists: false },
      replacedBy: { $exists: false },
      expiresAt: { $gt: new Date() },
    })
      .sort({ lastUsedAt: -1 })
      .lean<RefreshTokenDoc[]>();
  },

  /** Revokes every live token in a rotation family (reuse detection, Prompt 4). */
  async revokeFamily(family: string): Promise<void> {
    await RefreshTokenModel.updateMany({ family, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
  },

  /** Revokes all sessions of a user. */
  async revokeAllForUser(userId: string): Promise<void> {
    await RefreshTokenModel.updateMany(
      { userId: new Types.ObjectId(userId), revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
    );
  },
};
