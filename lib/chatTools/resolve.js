// ============================================================
//  VallorSoft — lib/chatTools/resolve.js
//  A chat-toolok paramétereinek SZERVER-OLDALI feloldása.
//  Az AI csak nyers szöveget ad („Gondos", „0042", „B104VLR", „holnap");
//  ezt itt, a cég saját adataiból, company_id-szűrten oldjuk fel id-re.
//  Kétértelmű → visszakérdezés gombokkal; ismeretlen → visszakérdezés.
// ============================================================
'use strict';

const di = require('../driverInfo');
const mi = require('../mailIntent');

const { iso, plateNorm, q } = di._h;
const fold = mi.fold;

const ASK = {
  hu: {
    order: 'Melyik fuvarra gondolsz? Írd be a fuvarszámot (pl. 0042).', orderNF: (r) => 'Nem találom a(z) ' + r + ' fuvart.', orderAmb: 'Több fuvar is illik rá — melyik?',
    driver: 'Melyik sofőrre gondolsz?', driverNF: (r) => 'Nincs ilyen sofőr: ' + r + '.', driverAmb: 'Több sofőr is illik a névre — melyik?',
    vehicle: 'Melyik járműre gondolsz? Írd be a rendszámot.', vehicleNF: (r) => 'Nincs ilyen jármű: ' + r + '.', vehicleAmb: 'Több jármű is illik rá — melyik?',
    client: 'Melyik ügyfélre gondolsz?', clientNF: (r) => 'Nincs ilyen ügyfél: ' + r + '.', clientAmb: 'Több ügyfél is illik rá — melyik?',
    carrier: 'Melyik alvállalkozóra gondolsz?', carrierNF: (r) => 'Nincs ilyen alvállalkozó: ' + r + '.', carrierAmb: 'Több alvállalkozó is illik rá — melyik?',
    date: 'Melyik dátum? (pl. holnap, 2026-10-15, 15.10.)', dateBad: (r) => 'Ezt nem értem dátumként: ' + r + '.',
    money: 'Mekkora összeg?', moneyBad: (r) => 'Ezt nem értem összegként: ' + r + '.',
    number: 'Milyen számot írjak be?', numberBad: (r) => 'Ezt nem értem számként: ' + r + '.',
    period: 'Melyik időszakra? (pl. ez a hónap, szeptember, 2026)', enumBad: (r, v) => 'Érvénytelen érték: ' + r + '. Lehet: ' + v.join(', '),
    email: 'Melyik e-mail címre?', emailBad: (r) => 'Ez nem érvényes e-mail cím: ' + r + '.', text: (k) => 'Add meg: ' + k,
  },
  ro: {
    order: 'La ce cursă te referi? Scrie numărul cursei (ex. 0042).', orderNF: (r) => 'Nu găsesc cursa ' + r + '.', orderAmb: 'Se potrivesc mai multe curse — care?',
    driver: 'La ce șofer te referi?', driverNF: (r) => 'Nu există șoferul: ' + r + '.', driverAmb: 'Se potrivesc mai mulți șoferi — care?',
    vehicle: 'La ce vehicul te referi? Scrie numărul de înmatriculare.', vehicleNF: (r) => 'Nu există vehiculul: ' + r + '.', vehicleAmb: 'Se potrivesc mai multe vehicule — care?',
    client: 'La ce client te referi?', clientNF: (r) => 'Nu există clientul: ' + r + '.', clientAmb: 'Se potrivesc mai mulți clienți — care?',
    carrier: 'La ce subcontractor te referi?', carrierNF: (r) => 'Nu există subcontractorul: ' + r + '.', carrierAmb: 'Se potrivesc mai mulți subcontractori — care?',
    date: 'Ce dată? (ex. mâine, 2026-10-15, 15.10.)', dateBad: (r) => 'Nu înțeleg ca dată: ' + r + '.',
    money: 'Ce sumă?', moneyBad: (r) => 'Nu înțeleg ca sumă: ' + r + '.',
    number: 'Ce număr scriu?', numberBad: (r) => 'Nu înțeleg ca număr: ' + r + '.',
    period: 'Pentru ce perioadă? (ex. luna aceasta, septembrie, 2026)', enumBad: (r, v) => 'Valoare invalidă: ' + r + '. Posibil: ' + v.join(', '),
    email: 'Ce adresă de e-mail?', emailBad: (r) => 'Adresă de e-mail invalidă: ' + r + '.', text: (k) => 'Completează: ' + k,
  },
};
const ak = (ctx) => ASK[ctx.lang === 'hu' ? 'hu' : 'ro'];

