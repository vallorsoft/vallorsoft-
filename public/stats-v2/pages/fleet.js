// ============================================================
//  VallorSoft — Statisztika 2.0 — 🚚 Flotta fül
//  4 belső tab:
//    1. Áttekintés — jármű-kártyák (rendszám + mini-KPI + státusz-sáv)
//    2. Fogyasztás — havi tankolás bontás + jármű-fogyasztás összehasonlítás
//    3. Állásidő + szerviz — üres napok + szerviz-előrejelzés + GPS-eltérés
//    4. CO₂ — riport
//
//  Nincs új szerver-út — getVehicleStats + getFuelStats + getVehicleIdleStats
//  + getServiceForecast + getCo2Report.
// ============================================================

(function () {
  'use strict';
  if (!window.VS_STATS_V2) return;

  var $t = (typeof t === 'function') ? t : function (k) { return k; };
  var $esc = (typeof esc === 'function') ? esc : function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var _charts = {};
  var _subTab = 'overview';
  var _lastData = null;
  var _searchFilter = '';

  function fnum(n, dec) {
    var v = parseFloat(n);
    if (!isFinite(v)) return '—';
    return v.toLocaleString('hu-HU', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 2 : dec });
  }

  function makeChart(id, cfg) {
    var el = document.getElementById(id);
    if (!el || typeof Chart === 'undefined') return;
    if (_charts[id]) { try { _charts[id].destroy(); } catch (e) {} }
    cfg.options = cfg.options || {};
    cfg.options.responsive = true;
    cfg.options.maintainAspectRatio = false;
    cfg.options.plugins = cfg.options.plugins || {};
    cfg.options.plugins.legend = cfg.options.plugins.legend || { labels: { color: '#8a97a8', font: { size: 11 } } };
    if (cfg.type !== 'doughnut' && cfg.type !== 'pie') {
      cfg.options.scales = cfg.options.scales || {};
      ['x', 'y'].forEach(function (ax) {
        cfg.options.scales[ax] = Object.assign({
          ticks: { color: '#8a97a8', font: { size: 10 } },
          grid:  { color: 'rgba(120,120,120,0.12)' }
        }, cfg.options.scales[ax] || {});
      });
    }
    _charts[id] = new Chart(el, cfg);
  }

  function subTabsBar() {
    var tabs = [
      ['overview',  '🚚 ' + $t('sv2.fl.tOverview')],
      ['fuel',      '⛽ ' + $t('sv2.fl.tFuel')],
      ['idle',      '💤 ' + $t('sv2.fl.tIdle')],
      ['co2',       '🌱 ' + $t('sv2.fl.tCo2')],
    ];
    return '<div class="sv2-subtabs">' + tabs.map(function (tp) {
      return '<button class="sv2-subtab' + (_subTab === tp[0] ? ' active' : '') + '" onclick="VS_STATS_V2_FLEET._sub(\'' + tp[0] + '\')">' + tp[1] + '</button>';
    }).join('') + '</div>';
  }

  function render(box, state) {
    box.innerHTML = subTabsBar() + '<div class="sv2-empty">' + $t('sv2.ov.loading') + '</div>';
    var apArgs = { from: state.range.from, to: state.range.to };
    Promise.all([
      gas('getVehicleStats', apArgs),
      gas('getFuelStats', apArgs),
      gas('getVehicleIdleStats', apArgs).catch(function () { return null; }),
      gas('getServiceForecast').catch(function () { return null; }),
      gas('getCo2Report', apArgs).catch(function () { return null; }),
    ]).then(function (rs) {
      _lastData = { veh: rs[0] || {}, fuel: rs[1] || {}, idle: rs[2], service: rs[3], co2: rs[4], state: state };
      renderInto(box);
    });
  }

  function renderInto(box) {
    if (!_lastData) return;
    var html = subTabsBar();
    if (_subTab === 'overview') html += renderOverview(_lastData);
    else if (_subTab === 'fuel') html += renderFuel(_lastData);
    else if (_subTab === 'idle') html += renderIdle(_lastData);
    else html += renderCo2(_lastData);
    box.innerHTML = html;
    if (_subTab === 'fuel') drawFuel(_lastData);
    else if (_subTab === 'co2') drawCo2(_lastData);
  }

  // ── 1. Áttekintés — jármű-kártyák ──────────────────────
  function renderOverview(d) {
    var veh = (d.veh && d.veh.jarmuvek) || [];
    var filter = _searchFilter.toLowerCase();
    var filtered = veh.filter(function (v) {
      if (!filter) return true;
      return String(v.rendszam_eredeti || v.rendszam || '').toLowerCase().indexOf(filter) >= 0
        || String(v.marca || '').toLowerCase().indexOf(filter) >= 0;
    });

    var kpiHtml = ''
      + '<div class="sv2-kpi-grid">'
      +   sv2Kpi('🚚 ' + $t('sv2.fl.kFleet'), fnum(veh.length, 0), fnum(filtered.length, 0) + ' ' + $t('sv2.fl.shown'), '#3b82f6')
      +   sv2Kpi('💶 ' + $t('sv2.fl.kRev'),
              fnum(veh.reduce(function (s, v) { return s + (parseFloat(v.bevetel) || 0); }, 0), 0) + ' <span style="font-size:12px;">EUR</span>',
              '', '#22c55e')
      +   sv2Kpi('🛣️ ' + $t('sv2.fl.kKm'),
              fnum(veh.reduce(function (s, v) { return s + (parseFloat(v.km) || 0); }, 0), 0) + ' <span style="font-size:12px;">km</span>',
              '', '#f59e0b')
      + '</div>';

    var searchBar = ''
      + '<div class="sv2-panel" style="padding:12px 16px;">'
      +   '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
      +     '<input class="input" placeholder="' + $esc($t('sv2.fl.searchPh')) + '" '
      +       'value="' + $esc(_searchFilter) + '" '
      +       'oninput="VS_STATS_V2_FLEET._search(this.value)" style="flex:1;min-width:200px;">'
      +   '</div>'
      + '</div>';

    var cards = filtered.map(function (v) {
      var consum = parseFloat(v.consum_100) || 0;
      var nev = parseFloat(v.nevleges) || 0;
      var statusClass = '';
      if (nev > 0 && consum > 0) {
        var dev = (consum - nev) / nev;
        if (dev > 0.15) statusClass = 'sv2-veh-warn';
        if (dev > 0.30) statusClass = 'sv2-veh-danger';
      }
      var activ = v.activ !== false;
      if (!activ) statusClass = 'sv2-veh-inactive';
      return '<div class="sv2-veh-card ' + statusClass + '">'
        + '<div class="sv2-veh-head">'
        +   '<span class="sv2-veh-plate">' + $esc(v.rendszam_eredeti || v.rendszam || '?') + '</span>'
        +   (activ ? '<span class="sv2-veh-badge sv2-veh-badge-ok">' + $t('sv2.fl.active') + '</span>' : '<span class="sv2-veh-badge sv2-veh-badge-off">' + $t('sv2.fl.inactive') + '</span>')
        + '</div>'
        + '<div class="sv2-veh-model">' + $esc([v.marca, v.model, v.an].filter(Boolean).join(' • ')) + '</div>'
        + '<div class="sv2-veh-kpis">'
        +   '<div><div class="k">' + fnum(v.fuvarok, 0) + '</div><div class="l">' + $t('sv2.fl.orders') + '</div></div>'
        +   '<div><div class="k">' + fnum(v.km, 0) + '</div><div class="l">km</div></div>'
        +   '<div><div class="k">' + fnum(consum, 1) + '</div><div class="l">L/100km' + (nev > 0 ? ' <span class="hint">(' + fnum(nev, 1) + ')</span>' : '') + '</div></div>'
        +   '<div><div class="k">' + fnum(v.bevetel, 0) + '</div><div class="l">EUR</div></div>'
        + '</div>'
        + '</div>';
    }).join('');
    if (!cards) cards = '<div class="sv2-empty">' + $t('sv2.ov.noData') + '</div>';

    return kpiHtml + searchBar + '<div class="sv2-veh-grid">' + cards + '</div>';
  }

  // ── 2. Fogyasztás ──────────────────────────────────────
  function renderFuel(d) {
    var f = d.fuel;
    if (!f.ok) return '<div class="sv2-empty">' + $esc(f.err || $t('common.error')) + '</div>';
    var lit = 0, sum = 0;
    (f.havi || []).forEach(function (r) { lit += parseFloat(r.litru) || 0; sum += parseFloat(r.suma) || 0; });
    var kpiHtml = ''
      + '<div class="sv2-kpi-grid">'
      +   sv2Kpi('⛽ ' + $t('sv2.fl.fuelLiters'), fnum(lit, 0) + ' <span style="font-size:12px;">L</span>', '', '#f59e0b')
      +   sv2Kpi('💰 ' + $t('sv2.fl.fuelCost'), fnum(sum, 0) + ' <span style="font-size:12px;">RON</span>',
              lit > 0 ? fnum(sum / lit, 2) + ' RON/L' : '', '#3b82f6')
      + '</div>';
    var vehR = (f.jarmuvek || []).slice(0, 20).map(function (v) {
      var c = parseFloat(v.km) > 0 ? (parseFloat(v.motorina) / parseFloat(v.km)) * 100 : 0;
      var nev = parseFloat(v.nevleges) || 0;
      var dev = nev > 0 ? Math.round(((c - nev) / nev) * 1000) / 10 : null;
      var devStr = dev == null ? '' :
        '<span class="badge ' + (dev > 15 ? 'err' : dev > 0 ? 'warn' : 'ok') + '">' + (dev > 0 ? '+' : '') + dev + '%</span>';
      return '<tr>'
        + '<td><b>' + $esc(v.rendszam || '?') + '</b></td>'
        + '<td style="text-align:right;">' + fnum(v.menetlevelek, 0) + '</td>'
        + '<td style="text-align:right;">' + fnum(v.km, 0) + '</td>'
        + '<td style="text-align:right;">' + fnum(v.motorina, 1) + '</td>'
        + '<td style="text-align:right;font-weight:700;">' + fnum(c, 1) + '</td>'
        + '<td style="text-align:right;">' + (nev > 0 ? fnum(nev, 1) : '—') + '</td>'
        + '<td>' + devStr + '</td>'
        + '</tr>';
    }).join('');
    if (!vehR) vehR = '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:20px;">' + $t('sv2.ov.noData') + '</td></tr>';

    // Export (PR #9)
    var exportBtn = window.VS_STATS_V2_EXPORT ? VS_STATS_V2_EXPORT.button({
      data: (f.jarmuvek || []).map(function (v) {
        var c = parseFloat(v.km) > 0 ? (parseFloat(v.motorina) / parseFloat(v.km)) * 100 : 0;
        return {
          rendszam: v.rendszam, menetlevelek: v.menetlevelek, km: v.km,
          liter: v.motorina, consum_100: Math.round(c * 10) / 10,
          nevleges: v.nevleges,
        };
      }),
      columns: [
        { key: 'rendszam', label: 'Nr.' }, { key: 'menetlevelek', label: 'FML' },
        { key: 'km', label: 'Km' }, { key: 'liter', label: 'Litri' },
        { key: 'consum_100', label: 'L/100km' }, { key: 'nevleges', label: 'Nominal' },
      ],
      filename: 'consum-flota-' + new Date().toISOString().slice(0, 10) + '.csv',
    }) : '';

    return kpiHtml
      + '<div class="sv2-panel">'
      +   '<div class="sv2-panel-head"><div class="sv2-panel-title">📈 ' + $t('sv2.fl.pFuelMon') + '</div></div>'
      +   '<div class="sv2-chart-wrap"><canvas id="sv2FlFuel"></canvas></div>'
      + '</div>'
      + '<div class="sv2-panel">'
      +   '<div class="sv2-panel-head"><div class="sv2-panel-title">🚚 ' + $t('sv2.fl.pFuelVeh') + '</div>'
      +     '<div style="display:flex;gap:8px;">' + exportBtn + '</div>'
      +   '</div>'
      +   '<div style="overflow-x:auto;"><table class="table">'
      +     '<thead><tr><th>' + $t('st.cPlate') + '</th>'
      +       '<th style="text-align:right;">' + $t('sv2.fl.wb') + '</th>'
      +       '<th style="text-align:right;">Km</th>'
      +       '<th style="text-align:right;">L</th>'
      +       '<th style="text-align:right;">L/100km</th>'
      +       '<th style="text-align:right;">' + $t('sv2.fl.nominal') + '</th>'
      +       '<th>' + $t('sv2.fl.dev') + '</th></tr></thead>'
      +     '<tbody>' + vehR + '</tbody></table></div>'
      + '</div>';
  }
  function drawFuel(d) {
    var f = d.fuel; if (!f.ok) return;
    var months = {};
    var motMap = {}, adbMap = {};
    (f.havi || []).forEach(function (r) {
      months[r.ho] = true;
      if ((r.tip || '').toLowerCase().indexOf('adblue') >= 0) adbMap[r.ho] = parseFloat(r.litru) || 0;
      else motMap[r.ho] = parseFloat(r.litru) || 0;
    });
    var mArr = Object.keys(months).sort();
    makeChart('sv2FlFuel', {
      type: 'bar',
      data: { labels: mArr, datasets: [
        { label: 'Motorină (L)', data: mArr.map(function (m) { return motMap[m] || 0; }), backgroundColor: 'rgba(245,158,11,0.75)', stack: 's' },
        { label: 'AdBlue (L)', data: mArr.map(function (m) { return adbMap[m] || 0; }), backgroundColor: 'rgba(99,102,241,0.75)', stack: 's' },
      ]},
      options: { scales: { x: { stacked: true }, y: { stacked: true } } },
    });
  }

  // ── 3. Állásidő + szerviz ─────────────────────────────
  function renderIdle(d) {
    var idle = d.idle && d.idle.ok ? d.idle.jarmuvek : [];
    var svc = d.service && d.service.ok ? d.service.jarmuvek : [];
    var svcUrgent = svc.filter(function (v) { return v.surgos; });
    var svcWarn = svc.filter(function (v) { return v.figyelmezteto; });

    var kpiHtml = ''
      + '<div class="sv2-kpi-grid">'
      +   sv2Kpi('💤 ' + $t('sv2.fl.avgIdle'),
              idle.length ? fnum(idle.reduce(function (s, v) { return s + (parseFloat(v.atlag_nap) || 0); }, 0) / idle.length, 1) + ' <span style="font-size:12px;">' + $t('sv2.fl.days') + '</span>' : '—',
              fnum(idle.length, 0) + ' ' + $t('sv2.fl.vehicles'), '#6366f1')
      +   sv2Kpi('🔧 ' + $t('sv2.fl.svcUrgent'), fnum(svcUrgent.length, 0), $t('sv2.fl.svcUrgentHint'), '#ef4444')
      +   sv2Kpi('⚠️ ' + $t('sv2.fl.svcWarn'), fnum(svcWarn.length, 0), $t('sv2.fl.svcWarnHint'), '#f59e0b')
      + '</div>';

    var idleR = (idle || []).slice(0, 20).map(function (v) {
      return '<tr>'
        + '<td><b>' + $esc(v.rendszam || '?') + '</b></td>'
        + '<td style="text-align:right;">' + fnum(v.gap_db, 0) + '</td>'
        + '<td style="text-align:right;font-weight:700;">' + fnum(v.atlag_nap, 1) + '</td>'
        + '<td style="text-align:right;">' + fnum(v.ossz_ures_nap, 0) + '</td>'
        + '<td style="text-align:right;">' + fnum(v.max_ures_nap, 0) + '</td>'
        + '</tr>';
    }).join('');
    if (!idleR) idleR = '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:14px;">' + $t('sv2.ov.noData') + '</td></tr>';

    var svcR = (svc || []).slice(0, 20).map(function (v) {
      var sev = v.surgos ? 'err' : (v.figyelmezteto ? 'warn' : 'ok');
      var whenTxt = v.hetek_soonest != null ? fnum(v.hetek_soonest, 1) + ' ' + $t('sv2.fl.weeks') : '—';
      return '<tr>'
        + '<td><b>' + $esc(v.rendszam || '?') + '</b></td>'
        + '<td style="text-align:right;">' + fnum(v.aktualis_km, 0) + '</td>'
        + '<td style="text-align:right;">' + fnum(v.next_due_km, 0) + '</td>'
        + '<td style="text-align:right;">' + (v.next_due_date ? new Date(v.next_due_date).toLocaleDateString('hu-HU') : '—') + '</td>'
        + '<td><span class="badge ' + sev + '">' + whenTxt + '</span></td>'
        + '</tr>';
    }).join('');
    if (!svcR) svcR = '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:14px;">' + $t('sv2.ov.noData') + '</td></tr>';

    return kpiHtml
      + '<div class="sv2-panel">'
      +   '<div class="sv2-panel-head"><div class="sv2-panel-title">💤 ' + $t('sv2.fl.pIdleTable') + '</div></div>'
      +   '<div style="overflow-x:auto;"><table class="table">'
      +     '<thead><tr><th>' + $t('st.cPlate') + '</th>'
      +       '<th style="text-align:right;">' + $t('sv2.fl.cGaps') + '</th>'
      +       '<th style="text-align:right;">' + $t('sv2.fl.cAvgDays') + '</th>'
      +       '<th style="text-align:right;">' + $t('sv2.fl.cTotalDays') + '</th>'
      +       '<th style="text-align:right;">' + $t('sv2.fl.cMaxDays') + '</th></tr></thead>'
      +     '<tbody>' + idleR + '</tbody></table></div>'
      + '</div>'
      + '<div class="sv2-panel">'
      +   '<div class="sv2-panel-head"><div class="sv2-panel-title">🔧 ' + $t('sv2.fl.pSvcTable') + '</div></div>'
      +   '<div style="overflow-x:auto;"><table class="table">'
      +     '<thead><tr><th>' + $t('st.cPlate') + '</th>'
      +       '<th style="text-align:right;">' + $t('sv2.fl.cCurKm') + '</th>'
      +       '<th style="text-align:right;">' + $t('sv2.fl.cDueKm') + '</th>'
      +       '<th style="text-align:right;">' + $t('sv2.fl.cDueDate') + '</th>'
      +       '<th>' + $t('sv2.fl.cWhen') + '</th></tr></thead>'
      +     '<tbody>' + svcR + '</tbody></table></div>'
      + '</div>';
  }

  // ── 4. CO₂ ────────────────────────────────────────────
  function renderCo2(d) {
    var c = d.co2;
    if (!c || !c.ok) return '<div class="sv2-empty">' + $esc((c && c.err) || $t('sv2.fl.co2Unavail')) + '</div>';
    var kpiHtml = ''
      + '<div class="sv2-kpi-grid">'
      +   sv2Kpi('🌱 ' + $t('sv2.fl.co2Total'), fnum(c.co2_tonna, 2) + ' <span style="font-size:12px;">t CO₂</span>',
              fnum(c.co2_kg, 0) + ' kg', '#22c55e')
      +   sv2Kpi('⛽ ' + $t('sv2.fl.fuelLiters'), fnum(c.litru, 0) + ' <span style="font-size:12px;">L</span>',
              fnum(c.tx_count, 0) + ' tx', '#f59e0b')
      +   sv2Kpi('🛣️ ' + $t('sv2.fl.co2Per100'),
              c.co2_per_100km != null ? fnum(c.co2_per_100km, 2) + ' <span style="font-size:12px;">kg / 100km</span>' : '—',
              fnum(c.total_km, 0) + ' km', '#3b82f6')
      +   sv2Kpi('🌳 ' + $t('sv2.fl.trees'), fnum(c.fa_egyenertek, 0), $t('sv2.fl.treesHint'), '#22c55e')
      + '</div>';
    var vehR = (c.jarmuvek || []).slice(0, 10).map(function (v) {
      return '<tr><td><b>' + $esc(v.rendszam || '?') + '</b></td>'
        + '<td style="text-align:right;">' + fnum(v.litru, 1) + '</td>'
        + '<td style="text-align:right;font-weight:700;">' + fnum(v.co2_kg, 0) + '</td></tr>';
    }).join('');
    if (!vehR) vehR = '<tr><td colspan="3" class="text-muted" style="text-align:center;padding:14px;">' + $t('sv2.ov.noData') + '</td></tr>';

    return kpiHtml
      + '<div class="sv2-grid-2col">'
      +   panelWrap('📈 ' + $t('sv2.fl.pCo2Mon'),
              '<div class="sv2-chart-wrap"><canvas id="sv2FlCo2"></canvas></div>')
      +   panelWrap('🚚 ' + $t('sv2.fl.pCo2Veh'),
              '<table class="table"><thead><tr><th>' + $t('st.cPlate') + '</th>'
              + '<th style="text-align:right;">L</th>'
              + '<th style="text-align:right;">kg CO₂</th></tr></thead>'
              + '<tbody>' + vehR + '</tbody></table>')
      + '</div>';
  }
  function drawCo2(d) {
    var c = d.co2; if (!c || !c.ok) return;
    var h = c.havi || [];
    makeChart('sv2FlCo2', {
      type: 'bar',
      data: { labels: h.map(function (r) { return r.ho; }), datasets: [{
        label: 'kg CO₂', data: h.map(function (r) { return r.co2_kg; }),
        backgroundColor: 'rgba(34,197,94,0.75)',
      }]},
    });
  }

  function sv2Kpi(label, value, sub, color) {
    return '<div class="sv2-kpi" style="--kpi-ac:' + color + '">'
      + '<div class="sv2-kpi-lbl">' + $esc(label) + '</div>'
      + '<div class="sv2-kpi-val">' + value + '</div>'
      + (sub ? '<div class="sv2-kpi-row"><div class="sv2-kpi-sub">' + $esc(sub) + '</div></div>' : '')
      + '</div>';
  }
  function panelWrap(title, body) {
    return '<div class="sv2-panel">'
      + '<div class="sv2-panel-head"><div class="sv2-panel-title">' + title + '</div></div>'
      + body + '</div>';
  }

  window.VS_STATS_V2_FLEET = {
    _sub: function (name) {
      _subTab = name;
      var box = document.getElementById('sv2Body'); if (!box) return;
      renderInto(box);
    },
    _search: function (v) {
      _searchFilter = v || '';
      // Csak az Áttekintés kártyáit szűri
      if (_subTab !== 'overview') return;
      var box = document.getElementById('sv2Body'); if (!box) return;
      renderInto(box);
    },
  };

  VS_STATS_V2.registerTab('fleet', {
    label: $t('sv2.tab.fleet'),
    render: render,
  });
})();
