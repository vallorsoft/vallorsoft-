// ============================================================
//  VallorSoft — handlers/orderEmail.js
//  „Email a fuvarról" — egy kiírt fuvarhoz tartozó levél összeállítása és
//  kiküldése TETSZŐLEGES címre (külső VAGY belső). A felhasználó pipálással
//  választja ki, MELY fuvar-adatok kerüljenek a szövegbe, és MELY csatolt
//  fájlok (megrendelő-dok eredeti/aláírt, sofőr-POD-fotók, számla-PDF) menjenek
//  mellékletként. Ami nincs kipipálva, az nem kerül bele / nincs csatolva.
//
//  Konvenciók: Admin/Manager; minden SQL company_id-szűrt + paraméteres;
//  a küldés a CÉG SAJÁT feladó-fiókján (getCompanyMailer, SMTP/Brevo) megy
//  (a külső levelek szabálya szerint); audit minden küldésen.
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');
const _crypto = require('crypto');
const { getCompanyMailer, sendClientEmail, wrapBrandedEmail } = require('../services/email');
const { appBaseUrl } = require('../lib/appUrl');

// A cég arculata az e-mail fejlécéhez: a feltöltött logó publikus URL-je (csak ha
// van feltöltött logó), különben null → az alapértelmezett „vallorSoft" felirat
// marad. A feladó-név a cég neve (ha van). best-effort.
async function _companyBranding(cid) {
  var out = { logoUrl: null, senderName: 'VallorSoft' };
  try {
    var c = await pool.query('SELECT nev FROM companies WHERE id=$1', [cid]);
    if (c.rows.length && c.rows[0].nev) out.senderName = c.rows[0].nev;
  } catch (_) {}
  try {
    var hl = await pool.query(
      "SELECT 1 FROM company_branding WHERE company_id=$1 AND logo_base64 IS NOT NULL", [cid]);
    var appUrl = appBaseUrl();
    if (hl.rows.length && appUrl) out.logoUrl = appUrl + '/branding/logo/' + cid + '.png';
  } catch (_) {}
  return out;
}

const handlers = {};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ATTACH = 15;                       // max csatolmány-darab
const MAX_TOTAL_B64 = 22 * 1024 * 1024;      // ~16 MB tényleges méret felső korlát

function _am(req) { const u = req.session && req.session.user; return !!(u && ['Admin', 'Manager'].includes(u.pozicio)); }
function _arg(args) { return (Array.isArray(args) ? args[0] : args) || {}; }
function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
function _rawB64(s) { if (!s) return null; var m = String(s).match(/^data:[^;]+;base64,([\s\S]*)$/); return m ? m[1] : String(s); }

// {{kulcs}} behelyettesítés escape-elt értékekkel egy vizuális sablon HTML-jébe
// (a builder {{nev}}/{{cegnev}}/{{datum}} mellett fuvar-mezők is: order_id/route/...).
function _applyBuilderVars(html, vars) {
  var v = vars || {};
  return String(html || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, function (m, key) {
    var k = String(key).toLowerCase();
    return Object.prototype.hasOwnProperty.call(v, k) ? _esc(v[k]) : m;
  });
}

// A fuvar kiválasztható adat-mezői (kulcs → RO címke + érték a sor-adatból).
function _orderFields(o) {
  var route = ((o.loc_incarcare || '') + (o.loc_descarcare ? ' → ' + o.loc_descarcare : '')).trim();
  var sofer = o.nume_sofer || o.email_sofer || o.firma_extern || '';
  var defs = [
    ['id', 'Comandă', String(o.id)],
    ['client', 'Client', o.client || ''],
    ['route', 'Rută', route],
    ['ref', 'Referință', o.ref || ''],
    ['pret', 'Preț', o.pret != null && o.pret !== '' ? String(o.pret) : ''],
    ['km', 'Km', o.km != null && o.km !== '' ? String(o.km) : ''],
    ['status', 'Status', o.status || ''],
    ['cap', 'Cap tractor', o.rendszam_camion || ''],
    ['remorca', 'Remorcă', o.rendszam_remorca || ''],
    ['sofer', 'Șofer', sofer],
    ['load_type', 'Tip marfă', o.load_type || ''],
  ];
  return defs.map(function (d) { return { key: d[0], label: d[1], value: d[2] }; })
             .filter(function (f) { return f.value !== ''; });
}

