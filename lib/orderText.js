// ============================================================
//  VallorSoft — lib/orderText.js
//  Fuvar-megbízás / megrendelő (Comandă de transport) kiolvasása a SZÖVEGBŐL,
//  AI NÉLKÜL, a saját szerveren (lib/docPrivacy: a dokumentum nem mehet ki).
//
//  A bemenet a PDF szövegrétege VAGY a helyi OCR (lib/localOcr) szövege.
//  Működés:
//   1. Sor-előkészítés: a két sorra tört címkék összefűzése („Loc de" +
//      „descărcare").
//   2. Szegmentálás: minden sorban megkeressük az ISMERT CÍMKÉKET (RO/HU/EN/DE,
//      ékezet-függetlenül), a sor bármely pontján — a PDF táblázatai gyakran
//      egybeolvasztják a címkét és az értéket („Loc de încărcareDebrecen",
//      „ReferințăDLT-084Tip transportFTL"). Egy találat akkor címke, ha
//      kettőspont / sorvég / egybeolvadt Nagybetű-szám követi.
//   3. Mezőkhöz rendelés kontextussal: a „Data / interval", „Adresa", „Firma"
//      az utoljára megnyitott felrakó / lerakó ponthoz kerül (több pont is).
//   4. Folyó szöveges tartalékok: „emisă de X SRL", „tariful … este de 1.760 EUR",
//      „greutatea … 11.400 kg", „Traseu: Linz → Timișoara".
//
//  Kimenet: a services/order-ai FIELDS mező-készlete + confidence (0..1).
//  Best-effort: amit nem talál, az null — a diszpécser pótolja.
//  Új nyelv / felirat = új sor a LABELS listában + teszt (tests/unit/orderText.test.js).
// ============================================================
'use strict';

