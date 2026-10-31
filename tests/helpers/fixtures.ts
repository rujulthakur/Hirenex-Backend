import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun } from 'docx';

const RESUME_LINES = [
  'Summary: Backend engineer with five years of experience building Node.js and TypeScript services.',
  'Experience: Built REST APIs with Express and MongoDB, reduced p95 latency by 40 percent.',
  'Projects: Interview scheduling engine with atomic slot booking and a hash chained audit log.',
  'Skills: TypeScript, Node.js, MongoDB, Redis, Docker, testing with Vitest and Supertest.',
  'Education: Bachelor of Technology in Computer Science.',
];

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** A real text PDF with enough readable characters (> 200). `tag` makes the text unique. */
export async function makeTextPdf(tag = 'A'): Promise<Buffer> {
  const doc = new PDFDocument();
  doc.fontSize(12).text(`Candidate ${tag}`);
  RESUME_LINES.forEach((l) => doc.text(l));
  return collect(doc);
}

/** An image-only style PDF: draws shapes but no text, so extraction yields nothing. */
export async function makeImageOnlyPdf(): Promise<Buffer> {
  const doc = new PDFDocument();
  doc.rect(50, 50, 300, 300).fill('#888888');
  return collect(doc);
}

/** A real DOCX with readable text. `tag` makes the text unique. */
export async function makeDocx(tag = 'B'): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun(`Candidate ${tag}`)] }),
          ...RESUME_LINES.map((l) => new Paragraph({ children: [new TextRun(l)] })),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** A Windows executable header renamed to .pdf (fails the magic-byte check). */
export function makeRenamedExe(): Buffer {
  return Buffer.concat([Buffer.from('MZ'), Buffer.alloc(400, 0x90)]);
}

/** Starts like a PDF but the body is garbage. */
export function makeCorruptedPdf(): Buffer {
  return Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('this is not a real pdf body '.repeat(20))]);
}
