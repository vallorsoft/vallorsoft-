// ============================================================
//  VallorSoft — lib/chatTools/core.js
//  💬 AI-chat 2.0 — KÉPESSÉG-KATALÓGUS (tool-registry) motorja.
//
//  Egy „tool" a konzol egy funkciója chatből: olvasás (azonnal fut),
//  írás (előnézet-kártya + aláírt token → ✅ után fut), veszélyes írás
//  (dupla megerősítés: be kell írni, hogy IGEN), vagy navigáció (a kliens
//  megnyit egy fület / ablakot).
//
//  SZABÁLYOK (CHAT-AI-TERV.md 3.3):
//   - A végrehajtás MINDIG egy meglévő handlert hív (callH) ugyanazzal a
//     req-gel → szerep-kapu, company_id-szűrés, audit, csomag-limit ott is.
//   - Az AI csak a tool-sémákat látja; a nevek (sofőr/jármű/ügyfél/fuvar)
//     feloldása KIZÁRÓLAG itt, a szerveren történik.
//   - A token a FELOLDOTT argumentumokat hordozza, user+cég-hez kötve,
//     15 percig érvényes; végrehajtáskor a hozzáférést újra ellenőrizzük.
//   - Csak Admin/Manager felület (a sofőr nem kap chat-irányítást).
// ============================================================
'use strict';

const di = require('../driverInfo');
const mi = require('../mailIntent');
const { featureEnabled } = require('../featureEnabled');
const R = require('./resolve');

const { esc, fmtN, fmtD, num } = di._h;
const fold = mi.fold;

// ─── Szövegek ───
const TX = {
  hu: {
    confirm: '✅ Megerősítés', cancel: '✕ Mégse', confirmQ: 'Ezt fogom végrehajtani — megerősíted?',
    dangerQ: '⚠️ Ez nem vonható vissza. Írd be: IGEN, majd nyomd meg a gombot.', dangerWord: 'IGEN', dangerPh: 'IGEN',
    dangerBad: 'A megerősítéshez írd be pontosan: IGEN',
    noAccess: 'Ehhez nincs jogosultságod, vagy a funkció nincs benne a csomagban.',
    unknownTool: 'Ezt a műveletet nem ismerem.', done: '✅ Kész.', expired: 'A megerősítés lejárt — kérd újra.', badToken: 'Érvénytelen művelet.',
    notUnderstood: 'Ezt nem értettem pontosan. Erre gondoltál?', notUnderstood0: 'Ezt nem értettem pontosan — fogalmazd meg kicsit másképp, vagy nézd a súgót („mit tudsz?").',
    opened: (x) => '🧭 Megnyitottam: ' + x, noRows: 'Nincs találat.', more: (n) => '… és még ' + n,
    field: 'Mező', value: 'Érték', from: 'Most', to: 'Új', undoNo: 'Ez nem vonható vissza.',
  },
  ro: {
    confirm: '✅ Confirm', cancel: '✕ Anulează', confirmQ: 'Asta voi executa — confirmi?',
    dangerQ: '⚠️ Operațiunea nu poate fi anulată. Scrie: DA, apoi apasă butonul.', dangerWord: 'DA', dangerPh: 'DA',
    dangerBad: 'Pentru confirmare scrie exact: DA',
    noAccess: 'Nu ai drept pentru asta sau funcția nu este inclusă în pachet.',
    unknownTool: 'Nu cunosc această operațiune.', done: '✅ Gata.', expired: 'Confirmarea a expirat — cere din nou.', badToken: 'Operațiune invalidă.',
    notUnderstood: 'Nu am înțeles exact. La asta te-ai gândit?', notUnderstood0: 'Nu am înțeles exact — reformulează puțin sau scrie „ce știi să faci?".',
    opened: (x) => '🧭 Am deschis: ' + x, noRows: 'Niciun rezultat.', more: (n) => '… și încă ' + n,
    field: 'Câmp', value: 'Valoare', from: 'Acum', to: 'Nou', undoNo: 'Nu poate fi anulat.',
  },
};
const tx = (lang) => TX[lang === 'hu' ? 'hu' : 'ro'];

