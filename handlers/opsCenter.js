// ============================================================
//  VallorSoft — handlers/opsCenter.js
//  Operatív központ (diszpécser-vezérlő) — CSAK OLVASÁS, aggregáció.
//  Egyetlen company_id-szűrt összesítés a MEGLÉVŐ táblákból; nincs új tábla,
//  nincs írás. Minden lekérdezés paraméteres ($1 = company_id).
//  A számlálók a tényleges séma-oszlopnevekre épülnek (orders / invoices /
//  carrier_invoices / order_uit_codes / document_expiries).
// ============================================================
const pool = require('../db');

const handlers = {};

// Aktív (még nem lezárt/nem törölt) fuvar-státuszok — a CLAUDE.md/áru-leadás konvenció szerint.
const ACTIVE_STATUSES = ['Disponibil', 'Alocat', 'In Curs', 'Extern', 'Parkolt', 'Raktarban'];

function _isAdminOrManager(req) {
  return req.session.user && ['Admin', 'Manager'].includes(req.session.user.pozicio);
}
function _deny(res) { return res.json({ result: { ok: false, err: 'Acces interzis' } }); }

// ── Operatív központ — minden számláló egy company_id-szűrt aggregáció ──
handlers.getOpsCenter = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;

    // 1) Fuvar-számlálók egyetlen lekérdezésben (aktív / mai felrakás / mai
    //    lerakás / késő szállítás / hiányzó fuvarozó). A „hiányzó UIT” az
    //    order_uit_codes-ra hivatkozik, ezért külön (best-effort) megy.
    const ordR = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = ANY($2))::int AS aktiv,
         COUNT(*) FILTER (WHERE status = ANY($2) AND data_incarcare = CURRENT_DATE)::int AS mai_felrakas,
         COUNT(*) FILTER (WHERE status = ANY($2) AND data_descarcare = CURRENT_DATE)::int AS mai_lerakas,
         COUNT(*) FILTER (WHERE status = ANY($2) AND data_descarcare IS NOT NULL
                                AND data_descarcare < CURRENT_DATE)::int AS keso,
         COUNT(*) FILTER (WHERE status = 'Extern' AND carrier_id IS NULL)::int AS hianyzo_fuvarozo
       FROM orders WHERE company_id = $1`,
      [cid, ACTIVE_STATUSES]
    );
    const oc = ordR.rows[0] || {};

    // 2) Hiányzó UIT — needs_uit = TRUE ÉS nincs aktív (nem 'stopped') UIT-kód.
    //    Ugyanaz a logika, mint a comList uit_active_count-ja. Best-effort.
    let hianyzoUit = 0;
    try {
      const uitR = await pool.query(
        `SELECT COUNT(*)::int AS db
           FROM orders o
          WHERE o.company_id = $1 AND o.status = ANY($2) AND o.needs_uit = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM order_uit_codes u
               WHERE u.order_id = o.id AND u.company_id = o.company_id AND u.status <> 'stopped')`,
        [cid, ACTIVE_STATUSES]
      );
      hianyzoUit = (uitR.rows[0] && uitR.rows[0].db) || 0;
    } catch (e) { /* order_uit_codes hiányában 0 */ }

    // 3) Lejáró kimenő számlák — kiállított (issued) számlák, a payload-ban
    //    nincs külön esedékesség-mező, így a kintlévőséget a Finalizat + nem
    //    teljesen fizetett fuvarok fizetési határidejéből (clients.payment_term_days)
    //    számoljuk: due = finalized_at + term. 7 napon belül esedékes vagy lejárt.
    let lejaroSzamla = 0;
    try {
      const dueR = await pool.query(
        `SELECT COUNT(*)::int AS db
           FROM orders o
           LEFT JOIN clients c ON c.id = o.client_id AND c.company_id = o.company_id
          WHERE o.company_id = $1 AND o.status = 'Finalizat'
            AND COALESCE(o.payment_status,'unpaid') <> 'paid'
            AND o.finalized_at IS NOT NULL
            AND (o.finalized_at::date + (COALESCE(c.payment_term_days, 30) || ' days')::interval)::date
                <= CURRENT_DATE + 7`,
        [cid]
      );
      lejaroSzamla = (dueR.rows[0] && dueR.rows[0].db) || 0;
    } catch (e) { /* clients/payment_term_days hiányában 0 */ }

    // 4) Lejáró bejövő (alvállalkozói) számlák — carrier_invoices: nem fizetett,
    //    due_date 7 napon belül vagy lejárt.
    let lejaroApSzamla = 0;
    try {
      const apR = await pool.query(
        `SELECT COUNT(*)::int AS db
           FROM carrier_invoices
          WHERE company_id = $1 AND status <> 'paid'
            AND due_date IS NOT NULL AND due_date <= CURRENT_DATE + 7`,
        [cid]
      );
      lejaroApSzamla = (apR.rows[0] && apR.rows[0].db) || 0;
    } catch (e) { /* carrier_invoices hiányában 0 */ }

    // 5) Lejáró dokumentumok — a getExpiryAlerts logikájával (document_expiries
    //    alert_days ablakon belül). Best-effort.
    let lejaroDok = 0;
    try {
      const docR = await pool.query(
        `SELECT COUNT(*)::int AS db
           FROM document_expiries
          WHERE company_id = $1
            AND expiry_date <= CURRENT_DATE + alert_days * INTERVAL '1 day'`,
        [cid]
      );
      lejaroDok = (docR.rows[0] && docR.rows[0].db) || 0;
    } catch (e) { /* document_expiries hiányában 0 */ }

    // 6) Operatív egészség-mutatók (proxy-k a meglévő adatból):
    //    - kiosztott arány: a kiosztásra váró (Disponibil) fuvarok vs. összes aktív
    //    - flotta-kihasználtság: aktív (úton lévő) jármű / aktív jármű össz.
    const waitR = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'Disponibil')::int AS varakozo,
              COUNT(*) FILTER (WHERE status = ANY($2))::int AS aktiv
         FROM orders WHERE company_id = $1`,
      [cid, ACTIVE_STATUSES]
    );
    const wc = waitR.rows[0] || { varakozo: 0, aktiv: 0 };
    // Kiosztott arány = (aktív − várakozó) / aktív; ha nincs aktív fuvar → null (kihagyjuk).
    const assignedPct = wc.aktiv > 0
      ? Math.round(((wc.aktiv - wc.varakozo) / wc.aktiv) * 100)
      : null;

    // Aktív (üzemképes) flotta + a hozzárendelt (úton lévő) járművek aránya.
    let utilizationPct = null;
    let fleetActive = 0, fleetOnRoad = 0;
    try {
      const fr = await pool.query(
        `SELECT COUNT(*)::int AS aktiv_jarmu FROM vehicles WHERE company_id = $1 AND activ = TRUE`,
        [cid]
      );
      fleetActive = (fr.rows[0] && fr.rows[0].aktiv_jarmu) || 0;
      // Hány különböző vontató-rendszám van aktív (úton lévő) fuvaron.
      const onroad = await pool.query(
        `SELECT COUNT(DISTINCT rendszam_camion)::int AS db
           FROM orders
          WHERE company_id = $1 AND status IN ('Alocat','In Curs','Extern')
            AND COALESCE(rendszam_camion,'') <> ''`,
        [cid]
      );
      fleetOnRoad = (onroad.rows[0] && onroad.rows[0].db) || 0;
      if (fleetActive > 0) {
        utilizationPct = Math.min(100, Math.round((fleetOnRoad / fleetActive) * 100));
      }
    } catch (e) { /* vehicles hiányában kihagyjuk */ }

    return res.json({ result: {
      ok: true,
      counters: {
        aktiv: oc.aktiv || 0,
        mai_felrakas: oc.mai_felrakas || 0,
        mai_lerakas: oc.mai_lerakas || 0,
        keso: oc.keso || 0,
        hianyzo_uit: hianyzoUit,
        hianyzo_fuvarozo: oc.hianyzo_fuvarozo || 0,
        lejaro_szamla: lejaroSzamla,
        lejaro_ap_szamla: lejaroApSzamla,
        lejaro_dok: lejaroDok
      },
      health: {
        assigned_pct: assignedPct,      // kiosztott fuvarok aránya (%) vagy null
        utilization_pct: utilizationPct, // flotta-kihasználtság (%) vagy null
        fleet_active: fleetActive,
        fleet_on_road: fleetOnRoad,
        waiting: wc.varakozo || 0
      }
    }});
  } catch (err) {
    console.error('getOpsCenter hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
