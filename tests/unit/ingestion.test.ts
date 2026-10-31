import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { hashText, isUnreadable, normalizeText, MIN_READABLE_CHARS } from '../../src/domain/text';
import { claimedType, validateUpload } from '../../src/services/ingestion/validate';

async function makeDocx(withDocumentXml = true): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  if (withDocumentXml) zip.file('word/document.xml', '<w:document/>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('text normalisation', () => {
  it('applies NFKC, collapses whitespace and strips NUL', () => {
    expect(normalizeText('Ｊｏｂ\u0000   title \r\n\r\n\r\n\r\nnext')).toBe('Job title\n\nnext');
  });
  it('hashes identical normalised text identically', () => {
    expect(hashText(normalizeText('a  b'))).toBe(hashText(normalizeText('a b')));
    expect(hashText('x')).toHaveLength(64);
  });
  it('flags short text as unreadable', () => {
    expect(isUnreadable('x'.repeat(MIN_READABLE_CHARS - 1))).toBe(true);
    expect(isUnreadable('x'.repeat(MIN_READABLE_CHARS))).toBe(false);
  });
});

describe('upload validation', () => {
  it('maps extensions', () => {
    expect(claimedType('A.PDF')).toBe('pdf');
    expect(claimedType('a.docx')).toBe('docx');
    expect(claimedType('a.exe')).toBeNull();
  });
  it('accepts a PDF by magic bytes', async () => {
    expect(await validateUpload('cv.pdf', Buffer.from('%PDF-1.4\n...'))).toEqual({ ok: true, fileType: 'pdf' });
  });
  it('rejects an exe renamed to .pdf', async () => {
    const r = await validateUpload('cv.pdf', Buffer.from('MZ\x90\x00 fake exe'));
    expect(r.ok).toBe(false);
  });
  it('rejects a disallowed extension', async () => {
    expect((await validateUpload('cv.exe', Buffer.from('%PDF-1.4'))).ok).toBe(false);
  });
  it('accepts a real DOCX zip', async () => {
    expect(await validateUpload('cv.docx', await makeDocx())).toEqual({ ok: true, fileType: 'docx' });
  });
  it('rejects a zip without word/document.xml', async () => {
    expect((await validateUpload('cv.docx', await makeDocx(false))).ok).toBe(false);
  });
  it('rejects a corrupted DOCX and an empty file', async () => {
    expect((await validateUpload('cv.docx', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('garbage')]))).ok).toBe(false);
    expect((await validateUpload('cv.pdf', Buffer.alloc(0))).ok).toBe(false);
  });
});
