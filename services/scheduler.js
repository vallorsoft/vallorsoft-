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

// ============================================================
//  e-Factura státusz automatikus lekérdező (3 óránként).
//  Minden kiadott számla esetén, amelyhez még nincs ANAF SPV státusz,
//  lekérdezi a számlázó-providertől (FGO/SmartBill/Oblio/iFactura/Facturis)
//  és elmenti az invoices.efactura_status + efactura_last_raw oszlopokba.
//  Retry-logika: ha a státusz üres maradt, 6 óra múlva újra próbálkozik;
//  60 nap után hagyja abba (az ANAF általában 3 napon belül válaszol).
// ============================================================
function startEFacturaStatusScheduler() {
  let billing;
  try { billing = require('./billing'); } catch (_) { return null; }
  let svc;
  try { svc = require('./invoicing'); } catch (_) { return null; }
  const { decrypt } = require('../lib/crypto');

  let running = false;

  async function tick() {
    if (running) { console.warn('[eFactura] az előző kör még fut — ez a ciklus kimarad.'); return; }
    running = true;
    try { await tickBody(); } finally { running = false; }
  }

  async function tickBody() {
    // Azok a kiadott számlák, amelyeket még soha nem ellenőriztünk VAGY
    // 6+ órája ellenőriztük de státusz nélkül maradtak — legfeljebb 60 naposak.
    let invoices;
    try {
      ({ rows: invoices } = await pool.query(
        `SELECT i.id, i.company_id, i.provider, i.serie, i.numar, i.efactura_status, i.efactura_checked_at
         FROM invoices i
         WHERE i.status = 'issued'
           AND i.created_at > now() - interval '60 days'
           AND (
             i.efactura_checked_at IS NULL
             OR (i.efactura_status IS NULL AND i.efactura_checked_at < now() - interval '6 hours')
           )
         ORDER BY i.company_id, i.created_at DESC
         LIMIT 100`));
    } catch (err) {
      // A migráció (efactura-status-poll.sql) még nem futott le — csendben kihagyjuk.
      if (/column.*efactura_checked_at/i.test(err.message)) return;
      console.error('[eFactura] számlák lekérése hiba:', err.message);
      return;
    }
    if (!invoices.length) return;

    // Konfig-cache: cégenként csak egyszer kérdezzük le a billing beállítást.
    const cfgCache = new Map();
    async function getCfg(cid) {
      if (cfgCache.has(cid)) return cfgCache.get(cid);
      try {
        const cfg = await svc.getInvoiceConfig(pool, cid);
        cfgCache.set(cid, cfg || null);
        return cfg || null;
      } catch (_) { cfgCache.set(cid, null); return null; }
    }

    for (const inv of invoices) {
      // Kis szünet API rate-limit elkerülésére
      await new Promise(r => setTimeout(r, 200));

      let cfg;
      try { cfg = await getCfg(inv.company_id); } catch (_) { continue; }
      if (!cfg) continue;

      let adapterCreds = cfg.creds;
      // Ha a számla providere eltér az aktív konfigtól (pl. korábban FGO, most SmartBill),
      // a saját provider-konfigját próbáljuk meg betölteni.
      if (inv.provider && inv.provider !== cfg.provider) {
        try {
          const pr = await pool.query(
            `SELECT credentials FROM billing_integrations WHERE company_id=$1 AND provider=$2`,
            [inv.company_id, inv.provider]);
          if (pr.rows.length && pr.rows[0].credentials && pr.rows[0].credentials.enc) {
            adapterCreds = JSON.parse(decrypt(pr.rows[0].credentials.enc));
          } else {
            // Fallback: legacy konfig
            const leg = await pool.query(
              `SELECT credentials_enc FROM company_integrations
               WHERE company_id=$1 AND category='invoicing' AND enabled=true LIMIT 1`,
              [inv.company_id]);
            if (leg.rows.length) adapterCreds = JSON.parse(decrypt(leg.rows[0].credentials_enc));
          }
        } catch (_) { /* maradjon az aktív konfig */ }
      }

      let st = null;
      try {
        const adapter = billing.getAdapter(inv.provider || cfg.provider, adapterCreds);
        if (!adapter || typeof adapter.getInvoice !== 'function') continue;
        st = await adapter.getInvoice(inv.serie || '', inv.numar || '');
      } catch (err) {
        console.error('[eFactura] számlaazonosító #' + inv.id + ' lekérés hiba:', err.message);
        // efactura_checked_at-t frissítjük, hogy ne pörögjünk rá azonnal
        try {
          await pool.query(
            'UPDATE invoices SET efactura_checked_at=$1 WHERE id=$2 AND company_id=$3',
            [new Date(), inv.id, inv.company_id]);
        } catch (_) {}
        continue;
      }

      if (!st || !st.ok) {
        // Hiba: frissítjük a checked_at-t (6 óra múlva újra próbál)
        try {
          await pool.query(
            'UPDATE invoices SET efactura_checked_at=$1 WHERE id=$2 AND company_id=$3',
            [new Date(), inv.id, inv.company_id]);
        } catch (_) {}
        continue;
      }

      const ef = svc.extractEFacturaStatus(st.raw);
      const now = new Date();
      try {
        await pool.query(
          `UPDATE invoices
           SET efactura_status      = COALESCE($1, efactura_status),
               efactura_last_raw    = COALESCE($2::jsonb, efactura_last_raw),
               efactura_checked_at  = $3
           WHERE id=$4 AND company_id=$5`,
          [ef || null, st.raw ? JSON.stringify(st.raw) : null, now, inv.id, inv.company_id]);
        if (ef) console.log('[eFactura] #' + inv.id + ' (cég ' + inv.company_id + '): ' + ef);
      } catch (err) {
        console.error('[eFactura] mentés hiba #' + inv.id + ':', err.message);
      }
    }
  }

  // Indulás után 5 perccel (a szerver teljesen beáll), majd 3 óránként.
  setTimeout(tick, 5 * 60 * 1000);
  const interval = setInterval(tick, 3 * 60 * 60 * 1000);
  console.log('[eFactura] Státusz-lekérdező ütemező elindítva — 3 órás ciklus.');
  return interval;
}

