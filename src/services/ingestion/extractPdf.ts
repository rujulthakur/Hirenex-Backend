import pdfParse from 'pdf-parse';

/** One text run from pdfjs, kept for the PDF hidden-text detector (Prompt 7). */
export interface PdfTextItem {
  page: number;
  str: string;
  fontSize: number;
  x: number;
  y: number;
  pageWidth: number;
  pageHeight: number;
}

export interface PdfExtraction {
  text: string;
  items: PdfTextItem[];
  metadata: string;
  pageCount: number;
  usedFallback: boolean;
}

interface PdfjsItem {
  str?: string;
  transform?: number[];
  height?: number;
}
interface PdfjsPage {
  getTextContent(): Promise<{ items: PdfjsItem[] }>;
  getViewport(opts: { scale: number }): { width: number; height: number };
}
interface PdfjsDoc {
  numPages: number;
  getPage(n: number): Promise<PdfjsPage>;
  getMetadata(): Promise<{ info?: Record<string, unknown>; metadata?: { getRaw?: () => string } | null }>;
  destroy(): Promise<void>;
}
interface PdfjsLib {
  getDocument(src: Record<string, unknown>): { promise: Promise<PdfjsDoc> };
}

const MAX_PAGES = 12;

async function loadPdfjs(): Promise<PdfjsLib> {
  const mod = (await import('pdfjs-dist/legacy/build/pdf.js')) as unknown as { default?: PdfjsLib } & PdfjsLib;
  return mod.default ?? mod;
}

/** Primary path: pdfjs-dist (text + font size + position). Falls back to pdf-parse plain text if pdfjs fails. */
export async function extractPdf(buf: Buffer): Promise<PdfExtraction> {
  try {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buf),
      disableFontFace: true,
      useSystemFonts: false,
      isEvalSupported: false,
      verbosity: 0,
    }).promise;
    const items: PdfTextItem[] = [];
    const pageTexts: string[] = [];
    const pages = Math.min(doc.numPages, MAX_PAGES);
    for (let p = 1; p <= pages; p += 1) {
      const page = await doc.getPage(p);
      const view = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const parts: string[] = [];
      for (const it of content.items) {
        const str = it.str ?? '';
        if (!str) continue;
        const t = it.transform ?? [1, 0, 0, 1, 0, 0];
        const fontSize = Math.abs(it.height && it.height > 0 ? it.height : (t[3] ?? 0));
        items.push({ page: p, str, fontSize, x: t[4] ?? 0, y: t[5] ?? 0, pageWidth: view.width, pageHeight: view.height });
        parts.push(str);
      }
      pageTexts.push(parts.join(' '));
    }
    let metadata = '';
    try {
      const meta = await doc.getMetadata();
      const info = meta.info ? Object.values(meta.info).filter((v): v is string => typeof v === 'string').join(' | ') : '';
      const xmp = meta.metadata?.getRaw?.() ?? '';
      metadata = `${info} ${xmp}`.trim();
    } catch {
      metadata = '';
    }
    const pageCount = doc.numPages;
    await doc.destroy();
    return { text: pageTexts.join('\n'), items, metadata, pageCount, usedFallback: false };
  } catch {
    const parsed = await pdfParse(buf);
    return { text: parsed.text ?? '', items: [], metadata: '', pageCount: parsed.numpages ?? 0, usedFallback: true };
  }
}
