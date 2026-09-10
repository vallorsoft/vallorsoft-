// ============================================================
//  VallorSoft — Ütemezők
//  (A sofőr-műszak EU 561/2006 háttér-ütemezőjét eltávolítottuk;
//   csak az e-mail intake ütemező maradt.)
// ============================================================
const pool = require('../db');
const { decrypt } = require('../lib/crypto');

// ============================================================
//  Közös értesítő-e-mail segéd (lejárat + szerviz emlékeztetők).
//  A levél a KÖZÖS VallorSoft feladó-címről megy (sendClientEmail →
//  BREVO_SENDER, pont mint a regisztrációs/rendszer-levelek), az
//  Admin/Manager felhasználóknak — mindig ROMÁNUL. Best-effort:
//  ha a Brevo nincs konfigurálva, csendben kihagyjuk (a push +
//  Notifications-központ így is megkapja a riasztást).
// ============================================================
function _escH(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Riasztó e-mail TÖRZSE (a VallorSoft fejlécet/keretet a sendClientEmail rakja rá).
// A `bodyHtml` tetszőleges belső markup (táblázat VAGY blokkok) — a hívó adja.
function _alertEmailBody(headline, intro, bodyHtml, footerLink) {
  return `<p style="margin:0 0 10px;font-size:16px;font-weight:700;color:#2a2018;">${headline}</p>
<p style="margin:0 0 14px;font-size:14px;color:#5a5048;">${intro}</p>
${bodyHtml}
<p style="margin:18px 0 0;font-size:12px;color:#b09a82;">${footerLink || ''}</p>`;
}

// Riasztó e-mail kiküldése a cég Admin/Manager felhasználóinak a KÖZÖS
// VallorSoft címről (sendClientEmail). Visszatérés: hány címzettnek ment ki.
async function _emailAlertToAdmins(cid, subject, html, mailType) {
  try {
    const { sendClientEmail } = require('./email');
    const u = await pool.query(
      `SELECT DISTINCT email FROM users
        WHERE company_id=$1 AND pozicio IN ('Admin','Manager')
          AND email IS NOT NULL AND email <> '' AND COALESCE(blocked,false)=false`, [cid]);
    let sent = 0;
    for (const row of u.rows) {
      try {
        const r = await sendClientEmail({ to: row.email, subject, html, companyId: cid, mailType: mailType || 'alert' });
        if (r && r.ok) sent++;
      } catch (_) { /* egy címzett hibája ne állítsa le a többit */ }
    }
    return sent;
  } catch (_) { return 0; }
}

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
        // Cégen belüli értesítés (Notifications-központ) — a push mellett, best-effort.
        try {
          const { notify } = require('../handlers/notifications');
          await notify(pool, {
            company_id: cid, type: 'expiry',
            title: 'Documente care expiră',
            body, link_tab: 'expiries',
          });
        } catch (_) { /* best-effort */ }
        // E-mail a cég Admin/Manager felhasználóinak (cég saját feladó-fiókról, RO, best-effort).
        try {
          let cname = '';
          try { const cr = await pool.query('SELECT nev FROM companies WHERE id=$1', [cid]); cname = (cr.rows[0] || {}).nev || ''; } catch (_) {}
          const tableHtml = items.slice(0, 50).map(function (i) {
            const lej = i.days_left < 0;
            const st = lej ? 'EXPIRAT' : ('expiră în ' + i.days_left + ' zile');
            const col = lej ? '#dc2626' : '#d97706';
            return '<tr>'
              + '<td style="padding:6px 10px;border-bottom:1px solid #ece3d8;">' + _escH(i.entity_label || '—') + '</td>'
              + '<td style="padding:6px 10px;border-bottom:1px solid #ece3d8;">' + _escH(i.doc_type || '') + '</td>'
              + '<td style="padding:6px 10px;border-bottom:1px solid #ece3d8;text-align:right;font-weight:700;color:' + col + ';">' + st + '</td>'
              + '</tr>';
          }).join('');
          const html = _alertEmailBody(
            '⏰ Documente care expiră',
            'Următoarele documente ale companiei <b>' + _escH(cname) + '</b> expiră în curând sau au expirat. Verificați secțiunea <b>Expirări</b> din VallorSoft.',
            '<table style="width:100%;border-collapse:collapse;font-size:13px;">' + tableHtml + '</table>',
            'Deschideți VallorSoft → Expirări pentru detalii.'
          );
          await _emailAlertToAdmins(cid, '⏰ VallorSoft — Documente care expiră (' + items.length + ')', html, 'expiry_alert');
        } catch (_) { /* best-effort: az e-mail hibája ne állítsa le a riasztást */ }
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
//  GPS km-óra snapshot (gps_mileage_log) — alapból ÓRÁNKÉNT.
//  A CargoTrack 'mileage' értékét naplózza járművenként (a napi sort
//  ON CONFLICT-tal a legfrissebbre frissíti), hogy a GPS-km összevethető
//  legyen a menetlevél-km-mel ÉS a szerviz `next_due_km`-mel.
//  Minden cég km-frissítése UTÁN AZONNAL lefuttatja a szerviz-esedékesség
//  ellenőrzést (`_dispatchServiceAlerts`) → így a km-alapú riasztás
//  (push + e-mail) ~a leolvasási cikluson belül megy, nem 12 óra múlva.
//  Gyakoriság: GPS_MILEAGE_INTERVAL_MIN env (perc, alap 60; min 5).
// ============================================================
function startGpsMileageScheduler() {
  let ctSvc;
  try { ctSvc = require('./cargotrack'); } catch (_) { return null; }
  let running = false;

  async function tick() {
    if (running) return;            // átfedés-őr (egy kör tovább tarthat a GPS-hívások miatt)
    running = true;
    try { await tickBody(); } finally { running = false; }
  }

  async function tickBody() {
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
      let updated = 0;
      for (const m of mapRows) {
        try {
          const st = await ctSvc.getLatestStatus(apiKey, m.object_id);
          if (st && st.mileage != null && isFinite(parseFloat(st.mileage))) {
            await pool.query(
              `INSERT INTO gps_mileage_log (company_id, rendszam, mileage, logged_on)
               VALUES ($1,$2,$3,CURRENT_DATE)
               ON CONFLICT (company_id, rendszam, logged_on) DO UPDATE SET mileage = EXCLUDED.mileage`,
              [row.company_id, m.rendszam, parseFloat(st.mileage)]);
            updated++;
          }
        } catch (_) { /* jármű-hiba ne állítsa le a kört */ }
      }
      // Friss km után AZONNAL szerviz-esedékesség ellenőrzés (best-effort).
      if (updated) {
        try { await _dispatchServiceAlerts(row.company_id); } catch (_) { /* best-effort */ }
      }
    }
  }

  const minMin = 5;
  let mins = parseInt(process.env.GPS_MILEAGE_INTERVAL_MIN, 10);
  if (!Number.isFinite(mins) || mins < minMin) mins = 60;
  setTimeout(tick, 60 * 1000);
  const interval = setInterval(tick, mins * 60 * 1000);
  console.log('[GpsKm] km-óra snapshot + szerviz-ellenőrzés ütemező elindítva — ' + mins + ' perces ciklus.');
  return interval;
}

