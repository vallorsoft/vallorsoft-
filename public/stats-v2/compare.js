// ============================================================
//  VallorSoft — Statisztika 2.0 — Multi-select összehasonlítás
//  Publikus API:
//    VS_STATS_V2_CMP.init(scope) — nulláz + regisztrálja a hívó oldalt
//    VS_STATS_V2_CMP.toggle(scope, id) — 1 sor kijelölés váltó (max 5)
//    VS_STATS_V2_CMP.chkHtml(scope, id) — checkbox HTML
//    VS_STATS_V2_CMP.isSel(scope, id) — bool a rendereléshez
//    VS_STATS_V2_CMP.openWith(scope, entities, metrics) — 🆚 modal
//
//  A scope pl. 'drivers'/'clients'/'vehicles' — külön kijelölés-halmaz.
//  Az entities tömb az összes elérhető adat; a metrics tömb definiálja
//  MI-t hasonlítunk össze: [{ key, label, higherIsBetter?, format?, unit? }].
// ============================================================

(function () {
  'use strict';

  var $t = (typeof t === 'function') ? t : function (k) { return k; };
  var $esc = (typeof esc === 'function') ? esc : function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var $toast = (typeof toast === 'function') ? toast : function () {};

  var MAX_SEL = 5;
  var MIN_SEL = 2;

  // scope → { ids: Set, entities: [], metrics: [] }
  var state = {};

  function scope(s) {
    if (!state[s]) state[s] = { ids: new Set(), entities: [], metrics: [] };
    return state[s];
  }

  function init(s) {
    state[s] = { ids: new Set(), entities: [], metrics: [] };
    hideBar();
  }

  function toggle(s, id) {
    var st = scope(s);
    if (st.ids.has(id)) {
      st.ids.delete(id);
    } else {
      if (st.ids.size >= MAX_SEL) {
        $toast($t('sv2.cmp.maxWarn'), 'err');
        return false;
      }
      st.ids.add(id);
    }
    renderBar(s);
    // Az adott checkbox állapotát is szinkronban tartjuk vizuálisan
    var cb = document.querySelector('.sv2-sel-chk[data-sv2-cmp-scope="' + s + '"][data-sv2-cmp-id="' + id + '"]');
    if (cb) cb.checked = st.ids.has(id);
    return true;
  }

  function isSel(s, id) { return scope(s).ids.has(String(id)); }

  function chkHtml(s, id) {
    var sel = isSel(s, id);
    return '<input type="checkbox" class="sv2-sel-chk"'
      + ' data-sv2-cmp-scope="' + s + '" data-sv2-cmp-id="' + $esc(String(id)) + '"'
      + (sel ? ' checked' : '')
      + ' onclick="event.stopPropagation();VS_STATS_V2_CMP.toggle(\'' + s + '\',\'' + $esc(String(id)) + '\')">';
  }

  function clear(s) {
    state[s] = { ids: new Set(), entities: [], metrics: [] };
    document.querySelectorAll('.sv2-sel-chk[data-sv2-cmp-scope="' + s + '"]').forEach(function (c) { c.checked = false; });
    hideBar();
  }

  function hideBar() {
    var b = document.getElementById('sv2CmpBar'); if (b) b.remove();
  }
  function renderBar(s) {
    var st = scope(s);
    hideBar();
    if (st.ids.size === 0) return;
    var bar = document.createElement('div');
    bar.id = 'sv2CmpBar';
    bar.className = 'sv2-compare-bar';
    bar.innerHTML = ''
      + '<span>' + st.ids.size + ' ' + $t('sv2.cmp.selected') + '</span>'
      + '<button onclick="VS_STATS_V2_CMP.clear(\'' + s + '\')">' + $t('sv2.cmp.clearBtn') + '</button>'
      + '<button class="primary" onclick="VS_STATS_V2_CMP.openScope(\'' + s + '\')">' + $t('sv2.cmp.compareBtn') + '</button>';
    document.body.appendChild(bar);
  }

  // A hívó oldalak ezt hívják, hogy az entities + metrics-et frissítsék
  function setContext(s, entities, metrics) {
    var st = scope(s);
    st.entities = entities || [];
    st.metrics = metrics || [];
  }

  function openScope(s) {
    var st = scope(s);
    if (st.ids.size < MIN_SEL) { $toast($t('sv2.cmp.minWarn'), 'err'); return; }
    // Szűrjük a kijelöltekre
    var selected = st.entities.filter(function (e) { return st.ids.has(String(e._id)); });
    openWith(selected, st.metrics);
  }

  function openWith(entities, metrics) {
    var existing = document.getElementById('sv2CmpModal'); if (existing) existing.remove();
    // A "legjobb"/"legrosszabb" kiemelés per metric
    var bestMap = {};
    metrics.forEach(function (m) {
      var vals = entities.map(function (e) { return parseFloat(e[m.key]); }).filter(function (v) { return isFinite(v); });
      if (!vals.length) return;
      var mx = Math.max.apply(null, vals);
      var mn = Math.min.apply(null, vals);
      var better = m.higherIsBetter === false ? mn : mx;
      var worse = m.higherIsBetter === false ? mx : mn;
      bestMap[m.key] = { better: better, worse: worse };
    });

    function fmt(v, m) {
      if (v == null || v === '') return '—';
      var n = parseFloat(v);
      if (typeof m.format === 'function') return m.format(v);
      if (isFinite(n)) return n.toLocaleString('hu-HU', { maximumFractionDigits: m.dec != null ? m.dec : 1 }) + (m.unit ? ' ' + m.unit : '');
      return String(v);
    }

    var headerCells = entities.map(function (e) {
      return '<th>' + $esc(e._label || '?') + '</th>';
    }).join('');

    var rows = metrics.map(function (m) {
      var cells = entities.map(function (e) {
        var v = e[m.key];
        var num = parseFloat(v);
        var cls = '';
        var b = bestMap[m.key];
        if (b && isFinite(num) && entities.length >= 2) {
          if (num === b.better && b.better !== b.worse) cls = 'best';
          else if (num === b.worse && b.better !== b.worse) cls = 'worst';
        }
        return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + $esc(fmt(v, m)) + '</td>';
      }).join('');
      return '<tr>'
        + '<td class="metric-lbl">' + $esc(m.label) + '</td>'
        + cells
        + '</tr>';
    }).join('');

    var ov = document.createElement('div');
    ov.id = 'sv2CmpModal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
    ov.innerHTML = ''
      + '<div class="sv2-panel" style="max-width:960px;width:100%;max-height:90vh;overflow:auto;padding:22px;">'
      +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">'
      +     '<div class="sv2-panel-title" style="font-size:16px;">🆚 ' + $t('sv2.cmp.title') + '</div>'
      +     '<button class="btn ghost" style="padding:6px 12px;" onclick="this.closest(\'#sv2CmpModal\').remove()">✕</button>'
      +   '</div>'
      +   '<div class="sv2-hint" style="margin-bottom:14px;">' + $t('sv2.cmp.hint') + '</div>'
      +   '<div style="overflow-x:auto;">'
      +   '<table class="sv2-cmp-table">'
      +     '<thead><tr><th>' + $t('sv2.cmp.metric') + '</th>' + headerCells + '</tr></thead>'
      +     '<tbody>' + rows + '</tbody>'
      +   '</table>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(ov);
  }

  window.VS_STATS_V2_CMP = {
    init: init, toggle: toggle, isSel: isSel, chkHtml: chkHtml,
    clear: clear, setContext: setContext, openScope: openScope, openWith: openWith,
    MAX_SEL: MAX_SEL, MIN_SEL: MIN_SEL,
  };
})();
