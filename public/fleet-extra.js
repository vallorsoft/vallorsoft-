// ============================================================
//  VallorSoft — fleet-extra.js  (FLOTTA & MEGFELELÉS modulok)
//  1) Lejáratok & riasztások (expiries) — ITP/RCA/rovinietă/tahográf...
//  2) Szerviz & karbantartás (service-log)
//  3) Sofőr-elszámolás / decont (decont)
//  Admin + Manager konzol közös füljei. Betöltés: console-shared.js UTÁN.
// ============================================================

(function () {
  'use strict';

  function n2(x, dec) {
    var n = parseFloat(x);
    if (!isFinite(n)) return '—';
    return n.toLocaleString('hu-HU', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 2 : dec });
  }
  function d2(d) { return d ? new Date(d).toLocaleDateString('hu-HU') : '—'; }
  function ymd(d) { return d ? String(d).slice(0, 10) : ''; }

  function panel(title, body, extraHead) {
    return '<div class="glass" style="padding:18px;margin-bottom:14px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">'
      + '<div class="text-primary" style="font-size:15px;font-weight:700;">' + title + '</div>'
      + (extraHead || '') + '</div>' + body + '</div>';
  }

  // ════════════════════════════════════════════════════════
  //  1) LEJÁRATOK & RIASZTÁSOK
  // ════════════════════════════════════════════════════════
  // RO-specifikus, előre gyártott dokumentum-típusok (a fordított címkék render-időben)
  function docTypes() {
    return ['fe.doc.itp', 'fe.doc.rca', 'fe.doc.casco', 'fe.doc.rovinieta',
      'fe.doc.cmrIns', 'fe.doc.tahoCalib', 'fe.doc.tahoCard', 'fe.doc.tahoDl',
      'fe.doc.adr', 'fe.doc.community', 'fe.doc.copieConforma', 'fe.doc.license', 'fe.doc.atestat', 'fe.doc.medical', 'fe.doc.other'
    ].map(function (k) { return t(k); });
  }

  var _expItems = [];

  function loadExpiries() {
    var box = document.getElementById('expiriesBox');
    if (!box) return;
    box.innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.loading') + '</div>';
    Promise.all([gas('expiryList'), gas('vehicleList'), gas('getInternalDrivers')]).then(function (rs) {
      var r = rs[0];
      if (!r || !r.ok) { box.innerHTML = '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || t('fe.errMigrate')) + '</div>'; return; }
      _expItems = r.items || [];
      var vehicles = Array.isArray(rs[1]) ? rs[1] : [];
      var drivers = Array.isArray(rs[2]) ? rs[2] : [];

      // Új tétel űrlap
      var formHtml =
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;align-items:end;">'
        + '<div class="field" style="margin:0;"><label>' + t('fe.exp.entity') + '</label>'
        + '<select class="select" id="expEntityType" onchange="FleetExtra.expEntityChange()">'
        + '<option value="vehicle">' + t('fe.exp.vehicle') + '</option><option value="driver">' + t('fe.exp.driver') + '</option><option value="company">' + t('fe.exp.company') + '</option></select></div>'
        + '<div class="field" style="margin:0;"><label>' + t('fe.exp.vehOrDrv') + '</label>'
        + '<select class="select" id="expEntityLabel">'
        + vehicles.map(function (v) { return '<option value="' + esc(v.rendszam) + '">' + esc(v.rendszam) + (v.marca ? ' — ' + esc(v.marca) : '') + '</option>'; }).join('')
        + '</select></div>'
        + '<div class="field" style="margin:0;"><label>' + t('fe.exp.document') + '</label>'
        + '<select class="select" id="expDocType">' + docTypes().map(function (dt) { return '<option>' + esc(dt) + '</option>'; }).join('') + '</select></div>'
        + '<div class="field" style="margin:0;"><label>' + t('fe.exp.expiryDate') + '</label><input class="input" id="expDate" type="date"></div>'
        + '<div class="field" style="margin:0;"><label>' + t('fe.exp.alertDays') + '</label><input class="input" id="expAlertDays" type="number" value="30" min="0" max="365"></div>'
        + '<div class="field" style="margin:0;"><label>' + t('fld.note') + '</label><input class="input" id="expNote" placeholder="' + t('fld.notePh') + '"></div>'
        + '<button class="btn primary" style="height:42px;" onclick="FleetExtra.expSave()">' + t('fe.add') + '</button>'
        + '</div>';

      // Lista — lejárat szerint, színezve
      var rows = _expItems.map(function (it, i) {
        var dl = parseInt(it.days_left, 10);
        var badge = dl < 0 ? '<span class="badge err">' + t('fe.exp.expired', { n: Math.abs(dl) }) + '</span>'
          : dl <= (it.alert_days || 30) ? '<span class="badge warn">' + t('fe.exp.inDays', { n: dl }) + '</span>'
          : '<span class="badge ok">' + t('fe.exp.inDays', { n: dl }) + '</span>';
        var ico = it.entity_type === 'driver' ? '👤' : it.entity_type === 'company' ? '🏢' : '🚛';
        return '<tr>'
          + '<td>' + ico + ' <b class="text-primary">' + esc(it.entity_label || '—') + '</b></td>'
          + '<td>' + esc(it.doc_type) + '</td>'
          + '<td>' + d2(it.expiry_date) + '</td>'
          + '<td style="text-align:center;">' + badge + '</td>'
          + '<td class="text-muted" style="font-size:12px;">' + esc(it.note || '') + '</td>'
          + '<td style="text-align:right;white-space:nowrap;">'
          + '<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="FleetExtra.expEdit(' + i + ')">✏️</button> '
          + '<button class="btn danger" style="padding:4px 10px;font-size:12px;" onclick="FleetExtra.expDelete(' + it.id + ')">✕</button></td>'
          + '</tr>';
      }).join('') || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:18px;">' + t('fe.exp.noItems') + '</td></tr>';

      box.innerHTML =
        panel(t('fe.exp.newTitle'), formHtml)
        + panel(t('fe.exp.listTitle'),
          '<p class="text-muted" style="font-size:12px;margin:0 0 10px;">' + t('fe.exp.listHint') + '</p>'
          + '<div style="overflow-x:auto;"><table class="table">'
          + '<thead><tr><th>' + t('fe.exp.vehOrDrv') + '</th><th>' + t('fe.exp.document') + '</th><th>' + t('fe.exp.expiryDate') + '</th><th style="text-align:center;">' + t('fe.exp.colState') + '</th><th>' + t('fld.note') + '</th><th></th></tr></thead>'
          + '<tbody>' + rows + '</tbody></table></div>');

      // a sofőr-választó tartalmát eltároljuk típus-váltáshoz
      window._expVehOpts = vehicles.map(function (v) { return { value: v.rendszam, label: v.rendszam + (v.marca ? ' — ' + v.marca : '') }; });
      window._expDrvOpts = drivers.map(function (u) { return { value: u.nume || u.email, label: (u.nume || '') + ' (' + u.email + ')' }; });
    });
  }

  function expEntityChange() {
    var type = (document.getElementById('expEntityType') || {}).value;
    var sel = document.getElementById('expEntityLabel');
    if (!sel) return;
    var opts = type === 'driver' ? (window._expDrvOpts || []) : type === 'company' ? [{ value: '', label: t('fe.exp.companyLevel') }] : (window._expVehOpts || []);
    sel.innerHTML = opts.map(function (o) { return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>'; }).join('');
  }

  var _expEditId = null;
  function expSave() {
    var f = {
      entity_type: (document.getElementById('expEntityType') || {}).value,
      entity_label: (document.getElementById('expEntityLabel') || {}).value,
      doc_type: (document.getElementById('expDocType') || {}).value,
      expiry_date: (document.getElementById('expDate') || {}).value,
      alert_days: (document.getElementById('expAlertDays') || {}).value,
      note: (document.getElementById('expNote') || {}).value,
    };
    if (!f.expiry_date) { toast(t('fe.exp.giveDate'), 'err'); return; }
    gas('expirySave', [_expEditId, f]).then(function (r) {
      if (r && r.ok) { toast(_expEditId ? t('fe.exp.updated') : t('fe.exp.saved'), 'ok'); _expEditId = null; loadExpiries(); }
      else toast((r && r.err) || t('common.error'), 'err');
    });
  }

  function expEdit(idx) {
    var it = _expItems[idx];
    if (!it) return;
    _expEditId = it.id;
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.value = v; };
    set('expEntityType', it.entity_type); expEntityChange();
    set('expEntityLabel', it.entity_label || '');
    set('expDocType', it.doc_type);
    set('expDate', ymd(it.expiry_date));
    set('expAlertDays', it.alert_days != null ? it.alert_days : 30);
    set('expNote', it.note || '');
    toast(t('fe.exp.editToast'), 'ok');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function expDelete(id) {
    if (!confirm(t('fe.exp.delConfirm'))) return;
    gas('expiryDelete', [id]).then(function (r) {
      if (r && r.ok) { toast(t('common.deleted'), 'ok'); loadExpiries(); }
      else toast((r && r.err) || t('common.error'), 'err');
    });
  }

  // ════════════════════════════════════════════════════════
  //  2) SZERVIZ & KARBANTARTÁS
  // ════════════════════════════════════════════════════════
  function serviceCats() {
    return [['olajcsere', t('fe.sv.cat.oil')], ['gumi', t('fe.sv.cat.tire')], ['javitas', t('fe.sv.cat.repair')],
      ['karbantartas', t('fe.sv.cat.maint')], ['egyeb', t('fe.sv.cat.other')]];
  }

  function loadServiceLog() {
    var box = document.getElementById('serviceLogBox');
    if (!box) return;
    box.innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.loading') + '</div>';
    Promise.all([gas('serviceList', [{}]), gas('vehicleList')]).then(function (rs) {
      var r = rs[0];
      if (!r || !r.ok) { box.innerHTML = '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || t('fe.errMigrate')) + '</div>'; return; }
      var vehicles = (Array.isArray(rs[1]) ? rs[1] : []);
      var items = r.items || [];
      var catLbl = {}; serviceCats().forEach(function (c) { catLbl[c[0]] = c[1]; });

      var formHtml =
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end;">'
        + '<div class="field" style="margin:0;"><label>' + t('fe.sv.vehicleReq') + '</label><select class="select" id="svVeh">'
        + '<option value="">' + t('fe.choose') + '</option>'
        + vehicles.map(function (v) { return '<option value="' + v.id + '">' + esc(v.rendszam) + (v.marca ? ' — ' + esc(v.marca) : '') + '</option>'; }).join('')
        + '</select></div>'
        + '<div class="field" style="margin:0;"><label>' + t('fe.sv.date') + '</label><input class="input" id="svDate" type="date" value="' + new Date().toISOString().slice(0, 10) + '"></div>'
        + '<div class="field" style="margin:0;"><label>' + t('fe.sv.km') + '</label><input class="input" id="svKm" type="number" placeholder="pl. 450000"></div>'
        + '<div class="field" style="margin:0;"><label>' + t('fe.sv.type') + '</label><select class="select" id="svCat">'
        + serviceCats().map(function (c) { return '<option value="' + c[0] + '">' + esc(c[1]) + '</option>'; }).join('') + '</select></div>'
        + '<div class="field" style="margin:0;"><label>' + t('fe.sv.cost') + '</label><input class="input" id="svCost" type="number" step="0.01" placeholder="0"></div>'
        + '<div class="field" style="margin:0;grid-column:span 2;"><label>' + t('fe.sv.desc') + '</label><input class="input" id="svDesc" placeholder="pl. olaj + szűrők"></div>'
        + '<div class="field" style="margin:0;"><label>' + t('fe.sv.nextDate') + '</label><input class="input" id="svNextDate" type="date"></div>'
        + '<div class="field" style="margin:0;"><label>' + t('fe.sv.nextKm') + '</label><input class="input" id="svNextKm" type="number" placeholder="pl. 530000"></div>'
        + '<button class="btn primary" style="height:42px;" onclick="FleetExtra.svSave()">' + t('fe.sv.addBtn') + '</button>'
        + '</div>';

      var rows = items.map(function (it) {
        return '<tr>'
          + '<td><b class="text-primary">' + esc(it.rendszam) + '</b></td>'
          + '<td>' + d2(it.service_date) + '</td>'
          + '<td style="text-align:right;">' + (it.km != null ? n2(it.km, 0) : '—') + '</td>'
          + '<td>' + (catLbl[it.category] || esc(it.category || '—')) + '</td>'
          + '<td>' + esc(it.description || '—') + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + (it.cost_ron != null ? n2(it.cost_ron, 0) : '—') + '</td>'
          + '<td class="text-muted" style="font-size:12px;">'
          + (it.next_due_date ? '📅 ' + d2(it.next_due_date) : '') + (it.next_due_km ? ' 🛣 ' + n2(it.next_due_km, 0) + ' km' : '') + '</td>'
          + '<td style="text-align:right;"><button class="btn danger" style="padding:4px 10px;font-size:12px;" onclick="FleetExtra.svDelete(' + it.id + ')">✕</button></td>'
          + '</tr>';
      }).join('') || '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:18px;">' + t('fe.sv.noItems') + '</td></tr>';

      box.innerHTML =
        panel(t('fe.sv.newTitle'), formHtml)
        + panel(t('fe.sv.logTitle'),
          '<p class="text-muted" style="font-size:12px;margin:0 0 10px;">' + t('fe.sv.logHint') + '</p>'
          + '<div style="overflow-x:auto;"><table class="table">'
          + '<thead><tr><th>' + t('col.plate') + '</th><th>' + t('fe.sv.date') + '</th><th style="text-align:right;">' + t('fe.sv.colKm') + '</th><th>' + t('fe.sv.type') + '</th><th>' + t('fe.sv.desc') + '</th><th style="text-align:right;">' + t('fe.sv.cost') + '</th><th>' + t('fe.sv.colNext') + '</th><th></th></tr></thead>'
          + '<tbody>' + rows + '</tbody></table></div>');
    });
  }

  function svSave() {
    var f = {
      vehicle_id: (document.getElementById('svVeh') || {}).value,
      service_date: (document.getElementById('svDate') || {}).value,
      km: (document.getElementById('svKm') || {}).value,
      category: (document.getElementById('svCat') || {}).value,
      description: (document.getElementById('svDesc') || {}).value,
      cost_ron: (document.getElementById('svCost') || {}).value,
      next_due_date: (document.getElementById('svNextDate') || {}).value || null,
      next_due_km: (document.getElementById('svNextKm') || {}).value,
    };
    if (!f.vehicle_id) { toast(t('fe.sv.pickVehicle'), 'err'); return; }
    gas('serviceCreate', [f]).then(function (r) {
      if (r && r.ok) { toast(t('fe.sv.saved'), 'ok'); loadServiceLog(); }
      else toast((r && r.err) || t('common.error'), 'err');
    });
  }

  function svDelete(id) {
    if (!confirm(t('fe.sv.delConfirm'))) return;
    gas('serviceDelete', [id]).then(function (r) {
      if (r && r.ok) { toast(t('common.deleted'), 'ok'); loadServiceLog(); }
      else toast((r && r.err) || t('common.error'), 'err');
    });
  }

  // ════════════════════════════════════════════════════════
  //  3) SOFŐR-ELSZÁMOLÁS (DECONT)
  // ════════════════════════════════════════════════════════
  var _dcDrivers = [];

  function monthRange() {
    var now = new Date();
    var from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
  }

  function loadDecont() {
    var box = document.getElementById('decontBox');
    if (!box) return;
    box.innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.loading') + '</div>';
    gas('getInternalDrivers').then(function (list) {
      _dcDrivers = Array.isArray(list) ? list : [];
      var mr = monthRange();
      box.innerHTML =
        panel(t('fe.dc.title'),
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;align-items:end;">'
          + '<div class="field" style="margin:0;"><label>' + t('fe.dc.driverReq') + '</label><select class="select" id="dcDriver">'
          + '<option value="">' + t('fe.choose') + '</option>'
          + _dcDrivers.map(function (u) { return '<option value="' + esc(u.email) + '">' + esc(u.nume || u.email) + '</option>'; }).join('')
          + '</select></div>'
          + '<div class="field" style="margin:0;"><label>' + t('fe.dc.periodFrom') + '</label><input class="input" id="dcFrom" type="date" value="' + mr.from + '"></div>'
          + '<div class="field" style="margin:0;"><label>' + t('fe.dc.periodTo') + '</label><input class="input" id="dcTo" type="date" value="' + mr.to + '"></div>'
          + '<button class="btn primary" style="height:42px;" onclick="FleetExtra.dcLoad()">' + t('fe.dc.calc') + '</button>'
          + '</div>')
        + panel(t('fe.dc.advTitle'),
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end;">'
          + '<div class="field" style="margin:0;"><label>' + t('fe.dc.driverReq') + '</label><select class="select" id="advDriver">'
          + '<option value="">' + t('fe.choose') + '</option>'
          + _dcDrivers.map(function (u) { return '<option value="' + esc(u.email) + '">' + esc(u.nume || u.email) + '</option>'; }).join('')
          + '</select></div>'
          + '<div class="field" style="margin:0;"><label>' + t('fe.dc.amountReq') + '</label><input class="input" id="advAmount" type="number" step="0.01" placeholder="0"></div>'
          + '<div class="field" style="margin:0;"><label>' + t('fe.dc.date') + '</label><input class="input" id="advDate" type="date" value="' + new Date().toISOString().slice(0, 10) + '"></div>'
          + '<div class="field" style="margin:0;"><label>' + t('fld.note') + '</label><input class="input" id="advNote" placeholder="' + t('fe.dc.advNotePh') + '"></div>'
          + '<button class="btn ok" style="height:42px;" onclick="FleetExtra.advSave()">' + t('fe.dc.advSaveBtn') + '</button>'
          + '</div>')
        + '<div id="dcResult"></div>';
    });
  }

  function dcLoad() {
    var email = (document.getElementById('dcDriver') || {}).value;
    var from = (document.getElementById('dcFrom') || {}).value;
    var to = (document.getElementById('dcTo') || {}).value;
    if (!email) { toast(t('fe.dc.pickDriver'), 'err'); return; }
    var out = document.getElementById('dcResult');
    out.innerHTML = '<div class="text-muted" style="padding:20px;text-align:center;">' + t('fe.calcing') + '</div>';
    Promise.all([
      gas('getDriverSettlement', [{ email: email, from: from, to: to }]),
      gas('advanceList', [{ email: email, from: from, to: to }])
    ]).then(function (rs) {
      var r = rs[0], advs = (rs[1] && rs[1].items) || [];
      if (!r || !r.ok) { out.innerHTML = '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || t('common.error')) + '</div>'; return; }

      var bal = parseFloat(r.kassza_egyenleg) || 0;
      var balColor = bal >= 0 ? 'var(--status-ok)' : 'var(--status-danger)';
      var tiles =
        '<div class="dash-stats" style="margin-bottom:14px;">'
        + '<div class="glass stat-tile"><div class="stat-ico">💵</div><div><div class="stat-val text-primary">' + n2(r.eloleg_total, 0) + ' RON</div><div class="stat-lbl text-muted">' + t('fe.dc.advGiven', { n: r.eloleg_db }) + '</div></div></div>'
        + '<div class="glass stat-tile"><div class="stat-ico">🛒</div><div><div class="stat-val text-primary">' + n2(r.cash_koltes, 0) + ' RON</div><div class="stat-lbl text-muted">' + t('fe.dc.cashSpend') + '</div></div></div>'
        + '<div class="glass stat-tile"><div class="stat-ico">⚖️</div><div><div class="stat-val" style="color:' + balColor + ' !important;">' + n2(bal, 0) + ' RON</div><div class="stat-lbl text-muted">' + t('fe.dc.balance', { s: (bal >= 0 ? t('fe.dc.toCompany') : t('fe.dc.toDriver')) }) + '</div></div></div>'
        + '<div class="glass stat-tile"><div class="stat-ico">🗓️</div><div><div class="stat-val text-primary">'
        + (r.diurna.total != null ? n2(r.diurna.total, 0) + ' RON' : '—')
        + '</div><div class="stat-lbl text-muted">' + t('fe.dc.diurnaEnt', { e: r.diurna.ext_nap, i: r.diurna.int_nap }) + '</div></div></div>'
        + '</div>';

      var rateNote = (r.diurna.total == null && typeof VS_ROLE !== 'undefined' && VS_ROLE === 'admin')
        ? '<div class="glass-soft" style="padding:12px 14px;margin-bottom:14px;font-size:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
          + '<span>' + t('fe.dc.ratesLabel') + '</span>'
          + '<input class="input" id="dcRateExt" type="number" step="0.01" placeholder="' + t('fe.dc.extPh') + '" style="max-width:110px;padding:6px 10px;">'
          + '<input class="input" id="dcRateInt" type="number" step="0.01" placeholder="' + t('fe.dc.intPh') + '" style="max-width:110px;padding:6px 10px;">'
          + '<button class="btn primary" style="padding:6px 12px;font-size:12px;" onclick="FleetExtra.dcSaveRates()">' + t('common.save') + '</button>'
          + '<span class="text-muted" style="font-size:11px;">' + t('fe.dc.ratesHint') + '</span></div>'
        : '';

      var ktgRows = (r.koltesek || []).map(function (k) {
        return '<tr><td>' + esc(k.plata) + '</td><td style="text-align:right;">' + n2(k.db, 0) + '</td><td style="text-align:right;font-weight:700;">' + n2(k.osszeg, 0) + '</td></tr>';
      }).join('') || '<tr><td colspan="3" class="text-muted" style="text-align:center;padding:12px;">' + t('fe.dc.noSpend') + '</td></tr>';

      var advRows = advs.map(function (a) {
        return '<tr><td>' + d2(a.given_at) + '</td><td style="text-align:right;font-weight:700;">' + n2(a.amount, 0) + '</td>'
          + '<td>' + esc(a.note || '—') + '</td><td class="text-muted" style="font-size:12px;">' + esc(a.created_by || '') + '</td>'
          + '<td style="text-align:right;"><button class="btn danger" style="padding:3px 9px;font-size:12px;" onclick="FleetExtra.advDelete(' + a.id + ')">✕</button></td></tr>';
      }).join('') || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:12px;">' + t('fe.dc.noAdv') + '</td></tr>';

      out.innerHTML =
        panel('📋 ' + esc(r.sofer.nume || r.sofer.email) + ' — ' + t('fe.dc.settleSuffix') + ' (' + d2(from) + ' → ' + d2(to) + ')',
          tiles + rateNote
          + '<div class="text-muted" style="font-size:12px;">' + t('fe.dc.period', { km: n2(r.km, 0), db: n2(r.menetlevelek, 0) }) + '</div>',
          '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="window.print()">' + t('fe.print') + '</button>')
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;">'
        + panel(t('fe.dc.spendByMethod'),
          '<table class="table"><thead><tr><th>' + t('fe.dc.colMethod') + '</th><th style="text-align:right;">' + t('fe.dc.colItem') + '</th><th style="text-align:right;">' + t('fe.dc.colSum') + '</th></tr></thead><tbody>' + ktgRows + '</tbody></table>')
        + panel(t('fe.dc.advances'),
          '<table class="table"><thead><tr><th>' + t('fe.dc.date') + '</th><th style="text-align:right;">' + t('fe.dc.colSumRon') + '</th><th>' + t('fld.note') + '</th><th>' + t('fe.dc.colGiver') + '</th><th></th></tr></thead><tbody>' + advRows + '</tbody></table>')
        + '</div>';
    });
  }

  function dcSaveRates() {
    var ext = (document.getElementById('dcRateExt') || {}).value;
    var int_ = (document.getElementById('dcRateInt') || {}).value;
    gas('setDiurnaRates', [{ ext: ext, int: int_ }]).then(function (r) {
      if (r && r.ok) { toast(t('fe.dc.ratesSaved'), 'ok'); dcLoad(); }
      else toast((r && r.err) || t('common.error'), 'err');
    });
  }

  function advSave() {
    var f = {
      email_sofer: (document.getElementById('advDriver') || {}).value,
      amount: (document.getElementById('advAmount') || {}).value,
      given_at: (document.getElementById('advDate') || {}).value,
      note: (document.getElementById('advNote') || {}).value,
    };
    if (!f.email_sofer) { toast(t('fe.dc.pickDriver'), 'err'); return; }
    gas('advanceCreate', [f]).then(function (r) {
      if (r && r.ok) {
        toast(t('fe.dc.advSaved'), 'ok');
        var a = document.getElementById('advAmount'); if (a) a.value = '';
        // ha épp ennek a sofőrnek az elszámolása látszik, frissítjük
        if ((document.getElementById('dcDriver') || {}).value === f.email_sofer) dcLoad();
      } else toast((r && r.err) || t('common.error'), 'err');
    });
  }

  function advDelete(id) {
    if (!confirm(t('fe.dc.advDelConfirm'))) return;
    gas('advanceDelete', [id]).then(function (r) {
      if (r && r.ok) { toast(t('common.deleted'), 'ok'); dcLoad(); }
      else toast((r && r.err) || t('common.error'), 'err');
    });
  }

  // ════════════════════════════════════════════════════════
  //  4) ÜZEMANYAGKÁRTYA-IMPORT (generikus CSV + oszlop-párosítás)
  // ════════════════════════════════════════════════════════
  var _fcRows = [], _fcHeader = [];

  function loadFuelImport() {
    var box = document.getElementById('fuelImportBox');
    if (!box) return;
    var mr = monthRange();
    box.innerHTML =
      panel(t('fe.fc.title'),
        '<p class="text-muted" style="font-size:12px;margin:0 0 12px;">' + t('fe.fc.hint') + '</p>'
        + '<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;">'
        + '<div class="field" style="margin:0;"><label>' + t('fe.fc.source') + '</label><select class="select" id="fcSource" style="max-width:140px;">'
        + '<option value="omv">OMV/Petrom</option><option value="mol">MOL</option><option value="dkv">DKV</option><option value="eurowag">Eurowag</option><option value="egyeb">' + t('fe.fc.other') + '</option></select></div>'
        + '<div class="field" style="margin:0;flex:1;min-width:200px;"><label>' + t('fe.fc.csvFile') + '</label><input class="input" type="file" id="fcFile" accept=".csv,.txt" onchange="FleetExtra.fcParse()"></div>'
        + '</div>'
        + '<div id="fcMapping" style="margin-top:12px;"></div>')
      + '<div id="fcCompareBox"></div>'
      + '<div id="fcListBox"></div>';
    fcLoadData(mr.from, mr.to);
  }

  function fcLoadData(from, to) {
    Promise.all([gas('fuelCompare', [{ from: from, to: to }]), gas('fuelCardList', [{ from: from, to: to }])]).then(function (rs) {
      var cmpBox = document.getElementById('fcCompareBox');
      var listBox = document.getElementById('fcListBox');
      if (!cmpBox || !listBox) return;
      var cmp = rs[0], lst = rs[1];

      if (cmp && cmp.ok && (cmp.rows || []).length) {
        var rows = cmp.rows.map(function (x) {
          var warn = x.diff_pct != null && Math.abs(x.diff_pct) > 10;
          return '<tr><td><b class="text-primary">' + esc(x.rendszam || '—') + '</b></td>'
            + '<td style="text-align:right;">' + n2(x.card_l, 0) + '</td>'
            + '<td style="text-align:right;">' + n2(x.drv_l, 0) + '</td>'
            + '<td style="text-align:right;font-weight:700;color:' + (warn ? 'var(--status-danger)' : 'inherit') + ';">' + (x.diff_l > 0 ? '+' : '') + n2(x.diff_l, 0) + '</td>'
            + '<td style="text-align:center;">' + (x.diff_pct != null
              ? '<span class="badge ' + (warn ? 'err' : 'ok') + '">' + (x.diff_pct > 0 ? '+' : '') + n2(x.diff_pct, 1) + '%</span>' : '—') + '</td>'
            + '<td style="text-align:right;">' + n2(x.card_ron, 0) + '</td></tr>';
        }).join('');
        cmpBox.innerHTML = panel(t('fe.fc.compareTitle'),
          '<div style="overflow-x:auto;"><table class="table">'
          + '<thead><tr><th>' + t('col.plate') + '</th><th style="text-align:right;">' + t('fe.fc.colCardL') + '</th><th style="text-align:right;">' + t('fe.fc.colDrvL') + '</th><th style="text-align:right;">' + t('fe.fc.colDiffL') + '</th><th style="text-align:center;">%</th><th style="text-align:right;">' + t('fe.fc.colCardRon') + '</th></tr></thead>'
          + '<tbody>' + rows + '</tbody></table></div>'
          + '<div class="text-muted" style="font-size:11px;margin-top:6px;">' + t('fe.fc.compareHint') + '</div>');
      } else { cmpBox.innerHTML = ''; }

      if (lst && lst.ok) {
        var tot = lst.total || {};
        var rows2 = (lst.items || []).map(function (it) {
          return '<tr><td>' + d2(it.tx_date) + '</td><td>' + esc(it.source || '—') + '</td>'
            + '<td><b class="text-primary">' + esc(it.rendszam || '—') + '</b></td>'
            + '<td>' + esc(it.product || '—') + '</td>'
            + '<td style="text-align:right;">' + n2(it.qty_l, 1) + '</td>'
            + '<td style="text-align:right;font-weight:700;">' + n2(it.amount_ron, 0) + '</td></tr>';
        }).join('') || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:14px;">' + t('fe.fc.noTx') + '</td></tr>';
        listBox.innerHTML = panel(t('fe.fc.listTitle', { db: n2(tot.db, 0), l: n2(tot.litru, 0), ron: n2(tot.suma, 0) }),
          '<div style="overflow-x:auto;"><table class="table">'
          + '<thead><tr><th>' + t('fe.sv.date') + '</th><th>' + t('fe.fc.source') + '</th><th>' + t('col.plate') + '</th><th>' + t('fe.fc.colProduct') + '</th><th style="text-align:right;">' + t('fe.fc.colLiter') + '</th><th style="text-align:right;">' + t('fe.dc.colSumRon') + '</th></tr></thead>'
          + '<tbody>' + rows2 + '</tbody></table></div>');
      }
    });
  }

  // CSV beolvasás + elválasztó-felismerés + oszlop-párosító UI
  function fcParse() {
    var f = (document.getElementById('fcFile') || {}).files;
    if (!f || !f[0]) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var text = String(e.target.result || '');
      var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
      if (lines.length < 2) { toast(t('fe.fc.csvEmpty'), 'err'); return; }
      var delim = [';', ',', '\t'].sort(function (a, b) {
        return lines[0].split(b).length - lines[0].split(a).length;
      })[0];
      var split = function (l) { return l.split(delim).map(function (c) { return c.replace(/^"|"$/g, '').trim(); }); };
      _fcHeader = split(lines[0]);
      _fcRows = lines.slice(1).map(split);

      var opts = '<option value="">—</option>' + _fcHeader.map(function (h, i) { return '<option value="' + i + '">' + esc(h) + '</option>'; }).join('');
      var sel = function (id, lbl) {
        return '<div class="field" style="margin:0;"><label>' + lbl + '</label><select class="select" id="' + id + '">' + opts + '</select></div>';
      };
      // automatikus oszlop-tippek a fejléc-nevek alapján
      var guess = function (re) { var i = _fcHeader.findIndex(function (h) { return re.test(h); }); return i >= 0 ? String(i) : ''; };
      document.getElementById('fcMapping').innerHTML =
        '<div class="glass-soft" style="padding:12px;">'
        + '<div class="text-primary" style="font-size:13px;font-weight:700;margin-bottom:8px;">' + t('fe.fc.mapTitle', { n: _fcRows.length }) + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;align-items:end;">'
        + sel('fcColDate', t('fe.fc.colDateReq')) + sel('fcColPlate', t('fe.fc.colPlateReq')) + sel('fcColQty', t('fe.fc.colQtyReq'))
        + sel('fcColAmount', t('fe.fc.colAmountReq')) + sel('fcColProduct', t('fe.fc.colProduct'))
        + '<button class="btn primary" style="height:42px;" onclick="FleetExtra.fcImport()">' + t('fe.fc.import') + '</button>'
        + '</div>'
        + '<div class="text-muted" style="font-size:11px;margin-top:8px;">' + t('fe.fc.preview') + esc(_fcRows[0].slice(0, 6).join(' | ').slice(0, 140)) + '</div>'
        + '</div>';
      var setSel = function (id, v) { var el = document.getElementById(id); if (el && v) el.value = v; };
      setSel('fcColDate', guess(/dat|date|nap/i));
      setSel('fcColPlate', guess(/rendsz|plate|inmatric|nr\.?\s*auto|vehic|kfz/i));
      setSel('fcColQty', guess(/liter|litru|cantit|qty|menny/i));
      setSel('fcColAmount', guess(/suma|amount|brutto|total|ertek|érték|valoare/i));
      setSel('fcColProduct', guess(/produs|product|termek|termék|aru|áru/i));
    };
    reader.readAsText(f[0], 'utf-8');
  }

  function fcNum(s) {
    // román/magyar tizedesvessző + ezres-elválasztók kezelése
    s = String(s == null ? '' : s).replace(/\s/g, '');
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    return parseFloat(s);
  }
  function fcDate(s) {
    s = String(s || '').trim();
    var m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);          // yyyy-mm-dd
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);              // dd.mm.yyyy
    if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return null;
  }

  function fcImport() {
    var col = function (id) { var v = (document.getElementById(id) || {}).value; return v === '' ? -1 : parseInt(v, 10); };
    var ci = { d: col('fcColDate'), p: col('fcColPlate'), q: col('fcColQty'), a: col('fcColAmount'), pr: col('fcColProduct') };
    if (ci.d < 0 || ci.p < 0 || ci.q < 0 || ci.a < 0) { toast(t('fe.fc.mapReq'), 'err'); return; }
    var rows = _fcRows.map(function (r) {
      return {
        tx_date: fcDate(r[ci.d]), rendszam: r[ci.p],
        qty_l: fcNum(r[ci.q]), amount_ron: fcNum(r[ci.a]),
        product: ci.pr >= 0 ? r[ci.pr] : null,
      };
    }).filter(function (r) { return r.tx_date && isFinite(r.qty_l) && isFinite(r.amount_ron); });
    if (!rows.length) { toast(t('fe.fc.noValid'), 'err'); return; }
    gas('fuelImportRows', [{ source: (document.getElementById('fcSource') || {}).value, rows: rows }]).then(function (r) {
      if (r && r.ok) {
        toast(t('fe.fc.importDone', { ins: r.inserted, skip: r.skipped }), 'ok');
        document.getElementById('fcMapping').innerHTML = '';
        var mr = monthRange(); fcLoadData(mr.from, mr.to);
      } else toast((r && r.err) || t('common.error'), 'err');
    });
  }

  // ── Vezérlőpult lejárat-riasztás kártya (loadDashboard hívja) ──
  function renderDashExpiryAlert() {
    var box = document.getElementById('dashExpiryAlert');
    if (!box) return;
    gas('getExpiryAlerts').then(function (r) {
      if (!r || !r.ok || !(r.items || []).length) { box.innerHTML = ''; return; }
      var lejart = r.items.filter(function (i) { return i.days_left < 0; });
      var rows = r.items.slice(0, 6).map(function (i) {
        var ico = i.entity_type === 'driver' ? '👤' : i.entity_type === 'uit' ? '🛣️' : '🚛';
        var col = i.days_left < 0 ? 'var(--status-danger)' : 'var(--status-warn)';
        return '<span style="white-space:nowrap;font-size:12px;">' + ico + ' <b>' + esc(i.entity_label || '') + '</b> '
          + esc(i.doc_type) + ' <span style="color:' + col + ';font-weight:700;">'
          + (i.days_left < 0 ? t('fe.dash.expired') : t('fe.dash.days', { n: i.days_left })) + '</span></span>';
      }).join(' · ');
      box.innerHTML = '<div class="glass" style="padding:12px 16px;margin-bottom:16px;border:1px solid '
        + (lejart.length ? 'rgba(239,68,68,0.4)' : 'rgba(245,158,11,0.4)') + ';cursor:pointer;display:flex;gap:10px;align-items:center;flex-wrap:wrap;" onclick="activateTab(\'expiries\')">'
        + '<span style="font-size:18px;">⏰</span>'
        + '<b class="text-primary" style="font-size:13px;">' + t('fe.dash.docsExpiring', { n: r.items.length })
        + (lejart.length ? t('fe.dash.expiredCount', { n: lejart.length }) : '') + ':</b> ' + rows
        + ' <span class="text-muted" style="font-size:12px;margin-left:auto;">' + t('fe.dash.toExpiries') + '</span></div>';
    }).catch(function () { box.innerHTML = ''; });
  }

  // ── Publikus API ────────────────────────────────────────
  window.FleetExtra = {
    load: function (name) {
      if (name === 'expiries') loadExpiries();
      else if (name === 'service-log') loadServiceLog();
      else if (name === 'decont') loadDecont();
      else if (name === 'fuel-import') loadFuelImport();
    },
    dashExpiryAlert: renderDashExpiryAlert,
    expEntityChange: expEntityChange, expSave: expSave, expEdit: expEdit, expDelete: expDelete,
    svSave: svSave, svDelete: svDelete,
    dcLoad: dcLoad, dcSaveRates: dcSaveRates, advSave: advSave, advDelete: advDelete,
    fcParse: fcParse, fcImport: fcImport,
  };
})();
