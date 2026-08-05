// ============================================================
//  VallorSoft — Statisztika 2.0 (v2) — SHELL / VÁZ
//  Betöltés: admin.html/manager.html a stats-v2 pane-hez.
//  Függőség: console-shared.js (gas, esc, toast, t/i18n).
//
//  Ez a fájl a KÖZÖS vázat rakja fel:
//    - fent ragadó szűrő-sáv (időszak + jármű/sofőr/ügyfél szűrő + összehasonlítás)
//    - fő tab-sor (Áttekintés · Pénzügy · Flotta · Emberek · Operáció)
//    - mentett nézetek dropdown (betöltés + mentés + törlés)
//    - közös publikus API (VS_STATS_V2) az egyes lap-JS-ek regisztrálásához:
//        VS_STATS_V2.registerTab(key, {label, render(box, state), onFilter?})
//    - állapot (VS_STATS_V2.state): { tab, range:{preset,from,to}, filters:{vehicle,driver,client}, compare }
//
//  A tényleges tab-tartalmakat a PR #2… fájlok teszik hozzá (pages/*.js).
// ============================================================

(function () {
  'use strict';

  // ── Segédek (a console-shared.js API-ját használjuk) ──────
  var $t = (typeof t === 'function') ? t : function (k) { return k; };
  var $esc = (typeof esc === 'function') ? esc : function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var $toast = (typeof toast === 'function') ? toast : function (m) { console.log(m); };

  // ── Állapot ─────────────────────────────────────────────
  var state = {
    initialized: false,
    tab: 'overview',
    range: { preset: '12m', from: null, to: null },
    filters: { vehicle: '', driver: '', client: '' },
    compare: 'none',   // 'none' | 'prev_period' | 'prev_year'
    can_finance: false,
    is_admin: false,
    role: null,
    goals: [],
  };
  var tabs = {};           // key -> { label, render, onFilter? }
  var views = [];          // {id,name,config,is_shared,user_id,owner_name,updated_at}[]
  var viewsMenuOpen = false;

  // ── Idő-preset -> dátum ────────────────────────────────
  function ymd(d) { return d.toISOString().slice(0, 10); }
  function rangeDates() {
    var now = new Date();
    var from, to = new Date(now);
    switch (state.range.preset) {
      case 'today':   from = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
      case 'week':    var wd = (now.getDay() + 6) % 7; // hétfő = 0
                      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - wd); break;
      case 'month':   from = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'prev':    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                      to = new Date(now.getFullYear(), now.getMonth(), 0); break;
      case 'quarter': from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1); break;
      case 'year':    from = new Date(now.getFullYear(), 0, 1); break;
      case 'custom':  return { from: state.range.from, to: state.range.to };
      case '12m':
      default:        from = new Date(now.getFullYear(), now.getMonth() - 12, 1); break;
    }
    return { from: ymd(from), to: ymd(to) };
  }

  // ── HTML építők ─────────────────────────────────────────
  function buildTopbar() {
    var presets = [
      ['today',   $t('sv2.rToday')],
      ['week',    $t('sv2.rWeek')],
      ['month',   $t('sv2.rMonth')],
      ['prev',    $t('sv2.rPrev')],
      ['quarter', $t('sv2.rQuarter')],
      ['12m',     $t('sv2.r12m')],
      ['year',    $t('sv2.rYear')],
      ['custom',  $t('sv2.rCustom')],
    ];
    var r = rangeDates();
    var cmp = state.compare;
    var isCustom = state.range.preset === 'custom';
    return ''
      + '<div class="sv2-topbar">'
      +   '<span class="sv2-lbl">' + $t('sv2.periodLbl') + '</span>'
      +   '<select class="select" onchange="VS_STATS_V2._setPreset(this.value)">'
      +     presets.map(function (p) {
              return '<option value="' + p[0] + '"' + (state.range.preset === p[0] ? ' selected' : '') + '>' + $esc(p[1]) + '</option>';
            }).join('')
      +   '</select>'
      +   '<span id="sv2CustomRange" style="display:' + (isCustom ? 'inline-flex' : 'none') + ';gap:6px;align-items:center;">'
      +     '<input class="input" type="date" id="sv2From" value="' + $esc(r.from || '') + '">'
      +     '<span class="sv2-lbl">→</span>'
      +     '<input class="input" type="date" id="sv2To" value="' + $esc(r.to || '') + '">'
      +     '<button class="btn sv2-primary" onclick="VS_STATS_V2._applyCustom()">' + $t('sv2.apply') + '</button>'
      +   '</span>'
      +   '<span class="sv2-lbl">' + $t('sv2.compareLbl') + '</span>'
      +   '<select class="select" onchange="VS_STATS_V2._setCompare(this.value)" style="max-width:160px;">'
      +     '<option value="none"' + (cmp === 'none' ? ' selected' : '') + '>' + $t('sv2.cmpNone') + '</option>'
      +     '<option value="prev_period"' + (cmp === 'prev_period' ? ' selected' : '') + '>' + $t('sv2.cmpPrev') + '</option>'
      +     '<option value="prev_year"' + (cmp === 'prev_year' ? ' selected' : '') + '>' + $t('sv2.cmpYear') + '</option>'
      +   '</select>'
      +   '<span class="sv2-spacer"></span>'
      +   buildViewsMenu()
      +   (state.is_admin ? '<button class="btn ghost" onclick="VS_STATS_V2._openGoals()" title="' + $esc($t('sv2.goals.title')) + '">🎯</button>' : '')
      +   '<button class="btn ghost" onclick="VS_STATS_V2._refresh()">' + $t('sv2.refresh') + '</button>'
      + '</div>';
  }

  function buildViewsMenu() {
    var rows = views.map(function (v) {
      var shared = v.is_shared ? '<span class="sv2-view-shared" title="' + $esc($t('sv2.viewShared')) + '"></span>' : '';
      var meta = v.is_shared && v.owner_name ? '<span class="sv2-view-meta">' + $esc(v.owner_name) + '</span>' : '';
      return ''
        + '<div class="sv2-view-row">'
        +   '<span class="sv2-view-name" onclick="VS_STATS_V2._loadView(' + v.id + ')">' + shared + $esc(v.name) + '</span>'
        +   meta
        +   '<button class="sv2-view-del" title="' + $esc($t('sv2.viewDelete')) + '" onclick="VS_STATS_V2._deleteView(' + v.id + ')">✕</button>'
        + '</div>';
    }).join('');
    if (!rows) rows = '<div class="sv2-views-empty">' + $t('sv2.viewsEmpty') + '</div>';
    return ''
      + '<div class="sv2-views' + (viewsMenuOpen ? ' open' : '') + '">'
      +   '<button class="btn ghost" onclick="VS_STATS_V2._toggleViews()">💾 ' + $t('sv2.views') + '</button>'
      +   '<div class="sv2-views-menu">'
      +     rows
      +     '<div class="sv2-views-newrow">'
      +       '<input class="input" id="sv2NewViewName" placeholder="' + $esc($t('sv2.newViewPh')) + '">'
      +       '<label style="font-size:12px;display:flex;gap:4px;align-items:center;">'
      +         '<input type="checkbox" id="sv2NewViewShared"> ' + $t('sv2.shareView')
      +       '</label>'
      +       '<button class="btn sv2-primary" onclick="VS_STATS_V2._saveNewView()">' + $t('sv2.save') + '</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  function buildTabs() {
    var order = ['overview', 'finance', 'fleet', 'people', 'ops'];
    var emoji = { overview: '🏠', finance: '💰', fleet: '🚚', people: '👥', ops: '📈' };
    return '<div class="sv2-tabs">' + order.map(function (k) {
      if (k === 'finance' && !state.can_finance && !state.is_admin) return '';
      var reg = tabs[k];
      var label = (reg && reg.label) || $t('sv2.tab.' + k);
      var active = k === state.tab;
      return '<button class="sv2-tab' + (active ? ' active' : '') + '" onclick="VS_STATS_V2._go(\'' + k + '\')">'
        + '<span class="sv2-tab-emoji">' + emoji[k] + '</span>' + $esc(label) + '</button>';
    }).join('') + '</div>';
  }

  function buildBody() {
    var reg = tabs[state.tab];
    if (!reg || typeof reg.render !== 'function') {
      // A PR #2… még nem regisztrálta ezt a fület — placeholder üzenet.
      return ''
        + '<div class="sv2-hint">' + $t('sv2.tabPending') + '</div>'
        + '<div class="sv2-empty">' + $esc($t('sv2.tab.' + state.tab)) + ' — ' + $t('sv2.tabPendingBody') + '</div>';
    }
    return '<div id="sv2Body"></div>';
  }

  // ── Fő renderer ────────────────────────────────────────
  function render() {
    var box = document.getElementById('statsV2Box');
    if (!box) return;
    box.innerHTML = buildTopbar() + buildTabs() + buildBody();
    var reg = tabs[state.tab];
    var body = document.getElementById('sv2Body');
    if (reg && body) {
      try { reg.render(body, publicState()); }
      catch (err) { console.error('stats-v2 tab render hiba:', err);
        body.innerHTML = '<div class="sv2-empty">' + $t('sv2.renderErr') + '</div>'; }
    }
  }

  function publicState() {
    return {
      tab: state.tab,
      range: rangeDates(),
      rangePreset: state.range.preset,
      filters: Object.assign({}, state.filters),
      compare: state.compare,
      is_admin: state.is_admin,
      can_finance: state.can_finance,
      role: state.role,
      goals: state.goals.slice(),
    };
  }

  function notifyFilter() {
    Object.keys(tabs).forEach(function (k) {
      var reg = tabs[k];
      if (reg && typeof reg.onFilter === 'function') {
        try { reg.onFilter(publicState()); } catch (e) { /* csendes */ }
      }
    });
  }

  // ── Kezdeti feltöltés ──────────────────────────────────
  function ensureInit(cb) {
    if (state.initialized) { if (cb) cb(); return; }
    if (!window.gas) { if (cb) cb(); return; }
    Promise.all([
      gas('statsV2Init'),
      gas('statsViewList'),
    ]).then(function (rs) {
      var init = rs[0] || {};
      var vlist = rs[1] || {};
      if (init && init.ok) {
        state.can_finance = !!init.can_finance;
        state.is_admin = !!init.is_admin;
        state.role = init.role;
        state.goals = init.goals || [];
      }
      if (vlist && vlist.ok) views = vlist.views || [];
      state.initialized = true;
      if (cb) cb();
    }).catch(function () { state.initialized = true; if (cb) cb(); });
  }

  // ── Publikus API ───────────────────────────────────────
  window.VS_STATS_V2 = {
    // Az admin.js/manager.js loadTab('stats-v2') → ezt hívja
    load: function () {
      ensureInit(function () { render(); });
    },
    // Tab-tartalmat regisztráló (PR #2… használja):
    registerTab: function (key, cfg) {
      tabs[key] = cfg || {};
      if (state.initialized && state.tab === key) render();
    },
    state: publicState,
    reload: function () { render(); },

    // Belső eseménykezelők (a HTML onclick-ekhez):
    _setPreset: function (p) {
      state.range.preset = p;
      if (p === 'custom') {
        var b = document.getElementById('sv2CustomRange'); if (b) b.style.display = 'inline-flex';
        return;
      }
      state.range.from = null; state.range.to = null;
      notifyFilter(); render();
    },
    _applyCustom: function () {
      var f = (document.getElementById('sv2From') || {}).value;
      var to = (document.getElementById('sv2To') || {}).value;
      if (!f || !to) { $toast($t('sv2.rangeMissing'), 'err'); return; }
      state.range.preset = 'custom'; state.range.from = f; state.range.to = to;
      notifyFilter(); render();
    },
    _setCompare: function (v) { state.compare = v; notifyFilter(); render(); },
    _refresh: function () { render(); },
    _go: function (tab) {
      state.tab = tab;
      render();
    },
    _toggleViews: function () {
      viewsMenuOpen = !viewsMenuOpen;
      // A menü nyílása/zárása a felületet nem rendereli újra, csak a menü megnyílik
      // — a legegyszerűbb: teljes felület újrarender.
      render();
    },
    _loadView: function (id) {
      var v = views.filter(function (x) { return x.id === id; })[0];
      if (!v) return;
      var c = v.config || {};
      if (c.range) state.range = { preset: c.range.preset || '12m', from: c.range.from || null, to: c.range.to || null };
      if (c.filters) state.filters = { vehicle: c.filters.vehicle || '', driver: c.filters.driver || '', client: c.filters.client || '' };
      if (c.compare) state.compare = c.compare;
      if (c.tab) state.tab = c.tab;
      viewsMenuOpen = false;
      notifyFilter();
      render();
      $toast($t('sv2.viewLoaded'), 'ok');
    },
    _saveNewView: function () {
      var name = ((document.getElementById('sv2NewViewName') || {}).value || '').trim();
      if (!name) { $toast($t('sv2.nameMissing'), 'err'); return; }
      var isShared = !!(document.getElementById('sv2NewViewShared') || {}).checked;
      var cfg = {
        tab: state.tab,
        range: { preset: state.range.preset, from: state.range.from, to: state.range.to },
        filters: state.filters,
        compare: state.compare,
      };
      gas('statsViewSave', [{ name: name, config: cfg, is_shared: isShared }]).then(function (r) {
        if (!r || !r.ok) { $toast((r && r.err) || $t('common.error'), 'err'); return; }
        gas('statsViewList').then(function (l) {
          if (l && l.ok) views = l.views || [];
          $toast($t('sv2.viewSaved'), 'ok');
          viewsMenuOpen = false;
          render();
        });
      });
    },
    _deleteView: function (id) {
      if (!confirm($t('sv2.viewDeleteConfirm'))) return;
      gas('statsViewDelete', [id]).then(function (r) {
        if (!r || !r.ok) { $toast((r && r.err) || $t('common.error'), 'err'); return; }
        views = views.filter(function (v) { return v.id !== id; });
        $toast($t('sv2.viewDeleted'), 'ok');
        render();
      });
    },

    // 🎯 Cél-értékek modal — Admin only
    getGoal: function (metric_key, period) {
      period = period || 'month';
      return state.goals.filter(function (g) { return g.metric_key === metric_key && g.period === period; })[0] || null;
    },
    _openGoals: function () {
      if (!state.is_admin) return;
      gas('statsGoalList').then(function (r) {
        var goals = (r && r.ok && r.goals) || [];
        openGoalsModal(goals);
      });
    },
    _saveGoal: function () {
      var m = document.getElementById('sv2GoalMetric').value;
      var p = document.getElementById('sv2GoalPeriod').value;
      var v = document.getElementById('sv2GoalValue').value;
      var c = document.getElementById('sv2GoalCurrency').value || null;
      var n = document.getElementById('sv2GoalNote').value || null;
      if (!m || v === '' || parseFloat(v) < 0) { $toast($t('sv2.goals.errValue'), 'err'); return; }
      gas('statsGoalSet', [{ metric_key: m, period: p, target_value: parseFloat(v), currency: c, note: n }]).then(function (r) {
        if (!r || !r.ok) { $toast((r && r.err) || $t('common.error'), 'err'); return; }
        $toast($t('sv2.goals.saved'), 'ok');
        // Frissítsük az állapot goals-t
        gas('statsGoalList').then(function (l) {
          if (l && l.ok) state.goals = l.goals;
          VS_STATS_V2._openGoals();
        });
      });
    },
    _deleteGoal: function (id) {
      if (!confirm($t('sv2.goals.deleteConfirm'))) return;
      gas('statsGoalDelete', [id]).then(function (r) {
        if (!r || !r.ok) { $toast((r && r.err) || $t('common.error'), 'err'); return; }
        state.goals = state.goals.filter(function (g) { return g.id !== id; });
        VS_STATS_V2._openGoals();
      });
    },
  };

  // ── Cél-értékek modal ─────────────────────────────────
  function openGoalsModal(goals) {
    var existing = document.getElementById('sv2GoalsModal');
    if (existing) existing.remove();
    var METRICS = [
      ['revenue', $t('sv2.goals.mRevenue'), 'EUR'],
      ['profit', $t('sv2.goals.mProfit'), 'EUR'],
      ['closed_orders', $t('sv2.goals.mClosed'), ''],
      ['active_orders', $t('sv2.goals.mActive'), ''],
      ['consum_l100', $t('sv2.goals.mConsum'), ''],
      ['km_month', $t('sv2.goals.mKm'), ''],
      ['utilization', $t('sv2.goals.mUtil'), '%'],
      ['on_time_pct', $t('sv2.goals.mOnTime'), '%'],
    ];
    var PERIODS = [
      ['month', $t('sv2.goals.pMonth')],
      ['quarter', $t('sv2.goals.pQuarter')],
      ['year', $t('sv2.goals.pYear')],
    ];
    var rows = goals.map(function (g) {
      var mLabel = (METRICS.filter(function (m) { return m[0] === g.metric_key; })[0] || [])[1] || g.metric_key;
      var pLabel = (PERIODS.filter(function (p) { return p[0] === g.period; })[0] || [])[1] || g.period;
      return '<tr>'
        + '<td>' + $esc(mLabel) + '</td>'
        + '<td>' + $esc(pLabel) + '</td>'
        + '<td style="text-align:right;font-weight:700;">' + $esc(String(g.target_value)) + ' ' + $esc(g.currency || '') + '</td>'
        + '<td class="text-muted" style="font-size:11px;">' + $esc(g.note || '') + '</td>'
        + '<td><button class="btn ghost" style="padding:4px 10px;font-size:12px;color:var(--sv2-danger);" onclick="VS_STATS_V2._deleteGoal(' + g.id + ')">✕</button></td>'
        + '</tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:14px;">' + $t('sv2.goals.empty') + '</td></tr>';

    var ov = document.createElement('div');
    ov.id = 'sv2GoalsModal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
    ov.innerHTML = ''
      + '<div class="sv2-panel" style="max-width:820px;width:100%;max-height:90vh;overflow:auto;padding:22px;">'
      +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">'
      +     '<div class="sv2-panel-title" style="font-size:16px;">🎯 ' + $t('sv2.goals.title') + '</div>'
      +     '<button class="btn ghost" style="padding:6px 12px;" onclick="this.closest(\'#sv2GoalsModal\').remove()">✕</button>'
      +   '</div>'
      +   '<div class="sv2-hint" style="margin-bottom:14px;">' + $t('sv2.goals.hint') + '</div>'
      +   '<div class="sv2-panel" style="padding:14px;margin-bottom:14px;background:rgba(99,102,241,0.06);">'
      +     '<div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px;">'
      +       $t('sv2.goals.newGoal') + '</div>'
      +     '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 100px auto;gap:8px;align-items:center;">'
      +       '<select class="select" id="sv2GoalMetric">'
      +         METRICS.map(function (m) { return '<option value="' + m[0] + '" data-cur="' + m[2] + '">' + $esc(m[1]) + '</option>'; }).join('')
      +       '</select>'
      +       '<select class="select" id="sv2GoalPeriod">'
      +         PERIODS.map(function (p) { return '<option value="' + p[0] + '">' + $esc(p[1]) + '</option>'; }).join('')
      +       '</select>'
      +       '<input class="input" type="number" step="any" min="0" id="sv2GoalValue" placeholder="' + $esc($t('sv2.goals.valuePh')) + '">'
      +       '<input class="input" id="sv2GoalCurrency" placeholder="EUR" style="max-width:80px;">'
      +       '<button class="btn primary" style="padding:8px 16px;" onclick="VS_STATS_V2._saveGoal()">' + $t('sv2.save') + '</button>'
      +     '</div>'
      +     '<input class="input" id="sv2GoalNote" placeholder="' + $esc($t('sv2.goals.notePh')) + '" style="margin-top:8px;width:100%;">'
      +   '</div>'
      +   '<table class="table"><thead><tr>'
      +     '<th>' + $t('sv2.goals.cMetric') + '</th>'
      +     '<th>' + $t('sv2.goals.cPeriod') + '</th>'
      +     '<th style="text-align:right;">' + $t('sv2.goals.cTarget') + '</th>'
      +     '<th>' + $t('sv2.goals.cNote') + '</th>'
      +     '<th></th>'
      +   '</tr></thead><tbody>' + rows + '</tbody></table>'
      + '</div>';
    document.body.appendChild(ov);
  }

  // ── Kliken kívüli kattintás -> views menü bezár ───────────
  document.addEventListener('click', function (ev) {
    if (!viewsMenuOpen) return;
    var t = ev.target;
    while (t && t !== document.body) {
      if (t.classList && (t.classList.contains('sv2-views') || t.classList.contains('sv2-views-menu'))) return;
      t = t.parentNode;
    }
    viewsMenuOpen = false;
    render();
  }, true);
})();
