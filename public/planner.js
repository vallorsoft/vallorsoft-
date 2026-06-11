// ============================================================
//  VallorSoft — planner.js  (📅 DISZPÉCSER-TERVEZŐTÁBLA)
//  Jármű×nap rács: a fuvarok a felrakó-dátumuk napján, a kiosztott
//  vontató sorában jelennek meg. Húzd-rá kiosztás: a "Kiosztásra vár"
//  sávból (vagy másik sorból) egy cellára ejtve a fuvar járművet és
//  felrakó-dátumot kap (plannerAssign). Kattintás = fuvar-szerkesztő.
//  Betöltés: console-shared.js UTÁN (gas, esc, toast, openOrderEdit).
// ============================================================

(function () {
  'use strict';

  var DAYS = 14;                 // látható napok száma
  var _start = _monday(new Date());
  var _veh = [], _orders = [];

  function _monday(d) {
    d = new Date(d); d.setHours(12, 0, 0, 0);
    var dow = (d.getDay() + 6) % 7;     // hétfő=0
    d.setDate(d.getDate() - dow);
    return d;
  }
  function ymd(d) { return d.toISOString().slice(0, 10); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }

  var ST_COLOR = {
    'Disponibil': '#3b82f6', 'Alocat': '#f59e0b', 'Extern': '#a855f7',
    'In Curs': '#22c55e', 'Finalizat': '#8a97a8'
  };

  function injectCss() {
    if (document.getElementById('plannerCss')) return;
    var css = ''
      + '.pl-grid{display:grid;border:1px solid var(--border);border-radius:var(--radius-md);overflow-x:auto;}'
      + '.pl-table{border-collapse:collapse;width:100%;min-width:980px;}'
      + '.pl-table th,.pl-table td{border:1px solid var(--border);padding:0;vertical-align:top;}'
      + '.pl-table th{padding:6px 4px;font-size:11px;color:var(--text-muted);font-weight:700;text-align:center;background:rgba(255,255,255,0.02);}'
      + '.pl-table th.today,.pl-table td.today{background:rgba(225,11,26,0.06);}'
      + '.pl-veh{padding:8px 10px;font-size:12px;font-weight:700;white-space:nowrap;position:sticky;left:0;background:var(--bg-panel);z-index:2;}'
      + '.pl-cell{min-width:64px;height:100%;min-height:40px;}'
      + '.pl-cell.dragover{outline:2px dashed #3b82f6;outline-offset:-2px;background:rgba(59,130,246,0.10);}'
      + '.pl-chip{display:block;margin:2px;padding:3px 6px;border-radius:6px;font-size:10.5px;font-weight:700;color:#fff;cursor:grab;'
      + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;border:1px solid rgba(255,255,255,0.25);}'
      + '.pl-chip:active{cursor:grabbing;}'
      + '.pl-pool{display:flex;flex-wrap:wrap;gap:6px;min-height:34px;padding:8px;border:1px dashed var(--border-bright);border-radius:var(--radius-md);}'
      + '.pl-pool.dragover{outline:2px dashed #3b82f6;background:rgba(59,130,246,0.08);}'
      + '.pl-pool .pl-chip{position:static;max-width:230px;}';
    var st = document.createElement('style'); st.id = 'plannerCss'; st.textContent = css;
    document.head.appendChild(st);
  }

  function chip(o, extraStyle) {
    var col = ST_COLOR[o.status] || '#3b82f6';
    var title = o.id + ' · ' + (o.client || '—') + '\n' + (o.loc_incarcare || '?') + ' → ' + (o.loc_descarcare || '?')
      + '\nFelrakás: ' + (o.data_incarcare ? new Date(o.data_incarcare).toLocaleDateString('hu-HU') : '—')
      + ' · Lerakás: ' + (o.data_descarcare ? new Date(o.data_descarcare).toLocaleDateString('hu-HU') : '—')
      + '\nSofőr: ' + (o.nume_sofer || '—') + ' · Státusz: ' + o.status;
    return '<span class="pl-chip" draggable="true" data-oid="' + esc(String(o.id)) + '" '
      + 'style="background:' + col + 'cc;' + (extraStyle || '') + '" title="' + esc(title) + '" '
      + 'ondragstart="Planner._ds(event)" onclick="openOrderEdit(\'' + esc(String(o.id)) + '\')">'
      + esc(String(o.id).replace('CMD-', '#')) + ' ' + esc((o.loc_descarcare || o.client || '').slice(0, 14)) + '</span>';
  }

  function render() {
    var box = document.getElementById('plannerBox');
    if (!box) return;
    injectCss();
    var days = [];
    for (var i = 0; i < DAYS; i++) days.push(addDays(_start, i));
    var todayY = ymd(new Date(Date.now() + 12 * 3600 * 1000 - 12 * 3600 * 1000));
    todayY = new Date().toISOString().slice(0, 10);

    // Kiosztásra váró fuvarok (nincs vontató)
    var pool = _orders.filter(function (o) { return !o.rendszam_camion && o.status !== 'Finalizat'; });

    var head = '<tr><th style="min-width:120px;">Jármű</th>' + days.map(function (d) {
      var y = ymd(d);
      var lbl = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'][d.getDay()] + '<br>' + (d.getMonth() + 1) + '.' + d.getDate() + '.';
      return '<th class="' + (y === todayY ? 'today' : '') + '">' + lbl + '</th>';
    }).join('') + '</tr>';

    var rows = _veh.map(function (v) {
      var cells = days.map(function (d) {
        var y = ymd(d);
        var dayOrders = _orders.filter(function (o) {
          return o.rendszam_camion && o.rendszam_camion.toUpperCase() === v.rendszam.toUpperCase()
            && o.data_incarcare && String(o.data_incarcare).slice(0, 10) === y;
        });
        return '<td class="' + (y === todayY ? 'today' : '') + '"><div class="pl-cell" data-rendszam="' + esc(v.rendszam) + '" data-day="' + y + '" '
          + 'ondragover="Planner._dov(event)" ondragleave="Planner._dlv(event)" ondrop="Planner._dp(event)">'
          + dayOrders.map(function (o) { return chip(o); }).join('') + '</div></td>';
      }).join('');
      return '<tr><td class="pl-veh text-primary">🚛 ' + esc(v.rendszam)
        + (v.marca ? '<div class="text-muted" style="font-size:10px;font-weight:400;">' + esc(v.marca) + '</div>' : '') + '</td>' + cells + '</tr>';
    }).join('') || '<tr><td colspan="' + (DAYS + 1) + '" class="text-muted" style="padding:18px;text-align:center;">Nincs aktív vontató.</td></tr>';

    var range = days[0].toLocaleDateString('hu-HU') + ' – ' + days[DAYS - 1].toLocaleDateString('hu-HU');
    box.innerHTML =
      '<div class="glass" style="padding:14px 16px;margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
      + '<button class="btn ghost" style="padding:6px 12px;" onclick="Planner.shift(-7)">◀ Előző hét</button>'
      + '<button class="btn ghost" style="padding:6px 12px;" onclick="Planner.today()">Ma</button>'
      + '<button class="btn ghost" style="padding:6px 12px;" onclick="Planner.shift(7)">Következő hét ▶</button>'
      + '<b class="text-primary" style="font-size:14px;">' + range + '</b>'
      + '<span class="text-muted" style="font-size:12px;margin-left:auto;">Húzd a fuvart egy jármű napjára a kiosztáshoz · kattintás = szerkesztés</span>'
      + '</div>'
      + '<div class="glass" style="padding:14px 16px;margin-bottom:12px;">'
      + '<div class="text-primary" style="font-size:13px;font-weight:700;margin-bottom:8px;">📥 Kiosztásra vár (' + pool.length + ')'
      + ' <span class="text-muted" style="font-weight:400;font-size:11px;">— ide visszahúzva a fuvar kiosztása törlődik</span></div>'
      + '<div class="pl-pool" id="plPool" ondragover="Planner._dov(event)" ondragleave="Planner._dlv(event)" ondrop="Planner._dpPool(event)">'
      + (pool.map(function (o) { return chip(o); }).join('') || '<span class="text-muted" style="font-size:12px;">Minden fuvar ki van osztva. ✅</span>')
      + '</div></div>'
      + '<div class="glass" style="padding:8px;"><div style="overflow-x:auto;"><table class="pl-table">' + head + rows + '</table></div></div>';
  }

  function load() {
    var box = document.getElementById('plannerBox');
    if (!box) return;
    if (!box.innerHTML) box.innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">Betöltés...</div>';
    gas('getPlannerData', [{ from: ymd(_start), to: ymd(addDays(_start, DAYS - 1)) }]).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || 'Hiba') + '</div>'; return; }
      _veh = r.vehicles || []; _orders = r.orders || [];
      render();
    });
  }

  function assign(orderId, rendszam, day) {
    gas('plannerAssign', [orderId, { rendszam_camion: rendszam, data_incarcare: day || null }]).then(function (r) {
      if (r && r.ok) { toast(rendszam ? ('✅ ' + orderId + ' → ' + rendszam) : (orderId + ' kiosztása törölve'), 'ok'); load(); }
      else toast((r && r.err) || 'Hiba', 'err');
    });
  }

  window.Planner = {
    load: load,
    shift: function (n) { _start = addDays(_start, n); load(); },
    today: function () { _start = _monday(new Date()); load(); },
    _ds: function (e) { e.dataTransfer.setData('text/plain', e.target.getAttribute('data-oid')); e.dataTransfer.effectAllowed = 'move'; },
    _dov: function (e) { e.preventDefault(); e.currentTarget.classList.add('dragover'); e.dataTransfer.dropEffect = 'move'; },
    _dlv: function (e) { e.currentTarget.classList.remove('dragover'); },
    _dp: function (e) {
      e.preventDefault(); e.currentTarget.classList.remove('dragover');
      var oid = e.dataTransfer.getData('text/plain');
      if (oid) assign(oid, e.currentTarget.getAttribute('data-rendszam'), e.currentTarget.getAttribute('data-day'));
    },
    _dpPool: function (e) {
      e.preventDefault(); e.currentTarget.classList.remove('dragover');
      var oid = e.dataTransfer.getData('text/plain');
      if (oid) assign(oid, null, null);
    },
  };
})();
