// ============================================================
//  VallorSoft — lib/chatTools/undo.js
//  ↩️ A felhasználó saját, chatből végrehajtott utolsó műveletének
//  visszavonása (24 órán belül), szintén ✅-megerősítéssel.
//  Csak azok a műveletek, amelyek tool-ja ad `undo`-t (lásd chat_action_log).
// ============================================================
'use strict';

const core = require('./core');

const L = (hu, ro) => ({ hu, ro });
const hu = (ctx) => ctx.lang === 'hu';

async function lastAction(ctx) {
  const r = await core.q(`SELECT id, tool, label, entity_id, before, result, created_at FROM chat_action_log
                           WHERE company_id = $1 AND user_id = $2 AND undone_at IS NULL AND created_at > NOW() - INTERVAL '24 hours'
                           ORDER BY created_at DESC, id DESC LIMIT 1`, [ctx.cid, ctx.uid]);
  return r[0] || null;
}

module.exports = [
  {
    name: 'chat.undo', domain: 'chat', kind: 'write',
    title: L('Visszavonás', 'Anulare'),
    desc: L('A chatből végrehajtott UTOLSÓ saját művelet visszavonása (24 órán belül).', 'Anulează ULTIMA operațiune făcută din chat (în 24 h).'),
    examples: L(['vond vissza az előzőt', 'mégse, csináld vissza'], ['anulează ultima operațiune']),
    async preview(ctx, a) {
      const x = await lastAction(ctx);
      if (!x) return { reply: hu(ctx) ? 'Nincs visszavonható chat-műveleted az elmúlt 24 órából.' : 'Nu ai operațiuni din chat de anulat în ultimele 24 de ore.' };
      const tool = core.get(x.tool);
      if (!tool || typeof tool.undo !== 'function') return { err: core.tx(ctx.lang).undoNo };
      a.log_id = x.id;
      const title = (tool.title && tool.title[ctx.lang]) || tool.name;
      const when = new Date(x.created_at);
      return { rows: [[hu(ctx) ? 'Művelet' : 'Operațiune', title], ['#', x.entity_id || '—'], [hu(ctx) ? 'Időpont' : 'Ora', String(when.toISOString()).replace('T', ' ').slice(0, 16)]], label: title };
    },
    async run(ctx, a) {
      const r = await core.q(`SELECT id, tool, before, result FROM chat_action_log WHERE id = $1 AND company_id = $2 AND user_id = $3 AND undone_at IS NULL`, [a.log_id, ctx.cid, ctx.uid]);
      const x = r[0];
      if (!x) return { ok: false, err: core.tx(ctx.lang).badToken };
      const tool = core.get(x.tool);
      if (!tool || typeof tool.undo !== 'function') return { ok: false, err: core.tx(ctx.lang).undoNo };
      // A visszavonás is ugyanazzal a jogosultsággal fut, mint az eredeti művelet.
      if (!(await core.canUse(ctx.req, tool, {}))) return { ok: false, err: core.tx(ctx.lang).noAccess };
      const u = await tool.undo(ctx, x.before, x.result || {});
      if (!u || u.ok === false) return { ok: false, err: (u && u.err) || core.tx(ctx.lang).undoNo };
      await core.q(`UPDATE chat_action_log SET undone_at = NOW() WHERE id = $1 AND company_id = $2`, [x.id, ctx.cid]);
      try { await require('../audit').fromReq(ctx.req, 'chat.undo', 'chat', String(x.id), { tool: x.tool }); } catch (_) {}
      return { ok: true, reply: hu(ctx) ? '↩️ Visszavonva.' : '↩️ Anulat.', order_id: (x.before && x.before.id) || null };
    },
  },
];
