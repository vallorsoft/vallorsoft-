// ============================================================
//  VallorSoft — lib/fuelLossAlert.js
//  Üzemanyag-hiány riasztás a GPS tartály-szintből — automatikusan,
//  oldal-megnyitás nélkül.
//
//  Naponta és járművenként összeadja a már meglévő ellenőrzések
//  (lib/fuelCheck.js + levelFuel) hiányát:
//    • álló helyzetben eltűnt üzemanyag (stopCheck),
//    • hirtelen szint-csökkenés (levelFuel losses) — ha nem ugyanaz az
//      esemény, mint egy álló helyzetű hiány (nem számoljuk kétszer),
//    • bon szerint több liter, mint amennyi a tartályba ténylegesen került.
//
//  Küszöbök (env-vel felülírhatók):
//    FUEL_LOSS_OFFICE_L (alap 100) felett → e-mail + push + értesítés az irodának
//    FUEL_LOSS_DRIVER_L (alap 250) felett → a sofőrnek is e-mail + push
//  Egy nap egy járműre fokozatonként csak egyszer megy ki (fuel_loss_alerts.level).
//  A felületen és a levélben a „lopás" szó nem szerepel — „hiány / diferență".
// ============================================================
const pool = require('../db');
const gt = require('./gpsTrack');

const OFFICE_L = Math.max(1, parseFloat(process.env.FUEL_LOSS_OFFICE_L) || 100);
const DRIVER_L = Math.max(OFFICE_L, parseFloat(process.env.FUEL_LOSS_DRIVER_L) || 250);
const LOOKBACK_DAYS = 7;          // ennyi napra visszamenőleg nézzük újra (később beírt bon miatt)
const OVERLAP_S = 1800;           // hirtelen csökkenés ±30 percen belül egy álló hiánnyal = ugyanaz az esemény

const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const norm = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Egy nap hiányának összesítése (tiszta függvény, DB nélkül tesztelhető).
 * @param {Array} stopItems  stopCheck().items  [{from,to,liters,lat,lng}]
 * @param {Array} losses     levelFuel().losses [{t,liters,lat,lng,moving}]
 * @param {number} receiptMissing  receiptCheck().missing_l
 * @param {number} d0 d1  a nap határai (epoch mp)
 */
function summarizeDay(stopItems, losses, receiptMissing, d0, d1) {
  const inDay = (t) => t >= d0 && t < d1;
  const stops = (stopItems || []).filter((s) => inDay(s.from) || inDay(s.to));
  const stopL = stops.reduce((a, s) => a + (Number(s.liters) || 0), 0);
  const sudden = (losses || []).filter((l) => inDay(l.t)).filter((l) =>
    !stops.some((s) => l.t >= s.from - OVERLAP_S && l.t <= s.to + OVERLAP_S));
  const suddenL = sudden.reduce((a, l) => a + (Number(l.liters) || 0), 0);
  const receiptL = Math.max(0, Number(receiptMissing) || 0);
  const events = stops.map((s) => ({ kind: 'stop', t: s.from, liters: r1(s.liters), lat: s.lat, lng: s.lng }))
    .concat(sudden.map((l) => ({ kind: l.moving ? 'moving' : 'sudden', t: l.t, liters: r1(l.liters), lat: l.lat, lng: l.lng })))
    .sort((a, b) => a.t - b.t);
  return { total_l: r1(stopL + suddenL + receiptL), stop_l: r1(stopL), sudden_l: r1(suddenL), receipt_l: r1(receiptL), events };
}

/** Milyen fokozat jár a hiányhoz: 0 = semmi, 1 = iroda, 2 = iroda + sofőr */
function levelFor(totalL) {
  if (totalL > DRIVER_L) return 2;
  if (totalL > OFFICE_L) return 1;
  return 0;
}

async function _dayPoints(cid, plate, day) {
  const { rows } = await pool.query(
    `SELECT day::text AS day, points_json FROM gps_track_days
      WHERE company_id=$1 AND rendszam=$2 AND day BETWEEN $3::date - 1 AND $3::date + 1 AND point_count > 0
      ORDER BY day`, [cid, plate, day]);
  let pts = [];
  for (const r of rows) { try { const a = JSON.parse(r.points_json || '[]'); if (Array.isArray(a)) pts = pts.concat(a); } catch (_) {} }
  pts.sort((a, b) => a[0] - b[0]);
  return pts;
}

