// ============================================================
//  VallorSoft — lib/mailData.js
//  Az AI-chat e-mailhez a cég SAJÁT adataiból CSAK azt kérjük le, ami az
//  adott kérdéshez kell („adat-kérések"). Az AI megmondja, mire van
//  szüksége (pl. „a legutóbbi 2 fuvar", „a Kovács SRL nyitott számlái"),
//  a szerver fehérlistás, csak-olvasó, company_id-szűrt lekérdezéssel
//  előveszi, és kompakt formában adja vissza.
//
//  SOHA nem kerül az AI-hoz: beérkezett levelek tartalma, e-mail címek,
//  telefonszám, jelszó/kulcs, sofőr személyes adata (CNP, igazolvány),
//  GPS-pozíció. A fuvarkártyák (a levélben) a szerverről renderelődnek,
//  nem az AI írja őket → az adat nem található ki.
// ============================================================
'use strict';

const pool = require('../db');
const { esc, tint } = require('./mailBody');
const { readableOn } = require('./mailStyle');

const MAX_REQ = 4;
const MAX_JSON = 9000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const STATUS = {
  Disponibil: { ro: 'Înregistrată', hu: 'Rögzítve' },
  Alocat: { ro: 'Alocată', hu: 'Kiosztva' },
  'In Curs': { ro: 'În curs', hu: 'Folyamatban' },
  Finalizat: { ro: 'Finalizată', hu: 'Lezárva' },
  Extern: { ro: 'Subcontractată', hu: 'Alvállalkozónál' },
  Parkolt: { ro: 'Parcată', hu: 'Leadva (parkolva)' },
  Raktarban: { ro: 'În depozit', hu: 'Raktárban' },
  Anulat: { ro: 'Anulată', hu: 'Törölve' },
};
const CARD_FIELDS = ['route', 'loading', 'unloading', 'cargo', 'vehicle', 'status', 'price', 'km', 'ref', 'client'];
const DEFAULT_FIELDS = ['route', 'loading', 'unloading', 'cargo', 'vehicle', 'status'];

