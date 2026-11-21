// ============================================================
//  VallorSoft — lib/itemCurrency.js
//  Valutás bonok (tankolás / vásárlás) átváltása RON-ra a tétel dátumára
//  érvényes BNR árfolyamon.
//
//  Szerződés a menetlevél-tételeken (alimentari: suma, achizitii: pret):
//   - `suma` / `pret`       = MINDIG RON (a statisztikák, decont, riportok erre épülnek)
//   - `valuta`              = a bon eredeti valutája (ISO 4217, alap RON)
//   - `suma_orig`/`pret_orig` = az eredeti összeg a bon valutájában (csak nem-RON)
//   - `curs_bnr`            = RON / 1 egység a `curs_data` napján (BNR)
//  A kliens az eredeti összeget küldi (`*_orig`); a RON-értéket a szerver számolja.
// ============================================================
const bnr = require('../services/bnr');

// Szimbólum / helyi név → ISO kód. Ismeretlen 3 betűs kód változatlanul megy tovább.
const ALIASES = {
  'LEI': 'RON', 'LEU': 'RON', 'L': 'RON', 'RON': 'RON',
  '€': 'EUR', 'EURO': 'EUR', 'EUROS': 'EUR',
  '$': 'USD', 'US$': 'USD', 'DOLLAR': 'USD',
  '£': 'GBP',
  'FT': 'HUF', 'FORINT': 'HUF',
  'ZŁ': 'PLN', 'ZL': 'PLN', 'ZLOTY': 'PLN',
  'KČ': 'CZK', 'KC': 'CZK',
  'ЛВ': 'BGN', 'LV': 'BGN', 'LEVA': 'BGN',
  'DIN': 'RSD', 'ДИН': 'RSD', 'DINAR': 'RSD',
  'KN': 'HRK',
  'CHF': 'CHF', 'FR': 'CHF',
  'KR': 'SEK',
  '₺': 'TRY', 'TL': 'TRY',
  '₴': 'UAH', 'ГРН': 'UAH',
  'MDL': 'MDL',
};

function normalizeCurrency(v) {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase().replace(/\.$/, '');
  if (!s) return null;
  if (ALIASES[s]) return ALIASES[s];
  if (/^[A-Z]{3}$/.test(s)) return s;
  return null;
}

const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => { if (v == null || v === '') return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// Egy tétel normalizálása. amountKey: 'suma' | 'pret'.
async function convertItem(item, amountKey) {
  if (!item || typeof item !== 'object') return item;
  const origKey = amountKey + '_orig';
  const cur = normalizeCurrency(item.valuta) || 'RON';
  const out = { ...item, valuta: cur };
  if (cur === 'RON') {
    // RON tételnél az eredeti = RON; régi átváltási mezők törlése.
    if (out[origKey] != null && num(out[origKey]) != null) out[amountKey] = num(out[origKey]);
    delete out[origKey]; delete out.curs_bnr; delete out.curs_data; delete out.curs_lipsa;
    return out;
  }
  const orig = num(item[origKey]) != null ? num(item[origKey]) : num(item[amountKey]);
  out[origKey] = orig;
  let hit = null;
  try { hit = await bnr.getRateFor(cur, item.data); } catch (_) { hit = null; }
  if (hit && hit.rate) {
    out.curs_bnr = Math.round(hit.rate * 1e6) / 1e6;
    out.curs_data = hit.date;
    out[amountKey] = orig != null ? r2(orig * hit.rate) : null;
    delete out.curs_lipsa;
  } else if (num(item.curs_bnr) > 0) {
    // Nincs elérhető BNR (hálózat) → a kliens által már lekért árfolyamot tartjuk meg.
    out.curs_bnr = num(item.curs_bnr);
    out[amountKey] = orig != null ? r2(orig * out.curs_bnr) : null;
  } else {
    out.curs_lipsa = true; // jelölés: az átváltás pótlandó
  }
  return out;
}

async function convertItems(list, amountKey) {
  if (!Array.isArray(list)) return [];
  const res = [];
  for (const it of list) res.push(await convertItem(it, amountKey));
  return res;
}

module.exports = { normalizeCurrency, convertItem, convertItems };
