// ============================================================
//  VallorSoft — lib/mailStyle.js
//  Az AI-chatből küldött levelek KINÉZETE (színek + elrendezés), amit a
//  felhasználó a chatben állít („legyen kék", „középre", „fejléc-sávval"),
//  és alapértelmezettként elmenthet. Megbízhatatlan bemenet → szigorú
//  fehérlista: csak #rrggbb színek és felsorolt elrendezés-értékek kerülnek
//  a HTML-be (nincs CSS-/markup-injekció).
// ============================================================
'use strict';

const HEX = /^#[0-9a-f]{6}$/i;
const ENUMS = {
  align: ['left', 'center'],
  // logo = logó (vagy cégnév, ha nincs logó) · band = színes sáv a logóval ·
  // name = csak a cégnév · logo_name = logó + cégnév · none = nincs fejléc
  header: ['logo', 'band', 'name', 'logo_name', 'none'],
  font: ['sans', 'serif', 'modern', 'mono'],
  width: ['narrow', 'normal', 'wide'],
  border_width: ['none', 'thin', 'normal', 'thick'],
  radius: ['none', 'small', 'large'],
  size: ['small', 'normal', 'large'],
  line: ['tight', 'normal', 'loose'],
};
const FONTS = { sans: 'Arial,Helvetica,sans-serif', serif: 'Georgia,"Times New Roman",serif', modern: '"Segoe UI",Verdana,Tahoma,sans-serif', mono: '"Courier New",Courier,monospace' };
const BORDER_W = { none: 0, thin: 1, normal: 2, thick: 4 };
const RADII = { none: 0, small: 6, large: 16 };
const SIZES = { small: 13, normal: 14, large: 16 };
const LINES = { tight: 1.35, normal: 1.6, loose: 1.9 };
const COLOR_KEYS = ['accent', 'bg', 'text', 'card', 'border', 'logo_bg', 'title'];
const WIDTHS = { narrow: 480, normal: 560, wide: 680 };

function _hex(v) { const s = String(v || '').trim(); return HEX.test(s) ? s.toLowerCase() : null; }

// Részleges stílus (csak az érvényes kulcsok maradnak). null, ha üres.
function sanitizeStyle(st) {
  if (!st || typeof st !== 'object') return null;
  const out = {};
  COLOR_KEYS.forEach((k) => { const h = _hex(st[k]); if (h) out[k] = h; });
  Object.keys(ENUMS).forEach((k) => { if (ENUMS[k].includes(st[k])) out[k] = st[k]; });
  return Object.keys(out).length ? out : null;
}

function mergeStyle(base, over) {
  const a = sanitizeStyle(base) || {};
  const b = sanitizeStyle(over) || {};
  return sanitizeStyle(Object.assign({}, a, b));
}

