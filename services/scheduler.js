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

  // Átfedés-őr: egy kör (PDF + OCR + AI modell-lánc) 2 percnél tovább is
  // tarthat — a setInterval ettől még elsülne, és a párhuzamos körök
  // ugyanazokat a leveleket dolgoznák fel kétszer (Gemini-kvóta égetés).
  let running = false;

  async function tick() {
    if (running) { console.warn('[Intake] az előző kör még fut — ez a ciklus kimarad.'); return; }
    running = true;
    try { await tickBody(); } finally { running = false; }
  }

  async function tickBody() {
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

// ============================================================
//  Lejárat-figyelő ütemező (document_expiries) — 12 óránként fut.
//  A riasztási ablakba érő (expiry_date <= ma + alert_days) tételekről
//  push-értesítést küld a cég Admin/Manager felhasználóinak.
//  Ismétlés: hetente újra szól, amíg a tétel le nem jár / nem frissítik
//  (last_alert_at dátum-őr — duplikált riasztás nélkül).
// ============================================================
function startExpiryScheduler() {
  let push;
  try { push = require('./push'); } catch (_) { return null; }

  async function tick() {
    let rows;
    try {
      ({ rows } = await pool.query(
        `SELECT id, company_id, entity_type, entity_label, doc_type, expiry_date,
                (expiry_date - CURRENT_DATE)::int AS days_left
         FROM document_expiries
         WHERE expiry_date <= CURRENT_DATE + alert_days * INTERVAL '1 day'
           AND (last_alert_at IS NULL OR last_alert_at <= CURRENT_DATE - 7)
         ORDER BY company_id, expiry_date
         LIMIT 500`));
    } catch (err) {
      // A tábla még nem létezik (migráció előtt) -> csendben kihagyjuk.
      return;
    }
    if (!rows.length) return;

    // Cégenként csoportosítva EGY összefoglaló push (ne spammeljen tételenként)
    const byCompany = new Map();
    for (const r of rows) {
      if (!byCompany.has(r.company_id)) byCompany.set(r.company_id, []);
      byCompany.get(r.company_id).push(r);
    }
    for (const [cid, items] of byCompany) {
      const lejart = items.filter((i) => i.days_left < 0).length;
      const first = items[0];
      const firstTxt = (first.entity_label ? first.entity_label + ' — ' : '') + first.doc_type
        + (first.days_left < 0 ? ' LEJÁRT' : ' ' + first.days_left + ' nap múlva lejár');
      const body = items.length === 1
        ? firstTxt
        : firstTxt + ' (+' + (items.length - 1) + ' további' + (lejart ? ', ebből ' + lejart + ' lejárt' : '') + ')';
      try {
        await push.sendPushToRole(cid, ['Admin', 'Manager'], {
          title: '⏰ Lejáró dokumentumok',
          body,
          url: '/admin',
        });
        const ids = items.map((i) => i.id);
        await pool.query(
          'UPDATE document_expiries SET last_alert_at = CURRENT_DATE WHERE id = ANY($1)', [ids]);
        console.log('[Expiry] cég #' + cid + ' — riasztás: ' + items.length + ' tétel');
      } catch (err) {
        console.error('[Expiry] cég #' + cid + ' riasztás hiba:', err.message);
      }
    }
  }

  setTimeout(tick, 30 * 1000);                       // indulás után fél perccel első kör
  const interval = setInterval(tick, 12 * 60 * 60 * 1000);
  console.log('[Expiry] Lejárat-figyelő elindítva — 12 órás ciklus.');
  return interval;
}

module.exports = { startIntakeScheduler, startExpiryScheduler };
