// ============================================================
//  VallorSoft — public/doc-archive.js
//  Kötelező éves dokumentum-archívum (lib/docArchive):
//   • 30 nappal a határidő előtt figyelmeztető sáv a konzol tetején;
//   • az utolsó 5 napban (és lejárat után) nem bezárható, teljes képernyős zár —
//     CSAK a letöltés és a ZIP-ben lévő kód visszaírása működik (a szerver is zárol:
//     middleware/archiveLock.js);
//   • bármikor megnyitható: DocArchive.open().
// ============================================================
window.DocArchive = (function () {
  var st = { s: null, downloading: false };

  function tt(key, fb, p) {
    var v = fb;
    try { if (typeof t === 'function') { var x = t(key); if (x && x !== key) v = x; } } catch (e) {}
    if (p) Object.keys(p).forEach(function (k) { v = String(v).split('{' + k + '}').join(p[k]); });
    return v;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('ro-RO') : ''; }
  function fmtSize(b) { b = Number(b) || 0; return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB'; }
  function call(fn, args) {
    return fetch('/api/execute', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName: fn, arguments: args || [] }) }).then(function (r) { return r.json(); }).then(function (d) { return d.result; });
  }

  function ensureStyle() {
    if (document.getElementById('dar-style')) return;
    var s = document.createElement('style');
    s.id = 'dar-style';
    s.textContent =
      '.dar-band{display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-radius:14px;padding:12px 16px;margin:0 0 14px;font-size:13.5px;font-weight:600;border:1.5px solid}' +
      '.dar-warn{background:#fffbeb;border-color:#f59e0b;color:#78350f}.dar-lockb{background:#fef2f2;border-color:#ef4444;color:#7f1d1d}' +
      '.dar-band b{font-weight:800}.dar-band .dar-sp{flex:1 1 260px;min-width:0}' +
      '.dar-band button{padding:7px 12px;border-radius:9px;border:0;background:#b45309;color:#fff;font-weight:700;cursor:pointer}' +
      '.dar-lockb button{background:#b91c1c}' +
      '.dar-ov{position:fixed;inset:0;background:rgba(15,23,42,.62);z-index:100000;display:flex;align-items:center;justify-content:center;padding:14px}' +
      '.dar-mod{background:#fff;color:#0f172a;border-radius:18px;padding:22px;width:100%;max-width:620px;max-height:94vh;overflow:auto;box-shadow:0 24px 60px rgba(15,23,42,.35);box-sizing:border-box}' +
      '.dar-mod h3{margin:0 0 6px;font-size:19px;color:#0f172a}.dar-mod p{margin:0 0 10px;font-size:13.5px;color:#334155;line-height:1.5}' +
      '.dar-alert{border-radius:12px;padding:10px 14px;font-weight:700;font-size:13.5px;margin-bottom:12px}' +
      '.dar-a-lock{background:#fef2f2;border:1.5px solid #ef4444;color:#7f1d1d}.dar-a-warn{background:#fffbeb;border:1.5px solid #f59e0b;color:#78350f}.dar-a-ok{background:#f0fdf4;border:1.5px solid #22c55e;color:#14532d}' +
      '.dar-step{border:1.5px solid #cbd5e1;border-radius:12px;padding:12px 14px;margin-bottom:10px}' +
      '.dar-step b{display:block;margin-bottom:6px;color:#0f172a}' +
      '.dar-btn{display:inline-block;padding:10px 16px;border-radius:10px;border:0;background:#1d4ed8;color:#fff;font-weight:800;cursor:pointer;text-decoration:none;font-size:14px}' +
      '.dar-btn.ok{background:#15803d}.dar-btn.gh{background:#fff;color:#0f172a;border:1.5px solid #64748b}' +
      '.dar-code{display:flex;gap:8px;flex-wrap:wrap}.dar-code input{flex:1 1 220px;min-width:0;padding:10px 12px;border:1.5px solid #64748b;border-radius:10px;font-size:16px;letter-spacing:1px;color:#0f172a;background:#fff}' +
      '.dar-hist{font-size:12px;color:#334155;margin-top:8px}.dar-hist summary{cursor:pointer;color:#1d4ed8;font-weight:700}' +
      '.dar-hist li{margin:2px 0}.dar-msg{font-size:13px;font-weight:700;margin-top:8px}.dar-err{color:#b91c1c}.dar-okm{color:#15803d}';
    document.head.appendChild(s);
  }

  // ── Figyelmeztető sáv ───────────────────────────────────────
  function renderBand() {
    var host = document.getElementById('mainContent') || document.querySelector('.main-content');
    var old = document.getElementById('darBand');
    var s = st.s;
    if (!host || !s || s.phase === 'ok') { if (old) old.remove(); return; }
    if (!old) {
      old = document.createElement('div');
      old.id = 'darBand';
      var top = host.querySelector('.vs-topbar');
      if (top && top.parentNode === host) host.insertBefore(old, top.nextSibling); else host.insertBefore(old, host.firstChild);
    }
    var lock = s.phase === 'lock';
    old.className = 'dar-band ' + (lock ? 'dar-lockb' : 'dar-warn');
    old.innerHTML = '<span>' + (lock ? '⛔' : '📦') + '</span><span class="dar-sp">' +
      esc(lock ? tt('dar.bandLock', 'Arhiva documentelor trebuie descărcată acum — până atunci nu poți folosi nimic altceva.')
        : tt('dar.bandWarn', 'Descarcă arhiva anuală a documentelor în {d} zile (până la {date}). Dacă amâni, în ultimele {l} zile nu vei mai putea face nimic până nu o descarci.',
          { d: Math.max(s.days_left, 0), date: fmtDate(s.due_at), l: s.lock_days })) +
      '</span><button onclick="DocArchive.open()">' + esc(tt('dar.open', 'Arhiva documentelor')) + '</button>';
  }

  // ── Ablak (bezárható, ha nincs zár) ────────────────────────
  function open() {
    ensureStyle();
    var ov = document.getElementById('darOv');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'darOv';
      ov.className = 'dar-ov';
      ov.innerHTML = '<div class="dar-mod vs-light-surface" id="darMod"></div>';
      document.body.appendChild(ov);
    }
    renderModal();
  }
  function close() {
    if (st.s && st.s.phase === 'lock') return;   // zár alatt nem zárható be
    var o = document.getElementById('darOv'); if (o) o.remove();
  }

  function renderModal() {
    var mod = document.getElementById('darMod');
    if (!mod) return;
    var s = st.s || {};
    var lock = s.phase === 'lock';
    var alertCls = lock ? 'dar-a-lock' : s.phase === 'warn' ? 'dar-a-warn' : 'dar-a-ok';
    var alertTxt = lock
      ? tt('dar.alertLock', '⛔ Termenul expiră în {d} zile (până la {date}). Până nu descarci arhiva și nu confirmi codul, nu poți folosi nicio altă funcție.', { d: Math.max(s.days_left || 0, 0), date: fmtDate(s.due_at) })
      : s.phase === 'warn'
        ? tt('dar.alertWarn', '⚠️ Termenul expiră în {d} zile (până la {date}). Dacă amâni, în ultimele {l} zile nu vei mai putea face nimic în aplicație până nu descarci arhiva.', { d: s.days_left, date: fmtDate(s.due_at), l: s.lock_days })
        : tt('dar.alertOk', '✅ Următorul termen: {date} ({d} zile).', { d: s.days_left, date: fmtDate(s.due_at) });
    var hist = (s.history || []).map(function (h) {
      return '<li>' + esc(new Date(h.created_at).toLocaleString('ro-RO')) + (h.created_by ? ' · ' + esc(h.created_by) : '') +
        (h.completed ? ' · ' + esc(tt('dar.files', '{n} fișiere', { n: h.file_count || 0 })) + ' · ' + esc(fmtSize(h.total_bytes)) : ' · ' + esc(tt('dar.incomplete', 'întreruptă'))) +
        (h.confirmed_at ? ' · ✅ ' + esc(tt('dar.confirmedAt', 'confirmată')) + ' ' + esc(fmtDate(h.confirmed_at)) : '') + '</li>';
    }).join('');
    mod.innerHTML =
      '<h3>📦 ' + esc(tt('dar.title', 'Arhiva anuală a documentelor')) + '</h3>' +
      '<div class="dar-alert ' + alertCls + '">' + esc(alertTxt) + '</div>' +
      '<p>' + esc(tt('dar.intro', 'Arhiva conține toate documentele firmei tale, încărcate sau generate de orice utilizator (comenzi, facturi, foi de parcurs, CMR, poze, documentele subcontractorilor etc.), împărțite în foldere pe luni și tipuri. Conține doar datele firmei tale.')) + '</p>' +
      '<div class="dar-step"><b>1. ' + esc(tt('dar.step1', 'Descarcă arhiva (ZIP)')) + '</b>' +
        '<p>' + esc(tt('dar.step1Hint', 'Descărcarea poate dura câteva minute. Nu închide fereastra până nu se termină.')) + '</p>' +
        '<a class="dar-btn" id="darDl" href="/api/doc-archive/download" onclick="DocArchive._dl()">⬇️ ' + esc(tt('dar.download', 'Descarcă arhiva')) + '</a>' +
        '<div class="dar-msg" id="darDlMsg"></div></div>' +
      '<div class="dar-step"><b>2. ' + esc(tt('dar.step2', 'Confirmă codul')) + '</b>' +
        '<p>' + esc(tt('dar.step2Hint', 'Deschide fișierul KOD-ARHIVA.txt din arhiva descărcată și copiază aici codul (10–20 de cifre).')) + '</p>' +
        '<div class="dar-code"><input id="darCode" inputmode="numeric" autocomplete="off" placeholder="' + esc(tt('dar.codePh', 'ex. 4821093375510248')) + '">' +
        '<button class="dar-btn ok" onclick="DocArchive._confirm()">✓ ' + esc(tt('dar.confirm', 'Confirmă')) + '</button></div>' +
        '<div class="dar-msg" id="darMsg"></div></div>' +
      (hist ? '<details class="dar-hist"><summary>' + esc(tt('dar.history', 'Arhive anterioare')) + '</summary><ul>' + hist + '</ul></details>' : '') +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap;">' +
        (lock ? '<button class="dar-btn gh" onclick="DocArchive._logout()">' + esc(tt('dar.logout', 'Deconectare')) + '</button>'
          : '<button class="dar-btn gh" onclick="DocArchive.close()">' + esc(tt('common.close', 'Închide')) + '</button>') +
      '</div>';
  }

  function _dl() {
    var m = document.getElementById('darDlMsg');
    if (m) { m.className = 'dar-msg'; m.textContent = '⏳ ' + tt('dar.dlStarted', 'Descărcarea a pornit — după terminare copiază codul din KOD-ARHIVA.txt.'); }
    setTimeout(function () { var c = document.getElementById('darCode'); if (c) c.focus(); }, 800);
  }
  function _confirm() {
    var inp = document.getElementById('darCode');
    var msg = document.getElementById('darMsg');
    var code = String((inp && inp.value) || '').replace(/\D/g, '');
    if (code.length < 10 || code.length > 20) { if (msg) { msg.className = 'dar-msg dar-err'; msg.textContent = tt('dar.codeLen', 'Codul are 10–20 de cifre.'); } return; }
    call('docArchiveConfirm', [{ code: code }]).then(function (r) {
      if (!r || !r.ok) { if (msg) { msg.className = 'dar-msg dar-err'; msg.textContent = (r && r.err) || 'Eroare'; } return; }
      if (msg) { msg.className = 'dar-msg dar-okm'; msg.textContent = tt('dar.confirmed', '✅ Arhiva a fost confirmată. Următorul termen: {date}.', { date: fmtDate(r.due_at) }); }
      var wasLocked = st.s && st.s.phase === 'lock';
      refresh().then(function () {
        renderModal();
        if (wasLocked) setTimeout(function () { location.reload(); }, 1200);
      });
    });
  }
  function _logout() {
    call('authLogout', []).then(function () { location.href = '/login'; }, function () { location.href = '/login'; });
  }

  function refresh() {
    return call('docArchiveStatus', []).then(function (r) {
      if (!r || !r.ok) return;
      st.s = r;
      ensureStyle();
      renderBand();
      if (r.phase === 'lock') open();
      else if (document.getElementById('darOv')) renderModal();
    }).catch(function () {});
  }

  function init() {
    refresh();
    setInterval(refresh, 30 * 60 * 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 600); });
  else setTimeout(init, 600);

  return { open: open, close: close, refresh: refresh, _dl: _dl, _confirm: _confirm, _logout: _logout };
})();
