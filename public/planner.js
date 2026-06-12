// ============================================================
//  VallorSoft — planner.js  (📅 DISZPÉCSER-TERVEZŐTÁBLA 2.0)
//
//  Két nézet, eszközhöz igazítva:
//   🖥️ Asztali: Gantt-idővonal — a fuvar SÁV a felrakástól a lerakásig,
//      húzd-rá kiosztás + sáv-mozgatás + jobb-szélen átméretezés,
//      ütközés-jelzés (dupla-foglalás), ma-vonal, hétvége-satír,
//      kihasználtság-sor, szűrők.
//   📱 Mobil (≤768px): napi nézet — dátum-szalag + jármű-kártyák,
//      koppintásos kiosztás (chip → popover → cél).
//
//  💡 VISSZFUVAR-RADAR: a kiosztatlan fuvarok felrakóit a kamionok
//     várható pozíciójával párosítja (getPlannerMatches) — egy
//     koppintással elfogadható javaslatok, üresjárat-km kijelzéssel.
//
//  Betöltés: console-shared.js UTÁN (gas, esc, toast, openOrderEdit).
// ============================================================

(function () {
  'use strict';

  // ── Állapot ─────────────────────────────────────────────
  var _start = monday(new Date());
  var _days = 14;                       // 7 / 14 / 28
  var _veh = [], _orders = [], _gps = {}, _matches = [], _matchByOrder = {};
  var _selOid = null;                   // áthelyezés / kiosztás mód
  var _popOid = null;                   // nyitott popover fuvarja
  var _mDay = ymd(new Date());          // mobil: kiválasztott nap
  var _f = { q: '', status: '', driver: '', onlyBusy: false };
  var _dense = false;
  var _resize = null;                   // sáv-átméretezés állapota

  var RAIL = 168;
  function colW() { return _dense ? 64 : 96; }
  function laneH() { return _dense ? 26 : 32; }

  var ST = {
    'Disponibil': { c: '#3b82f6', t: 'Tervezett' },
    'Alocat':     { c: '#f59e0b', t: 'Kiosztva' },
    'Extern':     { c: '#a855f7', t: 'Külsős' },
    'In Curs':    { c: '#22c55e', t: 'Úton' },
    'Parkolt':    { c: '#c026d3', t: 'Parkolt (áru pótkocsin)' },
    'Raktarban':  { c: '#f97316', t: 'Raktárban' },
    'Finalizat':  { c: '#64748b', t: 'Kész' }
  };
  var DAYNAMES = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'];

  // ── Dátum-segédek ───────────────────────────────────────
  function monday(d) { d = new Date(d); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }
  function ymd(d) { return d.toISOString().slice(0, 10); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function dstr(s) { return s ? String(s).slice(0, 10) : null; }
  function dayIdx(s) { if (!s) return null; return Math.round((new Date(s + 'T12:00:00') - _start) / 86400000); }
  function shiftDate(s, n) { var d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); }
  function fmtD(s) { return s ? new Date(s).toLocaleDateString('hu-HU', { month: '2-digit', day: '2-digit' }) : '—'; }

  // ── CSS (egyszer) ───────────────────────────────────────
  function injectCss() {
    if (document.getElementById('plannerCss2')) return;
    var css = [
      // — váz —
      '.p2-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}',
      '.p2-board{overflow-x:auto;border-radius:var(--radius-md);}',
      '.p2-inner{position:relative;}',
      '.p2-headrow{display:flex;position:sticky;top:0;z-index:5;}',
      '.p2-corner{flex:0 0 ' + RAIL + 'px;position:sticky;left:0;z-index:6;background:var(--bg-panel);' +
        'border-bottom:1px solid var(--border);display:flex;align-items:flex-end;padding:4px 10px;font-size:10px;color:var(--text-muted);}',
      '.p2-day{flex:0 0 auto;text-align:center;padding:5px 0 3px;font-size:11px;font-weight:700;color:var(--text-muted);' +
        'border-left:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--bg-panel);}',
      '.p2-day .dn{font-size:10px;font-weight:400;opacity:.8;}',
      '.p2-day.we{background:rgba(255,255,255,0.04);}',
      '.p2-day.today{color:#fff;background:rgba(225,11,26,0.18);}',
      // — kihasználtság —
      '.p2-utilrow{display:flex;}',
      '.p2-utilcorner{flex:0 0 ' + RAIL + 'px;position:sticky;left:0;z-index:4;background:var(--bg-panel);' +
        'font-size:9px;color:var(--text-muted);display:flex;align-items:center;padding:0 10px;border-bottom:1px solid var(--border);}',
      '.p2-util{flex:0 0 auto;height:16px;border-left:1px solid var(--border);border-bottom:1px solid var(--border);' +
        'font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;}',
      // — sorok —
      '.p2-row{display:flex;border-bottom:1px solid var(--border);}',
      '.p2-rail{flex:0 0 ' + RAIL + 'px;position:sticky;left:0;z-index:3;background:var(--bg-panel);' +
        'padding:6px 10px;display:flex;flex-direction:column;justify-content:center;gap:1px;border-right:1px solid var(--border);}',
      '.p2-rail .rs{font-size:12.5px;font-weight:800;display:flex;align-items:center;gap:6px;white-space:nowrap;}',
      '.p2-rail .rd{font-size:10.5px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.p2-dot{width:7px;height:7px;border-radius:50%;background:#475569;flex-shrink:0;}',
      '.p2-dot.on{background:var(--status-ok);box-shadow:0 0 5px var(--status-ok);}',
      '.p2-lanes{position:relative;flex:0 0 auto;}',
      '.p2-dcell{position:absolute;top:0;bottom:0;border-left:1px solid var(--border);}',
      '.p2-dcell.we{background:rgba(255,255,255,0.035);}',
      '.p2-dcell.today{background:rgba(225,11,26,0.07);}',
      '.p2-picking .p2-dcell{cursor:copy;}',
      '.p2-picking .p2-dcell:hover,.p2-dcell.dragover{background:rgba(59,130,246,0.22)!important;outline:1px dashed #3b82f6;outline-offset:-1px;}',
      '.p2-todayline{position:absolute;top:0;bottom:0;width:2px;background:var(--brand-red);opacity:.7;z-index:1;pointer-events:none;}',
      // — sávok —
      '.p2-bar{position:absolute;border-radius:7px;color:#fff;font-size:10.5px;font-weight:700;line-height:1.15;' +
        'padding:3px 16px 3px 8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer;z-index:2;' +
        'border:1px solid rgba(255,255,255,0.3);box-shadow:0 2px 6px rgba(0,0,0,0.35);transition:filter .12s;}',
      '.p2-bar:hover{filter:brightness(1.15);z-index:3;}',
      '.p2-bar.conflict{border:2px solid var(--status-warn);box-shadow:0 0 0 2px rgba(245,158,11,0.35);}',
      '.p2-bar.dim{opacity:.22;pointer-events:none;}',
      '.p2-bar.picked{outline:2px solid #fff;box-shadow:0 0 0 3px rgba(59,130,246,0.8);}',
      '.p2-bar .sub{font-size:9.5px;font-weight:400;opacity:.85;}',
      '.p2-rz{position:absolute;right:0;top:0;bottom:0;width:12px;cursor:ew-resize;border-radius:0 7px 7px 0;}',
      '.p2-rz:hover{background:rgba(255,255,255,0.3);}',
      // — pool / radar —
      '.p2-pool{display:flex;flex-wrap:wrap;gap:8px;min-height:38px;padding:10px;border:1px dashed var(--border-bright);border-radius:var(--radius-md);}',
      '.p2-pool.dragover{outline:2px dashed #3b82f6;background:rgba(59,130,246,0.08);}',
      '.p2-card{border-radius:9px;color:#fff;padding:7px 10px;cursor:pointer;font-size:11.5px;font-weight:700;max-width:280px;' +
        'border:1px solid rgba(255,255,255,0.28);box-shadow:0 2px 6px rgba(0,0,0,0.3);}',
      '.p2-card .sub{display:block;font-size:10px;font-weight:400;opacity:.85;margin-top:1px;}',
      '.p2-card .hint{display:inline-block;margin-top:4px;background:rgba(0,0,0,0.35);border-radius:6px;padding:1px 7px;font-size:10px;}',
      '.p2-card.picked{outline:2px solid #fff;box-shadow:0 0 0 3px rgba(59,130,246,0.8);}',
      '.p2-radar{border:1px solid rgba(34,197,94,0.35);border-radius:var(--radius-md);padding:10px 12px;margin-bottom:12px;background:rgba(34,197,94,0.05);}',
      '.p2-radar .rrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid var(--border);font-size:12.5px;}',
      '.p2-radar .rrow:last-child{border-bottom:none;}',
      // — popover / akciósáv —
      '.p2-pop{position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:600;width:min(420px,calc(100vw - 20px));' +
        'background:var(--bg-panel-raised);border:1px solid var(--border-bright);border-radius:16px;padding:16px;box-shadow:0 18px 50px rgba(0,0,0,0.6);}',
      '.p2-actionbar{position:sticky;bottom:10px;z-index:120;display:flex;gap:8px;align-items:center;flex-wrap:wrap;' +
        'background:rgba(10,14,21,0.97);border:1px solid rgba(59,130,246,0.5);border-radius:12px;padding:10px 14px;margin-top:10px;}',
      // — mobil napi nézet —
      '.p2-strip{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;}',
      '.p2-stripd{flex:0 0 auto;min-width:52px;text-align:center;padding:7px 6px;border-radius:10px;border:1px solid var(--border);cursor:pointer;}',
      '.p2-stripd.sel{border-color:var(--brand-red);background:rgba(225,11,26,0.14);}',
      '.p2-stripd .dn{font-size:10px;color:var(--text-muted);}',
      '.p2-stripd .dd{font-size:14px;font-weight:800;}',
      '.p2-stripd .ct{font-size:9px;color:var(--status-warn);}',
      '.p2-vcard{border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin-bottom:8px;}',
      '.p2-vcard.picking{border-color:#3b82f6;background:rgba(59,130,246,0.07);}',
      '.p2-skel{height:34px;border-radius:8px;background:linear-gradient(90deg,rgba(255,255,255,0.04),rgba(255,255,255,0.10),rgba(255,255,255,0.04));' +
        'background-size:200% 100%;animation:p2sh 1.2s infinite;margin-bottom:8px;}',
      '@keyframes p2sh{0%{background-position:200% 0}100%{background-position:-200% 0}}',
      // ── VILÁGOS TÉMA — kontraszt-felülírások (a --bg-panel sötét marad,
      //    ezért a fejléc/bal sáv/popover hátterét explicit világosítjuk) ──
      '.main-content[data-theme="light"] .p2-corner,' +
      '.main-content[data-theme="light"] .p2-day,' +
      '.main-content[data-theme="light"] .p2-utilcorner,' +
      '.main-content[data-theme="light"] .p2-rail{background:#fff;border-color:rgba(0,0,0,0.12);}',
      '.main-content[data-theme="light"] .p2-day.we{background:rgba(0,0,0,0.06);}',
      '.main-content[data-theme="light"] .p2-day.today{color:#1a2332;background:rgba(225,11,26,0.14);}',
      '.main-content[data-theme="light"] .p2-dcell{border-color:rgba(0,0,0,0.08);}',
      '.main-content[data-theme="light"] .p2-dcell.we{background:rgba(0,0,0,0.045);}',
      '.main-content[data-theme="light"] .p2-dcell.today{background:rgba(225,11,26,0.07);}',
      '.main-content[data-theme="light"] .p2-row{border-color:rgba(0,0,0,0.10);}',
      '.main-content[data-theme="light"] .p2-util{border-color:rgba(0,0,0,0.10);color:#1a2332;}',
      '.main-content[data-theme="light"] .p2-pop{background:#fff;border-color:rgba(0,0,0,0.18);box-shadow:0 18px 50px rgba(0,0,0,0.25);}',
      '.main-content[data-theme="light"] .p2-stripd{background:#fff;border-color:rgba(0,0,0,0.14);}',
      '.main-content[data-theme="light"] .p2-stripd.sel{background:rgba(225,11,26,0.10);}',
      '.main-content[data-theme="light"] .p2-vcard{border-color:rgba(0,0,0,0.12);}',
      '.main-content[data-theme="light"] .p2-pool{border-color:rgba(0,0,0,0.25);}',
      '.main-content[data-theme="light"] .p2-skel{background:linear-gradient(90deg,rgba(0,0,0,0.05),rgba(0,0,0,0.12),rgba(0,0,0,0.05));background-size:200% 100%;}',
      '.main-content[data-theme="light"] .p2-dot{background:#94a3b8;}',
      '.main-content[data-theme="light"] .p2-dot.on{background:var(--status-ok);}',
      '.main-content[data-theme="light"] .p2-radar{background:rgba(34,197,94,0.08);border-color:rgba(34,197,94,0.45);}',
      '.main-content[data-theme="light"] .p2-radar .rrow{border-color:rgba(0,0,0,0.10);}',
    ].join('');
    var st = document.createElement('style'); st.id = 'plannerCss2'; st.textContent = css;
    document.head.appendChild(st);
  }

  function isMobile() { return window.innerWidth <= 768; }

  // ── Adatok ──────────────────────────────────────────────
  function load() {
    var box = document.getElementById('plannerBox');
    if (!box) return;
    injectCss();
    if (!box.dataset.ready) {
      box.innerHTML = '<div class="glass" style="padding:16px;">'
        + '<div class="p2-skel" style="width:60%;"></div><div class="p2-skel"></div><div class="p2-skel"></div><div class="p2-skel" style="width:80%;"></div></div>';
    }
    Promise.all([
      gas('getPlannerData', [{ from: ymd(_start), to: ymd(addDays(_start, _days - 1)) }]),
      gas('getGpsFleetSnapshot').catch(function () { return null; })
    ]).then(function (rs) {
      var r = rs[0];
      if (!r || !r.ok) { box.innerHTML = '<div class="glass text-muted" style="padding:20px;">' + esc((r && r.err) || 'Hiba') + '</div>'; return; }
      _veh = r.vehicles || []; _orders = r.orders || [];
      _gps = {};
      if (rs[1] && rs[1].ok) (rs[1].vehicles || []).forEach(function (v) {
        _gps[String(v.rendszam || '').toUpperCase()] = (v.ignition === 'ON' || v.ignition === true || v.ignition === 'on');
      });
      box.dataset.ready = '1';
      render();
      loadRadar();
    });
  }

  function loadRadar() {
    gas('getPlannerMatches').then(function (r) {
      if (!r || !r.ok) return;
      _matches = r.matches || [];
      _matchByOrder = {};
      _matches.forEach(function (m) { _matchByOrder[String(m.order_id)] = m.suggestions; });
      renderRadar();
      // a pool-kártyák 🎯 jelzéseinek frissítése
      if (document.getElementById('plannerBox')) render();
    }).catch(function () {});
  }

  function assign(orderId, fields, msg) {
    _selOid = null; _popOid = null;
    gas('plannerAssign', [orderId, fields]).then(function (r) {
      if (r && r.ok) {
        var extra = r.paired_driver ? ' · 👤 ' + r.paired_driver + ' (párosított sofőr)' : '';
        toast((msg || ('✅ ' + orderId + ' frissítve')) + extra, 'ok'); load();
      }
      else toast((r && r.err) || 'Hiba', 'err');
    });
  }

  // Kiosztás/mozgatás napra: a lerakó-dátumot a fuvar hosszával együtt toljuk
  function assignTo(orderId, rendszam, day) {
    var o = _orders.find(function (x) { return String(x.id) === String(orderId); }) || {};
    var f = {};
    if (rendszam !== undefined) f.rendszam_camion = rendszam;
    if (day) {
      f.data_incarcare = day;
      var oi = dstr(o.data_incarcare), od = dstr(o.data_descarcare);
      if (oi && od) {
        var dur = Math.max(0, Math.round((new Date(od) - new Date(oi)) / 86400000));
        f.data_descarcare = shiftDate(day, dur);
      }
    }
    assign(orderId, f, rendszam ? ('✅ ' + orderId + ' → ' + rendszam) : undefined);
  }

  // ── Szűrés ──────────────────────────────────────────────
  function passes(o) {
    if (_f.status && o.status !== _f.status) return false;
    if (_f.driver && (o.nume_sofer || '') !== _f.driver) return false;
    if (_f.q) {
      var t = (String(o.id) + ' ' + (o.client || '') + ' ' + (o.loc_incarcare || '') + ' ' + (o.loc_descarcare || '') + ' ' + (o.nume_sofer || '')).toLowerCase();
      if (t.indexOf(_f.q.toLowerCase()) === -1) return false;
    }
    return true;
  }

  // Sáv-elrendezés: átfedő fuvarok külön „sávsorba” (lane) kerülnek + ütközés-jelzés
  function layoutVehicle(list) {
    var bars = list.filter(function (o) { return dstr(o.data_incarcare); })
      .map(function (o) {
        var s = dayIdx(dstr(o.data_incarcare));
        var e = dstr(o.data_descarcare) ? dayIdx(dstr(o.data_descarcare)) : s;
        if (e < s) e = s;
        return { o: o, s: s, e: e, lane: 0, conflict: false };
      })
      .filter(function (b) { return b.e >= 0 && b.s < _days; })
      .sort(function (a, b) { return a.s - b.s || a.e - b.e; });
    var lanes = [];
    bars.forEach(function (b) {
      var li = lanes.findIndex(function (end) { return end < b.s; });
      if (li === -1) { li = lanes.length; lanes.push(b.e); } else lanes[li] = b.e;
      b.lane = li;
    });
    // Átfedés-jelzés (nem hiba — részrakomány is lehet). Az él-érintkezés
    // (az egyik lerakó napja a másik felrakó napja) NEM számít átfedésnek.
    for (var i = 0; i < bars.length; i++) for (var j = i + 1; j < bars.length; j++) {
      var ss = Math.max(bars[i].s, bars[j].s), ee = Math.min(bars[i].e, bars[j].e);
      if (ss > ee) continue;
      var edgeTouch = (ee === ss) && bars[i].s !== bars[j].s
        && (bars[j].s === bars[i].e || bars[i].s === bars[j].e);
      if (!edgeTouch) { bars[i].conflict = bars[j].conflict = true; }
    }
    return { bars: bars, laneCount: Math.max(1, lanes.length) };
  }

  // ── RENDER ──────────────────────────────────────────────
  function render() {
    var box = document.getElementById('plannerBox');
    if (!box) return;
    var days = []; for (var i = 0; i < _days; i++) days.push(addDays(_start, i));
    var today = ymd(new Date());
    var pool = _orders.filter(function (o) { return !o.rendszam_camion && o.status !== 'Finalizat' && passes(o); });
    var drivers = {};
    _orders.forEach(function (o) { if (o.nume_sofer) drivers[o.nume_sofer] = 1; });

    box.innerHTML =
      toolbarHtml(days)
      + '<div id="p2RadarBox"></div>'
      + poolHtml(pool)
      + (isMobile() ? mobileHtml(days, today) : ganttHtml(days, today))
      + actionBarHtml()
      + popoverHtml();
    bindToolbar(Object.keys(drivers).sort());
    renderRadar();
  }

  function toolbarHtml(days) {
    var range = days[0].toLocaleDateString('hu-HU') + ' – ' + days[days.length - 1].toLocaleDateString('hu-HU');
    return '<div class="glass p2-toolbar" style="padding:12px 14px;margin-bottom:12px;">'
      + '<button class="btn ghost" style="padding:6px 11px;" onclick="Planner.shift(-7)">◀</button>'
      + '<button class="btn ghost" style="padding:6px 11px;" onclick="Planner.today()">' + t('pl.today') + '</button>'
      + '<button class="btn ghost" style="padding:6px 11px;" onclick="Planner.shift(7)">▶</button>'
      + '<b class="text-primary" style="font-size:13.5px;white-space:nowrap;">' + range + '</b>'
      + (isMobile() ? '' :
        '<select class="select" id="p2Zoom" style="max-width:96px;padding:6px 8px;font-size:12px;">'
        + [[7, t('pl.week1')], [14, t('pl.week2')], [28, t('pl.week4')]].map(function (z) { return '<option value="' + z[0] + '"' + (_days === z[0] ? ' selected' : '') + '>' + z[1] + '</option>'; }).join('') + '</select>'
        + '<button class="btn ghost" style="padding:6px 11px;font-size:12px;" onclick="Planner.density()" title="' + t('pl.densityTitle') + '">' + (_dense ? t('pl.comfy') : t('pl.dense')) + '</button>')
      + '<span style="flex:1;"></span>'
      + '<input class="input" id="p2Q" value="' + esc(_f.q) + '" placeholder="' + t('pl.searchPh') + '" style="max-width:170px;padding:7px 10px;font-size:12px;">'
      + '<select class="select" id="p2St" style="max-width:120px;padding:6px 8px;font-size:12px;"><option value="">' + t('pl.status') + '</option>'
      + Object.keys(ST).map(function (s) { return '<option' + (_f.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>'
      + '<select class="select" id="p2Drv" style="max-width:130px;padding:6px 8px;font-size:12px;"><option value="">' + t('pl.driver') + '</option></select>'
      + (isMobile() ? '' : '<label class="text-muted" style="font-size:11.5px;display:flex;align-items:center;gap:5px;cursor:pointer;">'
        + '<input type="checkbox" id="p2Busy"' + (_f.onlyBusy ? ' checked' : '') + ' style="accent-color:#e10b1a;"> ' + t('pl.onlyBusy') + '</label>')
      + '</div>';
  }

  function bindToolbar(drivers) {
    var q = document.getElementById('p2Q');
    if (q) { q.oninput = debounce(function () { _f.q = q.value.trim(); render(); }, 250); }
    var st = document.getElementById('p2St');
    if (st) st.onchange = function () { _f.status = st.value; render(); };
    var dv = document.getElementById('p2Drv');
    if (dv) {
      dv.innerHTML = '<option value="">' + t('pl.driver') + '</option>' + drivers.map(function (d) {
        return '<option' + (_f.driver === d ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('');
      dv.onchange = function () { _f.driver = dv.value; render(); };
    }
    var z = document.getElementById('p2Zoom');
    if (z) z.onchange = function () { _days = parseInt(z.value, 10) || 14; load(); };
    var b = document.getElementById('p2Busy');
    if (b) b.onchange = function () { _f.onlyBusy = b.checked; render(); };
  }

  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  // ── Kiosztatlan fuvarok (pool) ──────────────────────────
  function poolHtml(pool) {
    return '<div class="glass" style="padding:12px 14px;margin-bottom:12px;">'
      + '<div class="text-primary" style="font-size:13px;font-weight:700;margin-bottom:8px;">' + t('pl.poolTitle') + ' (' + pool.length + ')'
      + ' <span class="text-muted" style="font-weight:400;font-size:11px;">' + t('pl.poolHint') + '</span></div>'
      + '<div class="p2-pool" ondragover="Planner._dov(event)" ondragleave="Planner._dlv(event)" ondrop="Planner._dpPool(event)" onclick="Planner.poolTap(event)">'
      + (pool.map(cardHtml).join('') || '<span class="text-muted" style="font-size:12px;">' + t('pl.poolEmpty') + '</span>')
      + '</div></div>';
  }

  function cardHtml(o) {
    var st = ST[o.status] || { c: '#3b82f6' };
    var best = (_matchByOrder[String(o.id)] || [])[0];
    return '<div class="p2-card' + (String(_selOid) === String(o.id) ? ' picked' : '') + '" draggable="true" data-oid="' + esc(String(o.id)) + '" '
      + 'style="background:' + st.c + 'cc;" ondragstart="Planner._ds(event)" onclick="Planner.openPop(\'' + esc(String(o.id)) + '\',event)">'
      + esc(String(o.id).replace('CMD-', '#')) + ' · ' + esc(o.client || '—')
      + '<span class="sub">' + esc(o.loc_incarcare || '?') + ' → ' + esc(o.loc_descarcare || '?')
      + ' · ' + fmtD(o.data_incarcare) + (o.data_descarcare ? '–' + fmtD(o.data_descarcare) : '') + '</span>'
      + (o.status === 'Parkolt' ? '<span class="sub">' + t('pl.cargoOnTrailer') + ' ' + esc(o.rendszam_remorca || '?') + ' @ ' + esc(o.handover_loc || o.loc_incarcare || '') + '</span>' : '')
      + (o.status === 'Raktarban' ? '<span class="sub">' + t('pl.inWarehouse') + ' ' + esc(o.handover_loc || o.loc_incarcare || '') + '</span>' : '')
      + (best ? '<span class="hint">🎯 ' + esc(best.rendszam) + ' · ' + best.km + ' ' + t('pl.emptyKm') + (best.atfedes ? ' ⚠️' : '') + '</span>' : '')
      + '</div>';
  }

  // ── 🖥️ GANTT ────────────────────────────────────────────
  function ganttHtml(days, today) {
    var W = colW();
    var vehs = _veh.slice();
    var html = '<div class="glass' + (_selOid ? ' p2-picking' : '') + '" style="padding:0;overflow:hidden;">'
      + '<div class="p2-board"><div class="p2-inner" style="width:' + (RAIL + _days * W) + 'px;">';

    // fejléc
    html += '<div class="p2-headrow"><div class="p2-corner">' + t('pl.vehicleCol') + '</div>'
      + days.map(function (d) {
          var y = ymd(d), we = d.getDay() === 0 || d.getDay() === 6;
          return '<div class="p2-day' + (we ? ' we' : '') + (y === today ? ' today' : '') + '" style="width:' + W + 'px;">'
            + '<span class="dn">' + DAYNAMES[d.getDay()] + '</span><br>' + (d.getMonth() + 1) + '.' + d.getDate() + '.</div>';
        }).join('') + '</div>';

    // kihasználtság-sor
    var total = vehs.length || 1;
    html += '<div class="p2-utilrow"><div class="p2-utilcorner">' + t('pl.utilization') + '</div>'
      + days.map(function (d) {
          var y = ymd(d);
          var busy = vehs.filter(function (v) {
            return _orders.some(function (o) {
              if (!o.rendszam_camion || o.rendszam_camion.toUpperCase() !== v.rendszam.toUpperCase()) return false;
              var s = dstr(o.data_incarcare), e = dstr(o.data_descarcare) || s;
              return s && s <= y && e >= y;
            });
          }).length;
          var pct = busy / total;
          var col = busy === 0 ? 'transparent' : pct < 0.5 ? 'rgba(34,197,94,0.25)' : pct < 0.85 ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.35)';
          return '<div class="p2-util" style="width:' + W + 'px;background:' + col + ';">' + (busy || '') + '</div>';
        }).join('') + '</div>';

    // jármű-sorok
    var todayIdx = dayIdx(today);
    vehs.forEach(function (v) {
      var mine = _orders.filter(function (o) {
        return o.rendszam_camion && o.rendszam_camion.toUpperCase() === v.rendszam.toUpperCase();
      });
      if (_f.onlyBusy && !mine.length) return;
      var lay = layoutVehicle(mine);
      var H = Math.max(lay.laneCount * laneH() + 6, 40);
      var gpsOn = _gps[v.rendszam.toUpperCase()];
      html += '<div class="p2-row"><div class="p2-rail" style="height:' + H + 'px;">'
        + '<div class="rs text-primary"><span class="p2-dot' + (gpsOn ? ' on' : '') + '" title="' + (gpsOn ? 'Megy (GPS)' : 'Áll / nincs GPS') + '"></span>🚛 ' + esc(v.rendszam) + '</div>'
        + '<div class="rd">' + esc([v.marca, v.model].filter(Boolean).join(' ') || '') + '</div></div>'
        + '<div class="p2-lanes" style="width:' + (_days * W) + 'px;height:' + H + 'px;">';
      // nap-cellák (drop + koppintás célpontok)
      days.forEach(function (d, i) {
        var y = ymd(d), we = d.getDay() === 0 || d.getDay() === 6;
        html += '<div class="p2-dcell' + (we ? ' we' : '') + (y === today ? ' today' : '') + '" style="left:' + (i * W) + 'px;width:' + W + 'px;" '
          + 'data-rendszam="' + esc(v.rendszam) + '" data-day="' + y + '" '
          + 'ondragover="Planner._dov(event)" ondragleave="Planner._dlv(event)" ondrop="Planner._dp(event)" onclick="Planner.cellTap(event)"></div>';
      });
      if (todayIdx >= 0 && todayIdx < _days) html += '<div class="p2-todayline" style="left:' + (todayIdx * W + Math.round(W / 2)) + 'px;"></div>';
      // fuvar-sávok
      lay.bars.forEach(function (b) {
        var o = b.o, st = ST[o.status] || { c: '#3b82f6' };
        var s = Math.max(b.s, 0), e = Math.min(b.e, _days - 1);
        var left = s * W + 2, width = (e - s + 1) * W - 6;
        var dim = !passes(o);
        var icons = (parseInt(o.pod_count, 10) > 0 ? '📷' : '') + (!o.nume_sofer ? '⚠️' : '');
        html += '<div class="p2-bar' + (b.conflict ? ' conflict' : '') + (dim ? ' dim' : '') + (String(_selOid) === String(o.id) ? ' picked' : '') + '" '
          + 'draggable="true" data-oid="' + esc(String(o.id)) + '" '
          + 'style="left:' + left + 'px;width:' + width + 'px;top:' + (b.lane * laneH() + 4) + 'px;height:' + (laneH() - 7) + 'px;background:' + st.c + 'cc;" '
          + 'title="' + esc(String(o.id) + ' · ' + (o.client || '') + '\n' + (o.loc_incarcare || '?') + ' → ' + (o.loc_descarcare || '?') + '\n' + (o.nume_sofer || 'NINCS SOFŐR') + ' · ' + o.status + (b.conflict ? '\n⚠️ Átfedés: több fuvar ugyanazon a járművön (részrakomány is lehet)' : '')) + '" '
          + 'ondragstart="Planner._ds(event)" onclick="Planner.openPop(\'' + esc(String(o.id)) + '\',event)">'
          + (b.conflict ? '⚠️ ' : '') + icons + esc(String(o.id).replace('CMD-', '#')) + ' ' + esc((o.loc_descarcare || o.client || '').slice(0, 22))
          + (width > 150 ? ' <span class="sub">' + esc(o.nume_sofer || '') + '</span>' : '')
          + '<span class="p2-rz" data-oid="' + esc(String(o.id)) + '" onpointerdown="Planner.rzStart(event)" title="Húzd a lerakó-dátum módosításához"></span>'
          + '</div>';
      });
      html += '</div></div>';
    });
    if (!vehs.length) html += '<div class="text-muted" style="padding:20px;text-align:center;">Nincs aktív vontató.</div>';
    html += '</div></div></div>';
    return html;
  }

  // ── 📱 MOBIL napi nézet ─────────────────────────────────
  function mobileHtml(days, today) {
    if (dayIdx(_mDay) == null || dayIdx(_mDay) < 0 || dayIdx(_mDay) >= _days) _mDay = ymd(days[0]);
    var strip = '<div class="p2-strip">' + days.map(function (d) {
      var y = ymd(d);
      var cnt = _orders.filter(function (o) {
        var s = dstr(o.data_incarcare), e = dstr(o.data_descarcare) || s;
        return o.rendszam_camion && s && s <= y && e >= y;
      }).length;
      return '<div class="p2-stripd' + (y === _mDay ? ' sel' : '') + (y === today ? '" style="border-color:var(--brand-red);' : '"') + ' onclick="Planner.mday(\'' + y + '\')">'
        + '<div class="dn">' + DAYNAMES[d.getDay()] + '</div><div class="dd">' + d.getDate() + '</div>'
        + (cnt ? '<div class="ct">' + cnt + ' fuvar</div>' : '<div class="ct">&nbsp;</div>') + '</div>';
    }).join('') + '</div>';

    var cards = _veh.map(function (v) {
      var dayOrders = _orders.filter(function (o) {
        if (!o.rendszam_camion || o.rendszam_camion.toUpperCase() !== v.rendszam.toUpperCase()) return false;
        var s = dstr(o.data_incarcare), e = dstr(o.data_descarcare) || s;
        return s && s <= _mDay && e >= _mDay && passes(o);
      });
      if (_f.onlyBusy && !dayOrders.length) return '';
      var gpsOn = _gps[v.rendszam.toUpperCase()];
      return '<div class="p2-vcard glass-soft' + (_selOid ? ' picking' : '') + '" '
        + (_selOid ? 'onclick="Planner.vcardTap(\'' + esc(v.rendszam) + '\')"' : '') + '>'
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:' + (dayOrders.length ? '7px' : '0') + ';">'
        + '<span class="p2-dot' + (gpsOn ? ' on' : '') + '"></span>'
        + '<b class="text-primary" style="font-size:13px;">🚛 ' + esc(v.rendszam) + '</b>'
        + '<span class="text-muted" style="font-size:11px;">' + esc(v.marca || '') + '</span>'
        + (_selOid ? '<span style="margin-left:auto;color:#3b82f6;font-weight:800;font-size:12px;">+ IDE</span>' : '')
        + '</div>'
        + dayOrders.map(function (o) {
            var st = ST[o.status] || { c: '#3b82f6' };
            return '<div class="p2-card" style="background:' + st.c + 'cc;max-width:none;margin-bottom:5px;" '
              + 'onclick="Planner.openPop(\'' + esc(String(o.id)) + '\',event)">'
              + esc(String(o.id).replace('CMD-', '#')) + ' · ' + esc(o.client || '—')
              + '<span class="sub">' + esc(o.loc_incarcare || '?') + ' → ' + esc(o.loc_descarcare || '?') + ' · ' + esc(o.nume_sofer || '⚠️ nincs sofőr') + '</span></div>';
          }).join('')
        + '</div>';
    }).join('');

    return '<div class="glass" style="padding:12px;margin-bottom:12px;">' + strip + '</div>' + (cards || '<div class="glass text-muted" style="padding:18px;text-align:center;">Nincs jármű.</div>');
  }

  // ── 💡 Visszfuvar-radar panel ───────────────────────────
  function renderRadar() {
    var box = document.getElementById('p2RadarBox');
    if (!box) return;
    if (!_matches.length) { box.innerHTML = ''; return; }
    var rows = _matches.slice(0, 5).map(function (m) {
      var s = m.suggestions[0];
      var origin = s.live ? esc(s.honnan)
        : esc(s.honnan) + (s.atfedes ? ' körül' : ' lerakó után') + (s.szabad_tol ? ', szabad: ' + fmtD(s.szabad_tol) : '');
      return '<div class="rrow">'
        + '<span>💡 <b class="text-primary">' + esc(String(m.order_id).replace('CMD-', '#')) + '</b> '
        + '<span class="text-muted">(' + esc(m.loc_incarcare) + ' felrakó' + (m.data_incarcare ? ', ' + fmtD(m.data_incarcare) : '') + ')</span>'
        + ' ↔ <b class="text-primary">' + esc(s.rendszam) + '</b> '
        + '<b style="color:var(--status-ok);">' + s.km + ' km</b><span class="text-muted"> üresjárattal (' + origin + ')</span>'
        + (s.atfedes ? ' <span class="badge warn" title="A kamionnak átfedő fuvarja van ekkor — részrakományként még felférhet">⚠️ átfedéssel</span>' : '')
        + (s.ftl_conflict ? ' <span class="badge err" title="Az átfedő fuvar FTL (teljes rakomány) — részrakomány nem fér fel">🚫 FTL</span>' : '')
        + (s.weight_warn ? ' <span class="badge err" title="A részrakományok együttes súlya túllépi a pótkocsi rakható tömegét">⚖️ ' + Math.round(s.suly_kg/1000) + 't túlsúly</span>' : '') + '</span>'
        + '<button class="btn ok" style="margin-left:auto;padding:4px 12px;font-size:12px;" '
        + 'onclick="Planner.acceptMatch(\'' + esc(String(m.order_id)) + '\',\'' + esc(s.rendszam) + '\')">✓ Kioszt</button>'
        + '</div>';
    }).join('');
    box.innerHTML = '<div class="p2-radar">'
      + '<div class="text-primary" style="font-size:13px;font-weight:800;margin-bottom:4px;">' + t('pl.radarTitle') + ' '
      + '<span class="text-muted" style="font-weight:400;font-size:11px;">' + t('pl.radarSub') + '</span></div>'
      + rows + '</div>';
  }

  // ── Popover (fuvar-kártya) ──────────────────────────────
  function popoverHtml() {
    if (!_popOid) return '';
    var o = _orders.find(function (x) { return String(x.id) === String(_popOid); });
    if (!o) return '';
    var st = ST[o.status] || { c: '#3b82f6', t: o.status };
    var sugg = _matchByOrder[String(o.id)] || [];
    return '<div class="p2-pop" onclick="event.stopPropagation()">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'
      + '<span style="width:10px;height:10px;border-radius:3px;background:' + st.c + ';"></span>'
      + '<b class="text-primary" style="font-size:15px;">' + esc(String(o.id)) + '</b>'
      + '<span class="badge info">' + esc(o.status) + '</span>'
      + '<button class="btn ghost" style="margin-left:auto;padding:3px 10px;" onclick="Planner.closePop()">✕</button></div>'
      + '<div class="text-primary" style="font-size:13px;font-weight:700;">' + esc(o.loc_incarcare || '?') + ' → ' + esc(o.loc_descarcare || '?') + '</div>'
      + '<div class="text-muted" style="font-size:12px;margin:3px 0 10px;">' + esc(o.client || '—')
      + ' · ' + esc(o.nume_sofer || t('pl.noDriver')) + ' · 🚛 ' + esc(o.rendszam_camion || t('pl.noVehicle')) + '</div>'
      + '<div style="display:flex;gap:8px;align-items:end;margin-bottom:10px;">'
      + '<div class="field" style="margin:0;flex:1;"><label>' + t('pl.loadAt') + '</label><input class="input" type="date" id="p2pInc" value="' + (dstr(o.data_incarcare) || '') + '" style="padding:7px;font-size:12.5px;"></div>'
      + '<div class="field" style="margin:0;flex:1;"><label>' + t('pl.unloadAt') + '</label><input class="input" type="date" id="p2pDesc" value="' + (dstr(o.data_descarcare) || '') + '" style="padding:7px;font-size:12.5px;"></div>'
      + '<button class="btn primary" style="padding:8px 12px;font-size:12px;" onclick="Planner.popSaveDates(\'' + esc(String(o.id)) + '\')">💾</button></div>'
      + (sugg.length ? '<div style="margin-bottom:10px;">' + sugg.map(function (s) {
          return '<div style="display:flex;align-items:center;gap:6px;font-size:12px;padding:3px 0;">'
            + '<span>🎯 <b>' + esc(s.rendszam) + '</b> · <b style="color:var(--status-ok);">' + s.km + ' km</b> üresjárat'
            + (s.live ? ' <span class="badge info" title="Élő GPS-pozícióból">📍</span>' : '')
            + (s.atfedes ? ' <span class="badge warn" title="Átfedő fuvar — részrakományként még felférhet">⚠️</span>' : '')
            + (s.ftl_conflict ? ' <span class="badge err" title="Átfedő FTL fuvar — részrakomány nem fér fel">🚫</span>' : '')
            + (s.weight_warn ? ' <span class="badge err" title="Részrakomány-túlsúly">⚖️</span>' : '') + '</span>'
            + '<button class="btn ok" style="margin-left:auto;padding:3px 10px;font-size:11px;" onclick="Planner.acceptMatch(\'' + esc(String(o.id)) + '\',\'' + esc(s.rendszam) + '\')">' + t('pl.assignDo') + '</button></div>';
        }).join('') + '</div>' : '')
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
      + '<button class="btn primary" style="flex:1;padding:9px;font-size:12.5px;" onclick="Planner.startMove(\'' + esc(String(o.id)) + '\')">' + (o.rendszam_camion ? t('pl.reassign') : t('pl.assign')) + '</button>'
      + '<button class="btn ghost" style="flex:1;padding:9px;font-size:12.5px;" onclick="Planner.closePop();openOrderEdit(\'' + esc(String(o.id)) + '\')">' + t('pl.edit') + '</button>'
      + (o.rendszam_camion ? '<button class="btn danger" style="padding:9px 12px;font-size:12.5px;" onclick="Planner.unassign(\'' + esc(String(o.id)) + '\')">' + t('pl.unassign') + '</button>' : '')
      + '</div></div>';
  }

  function actionBarHtml() {
    if (!_selOid) return '';
    return '<div class="p2-actionbar">'
      + '<span style="font-size:13px;color:#fff;">📌 <b>' + esc(String(_selOid)) + '</b> — '
      + (isMobile() ? t('pl.abMobile') : t('pl.abDesktop'))
      + t('pl.abPoolNote') + '</span>'
      + '<button class="btn primary" style="margin-left:auto;padding:6px 14px;font-size:12px;" onclick="Planner.pick(null)">' + t('pl.cancel') + '</button>'
      + '</div>';
  }

  // ── Publikus API ────────────────────────────────────────
  window.Planner = {
    load: load,
    shift: function (n) { _start = addDays(_start, n); _selOid = null; _popOid = null; load(); },
    today: function () { _start = monday(new Date()); _mDay = ymd(new Date()); _selOid = null; _popOid = null; load(); },
    density: function () { _dense = !_dense; render(); },
    mday: function (y) { _mDay = y; render(); },

    // popover
    openPop: function (oid, e) { if (e) e.stopPropagation(); if (_selOid) return; _popOid = oid; render(); },
    closePop: function () { _popOid = null; render(); },
    popSaveDates: function (oid) {
      var inc = (document.getElementById('p2pInc') || {}).value;
      var desc = (document.getElementById('p2pDesc') || {}).value;
      if (desc && inc && desc < inc) { toast('A lerakás nem lehet a felrakás előtt!', 'err'); return; }
      var f = {};
      if (inc) f.data_incarcare = inc;
      if (desc) f.data_descarcare = desc;
      if (!Object.keys(f).length) { toast('Adj meg dátumot!', 'err'); return; }
      assign(oid, f, '📅 Dátumok mentve');
    },
    startMove: function (oid) { _popOid = null; _selOid = oid; render(); },
    unassign: function (oid) { assign(oid, { rendszam_camion: null }, oid + ' kiosztása törölve'); },
    acceptMatch: function (oid, rendszam) { assign(oid, { rendszam_camion: rendszam }, '💡 ' + oid + ' → ' + rendszam + ' (radar-javaslat)'); },

    // kiválasztás / koppintásos kiosztás
    pick: function (oid) { _selOid = oid || null; render(); },
    cellTap: function (e) {
      if (!_selOid) return;
      var c = e.currentTarget;
      assignTo(_selOid, c.getAttribute('data-rendszam'), c.getAttribute('data-day'));
    },
    vcardTap: function (rendszam) { if (_selOid) assignTo(_selOid, rendszam, _mDay); },
    poolTap: function (e) { if (_selOid) assign(_selOid, { rendszam_camion: null }, 'Kiosztás törölve'); },

    // drag&drop (asztali)
    _ds: function (e) { e.dataTransfer.setData('text/plain', e.target.getAttribute('data-oid')); e.dataTransfer.effectAllowed = 'move'; },
    _dov: function (e) { e.preventDefault(); e.currentTarget.classList.add('dragover'); e.dataTransfer.dropEffect = 'move'; },
    _dlv: function (e) { e.currentTarget.classList.remove('dragover'); },
    _dp: function (e) {
      e.preventDefault(); e.currentTarget.classList.remove('dragover');
      var oid = e.dataTransfer.getData('text/plain');
      if (oid) assignTo(oid, e.currentTarget.getAttribute('data-rendszam'), e.currentTarget.getAttribute('data-day'));
    },
    _dpPool: function (e) {
      e.preventDefault(); e.currentTarget.classList.remove('dragover');
      var oid = e.dataTransfer.getData('text/plain');
      if (oid) assign(oid, { rendszam_camion: null }, oid + ' kiosztása törölve');
    },

    // sáv-átméretezés (lerakó-dátum húzása a jobb szélen)
    rzStart: function (e) {
      e.preventDefault(); e.stopPropagation();
      var oid = e.target.getAttribute('data-oid');
      var o = _orders.find(function (x) { return String(x.id) === String(oid); });
      if (!o || !dstr(o.data_incarcare)) return;
      var bar = e.target.parentElement;
      bar.setAttribute('draggable', 'false');
      _resize = { oid: oid, startX: e.clientX, baseW: bar.offsetWidth, bar: bar,
        baseEnd: dstr(o.data_descarcare) || dstr(o.data_incarcare), inc: dstr(o.data_incarcare) };
      var mv = function (ev) {
        if (!_resize) return;
        var w = Math.max(colW() - 6, _resize.baseW + (ev.clientX - _resize.startX));
        _resize.bar.style.width = w + 'px';
      };
      var up = function (ev) {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        if (!_resize) return;
        var deltaDays = Math.round((ev.clientX - _resize.startX) / colW());
        var newEnd = shiftDate(_resize.baseEnd, deltaDays);
        if (newEnd < _resize.inc) newEnd = _resize.inc;
        var r = _resize; _resize = null;
        if (newEnd !== r.baseEnd) assign(r.oid, { data_descarcare: newEnd }, '📅 Lerakás: ' + fmtD(newEnd));
        else render();
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    },
  };

  // popover bezárása háttér-kattintásra + nézetváltás átméretezéskor
  document.addEventListener('click', function () { if (_popOid) { _popOid = null; render(); } });
  var _rsz; window.addEventListener('resize', function () {
    clearTimeout(_rsz);
    _rsz = setTimeout(function () { if (document.getElementById('plannerBox') && document.getElementById('plannerBox').dataset.ready) render(); }, 300);
  });
})();
