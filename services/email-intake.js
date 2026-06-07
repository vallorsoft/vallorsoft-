// services/email-intake.js
// Adott postafiók figyelése IMAP-pal (a scheduler 2 percenként hívja cégenként), PDF kinyerése,
// majd OCR/AI-kiolvasás -> inbound_orders staging rekord. Ingyenes: IMAP + pdf-parse/Tesseract.
//
// FONTOS: a postafiók-beállítás NEM a .env-ből jön, hanem cégenként a company_integrations
// táblából (provider='email_intake', credentials_enc = AES-256-GCM titkosított JSON).
// A kapott `creds` objektum alakja (lásd handlers/intakeHandlers.js):
//   gmail:   { provider:'gmail',   email, app_password, mailbox }
//   outlook: { provider:'outlook', email, password,     mailbox }
//   custom:  { provider:'custom',  host, port, tls, email, password, mailbox }

const pdfx = require('./pdf-extract');
const orderAi = require('./order-ai');

let ImapFlow = null, simpleParser = null;
try { ImapFlow = require('imapflow').ImapFlow; } catch (_) { /* npm i imapflow */ }
try { simpleParser = require('mailparser').simpleParser; } catch (_) { /* npm i mailparser */ }

// Szolgáltató -> IMAP kapcsolat. Egységes alak: { host, port, secure, user, pass, mailbox }.
function resolveImap(creds) {
  const c = creds || {};
  const provider = c.provider || 'custom';
  const mailbox = c.mailbox || 'INBOX';
  const user = c.email;
  if (provider === 'gmail') {
    return { host: 'imap.gmail.com', port: 993, secure: true, user, pass: c.app_password || c.password, mailbox };
  }
  if (provider === 'outlook') {
    return { host: 'outlook.office365.com', port: 993, secure: true, user, pass: c.password, mailbox };
  }
  // custom
  return {
    host: c.host,
    port: parseInt(c.port || 993, 10),
    secure: c.tls !== false && String(c.tls) !== 'false',
    user, pass: c.password, mailbox,
  };
}

async function aiEnabledFor(pool, companyId) {
  try {
    const { rows } = await pool.query(
      `SELECT meta FROM company_integrations WHERE company_id=$1 AND provider='order_intake'`, [companyId]);
    return !!(rows[0] && rows[0].meta && rows[0].meta.ai_enabled);
  } catch (_) { return false; }
}

// Kapcsolat-teszt: csatlakozás + INBOX méret. Siker: {ok:true,count}. Hiba: dob.
async function testConnection(creds) {
  if (!ImapFlow) throw new Error('Az imapflow csomag nincs telepítve a szerveren.');
  const cfg = resolveImap(creds);
  if (!cfg.user || !cfg.pass) throw new Error('Hiányzó e-mail cím vagy jelszó.');
  if (!cfg.host) throw new Error('Hiányzó IMAP szerver.');
  const client = new ImapFlow({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass }, logger: false,
  });
  await client.connect();
  let count = 0;
  try {
    const lock = await client.getMailboxLock(cfg.mailbox || 'INBOX');
    try { count = client.mailbox && client.mailbox.exists != null ? client.mailbox.exists : 0; }
    finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
  return { ok: true, count };
}

// Egy lekérdezési kör egy cégre. Visszaadja a feldolgozott levelek számát.
async function pollOnce(pool, creds, companyId) {
  if (!ImapFlow || !simpleParser) return { skipped: true };
  if (!creds || !companyId) return { skipped: true };
  const cfg = resolveImap(creds);
  if (!cfg.host || !cfg.user || !cfg.pass) return { skipped: true };

  const aiEnabled = await aiEnabledFor(pool, companyId);
  const client = new ImapFlow({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass }, logger: false,
  });
  let processed = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock(cfg.mailbox || 'INBOX');
    try {
      for await (const msg of client.fetch({ seen: false }, { uid: true, source: true })) {
        try {
          const uid = String(msg.uid);
          const parsed = await simpleParser(msg.source);
          const pdfAtt = (parsed.attachments || []).find(a => /pdf$/i.test(a.contentType || '') || /\.pdf$/i.test(a.filename || ''));
          const pdfBuffer = pdfAtt ? pdfAtt.content : null;
          const pdfName = pdfAtt ? pdfAtt.filename : null;

          let text = (parsed.text || '').trim();
          if (pdfBuffer) { const ex = await pdfx.extractText(pdfBuffer); if (ex.text) text = ex.text; }

          const r = await orderAi.extractFields({ text, pdfBuffer, pdfName, aiEnabled });

          await pool.query(
            `INSERT INTO inbound_orders (company_id, source_email, subject, received_at, message_uid,
               raw_text, pdf_name, pdf_data, extracted, confidence, ai_used, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'parsed')
             ON CONFLICT (company_id, message_uid) DO NOTHING`,
            [companyId, (parsed.from && parsed.from.text) || null, parsed.subject || null,
             parsed.date || new Date(), uid, text.slice(0, 20000), pdfName, pdfBuffer,
             JSON.stringify(r.fields || {}), r.confidence, r.ai_used]);

          await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true });
          processed++;
        } catch (e) { /* egy levél hibája ne állítsa le a kört */ }
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
  return { processed };
}

module.exports = { pollOnce, testConnection, resolveImap, aiEnabledFor };
