// ============================================================
//  VallorSoft — lib/mailBody.js
//  Az AI-chat levél-törzsének FORMÁZÁSA egy egyszerű, biztonságos jelöléssel
//  (nem nyers HTML-lel). Először MINDEN karakter escape-elődik, utána csak a
//  fehérlistás jelölések alakulnak HTML-lé → nincs markup-/CSS-injekció.
//
//  Jelölések (a promptban is ez a lista szerepel):
//   **félkövér**  *dőlt*  __aláhúzott__  ~~áthúzott~~
//   # Cím  ## Alcím  ### Kisebb cím        (sor elején)
//   - felsorolás   1. számozott          (sor elején)
//   > idézet                              (sor elején)
//   ---                                   (vízszintes vonal)
//   [color=#rrggbb]…[/color]  [bg=#rrggbb]…[/bg]
//   [size=small|normal|large|xl]…[/size]  [font=sans|serif|modern|mono]…[/font]
//   [center]…[/center]  [right]…[/right]
//   [box]…[/box]  [box color=#rrggbb]…[/box]   (keretes, színes doboz)
//   [btn url=https://…]Felirat[/btn]            (gomb)
//   [szöveg](https://…)                          (link)
//   {{cards}}                                    (a fuvarkártyák helye)
// ============================================================
'use strict';

const HEX = /^#[0-9a-f]{6}$/i;
const SIZES = { small: '12px', normal: '14px', large: '17px', xl: '21px' };
const FONTS = {
  sans: 'Arial,Helvetica,sans-serif',
  serif: 'Georgia,"Times New Roman",serif',
  modern: '"Segoe UI",Verdana,Tahoma,sans-serif',
  mono: '"Courier New",Courier,monospace',
};
const CARDS_MARK = '{{cards}}';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}
// Escape-elt szövegben a &amp; visszaalakítása az URL-ekhez nem kell: az URL-t
// escape-elve tesszük az attribútumba, csak a sémát ellenőrizzük.
function _safeUrl(u) {
  const s = String(u || '').replace(/&amp;/g, '&').trim();
  return /^(https?:\/\/|mailto:)[^\s<>"']+$/i.test(s) ? esc(s) : null;
}
function _hex(v) { const s = String(v || '').replace(/&#39;|&quot;/g, '').trim(); return HEX.test(s) ? s.toLowerCase() : null; }
// Halvány árnyalat (a szín 8%-a fehérrel keverve) — 6 jegyű hex, minden levelezőben működik.
function _tint(hex, p) {
  const h = _hex(hex) || '#2563eb'; const k = p == null ? 0.08 : p;
  return '#' + [1, 3, 5].map((i) => Math.round(255 - (255 - parseInt(h.slice(i, i + 2), 16)) * k).toString(16).padStart(2, '0')).join('');
}

// Soron belüli jelölések (az escape-elt szövegen).
function _inline(s, accent) {
  let t = s;
  t = t.replace(/\[btn url=([^\]\s]+)\]([\s\S]*?)\[\/btn\]/gi, (m, u, label) => {
    const url = _safeUrl(u);
    if (!url) return label;
    return '<a href="' + url + '" style="display:inline-block;background:' + (accent || '#2563eb') + ';color:#ffffff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px;">' + label + '</a>';
  });
  t = t.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g, (m, label, u) => {
    const url = _safeUrl(u);
    return url ? '<a href="' + url + '">' + label + '</a>' : m;
  });
  // Ismételten, hogy egymásba ágyazott jelölések is működjenek.
  for (let i = 0; i < 3; i++) {
    t = t.replace(/\[color=([^\]]+)\]([\s\S]*?)\[\/color\]/gi, (m, c, x) => { const h = _hex(c); return h ? '<span style="color:' + h + ';">' + x + '</span>' : x; });
    t = t.replace(/\[bg=([^\]]+)\]([\s\S]*?)\[\/bg\]/gi, (m, c, x) => { const h = _hex(c); return h ? '<span style="background:' + h + ';padding:1px 4px;border-radius:3px;">' + x + '</span>' : x; });
    t = t.replace(/\[size=(small|normal|large|xl)\]([\s\S]*?)\[\/size\]/gi, (m, z, x) => '<span style="font-size:' + SIZES[z.toLowerCase()] + ';">' + x + '</span>');
    t = t.replace(/\[font=(sans|serif|modern|mono)\]([\s\S]*?)\[\/font\]/gi, (m, f, x) => '<span style="font-family:' + esc(FONTS[f.toLowerCase()]) + ';">' + x + '</span>');
  }
  t = t.replace(/\*\*([^*\n][^\n]*?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__([^_\n][^\n]*?)__/g, '<u>$1</u>');
  t = t.replace(/~~([^~\n][^\n]*?)~~/g, '<s>$1</s>');
  t = t.replace(/(^|[\s(>])\*([^*\s][^*\n]*?)\*(?=[\s).,!?:;<]|$)/g, '$1<em>$2</em>');
  return t;
}

