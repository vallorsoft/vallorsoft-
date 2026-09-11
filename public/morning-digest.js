// public/morning-digest.js — Reggeli összefoglaló beállítás UI.
// Ki/be kapcsoló + időpont + extra címzettek. Admin írhatja, Manager csak nézi.

(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m])); }
  // `window._vsCurrentPozicio` — az admin.js/manager.js `authMe()` callback-je
  // állítja be belépéskor ('Admin' vagy 'Manager'; a két oldal külön-külön
  // gate-eli a szerepet, tehát ott mindig a bejelentkezett user tényleges
  // szerepe). A morning-digest.js mindkét oldalon betöltődik, de csak az
  // Admin írhat.
  function _isAdmin() {
    return window._vsCurrentPozicio === 'Admin';
  }
  function _gas(fn, args) {
    return fetch('/api/execute', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ functionName: fn, arguments: args || [] }) })
      .then(r => r.json()).then(d => d.result);
  }

  window.loadMorningDigest = function () {
    const box = document.getElementById('morningDigestBox');
    if (!box) return;
    box.innerHTML = '<div class="glass" style="padding:22px;">' +
      '<h2 class="h-title" data-i18n="mdi.title">📧 Reggeli összefoglaló</h2>' +
      '<div class="h-sub" data-i18n="mdi.sub">Egy napi automatikus e-mail a fontos teendőkről (7:00-tól kezdve, beállítható).</div>' +
      '<div id="mdiBody" style="margin-top:14px;">' + (window.t ? t('common.loading') : 'Betöltés…') + '</div>' +
      '</div>';
    _gas('getMorningDigest').then(function (r) {
      if (!r || !r.ok) { document.getElementById('mdiBody').innerHTML = '<span style="color:#dc2626;">' + esc((r && r.err) || (window.t?t('common.error'):'Hiba')) + '</span>'; return; }
      _render(r);
    }).catch(function () {
      document.getElementById('mdiBody').innerHTML = '<span style="color:#dc2626;">' + (window.t?t('common.error'):'Hiba') + '</span>';
    });
  };

  function _render(state) {
    const admin = _isAdmin();
    const recips = Array.isArray(state.recipients) ? state.recipients.join('\n') : '';
    const time = state.time || '07:00';
    const enabled = !!state.enabled;
    const lastSent = state.last_sent_at ? new Date(state.last_sent_at).toLocaleString() : '—';
    const readonlyAttr = admin ? '' : ' disabled';
    document.getElementById('mdiBody').innerHTML =
      '<div style="display:flex;flex-direction:column;gap:14px;max-width:560px;">' +
        '<label style="display:flex;align-items:center;gap:10px;font-size:14px;font-weight:700;">' +
          '<input type="checkbox" id="mdiEnabled"' + (enabled ? ' checked' : '') + readonlyAttr + ' style="width:20px;height:20px;">' +
          '<span data-i18n="mdi.enabled">Reggeli összefoglaló aktív</span>' +
        '</label>' +
        '<div class="field"><label data-i18n="mdi.time">Küldési idő (HH:MM · Europe/Bucharest)</label>' +
          '<input class="input" id="mdiTime" type="time" value="' + esc(time) + '"' + readonlyAttr + ' style="max-width:160px;"></div>' +
        '<div class="field"><label data-i18n="mdi.recipients">Extra címzettek (soronként egy e-mail — a cég Admin/Manager userei automatikusan kapják)</label>' +
          '<textarea class="textarea" id="mdiRecipients" rows="3" placeholder="pl. konyvelo@ceg.ro"' + readonlyAttr + '>' + esc(recips) + '</textarea></div>' +
        '<div style="font-size:12px;color:var(--muted);">' +
          (window.t ? t('mdi.lastSent') : 'Utolsó küldés') + ': <b>' + esc(lastSent) + '</b>' +
        '</div>' +
        (admin
          ? '<div style="display:flex;gap:8px;">' +
              '<button type="button" class="btn primary" onclick="saveMorningDigest()">💾 <span data-i18n="common.save">Mentés</span></button>' +
            '</div>'
          : '<div style="font-size:12px;color:var(--muted);">' + (window.t?t('mdi.viewOnly'):'Csak Admin módosíthatja.') + '</div>') +
        '<div id="mdiStat" style="min-height:20px;font-size:13px;"></div>' +
      '</div>';
    if (window.I18N && I18N.apply) I18N.apply(document.getElementById('mdiBody'));
  }

  window.saveMorningDigest = function () {
    const enabled = document.getElementById('mdiEnabled').checked;
    const time = document.getElementById('mdiTime').value || '07:00';
    const raw = (document.getElementById('mdiRecipients').value || '').split(/[\n,;]/).map(s => s.trim()).filter(Boolean);
    const stat = document.getElementById('mdiStat');
    stat.textContent = window.t ? t('common.saving') : 'Mentés…';
    stat.style.color = 'var(--muted)';
    _gas('saveMorningDigest', [{ enabled, time, recipients: raw }]).then(function (r) {
      if (r && r.ok) { stat.textContent = (window.t?t('common.saved'):'Mentve') + ' ✓'; stat.style.color = '#16a34a'; }
      else { stat.textContent = (r && r.err) || (window.t?t('common.error'):'Hiba'); stat.style.color = '#dc2626'; }
    }).catch(function () { stat.textContent = window.t?t('common.error'):'Hiba'; stat.style.color = '#dc2626'; });
  };
})();
