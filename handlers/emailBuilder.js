// ============================================================
//  VallorSoft — handlers/emailBuilder.js
//  Vizuális e-mail sablon / kimenő levelező modul (Email Builder).
//
//  Cél: a cég (Admin/Manager) vizuálisan (GrapesJS) szerkesztett HTML
//  e-mail sablonokat hoz létre, kezel, és ezeket KÜLSŐ kontaktokhoz
//  (ügyfél / alvállalkozó / egyéb) párosítva küldi ki.
//  NEM a platform saját felhasználóinak — külső kapcsolatoknak.
//
//  Tárolás (db/email-builder.sql):
//    - email_builder_templates  (sablonok, per-cég)
//    - email_contacts           (külső kontaktok, per-cég)
//    - email_template_pairings  (sablon <-> kontakt párosítás)
//    - a küldési napló a MEGLÉVŐ mail_log táblába megy (type='builder').
//
//  Konvenciók (CLAUDE.md):
//    - Multi-tenant: MINDEN SQL company_id-szűrt (session), paraméteres.
//    - Ownership: update/delete/send/párosítás előtt id=$1 AND company_id=$2.
//    - Szerep-gate: Admin/Manager.
//    - EMAIL_RE minden címzettre; a {{változók}} escape-eltek (nincs injekció).
//    - Köteg-korlát a küldésnél (max 200 címzett / hívás).
//    - Audit minden íráson/küldésen (lib/audit.js, best-effort).
//    - Küldés: a CÉG SAJÁT feladó-fiókjáról (SMTP nodemailer és/vagy cégenkénti
//      Brevo) a services/email.js getCompanyMailer-en át — NEM a közös címről.
//      A logMail automatikusan a mail_log-ba ír (type='builder').
//    - Generikus szerver-hiba (nem szivárog stack-trace).
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');
const { getCompanyMailer, loadCompanySender } = require('../services/email');
const { encrypt } = require('../lib/crypto');

const handlers = {};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_TYPES = new Set(['ugyfel', 'alvalalkozo', 'egyeb']);
const MAX_HTML = 200 * 1024;      // 200 KB
const MAX_NAME = 255;
const MAX_SUBJECT = 500;
const MAX_NOTES = 2000;
const MAX_BATCH = 200;            // max címzett / küldés

function _user(req) { return (req && req.session && req.session.user) || null; }
function _am(req) { const u = _user(req); return !!(u && ['Admin', 'Manager'].includes(u.pozicio)); }
function _arg(args) { return (Array.isArray(args) ? args[0] : args) || {}; }
function _str(x, n) { return x == null ? null : String(x).slice(0, n); }
function _denied(res) { return res.json({ result: { ok: false, err: 'Acces interzis' } }); }
function _srvErr(res) { return res.json({ result: { ok: false, err: 'Eroare de server' } }); }

// HTML-escape a változó-behelyettesítéshez (nincs markup/header-injekció).
function escHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// {{nev}}, {{cegnev}}, {{datum}} cseréje escape-elt értékekre.
function applyVars(html, vars) {
  const v = vars || {};
  return String(html || '')
    .replace(/\{\{\s*nev\s*\}\}/g, escHtml(v.nev || ''))
    .replace(/\{\{\s*cegnev\s*\}\}/g, escHtml(v.cegnev || ''))
    .replace(/\{\{\s*datum\s*\}\}/g, escHtml(v.datum || ''));
}

// ─────────────────────────── SABLONOK ───────────────────────────

// Lista (a párosított kontaktok számával). company_id-szűrt.
handlers.ebTemplateList = async function (req, res) {
  try {
    if (!_am(req)) return _denied(res);
    const cid = _user(req).company_id;
    const r = await pool.query(
      `SELECT t.id, t.name, t.subject, t.created_at, t.updated_at,
              (SELECT COUNT(*) FROM email_template_pairings p
                 WHERE p.template_id = t.id AND p.company_id = $1)::int AS pairing_count
         FROM email_builder_templates t
        WHERE t.company_id = $1
        ORDER BY t.updated_at DESC, t.id DESC`,
      [cid]
    );
    return res.json({ result: { ok: true, templates: r.rows } });
  } catch (err) {
    console.error('ebTemplateList hiba:', err);
    return _srvErr(res);
  }
};

