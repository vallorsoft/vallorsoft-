// ============================================================
//  VallorSoft — Statisztika 2.0 — Közös drill-in adatlap modal
//  Publikus API: VS_STATS_V2_DETAIL.open('driver'|'vehicle'|'client', arg)
//    driver:  arg = { email }
//    vehicle: arg = { id, plate? }
//    client:  arg = { id, name? }
//
//  A modal a MEGLÉVŐ handlers/entityDetail.js handlereket hívja:
//    - getDriverDetail(email)   → { driver, expiries, advanceTotal }
//    - getVehicleDetail(id)     → { vehicle, expiries, service, fuel, fuelTotal }
//    - getClientProfile(id)     → { client, orders, invoices, portal }
//
//  Csak olvasás — a szerkesztés/számlázás/POD-feltöltés a MÁR LÉTEZŐ
//  moduloké; ez a modal read-only áttekintés + linkek.
// ============================================================

(function () {
  'use strict';

  var $t = (typeof t === 'function') ? t : function (k) { return k; };
  var $esc = (typeof esc === 'function') ? esc : function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  function fnum(n, dec) {
    var v = parseFloat(n);
    if (!isFinite(v)) return '—';
    return v.toLocaleString('hu-HU', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 2 : dec });
  }
  function fdate(d) { return d ? new Date(d).toLocaleDateString('hu-HU') : '—'; }
  function fdt(d) { return d ? new Date(d).toLocaleString('hu-HU') : '—'; }

  // ── Modal shell ────────────────────────────────────────
  function open(kind, arg) {
    closeModal();
    var ov = document.createElement('div');
    ov.id = 'sv2DetailModal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px;';
    ov.onclick = function (e) { if (e.target === ov) closeModal(); };
    ov.innerHTML = ''
      + '<div class="sv2-panel sv2-detail-shell" style="max-width:960px;width:100%;max-height:92vh;overflow:auto;padding:0;">'
      +   '<div class="sv2-detail-head">'
      +     '<div class="sv2-detail-title">' + $t('sv2.det.loading') + '</div>'
      +     '<button class="btn ghost" style="padding:6px 12px;" onclick="VS_STATS_V2_DETAIL.close()">✕</button>'
      +   '</div>'
      +   '<div class="sv2-detail-body" id="sv2DetBody">'
      +     '<div class="sv2-empty" style="padding:40px;">' + $t('sv2.ov.loading') + '</div>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(ov);

    // Fetch + render
    if (kind === 'driver') fetchDriver(arg);
    else if (kind === 'vehicle') fetchVehicle(arg);
    else if (kind === 'client') fetchClient(arg);
    else renderError($t('sv2.det.badKind'));
  }
  function closeModal() {
    var ex = document.getElementById('sv2DetailModal');
    if (ex) ex.remove();
  }
  function setTitle(txt) {
    var h = document.querySelector('#sv2DetailModal .sv2-detail-title');
    if (h) h.textContent = txt;
  }
  function setBody(html) {
    var b = document.getElementById('sv2DetBody');
    if (b) b.innerHTML = html;
  }
  function renderError(msg) {
    setBody('<div class="sv2-empty" style="padding:30px;">' + $esc(msg) + '</div>');
  }

  // ── Sofőr ──────────────────────────────────────────────
  function fetchDriver(arg) {
    if (!arg || !arg.email) { renderError($t('sv2.det.emailMissing')); return; }
    gas('getDriverDetail', { email: arg.email }).then(function (r) {
      if (!r || !r.ok) { renderError((r && r.err) || $t('common.error')); return; }
      var d = r.driver;
      setTitle('👤 ' + (d.nume || d.email || arg.email));
      var expH = renderExpiries(r.expiries || []);
      var advH = r.advanceTotal
        ? '<div class="sv2-det-kpi-grid">'
          + kpiCard('💰 ' + $t('sv2.det.dr.advanceCount'), fnum(r.advanceTotal.db, 0))
          + kpiCard('💵 ' + $t('sv2.det.dr.advanceRon'), fnum(r.advanceTotal.ron, 0) + ' RON')
          + '</div>'
        : '';
      var meta = ''
        + rowInfo('📧 ' + $t('sv2.det.email'), d.email)
        + rowInfo('📞 ' + $t('sv2.det.phone'), d.tel);
      setBody(tabWrap('driver', d, meta, expH, advH));
    });
  }

  // ── Jármű ──────────────────────────────────────────────
  function fetchVehicle(arg) {
    if (!arg || !arg.id) { renderError($t('sv2.det.idMissing')); return; }
    gas('getVehicleDetail', { id: arg.id }).then(function (r) {
      if (!r || !r.ok) { renderError((r && r.err) || $t('common.error')); return; }
      var v = r.vehicle;
      setTitle('🚚 ' + (v.rendszam || '?'));
      var meta = ''
        + rowInfo($t('sv2.det.veh.model'), [v.marca, v.model, v.an].filter(Boolean).join(' • '))
        + rowInfo($t('sv2.det.veh.type'), v.tip)
        + rowInfo($t('sv2.det.veh.fuel'), v.fuel_per_100km ? fnum(v.fuel_per_100km, 1) + ' L/100km' : '—')
        + rowInfo($t('sv2.det.veh.trailer'), v.trailer_kind || '—');
      var ft = r.fuelTotal || {};
      var fuelKpi = '<div class="sv2-det-kpi-grid">'
        + kpiCard('⛽ ' + $t('sv2.det.veh.fuelTx'), fnum(ft.db, 0))
        + kpiCard('💧 ' + $t('sv2.det.veh.fuelLiters'), fnum(ft.litru, 0) + ' L')
        + kpiCard('💰 ' + $t('sv2.det.veh.fuelCost'), fnum(ft.suma, 0) + ' RON')
        + '</div>';
      var expH = renderExpiries(r.expiries || []);
      var svcH = renderService(r.service || []);
      var fuelH = renderFuelTx(r.fuel || []);
      setBody(vehicleTabs(v, meta, fuelKpi, expH, svcH, fuelH));
    });
  }

  // ── Ügyfél ─────────────────────────────────────────────
  function fetchClient(arg) {
    if (!arg || !arg.id) { renderError($t('sv2.det.idMissing')); return; }
    gas('getClientProfile', { id: arg.id }).then(function (r) {
      if (!r || !r.ok) { renderError((r && r.err) || $t('common.error')); return; }
      var c = r.client;
      setTitle('🏢 ' + (c.denumire || '?'));
      var meta = ''
        + rowInfo('CUI', c.cui_cif)
        + rowInfo('📧', c.email)
        + rowInfo('📞', c.telefon)
        + rowInfo($t('sv2.det.cl.paymentTerm'), c.payment_term_days != null ? fnum(c.payment_term_days, 0) + ' ' + $t('sv2.fin.days', { n: '' }).replace('{n}', '').trim() : '—');
      var ords = r.orders || [];
      var closed = ords.filter(function (o) { return o.status === 'Finalizat'; }).length;
      var kpi = '<div class="sv2-det-kpi-grid">'
        + kpiCard('📦 ' + $t('sv2.det.cl.orders'), fnum(ords.length, 0), fnum(closed, 0) + ' ' + $t('st.cClosed').toLowerCase())
        + kpiCard('💶 ' + $t('sv2.det.cl.totalRev'),
            fnum(ords.filter(function (o) { return o.status === 'Finalizat'; }).reduce(function (s, o) { return s + (parseFloat(o.pret) || 0); }, 0), 0) + ' EUR')
        + kpiCard('🧾 ' + $t('sv2.det.cl.invoices'), fnum((r.invoices || []).length, 0))
        + '</div>';
      var ordsTable = renderClientOrders(ords);
      var invTable = renderInvoices(r.invoices || []);
      setBody(clientTabs(meta, kpi, ordsTable, invTable));
    });
  }

  // ── Helper renderelők ──────────────────────────────────
  function rowInfo(lbl, val) {
    return '<div class="sv2-det-row"><span class="l">' + $esc(lbl) + '</span><span class="v">' + $esc(val || '—') + '</span></div>';
  }
  function kpiCard(lbl, val, sub) {
    return '<div class="sv2-det-kpi">'
      + '<div class="l">' + $esc(lbl) + '</div>'
      + '<div class="v">' + val + '</div>'
      + (sub ? '<div class="s">' + $esc(sub) + '</div>' : '')
      + '</div>';
  }
  function panel(title, body) {
    return '<div class="sv2-det-panel"><div class="sv2-det-panel-h">' + $esc(title) + '</div>' + body + '</div>';
  }

  function renderExpiries(list) {
    if (!list.length) return panel('📅 ' + $t('sv2.det.expiries'), '<div class="sv2-empty" style="padding:14px;">' + $t('sv2.ov.noData') + '</div>');
    var rows = list.map(function (e) {
      var dl = e.days_left;
      var sev = dl != null && dl <= 7 ? 'err' : dl != null && dl <= 30 ? 'warn' : 'ok';
      var lbl = dl == null ? '—' : (dl < 0 ? Math.abs(dl) + ' ' + $t('sv2.det.daysAgo') : dl + ' ' + $t('sv2.det.daysLeft'));
      return '<tr><td>' + $esc(e.doc_type || '—') + '</td>'
        + '<td>' + fdate(e.expiry_date) + '</td>'
        + '<td><span class="badge ' + sev + '">' + $esc(lbl) + '</span></td></tr>';
    }).join('');
    return panel('📅 ' + $t('sv2.det.expiries'),
      '<table class="table"><thead><tr>'
      + '<th>' + $t('sv2.det.docType') + '</th>'
      + '<th>' + $t('sv2.det.expDate') + '</th>'
      + '<th>' + $t('sv2.det.status') + '</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table>');
  }
  function renderService(list) {
    if (!list.length) return panel('🔧 ' + $t('sv2.det.veh.service'), '<div class="sv2-empty" style="padding:14px;">' + $t('sv2.ov.noData') + '</div>');
    var rows = list.slice(0, 15).map(function (s) {
      return '<tr>'
        + '<td>' + fdate(s.service_date) + '</td>'
        + '<td>' + $esc(s.category || '—') + '</td>'
        + '<td>' + $esc((s.description || '').slice(0, 60)) + '</td>'
        + '<td style="text-align:right;">' + fnum(s.km, 0) + '</td>'
        + '<td style="text-align:right;font-weight:700;">' + fnum(s.cost_ron, 0) + '</td>'
        + '</tr>';
    }).join('');
    return panel('🔧 ' + $t('sv2.det.veh.service'),
      '<div style="overflow-x:auto;"><table class="table"><thead><tr>'
      + '<th>' + $t('sv2.det.date') + '</th>'
      + '<th>' + $t('sv2.det.category') + '</th>'
      + '<th>' + $t('sv2.det.desc') + '</th>'
      + '<th style="text-align:right;">Km</th>'
      + '<th style="text-align:right;">RON</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>');
  }
  function renderFuelTx(list) {
    if (!list.length) return panel('⛽ ' + $t('sv2.det.veh.fuelHistory'), '<div class="sv2-empty" style="padding:14px;">' + $t('sv2.ov.noData') + '</div>');
    var rows = list.slice(0, 20).map(function (f) {
      return '<tr>'
        + '<td>' + fdate(f.tx_date) + '</td>'
        + '<td>' + $esc(f.product || '—') + '</td>'
        + '<td style="text-align:right;">' + fnum(f.qty_l, 1) + '</td>'
        + '<td style="text-align:right;">' + fnum(f.amount_ron, 0) + '</td>'
        + '</tr>';
    }).join('');
    return panel('⛽ ' + $t('sv2.det.veh.fuelHistory'),
      '<div style="overflow-x:auto;"><table class="table"><thead><tr>'
      + '<th>' + $t('sv2.det.date') + '</th>'
      + '<th>' + $t('sv2.det.product') + '</th>'
      + '<th style="text-align:right;">L</th>'
      + '<th style="text-align:right;">RON</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>');
  }
  function renderClientOrders(list) {
    if (!list.length) return panel('📦 ' + $t('sv2.det.cl.orders'), '<div class="sv2-empty" style="padding:14px;">' + $t('sv2.ov.noData') + '</div>');
    var rows = list.slice(0, 30).map(function (o) {
      var sc = { 'Finalizat': 'ok', 'In Curs': 'warn', 'Alocat': 'info', 'Disponibil': 'err', 'Anulat': 'err' }[o.status] || 'info';
      return '<tr>'
        + '<td><b style="font-size:11px;font-family:monospace;">' + $esc(String(o.id || '').slice(0, 12)) + '</b></td>'
        + '<td>' + $esc(o.loc_incarcare || '—') + ' → ' + $esc(o.loc_descarcare || '—') + '</td>'
        + '<td style="text-align:right;">' + fnum(o.km, 0) + '</td>'
        + '<td style="text-align:right;font-weight:700;">' + fnum(o.pret, 0) + '</td>'
        + '<td><span class="badge ' + sc + '">' + $esc(o.status) + '</span></td>'
        + '<td>' + fdate(o.created_at) + '</td>'
        + '</tr>';
    }).join('');
    return panel('📦 ' + $t('sv2.det.cl.orders'),
      '<div style="overflow-x:auto;"><table class="table"><thead><tr>'
      + '<th>ID</th>'
      + '<th>' + $t('sv2.det.route') + '</th>'
      + '<th style="text-align:right;">Km</th>'
      + '<th style="text-align:right;">EUR</th>'
      + '<th>' + $t('sv2.det.status') + '</th>'
      + '<th>' + $t('sv2.det.date') + '</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>');
  }
  function renderInvoices(list) {
    if (!list.length) return panel('🧾 ' + $t('sv2.det.cl.invoices'), '<div class="sv2-empty" style="padding:14px;">' + $t('sv2.ov.noData') + '</div>');
    var rows = list.slice(0, 30).map(function (i) {
      return '<tr>'
        + '<td>' + $esc((i.serie || '') + ' ' + (i.numar || '')) + '</td>'
        + '<td>' + $esc(i.provider || '—') + '</td>'
        + '<td style="text-align:right;font-weight:700;">' + fnum(i.total, 0) + ' ' + $esc(i.valuta || '') + '</td>'
        + '<td>' + $esc(i.status || '—') + '</td>'
        + '<td>' + fdate(i.created_at) + '</td>'
        + '</tr>';
    }).join('');
    return panel('🧾 ' + $t('sv2.det.cl.invoices'),
      '<div style="overflow-x:auto;"><table class="table"><thead><tr>'
      + '<th>' + $t('sv2.det.invNo') + '</th>'
      + '<th>' + $t('sv2.det.provider') + '</th>'
      + '<th style="text-align:right;">' + $t('sv2.det.total') + '</th>'
      + '<th>' + $t('sv2.det.status') + '</th>'
      + '<th>' + $t('sv2.det.date') + '</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>');
  }

  // ── Tab-elrendezés (közös) ────────────────────────────
  function tabWrap(kind, entity, metaH, expH, extraH) {
    return '<div class="sv2-det-cols">'
      +   '<div class="sv2-det-meta">' + metaH + (extraH || '') + '</div>'
      +   '<div class="sv2-det-main">' + expH + '</div>'
      + '</div>';
  }
  function vehicleTabs(v, meta, fuelKpi, expH, svcH, fuelH) {
    return '<div class="sv2-det-cols">'
      +   '<div class="sv2-det-meta">' + meta + fuelKpi + '</div>'
      +   '<div class="sv2-det-main">' + expH + svcH + fuelH + '</div>'
      + '</div>';
  }
  function clientTabs(meta, kpi, ords, inv) {
    return '<div class="sv2-det-cols">'
      +   '<div class="sv2-det-meta">' + meta + kpi + '</div>'
      +   '<div class="sv2-det-main">' + ords + inv + '</div>'
      + '</div>';
  }

  window.VS_STATS_V2_DETAIL = { open: open, close: closeModal };
})();
