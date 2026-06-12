// ============================================================
//  VallorSoft — public/portal.js  (ügyfél-portál kliens)
//  Belépés / jelszó-beállítás / fuvar-lista + élő követés + dokumentum-
//  letöltés + új-fuvar igénylés. Minden adat a /api/portal/* végpontokról.
// ============================================================
(function () {
  var _orders = [], _map = null, _mLayer = null, _setToken = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function show(view) { ['viewLogin', 'viewSet', 'viewDash'].forEach(function (v) { $(v).classList.toggle('hidden', v !== view); }); }
  function toast(msg, kind) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast show ' + (kind || '');
    clearTimeout(window.__tt); window.__tt = setTimeout(function () { t.className = 'toast ' + (kind || ''); }, 2600);
  }
  function api(method, url, body) {
    return fetch(url, { method: method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json(); });
  }

  function fmtD(d) { if (!d) return '—'; var s = String(d).slice(0, 10); var p = s.split('-'); return p.length === 3 ? (p[2] + '.' + p[1] + '.') : s; }
  var ST = {
    Disponibil: { c: 'b-info', t: 'Kiosztásra vár' }, Alocat: { c: 'b-warn', t: 'Kiosztva' },
    'In Curs': { c: 'b-ok', t: 'Úton' }, Finalizat: { c: 'b-info', t: 'Teljesített' },
    Parkolt: { c: 'b-warn', t: 'Parkolt' }, Raktarban: { c: 'b-warn', t: 'Raktárban' }, Extern: { c: 'b-warn', t: 'Külsős' },
  };

  // ── Init: ?token → jelszó-beállítás; egyébként session-ellenőrzés ──
  function init() {
    var q = new URLSearchParams(location.search);
    _setToken = q.get('token');
    if (_setToken) { show('viewSet'); return; }
    api('GET', '/api/portal/me').then(function (r) {
      if (r && r.ok) { fillMe(r); show('viewDash'); loadOrders(); }
      else show('viewLogin');
    }).catch(function () { show('viewLogin'); });
  }

  function fillMe(r) {
    $('dClient').textContent = r.client_nev || r.nev || '';
    $('dCeg').textContent = 'Fuvarozó: ' + (r.ceg_nev || '');
    $('dAv').textContent = (r.client_nev || r.email || '?').charAt(0).toUpperCase();
  }

  function login() {
    var email = $('liEmail').value.trim(), pass = $('liPass').value;
    if (!email || !pass) { toast('Add meg az e-mailt és jelszót.', 'err'); return; }
    api('POST', '/api/portal/login', { email: email, password: pass }).then(function (r) {
      if (r && r.ok) { api('GET', '/api/portal/me').then(function (m) { if (m.ok) fillMe(m); show('viewDash'); loadOrders(); }); }
      else toast((r && r.err) || 'Hibás belépés', 'err');
    });
  }

  function setPw() {
    var p1 = $('spPass').value, p2 = $('spPass2').value;
    if (p1.length < 6) { toast('A jelszó legalább 6 karakter legyen.', 'err'); return; }
    if (p1 !== p2) { toast('A két jelszó nem egyezik.', 'err'); return; }
    api('POST', '/api/portal/set-password', { token: _setToken, password: p1 }).then(function (r) {
      if (r && r.ok) {
        history.replaceState(null, '', '/portal');
        api('GET', '/api/portal/me').then(function (m) { if (m.ok) fillMe(m); show('viewDash'); loadOrders(); });
        toast('Jelszó beállítva — üdv a portálon!', 'ok');
      } else toast((r && r.err) || 'Hiba', 'err');
    });
  }

  function logout() { api('POST', '/api/portal/logout').then(function () { location.href = '/portal'; }); }

  // ── Fuvarok ──
  function loadOrders() {
    api('GET', '/api/portal/orders').then(function (r) {
      if (!r || !r.ok) { $('dOrders').innerHTML = '<div class="muted" style="text-align:center;padding:20px">Betöltési hiba.</div>'; return; }
      _orders = r.orders || [];
      var s = r.stats || {};
      $('dStats').innerHTML =
        tile('Aktív fuvar', s.active || 0) + tile('Úton most', s.onroad || 0, '#4ade80') +
        tile('Összes (lista)', _orders.length) + tile('Fizetésre vár', s.unpaid || 0, (s.unpaid ? '#ff6b75' : ''));
      if (!_orders.length) { $('dOrders').innerHTML = '<div class="muted" style="text-align:center;padding:24px">Még nincs fuvarod nálunk rögzítve.</div>'; return; }
      $('dOrders').innerHTML = _orders.map(orderCard).join('');
    });
  }
  function tile(k, v, col) {
    return '<div class="glass tile"><div class="k">' + esc(k) + '</div><div class="v" style="' + (col ? 'color:' + col : '') + '">' + v + '</div></div>';
  }
  function orderCard(o) {
    var st = ST[o.status] || { c: 'b-info', t: o.status };
    var dims = (o.hossz_cm && o.szel_cm && o.mag_cm) ? ' · 📐 ' + o.hossz_cm + '×' + o.szel_cm + '×' + o.mag_cm : '';
    var lt = o.load_type ? '<span class="badge b-info">' + esc(o.load_type) + esc(dims) + '</span>' : '';
    var paid = (o.status === 'Finalizat' && o.payment_status !== 'paid')
      ? '<span class="badge b-red">Fizetésre vár' + (o.pret ? ' · ' + o.pret + ' €' : '') + '</span>' : '';
    var canTrack = ['Alocat', 'In Curs'].includes(o.status) && o.rendszam_camion;
    var docs = (o.documents || []).map(function (d) {
      return '<a class="chip" href="/api/portal/document/' + d.id + '">' + (d.signed ? '✍️' : '📄') + ' ' + esc(d.name) + '</a>';
    }).join('');
    docs += (o.pods || []).map(function (d) {
      return '<a class="chip" href="/api/portal/pod/' + d.id + '" target="_blank">📷 ' + esc(d.name) + '</a>';
    }).join('');
    return '<div class="ord">'
      + '<div class="row1"><span class="id">' + esc(o.id) + '</span>'
      + '<span class="badge ' + st.c + '">● ' + esc(st.t) + '</span>' + lt + paid
      + (o.ref ? '<span class="muted" style="margin-left:auto;font-size:12px">Ref: ' + esc(o.ref) + '</span>' : '') + '</div>'
      + '<div class="route">' + esc(o.loc_incarcare || '—') + ' → ' + esc(o.loc_descarcare || '—') + '</div>'
      + '<div class="meta">'
      + (o.rendszam_camion ? '<span>🚛 ' + esc(o.rendszam_camion) + '</span>' : '<span>🚛 kiosztás alatt</span>')
      + '<span>📅 Felrakás: ' + fmtD(o.data_incarcare) + '</span>'
      + (o.data_descarcare ? '<span>🏁 Lerakás: ' + fmtD(o.data_descarcare) + '</span>' : '')
      + (o.suly_kg ? '<span>⚖️ ' + o.suly_kg + ' kg</span>' : '')
      + (o.route_km ? '<span>🗺️ ~' + o.route_km + ' km</span>' : '')
      + '</div>'
      + '<div class="docs">'
      + (canTrack ? '<span class="chip" onclick="Portal.track(\'' + esc(o.id) + '\')">🗺️ Élő követés</span>' : '')
      + docs + '</div>'
      + '</div>';
  }

  // ── Élő követés (térkép modal) ──
  function track(id) {
    var o = _orders.find(function (x) { return String(x.id) === String(id); });
    $('mTitle').textContent = '🗺️ ' + id + (o ? ' — ' + (o.loc_incarcare || '') + ' → ' + (o.loc_descarcare || '') : '');
    $('mInfo').textContent = 'Pozíció lekérése…';
    $('mapModal').classList.add('open');
    setTimeout(function () { ensureMap(); }, 50);
    api('GET', '/api/portal/order/' + encodeURIComponent(id) + '/position').then(function (r) {
      ensureMap();
      if (_mLayer) _mLayer.clearLayers();
      if (r && r.ok && r.position) {
        var ll = [r.position.lat, r.position.lng];
        L.circleMarker(ll, { radius: 10, color: '#fff', weight: 3, fillColor: '#e10b1a', fillOpacity: .95 }).addTo(_mLayer)
          .bindTooltip('🚛 ' + (o ? (o.rendszam_camion || '') : ''), { permanent: false }).openTooltip();
        _map.setView(ll, 8);
        $('mInfo').textContent = 'Élő GPS-pozíció' + (r.position.speed != null ? ' · ' + Math.round(r.position.speed) + ' km/h' : '')
          + (r.position.datetime ? ' · ' + String(r.position.datetime).replace('T', ' ').slice(0, 16) : '');
      } else {
        $('mInfo').textContent = 'Most nincs élő pozíció (a fuvar még nem indult, vagy a jármű nincs GPS-re kötve).';
        _map.setView([46, 25], 5);
      }
    });
  }
  function ensureMap() {
    if (_map) { setTimeout(function () { _map.invalidateSize(); }, 40); return; }
    _map = L.map('pmap', { zoomControl: true }).setView([46, 25], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap, © CARTO' }).addTo(_map);
    _mLayer = L.layerGroup().addTo(_map);
    setTimeout(function () { _map.invalidateSize(); }, 60);
  }
  function closeMap() { $('mapModal').classList.remove('open'); }

  // ── Új fuvar igénylése ──
  function openRequest() { $('reqBox').classList.toggle('hidden'); $('reqHint').classList.toggle('hidden'); }
  function sendRequest() {
    var p = {
      loc_incarcare: $('rqFrom').value.trim(), loc_descarcare: $('rqTo').value.trim(),
      suly_kg: $('rqW').value || null, load_type: $('rqType').value || null,
      data_incarcare: $('rqDate').value || null, megjegyzes: $('rqNote').value.trim(),
    };
    if (!p.loc_incarcare || !p.loc_descarcare) { toast('A felrakó és lerakó cím kötelező.', 'err'); return; }
    api('POST', '/api/portal/request', p).then(function (r) {
      if (r && r.ok) {
        toast('✅ Igénylés elküldve a diszpécsernek!', 'ok');
        ['rqFrom', 'rqTo', 'rqW', 'rqDate', 'rqNote'].forEach(function (i) { $(i).value = ''; }); $('rqType').value = '';
        openRequest();
      } else toast((r && r.err) || 'Hiba', 'err');
    });
  }

  window.Portal = { login: login, setPw: setPw, logout: logout, track: track, closeMap: closeMap, openRequest: openRequest, sendRequest: sendRequest };
  document.addEventListener('DOMContentLoaded', init);
})();
