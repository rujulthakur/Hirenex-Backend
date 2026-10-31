import { Types } from 'mongoose';
import { NotificationModel } from '../models/notification.model';
import { UserModel } from '../models/user.model';
import { toPageOptions, type PageMeta } from '../utils/pagination';
import { logger } from '../utils/logger';

/**
 * In-app notifications. `notify` and `notifyHr` are the helpers OTHER services call; they never throw (a failed
 * notification must not break the workflow that produced it).
 */
export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  href?: string;
  readAt?: string;
  ts: string;
}

interface NotificationRow {
  _id: Types.ObjectId;
  type: string;
  title: string;
  body: string;
  href?: string;
  readAt?: Date;
  ts: Date;
}

const toDto = (n: NotificationRow): NotificationDto => ({ id: String(n._id), type: n.type, title: n.title, body: n.body, ...(n.href ? { href: n.href } : {}), ...(n.readAt ? { readAt: n.readAt.toISOString() } : {}), ts: n.ts.toISOString() });

async function notify(userId: string, type: string, title: string, body: string, href?: string): Promise<void> {
  try {
    if (!Types.ObjectId.isValid(userId)) return;
    await NotificationModel.create({ userId: new Types.ObjectId(userId), type, title: title.slice(0, 160), body: body.slice(0, 600), ...(href ? { href: href.slice(0, 300) } : {}) });
  } catch (err) {
    logger.warn('notify failed', { message: (err as Error).message });
  }
}

/** Every HR user (hr_admin and demo_hr). Returns how many were notified. */
async function notifyHr(type: string, title: string, body: string): Promise<number> {
  try {
    const hr = await UserModel.find({ role: { $in: ['hr_admin', 'demo_hr'] } }).select({ _id: 1 }).lean<Array<{ _id: Types.ObjectId }>>().exec();
    if (hr.length === 0) return 0;
    await NotificationModel.insertMany(hr.map((u) => ({ userId: u._id, type, title: title.slice(0, 160), body: body.slice(0, 600) })));
    return hr.length;
  } catch (err) {
    logger.warn('notifyHr failed', { message: (err as Error).message });
    return 0;
  }
}

/** GET /notifications: newest first, plus the unread count for the bell badge. */
async function list(userId: string, query: { page: number; limit: number }): Promise<{ items: NotificationDto[]; meta: PageMeta; unread: number }> {
  const { limit, skip, page } = toPageOptions(query);
  const filter = { userId: new Types.ObjectId(userId) };
  const [rows, total, unread] = await Promise.all([
    NotificationModel.find(filter).sort({ ts: -1 }).skip(skip).limit(limit).lean<NotificationRow[]>().exec(),
    NotificationModel.countDocuments(filter).exec(),
    NotificationModel.countDocuments({ ...filter, readAt: { $exists: false } }).exec(),
  ]);
  return { items: rows.map(toDto), meta: { page, limit, total }, unread };
}

/** POST /notifications/read {ids?}: marks the given ids (or everything unread) as read. Only the caller's own. */
async function markRead(userId: string, ids?: string[]): Promise<{ updated: number }> {
  const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId), readAt: { $exists: false } };
  if (ids && ids.length > 0) filter['_id'] = { $in: ids.filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i)) };
  const res = await NotificationModel.updateMany(filter, { $set: { readAt: new Date() } }).exec();
  return { updated: res.modifiedCount };
}

export const notificationService = { notify, notifyHr, list, markRead };
