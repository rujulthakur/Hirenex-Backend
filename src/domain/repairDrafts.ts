/**
 * PURE (no I/O). Deterministic fallbacks for repair emails. The LLM drafts the friendly version; when it fails
 * (or returns invalid JSON) these templates are used, so a repair never waits on AI. Drafts contain NO links:
 * the Prompt 12 template adds accept / decline / reschedule buttons when HR sends.
 */
export interface RepairDraftFacts {
  firstName: string;
  jobTitle: string;
  companyLabel: string;
  whenText: string;
  durationMinutes: number;
  format: 'virtual' | 'physical';
  whereText: string;
}

export interface EmailDraft {
  subject: string;
  body: string;
}

/** First name from the ORIGINAL text: first line, first word made of letters. Falls back to "there". */
export function firstNameFromText(original: string | null | undefined): string {
  if (!original) return 'there';
  const firstLine = original.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const word = firstLine.split(/\s+/).find((w) => /^[\p{L}][\p{L}'-]*$/u.test(w));
  if (!word || word.length < 2 || word.length > 30) return 'there';
  return word.charAt(0).toUpperCase() + word.slice(1);
}

const whereLine = (f: RepairDraftFacts): string => (f.format === 'virtual' ? `Meeting link: ${f.whereText}` : `Location: ${f.whereText}`);

export function promotionTemplate(f: RepairDraftFacts): EmailDraft {
  return {
    subject: `An interview slot is available for ${f.jobTitle}`,
    body: [
      `Hello ${f.firstName},`,
      '',
      `Thank you for your interest in the ${f.jobTitle} role at ${f.companyLabel}. An interview slot has opened up and we would like to offer it to you.`,
      '',
      `When: ${f.whenText}`,
      `Duration: ${f.durationMinutes} minutes`,
      `Format: ${f.format === 'virtual' ? 'Virtual' : 'In person'}`,
      whereLine(f),
      '',
      'Please use the buttons below to accept, decline or ask for another time.',
    ].join('\n'),
  };
}

export function rescheduleTemplate(f: RepairDraftFacts): EmailDraft {
  return {
    subject: `Your interview for ${f.jobTitle} has a new time`,
    body: [
      `Hello ${f.firstName},`,
      '',
      `Because of a scheduling change on our side, your ${f.jobTitle} interview at ${f.companyLabel} has moved. We are sorry for the inconvenience.`,
      '',
      `New time: ${f.whenText}`,
      `Duration: ${f.durationMinutes} minutes`,
      `Format: ${f.format === 'virtual' ? 'Virtual' : 'In person'}`,
      whereLine(f),
      '',
      'Your previous link no longer works. Please use the buttons below to confirm, decline or ask for another time.',
    ].join('\n'),
  };
}