// ─── Kontraszt (WCAG): a szöveg mindig olvasható legyen a háttéren ───
function _lum(hex) {
  const h = _hex(hex); if (!h) return 1;
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const x = _lum(a), y = _lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
// A legjobban olvasható szövegszín az adott háttéren (sötét vagy fehér).
function readableOn(bg) { return contrast('#111827', bg) >= contrast('#ffffff', bg) ? '#111827' : '#ffffff'; }
// A kért szövegszín, ha elég kontrasztos (≥ 4.5), különben a legjobban olvasható.
function ensureText(text, bg, min) {
  const t = _hex(text);
  return t && contrast(t, bg) >= (min || 4.5) ? t : readableOn(bg);
}

function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

// A levél törzsét (megbízható, már escape-elt HTML) a stílus szerinti keretbe teszi.
//   opts: { logoUrl, senderName }
function renderStyled(bodyHtml, style, opts) {
  const s = sanitizeStyle(style) || {};
  opts = opts || {};
  const accent = s.accent || '#f6711e';
  const bg = s.bg || '#ffffff';
  const card = s.card || '#ffffff';
  const text = ensureText(s.text || '#2a2018', card);
  const bandText = readableOn(accent);
  // A link-szín is legyen olvasható a levél hátterén.
  const linkColor = contrast(accent, card) >= 3 ? accent : text;
  const align = s.align === 'center' ? 'center' : 'left';
  const font = FONTS[s.font] || FONTS.sans;
  const width = WIDTHS[s.width] || WIDTHS.normal;
  const size = SIZES[s.size] || SIZES.normal;
  const line = LINES[s.line] || LINES.normal;
  const radius = RADII[s.radius] != null ? RADII[s.radius] : 10;
  const bw = s.border_width ? BORDER_W[s.border_width] : (s.border ? 2 : 0);
  const border = bw ? 'border:' + bw + 'px solid ' + (s.border || accent) + ';' : '';
  const titleColor = s.title ? ensureText(s.title, card, 3) : text;
  const name = opts.senderName || 'VallorSoft';
  const logo = opts.logoUrl && /^(https?:\/\/|data:image\/|\/branding\/logo\/\d+\.png$)/i.test(String(opts.logoUrl)) ? String(opts.logoUrl) : null;
  const imgTag = logo ? '<img src="' + _esc(logo) + '" alt="' + _esc(name) + '" style="max-height:44px;max-width:200px;border:0;display:inline-block;vertical-align:middle;">' : '';
  const nameTag = (c) => '<span style="font-size:20px;font-weight:800;color:' + c + ';vertical-align:middle;">' + _esc(name) + '</span>';
  // A logó mögé kért háttér (pl. sötét logó világos sávon / fordítva).
  const logoBox = (inner) => (s.logo_bg || s.header === 'band')
    ? '<span style="display:inline-block;background:' + (s.logo_bg || '#ffffff') + ';padding:6px 12px;border-radius:8px;">' + inner + '</span>'
    : inner;
  const hdr = s.header || 'logo';
  const onBand = hdr === 'band';
  const nameColor = onBand ? bandText : titleColor;
  let headInner = '';
  if (hdr === 'name') headInner = nameTag(nameColor);
  else if (hdr === 'logo_name') headInner = (imgTag ? logoBox(imgTag) + '<span style="display:inline-block;width:12px;"></span>' : '') + nameTag(nameColor);
  else if (hdr !== 'none') headInner = imgTag ? logoBox(imgTag) : nameTag(nameColor);
  let header = '';
  if (onBand) {
    header = '<div style="background:' + accent + ';color:' + bandText + ';padding:16px 22px;text-align:' + align + ';border-radius:' + radius + 'px ' + radius + 'px 0 0;">' + headInner + '</div>';
  } else if (headInner) {
    header = '<div style="padding:18px 22px 6px;text-align:' + align + ';color:' + text + ';">' + headInner + '</div>'
      + '<div style="height:3px;background:' + accent + ';margin:8px 22px 0;"></div>';
  }
  return '<div style="background:' + bg + ';padding:20px 10px;">'
    + '<div style="max-width:' + width + 'px;margin:0 auto;background:' + card + ';border-radius:' + radius + 'px;' + border + 'font-family:' + font + ';color:' + text + ';overflow:hidden;">'
    + header
    + '<div style="padding:20px 22px;font-size:' + size + 'px;line-height:' + line + ';text-align:' + align + ';color:' + text + ';">'
    + String(bodyHtml || '').replace(/<a (?!href="[^"]*" style=)/g, '<a style="color:' + linkColor + ';" ')
    + '</div></div></div>';
}

// ─── KÖTELEZŐ céges lábléc minden kimenő levél alján (a decont-nyomtatványok
//     fejlécének mintájára: logó + cégnév + CUI · J · ☏ · ✉ + cím). Mindig
//     világos háttér + sötét szöveg → bármilyen levél-kinézet mellett olvasható.
const FOOTER_MARK = '<!--vs-company-footer-->';
function companyFooterHtml(c, logoUrl) {
  c = c || {};
  const name = c.nev ? String(c.nev) : '';
  if (!name) return '';
  const meta = [
    c.cui ? 'CUI ' + c.cui : null,
    c.reg_com ? c.reg_com : null,
    c.telefon ? '☏ ' + c.telefon : null,
    c.email_contact ? '✉ ' + c.email_contact : null,
    c.website ? c.website : null,
  ].filter(Boolean).map(_esc).join(' · ');
  const logo = logoUrl && /^https?:\/\//i.test(String(logoUrl))
    ? '<td style="padding:0 14px 0 0;vertical-align:middle;width:1%;"><img src="' + _esc(logoUrl) + '" alt="' + _esc(name) + '" style="max-height:38px;max-width:120px;border:0;display:block;"></td>'
    : '';
  return FOOTER_MARK
    + '<div style="max-width:680px;margin:14px auto 0;padding:0 10px;">'
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f3f4f6;border-top:2px solid #1f2937;border-radius:0 0 8px 8px;">'
    + '<tr><td style="padding:12px 16px;"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>' + logo
    + '<td style="vertical-align:middle;font-family:Arial,Helvetica,sans-serif;color:#111827;">'
    + '<div style="font-size:13px;font-weight:800;color:#111827;">' + _esc(name) + '</div>'
    + (meta ? '<div style="font-size:11.5px;color:#374151;margin-top:2px;">' + meta + '</div>' : '')
    + (c.adresa ? '<div style="font-size:11.5px;color:#374151;margin-top:2px;">' + _esc(c.adresa) + '</div>' : '')
    + '</td></tr></table></td></tr></table></div>';
}
function hasFooter(html) { return String(html || '').indexOf(FOOTER_MARK) >= 0; }

module.exports = { sanitizeStyle, mergeStyle, renderStyled, contrast, readableOn, ensureText, companyFooterHtml, hasFooter };
