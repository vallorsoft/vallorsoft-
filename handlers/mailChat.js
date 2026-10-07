// ============================================================
//  VallorSoft — handlers/mailChat.js
//  💬 AI-chat — E-MAIL ág. Ugyanabban a chatben (lebegő 💬 gomb), amit a
//  felhasználó ír, abba kezd: ha e-mailt kér („küldd el a CMD-2026-0042
//  megrendelőjének a számlát…"), a fuvar-vázlat helyett egy LEVÉL-vázlat
//  készül, amit a chatben javít, majd 📤 Küldés / ✉️ Teszt magamnak.
//
//  Újrahasznosítás (nincs párhuzamos küldő-logika):
//   • fuvar-adatok + elérhető csatolmányok + sablonok → orderEmail.getOrderEmailData
//   • küldés → orderEmail.sendOrderEmail (cég SAJÁT SMTP/Brevo fiókja, teszt a
//     közös címről a saját címre, céges logó, mail_log, audit)
//   • tanulás → lib/chatMemory (`order_chat_memory`, kind='mail_pref')
//
//  ADATVÉDELEM: az AI a beszélgetés szövegét + az EGY kiválasztott fuvar
//  alapadatait (szám, útvonal, státusz, ügyfélnév) + a csatolmány-/sablon-
//  NEVEKET kapja. E-mail-cím, ügyfél-/sofőr-lista NEM megy az AI-hoz; a
//  címzett feloldása a szerveren történik. Az AI soha nem küld — küldés csak
//  a felhasználó gombnyomására. Kapu: Admin|Manager + `ai-szoveges-fuvar` (Pro).
// ============================================================
'use strict';

const pool = require('../db');
const { extractJson } = require('../lib/geminiJson');
const { memGet, memPut, memDel } = require('../lib/chatMemory');
const mailStyle = require('../lib/mailStyle');
const { createSlidingWindowLimiter } = require('../lib/slidingWindow');
const audit = require('../lib/audit');
const emailSvc = require('../services/email');
const { appBaseUrl } = require('../lib/appUrl');

const handlers = {};
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const ORDER_REF_RE = /\b([A-Z]{1,10}-\d{4}-\d{1,6}|CMD-[A-Z0-9]{8,14})\b/i;
const MAX_ATT = 10;
const sendLimiter = createSlidingWindowLimiter({ windowMs: 60 * 60 * 1000, max: 20 });

const QT = {
  needOrder: { ro: 'Pentru ce cursă scriu e-mailul? Scrie numărul cursei (ex. CMD-2026-0042).', hu: 'Melyik fuvarról írjam a levelet? Írd be a fuvarszámot (pl. CMD-2026-0042).' },
  notFound:  { ro: 'Nu găsesc cursa {c}.', hu: 'Nem találom a(z) {c} fuvart.' },
  whoTo:     { ro: 'Cui trimit e-mailul?', hu: 'Kinek küldjem a levelet?' },
  noClientMail:  { ro: 'Clientul nu are adresă de e-mail salvată — scrie adresa.', hu: 'Az ügyfélnek nincs mentett e-mail címe — írd be a címet.' },
  noCarrierMail: { ro: 'Subcontractantul nu are adresă de e-mail — scrie adresa.', hu: 'Az alvállalkozónak nincs e-mail címe — írd be a címet.' },
  optClient: { ro: 'Clientului', hu: 'Az ügyfélnek' },
  optCarrier:{ ro: 'Subcontractantului', hu: 'Az alvállalkozónak' },
  whoName:   { ro: 'Mai mulți destinatari corespund: „{c}". Care este?', hu: 'Több címzett is illik erre: „{c}". Melyik?' },
  noName:    { ro: 'Nu găsesc „{c}" printre clienți / subcontractanți / contacte. Scrie adresa de e-mail.', hu: 'Nem találom „{c}"-t az ügyfelek / alvállalkozók / kontaktok között. Írd be az e-mail címet.' },
  whoToGen:  { ro: 'Cui trimit e-mailul? Scrie numele (client, subcontractant, contact) sau adresa de e-mail.', hu: 'Kinek küldjem? Írd be a nevét (ügyfél, alvállalkozó, kontakt) vagy az e-mail címét.' },
  rateLimit: { ro: 'Prea multe e-mailuri trimise din chat. Încearcă mai târziu.', hu: 'Túl sok levél ment a chatből. Próbáld később.' },
};
function qt(lang, key, c) {
  const e = QT[key] || {};
  return String(e[lang === 'hu' ? 'hu' : 'ro'] || e.ro || '').replace('{c}', c == null ? '' : String(c));
}
const _str = (v, max) => (v == null ? null : (String(v).trim().slice(0, max) || null));
function _fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9@. ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// E-mail-szándék a felhasználó szövegéből (ékezet-független).
function isEmailIntent(text) {
  const f = _fold(text);
  return /(^|\s)(e ?mail\w*|mail\w*|level\w*|scrisoare|scrisoarea)(\s|$)/.test(f) || /@[a-z0-9-]+\./.test(f);
}

