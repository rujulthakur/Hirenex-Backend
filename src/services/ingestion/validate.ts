import JSZip from 'jszip';
import { extname } from 'node:path';
import type { FileType } from '../../types/enums';

/** DOCX zip-bomb guards (Prompt 15 re-checks these). */
export const DOCX_MAX_ENTRIES = 300;
export const DOCX_MAX_UNCOMPRESSED_BYTES = 30 * 1024 * 1024;

export type ValidationResult =
  | { ok: true; fileType: FileType }
  | { ok: false; reason: string };

const PDF_MAGIC = Buffer.from('%PDF');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** PURE. Maps a file name to the type it claims to be, or null when the extension is not allowed. */
export function claimedType(fileName: string): FileType | null {
  const ext = extname(fileName).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  return null;
}

/** PURE. PDFs start with %PDF (a few leading bytes of whitespace are tolerated by readers; we require the first 1 KB). */
export function hasPdfMagic(buf: Buffer): boolean {
  if (buf.length < 5) return false;
  return buf.subarray(0, 1024).indexOf(PDF_MAGIC) !== -1;
}

export function hasZipMagic(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).equals(ZIP_MAGIC);
}

/**
 * Validates by extension AND magic bytes. DOCX must be a zip that contains word/document.xml, with caps on
 * entry count and declared uncompressed size so a zip bomb is rejected before any text is extracted.
 */
export async function validateUpload(fileName: string, buf: Buffer): Promise<ValidationResult> {
  const claimed = claimedType(fileName);
  if (!claimed) return { ok: false, reason: 'Only .pdf and .docx files are accepted' };
  if (buf.length === 0) return { ok: false, reason: 'File is empty' };

  if (claimed === 'pdf') {
    return hasPdfMagic(buf)
      ? { ok: true, fileType: 'pdf' }
      : { ok: false, reason: 'File content is not a PDF (extension and content disagree)' };
  }

  if (!hasZipMagic(buf)) return { ok: false, reason: 'File content is not a DOCX (extension and content disagree)' };
  try {
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);
    if (names.length > DOCX_MAX_ENTRIES) return { ok: false, reason: 'DOCX has too many internal entries' };
    if (!names.includes('word/document.xml')) return { ok: false, reason: 'File is not a valid DOCX (word/document.xml missing)' };
    let declared = 0;
    for (const name of names) {
      const entry = zip.files[name] as unknown as { _data?: { uncompressedSize?: number } };
      declared += entry._data?.uncompressedSize ?? 0;
    }
    if (declared > DOCX_MAX_UNCOMPRESSED_BYTES) return { ok: false, reason: 'DOCX expands to an unsafe size' };
    return { ok: true, fileType: 'docx' };
  } catch {
    return { ok: false, reason: 'File is corrupted and could not be opened' };
  }
}