// Egy sablon (ownership: id=$1 AND company_id=$2).
handlers.ebTemplateGet = async function (req, res, args) {
  try {
    if (!_am(req)) return _denied(res);
    const cid = _user(req).company_id;
    const id = parseInt(_arg(args).id, 10);
    if (!id) return res.json({ result: { ok: false, err: 'ID invalid' } });
    const r = await pool.query(
      `SELECT id, name, subject, html_content, grapes_json, created_at, updated_at
         FROM email_builder_templates WHERE id = $1 AND company_id = $2`,
      [id, cid]
    );
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Negăsit' } });
    return res.json({ result: { ok: true, template: r.rows[0] } });
  } catch (err) {
    console.error('ebTemplateGet hiba:', err);
    return _srvErr(res);
  }
};

// Mentés (insert vagy update). args: [{ id?, name, subject, html_content, grapes_json }]
handlers.ebTemplateSave = async function (req, res, args) {
  try {
    if (!_am(req)) return _denied(res);
    const u = _user(req);
    const cid = u.company_id;
    const a = _arg(args);

    const name = _str((a.name || '').trim(), MAX_NAME);
    if (!name) return res.json({ result: { ok: false, err: 'Numele șablonului este obligatoriu' } });
    const subject = _str((a.subject || '').trim(), MAX_SUBJECT);

    const html = a.html_content == null ? '' : String(a.html_content);
    if (html.length > MAX_HTML) return res.json({ result: { ok: false, err: 'Conținut HTML prea mare (max 200KB)' } });

    // grapes_json: objektum vagy JSON-string is jöhet a kliensről → JSONB-be.
    let grapes = null;
    if (a.grapes_json != null) {
      try {
        grapes = typeof a.grapes_json === 'string' ? JSON.parse(a.grapes_json) : a.grapes_json;
      } catch (_) { grapes = null; }
    }

    const id = a.id ? parseInt(a.id, 10) : null;
    if (id) {
      // Ownership-ellenőrzés a WHERE-ben (id + company_id) — cross-tenant védelem.
      const r = await pool.query(
        `UPDATE email_builder_templates
            SET name=$1, subject=$2, html_content=$3, grapes_json=$4, updated_at=NOW()
          WHERE id=$5 AND company_id=$6
        RETURNING id`,
        [name, subject, html, grapes, id, cid]
      );
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Negăsit' } });
      audit.fromReq(req, 'email_builder.template_save', 'email_builder_template', String(id), { update: true });
      return res.json({ result: { ok: true, id } });
    }

    const ins = await pool.query(
      `INSERT INTO email_builder_templates
         (company_id, name, subject, html_content, grapes_json, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [cid, name, subject, html, grapes, u.id || null]
    );
    const newId = ins.rows[0].id;
    audit.fromReq(req, 'email_builder.template_save', 'email_builder_template', String(newId), { create: true });
    return res.json({ result: { ok: true, id: newId } });
  } catch (err) {
    console.error('ebTemplateSave hiba:', err);
    return _srvErr(res);
  }
};

// Törlés (ownership a WHERE-ben). A párosítások ON DELETE CASCADE törlődnek.
handlers.ebTemplateDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return _denied(res);
    const cid = _user(req).company_id;
    const id = parseInt(_arg(args).id, 10);
    if (!id) return res.json({ result: { ok: false, err: 'ID invalid' } });
    const r = await pool.query(
      `DELETE FROM email_builder_templates WHERE id=$1 AND company_id=$2 RETURNING id`,
      [id, cid]
    );
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Negăsit' } });
    audit.fromReq(req, 'email_builder.template_delete', 'email_builder_template', String(id), {});
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('ebTemplateDelete hiba:', err);
    return _srvErr(res);
  }
};

// ─────────────────────────── KONTAKTOK ──────────────────────────

handlers.ebContactList = async function (req, res) {
  try {
    if (!_am(req)) return _denied(res);
    const cid = _user(req).company_id;
    const r = await pool.query(
      `SELECT id, name, email, type, notes, created_at
         FROM email_contacts WHERE company_id=$1
        ORDER BY name ASC, id ASC`,
      [cid]
    );
    return res.json({ result: { ok: true, contacts: r.rows } });
  } catch (err) {
    console.error('ebContactList hiba:', err);
    return _srvErr(res);
  }
};

// Kontakt mentése (insert/update). args: [{ id?, name, email, type, notes }]
handlers.ebContactSave = async function (req, res, args) {
  try {
    if (!_am(req)) return _denied(res);
    const cid = _user(req).company_id;
    const a = _arg(args);

    const name = _str((a.name || '').trim(), MAX_NAME);
    if (!name) return res.json({ result: { ok: false, err: 'Numele este obligatoriu' } });
    const email = String(a.email || '').trim();
    if (!EMAIL_RE.test(email)) return res.json({ result: { ok: false, err: 'E-mail invalid' } });
    let type = String(a.type || 'ugyfel').trim();
    if (!CONTACT_TYPES.has(type)) type = 'ugyfel';
    const notes = _str(a.notes, MAX_NOTES);

    const id = a.id ? parseInt(a.id, 10) : null;
    // Ne legyen két azonos e-mail-című kontakt a cégnél (akár insert, akár átírás).
    const dup = await pool.query(
      `SELECT id FROM email_contacts WHERE company_id=$1 AND lower(email)=lower($2)` + (id ? ' AND id<>$3' : ''),
      id ? [cid, email, id] : [cid, email]
    );
    if (dup.rows.length) return res.json({ result: { ok: false, err: 'Există deja un contact cu acest e-mail.' } });
    if (id) {
      const r = await pool.query(
        `UPDATE email_contacts SET name=$1, email=$2, type=$3, notes=$4
          WHERE id=$5 AND company_id=$6 RETURNING id`,
        [name, _str(email, 255), type, notes, id, cid]
      );
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Negăsit' } });
      audit.fromReq(req, 'email_builder.contact_save', 'email_contact', String(id), { update: true });
      return res.json({ result: { ok: true, id } });
    }
    const ins = await pool.query(
      `INSERT INTO email_contacts (company_id, name, email, type, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [cid, name, _str(email, 255), type, notes]
    );
    audit.fromReq(req, 'email_builder.contact_save', 'email_contact', String(ins.rows[0].id), { create: true });
    return res.json({ result: { ok: true, id: ins.rows[0].id } });
  } catch (err) {
    console.error('ebContactSave hiba:', err);
    return _srvErr(res);
  }
};

handlers.ebContactDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return _denied(res);
    const cid = _user(req).company_id;
    const id = parseInt(_arg(args).id, 10);
    if (!id) return res.json({ result: { ok: false, err: 'ID invalid' } });
    const r = await pool.query(
      `DELETE FROM email_contacts WHERE id=$1 AND company_id=$2 RETURNING id`,
      [id, cid]
    );
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Negăsit' } });
    audit.fromReq(req, 'email_builder.contact_delete', 'email_contact', String(id), {});
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('ebContactDelete hiba:', err);
    return _srvErr(res);
  }
};

