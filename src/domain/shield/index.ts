import { detectHiddenDocx } from './hiddenDocx';
import { detectHiddenPdf } from './hiddenPdf';
import { scanInjection } from './injection';
import { redact } from '../redaction';
import { setShield } from '../../services/ingestion/shieldAdapter';
import type { ShieldPorts } from '../../services/ingestion/shieldAdapter';

const NOISY_RULES: ReadonlySet<string> = new Set(['control_chars', 'homoglyph_abuse', 'base64_blob', 'score_100', 'score_10_of_10']);

/** The full shield implementation behind the ingestion port. */
export const fullShield: ShieldPorts = {
  scanHidden(input) {
    if (input.fileType === 'docx') return input.docxParts ? detectHiddenDocx(input.docxParts) : [];
    const items = (input.pdfItems ?? []).map((i) => ({
      page: i.page,
      str: i.str,
      fontSize: i.fontSize,
      x: i.x,
      y: i.y,
      pageWidth: i.pageWidth,
      pageHeight: i.pageHeight,
    }));
    return detectHiddenPdf(items, input.pdfMetadata ?? '');
  },
  scanInjection(text) {
    // Only real instruction-style phrases flag a resume. Invisible characters from PDF/Word export, long URLs,
    // "10/10 customer rating" and similar ordinary resume content are too noisy to mark a candidate as flagged.
    const findings = scanInjection(text).findings.filter((f) => !NOISY_RULES.has(f.rule));
    return { count: findings.length };
  },
  redact(text, fileName) {
    return redact(text, fileName);
  },
};

/** Call once at boot (server.ts) and in tests that need the real shield. */
export function installShield(): void {
  setShield(fullShield);
}

export { scanInjection, detectHiddenDocx, detectHiddenPdf, redact };
