import { renderLayout } from './emailLayout';

export interface MeetingEmailFacts {
  firstName: string;
  jobTitle: string;
  companyName: string;
  /** Already formatted in the HR time zone, e.g. "Tuesday, 3 November 2026". */
  dateText: string;
  /** e.g. "10:30 AM – 11:00 AM (IST)". */
  timeText: string;
  durationMinutes: number;
  meetLink: string;
}

export interface RenderedMeetingEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderMeetingEmail(f: MeetingEmailFacts): RenderedMeetingEmail {
  const subject = `Interview invitation: ${f.jobTitle} at ${f.companyName}`;
  const text = [
    `Hello ${f.firstName},`,
    '',
    `Thank you for applying for the ${f.jobTitle} role at ${f.companyName}. We would like to meet you.`,
    '',
    `Date: ${f.dateText}`,
    `Time: ${f.timeText}`,
    `Duration: ${f.durationMinutes} minutes`,
    `Google Meet: ${f.meetLink}`,
    '',
    'Please join a couple of minutes early. If this time does not work, reply to this email and we will find another.',
    '',
    `${f.companyName} Hiring Team`,
  ].join('\n');
  const html = renderLayout({
    preheader: `${f.dateText}, ${f.timeText}. Join with one tap.`,
    eyebrow: 'Interview invitation',
    title: `Let's meet, ${f.firstName}`,
    body: `Thank you for applying for the ${f.jobTitle} role at ${f.companyName}. We would like to meet you.`,
    details: [
      { label: 'Date', value: f.dateText },
      { label: 'Time', value: f.timeText },
      { label: 'Duration', value: `${f.durationMinutes} minutes` },
      { label: 'Where', value: 'Google Meet (video call)' },
    ],
    cta: { href: f.meetLink, label: 'Join Google Meet', showLink: true },
    note: 'Please join a couple of minutes early. If this time does not work, reply to this email and we will find another.',
    sender: `${f.companyName} Hiring Team`,
  });
  return { subject, text, html };
}
