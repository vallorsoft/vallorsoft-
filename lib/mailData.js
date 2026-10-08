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
const MAX_LIST = 500;       // egy szűrt fuvar-lista felső korlátja (teljes időszak)
const MAX_AI_ROWS = 40;     // ennyi fuvar-sor megy tételesen az AI-hoz, a többi csak összesítve
const MAX_CARDS = 300;      // kártya / táblázat-sor egy levélben
const TABLE_FROM = 9;       // ennyi fuvartól kompakt táblázat a kártyák helyett
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

// ─── Szűrt fuvar-lekérdezés (adat-kérés ÉS kártya-lekérdezés közös alapja) ───
// q: { driver, vehicle, client, status, from, to, all }. Időszak nélkül = TELJES időszak.
function sanitizeQuery(r) {
  r = r || {};
  return { driver: _s(r.driver, 80), vehicle: _s(r.vehicle, 20), client: _s(r.client, 80),
    status: (STATUS[r.status] || STATUS_GROUPS[r.status]) ? r.status : null, from: _date(r.from), to: _date(r.to), all: r.all === true };
}
// Státusz-csoportok: „aktív / kiosztott, még nem kész" és „nyitott (nem lezárt)".
const STATUS_GROUPS = { active: ['Alocat', 'In Curs', 'Extern'], open: ['Disponibil', 'Alocat', 'In Curs', 'Extern', 'Parkolt', 'Raktarban'] };
const _hasFilter = (q) => !!(q.driver || q.vehicle || q.client || q.status || q.from || q.to || q.all);
const _foldN = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const _plate = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Sofőr név / becenév → a cég sofőrje(i). Csak a szerveren — az AI e-mailt/telefont nem kap.
// Visszaad: { emails:[], names:[], ambiguous:[nevek] }.
async function resolveDriver(cid, name) {
  const f = _foldN(name);
  if (!f) return { emails: [], names: [], ambiguous: [] };
  const drivers = await _q(`SELECT LOWER(email) AS email, nume FROM users WHERE company_id=$1 AND pozicio='Sofer'`, [cid]);
  const toks = f.split(' ').filter((t) => t.length >= 2);
  const scored = drivers.map((d) => {
    const dn = _foldN(d.nume).split(' ').filter(Boolean);
    const hit = toks.filter((t) => dn.some((w) => w === t || (t.length >= 3 && (w.startsWith(t) || t.startsWith(w) && w.length >= 3)))).length;
    return { d, hit, full: _foldN(d.nume) === f };
  }).filter((x) => x.hit > 0);
  let best = scored.filter((x) => x.full);
  if (!best.length && scored.length) { const m = Math.max(...scored.map((x) => x.hit)); best = scored.filter((x) => x.hit === m); }
  if (!best.length) {
    // Tanult becenév (a 💬 fuvarkiírásból vagy a levél-chatből).
    const al = (await _q(`SELECT value->>'email' AS email FROM order_chat_memory WHERE company_id=$1 AND kind='driver_alias' AND key_norm=$2`, [cid, f]))[0];
    const d = al && drivers.find((x) => x.email === String(al.email || '').toLowerCase());
    if (d) return { emails: [d.email], names: [d.nume], ambiguous: [], learned: true };
  }
  if (best.length === 1) return { emails: [best[0].d.email], names: [best[0].d.nume], ambiguous: [] };
  if (best.length > 1) return { emails: [], names: [], ambiguous: best.map((x) => x.d.nume).slice(0, 6) };
  return { emails: [], names: [], ambiguous: [] };
}