// Blokk-szintű jelölések soronként (escape-elt szövegen).
function _blocks(src, accent) {
  const lines = src.split('\n');
  const out = [];
  let list = null; // { tag, items }
  const flush = () => { if (list) { out.push('<' + list.tag + ' style="margin:6px 0 6px 20px;padding:0;">' + list.items.map((x) => '<li style="margin:2px 0;">' + x + '</li>').join('') + '</' + list.tag + '>'); list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if ((m = /^\s*[-•]\s+(.*)$/.exec(line))) { if (!list || list.tag !== 'ul') { flush(); list = { tag: 'ul', items: [] }; } list.items.push(_inline(m[1], accent)); continue; }
    if ((m = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line))) { if (!list || list.tag !== 'ol') { flush(); list = { tag: 'ol', items: [] }; } list.items.push(_inline(m[1], accent)); continue; }
    flush();
    if (/^\s*(-{3,}|_{3,})\s*$/.test(line)) { out.push('<hr style="border:0;border-top:1px solid #d1d5db;margin:14px 0;">'); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      const lv = m[1].length; const fs = lv === 1 ? '22px' : lv === 2 ? '18px' : '16px';
      out.push('<div style="font-size:' + fs + ';font-weight:800;margin:12px 0 6px;line-height:1.3;">' + _inline(m[2], accent) + '</div>');
      continue;
    }
    if ((m = /^&gt;\s?(.*)$/.exec(line))) { out.push('<div style="border-left:3px solid #cbd5e1;padding:2px 0 2px 10px;color:#4b5563;">' + (_inline(m[1], accent) || '&nbsp;') + '</div>'); continue; }
    out.push(line === '' ? '<br>' : '<div>' + _inline(line, accent) + '</div>');
  }
  flush();
  return out.join('');
}

// Igazítás + keretes doboz (több soron átívelő) — a soronkénti feldolgozás előtt
// kivágjuk őket, és a belsejüket külön dolgozzuk fel.
function _containers(src, accent) {
  let t = src;
  for (let i = 0; i < 3; i++) {
    t = t.replace(/\[box(?: color=([^\]\s]+))?\]\n?([\s\S]*?)\n?\[\/box\]/gi, (m, c, x) => {
      const h = _hex(c) || accent || '#2563eb';
      return '\u0000B' + h + '\u0001' + x + '\u0002';
    });
    t = t.replace(/\[(center|right)\]\n?([\s\S]*?)\n?\[\/\1\]/gi, (m, a, x) => '\u0000A' + a.toLowerCase() + '\u0001' + x + '\u0002');
  }
  return t;
}
function _renderContainers(t, accent) {
  // Belülről kifelé: a legbelső (nem tartalmaz \u0000-t) blokkot rendereljük.
  const re = /\u0000([BA])([^\u0001]*)\u0001([^\u0000\u0002]*)\u0002/;
  let guard = 0;
  while (re.test(t) && guard++ < 50) {
    t = t.replace(re, (m, kind, arg, inner) => {
      const body = _blocks(inner, accent);
      if (kind === 'B') {
        return '\u0003<div style="border:2px solid ' + arg + ';border-radius:10px;padding:12px 14px;margin:10px 0;background:' + _tint(arg) + ';">' + body + '</div>\u0004';
      }
      return '\u0003<div style="text-align:' + arg + ';">' + body + '</div>\u0004';
    });
  }
  return t;
}

// Fő belépési pont: jelölt szöveg → biztonságos HTML (a kártyák helyével).
//   opts: { accent, cardsHtml }  — a cardsHtml MEGBÍZHATÓ (szerver-renderelt).
function render(text, opts) {
  opts = opts || {};
  const accent = _hex(opts.accent) || null;
  const src = esc(String(text || '').replace(/\r\n?/g, '\n').slice(0, 20000)).replace(/\{\{\s*cards\s*\}\}/gi, '\u0005');
  let t = _renderContainers(_containers(src, accent), accent);
  // A konténereken kívüli részeket soronként dolgozzuk fel.
  t = t.split(/(\u0003[\s\S]*?\u0004)/).map((part) => part.charAt(0) === '\u0003' ? part.slice(1, -1) : _blocks(part, accent)).join('');
  const cards = opts.cardsHtml || '';
  if (t.indexOf('\u0005') >= 0) t = t.replace(/\u0005/g, cards);
  else if (cards) t += cards;
  return t.replace(/[\u0000-\u0005]/g, '');
}

// Szövegként (sima-szöveges levélrész / AI-nak visszaadás) — a jelölések nélkül.
function toPlain(text) {
  return String(text || '')
    .replace(/\[btn url=([^\]\s]+)\]([\s\S]*?)\[\/btn\]/gi, '$2 ($1)')
    .replace(/\[([^\]\n]{1,200})\]\((https?:[^)\s]+)\)/g, '$1 ($2)')
    .replace(/\[\/?(color|bg|size|font|center|right|box)(=[^\]]*| color=[^\]]*)?\]/gi, '')
    .replace(/\*\*|__|~~/g, '');
}

// Helykitöltők / félkész részek — ezekkel NEM mehet ki a levél.
const PH_RES = [
  /\{\{(?!\s*cards\s*\}\})[^}]{1,60}\}\}/i,                       // kitöltetlen {{változó}}
  /\[[^\]\n]{0,80}(betölt|töltés|loading|încărc|placeholder|xxx|todo|ide jön|ide írd|adatok? helye|completa|complete)[^\]\n]{0,80}\]/i,
  /\[(név|nev|cég|ceg|dátum|datum|cím|cim|összeg|osszeg|nume|data|firma|suma|adresa|name|date|company|amount)\]/i,
  /\[\s*(\.\.\.|…)\s*\]/,
  /\bTODO\b|\bXXX\b|lorem ipsum/i,
];
function findPlaceholders(text) {
  const s = toPlain(text);
  const found = [];
  for (const re of PH_RES) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = g.exec(s)) && found.length < 5) { if (!found.includes(m[0])) found.push(m[0].slice(0, 80)); }
  }
  return found;
}

module.exports = { tint: _tint, render, toPlain, findPlaceholders, esc, CARDS_MARK, FONTS, SIZES };
