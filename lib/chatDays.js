// ============================================================
//  VallorSoft — lib/chatDays.js
//  Diurna-napok a chatből: szövegből napok listája + kattintható
//  mini-naptár (a járandóság-modál zöld naptárának chat-változata).
//  Elfogadott formák (HU/RO, vegyesen, vesszővel / „és”-sel elválasztva):
//    2026-10-01..2026-10-06 · 10.01-10.06 · okt 1-6 · október 1-től 6-ig
//    1-6 (aktuális hónap) · 2026-10-03 · 10.03 · okt 3 · 3 (az előző hónap-környezetben)
// ============================================================
'use strict';

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
const valid = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };

// Hónapnév (HU/RO/EN, rövidítve is) → 1..12
const MON = [
  [1, ['jan', 'ian']], [2, ['feb']], [3, ['mar', 'mart']], [4, ['apr']], [5, ['maj', 'mai', 'may']], [6, ['jun', 'iun']],
  [7, ['jul', 'iul']], [8, ['aug']], [9, ['sze', 'sep', 'szept']], [10, ['okt', 'oct']], [11, ['nov', 'noi']], [12, ['dec']],
];
function monthOf(word) {
  const w = fold(word).replace(/[^a-z]/g, '');
  if (w.length < 3) return null;
  for (const [n, keys] of MON) for (const k of keys) if (w.startsWith(k)) return n;
  return null;
}

// Év feloldása: ha a dátum a mai naptól 2 hónapnál messzebb a jövőben, a tavalyi évre gondolt.
function yearFor(m, d, now) {
  const y = now.getFullYear();
  const t = new Date(y, m - 1, d);
  return (t - now) > 62 * 864e5 ? y - 1 : y;
}

function addRange(out, a, b) {
  if (a > b) { const x = a; a = b; b = x; }
  const d = new Date(a + 'T00:00:00Z'); const end = new Date(b + 'T00:00:00Z');
  while (d <= end && out.size < 62) { out.add(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
}

// Szöveg → rendezett, egyedi ISO-napok (max 62), vagy null.
function parseDays(raw, now) {
  now = now || new Date();
  const s = String(raw || '').trim();
  if (!s) return null;
  const out = new Set();
  let ctxMonth = null; let ctxYear = null;
  // „1-től 6-ig” / „de la 1 până la 6” → „1-6”
  const norm = s.replace(/(\d{1,2}\.?)\s*-?\s*t[oóő]l\s+(\d{1,2}\.?)\s*-?\s*ig\b/gi, '$1-$2')
    .replace(/de la\s+(\d{1,2})\s+(?:p[aâ]n[aă]\s+la|la)\s+(\d{1,2})/gi, '$1-$2');
  const parts = norm.split(/\s*[,;]\s*|\s+(?:és|es|si|și|şi)\s+/i).map((x) => x.trim()).filter(Boolean);
  for (let part of parts) {
    part = part.replace(/(^|\s)(napok|napokra|napjai|nap|zile|zilele|ziua|a|az)(?=\s|:|$)\s*:?/gi, ' ').trim();
    let m;
    // ISO tartomány / dátum
    if ((m = /(\d{4}-\d{2}-\d{2})\s*(?:\.\.|–|—|-|>|to|pana la)\s*(\d{4}-\d{2}-\d{2})/.exec(part))) { addRange(out, m[1], m[2]); ctxYear = +m[2].slice(0, 4); ctxMonth = +m[2].slice(5, 7); continue; }
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(part))) { if (valid(+m[1], +m[2], +m[3])) { out.add(m[0]); ctxYear = +m[1]; ctxMonth = +m[2]; } continue; }
    // HH.NN tartomány (hónap.nap, opcionális év): 10.01-10.06 / 2026.10.01-10.06
    if ((m = /^(?:(\d{4})\.)?(\d{1,2})\.(\d{1,2})\.?\s*[-–—]\s*(?:(\d{1,2})\.)?(\d{1,2})\.?$/.exec(part))) {
      const m1 = +m[2], d1 = +m[3], m2 = m[4] ? +m[4] : m1, d2 = +m[5];
      const y = m[1] ? +m[1] : yearFor(m1, d1, now);
      if (valid(y, m1, d1) && valid(y, m2, d2)) { addRange(out, iso(y, m1, d1), iso(y, m2, d2)); ctxYear = y; ctxMonth = m2; }
      continue;
    }
    // Hónapnév + napok: „okt 1-6”, „1-6 octombrie”, „okt 3”
    const words = part.split(/\s+/);
    let mon = null;
    for (const w of words) { const n = monthOf(w); if (n && /\d/.test(part)) { mon = n; break; } }
    const nums = part.replace(/[^\d\-–— ]/g, ' ');
    if ((m = /(\d{1,2})\s*[-–—]\s*(\d{1,2})/.exec(nums))) {
      const mm = mon || ctxMonth || (now.getMonth() + 1);
      const d1 = +m[1], d2 = +m[2];
      const y = mon ? yearFor(mm, d1, now) : (ctxYear || yearFor(mm, d1, now));
      if (valid(y, mm, d1) && valid(y, mm, d2)) { addRange(out, iso(y, mm, d1), iso(y, mm, d2)); ctxYear = y; ctxMonth = mm; }
      continue;
    }
    // Egy nap: „10.03”, „okt 3”, „3”
    if ((m = /^(\d{1,2})\.(\d{1,2})\.?$/.exec(part))) {
      const mm = +m[1], d = +m[2]; const y = yearFor(mm, d, now);
      if (valid(y, mm, d)) { out.add(iso(y, mm, d)); ctxYear = y; ctxMonth = mm; }
      continue;
    }
    if ((m = /\b(\d{1,2})\b/.exec(nums)) && !/\d{3,}/.test(nums)) {
      const mm = mon || ctxMonth || (now.getMonth() + 1);
      const d = +m[1]; const y = mon ? yearFor(mm, d, now) : (ctxYear || yearFor(mm, d, now));
      if (valid(y, mm, d)) { out.add(iso(y, mm, d)); ctxYear = y; ctxMonth = mm; }
    }
  }
  return out.size ? Array.from(out).sort().slice(0, 62) : null;
}