// ─────────────────────────── PÁROSÍTÁS ──────────────────────────

// Egy sablonhoz párosított kontakt-ID-k. args: [{ template_id }]
handlers.ebPairingGet = async function (req, res, args) {
  try {
    if (!_am(req)) return _denied(res);
    const cid = _user(req).company_id;
    const tid = parseInt(_arg(args).template_id, 10);
    if (!tid) return res.json({ result: { ok: false, err: 'ID invalid' } });
    // Tulajdon-ellenőrzés: a sablon a cégé?
    const t = await pool.query(
      `SELECT id FROM email_builder_templates WHERE id=$1 AND company_id=$2`, [tid, cid]
    );
    if (!t.rows.length) return res.json({ result: { ok: false, err: 'Negăsit' } });
    const r = await pool.query(
      `SELECT contact_id FROM email_template_pairings
        WHERE template_id=$1 AND company_id=$2`,
      [tid, cid]
    );
    return res.json({ result: { ok: true, contact_ids: r.rows.map(x => x.contact_id) } });
  } catch (err) {
    console.error('ebPairingGet hiba:', err);
    return _srvErr(res);
  }
};

// Párosítás mentése: a régi párosítások törlése + az újak beszúrása.
// args: [{ template_id, contact_ids: [] }]
handlers.ebPairingSave = async function (req, res, args) {
  const client = await pool.connect();
  try {
    if (!_am(req)) { client.release(); return _denied(res); }
    const cid = _user(req).company_id;
    const a = _arg(args);
    const tid = parseInt(a.template_id, 10);
    if (!tid) { client.release(); return res.json({ result: { ok: false, err: 'ID invalid' } }); }

    // A sablon a cégé?
    const t = await client.query(
      `SELECT id FROM email_builder_templates WHERE id=$1 AND company_id=$2`, [tid, cid]
    );
    if (!t.rows.length) { client.release(); return res.json({ result: { ok: false, err: 'Negăsit' } }); }

    let ids = Array.isArray(a.contact_ids) ? a.contact_ids.map(x => parseInt(x, 10)).filter(Boolean) : [];
    ids = [...new Set(ids)];
    // Csak a CÉGHEZ tartozó kontaktok maradnak (cross-tenant védelem).
    let validIds = [];
    if (ids.length) {
      const c = await client.query(
        `SELECT id FROM email_contacts WHERE company_id=$1 AND id = ANY($2::int[])`,
        [cid, ids]
      );
      validIds = c.rows.map(x => x.id);
    }

    await client.query('BEGIN');
    await client.query(
      `DELETE FROM email_template_pairings WHERE template_id=$1 AND company_id=$2`, [tid, cid]
    );
    for (const contactId of validIds) {
      await client.query(
        `INSERT INTO email_template_pairings (company_id, template_id, contact_id)
         VALUES ($1,$2,$3) ON CONFLICT (template_id, contact_id) DO NOTHING`,
        [cid, tid, contactId]
      );
    }
    await client.query('COMMIT');
    audit.fromReq(req, 'email_builder.pairing_save', 'email_builder_template', String(tid), { count: validIds.length });
    return res.json({ result: { ok: true, count: validIds.length } });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('ebPairingSave hiba:', err);
    return _srvErr(res);
  } finally {
    client.release();
  }
};

