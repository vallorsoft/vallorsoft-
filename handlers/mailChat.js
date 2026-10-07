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
const { memGet, memPut } = require('../lib/chatMemory');
const { createSlidingWindowLimiter } = require('../lib/slidingWindow');
const audit = require('../lib/audit');

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
  const rec = ['client', 'carrier', 'other'].includes(j.recipient) ? j.recipient : null;
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
    'Return ONLY JSON: {"reply":"1-2 short sentences to the dispatcher in THEIR language","draft":{"recipient":null,"to_email":null,"lang":"ro","subject":"","body":"","attachments":[],"include_tracking":false,"builder_template_id":null},"questions":[{"key":"recipient|other","text":"short question","options":["up to 4 answers"]}]}',
    'Ask a question only if really unclear; otherwise "questions": [].',
  ].join('\n');
}

function _conversation(messages, prev) {
  const v = { recipient: prev.recipient, to_email: prev.recipient === 'other' ? prev.to_email : null, lang: prev.lang,
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

// ─── Egy chat-kör (az orderChatTurn hívja e-mail módban; a kapu már lefutott) ───
async function mailTurn(req, res, a, messages, lang) {
  const cid = req.session.user.company_id;
  let prev = sanitizeMail(a.draft);
  const userText = messages.filter((m) => m.role === 'user').map((m) => m.text).join('\n');
  const last = messages[messages.length - 1].text;
  const refM = ORDER_REF_RE.exec(last) || (!prev.order_id ? ORDER_REF_RE.exec(userText) : null);
  const ref = refM ? refM[1] : prev.order_id;
  const base = { ok: true, mode: 'email', questions: [], notes: [], ready: false };
  if (!ref) {
    return res.json({ result: Object.assign(base, { reply: qt(lang, 'needOrder'), draft: prev, missing: ['order'],
      questions: [{ key: 'order', text: qt(lang, 'needOrder'), options: [] }] }) });
  }
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
  const r = await resolveMail(cid, d, o, ctx, userText, lang);
  const aiQ = (Array.isArray(out.questions) ? out.questions : []).slice(0, 2).map((q) => ({
    key: _str(q && q.key, 20) || 'other', text: _str(q && q.text, 300),
    options: (Array.isArray(q && q.options) ? q.options : []).slice(0, 4).map((x) => _str(x, 80)).filter(Boolean),
  })).filter((q) => q.text);
  const seen = new Set(r.questions.map((q) => q.key));
  const questions = r.questions.concat(aiQ.filter((q) => !seen.has(q.key))).slice(0, 3);
  try { await audit.fromReq(req, 'mail.chat_turn', 'order', o.id, { turns: messages.length, ready: !r.missing.length, model: ai.model }); } catch (_) {}
  return res.json({ result: Object.assign(base, {
    reply: _str(out.reply, 600) || '', draft: r.draft, questions, notes: r.notes, missing: r.missing,
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
    if (!d.order_id) return res.json({ result: { ok: false, err: 'Identificator lipsă' } });
    if (!isTest) {
      if (!d.to_email) return res.json({ result: { ok: false, err: 'E-mail invalid' } });
      const lim = sendLimiter.check(String(req.session.user.id || req.session.user.email));
      if (!lim.ok) return res.json({ result: { ok: false, err: qt(lang, 'rateLimit') } });
    }
    const cid = req.session.user.company_id;
    const o = await _findOrder(cid, d.order_id);
    if (!o) return res.json({ result: { ok: false, err: 'Comanda nu a fost găsită.' } });
    const r = await _call(require('./orderEmail').sendOrderEmail, req, [{
      order_id: o.id, to_email: d.to_email, subject: d.subject, body: d.body || '',
      attachments: d.attachments, include_tracking: d.include_tracking,
      builder_template_id: d.builder_template_id, test: isTest,
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

// Belső segédek (nem RPC): az orderChat hívja / a teszt eléri.
Object.defineProperty(handlers, 'mailTurn', { value: mailTurn, enumerable: false });
Object.defineProperty(handlers, 'isEmailIntent', { value: isEmailIntent, enumerable: false });
Object.defineProperty(handlers, '_sanitizeMail', { value: sanitizeMail, enumerable: false });
Object.defineProperty(handlers, '_sendLimiter', { value: sendLimiter, enumerable: false });

module.exports = handlers;
