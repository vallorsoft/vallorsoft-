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
const mailBody = require('../lib/mailBody');
const mailIntent = require('../lib/mailIntent');
const mailData = require('../lib/mailData');

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
  noName:    { ro: 'Nu găsesc „{c}" printre clienți / subcontractanți / contacte / șoferi. Scrie adresa de e-mail.', hu: 'Nem találom „{c}"-t az ügyfelek / alvállalkozók / kontaktok / sofőrök között. Írd be az e-mail címet.' },
  whichDriver: { ro: 'Mai mulți șoferi corespund. Care este?', hu: 'Több sofőr is illik rá. Melyik?' },
  tplUsed:   { ro: '🧠 Am folosit modelul învățat (fără AI): {c}.', hu: '🧠 A tanult minta alapján készült (AI nélkül): {c}.' },
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
    body: j.body == null ? null : String(j.body).slice(0, 12000),
    cards: mailData.sanitizeCards(j.cards),
    card_fields: mailData.sanitizeFields(j.card_fields),
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
    intent: mailIntent.sanitize(j.intent),
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

// ─── Közös prompt-részek: mit tud a rendszer, hogyan formáz, milyen adatot kérhet ───
const STYLE_SCHEMA = 'style: the visual look — object with ONLY the keys the dispatcher asks to change: '
  + '{"accent":"#rrggbb" (header band / lines / buttons / card frames),"bg":"#rrggbb" (outer background),"card":"#rrggbb" (letter background),'
  + '"text":"#rrggbb","title":"#rrggbb" (company-name color),"border":"#rrggbb" (frame around the whole letter),"border_width":"none|thin|normal|thick",'
  + '"radius":"none|small|large","logo_bg":"#rrggbb" (background chip behind the logo),'
  + '"header":"logo|band|name|logo_name|none" (logo = logo only; band = colored band with the logo; name = company name only, no logo; logo_name = logo + company name; none = no header),'
  + '"align":"left|center","font":"sans|serif|modern|mono","size":"small|normal|large","line":"tight|normal|loose","width":"narrow|normal|wide"}. '
  + 'Map color words to hex (blue/kék/albastru #2563eb, dark blue/sötétkék #1e3a8a, light blue/világoskék #dbeafe, green/zöld/verde #16a34a, red/piros/roșu #dc2626, '
  + 'orange/narancs #f6711e, yellow/sárga #facc15, purple/lila #7c3aed, black/fekete #111827, grey/szürke #6b7280, light grey #f3f4f6, white/fehér #ffffff). '
  + '"frame/keret/chenar around everything" → border (+border_width). Return the previous style unchanged if nothing about the look was asked.';

const BODY_SYNTAX = [
  'body: the e-mail text in THIS markup (never raw HTML): **bold**, *italic*, __underline__, ~~strike~~, lines starting with "# ", "## ", "### " = headings,',
  '"- " = bullet list, "1. " = numbered list, "> " = quote, "---" = separator line, [color=#rrggbb]text[/color], [bg=#rrggbb]text[/bg] (highlight),',
  '[size=small|normal|large|xl]text[/size], [font=sans|serif|modern|mono]text[/font], [center]…[/center], [right]…[/right],',
  '[box]…[/box] or [box color=#rrggbb]…[/box] (framed colored box), [btn url=https://…]Label[/btn] (button), [label](https://…) (link).',
  'Use formatting when the dispatcher asks for it (bold, colors, boxes, headings…). Plain text is also fine.',
].join('\n');

const CARDS_RULES = [
  'cards: transport-order cards that the SYSTEM inserts into the letter from the database (route, loading, unloading, cargo, vehicle, status…). Use them whenever the dispatcher wants order details in the letter.',
  '  Format: [{"ref":"CMD-2026-0050"}] or [{"latest":2}] (= the last 2 orders) or [{"query":{"driver":"name","vehicle":"plate","client":"name","status":"active|open|Finalizat","from":"YYYY-MM-DD","to":"YYYY-MM-DD"}}]',
  '  (= ALL matching orders, fetched live by the system — use this for "all orders of driver X / vehicle Y / client Z / in a period"; never list them one by one). Short numbers are fine ("050", "2026-049").',
  '  Many orders are shown as one compact table automatically.',
  '  NEVER write order data (dates, routes, weights, plates…) into the body yourself and NEVER write placeholders like "[details…]" — use cards. Put "{{cards}}" in the body where the cards should appear (default: at the end).',
  'card_fields: which rows the cards show, from ["route","loading","unloading","cargo","vehicle","status","price","km","ref","client"]; null = default (route, loading, unloading, cargo, vehicle, status). Add "price" only if asked.',
].join('\n');

