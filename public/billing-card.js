// public/billing-card.js
// Univerzális számlázó-integráció kártya (Admin + Manager).
// Mount: BillingCard.mount('billingCardBox'). Igényli: gas(), toast(), esc() (console-shared.js).
(window.registerI18n||function(d){(window.__i18nQueue=window.__i18nQueue||[]).push(d);})({
  'bil.bc.loading': { hu: 'Betöltés...', ro: 'Se încarcă...' },
  'bil.bc.loadFail': { hu: 'Nem sikerült betölteni.', ro: 'Încărcarea a eșuat.' },
  'bil.bc.subSub': { hu: 'VallorSoft előfizetés &amp; HERE-térkép számlázásához · <b>nem</b> a fuvar-számlázás', ro: 'Pentru facturarea abonamentului VallorSoft &amp; harta HERE · <b>nu</b> facturarea transporturilor' },
  'bil.bc.active': { hu: 'Aktív', ro: 'Activ' },
  'bil.bc.configuredAt': { hu: 'Beállítva:', ro: 'Configurat:' },
  'bil.bc.fields': { hu: 'Mezők:', ro: 'Câmpuri:' },
  'bil.bc.test': { hu: '🔌 Tesztelés', ro: '🔌 Testare' },
  'bil.bc.edit': { hu: '✏️ Módosítás', ro: '✏️ Modificare' },
  'bil.bc.switch': { hu: '🔄 Váltás más számlázóra', ro: '🔄 Schimbă furnizorul de facturare' },
  'bil.bc.integrateProvider': { hu: 'Számlázó integrálása', ro: 'Integrare furnizor de facturare' },
  'bil.bc.choose': { hu: 'Válassz számlázó szolgáltatót:', ro: 'Alege furnizorul de facturare:' },
  'bil.bc.next': { hu: 'Tovább →', ro: 'Continuă →' },
  'bil.bc.cancel': { hu: 'Mégse', ro: 'Anulează' },
  'bil.bc.setup': { hu: ' beállítása', ro: ' - configurare' },
  'bil.bc.back': { hu: '← Vissza', ro: '← Înapoi' },
  'bil.bc.testConn': { hu: '🔌 Kapcsolat tesztelése', ro: '🔌 Testează conexiunea' },
  'bil.bc.save': { hu: '💾 Mentés', ro: '💾 Salvează' },
  'bil.bc.testing': { hu: 'Tesztelés...', ro: 'Se testează...' },
  'bil.bc.connOk': { hu: 'Kapcsolat sikeres', ro: 'Conexiune reușită' },
  'bil.bc.err': { hu: 'Hiba', ro: 'Eroare' },
  'bil.bc.fillFields': { hu: 'Töltsd ki a mezőket!', ro: 'Completează câmpurile!' },
  'bil.bc.saved': { hu: 'Számlázó mentve!', ro: 'Furnizor salvat!' },
  'bil.bc.saveErr': { hu: 'Mentési hiba', ro: 'Eroare la salvare' }
});
function T(k,v){return (typeof window.t==='function')?window.t(k,v):k;}
window.BillingCard = (function () {
  var box, boxId = null, providers = [], current = null, selected = null, mode = 'view';
  var ACCENT = '#e10b1a';

  function esc2(s) { return (window.esc ? esc(s) : String(s == null ? '' : s)); }

  function mount(containerId) {
    box = document.getElementById(containerId);
    if (!box) return;
    boxId = containerId;
    mode = 'view'; selected = null;
    box.innerHTML = '<div class="text-muted" style="font-size:13px;">' + T('bil.bc.loading') + '</div>';
    Promise.all([gas('getAvailableProviders'), gas('getCompanyBillingIntegration')]).then(function (r) {
      providers = r[0] || [];
      current = (r[1] && r[1].ok) ? r[1].integration : null;
      render();
    }).catch(function () { box.innerHTML = '<div style="color:var(--err);">' + T('bil.bc.loadFail') + '</div>'; });
  }

  function render() {
    if (current && mode === 'view') return renderActive();
    if (mode === 'form') return renderForm();
    return renderChooser();
  }

  function head(title) {
    return '<div style="font-weight:800;font-size:15px;color:var(--text-primary);margin-bottom:2px;">💳 ' + title + '</div>'
      + '<div class="text-muted" style="font-size:11px;margin-bottom:10px;">' + T('bil.bc.subSub') + '</div>';
  }

  function renderActive() {
    var d = current.created_at ? new Date(current.created_at).toLocaleDateString('hu-HU') : '—';
    box.innerHTML =
      '<div class="glass" style="padding:18px;border:1px solid rgba(34,197,94,0.35);">'
      + '<div style="font-weight:800;font-size:15px;color:var(--text-primary);">✅ ' + esc2(current.display_name) + ' — <span style="color:var(--ok);">' + T('bil.bc.active') + '</span></div>'
      + '<div class="text-muted" style="font-size:11px;margin:2px 0 0;">' + T('bil.bc.subSub') + '</div>'
      + '<div class="text-muted" style="font-size:12px;margin:6px 0 14px;">' + T('bil.bc.configuredAt') + ' ' + d + ' &nbsp;·&nbsp; ' + T('bil.bc.fields') + ' ' + (current.fields || []).map(esc2).join(', ') + '</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
      + '<button class="btn ghost" onclick="BillingCard._test()">' + T('bil.bc.test') + '</button>'
      + '<button class="btn primary" onclick="BillingCard._edit()">' + T('bil.bc.edit') + '</button>'
      + '<button class="btn ghost" onclick="BillingCard._switch()">' + T('bil.bc.switch') + '</button>'
      + '</div><div id="bcMsg" style="margin-top:10px;font-size:13px;"></div></div>';
  }

  function renderChooser() {
    var grid = providers.map(function (p) {
      var sel = selected === p.provider;
      return '<button onclick="BillingCard._pick(\'' + p.provider + '\')" style="padding:14px 18px;border-radius:12px;cursor:pointer;font-weight:700;'
        + 'border:1px solid ' + (sel ? ACCENT : 'var(--border-bright)') + ';background:' + (sel ? 'rgba(225,11,26,0.12)' : 'rgba(255,255,255,0.03)') + ';color:' + (sel ? 'var(--text-primary)' : 'var(--text-muted)') + ';">'
        + esc2(p.display_name) + (sel ? ' ✓' : '') + '</button>';
    }).join('');
    box.innerHTML =
      '<div class="glass" style="padding:18px;">'
      + head(T('bil.bc.integrateProvider'))
      + '<div class="text-muted" style="font-size:12px;margin-bottom:14px;">' + T('bil.bc.choose') + '</div>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">' + grid + '</div>'
      + '<button class="btn primary" ' + (selected ? '' : 'disabled') + ' onclick="BillingCard._next()">' + T('bil.bc.next') + '</button>'
      + (current ? ' <button class="btn ghost" onclick="BillingCard._cancel()">' + T('bil.bc.cancel') + '</button>' : '')
      + '</div>';
  }

  function renderForm() {
    var p = providers.find(function (x) { return x.provider === selected; });
    if (!p) { mode = 'choose'; return render(); }
    var fields = p.fields.map(function (f) {
      var id = 'bc_' + f.key;
      if (f.type === 'select') {
        return '<div class="field"><label>' + esc2(f.label) + '</label><select class="select" id="' + id + '">'
          + (f.options || []).map(function (o) { return '<option value="' + esc2(o) + '">' + esc2(o) + '</option>'; }).join('') + '</select></div>';
      }
      var t = f.type === 'password' ? 'password' : 'text';
      return '<div class="field"><label>' + esc2(f.label) + '</label><input class="input" id="' + id + '" type="' + t + '" autocomplete="off"></div>';
    }).join('');
    box.innerHTML =
      '<div class="glass" style="padding:18px;">'
      + head(esc2(p.display_name) + T('bil.bc.setup'))
      + '<div style="margin-top:10px;">' + fields + '</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">'
      + '<button class="btn ghost" onclick="BillingCard._back()">' + T('bil.bc.back') + '</button>'
      + '<button class="btn ghost" onclick="BillingCard._testForm()">' + T('bil.bc.testConn') + '</button>'
      + '<button class="btn primary" onclick="BillingCard._save()">' + T('bil.bc.save') + '</button>'
      + '</div><div id="bcMsg" style="margin-top:10px;font-size:13px;"></div></div>';
  }

  function _collect() {
    var p = providers.find(function (x) { return x.provider === selected; });
    var creds = {};
    (p.fields || []).forEach(function (f) { var el = document.getElementById('bc_' + f.key); if (el) creds[f.key] = el.value.trim(); });
    return creds;
  }
  function _msg(html) { var m = document.getElementById('bcMsg'); if (m) m.innerHTML = html; }

  return {
    mount: mount,
    _relang: function () { if (boxId && document.getElementById(boxId)) mount(boxId); },
    _pick: function (pr) { selected = pr; renderChooser(); },
    _next: function () { if (!selected) return; mode = 'form'; render(); },
    _back: function () { mode = current ? 'choose' : 'choose'; render(); },
    _cancel: function () { mode = 'view'; selected = null; render(); },
    _switch: function () { mode = 'choose'; selected = null; render(); },
    _edit: function () { selected = current.provider; mode = 'form'; render(); },
    _testForm: function () {
      var creds = _collect();
      _msg('<span class="text-muted">' + T('bil.bc.testing') + '</span>');
      gas('testBillingIntegration', [{ provider: selected, credentials: creds }]).then(function (r) {
        if (r && r.ok) _msg('<span style="color:var(--ok);font-weight:700;">✅ ' + esc2(r.message || T('bil.bc.connOk')) + '</span>');
        else _msg('<span style="color:var(--err);font-weight:700;">❌ ' + esc2((r && r.message) || T('bil.bc.err')) + '</span>');
      });
    },
    _test: function () {
      _msg('<span class="text-muted">' + T('bil.bc.testing') + '</span>');
      gas('testBillingIntegration', [{ provider: current.provider }]).then(function (r) {
        if (r && r.ok) _msg('<span style="color:var(--ok);font-weight:700;">✅ ' + esc2(r.message || T('bil.bc.connOk')) + '</span>');
        else _msg('<span style="color:var(--err);font-weight:700;">❌ ' + esc2((r && r.message) || T('bil.bc.err')) + '</span>');
      });
    },
    _save: function () {
      var creds = _collect();
      var empty = Object.keys(creds).every(function (k) { return !creds[k]; });
      if (empty) { _msg('<span style="color:var(--err);">' + T('bil.bc.fillFields') + '</span>'); return; }
      gas('saveBillingIntegration', [{ provider: selected, credentials: creds }]).then(function (r) {
        if (r && r.ok) { toast(T('bil.bc.saved'), 'ok'); mount(box.id); }
        else { _msg('<span style="color:var(--err);">' + esc2((r && r.err) || T('bil.bc.saveErr')) + '</span>'); }
      });
    },
  };
})();
if (window.I18N && typeof window.I18N.onLang === 'function') {
  window.I18N.onLang(function () { if (window.BillingCard) window.BillingCard._relang(); });
}