// ─── Vázlat-tisztítás (AI-ból VAGY a kliensről jövő, megbízhatatlan) ───
function sanitizeMail(d) {
  const j = (d && typeof d === 'object') ? d : {};
  const rec = ['client', 'carrier', 'other', 'named'].includes(j.recipient) ? j.recipient : null;
  const to = _str(j.to_email, 200);
  return {
    mode: 'email',
    order_id: _str(j.order_id, 40),
    fuvar_no: _str(j.fuvar_no, 40),
    recipient: rec,
    to_email: to && EMAIL_RE.test(to) ? to : null,
    subject: _str(j.subject, 300),
    body: j.body == null ? null : String(j.body).slice(0, 8000),
    lang: j.lang === 'hu' ? 'hu' : (j.lang === 'ro' ? 'ro' : null),
    attachments: (Array.isArray(j.attachments) ? j.attachments : []).map((x) => _str(x, 60)).filter(Boolean).slice(0, MAX_ATT),
    include_tracking: j.include_tracking === true,
    builder_template_id: parseInt(j.builder_template_id, 10) || null,
    learned_to: j.learned_to === true,
    recipient_name: _str(j.recipient_name, 120),
    style: mailStyle.sanitizeStyle(j.style),
    style_init: j.style_init === true,
    style_default: j.style_default === true,
    reply_mail_id: parseInt(j.reply_mail_id, 10) || null,
  };
}

// RPC-hívás belsőleg, stub res-szel (a meglévő orderEmail handlerek).
function _call(fn, req, args) {
  return new Promise((resolve) => {
    const res = { json: (o) => resolve((o && o.result) || {}) };
    Promise.resolve(fn(req, res, args)).catch(() => resolve({ ok: false, err: 'Eroare de server' }));
  });
}

async function _findOrder(cid, ref) {
  const key = String(ref || '').trim().toUpperCase();
  if (!key) return null;
  const r = await pool.query(
    `SELECT o.id, COALESCE(to_jsonb(o)->>'fuvar_no', o.id) AS fuvar_no, o.client, o.client_id, o.status,
            o.loc_incarcare, o.loc_descarcare, o.ref,
            to_char(o.data_incarcare,'YYYY-MM-DD') AS data_incarcare,
            to_char(o.data_descarcare,'YYYY-MM-DD') AS data_descarcare,
            cl.email AS client_email, car.nev AS carrier_nev, car.email AS carrier_email
       FROM orders o
       LEFT JOIN clients cl ON cl.id = o.client_id AND cl.company_id = o.company_id
       LEFT JOIN carriers car ON car.id = (to_jsonb(o)->>'carrier_id')::int AND car.company_id = o.company_id
      WHERE o.company_id=$1 AND (UPPER(o.id)=$2 OR UPPER(COALESCE(to_jsonb(o)->>'fuvar_no',''))=$2)
      LIMIT 1`, [cid, key]);
  return r.rows[0] || null;
}

function _prefKey(o) { return o.client_id ? 'id:' + o.client_id : _fold(o.client); }

function buildGeneralPrompt() {
  return [
    'You write business e-mails for a Romanian/Hungarian road-freight company (TMS). The dispatcher tells you in free text what e-mail to write. This e-mail is NOT tied to a specific transport order (general message: offer, information, reminder, thanks, anything).',
    'Maintain an e-mail DRAFT across the conversation; merge each new message into the previous draft (keep values unless changed).',
    'recipient: "other" if the dispatcher writes an e-mail address (put it in to_email); otherwise "named" with recipient_name = the company or person name exactly as the dispatcher wrote it (the system looks it up in the customer/subcontractor/contact lists). null if no recipient was mentioned.',
    'lang: "ro" by default, "hu" if the dispatcher asks for Hungarian or the recipient is Hungarian.',
    'Write a short, professional e-mail (greeting, the message, closing without a person name). Never invent prices, dates or facts not given.',
    'style: visual look of the e-mail that the dispatcher asks to change — object with only the changed keys from {"accent":"#rrggbb","bg":"#rrggbb","card":"#rrggbb","text":"#rrggbb","align":"left|center","header":"logo|band|none","font":"sans|serif","width":"narrow|normal|wide"}. accent = header band / line / link color, bg = outer background, card = letter background. Map color words to hex (blue/kék/albastru #2563eb, dark blue/sötétkék #1e3a8a, green/zöld/verde #16a34a, red/piros/roșu #dc2626, orange/narancs #f6711e, purple/lila #7c3aed, black/fekete #111827, grey/szürke #6b7280, white/fehér #ffffff, light grey #f3f4f6). Return the previous style unchanged if nothing about the look was asked; null if never set.',
    'Top-level "save_default": true ONLY when the dispatcher asks to keep this look as their default for future e-mails ("mentsd el alapértelmezettnek", "mindig ilyen legyen", "salvează ca implicit"); "reset_default": true when they ask to go back to the original/default VallorSoft look.',
    'Return ONLY JSON: {"reply":"1-2 short sentences to the dispatcher in THEIR language","save_default":false,"reset_default":false,"draft":{"style":null,"recipient":null,"recipient_name":null,"to_email":null,"lang":"ro","subject":"","body":""},"questions":[{"key":"recipient|other","text":"short question","options":["up to 4 answers"]}]}',
    'Ask a question only if really unclear; otherwise "questions": [].',
  ].join('\n');
}

