/* console-pages.js — Három új, jellemzően READ-ONLY konzol-aloldal.
 * Újrahasznosítja a meglévő handlereket/adatokat — nincs új írás-út.
 *   1) BNR árfolyam   (#bnrBox)        → getBnrRate
 *   2) Teljesített fuvarok (#ordersDoneBox) → getFinishedOrders (kis új read handler)
 *   3) Aktív flotta   (#activeFleetBox) → getActiveVehiclePositions + getVehicleStatusSummary
 * Meglévő segédek: gas(), t(), esc(), vsMetricBand(), cartoTileUrl().
 */
function _cpEsc(s){ return (typeof esc === 'function') ? esc(String(s==null?'':s)) : String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ════════════════════════════════════════════════════════════
   1) BNR EUR/RON árfolyam
   ════════════════════════════════════════════════════════════ */
function loadBnrRate(){
  var box = document.getElementById('bnrBody');
  if(box) box.innerHTML = '<div class="text-muted" style="padding:14px;">' + _cpEsc(t('common.loading')) + '</div>';
  gas('getBnrRate').then(function(r){
    if(!r || !r.ok){
      if(box) box.innerHTML = '<div class="text-muted" style="padding:14px;">' + _cpEsc(t('common.loadError')) + '</div>';
      return;
    }
    var bnr = (r.bnr_rate != null) ? Number(r.bnr_rate).toFixed(4) : '—';
    var comp = (r.company_rate != null) ? Number(r.company_rate).toFixed(4) : '—';
    var when = r.fetched_at ? new Date(r.fetched_at).toLocaleString('hu-HU') : '—';
    var band = document.getElementById('bnrBand');
    if(band && typeof vsMetricBand === 'function'){
      band.innerHTML = vsMetricBand([
        { l: t('bnr.kpiBnr'),     v: bnr,  sub: 'BNR · EUR/RON' },
        { l: t('bnr.kpiCompany'), v: comp, sub: t('bnr.companyRate') }
      ]);
    }
    if(box){
      box.innerHTML =
        '<table class="table" style="width:100%;">'
        + '<tbody>'
        + '<tr><td style="padding:10px 12px;font-weight:700;">' + _cpEsc(t('bnr.bnrRate')) + '</td>'
        +   '<td style="padding:10px 12px;text-align:right;font-size:22px;font-weight:800;">' + _cpEsc(bnr) + ' <span class="text-muted" style="font-size:13px;">RON/EUR</span></td></tr>'
        + '<tr><td style="padding:10px 12px;font-weight:700;">' + _cpEsc(t('bnr.companyRate')) + '</td>'
        +   '<td style="padding:10px 12px;text-align:right;font-size:22px;font-weight:800;">' + _cpEsc(comp) + ' <span class="text-muted" style="font-size:13px;">RON/EUR</span></td></tr>'
        + '<tr><td style="padding:10px 12px;" class="text-muted">' + _cpEsc(t('bnr.lastUpdated')) + '</td>'
        +   '<td style="padding:10px 12px;text-align:right;" class="text-muted">' + _cpEsc(when) + '</td></tr>'
        + '</tbody></table>'
        + '<div class="text-muted" style="font-size:12px;margin-top:10px;">' + _cpEsc(t('bnr.note')) + '</div>';
    }
  }).catch(function(){
    if(box) box.innerHTML = '<div class="text-muted" style="padding:14px;">' + _cpEsc(t('common.connError')) + '</div>';
  });
}

/* ════════════════════════════════════════════════════════════
   2) Teljesített fuvarok / Curse Efectuate (read-only archív)
   ════════════════════════════════════════════════════════════ */
var _odCache = [];