async function _loadOrder(cid, orderId) {
  var r = await pool.query(
    `SELECT o.id, o.client, o.ref, o.loc_incarcare, o.loc_descarcare, o.pret, o.km, o.status,
            o.rendszam_camion, o.rendszam_remorca, o.nume_sofer, o.email_sofer, o.firma_extern, o.load_type,
            cl.email AS client_email
     FROM orders o
     LEFT JOIN clients cl ON cl.id = o.client_id AND cl.company_id = o.company_id
     WHERE o.id = $1 AND o.company_id = $2`,
    [orderId, cid]
  );
  return r.rows[0] || null;
}

// A fuvar elérhető csatolmányainak FELSOROLÁSA (metaadat, base64 NÉLKÜL).
async function _listAttachments(cid, orderId) {
  var out = [];
  // 1) Megrendelő-dokumentumok (eredeti + aláírt)
  try {
    var od = await pool.query(
      `SELECT od.id, od.file_name,
              (od.original_base64 IS NOT NULL) AS has_orig,
              (od.signed_base64   IS NOT NULL) AS has_signed
       FROM order_documents od JOIN orders o ON o.id = od.order_id
       WHERE od.order_id = $1 AND o.company_id = $2
       ORDER BY od.created_at DESC`, [orderId, cid]);
    od.rows.forEach(function (d) {
      if (d.has_orig)   out.push({ key: 'od-' + d.id + '-original', label: (d.file_name || ('doc ' + d.id)) + ' — original', kind: 'doc' });
      if (d.has_signed) out.push({ key: 'od-' + d.id + '-signed',   label: (d.file_name || ('doc ' + d.id)) + ' — semnat/ștampilat', kind: 'doc' });
    });
  } catch (_) { /* tábla hiányában kihagyjuk */ }
  // 2) Sofőr-fotók (POD) a fuvarhoz
  try {
    var pod = await pool.query(
      `SELECT d.id, d.file_name, d.tip
       FROM documents d JOIN users u ON u.email = d.email_sofer
       WHERE d.order_id = $1 AND u.company_id = $2
       ORDER BY d.created_at DESC`, [String(orderId), cid]);
    pod.rows.forEach(function (d) {
      out.push({ key: 'pod-' + d.id, label: (d.tip ? d.tip + ' — ' : '📷 ') + (d.file_name || ('foto ' + d.id)), kind: 'photo' });
    });
  } catch (_) { /* documents.order_id migráció előtt kihagyjuk */ }
  // 3) Számla-PDF (ha van kiállított számla pdf-linkkel)
  try {
    var inv = await pool.query(
      `SELECT id, serie, numar, pdf_link FROM invoices
       WHERE order_id = $1 AND company_id = $2 AND pdf_link IS NOT NULL AND pdf_link <> ''
       ORDER BY created_at DESC`, [String(orderId), cid]);
    inv.rows.forEach(function (i) {
      out.push({ key: 'inv-' + i.id, label: '🧾 Factură ' + ((i.serie || '') + ' ' + (i.numar || '')).trim(), kind: 'invoice' });
    });
  } catch (_) { /* kihagyjuk */ }
  return out;
}

// Ügyfél követő-link (publikus /t/<token>) — feature-gate + token (opc. generálás).
async function _trackingInfo(cid, orderId, generate) {
  try {
    var fr = await pool.query(
      "SELECT enabled FROM company_features WHERE company_id=$1 AND feature_key='tracking'", [cid]);
    if (fr.rows.length && fr.rows[0].enabled === false) return { available: false, url: null };
  } catch (_) { /* alapból elérhető */ }
  var token = null;
  try {
    var r = await pool.query('SELECT tracking_token FROM orders WHERE id=$1 AND company_id=$2', [orderId, cid]);
    if (!r.rows.length) return { available: false, url: null };
    token = r.rows[0].tracking_token;
    if (!token && generate) {
      token = _crypto.randomBytes(16).toString('hex');
      await pool.query('UPDATE orders SET tracking_token=$1 WHERE id=$2 AND company_id=$3', [token, orderId, cid]);
    }
  } catch (_) { return { available: false, url: null }; }
  var base = appBaseUrl();
  return { available: true, url: (token && base) ? base + '/t/' + token : null };
}