// ─────────────────────────── KÜLDÉS ─────────────────────────────

// Sablon kiküldése a kijelölt kontaktoknak + extra e-maileknek.
// args: [{ template_id, contact_ids: [], extra_emails: [], variables: {} }]
handlers.ebSend = async function (req, res, args) {
  try {
    if (!_am(req)) return _denied(res);
    const u = _user(req);
    const cid = u.company_id;
    const a = _arg(args);

    const tid = parseInt(a.template_id, 10);
    if (!tid) return res.json({ result: { ok: false, err: 'Selectați un șablon' } });

    // Sablon ownership (company_id-szűrt).
    const tr = await pool.query(
      `SELECT id, name, subject, html_content FROM email_builder_templates
        WHERE id=$1 AND company_id=$2`,
      [tid, cid]
    );
    if (!tr.rows.length) return res.json({ result: { ok: false, err: 'Negăsit' } });
    const tpl = tr.rows[0];
    // Üres sablont nincs értelme kiküldeni.
    if (!String(tpl.html_content || '').trim()) {
      return res.json({ result: { ok: false, err: 'Șablonul este gol — adăugați conținut înainte de trimitere.' } });
    }

    // Címzett-feloldás: 1) a cég kontaktjai a contact_ids-ből (company-szűrt),
    //                   2) extra_emails (mind EMAIL_RE-validált).
    const recipients = []; // { email, name }
    const seen = new Set();

    let ids = Array.isArray(a.contact_ids) ? a.contact_ids.map(x => parseInt(x, 10)).filter(Boolean) : [];
    const extraRaw = Array.isArray(a.extra_emails) ? a.extra_emails : [];
    // Ha a hívó NEM adott meg címzettet, a sablon MENTETT párosítását használjuk —
    // a párosítás lényege, hogy a sablon a párosított kontaktoknak menjen egy lépésben.
    if (!ids.length && !extraRaw.length) {
      const p = await pool.query(
        `SELECT contact_id FROM email_template_pairings WHERE template_id=$1 AND company_id=$2`,
        [tid, cid]
      );
      ids = p.rows.map(x => x.contact_id);
    }
    if (ids.length) {
      const cr = await pool.query(
        `SELECT name, email FROM email_contacts
          WHERE company_id=$1 AND id = ANY($2::int[])`,
        [cid, [...new Set(ids)]]
      );
      for (const c of cr.rows) {
        const em = String(c.email || '').trim().toLowerCase();
        if (EMAIL_RE.test(em) && !seen.has(em)) { seen.add(em); recipients.push({ email: c.email.trim(), name: c.name || '' }); }
      }
    }

    for (const raw of extraRaw) {
      const em = String(raw || '').trim();
      const key = em.toLowerCase();
      if (EMAIL_RE.test(em) && !seen.has(key)) { seen.add(key); recipients.push({ email: em, name: '' }); }
    }

    if (!recipients.length) return res.json({ result: { ok: false, err: 'Niciun destinatar valid — selectați contacte, adăugați e-mailuri sau asociați contacte cu acest șablon.' } });
    if (recipients.length > MAX_BATCH) {
      return res.json({ result: { ok: false, err: 'Prea mulți destinatari (max ' + MAX_BATCH + ')' } });
    }

    // Változók: a cégnév alapból a cég neve, ha nem adott meg a hívó.
    const baseVars = (a.variables && typeof a.variables === 'object' && !Array.isArray(a.variables)) ? a.variables : {};
    let companyName = baseVars.cegnev;
    if (!companyName) {
      try { const b = await pool.query('SELECT nev FROM companies WHERE id=$1', [cid]); companyName = b.rows[0] && b.rows[0].nev; } catch (_) {}
    }
    const today = new Date().toISOString().slice(0, 10);

    // A CÉG saját feladó-fiókja (SMTP és/vagy cégenkénti Brevo) — egyszer feloldva
    // a kötegre. Ha nincs beállítva, NEM küldünk közös címről: egyértelmű hiba.
    const mailer = await getCompanyMailer(cid);
    if (!mailer.ok) {
      return res.json({ result: { ok: false, err: mailer.noConfig
        ? 'Configurați mai întâi contul de e-mail expeditor (fila „Cont expeditor”).'
        : (mailer.error || 'Eroare la contul expeditor') } });
    }

    let sent = 0;
    const errors = [];
    for (const rcpt of recipients) {
      const vars = {
        nev: rcpt.name || baseVars.nev || '',
        cegnev: companyName || '',
        datum: baseVars.datum || today,
      };
      // A {{nev}}/{{cegnev}}/{{datum}} értékei escape-eltek → nincs injekció.
      // A sablon teljes (GrapesJS-inline-olt) HTML-jét nyersen küldjük — a saját
      // arculatát/logóját már tartalmazza, nem csomagoljuk be újra.
      const html = applyVars(tpl.html_content || '', vars);
      const subject = applyVars(tpl.subject || tpl.name || '(fără subiect)', vars);
      try {
        // A mailer.send a CÉG fiókjáról küld + naplóz a mail_log-ba (type='builder').
        const r = await mailer.send({
          to: rcpt.email,
          subject: subject || '(fără subiect)',
          html: html,
          mailType: 'builder',
        });
        if (r && r.ok) sent++;
        else errors.push({ email: rcpt.email, error: (r && r.error) || 'Eroare la trimitere' });
      } catch (e) {
        errors.push({ email: rcpt.email, error: 'Eroare la trimitere' });
      }
    }

    audit.fromReq(req, 'email_builder.send', 'email_builder_template', String(tid), {
      total: recipients.length, sent, failed: errors.length,
    });
    return res.json({ result: { ok: true, sent, errors } });
  } catch (err) {
    console.error('ebSend hiba:', err);
    return _srvErr(res);
  }
};

