// ============================================================
//  VallorSoft — handlers/orderChat.js
//  💬 Szöveges fuvarkiírás (AI-chat).
//
//  A diszpécser szabad szöveggel leírja a fuvart (pl. „felrakó Bilka Steel,
//  Brassó, full áru, 2 lerakó: HU Bicske …, SK Kassa …, hétfőn felvesszük,
//  kedden/szerdán szállítjuk, sofőr X + a hozzá tartozó autó"). Az AI egy
//  fuvar-VÁZLATOT állít össze, amit a SZERVER feloldja a cég saját adataira
//  (ügyfél / sofőr / jármű / pótkocsi), és ami nem egyértelmű, arra
//  kattintható válaszos kérdést tesz fel. A javítás is a chatben történik.
//  Mentés: `orderChatCreate` → a MEGLÉVŐ `comCreate` (nincs párhuzamos
//  fuvar-logika).
//
//  ADATVÉDELEM: az AI-hoz CSAK a beszélgetés szövege + az előző vázlat megy
//  (+ a mai dátum). A cég sofőr-/jármű-/ügyfél-listája NEM kerül az AI-hoz —
//  a nevek feloldása kizárólag a szerveren, `company_id`-szűrt, paraméteres
//  lekérdezésekkel történik. A kliensről visszaküldött vázlatot minden
//  körben újra ellenőrizzük (client_id / sofőr / rendszám tulajdon-ellenőrzés).
//
//  ÜGYFÉL CUI-VAL: ha a megrendelőhöz CUI-t ír a diszpécser, és ilyen CUI-jű
//  ügyfél még nincs, ANAF-lekérdezéssel a teljes cégadat bekerül és MENTŐDIK
//  az ügyfél-listába (`clients`), majd a fuvar ehhez az ügyfélhez kötődik.
//
//  Kapuk: Admin|Manager + `ai-szoveges-fuvar` csomag-flag (Pro csomagtól).
//  Audit: CSAK metaadat (kör-szám, kész-e) — a beszélgetés szövege sosem.
// ============================================================
'use strict';

const pool = require('../db');
const { extractJson } = require('../lib/geminiJson');
const { featureEnabled } = require('../lib/featureEnabled');
const { normalizePlate } = require('../lib/plate');
const clientsSvc = require('../services/clients');
const audit = require('../lib/audit');
const orderHandlers = require('./orders');

const handlers = {};
const FEATURE = 'ai-szoveges-fuvar';
const TZ = 'Europe/Bucharest';
const MAX_MSGS = 30;
const MAX_MSG_LEN = 2000;
const MAX_STOPS = 20;

// ─── Kis segédek ─────────────────────────────────────────────
// Szerver-oldali chat-kérdések a felület nyelvén (RO-alap + HU).
const QT = {
  anafNotFound: { ro: 'CUI {c} nu a fost găsit la ANAF. Verifică CUI-ul sau scrie numele beneficiarului.', hu: 'A(z) {c} CUI nem található az ANAF-nál. Ellenőrizd, vagy írd be a megrendelő nevét.' },
  clientMulti:  { ro: 'Mai mulți clienți corespund: „{c}". Care este?', hu: 'Több ügyfél is illik erre: „{c}". Melyik?' },
  clientAsk:    { ro: 'Cine este beneficiarul (clientul care plătește)? Poți scrie și CUI-ul — îl caut la ANAF și îl salvez.', hu: 'Ki a megrendelő (aki fizet)? CUI-t is írhatsz — lekérem az ANAF-tól és elmentem.' },
  driverMulti:  { ro: 'Mai mulți șoferi corespund: „{c}". Care?', hu: 'Több sofőr is illik erre: „{c}". Melyik?' },
  driverNone:   { ro: 'Nu găsesc șoferul „{c}" printre șoferii interni. Verifică numele sau scrie „fără șofer".', hu: 'Nem találom „{c}" nevű belső sofőrt. Ellenőrizd a nevet, vagy írd: „sofőr nélkül".' },
  truckNone:    { ro: 'Nu găsesc tractorul {c} în flotă.', hu: 'A(z) {c} vontató nincs a flottában.' },
  trailerNone:  { ro: 'Nu găsesc remorca {c} în flotă.', hu: 'A(z) {c} pótkocsi nincs a flottában.' },
};
function qt(lang, key, c) {
  const e = QT[key] || {};
  return String(e[lang === 'hu' ? 'hu' : 'ro'] || e.ro || '').replace('{c}', c == null ? '' : String(c));
}