function buildMailPrompt(o, ctx) {
  return [
    'You write business e-mails for a Romanian/Hungarian road-freight company (TMS). The dispatcher tells you in free text what e-mail to send about ONE transport order.',
    'Maintain an e-mail DRAFT across the conversation; merge each new message into the previous draft (keep values unless changed). Corrections like "more polite", "in Hungarian", "remove the CMR" update only those parts.',
    'ORDER: ' + JSON.stringify({ number: o.fuvar_no, client: o.client, route: [o.loc_incarcare, o.loc_descarcare].filter(Boolean).join(' → '),
      loading_date: o.data_incarcare, unloading_date: o.data_descarcare, status: o.status, reference: o.ref, subcontractor: o.carrier_nev || null }),
    'AVAILABLE ATTACHMENTS (use only these keys): ' + JSON.stringify(ctx.attachments.map((x) => ({ key: x.key, label: x.label, kind: x.kind }))),
    'SAVED VISUAL TEMPLATES (optional, by id): ' + JSON.stringify(ctx.builders.map((b) => ({ id: b.id, name: b.name }))),
    'Tracking link available: ' + (ctx.tracking ? 'yes' : 'no') + '.',
    'recipient: "client" (the customer who ordered/pays — default for invoices, status, tracking), "carrier" (the subcontractor — order confirmation), or "other" only if the dispatcher writes an e-mail address; then put that address in to_email.',
    'lang: language of the e-mail — "ro" by default (Romanian customers), "hu" if the dispatcher asks for Hungarian or the customer is Hungarian.',
    'Write a short, professional e-mail (greeting, 2-5 sentences, closing without a person name). Mention the order number. Do NOT paste the tracking URL yourself — set include_tracking=true when a tracking/status link is wanted. Never invent prices, dates or facts not given.',
    'attachments: keys the dispatcher asks for (e.g. "invoice/számla/factură" → kind invoice; "CMR/aláírt/semnat" → signed doc; "photos/POD" → photo). Empty if none requested.',
    'style: visual look of the e-mail that the dispatcher asks to change — object with only the changed keys from {"accent":"#rrggbb","bg":"#rrggbb","card":"#rrggbb","text":"#rrggbb","align":"left|center","header":"logo|band|none","font":"sans|serif","width":"narrow|normal|wide"}. accent = header band / line / link color, bg = outer background, card = letter background. Map color words to hex (blue/kék/albastru #2563eb, dark blue/sötétkék #1e3a8a, green/zöld/verde #16a34a, red/piros/roșu #dc2626, orange/narancs #f6711e, purple/lila #7c3aed, black/fekete #111827, grey/szürke #6b7280, white/fehér #ffffff, light grey #f3f4f6). Return the previous style unchanged if nothing about the look was asked; null if never set.',
    'Top-level "save_default": true ONLY when the dispatcher asks to keep this look as their default for future e-mails ("mentsd el alapértelmezettnek", "mindig ilyen legyen", "salvează ca implicit"); "reset_default": true when they ask to go back to the original/default VallorSoft look.',
    'Return ONLY JSON: {"reply":"1-2 short sentences to the dispatcher in THEIR language","save_default":false,"reset_default":false,"draft":{"style":null,"recipient":null,"to_email":null,"lang":"ro","subject":"","body":"","attachments":[],"include_tracking":false,"builder_template_id":null},"questions":[{"key":"recipient|other","text":"short question","options":["up to 4 answers"]}]}',
    'Ask a question only if really unclear; otherwise "questions": [].',
  ].join('\n');
}

