/**
 * PURE. Email templates (HTML + text). The LLM drafts only the BODY text; these wrap it with the facts, the
 * accept / decline / reschedule buttons and the footer. If the LLM fails, `fallbackBody` is used instead.
 * Never includes scores, ranks or other candidates.
 */
import { escapeHtml, renderLayout } from './emailLayout';

export const FOOTER_TEXT = 'Test inbox, synthetic data';

export type TemplateKind = 'invitation' | 'promotion' | 'reschedule' | 'decline_ack' | 'decision_waitlist' | 'decision_not_selected' | 'reminder';

export interface TemplateFacts {
  firstName: string;
  jobTitle: string;
  companyLabel: string;
  /** Already formatted in the candidate's time zone. */
  whenText: string;
  durationMinutes: number;
  format: 'virtual' | 'physical';
  /** Meeting link or physical location. */
  whereText: string;
  instructions?: string;
}

export interface TemplateLinks {
  accept: string;
  decline: string;
  reschedule: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export { escapeHtml };
const SUBJECTS: Record<TemplateKind, (f: TemplateFacts) => string> = {
  invitation: (f) => `Interview invitation: ${f.jobTitle}`,
  promotion: (f) => `An interview slot is available for ${f.jobTitle}`,
  reschedule: (f) => `Your ${f.jobTitle} interview has a new time`,
  decline_ack: (f) => `We received your reply about ${f.jobTitle}`,
  decision_waitlist: (f) => `Your application for ${f.jobTitle}: update`,
  decision_not_selected: (f) => `Your application for ${f.jobTitle}: update`,
  reminder: (f) => `Reminder: your ${f.jobTitle} interview`,
};

const HAS_SLOT: ReadonlySet<TemplateKind> = new Set(['invitation', 'promotion', 'reschedule', 'reminder']);
const HAS_BUTTONS: ReadonlySet<TemplateKind> = new Set(['invitation', 'promotion', 'reschedule']);

/** Plain deterministic body, used when the LLM is unavailable or returns something invalid. */
export function fallbackBody(kind: TemplateKind, f: TemplateFacts): string {
  const hi = `Hello ${f.firstName},`;
  switch (kind) {
    case 'invitation':
      return `${hi}\n\nThank you for applying for the ${f.jobTitle} role at ${f.companyLabel}. We would like to invite you to an interview.`;
    case 'promotion':
      return `${hi}\n\nThank you for your interest in the ${f.jobTitle} role at ${f.companyLabel}. An interview slot has opened up and we would like to offer it to you.`;
    case 'reschedule':
      return `${hi}\n\nYour ${f.jobTitle} interview at ${f.companyLabel} has moved because of a scheduling change on our side. We are sorry for the inconvenience.`;
    case 'decline_ack':
      return `${hi}\n\nThank you for letting us know. We have recorded your reply for the ${f.jobTitle} role and released the slot. We wish you the best.`;
    case 'decision_waitlist':
      return `${hi}\n\nThank you for applying for the ${f.jobTitle} role at ${f.companyLabel}. You are on our waiting list. If an interview slot opens up we will contact you.`;
    case 'decision_not_selected':
      return `${hi}\n\nThank you for applying for the ${f.jobTitle} role at ${f.companyLabel}. We will not be moving forward with your application this time. We appreciate your interest.`;
    case 'reminder':
      return `${hi}\n\nA reminder about your upcoming ${f.jobTitle} interview at ${f.companyLabel}.`;
  }
}

function detailsLines(f: TemplateFacts): string[] {
  return [
    `When: ${f.whenText}`,
    `Duration: ${f.durationMinutes} minutes`,
    `Format: ${f.format === 'virtual' ? 'Virtual' : 'In person'}`,
    `${f.format === 'virtual' ? 'Meeting link' : 'Location'}: ${f.whereText}`,
    ...(f.instructions ? [`Instructions: ${f.instructions}`] : []),
  ];
}

export function renderEmail(kind: TemplateKind, facts: TemplateFacts, links: TemplateLinks | null, body?: string, subject?: string): RenderedEmail {
  const text = body && body.trim().length > 0 ? body.trim() : fallbackBody(kind, facts);
  const details = HAS_SLOT.has(kind) ? detailsLines(facts) : [];
  const buttons = HAS_BUTTONS.has(kind) && links ? links : null;

  const plain = [
    text,
    ...(details.length ? ['', ...details] : []),
    ...(buttons ? ['', `Accept: ${buttons.accept}`, `Decline: ${buttons.decline}`, `Ask for another time: ${buttons.reschedule}`] : []),
    '',
    `-- ${FOOTER_TEXT}`,
  ].join('\n');

  const first = text.split(/\n{2,}/);
  const greeting = first[0] && /^hello\b/i.test(first[0]) ? first.shift() : undefined;
  const rows = details.map((d) => { const k = d.indexOf(':'); return { label: d.slice(0, k), value: d.slice(k + 1).trim() }; });
  const html = renderLayout({
    preheader: SUBJECTS[kind](facts),
    eyebrow: facts.jobTitle,
    title: SUBJECTS[kind](facts),
    body: [greeting, ...first].filter(Boolean).join('\n\n'),
    details: rows,
    ...(buttons ? { cta: { href: buttons.accept, label: 'Accept interview' }, secondary: [{ href: buttons.reschedule, label: 'Ask for another time' }, { href: buttons.decline, label: 'Decline' }] } : {}),
    sender: `${facts.companyLabel}`,
    footer: FOOTER_TEXT,
  });

  return { subject: subject && subject.trim().length > 0 ? subject.trim() : SUBJECTS[kind](facts), text: plain, html };
}

