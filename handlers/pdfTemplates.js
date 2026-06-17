// ============================================================
//  VallorSoft — handlers/pdfTemplates.js
//  PDF-sablon beállítások (MVP) — dokumentumtípusonkénti testreszabás.
//
//  ÚJRAHASZNÁLT infrastruktúra (NEM duplikálunk):
//    - company_branding (logó: logo_base64/logo_mime; brand_color) — a LOGÓ
//      és az alap akcent-szín innen jön; itt csak a per-típus felülírások
//      (fejléc/lábléc/akcent/logó-megjelenítés) élnek.
//    - audit (lib/audit.js), pool (db).
//
//  Tárolás: pdf_templates (db/pdf-templates.sql) — UNIQUE(company_id, doc_type).
//  Multi-tenant: company_id a session-ből, minden SQL paraméteres + cég-szűrt.
//  Olvasás: Admin/Manager. Írás: CSAK Admin.
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');

const handlers = {};

// Engedélyezett dokumentumtípusok (fehérlista).
const DOC_TYPES = ['order', 'waybill', 'cmr', 'invoice_note'];

function _user(req) { return (req && req.session && req.session.user) || null; }
function _am(req) { const u = _user(req); return !!(u && ['Admin', 'Manager'].includes(u.pozicio)); }
function _admin(req) { const u = _user(req); return !!(u && u.pozicio === 'Admin'); }

function _str(x, n) { const s = x == null ? null : String(x).trim().slice(0, n); return s || null; }

// Hex-szín normalizálás: #RGB / #RRGGBB; üres -> null; érvénytelen -> false.
function _hex(x) {
  if (x == null || x === '') return null;
  let s = String(x).trim();
  if (!s) return null;
  if (s[0] !== '#') s = '#' + s;
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return false;
  return s.toLowerCase();
}

// ── Lista (Admin/Manager) — minden típus + az alap arculat ──
// Visszaadja a mentett sablonokat típusonként + a company_branding alapot
// (logo/brand_color), hogy a kliens az örökölt értékeket mutathassa.
handlers.pdfTemplateList = async function (req, res) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;

    const [tR, bR] = await Promise.all([
      pool.query('SELECT doc_type, header_text, footer_text, accent_color, show_logo, updated_at FROM pdf_templates WHERE company_id=$1', [cid]),
      pool.query('SELECT brand_color, (logo_base64 IS NOT NULL) AS has_logo FROM company_branding WHERE company_id=$1', [cid]),
    ]);

    const byType = {};
    for (const r of tR.rows) byType[r.doc_type] = r;
    const b = bR.rows[0] || {};

    const templates = DOC_TYPES.map(function (dt) {
      const row = byType[dt] || {};
      return {
        doc_type: dt,
        header_text: row.header_text || null,
        footer_text: row.footer_text || null,
        accent_color: row.accent_color || null,
        show_logo: row.show_logo == null ? true : !!row.show_logo,
        updated_at: row.updated_at || null,
      };
    });

    return res.json({ result: {
      ok: true,
      templates: templates,
      docTypes: DOC_TYPES.slice(),
      brandColor: b.brand_color || null,
      hasLogo: !!b.has_logo,
      canEdit: _admin(req),
    } });
  } catch (err) {
    console.error('pdfTemplateList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ── Egy típus lekérése (Admin/Manager) ──
// args: [docType]
handlers.pdfTemplateGet = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const dt = _str((args && args[0]), 32);
    if (!dt || DOC_TYPES.indexOf(dt) === -1) return res.json({ result: { ok: false, err: 'Tip de document invalid' } });

    const r = await pool.query(
      'SELECT doc_type, header_text, footer_text, accent_color, show_logo, updated_at FROM pdf_templates WHERE company_id=$1 AND doc_type=$2',
      [cid, dt]);
    const row = r.rows[0] || {};
    return res.json({ result: {
      ok: true,
      template: {
        doc_type: dt,
        header_text: row.header_text || null,
        footer_text: row.footer_text || null,
        accent_color: row.accent_color || null,
        show_logo: row.show_logo == null ? true : !!row.show_logo,
        updated_at: row.updated_at || null,
      },
    } });
  } catch (err) {
    console.error('pdfTemplateGet hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ── Mentés (CSAK Admin) ──
// args: [{ docType, headerText?, footerText?, accentColor?, showLogo? }]
handlers.pdfTemplateSave = async function (req, res, args) {
  try {
    if (!_admin(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const a = (args && args[0]) || {};

    const dt = _str(a.docType, 32);
    if (!dt || DOC_TYPES.indexOf(dt) === -1) return res.json({ result: { ok: false, err: 'Tip de document invalid' } });

    const headerText = _str(a.headerText, 600);
    const footerText = _str(a.footerText, 600);
    const accent = _hex(a.accentColor);
    if (accent === false) return res.json({ result: { ok: false, err: 'Cod de culoare invalid (ex. #f6711e).' } });
    const showLogo = a.showLogo == null ? true : !!a.showLogo;

    await pool.query(
      `INSERT INTO pdf_templates (company_id, doc_type, header_text, footer_text, accent_color, show_logo, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (company_id, doc_type)
       DO UPDATE SET header_text=$3, footer_text=$4, accent_color=$5, show_logo=$6, updated_at=now()`,
      [cid, dt, headerText, footerText, accent, showLogo]);

    audit.fromReq(req, 'pdf_template.save', 'pdf_template', dt, {
      docType: dt,
      hasHeader: !!headerText,
      hasFooter: !!footerText,
      accentColor: accent || null,
      showLogo: showLogo,
    });

    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('pdfTemplateSave hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
