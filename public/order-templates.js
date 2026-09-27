// ============================================================
//  public/order-templates.js — Ismétlődő fuvar-sablonok (admin + manager)
//
//  • 📋 „Din șablon" gomb a fuvar-kiírás tetején → sablon-választó
//    (használat · átnevezés · törlés, kereséssel).
//  • Fuvar ⋯ menü: „🔁 Újra kiírás" (a fuvar adataival azonnal előtölt)
//    és „💾 Mentés sablonként" (név megadásával elmenti).
//
//  Előtöltött: ügyfél, állomások (a bevitel sorrendjében, DÁTUM NÉLKÜL),
//  FTL/LTL, súly, méretek, ár, km, vontató/pótkocsi rendszám.
//  NEM töltött: dátumok, referencia, UIT — ezeket minden fuvarnál újra adod meg.
//  A sablon tartalmát a szerver állítja össze (handlers/orderTemplates.js).
// ============================================================
(function () {
  'use strict';

  function tt(k, def, vars) {
    try { if (typeof t === 'function') { var v = t(k, vars); if (v && v !== k) return v; } } catch (e) {}
    var s = def;
    if (vars) Object.keys(vars).forEach(function (x) { s = String(s).replace(new RegExp('\\{' + x + '\\}', 'g'), vars[x]); });
    return s;
  }
  function h(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function note(msg, kind) { if (typeof toast === 'function') toast(msg, kind || 'ok'); }

  // ── Az űrlap kitöltése a sablon mezőivel ──
  function _set(id, v) {
    var el = document.getElementById(id);
    if (el) el.value = (v == null ? '' : v);
  }
  function _fill(f) {
    f = f || {};
    _set('oClient', f.client);
    // A fuvar-egyedi mezők ürítése (dátum/ref/UIT újra megadandó)
    _set('oRef', ''); _set('oUit', '');
    _set('oPret', f.pret); _set('oKm', f.km); _set('oSuly', f.suly_kg);
    _set('oHossz', f.hossz_cm); _set('oSzel', f.szel_cm); _set('oMag', f.mag_cm);
    var ftl = document.getElementById('oFtl'), ltl = document.getElementById('oLtl');
    if (ftl) ftl.checked = (f.load_type === 'FTL');
    if (ltl) ltl.checked = (f.load_type === 'LTL');
    if (typeof refreshDimReq === 'function') { try { refreshDimReq(); } catch (e) {} }
    // Rendszámok: csak ha a flottában megvannak (a legördülők értékei)
    var cam = document.getElementById('oCamionSelect'), rem = document.getElementById('oRemorcaSelect');
    if (cam) cam.value = '';
    if (rem) rem.value = '';
    if (typeof _ordScanPlate === 'function') {
      _ordScanPlate('oCamionSelect', f.rendszam_camion);
      _ordScanPlate('oRemorcaSelect', f.rendszam_remorca);
    }
    // Állomások → wizard (sorrend megtartva, dátum nélkül)
    if (typeof window.ocLoadStops === 'function') window.ocLoadStops(f.stops || []);
    if (typeof orderRouteRecalc === 'function') { try { orderRouteRecalc('create'); } catch (e) {} }
  }

  // A fuvar-kiírás fülre váltunk (ha még nem ott vagyunk — az újra-aktiválás a
  // jármű-legördülőket is újratöltené), megvárjuk a wizard felépülését ÉS a
  // jármű-lista betöltését (különben a rendszám-kiválasztás elveszne), majd töltünk.
  function _applyOnForm(fields, label) {
    var pane = document.querySelector('.pane[data-pane="orders-form"]');
    var onForm = pane && !pane.classList.contains('hidden') && pane.offsetParent !== null;
    if (!onForm && typeof activateTab === 'function') { try { activateTab('orders-form'); } catch (e) {} }
    var tries = 0;
    var needVeh = !!((fields && (fields.rendszam_camion || fields.rendszam_remorca)));
    (function wait() {
      var ready = window.OC && window.OC.mounted && document.getElementById('ocWizardShell');
      var cam = document.getElementById('oCamionSelect');
      var vehReady = !needVeh || (cam && cam.options.length > 1);
      // max. ~3 mp (üres flottánál / hiba esetén is továbblépünk)
      if ((!ready || !vehReady) && tries++ < 40) { setTimeout(wait, 75); return; }
      _fill(fields);
      note(tt('otpl.loaded', 'Șablon încărcat: {name} — completează datele și referința.', { name: label || fields.client || '' }), 'ok');
    })();
  }

  // ── Fuvar ⋯ menü: 🔁 Újra kiírás ──
  function repeatOrder(orderId) {
    gas('orderTemplateBuild', [String(orderId)]).then(function (r) {
      if (!r || !r.ok) { note((r && r.err) || tt('common.error', 'Eroare'), 'err'); return; }
      _applyOnForm(r.fields, r.fields && r.fields.client);
    }).catch(function () { note(tt('common.connError', 'Eroare de conexiune'), 'err'); });
  }

  // ── Fuvar ⋯ menü: 💾 Mentés sablonként ──
  function saveFromOrder(orderId, defName) {
    var name = window.prompt(tt('otpl.namePrompt', 'Numele șablonului (ex. client + rută):'), defName || '');
    if (name == null) return;
    name = String(name).trim();
    if (!name) { note(tt('otpl.nameReq', 'Numele șablonului este obligatoriu.'), 'err'); return; }
    gas('orderTemplateSaveFromOrder', [{ order_id: String(orderId), name: name }]).then(function (r) {
      if (r && r.ok) note(tt('otpl.saved', 'Șablon salvat: {name}', { name: name }), 'ok');
      else note((r && r.err) || tt('common.error', 'Eroare'), 'err');
    }).catch(function () { note(tt('common.connError', 'Eroare de conexiune'), 'err'); });
  }

  // ── 📋 Sablon-választó ──
  var _items = [];
  function openPicker() {
    closePicker();
    var ovl = document.createElement('div');
    ovl.id = 'otplModal';
    ovl.className = 'modal-back';
    ovl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
    ovl.innerHTML =
      '<div class="glass" style="padding:20px;max-width:640px;width:100%;border-radius:14px;max-height:88vh;display:flex;flex-direction:column;">' +
        '<h3 class="h-title" style="margin-top:0;">📋 ' + h(tt('otpl.title', 'Șabloane de curse')) + '</h3>' +
        '<div class="text-muted" style="font-size:12px;margin:-4px 0 10px;">' +
          h(tt('otpl.hint', 'Alege un șablon: se completează clientul, punctele (fără date), marfa, prețul și vehiculul. Șablon nou: din lista de curse ⋯ → „💾 Salvează ca șablon".')) + '</div>' +
        '<input class="input" id="otplSearch" placeholder="' + h(tt('otpl.search', 'Caută după nume, client sau rută…')) + '" style="margin-bottom:10px;">' +
        '<div id="otplList" style="overflow:auto;flex:1;min-height:80px;">⏳</div>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:12px;">' +
          '<button class="btn ghost" id="otplClose">' + h(tt('common.close', 'Închide')) + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ovl);
    ovl.addEventListener('click', function (e) { if (e.target === ovl) closePicker(); });
    ovl.querySelector('#otplClose').addEventListener('click', closePicker);
    ovl.querySelector('#otplSearch').addEventListener('input', _renderList);
    _load();
  }
  function closePicker() {
    var el = document.getElementById('otplModal');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
  function _load() {
    gas('orderTemplateList', []).then(function (r) {
      _items = (r && r.ok && Array.isArray(r.items)) ? r.items : [];
      if (r && !r.ok) note(r.err || tt('common.error', 'Eroare'), 'err');
      _renderList();
    }).catch(function () { _items = []; _renderList(); });
  }
  function _renderList() {
    var box = document.getElementById('otplList');
    if (!box) return;
    var q = ((document.getElementById('otplSearch') || {}).value || '').toLowerCase().trim();
    var list = _items.filter(function (x) {
      if (!q) return true;
      return (String(x.name) + ' ' + (x.client || '') + ' ' + (x.route || '')).toLowerCase().indexOf(q) >= 0;
    });
    if (!list.length) {
      box.innerHTML = '<div class="text-muted" style="padding:18px;text-align:center;font-size:13px;">' +
        h(_items.length ? tt('otpl.noMatch', 'Niciun șablon nu corespunde căutării.')
                        : tt('otpl.empty', 'Încă nu ai șabloane. Salvează o cursă ca șablon din lista de curse (⋯ → „💾 Salvează ca șablon").')) + '</div>';
      return;
    }
    box.innerHTML = list.map(function (x) {
      var meta = [];
      if (x.client) meta.push('🏢 ' + h(x.client));
      if (x.route) meta.push('📍 ' + h(x.route) + (x.stops_count > 2 ? ' (' + x.stops_count + ')' : ''));
      if (x.load_type) meta.push(h(x.load_type));
      if (x.pret != null) meta.push(h(x.pret) + ' €');
      meta.push('🔁 ' + (x.use_count || 0) + '×');
      return '<div class="glass-soft" style="padding:10px 12px;margin-bottom:8px;display:flex;gap:10px;align-items:center;">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-weight:700;">' + h(x.name) + '</div>' +
          '<div class="text-muted" style="font-size:12px;margin-top:2px;">' + meta.join(' · ') + '</div>' +
        '</div>' +
        '<button class="btn primary" style="padding:6px 12px;font-size:12px;" data-otpl-use="' + x.id + '">' + h(tt('otpl.use', 'Folosește')) + '</button>' +
        '<button class="btn ghost" style="padding:6px 9px;font-size:12px;" title="' + h(tt('otpl.rename', 'Redenumește')) + '" data-otpl-ren="' + x.id + '">✏️</button>' +
        '<button class="btn ghost" style="padding:6px 9px;font-size:12px;" title="' + h(tt('common.delete', 'Șterge')) + '" data-otpl-del="' + x.id + '">🗑</button>' +
      '</div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-otpl-use]'), function (b) {
      b.addEventListener('click', function () { _use(parseInt(b.getAttribute('data-otpl-use'), 10)); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-otpl-ren]'), function (b) {
      b.addEventListener('click', function () { _rename(parseInt(b.getAttribute('data-otpl-ren'), 10)); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-otpl-del]'), function (b) {
      b.addEventListener('click', function () { _del(parseInt(b.getAttribute('data-otpl-del'), 10)); });
    });
  }
  function _find(id) { for (var i = 0; i < _items.length; i++) if (_items[i].id === id) return _items[i]; return null; }
  function _use(id) {
    gas('orderTemplateUse', [id]).then(function (r) {
      if (!r || !r.ok) { note((r && r.err) || tt('common.error', 'Eroare'), 'err'); return; }
      closePicker();
      _applyOnForm(r.fields || {}, r.name);
    }).catch(function () { note(tt('common.connError', 'Eroare de conexiune'), 'err'); });
  }
  function _rename(id) {
    var it = _find(id);
    var name = window.prompt(tt('otpl.namePrompt', 'Numele șablonului (ex. client + rută):'), it ? it.name : '');
    if (name == null) return;
    name = String(name).trim();
    if (!name) return;
    gas('orderTemplateRename', [{ id: id, name: name }]).then(function (r) {
      if (r && r.ok) _load(); else note((r && r.err) || tt('common.error', 'Eroare'), 'err');
    });
  }
  function _del(id) {
    var it = _find(id);
    if (!window.confirm(tt('otpl.delConfirm', 'Ștergi șablonul „{name}"?', { name: it ? it.name : '' }))) return;
    gas('orderTemplateDelete', [id]).then(function (r) {
      if (r && r.ok) { note(tt('common.deleted', 'Șters'), 'ok'); _load(); }
      else note((r && r.err) || tt('common.error', 'Eroare'), 'err');
    });
  }

  window.OrderTemplates = { openPicker: openPicker, closePicker: closePicker,
                            repeatOrder: repeatOrder, saveFromOrder: saveFromOrder };
})();
