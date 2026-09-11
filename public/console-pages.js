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

// A fuvar-lista chip-szűrőjét beállítja, MIELŐTT a fülre navigál — a Sürgős
// sor "📋 Post-livrare" tételei egyenesen a szűrt nézetre visznek (nem kell
// utólag kézzel rákattintani a megfelelő chip-re a fuvarlistán).
function opsGoOrdersChip(tab, chipKey){
  try { window._orderChipFilter = chipKey; } catch(e){}
  activateTab(tab);
}

// A Sürgős sor 📋 post-livrare tételei (nincs számla / posta / fizetés)
// mostantól NEM a fuvarlistára ugranak, hanem egyenesen az ÉRINTETT fuvar
// dokumentum-nyomkövetés kártyáját (vsPostDeliveryOpen) nyitják meg — a
// kártya lépés-sorozatot mutat (lezárva→számlázva→postázva→kifizetve),
// jelzi melyik jön, és helyben szerkeszthető. Ha a chipnek több fuvar felel
// meg, egy kis választó-lista jön fel előbb. A vsPostDeliveryOpen ugyanaz a
// kártya, ami a Fuvarok kezelése listáról (⋯ menü → 📋 Post-livrare) is
// elérhető — tehát a kártya oda-vissza konzisztens.
function opsOpenPostDeliveryQueue(chipKey){
  if (typeof gas !== 'function') return;
  gas('comList').then(function(list){
    if(!Array.isArray(list)) list = [];
    window._ordersAllCache = list; // a vsPostDeliveryOpen ebből olvas
    var pred = (typeof _ORDER_PD_FILTERS !== 'undefined') ? _ORDER_PD_FILTERS[chipKey] : null;
    var matches = pred ? list.filter(pred) : [];
    if(!matches.length){
      toast(t('ops.pdPickEmpty')||'Nincs ilyen fuvar (a lista azóta frissülhetett).', 'info');
      return;
    }
    if(matches.length === 1){
      vsPostDeliveryOpen(matches[0].id);
      return;
    }
    _opsPdPickerOpen(matches);
  }).catch(function(){
    toast(t('common.error')||'Hiba', 'err');
  });
}
window.opsOpenPostDeliveryQueue = opsOpenPostDeliveryQueue;

