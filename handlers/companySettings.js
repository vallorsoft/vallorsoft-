// ============================================================
//  VallorSoft — handlers/companySettings.js
//  Egységes "Cég & arculat" önkiszolgáló beállítások — RPC.
//
//  ÚJRAHASZNÁLT infrastruktúra (NEM duplikálunk):
//    - company_branding tábla (logó: logo_base64/logo_mime — a logó
//      feltöltése továbbra is a REST /api/branding/logo végpontokon megy,
//      itt csak a brand_color + pdf_header_text mezőket kezeljük).
//    - companies.eur_ron_rate (statisztika árfolyam).
//    - document_series (menetlevél-prefix) — a meglévő POST /api/document-series
//      logikájával AZONOS upsert-tel írjuk (külön REST hívás nem kell).
//
//  NEM kezeljük itt: a számlázó serie/TVA/pénznem -> az a billing_integrations
//  provider-szintű beállítása marad (lásd billingHandlers.js).
//
//  Multi-tenant: minden lekérdezés company_id-szűrt (session), paraméteres SQL.
//  Olvasás: Admin/Manager. Írás (cég-szintű): CSAK Admin.
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');

const handlers = {};

function _user(req) { return (req && req.session && req.session.user) || null; }
function _am(req) { const u = _user(req); return !!(u && ['Admin', 'Manager'].includes(u.pozicio)); }
function _admin(req) { const u = _user(req); return !!(u && u.pozicio === 'Admin'); }

function _str(x, n) { const s = x == null ? null : String(x).trim().slice(0, n); return s || null; }

// Hex-szín normalizálás: #RGB / #RRGGBB (kis/nagybetűre nézve), különben null.
function _hex(x) {
  if (x == null) return null;
  let s = String(x).trim();
  if (!s) return null;
  if (s[0] !== '#') s = '#' + s;
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return false; // érvénytelen -> jelzés
  return s.toLowerCase();
}

// EUR/RON ráta > 0; üres -> null (nincs beállítva).
function _rate(x) {
  if (x === '' || x == null) return null;
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return false;
  return Math.round(n * 10000) / 10000;
}

// ── Olvasás (Admin/Manager) ──
handlers.getCompanySettings = async function (req, res) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const year = new Date().getFullYear();

    const [cR, bR, sR] = await Promise.all([
      pool.query('SELECT nev, eur_ron_rate FROM companies WHERE id=$1', [cid]),
      pool.query('SELECT brand_color, pdf_header_text, logo_mime, (logo_base64 IS NOT NULL) AS has_logo, updated_at FROM company_branding WHERE company_id=$1', [cid]),
      pool.query('SELECT prefix, current_seq FROM document_series WHERE company_id=$1 AND doc_type=$2 AND year=$3', [cid, 'MT', year]),
    ]);

    const c = cR.rows[0] || {};
    const b = bR.rows[0] || {};
    const s = sR.rows[0] || {};

    return res.json({ result: {
      ok: true,
      companyName: c.nev || null,
      brandColor: b.brand_color || null,
      pdfHeaderText: b.pdf_header_text || null,
      hasLogo: !!b.has_logo,
      logoMime: b.logo_mime || null,
      logoUpdatedAt: b.updated_at || null,
      eurRonRate: c.eur_ron_rate != null ? Number(c.eur_ron_rate) : null,
      waybillPrefix: s.prefix || 'MT',
      waybillSeq: s.current_seq || 0,
      year: year,
      canEdit: _admin(req), // a kliens elrejti a mentést Managernél
    } });
  } catch (err) {
    console.error('getCompanySettings hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ── Mentés (CSAK Admin) ──
// args: [{ brandColor?, pdfHeaderText?, eurRonRate?, waybillPrefix? }]
handlers.saveCompanySettings = async function (req, res, args) {
  try {
    if (!_admin(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const a = (args && args[0]) || {};

    // Validáció
    const brandColor = _hex(a.brandColor);
    if (brandColor === false) return res.json({ result: { ok: false, err: 'Cod de culoare invalid (ex. #f6711e).' } });
    const pdfHeader = _str(a.pdfHeaderText, 600);
    const rate = _rate(a.eurRonRate);
    if (rate === false) return res.json({ result: { ok: false, err: 'Curs EUR/RON invalid.' } });
    const prefix = _str(a.waybillPrefix, 10);

    // 1) Arculat (company_branding upsert) — a logót NEM érintjük (külön REST).
    await pool.query(
      `INSERT INTO company_branding (company_id, brand_color, pdf_header_text, updated_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (company_id) DO UPDATE SET brand_color=$2, pdf_header_text=$3, updated_at=now()`,
      [cid, brandColor, pdfHeader]);

    // 2) Cég-szintű árfolyam (companies.eur_ron_rate) — meglévő oszlop.
    await pool.query('UPDATE companies SET eur_ron_rate=$1 WHERE id=$2', [rate, cid]);

    // 3) Menetlevél-prefix (document_series) — a POST /api/document-series-szel
    //    AZONOS upsert; csak ha prefixet adtak (különben az aktuális marad).
    if (prefix) {
      const year = new Date().getFullYear();
      await pool.query(
        `INSERT INTO document_series (company_id, doc_type, prefix, year, current_seq)
         VALUES ($1,$2,$3,$4,0)
         ON CONFLICT (company_id, doc_type, year) DO UPDATE SET prefix=$3, updated_at=NOW()`,
        [cid, 'MT', prefix.toUpperCase(), year]);
    }

    audit.fromReq(req, 'company.settings_save', 'company', cid, {
      brandColor: brandColor || null,
      hasPdfHeader: !!pdfHeader,
      eurRonRate: rate,
      waybillPrefix: prefix ? prefix.toUpperCase() : null,
    });

    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('saveCompanySettings hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
