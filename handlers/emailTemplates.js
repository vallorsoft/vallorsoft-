// ============================================================
//  VallorSoft — handlers/emailTemplates.js
//  Cégszintű TRANZAKCIÓS e-mail sablon-kezelő + "sablonból küldés".
//
//  KÜLÖN a developer rendszer-sablonjaitól (developer_settings email_sys_*)
//  ÉS a kliens-levelező szabad sablonjaitól (email_templates tábla).
//  Tárolás: company_email_templates (db/company-email-templates.sql).
//
//  Konvenciók:
//    - Multi-tenant: minden SQL company_id-szűrt (session), paraméteres.
//    - Szerep-gate: Admin/Manager.
//    - Audit minden íráson/küldésen (lib/audit.js, best-effort).
//    - Küldés: services/email.js sendClientEmail (Brevo) — a logMail
//      automatikusan naplóz a mail_log-ba.
//    - Változó-behelyettesítés: services/email.js applyTemplateVars
//      (HTML-escape-eli a felhasználói értékeket -> nincs injekció).
//    - A címzettet/változókat a hívó adja, de a sablon a CÉG SAJÁTJA,
//      és a küldés szerver-oldalon, sima Brevo-küldéssel megy (nincs SSRF/
//      header-injekció: csak az e-mail-cím + escape-elt változók mennek ki).
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');
const { sendClientEmail, applyTemplateVars, getCompanyMailer } = require('../services/email');

const handlers = {};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Engedélyezett tranzakciós sablon-kulcsok (fehérlista) + alapértelmezett
// kétnyelvű (RO-alap + HU) tartalom seedhez. A {{változók}} escape-eltek.
const TEMPLATE_KEYS = {
  order_confirm_carrier: {
    category: 'orders',
    subject_ro: 'Confirmare transport {{order_id}}',
    subject_hu: 'Fuvar-visszaigazolás {{order_id}}',
    body_ro: '<p>Bună ziua,</p><p>Confirmăm transportul <b>{{order_id}}</b> pe ruta <b>{{route}}</b>.</p><p>Vă mulțumim pentru colaborare.</p>',
    body_hu: '<p>Jó napot,</p><p>Visszaigazoljuk a(z) <b>{{order_id}}</b> fuvart a(z) <b>{{route}}</b> útvonalon.</p><p>Köszönjük az együttműködést.</p>',
  },
  order_status_change: {
    category: 'orders',
    subject_ro: 'Actualizare status transport {{order_id}}',
    subject_hu: 'Fuvar státusz-változás {{order_id}}',
    body_ro: '<p>Bună ziua,</p><p>Statusul transportului <b>{{order_id}}</b> ({{route}}) s-a schimbat în: <b>{{status}}</b>.</p>',
    body_hu: '<p>Jó napot,</p><p>A(z) <b>{{order_id}}</b> fuvar ({{route}}) státusza megváltozott: <b>{{status}}</b>.</p>',
  },
  quote_send: {
    category: 'sales',
    subject_ro: 'Ofertă de preț — {{route}}',
    subject_hu: 'Árajánlat — {{route}}',
    body_ro: '<p>Stimate {{client}},</p><p>Vă transmitem oferta noastră pentru transportul pe ruta <b>{{route}}</b>: <b>{{pret}}</b>.</p><p>Așteptăm confirmarea dvs.</p>',
    body_hu: '<p>Tisztelt {{client}},</p><p>Az alábbi ajánlatot küldjük a(z) <b>{{route}}</b> útvonalra: <b>{{pret}}</b>.</p><p>Várjuk visszajelzését.</p>',
  },
  invoice_notify: {
    category: 'finance',
    subject_ro: 'Factură {{invoice_no}}',
    subject_hu: 'Számla {{invoice_no}}',
    body_ro: '<p>Stimate {{client}},</p><p>Vă transmitem factura <b>{{invoice_no}}</b> aferentă transportului <b>{{order_id}}</b>.</p>',
    body_hu: '<p>Tisztelt {{client}},</p><p>Mellékelten küldjük a(z) <b>{{invoice_no}}</b> számlát a(z) <b>{{order_id}}</b> fuvarhoz.</p>',
  },
  generic: {
    category: 'general',
    subject_ro: '{{subject}}',
    subject_hu: '{{subject}}',
    body_ro: '<p>{{message}}</p>',
    body_hu: '<p>{{message}}</p>',
  },
};

function _user(req) { return (req && req.session && req.session.user) || null; }
function _am(req) { const u = _user(req); return !!(u && ['Admin', 'Manager'].includes(u.pozicio)); }
function _str(x, n) { const s = x == null ? null : String(x).slice(0, n); return s == null ? null : s; }

