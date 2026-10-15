// ============================================================
//  VallorSoft — handlers/chatHistory.js
//  💬 Chat-beszélgetések ellenőrzése (Adminisztráció fül + a chat 🕘 gombja).
//   • Admin: a cég BÁRMELY felhasználójának beszélgetését látja (szűrés
//     felhasználóra / szövegre / dátumra), törölheti; a más felhasználó
//     beszélgetésének megnyitása audit-naplózva.
//   • Manager: csak a SAJÁT beszélgetéseit.
//  Csak sima szöveg (felhasználói mondat + válasz + kártya-szöveg) — fájl,
//  feltöltés, kép itt nincs. company_id-szűrt, paraméteres SQL.
//  Kapcsoló: `chat-history` (hiányzó sor = BE).
// ============================================================
'use strict';

const pool = require('../db');
const audit = require('../lib/audit');
const hist = require('../lib/chatHistory');

const PAGE = 50;

function _u(req) { return req.session && req.session.user; }
function _am(u) { return !!(u && (u.pozicio === 'Admin' || u.pozicio === 'Manager')); }
function _a(args) { return (Array.isArray(args) ? args[0] : args) || {}; }
const _date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

async function _gate(u) {
  if (!_am(u)) return 'Acces interzis';
  if (!(await hist.enabled(u.company_id))) return 'Istoricul conversațiilor nu este activ pentru firmă.';
  return null;
}

// args[0]: { user_id?, q?, from?, to?, offset? }
async function chatHistoryList(req, res, args) {
  try {
    const u = _u(req);
    const g = await _gate(u);
    if (g) return res.json({ result: { ok: false, err: g } });
    const cid = u.company_id;
    const a = _a(args);
    const isAdmin = u.pozicio === 'Admin';
    const where = ['c.company_id = $1'];
    const p = [cid];
    // A Manager csak a sajátját látja — a kért user_id-t figyelmen kívül hagyjuk.
    const want = isAdmin ? parseInt(a.user_id, 10) : u.id;
    if (want > 0) { p.push(want); where.push('c.user_id = $' + p.length); }
    const q = String(a.q || '').trim().slice(0, 100);
    if (q) {
      p.push('%' + q.replace(/[%_\\]/g, ' ') + '%');
      where.push(`(c.title ILIKE $${p.length} OR c.summary ILIKE $${p.length} OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.id AND m.company_id = c.company_id AND m.text ILIKE $${p.length}))`);
    }
    const from = _date(a.from); const to = _date(a.to);
    if (from) { p.push(from); where.push('c.updated_at >= $' + p.length + '::date'); }
    if (to) { p.push(to); where.push('c.updated_at < ($' + p.length + "::date + INTERVAL '1 day')"); }
    const off = Math.max(0, parseInt(a.offset, 10) || 0);
    p.push(PAGE + 1, off);
    const r = await pool.query(
      `SELECT c.id, c.user_id, c.title, c.summary, c.msg_count, c.user_msg_count, c.created_at, c.updated_at,
              u.nume AS user_name, u.pozicio AS user_role
         FROM chat_conversations c
         LEFT JOIN users u ON u.id = c.user_id AND u.company_id = c.company_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.updated_at DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p);
    const rows = r.rows.slice(0, PAGE).map((x) => ({
      id: Number(x.id), user_id: x.user_id, user_name: x.user_name || '—', user_role: x.user_role || '',
      title: x.title || '', summary: x.summary || '', msg_count: x.msg_count || 0,
      created_at: x.created_at, updated_at: x.updated_at, own: x.user_id === u.id,
    }));
    let users = [];
    if (isAdmin) {
      const ur = await pool.query(
        `SELECT DISTINCT u.id, u.nume FROM chat_conversations c JOIN users u ON u.id = c.user_id AND u.company_id = c.company_id
          WHERE c.company_id = $1 ORDER BY u.nume`, [cid]);
      users = ur.rows.map((x) => ({ id: x.id, nume: x.nume }));
    }
    return res.json({ result: { ok: true, rows, more: r.rows.length > PAGE, offset: off, users, is_admin: isAdmin, retention_days: hist.RETENTION_DAYS } });
  } catch (e) {
    if (e && e.code === '42P01') return res.json({ result: { ok: true, rows: [], users: [], is_admin: false, retention_days: hist.RETENTION_DAYS } });
    console.error('chatHistoryList hiba:', e);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
}

// args[0]: { id }
async function chatHistoryGet(req, res, args) {
  try {
    const u = _u(req);
    const g = await _gate(u);
    if (g) return res.json({ result: { ok: false, err: g } });
    const cid = u.company_id;
    const id = parseInt(_a(args).id, 10);
    if (!(id > 0)) return res.json({ result: { ok: false, err: 'ID invalid' } });
    const cr = await pool.query(
      `SELECT c.id, c.user_id, c.title, c.summary, c.msg_count, c.created_at, c.updated_at, u.nume AS user_name, u.email AS user_email
         FROM chat_conversations c LEFT JOIN users u ON u.id = c.user_id AND u.company_id = c.company_id
        WHERE c.id = $1 AND c.company_id = $2`, [id, cid]);
    const c = cr.rows[0];
    // Más felhasználó beszélgetése: csak Admin (a Managernek „nem található", nem szivárog a létezése).
    if (!c || (c.user_id !== u.id && u.pozicio !== 'Admin')) return res.json({ result: { ok: false, err: 'Conversația nu a fost găsită.' } });
    const mr = await pool.query(
      `SELECT id, role, text, card_text, kind, noai, created_at FROM chat_messages
        WHERE conversation_id = $1 AND company_id = $2 ORDER BY id LIMIT 2000`, [id, cid]);
    if (c.user_id !== u.id) {
      try { await audit.fromReq(req, 'chat.history_view', 'chat_conversation', String(id), { owner: c.user_id }); } catch (_) {}
    }
    return res.json({ result: { ok: true,
      conversation: { id: Number(c.id), user_id: c.user_id, user_name: c.user_name || '—', user_email: c.user_email || '',
        title: c.title || '', summary: c.summary || '', msg_count: c.msg_count || 0, created_at: c.created_at, updated_at: c.updated_at, own: c.user_id === u.id },
      messages: mr.rows.map((m) => ({ id: Number(m.id), role: m.role, text: m.text || '', card: m.card_text || '', kind: m.kind || '', noai: !!m.noai, at: m.created_at })),
    } });
  } catch (e) {
    console.error('chatHistoryGet hiba:', e);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
}

// args[0]: { id } — csak Admin.
async function chatHistoryDelete(req, res, args) {
  try {
    const u = _u(req);
    const g = await _gate(u);
    if (g) return res.json({ result: { ok: false, err: g } });
    if (u.pozicio !== 'Admin') return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const id = parseInt(_a(args).id, 10);
    if (!(id > 0)) return res.json({ result: { ok: false, err: 'ID invalid' } });
    const r = await pool.query('DELETE FROM chat_conversations WHERE id = $1 AND company_id = $2 RETURNING user_id', [id, u.company_id]);
    if (!r.rowCount) return res.json({ result: { ok: false, err: 'Conversația nu a fost găsită.' } });
    try { await audit.fromReq(req, 'chat.history_delete', 'chat_conversation', String(id), { owner: r.rows[0].user_id }); } catch (_) {}
    return res.json({ result: { ok: true } });
  } catch (e) {
    console.error('chatHistoryDelete hiba:', e);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
}

module.exports = { chatHistoryList, chatHistoryGet, chatHistoryDelete };
