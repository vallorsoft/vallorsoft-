// ============================================================
//  VallorSoft — Műszak ütemező (1 perces ciklus)
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const pool = require('../db');
const webpush = require('./webpush');
const { sendPushToEmail } = require('./push');

function startShiftScheduler() {
  async function schedulerTick() {
    if (!webpush) return; // Push nélkül nincs értesítő — csendben kihagyjuk

    try {

      // ----------------------------------------------------------
      //  TICK 1 — Szünet értesítő: 48 perc eltelt
      //  Feltétel: PAUSED, 48 perce szünetel, értesítő még nem ment,
      //            és nincs aktív snooze
      // ----------------------------------------------------------
      const paused48 = await pool.query(`
        SELECT shift_id, driver_email
        FROM driver_shifts
        WHERE status = 'PAUSED'
          AND paused_at + INTERVAL '48 minutes' <= NOW()
          AND (pause_notif_sent_at IS NULL
               OR pause_notif_sent_at + INTERVAL '48 minutes' <= NOW())
          AND (snooze_until IS NULL OR snooze_until <= NOW())
      `);
      for (const row of paused48.rows) {
        await sendPushToEmail([row.driver_email], {
          title: '⏰ VallorSoft — Szünet emlékeztető',
          body:  '48 perce szünetel. Elindultál már?',
          icon:  '/icon192.png',
          badge: '/icon192.png',
          tag:   'vs-pause-check-' + row.shift_id,
          url:   '/sofer',
          data:  { type: 'pause_check', shift_id: row.shift_id }
        });
        await pool.query(
          `UPDATE driver_shifts
           SET pause_notif_sent_at=NOW(), snooze_until=NULL, updated_at=NOW()
           WHERE shift_id=$1`,
          [row.shift_id]
        );
        console.log('[Scheduler] TICK1 pause push → shift', row.shift_id);
      }

      // ----------------------------------------------------------
      //  TICK 2 — Indulás előtti értesítő: next_shift_start – 10 perc
      //  Feltétel: REST vagy SCHEDULED, van next_shift_start,
      //            -10 perc kapuban van, értesítő még nem ment
      // ----------------------------------------------------------
      const upcoming = await pool.query(`
        SELECT shift_id, driver_email, next_shift_start
        FROM driver_shifts
        WHERE status IN ('REST','SCHEDULED')
          AND next_shift_start IS NOT NULL
          AND next_shift_start - INTERVAL '10 minutes' <= NOW()
          AND next_shift_start > NOW()
          AND notif_sent_at IS NULL
      `);
      for (const row of upcoming.rows) {
        await sendPushToEmail([row.driver_email], {
          title: '🚛 VallorSoft — Műszak közeleg',
          body:  '10 perc múlva kezdődik a műszakod. Készen állsz?',
          icon:  '/icon192.png',
          badge: '/icon192.png',
          tag:   'vs-shift-soon-' + row.shift_id,
          url:   '/sofer',
          data:  { type: 'shift_upcoming', shift_id: row.shift_id }
        });
        await pool.query(
          `UPDATE driver_shifts SET notif_sent_at=NOW(), updated_at=NOW() WHERE shift_id=$1`,
          [row.shift_id]
        );
        console.log('[Scheduler] TICK2 upcoming push → shift', row.shift_id);
      }

      // ----------------------------------------------------------
      //  TICK 3 — 11 órás munkaidő figyelmeztetés
      //  Feltétel: ACTIVE, 11 óra eltelt, nyitott nap, még nem ment
      // ----------------------------------------------------------
      const warn11 = await pool.query(`
        SELECT shift_id, driver_email
        FROM driver_shifts
        WHERE status = 'ACTIVE'
          AND day_started_at + INTERVAL '11 hours' <= NOW()
          AND day_closed_at IS NULL
          AND warn11h_sent_at IS NULL
      `);
      for (const row of warn11.rows) {
        await sendPushToEmail([row.driver_email], {
          title: '⚠️ VallorSoft — 11 óra aktív',
          body:  '11 órája vezetsz. EU limit: 15 óra. Gondolj a pihenőre!',
          icon:  '/icon192.png',
          badge: '/icon192.png',
          tag:   'vs-warn11h-' + row.shift_id,
          url:   '/sofer',
          data:  { type: 'warn_11h', shift_id: row.shift_id }
        });
        await pool.query(
          `UPDATE driver_shifts SET warn11h_sent_at=NOW(), updated_at=NOW() WHERE shift_id=$1`,
          [row.shift_id]
        );
        console.log('[Scheduler] TICK3 11h warn push → shift', row.shift_id);
      }

      // ----------------------------------------------------------
      //  TICK 4 — 15 óra: automatikus naplezárás
      //  Feltétel: ACTIVE vagy PAUSED, 15 óra eltelt, még nincs day_closed_at
      //  Hatás: INACTIVE, is_overtime=TRUE, locked_until ha 6. nap
      // ----------------------------------------------------------
      const auto15 = await pool.query(`
        SELECT shift_id, driver_email, driver_id,
               shift_index_in_week, week_start_date, paused_total_minutes
        FROM driver_shifts
        WHERE status IN ('ACTIVE','PAUSED')
          AND day_started_at + INTERVAL '15 hours' <= NOW()
          AND day_closed_at IS NULL
      `);
      for (const row of auto15.rows) {
        const now = new Date();
        const lockedUntil = row.shift_index_in_week >= 6
          ? new Date(now.getTime() + 24 * 3600 * 1000)
          : null;

        // Heti összmunkaidő frissítése
        const prevH = await pool.query(
          `SELECT COALESCE(SUM(
             EXTRACT(EPOCH FROM (day_closed_at - day_started_at)) / 3600.0
             - (paused_total_minutes / 60.0)
           ), 0)::numeric(6,2) AS total
           FROM driver_shifts
           WHERE driver_id = $1 AND week_start_date = $2
             AND day_closed_at IS NOT NULL AND shift_id != $3`,
          [row.driver_id, row.week_start_date, row.shift_id]
        );
        // 15h - paused_total_minutes = tényleges aktív
        const thisShiftH = 15 - (row.paused_total_minutes || 0) / 60;
        const weeklyTotal = parseFloat(prevH.rows[0].total || 0) + thisShiftH;

        await pool.query(
          `UPDATE driver_shifts
           SET status='INACTIVE', day_closed_at=NOW(),
               is_overtime=TRUE,
               overtime_reason='Automatikus zárás — EU 561/2006 15h napi limit elérve',
               locked_until=$1, weekly_hours_total=$2, updated_at=NOW()
           WHERE shift_id=$3`,
          [lockedUntil, weeklyTotal.toFixed(2), row.shift_id]
        );

        await sendPushToEmail([row.driver_email], {
          title: '⛔ VallorSoft — Nap automatikusan lezárva',
          body:  '15 óra EU limit elérve. Válassz pihenő típust a sofer oldalon!',
          icon:  '/icon192.png',
          badge: '/icon192.png',
          tag:   'vs-auto15h-' + row.shift_id,
          url:   '/sofer',
          data:  { type: 'auto_close_15h', shift_id: row.shift_id }
        });

        if (lockedUntil) {
          await sendPushToEmail([row.driver_email], {
            title: '🔒 VallorSoft — Heti zárolás aktív',
            body:  `6. munkanap teljesítve. Legközelebb: ${lockedUntil.toLocaleString('hu-HU')} után indíthatsz.`,
            icon:  '/icon192.png',
            badge: '/icon192.png',
            tag:   'vs-weekly-lock-' + row.shift_id,
            url:   '/sofer',
            data:  { type: 'weekly_lock' }
          });
        }
        console.log('[Scheduler] TICK4 auto-close 15h → shift', row.shift_id, '| locked_until:', lockedUntil);
      }

    } catch (err) {
      // Scheduler hiba NEM állítja le a szervert — csak naplózza
      console.error('[Shift Scheduler] tick hiba:', err.message);
    }
  }

  // Azonnali első futás (szerver újraindítás utáni „elmaradt" tickek kezelése),
  // majd 60 másodpercenként
  schedulerTick();
  const interval = setInterval(schedulerTick, 60 * 1000);
  console.log('[Shift Scheduler] Elindítva — 1 perces ciklus');
  return interval; // visszaadja az intervallt (tesztekhez / graceful shutdown)
}

// ============================================================
//  E-mail intake ütemező — beérkező megrendelések (2 perces ciklus).
//  Csak akkor csinál bármit, ha az INTAKE_IMAP_* be van állítva (.env).
// ============================================================
function startIntakeScheduler() {
  let intake;
  try { intake = require('./email-intake'); } catch (_) { return null; }
  if (!intake.configured()) {
    console.log('[Intake] Postafiók nincs beállítva — az e-mail intake kihagyva.');
    return null;
  }
  async function tick() {
    try {
      const r = await intake.pollOnce(pool);
      if (r && r.processed) console.log('[Intake] feldolgozott levél:', r.processed);
    } catch (err) { console.error('[Intake] tick hiba:', err.message); }
  }
  tick();
  const interval = setInterval(tick, 2 * 60 * 1000);
  console.log('[Intake] Elindítva — 2 perces ciklus');
  return interval;
}

module.exports = { startShiftScheduler, startIntakeScheduler };