const DATA_TOOLS = [
  'data_requests: if you NEED facts from the company system to answer or to write the letter, ask for them here — ONLY what this request needs:',
  '  {"type":"orders","latest":N} | {"type":"orders","refs":["050","2026-049"]} | {"type":"orders","driver":"driver name","vehicle":"plate","client":"name","status":"active|open|Finalizat|Alocat|In Curs","from":"YYYY-MM-DD","to":"YYYY-MM-DD"}',
  '    driver = one of OUR drivers by name (the system resolves it); "active" = assigned / in progress; no from/to = the WHOLE history (all matching orders). The answer has orders_summary (total count, date range, card_query) — put card_query into cards as {"query":…} to include ALL of them.',
  '  {"type":"order_stats","from":"YYYY-MM-DD","to":"YYYY-MM-DD"} (counts, revenue EUR, km)   {"type":"client","name":"…"} (company data, order count)',
  '  {"type":"invoices","client":"…","order":"…","unpaid":true}   {"type":"sent_mails","latest":1,"to":"name or address part"} (our previously SENT e-mails: id, subject, text)',
  '  {"type":"company"} (our own company: name, CUI, address, IBAN, bank — e.g. for payment details)   {"type":"vehicles"} (our fleet plates/types)',
  '  The system then calls you again with the DATA. Do not guess — request. If DATA is already given below, use it and return "data_requests": [].',
  'restore_sent_id: the id of a previously SENT e-mail (from DATA sent_mails, "restorable": true) when the dispatcher wants to resend / reuse it — the system loads its exact text, cards and look into the draft. null otherwise.',
].join('\n');

const HONESTY = [
  'You CAN: write/rewrite the text with the markup above, change the look via "style", insert order cards, ask for company data, reload a sent e-mail.',
  'You CANNOT: see received e-mails, attach files that are not offered, use images other than the company logo, animations, or send anything (the dispatcher presses Send).',
  'If something is not possible, say so briefly in "reply" and offer the closest alternative. NEVER claim a change you did not put into the JSON — the system itself reports what actually changed.',
  '"reply" = 1-2 short sentences to the dispatcher in THEIR language (Hungarian if they write Hungarian).',
].join('\n');

const COMMON_RULES = [BODY_SYNTAX, CARDS_RULES, STYLE_SCHEMA, DATA_TOOLS, HONESTY,
  'Top-level "save_default": true ONLY when the dispatcher asks to keep this look as their default ("mentsd el alapértelmezettnek", "mindig ilyen legyen", "salvează ca implicit"); "reset_default": true to go back to the original look.',
].join('\n');

function buildGeneralPrompt() {
  return [
    'You write business e-mails for a Romanian/Hungarian road-freight company (TMS). The dispatcher tells you in free text what e-mail to write (offer, information, reminder, thanks, references, order overviews, anything).',
    'Maintain an e-mail DRAFT across the conversation; merge each new message into the previous draft (keep values unless changed).',
    'recipient: "other" if the dispatcher writes an e-mail address (put it in to_email); otherwise "named" with recipient_name = the company or person name exactly as written (the system looks it up among clients, subcontractors, contacts AND our own drivers — e.g. "send it to driver X" → recipient_name "X"). Keep the previous recipient if not changed; null if never mentioned.',
    'lang: "ro" by default, "hu" if the dispatcher asks for Hungarian or the recipient is Hungarian.',
    'Write a professional e-mail (greeting, the message, closing without a person name). Never invent prices, dates or facts — request DATA or use cards.',
    COMMON_RULES,
    'Return ONLY JSON: {"reply":"","save_default":false,"reset_default":false,"data_requests":[],"restore_sent_id":null,"draft":{"style":null,"recipient":null,"recipient_name":null,"to_email":null,"lang":"ro","subject":"","body":"","cards":[],"card_fields":null},"questions":[{"key":"recipient|other","text":"short question","options":["up to 4 answers"]}]}',
    'Ask a question only if really unclear; otherwise "questions": [].',
  ].join('\n');
}

function buildMailPrompt(o, ctx) {
  return [
    'You write business e-mails for a Romanian/Hungarian road-freight company (TMS). The dispatcher tells you in free text what e-mail to send about ONE transport order (more orders can be added as cards).',
    'Maintain an e-mail DRAFT across the conversation; merge each new message into the previous draft (keep values unless changed). Corrections like "more polite", "in Hungarian", "remove the CMR" update only those parts.',
    'ORDER: ' + JSON.stringify({ number: o.fuvar_no, client: o.client, route: [o.loc_incarcare, o.loc_descarcare].filter(Boolean).join(' → '),
      loading_date: o.data_incarcare, unloading_date: o.data_descarcare, status: o.status, reference: o.ref, subcontractor: o.carrier_nev || null }),
    'SAVED VISUAL TEMPLATES (optional, by id): ' + JSON.stringify(ctx.builders.map((b) => ({ id: b.id, name: b.name }))),
    'Tracking link available: ' + (ctx.tracking ? 'yes' : 'no') + '.',
    'recipient: "client" (the customer who ordered/pays — default for invoices, status, tracking), "carrier" (the subcontractor — order confirmation), or "other" only if the dispatcher writes an e-mail address; then put that address in to_email.',
    'lang: "ro" by default, "hu" if the dispatcher asks for Hungarian or the customer is Hungarian.',
    'Write a professional e-mail (greeting, the content, closing without a person name). Mention the order number. Do NOT paste the tracking URL yourself — set include_tracking=true. Never invent prices, dates or facts.',
    'You have NO access to documents or attachments (not even their names) — the server attaches them. Never list file names or invent document details.',
    COMMON_RULES,
    'Return ONLY JSON: {"reply":"","save_default":false,"reset_default":false,"data_requests":[],"restore_sent_id":null,"draft":{"style":null,"recipient":null,"to_email":null,"lang":"ro","subject":"","body":"","cards":[],"card_fields":null,"include_tracking":false,"builder_template_id":null},"questions":[{"key":"recipient|other","text":"short question","options":["up to 4 answers"]}]}',
    'Ask a question only if really unclear; otherwise "questions": [].',
  ].join('\n');
}

