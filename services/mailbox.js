// ============================================================
//  VallorSoft — services/mailbox.js
//  Több postafiók (mail_accounts) kezelése IMAP-pal, ADATVÉDELMI elvvel:
//   • a háttér-lekérdezés CSAK fejlécet tölt le (feladó, tárgy, dátum,
//     Message-ID) — a törzset/csatolmányt nem, és nem jelöli olvasottnak;
//   • csak a beállított mappákból és csak az engedélyezett feladóktól
//     (saját ügyfelek/alvállalkozók/kontaktok, egyedi lista, vagy mind);
//   • a teljes levél CSAK a felhasználó kattintására jön le élőben, és
//     nem kerül adatbázisba. Az AI ebből semmit nem kap automatikusan.
// ============================================================
'use strict';

const { decrypt } = require('../lib/crypto');
const intake = require('./email-intake');

let simpleParser = null;
try { simpleParser = require('mailparser').simpleParser; } catch (_) { /* npm i mailparser */ }

const MAX_HEADERS_PER_TICK = 200;
const ORDER_REF_RE = /\b([A-Z]{1,10}-\d{4}-\d{1,6})\b/i;

function folderList(acc) {
  return String(acc.folders || 'INBOX').split(',').map((f) => f.trim()).filter(Boolean).slice(0, 10);
}

function accCreds(acc) {
  try { return JSON.parse(decrypt(acc.creds_enc)); } catch (_) { return null; }
}

// Engedélyezett feladó? mode: 'all' | 'list' | 'known'
async function buildAllowFn(pool, acc) {
  if (acc.allow_mode === 'all') return () => true;
  const emails = new Set(); const domains = new Set();
  const add = (v) => {
    const s = String(v || '').trim().toLowerCase();
    if (!s) return;
    if (s.startsWith('@')) domains.add(s.slice(1)); else if (s.includes('@')) emails.add(s); else domains.add(s);
  };
  if (acc.allow_mode === 'list') {
    String(acc.allow_list || '').split(/[\s,;]+/).forEach(add);
  } else {
    const q = async (sql) => { try { (await pool.query(sql, [acc.company_id])).rows.forEach((r) => add(r.e)); } catch (_) {} };
    await q('SELECT email AS e FROM clients WHERE company_id=$1 AND email IS NOT NULL');
    await q('SELECT email AS e FROM carriers WHERE company_id=$1 AND email IS NOT NULL');
    await q('SELECT email AS e FROM email_contacts WHERE company_id=$1 AND email IS NOT NULL');
    String(acc.allow_list || '').split(/[\s,;]+/).forEach(add);
  }
  return (addr) => {
    const a = String(addr || '').toLowerCase();
    if (!a) return false;
    if (emails.has(a)) return true;
    const dom = a.split('@')[1] || '';
    return domains.has(dom);
  };
}

// Háttér-kör egy fiókra: CSAK fejlécek az engedélyezett feladóktól.
async function syncHeaders(pool, acc) {
  const creds = accCreds(acc);
  if (!creds) throw new Error('Datele contului nu pot fi decriptate.');
  const cfg = intake.resolveImap(creds);
  if (!cfg.host || !cfg.user || !cfg.pass) return { skipped: true };
  const allow = await buildAllowFn(pool, acc);
  const since = acc.since ? new Date(acc.since) : new Date();
  const client = intake.makeClient(cfg);
  await client.connect();
  let added = 0;
  try {
    for (const folder of folderList(acc)) {
      let lock;
      try { lock = await client.getMailboxLock(folder); } catch (_) { continue; }
      try {
        let n = 0;
        for await (const msg of client.fetch({ since }, { uid: true, envelope: true })) {
          if (++n > MAX_HEADERS_PER_TICK) break;
          const env = msg.envelope || {};
          const date = env.date ? new Date(env.date) : null;
          if (date && date < since) continue;
          const from = (env.from && env.from[0]) || {};
          const addr = String(from.address || '').toLowerCase();
          if (!allow(addr)) continue;            // nem engedélyezett feladó → nem is tároljuk
          const subject = String(env.subject || '').slice(0, 500);
          const refM = ORDER_REF_RE.exec(subject);
          let orderId = null;
          if (refM) {
            try {
              const o = await pool.query(
                `SELECT id FROM orders WHERE company_id=$1 AND UPPER(COALESCE(to_jsonb(orders)->>'fuvar_no',''))=$2 LIMIT 1`,
                [acc.company_id, refM[1].toUpperCase()]);
              if (o.rows.length) orderId = o.rows[0].id;
            } catch (_) {}
          }
          const r = await pool.query(
            `INSERT INTO mail_headers (company_id, account_id, folder, uid, message_id, refs, from_email, from_name, subject, received_at, order_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (account_id, folder, uid) DO NOTHING`,
            [acc.company_id, acc.id, folder, msg.uid, String(env.messageId || '').slice(0, 300) || null,
              Array.isArray(env.inReplyTo) ? env.inReplyTo.join(' ') : (env.inReplyTo || null),
              addr.slice(0, 255), String(from.name || '').slice(0, 255) || null, subject, date || new Date(), orderId]);
          added += r.rowCount || 0;
        }
      } finally { lock.release(); }
    }
  } finally { await client.logout().catch(() => {}); }
  return { added };
}

// Egy levél nyers forrása (CSAK a felhasználó kattintására).
async function fetchSource(acc, folder, uid) {
  const creds = accCreds(acc);
  if (!creds) throw new Error('Datele contului nu pot fi decriptate.');
  const cfg = intake.resolveImap(creds);
  const client = intake.makeClient(cfg);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) throw new Error('E-mailul nu mai există în căsuța poștală.');
      return msg.source;
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
}

// Megnyitás: szöveg + csatolmány-lista (a tartalom nem kerül DB-be).
async function readMessage(acc, folder, uid) {
  if (!simpleParser) throw new Error('Pachetul mailparser nu este instalat pe server.');
  const source = await fetchSource(acc, folder, uid);
  const p = await simpleParser(source);
  let text = (p.text || '').trim();
  if (!text && p.html) text = String(p.html).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim();
  return {
    text: text.slice(0, 50000),
    references: [p.references].flat().filter(Boolean).join(' '),
    messageId: p.messageId || null,
    attachments: (p.attachments || []).map((a, i) => ({ idx: i, name: a.filename || ('atasament-' + (i + 1)), type: a.contentType || '', size: a.size || (a.content ? a.content.length : 0), content: a.content })),
  };
}

module.exports = { syncHeaders, fetchSource, readMessage, accCreds, folderList, buildAllowFn };
