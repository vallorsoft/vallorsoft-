// public/email-templates.js
// Cégszintű TRANZAKCIÓS e-mail sablon-kezelő (Adminisztráció -> E-mail sablonok).
// EmailTemplates.mount('emailTemplatesBox') a fül megnyitásakor.
//
// ÚJRAHASZNÁLT backend (NEM duplikálunk):
//   - gas('emailTemplateList')   -> a cég sablonjai (vagy alapértelmezett)
//   - gas('emailTemplateSave')   -> upsert kulcsra (Admin/Manager)
//   - gas('sendTemplatedEmail')  -> sablonból küldés (teszt: saját e-mailre)
// A meglévő gas()/toast()/t() segédeket használja (console-shared.js + i18n.js).
//
// KÜLÖN a developer rendszer-sablonjaitól és a kliens-levelező szabad
// sablonjaitól — ezek tranzakciós (fuvar/árajánlat/számla) cég-sablonok.
window.EmailTemplates = (function () {
  function tt(key, fb) {
    try { if (typeof t === 'function') { var v = t(key); if (v && v !== key) return v; } } catch (e) {}
    return fb;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }

  // Kulcs -> embernek olvasható címke + tipp a használható változókhoz.
  var KEY_LABELS = {
    order_confirm_carrier: { fb: 'Fuvar-visszaigazolás (fuvarozónak)', vars: 'order_id, route, client' },
    order_status_change:   { fb: 'Fuvar státusz-változás', vars: 'order_id, route, status' },
    quote_send:            { fb: 'Árajánlat küldése', vars: 'client, route, pret' },
    invoice_notify:        { fb: 'Számla-értesítő', vars: 'client, invoice_no, order_id' },
    generic:               { fb: 'Általános', vars: 'subject, message' },
  };

  var _root = null;
  var _items = [];

  function keyLabel(k) { return tt('etpl.key.' + k, (KEY_LABELS[k] && KEY_LABELS[k].fb) || k); }
  function keyVars(k) { return (KEY_LABELS[k] && KEY_LABELS[k].vars) || ''; }

  function render() {
    if (!_root) return;
    var h = '<div class="glass" style="padding:22px;max-width:980px;">';
    h += '<h2 class="h-title" style="margin-top:0;">' + tt('etpl.title', '✉️ E-mail sablonok') + '</h2>';
    h += '<p style="color:var(--muted);font-size:13px;margin:0 0 16px;">' + tt('etpl.intro', 'Cégszintű tranzakciós e-mail sablonok (RO + HU). A {{változók}} a küldéskor töltődnek ki.') + '</p>';

    _items.forEach(function (it, i) {
      var vars = keyVars(it.key);
      h += '<div class="glass-soft" style="padding:16px;margin-bottom:14px;border-radius:12px;">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">';
      h += '<b class="text-primary" style="font-size:14px;">' + esc(keyLabel(it.key)) + '</b>';
      h += '<label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="etActive_' + i + '"' + (it.active === false ? '' : ' checked') + '> ' + tt('etpl.active', 'Aktív') + '</label>';
      h += '</div>';
      if (vars) h += '<div style="font-size:11px;color:var(--muted);margin-bottom:10px;">' + tt('etpl.varsHint', 'Változók') + ': <code>' + esc(vars.split(',').map(function (v) { return '{{' + v.trim() + '}}'; }).join(' ')) + '</code></div>';

      // Kész sablonok (presetek) — mindenki számára elérhető, betöltés után szerkeszthető.
      var presets = (window.ETPL_PRESETS && window.ETPL_PRESETS[it.key]) || [];
      if (presets.length) {
        var nameOf = window.etplPresetName || function (p) { return (p && p.name && (p.name.ro || p.name.hu)) || ''; };
        h += '<div style="margin-bottom:12px;">';
        h += '<div style="font-size:11px;color:var(--muted);margin-bottom:5px;">' + tt('etpl.presets', '✨ Kész sablonok — kattints a betöltéshez, majd szabd testre és mentsd') + '</div>';
        h += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
        presets.forEach(function (p, pi) {
          h += '<button class="btn ghost" style="padding:6px 11px;font-size:12px;" onclick="EmailTemplates.applyPreset(' + i + ',' + pi + ')">' + esc(nameOf(p)) + '</button>';
        });
        h += '</div></div>';
      }

      h += '<div class="grid-2" style="gap:14px;align-items:start;">';
      // RO
      h += '<div>';
      h += '<div class="field"><label>' + tt('etpl.subjectRo', 'Tárgy (RO)') + '</label><input class="input" id="etSubRo_' + i + '" value="' + esc(it.subject_ro || '') + '"></div>';
      h += '<div class="field"><label>' + tt('etpl.bodyRo', 'Törzs (RO)') + '</label><textarea class="textarea" id="etBodyRo_' + i + '" rows="5">' + esc(it.body_ro || '') + '</textarea></div>';
      h += '</div>';
      // HU
      h += '<div>';
      h += '<div class="field"><label>' + tt('etpl.subjectHu', 'Tárgy (HU)') + '</label><input class="input" id="etSubHu_' + i + '" value="' + esc(it.subject_hu || '') + '"></div>';
      h += '<div class="field"><label>' + tt('etpl.bodyHu', 'Törzs (HU)') + '</label><textarea class="textarea" id="etBodyHu_' + i + '" rows="5">' + esc(it.body_hu || '') + '</textarea></div>';
      h += '</div>';
      h += '</div>';

      h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">';
      h += '<button class="btn primary" onclick="EmailTemplates.save(' + i + ')">' + tt('etpl.save', '💾 Mentés') + '</button>';
      h += '<button class="btn ghost" onclick="EmailTemplates.sendTo(' + i + ')">' + tt('etpl.sendToBtn', '📧 Küldés címzettnek') + '</button>';
      h += '<button class="btn ghost" onclick="EmailTemplates.test(' + i + ')">' + tt('etpl.test', '📧 Teszt-küldés (saját e-mail)') + '</button>';
      h += '</div>';
      h += '</div>';
    });

    h += '</div>';
    _root.innerHTML = h;
  }

  function mount(boxId) {
    _root = document.getElementById(boxId);
    if (!_root) return;
    _root.innerHTML = '<div class="glass" style="padding:22px;"><div class="h-sub">' + tt('etpl.loading', 'Betöltés…') + '</div></div>';
    gas('emailTemplateList', []).then(function (d) {
      if (!d || !d.ok) { _root.innerHTML = '<div class="glass" style="padding:22px;"><div class="badge err">' + esc((d && d.err) || 'Eroare') + '</div></div>'; return; }
      _items = d.items || [];
      render();
    });
  }

  function _collect(i) {
    return {
      key: _items[i].key,
      subject_ro: (document.getElementById('etSubRo_' + i) || {}).value || '',
      subject_hu: (document.getElementById('etSubHu_' + i) || {}).value || '',
      body_ro: (document.getElementById('etBodyRo_' + i) || {}).value || '',
      body_hu: (document.getElementById('etBodyHu_' + i) || {}).value || '',
      active: !!(document.getElementById('etActive_' + i) || {}).checked,
    };
  }

  function save(i) {
    var payload = _collect(i);
    gas('emailTemplateSave', [payload]).then(function (d) {
      if (d && d.ok) {
        toast(tt('etpl.saved', 'Mentve'), 'ok');
        // frissítjük a helyi állapotot, hogy a teszt-küldés a mentettet vegye
        Object.assign(_items[i], payload, { isDefault: false });
      } else { toast((d && d.err) || 'Eroare', 'err'); }
    });
  }

  function test(i) {
    // A teszt-küldés a sablon kulcsára megy, a saját (belépett) e-mailre.
    // A változók a kulcshoz tartozó minta-értékekkel töltődnek (csak teszt).
    var key = _items[i].key;
    // A saját (belépett) e-mail — a console-shared.js által beállított globál.
    var to = (typeof myEmail === 'string' && myEmail) ? myEmail : '';
    if (!to) { to = prompt((tt('etpl.askEmail', 'Címzett e-mail:')) || 'E-mail:') || ''; }
    if (!to) return;
    var sampleVars = {
      order_id: 'TEST-001', route: 'București → Cluj', client: 'Demo SRL',
      status: 'In Curs', pret: '1200 EUR', invoice_no: 'FV-2026-001',
      subject: tt('etpl.sampleSubject', 'Mesaj de test'), message: tt('etpl.sampleMsg', 'Acesta este un mesaj de test.'),
    };
    var lang = 'ro';
    try { if (window.I18N && typeof I18N.get === 'function') lang = I18N.get(); } catch (e) {}
    gas('sendTemplatedEmail', [{ template_key: key, to_email: to, lang: lang, vars: sampleVars }]).then(function (d) {
      if (d && d.ok) toast(tt('etpl.sent', 'Teszt e-mail elküldve') + ': ' + to, 'ok');
      else toast((d && d.err) || 'Eroare', 'err');
    });
  }

  // Preset betöltése a kártya mezőibe (NEM ment automatikusan — a felhasználó áttekinti és menti).
  function applyPreset(i, pi) {
    var presets = (window.ETPL_PRESETS && window.ETPL_PRESETS[_items[i] && _items[i].key]) || [];
    var p = presets[pi];
    if (!p) return;
    function set(id, val) { var el = document.getElementById(id); if (el) el.value = val == null ? '' : val; }
    set('etSubRo_' + i, p.subject_ro);
    set('etSubHu_' + i, p.subject_hu);
    set('etBodyRo_' + i, p.body_ro);
    set('etBodyHu_' + i, p.body_hu);
    toast(tt('etpl.presetLoaded', 'Sablon betöltve — szabd testre és mentsd'), 'ok');
  }

  // 📧 Küldés valódi címzettnek — a közös dialógussal (templated-email.js),
  // a sablon kulcsára rögzítve. A felhasználó megadja a címzettet + változókat.
  function sendTo(i) {
    var key = _items[i] && _items[i].key;
    if (!key) return;
    if (typeof window.sendTemplatedEmailDialog !== 'function') { toast('—', 'err'); return; }
    window.sendTemplatedEmailDialog({ templateKey: key, keys: [key], title: keyLabel(key) });
  }

  return { mount: mount, save: save, test: test, applyPreset: applyPreset, sendTo: sendTo };
})();
