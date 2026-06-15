// ============================================================
//  VallorSoft — routes/portal.js  (ÜGYFÉL-PORTÁL)
//  Az ügyfél (clients) kapcsolattartója saját belépéssel CSAK a saját
//  cégének fuvarjait látja: státusz, élő követés, dokumentum-letöltés,
//  és új fuvart igényelhet (a diszpécser jóváhagyásával).
//
//  Biztonság: külön session-szerep (req.session.clientUser), minden
//  lekérdezés company_id ÉS client_id szerint szűr. Belső adat (sofőr-
//  személyes, költség, alvállalkozói díj, profit) SOHA nem kerül ki.
// ============================================================
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const router = express.Router();
const pool = require('../db');
const { getPositions } = require('../lib/vehiclePositions');

let sendResetEmail = null;
try { ({ sendResetEmail } = require('../services/email')); } catch (_) { /* e-mail opcionális */ }

let sendPushToRole = null;
try { ({ sendPushToRole } = require('../services/push')); } catch (_) { /* push opcionális */ }

// ─── Middleware: csak bejelentkezett portál-ügyfél ───────────
function requireClient(req, res, next) {
  if (!req.session || !req.session.clientUser) return res.status(401).json({ ok: false, err: 'Nu sunteti autentificat.' });
  next();
}

// Az 'client-portal' OPT-IN kapcsoló (hiányzó/false = KI) — a cégnél be kell kapcsolva legyen.
async function portalFeatureOn(companyId) {
  try {
    const r = await pool.query(
      "SELECT enabled FROM company_features WHERE company_id = $1 AND feature_key = 'client-portal'", [companyId]);
    return r.rows.length ? r.rows[0].enabled === true : false;
  } catch (_) { return false; }
}

// ─── Oldal kiszolgálása (a JS dönt: login / set-password / dashboard) ──
router.get('/portal', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'portal.html'));
});

// ─── Login (e-mail + jelszó) ─────────────────────────────────
router.post('/api/portal/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.json({ ok: false, err: 'E-mailul si parola sunt obligatorii.' });

    const r = await pool.query(
      `SELECT cu.id, cu.company_id, cu.client_id, cu.email, cu.nev, cu.pass_hash, cu.activ,
              c.denumire AS client_nev, co.nev AS ceg_nev
       FROM client_users cu
       JOIN clients c ON c.id = cu.client_id AND c.company_id = cu.company_id
       JOIN companies co ON co.id = cu.company_id
       WHERE LOWER(cu.email) = $1`, [email]);

    if (!r.rows.length || !r.rows[0].pass_hash) {
      await bcrypt.compare(password, '$2b$10$C6UzMDM.H6dfI/f/IKcEeO7ZdVdkPYqBkN1FW3sZBPq4P5l5l5l5l');
      return res.json({ ok: false, err: 'E-mail sau parola incorecta.' });
    }
    const cu = r.rows[0];
    const ok = await bcrypt.compare(password, cu.pass_hash);
    if (!ok) return res.json({ ok: false, err: 'E-mail sau parola incorecta.' });
    if (!cu.activ) return res.json({ ok: false, err: 'Accesul dumneavoastra este blocat. Contactati transportatorul.' });
    if (!(await portalFeatureOn(cu.company_id))) return res.json({ ok: false, err: 'Portalul de client nu este momentan activ. Contactati transportatorul.' });

    req.session.clientUser = {
      id: cu.id, company_id: cu.company_id, client_id: cu.client_id,
      email: cu.email, nev: cu.nev, client_nev: cu.client_nev, ceg_nev: cu.ceg_nev,
    };
    await pool.query('UPDATE client_users SET last_login = NOW() WHERE id = $1', [cu.id]).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error('portal login hiba:', err);
    return res.json({ ok: false, err: 'Eroare de server' });
  }
});

router.post('/api/portal/logout', (req, res) => {
  if (req.session) req.session.clientUser = null;
  res.json({ ok: true });
});

