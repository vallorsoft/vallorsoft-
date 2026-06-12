// ============================================================
//  VallorSoft — public/konyvelo.js  (könyvelői felület)
//  Dokumentumok fuvarra/dátumra rendezve + tömeges ZIP-letöltés
//  (kijelölés vagy teljes hónap) + SAGA/WinMentor CSV-export.
// ============================================================
(function () {
  var _docs = [];
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m, k) { var t = $('toast'); t.textContent = m; t.style.opacity = '1'; t.style.borderColor = k === 'err' ? 'rgba(239,68,68,.6)' : k === 'ok' ? 'rgba(34,197,94,.6)' : 'rgba(255,255,255,.08)'; clearTimeout(window.__t); window.__t = setTimeout(function () { t.style.opacity = '0'; }, 2600); }
  function gas(fn, args) { return fetch('/api/execute', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ functionName: fn, arguments: args || [] }) }).then(function (r) { return r.json(); }).then(function (d) { return d.result; }); }
  function dstr(d) { return d ? String(d).slice(0, 10) : ''; }
  function T(k, v) { return (typeof window.t === 'function') ? window.t(k, v) : k; }

  function range() {
    var m = $('fMonth').value, f = $('fFrom').value, t = $('fTo').value;
    if (f || t) return { from: f || '2000-01-01', to: t || dstr(new Date().toISOString()) };
    if (m) { var y = m.split('-'); var last = new Date(+y[0], +y[1], 0).getDate(); return { from: m + '-01', to: m + '-' + ('0' + last).slice(-2) }; }
    var now = new Date(); var mm = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);
    var last2 = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return { from: mm + '-01', to: mm + '-' + ('0' + last2).slice(-2) };
  }

  function init() {
    var now = new Date(); $('fMonth').value = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);
    reload();
  }

  function reload() {
    var r = range();
    gas('getAccountingDocs', [{ from: r.from, to: r.to }]).then(function (res) {
      if (!res || !res.ok) { $('docList').innerHTML = '<div class="glass mut" style="padding:20px">' + esc(T('kv.loadErrPerm')) + '</div>'; return; }
      _docs = res.docs || [];
      $('kName').textContent = res.nev || ''; $('kCeg').textContent = res.ceg_nev || ''; $('kAv').textContent = (res.nev || '?').charAt(0).toUpperCase();
      $('kSales').textContent = res.sales_invoices || 0;
      $('kPur').textContent = res.purchase_invoices || 0;
      $('dlSales').href = '/api/accounting/invoices.csv?kind=sales&from=' + r.from + '&to=' + r.to;
      $('dlPur').href = '/api/accounting/invoices.csv?kind=purchases&from=' + r.from + '&to=' + r.to;
      renderDocs();
    });
  }

  function renderDocs() {
    var box = $('docList');
    if (!_docs.length) { box.innerHTML = '<div class="glass mut" style="padding:24px;text-align:center">' + esc(T('kv.noDocs')) + '</div>'; updateSel(); return; }
    // csoportosítás fuvarra
    var groups = {}, order = [];
    _docs.forEach(function (d, i) { var k = d.order_id || 'egyeb'; if (!groups[k]) { groups[k] = []; order.push(k); } d._i = i; groups[k].push(d); });
    box.innerHTML = order.map(function (k) {
      var ds = groups[k];
      var head = '<div class="ghead"><input type="checkbox" class="ck grpck" data-g="' + esc(k) + '" onchange="Konyv.toggleGroup(this)">'
        + '<span>🚚 <b>' + (k === 'egyeb' ? esc(T('kv.otherGroup')) : esc(k)) + '</b></span>'
        + (ds[0].client ? '<span class="mut" style="font-size:12px">· ' + esc(ds[0].client) + '</span>' : '')
        + '<span class="mut" style="font-size:12px;margin-left:auto">' + ds.length + ' ' + esc(T('kv.docsAbbr')) + '</span></div>';
      var rows = ds.map(function (d) {
        return '<div class="drow"><input type="checkbox" class="ck dck" data-i="' + d._i + '" onchange="Konyv.updateSel()">'
          + '<span class="badge">' + esc(d.type) + '</span>'
          + '<a href="/api/accounting/doc?src=' + d.src + '&id=' + d.id + '" target="_blank" style="color:var(--tx);text-decoration:none;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(d.name) + '</a>'
          + '<span class="mut" style="font-size:12px">' + dstr(d.created_at) + '</span></div>';
      }).join('');
      return '<div class="grp">' + head + rows + '</div>';
    }).join('');
    updateSel();
  }

  function selectedRefs() {
    var refs = [];
    Array.prototype.forEach.call(document.querySelectorAll('.dck:checked'), function (c) {
      var d = _docs[+c.getAttribute('data-i')]; if (d) refs.push({ src: d.src, id: d.id });
    });
    return refs;
  }
  function updateSel() { var n = document.querySelectorAll('.dck:checked').length; $('kSel').textContent = n ? T('kv.selected', { n: n }) : ''; }
  function toggleAll(ch) { Array.prototype.forEach.call(document.querySelectorAll('.dck,.grpck'), function (c) { c.checked = ch; }); updateSel(); }
  function toggleGroup(cb) {
    Array.prototype.forEach.call(document.querySelectorAll('.grp'), function (g) {
      if (g.querySelector('.grpck') === cb) Array.prototype.forEach.call(g.querySelectorAll('.dck'), function (c) { c.checked = cb.checked; });
    });
    updateSel();
  }

  function downloadBlob(resp, fallback) {
    if (!resp.ok) { toast(T('kv.dlErr'), 'err'); return; }
    resp.blob().then(function (b) {
      var url = URL.createObjectURL(b); var a = document.createElement('a'); a.href = url;
      a.download = (resp.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) ? RegExp.$1 : fallback;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
  }
  function zipSelected() {
    var refs = selectedRefs();
    if (!refs.length) { toast(T('kv.pickOne'), 'err'); return; }
    toast(T('kv.zipMaking'), 'ok');
    fetch('/api/accounting/zip', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refs: refs }) })
      .then(function (r) { downloadBlob(r, 'dokumentumok.zip'); });
  }
  function zipMonth() {
    var r = range(); toast(T('kv.zipMonthMaking'), 'ok');
    fetch('/api/accounting/zip', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: r.from, to: r.to }) })
      .then(function (resp) { downloadBlob(resp, 'havi-dokumentumok.zip'); });
  }

  function tab(which) {
    $('tabDocs').classList.toggle('active', which === 'docs'); $('tabInv').classList.toggle('active', which === 'inv');
    $('viewDocs').classList.toggle('hidden', which !== 'docs'); $('viewInv').classList.toggle('hidden', which !== 'inv');
  }
  function logout() { gas('authLogout').then(function () { location.href = '/login'; }).catch(function () { location.href = '/login'; }); }

  window.Konyv = { reload: reload, tab: tab, toggleAll: toggleAll, toggleGroup: toggleGroup, updateSel: updateSel, zipSelected: zipSelected, zipMonth: zipMonth, logout: logout };
  // Nyelvváltáskor a dinamikusan renderelt dok-lista is frissüljön (a statikus DOM-ot az i18n.js intézi)
  window.onLangChange = function () { renderDocs(); };
  document.addEventListener('DOMContentLoaded', init);
})();