function askFor(ctx, key, d) {
  const a = ak(ctx);
  if (d.ask) return d.ask[ctx.lang] || d.ask.hu;
  return a[d.type] || a.text(key);
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const MONTHS = {
  ianuarie: 1, januar: 1, january: 1, februarie: 2, februar: 2, february: 2, martie: 3, marcius: 3, march: 3, aprilie: 4, aprilis: 4, april: 4,
  mai: 5, majus: 5, may: 5, iunie: 6, junius: 6, june: 6, iulie: 7, julius: 7, july: 7, august: 8, augusztus: 8,
  septembrie: 9, szeptember: 9, september: 9, octombrie: 10, oktober: 10, october: 10, noiembrie: 11, november: 11, decembrie: 12, december: 12,
};

function parseNumber(x) {
  if (typeof x === 'number') return isFinite(x) ? x : null;
  const s = String(x || '').replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (/^-?\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''));
  const m = /^(-?.*)[.,](\d{1,2})$/.exec(s);
  if (m) return Number(m[1].replace(/[.,]/g, '') + '.' + m[2]);
  const n = Number(s.replace(/[.,]/g, ''));
  return isFinite(n) ? n : null;
}

function parseDate(raw, now) {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00');
    return isNaN(d) ? null : s;
  }
  const ops = require('../chatOps');
  return ops.dateIn(fold(s.replace(/(\d)\/(\d)/g, '$1.$2')), now || new Date());
}

// Időszak → { from, to } (YYYY-MM-DD). Elfogad: "YYYY-MM-DD..YYYY-MM-DD", "YYYY-MM", "YYYY",
// kulcsszavak (this_month/last_month/this_year/last_year/last_30_days/this_week/today) és hónapnevek.
function parsePeriod(raw, now) {
  now = now || new Date();
  const s = String(raw || '').trim();
  const f = fold(s);
  const ymd = (d) => iso(d);
  const y = now.getFullYear(); const m = now.getMonth();
  const monthRange = (yy, mm) => ({ from: ymd(new Date(yy, mm, 1)), to: ymd(new Date(yy, mm + 1, 0)) });
  let mm = /^(\d{4}-\d{2}-\d{2})\s*(?:\.\.|–|-|to)\s*(\d{4}-\d{2}-\d{2})$/.exec(s);
  if (mm) return mm[1] <= mm[2] ? { from: mm[1], to: mm[2] } : { from: mm[2], to: mm[1] };
  mm = /^(\d{4})-(\d{2})$/.exec(s);
  if (mm) return monthRange(+mm[1], +mm[2] - 1);
  mm = /^(\d{4})$/.exec(s);
  if (mm) return { from: mm[1] + '-01-01', to: mm[1] + '-12-31' };
  const c = f.replace(/[^a-z0-9]/g, '');
  if (/^(thismonth|ezaho|ehavi|ebbenahonapban|honap|lunaaceasta|lunacurenta|luna)$/.test(c)) return monthRange(y, m);
  if (/^(lastmonth|multho|multhavi|elozoho|lunatrecuta)$/.test(c)) return monthRange(y, m - 1);
  if (/^(thisyear|iden|ezazev|anulacesta|anulcurent|anul)$/.test(c)) return { from: y + '-01-01', to: y + '-12-31' };
  if (/^(lastyear|tavaly|anultrecut)$/.test(c)) return { from: (y - 1) + '-01-01', to: (y - 1) + '-12-31' };
  if (/^(today|ma|azi|astazi)$/.test(c)) return { from: ymd(now), to: ymd(now) };
  if (/^(thisweek|ezahet|aheten|saptamanaaceasta)$/.test(c)) {
    const d = new Date(y, m, now.getDate()); const dow = (d.getDay() + 6) % 7;
    const a = new Date(d); a.setDate(d.getDate() - dow); const b = new Date(a); b.setDate(a.getDate() + 6);
    return { from: ymd(a), to: ymd(b) };
  }
  if (/^(last30days|utolso30nap|ultimele30dezile)$/.test(c)) { const a = new Date(y, m, now.getDate() - 29); return { from: ymd(a), to: ymd(now) }; }
  const w = f.split(/\s+/);
  for (const x of w) {
    for (const [name, n] of Object.entries(MONTHS)) {
      if (x.startsWith(name.slice(0, Math.max(4, name.length - 3))) && name.startsWith(x.slice(0, 3))) {
        const yy = (/\b(20\d{2})\b/.exec(f) || [])[1];
        let year = yy ? +yy : y;
        if (!yy && n - 1 > m) year = y - 1; // jövőbeli hónap név → tavalyi
        return monthRange(year, n - 1);
      }
    }
  }
  return null;
}

