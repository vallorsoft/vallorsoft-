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

    // Fuvarok listája a szűrő-legördülőhöz + timeline-fő-események
    // (a fuvar-ellenőrzés cégre + sofőrre + Anulat kizárás + időszak szerint)
    const ordersR = await pool.query(
      `SELECT id, fuvar_no, client, loc_incarcare, loc_descarcare,
              data_incarcare, data_descarcare, status,
              sosit_incarcare_at, incarcat_at, sosit_descarcare_at, descarcat_at,
              handover_status, handover_at, handover_location
         FROM orders
        WHERE company_id = $1
          AND LOWER(email_sofer) = $2
          AND status <> 'Anulat'
          AND (
            ($3::text IS NOT NULL AND id = $3)
            OR ($3::text IS NULL
                AND COALESCE(data_incarcare, created_at::date) >= $4::date
                AND COALESCE(data_incarcare, created_at::date) <= $5::date)
          )
        ORDER BY COALESCE(data_incarcare, created_at::date) DESC, id DESC
        LIMIT 200`,
      [cid, email, orderId, from, to]
    );
    const orders = ordersR.rows;
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

    // B) Menetlevél-beküldések + a benne lévő tankolás/vásárlás/puncte sorok külön eseményként
    //    A menetlevél maga = 1 fő esemény; a sorok külön kis események a saját dátumukon.
    const wbWhere = orderIds.length
      ? `WHERE company_id=$1 AND LOWER(email_sofer)=$2
           AND (order_ids ?| $3 OR ($3::text[] IS NULL))`
      : `WHERE company_id=$1 AND LOWER(email_sofer)=$2
           AND COALESCE(erkezes_dt, indulas_dt, data_completare) >= $4::date
           AND COALESCE(erkezes_dt, indulas_dt, data_completare) < ($5::date + 1)`;
    const wbParams = orderIds.length
      ? [cid, email, orderIds]
      : [cid, email, null, from, to];

    let wbR = { rows: [] };
    try {
      wbR = await pool.query(
        `SELECT id, data_completare, erkezes_dt, indulas_dt, numar_camion, numar_remorca,
                total_km, alte_mentiuni, alimentari, achizitii, puncte, order_ids
           FROM fuvarlevelek
          ${wbWhere}
          ORDER BY COALESCE(erkezes_dt, indulas_dt, data_completare) DESC
          LIMIT 200`,
        wbParams
      );
    } catch (_e) {
      // Régi séma-eltérés best-effort: üres lista.
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
    let dR = { rows: [] };
    try {
      const dParams = orderIds.length
        ? [cid, email, orderIds]
        : [cid, email, null, from, to];
      const dWhere = orderIds.length
        ? `WHERE company_id=$1 AND LOWER(email_sofer)=$2 AND (order_id = ANY($3))`
        : `WHERE company_id=$1 AND LOWER(email_sofer)=$2
             AND created_at >= $4::date AND created_at < ($5::date + 1)`;
      dR = await pool.query(
        `SELECT id, tip, file_name, order_id, created_at
           FROM documents ${dWhere}
          ORDER BY created_at DESC
          LIMIT 300`,
        dParams
      );
    } catch (_e) { dR = { rows: [] }; }

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
    const counts = { milestone: 0, waybill: 0, fuel: 0, purchase: 0, photo: 0, uit: 0, border: 0, bug: 0 };
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
    console.error('getDriverActivity hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