const _str = (v, max) => (v == null ? null : (String(v).trim().slice(0, max) || null));
const _num = (v) => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const _int = (v) => { const n = _num(v); return n == null ? null : Math.round(n); };
// Ékezet-, kisbetű- és írásjel-független összehasonlító forma.
function _fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
// 'YYYY-MM-DD' vagy 'YYYY-MM-DDTHH:mm' (valós naptári dátum), különben null.
function _date(v) {
  const s = String(v || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  if (m[4] != null && (+m[4] > 23 || +m[5] > 59)) return m[1] + '-' + m[2] + '-' + m[3];
  return m[1] + '-' + m[2] + '-' + m[3] + (m[4] != null ? 'T' + m[4] + ':' + m[5] : '');
}

// Mai dátum Bukarest szerint + a hét napja (a „hétfő/kedd" feloldásához).
function _today(now) {
  const d = now || new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' }).format(d);
  return { ymd, weekday: wd };
}

// ─── Vázlat-tisztítás (AI-ból VAGY a kliensről jövő, megbízhatatlan) ───
function sanitizeDraft(d) {
  const j = (d && typeof d === 'object') ? d : {};
  const stops = (Array.isArray(j.stops) ? j.stops : []).slice(0, MAX_STOPS).map((s) => {
    const kind = s && s.kind === 'delivery' ? 'delivery' : (s && s.kind === 'pickup' ? 'pickup' : null);
    if (!kind) return null;
    const st = { kind, loc: _str(s.loc, 200), firma: _str(s.firma, 200), data: _date(s.data) };
    return (st.loc || st.firma || st.data) ? st : null;
  }).filter(Boolean);
  const lt = String(j.load_type || '').toUpperCase();
  const plate = (v) => { const p = normalizePlate(v || ''); return p ? p.slice(0, 15) : null; };
  return {
    client: _str(j.client, 200),
    client_cui: _str(j.client_cui, 20),
    client_id: _int(j.client_id),
    ref: _str(j.ref, 120),
    stops,
    load_type: ['FTL', 'LTL'].includes(lt) ? lt : null,
    suly_kg: _num(j.suly_kg),
    hossz_cm: _int(j.hossz_cm),
    szel_cm: _int(j.szel_cm),
    mag_cm: _int(j.mag_cm),
    pret: _num(j.pret),
    km: _int(j.km),
    driver_name: _str(j.driver_name, 120),
    email_sofer: _str(j.email_sofer, 200),
    nume_sofer: _str(j.nume_sofer, 120),
    rendszam_camion: plate(j.rendszam_camion),
    rendszam_remorca: plate(j.rendszam_remorca),
    route_sig: _str(j.route_sig, 2000),
    route_km: _int(j.route_km),
    route_geo: (j.route_geo && typeof j.route_geo === 'object') ? j.route_geo : null,
  };
}

// ─── AI-prompt ───────────────────────────────────────────────
function buildSystemPrompt(today) {
  return [
    'You are a freight-dispatch assistant inside a Romanian/Hungarian TMS. The dispatcher describes ONE road-freight order in free text (Hungarian or Romanian, often informal, no accents).',
    'Your job: maintain a structured DRAFT of that order across the conversation. Merge every new message into the previous draft (given below). Keep previous values unless the user changes or removes them. Corrections like "the second unloading is Thursday" or "not FTL, LTL 3 pallets" must update only the affected fields.',
    'TODAY is ' + today.ymd + ' (' + today.weekday + '). Resolve relative dates: a weekday name means the NEXT occurrence of that weekday after today (if today is that weekday, use today only if the user says "today"/"ma"/"azi"); "holnap"/"mâine" = tomorrow. Output dates as YYYY-MM-DD, add THH:mm only if a time is given.',
    'Stops: an ordered list in the order the truck visits them. kind="pickup" (felrakó/felrakás/încărcare) or kind="delivery" (lerakó/lerakás/descărcare). loc = city/address with country code if given (e.g. "Bicske, HU", "Košice, SK", "Brașov, RO"); firma = company name at that stop. "full áru"/"komplett"/"FTL"/"marfă completă" → load_type "FTL"; részrakomány/grupaj/LTL → "LTL".',
    'Client (megrendelő / beneficiar) is the company that ORDERS and PAYS — it is NOT automatically the loading company. Only fill "client" if the user states it (or says the loader is the client). If the user writes a Romanian CUI/CIF (digits, maybe with RO prefix) for the client, put it in client_cui.',
    'Driver: put the driver name exactly as written into driver_name. If the user says "his/her truck" / "hozzá tartozó autó" / "a lui", leave the plates empty (the system pairs them). Plates only if explicitly written.',
    'Never invent data. Unknown fields = null. Do not ask about fields the system can derive (km, plates of the assigned truck).',
    'Return ONLY JSON with this shape:',
    '{"reply": "1-2 short sentences to the dispatcher in THEIR language (Hungarian or Romanian), confirming what changed",',
    ' "draft": {"client": null, "client_cui": null, "ref": null, "stops": [{"kind": "pickup", "loc": null, "firma": null, "data": null}], "load_type": null, "suly_kg": null, "hossz_cm": null, "szel_cm": null, "mag_cm": null, "pret": null, "km": null, "driver_name": null, "rendszam_camion": null, "rendszam_remorca": null},',
    ' "questions": [{"key": "client|stops|dates|load_type|dims|driver|price|other", "text": "short question in the user language", "options": ["up to 4 short clickable answers"]}]}',
    'Ask at most 3 questions, only about genuinely missing or ambiguous REQUIRED data: client, stop location, stop date, FTL/LTL, LTL dimensions. Price is optional: never ask about it more than once. If nothing is missing, "questions" must be [].',
  ].join('\n');
}

// A beszélgetés szövegként (a geminiJson egyetlen user-turnt küld).
function buildConversation(messages, draft) {
  const lines = ['PREVIOUS DRAFT (JSON):', JSON.stringify(_aiView(draft)), '', 'CONVERSATION:'];
  messages.forEach((m) => {
    lines.push((m.role === 'assistant' ? 'ASSISTANT: ' : 'DISPATCHER: ') + m.text);
  });
  lines.push('', 'Update the draft with the LAST dispatcher message and answer.');
  return lines.join('\n');
}

// Az AI csak az általa kezelt mezőket látja (belső id-k, e-mailek nem mennek ki).
function _aiView(d) {
  return {
    client: d.client, client_cui: d.client_cui, ref: d.ref, stops: d.stops,
    load_type: d.load_type, suly_kg: d.suly_kg, hossz_cm: d.hossz_cm, szel_cm: d.szel_cm, mag_cm: d.mag_cm,
    pret: d.pret, km: d.km, driver_name: d.driver_name || d.nume_sofer,
    rendszam_camion: d.rendszam_camion, rendszam_remorca: d.rendszam_remorca,
  };
}

// ─── Feloldás a cég saját adataira ───────────────────────────
// Visszaad: { draft, questions[], notes[], missing[] }. Az AI-kérdéseket a
// hívó fűzi hozzá; itt a szerver-oldali (adatbázis-alapú) kérdések keletkeznek.
async function resolveDraft(cid, input, opts) {
  const o = opts || {};
  const d = Object.assign({}, input);
  const questions = [];
  const notes = [];
  const missing = [];

  // 1) Ügyfél ────────────────────────────────────────────────
  // A kliensről jövő client_id-t csak tulajdon-ellenőrzés után fogadjuk el.
  if (d.client_id) {
    try {
      const r = await pool.query('SELECT id, denumire, cui_cif FROM clients WHERE id=$1 AND company_id=$2', [d.client_id, cid]);
      if (r.rows.length && (!d.client || _fold(d.client) === _fold(r.rows[0].denumire))) {
        d.client = r.rows[0].denumire;
      } else { d.client_id = null; }
    } catch (_) { d.client_id = null; }
  }
  const cuiN = d.client_cui ? clientsSvc.normalizeCui(d.client_cui) : '';
  if (!d.client_id && cuiN) {
    let existing = null;
    try {
      const r = await pool.query(
        `SELECT id, denumire FROM clients
          WHERE company_id=$1 AND regexp_replace(UPPER(COALESCE(cui_cif,'')), '[^0-9]', '', 'g') = $2
          ORDER BY id LIMIT 1`, [cid, cuiN]);
      existing = r.rows[0] || null;
    } catch (_) { /* nincs ügyfél-tábla → ANAF */ }
    if (existing) {
      d.client_id = existing.id; d.client = existing.denumire;
      notes.push({ type: 'client_existing', text: existing.denumire });
    } else if (o.allowAnaf !== false) {
      let an = null;
      try { an = await clientsSvc.anafLookup(cuiN); }
      catch (e) { notes.push({ type: 'anaf_error', text: String(e.message || e).slice(0, 160) }); }
      if (an && an.found && an.name) {
        const saved = await _saveAnafClient(cid, an);
        if (saved) {
          d.client_id = saved.id; d.client = saved.denumire;
          notes.push({ type: 'client_saved', text: saved.denumire + ' (CUI ' + an.cui + ')' });
          if (o.req) { try { await audit.fromReq(o.req, 'client.create', 'client', saved.id, { source: 'order_chat_anaf' }); } catch (_) {} }
        }
      } else if (an && !an.found) {
        questions.push({ key: 'client', text: qt(o.lang, 'anafNotFound', cuiN), options: [] });
        d.client_cui = null;
      }
    }
  }
  if (!d.client_id && d.client) {
    // Név szerinti egyezés a mentett ügyfelek közt (ékezet-független).
    try {
      const r = await pool.query(
        `SELECT id, denumire FROM clients WHERE company_id=$1 AND denumire ILIKE $2 ORDER BY denumire LIMIT 6`,
        [cid, '%' + String(d.client).replace(/[%_]/g, ' ').trim() + '%']);
      const exact = r.rows.find((x) => _fold(x.denumire) === _fold(d.client));
      if (exact) { d.client_id = exact.id; d.client = exact.denumire; }
      else if (r.rows.length === 1) { d.client_id = r.rows[0].id; d.client = r.rows[0].denumire; }
      else if (r.rows.length > 1) {
        questions.push({ key: 'client', text: qt(o.lang, 'clientMulti', d.client), options: r.rows.slice(0, 4).map((x) => x.denumire) });
      } else {
        notes.push({ type: 'client_new', text: d.client });
      }
    } catch (_) { /* best-effort */ }
  }
  if (!d.client) {
    missing.push('client');
    const firstPick = (d.stops || []).find((s) => s.kind === 'pickup' && s.firma);
    questions.push({ key: 'client', text: qt(o.lang, 'clientAsk'),
      options: firstPick ? [firstPick.firma] : [] });
  }

  // 2) Állomások ─────────────────────────────────────────────
  const stops = d.stops || [];
  if (!stops.some((s) => s.kind === 'pickup')) missing.push('pickup');
  if (!stops.some((s) => s.kind === 'delivery')) missing.push('delivery');
  stops.forEach((s, i) => {
    if (!s.loc) missing.push('stop_loc_' + i);
    if (!s.data) missing.push('stop_date_' + i);
  });
  // Mentett kedvenc helyszín: ha a cég neve pontosan egy mentett helyszín
  // címkéje, és a cím csak városnév (nincs benne szám), a mentett cím kerül be.
  try {
    for (const s of stops) {
      if (!s.firma) continue;
      if (s.loc && /\d/.test(s.loc)) continue;
      const r = await pool.query(
        `SELECT address FROM favorite_locations WHERE company_id=$1 AND LOWER(label)=LOWER($2) LIMIT 1`, [cid, s.firma]);
      if (r.rows.length && r.rows[0].address) { s.loc = String(r.rows[0].address).slice(0, 200); s.fav = true; }
    }
  } catch (_) { /* tábla hiányzik → kihagyjuk */ }

  // 3) Áru ───────────────────────────────────────────────────
  if (!d.load_type) missing.push('load_type');
  if (d.load_type === 'LTL' && (!d.hossz_cm || !d.szel_cm || !d.mag_cm)) missing.push('dims');

  // 4) Sofőr + jármű ─────────────────────────────────────────
  if (d.email_sofer) {
    // Kliensről visszajött: csak a SAJÁT cég aktív sofőrje fogadható el.
    try {
      const r = await pool.query(
        `SELECT email, nume FROM users WHERE company_id=$1 AND LOWER(email)=LOWER($2)
            AND pozicio='Sofer' AND blocked IS NOT TRUE`, [cid, d.email_sofer]);
      if (r.rows.length) { d.email_sofer = String(r.rows[0].email).toLowerCase(); d.nume_sofer = r.rows[0].nume; }
      else { d.email_sofer = null; d.nume_sofer = null; }
    } catch (_) { d.email_sofer = null; }
    // Ha a diszpécser más nevet írt, újra feloldjuk.
    if (d.email_sofer && d.driver_name && _fold(d.driver_name) !== _fold(d.nume_sofer)) d.email_sofer = null;
  }
  if (!d.email_sofer && d.driver_name) {
    try {
      const r = await pool.query(
        `SELECT email, nume FROM users WHERE company_id=$1 AND pozicio='Sofer' AND blocked IS NOT TRUE ORDER BY nume`, [cid]);
      const q = _fold(d.driver_name).split(' ').filter(Boolean);
      const hits = r.rows.filter((u) => { const n = _fold(u.nume); return q.length && q.every((t) => n.includes(t)); });
      const exact = hits.find((u) => _fold(u.nume) === _fold(d.driver_name));
      const pick = exact || (hits.length === 1 ? hits[0] : null);
      if (pick) { d.email_sofer = String(pick.email).toLowerCase(); d.nume_sofer = pick.nume; d.driver_name = pick.nume; }
      else if (hits.length > 1) {
        questions.push({ key: 'driver', text: qt(o.lang, 'driverMulti', d.driver_name), options: hits.slice(0, 4).map((u) => u.nume) });
      } else {
        questions.push({ key: 'driver', text: qt(o.lang, 'driverNone', d.driver_name), options: [] });
        d.driver_name = null;
      }
    } catch (_) { /* best-effort */ }
  }
  if (!d.email_sofer) d.nume_sofer = null;
  // Rendszámok: csak a cég saját aktív járművei.
  async function _vehicle(plate, tip) {
    if (!plate) return null;
    try {
      const r = await pool.query(
        `SELECT rendszam FROM vehicles WHERE company_id=$1 AND tip=$2
            AND regexp_replace(UPPER(rendszam), '[^A-Z0-9]', '', 'g') = $3 LIMIT 1`, [cid, tip, plate]);
      return r.rows.length ? r.rows[0].rendszam : null;
    } catch (_) { return null; }
  }
  if (d.rendszam_camion) {
    const v = await _vehicle(d.rendszam_camion, 'Vontato');
    if (!v) { questions.push({ key: 'vehicle', text: qt(o.lang, 'truckNone', d.rendszam_camion), options: [] }); d.rendszam_camion = null; }
    else d.rendszam_camion = v;
  }
  if (d.rendszam_remorca) {
    const v = await _vehicle(d.rendszam_remorca, 'Potkocsi');
    if (!v) { questions.push({ key: 'vehicle', text: qt(o.lang, 'trailerNone', d.rendszam_remorca), options: [] }); d.rendszam_remorca = null; }
    else d.rendszam_remorca = v;
  }
  try {
    // Sofőr → hozzárendelt vontató; vontató → hozzárendelt sofőr; vontató → alap pótkocsi.
    if (d.email_sofer && !d.rendszam_camion) {
      const r = await pool.query(
        `SELECT rendszam FROM vehicles WHERE company_id=$1 AND LOWER(assigned_driver_email)=LOWER($2)
            AND tip='Vontato' AND activ = TRUE ORDER BY rendszam LIMIT 1`, [cid, d.email_sofer]);
      if (r.rows.length) { d.rendszam_camion = r.rows[0].rendszam; d.auto_truck = true; }
    } else if (d.rendszam_camion && !d.email_sofer && !d.driver_name) {
      const r = await pool.query(
        `SELECT u.email, u.nume FROM vehicles v JOIN users u ON u.company_id=v.company_id
            AND LOWER(u.email)=LOWER(v.assigned_driver_email)
          WHERE v.company_id=$1 AND v.rendszam=$2 AND u.pozicio='Sofer' AND u.blocked IS NOT TRUE LIMIT 1`,
        [cid, d.rendszam_camion]);
      if (r.rows.length) { d.email_sofer = String(r.rows[0].email).toLowerCase(); d.nume_sofer = r.rows[0].nume; d.auto_driver = true; }
    }
    if (d.rendszam_camion && !d.rendszam_remorca) {
      const r = await pool.query(
        `SELECT t.rendszam FROM vehicles v JOIN vehicles t ON t.id=v.default_trailer_id AND t.company_id=v.company_id
          WHERE v.company_id=$1 AND v.rendszam=$2 AND t.tip='Potkocsi' AND t.activ = TRUE LIMIT 1`,
        [cid, d.rendszam_camion]);
      if (r.rows.length) { d.rendszam_remorca = r.rows[0].rendszam; d.auto_trailer = true; }
    }
  } catch (_) { /* best-effort */ }

  // 5) Km — automatikus útvonal, ha a diszpécser nem adta meg (best-effort,
  //    csak ha az állomás-címek változtak → nem geokódolunk minden körben).
  const locs = stops.map((s) => s.loc).filter(Boolean);
  const sig = stops.length >= 2 && locs.length === stops.length ? locs.join(' | ') : null;
  if (sig && o.estimateRoute !== false) {
    if (d.route_sig !== sig) {
      d.route_sig = sig; d.route_km = null; d.route_geo = null;
      try {
        const { estimateRoute } = require('../lib/routeEstimate');
        const wps = stops.map((s) => ({ type: s.kind === 'pickup' ? 'loading' : 'unloading', address: s.loc }));
        const r = await estimateRoute(wps, cid);
        d.route_km = r.km;
        d.route_geo = { waypoints: r.waypoints.slice(0, 9).map((w) => ({ type: w.type, address: w.label, lat: w.lat, lng: w.lng })), km: r.km, durationSeconds: r.durationSeconds };
      } catch (_) { /* geokódolás nem sikerült → km kézzel */ }
    }
  } else if (!sig) { d.route_sig = null; d.route_km = null; d.route_geo = null; }

  return { draft: d, questions, notes, missing };
}

// ANAF-adatokból új ügyfél mentése (a cégre szűrve). Kiterjesztett
// cím-mezők, ha a migráció már lefutott; különben az alap oszlopok.
async function _saveAnafClient(cid, an) {
  const adresa = an.address || null;
  const complet = !!(an.cui && adresa);
  try {
    const r = await pool.query(
      `INSERT INTO clients (company_id, denumire, tip, cui_cif, reg_com, tara, judet, localitate, adresa,
                            strada, nr_strada, detalii_adresa, oras, cod_postal, telefon,
                            complet_facturare, anaf_status, anaf_last_check)
       VALUES ($1,$2,'PJ',$3,$4,'RO',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
       RETURNING id, denumire`,
      [cid, an.name, an.cui, an.regCom, an.county, an.locality, adresa,
        an.street, an.streetNumber, an.addressDetails, an.city, an.postalCode, an.phone,
        complet, an.active ? 'activ' : 'inactiv']);
    return r.rows[0];
  } catch (e) {
    try {
      const r = await pool.query(
        `INSERT INTO clients (company_id, denumire, tip, cui_cif, reg_com, tara, judet, localitate, adresa,
                              telefon, complet_facturare)
         VALUES ($1,$2,'PJ',$3,$4,'RO',$5,$6,$7,$8,$9) RETURNING id, denumire`,
        [cid, an.name, an.cui, an.regCom, an.county, an.locality, adresa, an.phone, complet]);
      return r.rows[0];
    } catch (e2) { console.error('orderChat ügyfél-mentés hiba:', e2.message); return null; }
  }
}

// A kliensre menő vázlat (a belső útvonal-geometria nélkül, de az aláírással).
function _clientDraft(d) {
  return Object.assign({}, d, { route_geo: d.route_geo || null });
}

async function _gate(req) {
  const u = req.session && req.session.user;
  if (!u || !['Admin', 'Manager'].includes(u.pozicio)) return 'Acces interzis';
  if (!(await featureEnabled(u.company_id, FEATURE))) return 'Funcția „Comandă din text (AI)" nu este inclusă în pachetul curent (de la pachetul Pro).';
  return null;
}

// ─── args[0]: { messages:[{role:'user'|'assistant', text}], draft } ───
handlers.orderChatTurn = async function (req, res, args) {
  try {
    const gateErr = await _gate(req);
    if (gateErr) return res.json({ result: { ok: false, err: gateErr } });
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const messages = (Array.isArray(a.messages) ? a.messages : []).slice(-MAX_MSGS)
      .map((m) => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', text: String((m && m.text) || '').trim().slice(0, MAX_MSG_LEN) }))
      .filter((m) => m.text);
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return res.json({ result: { ok: false, err: 'Mesaj gol.' } });
    }
    const prev = sanitizeDraft(a.draft);

    let ai;
    try {
      ai = await extractJson({
        systemPrompt: buildSystemPrompt(_today()),
        parts: [{ text: buildConversation(messages, prev) }],
      });
    } catch (e) {
      const msg = e && e.code === 'NO_KEY' ? 'Serviciul AI nu este configurat.' : String((e && e.message) || 'Eroare AI').slice(0, 300);
      return res.json({ result: { ok: false, err: msg } });
    }
    const out = (ai && ai.json) || {};
    const aiDraft = sanitizeDraft(out.draft || {});
    // A szerver által feloldott (belső) mezők megőrzése, ha az AI nem változtatott rajtuk.
    if (prev.client_id && aiDraft.client && _fold(aiDraft.client) === _fold(prev.client)) aiDraft.client_id = prev.client_id;
    // A sofőr csak akkor marad, ha az AI ugyanazt a nevet hozza vissza
    // (ha a diszpécser levette — „sofőr nélkül" —, az AI null-t ad → törlődik).
    if (prev.email_sofer && aiDraft.driver_name && _fold(aiDraft.driver_name) === _fold(prev.nume_sofer)) {
      aiDraft.email_sofer = prev.email_sofer; aiDraft.nume_sofer = prev.nume_sofer;
    }
    aiDraft.route_sig = prev.route_sig; aiDraft.route_km = prev.route_km; aiDraft.route_geo = prev.route_geo;

    const lang = a.lang === 'hu' ? 'hu' : 'ro';
    const r = await resolveDraft(cid, aiDraft, { req, lang });
    const aiQ = (Array.isArray(out.questions) ? out.questions : []).slice(0, 3).map((q) => ({
      key: _str(q && q.key, 20) || 'other',
      text: _str(q && q.text, 300),
      options: (Array.isArray(q && q.options) ? q.options : []).slice(0, 4).map((x) => _str(x, 80)).filter(Boolean),
    })).filter((q) => q.text);
    // Szerver-kérdés elsőbbséget kap; azonos kulcsú AI-kérdést elhagyunk.
    const seen = new Set(r.questions.map((q) => q.key));
    const questions = r.questions.concat(aiQ.filter((q) => !seen.has(q.key))).slice(0, 4);
    const ready = r.missing.length === 0;

    try {
      await audit.fromReq(req, 'order.chat_turn', 'order', null, { turns: messages.length, ready, model: ai.model });
    } catch (_) { /* best-effort */ }

    return res.json({ result: {
      ok: true,
      reply: _str(out.reply, 600) || '',
      draft: _clientDraft(r.draft),
      questions, notes: r.notes, missing: r.missing, ready,
    } });
  } catch (e) {
    console.error('orderChatTurn hiba:', e && e.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── args[0]: { draft } → a fuvar mentése a MEGLÉVŐ comCreate-tel ───
handlers.orderChatCreate = async function (req, res, args) {
  try {
    const gateErr = await _gate(req);
    if (gateErr) return res.json({ result: { ok: false, err: gateErr } });
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    // Újra-ellenőrzés: a kliensről jövő vázlat megbízhatatlan.
    const r = await resolveDraft(cid, sanitizeDraft(a.draft), { req, allowAnaf: false, estimateRoute: true });
    const d = r.draft;
    if (r.missing.length) {
      return res.json({ result: { ok: false, err: 'Comanda nu este completă: ' + r.missing.join(', '), missing: r.missing } });
    }
    const pickups = d.stops.filter((s) => s.kind === 'pickup');
    const deliveries = d.stops.filter((s) => s.kind === 'delivery');
    const km = d.km != null ? d.km : (d.route_km || 0);
    const payload = {
      client: d.client,
      ref: d.ref || '',
      pret: d.pret || 0,
      km,
      stops: d.stops.map((s) => ({ kind: s.kind, loc: s.loc, firma: s.firma, data: s.data })),
      loc_incarcare: pickups[0].loc, firma_incarcare: pickups[0].firma, data_incarcare: pickups[0].data,
      loc_descarcare: deliveries[deliveries.length - 1].loc,
      firma_descarcare: deliveries[deliveries.length - 1].firma,
      data_descarcare: deliveries[deliveries.length - 1].data,
      load_type: d.load_type, hossz_cm: d.hossz_cm, szel_cm: d.szel_cm, mag_cm: d.mag_cm,
      suly_kg: d.suly_kg,
      sofer_type: d.email_sofer ? 'Intern' : null,
      email_sofer: d.email_sofer, nume_sofer: d.nume_sofer,
      rendszam_camion: d.rendszam_camion, rendszam_remorca: d.rendszam_remorca,
      route_geo: d.route_geo || null,
      series_id: a.series_id || null,
    };

    let captured = null;
    const stubRes = { json: (p) => { captured = p; return p; } };
    await orderHandlers.comCreate(req, stubRes, [payload]);
    const result = (captured && captured.result) || {};
    if (!result.ok || !result.id) {
      return res.json({ result: { ok: false, err: result.err || 'Eroare la crearea comenzii.' } });
    }
    // Ügyfél-kötés (orders.client_id) — best-effort, cégre szűrve.
    if (d.client_id) {
      try { await pool.query('UPDATE orders SET client_id=$1 WHERE id=$2 AND company_id=$3', [d.client_id, result.id, cid]); }
      catch (_) { /* oszlop hiányzik → csak név szerint kötött */ }
    }
    try { await audit.fromReq(req, 'order.create_from_chat', 'order', result.id, { stops: d.stops.length, client_linked: !!d.client_id }); }
    catch (_) { /* best-effort */ }
    return res.json({ result: { ok: true, id: result.id, fuvar_no: result.fuvar_no || null } });
  } catch (e) {
    console.error('orderChatCreate hiba:', e && e.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Belső segédek — a teszt eléri, RPC-n nem hívhatók (nem-enumerable).
Object.defineProperty(handlers, '_sanitizeDraft', { value: sanitizeDraft, enumerable: false });
Object.defineProperty(handlers, '_resolveDraft', { value: resolveDraft, enumerable: false });
Object.defineProperty(handlers, '_today', { value: _today, enumerable: false });
Object.defineProperty(handlers, '_buildSystemPrompt', { value: buildSystemPrompt, enumerable: false });

module.exports = handlers;