function _conversation(messages, prev) {
  const v = { style: prev.style, recipient: prev.recipient, recipient_name: prev.recipient_name, to_email: prev.recipient === 'other' ? prev.to_email : null, lang: prev.lang,
    subject: prev.subject, body: prev.body, attachments: prev.attachments, include_tracking: prev.include_tracking,
    builder_template_id: prev.builder_template_id };
  const lines = ['PREVIOUS DRAFT (JSON):', JSON.stringify(v), '', 'CONVERSATION:'];
  messages.forEach((m) => lines.push((m.role === 'assistant' ? 'ASSISTANT: ' : 'DISPATCHER: ') + m.text));
  lines.push('', 'Update the e-mail draft with the LAST dispatcher message and answer.');
  return lines.join('\n');
}

// Címzett + csatolmány + sablon feloldása a szerveren.
async function resolveMail(cid, d, o, ctx, userText, lang) {
  const questions = []; const notes = []; const missing = [];
  d.order_id = o.id; d.fuvar_no = o.fuvar_no;
  const allowAtt = new Set(ctx.attachments.map((x) => x.key));
  d.attachments = d.attachments.filter((k) => allowAtt.has(k));
  const allowB = new Set(ctx.builders.map((b) => b.id));
  if (d.builder_template_id && !allowB.has(d.builder_template_id)) d.builder_template_id = null;
  if (!ctx.tracking) d.include_tracking = false;

  // A „más" címet csak akkor fogadjuk el, ha a felhasználó maga írta (az AI nem találhat ki címet).
  const typed = _fold(userText);
  if (d.recipient === 'other' && !(d.to_email && typed.includes(d.to_email.toLowerCase()))) d.to_email = null;
  d.learned_to = false;
  if (d.recipient === 'client') {
    const pref = await memGet(cid, 'mail_pref', _prefKey(o));
    if (o.client_email) d.to_email = o.client_email;
    else if (pref && pref.to_email && EMAIL_RE.test(pref.to_email)) { d.to_email = pref.to_email; d.learned_to = true; }
    else { d.to_email = null; questions.push({ key: 'recipient', text: qt(lang, 'noClientMail'), options: [] }); }
  } else if (d.recipient === 'carrier') {
    if (o.carrier_email) d.to_email = o.carrier_email;
    else { d.to_email = null; questions.push({ key: 'recipient', text: qt(lang, 'noCarrierMail'), options: [] }); }
  } else if (!d.recipient) {
    d.to_email = null;
    const opts = [qt(lang, 'optClient')];
    if (o.carrier_nev) opts.push(qt(lang, 'optCarrier'));
    questions.push({ key: 'recipient', text: qt(lang, 'whoTo'), options: opts });
  }
  if (!d.to_email) missing.push('recipient');
  if (!d.subject) missing.push('subject');
  if (!d.body && !d.builder_template_id) missing.push('body');
  return { draft: d, questions, notes, missing };
}

