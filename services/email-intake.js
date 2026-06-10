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

// Új ImapFlow kliens — KÖTELEZŐ 'error' eseménykezelővel.
// Az ImapFlow socket-hibánál (pl. timeout) 'error' eseményt emittál; ha nincs rá
// figyelő, a Node KEZELETLEN 'error' eventként LEÁLLÍTJA a folyamatot (az egész szervert).
// A try/catch ezt NEM fogja el (ez nem promise-rejection). Ezért itt mindig figyelünk rá.
function makeClient(cfg) {
  const client = new ImapFlow({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass }, logger: false,
    socketTimeout: 120000, greetingTimeout: 30000, connectionTimeout: 30000,
  });
  client.on('error', () => { /* elnyeljük — a tényleges hibát a hívó try/catch kezeli */ });
  return client;
}

// Kapcsolat-teszt: csatlakozás + INBOX méret. Siker: {ok:true,count}. Hiba: dob.
async function testConnection(creds) {
  if (!ImapFlow) throw new Error('Az imapflow csomag nincs telepítve a szerveren.');
  const cfg = resolveImap(creds);
  if (!cfg.user || !cfg.pass) throw new Error('Hiányzó e-mail cím vagy jelszó.');
  if (!cfg.host) throw new Error('Hiányzó IMAP szerver.');
  const client = makeClient(cfg);
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
// FONTOS: a nehéz feldolgozás (PDF/OCR/AI) NEM az IMAP-kapcsolat alatt fut — különben a
// tétlen kapcsolat időtúllépést kapna. Ezért 3 fázis: (1) nyers levelek gyors letöltése,
// (2) feldolgozás+DB a kapcsolat lezárása UTÁN, (3) rövid újrakapcsolódás az olvasott-jelöléshez.
async function pollOnce(pool, creds, companyId, opts) {
  if (!ImapFlow || !simpleParser) return { skipped: true };
  if (!creds || !companyId) return { skipped: true };
  const cfg = resolveImap(creds);
  if (!cfg.host || !cfg.user || !cfg.pass) return { skipped: true };
  const limit = (opts && opts.limit) || 25;   // körönkénti köteg-méret (a többi a következő ciklusban)
  // Aktiválási időpont: csak az ENNÉL újabb leveleket dolgozzuk fel (a korábbiakat soha).
  const sinceDate = (opts && opts.since) ? new Date(opts.since) : null;

  const aiEnabled = await aiEnabledFor(pool, companyId);

  // ── 1) GYORS fázis: csak letöltjük a nyers leveleket (semmi OCR/AI a kapcsolat alatt) ──
  const collected = [];
  const client = makeClient(cfg);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(cfg.mailbox || 'INBOX');
    try {
      // A SINCE keresés napra szűr (csökkenti a letöltést); a percre pontos vágást az envelope dátuma adja.
      const search = { seen: false };
      if (sinceDate && !isNaN(sinceDate)) search.since = sinceDate;
      for await (const msg of client.fetch(search, { uid: true, source: true, envelope: true })) {
        const mdate = msg.envelope && msg.envelope.date ? new Date(msg.envelope.date) : null;
        if (sinceDate && !isNaN(sinceDate) && mdate && mdate < sinceDate) continue;  // aktiválás előtti levél kihagyása
        collected.push({ uid: String(msg.uid), source: msg.source });
        if (collected.length >= limit) break;
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }

  // ── 2) NEHÉZ fázis kapcsolat NÉLKÜL: parse + PDF/OCR + AI + DB beszúrás ──
  let processed = 0;
  const doneUids = [];
  const MAX_PDF_BYTES = 15 * 1024 * 1024; // melléklet-sapka: e fölött nem dolgozzuk fel (memória/Gemini-limit)
  for (const m of collected) {
    let insertData = null;
    try {
      const parsed = await simpleParser(m.source);
      const pdfAtt = (parsed.attachments || []).find(a => /pdf$/i.test(a.contentType || '') || /\.pdf$/i.test(a.filename || ''));
      let pdfBuffer = pdfAtt ? pdfAtt.content : null;
      const pdfName = pdfAtt ? pdfAtt.filename : null;
      if (pdfBuffer && pdfBuffer.length > MAX_PDF_BYTES) {
        console.warn(`[Intake] cég #${companyId} — túl nagy PDF melléklet kihagyva (${Math.round(pdfBuffer.length / 1048576)} MB, uid=${m.uid}): ${pdfName || '?'}`);
        pdfBuffer = null;
      }

      let text = (parsed.text || '').trim();
      if (pdfBuffer) { try { const ex = await pdfx.extractText(pdfBuffer); if (ex.text) text = ex.text; } catch (_) {} }

      const r = await orderAi.extractFields({ text, pdfBuffer, pdfName, aiEnabled });

      insertData = [companyId, (parsed.from && parsed.from.text) || null, parsed.subject || null,
        parsed.date || new Date(), m.uid, text.slice(0, 20000), pdfName, pdfBuffer,
        JSON.stringify(r.fields || {}), r.confidence, r.ai_used];
    } catch (e) {
      // A LEVÉL maga hibás (parse/kinyerés) — olvasottra jelöljük, hogy ne
      // ismétlődjön végtelenül, de hangosan naplózzuk, hogy nyoma legyen.
      console.error(`[Intake] cég #${companyId} — levél-feldolgozási hiba (uid=${m.uid}), a levél kimarad:`, e.message);
      doneUids.push(m.uid);
      continue;
    }
    try {
      await pool.query(
        `INSERT INTO inbound_orders (company_id, source_email, subject, received_at, message_uid,
           raw_text, pdf_name, pdf_data, extracted, confidence, ai_used, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'parsed')
         ON CONFLICT (company_id, message_uid) DO NOTHING`, insertData);
      processed++;
      doneUids.push(m.uid);
    } catch (e) {
      // DB-hiba (pl. átmeneti kiesés): NE jelöljük olvasottnak — a következő
      // körben újrapróbáljuk, a UNIQUE(company_id,message_uid) véd a duplikációtól.
      console.error(`[Intake] cég #${companyId} — DB-beszúrási hiba (uid=${m.uid}), újrapróbáljuk a következő körben:`, e.message);
    }
  }

  // ── 3) Olvasott-jelölés rövid újrakapcsolódással (a dedup amúgy is a message_uid-n van) ──
  if (doneUids.length) {
    const c2 = makeClient(cfg);
    try {
      await c2.connect();
      const lock = await c2.getMailboxLock(cfg.mailbox || 'INBOX');
      try { await c2.messageFlagsAdd({ uid: doneUids.join(',') }, ['\\Seen'], { uid: true }); }
      finally { lock.release(); }
    } catch (e) {
      // Ha a jelölés tartósan nem megy, a kör minden 2. percben újra letölti
      // ugyanazokat a leveleket (a UNIQUE csak az adatot védi, a munkát nem) — naplózzuk.
      console.error(`[Intake] cég #${companyId} — olvasott-jelölés hiba (${doneUids.length} levél):`, e.message);
    }
    finally { await c2.logout().catch(() => {}); }
  }

  return { processed, fetched: collected.length };
}

module.exports = { pollOnce, testConnection, resolveImap, aiEnabledFor };
