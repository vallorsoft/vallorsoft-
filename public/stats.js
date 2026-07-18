// ============================================================
//  VallorSoft — stats.js  (STATISZTIKA & RIPORT modul)
//  Admin + Manager konzol közös statisztika-fülei (stats-* panes).
//  Betöltés a HTML-ben: console-shared.js UTÁN (gas, esc, toast kell).
//  Grafikonok: Chart.js (CDN, már betöltve az oldalon).
//
//  Pénznemek: a fuvar-ár EUR-ban van (lásd fuvar-szerkesztő), a sofőr
//  által rögzített költségek (tankolás/kiadás) RON-ban — a kettőt NEM
//  vonjuk össze, mindenhol kiírjuk az egységet.
// ============================================================

(function () {
  'use strict';

  // ── Állapot ─────────────────────────────────────────────
  var _stCharts = {};        // canvasId -> Chart példány (újrarajzolásnál destroy)
  var _stData = {};          // pane -> utolsó szerver-válasz (CSV exporthoz)
  var _stPerms = { finance: false, loaded: false };
  var _stRange = { preset: '12m', from: null, to: null };

  // ── Segédek ─────────────────────────────────────────────
  function stNum(x, dec) {
    var n = parseFloat(x);
    if (!isFinite(n)) return '—';
    return n.toLocaleString('hu-HU', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 2 : dec });
  }
  function stDate(d) { return d ? new Date(d).toLocaleDateString('hu-HU') : '—'; }

  function stRangeDates() {
    var now = new Date();
    var from, to = new Date(now);
    function ymd(d) { return d.toISOString().slice(0, 10); }
    switch (_stRange.preset) {
      case 'month':  from = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'prev':   from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                     to = new Date(now.getFullYear(), now.getMonth(), 0); break;
      case '3m':     from = new Date(now.getFullYear(), now.getMonth() - 3, 1); break;
      case 'year':   from = new Date(now.getFullYear(), 0, 1); break;
      case 'custom': return { from: _stRange.from, to: _stRange.to };
      case '12m':
      default:       from = new Date(now.getFullYear(), now.getMonth() - 12, 1); break;
    }
    return { from: ymd(from), to: ymd(to) };
  }

  // Közös szűrősáv (időszak) — minden stats-pane tetején
  function stFilterBar(pane) {
    var presets = [
      ['12m', t('st.r12m')], ['year', t('st.rYear')], ['3m', t('st.r3m')],
      ['month', t('st.rMonth')], ['prev', t('st.rPrev')], ['custom', t('st.rCustom')]
    ];
    var r = stRangeDates();
    return '<div class="glass" style="padding:12px 16px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
      + '<span class="text-muted" style="font-size:12px;font-weight:700;">' + t('st.periodLbl') + '</span>'
      + '<select class="select" style="max-width:190px;padding:8px 10px;font-size:13px;" onchange="VS_STATS.setPreset(this.value,\'' + pane + '\')">'
      + presets.map(function (p) { return '<option value="' + p[0] + '"' + (_stRange.preset === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('')
      + '</select>'
      + '<span id="stCustomRange" style="display:' + (_stRange.preset === 'custom' ? 'inline-flex' : 'none') + ';gap:8px;align-items:center;">'
      + '<input class="input" type="date" id="stFrom" value="' + (r.from || '') + '" style="padding:7px 10px;font-size:13px;max-width:150px;">'
      + '<span class="text-muted">→</span>'
      + '<input class="input" type="date" id="stTo" value="' + (r.to || '') + '" style="padding:7px 10px;font-size:13px;max-width:150px;">'
      + '<button class="btn primary" style="padding:7px 14px;font-size:12px;" onclick="VS_STATS.applyCustom(\'' + pane + '\')">' + t('st.apply') + '</button>'
      + '</span>'
      + '<span style="margin-left:auto;"></span>'
      + '<button class="btn ghost" style="padding:7px 14px;font-size:12px;" onclick="VS_STATS.load(\'' + pane + '\')">' + t('st.refresh') + '</button>'
      + '</div>';
  }

  function stTile(ico, val, lbl, color) {
    return '<div class="glass stat-tile"><div class="stat-ico">' + ico + '</div>'
      + '<div><div class="stat-val text-primary" style="' + (color ? 'color:' + color + ' !important;' : '') + '">' + val + '</div>'
      + '<div class="stat-lbl text-muted">' + lbl + '</div></div></div>';
  }

  function stPanel(title, bodyHtml, extraHead) {
    return '<div class="glass" style="padding:18px;margin-bottom:14px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">'
      + '<div class="text-primary" style="font-size:15px;font-weight:700;">' + title + '</div>'
      + (extraHead || '')
      + '</div>' + bodyHtml + '</div>';
  }

  function stChartCanvas(id, h) {
    return '<div style="position:relative;height:' + (h || 260) + 'px;"><canvas id="' + id + '"></canvas></div>';
  }

  // Chart.js példány létrehozás — a korábbi azonos canvasen lévőt eldobjuk
  function stChart(id, cfg) {
    var el = document.getElementById(id);
    if (!el || typeof Chart === 'undefined') return;
    if (_stCharts[id]) { try { _stCharts[id].destroy(); } catch (e) {} }
    cfg.options = cfg.options || {};
    cfg.options.responsive = true;
    cfg.options.maintainAspectRatio = false;
    cfg.options.plugins = cfg.options.plugins || {};
    if (!cfg.options.plugins.legend) cfg.options.plugins.legend = { labels: { color: '#8a97a8', boxWidth: 12, font: { size: 11 } } };
    if (cfg.type !== 'doughnut' && cfg.type !== 'pie') {
      cfg.options.scales = cfg.options.scales || {};
      ['x', 'y'].forEach(function (ax) {
        cfg.options.scales[ax] = Object.assign({
          ticks: { color: '#8a97a8', font: { size: 11 } },
          grid: { color: 'rgba(138,151,168,0.12)' }
        }, cfg.options.scales[ax] || {});
      });
    }
    _stCharts[id] = new Chart(el.getContext('2d'), cfg);
  }

  // Hónap-tengely összefésülés több sorozatból: [{ho:'YYYY-MM',...}] tömbökből
  function stMonths(arrays) {
    var set = {};
    arrays.forEach(function (a) { (a || []).forEach(function (r) { set[r.ho] = true; }); });
    return Object.keys(set).sort();
  }
  function stSeries(months, rows, key) {
    var m = {}; (rows || []).forEach(function (r) { m[r.ho] = parseFloat(r[key]) || 0; });
    return months.map(function (ho) { return m[ho] || 0; });
  }

  // CSV export (UTF-8 BOM — Excel-kompatibilis)
  function stCsv(filename, headers, rows) {
    var lines = [headers.join(';')].concat(rows.map(function (r) {
      return r.map(function (c) {
        var s = String(c == null ? '' : c).replace(/"/g, '""');
        return /[;"\n]/.test(s) ? '"' + s + '"' : s;
      }).join(';');
    }));
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  function payBadge(status) {
    if (status === 'paid') return '<span class="badge ok">' + t('pay.paid') + '</span>';
    if (status === 'partial') return '<span class="badge warn">' + t('pay.partial') + '</span>';
    if (status === 'unpaid') return '<span class="badge err">' + t('pay.unpaid') + '</span>';
    return '';
  }

  // ── Jogosultság: a Pénzügy fül láthatósága (admin adja) ──
  function applyPerms(cb) {
    if (_stPerms.loaded) { if (cb) cb(); return; }
    if (!window.gas) { if (cb) cb(); return; }
    gas('getMyStatsPermissions').then(function (r) {
      _stPerms.loaded = true;
      _stPerms.finance = !!(r && r.ok && r.finance);
      if (!_stPerms.finance) {
        document.querySelectorAll('.sidebar [data-tab="stats-finance"]').forEach(function (el) { el.style.display = 'none'; });
      }
      if (cb) cb();
    }).catch(function () { if (cb) cb(); });
  }

  // ════════════════════════════════════════════════════════
  //  1) ÁTTEKINTÉS (stats-overview)
  // ════════════════════════════════════════════════════════
  function loadOverview() {
    var box = document.getElementById('statsOverviewBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-overview') + '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.loading') + '</div>';
    gas('getStatsOverview', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-overview') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || t('common.error')) + '</div>'; return; }
      _stData['stats-overview'] = r;
      var k = r.kpi, fin = r.finance;
      var rate = parseFloat(r.eur_ron_rate) || null;

      // Eredmény (profit) — csak beállított árfolyammal: EUR bevétel − RON költség/árfolyam
      var ktgTotalRon = (r.havi_koltseg || []).reduce(function (s, h) {
        return s + (parseFloat(h.uzemanyag) || 0) + (parseFloat(h.vasarlas) || 0);
      }, 0);
      var eredmeny = rate ? (parseFloat(k.bevetel) || 0) - ktgTotalRon / rate : null;

      // Riasztások (túlfogyasztás / lejárt kintlévőség)
      var alertsHtml = '';
      (r.alerts || []).forEach(function (a) {
        if (a.type === 'fuel') {
          alertsHtml += '<div style="display:flex;gap:8px;align-items:center;padding:8px 12px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.35);border-radius:10px;font-size:13px;">'
            + t('st.ov.fuelAlert', { plate: esc(a.rendszam), c: stNum(a.consum, 1), n: stNum(a.nevleges, 1) }) + '</div>';
        } else if (a.type === 'overdue') {
          alertsHtml += '<div style="display:flex;gap:8px;align-items:center;padding:8px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.35);border-radius:10px;font-size:13px;cursor:pointer;" onclick="activateTab(\'stats-finance\')">'
            + t('st.ov.overdueAlert', { db: stNum(a.db, 0), sum: stNum(a.osszeg, 0) }) + '</div>';
        }
      });
      if (alertsHtml) alertsHtml = '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">' + alertsHtml + '</div>';

      // Árfolyam-beállító (csak Admin) — az eredmény-számításhoz
      var rateRow = '';
      if (typeof VS_ROLE !== 'undefined' && VS_ROLE === 'admin') {
        rateRow = '<div class="glass" style="padding:10px 16px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
          + '<span class="text-muted" style="font-size:12px;font-weight:700;">' + t('st.ov.rateLbl') + '</span>'
          + '<input class="input" id="stEurRon" type="number" step="0.0001" min="0" value="' + (rate || '') + '" placeholder="pl. 4.97" style="max-width:120px;padding:7px 10px;font-size:13px;">'
          + '<button class="btn ghost" style="padding:7px 12px;font-size:12px;" title="' + t('st.ov.bnrTitle') + '" onclick="VS_STATS.fetchBnr()">🏦 BNR</button>'
          + '<button class="btn primary" style="padding:7px 14px;font-size:12px;" onclick="VS_STATS.saveRate()">' + t('common.save') + '</button>'
          + '<span class="text-muted" style="font-size:11px;">' + t('st.ov.rateHint') + '</span>'
          + '</div>';
      }

      // Top útvonalak tábla
      var utvRows = (r.top_utvonalak || []).map(function (u) {
        return '<tr><td>' + esc(u.loc_incarcare) + ' <span class="text-muted">→</span> ' + esc(u.loc_descarcare) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(u.db, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(u.atlag_km, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(u.atlag_ar, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(u.bevetel, 0) + '</td></tr>';
      }).join('') || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:14px;">' + t('st.ov.noClosedRoute') + '</td></tr>';

      var ovMetrics = [
        { l: '💶 ' + t('st.ov.revClosed'), v: stNum(k.bevetel, 0) + ' <span style="font-size:13px;">EUR</span>' },
        { l: '📦 ' + t('st.ov.closedOrder', { a: stNum(k.osszes, 0), b: stNum(k.torolt, 0) }), v: stNum(k.lezart, 0) },
        { l: '🛣️ ' + t('st.ov.kmDone'), v: stNum(k.fuvarlevel_km, 0) + ' km' },
        { l: '⛽ ' + t('st.ov.fleetAvg'), v: stNum(k.consum_100, 1) + ' L/100km' },
        { l: '🗓️ ' + t('st.ov.diurnaDays'), v: stNum(k.diurna_ext, 0) + ' / ' + stNum(k.diurna_int, 0) }
      ];
      if (fin) {
        ovMetrics.push({ l: '💰 ' + t('st.ov.collected'), v: stNum(fin.beszedett, 0) + ' <span style="font-size:13px;">EUR</span>' });
        ovMetrics.push({ l: '⏳ ' + t('st.ov.outstanding', { n: stNum(fin.kintlevo_db, 0) }), v: stNum(fin.kintlevo, 0) + ' <span style="font-size:13px;">EUR</span>' });
      }
      if (eredmeny != null) {
        ovMetrics.push({ l: '🎯 ' + t('st.ov.result', { r: stNum(rate, 2) }), v: stNum(eredmeny, 0) + ' <span style="font-size:13px;">EUR</span>' });
      }
      box.innerHTML = stFilterBar('stats-overview')
        + alertsHtml
        + rateRow
        + '<div style="margin-bottom:16px;">' + vsMetricBand(ovMetrics, { tall: true }) + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;">'
        + stPanel(t('st.ov.pRevenue'), stChartCanvas('stChOvBevetel'))
        + stPanel(t('st.ov.pCost'), stChartCanvas('stChOvKoltseg'))
        + (rate ? stPanel(t('st.ov.pResult', { r: stNum(rate, 2) }), stChartCanvas('stChOvEredmeny')) : '')
        + stPanel(t('st.ov.pRoutes'),
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + t('st.ov.cRoute') + '</th><th style="text-align:right;">' + t('st.cOrder') + '</th><th style="text-align:right;">' + t('st.ov.cAvgKm') + '</th><th style="text-align:right;">' + t('st.ov.cAvgPrice') + '</th><th style="text-align:right;">' + t('st.cRevenue') + '</th></tr></thead>'
            + '<tbody>' + utvRows + '</tbody></table></div>')
        + '</div>';

      var months = stMonths([r.havi_bevetel, r.havi_koltseg]);
      stChart('stChOvBevetel', {
        type: 'line',
        data: { labels: months, datasets: [{
          label: t('st.cRevenue'), data: stSeries(months, r.havi_bevetel, 'osszeg'),
          borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.15)', fill: true, tension: 0.3
        }]}
      });
      stChart('stChOvKoltseg', {
        type: 'bar',
        data: { labels: months, datasets: [
          { label: t('st.ds.fuel'), data: stSeries(months, r.havi_koltseg, 'uzemanyag'), backgroundColor: 'rgba(245,158,11,0.7)', stack: 'k' },
          { label: t('st.ds.purchases'), data: stSeries(months, r.havi_koltseg, 'vasarlas'), backgroundColor: 'rgba(59,130,246,0.7)', stack: 'k' }
        ]},
        options: { scales: { x: { stacked: true }, y: { stacked: true } } }
      });
      if (rate) {
        var bev = stSeries(months, r.havi_bevetel, 'osszeg');
        var uz = stSeries(months, r.havi_koltseg, 'uzemanyag');
        var va = stSeries(months, r.havi_koltseg, 'vasarlas');
        var profit = months.map(function (_, i) { return Math.round(bev[i] - (uz[i] + va[i]) / rate); });
        stChart('stChOvEredmeny', {
          type: 'bar',
          data: { labels: months, datasets: [{
            label: t('st.cResult'), data: profit,
            backgroundColor: profit.map(function (v) { return v >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)'; })
          }]}
        });
      }
    });
  }

  // ════════════════════════════════════════════════════════
  //  2) PÉNZÜGY (stats-finance) — jogosultsághoz kötött
  // ════════════════════════════════════════════════════════
  function loadFinance() {
    var box = document.getElementById('statsFinanceBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-finance') + '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.loading') + '</div>';
    gas('getFinanceStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) {
        box.innerHTML = stFilterBar('stats-finance')
          + '<div class="glass" style="padding:40px;text-align:center;">'
          + '<div style="font-size:36px;margin-bottom:10px;">🔒</div>'
          + '<div class="text-primary" style="font-weight:700;margin-bottom:6px;">' + t('st.fin.noAccess') + '</div>'
          + '<div class="text-muted" style="font-size:13px;">' + esc((r && r.err) || t('common.error')) + '</div></div>';
        return;
      }
      _stData['stats-finance'] = r;
      var m = r.mutatok, ag = r.aging;
      var kintlevoTotal = (parseFloat(ag.d0_30) || 0) + (parseFloat(ag.d31_60) || 0) + (parseFloat(ag.d60p) || 0);
      var beszedett = (r.havi || []).reduce(function (s, x) { return s + (parseFloat(x.beszedett) || 0); }, 0);

      var listRows = (r.kintlevo_lista || []).map(function (o) {
        var marad = (parseFloat(o.pret) || 0) - (parseFloat(o.paid_amount) || 0);
        return '<tr>'
          + '<td><b class="text-primary">' + esc(String(o.id)) + '</b></td>'
          + '<td>' + esc(o.client || '—') + '</td>'
          + '<td style="text-align:right;">' + stNum(o.pret, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(o.paid_amount, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;color:var(--status-danger);">' + stNum(marad, 0) + '</td>'
          + '<td>' + stDate(o.finalized_at) + '</td>'
          + '<td style="text-align:center;">' + stDate(o.esedekes)
          + (o.lejart ? ' <span class="badge err">' + t('st.fin.overdue') + '</span>' : ' <span class="badge warn">' + t('st.fin.days', { n: stNum(o.napok, 0) }) + '</span>') + '</td>'
          + '<td>' + payBadge(o.payment_status) + '</td>'
          + '<td><button class="btn ok" style="padding:4px 10px;font-size:12px;" '
          + 'onclick="openPaymentModal(\'' + esc(String(o.id)) + '\',' + (parseFloat(o.pret) || 0) + ',' + (parseFloat(o.paid_amount) || 0) + ')">' + t('st.fin.payBtn') + '</button></td>'
          + '</tr>';
      }).join('') || '<tr><td colspan="9" class="text-muted" style="text-align:center;padding:18px;">' + t('st.fin.noOut') + '</td></tr>';

      box.innerHTML = stFilterBar('stats-finance')
        + '<div style="margin-bottom:16px;">' + vsMetricBand([
          { l: '💶 ' + t('st.fin.revClosed'), v: stNum(m.bevetel, 0) + ' <span style="font-size:13px;">EUR</span>' },
          { l: '💰 ' + t('st.fin.collected'), v: stNum(beszedett, 0) + ' <span style="font-size:13px;">EUR</span>' },
          { l: '⏳ ' + t('st.fin.totalOut'), v: stNum(kintlevoTotal, 0) + ' <span style="font-size:13px;">EUR</span>' },
          { l: '📏 ' + t('st.fin.perKm'), v: stNum(m.per_km, 2) + ' EUR/km' },
          { l: '⌛ ' + t('st.fin.avgPayDays'), v: m.atlag_fizetesi_nap != null ? t('st.fin.days', { n: stNum(m.atlag_fizetesi_nap, 0) }) : '—' }
        ], { tall: true }) + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;">'
        + stPanel(t('st.fin.pRevVsCol'), stChartCanvas('stChFinHavi'))
        + stPanel(t('st.fin.pAging'),
            '<div class="dash-veh-grid">'
            + '<div class="dash-mini glass-soft"><div style="font-size:20px;">🟢</div><div style="font-size:22px;font-weight:800;color:var(--status-warn);">' + stNum(ag.d0_30, 0) + '</div><div class="text-muted" style="font-size:11px;">' + t('st.fin.a0_30') + '</div></div>'
            + '<div class="dash-mini glass-soft"><div style="font-size:20px;">🟠</div><div style="font-size:22px;font-weight:800;color:var(--status-warn);">' + stNum(ag.d31_60, 0) + '</div><div class="text-muted" style="font-size:11px;">' + t('st.fin.a31_60') + '</div></div>'
            + '<div class="dash-mini glass-soft"><div style="font-size:20px;">🔴</div><div style="font-size:22px;font-weight:800;color:var(--status-danger);">' + stNum(ag.d60p, 0) + '</div><div class="text-muted" style="font-size:11px;">' + t('st.fin.a60p') + '</div></div>'
            + '</div>')
        + '</div>'
        + stPanel(t('st.fin.pOutOrders'), '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + t('st.cOrder') + '</th><th>' + t('st.cClient') + '</th><th style="text-align:right;">' + t('st.fin.cPrice') + '</th><th style="text-align:right;">' + t('st.cPaid') + '</th><th style="text-align:right;">' + t('st.fin.cRemain') + '</th><th>' + t('st.fin.cDone') + '</th><th style="text-align:center;">' + t('st.fin.cDue') + '</th><th>' + t('st.cStatus') + '</th><th></th></tr></thead>'
            + '<tbody>' + listRows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-finance\')">' + t('st.csvExport') + '</button>')
        + '<div id="stProfitBox"></div>';

      loadOrderProfit();

      var months = stMonths([r.havi]);
      stChart('stChFinHavi', {
        type: 'bar',
        data: { labels: months, datasets: [
          { label: t('st.fin.dsRevenue'), data: stSeries(months, r.havi, 'bevetel'), backgroundColor: 'rgba(99,102,241,0.65)' },
          { label: t('st.fin.dsCollected'), data: stSeries(months, r.havi, 'beszedett'), backgroundColor: 'rgba(34,197,94,0.65)' }
        ]}
      });
    });
  }

  // Fuvar-szintű eredmény (a menetlevél-költségek fuvarokra osztva)
  function loadOrderProfit() {
    var box = document.getElementById('stProfitBox');
    if (!box) return;
    gas('getOrderProfit', stRangeDates()).then(function (r) {
      if (!r || !r.ok || !(r.rows || []).length) { box.innerHTML = ''; return; }
      var rate = parseFloat(r.eur_ron_rate) || null;
      var rows = r.rows.map(function (o) {
        var ktg = parseFloat(o.koltseg_ron) || 0;
        var toll = parseFloat(o.toll_cost) || 0;
        var carrier = parseFloat(o.carrier_cost) || 0;
        var profitCell = '';
        if (rate) {
          var p = (parseFloat(o.pret) || 0) - ktg / rate - toll - carrier;
          profitCell = '<td style="text-align:right;font-weight:700;color:' + (p >= 0 ? 'var(--status-ok)' : 'var(--status-danger)') + ';">' + stNum(p, 0) + '</td>';
        }
        return '<tr><td><b class="text-primary">' + esc(String(o.id)) + '</b></td>'
          + '<td>' + esc(o.client || '—') + '</td>'
          + '<td>' + stDate(o.finalized_at) + '</td>'
          + '<td style="text-align:right;">' + stNum(o.km, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(o.pret, 0) + '</td>'
          + '<td style="text-align:right;color:' + (toll > 0 ? '#fbbf24' : 'inherit') + ';">' + (toll > 0 ? stNum(toll, 0) : '—') + '</td>'
          + '<td style="text-align:right;color:' + (carrier > 0 ? '#ff6b75' : 'inherit') + ';">' + (carrier > 0 ? stNum(carrier, 0) : '—') + '</td>'
          + '<td style="text-align:right;">' + stNum(ktg, 0) + '</td>'
          + profitCell + '</tr>';
      }).join('');
      box.innerHTML = stPanel(t('st.fin.pProfit'),
        '<p class="text-muted" style="font-size:12px;margin:0 0 10px;">' + t('st.fin.profitHint')
        + (rate ? '' : t('st.fin.profitHint2')) + '</p>'
        + '<div style="overflow-x:auto;"><table class="table">'
        + '<thead><tr><th>' + t('st.cOrder') + '</th><th>' + t('st.cClient') + '</th><th>' + t('st.fin.cDone') + '</th><th style="text-align:right;">' + t('st.cKm') + '</th><th style="text-align:right;">' + t('st.cRevenue') + '</th><th style="text-align:right;">' + t('st.fin.cToll') + '</th><th style="text-align:right;">' + t('st.fin.cCarrier') + '</th><th style="text-align:right;">' + t('st.fin.cCostRon') + '</th>'
        + (rate ? '<th style="text-align:right;">' + t('st.cResult') + '</th>' : '') + '</tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>');
    }).catch(function () { box.innerHTML = ''; });
  }

  // ════════════════════════════════════════════════════════
  //  3) FOGYASZTÁS (stats-fuel)
  // ════════════════════════════════════════════════════════
  function loadFuel() {
    var box = document.getElementById('statsFuelBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-fuel') + '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.loading') + '</div>';
    gas('getFuelStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-fuel') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || t('common.error')) + '</div>'; return; }
      _stData['stats-fuel'] = r;

      var totL = 0, totS = 0;
      (r.havi || []).forEach(function (h) { if (h.tip !== 'AdBlue') { totL += parseFloat(h.litru) || 0; totS += parseFloat(h.suma) || 0; } });
      var avgPrice = totL > 0 ? totS / totL : 0;
      var totKm = 0, totMot = 0;
      (r.jarmuvek || []).forEach(function (j) { totKm += parseFloat(j.km) || 0; totMot += parseFloat(j.motorina) || 0; });
      var fleetAvg = totKm > 0 ? (totMot / totKm) * 100 : 0;

      var vehRows = (r.jarmuvek || []).map(function (j) {
        var consum = (parseFloat(j.km) > 0) ? (parseFloat(j.motorina) / parseFloat(j.km)) * 100 : 0;
        var nevleges = parseFloat(j.nevleges) || 0;
        var diffBadge = '—';
        if (nevleges > 0 && consum > 0) {
          var diff = ((consum - nevleges) / nevleges) * 100;
          var cls = diff > 10 ? 'err' : diff > 0 ? 'warn' : 'ok';
          diffBadge = '<span class="badge ' + cls + '">' + (diff >= 0 ? '+' : '') + stNum(diff, 1) + '%</span>';
        }
        return '<tr><td><b class="text-primary">' + esc(j.rendszam || '—') + '</b></td>'
          + '<td style="text-align:right;">' + stNum(j.km, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(j.motorina, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + (consum > 0 ? stNum(consum, 1) : '—') + '</td>'
          + '<td style="text-align:right;">' + (nevleges > 0 ? stNum(nevleges, 1) : '—') + '</td>'
          + '<td style="text-align:center;">' + diffBadge + '</td>'
          + '<td style="text-align:right;">' + stNum(j.menetlevelek, 0) + '</td></tr>';
      }).join('') || '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:18px;">' + t('st.noData') + '</td></tr>';

      var fillRows = (r.lista || []).map(function (a) {
        return '<tr><td>' + stDate(a.data_completare) + '</td>'
          + '<td>' + esc(a.nume_sofer || '—') + '</td>'
          + '<td>' + esc(a.numar_camion || '—') + '</td>'
          + '<td>' + esc(a.loc || '—') + '</td>'
          + '<td>' + esc(a.tip || '—') + '</td>'
          + '<td style="text-align:right;">' + stNum(a.litru, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(a.suma, 0) + '</td>'
          + '<td>' + esc(a.plata || '—') + '</td></tr>';
      }).join('') || '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:18px;">' + t('st.fu.noFills') + '</td></tr>';

      box.innerHTML = stFilterBar('stats-fuel')
        + '<div style="margin-bottom:16px;">' + vsMetricBand([
          { l: '⛽ ' + t('st.fu.fuelL'), v: stNum(totL, 0) + ' L' },
          { l: '💸 ' + t('st.fu.fuelCost'), v: stNum(totS, 0) + ' RON' },
          { l: '🏷️ ' + t('st.fu.avgPrice'), v: stNum(avgPrice, 2) + ' RON/L' },
          { l: '📉 ' + t('st.ov.fleetAvg'), v: stNum(fleetAvg, 1) + ' L/100km' }
        ], { tall: true }) + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;">'
        + stPanel(t('st.fu.pMonthly'), stChartCanvas('stChFuelHavi'))
        + stPanel(t('st.fu.pPay'), stChartCanvas('stChFuelPlata'))
        + '</div>'
        + stPanel(t('st.fu.pPerVeh'),
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + t('st.cPlate') + '</th><th style="text-align:right;">' + t('st.cKm') + '</th><th style="text-align:right;">' + t('st.fu.cMotorinaL') + '</th><th style="text-align:right;">' + t('st.fu.cReal100') + '</th><th style="text-align:right;">' + t('st.cNominal') + '</th><th style="text-align:center;">' + t('st.cDiff') + '</th><th style="text-align:right;">' + t('st.cWaybill') + '</th></tr></thead>'
            + '<tbody>' + vehRows + '</tbody></table></div>')
        + stPanel(t('st.fu.pFills'),
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + t('st.cDate') + '</th><th>' + t('st.cDriver') + '</th><th>' + t('st.cVehicle') + '</th><th>' + t('st.cPlace') + '</th><th>' + t('st.cType') + '</th><th style="text-align:right;">' + t('st.cLiter') + '</th><th style="text-align:right;">' + t('st.cSumRon') + '</th><th>' + t('st.cPay') + '</th></tr></thead>'
            + '<tbody>' + fillRows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-fuel\')">' + t('st.csvExport') + '</button>');

      var months = stMonths([r.havi]);
      var motorina = r.havi.filter(function (h) { return h.tip !== 'AdBlue'; });
      var adblue = r.havi.filter(function (h) { return h.tip === 'AdBlue'; });
      stChart('stChFuelHavi', {
        type: 'bar',
        data: { labels: months, datasets: [
          { label: t('st.fu.dsMotorina'), data: stSeries(months, motorina, 'suma'), backgroundColor: 'rgba(245,158,11,0.7)', stack: 'f' },
          { label: t('st.fu.dsAdblue'), data: stSeries(months, adblue, 'suma'), backgroundColor: 'rgba(59,130,246,0.7)', stack: 'f' }
        ]},
        options: { scales: { x: { stacked: true }, y: { stacked: true } } }
      });
      stChart('stChFuelPlata', {
        type: 'doughnut',
        data: {
          labels: (r.fizetesi_mod || []).map(function (p) { return p.plata; }),
          datasets: [{ data: (r.fizetesi_mod || []).map(function (p) { return parseFloat(p.suma) || 0; }),
            backgroundColor: ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8a97a8'] }]
        }
      });
    });
  }

  // ════════════════════════════════════════════════════════
  //  4) VÁSÁRLÁSOK (stats-purchases)
  // ════════════════════════════════════════════════════════
  function loadPurchases() {
    var box = document.getElementById('statsPurchasesBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-purchases') + '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.loading') + '</div>';
    gas('getPurchaseStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-purchases') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || t('common.error')) + '</div>'; return; }
      _stData['stats-purchases'] = r;

      var totS = 0, totDb = 0;
      (r.havi || []).forEach(function (h) { totS += parseFloat(h.suma) || 0; totDb += parseInt(h.db, 10) || 0; });
      var cashRow = (r.fizetesi_mod || []).find(function (p) { return /cash/i.test(p.plata || ''); });

      var listRows = (r.lista || []).map(function (c) {
        return '<tr><td>' + stDate(c.data_completare) + '</td>'
          + '<td>' + esc(c.nume_sofer || '—') + '</td>'
          + '<td>' + esc(c.numar_camion || '—') + '</td>'
          + '<td>' + esc(c.produs || '—') + '</td>'
          + '<td>' + esc(c.loc || '—') + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(c.pret, 0) + '</td>'
          + '<td>' + esc(c.plata || '—') + '</td></tr>';
      }).join('') || '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:18px;">' + t('st.pu.noBuy') + '</td></tr>';

      var soferRows = (r.soforok || []).map(function (s) {
        return '<tr><td>' + esc(s.sofer || '—') + '</td>'
          + '<td style="text-align:right;">' + stNum(s.db, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(s.suma, 0) + '</td></tr>';
      }).join('') || '<tr><td colspan="3" class="text-muted" style="text-align:center;padding:14px;">' + t('st.noDataShort') + '</td></tr>';

      box.innerHTML = stFilterBar('stats-purchases')
        + '<div style="margin-bottom:16px;">' + vsMetricBand([
          { l: '🛒 ' + t('st.pu.totalSpend'), v: stNum(totS, 0) + ' RON' },
          { l: '🧾 ' + t('st.pu.items'), v: stNum(totDb, 0) },
          { l: '💵 ' + t('st.pu.cash'), v: cashRow ? stNum(cashRow.suma, 0) + ' RON' : '0 RON' }
        ], { tall: true }) + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;">'
        + stPanel(t('st.pu.pMonthly'), stChartCanvas('stChPurHavi'))
        + stPanel(t('st.pu.pTopProd'), stChartCanvas('stChPurTermek'))
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;">'
        + stPanel(t('st.pu.pPerDriver'),
            '<div style="overflow-x:auto;"><table class="table"><thead><tr><th>' + t('st.cDriver') + '</th><th style="text-align:right;">' + t('st.pu.cItem') + '</th><th style="text-align:right;">' + t('st.cSumRon') + '</th></tr></thead><tbody>' + soferRows + '</tbody></table></div>')
        + stPanel(t('st.pu.pPay'), stChartCanvas('stChPurPlata'))
        + '</div>'
        + stPanel(t('st.pu.pList'),
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + t('st.cDate') + '</th><th>' + t('st.cDriver') + '</th><th>' + t('st.cVehicle') + '</th><th>' + t('st.cProduct') + '</th><th>' + t('st.cPlace') + '</th><th style="text-align:right;">' + t('st.pu.cPriceRon') + '</th><th>' + t('st.cPay') + '</th></tr></thead>'
            + '<tbody>' + listRows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-purchases\')">' + t('st.csvExport') + '</button>');

      var months = stMonths([r.havi]);
      stChart('stChPurHavi', {
        type: 'bar',
        data: { labels: months, datasets: [{ label: t('st.pu.dsSpend'), data: stSeries(months, r.havi, 'suma'), backgroundColor: 'rgba(59,130,246,0.7)' }] }
      });
      stChart('stChPurTermek', {
        type: 'bar',
        data: {
          labels: (r.termekek || []).map(function (p) { return p.produs; }),
          datasets: [{ label: t('st.cSumRon'), data: (r.termekek || []).map(function (p) { return parseFloat(p.suma) || 0; }), backgroundColor: 'rgba(99,102,241,0.7)' }]
        },
        options: { indexAxis: 'y' }
      });
      stChart('stChPurPlata', {
        type: 'doughnut',
        data: {
          labels: (r.fizetesi_mod || []).map(function (p) { return p.plata; }),
          datasets: [{ data: (r.fizetesi_mod || []).map(function (p) { return parseFloat(p.suma) || 0; }),
            backgroundColor: ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8a97a8'] }]
        }
      });
    });
  }

  // ════════════════════════════════════════════════════════
  //  5) SOFŐR TELJESÍTMÉNY (stats-drivers)
  // ════════════════════════════════════════════════════════
  function loadDrivers() {
    var box = document.getElementById('statsDriversBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-drivers') + '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.loading') + '</div>';
    gas('getDriverStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-drivers') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || t('common.error')) + '</div>'; return; }
      _stData['stats-drivers'] = r;
      var list = r.soforok || [];
      var rate = parseFloat(r.eur_ron_rate) || null;

      var rows = list.map(function (s, i) {
        var medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '';
        var profitCell = '';
        if (rate) {
          var p = (parseFloat(s.bevetel) || 0) - ((parseFloat(s.uzemanyag_ktg) || 0) + (parseFloat(s.vasarlas_ktg) || 0)) / rate;
          profitCell = '<td style="text-align:right;font-weight:700;color:' + (p >= 0 ? 'var(--status-ok)' : 'var(--status-danger)') + ';">' + stNum(p, 0) + '</td>';
        }
        return '<tr>'
          + '<td><b class="text-primary">' + medal + esc(s.nume || s.email || '—') + '</b></td>'
          + '<td style="text-align:right;">' + stNum(s.fuvarok, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(s.lezart, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(s.bevetel, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(s.total_km, 0) + '</td>'
          + '<td style="text-align:right;">' + (parseFloat(s.consum_100) > 0 ? stNum(s.consum_100, 1) : '—') + '</td>'
          + '<td style="text-align:right;">' + stNum(s.uzemanyag_ktg, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(s.vasarlas_ktg, 0) + '</td>'
          + profitCell
          + '<td style="text-align:center;">' + stNum(s.diurna_ext, 0) + ' / ' + stNum(s.diurna_int, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(s.menetlevelek, 0) + '</td>'
          + '</tr>';
      }).join('') || '<tr><td colspan="11" class="text-muted" style="text-align:center;padding:18px;">' + t('st.noData') + '</td></tr>';

      box.innerHTML = stFilterBar('stats-drivers')
        + stPanel(t('st.dr.pTop'), stChartCanvas('stChDrvTop'))
        + stPanel(t('st.dr.pTable'),
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + t('st.cDriver') + '</th><th style="text-align:right;">' + t('st.cOrder') + '</th><th style="text-align:right;">' + t('st.cClosed') + '</th><th style="text-align:right;">' + t('st.cRevenue') + '</th><th style="text-align:right;">' + t('st.cKmWb') + '</th><th style="text-align:right;">L/100km</th><th style="text-align:right;">' + t('st.cFuelRon') + '</th><th style="text-align:right;">' + t('st.cBuyRon') + '</th>'
            + (rate ? '<th style="text-align:right;">' + t('st.cResult') + '</th>' : '')
            + '<th style="text-align:center;">' + t('st.dr.cDiurna') + '</th><th style="text-align:right;">' + t('st.cWaybill') + '</th></tr></thead>'
            + '<tbody>' + rows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-drivers\')">' + t('st.csvExport') + '</button>');

      var top = list.slice(0, 10);
      stChart('stChDrvTop', {
        type: 'bar',
        data: {
          labels: top.map(function (s) { return s.nume || s.email; }),
          datasets: [{ label: t('st.cRevenue'), data: top.map(function (s) { return parseFloat(s.bevetel) || 0; }), backgroundColor: 'rgba(99,102,241,0.7)' }]
        },
        options: { indexAxis: 'y' }
      });

      // Cross-sofőr fogyasztás-összehasonlítás (Admin/Manager only) —
      // csempén megjelenik a cég-átlag + minden sofőr avg_curr / avg_prev
      // értéke, kiemelve akik eltérnek > 2.5 L/100km-mel. Alá tesszük a
      // meglévő sofőr-teljesítmény táblázatnak.
      gas('getSoferConsumptionOverview', []).then(function (rc) {
        if (!rc || !rc.ok) return;
        var sofs = rc.sofers || [];
        if (sofs.length === 0) return;
        var cAvg = rc.company_avg;
        var thr = parseFloat(rc.threshold) || 2.5;
        function fmtAvg(v) {
          return (v == null || !isFinite(parseFloat(v))) ? '—' : parseFloat(v).toFixed(1);
        }
        var rowsHtml = sofs.map(function (s) {
          var rowStyle = s.deviates ? 'background: rgba(234,88,12,0.10);' : '';
          var devLabel = (s.deviation_from_avg != null)
            ? fmtAvg(s.deviation_from_avg) + (s.deviates ? ' ⚠️' : '')
            : '—';
          return '<tr style="' + rowStyle + '">'
            + '<td><b class="text-primary">' + esc(s.nume || s.email || '—') + '</b></td>'
            + '<td style="text-align:right;">' + fmtAvg(s.avg_curr) + '</td>'
            + '<td style="text-align:right;">' + fmtAvg(s.avg_prev) + '</td>'
            + '<td style="text-align:right;">' + (s.avg_diff != null ? fmtAvg(s.avg_diff) : '—') + '</td>'
            + '<td style="text-align:right;font-weight:' + (s.deviates ? '700' : '500') + ';color:' + (s.deviates ? '#ea580c' : 'inherit') + ';">' + devLabel + '</td>'
            + '</tr>';
        }).join('');
        var subtitle = (cAvg != null)
          ? t('st.dr.pFuelCompareAvg') + ': <b>' + fmtAvg(cAvg) + ' L/100km</b> · ' + t('st.dr.pFuelCompareThr') + ': ' + thr.toFixed(1)
          : t('st.noData');
        var panelHtml = '<div class="text-muted" style="margin:0 0 10px;font-size:12px;">' + subtitle + '</div>'
          + '<div style="overflow-x:auto;"><table class="table">'
          + '<thead><tr>'
          + '<th>' + t('st.cDriver') + '</th>'
          + '<th style="text-align:right;">' + t('st.dr.cAvgCurr') + '</th>'
          + '<th style="text-align:right;">' + t('st.dr.cAvgPrev') + '</th>'
          + '<th style="text-align:right;">' + t('st.dr.cAvgDiff') + '</th>'
          + '<th style="text-align:right;">' + t('st.dr.cDevFromAvg') + '</th>'
          + '</tr></thead>'
          + '<tbody>' + rowsHtml + '</tbody></table></div>';
        // Új panelt fűzünk a meglévő pane végére (a driver-tábla alá)
        var extra = document.createElement('div');
        extra.innerHTML = stPanel(t('st.dr.pFuelCompare'), panelHtml);
        var boxNode = document.getElementById('statsDriversBox');
        if (boxNode) boxNode.appendChild(extra);
      }).catch(function () { /* best-effort */ });
    });
  }

  // ════════════════════════════════════════════════════════
  //  6) JÁRMŰ KIHASZNÁLTSÁG (stats-vehicles) + GPS pillanatkép
  // ════════════════════════════════════════════════════════
  function loadVehiclesStats() {
    var box = document.getElementById('statsVehiclesBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-vehicles') + '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.loading') + '</div>';
    gas('getVehicleStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-vehicles') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || t('common.error')) + '</div>'; return; }
      _stData['stats-vehicles'] = r;
      var list = r.jarmuvek || [];
      var rate = parseFloat(r.eur_ron_rate) || null;

      var rows = list.map(function (v) {
        var nevleges = parseFloat(v.nevleges) || 0;
        var consum = parseFloat(v.consum_100) || 0;
        var diffBadge = '—';
        if (nevleges > 0 && consum > 0) {
          var diff = ((consum - nevleges) / nevleges) * 100;
          var cls = diff > 10 ? 'err' : diff > 0 ? 'warn' : 'ok';
          diffBadge = '<span class="badge ' + cls + '">' + (diff >= 0 ? '+' : '') + stNum(diff, 1) + '%</span>';
        }
        return '<tr>'
          + '<td><b class="text-primary">' + esc(v.rendszam_eredeti || v.rendszam || '—') + '</b>'
          + (v.marca ? '<div class="text-muted" style="font-size:11px;">' + esc(v.marca) + (v.model ? ' ' + esc(v.model) : '') + (v.an ? ' · ' + v.an : '') + '</div>' : '') + '</td>'
          + '<td style="text-align:center;">' + (v.activ === false ? '<span class="badge err">' + t('st.bIdle') + '</span>' : '<span class="badge ok">' + t('st.bActive') + '</span>') + '</td>'
          + '<td style="text-align:right;">' + stNum(v.fuvarok, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(v.lezart, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(v.bevetel, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(v.bevetel_per_km, 2) + '</td>'
          + '<td style="text-align:right;">' + stNum(v.total_km, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(v.uzemanyag_ktg, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(v.szerviz_ktg, 0) + '</td>'
          + (rate ? (function () {
              var p = (parseFloat(v.bevetel) || 0) - ((parseFloat(v.uzemanyag_ktg) || 0) + (parseFloat(v.szerviz_ktg) || 0)) / rate;
              return '<td style="text-align:right;font-weight:700;color:' + (p >= 0 ? 'var(--status-ok)' : 'var(--status-danger)') + ';">' + stNum(p, 0) + '</td>';
            })() : '')
          + '<td style="text-align:right;">' + (consum > 0 ? stNum(consum, 1) : '—') + '</td>'
          + '<td style="text-align:center;">' + diffBadge + '</td>'
          + '</tr>';
      }).join('') || '<tr><td colspan="12" class="text-muted" style="text-align:center;padding:18px;">' + t('st.noData') + '</td></tr>';

      box.innerHTML = stFilterBar('stats-vehicles')
        + '<div id="stGpsSnapshotBox"></div>'
        + '<div id="stGpsKmBox"></div>'
        + stPanel(t('st.ve.pTop'), stChartCanvas('stChVehTop'))
        + stPanel(t('st.ve.pTable'),
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + t('st.cVehicle') + '</th><th style="text-align:center;">' + t('st.cState') + '</th><th style="text-align:right;">' + t('st.cOrder') + '</th><th style="text-align:right;">' + t('st.cClosed') + '</th><th style="text-align:right;">' + t('st.cRevenue') + '</th><th style="text-align:right;">' + t('st.ve.cEurKm') + '</th><th style="text-align:right;">' + t('st.cKmWb') + '</th><th style="text-align:right;">' + t('st.cFuelRon') + '</th><th style="text-align:right;">' + t('st.ve.cService') + '</th>'
            + (rate ? '<th style="text-align:right;">' + t('st.cResult') + '</th>' : '')
            + '<th style="text-align:right;">L/100km</th><th style="text-align:center;">' + t('st.cDiff') + '</th></tr></thead>'
            + '<tbody>' + rows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-vehicles\')">' + t('st.csvExport') + '</button>');

      var top = list.filter(function (v) { return (parseFloat(v.bevetel) || 0) > 0; }).slice(0, 10);
      stChart('stChVehTop', {
        type: 'bar',
        data: {
          labels: top.map(function (v) { return v.rendszam_eredeti || v.rendszam; }),
          datasets: [{ label: t('st.cRevenue'), data: top.map(function (v) { return parseFloat(v.bevetel) || 0; }), backgroundColor: 'rgba(34,197,94,0.7)' }]
        },
        options: { indexAxis: 'y' }
      });

      loadGpsSnapshot();
      loadGpsKmCompare();
    });
  }

  // GPS-km (napi snapshot-napló) vs. a sofőr által beírt menetlevél-km
  function loadGpsKmCompare() {
    var box = document.getElementById('stGpsKmBox');
    if (!box) return;
    gas('getGpsKmComparison', stRangeDates()).then(function (r) {
      if (!r || !r.ok || !(r.rows || []).length) { box.innerHTML = ''; return; }
      var rows = r.rows.map(function (x) {
        var warn = x.diff_pct != null && Math.abs(x.diff_pct) > 10;
        return '<tr><td><b class="text-primary">' + esc(x.rendszam) + '</b></td>'
          + '<td style="text-align:right;">' + stNum(x.gps_km, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(x.drv_km, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;color:' + (warn ? 'var(--status-danger)' : 'inherit') + ';">' + (x.diff_km > 0 ? '+' : '') + stNum(x.diff_km, 0) + '</td>'
          + '<td style="text-align:center;">' + (x.diff_pct != null ? '<span class="badge ' + (warn ? 'err' : 'ok') + '">' + (x.diff_pct > 0 ? '+' : '') + stNum(x.diff_pct, 1) + '%</span>' : '—') + '</td>'
          + '<td class="text-muted" style="text-align:right;font-size:12px;">' + t('st.fin.days', { n: stNum(x.napok, 0) }) + '</td></tr>';
      }).join('');
      box.innerHTML = stPanel(t('st.ve.pGpsKm'),
        '<div style="overflow-x:auto;"><table class="table">'
        + '<thead><tr><th>' + t('st.cPlate') + '</th><th style="text-align:right;">' + t('st.ve.gpsKm') + '</th><th style="text-align:right;">' + t('st.ve.drvWrote') + '</th><th style="text-align:right;">' + t('st.cDiff') + '</th><th style="text-align:center;">%</th><th style="text-align:right;">' + t('st.ve.measDays') + '</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>'
        + '<div class="text-muted" style="font-size:11px;margin-top:6px;">' + t('st.ve.gpsKmHint') + '</div>');
    }).catch(function () { box.innerHTML = ''; });
  }

  // CargoTrack élő flotta-adatok (üzemanyag-szint, km-óra, gyújtás) — ha a
  // GPS-eszköz méri. A handler 60 mp-es szerver-cache-t használ.
  function loadGpsSnapshot() {
    var box = document.getElementById('stGpsSnapshotBox');
    if (!box) return;
    gas('getGpsFleetSnapshot').then(function (r) {
      if (!r || !r.ok || !r.gps_configured || !(r.vehicles || []).length) { box.innerHTML = ''; return; }
      var rows = r.vehicles.map(function (v) {
        var ign = v.ignition === 'ON' || v.ignition === true || v.ignition === 'on';
        return '<tr><td><b class="text-primary">' + esc(v.rendszam || v.object_name || '—') + '</b></td>'
          + '<td style="text-align:center;">' + (ign ? '<span class="badge ok">' + t('st.ve.bRunning') + '</span>' : '<span class="badge info">' + t('st.ve.bStopped') + '</span>') + '</td>'
          + '<td style="text-align:right;">' + (v.speed != null ? stNum(v.speed, 0) + ' km/h' : '—') + '</td>'
          + '<td style="text-align:right;">' + (v.fuel_level != null ? stNum(v.fuel_level, 0) + ' L' : '—') + '</td>'
          + '<td style="text-align:right;">' + (v.mileage != null ? stNum(v.mileage, 0) + ' km' : '—') + '</td>'
          + '<td style="text-align:right;">' + (v.fuel_consumption != null ? stNum(v.fuel_consumption, 1) : '—') + '</td>'
          + '<td class="text-muted" style="font-size:12px;">' + (v.datetime ? new Date(v.datetime).toLocaleString('hu-HU') : '—') + '</td></tr>';
      }).join('');
      box.innerHTML = stPanel(t('st.ve.pLive'),
        '<div style="overflow-x:auto;"><table class="table">'
        + '<thead><tr><th>' + t('st.cVehicle') + '</th><th style="text-align:center;">' + t('st.ve.ignition') + '</th><th style="text-align:right;">' + t('st.ve.speed') + '</th><th style="text-align:right;">' + t('st.ve.fuelLevel') + '</th><th style="text-align:right;">' + t('st.ve.gpsOdo') + '</th><th style="text-align:right;">' + t('st.ve.consumption') + '</th><th>' + t('st.ve.lastSignal') + '</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>'
        + '<div class="text-muted" style="font-size:11px;margin-top:8px;">' + t('st.ve.liveHint') + '</div>');
    }).catch(function () { box.innerHTML = ''; });
  }

  // ════════════════════════════════════════════════════════
  //  7) ÜGYFÉL RIPORT (stats-clients)
  // ════════════════════════════════════════════════════════
  function loadClients() {
    var box = document.getElementById('statsClientsBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-clients') + '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.loading') + '</div>';
    gas('getClientStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-clients') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || t('common.error')) + '</div>'; return; }
      _stData['stats-clients'] = r;
      var list = r.ugyfelek || [];
      var fin = !!r.finance;

      var rows = list.map(function (u) {
        var anaf = u.anaf_status === 'activ' ? '<span class="badge ok">' + t('st.cl.anafActive') + '</span>'
          : u.anaf_status === 'inactiv' ? '<span class="badge err">' + t('st.cl.anafInactive') + '</span>' : '';
        return '<tr><td><b class="text-primary">' + esc(u.ugyfel || '—') + '</b>'
          + (u.cui_cif ? '<div class="text-muted" style="font-size:11px;">' + esc(u.cui_cif) + '</div>' : '') + '</td>'
          + '<td>' + anaf + '</td>'
          + '<td style="text-align:right;">' + stNum(u.fuvarok, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(u.lezart, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(u.bevetel, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(u.km, 0) + '</td>'
          + (fin ? '<td style="text-align:right;color:' + ((parseFloat(u.kintlevo) || 0) > 0 ? 'var(--status-danger)' : 'inherit') + ';font-weight:700;">' + stNum(u.kintlevo, 0) + '</td>' : '')
          + (fin ? '<td style="text-align:center;">' + (u.atlag_fizetesi_nap != null ? stNum(u.atlag_fizetesi_nap, 0) + ' nap' : '—') + '</td>' : '')
          + '</tr>';
      }).join('') || '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:18px;">' + t('st.noData') + '</td></tr>';

      box.innerHTML = stFilterBar('stats-clients')
        + stPanel(t('st.cl.pTop'), stChartCanvas('stChCliTop'))
        + stPanel(t('st.cl.pTable'),
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + t('st.cClient') + '</th><th>ANAF</th><th style="text-align:right;">' + t('st.cOrder') + '</th><th style="text-align:right;">' + t('st.cClosed') + '</th><th style="text-align:right;">' + t('st.cRevenue') + '</th><th style="text-align:right;">' + t('st.cKm') + '</th>'
            + (fin ? '<th style="text-align:right;">' + t('st.cl.cOutEur') + '</th><th style="text-align:center;">' + t('st.cl.cAvgPay') + '</th>' : '')
            + '</tr></thead><tbody>' + rows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-clients\')">' + t('st.csvExport') + '</button>');

      var top = list.slice(0, 10);
      stChart('stChCliTop', {
        type: 'bar',
        data: {
          labels: top.map(function (u) { return u.ugyfel; }),
          datasets: [{ label: t('st.cRevenue'), data: top.map(function (u) { return parseFloat(u.bevetel) || 0; }), backgroundColor: 'rgba(59,130,246,0.7)' }]
        },
        options: { indexAxis: 'y' }
      });
    });
  }

  // ════════════════════════════════════════════════════════
  //  8) JOGOSULTSÁGOK (stats-permissions) — CSAK ADMIN
  // ════════════════════════════════════════════════════════
  // A jogosultság-kulcsok rögzített sorrendje + i18n-címke kulcsuk.
  // (A backend ugyanezt a fehérlistát kényszeríti ki — handlers/permissions.js.)
  var PERM_DEFS = [
    { key: 'stats_finance', i18n: 'st.pm.kFinance' },
    { key: 'orders_delete', i18n: 'st.pm.kOrdersDelete' },
    { key: 'invoice_issue', i18n: 'st.pm.kInvoiceIssue' },
    { key: 'data_export',   i18n: 'st.pm.kDataExport' },
    { key: 'users_manage',  i18n: 'st.pm.kUsersManage' }
  ];

  function loadPermissions() {
    var box = document.getElementById('statsPermissionsBox');
    if (!box) return;
    box.innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.loading') + '</div>';
    gas('getCompanyPermissions').then(function (r) {
      if (!r || !r.ok) { box.innerHTML = '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || t('common.error')) + '</div>'; return; }
      var head = '<th>' + t('col.name') + '</th><th>' + t('common.email') + '</th>'
        + PERM_DEFS.map(function (p) { return '<th style="text-align:center;font-size:12px;">' + t(p.i18n) + '</th>'; }).join('');
      var rows = (r.users || []).map(function (u) {
        var cells = PERM_DEFS.map(function (p) {
          var on = !!(u.flags && u.flags[p.key]);
          return '<td style="text-align:center;">'
            + '<input type="checkbox" ' + (on ? 'checked' : '') + ' style="width:18px;height:18px;cursor:pointer;accent-color:#22c55e;" '
            + 'onchange="VS_STATS.setPerm(' + u.id + ',\'' + p.key + '\', this.checked)">'
            + '</td>';
        }).join('');
        return '<tr><td><b class="text-primary">' + esc(u.nume || '—') + '</b></td>'
          + '<td>' + esc(u.email) + '</td>' + cells + '</tr>';
      }).join('') || '<tr><td colspan="' + (2 + PERM_DEFS.length) + '" class="text-muted" style="text-align:center;padding:18px;">' + t('st.pm.noManager') + '</td></tr>';

      box.innerHTML = stPanel(t('st.pm.pTitle'),
        '<p class="text-muted" style="font-size:13px;margin:0 0 14px;">' + t('st.pm.descMatrix') + '</p>'
        + '<div style="overflow-x:auto;"><table class="table">'
        + '<thead><tr>' + head + '</tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>');
    });
  }

  function setPerm(userId, permKey, enabled) {
    gas('setUserPermission', { user_id: userId, perm_key: permKey, enabled: enabled }).then(function (r) {
      if (r && r.ok) toast(enabled ? t('st.pm.granted') : t('st.pm.revoked'), 'ok');
      else { toast((r && r.err) || t('common.error'), 'err'); loadPermissions(); }
    });
  }

  // ════════════════════════════════════════════════════════
  //  9) CO₂ RIPORT (stats-co2) — CSAK OLVASÁS, valós adat
  //     Az üzemanyagkártya-literekből számolt CO₂ (faktor 2.64 kg/L).
  // ════════════════════════════════════════════════════════
  function loadCo2() {
    var box = document.getElementById('statsCo2Box');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-co2') + '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.loading') + '</div>';
    gas('getCo2Report', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-co2') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || t('common.error')) + '</div>'; return; }
      _stData['stats-co2'] = r;

      var per100 = (r.co2_per_100km != null) ? stNum(r.co2_per_100km, 2) + ' kg' : '—';
      var metrics = [
        { l: '🌍 ' + t('st.co2.total'), v: stNum(r.co2_tonna, 2) + ' <span style="font-size:13px;">t CO₂</span>' },
        { l: '⛽ ' + t('st.co2.litres'), v: stNum(r.litru, 0) + ' L' },
        { l: '🛣️ ' + t('st.co2.per100'), v: per100 },
        { l: '🌳 ' + t('st.co2.trees'), v: stNum(r.fa_egyenertek, 0) }
      ];

      // Járművenkénti tábla (rendszám + liter + kg CO₂)
      var vehRows = (r.jarmuvek || []).map(function (v) {
        return '<tr><td><b class="text-primary">' + esc(v.rendszam || '—') + '</b></td>'
          + '<td style="text-align:right;">' + stNum(v.litru, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(v.co2_kg, 0) + '</td></tr>';
      }).join('') || '<tr><td colspan="3" class="text-muted" style="text-align:center;padding:18px;">' + t('st.noData') + '</td></tr>';

      box.innerHTML = stFilterBar('stats-co2')
        + '<div style="margin-bottom:16px;">' + vsMetricBand(metrics, { tall: true }) + '</div>'
        + '<p class="text-muted" style="font-size:12px;margin:0 0 14px;">' + t('st.co2.note', { f: stNum(r.factor, 2) }) + '</p>'
        + stPanel(t('st.co2.pMonthly'), stChartCanvas('stChCo2Havi'))
        + stPanel(t('st.co2.pPerVeh'),
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + t('st.cPlate') + '</th><th style="text-align:right;">' + t('st.cLiter') + '</th><th style="text-align:right;">' + t('st.co2.cKg') + '</th></tr></thead>'
            + '<tbody>' + vehRows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-co2\')">' + t('st.csvExport') + '</button>');

      var months = stMonths([r.havi]);
      stChart('stChCo2Havi', {
        type: 'bar',
        data: { labels: months, datasets: [
          { label: 'CO₂ (kg)', data: stSeries(months, r.havi, 'co2_kg'), backgroundColor: 'rgba(34,197,94,0.7)' }
        ]}
      });
    });
  }

  // ════════════════════════════════════════════════════════
  //  10) SLA & ÉLETCIKLUS (stats-sla) — CSAK OLVASÁS, valós adat
  // ════════════════════════════════════════════════════════
  function loadSla() {
    var box = document.getElementById('statsSlaBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-sla') + '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.loading') + '</div>';
    gas('getSlaStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-sla') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || t('common.error')) + '</div>'; return; }
      _stData['stats-sla'] = r;

      function pctVal(x) { return (x != null) ? stNum(x, 1) + ' <span style="font-size:13px;">%</span>' : '—'; }
      var metrics = [
        { l: '✅ ' + t('st.sla.delivered'), v: pctVal(r.kezbesitett_arany), sub: r.lezart + ' / ' + r.nem_torolt },
        { l: '🧾 ' + t('st.sla.invoiced'), v: pctVal(r.kiszamlazasi_arany), sub: r.lezart_szamlazott + ' / ' + r.lezart_invoiceable },
        { l: '✖ ' + t('st.sla.cancelled'), v: pctVal(r.lemondasi_arany), sub: r.torolt + ' / ' + r.osszes },
        { l: '⏱️ ' + t('st.sla.transit'), v: (r.atlag_tranzit_nap != null ? stNum(r.atlag_tranzit_nap, 1) + ' <span style="font-size:13px;">' + t('st.sla.days') + '</span>' : '—'), sub: t('st.sla.sample') + ': ' + r.tranzit_minta_db }
      ];

      box.innerHTML = stFilterBar('stats-sla')
        + '<div style="margin-bottom:16px;">' + vsMetricBand(metrics, { tall: true }) + '</div>'
        + '<p class="text-muted" style="font-size:12px;margin:0 0 14px;">' + t('st.sla.note') + '</p>'
        + stPanel(t('st.sla.pMonthly'), stChartCanvas('stChSlaHavi'))
        + stPanel(t('st.sla.pTable'),
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + t('st.sla.cMetric') + '</th><th style="text-align:right;">' + t('st.sla.cValue') + '</th></tr></thead>'
            + '<tbody>'
            + '<tr><td>' + t('st.sla.delivered') + '</td><td style="text-align:right;font-weight:700;">' + (r.kezbesitett_arany != null ? stNum(r.kezbesitett_arany, 1) + ' %' : '—') + '</td></tr>'
            + '<tr><td>' + t('st.sla.invoiced') + '</td><td style="text-align:right;font-weight:700;">' + (r.kiszamlazasi_arany != null ? stNum(r.kiszamlazasi_arany, 1) + ' %' : '—') + '</td></tr>'
            + '<tr><td>' + t('st.sla.cancelled') + '</td><td style="text-align:right;font-weight:700;">' + (r.lemondasi_arany != null ? stNum(r.lemondasi_arany, 1) + ' %' : '—') + '</td></tr>'
            + '<tr><td>' + t('st.sla.transit') + '</td><td style="text-align:right;font-weight:700;">' + (r.atlag_tranzit_nap != null ? stNum(r.atlag_tranzit_nap, 1) + ' ' + t('st.sla.days') : '—') + '</td></tr>'
            + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-sla\')">' + t('st.csvExport') + '</button>');

      var months = stMonths([r.havi_lezart, r.havi_torolt]);
      stChart('stChSlaHavi', {
        type: 'bar',
        data: { labels: months, datasets: [
          { label: t('st.sla.delivered'), data: stSeries(months, r.havi_lezart, 'db'), backgroundColor: 'rgba(34,197,94,0.7)' },
          { label: t('st.sla.cancelled'), data: stSeries(months, r.havi_torolt, 'db'), backgroundColor: 'rgba(239,68,68,0.7)' }
        ]}
      });
    });
  }

  // ── CSV exportok (az utoljára betöltött adatból) ────────
  function csvExport(pane) {
    var r = _stData[pane];
    if (!r) { toast(t('st.t.loadFirst'), 'err'); return; }
    var stamp = new Date().toISOString().slice(0, 10);
    if (pane === 'stats-finance') {
      stCsv('kintlevoseg-' + stamp + '.csv',
        [t('st.cOrder'), t('st.cClient'), t('st.fin.cPrice'), t('st.cPaid'), t('st.fin.cRemain'), t('st.fin.cDone'), t('st.csv.elapsedDays'), t('st.cStatus')],
        (r.kintlevo_lista || []).map(function (o) {
          return [o.id, o.client, o.pret, o.paid_amount, (parseFloat(o.pret) || 0) - (parseFloat(o.paid_amount) || 0), stDate(o.finalized_at), o.napok, o.payment_status];
        }));
    } else if (pane === 'stats-fuel') {
      stCsv('tankolasok-' + stamp + '.csv',
        [t('st.cDate'), t('st.cDriver'), t('st.cVehicle'), t('st.cPlace'), t('st.cType'), t('st.cLiter'), t('st.cSumRon'), t('st.cPay')],
        (r.lista || []).map(function (a) { return [stDate(a.data_completare), a.nume_sofer, a.numar_camion, a.loc, a.tip, a.litru, a.suma, a.plata]; }));
    } else if (pane === 'stats-purchases') {
      stCsv('vasarlasok-' + stamp + '.csv',
        [t('st.cDate'), t('st.cDriver'), t('st.cVehicle'), t('st.cProduct'), t('st.cPlace'), t('st.pu.cPriceRon'), t('st.cPay')],
        (r.lista || []).map(function (c) { return [stDate(c.data_completare), c.nume_sofer, c.numar_camion, c.produs, c.loc, c.pret, c.plata]; }));
    } else if (pane === 'stats-drivers') {
      var dRate = parseFloat(r.eur_ron_rate) || null;
      stCsv('sofor-teljesitmeny-' + stamp + '.csv',
        [t('st.cDriver'), t('common.email'), t('st.cOrder'), t('st.cClosed'), t('st.cRevenue'), t('st.cKmWb'), 'L/100km', t('st.cFuelRon'), t('st.cBuyRon'), t('st.cResult'), t('st.csv.diurnaExt'), t('st.csv.diurnaInt'), t('st.cWaybill')],
        (r.soforok || []).map(function (s) {
          var p = dRate ? Math.round((parseFloat(s.bevetel) || 0) - ((parseFloat(s.uzemanyag_ktg) || 0) + (parseFloat(s.vasarlas_ktg) || 0)) / dRate) : '';
          return [s.nume, s.email, s.fuvarok, s.lezart, s.bevetel, s.total_km, s.consum_100, s.uzemanyag_ktg, s.vasarlas_ktg, p, s.diurna_ext, s.diurna_int, s.menetlevelek];
        }));
    } else if (pane === 'stats-vehicles') {
      var vRate = parseFloat(r.eur_ron_rate) || null;
      stCsv('jarmu-kihasznaltsag-' + stamp + '.csv',
        [t('st.cPlate'), t('col.brand'), t('st.cOrder'), t('st.cClosed'), t('st.cRevenue'), t('st.ve.cEurKm'), t('st.cKmWb'), t('st.cFuelRon'), t('st.ve.cService'), t('st.cResult'), 'L/100km', t('st.cNominal')],
        (r.jarmuvek || []).map(function (v) {
          var p = vRate ? Math.round((parseFloat(v.bevetel) || 0) - ((parseFloat(v.uzemanyag_ktg) || 0) + (parseFloat(v.szerviz_ktg) || 0)) / vRate) : '';
          return [v.rendszam_eredeti || v.rendszam, (v.marca || '') + ' ' + (v.model || ''), v.fuvarok, v.lezart, v.bevetel, v.bevetel_per_km, v.total_km, v.uzemanyag_ktg, v.szerviz_ktg, p, v.consum_100, v.nevleges];
        }));
    } else if (pane === 'stats-clients') {
      stCsv('ugyfel-riport-' + stamp + '.csv',
        [t('st.cClient'), 'CUI', t('st.cOrder'), t('st.cClosed'), t('st.cRevenue'), t('st.cKm'), t('st.cl.cOutEur'), t('st.csv.avgPayDay')],
        (r.ugyfelek || []).map(function (u) { return [u.ugyfel, u.cui_cif, u.fuvarok, u.lezart, u.bevetel, u.km, u.kintlevo, u.atlag_fizetesi_nap]; }));
    } else if (pane === 'stats-co2') {
      stCsv('co2-riport-' + stamp + '.csv',
        [t('st.cPlate'), t('st.cLiter'), t('st.co2.cKg')],
        (r.jarmuvek || []).map(function (v) { return [v.rendszam, v.litru, v.co2_kg]; }));
    } else if (pane === 'stats-sla') {
      stCsv('sla-analitika-' + stamp + '.csv',
        [t('st.sla.cMetric'), t('st.sla.cValue')],
        [
          [t('st.sla.delivered'), r.kezbesitett_arany != null ? r.kezbesitett_arany + ' %' : ''],
          [t('st.sla.invoiced'), r.kiszamlazasi_arany != null ? r.kiszamlazasi_arany + ' %' : ''],
          [t('st.sla.cancelled'), r.lemondasi_arany != null ? r.lemondasi_arany + ' %' : ''],
          [t('st.sla.transit'), r.atlag_tranzit_nap != null ? r.atlag_tranzit_nap + ' ' + t('st.sla.days') : '']
        ]);
    }
  }

  // ── Publikus API ────────────────────────────────────────
  window.VS_STATS = {
    load: function (name) {
      applyPerms(function () {
        if (name === 'stats-overview') loadOverview();
        else if (name === 'stats-finance') loadFinance();
        else if (name === 'stats-fuel') loadFuel();
        else if (name === 'stats-purchases') loadPurchases();
        else if (name === 'stats-drivers') loadDrivers();
        else if (name === 'stats-vehicles') loadVehiclesStats();
        else if (name === 'stats-clients') loadClients();
        else if (name === 'stats-co2') loadCo2();
        else if (name === 'stats-sla') loadSla();
        else if (name === 'stats-permissions') loadPermissions();
      });
    },
    setPreset: function (preset, pane) {
      _stRange.preset = preset;
      if (preset === 'custom') {
        var bar = document.getElementById('stCustomRange');
        if (bar) bar.style.display = 'inline-flex';
        return; // az Alkalmaz gomb tölt újra
      }
      VS_STATS.load(pane);
    },
    applyCustom: function (pane) {
      var f = (document.getElementById('stFrom') || {}).value;
      var to = (document.getElementById('stTo') || {}).value;
      if (!f || !to) { toast(t('st.t.giveDates'), 'err'); return; }
      _stRange.preset = 'custom'; _stRange.from = f; _stRange.to = to;
      VS_STATS.load(pane);
    },
    csv: csvExport,
    setPerm: setPerm,
    applyPerms: applyPerms,
    saveRate: function () {
      var v = (document.getElementById('stEurRon') || {}).value;
      gas('setEurRonRate', [v === '' ? null : v]).then(function (r) {
        if (r && r.ok) { toast(t('st.t.rateSaved'), 'ok'); VS_STATS.load('stats-overview'); }
        else toast((r && r.err) || t('common.error'), 'err');
      });
    },
    fetchBnr: function () {
      gas('getBnrRate').then(function (r) {
        if (r && r.ok) {
          var inp = document.getElementById('stEurRon');
          if (inp) inp.value = r.rate;
          toast(t('st.t.bnrRate', { date: (r.date || t('st.t.bnrToday')), rate: r.rate }), 'ok');
        } else toast((r && r.err) || t('st.t.bnrUnavail'), 'err');
      });
    }
  };

  // A Pénzügy fül elrejtése jogosultság nélkül — már betöltéskor
  // (a guard a szerveren is megvan: getFinanceStats elutasít).
  if (window.gas) applyPerms();
})();

// ── Statisztika almenü nyit/zár (sidebar szülő-fül) ────────
function toggleStatsMenu() {
  var el = document.getElementById('statsSubmenu');
  if (el && el.parentElement) el.parentElement.classList.toggle('open');
}