// ============================================================
//  Hónap-végi GPS km + üzemanyag-szint snapshot
//  (gps_month_end_snapshots) — a hónap UTOLSÓ napján ~23:59-kor
//  minden CargoTrack-cég minden párosított járművére lekéri az
//  aktuális GPS mileage + fuel_level-t, és upsertoli a snapshot-
//  táblába (UNIQUE company_id/rendszam/year/month → ON CONFLICT
//  UPDATE). A scheduler minden órában ellenőrzi a Europe/
//  Bucharest zóna szerinti dátumot; ha ma van a hónap utolsó
//  napja ÉS az óra ≥ 23 (23:00 → 23:59), snapshotot vesz. Az
//  egy órán belüli 3 tick (20 percenként) miatt a legutolsó
//  értékre pontosít (kb. 23:40 vagy 23:59 körüli). Egy adott
//  cég/jármű/hó cellára a legfrissebb overwrite marad meg.
//
//  A `handlers/orders.js` `getLastVehicleReadings` ebből tölti
//  elő a következő menetlevél kezdő km-ét és üzemanyag-szintjét,
//  HA a snapshot újabb, mint az utolsó menetlevél érkezés-dátuma
//  (különben a menetlevél záró értéke nyer — a hónap-határon
//  átívelő menetlevél így nem csorbul).
// ============================================================
function _bucharestNowParts() {
  // Europe/Bucharest naptári dátum + óra (DST-biztos, Intl-alapú).
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const m = {}; parts.forEach(p => { m[p.type] = p.value; });
  return {
    year: parseInt(m.year, 10),
    month: parseInt(m.month, 10),
    day: parseInt(m.day, 10),
    hour: parseInt(m.hour, 10),
    minute: parseInt(m.minute, 10),
  };
}
// A JS Date(year, month, 0) egy hónappal korábbi hónap utolsó napját adja
// (month 1-indexelten), tehát az adott hó utolsó napjához +1-et kell adni.
function _lastDayOfMonth(year, month /* 1..12 */) {
  return new Date(year, month, 0).getDate();
}

function startMonthEndSnapshotScheduler() {
  let ctSvc;
  try { ctSvc = require('./cargotrack'); } catch (_) { return null; }
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try { await tickBody(); } finally { running = false; }
  }

  async function tickBody() {
    const now = _bucharestNowParts();
    const lastDay = _lastDayOfMonth(now.year, now.month);
    // Csak a hó utolsó napján, 23:00 után indulunk (23:59-hez legközelebbi
    // GPS-olvasás rögzüljön). A 20 perces ciklus alatt 3 esély is van rá.
    if (now.day !== lastDay || now.hour < 23) return;

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
          if (!st) continue;
          const mi = (st.mileage != null && isFinite(parseFloat(st.mileage))) ? parseFloat(st.mileage) : null;
          const fl = (st.fuel_level != null && isFinite(parseFloat(st.fuel_level))) ? parseFloat(st.fuel_level) : null;
          if (mi == null && fl == null) continue; // semmi értelmes érték
          await pool.query(
            `INSERT INTO gps_month_end_snapshots
               (company_id, rendszam, year, month, mileage, fuel_level, snapped_at)
             VALUES ($1,$2,$3,$4,$5,$6,NOW())
             ON CONFLICT (company_id, rendszam, year, month)
             DO UPDATE SET mileage = COALESCE(EXCLUDED.mileage, gps_month_end_snapshots.mileage),
                           fuel_level = COALESCE(EXCLUDED.fuel_level, gps_month_end_snapshots.fuel_level),
                           snapped_at = NOW()`,
            [row.company_id, m.rendszam, now.year, now.month, mi, fl]);
        } catch (_) { /* jármű-hiba ne állítsa le a kört */ }
      }
    }
  }

  // 20 perces ciklus → a 23:00-23:59 ablakban ~3 esély jut a snapshotra
  // (a legutolsó overwrite marad — kb. 23:40 vagy 23:59 körüli olvasás).
  setTimeout(tick, 60 * 1000);
  const interval = setInterval(tick, 20 * 60 * 1000);
  console.log('[GpsMonthEnd] hó-végi GPS snapshot ütemező elindítva — 20 perces ciklus.');
  return interval;
}

// ────────────────────────────────────────────────────────────
//  Közös szerviz-riasztás-kiküldő EGY cégre. A `computeServiceDueAlerts`
//  (km-óra vs. next_due_km + dátum vs. next_due_date) esedékes tételeire
//  push + Notifications + e-mail (KÖZÖS VallorSoft cím) megy az Admin/
//  Manager felhasználóknak, majd `last_alert_at`-tal hetente-egyszerre
//  korlátoz. Ezt hívja a periodikus seprés ÉS — azonnal — a GPS-km-frissítés.
//  Visszatérés: a riasztott tételek száma.
// ────────────────────────────────────────────────────────────
function _fmtKm(n) { const x = parseInt(n, 10); return isFinite(x) ? x.toLocaleString('ro-RO') : '0'; }

async function _dispatchServiceAlerts(cid) {
  let fleet;
  try { fleet = require('../handlers/fleetCompliance'); } catch (_) { return 0; }
  const compute = fleet && fleet.computeServiceDueAlerts;
  if (typeof compute !== 'function') return 0;
  let push; try { push = require('./push'); } catch (_) { push = null; }

  let items;
  try { items = await compute(cid, { onlyStale: true }); } catch (_) { return 0; }
  if (!items || !items.length) return 0;

  // Összefoglaló push-szöveg (ne tételenként spammeljen)
  const first = items[0];
  const firstTxt = '🔧 ' + (first.rendszam || '') + ' — '
    + (first.km_left != null
        ? (first.km_left < 0
            ? 'depășit cu ' + _fmtKm(-first.km_left) + ' km / túllépve ' + _fmtKm(-first.km_left) + ' km'
            : 'mai sunt ' + _fmtKm(first.km_left) + ' km / még ' + _fmtKm(first.km_left) + ' km')
        : (first.days_left < 0 ? 'scadent / lejárt' : 'în ' + first.days_left + ' zile / ' + first.days_left + ' nap múlva'));
  const body = items.length === 1 ? firstTxt
    : firstTxt + ' (+' + (items.length - 1) + ' altele / további)';

  try {
    if (push) await push.sendPushToRole(cid, ['Admin', 'Manager'], {
      title: '🔧 Revizii scadente / Esedékes szervizek',
      body, url: '/admin',
    });
    // Notifications-központ (best-effort)
    try {
      const { notify } = require('../handlers/notifications');
      await notify(pool, { company_id: cid, type: 'service', title: 'Revizii scadente', body, link_tab: 'service-log' });
    } catch (_) { /* best-effort */ }

    // E-mail a cég Admin/Manager felhasználóinak (KÖZÖS VallorSoft cím, RO, best-effort).
    // Járművenként RÉSZLETES blokk: autó-adat (rendszám, márka/típus, aktuális km) +
    // szerviz-adat (esedékesség km/dátum, állapot, szerviz típusa, utolsó szerviz).
    try {
      let cname = '';
      try { const cr = await pool.query('SELECT nev FROM companies WHERE id=$1', [cid]); cname = (cr.rows[0] || {}).nev || ''; } catch (_) {}
      const CAT_RO = { olajcsere: 'schimb ulei', gumi: 'anvelope', javitas: 'reparație', karbantartas: 'întreținere', egyeb: 'altele' };
      const dRO = function (d) { try { return new Date(d).toLocaleDateString('ro-RO'); } catch (_) { return ''; } };
      const blocks = items.slice(0, 50).map(function (i) {
        let scad, col;
        if (i.km_left != null) {
          if (i.km_left < 0) { scad = 'depășit cu ' + _fmtKm(-i.km_left) + ' km'; col = '#dc2626'; }
          else { scad = 'în ' + _fmtKm(i.km_left) + ' km'; col = '#d97706'; }
        } else if (i.days_left < 0) { scad = 'scadent (dată depășită)'; col = '#dc2626'; }
        else { scad = 'în ' + i.days_left + ' zile'; col = '#d97706'; }

        const vehName = _escH(i.rendszam || '—')
          + ((i.marca || i.tip) ? ' <span style="font-weight:400;color:#8a7d6e;">— ' + _escH([i.marca, i.tip].filter(Boolean).join(' ')) + '</span>' : '');
        const cat = i.category ? (CAT_RO[i.category] || i.category) : null;
        const line = function (label, val) {
          return '<tr><td style="padding:3px 12px 3px 0;color:#8a7d6e;font-size:12px;white-space:nowrap;vertical-align:top;">' + label + '</td>'
            + '<td style="padding:3px 0;font-size:13px;font-weight:600;color:#2a2018;">' + val + '</td></tr>';
        };
        let detail = '';
        if (i.current_km != null) detail += line('Km actual', _fmtKm(i.current_km) + ' km');
        if (i.next_due_km != null) detail += line('Revizie scadentă la', _fmtKm(i.next_due_km) + ' km');
        if (i.next_due_date) detail += line('Scadentă la data', dRO(i.next_due_date));
        detail += line('Stare', '<span style="color:' + col + ';font-weight:700;">' + scad + '</span>');
        if (cat) detail += line('Tip revizie', _escH(cat));
        if (i.service_date) detail += line('Ultima revizie', dRO(i.service_date));
        if (i.cost_ron != null) detail += line('Cost ultima revizie', _fmtKm(Math.round(i.cost_ron)) + ' RON');
        if (i.description) detail += line('Observații', _escH(String(i.description).slice(0, 300)));

        return '<div style="border:1px solid #ece3d8;border-radius:10px;padding:12px 14px;margin-bottom:10px;background:#fffdfa;">'
          + '<div style="font-size:15px;font-weight:800;color:#2a2018;margin-bottom:6px;">🚛 ' + vehName + '</div>'
          + '<table style="border-collapse:collapse;">' + detail + '</table>'
          + '</div>';
      }).join('');
      const html = _alertEmailBody(
        '🔧 Revizii scadente',
        'Următoarele vehicule ale companiei <b>' + _escH(cname) + '</b> au revizia scadentă (în funcție de kilometrajul GPS live sau de dată). Verificați <b>Jurnal service</b> din VallorSoft.',
        blocks,
        'Deschideți VallorSoft → Jurnal service pentru detalii.'
      );
      await _emailAlertToAdmins(cid, '🔧 VallorSoft — Revizii scadente (' + items.length + ')', html, 'service_alert');
    } catch (_) { /* best-effort */ }

    const ids = items.map((i) => i.id);
    await pool.query('UPDATE vehicle_service_log SET last_alert_at = CURRENT_DATE WHERE id = ANY($1)', [ids]);
    console.log('[Service] cég #' + cid + ' — szerviz-riasztás: ' + items.length + ' jármű');
    return items.length;
  } catch (err) {
    console.error('[Service] cég #' + cid + ' riasztás hiba:', err.message);
    return 0;
  }
}

