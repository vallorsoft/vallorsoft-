// public/gps-daily-track.js — Napi GPS útvonal (breadcrumb) — Flotta aloldal.
// Jármű-választó + dátum-picker + Leaflet-térkép polyline-nal. A pont-lista a
// `getVehicleDailyTrack` handler-en át jön; a járművek `listVehiclesWithTrack`-
// tel. Több jármű: külön színek. Adattakarítás: 7 nap (scheduler).

(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m])); }
  function _gas(fn, args) {
    return fetch('/api/execute', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ functionName: fn, arguments: args || [] }) })
      .then(r => r.json()).then(d => d.result);
  }
  function _todayLocal() {
    try { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date()); }
    catch (_) { return new Date().toISOString().slice(0, 10); }
  }

  // Determinisztikus szín járműhöz (rendszám-hash → HSL).
  function _colorFor(plate) {
    var s = String(plate || ''); var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return 'hsl(' + h + ',65%,45%)';
  }

  var _map = null, _layers = null, _tile = null;

  // FONTOS: a `loadGpsDailyTrack()` minden aloldal-megnyitáskor ÚJRAGENERÁLJA
  // a `#gpsDailyTrackBox` teljes innerHTML-jét (beleértve a `#gpsDailyMap`
  // konténert is) — tehát a régi Leaflet-példány (ha `_map` modul-szinten
  // megmaradt) egy már LEVÁLASZTOTT (detached) DOM-node-ra mutatna. Ezért itt
  // MINDIG lebontjuk a korábbi térképet, mielőtt egy friss konténerre új
  // példányt építünk (a `.remove()` Leaflet API leiratkozik minden eseményről
  // és törli a belső DOM-referenciákat is — nincs memory-leak).
  function _initMap() {
    if (_map) { try { _map.remove(); } catch (_) {} _map = null; _layers = null; _tile = null; }
    var el = document.getElementById('gpsDailyMap');
    if (!el || typeof L === 'undefined') return null;
    _map = L.map(el, { zoomControl: true }).setView([45.94, 24.97], 7);
    var url = (window.cartoTileUrl ? cartoTileUrl('light') :
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png');
    _tile = L.tileLayer(url, {
      attribution: '&copy; OpenStreetMap · &copy; CARTO',
      subdomains: 'abcd', maxZoom: 19
    }).addTo(_map);
    _layers = L.layerGroup().addTo(_map);
    // Térkép-méret javítás async betöltésre.
    setTimeout(function(){ try { _map.invalidateSize(); } catch(_){} }, 50);
    return _map;
  }

  function _drawTrack(plate, points) {
    if (!_layers) return;
    _layers.clearLayers();
    if (!points || !points.length) return;
    var latlngs = points.map(function(p){ return [parseFloat(p.lat), parseFloat(p.lng)]; })
                        .filter(function(x){ return isFinite(x[0]) && isFinite(x[1]); });
    if (!latlngs.length) return;
    var color = _colorFor(plate);
    L.polyline(latlngs, { color: color, weight: 4, opacity: 0.85 }).addTo(_layers);
    // Start (zöld) + End (piros) marker.
    L.circleMarker(latlngs[0], { radius: 8, color: '#16a34a', fillColor:'#16a34a', fillOpacity:0.85 })
      .bindPopup((window.t?t('gdt.start'):'Start') + '<br>' + esc(points[0].recorded_at))
      .addTo(_layers);
    var last = latlngs[latlngs.length - 1];
    L.circleMarker(last, { radius: 8, color: '#ef4444', fillColor:'#ef4444', fillOpacity:0.85 })
      .bindPopup((window.t?t('gdt.end'):'Cél') + '<br>' + esc(points[points.length-1].recorded_at))
      .addTo(_layers);
    try { _map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] }); } catch(_){}
  }

  function _renderShell(vehicles) {
    var box = document.getElementById('gpsDailyTrackBox');
    if (!box) return;
    var opts = '<option value="">' + esc(window.t?t('gdt.pickVehicle'):'Válassz járművet…') + '</option>' +
      vehicles.map(function(v){
        var label = v.rendszam + (v.marca ? ' — ' + v.marca : '') + ' · ' + (v.points_7d || 0) + ' pt';
        return '<option value="' + esc(v.rendszam) + '">' + esc(label) + '</option>';
      }).join('');
    box.innerHTML =
      '<div class="glass" style="padding:22px;">' +
        '<h2 class="h-title" data-i18n="gdt.title">🗺️ Napi GPS útvonal</h2>' +
        '<div class="h-sub" data-i18n="gdt.sub">Egy jármű adott napi mozgás-útvonala (breadcrumb). A rögzítés 10 percenként történik, mozgás-szűrővel; adatmegőrzés 7 nap.</div>' +
        '<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin:14px 0;">' +
          '<div class="field" style="min-width:240px;"><label data-i18n="gdt.vehicle">Jármű</label>' +
            '<select class="select" id="gdtVehicle">' + opts + '</select></div>' +
          '<div class="field"><label data-i18n="gdt.date">Nap</label>' +
            '<input class="input" id="gdtDate" type="date" value="' + esc(_todayLocal()) + '" max="' + esc(_todayLocal()) + '"></div>' +
          '<button type="button" class="btn primary" id="gdtLoad">🔎 <span data-i18n="gdt.load">Betöltés</span></button>' +
          '<div id="gdtStat" style="align-self:center;color:var(--muted);font-size:12.5px;"></div>' +
        '</div>' +
        (vehicles.length === 0
          ? '<div style="padding:20px;color:var(--muted);font-size:13px;text-align:center;" data-i18n="gdt.emptyHint">Még nincs rögzített napi pozíció. Ha most kapcsoltad be a GPS-integrációt, várj kb. 10 percet — a scheduler ezután kezd gyűjteni.</div>'
          : '<div id="gpsDailyMap" style="height:560px;border-radius:14px;overflow:hidden;background:#f1f5f9;"></div>') +
      '</div>';
    if (window.I18N && I18N.apply) I18N.apply(box);
    if (!vehicles.length) return;
    _initMap();
    document.getElementById('gdtLoad').addEventListener('click', _doLoad);
    // Enter dátum-mezőn → betöltés
    document.getElementById('gdtDate').addEventListener('keydown', function(e){ if (e.key === 'Enter') _doLoad(); });
  }

  function _doLoad() {
    var plate = document.getElementById('gdtVehicle').value;
    var date = document.getElementById('gdtDate').value;
    var stat = document.getElementById('gdtStat');
    if (!plate) { stat.textContent = (window.t?t('gdt.pickVehicleFirst'):'Előbb válassz járművet.'); return; }
    stat.textContent = window.t?t('common.loading'):'Betöltés…';
    _gas('getVehicleDailyTrack', [{ rendszam: plate, date: date }]).then(function(r){
      if (!r || !r.ok) { stat.textContent = (r && r.err) || (window.t?t('common.error'):'Hiba'); return; }
      var n = (r.points && r.points.length) || 0;
      stat.textContent = n
        ? (window.t?t('gdt.pointCount', {n: n}):(n + ' pont'))
        : (window.t?t('gdt.noData'):'Nincs adat az adott napon.');
      _drawTrack(plate, r.points || []);
    }).catch(function(){ stat.textContent = window.t?t('common.error'):'Hiba'; });
  }

  window.loadGpsDailyTrack = function () {
    _gas('listVehiclesWithTrack').then(function(r){
      if (!r || !r.ok) {
        var box = document.getElementById('gpsDailyTrackBox');
        if (box) box.innerHTML = '<div class="glass" style="padding:22px;color:#dc2626;">' + esc((r && r.err) || 'Hiba') + '</div>';
        return;
      }
      _renderShell(r.vehicles || []);
    });
  };
})();
