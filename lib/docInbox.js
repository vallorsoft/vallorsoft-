// ============================================================
//  VallorSoft — lib/docInbox.js
//  Csoportos irat-feltöltés a menetlevelekhez: a feltöltött számlákat / megrendelőket
//  a rendszer HELYBEN (PDF-szöveg, helyi OCR — lib/docPrivacy: semmi nem megy ki)
//  összeveti az ÖSSZES hiányos menetlevél hiányzó iratával, és ha egyértelmű
//  találatot kap, a fuvar + menetlevél iratai közé teszi.
//
//  Szabály (a tulajdonos döntése, 2026-11-22):
//   • minden irat legfeljebb 3 körben próbálkozik (feltöltéskor + az ütemező köreiben);
//   • 3 sikertelen kör után 'unmatched' → a felhasználó kézzel párosít, vagy törli
//     (törléskor a fájl teljesen törlődik).
// ============================================================
'use strict';

const chk = require('./waybillDocCheck');
const { parseInvoiceText } = require('./invoiceText');

const MAX_ATTEMPTS = 3;
const AUTO_MIN = 70;      // ennél kisebb pontszámmal nem párosítunk automatikusan
const AUTO_MARGIN = 15;   // a legjobb és a második (más fuvar) közti minimális különbség
const ROUND_GAP_MIN = 10; // két próbálkozás közti minimális idő (perc)

let _pool = null;
function _db() { return _pool || (_pool = require('../db')); }
const _isMissing = (e) => e && (e.code === '42P01' || e.code === '42703');

// A hiányzó helyek a hiányos menetlevelekből: [{ waybill_id, order_id, slot }]
function missingSlots(checks) {
  const out = [];
  for (const c of checks || []) {
    const d = c.detail || {};
    for (const o of d.orders || []) {
      if (o.state !== 'unloaded') continue;
      for (const s of o.slots || []) {
        if (s.level === 'missing') out.push({ waybill_id: c.waybill_id, order_id: o.id, slot: s.slot });
      }
    }
  }
  return out;
}

// Tiszta függvény: a legjobb hely egy irathoz.
// doc: { text, inv, kind }   slots: missingSlots()   orders: { id: orderRow }
// → { best:{waybill_id,order_id,slot,score,reasons}|null, second:number, auto:boolean }
function pickSlot(doc, slots, orders, ownCui, learn) {
  const cands = [];
  for (const m of slots) {
    const o = orders[m.order_id];
    if (!o) continue;
    const side = m.slot.startsWith('carrier') ? 'carrier' : 'client';
    const kind = m.slot.endsWith('invoice') ? 'invoice' : 'order';
    if (doc.kind && doc.kind !== kind) continue;
    if (side === 'carrier' && !o.carrier_id) continue;
    // az irat oldala (ügyfél / alvállalkozó) is stimmeljen, ha a szövegből eldönthető
    const sides = chk.sidesFor(doc, o);
    if (!sides.includes(side)) continue;
    const sc = chk.scoreDocOrder(doc, o, side, ownCui, learn);
    const score = doc.kind ? sc.score : Math.round(sc.score * 0.8);
    cands.push(Object.assign({}, m, { score, reasons: sc.reasons }));
  }
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0] || null;
  const second = best ? (cands.find((c) => c.order_id !== best.order_id) || { score: 0 }).score : 0;
  const auto = !!best && best.score >= AUTO_MIN && best.score - second >= AUTO_MARGIN;
  return { best, second, auto };
}