// ============================================================
//  Szerviz-esedékesség SEPRÉS ütemező — 12 óránként (biztonsági háló).
//  A km-alapú riasztás VALÓS IDEJŰ része a GPS-km-frissítés után fut
//  (startGpsMileageScheduler → _dispatchServiceAlerts); ez a periodikus
//  kör fogja meg a DÁTUM-alapú esedékességet és a GPS nélküli cégeket is.
//  Ismétlés: hetente újra (last_alert_at dátum-őr).
// ============================================================
function startServiceDueScheduler() {
  async function tick() {
    let companies;
    try {
      ({ rows: companies } = await pool.query(
        `SELECT DISTINCT company_id FROM vehicle_service_log
          WHERE next_due_km IS NOT NULL OR next_due_date IS NOT NULL`));
    } catch (_) { return; } // tábla migráció előtt
    for (const c of companies) {
      try { await _dispatchServiceAlerts(c.company_id); } catch (_) { /* cég-hiba ne állítsa le a kört */ }
    }
  }

  setTimeout(tick, 45 * 1000);                       // indulás után 45 mp-cel első kör
  const interval = setInterval(tick, 12 * 60 * 60 * 1000);
  console.log('[Service] Szerviz-esedékesség seprés-ütemező elindítva — 12 órás ciklus.');
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
           WHERE COALESCE(f.erkezes_dt, f.indulas_dt, f.data_completare) >= $2::date AND COALESCE(f.erkezes_dt, f.indulas_dt, f.data_completare) < $3::date`, [c.id, from, to]);
        const k = kpiR.rows[0], fv = fuvR.rows[0];

        const row = (l, v) => '<tr><td style="padding:6px 10px;border-bottom:1px solid #ece3d8;color:#8a7d6e;">' + l
          + '</td><td style="padding:6px 10px;border-bottom:1px solid #ece3d8;text-align:right;font-weight:700;">' + v + '</td></tr>';
        const html =
          '<p><b>' + c.nev + '</b> — raport lunar: <b>' + month + '</b></p>'
          + '<table style="width:100%;border-collapse:collapse;font-size:14px;">'
          + row('Curse finalizate', fmt(k.lezart) + ' buc')
          + row('Venit (finalizate)', fmt(k.bevetel) + ' EUR')
          + row('Km parcurși (foi de parcurs)', fmt(fv.km) + ' km')
          + row('Cost combustibil', fmt(fv.uzemanyag) + ' RON')
          + row('Alte cheltuieli șofer', fmt(fv.vasarlas) + ' RON')
          + row('Restanțe curente', fmt(k.kintlevo) + ' EUR')
          + '</table>'
          + '<p style="font-size:12px;color:#b09a82;">Rapoarte detaliate: în meniul 📊 Statistici al VallorSoft.</p>';

        let sentAny = false;
        for (const a of adminsR.rows) {
          const r = await email.sendClientEmail({
            to: a.email, subject: '📊 VallorSoft raport lunar — ' + month + ' (' + c.nev + ')', html,
            companyId: c.id, mailType: 'monthly_report',
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
  const { sendClientEmail, getEmailTemplate } = require('./email');
  const appUrl = require('../lib/appUrl').appBaseUrl('https://app.vallorsoft.com');
  const escV = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const replVars = (t, v) => t.replace(/\{\{(\w+)\}\}/g, (_, k) => k in v ? escV(v[k]) : '');

  async function tick() {
    try {
      const res = await pool.query(
        `SELECT id, nev, email_contact, paid_until
         FROM companies
         WHERE subscription_status='trial'
           AND paid_until::date = CURRENT_DATE
           AND (trial_email_sent IS NULL OR trial_email_sent = false)`
      );
      // Sablon egyszer kérjük le (minden cégre ugyanaz)
      const tpl = await getEmailTemplate('email_sys_trial_expiry');
      for (const ceg of res.rows) {
        try {
          let emailSubject, emailHtml;
          if (tpl && tpl.subject && (tpl.body_ro || tpl.body_hu)) {
            const paidStr = ceg.paid_until ? new Date(ceg.paid_until).toLocaleDateString('ro-RO') : '';
            const vars = { ceg_nev: ceg.nev, paid_until: paidStr, subscription_url: appUrl + '/subscription' };
            const bodyRo = tpl.body_ro ? replVars(tpl.body_ro, vars) : '';
            const bodyHu = tpl.body_hu ? replVars(tpl.body_hu, vars) : '';
            emailSubject = replVars(tpl.subject, vars);
            emailHtml = bodyRo + (bodyHu && bodyRo ? '<hr style="border:none;border-top:1px solid #ece3d8;margin:16px 0;">' : '') + bodyHu;
          } else {
            emailSubject = 'Perioada de probă a expirat — VallorSoft';
            emailHtml = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#2a2018;">
  <div style="background:linear-gradient(135deg,#fb8c3a,#f6517b);padding:28px 32px;border-radius:12px 12px 0 0;">
    <h1 style="margin:0;color:#fff;font-size:22px;">vallor<span style="color:#fdba74;">Soft</span></h1>
  </div>
  <div style="background:#faf6f0;padding:28px 32px;border:1px solid #ece3d8;border-top:none;border-radius:0 0 12px 12px;">
    <p style="margin:0 0 12px;font-size:16px;font-weight:600;">Perioada de probă a expirat</p>
    <p style="margin:0 0 20px;color:#8a7d6e;">
      Perioada de probă de 14 zile pentru <em>${ceg.nev}</em> a expirat astăzi.
      Pentru a continua să utilizați VallorSoft, vă rugăm să alegeți un pachet de abonament.
    </p>
    <a href="${appUrl}/subscription" style="display:inline-block;background:linear-gradient(180deg,#fb8c3a,#f6711e);color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">
      📦 Alege pachet
    </a>
    <p style="margin:24px 0 0;font-size:12px;color:#b09a82;">
      Întrebări? <a href="mailto:vallorsoft@gmail.com" style="color:#f6711e;">vallorsoft@gmail.com</a>
    </p>
  </div>
</div>`;
          }
          await sendClientEmail({ to: ceg.email_contact, subject: emailSubject, html: emailHtml, companyId: ceg.id, mailType: 'trial_expiry' });
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

