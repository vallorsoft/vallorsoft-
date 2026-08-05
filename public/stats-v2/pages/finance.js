// ============================================================
//  VallorSoft — Statisztika 2.0 — 💰 Pénzügy fül
//  3 belső tab:
//    1. Bevétel & eredmény (havi trend + ügyfél/jármű bontás)
//    2. Kintlévőség (öregítés 0-30/31-60/60+ + kintlévő fuvarok listája)
//    3. Alvállalkozói AP (aging + lista)
//
//  A pénzügyi jog kliens- és szerver-oldalon is védve — `_canSeeFinance`
//  mellett Manager is látja, egyébként `forbidden:true` fallback üzenet.
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
  var _subTab = 'revenue';   // revenue | receivables | ap
  var _lastData = null;

  function fnum(n, dec) {
    var v = parseFloat(n);
    if (!isFinite(v)) return '—';
    return v.toLocaleString('hu-HU', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 2 : dec });
  }
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
    cfg.options.scales = cfg.options.scales || {};
    ['x', 'y'].forEach(function (ax) {
      cfg.options.scales[ax] = Object.assign({
        ticks: { color: '#8a97a8', font: { size: 10 } },
        grid:  { color: 'rgba(120,120,120,0.12)' }
      }, cfg.options.scales[ax] || {});
    });
    _charts[id] = new Chart(el, cfg);
  }

  function subTabsBar() {
    var tabs = [
      ['revenue',     '📊 ' + $t('sv2.fin.tRev')],
      ['receivables', '⏳ ' + $t('sv2.fin.tRec')],
      ['ap',          '📥 ' + $t('sv2.fin.tAp')],
    ];
    return '<div class="sv2-subtabs">' + tabs.map(function (tp) {
      return '<button class="sv2-subtab' + (_subTab === tp[0] ? ' active' : '') + '" onclick="VS_STATS_V2_FIN._sub(\'' + tp[0] + '\')">' + tp[1] + '</button>';
    }).join('') + '</div>';
  }

  // ── Render fő függvények ────────────────────────────────
  function render(box, state) {
    box.innerHTML = subTabsBar() + '<div class="sv2-empty">' + $t('sv2.ov.loading') + '</div>';

    var apArgs = { from: state.range.from, to: state.range.to };
    Promise.all([
      gas('getFinanceStats', apArgs),
      gas('getCarrierApAging').catch(function () { return null; }),
    ]).then(function (rs) {
      var fin = rs[0] || {};
      var ap = rs[1] || null;
      _lastData = { fin: fin, ap: ap, state: state };
      if (!fin.ok) {
        var msg = fin.forbidden
          ? $t('sv2.fin.noAccess')
          : $esc(fin.err || $t('common.error'));
        box.innerHTML = subTabsBar() + '<div class="sv2-empty">' + msg + '</div>';
        return;
      }
      renderInto(box);
    });
  }

  function renderInto(box) {
    if (!_lastData) return;
    var html = subTabsBar();
    if (_subTab === 'revenue') html += renderRevenue(_lastData);
    else if (_subTab === 'receivables') html += renderReceivables(_lastData);
    else html += renderAp(_lastData);
    box.innerHTML = html;

    // Grafikonok újrarajzolása (a canvas mostantól benne van a DOM-ban)
    if (_subTab === 'revenue') drawRevenueCharts(_lastData);
    else if (_subTab === 'receivables') drawReceivablesChart(_lastData);
    else if (_subTab === 'ap') drawApChart(_lastData);
  }

  // ── 1. Bevétel & eredmény ──────────────────────────────
  function renderRevenue(d) {
    var m = d.fin.mutatok || {};
    var kpiHtml = ''
      + '<div class="sv2-kpi-grid">'
      +   sv2Kpi('💶 ' + $t('sv2.fin.kRev'), fnum(m.bevetel, 0) + ' <span style="font-size:12px;">EUR</span>',
              (m.km ? fnum(m.per_km, 2) + ' EUR/km' : ''), '#22c55e')
      +   sv2Kpi('🛣️ ' + $t('sv2.fin.kKm'), fnum(m.km, 0) + ' <span style="font-size:12px;">km</span>', '', '#3b82f6')
      +   sv2Kpi('⏱️ ' + $t('sv2.fin.kAvgPay'),
              m.atlag_fizetesi_nap != null ? fnum(m.atlag_fizetesi_nap, 0) + ' <span style="font-size:12px;">' + $t('sv2.fin.days') + '</span>' : '—',
              '', '#6366f1')
      + '</div>';
    return kpiHtml
      + '<div class="sv2-grid-2col">'
      +   panelWrap('📈 ' + $t('sv2.fin.pMonthly'),
              '<div class="sv2-chart-wrap"><canvas id="sv2FinMon"></canvas></div>')
      +   panelWrap('💰 ' + $t('sv2.fin.pCollectedRatio'),
              '<div class="sv2-chart-wrap"><canvas id="sv2FinRatio"></canvas></div>')
      + '</div>';
  }

  function drawRevenueCharts(d) {
    var months = (d.fin.havi || []).map(function (r) { return r.ho; });
    var revs = (d.fin.havi || []).map(function (r) { return parseFloat(r.bevetel) || 0; });
    var cols = (d.fin.havi || []).map(function (r) { return parseFloat(r.beszedett) || 0; });
    makeChart('sv2FinMon', {
      type: 'bar',
      data: { labels: months, datasets: [
        { label: $t('sv2.fin.kRev'), data: revs, backgroundColor: 'rgba(34,197,94,0.7)' },
        { label: $t('sv2.fin.kCollected'), data: cols, backgroundColor: 'rgba(99,102,241,0.8)' },
      ]},
    });
    // Beszedési arány (havi %)
    var ratios = months.map(function (_, i) {
      var r = revs[i] || 0;
      return r > 0 ? Math.round((cols[i] / r) * 100) : 0;
    });
    makeChart('sv2FinRatio', {
      type: 'line',
      data: { labels: months, datasets: [{
        label: $t('sv2.fin.collectRatioPct'),
        data: ratios, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.15)',
        fill: true, tension: 0.3
      }]},
      options: { scales: { y: { min: 0, max: 100 } } },
    });
  }

  // ── 2. Kintlévőség ─────────────────────────────────────
  function renderReceivables(d) {
    var ag = d.fin.aging || {};
    var total = ['d0_30', 'd31_60', 'd60p'].reduce(function (s, k) { return s + (parseFloat(ag[k]) || 0); }, 0);
    var list = d.fin.kintlevo_lista || [];

    var kpiHtml = ''
      + '<div class="sv2-kpi-grid">'
      +   sv2Kpi('💵 ' + $t('sv2.fin.kTotal'), fnum(total, 0) + ' <span style="font-size:12px;">EUR</span>',
              fnum(list.length, 0) + ' × ' + $t('sv2.ov.invoice'), '#3b82f6')
      +   sv2Kpi('🟢 0-30 ' + $t('sv2.fin.days'), fnum(ag.d0_30, 0), '', '#22c55e')
      +   sv2Kpi('🟡 31-60 ' + $t('sv2.fin.days'), fnum(ag.d31_60, 0), '', '#f59e0b')
      +   sv2Kpi('🔴 60+ ' + $t('sv2.fin.days'), fnum(ag.d60p, 0), '', '#ef4444')
      + '</div>';

    var rows = list.slice(0, 30).map(function (o) {
      var marad = (parseFloat(o.pret) || 0) - (parseFloat(o.paid_amount) || 0);
      var badge = o.lejart
        ? '<span class="badge err">' + $t('sv2.fin.overdue') + '</span>'
        : '<span class="badge warn">' + $t('sv2.fin.days', { n: fnum(o.napok, 0) }) + '</span>';
      return '<tr>'
        + '<td><b>' + $esc(String(o.id).slice(0, 12)) + '</b></td>'
        + '<td>' + $esc(o.client || '—') + '</td>'
        + '<td style="text-align:right;">' + fnum(o.pret, 0) + '</td>'
        + '<td style="text-align:right;">' + fnum(o.paid_amount, 0) + '</td>'
        + '<td style="text-align:right;font-weight:700;color:var(--sv2-danger);">' + fnum(marad, 0) + '</td>'
        + '<td>' + fdate(o.finalized_at) + '</td>'
        + '<td>' + fdate(o.esedekes) + ' ' + badge + '</td>'
        + '</tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:20px;">' + $t('sv2.fin.noOut') + '</td></tr>';

    // Export-gomb a nyitott számlák táblához (PR #9)
    var exportBtn = window.VS_STATS_V2_EXPORT ? VS_STATS_V2_EXPORT.button({
      data: list.map(function (o) {
        return {
          fuvar: o.id, ugyfel: o.client,
          osszeg: o.pret, fizetve: o.paid_amount,
          marad: (parseFloat(o.pret) || 0) - (parseFloat(o.paid_amount) || 0),
          lezarva: o.finalized_at ? new Date(o.finalized_at).toISOString().slice(0, 10) : '',
          esedekes: o.esedekes ? new Date(o.esedekes).toISOString().slice(0, 10) : '',
          napok: o.napok, lejart: o.lejart ? 'da' : 'nu',
        };
      }),
      columns: [
        { key: 'fuvar', label: 'Cursă' }, { key: 'ugyfel', label: 'Client' },
        { key: 'osszeg', label: 'Sumă' }, { key: 'fizetve', label: 'Plătit' },
        { key: 'marad', label: 'Rest' }, { key: 'lezarva', label: 'Finalizat' },
        { key: 'esedekes', label: 'Scadență' }, { key: 'napok', label: 'Zile' },
        { key: 'lejart', label: 'Expirat' },
      ],
      filename: 'restante-' + new Date().toISOString().slice(0, 10) + '.csv',
    }) : '';

    return kpiHtml
      + '<div class="sv2-grid-2col">'
      +   panelWrap('📊 ' + $t('sv2.fin.pAging'),
              '<div class="sv2-chart-wrap"><canvas id="sv2FinAging"></canvas></div>')
      +   panelWrap('📅 ' + $t('sv2.fin.pTopDue'), topDueList(list.slice(0, 8)))
      + '</div>'
      + '<div class="sv2-panel">'
      +   '<div class="sv2-panel-head"><div class="sv2-panel-title">📋 ' + $t('sv2.fin.pOpenList') + '</div>'
      +     '<div style="display:flex;gap:8px;align-items:center;">'
      +       '<span class="sv2-panel-sub">' + $t('sv2.fin.top30') + '</span>'
      +       exportBtn
      +     '</div>'
      +   '</div>'
      +   '<div style="overflow-x:auto;"><table class="table">'
      +     '<thead><tr><th>' + $t('st.cOrder') + '</th><th>' + $t('st.cClient') + '</th>'
      +       '<th style="text-align:right;">' + $t('sv2.fin.cAmount') + '</th>'
      +       '<th style="text-align:right;">' + $t('sv2.fin.cPaid') + '</th>'
      +       '<th style="text-align:right;">' + $t('sv2.fin.cRemaining') + '</th>'
      +       '<th>' + $t('sv2.fin.cFinalized') + '</th>'
      +       '<th>' + $t('sv2.fin.cDue') + '</th>'
      +     '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '</div>';
  }

  function topDueList(list) {
    if (!list.length) return '<div class="sv2-empty" style="padding:14px;">' + $t('sv2.fin.noOut') + '</div>';
    return '<ul class="sv2-todos">' + list.map(function (o) {
      var marad = (parseFloat(o.pret) || 0) - (parseFloat(o.paid_amount) || 0);
      var sev = o.lejart ? 'danger' : (o.napok > 15 ? 'warn' : 'info');
      return '<li class="sv2-todo sv2-todo-' + sev + '">'
        + '<span class="sv2-todo-ico">💸</span>'
        + '<span class="sv2-todo-txt">' + $esc(o.client || '—') + ' — <b>' + fnum(marad, 0) + ' EUR</b>'
        + ' (' + fdate(o.esedekes) + ')</span>'
        + '</li>';
    }).join('') + '</ul>';
  }

  function drawReceivablesChart(d) {
    var ag = d.fin.aging || {};
    makeChart('sv2FinAging', {
      type: 'doughnut',
      data: { labels: ['0-30', '31-60', '60+'],
        datasets: [{
          data: [parseFloat(ag.d0_30) || 0, parseFloat(ag.d31_60) || 0, parseFloat(ag.d60p) || 0],
          backgroundColor: ['rgba(34,197,94,0.85)', 'rgba(245,158,11,0.85)', 'rgba(239,68,68,0.85)'],
        }]
      },
      options: { scales: {}, plugins: { legend: { position: 'bottom' } } },
    });
  }

  // ── 3. Alvállalkozói AP ────────────────────────────────
  function renderAp(d) {
    if (!d.ap || !d.ap.ok) {
      return '<div class="sv2-empty">' + $t('sv2.fin.apUnavail') + '</div>';
    }
    var ag = d.ap.aging || {};
    var total = ['d0_30', 'd31_60', 'd60p'].reduce(function (s, k) { return s + (parseFloat(ag[k]) || 0); }, 0);
    var list = d.ap.lista || [];

    var kpiHtml = ''
      + '<div class="sv2-kpi-grid">'
      +   sv2Kpi('💵 ' + $t('sv2.fin.kApTotal'), fnum(total, 0) + ' <span style="font-size:12px;">RON</span>',
              fnum(list.length, 0) + ' × ' + $t('sv2.ov.invoice'), '#a855f7')
      +   sv2Kpi('🟢 0-30', fnum(ag.d0_30, 0), '', '#22c55e')
      +   sv2Kpi('🟡 31-60', fnum(ag.d31_60, 0), '', '#f59e0b')
      +   sv2Kpi('🔴 60+', fnum(ag.d60p, 0), '', '#ef4444')
      + '</div>';

    var rows = list.slice(0, 30).map(function (i) {
      var marad = (parseFloat(i.amount) || 0) - (parseFloat(i.paid_amount) || 0);
      var badge = i.keses_nap > 60
        ? '<span class="badge err">60+</span>'
        : (i.keses_nap > 30 ? '<span class="badge warn">31-60</span>' : '<span class="badge ok">0-30</span>');
      return '<tr>'
        + '<td><b>' + $esc(i.invoice_number || '—') + '</b></td>'
        + '<td>' + $esc(i.carrier_nev || '—') + '</td>'
        + '<td style="text-align:right;">' + fnum(i.amount, 0) + ' ' + $esc(i.currency || '') + '</td>'
        + '<td style="text-align:right;">' + fnum(i.paid_amount, 0) + '</td>'
        + '<td style="text-align:right;font-weight:700;color:var(--sv2-danger);">' + fnum(marad, 0) + '</td>'
        + '<td>' + fdate(i.issue_date) + '</td>'
        + '<td>' + fdate(i.effective_due) + ' ' + badge + '</td>'
        + '</tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:20px;">' + $t('sv2.fin.noOut') + '</td></tr>';

    return kpiHtml
      + '<div class="sv2-panel">'
      +   '<div class="sv2-panel-head"><div class="sv2-panel-title">📊 ' + $t('sv2.fin.pApAging') + '</div></div>'
      +   '<div class="sv2-chart-wrap"><canvas id="sv2FinApAging"></canvas></div>'
      + '</div>'
      + '<div class="sv2-panel">'
      +   '<div class="sv2-panel-head"><div class="sv2-panel-title">📋 ' + $t('sv2.fin.pApList') + '</div></div>'
      +   '<div style="overflow-x:auto;"><table class="table">'
      +     '<thead><tr><th>' + $t('sv2.fin.cInvoice') + '</th><th>' + $t('sv2.fin.cCarrier') + '</th>'
      +       '<th style="text-align:right;">' + $t('sv2.fin.cAmount') + '</th>'
      +       '<th style="text-align:right;">' + $t('sv2.fin.cPaid') + '</th>'
      +       '<th style="text-align:right;">' + $t('sv2.fin.cRemaining') + '</th>'
      +       '<th>' + $t('sv2.fin.cIssue') + '</th>'
      +       '<th>' + $t('sv2.fin.cDue') + '</th>'
      +     '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '</div>';
  }

  function drawApChart(d) {
    if (!d.ap || !d.ap.ok) return;
    var ag = d.ap.aging || {};
    makeChart('sv2FinApAging', {
      type: 'doughnut',
      data: { labels: ['0-30', '31-60', '60+'],
        datasets: [{
          data: [parseFloat(ag.d0_30) || 0, parseFloat(ag.d31_60) || 0, parseFloat(ag.d60p) || 0],
          backgroundColor: ['rgba(34,197,94,0.85)', 'rgba(245,158,11,0.85)', 'rgba(239,68,68,0.85)'],
        }]
      },
      options: { scales: {}, plugins: { legend: { position: 'bottom' } } },
    });
  }

  // ── Kis KPI-cella helper (kompakt, KPI-torony grid-be belefér) ──
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

  // ── Regisztráció + belső publikus API ─────────────────
  window.VS_STATS_V2_FIN = {
    _sub: function (name) {
      _subTab = name;
      var box = document.getElementById('sv2Body');
      if (!box) return;
      renderInto(box);
    },
  };

  VS_STATS_V2.registerTab('finance', {
    label: $t('sv2.tab.finance'),
    render: render,
  });
})();