function loadOrdersDone(){
  var body = document.getElementById('odBody');
  var fEl = document.getElementById('odFrom'), tEl = document.getElementById('odTo');
  var arg = {};
  if(fEl && fEl.value) arg.from = fEl.value;
  if(tEl && tEl.value) arg.to = tEl.value;
  if(body) body.innerHTML = '<tr><td colspan="7" style="padding:14px;text-align:center;opacity:.6;">' + _cpEsc(t('common.loading')) + '</td></tr>';
  gas('getFinishedOrders', [arg]).then(function(r){
    if(!r || !r.ok){
      if(body) body.innerHTML = '<tr><td colspan="7" style="padding:14px;text-align:center;opacity:.6;">' + _cpEsc(t('common.loadError')) + '</td></tr>';
      _odCache = []; _odRenderBand([]);
      return;
    }
    var items = r.orders || [];
    _odCache = items;
    _odRenderBand(items);
    if(!items.length){
      if(body) body.innerHTML = '<tr><td colspan="7" style="padding:14px;text-align:center;opacity:.6;">' + _cpEsc(t('od.empty')) + '</td></tr>';
      return;
    }
    body.innerHTML = items.map(function(o){
      var drv = o.nume_sofer || (o.sofer_type==='Extern' ? (o.firma_extern||o.email_sofer) : o.email_sofer) || '—';
      var route = (o.loc_incarcare || '—') + ' → ' + (o.loc_descarcare || '—');
      var dt = o.done_at ? String(o.done_at).slice(0,10) : '—';
      var price = (o.pret != null && o.pret !== '') ? Number(o.pret).toFixed(2) + ' EUR' : '—';
      var km = (o.km != null && o.km !== '') ? Number(o.km) + ' km' : '—';
      return '<tr>'
        + '<td style="padding:8px 10px;"><b>' + _cpEsc(String(o.id)) + '</b></td>'
        + '<td style="padding:8px 10px;">' + _cpEsc(o.client || '—') + '</td>'
        + '<td style="padding:8px 10px;">' + _cpEsc(route) + '</td>'
        + '<td style="padding:8px 10px;">' + (typeof vsAvatar==='function' ? vsAvatar(drv) : '') + _cpEsc(drv) + '</td>'
        + '<td style="padding:8px 10px;text-align:right;">' + _cpEsc(km) + '</td>'
        + '<td style="padding:8px 10px;text-align:right;">' + _cpEsc(price) + '</td>'
        + '<td style="padding:8px 10px;">' + _cpEsc(dt) + '</td>'
        + '</tr>';
    }).join('');
  }).catch(function(){
    if(body) body.innerHTML = '<tr><td colspan="7" style="padding:14px;text-align:center;opacity:.6;">' + _cpEsc(t('common.connError')) + '</td></tr>';
  });
}

function _odRenderBand(items){
  var el = document.getElementById('odBand');
  if(!el || typeof vsMetricBand !== 'function') return;
  var now = new Date();
  var ym = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  var total = items.length;
  var thisMonth = items.filter(function(o){ return o.done_at && String(o.done_at).slice(0,7) === ym; }).length;
  var sum = items.reduce(function(s,o){ return s + (Number(o.pret)||0); }, 0);
  el.innerHTML = vsMetricBand([
    { l: t('od.kpiTotal'),     v: total,            sub: 'Finalizat' },
    { l: t('od.kpiThisMonth'), v: thisMonth,        sub: ym },
    { l: t('od.kpiSum'),       v: Math.round(sum) + ' EUR', sub: '' }
  ]);
}