// ============================================================
//  Trial emlékeztető ütemező — 3 és 1 nappal lejárat előtt
//  Emailt küld a csomag-választó linkekkel + éves opcióval.
// ============================================================
function startTrialReminderScheduler() {
  const { sendClientEmail } = require('./email');
  const { makeTrialToken: makeToken } = require('../lib/trialToken');
  const appUrl = require('../lib/appUrl').appBaseUrl('https://app.vallorsoft.com');

  function buildPlanLink(cid, planId, billing) {
    const tok = makeToken(cid, planId, billing);
    return `${appUrl}/api/trial/select-plan?cid=${cid}&plan=${planId}&billing=${billing}&tok=${tok}`;
  }

  function buildReminderHtml(company, plans, daysLeft) {
    const escH = (s) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const planColors = ['#16a34a','#f6711e','#f6517b','#271f18'];

    const planCards = plans.map(function(p, i) {
      const isDark     = i === 3;
      const monthlyEur = parseFloat(p.price_net) || 0;
      const annualEur  = monthlyEur * 11;
      const color      = planColors[i] || '#f6711e';
      const linkM      = isDark ? null : buildPlanLink(company.id, p.id, 'monthly');
      const linkA      = isDark ? null : buildPlanLink(company.id, p.id, 'annual');

      const priceBlock = monthlyEur > 0
        ? `<div style="font-size:22px;font-weight:800;color:${color};">€${Math.round(monthlyEur)}<span style="font-size:13px;font-weight:500;color:#8a7d6e;">/lună</span></div>
           <div style="font-size:11px;color:#8a7d6e;">Anual: €${annualEur} (11 luni)</div>`
        : `<div style="font-size:16px;font-weight:700;color:#8a7d6e;">Preț personalizat</div>`;

      const ctaBlock = isDark
        ? `<a href="mailto:vallorsoft@gmail.com" style="display:block;text-align:center;margin-top:10px;padding:8px;background:#271f18;color:#fff;border-radius:7px;font-size:12px;font-weight:600;text-decoration:none;">Contactați-ne</a>`
        : `<a href="${linkM}" style="display:block;text-align:center;margin-top:8px;padding:7px;background:${color};color:#fff;border-radius:7px;font-size:12px;font-weight:600;text-decoration:none;">Lunar</a>
           <a href="${linkA}" style="display:block;text-align:center;margin-top:5px;padding:7px;background:transparent;color:${color};border:1.5px solid ${color};border-radius:7px;font-size:12px;font-weight:600;text-decoration:none;">Anual ★ −1 lună</a>`;

      return `<td style="width:25%;padding:8px;vertical-align:top;">
        <div style="border:1.5px solid ${i===2?color:'#ece3d8'};border-radius:10px;padding:14px;background:${i===2?'#fbf7f1':'#fff'};">
          <div style="font-size:13px;font-weight:700;color:#2a2018;margin-bottom:6px;">${escH(p.name)}</div>
          ${priceBlock}
          ${ctaBlock}
        </div>
      </td>`;
    }).join('');

    return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#2a2018;">
  <div style="background:linear-gradient(135deg,#fb8c3a,#f6517b);padding:24px 28px;border-radius:12px 12px 0 0;">
    <h1 style="margin:0;color:#fff;font-size:20px;">vallor<span style="color:#fdba74;">Soft</span></h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,.85);font-size:14px;">⏳ ${daysLeft === 1 ? 'Ultima zi de probă' : `Mai ai ${daysLeft} zile din perioada de probă`}</p>
  </div>
  <div style="background:#faf6f0;padding:24px 28px;border:1px solid #ece3d8;border-top:none;border-radius:0 0 12px 12px;">
    <p style="margin:0 0 20px;font-size:15px;">
      Perioada de probă a companiei <em>${escH(company.nev)}</em> expiră în <strong>${daysLeft} ${daysLeft===1?'zi':'zile'}</strong>.
      Alege un pachet pentru a continua fără întrerupere.
    </p>

    <!-- Csomag kártyák -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr>${planCards}</tr>
    </table>

    <div style="background:#fffbeb;border:1px solid #fbbf24;border-radius:8px;padding:12px 16px;font-size:12px;color:#92400e;margin-bottom:16px;">
      ★ <strong>Abonament anual</strong>: plătești 11 luni, folosești 12 (1 lună gratuită).
    </div>

    <p style="margin:0;font-size:12px;color:#b09a82;">
      Abonamentul începe după perioada de probă de 14 zile.<br>
      Întrebări? <a href="mailto:vallorsoft@gmail.com" style="color:#f6711e;">vallorsoft@gmail.com</a>
    </p>
  </div>
</div>`;
  }

  async function tick() {
    try {
      // 3 napos és 1 napos emlékeztetők
      for (const daysLeft of [3, 1]) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + daysLeft);
        const targetStr = targetDate.toISOString().slice(0, 10);

        const res = await pool.query(
          `SELECT c.id, c.nev, c.email_contact
           FROM companies c
           WHERE c.subscription_status = 'trial'
             AND c.paid_until::date = $1::date`,
          [targetStr]
        );
        if (!res.rows.length) continue;

        const plansR = await pool.query(
          'SELECT id, name, price_net FROM subscription_plans ORDER BY sort_order, price_net'
        );
        const plans = plansR.rows;

        for (const company of res.rows) {
          if (!company.email_contact) continue;
          try {
            const html = buildReminderHtml(company, plans, daysLeft);
            await sendClientEmail({
              to:      company.email_contact,
              subject: `⏳ VallorSoft — ${daysLeft === 1 ? 'Ultima zi de probă' : `${daysLeft} zile rămase din perioada de probă`} — Alege pachet`,
              html,
              companyId: company.id, mailType: 'trial_reminder',
            });
            console.log(`[TrialReminder] ${daysLeft}d — cég #${company.id} (${company.nev}) emlékeztető elküldve`);
          } catch (mailErr) {
            console.error(`[TrialReminder] email hiba cég #${company.id}:`, mailErr.message);
          }
        }
      }
    } catch (err) {
      console.error('[TrialReminder] ütemező hiba:', err.message);
    }
  }

  // Indulás után 90s-vel az első futás, majd 24 óránként
  setTimeout(tick, 90 * 1000);
  const interval = setInterval(tick, 24 * 60 * 60 * 1000);
  console.log('[TrialReminder] 3d/1d emlékeztető ütemező elindítva — 24 órás ciklus.');
  return interval;
}

