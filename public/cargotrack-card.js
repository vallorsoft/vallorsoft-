// public/cargotrack-card.js  (a cargotrack-card.html-ből rendezve render-függvénnyé)
// Használat:  CargoTrackCard.mount('konténerElemId')   — a fül/oldal megnyitásakor hívd.
window.CargoTrackCard = (function () {
  const STYLE = "\n  .ct-card{border:1px solid #e2e6ee;border-radius:12px;padding:16px;max-width:560px;background:#fff;font-family:inherit}\n  .ct-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px}\n  .ct-title{font-weight:600;font-size:16px}\n  .ct-cat{font-size:11px;color:#5b6577;background:#eef1f6;border-radius:6px;padding:2px 6px;margin-left:6px;vertical-align:middle}\n  .ct-sub{font-size:13px;color:#6b7280;margin-top:2px}\n  .ct-badge{font-size:12px;font-weight:600;border-radius:999px;padding:4px 10px;white-space:nowrap}\n  .ct-badge--off{background:#eef1f6;color:#5b6577}\n  .ct-badge--ok{background:#e7f6ec;color:#1a7f37}\n  .ct-badge--err{background:#fdecec;color:#c0341a}\n  .ct-label{display:block;font-size:13px;color:#374151;margin-bottom:6px}\n  .ct-row{display:flex;gap:8px}\n  .ct-input{flex:1;font-size:16px;padding:9px 11px;border:1px solid #d0d5dd;border-radius:8px} /* 16px = nincs iOS auto-zoom */\n  .ct-msg{font-size:13px;margin-top:8px;min-height:18px}\n  .ct-msg--ok{color:#1a7f37}\n  .ct-msg--err{color:#c0341a}\n  .ct-actions{display:flex;gap:8px;margin-top:14px}\n  .ct-btn{font-size:14px;padding:9px 14px;border-radius:8px;border:1px solid transparent;cursor:pointer;touch-action:manipulation}\n  .ct-btn--primary{background:#2563eb;color:#fff}\n  .ct-btn--ghost{background:#fff;border-color:#d0d5dd;color:#374151}\n  .ct-btn--danger{background:#fff;border-color:#f0c2bb;color:#c0341a}\n  .ct-btn:active{transform:scale(.98);opacity:.9}\n  .ct-btn[disabled]{opacity:.5;cursor:default}\n";
  const MARKUP = "<!-- Önálló kártya az \"Integrációk\" fülre. Vanilla JS, fetch-csel a cargotrack-routes végpontjaihoz. -->\n<!-- Másold be az Integrációk fül \"GPS / Flotta\" kategóriájába. A stílus felülírható a ti style.css-etekből. -->\n\n<div class=\"ct-card\" id=\"ctCard\">\n  <div class=\"ct-head\">\n    <div>\n      <div class=\"ct-title\">CargoTrack <span class=\"ct-cat\">GPS / Flotta</span></div>\n      <div class=\"ct-sub\">Jármű pozíció és útvonal a fuvaroknál</div>\n    </div>\n    <span class=\"ct-badge ct-badge--off\" id=\"ctBadge\">Nincs csatlakoztatva</span>\n  </div>\n\n  <div class=\"ct-body\">\n    <label class=\"ct-label\" for=\"ctKey\">API-kulcs</label>\n    <div class=\"ct-row\">\n      <input type=\"password\" id=\"ctKey\" class=\"ct-input\" placeholder=\"Illeszd be a CargoTrack API-kulcsot\" autocomplete=\"off\" />\n      <button type=\"button\" class=\"ct-btn ct-btn--ghost\" id=\"ctTest\">Kapcsolat tesztelése</button>\n    </div>\n    <div class=\"ct-msg\" id=\"ctMsg\"></div>\n\n    <div class=\"ct-actions\">\n      <button type=\"button\" class=\"ct-btn ct-btn--primary\" id=\"ctSave\">Mentés és bekapcsolás</button>\n      <button type=\"button\" class=\"ct-btn ct-btn--danger\" id=\"ctDisconnect\" style=\"display:none\">Szétkapcsolás</button>\n    </div>\n\n    <div style=\"margin-top:16px;border-top:1px solid #e2e6ee;padding-top:12px\">\n      <div class=\"ct-title\" style=\"font-size:14px\">RO e-Transport <span class=\"ct-cat\">UIT</span></div>\n      <div class=\"ct-sub\" style=\"margin-bottom:8px\">A fuvaroknál rögzített UIT-kódokhoz a GPS-pozíciót az ANAF felé továbbítjuk.</div>\n      <div class=\"ct-sub\" style=\"margin-bottom:8px;color:#9a6b12;background:#fdf0d8;border-radius:8px;padding:7px 10px;\">🚧 Hamarosan — ez a funkció fejlesztés alatt áll. Addig is használd a GPS-szolgáltatód saját e-Transport lehetőségét.</div>\n      <label class=\"ct-label\" style=\"display:flex;align-items:center;gap:8px;cursor:pointer;opacity:.5\"><input type=\"checkbox\" id=\"ctEtEnabled\" disabled style=\"width:16px;height:16px\"> GPS-küldés ANAF felé bekapcsolása</label>\n      <label class=\"ct-label\" for=\"ctEtEnv\" style=\"opacity:.5\">Környezet</label>\n      <select id=\"ctEtEnv\" class=\"ct-input\" disabled style=\"flex:none;max-width:200px;opacity:.5\"><option value=\"test\">Teszt</option><option value=\"prod\">Éles</option></select>\n      <div class=\"ct-actions\"><button type=\"button\" class=\"ct-btn ct-btn--ghost\" id=\"ctEtSave\" disabled style=\"opacity:.5\">e-Transport beállítás mentése</button></div>\n      <div class=\"ct-msg\" id=\"ctEtMsg\"></div>\n    </div>\n  </div>\n</div>";
  function ensureStyle() {
    if (document.getElementById("cargotrack-card-style")) return;
    const s = document.createElement('style'); s.id = "cargotrack-card-style"; s.textContent = STYLE; document.head.appendChild(s);
  }
  function mount(target) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) { console.warn("cargotrack-card.js: nincs konténer"); return; }
    ensureStyle();
    el.innerHTML = MARKUP;
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
        if (!res.ok) throw new Error(data.error || ('Hiba (' + res.status + ')'));
        return data;
      }
    
      async function loadStatus() {
        try {
          const s = await api('GET', '/api/integrations/cargotrack');
          if (s.connected) {
            const count = s.meta && s.meta.objectCount != null ? ` · ${s.meta.objectCount} jármű` : '';
            if (s.status === 'error') setBadge('Hiba', 'err');
            else setBadge('Csatlakoztatva' + count, 'ok');
            keyEl.placeholder = s.masked_key || 'Mentett kulcs';
            disBtn.style.display = '';
            saveBtn.textContent = 'Kulcs cseréje';
          } else {
            setBadge('Nincs csatlakoztatva', 'off');
            disBtn.style.display = 'none';
          }
        } catch (e) { setMsg(e.message, 'err'); }
      }
    
      testBtn.addEventListener('click', async () => {
        const api_key = keyEl.value.trim();
        if (!api_key) return setMsg('Írd be a kulcsot a teszthez.', 'err');
        busy(true); setMsg('Tesztelés…');
        try {
          const r = await api('POST', '/api/integrations/cargotrack/test', { api_key });
          setMsg(`Sikeres kapcsolat — ${r.objectCount} jármű elérhető.`, 'ok');
        } catch (e) { setMsg(e.message, 'err'); }
        finally { busy(false); }
      });
    
      saveBtn.addEventListener('click', async () => {
        const api_key = keyEl.value.trim();
        if (!api_key) return setMsg('Írd be a kulcsot a mentéshez.', 'err');
        busy(true); setMsg('Mentés…');
        try {
          const r = await api('POST', '/api/integrations/cargotrack', { api_key, enabled: true });
          setMsg(`Elmentve és bekapcsolva — ${r.objectCount} jármű.`, 'ok');
          keyEl.value = '';
          await loadStatus();
        } catch (e) { setMsg(e.message, 'err'); }
        finally { busy(false); }
      });
    
      disBtn.addEventListener('click', async () => {
        if (!confirm('Biztosan szétkapcsolod a CargoTrack-et? A tárolt kulcs törlődik.')) return;
        busy(true); setMsg('Szétkapcsolás…');
        try {
          await api('DELETE', '/api/integrations/cargotrack');
          keyEl.value = ''; keyEl.placeholder = 'Illeszd be a CargoTrack API-kulcsot';
          setMsg('Szétkapcsolva.', 'ok');
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
        etMsg.textContent = 'Mentés…'; etMsg.className = 'ct-msg';
        try {
          await api('POST', '/api/integrations/cargotrack/etransport', { enabled: etEnabled.checked, environment: etEnv.value });
          etMsg.textContent = 'e-Transport beállítás elmentve.'; etMsg.className = 'ct-msg ct-msg--ok';
        } catch (e) { etMsg.textContent = e.message; etMsg.className = 'ct-msg ct-msg--err'; }
      });
      loadEt();

      loadStatus();
    })();
    
  }
  return { mount };
})();
