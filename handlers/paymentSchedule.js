// ============================================================
//  VallorSoft — handlers/paymentSchedule.js
//  Fizetési ütemterv (cashflow) — CSAK OLVASÁS, aggregáció.
//  Két irány egyetlen, dátumra rendezett listában:
//   - Bejövő (MI fizetünk): carrier_invoices (alvállalkozói AP), status<>'paid',
//     due_date-tel. remaining = amount − paid_amount.
//   - Kimenő (NEKÜNK fizetnek): invoices kimenő számlák. Az invoices táblának
//     NINCS due_date oszlopa → a kintlévőség-esedékességet a fuvarból vezetjük le:
//     finalized_at + COALESCE(clients.payment_term_days,30) — UGYANAZ a proxy,
//     amit az Operatív központ (handlers/opsCenter.js) használ, a konzisztenciáért.
//     Csak Finalizat + nem teljesen fizetett, számlával rendelkező fuvarok.
//
//  Minden lekérdezés company_id-szűrt + paraméteres (multi-tenant).
// ============================================================
const pool = require('../db');

const handlers = {};

function _isAdminOrManager(req) {
  return req.session.user && ['Admin', 'Manager'].includes(req.session.user.pozicio);
}
function _deny(res) { return res.json({ result: { ok: false, err: 'Acces interzis' } }); }

// args: { from?:'YYYY-MM-DD', to?:'YYYY-MM-DD' } — opcionális dátum-ablak az
// esedékességre. Hiányzó érték esetén nincs szűrés (teljes nyitott állomány).
handlers.getPaymentSchedule = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const a = (args && !Array.isArray(args)) ? args : ((args && args[0]) || {});
    const from = a.from ? String(a.from).slice(0, 10) : null;
    const to = a.to ? String(a.to).slice(0, 10) : null;

    // ── 1) Bejövő (alvállalkozói AP — MI fizetünk) ──
    const apParams = [cid];
    let apDate = '';
    if (from) { apParams.push(from); apDate += ` AND ci.due_date >= $${apParams.length}`; }
    if (to)   { apParams.push(to);   apDate += ` AND ci.due_date <= $${apParams.length}`; }
    const apR = await pool.query(
      `SELECT ci.id, ci.invoice_number, ci.due_date,
              ci.amount, ci.paid_amount, ci.currency, ci.status,
              c.nev AS partner
         FROM carrier_invoices ci
         LEFT JOIN carriers c ON c.id = ci.carrier_id AND c.company_id = ci.company_id
        WHERE ci.company_id = $1 AND ci.status <> 'paid'
          AND ci.due_date IS NOT NULL${apDate}`,
      apParams
    );
    const incoming = apR.rows.map(function (r) {
      const remaining = Math.max(0, (Number(r.amount) || 0) - (Number(r.paid_amount) || 0));
      return {
        direction: 'in',                 // bejövő számla → mi fizetünk
        due_date: r.due_date,
        partner: r.partner || null,
        reference: r.invoice_number || null,
        amount: remaining,
        currency: r.currency || 'EUR',
        status: r.status
      };
    });

    // ── 2) Kimenő (NEKÜNK fizetnek) — fuvar-alapú kintlévőség-esedékesség ──
    // Esedékesség = finalized_at + payment_term_days (alap 30) — UGYANAZ a proxy,
    // mint az opsCenter-ben (handlers/opsCenter.js). A kifejezés egy CTE-ben él,
    // hogy a dátum-szűrés ne kelljen duplikálni / kézi index-matekkal bajlódni.
    const outDueExpr = `(o.finalized_at::date + (COALESCE(c.payment_term_days, 30) || ' days')::interval)::date`;
    const outParams = [cid];
    let outDate = '';
    if (from) { outParams.push(from); outDate += ` AND s.due_date >= $${outParams.length}`; }
    if (to)   { outParams.push(to);   outDate += ` AND s.due_date <= $${outParams.length}`; }
    const outR = await pool.query(
      `WITH src AS (
         SELECT o.id AS order_id,
                ${outDueExpr} AS due_date,
                c.denumire AS partner,
                i.serie, i.numar, i.valuta,
                (COALESCE(o.pret,0) - COALESCE(o.paid_amount,0)) AS remaining
           FROM orders o
           JOIN invoices i ON i.order_id = o.id AND i.company_id = o.company_id
                          AND COALESCE(i.status,'issued') <> 'cancelled'
           LEFT JOIN clients c ON c.id = o.client_id AND c.company_id = o.company_id
          WHERE o.company_id = $1 AND o.status = 'Finalizat'
            AND COALESCE(o.payment_status,'unpaid') <> 'paid'
            AND o.finalized_at IS NOT NULL
       )
       SELECT * FROM src s WHERE TRUE${outDate}`,
      outParams
    );
    const outgoing = outR.rows.map(function (r) {
      const ref = ((r.serie || '') + ' ' + (r.numar || '')).trim() || ('#' + r.order_id);
      return {
        direction: 'out',                // kimenő számla → nekünk fizetnek
        due_date: r.due_date,
        partner: r.partner || null,
        reference: ref,
        amount: Math.max(0, Number(r.remaining) || 0),
        currency: r.valuta || 'EUR',
        status: 'unpaid'
      };
    });

    // ── Egyesített, dátumra rendezett ütemterv ──
    const schedule = incoming.concat(outgoing)
      .filter(function (x) { return x.amount > 0; })
      .sort(function (x, y) {
        return new Date(x.due_date || 0) - new Date(y.due_date || 0);
      });

    // ── Összegzők (irányonként, lejárt és 7/30 nap) ──
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d7 = new Date(today); d7.setDate(d7.getDate() + 7);
    const d30 = new Date(today); d30.setDate(d30.getDate() + 30);
    const totals = { in: 0, out: 0, overdue: 0, due7: 0, due30: 0 };
    schedule.forEach(function (x) {
      totals[x.direction] += x.amount;
      const dd = x.due_date ? new Date(x.due_date) : null;
      if (dd) {
        dd.setHours(0, 0, 0, 0);
        if (dd < today) totals.overdue += x.amount;
        else { if (dd <= d7) totals.due7 += x.amount; if (dd <= d30) totals.due30 += x.amount; }
      }
    });
    ['in', 'out', 'overdue', 'due7', 'due30'].forEach(function (k) { totals[k] = Math.round(totals[k] * 100) / 100; });

    return res.json({ result: { ok: true, schedule: schedule, totals: totals } });
  } catch (err) {
    console.error('getPaymentSchedule hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
