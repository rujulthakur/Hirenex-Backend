import { Schema, model, Types, InferSchemaType } from 'mongoose';

/**
 * refreshTokens. Only the SHA-256 hash is stored. `family` groups a rotation chain so reuse of an old token
 * can revoke the whole family. TTL index deletes rows once expiresAt passes.
 * Query patterns: findOne({tokenHash}); updateMany({family}) on reuse; updateMany({userId}) on logout-all.
 */
const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true, minlength: 64, maxlength: 64 },
    family: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    replacedBy: { type: String },
    deviceLabel: { type: String, default: 'Unknown device', maxlength: 120 },
    lastUsedAt: { type: Date },
    revokedAt: { type: Date },
  },
  { timestamps: true },
);
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshTokenSchema.index({ family: 1 });
refreshTokenSchema.index({ userId: 1, revokedAt: 1 });

export type RefreshTokenDoc = InferSchemaType<typeof refreshTokenSchema> & { _id: Types.ObjectId };
export const RefreshTokenModel = model('RefreshToken', refreshTokenSchema, 'refreshTokens');
