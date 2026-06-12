// ============================================================
//  VallorSoft — public/carrier.js  (alvállalkozói portál kliens)
//  Belépés/jelszó + rád osztott fuvarok + dokumentum le-/feltöltés
//  + saját jármű felvitele. Adat: /api/carrier/*.
// ============================================================
(function () {
  var _orders = [], _stats = {}, _setToken = null;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function show(v) { ['viewLogin', 'viewSet', 'viewDash'].forEach(function (x) { $(x).classList.toggle('hidden', x !== v); }); }
  function toast(m, k) { var t = $('toast'); t.textContent = m; t.className = 'toast show ' + (k || ''); clearTimeout(window.__tt); window.__tt = setTimeout(function () { t.className = 'toast ' + (k || ''); }, 2600); }
  function api(method, url, body) { return fetch(url, { method: method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json(); }); }
  function fmtD(d) { if (!d) return '—'; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? (p[2] + '.' + p[1] + '.') : d; }
  function T(k, v) { return (typeof window.t === 'function') ? window.t(k, v) : k; }
  // státusz → CSS-osztály + i18n-kulcs (a felirat render-időben fordul)
  var ST = { Disponibil: { c: 'b-info', k: 'pt.stAvail' }, Alocat: { c: 'b-warn', k: 'pt.stAlloc' }, 'In Curs': { c: 'b-ok', k: 'pt.stRoad' }, Finalizat: { c: 'b-info', k: 'pt.stDone' }, Extern: { c: 'b-warn', k: 'pt.stExtern' } };

  function init() {
    var q = new URLSearchParams(location.search); _setToken = q.get('token');
    if (_setToken) { show('viewSet'); return; }
    api('GET', '/api/carrier/me').then(function (r) { if (r && r.ok) { fillMe(r); show('viewDash'); loadAll(); } else show('viewLogin'); }).catch(function () { show('viewLogin'); });
  }
  function fillMe(r) { $('dCarrier').textContent = r.carrier_nev || r.nev || ''; $('dCeg').textContent = T('pt.carrier') + (r.ceg_nev || ''); $('dAv').textContent = (r.carrier_nev || r.email || '?').charAt(0).toUpperCase(); }
  function login() { var e = $('liEmail').value.trim(), p = $('liPass').value; if (!e || !p) { toast(T('pt.giveEmailPw'), 'err'); return; } api('POST', '/api/carrier/login', { email: e, password: p }).then(function (r) { if (r && r.ok) { api('GET', '/api/carrier/me').then(function (m) { if (m.ok) fillMe(m); show('viewDash'); loadAll(); }); } else toast((r && r.err) || T('pt.badLogin'), 'err'); }); }
  function setPw() { var a = $('spPass').value, b = $('spPass2').value; if (a.length < 6) { toast(T('cp.pwMin6'), 'err'); return; } if (a !== b) { toast(T('pt.pwMismatch'), 'err'); return; } api('POST', '/api/carrier/set-password', { token: _setToken, password: a }).then(function (r) { if (r && r.ok) { history.replaceState(null, '', '/carrier'); api('GET', '/api/carrier/me').then(function (m) { if (m.ok) fillMe(m); show('viewDash'); loadAll(); }); toast(T('cp.pwSet'), 'ok'); } else toast((r && r.err) || T('common.error'), 'err'); }); }
  function logout() { api('POST', '/api/carrier/logout').then(function () { location.href = '/carrier'; }); }

  function loadAll() { loadOrders(); loadVehicles(); loadMyDocs(); }

  function loadOrders() {
    api('GET', '/api/carrier/orders').then(function (r) {
      if (!r || !r.ok) { $('dOrders').innerHTML = '<div class="mut" style="text-align:center;padding:20px">' + esc(T('common.loadErr')) + '</div>'; return; }
      _orders = r.orders || []; _stats = r.stats || {};
      renderOrders();
    });
  }
  function renderOrders() {
    var s = _stats || {};
    $('dStats').innerHTML = tile(T('cp.kpiActive'), s.active || 0) + tile(T('cp.kpiRoad'), s.onroad || 0, '#4ade80') + tile(T('cp.kpiPayable'), (Math.round(s.payable || 0)) + ' €', '#fbbf24');
    // a fuvar-választó az upload-hoz
    var sel = $('uOrder'); if (sel) sel.innerHTML = '<option value="">' + esc(T('cp.general')) + '</option>' + _orders.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.id) + ' · ' + esc(o.loc_incarcare || '') + '→' + esc(o.loc_descarcare || '') + '</option>'; }).join('');
    if (!_orders.length) { $('dOrders').innerHTML = '<div class="mut" style="text-align:center;padding:24px">' + esc(T('cp.noOrders')) + '</div>'; return; }
    $('dOrders').innerHTML = _orders.map(card).join('');
  }
  function tile(k, v, col) { return '<div class="glass tile"><div class="k">' + esc(k) + '</div><div class="v" style="' + (col ? 'color:' + col : '') + '">' + v + '</div></div>'; }
  function card(o) {
    var st = ST[o.status] || { c: 'b-info', k: null };
    var stT = st.k ? T(st.k) : o.status;
    var docs = (o.documents || []).map(function (d) {
      var url = d.src === 'order' ? '/api/carrier/order-doc/' + d.id : '/api/carrier/document/' + d.id;
      return '<a class="chip" href="' + url + '" target="_blank">' + (d.src === 'order' ? '📄' : '📎') + ' ' + esc(d.name) + '</a>';
    }).join('');
    return '<div class="ord"><div class="row1"><span class="id">' + esc(o.id) + '</span><span class="badge ' + st.c + '">● ' + esc(stT) + '</span>'
      + (o.load_type ? '<span class="badge b-info">' + esc(o.load_type) + '</span>' : '')
      + (o.carrier_cost ? '<span class="badge b-warn" style="margin-left:auto">' + esc(T('cp.fee')) + Math.round(o.carrier_cost) + ' €</span>' : '') + '</div>'
      + '<div class="route">' + esc(o.loc_incarcare || '—') + ' → ' + esc(o.loc_descarcare || '—') + '</div>'
      + '<div class="meta">' + (o.rendszam_camion ? '<span>🚛 ' + esc(o.rendszam_camion) + '</span>' : '')
      + '<span>' + esc(T('pt.loadAt')) + fmtD(o.data_incarcare) + '</span>' + (o.suly_kg ? '<span>⚖️ ' + o.suly_kg + ' kg</span>' : '')
      + (o.ref ? '<span>Ref: ' + esc(o.ref) + '</span>' : '') + '</div>'
      + '<div class="docs">' + (docs || '<span class="mut" style="font-size:12px">' + esc(T('cp.noDocs')) + '</span>') + '</div></div>';
  }

  function loadVehicles() {
    api('GET', '/api/carrier/vehicles').then(function (r) {
      var box = $('dVehicles'); if (!box) return;
      var items = (r && r.items) || [];
      box.innerHTML = items.length ? items.map(function (v) {
        return '<div class="vrow"><div style="flex:1"><b>' + esc(v.rendszam_camion || '') + '</b>' + (v.rendszam_remorca ? ' + ' + esc(v.rendszam_remorca) : '') + (v.marca ? ' <span class="mut">' + esc(v.marca) + ' ' + esc(v.model || '') + '</span>' : '') + '</div>'
          + '<button class="btn" style="padding:5px 9px" onclick="Carrier.delVehicle(' + v.id + ')">✕</button></div>';
      }).join('') : '<div class="mut" style="font-size:12px">' + esc(T('cp.noVehicles')) + '</div>';
    });
  }
  function addVehicle() {
    var cam = $('vCam').value.trim(); if (!cam) { toast(T('cp.tractorReq'), 'err'); return; }
    api('POST', '/api/carrier/vehicles', { rendszam_camion: cam, rendszam_remorca: $('vRem').value.trim(), marca: $('vMarca').value.trim(), model: $('vModel').value.trim() }).then(function (r) {
      if (r && r.ok) { toast(T('cp.vehAdded'), 'ok'); ['vCam', 'vRem', 'vMarca', 'vModel'].forEach(function (i) { $(i).value = ''; }); loadVehicles(); } else toast((r && r.err) || T('common.error'), 'err');
    });
  }
  function delVehicle(id) { api('DELETE', '/api/carrier/vehicles/' + id).then(function (r) { if (r && r.ok) { toast(T('cp.deleted'), 'ok'); loadVehicles(); } }); }

  function loadMyDocs() {
    api('GET', '/api/carrier/documents').then(function (r) {
      var box = $('dMyDocs'); if (!box) return; var items = (r && r.items) || [];
      if (!items.length) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="mut" style="font-size:11px;margin-bottom:5px">' + esc(T('cp.myUploads')) + '</div>' + items.map(function (d) {
        return '<a class="chip" href="/api/carrier/document/' + d.id + '" target="_blank" style="margin:0 5px 5px 0">📎 ' + esc(d.file_name || '') + (d.order_id ? ' · ' + esc(d.order_id) : '') + '</a>';
      }).join('');
    });
  }
  function upload() {
    var f = ($('uFile').files || [])[0]; if (!f) { toast(T('cp.chooseFile'), 'err'); return; }
    if (f.size > 10 * 1024 * 1024) { toast(T('cp.fileTooBig'), 'err'); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      api('POST', '/api/carrier/upload', { file_name: f.name, mime: f.type || 'application/octet-stream', data_base64: String(e.target.result || ''), kind: $('uKind').value, order_id: $('uOrder').value || null }).then(function (r) {
        if (r && r.ok) { toast(T('cp.uploaded'), 'ok'); $('uFile').value = ''; loadMyDocs(); loadOrders(); } else toast((r && r.err) || T('common.error'), 'err');
      });
    };
    reader.readAsDataURL(f);
  }

  window.Carrier = { login: login, setPw: setPw, logout: logout, addVehicle: addVehicle, delVehicle: delVehicle, upload: upload };
  // Nyelvváltáskor a dinamikusan renderelt lista + járművek + dokumentumok frissüljenek
  window.onLangChange = function () { if (!$('viewDash').classList.contains('hidden')) { renderOrders(); loadVehicles(); loadMyDocs(); } };
  document.addEventListener('DOMContentLoaded', init);
})();
