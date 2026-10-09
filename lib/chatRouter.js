// ============================================================
//  VallorSoft — lib/chatRouter.js
//  💬 AI-chat 2.0 — szándék-felismerés + tool-választás (CHAT-AI-TERV.md 3.2).
//
//  Akkor fut, ha a determinisztikus felismerők (lib/chatOps.js, lib/driverInfo.js)
//  nem válaszoltak. Az AI CSAK a bejelentkezett felhasználónak elérhető
//  tool-sémákat kapja + a felhasználó MOSTANI mondatát (és a korábbi, AI-hoz
//  már amúgy is kiküldött saját mondatait) — cég-adatot, nevet-listát,
//  fuvar-adatot, dokumentumot NEM. A nevek a szerveren oldódnak fel.
//
//  Kimenet (az orderChatTurn info-válaszának alakja):
//   { reply, html, questions, ui? } | { delegate: 'draft'|'mail'|'edit', ... } | null (AI-hiba)
// ============================================================
'use strict';

const { extractJson } = require('./geminiJson');
const tools = require('./chatTools');
const core = require('./chatTools/core');

const TZ = 'Europe/Bucharest';
// AI-hívás korlát felhasználónként (a determinisztikus utak nem számítanak bele).
const limiter = require('./slidingWindow').createSlidingWindowLimiter({ windowMs: 10 * 60 * 1000, max: 60 });
const MAX_STEPS = 5;

function today(now) {
  const d = now || new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' }).format(d);
  return { ymd, weekday: wd };
}

function systemPrompt(list, lang, ui, now, learned) {
  const td = today(now);
  return [
    'You are the command router of a freight TMS console (Romanian/Hungarian). The user is a dispatcher (role: ' + ui.role + '). They write in Hungarian or Romanian, often informally, without accents, with typos, mixed languages.',
    'Your ONLY job: map the LAST user message to one or more of the TOOLS below and extract their arguments. You do not see any company data and you must not invent any.',
    'TODAY is ' + td.ymd + ' (' + td.weekday + '). Dates → YYYY-MM-DD (weekday name = next occurrence). Periods → "YYYY-MM", "YYYY", "YYYY-MM-DD..YYYY-MM-DD" or one of this_month|last_month|this_year|last_year|this_week|today|last_30_days. Money/number → plain number.',
    'Names, plates, order numbers, client/carrier names: copy them EXACTLY as the user wrote them (the server resolves them). An order number may look like CMD-2026-0042, 2026-0042, 0042 or #42 — copy it as written.',
    'If the user refers to "this order"/"ez a fuvar"/"cursa asta" or "the selected ones"/"a kijelöltek", use the value "current" (single order) or "selected" (multiple) for that argument.',
    'The user is currently on the console tab: "' + (ui.tab || 'unknown') + '"' + (ui.order ? ' and has an order open' : '') + (ui.selected ? ' and has ' + ui.selected + ' orders selected' : '') + '.',
    'Rules:',
    '- Use only tool names from the list. Omit unknown arguments (never guess).',
    '- A NEW freight described in free text (pickup/delivery/route/date to create) → tool "order.create_chat" with no args.',
    '- Writing/sending an e-mail or letter → tool "mail.compose" with no args.',
    '- A question → the matching read tool; "show/open/go to" a page → "nav.open" (or a more specific open tool).',
    '- Several independent requests in one message → several steps, in order (max ' + MAX_STEPS + ').',
    '- "What can you do / help" → "help.capabilities".',
    '- If nothing fits or the message is unclear: steps = [] and give up to 3 alternatives (tool + a short example sentence in the user language that the user could send).',
    learned ? 'Examples learned from this company (user sentence → tool):\n' + learned : '',
    'TOOLS:',
    list,
    'Return ONLY JSON: {"steps":[{"tool":"name","args":{}}],"confidence":0.0,"reply":"optional 1 short sentence in the user language","alternatives":[{"tool":"name","example":"..."}]}',
  ].filter(Boolean).join('\n');
}

function makeCtx(req, lang, text, history, ui, now) {
  const u = req.session.user;
  return {
    req, cid: u.company_id, uid: u.id, user: u, lang: lang === 'hu' ? 'hu' : 'ro', now: now || new Date(), text: String(text || ''),
    history: history || [], ui: ui || {}, permCache: {},
    sign: (p) => require('./chatOps').signAction(Object.assign({ cid: u.company_id, uid: u.id, exp: Date.now() + 15 * 60 * 1000 }, p)),
    // Kétértelmű érték gombja: az eredeti mondat a kiválasztott értékkel.
    retext: (choice, raw) => {
      const s = String(text || '');
      if (raw && s.toLowerCase().includes(String(raw).toLowerCase())) {
        const i = s.toLowerCase().indexOf(String(raw).toLowerCase());
        return s.slice(0, i) + choice + s.slice(i + String(raw).length);
      }
      return s + ' — ' + choice;
    },
  };
}

