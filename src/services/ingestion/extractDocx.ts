import mammoth from 'mammoth';
import JSZip from 'jszip';

export interface DocxExtraction {
  text: string;
  /** Raw XML parts kept in memory for the DOCX hidden-text detector (Prompt 7). Never persisted. */
  parts: Record<string, string>;
}

const INSPECT_PART = /^word\/(document|comments|header\d*|footer\d*|footnotes|endnotes)\.xml$|^docProps\/(core|custom|app)\.xml$/;

/** mammoth for visible text; jszip for the XML parts the shield inspects later. */
export async function extractDocx(buf: Buffer): Promise<DocxExtraction> {
  const [raw, zip] = await Promise.all([mammoth.extractRawText({ buffer: buf }), JSZip.loadAsync(buf)]);
  const parts: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) {
    if (!INSPECT_PART.test(name)) continue;
    const file = zip.file(name);
    if (file) parts[name] = await file.async('string');
  }
  return { text: raw.value ?? '', parts };
}