// WHERE-építő. Visszaad { w, p, notes } — a notes a feloldási problémák (nincs ilyen sofőr / több is illik).
async function buildOrderWhere(cid, q) {
  const p = [cid]; let w = `o.company_id=$1 AND o.status <> 'Anulat'`; const notes = {};
  if (q.driver) {
    const dr = await resolveDriver(cid, q.driver);
    if (dr.emails.length) {
      p.push(dr.emails); const a = p.length;
      p.push(dr.names); const b = p.length;
      // A fuvar a sofőrhöz kötött e-mail VAGY (régi/kézi fuvarnál) a beírt sofőrnév szerint.
      w += ` AND (LOWER(COALESCE(o.email_sofer,'')) = ANY($${a}) OR LOWER(COALESCE(o.nume_sofer,'')) = ANY(SELECT LOWER(x) FROM unnest($${b}::text[]) x))`;
      notes.driver = dr.names[0];
      if (dr.learned) notes.driver_learned = true;
    } else if (dr.ambiguous.length) { notes.driver_ambiguous = dr.ambiguous; w += ' AND false'; }
    else {
      // Nincs ilyen felhasználó → a fuvaron kézzel beírt sofőrnév szerint (pl. külsős).
      p.push('%' + q.driver.replace(/[%_\\]/g, '') + '%'); w += ` AND COALESCE(o.nume_sofer,'') ILIKE $${p.length}`;
      notes.driver_free = q.driver;
    }
  }
  if (q.vehicle) {
    p.push(_plate(q.vehicle));
    w += ` AND ($${p.length} = regexp_replace(UPPER(COALESCE(to_jsonb(o)->>'rendszam_camion','')),'[^A-Z0-9]','','g')
               OR $${p.length} = regexp_replace(UPPER(COALESCE(to_jsonb(o)->>'rendszam_remorca','')),'[^A-Z0-9]','','g'))`;
  }
  if (q.client) { p.push('%' + q.client.replace(/[%_\\]/g, '') + '%'); w += ` AND o.client ILIKE $${p.length}`; }
  if (q.status) { p.push(STATUS_GROUPS[q.status] || [q.status]); w += ` AND o.status = ANY($${p.length})`; }
  if (q.from) { p.push(q.from); w += ` AND COALESCE(o.data_incarcare, o.created_at) >= $${p.length}::date`; }
  if (q.to) { p.push(q.to); w += ` AND COALESCE(o.data_incarcare, o.created_at) < ($${p.length}::date + 1)`; }
  return { w, p, notes };
}

// Szűrt fuvarok, időrendben (legrégebbi elöl — egy kimutatásban így természetes).
async function queryOrders(cid, q, limit) {
  const b = await buildOrderWhere(cid, q);
  b.p.push(_int(limit, 1, MAX_LIST, MAX_LIST));
  const rows = await _q(ORDER_SELECT + ' WHERE ' + b.w
    + ` ORDER BY COALESCE(o.data_incarcare, o.created_at::date) ASC, o.created_at ASC LIMIT $${b.p.length}`, b.p);
  return { rows, notes: b.notes };
}

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
    return (await pool.query(ORDER_SELECT + ` WHERE o.company_id=$1 AND o.status <> 'Anulat' ORDER BY o.created_at DESC LIMIT $2`, [cid, _int(n, 1, 50, 2)])).rows;
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
      out.push(Object.assign({ type: t, latest: r.latest ? _int(r.latest, 1, 50, 2) : null,
        refs: (Array.isArray(r.refs) ? r.refs : []).map((x) => _s(x, 40)).filter(Boolean).slice(0, 10) }, sanitizeQuery(r)));
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
      } else if (_hasFilter(r)) {
        // Szűrt kérés (sofőr / jármű / ügyfél / státusz / időszak): időszak nélkül a TELJES
        // időszakot nézzük, és MINDEN találatot (nem csak az utolsó néhányat).
        const res = await queryOrders(cid, r, r.all ? MAX_LIST : (r.latest || MAX_LIST));
        rows = res.rows;
        const sum = { total: rows.length, filter: _queryEcho(r, res.notes),
          first_date: rows.length ? (rows[0].data_incarcare || String(rows[0].created_at).slice(0, 10)) : null,
          last_date: rows.length ? (rows[rows.length - 1].data_incarcare || String(rows[rows.length - 1].created_at).slice(0, 10)) : null,
          by_status: rows.reduce((a, o) => { a[o.status] = (a[o.status] || 0) + 1; return a; }, {}),
          card_query: Object.assign({}, sanitizeQuery(r), { all: true }) };
        if (res.notes.driver_ambiguous) sum.driver_ambiguous = res.notes.driver_ambiguous;
        if (rows.length >= MAX_LIST) sum.capped_at = MAX_LIST;
        data.orders_summary = (data.orders_summary || []).concat([sum]);
      } else {
        rows = await latestOrders(cid, r.latest || 5);
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
  return { data, json: compactJson(data), labels };
}

// Az AI felé: a fuvar-lista tételesen max MAX_AI_ROWS sor, a többi csak az összesítőben
// (darabszám, időszak, státusz-bontás) — sosem vágunk félbe JSON-t.
function compactJson(data) {
  const d = Object.assign({}, data);
  if (Array.isArray(d.orders) && d.orders.length > MAX_AI_ROWS) {
    d.orders_listed = MAX_AI_ROWS; d.orders_total = d.orders.length;
    d.orders = d.orders.slice(0, MAX_AI_ROWS).map((o) => ({ number: o.number, route: o.route, loading: o.loading, status: o.status }));
    d.note = 'Only the first ' + MAX_AI_ROWS + ' orders are listed; ALL ' + d.orders_total + ' are included in the letter via the card_query card.';
  }
  let json = JSON.stringify(d);
  while (json.length > MAX_JSON && Array.isArray(d.orders) && d.orders.length > 5) {
    d.orders = d.orders.slice(0, Math.floor(d.orders.length * 0.7));
    d.orders_listed = d.orders.length;
    json = JSON.stringify(d);
  }
  if (json.length > MAX_JSON) json = json.slice(0, MAX_JSON) + '…';
  return json;
}

