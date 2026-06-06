// services/email-intake.js
// Adott postafiók figyelése IMAP-pal (1-3 percenként a scheduler hívja), PDF kinyerése,
// majd OCR/AI-kiolvasás -> inbound_orders staging rekord. Ingyenes: IMAP + pdf-parse/Tesseract.
//
// Konfiguráció (.env) — amíg üres, a szolgáltatás ÜRESJÁRATBAN marad (nem hibázik):
//   INTAKE_IMAP_HOST, INTAKE_IMAP_PORT (993), INTAKE_IMAP_USER, INTAKE_IMAP_PASS, INTAKE_IMAP_TLS (true)
//   INTAKE_MAILBOX (INBOX), INTAKE_COMPANY_ID (melyik céghez tartozik a fiók — több fiók/cég később)

const pdfx = require('./pdf-extract');
const orderAi = require('./order-ai');

let ImapFlow = null, simpleParser = null;
try { ImapFlow = require('imapflow').ImapFlow; } catch (_) { /* npm i imapflow */ }
try { simpleParser = require('mailparser').simpleParser; } catch (_) { /* npm i mailparser */ }

function configured() {
  return !!(process.env.INTAKE_IMAP_HOST && process.env.INTAKE_IMAP_USER &&
            process.env.INTAKE_IMAP_PASS && process.env.INTAKE_COMPANY_ID);
}

async function aiEnabledFor(pool, companyId) {
  try {
    const { rows } = await pool.query(
      `SELECT meta FROM company_integrations WHERE company_id=$1 AND provider='order_intake'`, [companyId]);
    return !!(rows[0] && rows[0].meta && rows[0].meta.ai_enabled);
  } catch (_) { return false; }
}

// Egy lekérdezési kör. Visszaadja a feldolgozott levelek számát.
async function pollOnce(pool) {
  if (!configured() || !ImapFlow || !simpleParser) return { skipped: true };
  const companyId = parseInt(process.env.INTAKE_COMPANY_ID, 10);
  const aiEnabled = await aiEnabledFor(pool, companyId);
  const client = new ImapFlow({
    host: process.env.INTAKE_IMAP_HOST,
    port: parseInt(process.env.INTAKE_IMAP_PORT || '993', 10),
    secure: String(process.env.INTAKE_IMAP_TLS || 'true') !== 'false',
    auth: { user: process.env.INTAKE_IMAP_USER, pass: process.env.INTAKE_IMAP_PASS },
    logger: false,
  });
  let processed = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock(process.env.INTAKE_MAILBOX || 'INBOX');
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

module.exports = { pollOnce, configured };
