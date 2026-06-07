// ============================================================
//  VallorSoft — Ütemezők
//  (A sofőr-műszak EU 561/2006 háttér-ütemezőjét eltávolítottuk;
//   csak az e-mail intake ütemező maradt.)
// ============================================================
const pool = require('../db');
const { decrypt } = require('../lib/crypto');

// ============================================================
//  E-mail intake ütemező — beérkező megrendelések (2 perces ciklus).
//  A postafiók-beállítás CÉGENKÉNT a company_integrations táblából jön
//  (provider='email_intake'); minden konfigurált céget végigpörget.
//  Egy cég hibája nem állítja le a többit.
// ============================================================
function startIntakeScheduler() {
  let intake;
  try { intake = require('./email-intake'); } catch (_) { return null; }

  async function tick() {
    let rows;
    try {
      ({ rows } = await pool.query(
        `SELECT company_id, credentials_enc, meta FROM company_integrations
         WHERE provider='email_intake' AND enabled=true AND credentials_enc IS NOT NULL`));
    } catch (err) { console.error('[Intake] cégek lekérése hiba:', err.message); return; }

    for (const row of rows) {
      let creds;
      try { creds = JSON.parse(decrypt(row.credentials_enc)); }
      catch (e) { console.error('[Intake] cég #' + row.company_id + ' credentials dekódolás hiba:', e.message); continue; }
      const since = row.meta && row.meta.since ? row.meta.since : null;
      try {
        const r = await intake.pollOnce(pool, creds, row.company_id, { since });
        if (r && r.processed) console.log('[Intake] cég #' + row.company_id + ' — feldolgozott levél:', r.processed);
        // Sikeres kör után az utolsó lekérdezés idejének frissítése (last_check oszlop).
        await pool.query(
          `UPDATE company_integrations SET last_check=now() WHERE company_id=$1 AND provider='email_intake'`,
          [row.company_id]);
      } catch (err) {
        console.error('[Intake] cég #' + row.company_id + ' lekérdezés hiba:', err.message);
        // egy cég hibája NE állítsa le a többit
      }
    }
  }

  tick();
  const interval = setInterval(tick, 2 * 60 * 1000);
  console.log('[Intake] Ütemező elindítva — 2 perces ciklus (cégenkénti postafiók a beállításokból).');
  return interval;
}

module.exports = { startIntakeScheduler };
