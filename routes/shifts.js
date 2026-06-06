// ============================================================
//  VallorSoft — Műszak (driver_shifts) API route-ok
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const dow = d.getUTCDay();                   // 0=vasárnap … 6=szombat
  const diff = dow === 0 ? -6 : 1 - dow;      // visszalépés hétfőre
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];        // 'YYYY-MM-DD'
}

router.post('/api/shift/start', requireLogin, requireRole('Sofer'), async (req, res) => {
  const driver = req.session.user;
  try {
    // 1. Van-e aktív/nyitott shift? (partial UNIQUE index elkapná DB szinten is,
    //    de szebb üzenettel visszatérünk felette)
    const activeCheck = await pool.query(
      `SELECT shift_id FROM driver_shifts
       WHERE driver_id = $1 AND status IN ('ACTIVE','PAUSED','REST','SCHEDULED')
       LIMIT 1`,
      [driver.id]
    );
    if (activeCheck.rows.length) {
      return res.json({ ok: false, message: 'Már van aktív műszakod. Zárd le előbb a jelenlegi napot.' });
    }

    // 2. Zárolás ellenőrzés (heti 6. nap utáni 24h)
    const lockRow = await pool.query(
      `SELECT locked_until FROM driver_shifts
       WHERE driver_id = $1 AND locked_until IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [driver.id]
    );
    if (lockRow.rows.length) {
      const lu = lockRow.rows[0].locked_until;
      if (lu && new Date(lu) > new Date()) {
        return res.json({
          ok: false,
          locked: true,
          locked_until: new Date(lu).toISOString(),
          message: `Zárolva (heti 6 munkanap teljesítve). Legkorábban: ${new Date(lu).toLocaleString('hu-HU')} -tól indíthatsz újra.`
        });
      }
    }

    // 3. Heti sorszám kiszámítása
    const weekStart = getWeekStart();
    const weekCount = await pool.query(
      `SELECT COUNT(*)::int AS db FROM driver_shifts
       WHERE driver_id = $1 AND week_start_date = $2 AND day_started_at IS NOT NULL`,
      [driver.id, weekStart]
    );
    const shiftIndex = (weekCount.rows[0].db || 0) + 1;

    // 4. Heti összmunkaidő az eddigi lezárt shiftekből
    const weekHours = await pool.query(
      `SELECT COALESCE(SUM(
         EXTRACT(EPOCH FROM (day_closed_at - day_started_at)) / 3600.0
         - (paused_total_minutes / 60.0)
       ), 0)::numeric(6,2) AS total
       FROM driver_shifts
       WHERE driver_id = $1 AND week_start_date = $2
         AND day_closed_at IS NOT NULL AND day_started_at IS NOT NULL`,
      [driver.id, weekStart]
    );
    const weekTotal = parseFloat(weekHours.rows[0].total) || 0;

    // 5. Új shift létrehozása
    const r = await pool.query(
      `INSERT INTO driver_shifts
         (driver_id, driver_email, company_id, status,
          day_started_at, week_start_date, shift_index_in_week, weekly_hours_total)
       VALUES ($1, $2, $3, 'ACTIVE', NOW(), $4, $5, $6)
       RETURNING shift_id, day_started_at`,
      [driver.id, driver.email, driver.company_id, weekStart, shiftIndex, weekTotal]
    );

    return res.json({
      ok: true,
      shift_id: r.rows[0].shift_id,
      started_at: r.rows[0].day_started_at,
      shift_index: shiftIndex,
      week_hours_so_far: weekTotal
    });
  } catch (err) {
    console.error('[shift/start] hiba:', err);
    return res.json({ ok: false, message: 'Szerver hiba.' });
  }
});


// ============================================================
//  POST /api/shift/pause — Szünet kezdése
//  ACTIVE → PAUSED, rögzíti a paused_at timestamp-et
// ============================================================
router.post('/api/shift/pause', requireLogin, requireRole('Sofer'), async (req, res) => {
  const driver = req.session.user;
  try {
    const shift = await pool.query(
      `SELECT shift_id FROM driver_shifts
       WHERE driver_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [driver.id]
    );
    if (!shift.rows.length) {
      return res.json({ ok: false, message: 'Nincs aktív műszak.' });
    }
    await pool.query(
      `UPDATE driver_shifts
       SET status='PAUSED', paused_at=NOW(),
           pause_notif_sent_at=NULL, snooze_until=NULL, updated_at=NOW()
       WHERE shift_id = $1`,
      [shift.rows[0].shift_id]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[shift/pause] hiba:', err);
    return res.json({ ok: false, message: 'Szerver hiba.' });
  }
});


// ============================================================
//  POST /api/shift/resume — Visszatérés szünetből
//  PAUSED → ACTIVE, szünet percek hozzáadódnak paused_total-hoz
//  Body: {} (nincs adat, a session azonosít)
// ============================================================
router.post('/api/shift/resume', requireLogin, requireRole('Sofer'), async (req, res) => {
  const driver = req.session.user;
  try {
    const shift = await pool.query(
      `SELECT shift_id, paused_at, paused_total_minutes FROM driver_shifts
       WHERE driver_id = $1 AND status = 'PAUSED' LIMIT 1`,
      [driver.id]
    );
    if (!shift.rows.length) {
      return res.json({ ok: false, message: 'Nincs szünetelő műszak.' });
    }
    const s = shift.rows[0];
    const addedMin = s.paused_at
      ? Math.max(0, Math.round((Date.now() - new Date(s.paused_at).getTime()) / 60000))
      : 0;

    await pool.query(
      `UPDATE driver_shifts
       SET status='ACTIVE', paused_at=NULL,
           pause_notif_sent_at=NULL, snooze_until=NULL,
           paused_total_minutes = paused_total_minutes + $1,
           updated_at=NOW()
       WHERE shift_id = $2`,
      [addedMin, s.shift_id]
    );
    return res.json({ ok: true, paused_minutes_added: addedMin });
  } catch (err) {
    console.error('[shift/resume] hiba:', err);
    return res.json({ ok: false, message: 'Szerver hiba.' });
  }
});


// ============================================================
//  POST /api/shift/close — Nap zárása (sofőr manuálisan zárja)
//  ACTIVE | PAUSED → INACTIVE
//  Body: { overtime_reason?: string }
//  - is_overtime flag beállítása ha > 15h
//  - locked_until beállítása ha ez a 6. nap
//  - weekly_hours_total frissítése
// ============================================================
router.post('/api/shift/close', requireLogin, requireRole('Sofer'), async (req, res) => {
  const driver = req.session.user;
  const { overtime_reason } = req.body || {};
  try {
    const shift = await pool.query(
      `SELECT shift_id, day_started_at, paused_total_minutes,
              shift_index_in_week, week_start_date
       FROM driver_shifts
       WHERE driver_id = $1 AND status IN ('ACTIVE','PAUSED') LIMIT 1`,
      [driver.id]
    );
    if (!shift.rows.length) {
      return res.json({ ok: false, message: 'Nincs lezárható műszak.' });
    }
    const s = shift.rows[0];
    const now = new Date();
    const activeHours = (now - new Date(s.day_started_at)) / 3600000
                        - (s.paused_total_minutes || 0) / 60;
    const isOvertime  = activeHours > 15;

    // Heti zárolás: ha ez a 6. (vagy több) nap
    const lockedUntil = s.shift_index_in_week >= 6
      ? new Date(now.getTime() + 24 * 3600 * 1000)
      : null;

    // Heti összmunkaidő frissítése (eddigi lezárt + ez a shift)
    const prevHours = await pool.query(
      `SELECT COALESCE(SUM(
         EXTRACT(EPOCH FROM (day_closed_at - day_started_at)) / 3600.0
         - (paused_total_minutes / 60.0)
       ), 0)::numeric(6,2) AS total
       FROM driver_shifts
       WHERE driver_id = $1 AND week_start_date = $2
         AND day_closed_at IS NOT NULL AND day_started_at IS NOT NULL
         AND shift_id != $3`,
      [driver.id, s.week_start_date, s.shift_id]
    );
    const weeklyTotal = parseFloat(prevHours.rows[0].total || 0) + Math.max(0, activeHours);

    await pool.query(
      `UPDATE driver_shifts
       SET status='INACTIVE', day_closed_at=NOW(),
           is_overtime=$1, overtime_reason=$2,
           locked_until=$3, weekly_hours_total=$4,
           updated_at=NOW()
       WHERE shift_id = $5`,
      [isOvertime, overtime_reason || null, lockedUntil, weeklyTotal.toFixed(2), s.shift_id]
    );

    // Push ha 6. nap → heti zárolás
    if (lockedUntil) {
      await sendPushToEmail([driver.email], {
        title: '🔒 VallorSoft — Heti zárolás aktív',
        body: `6. munkanap kész. Következő indulás: ${lockedUntil.toLocaleString('hu-HU')} után lehetséges.`,
        icon: '/icon192.png', badge: '/icon192.png',
        tag:  'vs-shift-lock',
        url:  '/sofer',
        data: { type: 'weekly_lock' }
      });
    }

    return res.json({
      ok: true,
      is_overtime: isOvertime,
      active_hours: parseFloat(activeHours.toFixed(2)),
      weekly_hours: parseFloat(weeklyTotal.toFixed(2)),
      locked_until: lockedUntil
    });
  } catch (err) {
    console.error('[shift/close] hiba:', err);
    return res.json({ ok: false, message: 'Szerver hiba.' });
  }
});


// ============================================================
//  POST /api/shift/rest — Pihenő beállítása (nap zárása után)
//  INACTIVE (rest_type=NULL) → REST
//  Body: { rest_type: '9h'|'11h'|'24h'|'45h'|'custom'|'vacation',
//          rest_hours?: number }   (custom/vacation esetén kötelező)
//  Visszatér: next_shift_start timestamp
// ============================================================
router.post('/api/shift/rest', requireLogin, requireRole('Sofer'), async (req, res) => {
  const driver = req.session.user;
  const { rest_type, rest_hours } = req.body || {};
  try {
    // A legutóbb lezárt shift ahol még nincs pihenő beállítva
    const shift = await pool.query(
      `SELECT shift_id, day_closed_at FROM driver_shifts
       WHERE driver_id = $1 AND status = 'INACTIVE'
         AND day_closed_at IS NOT NULL AND rest_type IS NULL
       ORDER BY day_closed_at DESC LIMIT 1`,
      [driver.id]
    );
    if (!shift.rows.length) {
      return res.json({ ok: false, message: 'Nincs lezárt (pihenő nélküli) műszak.' });
    }
    const s = shift.rows[0];

    const presetMap = { '9h': 9, '11h': 11, '24h': 24, '45h': 45 };
    const hours = presetMap[rest_type] ?? parseFloat(rest_hours);
    if (!hours || isNaN(hours) || hours <= 0) {
      return res.json({ ok: false, message: 'Érvénytelen pihenő típus vagy óraszám.' });
    }

    const nextShiftStart = new Date(
      new Date(s.day_closed_at).getTime() + hours * 3600 * 1000
    );

    await pool.query(
      `UPDATE driver_shifts
       SET rest_type=$1, rest_hours=$2, next_shift_start=$3,
           status='REST', updated_at=NOW()
       WHERE shift_id = $4`,
      [rest_type, hours, nextShiftStart, s.shift_id]
    );

    return res.json({ ok: true, next_shift_start: nextShiftStart, rest_hours: hours });
  } catch (err) {
    console.error('[shift/rest] hiba:', err);
    return res.json({ ok: false, message: 'Szerver hiba.' });
  }
});


// ============================================================
//  POST /api/shift/snooze-pause — "X óra múlva visszakérdez"
//  Szünet PAUSED állapotban: a sofőr nem indult el, de
//  el akarja halasztani a 48-perces push-t.
//  Body: { snooze_hours: number }  (1, 2, 3, 4, 5 — egész)
// ============================================================
router.post('/api/shift/snooze-pause', requireLogin, requireRole('Sofer'), async (req, res) => {
  const driver = req.session.user;
  const snoozeH = Math.max(1, Math.min(12, parseInt(req.body.snooze_hours) || 1));
  try {
    const shift = await pool.query(
      `SELECT shift_id FROM driver_shifts WHERE driver_id = $1 AND status = 'PAUSED' LIMIT 1`,
      [driver.id]
    );
    if (!shift.rows.length) return res.json({ ok: false });

    const snoozeUntil = new Date(Date.now() + snoozeH * 3600 * 1000);
    await pool.query(
      `UPDATE driver_shifts
       SET snooze_until=$1, pause_notif_sent_at=NULL, updated_at=NOW()
       WHERE shift_id=$2`,
      [snoozeUntil, shift.rows[0].shift_id]
    );
    return res.json({ ok: true, snooze_until: snoozeUntil, snooze_hours: snoozeH });
  } catch (err) {
    console.error('[shift/snooze-pause] hiba:', err);
    return res.json({ ok: false });
  }
});


// ============================================================

//  POST /api/shift/cancel-rest — Pihenő megszüntetése
//  Törli az aktív REST státuszú shift-et -> sofőr elölről kezdhet
router.post('/api/shift/cancel-rest', requireLogin, requireRole('Sofer'), async (req, res) => {
  const user = req.session.user;
  try {
    const r = await pool.query(
      `UPDATE driver_shifts SET status='INACTIVE', updated_at=NOW()
       WHERE driver_id=$1 AND status='REST'
       RETURNING shift_id`,
      [user.id]
    );
    if (!r.rows.length) return res.json({ ok: false, message: 'Nincs aktív pihenő.' });
    return res.json({ ok: true });
  } catch(err) {
    console.error('[shift/cancel-rest]', err);
    return res.json({ ok: false, message: 'Szerver hiba' });
  }
});

//  GET /api/shift/current — Aktuális shift lekérése (UI polling)
//  Visszaadja az élő shif minden adatát, vagy:
//  { shift: null, locked_until } ha nincs élő, de zárolva van
// ============================================================
router.get('/api/shift/current', requireLogin, async (req, res) => {
  const driver = req.session.user;
  try {
    const r = await pool.query(
      `SELECT shift_id, status, day_started_at, day_closed_at,
              paused_at, paused_total_minutes, pause_notif_sent_at, snooze_until,
              rest_type, rest_hours, next_shift_start, notif_sent_at,
              week_start_date, shift_index_in_week,
              weekly_hours_total, locked_until, is_overtime
       FROM driver_shifts
       WHERE driver_id = $1 AND status NOT IN ('INACTIVE')
       ORDER BY created_at DESC LIMIT 1`,
      [driver.id]
    );

    if (r.rows.length) {
      return res.json({ ok: true, shift: r.rows[0] });
    }

    // Nincs élő shift — ellenőrzés: van-e aktív zárolás?
    const lastLock = await pool.query(
      `SELECT locked_until, shift_index_in_week, weekly_hours_total
       FROM driver_shifts
       WHERE driver_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [driver.id]
    );
    return res.json({
      ok: true,
      shift: null,
      locked_until: lastLock.rows[0]?.locked_until || null,
      last_week_hours: lastLock.rows[0]?.weekly_hours_total || 0
    });
  } catch (err) {
    console.error('[shift/current] hiba:', err);
    return res.json({ ok: false, shift: null });
  }
});


// ============================================================
//  GET /api/shift/week-summary — Heti összesítő (Manager + saját)
//  Sofőr: csak saját adatai (driver_id = session user)
//  Manager/Admin: query param ?driver_id=X (saját cég sofőrje)
// ============================================================
router.get('/api/shift/week-summary', requireLogin, async (req, res) => {
  const user = req.session.user;
  try {
    let targetDriverId;

    if (user.pozicio === 'Sofer') {
      targetDriverId = user.id;
    } else if (user.pozicio === 'Manager' || user.pozicio === 'Admin') {
      if (!req.query.driver_id) {
        // Visszaadja az összes sofőr aktuális státuszát (flotta nézet)
        const fleet = await pool.query(
          `SELECT u.id AS driver_id, u.nume, u.email,
                  ds.status, ds.day_started_at, ds.weekly_hours_total,
                  ds.shift_index_in_week, ds.rest_type, ds.next_shift_start,
                  ds.locked_until
           FROM users u
           LEFT JOIN driver_shifts ds ON ds.driver_id = u.id
             AND ds.status NOT IN ('INACTIVE')
           WHERE u.company_id = $1 AND u.pozicio = 'Sofer'
           ORDER BY u.nume`,
          [user.company_id]
        );
        return res.json({ ok: true, fleet: fleet.rows });
      }
      // Jogosultság: csak saját cég sofőrje
      const driverCheck = await pool.query(
        'SELECT id FROM users WHERE id=$1 AND company_id=$2 AND pozicio=$3',
        [parseInt(req.query.driver_id), user.company_id, 'Sofer']
      );
      if (!driverCheck.rows.length) return res.json({ ok: false, message: 'Nincs jogosultság.' });
      targetDriverId = parseInt(req.query.driver_id);
    } else {
      return res.json({ ok: false, message: 'Nincs jogosultság.' });
    }

    const weekStart = getWeekStart();
    const rows = await pool.query(
      `SELECT shift_id, status, day_started_at, day_closed_at,
              paused_total_minutes, rest_type, rest_hours,
              shift_index_in_week, weekly_hours_total,
              is_overtime, locked_until
       FROM driver_shifts
       WHERE driver_id = $1 AND week_start_date = $2
       ORDER BY COALESCE(day_started_at, created_at) ASC`,
      [targetDriverId, weekStart]
    );
    return res.json({ ok: true, week_start: weekStart, shifts: rows.rows });
  } catch (err) {
    console.error('[shift/week-summary] hiba:', err);
    return res.json({ ok: false });
  }
});



router.get('/api/shift/fleet-compliance', requireLogin, requireRole('Manager', 'Admin'), async (req, res) => {
  const user = req.session.user;
  try {
    const cid = user.company_id;
    const weekOffset = Math.max(0, Math.min(52, parseInt(req.query.week_offset, 10) || 0));
    const base = new Date(); base.setUTCDate(base.getUTCDate() - weekOffset * 7);
    const weekStart = getWeekStart(base);
    const fleetRes = await pool.query(
      `SELECT u.id AS driver_id, u.nume, u.email,
              COALESCE(ds.status, 'INACTIVE') AS status,
              ds.day_started_at, ds.paused_at, ds.rest_type,
              ds.next_shift_start, ds.locked_until, ds.is_overtime,
              ds.shift_index_in_week, ds.weekly_hours_total,
              CASE WHEN ds.status = 'ACTIVE' AND ds.day_started_at IS NOT NULL
                   THEN GREATEST(0, EXTRACT(EPOCH FROM (NOW() - ds.day_started_at)) / 3600.0 - COALESCE(ds.paused_total_minutes, 0) / 60.0)
                   ELSE NULL END AS current_active_hours
       FROM users u
       LEFT JOIN LATERAL (
         SELECT * FROM driver_shifts d WHERE d.driver_id = u.id AND d.status <> 'INACTIVE'
         ORDER BY d.updated_at DESC LIMIT 1
       ) ds ON TRUE
       WHERE u.company_id = $1 AND u.pozicio = 'Sofer' ORDER BY u.nume`, [cid]
    );
    const fleet_status = fleetRes.rows.map(r => ({ driver_id:r.driver_id, nume:r.nume, email:r.email, status:r.status, rest_type:r.rest_type, current_active_hours:r.current_active_hours, next_shift_start:r.next_shift_start, shift_index_in_week:r.shift_index_in_week, weekly_hours_total:r.weekly_hours_total, locked_until:r.locked_until, is_overtime:r.is_overtime, paused_at:r.paused_at }));
    const now = Date.now();
    const kpi = { total_drivers:fleet_status.length, active_count:fleet_status.filter(f=>f.status==='ACTIVE').length, paused_count:fleet_status.filter(f=>f.status==='PAUSED').length, rest_count:fleet_status.filter(f=>f.status==='REST'&&f.rest_type!=='vacation').length, vacation_count:fleet_status.filter(f=>f.status==='REST'&&f.rest_type==='vacation').length, locked_count:fleet_status.filter(f=>f.locked_until&&new Date(f.locked_until).getTime()>now).length };
    const compRes = await pool.query(
      `SELECT u.id AS driver_id, u.nume, u.email,
              COALESCE(SUM(CASE WHEN ds.day_started_at IS NOT NULL AND ds.day_closed_at IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (ds.day_closed_at - ds.day_started_at)) / 3600.0 - COALESCE(ds.paused_total_minutes, 0) / 60.0) ELSE 0 END), 0) AS weekly_hours,
              COUNT(ds.shift_id) FILTER (WHERE ds.day_started_at IS NOT NULL) AS shifts_count,
              COUNT(ds.shift_id) FILTER (WHERE ds.is_overtime = TRUE) AS overtime_count
       FROM users u LEFT JOIN driver_shifts ds ON ds.driver_id = u.id AND ds.week_start_date = $2
       WHERE u.company_id = $1 AND u.pozicio = 'Sofer' GROUP BY u.id, u.nume, u.email ORDER BY weekly_hours DESC`, [cid, weekStart]
    );
    const compliance = compRes.rows.map(r => ({ driver_id:r.driver_id, nume:r.nume, weekly_hours:parseFloat(r.weekly_hours).toFixed(1), shifts_count:parseInt(r.shifts_count,10), overtime_count:parseInt(r.overtime_count,10) }));
    const restRes = await pool.query(`SELECT ds.rest_type, AVG(ds.rest_hours) AS avg_hours, MIN(ds.rest_hours) AS min_hours, MAX(ds.rest_hours) AS max_hours, COUNT(*) AS db FROM driver_shifts ds JOIN users u ON u.id=ds.driver_id WHERE u.company_id=$1 AND u.pozicio='Sofer' AND ds.rest_type IS NOT NULL AND ds.rest_hours IS NOT NULL AND ds.created_at>=NOW()-INTERVAL '30 days' GROUP BY ds.rest_type`, [cid]);
    const rest_avg = restRes.rows.map(r => ({ rest_type:r.rest_type, avg_hours:parseFloat(r.avg_hours).toFixed(1), min_hours:parseFloat(r.min_hours).toFixed(1), max_hours:parseFloat(r.max_hours).toFixed(1), db:parseInt(r.db,10) }));
    const otRes = await pool.query(`SELECT u.nume, u.email, ds.day_started_at, ds.overtime_reason, CASE WHEN ds.day_closed_at IS NOT NULL AND ds.day_started_at IS NOT NULL THEN EXTRACT(EPOCH FROM (ds.day_closed_at - ds.day_started_at)) / 3600.0 ELSE NULL END AS active_hours FROM driver_shifts ds JOIN users u ON u.id=ds.driver_id WHERE u.company_id=$1 AND u.pozicio='Sofer' AND ds.is_overtime=TRUE AND ds.day_started_at>=NOW()-INTERVAL '14 days' ORDER BY ds.day_started_at DESC LIMIT 50`, [cid]);
    const overtime_alerts = otRes.rows.map(r => ({ nume:r.nume, email:r.email, day_started_at:r.day_started_at, active_hours:r.active_hours!=null?parseFloat(r.active_hours).toFixed(1):'0', overtime_reason:r.overtime_reason }));
    return res.json({ ok:true, week_start:weekStart, kpi, fleet_status, compliance, rest_avg, overtime_alerts });
  } catch(err) { console.error('[shift/fleet-compliance]',err); return res.json({ok:false, message:'Szerver hiba'}); }
});

module.exports = router;