// ============================================================
//  Lemondás (dezabonare) ütemező — naponta:
//   (1) az UTOLSÓ napon (paid_until = ma) "még meggondolhatja magát"
//       emlékeztető e-mail a lemondott, de még hozzáférő cégeknek;
//   (2) a lejárt (paid_until < ma) lemondott cégek státusza 'cancelled'
//       (a hozzáférést a login paid_until-kapuja amúgy is már tiltja).
// ============================================================
function startCancelReminderScheduler() {
  const { sendSubscriptionCancelEmail } = require('./email');
  const { makeReactivateToken } = require('../lib/trialToken');
  const appUrl = require('../lib/appUrl').appBaseUrl();

  async function tick() {
    try {
      // (1) Utolsó-napi emlékeztető
      const due = await pool.query(
        `SELECT id, nev, email_contact, paid_until, subscription_cancel_at
           FROM companies
          WHERE subscription_cancel_at IS NOT NULL
            AND paid_until::date = CURRENT_DATE
            AND (cancel_lastday_notified IS NULL OR cancel_lastday_notified = false)`
      );
      for (const c of due.rows) {
        try {
          let reactivateUrl = null;
          if (appUrl && c.subscription_cancel_at) {
            const sec = Math.floor(new Date(c.subscription_cancel_at).getTime() / 1000);
            reactivateUrl = `${appUrl}/abonament/reactivare?cid=${c.id}&tok=${makeReactivateToken(c.id, sec)}`;
          }
          if (c.email_contact) {
            await sendSubscriptionCancelEmail({
              to: c.email_contact, companyName: c.nev, paidUntil: c.paid_until,
              daysLeft: 0, reactivateUrl: reactivateUrl, lastDay: true, companyId: c.id,
            });
          }
          await pool.query('UPDATE companies SET cancel_lastday_notified=true WHERE id=$1', [c.id]);
          console.log('[Cancel] utolsó-napi emlékeztető — cég #' + c.id + ' (' + c.nev + ')');
        } catch (e) {
          console.error('[Cancel] emlékeztető hiba cég #' + c.id + ':', e.message);
        }
      }
      // (2) Lejárt lemondott cégek véglegesítése
      await pool.query(
        `UPDATE companies SET subscription_status='cancelled'
          WHERE subscription_cancel_at IS NOT NULL
            AND paid_until::date < CURRENT_DATE
            AND subscription_status <> 'cancelled'`
      );
    } catch (err) {
      console.error('[Cancel] ütemező hiba:', err.message);
    }
  }

  setTimeout(tick, 120 * 1000);
  const interval = setInterval(tick, 24 * 60 * 60 * 1000);
  console.log('[Cancel] Lemondás-emlékeztető ütemező elindítva — 24 órás ciklus.');
  return interval;
}

