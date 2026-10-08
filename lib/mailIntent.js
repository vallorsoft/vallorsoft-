// ============================================================
//  VallorSoft — lib/mailIntent.js
//  Determinisztikus (AI nélküli) szándék-felismerés a 💬 levél-chathez:
//  „küldd el Gondos Imrének az összes aktív fuvarját", „B104VLR fuvarjai
//  márciusban", „toate cursele lui Ion din luna trecută"…
//
//  • A sofőrt / járművet a cég SAJÁT listájából ismeri fel (company_id-szűrt,
//    csak a szerveren — az AI nem kap nevet-listát, e-mailt, telefont).
//  • Időszak: összes / ez a hónap / múlt hónap / idén / tavaly / hónapnév (+év) /
//    dátumtartomány / utolsó N nap. Időszak nélkül = TELJES időszak.
//  • Tanulás (kevesebb AI később): ha ugyanilyen jellegű levelet már elküldtek,
//    a levél tárgya/szövege sablonként (`order_chat_memory` kind='mail_tpl')
//    újrahasznosul — ha a kérésben nincs más utasítás, az AI-t meg sem hívjuk.
// ============================================================
'use strict';

const pool = require('../db');
const { memGet, memPut } = require('./chatMemory');

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9.\- ]/g, ' ').replace(/\s+/g, ' ').trim();
const plate = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const monthRange = (y, m) => ({ from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) });

const ORDER_WORDS = /\b(fuvar\w*|szallitas\w*|kiszallitas\w*|tura\w*|cursa|cursel\w*|curse\w*|cursa\w*|transport\w*|comand\w*|comenz\w*|orders?|loads?|rakomany\w*)\b/;
const ALL_WORDS = /\b(osszes\w*|mindegyik\w*|minden\w*|teljes|toate|toata|tot|totul|all|every)\b/;
const STATUS_WORDS = [
  ['active', /\b(aktiv\w*|activ\w*|kiosztott\w*|kiadott\w*|folyamatban|varakozo|ami var\w*|mi var\w*|alocat\w*|in curs|in desfasurare|urmator\w*|kovetkezo\w*|upcoming|assigned)\b/],
  ['Finalizat', /\b(lezart\w*|befejezett\w*|elvegzett\w*|teljesitett\w*|finalizat\w*|incheiat\w*|efectuat\w*|completed|done|kesz)\b/],
  ['open', /\b(nyitott\w*|deschis\w*|nelezart\w*|open)\b/],
];
const MONTHS = [
  ['januar', 'ianuarie', 'january', 'jan', 'ian'], ['februar', 'februarie', 'february', 'feb'], ['marcius', 'martie', 'march', 'mar'],
  ['aprilis', 'aprilie', 'april', 'apr'], ['majus', 'mai', 'may', 'maj'], ['junius', 'iunie', 'june', 'jun', 'iun'],
  ['julius', 'iulie', 'july', 'jul', 'iul'], ['augusztus', 'august', 'aug'], ['szeptember', 'septembrie', 'september', 'sep', 'szept', 'sept'],
  ['oktober', 'octombrie', 'october', 'okt', 'oct'], ['november', 'noiembrie', 'nov', 'noi'], ['december', 'decembrie', 'dec'],
];
// A felismerés után maradó „töltelék" szavak (ha CSAK ezek maradnak, a tanult sablon használható).
const STOP = new Set(('a az es is meg el le ki be fel neki nekik ot ok azt ezt amit ami mi minden osszes osszeset teljes teljesen reszletes reszletesen reszletekkel '
  + 'kuld kuldd kuldjuk kuldjed kuldeni kuldenel kuldenetek kellene kell kene lehet tudjuk eltudjuk el tudjuk lenne legyen szeretnem kerem kerlek please '
  + 'email emailben e-mail e-mailben mail mailben levelet levelben level ceges cegunk cegunk ceg cegtol soforrnek sofor sofornek soferek sofer sofernek '
  + 'fuvar fuvart fuvarok fuvarjat fuvarjait fuvarjai fuvarjaid fuvarjarol fuvarokat fuvarjait jarmu jarmuvet jarmuve kamion kamionnak '
  + 'hogy lassa lassak lathassa tudja mi var ra ra rajuk vele neki on en mi ti '
  + 'trimite trimiteti trimitem trimitere te rog va rog email-ul pe pentru lui ei lor la de din cu si sa ca care toate cursele cursa curse comenzile '
  + 'soferul soferului sofer soferilor detaliat detaliate detalii complet complete send all orders of to his her the with details please').split(' '));

