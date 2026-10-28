// ============================================================
//  VallorSoft — public/doc-preview.js
//  Közös dokumentum-előnézet: a feltöltött fájl helyben, egy teljes képernyős
//  ablakban nyílik meg (telefonon és gépen egyaránt), fejlécben a TELJES
//  fájlnévvel, mérettel, letöltés és bezárás gombbal.
//   - kép (jpg/png/webp/gif/heic ha a böngésző tudja) → <img>, a képernyőhöz igazítva
//   - PDF → pdf.js-sel oldalanként canvasra (a telefonos böngészők iframe-ben
//     nem jelenítik meg a PDF-et, ezért nem a natív nézőt használjuk)
//   - egyéb formátum → „nincs előnézet" + letöltés
//  Használat:
//    DocPreview.open({ name, dataUrl })            // data:<mime>;base64,...
//    DocPreview.open({ name, url })                // auth-védett végpont (pl. /api/doc-download/:id)
//    DocPreview.open({ name, load: () => Promise<{dataUrl|blob, name?, mime?}> })
// ============================================================
(function () {
  'use strict';
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var st = { url: null, blob: null, name: '', token: 0 };

  function tt(k, fb) {
    try { var v = window.t ? window.t(k) : null; return v && v !== k ? v : fb; } catch (e) { return fb; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtSize(n) {
    n = Number(n) || 0;
    if (!n) return '';
    return n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  function guessMime(name, mime) {
    mime = String(mime || '').toLowerCase();
    if (mime && mime !== 'application/octet-stream') return mime;
    var ext = String(name || '').toLowerCase().split('.').pop();
    return ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
      gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp' })[ext] || mime || 'application/octet-stream';
  }
  function dataUrlToBlob(dataUrl) {
    var s = String(dataUrl || ''), comma = s.indexOf(',');
    var head = s.slice(0, comma), b64 = s.slice(comma + 1);
    var m = head.match(/^data:([^;]+)/);
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return new Blob([out], { type: m ? m[1] : 'application/octet-stream' });
  }

  function style() {
    if (document.getElementById('dpv-style')) return;
    var s = document.createElement('style');
    s.id = 'dpv-style';
    s.textContent =
      '#dpvOv{position:fixed;inset:0;z-index:10050;background:#1e293b;display:flex;flex-direction:column}' +
      '#dpvOv .dpv-head{display:flex;align-items:center;gap:10px;padding:10px 12px;padding-top:max(10px,env(safe-area-inset-top));background:#ffffff;color:#0f172a;border-bottom:1.5px solid #94a3b8}' +
      '#dpvOv .dpv-ttl{flex:1;min-width:0}' +
      '#dpvOv .dpv-name{font-weight:700;font-size:14px;line-height:1.3;word-break:break-word;color:#0f172a}' +
      '#dpvOv .dpv-meta{font-size:12px;color:#475569;margin-top:2px}' +
      '#dpvOv .dpv-btn{flex:none;min-width:44px;height:44px;padding:0 12px;border-radius:10px;border:1.5px solid #64748b;background:#fff;color:#0f172a;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit}' +
      '#dpvOv .dpv-btn.pri{background:linear-gradient(180deg,#2563eb,#1d4ed8);border-color:#1e40af;color:#fff}' +
      '#dpvOv .dpv-body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:12px;padding-bottom:max(12px,env(safe-area-inset-bottom));text-align:center}' +
      '#dpvOv .dpv-body img{max-width:100%;height:auto;background:#fff;box-shadow:0 4px 18px rgba(0,0,0,.4)}' +
      '#dpvOv .dpv-body canvas{display:block;margin:0 auto 12px;max-width:100%;height:auto;background:#fff;box-shadow:0 4px 18px rgba(0,0,0,.4)}' +
      '#dpvOv .dpv-msg{display:inline-block;margin-top:40px;padding:16px 20px;border-radius:12px;background:#fff;color:#0f172a;font-size:14px;max-width:420px}' +
      '#dpvOv .dpv-pg{color:#e2e8f0;font-size:12px;margin:-6px 0 10px}' +
      '@media (max-width:600px){#dpvOv .dpv-btn .dpv-lbl{display:none}}';
    document.head.appendChild(s);
  }

  function body(html) { var b = document.getElementById('dpvBody'); if (b) b.innerHTML = html; }

  function close() {
    st.token++;
    var o = document.getElementById('dpvOv');
    if (o) o.remove();
    if (st.url) { try { URL.revokeObjectURL(st.url); } catch (e) {} }
    st.url = null; st.blob = null;
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function download() {
    if (!st.blob) return;
    var a = document.createElement('a');
    a.href = st.url || URL.createObjectURL(st.blob);
    a.download = st.name || 'document';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = PDFJS; s.onload = function () { res(window.pdfjsLib); };
      s.onerror = function () { rej(new Error('pdf.js')); };
      document.head.appendChild(s);
    });
  }

  function renderPdf(blob, token) {
    body('<div class="dpv-msg">⏳ ' + esc(tt('dpv.loading', 'Se încarcă…')) + '</div>');
    return Promise.all([loadPdfJs(), blob.arrayBuffer()]).then(function (r) {
      var lib = r[0];
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return lib.getDocument({ data: new Uint8Array(r[1]) }).promise;
    }).then(function (pdf) {
      if (token !== st.token) return;
      var box = document.getElementById('dpvBody');
      box.innerHTML = '';
      var width = Math.min(box.clientWidth - 24, 1000);
      var ratio = Math.min(window.devicePixelRatio || 1, 2);
      var chain = Promise.resolve();
      for (var i = 1; i <= pdf.numPages; i++) {
        (function (n) {
          chain = chain.then(function () {
            if (token !== st.token) return;
            return pdf.getPage(n).then(function (page) {
              var base = page.getViewport({ scale: 1 });
              var vp = page.getViewport({ scale: (width / base.width) * ratio });
              var c = document.createElement('canvas');
              c.width = vp.width; c.height = vp.height;
              c.style.width = Math.round(vp.width / ratio) + 'px';
              if (pdf.numPages > 1) {
                var lbl = document.createElement('div');
                lbl.className = 'dpv-pg'; lbl.textContent = n + ' / ' + pdf.numPages;
                box.appendChild(c); box.appendChild(lbl);
              } else box.appendChild(c);
              return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
            });
          });
        })(i);
      }
      return chain;
    }).catch(function () {
      if (token !== st.token) return;
      body('<div class="dpv-msg">' + esc(tt('dpv.pdfFail', 'PDF-ul nu poate fi afișat aici. Descarcă-l pentru a-l deschide.')) + '</div>');
    });
  }

  function show(blob, name, mime, size) {
    var token = st.token;
    st.blob = blob; st.name = name || st.name;
    st.url = URL.createObjectURL(blob);
    mime = guessMime(st.name, mime || blob.type);
    var n = document.getElementById('dpvName'); if (n) n.textContent = st.name;
    var m = document.getElementById('dpvMeta');
    if (m) m.textContent = [fmtSize(size || blob.size), mime.split('/').pop().toUpperCase()].filter(Boolean).join(' · ');
    var dl = document.getElementById('dpvDl'); if (dl) dl.disabled = false;
    if (mime === 'application/pdf') return renderPdf(blob, token);
    if (mime.indexOf('image/') === 0) {
      body('<img alt="" src="' + st.url + '">');
      var img = document.querySelector('#dpvBody img');
      img.onerror = function () {
        body('<div class="dpv-msg">' + esc(tt('dpv.imgFail', 'Imaginea nu poate fi afișată în acest browser. Descarcă fișierul.')) + '</div>');
      };
      return;
    }
    body('<div class="dpv-msg">' + esc(tt('dpv.noPreview', 'Pentru acest tip de fișier nu există previzualizare. Descarcă-l pentru a-l deschide.')) + '</div>');
  }

  function open(opts) {
    opts = opts || {};
    close();
    style();
    st.name = opts.name || 'document';
    var token = st.token;
    var ov = document.createElement('div');
    ov.id = 'dpvOv';
    ov.setAttribute('role', 'dialog');
    ov.innerHTML =
      '<div class="dpv-head">' +
        '<div class="dpv-ttl"><div class="dpv-name" id="dpvName">' + esc(st.name) + '</div><div class="dpv-meta" id="dpvMeta"></div></div>' +
        '<button class="dpv-btn pri" id="dpvDl" disabled title="' + esc(tt('dpv.download', 'Descarcă')) + '" onclick="DocPreview._dl()">⬇️<span class="dpv-lbl"> ' + esc(tt('dpv.download', 'Descarcă')) + '</span></button>' +
        '<button class="dpv-btn" title="' + esc(tt('dpv.close', 'Închide')) + '" onclick="DocPreview.close()">✕</button>' +
      '</div>' +
      '<div class="dpv-body" id="dpvBody"><div class="dpv-msg">⏳ ' + esc(tt('dpv.loading', 'Se încarcă…')) + '</div></div>';
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    document.addEventListener('keydown', onKey);

    var p;
    if (opts.dataUrl) p = Promise.resolve({ blob: dataUrlToBlob(opts.dataUrl) });
    else if (opts.url) {
      p = fetch(opts.url, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error(r.status === 404 ? tt('dpv.notFound', 'Documentul nu a fost găsit.') : 'HTTP ' + r.status);
        return r.blob().then(function (b) { return { blob: b, mime: r.headers.get('Content-Type') }; });
      });
    } else if (typeof opts.load === 'function') {
      p = Promise.resolve(opts.load()).then(function (r) {
        r = r || {};
        return { blob: r.blob || dataUrlToBlob(r.dataUrl), name: r.name, mime: r.mime, size: r.size };
      });
    } else p = Promise.reject(new Error('—'));

    p.then(function (r) {
      if (token !== st.token) return;
      show(r.blob, r.name || st.name, opts.mime || r.mime, opts.size || r.size);
    }).catch(function (e) {
      if (token !== st.token) return;
      body('<div class="dpv-msg">⚠️ ' + esc((e && e.message) || tt('dpv.fail', 'Documentul nu a putut fi încărcat.')) + '</div>');
    });
  }

  window.DocPreview = { open: open, close: close, _dl: download, _guessMime: guessMime };
})();