router.get('/api/portal/me', (req, res) => {
  const cu = req.session && req.session.clientUser;
  if (!cu) return res.json({ ok: false });
  res.json({ ok: true, nev: cu.nev, email: cu.email, client_nev: cu.client_nev, ceg_nev: cu.ceg_nev });
});

// ─── Jelszó beállítása meghívó-tokennel (első belépés) ───────
router.post('/api/portal/set-password', async (req, res) => {
  try {
    const token = String(req.body.token || '').trim();
    const password = String(req.body.password || '');
    if (!token || password.length < 6) return res.json({ ok: false, err: 'Parola trebuie sa aiba cel putin 6 caractere.' });

    const r = await pool.query(
      `SELECT id, company_id, client_id, email, nev FROM client_users
       WHERE invite_token = $1 AND (invite_expires IS NULL OR invite_expires > NOW())`, [token]);
    if (!r.rows.length) return res.json({ ok: false, err: 'Linkul de invitatie este invalid sau a expirat. Cereti unul nou de la transportator.' });

    const cu = r.rows[0];
    if (!(await portalFeatureOn(cu.company_id))) return res.json({ ok: false, err: 'Portalul de client nu este momentan activ.' });
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE client_users SET pass_hash = $1, invite_token = NULL, invite_expires = NULL, activ = TRUE WHERE id = $2`,
      [hash, cu.id]);

    // rögtön belépés
    const cR = await pool.query(
      `SELECT c.denumire AS client_nev, co.nev AS ceg_nev FROM clients c JOIN companies co ON co.id = c.company_id
       WHERE c.id = $1 AND c.company_id = $2`, [cu.client_id, cu.company_id]);
    req.session.clientUser = {
      id: cu.id, company_id: cu.company_id, client_id: cu.client_id, email: cu.email, nev: cu.nev,
      client_nev: (cR.rows[0] || {}).client_nev, ceg_nev: (cR.rows[0] || {}).ceg_nev,
    };
    return res.json({ ok: true });
  } catch (err) {
    console.error('portal set-password hiba:', err);
    return res.json({ ok: false, err: 'Eroare de server' });
  }
});

// ─── A bejelentkezett ügyfél fuvarjai (minimális, biztonságos adat) ──
router.get('/api/portal/orders', requireClient, async (req, res) => {
  try {
    const cu = req.session.clientUser;
    // company_id ÉS client_id szerint; a régi (client_id NULL) fuvarokat névre is illesztjük
    const r = await pool.query(
      `SELECT o.id, o.ref, o.loc_incarcare, o.loc_descarcare, o.data_incarcare, o.data_descarcare,
              o.status, o.rendszam_camion, o.tracking_token, o.load_type, o.suly_kg,
              o.hossz_cm, o.szel_cm, o.mag_cm, o.pret, o.payment_status, o.paid_amount,
              o.created_at,
              (o.route_geo->>'km')::int AS route_km
       FROM orders o
       WHERE o.company_id = $1
         AND ( o.client_id = $2 OR (o.client_id IS NULL AND LOWER(o.client) = LOWER($3)) )
         AND o.status <> 'Anulat'
       ORDER BY (o.status IN ('Alocat','In Curs')) DESC, o.created_at DESC
       LIMIT 200`,
      [cu.company_id, cu.client_id, cu.client_nev || '']);
    const orders = r.rows;

    // letölthető dokumentumok a fuvarokhoz (POD/CMR/visszaigazolás) — egy lekérdezés
    const ids = orders.map((o) => o.id);
    const docsByOrder = {};
    if (ids.length) {
      const dr = await pool.query(
        `SELECT id, order_id, file_name, (signed_base64 IS NOT NULL) AS signed
         FROM order_documents WHERE order_id = ANY($1::text[]) AND company_id = $2
         ORDER BY id`, [ids, cu.company_id]);
      dr.rows.forEach((d) => {
        (docsByOrder[d.order_id] = docsByOrder[d.order_id] || []).push(
          { id: d.id, name: d.file_name || 'document.pdf', signed: d.signed });
      });
    }
    orders.forEach((o) => { o.documents = docsByOrder[o.id] || []; });

    // POD-fotók (sofőr által csatolt, a 'documents' táblában) — szintén letölthető
    const podByOrder = {};
    if (ids.length) {
      const pr = await pool.query(
        `SELECT id, order_id, file_name, tip FROM documents WHERE order_id = ANY($1::text[]) ORDER BY id`, [ids]);
      pr.rows.forEach((d) => {
        (podByOrder[d.order_id] = podByOrder[d.order_id] || []).push({ id: d.id, name: d.file_name || 'fotografie', tip: d.tip });
      });
    }
    orders.forEach((o) => { o.pods = podByOrder[o.id] || []; });

    const stats = {
      active: orders.filter((o) => ['Alocat', 'In Curs', 'Disponibil', 'Parkolt', 'Raktarban'].includes(o.status)).length,
      onroad: orders.filter((o) => o.status === 'In Curs').length,
      unpaid: orders.filter((o) => o.status === 'Finalizat' && o.payment_status !== 'paid').length,
    };

    // A kliens beküldött portál-kérései (még feldolgozás alatt VAGY elutasítva) —
    // az ELFOGADOTT kérés már valódi fuvarként megjelenik fent, ezért azt itt kihagyjuk.
    // Így a kliens MINDENT lát, amit beküldött (semmi nem „tűnik el").
    const reqR = await pool.query(
      `SELECT id, status, extracted, pdf_name, received_at
       FROM inbound_orders
       WHERE company_id = $1 AND source = 'portal'
         AND LOWER(source_email) = LOWER($2)
         AND status <> 'approved'
       ORDER BY received_at DESC LIMIT 100`,
      [cu.company_id, cu.email]);
    const requests = reqR.rows.map((q) => {
      const ex = q.extracted || {};
      return {
        id: q.id, status: q.status, received_at: q.received_at,
        ref: ex.ref || '', loc_incarcare: ex.loc_incarcare || '', loc_descarcare: ex.loc_descarcare || '',
        suly_kg: ex.suly_kg || ex.greutate || null, load_type: ex.load_type || null,
        has_doc: !!q.pdf_name,
      };
    });
    return res.json({ ok: true, orders, stats, requests, client_nev: cu.client_nev });
  } catch (err) {
    console.error('portal orders hiba:', err);
    return res.json({ ok: false, err: 'Eroare de server' });
  }
});

// ─── Egy saját fuvar élő pozíciója ───────────────────────────
router.get('/api/portal/order/:id/position', requireClient, async (req, res) => {
  try {
    const cu = req.session.clientUser;
    const r = await pool.query(
      `SELECT id, status, rendszam_camion FROM orders
       WHERE id = $1 AND company_id = $2 AND ( client_id = $3 OR (client_id IS NULL AND LOWER(client) = LOWER($4)) )`,
      [String(req.params.id), cu.company_id, cu.client_id, cu.client_nev || '']);
    if (!r.rows.length) return res.json({ ok: false });
    const o = r.rows[0];
    if (!['Alocat', 'In Curs'].includes(o.status) || !o.rendszam_camion) return res.json({ ok: true, position: null });
    let position = null;
    try {
      const pos = await getPositions(cu.company_id);
      const p = (pos.positions || []).find((x) => String(x.rendszam).toUpperCase() === String(o.rendszam_camion).toUpperCase());
      if (p) position = { lat: p.lat, lng: p.lng, speed: p.speed, datetime: p.datetime };
    } catch (_) { /* GPS-hiba ne törje a portált */ }
    return res.json({ ok: true, position });
  } catch (err) {
    console.error('portal position hiba:', err);
    return res.json({ ok: false });
  }
});

// ─── Dokumentum-letöltés (csak a saját fuvar dokumentuma) ────
router.get('/api/portal/document/:docId', requireClient, async (req, res) => {
  try {
    const cu = req.session.clientUser;
    const docId = parseInt(req.params.docId, 10);
    if (!docId) return res.status(404).send('Nu a fost gasit.');
    const r = await pool.query(
      `SELECT od.file_name, od.original_base64, od.signed_base64
       FROM order_documents od
       JOIN orders o ON o.id = od.order_id AND o.company_id = od.company_id
       WHERE od.id = $1 AND od.company_id = $2
         AND ( o.client_id = $3 OR (o.client_id IS NULL AND LOWER(o.client) = LOWER($4)) )`,
      [docId, cu.company_id, cu.client_id, cu.client_nev || '']);
    if (!r.rows.length) return res.status(404).send('Nu a fost gasit.');
    const doc = r.rows[0];
    const b64 = doc.signed_base64 || doc.original_base64;
    if (!b64) return res.status(404).send('Nu exista fisier.');
    const buf = Buffer.from(b64, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.file_name || 'document.pdf')}"`);
    return res.send(buf);
  } catch (err) {
    console.error('portal document hiba:', err);
    return res.status(500).send('Eroare de server');
  }
});

