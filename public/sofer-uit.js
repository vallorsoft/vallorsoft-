// public/sofer-uit.js — Sofőr UIT-nézet a kiosztott fuvarhoz.
// Globál: window.SoferUit.open(orderId)
//  - a sofőr CSAK a saját fuvarja UIT-jait látja (a backend ellenőrzi);
//  - a UIT-ügyintézés a GPS-szolgáltató saját portálján (deep-link) történik — nem küldünk ANAF-nak;
//  - ÚJ UIT-ot CSAK akkor adhat hozzá, ha még egy sincs (a backend is védi).
window.SoferUit = (function () {

  function ensureStyle() {
    if (document.getElementById('sofer-uit-style')) return;
    var s = document.createElement('style'); s.id = 'sofer-uit-style';
    s.textContent =
      '.su-ov{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;z-index:10000}' +
      '.su-box{background:#0f1722;color:#fff;width:100%;max-width:520px;max-height:86vh;overflow:auto;border-radius:18px 18px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom));border:1px solid rgba(255,255,255,.1)}' +
      '.su-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}' +
      '.su-h h3{margin:0;font-size:16px}' +
      '.su-x{background:none;border:0;color:#9fb0c3;font-size:22px;line-height:1;cursor:pointer}' +
      '.su-sub{color:#9fb0c3;font-size:12px;margin:0 0 14px}' +
      '.su-row{border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:11px 12px;margin-bottom:9px}' +
      '.su-top{display:flex;align-items:center;gap:9px}' +
      '.su-code{font-family:ui-monospace,monospace;font-weight:700;letter-spacing:.5px;word-break:break-all;flex:1}' +
      '.su-open{cursor:pointer;border:1px solid rgba(34,197,94,.5);color:#4ade80;border-radius:8px;padding:6px 11px;font-size:12px;font-weight:700;background:transparent;white-space:nowrap}' +
      '.su-add{display:flex;gap:7px;margin-top:6px}' +
      '.su-in{flex:1;background:#070d14;border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:11px;color:#fff;font-family:ui-monospace,monospace;text-transform:uppercase;font-size:15px}' +
      '.su-save{background:#3b82f6;color:#fff;border:0;border-radius:10px;padding:11px 14px;font-weight:700}' +
      '.su-note{font-size:11px;color:#9fb0c3;margin:12px 0 0;border-top:1px dashed rgba(255,255,255,.12);padding-top:10px}' +
      '.su-empty{color:#9fb0c3;font-size:13px;padding:8px 2px}';
    document.head.appendChild(s);
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m];}); }
  async function api(method, url, body) {
    var r = await fetch(url, { method:method, credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: body?JSON.stringify(body):undefined });
    var d = await r.json().catch(function(){return {};});
    if (!r.ok) throw new Error(d.error || ('Hiba ('+r.status+')'));
    return d;
  }
  function notify(msg) { if (typeof window.toast === 'function') window.toast(msg); else alert(msg); }

  // A UIT-kód deep-linkjének megnyitása (a fuvar-adatok + UIT-kód előtöltve).
  async function openLink(orderId, code) {
    try {
      var d = await api('POST', '/api/execute', { functionName: 'getUitDeeplink', arguments: [orderId, code] });
      var r = d && d.result;
      if (r && r.ok && r.url) { window.open(r.url, '_blank', 'noopener'); return true; }
      notify('Linkul UIT nu este configurat de furnizor. / Nincs beállított deep-link.');
    } catch (_) {
      notify('Linkul UIT nu este configurat de furnizor. / Nincs beállított deep-link.');
    }
    return false;
  }

  function open(orderId) {
    ensureStyle();
    var ov = document.createElement('div'); ov.className = 'su-ov';
    ov.innerHTML =
      '<div class="su-box">' +
        '<div class="su-h"><h3>🚛 UIT-kódok — #' + esc(orderId) + '</h3><button class="su-x" id="suX">&times;</button></div>' +
        '<p class="su-sub">RO e-Transport · csak a te fuvarodhoz tartozó kódok.</p>' +
        '<div id="suList"><div class="su-empty">Betöltés…</div></div>' +
        '<div id="suAddWrap"></div>' +
        '<p class="su-note">A UIT-ügyintézés a GPS-szolgáltató portálján (deep-link) történik — a „Megnyitás" gomb ' +
          'a fuvar adataival előtöltve nyitja meg.</p>' +
      '</div>';
    document.body.appendChild(ov);
    var $ = function(id){ return ov.querySelector('#'+id); };
    var close = function(){ ov.remove(); };
    ov.addEventListener('click', function(e){ if (e.target === ov) close(); });
    $('suX').addEventListener('click', close);

    function render(data){
      var items = data.items || [];
      if (!items.length) {
        $('suList').innerHTML = '<div class="su-empty">Még nincs UIT-kód ehhez a fuvarhoz.</div>';
      } else {
        $('suList').innerHTML = items.map(function(u){
          return '<div class="su-row" data-code="' + esc(u.uit_code) + '">' +
            '<div class="su-top">' +
              '<span class="su-code">' + esc(u.uit_code) + '</span>' +
              '<button class="su-open" data-act="open">🔗 Megnyitás</button>' +
            '</div>' +
          '</div>';
        }).join('');
        ov.querySelectorAll('.su-row [data-act="open"]').forEach(function(btn){
          btn.addEventListener('click', async function(){
            var code = btn.closest('.su-row').dataset.code;
            btn.disabled = true;
            await openLink(orderId, code);
            btn.disabled = false;
          });
        });
      }
      // Hozzáadás CSAK akkor, ha nincs még UIT (a backend is ezt nézi).
      if (data.canAdd) {
        $('suAddWrap').innerHTML =
          '<div class="su-add"><input class="su-in" id="suNew" placeholder="UIT-kód beírása…"><button class="su-save" id="suSave">➤ Küldés</button></div>';
        var add = async function(){
          var code = $('suNew').value.trim(); if (!code) return;
          var b = $('suSave'); b.disabled = true;
          try {
            await api('POST', '/api/sofer/orders/' + encodeURIComponent(orderId) + '/uit', { uit_code: code });
            await load();
            if (typeof window.__soferUitChanged === 'function') window.__soferUitChanged();
            await openLink(orderId, code);
          } catch (e) { notify(e.message); b.disabled = false; }
        };
        $('suSave').addEventListener('click', add);
        $('suNew').addEventListener('keydown', function(e){ if (e.key === 'Enter') add(); });
      } else {
        $('suAddWrap').innerHTML = '';
      }
    }
    async function load(){
      try { render(await api('GET', '/api/sofer/orders/' + encodeURIComponent(orderId) + '/uit')); }
      catch (e) { $('suList').innerHTML = '<div class="su-empty">' + esc(e.message) + '</div>'; $('suAddWrap').innerHTML=''; }
    }
    load();
  }
  return { open: open };
})();