// Lekéri a cég sablonjait; ha még nincs seedelve, az alapértelmezetteket
// adja vissza (id nélkül) — a UI azonnal szerkeszthető listát kap.
handlers.emailTemplateList = async function (req, res) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const r = await pool.query(
      `SELECT id, key, category, subject_ro, subject_hu, body_ro, body_hu, active, updated_at
         FROM company_email_templates
        WHERE company_id = $1
        ORDER BY key`,
      [cid]
    );
    const byKey = {};
    for (const row of r.rows) byKey[row.key] = row;
    // A fehérlistás kulcsok mindegyikére adunk sort: a tárolt VAGY az alapértelmezett.
    const items = Object.keys(TEMPLATE_KEYS).map((k) => {
      if (byKey[k]) return byKey[k];
      const d = TEMPLATE_KEYS[k];
      return {
        id: null, key: k, category: d.category,
        subject_ro: d.subject_ro, subject_hu: d.subject_hu,
        body_ro: d.body_ro, body_hu: d.body_hu,
        active: true, updated_at: null, isDefault: true,
      };
    });
    return res.json({ result: { ok: true, items } });
  } catch (err) {
    console.error('emailTemplateList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Sablon mentése (upsert kulcsra). args: [{ key, subject_ro, subject_hu, body_ro, body_hu, active }]
handlers.emailTemplateSave = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const a = (Array.isArray(args) ? args[0] : args) || {};
    const key = String(a.key || '').trim();
    if (!TEMPLATE_KEYS[key]) return res.json({ result: { ok: false, err: 'Cheie de șablon invalidă' } });

    const subjectRo = _str(a.subject_ro, 500);
    const subjectHu = _str(a.subject_hu, 500);
    const bodyRo = _str(a.body_ro, 20000);
    const bodyHu = _str(a.body_hu, 20000);
    const active = a.active === false ? false : true;
    const category = TEMPLATE_KEYS[key].category;

    // Upsert a (company_id, key) páron — a UNIQUE indexen át. Ownership a
    // company_id-szűréssel garantált; külön id-ellenőrzés nem kell.
    await pool.query(
      `INSERT INTO company_email_templates
         (company_id, key, category, subject_ro, subject_hu, body_ro, body_hu, active, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (company_id, key) DO UPDATE SET
         category=$3, subject_ro=$4, subject_hu=$5, body_ro=$6, body_hu=$7, active=$8, updated_at=now()`,
      [cid, key, category, subjectRo, subjectHu, bodyRo, bodyHu, active]
    );

    audit.fromReq(req, 'email_template.save', 'email_template', key, { active });
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('emailTemplateSave hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Sablonból e-mail küldése. args: [{ template_key, to_email, lang?, vars? }]
//   - A cég SAJÁT sablonját oldja fel (company_id-szűrt); ha nincs tárolva,
//     a fehérlistás alapértelmezettet használja.
//   - A {{vars}} értékek escape-eltek (applyTemplateVars) -> nincs injekció.
//   - A küldés sima Brevo-küldés a cég logójával (sendClientEmail) -> mail_log.
handlers.sendTemplatedEmail = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const u = _user(req);
    const cid = u.company_id;
    const a = (Array.isArray(args) ? args[0] : args) || {};

    const key = String(a.template_key || '').trim();
    if (!TEMPLATE_KEYS[key]) return res.json({ result: { ok: false, err: 'Cheie de șablon invalidă' } });

    // TESZT vs. VALÓS küldés:
    //  - teszt (a.test): a KÖZÖS VallorSoft címről a belépett felhasználó SAJÁT
    //    címére megy (rendszer-feladó), bárhová NEM küldhető.
    //  - valós: külső címzettnek → a CÉG SAJÁT SMTP-fiókjáról (Integrációk →
    //    Feladó-fiók). A közös cím itt NEM használható.
    const isTest = a.test === true || String(a.test) === 'true';
    const toEmail = isTest ? String(u.email || '').trim() : String(a.to_email || '').trim();
    if (!EMAIL_RE.test(toEmail)) {
      return res.json({ result: { ok: false, err: isTest ? 'Adresa dvs. de e-mail lipsește.' : 'E-mail invalid' } });
    }

    const lang = a.lang === 'hu' ? 'hu' : 'ro';
    const vars = (a.vars && typeof a.vars === 'object' && !Array.isArray(a.vars)) ? a.vars : {};

    // Cég-szintű sablon (paraméteres, company_id-szűrt) — vagy alapértelmezett.
    const r = await pool.query(
      `SELECT subject_ro, subject_hu, body_ro, body_hu, active
         FROM company_email_templates WHERE company_id=$1 AND key=$2`,
      [cid, key]
    );
    let tpl = r.rows[0];
    if (tpl && tpl.active === false) {
      return res.json({ result: { ok: false, err: 'Șablonul este dezactivat' } });
    }
    if (!tpl) tpl = TEMPLATE_KEYS[key]; // alapértelmezett, ha még nincs mentve

    const subjectTpl = (lang === 'hu' ? (tpl.subject_hu || tpl.subject_ro) : (tpl.subject_ro || tpl.subject_hu)) || '';
    const bodyTpl = (lang === 'hu' ? (tpl.body_hu || tpl.body_ro) : (tpl.body_ro || tpl.body_hu)) || '';

    // applyTemplateVars: a {{kulcs}} értékeit HTML-escape-eli (nincs markup-injekció).
    const subject = applyTemplateVars(subjectTpl, vars);
    const html = applyTemplateVars(bodyTpl, vars);

    // Cég logó az e-mail fejlécbe (best-effort, mint a kliens-levelezőnél).
    let logoUrl = null, senderName = null;
    try {
      const b = await pool.query('SELECT nev FROM companies WHERE id=$1', [cid]);
      senderName = b.rows[0] && b.rows[0].nev ? b.rows[0].nev : null;
      const appUrl = require('../lib/appUrl').appBaseUrl();
      if (appUrl) logoUrl = appUrl + '/branding/logo/' + cid + '.png';
    } catch (_) { /* best-effort */ }

    let result;
    if (isTest) {
      // Teszt → KÖZÖS VallorSoft cím (rendszer-feladó), a saját címünkre.
      result = await sendClientEmail({
        to: toEmail,
        subject: subject || '(fără subiect)',
        html: html,
        senderName: senderName || 'VallorSoft',
        logoUrl: logoUrl,
        companyId: cid,
        mailType: 'template_test',
      });
    } else {
      // Valós küldés (külső címzett) → a CÉG SAJÁT SMTP-/feladó-fiókja.
      const mailer = await getCompanyMailer(cid);
      if (!mailer || !mailer.ok) {
        return res.json({ result: { ok: false, err: (mailer && mailer.noConfig)
          ? 'Configurați contul de e-mail (SMTP) în Integrări înainte de a trimite către clienți.'
          : ((mailer && mailer.error) || 'Eroare la contul expeditor') } });
      }
      result = await mailer.send({
        to: toEmail,
        subject: subject || '(fără subiect)',
        html: html,
        mailType: 'template',
      });
    }

    audit.fromReq(req, 'email_template.send', 'email_template', key, {
      to: toEmail, test: isTest, ok: !!(result && result.ok),
    });

    if (!result || !result.ok) {
      return res.json({ result: { ok: false, err: (result && result.error) || 'Eroare la trimitere' } });
    }
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('sendTemplatedEmail hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ── Újrahasználható segéd: a cég tranzakciós sablonjai SZÖVEGESEN renderelve
//  (a {{vars}} behelyettesítve, HTML→szöveg) — pl. az „Email a fuvarról"
//  összeállító előtöltéséhez. NEM-enumerable (nem /api/execute-handler).
function _htmlToText(h) {
  return String(h || '')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}
async function renderCompanyTemplates(cid, lang, vars) {
  lang = lang === 'hu' ? 'hu' : 'ro';
  vars = vars || {};
  const stored = {};
  try {
    const r = await pool.query(
      `SELECT key, subject_ro, subject_hu, body_ro, body_hu, active
         FROM company_email_templates WHERE company_id=$1`, [cid]);
    for (const row of r.rows) stored[row.key] = row;
  } catch (_) { /* tábla hiányában csak az alapértelmezettek */ }
  const out = [];
  for (const key of Object.keys(TEMPLATE_KEYS)) {
    const s = stored[key];
    if (s && s.active === false) continue;
    const tpl = s || TEMPLATE_KEYS[key];
    const subjectTpl = (lang === 'hu' ? (tpl.subject_hu || tpl.subject_ro) : (tpl.subject_ro || tpl.subject_hu)) || '';
    const bodyTpl = (lang === 'hu' ? (tpl.body_hu || tpl.body_ro) : (tpl.body_ro || tpl.body_hu)) || '';
    out.push({
      key: key,
      subject: applyTemplateVars(subjectTpl, vars),
      body: _htmlToText(applyTemplateVars(bodyTpl, vars)),
    });
  }
  return out;
}

module.exports = handlers;
Object.defineProperty(module.exports, 'renderCompanyTemplates', { enumerable: false, value: renderCompanyTemplates });
