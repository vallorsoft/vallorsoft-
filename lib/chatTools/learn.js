// ============================================================
//  VallorSoft — lib/chatTools/learn.js
//  Chat-tanulás: a nem értett mondatok naplója (30 nap) és a később
//  megerősített „mondat → képesség" párok (cégenként, few-shot példa).
//  Kikapcsolható: `chat-learning` funkció-kapcsoló (hiányzó sor = BE).
//  Minden best-effort: hiba esetén csendben kihagyja (a chat nem törik).
// ============================================================
'use strict';

const pool = require('../../db');
const { featureEnabled } = require('../featureEnabled');
const fold = require('../mailIntent').fold;

const RETENTION_DAYS = 30;
const LINK_WINDOW_MS = 3 * 60 * 1000;
// Felhasználónként az utolsó nem értett mondat (a következő sikeres művelethez kötjük).
const lastMiss = new Map();

async function on(cid) { try { return await featureEnabled(cid, 'chat-learning'); } catch (_) { return false; } }

async function recordMiss(req, text, suggestions) {
  const u = req.session && req.session.user;
  if (!u) return;
  if (!(await on(u.company_id))) return;
  const s = String(text || '').trim().slice(0, 500);
  if (s.length < 3) return;
  const r = await pool.query(
    `INSERT INTO chat_miss_log (company_id, user_id, text, suggestions) VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
    [u.company_id, u.id, s, JSON.stringify((suggestions || []).slice(0, 3))]);
  lastMiss.set(u.company_id + ':' + u.id, { id: r.rows[0].id, text: s, ts: Date.now() });
  // Megőrzés: 30 nap.
  await pool.query(`DELETE FROM chat_miss_log WHERE company_id = $1 AND created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`, [u.company_id]).catch(() => {});
}

async function learn(cid, text, tool) {
  const norm = fold(text).slice(0, 300);
  if (norm.length < 3) return;
  await pool.query(
    `INSERT INTO chat_learned_intents (company_id, text_norm, text, tool) VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id, text_norm) DO UPDATE SET tool = EXCLUDED.tool, hits = chat_learned_intents.hits + 1, updated_at = NOW()`,
    [cid, norm, String(text).slice(0, 500), String(tool).slice(0, 80)]);
}

// Sikeres útválasztás / megerősített művelet: ha nemrég volt nem értett mondat
// ugyanettől a felhasználótól, azt ehhez a képességhez kötjük (tanulás).
async function recordHit(req, text, tool) {
  const u = req.session && req.session.user;
  if (!u || !tool) return;
  const k = u.company_id + ':' + u.id;
  const m = lastMiss.get(k);
  if (!m || Date.now() - m.ts > LINK_WINDOW_MS) return;
  lastMiss.delete(k);
  if (!(await on(u.company_id))) return;
  await pool.query(`UPDATE chat_miss_log SET resolved_tool = $1 WHERE id = $2 AND company_id = $3`, [tool, m.id, u.company_id]);
  await learn(u.company_id, m.text, tool);
}

module.exports = { recordMiss, recordHit, learn, RETENTION_DAYS, _lastMiss: lastMiss };