async function _drivers(cid) {
  try { return (await pool.query(`SELECT LOWER(email) AS email, nume FROM users WHERE company_id=$1 AND pozicio='Sofer' AND blocked IS NOT TRUE`, [cid])).rows; } catch (_) { return []; }
}
async function _aliases(cid) {
  try { return (await pool.query(`SELECT key_norm, value->>'email' AS email FROM order_chat_memory WHERE company_id=$1 AND kind='driver_alias'`, [cid])).rows; } catch (_) { return []; }
}
async function _plates(cid) {
  try { return (await pool.query(`SELECT rendszam FROM vehicles WHERE company_id=$1`, [cid])).rows.map((r) => r.rendszam).filter(Boolean); } catch (_) { return []; }
}

// A szó illik a névtöredékre? (magyar ragok: Imrének, Gondosnak, Petié…)
const wordHits = (word, tok) => word === tok || (tok.length >= 3 && word.startsWith(tok) && word.length - tok.length <= 5);

function _period(f, now) {
  const y = now.getFullYear(); const m = now.getMonth();
  let r = null; const used = [];
  const take = (re) => { const x = re.exec(f); if (x) used.push(x[0]); return x; };
  let x;
  // Dátumtartomány: 2026-01-05 … 2026-02-10 vagy 05.01.2026 … 10.02.2026
  const dates = []; const dre = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g;
  while ((x = dre.exec(f))) { used.push(x[0]); dates.push(x[1] ? new Date(+x[1], +x[2] - 1, +x[3]) : new Date(+x[6], +x[5] - 1, +x[4])); }
  if (dates.length >= 2) { dates.sort((a, b) => a - b); return { from: iso(dates[0]), to: iso(dates[dates.length - 1]), used }; }
  if (dates.length === 1) return { from: iso(dates[0]), to: iso(dates[0]), used };
  if ((x = take(/\b(utolso|elmult|ultimele|ultimii|last)\s+(\d{1,3})\s+(nap\w*|zile|days?)\b/))) {
    return { from: iso(new Date(now - (+x[2]) * 864e5)), to: iso(now), used };
  }
  if (take(/\b(ez a|ebben a|e|aktualis|mostani)\s+honap\w*|\bluna (asta|aceasta|curenta)\b|\bthis month\b/)) r = { from: iso(new Date(y, m, 1)), to: iso(now) };
  else if (take(/\b(mult|elozo|tavalyi)\s+honap\w*|\bluna trecuta\b|\blast month\b/)) r = monthRange(y, m - 1);
  else if (take(/\b(iden|idei|ebben az evben|az idei evben|anul (asta|acesta|curent)|this year)\b/)) r = { from: y + '-01-01', to: iso(now) };
  else if (take(/\b(tavaly|tavalyi|anul trecut|last year)\b/)) r = { from: (y - 1) + '-01-01', to: (y - 1) + '-12-31' };
  if (r) return Object.assign(r, { used });
  for (let i = 0; i < 12; i++) {
    for (const nm of MONTHS[i]) {
      const re = new RegExp('\\b' + nm + (nm.length <= 4 ? '\\.?' : '\\w*') + '(?:\\s+(\\d{4}))?\\b');
      const mm = re.exec(f);
      if (mm && (nm.length > 3 || /\d{4}/.test(mm[0]))) {
        used.push(mm[0]);
        const yy = mm[1] ? +mm[1] : (i > m ? y - 1 : y);
        return Object.assign(monthRange(yy, i), { used });
      }
    }
  }
  if ((x = take(/\b(20\d{2})\b/))) return { from: x[1] + '-01-01', to: x[1] + '-12-31', used };
  return { used };
}

