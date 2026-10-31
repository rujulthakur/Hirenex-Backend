import type { HiddenFindingType } from '../../types/enums';

/**
 * PURE. Finds text a human reader cannot see in a DOCX but an LLM would read.
 * Input: raw XML parts (word/document.xml, comments, headers, footers, docProps/*).
 * Assumes a WHITE page. White text on a dark shading fill is treated as visible.
 */
export interface DocxHiddenFinding {
  type: HiddenFindingType;
  text: string;
  location: string;
}

const WHITE_DISTANCE = 40; // max per-channel distance from FFFFFF treated as "white"
const MIN_HALF_POINTS = 12; // w:sz below 12 half-points = under 6 pt
const MAX_TEXT = 500;

const RUN_RE = /<w:r[ >][\s\S]*?<\/w:r>/g;
const TEXT_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function runText(xml: string): string {
  const out: string[] = [];
  const re = new RegExp(TEXT_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(decodeXml(m[1] ?? ''));
  return out.join('').trim();
}

function attr(tag: string | undefined, name: string): string | undefined {
  if (!tag) return undefined;
  const m = new RegExp(`${name}="([^"]*)"`, 'i').exec(tag);
  return m?.[1];
}

function parseHex(v: string | undefined): [number, number, number] | null {
  if (!v || !/^[0-9a-f]{6}$/i.test(v)) return null;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

/** PURE. True when the colour is white or within WHITE_DISTANCE of it on every channel. */
export function isNearWhite(hex: string | undefined): boolean {
  const rgb = parseHex(hex);
  return rgb !== null && rgb.every((c) => 255 - c <= WHITE_DISTANCE);
}

function isDarkFill(hex: string | undefined): boolean {
  const rgb = parseHex(hex);
  return rgb !== null && !rgb.every((c) => 255 - c <= 90);
}

function clip(s: string): string {
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}...` : s;
}

function inspectRuns(xml: string, part: string): DocxHiddenFinding[] {
  const out: DocxHiddenFinding[] = [];
  const runRe = new RegExp(RUN_RE.source, 'g');
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = runRe.exec(xml)) !== null) {
    idx += 1;
    const run = m[0];
    const text = runText(run);
    if (text.length === 0) continue;
    const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1] ?? '';
    const location = `${part} run ${idx}`;

    const colorTag = /<w:color\b[^>]*>/.exec(rPr)?.[0];
    const colorVal = attr(colorTag, 'w:val');
    const themeColor = attr(colorTag, 'w:themeColor');
    const shdTag = /<w:shd\b[^>]*>/.exec(rPr)?.[0];
    const fill = attr(shdTag, 'w:fill');
    const whiteByTheme = themeColor !== undefined && /^(background1|bg1|light1|lt1)$/i.test(themeColor) && !/tint|shade/i.test(colorTag ?? '');
    const white = isNearWhite(colorVal) || whiteByTheme;
    if (white && !isDarkFill(fill)) {
      out.push({ type: 'white_text', text: clip(text), location });
    }

    const szTag = /<w:sz\b[^>]*>/.exec(rPr)?.[0];
    const sz = Number(attr(szTag, 'w:val'));
    if (szTag && Number.isFinite(sz) && sz > 0 && sz < MIN_HALF_POINTS) {
      out.push({ type: 'tiny_font', text: clip(text), location });
    }

    const vanishTag = /<w:vanish\b[^>]*\/?>/.exec(rPr)?.[0];
    if (vanishTag) {
      const v = attr(vanishTag, 'w:val');
      if (v === undefined || !/^(0|false|off)$/i.test(v)) out.push({ type: 'vanish', text: clip(text), location });
    }
  }
  return out;
}

function allText(xml: string): string {
  return runText(xml);
}

function customPropertyValues(xml: string): string {
  const vals: string[] = [];
  const re = /<vt:lpwstr>([\s\S]*?)<\/vt:lpwstr>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) vals.push(decodeXml(m[1] ?? '').trim());
  return vals.filter((v) => v.length > 0).join(' | ');
}

export function detectHiddenDocx(parts: Record<string, string>): DocxHiddenFinding[] {
  const out: DocxHiddenFinding[] = [];
  for (const [name, xml] of Object.entries(parts)) {
    if (name === 'word/document.xml') {
      out.push(...inspectRuns(xml, name));
    } else if (name === 'word/comments.xml') {
      const t = allText(xml);
      if (t) out.push({ type: 'comment', text: clip(t), location: name });
    } else if (/^word\/(header|footer)\d*\.xml$/.test(name)) {
      out.push(...inspectRuns(xml, name));
      const t = allText(xml);
      if (t) out.push({ type: 'header_footer', text: clip(t), location: name });
    } else if (name === 'word/footnotes.xml' || name === 'word/endnotes.xml') {
      out.push(...inspectRuns(xml, name));
    } else if (name === 'docProps/custom.xml') {
      const t = customPropertyValues(xml);
      if (t) out.push({ type: 'doc_property', text: clip(t), location: name });
    }
  }
  return out;
}