/** Egy jármű egy napjának ellenőrzése → összesítő (nem ír). */
async function checkDay(cid, plate, day) {
  const all = await _dayPoints(cid, plate, day);
  if (all.length < 10) return null;
  const d0 = Math.floor(gt.dayStartMs(day) / 1000), d1 = Math.floor(gt.dayStartMs(gt.addDays(day, 1)) / 1000);
  const lf = gt.levelFuel(all);
  if (!lf) return null;                          // nincs tartály-szint az eszközön
  const kmOdo = gt.odoDelta(all, 0, all.length - 1, 50000);
  const fuelCnt = gt.fuelDelta(all, 0, all.length - 1, 20000);
  const { buildFuelCheck } = require('../handlers/gpsTrack');
  const fc = await buildFuelCheck(cid, plate, day, day, all, lf, kmOdo, fuelCnt);
  const stopItems = fc.stops && fc.stops.ok ? fc.stops.items : [];
  const receiptMissing = fc.receipts && fc.receipts.ok ? fc.receipts.missing_l : 0;
  return summarizeDay(stopItems, lf.losses, receiptMissing, d0, d1);
}

const _fmtT = (t) => new Date(t * 1000).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const _esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND_RO = { stop: 'Scădere în staționare', sudden: 'Scădere bruscă', moving: 'Scădere în mers' };

function _eventsTable(s) {
  const rows = s.events.slice(0, 20).map((e) =>
    '<tr><td style="padding:6px 10px;border-bottom:1px solid #ece3d8;">' + _esc(_fmtT(e.t)) + '</td>'
    + '<td style="padding:6px 10px;border-bottom:1px solid #ece3d8;">' + _esc(KIND_RO[e.kind] || e.kind) + '</td>'
    + '<td style="padding:6px 10px;border-bottom:1px solid #ece3d8;text-align:right;font-weight:700;color:#b91c1c;">' + r1(e.liters) + ' L</td>'
    + '<td style="padding:6px 10px;border-bottom:1px solid #ece3d8;font-size:12px;">'
    + (e.lat != null ? '<a href="https://www.google.com/maps?q=' + Number(e.lat).toFixed(5) + ',' + Number(e.lng).toFixed(5) + '">'
      + Number(e.lat).toFixed(5) + ', ' + Number(e.lng).toFixed(5) + '</a>' : '') + '</td></tr>').join('');
  const rec = s.receipt_l > 0
    ? '<tr><td style="padding:6px 10px;" colspan="2">Bon fiscal peste nivelul măsurat în rezervor</td>'
      + '<td style="padding:6px 10px;text-align:right;font-weight:700;color:#b91c1c;">' + r1(s.receipt_l) + ' L</td><td></td></tr>' : '';
  return '<table style="width:100%;border-collapse:collapse;font-size:13px;">' + rows + rec
    + '<tr><td colspan="2" style="padding:8px 10px;font-weight:800;">Total diferență</td>'
    + '<td style="padding:8px 10px;text-align:right;font-weight:800;color:#b91c1c;">' + r1(s.total_l) + ' L</td><td></td></tr></table>';
}

async function _notifyOffice(cid, plate, day, s, driver) {
  const title = '⛽ Diferență de combustibil: ' + r1(s.total_l) + ' L';
  const body = plate + ' · ' + day + (driver && driver.nume ? ' · ' + driver.nume : '');
  try { await require('../services/push').sendPushToRole(cid, ['Admin', 'Manager'], { title, body, url: '/admin' }); } catch (_) {}
  try {
    const { notify } = require('../handlers/notifications');
    await notify(pool, { company_id: cid, type: 'fuel_loss', title, body, link_tab: 'gps-daily-track' });
  } catch (_) {}
  try {
    const sch = require('../services/scheduler');
    const html = sch._alertEmailBody(
      '⛽ Diferență de combustibil detectată',
      'Sistemul a detectat pe <b>' + _esc(day) + '</b> la vehiculul <b>' + _esc(plate) + '</b>'
        + (driver && driver.nume ? ' (șofer: <b>' + _esc(driver.nume) + '</b>)' : '')
        + ' o diferență de <b>' + r1(s.total_l) + ' L</b> între nivelul măsurat în rezervor și consumul normal.',
      _eventsTable(s),
      'Verificați traseul în VallorSoft → Flotă → Traseu GPS. Pragul de alertă: ' + OFFICE_L + ' L / zi.');
    await sch._emailAlertToAdmins(cid, '⛽ VallorSoft — Diferență de combustibil ' + plate + ' (' + r1(s.total_l) + ' L)', html, 'fuel_loss');
  } catch (_) {}
}

async function _notifyDriver(cid, plate, day, s, driver) {
  if (!driver || !driver.email) return false;
  const title = '⛽ Verificați combustibilul — ' + plate;
  const body = 'Sistemul a detectat o diferență mare de combustibil (' + r1(s.total_l) + ' L) pe ' + day + '. Vă rugăm verificați.';
  try { await require('../services/push').sendPushToEmail([driver.email], { title, body, url: '/sofer' }, cid); } catch (_) {}
  try {
    const { sendClientEmail } = require('../services/email');
    const sch = require('../services/scheduler');
    const html = sch._alertEmailBody(
      '⛽ Diferență mare de combustibil',
      'Bună ziua' + (driver.nume ? ', ' + _esc(driver.nume) : '') + '! Sistemul a detectat pe <b>' + _esc(day)
        + '</b> la vehiculul <b>' + _esc(plate) + '</b> o diferență mare de combustibil (<b>' + r1(s.total_l)
        + ' L</b>). Vă rugăm să verificați rezervorul, bușonul și eventualele scurgeri și să anunțați biroul dacă observați o problemă.',
      _eventsTable(s),
      'Mesaj automat VallorSoft. Dacă ați alimentat și ați încărcat bonul, verificați ca litrii de pe foaia de parcurs să fie corecți.');
    const r = await sendClientEmail({ to: driver.email, subject: '⛽ Verificați combustibilul — ' + plate + ' (' + day + ')', html, companyId: cid, mailType: 'fuel_loss_driver' });
    return !!(r && r.ok);
  } catch (_) { return false; }
}

