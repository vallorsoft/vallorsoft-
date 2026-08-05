// ============================================================
//  VallorSoft — handlers/statsInsights.js
//  Statisztika 2.0 — Insights aggregátor (anomália-központ)
//
//  EGYETLEN handler egyesíti az összes anomália-forrást:
//    - Fogyasztás-anomália (jármű ténylegese > névleges * 1.15)
//    - Lejárt kintlévőség (fizetési határidőn túli számlák)
//    - Sürgős/figyelmeztető szerviz (next_due_km/date közeledik)
//    - Alvállalkozói AP-öregítés (30-60 / 60+ nap)
//    - Dokumentum-lejáratok (ITP, RCA, tahográf stb.)
//    - Lejáró UIT-kódok
//    - Hiányzó UIT (needs_uit=true, nincs aktív kód)
//    - Fizetetlen fuvarozói AP-tartozás (open items)
//
//  Válasz: {
//    ok, insights[]: {
//       id, area, severity, icon, key, title, detail, value,
//       tab, entity_type, entity_id
//    },
//    count_by_severity: {danger, warn, info},
//    count_by_area: {finance, fleet, ops, people}
//  }
//
//  Adatszivárgás-védelem: minden lekérdezés company_id-szűrt, paraméteres
//  SQL, best-effort try/catch az opcionális táblákra (migráció-tudatos).
//  Pénzügyi mutatók csak `_canSeeFinance` mellett (a Manager alap-jog nélkül
//  is látja a NEM pénzügyi mutatókat).
// ============================================================
const pool = require('../db');

const handlers = {};

function _am(req) { return !!(req.session.user && ['Admin', 'Manager'].includes(req.session.user.pozicio)); }
function _deny(res) { return res.json({ result: { ok: false, err: 'Acces interzis' } }); }
function _err(res) { return res.json({ result: { ok: false, err: 'Eroare de server' } }); }

async function _canSeeFinance(req) {
  const me = req.session.user;
  if (!me) return false;
  if (me.pozicio === 'Admin' || me.is_dev) return true;
  if (me.pozicio !== 'Manager') return false;
  const r = await pool.query(
    `SELECT up.enabled FROM user_permissions up
     JOIN users u ON u.id = up.user_id
     WHERE LOWER(u.email) = LOWER($1) AND u.company_id = $2 AND up.perm_key = 'stats_finance'`,
    [me.email, me.company_id]);
  return !!(r.rows.length && r.rows[0].enabled);
}

// A közös FUV_FROM (fuvarlevelek + eff_date) helyben, hogy a modul függetlenül
// betölthető legyen — a fuvarlevelek.company_id horgony + email-fallback,
// azonos szemantikával mint a statisticsHandlers.js.
const FUV_FROM = `
  FROM (
    SELECT fl.*, COALESCE(fl.erkezes_dt, fl.indulas_dt, fl.data_completare) AS eff_date
    FROM fuvarlevelek fl
    WHERE fl.company_id = $1
       OR LOWER(fl.email_sofer) IN (SELECT LOWER(email) FROM users WHERE company_id = $1)
  ) f
`;

// ── SEVERITY súlyozás (rendezéshez) ─────────────────────
const SEV = { danger: 3, warn: 2, info: 1 };
const SEV_ORDER = { danger: 0, warn: 1, info: 2 };
function _order(a, b) {
  // FONTOS: a `||` NEM használható itt — a danger értéke 0, ami falsy, és a
  // fallback 9-re esne. `??` (nullish coalescing) csak null/undefined-nél lép.
  const sa = SEV_ORDER[a.severity] ?? 9;
  const sb = SEV_ORDER[b.severity] ?? 9;
  if (sa !== sb) return sa - sb;
  // Ugyanabban a severity-ben az értékrend szerint csökkenőleg
  return (parseFloat(b.value) || 0) - (parseFloat(a.value) || 0);
}

