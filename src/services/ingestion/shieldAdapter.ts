import type { HiddenFindingType } from '../../types/enums';
import type { PdfTextItem } from './extractPdf';

export interface HiddenFinding {
  type: HiddenFindingType;
  text: string;
  location: string;
}

export interface ShieldInput {
  fileType: 'pdf' | 'docx';
  fileName: string;
  text: string;
  pdfItems?: PdfTextItem[];
  pdfMetadata?: string;
  docxParts?: Record<string, string>;
}

export interface ShieldPorts {
  scanHidden(input: ShieldInput): HiddenFinding[];
  scanInjection(text: string): { count: number };
  redact(text: string, fileName: string): { redactedText: string; removedCategories: string[] };
}

/**
 * Ingestion talks to the shield only through this port. Prompt 7 supplies the full implementation
 * (src/domain/shield/*, src/domain/redaction.ts) and calls setShield() at boot.
 * Until then the baseline below runs: it is conservative but real (tiny PDF fonts, a few injection
 * phrases, and email/phone/URL redaction), so the pipeline is usable end to end.
 */
const BASE_INJECTION = /(ignore (all )?(previous|prior) instructions|you are now|system prompt|disregard the rubric|\b100\s*\/\s*100\b)/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(\+?\d[\d\s().-]{8,}\d)/g;
const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;

const baseline: ShieldPorts = {
  scanHidden(input) {
    if (input.fileType !== 'pdf' || !input.pdfItems) return [];
    return input.pdfItems
      .filter((i) => i.fontSize > 0 && i.fontSize < 4 && i.str.trim().length > 3)
      .map((i) => ({ type: 'tiny_font' as const, text: i.str.slice(0, 500), location: `page ${i.page}` }));
  },
  scanInjection(text) {
    return { count: BASE_INJECTION.test(text) ? 1 : 0 };
  },
  redact(text) {
    const redactedText = text.replace(EMAIL, '[EMAIL]').replace(URL_RE, '[URL]').replace(PHONE, '[PHONE]');
    return { redactedText, removedCategories: redactedText === text ? [] : ['contact'] };
  },
};

let active: ShieldPorts = baseline;

export function setShield(ports: ShieldPorts): void {
  active = ports;
}
export function getShield(): ShieldPorts {
  return active;
}
