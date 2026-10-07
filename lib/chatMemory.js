// ============================================================
//  VallorSoft — lib/chatMemory.js
//  A 💬 AI-chat (fuvar + e-mail) cégenkénti tanuló memóriája
//  (`order_chat_memory`). Csak a szerveren használt, company_id-szűrt;
//  a beszélgetés szövege SOSEM tárolódik. Migráció hiányában csendes no-op.
// ============================================================
'use strict';

const pool = require('../db');

async function memGet(cid, kind, key) {
  if (!key) return null;
  try {
    const r = await pool.query(
      'SELECT value FROM order_chat_memory WHERE company_id=$1 AND kind=$2 AND key_norm=$3', [cid, kind, key]);
    return r.rows.length ? r.rows[0].value : null;
  } catch (_) { return null; } // migráció hiányzik → nincs tanulás
}

async function memPut(cid, kind, key, value) {
  if (!key || key.length > 200) return;
  await pool.query(
    `INSERT INTO order_chat_memory (company_id, kind, key_norm, value, hits, updated_at)
     VALUES ($1,$2,$3,$4::jsonb,1,NOW())
     ON CONFLICT (company_id, kind, key_norm)
     DO UPDATE SET value=EXCLUDED.value, hits=order_chat_memory.hits+1, updated_at=NOW()`,
    [cid, kind, key, JSON.stringify(value)]);
}

module.exports = { memGet, memPut };

async function memDel(cid, kind, key) {
  if (!key) return;
  await pool.query('DELETE FROM order_chat_memory WHERE company_id=$1 AND kind=$2 AND key_norm=$3', [cid, kind, key]);
}
module.exports.memDel = memDel;