// ─── POD-fotó letöltése (csak a saját fuvaré) ────────────────
router.get('/api/portal/pod/:id', requireClient, async (req, res) => {
  try {
    const cu = req.session.clientUser;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(404).send('Nu a fost gasit.');
    const r = await pool.query(
      `SELECT d.file_name, d.storage_url FROM documents d
       JOIN orders o ON o.id = d.order_id AND o.company_id = $2
       WHERE d.id = $1 AND ( o.client_id = $3 OR (o.client_id IS NULL AND LOWER(o.client) = LOWER($4)) )`,
      [id, cu.company_id, cu.client_id, cu.client_nev || '']);
    if (!r.rows.length) return res.status(404).send('Nu a fost gasit.');
    const s = String(r.rows[0].storage_url || '');
    if (/^https?:\/\//i.test(s)) return res.redirect(s);
    let mime = 'image/jpeg', b64 = s;
    const m = s.match(/^data:([^;]+);base64,(.*)$/);
    if (m) { mime = m[1]; b64 = m[2]; }
    else if (/\.png$/i.test(r.rows[0].file_name || '')) mime = 'image/png';
    else if (/\.pdf$/i.test(r.rows[0].file_name || '')) mime = 'application/pdf';
    const buf = Buffer.from(b64, 'base64');
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(r.rows[0].file_name || 'pod')}"`);
    return res.send(buf);
  } catch (err) {
    console.error('portal pod hiba:', err);
    return res.status(500).send('Eroare de server');
  }
});