/** Egy kör: a friss / frissült napok ellenőrzése és a riasztások kiküldése. */
async function runRound(opts) {
  const o = opts || {};
  const limit = Math.max(1, Math.min(200, o.limit || 40));
  const allowed = o.allowed || (async () => true);
  const budget = o.budgetMs || 3 * 60 * 1000;
  const t0 = Date.now();
  const today = gt.localDay(Date.now());
  let q;
  try {
    q = await pool.query(
      `SELECT g.company_id, g.rendszam, g.day::text AS day
         FROM gps_track_days g
    LEFT JOIN fuel_loss_alerts a ON a.company_id=g.company_id AND a.rendszam=g.rendszam AND a.day=g.day
        WHERE g.day BETWEEN $1::date - $2::int AND $1::date - 1 AND g.point_count > 10
          AND (a.id IS NULL OR a.checked_at < g.updated_at OR a.checked_at < NOW() - INTERVAL '12 hours')
        ORDER BY g.day DESC LIMIT $3`, [today, LOOKBACK_DAYS, limit]);
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) return { checked: 0, alerts: 0 };
    throw e;
  }
  let checked = 0, alerts = 0;
  for (const r of q.rows) {
    if (Date.now() - t0 > budget) break;
    if (!(await allowed(r.company_id))) continue;
    try {
      const s = await checkDay(r.company_id, r.rendszam, r.day);
      checked++;
      const prev = await pool.query(
        'SELECT level FROM fuel_loss_alerts WHERE company_id=$1 AND rendszam=$2 AND day=$3', [r.company_id, r.rendszam, r.day]);
      const prevLevel = prev.rows[0] ? Number(prev.rows[0].level) || 0 : 0;
      const sum = s || { total_l: 0, stop_l: 0, sudden_l: 0, receipt_l: 0, events: [] };
      const want = levelFor(sum.total_l);
      let newLevel = prevLevel, driverEmail = null;
      if (want > prevLevel) {
        const plate = norm(r.rendszam);
        const midday = new Date((gt.dayStartMs(r.day) / 1000 + 12 * 3600) * 1000);
        let driver = null;
        try { driver = await require('./borderAuto').attributeDriver(r.company_id, plate, midday); } catch (_) {}
        if (prevLevel < 1) await _notifyOffice(r.company_id, r.rendszam, r.day, sum, driver);
        if (want >= 2) { await _notifyDriver(r.company_id, r.rendszam, r.day, sum, driver); driverEmail = driver && driver.email; }
        newLevel = want; alerts++;
        try {
          await require('./audit').record({ company_id: r.company_id, action: 'fuel.loss_alert',
            entity_type: 'vehicle', entity_id: r.rendszam, detail: { day: r.day, total_l: sum.total_l, level: want, driver: driverEmail } });
        } catch (_) {}
      }
      await pool.query(
        `INSERT INTO fuel_loss_alerts (company_id, rendszam, day, total_l, stop_l, sudden_l, receipt_l, detail, level, driver_email, checked_at, alerted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,NOW(),$11)
         ON CONFLICT (company_id, rendszam, day) DO UPDATE SET
           total_l=EXCLUDED.total_l, stop_l=EXCLUDED.stop_l, sudden_l=EXCLUDED.sudden_l, receipt_l=EXCLUDED.receipt_l,
           detail=EXCLUDED.detail, level=GREATEST(fuel_loss_alerts.level, EXCLUDED.level),
           driver_email=COALESCE(EXCLUDED.driver_email, fuel_loss_alerts.driver_email), checked_at=NOW(),
           alerted_at=COALESCE(EXCLUDED.alerted_at, fuel_loss_alerts.alerted_at)`,
        [r.company_id, r.rendszam, r.day, sum.total_l, sum.stop_l, sum.sudden_l, sum.receipt_l,
          JSON.stringify({ events: sum.events.slice(0, 30) }), newLevel, driverEmail, newLevel > prevLevel ? new Date() : null]);
    } catch (e) { console.warn('[FuelLoss] jármű/nap hiba', r.company_id, r.rendszam, r.day, e.message); }
  }
  return { checked, alerts };
}

module.exports = { runRound, checkDay, summarizeDay, levelFor, OFFICE_L, DRIVER_L };
