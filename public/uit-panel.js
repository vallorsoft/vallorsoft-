// public/uit-panel.js — RO e-Transport UIT-kezelő modal (Admin/Manager).
// Globál: window.UitPanel.open(orderId, rendszam)
//
// A UIT-kód auto-formázva íródik (nagybetű + 4-esével kötőjel, max 16
// alfanumerikus). A window.UitFmt.attach()-csal élő formázás.
//
// Minden kód mellett: 📋 vágólap-másoló + ✕ törlő. A 📷 gomb papírra írt
// UIT-ot lefotózza, a Gemini AI kiolvassa, minden felismert kódot KÜLÖN
// sorként ment (a fotó mindegyikhez csatolva).
//
// Deep-link / GPS-szolgáltatói átirányítás NINCS.
window.UitPanel = (function () {

  function ensureStyle() {
    if (document.getElementById('uit-style')) return;
    const s = document.createElement('style'); s.id = 'uit-style';
    s.textContent = `
      .uit-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}
      .uit-box{background:#0c1218;color:#e9eef5;border:1px solid rgba(255,255,255,.12);border-radius:14px;max-width:600px;width:100%;max-height:88vh;overflow:auto;padding:18px}
      .uit-h{display:flex;align-items:center;justify-content:space-between;margin:0 0 4px}
      .uit-h h3{margin:0;font-size:17px}
      .uit-sub{color:#9fb0c3;font-size:12px;margin:0 0 14px}
      .uit-row{display:flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:8px 10px;margin-bottom:8px;flex-wrap:wrap;background:rgba(255,255,255,0.03)}
      .uit-code{font-family:ui-monospace,monospace;font-weight:700;letter-spacing:.5px;flex:1;min-width:150px;word-break:break-all;color:#fff}
      .uit-src{color:#9fb0c3;font-size:11px}
      .uit-b{cursor:pointer;border:1px solid;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;background:transparent;white-space:nowrap}
      .uit-b--copy{color:#93c5fd;border-color:rgba(59,130,246,.5)}
      .uit-b--del{color:#f87171;border-color:rgba(239,68,68,.5)}
      .uit-b--photo{color:#a5b4fc;border-color:rgba(129,140,248,.5)}
      .uit-b--photo a{color:inherit;text-decoration:none;display:inline-block}
      .uit-add-wrap{border-top:1px dashed rgba(255,255,255,.15);padding-top:12px;margin-top:8px}
      .uit-add{display:flex;gap:6px;flex-wrap:wrap;align-items:stretch}
      .uit-in{flex:1;min-width:180px;background:#070b10;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:9px 10px;color:#e9eef5;font-family:ui-monospace,monospace;text-transform:uppercase;font-size:14px;letter-spacing:.5px}
      .uit-save{cursor:pointer;background:#3b82f6;color:#fff;border:0;border-radius:8px;padding:9px 14px;font-weight:700;white-space:nowrap}
      .uit-cam{cursor:pointer;background:#f59e0b;color:#0c1218;border:0;border-radius:8px;padding:9px 14px;font-weight:700;white-space:nowrap}
      .uit-cam[disabled],.uit-save[disabled]{opacity:.6;cursor:progress}
      .uit-status{font-size:12px;color:#9fb0c3;margin-top:6px;min-height:16px}
      .uit-status.err{color:#fca5a5}
      .uit-status.ok{color:#86efac}
      .uit-foot{display:flex;justify-content:flex-end;margin-top:14px}
      .uit-close{cursor:pointer;background:transparent;color:#9fb0c3;border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:8px 14px}
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
  const pretty = (c) => (window.UitFmt && window.UitFmt.format) ? window.UitFmt.format(c) : String(c || '');
  const norm = (c) => (window.UitFmt && window.UitFmt.normalize) ? window.UitFmt.normalize(c) : String(c || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,16);
  function notify(msg) { if (typeof window.toast === 'function') window.toast(msg); else alert(msg); }

  // Vágólap — Clipboard API + textarea-fallback.
  function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(() => true).catch(() => copyFallback(text));
      }
    } catch (_) {}
    return Promise.resolve(copyFallback(text));
  }
  function copyFallback(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '-1000px';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (_) { return false; }
  }

  // ── Kamera / fotó → base64 ──
  function makeFileInput() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    return inp;
  }
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('Nem sikerült beolvasni a fájlt.'));
      r.readAsDataURL(file);
    });
  }
  function shrinkImage(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1600;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        const out = c.toDataURL('image/jpeg', 0.85);
        const m = out.match(/^data:([^;]+);base64,(.*)$/);
        if (!m) return resolve({ mime: 'image/jpeg', b64: out });
        resolve({ mime: m[1], b64: m[2] });
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  function open(orderId, rendszam) {
    ensureStyle();
    const ov = document.createElement('div'); ov.className = 'uit-ov';
    ov.innerHTML =
      '<div class="uit-box">' +
        '<div class="uit-h"><h3>🚛 UIT-kódok — ' + esc(orderId) + '</h3></div>' +
        '<p class="uit-sub">Jármű: <b>' + (esc(rendszam) || '—') + '</b> · Egy fuvarhoz több UIT is rögzíthető.</p>' +
        '<div id="uit-list"><div class="uit-empty">Betöltés…</div></div>' +
        '<div class="uit-add-wrap">' +
          '<div class="uit-add">' +
            '<input class="uit-in" id="uit-new" placeholder="XXXX-XXXX-XXXX-XXXX" maxlength="19" autocomplete="off">' +
            '<button class="uit-save" id="uit-savebtn">➤ Küldés</button>' +
            '<button class="uit-cam" id="uit-cambtn">📷 Fotó</button>' +
          '</div>' +
          '<div class="uit-status" id="uit-stat"></div>' +
        '</div>' +
        '<div class="uit-foot"><button class="uit-close" id="uit-closebtn">Bezárás</button></div>' +
      '</div>';
    document.body.appendChild(ov);
    const $ = (id) => ov.querySelector('#' + id);
    const close = () => { ov.remove(); if (typeof window.__uitRefresh === 'function') window.__uitRefresh(); };
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    $('uit-closebtn').addEventListener('click', close);

    const inp = $('uit-new');
    if (inp && window.UitFmt && window.UitFmt.attach) { try { window.UitFmt.attach(inp); } catch (_) {} }

    const setStat = (m, cls) => {
      const s = $('uit-stat'); if (!s) return;
      s.textContent = m || '';
      s.className = 'uit-status' + (cls ? ' ' + cls : '');
    };

    async function render() {
      let items = [];
      try { items = (await api('GET', '/api/orders/' + encodeURIComponent(orderId) + '/uit')).items || []; }
      catch (e) { $('uit-list').innerHTML = '<div class="uit-empty">' + esc(e.message) + '</div>'; return; }
      if (!items.length) { $('uit-list').innerHTML = '<div class="uit-empty">Még nincs UIT-kód ehhez a fuvarhoz.</div>'; return; }
      $('uit-list').innerHTML = items.map(function (u) {
        const srcLabel = u.source === 'ai-scan' ? '📷 AI' : '✋';
        const photoBtn = u.has_photo
          ? '<span class="uit-b uit-b--photo"><a href="/api/uit/' + u.id + '/photo" target="_blank" rel="noopener" title="Fotó megnyitása">🖼️</a></span>'
          : '';
        return '<div class="uit-row" data-id="' + esc(u.id) + '" data-code="' + esc(u.uit_code) + '">' +
          '<span class="uit-code">' + esc(pretty(u.uit_code)) + '</span>' +
          '<span class="uit-src" title="' + (u.source==='ai-scan'?'AI-kiolvasás':'Kézi beírás') + '">' + srcLabel + '</span>' +
          photoBtn +
          '<button class="uit-b uit-b--copy" data-act="copy" title="Vágólapra másolás">📋</button>' +
          '<button class="uit-b uit-b--del" data-act="del" title="Törlés">✕</button>' +
        '</div>';
      }).join('');
      ov.querySelectorAll('.uit-row [data-act]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const row = btn.closest('.uit-row');
          const id = row.dataset.id;
          const code = row.dataset.code;
          const act = btn.dataset.act;
          btn.disabled = true;
          try {
            if (act === 'copy') {
              const ok = await copyToClipboard(pretty(code));
              notify(ok ? 'UIT vágólapra másolva.' : 'Nem sikerült a másolás.');
              btn.disabled = false;
            } else if (act === 'del') {
              if (!confirm('Törlöd ezt a UIT-kódot?')) { btn.disabled = false; return; }
              await api('DELETE', '/api/uit/' + encodeURIComponent(id));
              await render();
            }
          } catch (e) { notify(e.message); btn.disabled = false; }
        });
      });
    }

    async function addManual() {
      const code = norm($('uit-new').value);
      if (!code) { setStat('Adj meg legalább 1 karaktert.', 'err'); return; }
      const b = $('uit-savebtn'); b.disabled = true;
      setStat('Mentés…');
      try {
        await api('POST', '/api/orders/' + encodeURIComponent(orderId) + '/uit', { uit_code: code, rendszam: rendszam, source: 'manual' });
        $('uit-new').value = '';
        setStat('Mentve.', 'ok');
        await render();
      } catch (e) { setStat(e.message, 'err'); }
      finally { b.disabled = false; setTimeout(() => setStat(''), 2500); }
    }
    $('uit-savebtn').addEventListener('click', addManual);
    $('uit-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') addManual(); });

    // 📷 Fotó → AI-kiolvasás → minden kód külön mentve (fotó mindegyikhez)
    $('uit-cambtn').addEventListener('click', function () {
      const f = makeFileInput();
      f.addEventListener('change', async function () {
        try {
          if (!f.files || !f.files[0]) { f.remove(); return; }
          const file = f.files[0];
          const camBtn = $('uit-cambtn'); camBtn.disabled = true;
          setStat('Fotó feldolgozása…');
          const dataUrl = await fileToDataUrl(file);
          const shrunk = await shrinkImage(dataUrl);
          if (!shrunk) { setStat('Nem sikerült a fotó feldolgozása.', 'err'); camBtn.disabled = false; f.remove(); return; }
          setStat('AI kiolvasás…');
          const d = await api('POST', '/api/execute', {
            functionName: 'scanUitFromImage',
            arguments: [{ mimeType: shrunk.mime, data: shrunk.b64 }]
          });
          const r = d && d.result;
          if (!r || !r.ok) { setStat((r && r.err) || 'AI-hiba.', 'err'); camBtn.disabled = false; f.remove(); return; }
          const codes = (r && r.codes) || [];
          if (!codes.length) { setStat('Nincs felismert UIT-kód a képen.', 'err'); camBtn.disabled = false; f.remove(); return; }
          let savedCount = 0, dupCount = 0, errCount = 0;
          for (let i = 0; i < codes.length; i++) {
            try {
              await api('POST', '/api/orders/' + encodeURIComponent(orderId) + '/uit', {
                uit_code: codes[i],
                rendszam: rendszam,
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
          let msg = savedCount + ' UIT mentve';
          if (dupCount) msg += ', ' + dupCount + ' már létezett';
          if (errCount) msg += ', ' + errCount + ' hiba';
          setStat(msg, errCount ? 'err' : 'ok');
          await render();
        } catch (e) {
          setStat(e.message || 'Hiba a fotó feldolgozásakor.', 'err');
        } finally {
          const camBtn2 = $('uit-cambtn'); if (camBtn2) camBtn2.disabled = false;
          f.remove();
          setTimeout(() => setStat(''), 4000);
        }
      });
      f.click();
    });

    render();
  }

  return { open };
})();
