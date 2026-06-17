// ============================================================
//  VallorSoft — public/entity-detail.js
//  Entitás-részletek (jármű / sofőr) füles drill-in panel.
//  A MEGLÉVŐ lejárat/szerviz/üzemanyag adatot mutatja az adott
//  entitásra szűrve (getVehicleDetail / getDriverDetail RPC),
//  és az ADD a MÁR LÉTEZŐ, auditált handlereken megy keresztül
//  (expirySave / serviceCreate) — előre kitöltött entitással.
//  Önálló modul mindkét konzolhoz; nincs duplikált save-logika.
//  Közös segédek: gas, toast, t, esc, vsAvatar.
// ============================================================
(function () {
  'use strict';

  var T = { type: null, id: null, plate: null, email: null, nume: null, tab: 'data' };

  function _t(k, d) {
    try { var v = (typeof t === 'function') ? t(k) : null; return (v && v !== k) ? v : (d || k); }
    catch (e) { return d || k; }
  }
  function _esc(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s); }
  function _toast(m, k) { if (typeof toast === 'function') toast(m, k || 'ok'); }

  // ── Modal-váz beinjektálása (egyszer, duplikáció-mentes) ──
  function ensureModal() {
    if (document.getElementById('entityDetailModal')) return;
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.id = 'entityDetailModal';
    back.innerHTML =
      '<div class="modal glass" style="width:min(880px,100%);max-height:92vh;">'
      + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">'
      + '<div id="edTitle" style="display:flex;align-items:center;gap:12px;font-size:19px;font-weight:700;color:var(--text-primary);"></div>'
      + '<button class="btn ghost" style="padding:4px 12px;" onclick="EntityDetail.close()">✕</button>'
      + '</div>'
      + '<div id="edTabs" style="display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 12px;border-bottom:1px solid var(--glass-border-dark);padding-bottom:10px;"></div>'
      + '<div id="edBody" style="min-height:160px;"></div>'
      + '</div>';
    document.body.appendChild(back);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
  }

  function open() { ensureModal(); document.getElementById('entityDetailModal').classList.add('open'); }
  function close() { var m = document.getElementById('entityDetailModal'); if (m) m.classList.remove('open'); }

  function tabBtn(key, label) {
    var on = T.tab === key;
    return '<button class="btn ' + (on ? 'primary' : 'ghost') + '" style="padding:6px 14px;font-size:13px;" '
      + 'onclick="EntityDetail.setTab(\'' + key + '\')">' + label + '</button>';
  }

  function renderTabs() {
    var tabs = document.getElementById('edTabs');
    if (!tabs) return;
    var html = tabBtn('data', _t('ed.tab.data', 'Date'))
      + tabBtn('expiries', _t('ed.tab.expiries', 'Documente & Expirări'));
    if (T.type === 'vehicle') {
      html += tabBtn('service', _t('ed.tab.service', 'Service'));
      html += tabBtn('fuel', _t('ed.tab.fuel', 'Alimentări'));
    } else if (T.type === 'driver' && T._hasAdvance) {
      html += tabBtn('decont', _t('ed.tab.decont', 'Decont'));
    }
    tabs.innerHTML = html;
  }

  function setTab(k) { T.tab = k; renderTabs(); renderBody(); }

  // ── Dátum / szám segédek ──
  function ymd(d) { if (!d) return ''; var s = String(d); return s.length >= 10 ? s.slice(0, 10) : s; }
  function d2(d) { var s = ymd(d); return s || '—'; }
  function n2(v, dec) { if (v == null || v === '') return '—'; var n = parseFloat(v); if (!isFinite(n)) return '—'; return n.toLocaleString('ro-RO', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }); }

  function daysBadge(dl) {
    if (dl == null) return '';
    var cls = dl < 0 ? 'err' : dl <= 14 ? 'warn' : 'ok';
    var txt = dl < 0 ? _t('ed.expired', 'Expirat') : dl + ' ' + _t('ed.days', 'zile');
    return '<span class="badge ' + cls + '">' + txt + '</span>';
  }

  // ════════════════ ADATOK fül ════════════════
  function bodyData() {
    var box = document.getElementById('edBody');
    if (T.type === 'vehicle') {
      var v = T._data.vehicle || {};
      var rows = [
        [_t('col.plate', 'Nr. înmatriculare'), v.rendszam],
        [_t('ed.brand', 'Marca'), v.marca],
        [_t('ed.model', 'Model'), v.model],
        [_t('ed.year', 'An'), v.an],
        [_t('ed.vehType', 'Tip'), v.tip === 'Vontato' ? _t('veh.tractors', 'Cap tractor') : _t('veh.trailers', 'Remorcă')],
        [_t('fld.note', 'Notă'), v.nota],
      ];
      box.innerHTML = infoTable(rows);
    } else {
      var d = T._data.driver || {};
      var dr = [
        [_t('col.name', 'Nume'), d.nume],
        ['E-mail', d.email],
        [_t('col.phone', 'Telefon'), d.tel],
      ];
      box.innerHTML = infoTable(dr);
    }
  }
  function infoTable(rows) {
    return '<table class="table"><tbody>' + rows.map(function (r) {
      return '<tr><td class="text-muted" style="width:38%;">' + _esc(r[0]) + '</td>'
        + '<td><b class="text-primary">' + (r[1] != null && r[1] !== '' ? _esc(r[1]) : '—') + '</b></td></tr>';
    }).join('') + '</tbody></table>';
  }

  // ════════════════ LEJÁRATOK fül (+ ADD) ════════════════
  function bodyExpiries() {
    var box = document.getElementById('edBody');
    var items = (T._data.expiries || []);
    var form =
      '<div class="glass-soft" style="padding:14px;border-radius:12px;margin-bottom:14px;">'
      + '<div style="font-weight:700;margin-bottom:10px;color:var(--text-primary);">'
      + '➕ ' + _t('ed.exp.addTitle', 'Document nou pentru') + ' <span style="background:var(--vs-warm-grad);-webkit-background-clip:text;background-clip:text;color:transparent;">' + _esc(T.type === 'vehicle' ? T.plate : (T.nume || T.email)) + '</span></div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end;">'
      + '<div class="field" style="margin:0;"><label>' + _t('fe.exp.document', 'Document') + '</label><input class="input" id="edExpDoc" placeholder="ITP / RCA / ADR..."></div>'
      + '<div class="field" style="margin:0;"><label>' + _t('fe.exp.expiryDate', 'Data expirării') + '</label><input class="input" id="edExpDate" type="date"></div>'
      + '<div class="field" style="margin:0;"><label>' + _t('ed.exp.alertDays', 'Alertă (zile)') + '</label><input class="input" id="edExpAlert" type="number" value="30"></div>'
      + '<div class="field" style="margin:0;grid-column:span 2;"><label>' + _t('fld.note', 'Notă') + '</label><input class="input" id="edExpNote"></div>'
      + '<button class="btn primary" style="height:42px;" onclick="EntityDetail.addExpiry()">' + _t('ed.add', 'Adaugă') + '</button>'
      + '</div></div>';

    var rows = items.map(function (it) {
      return '<tr>'
        + '<td><b class="text-primary">' + _esc(it.doc_type || '—') + '</b></td>'
        + '<td>' + d2(it.expiry_date) + '</td>'
        + '<td style="text-align:center;">' + daysBadge(it.days_left) + '</td>'
        + '<td class="text-muted" style="font-size:12px;">' + _esc(it.note || '') + '</td>'
        + '<td style="text-align:right;"><button class="btn danger" style="padding:3px 9px;font-size:12px;" onclick="EntityDetail.delExpiry(' + it.id + ')">✕</button></td>'
        + '</tr>';
    }).join('') || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:18px;">' + _t('ed.exp.none', 'Niciun document înregistrat.') + '</td></tr>';

    box.innerHTML = form
      + '<div style="overflow-x:auto;"><table class="table"><thead><tr>'
      + '<th>' + _t('fe.exp.document', 'Document') + '</th><th>' + _t('fe.exp.expiryDate', 'Data expirării') + '</th>'
      + '<th style="text-align:center;">' + _t('fe.exp.colState', 'Stare') + '</th><th>' + _t('fld.note', 'Notă') + '</th><th></th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function addExpiry() {
    var doc = (document.getElementById('edExpDoc') || {}).value;
    var date = (document.getElementById('edExpDate') || {}).value;
    if (!date) { _toast(_t('fe.exp.giveDate', 'Introdu data expirării.'), 'err'); return; }
    // A MEGLÉVŐ, auditált expirySave handler — entitás ELŐRE KITÖLTVE a detailből.
    var f = {
      entity_type: T.type === 'vehicle' ? 'vehicle' : 'driver',
      entity_label: T.type === 'vehicle' ? T.plate : (T.nume || T.email),
      doc_type: doc,
      expiry_date: date,
      alert_days: (document.getElementById('edExpAlert') || {}).value,
      note: (document.getElementById('edExpNote') || {}).value,
    };
    gas('expirySave', [null, f]).then(function (r) {
      if (r && r.ok) { _toast(_t('fe.exp.saved', 'Salvat.'), 'ok'); reload(); }
      else _toast((r && r.err) || _t('common.error', 'Eroare'), 'err');
    });
  }
  function delExpiry(id) {
    if (!confirm(_t('fe.exp.delConfirm', 'Ștergi?'))) return;
    gas('expiryDelete', [id]).then(function (r) {
      if (r && r.ok) { _toast(_t('common.deleted', 'Șters.'), 'ok'); reload(); }
      else _toast((r && r.err) || _t('common.error', 'Eroare'), 'err');
    });
  }

  // ════════════════ SZERVIZ fül (+ ADD) ════════════════
  function svCats() {
    return [['olajcsere', _t('fe.sv.cat.oil', 'Schimb ulei')], ['gumi', _t('fe.sv.cat.tire', 'Anvelope')],
      ['javitas', _t('fe.sv.cat.repair', 'Reparație')], ['karbantartas', _t('fe.sv.cat.maint', 'Întreținere')],
      ['egyeb', _t('fe.sv.cat.other', 'Altele')]];
  }
  function bodyService() {
    var box = document.getElementById('edBody');
    var items = (T._data.service || []);
    var catLbl = {}; svCats().forEach(function (c) { catLbl[c[0]] = c[1]; });
    var form =
      '<div class="glass-soft" style="padding:14px;border-radius:12px;margin-bottom:14px;">'
      + '<div style="font-weight:700;margin-bottom:10px;color:var(--text-primary);">➕ ' + _t('ed.sv.addTitle', 'Intervenție nouă pentru') + ' <span style="background:var(--vs-warm-grad);-webkit-background-clip:text;background-clip:text;color:transparent;">' + _esc(T.plate) + '</span></div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;align-items:end;">'
      + '<div class="field" style="margin:0;"><label>' + _t('fe.sv.date', 'Data') + '</label><input class="input" id="edSvDate" type="date" value="' + new Date().toISOString().slice(0, 10) + '"></div>'
      + '<div class="field" style="margin:0;"><label>' + _t('fe.sv.km', 'Km') + '</label><input class="input" id="edSvKm" type="number"></div>'
      + '<div class="field" style="margin:0;"><label>' + _t('fe.sv.type', 'Tip') + '</label><select class="select" id="edSvCat">'
      + svCats().map(function (c) { return '<option value="' + c[0] + '">' + _esc(c[1]) + '</option>'; }).join('') + '</select></div>'
      + '<div class="field" style="margin:0;"><label>' + _t('fe.sv.cost', 'Cost') + '</label><input class="input" id="edSvCost" type="number" step="0.01"></div>'
      + '<div class="field" style="margin:0;grid-column:span 2;"><label>' + _t('fe.sv.desc', 'Descriere') + '</label><input class="input" id="edSvDesc"></div>'
      + '<button class="btn primary" style="height:42px;" onclick="EntityDetail.addService()">' + _t('ed.add', 'Adaugă') + '</button>'
      + '</div></div>';
    var rows = items.map(function (it) {
      return '<tr><td>' + d2(it.service_date) + '</td>'
        + '<td style="text-align:right;">' + n2(it.km, 0) + '</td>'
        + '<td>' + (catLbl[it.category] || _esc(it.category || '—')) + '</td>'
        + '<td>' + _esc(it.description || '—') + '</td>'
        + '<td style="text-align:right;font-weight:700;">' + n2(it.cost_ron, 0) + '</td>'
        + '<td style="text-align:right;"><button class="btn danger" style="padding:3px 9px;font-size:12px;" onclick="EntityDetail.delService(' + it.id + ')">✕</button></td></tr>';
    }).join('') || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:18px;">' + _t('fe.sv.noItems', 'Niciuna.') + '</td></tr>';
    box.innerHTML = form
      + '<div style="overflow-x:auto;"><table class="table"><thead><tr>'
      + '<th>' + _t('fe.sv.date', 'Data') + '</th><th style="text-align:right;">' + _t('fe.sv.colKm', 'Km') + '</th>'
      + '<th>' + _t('fe.sv.type', 'Tip') + '</th><th>' + _t('fe.sv.desc', 'Descriere') + '</th>'
      + '<th style="text-align:right;">' + _t('fe.sv.cost', 'Cost') + '</th><th></th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function addService() {
    // A MEGLÉVŐ, auditált serviceCreate handler — vehicle_id ELŐRE KITÖLTVE.
    var f = {
      vehicle_id: T.id,
      service_date: (document.getElementById('edSvDate') || {}).value,
      km: (document.getElementById('edSvKm') || {}).value,
      category: (document.getElementById('edSvCat') || {}).value,
      description: (document.getElementById('edSvDesc') || {}).value,
      cost_ron: (document.getElementById('edSvCost') || {}).value,
    };
    gas('serviceCreate', [f]).then(function (r) {
      if (r && r.ok) { _toast(_t('fe.sv.saved', 'Salvat.'), 'ok'); reload(); }
      else _toast((r && r.err) || _t('common.error', 'Eroare'), 'err');
    });
  }
  function delService(id) {
    if (!confirm(_t('fe.sv.delConfirm', 'Ștergi?'))) return;
    gas('serviceDelete', [id]).then(function (r) {
      if (r && r.ok) { _toast(_t('common.deleted', 'Șters.'), 'ok'); reload(); }
      else _toast((r && r.err) || _t('common.error', 'Eroare'), 'err');
    });
  }

  // ════════════════ TANKOLÁS fül (read-only) ════════════════
  function bodyFuel() {
    var box = document.getElementById('edBody');
    var items = (T._data.fuel || []);
    var tot = T._data.fuelTotal || {};
    var band = '<div class="glass-soft" style="display:flex;gap:18px;flex-wrap:wrap;padding:12px 16px;border-radius:12px;margin-bottom:14px;">'
      + '<div><div class="text-muted" style="font-size:12px;">' + _t('ed.fuel.count', 'Alimentări') + '</div><div style="font-size:20px;font-weight:700;color:var(--text-primary);">' + (tot.db != null ? tot.db : '0') + '</div></div>'
      + '<div><div class="text-muted" style="font-size:12px;">' + _t('ed.fuel.liters', 'Litri') + '</div><div style="font-size:20px;font-weight:700;color:var(--text-primary);">' + n2(tot.litru, 0) + '</div></div>'
      + '<div><div class="text-muted" style="font-size:12px;">' + _t('ed.fuel.cost', 'Cost (RON)') + '</div><div style="font-size:20px;font-weight:700;color:var(--text-primary);">' + n2(tot.suma, 0) + '</div></div>'
      + '</div>';
    var rows = items.map(function (it) {
      return '<tr><td>' + d2(it.tx_date) + '</td>'
        + '<td>' + _esc(it.source || '—') + '</td>'
        + '<td>' + _esc(it.product || '—') + '</td>'
        + '<td style="text-align:right;">' + n2(it.qty_l, 2) + '</td>'
        + '<td style="text-align:right;font-weight:700;">' + n2(it.amount_ron, 2) + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:18px;">' + _t('ed.fuel.none', 'Nicio tranzacție.') + '</td></tr>';
    box.innerHTML = band
      + '<div style="overflow-x:auto;"><table class="table"><thead><tr>'
      + '<th>' + _t('fe.sv.date', 'Data') + '</th><th>' + _t('ed.fuel.source', 'Sursă') + '</th>'
      + '<th>' + _t('ed.fuel.product', 'Produs') + '</th><th style="text-align:right;">' + _t('ed.fuel.liters', 'Litri') + '</th>'
      + '<th style="text-align:right;">' + _t('ed.fuel.cost', 'Cost (RON)') + '</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  // ════════════════ DECONT fül (sofőr, read-only összesítő) ════════════════
  function bodyDecont() {
    var box = document.getElementById('edBody');
    var a = T._data.advanceTotal || {};
    box.innerHTML = '<div class="glass-soft" style="display:flex;gap:18px;flex-wrap:wrap;padding:14px 18px;border-radius:12px;">'
      + '<div><div class="text-muted" style="font-size:12px;">' + _t('ed.decont.count', 'Avansuri') + '</div><div style="font-size:22px;font-weight:700;color:var(--text-primary);">' + (a.db != null ? a.db : '0') + '</div></div>'
      + '<div><div class="text-muted" style="font-size:12px;">' + _t('ed.decont.totalRon', 'Total avans (RON)') + '</div><div style="font-size:22px;font-weight:700;color:var(--text-primary);">' + n2(a.ron, 2) + '</div></div>'
      + '</div>'
      + '<p class="text-muted" style="font-size:12px;margin-top:12px;">' + _t('ed.decont.hint', 'Decontul detaliat se gestionează în pagina Decont șofer.') + '</p>';
  }

  function renderBody() {
    if (!T._data) return;
    if (T.tab === 'data') bodyData();
    else if (T.tab === 'expiries') bodyExpiries();
    else if (T.tab === 'service') bodyService();
    else if (T.tab === 'fuel') bodyFuel();
    else if (T.tab === 'decont') bodyDecont();
  }

  function renderTitle() {
    var el = document.getElementById('edTitle');
    if (!el) return;
    if (T.type === 'vehicle') {
      el.innerHTML = '<span style="font-size:22px;">🚛</span><span>' + _esc(T.plate)
        + (T._data && T._data.vehicle && T._data.vehicle.marca ? ' <span class="text-muted" style="font-weight:500;font-size:14px;">— ' + _esc(T._data.vehicle.marca) + '</span>' : '') + '</span>';
    } else {
      el.innerHTML = (typeof vsAvatar === 'function' ? vsAvatar(T.nume || '') : '👤')
        + '<span>' + _esc(T.nume || T.email) + '</span>';
    }
  }

  function reload() {
    var fn = T.type === 'vehicle' ? 'getVehicleDetail' : 'getDriverDetail';
    var arg = T.type === 'vehicle' ? { id: T.id } : { email: T.email };
    gas(fn, [arg]).then(function (r) {
      if (!r || !r.ok) { _toast((r && r.err) || _t('common.error', 'Eroare'), 'err'); return; }
      T._data = r;
      if (T.type === 'driver') {
        T.nume = (r.driver && r.driver.nume) || T.nume;
        T._hasAdvance = !!(r.advanceTotal);
      } else {
        T.plate = (r.vehicle && r.vehicle.rendszam) || T.plate;
      }
      renderTitle(); renderTabs(); renderBody();
    }).catch(function (e) { console.error('entity-detail reload hiba:', e); _toast(_t('common.loadError', 'Eroare'), 'err'); });
  }

  function openVehicle(id) {
    ensureModal();
    T = { type: 'vehicle', id: parseInt(id, 10), plate: '', tab: 'data', _data: null };
    var v = (typeof vehicleCache !== 'undefined' && Array.isArray(vehicleCache)) ? vehicleCache.find(function (x) { return x.id === T.id; }) : null;
    if (v) T.plate = v.rendszam;
    var el = document.getElementById('edTitle'); if (el) el.innerHTML = '<span style="font-size:22px;">🚛</span><span>' + _esc(T.plate || '…') + '</span>';
    document.getElementById('edTabs').innerHTML = '';
    document.getElementById('edBody').innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + _t('fe.loading', 'Se încarcă…') + '</div>';
    open();
    reload();
  }

  function openDriver(email, nume) {
    ensureModal();
    T = { type: 'driver', id: null, email: String(email || '').toLowerCase(), nume: nume || '', tab: 'data', _data: null, _hasAdvance: false };
    var el = document.getElementById('edTitle'); if (el) el.innerHTML = (typeof vsAvatar === 'function' ? vsAvatar(T.nume || '') : '👤') + '<span>' + _esc(T.nume || T.email) + '</span>';
    document.getElementById('edTabs').innerHTML = '';
    document.getElementById('edBody').innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + _t('fe.loading', 'Se încarcă…') + '</div>';
    open();
    reload();
  }

  window.EntityDetail = {
    openVehicle: openVehicle,
    openDriver: openDriver,
    setTab: setTab,
    close: close,
    addExpiry: addExpiry,
    delExpiry: delExpiry,
    addService: addService,
    delService: delService,
  };
})();