function _queryEcho(q, notes) {
  const o = {};
  if (notes.driver || q.driver) o.driver = notes.driver || q.driver;
  ['vehicle', 'client', 'status', 'from', 'to'].forEach((k) => { if (q[k]) o[k] = q[k]; });
  if (!q.from && !q.to) o.period = 'all time';
  return o;
}

// ─── Fuvarkártyák a levélben (szerver-renderelt, inline CSS, e-mail-biztos) ───
// Egy kártya-bejegyzés: {ref} (egy fuvar) | {latest:N} | {query:{driver,vehicle,client,status,from,to,all}}
// (= MINDEN illeszkedő fuvar, küldéskor élőben lekérve — nem kell felsorolni őket).
function sanitizeCards(list) {
  return (Array.isArray(list) ? list : []).map((c) => {
    if (typeof c === 'string') return { ref: _s(c, 40) };
    if (c && typeof c === 'object') {
      if (c.query && typeof c.query === 'object') { const q = sanitizeQuery(c.query); return _hasFilter(q) ? { query: q } : null; }
      return c.latest ? { latest: _int(c.latest, 1, 50, 1) } : { ref: _s(c.ref || c.number, 40) };
    }
    return null;
  }).filter((c) => c && (c.ref || c.latest || c.query)).slice(0, MAX_CARDS);
}
function sanitizeFields(list) {
  const f = (Array.isArray(list) ? list : []).filter((x) => CARD_FIELDS.includes(x));
  return f.length ? Array.from(new Set(f)) : null;
}
const cardKey = (c) => (c.ref ? c.ref : c.query ? 'Q:' + JSON.stringify(c.query) : 'L:' + c.latest);

// A {latest:N} bejegyzéseket konkrét fuvarszámokra bontja (stabil a következő körökre);
// a {query} megmarad (élő lista), csak ellenőrizzük, hogy talál-e valamit.
async function expandCards(cid, cards) {
  const out = []; const notes = [];
  for (const c of cards) {
    if (c.latest) { (await latestOrders(cid, c.latest)).forEach((o) => out.push({ ref: o.fuvar_no })); continue; }
    if (c.query) {
      const res = await queryOrders(cid, c.query, MAX_LIST);
      if (res.notes.driver_ambiguous) notes.push({ type: 'driver_ambiguous', ref: c.query.driver, options: res.notes.driver_ambiguous });
      else if (!res.rows.length) notes.push({ type: 'query_empty', ref: queryLabel(c.query) });
      out.push(c); continue;
    }
    const res = await resolveOrderRefs(cid, [c.ref]);
    if (res.found[0]) out.push({ ref: res.found[0].fuvar_no });
    else if (res.ambiguous[0]) notes.push({ type: 'card_ambiguous', ref: c.ref, options: res.ambiguous[0].options });
    else notes.push({ type: 'card_missing', ref: c.ref });
  }
  const seen = new Set();
  return { cards: out.filter((c) => { const k = cardKey(c); return seen.has(k) ? false : seen.add(k); }).slice(0, MAX_CARDS), notes };
}

function queryLabel(q, lang) {
  const hu = lang === 'hu';
  const parts = [];
  if (q.driver) parts.push((hu ? 'sofőr: ' : 'șofer: ') + q.driver);
  if (q.vehicle) parts.push(q.vehicle);
  if (q.client) parts.push(q.client);
  if (q.status) parts.push(STATUS_GROUPS[q.status] ? (q.status === 'active' ? (hu ? 'aktív' : 'active') : (hu ? 'nyitott' : 'deschise')) : ((STATUS[q.status] || {})[hu ? 'hu' : 'ro'] || q.status));
  if (q.from || q.to) parts.push((q.from || '…') + ' – ' + (q.to || '…'));
  else parts.push(hu ? 'teljes időszak' : 'toată perioada');
  return parts.join(' · ');
}

