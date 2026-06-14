// ============================================================
//  VallorSoft — public/portal.js  (ügyfél-portál kliens)
//  Belépés / jelszó-beállítás / fuvar-lista + élő követés + dokumentum-
//  letöltés + új-fuvar igénylés. Minden adat a /api/portal/* végpontokról.
// ============================================================
(function () {
  var _orders = [], _requests = [], _map = null, _mLayer = null, _setToken = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function show(view) { ['viewLogin', 'viewSet', 'viewDash'].forEach(function (v) { $(v).classList.toggle('hidden', v !== view); }); }
  function toast(msg, kind) {
    var el = $('toast'); el.textContent = msg; el.className = 'toast show ' + (kind || '');
    clearTimeout(window.__tt); window.__tt = setTimeout(function () { el.className = 'toast ' + (kind || ''); }, 2600);
  }
  function api(method, url, body) {
    return fetch(url, { method: method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json(); });
  }

  function fmtD(d) { if (!d) return '—'; var s = String(d).slice(0, 10); var p = s.split('-'); return p.length === 3 ? (p[2] + '.' + p[1] + '.') : s; }
  function ST(status) {
    var M = {
      Disponibil: { c: 'b-info', k: 'por.stDisponibil' }, Alocat: { c: 'b-warn', k: 'por.stAlocat' },
      'In Curs': { c: 'b-ok', k: 'por.stInCurs' }, Finalizat: { c: 'b-info', k: 'por.stFinalizat' },
      Parkolt: { c: 'b-warn', k: 'por.stParkolt' }, Raktarban: { c: 'b-warn', k: 'por.stRaktarban' }, Extern: { c: 'b-warn', k: 'por.stExtern' },
    };
    var m = M[status];
    return m ? { c: m.c, t: t(m.k) } : { c: 'b-info', t: status };
  }

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
    $('dCeg').textContent = t('por.carrier') + ' ' + (r.ceg_nev || '');
    $('dAv').textContent = (r.client_nev || r.email || '?').charAt(0).toUpperCase();
  }

  function login() {
    var email = $('liEmail').value.trim(), pass = $('liPass').value;
    if (!email || !pass) { toast(t('por.enterEmailPass'), 'err'); return; }
    api('POST', '/api/portal/login', { email: email, password: pass }).then(function (r) {
      if (r && r.ok) { api('GET', '/api/portal/me').then(function (m) { if (m.ok) fillMe(m); show('viewDash'); loadOrders(); }); }
      else toast((r && r.err) || t('por.badLogin'), 'err');
    });
  }

  function setPw() {
    var p1 = $('spPass').value, p2 = $('spPass2').value;
    if (p1.length < 6) { toast(t('por.pwMin6'), 'err'); return; }
    if (p1 !== p2) { toast(t('por.pwMismatch'), 'err'); return; }
    api('POST', '/api/portal/set-password', { token: _setToken, password: p1 }).then(function (r) {
      if (r && r.ok) {
        history.replaceState(null, '', '/portal');
        api('GET', '/api/portal/me').then(function (m) { if (m.ok) fillMe(m); show('viewDash'); loadOrders(); });
        toast(t('por.pwSetWelcome'), 'ok');
      } else toast((r && r.err) || t('common.error'), 'err');
    });
  }

  function logout() { api('POST', '/api/portal/logout').then(function () { location.href = '/portal'; }); }

  // ── Fuvarok ──
  function loadOrders() {
    api('GET', '/api/portal/orders').then(function (r) {
      if (!r || !r.ok) { $('dOrders').innerHTML = '<div class="muted" style="text-align:center;padding:20px">' + esc(t('common.loadError')) + '.</div>'; return; }
      _orders = r.orders || [];
      _requests = r.requests || [];
      var s = r.stats || {};
      $('dStats').innerHTML =
        tile(t('por.tileActive'), s.active || 0) + tile(t('por.tileOnroad'), s.onroad || 0, '#16a34a') +
        tile(t('por.tileTotal'), _orders.length) + tile(t('por.tileUnpaid'), s.unpaid || 0, (s.unpaid ? '#dc2626' : ''));
      var html = '';
      if (_orders.length) html += _orders.map(orderCard).join('');
      else if (!_requests.length) html += '<div class="muted" style="text-align:center;padding:24px">' + esc(t('por.noOrdersYet')) + '</div>';
      // Beküldött kérések (feldolgozás alatt / elutasítva) — semmi ne „tűnjön el"
      if (_requests.length) {
        html += '<div class="muted" style="font-size:12.5px;font-weight:700;margin:14px 2px 8px">' + esc(t('por.reqSectionTitle')) + ' (' + _requests.length + ')</div>';
        html += _requests.map(requestCard).join('');
      }
      $('dOrders').innerHTML = html;
    });
  }
  function reqST(status) {
    if (status === 'rejected') return { c: 'b-red', t: t('por.reqRejected') };
    return { c: 'b-warn', t: t('por.reqPending') };   // new / parsed / reviewed
  }
  function requestCard(q) {
    var st = reqST(q.status);
    return '<div class="ord">'
      + '<div class="row1"><span class="id">📋 ' + esc(t('por.reqLabel')) + '</span>'
      + '<span class="badge ' + st.c + '">● ' + esc(st.t) + '</span>'
      + (q.load_type ? '<span class="badge b-info">' + esc(q.load_type) + '</span>' : '')
      + (q.has_doc ? '<span class="badge b-info">📎</span>' : '')
      + (q.ref ? '<span class="muted" style="margin-left:auto;font-size:12px">' + esc(t('por.refLabel')) + ' ' + esc(q.ref) + '</span>' : '') + '</div>'
      + '<div class="route">' + esc(q.loc_incarcare || '—') + ' → ' + esc(q.loc_descarcare || '—') + '</div>'
      + '<div class="meta">'
      + '<span>🕒 ' + fmtD(q.received_at) + '</span>'
      + (q.suly_kg ? '<span>⚖️ ' + q.suly_kg + ' kg</span>' : '')
      + '</div></div>';
  }
  function tile(k, v, col) {
    return '<div class="glass tile"><div class="k">' + esc(k) + '</div><div class="v" style="' + (col ? 'color:' + col : '') + '">' + v + '</div></div>';
  }
  function orderCard(o) {
    var st = ST(o.status);
    var dims = (o.hossz_cm && o.szel_cm && o.mag_cm) ? ' · 📐 ' + o.hossz_cm + '×' + o.szel_cm + '×' + o.mag_cm : '';
    var lt = o.load_type ? '<span class="badge b-info">' + esc(o.load_type) + esc(dims) + '</span>' : '';
    var paid = (o.status === 'Finalizat' && o.payment_status !== 'paid')
      ? '<span class="badge b-red">' + esc(t('por.unpaidBadge')) + (o.pret ? ' · ' + o.pret + ' €' : '') + '</span>' : '';
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
      + (o.ref ? '<span class="muted" style="margin-left:auto;font-size:12px">' + esc(t('por.refLabel')) + ' ' + esc(o.ref) + '</span>' : '') + '</div>'
      + '<div class="route">' + esc(o.loc_incarcare || '—') + ' → ' + esc(o.loc_descarcare || '—') + '</div>'
      + '<div class="meta">'
      + (o.rendszam_camion ? '<span>🚛 ' + esc(o.rendszam_camion) + '</span>' : '<span>🚛 ' + esc(t('por.assigning')) + '</span>')
      + '<span>📅 ' + esc(t('por.loadingShort')) + ' ' + fmtD(o.data_incarcare) + '</span>'
      + (o.data_descarcare ? '<span>🏁 ' + esc(t('por.unloadingShort')) + ' ' + fmtD(o.data_descarcare) + '</span>' : '')
      + (o.suly_kg ? '<span>⚖️ ' + o.suly_kg + ' kg</span>' : '')
      + (o.route_km ? '<span>🗺️ ~' + o.route_km + ' km</span>' : '')
      + '</div>'
      + '<div class="docs">'
      + (canTrack ? '<span class="chip" onclick="Portal.track(\'' + esc(o.id) + '\')">🗺️ ' + esc(t('por.liveTrack')) + '</span>' : '')
      + docs + '</div>'
      + '</div>';
  }

  // ── Élő követés (térkép modal) ──
  function track(id) {
    var o = _orders.find(function (x) { return String(x.id) === String(id); });
    $('mTitle').textContent = '🗺️ ' + id + (o ? ' — ' + (o.loc_incarcare || '') + ' → ' + (o.loc_descarcare || '') : '');
    $('mInfo').textContent = t('por.fetchingPos');
    $('mapModal').classList.add('open');
    setTimeout(function () { ensureMap(); }, 50);
    api('GET', '/api/portal/order/' + encodeURIComponent(id) + '/position').then(function (r) {
      ensureMap();
      if (_mLayer) _mLayer.clearLayers();
      if (r && r.ok && r.position) {
        var ll = [r.position.lat, r.position.lng];
        L.circleMarker(ll, { radius: 10, color: '#fff', weight: 3, fillColor: '#6366f1', fillOpacity: .95 }).addTo(_mLayer)
          .bindTooltip('🚛 ' + (o ? (o.rendszam_camion || '') : ''), { permanent: false }).openTooltip();
        _map.setView(ll, 8);
        $('mInfo').textContent = t('por.livePos') + (r.position.speed != null ? ' · ' + Math.round(r.position.speed) + ' km/h' : '')
          + (r.position.datetime ? ' · ' + String(r.position.datetime).replace('T', ' ').slice(0, 16) : '');
      } else {
        $('mInfo').textContent = t('por.noLivePos');
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
      ref: $('rqRef').value.trim(),
      loc_incarcare: $('rqFrom').value.trim(), loc_descarcare: $('rqTo').value.trim(),
      data_incarcare: $('rqDate').value || null, data_descarcare: $('rqDate2').value || null,
      suly_kg: $('rqW').value || null, load_type: $('rqType').value || null,
      hossz_cm: $('rqLen').value || null, szel_cm: $('rqWid').value || null, mag_cm: $('rqHei').value || null,
      megjegyzes: $('rqNote').value.trim(),
    };
    var clearAll = function () {
      ['rqRef', 'rqFrom', 'rqTo', 'rqW', 'rqDate', 'rqDate2', 'rqLen', 'rqWid', 'rqHei', 'rqNote', 'rqDoc']
        .forEach(function (i) { if ($(i)) $(i).value = ''; });
      $('rqType').value = '';
    };
    var submit = function () {
      api('POST', '/api/portal/request', p).then(function (r) {
        if (r && r.ok) { toast(t('por.reqSent'), 'ok'); clearAll(); openRequest(); }
        else toast((r && r.err) || t('common.error'), 'err');
      });
    };
    // Opcionális dokumentum beolvasása base64-be (max ~10 MB), majd küldés.
    var f = $('rqDoc') && $('rqDoc').files && $('rqDoc').files[0];
    if (f) {
      if (f.size > 10 * 1024 * 1024) { toast(t('por.docTooLarge'), 'err'); return; }
      var rd = new FileReader();
      rd.onload = function (e) { p.doc_base64 = e.target.result; p.doc_name = f.name; submit(); };
      rd.onerror = function () { toast(t('common.error'), 'err'); };
      rd.readAsDataURL(f);
    } else { submit(); }
  }

  window.Portal = { login: login, setPw: setPw, logout: logout, track: track, closeMap: closeMap, openRequest: openRequest, sendRequest: sendRequest };
  // Nyelvváltáskor a JS-ből renderelt fuvar-lista/statisztika újrarajzolása
  window.onLangChange = function () {
    if (!$('viewDash').classList.contains('hidden')) loadOrders();
  };
  document.addEventListener('DOMContentLoaded', init);
})();
