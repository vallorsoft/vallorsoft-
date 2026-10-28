// ============================================================
//  VallorSoft — public/waybill-docs.js
//  📎 Menetlevélhez csatolt dokumentumok: csoportos feltöltés (fájlonként típus:
//  fuvar-dokumentum [a menetlevél melyik fuvarjához] / számla / GPS útvonal /
//  megbízás / egyéb), kezelés (típus utólag módosítható, egyenkénti letöltés,
//  törlés) és csoportos letöltés EGY PDF-be fűzve (pdf-lib, kliens-oldal).
//  Szerver: handlers/waybillDocs.js. Belépés a menetlevél-lista soráról:
//  WaybillDocs.openUpload(id) / WaybillDocs.openManage(id).
// ============================================================
window.WaybillDocs = (function () {
  // A feltöltő típusai; a fuvar-oldalról jövő további típusok (CMR, POD…) is megjelennek.
  var TYPES = ['order_doc', 'invoice', 'gps_route', 'assignment', 'other'];
  var ALL_TYPES = TYPES.concat(['cmr', 'pod', 'order', 'contract', 'customs', 'receipt']);
  var ICO = { order_doc: '🚚', invoice: '🧾', gps_route: '🗺️', assignment: '📑', other: '📎',
    cmr: '📄', pod: '📷', order: '📑', contract: '📝', customs: '🛃', receipt: '🧾' };
  var FB = {
    order_doc: 'Documente cursă', invoice: 'Factură', gps_route: 'Traseu GPS',
    assignment: 'Comandă de transport', other: 'Altele'
  };
  var MAX_FILE = 15 * 1024 * 1024;
  var st = { wid: null, info: null, staged: [] };

  function tt(key, fb, p) {
    var v = fb;
    try { if (typeof t === 'function') { var x = t(key, p); if (x && x !== key) v = x; } } catch (e) {}
    if (p) Object.keys(p).forEach(function (k) { v = String(v).replace('{' + k + '}', p[k]); });
    return v;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function note(msg, kind) { try { toast(msg, kind || ''); } catch (e) { alert(msg); } }
  function typeLabel(k) { return (ICO[k] || '📎') + ' ' + (FB[k] ? tt('wbd.t.' + k, FB[k]) : tt('odoc.t.' + k, k)); }
  function fmtSize(n) { n = Number(n) || 0; if (!n) return ''; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function orderLabel(o) {
    var route = [o.loc_incarcare, o.loc_descarcare].filter(Boolean).map(function (s) { return String(s).split(',')[0]; }).join(' → ');
    return (o.fuvar_no || o.id) + (route ? ' · ' + route : '') + (o.data_incarcare ? ' · ' + o.data_incarcare : '');
  }
  // Típus-tipp a fájlnévből; egyébként fuvar-dokumentum (ha van fuvar) / egyéb.
  function guessType(name, hasOrders) {
    var n = String(name || '').toLowerCase();
    if (/factur|invoice|sz[aá]ml/.test(n)) return 'invoice';
    if (/gps|traseu|route|[uú]tvonal|track/.test(n)) return 'gps_route';
    if (/comand|megb[ií]z|order|contract/.test(n)) return 'assignment';
    return hasOrders ? 'order_doc' : 'other';
  }

  function ensureStyle() {
    if (document.getElementById('wbd-style')) return;
    var s = document.createElement('style');
    s.id = 'wbd-style';
    s.textContent =
      '.wbd-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:14px}' +
      '.wbd-mod{background:#fff;color:#0f172a;border-radius:16px;padding:20px;width:100%;max-width:760px;max-height:92vh;overflow:auto;box-shadow:0 24px 60px rgba(15,23,42,.3);box-sizing:border-box}' +
      '.wbd-mod h3{margin:0 0 4px;font-size:18px;color:#0f172a}.wbd-sub{font-size:12px;color:#475569;margin-bottom:14px}' +
      '.wbd-drop{border:2px dashed #94a3b8;border-radius:14px;padding:18px;text-align:center;cursor:pointer;background:#f8fafc;font-weight:600;color:#334155}' +
      '.wbd-drop.on{border-color:#2563eb;background:#eff6ff}' +
      '.wbd-list{display:flex;flex-direction:column;gap:8px;margin:14px 0}' +
      '.wbd-row{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;border:1.5px solid #cbd5e1;border-radius:12px;padding:10px 12px;background:#fff}' +
      '.wbd-row .wbd-name{font-weight:700;font-size:13px;word-break:break-word;color:#0f172a}.wbd-row .wbd-meta{font-size:11.5px;color:#475569}' +
      '.wbd-sels{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.wbd-sels select{padding:6px 8px;border:1.5px solid #94a3b8;border-radius:8px;font-size:13px;background:#fff;color:#0f172a;max-width:100%}' +
      '.wbd-x{border:0;background:#fee2e2;color:#b91c1c;border-radius:8px;width:30px;height:30px;cursor:pointer;font-weight:800}' +
      '.wbd-act{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.wbd-act button{padding:6px 10px;border-radius:8px;border:1.5px solid #64748b;background:#fff;color:#0f172a;cursor:pointer;font-size:13px}.wbd-act button:hover{background:#f1f5f9}' +
      '.wbd-foot{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px;position:sticky;bottom:-20px;background:#fff;padding:10px 0 0}' +
      '.wbd-foot .btn{padding:9px 16px}.wbd-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}' +
      '.wbd-bar select{padding:6px 8px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:13px;background:#fff;color:#0f172a}' +
      '.wbd-grp{font-size:12px;font-weight:800;color:#1d4ed8;text-transform:uppercase;letter-spacing:.4px;margin:12px 0 4px}' +
      '.wbd-empty{padding:22px;text-align:center;color:#475569}' +
      '.wbd-badge{display:inline-block;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;background:#eef2ff;color:#3730a3;margin-left:6px}' +
      '@media(max-width:560px){.wbd-row{grid-template-columns:1fr auto}.wbd-row .wbd-chk{display:none}}';
    document.head.appendChild(s);
  }
  function overlay(html) {
    close();
    ensureStyle();
    var ov = document.createElement('div');
    ov.className = 'wbd-ov'; ov.id = 'wbdOv';
    ov.innerHTML = '<div class="wbd-mod vs-light-surface">' + html + '</div>';
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    return ov;
  }
  function close() { var o = document.getElementById('wbdOv'); if (o) o.remove(); }

  function typeSelect(cur, attrs) {
    var list = (cur && TYPES.indexOf(cur) < 0) ? TYPES.concat([cur]) : TYPES;
    return '<select ' + (attrs || '') + '>' + list.map(function (k) {
      return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + esc(typeLabel(k)) + '</option>';
    }).join('') + '</select>';
  }
  function orderSelect(cur, attrs) {
    var orders = (st.info && st.info.orders) || [];
    return '<select ' + (attrs || '') + '><option value="">' + esc(tt('wbd.noOrder', '— fără cursă —')) + '</option>' +
      orders.map(function (o) {
        return '<option value="' + esc(o.id) + '"' + (o.id === cur ? ' selected' : '') + '>' + esc(orderLabel(o)) + '</option>';
      }).join('') + '</select>';
  }
  function head(title) {
    var w = (st.info && st.info.waybill) || {};
    var nOrd = ((st.info && st.info.orders) || []).length;
    return '<h3>' + title + '</h3><div class="wbd-sub">' + esc(w.numar_fisa || w.file_name || w.id || '') +
      ' · ' + esc(tt('wbd.ordersCount', '{n} curse pe foaie', { n: nOrd })) + '</div>';
  }

  function load(wid) {
    return gas('waybillDocList', [{ waybill_id: wid }]).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.err) || 'Eroare');
      st.wid = wid; st.info = r;
      return r;
    });
  }

  // ─── Feltöltés ─────────────────────────────────────────────
  function openUpload(wid) {
    st.staged = [];
    load(wid).then(renderUpload).catch(function (e) { note(e.message, 'err'); });
  }
  function renderUpload() {
    var hasOrders = ((st.info && st.info.orders) || []).length > 0;
    var rows = st.staged.map(function (f, i) {
      return '<div class="wbd-row"><span class="wbd-chk">' + (ICO[f.type] || '📎') + '</span><div>' +
        '<div class="wbd-name">' + esc(f.file.name) + '</div><div class="wbd-meta">' + esc(fmtSize(f.file.size)) +
        (f.file.size > MAX_FILE ? ' · <b style="color:#b91c1c;">' + esc(tt('wbd.tooBig', 'prea mare (max. 15 MB)')) + '</b>' : '') + '</div>' +
        '<div class="wbd-sels">' + typeSelect(f.type, 'onchange="WaybillDocs._stType(' + i + ',this.value)"') +
        (hasOrders ? orderSelect(f.order_id, 'onchange="WaybillDocs._stOrder(' + i + ',this.value)"') : '') +
        '</div></div><button class="wbd-x" title="✕" onclick="WaybillDocs._stDel(' + i + ')">✕</button></div>';
    }).join('');
    overlay(head(tt('wbd.uploadTitle', '📎 Încarcă documente la foaia de parcurs')) +
      '<label class="wbd-drop" id="wbdDrop">' + esc(tt('wbd.pick', '➕ Alege fișierele (mai multe odată) sau trage-le aici')) +
      '<input type="file" id="wbdFile" multiple accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.csv,.txt,.xml,.zip" style="display:none" onchange="WaybillDocs._stAdd(this.files)"></label>' +
      (st.staged.length > 1 ? '<div class="wbd-bar" style="margin-top:12px;"><span style="font-size:13px;color:#334155;">' +
        esc(tt('wbd.setAll', 'Tip pentru toate:')) + '</span>' +
        typeSelect('', 'onchange="WaybillDocs._stAll(this.value)"').replace('>', '><option value="" selected>—</option>') + '</div>' : '') +
      '<div class="wbd-list">' + (rows || '<div class="wbd-empty">' + esc(tt('wbd.noneStaged', 'Niciun fișier selectat încă.')) + '</div>') + '</div>' +
      '<div class="wbd-foot"><button class="btn ghost" onclick="WaybillDocs.close()">' + esc(tt('common.cancel', 'Anulează')) + '</button>' +
      '<button class="btn ghost" onclick="WaybillDocs.openManage(\'' + esc(st.wid) + '\')">' + esc(tt('wbd.manage', '🗂️ Gestionare')) + '</button>' +
      '<button class="btn primary" id="wbdSend" ' + (st.staged.length ? '' : 'disabled') + ' onclick="WaybillDocs._send()">' +
      esc(tt('wbd.uploadBtn', '⬆️ Încarcă ({n})', { n: st.staged.length })) + '</button></div>');
    var drop = document.getElementById('wbdDrop');
    if (drop) {
      ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('on'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('on'); }); });
      drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) _stAdd(e.dataTransfer.files); });
    }
  }
  function _stAdd(files) {
    var orders = (st.info && st.info.orders) || [];
    [].slice.call(files || []).forEach(function (file) {
      var type = guessType(file.name, orders.length > 0);
      st.staged.push({ file: file, type: type, order_id: (type === 'order_doc' && orders.length === 1) ? orders[0].id : '' });
    });
    renderUpload();
  }
  function _stType(i, v) {
    var f = st.staged[i]; if (!f) return;
    f.type = v;
    var orders = (st.info && st.info.orders) || [];
    if (v === 'order_doc' && !f.order_id && orders.length === 1) f.order_id = orders[0].id;
    renderUpload();
  }
  function _stAll(v) { if (!v) return; st.staged.forEach(function (f, i) { _stType(i, v); }); }
  function _stOrder(i, v) { if (st.staged[i]) st.staged[i].order_id = v; }
  function _stDel(i) { st.staged.splice(i, 1); renderUpload(); }

  function readDataUrl(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(new Error('read')); };
      r.readAsDataURL(file);
    });
  }
  // Fájlonként küldjük (a JSON-kérés mérete így sosem lépi túl a szerver-korlátot).
  function _send() {
    var list = st.staged.slice();
    var bad = list.filter(function (f) { return f.file.size > MAX_FILE; });
    if (bad.length) { note(tt('wbd.tooBigMsg', 'Unele fișiere depășesc 15 MB: ') + bad.map(function (f) { return f.file.name; }).join(', '), 'err'); return; }
    var btn = document.getElementById('wbdSend');
    var done = 0, failed = [];
    var step = function (i) {
      if (i >= list.length) {
        if (failed.length) note(tt('wbd.someFailed', 'Nu s-au încărcat: ') + failed.join(', '), 'err');
        else note(tt('wbd.uploaded', '✅ {n} document(e) încărcat(e)', { n: done }), 'ok');
        st.staged = [];
        refreshList();
        openManage(st.wid);
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = '⏳ ' + (i + 1) + '/' + list.length; }
      var f = list[i];
      readDataUrl(f.file).then(function (data) {
        return gas('waybillDocUpload', [{ waybill_id: st.wid, files: [{
          file_name: f.file.name, data: data, doc_type: f.type, order_id: f.order_id || ''
        }] }]);
      }).then(function (r) {
        if (r && r.ok) done++; else failed.push(f.file.name + (r && r.err ? ' (' + r.err + ')' : ''));
      }).catch(function () { failed.push(f.file.name); })
        .then(function () { step(i + 1); });
    };
    step(0);
  }

  // ─── Kezelés ───────────────────────────────────────────────
  function openManage(wid) {
    load(wid).then(renderManage).catch(function (e) { note(e.message, 'err'); });
  }
  function renderManage() {
    var docs = (st.info && st.info.docs) || [];
    var hasOrders = ((st.info && st.info.orders) || []).length > 0;
    var w = (st.info && st.info.waybill) || {};
    // Maga a menetlevél is kijelölhető → a csoportos PDF elejére kerül.
    var body = '<div class="wbd-grp">' + esc(tt('wbd.waybillItself', '📋 Foaia de parcurs')) + '</div>' +
      '<div class="wbd-row"><input type="checkbox" class="wbd-chk wbd-sel" value="wb:' + esc(st.wid) + '" checked>' +
      '<div><div class="wbd-name">' + esc(w.numar_fisa || w.file_name || st.wid) + '</div>' +
      '<div class="wbd-meta">' + esc(tt('wbd.waybillHint', 'Foaia de parcurs completă — inclusă la începutul PDF-ului')) + '</div></div>' +
      '<div class="wbd-act"><button title="⬇️" onclick="WaybillDocs._dl(\'wb:' + esc(st.wid) + '\')">⬇️</button></div></div>';
    if (!docs.length) {
      body += '<div class="wbd-empty">' + esc(tt('wbd.noDocs', 'Nu există încă documente la această foaie de parcurs.')) + '</div>';
    } else {
      ALL_TYPES.forEach(function (k) {
        var g = docs.filter(function (d) { return (ALL_TYPES.indexOf(d.doc_type) >= 0 ? d.doc_type : 'other') === k; });
        if (!g.length) return;
        body += '<div class="wbd-grp">' + esc(typeLabel(k)) + ' (' + g.length + ')</div>';
        body += g.map(function (d) {
          var key = (d.src || 'od') + ':' + d.id;
          var drv = d.src === 'drv';
          return '<div class="wbd-row"><input type="checkbox" class="wbd-chk wbd-sel" value="' + esc(key) + '" checked>' +
            '<div><div class="wbd-name">' + esc(d.file_name) + (d.has_signed ? ' ✍️' : '') +
              (d.fuvar_no ? '<span class="wbd-badge">🚚 ' + esc(d.fuvar_no) + '</span>' : '') +
              (drv ? '<span class="wbd-badge" style="background:#ecfdf5;color:#065f46;">📷 ' + esc(tt('wbd.fromDriver', 'încărcat de șofer')) + '</span>' : '') + '</div>' +
            '<div class="wbd-meta">' + esc(fmtSize(d.file_size)) + (d.created_at ? ' · ' + new Date(d.created_at).toLocaleDateString('ro-RO') : '') +
            (d.uploaded_by ? ' · ' + esc(d.uploaded_by) : '') + (d.note ? ' · ' + esc(d.note) : '') + '</div>' +
            (drv ? '' : '<div class="wbd-sels">' + typeSelect(d.doc_type, 'onchange="WaybillDocs._upd(' + d.id + ',this.value,null)"') +
              (hasOrders ? orderSelect(d.order_id, 'onchange="WaybillDocs._upd(' + d.id + ',null,this.value)"') : '') + '</div>') +
            '</div><div class="wbd-act"><button title="' + esc(tt('dpv.preview', 'Previzualizare')) + '" onclick="WaybillDocs._view(\'' + esc(key) + '\')">👁</button>' +
            '<button title="⬇️" onclick="WaybillDocs._dl(\'' + esc(key) + '\')">⬇️</button>' +
            (drv ? '' : '<button title="🗑" onclick="WaybillDocs._del(' + d.id + ')">🗑</button>') + '</div></div>';
        }).join('');
      });
    }
    overlay(head(tt('wbd.manageTitle', '🗂️ Documentele foii de parcurs')) +
      '<div class="wbd-bar"><button class="btn ghost" style="padding:6px 10px;" onclick="WaybillDocs._selAll(true)">' + esc(tt('wbd.selAll', 'Toate')) + '</button>' +
        '<button class="btn ghost" style="padding:6px 10px;" onclick="WaybillDocs._selAll(false)">' + esc(tt('wbd.selNone', 'Niciunul')) + '</button></div>' +
      '<div class="wbd-list">' + body + '</div>' +
      '<div class="wbd-foot"><button class="btn ghost" onclick="WaybillDocs.close()">' + esc(tt('common.close', 'Închide')) + '</button>' +
      '<button class="btn ghost" onclick="WaybillDocs.openUpload(\'' + esc(st.wid) + '\')">' + esc(tt('wbd.upload', '📎 Încarcă')) + '</button>' +
      '<button class="btn primary" id="wbdPdf" onclick="WaybillDocs._pdf()">' + esc(tt('wbd.pdfBtn', '📄 Descarcă selecția într-un PDF')) + '</button>' +
      '</div>');
  }
  function _selAll(on) { document.querySelectorAll('#wbdOv .wbd-sel').forEach(function (c) { c.checked = on; }); }
  function _upd(id, type, orderId) {
    var d = ((st.info && st.info.docs) || []).filter(function (x) { return x.id === id && x.src !== 'drv'; })[0];
    if (!d) return;
    if (type != null) d.doc_type = type;
    if (orderId != null) d.order_id = orderId;
    gas('waybillDocUpdate', [{ waybill_id: st.wid, id: id, doc_type: d.doc_type, order_id: d.order_id || '' }]).then(function (r) {
      if (!r || !r.ok) { note((r && r.err) || 'Eroare', 'err'); return; }
      openManage(st.wid);
    });
  }
  function _del(id) {
    if (!confirm(tt('wbd.delConfirm', 'Ștergi definitiv acest document? Se șterge și de la cursă.'))) return;
    gas('waybillDocDelete', [{ waybill_id: st.wid, id: id }]).then(function (r) {
      if (!r || !r.ok) { note((r && r.err) || 'Eroare', 'err'); return; }
      refreshList();
      openManage(st.wid);
    });
  }
  // key = 'od:<id>' (fuvar-/menetlevél-dokumentum) vagy 'drv:<id>' (sofőr-feltöltés)
  function getDoc(key) {
    var p = String(key).split(':');
    return gas('waybillDocGet', [{ src: p[0], id: parseInt(p[1], 10) }]).then(function (r) {
      if (!r || !r.ok || !r.doc) throw new Error((r && r.err) || 'Eroare');
      return r.doc;
    });
  }
  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function dataToBytes(dataUrl) {
    var b64 = String(dataUrl).slice(String(dataUrl).indexOf(',') + 1);
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function _dl(key) {
    if (String(key).indexOf('wb:') === 0) {   // a menetlevél nyomtatható lapja új lapon
      window.open('/api/pdf-download/' + encodeURIComponent(String(key).slice(3)), '_blank', 'noopener');
      return;
    }
    getDoc(key).then(function (d) {
      saveBlob(new Blob([dataToBytes(d.data)], { type: d.mime || 'application/octet-stream' }), d.file_name || ('document-' + d.id));
    }).catch(function (e) { note(e.message, 'err'); });
  }
  // Helyben megnyitás (közös DocPreview ablak: kép / PDF, telefonon is).
  function _view(key) {
    var d0 = ((st.info && st.info.docs) || []).filter(function (x) { return (x.src || 'od') + ':' + x.id === key; })[0] || {};
    if (!window.DocPreview) { _dl(key); return; }
    DocPreview.open({
      name: d0.file_name, size: d0.file_size,
      load: function () { return getDoc(key).then(function (d) { return { dataUrl: d.data, name: d.file_name, mime: d.mime }; }); }
    });
  }
  // Nem-JPEG/PNG kép (webp, heic ha a böngésző tudja) → JPEG canvas-szal.
  function toJpeg(dataUrl) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          res(c.toDataURL('image/jpeg', 0.9));
        } catch (e) { rej(e); }
      };
      img.onerror = function () { rej(new Error('img')); };
      img.src = dataUrl;
    });
  }
  // ── A menetlevél (HTML nyomtatvány) → PDF-oldalak ────────────────────
  // A /api/pdf-download/:id lapot egy rejtett, A4-szélességű iframe-be töltjük,
  // html2canvas-szal (az iframe-en belül) képpé rendereljük, és A4 magasságú
  // szeletekre vágjuk — a vágás egy táblázat-sor / blokk elejére esik, hogy
  // szöveg ne törjön ketté. A kész oldalak a csoportos PDF elejére kerülnek.
  var H2C_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  function renderWaybillInto(out, wid) {
    var P = window.PDFLib;
    var CSS_W = 794;                       // A4 szélesség CSS-pixelben (96 dpi)
    var W = 595.28, H = 841.89, M = 22;    // pt
    var k = (W - 2 * M) / CSS_W;           // pt / CSS-px
    var pageCss = Math.floor((H - 2 * M) / k);
    return new Promise(function (resolve, reject) {
      var fr = document.createElement('iframe');
      fr.setAttribute('aria-hidden', 'true');
      fr.style.cssText = 'position:fixed;left:-12000px;top:0;width:' + CSS_W + 'px;height:1200px;border:0;';
      var done = function (err, val) { try { fr.remove(); } catch (e) {} if (err) reject(err); else resolve(val); };
      var timer = setTimeout(function () { done(new Error(tt('wbd.wbTimeout', 'Foaia de parcurs nu s-a putut genera.'))); }, 30000);
      fr.onload = function () {
        var win = fr.contentWindow, doc = fr.contentDocument;
        if (!doc || !doc.body) { clearTimeout(timer); done(new Error('wb')); return; }
        [].slice.call(doc.querySelectorAll('.no-print')).forEach(function (el) { el.style.display = 'none'; });
        doc.documentElement.style.background = '#fff'; doc.body.style.background = '#fff';
        doc.body.style.margin = '0'; doc.body.style.padding = '12px';
        var sc = doc.createElement('script');
        sc.src = H2C_SRC;
        sc.onerror = function () { clearTimeout(timer); done(new Error(tt('wbd.wbTimeout', 'Foaia de parcurs nu s-a putut genera.'))); };
        sc.onload = function () {
          var imgs = [].slice.call(doc.images);
          Promise.all(imgs.map(function (im) { return im.complete ? 0 : new Promise(function (r) { im.onload = im.onerror = r; }); }))
            .then(function () {
              var totalH = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
              // Biztonságos vágási pontok: sorok / blokkok teteje (CSS-px).
              var cuts = [].slice.call(doc.querySelectorAll('tr, .keep, .card, .sec-title, .sign-tbl, .sum-block, h1, h2, h3, table'))
                .map(function (el) { return Math.round(el.getBoundingClientRect().top + win.scrollY); })
                .filter(function (y) { return y > 0; }).sort(function (a, b) { return a - b; });
              return win.html2canvas(doc.body, { scale: 2, backgroundColor: '#ffffff', windowWidth: CSS_W, useCORS: true, logging: false })
                .then(function (canvas) {
                  var ratio = canvas.height / totalH;   // canvas-px / CSS-px
                  var y = 0, chain = Promise.resolve();
                  while (y < totalH - 4) {
                    var end = y + pageCss;
                    if (end < totalH) {
                      var best = 0;
                      cuts.forEach(function (c) { if (c > y + pageCss * 0.45 && c <= end) best = c; });
                      if (best) end = best;
                    } else end = totalH;
                    (function (y0, y1) {
                      chain = chain.then(function () {
                        var sh = Math.max(1, Math.round((y1 - y0) * ratio));
                        var part = document.createElement('canvas');
                        part.width = canvas.width; part.height = sh;
                        var cx = part.getContext('2d');
                        cx.fillStyle = '#fff'; cx.fillRect(0, 0, part.width, sh);
                        cx.drawImage(canvas, 0, Math.round(y0 * ratio), canvas.width, sh, 0, 0, canvas.width, sh);
                        return out.embedJpg(dataToBytes(part.toDataURL('image/jpeg', 0.92))).then(function (img) {
                          var hPt = (y1 - y0) * k;
                          out.addPage([W, H]).drawImage(img, { x: M, y: H - M - hPt, width: W - 2 * M, height: hPt });
                        });
                      });
                    })(y, end);
                    y = end;
                  }
                  return chain;
                });
            })
            .then(function () { clearTimeout(timer); done(null, true); },
              function (e) { clearTimeout(timer); done(e); });
        };
        doc.head.appendChild(sc);
      };
      fr.src = '/api/pdf-download/' + encodeURIComponent(wid);
      document.body.appendChild(fr);
    });
  }

  // A kijelölt dokumentumok egy PDF-be, típus-csoportonként (a lista sorrendjében).
  function _pdf() {
    if (!window.PDFLib) { note(tt('wbd.noPdfLib', 'Biblioteca PDF nu este încărcată.'), 'err'); return; }
    var ids = [].slice.call(document.querySelectorAll('#wbdOv .wbd-sel:checked')).map(function (c) { return c.value; });
    if (!ids.length) { note(tt('wbd.selectSome', 'Selectează cel puțin un document.'), 'err'); return; }
    var btn = document.getElementById('wbdPdf');
    var P = window.PDFLib, skipped = [];
    P.PDFDocument.create().then(function (out) {
      var i = 0;
      var next = function () {
        if (i >= ids.length) return Promise.resolve();
        if (btn) { btn.disabled = true; btn.textContent = '⏳ ' + (i + 1) + '/' + ids.length; }
        var id = ids[i++];
        if (String(id).indexOf('wb:') === 0) {
          return renderWaybillInto(out, String(id).slice(3))
            .catch(function () { skipped.push(tt('wbd.waybillItself', '📋 Foaia de parcurs')); }).then(next);
        }
        return getDoc(id).then(function (d) {
          var mime = String(d.mime || '').toLowerCase();
          if (mime === 'application/pdf') {
            return P.PDFDocument.load(dataToBytes(d.data), { ignoreEncryption: true }).then(function (src) {
              return out.copyPages(src, src.getPageIndices()).then(function (pages) { pages.forEach(function (p) { out.addPage(p); }); });
            });
          }
          if (mime.indexOf('image/') === 0) {
            var emb = (mime === 'image/png') ? out.embedPng(dataToBytes(d.data))
              : (mime === 'image/jpeg' || mime === 'image/jpg') ? out.embedJpg(dataToBytes(d.data))
                : toJpeg(d.data).then(function (j) { return out.embedJpg(dataToBytes(j)); });
            return Promise.resolve(emb).then(function (img) {
              // A4 álló, a kép arányosan, margóval középre.
              var W = 595.28, H = 841.89, M = 24;
              var sc = Math.min((W - 2 * M) / img.width, (H - 2 * M) / img.height, 1);
              var w = img.width * sc, h = img.height * sc;
              out.addPage([W, H]).drawImage(img, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
            });
          }
          skipped.push(d.file_name);
        }).catch(function () { skipped.push(id); }).then(next);
      };
      return next().then(function () {
        if (!out.getPageCount()) throw new Error(tt('wbd.nothingPdf', 'Niciun document nu poate fi pus în PDF (doar PDF și imagini).'));
        return out.save();
      });
    }).then(function (bytes) {
      var w = (st.info && st.info.waybill) || {};
      var base = String(w.numar_fisa || w.id || 'foaie').replace(/[^\w.-]+/g, '_');
      saveBlob(new Blob([bytes], { type: 'application/pdf' }), base + '_documente.pdf');
      if (skipped.length) note(tt('wbd.skipped', 'Nu au putut fi incluse în PDF (descarcă-le separat): ') + skipped.join(', '), 'err');
      else note(tt('wbd.pdfDone', '✅ PDF descărcat'), 'ok');
    }).catch(function (e) { note(e.message || 'Eroare', 'err'); })
      .then(function () { if (btn) { btn.disabled = false; btn.textContent = tt('wbd.pdfBtn', '📄 Descarcă selecția într-un PDF'); } });
  }

  // A menetlevél-lista 📎 számlálójának frissítése.
  function refreshList() { try { if (typeof loadReceivedFuvarlevelek === 'function') loadReceivedFuvarlevelek(); } catch (e) {} }

  return {
    openUpload: openUpload, openManage: openManage, close: close,
    _stAdd: _stAdd, _stType: _stType, _stAll: _stAll, _stOrder: _stOrder, _stDel: _stDel, _send: _send,
    _selAll: _selAll, _upd: _upd, _del: _del, _dl: _dl, _view: _view, _pdf: _pdf
  };
})();
