// ============================================================
//  VallorSoft — lib/driverInfo.js
//  💬 Sofőr-kérdések a szöveges fuvarkiírás chatjében (AI NÉLKÜL):
//    „Peto hol tart a fuvarjával?"         → 📍 állapot-kártya (állomások + élő GPS)
//    „Mikor tankolt Imre szeptemberben?"    → ⛽ tankolások (hol, mennyit, mennyiért)
//    „B104VLR fogyasztása a múlt hónapban"  → 📉 átlagfogyasztás menetlevelenként
//    „Mit vásárolt Peto?" / „határátlépései" / „menetlevelei" / „dokumentumai"
//    „Mit csinált Peto ezen a héten?"       → 📊 összesítő + idővonal
//    „Ki van úton?" / „hol tartanak a sofőrök?" → 🚚 flotta-lista
//
//  • A felismerés determinisztikus (lib/mailIntent segédeivel): a sofőrt /
//    rendszámot a cég SAJÁT listájából + a tanult becenevekből oldja fel.
//    Utókérdésnél („És a fogyasztása?") az előzményből veszi az alanyt.
//  • A válasz egy SZERVEREN renderelt, escape-elt HTML-kártya; az AI semmilyen
//    adatot nem kap. Minden lekérdezés company_id-szűrt, paraméteres.
//  • A sofőr e-mailje / telefonja nem kerül a kártyára.
// ============================================================
'use strict';

const pool = require('../db');
const mi = require('./mailIntent');

const fold = mi.fold;
const plateNorm = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };
const fmtN = (n, d) => { try { return Number(n).toLocaleString('ro-RO', { minimumFractionDigits: d || 0, maximumFractionDigits: d == null ? 0 : d }); } catch (_) { return String(n); } };
const MAX_ROWS = 25;
const DEFAULT_DAYS = 30;

// ─── Téma-felismerés (ékezet nélküli, kisbetűs szövegen) ───
const RE = {
  status: /\bhol (tart\w*|van\w*|jar\w*|lehet|tartozkod\w*)\b|\bmerre (jar\w*|van\w*|tart\w*)\b|\bunde (e|este|se afla|a ajuns|merge|sunt|ii)\b|\bpozici\w*|\bpozit\w*|\bhelyzet\w*|\ballapot\w*|\bstatus\w*|\buton van\b|\bki van uton\b|\bkik vannak uton\b|\bkovetkezo allomas\w*|\bunde au ajuns\b|\bcine (e|este|sunt) pe drum\b|\bwho is on the road\b/,
  fuelStrong: /\btankol\w*|\balimenta\w*|\bfueling\b|\brefuel\w*/,
  fuelWeak: /\buzemanyag\w*|\bmotorina\w*|\bcombustibil\w*|\bdiesel\b|\badblue\b|\bfuel\b|\bdizel\w*/,
  consumption: /\bfogyaszt\w*|\bconsum\w*|\batlagfogy\w*|\bl 100\b|\bl100\b|\bconsumption\b/,
  purchases: /\bvasarl\w*|\bvasarol\w*|\bkiadas\w*|\bkoltes\w*|\bkoltott\w*|\bkoltott\b|\bachizit\w*|\bcumpar\w*|\bcheltui\w*|\bbon(ok|t|ja|jai|jait|uri|urile|ul)?\b|\butdij\w*|\brovinie\w*|\bpurchase\w*|\bexpense\w*/,
  border: /\bhatar\w*|\bfrontier\w*|\bgranit\w*|\bvama\w*|\bborder\w*/,
  waybills: /\bmenetlevel\w*|\bfoaie\w*|\bfoi\b|\bfoile\b|\bfuvarlevel\w*|\bwaybill\w*/,
  docs: /\bdokument\w*|\birat\w*|\bfoto\w*|\bfenykep\w*|\bcmr\w*|\bdocument\w*|\bpoze\w*|\bpoza\b/,
  km: /\bkm\b|\bkilomet\w*|\bmegtett\w*|\bparcurs\w*|\bkilometr\w*/,
  activity: /\bmit csinal\w*|\bmi tortent\w*|\bmi van vele\b|\btevekenyseg\w*|\baktivitas\w*|\bosszesit\w*|\bosszefoglal\w*|\bmindent\b|\bce a facut\b|\bce face\b|\bce mai face\b|\bactivitat\w*|\brezumat\w*|\bsumar\w*|\bjelentes\w*|\braport\w*|\briport\w*|\bactivity\b/,
};
// Kérdés / kérés-jel — e nélkül nem tekintjük lekérdezésnek (egy fuvar-leírás
// „Peto viszi, 450 km" ne váltson át információs válaszra).
const QUESTION_RE = /\b(hol|merre|mikor|mennyi\w*|hany\w*|mit|mi|kik?|milyen|melyik\w*|mutas\w*|mutatni|listaz\w*|sorold\w*|mondd|ird ki|irj ki|kerd le|nezd meg|kerem|kerlek|unde|cand|cat|cati|cate|ce|care|arata\w*|afiseaza|spune\w*|listeaza|show|where|when|how)\b/;
const COUNT_RE = /\b(mennyi\w*|hany\w*|cat|cati|cate|osszesen|total|how many|how much)\b/;
const ORDER_TEXT_RE = /\b(felrak\w*|lerak\w*|incarc\w*|descarc\w*|rakomany\w*|marfa\w*|megrendelo\w*|ugyfel\w*|ftl|ltl)\b/;
const FLEET_RE = /\bcine (e|este|sunt) pe drum\b|\bsoforok\w*|\bsoforeink\w*|\bsoforjeink\w*|\bsofor(ei|jei)nk\b|\bmindenki\w*|\bki van uton\b|\bkik vannak\b|\bkik jarnak\b|\bsoferii\b|\bsoferi\b|\bsoferilor\b|\bflott\w*|\bflota\w*|\bkamionok\w*|\bkamionjaink\b|\bautok\w*|\bmasinile\b|\bcamioanele\b|\bdrivers\b|\btrucks\b/;
const ORDER_REF_RE = /\b([A-Z]{1,10}-\d{4}-\d{1,6}|CMD-[A-Z0-9]{8,14})\b/i;

const TOPIC_ORDER = ['status', 'activity', 'fuel', 'consumption', 'purchases', 'waybills', 'border', 'docs'];

function detectTopics(text) {
  const raw = String(text || '');
  const f = fold(raw);
  if (!f) return { topics: [], f };
  // Kérdőjel / kérdőszó nélkül is lekérdezés (pl. Peto határátlépései), de akkor
  // csak ha a MOSTANI szövegben van alany (needsEntity) — lásd answer().
  const hasQ = raw.includes('?') || QUESTION_RE.test(f);
  // Fuvar-leírás jellegű szöveg kérdőjel nélkül → nem lekérdezés.
  if (!raw.includes('?') && ORDER_TEXT_RE.test(f)) return { topics: [], f };
  const t = new Set();
  if (RE.status.test(f)) t.add('status');
  const cons = RE.consumption.test(f);
  if (cons) t.add('consumption');
  if (RE.fuelStrong.test(f) || (RE.fuelWeak.test(f) && !cons)) t.add('fuel');
  if (RE.purchases.test(f)) t.add('purchases');
  if (RE.border.test(f)) t.add('border');
  if (RE.waybills.test(f)) t.add('waybills');
  if (RE.docs.test(f)) t.add('docs');
  if (RE.activity.test(f)) t.add('activity');
  // „km" csak számoló kérdésnél („mennyi km-t ment?") — a menetlevél-összesítő adja.
  let kmOnly = false;
  if (RE.km.test(f) && (raw.includes('?') || COUNT_RE.test(f)) && !t.has('waybills')) { t.add('waybills'); kmOnly = t.size === 1; }
  if (!hasQ) t.delete('status');
  return { topics: TOPIC_ORDER.filter((k) => t.has(k)), f, kmOnly, needsEntity: !hasQ };
}