function _opsPdPickerOpen(matches){
  _opsPdPickerClose();
  var back = document.createElement('div');
  back.id = 'opsPdPickBack';
  back.className = 'modal-back';
  back.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9997;padding:16px;';
  var box = document.createElement('div');
  box.className = 'modal glass';
  box.style.cssText = 'max-width:520px;width:100%;max-height:80vh;overflow:auto;padding:18px;border-radius:14px;';
  var rows = matches.map(function(c){
    var route = ((c.loc_incarcare||'') + ' → ' + (c.loc_descarcare||'')).trim();
    return '<div class="glass" style="padding:10px 12px;cursor:pointer;margin-bottom:8px;" onclick="_opsPdPickerClose();vsPostDeliveryOpen(\'' + String(c.id).replace(/'/g,"\\'") + '\')">'
      + '<div style="font-weight:700;" class="text-primary">' + _cpEsc(c.fuvar_no||c.id) + ' · ' + _cpEsc(c.client||'—') + '</div>'
      + '<div style="font-size:12px;color:var(--muted);margin-top:2px;">' + _cpEsc(route) + '</div>'
      + '</div>';
  }).join('');
  box.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
    + '<h3 style="margin:0;font-size:15px;">' + _cpEsc(t('ops.pdPickTitle')||'Válaszd ki a fuvart') + '</h3>'
    + '<button type="button" class="btn ghost" onclick="_opsPdPickerClose()" style="font-size:20px;line-height:1;padding:4px 10px;">×</button>'
    + '</div>'
    + '<div style="font-size:12px;color:var(--muted);margin-bottom:12px;">' + _cpEsc(t('ops.pdPickHint')||'') + '</div>'
    + rows;
  back.appendChild(box);
  document.body.appendChild(back);
  back.addEventListener('click', function(e){ if(e.target === back) _opsPdPickerClose(); });
  document.addEventListener('keydown', _opsPdPickerEsc, true);
}
function _opsPdPickerEsc(e){ if(e.key === 'Escape') _opsPdPickerClose(); }
function _opsPdPickerClose(){
  var el = document.getElementById('opsPdPickBack');
  if(el && el.parentNode) el.parentNode.removeChild(el);
  document.removeEventListener('keydown', _opsPdPickerEsc, true);
}
window._opsPdPickerClose = _opsPdPickerClose;

/* ════════════════════════════════════════════════════════════
   4) OPERATÍV KÖZPONT (#opsCenterBox) — getOpsCenter
      Diszpécser-vezérlő: gyors-akció kártyák + sürgős sor + egészség-mutató.
      CSAK OLVASÁS — minden kattintás a meglévő activateTab(...)-ra ugrik.
   ════════════════════════════════════════════════════════════ */
function loadOpsCenter(){
  var box = document.getElementById('opsCenterBox');
  if(!box) return;
  box.innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + _cpEsc(t('common.loading')) + '</div>';
  gas('getOpsCenter').then(function(r){
    if(!r || !r.ok){
      box.innerHTML = '<div class="text-muted" style="padding:20px;">' + _cpEsc((r && r.err) || t('common.loadError')) + '</div>';
      return;
    }
    var c = r.counters || {};
    var h = r.health || {};

    // Felső mutató-sáv (vsMetricBand) — fő operatív számok
    var band = (typeof vsMetricBand === 'function') ? vsMetricBand([
      { l: '🚚 ' + t('ops.active'),     v: c.aktiv || 0,        sub: '' },
      { l: '⬆️ ' + t('ops.todayLoad'),  v: c.mai_felrakas || 0, sub: t('ops.today') },
      { l: '⬇️ ' + t('ops.todayUnload'),v: c.mai_lerakas || 0,  sub: t('ops.today') },
      { l: '⏰ ' + t('ops.late'),        v: c.keso || 0,         sub: '' }
    ]) : '';

    // Gyors-akció kártyák (a releváns fülre ugranak)
    function actCard(ico, lbl, tab){
      return '<div class="glass" style="padding:16px;cursor:pointer;display:flex;align-items:center;gap:12px;" onclick="activateTab(\'' + tab + '\')">'
        + '<div style="font-size:22px;">' + ico + '</div>'
        + '<div style="font-weight:700;" class="text-primary">' + _cpEsc(lbl) + '</div>'
        + '<div style="margin-left:auto;" class="text-muted">›</div></div>';
    }
    var actions = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:18px;">'
      + actCard('📋', t('ops.actNewOrder'),  'orders-form')
      + actCard('🗂️', t('ops.actOrders'),    'orders-list')
      + actCard('📅', t('ops.actPlanner'),   'orders-planner')
      + actCard('📥', t('ops.actInbound'),   'inbound')
      + actCard('📦', t('ops.actWarehouse'), 'warehouse')
      + actCard('💸', t('ops.actInvoicesIn'),'invoices-in')
      + actCard('🗺️', t('ops.actGpsDaily'),  'gps-daily-track')
      + actCard('📧', t('ops.actDigest'),    'morning-digest')
      + '</div>';

    // Sürgős sor — csak a >0 tételek; kattintásra a megfelelő fülre.
    // A `pdChip` param (opcionális) a post-delivery hátralékokra: NEM a
    // fuvarlistára ugrik, hanem az ÉRINTETT fuvar dokumentum-nyomkövetés
    // kártyáját nyitja (lépés-sorozat + melyik jön + helyi szerkesztés) —
    // 1 találatnál egyenesen, több találatnál egy kis választó-lista után
    // (`opsOpenPostDeliveryQueue`).
    function urgent(ico, lbl, n, tab, sev, orderChip, pdChip){
      if(!n) return '';
      var bcls = sev === 'danger' ? 'err' : (sev === 'warn' ? 'warn' : 'info');
      var onclick = pdChip
        ? "opsOpenPostDeliveryQueue('" + pdChip + "')"
        : (orderChip
          ? "opsGoOrdersChip('" + tab + "','" + orderChip + "')"
          : "activateTab('" + tab + "')");
      return '<div class="glass" style="padding:12px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;margin-bottom:8px;" onclick="' + onclick + '">'
        + '<div style="font-size:18px;">' + ico + '</div>'
        + '<div style="font-weight:600;" class="text-primary">' + _cpEsc(lbl) + '</div>'
        + '<div style="margin-left:auto;"><span class="badge ' + bcls + '">' + n + '</span></div></div>';
    }
    var queueItems = ''
      + urgent('⚠️', t('ops.uMissingUit'),     c.hianyzo_uit || 0,      'orders-list', 'danger')
      + urgent('🚚', t('ops.uMissingCarrier'), c.hianyzo_fuvarozo || 0, 'orders-list', 'warn')
      + urgent('⏰', t('ops.uLate'),            c.keso || 0,             'orders-list', 'danger')
      + urgent('🧾', t('ops.uDueInvoice'),      c.lejaro_szamla || 0,    'stats-finance', 'warn')
      + urgent('💸', t('ops.uDueApInvoice'),    c.lejaro_ap_szamla || 0, 'invoices-in', 'warn')
      + urgent('📄', t('ops.uDueDoc'),          c.lejaro_dok || 0,       'expiries', 'warn')
      + urgent('🧾', t('ops.uPdNoInvoice'),     c.pd_no_invoice || 0,    null, 'warn', null, 'pd_no_invoice')
      + urgent('📬', t('ops.uPdNoPost'),        c.pd_no_post || 0,       null, 'warn', null, 'pd_pending_post')
      + urgent('💶', t('ops.uPdUnpaid'),        c.pd_unpaid || 0,        null, 'warn', null, 'pd_pending_pay');
    if(!queueItems) queueItems = '<div class="text-muted" style="padding:14px;">' + _cpEsc(t('ops.queueEmpty')) + '</div>';

    // Egészség-mutató sor — csak a tisztán számolható proxy-k (null = kihagyva)
    function healthCard(lbl, val, sub){
      return '<div class="glass" style="padding:16px;flex:1;min-width:180px;">'
        + '<div class="text-muted" style="font-size:12px;font-weight:700;">' + _cpEsc(lbl) + '</div>'
        + '<div class="text-primary" style="font-size:26px;font-weight:800;margin-top:4px;">' + val + '</div>'
        + (sub ? '<div class="text-muted" style="font-size:12px;margin-top:2px;">' + _cpEsc(sub) + '</div>' : '')
        + '</div>';
    }
    var healthCards = '';
    if(h.assigned_pct != null) healthCards += healthCard(t('ops.hAssigned'), h.assigned_pct + ' %', t('ops.hWaiting') + ': ' + (h.waiting || 0));
    if(h.utilization_pct != null) healthCards += healthCard(t('ops.hUtilization'), h.utilization_pct + ' %', (h.fleet_on_road || 0) + ' / ' + (h.fleet_active || 0));
    var health = healthCards
      ? '<div style="margin-top:18px;"><div class="text-primary" style="font-weight:700;margin-bottom:10px;">' + _cpEsc(t('ops.healthTitle')) + '</div>'
        + '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + healthCards + '</div></div>'
      : '';

    box.innerHTML =
      '<div style="margin-bottom:18px;">' + band + '</div>'
      + '<div class="text-primary" style="font-weight:700;margin-bottom:10px;">' + _cpEsc(t('ops.quickActions')) + '</div>'
      + actions
      + '<div class="text-primary" style="font-weight:700;margin-bottom:10px;">' + _cpEsc(t('ops.priorityQueue')) + '</div>'
      + queueItems
      + health
      + '<div style="margin-top:16px;"><button class="btn ghost" style="padding:7px 14px;font-size:12px;" onclick="loadOpsCenter()">' + _cpEsc(t('st.refresh')) + '</button></div>';
  }).catch(function(){
    box.innerHTML = '<div class="text-muted" style="padding:14px;">' + _cpEsc(t('common.connError')) + '</div>';
  });
}