// Ékezet-mentes kisbetűs alak, KARAKTERENKÉNT (a hossz nem változik → a
// pozíciók az eredeti szövegre visszavetíthetők).
function foldKeep(s) {
  let out = '';
  for (const ch of String(s || '')) {
    const b = ch.normalize('NFD')[0] || ch;
    const l = b.toLowerCase();
    out += (l.length === ch.length) ? l : ch;
  }
  return out;
}
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ── Címke-szótár: [mező, minta (ékezet nélkül, kisbetűvel)] ──
// p_* = felrakó, d_* = lerakó; date/addr/firm = az aktuális ponthoz.
const LABELS = [
  // Megbízó
  ['client', 'comandant(?:ul)?'], ['client', 'beneficiar(?:ul)?'], ['client', 'comanditar(?:ul)?'],
  ['client', 'ordonator(?:ul)?'], ['client', 'emitent(?:ul)?'], ['client', 'client(?:ul)?'],
  ['client', 'ordering party'], ['client', 'customer'], ['client', 'principal'],
  ['client', 'auftraggeber'], ['client', 'megbizo'], ['client', 'megrendelo'], ['client', 'ugyfel'], ['client', 'kunde'],
  ['client', 'issued by'], ['client', 'kiallito'],
  // Fuvarozó (csak kihagyásra)
  ['carrier', 'transportator(?:ul)?'], ['carrier', 'carrier'], ['carrier', 'fuvarozo'], ['carrier', 'frachtfuhrer'],
  ['carrier', 'subcontractor'], ['carrier', 'executant'],
  // Felrakó hely
  ['p_loc', 'loc(?:ul)? de incarcare'], ['p_loc', 'loc(?:ul)? incarcar(?:e|ii)'], ['p_loc', 'punct(?:ul)? de incarcare'],
  ['p_loc', 'adresa (?:de )?incarcare'], ['p_loc', 'adresa incarcarii'], ['p_loc', 'incarcarea'], ['p_loc', 'incarcare'],
  ['p_loc', 'loading (?:place|point|address|site|location)'], ['p_loc', 'place of loading'], ['p_loc', 'loading'],
  ['p_loc', 'pick[- ]?up (?:address|place|point|location)'], ['p_loc', 'pick[- ]?up'], ['p_loc', 'collection (?:address|point)'],
  ['p_loc', 'felrakas(?:i)? (?:helye|cime|hely|pont)'], ['p_loc', 'felrakodas(?:i)? (?:helye|cime|hely)'],
  ['p_loc', 'felrakohely'], ['p_loc', 'felrako'], ['p_loc', 'felrakas'], ['p_loc', 'felrakodas'], ['p_loc', 'rakodas helye'],
  ['p_loc', 'beladestelle'], ['p_loc', 'ladestelle'], ['p_loc', 'beladeort'], ['p_loc', 'ladeort'], ['p_loc', 'beladung'],
  ['p_loc', 'abholadresse'], ['p_loc', 'loc(?:ul)? de ridicare'], ['p_loc', 'punct(?:ul)? de ridicare'],
  ['p_loc', 'adresa (?:de )?ridicare'], ['p_loc', 'ridicare(?:a)?'], ['p_loc', 'preluare(?:a)?'], ['p_loc', 'loc(?:ul)? de preluare'],
  ['p_loc', 'felvetel(?:i)? (?:helye|cime)'], ['p_loc', 'atvetel(?:i)? (?:helye|cime)'],
  // Lerakó hely
  ['d_loc', 'loc(?:ul)? de descarcare'], ['d_loc', 'loc(?:ul)? descarcar(?:e|ii)'], ['d_loc', 'punct(?:ul)? de descarcare'],
  ['d_loc', 'adresa (?:de )?descarcare'], ['d_loc', 'adresa descarcarii'], ['d_loc', 'adresa de livrare'],
  ['d_loc', 'loc(?:ul)? de livrare'], ['d_loc', 'descarcarea'], ['d_loc', 'descarcare'], ['d_loc', 'livrare'],
  ['d_loc', 'unloading (?:place|point|address|site|location)'], ['d_loc', 'place of (?:un)?delivery'],
  ['d_loc', 'place of unloading'], ['d_loc', 'unloading'],
  ['d_loc', 'delivery (?:address|place|point|location)'], ['d_loc', 'delivery'], ['d_loc', 'destination'],
  ['d_loc', 'lerakas(?:i)? (?:helye|cime|hely|pont)'], ['d_loc', 'lerakodas(?:i)? (?:helye|cime|hely)'],
  ['d_loc', 'lerakohely'], ['d_loc', 'lerako'], ['d_loc', 'lerakas'], ['d_loc', 'lerakodas'], ['d_loc', 'kirakodas'],
  ['d_loc', 'entladestelle'], ['d_loc', 'abladestelle'], ['d_loc', 'entladeort'],
  ['d_loc', 'lieferadresse'], ['d_loc', 'entladung'],
  // Felrakás dátuma
  ['p_date', 'data (?:de )?incarcar(?:e|ii)'], ['p_date', 'prezentare(?:a)? la (?:rampa|incarcare)'],
  ['p_date', 'ora (?:de )?incarcare'], ['p_date', 'termen(?:ul)? (?:de )?incarcare'],
  ['p_date', 'loading date'], ['p_date', 'date of loading'], ['p_date', 'pick[- ]?up date'], ['p_date', 'loading time'],
  ['p_date', 'felrakas(?:i)? (?:datuma|ideje|idopontja|nap)'], ['p_date', 'felrakodas(?:i)? (?:datuma|ideje|idopontja)'],
  ['p_date', 'rakodas (?:datuma|ideje)'], ['p_date', 'ladedatum'], ['p_date', 'ladetermin'], ['p_date', 'beladedatum'],
  ['p_date', 'beladetermin'], ['p_date', 'data (?:de )?ridicar(?:e|ii)'], ['p_date', 'data (?:de )?preluar(?:e|ii)'],
  // Lerakás dátuma
  ['d_date', 'data (?:de )?descarcar(?:e|ii)'], ['d_date', 'data livrar(?:ii|e)'], ['d_date', 'termen(?:ul)? de livrare'],
  ['d_date', 'termen(?:ul)? (?:de )?descarcare'], ['d_date', 'ora (?:de )?descarcare'],
  ['d_date', 'delivery date'], ['d_date', 'date of delivery'], ['d_date', 'unloading date'], ['d_date', 'delivery time'],
  ['d_date', 'lerakas(?:i)? (?:datuma|ideje|idopontja|nap)'], ['d_date', 'lerakodas(?:i)? (?:datuma|ideje|idopontja)'],
  ['d_date', 'szallitasi hatarido'], ['d_date', 'liefertermin'], ['d_date', 'lieferdatum'], ['d_date', 'entladedatum'],
  ['d_date', 'entladetermin'], ['d_date', 'zustelltermin'],
  // Általános (az aktuális ponthoz)
  ['date', 'data \\/ (?:interval|ora)'], ['date', 'data si ora'], ['date', 'interval orar'], ['date', 'interval'],
  ['date', 'data'], ['date', 'date'], ['date', 'datum'], ['date', 'datuma'], ['date', 'idopont'], ['date', 'termin'],
  ['date', 'time window'],
  ['addr', 'adresa'], ['addr', 'address'], ['addr', 'cim'], ['addr', 'anschrift'], ['addr', 'localitate'],
  ['p_firm', 'expeditor(?:ul)?'], ['p_firm', 'shipper'], ['p_firm', 'sender'], ['p_firm', 'consignor'],
  ['p_firm', 'absender'], ['p_firm', 'versender'], ['p_firm', 'felado'], ['p_firm', 'firma (?:de )?incarcare'],
  ['d_firm', 'destinatar(?:ul)?'], ['d_firm', 'consignee'], ['d_firm', 'receiver'], ['d_firm', 'recipient'],
  ['d_firm', 'empfanger'], ['d_firm', 'cimzett'], ['d_firm', 'atvevo'], ['d_firm', 'firma (?:de )?descarcare'],
  ['firm', 'societate(?:a)?'], ['firm', 'firma'], ['firm', 'company'], ['firm', 'cegnev'], ['firm', 'ceg'],
  ['firm', 'firmenname'], ['firm', 'denumire'],
  // Referencia (erősebb) / megrendelés-szám (gyengébb)
  ['ref', 'referinta(?: (?:incarcare|comanda|client|clientului|transport))?'], ['ref', 'reference(?: (?:no|number))?'],
  ['ref', 'ref\\.?(?: no)?'], ['ref', 'identificare operatiune'], ['ref', 'cod (?:comanda|operatiune|referinta)'],
  ['ref', 'hivatkozas(?:i szam)?'], ['ref', 'referencia(?:szam)?'], ['ref', 'referenz'], ['ref', 'booking (?:no|ref|number)'],
  ['ref', 'customer ref(?:erence)?'],
  ['orderno', 'nr\\.? comanda'], ['orderno', 'numar(?:ul)? comenzii'], ['orderno', 'numar comanda'], ['orderno', 'comanda (?:de transport |ferma )?nr\\.?'], ['orderno', 'ordin(?:ul)? de transport nr\\.?'],
  ['orderno', 'transport order (?:no|nr|number)'], ['orderno', 'fuvarmegbizas szama'],
  ['orderno', 'order (?:no|nr|number|#)'], ['orderno', 'auftragsnummer'], ['orderno', 'auftrag(?:s)? nr\\.?'],
  ['orderno', 'megbizas(?:i)? szam(?:a)?'], ['orderno', 'megrendeles(?:i)? szam(?:a)?'], ['orderno', 'rendelesszam'],
  ['orderno', 'fuvarszam'], ['orderno', 'transport (?:no|nr)'],
  // Pénz
  ['price', 'tarif(?:ul)?(?: (?:de )?transport(?:ului)?| convenit| total| cursa)?'], ['price', 'pret(?:ul)?(?: (?:de )?transport(?:ului)?| convenit| total| cursa)?'],
  ['price', 'valoare(?:a)? (?:transport(?:ului)?|cursei)'], ['price', 'cost(?:ul)? transport(?:ului)?'],
  ['price', 'freight(?: rate| price| cost| charge)?'], ['price', 'agreed (?:price|rate)'], ['price', 'transport (?:price|rate|cost)'],
  ['price', 'rate'], ['price', 'price'], ['price', 'fuvardij'], ['price', 'fuvar dija'], ['price', 'fuvarar'],
  ['price', 'szallitasi dij'], ['price', 'frachtpreis'], ['price', 'frachtkosten'], ['price', 'fracht'], ['price', 'preis'],
  ['price', 'vergutung'],
  ['currency', 'moneda'], ['currency', 'valuta'], ['currency', 'currency'], ['currency', 'penznem'], ['currency', 'wahrung'],
  ['currency', 'deviza'],
  // Rakomány
  ['weight', 'greutate(?:a)?(?: bruta| totala| neta| marfa)?'], ['weight', 'gross weight'], ['weight', 'weight'],
  ['weight', 'gewicht'], ['weight', 'bruttogewicht'], ['weight', 'suly'], ['weight', 'bruttosuly'], ['weight', 'tomeg'],
  ['weight', 'tonaj'], ['weight', 'cantitate(?:a)? (?:marfurilor|marfii|marfa)'],
  ['load', 'tip(?:ul)? (?:de )?transport'], ['load', 'tip(?:ul)? serviciu'], ['load', 'tip incarcatura'],
  ['load', 'load type'], ['load', 'type of (?:load|transport)'], ['load', 'rakomany tipusa'], ['load', 'fuvar tipusa'],
  ['load', 'ladungsart'], ['load', 'tip(?:ul)? camionului'], ['load', 'tip(?:ul)? (?:de )?camion'],
  ['plates', 'nr\\.? (?:auto|inmatriculare)'], ['plates', 'numar(?:ul)? (?:de )?inmatriculare'], ['plates', 'numere auto'],
  ['plates', 'rendszam(?:ok)?'], ['plates', 'plate(?: no| number)?'], ['plates', 'registration(?: no)?'],
  ['plates', 'kennzeichen'], ['plates', 'license plate'],
  ['truck', 'cap tractor'], ['truck', 'tractor'], ['truck', 'truck'], ['truck', 'vontato'], ['truck', 'zugmaschine'],
  ['trailer', 'semiremorca'], ['trailer', 'remorca'], ['trailer', 'trailer'], ['trailer', 'potkocsi'],
  ['trailer', 'felpotkocsi'], ['trailer', 'auflieger'], ['trailer', 'anhanger'],
  ['note', 'observatii'], ['note', 'mentiuni'], ['note', 'instructiuni speciale'], ['note', 'remarks'],
  ['note', 'special instructions'], ['note', 'notes?'], ['note', 'megjegyzes(?:ek)?'], ['note', 'bemerkung(?:en)?'],
  ['route', 'traseu(?:l)?'], ['route', 'ruta'], ['route', 'relatia'], ['route', 'route'], ['route', 'utvonal'],
  ['route', 'relacio'], ['route', 'strecke'],
  ['km', 'distanta'], ['km', 'distance'], ['km', 'tavolsag'], ['km', 'entfernung'],
  // Más táblázat-címkék — csak azért, hogy a szomszéd mező értékét lezárják
  ['goods', 'marfa'], ['goods', 'descrierea marfii'], ['goods', 'goods'], ['goods', 'cargo'], ['goods', 'arumegnevezes'],
  ['goods', 'ware'], ['goods', 'cantitate'], ['goods', 'quantity'], ['goods', 'mennyiseg'], ['goods', 'vehicul(?: solicitat)?'],
  ['goods', 'vehicle'], ['goods', 'jarmu'], ['goods', 'termen(?:ul)? de plata'], ['goods', 'payment terms?'],
  ['goods', 'fizetesi hatarido'], ['goods', 'facturare'], ['goods', 'volum(?: estimat)?'],
];
// A címkében a szóköz bármennyi szóköz lehet („DATA  DESCARCARII").
const _sp = (src) => src.replace(/ /g, '\\s+');
const _LBL = LABELS.map(([f, src]) => ({ f, re: new RegExp('^(?:' + _sp(src) + ')$') }));
const _ALL = new RegExp('(' + LABELS.map((l) => l[1]).sort((a, b) => b.length - a.length).map(_sp).join('|') + ')', 'g');
function _fieldOf(matched) {
  for (const l of _LBL) if (l.re.test(matched)) return l.f;
  return null;
}
const _isLetter = (c) => !!c && /\p{L}/u.test(c);
const _isUpper = (c) => !!c && /\p{Lu}/u.test(c);
const _isLower = (c) => !!c && /\p{Ll}/u.test(c);
const _isDigit = (c) => !!c && /\d/.test(c);