// ── Fogyasztás-anomália ─────────────────────────────────
async function _fuelAnomalies(cid) {
  const out = [];
  try {
    const r = await pool.query(
      `SELECT f.numar_camion AS rendszam,
              SUM(f.total_km)::numeric AS km,
              SUM(f.motorina_folosit)::numeric AS motorina,
              MAX(v.fuel_per_100km)::numeric AS nevleges
       ${FUV_FROM}
       JOIN vehicles v ON v.company_id = $1 AND UPPER(v.rendszam) = UPPER(f.numar_camion)
            AND v.fuel_per_100km > 0
       WHERE f.eff_date >= NOW() - INTERVAL '90 days'
       GROUP BY f.numar_camion
       HAVING SUM(f.total_km) >= 300
          AND (SUM(f.motorina_folosit) / NULLIF(SUM(f.total_km),0)) * 100 > MAX(v.fuel_per_100km) * 1.15`,
      [cid]);
    r.rows.forEach((v) => {
      const nev = parseFloat(v.nevleges);
      const c = (parseFloat(v.motorina) / parseFloat(v.km)) * 100;
      const dev = (c - nev) / nev;
      out.push({
        id: 'fuel-' + v.rendszam,
        area: 'fleet',
        severity: dev > 0.30 ? 'danger' : 'warn',
        icon: '⛽',
        key: 'fuel_high',
        title: v.rendszam,
        detail: 'Consum ' + (Math.round(c * 10) / 10) + ' L/100km (nominal ' + (Math.round(nev * 10) / 10) + ')',
        value: Math.round(c * 10) / 10,
        tab: 'fleet',
        entity_type: 'vehicle',
      });
    });
  } catch (e) { /* csendben — nincs jármű vagy fuel_per_100km */ }
  return out;
}