// Küldési napló — a mail_log-ból (type='builder'), company_id-szűrt, max 100.
handlers.ebSendLog = async function (req, res) {
  try {
    if (!_am(req)) return _denied(res);
    const cid = _user(req).company_id;
    const r = await pool.query(
      `SELECT id, to_email, subject, status, created_at
         FROM mail_log
        WHERE company_id=$1 AND type='builder'
        ORDER BY created_at DESC
        LIMIT 100`,
      [cid]
    );
    return res.json({ result: { ok: true, logs: r.rows } });
  } catch (err) {
    console.error('ebSendLog hiba:', err);
    return _srvErr(res);
  }
};

// ───────────────────── FELADÓ-FIÓK (cég saját SMTP / Brevo) ─────────────────────
// A kimenő levelek a CÉG saját fiókjáról mennek (ne egy közös címről).
// Csak Admin (vagy dev) állíthatja; a titkok (jelszó/API-kulcs) sosem mennek ki.

function _adminOnly(req) {
  const u = _user(req);
  return !!(u && (u.pozicio === 'Admin' || u.is_dev));
}

// A jelenlegi feladó-konfig MASZKOLVA (titkok nélkül). Admin/Manager olvashatja.
handlers.ebSenderGet = async function (req, res) {
  try {
    if (!_am(req)) return _denied(res);
    const cid = _user(req).company_id;
    const cfg = await loadCompanySender(cid);
    if (!cfg) return res.json({ result: { ok: true, configured: false } });
    return res.json({ result: { ok: true, configured: true,
      prefer: cfg.prefer === 'brevo' ? 'brevo' : 'smtp',
      from_name: cfg.from_name || '',
      from_email: cfg.from_email || '',
      host: cfg.host || '',
      port: cfg.port || '',
      secure: !!cfg.secure,
      user: cfg.user || '',
      has_pass: !!cfg.pass,
      has_brevo_key: !!cfg.brevo_api_key,
    } });
  } catch (err) {
    console.error('ebSenderGet hiba:', err);
    return _srvErr(res);
  }
};

