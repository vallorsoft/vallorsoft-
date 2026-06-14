// public/uit-panel.js  —  RO e-Transport UIT-kezelő modal egy fuvarhoz (admin/manager).
// Globál: window.UitPanel.open(orderId, rendszam)
//  - a UIT-ügyintézést a GPS-szolgáltató saját portálján (deep-link) végezzük; itt nem küldünk ANAF-nak.
//  - a felhasználó beír egy UIT-kódot → mentés (order_uit_codes) → a deep-link új ablakban kinyílik,
//    a fuvar-adatokkal + a beírt UIT-kóddal előtöltve.
window.UitPanel = (function () {

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
      .uit-code{font-family:ui-monospace,monospace;font-weight:700;letter-spacing:.5px;flex:1;min-width:120px;word-break:break-all}
      .uit-b{cursor:pointer;border:1px solid;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;background:transparent}
      .uit-b--go{color:#4ade80;border-color:rgba(34,197,94,.5)}
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
    if (!r.ok) throw new Error(d.error || ('Hiba (' + r.status + ')'));
    return d;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  function notify(msg) { if (typeof window.toast === 'function') window.toast(msg); else alert(msg); }

  // A UIT-kódhoz tartozó deep-link megnyitása új ablakban (a fuvar-adatok + UIT-kód előtöltve).
  async function openLink(orderId, code) {
    try {
      const d = await api('POST', '/api/execute', { functionName: 'getUitDeeplink', arguments: [orderId, code] });
      const r = d && d.result;
      if (r && r.ok && r.url) { window.open(r.url, '_blank', 'noopener'); return true; }
      // Linkul UIT nu este configurat de furnizor.
      notify('A developer még nem állított be deep-link sablont ehhez a GPS-szolgáltatóhoz. (Linkul UIT nu este configurat de furnizor.)');
    } catch (_) {
      notify('A developer még nem állított be deep-link sablont ehhez a GPS-szolgáltatóhoz. (Linkul UIT nu este configurat de furnizor.)');
    }
    return false;
  }

  function open(orderId, rendszam) {
    ensureStyle();
    const ov = document.createElement('div'); ov.className = 'uit-ov';
    ov.innerHTML =
      '<div class="uit-box">' +
        '<div class="uit-h"><h3>🚛 UIT-kódok — ' + esc(orderId) + '</h3></div>' +
        '<p class="uit-sub">Jármű: <b>' + (esc(rendszam) || '—') + '</b> · RO e-Transport. Egy fuvarhoz több UIT is rögzíthető.</p>' +
        '<div id="uit-list"><div class="uit-empty">Betöltés…</div></div>' +
        '<div class="uit-add"><input class="uit-in" id="uit-new" placeholder="Új UIT-kód beírása…"><button class="uit-save" id="uit-savebtn">➤ Trimite / Küldés</button></div>' +
        '<p class="uit-note">A UIT-ot a megbízó deklarációjára kapod — ide a <b>kapott</b> kód kerül. ' +
          'A „Küldés" elmenti a kódot, majd megnyitja a GPS-szolgáltató portálját (deep-link) a fuvar adataival előtöltve.</p>' +
        '<div class="uit-foot"><button class="uit-close" id="uit-closebtn">Bezárás</button></div>' +
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
      if (!items.length) { $('uit-list').innerHTML = '<div class="uit-empty">Még nincs UIT-kód ehhez a fuvarhoz.</div>'; return; }
      $('uit-list').innerHTML = items.map(function (u) {
        return '<div class="uit-row" data-id="' + esc(u.id) + '" data-code="' + esc(u.uit_code) + '">' +
          '<span class="uit-code">' + esc(u.uit_code) + '</span>' +
          '<button class="uit-b uit-b--go" data-act="open">🔗 Deschide / Megnyitás</button>' +
          '<button class="uit-b uit-b--del" data-act="del" title="Törlés">✕</button>' +
        '</div>';
      }).join('');
      ov.querySelectorAll('.uit-row [data-act]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const row = btn.closest('.uit-row'); const id = row.dataset.id; const code = row.dataset.code; const act = btn.dataset.act;
          btn.disabled = true;
          try {
            if (act === 'del') { await api('DELETE', '/api/uit/' + encodeURIComponent(id)); await render(); }
            else { await openLink(orderId, code); btn.disabled = false; }
          } catch (e) { notify(e.message); btn.disabled = false; }
        });
      });
    }

    async function add() {
      const code = $('uit-new').value.trim();
      if (!code) return;
      const b = $('uit-savebtn'); b.disabled = true;
      try {
        // 1) mentés
        await api('POST', '/api/orders/' + encodeURIComponent(orderId) + '/uit', { uit_code: code, rendszam: rendszam });
        $('uit-new').value = '';
        await render();
        // 2) deep-link megnyitása az új kóddal
        await openLink(orderId, code);
      } catch (e) { notify(e.message); }
      finally { b.disabled = false; }
    }
    $('uit-savebtn').addEventListener('click', add);
    $('uit-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    render();
  }

  return { open };
})();
