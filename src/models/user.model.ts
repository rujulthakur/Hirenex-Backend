import { Schema, model, Types, InferSchemaType } from 'mongoose';
import { ROLES } from '../types/enums';

/**
 * users. Query patterns: findOne({email}) at login (unique index), findOne({googleSub}) at Google sign-in.
 * Relations: referenced by jobs.ownerId, refreshTokens.userId, notifications.userId.
 */
const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    role: { type: String, enum: ROLES, required: true, default: 'hr_admin' },
    googleSub: { type: String },
    lastLoginAt: { type: Date },
    /** HR interview settings, reused for every meeting invite until the HR user changes them. */
    meetingSettings: {
      type: new Schema(
        {
          windowStart: { type: String, default: '10:00' },
          windowEnd: { type: String, default: '13:00' },
          slotMinutes: { type: Number, default: 30, min: 10, max: 180 },
          meetLink: { type: String, default: '', maxlength: 500 },
          timeZone: { type: String, default: 'Asia/Kolkata' },
          companyName: { type: String, default: '', maxlength: 120 },
        },
        { _id: false },
      ),
      default: undefined,
    },
    /** Profile photo as a small data URL (the app resizes it to about 256px before upload). Kept on the account, not in the browser. */
    avatar: { type: String, maxlength: 400_000 },
    /** Personal settings (theme, density, notification choices...). Saved per account so they follow the HR user to any device. */
    preferences: { type: Schema.Types.Mixed },
    isDemo: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);
userSchema.index({ googleSub: 1 }, { unique: true, sparse: true });

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export const UserModel = model('User', userSchema, 'users');
