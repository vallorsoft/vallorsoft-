// ============================================================
//  VallorSoft — Statisztika 2.0 — 📈 Operáció fül
//  3 belső tab:
//    1. SLA & életciklus (kézbesítési/lemondási/kiszámlázási arány + tranzit)
//    2. Fuvar-státusz funnel (kiírt → felrakóhoz → felrakva → lerakóhoz → leürít)
//    3. Vásárlások (havi kiadás, top termékek/sofőrök, tábla)
//
//  Nincs új szerver-út — a MEGLÉVŐ getSlaStats + getOrderFunnel + getPurchaseStats.
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
  var _subTab = 'sla';
  var _lastData = null;

  function fnum(n, dec) {
    var v = parseFloat(n);
    if (!isFinite(v)) return '—';
    return v.toLocaleString('hu-HU', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 2 : dec });
  }
  function fpct(n) { return n == null ? '—' : fnum(n, 1) + '%'; }
  function fdate(d) { return d ? new Date(d).toLocaleDateString('hu-HU') : '—'; }

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
      ['sla',     '⏱️ ' + $t('sv2.ops.tSla')],
      ['funnel',  '🔻 ' + $t('sv2.ops.tFunnel')],
      ['pur',     '🛒 ' + $t('sv2.ops.tPur')],
    ];
    return '<div class="sv2-subtabs">' + tabs.map(function (tp) {
      return '<button class="sv2-subtab' + (_subTab === tp[0] ? ' active' : '') + '" onclick="VS_STATS_V2_OPS._sub(\'' + tp[0] + '\')">' + tp[1] + '</button>';
    }).join('') + '</div>';
  }

  function render(box, state) {
    box.innerHTML = subTabsBar() + '<div class="sv2-empty">' + $t('sv2.ov.loading') + '</div>';
    var apArgs = { from: state.range.from, to: state.range.to };
    Promise.all([
      gas('getSlaStats', apArgs),
      gas('getOrderFunnel', apArgs),
      gas('getPurchaseStats', apArgs),
    ]).then(function (rs) {
      _lastData = { sla: rs[0] || {}, funnel: rs[1] || {}, pur: rs[2] || {}, state: state };
      renderInto(box);
    });
  }

  function renderInto(box) {
    if (!_lastData) return;
    var html = subTabsBar();
    if (_subTab === 'sla') html += renderSla(_lastData);
    else if (_subTab === 'funnel') html += renderFunnel(_lastData);
    else html += renderPurchases(_lastData);
    box.innerHTML = html;
    if (_subTab === 'sla') drawSla(_lastData);
    else if (_subTab === 'pur') drawPurchases(_lastData);
  }

  // ── 1. SLA ────────────────────────────────────────────
  function renderSla(d) {
    var s = d.sla;
    if (!s.ok) return '<div class="sv2-empty">' + $esc(s.err || $t('common.error')) + '</div>';
    var kpiHtml = ''
      + '<div class="sv2-kpi-grid">'
      +   sv2Kpi('✅ ' + $t('sv2.ops.deliveredRate'), fpct(s.kezbesitett_arany), fnum(s.lezart, 0) + ' / ' + fnum(s.nem_torolt, 0), '#22c55e')
      +   sv2Kpi('❌ ' + $t('sv2.ops.cancelRate'), fpct(s.lemondasi_arany), fnum(s.torolt, 0) + ' / ' + fnum(s.osszes, 0), '#ef4444')
      +   sv2Kpi('🧾 ' + $t('sv2.ops.billRate'), fpct(s.kiszamlazasi_arany), fnum(s.lezart_szamlazott, 0) + ' / ' + fnum(s.lezart_invoiceable, 0), '#6366f1')
      +   sv2Kpi('⏱️ ' + $t('sv2.ops.avgTransit'), s.atlag_tranzit_nap != null ? fnum(s.atlag_tranzit_nap, 1) + ' <span style="font-size:12px;">' + $t('sv2.fin.days', { n: '' }).replace('{n}', '').trim() + '</span>' : '—',
              fnum(s.tranzit_minta_db, 0) + ' ' + $t('sv2.ops.samples'), '#3b82f6')
      + '</div>';
    return kpiHtml
      + '<div class="sv2-panel">'
      +   '<div class="sv2-panel-head"><div class="sv2-panel-title">📈 ' + $t('sv2.ops.pMonthly') + '</div></div>'
      +   '<div class="sv2-chart-wrap"><canvas id="sv2OpsMon"></canvas></div>'
      + '</div>';
  }
  function drawSla(d) {
    var s = d.sla; if (!s.ok) return;
    var mL = s.havi_lezart || [];
    var mT = s.havi_torolt || [];
    var months = new Set();
    mL.forEach(function (r) { months.add(r.ho); });
    mT.forEach(function (r) { months.add(r.ho); });
    var mArr = Array.from(months).sort();
    var mapL = {}, mapT = {};
    mL.forEach(function (r) { mapL[r.ho] = r.db; });
    mT.forEach(function (r) { mapT[r.ho] = r.db; });
    makeChart('sv2OpsMon', {
      type: 'bar',
      data: { labels: mArr, datasets: [
        { label: $t('st.cClosed'), data: mArr.map(function (m) { return mapL[m] || 0; }), backgroundColor: 'rgba(34,197,94,0.75)' },
        { label: $t('sv2.ops.cancelled'), data: mArr.map(function (m) { return mapT[m] || 0; }), backgroundColor: 'rgba(239,68,68,0.75)' },
      ]},
    });
  }

  // ── 2. Funnel ─────────────────────────────────────────
  function renderFunnel(d) {
    var f = d.funnel;
    if (!f.ok) return '<div class="sv2-empty">' + $esc(f.err || $t('common.error')) + '</div>';
    var steps = [
      ['kiirt',      '📝 ' + $t('sv2.ops.sKiirt'),      f.funnel.kiirt],
      ['felrakohoz', '📍 ' + $t('sv2.ops.sPickupTo'),   f.funnel.felrakohoz],
      ['felrakva',   '📦 ' + $t('sv2.ops.sLoaded'),     f.funnel.felrakva],
      ['lerakohoz',  '📍 ' + $t('sv2.ops.sDeliveryTo'), f.funnel.lerakohoz],
      ['leurit',     '✅ ' + $t('sv2.ops.sUnloaded'),   f.funnel.leurit],
    ];
    var base = steps[0][2] || 0;
    var rows = steps.map(function (s, i) {
      var pct = base > 0 ? (s[2] / base) * 100 : 0;
      var conv = (i > 0 && steps[i - 1][2] > 0) ? ((s[2] / steps[i - 1][2]) * 100) : null;
      return '<div class="sv2-fnl-row">'
        + '<div class="sv2-fnl-lbl">' + s[1] + '</div>'
        + '<div class="sv2-fnl-bar-wrap">'
        +   '<div class="sv2-fnl-bar" style="width:' + Math.max(2, pct) + '%;background:linear-gradient(90deg,#6366f1,#a855f7);"></div>'
        +   '<span class="sv2-fnl-val">' + fnum(s[2], 0) + '</span>'
        + '</div>'
        + '<div class="sv2-fnl-conv">' + (conv != null ? '→ ' + fnum(conv, 1) + '%' : '') + '</div>'
        + '</div>';
    }).join('');

    var l = f.lepesek || {};
    var timeItems = [
      ['alocat_ig',        '📝 → 📍 ' + $t('sv2.ops.sPickupTo'),    l.alocat_ig || {}],
      ['felrako_felrakas', '📍 → 📦 ' + $t('sv2.ops.sLoaded'),      l.felrako_felrakas || {}],
      ['felrakas_lerako',  '📦 → 📍 ' + $t('sv2.ops.sDeliveryTo'),  l.felrakas_lerako || {}],
      ['lerako_lerakas',   '📍 → ✅ ' + $t('sv2.ops.sUnloaded'),    l.lerako_lerakas || {}],
    ];
    var timeRows = timeItems.map(function (it) {
      var v = it[2].min;
      var db = it[2].db || 0;
      return '<tr>'
        + '<td>' + it[1] + '</td>'
        + '<td style="text-align:right;font-weight:700;">' + (v != null ? fmtDuration(v) : '—') + '</td>'
        + '<td style="text-align:right;color:var(--text-muted);">' + fnum(db, 0) + '</td>'
        + '</tr>';
    }).join('');
    var full = l.teljes_ora || {};

    return '<div class="sv2-panel">'
      +   '<div class="sv2-panel-head"><div class="sv2-panel-title">🔻 ' + $t('sv2.ops.pFunnel') + '</div>'
      +     '<span class="sv2-panel-sub">' + $t('sv2.ops.funnelHint') + '</span></div>'
      +   '<div class="sv2-fnl">' + rows + '</div>'
      + '</div>'
      + '<div class="sv2-panel">'
      +   '<div class="sv2-panel-head"><div class="sv2-panel-title">⏱️ ' + $t('sv2.ops.pStepTimes') + '</div>'
      +     '<span class="sv2-panel-sub">' + $t('sv2.ops.totalTrans') + ': <b>' + (full.ora != null ? fnum(full.ora, 1) + ' h' : '—') + '</b> (' + fnum(full.db || 0, 0) + ' ' + $t('sv2.ops.samples') + ')</span>'
      +   '</div>'
      +   '<table class="table"><thead><tr>'
      +     '<th>' + $t('sv2.ops.cStep') + '</th>'
      +     '<th style="text-align:right;">' + $t('sv2.ops.cAvg') + '</th>'
      +     '<th style="text-align:right;">' + $t('sv2.ops.cSamples') + '</th>'
      +   '</tr></thead><tbody>' + timeRows + '</tbody></table>'
      + '</div>';
  }
  function fmtDuration(minutes) {
    var m = parseFloat(minutes);
    if (!isFinite(m)) return '—';
    if (m < 60) return Math.round(m) + ' min';
    var h = m / 60;
    if (h < 24) return (Math.round(h * 10) / 10) + ' h';
    var d = h / 24;
    return (Math.round(d * 10) / 10) + ' nap';
  }

  // ── 3. Vásárlások ─────────────────────────────────────
  function renderPurchases(d) {
    var p = d.pur;
    if (!p.ok) return '<div class="sv2-empty">' + $esc(p.err || $t('common.error')) + '</div>';
    var totalSum = (p.havi || []).reduce(function (s, r) { return s + (parseFloat(r.suma) || 0); }, 0);
    var totalDb = (p.havi || []).reduce(function (s, r) { return s + (parseInt(r.db, 10) || 0); }, 0);
    var kpiHtml = ''
      + '<div class="sv2-kpi-grid">'
      +   sv2Kpi('🛒 ' + $t('sv2.ops.purSum'), fnum(totalSum, 0) + ' <span style="font-size:12px;">RON</span>', '', '#f59e0b')
      +   sv2Kpi('📋 ' + $t('sv2.ops.purCount'), fnum(totalDb, 0), '', '#3b82f6')
      + '</div>';
    var termekek = (p.termekek || []).slice(0, 10);
    var termRows = termekek.map(function (t) {
      return '<tr><td>' + $esc(t.produs || '?') + '</td>'
        + '<td style="text-align:right;">' + fnum(t.db, 0) + '</td>'
        + '<td style="text-align:right;font-weight:700;">' + fnum(t.suma, 0) + '</td></tr>';
    }).join('');
    if (!termRows) termRows = '<tr><td colspan="3" class="text-muted" style="text-align:center;padding:14px;">' + $t('sv2.ov.noData') + '</td></tr>';
    var soforok = (p.soforok || []).slice(0, 10);
    var sofRows = soforok.map(function (s) {
      return '<tr><td>' + $esc(s.sofer || '?') + '</td>'
        + '<td style="text-align:right;">' + fnum(s.db, 0) + '</td>'
        + '<td style="text-align:right;font-weight:700;">' + fnum(s.suma, 0) + '</td></tr>';
    }).join('');
    if (!sofRows) sofRows = '<tr><td colspan="3" class="text-muted" style="text-align:center;padding:14px;">' + $t('sv2.ov.noData') + '</td></tr>';
    return kpiHtml
      + '<div class="sv2-panel">'
      +   '<div class="sv2-panel-head"><div class="sv2-panel-title">📈 ' + $t('sv2.ops.pPurMonthly') + '</div></div>'
      +   '<div class="sv2-chart-wrap"><canvas id="sv2OpsPur"></canvas></div>'
      + '</div>'
      + '<div class="sv2-grid-2col">'
      +   panelWrap('🏷️ ' + $t('sv2.ops.topProducts'),
              '<table class="table"><thead><tr><th>' + $t('sv2.ops.cProduct') + '</th>'
              + '<th style="text-align:right;">' + $t('sv2.ops.cCount') + '</th>'
              + '<th style="text-align:right;">' + $t('sv2.ops.cAmount') + '</th></tr></thead>'
              + '<tbody>' + termRows + '</tbody></table>')
      +   panelWrap('👤 ' + $t('sv2.ops.topDrivers'),
              '<table class="table"><thead><tr><th>' + $t('st.cDriver') + '</th>'
              + '<th style="text-align:right;">' + $t('sv2.ops.cCount') + '</th>'
              + '<th style="text-align:right;">' + $t('sv2.ops.cAmount') + '</th></tr></thead>'
              + '<tbody>' + sofRows + '</tbody></table>')
      + '</div>';
  }
  function drawPurchases(d) {
    var p = d.pur; if (!p.ok) return;
    var m = (p.havi || []).map(function (r) { return r.ho; });
    var s = (p.havi || []).map(function (r) { return parseFloat(r.suma) || 0; });
    makeChart('sv2OpsPur', {
      type: 'bar',
      data: { labels: m, datasets: [{
        label: $t('sv2.ops.purSum'), data: s,
        backgroundColor: 'rgba(245,158,11,0.75)',
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

  window.VS_STATS_V2_OPS = {
    _sub: function (name) {
      _subTab = name;
      var box = document.getElementById('sv2Body'); if (!box) return;
      renderInto(box);
    },
  };

  VS_STATS_V2.registerTab('ops', {
    label: $t('sv2.tab.ops'),
    render: render,
  });
})();
