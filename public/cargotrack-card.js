// public/cargotrack-card.js  (a cargotrack-card.html-ből rendezve render-függvénnyé)
// Használat:  CargoTrackCard.mount('konténerElemId')   — a fül/oldal megnyitásakor hívd.
(window.registerI18n||function(d){(window.__i18nQueue=window.__i18nQueue||[]).push(d);})({
  'gps.card.subtitle':      { hu: 'Jármű pozíció és útvonal a fuvaroknál', ro: 'Poziția și ruta vehiculului la transporturi' },
  'gps.card.notConnected':  { hu: 'Nincs csatlakoztatva', ro: 'Neconectat' },
  'gps.card.apiKey':        { hu: 'API-kulcs', ro: 'Cheie API' },
  'gps.card.keyPlaceholder':{ hu: 'Illeszd be a CargoTrack API-kulcsot', ro: 'Lipește cheia API CargoTrack' },
  'gps.card.testBtn':       { hu: 'Kapcsolat tesztelése', ro: 'Testează conexiunea' },
  'gps.card.saveBtn':       { hu: 'Mentés és bekapcsolás', ro: 'Salvează și activează' },
  'gps.card.disconnect':    { hu: 'Szétkapcsolás', ro: 'Deconectare' },
  'gps.card.etTitle':       { hu: 'RO e-Transport', ro: 'RO e-Transport' },
  'gps.card.etDesc':        { hu: 'A fuvaroknál rögzített UIT-kódokhoz a GPS-pozíciót az ANAF felé továbbítjuk.', ro: 'Pentru codurile UIT înregistrate la transporturi, poziția GPS este transmisă către ANAF.' },
  'gps.card.etSoon':        { hu: '🚧 Hamarosan — ez a funkció fejlesztés alatt áll. Addig is használd a GPS-szolgáltatód saját e-Transport lehetőségét.', ro: '🚧 În curând — această funcție este în dezvoltare. Până atunci, folosește opțiunea e-Transport proprie a furnizorului tău GPS.' },
  'gps.card.etEnable':      { hu: 'GPS-küldés ANAF felé bekapcsolása', ro: 'Activează trimiterea GPS către ANAF' },
  'gps.card.etEnv':         { hu: 'Környezet', ro: 'Mediu' },
  'gps.card.envTest':       { hu: 'Teszt', ro: 'Test' },
  'gps.card.envProd':       { hu: 'Éles', ro: 'Producție' },
  'gps.card.etSaveBtn':     { hu: 'e-Transport beállítás mentése', ro: 'Salvează setarea e-Transport' },
  'gps.card.err':           { hu: 'Hiba', ro: 'Eroare' },
  'gps.card.errN':          { hu: 'Hiba ({n})', ro: 'Eroare ({n})' },
  'gps.card.vehiclesSuffix':{ hu: ' jármű', ro: ' vehicule' },
  'gps.card.connected':     { hu: 'Csatlakoztatva', ro: 'Conectat' },
  'gps.card.savedKey':      { hu: 'Mentett kulcs', ro: 'Cheie salvată' },
  'gps.card.replaceKey':    { hu: 'Kulcs cseréje', ro: 'Schimbă cheia' },
  'gps.card.typeKeyTest':   { hu: 'Írd be a kulcsot a teszthez.', ro: 'Introdu cheia pentru testare.' },
  'gps.card.testing':       { hu: 'Tesztelés…', ro: 'Se testează…' },
  'gps.card.testOk':        { hu: 'Sikeres kapcsolat — {n} jármű elérhető.', ro: 'Conexiune reușită — {n} vehicule disponibile.' },
  'gps.card.typeKeySave':   { hu: 'Írd be a kulcsot a mentéshez.', ro: 'Introdu cheia pentru salvare.' },
  'gps.card.saving':        { hu: 'Mentés…', ro: 'Se salvează…' },
  'gps.card.saveOk':        { hu: 'Elmentve és bekapcsolva — {n} jármű.', ro: 'Salvat și activat — {n} vehicule.' },
  'gps.card.disconnectConfirm': { hu: 'Biztosan szétkapcsolod a CargoTrack-et? A tárolt kulcs törlődik.', ro: 'Sigur deconectezi CargoTrack? Cheia salvată va fi ștearsă.' },
  'gps.card.disconnecting': { hu: 'Szétkapcsolás…', ro: 'Se deconectează…' },
  'gps.card.disconnected':  { hu: 'Szétkapcsolva.', ro: 'Deconectat.' },
  'gps.card.etSaveOk':      { hu: 'e-Transport beállítás elmentve.', ro: 'Setarea e-Transport a fost salvată.' },
});
function T(k,v){return (typeof window.t==='function')?window.t(k,v):k;}
window.CargoTrackCard = (function () {
  const STYLE = "\n  .ct-card{border:1px solid #e2e6ee;border-radius:12px;padding:16px;max-width:560px;background:#fff;font-family:inherit}\n  .ct-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px}\n  .ct-title{font-weight:600;font-size:16px}\n  .ct-cat{font-size:11px;color:#5b6577;background:#eef1f6;border-radius:6px;padding:2px 6px;margin-left:6px;vertical-align:middle}\n  .ct-sub{font-size:13px;color:#6b7280;margin-top:2px}\n  .ct-badge{font-size:12px;font-weight:600;border-radius:999px;padding:4px 10px;white-space:nowrap}\n  .ct-badge--off{background:#eef1f6;color:#5b6577}\n  .ct-badge--ok{background:#e7f6ec;color:#1a7f37}\n  .ct-badge--err{background:#fdecec;color:#c0341a}\n  .ct-label{display:block;font-size:13px;color:#374151;margin-bottom:6px}\n  .ct-row{display:flex;gap:8px}\n  .ct-input{flex:1;font-size:16px;padding:9px 11px;border:1px solid #d0d5dd;border-radius:8px} /* 16px = nincs iOS auto-zoom */\n  .ct-msg{font-size:13px;margin-top:8px;min-height:18px}\n  .ct-msg--ok{color:#1a7f37}\n  .ct-msg--err{color:#c0341a}\n  .ct-actions{display:flex;gap:8px;margin-top:14px}\n  .ct-btn{font-size:14px;padding:9px 14px;border-radius:8px;border:1px solid transparent;cursor:pointer;touch-action:manipulation}\n  .ct-btn--primary{background:#2563eb;color:#fff}\n  .ct-btn--ghost{background:#fff;border-color:#d0d5dd;color:#374151}\n  .ct-btn--danger{background:#fff;border-color:#f0c2bb;color:#c0341a}\n  .ct-btn:active{transform:scale(.98);opacity:.9}\n  .ct-btn[disabled]{opacity:.5;cursor:default}\n";
  const MARKUP = "<!-- Önálló kártya az \"Integrációk\" fülre. Vanilla JS, fetch-csel a cargotrack-routes végpontjaihoz. -->\n<!-- Másold be az Integrációk fül \"GPS / Flotta\" kategóriájába. A stílus felülírható a ti style.css-etekből. -->\n\n<div class=\"ct-card\" id=\"ctCard\">\n  <div class=\"ct-head\">\n    <div>\n      <div class=\"ct-title\">CargoTrack <span class=\"ct-cat\">GPS / Flotta</span></div>\n      <div class=\"ct-sub\" data-i18n=\"gps.card.subtitle\">Jármű pozíció és útvonal a fuvaroknál</div>\n    </div>\n    <span class=\"ct-badge ct-badge--off\" id=\"ctBadge\" data-i18n=\"gps.card.notConnected\">Nincs csatlakoztatva</span>\n  </div>\n\n  <div class=\"ct-body\">\n    <label class=\"ct-label\" for=\"ctKey\" data-i18n=\"gps.card.apiKey\">API-kulcs</label>\n    <div class=\"ct-row\">\n      <input type=\"password\" id=\"ctKey\" class=\"ct-input\" placeholder=\"Illeszd be a CargoTrack API-kulcsot\" data-i18n-ph=\"gps.card.keyPlaceholder\" autocomplete=\"off\" />\n      <button type=\"button\" class=\"ct-btn ct-btn--ghost\" id=\"ctTest\" data-i18n=\"gps.card.testBtn\">Kapcsolat tesztelése</button>\n    </div>\n    <div class=\"ct-msg\" id=\"ctMsg\"></div>\n\n    <div class=\"ct-actions\">\n      <button type=\"button\" class=\"ct-btn ct-btn--primary\" id=\"ctSave\" data-i18n=\"gps.card.saveBtn\">Mentés és bekapcsolás</button>\n      <button type=\"button\" class=\"ct-btn ct-btn--danger\" id=\"ctDisconnect\" style=\"display:none\" data-i18n=\"gps.card.disconnect\">Szétkapcsolás</button>\n    </div>\n\n    <div style=\"margin-top:16px;border-top:1px solid #e2e6ee;padding-top:12px\">\n      <div class=\"ct-title\" style=\"font-size:14px\"><span data-i18n=\"gps.card.etTitle\">RO e-Transport</span> <span class=\"ct-cat\">UIT</span></div>\n      <div class=\"ct-sub\" style=\"margin-bottom:8px\" data-i18n=\"gps.card.etDesc\">A fuvaroknál rögzített UIT-kódokhoz a GPS-pozíciót az ANAF felé továbbítjuk.</div>\n      <div class=\"ct-sub\" style=\"margin-bottom:8px;color:#9a6b12;background:#fdf0d8;border-radius:8px;padding:7px 10px;\" data-i18n=\"gps.card.etSoon\">🚧 Hamarosan — ez a funkció fejlesztés alatt áll. Addig is használd a GPS-szolgáltatód saját e-Transport lehetőségét.</div>\n      <label class=\"ct-label\" style=\"display:flex;align-items:center;gap:8px;cursor:pointer;opacity:.5\"><input type=\"checkbox\" id=\"ctEtEnabled\" disabled style=\"width:16px;height:16px\"> <span data-i18n=\"gps.card.etEnable\">GPS-küldés ANAF felé bekapcsolása</span></label>\n      <label class=\"ct-label\" for=\"ctEtEnv\" style=\"opacity:.5\" data-i18n=\"gps.card.etEnv\">Környezet</label>\n      <select id=\"ctEtEnv\" class=\"ct-input\" disabled style=\"flex:none;max-width:200px;opacity:.5\"><option value=\"test\" data-i18n=\"gps.card.envTest\">Teszt</option><option value=\"prod\" data-i18n=\"gps.card.envProd\">Éles</option></select>\n      <div class=\"ct-actions\"><button type=\"button\" class=\"ct-btn ct-btn--ghost\" id=\"ctEtSave\" disabled style=\"opacity:.5\" data-i18n=\"gps.card.etSaveBtn\">e-Transport beállítás mentése</button></div>\n      <div class=\"ct-msg\" id=\"ctEtMsg\"></div>\n    </div>\n  </div>\n</div>";
  function ensureStyle() {
    if (document.getElementById("cargotrack-card-style")) return;
    const s = document.createElement('style'); s.id = "cargotrack-card-style"; s.textContent = STYLE; document.head.appendChild(s);
  }
  function mount(target) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) { console.warn("cargotrack-card.js: nincs konténer"); return; }
    ensureStyle();
    el.innerHTML = MARKUP;
    if (window.I18N && typeof window.I18N.apply === 'function') { try { window.I18N.apply(el); } catch (e) {} }
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
        if (!res.ok) throw new Error(data.error || T('gps.card.errN', { n: res.status }));
        return data;
      }

      async function loadStatus() {
        try {
          const s = await api('GET', '/api/integrations/cargotrack');
          if (s.connected) {
            const count = s.meta && s.meta.objectCount != null ? (' · ' + s.meta.objectCount + T('gps.card.vehiclesSuffix')) : '';
            if (s.status === 'error') setBadge(T('gps.card.err'), 'err');
            else setBadge(T('gps.card.connected') + count, 'ok');
            keyEl.placeholder = s.masked_key || T('gps.card.savedKey');
            disBtn.style.display = '';
            saveBtn.textContent = T('gps.card.replaceKey');
          } else {
            setBadge(T('gps.card.notConnected'), 'off');
            disBtn.style.display = 'none';
          }
        } catch (e) { setMsg(e.message, 'err'); }
      }

      testBtn.addEventListener('click', async () => {
        const api_key = keyEl.value.trim();
        if (!api_key) return setMsg(T('gps.card.typeKeyTest'), 'err');
        busy(true); setMsg(T('gps.card.testing'));
        try {
          const r = await api('POST', '/api/integrations/cargotrack/test', { api_key });
          setMsg(T('gps.card.testOk', { n: r.objectCount }), 'ok');
        } catch (e) { setMsg(e.message, 'err'); }
        finally { busy(false); }
      });

      saveBtn.addEventListener('click', async () => {
        const api_key = keyEl.value.trim();
        if (!api_key) return setMsg(T('gps.card.typeKeySave'), 'err');
        busy(true); setMsg(T('gps.card.saving'));
        try {
          const r = await api('POST', '/api/integrations/cargotrack', { api_key, enabled: true });
          setMsg(T('gps.card.saveOk', { n: r.objectCount }), 'ok');
          keyEl.value = '';
          await loadStatus();
        } catch (e) { setMsg(e.message, 'err'); }
        finally { busy(false); }
      });

      disBtn.addEventListener('click', async () => {
        if (!confirm(T('gps.card.disconnectConfirm'))) return;
        busy(true); setMsg(T('gps.card.disconnecting'));
        try {
          await api('DELETE', '/api/integrations/cargotrack');
          keyEl.value = ''; keyEl.placeholder = T('gps.card.keyPlaceholder');
          setMsg(T('gps.card.disconnected'), 'ok');
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
        etMsg.textContent = T('gps.card.saving'); etMsg.className = 'ct-msg';
        try {
          await api('POST', '/api/integrations/cargotrack/etransport', { enabled: etEnabled.checked, environment: etEnv.value });
          etMsg.textContent = T('gps.card.etSaveOk'); etMsg.className = 'ct-msg ct-msg--ok';
        } catch (e) { etMsg.textContent = e.message; etMsg.className = 'ct-msg ct-msg--err'; }
      });
      loadEt();

      loadStatus();

      // Nyelvváltáskor: statikus DOM-ot az i18n.js intézi, a dinamikus badge/gomb-feliratot újratöltjük.
      if (window.I18N && typeof window.I18N.onLang === 'function') {
        window.I18N.onLang(function () { if (document.getElementById('ctBadge')) loadStatus(); });
      }
    })();
    
  }
  return { mount };
})();