const _s = (v, n) => (v == null ? null : (String(v).trim().slice(0, n) || null));
const _int = (v, lo, hi, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
const _date = (v) => (ISO.test(String(v || '')) ? String(v) : null);

// Fuvar-mezők (opcionális oszlopok to_jsonb-n át → régi DB-n sem hasal el).
const ORDER_SELECT = `
  SELECT o.id, COALESCE(to_jsonb(o)->>'fuvar_no', o.id) AS fuvar_no, o.client, o.status,
         o.loc_incarcare, o.loc_descarcare, o.ref,
         to_char(o.data_incarcare,'YYYY-MM-DD') AS data_incarcare,
         to_char(o.data_descarcare,'YYYY-MM-DD') AS data_descarcare,
         to_jsonb(o)->>'firma_incarcare' AS firma_incarcare, to_jsonb(o)->>'firma_descarcare' AS firma_descarcare,
         to_jsonb(o)->>'suly_kg' AS suly_kg, to_jsonb(o)->>'load_type' AS load_type,
         to_jsonb(o)->>'rendszam_camion' AS rendszam_camion, to_jsonb(o)->>'rendszam_remorca' AS rendszam_remorca,
         to_jsonb(o)->>'pret' AS pret, to_jsonb(o)->>'km' AS km, o.created_at
    FROM orders o`;

// ─── Fuvar-hivatkozás feloldása: „CMD-2026-0050", „2026-050", „050", belső id ───
async function resolveOrderRefs(cid, refs) {
  const found = []; const missing = []; const ambiguous = [];
  for (const raw of (refs || []).slice(0, 10)) {
    const ref = String(raw || '').trim().toUpperCase().replace(/^#/, '');
    if (!ref) continue;
    let rows = [];
    try {
      rows = (await pool.query(ORDER_SELECT + ` WHERE o.company_id=$1 AND (UPPER(o.id)=$2 OR UPPER(COALESCE(to_jsonb(o)->>'fuvar_no',''))=$2) LIMIT 1`, [cid, ref])).rows;
      if (!rows.length) {
        let m, re = null;
        if ((m = /^(?:[A-Z]{1,10}-)?(\d{4})-0*(\d{1,6})$/.exec(ref))) re = '-' + m[1] + '-0*' + m[2] + '$';
        else if ((m = /^0*(\d{1,6})$/.exec(ref))) re = '-[0-9]{4}-0*' + m[1] + '$';
        if (re) {
          rows = (await pool.query(ORDER_SELECT + ` WHERE o.company_id=$1 AND COALESCE(to_jsonb(o)->>'fuvar_no','') ~ $2
                                     ORDER BY o.created_at DESC LIMIT 5`, [cid, re])).rows;
          // Csak szám → ha több év/széria is illik, az idei elsőbbséget kap.
          if (rows.length > 1) {
            const y = String(new Date().getFullYear());
            const cur = rows.filter((r) => String(r.fuvar_no).indexOf('-' + y + '-') >= 0);
            if (cur.length === 1) rows = cur;
          }
        }
      }
    } catch (_) { rows = []; }
    if (rows.length === 1) found.push(rows[0]);
    else if (rows.length > 1) ambiguous.push({ ref: raw, options: rows.map((r) => r.fuvar_no) });
    else missing.push(String(raw));
  }
  return { found, missing, ambiguous };
}

async function latestOrders(cid, n) {
  try {
    return (await pool.query(ORDER_SELECT + ` WHERE o.company_id=$1 AND o.status <> 'Anulat' ORDER BY o.created_at DESC LIMIT $2`, [cid, _int(n, 1, 10, 2)])).rows;
  } catch (_) { return []; }
}

function _orderBrief(o) {
  return {
    number: o.fuvar_no, client: o.client || null, status: o.status,
    route: [o.loc_incarcare, o.loc_descarcare].filter(Boolean).join(' → '),
    loading: [o.data_incarcare, o.firma_incarcare].filter(Boolean).join(' · ') || null,
    unloading: [o.data_descarcare, o.firma_descarcare].filter(Boolean).join(' · ') || null,
    cargo: [o.load_type, o.suly_kg ? Math.round(+o.suly_kg) + ' kg' : null].filter(Boolean).join(' · ') || null,
    vehicle: [o.rendszam_camion, o.rendszam_remorca].filter(Boolean).join(' / ') || null,
    price_eur: o.pret != null ? +o.pret : null, km: o.km != null ? +o.km : null, ref: o.ref || null,
  };
}

// ─── Adat-kérések tisztítása (AI-ból jön → megbízhatatlan) ───
function sanitizeRequests(list) {
  const out = [];
  for (const r of (Array.isArray(list) ? list : []).slice(0, MAX_REQ)) {
    if (!r || typeof r !== 'object') continue;
    const t = String(r.type || '');
    if (t === 'orders') {
      out.push({ type: t, latest: r.latest ? _int(r.latest, 1, 10, 2) : null,
        refs: (Array.isArray(r.refs) ? r.refs : []).map((x) => _s(x, 40)).filter(Boolean).slice(0, 10),
        client: _s(r.client, 80), status: STATUS[r.status] ? r.status : null, from: _date(r.from), to: _date(r.to) });
    } else if (t === 'order_stats') out.push({ type: t, from: _date(r.from), to: _date(r.to) });
    else if (t === 'client') { const n = _s(r.name, 80); if (n) out.push({ type: t, name: n }); }
    else if (t === 'invoices') out.push({ type: t, client: _s(r.client, 80), order: _s(r.order, 40), unpaid: r.unpaid === true });
    else if (t === 'sent_mails') out.push({ type: t, latest: _int(r.latest, 1, 5, 1), to: _s(r.to, 80) });
    else if (t === 'company') out.push({ type: t });
    else if (t === 'vehicles') out.push({ type: t });
  }
  return out;
}

async function _q(sql, params) { try { return (await pool.query(sql, params)).rows; } catch (_) { return []; } }

// ─── Lekérés: csak az, amit kért, kompakt formában ───
async function fetchData(cid, reqs) {
  const data = {}; const labels = [];
  for (const r of reqs) {
    if (r.type === 'orders') {
      let rows = [];
      if (r.refs.length) {
        const res = await resolveOrderRefs(cid, r.refs);
        rows = res.found;
        if (res.missing.length) data.orders_not_found = res.missing;
        if (res.ambiguous.length) data.orders_ambiguous = res.ambiguous;
      } else {
        const p = [cid]; let w = `o.company_id=$1 AND o.status <> 'Anulat'`;
        if (r.client) { p.push('%' + r.client.replace(/[%_\\]/g, '') + '%'); w += ` AND o.client ILIKE $${p.length}`; }
        if (r.status) { p.push(r.status); w += ` AND o.status = $${p.length}`; }
        if (r.from) { p.push(r.from); w += ` AND COALESCE(o.data_incarcare, o.created_at) >= $${p.length}::date`; }
        if (r.to) { p.push(r.to); w += ` AND COALESCE(o.data_incarcare, o.created_at) < ($${p.length}::date + 1)`; }
        p.push(r.latest || 5);
        rows = await _q(ORDER_SELECT + ' WHERE ' + w + ` ORDER BY o.created_at DESC LIMIT $${p.length}`, p);
      }
      const have = new Set((data.orders || []).map((x) => x.number));
      data.orders = (data.orders || []).concat(rows.map(_orderBrief).filter((x) => !have.has(x.number)));
      labels.push({ k: 'orders', n: rows.length });
    } else if (r.type === 'order_stats') {
      const from = r.from || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      const to = r.to || new Date().toISOString().slice(0, 10);
      const s = (await _q(`SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status='Finalizat')::int AS closed,
             COUNT(*) FILTER (WHERE status IN ('Alocat','In Curs','Extern'))::int AS active,
             COALESCE(SUM((to_jsonb(o)->>'pret')::numeric) FILTER (WHERE status='Finalizat'),0)::float AS revenue_eur,
             COALESCE(SUM((to_jsonb(o)->>'km')::numeric) FILTER (WHERE status='Finalizat'),0)::float AS km
        FROM orders o WHERE company_id=$1 AND status <> 'Anulat'
         AND COALESCE(data_incarcare, created_at) >= $2::date AND COALESCE(data_incarcare, created_at) < ($3::date + 1)`, [cid, from, to]))[0] || {};
      data.order_stats = Object.assign({ from, to }, s);
      labels.push({ k: 'stats' });
    } else if (r.type === 'client') {
      const rows = await _q(`SELECT c.denumire AS name, c.cui_cif AS cui, c.localitate AS city, c.judet AS county, c.tara AS country,
             (to_jsonb(c)->>'payment_term_days') AS payment_term_days,
             (SELECT COUNT(*) FROM orders o WHERE o.company_id=c.company_id AND o.client_id=c.id AND o.status<>'Anulat')::int AS orders,
             (SELECT MAX(o.created_at)::date FROM orders o WHERE o.company_id=c.company_id AND o.client_id=c.id)::text AS last_order
        FROM clients c WHERE c.company_id=$1 AND c.denumire ILIKE $2 ORDER BY c.denumire LIMIT 3`, [cid, '%' + r.name.replace(/[%_\\]/g, '') + '%']);
      data.clients = (data.clients || []).concat(rows);
      labels.push({ k: 'client', n: rows.length });
    } else if (r.type === 'invoices') {
      const p = [cid]; let w = 'i.company_id=$1';
      if (r.client) { p.push('%' + r.client.replace(/[%_\\]/g, '') + '%'); w += ` AND i.client_name ILIKE $${p.length}`; }
      if (r.order) { const res = await resolveOrderRefs(cid, [r.order]); if (res.found[0]) { p.push(res.found[0].id); w += ` AND i.order_id = $${p.length}`; } }
      const rows = await _q(`SELECT i.serie, i.numar, i.total::float AS total, i.valuta, i.client_name AS client, i.created_at::date::text AS date,
             COALESCE(to_jsonb(o)->>'payment_status','') AS payment_status, COALESCE(to_jsonb(o)->>'fuvar_no', o.id) AS order_no
        FROM invoices i LEFT JOIN orders o ON o.id=i.order_id AND o.company_id=i.company_id
       WHERE ${w} AND COALESCE(i.status,'issued') <> 'cancelled' ORDER BY i.created_at DESC LIMIT 15`, p);
      data.invoices = (r.unpaid ? rows.filter((x) => x.payment_status !== 'paid') : rows).slice(0, 10);
      labels.push({ k: 'invoices', n: data.invoices.length });
    } else if (r.type === 'sent_mails') {
      const p = [cid]; let w = `company_id=$1 AND status='sent' AND COALESCE(mail_type,'') NOT IN ('builder_test')`;
      if (r.to) { p.push('%' + r.to.replace(/[%_\\]/g, '') + '%'); w += ` AND to_email ILIKE $${p.length}`; }
      p.push(r.latest);
      const rows = await _q(`SELECT id, subject, LEFT(COALESCE(body_text,''), 2500) AS text, created_at::text AS sent_at,
             (draft_json IS NOT NULL) AS restorable FROM mail_sent WHERE ${w} ORDER BY created_at DESC LIMIT $${p.length}`, p);
      // A címzett címét nem adjuk át (azt a szerver kezeli) — csak hogy volt-e.
      data.sent_mails = rows;
      labels.push({ k: 'sent', n: rows.length });
    } else if (r.type === 'company') {
      const c = (await _q(`SELECT to_jsonb(c) AS j FROM companies c WHERE c.id=$1`, [cid]))[0];
      const j = (c && c.j) || {};
      data.company = { name: j.nev || null, cui: j.cui || null, reg_com: j.reg_com || null, address: j.adresa || null,
        iban: j.iban || null, bank: j.banca || null, website: j.website || null };
      labels.push({ k: 'company' });
    } else if (r.type === 'vehicles') {
      const rows = await _q(`SELECT rendszam AS plate, tip AS type, marca AS brand FROM vehicles WHERE company_id=$1 AND COALESCE(activ,true) ORDER BY tip, rendszam LIMIT 40`, [cid]);
      data.vehicles = rows;
      labels.push({ k: 'vehicles', n: rows.length });
    }
  }
  let json = JSON.stringify(data);
  if (json.length > MAX_JSON) json = json.slice(0, MAX_JSON) + '…(truncated)';
  return { data, json, labels };
}

// ─── Fuvarkártyák a levélben (szerver-renderelt, inline CSS, e-mail-biztos) ───
function sanitizeCards(list) {
  return (Array.isArray(list) ? list : []).map((c) => {
    if (typeof c === 'string') return { ref: _s(c, 40) };
    if (c && typeof c === 'object') return c.latest ? { latest: _int(c.latest, 1, 10, 1) } : { ref: _s(c.ref || c.number, 40) };
    return null;
  }).filter((c) => c && (c.ref || c.latest)).slice(0, 10);
}
function sanitizeFields(list) {
  const f = (Array.isArray(list) ? list : []).filter((x) => CARD_FIELDS.includes(x));
  return f.length ? Array.from(new Set(f)) : null;
}

// A {latest:N} bejegyzéseket konkrét fuvarszámokra bontja (stabil a következő körökre).
async function expandCards(cid, cards) {
  const out = []; const notes = [];
  for (const c of cards) {
    if (c.latest) { (await latestOrders(cid, c.latest)).forEach((o) => out.push({ ref: o.fuvar_no })); continue; }
    const res = await resolveOrderRefs(cid, [c.ref]);
    if (res.found[0]) out.push({ ref: res.found[0].fuvar_no });
    else if (res.ambiguous[0]) notes.push({ type: 'card_ambiguous', ref: c.ref, options: res.ambiguous[0].options });
    else notes.push({ type: 'card_missing', ref: c.ref });
  }
  const seen = new Set();
  return { cards: out.filter((c) => (seen.has(c.ref) ? false : seen.add(c.ref))).slice(0, 10), notes };
}

const LBL = {
  route: { ro: 'Traseu', hu: 'Útvonal' }, loading: { ro: 'Încărcare', hu: 'Felrakás' }, unloading: { ro: 'Descărcare', hu: 'Lerakás' },
  cargo: { ro: 'Marfă', hu: 'Áru' }, vehicle: { ro: 'Vehicul', hu: 'Jármű' }, status: { ro: 'Stare', hu: 'Státusz' },
  price: { ro: 'Preț', hu: 'Ár' }, km: { ro: 'Distanță', hu: 'Távolság' }, ref: { ro: 'Referință', hu: 'Hivatkozás' }, client: { ro: 'Client', hu: 'Ügyfél' },
  order: { ro: 'Cursa', hu: 'Fuvar' },
};
const ICON = { route: '🛣️', loading: '⬆️', unloading: '⬇️', cargo: '📦', vehicle: '🚛', status: '●', price: '💶', km: '📏', ref: '🔖', client: '🏢' };

async function renderCards(cid, cards, opts) {
  opts = opts || {};
  const lang = opts.lang === 'hu' ? 'hu' : 'ro';
  const fields = sanitizeFields(opts.fields) || DEFAULT_FIELDS;
  const color = /^#[0-9a-f]{6}$/i.test(String(opts.accent || '')) ? opts.accent : '#2563eb';
  if (!cards || !cards.length) return '';
  const res = await resolveOrderRefs(cid, cards.map((c) => c.ref).filter(Boolean));
  const fmtN = (n) => Math.round(+n).toLocaleString(lang === 'hu' ? 'hu-HU' : 'ro-RO');
  return res.found.map((o) => {
    const val = {
      route: [o.loc_incarcare, o.loc_descarcare].filter(Boolean).join(' → '),
      loading: [o.loc_incarcare, o.data_incarcare].filter(Boolean).join(' · '),
      unloading: [o.loc_descarcare, o.data_descarcare].filter(Boolean).join(' · '),
      cargo: [o.suly_kg ? fmtN(o.suly_kg) + ' kg' : null, o.load_type].filter(Boolean).join(' · '),
      vehicle: [o.rendszam_camion, o.rendszam_remorca].filter(Boolean).join(' / '),
      status: (STATUS[o.status] || {})[lang] || o.status,
      price: o.pret != null && o.pret !== '' ? fmtN(o.pret) + ' EUR' : '',
      km: o.km != null && o.km !== '' ? fmtN(o.km) + ' km' : '',
      ref: o.ref || '', client: o.client || '',
    };
    const rows = fields.filter((f) => val[f]).map((f) =>
      '<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top;">' + ICON[f] + ' ' + esc(LBL[f][lang]) + '</td>'
      + '<td style="padding:4px 0;font-size:13.5px;font-weight:600;color:#111827;">' + esc(val[f]) + '</td></tr>').join('');
    return '<div style="border:2px solid ' + color + ';border-radius:10px;margin:12px 0;background:' + tint(color, 0.06) + ';overflow:hidden;">'
      + '<div style="background:' + color + ';color:' + readableOn(color) + ';padding:8px 14px;font-weight:800;font-size:14px;">🚚 ' + esc(LBL.order[lang]) + ' ' + esc(o.fuvar_no) + '</div>'
      + '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 14px 10px;">' + rows + '</table></div>';
  }).join('');
}

module.exports = { resolveOrderRefs, latestOrders, sanitizeRequests, fetchData, sanitizeCards, sanitizeFields, expandCards, renderCards, CARD_FIELDS, DEFAULT_FIELDS };
