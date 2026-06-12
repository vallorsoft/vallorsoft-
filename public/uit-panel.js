// public/uit-panel.js  —  RO e-Transport UIT-kezelő modal egy fuvarhoz.
// Globál: window.UitPanel.open(orderId, rendszam)
//  - egy fuvarhoz több UIT, egymás alatt
//  - kódonként: státusz-szimbólum (⏳ mentve / ✅ aktív / ⏹️ leállítva / ❌ hiba)
//    + „Küldés" és „Leállítás" gomb + törlés
(window.registerI18n||function(d){(window.__i18nQueue=window.__i18nQueue||[]).push(d);})({
  'uit.sym.new':       { hu: 'Mentve — küldés még nem indítva', ro: 'Salvat — trimiterea nu a fost încă pornită' },
  'uit.sym.active':    { hu: 'Küldés aktív (GPS → ANAF)', ro: 'Trimitere activă (GPS → ANAF)' },
  'uit.sym.stopped':   { hu: 'Küldés leállítva', ro: 'Trimitere oprită' },
  'uit.sym.error':     { hu: 'Hiba — lásd az üzenetet', ro: 'Eroare — vezi mesajul' },
  'uit.errN':          { hu: 'Hiba ({n})', ro: 'Eroare ({n})' },
  'uit.cs.title':      { hu: 'UIT / RO e-Transport — hamarosan', ro: 'UIT / RO e-Transport — în curând' },
  'uit.cs.body':       { hu: 'Ez a funkció fejlesztés alatt áll. Addig is kérjük, használd a GPS-szolgáltatód (pl. CargoTrack) saját e-Transport lehetőségét a UIT-kódok küldéséhez.', ro: 'Această funcție este în dezvoltare. Până atunci, te rugăm să folosești opțiunea e-Transport proprie a furnizorului tău GPS (ex. CargoTrack) pentru trimiterea codurilor UIT.' },
  'uit.cs.ok':         { hu: 'Rendben', ro: 'Am înțeles' },
  'uit.title':         { hu: '🚛 UIT-kódok — {id}', ro: '🚛 Coduri UIT — {id}' },
  'uit.vehicleLabel':  { hu: 'Jármű:', ro: 'Vehicul:' },
  'uit.subTail':       { hu: 'RO e-Transport. Egy fuvarhoz több UIT is rögzíthető.', ro: 'RO e-Transport. La un transport se pot înregistra mai multe coduri UIT.' },
  'uit.loading':       { hu: 'Betöltés…', ro: 'Se încarcă…' },
  'uit.newPh':         { hu: 'Új UIT-kód beírása…', ro: 'Introdu un cod UIT nou…' },
  'uit.saveBtn':       { hu: '+ Mentés', ro: '+ Salvează' },
  'uit.note':          { hu: 'A UIT-ot az ANAF adja a megbízó deklarációjára — ide a <b>kapott</b> kód kerül. A „Küldés" a kódot a jármű GPS-eszközéhez rendeli (ANAF felé); a transport végén „Leállítás".', ro: 'Codul UIT este emis de ANAF pe baza declarației beneficiarului — aici se introduce codul <b>primit</b>. „Trimite” asociază codul dispozitivului GPS al vehiculului (către ANAF); la finalul transportului „Oprește”.' },
  'uit.close':         { hu: 'Bezárás', ro: 'Închide' },
  'uit.empty':         { hu: 'Még nincs UIT-kód ehhez a fuvarhoz.', ro: 'Încă nu există coduri UIT pentru acest transport.' },
  'uit.btnStop':       { hu: 'Leállítás', ro: 'Oprește' },
  'uit.btnStart':      { hu: 'Küldés', ro: 'Trimite' },
  'uit.btnDelTitle':   { hu: 'Törlés', ro: 'Șterge' },
});
function T(k,v){return (typeof window.t==='function')?window.t(k,v):k;}
window.UitPanel = (function () {
  // ── FUNKCIÓ IDEIGLENESEN KIKAPCSOLVA ──
  // A teljes UIT/e-Transport pipeline kész és bent van; egyelőre csak a felület van letiltva.
  // Visszakapcsolás: állítsd window.UIT_COMING_SOON = false (itt és a sofer-uit.js-ben).
  window.UIT_COMING_SOON = true;

  const SYM = {
    new:     { i: '⏳', k: 'uit.sym.new',     c: '#fbbf24' },
    active:  { i: '✅', k: 'uit.sym.active',  c: '#4ade80' },
    stopped: { i: '⏹️', k: 'uit.sym.stopped', c: '#94a3b8' },
    error:   { i: '❌', k: 'uit.sym.error',   c: '#f87171' },
  };

  function ensureStyle() {
    if (document.getElementById('uit-style')) return;
    const s = document.createElement('style'); s.id = 'uit-style';
    s.textContent = `
      .uit-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}
      .uit-box{background:#0c1218;color:#e9eef5;border:1px solid rgba(255,255,255,.12);border-radius:14px;max-width:560px;width:100%;max-height:88vh;overflow:auto;padding:18px}
      .uit-h{display:flex;align-items:center;justify-content:space-between;margin:0 0 4px}
      .uit-h h3{margin:0;font-size:17px}
      .uit-sub{color:#9fb0c3;font-size:12px;margin:0 0 14px}
      .uit-row{display:flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:8px 10px;margin-bottom:8px;flex-wrap:wrap}
      .uit-sym{font-size:16px;width:22px;text-align:center}
      .uit-code{font-family:ui-monospace,monospace;font-weight:700;letter-spacing:.5px;flex:1;min-width:120px;word-break:break-all}
      .uit-msg{flex-basis:100%;font-size:11px;color:#9fb0c3;margin-left:30px}
      .uit-b{cursor:pointer;border:1px solid;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;background:transparent}
      .uit-b--go{color:#4ade80;border-color:rgba(34,197,94,.5)}
      .uit-b--stop{color:#fbbf24;border-color:rgba(245,158,11,.5)}
      .uit-b--del{color:#f87171;border-color:rgba(239,68,68,.5)}
      .uit-add{display:flex;gap:6px;margin-top:6px}
      .uit-in{flex:1;background:#070b10;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:9px 10px;color:#e9eef5;font-family:ui-monospace,monospace;text-transform:uppercase}
      .uit-save{cursor:pointer;background:#e10b1a;color:#fff;border:0;border-radius:8px;padding:9px 14px;font-weight:700}
      .uit-foot{display:flex;justify-content:flex-end;margin-top:14px}
      .uit-close{cursor:pointer;background:transparent;color:#9fb0c3;border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:8px 14px}
      .uit-note{font-size:11px;color:#9fb0c3;margin:10px 0 0;border-top:1px dashed rgba(255,255,255,.12);padding-top:10px}
      .uit-empty{color:#9fb0c3;font-size:13px;padding:6px 2px}`;
    document.head.appendChild(s);
  }

  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || T('uit.errN', { n: r.status }));
    return d;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

  function comingSoon() {
    ensureStyle();
    var ov = document.createElement('div'); ov.className = 'uit-ov';
    ov.innerHTML =
      '<div class="uit-box" style="max-width:420px;text-align:center;">' +
        '<div style="font-size:34px;margin-bottom:6px;">🚧</div>' +
        '<h3 style="margin:0 0 8px;">' + T('uit.cs.title') + '</h3>' +
        '<p style="color:#9fb0c3;font-size:14px;margin:0 0 16px;">' + T('uit.cs.body') + '</p>' +
        '<div class="uit-foot" style="justify-content:center;"><button class="uit-close" id="csOk">' + T('uit.cs.ok') + '</button></div>' +
      '</div>';
    document.body.appendChild(ov);
    var close = function () { ov.remove(); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#csOk').addEventListener('click', close);
  }

  function open(orderId, rendszam) {
    if (window.UIT_COMING_SOON) { comingSoon(); return; }
    ensureStyle();
    const ov = document.createElement('div'); ov.className = 'uit-ov';
    ov.innerHTML =
      '<div class="uit-box">' +
        '<div class="uit-h"><h3>' + T('uit.title', { id: esc(orderId) }) + '</h3></div>' +
        '<p class="uit-sub">' + T('uit.vehicleLabel') + ' <b>' + (esc(rendszam) || '—') + '</b> · ' + T('uit.subTail') + '</p>' +
        '<div id="uit-list"><div class="uit-empty">' + T('uit.loading') + '</div></div>' +
        '<div class="uit-add"><input class="uit-in" id="uit-new" placeholder="' + esc(T('uit.newPh')) + '"><button class="uit-save" id="uit-savebtn">' + T('uit.saveBtn') + '</button></div>' +
        '<p class="uit-note">' + T('uit.note') + '</p>' +
        '<div class="uit-foot"><button class="uit-close" id="uit-closebtn">' + T('uit.close') + '</button></div>' +
      '</div>';
    document.body.appendChild(ov);
    const $ = (id) => ov.querySelector('#' + id);
    const close = () => { ov.remove(); if (typeof window.__uitRefresh === 'function') window.__uitRefresh(); };
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    $('uit-closebtn').addEventListener('click', close);

    async function render() {
      let items = [];
      try { items = (await api('GET', '/api/orders/' + encodeURIComponent(orderId) + '/uit')).items || []; }
      catch (e) { $('uit-list').innerHTML = '<div class="uit-empty">' + esc(e.message) + '</div>'; return; }
      if (!items.length) { $('uit-list').innerHTML = '<div class="uit-empty">' + T('uit.empty') + '</div>'; return; }
      $('uit-list').innerHTML = items.map(function (u) {
        const sym = SYM[u.status] || SYM.new;
        return '<div class="uit-row" data-id="' + u.id + '">' +
          '<span class="uit-sym" title="' + esc(T(sym.k)) + '" style="color:' + sym.c + '">' + sym.i + '</span>' +
          '<span class="uit-code">' + esc(u.uit_code) + '</span>' +
          (u.status === 'active'
            ? '<button class="uit-b uit-b--stop" data-act="stop">' + T('uit.btnStop') + '</button>'
            : '<button class="uit-b uit-b--go" data-act="start">' + T('uit.btnStart') + '</button>') +
          '<button class="uit-b uit-b--del" data-act="del" title="' + esc(T('uit.btnDelTitle')) + '">✕</button>' +
          (u.last_message ? '<span class="uit-msg">' + esc(u.last_message) + '</span>' : '') +
        '</div>';
      }).join('');
      ov.querySelectorAll('.uit-row [data-act]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const row = btn.closest('.uit-row'); const id = row.dataset.id; const act = btn.dataset.act;
          btn.disabled = true;
          try {
            if (act === 'del') { await api('DELETE', '/api/uit/' + id); }
            else { await api('POST', '/api/uit/' + id + '/' + act); }
            await render();
          } catch (e) { alert(e.message); btn.disabled = false; }
        });
      });
    }

    async function add() {
      const code = $('uit-new').value.trim();
      if (!code) return;
      const b = $('uit-savebtn'); b.disabled = true;
      try {
        await api('POST', '/api/orders/' + encodeURIComponent(orderId) + '/uit', { uit_code: code, rendszam: rendszam });
        $('uit-new').value = ''; await render();
      } catch (e) { alert(e.message); }
      finally { b.disabled = false; }
    }
    $('uit-savebtn').addEventListener('click', add);
    $('uit-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    render();
  }

  return { open };
})();
