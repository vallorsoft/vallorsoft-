// ============================================================
//  VallorSoft — handlers/learnedData.js
//  🧠 Tanult adatok (Adminisztráció fül): a rendszer által megtanult
//  cégenkénti minták EGY helyen — listázás + törlés.
//   • order_scan_samples   — megrendelés-kiolvasó ügyfél-sablonok
//   • order_chat_memory    — 💬 AI-chat memória (cím, ügyfél, áru,
//                            sofőr-becenév, levél-címzett/stílus/sablon)
//  (A bon-scan minták a meglévő getBonScanSettings/deleteBonScanSample
//   handlereken át jönnek — nem duplikáljuk.)
//  Admin/Manager, company_id-szűrt, paraméteres SQL, törlés audit-naplózva.
//  Migráció hiányában (nincs tábla) csendesen üres lista.
// ============================================================
'use strict';

const pool = require('../db');
const audit = require('../lib/audit');

const MEM_KINDS = ['firma_addr', 'pickup_client', 'client_cargo', 'driver_alias', 'mail_pref', 'mail_style', 'mail_tpl'];
const MAX_ROWS = 1000;

function _u(req) { return req.session && req.session.user; }
function _am(u) { return !!(u && (u.pozicio === 'Admin' || u.pozicio === 'Manager')); }
function _clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// Rövid, olvasható összegzés a tárolt értékből (nem a teljes JSON).
function _summary(kind, v, names) {
  v = v || {};
  switch (kind) {
    case 'firma_addr': return _clip(v.loc, 160);
    case 'pickup_client': return _clip(v.client, 160);
    case 'client_cargo': {
      const p = [];
      if (v.load_type) p.push(v.load_type);
      if (v.suly_kg) p.push(v.suly_kg + ' kg');
      if (v.hossz_cm || v.szel_cm || v.mag_cm) p.push([v.hossz_cm, v.szel_cm, v.mag_cm].map(x => x || '?').join('×') + ' cm');
      return p.join(' · ');
    }
    case 'driver_alias': {
      const e = String(v.email || '').toLowerCase();
      return names[e] || e;
    }
    case 'mail_pref': return _clip(v.to_email, 120) + (v.lang ? ' · ' + String(v.lang).toUpperCase() : '');
    case 'mail_style': {
      const s = v.style || {};
      const p = Object.keys(s).filter(k => s[k] != null && s[k] !== '').slice(0, 6).map(k => k + ': ' + _clip(s[k], 20));
      if (v.builder_template_id) p.push('#' + v.builder_template_id);
      return p.join(' · ');
    }
    case 'mail_tpl': return _clip(v.subject, 160);
    default: return _clip(JSON.stringify(v), 160);
  }
}