// Kártyák → fuvar-sorok (sorrend megtartva, duplikátum nélkül). Fuvarszámokat egy
// lekérdezésben oldjuk fel; ami nem illik pontosan, arra a rugalmas feloldás jön.
async function _cardOrders(cid, cards) {
  const out = []; const seen = new Set();
  const push = (o) => { if (o && !seen.has(o.id)) { seen.add(o.id); out.push(o); } };
  const refs = cards.filter((c) => c.ref).map((c) => String(c.ref).toUpperCase());
  const byRef = new Map();
  if (refs.length) {
    (await _q(ORDER_SELECT + ` WHERE o.company_id=$1 AND (UPPER(COALESCE(to_jsonb(o)->>'fuvar_no', o.id)) = ANY($2) OR UPPER(o.id) = ANY($2))`, [cid, refs]))
      .forEach((o) => { byRef.set(String(o.fuvar_no).toUpperCase(), o); byRef.set(String(o.id).toUpperCase(), o); });
  }
  for (const c of cards) {
    if (out.length >= MAX_CARDS) break;
    if (c.query) { (await queryOrders(cid, c.query, MAX_LIST)).rows.forEach(push); continue; }
    if (c.latest) { (await latestOrders(cid, c.latest)).forEach(push); continue; }
    let o = byRef.get(String(c.ref).toUpperCase());
    if (!o) { const r = await resolveOrderRefs(cid, [c.ref]); o = r.found[0]; }
    push(o);
  }
  return out.slice(0, MAX_CARDS);
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
  const orders = await _cardOrders(cid, sanitizeCards(cards));
  const fmtN = (n) => Math.round(+n).toLocaleString(lang === 'hu' ? 'hu-HU' : 'ro-RO');
  const valOf = (o) => ({
      route: [o.loc_incarcare, o.loc_descarcare].filter(Boolean).join(' → '),
      loading: [o.loc_incarcare, o.firma_incarcare, o.data_incarcare].filter(Boolean).join(' · '),
      unloading: [o.loc_descarcare, o.firma_descarcare, o.data_descarcare].filter(Boolean).join(' · '),
      cargo: [o.suly_kg ? fmtN(o.suly_kg) + ' kg' : null, o.load_type].filter(Boolean).join(' · '),
      vehicle: [o.rendszam_camion, o.rendszam_remorca].filter(Boolean).join(' / '),
      status: (STATUS[o.status] || {})[lang] || o.status,
      price: o.pret != null && o.pret !== '' ? fmtN(o.pret) + ' EUR' : '',
      km: o.km != null && o.km !== '' ? fmtN(o.km) + ' km' : '',
      ref: o.ref || '', client: o.client || '',
  });
  // Sok fuvar → egyetlen kompakt táblázat (egy sor / fuvar), hogy a levél olvasható maradjon.
  if (orders.length >= TABLE_FROM) {
    const th = 'padding:6px 8px;border-bottom:2px solid ' + color + ';text-align:left;font-size:12px;color:#374151;white-space:nowrap;';
    const td = 'padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12.5px;color:#111827;vertical-align:top;';
    const cols = fields.filter((f) => f !== 'route' || !fields.includes('loading'));
    return '<div style="margin:12px 0;overflow-x:auto;"><div style="background:' + color + ';color:' + readableOn(color) + ';padding:8px 12px;font-weight:800;font-size:14px;border-radius:8px 8px 0 0;">🚚 '
      + esc(LBL.order[lang]) + ' · ' + orders.length + '</div>'
      + '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;background:' + tint(color, 0.04) + ';">'
      + '<tr><th style="' + th + '">#</th><th style="' + th + '">' + esc(LBL.order[lang]) + '</th>' + cols.map((f) => '<th style="' + th + '">' + esc(LBL[f][lang]) + '</th>').join('') + '</tr>'
      + orders.map((o, i) => { const v = valOf(o); return '<tr><td style="' + td + 'color:#6b7280;">' + (i + 1) + '</td><td style="' + td + 'font-weight:700;white-space:nowrap;">' + esc(o.fuvar_no) + '</td>'
        + cols.map((f) => '<td style="' + td + '">' + esc(v[f] || '—') + '</td>').join('') + '</tr>'; }).join('')
      + '</table></div>';
  }
  return orders.map((o) => {
    const val = valOf(o);
    const rows = fields.filter((f) => val[f]).map((f) =>
      '<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top;">' + ICON[f] + ' ' + esc(LBL[f][lang]) + '</td>'
      + '<td style="padding:4px 0;font-size:13.5px;font-weight:600;color:#111827;">' + esc(val[f]) + '</td></tr>').join('');
    return '<div style="border:2px solid ' + color + ';border-radius:10px;margin:12px 0;background:' + tint(color, 0.06) + ';overflow:hidden;">'
      + '<div style="background:' + color + ';color:' + readableOn(color) + ';padding:8px 14px;font-weight:800;font-size:14px;">🚚 ' + esc(LBL.order[lang]) + ' ' + esc(o.fuvar_no) + '</div>'
      + '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 14px 10px;">' + rows + '</table></div>';
  }).join('');
}

module.exports = { cardKey, queryLabel, sanitizeQuery, resolveDriver, buildOrderWhere, queryOrders, compactJson, STATUS_GROUPS, MAX_LIST, TABLE_FROM, MAX_CARDS, resolveOrderRefs, latestOrders, sanitizeRequests, fetchData, sanitizeCards, sanitizeFields, expandCards, renderCards, CARD_FIELDS, DEFAULT_FIELDS };
