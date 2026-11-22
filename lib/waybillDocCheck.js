// ============================================================
//  VallorSoft — lib/waybillDocCheck.js
//  Menetlevél dokumentum-csomag ellenőrzése — HELYBEN, AI és külső szolgáltató
//  NÉLKÜL (lib/docPrivacy: irat a saját szerverünkről nem megy ki).
//
//  SZABÁLY (a tulajdonos döntése, 2026-11-22):
//   • A menetlevélhez azoknak a fuvaroknak az iratai kellenek, amelyeknek a
//     LERAKÁSA a menetlevélen szerepel (puncte: Descarcare / role='unloading').
//     A menetlevélen lévő, de itt még nem lerakott fuvar NEM kell, és nem számít
//     elvégzettnek (⏳ folyamatban) — az irata annál a menetlevélnél kell, ahol
//     a lerakása szerepel.
//   • Fuvaronként: ügyfél-megrendelő + az ügyfélnek kiállított számla; ha a
//     fuvarnak alvállalkozója van (orders.carrier_id): + az alvállalkozónak
//     küldött megrendelő + az alvállalkozó számlája. Alvállalkozó nélkül ez a
//     kettő nem kell.
//   • A rendszer nem állít ki hivatalos iratot → mindegyik feltöltött PDF.
//   • Az ellenőrzés gomb nélkül, a háttérben fut, amíg a csomag nem teljes; a
//     felhasználó csak visszaigazol (✓ / ✗) — ebből tanul.
//
//  Módszer: a fuvar ISMERT adatait keressük a PDF szövegrétegében (fuvar-szám,
//  ügyfél-referencia, CUI, cégnév, összeg, rendszám, város, dátum) — súlyozott
//  pontszám → biztonság %.  Szkennelt PDF / fotó: „nem olvasható", kézi döntés.
// ============================================================
'use strict';

const crypto = require('crypto');
const { parseInvoiceText, normName, digits } = require('./invoiceText');
const { cityQuery } = require('./stopMatch');

const SLOTS = ['client_order', 'client_invoice', 'carrier_order', 'carrier_invoice'];
// A kötelező-csomag ellenőrzésébe bevont iratfajták (a CMR, POD-fotó, GPS-útvonal stb. nem).
const CHECK_TYPES = new Set(['order_doc', 'order', 'invoice', 'assignment', 'other', 'contract', '']);
const OK_CONF = 85;        // e fölött ✅ zöld
const REVIEW_CONF = 50;    // e fölött 🟡 megerősítés kell, alatta ❗ gyenge
const ASSIGN_MIN = 30;     // ennél kisebb pontszámmal nem párosítunk
const MAX_TEXT = 60000;    // a tárolt szöveg felső korlátja

// ── Szöveg-normalizálás ─────────────────────────────────────
function wordNorm(s) {
  return ' ' + String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
}
function compact(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
}

// ── Mely fuvarok lerakása szerepel a menetlevélen ───────────
// puncte: [{ tip, role, orderId, stopId }], stopOrder: { stopId: orderId }
// → { required: [orderId], legacy: bool }  (legacy = a pontok nincsenek fuvarhoz kötve)
function unloadedOrderIds(puncte, stopOrder) {
  const list = Array.isArray(puncte) ? puncte : [];
  const so = stopOrder || {};
  const out = [];
  let tagged = false;
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const isUnload = p.role === 'unloading' || /^desc[aă]rcare$/i.test(String(p.tip || '').trim());
    if (!isUnload) continue;
    const oid = p.orderId ? String(p.orderId) : (p.stopId != null && so[String(p.stopId)] ? String(so[String(p.stopId)]) : null);
    if (!oid) continue;
    tagged = true;
    if (!out.includes(oid)) out.push(oid);
  }
  return { required: out, legacy: !tagged };
}