// Feladó-fiók mentése (csak Admin). A jelszó/API-kulcs üresen hagyva = megőrzi a tároltat.
// args: [{ prefer, from_name, from_email, host, port, secure, user, pass, brevo_api_key }]
handlers.ebSenderSave = async function (req, res, args) {
  try {
    if (!_adminOnly(req)) return res.json({ result: { ok: false, err: 'Doar Adminul poate configura contul expeditor.' } });
    const cid = _user(req).company_id;
    const a = _arg(args);

    const prefer = a.prefer === 'brevo' ? 'brevo' : 'smtp';
    const from_email = String(a.from_email || '').trim();
    if (!EMAIL_RE.test(from_email)) return res.json({ result: { ok: false, err: 'E-mail expeditor invalid' } });

    const prev = (await loadCompanySender(cid)) || {};
    const port = parseInt(a.port, 10);
    const cfg = {
      prefer: prefer,
      from_name: _str((a.from_name || '').trim(), MAX_NAME) || '',
      from_email: from_email,
      host: _str((a.host || '').trim(), 255) || '',
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : (prefer === 'smtp' ? 587 : null),
      secure: (a.secure === true || String(a.secure) === 'true'),
      user: _str((a.user || '').trim(), 255) || '',
      // Titkok megőrzése, ha a kliens üresen hagyta (mint az intake-nél).
      pass: (a.pass != null && String(a.pass).length) ? String(a.pass) : (prev.pass || ''),
      brevo_api_key: (a.brevo_api_key != null && String(a.brevo_api_key).trim().length)
        ? String(a.brevo_api_key).trim() : (prev.brevo_api_key || ''),
    };

    const smtpComplete = !!(cfg.host && cfg.user && cfg.pass);
    const brevoComplete = !!cfg.brevo_api_key;
    if (prefer === 'smtp' && !smtpComplete && !brevoComplete)
      return res.json({ result: { ok: false, err: 'Pentru SMTP completați serverul, utilizatorul și parola.' } });
    if (prefer === 'brevo' && !brevoComplete)
      return res.json({ result: { ok: false, err: 'Pentru Brevo introduceți cheia API.' } });

    const enc = encrypt(JSON.stringify(cfg));
    const meta = { method: prefer, from_email: from_email };
    await pool.query(
      `INSERT INTO company_integrations (company_id, provider, category, enabled, credentials_enc, meta, updated_at)
       VALUES ($1,'email_sender','email_out',true,$2,$3,now())
       ON CONFLICT (company_id, provider)
       DO UPDATE SET credentials_enc=$2, meta=$3, enabled=true, updated_at=now()`,
      [cid, enc, JSON.stringify(meta)]
    );
    audit.fromReq(req, 'email_builder.sender_save', 'company_integration', 'email_sender', { method: prefer });
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('ebSenderSave hiba:', err);
    return _srvErr(res);
  }
};

