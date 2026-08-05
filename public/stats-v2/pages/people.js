// ============================================================
//  VallorSoft — Statisztika 2.0 — 👥 Emberek fül
//  3 belső tab:
//    1. Sofőrök — teljesítmény + fogyasztás-összehasonlítás (egy táblában)
//    2. Ügyfelek — bevétel + fuvarok + kintlévőség + átlag fizetési nap
//    3. Alvállalkozók — bevétel + darabszám (az AP a Pénzügy fül alatt)
//
//  Nincs új szerver-út — getDriverStats + getClientStats
//  + getSoferConsumptionOverview.  Oszlop-keresés a tábla fölött.
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

  var _subTab = 'drivers';
  var _lastData = null;
  var _searchFilter = '';

  function fnum(n, dec) {
    var v = parseFloat(n);
    if (!isFinite(v)) return '—';
    return v.toLocaleString('hu-HU', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 2 : dec });
  }
  function avatar(name) {
    var initials = String(name || '?')
      .split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (w) { return w[0]; }).join('').toUpperCase() || '?';
    // Determinisztikus szín-index a névből
    var hash = 0;
    for (var i = 0; i < String(name || '').length; i++) hash = ((hash << 5) - hash) + String(name).charCodeAt(i);
    var colors = ['#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6'];
    var c = colors[Math.abs(hash) % colors.length];
    return '<span class="sv2-avatar" style="background:' + c + '">' + $esc(initials) + '</span>';
  }

  function subTabsBar() {
    var tabs = [
      ['drivers',   '👤 ' + $t('sv2.pp.tDrivers')],
      ['clients',   '🏢 ' + $t('sv2.pp.tClients')],
      ['carriers',  '🚚 ' + $t('sv2.pp.tCarriers')],
    ];
    return '<div class="sv2-subtabs">' + tabs.map(function (tp) {
      return '<button class="sv2-subtab' + (_subTab === tp[0] ? ' active' : '') + '" onclick="VS_STATS_V2_PP._sub(\'' + tp[0] + '\')">' + tp[1] + '</button>';
    }).join('') + '</div>';
  }

  function render(box, state) {
    box.innerHTML = subTabsBar() + '<div class="sv2-empty">' + $t('sv2.ov.loading') + '</div>';
    var apArgs = { from: state.range.from, to: state.range.to };
    Promise.all([
      gas('getDriverStats', apArgs),
      gas('getClientStats', apArgs),
      gas('getSoferConsumptionOverview').catch(function () { return null; }),
    ]).then(function (rs) {
      _lastData = { drv: rs[0] || {}, cli: rs[1] || {}, drvCons: rs[2], state: state };
      renderInto(box);
    });
  }

  function renderInto(box) {
    if (!_lastData) return;
    var html = subTabsBar();
    if (_subTab === 'drivers') html += renderDrivers(_lastData);
    else if (_subTab === 'clients') html += renderClients(_lastData);
    else html += renderCarriers(_lastData);
    box.innerHTML = html;
  }

  function searchBox(placeholder) {
    return '<div class="sv2-panel" style="padding:10px 14px;margin-bottom:10px;">'
      + '<input class="input" placeholder="' + $esc(placeholder) + '" value="' + $esc(_searchFilter) + '" '
      + 'oninput="VS_STATS_V2_PP._search(this.value)" style="width:100%;">'
      + '</div>';
  }

  // ── 1. Sofőrök ─────────────────────────────────────────
  function renderDrivers(d) {
    if (!d.drv.ok) return '<div class="sv2-empty">' + $esc(d.drv.err || $t('common.error')) + '</div>';
    var soforok = d.drv.soforok || [];
    var rate = parseFloat(d.drv.eur_ron_rate) || null;

    // Fogyasztás-összehasonlítás összefésülés
    var cons = (d.drvCons && d.drvCons.ok) ? d.drvCons : null;
    var consMap = {};
    if (cons) {
      (cons.sofers || []).forEach(function (s) { consMap[String(s.email || '').toLowerCase()] = s; });
    }
    var cmpAvg = cons ? parseFloat(cons.company_avg) || 0 : 0;
    var cmpThreshold = cons ? parseFloat(cons.threshold) || 2.5 : 2.5;

    var filter = _searchFilter.toLowerCase();
    var rows = soforok.filter(function (s) {
      if (!filter) return true;
      return String(s.nume || '').toLowerCase().indexOf(filter) >= 0
        || String(s.email || '').toLowerCase().indexOf(filter) >= 0;
    }).map(function (s) {
      var name = s.nume || s.email;
      var bev = parseFloat(s.bevetel) || 0;
      // Költség RON, bevétel EUR — profit csak árfolyammal
      var uzem = parseFloat(s.uzemanyag_ktg) || 0;
      var vas = parseFloat(s.vasarlas_ktg) || 0;
      var profit = rate ? Math.round(bev - (uzem + vas) / rate) : null;

      // Fogyasztás-eltérés
      var c = consMap[String(s.email || '').toLowerCase()];
      var avgCurr = c ? parseFloat(c.avg_curr) || null : null;
      var deviation = (avgCurr && cmpAvg) ? Math.round((avgCurr - cmpAvg) * 10) / 10 : null;
      var devClass = deviation != null && Math.abs(deviation) > cmpThreshold ? 'warn' : '';

      return '<tr>'
        + '<td>' + avatar(name) + '<span style="margin-left:8px;font-weight:600;">' + $esc(name) + '</span></td>'
        + '<td style="text-align:right;">' + fnum(s.fuvarok, 0) + '</td>'
        + '<td style="text-align:right;">' + fnum(s.lezart, 0) + '</td>'
        + '<td style="text-align:right;">' + fnum(s.total_km, 0) + '</td>'
        + '<td style="text-align:right;font-weight:700;">' + fnum(bev, 0) + '</td>'
        + '<td style="text-align:right;">' + fnum(s.consum_100, 1) + '</td>'
        + '<td style="text-align:right;' + (devClass ? 'background:rgba(245,158,11,0.14);' : '') + '">'
        +   (deviation != null ? (deviation > 0 ? '+' : '') + deviation + (devClass ? ' ⚠️' : '') : '—')
        + '</td>'
        + '<td style="text-align:right;">' + (profit != null ? fnum(profit, 0) : '—') + '</td>'
        + '</tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:14px;">' + $t('sv2.ov.noData') + '</td></tr>';

    var kpiHtml = ''
      + '<div class="sv2-kpi-grid">'
      +   sv2Kpi('👤 ' + $t('sv2.pp.kActive'), fnum(soforok.length, 0), '', '#6366f1')
      +   sv2Kpi('💶 ' + $t('sv2.pp.kRev'),
              fnum(soforok.reduce(function (s, x) { return s + (parseFloat(x.bevetel) || 0); }, 0), 0)
              + ' <span style="font-size:12px;">EUR</span>', '', '#22c55e')
      +   sv2Kpi('⛽ ' + $t('sv2.pp.kAvgConsum'),
              cons ? fnum(cmpAvg, 1) + ' <span style="font-size:12px;">L/100km</span>' : '—',
              cons ? $t('sv2.pp.kAvgConsumSub', { n: cmpThreshold }) : '', '#f59e0b')
      + '</div>';

    // Export (PR #9)
    var exportBtn = window.VS_STATS_V2_EXPORT ? VS_STATS_V2_EXPORT.button({
      data: soforok.map(function (s) {
        return {
          nev: s.nume || s.email,
          fuvar: s.fuvarok, lezart: s.lezart,
          km: s.total_km, bevetel: s.bevetel,
          consum_100: s.consum_100,
        };
      }),
      columns: [
        { key: 'nev', label: 'Șofer' }, { key: 'fuvar', label: 'Curse' },
        { key: 'lezart', label: 'Finalizate' }, { key: 'km', label: 'Km' },
        { key: 'bevetel', label: 'Venit (EUR)' }, { key: 'consum_100', label: 'L/100km' },
      ],
      filename: 'soferi-' + new Date().toISOString().slice(0, 10) + '.csv',
    }) : '';

    return kpiHtml + searchBox($t('sv2.pp.searchDrivers'))
      + '<div class="sv2-panel">'
      +   '<div class="sv2-panel-head"><div class="sv2-panel-title">👤 ' + $t('sv2.pp.pDrivers') + '</div>'
      +     '<div style="display:flex;gap:8px;">' + exportBtn + '</div>'
      +   '</div>'
      +   '<div style="overflow-x:auto;"><table class="table">'
      +     '<thead><tr>'
      +       '<th>' + $t('sv2.pp.cDriver') + '</th>'
      +       '<th style="text-align:right;">' + $t('sv2.pp.cOrders') + '</th>'
      +       '<th style="text-align:right;">' + $t('st.cClosed') + '</th>'
      +       '<th style="text-align:right;">Km</th>'
      +       '<th style="text-align:right;">' + $t('sv2.pp.cRev') + '</th>'
      +       '<th style="text-align:right;">L/100km</th>'
      +       '<th style="text-align:right;">Δ ' + $t('sv2.pp.vsAvg') + '</th>'
      +       '<th style="text-align:right;">' + $t('sv2.pp.cProfit') + '</th>'
      +     '</tr></thead>'
      +     '<tbody>' + rows + '</tbody></table></div>'
      + '</div>';
  }

  // ── 2. Ügyfelek ────────────────────────────────────────
  function renderClients(d) {
    if (!d.cli.ok) return '<div class="sv2-empty">' + $esc(d.cli.err || $t('common.error')) + '</div>';
    var ug = d.cli.ugyfelek || [];
    var finance = !!d.cli.finance;

    var filter = _searchFilter.toLowerCase();
    var rows = ug.filter(function (c) {
      if (!filter) return true;
      return String(c.ugyfel || '').toLowerCase().indexOf(filter) >= 0
        || String(c.cui_cif || '').toLowerCase().indexOf(filter) >= 0;
    }).map(function (c) {
      return '<tr>'
        + '<td>' + avatar(c.ugyfel) + '<span style="margin-left:8px;font-weight:600;">' + $esc(c.ugyfel || '?') + '</span>'
        +   (c.cui_cif ? ' <span class="text-muted" style="font-size:11px;">' + $esc(c.cui_cif) + '</span>' : '') + '</td>'
        + '<td style="text-align:right;">' + fnum(c.fuvarok, 0) + '</td>'
        + '<td style="text-align:right;">' + fnum(c.lezart, 0) + '</td>'
        + '<td style="text-align:right;">' + fnum(c.km, 0) + '</td>'
        + '<td style="text-align:right;font-weight:700;">' + fnum(c.bevetel, 0) + '</td>'
        + (finance ? '<td style="text-align:right;color:var(--sv2-danger);">' + (c.kintlevo != null ? fnum(c.kintlevo, 0) : '—') + '</td>' : '')
        + (finance ? '<td style="text-align:right;">' + (c.atlag_fizetesi_nap != null ? fnum(c.atlag_fizetesi_nap, 0) + ' ' + $t('sv2.fl.days') : '—') + '</td>' : '')
        + '</tr>';
    }).join('');
    var colCount = finance ? 7 : 5;
    if (!rows) rows = '<tr><td colspan="' + colCount + '" class="text-muted" style="text-align:center;padding:14px;">' + $t('sv2.ov.noData') + '</td></tr>';

    var kpiHtml = ''
      + '<div class="sv2-kpi-grid">'
      +   sv2Kpi('🏢 ' + $t('sv2.pp.kClients'), fnum(ug.length, 0), '', '#3b82f6')
      +   sv2Kpi('💶 ' + $t('sv2.pp.kRev'),
              fnum(ug.reduce(function (s, x) { return s + (parseFloat(x.bevetel) || 0); }, 0), 0)
              + ' <span style="font-size:12px;">EUR</span>', '', '#22c55e')
      +   (finance ? sv2Kpi('⏳ ' + $t('sv2.pp.kOutstanding'),
              fnum(ug.reduce(function (s, x) { return s + (parseFloat(x.kintlevo) || 0); }, 0), 0)
              + ' <span style="font-size:12px;">EUR</span>', '', '#ef4444') : '')
      + '</div>';

    return kpiHtml + searchBox($t('sv2.pp.searchClients'))
      + '<div class="sv2-panel">'
      +   '<div class="sv2-panel-head"><div class="sv2-panel-title">🏢 ' + $t('sv2.pp.pClients') + '</div></div>'
      +   '<div style="overflow-x:auto;"><table class="table">'
      +     '<thead><tr>'
      +       '<th>' + $t('sv2.pp.cClient') + '</th>'
      +       '<th style="text-align:right;">' + $t('sv2.pp.cOrders') + '</th>'
      +       '<th style="text-align:right;">' + $t('st.cClosed') + '</th>'
      +       '<th style="text-align:right;">Km</th>'
      +       '<th style="text-align:right;">' + $t('sv2.pp.cRev') + '</th>'
      +       (finance ? '<th style="text-align:right;">' + $t('sv2.pp.cOutstanding') + '</th>' : '')
      +       (finance ? '<th style="text-align:right;">' + $t('sv2.pp.cAvgPay') + '</th>' : '')
      +     '</tr></thead>'
      +     '<tbody>' + rows + '</tbody></table></div>'
      + '</div>';
  }

  // ── 3. Alvállalkozók ──────────────────────────────────
  function renderCarriers(d) {
    // Az orders.carrier_id-hez a kliens-oldalról nincs dedikált stat handler;
    // egyelőre a Statisztika áttekintés + Pénzügy AP fedi. Rövidebb placeholder:
    return '<div class="sv2-panel" style="padding:24px;text-align:center;">'
      + '<div style="font-size:32px;margin-bottom:8px;">🚚</div>'
      + '<div class="text-primary" style="font-weight:700;margin-bottom:6px;">' + $t('sv2.pp.carrierTitle') + '</div>'
      + '<div class="text-muted" style="font-size:13px;">' + $t('sv2.pp.carrierHint') + '</div>'
      + '<div style="margin-top:16px;">'
      +   '<button class="btn ghost" onclick="VS_STATS_V2._go(\'finance\')">' + $t('sv2.pp.gotoAp') + ' →</button>'
      + '</div>'
      + '</div>';
  }

  function sv2Kpi(label, value, sub, color) {
    return '<div class="sv2-kpi" style="--kpi-ac:' + color + '">'
      + '<div class="sv2-kpi-lbl">' + $esc(label) + '</div>'
      + '<div class="sv2-kpi-val">' + value + '</div>'
      + (sub ? '<div class="sv2-kpi-row"><div class="sv2-kpi-sub">' + $esc(sub) + '</div></div>' : '')
      + '</div>';
  }

  window.VS_STATS_V2_PP = {
    _sub: function (name) {
      _subTab = name;
      _searchFilter = '';
      var box = document.getElementById('sv2Body'); if (!box) return;
      renderInto(box);
    },
    _search: function (v) {
      _searchFilter = v || '';
      var box = document.getElementById('sv2Body'); if (!box) return;
      renderInto(box);
    },
  };

  VS_STATS_V2.registerTab('people', {
    label: $t('sv2.tab.people'),
    render: render,
  });
})();