// ── Irat-fajta a szövegből ──────────────────────────────────
// → 'invoice' | 'order' | null
const ORDER_KW = /comand[aă]\s+(de\s+)?transport|ordin\s+de\s+transport|transport\s*order|contract\s+de\s+transport|\bcomand[aă]\b|\bauftrag\b|megrendel|fuvarmegb[ií]z|zlecenie/i;
function textKind(text, inv) {
  const t = String(text || '');
  if (!t.trim()) return null;
  const head = t.slice(0, 1500);
  const isInv = /factur/i.test(head) && !!(inv && inv.invoice_no);
  const isOrd = ORDER_KW.test(head);
  if (isInv && !/^\s*comand/i.test(head)) return 'invoice';
  if (isOrd) return 'order';
  if (isInv) return 'invoice';
  if (/factur/i.test(t) && inv && inv.invoice_no) return 'invoice';
  if (ORDER_KW.test(t)) return 'order';
  return null;
}
function typeHintKind(docType) {
  if (docType === 'invoice') return 'invoice';
  if (docType === 'assignment' || docType === 'order' || docType === 'contract') return 'order';
  return null;
}

// ── Összeg keresése a szövegben (1500 → „1500", „1.500", „1 500", „1,500.00") ──
function amountIn(text, amount) {
  const n = Number(amount);
  if (!isFinite(n) || n <= 0) return false;
  const vals = [n, Math.round(n * 1.21 * 100) / 100];
  return vals.some((v) => {
    const int = Math.floor(v), cents = Math.round((v - int) * 100);
    const s = String(int);
    const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, '[ ., ]?');
    const dec = cents ? '[.,]' + String(cents).padStart(2, '0') : '(?:[.,]00)?';
    const re = new RegExp('(^|[^\\d.,])' + grouped + dec + '(?![\\d])');
    return re.test(text);
  });
}
function dateIn(text, iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return false;
  const [, y, mo, d] = m;
  const pats = [y + '-' + mo + '-' + d, d + '.' + mo + '.' + y, d + '/' + mo + '/' + y, d + '-' + mo + '-' + y,
    (+d) + '.' + (+mo) + '.' + y];
  return pats.some((p) => text.includes(p));
}
function cityIn(wtext, loc) {
  const c = wordNorm(cityQuery(loc)).trim();
  return c.length >= 3 && wtext.includes(' ' + c + ' ');
}

// ── Egy irat ↔ fuvar ↔ oldal (ügyfél / alvállalkozó) pontszáma ──
// doc: { id, order_id, text, inv, kind }   order: (orders sor + kliens/alvállalkozó)
// side: 'client' | 'carrier'.   → { score, reasons[], cuiMismatch }
function scoreDocOrder(doc, order, side, ownCui) {
  const text = String(doc.text || '');
  const wt = wordNorm(text), ct = compact(text);
  let score = 0;
  const reasons = [];
  const add = (pts, key, val) => { score += pts; reasons.push(val ? key + ':' + val : key); };

  if (doc.order_id && doc.order_id === order.id) add(20, 'linked');
  const fno = compact(order.fuvar_no);
  if (fno.length >= 6 && ct.includes(fno)) add(40, 'fuvar_no', order.fuvar_no);
  const ref = compact(order.ref);
  if (ref.length >= 4 && ct.includes(ref) && ref !== fno) add(40, 'ref', order.ref);

  const cuis = (doc.inv && doc.inv.cuis) || [];
  const sideCui = digits(side === 'carrier' ? order.carrier_cui : order.client_cui);
  const sideName = side === 'carrier' ? order.carrier_nev : (order.client_denumire || order.client);
  let cuiMismatch = null;
  if (sideCui && cuis.includes(sideCui)) add(30, 'cui', sideCui);
  else {
    const k = normName(sideName);
    if (k.length >= 3 && (' ' + normName(text) + ' ').includes(' ' + k + ' ')) add(15, 'name', sideName);
    const others = cuis.filter((x) => x !== digits(ownCui) && x !== digits(order.client_cui) && x !== digits(order.carrier_cui));
    if (sideCui && others.length) { score -= 25; cuiMismatch = others[0]; reasons.push('other_cui:' + others[0]); }
  }
  const amt = side === 'carrier' ? order.carrier_cost : order.pret;
  if (amountIn(text, amt)) add(15, 'amount', String(amt));
  const plate = compact(order.rendszam_camion);
  if (plate.length >= 5 && ct.includes(plate)) add(10, 'plate', order.rendszam_camion);
  if (cityIn(wt, order.loc_incarcare)) add(8, 'load_city', cityQuery(order.loc_incarcare));
  if (cityIn(wt, order.loc_descarcare)) add(8, 'unload_city', cityQuery(order.loc_descarcare));
  if (dateIn(text, order.data_incarcare) || dateIn(text, order.data_descarcare)) add(5, 'date');
  return { score: Math.max(0, Math.min(99, score)), reasons, cuiMismatch };
}