// ============================================================
//  Statisztika-riport ütemező — PR #10 (Statisztika 2.0)
//  Naponta egyszer ellenőrzi a `stats_report_schedules` `enabled=true`
//  sorait; ha az adott schedule (daily/weekly/monthly) alapján esedékes
//  (last_run_at NULL vagy régebbi mint az intervallum), generál egy
//  minimalista HTML-riportot és e-mailt küld a `recipients`-nek.
//  Nem PDF — HTML-body. A jövőben (külön PR) puppeteer-rel PDF-fé rendereljük.
// ============================================================
function startStatsReportScheduler() {
  let email;
  try { email = require('./email'); } catch (_) { return null; }

  function fmt(x) { const n = parseFloat(x); return isFinite(n) ? n.toLocaleString('hu-HU', { maximumFractionDigits: 0 }) : '0'; }

  async function isDue(row) {
    if (!row.enabled) return false;
    const last = row.last_run_at ? new Date(row.last_run_at) : null;
    if (!last) return true;
    const now = new Date();
    const diffH = (now - last) / 3600000;
    if (row.schedule === 'daily')   return diffH >= 22;
    if (row.schedule === 'weekly')  return diffH >= 24 * 6.5;
    if (row.schedule === 'monthly') return diffH >= 24 * 28;
    return false;
  }

  function _range() {
    const to = new Date();
    const from = new Date(); from.setDate(1); from.setMonth(from.getMonth() - 1);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }

  async function _renderReportHtml(cid, cegNev, { from, to }) {
    // Egyszerű snapshot — KPI-k a getStatsOverview logikájából, saját query-vel
    const kpiR = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status='Finalizat' AND finalized_at >= $2 AND finalized_at < $3)::int AS lezart,
              COALESCE(SUM(pret) FILTER (WHERE status='Finalizat' AND finalized_at >= $2 AND finalized_at < $3),0)::numeric AS bevetel,
              COALESCE(SUM(GREATEST(pret-paid_amount,0)) FILTER (WHERE status='Finalizat' AND payment_status <> 'paid' AND pret > 0),0)::numeric AS kintlevo,
              COALESCE(SUM(km) FILTER (WHERE status='Finalizat' AND finalized_at >= $2 AND finalized_at < $3),0)::numeric AS km
       FROM orders WHERE company_id=$1`, [cid, from, to]);
    const k = kpiR.rows[0] || {};
    const row = (l, v) => '<tr><td style="padding:8px 14px;border-bottom:1px solid #ece3d8;color:#8a7d6e;">' + l
      + '</td><td style="padding:8px 14px;border-bottom:1px solid #ece3d8;text-align:right;font-weight:700;">' + v + '</td></tr>';
    return ''
      + '<p style="margin:0 0 12px;font-size:15px;"><b>' + _escH(cegNev) + '</b> — perioada <b>' + _escH(from) + '</b> ÷ <b>' + _escH(to) + '</b></p>'
      + '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:14px;">'
      +   row('Curse finalizate', fmt(k.lezart) + ' buc')
      +   row('Venit total', fmt(k.bevetel) + ' EUR')
      +   row('Km parcurși', fmt(k.km) + ' km')
      +   row('Restanțe curente', fmt(k.kintlevo) + ' EUR')
      + '</table>'
      + '<p style="font-size:12px;color:#b09a82;">Raport detaliat: 📊 Statistici 2.0 în consola VallorSoft.</p>';
  }

  async function tick() {
    let schedules;
    try {
      ({ rows: schedules } = await pool.query(
        `SELECT s.*, c.nev AS ceg_nev
         FROM stats_report_schedules s
         JOIN companies c ON c.id = s.company_id
         WHERE s.enabled = TRUE`));
    } catch (_) { return; }   // tábla migráció előtt
    for (const s of schedules) {
      try {
        if (!(await isDue(s))) continue;
        const range = _range();
        const html = await _renderReportHtml(s.company_id, s.ceg_nev, range);
        const recipients = Array.isArray(s.recipients) ? s.recipients : [];
        let sentAny = false;
        for (const r of recipients) {
          const rr = await email.sendClientEmail({
            to: r, subject: '📊 VallorSoft — ' + _escH(s.name) + ' (' + s.ceg_nev + ')',
            html, companyId: s.company_id, mailType: 'stats_report',
          });
          if (rr && rr.ok) sentAny = true;
        }
        if (sentAny) {
          await pool.query(`UPDATE stats_report_schedules SET last_run_at=NOW() WHERE id=$1`, [s.id]);
          console.log('[StatsRiport] #' + s.id + ' cég #' + s.company_id + ' → ' + recipients.length + ' címzett');
        }
      } catch (err) {
        console.error('[StatsRiport] #' + s.id + ' hiba:', err.message);
      }
    }
  }

  setTimeout(tick, 120 * 1000);   // 2 perc múlva először
  const interval = setInterval(tick, 60 * 60 * 1000);   // óránként (a `isDue` szűr)
  console.log('[StatsRiport] Statisztika-riport ütemező elindítva.');
  return interval;
}

// ═════════════════════════════════════════════════════════════════════
//  KIFIZETÉS-ESEDÉKESSÉG SCHEDULER
//  ─────────────────────────────────────────────────────────────────────
//  A csoportos kifizetésen (PR #423) belül a fizetési sorok JÖVŐBELI
//  paid_at-tal is felvehetők (scheduled). Amikor a mai nap = paid_at,
//  e-mail megy a cég Admin/Manager-jeinek: „Ma esedékes N lej kifizetése
//  Y sofőrnek". A `driver_payments.due_email_sent` flag dedupolja.
//
//  Ütemezés: 30 perc, tick-elés reggel 07:00 után csak (Europe/Bucharest);
//  best-effort — hiányzó oszlop = csendes fallback.
// ═════════════════════════════════════════════════════════════════════
function startPaymentDueScheduler() {
  const tick = async () => {
    try {
      const pool = require('../db');
      // Ma esedékes, még nem küldött scheduled fizetés (paid_at = ma ÉS
      // FUTURE volt eredetileg — created_at::date < paid_at::date)
      let rows;
      try {
        const r = await pool.query(`
          SELECT p.id, p.company_id, p.email_sofer, p.paid_at, p.amount, p.currency,
                 p.method, p.note, p.group_id, p.created_at
            FROM driver_payments p
           WHERE p.paid_at::date = CURRENT_DATE
             AND COALESCE(p.due_email_sent, FALSE) = FALSE
             AND p.created_at::date < p.paid_at::date
           ORDER BY p.company_id, p.id
           LIMIT 500`);
        rows = r.rows;
      } catch (_e) { return; /* migráció nélkül csendes NO-OP */ }
      if (!rows.length) return;

      const { sendClientEmail } = require('./email');
      // Cégenként csoportosítunk (egy admin-lista lekérés / cég)
      const byCid = new Map();
      for (const p of rows) {
        if (!byCid.has(p.company_id)) byCid.set(p.company_id, []);
        byCid.get(p.company_id).push(p);
      }

      for (const [cid, pays] of byCid.entries()) {
        // Cég admin/manager-jeinek e-mailje
        const admins = await pool.query(
          `SELECT DISTINCT email FROM users
            WHERE company_id=$1 AND pozicio IN ('Admin','Manager')
              AND COALESCE(blocked,FALSE)=FALSE AND email IS NOT NULL`, [cid]);
        if (!admins.rows.length) continue;

        // Sofőr-név lookup
        const emails = [...new Set(pays.map(p => String(p.email_sofer || '').toLowerCase()))];
        const drvR = await pool.query(
          `SELECT LOWER(email) AS email, nume FROM users
            WHERE company_id=$1 AND LOWER(email)=ANY($2::text[])`, [cid, emails]);
        const nameByEmail = {};
        drvR.rows.forEach(r => { nameByEmail[r.email] = r.nume; });

        // E-mail HTML — kompakt lista
        const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
        const fmtAmt = (n, c) => (Number(n).toFixed(2)) + ' ' + esc(c || 'RON');
        const dateStr = new Date().toISOString().slice(0, 10);
        const rowsHtml = pays.map(p => {
          const drvNume = nameByEmail[String(p.email_sofer || '').toLowerCase()] || p.email_sofer;
          return '<tr>'
            + '<td style="padding:8px 10px;border-bottom:1px solid #eee;">' + esc(drvNume) + '</td>'
            + '<td style="padding:8px 10px;border-bottom:1px solid #eee;"><b>' + fmtAmt(p.amount, p.currency) + '</b></td>'
            + '<td style="padding:8px 10px;border-bottom:1px solid #eee;">' + esc(p.method || 'cash') + '</td>'
            + '<td style="padding:8px 10px;border-bottom:1px solid #eee;color:#666;">' + esc(p.note || '—') + '</td>'
            + '<td style="padding:8px 10px;border-bottom:1px solid #eee;color:#666;">#' + (p.group_id || '—') + '</td>'
            + '</tr>';
        }).join('');
        const html =
          '<div style="font-family:Inter,system-ui,sans-serif;color:#1e1812;">'
          + '<h2 style="margin:0 0 12px;font-size:18px;">💰 Plata programata astazi</h2>'
          + '<p style="margin:0 0 12px;color:#555;">Astazi, <b>' + dateStr + '</b>, sunt scadente ' + pays.length + ' plati programate anterior:</p>'
          + '<table style="width:100%;border-collapse:collapse;font-size:13px;">'
          + '<thead><tr style="background:#f3f4f6;"><th style="padding:8px 10px;text-align:left;">Sofer</th>'
          + '<th style="padding:8px 10px;text-align:left;">Suma</th>'
          + '<th style="padding:8px 10px;text-align:left;">Metoda</th>'
          + '<th style="padding:8px 10px;text-align:left;">Nota</th>'
          + '<th style="padding:8px 10px;text-align:left;">Grup</th></tr></thead>'
          + '<tbody>' + rowsHtml + '</tbody></table>'
          + '<p style="margin:14px 0 0;color:#555;font-size:12px;">Deschide <b>Sofer — Decont</b> pentru a tipari confirmarea de plata grupata (buton 🖨️ pe randul platii).</p>'
          + '</div>';

        // Küldés minden adminnak (best-effort — a küldő maga is elnyeli az egyedi hibát)
        for (const a of admins.rows) {
          try {
            await sendClientEmail({
              to: a.email,
              subject: '💰 VallorSoft — ' + pays.length + ' plata scadenta astazi',
              html, companyId: cid, mailType: 'payment_due'
            });
          } catch (_e) {}
        }
        // Dedup — jelöljük „e-mail elküldve" flag-gel
        try {
          const ids = pays.map(p => p.id);
          await pool.query(
            `UPDATE driver_payments SET due_email_sent = TRUE WHERE id = ANY($1::int[])`, [ids]);
        } catch (_e) {}
        console.log('[PayDue] Cég #' + cid + ': ' + pays.length + ' esedékes fizetés → ' + admins.rows.length + ' admin.');
      }
    } catch (err) {
      console.error('[PayDue] tick hiba:', err.message);
    }
  };
  setTimeout(tick, 60 * 1000);           // 1 perc múlva először (indulás után)
  const interval = setInterval(tick, 30 * 60 * 1000);   // 30 percenként
  console.log('[PayDue] Kifizetés-esedékesség ütemező elindítva.');
  return interval;
}

// ================================================================
//  PDF munkatér — 24h retention takarítás.
//  A `pdf_workspace_docs` sorokat az admin/manager „Aláírás és
//  pecsét" oldal `pdfWorkspaceUpload` handlerén át hozza létre.
//  A tábla per-user + 24h retention → itt hat óránként töröljük a
//  lejárt sorokat (best-effort; ha a tábla még nincs migrálva,
//  csendben skippel).
// ================================================================
function startPdfWorkspaceCleanup() {
  const tick = async () => {
    try {
      const r = await pool.query(
        `DELETE FROM pdf_workspace_docs
          WHERE created_at < NOW() - INTERVAL '24 hours'`);
      if (r.rowCount > 0) {
        console.log(`[PdfWorkspace] Törölve ${r.rowCount} lejárt munkatér-dokumentum.`);
      }
    } catch (err) {
      // Migráció-hiány → csendes skip, ne szemetelje a logot.
      if (err && err.code === '42P01') return;
      console.error('[PdfWorkspace] takarítás hiba:', err.message);
    }
  };
  setTimeout(tick, 90 * 1000);           // 1.5 perc múlva először
  const interval = setInterval(tick, 6 * 60 * 60 * 1000); // 6 óránként
  console.log('[PdfWorkspace] 24h retention takarító elindítva.');
  return interval;
}

// ================================================================
//  REGGELI ÖSSZEFOGLALÓ (napi digest) — cégenkénti kapcsoló + időpont.
//  Percenként ellenőrzi, hogy egy cég `digest_time`-ja Europe/Bucharest
//  szerint MOST van-e (±1 perc ablak), és ha ma még nem küldött ki
//  digest-et (`digest_last_sent_at`), összeállítja a napi képet és
//  e-mailben megküldi a cég Admin/Manager felhasználóinak + a
//  `digest_recipients` tömb címeinek. Duplikáció-őr: sikeres küldés
//  után `digest_last_sent_at=NOW()`; a következő nap előtt új küldés
//  nincs (naponta max 1× / cég).
// ================================================================
function startMorningDigestScheduler() {
  let email;
  try { email = require('./email'); } catch (_) { return null; }

  function _fmt(n) { const x = parseInt(n, 10); return isFinite(x) ? x : 0; }
  function _hu_hm() {
    // "Europe/Bucharest" időzóna aktuális HH:MM (24 órás formátumban).
    try {
      const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false });
      return fmt.format(new Date()); // "07:00"
    } catch (_) {
      const d = new Date();
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
  }
  function _hu_today() {
    try {
      const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }); // sv-SE = YYYY-MM-DD
      return fmt.format(new Date());
    } catch (_) { return new Date().toISOString().slice(0, 10); }
  }

  async function _buildDigest(cid) {
    // Aktív fuvarok darabszáma cégre szűrve.
    const stats = {};
    try {
      const r = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('Alocat','In Curs','Extern'))::int AS active_count,
           COUNT(*) FILTER (WHERE status = 'Disponibil')::int AS available_count,
           COUNT(*) FILTER (WHERE status IN ('Parkolt','Raktarban'))::int AS handover_count,
           COUNT(*) FILTER (WHERE status='Finalizat'
             AND COALESCE(to_jsonb(orders) ->> 'payment_status_ext','pending') <> 'paid')::int AS unpaid_count
         FROM orders WHERE company_id=$1`, [cid]);
      Object.assign(stats, r.rows[0] || {});
    } catch (_) {}

    // Mai felrakások + lerakások (data_incarcare / data_descarcare = ma).
    const today = _hu_today();
    let todayPick = [], todayDrop = [];
    try {
      const p = await pool.query(
        `SELECT id, fuvar_no, client, loc_incarcare, rendszam_camion, nume_sofer
           FROM orders
          WHERE company_id=$1 AND data_incarcare=$2::date AND status NOT IN ('Anulat')
          ORDER BY loc_incarcare LIMIT 30`, [cid, today]);
      todayPick = p.rows;
    } catch (_) {}
    try {
      const d = await pool.query(
        `SELECT id, fuvar_no, client, loc_descarcare, rendszam_camion, nume_sofer
           FROM orders
          WHERE company_id=$1 AND data_descarcare=$2::date AND status NOT IN ('Anulat')
          ORDER BY loc_descarcare LIMIT 30`, [cid, today]);
      todayDrop = d.rows;
    } catch (_) {}

    // Lejáró dokumentumok — 30 nap.
    let expiries = [];
    try {
      const e = await pool.query(
        `SELECT tip, target_type, target_ref, expires_on
           FROM document_expiries
          WHERE company_id=$1
            AND expires_on IS NOT NULL
            AND expires_on <= (CURRENT_DATE + INTERVAL '30 days')
          ORDER BY expires_on LIMIT 40`, [cid]);
      expiries = e.rows;
    } catch (_) {}

    // Szerviz-esedékesség (2 hét).
    let services = [];
    try {
      const s = await pool.query(
        `SELECT vehicle_id, next_due_date, next_due_km
           FROM vehicle_service_log
          WHERE company_id=$1 AND closed_at IS NULL
            AND ((next_due_date IS NOT NULL AND next_due_date <= (CURRENT_DATE + INTERVAL '14 days'))
              OR next_due_km IS NOT NULL)
          ORDER BY next_due_date NULLS LAST LIMIT 40`, [cid]);
      services = s.rows;
    } catch (_) {}

    return { stats, todayPick, todayDrop, expiries, services };
  }

  function _renderHtml(companyName, d) {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));
    const s = d.stats || {};
    var html = '<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;">';
    html += '<h2 style="margin:0 0 6px;color:#2563eb;">☀️ Sumar zilnic — ' + esc(companyName) + '</h2>';
    html += '<div style="color:#64748b;font-size:12.5px;margin-bottom:14px;">' + esc(_hu_today()) + '</div>';
    // KPI rács
    html += '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;"><tr>';
    html += '<td style="padding:10px;border:1px solid #cbd5e1;border-radius:8px;text-align:center;">'+
      '<div style="font-size:24px;font-weight:800;color:#2563eb;">'+_fmt(s.active_count)+'</div>'+
      '<div style="font-size:11px;color:#64748b;">Curse active</div></td>';
    html += '<td style="padding:10px;border:1px solid #cbd5e1;border-radius:8px;text-align:center;">'+
      '<div style="font-size:24px;font-weight:800;color:#f59e0b;">'+_fmt(s.available_count)+'</div>'+
      '<div style="font-size:11px;color:#64748b;">De alocat</div></td>';
    html += '<td style="padding:10px;border:1px solid #cbd5e1;border-radius:8px;text-align:center;">'+
      '<div style="font-size:24px;font-weight:800;color:#ef4444;">'+_fmt(s.handover_count)+'</div>'+
      '<div style="font-size:11px;color:#64748b;">Predare marfă</div></td>';
    html += '<td style="padding:10px;border:1px solid #cbd5e1;border-radius:8px;text-align:center;">'+
      '<div style="font-size:24px;font-weight:800;color:#dc2626;">'+_fmt(s.unpaid_count)+'</div>'+
      '<div style="font-size:11px;color:#64748b;">Neîncasat</div></td>';
    html += '</tr></table>';
    // Mai felrakások
    html += '<h3 style="margin:14px 0 6px;font-size:14px;">⬆️ Încărcări azi ('+d.todayPick.length+')</h3>';
    if (d.todayPick.length) {
      html += '<table style="width:100%;border-collapse:collapse;font-size:12.5px;">';
      html += '<tr style="background:#f1f5f9;"><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #cbd5e1;">Nr.</th><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #cbd5e1;">Client</th><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #cbd5e1;">Loc</th><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #cbd5e1;">Auto/Șofer</th></tr>';
      d.todayPick.forEach(function(o){
        html += '<tr><td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;">'+esc(o.fuvar_no||o.id)+
          '</td><td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;">'+esc(o.client||'—')+
          '</td><td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;">'+esc(o.loc_incarcare||'—')+
          '</td><td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;">'+esc(o.rendszam_camion||'')+' '+esc(o.nume_sofer||'')+'</td></tr>';
      });
      html += '</table>';
    } else html += '<div style="color:#64748b;font-size:12.5px;">— nu sunt încărcări azi.</div>';
    // Mai lerakások
    html += '<h3 style="margin:14px 0 6px;font-size:14px;">⬇️ Descărcări azi ('+d.todayDrop.length+')</h3>';
    if (d.todayDrop.length) {
      html += '<table style="width:100%;border-collapse:collapse;font-size:12.5px;">';
      html += '<tr style="background:#f1f5f9;"><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #cbd5e1;">Nr.</th><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #cbd5e1;">Client</th><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #cbd5e1;">Loc</th><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #cbd5e1;">Auto/Șofer</th></tr>';
      d.todayDrop.forEach(function(o){
        html += '<tr><td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;">'+esc(o.fuvar_no||o.id)+
          '</td><td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;">'+esc(o.client||'—')+
          '</td><td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;">'+esc(o.loc_descarcare||'—')+
          '</td><td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;">'+esc(o.rendszam_camion||'')+' '+esc(o.nume_sofer||'')+'</td></tr>';
      });
      html += '</table>';
    } else html += '<div style="color:#64748b;font-size:12.5px;">— nu sunt descărcări azi.</div>';
    // Lejáratok
    if (d.expiries && d.expiries.length) {
      html += '<h3 style="margin:14px 0 6px;font-size:14px;">⏰ Documente expiră în 30 zile ('+d.expiries.length+')</h3>';
      html += '<ul style="margin:4px 0;padding-left:20px;font-size:12.5px;">';
      d.expiries.slice(0, 15).forEach(function(x){
        html += '<li>'+esc(x.tip||'—')+' · '+esc(x.target_ref||'')+' — '+esc(String(x.expires_on).slice(0,10))+'</li>';
      });
      if (d.expiries.length > 15) html += '<li style="color:#64748b;">+ '+(d.expiries.length-15)+' altele…</li>';
      html += '</ul>';
    }
    // Szerviz
    if (d.services && d.services.length) {
      html += '<h3 style="margin:14px 0 6px;font-size:14px;">🔧 Servicii scadente în 2 săptămâni ('+d.services.length+')</h3>';
    }
    html += '<div style="margin-top:20px;padding-top:10px;border-top:1px solid #cbd5e1;color:#94a3b8;font-size:11px;">'+
      'Sumarul se trimite zilnic conform setărilor. Poți dezactiva sau modifica ora în Setări → 📧 Sumar zilnic.</div>';
    html += '</div>';
    return html;
  }

  async function tick() {
    // Cégek, ahol be van kapcsolva, és ma még nem küldtünk (Bucharest időzóna).
    let companies;
    try {
      ({ rows: companies } = await pool.query(
        `SELECT id, nev, digest_time, digest_recipients, digest_last_sent_at
           FROM companies
          WHERE COALESCE(digest_enabled, false) = true`));
    } catch (err) {
      if (err && err.code === '42703') return; // migráció-hiány → csendes
      return;
    }
    if (!companies.length) return;
    const nowHm = _hu_hm();
    const today = _hu_today();
    for (const c of companies) {
      try {
        // Duplikáció-őr: ma már küldtünk-e?
        const lastSent = c.digest_last_sent_at ? new Date(c.digest_last_sent_at).toISOString().slice(0, 10) : null;
        if (lastSent === today) continue;
        // Az időpont HH:MM formában? A `digest_time` PG TIME → '07:00:00' string.
        const wantHm = String(c.digest_time || '07:00').slice(0, 5);
        if (nowHm !== wantHm) continue;
        // Címzettek: cég Admin/Manager userei + digest_recipients extra tömb.
        const recRow = await pool.query(
          `SELECT email FROM users WHERE company_id=$1 AND pozicio IN ('Admin','Manager') AND email IS NOT NULL`, [c.id]);
        const emails = new Set(recRow.rows.map(x => String(x.email).trim().toLowerCase()).filter(Boolean));
        if (Array.isArray(c.digest_recipients)) {
          c.digest_recipients.forEach(e => { const s = String(e || '').trim().toLowerCase();
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) emails.add(s); });
        }
        if (!emails.size) continue;
        const digest = await _buildDigest(c.id);
        const html = _renderHtml(c.nev || '—', digest);
        const subject = '☀️ Sumar zilnic — ' + (c.nev || 'VallorSoft') + ' — ' + today;
        // Küldés minden címzettnek (közös VallorSoft feladóról).
        for (const to of emails) {
          try {
            await email.sendClientEmail({ to, subject, html, companyId: c.id, mailType: 'morning_digest' });
          } catch (e) { console.warn('[MorningDigest] küldés hiba', to, e.message); }
        }
        await pool.query(`UPDATE companies SET digest_last_sent_at=NOW() WHERE id=$1`, [c.id]);
        console.log('[MorningDigest] Elküldve —', c.nev, '(' + emails.size + ' címzett)');
      } catch (err) {
        console.warn('[MorningDigest] cégre skip:', c.id, err.message);
      }
    }
  }

  setTimeout(tick, 30 * 1000);            // 30 mp múlva először
  const interval = setInterval(tick, 60 * 1000); // percenként
  console.log('[MorningDigest] Reggeli összefoglaló ütemező elindítva (1 perces ciklus).');
  return interval;
}