// A chat-üzenet végére fűzött „— napok: …” rész (a naptár „Kész” gombja ezt küldi).
function daysFromText(text, now) {
  const m = /(?:napok|zile)\s*:\s*([^\n]+)$/i.exec(String(text || ''));
  return m ? parseDays(m[1], now) : null;
}

// Kattintható mini-naptár (előző + aktuális hónap). A kiválasztott napok
// a „Kész” gombbal mennek vissza: az eredeti mondat + „ — napok: …”.
function calendarHtml(opts) {
  const now = opts.now || new Date();
  const hu = opts.lang === 'hu';
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MN = hu ? ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december']
    : ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
  const WD = hu ? ['H', 'K', 'Sz', 'Cs', 'P', 'Sz', 'V'] : ['L', 'Ma', 'Mi', 'J', 'V', 'S', 'D'];
  const pre = new Set(opts.selected || []);
  const today = iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
  let months = '';
  for (let k = 1; k >= 0; k--) {
    const first = new Date(now.getFullYear(), now.getMonth() - k, 1);
    const y = first.getFullYear(), m = first.getMonth() + 1;
    const days = new Date(y, m, 0).getDate();
    const lead = (first.getDay() + 6) % 7;
    let cells = WD.map((w) => '<div class="och-cal-wd">' + w + '</div>').join('');
    for (let i = 0; i < lead; i++) cells += '<div></div>';
    for (let d = 1; d <= days; d++) {
      const id = iso(y, m, d);
      cells += '<button type="button" class="och-cal-d' + (pre.has(id) ? ' on' : '') + (id === today ? ' today' : '') + '" data-d="' + id + '" onclick="OrderChat.dayTog(this)">' + d + '</button>';
    }
    months += '<div class="och-cal-m"><div class="och-cal-mt">' + esc(MN[m - 1] + ' ' + y) + '</div><div class="och-cal-g">' + cells + '</div></div>';
  }
  const need = opts.need ? '<span class="och-cal-need" data-need="' + opts.need + '">' + esc((hu ? 'Kell: ' : 'Necesar: ') + opts.need) + '</span>' : '';
  return '<div class="och-info"><div class="och-info-s och-cal" data-base="' + esc(opts.base || '') + '" data-word="' + (hu ? 'napok' : 'zile') + '">'
    + '<div class="och-info-st">🗓️ ' + esc(hu ? 'Jelöld be a diurna napjait' : 'Bifează zilele de diurnă') + '</div>'
    + '<div class="och-info-mut">' + esc(hu ? 'Kattints a napokra (zöld = kijelölve), majd „Kész”. Be is írhatod: pl. „okt 1-6” vagy „10.01, 10.03”.' : 'Apasă pe zile (verde = selectat), apoi „Gata”. Poți și scrie: ex. „1-6 oct” sau „10.01, 10.03”.') + '</div>'
    + '<div class="och-cal-ms">' + months + '</div>'
    + '<div class="och-info-btns"><span class="och-cal-cnt">0</span>' + need
    + '<button type="button" class="och-info-btn och-act-ok" onclick="OrderChat.dayGo(this)">' + esc(hu ? '✓ Kész' : '✓ Gata') + '</button></div></div></div>';
}

module.exports = { parseDays, daysFromText, calendarHtml };
