// public/billing-card.js
// Univerzális számlázó-integráció kártya (Admin + Manager).
// Mount: BillingCard.mount('billingCardBox'). Igényli: gas(), toast(), esc() (console-shared.js).
window.BillingCard = (function () {
  var box, providers = [], current = null, selected = null, mode = 'view';
  var ACCENT = '#e10b1a';

  function esc2(s) { return (window.esc ? esc(s) : String(s == null ? '' : s)); }

  function mount(containerId) {
    box = document.getElementById(containerId);
    if (!box) return;
    mode = 'view'; selected = null;
    box.innerHTML = '<div class="text-muted" style="font-size:13px;">Betöltés...</div>';
    Promise.all([gas('getAvailableProviders'), gas('getCompanyBillingIntegration')]).then(function (r) {
      providers = r[0] || [];
      current = (r[1] && r[1].ok) ? r[1].integration : null;
      render();
    }).catch(function () { box.innerHTML = '<div style="color:var(--err);">Nem sikerült betölteni.</div>'; });
  }

  function render() {
    if (current && mode === 'view') return renderActive();
    if (mode === 'form') return renderForm();
    return renderChooser();
  }

  function head(title) {
    return '<div style="font-weight:800;font-size:15px;color:#fff;margin-bottom:4px;">💳 ' + title + '</div>';
  }

  function renderActive() {
    var d = current.created_at ? new Date(current.created_at).toLocaleDateString('hu-HU') : '—';
    box.innerHTML =
      '<div class="glass" style="padding:18px;border:1px solid rgba(34,197,94,0.35);">'
      + '<div style="font-weight:800;font-size:15px;color:#fff;">✅ ' + esc2(current.display_name) + ' — <span style="color:var(--ok);">Aktív</span></div>'
      + '<div class="text-muted" style="font-size:12px;margin:6px 0 14px;">Beállítva: ' + d + ' &nbsp;·&nbsp; Mezők: ' + (current.fields || []).map(esc2).join(', ') + '</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
      + '<button class="btn ghost" onclick="BillingCard._test()">🔌 Tesztelés</button>'
      + '<button class="btn primary" onclick="BillingCard._edit()">✏️ Módosítás</button>'
      + '<button class="btn ghost" onclick="BillingCard._switch()">🔄 Váltás más számlázóra</button>'
      + '</div><div id="bcMsg" style="margin-top:10px;font-size:13px;"></div></div>';
  }

  function renderChooser() {
    var grid = providers.map(function (p) {
      var sel = selected === p.provider;
      return '<button onclick="BillingCard._pick(\'' + p.provider + '\')" style="padding:14px 18px;border-radius:12px;cursor:pointer;font-weight:700;'
        + 'border:1px solid ' + (sel ? ACCENT : 'var(--border-bright)') + ';background:' + (sel ? 'rgba(225,11,26,0.12)' : 'rgba(255,255,255,0.03)') + ';color:' + (sel ? '#fff' : 'var(--soft)') + ';">'
        + esc2(p.display_name) + (sel ? ' ✓' : '') + '</button>';
    }).join('');
    box.innerHTML =
      '<div class="glass" style="padding:18px;">'
      + head('Számlázó integrálása')
      + '<div class="text-muted" style="font-size:12px;margin-bottom:14px;">Válassz számlázó szolgáltatót:</div>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">' + grid + '</div>'
      + '<button class="btn primary" ' + (selected ? '' : 'disabled') + ' onclick="BillingCard._next()">Tovább →</button>'
      + (current ? ' <button class="btn ghost" onclick="BillingCard._cancel()">Mégse</button>' : '')
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
      + head(esc2(p.display_name) + ' beállítása')
      + '<div style="margin-top:10px;">' + fields + '</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">'
      + '<button class="btn ghost" onclick="BillingCard._back()">← Vissza</button>'
      + '<button class="btn ghost" onclick="BillingCard._testForm()">🔌 Kapcsolat tesztelése</button>'
      + '<button class="btn primary" onclick="BillingCard._save()">💾 Mentés</button>'
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
    _pick: function (pr) { selected = pr; renderChooser(); },
    _next: function () { if (!selected) return; mode = 'form'; render(); },
    _back: function () { mode = current ? 'choose' : 'choose'; render(); },
    _cancel: function () { mode = 'view'; selected = null; render(); },
    _switch: function () { mode = 'choose'; selected = null; render(); },
    _edit: function () { selected = current.provider; mode = 'form'; render(); },
    _testForm: function () {
      var creds = _collect();
      _msg('<span class="text-muted">Tesztelés...</span>');
      gas('testBillingIntegration', [{ provider: selected, credentials: creds }]).then(function (r) {
        if (r && r.ok) _msg('<span style="color:var(--ok);font-weight:700;">✅ ' + esc2(r.message || 'Kapcsolat sikeres') + '</span>');
        else _msg('<span style="color:var(--err);font-weight:700;">❌ ' + esc2((r && r.message) || 'Hiba') + '</span>');
      });
    },
    _test: function () {
      _msg('<span class="text-muted">Tesztelés...</span>');
      gas('testBillingIntegration', [{ provider: current.provider }]).then(function (r) {
        if (r && r.ok) _msg('<span style="color:var(--ok);font-weight:700;">✅ ' + esc2(r.message || 'Kapcsolat sikeres') + '</span>');
        else _msg('<span style="color:var(--err);font-weight:700;">❌ ' + esc2((r && r.message) || 'Hiba') + '</span>');
      });
    },
    _save: function () {
      var creds = _collect();
      var empty = Object.keys(creds).every(function (k) { return !creds[k]; });
      if (empty) { _msg('<span style="color:var(--err);">Töltsd ki a mezőket!</span>'); return; }
      gas('saveBillingIntegration', [{ provider: selected, credentials: creds }]).then(function (r) {
        if (r && r.ok) { toast('Számlázó mentve!', 'ok'); mount(box.id); }
        else { _msg('<span style="color:var(--err);">' + esc2((r && r.err) || 'Mentési hiba') + '</span>'); }
      });
    },
  };
})();