// ─── Új fuvar-igény (a diszpécser „Ügyfél kérések" fülére kerül) ──
// Teljes áru-bevitel (minden mező opcionális) + opcionális dokumentum (PDF/kép),
// amit a diszpécser a „📄 Kiolvasás" gombbal AI-val feldolgozhat.
router.post('/api/portal/request', requireClient, async (req, res) => {
  try {
    const cu = req.session.clientUser;
    const b = req.body || {};
    const trim = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
    const numOrNull = (v) => (v !== '' && v != null && !isNaN(Number(v))) ? Number(v) : null;
    const intOrNull = (v) => (v !== '' && v != null && !isNaN(parseInt(v, 10))) ? parseInt(v, 10) : null;

    // Az áru-mezők az inbound kártya/approve kulcsaival egyeznek (greutate=súly, observatii=megjegyzés).
    const extracted = {
      client: cu.client_nev || '',
      ref: trim(b.ref, 100),
      loc_incarcare: trim(b.loc_incarcare, 200),
      loc_descarcare: trim(b.loc_descarcare, 200),
      data_incarcare: trim(b.data_incarcare, 10) || null,
      data_descarcare: trim(b.data_descarcare, 10) || null,
      suly_kg: numOrNull(b.suly_kg),
      greutate: numOrNull(b.suly_kg),
      load_type: ['FTL', 'LTL'].includes(b.load_type) ? b.load_type : null,
      hossz_cm: intOrNull(b.hossz_cm),
      szel_cm: intOrNull(b.szel_cm),
      mag_cm: intOrNull(b.mag_cm),
      observatii: trim(b.megjegyzes, 800),
    };

    // Opcionális dokumentum (data:URL base64 PDF vagy kép) — max ~10 MB.
    let pdfBuf = null, pdfName = null;
    if (b.doc_base64) {
      const m = String(b.doc_base64).match(/^data:([^;]+);base64,(.*)$/);
      const raw = m ? m[2] : String(b.doc_base64);
      if (raw && raw.length < 14 * 1024 * 1024) {
        try {
          const buf = Buffer.from(raw, 'base64');
          if (buf.length && buf.length <= 10 * 1024 * 1024) { pdfBuf = buf; pdfName = trim(b.doc_name, 200) || 'document.pdf'; }
        } catch (_) { /* érvénytelen base64 — dokumentum nélkül megy tovább */ }
      }
    }

    // Legalább EGY érdemi adat vagy dokumentum kell (üres spam ellen).
    const hasAny = extracted.loc_incarcare || extracted.loc_descarcare || extracted.ref ||
      extracted.suly_kg || extracted.observatii || pdfBuf;
    if (!hasAny) return res.json({ ok: false, err: 'Completati cel putin o informatie sau atasati un document.' });

    const uid = 'portal-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    await pool.query(
      `INSERT INTO inbound_orders (company_id, source, source_email, subject, received_at, message_uid,
         extracted, status, pdf_name, pdf_data)
       VALUES ($1, 'portal', $2, $3, NOW(), $4, $5, 'reviewed', $6, $7)`,
      [cu.company_id, cu.email, 'Solicitare portal client — ' + (cu.client_nev || cu.email), uid,
       JSON.stringify(extracted), pdfName, pdfBuf]);
    const loc_incarcare = extracted.loc_incarcare, loc_descarcare = extracted.loc_descarcare;

    // Push az adminoknak/managereknek (kétnyelvű RO/HU) — best-effort, ne buktassa a kérést.
    // A diszpécser azonnal értesül; a böngészőn belüli lebegő sáv is jelez (getMyFeatures polling).
    if (sendPushToRole) {
      const route = (loc_incarcare && loc_descarcare) ? (loc_incarcare + ' → ' + loc_descarcare)
                  : (loc_incarcare || loc_descarcare || (pdfBuf ? '📎 document atasat / csatolt documentum' : ''));
      const clientStr = cu.client_nev || cu.email;
      const routeStr = route ? ': ' + route : '';
      require('../lib/pushTemplates').getTemplate('push_inbound_new').then(function(tpl) {
        const { applyVars } = require('../lib/pushTemplates');
        const vars = { client: clientStr, route: routeStr };
        sendPushToRole(cu.company_id, ['Admin', 'Manager'], {
          title: (tpl.title_ro || '🔔 Cerere nouă de transport') + ' / ' + (tpl.title_hu || 'Új fuvarkérés'),
          body: applyVars(tpl.body_ro || '{{client}}{{route}}', vars),
          icon: '/icon192.png', badge: '/icon192.png',
          tag: 'inbound-portal', url: '/admin',
        }).catch(() => {});
      }).catch(() => {
        sendPushToRole(cu.company_id, ['Admin', 'Manager'], {
          title: '🔔 Cerere nouă de transport / Új fuvarkérés',
          body: clientStr + routeStr,
          icon: '/icon192.png', badge: '/icon192.png',
          tag: 'inbound-portal', url: '/admin',
        }).catch(() => {});
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('portal request hiba:', err);
    return res.json({ ok: false, err: 'Eroare de server' });
  }
});

module.exports = router;
// segéd a meghívó-e-mailhez (a clientPortal handler használja) — lang: 'ro' alap
module.exports._sendInvite = async function (toEmail, nev, link, lang) {
  if (!sendResetEmail) return false;
  // a tényleges kiküldés eredményét adjuk vissza (false, ha nincs e-mail-konfig
  // vagy a Brevo elutasította) — így a meghívó kecsesen jelez emailed:false-t
  try { return (await sendResetEmail(toEmail, nev || toEmail, link, lang === 'hu' ? 'hu' : 'ro')) === true; } catch (_) { return false; }
};