// ── Lejárt kintlévőség (pénzügy) ─────────────────────────
async function _overdueReceivables(cid) {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS db,
              COALESCE(SUM(GREATEST(o.pret-o.paid_amount,0)),0)::numeric AS osszeg
       FROM orders o LEFT JOIN clients c ON c.id = o.client_id
       WHERE o.company_id=$1 AND o.status='Finalizat' AND o.payment_status <> 'paid'
         AND o.pret > 0
         AND NOW() > o.finalized_at + COALESCE(c.payment_term_days, 30) * INTERVAL '1 day'`,
      [cid]);
    const row = r.rows[0];
    if (!row || !row.db) return [];
    return [{
      id: 'overdue-all',
      area: 'finance',
      severity: 'danger',
      icon: '⏳',
      key: 'ar_overdue',
      title: row.db + ' × restanță expirată',
      detail: Math.round(row.osszeg) + ' EUR neîncasat',
      value: parseFloat(row.osszeg) || 0,
      tab: 'finance',
    }];
  } catch (e) { return []; }
}

// ── Szerviz-előrejelzés (jármű) ─────────────────────────
async function _serviceForecast(cid) {
  const out = [];
  try {
    const svcR = await pool.query(
      `SELECT DISTINCT ON (vehicle_id) vehicle_id, next_due_km, next_due_date, km AS utolso_km
       FROM vehicle_service_log WHERE company_id=$1
       ORDER BY vehicle_id, service_date DESC, id DESC`, [cid]);
    if (!svcR.rowCount) return [];
    const vehR = await pool.query(
      `SELECT id, rendszam FROM vehicles WHERE company_id=$1 AND tip='Vontato'`, [cid]);
    const vehMap = new Map(vehR.rows.map((v) => [v.id, v.rendszam]));
    let gpsMap = new Map();
    try {
      const g = await pool.query(
        `SELECT DISTINCT ON (rendszam) UPPER(rendszam) AS rendszam, mileage
         FROM gps_month_end_snapshots WHERE company_id=$1
         ORDER BY rendszam, year DESC, month DESC`, [cid]);
      g.rows.forEach((r) => gpsMap.set(r.rendszam, parseFloat(r.mileage) || 0));
    } catch (_) { /* migráció előtt */ }
    // Havi km (utolsó 90 nap átlaga)
    const kmR = await pool.query(
      `SELECT UPPER(f.numar_camion) AS rendszam, COALESCE(SUM(f.total_km),0)::numeric AS km_90
       ${FUV_FROM}
       WHERE f.eff_date >= NOW() - INTERVAL '90 days' AND COALESCE(f.numar_camion,'') <> ''
       GROUP BY UPPER(f.numar_camion)`, [cid]);
    const kmMap = new Map(kmR.rows.map((r) => [r.rendszam, parseFloat(r.km_90) || 0]));
    svcR.rows.forEach((s) => {
      const plate = vehMap.get(s.vehicle_id);
      if (!plate) return;
      const P = String(plate).toUpperCase();
      const km30 = (kmMap.get(P) || 0) / 3;
      const currentKm = gpsMap.get(P) || parseFloat(s.utolso_km) || null;
      let hetek = null;
      if (s.next_due_km && currentKm != null && km30 > 0) {
        const hatra = Number(s.next_due_km) - Number(currentKm);
        hetek = (hatra / km30) * 4.33;
      }
      if (s.next_due_date) {
        const d = new Date(s.next_due_date);
        const hetek_d = (d - new Date()) / (86400000 * 7);
        if (hetek == null || hetek_d < hetek) hetek = hetek_d;
      }
      if (hetek == null || hetek > 6) return;
      out.push({
        id: 'service-' + s.vehicle_id,
        area: 'fleet',
        severity: hetek <= 2 ? 'danger' : 'warn',
        icon: '🔧',
        key: 'service_due',
        title: plate,
        detail: 'Service scadent în ' + (Math.round(hetek * 10) / 10) + ' săptămâni',
        value: Math.max(0, Math.round(hetek * 10) / 10),
        tab: 'fleet',
        entity_type: 'vehicle',
        entity_id: s.vehicle_id,
      });
    });
  } catch (e) { /* csendben */ }
  return out;
}

// ── Alvállalkozói AP-öregítés (60+ nap) ─────────────────
async function _apAging(cid) {
  try {
    const EFF_DUE = `COALESCE(ci.due_date, (ci.issue_date + INTERVAL '30 days')::date, (ci.created_at + INTERVAL '30 days')::date)`;
    const r = await pool.query(
      `SELECT
         COALESCE(SUM(ci.amount - ci.paid_amount) FILTER (
           WHERE ci.status <> 'paid' AND (${EFF_DUE}) < NOW() - INTERVAL '60 days'),0)::numeric AS d60p,
         COALESCE(SUM(ci.amount - ci.paid_amount) FILTER (
           WHERE ci.status <> 'paid' AND (${EFF_DUE}) < NOW() - INTERVAL '30 days'
             AND (${EFF_DUE}) >= NOW() - INTERVAL '60 days'),0)::numeric AS d31_60,
         COUNT(*) FILTER (WHERE ci.status <> 'paid' AND (${EFF_DUE}) < NOW() - INTERVAL '60 days')::int AS db_60p
       FROM carrier_invoices ci WHERE ci.company_id=$1 AND ci.amount>0`, [cid]);
    const row = r.rows[0]; if (!row) return [];
    const out = [];
    if (row.db_60p && parseFloat(row.d60p) > 0) {
      out.push({
        id: 'ap-60p',
        area: 'finance',
        severity: 'danger',
        icon: '📉',
        key: 'ap_60p',
        title: row.db_60p + ' × AP peste 60 zile',
        detail: Math.round(row.d60p) + ' RON neplătit',
        value: parseFloat(row.d60p) || 0,
        tab: 'finance',
      });
    }
    if (parseFloat(row.d31_60) > 0) {
      out.push({
        id: 'ap-31-60',
        area: 'finance',
        severity: 'warn',
        icon: '📉',
        key: 'ap_31_60',
        title: 'AP 31-60 zile: ' + Math.round(row.d31_60) + ' RON',
        detail: '',
        value: parseFloat(row.d31_60) || 0,
        tab: 'finance',
      });
    }
    return out;
  } catch (e) { return []; }
}

// ── Dokumentum-lejáratok (fleet-compliance) ─────────────
async function _documentExpiries(cid) {
  const out = [];
  try {
    const r = await pool.query(
      `SELECT id, entity_type, entity_label, doc_type,
              (expiry_date - CURRENT_DATE)::int AS days_left
       FROM document_expiries
       WHERE company_id=$1 AND expiry_date <= CURRENT_DATE + alert_days * INTERVAL '1 day'
       ORDER BY expiry_date ASC LIMIT 15`, [cid]);
    r.rows.forEach((x) => {
      const dl = x.days_left;
      const sev = dl <= 0 ? 'danger' : (dl <= 7 ? 'danger' : (dl <= 30 ? 'warn' : 'info'));
      out.push({
        id: 'expiry-' + x.id,
        area: 'fleet',
        severity: sev,
        icon: '📅',
        key: 'doc_expiry',
        title: (x.entity_label || '') + ' — ' + (x.doc_type || ''),
        detail: dl <= 0 ? 'Expirat de ' + (-dl) + ' zile' : 'Expiră în ' + dl + ' zile',
        value: dl,
        tab: 'fleet',
        entity_type: x.entity_type,
      });
    });
  } catch (e) { /* migráció előtt */ }
  return out;
}

// ── Lejáró UIT-kódok ─────────────────────────────────────
async function _uitExpiring(cid) {
  const out = [];
  try {
    const r = await pool.query(
      `SELECT order_id, uit_code, (valid_until - CURRENT_DATE)::int AS days_left
       FROM order_uit_codes
       WHERE company_id=$1 AND valid_until IS NOT NULL
         AND status <> 'stopped' AND valid_until <= CURRENT_DATE + 2
       ORDER BY valid_until ASC LIMIT 15`, [cid]);
    r.rows.forEach((x) => {
      const dl = x.days_left;
      out.push({
        id: 'uit-' + x.order_id,
        area: 'ops',
        severity: dl <= 0 ? 'danger' : 'warn',
        icon: '🛣️',
        key: 'uit_expiring',
        title: 'UIT ' + String(x.uit_code || '').slice(0, 12),
        detail: dl <= 0 ? 'Expirat' : 'Expiră în ' + dl + ' zile',
        value: dl,
        tab: 'ops',
        entity_type: 'order',
        entity_id: x.order_id,
      });
    });
  } catch (e) { /* nincs order_uit_codes tábla */ }
  return out;
}

// ── Hiányzó UIT (needs_uit=true de nincs aktív kód) ─────
async function _uitMissing(cid) {
  try {
    // A `orders` táblán a `needs_uit` opcionális (e-Transport migráció),
    // az uit_active_count derived. Legyünk defenzívek — ha az oszlopok
    // hiányoznak, semmit nem adunk.
    const r = await pool.query(
      `SELECT COUNT(*)::int AS db
       FROM orders o
       WHERE o.company_id=$1 AND COALESCE(o.needs_uit,false)=true
         AND NOT EXISTS (
           SELECT 1 FROM order_uit_codes u
           WHERE u.order_id=o.id AND u.status <> 'stopped'
         )
         AND o.status IN ('Disponibil','Alocat','In Curs','Extern')`, [cid]);
    const row = r.rows[0];
    if (!row || !row.db) return [];
    return [{
      id: 'uit-missing',
      area: 'ops',
      severity: 'warn',
      icon: '🛣️',
      key: 'uit_missing',
      title: row.db + ' × curse fără UIT',
      detail: 'Curse cu needs_uit=true, dar fără cod activ.',
      value: row.db,
      tab: 'ops',
    }];
  } catch (e) { return []; }
}

// ═══════════════════════ FŐ handler ═══════════════════════
handlers.getStatsInsights = async function (req, res, args) {
  try {
    if (!_am(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const canFin = await _canSeeFinance(req);

    // Párhuzamosan futtatjuk a forrás-lekérdezéseket — 6-7 gyors query
    const [fuel, service, expiry, uitExp, uitMiss] = await Promise.all([
      _fuelAnomalies(cid),
      _serviceForecast(cid),
      _documentExpiries(cid),
      _uitExpiring(cid),
      _uitMissing(cid),
    ]);
    const finance = canFin
      ? await Promise.all([_overdueReceivables(cid), _apAging(cid)]).then(function (rs) {
          return rs[0].concat(rs[1]);
        })
      : [];

    let insights = fuel
      .concat(service)
      .concat(expiry)
      .concat(uitExp)
      .concat(uitMiss)
      .concat(finance);

    // Rendezés (severity elöl, aztán value csökkenő)
    insights.sort(_order);

    // Összegzés
    const count_by_severity = { danger: 0, warn: 0, info: 0 };
    const count_by_area = { finance: 0, fleet: 0, ops: 0, people: 0 };
    insights.forEach(function (i) {
      count_by_severity[i.severity] = (count_by_severity[i.severity] || 0) + 1;
      count_by_area[i.area] = (count_by_area[i.area] || 0) + 1;
    });

    return res.json({ result: {
      ok: true,
      insights: insights,
      count_by_severity: count_by_severity,
      count_by_area: count_by_area,
      can_finance: canFin,
    }});
  } catch (err) {
    console.error('getStatsInsights hiba:', err);
    return _err(res);
  }
};

// Segéd: severity numerikus súly (kliens-oldali rendezéshez)
handlers.getStatsInsights.SEV = SEV;

module.exports = handlers;
