import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { buildContent } from './resumeContent';
import type { ResumeSpec } from './resumeSpecs';

/** Renders a spec to a REAL file buffer (PDF via pdfkit, DOCX via docx). Deterministic: no timestamps in the text. */

function pdfToBuffer(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: 'Synthetic demo resume' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });
}

export async function renderPdf(spec: ResumeSpec): Promise<Buffer> {
  if (spec.kind === 'image_only') return renderImageOnlyPdf();
  const c = buildContent(spec);
  return pdfToBuffer((doc) => {
    doc.fontSize(20).text(c.name);
    doc.fontSize(10).text(c.contact).moveDown();
    doc.fontSize(12).text('Summary', { underline: true }).fontSize(11).text(c.summary).moveDown();
    doc.fontSize(12).text('Skills', { underline: true }).fontSize(11).text(c.skillsLine).moveDown();
    doc.fontSize(12).text('Experience', { underline: true }).fontSize(11).text(c.experienceHeading);
    for (const b of c.bullets) doc.text(`- ${b}`);
    doc.moveDown().fontSize(12).text('Education', { underline: true }).fontSize(11).text(c.education);
    if (c.extras.length > 0) {
      doc.moveDown().fontSize(12).text('Additional', { underline: true }).fontSize(11);
      for (const e of c.extras) doc.text(e);
    }
  });
}

/** Vector shapes only, no text layer: behaves like a scanned page, so extraction returns (almost) nothing. */
export async function renderImageOnlyPdf(): Promise<Buffer> {
  return pdfToBuffer((doc) => {
    doc.rect(56, 56, 480, 40).fill('#d9d9d9');
    for (let i = 0; i < 18; i += 1) doc.rect(56, 120 + i * 24, 300 + ((i * 37) % 180), 10).fill('#bdbdbd');
  });
}

export async function renderDocx(spec: ResumeSpec): Promise<Buffer> {
  const c = buildContent(spec);
  const para = (text: string): Paragraph => new Paragraph({ children: [new TextRun(text)] });
  const head = (text: string): Paragraph => new Paragraph({ text, heading: HeadingLevel.HEADING_2 });
  const children: Paragraph[] = [
    new Paragraph({ text: c.name, heading: HeadingLevel.TITLE }),
    para(c.contact),
    head('Summary'),
    para(c.summary),
    head('Skills'),
    para(c.skillsLine),
    head('Experience'),
    para(c.experienceHeading),
    ...c.bullets.map((b) => para(`- ${b}`)),
    head('Education'),
    para(c.education),
  ];
  if (c.extras.length > 0) children.push(head('Additional'), ...c.extras.map(para));
  if (spec.hiddenText) {
    // White colour, 1 pt (size is in half-points): invisible to a human reader, visible to a parser.
    children.push(new Paragraph({ children: [new TextRun({ text: spec.hiddenText, color: 'FFFFFF', size: 2 })] }));
  }
  const doc = new Document({ creator: 'Synthetic demo', sections: [{ children }] });
  return Packer.toBuffer(doc);
}

export async function renderResume(spec: ResumeSpec): Promise<Buffer> {
  return spec.fileType === 'pdf' ? renderPdf(spec) : renderDocx(spec);
}
