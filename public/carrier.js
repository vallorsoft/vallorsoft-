// ============================================================
//  VallorSoft — public/carrier.js  (alvállalkozói portál kliens)
//  Belépés/jelszó + rád osztott fuvarok + dokumentum le-/feltöltés
//  + saját jármű felvitele. Adat: /api/carrier/*.
// ============================================================
(function () {
  var _orders = [], _setToken = null;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function show(v) { ['viewLogin', 'viewSet', 'viewDash'].forEach(function (x) { $(x).classList.toggle('hidden', x !== v); }); }
  function toast(m, k) { var t = $('toast'); t.textContent = m; t.className = 'toast show ' + (k || ''); clearTimeout(window.__tt); window.__tt = setTimeout(function () { t.className = 'toast ' + (k || ''); }, 2600); }
  function api(method, url, body) { return fetch(url, { method: method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json(); }); }
  function fmtD(d) { if (!d) return '—'; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? (p[2] + '.' + p[1] + '.') : d; }
  var ST = { Disponibil: { c: 'b-info', t: 'Kiosztásra vár' }, Alocat: { c: 'b-warn', t: 'Kiosztva' }, 'In Curs': { c: 'b-ok', t: 'Úton' }, Finalizat: { c: 'b-info', t: 'Teljesített' }, Extern: { c: 'b-warn', t: 'Külsős' } };

  function init() {
    var q = new URLSearchParams(location.search); _setToken = q.get('token');
    if (_setToken) { show('viewSet'); return; }
    api('GET', '/api/carrier/me').then(function (r) { if (r && r.ok) { fillMe(r); show('viewDash'); loadAll(); } else show('viewLogin'); }).catch(function () { show('viewLogin'); });
  }
  function fillMe(r) { $('dCarrier').textContent = r.carrier_nev || r.nev || ''; $('dCeg').textContent = 'Fuvarozó: ' + (r.ceg_nev || ''); $('dAv').textContent = (r.carrier_nev || r.email || '?').charAt(0).toUpperCase(); }
  function login() { var e = $('liEmail').value.trim(), p = $('liPass').value; if (!e || !p) { toast('Add meg az e-mailt és jelszót.', 'err'); return; } api('POST', '/api/carrier/login', { email: e, password: p }).then(function (r) { if (r && r.ok) { api('GET', '/api/carrier/me').then(function (m) { if (m.ok) fillMe(m); show('viewDash'); loadAll(); }); } else toast((r && r.err) || 'Hibás belépés', 'err'); }); }
  function setPw() { var a = $('spPass').value, b = $('spPass2').value; if (a.length < 6) { toast('Min. 6 karakter.', 'err'); return; } if (a !== b) { toast('A két jelszó nem egyezik.', 'err'); return; } api('POST', '/api/carrier/set-password', { token: _setToken, password: a }).then(function (r) { if (r && r.ok) { history.replaceState(null, '', '/carrier'); api('GET', '/api/carrier/me').then(function (m) { if (m.ok) fillMe(m); show('viewDash'); loadAll(); }); toast('Jelszó beállítva!', 'ok'); } else toast((r && r.err) || 'Hiba', 'err'); }); }
  function logout() { api('POST', '/api/carrier/logout').then(function () { location.href = '/carrier'; }); }

  function loadAll() { loadOrders(); loadVehicles(); loadMyDocs(); }

  function loadOrders() {
    api('GET', '/api/carrier/orders').then(function (r) {
      if (!r || !r.ok) { $('dOrders').innerHTML = '<div class="mut" style="text-align:center;padding:20px">Betöltési hiba.</div>'; return; }
      _orders = r.orders || []; var s = r.stats || {};
      $('dStats').innerHTML = tile('Aktív fuvar', s.active || 0) + tile('Úton most', s.onroad || 0, '#4ade80') + tile('Neked fizetendő', (Math.round(s.payable || 0)) + ' €', '#fbbf24');
      // a fuvar-választó az upload-hoz
      var sel = $('uOrder'); if (sel) sel.innerHTML = '<option value="">— általános —</option>' + _orders.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.id) + ' · ' + esc(o.loc_incarcare || '') + '→' + esc(o.loc_descarcare || '') + '</option>'; }).join('');
      if (!_orders.length) { $('dOrders').innerHTML = '<div class="mut" style="text-align:center;padding:24px">Még nincs rád osztott fuvar.</div>'; return; }
      $('dOrders').innerHTML = _orders.map(card).join('');
    });
  }
  function tile(k, v, col) { return '<div class="glass tile"><div class="k">' + esc(k) + '</div><div class="v" style="' + (col ? 'color:' + col : '') + '">' + v + '</div></div>'; }
  function card(o) {
    var st = ST[o.status] || { c: 'b-info', t: o.status };
    var docs = (o.documents || []).map(function (d) {
      var url = d.src === 'order' ? '/api/carrier/order-doc/' + d.id : '/api/carrier/document/' + d.id;
      return '<a class="chip" href="' + url + '" target="_blank">' + (d.src === 'order' ? '📄' : '📎') + ' ' + esc(d.name) + '</a>';
    }).join('');
    return '<div class="ord"><div class="row1"><span class="id">' + esc(o.id) + '</span><span class="badge ' + st.c + '">● ' + esc(st.t) + '</span>'
      + (o.load_type ? '<span class="badge b-info">' + esc(o.load_type) + '</span>' : '')
      + (o.carrier_cost ? '<span class="badge b-warn" style="margin-left:auto">Díj: ' + Math.round(o.carrier_cost) + ' €</span>' : '') + '</div>'
      + '<div class="route">' + esc(o.loc_incarcare || '—') + ' → ' + esc(o.loc_descarcare || '—') + '</div>'
      + '<div class="meta">' + (o.rendszam_camion ? '<span>🚛 ' + esc(o.rendszam_camion) + '</span>' : '')
      + '<span>📅 Felrakás: ' + fmtD(o.data_incarcare) + '</span>' + (o.suly_kg ? '<span>⚖️ ' + o.suly_kg + ' kg</span>' : '')
      + (o.ref ? '<span>Ref: ' + esc(o.ref) + '</span>' : '') + '</div>'
      + '<div class="docs">' + (docs || '<span class="mut" style="font-size:12px">Nincs dokumentum még.</span>') + '</div></div>';
  }

  function loadVehicles() {
    api('GET', '/api/carrier/vehicles').then(function (r) {
      var box = $('dVehicles'); if (!box) return;
      var items = (r && r.items) || [];
      box.innerHTML = items.length ? items.map(function (v) {
        return '<div class="vrow"><div style="flex:1"><b>' + esc(v.rendszam_camion || '') + '</b>' + (v.rendszam_remorca ? ' + ' + esc(v.rendszam_remorca) : '') + (v.marca ? ' <span class="mut">' + esc(v.marca) + ' ' + esc(v.model || '') + '</span>' : '') + '</div>'
          + '<button class="btn" style="padding:5px 9px" onclick="Carrier.delVehicle(' + v.id + ')">✕</button></div>';
      }).join('') : '<div class="mut" style="font-size:12px">Még nincs felvitt jármű.</div>';
    });
  }
  function addVehicle() {
    var cam = $('vCam').value.trim(); if (!cam) { toast('A vontató rendszáma kötelező.', 'err'); return; }
    api('POST', '/api/carrier/vehicles', { rendszam_camion: cam, rendszam_remorca: $('vRem').value.trim(), marca: $('vMarca').value.trim(), model: $('vModel').value.trim() }).then(function (r) {
      if (r && r.ok) { toast('🚚 Jármű felvéve', 'ok'); ['vCam', 'vRem', 'vMarca', 'vModel'].forEach(function (i) { $(i).value = ''; }); loadVehicles(); } else toast((r && r.err) || 'Hiba', 'err');
    });
  }
  function delVehicle(id) { api('DELETE', '/api/carrier/vehicles/' + id).then(function (r) { if (r && r.ok) { toast('Törölve', 'ok'); loadVehicles(); } }); }

  function loadMyDocs() {
    api('GET', '/api/carrier/documents').then(function (r) {
      var box = $('dMyDocs'); if (!box) return; var items = (r && r.items) || [];
      if (!items.length) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="mut" style="font-size:11px;margin-bottom:5px">Feltöltéseim:</div>' + items.map(function (d) {
        return '<a class="chip" href="/api/carrier/document/' + d.id + '" target="_blank" style="margin:0 5px 5px 0">📎 ' + esc(d.file_name || '') + (d.order_id ? ' · ' + esc(d.order_id) : '') + '</a>';
      }).join('');
    });
  }
  function upload() {
    var f = ($('uFile').files || [])[0]; if (!f) { toast('Válassz fájlt.', 'err'); return; }
    if (f.size > 10 * 1024 * 1024) { toast('A fájl túl nagy (max 10 MB).', 'err'); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      api('POST', '/api/carrier/upload', { file_name: f.name, mime: f.type || 'application/octet-stream', data_base64: String(e.target.result || ''), kind: $('uKind').value, order_id: $('uOrder').value || null }).then(function (r) {
        if (r && r.ok) { toast('📎 Feltöltve', 'ok'); $('uFile').value = ''; loadMyDocs(); loadOrders(); } else toast((r && r.err) || 'Hiba', 'err');
      });
    };
    reader.readAsDataURL(f);
  }

  window.Carrier = { login: login, setPw: setPw, logout: logout, addVehicle: addVehicle, delVehicle: delVehicle, upload: upload };
  document.addEventListener('DOMContentLoaded', init);
})();