// CSV export a betöltött (szűrt) listából — kliens-oldali, nincs új végpont.
function exportOrdersDoneCsv(){
  var items = _odCache || [];
  if(!items.length){ if(typeof toast==='function') toast(t('od.empty'),'err'); return; }
  var head = ['ID','Client','Incarcare','Descarcare','Sofer','Km','Pret_EUR','Data'];
  var lines = [head.join(';')];
  items.forEach(function(o){
    var drv = o.nume_sofer || (o.sofer_type==='Extern' ? (o.firma_extern||o.email_sofer) : o.email_sofer) || '';
    var row = [
      o.id,
      o.client || '',
      o.loc_incarcare || '',
      o.loc_descarcare || '',
      drv,
      (o.km != null ? o.km : ''),
      (o.pret != null ? o.pret : ''),
      o.done_at ? String(o.done_at).slice(0,10) : ''
    ].map(function(v){
      var s = String(v==null?'':v);
      if(/[;"\n]/.test(s)) s = '"' + s.replace(/"/g,'""') + '"';
      return s;
    });
    lines.push(row.join(';'));
  });
  var csv = '﻿' + lines.join('\r\n');   // BOM → Excel/könyvelő import
  var blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'curse_efectuate.csv';
  document.body.appendChild(a); a.click();
  setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

/* ════════════════════════════════════════════════════════════
   3) Aktív flotta / Flotă Activă — saját Leaflet térkép + lista
   A térkép SAJÁT konténer-id-t használ (#fleetMap), NEM a dashMap-et.
   A GPS/pozíció a meglévő getActiveVehiclePositions handlerből jön.
   ════════════════════════════════════════════════════════════ */
function loadActiveFleet(){
  initFleetMap();
  refreshFleetVehicles();
  loadFleetSummary();
  if(window._fleetVehTimer) clearInterval(window._fleetVehTimer);
  // 60s kliens-polling (a szerver-cache 30s) — mint a vezérlőpulton
  window._fleetVehTimer = setInterval(function(){
    var pane = document.querySelector('.pane[data-pane="active-fleet"]');
    if(pane && pane.classList.contains('hidden')) return;
    refreshFleetVehicles();
  }, 60000);
}

function initFleetMap(){
  if(typeof L === 'undefined') return;
  var el = document.getElementById('fleetMap');
  if(!el) return;
  if(window._fleetMap){ setTimeout(function(){ window._fleetMap.invalidateSize(); }, 150); return; }
  window._fleetMap = L.map(el, { zoomControl:true }).setView([45.9432, 24.9668], 7);
  window._fleetMarkers = L.layerGroup().addTo(window._fleetMap);
  // Mindig világos csempe (projekt-konvenció), a téma-választótól függetlenül.
  var url = (typeof cartoTileUrl === 'function')
    ? cartoTileUrl('light')
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  window._fleetTileLayer = L.tileLayer(url,
    { attribution: '© OpenStreetMap © CARTO', maxZoom: 19, subdomains: 'abcd' }).addTo(window._fleetMap);
  [0, 150, 400, 800].forEach(function(d){
    setTimeout(function(){ if(window._fleetMap) window._fleetMap.invalidateSize(); }, d);
  });
  if(window.ResizeObserver && !window._fleetRO){
    window._fleetRO = new ResizeObserver(function(){ if(window._fleetMap) window._fleetMap.invalidateSize(); });
    window._fleetRO.observe(el);
  }
}

function refreshFleetVehicles(){
  if(!window._fleetMap || !window._fleetMarkers) return;
  gas('getActiveVehiclePositions').then(function(r){
    if(!r || !r.ok || !window._fleetMarkers) return;
    var pts = r.positions || [];
    window._fleetMarkers.clearLayers();
    window._afLastPts = pts;
    // KPI-sáv frissítése a pozíciókból (Úton / Áll / GPS-szel)
    _afRenderBand(pts);
    // Lista a térkép mellett
    var listEl = document.getElementById('fleetVehList');
    if(listEl){
      if(!pts.length){
        listEl.innerHTML = '<div class="text-muted" style="padding:14px;">' + _cpEsc(r.gps_configured ? t('dash.noGpsData') : t('dash.noGpsSetup')) + '</div>';
      } else {
        listEl.innerHTML = pts.map(function(p){
          var spd = (p.speed != null) ? Math.round(p.speed) + ' km/h' : '—';
          var moving = (p.speed != null && p.speed > 3);
          var dot = moving ? '🟢' : '⚪';
          var nm = p.object_name || p.rendszam || '—';
          var dt = p.datetime ? new Date(p.datetime).toLocaleString('hu-HU') : '';
          return '<div class="glass-soft" style="display:flex;align-items:center;gap:10px;padding:9px 12px;margin-bottom:7px;border-radius:10px;">'
            + '<span style="font-size:16px;">' + dot + '</span>'
            + '<div style="flex:1;min-width:0;"><div style="font-weight:700;">🚛 ' + _cpEsc(nm) + '</div>'
            + '<div class="text-muted" style="font-size:11px;">' + _cpEsc(dt) + '</div></div>'
            + '<div style="font-weight:800;white-space:nowrap;">' + _cpEsc(spd) + '</div>'
            + '</div>';
        }).join('');
      }
    }
    if(!pts.length){
      var ph = L.circleMarker([45.9432, 24.9668], { radius:9, color:'#8a97a8', fillColor:'#8a97a8', fillOpacity:0.6, weight:2 });
      ph.bindTooltip(r.gps_configured ? t('dash.noGpsData') : t('dash.noGpsSetup'));
      ph.addTo(window._fleetMarkers);
      return;
    }
    var bounds = [];
    pts.forEach(function(p){
      var spd = (p.speed != null) ? Math.round(p.speed) + ' km/h' : '—';
      var m = L.circleMarker([p.lat, p.lng], { radius:8, color:'#6366f1', fillColor:'#6366f1', fillOpacity:0.85, weight:2 });
      m.bindTooltip('🚛 ' + (p.object_name || p.rendszam) + ' · ' + spd);
      m.bindPopup('<b>' + _cpEsc(p.object_name || p.rendszam) + '</b><br>' + t('dash.speed') + ': ' + spd
        + (p.datetime ? '<br>' + new Date(p.datetime).toLocaleString('hu-HU') : ''));
      m.addTo(window._fleetMarkers);
      bounds.push([p.lat, p.lng]);
    });
    if(bounds.length === 1) window._fleetMap.setView(bounds[0], 10);
    else if(bounds.length > 1) window._fleetMap.fitBounds(bounds, { padding:[40,40], maxZoom:12 });
  });
}

function _afRenderBand(pts){
  var el = document.getElementById('afBand');
  if(!el || typeof vsMetricBand !== 'function') return;
  pts = pts || [];
  var withGps = pts.length;
  var moving = pts.filter(function(p){ return p.speed != null && p.speed > 3; }).length;
  var idle = withGps - moving;
  // Aktív jármű összesen → a státusz-összesítőből (külön hívás tölti); placeholder amíg betölt
  var activeTotal = (window._afActiveTotal != null) ? window._afActiveTotal : withGps;
  el.innerHTML = vsMetricBand([
    { l: t('af.kpiActive'),  v: activeTotal, sub: '' },
    { l: t('af.kpiMoving'),  v: moving,      sub: '> 3 km/h' },
    { l: t('af.kpiIdle'),    v: idle,        sub: '' },
    { l: t('af.kpiWithGps'), v: withGps,     sub: 'GPS' }
  ]);
}

function loadFleetSummary(){
  gas('getVehicleStatusSummary').then(function(r){
    if(!r || !r.ok) return;
    window._afActiveTotal = r.active || 0;
    // ha a térkép-band már kirenderelt, frissítsük az "Aktív jármű" mutatót
    _afRenderBand(window._afLastPts || []);
  });
}
