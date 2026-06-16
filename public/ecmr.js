// public/ecmr.js
// e-CMR (digitális CMR fuvarlevél) fül — admin + manager konzol.
// Önálló modul: ECmr.mount('ecmrBox') a fül megnyitásakor.
// A meglévő gas()/toast()/t() segédeket használja (console-shared.js + i18n.js).
window.ECmr = (function () {
  function tt(key, fb) {
    try { if (typeof t === 'function') { var v = t(key); if (v && v !== key) return v; } } catch (e) {}
    return fb;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }
  function ensureStyle() {
    if (document.getElementById('ecmr-style')) return;
    var s = document.createElement('style');
    s.id = 'ecmr-style';
    s.textContent =
      '.ecmr-wrap{max-width:1000px}' +
      '.ecmr-top{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px}' +
      '.ecmr-card{display:flex;flex-direction:column;gap:6px}' +
      '.ecmr-pill{font-size:11px;padding:2px 8px;border-radius:999px;white-space:nowrap}' +
      '.ecmr-pill--ok{background:#e7f6ec;color:#1a7f37}' +
      '.ecmr-pill--wait{background:#eef1f6;color:#5b6577}' +
      '.ecmr-st{font-size:11px;padding:2px 9px;border-radius:999px;font-weight:600}' +
      '.ecmr-st--draft{background:#eef1f6;color:#5b6577}.ecmr-st--partial{background:#fff3e0;color:#b26a00}' +
      '.ecmr-st--completed{background:#e7f6ec;color:#1a7f37}.ecmr-st--cancelled{background:#fde8e8;color:#c0341a}' +
      '.ecmr-parties{display:flex;gap:6px;flex-wrap:wrap}' +
      '.ecmr-sign{font-size:12px;padding:4px 10px;border-radius:8px;border:1px solid var(--brand-indigo,#6366f1);background:transparent;color:var(--brand-indigo,#6366f1);cursor:pointer}' +
      '.main-content[data-theme="dark"] .ecmr-pill--wait{background:rgba(255,255,255,.08);color:#8a97a8}' +
      '.main-content[data-theme="dark"] .ecmr-st--draft{background:rgba(255,255,255,.08);color:#8a97a8}';
    document.head.appendChild(s);
  }

  function statusLabel(st) {
    return tt('ecmr.status.' + st, st);
  }

  function partyPill(name, signedAt, partyLabel) {
    if (signedAt) {
      return '<span class="ecmr-pill ecmr-pill--ok" title="' + esc(name || '') + '">' +
        partyLabel + ' ✓</span>';
    }
    return '<span class="ecmr-pill ecmr-pill--wait">' + partyLabel + ' ' + tt('ecmr.wait', 'vár') + '</span>';
  }

  function render(root, items) {
    var pSender = tt('ecmr.sender', 'Feladó');
    var pCarrier = tt('ecmr.carrier', 'Fuvarozó');
    var pConsignee = tt('ecmr.consignee', 'Címzett');
    var rows;
    if (!items.length) {
      rows = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:14px;">' +
        tt('ecmr.empty', 'Nincs e-CMR.') + '</td></tr>';
    } else {
      rows = items.map(function (e) {
        var route = esc((e.loc_incarcare || '') + ' → ' + (e.loc_descarcare || ''));
        var parties =
          partyPill(e.sender_name, e.sender_signed_at, pSender) +
          partyPill(e.carrier_name, e.carrier_signed_at, pCarrier) +
          partyPill(e.consignee_name, e.consignee_signed_at, pConsignee);
        var st = '<span class="ecmr-st ecmr-st--' + esc(e.status) + '">' + esc(statusLabel(e.status)) + '</span>';
        var signBtns = '';
        if (e.status !== 'cancelled' && e.status !== 'completed') {
          signBtns =
            '<button class="ecmr-sign" data-sign="' + e.id + '" data-party="sender">' + esc(pSender) + '</button> ' +
            '<button class="ecmr-sign" data-sign="' + e.id + '" data-party="carrier">' + esc(pCarrier) + '</button> ' +
            '<button class="ecmr-sign" data-sign="' + e.id + '" data-party="consignee">' + esc(pConsignee) + '</button>';
        }
        return '<tr>' +
          '<td>#' + e.id + '</td>' +
          '<td>' + esc(e.client || '—') + (e.ref ? ' <span style="color:var(--muted)">(' + esc(e.ref) + ')</span>' : '') +
            '<div style="font-size:12px;color:var(--muted)">' + route + '</div></td>' +
          '<td><div class="ecmr-parties">' + parties + '</div></td>' +
          '<td>' + st + '</td>' +
          '<td>' + signBtns + '</td>' +
          '</tr>';
      }).join('');
    }
    root.innerHTML =
      '<div class="ecmr-wrap">' +
      '<div class="glass" style="padding:22px;margin-bottom:16px;">' +
        '<h2 class="h-title" style="margin-top:0;">' + tt('ecmr.title', '📝 e-CMR') + '</h2>' +
        '<p style="color:var(--muted);font-size:13px;margin:0 0 14px;">' +
          tt('ecmr.intro', 'CMR digital semnat de expeditor, transportator si destinatar.') + '</p>' +
        '<div class="ecmr-top">' +
          '<div class="ecmr-card" style="flex:1;min-width:160px;">' +
            '<label style="font-size:12px;color:var(--muted)">' + tt('ecmr.pickOrder', 'Fuvar (comanda)') + '</label>' +
            '<select class="select" id="ecmrOrderSel"><option value="">…</option></select>' +
          '</div>' +
          '<button class="btn primary" id="ecmrCreateBtn" style="padding:10px 18px;">' +
            tt('ecmr.create', 'Creare e-CMR') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="glass" style="padding:22px;">' +
        '<table class="table" id="ecmrTbl"><thead><tr>' +
          '<th>#</th>' +
          '<th>' + tt('ecmr.col.order', 'Comanda') + '</th>' +
          '<th>' + tt('ecmr.col.parties', 'Semnaturi') + '</th>' +
          '<th>' + tt('ecmr.col.status', 'Status') + '</th>' +
          '<th>' + tt('ecmr.col.sign', 'Semneaza') + '</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div>' +
      '</div>';

    // Aláírás gombok
    Array.prototype.forEach.call(root.querySelectorAll('.ecmr-sign'), function (b) {
      b.addEventListener('click', function () {
        doSign(parseInt(b.getAttribute('data-sign'), 10), b.getAttribute('data-party'));
      });
    });
    root.querySelector('#ecmrCreateBtn').addEventListener('click', doCreate);
  }

  function loadOrders(root) {
    return gas('comList', []).then(function (list) {
      var sel = root.querySelector('#ecmrOrderSel');
      if (!sel || !Array.isArray(list)) return;
      var opts = '<option value="">…</option>' + list.map(function (o) {
        var lbl = '#' + o.id + ' · ' + (o.client || '—') + ' · ' +
          (o.loc_incarcare || '') + '→' + (o.loc_descarcare || '');
        return '<option value="' + o.id + '">' + esc(lbl) + '</option>';
      }).join('');
      sel.innerHTML = opts;
    }).catch(function () {});
  }

  function doCreate() {
    var sel = document.getElementById('ecmrOrderSel');
    var orderId = sel && parseInt(sel.value, 10);
    if (!orderId) { toast(tt('ecmr.pickOrderFirst', 'Selecteaza o comanda.'), 'err'); return; }
    gas('ecmrCreate', [orderId]).then(function (r) {
      if (r && r.ok) { toast(tt('common.savedOk', 'Salvat'), 'ok'); reload(); }
      else toast((r && r.err) || tt('common.error', 'Eroare'), 'err');
    });
  }

  function doSign(id, party) {
    var name = window.prompt(tt('ecmr.signPrompt', 'Numele semnatarului:'));
    if (name == null) return;
    name = String(name).trim();
    if (!name) { toast(tt('ecmr.nameRequired', 'Numele este obligatoriu.'), 'err'); return; }
    gas('ecmrSign', [{ ecmr_id: id, party: party, name: name }]).then(function (r) {
      if (r && r.ok) { toast(tt('common.savedOk', 'Salvat'), 'ok'); reload(); }
      else toast((r && r.err) || tt('common.error', 'Eroare'), 'err');
    });
  }

  var _root = null;
  function reload() {
    if (!_root) return;
    gas('ecmrList', []).then(function (r) {
      var items = (r && r.ok && r.items) ? r.items : [];
      render(_root, items);
      loadOrders(_root);
    }).catch(function () { render(_root, []); });
  }

  function mount(target) {
    var el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) { console.warn('ecmr.js: nincs konténer'); return; }
    ensureStyle();
    _root = el;
    el.innerHTML = '<div style="padding:14px;color:var(--muted)">…</div>';
    reload();
  }

  return { mount: mount };
})();
