// public/sofer-uit.js — Sofőr UIT-modal (bezárható) a kiosztott fuvarhoz.
//
// Globál: window.SoferUit.open(orderId)
//   - a sofőr CSAK a saját fuvarja UIT-jait látja/kezeli (a backend őrzi);
//   - a UIT-kódot 4-esével kötőjellel megjelenítjük, beíráskor automatikusan
//     nagybetűs és kötőjeles (window.UitFmt.attach), max 16 alfanumerikus;
//   - TÖBB UIT-kód is felvihető ugyanahhoz a fuvarhoz;
//   - „📷 Fotó" gomb: a papírra írt UIT-ot kamerával felveszi, a Gemini
//     kiolvassa, minden felismert kódot KÜLÖN sorként ment (a fotó
//     mindegyikhez csatolva → megnyitható, letölthető);
//   - MINDEN kód mellett: 📋 vágólap-másoló + 🗑️ törlő (a sofőr törölheti
//     a saját fuvarja UIT-jait, a szerver ownership-védett).
//   - Deep-link / GPS-szolgáltatói átirányítás NINCS.
window.SoferUit = (function () {

  function ensureStyle() {
    if (document.getElementById('sofer-uit-style')) return;
    var s = document.createElement('style'); s.id = 'sofer-uit-style';
    s.textContent =
      '.su-ov{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;z-index:10000}' +
      '.su-box{background:#0f1722;color:#fff;width:100%;max-width:560px;max-height:90vh;overflow:auto;border-radius:18px 18px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom));border:1px solid rgba(255,255,255,.1)}' +
      '.su-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}' +
      '.su-h h3{margin:0;font-size:16px}' +
      '.su-x{background:none;border:0;color:#9fb0c3;font-size:26px;line-height:1;cursor:pointer;padding:0 6px}' +
      '.su-sub{color:#9fb0c3;font-size:12px;margin:0 0 14px}' +
      '.su-row{display:flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:11px 12px;margin-bottom:9px;flex-wrap:wrap;background:rgba(255,255,255,0.03)}' +
      '.su-code{font-family:ui-monospace,monospace;font-weight:700;letter-spacing:.6px;flex:1;min-width:150px;word-break:break-all;color:#fff}' +
      '.su-src{color:#9fb0c3;font-size:11px}' +
      '.su-btn{cursor:pointer;border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;background:transparent;color:#e2e8f0;white-space:nowrap}' +
      '.su-btn.copy{color:#93c5fd;border-color:rgba(59,130,246,.5)}' +
      '.su-btn.del{color:#f87171;border-color:rgba(239,68,68,.5)}' +
      '.su-btn.photo{color:#a5b4fc;border-color:rgba(129,140,248,.5)}' +
      '.su-btn.photo a{color:inherit;text-decoration:none;display:inline-block}' +
      '.su-add{display:flex;flex-direction:column;gap:8px;margin-top:6px;border-top:1px dashed rgba(255,255,255,.15);padding-top:12px}' +
      '.su-add-row{display:flex;gap:7px;flex-wrap:wrap;align-items:stretch}' +
      '.su-in{flex:1;min-width:180px;background:#070d14;border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:11px;color:#fff;font-family:ui-monospace,monospace;text-transform:uppercase;font-size:15px;letter-spacing:.6px}' +
      '.su-save{background:#3b82f6;color:#fff;border:0;border-radius:10px;padding:11px 14px;font-weight:700;cursor:pointer;white-space:nowrap}' +
      '.su-cam{background:#f59e0b;color:#0f1722;border:0;border-radius:10px;padding:11px 14px;font-weight:700;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}' +
      '.su-cam[disabled],.su-save[disabled]{opacity:.6;cursor:progress}' +
      '.su-status{font-size:12px;color:#9fb0c3;min-height:16px}' +
      '.su-status.err{color:#fca5a5}' +
      '.su-status.ok{color:#86efac}' +
      '.su-empty{color:#9fb0c3;font-size:13px;padding:8px 2px}';
    document.head.appendChild(s);
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m];}); }
  function pretty(code) { return (window.UitFmt && window.UitFmt.format) ? window.UitFmt.format(code) : String(code||''); }
  function norm(code)   { return (window.UitFmt && window.UitFmt.normalize) ? window.UitFmt.normalize(code) : String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,16); }

  async function api(method, url, body) {
    var r = await fetch(url, { method:method, credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: body?JSON.stringify(body):undefined });
    var d = await r.json().catch(function(){return {};});
    if (!r.ok) throw new Error(d.error || ('Hiba ('+r.status+')'));
    return d;
  }
  function notify(msg) { if (typeof window.toast === 'function') window.toast(msg); else alert(msg); }

  // Vágólapra másolás — Clipboard API + textarea-fallback (mobil Safari).
  function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return copyFallback(text); });
      }
    } catch (_) {}
    return Promise.resolve(copyFallback(text));
  }
  function copyFallback(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '-1000px';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (_) { return false; }
  }

  // ── Fotó → base64 (kamera). Egyetlen file-input, capture=environment
  //    → mobilon a natív kamerát nyitja meg. A képet a Gemini AI-nak
  //    küldjük scanUitFromImage-en; a válasz codes[] tömb — minden kódra
  //    külön POST-tal ment a UIT-mentő endpoint (photo_b64 mindegyikkel).
  function makeFileInput() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.capture = 'environment';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    return inp;
  }
  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { reject(new Error('Nem sikerült beolvasni a fájlt.')); };
      r.readAsDataURL(file);
    });
  }
  // Canvas-alapú átméretezés (max 1600px, JPEG q=0.85) — kompaktabb payload,
  // gyorsabb feltöltés. A base64 fejlécet (data:image/jpeg;base64,) eltávolítjuk.
  function shrinkImage(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var MAX = 1600;
        var w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; }
        }
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
        var out = c.toDataURL('image/jpeg', 0.85);
        // out formája: „data:image/jpeg;base64,XXXX"
        var m = out.match(/^data:([^;]+);base64,(.*)$/);
        if (!m) { resolve({ mime: 'image/jpeg', b64: out }); return; }
        resolve({ mime: m[1], b64: m[2] });
      };
      img.onerror = function () { resolve(null); };
      img.src = dataUrl;
    });
  }

  function open(orderId) {
    ensureStyle();
    var ov = document.createElement('div'); ov.className = 'su-ov';
    ov.innerHTML =
      '<div class="su-box">' +
        '<div class="su-h"><h3>🚛 UIT-kódok</h3><button class="su-x" id="suX" title="Bezárás">&times;</button></div>' +
        '<p class="su-sub">A fuvarhoz tartozó UIT-kódok. Új kódot beírhatsz kézzel, vagy papírról fotózással (📷 gomb — az AI kiolvassa).</p>' +
        '<div id="suList"><div class="su-empty">Betöltés…</div></div>' +
        '<div id="suAddWrap"></div>' +
      '</div>';
    document.body.appendChild(ov);
    var $ = function(id){ return ov.querySelector('#'+id); };
    var close = function(){ ov.remove(); };
    ov.addEventListener('click', function(e){ if (e.target === ov) close(); });
    $('suX').addEventListener('click', close);

    function renderList(items) {
      if (!items.length) {
        $('suList').innerHTML = '<div class="su-empty">Még nincs UIT-kód ehhez a fuvarhoz.</div>';
        return;
      }
      $('suList').innerHTML = items.map(function(u){
        var codeStr = pretty(u.uit_code);
        var srcLabel = u.source === 'ai-scan' ? '📷 AI' : '✋';
        var photoBtn = u.has_photo
          ? '<span class="su-btn photo"><a href="/api/uit/' + u.id + '/photo" target="_blank" rel="noopener" title="Fotó megnyitása">🖼️</a></span>'
          : '';
        return '<div class="su-row" data-id="' + esc(u.id) + '" data-code="' + esc(u.uit_code) + '">' +
          '<span class="su-code">' + esc(codeStr) + '</span>' +
          '<span class="su-src" title="' + (u.source==='ai-scan'?'AI-kiolvasás':'Kézi beírás') + '">' + srcLabel + '</span>' +
          photoBtn +
          '<button class="su-btn copy" data-act="copy" title="Vágólapra másolás">📋</button>' +
          '<button class="su-btn del" data-act="del" title="Törlés">🗑️</button>' +
        '</div>';
      }).join('');
      ov.querySelectorAll('.su-row [data-act]').forEach(function(btn){
        btn.addEventListener('click', async function(){
          var row = btn.closest('.su-row');
          var id = row.dataset.id;
          var code = row.dataset.code;
          var act = btn.dataset.act;
          btn.disabled = true;
          try {
            if (act === 'copy') {
              var ok = await copyToClipboard(pretty(code));
              notify(ok ? 'UIT vágólapra másolva.' : 'Nem sikerült a másolás.');
            } else if (act === 'del') {
              if (!confirm('Törlöd ezt a UIT-kódot?')) { btn.disabled = false; return; }
              await api('DELETE', '/api/sofer/uit/' + encodeURIComponent(id));
              if (typeof window.__soferUitChanged === 'function') window.__soferUitChanged();
              await load();
              return;
            }
          } catch (e) { notify(e.message); }
          btn.disabled = false;
        });
      });
    }

    function renderAdd() {
      $('suAddWrap').innerHTML =
        '<div class="su-add">' +
          '<div class="su-add-row">' +
            '<input class="su-in" id="suNew" placeholder="XXXX-XXXX-XXXX-XXXX" maxlength="19" autocomplete="off">' +
            '<button class="su-save" id="suSave">➤ Küldés</button>' +
            '<button class="su-cam" id="suCam">📷 Fotó</button>' +
          '</div>' +
          '<div class="su-status" id="suStat"></div>' +
        '</div>';
      var inp = $('suNew');
      if (inp && window.UitFmt && window.UitFmt.attach) { try { window.UitFmt.attach(inp); } catch (_) {} }
      var setStat = function (m, cls) {
        var s = $('suStat'); if (!s) return;
        s.textContent = m || '';
        s.className = 'su-status' + (cls ? ' ' + cls : '');
      };
      var addManual = async function () {
        var code = norm($('suNew').value);
        if (!code) { setStat('Adj meg legalább 1 karaktert.', 'err'); return; }
        var b = $('suSave'); b.disabled = true;
        setStat('Mentés…');
        try {
          await api('POST', '/api/sofer/orders/' + encodeURIComponent(orderId) + '/uit', { uit_code: code, source: 'manual' });
          $('suNew').value = '';
          setStat('Mentve.', 'ok');
          if (typeof window.__soferUitChanged === 'function') window.__soferUitChanged();
          await load();
        } catch (e) { setStat(e.message, 'err'); }
        finally { b.disabled = false; setTimeout(function () { setStat(''); }, 2500); }
      };
      $('suSave').addEventListener('click', addManual);
      $('suNew').addEventListener('keydown', function(e){ if (e.key === 'Enter') addManual(); });

      // 📷 Fotó → AI-kiolvasás → minden kód külön mentése (photo_b64 mindegyikkel)
      $('suCam').addEventListener('click', function () {
        var f = makeFileInput();
        f.addEventListener('change', async function () {
          try {
            if (!f.files || !f.files[0]) { f.remove(); return; }
            var file = f.files[0];
            var camBtn = $('suCam'); camBtn.disabled = true;
            setStat('Fotó feldolgozása…');
            var dataUrl = await fileToDataUrl(file);
            var shrunk = await shrinkImage(dataUrl);
            if (!shrunk) { setStat('Nem sikerült a fotó feldolgozása.', 'err'); camBtn.disabled = false; f.remove(); return; }
            setStat('AI kiolvasás…');
            var d = await api('POST', '/api/execute', {
              functionName: 'scanUitFromImage',
              arguments: [{ mimeType: shrunk.mime, data: shrunk.b64 }]
            });
            var r = d && d.result;
            if (!r || !r.ok) { setStat((r && r.err) || 'AI-hiba.', 'err'); camBtn.disabled = false; f.remove(); return; }
            var codes = (r && r.codes) || [];
            if (!codes.length) { setStat('Nincs felismert UIT-kód a képen.', 'err'); camBtn.disabled = false; f.remove(); return; }
            // Minden kódra külön POST — a fotó másolata mindegyikhez csatolva.
            var savedCount = 0, dupCount = 0, errCount = 0;
            for (var i = 0; i < codes.length; i++) {
              try {
                await api('POST', '/api/sofer/orders/' + encodeURIComponent(orderId) + '/uit', {
                  uit_code: codes[i],
                  source: 'ai-scan',
                  photo_b64: shrunk.b64,
                  photo_mime: shrunk.mime
                });
                savedCount++;
              } catch (e) {
                if (/deja inregistrat|already/i.test(e.message)) dupCount++;
                else errCount++;
              }
            }
            var msg = savedCount + ' UIT mentve';
            if (dupCount) msg += ', ' + dupCount + ' már létezett';
            if (errCount) msg += ', ' + errCount + ' hiba';
            setStat(msg, errCount ? 'err' : 'ok');
            if (typeof window.__soferUitChanged === 'function') window.__soferUitChanged();
            await load();
          } catch (e) {
            setStat(e.message || 'Hiba a fotó feldolgozásakor.', 'err');
          } finally {
            var camBtn2 = $('suCam'); if (camBtn2) camBtn2.disabled = false;
            f.remove();
            setTimeout(function () { setStat(''); }, 4000);
          }
        });
        f.click();
      });
    }

    async function load(){
      try {
        var data = await api('GET', '/api/sofer/orders/' + encodeURIComponent(orderId) + '/uit');
        renderList(data.items || []);
        renderAdd(); // mindig újrarajzol, hogy az input üres legyen
      } catch (e) {
        $('suList').innerHTML = '<div class="su-empty">' + esc(e.message) + '</div>';
        $('suAddWrap').innerHTML = '';
      }
    }
    load();
  }
  return { open: open };
})();
