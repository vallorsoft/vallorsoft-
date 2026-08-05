// ============================================================
//  VallorSoft — Statisztika 2.0 — Közös exportáló modul
//  Publikus API: VS_STATS_V2_EXPORT.{csv,json,copy,print}
//  Egyszerű, függőség nélküli — a Browser fájlletöltése + Clipboard API.
//
//  Használat a PR #9 oldalak-tól:
//    VS_STATS_V2_EXPORT.button({ label, data, columns, filename })
//    → gomb HTML-t ad, ami click-re CSV-t tölt le.
//  Vagy közvetlenül:
//    VS_STATS_V2_EXPORT.csv(rows, columns, 'sofők.csv');
// ============================================================

(function () {
  'use strict';

  function _esc(s) { return String(s == null ? '' : s); }
  // CSV-mező escapelés — vessző, idézőjel, sortörés esetén dupla idézőjel.
  function csvField(v) {
    if (v == null) return '';
    var s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename || 'export.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  // rows: array of objects; columns: [{key, label}] vagy [key, key, ...]
  function toCsv(rows, columns) {
    columns = columns || [];
    if (!columns.length && rows && rows.length) {
      columns = Object.keys(rows[0]).map(function (k) { return { key: k, label: k }; });
    }
    // Ha string tömb, konvertáljuk objektumokra
    columns = columns.map(function (c) {
      return (typeof c === 'string') ? { key: c, label: c } : c;
    });
    var head = columns.map(function (c) { return csvField(c.label || c.key); }).join(',');
    var body = (rows || []).map(function (r) {
      return columns.map(function (c) { return csvField(r[c.key]); }).join(',');
    }).join('\n');
    return head + '\n' + body;
  }

  window.VS_STATS_V2_EXPORT = {
    csv: function (rows, columns, filename) {
      // Excel-barát BOM
      var csv = '﻿' + toCsv(rows, columns);
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      download(blob, filename || ('export-' + Date.now() + '.csv'));
    },

    json: function (data, filename) {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8;' });
      download(blob, filename || ('export-' + Date.now() + '.json'));
    },

    copy: function (text, toastFn) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          if (typeof toastFn === 'function') toastFn('Copiat în clipboard.', 'ok');
        });
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); if (typeof toastFn === 'function') toastFn('Copiat în clipboard.', 'ok'); }
        finally { document.body.removeChild(ta); }
      }
    },

    print: function () {
      // A pane-t nyomtatásra optimalizáljuk — a szűrő-sáv + tab-sor elrejtésével
      var pane = document.querySelector('[data-pane="stats-v2"]');
      if (!pane) { window.print(); return; }
      var cls = 'sv2-print-mode';
      pane.classList.add(cls);
      window.print();
      setTimeout(function () { pane.classList.remove(cls); }, 500);
    },

    // Kényelmes gomb-HTML — az oldalak eddig egymáshoz nem konzisztensen
    // építették; most közös. A cfg: {data, columns, filename, label?}
    button: function (cfg) {
      var id = 'sv2exp-' + Math.random().toString(36).slice(2, 8);
      // Az adatot az id -> data cache-ben tároljuk (kliens-oldali, kis lista):
      window.__sv2ExpCache = window.__sv2ExpCache || {};
      window.__sv2ExpCache[id] = cfg;
      return '<button class="btn ghost sv2-exp-btn" data-sv2exp-id="' + id + '" '
        + 'onclick="VS_STATS_V2_EXPORT._menu(this)" '
        + 'title="Export">' + (cfg.label || '📥') + '</button>';
    },

    _menu: function (btn) {
      var id = btn.getAttribute('data-sv2exp-id');
      var cfg = (window.__sv2ExpCache || {})[id];
      if (!cfg) return;
      // Egyszerű menu — 3 opció
      var existing = document.getElementById('sv2ExpMenu');
      if (existing) existing.remove();
      var rect = btn.getBoundingClientRect();
      var m = document.createElement('div');
      m.id = 'sv2ExpMenu';
      m.className = 'sv2-exp-menu';
      m.style.cssText = 'position:fixed;top:' + (rect.bottom + 4) + 'px;right:' + (window.innerWidth - rect.right) + 'px;'
        + 'background:var(--bg-panel-raised,#141c25);border:1px solid rgba(255,255,255,0.1);'
        + 'border-radius:10px;padding:4px;min-width:180px;box-shadow:0 10px 30px rgba(0,0,0,0.35);z-index:9999;';
      m.innerHTML = ''
        + '<button class="sv2-exp-mi" onclick="VS_STATS_V2_EXPORT._doCsv(\'' + id + '\')">📄 CSV</button>'
        + '<button class="sv2-exp-mi" onclick="VS_STATS_V2_EXPORT._doJson(\'' + id + '\')">🔧 JSON</button>'
        + '<button class="sv2-exp-mi" onclick="VS_STATS_V2_EXPORT._doPrint()">🖨️ Print</button>';
      document.body.appendChild(m);
      // Kattintás máshova → bezár
      setTimeout(function () {
        document.addEventListener('click', function close(ev) {
          if (!m.contains(ev.target) && ev.target !== btn) {
            m.remove(); document.removeEventListener('click', close, true);
          }
        }, true);
      }, 0);
    },

    _doCsv: function (id) {
      var cfg = (window.__sv2ExpCache || {})[id]; if (!cfg) return;
      this.csv(cfg.data, cfg.columns, cfg.filename);
      var m = document.getElementById('sv2ExpMenu'); if (m) m.remove();
    },
    _doJson: function (id) {
      var cfg = (window.__sv2ExpCache || {})[id]; if (!cfg) return;
      this.json(cfg.data, (cfg.filename || 'export').replace(/\.csv$/i, '') + '.json');
      var m = document.getElementById('sv2ExpMenu'); if (m) m.remove();
    },
    _doPrint: function () {
      this.print();
      var m = document.getElementById('sv2ExpMenu'); if (m) m.remove();
    },
  };
})();
