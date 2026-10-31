import { detectHiddenDocx } from './hiddenDocx';
import { detectHiddenPdf } from './hiddenPdf';
import { scanInjection } from './injection';
import { redact } from '../redaction';
import { setShield } from '../../services/ingestion/shieldAdapter';
import type { ShieldPorts } from '../../services/ingestion/shieldAdapter';

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
    return { count: scanInjection(text).count };
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