// ================================================================
//  NAPI GPS ÚTVONAL (breadcrumb) — cégenként/rendszámonként a jármű pozíciója
//  10 percenként rögzítve. Mozgás-szűrő: csak akkor INSERT-el, ha ≥200 m-rel
//  eltér az utolsó rögzített pozíciótól (nem szennyezi álló járművek
//  ismétlődő adatával). Adattakarítás: 7 napnál régebbi sorok törlése.
// ================================================================
function startGpsDailyTrackScheduler() {
  const vehiclePositions = require('../lib/vehiclePositions');

  // Haversine — két lat/lng közti távolság méterben.
  function _distMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const rad = (d) => d * Math.PI / 180;
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  async function _collectForCompany(cid) {
    // A getPositions cache-elt (30 mp) — nem terhel, ugyanaz mint a Vezérlőpulton.
    let posResp;
    try { posResp = await vehiclePositions.getPositions(cid); } catch (_) { return; }
    if (!posResp || !posResp.gps_configured || !Array.isArray(posResp.positions)) return;
    for (const p of posResp.positions) {
      if (!p || p.lat == null || p.lng == null) continue;
      try {
        // Utolsó rögzített pozíció az adott járműre (mozgás-szűrő).
        const last = await pool.query(
          `SELECT lat, lng FROM gps_daily_positions
            WHERE company_id=$1 AND rendszam=$2
            ORDER BY recorded_at DESC LIMIT 1`, [cid, p.rendszam]);
        if (last.rows.length) {
          const d = _distMeters(parseFloat(last.rows[0].lat), parseFloat(last.rows[0].lng), p.lat, p.lng);
          if (d < 200) continue; // <200 m → nem rögzítünk (mozgás-szűrő)
        }
        await pool.query(
          `INSERT INTO gps_daily_positions (company_id, rendszam, lat, lng, speed_kmh, ignition, recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::timestamptz, NOW()))`,
          [cid, p.rendszam, p.lat, p.lng,
           (p.speed != null ? Number(p.speed) : null),
           (p.ignition != null ? (String(p.ignition).toLowerCase() === 'on' || p.ignition === true) : null),
           p.datetime || null]);
      } catch (_) { /* per-jármű hiba ne állítsa le a kört */ }
    }
  }

  async function tick() {
    // Egyszerre az összes GPS-t használó céget lekérdezzük.
    let companies;
    try {
      ({ rows: companies } = await pool.query(
        `SELECT DISTINCT ci.company_id
           FROM company_integrations ci
          WHERE ci.category='gps' AND ci.enabled=true`));
    } catch (_) { return; }
    for (const c of companies) {
      try { await _collectForCompany(c.company_id); } catch (_) {}
    }
    // Takarítás: >7 nap.
    try {
      const r = await pool.query(
        `DELETE FROM gps_daily_positions WHERE recorded_at < NOW() - INTERVAL '7 days'`);
      if (r.rowCount > 0) console.log('[GpsDaily] Törölve', r.rowCount, 'régi pozíció (>7 nap).');
    } catch (_) {}
  }

  setTimeout(tick, 60 * 1000);                     // 1 perc múlva először
  const interval = setInterval(tick, 10 * 60 * 1000); // 10 percenként
  console.log('[GpsDaily] Napi GPS útvonal-gyűjtő elindítva (10 perces ciklus, ≥200 m mozgás-szűrő).');
  return interval;
}

module.exports = { startIntakeScheduler, startExpiryScheduler, startGpsMileageScheduler, startMonthEndSnapshotScheduler, startServiceDueScheduler, startMonthlyReportScheduler, startEFacturaStatusScheduler, startTrialExpiryScheduler, startTrialReminderScheduler, startCancelReminderScheduler, startStatsReportScheduler, startPaymentDueScheduler, startPdfWorkspaceCleanup, startMorningDigestScheduler, startGpsDailyTrackScheduler };
