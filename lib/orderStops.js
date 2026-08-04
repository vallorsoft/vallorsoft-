// ============================================================
//  VallorSoft — lib/orderStops.js
//  ------------------------------------------------------------
//  Közös helper az `order_stops` (fuvar több felrakó/lerakó pont)
//  tábla írásához. Használják: handlers/orders.js (comCreate/
//  bulkCreateOrders/comUpdate), routes/inbound-orders.js
//  (/approve), handlers/orderScan.js (AI kiolvasás).
//
//  A stopok mögé egy trigger van beállítva (db/order-stops.sql),
//  ami a `orders.loc_incarcare/loc_descarcare/data_*/firma_*/
//  sosit_*_at/incarcat_at/descarcat_at` mirror-mezőket
//  automatikusan újraszámolja — így a régi kliens/UI változatlan.
// ============================================================

// Egy stop bemeneti alakja: { kind, stop_index?, loc, firma?, data?, ref? }
// arrived_at / done_at / waybilled_at NEM állítható a kliensről itt.
function _cleanStop(s, kind, idx) {
  if (!s || typeof s !== 'object') return null;
  const loc = s.loc != null ? String(s.loc).trim().slice(0, 255) : '';
  const firmaRaw = s.firma != null ? String(s.firma).trim().slice(0, 255) : '';
  const dataRaw = s.data != null ? String(s.data).trim() : '';
  // Teljesen üres sor (loc/firma/data mind üres string/nullish) → kihagy.
  if (!loc && !firmaRaw && !dataRaw) return null;
  const firma = firmaRaw || null;
  let data = s.data || null;
  if (data && typeof data === 'string') {
    // Elfogadunk YYYY-MM-DD vagy ISO datetime formátumot; date-only tárolunk.
    const m = data.match(/^(\d{4}-\d{2}-\d{2})/);
    data = m ? m[1] : null;
  }
  const ref = s.ref != null ? String(s.ref).slice(0, 2000) : null;
  return {
    kind,
    stop_index: Number.isFinite(Number(idx)) ? Number(idx) : 0,
    loc: loc || null,
    firma,
    data,
    ref: ref || null,
  };
}

// Normalizálás: a kliens által küldött o.pickups[] / o.deliveries[] / o.stops[]
// tömbökből egy tiszta { pickups, deliveries } objektum.
// Fallback: ha nincs egyik sem, de van top-szintű loc_incarcare / loc_descarcare,
// azokból generálunk egy pickup#0-t és egy delivery#0-t (visszafelé kompat).
function normalizeStops(o) {
  const pickups = [];
  const deliveries = [];
  const arrPickups = Array.isArray(o.pickups) ? o.pickups : null;
  const arrDeliveries = Array.isArray(o.deliveries) ? o.deliveries : null;
  const arrStops = Array.isArray(o.stops) ? o.stops : null;

  if (arrPickups || arrDeliveries) {
    (arrPickups || []).slice(0, 20).forEach((s, i) => {
      const c = _cleanStop(s, 'pickup', i);
      if (c) { c.stop_index = pickups.length; pickups.push(c); }
    });
    (arrDeliveries || []).slice(0, 20).forEach((s, i) => {
      const c = _cleanStop(s, 'delivery', i);
      if (c) { c.stop_index = deliveries.length; deliveries.push(c); }
    });
  } else if (arrStops) {
    arrStops.slice(0, 40).forEach((s) => {
      const kind = s && s.kind === 'delivery' ? 'delivery' : (s && s.kind === 'pickup' ? 'pickup' : null);
      if (!kind) return;
      const c = _cleanStop(s, kind, 0);
      if (!c) return;
      if (kind === 'pickup') { c.stop_index = pickups.length; pickups.push(c); }
      else { c.stop_index = deliveries.length; deliveries.push(c); }
    });
  }

  // Fallback: legacy egyetlen pickup / delivery a top-szintű mezőkből
  if (pickups.length === 0 && (o.loc_incarcare || o.firma_incarcare || o.data_incarcare)) {
    const c = _cleanStop({
      loc: o.loc_incarcare, firma: o.firma_incarcare, data: o.data_incarcare,
    }, 'pickup', 0);
    if (c) pickups.push(c);
  }
  if (deliveries.length === 0 && (o.loc_descarcare || o.firma_descarcare || o.data_descarcare)) {
    const c = _cleanStop({
      loc: o.loc_descarcare, firma: o.firma_descarcare, data: o.data_descarcare,
    }, 'delivery', 0);
    if (c) deliveries.push(c);
  }
  return { pickups, deliveries };
}

