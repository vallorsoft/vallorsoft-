// ============================================================
//  VallorSoft — public/uit-scan.js
//  Közös UIT-kiolvasó: 📷 fotó (kamera) VAGY 📎 feltöltés (kép / PDF,
//  pl. az e-Transport visszaigazolás). A fájlt a `scanUitFromImage` RPC
//  olvassa ki (Gemini); a kép 1600px-re kicsinyítve megy, a PDF nyersen.
//  Használja: fuvar-kiírás, fuvar-szerkesztő, UIT-panel (⋯), sofőr UIT-modal.
//
//  UitScan.pick(mode) → Promise<{ codes:[...], b64, mime } | null>
//    mode: 'camera' (mobilon a kamerát nyitja) | 'file' (galéria / fájl, PDF is)
//    null = a felhasználó nem választott fájlt. Hiba esetén Error-t dob.
// ============================================================
(function () {
  'use strict';
  var MAX_BYTES = 8 * 1024 * 1024;
  function T(k, fb) { var v = window.t ? window.t(k) : k; return (v && v !== k) ? v : fb; }

  function _choose(mode) {
    return new Promise(function (resolve) {
      var inp = document.createElement('input');
      inp.type = 'file';
      if (mode === 'camera') { inp.accept = 'image/*'; inp.capture = 'environment'; }
      else inp.accept = 'image/*,application/pdf,.pdf';
      inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        inp.remove();
        resolve(f || null);
      });
      inp.click();
    });
  }
  function _readDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { reject(new Error(T('uitscan.readErr', 'Nu s-a putut citi fișierul.'))); };
      r.readAsDataURL(file);
    });
  }
  function _shrink(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var max = 1600, w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (!w || !h) return resolve(null);
        var k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var out = c.toDataURL('image/jpeg', 0.85);
        resolve({ mime: 'image/jpeg', b64: out.split(',')[1] || '' });
      };
      img.onerror = function () { resolve(null); };
      img.src = dataUrl;
    });
  }

  async function prepare(file) {
    var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    if (isPdf) {
      if (file.size > MAX_BYTES) throw new Error(T('uitscan.tooBig', 'Fișier prea mare (max 8 MB).'));
      var du = await _readDataUrl(file);
      return { mime: 'application/pdf', b64: du.split(',')[1] || '' };
    }
    if (file.type && !/^image\//.test(file.type)) throw new Error(T('uitscan.badType', 'Format nesuportat (imagine sau PDF).'));
    var shrunk = await _shrink(await _readDataUrl(file));
    if (!shrunk || !shrunk.b64) throw new Error(T('uitscan.imgErr', 'Imaginea nu a putut fi procesată.'));
    return shrunk;
  }

  async function scan(payload) {
    var r = await fetch('/api/execute', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName: 'scanUitFromImage', arguments: [{ mimeType: payload.mime, data: payload.b64 }] }),
    });
    var d = await r.json().catch(function () { return {}; });
    var res = d && d.result;
    if (!res || !res.ok) throw new Error((res && res.err) || T('common.error', 'Eroare'));
    return (res.codes || []).slice();
  }

  async function pick(mode) {
    var file = await _choose(mode);
    if (!file) return null;
    var p = await prepare(file);
    var codes = await scan(p);
    return { codes: codes, b64: p.b64, mime: p.mime };
  }

  window.UitScan = { pick: pick, prepare: prepare, scan: scan };
})();
