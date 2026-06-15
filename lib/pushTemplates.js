// ============================================================
//  VallorSoft — Push értesítés sablonok
//  A developer panelen szerkeszthető, DB-ben tárolt sablonok.
//  Fallback: hardcoded RO/HU szövegek.
// ============================================================
let _pool = null;
function getPool() { if (!_pool) _pool = require('../db'); return _pool; }

const DEFAULTS = {
  push_inbound_new: {
    title_ro: '🔔 Cerere nouă de transport',
    title_hu: '🔔 Új fuvarkérés',
    body_ro:  '{{client}}{{route}}',
    body_hu:  '{{client}}{{route}}',
  },
  push_handover_request: {
    title_ro: '⛔ Predare marfă — confirmare',
    title_hu: '⛔ Áru-leadás visszaigazolásra vár',
    body_ro:  '{{sofor}} — {{rendszam}}: {{tipus}} @ {{helyszin}}',
    body_hu:  '{{sofor}} — {{rendszam}}: {{tipus}} @ {{helyszin}}',
  },
  push_handover_confirmed: {
    title_ro: '✅ Predare confirmată',
    title_hu: '✅ Áru-leadás visszaigazolva',
    body_ro:  '{{rendszam}} — {{helyszin}}{{tipus}}',
    body_hu:  '{{rendszam}} — {{helyszin}}{{tipus}}',
  },
  push_handover_rejected: {
    title_ro: '❌ Predare respinsă',
    title_hu: '❌ Áru-leadás elutasítva',
    body_ro:  '{{rendszam}} — contactează dispecerul',
    body_hu:  '{{rendszam}} — egyeztess a diszpécserrel',
  },
  push_order_status: {
    title_ro: '🚛 Status cursă actualizat',
    title_hu: '🚛 Fuvar státusz frissítve',
    body_ro:  '{{sofor}} {{label}}: {{client}}',
    body_hu:  '{{sofor}} {{label}}: {{client}}',
  },
};

// Memória-cache — process újraindításig él; szerkesztés után invalidálódik.
let _cache = null;

async function getTemplates() {
  if (_cache) return _cache;
  try {
    const r = await getPool().query("SELECT value FROM developer_settings WHERE key='push_templates'");
    _cache = r.rows.length ? Object.assign({}, DEFAULTS, r.rows[0].value || {}) : DEFAULTS;
  } catch (e) {
    console.warn('[pushTemplates] DB hiba:', e.message);
    _cache = DEFAULTS;
  }
  return _cache;
}

function invalidateCache() { _cache = null; }

// {{változó}} → érték (nincs HTML-escape, push szövegben nem kell)
function applyVars(text, vars) {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] != null ? String(vars[k]) : '');
}

async function getTemplate(key) {
  const tpls = await getTemplates();
  return tpls[key] || DEFAULTS[key] || {};
}

module.exports = { getTemplate, getTemplates, invalidateCache, applyVars, DEFAULTS };