async function findVehicle(cid, raw, kind) {
  const n = plateNorm(raw);
  if (!n || n.length < 3) return { nf: true };
  const rows = await q(`SELECT id, rendszam, tip, marca, model FROM vehicles WHERE company_id = $1`, [cid]);
  let hits = rows.filter((v) => plateNorm(v.rendszam) === n);
  if (!hits.length) hits = rows.filter((v) => plateNorm(v.rendszam).includes(n));
  if (kind) { const k = hits.filter((v) => v.tip === kind); if (k.length) hits = k; }
  if (hits.length === 1) return { v: hits[0] };
  if (hits.length > 1) return { amb: hits.slice(0, 6).map((v) => v.rendszam) };
  return { nf: true };
}

async function findCarrier(cid, raw) {
  const words = fold(raw).split(/[ -]/).filter((w) => w.length >= 3);
  if (!words.length) return { nf: true };
  const rows = await q(`SELECT id, nev, email, cui FROM carriers WHERE company_id = $1`, [cid]);
  let best = []; let bestHit = 0;
  for (const c of rows) {
    const toks = fold(c.nev).split(/[ -]/).filter((x) => x.length >= 3 && !['srl', 'sa', 'kft', 'bt', 'zrt', 'trans', 'transport'].includes(x));
    const hit = toks.filter((x) => words.some((w) => mi.wordHits(w, x))).length;
    if (!hit) continue;
    if (hit > bestHit) { best = [c]; bestHit = hit; } else if (hit === bestHit) best.push(c);
  }
  if (best.length === 1) return { c: best[0] };
  if (best.length > 1) return { amb: best.slice(0, 5).map((c) => c.nev) };
  return { nf: true };
}

