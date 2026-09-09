// ============================================================
//  VallorSoft — handlers/pdfWorkspace.js
//  ------------------------------------------------------------
//  Az admin/manager „Aláírás és pecsét" oldalán található közvetlen
//  PDF-munkatér: fuvarhoz NEM kötött, tetszőleges dokumentumot lehet
//  feltölteni, aláírni/pecsételni, letölteni. A feltöltés 24 óráig
//  tárolódik (services/scheduler.js `startPdfWorkspaceCleanup` törli).
//
//  Szerep-kapu: Admin | Manager (a Sofer szerep NEM éri el).
//  Tenant izoláció: minden lekérdezés user_email + company_id.
// ============================================================
const pool = require('../db');
const { genDocId } = require('../lib/ids');
const audit = require('../lib/audit');

const handlers = {};

function _isAM(u) {
  return u && (u.pozicio === 'Admin' || u.pozicio === 'Manager');
}

// ~15 MB base64 → ~11 MB nyers PDF. A régi order-doc upload nem korlátozott
// méretben (a body-parser 50 MB), de itt szűkítünk, mert 24 óráig tárolunk.
const MAX_BYTES = 15 * 1024 * 1024;

// Sanitize file név — a helper egyszerű, mert csak megjelenítés + Content-
// Disposition; a DB-be paraméteres SQL-lel megy.
function _sanitizeName(s) {
  const raw = String(s || '').trim();
  if (!raw) return 'document.pdf';
  // control chars kizárva; a max 300 char megegyezik a schemával
  return raw.replace(/[\x00-\x1F\x7F]/g, '').slice(0, 300);
}

// args[0]: { file_name: string, base64: string (data URL VAGY nyers b64) }
handlers.pdfWorkspaceUpload = async function (req, res, args) {
  try {
    if (!req.session.user || !_isAM(req.session.user)) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const p = args && args[0] ? args[0] : {};
    const fileName = _sanitizeName(p.file_name);
    let b64 = String(p.base64 || '');
    if (!b64) return res.json({ result: { ok: false, err: 'Fisier lipsa' } });
    // Elfogadunk data URL-t és nyers base64-et is; a tárolást data URL formában
    // szabványosítjuk, hogy a letöltés/megjelenítés egyszerű legyen.
    if (b64.indexOf('data:') !== 0) {
      b64 = 'data:application/pdf;base64,' + b64;
    }
    if (b64.length > MAX_BYTES) {
      return res.json({ result: { ok: false, err: 'Fisier prea mare (max 15 MB)' } });
    }
    // Csak PDF-et fogadunk el (a signModal PDF-alapú aláírást ismer).
    if (!/^data:application\/pdf;/i.test(b64)) {
      return res.json({ result: { ok: false, err: 'Doar PDF acceptat' } });
    }
    const id = genDocId('WSP');
    const email = req.session.user.email;
    const cid = req.session.user.company_id;
    await pool.query(
      `INSERT INTO pdf_workspace_docs
         (id, user_email, company_id, file_name, original_base64, file_size, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [id, email, cid, fileName, b64, b64.length]
    );
    try {
      await audit.fromReq(req, 'pdf_workspace.upload', 'pdf_workspace_docs', id, { file_name: fileName, size: b64.length });
    } catch (_) {}
    return res.json({ result: { ok: true, id, file_name: fileName } });
  } catch (err) {
    console.error('pdfWorkspaceUpload hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Aktuális user saját listája (24h). company_id-re is szűrünk (nem csak email —
// egy user email globálisan UNIQUE, de a defenzív szűrés így is helyes).
handlers.pdfWorkspaceList = async function (req, res) {
  try {
    if (!req.session.user || !_isAM(req.session.user)) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const email = req.session.user.email;
    const cid = req.session.user.company_id;
    const r = await pool.query(
      `SELECT id, file_name, file_size, created_at, updated_at,
              (signed_base64 IS NOT NULL) AS has_signed
         FROM pdf_workspace_docs
        WHERE user_email = $1 AND company_id = $2
          AND created_at > NOW() - INTERVAL '24 hours'
        ORDER BY created_at DESC
        LIMIT 100`,
      [email, cid]
    );
    return res.json({ result: { ok: true, docs: r.rows } });
  } catch (err) {
    console.error('pdfWorkspaceList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// args: [id, which?]  — which: 'signed' → aláírt verzió (ha van), különben eredeti.
handlers.pdfWorkspaceGet = async function (req, res, args) {
  try {
    if (!req.session.user || !_isAM(req.session.user)) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const id = String((args && args[0]) || '').trim();
    const which = (args && args[1] === 'signed') ? 'signed' : 'original';
    if (!id) return res.json({ result: { ok: false, err: 'Identificator lipsa' } });
    const email = req.session.user.email;
    const cid = req.session.user.company_id;
    const r = await pool.query(
      `SELECT file_name, original_base64, signed_base64
         FROM pdf_workspace_docs
        WHERE id = $1 AND user_email = $2 AND company_id = $3`,
      [id, email, cid]
    );
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost gasit' } });
    const row = r.rows[0];
    const base64 = which === 'signed' ? row.signed_base64 : row.original_base64;
    if (!base64) return res.json({ result: { ok: false, err: 'Nu exista aceasta varianta' } });
    return res.json({ result: { ok: true, base64, fileName: row.file_name } });
  } catch (err) {
    console.error('pdfWorkspaceGet hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// args: [id, base64] — az aláírt/pecsételt PDF elmentése ugyanabba a sorba.
handlers.pdfWorkspaceSaveSigned = async function (req, res, args) {
  try {
    if (!req.session.user || !_isAM(req.session.user)) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const id = String((args && args[0]) || '').trim();
    let b64 = String((args && args[1]) || '');
    if (!id || !b64) return res.json({ result: { ok: false, err: 'Date lipsa' } });
    if (b64.indexOf('data:') !== 0) {
      b64 = 'data:application/pdf;base64,' + b64;
    }
    if (b64.length > MAX_BYTES) {
      return res.json({ result: { ok: false, err: 'Fisier prea mare (max 15 MB)' } });
    }
    const email = req.session.user.email;
    const cid = req.session.user.company_id;
    const r = await pool.query(
      `UPDATE pdf_workspace_docs
          SET signed_base64 = $1, updated_at = NOW()
        WHERE id = $2 AND user_email = $3 AND company_id = $4
        RETURNING id`,
      [b64, id, email, cid]
    );
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost gasit' } });
    try {
      await audit.fromReq(req, 'pdf_workspace.sign', 'pdf_workspace_docs', id, { size: b64.length });
    } catch (_) {}
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('pdfWorkspaceSaveSigned hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.pdfWorkspaceDelete = async function (req, res, args) {
  try {
    if (!req.session.user || !_isAM(req.session.user)) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const id = String((args && args[0]) || '').trim();
    if (!id) return res.json({ result: { ok: false, err: 'Identificator lipsa' } });
    const email = req.session.user.email;
    const cid = req.session.user.company_id;
    const r = await pool.query(
      `DELETE FROM pdf_workspace_docs
        WHERE id = $1 AND user_email = $2 AND company_id = $3
        RETURNING id`,
      [id, email, cid]
    );
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost gasit' } });
    try {
      await audit.fromReq(req, 'pdf_workspace.delete', 'pdf_workspace_docs', id, {});
    } catch (_) {}
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('pdfWorkspaceDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
