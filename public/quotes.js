// public/quotes.js
// Árajánlatok (Quotes / Cotații) fül — admin + manager konzol.
// Önálló modul: Quotes.mount('quotesBox') a fül megnyitásakor.
// A meglévő gas()/toast()/t()/vsMetricBand/ClientPicker segédeket használja.
window.Quotes = (function () {
  function tt(key, fb) {
    try { if (typeof t === 'function') { var v = t(key); if (v && v !== key) return v; } } catch (e) {}
    return fb;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }
  var STATUSES = ['draft', 'sent', 'awarded', 'lost'];

  function ensureStyle() {
    if (document.getElementById('quotes-style')) return;
    var s = document.createElement('style');
    s.id = 'quotes-style';
    s.textContent =
      '.qt-wrap{max-width:1100px}' +
      '.qt-form{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}' +
      '.qt-fld{display:flex;flex-direction:column;gap:4px;min-width:150px}' +
      '.qt-fld label{font-size:12px;color:var(--muted)}' +
      '.qt-route{font-size:12px;color:var(--muted)}' +
      '.qt-st{font-size:11px;padding:2px 9px;border-radius:999px;font-weight:600;display:inline-block}' +
      '.qt-st--draft{background:#eef1f6;color:#5b6577}.qt-st--sent{background:#fff3e0;color:#b26a00}' +
      '.qt-st--awarded{background:#e7f6ec;color:#1a7f37}.qt-st--lost{background:#fde8e8;color:#c0341a}' +
      '.qt-act{font-size:12px;padding:4px 9px;border-radius:8px;border:1px solid var(--brand-indigo,#6366f1);background:transparent;color:var(--brand-indigo,#6366f1);cursor:pointer}' +
      '.main-content[data-theme="dark"] .qt-st--draft{background:rgba(255,255,255,.08);color:#8a97a8}' +
      '.main-content[data-theme="dark"] .qt-st--sent{background:rgba(245,158,11,.18);color:#f0b96b}';
    document.head.appendChild(s);
  }

  function stLabel(st) { return tt('qt.status.' + st, st); }

  function band(items) {
    var total = items.length;
    var pending = items.filter(function (x) { return x.status === 'sent'; }).length;
    var awarded = items.filter(function (x) { return x.status === 'awarded'; }).length;
    var val = items.reduce(function (s, x) { return s + (Number(x.price) || 0); }, 0);
    if (typeof vsMetricBand !== 'function') return '';
    return vsMetricBand([
      { l: tt('qt.kpiTotal', 'Összes'), v: total, sub: '' },
      { l: tt('qt.kpiPending', 'Függő'), v: pending, sub: tt('qt.status.sent', 'Trimisă') },
      { l: tt('qt.kpiAwarded', 'Elnyert'), v: awarded, sub: tt('qt.status.awarded', 'Câștigată') },
      { l: tt('qt.kpiValue', 'Érték'), v: val.toFixed(0) + ' €', sub: '' }
    ]);
  }

  function rows(items) {
    if (!items.length) {
      return '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:14px;">' +
        tt('qt.empty', 'Nu există cotații.') + '</td></tr>';
    }
    return items.map(function (q) {
      var route = esc((q.loc_from || '—') + ' → ' + (q.loc_to || '—'));
      var price = (q.price != null && q.price !== '') ? (Number(q.price).toFixed(2) + ' ' + esc(q.valuta || 'EUR')) : '—';
      var valid = q.valid_until ? esc(String(q.valid_until).slice(0, 10)) : '—';
      var st = '<span class="qt-st qt-st--' + esc(q.status) + '">' + esc(stLabel(q.status)) + '</span>';
      var stSel = '<select class="select qt-stsel" data-id="' + q.id + '" style="font-size:12px;padding:3px 6px;">' +
        STATUSES.map(function (s) {
          return '<option value="' + s + '"' + (s === q.status ? ' selected' : '') + '>' + esc(stLabel(s)) + '</option>';
        }).join('') + '</select>';
      var conv = '';
      if (q.order_id) {
        conv = '<span class="qt-route">→ #' + esc(q.order_id) + '</span>';
      } else {
        conv = '<button class="qt-act" data-toorder="' + q.id + '">' + tt('qt.toOrder', '→ Fuvar') + '</button>';
      }
      return '<tr>' +
        '<td><b>' + esc(q.client_name || '—') + '</b>' +
          (q.note ? '<div class="qt-route">' + esc(q.note) + '</div>' : '') + '</td>' +
        '<td class="qt-route">' + route + '</td>' +
        '<td>' + price + '</td>' +
        '<td>' + valid + '</td>' +
        '<td>' + st + ' ' + stSel + '</td>' +
        '<td>' + conv + ' <button class="qt-act" data-edit="' + q.id + '">' + tt('qt.edit', 'Editare') + '</button></td>' +
        '</tr>';
    }).join('');
  }

  var _root = null, _items = [], _editId = null, _clientId = null, _clientName = '';

  function render() {
    if (!_root) return;
    _root.innerHTML =
      '<div class="qt-wrap">' +
      '<h2 class="h-title" style="margin-top:0;">' + tt('qt.title', 'Árajánlatok') + '</h2>' +
      '<p style="color:var(--muted);font-size:13px;margin:0 0 14px;">' +
        tt('qt.intro', 'Cotații pentru transporturi potențiale — convertibile în comenzi.') + '</p>' +
      '<div id="qtBand" style="margin-bottom:16px;">' + band(_items) + '</div>' +
      '<div class="glass" style="padding:20px;margin-bottom:16px;">' +
        '<h3 style="margin-top:0;font-size:15px;">' + tt('qt.formTitle', 'Cotație nouă') + '</h3>' +
        '<div class="qt-form">' +
          '<div class="qt-fld" style="flex:1.4"><label>' + tt('qt.client', 'Client') + '</label>' +
            '<div id="qtClientPicker"></div><input type="hidden" id="qtClientId"></div>' +
          '<div class="qt-fld"><label>' + tt('qt.locFrom', 'Încărcare') + '</label><input class="input" id="qtFrom"></div>' +
          '<div class="qt-fld"><label>' + tt('qt.locTo', 'Descărcare') + '</label><input class="input" id="qtTo"></div>' +
          '<div class="qt-fld" style="min-width:110px"><label>' + tt('qt.price', 'Preț') + '</label><input class="input" id="qtPrice" type="number" step="0.01"></div>' +
          '<div class="qt-fld" style="min-width:90px"><label>' + tt('qt.valuta', 'Valută') + '</label>' +
            '<select class="select" id="qtValuta"><option>EUR</option><option>RON</option></select></div>' +
          '<div class="qt-fld" style="min-width:150px"><label>' + tt('qt.validUntil', 'Valabil până') + '</label><input class="input" id="qtValid" type="date"></div>' +
          '<div class="qt-fld" style="flex:1.2"><label>' + tt('qt.note', 'Notă') + '</label><input class="input" id="qtNote"></div>' +
          '<button class="btn primary" id="qtSaveBtn" style="padding:10px 18px;">' + tt('qt.save', 'Salvare') + '</button>' +
          '<button class="btn ghost" id="qtResetBtn" style="padding:10px 14px;display:none;">' + tt('qt.cancel', 'Anulare') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="glass" style="padding:20px;">' +
        '<table class="table"><thead><tr>' +
          '<th>' + tt('qt.col.client', 'Client') + '</th>' +
          '<th>' + tt('qt.col.route', 'Relație') + '</th>' +
          '<th>' + tt('qt.col.price', 'Preț') + '</th>' +
          '<th>' + tt('qt.col.valid', 'Valabil') + '</th>' +
          '<th>' + tt('qt.col.status', 'Status') + '</th>' +
          '<th>' + tt('qt.col.actions', 'Acțiuni') + '</th>' +
        '</tr></thead><tbody>' + rows(_items) + '</tbody></table>' +
      '</div>' +
      '</div>';

    // Ügyfél-választó (ClientPicker) — ha elérhető; különben szabad szöveg
    var cpBox = _root.querySelector('#qtClientPicker');
    if (cpBox && window.ClientPicker && typeof ClientPicker.mount === 'function') {
      ClientPicker.mount(cpBox, {
        hiddenInputId: 'qtClientId',
        onSelect: function (c) { _clientId = c.id; _clientName = c.denumire; }
      });
    } else if (cpBox) {
      cpBox.innerHTML = '<input class="input" id="qtClientName" placeholder="' + tt('qt.client', 'Client') + '">';
    }

    _root.querySelector('#qtSaveBtn').addEventListener('click', doSave);
    var rb = _root.querySelector('#qtResetBtn');
    if (rb) rb.addEventListener('click', resetForm);
    Array.prototype.forEach.call(_root.querySelectorAll('.qt-stsel'), function (sel) {
      sel.addEventListener('change', function () { doSetStatus(parseInt(sel.getAttribute('data-id'), 10), sel.value); });
    });
    Array.prototype.forEach.call(_root.querySelectorAll('[data-toorder]'), function (b) {
      b.addEventListener('click', function () { doToOrder(parseInt(b.getAttribute('data-toorder'), 10)); });
    });
    Array.prototype.forEach.call(_root.querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () { startEdit(parseInt(b.getAttribute('data-edit'), 10)); });
    });
  }

  function resetForm() {
    _editId = null; _clientId = null; _clientName = '';
    render();
  }

  function startEdit(id) {
    var q = _items.filter(function (x) { return x.id === id; })[0];
    if (!q) return;
    _editId = id; _clientId = q.client_id || null; _clientName = q.client_name || '';
    render();
    // Mezők kitöltése a szerkesztett ajánlattal
    function setV(idv, val) { var el = _root.querySelector(idv); if (el != null && el) el.value = val == null ? '' : val; }
    setV('#qtFrom', q.loc_from); setV('#qtTo', q.loc_to);
    setV('#qtPrice', q.price); setV('#qtValuta', q.valuta || 'EUR');
    setV('#qtValid', q.valid_until ? String(q.valid_until).slice(0, 10) : '');
    setV('#qtNote', q.note);
    var nameInput = _root.querySelector('#qtClientName'); if (nameInput) nameInput.value = q.client_name || '';
    var cpIn = _root.querySelector('#qtClientPicker .cp-in'); if (cpIn) cpIn.value = q.client_name || '';
    var rb = _root.querySelector('#qtResetBtn'); if (rb) rb.style.display = '';
    var sb = _root.querySelector('#qtSaveBtn'); if (sb) sb.textContent = tt('qt.update', 'Actualizare');
  }

  function readForm() {
    function v(idv) { var el = _root.querySelector(idv); return el ? el.value : ''; }
    var hid = _root.querySelector('#qtClientId');
    var clientId = hid && hid.value ? parseInt(hid.value, 10) : (_clientId || null);
    var cpIn = _root.querySelector('#qtClientPicker .cp-in');
    var nameInput = _root.querySelector('#qtClientName');
    var clientName = (cpIn && cpIn.value.trim()) || (nameInput && nameInput.value.trim()) || _clientName || '';
    return {
      id: _editId || undefined,
      client_id: clientId,
      client_name: clientName,
      loc_from: v('#qtFrom').trim(),
      loc_to: v('#qtTo').trim(),
      price: v('#qtPrice'),
      valuta: v('#qtValuta') || 'EUR',
      valid_until: v('#qtValid') || null,
      note: v('#qtNote').trim()
    };
  }

  function doSave() {
    var p = readForm();
    if (!p.client_name && !p.client_id) { toast(tt('qt.clientRequired', 'Clientul este obligatoriu.'), 'err'); return; }
    gas('quoteSave', [p]).then(function (r) {
      if (r && r.ok) { toast(tt('common.savedOk', 'Salvat'), 'ok'); resetForm(); reload(); }
      else toast((r && r.err) || tt('common.error', 'Eroare'), 'err');
    });
  }

  function doSetStatus(id, status) {
    gas('quoteSetStatus', [{ id: id, status: status }]).then(function (r) {
      if (r && r.ok) { toast(tt('common.savedOk', 'Salvat'), 'ok'); reload(); }
      else { toast((r && r.err) || tt('common.error', 'Eroare'), 'err'); reload(); }
    });
  }

  function doToOrder(id) {
    if (!window.confirm(tt('qt.toOrderConfirm', 'Convertești cotația în comandă?'))) return;
    gas('quoteToOrder', [{ id: id }]).then(function (r) {
      if (r && r.ok) {
        toast(tt('qt.toOrderOk', 'Comandă creată') + (r.order_id ? ' #' + r.order_id : ''), 'ok');
        // Ugrás a fuvarlistára
        if (typeof activateTab === 'function') activateTab('orders-list');
      } else toast((r && r.err) || tt('common.error', 'Eroare'), 'err');
    });
  }

  function reload() {
    if (!_root) return;
    gas('quoteList', [{}]).then(function (r) {
      _items = (r && r.ok && r.items) ? r.items : [];
      render();
    }).catch(function () { _items = []; render(); });
  }

  function mount(target) {
    var el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) { console.warn('quotes.js: nincs konténer'); return; }
    ensureStyle();
    _root = el; _editId = null; _clientId = null; _clientName = '';
    el.innerHTML = '<div style="padding:14px;color:var(--muted)">…</div>';
    reload();
  }

  return { mount: mount };
})();