function _conversation(messages, prev) {
  const v = { style: prev.style, recipient: prev.recipient, recipient_name: prev.recipient_name, to_email: prev.recipient === 'other' ? prev.to_email : null, lang: prev.lang,
    subject: prev.subject, body: prev.body, cards: prev.cards, card_fields: prev.card_fields, include_tracking: prev.include_tracking,
    builder_template_id: prev.builder_template_id };
  const lines = ['PREVIOUS DRAFT (JSON):', JSON.stringify(v), '', 'CONVERSATION:'];
  messages.forEach((m) => lines.push((m.role === 'assistant' ? 'ASSISTANT: ' : 'DISPATCHER: ') + m.text));
  lines.push('', 'Today: ' + new Date().toISOString().slice(0, 10) + '. Update the e-mail draft with the LAST dispatcher message and answer.');
  return lines.join('\n');
}

// ─── Csatolmány-választás AI NÉLKÜL ───
// A dokumentumokhoz (tartalom, fájlnév) az AI egyáltalán nem fér hozzá. A
// felhasználó utolsó üzenetéből kulcsszavakkal döntünk; a korábbi választás
// megmarad, a „nélkül / fără / vedd ki" a megnevezett fajtát eltávolítja.
const ATT_RULES = [
  { re: /\b(szamla\w*|factur\w*|invoice\w*)/, match: (a) => a.kind === 'invoice' },
  { re: /\b(cmr\w*|alairt\w*|semnat\w*|stampil\w*|pecset\w*|signed)/, match: (a, all) => a.kind === 'doc' && (/-signed$/.test(a.key) || !all.some((x) => x.kind === 'doc' && /-signed$/.test(x.key))) },
  { re: /\b(dokumentum\w*|document\w*|megrendelo\w*|comand\w*|contract\w*|szerzodes\w*)/, match: (a) => a.kind === 'doc' && /-original$/.test(a.key) },
  { re: /\b(foto\w*|poz[ae]\w*|kep\w*|pod|photo\w*)/, match: (a) => a.kind === 'photo' },
];
const ATT_ALL_RE = /\b(minden|osszes|toate|all)\b.{0,25}\b(csatolmany\w*|dokumentum\w*|documentel\w*|atasament\w*|attachment\w*)/;
const ATT_DEL_RE = /\b(nelkul|fara|vedd ki|torold|scoate|elimina|remove|without|ne csatold|nu atasa)/;
function pickAttachments(avail, prevKeys, text) {
  const allow = new Set(avail.map((a) => a.key));
  let keys = (prevKeys || []).filter((k) => allow.has(k));
  const f = _fold(text);
  const del = ATT_DEL_RE.test(f);
  let hit = ATT_ALL_RE.test(f) ? avail.slice() : [];
  ATT_RULES.forEach((r) => { if (r.re.test(f)) hit = hit.concat(avail.filter((a) => r.match(a, avail))); });
  const hk = Array.from(new Set(hit.map((a) => a.key)));
  if (del) keys = keys.filter((k) => !hk.includes(k));
  else hk.forEach((k) => { if (!keys.includes(k)) keys.push(k); });
  return keys.slice(0, MAX_ATT);
}

