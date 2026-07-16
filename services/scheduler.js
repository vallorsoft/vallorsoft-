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

module.exports = { startIntakeScheduler, startExpiryScheduler, startGpsMileageScheduler, startServiceDueScheduler, startMonthlyReportScheduler, startEFacturaStatusScheduler, startTrialExpiryScheduler, startTrialReminderScheduler, startCancelReminderScheduler };
