// ============================================================
//  VallorSoft — Fuvar gyors-státusz REST route-ok
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { sendPushToRole } = require('../services/push');

// ── Idő-bemenet validálás a driver-milestone / stop-event / border-cross
// végpontokhoz. A sofőr az idő-picker modalban jóváhagyja/szerkeszti a
// mostani időt; utólag pótolhatja is, ha lekésett a gombbal. Csak józan
// ész-korlátot kényszerítünk: parse-olható ISO és max ~7 nap múlt (a
// jövőt kicsit engedjük, hogy a kliens-órák pár másodperces „jövője"
// ne bukjon el). Ha `at` nincs vagy érvénytelen, NULL-t adunk vissza,
// és a hívó a régi `NOW()`-ra esik vissza.
const MAX_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;   // 7 nap
const MAX_FUTURE_MS   = 2 * 60 * 1000;             // 2 perc előrenéző türelem
function parseAtInput(at) {
  if (at === undefined || at === null || at === '') return null;
  const s = String(at);
  const d = new Date(s);
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  const now = Date.now();
  const t = d.getTime();
  if (t > now + MAX_FUTURE_MS) return null;
  if (t < now - MAX_BACKDATE_MS) return null;
  return d.toISOString();
}

router.post('/api/orders/:id/quick-status', requireLogin, requireRole('Admin','Manager'), async (req, res) => {
  const { status } = req.body;
  // Ugyanaz a státusz-halmaz, mint a comUpdate-ben (a lista dropdownja
  // Parkolt/Raktarban-t is kínál — különben „Status invalid" hibát adna).
  const valid = ['Disponibil','Alocat','Extern','In Curs','Finalizat','Anulat','Parkolt','Raktarban'];
  if (!valid.includes(status)) return res.json({ ok: false, err: 'Status invalid' });
  try {
    // Anulált fuvar zárolása: a státusza nem változtatható (nem támasztható fel).
    const cur = await pool.query(
      'SELECT status FROM orders WHERE id=$1 AND company_id=$2',
      [req.params.id, req.session.user.company_id]
    );
    if (cur.rowCount === 0) return res.json({ ok: false, err: 'Cursa nu a fost gasita' });
    if (cur.rows[0].status === 'Anulat') {
      return res.json({ ok: false, err: 'Transportul este anulat și nu mai poate fi modificat.' });
    }
    const r = await pool.query(
      "UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2 AND company_id=$3 AND status <> 'Anulat'",
      [status, req.params.id, req.session.user.company_id]
    );
    if (r.rowCount === 0) return res.json({ ok: false, err: 'Cursa nu a fost gasita' });
    // Ha a státusz elhagyja a Raktarban-t, az aktív raktári tétel kiadva —
    // ne ragadjon bent a Raktár fülön (mint a comUpdate-ben).
    if (status !== 'Raktarban') {
      await pool.query(
        `UPDATE warehouse_items SET status='Kiadva', released_at=NOW()
         WHERE company_id=$1 AND order_id=$2 AND status='Raktarban'`,
        [req.session.user.company_id, req.params.id]
      ).catch((e) => console.error('warehouse release hiba:', e));
    }
    return res.json({ ok: true });
  } catch(err) {
    console.error('quick-status hiba:', err);
    return res.json({ ok: false, err: 'Eroare de server' });
  }
});