// Egy szóközzel elválasztott Nagybetűs érték (OCR-táblázat) csak „erős" címkénél:
// több szavas, vagy hosszú, nem általános szó (a „DHL Freight GmbH" ne legyen ár).
function _spaceLabelOk(lbl) {
  if (/\s/.test(lbl)) return true;
  const f = _fieldOf(lbl);
  return lbl.length >= 8 && !['price', 'route', 'goods', 'carrier', 'note'].includes(f);
}

// Egy sor címke-szegmensei: [{ field, label, value, num, start, end }]
function segmentLine(line) {
  const orig = String(line || '');
  const fl = foldKeep(orig);
  const segs = [];
  _ALL.lastIndex = 0;
  let m;
  while ((m = _ALL.exec(fl))) {
    if (!m[0]) { _ALL.lastIndex++; continue; }
    const st = m.index, en = st + m[0].length;
    const prev = orig[st - 1];
    const lead = !/\p{L}/u.test(orig.slice(0, st));                // előtte csak szám / jel
    const prevOk = lead || !_isLetter(prev) || (_isLower(prev) && _isUpper(orig[st]));
    const rest = orig.slice(en);
    const lastU = _isUpper(orig[en - 1]);
    let nextOk = /^\s*[:：]/.test(rest) || !rest.trim() || /^(\t| {2,})/.test(rest) ||
      /^\s*(?:nr\.?\s*)?\d{1,2}\s*(?:[:)]|\.(?!\d)|$)/.test(rest) ||          // „Loading point 1", „Încărcare 2:"
      _isDigit(rest[0]) ||                                             // „Tarif transport1.450"
      (_isUpper(rest[0]) && !lastU) ||                                 // „Loc de încărcareDebrecen"
      /(?:\bnr|\bno|#)\.?$/.test(m[0]) ||                              // „Comanda nr. TE-881"
      /^ \d/.test(rest) ||                                              // OCR-táblázat: „Greutate 18.500 kg"
      (/^ \p{Lu}/u.test(rest) && _spaceLabelOk(m[0]));                 // „Loc de încărcare Debrecen"
    // CSUPA NAGYBETŰS címke után nagybetű: csak ha ott újabb címke kezdődik („COMANDANTTRANSPORTATOR")
    if (!nextOk && lastU && _isUpper(rest[0])) {
      const r2 = new RegExp(_ALL.source, 'y'); r2.lastIndex = en;
      nextOk = r2.test(fl);
    }
    if (!prevOk || !nextOk) { _ALL.lastIndex = st + 1; continue; }
    const field = _fieldOf(m[0]);
    if (field) segs.push({ field, label: orig.slice(st, en), start: st, end: en });
  }
  for (let i = 0; i < segs.length; i++) {
    const stop = i + 1 < segs.length ? segs[i + 1].start : orig.length;
    let v = orig.slice(segs[i].end, stop);
    segs[i].num = /^\s*(?:nr\.?\s*)?\d{1,2}(?:\s*[:)]|\.(?!\d)|\s*$)/i.test(v);
    if (segs[i].num) v = v.replace(/^\s*(?:nr\.?\s*)?\d{1,2}\s*(?:[:)]|\.(?!\d))?/i, '');
    segs[i].value = v.replace(/^\s*[:：]\s*/, '').replace(/^[\s·•|–—-]+/, '').replace(/[\s·•|,;–—-]+$/, '').trim();
  }
  return segs;
}

const COMPANY_RE = /\b(s\.?\s*r\.?\s*l\.?|s\.?\s*a\.?|kft\.?|zrt\.?|nyrt\.?|bt\.?|gmbh|ltd\.?|llc|s\.?\s*p\.?\s*a\.?|s\.?\s*r\.?\s*o\.?|sp\.?\s*z\s*o\.?\s*o\.?|b\.?\s*v\.?|a\.?\s*g\.?|kg|pfa|d\.?\s*o\.?\s*o\.?)(?=[\s,.;)]|$)/i;

const CUR_RE = /(EUR|€|EURO|RON|LEI|HUF|Ft\b|USD|\$|PLN|GBP|£|CHF|CZK|BGN)/i;
function _cur(s) {
  const m = CUR_RE.exec(s || '');
  if (!m) return null;
  const c = m[1].toUpperCase();
  return ({ '€': 'EUR', EURO: 'EUR', LEI: 'RON', FT: 'HUF', $: 'USD', '£': 'GBP' })[c] || c;
}

