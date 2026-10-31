import { Types } from 'mongoose';
import { DateTime } from 'luxon';
import { CandidateModel } from '../models/candidate.model';
import { JobModel } from '../models/job.model';
import { MeetingModel } from '../models/meeting.model';
import { UserModel } from '../models/user.model';
import { daySlots, freeSlots, tomorrowIn, type SlotWindow } from '../domain/meetingSlots';
import { renderMeetingEmail } from '../domain/meetingEmail';
import { sendMeetingMail } from '../integrations/mailer/meetingMailer';
import { notificationService } from './notification.service';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';

export interface MeetingSettings {
  windowStart: string;
  windowEnd: string;
  slotMinutes: number;
  meetLink: string;
  timeZone: string;
  companyName: string;
}

const DEFAULTS: MeetingSettings = { windowStart: '10:00', windowEnd: '13:00', slotMinutes: 30, meetLink: '', timeZone: 'Asia/Kolkata', companyName: '' };

export interface MeetingDto {
  id: string;
  jobId: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  start: string;
  end: string;
  meetLink: string;
  status: 'scheduled' | 'cancelled';
  emailStatus: string;
  previewUrl?: string;
}

export interface SendResult {
  date: string;
  scheduled: MeetingDto[];
  skipped: Array<{ candidateId: string; name: string; reason: 'day_full' | 'no_email' | 'already_invited' }>;
  emailChannel: 'live' | 'test';
}

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function getSettings(userId: string): Promise<MeetingSettings> {
  const u = await UserModel.findById(userId).select({ meetingSettings: 1 }).lean<{ meetingSettings?: Partial<MeetingSettings> } | null>();
  return { ...DEFAULTS, ...(u?.meetingSettings ?? {}) };
}

async function saveSettings(userId: string, patch: Partial<MeetingSettings>): Promise<MeetingSettings> {
  const next = { ...(await getSettings(userId)), ...patch };
  if (next.windowEnd <= next.windowStart) throw new ValidationError('The end of the interview window must be after its start.');
  await UserModel.updateOne({ _id: new Types.ObjectId(userId) }, { $set: { meetingSettings: next } });
  return next;
}

async function takenOn(ownerId: string, all: SlotWindow[]): Promise<SlotWindow[]> {
  const first = all[0];
  const last = all[all.length - 1];
  if (!first || !last) return [];
  const rows = await MeetingModel.find({ ownerId: new Types.ObjectId(ownerId), status: 'scheduled', start: { $lt: last.end }, end: { $gt: first.start } })
    .select({ start: 1, end: 1 })
    .lean<Array<{ start: Date; end: Date }>>();
  return rows.map((r) => ({ start: r.start, end: r.end }));
}

/** Tomorrow's date plus how many interviews still fit in the HR window. */
async function capacity(userId: string): Promise<{ date: string; total: number; free: number; settings: MeetingSettings }> {
  const settings = await getSettings(userId);
  const date = tomorrowIn(settings.timeZone);
  const all = daySlots(date, settings.timeZone, settings.windowStart, settings.windowEnd, settings.slotMinutes);
  const free = freeSlots(all, await takenOn(userId, all));
  return { date, total: all.length, free: free.length, settings };
}

function toDto(m: Raw, cand?: Raw): MeetingDto {
  return {
    id: String(m._id), jobId: String(m.jobId), candidateId: String(m.candidateId),
    candidateName: cand?.profile?.name || cand?.fileName || 'Candidate', candidateEmail: cand?.profile?.email ?? '',
    start: new Date(m.start).toISOString(), end: new Date(m.end).toISOString(), meetLink: m.meetLink,
    status: m.status, emailStatus: m.emailStatus, ...(m.previewUrl ? { previewUrl: m.previewUrl } : {}),
  };
}

async function list(userId: string, jobId: string): Promise<MeetingDto[]> {
  const rows = await MeetingModel.find({ ownerId: new Types.ObjectId(userId), jobId: new Types.ObjectId(jobId), status: 'scheduled' }).sort({ start: 1 }).lean<Raw[]>();
  const cands = await CandidateModel.find({ _id: { $in: rows.map((r) => r.candidateId) } }).select({ profile: 1, fileName: 1 }).lean<Raw[]>();
  const byId = new Map(cands.map((c) => [String(c._id), c]));
  return rows.map((r) => toDto(r, byId.get(String(r.candidateId))));
}

function insertMeeting(doc: { ownerId: Types.ObjectId; jobId: Types.ObjectId; candidateId: Types.ObjectId; start: Date; end: Date; meetLink: string }) {
  return MeetingModel.create(doc);
}