// ─── Fuvar nélküli (általános) levél: címzett a cég SAJÁT listáiból (ügyfél /
//     alvállalkozó / e-mail kontakt), company_id-szűrten — az AI ezeket nem látja.
async function _findNamed(cid, name) {
  const q = '%' + String(name).replace(/[%_\\]/g, '').trim() + '%';
  const out = [];
  const add = (rows, kind) => rows.forEach((r) => { if (r.email && EMAIL_RE.test(r.email)) out.push({ name: r.name, email: r.email, kind }); });
  try { add((await pool.query(`SELECT denumire AS name, email FROM clients WHERE company_id=$1 AND denumire ILIKE $2 LIMIT 6`, [cid, q])).rows, 'client'); } catch (_) {}
  try { add((await pool.query(`SELECT nev AS name, email FROM carriers WHERE company_id=$1 AND nev ILIKE $2 LIMIT 6`, [cid, q])).rows, 'carrier'); } catch (_) {}
  try { add((await pool.query(`SELECT name, email FROM email_contacts WHERE company_id=$1 AND (name ILIKE $2 OR email ILIKE $2) LIMIT 6`, [cid, q])).rows, 'contact'); } catch (_) {}
  const seen = new Set();
  return out.filter((x) => { const k = x.email.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

async function resolveGeneral(cid, d, prev, userText, lang) {
  const questions = []; const missing = [];
  d.order_id = null; d.fuvar_no = null; d.attachments = []; d.include_tracking = false; d.builder_template_id = null;
  d.learned_to = false;
  const typed = _fold(userText);
  if (d.recipient === 'other') {
    if (!(d.to_email && typed.includes(d.to_email.toLowerCase()))) d.to_email = null;
  } else if (d.recipient === 'named' && d.recipient_name) {
    // Ugyanaz a név, mint az előző körben → a már feloldott cím marad.
    if (prev.recipient_name && _fold(prev.recipient_name) === _fold(d.recipient_name) && prev.to_email) {
      d.to_email = prev.to_email;
    } else {
      const hits = await _findNamed(cid, d.recipient_name);
      const pref = await memGet(cid, 'mail_pref', 'name:' + _fold(d.recipient_name));
      if (hits.length === 1) d.to_email = hits[0].email;
      else if (hits.length > 1) {
        d.to_email = null;
        questions.push({ key: 'recipient', text: qt(lang, 'whoName', d.recipient_name), options: hits.slice(0, 4).map((h) => h.name + ' <' + h.email + '>') });
      } else if (pref && pref.to_email && EMAIL_RE.test(pref.to_email)) { d.to_email = pref.to_email; d.learned_to = true; }
      else { d.to_email = null; questions.push({ key: 'recipient', text: qt(lang, 'noName', d.recipient_name), options: [] }); }
    }
  } else {
    d.to_email = null;
    questions.push({ key: 'recipient', text: qt(lang, 'whoToGen'), options: [] });
  }
  if (!d.to_email) missing.push('recipient');
  if (!d.subject) missing.push('subject');
  if (!d.body) missing.push('body');
  return { draft: d, questions, notes: [], missing };
}

function _aiQuestions(out) {
  return (Array.isArray(out.questions) ? out.questions : []).slice(0, 2).map((q) => ({
    key: _str(q && q.key, 20) || 'other', text: _str(q && q.text, 300),
    options: (Array.isArray(q && q.options) ? q.options : []).slice(0, 4).map((x) => _str(x, 80)).filter(Boolean),
  })).filter((q) => q.text);
}

// ─── Kinézet: a felhasználó alapértelmezett stílusa (mentve, amíg másképp nem kéri) ───
function _styleKey(req) { return 'user:' + req.session.user.id; }
async function loadUserStyle(req) {
  const v = await memGet(req.session.user.company_id, 'mail_style', _styleKey(req));
  return v && typeof v === 'object' ? v : null;
}
// Az AI által kért változások ráhúzása; mentés / visszaállítás kérésre.
async function applyStyleTurn(req, d, prev, out) {
  const cid = req.session.user.company_id;
  let base = prev.style, baseBuilder = prev.builder_template_id;
  if (!prev.style_init) {
    const def = await loadUserStyle(req);
    base = def ? mailStyle.sanitizeStyle(def.style) : null;
    baseBuilder = def ? (parseInt(def.builder_template_id, 10) || null) : null;
    d.style_default = !!def;
    if (!d.builder_template_id && baseBuilder) d.builder_template_id = baseBuilder;
  } else d.style_default = prev.style_default;
  d.style = mailStyle.mergeStyle(base, d.style);
  if (prev.style && d.style && JSON.stringify(prev.style) !== JSON.stringify(d.style)) d.style_default = false;
  d.style_init = true;
  const notes = [];
  if (out && out.reset_default === true) {
    try { await memDel(cid, 'mail_style', _styleKey(req)); } catch (_) {}
    d.style = null; d.builder_template_id = d.builder_template_id === baseBuilder ? null : d.builder_template_id;
    d.style_default = false; notes.push({ type: 'style_reset' });
  } else if (out && out.save_default === true) {
    try {
      await memPut(cid, 'mail_style', _styleKey(req), { style: d.style, builder_template_id: d.builder_template_id || null });
      d.style_default = true; notes.push({ type: 'style_saved' });
    } catch (_) { /* migráció hiányzik → nincs mentés */ }
  }
  return notes;
}

async function generalTurn(req, res, messages, prev, lang) {
  const cid = req.session.user.company_id;
  const userText = messages.filter((m) => m.role === 'user').map((m) => m.text).join('\n');
  let ai;
  try {
    ai = await extractJson({ systemPrompt: buildGeneralPrompt(), parts: [{ text: _conversation(messages, prev) }] });
  } catch (e) {
    const msg = e && e.code === 'NO_KEY' ? 'Serviciul AI nu este configurat.' : String((e && e.message) || 'Eroare AI').slice(0, 300);
    return res.json({ result: { ok: false, err: msg } });
  }
  const out = (ai && ai.json) || {};
  const d = sanitizeMail(Object.assign({}, out.draft || {}));
  if (!d.lang) d.lang = prev.lang || lang;
  const styleNotes = await applyStyleTurn(req, d, prev, out);
  // A felhasználó egy felkínált „Név <cím>" opcióra kattintott → az a cím (ha tényleg a listából jön).
  const last = messages[messages.length - 1].text;
  const pickM = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(last);
  let r;
  if (pickM && prev.recipient_name) {
    const hits = await _findNamed(cid, prev.recipient_name);
    const hit = hits.find((h) => h.email.toLowerCase() === pickM[1].toLowerCase());
    d.recipient = 'named'; d.recipient_name = prev.recipient_name;
    r = await resolveGeneral(cid, Object.assign(d, { recipient_name: prev.recipient_name }), { recipient_name: prev.recipient_name, to_email: hit ? hit.email : null }, userText, lang);
  } else {
    r = await resolveGeneral(cid, d, prev, userText, lang);
  }
  const seen = new Set(r.questions.map((q) => q.key));
  const questions = r.questions.concat(_aiQuestions(out).filter((q) => !seen.has(q.key))).slice(0, 3);
  try { await audit.fromReq(req, 'mail.chat_turn', 'mail', null, { turns: messages.length, ready: !r.missing.length, model: ai.model, general: true }); } catch (_) {}
  return res.json({ result: { ok: true, mode: 'email', reply: _str(out.reply, 600) || '', draft: r.draft, questions,
    notes: styleNotes, missing: r.missing, ready: r.missing.length === 0, attachments_avail: [], builders_avail: [], tracking_available: false } });
}

// ─── ↩️ Válasz egy megnyitott levélre. Az AI a levelet NEM látja (se feladót,
//     se tárgyat, se szöveget) — csak a felhasználó chatben írt szövegéből dolgozik.
//     Címzett + tárgy a szerveren (mailbox._replyContext), csak az előnézetbe kerül.
function buildReplyPrompt() {
  return [
    'You write a REPLY e-mail body for a Romanian/Hungarian road-freight company. You do NOT see the e-mail being answered — write ONLY from what the dispatcher tells you. Never invent facts, prices, dates or names.',
    'Maintain the reply DRAFT across the conversation; merge each new message into the previous draft.',
    'Write a short, professional reply (greeting, the content, closing without a person name). lang: "ro" by default, "hu" if asked.',
    'style: same rules as before — object with only changed keys from {"accent","bg","card","text" (#rrggbb),"align":"left|center","header":"logo|band|none","font":"sans|serif","width":"narrow|normal|wide"}; previous unchanged if not asked.',
    'Return ONLY JSON: {"reply":"1-2 short sentences to the dispatcher in THEIR language","save_default":false,"reset_default":false,"draft":{"style":null,"lang":"ro","body":""},"questions":[]}',
  ].join('\n');
}
async function replyTurn(req, res, messages, prev, lang) {
  const ctx = await require('./mailbox')._replyContext(req, prev.reply_mail_id);
  if (!ctx) return res.json({ result: { ok: false, err: 'E-mailul nu a fost găsit.' } });
  let ai;
  try {
    const v = { style: prev.style, lang: prev.lang, body: prev.body };
    const lines = ['PREVIOUS DRAFT (JSON):', JSON.stringify(v), '', 'CONVERSATION:'];
    messages.forEach((m) => lines.push((m.role === 'assistant' ? 'ASSISTANT: ' : 'DISPATCHER: ') + m.text));
    ai = await extractJson({ systemPrompt: buildReplyPrompt(), parts: [{ text: lines.join('\n') }] });
  } catch (e) {
    const msg = e && e.code === 'NO_KEY' ? 'Serviciul AI nu este configurat.' : String((e && e.message) || 'Eroare AI').slice(0, 300);
    return res.json({ result: { ok: false, err: msg } });
  }
  const out = (ai && ai.json) || {};
  const d = sanitizeMail(Object.assign({}, out.draft || {}));
  if (!d.lang) d.lang = prev.lang || lang;
  const notes = await applyStyleTurn(req, d, prev, out);
  d.reply_mail_id = ctx.id; d.recipient = 'other'; d.to_email = ctx.to_email; d.recipient_name = ctx.to_name || null;
  const s0 = String(ctx.subject || '');
  d.subject = /^(re|aw)\s*:/i.test(s0) ? s0 : ('Re: ' + s0);
  d.order_id = null; d.attachments = []; d.include_tracking = false;
  const missing = d.body ? [] : ['body'];
  try { await audit.fromReq(req, 'mail.chat_turn', 'mail', ctx.id, { turns: messages.length, reply: true, model: ai.model }); } catch (_) {}
  return res.json({ result: { ok: true, mode: 'email', reply: _str(out.reply, 600) || '', draft: d, questions: [], notes, missing,
    ready: !missing.length, attachments_avail: [], builders_avail: [], tracking_available: false, reply_to: true } });
}

// ─── Egy chat-kör (az orderChatTurn hívja e-mail módban; a kapu már lefutott) ───
async function mailTurn(req, res, a, messages, lang) {
  const cid = req.session.user.company_id;
  let prev = sanitizeMail(a.draft);
  const userText = messages.filter((m) => m.role === 'user').map((m) => m.text).join('\n');
  const last = messages[messages.length - 1].text;
  const refM = ORDER_REF_RE.exec(last) || (!prev.order_id ? ORDER_REF_RE.exec(userText) : null);
  const ref = refM ? refM[1] : prev.order_id;
  const base = { ok: true, mode: 'email', questions: [], notes: [], ready: false };
  if (prev.reply_mail_id) return replyTurn(req, res, messages, prev, lang);
  if (!ref) return generalTurn(req, res, messages, prev, lang);
  const o = await _findOrder(cid, ref);
  if (!o) {
    return res.json({ result: Object.assign(base, { reply: qt(lang, 'notFound', String(ref).toUpperCase()), draft: prev, missing: ['order'] }) });
  }
  if (prev.order_id && prev.order_id !== o.id) prev = sanitizeMail({ lang: prev.lang });
  const data = await _call(require('./orderEmail').getOrderEmailData, req, [{ order_id: o.id, lang }]);
  const ctx = {
    attachments: (data.ok && data.attachments) || [],
    builders: (data.ok && data.builder_templates) || [],
    tracking: !!(data.ok && data.tracking_available),
  };

  let ai;
  try {
    ai = await extractJson({ systemPrompt: buildMailPrompt(o, ctx), parts: [{ text: _conversation(messages, prev) }] });
  } catch (e) {
    const msg = e && e.code === 'NO_KEY' ? 'Serviciul AI nu este configurat.' : String((e && e.message) || 'Eroare AI').slice(0, 300);
    return res.json({ result: { ok: false, err: msg } });
  }
  const out = (ai && ai.json) || {};
  const d = sanitizeMail(Object.assign({}, out.draft || {}));
  if (!d.lang) d.lang = prev.lang || lang;
  const styleNotes = await applyStyleTurn(req, d, prev, out);
  const r = await resolveMail(cid, d, o, ctx, userText, lang);
  const aiQ = (Array.isArray(out.questions) ? out.questions : []).slice(0, 2).map((q) => ({
    key: _str(q && q.key, 20) || 'other', text: _str(q && q.text, 300),
    options: (Array.isArray(q && q.options) ? q.options : []).slice(0, 4).map((x) => _str(x, 80)).filter(Boolean),
  })).filter((q) => q.text);
  const seen = new Set(r.questions.map((q) => q.key));
  const questions = r.questions.concat(aiQ.filter((q) => !seen.has(q.key))).slice(0, 3);
  try { await audit.fromReq(req, 'mail.chat_turn', 'order', o.id, { turns: messages.length, ready: !r.missing.length, model: ai.model }); } catch (_) {}
  return res.json({ result: Object.assign(base, {
    reply: _str(out.reply, 600) || '', draft: r.draft, questions, notes: r.notes.concat(styleNotes), missing: r.missing,
    ready: r.missing.length === 0, attachments_avail: ctx.attachments, builders_avail: ctx.builders,
    tracking_available: ctx.tracking, client: o.client || '',
  }) });
}

// ─── Küldés (csak a felhasználó gombnyomására) ───
// args[0]: { draft, test }
handlers.mailChatSend = async function (req, res, args) {
  try {
    const gate = await require('./orderChat')._gate(req);
    if (gate) return res.json({ result: { ok: false, err: gate } });
    const a = (args && args[0]) || {};
    const lang = a.lang === 'hu' ? 'hu' : 'ro';
    const d = sanitizeMail(a.draft);
    const isTest = a.test === true;
    if (!isTest) {
      if (!d.to_email) return res.json({ result: { ok: false, err: 'E-mail invalid' } });
      const lim = sendLimiter.check(String(req.session.user.id || req.session.user.email));
      if (!lim.ok) return res.json({ result: { ok: false, err: qt(lang, 'rateLimit') } });
    }
    const cid = req.session.user.company_id;
    if (d.reply_mail_id) {
      const mb = require('./mailbox');
      const g2 = await mb._gate(req);
      if (g2) return res.json({ result: { ok: false, err: g2 } });
      // Válasz: a címzettet és a tárgyat a szerver adja (a levél feladója), nem a kliens.
      const r = await require('./mailbox')._sendReply(req, { id: d.reply_mail_id, body: d.body || '', style: d.style, test: isTest });
      return res.json({ result: r });
    }
    if (!d.order_id) return res.json({ result: await _sendGeneral(req, cid, d, isTest) });
    const o = await _findOrder(cid, d.order_id);
    if (!o) return res.json({ result: { ok: false, err: 'Comanda nu a fost găsită.' } });
    const r = await _call(require('./orderEmail').sendOrderEmail, req, [{
      order_id: o.id, to_email: d.to_email, subject: d.subject, body: d.body || '',
      attachments: d.attachments, include_tracking: d.include_tracking,
      builder_template_id: d.builder_template_id, test: isTest, style: d.style,
    }]);
    if (r.ok && !isTest) {
      // Tanulás: az ügyfélnek ténylegesen elküldött cím (ha a fuvarhoz kötött ügyfélnek nincs mentett címe).
      try {
        if (d.recipient === 'client' || d.recipient === 'other') {
          await memPut(cid, 'mail_pref', _prefKey(o), { to_email: d.to_email, lang: d.lang });
        }
      } catch (_) { /* best-effort */ }
      try { await audit.fromReq(req, 'mail.chat_send', 'order', o.id, { recipient: d.recipient, attachments: d.attachments.length }); } catch (_) {}
    }
    return res.json({ result: r });
  } catch (e) {
    console.error('mailChatSend hiba:', e && e.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Fuvar nélküli levél küldése: valós → a cég SAJÁT feladó-fiókja; teszt → közös cím a saját címre.
async function _sendGeneral(req, cid, d, isTest) {
  const u = req.session.user;
  const to = isTest ? String(u.email || '').trim() : d.to_email;
  if (!to || !EMAIL_RE.test(to)) return { ok: false, err: isTest ? 'Adresa dvs. de e-mail lipsește.' : 'E-mail invalid' };
  if (!d.body) return { ok: false, err: 'Mesaj gol.' };
  let senderName = 'VallorSoft', logoUrl = null;
  try {
    const c = await pool.query('SELECT nev FROM companies WHERE id=$1', [cid]);
    if (c.rows.length && c.rows[0].nev) senderName = c.rows[0].nev;
    const hl = await pool.query('SELECT 1 FROM company_branding WHERE company_id=$1 AND logo_base64 IS NOT NULL', [cid]);
    const base = appBaseUrl();
    if (hl.rows.length && base) logoUrl = base + '/branding/logo/' + cid + '.png';
  } catch (_) { /* best-effort */ }
  const esc = (x) => String(x).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]);
  const bodyHtml = '<div style="font-size:14px;line-height:1.6;white-space:pre-wrap;">' + esc(d.body) + '</div>';
  const subject = d.subject || '(fără subiect)';
  let result;
  if (isTest) {
    result = await emailSvc.sendClientEmail({ to, subject, html: bodyHtml, senderName, logoUrl, style: d.style, companyId: cid, mailType: 'chat_test' });
  } else {
    const mailer = await emailSvc.getCompanyMailer(cid);
    if (!mailer || !mailer.ok) {
      return { ok: false, err: (mailer && mailer.noConfig)
        ? 'Configurați contul de e-mail (SMTP) în Integrări înainte de a trimite către clienți.'
        : ((mailer && mailer.error) || 'Eroare la contul expeditor') };
    }
    result = await mailer.send({ to, subject, html: emailSvc.wrapBrandedEmail(bodyHtml, { logoUrl, senderName, style: d.style }), mailType: 'chat', sentBy: req.session && req.session.user && req.session.user.email });
  }
  if (!result || !result.ok) return { ok: false, err: (result && result.error) || 'Eroare la trimitere' };
  if (!isTest) {
    try { if (d.recipient === 'named' && d.recipient_name) await memPut(cid, 'mail_pref', 'name:' + _fold(d.recipient_name), { to_email: to, lang: d.lang }); } catch (_) {}
    try { await audit.fromReq(req, 'mail.chat_send', 'mail', null, { general: true }); } catch (_) {}
  }
  return { ok: true };
}

// ─── ⭐ Kinézet mentése alapértelmezettként / visszaállítás (gombról) ───
// args[0]: { draft, reset }
handlers.mailChatSaveStyle = async function (req, res, args) {
  try {
    const gate = await require('./orderChat')._gate(req);
    if (gate) return res.json({ result: { ok: false, err: gate } });
    const a = (args && args[0]) || {};
    const cid = req.session.user.company_id;
    if (a.reset === true) {
      await memDel(cid, 'mail_style', _styleKey(req));
      return res.json({ result: { ok: true, reset: true } });
    }
    const d = sanitizeMail(a.draft);
    let bid = d.builder_template_id;
    if (bid) {
      const b = await pool.query('SELECT 1 FROM email_builder_templates WHERE id=$1 AND company_id=$2', [bid, cid]);
      if (!b.rows.length) bid = null;
    }
    await memPut(cid, 'mail_style', _styleKey(req), { style: d.style, builder_template_id: bid || null });
    try { await audit.fromReq(req, 'mail.style_default', 'user', req.session.user.id, {}); } catch (_) {}
    return res.json({ result: { ok: true } });
  } catch (e) {
    console.error('mailChatSaveStyle hiba:', e && e.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Belső segédek (nem RPC): az orderChat hívja / a teszt eléri.
Object.defineProperty(handlers, 'mailTurn', { value: mailTurn, enumerable: false });
Object.defineProperty(handlers, 'isEmailIntent', { value: isEmailIntent, enumerable: false });
Object.defineProperty(handlers, '_sanitizeMail', { value: sanitizeMail, enumerable: false });
Object.defineProperty(handlers, '_sendLimiter', { value: sendLimiter, enumerable: false });

module.exports = handlers;