// ============================================================
//  Trial lejárat ütemező — 24 órás ciklus, indulás után 60s.
//  Azoknak a cégeknek küld e-mailt, amelyek trial-ja ÉPPEN MA jár le,
//  és még nem kaptak erről értesítést (trial_email_sent = false).
// ============================================================
function startTrialExpiryScheduler() {
  const { sendClientEmail } = require('./email');
  const appUrl = process.env.APP_URL || 'https://app.vallorsoft.com';

  async function tick() {
    try {
      const res = await pool.query(
        `SELECT id, nev, email_contact
         FROM companies
         WHERE subscription_status='trial'
           AND paid_until::date = CURRENT_DATE
           AND (trial_email_sent IS NULL OR trial_email_sent = false)`
      );
      for (const ceg of res.rows) {
        try {
          await sendClientEmail({
            to: ceg.email_contact,
            subject: 'Perioada de probă a expirat / Próbaidőszak lejárt — VallorSoft',
            html: `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
  <div style="background:linear-gradient(135deg,#6366f1,#3b82f6);padding:28px 32px;border-radius:12px 12px 0 0;">
    <h1 style="margin:0;color:#fff;font-size:22px;">vallor<span style="color:#c7d2fe;">Soft</span></h1>
  </div>
  <div style="background:#fff;padding:28px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">
    <p style="margin:0 0 12px;font-size:16px;font-weight:600;">Perioada de probă a expirat / Próbaidőszak lejárt</p>
    <p style="margin:0 0 12px;color:#475569;">
      <strong>RO:</strong> Perioada de probă de 14 zile pentru <em>${ceg.nev}</em> a expirat astăzi.
      Pentru a continua să utilizați VallorSoft, vă rugăm să alegeți un pachet de abonament.
    </p>
    <p style="margin:0 0 20px;color:#475569;">
      <strong>HU:</strong> A(z) <em>${ceg.nev}</em> cég 14 napos próbaidőszaka ma lejárt.
      A VallorSoft folyamatos használatához kérjük, válasszon előfizetési csomagot.
    </p>
    <a href="${appUrl}/subscription" style="display:inline-block;background:linear-gradient(180deg,#3b82f6,#2563eb);color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">
      📦 Alege pachet / Csomag választása
    </a>
    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">
      Întrebări? / Kérdés? <a href="mailto:vallorsoft@gmail.com" style="color:#6366f1;">vallorsoft@gmail.com</a>
    </p>
  </div>
</div>`,
          });
          await pool.query('UPDATE companies SET trial_email_sent=true WHERE id=$1', [ceg.id]);
          console.log('[Trial] cég #' + ceg.id + ' — trial lejárat email elküldve (' + ceg.nev + ')');
        } catch (mailErr) {
          console.error('[Trial] e-mail hiba cég #' + ceg.id + ':', mailErr.message);
        }
      }
    } catch (err) {
      console.error('[Trial] ütemező hiba:', err.message);
    }
  }

  // Indulás után 60s-vel az első futás, majd 24 óránként
  setTimeout(tick, 60 * 1000);
  const interval = setInterval(tick, 24 * 60 * 60 * 1000);
  console.log('[Trial] Trial lejárat-értesítő ütemező elindítva — 24 órás ciklus.');
  return interval;
}

module.exports = { startIntakeScheduler, startExpiryScheduler, startGpsMileageScheduler, startMonthlyReportScheduler, startEFacturaStatusScheduler, startTrialExpiryScheduler };