// ─── Registry ───
const TOOLS = new Map();
function register(list) {
  for (const t of list) {
    if (!t || !t.name || TOOLS.has(t.name)) throw new Error('chatTools: hibás/duplikált tool: ' + (t && t.name));
    if (!['read', 'write', 'danger', 'ui', 'delegate'].includes(t.kind)) throw new Error('chatTools: ismeretlen kind: ' + t.name);
    TOOLS.set(t.name, t);
  }
}
const get = (name) => TOOLS.get(String(name || '')) || null;
const all = () => Array.from(TOOLS.values());

// ─── Hozzáférés: szerep + granulált jog + csomag-kapcsoló ───
async function hasPermKey(req, key) {
  const u = req.session.user;
  if (u.pozicio === 'Admin' || u.is_dev) return true;
  try { return await require('../../handlers/permissions').hasPerm(null, u.company_id, u.id, key); } catch (_) { return false; }
}
async function canUse(req, tool, cache) {
  const u = req.session && req.session.user;
  if (!u || !['Admin', 'Manager'].includes(u.pozicio)) return false;
  const roles = tool.roles || ['Admin', 'Manager'];
  if (!roles.includes(u.pozicio) && !u.is_dev) return false;
  cache = cache || {};
  if (tool.perm && u.pozicio === 'Manager') {
    const k = 'p:' + tool.perm;
    if (!(k in cache)) cache[k] = await hasPermKey(req, tool.perm);
    if (!cache[k]) return false;
  }
  const feats = [].concat(tool.feature || []);
  for (const f of feats) {
    const k = 'f:' + f;
    if (!(k in cache)) cache[k] = await featureEnabled(u.company_id, f);
    if (!cache[k]) return false;
  }
  return true;
}
async function available(req) {
  const cache = {};
  const out = [];
  for (const t of all()) if (await canUse(req, t, cache)) out.push(t);
  return out;
}

// ─── Katalógus-szöveg az AI-nak (CSAK séma, cég-adat nélkül) ───
function paramSig(p) {
  const parts = [];
  for (const [k, d] of Object.entries(p || {})) {
    let ty = d.type;
    if (d.type === 'enum') ty = 'one of ' + d.values.join('|');
    parts.push(k + (d.required ? '*' : '') + ':' + ty + (d.hint ? ' (' + d.hint + ')' : ''));
  }
  return parts.join(', ');
}
function catalogText(tools, lang) {
  return tools.map((t) => {
    const d = (t.desc && (t.desc[lang] || t.desc.hu)) || '';
    const ex = (t.examples && (t.examples[lang] || t.examples.hu) || []).slice(0, 2).map((e) => '"' + e + '"').join(' / ');
    return '- ' + t.name + ' [' + t.kind + '] ' + d + (t.params ? ' | args: ' + paramSig(t.params) : '') + (ex ? ' | e.g. ' + ex : '');
  }).join('\n');
}

// ─── Belső handler-hívás (a req változatlan → minden ellenőrzés a handlerben is) ───
function callH(fn, req, args) {
  return new Promise((resolve) => {
    Promise.resolve(fn(req, { json: (p) => resolve((p && p.result) || p) }, args))
      .catch((e) => { console.error('chatTools belső hívás hiba:', e && e.message); resolve({ ok: false, err: 'Eroare de server' }); });
  });
}
// Kényelmi: handler-modul + függvénynév.
function H(mod, fn) {
  const m = require('../../handlers/' + mod);
  if (typeof m[fn] !== 'function') throw new Error('chatTools: hiányzó handler ' + mod + '.' + fn);
  return m[fn];
}
// REST-végpont-logika helyett közvetlen SQL csak olvasásra, mindig company_id-vel.
const q = di._h.q;

