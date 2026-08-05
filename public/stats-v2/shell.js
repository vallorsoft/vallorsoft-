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
  };

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