// ─── Alany: sofőr (név / tanult becenév) vagy rendszám ───
async function findEntity(cid, text, cache) {
  const f = fold(text);
  if (!f) return null;
  const words = f.split(/[ -]/).filter(Boolean);
  cache.drivers = cache.drivers || await mi._drivers(cid);
  let best = []; let bestHit = 0;
  for (const d of cache.drivers) {
    const toks = fold(d.nume).split(/[ -]/).filter((t) => t.length >= 3);
    const hit = toks.filter((t) => words.some((w) => mi.wordHits(w, t)));
    if (!hit.length) continue;
    if (hit.length > bestHit) { best = [d]; bestHit = hit.length; } else if (hit.length === bestHit) best.push(d);
  }
  if (best.length === 1) return { email: best[0].email, name: best[0].nume };
  if (best.length > 1) return { ambiguous: best.map((d) => d.nume).slice(0, 6) };
  cache.aliases = cache.aliases || await mi._aliases(cid);
  for (const a of cache.aliases) {
    if (!a.key_norm || a.key_norm.length < 3) continue;
    const at = a.key_norm.split(' ');
    if (at.every((t) => words.some((w) => mi.wordHits(w, t)))) {
      const d = cache.drivers.find((x) => x.email === String(a.email || '').toLowerCase());
      if (d) return { email: d.email, name: d.nume, learned: true };
    }
  }
  cache.plates = cache.plates || await mi._plates(cid);
  const compact = plateNorm(text);
  for (const p of cache.plates) {
    const n = plateNorm(p);
    if (n.length >= 5 && compact.includes(n)) return { plate: n, plate_label: p };
  }
  return null;
}

// ─── Szövegek (a chat nyelvén) ───
const L = {
  hu: {
    status: 'Hol tart', fuel: 'Tankolások', consumption: 'Fogyasztás', purchases: 'Vásárlások / kiadások', border: 'Határátlépések',
    waybills: 'Menetlevelek', docs: 'Feltöltött dokumentumok', activity: 'Összesítő', fleet: 'Úton lévő sofőrök',
    last30: 'utolsó 30 nap', allTime: 'teljes időszak', noData: 'Nincs adat ebben az időszakban.', more: (n) => '+' + n + ' további',
    date: 'Dátum', place: 'Hely', liter: 'Liter', amount: 'Összeg', pay: 'Fizetés', type: 'Típus', km: 'Km', product: 'Tétel', category: 'Kategória',
    waybill: 'Menetlevél', vehicle: 'Jármű', used: 'Felhasznált L', avg: 'L/100km', tip: 'Irány', country: 'Ország', file: 'Fájl',
    total: 'Összesen', count: 'db', fuelTotal: 'Tankolt', costTotal: 'Költség', avgCons: 'Átlagfogyasztás', nominal: 'Névleges',
    pending: 'csak felhőben (még nincs menetlevélben)', out: 'Kilépés', in: 'Belépés', abroad: '🌍 Jelenleg külföldön', home: '🇷🇴 Jelenleg Romániában',
    noActive: (n, last) => n + ' most nem visz aktív fuvart.' + (last ? ' Utolsó: ' + last : ''),
    next: 'Következik', nowAt: 'Most', gps: 'Élő pozíció', gpsNone: 'Nincs élő GPS-adat ehhez a járműhöz.', moving: 'halad', stopped: 'áll',
    lastSignal: 'utolsó jel', toNext: 'légvonalban a következő állomásig', map: '🗺️ Térkép', openOrder: '🔎 Fuvar megnyitása',
    arrived: 'megérkezett', done: 'kész', pickup: 'Felrakás', delivery: 'Lerakás', goingTo: 'Úton ide', working: 'Ott van',
    allDone: 'Minden állomás kész — lezárásra vár.', whichDriver: 'Melyik sofőrre vagy járműre gondolsz?',
    ambiguous: 'Több sofőr is illik a névre — melyikre gondolsz?', noneOnRoad: 'Most egyetlen sofőrnek sincs aktív fuvarja.',
    orders: 'Fuvar', activeOrders: 'Aktív fuvar', closedOrders: 'Lezárt fuvar', events: 'Idővonal', fuel_ev: 'Tankolás', buy_ev: 'Vásárlás', wb_ev: 'Menetlevél', doc_ev: 'Dokumentum',
    stopArrive: 'Megérkezett', stopDone: 'Elvégezve', orderNotFound: (r) => 'Nem találom a(z) ' + r + ' fuvart.', fuelLevel: 'tank',
    q: { status: 'hol tart?', fuel: 'tankolásai?', consumption: 'fogyasztása?', purchases: 'vásárlásai?', border: 'határátlépései?', waybills: 'menetlevelei?', docs: 'dokumentumai?', activity: 'mit csinált?' },
  },
  ro: {
    status: 'Unde se află', fuel: 'Alimentări', consumption: 'Consum', purchases: 'Achiziții / cheltuieli', border: 'Treceri de frontieră',
    waybills: 'Foi de parcurs', docs: 'Documente încărcate', activity: 'Rezumat', fleet: 'Șoferi pe drum',
    last30: 'ultimele 30 de zile', allTime: 'toată perioada', noData: 'Nu există date în această perioadă.', more: (n) => '+' + n + ' în plus',
    date: 'Data', place: 'Loc', liter: 'Litri', amount: 'Sumă', pay: 'Plată', type: 'Tip', km: 'Km', product: 'Produs', category: 'Categorie',
    waybill: 'Foaie', vehicle: 'Vehicul', used: 'Consumat L', avg: 'L/100km', tip: 'Sens', country: 'Țară', file: 'Fișier',
    total: 'Total', count: 'buc', fuelTotal: 'Alimentat', costTotal: 'Cost', avgCons: 'Consum mediu', nominal: 'Nominal',
    pending: 'doar în cloud (încă nu e pe foaie)', out: 'Ieșire', in: 'Intrare', abroad: '🌍 Momentan în străinătate', home: '🇷🇴 Momentan în România',
    noActive: (n, last) => n + ' nu are acum nicio cursă activă.' + (last ? ' Ultima: ' + last : ''),
    next: 'Urmează', nowAt: 'Acum', gps: 'Poziție live', gpsNone: 'Nu există poziție GPS live pentru acest vehicul.', moving: 'în mers', stopped: 'oprit',
    lastSignal: 'ultimul semnal', toNext: 'în linie dreaptă până la următorul punct', map: '🗺️ Hartă', openOrder: '🔎 Deschide cursa',
    arrived: 'a sosit', done: 'gata', pickup: 'Încărcare', delivery: 'Descărcare', goingTo: 'Pe drum spre', working: 'Este acolo',
    allDone: 'Toate punctele sunt gata — așteaptă închiderea.', whichDriver: 'La ce șofer sau vehicul te referi?',
    ambiguous: 'Mai mulți șoferi se potrivesc — la care te referi?', noneOnRoad: 'Momentan niciun șofer nu are cursă activă.',
    orders: 'Curse', activeOrders: 'Curse active', closedOrders: 'Curse închise', events: 'Cronologie', fuel_ev: 'Alimentare', buy_ev: 'Achiziție', wb_ev: 'Foaie de parcurs', doc_ev: 'Document',
    stopArrive: 'A sosit', stopDone: 'Finalizat', orderNotFound: (r) => 'Nu găsesc cursa ' + r + '.', fuelLevel: 'rezervor',
    q: { status: 'unde e?', fuel: 'alimentări?', consumption: 'consum?', purchases: 'achiziții?', border: 'frontiere?', waybills: 'foi de parcurs?', docs: 'documente?', activity: 'ce a făcut?' },
  },
};
const CAT = {
  hu: { taxa_drum: 'Útdíj', feribot: 'Komp', parcare: 'Parkolás', spalare: 'Mosás', reparatie: 'Javítás', piese: 'Alkatrész', cazare: 'Szállás', mancare: 'Étkezés', amenda: 'Bírság', altele: 'Egyéb' },
  ro: { taxa_drum: 'Taxă drum', feribot: 'Feribot', parcare: 'Parcare', spalare: 'Spălare', reparatie: 'Reparație', piese: 'Piese', cazare: 'Cazare', mancare: 'Mâncare', amenda: 'Amendă', altele: 'Altele' },
};

