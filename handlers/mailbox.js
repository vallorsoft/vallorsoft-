// ============================================================
//  VallorSoft — handlers/mailbox.js
//  📬 Postafiókok (több fiók, fiókonként szerep) + 📥 Levelek (csak fejléc
//  lista → kattintásra megnyitás → ↩️ válasz a cég saját fiókjáról).
//
//  ADATVÉDELEM:
//   • a lista CSAK feladót/tárgyat/dátumot tárol és mutat;
//   • a levél törzse/csatolmánya csak megnyitáskor jön élőben, NEM tárolódik;
//   • az AI semmit nem kap a levélből (a chat csak a felhasználó szövegéből dolgozik);
//   • válasz CSAK a megnyitott levél feladójának, a címzettet a szerver állítja.
//  Jog: lista/megnyitás/válasz Admin|Manager; fiók-beállítás csak Admin.
// ============================================================
'use strict';

const pool = require('../db');
const { encrypt } = require('../lib/crypto');
const audit = require('../lib/audit');
const intake = require('../services/email-intake');
const mailbox = require('../services/mailbox');
const emailSvc = require('../services/email');
const { featureEnabled } = require('../lib/featureEnabled');
const { appBaseUrl } = require('../lib/appUrl');
const { createSlidingWindowLimiter } = require('../lib/slidingWindow');

const handlers = {};
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const sendLimiter = createSlidingWindowLimiter({ windowMs: 60 * 60 * 1000, max: 40 });

function _u(req) { return req.session && req.session.user; }
function _am(req) { const u = _u(req); return !!(u && (['Admin', 'Manager'].includes(u.pozicio) || u.is_dev)); }
function _admin(req) { const u = _u(req); return !!(u && (u.pozicio === 'Admin' || u.is_dev)); }
function _arg(args) { return (Array.isArray(args) ? args[0] : args) || {}; }
function _str(v, n) { const s = v == null ? '' : String(v).trim(); return s ? s.slice(0, n) : null; }
function _ok(res, o) { return res.json({ result: Object.assign({ ok: true }, o || {}) }); }
function _err(res, m) { return res.json({ result: { ok: false, err: m } }); }
function _mask(email) { const s = String(email || ''); const at = s.indexOf('@'); return at <= 0 ? s : s[0] + '***' + s.slice(at); }
async function _gate(req) {
  if (!_am(req)) return 'Acces interzis';
  try { if (!(await featureEnabled(_u(req).company_id, 'mail-inbox'))) return 'Funcție indisponibilă în abonamentul curent.'; } catch (_) {}
  return null;
}

