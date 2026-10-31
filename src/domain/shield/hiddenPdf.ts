import type { HiddenFindingType } from '../../types/enums';
import { scanInjection } from './injection';

/**
 * PURE. Hidden-text detection for PDFs from pdfjs text items.
 *
 * Detects: font size under 4 pt, text positioned outside the page box, and instruction-like
 * content in Info/XMP metadata.
 *
 * HONEST LIMIT: pdfjs getTextContent does not expose fill colour, so white-on-white text in a PDF
 * is only caught indirectly (it is usually also tiny or off-page, and any injection phrase in the
 * extracted text is still caught by the injection scanner). Reading the operator list for fill
 * colour is a roadmap item; we do not claim it here.
 */
export interface PdfItemLike {
  page: number;
  str: string;
  fontSize: number;
  x: number;
  y: number;
  pageWidth: number;
  pageHeight: number;
}

export interface PdfHiddenFinding {
  type: HiddenFindingType;
  text: string;
  location: string;
}

export const PDF_MIN_FONT_PT = 4;
const OFFPAGE_MARGIN = 24; // a little slack: edge-aligned designs and rounding are normal
const MIN_TEXT = 3;
const MAX_TEXT = 500;

function clip(s: string): string {
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}...` : s;
}

function isOffPage(i: PdfItemLike): boolean {
  if (i.pageWidth <= 0 || i.pageHeight <= 0) return false;
  return (
    i.x < -OFFPAGE_MARGIN ||
    i.y < -OFFPAGE_MARGIN ||
    i.x > i.pageWidth + OFFPAGE_MARGIN ||
    i.y > i.pageHeight + OFFPAGE_MARGIN
  );
}

/** Groups the runs of one kind on one page into a single finding so HR sees one readable block. */
function group(items: PdfItemLike[], type: HiddenFindingType): PdfHiddenFinding[] {
  const byPage = new Map<number, string[]>();
  for (const i of items) {
    const arr = byPage.get(i.page) ?? [];
    arr.push(i.str.trim());
    byPage.set(i.page, arr);
  }
  return [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, strs]) => ({ type, text: clip(strs.join(' ')), location: `page ${page}` }));
}

export function detectHiddenPdf(items: readonly PdfItemLike[], metadata: string): PdfHiddenFinding[] {
  const real = items.filter((i) => i.str.trim().length >= MIN_TEXT);
  const tiny = real.filter((i) => i.fontSize > 0 && i.fontSize < PDF_MIN_FONT_PT);
  const offpage = real.filter((i) => !(i.fontSize > 0 && i.fontSize < PDF_MIN_FONT_PT) && isOffPage(i));

  const out: PdfHiddenFinding[] = [...group(tiny, 'tiny_font'), ...group(offpage, 'offpage')];

  if (metadata.trim().length > 0 && scanInjection(metadata).count > 0) {
    out.push({ type: 'metadata', text: clip(metadata.trim()), location: 'document metadata' });
  }
  return out;
}
