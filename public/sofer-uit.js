// public/sofer-uit.js — Sofőr UIT-nézet a kiosztott fuvarhoz.
// Globál: window.SoferUit.open(orderId)
//  - a sofőr CSAK a saját fuvarja UIT-jait látja (a backend ellenőrzi);
//  - státusz + ANAF-visszaigazolás látszik kódonként;
//  - ÚJ UIT-ot CSAK akkor adhat hozzá, ha még egy sincs (a backend is védi).
(window.registerI18n||function(d){(window.__i18nQueue=window.__i18nQueue||[]).push(d);})({
  'sof.uit.errStatus': { hu: 'Hiba ({s})', ro: 'Eroare ({s})' },
  'sof.uit.anafConfirmed': { hu: '✔ ANAF visszaigazolva', ro: '✔ Confirmat de ANAF' },
  'sof.uit.anafError': { hu: 'ANAF: hiba', ro: 'ANAF: eroare' },
  'sof.uit.anafWaiting': { hu: 'ANAF: megerősítésre vár', ro: 'ANAF: în așteptarea confirmării' },
  'sof.uit.stopped': { hu: 'Leállítva', ro: 'Oprit' },
  'sof.uit.notSent': { hu: 'Nincs még elküldve', ro: 'Încă netrimis' },
  'sof.uit.csTitle': { hu: 'UIT — hamarosan', ro: 'UIT — în curând' },
  'sof.uit.csBody': { hu: 'A UIT / RO e-Transport funkció fejlesztés alatt áll. Addig is használd a GPS-szolgáltatód (pl. CargoTrack) saját e-Transport lehetőségét.', ro: 'Funcția UIT / RO e-Transport este în dezvoltare. Până atunci, folosește opțiunea proprie e-Transport a furnizorului tău GPS (ex. CargoTrack).' },
  'sof.uit.csOk': { hu: 'Rendben', ro: 'În regulă' },
  'sof.uit.title': { hu: '🚛 UIT-kódok — #{id}', ro: '🚛 Coduri UIT — #{id}' },
  'sof.uit.sub': { hu: 'RO e-Transport · csak a te fuvarodhoz tartozó kódok.', ro: 'RO e-Transport · doar codurile aferente transportului tău.' },
  'sof.uit.loading': { hu: 'Betöltés…', ro: 'Se încarcă…' },
  'sof.uit.note': { hu: 'A „✔ ANAF visszaigazolva" jelzés azt jelenti, hogy az ANAF megerősítette a fogadást. Amíg ez nincs meg, a kód még nincs hitelesítve.', ro: 'Indicatorul „✔ Confirmat de ANAF" înseamnă că ANAF a confirmat recepția. Până atunci, codul nu este încă validat.' },
  'sof.uit.empty': { hu: 'Még nincs UIT-kód ehhez a fuvarhoz.', ro: 'Încă nu există coduri UIT pentru acest transport.' },
  'sof.uit.placeholder': { hu: 'UIT-kód beírása…', ro: 'Introdu codul UIT…' },
  'sof.uit.save': { hu: '+ Mentés', ro: '+ Salvează' }
});
function T(k,v){return (typeof window.t==='function')?window.t(k,v):k;}
window.SoferUit = (function () {
  // FUNKCIÓ IDEIGLENESEN KIKAPCSOLVA — visszakapcsolás: window.UIT_COMING_SOON = false.
  window.UIT_COMING_SOON = true;

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
      '.su-sym{font-size:17px}' +
      '.su-code{font-family:ui-monospace,monospace;font-weight:700;letter-spacing:.5px;word-break:break-all;flex:1}' +
      '.su-vf{font-size:11px;font-weight:700;border-radius:999px;padding:3px 9px;white-space:nowrap}' +
      '.su-vf--ok{background:rgba(34,197,94,.18);color:#4ade80}' +
      '.su-vf--wait{background:rgba(245,158,11,.18);color:#fbbf24}' +
      '.su-vf--err{background:rgba(239,68,68,.18);color:#f87171}' +
      '.su-msg{font-size:11px;color:#9fb0c3;margin-top:6px}' +
      '.su-add{display:flex;gap:7px;margin-top:6px}' +
      '.su-in{flex:1;background:#070d14;border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:11px;color:#fff;font-family:ui-monospace,monospace;text-transform:uppercase;font-size:15px}' +
      '.su-save{background:#e10b1a;color:#fff;border:0;border-radius:10px;padding:11px 14px;font-weight:700}' +
      '.su-note{font-size:11px;color:#9fb0c3;margin:12px 0 0;border-top:1px dashed rgba(255,255,255,.12);padding-top:10px}' +
      '.su-empty{color:#9fb0c3;font-size:13px;padding:8px 2px}';
    document.head.appendChild(s);
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m];}); }
  async function api(method, url, body) {
    var r = await fetch(url, { method:method, credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: body?JSON.stringify(body):undefined });
    var d = await r.json().catch(function(){return {};});
    if (!r.ok) throw new Error(d.error || T('sof.uit.errStatus', { s: r.status }));
    return d;
  }
  // ANAF-hitelesítési badge — ZÖLD csak valódi ANAF-visszaigazolásra.
  function verif(u){
    if (u.anaf_confirmed) return { cls:'ok', txt:T('sof.uit.anafConfirmed') };
    if (u.status === 'error') return { cls:'err', txt:T('sof.uit.anafError') };
    if (u.status === 'active') return { cls:'wait', txt:T('sof.uit.anafWaiting') };
    if (u.status === 'stopped') return { cls:'wait', txt:T('sof.uit.stopped') };
    return { cls:'wait', txt:T('sof.uit.notSent') };
  }
  function symbol(u){
    if (u.anaf_confirmed) return '✅';
    if (u.status === 'error') return '❌';
    if (u.status === 'active') return '⏳';
    if (u.status === 'stopped') return '⏹️';
    return '⏳';
  }

  function comingSoon() {
    ensureStyle();
    var ov = document.createElement('div'); ov.className = 'su-ov';
    ov.innerHTML =
      '<div class="su-box" style="text-align:center;">' +
        '<div style="font-size:34px;margin:6px 0;">🚧</div>' +
        '<h3 style="margin:0 0 8px;">' + esc(T('sof.uit.csTitle')) + '</h3>' +
        '<p class="su-sub" style="margin-bottom:16px;">' + esc(T('sof.uit.csBody')) + '</p>' +
        '<button class="su-save" id="suCsOk" style="width:100%;">' + esc(T('sof.uit.csOk')) + '</button>' +
      '</div>';
    document.body.appendChild(ov);
    var close = function () { ov.remove(); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#suCsOk').addEventListener('click', close);
  }

  function open(orderId) {
    if (window.UIT_COMING_SOON) { comingSoon(); return; }
    ensureStyle();
    var ov = document.createElement('div'); ov.className = 'su-ov';
    ov.innerHTML =
      '<div class="su-box">' +
        '<div class="su-h"><h3>' + esc(T('sof.uit.title', { id: orderId })) + '</h3><button class="su-x" id="suX">&times;</button></div>' +
        '<p class="su-sub">' + esc(T('sof.uit.sub')) + '</p>' +
        '<div id="suList"><div class="su-empty">' + esc(T('sof.uit.loading')) + '</div></div>' +
        '<div id="suAddWrap"></div>' +
        '<p class="su-note">' + esc(T('sof.uit.note')) + '</p>' +
      '</div>';
    document.body.appendChild(ov);
    var $ = function(id){ return ov.querySelector('#'+id); };
    var close = function(){ ov.remove(); };
    ov.addEventListener('click', function(e){ if (e.target === ov) close(); });
    $('suX').addEventListener('click', close);

    function render(data){
      var items = data.items || [];
      if (!items.length) {
        $('suList').innerHTML = '<div class="su-empty">' + esc(T('sof.uit.empty')) + '</div>';
      } else {
        $('suList').innerHTML = items.map(function(u){
          var v = verif(u);
          return '<div class="su-row">' +
            '<div class="su-top">' +
              '<span class="su-sym">' + symbol(u) + '</span>' +
              '<span class="su-code">' + esc(u.uit_code) + '</span>' +
              '<span class="su-vf su-vf--' + v.cls + '">' + v.txt + '</span>' +
            '</div>' +
            (u.last_message ? '<div class="su-msg">' + esc(u.last_message) + '</div>' : '') +
          '</div>';
        }).join('');
      }
      // Hozzáadás CSAK akkor, ha nincs még UIT (a backend is ezt nézi).
      if (data.canAdd) {
        $('suAddWrap').innerHTML =
          '<div class="su-add"><input class="su-in" id="suNew" placeholder="' + esc(T('sof.uit.placeholder')) + '"><button class="su-save" id="suSave">' + esc(T('sof.uit.save')) + '</button></div>';
        var add = async function(){
          var code = $('suNew').value.trim(); if (!code) return;
          var b = $('suSave'); b.disabled = true;
          try {
            await api('POST', '/api/sofer/orders/' + encodeURIComponent(orderId) + '/uit', { uit_code: code });
            await load();
            if (typeof window.__soferUitChanged === 'function') window.__soferUitChanged();
          } catch (e) { alert(e.message); b.disabled = false; }
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