// Lépések végrehajtása/előkészítése, az eredmények összefűzése.
async function runSteps(ctx, steps) {
  const replies = []; const htmls = []; let questions = []; let ui = null;
  for (const st of steps.slice(0, MAX_STEPS)) {
    let r;
    try { r = await core.prepare(ctx, st); } catch (e) { console.error('chatRouter lépés hiba:', st && st.tool, e && e.message); r = { reply: '⚠️ Eroare de server', html: '' }; }
    if (r.delegate) {
      if (!replies.length) return { delegate: r.delegate, tool: r.tool };
      continue; // vegyes kérésnél a vázlat-indítást kihagyjuk, a többi lefut
    }
    if (r.reply) replies.push(r.reply);
    if (r.html) htmls.push(r.html);
    if (r.ui && !ui) ui = r.ui;
    if (r.questions && r.questions.length) { questions = r.questions; break; }
  }
  return { reply: replies.join('\n'), html: htmls.join(''), questions, ui };
}

// Felhasználói UI-kontextus tisztítása (a kliens küldi; megbízhatatlan).
function cleanUi(u, role) {
  const x = (u && typeof u === 'object') ? u : {};
  const tab = /^[a-z0-9-]{1,40}$/.test(String(x.tab || '')) ? String(x.tab) : null;
  const order = /^[A-Za-z0-9_-]{1,60}$/.test(String(x.order || '')) ? String(x.order) : null;
  const sel = (Array.isArray(x.selected) ? x.selected : []).filter((s) => /^[A-Za-z0-9_-]{1,60}$/.test(String(s))).slice(0, 500).map(String);
  return { tab, order, selected_ids: sel, selected: sel.length, role };
}

async function learnedExamples(cid) {
  try {
    const rows = await core.q(`SELECT text, tool FROM chat_learned_intents WHERE company_id = $1 ORDER BY updated_at DESC LIMIT 12`, [cid]);
    return rows.map((r) => '- "' + String(r.text).slice(0, 140).replace(/"/g, "'") + '" → ' + r.tool).join('\n');
  } catch (_) { return ''; }
}

// opts: { lang, history (szövegek, legújabb elöl — csak szerver-oldali feloldáshoz), aiHistory (a felhasználó
// korábbi, AI-hoz mehető mondatai, régebbi elöl), ui, now }
async function route(req, text, opts) {
  opts = opts || {};
  const lang = opts.lang === 'hu' ? 'hu' : 'ro';
  const ui = cleanUi(opts.ui, req.session.user.pozicio);
  const ctx = makeCtx(req, lang, text, opts.history, ui, opts.now);
  const t = core.tx(lang);
  const lim = limiter.check(req.session.user.company_id + ':' + req.session.user.id);
  if (!lim.ok) return { reply: lang === 'hu' ? 'Túl sok kérés rövid idő alatt — próbáld újra ' + lim.retryAfterSec + ' mp múlva.' : 'Prea multe cereri — reîncearcă peste ' + lim.retryAfterSec + ' s.', html: '', questions: [] };
  const list = await core.available(req);
  const learned = await learnedExamples(ctx.cid);
  let ai;
  try {
    const conv = (opts.aiHistory || []).slice(-4).map((m) => 'USER (earlier): ' + String(m).slice(0, 400));
    conv.push('USER (last message): ' + String(text).slice(0, 1500));
    ai = await extractJson({ systemPrompt: systemPrompt(core.catalogText(list, lang), lang, ui, ctx.now, learned), parts: [{ text: conv.join('\n') }] });
  } catch (e) {
    if (e && e.code === 'NO_KEY') return { err: 'Serviciul AI nu este configurat.' };
    return { err: String((e && e.message) || 'Eroare AI').slice(0, 300) };
  }
  const out = (ai && ai.json) || {};
  const names = new Set(list.map((x) => x.name));
  const steps = (Array.isArray(out.steps) ? out.steps : [])
    .filter((s) => s && typeof s.tool === 'string' && names.has(s.tool))
    .map((s) => ({ tool: s.tool, args: (s.args && typeof s.args === 'object' && !Array.isArray(s.args)) ? s.args : {} }))
    .slice(0, MAX_STEPS);
  const conf = Number(out.confidence);
  if (!steps.length || (isFinite(conf) && conf < 0.35)) {
    const alts = (Array.isArray(out.alternatives) ? out.alternatives : [])
      .filter((a) => a && names.has(a.tool) && typeof a.example === 'string' && a.example.trim())
      .slice(0, 3).map((a) => a.example.trim().slice(0, 140));
    try { await require('./chatTools/learn').recordMiss(req, text, alts); } catch (_) {}
    return {
      reply: alts.length ? t.notUnderstood : t.notUnderstood0, html: '', miss: true,
      questions: alts.length ? [{ key: 'tool', text: t.notUnderstood, options: alts }] : [],
    };
  }
  const r = await runSteps(ctx, steps);
  if (r.delegate) return r;
  try { await require('./chatTools/learn').recordHit(req, text, steps[0].tool); } catch (_) {}
  if (!r.reply && out.reply) r.reply = String(out.reply).slice(0, 300);
  r.model = ai.model;
  r.tools = steps.map((s) => s.tool);
  return r;
}

module.exports = { route, runSteps, makeCtx, cleanUi, _systemPrompt: systemPrompt, _limiter: limiter };