// Egy paraméter feloldása. d = param-definíció; v = az AI nyers értéke.
async function resolve(ctx, d, v, key) {
  const a = ak(ctx);
  let raw = typeof v === 'string' ? v.trim().slice(0, 500) : v;
  switch (d.type) {
    case 'orders': {
      // Több fuvar: „selected" (a felületen kijelöltek) vagy vesszős fuvarszám-lista.
      if (/^(selected|kijelolt\w*|selectat\w*)$/i.test(fold(String(raw)))) {
        const ids = (ctx.ui && ctx.ui.selected_ids) || [];
        if (!ids.length) return { ask: { text: a.order, options: [] } };
        const rows = await q(`SELECT id, COALESCE(to_jsonb(o)->>'fuvar_no', o.id) AS no FROM orders o WHERE o.company_id = $1 AND o.id = ANY($2::text[])`, [ctx.cid, ids]);
        if (!rows.length) return { err: a.orderNF('—') };
        return { value: rows.map((r) => ({ id: r.id, no: r.no })) };
      }
      const parts = (Array.isArray(raw) ? raw : String(raw).split(/[,;\s]+/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 100);
      const out = [];
      for (const p of parts) {
        const r = await resolve(ctx, { type: 'order' }, p, key);
        if (r.err || r.ask) return r;
        if (!out.some((o) => o.id === r.value.id)) out.push(r.value);
      }
      if (!out.length) return { ask: { text: a.order, options: [] } };
      return { value: out };
    }
    case 'order': {
      const ops = require('../chatOps');
      if (/^(current|selected|ez|this|aceasta|asta)$/i.test(String(raw))) {
        const id = (ctx.ui && (ctx.ui.order || (ctx.ui.selected_ids || [])[0])) || null;
        if (id) {
          const r = await q(`SELECT id, COALESCE(to_jsonb(o)->>'fuvar_no', o.id) AS no FROM orders o WHERE o.company_id = $1 AND o.id = $2`, [ctx.cid, id]);
          if (r[0]) return { value: { id: r[0].id, no: r[0].no } };
        }
        raw = '__history__';
      }
      const text = raw === '__history__' ? '' : String(raw);
      // A csupasz szám („42") is fuvarszám ebben a paraméterben.
      const t2 = /^\d{1,6}$/.test(text) ? '#' + text : text;
      const fo = await ops._findOrder(ctx.cid, t2, raw === '__history__' || d.fromHistory ? ctx.history : []);
      if (!fo.ref) return { ask: { text: a.order, options: [] } };
      if (fo.ambiguous) return { ask: { text: a.orderAmb, options: (fo.ambiguous.options || []).slice(0, 5).map((n) => ctx.retext(n, String(raw))) } };
      if (!fo.order) return { err: a.orderNF(fo.ref) };
      return { value: { id: fo.order.id, no: fo.order.fuvar_no || fo.order.id } };
    }
    case 'driver': {
      const e = await di._h.findEntity(ctx.cid, String(raw), {});
      if (!e || e.plate) return { err: a.driverNF(raw) };
      if (e.ambiguous) return { ask: { text: a.driverAmb, options: e.ambiguous.map((n) => ctx.retext(n, String(raw))) } };
      return { value: { email: e.email, name: e.name } };
    }
    case 'vehicle': case 'tractor': case 'trailer': {
      const kind = d.type === 'tractor' ? 'Vontato' : d.type === 'trailer' ? 'Potkocsi' : null;
      const r = await findVehicle(ctx.cid, String(raw), kind);
      if (r.amb) return { ask: { text: a.vehicleAmb, options: r.amb.map((n) => ctx.retext(n, String(raw))) } };
      if (!r.v) return { err: a.vehicleNF(raw) };
      return { value: { id: r.v.id, plate: r.v.rendszam, tip: r.v.tip } };
    }
    case 'client': {
      const ops = require('../chatOps');
      const c = await ops._findClient(ctx.cid, String(raw));
      if (!c) return d.allowNew ? { value: { id: null, name: String(raw).slice(0, 200) } } : { err: a.clientNF(raw) };
      if (c.ambiguous) return { ask: { text: a.clientAmb, options: c.ambiguous.map((n) => ctx.retext(n, String(raw))) } };
      return { value: { id: c.id, name: c.denumire } };
    }
    case 'carrier': {
      const r = await findCarrier(ctx.cid, String(raw));
      if (r.amb) return { ask: { text: a.carrierAmb, options: r.amb.map((n) => ctx.retext(n, String(raw))) } };
      if (!r.c) return { err: a.carrierNF(raw) };
      return { value: { id: r.c.id, name: r.c.nev } };
    }
    case 'date': {
      const x = parseDate(raw, ctx.now);
      if (!x) return { err: a.dateBad(raw) };
      return { value: x };
    }
    case 'period': {
      const p = parsePeriod(raw, ctx.now);
      if (!p) return { ask: { text: a.period, options: [] } };
      return { value: p };
    }
    case 'money': case 'number': case 'int': {
      const n = parseNumber(raw);
      if (n == null) return { err: (d.type === 'money' ? a.moneyBad : a.numberBad)(raw) };
      if (d.min != null && n < d.min) return { err: (d.type === 'money' ? a.moneyBad : a.numberBad)(raw) };
      if (d.maxv != null && n > d.maxv) return { err: (d.type === 'money' ? a.moneyBad : a.numberBad)(raw) };
      return { value: d.type === 'int' ? Math.round(n) : Math.round(n * 100) / 100 };
    }
    case 'enum': {
      const s = String(raw);
      const hit = d.values.find((x) => x === s) || d.values.find((x) => fold(x) === fold(s));
      if (!hit) return { err: a.enumBad(raw, d.values) };
      return { value: hit };
    }
    case 'bool': return { value: raw === true || /^(true|igen|da|yes|1|be|on)$/i.test(String(raw)) };
    case 'email': {
      const s = String(raw).toLowerCase();
      if (!EMAIL_RE.test(s)) return { err: a.emailBad(raw) };
      return { value: s };
    }
    case 'text': default: {
      const s = String(raw == null ? '' : raw).trim().slice(0, d.max || 300);
      if (!s && d.required) return { ask: { text: askFor(ctx, key, d), options: [] } };
      return { value: s || null };
    }
  }
}

module.exports = { resolve, askFor, parsePeriod, parseNumber, parseDate, findVehicle, findCarrier, ASK };