async function sendInvites(userId: string, jobId: string, candidateIds: string[]): Promise<SendResult> {
  const job = await JobModel.findById(new Types.ObjectId(jobId)).select({ title: 1 }).lean<{ title: string } | null>();
  if (!job) throw new NotFoundError('Job not found');
  const settings = await getSettings(userId);
  if (!/^https:\/\/.+/i.test(settings.meetLink)) throw new ValidationError('Add your Google Meet link in the interview settings before sending invites.');

  const date = tomorrowIn(settings.timeZone);
  const all = daySlots(date, settings.timeZone, settings.windowStart, settings.windowEnd, settings.slotMinutes);
  const free = freeSlots(all, await takenOn(userId, all));
  if (all.length === 0) throw new ConflictError('The interview window has no room for a whole slot. Check your interview settings.');

  const ids = candidateIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  const cands = await CandidateModel.find({ _id: { $in: ids }, jobId: new Types.ObjectId(jobId), deletedAt: { $exists: false } }).lean<Raw[]>();
  // Best scores first, so when tomorrow is full the strongest candidates are the ones who get a slot.
  cands.sort((a, b) => (b.totalScore ?? -1) - (a.totalScore ?? -1) || a.uploadOrder - b.uploadOrder);

  const already = new Set((await MeetingModel.find({ candidateId: { $in: ids }, status: 'scheduled' }).select({ candidateId: 1 }).lean<Raw[]>()).map((m) => String(m.candidateId)));
  const result: SendResult = { date, scheduled: [], skipped: [], emailChannel: 'test' };
  const nameOf = (c: Raw): string => c.profile?.name || c.fileName || 'Candidate';
  const company = settings.companyName || 'our team';

  for (const c of cands) {
    const id = String(c._id);
    if (already.has(id)) { result.skipped.push({ candidateId: id, name: nameOf(c), reason: 'already_invited' }); continue; }
    if (!c.profile?.email) { result.skipped.push({ candidateId: id, name: nameOf(c), reason: 'no_email' }); continue; }
    let slot: SlotWindow | undefined;
    let meeting: Awaited<ReturnType<typeof insertMeeting>> | null = null;
    // If another request grabbed the slot first, the unique index rejects it and we move to the next free slot.
    while (!meeting) {
      slot = free.shift();
      if (!slot) break;
      try {
        meeting = await insertMeeting({ ownerId: new Types.ObjectId(userId), jobId: new Types.ObjectId(jobId), candidateId: c._id, start: slot.start, end: slot.end, meetLink: settings.meetLink });
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err;
      }
    }
    if (!meeting || !slot) { result.skipped.push({ candidateId: id, name: nameOf(c), reason: 'day_full' }); continue; }

    const s = DateTime.fromJSDate(slot.start, { zone: settings.timeZone });
    const e = DateTime.fromJSDate(slot.end, { zone: settings.timeZone });
    const mail = renderMeetingEmail({
      firstName: String(nameOf(c)).split(/\s+/)[0] ?? 'there', jobTitle: job.title, companyName: company,
      dateText: s.toFormat('cccc, d LLLL yyyy'), timeText: `${s.toFormat('h:mm a')} – ${e.toFormat('h:mm a')} (${settings.timeZone === 'Asia/Kolkata' ? 'IST' : (s.offsetNameShort ?? settings.timeZone)})`,
      durationMinutes: settings.slotMinutes, meetLink: settings.meetLink,
    });
    const sent = await sendMeetingMail({ to: c.profile.email, fromName: settings.companyName, ...mail });
    result.emailChannel = sent.channel;
    meeting.emailStatus = sent.ok ? 'sent' : 'failed';
    if (sent.previewUrl) meeting.previewUrl = sent.previewUrl;
    await meeting.save();
    if (sent.ok) await CandidateModel.updateOne({ _id: c._id }, { $set: { stage: 'invited' } });
    result.scheduled.push(toDto(meeting.toObject(), c));
  }

  if (result.scheduled.length > 0) {
    const ok = result.scheduled.filter((m) => m.emailStatus === 'sent').length;
    await notificationService.notify(userId, 'meeting_invites', `${ok} interview invite${ok === 1 ? '' : 's'} sent`, `Interviews are set for ${date}.${result.skipped.length ? ` ${result.skipped.length} candidate(s) were not scheduled.` : ''}`, `/app/jobs/${jobId}/schedule`);
  }
  return result;
}

async function cancel(userId: string, meetingId: string): Promise<{ cancelled: true }> {
  if (!Types.ObjectId.isValid(meetingId)) throw new NotFoundError('Meeting not found');
  const m = await MeetingModel.findOneAndUpdate({ _id: new Types.ObjectId(meetingId), ownerId: new Types.ObjectId(userId), status: 'scheduled' }, { $set: { status: 'cancelled' } }, { new: true }).lean<Raw | null>();
  if (!m) throw new NotFoundError('Meeting not found');
  const c = await CandidateModel.findById(m.candidateId).select({ totalScore: 1 }).lean<Raw | null>();
  await CandidateModel.updateOne({ _id: m.candidateId }, { $set: { stage: c?.totalScore != null ? 'scored' : 'applied' } });
  return { cancelled: true };
}

export const meetingService = { getSettings, saveSettings, capacity, list, sendInvites, cancel };
