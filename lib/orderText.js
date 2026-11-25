// ============================================================
//  VallorSoft — lib/orderText.js
//  Fuvar-megbízás / megrendelő (Comandă de transport) kiolvasása a SZÖVEGBŐL,
//  AI NÉLKÜL, a saját szerveren (lib/docPrivacy: a dokumentum nem mehet ki).
//
//  A bemenet a PDF szövegrétege VAGY a helyi OCR (lib/localOcr) szövege.
//  Felirat-alapú (címke → érték) kiolvasás RO / HU / EN / DE nyelven:
//    „Loc încărcare: …", „Data descărcării: …", „Felrakás helye", „Loading
//    address", „Entladestelle", „Preț transport: 1.200 EUR", „Nr. auto" …
//  Blokkos elrendezést is ért („ÎNCĂRCARE 1" fejléc alatt Adresa/Firma/Data
//  sorok) → több felrakó / lerakó pont (multi-drop) is.
//
//  Kimenet: a services/order-ai FIELDS mező-készlete (client, client_cui, ref,
//  loc_*, firma_*, data_*, pret, valuta, km, greutate, load_type, *_cm,
//  rendszam_*, observatii, pickups, deliveries) + confidence (0..1).
//  Best-effort: amit nem talál, az null — a diszpécser pótolja.
// ============================================================
'use strict';

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ── Címke-szótárak (ékezet nélküli, kisbetűs alakban illesztünk) ──
const PICK_KW = /(incarc|loading|load\s*(?:place|point|address|date|site)|pick[\s-]?up|collection|felrak|felvetel|berak|belad|ladestelle|ladeort|ladedatum|abhol|beladung|expeditie)/;
const DELV_KW = /(descarc|unloading|unload|delivery|deliver|livrare|lerak|kirak|entlad|abladestelle|anlieferung|zustell|destinatie)/;
const DATE_KW = /(\bdata\b|\bdate\b|datum|datuma|\bziua\b|\bnap\b|\bday\b|termen|ora\b|time|idopont|\bzeit\b|interval)/;
const ADDR_KW = /(\bloc\b|locul|locatie|localitate|adresa|address|adress|\bplace\b|\bpoint\b|punct|helye|\bhely\b|\bcim\b|cime|\bort\b|stelle|anschrift|oras|city|site)/;
const FIRM_KW = /(firma|societate|company|compania|\bceg\b|cegnev|firmenname|\bname\b|denumire|expeditor|destinatar|shipper|consignee|sender|receiver|absender|empfanger|felado|cimzett|atvevo)/;
const SHIPPER_KW = /(expeditor|shipper|sender|absender|felado|incarcator)/;
const CONSIGNEE_KW = /(destinatar|consignee|receiver|empfanger|cimzett|atvevo|primitor)/;
const CLIENT_KW = /(beneficiar|comanditar|comandant|ordonator|client\b|clientul|customer|principal|ordering\s*party|auftraggeber|kunde|megbizo|megrendelo|ugyfel|platitor|bill\s*to|invoice\s*to|facturare\s*catre)/;
const CARRIER_KW = /(transportator|carrier|fuvarozo|frachtfuhrer|spediteur|prestator|executant)/;
const PRICE_KW = /(pret|tarif|valoare|cost\b|price|rate\b|freight|fracht|\bar\b|fuvardij|dij\b|suma|total|honorar|vergutung|frachtpreis)/;
const WEIGHT_KW = /(greutate|weight|gewicht|\bsuly\b|tonaj|tonnage|masa\b|tomeg|brutto|gross)/;
const KM_KW = /(distanta|distance|entfernung|tavolsag|\bkm\b|kilometri)/;
const REF_KW = /(nr\.?\s*comanda|comanda\s*(?:nr|numar|no)|numar\s*comanda|order\s*(?:no|nr|number|#)|ref(?:erinta|erence)?\b|auftrags?\s*(?:nr|nummer)|megbizas\s*(?:szama|sz)|rendeles\s*(?:szam|sz)|fuvarszam|booking|transport\s*(?:no|nr))/;
const PLATE_KW = /(nr\.?\s*(?:auto|inmatriculare|inm)|numar\s*(?:auto|inmatriculare)|inmatriculare|plate|registration|reg\.?\s*no|truck|tractor|camion|cap\s*tractor|remorca|semiremorca|trailer|kennzeichen|rendszam|vontato|potkocsi|auflieger|lkw)/;
const TRAILER_KW = /(remorca|semiremorca|trailer|auflieger|anhanger|potkocsi|vlecka)/;
const NOTE_KW = /(observatii|mentiuni|remarks|notes?\b|instructiuni|instructions|bemerkung|hinweis|megjegyzes|utasitas|conditii\s*speciale)/;
const ROUTE_KW = /(ruta|relatia|traseu|route|strecke|relacio|utvonal)/;
const DIM_KW = /(dimensiun|dimension|marime|abmessung|meret|l\s*x\s*l\s*x\s*h|lxlxh)/;

const COMPANY_RE = /\b(s\.?\s*r\.?\s*l\.?|s\.?\s*a\.?|kft\.?|zrt\.?|bt\.?|gmbh|ltd\.?|llc|s\.?\s*p\.?\s*a\.?|s\.?\s*r\.?\s*o\.?|sp\.?\s*z\s*o\.?\s*o\.?|b\.?\s*v\.?|a\.?\s*g\.?|kg|e\.?\s*k\.?|pfa|s\.?\s*c\.?)\b/i;

const CUR_RE = /(EUR|€|EURO|RON|LEI|HUF|Ft\b|USD|\$|PLN|GBP|£|CHF|CZK|BGN)/i;
function _cur(s) {
  const m = CUR_RE.exec(s || '');
  if (!m) return null;
  const c = m[1].toUpperCase();
  if (c === '€' || c === 'EURO') return 'EUR';
  if (c === 'LEI') return 'RON';
  if (c === 'FT') return 'HUF';
  if (c === '$') return 'USD';
  if (c === '£') return 'GBP';
  return c;
}

// Szám-értelmezés: "1.200,50" / "1,200.50" / "1 200" / "1200" / "12,5"
function parseNum(raw) {
  let s = String(raw || '').replace(/[\s  ']/g, '');
  if (!/\d/.test(s)) return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) {
    if (lc > ld) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lc >= 0) {
    // "1,200" (ezres) vs "12,5" (tizedes)
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (ld >= 0) {
    s = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
const NUM_SRC = '(\\d{1,3}(?:[ .,  ]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';

// ── Dátum ──
function _iso(d, m, y) {
  let yy = +y; if (yy < 100) yy += 2000;
  const dd = +d, mm = +m;
  if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && yy >= 2000 && yy <= 2100)) return null;
  const dt = new Date(Date.UTC(yy, mm - 1, dd));
  if (dt.getUTCMonth() !== mm - 1) return null;
  return yy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
}
const MONTHS = {
  ian: 1, jan: 1, ianuarie: 1, january: 1, januar: 1, januari: 1,
  feb: 2, februarie: 2, february: 2, februar: 2,
  mar: 3, martie: 3, march: 3, marz: 3, marc: 3, marcius: 3,
  apr: 4, aprilie: 4, april: 4, aprilis: 4,
  mai: 5, may: 5, maj: 5, majus: 5,
  iun: 6, iunie: 6, june: 6, juni: 6, jun: 6, junius: 6,
  iul: 7, iulie: 7, july: 7, juli: 7, jul: 7, julius: 7,
  aug: 8, august: 8, augusztus: 8,
  sep: 9, sept: 9, septembrie: 9, september: 9, szeptember: 9,
  oct: 10, octombrie: 10, october: 10, oktober: 10, okt: 10,
  noi: 11, nov: 11, noiembrie: 11, november: 11,
  dec: 12, decembrie: 12, december: 12, dezember: 12, dez: 12,
};
// → { date: 'YYYY-MM-DD', time: 'HH:MM'|null, index } | null
function findDate(s) {
  const str = String(s || '');
  const cands = [];
  let m;
  const reIso = /\b(20\d{2})[-.\/](\d{1,2})[-.\/](\d{1,2})\b/g;
  while ((m = reIso.exec(str))) { const d = _iso(m[3], m[2], m[1]); if (d) cands.push({ date: d, index: m.index, end: m.index + m[0].length }); }
  const reEu = /\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})\b/g;
  while ((m = reEu.exec(str))) { const d = _iso(m[1], m[2], m[3]); if (d) cands.push({ date: d, index: m.index, end: m.index + m[0].length }); }
  const fs = fold(str);
  const reTxt = /\b(\d{1,2})\.?\s+([a-z]{3,10})\.?\s+(20\d{2})\b/g;
  while ((m = reTxt.exec(fs))) { const mo = MONTHS[m[2]]; const d = mo ? _iso(m[1], mo, m[3]) : null; if (d) cands.push({ date: d, index: m.index, end: m.index + m[0].length }); }
  if (!cands.length) return null;
  cands.sort((a, b) => a.index - b.index);
  const c = cands[0];
  const after = str.slice(c.end, c.end + 25);
  const before = str.slice(Math.max(0, c.index - 12), c.index);
  const tm = /(?:^|[\s,;T-]|ora|h)\s*([01]?\d|2[0-3])[:.h]([0-5]\d)\b/i.exec(after) || /\b([01]?\d|2[0-3]):([0-5]\d)\s*$/.exec(before);
  const time = tm ? String(tm[1]).padStart(2, '0') + ':' + tm[2] : null;
  return { date: c.date, time, index: c.index };
}
function _dateVal(s) {
  const d = findDate(s);
  if (!d) return null;
  return d.time ? d.date + 'T' + d.time : d.date;
}

// ── Sor-szerkezet ──
// Egy sor címkére és értékre bontása: "Loc încărcare: Oradea" → { label, value }
function splitLabel(line) {
  const l = String(line || '');
  const m = /^\s*([^:]{1,60}?)\s*[:：]\s*(.*)$/.exec(l);
  if (m) return { label: m[1], value: m[2].trim(), colon: true };
  // Tab-bal / sok szóközzel elválasztott két oszlop
  const t = /^\s*(\S.{0,50}?)(?:\t+| {3,})(\S.*)$/.exec(l);
  if (t) return { label: t[1], value: t[2].trim(), colon: false };
  return { label: l.trim(), value: '', colon: false };
}

function _isLabelLine(line) {
  const sp = splitLabel(line);
  const f = fold(sp.label);
  if (!sp.colon && f.length > 45) return false;
  return PICK_KW.test(f) || DELV_KW.test(f) || DATE_KW.test(f) || ADDR_KW.test(f) || FIRM_KW.test(f) ||
    CLIENT_KW.test(f) || PRICE_KW.test(f) || WEIGHT_KW.test(f) || REF_KW.test(f) || PLATE_KW.test(f) ||
    NOTE_KW.test(f) || CARRIER_KW.test(f);
}

// Érték, vagy ha a címke után üres, a következő 1–2 nem-címke sor.
function _valueOrNext(lines, i, maxLines) {
  const sp = splitLabel(lines[i]);
  if (sp.value) return { value: sp.value, used: 0 };
  const out = [];
  let j = i + 1;
  for (; j < lines.length && out.length < (maxLines || 2); j++) {
    const l = lines[j].trim();
    if (!l) { if (out.length) break; continue; }
    if (_isLabelLine(l)) break;
    out.push(l);
  }
  return { value: out.join(', '), used: j - i - 1 };
}

// A cím-szövegből kiveszi a dátumot/órát és a felesleges jeleket.
function _cleanAddr(s) {
  let v = String(s || '');
  v = v.replace(/\b(20\d{2})[-.\/]\d{1,2}[-.\/]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}[.\/-]\d{1,2}[.\/-](?:\d{4}|\d{2})\b/g, ' ')
    .replace(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g, ' ')
    .replace(/\s{2,}/g, ' ').replace(/^[\s,;:\-–]+|[\s,;:\-–]+$/g, '').trim();
  return v.length >= 2 ? v.slice(0, 200) : null;
}

// Ha az érték elején cégnév áll ("Alfa SRL, Str. X, Cluj"), szétválasztja.
function _splitFirmAddr(v) {
  const parts = String(v || '').split(/\s*[,;|]\s*/);
  if (parts.length >= 2 && COMPANY_RE.test(parts[0]) && parts[0].length <= 80) {
    return { firma: parts[0].trim(), addr: parts.slice(1).join(', ').trim() };
  }
  return { firma: null, addr: v };
}

function _newStop() { return { loc: null, firma: null, data: null }; }

// ── Fő kiolvasó ──
// opts: { ownNames: [cégnév…], ownCui: '47859317' } — a saját (fuvarozó) cég,
// hogy ne olvassuk ki megbízóként.
function parseOrderText(text, opts) {
  const o = opts || {};
  const ownCui = String(o.ownCui || '').replace(/\D/g, '');
  const ownNames = (o.ownNames || []).map((n) => fold(n).replace(COMPANY_RE, '').replace(/[^a-z0-9 ]/g, ' ').trim()).filter((n) => n.length >= 3);
  const isOwn = (s) => {
    const f = fold(s).replace(/[^a-z0-9 ]/g, ' ');
    return ownNames.some((n) => f.includes(n));
  };

  const raw = String(text || '').replace(/\r/g, '').replace(/ /g, ' ');
  const lines = raw.split('\n').map((l) => l.replace(/\s+$/, ''));
  const fields = {
    client: null, client_cui: null, ref: null,
    loc_incarcare: null, loc_descarcare: null,
    firma_incarcare: null, firma_descarcare: null,
    data_incarcare: null, data_descarcare: null,
    pret: null, valuta: null, km: null, greutate: null,
    load_type: null, hossz_cm: null, szel_cm: null, mag_cm: null,
    rendszam_camion: null, rendszam_remorca: null, observatii: null,
    pickups: null, deliveries: null,
  };
  if (!raw.trim()) return { fields, confidence: 0, found: 0 };

  const stops = { P: [], D: [] };
  let cur = null;          // { kind, stop, line }
  // A kind utolsó stopja kapja az értéket, ha ott még üres a mező; különben új stop.
  // (Lapos elrendezés: „Loc încărcare / Loc descărcare / Data încărcare" → mind a
  // két első stophoz; blokkos: a fejléc-sor nyit új stopot.)
  const curFor = (kind, attr, lineNo) => {
    const list = stops[kind];
    const last = list[list.length - 1];
    if (last && !last[attr]) { cur = { kind, stop: last, line: lineNo }; return last; }
    const s = _newStop(); list.push(s); cur = { kind, stop: s, line: lineNo };
    return s;
  };
  const setAttr = (kind, attr, val, lineNo) => {
    if (!val) return;
    const s = curFor(kind, attr, lineNo);
    s[attr] = val;
  };
  // Egy szabad érték a stop-blokkban: cím (+ benne dátum / cég)
  const fillStop = (kind, value, lineNo) => {
    const dv = _dateVal(value);
    const sf = _splitFirmAddr(value);
    const addr = _cleanAddr(sf.addr);
    if (sf.firma) setAttr(kind, 'firma', sf.firma.slice(0, 200), lineNo);
    if (addr && /[a-z]{3,}/i.test(addr) && !(DATE_KW.test(fold(addr)) && addr.length < 15)) setAttr(kind, 'loc', addr, lineNo);
    if (dv) setAttr(kind, 'data', dv, lineNo);
  };

  let clientCuiLine = -1;
  const notes = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const sp = splitLabel(line);
    const f = fold(sp.label);
    const fl = fold(line);
    const shortLabel = sp.colon || f.length <= 45;

    // A lerakó előbb: az „unloading" a „loading"-ot is tartalmazza.
    const isD = shortLabel && DELV_KW.test(f);
    const isP = shortLabel && !isD && PICK_KW.test(f);
    const kind = isP ? 'P' : (isD ? 'D' : null);

    // Feladó / címzett cég → a felrakó / lerakó cége
    if (shortLabel && (SHIPPER_KW.test(f) || CONSIGNEE_KW.test(f)) && !CLIENT_KW.test(f)) {
      const k = SHIPPER_KW.test(f) ? 'P' : 'D';
      const { value } = _valueOrNext(lines, i, 1);
      const sf = _splitFirmAddr(value);
      const firm = (sf.firma || value).split(/\s*[,;]\s*/)[0];
      if (firm && firm.length >= 2) setAttr(k, 'firma', firm.slice(0, 200), i);
      if (sf.firma && sf.addr) setAttr(k, 'loc', _cleanAddr(sf.addr), i);
      continue;
    }

    if (kind) {
      const { value, used } = _valueOrNext(lines, i, 2);
      const hasDate = DATE_KW.test(f);
      const hasAddr = ADDR_KW.test(f);
      const hasFirm = FIRM_KW.test(f) && !hasAddr;
      if (hasDate && !hasAddr) {
        const dv = _dateVal(value || line);
        if (dv) setAttr(kind, 'data', dv, i);
      } else if (hasFirm) {
        if (value) setAttr(kind, 'firma', value.split(/\s*[,;]\s*/)[0].slice(0, 200), i);
      } else if (value) {
        // Fejléc-sor értékkel („Încărcare 1: Alfa SRL, Cluj, 12.11.2026") vagy cím-címke
        const numbered = /\b(\d{1,2})\s*$/.test(f) || /\b(?:nr|#)\s*\d/.test(f);
        if (numbered && stops[kind].length && stops[kind][stops[kind].length - 1].loc) { const s = _newStop(); stops[kind].push(s); cur = { kind, stop: s, line: i }; }
        fillStop(kind, value, i);
      } else {
        // Csak fejléc („ÎNCĂRCARE", „Loading point 2") → új stop-blokk
        const last = stops[kind][stops[kind].length - 1];
        if (!last || last.loc || last.firma || last.data) { const s = _newStop(); stops[kind].push(s); cur = { kind, stop: s, line: i }; }
        else cur = { kind, stop: last, line: i };
      }
      i += used;
      continue;
    }

    // Stop-blokkon belüli általános sorok: Adresa / Firma / Data
    if (cur && i - cur.line <= 8 && shortLabel && sp.label && !CLIENT_KW.test(f) && !PRICE_KW.test(f) && !WEIGHT_KW.test(f) && !PLATE_KW.test(f) && !REF_KW.test(f)) {
      if (DATE_KW.test(f) && !ADDR_KW.test(f)) {
        const dv = _dateVal(sp.value || line);
        if (dv) { setAttr(cur.kind, 'data', dv, i); continue; }
      } else if (FIRM_KW.test(f) && !ADDR_KW.test(f)) {
        const { value, used } = _valueOrNext(lines, i, 1);
        if (value) { setAttr(cur.kind, 'firma', value.split(/\s*[,;]\s*/)[0].slice(0, 200), i); i += used; continue; }
      } else if (ADDR_KW.test(f) && !ROUTE_KW.test(f)) {
        const { value, used } = _valueOrNext(lines, i, 2);
        if (value) { fillStop(cur.kind, value, i); i += used; continue; }
      }
    }

    // ── Megbízó ──
    if (!fields.client && shortLabel && CLIENT_KW.test(f) && !CARRIER_KW.test(f)) {
      const { value } = _valueOrNext(lines, i, 1);
      const name = value.split(/\s*[,;]\s*/)[0].replace(/\b(?:CUI|CIF|Cod fiscal)\b.*$/i, '').trim();
      if (name && name.length >= 2 && !isOwn(name)) { fields.client = name.slice(0, 200); clientCuiLine = i; }
    }
    // ── Referencia ──
    if (!fields.ref) {
      const fr = REF_KW.exec(fl);
      if (fr) {
        const after = line.slice(Math.min(line.length, fr.index + fr[0].length));
        const rm = /^[\s.:#№°]*(?:nr\.?|no\.?|numar)?[\s.:#№°]*([A-Z0-9][A-Z0-9\-\/_.]{1,30})/i.exec(after);
        if (rm && /\d/.test(rm[1]) && !/^\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}$/.test(rm[1])) fields.ref = rm[1].replace(/[.,]$/, '');
      }
    }
    // ── Ár ──
    if (fields.pret == null && shortLabel && PRICE_KW.test(f) && !/(marfa|goods|ware|arucikk|asigur)/.test(f)) {
      const { value } = _valueOrNext(lines, i, 1);
      const src = value || line;
      const pm = new RegExp(NUM_SRC + '\\s*(EUR|€|EURO|RON|LEI|HUF|Ft|USD|PLN|CHF)?', 'i').exec(src.replace(/\b(?:20\d{2})[-.\/]\d{1,2}[-.\/]\d{1,2}\b|\b\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}\b/g, ' '));
      if (pm) {
        const n = parseNum(pm[1]);
        if (n && n >= 10 && n < 10000000) { fields.pret = n; fields.valuta = fields.valuta || _cur(src); }
      }
    }
    // ── Súly ──
    if (fields.greutate == null && WEIGHT_KW.test(fl)) {
      const wm = new RegExp(NUM_SRC + '\\s*(kg|kgs|t\\b|to\\b|tone|tonnes|tons|tonna)', 'i').exec(line);
      if (wm) {
        let n = parseNum(wm[1]);
        if (n != null && /^(t|to|tone|tonnes|tons|tonna)$/i.test(wm[2])) n = n * 1000;
        if (n && n > 0 && n <= 45000) fields.greutate = Math.round(n);
      }
    }
    // ── Távolság ──
    if (fields.km == null && KM_KW.test(fl)) {
      const km = new RegExp(NUM_SRC + '\\s*km\\b', 'i').exec(line) || (KM_KW.test(f) ? new RegExp(NUM_SRC).exec(sp.value) : null);
      if (km) { const n = parseNum(km[1]); if (n && n >= 5 && n < 20000) fields.km = Math.round(n); }
    }
    // ── Rendszám ──
    if (shortLabel && PLATE_KW.test(f)) {
      const { value } = _valueOrNext(lines, i, 1);
      const plates = findPlates(value || line);
      if (plates.length) {
        if (TRAILER_KW.test(f) && !/(cap|tractor|truck|camion|vontato|lkw)/.test(f)) { fields.rendszam_remorca = fields.rendszam_remorca || plates[0]; }
        else {
          fields.rendszam_camion = fields.rendszam_camion || plates[0];
          if (plates[1]) fields.rendszam_remorca = fields.rendszam_remorca || plates[1];
        }
      }
    }
    // ── Útvonal: „Ruta: Oradea - Budapest" ──
    if (shortLabel && ROUTE_KW.test(f) && sp.value) {
      const rp = sp.value.split(/\s*(?:→|->|–|—|-|\/|>)\s*/).map((x) => _cleanAddr(x)).filter(Boolean);
      if (rp.length >= 2) {
        if (!stops.P.length) stops.P.push({ loc: rp[0], firma: null, data: null });
        if (!stops.D.length) stops.D.push({ loc: rp[rp.length - 1], firma: null, data: null });
      }
    }
    // ── Megjegyzés ──
    if (shortLabel && NOTE_KW.test(f)) {
      const { value } = _valueOrNext(lines, i, 3);
      if (value) notes.push(value);
    }
    // ── Méretek ──
    if (fields.hossz_cm == null) {
      const dm = /(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b/i.exec(line);
      if (dm) {
        const mul = { mm: 0.1, cm: 1, m: 100 }[dm[4].toLowerCase()];
        const a = [dm[1], dm[2], dm[3]].map((x) => Math.round(parseNum(x) * mul));
        if (a.every((x) => x > 0 && x <= 2000)) { fields.hossz_cm = a[0]; fields.szel_cm = a[1]; fields.mag_cm = a[2]; }
      }
    }
    // ── Rakomány-típus ──
    if (!fields.load_type) {
      if (/\b(ftl|full\s*truck(?:\s*load)?|camion\s*complet|marfa\s*completa|incarcare\s*completa|komplettladung|teljes\s*rakomany|komplett)\b/.test(fl)) fields.load_type = 'FTL';
      else if (/\b(ltl|grupaj|groupage|partial(?:a)?\s*(?:load|incarcare)?|teilladung|sammelgut|reszrakomany|gyujto)\b/.test(fl)) fields.load_type = 'LTL';
    }
  }

  // ── CUI: a megbízó-sor közelében, különben az első nem saját ──
  const cuiRe = /\b(?:C\.?U\.?I\.?|C\.?I\.?F\.?|Cod\s+fiscal|VAT(?:\s*(?:no|nr|id))?|Cod\s+TVA|Adószám|USt-?IdNr\.?)\s*[:.]?\s*((?:RO|HU|DE)?\s?\d{6,11})\b/gi;
  const cuis = [];
  lines.forEach((l, idx) => { let m; cuiRe.lastIndex = 0; while ((m = cuiRe.exec(l))) cuis.push({ v: m[1].replace(/\s/g, '').toUpperCase(), idx }); });
  const notOwn = cuis.filter((c) => c.v.replace(/\D/g, '') !== ownCui);
  if (notOwn.length) {
    const near = clientCuiLine >= 0 ? notOwn.filter((c) => c.idx >= clientCuiLine && c.idx - clientCuiLine <= 5)[0] : null;
    fields.client_cui = (near || notOwn[0]).v;
  }

  // ── Megbízó tartalék: a fejléc első cégneve, ami nem a saját cég ──
  if (!fields.client) {
    for (let i = 0; i < Math.min(lines.length, 25); i++) {
      const l = lines[i].trim();
      if (!l || l.length > 90 || !COMPANY_RE.test(l)) continue;
      const f = fold(l);
      if (CARRIER_KW.test(f) || PICK_KW.test(f) || DELV_KW.test(f) || SHIPPER_KW.test(f) || CONSIGNEE_KW.test(f) || isOwn(l)) continue;
      const nm = splitLabel(l).value || l;
      fields.client = nm.split(/\s*[,;]\s*/)[0].slice(0, 200);
      break;
    }
  }

  // ── Pénznem tartalék ──
  if (!fields.valuta && fields.pret != null) fields.valuta = _cur(raw);

  // ── Rendszám tartalék: címke nélkül az első két rendszám-szerű érték ──
  if (!fields.rendszam_camion) {
    const pl = findPlates(raw, true);
    if (pl[0]) fields.rendszam_camion = pl[0];
    if (pl[1] && !fields.rendszam_remorca) fields.rendszam_remorca = pl[1];
  }

  // ── Dátum tartalék: ha nincs felrakás-dátum, az első dátum a dokumentumban ──
  const clean = (list) => list.map((s) => ({ loc: s.loc || null, firma: s.firma || null, data: s.data || null }))
    .filter((s) => s.loc || s.firma || s.data);
  const P = clean(stops.P), D = clean(stops.D);
  if (P[0]) { fields.loc_incarcare = P[0].loc; fields.firma_incarcare = P[0].firma; fields.data_incarcare = P[0].data; }
  if (D.length) { const d0 = D[0]; fields.loc_descarcare = d0.loc; fields.firma_descarcare = d0.firma; fields.data_descarcare = d0.data; }
  if (P.length > 1 || D.length > 1) { fields.pickups = P.length ? P : null; fields.deliveries = D.length ? D : null; }
  if (!fields.data_incarcare && !P.length) { const d = findDate(raw); if (d) fields.data_incarcare = d.time ? d.date + 'T' + d.time : d.date; }

  if (notes.length) fields.observatii = notes.join(' · ').slice(0, 500);

  // ── Bizonyosság: a fő mezők kitöltöttsége ──
  const KEY = ['client', 'loc_incarcare', 'loc_descarcare', 'data_incarcare', 'data_descarcare', 'pret'];
  const MINOR = ['ref', 'client_cui', 'firma_incarcare', 'firma_descarcare', 'greutate', 'rendszam_camion', 'valuta'];
  const k = KEY.filter((x) => fields[x] != null).length;
  const mi = MINOR.filter((x) => fields[x] != null).length;
  const found = k + mi;
  const confidence = Math.min(0.9, Math.round(((k / KEY.length) * 0.75 + (mi / MINOR.length) * 0.15) * 100) / 100);
  return { fields, confidence, found };
}

// Rendszám-szerű értékek (RO: B 104 VLR, CJ 12 ABC; HU: ABC-123, AA-BB-123; DE: M-AB 1234).
function findPlates(s, strict) {
  const out = [];
  const str = String(s || '').toUpperCase();
  const res = [
    /\b(B[\s-]?\d{2,3}[\s-]?[A-Z]{3})\b/g,
    /\b((?:AB|AR|AG|BC|BH|BN|BT|BV|BR|BZ|CS|CL|CJ|CT|CV|DB|DJ|GL|GR|GJ|HR|HD|IL|IS|IF|MM|MH|MS|NT|OT|PH|SM|SJ|SB|SV|TR|TM|TL|VS|VL|VN)[\s-]?\d{2}[\s-]?[A-Z]{3})\b/g,
  ];
  if (!strict) {
    res.push(/\b([A-Z]{3}[\s-]?\d{3})\b/g, /\b([A-Z]{2}[\s-]?[A-Z]{2}[\s-]?\d{3})\b/g, /\b([A-Z]{1,3}[\s-][A-Z]{1,2}[\s-]?\d{1,4})\b/g);
  }
  for (const re of res) {
    let m;
    while ((m = re.exec(str))) {
      const p = m[1].replace(/[\s-]/g, '');
      if (/^(CUI|CIF|EUR|RON|NR|TVA|VAT)/.test(p)) continue;
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

module.exports = { parseOrderText, findDate, findPlates, parseNum, fold };
