// ============================================================
//  VallorSoft — Sofőr: a rendszer által (GPS-ből) pótolt állomás-gombok
//  átnézése. Belépéskor (és a főoldalra visszatérve) felugrik, ha van
//  még át nem nézett automatikus rögzítés: sorban kiírja, a sofőr
//  leokézza, vagy javítja az időt / a helyet a térképen.
//  Szerver: handlers/stopAutoEvents.js. A tényleges cím szövege nem jön
//  ide — a térképen csak a pont látszik. A Leaflet csak térkép-nyitáskor
//  töltődik be (cdnjs).
// ============================================================
(function () {
  'use strict';
  var S = { items: [], loading: false, editId: null, mapId: null, map: null, pick: null, pickMarker: null, mapData: {}, leaflet: null };

  function _t(k, d) { try { var v = window.t ? window.t(k) : k; return (v && v !== k) ? v : (d || k); } catch (_) { return d || k; } }
  function _e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function _toast(m, k) { if (typeof window.toast === 'function') window.toast(m, k); }
  function _gas(fn, args) {
    return fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName: fn, arguments: args || [] }) })
      .then(function (r) { return r.json(); }).then(function (d) { return d && d.result; });
  }
  function _dt(v) {
    if (!v) return '—';
    var d = new Date(v); if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(window.I18N && window.I18N.get && window.I18N.get() === 'hu' ? 'hu-HU' : 'ro-RO', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function _local(v) {   // ISO → datetime-local érték (helyi idő)
    if (!v) return '';
    var d = new Date(v); if (isNaN(d.getTime())) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function _toIso(local) { if (!local) return ''; var d = new Date(local); return isNaN(d.getTime()) ? '' : d.toISOString(); }
  function _modal() { return document.getElementById('autoStopModal'); }
  function _body() { return document.getElementById('asBody'); }
  function _isOpen() { var m = _modal(); return !!(m && m.style.display === 'flex'); }

  function load() {
    if (S.loading || _isOpen()) return;
    S.loading = true;
    _gas('getMyAutoStopEvents').then(function (r) {
      S.loading = false;
      if (!r || !r.ok || !r.items || !r.items.length) return;
      S.items = r.items.map(function (x) { x.id = Number(x.id); return x; });   // bigint → szám (az onclick számot ad)
      open();
    }).catch(function () { S.loading = false; });
  }

  function open() {
    var m = _modal(); if (!m) return;
    S.editId = null; S.mapId = null;
    render();
    m.style.display = 'flex';
    preload();
  }

  // Előtöltés: a térkép-könyvtár + az első tételek térkép-adata a háttérben,
  // hogy a „Javítás térképen" azonnal nyíljon (nem várakoztat, hiba esetén csendes).
  var PRELOAD_N = 8;
  function _leaflet() {
    if (!S.leaflet) S.leaflet = new Promise(function (res) { _ensureLeaflet(res); });
    return S.leaflet;
  }
  function _mapData(id) {
    if (!S.mapData[id]) {
      S.mapData[id] = _gas('getAutoStopMap', [{ id: id }]).then(function (r) {
        if (!r || !r.ok) delete S.mapData[id];   // hibás válasz ne ragadjon a cache-ben
        return r;
      }, function (e) { delete S.mapData[id]; throw e; });
    }
    return S.mapData[id];
  }
  function preload() {
    var withGps = S.items.filter(function (x) { return x.has_gps; });
    if (!withGps.length) return;
    _leaflet();
    // egymás után (a szervert ne terheljük párhuzamos kérésekkel)
    withGps.slice(0, PRELOAD_N).reduce(function (p, it) {
      return p.then(function () { return _mapData(it.id).catch(function () {}); });
    }, Promise.resolve());
  }

  function close() {
    _destroyMap();
    var m = _modal(); if (m) m.style.display = 'none';
  }

  function _itemHtml(it) {
    var pick = it.kind === 'pickup';
    var where = [it.loc, it.firma].filter(Boolean).join(' · ');
    var arrLine = '<div class="as-line">📍 ' + _t('sof.as.arrived', 'Ai ajuns') + ': <b>' + _e(_dt(it.arrived_at)) + '</b>'
      + (it.auto_filled === 'done' ? ' <span class="as-yours">' + _t('sof.as.yours', '(marcat de tine)') + '</span>' : ' 🤖') + '</div>';
    var doneLine = '<div class="as-line">' + (pick ? '📦 ' + _t('sof.as.loaded', 'Ai încărcat') : '✅ ' + _t('sof.as.unloaded', 'Ai descărcat'))
      + ': <b>' + _e(_dt(it.done_at)) + '</b> 🤖</div>';
    var html = '<div class="as-item" data-id="' + it.id + '">'
      + '<div class="as-head"><span class="as-kind ' + (pick ? 'pu' : 'de') + '">' + (pick ? _t('sof.as.pickup', '⬆️ Încărcare') : _t('sof.as.delivery', '⬇️ Descărcare')) + '</span>'
      + (it.fuvar_no ? '<span class="as-no">' + _e(it.fuvar_no) + '</span>' : '') + '</div>'
      + (where ? '<div class="as-where">' + _e(where) + '</div>' : '')
      + arrLine + doneLine;
    if (S.editId === it.id) {
      html += '<div class="as-edit">'
        + (it.auto_filled === 'both' ? '<label>' + _t('sof.as.arrived', 'Ai ajuns') + '<input type="datetime-local" step="60" id="asArr" value="' + _local(it.arrived_at) + '"></label>' : '')
        + '<label>' + (pick ? _t('sof.as.loaded', 'Ai încărcat') : _t('sof.as.unloaded', 'Ai descărcat')) + '<input type="datetime-local" step="60" id="asDone" value="' + _local(it.done_at) + '"></label>'
        + '<div class="as-btns"><button class="as-btn ghost" onclick="SoferAutoStops.cancelEdit()">' + _t('sof.as.cancel', 'Anulează') + '</button>'
        + '<button class="as-btn ok" onclick="SoferAutoStops.saveTime(' + it.id + ')">' + _t('sof.as.save', '💾 Salvează') + '</button></div></div>';
    } else {
      html += '<div class="as-btns">'
        + '<button class="as-btn ok" onclick="SoferAutoStops.ok(' + it.id + ')">' + _t('sof.as.ok', '✓ În regulă') + '</button>'
        + '<button class="as-btn ghost" onclick="SoferAutoStops.editTime(' + it.id + ')">' + _t('sof.as.time', '⏱ Corectează ora') + '</button>'
        + (it.has_gps ? '<button class="as-btn ghost" onclick="SoferAutoStops.openMap(' + it.id + ')">' + _t('sof.as.map', '🗺️ Corectează pe hartă') + '</button>' : '')
        + '</div>';
    }
    return html + '</div>';
  }

  function render() {
    var b = _body(); if (!b) return;
    _destroyMap();
    var foot = document.getElementById('asFoot');
    if (foot) foot.style.display = '';
    b.innerHTML = '<p class="as-intro">' + _e(_t('sof.as.intro', '')) + '</p>'
      + S.items.map(_itemHtml).join('');
  }

  function _remove(id) {
    delete S.mapData[id];
    S.items = S.items.filter(function (x) { return x.id !== id; });
    if (!S.items.length) {
      close();
      _toast(_t('sof.as.allDone', 'Mulțumim, totul a fost verificat'), 'ok');
      if (typeof window.loadDashOrders === 'function') try { window.loadDashOrders(); } catch (_) {}
      return;
    }
    S.editId = null; S.mapId = null;
    render();
  }

  function ok(id) {
    _gas('ackAutoStopEvents', [{ ids: [id] }]).then(function (r) {
      if (!r || !r.ok) return _toast((r && r.err) || 'Eroare', 'err');
      if (r.reverted && r.reverted.length) _toast(_t('sof.as.reverted', 'Verificarea nu a trecut — etapa a fost redeschisă și o reverificăm'), 'err');
      _remove(id);
    }).catch(function () { _toast('Eroare de rețea', 'err'); });
  }

  function okAll() {
    var ids = S.items.map(function (x) { return x.id; });
    if (!ids.length) return close();
    _gas('ackAutoStopEvents', [{ ids: ids }]).then(function (r) {
      if (!r || !r.ok) return _toast((r && r.err) || 'Eroare', 'err');
      if (r.reverted && r.reverted.length) _toast(_t('sof.as.reverted', 'Verificarea nu a trecut — etapa a fost redeschisă și o reverificăm'), 'err');
      S.items = []; _remove(-1);
    }).catch(function () { _toast('Eroare de rețea', 'err'); });
  }

  function editTime(id) { S.editId = id; render(); }
  function cancelEdit() { S.editId = null; render(); }

  function saveTime(id) {
    var a = document.getElementById('asArr'), d = document.getElementById('asDone');
    var args = { id: id, done_at: _toIso(d && d.value) };
    if (a) args.arrived_at = _toIso(a.value);
    _gas('correctAutoStopTime', [args]).then(function (r) {
      if (!r || !r.ok) return _toast((r && r.err) || 'Eroare', 'err');
      _toast(_t('sof.as.saved', 'Salvat'), 'ok');
      _remove(id);
    }).catch(function () { _toast('Eroare de rețea', 'err'); });
  }

  // ── Térképes javítás ──
  function _ensureLeaflet(cb) {
    if (window.L && window.L.map) return cb(true);
    if (!document.getElementById('asLeafletCss')) {
      var l = document.createElement('link'); l.id = 'asLeafletCss'; l.rel = 'stylesheet';
      l.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(l);
    }
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    s.onload = function () { cb(!!(window.L && window.L.map)); };
    s.onerror = function () { cb(false); };
    document.head.appendChild(s);
  }
  function _destroyMap() {
    if (S.map) { try { S.map.remove(); } catch (_) {} }
    S.map = null; S.pick = null; S.pickMarker = null;
  }

  function openMap(id) {
    var b = _body(); if (!b) return;
    S.mapId = id; S.editId = null;
    var foot = document.getElementById('asFoot'); if (foot) foot.style.display = 'none';
    b.innerHTML = '<p class="as-intro">' + _e(_t('sof.as.mapHint', '')) + '</p>'
      + '<div id="asMap" class="as-map"><div class="as-map-load">⏳ ' + _t('sof.as.loading', 'Se încarcă…') + '</div></div>'
      + '<div class="as-btns"><button class="as-btn ghost" onclick="SoferAutoStops.backToList()">' + _t('sof.as.back', '← Înapoi la listă') + '</button>'
      + '<button class="as-btn ok" onclick="SoferAutoStops.saveMap()">' + _t('sof.as.mapSave', '💾 Corectează aici') + '</button></div>';
    Promise.all([_mapData(id), _leaflet()]).then(function (arr) {
      var r = arr[0];
      if (S.mapId !== id) return;
      if (!arr[1]) { S.leaflet = null; _toast('Harta nu a putut fi încărcată — corectează ora', 'err'); return backToList(); }
      if (!r || !r.ok) { _toast((r && r.err) || 'Eroare', 'err'); return backToList(); }
      var el = document.getElementById('asMap'); if (!el) return;
      el.innerHTML = '';
      var L = window.L;
      var map = L.map(el, { zoomControl: true });
      S.map = map;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      var bounds = [];
      if (r.track && r.track.length > 1) { L.polyline(r.track, { color: '#64748b', weight: 3, opacity: 0.7 }).addTo(map); }
      (r.candidates || []).forEach(function (c) {
        var m = L.circleMarker([c.lat, c.lng], { radius: 8, color: '#475569', fillColor: '#94a3b8', fillOpacity: 0.9, weight: 2 }).addTo(map);
        if (c.from) m.bindTooltip(_dt(c.from) + ' – ' + _dt(c.to));
        m.on('click', function () { _setPick(c.lat, c.lng); });
        bounds.push([c.lat, c.lng]);
      });
      if (r.point) {
        var pm = L.circleMarker([r.point.lat, r.point.lng], { radius: 11, color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 0.95, weight: 3 }).addTo(map);
        pm.bindTooltip(_dt(r.point.from) + ' – ' + _dt(r.point.to));
        map.setView([r.point.lat, r.point.lng], 15);
      } else if (bounds.length) {
        map.fitBounds(bounds, { padding: [30, 30] });
      } else if (r.track && r.track.length) {
        map.fitBounds(r.track, { padding: [20, 20] });
      } else {
        map.setView([45.9, 24.9], 6);
      }
      map.on('click', function (e) { _setPick(e.latlng.lat, e.latlng.lng); });
      setTimeout(function () { try { map.invalidateSize(); } catch (_) {} }, 120);
    }).catch(function () { _toast('Eroare de rețea', 'err'); backToList(); });
  }
  function _setPick(lat, lng) {
    if (!S.map) return;
    S.pick = { lat: lat, lng: lng };
    if (S.pickMarker) S.pickMarker.setLatLng([lat, lng]);
    else S.pickMarker = window.L.marker([lat, lng]).addTo(S.map);
  }
  function backToList() { S.mapId = null; render(); }
  function saveMap() {
    var id = S.mapId;
    if (!id) return;
    if (!S.pick) return _toast(_t('sof.as.mapPick', 'Atinge mai întâi harta'), 'err');
    _gas('correctAutoStopMap', [{ id: id, lat: S.pick.lat, lng: S.pick.lng }]).then(function (r) {
      if (!r || !r.ok) return _toast((r && r.err) || 'Eroare', 'err');
      _toast(_t('sof.as.saved', 'Salvat') + ' — ' + _dt(r.done_at), 'ok');
      _remove(id);
    }).catch(function () { _toast('Eroare de rețea', 'err'); });
  }

  window.SoferAutoStops = { load: load, open: open, close: close, ok: ok, okAll: okAll, editTime: editTime,
    cancelEdit: cancelEdit, saveTime: saveTime, openMap: openMap, backToList: backToList, saveMap: saveMap };
  // A telefonos vissza-gomb (sofer.js _SOF_MODALS) ezt hívja
  window.soferAutoStopsClose = function () {
    if (S.mapId) return backToList();
    close();
  };
})();