// Külső URL letöltése base64-ként (számla-PDF / külső tárolású fotó), best-effort.
async function _fetchBase64(url) {
  try {
    if (typeof fetch !== 'function') return null;
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, 15000);
    var resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(to);
    if (!resp.ok) return null;
    var buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > 12 * 1024 * 1024) return null;
    return buf.toString('base64');
  } catch (_) { return null; }
}

// ── A dialógus adatai: fuvar-mezők + ügyfél e-mail + elérhető csatolmányok ──
handlers.getOrderEmailData = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    var cid = req.session.user.company_id;
    var orderId = String(_arg(args).order_id || (Array.isArray(args) ? args[0] : '') || '').trim();
    if (!orderId) return res.json({ result: { ok: false, err: 'Identificator lipsă' } });
    var o = await _loadOrder(cid, orderId);
    if (!o) return res.json({ result: { ok: false, err: 'Comanda nu a fost găsită.' } });
    var fields = _orderFields(o);
    var attachments = await _listAttachments(cid, orderId);
    var trk = await _trackingInfo(cid, orderId, false);
    // Mentett sablonok szövegesen, a fuvar adataival előtöltve (előtöltéshez).
    var lang = (_arg(args).lang === 'hu') ? 'hu' : 'ro';
    var templates = [];
    try {
      var et = require('./emailTemplates');
      if (et && typeof et.renderCompanyTemplates === 'function') {
        var route = ((o.loc_incarcare || '') + (o.loc_descarcare ? ' → ' + o.loc_descarcare : '')).trim();
        templates = await et.renderCompanyTemplates(cid, lang, {
          order_id: String(o.id), route: route, client: o.client || '',
          status: o.status || '', pret: o.pret != null ? String(o.pret) : '', invoice_no: '',
        });
      }
    } catch (_) { templates = []; }
    // Vizuális sablonok (e-mail szerkesztő / galériából mentett) — csak metaadat
    // (id/név/tárgy), a HTML-t küldéskor oldjuk fel a sablon-id alapján.
    var builderTemplates = [];
    try {
      var bt = await pool.query(
        `SELECT id, name, subject FROM email_builder_templates
          WHERE company_id=$1 ORDER BY updated_at DESC, id DESC`, [cid]);
      builderTemplates = bt.rows;
    } catch (_) { builderTemplates = []; }
    return res.json({ result: { ok: true, order_id: orderId, client_email: o.client_email || '',
      fields: fields, attachments: attachments,
      tracking_available: trk.available, tracking_url: trk.url,
      templates: templates, builder_templates: builderTemplates } });
  } catch (err) {
    console.error('getOrderEmailData hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ── Küldés: a kipipált mezőkkel + csatolmányokkal, a cég saját feladó-fiókján ──
// args: [{ order_id, to_email, subject, body, fields:[keys], attachments:[keys] }]
handlers.sendOrderEmail = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    var cid = req.session.user.company_id;
    var a = _arg(args);
    var orderId = String(a.order_id || '').trim();
    if (!orderId) return res.json({ result: { ok: false, err: 'Identificator lipsă' } });

    // TESZT: a KÖZÖS VallorSoft címről a belépett felhasználó SAJÁT címére megy
    // (a megadott címet figyelmen kívül hagyja). VALÓS: a megadott külső/belső cím.
    var isTest = a.test === true || String(a.test) === 'true';
    var toEmail = isTest ? String(req.session.user.email || '').trim() : String(a.to_email || '').trim();
    if (!EMAIL_RE.test(toEmail)) {
      return res.json({ result: { ok: false, err: isTest ? 'Adresa dvs. de e-mail lipsește.' : 'E-mail invalid' } });
    }

    var o = await _loadOrder(cid, orderId);
    if (!o) return res.json({ result: { ok: false, err: 'Comanda nu a fost găsită.' } });

    var subject = String(a.subject || '').slice(0, 300).trim() || ('Comandă ' + orderId);
    var bodyText = String(a.body || '').slice(0, 8000);
    var selFields = Array.isArray(a.fields) ? a.fields : [];
    var selAtt = Array.isArray(a.attachments) ? a.attachments.slice(0, MAX_ATTACH) : [];

    // Vizuális sablon (e-mail szerkesztő / galériából mentett) — ha választott,
    // a sablon teljes HTML-je lesz a levél törzse (a {{változók}} a fuvar adataival
    // behelyettesítve, escape-elve → nincs injekció). company_id-szűrt feloldás.
    var builderHtml = '';
    var builderId = parseInt(a.builder_template_id, 10);
    if (builderId) {
      try {
        var btr = await pool.query(
          `SELECT html_content FROM email_builder_templates WHERE id=$1 AND company_id=$2`,
          [builderId, cid]);
        if (btr.rows.length && String(btr.rows[0].html_content || '').trim()) {
          var route0 = ((o.loc_incarcare || '') + (o.loc_descarcare ? ' → ' + o.loc_descarcare : '')).trim();
          var cegnev = '';
          try { var cn = await pool.query('SELECT nev FROM companies WHERE id=$1', [cid]); cegnev = (cn.rows[0] && cn.rows[0].nev) || ''; } catch (_) {}
          builderHtml = _applyBuilderVars(btr.rows[0].html_content, {
            nev: o.client || '', cegnev: cegnev, datum: new Date().toISOString().slice(0, 10),
            order_id: String(o.id), route: route0, client: o.client || '',
            status: o.status || '', pret: o.pret != null ? String(o.pret) : '',
            km: o.km != null ? String(o.km) : '',
          });
        }
      } catch (_) { builderHtml = ''; }
    }

    // Body: (1) vizuális sablon HTML-je VAGY (2) szabad szöveg + (ha vannak
    // kipipált mezők) a fuvar-adat tábla. Ha mindkettő van: a beírt szöveg a
    // sablon FÖLÉ kerül bevezetőként.
    var fieldRows = _orderFields(o).filter(function (f) { return selFields.indexOf(f.key) >= 0; });
    var textHtml = bodyText
      ? '<div style="font-size:14px;line-height:1.6;color:#2a2018;white-space:pre-wrap;">' + _esc(bodyText) + '</div>'
      : '';
    var bodyHtml = builderHtml ? (textHtml + builderHtml) : textHtml;
    if (fieldRows.length) {
      bodyHtml += '<table style="border-collapse:collapse;margin-top:14px;font-size:13px;">' +
        fieldRows.map(function (f) {
          return '<tr><td style="padding:4px 14px 4px 0;color:#8a7d6e;">' + _esc(f.label) + '</td>' +
                 '<td style="padding:4px 0;font-weight:600;color:#2a2018;">' + _esc(f.value) + '</td></tr>';
        }).join('') + '</table>';
    }
    // Követő-link (ha kipipálva): a publikus /t/<token> az ügyfélnek.
    if (a.include_tracking === true || String(a.include_tracking) === 'true') {
      var trk = await _trackingInfo(cid, orderId, true);
      if (trk.url) {
        bodyHtml += '<p style="margin-top:14px;font-size:14px;">🌍 ' +
          'Urmăriți transportul / Kövesse a fuvart: <a href="' + _esc(trk.url) + '">' + _esc(trk.url) + '</a></p>';
      }
    }
    if (!bodyHtml) bodyHtml = '<p>Comandă ' + _esc(orderId) + '</p>';

    // Csatolmányok feloldása a kipipált kulcsokból (mind company_id-szűrt).
    var attachments = [];
    var totalB64 = 0;
    var skipped = 0;
    for (var k = 0; k < selAtt.length; k++) {
      var key = String(selAtt[k] || '');
      var b64 = null, name = null;
      var mOd = key.match(/^od-(\d+)-(original|signed)$/);
      var mPod = key.match(/^pod-(\d+)$/);
      var mInv = key.match(/^inv-(\d+)$/);
      try {
        if (mOd) {
          var col = mOd[2] === 'signed' ? 'signed_base64' : 'original_base64';
          var rr = await pool.query(
            `SELECT od.file_name, od.${col} AS b64 FROM order_documents od
             JOIN orders o2 ON o2.id = od.order_id
             WHERE od.id = $1 AND o2.id = $2 AND o2.company_id = $3`,
            [parseInt(mOd[1], 10), orderId, cid]);
          if (rr.rows.length && rr.rows[0].b64) {
            b64 = _rawB64(rr.rows[0].b64);
            name = rr.rows[0].file_name || ('document-' + mOd[1]);
            if (mOd[2] === 'signed' && !/\.pdf$/i.test(name)) name += '.pdf';
          }
        } else if (mPod) {
          var rp = await pool.query(
            `SELECT d.file_name, d.storage_url FROM documents d
             JOIN users u ON u.email = d.email_sofer
             WHERE d.id = $1 AND d.order_id = $2 AND u.company_id = $3`,
            [parseInt(mPod[1], 10), String(orderId), cid]);
          if (rp.rows.length && rp.rows[0].storage_url) {
            var su = String(rp.rows[0].storage_url);
            b64 = /^https?:\/\//i.test(su) ? await _fetchBase64(su) : _rawB64(su);
            name = rp.rows[0].file_name || ('foto-' + mPod[1] + '.jpg');
          }
        } else if (mInv) {
          var ri = await pool.query(
            `SELECT serie, numar, pdf_link FROM invoices
             WHERE id = $1 AND order_id = $2 AND company_id = $3`,
            [parseInt(mInv[1], 10), String(orderId), cid]);
          if (ri.rows.length && ri.rows[0].pdf_link) {
            b64 = await _fetchBase64(ri.rows[0].pdf_link);
            name = ('factura-' + ((ri.rows[0].serie || '') + (ri.rows[0].numar || '')).replace(/\s+/g, '') + '.pdf');
          }
        }
      } catch (_) { b64 = null; }
      if (!b64 || !name) { skipped++; continue; }
      totalB64 += b64.length;
      if (totalB64 > MAX_TOTAL_B64) { skipped++; continue; }
      attachments.push({ name: name, contentBase64: b64 });
    }

    // Cég-arculatos fejléc: a feltöltött céges logó (ha van), különben „vallorSoft".
    // Vizuális sablonnál NEM csomagoljuk be újra (a sablon a saját arculatát hozza).
    var brand = await _companyBranding(cid);
    var realHtml = builderHtml ? bodyHtml : wrapBrandedEmail(bodyHtml, brand);

    var sent;
    if (isTest) {
      // Teszt → KÖZÖS VallorSoft cím (rendszer-feladó), a saját címünkre.
      // A sendClientEmail maga rakja rá a fejlécet (logó vagy „vallorSoft").
      sent = await sendClientEmail({
        to: toEmail, subject: subject, html: bodyHtml, attachments: attachments,
        logoUrl: brand.logoUrl, senderName: brand.senderName,
        companyId: cid, mailType: 'order_test',
      });
    } else {
      // Valós küldés → a CÉG SAJÁT feladó-fiókján (SMTP/Brevo). Nincs beállítva → RO hiba.
      var mailer = await getCompanyMailer(cid);
      if (!mailer || !mailer.ok) {
        return res.json({ result: { ok: false, err: (mailer && mailer.noConfig)
          ? 'Configurați contul de e-mail (SMTP) în Integrări înainte de a trimite.'
          : ((mailer && mailer.error) || 'Eroare la contul expeditor') } });
      }
      sent = await mailer.send({ to: toEmail, subject: subject, html: realHtml, attachments: attachments, mailType: 'order' });
    }

    audit.fromReq(req, 'order.email_send', 'order', orderId, {
      to: toEmail, test: isTest, fields: fieldRows.length, attachments: attachments.length, skipped: skipped, ok: !!(sent && sent.ok),
    });

    if (!sent || !sent.ok) return res.json({ result: { ok: false, err: (sent && sent.error) || 'Eroare la trimitere' } });
    return res.json({ result: { ok: true, attachments: attachments.length, skipped: skipped } });
  } catch (err) {
    console.error('sendOrderEmail hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
