// ============================================================
//  VallorSoft — lib/chatRouter.js
//  💬 AI-chat 2.0 — szándék-felismerés + tool-választás (CHAT-AI-TERV.md 3.2).
//
//  Akkor fut, ha a determinisztikus felismerők (lib/chatOps.js, lib/driverInfo.js)
//  nem válaszoltak. Az AI a bejelentkezett felhasználónak elérhető tool-sémákat
//  kapja + a beszélgetést (a felhasználó mondatai és a rövid válaszok — a
//  dokumentumhoz kötődő részek SOHA, lib/chatHistory.aiTranscript) + a releváns
//  emlékeket. Cég-listát (nevek, fuvarok) és dokumentumot NEM; a nevek a
//  szerveren oldódnak fel. Csevegésre természetes mondatban válaszol, a
//  „jegyezd meg / felejtsd el" kérést az emlékek közé írja / onnan törli.
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

function systemPrompt(list, lang, ui, now, learned, memory) {
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
    '- Use the EARLIER CONVERSATION to understand follow-ups ("and for Peti?", "same for last month", "that one", "és a másik?", "și pentru el?") — take the missing arguments from it.',
    '- Small talk, a reaction, a question about what was said earlier in this conversation or something you remember (MEMORY) → steps = [], "chat": true and a natural, friendly "reply" (1-3 sentences, the user\'s language, informal if they are). Never invent company data you were not given; if the answer needs live data, use a tool instead.',
    '- "Remember / jegyezd meg / ține minte / mostantól / de acum înainte …" → "remember": [{"text": "the fact, short, in the user language", "scope": "user" or "company" (company only for facts about the whole company)}], plus a short confirming "reply". "Forget / felejtsd el / uită" → "forget": ["keywords"]. Never remember passwords, keys, card data or document contents.',
    '- If nothing fits or the message is unclear: steps = [] and give up to 3 alternatives (tool + a short example sentence in the user language that the user could send).',
    learned ? 'Examples learned from this company (user sentence → tool):\n' + learned : '',
    memory || '',
    'TOOLS:',
    list,
    'Return ONLY JSON: {"steps":[{"tool":"name","args":{}}],"confidence":0.0,"chat":false,"reply":"optional short natural sentence in the user language","remember":[],"forget":[],"alternatives":[{"tool":"name","example":"..."}]}',
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
// Két vagy több (nem veszélyes) írás → egyetlen terv-kártya „✅ Mind végrehajtása" gombbal.
async function runSteps(ctx, steps) {
  const replies = []; const htmls = []; let questions = []; let ui = null;
  const pend = [];
  for (const st of steps.slice(0, MAX_STEPS)) {
    let r;
    try { r = await core.prepareRaw(ctx, st); } catch (e) { console.error('chatRouter lépés hiba:', st && st.tool, e && e.message); r = { reply: '⚠️ Eroare de server', html: '' }; }
    if (r.delegate) {
      if (!replies.length && !pend.length) return { delegate: r.delegate, tool: r.tool };
      continue; // vegyes kérésnél a vázlat-indítást kihagyjuk, a többi lefut
    }
    if (r.pending) { pend.push(r); continue; }
    if (r.reply) replies.push(r.reply);
    if (r.html) htmls.push(r.html);
    if (r.ui && !ui) ui = r.ui;
    if (r.questions && r.questions.length) { questions = r.questions; break; }
  }
  const safe = pend.filter((p) => p.tool.kind !== 'danger');
  const danger = pend.filter((p) => p.tool.kind === 'danger');
  if (safe.length >= 2) {
    const c = core.planCard(ctx, safe);
    replies.push(c.reply); htmls.push(c.html);
  } else if (safe.length === 1) {
    const c = core.cardFor(ctx, safe[0]);
    replies.push(c.reply); htmls.push(c.html);
  }
  for (const d of danger) { const c = core.cardFor(ctx, d); replies.push(c.reply); htmls.push(c.html); }
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

// opts: { lang, history (szövegek, legújabb elöl — csak szerver-oldali feloldáshoz), aiHistory (a beszélgetés
// AI-hoz mehető kivonata, régebbi elöl: { role, text, side?, hidden? } — régi hívóknál sima szöveg),
// memory (emlék-blokk, lib/chatHistory.memoryContext), convId, ui, now }
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
    const conv = (opts.aiHistory || []).slice(-14).map((m) => {
      if (typeof m === 'string') return 'USER (earlier): ' + m.slice(0, 400);
      if (!m || m.hidden) return '(earlier exchange about documents — content hidden)';
      return (m.role === 'assistant' ? 'ASSISTANT (earlier): ' : 'USER (earlier): ') + String(m.text || '').slice(0, m.role === 'assistant' ? 300 : 400);
    });
    if (conv.length) conv.unshift('EARLIER CONVERSATION:');
    conv.push('USER (last message): ' + String(text).slice(0, 1500));
    ai = await extractJson({ systemPrompt: systemPrompt(core.catalogText(list, lang), lang, ui, ctx.now, learned, opts.memory), parts: [{ text: conv.join('\n') }] });
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
  // Emlékezés: „jegyezd meg" / „felejtsd el" (lib/chatHistory — titok, fájlnév sosem kerül be).
  let remembered = 0; let forgotten = 0;
  try {
    const hist = require('./chatHistory');
    if (Array.isArray(out.remember) && out.remember.length) remembered = await hist.remember(req, out.remember, opts.convId);
    if (Array.isArray(out.forget) && out.forget.length) forgotten = await hist.forget(req, out.forget);
  } catch (_) { /* best-effort */ }
  const chatReply = typeof out.reply === 'string' ? out.reply.trim().slice(0, 600) : '';
  if (!steps.length && (out.chat === true || remembered || forgotten) && chatReply) {
    return { reply: chatReply, html: '', questions: [], chat: true, tools: [], model: ai.model };
  }
  if (!steps.length && (remembered || forgotten)) {
    return { reply: remembered ? t.remembered : t.forgotten, html: '', questions: [], chat: true, tools: [], model: ai.model };
  }
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
