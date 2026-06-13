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
        + (first.days_left < 0 ? ' EXPIRAT / LEJÁRT' : ' — expiră în ' + first.days_left + ' zile / ' + first.days_left + ' nap múlva');
      const body = items.length === 1
        ? firstTxt
        : firstTxt + ' (+' + (items.length - 1) + ' altele / további' + (lejart ? ', din care ' + lejart + ' expirate / ebből ' + lejart + ' lejárt' : '') + ')';
      try {
        await push.sendPushToRole(cid, ['Admin', 'Manager'], {
          title: '⏰ Documente care expiră / Lejáró dokumentumok',
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

// ============================================================
//  GPS km-óra napi snapshot (gps_mileage_log) — 24 óránként.
//  A CargoTrack 'mileage' értékét naplózza járművenként, hogy a
//  GPS-km összevethető legyen a sofőr által beírt menetlevél-km-rel.
// ============================================================
function startGpsMileageScheduler() {
  let ctSvc;
  try { ctSvc = require('./cargotrack'); } catch (_) { return null; }

  async function tick() {
    let rows;
    try {
      ({ rows } = await pool.query(
        `SELECT ci.company_id, ci.credentials_enc
         FROM company_integrations ci
         WHERE ci.provider='cargotrack' AND ci.enabled=true AND ci.credentials_enc IS NOT NULL`));
    } catch (_) { return; }

    for (const row of rows) {
      let apiKey;
      try { apiKey = decrypt(row.credentials_enc); } catch (_) { continue; }
      let mapRows;
      try {
        ({ rows: mapRows } = await pool.query(
          `SELECT rendszam, object_id FROM vehicle_gps_map
           WHERE company_id=$1 AND provider='cargotrack'`, [row.company_id]));
      } catch (_) { continue; }
      for (const m of mapRows) {
        try {
          const st = await ctSvc.getLatestStatus(apiKey, m.object_id);
          if (st && st.mileage != null && isFinite(parseFloat(st.mileage))) {
            await pool.query(
              `INSERT INTO gps_mileage_log (company_id, rendszam, mileage, logged_on)
               VALUES ($1,$2,$3,CURRENT_DATE)
               ON CONFLICT (company_id, rendszam, logged_on) DO UPDATE SET mileage = EXCLUDED.mileage`,
              [row.company_id, m.rendszam, parseFloat(st.mileage)]);
          }
        } catch (_) { /* jármű-hiba ne állítsa le a kört */ }
      }
    }
  }

  setTimeout(tick, 60 * 1000);
  const interval = setInterval(tick, 24 * 60 * 60 * 1000);
  console.log('[GpsKm] Napi km-óra snapshot ütemező elindítva.');
  return interval;
}

// ============================================================
//  Havi e-mail összefoglaló az adminoknak — naponta ellenőriz,
//  hónap elsején (vagy első indításkor a hónapban) küldi az ELŐZŐ
//  hónap riportját. Küldés-napló: monthly_report_log (nincs dupla).
//  Cégenként kikapcsolható: company_features 'monthly-report'=false.
// ============================================================
function startMonthlyReportScheduler() {
  let email;
  try { email = require('./email'); } catch (_) { return null; }

  function prevMonth() {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
    const from = d.toISOString().slice(0, 10);
    const month = from.slice(0, 7);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().slice(0, 10);
    return { month, from, to: end };
  }
  function fmt(x) { const n = parseFloat(x); return isFinite(n) ? n.toLocaleString('hu-HU', { maximumFractionDigits: 0 }) : '0'; }

  async function tick() {
    if (new Date().getDate() > 5) return;   // csak a hónap első napjaiban próbálkozik
    const { month, from, to } = prevMonth();
    let companies;
    try {
      ({ rows: companies } = await pool.query(
        `SELECT c.id, c.nev FROM companies c
         WHERE NOT EXISTS (SELECT 1 FROM monthly_report_log l WHERE l.company_id = c.id AND l.month = $1)
           AND NOT EXISTS (SELECT 1 FROM company_features f WHERE f.company_id = c.id
                             AND f.feature_key = 'monthly-report' AND f.enabled = false)`, [month]));
    } catch (_) { return; } // tábla migráció előtt

    for (const c of companies) {
      try {
        const adminsR = await pool.query(
          `SELECT email, nume FROM users WHERE company_id=$1 AND pozicio='Admin'`, [c.id]);
        if (!adminsR.rows.length) continue;

        const kpiR = await pool.query(
          `SELECT COUNT(*) FILTER (WHERE status='Finalizat' AND finalized_at >= $2 AND finalized_at < $3)::int AS lezart,
                  COALESCE(SUM(pret) FILTER (WHERE status='Finalizat' AND finalized_at >= $2 AND finalized_at < $3),0)::numeric AS bevetel,
                  COALESCE(SUM(GREATEST(pret-paid_amount,0)) FILTER (WHERE status='Finalizat' AND payment_status <> 'paid' AND pret > 0),0)::numeric AS kintlevo
           FROM orders WHERE company_id=$1`, [c.id, from, to]);
        const fuvR = await pool.query(
          `SELECT COALESCE(SUM(f.total_km),0)::numeric AS km,
                  COALESCE(SUM((SELECT COALESCE(SUM((a->>'suma')::numeric),0) FROM jsonb_array_elements(f.alimentari) a)),0) AS uzemanyag,
                  COALESCE(SUM((SELECT COALESCE(SUM((x->>'pret')::numeric),0) FROM jsonb_array_elements(f.achizitii) x)),0) AS vasarlas
           FROM fuvarlevelek f
           JOIN users u ON LOWER(u.email)=LOWER(f.email_sofer) AND u.company_id=$1
           WHERE f.data_completare >= $2::date AND f.data_completare < $3::date`, [c.id, from, to]);
        const k = kpiR.rows[0], fv = fuvR.rows[0];

        const row = (l, v) => '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555;">' + l
          + '</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:700;">' + v + '</td></tr>';
        const html =
          '<p><b>' + c.nev + '</b> — raport lunar / havi összefoglaló: <b>' + month + '</b></p>'
          + '<table style="width:100%;border-collapse:collapse;font-size:14px;">'
          + row('Curse finalizate / Lezárt fuvarok', fmt(k.lezart) + ' buc / db')
          + row('Venit (finalizate) / Bevétel (lezárt)', fmt(k.bevetel) + ' EUR')
          + row('Km parcurși (foi de parcurs) / Megtett km (menetlevelek)', fmt(fv.km) + ' km')
          + row('Cost combustibil / Üzemanyag-költség', fmt(fv.uzemanyag) + ' RON')
          + row('Alte cheltuieli șofer / Egyéb sofőr-költés', fmt(fv.vasarlas) + ' RON')
          + row('Restanțe curente / Aktuális kintlévőség', fmt(k.kintlevo) + ' EUR')
          + '</table>'
          + '<p style="font-size:12px;color:#888;">Rapoarte detaliate: în meniul 📊 Statistici al VallorSoft. / Részletes riportok: a VallorSoft 📊 Statisztika menüjében.</p>';

        let sentAny = false;
        for (const a of adminsR.rows) {
          const r = await email.sendClientEmail({
            to: a.email, subject: '📊 VallorSoft raport lunar / havi összefoglaló — ' + month + ' (' + c.nev + ')', html,
          });
          if (r && r.ok) sentAny = true;
        }
        if (sentAny) {
          await pool.query(
            `INSERT INTO monthly_report_log (company_id, month) VALUES ($1,$2)
             ON CONFLICT DO NOTHING`, [c.id, month]);
          console.log('[HaviRiport] cég #' + c.id + ' — ' + month + ' elküldve.');
        }
      } catch (err) {
        console.error('[HaviRiport] cég #' + c.id + ' hiba:', err.message);
      }
    }
  }

  setTimeout(tick, 90 * 1000);
  const interval = setInterval(tick, 24 * 60 * 60 * 1000);
  console.log('[HaviRiport] Havi összefoglaló ütemező elindítva.');
  return interval;
}

module.exports = { startIntakeScheduler, startExpiryScheduler, startGpsMileageScheduler, startMonthlyReportScheduler };
