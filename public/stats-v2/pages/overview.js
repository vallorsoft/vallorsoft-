// ============================================================
//  VallorSoft — Statisztika 2.0 — 🏠 Áttekintés fül
//  Executive dashboard: 4 KPI-torony + insight-sáv + havi bevétel/eredmény
//  idősor + top 5 ügyfél + kattintható teendő-sáv.
//
//  Adatforrás: a MEGLÉVŐ handlerek (getStatsOverview + getClientStats +
//  getServiceForecast + getCarrierApAging) — nincs új szerver-oldali kód.
//  A PR #3 (getInsights) egyetlen forrásba fogja gyűjteni a teendőket;
//  addig ez a fájl összefésüli.
//
//  Regisztráció a v2 shell-en át: VS_STATS_V2.registerTab('overview', {...})
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

  var _charts = {};        // canvas id -> Chart példány
  var _lastData = null;

  // ── Formázók ────────────────────────────────────────────
  function fnum(n, dec) {
    var v = parseFloat(n);
    if (!isFinite(v)) return '—';
    return v.toLocaleString('hu-HU', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 2 : dec });
  }
  function pct(v) {
    if (v == null || !isFinite(v)) return '';
    var s = v > 0 ? '▲' : (v < 0 ? '▼' : '—');
    return s + Math.abs(Math.round(v * 10) / 10) + '%';
  }
  function trendColor(v) {
    if (v == null || v === 0) return 'var(--text-muted)';
    return v > 0 ? 'var(--sv2-ok, #22c55e)' : 'var(--sv2-danger, #ef4444)';
  }

  // ── Δ számítás összehasonlítási ág (kliens-oldali becslés) ─
  // Ha compare='prev_period' → az idősor első felét vs. második felét vetjük
  // össze (ne kelljen a szervernek külön kört tenni). Ez a "becslés" — a PR #8
  // fogja a pontosat visszaadni a szerverről.
  function estimateDelta(series) {
    if (!series || series.length < 2) return null;
    var half = Math.floor(series.length / 2);
    if (half < 1) return null;
    var a = series.slice(0, half).reduce(function (s, x) { return s + (x || 0); }, 0);
    var b = series.slice(half).reduce(function (s, x) { return s + (x || 0); }, 0);
    if (!a) return null;
    return ((b - a) / a) * 100;
  }

  // ── Chart helper (téma-érzékeny alap) ──────────────────
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

  // ── KPI-torony HTML (spark-line + trend Δ + cél) ──────
  function kpiTower(items) {
    return '<div class="sv2-kpi-grid">' + items.map(function (it) {
      var trend = it.trend != null
        ? '<span class="sv2-kpi-trend" style="color:' + trendColor(it.trend) + '">' + pct(it.trend) + '</span>'
        : '';
      var sub = it.sub ? '<div class="sv2-kpi-sub">' + $esc(it.sub) + '</div>' : '';
      var goalRow = it.goal ? '<div class="sv2-kpi-goal">' + $esc($t('sv2.ov.goal')) + ': ' + $esc(it.goal) + '</div>' : '';
      var spark = it.spark && it.spark.length
        ? '<svg class="sv2-kpi-spark" viewBox="0 0 100 30" preserveAspectRatio="none">' + sparkPath(it.spark) + '</svg>'
        : '';
      return '<div class="sv2-kpi" style="--kpi-ac:' + (it.color || 'var(--sv2-accent)') + '">'
        + '<div class="sv2-kpi-lbl">' + $esc(it.label || '') + '</div>'
        + '<div class="sv2-kpi-val">' + it.value + '</div>'
        + '<div class="sv2-kpi-row">' + sub + trend + '</div>'
        + goalRow + spark
        + '</div>';
    }).join('') + '</div>';
  }
  function sparkPath(data) {
    var n = data.length, mn = Math.min.apply(0, data), mx = Math.max.apply(0, data);
    var rng = (mx - mn) || 1;
    var pts = data.map(function (v, i) {
      return [(i / (n - 1 || 1)) * 100, 28 - ((v - mn) / rng) * 22 - 2];
    });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    return '<path d="' + line + '" fill="none" stroke="var(--kpi-ac)" stroke-width="2" opacity="0.85"/>';
  }

  // ── Insight-sáv (top 3 teendő) ─────────────────────────
  function insightBar(items) {
    if (!items || !items.length) {
      return '<div class="sv2-insight sv2-insight-ok">✅ ' + $t('sv2.ov.allGood') + '</div>';
    }
    var top = items.slice(0, 3);
    return '<div class="sv2-insight">'
      + '<div class="sv2-insight-head">💡 ' + $t('sv2.ov.insightsHead') + '</div>'
      + '<ul class="sv2-insight-list">' + top.map(function (i) {
          var goto = i.tab ? ' onclick="VS_STATS_V2._go(\'' + i.tab + '\')" style="cursor:pointer;"' : '';
          return '<li' + goto + '><span class="sv2-insight-ico">' + (i.icon || '⚠️') + '</span>'
            + '<span class="sv2-insight-txt">' + $esc(i.text) + '</span></li>';
        }).join('') + '</ul>'
      + '</div>';
  }

  // ── Top 5 tábla ────────────────────────────────────────
  function topFiveTable(rows, opts) {
    opts = opts || {};
    var body = (rows || []).slice(0, 5).map(function (r, i) {
      return '<tr>'
        + '<td class="sv2-rank">' + (i + 1) + '</td>'
        + '<td>' + $esc(r.label || '') + '</td>'
        + '<td style="text-align:right;font-weight:700;">' + fnum(r.value, 0) + ' ' + (opts.unit || '') + '</td>'
        + '</tr>';
    }).join('');
    if (!body) body = '<tr><td colspan="3" class="text-muted" style="text-align:center;padding:14px;">' + $t('sv2.ov.noData') + '</td></tr>';
    return '<table class="table"><tbody>' + body + '</tbody></table>';
  }

  // ── Teendők (jobb oldali kártya) ───────────────────────
  function todosCard(items) {
    if (!items || !items.length) {
      return '<div class="sv2-empty" style="padding:14px;">' + $t('sv2.ov.noTodos') + '</div>';
    }
    return '<ul class="sv2-todos">' + items.map(function (it) {
      var goto = it.tab ? ' onclick="VS_STATS_V2._go(\'' + it.tab + '\')" style="cursor:pointer;"' : '';
      return '<li class="sv2-todo sv2-todo-' + (it.severity || 'info') + '"' + goto + '>'
        + '<span class="sv2-todo-ico">' + (it.icon || '•') + '</span>'
        + '<span class="sv2-todo-txt">' + $esc(it.text) + '</span>'
        + '</li>';
    }).join('') + '</ul>';
  }

  // ── Insights → megjelenítési formázás ──────────────────
  // A PR #3 óta a szerver egyetlen `getStatsInsights` handlerben adja
  // az összes anomáliát (fogyasztás/szerviz/dokumentum-lejárat/UIT/kintlévőség/AP).
  // A régi legacy fallback megmaradt arra az esetre, ha a szerver még nem
  // tudja az új handlert (átmeneti deploy előtt).
  function insightsFromServer(insR) {
    var list = (insR && insR.insights) || [];
    // Insight-sáv (top 3, csak danger+warn a legfontosabbak)
    var insightItems = list.slice(0, 5).map(function (i) {
      return {
        icon: i.icon || '⚠️',
        text: (i.title || '') + (i.detail ? ' — ' + i.detail : ''),
        tab: i.tab,
      };
    });
    // Teendő-lista (összes, severity szín)
    var todos = list.map(function (i) {
      return {
        icon: i.icon || '•',
        text: (i.title || '') + (i.detail ? ' — ' + i.detail : ''),
        severity: i.severity || 'info',
        tab: i.tab,
      };
    });
    return { insights: insightItems, todos: todos };
  }

  // ── Legacy fallback: getStatsOverview alerts + serviceForecast + apAging ──
  function collectInsightsLegacy(ovR, svcR, apR) {
    var insights = [];
    var todos = [];
    (ovR && ovR.alerts || []).forEach(function (a) {
      if (a.type === 'fuel') {
        insights.push({ icon: '⛽', text: $t('sv2.ov.iFuel', { plate: a.rendszam, c: fnum(a.consum, 1), n: fnum(a.nevleges, 1) }), tab: 'fleet' });
        todos.push({ icon: '⛽', text: a.rendszam + ' — ' + fnum(a.consum, 1) + ' L/100km ▲', severity: 'warn', tab: 'fleet' });
      } else if (a.type === 'overdue') {
        insights.push({ icon: '⏳', text: $t('sv2.ov.iOverdue', { db: fnum(a.db, 0), sum: fnum(a.osszeg, 0) }), tab: 'finance' });
        todos.push({ icon: '💰', text: fnum(a.db, 0) + ' × ' + $t('sv2.ov.tOverdue') + ' (' + fnum(a.osszeg, 0) + ' EUR)', severity: 'danger', tab: 'finance' });
      }
    });
    var svcUrgent = ((svcR && svcR.jarmuvek) || []).filter(function (v) { return v.surgos; });
    if (svcUrgent.length) {
      insights.push({ icon: '🔧', text: $t('sv2.ov.iServiceUrgent', { n: svcUrgent.length }), tab: 'fleet' });
      svcUrgent.slice(0, 3).forEach(function (v) {
        todos.push({ icon: '🔧', text: v.rendszam + ' — ' + $t('sv2.ov.tServiceDue') + ' (' + fnum(v.hetek_soonest, 1) + ' hét)', severity: 'danger', tab: 'fleet' });
      });
    }
    if (apR && apR.aging) {
      var sixty = parseFloat(apR.aging.d60p) || 0;
      if (sixty > 0) {
        insights.push({ icon: '📉', text: $t('sv2.ov.iApAging', { sum: fnum(sixty, 0) }), tab: 'finance' });
        todos.push({ icon: '📉', text: $t('sv2.ov.tApAging') + ': ' + fnum(sixty, 0) + ' RON', severity: 'warn', tab: 'finance' });
      }
    }
    return { insights: insights, todos: todos };
  }

  // ── Render ─────────────────────────────────────────────
  function render(box, state) {
    box.innerHTML = '<div class="sv2-empty">' + $t('sv2.ov.loading') + '</div>';

    // Egyidejű lekérések (getStatsOverview + top 5 ügyfél + szerviz + AP-öregítés).
    // A szervek Admin/Manager mellett futnak; a jog nélküli sofőrt a shell már kiszűri.
    var range = state.range;
    var apArgs = { from: range.from, to: range.to };
    var promises = [
      gas('getStatsOverview', apArgs),
      gas('getClientStats', apArgs),
      // PR #3 óta EGY handler adja az összes anomáliát; legacy fallback
      // az alábbi getServiceForecast + getCarrierApAging.
      gas('getStatsInsights').catch(function () { return null; }),
    ];
    // Legacy fallback források — ha a getStatsInsights nem elérhető
    promises.push(gas('getServiceForecast').catch(function () { return null; }));
    if (state.can_finance || state.is_admin) {
      promises.push(gas('getCarrierApAging').catch(function () { return null; }));
    } else {
      promises.push(Promise.resolve(null));
    }

    Promise.all(promises).then(function (rs) {
      var ovR = rs[0] || {};
      var clR = rs[1] || {};
      var insR = rs[2];
      var svcR = rs[3];
      var apR = rs[4];
      _lastData = { ov: ovR, cl: clR, ins: insR, svc: svcR, ap: apR };
      if (!ovR.ok) { box.innerHTML = '<div class="sv2-empty">' + $esc(ovR.err || $t('common.error')) + '</div>'; return; }
      renderInto(box, state);
    });
  }

  function renderInto(box, state) {
    var d = _lastData;
    if (!d) return;
    var ov = d.ov;
    var k = ov.kpi || {};
    var rate = parseFloat(ov.eur_ron_rate) || null;

    // Havi bevétel / eredmény sorozatok
    var months = uniqueMonths([ov.havi_bevetel, ov.havi_koltseg]);
    var revSeries = seriesFor(months, ov.havi_bevetel, 'osszeg');
    var fuelSeries = seriesFor(months, ov.havi_koltseg, 'uzemanyag');
    var purSeries = seriesFor(months, ov.havi_koltseg, 'vasarlas');
    var profitSeries = rate
      ? months.map(function (_, i) { return Math.round((revSeries[i] || 0) - ((fuelSeries[i] || 0) + (purSeries[i] || 0)) / rate); })
      : null;
    var costSeries = months.map(function (_, i) { return ((fuelSeries[i] || 0) + (purSeries[i] || 0)); });

    // Cél-értékek a KPI-tornyokhoz (a shell adja a state.goals-t)
    var goals = state.goals || [];
    function findGoal(metric) {
      return goals.filter(function (g) { return g.metric_key === metric && g.period === 'month'; })[0] || null;
    }
    function goalStr(g) {
      if (!g) return null;
      return fnum(g.target_value, 0) + (g.currency ? ' ' + g.currency : '');
    }

    // 4 KPI-torony
    var revGoal = findGoal('revenue');
    var closedGoal = findGoal('closed_orders');
    var consumGoal = findGoal('consum_l100');
    var kpis = [
      {
        label: '💶 ' + $t('sv2.ov.revenue'), color: '#22c55e',
        value: '<b>' + fnum(k.bevetel, 0) + '</b> <span style="font-size:12px;">EUR</span>',
        sub: fnum(k.km, 0) + ' km',
        trend: estimateDelta(revSeries), spark: revSeries.slice(-8),
        goal: goalStr(revGoal),
      },
      {
        label: '📦 ' + $t('sv2.ov.closed'), color: '#3b82f6',
        value: '<b>' + fnum(k.lezart, 0) + '</b>',
        sub: $t('sv2.ov.ofAll', { n: fnum(k.osszes, 0) }),
        goal: goalStr(closedGoal),
      },
      {
        label: '⛽ ' + $t('sv2.ov.consum'), color: '#f59e0b',
        value: '<b>' + fnum(k.consum_100, 1) + '</b> <span style="font-size:12px;">L/100km</span>',
        sub: fnum(k.diurna_ext, 0) + ' + ' + fnum(k.diurna_int, 0) + ' ' + $t('sv2.ov.diurnaDays'),
        goal: goalStr(consumGoal),
      },
    ];
    if (ov.finance) {
      kpis.push({
        label: '⏳ ' + $t('sv2.ov.outstanding'), color: '#ef4444',
        value: '<b>' + fnum(ov.finance.kintlevo, 0) + '</b> <span style="font-size:12px;">EUR</span>',
        sub: fnum(ov.finance.kintlevo_db, 0) + ' × ' + $t('sv2.ov.invoice'),
      });
    } else {
      kpis.push({
        label: '⚠️ ' + $t('sv2.ov.anomalies'), color: '#f59e0b',
        value: '<b>' + fnum((ov.alerts || []).length, 0) + '</b>',
        sub: $t('sv2.ov.checkTodos'),
      });
    }

    // Insight + teendők — PR #3 óta EGY handler (getStatsInsights);
    // ha az szerver nem adta vissza (átmeneti deploy előtt), legacy fallback.
    var ins;
    if (d.ins && d.ins.ok) {
      ins = insightsFromServer(d.ins);
    } else {
      ins = collectInsightsLegacy(ov, d.svc, d.ap);
    }

    // Top 5 ügyfél a getClientStats-ból
    var top5clients = ((d.cl && d.cl.ugyfelek) || []).slice(0, 5).map(function (u) {
      return { label: u.ugyfel, value: parseFloat(u.bevetel) || 0 };
    });

    // Top 5 útvonal (getStatsOverview-ból, már rendezett)
    var top5routes = (ov.top_utvonalak || []).slice(0, 5).map(function (r) {
      return { label: (r.loc_incarcare || '?') + ' → ' + (r.loc_descarcare || '?'), value: parseFloat(r.bevetel) || 0 };
    });

    box.innerHTML = ''
      + kpiTower(kpis)
      + insightBar(ins.insights)
      + '<div class="sv2-grid-2col">'
      +   '<div class="sv2-panel">'
      +     '<div class="sv2-panel-head"><div class="sv2-panel-title">📈 ' + $t('sv2.ov.pTrend') + '</div></div>'
      +     '<div class="sv2-chart-wrap"><canvas id="sv2OvTrend"></canvas></div>'
      +   '</div>'
      +   '<div class="sv2-panel">'
      +     '<div class="sv2-panel-head"><div class="sv2-panel-title">📋 ' + $t('sv2.ov.pTodos') + '</div></div>'
      +     todosCard(ins.todos)
      +   '</div>'
      + '</div>'
      + '<div class="sv2-grid-2col">'
      +   '<div class="sv2-panel">'
      +     '<div class="sv2-panel-head"><div class="sv2-panel-title">🏆 ' + $t('sv2.ov.pTopClients') + '</div>'
      +       (state.can_finance || state.is_admin ? '<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="VS_STATS_V2._go(\'people\')">' + $t('sv2.ov.seeAll') + ' →</button>' : '')
      +     '</div>'
      +     topFiveTable(top5clients, { unit: 'EUR' })
      +   '</div>'
      +   '<div class="sv2-panel">'
      +     '<div class="sv2-panel-head"><div class="sv2-panel-title">🛣️ ' + $t('sv2.ov.pTopRoutes') + '</div></div>'
      +     topFiveTable(top5routes, { unit: 'EUR' })
      +   '</div>'
      + '</div>';

    // Grafikon: bevétel + költség + (profit ha van rate)
    var datasets = [
      { label: $t('sv2.ov.revenue'), data: revSeries, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.14)', fill: true, tension: 0.3, yAxisID: 'y' },
      { label: $t('sv2.ov.cost'), data: costSeries, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.10)', fill: false, tension: 0.3, borderDash: [4, 4], yAxisID: 'y2' },
    ];
    if (profitSeries) {
      datasets.push({ label: $t('sv2.ov.profit'), data: profitSeries, borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.20)', fill: true, tension: 0.3, yAxisID: 'y' });
    }
    makeChart('sv2OvTrend', {
      type: 'line',
      data: { labels: months, datasets: datasets },
      options: {
        scales: {
          y: { position: 'left' },
          y2: { position: 'right', grid: { display: false } },
        }
      },
    });
  }

  // ── Helper: egyesített hónap-tengely ──────────────────
  function uniqueMonths(seriesList) {
    var s = new Set();
    seriesList.forEach(function (list) { (list || []).forEach(function (row) { if (row && row.ho) s.add(row.ho); }); });
    return Array.from(s).sort();
  }
  function seriesFor(months, list, field) {
    var m = {};
    (list || []).forEach(function (r) { if (r && r.ho) m[r.ho] = parseFloat(r[field]) || 0; });
    return months.map(function (mo) { return m[mo] || 0; });
  }

  // ── Regisztráció a v2 shellbe ─────────────────────────
  VS_STATS_V2.registerTab('overview', {
    label: $t('sv2.tab.overview'),
    render: render,
    onFilter: function () { /* range változás → a shell újrarender, ami újra render()-t hív */ },
  });
})();