// Címzett + csatolmány + sablon feloldása a szerveren.
async function resolveMail(cid, d, o, ctx, userText, lang) {
  const questions = []; const notes = []; const missing = [];
  d.order_id = o.id; d.fuvar_no = o.fuvar_no;
  // A csatolmányt az AI NEM látja és NEM választja: a szerver dönt kulcsszó alapján.
  d.attachments = pickAttachments(ctx.attachments, d.prev_attachments || [], d.att_text != null ? d.att_text : userText);
  delete d.prev_attachments; delete d.att_text;
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
  // A cég SAJÁT sofőrjei (pl. „küldd el Gondos Imrének a fuvarjait") — névtag / ékezet / rag-tűrő.
  try {
    const dr = await mailData.resolveDriver(cid, name);
    const ems = dr.emails.length ? dr.emails : [];
    if (ems.length) add((await pool.query(`SELECT nume AS name, email FROM users WHERE company_id=$1 AND pozicio='Sofer' AND LOWER(email)=ANY($2)`, [cid, ems])).rows, 'driver');
    else if (dr.ambiguous.length) add((await pool.query(`SELECT nume AS name, email FROM users WHERE company_id=$1 AND pozicio='Sofer' AND nume=ANY($2)`, [cid, dr.ambiguous])).rows, 'driver');
  } catch (_) {}
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

// ─── AI-kör adat-kérésekkel: ha az AI adatot kér a cég rendszeréből, a szerver
//     CSAK azt kéri le (company_id-szűrt, csak-olvasó), és újrahívja az AI-t
//     az adatokkal. Beérkezett levél tartalma soha nem kerül bele.
async function _runAi(cid, systemPrompt, convText, pre) {
  let labels = [];
  if (pre && pre.json) {
    // A szerver már felismerte, mire van szükség → az adat az ELSŐ hívással megy (egy AI-kör spórolva).
    convText += '\n\nDATA FROM THE COMPANY SYSTEM (already fetched for this request — use it; request more only if really needed):\n' + pre.json;
    labels = pre.labels || [];
  }
  let ai = await extractJson({ systemPrompt, parts: [{ text: convText }] });
  let out = (ai && ai.json) || {};
  const reqs = mailData.sanitizeRequests(out.data_requests);
  if (reqs.length) {
    const fetched = await mailData.fetchData(cid, reqs);
    labels = labels.concat(fetched.labels);
    const text2 = convText + '\n\nDATA FROM THE COMPANY SYSTEM (only what you requested; use it, do not request more):\n' + fetched.json;
    ai = await extractJson({ systemPrompt, parts: [{ text: text2 }] });
    out = (ai && ai.json) || {};
  }
  return { out, model: ai && ai.model, labels };
}

function _aiErr(res, e) {
  const msg = e && e.code === 'NO_KEY' ? 'Serviciul AI nu este configurat.' : String((e && e.message) || 'Eroare AI').slice(0, 300);
  return res.json({ result: { ok: false, err: msg } });
}

// „Küldjük újra" — egy korábban ELKÜLDÖTT saját levél vázlatának visszatöltése (cégre szűrt).
async function _restoreSent(cid, id, d) {
  const sid = parseInt(id, 10);
  if (!sid) return false;
  let row;
  try { row = (await pool.query('SELECT subject, body_text, draft_json FROM mail_sent WHERE id=$1 AND company_id=$2', [sid, cid])).rows[0]; } catch (_) { return false; }
  if (!row) return false;
  const old = row.draft_json ? sanitizeMail(row.draft_json) : null;
  d.subject = (old && old.subject) || row.subject || d.subject;
  d.body = (old && old.body) || row.body_text || d.body;
  if (old && old.cards && old.cards.length) d.cards = old.cards;
  if (old && old.card_fields) d.card_fields = old.card_fields;
  if (old && old.style && !d.style) d.style = old.style;
  return true;
}

const T2 = {
  subject: { ro: 'Subiect: „{v}"', hu: 'Tárgy: „{v}"' },
  body: { ro: 'Textul scrisorii a fost actualizat', hu: 'A levél szövege frissült' },
  to: { ro: 'Destinatar: {v}', hu: 'Címzett: {v}' },
  cardsAdd: { ro: 'Carduri curse adăugate: {v}', hu: 'Fuvarkártya bekerült: {v}' },
  cardsDel: { ro: 'Carduri curse eliminate: {v}', hu: 'Fuvarkártya kivéve: {v}' },
  drvAmb: { ro: '„{v}" se potrivește cu mai mulți șoferi', hu: '„{v}" több sofőrre is illik' },
  queryEmpty: { ro: 'Nicio cursă pentru: {v}', hu: 'Nincs fuvar erre: {v}' },
  fields: { ro: 'Rânduri pe carduri: {v}', hu: 'Kártya-sorok: {v}' },
  look: { ro: 'Aspect: {v}', hu: 'Kinézet: {v}' },
  restored: { ro: 'Am reîncărcat e-mailul trimis anterior', hu: 'Visszatöltöttem a korábban elküldött levelet' },
  data: { ro: 'Date citite din sistem: {v}', hu: 'Adat a rendszerből: {v}' },
  ph: { ro: 'Text incomplet în scrisoare: {v} — nu se poate trimite așa', hu: 'Félkész rész a levélben: {v} — így nem küldhető' },
  cardMissing: { ro: 'Nu găsesc cursa {v}', hu: 'Nem találom a(z) {v} fuvart' },
  cardAmb: { ro: '„{v}" se potrivește cu mai multe curse', hu: '„{v}" több fuvarra is illik' },
  nothing: { ro: 'Nu s-a schimbat nimic în scrisoare. Formulează altfel, sau spune-mi ce lipsește.', hu: 'A levélben nem változott semmi. Fogalmazd meg másképp, vagy írd le, mi hiányzik.' },
};
function t2(lang, k, v) { const e = T2[k] || {}; return String(e[lang === 'hu' ? 'hu' : 'ro'] || '').replace('{v}', v == null ? '' : String(v)); }
const STYLE_WORDS = {
  accent: { ro: 'culoare accent', hu: 'kiemelő szín' }, bg: { ro: 'fundal', hu: 'háttér' }, card: { ro: 'fundal scrisoare', hu: 'levél háttere' },
  text: { ro: 'culoare text', hu: 'szövegszín' }, title: { ro: 'culoare nume firmă', hu: 'cégnév színe' }, border: { ro: 'chenar', hu: 'keret' },
  border_width: { ro: 'grosime chenar', hu: 'keret vastagsága' }, radius: { ro: 'colțuri', hu: 'sarkok' }, logo_bg: { ro: 'fundal logo', hu: 'logó háttere' },
  header: { ro: 'antet', hu: 'fejléc' }, align: { ro: 'aliniere', hu: 'igazítás' }, font: { ro: 'font', hu: 'betűtípus' },
  size: { ro: 'mărime text', hu: 'betűméret' }, line: { ro: 'spațiere', hu: 'sorköz' }, width: { ro: 'lățime', hu: 'szélesség' },
};
const DATA_WORDS = { orders: { ro: 'curse', hu: 'fuvar' }, stats: { ro: 'statistici', hu: 'statisztika' }, client: { ro: 'client', hu: 'ügyfél' },
  invoices: { ro: 'facturi', hu: 'számla' }, sent: { ro: 'e-mail trimis', hu: 'elküldött levél' }, company: { ro: 'date firmă', hu: 'cégadatok' }, vehicles: { ro: 'vehicule', hu: 'jármű' } };

// A ténylegesen megtörtént változások — ezt a SZERVER írja, nem az AI.
function _changes(prev, d, lang, extra) {
  const L = lang === 'hu' ? 'hu' : 'ro';
  const out = [];
  if (extra.restored) out.push(t2(L, 'restored'));
  if (d.to_email && d.to_email !== prev.to_email) out.push(t2(L, 'to', d.to_email));
  if (d.subject && d.subject !== prev.subject) out.push(t2(L, 'subject', d.subject));
  if ((d.body || '') !== (prev.body || '') && d.body) out.push(t2(L, 'body'));
  const lab = (c) => (c.query ? '🔎 ' + mailData.queryLabel(c.query, L) : c.ref);
  const pk = (prev.cards || []).map(mailData.cardKey), nk = (d.cards || []).map(mailData.cardKey);
  const nr = nk;
  const add = (d.cards || []).filter((c) => !pk.includes(mailData.cardKey(c))).map(lab);
  const del = (prev.cards || []).filter((c) => !nk.includes(mailData.cardKey(c))).map(lab);
  if (add.length) out.push(t2(L, 'cardsAdd', add.join(', ')));
  if (del.length) out.push(t2(L, 'cardsDel', del.join(', ')));
  if (JSON.stringify(prev.card_fields || null) !== JSON.stringify(d.card_fields || null) && nr.length) out.push(t2(L, 'fields', (d.card_fields || mailData.DEFAULT_FIELDS).join(', ')));
  const ps = prev.style || {}, ns = d.style || {};
  const sk = Array.from(new Set(Object.keys(ps).concat(Object.keys(ns)))).filter((k) => ps[k] !== ns[k]);
  if (sk.length) out.push(t2(L, 'look', sk.map((k) => ((STYLE_WORDS[k] || {})[L] || k) + (ns[k] ? ' = ' + ns[k] : ' ✕')).join(', ')));
  if (extra.labels && extra.labels.length) out.push(t2(L, 'data', extra.labels.map((x) => (x.n != null ? x.n + ' ' : '') + ((DATA_WORDS[x.k] || {})[L] || x.k)).join(', ')));
  (extra.cardNotes || []).forEach((n) => out.push(
    n.type === 'driver_ambiguous' ? '⚠️ ' + t2(L, 'drvAmb', n.ref) + ': ' + n.options.join(', ')
      : n.type === 'card_ambiguous' ? '⚠️ ' + t2(L, 'cardAmb', n.ref) + ': ' + n.options.join(', ')
      : n.type === 'query_empty' ? '⚠️ ' + t2(L, 'queryEmpty', n.ref) : '⚠️ ' + t2(L, 'cardMissing', n.ref)));
  return out;
}
const CLAIM_RE = /(frissít|hozzáad|beállít|módosít|átír|elkészít|betett|beraktam|kivettem|eltávolít|megváltoztat|actualiz|am adăugat|am adaugat|am setat|am modificat|am schimbat|am eliminat|i (have )?(updated|added|changed|removed))/i;

// Kártyák feloldása + félkész rész-ellenőrzés + változás-lista + előnézet.
async function _finish(req, d, prev, out, extra) {
  const cid = req.session.user.company_id;
  const lang = d.lang || 'ro';
  const ex = await mailData.expandCards(cid, d.cards || []);
  d.cards = ex.cards;
  const changes = _changes(prev, d, lang, { restored: extra.restored, labels: extra.labels, cardNotes: ex.notes });
  const ph = mailBody.findPlaceholders(d.body || '');
  let reply = _str(out.reply, 600) || '';
  // Az AI nem állíthat olyan változást, ami nem történt meg.
  if (!changes.length && !extra.styleNotes.length && CLAIM_RE.test(reply)) reply = t2(lang, 'nothing');
  if (ph.length) changes.push('⛔ ' + t2(lang, 'ph', ph.join(' · ')));
  const previewHtml = await _previewHtml(req, d).catch(() => '');
  return { reply, changes, placeholders: ph, previewHtml };
}

// Előnézet = PONTOSAN az, ami kimegy (valódi logó, cégnév, kártyák, lábléc).
async function _brand(cid, relative) {
  let senderName = 'VallorSoft', logoUrl = null;
  try {
    const c = await pool.query('SELECT nev FROM companies WHERE id=$1', [cid]);
    if (c.rows.length && c.rows[0].nev) senderName = c.rows[0].nev;
    const hl = await pool.query('SELECT 1 FROM company_branding WHERE company_id=$1 AND logo_base64 IS NOT NULL', [cid]);
    if (hl.rows.length) {
      if (relative) logoUrl = '/branding/logo/' + cid + '.png';
      else { const base = appBaseUrl(); if (base) logoUrl = base + '/branding/logo/' + cid + '.png'; }
    }
  } catch (_) { /* best-effort */ }
  return { senderName, logoUrl };
}
async function _bodyHtml(cid, d) {
  const accent = (d.style && d.style.accent) || '#2563eb';
  const cardsHtml = await mailData.renderCards(cid, d.cards || [], { lang: d.lang, fields: d.card_fields, accent });
  return mailBody.render(d.body || '', { accent: d.style && d.style.accent, cardsHtml });
}
async function _previewHtml(req, d) {
  if (d.builder_template_id) return '';
  const cid = req.session.user.company_id;
  const b = await _brand(cid, true);
  let inner = await _bodyHtml(cid, d);
  if (d.include_tracking) inner += '<p style="margin-top:14px;">🌍 <a href="#">' + mailBody.esc(d.lang === 'hu' ? 'Fuvarkövetés' : 'Urmărire transport') + '</a></p>';
  const html = emailSvc.wrapBrandedEmail(inner, { logoUrl: b.logoUrl, senderName: b.senderName, style: d.style });
  return emailSvc.appendCompanyFooter(html, cid);
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
  const lastText = messages[messages.length - 1].text;
  // 1) Determinisztikus felismerés (sofőr / jármű / státusz / időszak) — AI nélkül.
  let it = null;
  try { it = await mailIntent.parse(cid, lastText); } catch (_) { it = null; }
  if (it && !it.driver && it.driver_ambiguous && !it.vehicle) {
    return res.json({ result: { ok: true, mode: 'email', reply: qt(lang, 'whichDriver'), changes: [], draft: prev, notes: [], missing: ['driver'], ready: false,
      questions: [{ key: 'other', text: qt(lang, 'whichDriver'), options: it.driver_ambiguous }], attachments_avail: [], builders_avail: [], tracking_available: false } });
  }
  const q = it && (it.driver || it.vehicle) ? mailIntent.toQuery(it) : null;
  // 2) Tanult sablon: ugyanilyen jellegű levél már ment ki, és a kérésben nincs más utasítás → AI nélkül.
  if (q && !prev.body && !(it.residual || []).length) {
    let tpl = null;
    try { tpl = await mailIntent.getTemplate(cid, it, prev.lang || lang); } catch (_) { tpl = null; }
    if (tpl && tpl.subject && tpl.body) {
      const L = prev.lang || lang;
      const f = mailIntent.fillTemplate(tpl, it, L);
      const d = sanitizeMail(Object.assign({}, prev, { lang: L, subject: f.subject, body: f.body, card_fields: f.card_fields, cards: [{ query: q }],
        recipient: f.recipient_name ? 'named' : prev.recipient, recipient_name: f.recipient_name || prev.recipient_name, intent: Object.assign({}, it, { tpl: true }) }));
      d.intent = mailIntent.sanitize(Object.assign({}, it, { tpl: true }));
      const styleNotes = await applyStyleTurn(req, d, prev, {});
      const r = await resolveGeneral(cid, d, prev, userText, lang);
      const fin = await _finish(req, r.draft, prev, { reply: '' }, { restored: false, labels: [], styleNotes });
      if (fin.placeholders.length) r.missing.push('placeholder');
      try { await audit.fromReq(req, 'mail.chat_turn', 'mail', null, { turns: messages.length, ready: !r.missing.length, model: 'learned', general: true }); } catch (_) {}
      return res.json({ result: { ok: true, mode: 'email', reply: qt(L, 'tplUsed', mailData.queryLabel(q, L)), changes: fin.changes, preview_html: fin.previewHtml,
        placeholders: fin.placeholders, draft: r.draft, questions: r.questions, notes: styleNotes, missing: r.missing, ready: r.missing.length === 0,
        attachments_avail: [], builders_avail: [], tracking_available: false, learned: true } });
    }
  }
  // 3) AI — az adatot a szerver előre lekéri, így egy AI-kör elég.
  let pre = null;
  if (q) { try { pre = await mailData.fetchData(cid, mailData.sanitizeRequests([Object.assign({ type: 'orders' }, q)])); } catch (_) { pre = null; } }
  let ai;
  try { ai = await _runAi(cid, buildGeneralPrompt(), _conversation(messages, prev), pre); } catch (e) { return _aiErr(res, e); }
  const out = ai.out;
  const d = sanitizeMail(Object.assign({}, out.draft || {}));
  if (!d.lang) d.lang = prev.lang || lang;
  if (q) {
    // A felismert lekérdezés MINDEN fuvart hozza: ha az AI csak néhányat sorolt fel, élő lekérdezésre cseréljük.
    const hasQuery = (d.cards || []).some((c) => c.query);
    if (!hasQuery) d.cards = [{ query: q }];
    d.intent = mailIntent.sanitize(it);
    const fl = mailIntent.fold(lastText);
    // „neki / lui / him" vagy ragozott név („Imrének") → a címzett maga a sofőr.
    const dat = it.driver && mailIntent.fold(it.driver).split(' ').some((t) => t.length >= 3 && new RegExp('\\b' + t + '\\w{0,2}(nek|nak)\\b').test(fl));
    if (!d.recipient && it.driver && (dat || /\b(neki|lui|him)\b/.test(fl))) { d.recipient = 'named'; d.recipient_name = it.driver; }
    // „részletesen / detaliat" → bővebb kártya-mezők.
    if (!d.card_fields && /\b(reszletes\w*|detaliat\w*|detalii|detailed|full details|minden adat\w*)\b/.test(fl)) d.card_fields = ['route', 'loading', 'unloading', 'cargo', 'vehicle', 'status', 'ref', 'km', 'client'];
  } else {
    d.intent = prev.intent;
    // Követő kör (pl. „udvariasabban"): az élő lekérdezés-kártya marad, ha az AI kihagyta, de a szövegben még ott a helye.
    if (!(d.cards || []).length && (prev.cards || []).some((c) => c.query) && /\{\{cards\}\}/.test(d.body || '')) d.cards = prev.cards;
  }
  const restored = await _restoreSent(cid, out.restore_sent_id, d);
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
  const fin = await _finish(req, r.draft, prev, out, { restored, labels: ai.labels, styleNotes });
  if (fin.placeholders.length) r.missing.push('placeholder');
  const seen = new Set(r.questions.map((q) => q.key));
  const questions = r.questions.concat(_aiQuestions(out).filter((q) => !seen.has(q.key))).slice(0, 3);
  try { await audit.fromReq(req, 'mail.chat_turn', 'mail', null, { turns: messages.length, ready: !r.missing.length, model: ai.model, general: true, data: ai.labels.map((x) => x.k) }); } catch (_) {}
  return res.json({ result: { ok: true, mode: 'email', reply: fin.reply, changes: fin.changes, preview_html: fin.previewHtml, placeholders: fin.placeholders, draft: r.draft, questions,
    notes: styleNotes, missing: r.missing, ready: r.missing.length === 0, attachments_avail: [], builders_avail: [], tracking_available: false } });
}

// ─── ↩️ Válasz egy megnyitott levélre. Az AI a levelet NEM látja (se feladót,
//     se tárgyat, se szöveget) — csak a felhasználó chatben írt szövegéből dolgozik.
//     Címzett + tárgy a szerveren (mailbox._replyContext), csak az előnézetbe kerül.
function buildReplyPrompt() {
  return [
    'You write a REPLY e-mail body for a Romanian/Hungarian road-freight company. You do NOT see the e-mail being answered — write ONLY from what the dispatcher tells you (and from company DATA you request). Never invent facts, prices, dates or names.',
    'Maintain the reply DRAFT across the conversation; merge each new message into the previous draft.',
    'Write a professional reply (greeting, the content, closing without a person name). lang: "ro" by default, "hu" if asked.',
    COMMON_RULES,
    'Return ONLY JSON: {"reply":"","save_default":false,"reset_default":false,"data_requests":[],"restore_sent_id":null,"draft":{"style":null,"lang":"ro","body":"","cards":[],"card_fields":null},"questions":[]}',
  ].join('\n');
}
async function replyTurn(req, res, messages, prev, lang) {
  const ctx = await require('./mailbox')._replyContext(req, prev.reply_mail_id);
  if (!ctx) return res.json({ result: { ok: false, err: 'E-mailul nu a fost găsit.' } });
  let ai;
  const cid = req.session.user.company_id;
  try {
    const v = { style: prev.style, lang: prev.lang, body: prev.body, cards: prev.cards, card_fields: prev.card_fields };
    const lines = ['PREVIOUS DRAFT (JSON):', JSON.stringify(v), '', 'CONVERSATION:'];
    messages.forEach((m) => lines.push((m.role === 'assistant' ? 'ASSISTANT: ' : 'DISPATCHER: ') + m.text));
    lines.push('', 'Today: ' + new Date().toISOString().slice(0, 10) + '.');
    ai = await _runAi(cid, buildReplyPrompt(), lines.join('\n'));
  } catch (e) { return _aiErr(res, e); }
  const out = ai.out;
  const d = sanitizeMail(Object.assign({}, out.draft || {}));
  if (!d.lang) d.lang = prev.lang || lang;
  const restored = await _restoreSent(cid, out.restore_sent_id, d);
  const notes = await applyStyleTurn(req, d, prev, out);
  d.reply_mail_id = ctx.id; d.recipient = 'other'; d.to_email = ctx.to_email; d.recipient_name = ctx.to_name || null;
  const s0 = String(ctx.subject || '');
  d.subject = /^(re|aw)\s*:/i.test(s0) ? s0 : ('Re: ' + s0);
  d.order_id = null; d.attachments = []; d.include_tracking = false;
  const missing = d.body ? [] : ['body'];
  const fin = await _finish(req, d, prev, out, { restored, labels: ai.labels, styleNotes: notes });
  if (fin.placeholders.length) missing.push('placeholder');
  try { await audit.fromReq(req, 'mail.chat_turn', 'mail', ctx.id, { turns: messages.length, reply: true, model: ai.model }); } catch (_) {}
  return res.json({ result: { ok: true, mode: 'email', reply: fin.reply, changes: fin.changes, preview_html: fin.previewHtml, placeholders: fin.placeholders, draft: d, questions: [], notes, missing,
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
  try { ai = await _runAi(cid, buildMailPrompt(o, ctx), _conversation(messages, prev)); } catch (e) { return _aiErr(res, e); }
  const out = ai.out;
  const d = sanitizeMail(Object.assign({}, out.draft || {}));
  if (!d.lang) d.lang = prev.lang || lang;
  const restored = await _restoreSent(cid, out.restore_sent_id, d);
  const styleNotes = await applyStyleTurn(req, d, prev, out);
  d.prev_attachments = prev.attachments || [];
  d.att_text = (messages.filter((m) => m.role === 'user').pop() || {}).text || '';
  const r = await resolveMail(cid, d, o, ctx, userText, lang);
  const fin = await _finish(req, r.draft, prev, out, { restored, labels: ai.labels, styleNotes });
  if (fin.placeholders.length) r.missing.push('placeholder');
  const aiQ = (Array.isArray(out.questions) ? out.questions : []).slice(0, 2).map((q) => ({
    key: _str(q && q.key, 20) || 'other', text: _str(q && q.text, 300),
    options: (Array.isArray(q && q.options) ? q.options : []).slice(0, 4).map((x) => _str(x, 80)).filter(Boolean),
  })).filter((q) => q.text);
  const seen = new Set(r.questions.map((q) => q.key));
  const questions = r.questions.concat(aiQ.filter((q) => !seen.has(q.key))).slice(0, 3);
  try { await audit.fromReq(req, 'mail.chat_turn', 'order', o.id, { turns: messages.length, ready: !r.missing.length, model: ai.model }); } catch (_) {}
  return res.json({ result: Object.assign(base, {
    reply: fin.reply, changes: fin.changes, preview_html: fin.previewHtml, placeholders: fin.placeholders,
    draft: r.draft, questions, notes: r.notes.concat(styleNotes), missing: r.missing,
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
    // Félkész rész (helykitöltő) a levélben → valódi küldés tiltva (teszt mehet).
    const ph = mailBody.findPlaceholders(d.body || '');
    if (!isTest && ph.length) {
      return res.json({ result: { ok: false, err: (lang === 'hu' ? 'A levélben félkész rész van, így nem küldhető: ' : 'Scrisoarea conține text incomplet, nu se poate trimite: ') + ph.join(' · ') } });
    }
    d.cards = (await mailData.expandCards(cid, d.cards || [])).cards;
    if (d.reply_mail_id) {
      const mb = require('./mailbox');
      const g2 = await mb._gate(req);
      if (g2) return res.json({ result: { ok: false, err: g2 } });
      // Válasz: a címzettet és a tárgyat a szerver adja (a levél feladója), nem a kliens.
      const r = await require('./mailbox')._sendReply(req, { id: d.reply_mail_id, body: d.body || '', style: d.style, test: isTest,
        markup: true, cards: d.cards, card_fields: d.card_fields, record_draft: _recordable(d) });
      return res.json({ result: r });
    }
    if (!d.order_id) return res.json({ result: await _sendGeneral(req, cid, d, isTest) });
    const o = await _findOrder(cid, d.order_id);
    if (!o) return res.json({ result: { ok: false, err: 'Comanda nu a fost găsită.' } });
    const r = await _call(require('./orderEmail').sendOrderEmail, req, [{
      order_id: o.id, to_email: d.to_email, subject: d.subject, body: d.body || '',
      attachments: d.attachments, include_tracking: d.include_tracking,
      builder_template_id: d.builder_template_id, test: isTest, style: d.style,
      body_markup: true, cards: d.cards, card_fields: d.card_fields, record_draft: _recordable(d), lang: d.lang,
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

// Az elküldött levél szerkeszthető vázlata (újraküldéshez) — csak tartalom + kinézet.
function _recordable(d) {
  return { subject: d.subject, body: d.body, cards: d.cards, card_fields: d.card_fields, style: d.style, lang: d.lang };
}

// Fuvar nélküli levél küldése: valós → a cég SAJÁT feladó-fiókja; teszt → közös cím a saját címre.
async function _sendGeneral(req, cid, d, isTest) {
  const u = req.session.user;
  const to = isTest ? String(u.email || '').trim() : d.to_email;
  if (!to || !EMAIL_RE.test(to)) return { ok: false, err: isTest ? 'Adresa dvs. de e-mail lipsește.' : 'E-mail invalid' };
  if (!d.body) return { ok: false, err: 'Mesaj gol.' };
  const { senderName, logoUrl } = await _brand(cid, false);
  const bodyHtml = await _bodyHtml(cid, d);
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
    result = await mailer.send({ to, subject, html: emailSvc.wrapBrandedEmail(bodyHtml, { logoUrl, senderName, style: d.style }), mailType: 'chat', sentBy: req.session && req.session.user && req.session.user.email, draft: _recordable(d) });
  }
  if (!result || !result.ok) return { ok: false, err: (result && result.error) || 'Eroare la trimitere' };
  if (!isTest) {
    try { if (d.recipient === 'named' && d.recipient_name) await memPut(cid, 'mail_pref', 'name:' + _fold(d.recipient_name), { to_email: to, lang: d.lang }); } catch (_) {}
    // Tanulás: a levél tárgya/szövege sablonként (a név / időszak helyőrzővel) → legközelebb AI nélkül.
    try { if (d.intent && (d.cards || []).some((c) => c.query)) await mailIntent.learnTemplate(cid, d, d.intent, d.lang || 'ro'); } catch (_) {}
    try { await audit.fromReq(req, 'mail.chat_send', 'mail', null, { general: true }); } catch (_) {}
  }
  return { ok: true };
}

// ─── 👁 Előnézet újrarajzolása (a felhasználó a kliensen vett ki kártyát stb.) ───
handlers.mailChatPreview = async function (req, res, args) {
  try {
    const gate = await require('./orderChat')._gate(req);
    if (gate) return res.json({ result: { ok: false, err: gate } });
    const d = sanitizeMail(((args && args[0]) || {}).draft);
    d.cards = (await mailData.expandCards(req.session.user.company_id, d.cards || [])).cards;
    return res.json({ result: { ok: true, preview_html: await _previewHtml(req, d), placeholders: mailBody.findPlaceholders(d.body || '') } });
  } catch (e) {
    console.error('mailChatPreview hiba:', e && e.message);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

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
Object.defineProperty(handlers, '_changes', { value: _changes, enumerable: false });
Object.defineProperty(handlers, '_finish', { value: _finish, enumerable: false });
Object.defineProperty(handlers, '_pickAttachments', { value: pickAttachments, enumerable: false });

module.exports = handlers;
