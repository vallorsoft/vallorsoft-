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
      ['12m', 'Elmúlt 12 hónap'], ['year', 'Idei év'], ['3m', 'Elmúlt 3 hónap'],
      ['month', 'E hónap'], ['prev', 'Előző hónap'], ['custom', 'Egyedi időszak']
    ];
    var r = stRangeDates();
    return '<div class="glass" style="padding:12px 16px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
      + '<span class="text-muted" style="font-size:12px;font-weight:700;">📅 Időszak:</span>'
      + '<select class="select" style="max-width:190px;padding:8px 10px;font-size:13px;" onchange="VS_STATS.setPreset(this.value,\'' + pane + '\')">'
      + presets.map(function (p) { return '<option value="' + p[0] + '"' + (_stRange.preset === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('')
      + '</select>'
      + '<span id="stCustomRange" style="display:' + (_stRange.preset === 'custom' ? 'inline-flex' : 'none') + ';gap:8px;align-items:center;">'
      + '<input class="input" type="date" id="stFrom" value="' + (r.from || '') + '" style="padding:7px 10px;font-size:13px;max-width:150px;">'
      + '<span class="text-muted">→</span>'
      + '<input class="input" type="date" id="stTo" value="' + (r.to || '') + '" style="padding:7px 10px;font-size:13px;max-width:150px;">'
      + '<button class="btn primary" style="padding:7px 14px;font-size:12px;" onclick="VS_STATS.applyCustom(\'' + pane + '\')">Alkalmaz</button>'
      + '</span>'
      + '<span style="margin-left:auto;"></span>'
      + '<button class="btn ghost" style="padding:7px 14px;font-size:12px;" onclick="VS_STATS.load(\'' + pane + '\')">🔄 Frissítés</button>'
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

  var PAY_BADGE = {
    paid:    '<span class="badge ok">Fizetve</span>',
    partial: '<span class="badge warn">Részben</span>',
    unpaid:  '<span class="badge err">Kintlévő</span>'
  };

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
    box.innerHTML = stFilterBar('stats-overview') + '<div class="text-muted" style="padding:30px;text-align:center;">Betöltés...</div>';
    gas('getStatsOverview', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-overview') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || 'Hiba') + '</div>'; return; }
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
            + '⛽ <b class="text-primary">' + esc(a.rendszam) + '</b>&nbsp;túlfogyasztás: <b style="color:var(--status-warn);">'
            + stNum(a.consum, 1) + ' L/100km</b>&nbsp;<span class="text-muted">(névleges: ' + stNum(a.nevleges, 1) + ')</span></div>';
        } else if (a.type === 'overdue') {
          alertsHtml += '<div style="display:flex;gap:8px;align-items:center;padding:8px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.35);border-radius:10px;font-size:13px;cursor:pointer;" onclick="activateTab(\'stats-finance\')">'
            + '⏰ <b style="color:var(--status-danger);">' + stNum(a.db, 0) + ' fuvar</b>&nbsp;30+ napja kintlévő — összesen <b style="color:var(--status-danger);">'
            + stNum(a.osszeg, 0) + ' EUR</b>&nbsp;<span class="text-muted">→ Pénzügy</span></div>';
        }
      });
      if (alertsHtml) alertsHtml = '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">' + alertsHtml + '</div>';

      // Árfolyam-beállító (csak Admin) — az eredmény-számításhoz
      var rateRow = '';
      if (typeof VS_ROLE !== 'undefined' && VS_ROLE === 'admin') {
        rateRow = '<div class="glass" style="padding:10px 16px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
          + '<span class="text-muted" style="font-size:12px;font-weight:700;">💱 Árfolyam (1 EUR = ? RON):</span>'
          + '<input class="input" id="stEurRon" type="number" step="0.0001" min="0" value="' + (rate || '') + '" placeholder="pl. 4.97" style="max-width:120px;padding:7px 10px;font-size:13px;">'
          + '<button class="btn ghost" style="padding:7px 12px;font-size:12px;" title="A BNR hivatalos napi árfolyamának betöltése" onclick="VS_STATS.fetchBnr()">🏦 BNR</button>'
          + '<button class="btn primary" style="padding:7px 14px;font-size:12px;" onclick="VS_STATS.saveRate()">Mentés</button>'
          + '<span class="text-muted" style="font-size:11px;">Eredmény-számításhoz (EUR bevétel − RON költség). Üresen = nincs profit-számítás.</span>'
          + '</div>';
      }

      // Top útvonalak tábla
      var utvRows = (r.top_utvonalak || []).map(function (u) {
        return '<tr><td>' + esc(u.loc_incarcare) + ' <span class="text-muted">→</span> ' + esc(u.loc_descarcare) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(u.db, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(u.atlag_km, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(u.atlag_ar, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(u.bevetel, 0) + '</td></tr>';
      }).join('') || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:14px;">Nincs lezárt fuvar az időszakban.</td></tr>';

      var tiles =
        stTile('💶', stNum(k.bevetel, 0) + ' <span style="font-size:13px;">EUR</span>', 'Bevétel (lezárt fuvarok)')
        + stTile('📦', stNum(k.lezart, 0), 'Lezárt fuvar (' + stNum(k.osszes, 0) + ' kiírt, ' + stNum(k.torolt, 0) + ' törölt)')
        + stTile('🛣️', stNum(k.fuvarlevel_km, 0) + ' km', 'Megtett km (menetlevelek)')
        + stTile('⛽', stNum(k.consum_100, 1) + ' L/100km', 'Flotta átlagfogyasztás')
        + stTile('🗓️', stNum(k.diurna_ext, 0) + ' / ' + stNum(k.diurna_int, 0), 'Diurna napok (külső / belső)');
      if (fin) {
        tiles += stTile('💰', stNum(fin.beszedett, 0) + ' <span style="font-size:13px;">EUR</span>', 'Beszedett összeg', 'var(--status-ok)')
          + stTile('⏳', stNum(fin.kintlevo, 0) + ' <span style="font-size:13px;">EUR</span>', 'Kintlévőség (' + stNum(fin.kintlevo_db, 0) + ' fuvar)', 'var(--status-danger)');
      }
      if (eredmeny != null) {
        tiles += stTile('🎯', stNum(eredmeny, 0) + ' <span style="font-size:13px;">EUR</span>',
          'Eredmény (bevétel − sofőr-költségek, ' + stNum(rate, 2) + ' árfolyamon)',
          eredmeny >= 0 ? 'var(--status-ok)' : 'var(--status-danger)');
      }
      box.innerHTML = stFilterBar('stats-overview')
        + alertsHtml
        + rateRow
        + '<div class="dash-stats" style="margin-bottom:16px;">' + tiles + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;">'
        + stPanel('📈 Havi bevétel (EUR)', stChartCanvas('stChOvBevetel'))
        + stPanel('💸 Havi költségek (RON) — tankolás + vásárlás', stChartCanvas('stChOvKoltseg'))
        + (rate ? stPanel('🎯 Havi eredmény (EUR, ' + stNum(rate, 2) + ' árfolyamon)', stChartCanvas('stChOvEredmeny')) : '')
        + stPanel('🗺️ Top útvonalak (lezárt fuvarok)',
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>Útvonal</th><th style="text-align:right;">Fuvar</th><th style="text-align:right;">Átlag km</th><th style="text-align:right;">Átlagár (EUR)</th><th style="text-align:right;">Bevétel (EUR)</th></tr></thead>'
            + '<tbody>' + utvRows + '</tbody></table></div>')
        + '</div>';

      var months = stMonths([r.havi_bevetel, r.havi_koltseg]);
      stChart('stChOvBevetel', {
        type: 'line',
        data: { labels: months, datasets: [{
          label: 'Bevétel (EUR)', data: stSeries(months, r.havi_bevetel, 'osszeg'),
          borderColor: '#e10b1a', backgroundColor: 'rgba(225,11,26,0.15)', fill: true, tension: 0.3
        }]}
      });
      stChart('stChOvKoltseg', {
        type: 'bar',
        data: { labels: months, datasets: [
          { label: 'Üzemanyag (RON)', data: stSeries(months, r.havi_koltseg, 'uzemanyag'), backgroundColor: 'rgba(245,158,11,0.7)', stack: 'k' },
          { label: 'Vásárlások (RON)', data: stSeries(months, r.havi_koltseg, 'vasarlas'), backgroundColor: 'rgba(59,130,246,0.7)', stack: 'k' }
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
            label: 'Eredmény (EUR)', data: profit,
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
    box.innerHTML = stFilterBar('stats-finance') + '<div class="text-muted" style="padding:30px;text-align:center;">Betöltés...</div>';
    gas('getFinanceStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) {
        box.innerHTML = stFilterBar('stats-finance')
          + '<div class="glass" style="padding:40px;text-align:center;">'
          + '<div style="font-size:36px;margin-bottom:10px;">🔒</div>'
          + '<div class="text-primary" style="font-weight:700;margin-bottom:6px;">Nincs hozzáférésed a pénzügyi riporthoz</div>'
          + '<div class="text-muted" style="font-size:13px;">' + esc((r && r.err) || 'Hiba történt') + '</div></div>';
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
          + (o.lejart ? ' <span class="badge err">Lejárt</span>' : ' <span class="badge warn">' + stNum(o.napok, 0) + ' nap</span>') + '</td>'
          + '<td>' + (PAY_BADGE[o.payment_status] || '') + '</td>'
          + '<td><button class="btn ok" style="padding:4px 10px;font-size:12px;" '
          + 'onclick="openPaymentModal(\'' + esc(String(o.id)) + '\',' + (parseFloat(o.pret) || 0) + ',' + (parseFloat(o.paid_amount) || 0) + ')">💰 Fizetés</button></td>'
          + '</tr>';
      }).join('') || '<tr><td colspan="9" class="text-muted" style="text-align:center;padding:18px;">Nincs kintlévőség. 🎉</td></tr>';

      box.innerHTML = stFilterBar('stats-finance')
        + '<div class="dash-stats" style="margin-bottom:16px;">'
        + stTile('💶', stNum(m.bevetel, 0) + ' <span style="font-size:13px;">EUR</span>', 'Bevétel (lezárt)')
        + stTile('💰', stNum(beszedett, 0) + ' <span style="font-size:13px;">EUR</span>', 'Beszedett', 'var(--status-ok)')
        + stTile('⏳', stNum(kintlevoTotal, 0) + ' <span style="font-size:13px;">EUR</span>', 'Teljes kintlévőség', 'var(--status-danger)')
        + stTile('📏', stNum(m.per_km, 2) + ' EUR/km', 'Átlag fuvardíj / km')
        + stTile('⌛', m.atlag_fizetesi_nap != null ? stNum(m.atlag_fizetesi_nap, 0) + ' nap' : '—', 'Átlagos fizetési idő')
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;">'
        + stPanel('📊 Bevétel vs. beszedett (EUR / hó)', stChartCanvas('stChFinHavi'))
        + stPanel('⏰ Kintlévőség öregedése (a teljesítés óta)',
            '<div class="dash-veh-grid">'
            + '<div class="dash-mini glass-soft"><div style="font-size:20px;">🟢</div><div style="font-size:22px;font-weight:800;color:var(--status-warn);">' + stNum(ag.d0_30, 0) + '</div><div class="text-muted" style="font-size:11px;">0–30 nap (EUR)</div></div>'
            + '<div class="dash-mini glass-soft"><div style="font-size:20px;">🟠</div><div style="font-size:22px;font-weight:800;color:var(--status-warn);">' + stNum(ag.d31_60, 0) + '</div><div class="text-muted" style="font-size:11px;">31–60 nap (EUR)</div></div>'
            + '<div class="dash-mini glass-soft"><div style="font-size:20px;">🔴</div><div style="font-size:22px;font-weight:800;color:var(--status-danger);">' + stNum(ag.d60p, 0) + '</div><div class="text-muted" style="font-size:11px;">60+ nap (EUR)</div></div>'
            + '</div>')
        + '</div>'
        + stPanel('📋 Kintlévő fuvarok', '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>Fuvar</th><th>Ügyfél</th><th style="text-align:right;">Ár (EUR)</th><th style="text-align:right;">Fizetve</th><th style="text-align:right;">Hátralék</th><th>Teljesítve</th><th style="text-align:center;">Esedékes</th><th>Státusz</th><th></th></tr></thead>'
            + '<tbody>' + listRows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-finance\')">⬇️ CSV export</button>')
        + '<div id="stProfitBox"></div>';

      loadOrderProfit();

      var months = stMonths([r.havi]);
      stChart('stChFinHavi', {
        type: 'bar',
        data: { labels: months, datasets: [
          { label: 'Bevétel (EUR)', data: stSeries(months, r.havi, 'bevetel'), backgroundColor: 'rgba(225,11,26,0.65)' },
          { label: 'Beszedett (EUR)', data: stSeries(months, r.havi, 'beszedett'), backgroundColor: 'rgba(34,197,94,0.65)' }
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
      box.innerHTML = stPanel('🎯 Fuvar-szintű eredmény (a menetlevél-költségek fuvaronként szétosztva)',
        '<p class="text-muted" style="font-size:12px;margin:0 0 10px;">A tankolás/vásárlás-költség a menetlevélen szereplő fuvarok között egyenlően oszlik; az <b style="color:#fbbf24;">útdíj</b> (EUR) is levonódik az eredményből — közelítő érték.'
        + (rate ? '' : ' <b>Állíts be árfolyamot az Áttekintésen az Eredmény-oszlophoz.</b>') + '</p>'
        + '<div style="overflow-x:auto;"><table class="table">'
        + '<thead><tr><th>Fuvar</th><th>Ügyfél</th><th>Teljesítve</th><th style="text-align:right;">Km</th><th style="text-align:right;">Bevétel (EUR)</th><th style="text-align:right;">Útdíj (EUR)</th><th style="text-align:right;">Alváll. (EUR)</th><th style="text-align:right;">Költség (RON)</th>'
        + (rate ? '<th style="text-align:right;">Eredmény (EUR)</th>' : '') + '</tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>');
    }).catch(function () { box.innerHTML = ''; });
  }

  // ════════════════════════════════════════════════════════
  //  3) FOGYASZTÁS (stats-fuel)
  // ════════════════════════════════════════════════════════
  function loadFuel() {
    var box = document.getElementById('statsFuelBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-fuel') + '<div class="text-muted" style="padding:30px;text-align:center;">Betöltés...</div>';
    gas('getFuelStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-fuel') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || 'Hiba') + '</div>'; return; }
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
      }).join('') || '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:18px;">Nincs adat az időszakban.</td></tr>';

      var fillRows = (r.lista || []).map(function (a) {
        return '<tr><td>' + stDate(a.data_completare) + '</td>'
          + '<td>' + esc(a.nume_sofer || '—') + '</td>'
          + '<td>' + esc(a.numar_camion || '—') + '</td>'
          + '<td>' + esc(a.loc || '—') + '</td>'
          + '<td>' + esc(a.tip || '—') + '</td>'
          + '<td style="text-align:right;">' + stNum(a.litru, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(a.suma, 0) + '</td>'
          + '<td>' + esc(a.plata || '—') + '</td></tr>';
      }).join('') || '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:18px;">Nincs tankolás az időszakban.</td></tr>';

      box.innerHTML = stFilterBar('stats-fuel')
        + '<div class="dash-stats" style="margin-bottom:16px;">'
        + stTile('⛽', stNum(totL, 0) + ' L', 'Tankolt motorină')
        + stTile('💸', stNum(totS, 0) + ' RON', 'Üzemanyag-költség')
        + stTile('🏷️', stNum(avgPrice, 2) + ' RON/L', 'Átlagár')
        + stTile('📉', stNum(fleetAvg, 1) + ' L/100km', 'Flotta átlagfogyasztás')
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;">'
        + stPanel('📊 Havi tankolás (RON)', stChartCanvas('stChFuelHavi'))
        + stPanel('💳 Fizetési mód megoszlás (tankolás)', stChartCanvas('stChFuelPlata'))
        + '</div>'
        + stPanel('🚛 Járművenkénti fogyasztás — tényleges vs. névleges',
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>Rendszám</th><th style="text-align:right;">Km</th><th style="text-align:right;">Motorină (L)</th><th style="text-align:right;">Tényl. L/100km</th><th style="text-align:right;">Névleges</th><th style="text-align:center;">Eltérés</th><th style="text-align:right;">Menetlevél</th></tr></thead>'
            + '<tbody>' + vehRows + '</tbody></table></div>')
        + stPanel('🧾 Tankolások (utolsó 100)',
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>Dátum</th><th>Sofőr</th><th>Jármű</th><th>Hely</th><th>Típus</th><th style="text-align:right;">Liter</th><th style="text-align:right;">Összeg (RON)</th><th>Fizetés</th></tr></thead>'
            + '<tbody>' + fillRows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-fuel\')">⬇️ CSV export</button>');

      var months = stMonths([r.havi]);
      var motorina = r.havi.filter(function (h) { return h.tip !== 'AdBlue'; });
      var adblue = r.havi.filter(function (h) { return h.tip === 'AdBlue'; });
      stChart('stChFuelHavi', {
        type: 'bar',
        data: { labels: months, datasets: [
          { label: 'Motorină (RON)', data: stSeries(months, motorina, 'suma'), backgroundColor: 'rgba(245,158,11,0.7)', stack: 'f' },
          { label: 'AdBlue (RON)', data: stSeries(months, adblue, 'suma'), backgroundColor: 'rgba(59,130,246,0.7)', stack: 'f' }
        ]},
        options: { scales: { x: { stacked: true }, y: { stacked: true } } }
      });
      stChart('stChFuelPlata', {
        type: 'doughnut',
        data: {
          labels: (r.fizetesi_mod || []).map(function (p) { return p.plata; }),
          datasets: [{ data: (r.fizetesi_mod || []).map(function (p) { return parseFloat(p.suma) || 0; }),
            backgroundColor: ['#e10b1a', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#8a97a8'] }]
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
    box.innerHTML = stFilterBar('stats-purchases') + '<div class="text-muted" style="padding:30px;text-align:center;">Betöltés...</div>';
    gas('getPurchaseStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-purchases') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || 'Hiba') + '</div>'; return; }
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
      }).join('') || '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:18px;">Nincs vásárlás az időszakban.</td></tr>';

      var soferRows = (r.soforok || []).map(function (s) {
        return '<tr><td>' + esc(s.sofer || '—') + '</td>'
          + '<td style="text-align:right;">' + stNum(s.db, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(s.suma, 0) + '</td></tr>';
      }).join('') || '<tr><td colspan="3" class="text-muted" style="text-align:center;padding:14px;">Nincs adat.</td></tr>';

      box.innerHTML = stFilterBar('stats-purchases')
        + '<div class="dash-stats" style="margin-bottom:16px;">'
        + stTile('🛒', stNum(totS, 0) + ' RON', 'Összes sofőr-költés')
        + stTile('🧾', stNum(totDb, 0), 'Tétel (vásárlás)')
        + stTile('💵', cashRow ? stNum(cashRow.suma, 0) + ' RON' : '0 RON', 'Ebből készpénz (elszámolandó)', 'var(--status-warn)')
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;">'
        + stPanel('📊 Havi költés (RON)', stChartCanvas('stChPurHavi'))
        + stPanel('🏷️ Top termékek / szolgáltatások', stChartCanvas('stChPurTermek'))
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;">'
        + stPanel('👤 Sofőrönkénti költés (RON)',
            '<div style="overflow-x:auto;"><table class="table"><thead><tr><th>Sofőr</th><th style="text-align:right;">Tétel</th><th style="text-align:right;">Összeg (RON)</th></tr></thead><tbody>' + soferRows + '</tbody></table></div>')
        + stPanel('💳 Fizetési mód', stChartCanvas('stChPurPlata'))
        + '</div>'
        + stPanel('🧾 Vásárlások (utolsó 100)',
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>Dátum</th><th>Sofőr</th><th>Jármű</th><th>Termék</th><th>Hely</th><th style="text-align:right;">Ár (RON)</th><th>Fizetés</th></tr></thead>'
            + '<tbody>' + listRows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-purchases\')">⬇️ CSV export</button>');

      var months = stMonths([r.havi]);
      stChart('stChPurHavi', {
        type: 'bar',
        data: { labels: months, datasets: [{ label: 'Költés (RON)', data: stSeries(months, r.havi, 'suma'), backgroundColor: 'rgba(59,130,246,0.7)' }] }
      });
      stChart('stChPurTermek', {
        type: 'bar',
        data: {
          labels: (r.termekek || []).map(function (t) { return t.produs; }),
          datasets: [{ label: 'Összeg (RON)', data: (r.termekek || []).map(function (t) { return parseFloat(t.suma) || 0; }), backgroundColor: 'rgba(168,85,247,0.7)' }]
        },
        options: { indexAxis: 'y' }
      });
      stChart('stChPurPlata', {
        type: 'doughnut',
        data: {
          labels: (r.fizetesi_mod || []).map(function (p) { return p.plata; }),
          datasets: [{ data: (r.fizetesi_mod || []).map(function (p) { return parseFloat(p.suma) || 0; }),
            backgroundColor: ['#e10b1a', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#8a97a8'] }]
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
    box.innerHTML = stFilterBar('stats-drivers') + '<div class="text-muted" style="padding:30px;text-align:center;">Betöltés...</div>';
    gas('getDriverStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-drivers') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || 'Hiba') + '</div>'; return; }
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
      }).join('') || '<tr><td colspan="11" class="text-muted" style="text-align:center;padding:18px;">Nincs adat az időszakban.</td></tr>';

      box.innerHTML = stFilterBar('stats-drivers')
        + stPanel('🏆 Top sofőrök bevétel szerint (EUR)', stChartCanvas('stChDrvTop'))
        + stPanel('👤 Sofőr teljesítmény-tábla',
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>Sofőr</th><th style="text-align:right;">Fuvar</th><th style="text-align:right;">Lezárt</th><th style="text-align:right;">Bevétel (EUR)</th><th style="text-align:right;">Km (menetlevél)</th><th style="text-align:right;">L/100km</th><th style="text-align:right;">Üzemanyag (RON)</th><th style="text-align:right;">Vásárlás (RON)</th>'
            + (rate ? '<th style="text-align:right;">Eredmény (EUR)</th>' : '')
            + '<th style="text-align:center;">Diurna K/B</th><th style="text-align:right;">Menetlevél</th></tr></thead>'
            + '<tbody>' + rows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-drivers\')">⬇️ CSV export</button>');

      var top = list.slice(0, 10);
      stChart('stChDrvTop', {
        type: 'bar',
        data: {
          labels: top.map(function (s) { return s.nume || s.email; }),
          datasets: [{ label: 'Bevétel (EUR)', data: top.map(function (s) { return parseFloat(s.bevetel) || 0; }), backgroundColor: 'rgba(225,11,26,0.7)' }]
        },
        options: { indexAxis: 'y' }
      });
    });
  }

  // ════════════════════════════════════════════════════════
  //  6) JÁRMŰ KIHASZNÁLTSÁG (stats-vehicles) + GPS pillanatkép
  // ════════════════════════════════════════════════════════
  function loadVehiclesStats() {
    var box = document.getElementById('statsVehiclesBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-vehicles') + '<div class="text-muted" style="padding:30px;text-align:center;">Betöltés...</div>';
    gas('getVehicleStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-vehicles') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || 'Hiba') + '</div>'; return; }
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
          + '<td style="text-align:center;">' + (v.activ === false ? '<span class="badge err">Álló</span>' : '<span class="badge ok">Aktív</span>') + '</td>'
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
      }).join('') || '<tr><td colspan="12" class="text-muted" style="text-align:center;padding:18px;">Nincs adat az időszakban.</td></tr>';

      box.innerHTML = stFilterBar('stats-vehicles')
        + '<div id="stGpsSnapshotBox"></div>'
        + '<div id="stGpsKmBox"></div>'
        + stPanel('🏆 Top járművek bevétel szerint (EUR)', stChartCanvas('stChVehTop'))
        + stPanel('🚛 Jármű-tábla',
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>Jármű</th><th style="text-align:center;">Állapot</th><th style="text-align:right;">Fuvar</th><th style="text-align:right;">Lezárt</th><th style="text-align:right;">Bevétel (EUR)</th><th style="text-align:right;">EUR/km</th><th style="text-align:right;">Km (menetlevél)</th><th style="text-align:right;">Üzemanyag (RON)</th><th style="text-align:right;">Szerviz (RON)</th>'
            + (rate ? '<th style="text-align:right;">Eredmény (EUR)</th>' : '')
            + '<th style="text-align:right;">L/100km</th><th style="text-align:center;">Eltérés</th></tr></thead>'
            + '<tbody>' + rows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-vehicles\')">⬇️ CSV export</button>');

      var top = list.filter(function (v) { return (parseFloat(v.bevetel) || 0) > 0; }).slice(0, 10);
      stChart('stChVehTop', {
        type: 'bar',
        data: {
          labels: top.map(function (v) { return v.rendszam_eredeti || v.rendszam; }),
          datasets: [{ label: 'Bevétel (EUR)', data: top.map(function (v) { return parseFloat(v.bevetel) || 0; }), backgroundColor: 'rgba(34,197,94,0.7)' }]
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
          + '<td class="text-muted" style="text-align:right;font-size:12px;">' + stNum(x.napok, 0) + ' nap</td></tr>';
      }).join('');
      box.innerHTML = stPanel('🛰️ GPS-km vs. menetlevél-km (napi km-óra naplóból)',
        '<div style="overflow-x:auto;"><table class="table">'
        + '<thead><tr><th>Rendszám</th><th style="text-align:right;">GPS-km</th><th style="text-align:right;">Sofőr beírta</th><th style="text-align:right;">Eltérés</th><th style="text-align:center;">%</th><th style="text-align:right;">Mérési napok</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>'
        + '<div class="text-muted" style="font-size:11px;margin-top:6px;">A GPS-km a napi automatikus km-óra snapshotokból számolódik — az első adatok a bekapcsolás utáni 2. naptól jelennek meg.</div>');
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
          + '<td style="text-align:center;">' + (ign ? '<span class="badge ok">Jár</span>' : '<span class="badge info">Áll</span>') + '</td>'
          + '<td style="text-align:right;">' + (v.speed != null ? stNum(v.speed, 0) + ' km/h' : '—') + '</td>'
          + '<td style="text-align:right;">' + (v.fuel_level != null ? stNum(v.fuel_level, 0) + ' L' : '—') + '</td>'
          + '<td style="text-align:right;">' + (v.mileage != null ? stNum(v.mileage, 0) + ' km' : '—') + '</td>'
          + '<td style="text-align:right;">' + (v.fuel_consumption != null ? stNum(v.fuel_consumption, 1) : '—') + '</td>'
          + '<td class="text-muted" style="font-size:12px;">' + (v.datetime ? new Date(v.datetime).toLocaleString('hu-HU') : '—') + '</td></tr>';
      }).join('');
      box.innerHTML = stPanel('🛰️ Élő flotta-adatok (CargoTrack GPS)',
        '<div style="overflow-x:auto;"><table class="table">'
        + '<thead><tr><th>Jármű</th><th style="text-align:center;">Gyújtás</th><th style="text-align:right;">Sebesség</th><th style="text-align:right;">Üzemanyag-szint</th><th style="text-align:right;">Km-óra (GPS)</th><th style="text-align:right;">Fogyasztás</th><th>Utolsó jel</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>'
        + '<div class="text-muted" style="font-size:11px;margin-top:8px;">Az üzemanyag-szint / km-óra csak akkor jelenik meg, ha a GPS-eszköz méri (CAN-bus kapcsolat).</div>');
    }).catch(function () { box.innerHTML = ''; });
  }

  // ════════════════════════════════════════════════════════
  //  7) ÜGYFÉL RIPORT (stats-clients)
  // ════════════════════════════════════════════════════════
  function loadClients() {
    var box = document.getElementById('statsClientsBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-clients') + '<div class="text-muted" style="padding:30px;text-align:center;">Betöltés...</div>';
    gas('getClientStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-clients') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || 'Hiba') + '</div>'; return; }
      _stData['stats-clients'] = r;
      var list = r.ugyfelek || [];
      var fin = !!r.finance;

      var rows = list.map(function (u) {
        var anaf = u.anaf_status === 'activ' ? '<span class="badge ok">ANAF aktív</span>'
          : u.anaf_status === 'inactiv' ? '<span class="badge err">ANAF inaktív</span>' : '';
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
      }).join('') || '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:18px;">Nincs adat az időszakban.</td></tr>';

      box.innerHTML = stFilterBar('stats-clients')
        + stPanel('🏆 Top ügyfelek bevétel szerint (EUR)', stChartCanvas('stChCliTop'))
        + stPanel('🤝 Ügyfél-tábla',
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>Ügyfél</th><th>ANAF</th><th style="text-align:right;">Fuvar</th><th style="text-align:right;">Lezárt</th><th style="text-align:right;">Bevétel (EUR)</th><th style="text-align:right;">Km</th>'
            + (fin ? '<th style="text-align:right;">Kintlévő (EUR)</th><th style="text-align:center;">Átl. fizetési idő</th>' : '')
            + '</tr></thead><tbody>' + rows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-clients\')">⬇️ CSV export</button>');

      var top = list.slice(0, 10);
      stChart('stChCliTop', {
        type: 'bar',
        data: {
          labels: top.map(function (u) { return u.ugyfel; }),
          datasets: [{ label: 'Bevétel (EUR)', data: top.map(function (u) { return parseFloat(u.bevetel) || 0; }), backgroundColor: 'rgba(59,130,246,0.7)' }]
        },
        options: { indexAxis: 'y' }
      });
    });
  }

  // ════════════════════════════════════════════════════════
  //  8) JOGOSULTSÁGOK (stats-permissions) — CSAK ADMIN
  // ════════════════════════════════════════════════════════
  function loadPermissions() {
    var box = document.getElementById('statsPermissionsBox');
    if (!box) return;
    box.innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">Betöltés...</div>';
    gas('getStatsPermissions').then(function (r) {
      if (!r || !r.ok) { box.innerHTML = '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || 'Hiba') + '</div>'; return; }
      var rows = (r.users || []).map(function (u) {
        return '<tr><td><b class="text-primary">' + esc(u.nume || '—') + '</b></td>'
          + '<td>' + esc(u.email) + '</td>'
          + '<td><span class="badge info">' + esc(u.pozicio) + '</span></td>'
          + '<td style="text-align:center;">'
          + '<label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;">'
          + '<input type="checkbox" ' + (u.finance_enabled ? 'checked' : '') + ' style="width:18px;height:18px;cursor:pointer;accent-color:#22c55e;" '
          + 'onchange="VS_STATS.setPerm(' + u.id + ', this.checked)">'
          + '<span style="font-size:12px;" class="text-muted">Pénzügy látható</span></label>'
          + '</td></tr>';
      }).join('') || '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:18px;">Nincs Manager felhasználó a cégben.</td></tr>';

      box.innerHTML = stPanel('🔐 Pénzügyi riport láthatósága',
        '<p class="text-muted" style="font-size:13px;margin:0 0 14px;">Itt adhatsz engedélyt a Manager munkatársaknak a <b>Pénzügy</b> riport (bevétel, beszedett, kintlévőség) megtekintésére. Admin mindig lát mindent; engedély nélkül a Manager a Pénzügy fület és a pénzügyi oszlopokat nem látja.</p>'
        + '<div style="overflow-x:auto;"><table class="table">'
        + '<thead><tr><th>Név</th><th>E-mail</th><th>Pozíció</th><th style="text-align:center;">Engedély</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>');
    });
  }

  function setPerm(userId, enabled) {
    gas('setStatsPermission', [userId, enabled]).then(function (r) {
      if (r && r.ok) toast(enabled ? '✅ Engedély megadva' : 'Engedély visszavonva', 'ok');
      else { toast((r && r.err) || 'Hiba', 'err'); loadPermissions(); }
    });
  }

  // ── CSV exportok (az utoljára betöltött adatból) ────────
  function csvExport(pane) {
    var r = _stData[pane];
    if (!r) { toast('Előbb töltsd be az adatokat!', 'err'); return; }
    var stamp = new Date().toISOString().slice(0, 10);
    if (pane === 'stats-finance') {
      stCsv('kintlevoseg-' + stamp + '.csv',
        ['Fuvar', 'Ügyfél', 'Ár (EUR)', 'Fizetve', 'Hátralék', 'Teljesítve', 'Eltelt nap', 'Státusz'],
        (r.kintlevo_lista || []).map(function (o) {
          return [o.id, o.client, o.pret, o.paid_amount, (parseFloat(o.pret) || 0) - (parseFloat(o.paid_amount) || 0), stDate(o.finalized_at), o.napok, o.payment_status];
        }));
    } else if (pane === 'stats-fuel') {
      stCsv('tankolasok-' + stamp + '.csv',
        ['Dátum', 'Sofőr', 'Jármű', 'Hely', 'Típus', 'Liter', 'Összeg (RON)', 'Fizetés'],
        (r.lista || []).map(function (a) { return [stDate(a.data_completare), a.nume_sofer, a.numar_camion, a.loc, a.tip, a.litru, a.suma, a.plata]; }));
    } else if (pane === 'stats-purchases') {
      stCsv('vasarlasok-' + stamp + '.csv',
        ['Dátum', 'Sofőr', 'Jármű', 'Termék', 'Hely', 'Ár (RON)', 'Fizetés'],
        (r.lista || []).map(function (c) { return [stDate(c.data_completare), c.nume_sofer, c.numar_camion, c.produs, c.loc, c.pret, c.plata]; }));
    } else if (pane === 'stats-drivers') {
      var dRate = parseFloat(r.eur_ron_rate) || null;
      stCsv('sofor-teljesitmeny-' + stamp + '.csv',
        ['Sofőr', 'E-mail', 'Fuvar', 'Lezárt', 'Bevétel (EUR)', 'Km (menetlevél)', 'L/100km', 'Üzemanyag (RON)', 'Vásárlás (RON)', 'Eredmény (EUR)', 'Diurna külső', 'Diurna belső', 'Menetlevél'],
        (r.soforok || []).map(function (s) {
          var p = dRate ? Math.round((parseFloat(s.bevetel) || 0) - ((parseFloat(s.uzemanyag_ktg) || 0) + (parseFloat(s.vasarlas_ktg) || 0)) / dRate) : '';
          return [s.nume, s.email, s.fuvarok, s.lezart, s.bevetel, s.total_km, s.consum_100, s.uzemanyag_ktg, s.vasarlas_ktg, p, s.diurna_ext, s.diurna_int, s.menetlevelek];
        }));
    } else if (pane === 'stats-vehicles') {
      var vRate = parseFloat(r.eur_ron_rate) || null;
      stCsv('jarmu-kihasznaltsag-' + stamp + '.csv',
        ['Rendszám', 'Márka', 'Fuvar', 'Lezárt', 'Bevétel (EUR)', 'EUR/km', 'Km (menetlevél)', 'Üzemanyag (RON)', 'Szerviz (RON)', 'Eredmény (EUR)', 'L/100km', 'Névleges'],
        (r.jarmuvek || []).map(function (v) {
          var p = vRate ? Math.round((parseFloat(v.bevetel) || 0) - ((parseFloat(v.uzemanyag_ktg) || 0) + (parseFloat(v.szerviz_ktg) || 0)) / vRate) : '';
          return [v.rendszam_eredeti || v.rendszam, (v.marca || '') + ' ' + (v.model || ''), v.fuvarok, v.lezart, v.bevetel, v.bevetel_per_km, v.total_km, v.uzemanyag_ktg, v.szerviz_ktg, p, v.consum_100, v.nevleges];
        }));
    } else if (pane === 'stats-clients') {
      stCsv('ugyfel-riport-' + stamp + '.csv',
        ['Ügyfél', 'CUI', 'Fuvar', 'Lezárt', 'Bevétel (EUR)', 'Km', 'Kintlévő (EUR)', 'Átl. fizetési nap'],
        (r.ugyfelek || []).map(function (u) { return [u.ugyfel, u.cui_cif, u.fuvarok, u.lezart, u.bevetel, u.km, u.kintlevo, u.atlag_fizetesi_nap]; }));
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
      var t = (document.getElementById('stTo') || {}).value;
      if (!f || !t) { toast('Add meg a kezdő és záró dátumot!', 'err'); return; }
      _stRange.preset = 'custom'; _stRange.from = f; _stRange.to = t;
      VS_STATS.load(pane);
    },
    csv: csvExport,
    setPerm: setPerm,
    applyPerms: applyPerms,
    saveRate: function () {
      var v = (document.getElementById('stEurRon') || {}).value;
      gas('setEurRonRate', [v === '' ? null : v]).then(function (r) {
        if (r && r.ok) { toast('💱 Árfolyam mentve', 'ok'); VS_STATS.load('stats-overview'); }
        else toast((r && r.err) || 'Hiba', 'err');
      });
    },
    fetchBnr: function () {
      gas('getBnrRate').then(function (r) {
        if (r && r.ok) {
          var inp = document.getElementById('stEurRon');
          if (inp) inp.value = r.rate;
          toast('🏦 BNR árfolyam (' + (r.date || 'ma') + '): ' + r.rate + ' — kattints a Mentésre!', 'ok');
        } else toast((r && r.err) || 'A BNR nem elérhető', 'err');
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