// ─── Argumentum-feloldás a param-séma szerint ───
// Kimenet: { args } | { ask: {text, options} } | { err }
async function resolveArgs(ctx, tool, raw) {
  const out = {};
  const params = tool.params || {};
  raw = raw && typeof raw === 'object' ? raw : {};
  for (const [k, d] of Object.entries(params)) {
    let v = raw[k];
    if (v === '' || v === undefined) v = null;
    if (v == null && d.default !== undefined) v = typeof d.default === 'function' ? d.default(ctx) : d.default;
    if (v == null && d.fromHistory && d.type === 'order') v = '__history__';
    if (v == null) {
      if (d.required) return { ask: { text: R.askFor(ctx, k, d), options: [] } };
      out[k] = null; continue;
    }
    const r = await R.resolve(ctx, d, v, k);
    if (r.ask) return r;
    if (r.err) return r;
    out[k] = r.value;
  }
  if (typeof tool.check === 'function') {
    const c = await tool.check(ctx, out);
    if (c) return c;
  }
  return { args: out };
}

// ─── Kártyák ───
const change = (a, b) => ({ __html: '<s class="och-act-old">' + esc(a == null || a === '' ? '—' : a) + '</s> → <b>' + esc(b == null || b === '' ? '—' : b) + '</b>' });
function rowsTable(rows) {
  return '<table class="och-info-t"><tbody>' + rows.map((r) => '<tr><td>' + esc(r[0]) + '</td><td>' + (r[1] && r[1].__html != null ? r[1].__html : esc(r[1] == null || r[1] === '' ? '—' : r[1])) + '</td></tr>').join('') + '</tbody></table>';
}
function actionCard(t, title, rows, token, danger) {
  const inpId = danger ? 'ochDg' + Math.random().toString(36).slice(2, 9) : null;
  return '<div class="och-info"><div class="och-info-s och-act' + (danger ? ' och-danger' : '') + '"><div class="och-info-st">' + (danger ? '⚠️ ' : '⚡ ') + esc(title) + '</div>'
    + '<div class="och-info-mut">' + esc(danger ? t.dangerQ : t.confirmQ) + '</div>'
    + rowsTable(rows)
    + (danger ? '<div class="och-info-btns"><input type="text" class="och-act-input" data-need="confirm" maxlength="10" id="' + inpId + '" placeholder="' + esc(t.dangerPh) + '" autocomplete="off"></div>' : '')
    + '<div class="och-info-btns"><button type="button" class="och-info-btn och-act-ok" data-tok="' + esc(token) + '"' + (danger ? ' data-input="' + inpId + '"' : '') + ' onclick="OrderChat.act(this)">' + esc(t.confirm) + '</button>'
    + '<button type="button" class="och-info-btn" data-tok="' + esc(token) + '" onclick="OrderChat.actCancel(this)">' + esc(t.cancel) + '</button></div></div></div>';
}
// Általános lista-kártya: rows = objektumok, cols = [{k, l:{hu,ro}, f?: fn(v,row)}]
function listCard(ctx, icon, title, rows, cols, limit) {
  const t = tx(ctx.lang);
  limit = limit || 25;
  if (!rows || !rows.length) return di._h.section(icon, title, '<div class="och-info-empty">' + esc(t.noRows) + '</div>');
  const head = cols.map((c) => (c.l && (c.l[ctx.lang] || c.l.hu)) || c.k);
  const body = rows.slice(0, limit).map((r) => cols.map((c) => {
    const v = c.f ? c.f(r[c.k], r, ctx) : r[c.k];
    return v && v.__html != null ? v : (v == null || v === '' ? '—' : String(v));
  }));
  const tw = '<div class="och-info-tw"><table class="och-info-t"><thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>'
    + body.map((r) => '<tr>' + r.map((c) => '<td>' + (c && c.__html != null ? c.__html : esc(c)) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  return di._h.section(icon, title, tw + (rows.length > limit ? '<div class="och-info-more">' + esc(t.more(rows.length - limit)) + '</div>' : ''));
}
function kvCard(icon, title, rows) { return di._h.section(icon, title, rowsTable(rows)); }

// ─── Egy tool-lépés előkészítése (olvasás fut, írás → előnézet) ───
// prepareRaw: írásnál NEM ír alá tokent, hanem visszaadja az előnézetet (a több
// lépéses terv-kártyához); minden más esetben a végleges választ.
async function prepareRaw(ctx, step) {
  const t = tx(ctx.lang);
  const tool = get(step && step.tool);
  if (!tool) return { reply: t.unknownTool, html: '', questions: [] };
  if (!(await canUse(ctx.req, tool, ctx.permCache))) return { reply: t.noAccess, html: '', questions: [] };
  if (tool.kind === 'delegate') return { delegate: tool.delegate, tool: tool.name };
  const ra = await resolveArgs(ctx, tool, step.args);
  if (ra.err) return { reply: '⚠️ ' + ra.err, html: '', questions: [] };
  if (ra.ask) return { reply: ra.ask.text, html: '', questions: ra.ask.options && ra.ask.options.length ? [{ key: 'tool', text: ra.ask.text, options: ra.ask.options.slice(0, 6) }] : [] };
  const a = ra.args;
  if (tool.kind === 'read' || tool.kind === 'ui') {
    const r = await tool.run(ctx, a);
    if (!r) return { reply: t.noRows, html: '', questions: [] };
    if (r.ok === false) return { reply: '⚠️ ' + (r.err || 'Eroare'), html: '', questions: [] };
    return { reply: r.reply || '', html: r.html || '', questions: r.questions || [], ui: r.ui || null };
  }
  const pv = await tool.preview(ctx, a);
  if (pv && pv.err) return { reply: '⚠️ ' + pv.err, html: '', questions: [] };
  if (pv && pv.reply && !pv.rows) return { reply: pv.reply, html: '', questions: [] };
  const title = (tool.title && (tool.title[ctx.lang] || tool.title.hu)) || tool.name;
  return { pending: true, tool, a, rows: (pv && pv.rows) || [], title, label: pv && pv.label };
}
function cardFor(ctx, pr) {
  const t = tx(ctx.lang);
  const danger = pr.tool.kind === 'danger';
  const token = ctx.sign({ t: 'tool', name: pr.tool.name, a: pr.a, src: String(ctx.text || '').slice(0, 200) });
  return { reply: (danger ? '⚠️ ' : '⚡ ') + pr.title + (pr.label ? ' — ' + pr.label : ''), html: actionCard(t, pr.title, pr.rows, token, danger), questions: [], write: true, action: pr.tool.name };
}
async function prepare(ctx, step) {
  const pr = await prepareRaw(ctx, step);
  return pr.pending ? cardFor(ctx, pr) : pr;
}
// Több írás egy terv-kártyán, egyetlen ✅-vel (veszélyes lépés nem lehet benne).
const PLAN_TX = {
  hu: { title: (n) => 'Terv — ' + n + ' lépés', q: 'Ezeket hajtom végre sorban — megerősíted? (Hiba esetén megállok.)', all: '✅ Mind végrehajtása' },
  ro: { title: (n) => 'Plan — ' + n + ' pași', q: 'Le execut pe rând — confirmi? (La eroare mă opresc.)', all: '✅ Execută tot' },
};
function planCard(ctx, list) {
  const t = tx(ctx.lang); const P = PLAN_TX[ctx.lang === 'hu' ? 'hu' : 'ro'];
  const token = ctx.sign({ t: 'plan', src: String(ctx.text || '').slice(0, 200), steps: list.map((pr) => ({ name: pr.tool.name, a: pr.a })) });
  const body = list.map((pr, i) => '<div class="och-plan-step"><div class="och-plan-n">' + (i + 1) + '. ' + esc(pr.title) + (pr.label ? ' — ' + esc(pr.label) : '') + '</div>' + rowsTable(pr.rows) + '</div>').join('');
  return { reply: '⚡ ' + P.title(list.length), questions: [], write: true, action: 'plan',
    html: '<div class="och-info"><div class="och-info-s och-act och-plan"><div class="och-info-st">⚡ ' + esc(P.title(list.length)) + '</div><div class="och-info-mut">' + esc(P.q) + '</div>' + body
      + '<div class="och-info-btns"><button type="button" class="och-info-btn och-act-ok" data-tok="' + esc(token) + '" onclick="OrderChat.act(this)">' + esc(P.all) + '</button>'
      + '<button type="button" class="och-info-btn" data-tok="' + esc(token) + '" onclick="OrderChat.actCancel(this)">' + esc(t.cancel) + '</button></div></div></div>' };
}

// ─── Végrehajtás a ✅ után (a token már ellenőrzött: cid/uid/exp) ───
async function logAction(ctx, tool, a, before, r) {
  if (typeof tool.undo !== 'function' || before == null) return null;
  try {
    const ins = await q(`INSERT INTO chat_action_log (company_id, user_id, tool, label, entity_id, before, result)
                         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) RETURNING id`,
      [ctx.cid, ctx.uid, tool.name, String(r.label || ((tool.title && tool.title[ctx.lang]) || tool.name)).slice(0, 200),
       r.entity_id != null ? String(r.entity_id).slice(0, 80) : null, JSON.stringify(before || null), JSON.stringify({ a, id: r.entity_id || null })]);
    return ins[0] ? ins[0].id : null;
  } catch (e) { console.warn('chat_action_log:', e.message); return null; }
}
async function runOne(ctx, name, a, extra) {
  const t = tx(ctx.lang);
  const tool = get(name);
  if (!tool || !['write', 'danger'].includes(tool.kind)) return { ok: false, err: t.badToken };
  if (!(await canUse(ctx.req, tool, {}))) return { ok: false, err: t.noAccess };
  if (tool.kind === 'danger') {
    const w = String((extra && extra.input) || '').trim().toUpperCase();
    if (!['IGEN', 'DA', 'YES'].includes(w)) return { ok: false, err: t.dangerBad };
  }
  a = a && typeof a === 'object' ? a : {};
  let before = null;
  if (typeof tool.snapshot === 'function') { try { before = await tool.snapshot(ctx, a); } catch (_) { before = null; } }
  const r = await tool.run(ctx, a);
  if (!r || r.ok === false) return { ok: false, err: (r && r.err) || 'Eroare de server' };
  try { await require('../audit').fromReq(ctx.req, 'chat.action', tool.domain || 'chat', r.entity_id != null ? String(r.entity_id) : null, { tool: tool.name }); } catch (_) {}
  const logId = await logAction(ctx, tool, a, before, r);
  return { ok: true, reply: r.reply || t.done, type: tool.name, order_id: r.order_id || null, ui: r.ui || null, entity_id: r.entity_id || null, undoable: !!logId };
}
async function execute(ctx, p, extra) {
  if (p.t === 'plan') {
    const steps = Array.isArray(p.steps) ? p.steps.slice(0, 5) : [];
    const lines = []; let lastOrder = null; let anyUndo = false;
    for (let i = 0; i < steps.length; i++) {
      if (get(steps[i].name) && get(steps[i].name).kind === 'danger') return { ok: false, err: tx(ctx.lang).badToken };
      const r = await runOne(ctx, steps[i].name, steps[i].a, extra);
      if (!r.ok) {
        lines.push((i + 1) + '. ⚠️ ' + r.err);
        return { ok: lines.length > 1, partial: true, reply: lines.join('\n'), err: lines.join('\n'), order_id: lastOrder };
      }
      lines.push((i + 1) + '. ' + r.reply);
      if (r.order_id) lastOrder = r.order_id;
      anyUndo = anyUndo || r.undoable;
    }
    return { ok: true, reply: lines.join('\n'), type: 'plan', order_id: lastOrder, undoable: anyUndo };
  }
  return runOne(ctx, p.name, p.a, extra);
}

module.exports = {
  TX, tx, register, get, all, canUse, available, catalogText, callH, H, q, resolveArgs, prepare, prepareRaw, cardFor, planCard, execute,
  card: { change, rowsTable, actionCard, listCard, kvCard, section: di._h.section, tiles: di._h.tiles },
  fmt: { esc, fmtN, fmtD, num, fold },
};
