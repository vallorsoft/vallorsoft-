// ============================================================
//  VallorSoft — public/route-dev-map.js
//  Útvonal-eltérés térképen: a tervezett útvonal (kék, szaggatott) és a GPS
//  szerinti valós út (zöld) egymáson, a tervtől letért szakaszok pirossal.
//  Egy fuvarra, egy menetlevélre (összes fuvarja) vagy időszakra.
//  RouteDevMap.open({ order_id }) | ({ waybill_id }) | ({ from, to, status? })
//  Adat: routeDeviationMap RPC (company_id-szűrt). Térkép mindig világos.
// ============================================================
(function () {
  'use strict';
  var C_PLAN = '#2563eb', C_ACT = '#16a34a', C_OFF = '#dc2626', C_EMPTY = '#64748b';
  var M = { map: null, layers: null, data: null, focus: null, args: null };

  function _t(k, fb, vars) {
    var s = (typeof window.t === 'function') ? window.t(k, vars) : null;
    if (!s || s === k) s = fb || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split('{' + v + '}').join(vars[v]); });
    return s;
  }
  function _e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function _n(v, d) { if (v == null || v === '' || !isFinite(v)) return '—'; return Number(v).toLocaleString('ro-RO', { maximumFractionDigits: d == null ? 1 : d }); }
  function _sign(v) { return v == null ? '—' : (Number(v) > 0 ? '+' : '') + _n(v); }
  function _dt(v) { if (!v) return ''; var d = new Date(v); return isNaN(d) ? '' : d.toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  function _h(v) { if (v == null) return '—'; var m = Math.round(Number(v) * 60); return Math.floor(m / 60) + 'h ' + ('0' + (m % 60)).slice(-2) + 'm'; }

  function statusBadge(st) {
    var map = {
      deviation: ['#b45309', '#fef3c7', _t('rdm.st.deviation', 'Abatere')],
      ok: ['#15803d', '#dcfce7', _t('rdm.st.ok', 'În regulă')],
      no_data: ['#475569', '#e2e8f0', _t('rdm.st.noData', 'Fără date')],
      not_checked: ['#1d4ed8', '#dbeafe', _t('rdm.st.notChecked', 'Neverificat încă')]
    };
    var x = map[st] || map.no_data;
    return '<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11.5px;font-weight:700;color:' + x[0] + ';background:' + x[1] + ';">' + _e(x[2]) + '</span>';
  }

  function ensureModal() {
    var el = document.getElementById('rdmModal');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'modal-back';
    el.id = 'rdmModal';
    el.style.zIndex = '1100';
    el.innerHTML = '<div class="modal glass vs-light-surface rdm-box">'
      + '<div class="rdm-head"><div id="rdmTitle" class="rdm-title"></div>'
      + '<button class="btn ghost" id="rdmAll" onclick="RouteDevMap.focus(null)" title="' + _e(_t('rdm.showAll', 'Toate cursele')) + '">⤢</button>'
      + '<button class="btn" onclick="RouteDevMap.close()">✕</button></div>'
      + '<div id="rdmSummary"></div>'
      + '<div class="rdm-legend">'
      + '<span><i style="border-top:4px dashed ' + C_PLAN + ';"></i>' + _e(_t('rdm.legPlan', 'Traseu planificat')) + '</span>'
      + '<span id="rdmLegEmpty"><i style="border-top:4px dotted ' + C_EMPTY + ';"></i>' + _e(_t('rdm.legEmptyRun', 'Planificat — gol (fără marfă)')) + '</span>'
      + '<span><i style="border-top:4px solid ' + C_ACT + ';"></i>' + _e(_t('rdm.legAct', 'Traseu real (GPS)')) + '</span>'
      + '<span><i style="border-top:5px solid ' + C_OFF + ';"></i>' + _e(_t('rdm.legOff', 'Abatere de la plan (> {km} km)', { km: 1 })) + '</span>'
      + '<span>① ' + _e(_t('rdm.legStops', 'puncte de încărcare / descărcare')) + '</span></div>'
      + '<div id="rdmCanvas" class="rdm-canvas"></div>'
      + '<div id="rdmList" class="rdm-list"></div>'
      + '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) { if (e.target === el) RouteDevMap.close(); });
    if (!document.getElementById('rdmCss')) {
      var css = document.createElement('style'); css.id = 'rdmCss';
      css.textContent = '.rdm-box{width:min(1180px,100%);max-height:95vh;overflow:auto;display:flex;flex-direction:column;gap:10px;color:#0f172a;}'
        + '.rdm-head{display:flex;align-items:center;gap:8px;}.rdm-title{flex:1;font-weight:800;font-size:16px;min-width:0;}'
        + '.rdm-sub{font-size:12.5px;color:#475569;font-weight:500;}'
        + '.rdm-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;}'
        + '.rdm-kpi{border:1.5px solid #cbd5e1;border-radius:12px;padding:8px 10px;background:#f8fafc;}'
        + '.rdm-kpi b{display:block;font-size:17px;color:#0f172a;}.rdm-kpi span{font-size:11.5px;color:#475569;}'
        + '.rdm-kpi.warn{border-color:#f59e0b;background:#fffbeb;}.rdm-kpi.ok{border-color:#22c55e;background:#f0fdf4;}'
        + '.rdm-legend{display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:#334155;}'
        + '.rdm-legend i{display:inline-block;width:26px;vertical-align:middle;margin-right:6px;}'
        + '.rdm-canvas{height:min(58vh,540px);min-height:320px;border-radius:12px;overflow:hidden;border:1.5px solid #cbd5e1;background:#eef2f7;}'
        + '.rdm-list table{width:100%;border-collapse:collapse;font-size:12.5px;}'
        + '.rdm-list th{text-align:left;color:#334155;font-weight:700;border-bottom:1.5px solid #cbd5e1;padding:6px;white-space:nowrap;}'
        + '.rdm-list td{border-bottom:1px solid #e2e8f0;padding:6px;vertical-align:top;color:#0f172a;}'
        + '.rdm-list tr.rdm-row{cursor:pointer;}.rdm-list tr.rdm-row:hover td{background:#eff6ff;}'
        + '.rdm-list tr.rdm-on td{background:#dbeafe;}.rdm-list .m{color:#475569;font-size:11.5px;}'
        + '.rdm-num{background:#1e293b;color:#fff;border:2px solid #fff;border-radius:50%;width:22px;height:22px;line-height:18px;text-align:center;font-weight:800;font-size:11px;box-shadow:0 1px 4px rgba(0,0,0,.4);}'
        + '.rdm-num.p{background:#1d4ed8;}.rdm-num.d{background:#b91c1c;}'
        + '.rdm-det{background:#fff;border:2px solid #c2410c;border-radius:50%;width:24px;height:24px;line-height:20px;text-align:center;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,.35);}'
        + '.rdm-segs tr.dev td{background:#fffbeb;}.rdm-segs .pill{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:700;margin:1px 2px 1px 0;}'
        + '@media (max-width:640px){.rdm-canvas{height:52vh;}.rdm-list th:nth-child(5),.rdm-list td:nth-child(5){display:none;}}';
      document.head.appendChild(css);
    }
    return el;
  }

  var DET_ICON = { fuel: '⛽', break: '☕', daily_rest: '🛏️', parking: '🅿️' };
  function detLabel(r) {
    return { fuel: _t('rdm.det.fuel', 'Alimentare'), break: _t('rdm.det.break', 'Pauză'), daily_rest: _t('rdm.det.rest', 'Odihnă zilnică'),
      parking: _t('rdm.det.parking', 'Parcare / oprire') }[r] || r;
  }
  function _eur(v) { return v == null ? '—' : _n(v) + ' €'; }
  function segTable(it) {
    var segs = it.segments || [];
    if (!segs.length) return '';
    return '<div class="rdm-list rdm-segs" style="margin-top:8px;"><div class="rdm-sub" style="margin-bottom:4px;">'
      + _e(_t('rdm.segHint', 'Fiecare segment între punctele reale (GPS) este comparat cu cel mai scurt traseu pentru camion (HERE, 40 t). Ocolirile pentru alimentare, pauză sau parcare nu se socotesc abatere.'))
      + '</div><div style="overflow-x:auto;"><table><thead><tr><th>#</th><th>' + _e(_t('rdm.c.leg', 'Segment')) + '</th><th>'
      + _e(_t('rdm.k.planned', 'Planificat')) + '</th><th>' + _e(_t('rdm.k.actual', 'Parcurs (GPS)')) + '</th><th>'
      + _e(_t('rdm.c.detours', 'Ocoliri justificate')) + '</th><th>' + _e(_t('rdm.c.extra', 'În plus')) + '</th><th></th></tr></thead><tbody>'
      + segs.map(function (g, i) {
        var dets = (g.detours || []).map(function (x) {
          return '<span class="pill" style="color:#9a3412;background:#ffedd5;" title="' + _e(detLabel(x.reason) + ' · ' + _n(x.stop_min, 0) + ' min') + '">'
            + (DET_ICON[x.reason] || '•') + ' ' + _n(x.excused_km) + ' km</span>';
        }).join('');
        var extra = g.status === 'deviation'
          ? '<b style="color:#b45309;">+' + _n(g.extra_km) + ' km</b><div class="m">' + _h(g.extra_h) + ' · ' + _n(g.extra_l) + ' L'
            + (g.extra_toll ? ' · ' + _eur(g.extra_toll) : '') + '</div>'
          : (g.status === 'ok' ? '—' : '');
        var st = g.status === 'no_data'
          ? '<span class="m">' + _e(g.reason === 'time' ? _t('rdm.segNoTime', 'fără ore') : _t('rdm.segNoGps', 'fără GPS')) + '</span>'
          : statusBadge(g.status);
        return '<tr class="' + (g.status === 'deviation' ? 'dev' : '') + '"><td>' + (i + 1) + '</td><td>' + _e(g.from || '?') + ' → ' + _e(g.to || '?')
          + (g.empty ? ' <span class="pill" style="color:#334155;background:#f1f5f9;border:1px dashed #64748b;">' + _e(_t('oc.legEmpty', 'gol')) + '</span>' : '')
          + '</td><td>' + _n(g.planned_km) + ' km</td><td>' + _n(g.actual_km) + ' km</td><td>' + (dets || '—') + '</td><td>' + extra + '</td><td>' + st + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function kpi(label, val, cls) { return '<div class="rdm-kpi' + (cls ? ' ' + cls : '') + '"><b>' + val + '</b><span>' + _e(label) + '</span></div>'; }

  function renderSummary() {
    var d = M.data, el = document.getElementById('rdmSummary');
    var it = M.focus != null ? d.items[M.focus] : null;
    var html = '<div class="rdm-kpis">';
    var wr = (d.mode === 'waybill' && !it) ? (d.meta || {}).route : null;
    if (d.mode === 'waybill' && !it && !wr) {
      el.innerHTML = '<div class="rdm-sub">' + _e(_t('rdm.wbPending', 'Traseul complet al foii de parcurs (Plecare → Sosire) se calculează acum în fundal — redeschide harta peste un minut.')) + '</div>';
      return;
    }
    if (wr && wr.status === 'no_data' && wr.reason === 'no_here') {
      el.innerHTML = '<div class="rdm-sub">' + _e(_t('rdm.ndNoHere', 'Planul se calculează doar cu HERE (camion 40 t) — firma nu are o cheie HERE activă. Calculul OSRM (auto) ar fi înșelător, de aceea nu se face.')
        + (wr.free_reason && window.vsMapsReasonText ? ' (' + window.vsMapsReasonText(wr.free_reason) + ')' : '')) + '</div>';
      return;
    }
    if (wr) {
      var ws = wr.stats || {};
      var act = wr.odo_km != null ? wr.odo_km : wr.gps_km;
      html += kpi(_t('rdm.k.wbPlanned', 'Planificat Plecare → Sosire'), _n(wr.planned_km) + ' km')
        + kpi(_t('rdm.k.loaded', 'din care încărcat'), _n(wr.loaded_km) + ' km')
        + kpi(_t('rdm.k.empty', 'din care gol'), _n(wr.empty_km) + ' km' + (wr.planned_km ? ' (' + _n(wr.empty_km / wr.planned_km * 100) + '%)' : ''), wr.empty_km > 0 ? 'warn' : '')
        + kpi(_t('rdm.k.odo', 'Km odometru (foaie)'), _n(wr.odo_km) + ' km')
        + kpi(_t('rdm.k.gps', 'Km GPS'), _n(wr.gps_km) + ' km')
        + kpi(_t('rdm.k.diff', 'Diferență'), _sign(wr.diff_km) + ' km' + (wr.diff_pct != null ? ' (' + _sign(wr.diff_pct) + '%)' : ''), wr.status === 'deviation' ? 'warn' : wr.status === 'ok' ? 'ok' : '')
        + kpi(_t('rdm.k.offKm', 'Km în afara traseului'), _n(ws.off_km) + ' km' + (ws.off_pct != null ? ' (' + _n(ws.off_pct) + '%)' : ''), ws.off_km > 0 ? 'warn' : '')
        + kpi(_t('rdm.k.drive', 'Timp de mers'), _h(ws.drive_h) + (wr.planned_h != null ? ' / ' + _h(wr.planned_h) : ''))
        + kpi(_t('rdm.k.stops', 'Opriri ≥ 5 min'), _n(ws.stops, 0) + ' · ' + _h(ws.stop_h));
      html += '</div>';
      if (act == null) html += '<div class="rdm-sub" style="margin-top:6px;">' + _e(_t('rdm.wbNoKm', 'Lipsesc km de pe odometru și datele GPS — se afișează doar traseul planificat.')) + '</div>';
      var ll = wr.leg_list || [];
      if (ll.length) {
        html += '<div class="rdm-list" style="margin-top:8px;"><table><thead><tr><th>#</th><th>' + _e(_t('rdm.c.leg', 'Segment')) + '</th><th>Km</th><th></th></tr></thead><tbody>'
          + ll.map(function (l, i) {
            return '<tr><td>' + (i + 1) + '</td><td>' + _e(l.from || '?') + ' → ' + _e(l.to || '?') + '</td><td>' + _n(l.km) + '</td><td>'
              + (l.empty ? '<span style="padding:1px 7px;border-radius:999px;font-size:11px;font-weight:700;color:#334155;background:#f1f5f9;border:1px dashed #64748b;">' + _e(_t('oc.legEmpty', 'gol')) + '</span>'
                : '<span style="padding:1px 7px;border-radius:999px;font-size:11px;font-weight:700;color:#1e40af;background:#dbeafe;">' + _e(_t('oc.legLoaded', 'încărcat')) + '</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      }
      html += '<div style="margin-top:6px;"><button class="btn ghost" style="padding:5px 10px;" onclick="RouteDevMap.recheckWaybill()">🔄 ' + _e(_t('rdm.recalc', 'Recalculează')) + '</button>'
        + ' <span class="rdm-sub">' + _e(_t('rdm.wbOrdersHint', 'Click pe o cursă din listă pentru detalii pe cursă.')) + '</span></div>';
      el.innerHTML = html;
      return;
    }
    if (it) {
      var s = it.stats || {};
      html += kpi(_t('rdm.k.planned', 'Planificat'), _n(it.planned_km) + ' km')
        + kpi(_t('rdm.k.actual', 'Parcurs (GPS)'), _n(it.actual_km) + ' km')
        + (it.empty_km != null ? kpi(_t('rdm.k.empty', 'din care gol'), _n(it.empty_km) + ' km', it.empty_km > 0 ? 'warn' : '') : '')
        + kpi(_t('rdm.k.diff', 'Diferență'), _sign(it.diff_km) + ' km' + (it.diff_pct != null ? ' (' + _sign(it.diff_pct) + '%)' : ''))
        + kpi(_t('rdm.k.extraShort', 'Km în plus față de traseul mai scurt'), _n(it.extra_km) + ' km', it.status === 'deviation' ? 'warn' : it.status === 'ok' ? 'ok' : '')
        + (it.seg_summary ? kpi(_t('rdm.k.excused', 'Ocoliri justificate (alimentare / pauză)'), _n(it.seg_summary.excused_km) + ' km')
          + (it.status === 'deviation' ? kpi(_t('rdm.k.extraCost', 'Cost în plus (timp · motorină · taxă)'), _h(it.seg_summary.extra_h) + ' · ' + _n(it.seg_summary.extra_l) + ' L'
            + (it.seg_summary.extra_toll ? ' · ' + _eur(it.seg_summary.extra_toll) : ''), 'warn') : '') : '')
        + kpi(_t('rdm.k.offKm', 'Km în afara traseului'), _n(s.off_km) + ' km' + (s.off_pct != null ? ' (' + _n(s.off_pct) + '%)' : ''), s.off_km > 0 ? 'warn' : '')
        + kpi(_t('rdm.k.maxOff', 'Abatere maximă'), _n(s.max_off_km) + ' km')
        + kpi(_t('rdm.k.duration', 'Durată totală'), _h(s.duration_h))
        + kpi(_t('rdm.k.drive', 'Timp de mers'), _h(s.drive_h))
        + kpi(_t('rdm.k.stops', 'Opriri ≥ 5 min'), _n(s.stops, 0) + ' · ' + _h(s.stop_h))
        + kpi(_t('rdm.k.speed', 'Viteză medie / max'), _n(s.avg_kmh, 0) + ' / ' + _n(s.max_kmh, 0) + ' km/h');
    } else {
      var t = d.summary || {};
      html += kpi(_t('rdm.k.orders', 'Curse') + ' · ' + _n(t.checked, 0) + ' ' + _t('rdm.k.checked', 'verificate'), _n(t.orders, 0))
        + kpi(_t('rdm.k.planned', 'Planificat'), _n(t.planned_km) + ' km')
        + kpi(_t('rdm.k.actual', 'Parcurs (GPS)'), _n(t.actual_km) + ' km')
        + kpi(_t('rdm.k.diff', 'Diferență'), _sign(t.diff_km) + ' km' + (t.diff_pct != null ? ' (' + _sign(t.diff_pct) + '%)' : ''), (t.diff_km || 0) > 0 ? 'warn' : 'ok')
        + kpi(_t('rdm.k.extra', 'Km în plus (abateri)'), _n(t.extra_km) + ' km', t.extra_km > 0 ? 'warn' : '')
        + kpi(_t('rdm.k.saved', 'Km economisiți'), _n(t.saved_km) + ' km', t.saved_km > 0 ? 'ok' : '')
        + kpi(_t('rdm.k.devCount', 'Curse cu abatere'), _n(t.deviation || 0, 0) + ' / ' + _n(t.checked, 0), t.deviation ? 'warn' : 'ok')
        + kpi(_t('rdm.k.offKm', 'Km în afara traseului'), _n(t.off_km) + ' km')
        + kpi(_t('rdm.k.drive', 'Timp de mers'), _h(t.drive_h));
    }
    html += '</div>';
    if (it && it.status === 'not_checked') html += '<div class="rdm-sub" style="margin-top:6px;">' + _e(_t('rdm.notCheckedHint', 'Cursa nu a fost încă verificată — verificarea rulează acum în fundal, redeschide harta peste un minut.')) + '</div>';
    if (it && it.group && it.group.length > 1) html += '<div class="rdm-sub" style="margin-top:6px;">🔗 ' + _e(_t('rdm.tripGroup', 'Cursa face parte dintr-un drum cu mai multe curse — planul leagă toate punctele în ordinea orară, cu km goi dintre ele:') + ' ' + it.group.map(function (x) { return x.fuvar_no || x.id; }).join(' → ')) + '</div>';
    if (it && it.status === 'no_data') {
      var rk = { unreliable: ['rdm.ndUnreliable', 'Adresele reale ale punctelor nu sunt încă sigure (necesită confirmare) — abaterea nu se calculează.'],
        time: ['rdm.ndTime', 'Ora din GPS a unui punct diferă cu peste 12 ore de ora apăsată de șofer — potrivire nesigură, abaterea nu se calculează.'],
        overlap: ['rdm.ndOverlap', 'Drumul conține și alte curse ale căror puncte nu sunt sigure (sau prea multe curse) — abaterea nu se calculează:'],
        no_here: ['rdm.ndNoHere', 'Planul se calculează doar cu HERE (camion 40 t) — firma nu are o cheie HERE activă. Calculul OSRM (auto) ar fi înșelător, de aceea nu se face.'] }[it.reason];
      var msg = rk ? _t(rk[0], rk[1]) : _t('rdm.noDataHint', 'Lipsesc adresele reale ale punctelor sau datele GPS pentru această cursă.');
      if (it.reason === 'overlap' && it.overlap && it.overlap.length) msg += ' ' + it.overlap.map(function (x) { return x.fuvar_no || x.id; }).join(', ');
      if (it.reason === 'no_here' && it.free_reason && window.vsMapsReasonText) msg += ' (' + window.vsMapsReasonText(it.free_reason) + ')';
      html += '<div class="rdm-sub" style="margin-top:6px;">' + _e(msg) + '</div>';
    }
    if (it && it.segments && it.segments.length && it.status !== 'no_data') html += segTable(it);
    if (!it && d.meta && d.meta.truncated) html += '<div class="rdm-sub" style="margin-top:6px;">' + _e(_t('rdm.truncated', 'Se afișează primele 40 de curse (abaterile cele mai mari).')) + '</div>';
    el.innerHTML = html;
  }

  function renderList() {
    var d = M.data, el = document.getElementById('rdmList');
    if (!d.items.length && d.mode === 'waybill') { el.innerHTML = ''; return; }
    if (!d.items.length) { el.innerHTML = '<div class="rdm-sub" style="padding:8px 0;">' + _e(_t('rdm.none', 'Nu există curse verificate în această selecție.')) + '</div>'; return; }
    el.innerHTML = '<div style="overflow-x:auto;"><table><thead><tr><th>#</th><th>' + _e(_t('rdm.c.route', 'Traseu')) + '</th><th>'
      + _e(_t('rdm.k.planned', 'Planificat')) + '</th><th>' + _e(_t('rdm.k.actual', 'Parcurs (GPS)')) + '</th><th>'
      + _e(_t('rdm.k.offKm', 'Km în afara traseului')) + '</th><th>' + _e(_t('rdm.k.diff', 'Diferență')) + '</th></tr></thead><tbody>'
      + d.items.map(function (it, i) {
        var s = it.stats || {};
        return '<tr class="rdm-row' + (M.focus === i ? ' rdm-on' : '') + '" onclick="RouteDevMap.focus(' + i + ')">'
          + '<td><b>' + _e(it.fuvar_no || it.order_id) + '</b><div class="m">' + _e(it.rendszam || '') + (it.sofer ? ' · ' + _e(it.sofer) : '') + '</div></td>'
          + '<td>' + _e(it.loc_from || '?') + ' → ' + _e(it.loc_to || '?') + '<div class="m">' + _e(_dt(it.from_at)) + (it.to_at ? ' – ' + _e(_dt(it.to_at)) : '') + '</div></td>'
          + '<td>' + _n(it.planned_km) + ' km<div class="m"' + '>' + _e(it.source === 'here' ? 'HERE' : '') + '</div></td>'
          + '<td>' + _n(it.actual_km) + ' km<div class="m">' + _e(it.km_source === 'odo' ? _t('rdm.odo', 'odometru') : it.km_source ? 'GPS' : '') + '</div></td>'
          + '<td>' + _n(s.off_km) + ' km<div class="m">max ' + _n(s.max_off_km) + ' km</div></td>'
          + '<td>' + statusBadge(it.status) + (it.status === 'deviation' && it.extra_km != null ? '<div style="margin-top:3px;"><b>+' + _n(it.extra_km) + ' km</b></div>' : '')
          + (it.diff_km != null ? '<div class="m">' + _sign(it.diff_km) + ' km (' + _sign(it.diff_pct) + '%)</div>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function numIcon(n, kind) {
    return L.divIcon({ className: '', html: '<div class="rdm-num ' + (kind === 'pickup' ? 'p' : kind === 'delivery' ? 'd' : '') + '">' + n + '</div>', iconSize: [22, 22], iconAnchor: [11, 11] });
  }

  function drawItem(it, group, dim) {
    var op = dim ? 0.35 : 1;
    if (it.planned && it.planned.length > 1) L.polyline(it.planned, { color: C_PLAN, weight: 5, opacity: 0.85 * op, dashArray: '10 8' }).addTo(group);
    if (it.actual && it.actual.length > 1) L.polyline(it.actual, { color: C_ACT, weight: 4, opacity: 0.9 * op }).addTo(group);
    (it.off || []).forEach(function (seg) { if (seg.length > 1) L.polyline(seg, { color: C_OFF, weight: 6, opacity: 0.9 * op }).addTo(group); });
    if (!dim) (it.waypoints || []).forEach(function (w, i) {
      if (w.lat == null || w.lng == null) return;
      L.marker([w.lat, w.lng], { icon: numIcon(i + 1, w.kind) })
        .bindTooltip((w.kind === 'pickup' ? '⬆ ' : '⬇ ') + _e(w.loc || ''), { direction: 'top' }).addTo(group);
    });
    if (!dim) (it.segments || []).forEach(function (g) {
      (g.detours || []).forEach(function (x) {
        if (x.lat == null || x.lng == null) return;
        L.marker([x.lat, x.lng], { icon: L.divIcon({ className: '', html: '<div class="rdm-det">' + (DET_ICON[x.reason] || '•') + '</div>', iconSize: [24, 24], iconAnchor: [12, 12] }) })
          .bindTooltip(_e(detLabel(x.reason)) + ' · ' + _n(x.stop_min, 0) + ' min · ' + _n(x.excused_km) + ' km ' + _e(_t('rdm.det.notCounted', 'nu se socotește abatere')), { direction: 'top' })
          .addTo(group);
      });
    });
    var tip = '<b>' + _e(it.fuvar_no || it.order_id) + '</b><br>' + _n(it.planned_km) + ' → ' + _n(it.actual_km) + ' km'
      + (it.status === 'deviation' ? ' · +' + _n(it.extra_km) + ' km ' + _t('rdm.k.extraTip', 'față de traseul mai scurt') : '');
    group.eachLayer(function (l) { if (l instanceof L.Polyline && !l._rdmTip) { l._rdmTip = 1; l.bindTooltip(tip, { sticky: true }); } });
  }

  function renderMap() {
    if (typeof L === 'undefined') { document.getElementById('rdmCanvas').innerHTML = '<div style="padding:20px;">Leaflet lipsă</div>'; return; }
    if (!M.map) {
      M.map = L.map('rdmCanvas', { zoomControl: true });
      // mindig világos csempe
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(M.map);
      M.layers = L.featureGroup().addTo(M.map);
    }
    M.layers.clearLayers();
    var d = M.data, bounds = [];
    var wr = (d.mode === 'waybill' && M.focus == null) ? (d.meta || {}).route : null;
    if (wr) {
      var g = L.featureGroup().addTo(M.layers);
      (wr.legs || []).forEach(function (l) {
        if (!l.pts || l.pts.length < 2) return;
        L.polyline(l.pts, l.empty ? { color: C_EMPTY, weight: 5, opacity: 0.9, dashArray: '2 9', lineCap: 'round' }
          : { color: C_PLAN, weight: 5, opacity: 0.85, dashArray: '10 8' })
          .bindTooltip((l.empty ? _t('oc.legEmpty', 'gol') : _t('oc.legLoaded', 'încărcat')) + ' · ' + _n(l.km) + ' km', { sticky: true }).addTo(g);
        l.pts.forEach(function (p) { bounds.push(p); });
      });
      if (wr.actual && wr.actual.length > 1) L.polyline(wr.actual, { color: C_ACT, weight: 4, opacity: 0.9 }).addTo(g);
      (wr.off || []).forEach(function (seg) { if (seg.length > 1) L.polyline(seg, { color: C_OFF, weight: 6, opacity: 0.9 }).addTo(g); });
      (wr.actual || []).forEach(function (p) { bounds.push(p); });
      var n = 0;
      (wr.waypoints || []).forEach(function (w) {
        if (w.lat == null || w.lng == null) return;
        var lbl = w.type === 'plecare' ? 'P' : w.type === 'sosire' ? 'S' : String(++n);
        var kind = w.type === 'loading' ? 'pickup' : w.type === 'unloading' ? 'delivery' : '';
        L.marker([w.lat, w.lng], { icon: numIcon(lbl, kind) })
          .bindTooltip(_e(w.tip || w.type || '') + ': ' + _e(w.loc || ''), { direction: 'top' }).addTo(g);
        bounds.push([w.lat, w.lng]);
      });
      setTimeout(function () {
        M.map.invalidateSize();
        if (bounds.length) M.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
        else M.map.setView([45.9, 24.9], 6);
      }, 60);
      return;
    }
    d.items.forEach(function (it, i) {
      var dim = M.focus != null && M.focus !== i;
      var g = L.featureGroup();
      drawItem(it, g, dim);
      g.on('click', function () { RouteDevMap.focus(i); });
      g.addTo(M.layers);
      if (M.focus == null || M.focus === i) {
        (it.planned || []).concat(it.actual || []).forEach(function (p) { bounds.push(p); });
        (it.waypoints || []).forEach(function (w) { if (w.lat != null) bounds.push([w.lat, w.lng]); });
      }
    });
    setTimeout(function () {
      M.map.invalidateSize();
      if (bounds.length) M.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
      else M.map.setView([45.9, 24.9], 6);
    }, 60);
  }

  function renderTitle() {
    var d = M.data, m = d.meta || {}, title;
    if (d.mode === 'waybill') title = '🗺️ ' + _t('rdm.titleWb', 'Abatere de traseu — foaia de parcurs') + ' ' + _e(m.numar_fisa || '')
      + '<div class="rdm-sub">' + _e(m.rendszam || '') + (m.sofer ? ' · ' + _e(m.sofer) : '') + (m.from ? ' · ' + _e(_dt(m.from)) + ' – ' + _e(_dt(m.to)) : '') + '</div>';
    else if (d.mode === 'period') title = '🗺️ ' + _t('rdm.titlePeriod', 'Abatere de traseu — perioadă') + ' <span class="rdm-sub">' + _e(m.from) + ' – ' + _e(m.to) + '</span>';
    else { var it = d.items[0] || {}; title = '🗺️ ' + _t('rdm.titleOrder', 'Abatere de traseu') + ' — ' + _e(it.fuvar_no || it.order_id || '')
      + '<div class="rdm-sub">' + _e(it.loc_from || '?') + ' → ' + _e(it.loc_to || '?') + ' · ' + _e(it.rendszam || '') + '</div>'; }
    document.getElementById('rdmTitle').innerHTML = title;
    document.getElementById('rdmAll').style.display = (d.items.length > 1 || d.mode === 'waybill') ? '' : 'none';
    document.getElementById('rdmAll').title = d.mode === 'waybill' ? _t('rdm.wbWhole', 'Traseul complet al foii de parcurs') : _t('rdm.showAll', 'Toate cursele');
  }

  function render() { renderTitle(); renderSummary(); renderList(); renderMap(); }

  var RouteDevMap = {
    open: function (args) {
      M.args = args || {}; M.focus = null;
      var el = ensureModal();
      el.classList.add('open'); el.style.display = 'flex';
      document.getElementById('rdmTitle').textContent = '⏳ ' + _t('rdm.loading', 'Se încarcă…');
      document.getElementById('rdmSummary').innerHTML = ''; document.getElementById('rdmList').innerHTML = '';
      if (M.layers) M.layers.clearLayers();
      gas('routeDeviationMap', [M.args]).then(function (r) {
        if (!r || !r.ok) { document.getElementById('rdmTitle').textContent = (r && r.err) || _t('rdm.err', 'Eroare'); return; }
        M.data = r;
        if (r.items.length === 1 && r.mode !== 'waybill') M.focus = 0;
        render();
      }).catch(function () { document.getElementById('rdmTitle').textContent = _t('rdm.err', 'Eroare'); });
    },
    focus: function (i) {
      if (!M.data) return;
      if (M.data.items.length === 1 && M.data.mode !== 'waybill') M.focus = 0;
      else M.focus = (i == null || M.focus === i) ? null : i;
      renderSummary(); renderList(); renderMap();
    },
    recheckWaybill: function () {
      if (!M.args || !M.args.waybill_id) return;
      gas('routeDeviationRecheck', [{ waybill_id: M.args.waybill_id }]).then(function (r) {
        if (typeof toast === 'function') toast(r && r.ok ? _t('rdm.recalcStarted', 'Recalcularea a pornit — redeschide harta peste un minut.') : ((r && r.err) || _t('rdm.err', 'Eroare')), r && r.ok ? 'ok' : 'err');
      });
    },
    close: function () {
      var el = document.getElementById('rdmModal');
      if (el) { el.classList.remove('open'); el.style.display = 'none'; }
    }
  };
  window.RouteDevMap = RouteDevMap;
})();
