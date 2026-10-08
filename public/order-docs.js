// ============================================================
//  VallorSoft — public/order-docs.js
//  📎 Fuvar-dokumentumok: számla / CMR / POD / bármilyen dokumentum feltöltése
//  egy fuvarhoz kötve, utólagos keresés fuvar / ügyfél / típus / dátum szerint,
//  letöltés. Szerver: handlers/orderDocs.js (+ a meglévő orderDocGet letöltés).
//  Belépés: OrderDocs.mount('orderDocsBox') a fül megnyitásakor;
//  a fuvar ⋯ menüből: OrderDocs.openUpload(orderId) / OrderDocs.showForOrder(orderId).
// ============================================================
window.OrderDocs = (function () {
  var TYPES = ['invoice', 'cmr', 'pod', 'order', 'contract', 'customs', 'receipt', 'other'];
  var ICO = { invoice: '🧾', cmr: '📄', pod: '📷', order: '📑', contract: '📝', customs: '🛃', receipt: '🧾', other: '📎' };
  var st = { q: '', type: '', from: '', to: '', order_id: '', order_label: '', rows: [], boxId: null };
  var _qTimer = null;

  function tt(key, fb, p) {
    var v = fb;
    try { if (typeof t === 'function') { var x = t(key, p); if (x && x !== key) v = x; } } catch (e) {}
    if (p) Object.keys(p).forEach(function (k) { v = String(v).replace('{' + k + '}', p[k]); });
    return v;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function ymd(d) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function today() { return ymd(new Date()); }
  function dateStr(v) { return v ? String(v).slice(0, 10) : '—'; }
  function typeLabel(k) { return (ICO[k] || '📎') + ' ' + tt('odoc.t.' + (k || 'other'), k || 'other'); }
  function fmtSize(n) { n = Number(n) || 0; if (!n) return ''; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function orderLabel(r) {
    var no = r.fuvar_no || r.order_id || r.id;
    var route = [r.loc_incarcare, r.loc_descarcare].filter(Boolean).map(function (s) { return String(s).split(',')[0]; }).join(' → ');
    return no + (r.client ? ' · ' + r.client : '') + (route ? ' · ' + route : '');
  }

  function ensureStyle() {
    if (document.getElementById('odoc-style')) return;
    var s = document.createElement('style');
    s.id = 'odoc-style';
    s.textContent =
      '.odoc-tb{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px}' +
      '.odoc-fld{display:flex;flex-direction:column;gap:4px}.odoc-fld label{font-size:12px;color:var(--muted)}' +
      '.odoc-tb .odoc-q{min-width:240px;flex:1}' +
      '.odoc-presets{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}' +
      '.odoc-chip{font-size:12px;padding:5px 11px;border-radius:999px;border:1.5px solid #cbd5e1;background:transparent;cursor:pointer;color:inherit}' +
      '.odoc-chip.on{background:var(--vs-warm-grad,#6366f1);color:#fff;border-color:transparent}' +
      '.odoc-ofilter{display:inline-flex;gap:8px;align-items:center;background:#eef2ff;color:#3730a3;border-radius:999px;padding:4px 6px 4px 12px;font-size:13px;margin-bottom:12px}' +
      '.odoc-ofilter button{border:0;background:#c7d2fe;border-radius:999px;cursor:pointer;width:22px;height:22px}' +
      '.odoc-type{font-size:12px;font-weight:600;white-space:nowrap}' +
      '.odoc-ord{cursor:pointer;color:var(--brand-indigo,#4f46e5);font-weight:700}' +
      '.odoc-sub{font-size:12px;color:var(--muted)}' +
      '.odoc-act{display:flex;gap:6px}.odoc-act .btn{padding:4px 9px;font-size:13px}' +
      '.odoc-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:14px}' +
      '.odoc-mod{background:var(--panel,#fff);color:var(--text-primary,#0f172a);border-radius:16px;padding:20px;width:100%;max-width:560px;max-height:92vh;overflow:auto;box-shadow:0 24px 60px rgba(15,23,42,.3)}' +
      '.odoc-mod h3{margin:0 0 14px}.odoc-mod .odoc-fld{margin-bottom:12px}.odoc-mod .input,.odoc-mod .select{width:100%;box-sizing:border-box}' +
      '.odoc-picklist{max-height:200px;overflow:auto;border:1.5px solid #cbd5e1;border-radius:10px;margin-top:6px}' +
      '.odoc-pick{padding:8px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid #e5e7eb}.odoc-pick:hover{background:#eef2ff}' +
      '.odoc-picked{padding:8px 10px;border-radius:10px;background:#ecfdf5;color:#065f46;font-size:13px;font-weight:600;display:flex;justify-content:space-between;gap:8px;align-items:center}' +
      '.odoc-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:520px){.odoc-grid2{grid-template-columns:1fr}}' +
      '.odoc-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}' +
      '.main-content[data-theme="dark"] .odoc-ofilter{background:rgba(99,102,241,.18);color:#c7d2fe}' +
      '.main-content[data-theme="dark"] .odoc-pick:hover{background:rgba(99,102,241,.15)}';
    document.head.appendChild(s);
  }

  function typeOptions(sel, withAll) {
    return (withAll ? '<option value="">' + esc(tt('odoc.allTypes', 'Toate tipurile')) + '</option>' : '') +
      TYPES.map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(typeLabel(k)) + '</option>'; }).join('');
  }

  function preset(kind) {
    var d = new Date();
    if (kind === 'month') { st.from = ymd(new Date(d.getFullYear(), d.getMonth(), 1)); st.to = ''; }
    else if (kind === 'prev') { st.from = ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)); st.to = ymd(new Date(d.getFullYear(), d.getMonth(), 0)); }
    else if (kind === 'd90') { var x = new Date(); x.setDate(x.getDate() - 90); st.from = ymd(x); st.to = ''; }
    else { st.from = ''; st.to = ''; }
    st.preset = kind;
    render(); load();
  }

  function mount(boxId) {
    ensureStyle();
    st.boxId = boxId || st.boxId || 'orderDocsBox';
    if (st.preset == null && !st.order_id) { preset('d90'); return; }
    render(); load();
  }

  function render() {
    var box = document.getElementById(st.boxId); if (!box) return;
    var pre = function (k, lbl) { return '<button class="odoc-chip' + (st.preset === k ? ' on' : '') + '" onclick="OrderDocs.preset(\'' + k + '\')">' + esc(lbl) + '</button>'; };
    box.innerHTML =
      '<div class="glass" style="padding:18px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">' +
        '<div class="h-title" style="margin:0">' + esc(tt('odoc.title', '📎 Documente curse')) + '</div>' +
        '<button class="btn primary" onclick="OrderDocs.openUpload()">' + esc(tt('odoc.upload', '➕ Încarcă document')) + '</button>' +
      '</div>' +
      '<div class="odoc-sub" style="margin-bottom:12px">' + esc(tt('odoc.hint', 'Factură, CMR, POD sau orice document, legat de o cursă — căutare ulterioară după cursă, client sau dată.')) + '</div>' +
      (st.order_id ? '<div class="odoc-ofilter">🚚 ' + esc(st.order_label || st.order_id) + ' <button title="✕" onclick="OrderDocs.clearOrder()">✕</button></div>' : '') +
      '<div class="odoc-tb">' +
        '<div class="odoc-fld odoc-q"><label>' + esc(tt('odoc.search', 'Căutare')) + '</label>' +
          '<input class="input" id="odocQ" value="' + esc(st.q) + '" placeholder="' + esc(tt('odoc.searchPh', 'Nr. cursă, client, fișier, nr. factură…')) + '" oninput="OrderDocs.onQ(this.value)"></div>' +
        '<div class="odoc-fld"><label>' + esc(tt('odoc.type', 'Tip')) + '</label><select class="select" onchange="OrderDocs.set(\'type\',this.value)">' + typeOptions(st.type, true) + '</select></div>' +
        '<div class="odoc-fld"><label>' + esc(tt('odoc.from', 'De la')) + '</label><input type="date" class="input" value="' + esc(st.from) + '" onchange="OrderDocs.set(\'from\',this.value)"></div>' +
        '<div class="odoc-fld"><label>' + esc(tt('odoc.to', 'Până la')) + '</label><input type="date" class="input" value="' + esc(st.to) + '" onchange="OrderDocs.set(\'to\',this.value)"></div>' +
      '</div>' +
      '<div class="odoc-presets">' + pre('month', tt('odoc.pMonth', 'Luna aceasta')) + pre('prev', tt('odoc.pPrev', 'Luna trecută')) +
        pre('d90', tt('odoc.p90', 'Ultimele 90 de zile')) + pre('all', tt('odoc.pAll', 'Toate')) + '</div>' +
      '<div id="odocList"><div class="odoc-sub">' + esc(tt('common.loading', 'Se încarcă…')) + '</div></div>' +
      '</div>';
  }

  function load() {
    var el = document.getElementById('odocList');
    gas('orderDocSearch', [{ q: st.q, doc_type: st.type, from: st.from, to: st.to, order_id: st.order_id }]).then(function (r) {
      el = document.getElementById('odocList'); if (!el) return;
      if (!r || !r.ok) { el.innerHTML = '<div class="odoc-sub">' + esc((r && r.err) || 'Eroare') + '</div>'; return; }
      st.rows = r.rows || [];
      if (!st.rows.length) { el.innerHTML = '<div class="odoc-sub" style="padding:16px 0">' + esc(tt('odoc.empty', 'Niciun document pentru filtrele alese.')) + '</div>'; return; }
      var html = '<div class="odoc-sub" style="margin-bottom:8px">' + esc(tt('odoc.count', '{n} documente', { n: st.rows.length })) +
        (r.truncated ? ' · ' + esc(tt('odoc.truncated', 'restrânge filtrul pentru mai multe')) : '') + '</div>' +
        '<div style="overflow-x:auto"><table class="table"><thead><tr>' +
        '<th>' + esc(tt('odoc.cDate', 'Dată')) + '</th><th>' + esc(tt('odoc.type', 'Tip')) + '</th><th>' + esc(tt('odoc.cFile', 'Document')) + '</th>' +
        '<th>' + esc(tt('odoc.cOrder', 'Cursă')) + '</th><th>' + esc(tt('odoc.cBy', 'Încărcat de')) + '</th><th></th></tr></thead><tbody>';
      st.rows.forEach(function (d) {
        html += '<tr>' +
          '<td style="white-space:nowrap">' + esc(dateStr(d.doc_date)) + '</td>' +
          '<td><span class="odoc-type">' + esc(typeLabel(d.doc_type)) + '</span></td>' +
          '<td><div style="font-weight:600;word-break:break-word">' + esc(d.file_name) + (d.has_signed ? ' <span title="✍️">✍️</span>' : '') + '</div>' +
            '<div class="odoc-sub">' + [d.ref_no ? '#' + esc(d.ref_no) : '', esc(fmtSize(d.file_size)), d.note ? esc(d.note) : ''].filter(Boolean).join(' · ') + '</div></td>' +
          '<td><span class="odoc-ord" onclick="OrderDocs.showForOrder(\'' + esc(d.order_id) + '\')">' + esc(d.fuvar_no || d.order_id) + '</span>' +
            '<div class="odoc-sub">' + esc([d.client, [d.loc_incarcare, d.loc_descarcare].filter(Boolean).map(function (s) { return String(s).split(',')[0]; }).join(' → ')].filter(Boolean).join(' · ')) + '</div></td>' +
          '<td class="odoc-sub">' + esc(d.uploaded_by || '') + '<br>' + esc(dateStr(d.created_at)) + '</td>' +
          '<td><div class="odoc-act">' +
            '<button class="btn" title="' + esc(tt('odoc.download', 'Descarcă')) + '" onclick="OrderDocs.download(' + d.id + ',\'original\')">⬇️</button>' +
            (d.has_signed ? '<button class="btn" title="✍️" onclick="OrderDocs.download(' + d.id + ',\'signed\')">✍️⬇️</button>' : '') +
            '<button class="btn" title="' + esc(tt('odoc.edit', 'Editează')) + '" onclick="OrderDocs.openEdit(' + d.id + ')">✏️</button>' +
            '<button class="btn danger" title="' + esc(tt('odoc.delete', 'Șterge')) + '" onclick="OrderDocs.del(' + d.id + ')">🗑</button>' +
          '</div></td></tr>';
      });
      el.innerHTML = html + '</tbody></table></div>';
    });
  }

  function set(k, v) { st[k] = v; if (k === 'from' || k === 'to') st.preset = ''; render(); load(); }
  function onQ(v) {
    st.q = v; clearTimeout(_qTimer);
    _qTimer = setTimeout(load, 300);
  }
  function clearOrder() { st.order_id = ''; st.order_label = ''; render(); load(); }

  function showForOrder(orderId) {
    var row = st.rows.filter(function (r) { return r.order_id === orderId; })[0];
    st.order_id = orderId; st.order_label = row ? orderLabel(row) : orderId;
    st.from = ''; st.to = ''; st.preset = 'all'; st.q = '';
    var pane = document.querySelector('.pane[data-pane="order-docs"]');
    if (pane && pane.classList.contains('hidden') && typeof activateTab === 'function') { activateTab('order-docs'); return; }
    mount(st.boxId);
  }

  function download(id, which) {
    gas('orderDocGet', [id, which || 'original']).then(function (r) {
      if (!r || !r.ok || !r.base64) { toast((r && r.err) || 'Eroare', 'err'); return; }
      var a = document.createElement('a');
      a.href = r.base64;
      a.download = (which === 'signed' ? 'semnat_' : '') + (r.fileName || 'document');
      document.body.appendChild(a); a.click(); a.remove();
    });
  }

  function del(id) {
    var d = st.rows.filter(function (r) { return r.id === id; })[0];
    if (!confirm(tt('odoc.delConfirm', 'Ștergi definitiv documentul „{f}"?', { f: d ? d.file_name : id }))) return;
    gas('orderDocDelete', [{ id: id }]).then(function (r) {
      if (r && r.ok) { toast(tt('odoc.deleted', 'Document șters'), 'ok'); load(); }
      else toast((r && r.err) || 'Eroare', 'err');
    });
  }

  function closeModal() { var o = document.getElementById('odocOv'); if (o) o.remove(); }

  // ── Fuvar-választó (feltöltésnél és átkötésnél közös) ─────────
  var _pick = null;
  function pickerHtml() {
    return '<div class="odoc-fld"><label>' + esc(tt('odoc.cOrder', 'Cursă')) + ' *</label>' +
      '<div id="odocPicked"></div>' +
      '<input class="input" id="odocPickQ" placeholder="' + esc(tt('odoc.pickPh', 'Caută cursa: nr., client, localitate…')) + '" oninput="OrderDocs._pickSearch(this.value)">' +
      '<div class="odoc-picklist" id="odocPickList"></div></div>';
  }
  function _renderPicked() {
    var el = document.getElementById('odocPicked'); if (!el) return;
    var q = document.getElementById('odocPickQ'), l = document.getElementById('odocPickList');
    if (_pick) {
      el.innerHTML = '<div class="odoc-picked"><span>🚚 ' + esc(_pick.label) + '</span><button class="btn" onclick="OrderDocs._pickClear()">✕</button></div>';
      if (q) q.style.display = 'none'; if (l) l.style.display = 'none';
    } else {
      el.innerHTML = ''; if (q) q.style.display = ''; if (l) l.style.display = '';
    }
  }
  function _pickSearch(v) {
    clearTimeout(_qTimer);
    _qTimer = setTimeout(function () {
      gas('orderDocOrderPick', [{ q: v || '' }]).then(function (r) {
        var l = document.getElementById('odocPickList'); if (!l) return;
        var rows = (r && r.rows) || [];
        window._odocPickRows = rows;
        l.innerHTML = rows.length ? rows.map(function (o, i) {
          return '<div class="odoc-pick" onclick="OrderDocs._pickSet(' + i + ')"><b>' + esc(o.fuvar_no || o.id) + '</b> · ' +
            esc([o.client, [o.loc_incarcare, o.loc_descarcare].filter(Boolean).map(function (s) { return String(s).split(',')[0]; }).join(' → '), dateStr(o.data_incarcare)].filter(Boolean).join(' · ')) + '</div>';
        }).join('') : '<div class="odoc-pick" style="cursor:default">' + esc(tt('odoc.noOrder', 'Nicio cursă găsită')) + '</div>';
      });
    }, 250);
  }
  function _pickSet(i) {
    var o = (window._odocPickRows || [])[i]; if (!o) return;
    _pick = { id: o.id, label: orderLabel(o) }; _renderPicked();
    if (document.getElementById('odocCheck')) _inspect();
  }
  function _pickClear() { _pick = null; _renderPicked(); _pickSearch(''); if (document.getElementById('odocCheck')) _inspect(); }

  function metaFields(d) {
    d = d || {};
    return '<div class="odoc-grid2">' +
      '<div class="odoc-fld"><label>' + esc(tt('odoc.type', 'Tip')) + '</label><select class="select" id="odocType">' + typeOptions(d.doc_type || 'invoice', false) + '</select></div>' +
      '<div class="odoc-fld"><label>' + esc(tt('odoc.docDate', 'Data documentului')) + '</label><input type="date" class="input" id="odocDate" value="' + esc(d.doc_date ? dateStr(d.doc_date) : today()) + '"></div>' +
      '</div>' +
      '<div class="odoc-fld"><label>' + esc(tt('odoc.refNo', 'Nr. document (ex. nr. factură)')) + '</label><input class="input" id="odocRef" maxlength="100" value="' + esc(d.ref_no || '') + '"></div>' +
      '<div class="odoc-fld"><label>' + esc(tt('odoc.note', 'Observații')) + '</label><input class="input" id="odocNote" maxlength="500" value="' + esc(d.note || '') + '"></div>';
  }
  function readMeta() {
    return {
      doc_type: document.getElementById('odocType').value,
      doc_date: document.getElementById('odocDate').value,
      ref_no: document.getElementById('odocRef').value,
      note: document.getElementById('odocNote').value
    };
  }

  function openUpload(orderId, label, docType) {
    ensureStyle(); closeModal();
    _pick = orderId ? { id: orderId, label: label || orderId } : null;
    if (orderId && !label) {
      var c = (window._ordersAllCache || []).filter(function (o) { return o.id === orderId; })[0];
      if (c) _pick.label = orderLabel(c);
    }
    var ov = document.createElement('div');
    ov.className = 'odoc-ov'; ov.id = 'odocOv';
    ov.onclick = function (e) { if (e.target === ov) closeModal(); };
    ov.innerHTML = '<div class="odoc-mod"><h3>' + esc(tt('odoc.upload', '➕ Încarcă document')) + '</h3>' +
      pickerHtml() +
      '<div class="odoc-fld"><label>' + esc(tt('odoc.files', 'Fișier(e)')) + ' *</label>' +
        '<input type="file" class="input" id="odocFiles" multiple accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.xml,.txt,.csv,.zip" onchange="OrderDocs._inspect()"></div>' +
      '<div id="odocCheck"></div>' +
      metaFields() +
      '<div class="odoc-sub" id="odocProg"></div>' +
      '<div class="odoc-foot"><button class="btn ghost" onclick="OrderDocs.closeModal()">' + esc(tt('common.cancel', 'Anulează')) + '</button>' +
      '<button class="btn primary" id="odocGo" onclick="OrderDocs.doUpload()">' + esc(tt('odoc.save', '💾 Salvează')) + '</button></div></div>';
    document.body.appendChild(ov);
    if (docType) { var ty = document.getElementById('odocType'); if (ty && ty.querySelector('option[value="' + docType + '"]')) ty.value = docType; }
    _renderPicked();
    if (!_pick) _pickSearch('');
  }

  function readFile(f) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(new Error('read')); };
      r.readAsDataURL(f);
    });
  }

  // ── Számla-kiolvasás AI NÉLKÜL (PDF szövegréteg) + megrendelő-egyezés ─────────
  function fixMime(f, data) {
    if (data.indexOf('data:;base64,') === 0 || data.indexOf('data:application/octet-stream') === 0) {
      var ext = (f.name.split('.').pop() || '').toLowerCase();
      var mt = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', xml: 'application/xml', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip' }[ext];
      if (mt) data = 'data:' + mt + ';base64,' + data.split(',')[1];
    }
    return data;
  }
  function isPdf(f) { return /pdf/i.test(f.type || '') || /\.pdf$/i.test(f.name || ''); }
  function checkHtml(r) {
    var box = function (cls, txt) {
      var c = { ok: '#ecfdf5;color:#065f46;border-color:#6ee7b7', warn: '#fffbeb;color:#92400e;border-color:#fcd34d', info: '#eff6ff;color:#1e40af;border-color:#93c5fd' }[cls];
      return '<div style="margin:0 0 12px;padding:9px 12px;border:1.5px solid;border-radius:10px;font-size:13px;background:' + c + '">' + txt + '</div>';
    };
    if (!r || !r.ok) return '';
    if (r.supported === false) return box('info', esc(tt('odoc.chk.notPdf', 'Doar PDF-ul generat de programul de facturare poate fi citit automat — completează câmpurile manual.')));
    if (r.scanned) return box('info', esc(tt('odoc.chk.scanned', 'PDF scanat/fotografiat: nu conține text — completează câmpurile manual.')));
    var h = '';
    if (r.invoice_no || r.date) h += '🧾 <b>' + esc(r.invoice_no || '—') + '</b>' + (r.date ? ' · ' + esc(r.date.split('-').reverse().join('.')) : '');
    else h += esc(tt('odoc.chk.noData', 'Nu am găsit nr. și data facturii în PDF.'));
    var f = r.found || {}, e = r.expected || {};
    var who = esc([f.name, f.cui ? 'CUI ' + f.cui : ''].filter(Boolean).join(' · '));
    if (r.match === 'client') return box('ok', h + '<br>✅ ' + esc(tt('odoc.chk.client', 'Clientul de pe factură corespunde cursei: {n}', { n: e.name || f.name || '' })));
    if (r.match === 'carrier') return box('ok', h + '<br>✅ ' + esc(tt('odoc.chk.carrier', 'Factură de la subcontractorul cursei: {n}', { n: e.carrier || '' })));
    if (r.match === 'mismatch') return box('warn', h + '<br>⚠️ ' + esc(tt('odoc.chk.mismatch', 'Atenție, pe factură apare:')) +
      ' <b>' + who + '</b> — ' + esc(tt('odoc.chk.expected', 'clientul cursei')) + ': <b>' + esc(e.name || '—') + '</b>');
    if (!_pick) return box('info', h + '<br>' + esc(tt('odoc.chk.pickOrder', 'Alege cursa pentru verificarea clientului.')));
    return box('info', h);
  }
  var _autoFilled = { ref: '', date: '' }, _inspSeq = 0;
  function _inspect() {
    var el = document.getElementById('odocCheck'); if (!el) return;
    var inp = document.getElementById('odocFiles');
    var files = Array.prototype.slice.call((inp && inp.files) || []);
    var f = files.filter(isPdf)[0] || files[0];
    if (!f) { el.innerHTML = ''; return; }
    if (!isPdf(f)) { el.innerHTML = checkHtml({ ok: true, supported: false }); return; }
    if (f.size > 15 * 1024 * 1024) { el.innerHTML = ''; return; }
    var seq = ++_inspSeq;
    el.innerHTML = '<div class="odoc-sub" style="margin-bottom:10px">⏳ ' + esc(tt('odoc.chk.reading', 'Citesc factura…')) + '</div>';
    readFile(f).then(function (data) {
      return gas('orderDocInspect', [{ data: fixMime(f, data), order_id: _pick ? _pick.id : null }]);
    }).then(function (r) {
      if (seq !== _inspSeq || !document.getElementById('odocCheck')) return;
      el.innerHTML = checkHtml(r);
      if (!r || !r.ok) return;
      var ref = document.getElementById('odocRef'), dt = document.getElementById('odocDate'), ty = document.getElementById('odocType');
      if (r.invoice_no && ref && (!ref.value || ref.value === _autoFilled.ref)) { ref.value = r.invoice_no; _autoFilled.ref = r.invoice_no; }
      if (r.date && dt && (!dt.value || dt.value === today() || dt.value === _autoFilled.date)) { dt.value = r.date; _autoFilled.date = r.date; }
      if (r.invoice_no && ty) ty.value = 'invoice';
    }).catch(function () { if (seq === _inspSeq) el.innerHTML = ''; });
  }

  function doUpload() {
    if (!_pick) { toast(tt('odoc.needOrder', 'Alege cursa.'), 'err'); return; }
    var files = Array.prototype.slice.call(document.getElementById('odocFiles').files || []);
    if (!files.length) { toast(tt('odoc.needFile', 'Alege cel puțin un fișier.'), 'err'); return; }
    var big = files.filter(function (f) { return f.size > 15 * 1024 * 1024; })[0];
    if (big) { toast(tt('odoc.tooBig', 'Fișier prea mare (max. 15 MB): {f}', { f: big.name }), 'err'); return; }
    var meta = readMeta(), btn = document.getElementById('odocGo'), prog = document.getElementById('odocProg');
    btn.disabled = true;
    var ok = 0, i = 0, orderId = _pick.id;
    function next() {
      if (i >= files.length) {
        btn.disabled = false;
        if (ok) toast(tt('odoc.uploaded', '{n} document(e) încărcat(e)', { n: ok }), 'ok');
        if (ok === files.length) closeModal();
        if (document.getElementById('odocList')) load();
        return;
      }
      var f = files[i++];
      prog.textContent = '⏳ ' + i + '/' + files.length + ' · ' + f.name;
      readFile(f).then(function (data) {
        data = fixMime(f, data);
        var m = Object.assign({}, meta);
        // Több fájlnál minden PDF a SAJÁT számlaszámát/dátumát kapja (AI nélkül kiolvasva).
        if (files.length > 1 && isPdf(f)) {
          return gas('orderDocInspect', [{ data: data, order_id: orderId }]).then(function (r) {
            if (r && r.ok && r.invoice_no) { m.ref_no = r.invoice_no; m.doc_type = 'invoice'; }
            if (r && r.ok && r.date) m.doc_date = r.date;
            if (r && r.match === 'mismatch') toast('⚠️ ' + f.name + ': ' + tt('odoc.chk.mismatchShort', 'clientul de pe factură nu corespunde cursei'), 'err');
            return gas('orderDocAdd', [Object.assign({ order_id: orderId, file_name: f.name, data: data }, m)]);
          }, function () { return gas('orderDocAdd', [Object.assign({ order_id: orderId, file_name: f.name, data: data }, m)]); });
        }
        return gas('orderDocAdd', [Object.assign({ order_id: orderId, file_name: f.name, data: data }, m)]);
      }).then(function (r) {
        if (r && r.ok) ok++;
        else toast(f.name + ': ' + ((r && r.err) || 'Eroare'), 'err');
        next();
      }).catch(function () { toast(f.name + ': Eroare', 'err'); next(); });
    }
    next();
  }

  function openEdit(id) {
    var d = st.rows.filter(function (r) { return r.id === id; })[0]; if (!d) return;
    ensureStyle(); closeModal();
    _pick = { id: d.order_id, label: orderLabel(d) };
    var ov = document.createElement('div');
    ov.className = 'odoc-ov'; ov.id = 'odocOv';
    ov.onclick = function (e) { if (e.target === ov) closeModal(); };
    ov.innerHTML = '<div class="odoc-mod"><h3>✏️ ' + esc(d.file_name) + '</h3>' + pickerHtml() + metaFields(d) +
      '<div class="odoc-foot"><button class="btn ghost" onclick="OrderDocs.closeModal()">' + esc(tt('common.cancel', 'Anulează')) + '</button>' +
      '<button class="btn primary" onclick="OrderDocs.doEdit(' + id + ')">' + esc(tt('odoc.save', '💾 Salvează')) + '</button></div></div>';
    document.body.appendChild(ov);
    _renderPicked();
  }
  function doEdit(id) {
    if (!_pick) { toast(tt('odoc.needOrder', 'Alege cursa.'), 'err'); return; }
    gas('orderDocUpdateMeta', [Object.assign({ id: id, order_id: _pick.id }, readMeta())]).then(function (r) {
      if (r && r.ok) { toast(tt('odoc.saved', 'Salvat'), 'ok'); closeModal(); load(); }
      else toast((r && r.err) || 'Eroare', 'err');
    });
  }

  return {
    mount: mount, preset: preset, set: set, onQ: onQ, clearOrder: clearOrder, showForOrder: showForOrder,
    download: download, del: del, openUpload: openUpload, doUpload: doUpload, openEdit: openEdit, doEdit: doEdit,
    closeModal: closeModal, _inspect: _inspect, _pickSearch: _pickSearch, _pickSet: _pickSet, _pickClear: _pickClear
  };
})();
