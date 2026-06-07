// services/billing/http.js
// Közös HTTP segéd a számlázó-adapterekhez (timeout + JSON parse).
async function fetchT(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 15000);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } finally {
    clearTimeout(t);
  }
}

async function jsonT(url, opts, ms) {
  const res = await fetchT(url, opts, ms);
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { _raw: text }; }
  return { status: res.status, ok: res.ok, data };
}

module.exports = { fetchT, jsonT };
