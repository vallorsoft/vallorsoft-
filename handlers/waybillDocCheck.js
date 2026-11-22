// handlers/waybillDocCheck.js — menetlevél dokumentum-csomag ellenőrzése (lib/waybillDocCheck).
// Az ellenőrzés a háttérben fut (ütemező + feltöltéskori frissítés); a felület csak
// megmutatja, és a felhasználó visszaigazol (✓ helyes / ✗ nem ez) — ebből tanul.
// Kapuk: Admin/Manager, a menetlevél és a fuvar a saját cégé, paraméteres SQL, audit.
// Minden helyben fut — irat nem megy külső szolgáltatóhoz.

const pool = require('../db');
const audit = require('../lib/audit');
const chk = require('../lib/waybillDocCheck');

const handlers = {};
const _am = (u) => u && ['Admin', 'Manager'].includes(u.pozicio);
const _clip = (v, n) => { const s = v == null ? '' : String(v).trim(); return s ? s.slice(0, n) : ''; };

// waybillDocCheckGet({ waybill_id }) → a csomag állapota fuvaronként
handlers.waybillDocCheckGet = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const wid = _clip(args && args[0] && args[0].waybill_id, 20);
    if (!wid) return res.json({ result: { ok: false, err: 'Identificator lipsă' } });
    const r = await chk.checkWaybill(u.company_id, wid);
    if (!r) return res.json({ result: { ok: false, err: 'Foaia de parcurs nu a fost găsită.' } });
    return res.json({ result: Object.assign({ ok: true }, r) });
  } catch (err) {
    console.error('waybillDocCheckGet hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// waybillDocDecide({ waybill_id, doc_id, order_id, slot, verdict:'ok'|'no'|'reset' })
// ✓ = a párosítás helyes (rögzül, többé nem számoljuk újra);
// ✗ = nem ez (ezt a párt a rendszer többé nem ajánlja); reset = döntés törlése.
handlers.waybillDocDecide = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const cid = u.company_id;
    const wid = _clip(a.waybill_id, 20);
    const docId = parseInt(a.doc_id, 10);
    const orderId = _clip(a.order_id, 20);
    const slot = _clip(a.slot, 20);
    const verdict = ['ok', 'no', 'reset'].includes(a.verdict) ? a.verdict : null;
    if (!wid || !docId || !orderId || !chk.SLOTS.includes(slot) || !verdict) {
      return res.json({ result: { ok: false, err: 'Date incomplete' } });
    }
    // A menetlevél a cégé, a fuvar rajta van, az irat a menetlevél / a fuvar irata.
    const w = await pool.query(
      `SELECT id FROM fuvarlevelek WHERE id=$1 AND (company_id=$2 OR email_sofer IN (SELECT email FROM users WHERE company_id=$2))
          AND (order_ids @> jsonb_build_array($3::text) OR puncte @> jsonb_build_array(jsonb_build_object('orderId', $3::text)))`,
      [wid, cid, orderId]);
    if (!w.rows.length) return res.json({ result: { ok: false, err: 'Cursa nu este pe această foaie de parcurs.' } });
    const o = await pool.query('SELECT 1 FROM orders WHERE id=$1 AND company_id=$2', [orderId, cid]);
    if (!o.rows.length) return res.json({ result: { ok: false, err: 'Comanda nu a fost găsită.' } });
    const d = await pool.query(
      `SELECT od.id FROM order_documents od LEFT JOIN orders x ON x.id = od.order_id
        WHERE od.id=$1 AND (od.company_id=$2 OR x.company_id=$2)
          AND (od.waybill_id=$3 OR od.order_id IN (SELECT jsonb_array_elements_text(order_ids) FROM fuvarlevelek WHERE id=$3))`,
      [docId, cid, wid]);
    if (!d.rows.length) return res.json({ result: { ok: false, err: 'Documentul nu a fost găsit.' } });

    // A párosítás jelenlegi indokai — ebből tanul a döntés (best-effort).
    let reasons = [];
    if (verdict !== 'reset') {
      try {
        const cur = await chk.checkWaybill(cid, wid);
        const o2 = cur && (cur.orders || []).find((x) => x.id === orderId);
        const sl = o2 && (o2.slots || []).find((x) => x.slot === slot && x.doc_id === docId);
        reasons = (sl && sl.reasons) || [];
      } catch (_) {}
    }
    if (verdict === 'reset') {
      await pool.query('DELETE FROM waybill_doc_decisions WHERE company_id=$1 AND doc_id=$2 AND order_id=$3 AND slot=$4',
        [cid, docId, orderId, slot]);
    } else {
      if (verdict === 'ok') {
        // egy irat egy helyet tölt ki: a többi „ok" döntését elengedjük
        await pool.query(`DELETE FROM waybill_doc_decisions WHERE company_id=$1 AND doc_id=$2 AND verdict='ok'`, [cid, docId]);
      }
      await pool.query(
        `INSERT INTO waybill_doc_decisions (company_id, doc_id, order_id, slot, verdict, decided_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (company_id, doc_id, order_id, slot) DO UPDATE SET verdict=EXCLUDED.verdict,
           decided_by=EXCLUDED.decided_by, decided_at=NOW()`,
        [cid, docId, orderId, slot, verdict, u.email || u.nume || null]);
    }
    // ✓ → az irat típusa a visszaigazolt hely szerint (számla / megrendelő) — így a
    // listában sem marad „Egyéb" alatt, és a következő ellenőrzés is ezt tudja.
    if (verdict === 'ok') {
      const kind = slot.endsWith('invoice') ? 'invoice' : 'order';
      try {
        await pool.query(
          `UPDATE order_documents SET doc_type=$2
            WHERE id=$1 AND COALESCE(doc_type,'') IN ('', 'other', 'order_doc', 'invoice', 'order', 'assignment') AND COALESCE(doc_type,'') <> $2`,
          [docId, kind]);
      } catch (e) { console.error('waybillDocDecide típus (folytatjuk):', e.message); }
    }
    try { await chk.learnFromDecision(cid, { docId, orderId, slot, verdict, reasons }); }
    catch (e) { if (!(e && (e.code === '42P01' || e.code === '42703'))) console.error('waybillDocDecide tanulás (folytatjuk):', e.message); }
    audit.fromReq(req, 'waybill_doc.decide', 'waybill', wid, { doc_id: docId, order_id: orderId, slot, verdict });
    const r = await chk.checkWaybill(cid, wid);
    return res.json({ result: Object.assign({ ok: true }, r || {}) });
  } catch (err) {
    console.error('waybillDocDecide hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// waybillDocCheckSummary() → { incomplete, wrong, review } — a lista feletti teendő-sávhoz
handlers.waybillDocCheckSummary = async function (req, res) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    let row = { incomplete: 0, wrong: 0, review: 0, missing: 0 };
    try {
      const r = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE status='incomplete')::int AS incomplete,
                COUNT(*) FILTER (WHERE wrong_cnt > 0)::int AS wrong,
                COUNT(*) FILTER (WHERE review_cnt > 0)::int AS review,
                COALESCE(SUM(missing_cnt),0)::int AS missing
           FROM waybill_doc_checks WHERE company_id=$1`, [u.company_id]);
      row = r.rows[0] || row;
    } catch (e) { if (!(e && (e.code === '42P01' || e.code === '42703'))) throw e; }
    return res.json({ result: Object.assign({ ok: true }, row) });
  } catch (err) {
    console.error('waybillDocCheckSummary hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
