// lib/invoiceText.js — számla-adatok kiolvasása a PDF SZÖVEGRÉTEGÉBŐL, AI NÉLKÜL.
// A számlázó programok (FGO, SmartBill, Oblio stb.) mindig ugyanott és ugyanazzal a
// felirattal írják ki a számlaszámot, a kiállítás dátumát és a vevő CUI-ját, így
// determinisztikus mintákkal megbízhatóan kivehetők. Fotó/szkennelt képhez NEM jó
// (ott nincs szövegréteg) — ilyenkor minden mező üres marad.
//
// Támogatott formák (pl.):  "Factura VLR 01079" · "FACTURA VLR 01079" · "Factura\nVLR 01079"
//   · "Seria VLR nr. 01079" · "Data emitere: 04.10.2026" · "CUI: RO25871352"

const DATE_LABEL_RE = /data\s*(?:emiterii|emitere|emiterea|facturii|factur[aă]rii)\s*:?\s*(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/i;
const ANY_DATE_RE = /\b(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})\b/g;
const SERIA_NR_RE = /seri[ae]\s*:?\s*([A-Z]{1,8})\s*(?:nr\.?|num[aă]r(?:ul)?)\s*:?\s*(\d{1,10})\b/i;
// A sorozat NAGYBETŰS (a „Factura circula fara..." és hasonló mondatok ne illeszkedjenek).
const FACTURA_RE = /(?:FACTURA|Factura|factura)(?:\s+fiscal[aă])?[ \t]*(?:\r?\n[ \t]*)?(?:(?:seria|Seria|SERIA)\s*)?([A-Z]{1,8})[ \t-]*(?:(?:nr|Nr|NR)\.?\s*)?[:#]?[ \t]*(\d{1,10})\b/;
const CUI_RE = /\b(?:C\.?U\.?I\.?|C\.?I\.?F\.?|Cod\s+fiscal|CUI\/CIF|CIF\/CUI)\s*[:.]?\s*(?:RO\s*)?(\d{2,10})\b/gi;
const CLIENT_HEAD_RE = /^\s*(client|cump[aă]r[aă]tor|beneficiar)\s*:?\s*$/i;
const SUPPLIER_HEAD_RE = /^\s*(furnizor|v[aâ]nz[aă]tor|prestator)\s*:?\s*$/i;

function _isoDate(d, m, y) {
  const dd = +d, mm = +m, yy = +y;
  if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && yy >= 2000 && yy <= 2100)) return null;
  const dt = new Date(Date.UTC(yy, mm - 1, dd));
  if (dt.getUTCMonth() !== mm - 1) return null;
  return yy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
}

function digits(v) { return String(v || '').replace(/\D/g, ''); }

// Cégnév-összevetéshez: kisbetű, ékezet nélkül, írásjel és jogi forma (SRL, SA…) nélkül.
const LEGAL = new Set(['srl', 'sa', 'sc', 'srld', 'pfa', 'ii', 'if', 'snc', 'scs', 'ra', 'kft', 'zrt', 'bt', 'nyrt', 'gmbh', 'ltd', 'llc', 'sp', 'zoo', 'sro', 'ag', 'kg', 'co']);
function normName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(^|\s)s\.\s*c\.?(?=\s)/g, ' sc ').replace(/s\.\s*r\.\s*l\.?/g, ' srl ').replace(/s\.\s*a\.?(?=\s|$)/g, ' sa ')
    .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !LEGAL.has(w)).join(' ').trim();
}

// A fejléc ("Client") utáni első, nem-CUI sor a cégnév. Ha a PDF két oszlopot egy sorba
// olvas („Furnizor Client"), a név nem választható szét → null (a CUI úgyis eldönti).
function _nameAfter(lines, headRe) {
  const inline = new RegExp(headRe.source.replace('\\s*:?\\s*$', '\\s*:\\s*(\\S.{1,118})$'), 'i');
  for (let i = 0; i < lines.length; i++) {
    const il = inline.exec(lines[i]);
    if (il && !/^(CUI|CIF)/i.test(il[2])) return il[2].trim();
    if (!headRe.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const l = lines[j].trim();
      if (!l) continue;
      if (/^(CUI|CIF|Reg|Nr\.?\s*Reg|Cod)/i.test(l)) break;
      if (l.length >= 2 && l.length <= 120) return l;
      break;
    }
  }
  return null;
}

function parseInvoiceText(text) {
  const t = String(text || '').replace(/ /g, ' ');
  const out = { invoice_no: null, series: null, number: null, date: null, cuis: [], client_name: null, supplier_name: null };
  if (!t.trim()) return out;

  let m = SERIA_NR_RE.exec(t) || FACTURA_RE.exec(t);
  if (!m) {
    // Tartalék: a fejléc első soraiban önálló „VLR 01079" sor (a „Factura" címke külön sorban/oszlopban).
    const head = t.split(/\r?\n/).slice(0, 15);
    for (const l of head) {
      const k = /^\s*([A-Z]{2,6})[ \t-]?(\d{3,10})\s*$/.exec(l);
      if (k && k[1] !== 'RO' && k[1] !== 'CUI' && k[1] !== 'CIF') { m = k; break; }
    }
  }
  if (m) { out.series = m[1].toUpperCase(); out.number = m[2]; out.invoice_no = out.series + ' ' + out.number; }

  m = DATE_LABEL_RE.exec(t);
  if (m) out.date = _isoDate(m[1], m[2], m[3]);
  if (!out.date) {
    // A „Data emitere" címke és az érték szétválhat (kétoszlopos fejléc) → az első
    // érvényes dátum a kiállítási (a lejárati mindig utána jön).
    ANY_DATE_RE.lastIndex = 0;
    let d;
    while ((d = ANY_DATE_RE.exec(t))) { const iso = _isoDate(d[1], d[2], d[3]); if (iso) { out.date = iso; break; } }
  }

  const seen = new Set();
  CUI_RE.lastIndex = 0;
  while ((m = CUI_RE.exec(t))) { if (!seen.has(m[1])) { seen.add(m[1]); out.cuis.push(m[1]); } }

  const lines = t.split(/\r?\n/);
  out.client_name = _nameAfter(lines, CLIENT_HEAD_RE);
  out.supplier_name = _nameAfter(lines, SUPPLIER_HEAD_RE);
  return out;
}

module.exports = { parseInvoiceText, normName, digits };
