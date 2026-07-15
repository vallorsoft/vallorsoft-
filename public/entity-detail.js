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
    var html = '';
    if (T.type === 'order') {
      html = tabBtn('overview', _t('ed.tab.overview', 'Privire de ansamblu'))
        + tabBtn('odocs', _t('ed.tab.odocs', 'Documente'))
        + tabBtn('finance', _t('ed.tab.finance', 'Finanțe'))
        + tabBtn('legs', _t('ed.tab.legs', 'Etape'))
        + tabBtn('activity', _t('ed.tab.activity', 'Activitate'))
        + tabBtn('portal', _t('ed.tab.portal', 'Portal'));
    } else if (T.type === 'client') {
      html = tabBtn('cdata', _t('ed.tab.cdata', 'Date'))
        + tabBtn('corders', _t('ed.tab.corders', 'Transporturi'))
        + tabBtn('cinv', _t('ed.tab.cinv', 'Facturi'))
        + tabBtn('cportal', _t('ed.tab.cportal', 'Portal'));
    } else {
      html = tabBtn('data', _t('ed.tab.data', 'Date'))
        + tabBtn('expiries', _t('ed.tab.expiries', 'Documente & Expirări'));
      if (T.type === 'vehicle') {
        html += tabBtn('service', _t('ed.tab.service', 'Service'));
        html += tabBtn('fuel', _t('ed.tab.fuel', 'Alimentări'));
      } else if (T.type === 'driver' && T._hasAdvance) {
        html += tabBtn('decont', _t('ed.tab.decont', 'Decont'));
      }
    }
    tabs.innerHTML = html;
  }

  function setTab(k) { T.tab = k; renderTabs(); renderBody(); }

  // ── Dátum / szám segédek ──
  function ymd(d) { if (!d) return ''; var s = String(d); return s.length >= 10 ? s.slice(0, 10) : s; }
  function d2(d) { var s = ymd(d); return s || '—'; }
  // Időbélyeg (állomás) — dátum + óra:perc, hiba/üres → ''.
  function dt2(v) { if (!v) return ''; try { var d = new Date(v); if (isNaN(d.getTime())) return String(v); return d.toLocaleString('ro-RO', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(v); } }
  // Sofőr állomás-idővonal (4 lépés) — az irodai fuvar-adatlapra.
  var _MS_STEPS = [
    { col: 'sosit_incarcare_at',  key: 'ed.ms.arriveLoad',   def: 'Sosit la încărcare' },
    { col: 'incarcat_at',         key: 'ed.ms.loaded',       def: 'Încărcat' },
    { col: 'sosit_descarcare_at', key: 'ed.ms.arriveUnload',  def: 'Sosit la descărcare' },
    { col: 'descarcat_at',        key: 'ed.ms.unloaded',     def: 'Descărcat' }
  ];
  function milestoneBlock(o) {
    var anyMs = _MS_STEPS.some(function (s) { return o[s.col]; });
    var active = ['Alocat', 'In Curs', 'Parkolt', 'Raktarban'].indexOf(o.status) !== -1;
    if (!anyMs && !active) return ''; // se aktív, se állomás → ne mutassuk üresen
    var rows = _MS_STEPS.map(function (s) {
      var done = o[s.col];
      return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;' + (done ? 'color:var(--text-primary);font-weight:600;' : 'color:var(--text-muted);') + '">'
        + '<span style="width:20px;text-align:center;">' + (done ? '✅' : '○') + '</span>'
        + '<span style="flex:1;">' + _t(s.key, s.def) + '</span>'
        + (done ? '<span style="font-weight:700;color:var(--brand-indigo,#6366f1);font-variant-numeric:tabular-nums;">' + _esc(dt2(o[s.col])) + '</span>' : '')
        + '</div>';
    }).join('');
    return '<div style="margin-top:16px;">'
      + '<div style="font-weight:700;margin-bottom:6px;color:var(--text-primary);">🚚 ' + _t('ed.ms.progress', 'Stare cursă (marcaje șofer)') + '</div>'
      + '<div style="background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.18);border-radius:10px;padding:8px 14px;">' + rows + '</div>'
      + '</div>';
  }
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

  // ════════════════ FUVAR — Áttekintés ════════════════
  function statusBadge(s) {
    var cls = 'info';
    if (s === 'Alocat' || s === 'Extern') cls = 'warn';
    else if (s === 'In Curs' || s === 'Finalizat') cls = 'ok';
    else if (s === 'Anulat') cls = 'err';
    return '<span class="badge ' + cls + '">' + _esc(s || '—') + '</span>';
  }
  function bodyOrderOverview() {
    var box = document.getElementById('edBody');
    var o = T._data.order || {};
    var rows = [
      [_t('ed.o.fuvarNo', 'Nr. cursă'), o.fuvar_no || o.id],
      ['ID', o.id],
      [_t('col.client', 'Client'), o.client_name || o.client],
      [_t('ed.o.ref', 'Referință'), o.ref],
      [_t('ed.o.from', 'Încărcare'), o.loc_incarcare],
      [_t('ed.o.to', 'Descărcare'), o.loc_descarcare],
      ['Km', o.km],
      [_t('ed.o.price', 'Preț'), o.pret != null ? n2(o.pret, 2) + ' EUR' : null],
      [_t('col.driver', 'Șofer'), o.nume_sofer || o.email_sofer || o.firma_extern],
      [_t('ed.o.truck', 'Camion'), o.rendszam_camion],
      [_t('ed.o.trailer', 'Remorcă'), o.rendszam_remorca],
    ];
    var editLink = (typeof openOrderEdit === 'function')
      ? '<button class="btn primary" style="padding:6px 14px;font-size:13px;" onclick="EntityDetail.close();openOrderEdit(\'' + _esc(o.id) + '\')">✏️ ' + _t('ed.o.edit', 'Editează') + '</button>'
      : '';
    box.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap;">'
      + '<div>' + statusBadge(o.status) + '</div>' + editLink + '</div>'
      + infoTable(rows)
      + milestoneBlock(o);
  }

  // ════════════════ FUVAR — Dokumentumok ════════════════
  function bodyOrderDocs() {
    var box = document.getElementById('edBody');
    var docs = (T._data.documents || []);
    var pod = (T._data.pod || []);
    var openLink = (typeof openDocModal === 'function')
      ? '<button class="btn ghost" style="padding:6px 14px;font-size:13px;margin-bottom:12px;" onclick="EntityDetail.close();openDocModal(\'' + _esc((T._data.order || {}).id) + '\')">📎 ' + _t('ed.o.openDocs', 'Gestionează documente') + '</button>'
      : '';
    var dRows = docs.map(function (it) {
      return '<tr><td><b class="text-primary">' + _esc(it.file_name || '—') + '</b></td>'
        + '<td>' + (it.signed ? '<span class="badge ok">' + _t('ed.o.signed', 'Semnat') + '</span>' : '<span class="badge info">' + _t('ed.o.original', 'Original') + '</span>') + '</td>'
        + '<td class="text-muted" style="font-size:12px;">' + _esc(it.uploaded_by || '') + '</td>'
        + '<td>' + d2(it.created_at) + '</td></tr>';
    }).join('') || '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:18px;">' + _t('ed.o.noDocs', 'Niciun document.') + '</td></tr>';
    var pRows = pod.map(function (it) {
      return '<tr><td>' + _esc(it.tip || '—') + '</td><td><b class="text-primary">' + _esc(it.file_name || '—') + '</b></td>'
        + '<td class="text-muted" style="font-size:12px;">' + _esc(it.nume_sofer || '') + '</td>'
        + '<td>' + d2(it.created_at) + '</td></tr>';
    }).join('') || '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:18px;">' + _t('ed.o.noPod', 'Nicio fotografie POD.') + '</td></tr>';
    box.innerHTML = openLink
      + '<div style="overflow-x:auto;"><table class="table"><thead><tr>'
      + '<th>' + _t('ed.o.fileName', 'Fișier') + '</th><th>' + _t('ed.o.docType', 'Tip') + '</th>'
      + '<th>' + _t('ed.o.uploadedBy', 'Încărcat de') + '</th><th>' + _t('fe.sv.date', 'Data') + '</th>'
      + '</tr></thead><tbody>' + dRows + '</tbody></table></div>'
      + '<div style="font-weight:700;margin:16px 0 8px;color:var(--text-primary);">📷 POD</div>'
      + '<div style="overflow-x:auto;"><table class="table"><thead><tr>'
      + '<th>' + _t('ed.o.docType', 'Tip') + '</th><th>' + _t('ed.o.fileName', 'Fișier') + '</th>'
      + '<th>' + _t('col.driver', 'Șofer') + '</th><th>' + _t('fe.sv.date', 'Data') + '</th>'
      + '</tr></thead><tbody>' + pRows + '</tbody></table></div>';
  }

  // ════════════════ FUVAR — Pénzügy ════════════════
  function bodyOrderFinance() {
    var box = document.getElementById('edBody');
    var o = T._data.order || {};
    var inv = (T._data.invoices || []);
    var band = '<div class="glass-soft" style="display:flex;gap:18px;flex-wrap:wrap;padding:12px 16px;border-radius:12px;margin-bottom:14px;">'
      + '<div><div class="text-muted" style="font-size:12px;">' + _t('ed.o.price', 'Preț') + '</div><div style="font-size:20px;font-weight:700;color:var(--text-primary);">' + n2(o.pret, 2) + ' EUR</div></div>'
      + '<div><div class="text-muted" style="font-size:12px;">' + _t('ed.o.toll', 'Taxă drum') + '</div><div style="font-size:20px;font-weight:700;color:var(--text-primary);">' + n2(o.toll_cost, 2) + '</div></div>'
      + '<div><div class="text-muted" style="font-size:12px;">' + _t('ed.o.carrierCost', 'Cost subcontractor') + '</div><div style="font-size:20px;font-weight:700;color:var(--text-primary);">' + n2(o.carrier_cost, 2) + '</div></div>'
      + '<div><div class="text-muted" style="font-size:12px;">' + _t('ed.o.payStatus', 'Plată') + '</div><div style="font-size:20px;font-weight:700;color:var(--text-primary);">' + _esc(o.payment_status || 'unpaid') + (o.paid_amount != null ? ' (' + n2(o.paid_amount, 2) + ')' : '') + '</div></div>'
      + '</div>';
    var rows = inv.map(function (it) {
      var link = it.pdf_link ? '<a class="btn ghost" style="padding:3px 9px;font-size:12px;" href="' + _esc(it.pdf_link) + '" target="_blank" rel="noopener">PDF</a>' : '';
      return '<tr><td><b class="text-primary">' + _esc((it.serie || '') + ' ' + (it.numar || '')) + '</b></td>'
        + '<td>' + _esc(it.provider || '—') + '</td>'
        + '<td style="text-align:right;">' + n2(it.total, 2) + ' ' + _esc(it.valuta || '') + '</td>'
        + '<td>' + _esc(it.status || '—') + (it.efactura_status ? ' / ' + _esc(it.efactura_status) : '') + '</td>'
        + '<td>' + d2(it.created_at) + '</td><td style="text-align:right;">' + link + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:18px;">' + _t('ed.o.noInv', 'Nicio factură.') + '</td></tr>';
    box.innerHTML = band
      + '<div style="font-weight:700;margin-bottom:8px;color:var(--text-primary);">🧾 ' + _t('ed.o.invoices', 'Facturi') + '</div>'
      + '<div style="overflow-x:auto;"><table class="table"><thead><tr>'
      + '<th>' + _t('ed.o.invNo', 'Serie/Nr.') + '</th><th>' + _t('ed.o.provider', 'Furnizor') + '</th>'
      + '<th style="text-align:right;">' + _t('ed.o.total', 'Total') + '</th><th>' + _t('fe.exp.colState', 'Stare') + '</th>'
      + '<th>' + _t('fe.sv.date', 'Data') + '</th><th></th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  // ════════════════ FUVAR — Szakaszok ════════════════
  function bodyOrderLegs() {
    var box = document.getElementById('edBody');
    var legs = (T._data.legs || []);
    var rows = legs.map(function (l) {
      var drv = l.nume_sofer || l.email_sofer || l.firma_extern || '—';
      return '<tr><td style="text-align:center;"><b>' + (l.leg_number != null ? l.leg_number : '—') + '</b></td>'
        + '<td>' + _esc(drv) + '</td>'
        + '<td>' + _esc(l.rendszam_camion || '—') + (l.rendszam_remorca ? ' / ' + _esc(l.rendszam_remorca) : '') + '</td>'
        + '<td>' + _esc(l.loc_preluare || '—') + (l.data_preluare ? ' <span class="text-muted" style="font-size:11px;">' + d2(l.data_preluare) + '</span>' : '') + '</td>'
        + '<td>' + _esc(l.loc_predare || '—') + (l.data_predare ? ' <span class="text-muted" style="font-size:11px;">' + d2(l.data_predare) + '</span>' : '') + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:18px;">' + _t('ed.o.noLegs', 'Nicio etapă.') + '</td></tr>';
    box.innerHTML = '<div style="overflow-x:auto;"><table class="table"><thead><tr>'
      + '<th style="text-align:center;">#</th><th>' + _t('col.driver', 'Șofer') + '</th>'
      + '<th>' + _t('ed.o.truck', 'Camion') + '</th><th>' + _t('ed.o.legFrom', 'Preluare') + '</th>'
      + '<th>' + _t('ed.o.legTo', 'Predare') + '</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  // ════════════════ FUVAR — Aktivitás (audit) ════════════════
  function bodyOrderActivity() {
    var box = document.getElementById('edBody');
    var items = (T._data.activity || []);
    var rows = items.map(function (it) {
      var det = '';
      try { det = it.detail ? (typeof it.detail === 'string' ? it.detail : JSON.stringify(it.detail)) : ''; } catch (e) { det = ''; }
      if (det.length > 120) det = det.slice(0, 120) + '…';
      return '<tr><td style="white-space:nowrap;">' + d2(it.created_at)
        + ' <span class="text-muted" style="font-size:11px;">' + _esc(String(it.created_at || '').slice(11, 16)) + '</span></td>'
        + '<td><b class="text-primary">' + _esc(it.action || '—') + '</b></td>'
        + '<td class="text-muted" style="font-size:12px;">' + _esc(it.user_email || '—') + '</td>'
        + '<td class="text-muted" style="font-size:11px;">' + _esc(det) + '</td></tr>';
    }).join('') || '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:18px;">' + _t('ed.o.noActivity', 'Nicio activitate înregistrată.') + '</td></tr>';
    box.innerHTML = '<div style="overflow-x:auto;"><table class="table"><thead><tr>'
      + '<th>' + _t('fe.sv.date', 'Data') + '</th><th>' + _t('ed.o.actName', 'Acțiune') + '</th>'
      + '<th>' + _t('ed.o.actUser', 'Utilizator') + '</th><th>' + _t('ed.o.actDetail', 'Detalii') + '</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  // ════════════════ FUVAR — Portál (tracking) ════════════════
  function bodyOrderPortal() {
    var box = document.getElementById('edBody');
    var tok = T._data.tracking_token;
    if (!tok) {
      box.innerHTML = '<p class="text-muted" style="padding:24px;text-align:center;">' + _t('ed.o.noTrack', 'Nu există link de urmărire pentru această comandă.') + '</p>';
      return;
    }
    var url = location.origin + '/t/' + tok;
    box.innerHTML = '<div class="glass-soft" style="padding:16px;border-radius:12px;">'
      + '<div class="text-muted" style="font-size:12px;margin-bottom:6px;">' + _t('ed.o.trackLink', 'Link de urmărire pentru client') + '</div>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
      + '<input class="input" readonly value="' + _esc(url) + '" style="flex:1;min-width:200px;">'
      + '<button class="btn primary" style="height:42px;" onclick="EntityDetail.copyTrack(\'' + _esc(url) + '\')">📋 ' + _t('ed.o.copy', 'Copiază') + '</button>'
      + '<a class="btn ghost" style="height:42px;line-height:42px;" href="' + _esc(url) + '" target="_blank" rel="noopener">↗</a>'
      + '</div></div>';
  }
  function copyTrack(url) {
    try { navigator.clipboard.writeText(url); _toast(_t('ed.o.copied', 'Copiat.'), 'ok'); }
    catch (e) { _toast(url, 'ok'); }
  }

  // ════════════════ ÜGYFÉL — Adatok ════════════════
  function bodyClientData() {
    var box = document.getElementById('edBody');
    var c = T._data.client || {};
    var rows = [
      [_t('col.name', 'Nume'), c.denumire],
      [_t('ed.c.type', 'Tip'), c.tip === 'PF' ? _t('ed.c.pf', 'Persoană fizică') : _t('ed.c.pj', 'Persoană juridică')],
      ['CUI / CIF', c.cui_cif],
      [_t('ed.c.regCom', 'Reg. Com.'), c.reg_com],
      [_t('clients.county', 'Județ'), c.judet],
      [_t('clients.locality', 'Localitate'), c.localitate],
      ['E-mail', c.email],
      [_t('col.phone', 'Telefon'), c.telefon],
      ['IBAN', c.iban],
      [_t('ed.c.payTerm', 'Termen plată (zile)'), c.payment_term_days],
      [_t('fld.note', 'Notă'), c.nota],
    ];
    box.innerHTML = infoTable(rows);
  }

  // ════════════════ ÜGYFÉL — Fuvarok ════════════════
  function bodyClientOrders() {
    var box = document.getElementById('edBody');
    var items = (T._data.orders || []);
    var rows = items.map(function (o) {
      return '<tr><td><b>' + _esc(o.id) + '</b></td>'
        + '<td>' + _esc(o.loc_incarcare || '—') + ' → ' + _esc(o.loc_descarcare || '—') + '</td>'
        + '<td style="text-align:right;">' + n2(o.pret, 2) + '</td>'
        + '<td style="text-align:center;">' + statusBadge(o.status) + '</td>'
        + '<td>' + d2(o.created_at) + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:18px;">' + _t('ed.c.noOrders', 'Niciun transport.') + '</td></tr>';
    box.innerHTML = '<div style="overflow-x:auto;"><table class="table"><thead><tr>'
      + '<th>ID</th><th>' + _t('ed.c.route', 'Rută') + '</th>'
      + '<th style="text-align:right;">' + _t('ed.o.price', 'Preț') + '</th>'
      + '<th style="text-align:center;">' + _t('fe.exp.colState', 'Stare') + '</th><th>' + _t('fe.sv.date', 'Data') + '</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  // ════════════════ ÜGYFÉL — Számlák ════════════════
  function bodyClientInvoices() {
    var box = document.getElementById('edBody');
    var inv = (T._data.invoices || []);
    var rows = inv.map(function (it) {
      var link = it.pdf_link ? '<a class="btn ghost" style="padding:3px 9px;font-size:12px;" href="' + _esc(it.pdf_link) + '" target="_blank" rel="noopener">PDF</a>' : '';
      return '<tr><td><b class="text-primary">' + _esc((it.serie || '') + ' ' + (it.numar || '')) + '</b></td>'
        + '<td>' + _esc(it.order_id || '—') + '</td>'
        + '<td style="text-align:right;">' + n2(it.total, 2) + ' ' + _esc(it.valuta || '') + '</td>'
        + '<td>' + _esc(it.status || '—') + '</td>'
        + '<td>' + d2(it.created_at) + '</td><td style="text-align:right;">' + link + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:18px;">' + _t('ed.o.noInv', 'Nicio factură.') + '</td></tr>';
    box.innerHTML = '<div style="overflow-x:auto;"><table class="table"><thead><tr>'
      + '<th>' + _t('ed.o.invNo', 'Serie/Nr.') + '</th><th>ID</th>'
      + '<th style="text-align:right;">' + _t('ed.o.total', 'Total') + '</th><th>' + _t('fe.exp.colState', 'Stare') + '</th>'
      + '<th>' + _t('fe.sv.date', 'Data') + '</th><th></th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  // ════════════════ ÜGYFÉL — Portál hozzáférés ════════════════
  function bodyClientPortal() {
    var box = document.getElementById('edBody');
    var items = (T._data.portal || []);
    var rows = items.map(function (u) {
      var st = u.activ
        ? (u.has_password ? '<span class="badge ok">' + _t('ed.c.active', 'Activ') + '</span>'
          : (u.pending_invite ? '<span class="badge warn">' + _t('ed.c.invited', 'Invitat') + '</span>' : '<span class="badge info">—</span>'))
        : '<span class="badge err">' + _t('ed.c.blocked', 'Dezactivat') + '</span>';
      return '<tr><td><b class="text-primary">' + _esc(u.email || '—') + '</b></td>'
        + '<td>' + _esc(u.nev || '') + '</td>'
        + '<td style="text-align:center;">' + st + '</td>'
        + '<td>' + (u.last_login ? d2(u.last_login) : '—') + '</td></tr>';
    }).join('') || '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:18px;">' + _t('ed.c.noPortal', 'Niciun acces de portal.') + '</td></tr>';
    var hint = '<p class="text-muted" style="font-size:12px;margin-top:12px;">' + _t('ed.c.portalHint', 'Invitațiile de portal se gestionează pe pagina Clienți.') + '</p>';
    box.innerHTML = '<div style="overflow-x:auto;"><table class="table"><thead><tr>'
      + '<th>E-mail</th><th>' + _t('col.name', 'Nume') + '</th>'
      + '<th style="text-align:center;">' + _t('fe.exp.colState', 'Stare') + '</th><th>' + _t('ed.c.lastLogin', 'Ultima logare') + '</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>' + hint;
  }

  function renderBody() {
    if (!T._data) return;
    if (T.type === 'order') {
      if (T.tab === 'overview') bodyOrderOverview();
      else if (T.tab === 'odocs') bodyOrderDocs();
      else if (T.tab === 'finance') bodyOrderFinance();
      else if (T.tab === 'legs') bodyOrderLegs();
      else if (T.tab === 'activity') bodyOrderActivity();
      else if (T.tab === 'portal') bodyOrderPortal();
      return;
    }
    if (T.type === 'client') {
      if (T.tab === 'cdata') bodyClientData();
      else if (T.tab === 'corders') bodyClientOrders();
      else if (T.tab === 'cinv') bodyClientInvoices();
      else if (T.tab === 'cportal') bodyClientPortal();
      return;
    }
    if (T.tab === 'data') bodyData();
    else if (T.tab === 'expiries') bodyExpiries();
    else if (T.tab === 'service') bodyService();
    else if (T.tab === 'fuel') bodyFuel();
    else if (T.tab === 'decont') bodyDecont();
  }

  function renderTitle() {
    var el = document.getElementById('edTitle');
    if (!el) return;
    if (T.type === 'order') {
      var o = (T._data && T._data.order) || {};
      el.innerHTML = '<span style="font-size:22px;">📦</span><span>' + _esc(T.id)
        + (o.client_name || o.client ? ' <span class="text-muted" style="font-weight:500;font-size:14px;">— ' + _esc(o.client_name || o.client) + '</span>' : '') + '</span>';
      return;
    }
    if (T.type === 'client') {
      var c = (T._data && T._data.client) || {};
      el.innerHTML = (typeof vsAvatar === 'function' ? vsAvatar(c.denumire || T.nume || '') : '🏢')
        + '<span>' + _esc(c.denumire || T.nume || '') + '</span>';
      return;
    }
    if (T.type === 'vehicle') {
      el.innerHTML = '<span style="font-size:22px;">🚛</span><span>' + _esc(T.plate)
        + (T._data && T._data.vehicle && T._data.vehicle.marca ? ' <span class="text-muted" style="font-weight:500;font-size:14px;">— ' + _esc(T._data.vehicle.marca) + '</span>' : '') + '</span>';
    } else {
      el.innerHTML = (typeof vsAvatar === 'function' ? vsAvatar(T.nume || '') : '👤')
        + '<span>' + _esc(T.nume || T.email) + '</span>';
    }
  }

  function reload() {
    var fn, arg;
    if (T.type === 'order') { fn = 'getOrderDetail'; arg = { id: T.id }; }
    else if (T.type === 'client') { fn = 'getClientProfile'; arg = { id: T.id }; }
    else if (T.type === 'vehicle') { fn = 'getVehicleDetail'; arg = { id: T.id }; }
    else { fn = 'getDriverDetail'; arg = { email: T.email }; }
    gas(fn, [arg]).then(function (r) {
      if (!r || !r.ok) { _toast((r && r.err) || _t('common.error', 'Eroare'), 'err'); return; }
      T._data = r;
      if (T.type === 'driver') {
        T.nume = (r.driver && r.driver.nume) || T.nume;
        T._hasAdvance = !!(r.advanceTotal);
      } else if (T.type === 'vehicle') {
        T.plate = (r.vehicle && r.vehicle.rendszam) || T.plate;
      } else if (T.type === 'client') {
        T.nume = (r.client && r.client.denumire) || T.nume;
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

  function openOrder(id) {
    ensureModal();
    T = { type: 'order', id: String(id || ''), tab: 'overview', _data: null };
    var el = document.getElementById('edTitle'); if (el) el.innerHTML = '<span style="font-size:22px;">📦</span><span>' + _esc(T.id) + '</span>';
    document.getElementById('edTabs').innerHTML = '';
    document.getElementById('edBody').innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + _t('fe.loading', 'Se încarcă…') + '</div>';
    open();
    reload();
  }

  function openClient(id, nume) {
    ensureModal();
    T = { type: 'client', id: parseInt(id, 10), nume: nume || '', tab: 'cdata', _data: null };
    var el = document.getElementById('edTitle'); if (el) el.innerHTML = (typeof vsAvatar === 'function' ? vsAvatar(T.nume || '') : '🏢') + '<span>' + _esc(T.nume || '…') + '</span>';
    document.getElementById('edTabs').innerHTML = '';
    document.getElementById('edBody').innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + _t('fe.loading', 'Se încarcă…') + '</div>';
    open();
    reload();
  }

  window.EntityDetail = {
    openVehicle: openVehicle,
    openDriver: openDriver,
    openOrder: openOrder,
    openClient: openClient,
    setTab: setTab,
    close: close,
    copyTrack: copyTrack,
    addExpiry: addExpiry,
    delExpiry: delExpiry,
    addService: addService,
    delService: delService,
  };
})();
