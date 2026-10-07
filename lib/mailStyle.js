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
  header: ['logo', 'band', 'none'],
  font: ['sans', 'serif'],
  width: ['narrow', 'normal', 'wide'],
};
const FONTS = { sans: 'Arial,Helvetica,sans-serif', serif: 'Georgia,"Times New Roman",serif' };
const WIDTHS = { narrow: 480, normal: 560, wide: 680 };

function _hex(v) { const s = String(v || '').trim(); return HEX.test(s) ? s.toLowerCase() : null; }

// Részleges stílus (csak az érvényes kulcsok maradnak). null, ha üres.
function sanitizeStyle(st) {
  if (!st || typeof st !== 'object') return null;
  const out = {};
  ['accent', 'bg', 'text', 'card'].forEach((k) => { const h = _hex(st[k]); if (h) out[k] = h; });
  Object.keys(ENUMS).forEach((k) => { if (ENUMS[k].includes(st[k])) out[k] = st[k]; });
  return Object.keys(out).length ? out : null;
}

function mergeStyle(base, over) {
  const a = sanitizeStyle(base) || {};
  const b = sanitizeStyle(over) || {};
  return sanitizeStyle(Object.assign({}, a, b));
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
  const text = s.text || '#2a2018';
  const align = s.align === 'center' ? 'center' : 'left';
  const font = FONTS[s.font] || FONTS.sans;
  const width = WIDTHS[s.width] || WIDTHS.normal;
  const name = opts.senderName || 'VallorSoft';
  const logo = opts.logoUrl && /^(https?:\/\/|data:image\/)/i.test(String(opts.logoUrl)) ? String(opts.logoUrl) : null;
  const logoHtml = logo
    ? '<img src="' + _esc(logo) + '" alt="' + _esc(name) + '" style="max-height:44px;max-width:200px;border:0;' + (align === 'center' ? 'display:inline-block;' : 'display:block;') + '">'
    : '<span style="font-size:20px;font-weight:800;">' + _esc(name) + '</span>';
  let header = '';
  if (s.header === 'band') {
    header = '<div style="background:' + accent + ';color:#ffffff;padding:16px 22px;text-align:' + align + ';border-radius:10px 10px 0 0;">'
      + (logo ? '<span style="display:inline-block;background:#ffffff;padding:6px 12px;border-radius:8px;">' + logoHtml + '</span>' : logoHtml) + '</div>';
  } else if (s.header !== 'none') {
    header = '<div style="padding:18px 22px 6px;text-align:' + align + ';color:' + text + ';">' + logoHtml + '</div>'
      + '<div style="height:3px;background:' + accent + ';margin:8px 22px 0;"></div>';
  }
  return '<div style="background:' + bg + ';padding:20px 10px;">'
    + '<div style="max-width:' + width + 'px;margin:0 auto;background:' + card + ';border-radius:10px;font-family:' + font + ';color:' + text + ';">'
    + header
    + '<div style="padding:20px 22px;font-size:14px;line-height:1.6;text-align:' + align + ';color:' + text + ';">'
    + String(bodyHtml || '').replace(/<a /g, '<a style="color:' + accent + ';" ')
    + '</div></div></div>';
}

module.exports = { sanitizeStyle, mergeStyle, renderStyled };
