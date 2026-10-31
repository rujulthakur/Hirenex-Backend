import { Schema, model, Types, InferSchemaType } from 'mongoose';

/**
 * notifications (in-app). TTL 90 days. Query patterns: list newest first per user; mark unread as read.
 */
const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true, maxlength: 60 },
    title: { type: String, required: true, maxlength: 160 },
    body: { type: String, required: true, maxlength: 600 },
    /** In-app path to open when the notification is clicked, for example /app/jobs/:id/candidates. */
    href: { type: String, maxlength: 300 },
    readAt: { type: Date },
    ts: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);
notificationSchema.index({ userId: 1, readAt: 1, ts: -1 });
notificationSchema.index({ ts: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export type NotificationDoc = InferSchemaType<typeof notificationSchema> & { _id: Types.ObjectId };
export const NotificationModel = model('Notification', notificationSchema, 'notifications');