function _buildCreds(a, prev) {
  const provider = ['gmail', 'outlook', 'custom'].includes(a.provider) ? a.provider : null;
  if (!provider) throw new Error('Furnizor necunoscut.');
  const email = String(a.email || (prev && prev.email) || '').trim();
  if (!EMAIL_RE.test(email)) throw new Error('Adresa de e-mail invalida.');
  let password = String(a.password || '');
  if (!password && prev && prev.email === email) password = prev.app_password || prev.password || '';
  if (password.length < 6) throw new Error('Parola trebuie sa aiba cel putin 6 caractere.');
  if (provider === 'gmail') return { provider, email, app_password: password };
  if (provider === 'outlook') return { provider, email, password };
  const host = String(a.host || (prev && prev.host) || '').trim();
  const port = parseInt(a.port || (prev && prev.port), 10);
  if (!host) throw new Error('Pentru IMAP personalizat, serverul este obligatoriu.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port invalid.');
  return { provider, host, port, tls: !(a.tls === false || String(a.tls) === 'false'), email, password };
}
function _folders(v) {
  return String(v || 'INBOX').split(',').map((f) => f.trim().replace(/[\r\n"]/g, '').slice(0, 100)).filter(Boolean).slice(0, 10).join(',') || 'INBOX';
}
function _accView(r) {
  return { id: r.id, label: r.label, email: r.email_masked, provider: r.provider, folders: r.folders,
    use_orders: r.use_orders, use_inbox: r.use_inbox, allow_mode: r.allow_mode, allow_list: r.allow_list || '',
    since: r.since, enabled: r.enabled, last_check: r.last_check, last_error: r.last_error };
}

// ─── 📬 Fiókok ───
handlers.mailAccountList = async function (req, res) {
  try {
    if (!_am(req)) return _err(res, 'Acces interzis');
    const { rows } = await pool.query('SELECT * FROM mail_accounts WHERE company_id=$1 ORDER BY id', [_u(req).company_id]);
    return _ok(res, { accounts: rows.map(_accView), can_edit: _admin(req) });
  } catch (e) { console.error('mailAccountList hiba:', e.message); return _err(res, 'Eroare de server'); }
};

handlers.mailAccountSave = async function (req, res, args) {
  try {
    if (!_admin(req)) return _err(res, 'Doar Adminul poate modifica.');
    const cid = _u(req).company_id;
    const a = _arg(args);
    const id = parseInt(a.id, 10) || null;
    let prevRow = null;
    if (id) {
      const p = await pool.query('SELECT * FROM mail_accounts WHERE id=$1 AND company_id=$2', [id, cid]);
      if (!p.rows.length) return _err(res, 'Contul nu a fost găsit.');
      prevRow = p.rows[0];
    }
    let creds;
    try { creds = _buildCreds(a, prevRow ? mailbox.accCreds(prevRow) : null); } catch (e) { return _err(res, e.message); }
    const vals = [
      _str(a.label, 120) || creds.email, _mask(creds.email), creds.provider, encrypt(JSON.stringify(creds)), _folders(a.folders),
      a.use_orders === true, a.use_inbox !== false,
      ['known', 'list', 'all'].includes(a.allow_mode) ? a.allow_mode : 'known',
      String(a.allow_list || '').slice(0, 4000), a.enabled !== false,
    ];
    let newId = id;
    if (id) {
      await pool.query(
        `UPDATE mail_accounts SET label=$1, email_masked=$2, provider=$3, creds_enc=$4, folders=$5, use_orders=$6, use_inbox=$7,
           allow_mode=$8, allow_list=$9, enabled=$10, updated_at=now() WHERE id=$11 AND company_id=$12`, vals.concat([id, cid]));
    } else {
      const r = await pool.query(
        `INSERT INTO mail_accounts (label, email_masked, provider, creds_enc, folders, use_orders, use_inbox, allow_mode, allow_list, enabled, company_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, vals.concat([cid]));
      newId = r.rows[0].id;
    }
    try { await audit.fromReq(req, id ? 'mail.account_update' : 'mail.account_create', 'mail_account', newId, { use_orders: vals[5], use_inbox: vals[6], allow_mode: vals[7] }); } catch (_) {}
    return _ok(res, { id: newId });
  } catch (e) { console.error('mailAccountSave hiba:', e.message); return _err(res, 'Eroare de server'); }
};

handlers.mailAccountTest = async function (req, res, args) {
  try {
    if (!_admin(req)) return _err(res, 'Doar Adminul poate testa.');
    const a = _arg(args);
    let creds;
    if (a.password) { try { creds = _buildCreds(a); } catch (e) { return _err(res, e.message); } }
    else {
      const p = await pool.query('SELECT * FROM mail_accounts WHERE id=$1 AND company_id=$2', [parseInt(a.id, 10) || 0, _u(req).company_id]);
      if (!p.rows.length) return _err(res, 'Introdu parola și testează.');
      creds = mailbox.accCreds(p.rows[0]);
    }
    try {
      const r = await intake.testConnection(Object.assign({ mailbox: 'INBOX' }, creds));
      return _ok(res, { message: 'Conexiune reușită! ' + (r.count || 0) + ' e-mailuri în INBOX.' });
    } catch (e) { return _err(res, 'Eroare de conectare: ' + String(e.message || 'necunoscut').slice(0, 200)); }
  } catch (e) { console.error('mailAccountTest hiba:', e.message); return _err(res, 'Eroare de server'); }
};

handlers.mailAccountDelete = async function (req, res, args) {
  try {
    if (!_admin(req)) return _err(res, 'Doar Adminul poate șterge.');
    const id = parseInt(_arg(args).id, 10) || 0;
    const r = await pool.query('DELETE FROM mail_accounts WHERE id=$1 AND company_id=$2', [id, _u(req).company_id]);
    if (!r.rowCount) return _err(res, 'Contul nu a fost găsit.');
    try { await audit.fromReq(req, 'mail.account_delete', 'mail_account', id, {}); } catch (_) {}
    return _ok(res);
  } catch (e) { console.error('mailAccountDelete hiba:', e.message); return _err(res, 'Eroare de server'); }
};

// ─── Kézi frissítés (csak fejlécek) ───
handlers.mailSyncNow = async function (req, res) {
  try {
    if (!_am(req)) return _err(res, 'Acces interzis');
    const { rows } = await pool.query('SELECT * FROM mail_accounts WHERE company_id=$1 AND enabled=true', [_u(req).company_id]);
    let added = 0; const errors = [];
    for (const acc of rows) {
      try {
        const r = await mailbox.syncHeaders(pool, acc);
        added += (r && r.added) || 0;
        await pool.query('UPDATE mail_accounts SET last_check=now(), last_error=NULL WHERE id=$1', [acc.id]);
      } catch (e) {
        const m = String(e.message || '').slice(0, 300);
        errors.push((acc.label || acc.email_masked) + ': ' + m);
        await pool.query('UPDATE mail_accounts SET last_error=$2 WHERE id=$1', [acc.id, m]).catch(() => {});
      }
    }
    return _ok(res, { added, errors, accounts: rows.length });
  } catch (e) { console.error('mailSyncNow hiba:', e.message); return _err(res, 'Eroare de server'); }
};

// ─── 📥 Lista: CSAK fejléc ───
// args: { kind:'inbox'|'orders', q, limit, offset }
handlers.mailInboxList = async function (req, res, args) {
  try {
    const kind = _arg(args).kind === 'orders' ? 'orders' : 'inbox';
    if (kind === 'orders') { if (!_am(req)) return _err(res, 'Acces interzis'); }
    else { const g = await _gate(req); if (g) return _err(res, g); }
    const a = _arg(args);
    const cid = _u(req).company_id;
    const params = [cid];
    let sql = `SELECT h.id, h.from_email, h.from_name, h.subject, h.received_at, h.order_id, h.opened_at, h.replied_at, h.inbound_id,
                      COALESCE(to_jsonb(o)->>'fuvar_no', o.id) AS fuvar_no, m.label AS account,
                      (SELECT COUNT(*)::int FROM mail_sent s WHERE s.company_id=h.company_id AND s.status='sent' AND h.message_id IS NOT NULL AND s.in_reply_to=h.message_id) AS out_n
                 FROM mail_headers h
                 JOIN mail_accounts m ON m.id = h.account_id AND m.company_id = h.company_id
                 LEFT JOIN orders o ON o.id = h.order_id AND o.company_id = h.company_id
                WHERE h.company_id=$1 AND h.dismissed=false AND ` + (kind === 'orders' ? 'm.use_orders=true AND h.inbound_id IS NULL' : 'm.use_inbox=true');
    const q = _str(a.q, 100);
    if (q) { params.push('%' + q.replace(/[%_\\]/g, '') + '%'); sql += ` AND (h.from_email ILIKE $${params.length} OR h.from_name ILIKE $${params.length} OR h.subject ILIKE $${params.length})`; }
    sql += ` ORDER BY h.received_at DESC NULLS LAST LIMIT ${Math.min(parseInt(a.limit, 10) || 100, 300)} OFFSET ${Math.max(parseInt(a.offset, 10) || 0, 0)}`;
    const { rows } = await pool.query(sql, params);
    return _ok(res, { items: rows });
  } catch (e) { console.error('mailInboxList hiba:', e.message); return _ok(res, { items: [], migration: true }); }
};

async function _loadHeader(cid, id) {
  const r = await pool.query(
    `SELECT h.*, row_to_json(m.*) AS acc FROM mail_headers h JOIN mail_accounts m ON m.id=h.account_id AND m.company_id=h.company_id
      WHERE h.id=$1 AND h.company_id=$2`, [parseInt(id, 10) || 0, cid]);
  return r.rows[0] || null;
}

// ─── Megnyitás (= a felhasználó engedélye) — a tartalom nem kerül DB-be ───
handlers.mailOpen = async function (req, res, args) {
  try {
    const g = await _gate(req); if (g) return _err(res, g);
    const u = _u(req);
    const h = await _loadHeader(u.company_id, _arg(args).id);
    if (!h || !h.acc.use_inbox) return _err(res, 'E-mailul nu a fost găsit.');
    let m;
    try { m = await mailbox.readMessage(h.acc, h.folder, h.uid); }
    catch (e) { return _err(res, String(e.message || 'Eroare IMAP').slice(0, 200)); }
    await pool.query('UPDATE mail_headers SET opened_at=COALESCE(opened_at, now()), opened_by=COALESCE(opened_by, $2) WHERE id=$1', [h.id, u.email]);
    try { await audit.fromReq(req, 'mail.open', 'mail', h.id, {}); } catch (_) {}
    let order = null;
    if (h.order_id) {
      try {
        const o = await pool.query(`SELECT id, COALESCE(to_jsonb(orders)->>'fuvar_no', id) AS fuvar_no, loc_incarcare, loc_descarcare, status
                                      FROM orders WHERE id=$1 AND company_id=$2`, [h.order_id, u.company_id]);
        order = o.rows[0] || null;
      } catch (_) {}
    }
    return _ok(res, { mail: { id: h.id, from_email: h.from_email, from_name: h.from_name, subject: h.subject, received_at: h.received_at,
      text: m.text, attachments: m.attachments.map((x) => ({ idx: x.idx, name: x.name, type: x.type, size: x.size })), order, replied_at: h.replied_at } });
  } catch (e) { console.error('mailOpen hiba:', e.message); return _err(res, 'Eroare de server'); }
};

handlers.mailAttachment = async function (req, res, args) {
  try {
    const g = await _gate(req); if (g) return _err(res, g);
    const a = _arg(args);
    const h = await _loadHeader(_u(req).company_id, a.id);
    if (!h || !h.acc.use_inbox) return _err(res, 'E-mailul nu a fost găsit.');
    const m = await mailbox.readMessage(h.acc, h.folder, h.uid);
    const att = m.attachments[parseInt(a.idx, 10)];
    if (!att || !att.content) return _err(res, 'Atașamentul nu a fost găsit.');
    if (att.content.length > 15 * 1024 * 1024) return _err(res, 'Atașament prea mare.');
    return _ok(res, { name: att.name, type: att.type || 'application/octet-stream', base64: att.content.toString('base64') });
  } catch (e) { console.error('mailAttachment hiba:', e.message); return _err(res, 'Eroare de server'); }
};

handlers.mailDismiss = async function (req, res, args) {
  try {
    if (!_am(req)) return _err(res, 'Acces interzis');
    await pool.query('UPDATE mail_headers SET dismissed=true WHERE id=$1 AND company_id=$2', [parseInt(_arg(args).id, 10) || 0, _u(req).company_id]);
    return _ok(res);
  } catch (e) { return _err(res, 'Eroare de server'); }
};

// ─── 📄 Megrendelés: a felhasználó kattintására kerül a levél a kiolvasóhoz ───
handlers.mailToOrder = async function (req, res, args) {
  try {
    if (!_am(req)) return _err(res, 'Acces interzis');
    const cid = _u(req).company_id;
    const h = await _loadHeader(cid, _arg(args).id);
    if (!h || !h.acc.use_orders) return _err(res, 'E-mailul nu a fost găsit.');
    if (h.inbound_id) return _ok(res, { inbound_id: h.inbound_id });
    let inboundId;
    try {
      const src = await mailbox.fetchSource(h.acc, h.folder, h.uid);
      inboundId = await intake.processSource(pool, cid, src, 'acc' + h.account_id + ':' + h.folder + ':' + h.uid);
    } catch (e) { return _err(res, String(e.message || 'Eroare').slice(0, 200)); }
    await pool.query('UPDATE mail_headers SET inbound_id=$2, opened_at=COALESCE(opened_at, now()), opened_by=COALESCE(opened_by, $3) WHERE id=$1', [h.id, inboundId, _u(req).email]);
    try { await audit.fromReq(req, 'mail.to_order', 'mail', h.id, { inbound_id: inboundId }); } catch (_) {}
    return _ok(res, { inbound_id: inboundId });
  } catch (e) { console.error('mailToOrder hiba:', e.message); return _err(res, 'Eroare de server'); }
};

// ─── ↩️ Válasz: címzett = a levél feladója (szerver), levélszál-fejlécekkel ───
// args: { id, body, quote, style, attachments[], include_tracking, builder_template_id, test }
async function sendReply(req, a) {
  const u = _u(req);
  const cid = u.company_id;
  const h = await _loadHeader(cid, a.id);
  if (!h || !h.acc.use_inbox) return { ok: false, err: 'E-mailul nu a fost găsit.' };
  if (!h.from_email || !EMAIL_RE.test(h.from_email)) return { ok: false, err: 'Expeditorul nu are adresă validă.' };
  const isTest = a.test === true;
  if (!isTest) {
    const lim = sendLimiter.check(String(u.id || u.email));
    if (!lim.ok) return { ok: false, err: 'Prea multe e-mailuri trimise. Încearcă mai târziu.' };
  }
  const bodyText = String(a.body || '').slice(0, 8000);
  if (!bodyText.trim() && !a.builder_template_id) return { ok: false, err: 'Mesaj gol.' };
  const subj0 = String(h.subject || '').trim();
  const subject = (/^(re|aw|răsp)\s*:/i.test(subj0) ? subj0 : 'Re: ' + subj0).slice(0, 300) || 'Re:';
  let quote = '';
  if (a.quote !== false) {
    try {
      const m = await mailbox.readMessage(h.acc, h.folder, h.uid);
      const when = h.received_at ? new Date(h.received_at).toLocaleString('ro-RO') : '';
      quote = '\n\n' + when + ', ' + (h.from_name || h.from_email) + ':\n' +
        String(m.text || '').slice(0, 6000).split('\n').map((l) => '> ' + l).join('\n');
    } catch (_) { /* idézet nélkül is megy */ }
  }
  const body = bodyText + quote;
  const refs = [h.refs, h.message_id].filter(Boolean).join(' ');
  let r;
  if (h.order_id) {
    // Fuvarhoz kötött válasz: a meglévő fuvar-levél motor (sablon, csatolmány, követő-link).
    r = await new Promise((resolve) => {
      const stub = { json: (o) => resolve((o && o.result) || {}) };
      Promise.resolve(require('./orderEmail').sendOrderEmail(req, stub, [{
        order_id: h.order_id, to_email: h.from_email, subject, body,
        attachments: Array.isArray(a.attachments) ? a.attachments : [], include_tracking: a.include_tracking === true,
        builder_template_id: a.builder_template_id, style: a.style, test: isTest,
        in_reply_to: h.message_id, references: refs, mail_type: 'reply',
        body_markup: a.markup === true, cards: a.cards, card_fields: a.card_fields, record_draft: a.record_draft,
      }])).catch(() => resolve({ ok: false, err: 'Eroare de server' }));
    });
  } else {
    let senderName = 'VallorSoft', logoUrl = null;
    try {
      const c = await pool.query('SELECT nev FROM companies WHERE id=$1', [cid]);
      if (c.rows[0] && c.rows[0].nev) senderName = c.rows[0].nev;
      const hl = await pool.query('SELECT 1 FROM company_branding WHERE company_id=$1 AND logo_base64 IS NOT NULL', [cid]);
      if (hl.rows.length && appBaseUrl()) logoUrl = appBaseUrl() + '/branding/logo/' + cid + '.png';
    } catch (_) {}
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const style = require('../lib/mailStyle').sanitizeStyle(a.style);
    let html;
    if (a.markup === true) {
      // AI-chat: formázott szöveg + fuvarkártyák; az idézett levél sima, escape-elt szöveg marad.
      const mData = require('../lib/mailData');
      const accent = (style && style.accent) || '#2563eb';
      const cardsHtml = await mData.renderCards(cid, mData.sanitizeCards(a.cards), { fields: mData.sanitizeFields(a.card_fields), accent });
      html = require('../lib/mailBody').render(bodyText, { accent: style && style.accent, cardsHtml })
        + (quote ? '<div style="font-size:13px;line-height:1.5;color:#4b5563;white-space:pre-wrap;margin-top:12px;">' + esc(quote.trim()) + '</div>' : '');
    } else {
      html = '<div style="font-size:14px;line-height:1.6;white-space:pre-wrap;">' + esc(body) + '</div>';
    }
    let sent;
    if (isTest) {
      sent = await emailSvc.sendClientEmail({ to: u.email, subject, html, senderName, logoUrl, style, companyId: cid, mailType: 'reply_test' });
    } else {
      const mailer = await emailSvc.getCompanyMailer(cid);
      if (!mailer || !mailer.ok) return { ok: false, err: (mailer && mailer.noConfig) ? 'Configurați contul expeditor (SMTP) în Integrări.' : ((mailer && mailer.error) || 'Eroare la contul expeditor') };
      sent = await mailer.send({ to: h.from_email, subject, html: emailSvc.wrapBrandedEmail(html, { logoUrl, senderName, style }), mailType: 'reply', inReplyTo: h.message_id, references: refs, sentBy: u.email,
        draft: (a.record_draft && typeof a.record_draft === 'object') ? a.record_draft : undefined });
    }
    r = sent && sent.ok ? { ok: true } : { ok: false, err: (sent && sent.error) || 'Eroare la trimitere' };
  }
  if (r.ok && !isTest) {
    await pool.query('UPDATE mail_headers SET replied_at=now() WHERE id=$1', [h.id]);
    try { await audit.fromReq(req, 'mail.reply', 'mail', h.id, { order: !!h.order_id }); } catch (_) {}
  }
  return r.ok ? { ok: true, to: h.from_email, subject } : r;
}

handlers.mailReply = async function (req, res, args) {
  try {
    const g = await _gate(req); if (g) return _err(res, g);
    const r = await sendReply(req, _arg(args));
    return res.json({ result: r });
  } catch (e) { console.error('mailReply hiba:', e.message); return _err(res, 'Eroare de server'); }
};

// ─── 📤 Elküldött: a cég fiókjáról kiment levelek (mail_sent) ───
// args: { q, status, limit, offset }
handlers.mailSentList = async function (req, res, args) {
  try {
    const g = await _gate(req); if (g) return _err(res, g);
    const a = _arg(args);
    const params = [_u(req).company_id];
    let sql = `SELECT s.id, s.to_email, s.subject, s.mail_type, s.status, s.created_at, s.sent_by, s.order_id,
                      jsonb_array_length(s.attachments) AS att_n, (s.in_reply_to IS NOT NULL) AS is_reply,
                      COALESCE(to_jsonb(o)->>'fuvar_no', o.id) AS fuvar_no
                 FROM mail_sent s
                 LEFT JOIN orders o ON o.id = s.order_id AND o.company_id = s.company_id
                WHERE s.company_id=$1 AND COALESCE(s.mail_type,'') <> 'builder_test'`;
    if (a.status === 'failed') sql += ` AND s.status='failed'`;
    const q = _str(a.q, 100);
    if (q) { params.push('%' + q.replace(/[%_\\]/g, '') + '%'); sql += ` AND (s.to_email ILIKE $${params.length} OR s.subject ILIKE $${params.length})`; }
    sql += ` ORDER BY s.created_at DESC LIMIT ${Math.min(parseInt(a.limit, 10) || 100, 300)} OFFSET ${Math.max(parseInt(a.offset, 10) || 0, 0)}`;
    const { rows } = await pool.query(sql, params);
    return _ok(res, { items: rows });
  } catch (e) { console.error('mailSentList hiba:', e.message); return _ok(res, { items: [], migration: true }); }
};

// Levélszál: a beérkezett + elküldött levelek Message-ID / In-Reply-To láncon.
// A beérkezett levelek TARTALMA itt sem jön — csak fejléc; a saját kimenő
// leveleink szövege igen (azt mi írtuk).
async function _thread(cid, start) {
  const ids = new Set();
  const inMap = new Map(), outMap = new Map();
  const addIds = (v) => String(v || '').split(/\s+/).filter((x) => /^<[^<>\s]{3,250}>$/.test(x)).forEach((x) => ids.add(x));
  if (start.kind === 'in') {
    const r = await pool.query('SELECT id, message_id, refs FROM mail_headers WHERE id=$1 AND company_id=$2', [start.id, cid]);
    if (!r.rows.length) return null;
    addIds(r.rows[0].message_id); addIds(r.rows[0].refs);
  } else {
    const r = await pool.query('SELECT id, message_id, in_reply_to FROM mail_sent WHERE id=$1 AND company_id=$2', [start.id, cid]);
    if (!r.rows.length) return null;
    addIds(r.rows[0].message_id); addIds(r.rows[0].in_reply_to);
  }
  for (let round = 0; round < 4 && ids.size; round++) {
    const before = ids.size;
    const list = Array.from(ids).slice(0, 200);
    const h = await pool.query(
      `SELECT h.id, h.message_id, h.refs, h.from_email, h.from_name, h.subject, h.received_at, h.opened_at
         FROM mail_headers h JOIN mail_accounts m ON m.id=h.account_id AND m.company_id=h.company_id
        WHERE h.company_id=$1 AND h.dismissed=false AND m.use_inbox=true
          AND (h.message_id = ANY($2::text[]) OR string_to_array(COALESCE(h.refs,''), ' ') && $2::text[]) LIMIT 100`, [cid, list]);
    h.rows.forEach((x) => { inMap.set(x.id, x); addIds(x.message_id); addIds(x.refs); });
    const o = await pool.query(
      `SELECT id, message_id, in_reply_to, to_email, subject, body_text, attachments, status, created_at, sent_by
         FROM mail_sent WHERE company_id=$1 AND (message_id = ANY($2::text[]) OR in_reply_to = ANY($2::text[])) LIMIT 100`, [cid, list]);
    o.rows.forEach((x) => { outMap.set(x.id, x); addIds(x.message_id); addIds(x.in_reply_to); });
    if (ids.size === before) break;
  }
  if (start.kind === 'out' && !outMap.size) {
    const r = await pool.query(`SELECT id, message_id, in_reply_to, to_email, subject, body_text, attachments, status, created_at, sent_by
                                  FROM mail_sent WHERE id=$1 AND company_id=$2`, [start.id, cid]);
    r.rows.forEach((x) => outMap.set(x.id, x));
  }
  const items = [];
  inMap.forEach((x) => items.push({ dir: 'in', id: x.id, from_email: x.from_email, from_name: x.from_name, subject: x.subject, at: x.received_at, opened: !!x.opened_at }));
  outMap.forEach((x) => items.push({ dir: 'out', id: x.id, to_email: x.to_email, subject: x.subject, at: x.created_at, status: x.status,
    sent_by: x.sent_by, text: x.body_text || '', attachments: Array.isArray(x.attachments) ? x.attachments : [] }));
  items.sort((p, q) => new Date(p.at || 0) - new Date(q.at || 0));
  return items;
}

// args: { kind:'in'|'out', id }
handlers.mailThread = async function (req, res, args) {
  try {
    const g = await _gate(req); if (g) return _err(res, g);
    const a = _arg(args);
    const items = await _thread(_u(req).company_id, { kind: a.kind === 'out' ? 'out' : 'in', id: parseInt(a.id, 10) || 0 });
    if (!items) return _err(res, 'E-mailul nu a fost găsit.');
    return _ok(res, { items });
  } catch (e) { console.error('mailThread hiba:', e.message); return _err(res, 'Eroare de server'); }
};

// Válasz-kontextus a chathez: CSAK címzett + tárgy a felhasználó előnézetéhez (az AI nem kapja).
async function replyContext(req, id) {
  const h = await _loadHeader(_u(req).company_id, id);
  if (!h || !h.acc.use_inbox) return null;
  return { id: h.id, to_email: h.from_email, to_name: h.from_name, subject: h.subject, order_id: h.order_id };
}

Object.defineProperty(handlers, '_sendReply', { value: sendReply, enumerable: false });
Object.defineProperty(handlers, '_replyContext', { value: replyContext, enumerable: false });
Object.defineProperty(handlers, '_gate', { value: _gate, enumerable: false });
Object.defineProperty(handlers, '_thread', { value: _thread, enumerable: false });

module.exports = handlers;
