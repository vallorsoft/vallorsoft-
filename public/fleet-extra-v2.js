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

      // ⏰ Interaktív KPI mutató-sáv — a már lekért _expItems-ből (nincs új hálózati hívás)
      var expBand = '';
      if (typeof vsMetricBand === 'function') {
        var eTotal = _expItems.length;
        var eSoon = _expItems.filter(function (it) { var dl = parseInt(it.days_left, 10); return dl >= 0 && dl <= (it.alert_days || 30); }).length;
        var eExpired = _expItems.filter(function (it) { return parseInt(it.days_left, 10) < 0; }).length;
        var eOk = _expItems.filter(function (it) { return parseInt(it.days_left, 10) > (it.alert_days || 30); }).length;
        expBand = '<div style="margin-bottom:18px;">' + vsMetricBand([
          { l: t('fe.exp.kpiWatched'), v: eTotal,   sub: t('fe.exp.kpiSoon') + ': ' + eSoon },
          { l: t('fe.exp.kpiSoon'),    v: eSoon,     sub: t('fe.exp.kpiSoonSub') },
          { l: t('fe.exp.kpiExpired'), v: eExpired,  sub: t('fe.exp.kpiExpiredSub') },
          { l: t('fe.exp.kpiOk'),      v: eOk,       sub: t('fe.exp.kpiOkSub') }
        ]) + '</div>';
      }

      box.innerHTML =
        expBand
        + panel(t('fe.exp.newTitle'), formHtml)
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
  // A szerver által küldött fehérlista fallbackje (ha a serviceList
  // válaszban nincs item_keys — pl. régi cache miatt).
  var SVC_ITEM_KEYS_FALLBACK = [
    'oil', 'oil_filter', 'fuel_filter', 'air_filter', 'pollen_filter',
    'adblue_filter', 'air_dryer_filter', 'brake_pads', 'brake_disc',
    'coolant', 'transmission_oil', 'differential_oil', 'tires',
    'wipers', 'battery', 'timing_belt', 'other'
  ];
  var _svLastItems = [];   // a serviceList utolsó eredménye (a modal használja)
  var _svItemKeys = SVC_ITEM_KEYS_FALLBACK.slice();
  var _svModalItemId = null;   // épp nyitott sor id (Halasztás/Elvégezve modal)

  function serviceCats() {
    return [['olajcsere', t('fe.sv.cat.oil')], ['gumi', t('fe.sv.cat.tire')], ['javitas', t('fe.sv.cat.repair')],
      ['karbantartas', t('fe.sv.cat.maint')], ['egyeb', t('fe.sv.cat.other')]];
  }

  // Segéd: egy szerviz-tétel keresése — először a szerviz-napló betöltött
  // listájából, aztán a vezérlőpult riasztás-listájából (dashboardról nyílt modal).
  function _svFindItem(id) {
    var idN = parseInt(id, 10);
    for (var i = 0; i < _svLastItems.length; i++) {
      if (parseInt(_svLastItems[i].id, 10) === idN) return _svLastItems[i];
    }
    // Fallback: dashboard-riasztás cache
    if (window._svAlertCache && Array.isArray(window._svAlertCache)) {
      for (var j = 0; j < window._svAlertCache.length; j++) {
        if (parseInt(window._svAlertCache[j].id, 10) === idN) return window._svAlertCache[j];
      }
    }
    return null;
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
      _svLastItems = items;   // a Halasztás/Elvégezve modal használja
      _svItemKeys = (r.item_keys && r.item_keys.length) ? r.item_keys : SVC_ITEM_KEYS_FALLBACK;
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
        var isClosed = !!it.closed_at;
        var hasOpen = !isClosed && (it.next_due_date || it.next_due_km != null);
        var descHtml = esc(it.description || '—');
        // Pipált tételek badge (rövid) — teljes lista tooltipben
        if (Array.isArray(it.items) && it.items.length) {
          var lbls = it.items.map(function (x) {
            var lb = t('fe.sv.item.' + x.key) || x.key;
            return x.note ? lb + ' (' + esc(x.note) + ')' : lb;
          });
          descHtml += ' <span class="sv-items-badge" title="' + esc(lbls.join(', ')) + '" '
            + 'style="display:inline-block;padding:1px 8px;margin-left:6px;background:rgba(34,197,94,0.15);color:#16a34a;'
            + 'border:1px solid rgba(34,197,94,0.35);border-radius:999px;font-size:11px;font-weight:600;">'
            + '✓ ' + it.items.length + ' ' + t('fe.sv.itemsShort')
            + '</span>';
        }
        if (isClosed) {
          descHtml += ' <span class="sv-closed-badge" style="display:inline-block;padding:1px 8px;margin-left:6px;'
            + 'background:rgba(148,163,184,0.2);color:#64748b;border:1px solid rgba(148,163,184,0.4);'
            + 'border-radius:999px;font-size:11px;font-weight:600;">🔒 ' + t('fe.sv.closed') + '</span>';
        }
        if ((it.postpone_count || 0) > 0 && !isClosed) {
          descHtml += ' <span class="sv-post-badge" title="' + esc(t('fe.sv.postponeCountTip')) + '" '
            + 'style="display:inline-block;padding:1px 8px;margin-left:6px;background:rgba(245,158,11,0.15);color:#d97706;'
            + 'border:1px solid rgba(245,158,11,0.35);border-radius:999px;font-size:11px;font-weight:600;">'
            + '🕐 ' + it.postpone_count + '×</span>';
        }
        var actions = '';
        if (hasOpen) {
          actions = '<button class="btn ghost" style="padding:4px 10px;font-size:12px;margin-right:4px;" '
            + 'onclick="FleetExtra.svOpenPostpone(' + it.id + ')">🕐 ' + t('fe.sv.postponeBtn') + '</button>'
            + '<button class="btn primary" style="padding:4px 10px;font-size:12px;margin-right:4px;" '
            + 'onclick="FleetExtra.svOpenComplete(' + it.id + ')">✅ ' + t('fe.sv.doneBtn') + '</button>';
        }
        actions += '<button class="btn danger" style="padding:4px 10px;font-size:12px;" '
          + 'onclick="FleetExtra.svDelete(' + it.id + ')">✕</button>';

        return '<tr' + (isClosed ? ' style="opacity:0.75;"' : '') + '>'
          + '<td><b class="text-primary">' + esc(it.rendszam) + '</b></td>'
          + '<td>' + d2(it.service_date) + '</td>'
          + '<td style="text-align:right;">' + (it.km != null ? n2(it.km, 0) : '—') + '</td>'
          + '<td>' + (catLbl[it.category] || esc(it.category || '—')) + '</td>'
          + '<td>' + descHtml + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + (it.cost_ron != null ? n2(it.cost_ron, 0) : '—') + '</td>'
          + '<td class="text-muted" style="font-size:12px;">'
          + (it.next_due_date ? '📅 ' + d2(it.next_due_date) : '') + (it.next_due_km ? ' 🛣 ' + n2(it.next_due_km, 0) + ' km' : '')
          + (!it.next_due_date && !it.next_due_km ? '—' : '')
          + '</td>'
          + '<td style="text-align:right;white-space:nowrap;">' + actions + '</td>'
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

  // ────────────────────────────────────────────────────────
  //  🔧 Szerviz esedékesség — DÖNTÉS modal (Halasztás vagy Elvégezve)
  //  Egyetlen közös overlay (#svAlertModal), a fejlécen két nagy gomb;
  //  az egyik kiválasztása felnyitja a hozzá tartozó formot ugyanott.
  //  Onnan a szerver a rezidens `servicePostpone` / `serviceComplete` RPC-t
  //  hívja; sikeres válasz után a dashboard sáv + szerviz-napló újratöltődik.
  // ────────────────────────────────────────────────────────
  function _svEnsureModal() {
    if (document.getElementById('svAlertModal')) return;
    // A projekt konvenciója: .modal-back a szülő overlay (.open osztály nyitja),
    // belül .modal.glass a tényleges tartalom-doboz.
    var m = document.createElement('div');
    m.id = 'svAlertModal';
    m.className = 'modal-back';
    m.setAttribute('role', 'dialog');
    m.innerHTML =
      '<div class="modal glass" style="width:min(640px,100%);max-height:92vh;overflow-y:auto;padding:22px;">'
    +   '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">'
    +     '<h3 id="svamTitle" class="text-primary" style="margin:0;font-size:18px;">🔧</h3>'
    +     '<button class="btn ghost" style="padding:4px 10px;" onclick="FleetExtra.svCloseModal()">✕</button>'
    +   '</div>'
    +   '<div id="svamInfo" class="text-muted" style="font-size:13px;margin-bottom:12px;"></div>'
    +   '<div id="svamBody"></div>'
    + '</div>';
    // A háttérre kattintva (de a modal tartalmára nem) bezár:
    m.addEventListener('click', function (ev) { if (ev.target === m) svCloseModal(); });
    document.body.appendChild(m);
  }

  function svCloseModal() {
    var m = document.getElementById('svAlertModal');
    if (m) m.classList.remove('open');
    _svModalItemId = null;
  }

  function _svOpen(id) {
    _svEnsureModal();
    var it = _svFindItem(id);
    if (!it) { toast(t('common.notFound') || 'Nu a fost găsit', 'err'); return null; }
    _svModalItemId = parseInt(id, 10);
    var m = document.getElementById('svAlertModal');
    m.classList.add('open');
    var info = document.getElementById('svamInfo');
    var infoBits = [];
    if (it.rendszam) infoBits.push('🚛 <b class="text-primary">' + esc(it.rendszam) + '</b>');
    if (it.marca || it.tip) infoBits.push(esc([it.marca, it.tip].filter(Boolean).join(' ')));
    // Az esedékesség: km-alapú (kmLeft) vagy dátum-alapú
    if (it.km_left != null) {
      var s = it.km_left < 0
        ? '<span style="color:var(--status-danger);font-weight:700;">' + t('fe.dash.kmOver', { n: Math.abs(it.km_left).toLocaleString('hu-HU') }) + '</span>'
        : '<span style="color:var(--status-warn);font-weight:700;">' + t('fe.dash.kmLeft', { n: it.km_left.toLocaleString('hu-HU') }) + '</span>';
      infoBits.push(s);
    } else if (it.days_left != null) {
      var d = it.days_left < 0
        ? '<span style="color:var(--status-danger);font-weight:700;">' + t('fe.dash.expired') + '</span>'
        : '<span style="color:var(--status-warn);font-weight:700;">' + t('fe.dash.days', { n: it.days_left }) + '</span>';
      infoBits.push(d);
    }
    if (it.next_due_km != null) infoBits.push(t('fe.sv.currentNextKm') + ': <b>' + n2(it.next_due_km, 0) + ' km</b>');
    if (it.next_due_date) infoBits.push(t('fe.sv.currentNextDate') + ': <b>' + d2(it.next_due_date) + '</b>');
    info.innerHTML = infoBits.join(' · ');
    return it;
  }

  // A "chip"-re (dashboard) kattintva megnyílik a döntés-választó:
  // egy fejléc + két nagy gomb (Halasztás / Elvégezve).
  function svOpenDecide(id) {
    var it = _svOpen(id); if (!it) return;
    document.getElementById('svamTitle').innerHTML = '🔧 ' + t('fe.sv.decideTitle');
    document.getElementById('svamBody').innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:6px;">'
    +   '<button class="btn ghost" style="padding:22px 12px;font-size:14px;font-weight:700;" '
    +     'onclick="FleetExtra.svOpenPostpone(' + _svModalItemId + ')">🕐 ' + t('fe.sv.postponeBtn')
    +     '<div class="text-muted" style="font-weight:400;font-size:12px;margin-top:4px;">' + t('fe.sv.postponeHint') + '</div></button>'
    +   '<button class="btn primary" style="padding:22px 12px;font-size:14px;font-weight:700;" '
    +     'onclick="FleetExtra.svOpenComplete(' + _svModalItemId + ')">✅ ' + t('fe.sv.doneBtn')
    +     '<div style="font-weight:400;font-size:12px;margin-top:4px;opacity:0.85;">' + t('fe.sv.doneHint') + '</div></button>'
    + '</div>';
  }

  // ── Halasztás form ─────────────────────────────────────
  function svOpenPostpone(id) {
    var it = _svOpen(id); if (!it) return;
    document.getElementById('svamTitle').innerHTML = '🕐 ' + t('fe.sv.postponeTitle');
    // Az alap-értékek a jelenlegi esedékességből + presetek biztosítanak gyors kitöltést.
    var curDate = it.next_due_date ? String(it.next_due_date).slice(0, 10) : '';
    var curKm = (it.next_due_km != null ? it.next_due_km : '');
    document.getElementById('svamBody').innerHTML =
      '<div class="field" style="margin:0 0 10px;"><label>' + t('fe.sv.newDate') + '</label>'
    +   '<input class="input" id="svPostDate" type="date" value="' + esc(curDate) + '"></div>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">'
    +   '<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="FleetExtra.svPostDatePreset(7)">+7</button>'
    +   '<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="FleetExtra.svPostDatePreset(14)">+14</button>'
    +   '<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="FleetExtra.svPostDatePreset(30)">+30 ' + t('fe.sv.days') + '</button>'
    +   '<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="FleetExtra.svPostDatePreset(60)">+60</button>'
    +   '<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="FleetExtra.svPostDatePreset(90)">+90</button>'
    + '</div>'
    + '<div class="field" style="margin:0 0 10px;"><label>' + t('fe.sv.newKm') + '</label>'
    +   '<input class="input" id="svPostKm" type="number" value="' + esc(String(curKm)) + '" placeholder="pl. 555000"></div>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">'
    +   '<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="FleetExtra.svPostKmPreset(1000)">+1 000</button>'
    +   '<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="FleetExtra.svPostKmPreset(2000)">+2 000</button>'
    +   '<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="FleetExtra.svPostKmPreset(5000)">+5 000</button>'
    +   '<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="FleetExtra.svPostKmPreset(10000)">+10 000</button>'
    + '</div>'
    + '<div class="field" style="margin:0 0 12px;"><label>' + t('fe.sv.postponeNote') + '</label>'
    +   '<input class="input" id="svPostNote" placeholder="' + esc(t('fe.sv.postponeNotePh')) + '"></div>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
    +   '<button class="btn ghost" onclick="FleetExtra.svCloseModal()">' + t('common.cancel') + '</button>'
    +   '<button class="btn primary" onclick="FleetExtra.svSubmitPostpone()">🕐 ' + t('fe.sv.postponeSubmit') + '</button>'
    + '</div>';
  }

  function svPostDatePreset(days) {
    var el = document.getElementById('svPostDate'); if (!el) return;
    var base = el.value ? new Date(el.value + 'T00:00:00') : new Date();
    // Ha üres volt, mai naptól számít; ha volt érték, ahhoz ad hozzá.
    if (isNaN(base.getTime())) base = new Date();
    base.setDate(base.getDate() + parseInt(days, 10));
    el.value = base.toISOString().slice(0, 10);
  }
  function svPostKmPreset(km) {
    var el = document.getElementById('svPostKm'); if (!el) return;
    var cur = parseInt(el.value, 10);
    if (!isFinite(cur)) cur = 0;
    el.value = String(cur + parseInt(km, 10));
  }

  function svSubmitPostpone() {
    if (!_svModalItemId) return;
    var d = (document.getElementById('svPostDate') || {}).value || null;
    var km = (document.getElementById('svPostKm') || {}).value || null;
    var note = (document.getElementById('svPostNote') || {}).value || '';
    if (!d && !km) { toast(t('fe.sv.needDateOrKm'), 'err'); return; }
    gas('servicePostpone', [_svModalItemId, { next_due_date: d, next_due_km: km, note: note }]).then(function (r) {
      if (!r || !r.ok) { toast((r && r.err) || t('common.error'), 'err'); return; }
      toast(t('fe.sv.postponed'), 'ok');
      svCloseModal();
      if (typeof renderDashServiceAlert === 'function') renderDashServiceAlert();
      // Ha nyitva van a szerviz-napló, frissítjük — másképp majd megnyitáskor.
      if (document.getElementById('serviceLogBox')) loadServiceLog();
    });
  }

  // ── Elvégezve form ─────────────────────────────────────
  function svOpenComplete(id) {
    var it = _svOpen(id); if (!it) return;
    document.getElementById('svamTitle').innerHTML = '✅ ' + t('fe.sv.doneTitle');
    var today = new Date().toISOString().slice(0, 10);
    // Új esedékesség preset: dátum +365 nap, km alapból +40 000 az aktuálisból
    // (a felhasználó felülírhatja; a szerver csak a beírt értéket használja).
    var suggestKm = '';
    if (it.current_km != null) suggestKm = String(parseInt(it.current_km, 10) + 40000);
    else if (it.next_due_km != null) suggestKm = String(parseInt(it.next_due_km, 10) + 40000);
    var oneYear = new Date(); oneYear.setDate(oneYear.getDate() + 365);
    var suggestDate = oneYear.toISOString().slice(0, 10);

    var itemChecks = _svItemKeys.filter(function (k) { return k !== 'other'; }).map(function (k) {
      return '<label style="display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--glass-border-dark,rgba(255,255,255,0.1));border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.02);">'
        + '<input type="checkbox" class="sv-do-chk" value="' + k + '" style="margin:0;">'
        + '<span style="font-size:13px;">' + esc(t('fe.sv.item.' + k) || k) + '</span></label>';
    }).join('');

    document.getElementById('svamBody').innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">'
    +   '<div class="field" style="margin:0;"><label>' + t('fe.sv.date') + '</label>'
    +     '<input class="input" id="svDoDate" type="date" value="' + today + '"></div>'
    +   '<div class="field" style="margin:0;"><label>' + t('fe.sv.km') + '</label>'
    +     '<input class="input" id="svDoKm" type="number" placeholder="pl. 450000"></div>'
    +   '<div class="field" style="margin:0;grid-column:span 2;"><label>' + t('fe.sv.desc') + '</label>'
    +     '<input class="input" id="svDoDesc" placeholder="' + esc(t('fe.sv.descPh')) + '"></div>'
    +   '<div class="field" style="margin:0;"><label>' + t('fe.sv.cost') + '</label>'
    +     '<input class="input" id="svDoCost" type="number" step="0.01" placeholder="0"></div>'
    +   '<div class="field" style="margin:0;"><label>' + t('fe.sv.type') + '</label><select class="select" id="svDoCat">'
    +     serviceCats().map(function (c) { return '<option value="' + c[0] + '">' + esc(c[1]) + '</option>'; }).join('')
    +   '</select></div>'
    + '</div>'
    + '<div style="margin-bottom:6px;font-weight:600;font-size:13px;">' + t('fe.sv.itemsHead') + ':</div>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px;margin-bottom:10px;">'
    +   itemChecks
    + '</div>'
    + '<div class="field" style="margin:0 0 14px;"><label>' + t('fe.sv.item.other') + ' — ' + t('fe.sv.otherNote') + '</label>'
    +   '<input class="input" id="svDoOtherNote" placeholder="' + esc(t('fe.sv.otherNotePh')) + '"></div>'
    + '<div style="border-top:1px dashed var(--glass-border-dark,rgba(255,255,255,0.15));padding-top:12px;margin-bottom:12px;">'
    +   '<div style="font-weight:600;font-size:13px;margin-bottom:6px;">📌 ' + t('fe.sv.nextHead') + '</div>'
    +   '<div class="text-muted" style="font-size:12px;margin-bottom:8px;">' + t('fe.sv.nextHint') + '</div>'
    +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
    +     '<div class="field" style="margin:0;"><label>' + t('fe.sv.nextDate') + '</label>'
    +       '<input class="input" id="svDoNextDate" type="date" value="' + suggestDate + '"></div>'
    +     '<div class="field" style="margin:0;"><label>' + t('fe.sv.nextKm') + '</label>'
    +       '<input class="input" id="svDoNextKm" type="number" value="' + esc(suggestKm) + '" placeholder="pl. 490000"></div>'
    +   '</div>'
    + '</div>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
    +   '<button class="btn ghost" onclick="FleetExtra.svCloseModal()">' + t('common.cancel') + '</button>'
    +   '<button class="btn primary" onclick="FleetExtra.svSubmitComplete()">✅ ' + t('fe.sv.doneSubmit') + '</button>'
    + '</div>';
  }

  function svSubmitComplete() {
    if (!_svModalItemId) return;
    var items = [];
    var checks = document.querySelectorAll('#svAlertModal .sv-do-chk');
    for (var i = 0; i < checks.length; i++) {
      if (checks[i].checked) items.push({ key: checks[i].value });
    }
    var otherNote = ((document.getElementById('svDoOtherNote') || {}).value || '').trim();
    if (otherNote) items.push({ key: 'other', note: otherNote });
    var payload = {
      service_date: (document.getElementById('svDoDate') || {}).value || null,
      km:           (document.getElementById('svDoKm') || {}).value || null,
      description:  (document.getElementById('svDoDesc') || {}).value || null,
      cost_ron:     (document.getElementById('svDoCost') || {}).value || null,
      category:     (document.getElementById('svDoCat') || {}).value || null,
      next_due_date:(document.getElementById('svDoNextDate') || {}).value || null,
      next_due_km:  (document.getElementById('svDoNextKm') || {}).value || null,
      items: items
    };
    if (!payload.next_due_date && !payload.next_due_km) {
      if (!confirm(t('fe.sv.noNextConfirm'))) return;
    }
    gas('serviceComplete', [_svModalItemId, payload]).then(function (r) {
      if (!r || !r.ok) { toast((r && r.err) || t('common.error'), 'err'); return; }
      toast(t('fe.sv.completed'), 'ok');
      svCloseModal();
      if (typeof renderDashServiceAlert === 'function') renderDashServiceAlert();
      if (document.getElementById('serviceLogBox')) loadServiceLog();
    });
  }

  // ════════════════════════════════════════════════════════
  //  3) SOFŐR-ELSZÁMOLÁS (DECONT)
  //     Új adat-modell:
  //       - Járandóság (driver_earnings): amivel a cég tartozik
  //         (bónusz, diurna, per_diem, prémium, ünnep, egyéb),
  //         quantity × unit_amount live-számolással, EUR VAGY RON.
  //       - Kifizetés (driver_payments): egy kattintással
  //         részleges/teljes kifizetés EUR/RON választással,
  //         BNR-árfolyam a kifizetés pillanatában elmentve.
  //       - Legacy: driver_advances (készpénz-előleg a menetlevél
  //         költések ellenében) — külön blokkban marad.
  // ════════════════════════════════════════════════════════
  var _dcDrivers = [];
  var _dcCurrent = null;   // az aktuálisan megnyitott sofőr {email,nume}
  var _dcBnr = null;       // legfrissebb BNR-árfolyam (informatív)
  var _dcBalance = null;   // getDriverBalance válasza (a kifizetés-modálhoz)
  // Egyéni járandóság-típusok gyorsítótára: [{key, label_ro, label_hu}, ...]
  // A `earningKindList` handler tölti (Admin/Manager), a beépített 7 mellé.
  var _dcCustomKinds = [];
  var _dcBuiltinKinds = ['bonus', 'diurna', 'per_diem', 'salary', 'premium', 'holiday', 'other'];

  function monthRange() {
    var now = new Date();
    var from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
  }
  function today() { return new Date().toISOString().slice(0, 10); }

  // Sofőr-választó (opciók) — előtöltéssel
  function _dcDriverOptions(selectedEmail) {
    return '<option value="">' + t('fe.choose') + '</option>'
      + _dcDrivers.map(function (u) {
        var sel = (selectedEmail && u.email === selectedEmail) ? ' selected' : '';
        return '<option value="' + esc(u.email) + '"' + sel + '>' + esc(u.nume || u.email) + '</option>';
      }).join('');
  }

  // Járandóság-típus katalógus + ikon (RO-alap, i18n cimkékkel).
  // A beépített 7 (bonus/diurna/per_diem/salary/premium/holiday/other) MELLÉ
  // sorolja a cég saját egyéni típusait (`_dcCustomKinds` cache). A cache-t az
  // `_dcLoadKinds()` tölti a `earningKindList` handlerből — a `loadDecont`-ban
  // egyetlen fetch, utána szinkron a form renderelésénél.
  function _dcKindOptions(selectedKind) {
    var lang = (window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'ro';
    var builtin = _dcBuiltinKinds.map(function (k) {
      var sel = (selectedKind === k) ? ' selected' : '';
      return '<option value="' + k + '"' + sel + '>' + esc(t('fe.de.kind.' + k)) + '</option>';
    }).join('');
    var custom = _dcCustomKinds.map(function (r) {
      var sel = (selectedKind === r.key) ? ' selected' : '';
      var label = (lang === 'hu' && r.label_hu) ? r.label_hu : (r.label_ro || r.key);
      return '<option value="' + esc(r.key) + '"' + sel + '>' + esc(label) + '</option>';
    }).join('');
    return builtin + custom;
  }

  // Egyéni típusok betöltése (best-effort — DB-hiba/migráció-hiány esetén üres)
  function _dcLoadKinds() {
    return gas('earningKindList').then(function (r) {
      if (r && r.ok && Array.isArray(r.items)) {
        _dcCustomKinds = r.items;
        if (Array.isArray(r.builtin) && r.builtin.length) _dcBuiltinKinds = r.builtin;
      }
      return _dcCustomKinds;
    }).catch(function () { return _dcCustomKinds; });
  }

  function loadDecont() {
    var box = document.getElementById('decontBox');
    if (!box) return;
    box.innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.loading') + '</div>';
    Promise.all([
      gas('getInternalDrivers'),
      gas('getBnrRate').catch(function () { return null; }),
      _dcLoadKinds()                            // egyéni típusok előtöltése
    ]).then(function (rs) {
      _dcDrivers = Array.isArray(rs[0]) ? rs[0] : [];
      var bnr = rs[1] && rs[1].bnr_rate != null ? Number(rs[1].bnr_rate) : null;
      _dcBnr = bnr;
      var mr = monthRange();

      // Sofőr-választó kártya
      var selectorCard = panel(t('fe.dc.title'),
        '<div class="dc-toolbar">'
        // Sofőr-választásra AZONNAL betölti a járandóság + kifizetés + egyenleg
        // nézetet — nem kell külön az „Elszámolás" gombot lenyomni. Az időszak-
        // változtatás is autoload (csak ha már van választott sofőr).
        + '<div class="field" style="margin:0;flex:1;min-width:200px;"><label>' + t('fe.dc.driverReq') + '</label>'
        +   '<select class="select" id="dcDriver" onchange="FleetExtra.dcLoad()">' + _dcDriverOptions() + '</select></div>'
        + '<div class="field" style="margin:0;"><label>' + t('fe.dc.periodFrom') + '</label>'
        +   '<input class="input" id="dcFrom" type="date" value="' + mr.from + '" onchange="FleetExtra._dcMaybeReload()"></div>'
        + '<div class="field" style="margin:0;"><label>' + t('fe.dc.periodTo') + '</label>'
        +   '<input class="input" id="dcTo" type="date" value="' + mr.to + '" onchange="FleetExtra._dcMaybeReload()"></div>'
        + '<button class="btn primary" style="height:42px;" onclick="FleetExtra.dcLoad()" title="' + t('fe.dc.calc') + '">'
        +   '🔄 ' + t('fe.dc.calc') + '</button>'
        + '</div>'
        + '<div class="dc-bnr-line">'
        +   '<span>🏦 <b>' + t('fe.dc.bnrToday') + ':</b> '
        +     (bnr != null
              ? '<span class="dc-bnr-val">1 EUR = ' + n2(bnr, 4) + ' RON</span>'
              : '<span class="text-muted">' + t('fe.dc.bnrNa') + '</span>')
        +   '</span>'
        +   '<span class="text-muted" style="font-size:12px;">' + t('fe.dc.bnrHint') + '</span>'
        + '</div>'
      );

      box.innerHTML = selectorCard + '<div id="dcResult"></div>';
    });
  }

  // Csak akkor tölt újra, ha már van választott sofőr — így az időszak-
  // mezők onchange autoload-ja nem villantja fel a „Válassz sofőrt" toastot.
  function _dcMaybeReload() {
    var email = (document.getElementById('dcDriver') || {}).value;
    if (email) dcLoad();
  }

  // A sofőr összes fontos kártyája (egyenleg + felvitel + listák + legacy)
  function dcLoad() {
    var email = (document.getElementById('dcDriver') || {}).value;
    var from = (document.getElementById('dcFrom') || {}).value;
    var to = (document.getElementById('dcTo') || {}).value;
    // Üres sofőr-kiválasztás (pl. „— Válassz —" opció) → csendben nulláz;
    // NEM dob toastot, mert az onchange autoload is ide fut és villogna.
    if (!email) {
      var out0 = document.getElementById('dcResult');
      if (out0) out0.innerHTML = '';
      return;
    }
    var out = document.getElementById('dcResult');
    out.innerHTML = '<div class="text-muted" style="padding:20px;text-align:center;">' + t('fe.calcing') + '</div>';

    var driver = _dcDrivers.find(function (u) { return u.email === email; }) || { email: email };
    _dcCurrent = { email: email, nume: driver.nume || email, from: from, to: to };

    // Kulcs elv: a JÁRANDÓSÁG-FELVITEL kártya + a KIFIZETÉS-gombok MINDIG
    // renderelődnek — függetlenül attól, hogy a getDriverBalance / earningList
    // / paymentList hívások sikeresen visszatérnek-e. Ha a szerver-oldali
    // migráció még nem futott le / a hívás elhasal, csak az egyenleg-csempéken
    // látszik „—" — a felvitel-form és a kifizetés-gombok akkor is elérhetők.
    // A régi menetlevél-alapú kassza-blokkot innen kivettük (a felhasználó
    // szerint értéktelen a UI-hoz — csak zavart a modern funkciók keresésénél).
    Promise.all([
      gas('getDriverBalance', [{ email: email, from: from, to: to }]).catch(function () { return { ok: false }; }),
      gas('earningList',      [{ email: email, from: from, to: to }]).catch(function () { return { ok: false, items: [] }; }),
      gas('paymentList',      [{ email: email, from: from, to: to }]).catch(function () { return { ok: false, items: [] }; }),
    ]).then(function (rs) {
      var bal  = rs[0] || { ok: false };
      var earn = rs[1] || { ok: false, items: [] };
      var pay  = rs[2] || { ok: false, items: [] };

      // Egyenleg-kártya adatai: ha bal.ok, akkor a szerver-válasz; egyébként
      // üres struktúra (a csempék „0 EUR / 0 RON"-t mutatnak + „nem elérhető"
      // BNR-sorral). Nincs teljes hiba-oldal → a felvitel-form még használható.
      _dcBalance = bal.ok ? bal : {
        ok: false,
        balance: { eur: 0, ron: 0, ron_all: null },
        earned:  { eur: 0, ron: 0, count: 0 },
        paid:    { eur: 0, ron: 0, count: 0 },
        bnr_rate: null,
      };

      // ── 1) EGYENLEG-KÁRTYA (járandóság / kifizetve / hátralék) ──
      var balHtml = _dcBalanceCard(_dcBalance);

      // ── 2) JÁRANDÓSÁG-FELVITEL kártya (MINDIG megjelenik) ──
      var earnFormHtml = _dcEarningForm(email);

      // ── 3) JÁRANDÓSÁG-LISTA + KIFIZETÉS-LISTA (kártyák) ──
      var earnItems = (earn && earn.items) || [];
      var payItems  = (pay  && pay.items)  || [];
      var listsHtml =
        '<div class="dc-two-col">'
        + panel('📥 ' + t('fe.de.listTitle') + ' (' + earnItems.length + ')', _dcEarningListHtml(earnItems))
        + panel('💸 ' + t('fe.pm.listTitle') + ' (' + payItems.length + ')',  _dcPaymentListHtml(payItems))
        + '</div>';

      // Vizuális marker: „🆕 v2" a fejlécben, hogy egyértelmű legyen a
      // felhasználónak, hogy az új verziót látja (nem a cachelt régit).
      out.innerHTML =
        panel('🆕 ' + esc(_dcCurrent.nume) + ' — ' + t('fe.dc.settleV2', 'elszámolás 2.0') + ' (' + d2(from) + ' → ' + d2(to) + ')',
          balHtml,
          '<div style="display:flex;gap:6px;flex-wrap:wrap;">'
          + '<button class="btn primary" style="padding:6px 14px;font-size:12px;" '
          +   'onclick="FleetExtra.dcOpenSettlement()" title="' + t('fe.st.openTitle') + '">'
          +   '📄 ' + t('fe.st.openBtn') + '</button>'
          + '<button class="btn ok" style="padding:6px 14px;font-size:12px;" '
          +   'onclick="FleetExtra.dcOpenOfficialSettlement()" title="' + t('fe.stof.openTitle') + '">'
          +   '📑 ' + t('fe.stof.openBtn') + '</button>'
          + '</div>')
        + earnFormHtml
        + listsHtml;

      // Live-számoló bekötése (qty × unit)
      _dcBindLiveCalc();
    });
  }

  // ── Egyenleg-kártya: színes csempék EUR + RON + kombinált RON ──
  function _dcBalanceCard(bal) {
    var b = bal.balance || {};
    var e = bal.earned || {};
    var p = bal.paid || {};
    var bnr = bal.bnr_rate;

    function tile(label, val, cur, tone) {
      // tone: 'ok'|'warn'|'danger'|'info'|'muted'
      var color = tone === 'ok' ? 'var(--status-ok)'
        : tone === 'danger' ? 'var(--status-danger)'
        : tone === 'warn' ? 'var(--status-warn)'
        : tone === 'info' ? 'var(--status-info)'
        : 'var(--text-primary)';
      var suf = cur ? ' <span class="dc-tile-cur">' + esc(cur) + '</span>' : '';
      return '<div class="dc-tile dc-tone-' + esc(tone || 'muted') + '">'
        + '<div class="dc-tile-l">' + label + '</div>'
        + '<div class="dc-tile-v" style="color:' + color + ';">' + n2(val, 2) + suf + '</div>'
        + '</div>';
    }

    var eurTone = (b.eur || 0) > 0 ? 'danger' : ((b.eur || 0) < 0 ? 'ok' : 'muted');
    var ronTone = (b.ron || 0) > 0 ? 'danger' : ((b.ron || 0) < 0 ? 'ok' : 'muted');

    var tiles =
      '<div class="dc-tiles">'
      +   tile('📥 ' + t('fe.de.earnedEur'), e.eur || 0, 'EUR', 'info')
      +   tile('📥 ' + t('fe.de.earnedRon'), e.ron || 0, 'RON', 'info')
      +   tile('💸 ' + t('fe.pm.paidEur'),   p.eur || 0, 'EUR', 'muted')
      +   tile('💸 ' + t('fe.pm.paidRon'),   p.ron || 0, 'RON', 'muted')
      +   tile('⚖️ ' + t('fe.dc.balEur'),    b.eur || 0, 'EUR', eurTone)
      +   tile('⚖️ ' + t('fe.dc.balRon'),    b.ron || 0, 'RON', ronTone)
      + '</div>';

    var ronAll = b.ron_all;
    var payButtons =
      '<div class="dc-pay-actions">'
      + '<button class="btn primary" onclick="FleetExtra.dcOpenPayment(\'partial\')">💵 '
        + t('fe.pm.payPartial') + '</button>'
      + '<button class="btn ok" onclick="FleetExtra.dcOpenPayment(\'full\')">✅ '
        + t('fe.pm.payFull') + '</button>'
      + '</div>';

    var bnrLine = '<div class="dc-bnr-line">'
      + '<span>🏦 <b>' + t('fe.dc.bnrToday') + ':</b> '
      +   (bnr != null
          ? '<span class="dc-bnr-val">1 EUR = ' + n2(bnr, 4) + ' RON</span>'
          : '<span class="text-muted">' + t('fe.dc.bnrNa') + '</span>')
      + '</span>'
      + (ronAll != null && bnr != null
          ? '<span style="margin-left:auto;">' + t('fe.dc.balCombined') + ': <b>'
             + n2(ronAll, 2) + ' RON</b> <span class="text-muted" style="font-size:12px;">('
             + t('fe.dc.combinedNote') + ')</span></span>'
          : '')
      + '</div>';

    return tiles + bnrLine + payButtons;
  }

  // ── Járandóság-felvitel kártya (kind + qty × unit_amount + currency) ──
  function _dcEarningForm(email) {
    var todayStr = today();
    var body =
      '<div class="dc-earn-grid">'
      + '<div class="field" style="margin:0;"><label>' + t('fe.de.kindLbl') + '</label>'
      +   '<div class="dc-kind-row">'
      +     '<select class="select" id="deKind" onchange="FleetExtra.dcEarnKindChange()">'
      +     _dcKindOptions('bonus') + '</select>'
      +     '<button type="button" class="btn ghost dc-kind-add" '
      +       'onclick="FleetExtra.dcKindManage()" title="' + t('fe.dk.manageTitle') + '">'
      +       '⚙️</button>'
      +   '</div>'
      + '</div>'
      + '<div class="field" style="margin:0;"><label>' + t('fe.de.labelLbl') + '</label>'
      +   '<input class="input" id="deLabel" placeholder="' + t('fe.de.labelPh') + '"></div>'
      + '<div class="field" style="margin:0;"><label>' + t('fe.de.dateLbl') + '</label>'
      +   '<input class="input" id="deDate" type="date" value="' + todayStr + '"></div>'
      + '<div class="field" style="margin:0;"><label>' + t('fe.de.qtyLbl') + '</label>'
      +   '<input class="input" id="deQty" type="number" min="0.01" step="0.01" value="1" oninput="FleetExtra.dcEarnRecalc()"></div>'
      + '<div class="field" style="margin:0;"><label>' + t('fe.de.unitLbl') + '</label>'
      +   '<input class="input" id="deUnit" type="number" min="0.01" step="0.01" placeholder="0.00" oninput="FleetExtra.dcEarnRecalc()"></div>'
      + '<div class="field" style="margin:0;"><label>' + t('fe.de.currencyLbl') + '</label>'
      +   '<select class="select" id="deCur">'
      +     '<option value="RON">RON</option><option value="EUR">EUR</option></select></div>'
      + '<div class="field" style="margin:0;grid-column:1/-1;"><label>' + t('fld.note') + '</label>'
      +   '<input class="input" id="deNote" placeholder="' + t('fe.de.notePh') + '"></div>'
      + '</div>'
      + '<div class="dc-earn-foot">'
      + '  <div class="dc-earn-total">= <span id="deTotal">0.00</span> <span id="deTotalCur">RON</span></div>'
      + '  <button class="btn ok" onclick="FleetExtra.dcEarnSave()">💾 ' + t('fe.de.saveBtn') + '</button>'
      + '</div>'
      + '<p class="text-muted" style="font-size:12px;margin:8px 0 0;">' + t('fe.de.hint') + '</p>';
    return panel('➕ ' + t('fe.de.newTitle'), body);
  }

  // Live-számoló: qty × unit
  function _dcBindLiveCalc() {
    dcEarnKindChange();
    dcEarnRecalc();
  }

  function dcEarnKindChange() {
    var k = (document.getElementById('deKind') || {}).value;
    // Néhány típusnál értelmes alapérték az UNIT-ra: pl. per_diem = 70 RON/nap default nincs — üresen hagyjuk;
    // a mezők értékét nem írjuk felül, csak a placeholdert testreszabjuk.
    var labelInput = document.getElementById('deLabel');
    if (labelInput && !labelInput.value) {
      labelInput.placeholder = t('fe.de.lblPh_' + k) || t('fe.de.labelPh');
    }
    // Cur alapérték: bonus/premium/holiday = EUR, a többi = RON
    var cur = document.getElementById('deCur');
    if (cur && cur.dataset.userSet !== '1') {
      var isEur = (k === 'bonus' || k === 'premium' || k === 'holiday');
      cur.value = isEur ? 'EUR' : 'RON';
      dcEarnRecalc();
    }
    if (cur) { cur.addEventListener('change', function () { cur.dataset.userSet = '1'; dcEarnRecalc(); }, { once: true }); }
  }

  function dcEarnRecalc() {
    var q = parseFloat((document.getElementById('deQty')  || {}).value) || 0;
    var u = parseFloat((document.getElementById('deUnit') || {}).value) || 0;
    var c = (document.getElementById('deCur') || {}).value || 'RON';
    var totalEl = document.getElementById('deTotal');
    var curEl = document.getElementById('deTotalCur');
    if (totalEl) totalEl.textContent = n2(Math.round(q * u * 100) / 100, 2);
    if (curEl) curEl.textContent = c;
  }

  function dcEarnSave() {
    if (!_dcCurrent || !_dcCurrent.email) { toast(t('fe.dc.pickDriver'), 'err'); return; }
    var f = {
      email_sofer: _dcCurrent.email,
      earning_date: (document.getElementById('deDate') || {}).value,
      kind: (document.getElementById('deKind') || {}).value,
      label: (document.getElementById('deLabel') || {}).value,
      quantity: (document.getElementById('deQty') || {}).value,
      unit_amount: (document.getElementById('deUnit') || {}).value,
      currency: (document.getElementById('deCur') || {}).value,
      note: (document.getElementById('deNote') || {}).value,
    };
    if (!parseFloat(f.quantity) || !parseFloat(f.unit_amount)) {
      toast(t('fe.de.invalidAmount'), 'err'); return;
    }
    gas('earningCreate', [f]).then(function (r) {
      if (r && r.ok) {
        toast(t('fe.de.saved'), 'ok');
        // Űrlap tisztítás (label + qty visszaáll 1-re + unit üres)
        var lab = document.getElementById('deLabel'); if (lab) lab.value = '';
        var qty = document.getElementById('deQty'); if (qty) qty.value = '1';
        var uni = document.getElementById('deUnit'); if (uni) uni.value = '';
        var note = document.getElementById('deNote'); if (note) note.value = '';
        dcLoad();
      } else toast((r && r.err) || t('common.error'), 'err');
    });
  }

  function _dcEarningListHtml(items) {
    if (!items.length) {
      return '<div class="text-muted" style="padding:14px;text-align:center;">' + t('fe.de.empty') + '</div>';
    }
    var rows = items.map(function (it) {
      // Kind-cimke: egyéni típusnál a saját label_ro/hu, beépítettnél az i18n kulcs
      var kindLabel;
      var kindKey = it.kind || 'other';
      if (_dcBuiltinKinds.indexOf(kindKey) >= 0) {
        kindLabel = t('fe.de.kind.' + kindKey);
      } else {
        var found = _dcCustomKinds.find(function (r) { return r.key === kindKey; });
        var lang = (window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'ro';
        kindLabel = found ? ((lang === 'hu' && found.label_hu) ? found.label_hu : (found.label_ro || kindKey)) : kindKey;
      }
      var pillClass = _dcBuiltinKinds.indexOf(kindKey) >= 0 ? kindKey : 'other';
      var amount = Number(it.total_amount) || 0;
      var cur = it.currency || 'RON';
      return '<tr>'
        + '<td>' + d2(it.earning_date) + '</td>'
        + '<td><span class="dc-kind-pill dc-kind-' + esc(pillClass) + '">'
        +   esc(kindLabel) + '</span></td>'
        + '<td>' + esc(it.label || '—') + '</td>'
        + '<td style="text-align:right;">' + n2(it.quantity, 2) + ' × ' + n2(it.unit_amount, 2) + '</td>'
        + '<td style="text-align:right;font-weight:700;">' + n2(amount, 2)
        +   ' <span class="dc-tile-cur">' + esc(cur) + '</span></td>'
        + '<td style="text-align:right;white-space:nowrap;">'
        +   '<button class="btn ok" style="padding:3px 9px;font-size:12px;margin-right:4px;" '
        +     'title="' + t('fe.pm.payRow') + '" '
        +     'onclick="FleetExtra.dcPayRow(' + it.id + ',' + amount + ',\'' + esc(cur) + '\')">💰</button>'
        +   '<button class="btn danger" style="padding:3px 9px;font-size:12px;" '
        +     'onclick="FleetExtra.dcEarnDelete(' + it.id + ')">✕</button></td>'
        + '</tr>';
    }).join('');
    return '<div class="dc-table-wrap"><table class="table dc-list-table">'
      + '<thead><tr>'
      + '<th>' + t('fe.de.colDate') + '</th>'
      + '<th>' + t('fe.de.colKind') + '</th>'
      + '<th>' + t('fe.de.colLabel') + '</th>'
      + '<th style="text-align:right;">' + t('fe.de.colCalc') + '</th>'
      + '<th style="text-align:right;">' + t('fe.de.colTotal') + '</th>'
      + '<th></th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function _dcPaymentListHtml(items) {
    if (!items.length) {
      return '<div class="text-muted" style="padding:14px;text-align:center;">' + t('fe.pm.empty') + '</div>';
    }
    var rows = items.map(function (it) {
      var methodPill = '<span class="dc-method dc-method-' + esc(it.method || 'cash') + '">'
        + esc(t('fe.pm.method.' + (it.method || 'cash'))) + '</span>';
      var bnrCell = it.bnr_rate != null
        ? '<span class="text-muted" style="font-size:12px;">1 EUR = ' + n2(it.bnr_rate, 4) + '</span>'
        : '<span class="text-muted" style="font-size:12px;">—</span>';
      var ronCell = it.amount_ron != null
        ? '<span class="text-muted" style="font-size:12px;">= ' + n2(it.amount_ron, 2) + ' RON</span>'
        : '';
      return '<tr>'
        + '<td>' + d2(it.paid_at) + '</td>'
        + '<td>' + methodPill + '</td>'
        + '<td style="text-align:right;font-weight:700;">' + n2(it.amount, 2)
        +   ' <span class="dc-tile-cur">' + esc(it.currency || 'RON') + '</span></td>'
        + '<td>' + bnrCell + ' ' + ronCell + '</td>'
        + '<td>' + esc(it.note || '') + '</td>'
        + '<td style="text-align:right;">'
        +   '<button class="btn danger" style="padding:3px 9px;font-size:12px;" '
        +     'onclick="FleetExtra.dcPayDelete(' + it.id + ')">✕</button></td>'
        + '</tr>';
    }).join('');
    return '<div class="dc-table-wrap"><table class="table dc-list-table">'
      + '<thead><tr>'
      + '<th>' + t('fe.pm.colDate') + '</th>'
      + '<th>' + t('fe.pm.colMethod') + '</th>'
      + '<th style="text-align:right;">' + t('fe.pm.colAmount') + '</th>'
      + '<th>' + t('fe.pm.colRate') + '</th>'
      + '<th>' + t('fld.note') + '</th>'
      + '<th></th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function dcEarnDelete(id) {
    if (!confirm(t('fe.de.delConfirm'))) return;
    gas('earningDelete', [{ id: id }]).then(function (r) {
      if (r && r.ok) { toast(t('common.deleted'), 'ok'); dcLoad(); }
      else toast((r && r.err) || t('common.error'), 'err');
    });
  }
  function dcPayDelete(id) {
    if (!confirm(t('fe.pm.delConfirm'))) return;
    gas('paymentDelete', [{ id: id }]).then(function (r) {
      if (r && r.ok) { toast(t('common.deleted'), 'ok'); dcLoad(); }
      else toast((r && r.err) || t('common.error'), 'err');
    });
  }

  // ── Sor-szintű gyors kifizetés: a járandóság-tétel összegével + valutájával ──
  // Ugyanazt a `dcOpenPayment` modált nyitjuk (partial módban), majd az összeg +
  // valuta mezőt az adott tétel értékére állítjuk. A note-ba is előtöltjük a
  // sor címkéjét, hogy vissza lehessen keresni, MELYIK járandóságra ment ki.
  function dcPayRow(earningId, amount, currency) {
    if (!_dcCurrent || !_dcCurrent.email) { toast(t('fe.dc.pickDriver'), 'err'); return; }
    if (!_dcBalance) { toast(t('fe.dc.loadFirst'), 'err'); return; }
    dcOpenPayment('partial');
    // A modal DOM-mezői ekkor már léteznek
    setTimeout(function () {
      var amt = document.getElementById('dcPayAmount');
      var cur = document.getElementById('dcPayCur');
      var note = document.getElementById('dcPayNote');
      if (amt) { amt.value = String(amount); }
      if (cur) { cur.value = currency || 'RON'; cur.dataset.userSet = '1'; }
      if (note && !note.value) { note.value = t('fe.pm.rowNotePrefix') + ' #' + earningId; }
      dcPayRecalc();
    }, 0);
  }

  // ── Egyéni járandóság-típusok kezelője (modal: lista + új-form) ──
  function _dcEnsureKindModal() {
    if (document.getElementById('dcKindModal')) return;
    var m = document.createElement('div');
    m.id = 'dcKindModal';
    m.className = 'modal-back';
    m.setAttribute('role', 'dialog');
    m.innerHTML =
      '<div class="modal glass dc-kind-modal">'
      +   '<div class="dc-pay-head">'
      +     '<h3 class="text-primary" style="margin:0;font-size:18px;">⚙️ '
      +       t('fe.dk.title') + '</h3>'
      +     '<button class="btn ghost" style="padding:4px 10px;" '
      +       'onclick="FleetExtra.dcKindClose()">✕</button>'
      +   '</div>'
      +   '<div id="dcKindBody"></div>'
      + '</div>';
    m.addEventListener('click', function (ev) { if (ev.target === m) dcKindClose(); });
    document.body.appendChild(m);
  }
  function dcKindClose() {
    var m = document.getElementById('dcKindModal');
    if (m) m.classList.remove('open');
  }
  // Modal megnyitása — friss lista + új-forma
  function dcKindManage() {
    _dcEnsureKindModal();
    _dcLoadKinds().then(_dcRenderKindModal);
    var m = document.getElementById('dcKindModal');
    if (m) m.classList.add('open');
  }
  function _dcRenderKindModal() {
    var b = document.getElementById('dcKindBody');
    if (!b) return;
    var lang = (window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'ro';
    // Beépített 7 (törölhetetlen) — csak megjelenítés
    var builtinRows = _dcBuiltinKinds.map(function (k) {
      return '<tr>'
        + '<td><span class="dc-kind-pill dc-kind-' + esc(k) + '">' + esc(t('fe.de.kind.' + k)) + '</span></td>'
        + '<td class="text-muted" style="font-family:monospace;font-size:11px;">' + esc(k) + '</td>'
        + '<td class="text-muted" style="font-size:11px;">' + t('fe.dk.builtin') + '</td>'
        + '<td></td>'
        + '</tr>';
    }).join('');
    // Egyéni — 🗑 gombbal törölhető
    var customRows = _dcCustomKinds.length
      ? _dcCustomKinds.map(function (r) {
          var label = (lang === 'hu' && r.label_hu) ? r.label_hu : (r.label_ro || r.key);
          return '<tr>'
            + '<td><span class="dc-kind-pill dc-kind-other">' + esc(label) + '</span></td>'
            + '<td class="text-muted" style="font-family:monospace;font-size:11px;">' + esc(r.key) + '</td>'
            + '<td class="text-muted" style="font-size:11px;">' + t('fe.dk.custom') + '</td>'
            + '<td style="text-align:right;">'
            +   '<button class="btn danger" style="padding:3px 9px;font-size:12px;" '
            +     'onclick="FleetExtra.dcKindDelete(\'' + esc(r.key) + '\')">🗑</button>'
            + '</td></tr>';
        }).join('')
      : '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:12px;">'
        + t('fe.dk.noCustom') + '</td></tr>';

    b.innerHTML =
      '<div class="dc-kind-list-wrap">'
      +   '<table class="table dc-kind-list">'
      +     '<thead><tr>'
      +       '<th>' + t('fe.dk.colLabel') + '</th>'
      +       '<th>' + t('fe.dk.colKey') + '</th>'
      +       '<th>' + t('fe.dk.colSource') + '</th>'
      +       '<th></th>'
      +     '</tr></thead>'
      +     '<tbody>' + builtinRows + customRows + '</tbody>'
      +   '</table>'
      + '</div>'
      + '<div class="dc-kind-add-form">'
      +   '<h4 style="margin:14px 0 8px;font-size:14px;">' + t('fe.dk.addTitle') + '</h4>'
      +   '<div class="dc-kind-add-grid">'
      +     '<div class="field" style="margin:0;">'
      +       '<label>' + t('fe.dk.keyLbl') + '</label>'
      +       '<input class="input" id="dkKey" maxlength="30" placeholder="' + t('fe.dk.keyPh') + '">'
      +     '</div>'
      +     '<div class="field" style="margin:0;">'
      +       '<label>' + t('fe.dk.labelRoLbl') + '</label>'
      +       '<input class="input" id="dkLabelRo" maxlength="120" placeholder="' + t('fe.dk.labelRoPh') + '">'
      +     '</div>'
      +     '<div class="field" style="margin:0;">'
      +       '<label>' + t('fe.dk.labelHuLbl') + '</label>'
      +       '<input class="input" id="dkLabelHu" maxlength="120" placeholder="' + t('fe.dk.labelHuPh') + '">'
      +     '</div>'
      +     '<button class="btn ok" style="margin-top:22px;" onclick="FleetExtra.dcKindCreate()">💾 '
      +       t('fe.dk.saveBtn') + '</button>'
      +   '</div>'
      +   '<p class="text-muted" style="font-size:11px;margin:8px 0 0;">' + t('fe.dk.hint') + '</p>'
      + '</div>';
  }
  function dcKindCreate() {
    var key = ((document.getElementById('dkKey') || {}).value || '').toLowerCase().trim();
    var labelRo = ((document.getElementById('dkLabelRo') || {}).value || '').trim();
    var labelHu = ((document.getElementById('dkLabelHu') || {}).value || '').trim();
    if (key.length < 2) { toast(t('fe.dk.errKey'), 'err'); return; }
    if (!labelRo) { toast(t('fe.dk.errRo'), 'err'); return; }
    gas('earningKindCreate', [{ key: key, label_ro: labelRo, label_hu: labelHu }]).then(function (r) {
      if (r && r.ok) {
        toast(t('common.saved'), 'ok');
        _dcLoadKinds().then(function () {
          _dcRenderKindModal();
          // A járandóság-form kind-selectjét is frissítjük az új típussal
          var sel = document.getElementById('deKind');
          if (sel) {
            var prev = sel.value;
            sel.innerHTML = _dcKindOptions(prev);
          }
        });
      } else toast((r && r.err) || t('common.error'), 'err');
    });
  }
  function dcKindDelete(key) {
    if (!confirm(t('fe.dk.delConfirm'))) return;
    gas('earningKindDelete', [{ key: key }]).then(function (r) {
      if (r && r.ok) {
        toast(t('common.deleted'), 'ok');
        _dcLoadKinds().then(function () {
          _dcRenderKindModal();
          var sel = document.getElementById('deKind');
          if (sel) {
            var prev = sel.value;
            sel.innerHTML = _dcKindOptions(prev === key ? 'bonus' : prev);
          }
        });
      } else toast((r && r.err) || t('common.error'), 'err');
    });
  }

  // ── Kifizetés-modal (részleges/teljes; EUR/RON toggle, BNR-előnézet) ──
  function _dcEnsurePayModal() {
    if (document.getElementById('dcPayModal')) return;
    var m = document.createElement('div');
    m.id = 'dcPayModal';
    m.className = 'modal-back';
    m.setAttribute('role', 'dialog');
    m.innerHTML =
      '<div class="modal glass dc-pay-modal">'
      +   '<div class="dc-pay-head">'
      +     '<h3 id="dcPayTitle" class="text-primary" style="margin:0;font-size:18px;">💵</h3>'
      +     '<button class="btn ghost" style="padding:4px 10px;" onclick="FleetExtra.dcClosePayment()">✕</button>'
      +   '</div>'
      +   '<div id="dcPayBody"></div>'
      + '</div>';
    m.addEventListener('click', function (ev) { if (ev.target === m) dcClosePayment(); });
    document.body.appendChild(m);
  }
  function dcClosePayment() {
    var m = document.getElementById('dcPayModal');
    if (m) m.classList.remove('open');
  }

  // mode: 'partial' | 'full'
  function dcOpenPayment(mode) {
    if (!_dcCurrent || !_dcCurrent.email) { toast(t('fe.dc.pickDriver'), 'err'); return; }
    if (!_dcBalance) { toast(t('fe.dc.loadFirst'), 'err'); return; }
    _dcEnsurePayModal();
    var m = document.getElementById('dcPayModal');
    var t_ = document.getElementById('dcPayTitle');
    var b = document.getElementById('dcPayBody');
    var bal = _dcBalance.balance || {};
    var bnr = _dcBalance.bnr_rate;

    // Default: EUR ha van hátralékos EUR, egyébként RON
    var defaultCur = (bal.eur || 0) > 0 ? 'EUR' : 'RON';
    var defaultAmount = 0;
    if (mode === 'full') {
      defaultAmount = defaultCur === 'EUR' ? (bal.eur || 0) : (bal.ron || 0);
      if (defaultAmount < 0) defaultAmount = 0;
    }

    t_.textContent = (mode === 'full' ? '✅ ' : '💵 ')
      + t(mode === 'full' ? 'fe.pm.modalFull' : 'fe.pm.modalPartial')
      + ' — ' + (_dcCurrent.nume || _dcCurrent.email);

    b.innerHTML =
      '<div class="dc-pay-balance">'
      +   '<div class="dc-pay-bal-line"><span>' + t('fe.dc.balEur') + ':</span> '
      +     '<b class="' + ((bal.eur || 0) > 0 ? 'dc-warn' : '') + '">'
      +     n2(bal.eur || 0, 2) + ' EUR</b></div>'
      +   '<div class="dc-pay-bal-line"><span>' + t('fe.dc.balRon') + ':</span> '
      +     '<b class="' + ((bal.ron || 0) > 0 ? 'dc-warn' : '') + '">'
      +     n2(bal.ron || 0, 2) + ' RON</b></div>'
      + '</div>'
      + '<div class="dc-pay-form">'
      +   '<div class="field" style="margin:0;"><label>' + t('fe.pm.paidAt') + '</label>'
      +     '<input class="input" id="dcPayDate" type="date" value="' + today() + '"></div>'
      +   '<div class="field" style="margin:0;"><label>' + t('fe.pm.currencyLbl') + '</label>'
      +     '<select class="select" id="dcPayCur" onchange="FleetExtra.dcPayCurChange()">'
      +       '<option value="RON"' + (defaultCur === 'RON' ? ' selected' : '') + '>RON</option>'
      +       '<option value="EUR"' + (defaultCur === 'EUR' ? ' selected' : '') + '>EUR</option>'
      +     '</select></div>'
      +   '<div class="field" style="margin:0;"><label>' + t('fe.pm.amount') + '</label>'
      +     '<input class="input" id="dcPayAmount" type="number" min="0.01" step="0.01" '
      +       'value="' + (defaultAmount > 0 ? n2(defaultAmount, 2).replace(/[^\d.,-]/g,'').replace(',', '.') : '') + '" '
      +       'oninput="FleetExtra.dcPayRecalc()"></div>'
      +   '<div class="field" style="margin:0;"><label>' + t('fe.pm.methodLbl') + '</label>'
      +     '<select class="select" id="dcPayMethod">'
      +       '<option value="cash">' + esc(t('fe.pm.method.cash')) + '</option>'
      +       '<option value="bank">' + esc(t('fe.pm.method.bank')) + '</option>'
      +       '<option value="card">' + esc(t('fe.pm.method.card')) + '</option>'
      +       '<option value="other">' + esc(t('fe.pm.method.other')) + '</option>'
      +     '</select></div>'
      +   '<div class="field" style="margin:0;grid-column:1/-1;"><label>' + t('fld.note') + '</label>'
      +     '<input class="input" id="dcPayNote" placeholder="' + t('fe.pm.notePh') + '"></div>'
      + '</div>'
      + '<div class="dc-pay-bnr">'
      +   '<div>🏦 <b>' + t('fe.dc.bnrToday') + ':</b> '
      +     (bnr != null
          ? '<span class="dc-bnr-val">1 EUR = ' + n2(bnr, 4) + ' RON</span>'
          : '<span class="text-muted">' + t('fe.dc.bnrNa') + '</span>')
      +   '</div>'
      +   '<div class="dc-pay-preview" id="dcPayPreview"></div>'
      + '</div>'
      + '<div class="dc-pay-foot">'
      +   '<button class="btn ghost" onclick="FleetExtra.dcClosePayment()">' + t('common.cancel') + '</button>'
      +   '<button class="btn ok" onclick="FleetExtra.dcPaySubmit()">✅ ' + t('fe.pm.saveBtn') + '</button>'
      + '</div>';

    m.classList.add('open');
    dcPayRecalc();
  }

  function dcPayCurChange() {
    // Ha a felhasználó valutát vált, az összeget nem írjuk felül (a szokás EUR→RON navigáció ellen)
    dcPayRecalc();
  }

  function dcPayRecalc() {
    var amount = parseFloat((document.getElementById('dcPayAmount') || {}).value) || 0;
    var cur = (document.getElementById('dcPayCur') || {}).value || 'RON';
    var bnr = _dcBnr;
    var el = document.getElementById('dcPayPreview');
    if (!el) return;
    if (!amount) { el.innerHTML = ''; return; }
    if (cur === 'EUR' && bnr) {
      el.innerHTML = '≈ <b>' + n2(amount * bnr, 2) + ' RON</b> '
        + '<span class="text-muted" style="font-size:12px;">(' + t('fe.pm.previewNote') + ')</span>';
    } else if (cur === 'RON' && bnr) {
      el.innerHTML = '≈ <b>' + n2(amount / bnr, 2) + ' EUR</b> '
        + '<span class="text-muted" style="font-size:12px;">(' + t('fe.pm.previewNote') + ')</span>';
    } else {
      el.innerHTML = '';
    }
  }

  function dcPaySubmit() {
    if (!_dcCurrent || !_dcCurrent.email) { toast(t('fe.dc.pickDriver'), 'err'); return; }
    var f = {
      email_sofer: _dcCurrent.email,
      paid_at: (document.getElementById('dcPayDate') || {}).value,
      amount: (document.getElementById('dcPayAmount') || {}).value,
      currency: (document.getElementById('dcPayCur') || {}).value,
      method: (document.getElementById('dcPayMethod') || {}).value,
      note: (document.getElementById('dcPayNote') || {}).value,
    };
    if (!parseFloat(f.amount) || parseFloat(f.amount) <= 0) {
      toast(t('fe.pm.invalidAmount'), 'err'); return;
    }
    gas('paymentCreate', [f]).then(function (r) {
      if (r && r.ok) {
        toast(t('fe.pm.saved'), 'ok');
        dcClosePayment();
        dcLoad();
      } else toast((r && r.err) || t('common.error'), 'err');
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
        // ⛽ Interaktív KPI mutató-sáv — a már lekért lst.total összegekből (nincs új hálózati hívás)
        var fuelBand = '';
        if (typeof vsMetricBand === 'function') {
          fuelBand = '<div style="margin-bottom:18px;">' + vsMetricBand([
            { l: t('fe.fc.kpiCount'), v: n2(tot.db, 0),    sub: t('fe.fc.kpiCountSub') },
            { l: t('fe.fc.colLiter'), v: n2(tot.litru, 0) + ' L',   sub: t('fe.fc.kpiLiterSub') },
            { l: t('fe.fc.kpiCost'),  v: n2(tot.suma, 0) + ' RON',  sub: t('fe.fc.kpiCostSub') }
          ]) + '</div>';
        }
        listBox.innerHTML = fuelBand + panel(t('fe.fc.listTitle', { db: n2(tot.db, 0), l: n2(tot.litru, 0), ron: n2(tot.suma, 0) }),
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

  // ── Vezérlőpult szerviz-esedékesség kártya (loadDashboard hívja) ──
  // Az élő GPS km-órát (gps_mileage_log) veti össze a szerviz „köv. esedékes”
  // km-jével, illetve a dátum-alapú esedékességgel. Csak megjelenítés.
  function renderDashServiceAlert() {
    var box = document.getElementById('dashServiceAlert');
    if (!box) return;
    gas('getServiceDueAlerts').then(function (r) {
      if (!r || !r.ok || !(r.items || []).length) { box.innerHTML = ''; return; }
      // A modalnak (svOpenPostpone/Complete) forrás — a lista teljes tartalma,
      // hogy a szerviz-napló betöltése nélkül is elérje.
      window._svAlertCache = r.items;
      var over = r.items.filter(function (i) { return (i.km_left != null && i.km_left < 0) || (i.days_left != null && i.days_left < 0); });
      // Minden érintett jármű egy KATTINTHATÓ chip: rákattintva a szerviz-modal
      // nyílik erre a konkrét szervizre (Halasztás vagy Elvégezve).
      var rows = r.items.slice(0, 6).map(function (i) {
        var txt, col;
        if (i.km_left != null) {
          if (i.km_left < 0) { txt = t('fe.dash.kmOver', { n: Math.abs(i.km_left).toLocaleString('hu-HU') }); col = 'var(--status-danger)'; }
          else { txt = t('fe.dash.kmLeft', { n: i.km_left.toLocaleString('hu-HU') }); col = 'var(--status-warn)'; }
        } else if (i.days_left < 0) { txt = t('fe.dash.expired'); col = 'var(--status-danger)'; }
        else { txt = t('fe.dash.days', { n: i.days_left }); col = 'var(--status-warn)'; }
        return '<span class="sv-chip" title="' + esc(t('fe.dash.chipTip')) + '" '
          + 'style="white-space:nowrap;font-size:12px;padding:4px 8px;border-radius:8px;'
          + 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);cursor:pointer;" '
          + 'onclick="event.stopPropagation();FleetExtra.svOpenDecide(' + i.id + ')">'
          + '🔧 <b>' + esc(i.rendszam || '') + '</b> '
          + '<span style="color:' + col + ';font-weight:700;">' + txt + '</span></span>';
      }).join(' ');
      box.innerHTML = '<div class="glass" style="padding:12px 16px;margin-bottom:16px;border:1px solid '
        + (over.length ? 'rgba(239,68,68,0.4)' : 'rgba(245,158,11,0.4)') + ';display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
        + '<span style="font-size:18px;cursor:pointer;" onclick="activateTab(\'service-log\')">🔧</span>'
        + '<b class="text-primary" style="font-size:13px;cursor:pointer;" onclick="activateTab(\'service-log\')">'
        + t('fe.dash.serviceDue', { n: r.items.length }) + ':</b> ' + rows
        + ' <span class="text-muted" style="font-size:12px;margin-left:auto;cursor:pointer;" onclick="activateTab(\'service-log\')">'
        + t('fe.dash.toService') + '</span></div>';
    }).catch(function () { box.innerHTML = ''; });
  }

  // ════════════════════════════════════════════════════════
  //  📄 HAVI ELSZÁMOLÁS-LAP (settlement sheet)
  //  Egy oldalas nyomtatható/e-mailhető összesítő az adott
  //  hónapra: járandóság-tételek + kifizetések + hátralék +
  //  aláíró blokk. A böngésző Nyomtatás → PDF-be mentése (Ctrl+P)
  //  ad valódi PDF-et — nem kell puppeteer/pdf-lib. Az e-mail
  //  ezzel az azonos HTML-lel megy a KÖZÖS VallorSoft feladóról.
  // ════════════════════════════════════════════════════════
  var _dcSheet = null; // legutóbbi getMonthlySettlementSheet válasz
  var _MONTHS_RO = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'];
  var _MONTHS_HU = ['Január','Február','Március','Április','Május','Június','Július','Augusztus','Szeptember','Október','November','December'];

  function _dcMonthLabel(y, m) {
    var lang = (window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'ro';
    var arr = (lang === 'hu') ? _MONTHS_HU : _MONTHS_RO;
    return arr[m - 1] + ' ' + y;
  }

  // Modal-váz (egyszer létrehozva)
  function _dcEnsureSheetModal() {
    if (document.getElementById('dcSheetModal')) return;
    var m = document.createElement('div');
    m.id = 'dcSheetModal';
    m.className = 'modal-back';
    m.setAttribute('role', 'dialog');
    m.innerHTML =
      '<div class="modal glass dc-sheet-modal">'
      +   '<div class="dc-sheet-toolbar">'
      +     '<div class="dc-sheet-picker">'
      +       '<div class="dc-sheet-presets">'
      +         '<button type="button" class="btn ghost dc-preset" data-preset="thisMonth" onclick="FleetExtra.dcSheetPreset(\'thisMonth\')">' + t('fe.st.pThisMonth') + '</button>'
      +         '<button type="button" class="btn ghost dc-preset" data-preset="lastMonth" onclick="FleetExtra.dcSheetPreset(\'lastMonth\')">' + t('fe.st.pLastMonth') + '</button>'
      +         '<button type="button" class="btn ghost dc-preset" data-preset="quarter"   onclick="FleetExtra.dcSheetPreset(\'quarter\')">'   + t('fe.st.pQuarter')   + '</button>'
      +         '<button type="button" class="btn ghost dc-preset" data-preset="ytd"       onclick="FleetExtra.dcSheetPreset(\'ytd\')">'       + t('fe.st.pYtd')       + '</button>'
      +         '<button type="button" class="btn ghost dc-preset" data-preset="year"      onclick="FleetExtra.dcSheetPreset(\'year\')">'      + t('fe.st.pYear')      + '</button>'
      +       '</div>'
      +       '<div class="dc-sheet-range">'
      +         '<label>' + t('fe.st.from') + '</label>'
      +         '<input class="input" type="date" id="dcStFrom" onchange="FleetExtra.dcSheetReload()">'
      +         '<label>' + t('fe.st.to') + '</label>'
      +         '<input class="input" type="date" id="dcStTo"   onchange="FleetExtra.dcSheetReload()">'
      +       '</div>'
      +     '</div>'
      +     '<div class="dc-sheet-actions">'
      +       '<button class="btn ok" onclick="FleetExtra.dcSheetPrint()">🖨️ ' + t('fe.st.print') + '</button>'
      +       '<button class="btn primary" onclick="FleetExtra.dcSheetEmail()">✉️ ' + t('fe.st.email') + '</button>'
      +       '<button class="btn ghost" onclick="FleetExtra.dcSheetClose()">✕</button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="dc-sheet-body" id="dcSheetBody"></div>'
      + '</div>';
    m.addEventListener('click', function (ev) { if (ev.target === m) dcSheetClose(); });
    document.body.appendChild(m);
  }
  function dcSheetClose() {
    var m = document.getElementById('dcSheetModal');
    if (m) m.classList.remove('open');
  }
  // ISO YYYY-MM-DD formázó UTC-alapon (a date input `value` mezője ilyet vár)
  function _dcIsoDate(d) {
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  // Preset → { from, to } (mai naphoz viszonyítva, mindig UTC-alapon)
  function _dcPresetRange(key) {
    var now = new Date();
    var Y = now.getUTCFullYear(), M = now.getUTCMonth();
    if (key === 'thisMonth') {
      var f = new Date(Date.UTC(Y, M, 1));
      var l = new Date(Date.UTC(Y, M + 1, 0));
      return { from: _dcIsoDate(f), to: _dcIsoDate(l) };
    }
    if (key === 'lastMonth') {
      var f2 = new Date(Date.UTC(Y, M - 1, 1));
      var l2 = new Date(Date.UTC(Y, M, 0));
      return { from: _dcIsoDate(f2), to: _dcIsoDate(l2) };
    }
    if (key === 'quarter') {
      var qStart = Math.floor(M / 3) * 3;
      var f3 = new Date(Date.UTC(Y, qStart, 1));
      var l3 = new Date(Date.UTC(Y, qStart + 3, 0));
      return { from: _dcIsoDate(f3), to: _dcIsoDate(l3) };
    }
    if (key === 'ytd') {
      var f4 = new Date(Date.UTC(Y, 0, 1));
      return { from: _dcIsoDate(f4), to: _dcIsoDate(now) };
    }
    if (key === 'year') {
      // Az elmúlt 12 hónap (naptári év = jan.01–dec.31 helyett rolling 12M)
      var f5 = new Date(Date.UTC(Y - 1, M + 1, 1));
      var l5 = new Date(Date.UTC(Y, M + 1, 0));
      return { from: _dcIsoDate(f5), to: _dcIsoDate(l5) };
    }
    return null;
  }
  function dcSheetPreset(key) {
    var r = _dcPresetRange(key);
    if (!r) return;
    var fEl = document.getElementById('dcStFrom');
    var tEl = document.getElementById('dcStTo');
    if (fEl) fEl.value = r.from;
    if (tEl) tEl.value = r.to;
    // Aktív preset vizuális jelzés
    var all = document.querySelectorAll('#dcSheetModal .dc-preset');
    for (var i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i].dataset.preset === key);
    dcSheetReload();
  }
  function dcOpenSettlement() {
    if (!_dcCurrent || !_dcCurrent.email) { toast(t('fe.dc.pickDriver'), 'err'); return; }
    _dcEnsureSheetModal();
    var m = document.getElementById('dcSheetModal');
    // Alapérték: e havi időszak (elmúlt "hónap" preset a leggyakoribb, de a
    // MAI hónap jó default: a diszpécser gyakran menet közben nézi az aktuális
    // állást). Csak egyszer előtöltjük — ha a felhasználó módosít, marad.
    var fEl = document.getElementById('dcStFrom');
    var tEl = document.getElementById('dcStTo');
    if (fEl && !fEl.value) {
      var r0 = _dcPresetRange('thisMonth');
      fEl.value = r0.from;
      if (tEl) tEl.value = r0.to;
      var thisBtn = document.querySelector('#dcSheetModal .dc-preset[data-preset="thisMonth"]');
      if (thisBtn) thisBtn.classList.add('active');
    }
    m.classList.add('open');
    dcSheetReload();
  }
  function dcSheetReload() {
    if (!_dcCurrent || !_dcCurrent.email) return;
    var from = (document.getElementById('dcStFrom') || {}).value;
    var to   = (document.getElementById('dcStTo')   || {}).value;
    var body = document.getElementById('dcSheetBody');
    if (!body) return;
    if (!from || !to) { body.innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.st.pickPeriod') + '</div>'; return; }
    // A kézi input módosítást a preset-jelzés kikapcsolja (ne látszódjon aktív preset,
    // ami már nem igaz)
    var all = document.querySelectorAll('#dcSheetModal .dc-preset.active');
    // (a `dcSheetPreset` kezeli az aktiválást; itt csak a kézi módosításra reagálunk)
    if (all.length && !all[0].dataset._justSet) {
      for (var i = 0; i < all.length; i++) {
        var p = all[i].dataset.preset;
        var pr = _dcPresetRange(p);
        if (!pr || pr.from !== from || pr.to !== to) all[i].classList.remove('active');
      }
    }
    body.innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.loading') + '</div>';
    gas('getMonthlySettlementSheet', [{ email: _dcCurrent.email, from: from, to: to }]).then(function (r) {
      if (!r || !r.ok) { body.innerHTML = '<div class="text-muted" style="padding:20px;text-align:center;">' + esc((r && r.err) || t('common.error')) + '</div>'; return; }
      _dcSheet = r;
      body.innerHTML = _dcRenderSheetHtml(r);
    });
  }

  // A NYOMTATHATÓ HTML — ugyanaz megy a browser print-jébe és az e-mailbe.
  // Table-alapú (e-mail-biztos), inline stílusokkal (a Gmail/Outlook is elviszi).
  function _dcRenderSheetHtml(r) {
    var d = r.driver, p = r.period, c = r.company, tot = r.totals || {};
    // Az időszak-cimke: ha pontosan egy naptári hónap (a szerver kitölti a
    // year+month-ot ilyenkor is), hónapnév-évet mutatunk; egyébként a napi
    // formátumú intervallumot (`2026-01-01 → 2026-12-31`).
    var isSingleMonth = (p.year && p.month);
    var monthLbl = isSingleMonth ? _dcMonthLabel(p.year, p.month) : (d2(p.from) + ' → ' + d2(p.to));
    var lang = (window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'ro';

    // Járandóság-sorok
    var eRows = (r.earnings || []).map(function (it) {
      var kindKey = it.kind || 'other';
      var kindLbl;
      if (_dcBuiltinKinds.indexOf(kindKey) >= 0) kindLbl = t('fe.de.kind.' + kindKey);
      else {
        var f = _dcCustomKinds.find(function (k) { return k.key === kindKey; });
        kindLbl = f ? ((lang === 'hu' && f.label_hu) ? f.label_hu : (f.label_ro || kindKey)) : kindKey;
      }
      return '<tr>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">' + d2(it.earning_date) + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">' + esc(kindLbl) + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">' + esc(it.label || '—') + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">' + n2(it.quantity, 2) + ' × ' + n2(it.unit_amount, 2) + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">'
        +   n2(it.total_amount, 2) + ' ' + esc(it.currency || 'RON') + '</td>'
        + '</tr>';
    }).join('') || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#6b7280;font-style:italic;">' + t('fe.de.empty') + '</td></tr>';

    // Kifizetés-sorok
    var pRows = (r.payments || []).map(function (it) {
      return '<tr>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">' + d2(it.paid_at) + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">' + esc(t('fe.pm.method.' + (it.method || 'cash'))) + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">'
        +   n2(it.amount, 2) + ' ' + esc(it.currency || 'RON') + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;color:#6b7280;font-size:11px;">'
        +   (it.bnr_rate != null ? '1 EUR = ' + n2(it.bnr_rate, 4) : '—') + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;color:#6b7280;font-size:11px;">'
        +   (it.amount_ron != null ? '= ' + n2(it.amount_ron, 2) + ' RON' : '') + '</td>'
        + '</tr>';
    }).join('') || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#6b7280;font-style:italic;">' + t('fe.pm.empty') + '</td></tr>';

    // Cég-fejléc sor (adresa/CUI/tel opcionális)
    var compMeta = [];
    if (c.cui) compMeta.push('CUI: ' + esc(c.cui));
    if (c.telefon) compMeta.push('Tel: ' + esc(c.telefon));
    if (c.email_contact) compMeta.push(esc(c.email_contact));
    var compMetaLine = compMeta.length ? '<div style="font-size:11px;color:#6b7280;margin-top:2px;">' + compMeta.join(' · ') + '</div>' : '';
    var compAdresa = c.adresa ? '<div style="font-size:11px;color:#6b7280;">' + esc(c.adresa) + '</div>' : '';

    var totE = tot.earned || {}, totP = tot.paid || {}, totB = tot.balance || {};
    var bnr = tot.bnr_rate;

    // Hivatalos fejléc: logó (bal) + cég-adatok (közép) + dokumentum-badge (jobb)
    // Alatta 2px sötét vonal — hogy hivatalos legyen. A logó cell-je csak ha van
    // feltöltött logó (`c.logo_data_uri` a szerver-oldali `company_branding`-ből).
    var logoCell = c.logo_data_uri
      ? '<td style="vertical-align:middle;width:96px;padding-right:16px;">'
        + '<img src="' + esc(c.logo_data_uri) + '" alt="" '
        +   'style="max-width:88px;max-height:80px;display:block;">'
        + '</td>'
      : '';
    return '<div class="dc-sheet-doc">'
      // FIX HIVATALOS FEJLÉC (logó + cég + doktípus-badge)
      + '<table style="width:100%;border-collapse:collapse;">'
      +   '<tr>'
      +     logoCell
      +     '<td style="vertical-align:middle;">'
      +       '<div style="font-size:20px;font-weight:800;color:#0f172a;letter-spacing:0.2px;">' + esc(c.nev || '') + '</div>'
      +       compAdresa + compMetaLine
      +     '</td>'
      +     '<td style="vertical-align:middle;text-align:right;width:230px;">'
      +       '<div style="display:inline-block;padding:9px 16px;background:linear-gradient(135deg,#2563eb,#1e40af);color:#fff;border-radius:8px;font-weight:800;font-size:14px;letter-spacing:0.3px;">'
      +         t(isSingleMonth ? 'fe.st.title' : 'fe.st.titleRange')
      +       '</div>'
      +       '<div style="font-size:13px;color:#0f172a;font-weight:700;margin-top:6px;">' + esc(monthLbl) + '</div>'
      +       (isSingleMonth
        ? '<div style="font-size:11px;color:#6b7280;margin-top:2px;">' + t('fe.st.period') + ': ' + d2(p.from) + ' → ' + d2(p.to) + '</div>'
        : '')
      +     '</td>'
      +   '</tr>'
      + '</table>'
      // Elválasztó vonal a fejléc alatt (hivatalos kinézet)
      + '<div style="height:0;border-top:2px solid #0f172a;margin:12px 0 16px;"></div>'
      // Sofőr adatok
      + '<div style="padding:10px 14px;background:#f8fafc;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:14px;">'
      +   '<div style="font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:0.4px;">' + t('fe.st.driver') + '</div>'
      +   '<div style="font-size:15px;font-weight:700;color:#0f172a;">' + esc(d.nume) + '</div>'
      +   '<div style="font-size:11px;color:#6b7280;">' + esc(d.email) + (d.tel ? ' · ' + esc(d.tel) : '') + '</div>'
      + '</div>'
      // Járandóság-tábla
      + '<div style="font-size:14px;font-weight:700;color:#0f172a;margin:12px 0 6px;">📥 ' + t('fe.st.earningsTitle') + ' (' + (r.earnings || []).length + ')</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:12px;">'
      +   '<thead><tr style="background:#e0e7ff;color:#1e293b;">'
      +     '<th style="padding:6px 8px;text-align:left;">' + t('fe.de.colDate') + '</th>'
      +     '<th style="padding:6px 8px;text-align:left;">' + t('fe.de.colKind') + '</th>'
      +     '<th style="padding:6px 8px;text-align:left;">' + t('fe.de.colLabel') + '</th>'
      +     '<th style="padding:6px 8px;text-align:right;">' + t('fe.de.colCalc') + '</th>'
      +     '<th style="padding:6px 8px;text-align:right;">' + t('fe.de.colTotal') + '</th>'
      +   '</tr></thead>'
      +   '<tbody>' + eRows + '</tbody>'
      +   '<tfoot><tr style="background:#f1f5f9;font-weight:800;">'
      +     '<td colspan="4" style="padding:8px;text-align:right;">' + t('fe.st.totalEarned') + ':</td>'
      +     '<td style="padding:8px;text-align:right;">'
      +       n2(totE.eur || 0, 2) + ' EUR &nbsp; · &nbsp; ' + n2(totE.ron || 0, 2) + ' RON'
      +     '</td>'
      +   '</tr></tfoot>'
      + '</table>'
      // Kifizetés-tábla
      + '<div style="font-size:14px;font-weight:700;color:#0f172a;margin:16px 0 6px;">💸 ' + t('fe.st.paymentsTitle') + ' (' + (r.payments || []).length + ')</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:12px;">'
      +   '<thead><tr style="background:#d1fae5;color:#1e293b;">'
      +     '<th style="padding:6px 8px;text-align:left;">' + t('fe.pm.colDate') + '</th>'
      +     '<th style="padding:6px 8px;text-align:left;">' + t('fe.pm.colMethod') + '</th>'
      +     '<th style="padding:6px 8px;text-align:right;">' + t('fe.pm.colAmount') + '</th>'
      +     '<th style="padding:6px 8px;text-align:right;">' + t('fe.pm.colRate') + '</th>'
      +     '<th style="padding:6px 8px;text-align:right;">RON</th>'
      +   '</tr></thead>'
      +   '<tbody>' + pRows + '</tbody>'
      +   '<tfoot><tr style="background:#f1f5f9;font-weight:800;">'
      +     '<td colspan="4" style="padding:8px;text-align:right;">' + t('fe.st.totalPaid') + ':</td>'
      +     '<td style="padding:8px;text-align:right;">'
      +       n2(totP.eur || 0, 2) + ' EUR &nbsp; · &nbsp; ' + n2(totP.ron || 0, 2) + ' RON'
      +     '</td>'
      +   '</tr></tfoot>'
      + '</table>'
      // Egyenleg-kártya
      + '<div style="margin-top:18px;padding:14px 18px;border:2px solid #2563eb;border-radius:10px;background:#eff6ff;">'
      +   '<div style="font-size:13px;font-weight:700;color:#1e40af;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.4px;">'
      +     '⚖️ ' + t('fe.st.balance') + '</div>'
      +   '<table style="width:100%;border-collapse:collapse;font-size:14px;">'
      +     '<tr>'
      +       '<td style="padding:4px 0;">' + t('fe.dc.balEur') + ':</td>'
      +       '<td style="padding:4px 0;text-align:right;font-weight:800;color:' + ((totB.eur || 0) > 0 ? '#dc2626' : '#16a34a') + ';">'
      +         n2(totB.eur || 0, 2) + ' EUR</td>'
      +     '</tr>'
      +     '<tr>'
      +       '<td style="padding:4px 0;">' + t('fe.dc.balRon') + ':</td>'
      +       '<td style="padding:4px 0;text-align:right;font-weight:800;color:' + ((totB.ron || 0) > 0 ? '#dc2626' : '#16a34a') + ';">'
      +         n2(totB.ron || 0, 2) + ' RON</td>'
      +     '</tr>'
      +     (totB.ron_all != null && bnr != null
        ? '<tr><td style="padding:4px 0;border-top:1px dashed #93c5fd;color:#475569;font-size:12px;">'
          + t('fe.dc.balCombined') + ' <span style="color:#94a3b8;">(BNR 1 EUR = ' + n2(bnr, 4) + ')</span>:</td>'
          + '<td style="padding:4px 0;border-top:1px dashed #93c5fd;text-align:right;font-weight:800;color:#1e40af;font-size:15px;">'
          + n2(totB.ron_all, 2) + ' RON</td></tr>'
        : '')
      +   '</table>'
      + '</div>'
      // Aláíró blokk (cég-oldalon a pecsét ráégetve — ha van feltöltve)
      + '<table style="width:100%;border-collapse:collapse;margin-top:36px;">'
      +   '<tr>'
      +     '<td style="width:50%;vertical-align:top;padding-right:16px;height:110px;">'
      +       '<div style="height:70px;"></div>' // aláírás-hely (üres kép-tér)
      +       '<div style="border-top:1.5px solid #0f172a;padding-top:6px;font-size:11px;color:#475569;">' + t('fe.st.signDriver') + '</div>'
      +       '<div style="font-size:12px;color:#94a3b8;margin-top:2px;">' + esc(d.nume) + '</div>'
      +     '</td>'
      +     '<td style="width:50%;vertical-align:top;padding-left:16px;height:110px;position:relative;">'
      +       // Cég pecsét — a signature-vonal FÖLÖTT középen, ha van feltöltve;
      +       // ha nincs, üres tér marad (kézzel bepecsételhető nyomtatáskor).
      +       (c.stamp_data_uri
        ? '<div style="height:70px;text-align:center;">'
          + '<img src="' + esc(c.stamp_data_uri) + '" alt="" '
          + 'style="max-height:68px;max-width:120px;opacity:0.85;">'
          + '</div>'
        : '<div style="height:70px;"></div>')
      +       '<div style="border-top:1.5px solid #0f172a;padding-top:6px;font-size:11px;color:#475569;">' + t('fe.st.signCompany') + '</div>'
      +       '<div style="font-size:12px;color:#94a3b8;margin-top:2px;">' + esc(c.nev || '') + '</div>'
      +     '</td>'
      +   '</tr>'
      + '</table>'
      // Lábléc
      + '<div style="margin-top:24px;padding-top:8px;border-top:1px solid #e5e7eb;font-size:10px;color:#94a3b8;text-align:center;">'
      +   t('fe.st.footNote') + ' · VallorSoft'
      + '</div>'
      + '</div>';
  }

  // Nyomtatás: új ablakot nyit a lap-tartalommal (a modal keretei kimaradnak).
  // A böngésző Nyomtatás → Célhely: „Mentés PDF-be" adja a valódi PDF-et.
  function dcSheetPrint() {
    if (!_dcSheet) { toast(t('fe.st.loadFirst'), 'err'); return; }
    var doc = document.querySelector('#dcSheetBody .dc-sheet-doc');
    if (!doc) { toast(t('fe.st.loadFirst'), 'err'); return; }
    var w = window.open('', '_blank');
    if (!w) { toast(t('fe.st.popupBlocked'), 'err'); return; }
    var lang = (window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'ro';
    var title = t('fe.st.title') + ' — ' + (_dcSheet.driver.nume || '') + ' — ' + _dcMonthLabel(_dcSheet.period.year, _dcSheet.period.month);
    w.document.write(
      '<!doctype html><html lang="' + lang + '"><head><meta charset="utf-8"><title>' + esc(title) + '</title>'
      + '<style>body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#0f172a;background:#fff;}'
      + '@page{size:A4;margin:14mm;}'
      + '@media print{body{margin:0;}}'
      + '</style></head><body>' + doc.outerHTML + '</body></html>'
    );
    w.document.close();
    // A print-dialógus a kép betöltése után nyíljon (browser-tudatosan)
    setTimeout(function () { try { w.focus(); w.print(); } catch (_e) {} }, 200);
  }

  // E-mail: a sofőr saját (login) címére KÜLDJÜK a nyomtatható HTML-t
  // a KÖZÖS VallorSoft feladóról. A címzett szerkeszthető, alapérték a
  // sofőr `driver.email` — más címre a szerver elutasítja (cross-tenant védelem).
  function dcSheetEmail() {
    if (!_dcSheet) { toast(t('fe.st.loadFirst'), 'err'); return; }
    var doc = document.querySelector('#dcSheetBody .dc-sheet-doc');
    if (!doc) { toast(t('fe.st.loadFirst'), 'err'); return; }
    var toDefault = _dcSheet.driver.email || '';
    var to = window.prompt(t('fe.st.emailPrompt'), toDefault);
    if (!to) return;
    to = String(to).trim().toLowerCase();
    var subject = t('fe.st.emailSubject') + ' · ' + _dcMonthLabel(_dcSheet.period.year, _dcSheet.period.month) + ' · ' + _dcSheet.driver.nume;
    gas('sendSettlementSheetEmail', [{ to: to, subject: subject, html: doc.outerHTML }]).then(function (r) {
      if (r && r.ok) toast(t('fe.st.emailSent'), 'ok');
      else toast((r && r.err) || t('common.error'), 'err');
    });
  }

  // ════════════════════════════════════════════════════════
  //  📑 DECONT OFICIAL (hivatalos elszámolás)
  //  Kiegészítő nyomtatható dokumentum a Decont lunar mellett.
  //  A jelenlegi Decont lunar UI/számítás/gomb VÁLTOZATLAN marad.
  //  Adatforrás: ugyanaz a `getMonthlySettlementSheet` (járandóság-
  //  tételek + BNR + valuta-összegek), plus szerkeszthető nettó
  //  havi alapbér (per sofőr, alap 2700 RON — `users.net_base_salary_ron`).
  //  Számítás: total_ron = tot_eur × BNR + tot_ron;
  //            above_base_eur = (total_ron − base_salary_ron) / BNR
  // ════════════════════════════════════════════════════════
  var _dcOfSheet = null;      // legutóbbi getMonthlySettlementSheet válasz
  var _dcOfBaseSal = null;    // aktuálisan szerkesztett nettó alapbér (RON)
  var _dcOfBnrOverride = null; // ha a felhasználó kézzel írja be a BNR-t

  // Az utolsó kézi BNR-érték a böngészőben (per-cég) — ha a szerver BNR-t
  // sosem tud lekérni (proxy/WAF-block/időszakos hiba), a felhasználó ne
  // vakon írja be minden nyitáskor a mai árfolyamot; a legutóbbi általa
  // beírt érték előre kitöltésre kerül.
  function _dcOfLastManualBnr() {
    try {
      var v = localStorage.getItem('vs_dc_of_bnr_manual');
      var n = v != null ? parseFloat(v) : NaN;
      return (isFinite(n) && n > 0) ? n : null;
    } catch (_e) { return null; }
  }
  function _dcOfSaveManualBnr(v) {
    try {
      var n = parseFloat(v);
      if (isFinite(n) && n > 0) localStorage.setItem('vs_dc_of_bnr_manual', String(n));
    } catch (_e) {}
  }

  function _dcOfEnsureSheetModal() {
    if (document.getElementById('dcOfSheetModal')) return;
    var m = document.createElement('div');
    m.id = 'dcOfSheetModal';
    m.className = 'modal-back';
    m.setAttribute('role', 'dialog');
    m.innerHTML =
      '<div class="modal glass dc-sheet-modal">'
      +   '<div class="dc-sheet-toolbar">'
      +     '<div class="dc-sheet-picker">'
      +       '<div class="dc-sheet-presets">'
      +         '<button type="button" class="btn ghost dc-of-preset" data-preset="thisMonth" onclick="FleetExtra.dcOfSheetPreset(\'thisMonth\')">' + t('fe.st.pThisMonth') + '</button>'
      +         '<button type="button" class="btn ghost dc-of-preset" data-preset="lastMonth" onclick="FleetExtra.dcOfSheetPreset(\'lastMonth\')">' + t('fe.st.pLastMonth') + '</button>'
      +         '<button type="button" class="btn ghost dc-of-preset" data-preset="quarter"   onclick="FleetExtra.dcOfSheetPreset(\'quarter\')">'   + t('fe.st.pQuarter')   + '</button>'
      +         '<button type="button" class="btn ghost dc-of-preset" data-preset="ytd"       onclick="FleetExtra.dcOfSheetPreset(\'ytd\')">'       + t('fe.st.pYtd')       + '</button>'
      +         '<button type="button" class="btn ghost dc-of-preset" data-preset="year"      onclick="FleetExtra.dcOfSheetPreset(\'year\')">'      + t('fe.st.pYear')      + '</button>'
      +       '</div>'
      +       '<div class="dc-sheet-range">'
      +         '<label>' + t('fe.st.from') + '</label>'
      +         '<input class="input" type="date" id="dcOfStFrom" onchange="FleetExtra.dcOfSheetReload()">'
      +         '<label>' + t('fe.st.to') + '</label>'
      +         '<input class="input" type="date" id="dcOfStTo"   onchange="FleetExtra.dcOfSheetReload()">'
      +       '</div>'
      +     '</div>'
      +     '<div class="dc-sheet-actions">'
      +       '<button class="btn ok" onclick="FleetExtra.dcOfSheetPrint()">🖨️ ' + t('fe.st.print') + '</button>'
      +       '<button class="btn primary" onclick="FleetExtra.dcOfSheetEmail()">✉️ ' + t('fe.st.email') + '</button>'
      +       '<button class="btn ghost" onclick="FleetExtra.dcOfSheetClose()">✕</button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="dc-sheet-body" id="dcOfSheetBody"></div>'
      + '</div>';
    m.addEventListener('click', function (ev) { if (ev.target === m) dcOfSheetClose(); });
    document.body.appendChild(m);
  }
  function dcOfSheetClose() {
    var m = document.getElementById('dcOfSheetModal');
    if (m) m.classList.remove('open');
  }
  function dcOfSheetPreset(key) {
    var r = _dcPresetRange(key);
    if (!r) return;
    var fEl = document.getElementById('dcOfStFrom');
    var tEl = document.getElementById('dcOfStTo');
    if (fEl) fEl.value = r.from;
    if (tEl) tEl.value = r.to;
    var all = document.querySelectorAll('#dcOfSheetModal .dc-of-preset');
    for (var i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i].dataset.preset === key);
    dcOfSheetReload();
  }
  function dcOpenOfficialSettlement() {
    if (!_dcCurrent || !_dcCurrent.email) { toast(t('fe.dc.pickDriver'), 'err'); return; }
    _dcOfEnsureSheetModal();
    var m = document.getElementById('dcOfSheetModal');
    var fEl = document.getElementById('dcOfStFrom');
    var tEl = document.getElementById('dcOfStTo');
    if (fEl && !fEl.value) {
      var r0 = _dcPresetRange('thisMonth');
      fEl.value = r0.from;
      if (tEl) tEl.value = r0.to;
      var thisBtn = document.querySelector('#dcOfSheetModal .dc-of-preset[data-preset="thisMonth"]');
      if (thisBtn) thisBtn.classList.add('active');
    }
    _dcOfBnrOverride = null; // új nyitáskor a szerver-BNR-t használjuk alapból
    m.classList.add('open');
    dcOfSheetReload();
  }
  function dcOfSheetReload() {
    if (!_dcCurrent || !_dcCurrent.email) return;
    var from = (document.getElementById('dcOfStFrom') || {}).value;
    var to   = (document.getElementById('dcOfStTo')   || {}).value;
    var body = document.getElementById('dcOfSheetBody');
    if (!body) return;
    if (!from || !to) { body.innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.st.pickPeriod') + '</div>'; return; }
    body.innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + t('fe.loading') + '</div>';
    gas('getMonthlySettlementSheet', [{ email: _dcCurrent.email, from: from, to: to }]).then(function (r) {
      if (!r || !r.ok) { body.innerHTML = '<div class="text-muted" style="padding:20px;text-align:center;">' + esc((r && r.err) || t('common.error')) + '</div>'; return; }
      _dcOfSheet = r;
      // Alapbér: szerver → default 2700 (soha nem hardcodolva a render-be)
      var srvBase = r.driver && r.driver.net_base_salary_ron;
      _dcOfBaseSal = (srvBase != null) ? Number(srvBase) : 2700;
      body.innerHTML = _dcRenderOfficialHtml(r);
    });
  }

  // A summary + kiemelt záró blokk EGY külön HTML-forrásból; a
  // `dcOfBnrChange`/`dcOfSaveBase` élőben újrarajzolja a `#dcOfSummaryBox`-ba
  // (az input-ok érintetlenek maradnak — a fókusz megőrizve, folyamatos gépelés).
  function _dcOfBuildSummaryHtml(r, baseSal, bnr) {
    var tot = r.totals || {};
    var totE = tot.earned || {};
    var totEur = Number(totE.eur || 0);
    var totRon = Number(totE.ron || 0);
    var totalMonthlyRon = (bnr != null) ? (totEur * bnr + totRon) : null;
    var aboveBaseEur = (bnr != null && totalMonthlyRon != null && bnr > 0)
      ? (totalMonthlyRon - baseSal) / bnr : null;

    // Összegzés-blokk
    var sumBlock =
      '<div style="margin-top:18px;padding:14px 18px;border:2px solid #0f766e;border-radius:10px;background:#f0fdfa;color:#0f172a;">'
      +   '<div style="font-size:13px;font-weight:700;color:#134e4a;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.4px;">'
      +     '📊 ' + t('fe.stof.summary') + '</div>'
      +   '<table style="width:100%;border-collapse:collapse;font-size:13px;">'
      +     '<tr>'
      +       '<td style="padding:5px 0;">' + t('fe.stof.totalEur') + ':</td>'
      +       '<td style="padding:5px 0;text-align:right;font-weight:700;">' + n2(totEur, 2) + ' EUR</td>'
      +     '</tr>'
      +     '<tr>'
      +       '<td style="padding:5px 0;">' + t('fe.stof.totalRon') + ':</td>'
      +       '<td style="padding:5px 0;text-align:right;font-weight:700;">' + n2(totRon, 2) + ' RON</td>'
      +     '</tr>'
      +     '<tr>'
      +       '<td style="padding:5px 0;color:#475569;">' + t('fe.stof.bnrUsed') + ':</td>'
      +       '<td style="padding:5px 0;text-align:right;font-weight:700;color:#475569;">'
      +         (bnr != null ? ('1 EUR = ' + n2(bnr, 4) + ' RON') : '—')
      +       '</td>'
      +     '</tr>'
      +   '</table>'
      +   '<div style="margin-top:10px;padding-top:10px;border-top:1.5px dashed #14b8a6;">'
      +     '<table style="width:100%;border-collapse:collapse;font-size:14px;">'
      +       '<tr>'
      +         '<td style="padding:6px 0;font-weight:700;">' + t('fe.stof.totalMonthlyRon') + ':</td>'
      +         '<td style="padding:6px 0;text-align:right;font-weight:800;color:#0f766e;font-size:16px;">'
      +           (totalMonthlyRon != null ? n2(totalMonthlyRon, 2) + ' RON' : '—')
      +         '</td>'
      +       '</tr>'
      +       '<tr>'
      +         '<td style="padding:6px 0;">' + t('fe.stof.netBaseRon') + ':</td>'
      +         '<td style="padding:6px 0;text-align:right;font-weight:700;">' + n2(baseSal, 2) + ' RON</td>'
      +       '</tr>'
      +       '<tr>'
      +         '<td style="padding:8px 0;border-top:2px solid #0f766e;font-weight:800;font-size:15px;color:#7c2d12;">'
      +           '⭐ ' + t('fe.stof.aboveBaseEur') + ':'
      +         '</td>'
      +         '<td style="padding:8px 0;border-top:2px solid #0f766e;text-align:right;font-weight:900;font-size:18px;color:#7c2d12;">'
      +           (aboveBaseEur != null ? n2(aboveBaseEur, 2) + ' EUR' : '—')
      +         '</td>'
      +       '</tr>'
      +     '</table>'
      +   '</div>'
      + '</div>';

    // Kiemelt záró blokk
    var finalHighlight =
      '<div style="margin-top:20px;padding:16px 20px;border:2.5px solid #7c2d12;border-radius:10px;background:#fff7ed;color:#7c2d12;">'
      +   '<div style="font-size:16px;font-weight:800;color:#7c2d12;line-height:1.9;">'
      +     '<div>' + t('fe.stof.netBaseRon') + ': <span style="float:right;">' + n2(baseSal, 2) + ' RON</span></div>'
      +     '<div>' + t('fe.stof.aboveBaseEur') + ': <span style="float:right;">' + (aboveBaseEur != null ? n2(aboveBaseEur, 2) + ' EUR' : '—') + '</span></div>'
      +     '<div style="border-top:1.5px solid #7c2d12;padding-top:6px;margin-top:6px;">'
      +       t('fe.stof.totalMonthlyRon') + ': <span style="float:right;">' + (totalMonthlyRon != null ? n2(totalMonthlyRon, 2) + ' RON' : '—') + '</span>'
      +     '</div>'
      +   '</div>'
      + '</div>';

    return sumBlock + finalHighlight;
  }

  // A NYOMTATHATÓ HTML — nyomtatásba és e-mailbe is ugyanez megy.
  // Ugyanazokat a fejléc-elemeket használja, mint a Decont lunar-lap
  // (logó + cégadatok + doktípus-badge + elválasztó vonal + aláíró blokk).
  function _dcRenderOfficialHtml(r) {
    var d = r.driver, p = r.period, c = r.company, tot = r.totals || {};
    var isSingleMonth = (p.year && p.month);
    var monthLbl = isSingleMonth ? _dcMonthLabel(p.year, p.month) : (d2(p.from) + ' → ' + d2(p.to));
    var lang = (window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'ro';

    // A tényleges BNR: kézi override elsőbbség → szerver-oldali mai BNR →
    // utolsó, a böngészőbe elmentett kézi érték (per-cég localStorage, ha a
    // szerver-BNR végérvényesen elérhetetlen, pl. proxy/WAF-blokk élesen).
    var bnrSrv = tot.bnr_rate;
    var bnrLastManual = _dcOfLastManualBnr();
    var bnr = (_dcOfBnrOverride != null && isFinite(_dcOfBnrOverride) && _dcOfBnrOverride > 0)
      ? Number(_dcOfBnrOverride)
      : (bnrSrv != null ? Number(bnrSrv)
        : (bnrLastManual != null ? bnrLastManual : null));
    // Jelezzük, hogy honnan jön a BNR (a warn-sáv szövegéhez)
    var bnrFromLastManual = (bnr != null && bnrSrv == null && _dcOfBnrOverride == null);

    var baseSal = (_dcOfBaseSal != null && isFinite(_dcOfBaseSal)) ? Number(_dcOfBaseSal) : 2700;

    var totE = tot.earned || {};
    var totEur = Number(totE.eur || 0);
    var totRon = Number(totE.ron || 0);

    // Számítás (csak ha BNR elérhető)
    var totalMonthlyRon = (bnr != null) ? (totEur * bnr + totRon) : null;
    var aboveBaseEur = (bnr != null && totalMonthlyRon != null && bnr > 0)
      ? (totalMonthlyRon - baseSal) / bnr : null;

    // Járandóság-tételes tábla — MINDEN diurna/bónusz/rakodás/etc.
    var eRows = (r.earnings || []).map(function (it) {
      var kindKey = it.kind || 'other';
      var kindLbl;
      if (_dcBuiltinKinds.indexOf(kindKey) >= 0) kindLbl = t('fe.de.kind.' + kindKey);
      else {
        var f = _dcCustomKinds.find(function (k) { return k.key === kindKey; });
        kindLbl = f ? ((lang === 'hu' && f.label_hu) ? f.label_hu : (f.label_ro || kindKey)) : kindKey;
      }
      return '<tr>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">' + d2(it.earning_date) + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">' + esc(kindLbl) + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">' + esc(it.label || '—') + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">' + n2(it.quantity, 2) + ' × ' + n2(it.unit_amount, 2) + '</td>'
        + '<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">'
        +   n2(it.total_amount, 2) + ' ' + esc(it.currency || 'RON') + '</td>'
        + '</tr>';
    }).join('') || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#6b7280;font-style:italic;">' + t('fe.de.empty') + '</td></tr>';

    // Cég-fejléc (metasor + adresa)
    var compMeta = [];
    if (c.cui) compMeta.push('CUI: ' + esc(c.cui));
    if (c.telefon) compMeta.push('Tel: ' + esc(c.telefon));
    if (c.email_contact) compMeta.push(esc(c.email_contact));
    var compMetaLine = compMeta.length ? '<div style="font-size:11px;color:#6b7280;margin-top:2px;">' + compMeta.join(' · ') + '</div>' : '';
    var compAdresa = c.adresa ? '<div style="font-size:11px;color:#6b7280;">' + esc(c.adresa) + '</div>' : '';
    var logoCell = c.logo_data_uri
      ? '<td style="vertical-align:middle;width:96px;padding-right:16px;">'
        + '<img src="' + esc(c.logo_data_uri) + '" alt="" '
        +   'style="max-width:88px;max-height:80px;display:block;">'
        + '</td>'
      : '';

    // Alapbér- + BNR-szerkesztő sáv (csak képernyőn látszik, nyomtatásból kimarad).
    // FONTOS: az input-ok explicit fehér-BG + sötét-szöveg stílust kapnak (nem
    // `.input` osztályt), hogy a sötét téma se tudja kicsavarni; mustársárga
    // (#fef3c7) + espresso (#78350f) mindig-fehér doc-háttéren, jól olvasható.
    // A BNR `oninput` CSAK a summary-t frissíti — az input DOM-fókusza megmarad
    // (előző körben az egész body-t újrarendereltük → minden karakter után
    // elveszett a fókusz és „nem lehetett beírni"; ezt a `dcOfBnrChange`
    // javította — itt az inputokat is fókusz-barátra hoztuk).
    var salaryEditor =
      '<div class="dc-of-editor no-print" style="margin:0 0 14px;padding:12px 14px;background:#fef3c7;border:2px solid #d97706;border-radius:10px;display:flex;flex-wrap:wrap;gap:14px;align-items:center;color:#78350f;">'
      +   '<div style="flex:0 0 auto;">'
      +     '<div style="font-size:11px;color:#78350f;text-transform:uppercase;letter-spacing:0.5px;font-weight:800;">' + t('fe.stof.baseSalary') + '</div>'
      +   '</div>'
      +   '<div style="display:flex;gap:6px;align-items:center;flex:0 0 auto;">'
      +     '<input type="number" step="0.01" min="0" max="100000" id="dcOfBaseSalInput" value="' + esc(String(baseSal)) + '" style="width:130px;padding:6px 10px;border:1.5px solid #d97706;border-radius:6px;background:#fff;color:#0f172a;font-size:14px;font-weight:700;">'
      +     '<span style="font-weight:800;color:#78350f;font-size:13px;">RON</span>'
      +     '<button type="button" class="btn primary" style="padding:6px 12px;font-size:12px;" onclick="FleetExtra.dcOfSaveBase()">' + t('fe.stof.saveSalary') + '</button>'
      +   '</div>'
      + (bnr == null
        ? '<div style="flex:1 1 100%;padding:8px 10px;background:#fee2e2;border:1.5px solid #ef4444;border-radius:6px;font-size:12px;color:#7f1d1d;font-weight:600;">' + t('fe.stof.bnrMissing') + '</div>'
        : (bnrFromLastManual
          ? '<div style="flex:1 1 100%;padding:7px 10px;background:#fef9c3;border:1.5px solid #ca8a04;border-radius:6px;font-size:11px;color:#713f12;font-weight:600;">⚠️ Curs BNR de la ultima introducere manuală (' + n2(bnr, 4) + ') — actualizează-l dacă e nevoie.</div>'
          : ''))
      +   '<div style="display:flex;gap:6px;align-items:center;flex:0 0 auto;">'
      +     '<label for="dcOfBnrInput" style="font-size:11px;color:#78350f;font-weight:800;text-transform:uppercase;letter-spacing:0.4px;">' + t('fe.stof.bnrEditLbl') + '</label>'
      +     '<input type="number" step="0.0001" min="0.1" max="20" id="dcOfBnrInput" placeholder="ex. 5.20" value="' + (bnr != null ? esc(String(bnr)) : '') + '" style="width:120px;padding:6px 10px;border:1.5px solid #d97706;border-radius:6px;background:#fff;color:#0f172a;font-size:14px;font-weight:700;" oninput="FleetExtra.dcOfBnrChange(this.value)">'
      +   '</div>'
      + '</div>';

    // Összegzés-blokk (a kiemelt zárósor) — külön változó, mert a
    // `dcOfBnrChange`/`dcOfSaveBase` élőben újrarajzolja a `#dcOfSummaryBox`
    // konténerbe (az editor-sáv és az input-ok érintetlenek maradnak).
    var summaryHtml = _dcOfBuildSummaryHtml(r, baseSal, bnr);
    // A régi inline `sumBlock` és `finalHighlight` innentől üres (a HTML a
    // `summaryHtml` alatt egyben — `_dcOfBuildSummaryHtml`).
    var sumBlock = '', finalHighlight = '';
    var _unused_legacy_sumBlock =
      '<div style="margin-top:18px;padding:14px 18px;border:2px solid #0f766e;border-radius:10px;background:#f0fdfa;">'
      +   '<div style="font-size:13px;font-weight:700;color:#134e4a;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.4px;">'
      +     '📊 ' + t('fe.stof.summary') + '</div>'
      +   '<table style="width:100%;border-collapse:collapse;font-size:13px;">'
      +     '<tr>'
      +       '<td style="padding:5px 0;">' + t('fe.stof.totalEur') + ':</td>'
      +       '<td style="padding:5px 0;text-align:right;font-weight:700;">' + n2(totEur, 2) + ' EUR</td>'
      +     '</tr>'
      +     '<tr>'
      +       '<td style="padding:5px 0;">' + t('fe.stof.totalRon') + ':</td>'
      +       '<td style="padding:5px 0;text-align:right;font-weight:700;">' + n2(totRon, 2) + ' RON</td>'
      +     '</tr>'
      +     '<tr>'
      +       '<td style="padding:5px 0;color:#475569;">' + t('fe.stof.bnrUsed') + ':</td>'
      +       '<td style="padding:5px 0;text-align:right;font-weight:700;color:#475569;">'
      +         (bnr != null ? ('1 EUR = ' + n2(bnr, 4) + ' RON') : '—')
      +       '</td>'
      +     '</tr>'
      +   '</table>'
      +   '<div style="margin-top:10px;padding-top:10px;border-top:1.5px dashed #14b8a6;">'
      +     '<table style="width:100%;border-collapse:collapse;font-size:14px;">'
      +       '<tr>'
      +         '<td style="padding:6px 0;font-weight:700;">' + t('fe.stof.totalMonthlyRon') + ':</td>'
      +         '<td style="padding:6px 0;text-align:right;font-weight:800;color:#0f766e;font-size:16px;">'
      +           (totalMonthlyRon != null ? n2(totalMonthlyRon, 2) + ' RON' : '—')
      +         '</td>'
      +       '</tr>'
      +       '<tr>'
      +         '<td style="padding:6px 0;">' + t('fe.stof.netBaseRon') + ':</td>'
      +         '<td style="padding:6px 0;text-align:right;font-weight:700;">' + n2(baseSal, 2) + ' RON</td>'
      +       '</tr>'
      +       '<tr>'
      +         '<td style="padding:8px 0;border-top:2px solid #0f766e;font-weight:800;font-size:15px;color:#7c2d12;">'
      +           '⭐ ' + t('fe.stof.aboveBaseEur') + ':'
      +         '</td>'
      +         '<td style="padding:8px 0;border-top:2px solid #0f766e;text-align:right;font-weight:900;font-size:18px;color:#7c2d12;">'
      +           (aboveBaseEur != null ? n2(aboveBaseEur, 2) + ' EUR' : '—')
      +         '</td>'
      +       '</tr>'
      +     '</table>'
      +   '</div>'
      + '</div>';

    // KIEMELT ZÁRÓ BLOKK — a régi inline verzió itt csak referencia (a valódi
    // renderelést `_dcOfBuildSummaryHtml` végzi); a változó `_unused_*` névre
    // átnevezve, hogy ne írja felül a fenti üres `finalHighlight`-ot.
    var _unused_legacy_finalHighlight =
      '<div style="margin-top:20px;padding:16px 20px;border:2.5px solid #7c2d12;border-radius:10px;background:#fff7ed;">'
      +   '<div style="font-size:16px;font-weight:800;color:#7c2d12;line-height:1.9;">'
      +     '<div>' + t('fe.stof.netBaseRon') + ': <span style="float:right;">' + n2(baseSal, 2) + ' RON</span></div>'
      +     '<div>' + t('fe.stof.aboveBaseEur') + ': <span style="float:right;">' + (aboveBaseEur != null ? n2(aboveBaseEur, 2) + ' EUR' : '—') + '</span></div>'
      +     '<div style="border-top:1.5px solid #7c2d12;padding-top:6px;margin-top:6px;">'
      +       t('fe.stof.totalMonthlyRon') + ': <span style="float:right;">' + (totalMonthlyRon != null ? n2(totalMonthlyRon, 2) + ' RON' : '—') + '</span>'
      +     '</div>'
      +   '</div>'
      + '</div>';

    return '<div class="dc-sheet-doc dc-of-doc">'
      // HIVATALOS FEJLÉC (ugyanaz a szerkezet, mint a Decont lunar-lapon)
      + '<table style="width:100%;border-collapse:collapse;">'
      +   '<tr>'
      +     logoCell
      +     '<td style="vertical-align:middle;">'
      +       '<div style="font-size:20px;font-weight:800;color:#0f172a;letter-spacing:0.2px;">' + esc(c.nev || '') + '</div>'
      +       compAdresa + compMetaLine
      +     '</td>'
      +     '<td style="vertical-align:middle;text-align:right;width:230px;">'
      +       '<div style="display:inline-block;padding:9px 16px;background:linear-gradient(135deg,#0f766e,#134e4a);color:#fff;border-radius:8px;font-weight:800;font-size:14px;letter-spacing:0.3px;">'
      +         t(isSingleMonth ? 'fe.stof.title' : 'fe.stof.titleRange')
      +       '</div>'
      +       '<div style="font-size:13px;color:#0f172a;font-weight:700;margin-top:6px;">' + esc(monthLbl) + '</div>'
      +       (isSingleMonth
        ? '<div style="font-size:11px;color:#6b7280;margin-top:2px;">' + t('fe.st.period') + ': ' + d2(p.from) + ' → ' + d2(p.to) + '</div>'
        : '')
      +     '</td>'
      +   '</tr>'
      + '</table>'
      + '<div style="height:0;border-top:2px solid #0f172a;margin:12px 0 16px;"></div>'
      // Sofőr adatok — a személyes mezők (`contract_no`/`cnp`/`id_series`+`id_number`)
      // a sofőr adatlapján egyszer megadva jönnek (users tábla, `driver-personal-data.sql`),
      // és a hivatalos elszámolás fejlécében is szerepelnek (munkaügyi + könyvelési nyomtatvány).
      // Csak akkor jelennek meg, ha ki van töltve → régi/hiányos sofőrnél a lap változatlan.
      + (function () {
          var lines = [];
          if (d.contract_no) lines.push('<span style="color:#475569;">' + t('fe.stof.contractNo') + ':</span> <b>' + esc(d.contract_no) + '</b>');
          if (d.cnp)         lines.push('<span style="color:#475569;">' + t('fe.stof.cnp')        + ':</span> <b>' + esc(d.cnp) + '</b>');
          var idBits = [];
          if (d.id_series) idBits.push(esc(d.id_series));
          if (d.id_number) idBits.push(esc(d.id_number));
          if (idBits.length) lines.push('<span style="color:#475569;">' + t('fe.stof.idDoc') + ':</span> <b>' + idBits.join(' ') + '</b>');
          var personalHtml = lines.length
            ? '<div style="font-size:11px;color:#0f172a;margin-top:6px;line-height:1.7;">' + lines.join(' &nbsp; · &nbsp; ') + '</div>'
            : '';
          return '<div style="padding:10px 14px;background:#f8fafc;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:14px;">'
            + '<div style="font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:0.4px;">' + t('fe.st.driver') + '</div>'
            + '<div style="font-size:15px;font-weight:700;color:#0f172a;">' + esc(d.nume) + '</div>'
            + '<div style="font-size:11px;color:#6b7280;">' + esc(d.email) + (d.tel ? ' · ' + esc(d.tel) : '') + '</div>'
            + personalHtml
            + '</div>';
        })()
      // Alapbér-szerkesztő (csak képernyőn, nyomtatásban NEM látszik)
      + salaryEditor
      // Tételes részletezés — CSAK KÉPERNYŐN (`no-print`); a hivatalos nyomtatott
      // változatban NEM szerepel (a sofőrnek a summary elég). A sima „Decont lunar"
      // (`_dcRenderSheetHtml`) tételes táblája ÉRINTETLEN — ott továbbra is nyomtatásba kerül.
      + '<div class="no-print">'
      +   '<div style="font-size:14px;font-weight:700;color:#0f172a;margin:12px 0 6px;">📋 ' + t('fe.stof.detailsTitle') + ' (' + (r.earnings || []).length + ')</div>'
      +   '<table style="width:100%;border-collapse:collapse;font-size:12px;">'
      +     '<thead><tr style="background:#ccfbf1;color:#134e4a;">'
      +       '<th style="padding:6px 8px;text-align:left;">' + t('fe.de.colDate') + '</th>'
      +       '<th style="padding:6px 8px;text-align:left;">' + t('fe.de.colKind') + '</th>'
      +       '<th style="padding:6px 8px;text-align:left;">' + t('fe.de.colLabel') + '</th>'
      +       '<th style="padding:6px 8px;text-align:right;">' + t('fe.de.colCalc') + '</th>'
      +       '<th style="padding:6px 8px;text-align:right;">' + t('fe.de.colTotal') + '</th>'
      +     '</tr></thead>'
      +     '<tbody>' + eRows + '</tbody>'
      +     '<tfoot><tr style="background:#f1f5f9;font-weight:800;">'
      +       '<td colspan="4" style="padding:8px;text-align:right;">' + t('fe.st.totalEarned') + ':</td>'
      +       '<td style="padding:8px;text-align:right;">'
      +         n2(totEur, 2) + ' EUR &nbsp; · &nbsp; ' + n2(totRon, 2) + ' RON'
      +       '</td>'
      +     '</tr></tfoot>'
      +   '</table>'
      + '</div>'
      // Összegzés-blokk + Kiemelt záró blokk — dinamikusan cserélhető konténer;
      // a `dcOfBnrChange`/`dcOfSaveBase` innen frissít, az editor-sáv érintetlen
      // (megőrzött input DOM-fókusz → a felhasználó folyamatosan gépelhet).
      + '<div id="dcOfSummaryBox">' + summaryHtml + '</div>'
      // Aláíró blokk (ugyanaz, mint a Decont lunar-lapon)
      + '<table style="width:100%;border-collapse:collapse;margin-top:36px;">'
      +   '<tr>'
      +     '<td style="width:50%;vertical-align:top;padding-right:16px;height:110px;">'
      +       '<div style="height:70px;"></div>'
      +       '<div style="border-top:1.5px solid #0f172a;padding-top:6px;font-size:11px;color:#475569;">' + t('fe.st.signDriver') + '</div>'
      +       '<div style="font-size:12px;color:#94a3b8;margin-top:2px;">' + esc(d.nume) + '</div>'
      +     '</td>'
      +     '<td style="width:50%;vertical-align:top;padding-left:16px;height:110px;position:relative;">'
      +       (c.stamp_data_uri
        ? '<div style="height:70px;text-align:center;">'
          + '<img src="' + esc(c.stamp_data_uri) + '" alt="" '
          + 'style="max-height:68px;max-width:120px;opacity:0.85;">'
          + '</div>'
        : '<div style="height:70px;"></div>')
      +       '<div style="border-top:1.5px solid #0f172a;padding-top:6px;font-size:11px;color:#475569;">' + t('fe.st.signCompany') + '</div>'
      +       '<div style="font-size:12px;color:#94a3b8;margin-top:2px;">' + esc(c.nev || '') + '</div>'
      +     '</td>'
      +   '</tr>'
      + '</table>'
      // Lábléc
      + '<div style="margin-top:24px;padding-top:8px;border-top:1px solid #e5e7eb;font-size:10px;color:#94a3b8;text-align:center;">'
      +   t('fe.stof.footNote') + ' · VallorSoft'
      + '</div>'
      + '</div>';
  }

  // Kézi BNR-változás: csak a helyi state-ben tároljuk, majd re-render.
  function dcOfBnrChange(val) {
    var n = parseFloat(val);
    _dcOfBnrOverride = (isFinite(n) && n > 0) ? n : null;
    // A kézzel beírt érték elmentve localStorage-ba — a következő nyitáskor
    // előre kitöltésre kerül, ha a szerver-BNR akkor sem elérhető.
    if (_dcOfBnrOverride != null) _dcOfSaveManualBnr(_dcOfBnrOverride);
    // CSAK a summary-blokk újrarajzolása — az editor-sáv és a BNR-input DOM-ja
    // érintetlen marad → a fókusz megmarad és a felhasználó folyamatosan gépelhet
    // (előző hiba: az egész body újrarenderelése minden karakter után elvette
    // a fókuszt → „nem lehet beírni").
    _dcOfRefreshSummary();
  }

  function _dcOfRefreshSummary() {
    if (!_dcOfSheet) return;
    var box = document.getElementById('dcOfSummaryBox');
    if (!box) return;
    var tot = _dcOfSheet.totals || {};
    var bnrSrv = tot.bnr_rate;
    var bnrLastManual = _dcOfLastManualBnr();
    var bnr = (_dcOfBnrOverride != null && isFinite(_dcOfBnrOverride) && _dcOfBnrOverride > 0)
      ? Number(_dcOfBnrOverride)
      : (bnrSrv != null ? Number(bnrSrv)
        : (bnrLastManual != null ? bnrLastManual : null));
    var baseSal = (_dcOfBaseSal != null && isFinite(_dcOfBaseSal)) ? Number(_dcOfBaseSal) : 2700;
    box.innerHTML = _dcOfBuildSummaryHtml(_dcOfSheet, baseSal, bnr);
  }

  // Alapbér-mentés (per sofőr, `users.net_base_salary_ron`).
  // Best-effort: siker után újrarenderelünk, kudarcnál toast + state visszaáll.
  function dcOfSaveBase() {
    if (!_dcCurrent || !_dcCurrent.email) { toast(t('fe.dc.pickDriver'), 'err'); return; }
    var inp = document.getElementById('dcOfBaseSalInput');
    if (!inp) return;
    var v = parseFloat(inp.value);
    if (!isFinite(v) || v < 0 || v > 100000) {
      toast(t('fe.stof.baseSalary') + ' — invalid (0…100000)', 'err');
      return;
    }
    gas('setDriverBaseSalary', [{ email: _dcCurrent.email, base_salary_ron: v }]).then(function (r) {
      if (!r || !r.ok) { toast((r && r.err) || t('common.error'), 'err'); return; }
      _dcOfBaseSal = (r.base_salary_ron != null) ? Number(r.base_salary_ron) : 2700;
      // Frissítjük a driver-mezőt is a cache-elt válaszban, hogy újranyitáskor is ezt lássa
      if (_dcOfSheet && _dcOfSheet.driver) _dcOfSheet.driver.net_base_salary_ron = _dcOfBaseSal;
      toast(t('fe.stof.salarySaved'), 'ok');
      // Csak a summary-t rajzoljuk újra — az editor-sáv (és bármely fókuszos input) érintetlen
      _dcOfRefreshSummary();
    });
  }

  function dcOfSheetPrint() {
    if (!_dcOfSheet) { toast(t('fe.st.loadFirst'), 'err'); return; }
    var doc = document.querySelector('#dcOfSheetBody .dc-of-doc');
    if (!doc) { toast(t('fe.st.loadFirst'), 'err'); return; }
    var w = window.open('', '_blank');
    if (!w) { toast(t('fe.st.popupBlocked'), 'err'); return; }
    var lang = (window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'ro';
    var title = t('fe.stof.title') + ' — ' + (_dcOfSheet.driver.nume || '') + ' — '
      + (_dcOfSheet.period.year && _dcOfSheet.period.month
        ? _dcMonthLabel(_dcOfSheet.period.year, _dcOfSheet.period.month)
        : (_dcOfSheet.period.from + ' → ' + _dcOfSheet.period.to));
    w.document.write(
      '<!doctype html><html lang="' + lang + '"><head><meta charset="utf-8"><title>' + esc(title) + '</title>'
      + '<style>body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#0f172a;background:#fff;}'
      + '@page{size:A4;margin:14mm;}'
      + '@media print{body{margin:0;} .no-print{display:none!important;}}'
      + '.no-print{}'
      + '</style></head><body>' + doc.outerHTML + '</body></html>'
    );
    w.document.close();
    setTimeout(function () { try { w.focus(); w.print(); } catch (_e) {} }, 200);
  }

  function dcOfSheetEmail() {
    if (!_dcOfSheet) { toast(t('fe.st.loadFirst'), 'err'); return; }
    var doc = document.querySelector('#dcOfSheetBody .dc-of-doc');
    if (!doc) { toast(t('fe.st.loadFirst'), 'err'); return; }
    // Az alapbér-szerkesztő ne menjen ki e-mailben — kivágjuk a doc klónjából
    var clone = doc.cloneNode(true);
    var editors = clone.querySelectorAll('.no-print');
    for (var i = 0; i < editors.length; i++) editors[i].parentNode.removeChild(editors[i]);
    var toDefault = _dcOfSheet.driver.email || '';
    var to = window.prompt(t('fe.st.emailPrompt'), toDefault);
    if (!to) return;
    to = String(to).trim().toLowerCase();
    var perLbl = (_dcOfSheet.period.year && _dcOfSheet.period.month)
      ? _dcMonthLabel(_dcOfSheet.period.year, _dcOfSheet.period.month)
      : (_dcOfSheet.period.from + ' → ' + _dcOfSheet.period.to);
    var subject = t('fe.stof.emailSubject') + ' · ' + perLbl + ' · ' + _dcOfSheet.driver.nume;
    gas('sendSettlementSheetEmail', [{ to: to, subject: subject, html: clone.outerHTML }]).then(function (r) {
      if (r && r.ok) toast(t('fe.st.emailSent'), 'ok');
      else toast((r && r.err) || t('common.error'), 'err');
    });
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
    dashServiceAlert: renderDashServiceAlert,
    expEntityChange: expEntityChange, expSave: expSave, expEdit: expEdit, expDelete: expDelete,
    svSave: svSave, svDelete: svDelete,
    // Szerviz-esedékesség modal (Halasztás / Elvégezve)
    svOpenDecide: svOpenDecide,
    svOpenPostpone: svOpenPostpone, svPostDatePreset: svPostDatePreset, svPostKmPreset: svPostKmPreset,
    svSubmitPostpone: svSubmitPostpone,
    svOpenComplete: svOpenComplete, svSubmitComplete: svSubmitComplete,
    svCloseModal: svCloseModal,
    dcLoad: dcLoad, _dcMaybeReload: _dcMaybeReload,
    // Új: járandóság + kifizetés + kártyás decont
    dcEarnKindChange: dcEarnKindChange,
    dcEarnRecalc: dcEarnRecalc,
    dcEarnSave: dcEarnSave,
    dcEarnDelete: dcEarnDelete,
    dcOpenPayment: dcOpenPayment,
    dcClosePayment: dcClosePayment,
    dcPayCurChange: dcPayCurChange,
    dcPayRecalc: dcPayRecalc,
    dcPaySubmit: dcPaySubmit,
    dcPayDelete: dcPayDelete,
    // Sor-szintű kifizetés (💰) + egyéni típus-kezelő (⚙️)
    dcPayRow: dcPayRow,
    dcKindManage: dcKindManage,
    dcKindClose: dcKindClose,
    dcKindCreate: dcKindCreate,
    dcKindDelete: dcKindDelete,
    // Havi elszámolás-lap (📄 PDF/nyomtatható + e-mail)
    dcOpenSettlement: dcOpenSettlement,
    dcSheetClose: dcSheetClose,
    dcSheetReload: dcSheetReload,
    dcSheetPreset: dcSheetPreset,
    dcSheetPrint: dcSheetPrint,
    dcSheetEmail: dcSheetEmail,
    // Decont oficial (📑 hivatalos elszámolás — alapbéren felül fizetendő)
    dcOpenOfficialSettlement: dcOpenOfficialSettlement,
    dcOfSheetClose: dcOfSheetClose,
    dcOfSheetReload: dcOfSheetReload,
    dcOfSheetPreset: dcOfSheetPreset,
    dcOfSheetPrint: dcOfSheetPrint,
    dcOfSheetEmail: dcOfSheetEmail,
    dcOfSaveBase: dcOfSaveBase,
    dcOfBnrChange: dcOfBnrChange,
    fcParse: fcParse, fcImport: fcImport,
  };
})();