// Ellenőrzi, hogy legalább 1 pickup és 1 delivery van-e a normalizált tömbben.
// Új fuvar létrehozásakor (comCreate/bulkCreate) hívjuk. Update-nél a régi
// viselkedés maradhat (loc_incarcare üres is lehet, ha csak sofőrt cserélünk).
// → { err? } vagy null (ok).
function validateStops(stops, { requireBoth = false } = {}) {
  if (!requireBoth) return null;
  if (!stops.pickups.length && !stops.deliveries.length) return null; // teljesen üres, legacy import-út
  return null; // egyelőre nem kényszerítjük, a UI eldönti
}

// A stopokat TELJES cserével írja: törli a fuvar meglévő stopjait, beszúrja
// az újakat. Igyekszik megőrizni az arrived_at/done_at/waybilled_at értékeket
// az azonos (kind, stop_index) párokra — hogy egy szerkesztés ne törölje el
// a sofőr által rögzített időbélyegeket. A trigger utána szinkronba hozza a
// orders.*_at mirror mezőket.
async function replaceStopsForOrder(db, orderId, companyId, normalized) {
  const { pickups, deliveries } = normalized;
  // Meglévő stopok betöltése az időbélyegek megőrzéséhez
  const prev = await db.query(
    `SELECT id, kind, stop_index, arrived_at, done_at, waybilled_at
       FROM order_stops WHERE order_id = $1 AND company_id = $2`,
    [orderId, companyId]);
  const prevMap = new Map();
  for (const p of prev.rows) prevMap.set(p.kind + ':' + p.stop_index, p);

  await db.query('DELETE FROM order_stops WHERE order_id = $1 AND company_id = $2',
    [orderId, companyId]);

  const all = [...pickups, ...deliveries];
  for (const s of all) {
    const carry = prevMap.get(s.kind + ':' + s.stop_index) || {};
    await db.query(
      `INSERT INTO order_stops
         (order_id, company_id, kind, stop_index, loc, firma, data, ref,
          arrived_at, done_at, waybilled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [orderId, companyId, s.kind, s.stop_index,
       s.loc, s.firma, s.data, s.ref,
       carry.arrived_at || null, carry.done_at || null, carry.waybilled_at || null]);
  }
}

// A top-szintű loc_incarcare/loc_descarcare/data_*/firma_* mezők frissítésekor
// (régi kliens, aki NEM küldi a stops-t) a pickup#0 / delivery#0 stopot
// szinkronizáljuk. Ha még nincs pickup#0 / delivery#0, létrehozzuk. Így a
// régi mezők szerkesztése továbbra is a régi módon működik.
async function syncSingleStopFromTopFields(db, orderId, companyId, o) {
  const upsertOne = async (kind, top) => {
    const existing = await db.query(
      `SELECT id FROM order_stops
        WHERE order_id = $1 AND company_id = $2 AND kind = $3 AND stop_index = 0`,
      [orderId, companyId, kind]);
    if (existing.rows.length) {
      const parts = []; const vals = [];
      let i = 1;
      if (top.loc !== undefined)   { parts.push(`loc = $${i++}`);   vals.push(top.loc); }
      if (top.firma !== undefined) { parts.push(`firma = $${i++}`); vals.push(top.firma); }
      if (top.data !== undefined)  { parts.push(`data = $${i++}`);  vals.push(top.data); }
      if (!parts.length) return;
      parts.push(`updated_at = NOW()`);
      vals.push(existing.rows[0].id);
      await db.query(`UPDATE order_stops SET ${parts.join(', ')} WHERE id = $${i}`, vals);
    } else if (top.loc || top.firma || top.data) {
      await db.query(
        `INSERT INTO order_stops (order_id, company_id, kind, stop_index, loc, firma, data)
         VALUES ($1,$2,$3,0,$4,$5,$6)`,
        [orderId, companyId, kind, top.loc || null, top.firma || null, top.data || null]);
    }
  };

  const pkTop = {};
  if (o.loc_incarcare !== undefined)   pkTop.loc = o.loc_incarcare || null;
  if (o.firma_incarcare !== undefined) pkTop.firma = o.firma_incarcare ? String(o.firma_incarcare).trim().slice(0, 255) : null;
  if (o.data_incarcare !== undefined)  pkTop.data = o.data_incarcare || null;
  if (Object.keys(pkTop).length) await upsertOne('pickup', pkTop);

  const deTop = {};
  if (o.loc_descarcare !== undefined)   deTop.loc = o.loc_descarcare || null;
  if (o.firma_descarcare !== undefined) deTop.firma = o.firma_descarcare ? String(o.firma_descarcare).trim().slice(0, 255) : null;
  if (o.data_descarcare !== undefined)  deTop.data = o.data_descarcare || null;
  if (Object.keys(deTop).length) await upsertOne('delivery', deTop);
}

module.exports = {
  normalizeStops,
  validateStops,
  replaceStopsForOrder,
  syncSingleStopFromTopFields,
};