// ─── Fő függvény: a felhasználó szövegéből egy fuvar-lekérdezés (vagy null) ───
async function parse(cid, text, now) {
  now = now || new Date();
  const f = fold(text);
  if (!f) return null;
  const words = f.split(' ');
  const out = { driver: null, driver_name: null, driver_ambiguous: null, vehicle: null, status: null, from: null, to: null, all: false, used: [] };

  // Sofőr: a cég sofőrjeinek nevéből (legtöbb egyező névtag nyer; holtversenynél kérdés).
  const drivers = await _drivers(cid);
  let best = []; let bestHit = 0;
  for (const d of drivers) {
    const toks = fold(d.nume).split(' ').filter((t) => t.length >= 3);
    const hitToks = toks.filter((t) => words.some((w) => wordHits(w, t)));
    if (!hitToks.length) continue;
    if (hitToks.length > bestHit) { best = [{ d, hitToks }]; bestHit = hitToks.length; } else if (hitToks.length === bestHit) best.push({ d, hitToks });
  }
  if (best.length === 1) { out.driver = best[0].d.nume; out.driver_email = best[0].d.email; out.used.push(...best[0].hitToks); }
  else if (best.length > 1) out.driver_ambiguous = best.map((b) => b.d.nume).slice(0, 4);
  if (!out.driver) {
    // Tanult becenév („Peti", „Imi") → sofőr.
    for (const a of await _aliases(cid)) {
      if (!a.key_norm || a.key_norm.length < 3) continue;
      const at = a.key_norm.split(' ');
      if (at.every((t) => words.some((w) => wordHits(w, t)))) {
        const d = drivers.find((x) => x.email === String(a.email || '').toLowerCase());
        if (d) { out.driver = d.nume; out.driver_email = d.email; out.driver_ambiguous = null; out.learned_alias = true; out.used.push(...at); break; }
      }
    }
  }
  // Rendszám (szóközzel / kötőjellel írva is).
  const compact = plate(text);
  for (const p of await _plates(cid)) {
    const n = plate(p);
    if (n.length >= 5 && compact.includes(n)) { out.vehicle = p; out.used.push(fold(p)); break; }
  }
  for (const [k, re] of STATUS_WORDS) { const x = re.exec(f); if (x) { out.status = k; out.used.push(x[0]); break; } }
  const per = _period(f, now);
  out.from = per.from || null; out.to = per.to || null; out.used.push(...(per.used || []));
  const allM = ALL_WORDS.exec(f); if (allM) { out.all = true; out.used.push(allM[0]); }
  const orderM = ORDER_WORDS.exec(f);
  out.orders = !!orderM;
  const hasEntity = !!(out.driver || out.vehicle);
  // Csak fuvar-kérésnél (a puszta név még nem jelent fuvar-listát — pl. „írj Gondosnak egy köszönőt").
  if (!out.orders) return null;
  if (!hasEntity && !out.driver_ambiguous) return null;
  // Maradék szavak: ha nincs más (csak töltelék), a tanult sablon AI nélkül használható.
  const usedSet = new Set(out.used.join(' ').split(' ').filter(Boolean));
  out.residual = words.filter((w) => w.length >= 3 && !STOP.has(w) && !usedSet.has(w)
    && !(orderM && w === orderM[0]) && !/^\d+$/.test(w) && !out.used.some((u) => u.split(' ').some((t) => wordHits(w, t))));
  return out;
}

// Az intent → mailData-lekérdezés (a sofőrt NÉVVEL adjuk át; a szerver e-mailre oldja fel).
function toQuery(it) {
  if (!it) return null;
  const q = {};
  if (it.driver) q.driver = it.driver;
  if (it.vehicle) q.vehicle = it.vehicle;
  if (it.status) q.status = it.status;
  if (it.from) q.from = it.from;
  if (it.to) q.to = it.to;
  q.all = true;
  return q;
}