// ─── Dátum-megjelenítés (Europe/Bucharest) ───
function fmtD(d) {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof d === 'string' ? d : iso(new Date(d)));
  return m ? m[3] + '.' + m[2] + '.' + m[1] : String(d);
}
function fmtDT(d) {
  if (!d) return '';
  const x = new Date(d);
  if (isNaN(x)) return String(d);
  try {
    return x.toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (_) { return x.toISOString().slice(0, 16).replace('T', ' '); }
}
function dayOf(d) {
  if (!d) return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const x = new Date(d);
  if (isNaN(x)) return null;
  try { return x.toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' }); } catch (_) { return iso(x); }
}
function cityOf(loc) {
  const parts = String(loc || '').split(',').map((s) => s.trim()).filter(Boolean);
  const bad = /^(str\.?|strada|bd\.?|bulevardul|calea|aleea|sos\.?|soseaua|nr\.?|jud\.?|judetul|romania|românia|hungary|magyarország|germany|deutschland|ro|hu|de|\d[\d\s-]*)\b/i;
  const c = parts.find((p) => !bad.test(p) && !/^\d+$/.test(p));
  return (c || parts[0] || '').replace(/^\d{5,6}\s+/, '');
}
function haversine(a, b) {
  const R = 6371; const r = (x) => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat); const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ─── Adat-lekérdezések (mind company_id-szűrt) ───
// A menetlevél a cégé: közvetlen horgony, VAGY (régi sor) a sofőr a cég felhasználója.
const WB_FROM = `
  FROM (SELECT fl.*, COALESCE(fl.erkezes_dt, fl.indulas_dt, fl.data_completare) AS eff_date
          FROM fuvarlevelek fl
         WHERE fl.company_id = $1
            OR (fl.company_id IS NULL AND LOWER(fl.email_sofer) IN (SELECT LOWER(email) FROM users WHERE company_id = $1))) f`;
function wbScope(ent) {
  if (ent.email) return { sql: 'LOWER(f.email_sofer) = $2', val: ent.email };
  return { sql: `UPPER(REGEXP_REPLACE(COALESCE(f.numar_camion,''),'[^A-Za-z0-9]','','g')) = $2`, val: ent.plate };
}
async function q(sql, params) { try { return (await pool.query(sql, params)).rows; } catch (e) { console.error('driverInfo lekérdezés hiba:', e.message); return []; } }

const _arr = (v) => (Array.isArray(v) ? v : []);

// Menetlevelek a tágított időszakban (a tételek saját dátuma szerint szűrünk JS-ben).
async function loadWaybills(cid, ent, per) {
  const sc = wbScope(ent);
  const from = per.from ? new Date(new Date(per.from).getTime() - 60 * 864e5) : null;
  const params = [cid, sc.val];
  let where = sc.sql;
  if (from) { params.push(iso(from)); where += ` AND f.eff_date::date >= $${params.length}`; }
  if (per.to) { params.push(per.to); where += ` AND COALESCE(f.indulas_dt, f.eff_date)::date <= ($${params.length}::date + 1)`; }
  return q(`SELECT f.id, f.numar_fisa, f.numar_camion, f.nume_sofer, f.eff_date, f.total_km, f.motorina_folosit, f.consum_100,
                   f.alimentari, f.achizitii, f.loc_plecare, f.loc_sosire
            ${WB_FROM} WHERE ${where} ORDER BY f.eff_date DESC LIMIT 400`, params);
}
const inRange = (day, per) => !!day && (!per.from || day >= per.from) && (!per.to || day <= per.to);

function fuelItems(wbs, per) {
  const out = [];
  for (const w of wbs) {
    for (const a of _arr(w.alimentari)) {
      if (!a || typeof a !== 'object') continue;
      const day = /^\d{4}-\d{2}-\d{2}/.test(String(a.data || '')) ? String(a.data).slice(0, 10) : dayOf(w.eff_date);
      if (!inRange(day, per)) continue;
      const lit = num(a.litru); const sum = num(a.suma);
      if (!lit && !sum && !a.loc) continue;
      out.push({ day, loc: a.loc || '', tip: a.tip || '', litru: lit, suma: sum, plata: a.plata || '', km: num(a.km), fisa: w.numar_fisa || '', plate: w.numar_camion || '' });
    }
  }
  return out.sort((x, y) => (y.day || '').localeCompare(x.day || ''));
}
function buyItems(wbs, per) {
  const out = [];
  for (const w of wbs) {
    for (const a of _arr(w.achizitii)) {
      if (!a || typeof a !== 'object') continue;
      const day = /^\d{4}-\d{2}-\d{2}/.test(String(a.data || '')) ? String(a.data).slice(0, 10) : dayOf(w.eff_date);
      if (!inRange(day, per)) continue;
      const pret = num(a.pret);
      if (!pret && !a.produs) continue;
      out.push({ day, produs: a.produs || '', loc: a.loc || '', pret, plata: a.plata || '', cat: a.categorie || 'altele', fisa: w.numar_fisa || '' });
    }
  }
  return out.sort((x, y) => (y.day || '').localeCompare(x.day || ''));
}
async function pendingScans(cid, ent, per) {
  if (!ent.email) return [];
  const rows = await q(`SELECT kind, fields, scanned_at FROM driver_receipt_scans
                         WHERE company_id = $1 AND LOWER(email_sofer) = $2 AND status = 'pending'
                         ORDER BY scanned_at DESC LIMIT 50`, [cid, ent.email]);
  return rows.filter((r) => inRange(dayOf(r.scanned_at), per));
}
async function borderRows(cid, ent, per) {
  if (!ent.email) return [];
  const p = [cid, ent.email]; let w = '';
  if (per.from) { p.push(per.from); w += ` AND b.created_at::date >= $${p.length}`; }
  if (per.to) { p.push(per.to); w += ` AND b.created_at::date <= $${p.length}`; }
  return q(`SELECT b.tip, b.tara, b.locatie, b.created_at FROM border_crossings b
             WHERE LOWER(b.email_sofer) = $2
               AND LOWER(b.email_sofer) IN (SELECT LOWER(email) FROM users WHERE company_id = $1)${w}
             ORDER BY b.created_at DESC LIMIT 100`, p);
}
async function lastBorder(cid, email) {
  const r = await q(`SELECT b.tip, b.tara, b.created_at FROM border_crossings b
                      WHERE LOWER(b.email_sofer) = $2
                        AND LOWER(b.email_sofer) IN (SELECT LOWER(email) FROM users WHERE company_id = $1)
                      ORDER BY b.created_at DESC LIMIT 1`, [cid, email]);
  return r[0] || null;
}
async function docRows(cid, ent, per) {
  if (!ent.email) return [];
  const p = [cid, ent.email]; let w = '';
  if (per.from) { p.push(per.from); w += ` AND d.created_at::date >= $${p.length}`; }
  if (per.to) { p.push(per.to); w += ` AND d.created_at::date <= $${p.length}`; }
  return q(`SELECT d.tip, d.file_name, d.created_at, to_jsonb(d)->>'order_id' AS order_id
              FROM documents d
             WHERE LOWER(d.email_sofer) = $2
               AND ((to_jsonb(d)->>'company_id')::int = $1
                    OR ((to_jsonb(d)->>'company_id') IS NULL AND LOWER(d.email_sofer) IN (SELECT LOWER(email) FROM users WHERE company_id = $1)))${w}
             ORDER BY d.created_at DESC LIMIT 60`, p);
}

// ─── Fuvar-állapot (aktív fuvarok + állomások) ───
const ORDER_COLS = `o.id, o.status, o.loc_incarcare, o.loc_descarcare, o.data_incarcare, o.data_descarcare,
  o.rendszam_camion, o.rendszam_remorca, o.nume_sofer, LOWER(o.email_sofer) AS email_sofer, o.client,
  to_jsonb(o)->>'fuvar_no' AS fuvar_no, to_jsonb(o)->>'firma_incarcare' AS firma_incarcare,
  to_jsonb(o)->>'firma_descarcare' AS firma_descarcare,
  to_jsonb(o)->>'sosit_incarcare_at' AS sosit_incarcare_at, to_jsonb(o)->>'incarcat_at' AS incarcat_at,
  to_jsonb(o)->>'sosit_descarcare_at' AS sosit_descarcare_at, to_jsonb(o)->>'descarcat_at' AS descarcat_at,
  to_jsonb(o)->>'finalized_at' AS finalized_at`;

async function attachStops(cid, orders) {
  if (!orders.length) return orders;
  const rows = await q(`SELECT s.order_id, s.kind, s.stop_index, s.loc, s.firma, s.data, s.arrived_at, s.done_at,
                               (to_jsonb(s)->>'seq_index')::int AS seq
                          FROM order_stops s WHERE s.company_id = $1 AND s.order_id = ANY($2)
                         ORDER BY (to_jsonb(s)->>'seq_index')::int NULLS LAST, s.kind DESC, s.stop_index`,
  [cid, orders.map((o) => o.id)]);
  for (const o of orders) {
    let st = rows.filter((r) => r.order_id === o.id);
    if (!st.length) {
      st = [
        { kind: 'pickup', loc: o.loc_incarcare, firma: o.firma_incarcare, data: o.data_incarcare, arrived_at: o.sosit_incarcare_at, done_at: o.incarcat_at },
        { kind: 'delivery', loc: o.loc_descarcare, firma: o.firma_descarcare, data: o.data_descarcare, arrived_at: o.sosit_descarcare_at, done_at: o.descarcat_at },
      ].filter((s) => s.loc || s.firma);
    }
    o.stops = st;
    o.next = st.find((s) => !s.done_at) || null;
  }
  return orders;
}
async function activeOrders(cid, ent) {
  const p = [cid];
  let w;
  if (ent.order_id) { p.push(ent.order_id); w = 'o.id = $2'; }
  else if (ent.email) { p.push(ent.email); w = `LOWER(o.email_sofer) = $2 AND o.status IN ('Alocat','In Curs')`; }
  else { p.push(ent.plate); w = `UPPER(REGEXP_REPLACE(COALESCE(o.rendszam_camion,''),'[^A-Za-z0-9]','','g')) = $2 AND o.status IN ('Alocat','In Curs')`; }
  const rows = await q(`SELECT ${ORDER_COLS} FROM orders o WHERE o.company_id = $1 AND ${w}
                         ORDER BY o.data_incarcare NULLS LAST, o.created_at LIMIT 6`, p);
  return attachStops(cid, rows);
}
async function lastClosed(cid, ent) {
  if (!ent.email && !ent.plate) return null;
  const p = [cid, ent.email || ent.plate];
  const w = ent.email ? 'LOWER(o.email_sofer) = $2' : `UPPER(REGEXP_REPLACE(COALESCE(o.rendszam_camion,''),'[^A-Za-z0-9]','','g')) = $2`;
  const r = await q(`SELECT ${ORDER_COLS} FROM orders o WHERE o.company_id = $1 AND ${w} AND o.status = 'Finalizat'
                      ORDER BY COALESCE((to_jsonb(o)->>'finalized_at')::timestamptz, o.updated_at) DESC NULLS LAST LIMIT 1`, p);
  return r[0] || null;
}
async function assignedPlate(cid, email) {
  const r = await q(`SELECT rendszam FROM vehicles WHERE company_id = $1 AND LOWER(assigned_driver_email) = $2 ORDER BY id LIMIT 1`, [cid, email]);
  return r[0] ? r[0].rendszam : null;
}
async function driverOfPlate(cid, pn) {
  const r = await q(`SELECT LOWER(v.assigned_driver_email) AS email, u.nume
                       FROM vehicles v LEFT JOIN users u ON LOWER(u.email) = LOWER(v.assigned_driver_email) AND u.company_id = v.company_id
                      WHERE v.company_id = $1 AND UPPER(REGEXP_REPLACE(v.rendszam,'[^A-Za-z0-9]','','g')) = $2 LIMIT 1`, [cid, pn]);
  return r[0] && r[0].email ? r[0] : null;
}
async function livePos(cid, plate) {
  const pn = plateNorm(plate);
  if (!pn) return null;
  try {
    const { getPositions } = require('./vehiclePositions');
    const r = await getPositions(cid);
    return ((r && r.positions) || []).find((p) => plateNorm(p.rendszam) === pn) || null;
  } catch (e) { console.error('driverInfo GPS hiba:', e.message); return null; }
}
async function placeOf(lat, lng, lang) {
  try {
    const { reverseGeocode } = require('./reverseGeo');
    const r = await reverseGeocode(lat, lng, lang === 'hu' ? 'hu' : 'ro');
    return (r && r.address) || null;
  } catch (_) { return null; }
}
async function distToStop(pos, stop) {
  if (!pos || !stop || !stop.loc) return null;
  try {
    const { geocodeCached } = require('./routeEstimate');
    const g = await geocodeCached(stop.loc);
    if (!g || !isFinite(g.lat)) return null;
    return Math.round(haversine({ lat: +pos.lat, lng: +pos.lng }, g));
  } catch (_) { return null; }
}

// ─── HTML-építők ───
const tiles = (arr) => '<div class="och-info-tiles">' + arr.filter(Boolean).map(([v, l]) => '<div><b>' + esc(v) + '</b><span>' + esc(l) + '</span></div>').join('') + '</div>';
function table(head, rows, t) {
  if (!rows.length) return '<div class="och-info-empty">' + esc(t.noData) + '</div>';
  const shown = rows.slice(0, MAX_ROWS);
  return '<div class="och-info-tw"><table class="och-info-t"><thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>'
    + shown.map((r) => '<tr>' + r.map((c) => '<td>' + (c && c.__html != null ? c.__html : esc(c)) + '</td>').join('') + '</tr>').join('')
    + '</tbody></table></div>' + (rows.length > MAX_ROWS ? '<div class="och-info-more">' + esc(t.more(rows.length - MAX_ROWS)) + '</div>' : '');
}
const section = (icon, title, body) => '<div class="och-info-s"><div class="och-info-st">' + icon + ' ' + esc(title) + '</div>' + body + '</div>';
const safeId = (id) => (/^[A-Za-z0-9_-]{1,40}$/.test(String(id || '')) ? String(id) : null);
function orderBtn(o, t) {
  const id = safeId(o.id);
  return id ? '<button type="button" class="och-info-btn" onclick="OrderChat.openOrder(\'' + id + '\')">' + esc(t.openOrder) + '</button>' : '';
}
function mapLink(pos, t) {
  const la = Number(pos.lat), ln = Number(pos.lng);
  if (!isFinite(la) || !isFinite(ln)) return '';
  const u = 'https://www.openstreetmap.org/?mlat=' + la.toFixed(5) + '&mlon=' + ln.toFixed(5) + '#map=11/' + la.toFixed(5) + '/' + ln.toFixed(5);
  return '<a class="och-info-btn" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(t.map) + '</a>';
}

function stopsHtml(o, t) {
  const nextIdx = o.stops.findIndex((s) => !s.done_at);
  return '<ol class="och-info-steps">' + o.stops.map((s, i) => {
    const kind = s.kind === 'pickup' ? '⬆️ ' + t.pickup : '⬇️ ' + t.delivery;
    let state; let cls;
    if (s.done_at) { state = '✅ ' + t.done + ' ' + fmtDT(s.done_at); cls = 'done'; }
    else if (i === nextIdx) { state = s.arrived_at ? '📍 ' + t.arrived + ' ' + fmtDT(s.arrived_at) : '▶ ' + t.next; cls = 'now'; }
    else { state = '○'; cls = 'todo'; }
    const where = [cityOf(s.loc) || s.loc, s.firma].filter(Boolean).join(' · ');
    return '<li class="' + cls + '"><span class="k">' + esc(kind) + '</span> <span class="w">' + esc(where) + '</span>'
      + (s.data ? ' <span class="d">' + esc(fmtD(s.data)) + '</span>' : '') + '<div class="st">' + esc(state) + '</div></li>';
  }).join('') + '</ol>';
}

async function renderStatus(cid, ent, t, lang) {
  const orders = await activeOrders(cid, ent);
  const parts = [];
  let plate = ent.plate_label || (orders[0] && orders[0].rendszam_camion) || null;
  if (!plate && ent.email) plate = await assignedPlate(cid, ent.email);
  if (ent.order_id && !orders.length) return { html: '', empty: true };
  if (!orders.length) {
    const last = await lastClosed(cid, ent);
    const lastTxt = last ? (last.fuvar_no || last.id) + ' (' + [cityOf(last.loc_incarcare), cityOf(last.loc_descarcare)].filter(Boolean).join(' → ') + ')' : '';
    parts.push('<div class="och-info-note">' + esc(t.noActive(ent.name || ent.plate_label || '', lastTxt)) + '</div>');
  }
  for (const o of orders) {
    const head = '<div class="och-info-ord"><b>#' + esc(o.fuvar_no || o.id) + '</b> · ' + esc([cityOf(o.loc_incarcare), cityOf(o.loc_descarcare)].filter(Boolean).join(' → '))
      + (o.rendszam_camion ? ' · 🚚 ' + esc(o.rendszam_camion) : '') + (ent.order_id && o.nume_sofer ? ' · 👤 ' + esc(o.nume_sofer) : '') + '</div>';
    let nextLine = '';
    if (o.next) {
      const where = cityOf(o.next.loc) || o.next.loc || o.next.firma || '';
      nextLine = '<div class="och-info-next">' + esc(o.next.arrived_at ? t.working + ': ' : t.goingTo + ': ') + '<b>' + esc(where) + '</b> (' + esc(o.next.kind === 'pickup' ? t.pickup : t.delivery) + ')</div>';
    } else if (o.stops.length) nextLine = '<div class="och-info-next">' + esc(t.allDone) + '</div>';
    parts.push('<div class="och-info-card">' + head + nextLine + stopsHtml(o, t) + '<div class="och-info-btns">' + orderBtn(o, t) + '</div></div>');
  }
  // Élő pozíció
  if (ent.order_id && orders[0]) plate = orders[0].rendszam_camion || plate;
  if (plate) {
    const pos = await livePos(cid, plate);
    if (pos) {
      const place = await placeOf(pos.lat, pos.lng, lang);
      const nxt = orders[0] && orders[0].next;
      const dist = await distToStop(pos, nxt);
      const sp = num(pos.speed);
      const bits = [sp > 3 ? '🚚 ' + t.moving + ' ' + Math.round(sp) + ' km/h' : '⏸ ' + t.stopped];
      if (pos.datetime) bits.push(t.lastSignal + ': ' + fmtDT(pos.datetime));
      if (pos.fuel_level != null) bits.push('⛽ ' + t.fuelLevel + ': ' + fmtN(pos.fuel_level, 0));
      parts.push('<div class="och-info-card gps"><div class="och-info-st">📍 ' + esc(t.gps) + ' · ' + esc(plate) + '</div>'
        + '<div class="och-info-place">' + esc(place || (Number(pos.lat).toFixed(4) + ', ' + Number(pos.lng).toFixed(4))) + '</div>'
        + '<div class="och-info-mut">' + esc(bits.join(' · ')) + '</div>'
        + (dist != null ? '<div class="och-info-mut">≈ ' + esc(fmtN(dist)) + ' km ' + esc(t.toNext) + '</div>' : '')
        + '<div class="och-info-btns">' + mapLink(pos, t) + '</div></div>');
    } else {
      parts.push('<div class="och-info-note">📍 ' + esc(t.gpsNone) + ' (' + esc(plate) + ')</div>');
    }
  }
  const email = ent.email || (orders[0] && orders[0].email_sofer);
  if (email) {
    const b = await lastBorder(cid, email);
    if (b) parts.push('<div class="och-info-mut">' + esc(b.tip === 'Iesire' ? t.abroad : t.home) + ' (' + esc(fmtDT(b.created_at)) + ')</div>');
  }
  return { html: section('📍', t.status, parts.join('')) };
}

function renderFuel(fuel, pend, t) {
  const sumL = fuel.reduce((s, x) => s + (/adblue/i.test(x.tip) ? 0 : x.litru), 0);
  const sumAd = fuel.reduce((s, x) => s + (/adblue/i.test(x.tip) ? x.litru : 0), 0);
  const sumM = fuel.reduce((s, x) => s + x.suma, 0);
  let body = tiles([[fuel.length + ' ' + t.count, t.fuel], [fmtN(sumL, 0) + ' L', 'Motorină'], sumAd ? [fmtN(sumAd, 0) + ' L', 'AdBlue'] : null, [fmtN(sumM, 2), t.costTotal]]);
  body += table([t.date, t.place, t.type, t.liter, t.amount, t.pay, t.km, t.waybill],
    fuel.map((x) => [fmtD(x.day), x.loc, x.tip, x.litru ? fmtN(x.litru, 2) : '', x.suma ? fmtN(x.suma, 2) : '', x.plata, x.km ? fmtN(x.km) : '', x.fisa]), t);
  const pf = pend.filter((p) => p.kind === 'fuel');
  if (pf.length) {
    body += '<div class="och-info-sub">☁️ ' + esc(t.pending) + '</div>' + table([t.date, t.place, t.liter, t.amount],
      pf.map((p) => { const f = p.fields || {}; return [fmtD(f.data || p.scanned_at), f.loc || '', f.litru ? fmtN(num(f.litru), 2) : '', f.suma ? fmtN(num(f.suma), 2) + (f.valuta ? ' ' + f.valuta : '') : '']; }), t);
  }
  return section('⛽', t.fuel, body);
}
async function renderConsumption(cid, wbs, per, ent, t) {
  const rows = wbs.filter((w) => inRange(dayOf(w.eff_date), per));
  const km = rows.reduce((s, w) => s + num(w.total_km), 0);
  const used = rows.reduce((s, w) => s + num(w.motorina_folosit), 0);
  const avg = km > 0 && used > 0 ? used / km * 100 : null;
  let nominal = null;
  const plates = [...new Set(rows.map((w) => plateNorm(w.numar_camion)).filter(Boolean))];
  if (plates.length === 1 || ent.plate) {
    const r = await q(`SELECT fuel_per_100km FROM vehicles WHERE company_id = $1 AND UPPER(REGEXP_REPLACE(rendszam,'[^A-Za-z0-9]','','g')) = $2 LIMIT 1`, [cid, ent.plate || plates[0]]);
    if (r[0] && num(r[0].fuel_per_100km) > 0) nominal = num(r[0].fuel_per_100km);
  }
  const dev = avg != null && nominal ? ((avg - nominal) / nominal * 100) : null;
  let body = tiles([
    [avg != null ? fmtN(avg, 1) : '—', t.avgCons + ' (L/100km)'],
    [fmtN(km), t.km], [fmtN(used, 0) + ' L', t.used],
    nominal ? [fmtN(nominal, 1) + (dev != null ? ' (' + (dev >= 0 ? '+' : '') + fmtN(dev, 0) + '%)' : ''), t.nominal] : null,
  ]);
  body += table([t.date, t.waybill, t.vehicle, t.km, t.used, t.avg],
    rows.map((w) => {
      const k = num(w.total_km), u = num(w.motorina_folosit);
      const c = num(w.consum_100) || (k > 0 && u > 0 ? u / k * 100 : 0);
      return [fmtD(dayOf(w.eff_date)), w.numar_fisa || '', w.numar_camion || '', k ? fmtN(k) : '', u ? fmtN(u, 0) : '', c ? fmtN(c, 1) : ''];
    }), t);
  return section('📉', t.consumption, body);
}
function renderPurchases(buys, pend, t, lang) {
  const sum = buys.reduce((s, x) => s + x.pret, 0);
  const byCat = {};
  buys.forEach((b) => { byCat[b.cat] = (byCat[b.cat] || 0) + b.pret; });
  const catL = CAT[lang] || CAT.ro;
  const catTiles = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => [fmtN(v, 2), catL[k] || k]);
  let body = tiles([[buys.length + ' ' + t.count, t.purchases], [fmtN(sum, 2), t.total]].concat(catTiles));
  body += table([t.date, t.product, t.category, t.place, t.amount, t.pay, t.waybill],
    buys.map((x) => [fmtD(x.day), x.produs, catL[x.cat] || x.cat, x.loc, x.pret ? fmtN(x.pret, 2) : '', x.plata, x.fisa]), t);
  const pp = pend.filter((p) => p.kind !== 'fuel');
  if (pp.length) {
    body += '<div class="och-info-sub">☁️ ' + esc(t.pending) + '</div>' + table([t.date, t.product, t.place, t.amount],
      pp.map((p) => { const f = p.fields || {}; return [fmtD(f.data || p.scanned_at), f.produs || '', f.loc || '', f.suma ? fmtN(num(f.suma), 2) + (f.valuta ? ' ' + f.valuta : '') : '']; }), t);
  }
  return section('🛒', t.purchases, body);
}
function renderWaybills(wbs, per, t) {
  const rows = wbs.filter((w) => inRange(dayOf(w.eff_date), per));
  const km = rows.reduce((s, w) => s + num(w.total_km), 0);
  let body = tiles([[rows.length + ' ' + t.count, t.waybills], [fmtN(km), t.km]]);
  body += table([t.date, t.waybill, t.vehicle, t.place, t.km],
    rows.map((w) => [fmtD(dayOf(w.eff_date)), w.numar_fisa || '', w.numar_camion || '', [cityOf(w.loc_plecare), cityOf(w.loc_sosire)].filter(Boolean).join(' → '), w.total_km ? fmtN(num(w.total_km)) : '']), t);
  return section('📄', t.waybills, body);
}
function renderBorder(rows, t) {
  return section('🛂', t.border, tiles([[rows.length + ' ' + t.count, t.border]])
    + table([t.date, t.tip, t.country, t.place], rows.map((b) => [fmtDT(b.created_at), b.tip === 'Iesire' ? '↗ ' + t.out : '↘ ' + t.in, b.tara || '', b.locatie || '']), t));
}
function renderDocs(rows, t) {
  return section('📎', t.docs, tiles([[rows.length + ' ' + t.count, t.docs]])
    + table([t.date, t.type, t.file], rows.map((d) => [fmtDT(d.created_at), d.tip || '', d.file_name || '']), t));
}
async function renderActivity(cid, ent, per, wbs, fuel, buys, borders, docs, t) {
  const p = [cid, ent.email || ent.plate];
  const w = ent.email ? 'LOWER(o.email_sofer) = $2' : `UPPER(REGEXP_REPLACE(COALESCE(o.rendszam_camion,''),'[^A-Za-z0-9]','','g')) = $2`;
  const ords = await q(`SELECT ${ORDER_COLS} FROM orders o WHERE o.company_id = $1 AND ${w} AND o.status <> 'Anulat'
                         ORDER BY o.created_at DESC LIMIT 200`, p);
  await attachStops(cid, ords);
  const events = [];
  let closed = 0;
  for (const o of ords) {
    if (o.status === 'Finalizat' && inRange(dayOf(o.finalized_at || o.descarcat_at), per)) closed++;
    for (const s of o.stops || []) {
      const lbl = (s.kind === 'pickup' ? t.pickup : t.delivery) + ' — ' + (cityOf(s.loc) || s.firma || '') + ' (#' + (o.fuvar_no || o.id) + ')';
      if (s.arrived_at && inRange(dayOf(s.arrived_at), per)) events.push({ at: s.arrived_at, ic: '📍', txt: t.stopArrive + ': ' + lbl });
      if (s.done_at && inRange(dayOf(s.done_at), per)) events.push({ at: s.done_at, ic: s.kind === 'pickup' ? '📦' : '✅', txt: t.stopDone + ': ' + lbl });
    }
  }
  const wbIn = wbs.filter((x) => inRange(dayOf(x.eff_date), per));
  wbIn.forEach((x) => events.push({ at: x.eff_date, ic: '📄', txt: t.wb_ev + ' ' + (x.numar_fisa || '') + (num(x.total_km) ? ' · ' + fmtN(num(x.total_km)) + ' km' : '') }));
  fuel.forEach((x) => events.push({ at: x.day, ic: '⛽', txt: t.fuel_ev + ': ' + (x.loc || '') + (x.litru ? ' · ' + fmtN(x.litru, 0) + ' L' : '') }));
  buys.forEach((x) => events.push({ at: x.day, ic: '🛒', txt: t.buy_ev + ': ' + (x.produs || '') + (x.pret ? ' · ' + fmtN(x.pret, 2) : '') }));
  borders.forEach((b) => events.push({ at: b.created_at, ic: '🛂', txt: (b.tip === 'Iesire' ? t.out : t.in) + (b.tara ? ' ' + b.tara : '') + (b.locatie ? ' · ' + b.locatie : '') }));
  docs.forEach((d) => events.push({ at: d.created_at, ic: '📎', txt: t.doc_ev + ': ' + (d.tip || d.file_name || '') }));
  const ts = (x) => { const d = new Date(x.at); return isNaN(d) ? 0 : d.getTime(); };
  events.sort((a, b) => ts(b) - ts(a));
  const km = wbIn.reduce((s, x) => s + num(x.total_km), 0);
  const fl = fuel.reduce((s, x) => s + (/adblue/i.test(x.tip) ? 0 : x.litru), 0);
  const used = wbIn.reduce((s, x) => s + num(x.motorina_folosit), 0);
  const active = ords.filter((o) => o.status === 'Alocat' || o.status === 'In Curs').length;
  let body = tiles([
    [String(active), t.activeOrders], [String(closed), t.closedOrders],
    [String(wbIn.length), t.waybills], [fmtN(km), t.km], [fmtN(fl, 0) + ' L', t.fuelTotal],
    [km > 0 && used > 0 ? fmtN(used / km * 100, 1) : '—', t.avgCons], [fmtN(buys.reduce((s, x) => s + x.pret, 0), 2), t.costTotal],
    [String(borders.length), t.border],
  ]);
  const showEv = events.slice(0, 30);
  body += '<div class="och-info-sub">🕒 ' + esc(t.events) + '</div>' + (showEv.length
    ? '<ul class="och-info-tl">' + showEv.map((e) => '<li><span class="ic">' + e.ic + '</span><span class="d">' + esc(typeof e.at === 'string' && e.at.length === 10 ? fmtD(e.at) : fmtDT(e.at)) + '</span> ' + esc(e.txt) + '</li>').join('') + '</ul>'
      + (events.length > showEv.length ? '<div class="och-info-more">' + esc(t.more(events.length - showEv.length)) + '</div>' : '')
    : '<div class="och-info-empty">' + esc(t.noData) + '</div>');
  return section('📊', t.activity, body);
}

async function renderFleet(cid, t, lang) {
  const rows = await q(`SELECT ${ORDER_COLS} FROM orders o
                         WHERE o.company_id = $1 AND o.email_sofer IS NOT NULL AND o.status IN ('Alocat','In Curs')
                         ORDER BY o.nume_sofer, o.data_incarcare NULLS LAST LIMIT 60`, [cid]);
  await attachStops(cid, rows);
  if (!rows.length) return section('🚚', t.fleet, '<div class="och-info-empty">' + esc(t.noneOnRoad) + '</div>');
  const byDrv = new Map();
  rows.forEach((o) => { if (!byDrv.has(o.email_sofer)) byDrv.set(o.email_sofer, o); });
  let posAll = [];
  try { const { getPositions } = require('./vehiclePositions'); posAll = ((await getPositions(cid)) || {}).positions || []; } catch (_) {}
  const list = [...byDrv.values()].slice(0, 20);
  let geo = 0;
  const out = [];
  for (const o of list) {
    const pos = posAll.find((p) => plateNorm(p.rendszam) === plateNorm(o.rendszam_camion));
    let place = '';
    if (pos && geo < 10) { geo++; place = (await placeOf(pos.lat, pos.lng, lang)) || ''; }
    const nx = o.next ? (o.next.arrived_at ? t.working : t.goingTo) + ': ' + (cityOf(o.next.loc) || o.next.firma || '') + ' (' + (o.next.kind === 'pickup' ? t.pickup : t.delivery) + ')' : t.allDone;
    out.push([o.nume_sofer || '', { __html: '<b>#' + esc(o.fuvar_no || o.id) + '</b>' }, nx, o.rendszam_camion || '',
      pos ? (place ? cityOf(place) || place : '📍') + (num(pos.speed) > 3 ? ' · ' + Math.round(num(pos.speed)) + ' km/h' : '') : '—']);
  }
  return section('🚚', t.fleet, tiles([[String(byDrv.size), t.fleet]]) + table([lang === 'hu' ? 'Sofőr' : 'Șofer', t.orders, t.next, t.vehicle, t.gps], out, t));
}

// Hét / nap időszakok (a közös _period hónap-/év-szintű).
function _weekPeriod(f, now) {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mon = new Date(day); mon.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  if (/\b(ezen a heten|ebben a hetben|e heten|a heten|heti|saptamana (asta|aceasta|curenta)|this week)\b/.test(f)) return { from: iso(mon), to: iso(day) };
  if (/\b(mult heten|mult het\w*|elozo het\w*|saptamana trecuta|last week)\b/.test(f)) {
    const a = new Date(mon); a.setDate(mon.getDate() - 7); const b = new Date(mon); b.setDate(mon.getDate() - 1);
    return { from: iso(a), to: iso(b) };
  }
  if (/\b(tegnap|ieri|yesterday)\b/.test(f)) { const y = new Date(day); y.setDate(day.getDate() - 1); return { from: iso(y), to: iso(y) }; }
  if (/\b(ma|mai nap\w*|azi|astazi|today)\b/.test(f)) return { from: iso(day), to: iso(day) };
  return null;
}

// ─── Fő belépési pont ───
// text: a felhasználó utolsó üzenete; history: korábbi üzenet-szövegek (legújabb elöl).
// → null (nem sofőr-kérdés) | { reply, html, questions, topics, meta }
async function answer(cid, text, history, lang, now) {
  lang = lang === 'hu' ? 'hu' : 'ro';
  const t = L[lang];
  const { topics, f, kmOnly, needsEntity } = detectTopics(text);
  if (!topics.length) return null;
  now = now || new Date();
  const cache = {};

  // Alany: fuvarszám → sofőr / rendszám → előzmény.
  let ent = null;
  const refM = ORDER_REF_RE.exec(String(text || ''));
  if (refM && topics.includes('status')) {
    const ref = refM[1];
    const r = await q(`SELECT o.id FROM orders o WHERE o.company_id = $1 AND (UPPER(o.id) = UPPER($2) OR UPPER(to_jsonb(o)->>'fuvar_no') = UPPER($2)) LIMIT 1`, [cid, ref]);
    if (!r.length) return { reply: t.orderNotFound(ref), html: '', questions: [], topics, meta: {} };
    ent = { order_id: r[0].id, ref };
  }
  if (!ent) ent = await findEntity(cid, text, cache);
  // Puszta km-kérdés alany nélkül inkább a fuvar-vázlatra vonatkozik.
  if ((kmOnly || needsEntity) && (!ent || ent.ambiguous)) return null;
  const fleetAsk = FLEET_RE.test(f);
  if (!ent && !fleetAsk) {
    for (const h of (history || []).slice(0, 8)) {
      const e = await findEntity(cid, h, cache);
      if (e && !e.ambiguous) { ent = e; break; }
    }
  }
  if (ent && ent.ambiguous) {
    const tp = topics[0];
    return { reply: t.ambiguous, html: '', topics, meta: {},
      questions: [{ text: t.ambiguous, options: ent.ambiguous.map((n) => n + ' ' + t.q[tp]) }] };
  }
  if (!ent) {
    if (topics.includes('status')) {
      const html = await renderFleet(cid, t, lang);
      return { reply: '🚚 ' + t.fleet, html: '<div class="och-info">' + html + '</div>', questions: [], topics: ['fleet'], meta: { fleet: true } };
    }
    cache.drivers = cache.drivers || await mi._drivers(cid);
    const tp = topics[0];
    return { reply: t.whichDriver, html: '', topics, meta: {},
      questions: [{ text: t.whichDriver, options: cache.drivers.map((d) => d.nume).filter(Boolean).sort().slice(0, 8).map((n) => n + ' ' + t.q[tp]) }] };
  }
  // Rendszám → a kiosztott sofőr (határ / dokumentum / állapot ehhez kell).
  if (ent.plate && !ent.email) {
    const d = await driverOfPlate(cid, ent.plate);
    if (d) { ent.driver_email = d.email; ent.driver_name = d.nume; }
  }

  // Időszak (alap: utolsó 30 nap).
  const per0 = _weekPeriod(f, now) || mi._period(f, now);
  const defaulted = !per0.from && !per0.to;
  const per = defaulted ? { from: iso(new Date(now.getTime() - DEFAULT_DAYS * 864e5)), to: iso(now) } : { from: per0.from || null, to: per0.to || null };
  const perLabel = defaulted ? t.last30 : (per.from === per.to ? fmtD(per.from) : fmtD(per.from) + ' – ' + fmtD(per.to));

  const needWb = topics.some((x) => ['fuel', 'consumption', 'purchases', 'waybills', 'activity'].includes(x));
  const dataEnt = ent.order_id ? null : ent;
  const personEnt = ent.email ? ent : (ent.driver_email ? { email: ent.driver_email } : {});
  const wbs = needWb && dataEnt ? await loadWaybills(cid, dataEnt, per) : [];
  const fuel = fuelItems(wbs, per);
  const buys = buyItems(wbs, per);
  const pend = (topics.includes('fuel') || topics.includes('purchases')) ? await pendingScans(cid, personEnt, per) : [];
  const borders = (topics.includes('border') || topics.includes('activity')) ? await borderRows(cid, personEnt, per) : [];
  const docs = (topics.includes('docs') || topics.includes('activity')) ? await docRows(cid, personEnt, per) : [];

  const secs = [];
  for (const tp of topics) {
    if (tp === 'status') {
      const s = await renderStatus(cid, ent, t, lang);
      if (s.empty) return { reply: t.orderNotFound(ent.ref || ''), html: '', questions: [], topics, meta: {} };
      secs.push(s.html);
    } else if (!dataEnt) continue;
    else if (tp === 'fuel') secs.push(renderFuel(fuel, pend, t));
    else if (tp === 'consumption') secs.push(await renderConsumption(cid, wbs, per, ent, t));
    else if (tp === 'purchases') secs.push(renderPurchases(buys, pend, t, lang));
    else if (tp === 'waybills') secs.push(renderWaybills(wbs, per, t));
    else if (tp === 'border') secs.push(personEnt.email ? renderBorder(borders, t) : section('🛂', t.border, '<div class="och-info-empty">' + esc(t.noData) + '</div>'));
    else if (tp === 'docs') secs.push(personEnt.email ? renderDocs(docs, t) : section('📎', t.docs, '<div class="och-info-empty">' + esc(t.noData) + '</div>'));
    else if (tp === 'activity') secs.push(await renderActivity(cid, dataEnt, per, wbs, fuel, buys, borders, docs, t));
  }
  const who = ent.name || ent.plate_label || (ent.ref ? '#' + ent.ref : '') || '';
  const subj = ent.plate_label && ent.driver_name ? ent.plate_label + ' (' + ent.driver_name + ')' : who;
  const showPer = topics.some((x) => x !== 'status');
  const head = '<div class="och-info-h">' + (ent.plate ? '🚚 ' : ent.order_id ? '📦 ' : '👤 ') + esc(subj)
    + (showPer ? ' <span class="och-info-p">' + esc(perLabel) + '</span>' : '') + '</div>';
  const reply = (ent.plate ? '🚚 ' : ent.order_id ? '📦 ' : '👤 ') + subj + ' — ' + topics.map((x) => t[x]).join(', ').toLowerCase() + (showPer ? ' (' + perLabel + ')' : '');
  return { reply, html: '<div class="och-info">' + head + secs.join('') + '</div>', questions: [], topics,
    meta: { entity: ent.plate ? 'vehicle' : ent.order_id ? 'order' : 'driver', learned: !!ent.learned } };
}

module.exports = { answer, detectTopics, cityOf, _L: L,
  // Közös segédek a többi chat-modulnak (lib/chatOps.js).
  _h: { esc, fmtD, fmtDT, fmtN, num, iso, plateNorm, cityOf, tiles, table, section, findEntity, attachStops, livePos, placeOf, renderFleet, q } };
