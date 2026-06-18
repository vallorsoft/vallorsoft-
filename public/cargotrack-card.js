// public/cargotrack-card.js  (a cargotrack-card.html-ből rendezve render-függvénnyé)
// Használat:  CargoTrackCard.mount('konténerElemId')   — a fül/oldal megnyitásakor hívd.
// Feliratok: RO-alap + HU-váltó az i18n-en (data-i18n a statikus szövegen + t() a
// dinamikus szövegeken); nyelvváltáskor a kártya újrarenderelődik
// (console-shared onLangChange → loadTab('integrations')).
window.CargoTrackCard = (function () {
  function L(k, v) { return (window.t ? window.t(k, v) : k); }
  const STYLE = "\n  .ct-card{border:1px solid #e2e6ee;border-radius:12px;padding:16px;max-width:560px;background:#fff;font-family:inherit}\n  .ct-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px}\n  .ct-title{font-weight:600;font-size:16px}\n  .ct-cat{font-size:11px;color:#5b6577;background:#eef1f6;border-radius:6px;padding:2px 6px;margin-left:6px;vertical-align:middle}\n  .ct-sub{font-size:13px;color:#6b7280;margin-top:2px}\n  .ct-badge{font-size:12px;font-weight:600;border-radius:999px;padding:4px 10px;white-space:nowrap}\n  .ct-badge--off{background:#eef1f6;color:#5b6577}\n  .ct-badge--ok{background:#e7f6ec;color:#1a7f37}\n  .ct-badge--err{background:#fdecec;color:#c0341a}\n  .ct-label{display:block;font-size:13px;color:#374151;margin-bottom:6px}\n  .ct-row{display:flex;gap:8px}\n  .ct-input{flex:1;font-size:16px;padding:9px 11px;border:1px solid #d0d5dd;border-radius:8px} /* 16px = nincs iOS auto-zoom */\n  .ct-msg{font-size:13px;margin-top:8px;min-height:18px}\n  .ct-msg--ok{color:#1a7f37}\n  .ct-msg--err{color:#c0341a}\n  .ct-actions{display:flex;gap:8px;margin-top:14px}\n  .ct-btn{font-size:14px;padding:9px 14px;border-radius:8px;border:1px solid transparent;cursor:pointer;touch-action:manipulation}\n  .ct-btn--primary{background:#f6711e;color:#fff}\n  .ct-btn--ghost{background:#fff;border-color:#d0d5dd;color:#374151}\n  .ct-btn--danger{background:#fff;border-color:#f0c2bb;color:#c0341a}\n  .ct-btn:active{transform:scale(.98);opacity:.9}\n  .ct-btn[disabled]{opacity:.5;cursor:default}\n";
  const MARKUP =
    '<div class="ct-card" id="ctCard">'
    + '<div class="ct-head">'
    + '<div>'
    + '<div class="ct-title">CargoTrack <span class="ct-cat" data-i18n="ctc.cat">GPS / Flotă</span></div>'
    + '<div class="ct-sub" data-i18n="ctc.sub">Poziția vehiculului și ruta la curse</div>'
    + '</div>'
    + '<span class="ct-badge ct-badge--off" id="ctBadge" data-i18n="ctc.badgeOff">Neconectat</span>'
    + '</div>'
    + '<div class="ct-body">'
    + '<label class="ct-label" for="ctKey" data-i18n="ctc.apiKey">Cheie API</label>'
    + '<div class="ct-row">'
    + '<input type="password" id="ctKey" class="ct-input" data-i18n-ph="ctc.keyPh" placeholder="Lipiți cheia API CargoTrack" autocomplete="off" />'
    + '<button type="button" class="ct-btn ct-btn--ghost" id="ctTest" data-i18n="ctc.testConn">Testare conexiune</button>'
    + '</div>'
    + '<div class="ct-msg" id="ctMsg"></div>'
    + '<div class="ct-actions">'
    + '<button type="button" class="ct-btn ct-btn--primary" id="ctSave" data-i18n="ctc.saveEnable">Salvează și activează</button>'
    + '<button type="button" class="ct-btn ct-btn--danger" id="ctDisconnect" data-i18n="ctc.disconnect" style="display:none">Deconectare</button>'
    + '</div>'
    + '<div style="margin-top:16px;border-top:1px solid #e2e6ee;padding-top:12px">'
    + '<div class="ct-title" style="font-size:14px"><span data-i18n="ctc.etTitle">RO e-Transport</span> <span class="ct-cat">UIT</span></div>'
    + '<div class="ct-sub" style="margin-bottom:8px" data-i18n="ctc.etHint">Pentru codurile UIT înregistrate la curse, transmitem poziția GPS către ANAF.</div>'
    + '<div class="ct-sub" style="margin-bottom:8px;color:#9a6b12;background:#fdf0d8;border-radius:8px;padding:7px 10px;" data-i18n="ctc.etSoon">🚧 În curând — această funcție este în dezvoltare. Până atunci folosiți opțiunea e-Transport a propriului furnizor GPS.</div>'
    + '<label class="ct-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;opacity:.5"><input type="checkbox" id="ctEtEnabled" disabled style="width:16px;height:16px"> <span data-i18n="ctc.etEnable">Activare trimitere GPS către ANAF</span></label>'
    + '<label class="ct-label" for="ctEtEnv" style="opacity:.5" data-i18n="ctc.env">Mediu</label>'
    + '<select id="ctEtEnv" class="ct-input" disabled style="flex:none;max-width:200px;opacity:.5"><option value="test" data-i18n="ctc.envTest">Test</option><option value="prod" data-i18n="ctc.envProd">Producție</option></select>'
    + '<div class="ct-actions"><button type="button" class="ct-btn ct-btn--ghost" id="ctEtSave" disabled style="opacity:.5" data-i18n="ctc.etSave">Salvează setarea e-Transport</button></div>'
    + '<div class="ct-msg" id="ctEtMsg"></div>'
    + '</div>'
    + '</div>'
    + '</div>';
  function ensureStyle() {
    if (document.getElementById("cargotrack-card-style")) return;
    const s = document.createElement('style'); s.id = "cargotrack-card-style"; s.textContent = STYLE; document.head.appendChild(s);
  }
  function mount(target) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) { console.warn("cargotrack-card.js: nincs konténer"); return; }
    ensureStyle();
    el.innerHTML = MARKUP;
    if (window.I18N && I18N.apply) I18N.apply(el);   // statikus data-i18n feloldása
    run(el);
  }
  function run(root) {

    (function () {
      const $ = (id) => document.getElementById(id);
      const keyEl = $('ctKey'), msgEl = $('ctMsg'), badge = $('ctBadge');
      const testBtn = $('ctTest'), saveBtn = $('ctSave'), disBtn = $('ctDisconnect');

      function setMsg(text, kind) { msgEl.textContent = text || ''; msgEl.className = 'ct-msg' + (kind ? ' ct-msg--' + kind : ''); }
      function setBadge(text, kind) { badge.textContent = text; badge.className = 'ct-badge ct-badge--' + kind; }
      function busy(on) { [testBtn, saveBtn, disBtn].forEach(b => b.disabled = on); }

      async function api(method, url, body) {
        const res = await fetch(url, {
          method, credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || (L('ctc.err') + ' (' + res.status + ')'));
        return data;
      }

      async function loadStatus() {
        try {
          const s = await api('GET', '/api/integrations/cargotrack');
          if (s.connected) {
            const count = s.meta && s.meta.objectCount != null ? ' · ' + s.meta.objectCount + ' ' + L('ctc.vehicles') : '';
            if (s.status === 'error') setBadge(L('ctc.badgeErr'), 'err');
            else setBadge(L('ctc.badgeOk') + count, 'ok');
            keyEl.placeholder = s.masked_key || L('ctc.savedKey');
            disBtn.style.display = '';
            saveBtn.textContent = L('ctc.changeKey');
          } else {
            setBadge(L('ctc.badgeOff'), 'off');
            disBtn.style.display = 'none';
          }
        } catch (e) { setMsg(e.message, 'err'); }
      }

      testBtn.addEventListener('click', async () => {
        const api_key = keyEl.value.trim();
        if (!api_key) return setMsg(L('ctc.testKeyFirst'), 'err');
        busy(true); setMsg(L('ctc.testing'));
        try {
          const r = await api('POST', '/api/integrations/cargotrack/test', { api_key });
          setMsg(L('ctc.connOkN', { n: r.objectCount }), 'ok');
        } catch (e) { setMsg(e.message, 'err'); }
        finally { busy(false); }
      });

      saveBtn.addEventListener('click', async () => {
        const api_key = keyEl.value.trim();
        if (!api_key) return setMsg(L('ctc.saveKeyFirst'), 'err');
        busy(true); setMsg(L('ctc.saving'));
        try {
          const r = await api('POST', '/api/integrations/cargotrack', { api_key, enabled: true });
          setMsg(L('ctc.savedN', { n: r.objectCount }), 'ok');
          keyEl.value = '';
          await loadStatus();
        } catch (e) { setMsg(e.message, 'err'); }
        finally { busy(false); }
      });

      disBtn.addEventListener('click', async () => {
        if (!confirm(L('ctc.disconnectConfirm'))) return;
        busy(true); setMsg(L('ctc.disconnecting'));
        try {
          await api('DELETE', '/api/integrations/cargotrack');
          keyEl.value = ''; keyEl.placeholder = L('ctc.keyPh');
          setMsg(L('ctc.disconnected'), 'ok');
          await loadStatus();
        } catch (e) { setMsg(e.message, 'err'); }
        finally { busy(false); }
      });

      // ── RO e-Transport beállítás ──
      const etEnabled = $('ctEtEnabled'), etEnv = $('ctEtEnv'), etSave = $('ctEtSave'), etMsg = $('ctEtMsg');
      async function loadEt() {
        try {
          const s = await api('GET', '/api/integrations/cargotrack');
          const et = (s.meta && s.meta.etransport) || {};
          etEnabled.checked = et.enabled === true;
          etEnv.value = et.environment === 'prod' ? 'prod' : 'test';
        } catch (e) { /* a fő státusz úgyis jelzi */ }
      }
      etSave.addEventListener('click', async () => {
        etMsg.textContent = L('ctc.etSaving'); etMsg.className = 'ct-msg';
        try {
          await api('POST', '/api/integrations/cargotrack/etransport', { enabled: etEnabled.checked, environment: etEnv.value });
          etMsg.textContent = L('ctc.etSaved'); etMsg.className = 'ct-msg ct-msg--ok';
        } catch (e) { etMsg.textContent = e.message; etMsg.className = 'ct-msg ct-msg--err'; }
      });
      loadEt();

      loadStatus();
    })();

  }
  return { mount };
})();
