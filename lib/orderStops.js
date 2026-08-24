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

// Normalizálás: a kliens által küldött o.stops[] (ORDERED, interleaved) VAGY
// o.pickups[] / o.deliveries[] tömbökből egy tiszta { pickups, deliveries }
// objektum + a globális seq (a bevitel sorrendjét megőrző lista).
//
// Előnyben az `o.stops[]` (ordered) — ez őrzi a felhasználó által beírt
// interleaved sorrendet (pl. 2 felrakó → 5 lerakó → 3 felrakó → 1 lerakó).
// A per-kind `stop_index` mostantól CSAK a kind-en belüli sorszám (0,1,2,…),
// a globális `seq_index` a bevitel sorrendje (0..N-1) — ezt a sofőr felülete
// használja az „ebben a sorrendben jár rá" megjelenítéshez.
//
// Ha nincs egyik sem, de van top-szintű loc_incarcare/loc_descarcare, azokból
// generálunk egy pickup#0 + delivery#0-t (legacy — 1 fel + 1 lerakó fuvar).
function normalizeStops(o) {
  const pickups = [];
  const deliveries = [];
  const seq = []; // globális bevitel-sorrend (interleaved)
  const arrStops = Array.isArray(o.stops) ? o.stops : null;
  const arrPickups = Array.isArray(o.pickups) ? o.pickups : null;
  const arrDeliveries = Array.isArray(o.deliveries) ? o.deliveries : null;

  if (arrStops && arrStops.length) {
    // ── Új út: ordered stops[] — a bevitel sorrendje megőrizve ──
    arrStops.slice(0, 40).forEach((s) => {
      const kind = s && s.kind === 'delivery' ? 'delivery'
                 : s && s.kind === 'pickup'   ? 'pickup'
                 : null;
      if (!kind) return;
      const c = _cleanStop(s, kind, 0);
      if (!c) return;
      if (kind === 'pickup') { c.stop_index = pickups.length; pickups.push(c); }
      else { c.stop_index = deliveries.length; deliveries.push(c); }
      c.seq_index = seq.length;
      seq.push(c);
    });
  } else if (arrPickups || arrDeliveries) {
    // ── Legacy két-tömbös út: pickups először, delivery-k utána ──
    (arrPickups || []).slice(0, 20).forEach((s) => {
      const c = _cleanStop(s, 'pickup', 0);
      if (c) {
        c.stop_index = pickups.length; pickups.push(c);
        c.seq_index = seq.length; seq.push(c);
      }
    });
    (arrDeliveries || []).slice(0, 20).forEach((s) => {
      const c = _cleanStop(s, 'delivery', 0);
      if (c) {
        c.stop_index = deliveries.length; deliveries.push(c);
        c.seq_index = seq.length; seq.push(c);
      }
    });
  }

  // Fallback: legacy egyetlen pickup / delivery a top-szintű mezőkből
  if (pickups.length === 0 && (o.loc_incarcare || o.firma_incarcare || o.data_incarcare)) {
    const c = _cleanStop({
      loc: o.loc_incarcare, firma: o.firma_incarcare, data: o.data_incarcare,
    }, 'pickup', 0);
    if (c) {
      pickups.push(c);
      c.seq_index = seq.length; seq.push(c);
    }
  }
  if (deliveries.length === 0 && (o.loc_descarcare || o.firma_descarcare || o.data_descarcare)) {
    const c = _cleanStop({
      loc: o.loc_descarcare, firma: o.firma_descarcare, data: o.data_descarcare,
    }, 'delivery', 0);
    if (c) {
      deliveries.push(c);
      c.seq_index = seq.length; seq.push(c);
    }
  }
  return { pickups, deliveries, seq };
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
  // A `seq` (globális bevitel-sorrend) elsőbbséget kap; ha nincs (régi hívó
  // fallback), a régi „pickups először, delivery-k utána" sorrendre esünk.
  const all = Array.isArray(normalized.seq) && normalized.seq.length
    ? normalized.seq.slice()
    : [...pickups, ...deliveries];

  // Meglévő stopok betöltése az időbélyegek megőrzéséhez (kind + stop_index kulcson).
  const prev = await db.query(
    `SELECT id, kind, stop_index, arrived_at, done_at, waybilled_at
       FROM order_stops WHERE order_id = $1 AND company_id = $2`,
    [orderId, companyId]);
  const prevMap = new Map();
  for (const p of prev.rows) prevMap.set(p.kind + ':' + p.stop_index, p);

  await db.query('DELETE FROM order_stops WHERE order_id = $1 AND company_id = $2',
    [orderId, companyId]);

  for (let i = 0; i < all.length; i++) {
    const s = all[i];
    const carry = prevMap.get(s.kind + ':' + s.stop_index) || {};
    const seq = Number.isFinite(Number(s.seq_index)) ? Number(s.seq_index) : i;
    await db.query(
      `INSERT INTO order_stops
         (order_id, company_id, kind, stop_index, seq_index, loc, firma, data, ref,
          arrived_at, done_at, waybilled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [orderId, companyId, s.kind, s.stop_index, seq,
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
      // Új stop egyedül a top-mezőkből — a seq_index a fuvaron belüli MAX + 1
      // (ne ütközzön a többivel). A stop_index=0 mert `WHERE stop_index=0`
      // fentebb üres volt (nincs kind-en belüli felrakó/lerakó).
      const maxSeq = await db.query(
        `SELECT COALESCE(MAX(seq_index), -1) AS m FROM order_stops
          WHERE order_id = $1 AND company_id = $2`,
        [orderId, companyId]);
      const nextSeq = (maxSeq.rows[0] && Number(maxSeq.rows[0].m) >= 0)
        ? Number(maxSeq.rows[0].m) + 1 : 0;
      await db.query(
        `INSERT INTO order_stops (order_id, company_id, kind, stop_index, seq_index, loc, firma, data)
         VALUES ($1,$2,$3,0,$4,$5,$6,$7)`,
        [orderId, companyId, kind, nextSeq, top.loc || null, top.firma || null, top.data || null]);
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
