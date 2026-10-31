/**
 * PURE. One premium, brand-matched HTML shell shared by every email (meeting invites, candidate replies, HR sign-in code).
 * Table based with inline styles so it renders the same in Gmail, Outlook and Apple Mail. Colours match the web app.
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const e = escapeHtml;

export const BRAND = {
  name: 'Hirenex',
  ink: '#0b0d12',
  inkSoft: '#181c25',
  primary: '#2f5fd6',
  primaryLight: '#5b8cff',
  text: '#12151c',
  muted: '#5a6072',
  line: '#e3e7ef',
  canvas: '#eef1f6',
  panel: '#f6f8fc',
} as const;

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif`;
const MONO = `'SFMono-Regular',Menlo,Consolas,'Courier New',monospace`;

export interface DetailRow { label: string; value: string }
export interface Cta { href: string; label: string; /** Optional second line under the button, e.g. "or copy this link". */ showLink?: boolean }

export interface LayoutParts {
  /** Hidden inbox preview line. */
  preheader: string;
  /** Small uppercase line above the title. */
  eyebrow?: string;
  title: string;
  /** Plain paragraphs (escaped here). Blank line = new paragraph. */
  body: string;
  details?: DetailRow[];
  /** Primary button, bulletproof. */
  cta?: Cta;
  /** Extra buttons rendered as quiet outlined links (accept / decline flows). */
  secondary?: { href: string; label: string }[];
  /** Short note under everything, e.g. "Please join 2 minutes early". */
  note?: string;
  /** Sender line in the footer, e.g. "Acme Hiring Team". */
  sender?: string;
  footer?: string;
  /** Shown big and centred instead of a button, for sign-in codes. */
  code?: string;
}

function paragraphs(s: string): string {
  return s
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:26px;color:${BRAND.text}">${e(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto"><tr><td align="center" bgcolor="${BRAND.primary}" style="border-radius:10px;background:${BRAND.primary};background-image:linear-gradient(135deg,${BRAND.primaryLight},${BRAND.primary})">` +
    `<a href="${e(href)}" target="_blank" style="display:inline-block;padding:16px 40px;font-family:${FONT};font-size:16px;font-weight:700;letter-spacing:.2px;color:#ffffff;text-decoration:none;border-radius:10px">${e(label)}</a></td></tr></table>`;
}

function details(rows: DetailRow[]): string {
  const tr = rows
    .map((r, i) => `<tr><td style="padding:12px 0;${i ? `border-top:1px solid ${BRAND.line};` : ''}font-family:${FONT};font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};width:34%;vertical-align:top">${e(r.label)}</td>` +
      `<td style="padding:12px 0;${i ? `border-top:1px solid ${BRAND.line};` : ''}font-family:${FONT};font-size:15px;font-weight:600;color:${BRAND.text};vertical-align:top">${e(r.value)}</td></tr>`)
    .join('');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 28px;background:${BRAND.panel};border:1px solid ${BRAND.line};border-radius:12px"><tr><td style="padding:8px 22px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${tr}</table></td></tr></table>`;
}

export function renderLayout(p: LayoutParts): string {
  const eyebrow = p.eyebrow ? `<div style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND.primaryLight};margin:0 0 10px">${e(p.eyebrow)}</div>` : '';
  const code = p.code
    ? `<div style="margin:8px 0 28px;padding:22px;text-align:center;background:${BRAND.panel};border:1px solid ${BRAND.line};border-radius:12px;font-family:${MONO};font-size:36px;font-weight:700;letter-spacing:10px;color:${BRAND.ink}">${e(p.code)}</div>`
    : '';
  const cta = p.cta
    ? `<div style="margin:4px 0 ${p.cta.showLink ? '14' : '28'}px;text-align:center">${button(p.cta.href, p.cta.label)}</div>` +
      (p.cta.showLink
        ? `<div style="margin:0 0 28px;text-align:center;font-family:${FONT};font-size:12px;color:${BRAND.muted}">Or copy this link into your browser<br><a href="${e(p.cta.href)}" target="_blank" style="font-family:${MONO};font-size:13px;color:${BRAND.primary};text-decoration:none;word-break:break-all">${e(p.cta.href)}</a></div>`
        : '')
    : '';
  const secondary = p.secondary?.length
    ? `<div style="margin:0 0 24px;text-align:center">${p.secondary.map((s) => `<a href="${e(s.href)}" target="_blank" style="display:inline-block;margin:4px 6px;padding:10px 18px;border:1px solid ${BRAND.line};border-radius:8px;font-family:${FONT};font-size:14px;font-weight:600;color:${BRAND.text};text-decoration:none">${e(s.label)}</a>`).join('')}</div>`
    : '';
  const note = p.note ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:14px;line-height:22px;color:${BRAND.muted}">${e(p.note)}</p>` : '';
  const sender = p.sender ? `<p style="margin:20px 0 0;font-family:${FONT};font-size:15px;font-weight:600;color:${BRAND.text}">${e(p.sender)}</p>` : '';
  const footer = p.footer ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;color:#8b91a3">${e(p.footer)}</p>` : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${e(p.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:${BRAND.canvas}">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${e(p.preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${BRAND.canvas}" style="background:${BRAND.canvas}"><tr><td align="center" style="padding:32px 12px">` +
    `<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px">` +
    // Header
    `<tr><td style="background:${BRAND.ink};background-image:linear-gradient(135deg,${BRAND.ink},${BRAND.inkSoft});border-radius:16px 16px 0 0;padding:28px 36px 30px">` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>` +
    `<td style="font-family:${FONT};font-size:20px;font-weight:800;letter-spacing:.3px;color:#ffffff"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${BRAND.primaryLight};margin-right:10px"></span>${e(BRAND.name)}</td></tr></table>` +
    `<div style="height:1px;background:#232733;margin:22px 0"></div>${eyebrow}` +
    `<h1 style="margin:0;font-family:${FONT};font-size:28px;line-height:36px;font-weight:700;color:#ffffff;letter-spacing:-.3px">${e(p.title)}</h1></td></tr>` +
    // Body
    `<tr><td style="background:#ffffff;padding:34px 36px 30px;border-left:1px solid ${BRAND.line};border-right:1px solid ${BRAND.line};font-family:${FONT}">` +
    `${paragraphs(p.body)}${p.details?.length ? details(p.details) : ''}${code}${cta}${secondary}${note}${sender}</td></tr>` +
    // Footer
    `<tr><td style="background:${BRAND.panel};border:1px solid ${BRAND.line};border-top:0;border-radius:0 0 16px 16px;padding:20px 36px;text-align:center">${footer}` +
    `<p style="margin:0;font-family:${FONT};font-size:12px;color:#8b91a3">Sent with ${e(BRAND.name)}</p></td></tr>` +
    `</table></td></tr></table></body></html>`;
}