// Az irat melyik oldalé (ügyfél vagy alvállalkozó)? → ['client'] | ['carrier'] | mindkettő
function sidesFor(doc, order) {
  if (!order.carrier_id) return ['client'];
  const cuis = (doc.inv && doc.inv.cuis) || [];
  const t = ' ' + normName(doc.text) + ' ';
  const hasCarrier = (digits(order.carrier_cui) && cuis.includes(digits(order.carrier_cui))) ||
    (normName(order.carrier_nev).length >= 3 && t.includes(' ' + normName(order.carrier_nev) + ' '));
  const hasClient = (digits(order.client_cui) && cuis.includes(digits(order.client_cui))) ||
    (normName(order.client_denumire || order.client).length >= 3 && t.includes(' ' + normName(order.client_denumire || order.client) + ' '));
  if (hasCarrier && !hasClient) return ['carrier'];
  if (hasClient && !hasCarrier) return ['client'];
  if (doc.from_assignment) return ['carrier'];
  return ['client', 'carrier'];
}

function level(conf, confirmed, unreadable) {
  if (confirmed) return 'ok';
  if (unreadable) return 'unreadable';
  if (conf >= OK_CONF) return 'ok';
  if (conf >= REVIEW_CONF) return 'review';
  return 'low';
}

// ── A teljes kiértékelés (tiszta függvény) ──────────────────
// input: { orders:[order], requiredIds:[id], docs:[doc], decisions:[{doc_id,order_id,slot,verdict}], ownCui, assignmentOrders:Set }
function evaluate(input) {
  const orders = input.orders || [];
  const byId = {};
  orders.forEach((o) => { byId[o.id] = o; });
  const required = (input.requiredIds || []).filter((id) => byId[id]);
  const decisions = input.decisions || [];
  const rejected = new Set(decisions.filter((d) => d.verdict === 'no').map((d) => d.doc_id + '|' + d.order_id + '|' + d.slot));
  const confirmed = decisions.filter((d) => d.verdict === 'ok');
  const docs = (input.docs || []).filter((d) => CHECK_TYPES.has(d.doc_type || ''));

  const slotsOf = (o) => o.carrier_id ? SLOTS : SLOTS.slice(0, 2);
  const filled = {};   // orderId|slot → assignment
  const usedDoc = new Set();
  const put = (o, slot, d, conf, reasons, extra) => {
    filled[o.id + '|' + slot] = Object.assign({ slot, doc_id: d.id, file_name: d.file_name, conf, reasons: reasons || [] }, extra || {});
    usedDoc.add(d.id);
  };

  // 1) a felhasználó által visszaigazolt párok
  for (const c of confirmed) {
    const o = byId[c.order_id];
    const d = docs.find((x) => x.id === c.doc_id);
    if (!o || !d || !required.includes(o.id) || filled[o.id + '|' + c.slot] || usedDoc.has(d.id)) continue;
    if (!slotsOf(o).includes(c.slot)) continue;
    put(o, c.slot, d, 100, ['confirmed'], { confirmed: true });
  }

  // 2) olvasható iratok pontozása → mohó párosítás a legjobb pontszám szerint
  const pairs = [];
  const bestAny = {};  // docId → { score, order_id } bármely menetlevél-fuvarral
  for (const d of docs) {
    if (usedDoc.has(d.id) || !d.text) continue;
    const kind = d.kind || typeHintKind(d.doc_type);
    for (const o of orders) {
      for (const side of sidesFor(d, o)) {
        const sc = scoreDocOrder(d, o, side, input.ownCui);
        if (!bestAny[d.id] || sc.score > bestAny[d.id].score) bestAny[d.id] = { score: sc.score, order_id: o.id, cuiMismatch: sc.cuiMismatch };
        if (!required.includes(o.id)) continue;
        const kinds = kind ? [kind] : ['order', 'invoice'];
        for (const k of kinds) {
          const slot = side + '_' + k;
          if (!slotsOf(o).includes(slot)) continue;
          if (rejected.has(d.id + '|' + o.id + '|' + slot)) continue;
          // ismeretlen fajta → kisebb biztonság
          const s = kind ? sc.score : Math.round(sc.score * 0.8);
          if (s < ASSIGN_MIN) continue;
          pairs.push({ d, o, slot, score: s, reasons: sc.reasons.concat(kind ? [] : ['kind_unknown']) });
        }
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  for (const p of pairs) {
    if (usedDoc.has(p.d.id) || filled[p.o.id + '|' + p.slot]) continue;
    put(p.o, p.slot, p.d, p.score, p.reasons);
  }

  // 3) nem olvasható irat (fotó / szkennelt PDF): ha a fuvarhoz kötötték és a típusa
  //    egyértelmű, a helyét elfoglalja — kézi megerősítéssel.
  for (const d of docs) {
    if (usedDoc.has(d.id) || d.text) continue;
    const o = byId[d.order_id];
    const kind = typeHintKind(d.doc_type);
    if (!o || !required.includes(o.id) || !kind) continue;
    const slot = (d.from_assignment ? 'carrier' : (o.carrier_id && filled[o.id + '|client_' + kind] ? 'carrier' : 'client')) + '_' + kind;
    if (!slotsOf(o).includes(slot) || filled[o.id + '|' + slot] || rejected.has(d.id + '|' + o.id + '|' + slot)) continue;
    put(o, slot, d, null, ['unreadable'], { unreadable: true });
  }

  // 4) eredmény fuvaronként
  let missing = 0, review = 0;
  const outOrders = orders.map((o) => {
    const isReq = required.includes(o.id);
    const slots = isReq ? slotsOf(o).map((slot) => {
      const f = filled[o.id + '|' + slot];
      if (!f) {
        missing++;
        const hint = slot === 'carrier_order' && input.assignmentOrders && input.assignmentOrders.has(o.id) ? 'assignment_in_system' : null;
        return { slot, level: 'missing', hint };
      }
      const lv = level(f.conf, f.confirmed, f.unreadable);
      if (lv !== 'ok') review++;
      return Object.assign({}, f, { level: lv });
    }) : [];
    return { id: o.id, fuvar_no: o.fuvar_no, client: o.client_denumire || o.client, carrier: o.carrier_nev || null,
      loc_incarcare: o.loc_incarcare, loc_descarcare: o.loc_descarcare,
      state: isReq ? 'unloaded' : 'in_progress', slots };
  });

  // 5) be nem sorolt iratok: más fuvaré / dupla / nem ide tartozik
  const foreign = [], extra = [];
  for (const d of docs) {
    if (usedDoc.has(d.id)) continue;
    if (!d.text) { extra.push({ doc_id: d.id, file_name: d.file_name, reason: 'unreadable' }); continue; }
    const b = bestAny[d.id];
    if (b && b.score >= ASSIGN_MIN) {
      extra.push({ doc_id: d.id, file_name: d.file_name, order_id: b.order_id,
        reason: required.includes(b.order_id) ? 'duplicate' : 'other_waybill' });
    } else {
      foreign.push({ doc_id: d.id, file_name: d.file_name, conf: b ? b.score : 0, other_cui: b ? b.cuiMismatch : null });
    }
  }
  const status = !required.length ? 'none' : (missing || foreign.length || review ? 'incomplete' : 'complete');
  return { status, required_cnt: required.length, missing_cnt: missing, wrong_cnt: foreign.length, review_cnt: review,
    orders: outOrders, foreign, extra };
}

// ============================================================
//  DB-réteg
// ============================================================
let _pool = null;
function _db() { return _pool || (_pool = require('../db')); }
const _isMissing = (e) => e && (e.code === '42P01' || e.code === '42703');

// Az irat szövege (cache-elve az order_documents-ben, a saját DB-nkben).
async function docText(db, row) {
  if (row.text_status) return { text: row.text_status === 'ok' ? (row.text_cache || '') : '', status: row.text_status };
  let b64 = String(row.original_base64 || row.signed_base64 || '');
  const name = String(row.file_name || '').toLowerCase();
  const isPdf = /^data:application\/pdf/i.test(b64) || (!b64.startsWith('data:') && /\.pdf$/.test(name)) || b64.startsWith('JVBER');
  let status = 'image', text = '';
  if (isPdf && b64) {
    try {
      const buf = Buffer.from(b64.slice(b64.indexOf(',') + 1), 'base64');
      const r = await require('../services/pdf-extract').extractText(buf);
      status = r.scanned ? 'scanned' : 'ok';
      text = r.scanned ? '' : String(r.text || '').slice(0, MAX_TEXT);
    } catch (e) { status = 'error'; }
  }
  try {
    await db.query('UPDATE order_documents SET text_cache=$2, text_status=$3, text_at=NOW() WHERE id=$1',
      [row.id, text || null, status]);
  } catch (_) { /* migráció előtt: nincs cache */ }
  return { text, status };
}

async function _load(db, cid, wid) {
  const w = await db.query(
    `SELECT id, numar_fisa, puncte, order_ids FROM fuvarlevelek
      WHERE id=$1 AND (company_id=$2 OR email_sofer IN (SELECT email FROM users WHERE company_id=$2))`, [wid, cid]);
  if (!w.rows.length) return null;
  const wb = w.rows[0];
  let oids = wb.order_ids;
  if (typeof oids === 'string') { try { oids = JSON.parse(oids); } catch (_) { oids = []; } }
  oids = Array.isArray(oids) ? oids.map(String).filter(Boolean) : [];
  let puncte = wb.puncte;
  if (typeof puncte === 'string') { try { puncte = JSON.parse(puncte); } catch (_) { puncte = []; } }
  puncte = Array.isArray(puncte) ? puncte : [];
  // a pontokban szereplő fuvarok is (ha az order_ids-ből kimaradt)
  puncte.forEach((p) => { if (p && p.orderId && !oids.includes(String(p.orderId))) oids.push(String(p.orderId)); });

  const stopIds = puncte.filter((p) => p && p.stopId != null && !p.orderId).map((p) => parseInt(p.stopId, 10)).filter(Boolean);
  const stopOrder = {};
  if (stopIds.length) {
    try {
      const s = await db.query('SELECT id, order_id FROM order_stops WHERE id = ANY($1::int[]) AND company_id=$2', [stopIds, cid]);
      s.rows.forEach((r) => { stopOrder[String(r.id)] = r.order_id; if (!oids.includes(r.order_id)) oids.push(r.order_id); });
    } catch (_) {}
  }
  const o = await db.query(
    `SELECT o.id, o.fuvar_no, o.ref, o.client, o.status, o.carrier_id, o.pret, o.carrier_cost,
            o.rendszam_camion, o.loc_incarcare, o.loc_descarcare, o.descarcat_at,
            to_char(o.data_incarcare,'YYYY-MM-DD') AS data_incarcare,
            to_char(o.data_descarcare,'YYYY-MM-DD') AS data_descarcare,
            cl.denumire AS client_denumire, cl.cui_cif AS client_cui,
            ca.nev AS carrier_nev, ca.cui AS carrier_cui
       FROM orders o
       LEFT JOIN clients cl ON cl.id = o.client_id AND cl.company_id = o.company_id
       LEFT JOIN carriers ca ON ca.id = o.carrier_id AND ca.company_id = o.company_id
      WHERE o.company_id=$1 AND o.id = ANY($2::varchar[])`, [cid, oids]);
  const orders = oids.map((id) => o.rows.find((r) => r.id === id)).filter(Boolean);

  let { required, legacy } = unloadedOrderIds(puncte, stopOrder);
  // Régi (fuvarhoz nem kötött pontú) menetlevél: a lerakott fuvarok.
  if (legacy) required = orders.filter((r) => r.descarcat_at).map((r) => r.id);

  const d = await db.query(
    `SELECT od.id, od.order_id, od.waybill_id, COALESCE(od.doc_type,'') AS doc_type, od.file_name,
            od.text_cache, od.text_status, od.original_base64, od.signed_base64
       FROM order_documents od LEFT JOIN orders x ON x.id = od.order_id
      WHERE (od.company_id=$1 OR x.company_id=$1)
        AND (od.waybill_id=$2 OR od.order_id = ANY($3::varchar[]))
      ORDER BY od.id`, [cid, wb.id, orders.map((r) => r.id)]);
  const docs = [];
  for (const row of d.rows) {
    if (!CHECK_TYPES.has(row.doc_type)) continue;
    const { text, status } = await docText(db, row);
    const inv = text ? parseInvoiceText(text) : null;
    docs.push({ id: row.id, order_id: row.order_id, doc_type: row.doc_type, file_name: row.file_name,
      text, text_status: status, inv, kind: text ? (textKind(text, inv) || typeHintKind(row.doc_type)) : typeHintKind(row.doc_type),
      from_assignment: /^comanda-/i.test(String(row.file_name || '')) && !row.doc_type });
  }
  let decisions = [];
  try {
    const r = await db.query('SELECT doc_id, order_id, slot, verdict FROM waybill_doc_decisions WHERE company_id=$1 AND doc_id = ANY($2::int[])',
      [cid, docs.map((x) => x.id)]);
    decisions = r.rows;
  } catch (e) { if (!_isMissing(e)) throw e; }
  const assignmentOrders = new Set();
  try {
    const r = await db.query('SELECT DISTINCT order_id FROM order_assignments WHERE company_id=$1 AND order_id = ANY($2::varchar[])', [cid, orders.map((x) => x.id)]);
    r.rows.forEach((x) => assignmentOrders.add(x.order_id));
  } catch (_) {}
  let ownCui = '';
  try { const c = await db.query('SELECT cui FROM companies WHERE id=$1', [cid]); ownCui = c.rows[0] && c.rows[0].cui; } catch (_) {}
  return { wb, orders, required, legacy, docs, decisions, assignmentOrders, ownCui };
}

function _sig(ctx) {
  const s = JSON.stringify({
    r: ctx.required,
    o: ctx.orders.map((o) => [o.id, o.carrier_id, o.pret, o.carrier_cost, o.ref, o.client_cui, o.carrier_cui]),
    d: ctx.docs.map((d) => [d.id, d.doc_type, d.order_id, d.text_status]),
    x: ctx.decisions.map((d) => [d.doc_id, d.order_id, d.slot, d.verdict]),
  });
  return crypto.createHash('sha1').update(s).digest('hex');
}

// Egy menetlevél ellenőrzése + mentés. → az eredmény (vagy null, ha nincs ilyen).
async function checkWaybill(cid, wid, opts) {
  const db = (opts && opts.db) || _db();
  const ctx = await _load(db, cid, wid);
  if (!ctx) return null;
  const res = evaluate({ orders: ctx.orders, requiredIds: ctx.required, docs: ctx.docs,
    decisions: ctx.decisions, ownCui: ctx.ownCui, assignmentOrders: ctx.assignmentOrders });
  res.legacy = ctx.legacy;
  res.waybill = { id: ctx.wb.id, numar_fisa: ctx.wb.numar_fisa };
  res.docs = ctx.docs.map((d) => ({ id: d.id, file_name: d.file_name, text_status: d.text_status, kind: d.kind }));
  const sig = _sig(ctx);
  try {
    await db.query(
      `INSERT INTO waybill_doc_checks (waybill_id, company_id, status, required_cnt, missing_cnt, wrong_cnt, review_cnt, input_sig, detail, checked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())
       ON CONFLICT (waybill_id) DO UPDATE SET company_id=EXCLUDED.company_id, status=EXCLUDED.status,
         required_cnt=EXCLUDED.required_cnt, missing_cnt=EXCLUDED.missing_cnt, wrong_cnt=EXCLUDED.wrong_cnt,
         review_cnt=EXCLUDED.review_cnt, input_sig=EXCLUDED.input_sig, detail=EXCLUDED.detail, checked_at=NOW()`,
      [ctx.wb.id, cid, res.status, res.required_cnt, res.missing_cnt, res.wrong_cnt, res.review_cnt, sig,
        JSON.stringify({ orders: res.orders, foreign: res.foreign, extra: res.extra, legacy: res.legacy, docs: res.docs })]);
  } catch (e) { if (!_isMissing(e)) throw e; }
  res.checked_at = new Date().toISOString();
  return res;
}

// Háttér-frissítés egy változás után (feltöltés, törlés, menetlevél-szerkesztés) —
// soha nem dob, soha nem késlelteti a felhasználói kérést. Rövid gyűjtés (3 mp):
// a soros (fájlonkénti) feltöltés így egyetlen újraszámolást indít.
const _pending = new Map();
const TOUCH_DELAY_MS = 3000;
function touch(cid, ref) {
  if (!cid || !ref) return;
  if (process.env.NODE_ENV === 'test' && !process.env.WDC_TOUCH_IN_TEST) return;   // tesztben nincs háttér-futás
  const key = cid + '|' + (ref.waybillId ? 'w:' + ref.waybillId : 'o:' + ref.orderId);
  if (_pending.has(key)) return;
  const tm = setTimeout(async () => {
    _pending.delete(key);
    try {
      const db = _db();
      const wids = [];
      if (ref.waybillId) wids.push(String(ref.waybillId));
      if (ref.orderId) {
        const r = await db.query(
          `SELECT id FROM fuvarlevelek WHERE company_id=$1 AND order_ids @> jsonb_build_array($2::text) LIMIT 20`,
          [cid, String(ref.orderId)]);
        ((r && r.rows) || []).forEach((x) => { if (!wids.includes(x.id)) wids.push(x.id); });
      }
      for (const w of wids) await checkWaybill(cid, w);
    } catch (e) { if (!_isMissing(e)) console.warn('[WaybillDocCheck] háttér-frissítés hiba', e.message); }
  }, TOUCH_DELAY_MS);
  if (tm && typeof tm.unref === 'function') tm.unref();
  _pending.set(key, tm);
}

// Ütemezett kör: a még nem ellenőrzött és a hiányos csomagú menetlevelek (365 napig).
// A teljes csomagú menetlevél csak akkor kerül újra sorra, ha azóta irat változott.
async function runRound(limit) {
  const db = _db();
  const r = await db.query(
    `SELECT f.id, f.company_id FROM fuvarlevelek f
       LEFT JOIN waybill_doc_checks c ON c.waybill_id = f.id
      WHERE f.company_id IS NOT NULL
        AND COALESCE(f.erkezes_dt, f.indulas_dt, f.data_completare) > NOW() - INTERVAL '365 days'
        AND (c.waybill_id IS NULL
             OR (c.status = 'incomplete' AND c.checked_at < NOW() - INTERVAL '20 minutes')
             OR EXISTS (SELECT 1 FROM order_documents od
                         WHERE od.company_id = f.company_id
                           AND (od.waybill_id = f.id OR f.order_ids @> jsonb_build_array(od.order_id))
                           AND GREATEST(od.created_at, COALESCE(od.updated_at, od.created_at)) > c.checked_at))
      ORDER BY c.checked_at ASC NULLS FIRST
      LIMIT $1`, [limit || 40]);
  let n = 0;
  for (const row of r.rows) {
    try { await checkWaybill(row.company_id, row.id); n++; }
    catch (e) { console.warn('[WaybillDocCheck] menetlevél hiba', row.id, e.message); }
  }
  return n;
}

module.exports = {
  SLOTS, OK_CONF, REVIEW_CONF, ASSIGN_MIN,
  unloadedOrderIds, textKind, typeHintKind, amountIn, dateIn, scoreDocOrder, sidesFor, evaluate,
  checkWaybill, touch, runRound, docText,
};