// Sablon-kulcs: a kérés JELLEGE (nem a konkrét név / dátum).
function signature(it, lang) {
  if (!it) return null;
  return ['orders', it.driver ? 'driver' : '', it.vehicle ? 'vehicle' : '', it.status || '', (it.from || it.to) ? 'period' : 'all', lang === 'hu' ? 'hu' : 'ro'].join('|');
}
function periodLabel(it, lang) {
  if (it.from || it.to) return it.from === it.to ? it.from : (it.from || '…') + ' – ' + (it.to || '…');
  return lang === 'hu' ? 'a teljes időszak' : 'toată perioada';
}
const _escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Elküldött levélből sablon: a konkrét név / jármű / időszak helyére helyőrző.
function makeTemplate(d, it, lang) {
  const sub = (txt) => {
    let t = String(txt || '');
    if (it.driver) t = t.replace(new RegExp(_escRe(it.driver), 'gi'), '{{who}}');
    if (it.vehicle) t = t.replace(new RegExp(_escRe(it.vehicle), 'gi'), '{{vehicle}}');
    const pl = periodLabel(it, lang);
    if (it.from || it.to) t = t.split(pl).join('{{period}}');
    return t;
  };
  const toDriver = !!(it.driver && d.recipient === 'named' && d.recipient_name && fold(d.recipient_name) === fold(it.driver));
  // A sofőr neve NEM tárolódik a sablonban (helyőrző) — GDPR: a sablon nem személyes adat.
  return { subject: sub(d.subject), body: sub(d.body), card_fields: d.card_fields || null, style: d.style || null,
    recipient: toDriver ? 'driver' : (d.recipient === 'named' && d.recipient_name ? 'fixed' : null),
    recipient_name: toDriver ? null : (d.recipient === 'named' ? d.recipient_name || null : null) };
}
function fillTemplate(tpl, it, lang) {
  const fill = (t) => String(t || '').split('{{who}}').join(it.driver || '').split('{{vehicle}}').join(it.vehicle || '').split('{{period}}').join(periodLabel(it, lang));
  return { subject: fill(tpl.subject), body: fill(tpl.body), card_fields: tpl.card_fields, style: tpl.style,
    recipient_name: tpl.recipient === 'driver' ? it.driver : (tpl.recipient === 'fixed' ? tpl.recipient_name : null) };
}

async function getTemplate(cid, it, lang) { return memGet(cid, 'mail_tpl', signature(it, lang)); }
async function learnTemplate(cid, d, it, lang) {
  if (!it || !d.subject || !d.body) return;
  const tpl = makeTemplate(d, it, lang);
  // Csak akkor tanuljuk, ha a sablonban nem maradt konkrét fuvarszám (azt a kártya adja).
  if (/\b[A-Z]{1,10}-\d{4}-\d{1,6}\b/.test(tpl.body + ' ' + tpl.subject)) return;
  await memPut(cid, 'mail_tpl', signature(it, lang), tpl);
}
async function learnAlias(cid, alias, email) {
  const k = fold(alias);
  if (k.length >= 3 && email) await memPut(cid, 'driver_alias', k, { email: String(email).toLowerCase() });
}

// Kliensről visszajövő intent (megbízhatatlan) → csak ismert mezők.
function sanitize(it) {
  if (!it || typeof it !== 'object') return null;
  const s = (v, n) => (v == null ? null : (String(v).trim().slice(0, n) || null));
  const d = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  const o = { driver: s(it.driver, 80), vehicle: s(it.vehicle, 20), status: ['active', 'open', 'Finalizat', 'Alocat', 'In Curs'].includes(it.status) ? it.status : null,
    from: d(it.from), to: d(it.to), all: it.all === true, tpl: it.tpl === true };
  return (o.driver || o.vehicle || o.status || o.from || o.all) ? o : null;
}

module.exports = { parse, toQuery, signature, periodLabel, makeTemplate, fillTemplate, getTemplate, learnTemplate, learnAlias, sanitize, fold };
