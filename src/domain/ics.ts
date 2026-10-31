import { createEvent, type DateArray } from 'ics';
import { APP_NAME } from '../config/constants';

/** Builds the .ics attachment (UTC times, ORGANIZER, URL, location or meeting link). Returns null if the lib rejects the input. */
export interface IcsInput {
  uid: string;
  title: string;
  startMs: number;
  endMs: number;
  format: 'virtual' | 'physical';
  whereText: string;
  url: string;
  organizerEmail?: string;
  description?: string;
}

const toArray = (ms: number): DateArray => {
  const d = new Date(ms);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()];
};

export function buildIcs(i: IcsInput): string | null {
  const { error, value } = createEvent({
    uid: i.uid,
    title: i.title,
    start: toArray(i.startMs),
    startInputType: 'utc',
    startOutputType: 'utc',
    end: toArray(i.endMs),
    endInputType: 'utc',
    endOutputType: 'utc',
    location: i.format === 'physical' ? i.whereText : 'Virtual',
    description: `${i.description ?? 'Interview'}${i.format === 'virtual' ? `\nMeeting link: ${i.whereText}` : ''}`,
    url: i.url,
    organizer: { name: `${APP_NAME} (test inbox)`, email: i.organizerEmail ?? 'no-reply@ethereal.email' },
    status: 'CONFIRMED',
    productId: `${APP_NAME}/ics`,
  });
  return error || !value ? null : value;
}
