// ============================================================
//  VallorSoft — Ütemezők
//  (A sofőr-műszak EU 561/2006 háttér-ütemezőjét eltávolítottuk;
//   csak az e-mail intake ütemező maradt.)
// ============================================================
const pool = require('../db');

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

module.exports = { startIntakeScheduler };
