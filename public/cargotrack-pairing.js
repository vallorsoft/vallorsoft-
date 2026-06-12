// public/cargotrack-pairing.js  (a cargotrack-pairing.html-ből rendezve render-függvénnyé)
// Használat:  CargoTrackPairing.mount('konténerElemId')   — a fül/oldal megnyitásakor hívd.
//
// AUTO-FELISMERÉS: a CargoTrack a jármű nevében/plate mezőjében már kiírja a
// rendszámot. Ezt normalizáljuk (nagybetű, szóköz/kötőjel nélkül) és a még nem
// párosított járműveknél JAVASLATKÉNT előtöltjük — a felhasználónak csak jóvá
// kell hagynia (egyenként vagy a „Mind mentése" gombbal), és szabadon javíthatja.
(window.registerI18n||function(d){(window.__i18nQueue=window.__i18nQueue||[]).push(d);})({
  'gps.pair.title':       { hu: 'Járművek párosítása (CargoTrack)', ro: 'Asocierea vehiculelor (CargoTrack)' },
  'gps.pair.sub':         { hu: 'A CargoTrack-ból felismert rendszámokat előtöltöttük — ellenőrizd, szükség esetén javítsd, majd hagyd jóvá. A fuvarnál így a megfelelő autó helye jelenik meg.', ro: 'Numerele de înmatriculare recunoscute din CargoTrack au fost precompletate — verifică, corectează la nevoie, apoi confirmă. Astfel, la transport apare poziția vehiculului corect.' },
  'gps.pair.saveAll':     { hu: '✓ Mind mentése', ro: '✓ Salvează tot' },
  'gps.pair.saveAllN':    { hu: '✓ Mind mentése ({n})', ro: '✓ Salvează tot ({n})' },
  'gps.pair.colVehicle':  { hu: 'CargoTrack jármű', ro: 'Vehicul CargoTrack' },
  'gps.pair.colPlate':    { hu: 'Rendszám', ro: 'Număr de înmatriculare' },
  'gps.pair.loading':     { hu: 'Betöltés…', ro: 'Se încarcă…' },
  'gps.pair.errN':        { hu: 'Hiba ({n})', ro: 'Eroare ({n})' },
  'gps.pair.needPlate':   { hu: 'Adj meg rendszámot.', ro: 'Introdu un număr de înmatriculare.' },
  'gps.pair.noVehicles':  { hu: 'Nincs jármű a fiókban.', ro: 'Niciun vehicul în cont.' },
  'gps.pair.platePh':     { hu: 'pl. B104VLR', ro: 'ex. B104VLR' },
  'gps.pair.saveBtn':     { hu: 'Mentés', ro: 'Salvează' },
  'gps.pair.tagPaired':   { hu: '✓ Párosítva', ro: '✓ Asociat' },
  'gps.pair.tagSuggest':  { hu: '💡 Felismert javaslat', ro: '💡 Sugestie recunoscută' },
  'gps.pair.saving':      { hu: 'Mentés…', ro: 'Se salvează…' },
  'gps.pair.savedRow':    { hu: 'Mentve: {plate} → {name}', ro: 'Salvat: {plate} → {name}' },
  'gps.pair.recognized':  { hu: '{n} rendszámot felismertünk a CargoTrack-ból — ellenőrizd és mentsd.', ro: 'Am recunoscut {n} numere de înmatriculare din CargoTrack — verifică și salvează.' },
  'gps.pair.savedCount':  { hu: 'Mentve: {ok}.', ro: 'Salvat: {ok}.' },
  'gps.pair.savedCountFail': { hu: 'Mentve: {ok} · sikertelen: {fail}.', ro: 'Salvat: {ok} · eșuat: {fail}.' },
});
function T(k,v){return (typeof window.t==='function')?window.t(k,v):k;}
window.CargoTrackPairing = (function () {
  const STYLE = "\n  .ctp{max-width:680px;border:1px solid #e2e6ee;border-radius:12px;padding:16px;background:#fff}\n  .ctp-title{font-weight:600;font-size:16px}\n  .ctp-sub{font-size:13px;color:#6b7280;margin:2px 0 12px}\n  .ctp-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}\n  .ctp-msg{font-size:13px;min-height:18px;flex:1 1 auto}\n  .ctp-msg--ok{color:#1a7f37}.ctp-msg--err{color:#c0341a}\n  .ctp-saveall{font-size:13px;padding:8px 14px;border-radius:8px;border:1px solid #2563eb;background:#2563eb;color:#fff;cursor:pointer;font-weight:600;touch-action:manipulation}\n  .ctp-saveall[disabled]{opacity:.5;cursor:default}\n  .ctp-table{width:100%;border-collapse:collapse;font-size:14px}\n  .ctp-table th,.ctp-table td{text-align:left;padding:8px 6px;border-bottom:1px solid #eef1f6;vertical-align:middle}\n  .ctp-table th{font-size:12px;color:#6b7280;font-weight:600}\n  .ctp-name{font-weight:500}.ctp-id{font-size:11px;color:#9aa3b2;word-break:break-all}\n  .ctp-in{font-size:16px;padding:7px 9px;border:1px solid #d0d5dd;border-radius:8px;width:100%;max-width:160px;box-sizing:border-box}\n  .ctp-in--suggest{border-color:#f59e0b;background:#fffbeb}\n  .ctp-btn{font-size:13px;padding:7px 12px;border-radius:8px;border:1px solid #d0d5dd;background:#fff;cursor:pointer;touch-action:manipulation;white-space:nowrap}\n  .ctp-btn--ok{border-color:#2563eb;color:#2563eb}\n  .ctp-empty{color:#9aa3b2;text-align:center;padding:14px}\n  .ctp-tag{display:inline-block;font-size:11px;font-weight:600;padding:2px 7px;border-radius:999px;margin-top:4px}\n  .ctp-tag--paired{background:#e6f4ea;color:#1a7f37}\n  .ctp-tag--suggest{background:#fef3c7;color:#92600a}\n  .ctp-tick{color:#1a7f37;font-weight:700;margin-left:6px}\n  @media(max-width:520px){.ctp-table thead{display:none}.ctp-table td{display:block;border:none;padding:4px 0}.ctp-table tr{display:block;border-bottom:1px solid #eef1f6;padding:10px 0}.ctp-in{max-width:none}}\n";
  const MARKUP = "<div class=\"ctp\" id=\"ctPair\">\n  <div class=\"ctp-title\" data-i18n=\"gps.pair.title\">Járművek párosítása (CargoTrack)</div>\n  <div class=\"ctp-sub\" data-i18n=\"gps.pair.sub\">A CargoTrack-ból felismert rendszámokat előtöltöttük — ellenőrizd, szükség esetén javítsd, majd hagyd jóvá. A fuvarnál így a megfelelő autó helye jelenik meg.</div>\n  <div class=\"ctp-bar\">\n    <button class=\"ctp-saveall\" id=\"ctpSaveAll\" style=\"display:none\" data-i18n=\"gps.pair.saveAll\">✓ Mind mentése</button>\n    <div class=\"ctp-msg\" id=\"ctpMsg\"></div>\n  </div>\n  <table class=\"ctp-table\">\n    <thead><tr><th data-i18n=\"gps.pair.colVehicle\">CargoTrack jármű</th><th data-i18n=\"gps.pair.colPlate\">Rendszám</th><th></th></tr></thead>\n    <tbody id=\"ctpRows\"><tr><td colspan=\"3\" class=\"ctp-empty\" data-i18n=\"gps.pair.loading\">Betöltés…</td></tr></tbody>\n  </table>\n</div>";

  // Rendszám-normalizálás: nagybetű, csak betű/szám (szóköz, kötőjel, pont eltávolítva).
  // UGYANAZ a szabály, mint a szerver-oldali lib/plate.js normalizePlate-je (tesztelve).
  function normalizePlate(s) {
    return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function ensureStyle() {
    if (document.getElementById("cargotrack-pairing-style")) return;
    const s = document.createElement('style'); s.id = "cargotrack-pairing-style"; s.textContent = STYLE; document.head.appendChild(s);
  }
  function mount(target) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) { console.warn("cargotrack-pairing.js: nincs konténer"); return; }
    ensureStyle();
    el.innerHTML = MARKUP;
    if (window.I18N && typeof window.I18N.apply === 'function') { try { window.I18N.apply(el); } catch (e) {} }
    run(el);
  }
  function run(root) {
    const rowsEl = document.getElementById('ctpRows');
    const msgEl = document.getElementById('ctpMsg');
    const saveAllBtn = document.getElementById('ctpSaveAll');
    const setMsg = (t, k) => { msgEl.textContent = t || ''; msgEl.className = 'ctp-msg' + (k ? ' ctp-msg--' + k : ''); };
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

    async function api(method, url, body) {
      const res = await fetch(url, {
        method, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || T('gps.pair.errN', { n: res.status }));
      return d;
    }

    // Egy sor mentése. saved=true esetén "párosítva" állapotba vált.
    async function saveRow(ctx, opts) {
      const rendszam = ctx.input.value.trim().toUpperCase();
      if (!rendszam) { if (!opts || !opts.silent) setMsg(T('gps.pair.needPlate'), 'err'); return false; }
      ctx.input.value = rendszam;
      ctx.btn.disabled = true;
      try {
        await api('POST', '/api/integrations/cargotrack/map',
          { rendszam, object_id: ctx.o.object_id, object_name: ctx.o.name });
        ctx.input.classList.remove('ctp-in--suggest');
        ctx.setTag('paired');
        ctx.tick.style.display = '';
        ctx.suggested = false;
        return true;
      } catch (e) {
        if (!opts || !opts.silent) setMsg(e.message, 'err');
        return false;
      } finally { ctx.btn.disabled = false; }
    }

    function refreshSaveAll(contexts) {
      const pending = contexts.filter(c => c.suggested && c.input.value.trim());
      saveAllBtn.style.display = pending.length ? '' : 'none';
      saveAllBtn.textContent = T('gps.pair.saveAllN', { n: pending.length });
    }

    async function load() {
      try {
        const [objRes, mapRes] = await Promise.all([
          api('GET', '/api/integrations/cargotrack/objects'),
          api('GET', '/api/integrations/cargotrack/map'),
        ]);
        const mapped = {}; (mapRes.mappings || []).forEach(m => mapped[m.object_id] = m.rendszam);
        const objs = objRes.objects || [];
        if (!objs.length) { rowsEl.innerHTML = '<tr><td colspan="3" class="ctp-empty">' + T('gps.pair.noVehicles') + '</td></tr>'; return; }
        rowsEl.innerHTML = '';
        const contexts = [];
        let suggestCount = 0;

        objs.forEach(o => {
          const existing = mapped[o.object_id] || '';
          // Javaslat: a CargoTrack plate mezője, vagy a névből normalizált rendszám.
          const suggestion = normalizePlate(o.plate || o.name);
          const isSuggested = !existing && !!suggestion;
          if (isSuggested) suggestCount++;
          const value = existing || suggestion;
          const label = esc(o.name + (o.plate ? ' · ' + o.plate : ''));

          const tr = document.createElement('tr');
          tr.innerHTML =
            '<td><div class="ctp-name">' + label + '</div>' +
            '<div class="ctp-id">' + esc(o.object_id) + '</div>' +
            '<span class="ctp-tag"></span></td>' +
            '<td><input class="ctp-in' + (isSuggested ? ' ctp-in--suggest' : '') + '" placeholder="' + esc(T('gps.pair.platePh')) + '" value="' + esc(value) + '"></td>' +
            '<td><button class="ctp-btn ctp-btn--ok">' + T('gps.pair.saveBtn') + '</button><span class="ctp-tick" style="display:none">✓</span></td>';

          const tagEl = tr.querySelector('.ctp-tag');
          const setTag = (state) => {
            if (state === 'paired') { tagEl.className = 'ctp-tag ctp-tag--paired'; tagEl.textContent = T('gps.pair.tagPaired'); }
            else if (state === 'suggest') { tagEl.className = 'ctp-tag ctp-tag--suggest'; tagEl.textContent = T('gps.pair.tagSuggest'); }
            else { tagEl.className = 'ctp-tag'; tagEl.textContent = ''; }
          };
          setTag(existing ? 'paired' : (isSuggested ? 'suggest' : 'none'));

          const ctx = {
            o, suggested: isSuggested,
            input: tr.querySelector('input'),
            btn: tr.querySelector('button'),
            tick: tr.querySelector('.ctp-tick'),
            setTag,
          };
          // Ha a felhasználó javít a javaslaton, maradjon "menthető" állapotban.
          ctx.input.addEventListener('input', () => { ctx.tick.style.display = 'none'; });
          ctx.btn.addEventListener('click', async () => {
            setMsg(T('gps.pair.saving'));
            const ok = await saveRow(ctx);
            if (ok) { setMsg(T('gps.pair.savedRow', { plate: ctx.input.value, name: esc(o.name) }), 'ok'); refreshSaveAll(contexts); }
          });
          contexts.push(ctx);
          rowsEl.appendChild(tr);
        });

        if (suggestCount) {
          setMsg(T('gps.pair.recognized', { n: suggestCount }), 'ok');
        }
        refreshSaveAll(contexts);

        saveAllBtn.onclick = async () => {
          saveAllBtn.disabled = true;
          const pending = contexts.filter(c => c.suggested && c.input.value.trim());
          let ok = 0, fail = 0;
          for (const ctx of pending) {
            const r = await saveRow(ctx, { silent: true });
            if (r) ok++; else fail++;
          }
          setMsg(fail ? T('gps.pair.savedCountFail', { ok: ok, fail: fail }) : T('gps.pair.savedCount', { ok: ok }), fail ? 'err' : 'ok');
          refreshSaveAll(contexts);
          saveAllBtn.disabled = false;
        };
      } catch (e) {
        rowsEl.innerHTML = '<tr><td colspan="3" class="ctp-empty">' + esc(e.message) + '</td></tr>';
      }
    }
    load();
    // Nyelvváltáskor a dinamikusan renderelt sorokat újratöltjük (a statikus DOM-ot az i18n.js intézi).
    if (window.I18N && typeof window.I18N.onLang === 'function') {
      window.I18N.onLang(function () { if (document.getElementById('ctpRows')) load(); });
    }
  }
  return { mount };
})();