async function learnedDataList(req, res) {
  try {
    const u = _u(req);
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = u.company_id;

    let orderScan = [];
    try {
      const r = await pool.query(
        `SELECT id, template_key, template_label, fields, sample_count, updated_at
           FROM order_scan_samples WHERE company_id=$1 ORDER BY updated_at DESC LIMIT $2`, [cid, MAX_ROWS]);
      orderScan = r.rows.map(x => {
        const f = x.fields || {};
        const p = [];
        if (f.valuta) p.push(f.valuta);
        if (f.load_type) p.push(f.load_type);
        if (f.hossz_cm || f.szel_cm || f.mag_cm) p.push([f.hossz_cm, f.szel_cm, f.mag_cm].map(v => v || '?').join('×') + ' cm');
        if (f.typical_pickups || f.typical_deliveries) p.push((f.typical_pickups || 1) + '↑ ' + (f.typical_deliveries || 1) + '↓');
        return { id: x.id, label: x.template_label || x.template_key, summary: p.join(' · '),
          count: x.sample_count || 0, updated_at: x.updated_at };
      });
    } catch (_) { orderScan = []; }

    let memory = [];
    try {
      const r = await pool.query(
        `SELECT id, kind, key_norm, value, hits, updated_at
           FROM order_chat_memory WHERE company_id=$1 AND kind = ANY($2)
          ORDER BY kind, updated_at DESC LIMIT $3`, [cid, MEM_KINDS, MAX_ROWS]);
      // Sofőr-becenév → a sofőr NEVE (saját cégből), nem az e-mail; a stílus kulcsa (user:<id>) → felhasználó neve.
      const names = {}; const userNames = {};
      try {
        const ur = await pool.query('SELECT id, LOWER(email) AS email, nume FROM users WHERE company_id=$1', [cid]);
        ur.rows.forEach(x => { if (x.email) names[x.email] = x.nume || x.email; userNames['user:' + x.id] = x.nume || x.email; });
      } catch (_) {}
      memory = r.rows.map(x => ({
        id: Number(x.id), kind: x.kind,
        key: x.kind === 'mail_style' && userNames[x.key_norm] ? userNames[x.key_norm] : _clip(x.key_norm, 120),
        summary: _summary(x.kind, x.value, names),
        hits: x.hits || 0, updated_at: x.updated_at,
      }));
    } catch (_) { memory = []; }

    // AI-chat 2.0: nem értett mondatok (30 nap) + megerősített mondat → képesség párok.
    let chatMiss = []; let chatIntent = [];
    try {
      const r = await pool.query(`SELECT id, text, suggestions, resolved_tool, created_at FROM chat_miss_log WHERE company_id=$1 ORDER BY created_at DESC LIMIT $2`, [cid, MAX_ROWS]);
      chatMiss = r.rows.map(x => ({ id: Number(x.id), key: _clip(x.text, 160), summary: x.resolved_tool ? '→ ' + x.resolved_tool : (Array.isArray(x.suggestions) ? x.suggestions.join(' | ') : ''), hits: 1, updated_at: x.created_at }));
      const r2 = await pool.query(`SELECT id, text, tool, hits, updated_at FROM chat_learned_intents WHERE company_id=$1 ORDER BY updated_at DESC LIMIT $2`, [cid, MAX_ROWS]);
      chatIntent = r2.rows.map(x => ({ id: Number(x.id), key: _clip(x.text, 160), summary: '→ ' + x.tool, hits: x.hits || 0, updated_at: x.updated_at }));
    } catch (_) { /* migráció előtt */ }

    return res.json({ result: { ok: true, orderScan, memory, kinds: MEM_KINDS, chatMiss, chatIntent } });
  } catch (e) {
    console.error('learnedDataList hiba:', e);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
}

// Törlés: { source:'order_scan'|'memory'|'chat_miss'|'chat_intent', id } VAGY { source:'memory', kind } / { source:'chat_miss'|'chat_intent' } (a teljes csoport).
async function learnedDataDelete(req, res, args) {
  try {
    const u = _u(req);
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = u.company_id;
    const a = (Array.isArray(args) ? args[0] : args) || {};
    const source = String(a.source || '');
    const id = parseInt(a.id, 10);
    let n = 0;
    if (source === 'order_scan') {
      if (!(id > 0)) return res.json({ result: { ok: false, err: 'ID invalid' } });
      const r = await pool.query('DELETE FROM order_scan_samples WHERE id=$1 AND company_id=$2', [id, cid]);
      n = r.rowCount;
    } else if (source === 'memory') {
      if (id > 0) {
        const r = await pool.query('DELETE FROM order_chat_memory WHERE id=$1 AND company_id=$2', [id, cid]);
        n = r.rowCount;
      } else if (MEM_KINDS.includes(a.kind)) {
        const r = await pool.query('DELETE FROM order_chat_memory WHERE company_id=$1 AND kind=$2', [cid, a.kind]);
        n = r.rowCount;
      } else return res.json({ result: { ok: false, err: 'Parametri invalizi' } });
    } else if (source === 'chat_miss' || source === 'chat_intent') {
      const tbl = source === 'chat_miss' ? 'chat_miss_log' : 'chat_learned_intents';
      const r = id > 0
        ? await pool.query(`DELETE FROM ${tbl} WHERE id=$1 AND company_id=$2`, [id, cid])
        : await pool.query(`DELETE FROM ${tbl} WHERE company_id=$1`, [cid]);
      n = r.rowCount;
    } else return res.json({ result: { ok: false, err: 'Sursă invalidă' } });
    if (!n && id > 0) return res.json({ result: { ok: false, err: 'Înregistrarea nu a fost găsită' } });
    try { await audit.fromReq(req, 'learned.delete', source, id > 0 ? String(id) : null, { kind: a.kind || null, count: n }); } catch (_) {}
    return res.json({ result: { ok: true, deleted: n } });
  } catch (e) {
    console.error('learnedDataDelete hiba:', e);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
}

module.exports = { learnedDataList, learnedDataDelete };
