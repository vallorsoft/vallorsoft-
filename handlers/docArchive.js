// handlers/docArchive.js — kötelező éves cég-dokumentum archívum (lib/docArchive).
// Admin/Manager; minden lekérdezés a saját cégre szűr; audit.

const pool = require('../db');
const audit = require('../lib/audit');
const arch = require('../lib/docArchive');

const handlers = {};
const _am = (u) => u && ['Admin', 'Manager'].includes(u.pozicio) && u.company_id;

// docArchiveStatus() → { phase:'ok'|'warn'|'lock', days_left, due_at, history[] }
handlers.docArchiveStatus = async function (req, res) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const st = await arch.status(u.company_id);
    if (!st) return res.json({ result: { ok: false, err: 'Firma nu a fost găsită.' } });
    let history = [];
    try {
      const h = await pool.query(
        `SELECT id, created_by, created_at, completed, file_count, total_bytes, confirmed_at, confirmed_by
           FROM company_doc_archives WHERE company_id=$1 ORDER BY created_at DESC LIMIT 20`, [u.company_id]);
      history = h.rows;
    } catch (e) { if (!(e && e.code === '42P01')) throw e; }
    let cloud = null;
    try { cloud = await require('../lib/docArchiveCloud').info(u.company_id); } catch (_) {}
    return res.json({ result: Object.assign({ ok: true, history, cloud }, st) });
  } catch (err) {
    console.error('docArchiveStatus hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// docArchiveConfirm({ code }) — a ZIP-ben lévő KOD-ARHIVA.txt kódja → új 1 éves ciklus.
handlers.docArchiveConfirm = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const r = await arch.confirm(u.company_id, a.code, u.email || u.nume);
    audit.fromReq(req, r.ok ? 'doc_archive.confirm' : 'doc_archive.confirm_fail', 'company', u.company_id,
      r.ok ? { archive_id: r.archive_id, due_at: r.due_at } : {});
    return res.json({ result: r });
  } catch (err) {
    console.error('docArchiveConfirm hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

const _escH = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const _gbTxt = (b) => (Number(b || 0) / (1024 * 1024 * 1024)).toFixed(2) + ' GB';

// docArchiveQuote({ years }) → mennyibe kerül a felhő-archiválás (méret × év × ár).
handlers.docArchiveQuote = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const q = await arch.quote(u.company_id, a.years);
    return res.json({ result: Object.assign({ ok: true }, q) });
  } catch (err) {
    console.error('docArchiveQuote hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Fizetési utasítás e-mail (csak románul) a kérőnek + a cég összes Adminjának.
async function _sendOrderEmails(cid, order, requester) {
  const { sendClientEmail } = require('../services/email');
  const [compR, bankR, adminsR] = await Promise.all([
    pool.query('SELECT nev FROM companies WHERE id=$1', [cid]),
    pool.query("SELECT value FROM developer_settings WHERE key='bank_details'").catch(() => ({ rows: [] })),
    pool.query(`SELECT DISTINCT LOWER(email) AS email FROM users WHERE company_id=$1 AND pozicio='Admin'
                 AND email IS NOT NULL AND email <> '' AND COALESCE(blocked,false)=false`, [cid]),
  ]);
  const company = (compR.rows[0] && compR.rows[0].nev) || '';
  const bank = bankR.rows[0] && bankR.rows[0].value;
  const to = new Set(adminsR.rows.map((r) => r.email));
  if (requester) to.add(String(requester).toLowerCase());
  const payUntil = new Date(order.pay_until).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' });
  const row = (k, v, b) => '<tr><td style="padding:4px 0;color:#475569;font-size:13px;">' + k + '</td><td style="text-align:right;font-size:13px;' + (b ? 'font-weight:700;' : '') + '">' + v + '</td></tr>';
  const bankHtml = bank
    ? '<table style="width:100%;border-collapse:collapse;">' + row('Titular cont', _escH(bank.holder)) + row('IBAN', '<span style="font-family:monospace;">' + _escH(bank.iban) + '</span>') +
      row('Bancă', _escH(bank.bank)) + (bank.swift ? row('SWIFT/BIC', _escH(bank.swift)) : '') + '</table>'
    : '<p style="color:#b91c1c;font-size:13px;">Datele bancare nu sunt configurate. Contactați: vallorsoft@gmail.com</p>';
  const html = '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">' +
    '<div style="background:#1d4ed8;padding:22px 26px;border-radius:12px 12px 0 0;"><h1 style="margin:0;color:#fff;font-size:20px;">vallorSoft</h1>' +
    '<p style="margin:6px 0 0;color:#dbeafe;font-size:13px;">Arhivarea documentelor în cloud — detalii plată</p></div>' +
    '<div style="background:#fff;padding:22px 26px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">' +
    '<p style="margin:0 0 14px;font-size:15px;">S-a solicitat arhivarea documentelor firmei <b>' + _escH(company) + '</b> pentru <b>' + order.years + ' ' + (order.years === 1 ? 'an' : 'ani') + '</b>.</p>' +
    '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin-bottom:14px;"><table style="width:100%;border-collapse:collapse;">' +
      row('Volum documente', _gbTxt(order.size_bytes)) +
      row('Tarif anual', Number(order.annual_eur).toFixed(2) + ' EUR / an') +
      row('Perioadă', order.years + ' ' + (order.years === 1 ? 'an' : 'ani')) +
      row('Total net EUR', '€' + Number(order.amount_eur).toFixed(2)) +
      (order.bnr_rate ? row('Curs BNR', Number(order.bnr_rate).toFixed(4) + ' RON/€') + row('Net RON', Number(order.amount_ron).toFixed(2) + ' RON') +
        row('TVA 21%', Number(order.tva_ron).toFixed(2) + ' RON') + row('TOTAL', Number(order.total_ron).toFixed(2) + ' RON', true) : row('TOTAL', '€' + Number(order.amount_eur).toFixed(2), true)) +
    '</table></div>' +
    '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px 16px;margin-bottom:14px;"><div style="font-size:12px;color:#166534;font-weight:700;margin-bottom:6px;">DATE CONT BANCAR</div>' + bankHtml + '</div>' +
    '<div style="border:2px solid #1d4ed8;border-radius:8px;padding:12px;margin-bottom:14px;text-align:center;"><div style="font-size:11px;color:#1d4ed8;font-weight:700;">REFERINȚĂ PLATĂ</div>' +
      '<div style="font-size:22px;font-weight:800;font-family:monospace;letter-spacing:1px;">' + _escH(order.reference) + '</div>' +
      '<div style="font-size:12px;color:#475569;margin-top:4px;">Scrieți acest cod în câmpul „Observații" al ordinului de plată.</div></div>' +
    '<p style="font-size:13px;color:#0f172a;margin:0 0 10px;"><b>Termen de plată: 48 de ore (până la ' + _escH(payUntil) + ').</b> Până atunci toate restricțiile legate de arhiva documentelor sunt ridicate. ' +
      'Arhivarea se activează după confirmarea plății; de atunci descărcarea arhivei nu mai este obligatorie pe perioada plătită.</p>' +
    '<p style="font-size:13px;color:#475569;margin:0;">Dacă plata nu sosește în 48 de ore, cererea expiră și obligația de descărcare a arhivei revine.</p></div></div>';
  let sent = 0;
  for (const email of to) {
    try {
      const r = await sendClientEmail({ to: email, subject: 'VallorSoft — Arhivare documente: detalii plată · ' + order.reference, html, companyId: cid, mailType: 'payment' });
      if (r && r.ok) sent++;
    } catch (_) { /* egy címzett hibája ne állítsa meg a többit */ }
  }
  try {
    const { sendDeveloperEmail } = require('../services/email');
    await sendDeveloperEmail(process.env.DEV_NOTIFY_EMAIL || 'vallorsoft@gmail.com', 'VallorSoft System',
      '📦 Archiválási kérés: ' + company,
      '<p><b>' + _escH(company) + '</b> felhő-archiválást kért: ' + order.years + ' év, ' + order.gb + ' GB, €' + Number(order.amount_eur).toFixed(2) +
      (order.total_ron ? ' = ' + Number(order.total_ron).toFixed(2) + ' RON bruttó' : '') + '.</p><p>Referencia: <b style="font-family:monospace;">' + _escH(order.reference) +
      '</b> — fizetési határidő: ' + _escH(payUntil) + '.</p><p>A pénz beérkezése után aktiváld a developer felületen (💸 Fizetési kérelmek → Archiválás).</p>', cid);
  } catch (e) { console.warn('[DocArchive] developer értesítő hiba:', e.message); }
  return sent;
}

// docArchiveOrder({ years }) → archiválási kérés + fizetési utasítás e-mailben.
handlers.docArchiveOrder = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const r = await arch.createOrder(u.company_id, a.years, u.email || u.nume);
    if (!r.ok) return res.json({ result: r });
    let sent = 0;
    try { sent = await _sendOrderEmails(u.company_id, r, u.email); } catch (e) { console.warn('[DocArchive] fizetési e-mail hiba:', e.message); }
    audit.fromReq(req, 'doc_archive.order', 'company', u.company_id, { order_id: r.id, reference: r.reference, years: r.years, gb: r.gb, amount_eur: r.amount_eur });
    return res.json({ result: Object.assign({}, r, { emails_sent: sent }) });
  } catch (err) {
    if (err && err.code === '42P01') return res.json({ result: { ok: false, err: 'Repornește serverul pentru a rula migrațiile.' } });
    console.error('docArchiveOrder hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
