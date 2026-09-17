// ============================================================
//  VallorSoft — public/document-register.js
//  Dokumentum-nyilvántartás (Registru documente) — admin + manager.
//  Önálló modul: DocRegister.mount('docRegisterBox') a fül megnyitásakor.
//  A meglévő gas()/toast()/t()/vsMetricBand segédeket használja.
//
//  Két nézet: MAPPÁK (csoportok) rácsa → egy mappát megnyitva a
//  BEJEGYZÉSEK listája (kiadott/foglalt sorszámok). Fent globális kereső.
// ============================================================
window.DocRegister = (function () {
  function tt(key, fb) {
    try { if (typeof t === 'function') { var v = t(key); if (v && v !== key) return v; } } catch (e) {}
    return fb;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }
  function fmtDate(d) { return d ? esc(String(d).slice(0, 10)) : '—'; }
  function todayStr() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  var STATUSES = ['with_doc', 'reserved', 'void'];
  function stLabel(st) { return tt('dr.st.' + st, st); }

  function ensureStyle() {
    if (document.getElementById('docreg-style')) return;
    var s = document.createElement('style');
    s.id = 'docreg-style';
    s.textContent =
      '.dr-wrap{max-width:1150px}' +
      '.dr-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px}' +
      '.dr-toolbar .input{flex:1;min-width:200px}' +
      '.dr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}' +
      '.dr-card{position:relative;border:1.5px solid var(--glass-border-light,#cbd5e1);border-radius:14px;padding:16px;cursor:pointer;background:var(--panel,#fff);transition:transform .12s,box-shadow .12s;overflow:hidden}' +
      '.dr-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(15,23,42,.12)}' +
      '.dr-card-bar{position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--brand-indigo,#6366f1)}' +
      '.dr-card h4{margin:0 0 4px;font-size:16px;display:flex;align-items:center;gap:8px}' +
      '.dr-pfx{font-size:11px;font-weight:700;background:#eef1f6;color:#4b5563;border-radius:6px;padding:2px 7px}' +
      '.dr-card-meta{font-size:12px;color:var(--muted);margin-top:8px;line-height:1.6}' +
      '.dr-card-counts{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}' +
      '.dr-chip{font-size:11px;font-weight:600;border-radius:999px;padding:2px 9px}' +
      '.dr-chip--doc{background:#e7f6ec;color:#1a7f37}.dr-chip--res{background:#fff3e0;color:#b26a00}.dr-chip--all{background:#eef1f6;color:#475569}' +
      '.dr-card-actions{position:absolute;top:10px;right:10px;display:flex;gap:6px;opacity:0;transition:opacity .12s}' +
      '.dr-card:hover .dr-card-actions{opacity:1}' +
      '.dr-mini{font-size:12px;padding:3px 8px;border-radius:7px;border:1px solid var(--glass-border-light,#cbd5e1);background:transparent;cursor:pointer;color:var(--text-primary,#0f172a)}' +
      '.dr-st{font-size:11px;padding:2px 9px;border-radius:999px;font-weight:600;display:inline-block}' +
      '.dr-st--with_doc{background:#e7f6ec;color:#1a7f37}.dr-st--reserved{background:#fff3e0;color:#b26a00}.dr-st--void{background:#fde8e8;color:#c0341a}' +
      '.dr-act{font-size:12px;padding:4px 9px;border-radius:8px;border:1px solid var(--brand-indigo,#6366f1);background:transparent;color:var(--brand-indigo,#6366f1);cursor:pointer}' +
      '.dr-regno{font-weight:800;font-variant-numeric:tabular-nums}' +
      '.dr-filters{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px}' +
      '.dr-fld{display:flex;flex-direction:column;gap:4px}' +
      '.dr-fld label{font-size:12px;color:var(--muted)}' +
      '.dr-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px}' +
      '.dr-modal{background:var(--panel,#fff);color:var(--text-primary,#0f172a);border-radius:16px;padding:22px;max-width:560px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 24px 60px rgba(15,23,42,.3)}' +
      '.dr-modal h3{margin:0 0 14px}' +
      '.dr-modal .dr-fld{margin-bottom:12px;width:100%}' +
      '.dr-modal .dr-fld .input,.dr-modal .dr-fld .select,.dr-modal .dr-fld textarea{width:100%;box-sizing:border-box}' +
      '.dr-row2{display:flex;gap:10px}.dr-row2>*{flex:1}' +
      '.dr-filelist{list-style:none;padding:0;margin:8px 0 0}' +
      '.dr-filelist li{display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--glass-border-light,#e2e8f0);font-size:13px}' +
      '.dr-filelist li:first-child{border-top:none}' +
      '.dr-file-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.dr-search-res{margin-top:8px;border:1.5px solid var(--glass-border-light,#cbd5e1);border-radius:12px;overflow:hidden}' +
      '.dr-search-res .dr-sr{display:flex;gap:10px;align-items:center;padding:9px 12px;border-top:1px solid var(--glass-border-light,#e2e8f0);cursor:pointer}' +
      '.dr-search-res .dr-sr:first-child{border-top:none}.dr-search-res .dr-sr:hover{background:rgba(99,102,241,.06)}' +
      '.dr-sr-grp{font-size:11px;color:var(--muted);background:#eef1f6;border-radius:6px;padding:1px 7px}' +
      '.main-content[data-theme="dark"] .dr-card{background:var(--bg-panel,#141c25);border-color:rgba(255,255,255,.12)}' +
      '.main-content[data-theme="dark"] .dr-modal{background:var(--bg-panel-raised,#1a232e)}' +
      '.main-content[data-theme="dark"] .dr-pfx{background:rgba(255,255,255,.08);color:#cbd5e1}' +
      '.main-content[data-theme="dark"] .dr-chip--all{background:rgba(255,255,255,.08);color:#cbd5e1}' +
      '.main-content[data-theme="dark"] .dr-sr-grp{background:rgba(255,255,255,.08);color:#cbd5e1}';
    document.head.appendChild(s);
  }

  var _root = null, _groups = [], _view = 'groups', _curGroup = null, _entries = [];

  // ── Modal helper ──
  function modal(html, onMount) {
    var ovl = document.createElement('div');
    ovl.className = 'dr-overlay';
    ovl.innerHTML = '<div class="dr-modal">' + html + '</div>';
    document.body.appendChild(ovl);
    function close() { try { document.body.removeChild(ovl); } catch (e) {} }
    ovl.addEventListener('click', function (e) { if (e.target === ovl) close(); });
    if (onMount) onMount(ovl, close);
    return { el: ovl, close: close };
  }

  // ── Fájl → data URL base64 ──
  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  function collectFiles(input) {
    var files = input && input.files ? Array.prototype.slice.call(input.files) : [];
    return Promise.all(files.map(function (f) {
      return fileToDataUrl(f).then(function (d) { return { file_name: f.name, base64: d }; });
    }));
  }

  // ============================================================
  //  MAPPÁK (csoportok) NÉZET
  // ============================================================
  function groupCard(g) {
    var color = g.color || 'var(--brand-indigo,#6366f1)';
    return '<div class="dr-card" data-open="' + g.id + '">' +
      '<span class="dr-card-bar" style="background:' + esc(color) + '"></span>' +
      '<div class="dr-card-actions">' +
        '<button class="dr-mini" data-edit="' + g.id + '" title="' + tt('common.edit', 'Editează') + '">✏️</button>' +
        '<button class="dr-mini" data-del="' + g.id + '" title="' + tt('common.delete', 'Șterge') + '">🗑</button>' +
      '</div>' +
      '<h4>📁 ' + esc(g.name) + (g.prefix ? ' <span class="dr-pfx">' + esc(g.prefix) + '</span>' : '') + '</h4>' +
      '<div class="dr-card-counts">' +
        '<span class="dr-chip dr-chip--all">' + tt('dr.total', 'Total') + ': ' + (g.entry_count || 0) + '</span>' +
        '<span class="dr-chip dr-chip--doc">📎 ' + (g.with_doc_count || 0) + '</span>' +
        '<span class="dr-chip dr-chip--res">🔖 ' + (g.reserved_count || 0) + '</span>' +
      '</div>' +
      '<div class="dr-card-meta">' +
        tt('dr.lastNo', 'Ultimul nr.') + ': <b>' + esc(g.last_no || '—') + '</b>' +
        (g.last_date ? ' · ' + fmtDate(g.last_date) : '') +
      '</div>' +
    '</div>';
  }

  function renderGroups() {
    var filter = (_root._grpFilter || '').toLowerCase();
    var list = _groups.filter(function (g) {
      return !filter || (g.name || '').toLowerCase().indexOf(filter) !== -1 || (g.prefix || '').toLowerCase().indexOf(filter) !== -1;
    });
    var cards = list.length
      ? list.map(groupCard).join('')
      : '<div style="color:var(--muted);padding:20px;">' + tt('dr.noGroups', 'Nu există dosare încă. Creează primul dosar (ex. Facturi, Contracte).') + '</div>';

    _root.innerHTML =
      '<div class="dr-wrap">' +
      '<h2 class="h-title" style="margin-top:0;">📇 ' + tt('dr.title', 'Registru documente') + '</h2>' +
      '<p style="color:var(--muted);font-size:13px;margin:0 0 14px;">' + tt('dr.intro', 'Numerotare și arhivare documente pe dosare (foldere), cu numerotare automată și încărcare de fișiere.') + '</p>' +
      // Globális kereső
      '<div class="glass" style="padding:14px;margin-bottom:16px;">' +
        '<input class="input" id="drGlobalSearch" placeholder="🔎 ' + tt('dr.searchAll', 'Caută în toate dosarele (nr., titlu, partener)…') + '">' +
        '<div id="drSearchRes"></div>' +
      '</div>' +
      // Mappa-eszköztár
      '<div class="dr-toolbar">' +
        '<input class="input" id="drGrpFilter" placeholder="' + tt('dr.filterGroups', 'Filtrează dosare…') + '" value="' + esc(_root._grpFilter || '') + '">' +
        '<button class="btn primary" id="drNewGrp">➕ ' + tt('dr.newGroup', 'Dosar nou') + '</button>' +
      '</div>' +
      '<div class="dr-grid">' + cards + '</div>' +
      '</div>';

    _root.querySelector('#drNewGrp').addEventListener('click', function () { openGroupModal(null); });
    var gf = _root.querySelector('#drGrpFilter');
    gf.addEventListener('input', function () { _root._grpFilter = gf.value; var g = _root.querySelector('.dr-grid'); if (g) { var f = gf.value.toLowerCase(); g.innerHTML = _groups.filter(function (x) { return !f || (x.name || '').toLowerCase().indexOf(f) !== -1 || (x.prefix || '').toLowerCase().indexOf(f) !== -1; }).map(groupCard).join('') || '<div style="color:var(--muted);padding:20px;">' + tt('dr.noGroups', '') + '</div>'; bindCards(); } });
    bindGlobalSearch();
    bindCards();
  }

  function bindCards() {
    Array.prototype.forEach.call(_root.querySelectorAll('.dr-card'), function (c) {
      c.addEventListener('click', function (e) {
        if (e.target.closest('.dr-card-actions')) return;
        openGroup(parseInt(c.getAttribute('data-open'), 10));
      });
    });
    Array.prototype.forEach.call(_root.querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); var g = _groups.filter(function (x) { return x.id === parseInt(b.getAttribute('data-edit'), 10); })[0]; openGroupModal(g); });
    });
    Array.prototype.forEach.call(_root.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); doDeleteGroup(parseInt(b.getAttribute('data-del'), 10)); });
    });
  }

  var _searchTimer = null;
  function bindGlobalSearch() {
    var inp = _root.querySelector('#drGlobalSearch');
    var box = _root.querySelector('#drSearchRes');
    if (!inp) return;
    inp.addEventListener('input', function () {
      var q = inp.value.trim();
      if (_searchTimer) clearTimeout(_searchTimer);
      if (q.length < 2) { box.innerHTML = ''; return; }
      _searchTimer = setTimeout(function () {
        gas('docRegSearch', [{ q: q }]).then(function (r) {
          var items = (r && r.ok && r.entries) ? r.entries : [];
          if (!items.length) { box.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 2px;">' + tt('dr.noResults', 'Niciun rezultat.') + '</div>'; return; }
          box.innerHTML = '<div class="dr-search-res">' + items.map(function (e) {
            return '<div class="dr-sr" data-grp="' + e.group_id + '" data-reg="' + esc(e.reg_no) + '">' +
              '<span class="dr-sr-grp">📁 ' + esc(e.group_name) + '</span>' +
              '<span class="dr-regno">' + esc(e.reg_no) + '</span>' +
              '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(e.title || e.partner || '') + '</span>' +
              '<span class="dr-st dr-st--' + esc(e.status) + '">' + esc(stLabel(e.status)) + '</span>' +
              (e.file_count > 0 ? '<span>📎' + e.file_count + '</span>' : '') +
            '</div>';
          }).join('') + '</div>';
          Array.prototype.forEach.call(box.querySelectorAll('.dr-sr'), function (row) {
            row.addEventListener('click', function () { openGroup(parseInt(row.getAttribute('data-grp'), 10), row.getAttribute('data-reg')); });
          });
        });
      }, 250);
    });
  }

  function openGroupModal(g) {
    var isEdit = !!g;
    var m = modal(
      '<h3>' + (isEdit ? tt('dr.editGroup', 'Editare dosar') : tt('dr.newGroup', 'Dosar nou')) + '</h3>' +
      '<div class="dr-fld"><label>' + tt('dr.groupName', 'Nume dosar') + ' *</label><input class="input" id="dgName" value="' + esc(g && g.name || '') + '" placeholder="ex. Facturi"></div>' +
      '<div class="dr-row2">' +
        '<div class="dr-fld"><label>' + tt('dr.prefix', 'Prefix nr.') + '</label><input class="input" id="dgPrefix" maxlength="20" value="' + esc(g && g.prefix || '') + '" placeholder="ex. FCT"></div>' +
        '<div class="dr-fld"><label>' + tt('dr.pad', 'Cifre (0001)') + '</label><input class="input" id="dgPad" type="number" min="1" max="9" value="' + (g && g.pad || 4) + '"></div>' +
      '</div>' +
      '<div class="dr-row2">' +
        '<div class="dr-fld"><label>' + tt('dr.yearReset', 'Reset anual') + '</label><select class="select" id="dgYear"><option value="1"' + (!g || g.year_reset ? ' selected' : '') + '>' + tt('dr.yes', 'Da (PREFIX-2026-0001)') + '</option><option value="0"' + (g && !g.year_reset ? ' selected' : '') + '>' + tt('dr.no', 'Nu (continuu)') + '</option></select></div>' +
        '<div class="dr-fld"><label>' + tt('dr.color', 'Culoare') + '</label><input class="input" id="dgColor" type="color" value="' + esc(g && g.color || '#6366f1') + '"></div>' +
      '</div>' +
      '<div class="dr-fld"><label>' + tt('dr.notesLbl', 'Notă') + '</label><textarea class="input" id="dgNotes" rows="2">' + esc(g && g.notes || '') + '</textarea></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">' +
        '<button class="btn ghost" id="dgCancel">' + tt('common.cancel', 'Anulează') + '</button>' +
        '<button class="btn primary" id="dgSave">' + tt('common.save', 'Salvează') + '</button>' +
      '</div>',
      function (ovl, close) {
        ovl.querySelector('#dgCancel').addEventListener('click', close);
        ovl.querySelector('#dgSave').addEventListener('click', function () {
          var name = ovl.querySelector('#dgName').value.trim();
          if (!name) { toast(tt('dr.groupNameRequired', 'Numele dosarului este obligatoriu.'), 'err'); return; }
          var p = {
            id: g && g.id, name: name,
            prefix: ovl.querySelector('#dgPrefix').value.trim(),
            pad: parseInt(ovl.querySelector('#dgPad').value, 10) || 4,
            year_reset: ovl.querySelector('#dgYear').value === '1',
            color: ovl.querySelector('#dgColor').value,
            notes: ovl.querySelector('#dgNotes').value.trim()
          };
          gas('docRegGroupSave', [p]).then(function (r) {
            if (r && r.ok) { toast(tt('common.savedOk', 'Salvat'), 'ok'); close(); reloadGroups(); }
            else toast((r && r.err) || tt('common.error', 'Eroare'), 'err');
          });
        });
      }
    );
    return m;
  }

  function doDeleteGroup(id) {
    var g = _groups.filter(function (x) { return x.id === id; })[0];
    var cnt = g ? (g.entry_count || 0) : 0;
    if (!window.confirm(tt('dr.delGroupConfirm', 'Ștergi dosarul și toate înregistrările din el?') + (cnt ? ' (' + cnt + ')' : ''))) return;
    gas('docRegGroupDelete', [{ id: id }]).then(function (r) {
      if (r && r.ok) { toast(tt('common.deletedOk', 'Șters'), 'ok'); reloadGroups(); }
      else toast((r && r.err) || tt('common.error', 'Eroare'), 'err');
    });
  }

  // ============================================================
  //  BEJEGYZÉSEK (egy mappán belül) NÉZET
  // ============================================================
  function openGroup(id, highlightReg) {
    _curGroup = _groups.filter(function (x) { return x.id === id; })[0] || { id: id, name: '' };
    _view = 'entries';
    _root._entFilter = { q: '', from: '', to: '', status: '' };
    _root._highlight = highlightReg || null;
    reloadEntries();
  }

  function band() {
    if (typeof vsMetricBand !== 'function') return '';
    var total = _entries.length;
    var withDoc = _entries.filter(function (e) { return e.status === 'with_doc'; }).length;
    var reserved = _entries.filter(function (e) { return e.status === 'reserved'; }).length;
    return vsMetricBand([
      { l: tt('dr.total', 'Total'), v: total, sub: '' },
      { l: tt('dr.st.with_doc', 'Cu document'), v: withDoc, sub: '📎' },
      { l: tt('dr.st.reserved', 'Rezervat'), v: reserved, sub: '🔖' }
    ]);
  }

  function entryRows() {
    if (!_entries.length) {
      return '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:16px;">' + tt('dr.noEntries', 'Nu există înregistrări. Emite un număr nou.') + '</td></tr>';
    }
    return _entries.map(function (e) {
      var amount = (e.amount != null && e.amount !== '') ? (Number(e.amount).toFixed(2) + ' ' + esc(e.currency || '')) : '—';
      var hl = (_root._highlight && e.reg_no === _root._highlight) ? ' style="background:rgba(99,102,241,.10)"' : '';
      return '<tr' + hl + '>' +
        '<td class="dr-regno">' + esc(e.reg_no) + '</td>' +
        '<td>' + fmtDate(e.entry_date) + '</td>' +
        '<td>' + esc(e.title || '—') + (e.notes ? '<div style="font-size:11px;color:var(--muted)">' + esc(e.notes) + '</div>' : '') + '</td>' +
        '<td>' + esc(e.partner || '—') + '</td>' +
        '<td>' + amount + '</td>' +
        '<td><span class="dr-st dr-st--' + esc(e.status) + '">' + esc(stLabel(e.status)) + '</span></td>' +
        '<td style="white-space:nowrap;">' +
          '<button class="dr-act" data-files="' + e.id + '">📎 ' + (e.file_count || 0) + '</button> ' +
          '<button class="dr-act" data-eedit="' + e.id + '">' + tt('common.edit', 'Editare') + '</button> ' +
          '<button class="dr-act" data-edel="' + e.id + '">🗑</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  function renderEntries() {
    var f = _root._entFilter || {};
    _root.innerHTML =
      '<div class="dr-wrap">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;flex-wrap:wrap;">' +
        '<button class="btn ghost" id="drBack">' + tt('common.back', '← Înapoi') + '</button>' +
        '<h2 class="h-title" style="margin:0;">📁 ' + esc(_curGroup.name) + (_curGroup.prefix ? ' <span class="dr-pfx">' + esc(_curGroup.prefix) + '</span>' : '') + '</h2>' +
      '</div>' +
      '<div id="drEntBand" style="margin:10px 0 16px;">' + band() + '</div>' +
      '<div class="dr-toolbar">' +
        '<button class="btn primary" id="drNewEntry">➕ ' + tt('dr.newEntry', 'Înregistrare nouă') + '</button>' +
        '<button class="btn ghost" id="drReserve">🔖 ' + tt('dr.reserve', 'Rezervă un număr') + '</button>' +
      '</div>' +
      '<div class="dr-filters glass" style="padding:14px;">' +
        '<div class="dr-fld" style="flex:1;min-width:180px;"><label>' + tt('common.search', 'Căutare') + '</label><input class="input" id="drEF_q" value="' + esc(f.q || '') + '"></div>' +
        '<div class="dr-fld"><label>' + tt('dr.from', 'De la') + '</label><input class="input" id="drEF_from" type="date" value="' + esc(f.from || '') + '"></div>' +
        '<div class="dr-fld"><label>' + tt('dr.to', 'Până la') + '</label><input class="input" id="drEF_to" type="date" value="' + esc(f.to || '') + '"></div>' +
        '<div class="dr-fld"><label>' + tt('dr.status', 'Status') + '</label><select class="select" id="drEF_st">' +
          '<option value="">' + tt('dr.all', 'Toate') + '</option>' +
          STATUSES.map(function (s) { return '<option value="' + s + '"' + (f.status === s ? ' selected' : '') + '>' + esc(stLabel(s)) + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="glass" style="padding:16px;overflow-x:auto;">' +
        '<table class="table"><thead><tr>' +
          '<th>' + tt('dr.col.no', 'Nr.') + '</th>' +
          '<th>' + tt('dr.col.date', 'Data') + '</th>' +
          '<th>' + tt('dr.col.title', 'Titlu') + '</th>' +
          '<th>' + tt('dr.col.partner', 'Partener') + '</th>' +
          '<th>' + tt('dr.col.amount', 'Sumă') + '</th>' +
          '<th>' + tt('dr.status', 'Status') + '</th>' +
          '<th>' + tt('dr.col.actions', 'Acțiuni') + '</th>' +
        '</tr></thead><tbody>' + entryRows() + '</tbody></table>' +
      '</div>' +
      '</div>';

    _root.querySelector('#drBack').addEventListener('click', function () { _view = 'groups'; _root._highlight = null; reloadGroups(); });
    _root.querySelector('#drNewEntry').addEventListener('click', function () { openEntryModal(null); });
    _root.querySelector('#drReserve').addEventListener('click', doReserve);

    var applyFilter = function () {
      _root._entFilter = {
        q: _root.querySelector('#drEF_q').value.trim(),
        from: _root.querySelector('#drEF_from').value,
        to: _root.querySelector('#drEF_to').value,
        status: _root.querySelector('#drEF_st').value
      };
      reloadEntries(true);
    };
    _root.querySelector('#drEF_q').addEventListener('input', debounce(applyFilter, 300));
    ['drEF_from', 'drEF_to', 'drEF_st'].forEach(function (id) { _root.querySelector('#' + id).addEventListener('change', applyFilter); });

    Array.prototype.forEach.call(_root.querySelectorAll('[data-files]'), function (b) {
      b.addEventListener('click', function () { openFilesModal(parseInt(b.getAttribute('data-files'), 10)); });
    });
    Array.prototype.forEach.call(_root.querySelectorAll('[data-eedit]'), function (b) {
      b.addEventListener('click', function () { var e = _entries.filter(function (x) { return x.id === parseInt(b.getAttribute('data-eedit'), 10); })[0]; openEntryModal(e); });
    });
    Array.prototype.forEach.call(_root.querySelectorAll('[data-edel]'), function (b) {
      b.addEventListener('click', function () { doDeleteEntry(parseInt(b.getAttribute('data-edel'), 10)); });
    });
  }

  function openEntryModal(e) {
    var isEdit = !!e;
    var m = modal(
      '<h3>' + (isEdit ? tt('dr.editEntry', 'Editare înregistrare') : tt('dr.newEntry', 'Înregistrare nouă')) + (isEdit ? ' — <span class="dr-regno">' + esc(e.reg_no) + '</span>' : '') + '</h3>' +
      (isEdit ? '' :
        '<div class="dr-fld"><label>' + tt('dr.manualNo', 'Nr. manual (opțional — lasă gol pt. automat)') + '</label><input class="input" id="deManual" placeholder="' + tt('dr.autoHint', 'automat') + '"></div>') +
      '<div class="dr-row2">' +
        '<div class="dr-fld"><label>' + tt('dr.col.date', 'Data') + '</label><input class="input" id="deDate" type="date" value="' + esc(isEdit ? String(e.entry_date).slice(0, 10) : todayStr()) + '"></div>' +
        (isEdit ? '<div class="dr-fld"><label>' + tt('dr.status', 'Status') + '</label><select class="select" id="deStatus">' + STATUSES.map(function (s) { return '<option value="' + s + '"' + (e.status === s ? ' selected' : '') + '>' + esc(stLabel(s)) + '</option>'; }).join('') + '</select></div>' : '<div class="dr-fld"></div>') +
      '</div>' +
      '<div class="dr-fld"><label>' + tt('dr.col.title', 'Titlu') + '</label><input class="input" id="deTitle" value="' + esc(isEdit ? (e.title || '') : '') + '"></div>' +
      '<div class="dr-fld"><label>' + tt('dr.col.partner', 'Partener') + '</label><input class="input" id="dePartner" value="' + esc(isEdit ? (e.partner || '') : '') + '"></div>' +
      '<div class="dr-row2">' +
        '<div class="dr-fld"><label>' + tt('dr.col.amount', 'Sumă') + '</label><input class="input" id="deAmount" type="number" step="0.01" value="' + esc(isEdit && e.amount != null ? e.amount : '') + '"></div>' +
        '<div class="dr-fld"><label>' + tt('dr.currency', 'Valută') + '</label><select class="select" id="deCurrency"><option value=""></option><option' + (isEdit && e.currency === 'EUR' ? ' selected' : '') + '>EUR</option><option' + (isEdit && e.currency === 'RON' ? ' selected' : '') + '>RON</option></select></div>' +
      '</div>' +
      '<div class="dr-fld"><label>' + tt('dr.notesLbl', 'Notă') + '</label><textarea class="input" id="deNotes" rows="2">' + esc(isEdit ? (e.notes || '') : '') + '</textarea></div>' +
      (isEdit ? '' : '<div class="dr-fld"><label>' + tt('dr.attach', 'Atașează documente (opțional — fără = număr rezervat)') + '</label><input class="input" id="deFiles" type="file" multiple></div>') +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">' +
        '<button class="btn ghost" id="deCancel">' + tt('common.cancel', 'Anulează') + '</button>' +
        '<button class="btn primary" id="deSave">' + tt('common.save', 'Salvează') + '</button>' +
      '</div>',
      function (ovl, close) {
        ovl.querySelector('#deCancel').addEventListener('click', close);
        ovl.querySelector('#deSave').addEventListener('click', function () {
          var btn = ovl.querySelector('#deSave'); btn.disabled = true;
          var base = {
            entry_date: ovl.querySelector('#deDate').value || null,
            title: ovl.querySelector('#deTitle').value.trim(),
            partner: ovl.querySelector('#dePartner').value.trim(),
            amount: ovl.querySelector('#deAmount').value,
            currency: ovl.querySelector('#deCurrency').value,
            notes: ovl.querySelector('#deNotes').value.trim()
          };
          if (isEdit) {
            base.id = e.id; base.status = ovl.querySelector('#deStatus').value;
            gas('docRegEntryUpdate', [base]).then(function (r) {
              btn.disabled = false;
              if (r && r.ok) { toast(tt('common.savedOk', 'Salvat'), 'ok'); close(); reloadEntries(true); }
              else toast((r && r.err) || tt('common.error', 'Eroare'), 'err');
            });
          } else {
            base.group_id = _curGroup.id;
            base.manual_no = ovl.querySelector('#deManual').value.trim();
            collectFiles(ovl.querySelector('#deFiles')).then(function (files) {
              base.files = files;
              return gas('docRegEntryCreate', [base]);
            }).then(function (r) {
              btn.disabled = false;
              if (r && r.ok) { toast(tt('dr.issued', 'Număr emis') + ': ' + esc(r.reg_no || ''), 'ok'); close(); reloadEntries(true); reloadGroupStats(); }
              else toast((r && r.err) || tt('common.error', 'Eroare'), 'err');
            }).catch(function () { btn.disabled = false; toast(tt('common.error', 'Eroare'), 'err'); });
          }
        });
      }
    );
    return m;
  }

  // Gyors sorszám-foglalás (dokumentum nélkül) — csak dátum + opc. cím.
  function doReserve() {
    openEntryModal(null); // az entry modal üres fájllal = foglalt szám
  }

  function doDeleteEntry(id) {
    var e = _entries.filter(function (x) { return x.id === id; })[0];
    if (!window.confirm(tt('dr.delEntryConfirm', 'Ștergi înregistrarea? Numărul rămâne consumat (nu se reemite).') + (e ? '\n' + e.reg_no : ''))) return;
    gas('docRegEntryDelete', [{ id: id }]).then(function (r) {
      if (r && r.ok) { toast(tt('common.deletedOk', 'Șters'), 'ok'); reloadEntries(true); }
      else toast((r && r.err) || tt('common.error', 'Eroare'), 'err');
    });
  }

  // ── Fájlok modal (letöltés + hozzáadás + törlés) ──
  function openFilesModal(entryId) {
    var e = _entries.filter(function (x) { return x.id === entryId; })[0] || {};
    var m = modal(
      '<h3>📎 ' + tt('dr.files', 'Documente') + ' — <span class="dr-regno">' + esc(e.reg_no || '') + '</span></h3>' +
      '<div id="drFilesList"><div style="color:var(--muted);padding:8px;">' + tt('common.loading', 'Se încarcă…') + '</div></div>' +
      '<div class="dr-fld" style="margin-top:14px;"><label>' + tt('dr.addFiles', 'Adaugă documente') + '</label><input class="input" id="drAddFiles" type="file" multiple></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">' +
        '<button class="btn ghost" id="drFilesClose">' + tt('common.close', 'Închide') + '</button>' +
        '<button class="btn primary" id="drFilesUpload">⬆️ ' + tt('dr.upload', 'Încarcă') + '</button>' +
      '</div>',
      function (ovl, close) {
        ovl.querySelector('#drFilesClose').addEventListener('click', function () { close(); reloadEntries(true); });
        ovl.querySelector('#drFilesUpload').addEventListener('click', function () {
          var btn = ovl.querySelector('#drFilesUpload'); btn.disabled = true;
          collectFiles(ovl.querySelector('#drAddFiles')).then(function (files) {
            if (!files.length) { btn.disabled = false; toast(tt('dr.pickFile', 'Alege un fișier.'), 'err'); return null; }
            return gas('docRegEntryAddFiles', [{ entry_id: entryId, files: files }]);
          }).then(function (r) {
            btn.disabled = false;
            if (r === null) return;
            if (r && r.ok) { toast(tt('common.savedOk', 'Salvat'), 'ok'); loadFilesInto(ovl, entryId); }
            else toast((r && r.err) || tt('common.error', 'Eroare'), 'err');
          }).catch(function () { btn.disabled = false; toast(tt('common.error', 'Eroare'), 'err'); });
        });
        loadFilesInto(ovl, entryId);
      }
    );
    return m;
  }

  function loadFilesInto(ovl, entryId) {
    var box = ovl.querySelector('#drFilesList');
    gas('docRegEntryFiles', [{ entry_id: entryId }]).then(function (r) {
      var files = (r && r.ok && r.files) ? r.files : [];
      if (!files.length) { box.innerHTML = '<div style="color:var(--muted);padding:8px;font-size:13px;">' + tt('dr.noFiles', 'Niciun document atașat (număr rezervat).') + '</div>'; return; }
      box.innerHTML = '<ul class="dr-filelist">' + files.map(function (f) {
        var kb = f.file_size ? Math.round(f.file_size / 1024) + ' KB' : '';
        return '<li><span>📄</span><span class="dr-file-name" title="' + esc(f.file_name) + '">' + esc(f.file_name) + '</span>' +
          '<span style="color:var(--muted);font-size:11px;">' + kb + '</span>' +
          '<button class="dr-act" data-dl="' + f.id + '">⬇️</button>' +
          '<button class="dr-act" data-fdel="' + f.id + '">🗑</button></li>';
      }).join('') + '</ul>';
      Array.prototype.forEach.call(box.querySelectorAll('[data-dl]'), function (b) {
        b.addEventListener('click', function () { downloadFile(parseInt(b.getAttribute('data-dl'), 10)); });
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-fdel]'), function (b) {
        b.addEventListener('click', function () {
          if (!window.confirm(tt('dr.delFileConfirm', 'Ștergi acest document?'))) return;
          gas('docRegFileDelete', [{ file_id: parseInt(b.getAttribute('data-fdel'), 10) }]).then(function (r) {
            if (r && r.ok) { toast(tt('common.deletedOk', 'Șters'), 'ok'); loadFilesInto(ovl, entryId); }
            else toast((r && r.err) || tt('common.error', 'Eroare'), 'err');
          });
        });
      });
    });
  }

  function downloadFile(fileId) {
    gas('docRegFileGet', [{ file_id: fileId }]).then(function (r) {
      if (!r || !r.ok || !r.base64) { toast((r && r.err) || tt('common.error', 'Eroare'), 'err'); return; }
      var a = document.createElement('a');
      a.href = r.base64; // data URL
      a.download = r.file_name || 'document';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });
  }

  // ── util ──
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  // ── adat-betöltés ──
  function reloadGroups() {
    _view = 'groups';
    gas('docRegGroupList', []).then(function (r) {
      _groups = (r && r.ok && r.groups) ? r.groups : [];
      renderGroups();
    }).catch(function () { _groups = []; renderGroups(); });
  }
  function reloadGroupStats() {
    gas('docRegGroupList', []).then(function (r) { _groups = (r && r.ok && r.groups) ? r.groups : _groups; }).catch(function () {});
  }
  function reloadEntries(keepFilter) {
    var f = keepFilter ? (_root._entFilter || {}) : {};
    var q = { group_id: _curGroup.id };
    if (f.q) q.q = f.q; if (f.from) q.from = f.from; if (f.to) q.to = f.to; if (f.status) q.status = f.status;
    gas('docRegEntryList', [q]).then(function (r) {
      _entries = (r && r.ok && r.entries) ? r.entries : [];
      renderEntries();
    }).catch(function () { _entries = []; renderEntries(); });
  }

  function mount(target) {
    var el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) { console.warn('document-register.js: nincs konténer'); return; }
    ensureStyle();
    _root = el; _view = 'groups'; _root._grpFilter = _root._grpFilter || '';
    el.innerHTML = '<div style="padding:14px;color:var(--muted)">…</div>';
    reloadGroups();
  }

  return { mount: mount };
})();