// Szám-értelmezés: "1.200,50" / "1,200.50" / "1 200" / "1200" / "12,5"
function parseNum(raw) {
  let s = String(raw || '').replace(/[\s  ']/g, '');
  if (!/\d/.test(s)) return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) {
    s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lc >= 0) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (ld >= 0) {
    s = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
const NUM_SRC = '(\\d{1,3}(?:[ .,  ]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';
const DATE_STRIP = /\b(?:20\d{2})[-.\/]\d{1,2}[-.\/]\d{1,2}\b|\b\d{1,2}[.\/-]\d{1,2}[.\/-](?:20)?\d{2}\b/g;

// Összeg (+ pénznem) egy szövegben; a pénznemmel jelölt szám elsőbbséget kap.
function _money(s) {
  const src = String(s || '').replace(DATE_STRIP, ' ');
  const re = new RegExp('(?:(EUR|€|RON|LEI|HUF|USD|PLN|CHF)\\s*)?' + NUM_SRC + '\\s*(EUR|€|EURO|RON|LEI|HUF|Ft|USD|PLN|CHF|GBP)?', 'gi');
  let m, best = null;
  while ((m = re.exec(src))) {
    const n = parseNum(m[2]);
    if (!n || n < 10 || n >= 10000000) continue;
    const cur = _cur(m[1] || m[3] || '');
    if (cur) return { n, cur };
    if (!best) best = { n, cur: null };
  }
  return best;
}

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
  feb: 2, februarie: 2, february: 2, februar: 2, februari: 2,
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
// Minden dátum-jelölt a szövegben: [{ date, index, end, noYear? }]
// opts.year: év nélküli „27.11." / „27 nov" esetén ezt az évet kapja (különben kimarad).
const WEEKDAYS = '(?:luni|marti|miercuri|joi|vineri|sambata|duminica|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|hetfo|kedd|szerda|csutortok|pentek|szombat|vasarnap)';
function _dateCands(s, opts) {
  const o = opts || {};
  const str = String(s || '');
  const cands = [];
  const push = (d, index, end, noYear) => { if (d) cands.push({ date: d, index, end, noYear: !!noYear }); };
  let m;
  const reIso = /\b(20\d{2})[-.\/](\d{1,2})[-.\/](\d{1,2})(?!\d)/g;
  while ((m = reIso.exec(str))) push(_iso(m[3], m[2], m[1]), m.index, m.index + m[0].length);
  // „27.11.2026", „27/11/26" — átfedő keresés, hogy a „28-29.11.2026" tartományból a „29.11.2026" is meglegyen
  const reEu = /(^|[^\d])(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})(?![\d])/g;
  while ((m = reEu.exec(str))) {
    const st = m.index + m[1].length;
    const d = _iso(m[2], m[3], m[4]);
    if (d) {
      // Tartomány („28-29.11.2026"): a kezdő nap a pont dátuma
      const rg = /(^|[^\d.\/])(\d{1,2})\.?\s*[–-]\s*$/.exec(str.slice(0, st));
      const d0 = rg ? _iso(rg[2], m[3], m[4]) : null;
      if (d0 && d0 < d) push(d0, rg.index + rg[1].length, m.index + m[0].length);
      else push(d, st, m.index + m[0].length);
    } else reEu.lastIndex = st + 1;
  }
  const reSp = /(^|[^\d.,])(\d{1,2})\s+(\d{1,2})\s+(20\d{2})(?!\d)/g;     // „24 11 2026"
  while ((m = reSp.exec(str))) { const st = m.index + m[1].length; push(_iso(m[2], m[3], m[4]), st, m.index + m[0].length); }
  const fs = fold(str);
  const reTxt = /\b(\d{1,2})\.?\s+([a-z]{3,10})\.?,?(?:\s+(20\d{2}))?\b/g;          // „27 noiembrie 2026", „27. Nov."
  while ((m = reTxt.exec(fs))) {
    const mo = MONTHS[m[2]]; if (!mo) continue;
    if (m[3]) push(_iso(m[1], mo, m[3]), m.index, m.index + m[0].length);
    // év nélkül („27 nov") csak dátum-címke után — különben az „1 Mai" / „1 Decembrie" utcanév is dátum lenne
    else if (o.year && o.textNoYear) push(_iso(m[1], mo, o.year), m.index, m.index + m[0].length, true);
  }
  const reEn = /\b([a-z]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/g;    // „Nov 27, 2026"
  while ((m = reEn.exec(fs))) { const mo = MONTHS[m[1]]; if (mo) push(_iso(m[2], mo, m[3]), m.index, m.index + m[0].length); }
  const reHu = /\b(20\d{2})\.?\s+([a-z]{3,10})\.?\s+(\d{1,2})\b/g;
  while ((m = reHu.exec(fs))) { const mo = MONTHS[m[2]]; push(mo ? _iso(m[3], mo, m[1]) : null, m.index, m.index + m[0].length); }
  if (o.year) {                                                                       // „27.11." (év nélkül)
    // csak záró ponttal („28.11.") vagy közvetlenül utána álló órával („28.11 10:00");
    // dátum-címke után („Data: 28.11") a csupasz alak is
    const reNy = o.textNoYear
      ? /(^|[^\d.\/])(\d{1,2})\.(\d{1,2})(?:\.(?!\d)|(?![\d.]))/g
      : /(^|[^\d.\/])(\d{1,2})\.(\d{1,2})(?:\.(?!\d)|(?=\s+(?:[01]?\d|2[0-3])[:.][0-5]\d))/g;
    while ((m = reNy.exec(str))) {
      const st = m.index + m[1].length;
      if (cands.some((c) => st >= c.index && st < c.end)) continue;
      push(_iso(m[2], m[3], o.year), st, m.index + m[0].length, true);
    }
  }
  return cands.sort((a, b) => a.index - b.index);
}

// → { date: 'YYYY-MM-DD', time: 'HH:MM'|null, index } | null
function findDate(s, opts) {
  const str = String(s || '');
  const cands = _dateCands(str, opts);
  if (!cands.length) return null;
  // A teljes (évvel írt) dátum elsőbbséget kap az év nélkülivel szemben.
  const c = cands.find((x) => !x.noYear) || cands[0];
  const after = str.slice(c.end, c.end + 40);
  const before = str.slice(Math.max(0, c.index - 12), c.index);
  const tm = /(?:^|[\s,;T(-])\s*(?:\p{L}+\s+){0,3}([01]?\d|2[0-3])[:.h]([0-5]\d)\b/iu.exec(after) || /\b([01]?\d|2[0-3]):([0-5]\d)\s*$/.exec(before);
  const time = tm ? String(tm[1]).padStart(2, '0') + ':' + tm[2] : null;
  return { date: c.date, time, index: c.index };
}
const _timeIn = (s) => { const m = /\b([01]?\d|2[0-3]):([0-5]\d)\s*[–-]\s*([01]?\d|2[0-3]):[0-5]\d\b/.exec(s || ''); return m ? String(m[1]).padStart(2, '0') + ':' + m[2] : null; };
const _timeAtStart = (s) => { const m = /^\s*(?:ora|orele|h)?\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/i.exec(s || ''); return m ? String(m[1]).padStart(2, '0') + ':' + m[2] : null; };

// A cím-szövegből kiveszi a dátumot/órát és a töltelék-szavakat.
const FILLER = /(?:^|\s)(?:intre orele|intre|orele|ora|pana la|programare fixa|de la|between|from|until|by|at|um|bis|kozott)(?=\s|$|,)/gi;
function _stripDates(s) {
  let v = String(s || '');
  const cands = _dateCands(v, { year: 2000 });
  for (let i = cands.length - 1; i >= 0; i--) {
    const c = cands[i];
    let st = c.index;
    // „28-29.11.2026" / „27 – 28.11." → a tartomány eleje is; „Joi, 27.11." → a nap neve is
    const pre = v.slice(0, st);
    const rg = /\b\d{1,2}\.?\s*[–-]\s*$/.exec(pre);
    if (rg) st = rg.index;
    const wd = new RegExp('\\b' + WEEKDAYS + '\\.?,?\\s*$', 'i').exec(fold(v.slice(0, st)));
    if (wd) st = wd.index;
    v = v.slice(0, st) + ' ' + v.slice(c.end);
  }
  return v;
}
function _cleanAddr(s) {
  let v = _stripDates(s);
  v = v.replace(/\b(20\d{2})[-.\/]\d{1,2}[-.\/]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}[.\/-]\d{1,2}[.\/-](?:\d{4}|\d{2})\b/g, ' ')
    .replace(/\b\d{1,2}\s+\d{1,2}\s+20\d{2}\b/g, ' ')
    .replace(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b(?:\s*[–-]\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b)?/g, ' ')
    .replace(/\([^)]*\)/g, ' ');
  const f = foldKeep(v);
  let out = '', last = 0, m;
  FILLER.lastIndex = 0;
  while ((m = FILLER.exec(f))) { out += v.slice(last, m.index) + ' '; last = m.index + m[0].length; }
  v = (out + v.slice(last)).replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').replace(/(,\s*)+,/g, ',')
    .replace(/^[\s,;:.\-–—/]+|[\s,;:.\-–—/]+$/g, '').trim();
  // Mondat-vég: „…, Linz, Austria. Accesul se face…" → a cím az első mondat
  // (rövidítés után — „Str. Gării" — nem vágunk).
  v = v.split(/(?<=\p{L}{5,})\.\s+(?=\p{Lu})/u)[0].replace(/\.$/, '').trim();
  if (/^[A-Z]{1,3}[\s-]?\d{2,3}[\s-]?\d{2,4}$/.test(v)) return v;            // „PL 26-400"
  return (v.length >= 3 && /\p{L}{3,}/u.test(v)) ? v.slice(0, 200) : null;
}

// OCR-hasonló karakterek a cégnév szavaiban: „R0UTE-L0G!STIC" → „ROUTE-LOGISTIC".
// Csak olyan szóban cserélünk, amiben legalább 2 betű van (számot nem rontunk el).
function _deconfuse(name) {
  return String(name || '').replace(/[\p{L}0-9!|]+/gu, (w) => {
    if (!/[0!|1]/.test(w) || (w.match(/\p{L}/gu) || []).length < 2) return w;
    const up = w === w.toUpperCase();
    return w.replace(/0/g, up ? 'O' : 'o').replace(/[!|]/g, up ? 'I' : 'l').replace(/1/g, up ? 'I' : 'l');
  });
}

// Cégnév a jogi formáig („DANUBIA TEST SRL VALLOR TEAM SRL" — két oszlop egy sorban → az első).
function _companyName(v) {
  const re = new RegExp(COMPANY_RE.source, 'ig');
  const m = re.exec(v);
  return _deconfuse(m ? v.slice(0, m.index + m[0].length).replace(/[\s,]+$/, '').trim() : v);
}

function _splitFirmAddr(v) {
  const str = String(v || '');
  const parts = str.split(/\s*[,;|]\s*/);
  if (parts.length >= 2 && COMPANY_RE.test(parts[0]) && parts[0].length <= 80) {
    const head = parts[0];
    const re = new RegExp(COMPANY_RE.source, 'i'); const m = re.exec(head);
    const end = m.index + m[0].length;
    const tail = head.slice(end).trim();                       // „KLINKIER S.A.  Przemysłowa 56"
    return { firma: head.slice(0, end).trim(), addr: [tail, ...parts.slice(1)].filter(Boolean).join(', ').trim() };
  }
  const re = new RegExp(COMPANY_RE.source, 'i'); const m = re.exec(str);
  if (m && m.index + m[0].length <= 80 && /\S/.test(str.slice(m.index + m[0].length))) {
    const end = m.index + m[0].length;
    return { firma: str.slice(0, end).trim(), addr: str.slice(end).trim() };
  }
  return { firma: null, addr: v };
}

// Rendszám-szerű értékek. strict = csak román (megye-kódos) formák.
function findPlates(s, strict) {
  const out = [];
  const str = String(s || '').toUpperCase();
  const res = [
    /\b(B[\s-]?\d{2,3}[\s-]?[A-Z]{3})\b/g,
    /\b((?:AB|AR|AG|BC|BH|BN|BT|BV|BR|BZ|CS|CL|CJ|CT|CV|DB|DJ|GL|GR|GJ|HR|HD|IL|IS|IF|MM|MH|MS|NT|OT|PH|SM|SJ|SB|SV|TR|TM|TL|VS|VL|VN)[\s-]?\d{2}[\s-]?[A-Z]{3})\b/g,
  ];
  if (!strict) res.push(/\b([A-Z]{3}[\s-]?\d{3})\b/g, /\b([A-Z]{2}[\s-]?[A-Z]{2}[\s-]?\d{3})\b/g, /\b([A-Z]{1,3}[\s-][A-Z]{1,2}[\s-]?\d{1,4})\b/g);
  for (const re of res) {
    let m;
    while ((m = re.exec(str))) {
      const p = m[1].replace(/[\s-]/g, '');
      if (/^(CUI|CIF|EUR|RON|NR|TVA|VAT|LDM|ADR|CMR|KG)/.test(p)) continue;
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

function _refToken(v) {
  const m = /([A-Z0-9][A-Z0-9\-\/_.]{2,40})/i.exec(String(v || '').replace(/^(?:nr|no|numar)(?:\.|\s*[:#])\s*/i, ''));
  if (!m || !/\d/.test(m[1])) return null;
  const t = m[1].replace(/[.,\/]+$/, '');
  if (/^\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}$/.test(t)) return null;
  return t;
}

function _loadType(s) {
  const f = fold(s);
  if (/\b(ftl|full\s*truck(?:\s*load)?|camion\s*complet|marfa\s*completa|incarcare\s*completa|komplettladung|teljes\s*rakomany)\b/.test(f)) return 'FTL';
  if (/\b(ltl|grupaj|groupage|partial\s*(?:load|incarcare|incarcatura)|incarcare\s*partiala|teilladung|sammelgut|reszrakomany|gyujtoaru)\b/.test(f)) return 'LTL';
  return null;
}

// ── Fő kiolvasó ──
// opts: { ownNames: [cégnév…], ownCui: '47859317' } — a saját (fuvarozó) cég,
// hogy ne olvassuk ki megbízóként.
// ── Ismétlődő pontok ──
// Ugyanaz a cím többször leírva (pl. a megbízás végi összesítőben) NEM több felrakás / lerakás:
// csak akkor külön pont, ha más a dátum / óra, más a cég, vagy a címben más a rámpa / hala /
// kapu / raktár stb. Az összevont pont a két előfordulás adatait egyesíti.
const SITE_WORDS = /\b(?:rampa|ramp|rampe|rampen|hala|hall|halle|poarta|gate|tor|dock|doc|depozit|warehouse|lager|csarnok|kapu|raktar|cladirea|building|gebaude|epulet|sector|zona|zone|platforma)\b/;
const _locKey = (s) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
function _sameLoc(a, b) {
  if (!a || !b) return !a && !b;
  const ka = _locKey(a), kb = _locKey(b);
  if (ka === kb) return true;
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  if (short.length < 4 || !(' ' + long + ' ').includes(' ' + short + ' ')) return false;
  // a hosszabb cím többlete nem jelölhet más rakodóhelyet (rámpa / hala / kapu …)
  return !SITE_WORDS.test(long.replace(short, ' '));
}
function _sameData(a, b) {
  if (!a || !b) return true;
  if (a.slice(0, 10) !== b.slice(0, 10)) return false;
  return !(a.length > 10 && b.length > 10 && a.slice(11, 16) !== b.slice(11, 16));
}
const _sameFirm = (a, b) => !a || !b || _locKey(a) === _locKey(b);
function _dedupeStops(list) {
  const out = [];
  for (const s of list) {
    const hit = out.find((o) => (s.loc || o.loc ? _sameLoc(o.loc, s.loc) : true)
      && _sameFirm(o.firma, s.firma) && _sameData(o.data, s.data)
      && (s.loc || o.loc || (s.data && o.data && s.data === o.data)));
    if (!hit) { out.push(Object.assign({}, s)); continue; }
    if (s.loc && (!hit.loc || _locKey(s.loc).length > _locKey(hit.loc).length)) hit.loc = s.loc;
    if (!hit.firma && s.firma) hit.firma = s.firma;
    if (s.data && (!hit.data || s.data.length > hit.data.length)) hit.data = s.data;
  }
  return out;
}

function parseOrderText(text, opts) {
  const o = opts || {};
  const ownCui = String(o.ownCui || '').replace(/\D/g, '');
  const ownNames = (o.ownNames || []).map((n) => fold(n).replace(/[^a-z0-9 ]/g, ' ').replace(/\b(srl|sa|kft|gmbh|ltd|sc)\b/g, ' ').replace(/\s+/g, ' ').trim()).filter((n) => n.length >= 3);
  const isOwn = (s) => { const f = ' ' + fold(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' '; return ownNames.some((n) => f.includes(' ' + n + ' ')); };

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
  const raw0 = String(text || '').replace(/\r/g, '').replace(/[  ]/g, ' ');
  if (!raw0.trim()) return { fields, confidence: 0, found: 0 };

  // 1. Két sorra tört címkék összefűzése („Loc de" / „descărcare")
  const src = raw0.split('\n').map((l) => l.replace(/\s+$/, ''));
  const lines = [];
  for (let i = 0; i < src.length; i++) {
    let l = src[i];
    while (i + 1 < src.length && l.trim().length <= 22 && /\b(de|of|la|du|des|der|di|da)$/i.test(l.trim())) { l = l + ' ' + src[i + 1].trim(); i++; }
    // OCR-táblázat: „Loc de Brașov, România …" + „descărcare Parc Logistic …"
    // → a címke második fele a következő sor elején ül; visszatesszük a helyére.
    let ni = i + 1; while (ni < src.length && !src[ni].trim() && ni - i < 3) ni++;
    const nx = src[ni] != null ? src[ni] : '';
    const mm = /^(\s*(?:loc(?:ul)?|punct(?:ul)?|adresa|data|termen(?:ul)?)\s+de)\s+(?!(?:in|des)carc|livrar)/i.exec(foldKeep(l));
    const wm = /^\s*((?:în|in|des)c[aă]rc[aă]r(?:e|ea|ii)|livr[aă]r(?:e|ii))\b\s*/i.exec(nx);
    if (mm && wm) {
      l = l.slice(0, mm[1].length) + ' ' + wm[1] + ' ' + l.slice(mm[0].length);
      src[ni] = nx.slice(wm[0].length);
    }
    lines.push(l);
  }
  const segsOf = lines.map((l) => segmentLine(l));
  const hasLabel = (i) => !!(segsOf[i] && segsOf[i].length);
  // Szakasz-fejléc: „2. CONDIȚII…" vagy legalább 3 szavas CSUPA NAGYBETŰS sor (az egyszavas
  // nagybetűs cím-folytatás — „NOVOTEL" — nem fejléc).
  const isHeader = (l) => { const t = l.trim(); return /^\d+\.\s/.test(t) || (t.split(/\s+/).length >= 3 && t === t.toUpperCase() && !/\d/.test(t) && /\p{L}{4,}/u.test(t)); };

  // Érték a következő sor(ok)ból (címke-mentes, nem felsorolás, nem üres)
  const nextValues = (i, max) => {
    const out = [];
    for (let j = i + 1; j < lines.length && out.length < max; j++) {
      const t = lines[j].trim();
      if (!t) { if (out.length) break; continue; }
      if (hasLabel(j) || /^[•·]/.test(t)) break;
      if (out.length && isHeader(t)) break;
      out.push({ text: t, idx: j });
    }
    return out;
  };

  // Év nélküli dátumokhoz („28.11.") a dokumentum első teljes dátumának éve (különben az idei)
  const docYear = (() => { const c = _dateCands(raw0).find((x) => !x.noYear); return c ? +c.date.slice(0, 4) : new Date().getFullYear(); })();
  const DY = { year: docYear }, DYL = { year: docYear, textNoYear: true };
  const stops = { P: [], D: [] };
  let ctx = null;           // 'P' | 'D' — melyik pont-blokkban vagyunk
  let ctxLine = -100;
  const lastStop = (k) => stops[k][stops[k].length - 1];
  const stopFor = (k, attr, force) => {
    const last = lastStop(k);
    if (!force && last && !last[attr]) return last;
    const s = { loc: null, firma: null, data: null }; stops[k].push(s); return s;
  };
  let refStrong = null, refWeak = null, clientLine = -1, route = null;
  const notes = [];
  const used = new Set();   // a már értékként elhasznált sorok

  const setDate = (k, value, i, loose) => {
    const d = findDate(value, loose === false ? DY : DYL);
    if (!d) return false;
    let time = d.time;
    let j = i + 1; while (j < lines.length && !lines[j].trim() && j - i < 3) j++;
    if (!time && lines[j] && !findDate(lines[j], DY)) {
      const nv = _timeAtStart(lines[j]) || _timeIn(lines[j]);
      if (nv) { time = nv; if (_timeAtStart(lines[j]) && !_cleanAddr(lines[j])) used.add(j); }
    }
    const st = stopFor(k, 'data');
    if (!time && st._time) time = st._time;
    st.data = time ? d.date + 'T' + time : d.date;
    return true;
  };
  const setLoc = (k, value, i, force) => {
    const s0 = _splitFirmAddr(value);
    let addr = _cleanAddr(s0.addr);
    // A cím folytatása a következő (címke nélküli) sor(ok)ban
    let contTime = null;
    for (const n of nextValues(i, 2)) {
      // „Przysucha --  16.30  pre AMEDIO…" → a cím az időpontig tart; az óra a ponté
      const tm = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/.exec(n.text);
      const part = (addr && tm && !findDate(n.text)) ? n.text.slice(0, tm.index) : n.text;
      if (tm && !findDate(n.text)) contTime = contTime || (String(tm[1]).padStart(2, '0') + ':' + tm[2]);
      const c = _cleanAddr(part);
      if (!c) { if (findDate(n.text)) break; continue; }
      if (addr && (isHeader(n.text) || n.text.length > 90)) break;
      addr = addr ? addr + ', ' + c : c; used.add(n.idx);
    }
    const st = stopFor(k, 'loc', force);
    if (addr) st.loc = addr.slice(0, 200);
    if (s0.firma && !st.firma) st.firma = s0.firma.slice(0, 200);
    if (findDate(value, DY) && !st.data) setDate(k, value, i, false);
    if (contTime && st.data && st.data.length === 10) st.data += 'T' + contTime;
    else if (contTime && !st.data) st._time = contTime;
    // „Ridicare: Nitra, …" + külön sorban „02.12.2026 · 07:00–09:00" → a pont dátuma
    if (!st.data) {
      let j = i + 1;
      while (j < lines.length && (used.has(j) || !lines[j].trim()) && j - i < 4) j++;
      if (lines[j] && !hasLabel(j) && findDate(lines[j], DY) && !_cleanAddr(lines[j])) { setDate(k, lines[j], j, false); used.add(j); }
    }
  };
  const firstNext = (i) => { const nv = nextValues(i, 1); if (nv[0]) { used.add(nv[0].idx); return nv[0].text; } return ''; };

  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    const line = lines[i];
    if (!line.trim()) continue;

    for (const sg of segsOf[i]) {
      let v = sg.value;
      const solo = !v;
      const k = sg.field;
      if (k === 'p_loc' || k === 'd_loc') {
        const K = k === 'p_loc' ? 'P' : 'D';
        ctx = K; ctxLine = i;
        if (solo && !nextValues(i, 1).length) {
          // Csak blokk-fejléc („Loading point 2") → új pont
          const last = lastStop(K); if (!last || last.loc || last.firma || last.data) stopFor(K, 'loc', true);
          continue;
        }
        const last = lastStop(K);
        setLoc(K, v, i, !!(sg.num && last && (last.loc || last.data)));
      } else if (k === 'p_date' || k === 'd_date') {
        const K = k === 'p_date' ? 'P' : 'D';
        ctx = K; ctxLine = i;
        if (solo) v = firstNext(i);
        setDate(K, v, i);
      } else if (k === 'date' && ctx && i - ctxLine <= 12) {
        if (solo) { const nv = nextValues(i, 1); if (nv[0] && findDate(nv[0].text)) { v = nv[0].text; used.add(nv[0].idx); } }
        if (setDate(ctx, v, i)) ctxLine = i;
      } else if (k === 'addr' && ctx && i - ctxLine <= 12) {
        if (solo) v = nextValues(i, 2).map((n) => { used.add(n.idx); return n.text; }).join(', ');
        if (v) { const st = lastStop(ctx); const a = _cleanAddr(v); if (st && !st.loc && a) st.loc = a; else if (a) setLoc(ctx, v, i, false); ctxLine = i; }
      } else if (k === 'firm' && ctx && i - ctxLine <= 12) {
        if (solo) v = firstNext(i);
        if (v && /\p{L}{2,}/u.test(v) && !/^_+$/.test(v)) { stopFor(ctx, 'firma').firma = v.split(/\s*[,;]\s*/)[0].slice(0, 200); ctxLine = i; }
      } else if (k === 'p_firm' || k === 'd_firm') {
        const K = k === 'p_firm' ? 'P' : 'D';
        if (solo) v = firstNext(i);
        if (v && /\p{L}{2,}/u.test(v)) {
          const sf = _splitFirmAddr(v);
          const st = stopFor(K, 'firma');
          st.firma = (sf.firma || v.split(/\s*[,;]\s*/)[0]).slice(0, 200);
          if (sf.firma && sf.addr && !st.loc) st.loc = _cleanAddr(sf.addr);
        }
      } else if (k === 'client') {
        if (fields.client) continue;
        if (solo) { const nv = nextValues(i, 1); if (nv[0]) v = nv[0].text; }
        const name = _companyName(String(v || '').split(/\s*(?:[,;(]|·|\bCUI\b|\bCIF\b)\s*/)[0].trim());
        if (name && name.length >= 3 && /\p{L}{3,}/u.test(name) && !isOwn(name) && !_fieldOf(foldKeep(name).trim())) { fields.client = name.slice(0, 200); clientLine = i; }
      } else if (k === 'ref' || k === 'orderno') {
        if (solo) { const nv = nextValues(i, 1); if (nv[0]) v = nv[0].text; }
        const t = _refToken(v);
        if (t) { if (k === 'ref') refStrong = refStrong || t; else refWeak = refWeak || t; }
      } else if (k === 'price') {
        if (fields.pret != null) continue;
        if (solo) { const nv = nextValues(i, 1); if (nv[0]) v = nv[0].text; }
        const mo = _money(v);
        if (mo) { fields.pret = mo.n; if (mo.cur) fields.valuta = mo.cur; }
      } else if (k === 'currency') {
        if (solo) { const nv = nextValues(i, 1); if (nv[0]) v = nv[0].text; }
        const c = _cur(v); if (c) fields.valuta = c;
      } else if (k === 'weight') {
        if (fields.greutate != null) continue;
        if (solo) { const nv = nextValues(i, 1); if (nv[0]) v = nv[0].text; }
        const wm = new RegExp(NUM_SRC + '\\s*(kg|kgs|t\\b|to\\b|tone|tonnes|tons|tonna)?', 'i').exec(String(v || '').replace(DATE_STRIP, ' '));
        if (wm) {
          let n = parseNum(wm[1]);
          if (n != null && wm[2] && /^(t|to|tone|tonnes|tons|tonna)$/i.test(wm[2])) n *= 1000;
          else if (n != null && !wm[2] && n < 50) n *= 1000;
          if (n && n > 0 && n <= 45000) fields.greutate = Math.round(n);
        }
      } else if (k === 'load') {
        const lt = _loadType(v); if (lt) fields.load_type = lt;
      } else if (k === 'plates' || k === 'truck' || k === 'trailer') {
        const p = findPlates(v || '');
        if (!p.length) continue;
        if (k === 'trailer') fields.rendszam_remorca = fields.rendszam_remorca || p[0];
        else { fields.rendszam_camion = fields.rendszam_camion || p[0]; if (p[1]) fields.rendszam_remorca = fields.rendszam_remorca || p[1]; }
      } else if (k === 'note') {
        if (solo) v = nextValues(i, 3).map((n) => n.text).join(' ');
        if (v && !/^[_\s.]+$/.test(v)) notes.push(v);
      } else if (k === 'route' && v && !route) {
        const rp = v.split(/\s*(?:→|->|=>|»|➔)\s*|\s+[-–—]\s+/).map((x) => _cleanAddr(x)).filter(Boolean);
        if (rp.length >= 2) route = rp;
      } else if (k === 'km' && fields.km == null) {
        const km = new RegExp(NUM_SRC + '\\s*km\\b', 'i').exec(line) || new RegExp(NUM_SRC).exec(v || '');
        if (km) { const n = parseNum(km[1]); if (n && n >= 5 && n < 20000) fields.km = Math.round(n); }
      }
    }

    // Sor-szintű tartalékok (címke nélküli, folyó szöveg)
    const fl = fold(line);
    if (!fields.load_type) { const lt = _loadType(line); if (lt) fields.load_type = lt; }
    if (fields.greutate == null && /(greutate|weight|gewicht|suly|tomeg|tonaj)/.test(fl)) {
      const wm = new RegExp(NUM_SRC + '\\s*(kg|kgs|t|to|tone|tonnes|tons|tonna)\\b', 'i').exec(line);
      if (wm) { let n = parseNum(wm[1]); if (!/kg/i.test(wm[2])) n *= 1000; if (n > 0 && n <= 45000) fields.greutate = Math.round(n); }
    }
    if (fields.pret == null && /(tarif|pret|price|freight|fuvardij|fuvar dij|szallitasi dij|fracht|preis|convenit|agreed)/.test(fl)) {
      const mo = _money(line);
      if (mo && mo.cur) { fields.pret = mo.n; fields.valuta = fields.valuta || mo.cur; }
    }
    if (!fields.client) {
      const em = /(?:emis[aă]?|issued|ordered|placed|ausgestellt|kiállította)\s+(?:de(?:\s+c[aă]tre)?|by|von|által)\s+(.{3,90}?(?:S\.?R\.?L\.?|S\.?A\.?|KFT\.?|ZRT\.?|GMBH|LTD\.?|B\.?V\.?|S\.?R\.?O\.?))(?=[\s,.;)]|$)/i.exec(line);
      if (em && !isOwn(em[1])) { fields.client = em[1].trim().slice(0, 200); clientLine = i; }
    }
    if (fields.hossz_cm == null) {
      const dm = /(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b/i.exec(line);
      if (dm) {
        const mul = { mm: 0.1, cm: 1, m: 100 }[dm[4].toLowerCase()];
        const a = [dm[1], dm[2], dm[3]].map((x) => Math.round(parseNum(x) * mul));
        if (a.every((x) => x > 0 && x <= 2000)) { fields.hossz_cm = a[0]; fields.szel_cm = a[1]; fields.mag_cm = a[2]; }
      }
    }
  }

  // ── CUI: a megbízó közelében, különben az első nem saját ──
  const cuiRe = /\b(?:C\.?U\.?I\.?|C\.?I\.?F\.?|Cod\s+fiscal|Cod\s+TVA|VAT(?:\s*(?:no|nr|id|number))?|Tax\s*ID|Adószám|Adoszam|USt-?IdNr\.?)\b[^\n\d]{0,18}?((?:RO|HU|DE|AT|SK|CZ|PL|SI|IT|NL|BE|FR|BG)?\s?[\dOIl][\dOIl ]{4,14}[\dOIl])(?![\p{L}\d])/giu;
  const cuis = [];
  lines.forEach((l, idx) => { let m; cuiRe.lastIndex = 0; while ((m = cuiRe.exec(l))) {
    const pre = (/^[A-Z]{2}/i.exec(m[1].replace(/\s/g, '')) || [''])[0].toUpperCase();
    const num = m[1].replace(/\s/g, '').slice(pre.length).replace(/O/gi, '0').replace(/[Il]/g, '1');
    if (/^\d{6,12}$/.test(num)) cuis.push({ v: pre + num, idx });
  } });
  // Címke nélküli „RO 15650427" a fejlécben (az IBAN „RO42 BTRL…" kiesik: utána betű jön)
  if (!cuis.length) {
    for (let i = 0; i < Math.min(lines.length, 12); i++) {
      const re = /\bRO\s?(\d{6,10})\b(?!\s?[A-Z]{4})/g; let m;
      while ((m = re.exec(lines[i]))) cuis.push({ v: 'RO' + m[1], idx: i });
    }
  }
  const notOwn = cuis.filter((c) => c.v.replace(/\D/g, '') !== ownCui);
  if (notOwn.length) {
    const near = clientLine >= 0 ? notOwn.find((c) => c.idx >= clientLine && c.idx - clientLine <= 6) : null;
    fields.client_cui = (near || notOwn[0]).v;
  }

  // ── Megbízó tartalék: a fejléc első cégneve, ami nem a saját cég ──
  if (!fields.client) {
    for (let i = 0; i < Math.min(lines.length, 25); i++) {
      const l = lines[i].trim();
      if (!l || l.length > 90 || !COMPANY_RE.test(l) || isOwn(l)) continue;
      if (segsOf[i].some((s) => ['carrier', 'p_loc', 'd_loc', 'p_firm', 'd_firm', 'firm'].includes(s.field))) continue;
      const nm = _companyName(l.split(/\s*(?:[,;(]|·)\s*/)[0]);
      if (nm.length >= 3) { fields.client = nm.slice(0, 200); break; }
    }
  }

  // Fejléc-szám címke nélkül: „NR8228/23 11 2026" (szám / kiállítás dátuma) → 8228
  if (!refStrong && !refWeak) {
    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      const m = /^\s*(?:nr|no)\.?\s*[:#]?\s*([A-Z]{0,4}[-\/]?\d{2,}[A-Z0-9\-\/]*?)(?:\s*\/\s*(?:\d{1,2}[\s.\/-]+\d{1,2}[\s.\/-]+20\d{2}))?(?:\s|$)/i.exec(lines[i]);
      if (m) { refWeak = m[1].replace(/\/$/, ''); break; }
    }
  }
  fields.ref = refStrong || refWeak || null;
  if (!fields.valuta && fields.pret != null) fields.valuta = _cur(raw0);

  if (!fields.rendszam_camion) {
    const pl = findPlates(raw0, true);
    if (pl[0]) fields.rendszam_camion = pl[0];
    if (pl[1] && !fields.rendszam_remorca) fields.rendszam_remorca = pl[1];
  }

  // ── Pontok összeállítása (+ útvonal-tartalék) ──
  const clean = (list) => list.map((s) => ({ loc: s.loc || null, firma: s.firma || null, data: s.data || null }))
    .filter((s) => s.loc || s.firma || s.data);
  const P = _dedupeStops(clean(stops.P)), D = _dedupeStops(clean(stops.D));
  if (route) {
    if (!P.length) P.push({ loc: route[0], firma: null, data: null });
    else if (!P[0].loc) P[0].loc = route[0];
    if (!D.length) D.push({ loc: route[route.length - 1], firma: null, data: null });
    else if (!D[D.length - 1].loc) D[D.length - 1].loc = route[route.length - 1];
  }
  if (P[0]) { fields.loc_incarcare = P[0].loc; fields.firma_incarcare = P[0].firma; fields.data_incarcare = P[0].data; }
  if (D[0]) { fields.loc_descarcare = D[0].loc; fields.firma_descarcare = D[0].firma; fields.data_descarcare = D[0].data; }
  if (P.length > 1 || D.length > 1) { fields.pickups = P.length ? P : null; fields.deliveries = D.length ? D : null; }

  if (notes.length) fields.observatii = notes.join(' · ').slice(0, 500);

  const KEY = ['client', 'loc_incarcare', 'loc_descarcare', 'data_incarcare', 'data_descarcare', 'pret'];
  const MINOR = ['ref', 'client_cui', 'firma_incarcare', 'firma_descarcare', 'greutate', 'rendszam_camion', 'valuta'];
  const k = KEY.filter((x) => fields[x] != null).length;
  const mi = MINOR.filter((x) => fields[x] != null).length;
  const confidence = Math.min(0.9, Math.round(((k / KEY.length) * 0.75 + (mi / MINOR.length) * 0.15) * 100) / 100);
  return { fields, confidence, found: k + mi };
}

module.exports = { parseOrderText, segmentLine, findDate, findPlates, parseNum, fold, foldKeep, cleanAddr: _cleanAddr, money: _money, companyName: _companyName };
