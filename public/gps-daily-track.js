// public/gps-daily-track.js — GPS útvonal-előzmény (Flotta aloldal).
// Jármű + időszak (max. 31 nap) → úthálózatra illesztett útvonal a térképen,
// összesítő (indulás/érkezés helye, menet-/állásidő, km út szerint, km-óra,
// üzemanyag) és napokra bontott Start/Stop lista. Adat: `gpsTrackVehicles` +
// `gpsTrackRange` (handlers/gpsTrack.js), a mentett gps_track_days táblából.

(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
  function tt(k, fb, p) {
    var v = window.t ? window.t(k, p) : null;
    if (!v || v === k) { v = fb; if (p) Object.keys(p).forEach(function (x) { v = String(v).replace('{' + x + '}', p[x]); }); }
    return v;
  }
  function _gas(fn, args) {
    return fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName: fn, arguments: args || [] }) })
      .then(function (r) { return r.json(); }).then(function (d) { return d.result; });
  }
  var TZ = 'Europe/Bucharest';
  function todayLocal() { try { return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date()); } catch (_) { return new Date().toISOString().slice(0, 10); } }
  function addDays(day, n) { var p = day.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
  function hm(sec) { var t = new Date(sec * 1000); try { return new Intl.DateTimeFormat('ro-RO', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(t); } catch (_) { return t.toISOString().slice(11, 16); } }
  function dur(sec) { sec = Math.max(0, Math.round(sec)); var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h ? (h + ' h ' + m + ' m') : (m + ' m'); }
  function km(v) { return v == null ? '—' : Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' km'; }
  function num(v, u) { return v == null ? '—' : Number(v).toLocaleString('ro-RO', { maximumFractionDigits: 2 }) + (u ? ' ' + u : ''); }
  function dayLabel(day) {
    var p = day.split('-').map(Number);
    try { return new Intl.DateTimeFormat((window.I18N && I18N.lang === 'hu') ? 'hu-HU' : 'ro-RO', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(p[0], p[1] - 1, p[2]))); }
    catch (_) { return day; }
  }
  // Google polyline (precision 6) dekódolás
  function decode(str) {
    var idx = 0, lat = 0, lng = 0, out = [], f = 1e6;
    while (idx < str.length) {
      var b, sh = 0, r = 0;
      do { b = str.charCodeAt(idx++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
      lat += (r & 1) ? ~(r >> 1) : (r >> 1);
      sh = 0; r = 0;
      do { b = str.charCodeAt(idx++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
      lng += (r & 1) ? ~(r >> 1) : (r >> 1);
      out.push([lat / f, lng / f]);
    }
    return out;
  }

  var _map = null, _layers = null, _data = null;

  function initMap() {
    if (_map) { try { _map.remove(); } catch (_) {} _map = null; }
    var el = document.getElementById('gtrMap');
    if (!el || typeof L === 'undefined') return;
    _map = L.map(el, { zoomControl: true }).setView([45.94, 24.97], 6);
    if (typeof vsAttachTiles === 'function') vsAttachTiles(_map, function () {});
    else L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(_map);
    _layers = L.layerGroup().addTo(_map);
    setTimeout(function () { try { _map.invalidateSize(); } catch (_) {} }, 60);
  }

  function presetRange(k) {
    var t = todayLocal(), p = t.split('-').map(Number);
    var dow = (new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() + 6) % 7; // hétfő = 0
    if (k === 'today') return [t, t];
    if (k === 'yesterday') return [addDays(t, -1), addDays(t, -1)];
    if (k === 'week') return [addDays(t, -dow), t];
    if (k === 'lastweek') return [addDays(t, -dow - 7), addDays(t, -dow - 1)];
    if (k === 'month') return [t.slice(0, 8) + '01', t];
    if (k === 'last30') return [addDays(t, -29), t];
    return null;
  }

  function renderShell(r) {
    var box = document.getElementById('gpsDailyTrackBox');
    if (!box) return;
    var vehicles = r.vehicles || [];
    var opts = '<option value="">' + esc(tt('gtr.pickVehicle', 'Alege un vehicul…')) + '</option>' + vehicles.map(function (v) {
      var label = v.rendszam + (v.marca ? ' — ' + v.marca : '') + (v.days ? ' · ' + v.days + ' ' + tt('gtr.daysSaved', 'zile salvate') : '');
      return '<option value="' + esc(v.rendszam) + '">' + esc(label) + '</option>';
    }).join('');
    var presets = [['today', 'gtr.pToday', 'Azi'], ['yesterday', 'gtr.pYesterday', 'Ieri'], ['week', 'gtr.pWeek', 'Săptămâna curentă'],
      ['lastweek', 'gtr.pLastWeek', 'Săptămâna trecută'], ['month', 'gtr.pMonth', 'Luna curentă'], ['last30', 'gtr.pLast30', 'Ultimele 30 de zile']];
    var t = todayLocal();
    box.innerHTML =
      '<div class="gtr-wrap">' +
        '<div class="gtr-side glass">' +
          '<h2 class="h-title" style="margin-bottom:4px;">🗺️ ' + esc(tt('gtr.title', 'Istoric traseu GPS')) + '</h2>' +
          '<div class="gtr-hint">' + esc(tt('gtr.sub', 'Traseul complet înregistrat de GPS, pus pe drum, cu km exacți. Se păstrează ~3 luni.')) + '</div>' +
          '<select class="select" id="gtrVehicle">' + opts + '</select>' +
          '<div class="gtr-presets">' + presets.map(function (p) {
            return '<button type="button" class="gtr-chip' + (p[0] === 'week' ? ' on' : '') + '" data-gtr-preset="' + p[0] + '">' + esc(tt(p[1], p[2])) + '</button>';
          }).join('') + '</div>' +
          '<div class="gtr-dates">' +
            '<input class="input" type="date" id="gtrFrom" max="' + t + '">' +
            '<span>→</span>' +
            '<input class="input" type="date" id="gtrTo" max="' + t + '">' +
            '<button type="button" class="btn primary" id="gtrLoad">' + esc(tt('gtr.load', 'Afișează')) + '</button>' +
          '</div>' +
          '<div id="gtrStatus" class="gtr-hint"></div>' +
          '<div id="gtrSummary"></div>' +
          '<div id="gtrList" class="gtr-list"></div>' +
        '</div>' +
        '<div class="gtr-mapwrap"><div id="gtrMap" class="gtr-map"></div>' +
          '<div class="gtr-legend"><span><i class="gtr-l m"></i>' + esc(tt('gtr.legMatched', 'pe drum')) + '</span>' +
          '<span><i class="gtr-l r"></i>' + esc(tt('gtr.legRaw', 'puncte GPS (neajustat)')) + '</span>' +
          '<span><i class="gtr-l g"></i>' + esc(tt('gtr.legGap', 'lipsă semnal, completat pe drum')) + '</span>' +
          '<span>👆 ' + esc(tt('gtr.clickHint', 'click pe traseu = date GPS în acel punct')) + '</span></div>' +
        '</div>' +
      '</div>';
    var wk = presetRange('week');
    document.getElementById('gtrFrom').value = wk[0];
    document.getElementById('gtrTo').value = wk[1];
    box.querySelectorAll('[data-gtr-preset]').forEach(function (b) {
      b.addEventListener('click', function () {
        var rg = presetRange(b.getAttribute('data-gtr-preset'));
        document.getElementById('gtrFrom').value = rg[0]; document.getElementById('gtrTo').value = rg[1];
        box.querySelectorAll('[data-gtr-preset]').forEach(function (x) { x.classList.toggle('on', x === b); });
        if (document.getElementById('gtrVehicle').value) load();
      });
    });
    ['gtrFrom', 'gtrTo'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', function () { box.querySelectorAll('[data-gtr-preset]').forEach(function (x) { x.classList.remove('on'); }); });
    });
    document.getElementById('gtrVehicle').addEventListener('change', load);
    document.getElementById('gtrLoad').addEventListener('click', load);
    initMap();
    if (!vehicles.length) document.getElementById('gtrStatus').textContent = tt('gtr.noVehicles', 'Niciun vehicul asociat cu GPS (CargoTrack). Asociază vehiculele la Integrări.');
  }

  function load() {
    var plate = document.getElementById('gtrVehicle').value;
    var from = document.getElementById('gtrFrom').value, to = document.getElementById('gtrTo').value;
    var st = document.getElementById('gtrStatus');
    if (!plate) { st.textContent = tt('gtr.pickVehicleFirst', 'Alege mai întâi un vehicul.'); return; }
    if (!from || !to) return;
    st.textContent = tt('gtr.loading', 'Se încarcă traseul… (prima afișare a unei zile poate dura câteva secunde — o punem pe drum)');
    document.getElementById('gtrLoad').disabled = true;
    _gas('gpsTrackRange', [{ rendszam: plate, from: from, to: to }]).then(function (r) {
      document.getElementById('gtrLoad').disabled = false;
      if (!r || !r.ok) { st.textContent = (r && r.err) || tt('common.error', 'Eroare'); return; }
      _data = r;
      st.textContent = r.days.length ? '' : tt('gtr.noData', 'Nu există traseu salvat pentru acest interval. Colectarea pornește automat după asocierea GPS (la fiecare 15 minute).');
      renderSummary(r); renderList(r); drawMap(r);
    }).catch(function () { document.getElementById('gtrLoad').disabled = false; st.textContent = tt('common.error', 'Eroare'); });
  }

  function row(label, val, strong) { return '<div class="gtr-row"><span>' + esc(label) + '</span><b' + (strong ? ' class="gtr-strong"' : '') + '>' + esc(val) + '</b></div>'; }

  function renderSummary(r) {
    var el = document.getElementById('gtrSummary');
    var T = r.totals;
    if (!T) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="gtr-sum">' +
      '<div class="gtr-sum-h">' + esc(tt('gtr.summary', 'Sumar')) + '</div>' +
      row(tt('gtr.startLoc', 'Locație pornire'), T.start.name || (T.start.lat + ', ' + T.start.lng)) +
      row(tt('gtr.endLoc', 'Locație oprire'), T.end.name || (T.end.lat + ', ' + T.end.lng)) +
      row(tt('gtr.driveDur', 'Durată activitate'), dur(T.drive_sec)) +
      row(tt('gtr.stopDur', 'Durată oprire'), dur(T.stop_sec)) +
      row(tt('gtr.kmRoad', 'Kilometraj pe drum (GPS)'), km(T.km_road), true) +
      row(tt('gtr.kmOdo', 'Kilometraj (bord)'), km(T.km_odo)) +
      row(tt('gtr.fuel', 'Combustibil consumat') + (T.fuel_src === 'level' ? ' (' + tt('gtr.fromLevel', 'din nivel') + ')' : ''), num(T.fuel, 'l')) +
      (T.fuel_src === 'counter' && T.fuel_level_used != null ? row(tt('gtr.fuelByLevel', 'Consum după nivel rezervor'), num(T.fuel_level_used, 'l')) : '') +
      (T.refuel_count ? row('⛽ ' + tt('gtr.refuels', 'Alimentări detectate'), T.refuel_count + ' · +' + num(T.refuel_l, 'l')) : '') +
      (T.loss_count ? '<div class="gtr-loss-row">' + row('⚠️ ' + tt('gtr.losses', 'Pierderi de combustibil'), T.loss_count + ' · −' + num(T.loss_l, 'l')) + '</div>' : '') +
      row(tt('gtr.avg', 'Medie consum'), T.avg_l100 == null ? '—' : num(T.avg_l100, 'l/100km')) +
      row(tt('gtr.lph', 'Consum pe oră'), T.l_per_h == null ? '—' : num(T.l_per_h, 'l/h')) +
      (T.pending_days ? '<div class="gtr-note">⏳ ' + esc(tt('gtr.pending', '{n} zi(le) încă nepuse pe drum — km estimați din puncte GPS; se finalizează automat.', { n: T.pending_days })) + '</div>' : '') +
      '</div>';
  }

  function renderList(r) {
    var el = document.getElementById('gtrList');
    el.innerHTML = r.days.slice().reverse().map(function (d) {
      var items = d.trips.map(function (x, i) { return { k: 't', from: x.from, to: x.to, x: x, i: i }; })
        .concat(d.stops.map(function (x, i) { return { k: 's', from: x.from, to: x.to, x: x, i: i }; }))
        .concat((d.refuels || []).map(function (x, i) { return { k: 'f', from: x.t, x: x, i: i }; }))
        .concat((d.losses || []).map(function (x, i) { return { k: 'l', from: x.from_t || x.t, x: x, i: i }; }))
        .sort(function (a, b) { return a.from - b.from; });
      return '<div class="gtr-day">' +
        '<div class="gtr-day-h"><span>' + esc(dayLabel(d.day)) + '</span><b>' + esc(km(d.km_road != null ? d.km_road : d.km_gps)) + '</b></div>' +
        (d.km_odo != null ? '<div class="gtr-day-sub">' + esc(tt('gtr.kmOdoShort', 'bord')) + ': ' + esc(km(d.km_odo)) + (d.matched ? '' : ' · ⏳') + '</div>' : '') +
        items.map(function (it) {
          if (it.k === 'f' || it.k === 'l') {
            var isL = it.k === 'l';
            return '<div class="gtr-it ' + (isL ? 'loss' : 'refuel') + '" data-gtr-ev="' + it.x.lat + '|' + it.x.lng + '">' +
              '<span class="gtr-ev">' + (isL ? '⚠️' : '⛽') + '</span><span class="gtr-t">' + hm(isL ? (it.x.from_t || it.x.t) : it.x.t) + ' ' +
              esc(isL ? tt('gtr.loss', 'Pierdere combustibil') : tt('gtr.refuelShort', 'Alimentare')) + '</span>' +
              '<span class="gtr-v">' + (isL ? '−' : '+') + esc(num(it.x.liters, 'l')) + '</span></div>';
          }
          if (it.k === 's') return '<div class="gtr-it stop" data-gtr-stop="' + d.day + '|' + it.i + '"><span class="gtr-dot s"></span><span class="gtr-t">' + hm(it.from) + ' Stop</span><span class="gtr-v">' + dur(it.to - it.from) + '</span></div>';
          var kmv = it.x.km_odo != null ? it.x.km_odo : it.x.km_gps;
          return '<div class="gtr-it trip" data-gtr-trip="' + d.day + '|' + it.i + '"><span class="gtr-dot t"></span><span class="gtr-t">' + hm(it.from) + ' Start → ' + hm(it.to) + '</span><span class="gtr-v">' + dur(it.to - it.from) + ' · ' + km(kmv) + (it.x.fuel != null || it.x.fuel_level_used != null ? ' · ' + num(it.x.fuel != null ? it.x.fuel : it.x.fuel_level_used, 'l') : '') + '</span></div>';
        }).join('') +
      '</div>';
    }).join('');
    el.querySelectorAll('[data-gtr-trip]').forEach(function (n) {
      n.addEventListener('click', function () {
        var k = n.getAttribute('data-gtr-trip').split('|'), d = findDay(k[0]); if (!d || !_map) return;
        var b = d.trips[+k[1]].bbox; _map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: [40, 40] });
      });
    });
    el.querySelectorAll('[data-gtr-ev]').forEach(function (n) {
      n.addEventListener('click', function () {
        var k = n.getAttribute('data-gtr-ev').split('|'); if (!_map) return;
        _map.setView([+k[0], +k[1]], 15);
      });
    });
    el.querySelectorAll('[data-gtr-stop]').forEach(function (n) {
      n.addEventListener('click', function () {
        var k = n.getAttribute('data-gtr-stop').split('|'), d = findDay(k[0]); if (!d || !_map) return;
        var s = d.stops[+k[1]]; _map.setView([s.lat, s.lng], 15);
      });
    });
  }
  function findDay(day) { return (_data && _data.days || []).filter(function (d) { return d.day === day; })[0]; }

  function drawMap(r) {
    if (!_map || !_layers) return;
    _layers.clearLayers();
    var bounds = [];
    r.days.forEach(function (d) {
      (d.segments || []).forEach(function (sg) {
        var ll = decode(sg.p || ''); if (ll.length < 2) return;
        bounds = bounds.concat(ll);
        if (sg.k === 'm') {
          L.polyline(ll, { color: '#ffffff', weight: 8, opacity: 0.9 }).addTo(_layers);
          L.polyline(ll, { color: '#2563eb', weight: 5, opacity: 0.95 }).addTo(_layers);
        } else if (sg.k === 'g') {
          L.polyline(ll, { color: '#64748b', weight: 4, opacity: 0.9, dashArray: '8 8' }).addTo(_layers);
        } else {
          L.polyline(ll, { color: '#f97316', weight: 4, opacity: 0.9 }).addTo(_layers);
        }
        // széles, láthatatlan kattintó-sáv: a vonal bármely pontjára kattintva a GPS-adatok
        L.polyline(ll, { color: '#000', weight: 18, opacity: 0, interactive: true, className: 'gtr-hit' })
          .on('click', function (e) { pointPopup(d.day, e.latlng); })
          .addTo(_layers);
      });
      (d.refuels || []).forEach(function (f) {
        L.marker([f.lat, f.lng], { icon: L.divIcon({ className: 'gtr-pin', html: '<div class="gtr-pin f">⛽</div>', iconSize: [24, 24], iconAnchor: [12, 12] }) })
          .bindPopup('<b>' + esc(tt('gtr.refuel', 'Alimentare (din nivel rezervor)')) + '</b><br>' + esc(dayLabel(d.day)) + ' ' + hm(f.t) +
            '<br>+' + esc(num(f.liters, 'l')) + ' (' + esc(num(f.before, 'l')) + ' → ' + esc(num(f.after, 'l')) + ')')
          .addTo(_layers);
      });
      (d.losses || []).forEach(function (f) {
        L.marker([f.lat, f.lng], { zIndexOffset: 500, icon: L.divIcon({ className: 'gtr-pin', html: '<div class="gtr-pin l">⚠️</div>', iconSize: [26, 26], iconAnchor: [13, 13] }) })
          .bindPopup('<b>' + esc(tt('gtr.lossTitle', 'Pierdere de combustibil (din nivel rezervor)')) + '</b><br>' + esc(dayLabel(d.day)) + ' ' + hm(f.from_t || f.t) + ' – ' + hm(f.t) +
            '<br>−' + esc(num(f.liters, 'l')) + ' (' + esc(num(f.before, 'l')) + ' → ' + esc(num(f.after, 'l')) + ')' +
            '<br><span style="color:#64748b;font-size:12px">' + esc(tt('gtr.lossHint', 'Scădere bruscă, peste consumul din mers — verificați (furt, scurgere).')) + '</span>')
          .addTo(_layers);
      });
      d.stops.forEach(function (s) {
        var long = (s.to - s.from) >= 3600;
        L.circleMarker([s.lat, s.lng], { radius: long ? 7 : 5, color: '#ffffff', weight: 2, fillColor: long ? '#dc2626' : '#f59e0b', fillOpacity: 1 })
          .bindPopup('<b>Stop</b><br>' + esc(dayLabel(d.day)) + ' ' + hm(s.from) + ' – ' + hm(s.to) + '<br>' + esc(dur(s.to - s.from)))
          .addTo(_layers);
      });
    });
    var T = r.totals;
    if (T) {
      L.marker([T.start.lat, T.start.lng], { icon: L.divIcon({ className: 'gtr-pin', html: '<div class="gtr-pin a">A</div>', iconSize: [26, 26], iconAnchor: [13, 13] }) })
        .bindPopup('<b>' + esc(tt('gtr.startLoc', 'Locație pornire')) + '</b><br>' + esc(T.start.name || '')).addTo(_layers);
      L.marker([T.end.lat, T.end.lng], { icon: L.divIcon({ className: 'gtr-pin', html: '<div class="gtr-pin b">B</div>', iconSize: [26, 26], iconAnchor: [13, 13] }) })
        .bindPopup('<b>' + esc(tt('gtr.endLoc', 'Locație oprire')) + '</b><br>' + esc(T.end.name || '')).addTo(_layers);
    }
    if (bounds.length) { try { _map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30] }); } catch (_) {} }
  }

  // Kattintott pont adatai (CargoTrack-szerű buborék)
  function pointPopup(day, latlng) {
    if (!_map) return;
    var pop = L.popup({ maxWidth: 300, className: 'gtr-ppop' }).setLatLng(latlng)
      .setContent('<div class="gtr-pp-load">' + esc(tt('gtr.loadingPt', 'Se încarcă…')) + '</div>').openOn(_map);
    var selEl = document.getElementById('gtrVehicle');
    var plate = (_data && _data.rendszam) || (selEl ? selEl.value : '');
    var done = false;
    var tmo = setTimeout(function () { if (!done) { done = true; pop.setContent('<div class="gtr-pp-load">' + esc(tt('gtr.ptTimeout', 'Serverul nu a răspuns — încearcă din nou.')) + '</div>'); } }, 20000);
    _gas('gpsTrackPoint', [{ rendszam: plate, day: day, lat: latlng.lat, lng: latlng.lng }]).then(function (r) {
      if (done) return; done = true; clearTimeout(tmo);
      if (!r || !r.ok) { pop.setContent('<div class="gtr-pp-load">' + esc((r && r.err) || tt('common.error', 'Eroare')) + '</div>'); return; }
      try {
      var p = r.point;
      var dir = p.direction != null ? '<span class="gtr-pp-arrow" style="transform:rotate(' + Number(p.direction) + 'deg)">➤</span> ' + p.direction + '°' : '—';
      var ign = p.ignition == null ? '—' : (p.ignition ? tt('gtr.ignOn', 'pornit') : tt('gtr.ignOff', 'oprit'));
      function pr(l, v) { return '<div class="gtr-pp-r"><span>' + esc(l) + '</span><b>' + v + '</b></div>'; }
      pop.setLatLng([p.lat, p.lng]).setContent(
        '<div class="gtr-pp">' +
          '<div class="gtr-pp-h"><b>' + esc(plate) + '</b><span>' + esc(dayLabel(day)) + ' ' + hm(p.t) + '</span></div>' +
          (p.name ? '<div class="gtr-pp-loc">' + esc(p.name) + '</div>' : '') +
          pr(tt('gtr.speed', 'Viteză'), esc(num(p.speed, 'km/h'))) +
          pr(tt('gtr.dir', 'Direcție'), dir) +
          pr(tt('gtr.ign', 'Contact'), esc(ign)) +
          pr(tt('gtr.fuelLevel', 'Nivel combustibil'), esc(num(p.fuel_level, 'l'))) +
          pr(tt('gtr.odo', 'Kilometraj GPS'), esc(p.mileage == null ? '—' : km(p.mileage))) +
          pr(tt('gtr.kmDay', 'Km în ziua respectivă'), esc(km(p.km_day))) +
          pr(tt('gtr.fuelDay', 'Consum în ziua respectivă'), esc(num(p.fuel_day, 'l'))) +
          (p.avg_day != null ? pr(tt('gtr.avg', 'Medie consum'), esc(num(p.avg_day, 'l/100km'))) : '') +
        '</div>');
      } catch (e) {
        try { console.warn('[GpsTrack] buborék-render hiba', e); } catch (_) {}
        pop.setContent('<div class="gtr-pp-load">' + esc(tt('common.error', 'Eroare')) + '</div>');
      }
    }).catch(function (e) {
      if (done) return; done = true; clearTimeout(tmo);
      try { console.warn('[GpsTrack] pont-lekérés hiba', e); } catch (_) {}
      pop.setContent('<div class="gtr-pp-load">' + esc(tt('common.error', 'Eroare')) + '</div>');
    });
  }

  window.loadGpsDailyTrack = function () {
    _gas('gpsTrackVehicles').then(function (r) {
      var box = document.getElementById('gpsDailyTrackBox');
      if (!r || !r.ok) { if (box) box.innerHTML = '<div class="glass" style="padding:22px;color:#dc2626;">' + esc((r && r.err) || 'Eroare') + '</div>'; return; }
      renderShell(r);
    });
  };
})();