function _dataUrl(row) {
  const s = String(row.data || '');
  if (!s || s.startsWith('data:')) return s;
  const ext = String(row.file_name || '').split('.').pop().toLowerCase();
  return 'data:' + (ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg') + ';base64,' + s;
}

// Az irat szövege: PDF-szövegréteg, ha nincs — helyi OCR (ha van munkamenet).
async function _ensureText(db, row, ocrSession) {
  if (row.text_status === 'ok' || row.text_status === 'ocr') return row.text_cache || '';
  let text = '', status = row.text_status;
  if (!status) {
    const r = await chk.docText({ query: async () => ({ rows: [] }) }, { id: 0, original_base64: _dataUrl(row), file_name: row.file_name });
    text = r.text; status = r.status;
  }
  if (!text && ocrSession && !row.ocr_at && (status === 'scanned' || status === 'image')) {
    try {
      const o = await ocrSession.read(_dataUrl(row), row.file_name);
      if (o.text && o.text.replace(/\s+/g, '').length >= 30) { text = o.text.slice(0, 60000); status = 'ocr'; }
    } catch (_) { /* marad olvashatatlan */ }
    await db.query('UPDATE waybill_doc_inbox SET ocr_at=NOW() WHERE id=$1', [row.id]);
  }
  await db.query('UPDATE waybill_doc_inbox SET text_cache=$2, text_status=$3 WHERE id=$1', [row.id, text || null, status || null]);
  row.text_cache = text; row.text_status = status;
  return text;
}

// Az irat beírása a fuvar + menetlevél iratai közé (közös a kézi párosítással).
async function attach(db, cid, row, target, by, conf) {
  const kind = target.slot ? (target.slot.endsWith('invoice') ? 'invoice' : 'order') : (target.doc_type === 'invoice' ? 'invoice' : 'order');
  const size = row.file_size || null;
  const ins = await db.query(
    `INSERT INTO order_documents (order_id, waybill_id, file_name, original_base64, uploaded_by, company_id,
                                  doc_type, doc_date, note, file_size, text_cache, text_status, text_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,$8,$9,$10,$11,NOW()) RETURNING id`,
    [target.order_id, target.waybill_id, row.file_name, _dataUrl(row), row.uploaded_by || null, cid, kind,
      by === 'auto' ? 'Încărcare în grup — asociat automat' : 'Încărcare în grup — asociat manual',
      size, row.text_cache || null, row.text_status && row.text_status !== 'pending' ? row.text_status : null]);
  const docId = ins.rows[0].id;
  await db.query(
    `UPDATE waybill_doc_inbox SET status='matched', data=NULL, matched_order_id=$3, matched_waybill_id=$4,
            matched_doc_id=$5, matched_conf=$6, matched_by=$7, last_try_at=NOW()
      WHERE id=$1 AND company_id=$2`,
    [row.id, cid, target.order_id, target.waybill_id, docId, conf == null ? null : conf, by]);
  // ha a felhasználó egy konkrét helyre párosította, az a tanuláshoz is visszaigazolás
  if (target.slot) {
    try {
      await db.query(
        `INSERT INTO waybill_doc_decisions (company_id, doc_id, order_id, slot, verdict, decided_by)
         VALUES ($1,$2,$3,$4,'ok',$5) ON CONFLICT (company_id, doc_id, order_id, slot) DO NOTHING`,
        [cid, docId, target.order_id, target.slot, by === 'manual' ? (row.uploaded_by || null) : 'auto']);
    } catch (e) { if (!_isMissing(e)) throw e; }
  }
  chk.touch(cid, { waybillId: target.waybill_id });
  return docId;
}

// Egy cég függő iratainak egy köre. opts: { ids?: [id], force?: bool, ocr?: bool }
async function processCompany(cid, opts) {
  const db = _db();
  const o = opts || {};
  const params = [cid];
  let where = `company_id=$1 AND status='pending' AND data IS NOT NULL`;
  if (o.ids && o.ids.length) { params.push(o.ids); where += ` AND id = ANY($2::int[])`; }
  else if (!o.force) where += ` AND (last_try_at IS NULL OR last_try_at < NOW() - INTERVAL '${ROUND_GAP_MIN} minutes')`;
  const r = await db.query(`SELECT * FROM waybill_doc_inbox WHERE ${where} ORDER BY id LIMIT 60`, params);
  if (!r.rows.length) return { processed: 0, matched: 0 };

  // A hiányos menetlevelek hiányzó helyei (frissítve, hogy a friss állapotot lássuk).
  let checks = [];
  try {
    const c = await db.query(
      `SELECT waybill_id, detail FROM waybill_doc_checks WHERE company_id=$1 AND status='incomplete' AND missing_cnt > 0`, [cid]);
    checks = c.rows;
  } catch (e) { if (!_isMissing(e)) throw e; }
  const slots = missingSlots(checks);
  const orderRows = await chk.loadOrders(db, cid, [...new Set(slots.map((s) => s.order_id))]);
  const orders = {};
  orderRows.forEach((x) => { orders[x.id] = x; });
  const learn = await chk.loadLearn(db, cid);
  let ownCui = '';
  try { const c = await db.query('SELECT cui FROM companies WHERE id=$1', [cid]); ownCui = c.rows[0] && c.rows[0].cui; } catch (_) {}

  let ocrSession = null;
  if (o.ocr !== false) {
    try { const ocr = require('./localOcr'); if (ocr.enabled()) ocrSession = await ocr.open(); } catch (_) { ocrSession = null; }
  }
  const taken = new Set();   // egy kör alatt egy hely csak egy iratot kap
  let processed = 0, matched = 0;
  try {
    for (const row of r.rows) {
      processed++;
      const text = await _ensureText(db, row, ocrSession);
      const inv = text ? parseInvoiceText(text) : null;
      const doc = { id: row.id, text, inv, kind: text ? chk.textKind(text, inv) : null, ocr: row.text_status === 'ocr' };
      const free = slots.filter((s) => !taken.has(s.waybill_id + '|' + s.order_id + '|' + s.slot));
      const pick = text ? pickSlot(doc, free, orders, ownCui, learn) : { best: null, auto: false };
      if (pick.auto) {
        taken.add(pick.best.waybill_id + '|' + pick.best.order_id + '|' + pick.best.slot);
        await attach(db, cid, row, pick.best, 'auto', pick.best.score);
        matched++;
        continue;
      }
      const attempts = (row.attempts || 0) + 1;
      const guess = pick.best && pick.best.score >= chk.ASSIGN_MIN ? { waybill_id: pick.best.waybill_id, order_id: pick.best.order_id, slot: pick.best.slot,
        score: pick.best.score, fuvar_no: (orders[pick.best.order_id] || {}).fuvar_no || null } : null;
      await db.query(
        `UPDATE waybill_doc_inbox SET attempts=$2::int, last_try_at=NOW(), best_guess=$3::jsonb,
                status = CASE WHEN $2::int >= $4::int THEN 'unmatched' ELSE 'pending' END
          WHERE id=$1`, [row.id, attempts, guess ? JSON.stringify(guess) : null, MAX_ATTEMPTS]);
    }
  } finally { if (ocrSession) await ocrSession.close(); }
  return { processed, matched };
}

// Ütemezett kör: minden cég függő iratai (a két próbálkozás közti szünettel).
async function runRound() {
  const db = _db();
  let cids = [];
  try {
    const r = await db.query(
      `SELECT DISTINCT company_id FROM waybill_doc_inbox
        WHERE status='pending' AND data IS NOT NULL
          AND (last_try_at IS NULL OR last_try_at < NOW() - INTERVAL '${ROUND_GAP_MIN} minutes')`);
    cids = r.rows.map((x) => x.company_id);
  } catch (e) { if (_isMissing(e)) return 0; throw e; }
  let n = 0;
  for (const cid of cids) {
    try { n += (await processCompany(cid)).matched; }
    catch (e) { console.warn('[DocInbox] cég hiba', cid, e.message); }
  }
  return n;
}

module.exports = { MAX_ATTEMPTS, AUTO_MIN, AUTO_MARGIN, missingSlots, pickSlot, processCompany, runRound, attach };