// ── Sofőr státusz frissítés + push visszajelzés ───────────
//  POST /api/orders/:id/driver-status
//  Csak Sofőr role — csak 'In Curs' vagy 'Finalizat'
// ============================================================
router.post('/api/orders/:id/driver-status', requireLogin, requireRole('Sofer'), async (req, res) => {
  const { status } = req.body;
  const driver = req.session.user;
  if (!['In Curs', 'Finalizat'].includes(status)) {
    return res.json({ ok: false, err: 'Status invalid' });
  }
  try {
    const check = await pool.query(
      `SELECT id, client FROM orders
       WHERE id = $1 AND company_id = $2 AND LOWER(email_sofer) = LOWER($3)`,
      [req.params.id, driver.company_id, driver.email]
    );
    if (!check.rows.length) {
      return res.json({ ok: false, err: 'Nu a fost gasit sau nu aveti permisiune' });
    }
    await pool.query(
      'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, req.params.id]
    );
    // Push értesítés a Manager / Admin szerepkörűeknek
    const label = status === 'In Curs' ? 'a acceptat / elfogadta' : 'a finalizat / teljesítette';
    const clientName = check.rows[0].client || ('#' + req.params.id);
    try {
      const { getTemplate, applyVars } = require('../lib/pushTemplates');
      const stpl = await getTemplate('push_order_status');
      const vars = { sofor: driver.nume || driver.email, label, client: clientName };
      await sendPushToRole(driver.company_id, ['Manager', 'Admin'], {
        title: (stpl.title_ro || '🚛 Status cursă actualizat') + ' / ' + (stpl.title_hu || 'Fuvar státusz frissítve'),
        body: applyVars(stpl.body_ro || '{{sofor}} {{label}}: {{client}}', vars),
        icon: '/icon192.png', badge: '/icon192.png',
        tag: 'order-status-' + req.params.id, url: '/manager',
      });
    } catch (_) {
      await sendPushToRole(driver.company_id, ['Manager', 'Admin'], {
        title: '🚛 Status cursă actualizat / Fuvar státusz frissítve',
        body: (driver.nume || driver.email) + ' ' + label + ': ' + clientName,
        icon: '/icon192.png', badge: '/icon192.png',
        tag: 'order-status-' + req.params.id, url: '/manager',
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('driver-status hiba:', err);
    return res.json({ ok: false, err: 'Eroare de server' });
  }
});

// ============================================================
//  POST /api/orders/:id/driver-milestone
//  Csak Sofőr — a fuvar 4 állomását EGY gomb lépteti; a szerver
//  határozza meg a KÖVETKEZŐ (még üres) állomást (nem lehet kihagyni /
//  visszajátszani), időbélyeget ír, és értesíti az irodát.
//    1. sosit_incarcare_at  (megérkezett a felrakóhoz)  → status In Curs
//    2. incarcat_at         (felrakodott)
//    3. sosit_descarcare_at (megérkezett a lerakóhoz)
//    4. descarcat_at        (leürített)                  → status Finalizat
// ============================================================
const MILESTONE_STEPS = [
  { col: 'sosit_incarcare_at',  key: 'arriveLoad',   ro: 'a sosit la încărcare',   hu: 'megérkezett a felrakóhoz' },
  { col: 'incarcat_at',         key: 'loaded',       ro: 'a încărcat',             hu: 'felrakodott' },
  { col: 'sosit_descarcare_at', key: 'arriveUnload', ro: 'a sosit la descărcare',  hu: 'megérkezett a lerakóhoz' },
  { col: 'descarcat_at',        key: 'unloaded',     ro: 'a descărcat',            hu: 'leürített' },
];
router.post('/api/orders/:id/driver-milestone', requireLogin, requireRole('Sofer'), async (req, res) => {
  const driver = req.session.user;
  // Opcionális `at` (ISO): a sofőr az idő-picker modalban jóváhagyja/
  // szerkeszti az időpontot; ha nem küld, `NOW()`-t használunk.
  const eventAt = parseAtInput(req.body && req.body.at);
  try {
    const check = await pool.query(
      `SELECT id, client, status, sosit_incarcare_at, incarcat_at, sosit_descarcare_at, descarcat_at
         FROM orders
        WHERE id = $1 AND company_id = $2 AND LOWER(email_sofer) = LOWER($3)`,
      [req.params.id, driver.company_id, driver.email]
    );
    if (!check.rows.length) {
      return res.json({ ok: false, err: 'Nu a fost gasit sau nu aveti permisiune' });
    }
    const row = check.rows[0];
    if (['Finalizat', 'Anulat', 'Parkolt', 'Raktarban'].includes(row.status)) {
      return res.json({ ok: false, err: 'Status invalid' });
    }
    // Multi-stop út: ha van legalább EGY order_stops-sor a fuvarhoz, azon a
    // per-stop nyilvántartáson lépünk (sorrend: pickup#0 arrive → done → …
    // → minden delivery arrive/done, tetszőleges sorrendben). Ha NINCS stop
    // (nem-migrált / mock-elt fuvar), a régi 4-lépéses viselkedésre esünk
    // vissza — ekkor a fenti SELECT-ből olvasott milestone mezőkből döntünk.
    let hasStops = false;
    try {
      const st = await pool.query(
        `SELECT id, kind, stop_index, arrived_at, done_at
           FROM order_stops
          WHERE order_id = $1 AND company_id = $2
          ORDER BY (kind = 'pickup') DESC, stop_index ASC`,
        [req.params.id, driver.company_id]);
      hasStops = st.rows.length > 0;
      if (hasStops) {
        const stops = st.rows;
        const pickups = stops.filter((s) => s.kind === 'pickup');
        const deliveries = stops.filter((s) => s.kind === 'delivery');
        const allPickupsDone = pickups.every((p) => p.done_at);
        const cand = allPickupsDone ? [...pickups, ...deliveries] : pickups;
        let nextStop = null; let nextEvent = null;
        for (const s of cand) {
          if (!s.arrived_at) { nextStop = s; nextEvent = 'arrive'; break; }
          if (!s.done_at)    { nextStop = s; nextEvent = 'done';   break; }
        }
        if (!nextStop) {
          for (const s of deliveries) {
            if (!s.arrived_at) { nextStop = s; nextEvent = 'arrive'; break; }
            if (!s.done_at)    { nextStop = s; nextEvent = 'done';   break; }
          }
        }
        if (!nextStop) return res.json({ ok: false, err: 'Toate etapele au fost deja înregistrate.' });
        return _applyStopEvent(req, res, driver, row, nextStop, nextEvent, eventAt);
      }
    } catch (_stopsErr) { hasStops = false; /* fallback a legacy útra */ }

    // ─── Legacy 4-lépéses fallback (nincs stops-tábla / nincs stop) ───
    const idx = MILESTONE_STEPS.findIndex((s) => !row[s.col]);
    if (idx === -1) return res.json({ ok: false, err: 'Toate etapele au fost deja înregistrate.' });
    const step = MILESTONE_STEPS[idx];
    const isFirst = idx === 0;
    const isLast = idx === MILESTONE_STEPS.length - 1;
    let setStatus = '';
    if (isFirst && ['Disponibil', 'Alocat', 'Extern'].includes(row.status)) setStatus = ", status = 'In Curs'";
    if (isLast) setStatus = ", status = 'Finalizat'";
    // Ha a sofőr utólag pótolja, a `eventAt`-ot írjuk NOW() helyett.
    const tsExpr = eventAt ? `$2::timestamptz` : 'NOW()';
    const params = eventAt ? [req.params.id, eventAt] : [req.params.id];
    await pool.query(
      `UPDATE orders SET ${step.col} = ${tsExpr}${setStatus}, updated_at = NOW() WHERE id = $1`,
      params
    );
    const clientName = row.client || ('#' + req.params.id);
    try {
      await sendPushToRole(driver.company_id, ['Manager', 'Admin'], {
        title: '🚚 ' + step.ro + ' / ' + step.hu,
        body: (driver.nume || driver.email) + ' — ' + clientName,
        icon: '/icon192.png', badge: '/icon192.png',
        tag: 'order-milestone-' + req.params.id, url: '/manager',
      });
    } catch (_) { /* best-effort */ }
    return res.json({ ok: true, step: step.key, finalized: isLast });
  } catch (err) {
    console.error('driver-milestone hiba:', err);
    return res.json({ ok: false, err: 'Eroare de server' });
  }
});

// ============================================================
//  POST /api/orders/:id/stop-event
//  Csak Sofőr — egy KONKRÉT stopon léptet (arrive vagy done).
//  Body: { stopId: <bigint>, event: 'arrive'|'done' }
//  Több lerakási pontnál a sofőr a felugró ablakban választja ki,
//  hogy melyik lerakóra érkezett; a kliens ezt hívja a régi
//  driver-milestone helyett. A régi végpont továbbra is működik
//  (visszafelé kompat; a szerver auto-választja a következő stopot).
// ============================================================
router.post('/api/orders/:id/stop-event', requireLogin, requireRole('Sofer'), async (req, res) => {
  const driver = req.session.user;
  const { stopId, event } = req.body || {};
  if (!stopId || !['arrive', 'done'].includes(event)) {
    return res.json({ ok: false, err: 'Parametri invalizi' });
  }
  // Opcionális `at` — a sofőr az idő-picker modalban jóváhagyja/szerkeszti;
  // ha érvénytelen vagy hiányzik, NOW()-t használunk.
  const eventAt = parseAtInput(req.body && req.body.at);
  try {
    const check = await pool.query(
      `SELECT id, client, status FROM orders
        WHERE id = $1 AND company_id = $2 AND LOWER(email_sofer) = LOWER($3)`,
      [req.params.id, driver.company_id, driver.email]);
    if (!check.rows.length) return res.json({ ok: false, err: 'Nu a fost gasit sau nu aveti permisiune' });
    const row = check.rows[0];
    if (['Anulat'].includes(row.status)) return res.json({ ok: false, err: 'Status invalid' });

    const sq = await pool.query(
      `SELECT id, kind, stop_index, arrived_at, done_at FROM order_stops
        WHERE id = $1 AND order_id = $2 AND company_id = $3`,
      [stopId, req.params.id, driver.company_id]);
    if (!sq.rows.length) return res.json({ ok: false, err: 'Stop invalid' });
    return _applyStopEvent(req, res, driver, row, sq.rows[0], event, eventAt);
  } catch (err) {
    console.error('stop-event hiba:', err);
    return res.json({ ok: false, err: 'Eroare de server' });
  }
});

// Egy adott stopra egy eseményt (arrive|done) rögzít, státuszt lép + push-ol.
// Szigorúan sorrend: 'done' csak akkor, ha az 'arrive' már megvolt.
// Egy pickup arrive-nál Disponibil/Alocat/Extern → In Curs.
// Minden delivery.done → Finalizat (státusz + orders.finalized_at trigger).
// `eventAt` (ISO) opcionális — az idő-picker modalból; ha null, NOW()-t
// használunk (parseAtInput már validált, ezért itt bátran beemelhetjük).
async function _applyStopEvent(req, res, driver, order, stop, event, eventAt) {
  try {
    if (event === 'done' && !stop.arrived_at) {
      return res.json({ ok: false, err: 'Trebuie mai întâi să confirmi sosirea (arrive).' });
    }
    if (event === 'arrive' && stop.arrived_at) {
      return res.json({ ok: false, err: 'Deja înregistrat (arrive).' });
    }
    if (event === 'done' && stop.done_at) {
      return res.json({ ok: false, err: 'Deja înregistrat (done).' });
    }

    // Az esemény rögzítése (a trigger frissíti a orders.*_at mirror mezőket)
    const col = event === 'arrive' ? 'arrived_at' : 'done_at';
    if (eventAt) {
      await pool.query(
        `UPDATE order_stops SET ${col} = $1::timestamptz, updated_at = NOW() WHERE id = $2`,
        [eventAt, stop.id]);
    } else {
      await pool.query(
        `UPDATE order_stops SET ${col} = NOW(), updated_at = NOW() WHERE id = $1`,
        [stop.id]);
    }

    // Státusz-léptetés a fuvaron
    // - első pickup arrive esetén: Disponibil/Alocat/Extern → In Curs
    // - ÖSSZES delivery done után: → Finalizat (és rendezni a többi mezőt)
    let statusUpdate = '';
    if (event === 'arrive' && stop.kind === 'pickup' &&
        ['Disponibil','Alocat','Extern'].includes(order.status)) {
      statusUpdate = "status = 'In Curs', ";
    }
    const anyDeliveryOpen = await pool.query(
      `SELECT 1 FROM order_stops
        WHERE order_id = $1 AND kind = 'delivery' AND done_at IS NULL LIMIT 1`,
      [order.id]);
    if (event === 'done' && stop.kind === 'delivery' && anyDeliveryOpen.rowCount === 0) {
      statusUpdate = "status = 'Finalizat', ";
    }
    if (statusUpdate) {
      await pool.query(
        `UPDATE orders SET ${statusUpdate.slice(0, -2)}, updated_at = NOW() WHERE id = $1`,
        [order.id]);
    }

    // Push az irodának (best-effort)
    const clientName = order.client || ('#' + order.id);
    const kindRo = stop.kind === 'pickup' ? 'încărcare' : 'descărcare';
    const eventRo = event === 'arrive' ? 'a sosit la ' + kindRo : (stop.kind === 'pickup' ? 'a încărcat' : 'a descărcat');
    try {
      await sendPushToRole(driver.company_id, ['Manager', 'Admin'], {
        title: '🚚 ' + eventRo,
        body: (driver.nume || driver.email) + ' — ' + clientName + ' (' + (stop.stop_index + 1) + ')',
        icon: '/icon192.png', badge: '/icon192.png',
        tag: 'order-stop-' + order.id + '-' + stop.id + '-' + event, url: '/manager',
      });
    } catch (_) { /* best-effort */ }

    const finalized = event === 'done' && stop.kind === 'delivery' && anyDeliveryOpen.rowCount === 0;
    return res.json({ ok: true, stop_id: stop.id, kind: stop.kind, stop_index: stop.stop_index,
      event, finalized });
  } catch (err) {
    console.error('_applyStopEvent hiba:', err);
    return res.json({ ok: false, err: 'Eroare de server' });
  }
}

// ============================================================
//  POST /api/orders/:id/stop-edit
//  Csak Sofőr — egy KONKRÉT stop MÁR RÖGZÍTETT időbélyegét (arrived_at
//  vagy done_at) UTÓLAG módosítja (a fuvar-kártyáról egy kis ✏️ gomb).
//  A `stop-event` a KÖVETKEZŐ üres mérföldkövet állítja (sorrend-kényszer),
//  ez viszont IDŐ-KORREKCIÓ: ha a sofőr félrenyomott vagy lekésett a
//  rögzítéssel, itt szabadon átírhatja. A UPDATE ownership + tenant-védett,
//  a bemenetet a közös `parseAtInput` validálja (max 7 nap múlt, +2 perc
//  jövő). Body: { stopId, field: 'arrived_at'|'done_at', at: ISO }.
//  Ha `at` üres/érvénytelen → a szerver NEM töröl (kell explicit; a jelen
//  bevezetés csak felülírás).
// ============================================================
router.post('/api/orders/:id/stop-edit', requireLogin, requireRole('Sofer'), async (req, res) => {
  const driver = req.session.user;
  const { stopId, field } = req.body || {};
  if (!stopId || !['arrived_at', 'done_at'].includes(field)) {
    return res.json({ ok: false, err: 'Parametri invalizi' });
  }
  const eventAt = parseAtInput(req.body && req.body.at);
  if (!eventAt) return res.json({ ok: false, err: 'Timp invalid' });
  try {
    const check = await pool.query(
      `SELECT id, client, status FROM orders
        WHERE id = $1 AND company_id = $2 AND LOWER(email_sofer) = LOWER($3)`,
      [req.params.id, driver.company_id, driver.email]);
    if (!check.rows.length) return res.json({ ok: false, err: 'Nu a fost gasit sau nu aveti permisiune' });
    if (check.rows[0].status === 'Anulat') return res.json({ ok: false, err: 'Status invalid' });

    const sq = await pool.query(
      `SELECT id, kind, stop_index, arrived_at, done_at FROM order_stops
        WHERE id = $1 AND order_id = $2 AND company_id = $3`,
      [stopId, req.params.id, driver.company_id]);
    if (!sq.rows.length) return res.json({ ok: false, err: 'Stop invalid' });
    const stop = sq.rows[0];

    // Konzisztencia: done_at csak akkor, ha arrived_at is set.
    // Ha `done_at`-et javítunk és arrived_at NULL → arrived_at-et is at-re
    // (ne maradjon „done arrive nélkül"). Ha `arrived_at`-et NAGYOBB értékre
    // javítjuk mint a done_at → done_at-et is odaléptetjük.
    const updates = [];
    const values = [];
    let idx = 1;
    updates.push(`${field} = $${idx++}::timestamptz`);
    values.push(eventAt);
    if (field === 'done_at' && !stop.arrived_at) {
      updates.push(`arrived_at = $${idx++}::timestamptz`);
      values.push(eventAt);
    }
    if (field === 'arrived_at' && stop.done_at &&
        new Date(eventAt).getTime() > new Date(stop.done_at).getTime()) {
      updates.push(`done_at = $${idx++}::timestamptz`);
      values.push(eventAt);
    }
    updates.push(`updated_at = NOW()`);
    values.push(stop.id);
    await pool.query(
      `UPDATE order_stops SET ${updates.join(', ')} WHERE id = $${idx}`,
      values);

    // Push az irodának (best-effort) — csendes „idő javítva" értesítés
    const clientName = check.rows[0].client || ('#' + req.params.id);
    const kindRo = stop.kind === 'pickup' ? 'încărcare' : 'descărcare';
    const fieldRo = field === 'arrived_at' ? 'sosire' : (stop.kind === 'pickup' ? 'încărcat' : 'descărcat');
    try {
      await sendPushToRole(driver.company_id, ['Manager', 'Admin'], {
        title: '✏️ Marcaj corectat (' + fieldRo + ')',
        body: (driver.nume || driver.email) + ' — ' + clientName + ' · ' + kindRo + ' #' + (stop.stop_index + 1),
        icon: '/icon192.png', badge: '/icon192.png',
        tag: 'order-stop-edit-' + req.params.id + '-' + stop.id + '-' + field, url: '/manager',
      });
    } catch (_) { /* best-effort */ }
    return res.json({ ok: true, stop_id: stop.id, field, at: eventAt });
  } catch (err) {
    console.error('stop-edit hiba:', err);
    return res.json({ ok: false, err: 'Eroare de server' });
  }
});

module.exports = router;
