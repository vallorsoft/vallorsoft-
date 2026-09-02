// ============================================================
//  VallorSoft — handlers/driverActivity.js
//  🎬 Sofőr-aktivitás — egy sofőr összes tevékenysége egy fuvaron
//  vagy időszakon: menetlevél-beküldés, tankolás/vásárlás sorok,
//  fuvar-állomás-milestone-ok, feltöltött fotók, UIT-kódok,
//  határátlépések, bug-jelzések. Read-only aggregátor.
//  Multi-tenant: minden lekérdezés company_id-szűrt, paraméteres.
//  Kapuk: Admin | Manager (Sofer NEM éri el).
// ============================================================
const pool = require('../db');

const handlers = {};

function _isAdminOrManager(req) {
  return req.session.user && ['Admin', 'Manager'].includes(req.session.user.pozicio);
}
function _deny(res) {
  return res.json({ result: { ok: false, err: 'Acces interzis' } });
}
function _arg(args) {
  return Array.isArray(args) ? (args[0] || {}) : (args || {});
}

// A jelenlegi hó (localhoz igazítva) — default szűrő.
function _defaultRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

// ────────────────────────────────────────────────────────────
//  1) Sofőr-lista + gyors KPI-k (áttekintő rács kártyáihoz)
// ────────────────────────────────────────────────────────────
handlers.getActivityDrivers = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const a = _arg(args);
    const r = _defaultRange();
    const from = a.from || r.from;
    const to   = a.to   || r.to;

    // Sofőrök a cégből (Sofer szerep, nem blokkolt).
    const uR = await pool.query(
      `SELECT id, email, nume, tel
         FROM users
        WHERE company_id = $1
          AND pozicio = 'Sofer'
          AND COALESCE(blocked, false) = false
        ORDER BY nume NULLS LAST, email`,
      [cid]
    );
    const drivers = uR.rows;
    if (!drivers.length) return res.json({ result: { ok: true, items: [], from, to } });

    // Aggregátumok EGY-EGY lekérdezéssel, sofőrenként csoportosítva.
    // Menetlevelek + km + fotók + fuvarok az időszakban.
    const emails = drivers.map((d) => d.email.toLowerCase());

    // Menetlevelek darab + km — eff_date (érkezés → indulás → data_completare) szerint
    const wbR = await pool.query(
      `SELECT LOWER(email_sofer) AS email,
              COUNT(*)::int AS waybill_count,
              COALESCE(SUM(total_km),0)::numeric AS km,
              MAX(COALESCE(erkezes_dt, indulas_dt, data_completare)) AS last_wb_at
         FROM fuvarlevelek
        WHERE company_id = $1
          AND LOWER(email_sofer) = ANY($2)
          AND COALESCE(erkezes_dt, indulas_dt, data_completare) >= $3::date
          AND COALESCE(erkezes_dt, indulas_dt, data_completare) < ($4::date + 1)
        GROUP BY 1`,
      [cid, emails, from, to]
    );

    // Fuvar-darabszám + utolsó milestone
    const orR = await pool.query(
      `SELECT LOWER(email_sofer) AS email,
              COUNT(*)::int AS order_count,
              MAX(GREATEST(COALESCE(sosit_incarcare_at,'epoch'::timestamptz),
                           COALESCE(incarcat_at,'epoch'::timestamptz),
                           COALESCE(sosit_descarcare_at,'epoch'::timestamptz),
                           COALESCE(descarcat_at,'epoch'::timestamptz))) AS last_ms_at
         FROM orders
        WHERE company_id = $1
          AND LOWER(email_sofer) = ANY($2)
          AND status <> 'Anulat'
          AND COALESCE(data_incarcare, created_at::date) >= $3::date
          AND COALESCE(data_incarcare, created_at::date) <= $4::date
        GROUP BY 1`,
      [cid, emails, from, to]
    );

    // Feltöltött fotók (documents = sofőr POD/CMR; order_documents = cég szintű,
    // itt csak a documents-et számoljuk sofőrönként — ez a valódi „sofőr által feltöltött").
    const phR = await pool.query(
      `SELECT LOWER(d.email_sofer) AS email,
              COUNT(*)::int AS photo_count,
              MAX(d.created_at) AS last_photo_at
         FROM documents d
        WHERE d.company_id = $1
          AND LOWER(d.email_sofer) = ANY($2)
          AND d.created_at >= $3::date
          AND d.created_at < ($4::date + 1)
        GROUP BY 1`,
      [cid, emails, from, to]
    ).catch(() => ({ rows: [] })); // documents.company_id régen NULL — best-effort

    // Sofőrönként map-be gyűjtjük
    const mapBy = (rows, key) => {
      const m = {};
      for (const r_ of rows) m[r_[key]] = r_;
      return m;
    };
    const wb = mapBy(wbR.rows, 'email');
    const orM = mapBy(orR.rows, 'email');
    const ph = mapBy(phR.rows, 'email');

    // Utolsó aktivitás = max(menetlevél / fuvar-milestone / fotó)
    function maxDate(a1, a2, a3) {
      const ds = [a1, a2, a3].filter(Boolean).map((x) => new Date(x).getTime());
      if (!ds.length) return null;
      return new Date(Math.max.apply(null, ds)).toISOString();
    }

    const items = drivers.map((d) => {
      const em = d.email.toLowerCase();
      const w = wb[em] || {};
      const o = orM[em] || {};
      const p = ph[em] || {};
      return {
        email: d.email,
        nume: d.nume || d.email,
        tel: d.tel || null,
        waybill_count: w.waybill_count || 0,
        km: Number(w.km) || 0,
        order_count: o.order_count || 0,
        photo_count: p.photo_count || 0,
        last_activity_at: maxDate(w.last_wb_at, o.last_ms_at, p.last_photo_at),
      };
    });

    return res.json({ result: { ok: true, items, from, to } });
  } catch (err) {
    console.error('getActivityDrivers hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ────────────────────────────────────────────────────────────
//  2) Egy sofőr aktivitás-idővonala (események kronológiában)
//     args: { email, orderId? (szűkítés egy fuvarra), from, to }
//     Válasz: { ok, driver, orders[], events[], photos[] }
//     events: [{ at, type, icon, title, subtitle?, order_id?, meta? }]
//     photos: [{ id, kind, order_id?, title, created_at, thumb_url, full_url }]
// ────────────────────────────────────────────────────────────
handlers.getDriverActivity = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const a = _arg(args);
    const email = String(a.email || '').trim().toLowerCase();
    if (!email) return res.json({ result: { ok: false, err: 'Selecteaza un sofer!' } });

    // Cross-tenant védelem: sofőr a saját céghez tartozik-e
    const uR = await pool.query(
      `SELECT id, email, nume, tel FROM users
        WHERE LOWER(email)=LOWER($1) AND company_id=$2`,
      [email, cid]
    );
    if (!uR.rows.length) return res.json({ result: { ok: false, err: 'Soferul nu a fost gasit.' } });
    const driver = uR.rows[0];

    const r = _defaultRange();
    const from = a.from || r.from;
    const to   = a.to   || r.to;
    const orderId = a.orderId ? String(a.orderId) : null;

    // Fuvarok listája a szűrő-legördülőhöz + timeline-fő-események.
    // Az opcionális oszlopokat (fuvar_no, sosit_*_at, incarcat_at, descarcat_at,
    // handover_*) `to_jsonb(o)->>'kulcs'` mintával olvassuk — így ha egy oszlop
    // nem létezik a cég DB-jén (nem futott migráció), az adott mező NULL lesz,
    // és a lekérdezés NEM hasal el. Csak az abszolút alapvető oszlopokra
    // hivatkozunk direktben (id, company_id, email_sofer, status, client,
    // loc_*, data_*, created_at) — ezek régóta minden cégnél léteznek.
    let orders = [];
    try {
      const ordersR = await pool.query(
        `SELECT o.id, o.client,
                o.loc_incarcare, o.loc_descarcare,
                o.data_incarcare, o.data_descarcare, o.status,
                (to_jsonb(o) ->> 'fuvar_no')            AS fuvar_no,
                (to_jsonb(o) ->> 'sosit_incarcare_at')  AS sosit_incarcare_at,
                (to_jsonb(o) ->> 'incarcat_at')         AS incarcat_at,
                (to_jsonb(o) ->> 'sosit_descarcare_at') AS sosit_descarcare_at,
                (to_jsonb(o) ->> 'descarcat_at')        AS descarcat_at,
                (to_jsonb(o) ->> 'handover_status')     AS handover_status,
                (to_jsonb(o) ->> 'handover_at')         AS handover_at,
                (to_jsonb(o) ->> 'handover_location')   AS handover_location
           FROM orders o
          WHERE o.company_id = $1
            AND LOWER(o.email_sofer) = $2
            AND o.status <> 'Anulat'
            AND (
              ($3::text IS NOT NULL AND o.id = $3)
              OR ($3::text IS NULL
                  AND COALESCE(o.data_incarcare, o.created_at::date) >= $4::date
                  AND COALESCE(o.data_incarcare, o.created_at::date) <= $5::date)
            )
          ORDER BY COALESCE(o.data_incarcare, o.created_at::date) DESC, o.id DESC
          LIMIT 200`,
        [cid, email, orderId, from, to]
      );
      orders = ordersR.rows;
    } catch (e) {
      // Régi séma / hiányzó oszlop: log, de a többi forrás még adhat adatot.
      console.error('getDriverActivity orders query hiba:', e.message);
    }
    const orderIds = orders.map((o) => o.id);

    const events = [];
    const photos = [];

    // A) Fuvar-milestone-ok (sosit_incarcare_at / incarcat_at / sosit_descarcare_at / descarcat_at)
    for (const o of orders) {
      const label = (o.fuvar_no ? o.fuvar_no : o.id);
      const sub = (o.loc_incarcare || '?') + ' → ' + (o.loc_descarcare || '?');
      if (o.sosit_incarcare_at) events.push({
        at: o.sosit_incarcare_at, type: 'milestone', icon: '📍',
        title: 'Megérkezett a felrakóhoz', subtitle: sub, order_id: o.id, order_label: label,
      });
      if (o.incarcat_at) events.push({
        at: o.incarcat_at, type: 'milestone', icon: '📦',
        title: 'Felrakva', subtitle: sub, order_id: o.id, order_label: label,
      });
      if (o.sosit_descarcare_at) events.push({
        at: o.sosit_descarcare_at, type: 'milestone', icon: '📍',
        title: 'Megérkezett a lerakóhoz', subtitle: sub, order_id: o.id, order_label: label,
      });
      if (o.descarcat_at) events.push({
        at: o.descarcat_at, type: 'milestone', icon: '✅',
        title: 'Leürítve', subtitle: sub, order_id: o.id, order_label: label,
      });
      if (o.handover_at && (o.handover_status === 'Parkolt' || o.handover_status === 'Raktarban')) {
        events.push({
          at: o.handover_at, type: 'handover', icon: '⛔',
          title: 'Áru-leadás — ' + o.handover_status,
          subtitle: o.handover_location || sub, order_id: o.id, order_label: label,
        });
      }
    }

    // B) Menetlevél-beküldések + a benne lévő tankolás/vásárlás sorok külön eseményként
    //    A menetlevél maga = 1 fő esemény; a sorok külön kis események a saját dátumukon.
    //    Robusztus fallback: ha a `company_id` oszlop nincs, users-joinnal próbáljuk
    //    (a régi fuvarlevelek táblák így kötődtek a céghez).
    //    Az erkezes_dt/indulas_dt opcionális oszlopok — to_jsonb-vel biztonságosan.
    let wbR = { rows: [] };
    try {
      const wbWhere = orderIds.length
        ? `WHERE f.company_id=$1 AND LOWER(f.email_sofer)=$2
             AND (f.order_ids @> to_jsonb($3::text[]) OR f.order_ids ?| $3::text[])`
        : `WHERE f.company_id=$1 AND LOWER(f.email_sofer)=$2
             AND COALESCE(
                   (to_jsonb(f) ->> 'erkezes_dt')::timestamptz,
                   (to_jsonb(f) ->> 'indulas_dt')::timestamptz,
                   f.data_completare
                 ) >= $4::date
             AND COALESCE(
                   (to_jsonb(f) ->> 'erkezes_dt')::timestamptz,
                   (to_jsonb(f) ->> 'indulas_dt')::timestamptz,
                   f.data_completare
                 ) < ($5::date + 1)`;
      const wbParams = orderIds.length ? [cid, email, orderIds] : [cid, email, null, from, to];
      wbR = await pool.query(
        `SELECT f.id, f.data_completare, f.numar_camion, f.numar_remorca,
                f.total_km, f.alte_mentiuni, f.alimentari, f.achizitii, f.puncte, f.order_ids,
                (to_jsonb(f) ->> 'erkezes_dt') AS erkezes_dt,
                (to_jsonb(f) ->> 'indulas_dt') AS indulas_dt
           FROM fuvarlevelek f
          ${wbWhere}
          ORDER BY f.data_completare DESC
          LIMIT 200`,
        wbParams
      );
    } catch (e) {
      console.error('getDriverActivity waybills query hiba:', e.message);
      wbR = { rows: [] };
    }

    for (const w of wbR.rows) {
      const effAt = w.erkezes_dt || w.indulas_dt || w.data_completare;
      events.push({
        at: effAt, type: 'waybill', icon: '📄',
        title: 'Menetlevél beküldve — ' + (w.id || ''),
        subtitle: (w.numar_camion ? '🚚 ' + w.numar_camion : '') +
                  (w.numar_remorca ? ' · 🚛 ' + w.numar_remorca : '') +
                  (w.total_km ? ' · ' + Number(w.total_km).toLocaleString('ro-RO') + ' km' : ''),
        meta: { waybill_id: w.id },
      });
      // Tankolás sorok
      (Array.isArray(w.alimentari) ? w.alimentari : []).forEach((it) => {
        const at = it && it.data ? (String(it.data).length <= 10 ? it.data + 'T12:00:00Z' : it.data) : effAt;
        events.push({
          at, type: 'fuel', icon: '⛽',
          title: 'Tankolás beírva',
          subtitle: (it.loc || '') +
                    (it.tip ? ' · ' + it.tip : '') +
                    (it.litru ? ' · ' + it.litru + ' L' : '') +
                    (it.suma ? ' · ' + it.suma + ' ' + (it.valuta || '') : '') +
                    (it.plata ? ' · ' + it.plata : ''),
          meta: { source: 'waybill', waybill_id: w.id },
        });
      });
      // Vásárlás sorok
      (Array.isArray(w.achizitii) ? w.achizitii : []).forEach((it) => {
        const at = it && it.data ? (String(it.data).length <= 10 ? it.data + 'T12:00:00Z' : it.data) : effAt;
        events.push({
          at, type: 'purchase', icon: '🛒',
          title: 'Vásárlás beírva',
          subtitle: (it.loc || '') +
                    (it.produs ? ' · ' + it.produs : '') +
                    (it.pret ? ' · ' + it.pret + ' ' + (it.valuta || '') : '') +
                    (it.plata ? ' · ' + it.plata : ''),
          meta: { source: 'waybill', waybill_id: w.id },
        });
      });
    }

    // C) Fotók (POD / CMR / bon-scan képek) — `documents` táblából
    //    `documents.company_id` a 2026-07-16 óta létezik (fuvarlevelek-documents-company-id.sql);
    //    fallback: users-join a sofőr-email → company_id-re, hogy régebbi cég-DB-n is menjen.
    let dR = { rows: [] };
    try {
      const dParams = orderIds.length
        ? [cid, email, orderIds]
        : [cid, email, null, from, to];
      const dWhere = orderIds.length
        ? `WHERE d.company_id=$1 AND LOWER(d.email_sofer)=$2 AND (d.order_id = ANY($3))`
        : `WHERE d.company_id=$1 AND LOWER(d.email_sofer)=$2
             AND d.created_at >= $4::date AND d.created_at < ($5::date + 1)`;
      dR = await pool.query(
        `SELECT d.id, d.tip, d.file_name,
                (to_jsonb(d) ->> 'order_id') AS order_id,
                d.created_at
           FROM documents d ${dWhere}
          ORDER BY d.created_at DESC
          LIMIT 300`,
        dParams
      );
    } catch (e) {
      // Fallback: régebbi cég-DB, ahol a documents.company_id még hiányzik → users-join
      try {
        const dParams2 = orderIds.length
          ? [cid, email, orderIds]
          : [cid, email, null, from, to];
        const dWhere2 = orderIds.length
          ? `AND (d.order_id = ANY($3))`
          : `AND d.created_at >= $4::date AND d.created_at < ($5::date + 1)`;
        dR = await pool.query(
          `SELECT d.id, d.tip, d.file_name,
                  (to_jsonb(d) ->> 'order_id') AS order_id,
                  d.created_at
             FROM documents d
             JOIN users u ON LOWER(u.email) = LOWER(d.email_sofer)
            WHERE u.company_id = $1
              AND LOWER(d.email_sofer) = $2 ${dWhere2}
            ORDER BY d.created_at DESC
            LIMIT 300`,
          dParams2
        );
      } catch (e2) {
        console.error('getDriverActivity documents fallback hiba:', e2.message);
        dR = { rows: [] };
      }
    }

    for (const d of dR.rows) {
      const url = '/api/doc-download/' + d.id;
      photos.push({
        id: d.id,
        kind: d.tip || 'foto',
        title: d.file_name || ('#' + d.id),
        order_id: d.order_id || null,
        created_at: d.created_at,
        thumb_url: url, // ugyanaz — a kliens img-tag inline miniben tölti
        full_url: url,
      });
      events.push({
        at: d.created_at, type: 'photo', icon: '📷',
        title: 'Fotó feltöltve — ' + (d.tip || 'dokumentum'),
        subtitle: d.file_name || '',
        order_id: d.order_id || null,
        meta: { photo_id: d.id, url },
      });
    }

    // D) UIT-kódok (sofőr által manuálisan vagy AI-fotóval)
    if (orderIds.length) {
      try {
        const uitR = await pool.query(
          `SELECT id, order_id, uit_code, rendszam, source, created_at
             FROM order_uit_codes
            WHERE company_id=$1 AND order_id = ANY($2)
            ORDER BY created_at DESC
            LIMIT 200`,
          [cid, orderIds]
        );
        for (const u of uitR.rows) {
          events.push({
            at: u.created_at, type: 'uit', icon: '🛣️',
            title: 'UIT kód rögzítve',
            subtitle: (u.uit_code ? u.uit_code : '') +
                      (u.rendszam ? ' · ' + u.rendszam : '') +
                      (u.source ? ' · ' + u.source : ''),
            order_id: u.order_id,
          });
        }
      } catch (_e) {}
    }

    // E) Határátlépések (a sofőr GPS-alapján, cégen belül a sofőr-emailre szűrve)
    try {
      const bcR = await pool.query(
        `SELECT bc.id, bc.tip, bc.tara, bc.locatie, bc.gps_lat, bc.gps_lng, bc.created_at
           FROM border_crossings bc
           JOIN users u ON LOWER(u.email) = LOWER(bc.email_sofer) AND u.company_id = $1
          WHERE LOWER(bc.email_sofer) = $2
            AND bc.created_at >= $3::date AND bc.created_at < ($4::date + 1)
          ORDER BY bc.created_at DESC
          LIMIT 200`,
        [cid, email, from, to]
      );
      for (const c of bcR.rows) {
        const isIn = /intr/i.test(c.tip || '');
        events.push({
          at: c.created_at, type: 'border', icon: '🛂',
          title: (isIn ? '🇷🇴 Belépés — ' : '🌍 Kilépés — ') + (c.tara || ''),
          subtitle: c.locatie || '',
          meta: { lat: c.gps_lat, lng: c.gps_lng },
        });
      }
    } catch (_e) {}

    // F/1) AI-scannelt bonok — pending (menetlevélben még nincs) + attached
    //  Az admin/manager itt láthatja azokat a bonokat is, amelyeket a sofőr
    //  már lefotózott + az AI kiolvasott, de MÉG NINCSENEK menetlevélben.
    //  Az `status='attached'` sorok azok, amelyeket a sofőr utólag illesztett.
    //  A pending-eknél a UI figyelmeztető színt/badge-et használ ("☁️ csak
    //  felhőben"), az attached-nél normál színt ("📄 menetlevélben").
    try {
      const rsR = await pool.query(
        `SELECT id, kind, fields, status, waybill_id, scanned_at, attached_at,
                CASE WHEN thumb_b64 IS NOT NULL THEN true ELSE false END AS has_thumb
           FROM driver_receipt_scans
          WHERE company_id = $1
            AND LOWER(email_sofer) = $2
            AND status IN ('pending', 'attached')
            AND scanned_at >= $3::date
            AND scanned_at < ($4::date + 1)
          ORDER BY scanned_at DESC
          LIMIT 200`,
        [cid, email, from, to]
      );
      for (const r of rsR.rows) {
        const f = r.fields || {};
        const isFuel = r.kind === 'fuel';
        const isPending = r.status === 'pending';
        const subtitle = (f.loc || '') +
          (isFuel && f.tip ? ' · ' + f.tip : '') +
          (isFuel && f.litru ? ' · ' + f.litru + ' L' : '') +
          (!isFuel && f.produs ? ' · ' + f.produs : '') +
          (f.suma ? ' · ' + f.suma + ' ' + (f.valuta || '') : '') +
          (f.plata ? ' · ' + f.plata : '');
        events.push({
          at: r.scanned_at,
          type: isPending ? (isFuel ? 'fuel_pending' : 'purchase_pending')
                          : (isFuel ? 'fuel' : 'purchase'),
          icon: isFuel ? '⛽' : '🛒',
          title: (isFuel ? 'Tankolás' : 'Vásárlás') +
                 (isPending ? ' — ☁️ csak felhőben' : ' — 📄 menetlevélben'),
          subtitle,
          meta: {
            source: 'scan', scan_id: r.id, waybill_id: r.waybill_id || null,
            pending: isPending, has_thumb: !!r.has_thumb,
          },
        });
      }
    } catch (e) {
      // Régi séma-eltérés → csendes noop.
      console.warn('getDriverActivity pending-scans query hiba:', e.message);
    }

    // F) Bug-jelzések a sofőrtől
    try {
      const bR = await pool.query(
        `SELECT id, szoveg, oldal, created_at
           FROM bug_reports
          WHERE company_id=$1 AND LOWER(user_email)=$2
            AND created_at >= $3::date AND created_at < ($4::date + 1)
          ORDER BY created_at DESC
          LIMIT 100`,
        [cid, email, from, to]
      );
      for (const b of bR.rows) {
        events.push({
          at: b.created_at, type: 'bug', icon: '🐛',
          title: 'Bug jelzés',
          subtitle: (b.oldal ? '[' + b.oldal + '] ' : '') +
                    String(b.szoveg || '').slice(0, 200),
          meta: { bug_id: b.id },
        });
      }
    } catch (_e) {}

    // Rendezés — legújabb elöl
    events.sort((x, y) => {
      const ta = x.at ? new Date(x.at).getTime() : 0;
      const tb = y.at ? new Date(y.at).getTime() : 0;
      return tb - ta;
    });

    // Összefoglaló számláló (a fejléc-KPI-hez)
    const counts = {
      milestone: 0, waybill: 0, fuel: 0, purchase: 0,
      fuel_pending: 0, purchase_pending: 0,
      photo: 0, uit: 0, border: 0, bug: 0,
    };
    for (const ev of events) { if (counts[ev.type] != null) counts[ev.type]++; }

    return res.json({ result: {
      ok: true,
      driver: { email: driver.email, nume: driver.nume || driver.email, tel: driver.tel || null },
      orders: orders.map((o) => ({
        id: o.id, fuvar_no: o.fuvar_no, client: o.client,
        loc_incarcare: o.loc_incarcare, loc_descarcare: o.loc_descarcare,
        data_incarcare: o.data_incarcare, data_descarcare: o.data_descarcare,
        status: o.status,
      })),
      events,
      photos,
      counts,
      from, to, orderId,
    } });
  } catch (err) {
    // Részletes napló szerver-oldalon, hogy a valódi ok látszódjon;
    // a kliens felé generikus üzenet (nincs stack-trace szivárgás).
    console.error('getDriverActivity hiba:', err && err.stack ? err.stack : err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ────────────────────────────────────────────────────────────
//  3) Jármű-lista + gyors KPI (áttekintő rács kártyáihoz)
//     Jármű-oldali nézet a Sofőr-aktivitás menüben (👤/🚛 toggle).
// ────────────────────────────────────────────────────────────
handlers.getActivityVehicles = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const a = _arg(args);
    const r = _defaultRange();
    const from = a.from || r.from;
    const to   = a.to   || r.to;

    // Járművek a cégből — a `vehicles` táblából alap-mezők + kiosztott sofőr.
    // Az opcionális `assigned_driver_email` migráció-tudatos (to_jsonb).
    let vehicles = [];
    try {
      const vR = await pool.query(
        `SELECT v.id, v.rendszam,
                (to_jsonb(v) ->> 'marca')                  AS marca,
                (to_jsonb(v) ->> 'tip')                    AS tip,
                (to_jsonb(v) ->> 'assigned_driver_email')  AS assigned_driver_email,
                (to_jsonb(v) ->> 'default_trailer_id')     AS default_trailer_id
           FROM vehicles v
          WHERE v.company_id = $1
          ORDER BY v.rendszam`,
        [cid]
      );
      vehicles = vR.rows;
    } catch (e) {
      console.error('getActivityVehicles vehicles hiba:', e.message);
    }
    if (!vehicles.length) return res.json({ result: { ok: true, items: [], from, to } });

    // A jármű-hozzárendelt sofőr nevét feloldjuk a `users` táblából (cégre szűrt)
    const assignedEmails = vehicles
      .map((v) => v.assigned_driver_email)
      .filter((e) => !!e)
      .map((e) => e.toLowerCase());
    let userMap = {};
    if (assignedEmails.length) {
      try {
        const uR = await pool.query(
          `SELECT LOWER(email) AS email, nume
             FROM users
            WHERE company_id = $1 AND LOWER(email) = ANY($2)`,
          [cid, assignedEmails]
        );
        for (const u of uR.rows) userMap[u.email] = u.nume;
      } catch (_e) {}
    }

    const plates = vehicles.map((v) => v.rendszam);

    // Fuvar-darabszám + utolsó milestone rendszámonként
    let orM = {};
    try {
      const orR = await pool.query(
        `SELECT UPPER(REPLACE(rendszam_camion, ' ', '')) AS plate,
                COUNT(*)::int AS order_count,
                MAX(GREATEST(
                  COALESCE((to_jsonb(o) ->> 'sosit_incarcare_at')::timestamptz, 'epoch'::timestamptz),
                  COALESCE((to_jsonb(o) ->> 'incarcat_at')::timestamptz, 'epoch'::timestamptz),
                  COALESCE((to_jsonb(o) ->> 'sosit_descarcare_at')::timestamptz, 'epoch'::timestamptz),
                  COALESCE((to_jsonb(o) ->> 'descarcat_at')::timestamptz, 'epoch'::timestamptz)
                )) AS last_ms_at
           FROM orders o
          WHERE o.company_id = $1
            AND o.rendszam_camion IS NOT NULL
            AND o.status <> 'Anulat'
            AND COALESCE(o.data_incarcare, o.created_at::date) >= $2::date
            AND COALESCE(o.data_incarcare, o.created_at::date) <= $3::date
          GROUP BY 1`,
        [cid, from, to]
      );
      for (const row of orR.rows) orM[row.plate] = row;
    } catch (e) { console.warn('getActivityVehicles orders hiba:', e.message); }

    // Menetlevél-darabszám + tankolt liter + km rendszámonként (vontatóra köti)
    let wbM = {};
    try {
      const wbR = await pool.query(
        `SELECT UPPER(REPLACE(numar_camion, ' ', '')) AS plate,
                COUNT(*)::int AS waybill_count,
                COALESCE(SUM(total_km), 0)::numeric AS km,
                COALESCE(SUM(
                  (SELECT COALESCE(SUM((a.elem->>'litru')::numeric), 0)
                     FROM jsonb_array_elements(f.alimentari) a(elem))
                ), 0)::numeric AS fuel_l,
                MAX(COALESCE(erkezes_dt, indulas_dt, data_completare)) AS last_wb_at
           FROM fuvarlevelek f
          WHERE company_id = $1
            AND numar_camion IS NOT NULL
            AND COALESCE(erkezes_dt, indulas_dt, data_completare) >= $2::date
            AND COALESCE(erkezes_dt, indulas_dt, data_completare) < ($3::date + 1)
          GROUP BY 1`,
        [cid, from, to]
      );
      for (const row of wbR.rows) wbM[row.plate] = row;
    } catch (e) { console.warn('getActivityVehicles waybills hiba:', e.message); }

    // Normalizált plate lookup (szóköz-mentes, nagybetűs)
    const normPlate = (p) => String(p || '').toUpperCase().replace(/\s+/g, '');
    function maxDate(a1, a2) {
      const ds = [a1, a2].filter(Boolean).map((x) => new Date(x).getTime());
      if (!ds.length) return null;
      return new Date(Math.max.apply(null, ds)).toISOString();
    }

    const items = vehicles.map((v) => {
      const np = normPlate(v.rendszam);
      const o = orM[np] || {};
      const w = wbM[np] || {};
      const drvEmail = (v.assigned_driver_email || '').toLowerCase();
      return {
        rendszam: v.rendszam,
        marca: v.marca || null,
        tip: v.tip || null,
        assigned_driver_email: v.assigned_driver_email || null,
        assigned_driver_name: drvEmail && userMap[drvEmail] ? userMap[drvEmail] : null,
        order_count: o.order_count || 0,
        waybill_count: w.waybill_count || 0,
        km: Number(w.km) || 0,
        fuel_l: Number(w.fuel_l) || 0,
        last_activity_at: maxDate(o.last_ms_at, w.last_wb_at),
      };
    });

    return res.json({ result: { ok: true, items, from, to } });
  } catch (err) {
    console.error('getActivityVehicles hiba:', err && err.stack ? err.stack : err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ────────────────────────────────────────────────────────────
//  4) Egy jármű aktivitás-idővonala (fuvar-milestone-ok + menetlevél
//     tankolás/vásárlás + üzemanyagkártya-import + szerviz-események)
// ────────────────────────────────────────────────────────────
handlers.getVehicleActivity = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const a = _arg(args);
    const rendszam = String(a.rendszam || '').trim();
    if (!rendszam) return res.json({ result: { ok: false, err: 'Rendszam lipsă.' } });

    // Cross-tenant védelem: a jármű a saját céghez tartozik-e
    let vehicle = null;
    try {
      const vR = await pool.query(
        `SELECT v.id, v.rendszam,
                (to_jsonb(v) ->> 'marca')                 AS marca,
                (to_jsonb(v) ->> 'tip')                   AS tip,
                (to_jsonb(v) ->> 'an')                    AS an,
                (to_jsonb(v) ->> 'assigned_driver_email') AS assigned_driver_email
           FROM vehicles v
          WHERE v.company_id = $1
            AND UPPER(REPLACE(v.rendszam, ' ', '')) = UPPER(REPLACE($2, ' ', ''))
          LIMIT 1`,
        [cid, rendszam]
      );
      vehicle = vR.rows[0] || null;
    } catch (e) { console.warn('getVehicleActivity vehicle hiba:', e.message); }
    if (!vehicle) return res.json({ result: { ok: false, err: 'Vehicul negăsit.' } });

    const r = _defaultRange();
    const from = a.from || r.from;
    const to   = a.to   || r.to;

    const events = [];

    // A) Fuvar-milestone-ok — a jármű rendszámára szűrve (vontató)
    let orders = [];
    try {
      const oR = await pool.query(
        `SELECT o.id, o.client, o.loc_incarcare, o.loc_descarcare,
                o.data_incarcare, o.status,
                o.email_sofer, o.nume_sofer,
                (to_jsonb(o) ->> 'fuvar_no')            AS fuvar_no,
                (to_jsonb(o) ->> 'sosit_incarcare_at')  AS sosit_incarcare_at,
                (to_jsonb(o) ->> 'incarcat_at')         AS incarcat_at,
                (to_jsonb(o) ->> 'sosit_descarcare_at') AS sosit_descarcare_at,
                (to_jsonb(o) ->> 'descarcat_at')        AS descarcat_at
           FROM orders o
          WHERE o.company_id = $1
            AND UPPER(REPLACE(o.rendszam_camion, ' ', '')) = UPPER(REPLACE($2, ' ', ''))
            AND o.status <> 'Anulat'
            AND COALESCE(o.data_incarcare, o.created_at::date) >= $3::date
            AND COALESCE(o.data_incarcare, o.created_at::date) <= $4::date
          ORDER BY COALESCE(o.data_incarcare, o.created_at::date) DESC, o.id DESC
          LIMIT 200`,
        [cid, rendszam, from, to]
      );
      orders = oR.rows;
    } catch (e) { console.warn('getVehicleActivity orders hiba:', e.message); }

    for (const o of orders) {
      const label = (o.fuvar_no ? o.fuvar_no : o.id);
      const sub = (o.loc_incarcare || '?') + ' → ' + (o.loc_descarcare || '?');
      const drvSuffix = o.nume_sofer ? (' — 👤 ' + o.nume_sofer) : '';
      if (o.sosit_incarcare_at) events.push({
        at: o.sosit_incarcare_at, type: 'milestone', icon: '📍',
        title: 'Megérkezett a felrakóhoz' + drvSuffix, subtitle: sub, order_label: label,
      });
      if (o.incarcat_at) events.push({
        at: o.incarcat_at, type: 'milestone', icon: '📦',
        title: 'Felrakva' + drvSuffix, subtitle: sub, order_label: label,
      });
      if (o.sosit_descarcare_at) events.push({
        at: o.sosit_descarcare_at, type: 'milestone', icon: '📍',
        title: 'Megérkezett a lerakóhoz' + drvSuffix, subtitle: sub, order_label: label,
      });
      if (o.descarcat_at) events.push({
        at: o.descarcat_at, type: 'milestone', icon: '✅',
        title: 'Leürítve' + drvSuffix, subtitle: sub, order_label: label,
      });
    }

    // B) Menetlevél-tankolás + vásárlás sorok
    let waybills = [];
    try {
      const wR = await pool.query(
        `SELECT id, data_completare, nume_sofer, email_sofer,
                total_km, alimentari, achizitii,
                (to_jsonb(f) ->> 'erkezes_dt') AS erkezes_dt,
                (to_jsonb(f) ->> 'indulas_dt') AS indulas_dt
           FROM fuvarlevelek f
          WHERE company_id = $1
            AND UPPER(REPLACE(numar_camion, ' ', '')) = UPPER(REPLACE($2, ' ', ''))
            AND COALESCE(erkezes_dt, indulas_dt, data_completare) >= $3::date
            AND COALESCE(erkezes_dt, indulas_dt, data_completare) < ($4::date + 1)
          ORDER BY data_completare DESC
          LIMIT 200`,
        [cid, rendszam, from, to]
      );
      waybills = wR.rows;
    } catch (e) { console.warn('getVehicleActivity waybills hiba:', e.message); }

    for (const w of waybills) {
      const effAt = w.erkezes_dt || w.indulas_dt || w.data_completare;
      const drvSuffix = w.nume_sofer ? (' — 👤 ' + w.nume_sofer) : '';
      events.push({
        at: effAt, type: 'waybill', icon: '📄',
        title: 'Menetlevél' + drvSuffix,
        subtitle: '#' + (w.id || '') + (w.total_km ? ' · ' + Number(w.total_km).toLocaleString('ro-RO') + ' km' : ''),
      });
      (Array.isArray(w.alimentari) ? w.alimentari : []).forEach((it) => {
        const at = it && it.data ? (String(it.data).length <= 10 ? it.data + 'T12:00:00Z' : it.data) : effAt;
        events.push({
          at, type: 'fuel', icon: '⛽',
          title: 'Tankolás (menetlevél)' + drvSuffix,
          subtitle: (it.loc || '') + (it.litru ? ' · ' + it.litru + ' L' : '') +
                    (it.suma ? ' · ' + it.suma + ' ' + (it.valuta || '') : ''),
        });
      });
      (Array.isArray(w.achizitii) ? w.achizitii : []).forEach((it) => {
        const at = it && it.data ? (String(it.data).length <= 10 ? it.data + 'T12:00:00Z' : it.data) : effAt;
        events.push({
          at, type: 'purchase', icon: '🛒',
          title: 'Vásárlás (menetlevél)' + drvSuffix,
          subtitle: (it.loc || '') + (it.produs ? ' · ' + it.produs : '') +
                    (it.pret ? ' · ' + it.pret + ' ' + (it.valuta || '') : ''),
        });
      });
    }

    // C) Üzemanyagkártya-tranzakciók (fuel_card_transactions) — best-effort
    try {
      const fcR = await pool.query(
        `SELECT tx_date, product, qty_l, amount_ron, source
           FROM fuel_card_transactions
          WHERE company_id = $1
            AND UPPER(REPLACE(rendszam, ' ', '')) = UPPER(REPLACE($2, ' ', ''))
            AND tx_date >= $3::date AND tx_date <= $4::date
          ORDER BY tx_date DESC
          LIMIT 200`,
        [cid, rendszam, from, to]
      );
      for (const f of fcR.rows) {
        events.push({
          at: f.tx_date, type: 'fuel_card', icon: '💳',
          title: 'Üzemanyagkártya — ' + (f.source || ''),
          subtitle: (f.product || '') + (f.qty_l ? ' · ' + Number(f.qty_l) + ' L' : '') +
                    (f.amount_ron ? ' · ' + Number(f.amount_ron).toLocaleString('ro-RO') + ' RON' : ''),
        });
      }
    } catch (_e) {}

    // D) Szerviz-események (vehicle_service_log)
    try {
      const svR = await pool.query(
        `SELECT service_date, km, category, description, cost_ron
           FROM vehicle_service_log
          WHERE company_id = $1
            AND vehicle_id = $2
            AND service_date >= $3::date AND service_date <= $4::date
          ORDER BY service_date DESC
          LIMIT 100`,
        [cid, vehicle.id, from, to]
      );
      for (const s of svR.rows) {
        events.push({
          at: s.service_date, type: 'service', icon: '🔧',
          title: 'Szerviz — ' + (s.category || '?'),
          subtitle: (s.description ? String(s.description).slice(0, 200) : '') +
                    (s.km ? ' · ' + Number(s.km).toLocaleString('ro-RO') + ' km' : '') +
                    (s.cost_ron ? ' · ' + Number(s.cost_ron).toLocaleString('ro-RO') + ' RON' : ''),
        });
      }
    } catch (_e) {}

    // Rendezés — legújabb elöl
    events.sort((x, y) => {
      const ta = x.at ? new Date(x.at).getTime() : 0;
      const tb = y.at ? new Date(y.at).getTime() : 0;
      return tb - ta;
    });

    const counts = { milestone: 0, waybill: 0, fuel: 0, purchase: 0, fuel_card: 0, service: 0 };
    for (const ev of events) { if (counts[ev.type] != null) counts[ev.type]++; }

    // Melyik sofőrök használták az adott jármű időszakát? (a listához + fejlécbe)
    const driverMap = {};
    for (const o of orders) {
      const em = (o.email_sofer || '').toLowerCase();
      if (em) driverMap[em] = o.nume_sofer || em;
    }
    for (const w of waybills) {
      const em = (w.email_sofer || '').toLowerCase();
      if (em && !driverMap[em]) driverMap[em] = w.nume_sofer || em;
    }
    const usedDrivers = Object.keys(driverMap).map((em) => ({ email: em, nume: driverMap[em] }));

    return res.json({ result: {
      ok: true,
      vehicle: {
        rendszam: vehicle.rendszam,
        marca: vehicle.marca, tip: vehicle.tip, an: vehicle.an,
        assigned_driver_email: vehicle.assigned_driver_email,
      },
      orders: orders.map((o) => ({
        id: o.id, fuvar_no: o.fuvar_no, client: o.client,
        loc_incarcare: o.loc_incarcare, loc_descarcare: o.loc_descarcare,
        data_incarcare: o.data_incarcare, status: o.status,
        nume_sofer: o.nume_sofer,
      })),
      used_drivers: usedDrivers,
      events, counts, from, to,
    } });
  } catch (err) {
    console.error('getVehicleActivity hiba:', err && err.stack ? err.stack : err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