// Teszt: a saját (admin) e-mail-címre küld egy próbalevelet a beállított módon.
handlers.ebSenderTest = async function (req, res) {
  try {
    if (!_am(req)) return _denied(res);
    const u = _user(req);
    const mailer = await getCompanyMailer(u.company_id);
    if (!mailer.ok) {
      return res.json({ result: { ok: false, err: mailer.noConfig
        ? 'Configurați mai întâi contul expeditor.' : (mailer.error || 'Eroare la contul expeditor') } });
    }
    const to = String(u.email || '').trim();
    if (!EMAIL_RE.test(to)) return res.json({ result: { ok: false, err: 'Adresa dvs. de e-mail lipsește.' } });
    const r = await mailer.send({
      to: to,
      subject: 'VallorSoft — test cont expeditor',
      html: '<p>Test reușit. Contul expeditor al companiei funcționează (metodă: <b>' + mailer.method + '</b>).</p>',
      mailType: 'builder',
    });
    if (r && r.ok) return res.json({ result: { ok: true, method: mailer.method, message: 'Test trimis către ' + to + ' (metodă: ' + mailer.method + ')' } });
    return res.json({ result: { ok: false, err: (r && r.error) || 'Eroare la trimitere' } });
  } catch (err) {
    console.error('ebSenderTest hiba:', err);
    return _srvErr(res);
  }
};

// Feladó-fiók törlése (csak Admin).
handlers.ebSenderDelete = async function (req, res) {
  try {
    if (!_adminOnly(req)) return res.json({ result: { ok: false, err: 'Doar Adminul poate șterge.' } });
    const cid = _user(req).company_id;
    await pool.query(`DELETE FROM company_integrations WHERE company_id=$1 AND provider='email_sender'`, [cid]);
    audit.fromReq(req, 'email_builder.sender_delete', 'company_integration', 'email_sender', {});
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('ebSenderDelete hiba:', err);
    return _srvErr(res);
  }
};

module.exports = handlers;
