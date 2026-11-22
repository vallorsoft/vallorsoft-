// ============================================================
//  VallorSoft — public/doc-inbox.js
//  📥 Csoportos irat-feltöltés a menetlevelekhez: egyszerre sok (akár 50) számla /
//  megrendelő; a szerver helyben kiolvassa és a hiányos menetlevelek fuvarjaihoz
//  párosítja (lib/docInbox). 3 sikertelen próbálkozás után kézi párosítás vagy törlés.
//  Szerver: handlers/docInbox.js. Belépés: a FUVARLEVELEK oldal tetején (DocInbox.mount).
// ============================================================
window.DocInbox = (function () {
  var MAX_FILES = 50;
  var MAX_FILE = 15 * 1024 * 1024;
  var st = { data: null, polling: null, pollUntil: 0, asked: false, uploading: false };
  var SLOT_FB = { client_order: 'Comanda clientului', client_invoice: 'Factura către client',
    carrier_order: 'Comanda către subcontractor', carrier_invoice: 'Factura subcontractorului' };

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
  function slotLabel(s) { return tt('wdc.slot.' + s, SLOT_FB[s] || s); }
  function targetLabel(x) {
    return (x.numar_fisa || x.waybill_id) + ' · ' + (x.fuvar_no || x.order_id) + (x.client ? ' · ' + x.client : '') + ' · ' + slotLabel(x.slot);
  }

  function ensureStyle() {
    if (document.getElementById('dib-style')) return;
    var s = document.createElement('style');
    s.id = 'dib-style';
    s.textContent =
      '.dib-card{padding:18px 22px;margin-bottom:16px}.dib-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}' +
      '.dib-stat{font-size:12.5px;font-weight:700;padding:4px 10px;border-radius:999px}' +
      '.dib-s-p{background:rgba(59,130,246,.14);color:#1d4ed8}.dib-s-u{background:rgba(239,68,68,.14);color:#b91c1c}.dib-s-m{background:rgba(34,197,94,.14);color:#15803d}' +
      '.main-content[data-theme="dark"] .dib-s-p{color:#93c5fd}.main-content[data-theme="dark"] .dib-s-u{color:#fca5a5}.main-content[data-theme="dark"] .dib-s-m{color:#86efac}' +
      '.dib-prog{font-size:12.5px;font-weight:600;color:var(--muted)}' +
      '.dib-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:14px}' +
      '.dib-mod{background:#fff;color:#0f172a;border-radius:16px;padding:20px;width:100%;max-width:820px;max-height:92vh;overflow:auto;box-shadow:0 24px 60px rgba(15,23,42,.3);box-sizing:border-box}' +
      '.dib-mod h3{margin:0 0 4px;font-size:18px;color:#0f172a}.dib-sub{font-size:12.5px;color:#334155;margin-bottom:12px}' +
      '.dib-ask{border:1.5px solid #fca5a5;background:#fef2f2;color:#7f1d1d;border-radius:12px;padding:10px 14px;font-weight:600;font-size:13px;margin-bottom:12px}' +
      '.dib-grp{font-size:12px;font-weight:800;color:#1d4ed8;text-transform:uppercase;letter-spacing:.4px;margin:14px 0 6px}' +
      '.dib-it{border:1.5px solid #cbd5e1;border-radius:12px;padding:10px 12px;margin-bottom:8px;background:#fff}' +
      '.dib-it b{font-size:13px;word-break:break-word;color:#0f172a}.dib-meta{font-size:11.5px;color:#475569;margin-top:2px}' +
      '.dib-act{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px}' +
      '.dib-act select{flex:1 1 260px;min-width:0;padding:7px 8px;border:1.5px solid #94a3b8;border-radius:8px;font-size:13px;background:#fff;color:#0f172a}' +
      '.dib-act button{padding:7px 11px;border-radius:8px;border:1.5px solid #64748b;background:#fff;color:#0f172a;cursor:pointer;font-size:13px;font-weight:600}' +
      '.dib-act button.ok{background:#15803d;border-color:#15803d;color:#fff}.dib-act button.del{border-color:#b91c1c;color:#b91c1c}' +
      '.dib-foot{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}' +
      '.dib-empty{padding:16px;text-align:center;color:#475569}';
    document.head.appendChild(s);
  }

  // ─── A kártya a FUVARLEVELEK oldal tetején ─────────────────
  function mount() {
    ensureStyle();
    var pane = document.querySelector('.pane[data-pane="received-fuv"]');
    if (!pane) return;
    var card = document.getElementById('dibCard');
    if (!card) {
      card = document.createElement('div');
      card.id = 'dibCard';
      card.className = 'glass dib-card';
      pane.insertBefore(card, pane.firstChild);
    }
    card.innerHTML =
      '<h2 class="h-title" style="margin-top:0;">📥 ' + esc(tt('dib.title', 'Încărcare documente în grup')) + '</h2>' +
      '<p style="color:var(--muted);font-size:13px;margin:0 0 12px;">' + esc(tt('dib.hint', 'Încarcă deodată până la 50 de facturi și comenzi (PDF / poză), amestecate. Sistemul le citește local (fără AI) și le pune la foaia de parcurs și cursa corespunzătoare, dacă găsește potrivire.')) + '</p>' +
      '<div class="dib-row">' +
        '<label class="btn primary" style="cursor:pointer;">📤 ' + esc(tt('dib.pick', 'Alege documentele')) +
          '<input type="file" id="dibFile" multiple accept="application/pdf,image/png,image/jpeg,image/webp" style="display:none" onchange="DocInbox._pick(this.files);this.value=\'\'"></label>' +
        '<button class="btn ghost" onclick="DocInbox.open()">🗂️ ' + esc(tt('dib.openList', 'Lista documentelor')) + '</button>' +
        (window.DocArchive ? '<button class="btn ghost" onclick="DocArchive.open()">📦 ' + esc(tt('dar.open', 'Arhiva documentelor')) + '</button>' : '') +
        '<span id="dibStats"></span><span id="dibProg" class="dib-prog"></span>' +
      '</div>';
    refresh(true);
  }

  function renderStats() {
    var el = document.getElementById('dibStats');
    var c = (st.data && st.data.counts) || {};
    if (!el) return;
    var h = '';
    if (c.pending) h += '<span class="dib-stat dib-s-p">⏳ ' + esc(tt('dib.nPending', '{n} în procesare', { n: c.pending })) + '</span> ';
    if (c.unmatched) h += '<span class="dib-stat dib-s-u">❓ ' + esc(tt('dib.nUnmatched', '{n} fără potrivire', { n: c.unmatched })) + '</span> ';
    if (c.matched) h += '<span class="dib-stat dib-s-m">✅ ' + esc(tt('dib.nMatched', '{n} asociate', { n: c.matched })) + '</span>';
    el.innerHTML = h;
  }

  function refresh(fromMount) {
    return gas('docInboxList', []).then(function (r) {
      if (!r || !r.ok) return;
      st.data = r;
      renderStats();
      if (document.getElementById('dibOv')) renderModal();
      // 3 sikertelen próbálkozás után rákérdezünk (egyszer / oldal-megnyitás).
      if (fromMount && !st.asked && r.counts && r.counts.unmatched) { st.asked = true; open(); }
      var pending = (r.counts && r.counts.pending) || 0;
      if (pending && Date.now() < st.pollUntil) schedulePoll();
    }).catch(function () {});
  }
  function schedulePoll() {
    if (st.polling) return;
    st.polling = setTimeout(function () { st.polling = null; refresh(false); }, 4000);
  }

  // ─── Feltöltés ─────────────────────────────────────────────
  function readDataUrl(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(new Error('read')); };
      r.readAsDataURL(file);
    });
  }
  function _pick(files) {
    if (st.uploading) return;
    var list = [].slice.call(files || []);
    if (!list.length) return;
    if (list.length > MAX_FILES) { note(tt('dib.tooMany', 'Maxim {n} fișiere odată.', { n: MAX_FILES }), 'err'); list = list.slice(0, MAX_FILES); }
    var bad = list.filter(function (f) { return f.size > MAX_FILE; });
    list = list.filter(function (f) { return f.size <= MAX_FILE; });
    if (bad.length) note(tt('wbd.tooBigMsg', 'Unele fișiere depășesc 15 MB: ') + bad.map(function (f) { return f.name; }).join(', '), 'err');
    if (!list.length) return;
    st.uploading = true;
    var ids = [], failed = [];
    var prog = document.getElementById('dibProg');
    var step = function (i) {
      if (i >= list.length) {
        st.uploading = false;
        if (prog) prog.textContent = '';
        if (failed.length) note(tt('wbd.someFailed', 'Nu s-au încărcat: ') + failed.join(', '), 'err');
        if (!ids.length) return;
        gas('docInboxProcess', [{ ids: ids }]).then(function () {
          note(tt('dib.uploaded', '✅ {n} document(e) încărcat(e) — se asociază în fundal', { n: ids.length }), 'ok');
          st.pollUntil = Date.now() + 5 * 60 * 1000;
          refresh(false);
        });
        return;
      }
      if (prog) prog.textContent = '⏳ ' + (i + 1) + '/' + list.length;
      var f = list[i];
      readDataUrl(f).then(function (data) {
        return gas('docInboxUpload', [{ file_name: f.name, data: data }]);
      }).then(function (r) {
        if (r && r.ok) ids.push(r.id); else failed.push(f.name + (r && r.err ? ' (' + r.err + ')' : ''));
      }).catch(function () { failed.push(f.name); }).then(function () { step(i + 1); });
    };
    step(0);
  }

  // ─── Lista-ablak ───────────────────────────────────────────
  function open() {
    ensureStyle();
    if (!document.getElementById('dibOv')) {
      var ov = document.createElement('div');
      ov.id = 'dibOv';
      ov.className = 'dib-ov';
      ov.innerHTML = '<div class="dib-mod vs-light-surface" id="dibMod"></div>';
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      document.body.appendChild(ov);
    }
    if (st.data) renderModal(); else refresh(false);
    if (!st.data) document.getElementById('dibMod').innerHTML = '<div class="dib-empty">⏳</div>';
  }
  function close() { var o = document.getElementById('dibOv'); if (o) o.remove(); }

  function guessText(g) {
    if (!g) return tt('dib.noGuess', 'nicio potrivire găsită');
    return tt('dib.bestGuess', 'cea mai apropiată: {f} · {p}%', { f: (g.fuvar_no || g.order_id) + ' · ' + slotLabel(g.slot), p: g.score });
  }

  function renderModal() {
    var mod = document.getElementById('dibMod');
    if (!mod) return;
    var d = st.data || { items: [], targets: [], counts: {} };
    var items = d.items || [], targets = d.targets || [];
    var maxA = d.max_attempts || 3;
    var un = items.filter(function (x) { return x.status === 'unmatched'; });
    var pe = items.filter(function (x) { return x.status === 'pending'; });
    var ma = items.filter(function (x) { return x.status === 'matched'; });
    var h = '<h3>📥 ' + esc(tt('dib.title', 'Încărcare documente în grup')) + '</h3>' +
      '<div class="dib-sub">' + esc(tt('dib.listHint', 'Documentele se asociază automat cu foile de parcurs incomplete. Fiecare document are {n} încercări (la încărcare și în fundal, la 10 minute).', { n: maxA })) + '</div>';
    if (un.length) {
      h += '<div class="dib-ask">❓ ' + esc(tt('dib.ask', '{n} document(e) nu au putut fi asociate nici după {a} încercări. Le asociezi manual? Altfel șterge-le.', { n: un.length, a: maxA })) + '</div>';
      h += '<div class="dib-grp">❓ ' + esc(tt('dib.grpUnmatched', 'Fără potrivire')) + ' (' + un.length + ')</div>';
      un.forEach(function (x) {
        var opts = '<option value="">— ' + esc(tt('dib.chooseTarget', 'Alege foaia de parcurs / cursa / tipul')) + ' —</option>' +
          targets.map(function (tg, i) {
            var g = x.best_guess;
            var sel = g && g.waybill_id === tg.waybill_id && g.order_id === tg.order_id && g.slot === tg.slot;
            return '<option value="' + i + '"' + (sel ? ' selected' : '') + '>' + esc(targetLabel(tg)) + '</option>';
          }).join('');
        h += '<div class="dib-it"><b>' + esc(x.file_name) + '</b>' +
          '<div class="dib-meta">' + esc(guessText(x.best_guess)) + (x.text_status === 'scanned' || x.text_status === 'image' ? ' · ' + esc(tt('wdc.unreadable', 'nu se poate citi')) : '') + '</div>' +
          '<div class="dib-act">' + (targets.length ? '<select id="dibT' + x.id + '">' + opts + '</select>' +
            '<button class="ok" onclick="DocInbox._assign(' + x.id + ')">✓ ' + esc(tt('dib.assign', 'Asociază')) + '</button>' :
            '<span class="dib-meta">' + esc(tt('dib.noTargets', 'Nu există foi de parcurs cu documente lipsă.')) + '</span>') +
            '<button onclick="DocInbox._retry(' + x.id + ')">🔄 ' + esc(tt('dib.retry', 'Încă o dată')) + '</button>' +
            '<button class="del" onclick="DocInbox._del(' + x.id + ')">🗑 ' + esc(tt('dib.delete', 'Șterge')) + '</button></div></div>';
      });
    }
    if (pe.length) {
      h += '<div class="dib-grp">⏳ ' + esc(tt('dib.grpPending', 'În procesare')) + ' (' + pe.length + ')</div>';
      pe.forEach(function (x) {
        h += '<div class="dib-it"><b>' + esc(x.file_name) + '</b><div class="dib-meta">' +
          esc(tt('dib.attempt', 'încercarea {a} / {m}', { a: x.attempts || 0, m: maxA })) + (x.best_guess ? ' · ' + esc(guessText(x.best_guess)) : '') + '</div>' +
          '<div class="dib-act"><button class="del" onclick="DocInbox._del(' + x.id + ')">🗑 ' + esc(tt('dib.delete', 'Șterge')) + '</button></div></div>';
      });
    }
    if (ma.length) {
      h += '<div class="dib-grp">✅ ' + esc(tt('dib.grpMatched', 'Asociate')) + ' (' + ma.length + ')</div>';
      ma.forEach(function (x) {
        h += '<div class="dib-it"><b>' + esc(x.file_name) + '</b><div class="dib-meta">→ ' +
          esc((x.matched_numar_fisa || x.matched_waybill_id || '') + ' · ' + (x.matched_fuvar_no || x.matched_order_id || '')) +
          ' · ' + esc(x.matched_by === 'manual' ? tt('dib.byManual', 'manual') : tt('dib.byAuto', 'automat') + (x.matched_conf ? ' ' + x.matched_conf + '%' : '')) + '</div></div>';
      });
    }
    if (!items.length) h += '<div class="dib-empty">' + esc(tt('dib.empty', 'Nu există documente încărcate în grup.')) + '</div>';
    h += '<div class="dib-foot">' +
      (un.length ? '<button class="btn ghost" style="color:#b91c1c;border-color:#b91c1c;" onclick="DocInbox._delAll(\'unmatched\')">🗑 ' + esc(tt('dib.delAllUnmatched', 'Șterge toate fără potrivire')) + '</button>' : '') +
      (ma.length ? '<button class="btn ghost" onclick="DocInbox._delAll(\'matched\')">' + esc(tt('dib.clearMatched', 'Golește lista celor asociate')) + '</button>' : '') +
      '<button class="btn primary" onclick="DocInbox.close()">' + esc(tt('common.close', 'Închide')) + '</button></div>';
    mod.innerHTML = h;
  }

  function after(r) {
    if (!r || !r.ok) { note((r && r.err) || 'Eroare', 'err'); return; }
    refresh(false);
    try { if (typeof loadReceivedFuvarlevelek === 'function') loadReceivedFuvarlevelek(); } catch (e) {}
  }
  function _assign(id) {
    var sel = document.getElementById('dibT' + id);
    var tg = sel && sel.value !== '' ? ((st.data && st.data.targets) || [])[parseInt(sel.value, 10)] : null;
    if (!tg) { note(tt('dib.chooseTarget', 'Alege foaia de parcurs / cursa / tipul'), 'err'); return; }
    gas('docInboxAssign', [{ id: id, waybill_id: tg.waybill_id, order_id: tg.order_id, slot: tg.slot }]).then(function (r) {
      if (r && r.ok) note(tt('dib.assigned', '✅ Document asociat'), 'ok');
      after(r);
    });
  }
  function _retry(id) {
    gas('docInboxRetry', [{ id: id }]).then(function (r) { st.pollUntil = Date.now() + 3 * 60 * 1000; after(r); });
  }
  function _del(id) {
    if (!confirm(tt('dib.delConfirm', 'Ștergi definitiv acest document?'))) return;
    gas('docInboxDelete', [{ id: id }]).then(after);
  }
  function _delAll(scope) {
    var msg = scope === 'unmatched' ? tt('dib.delAllConfirm', 'Ștergi definitiv toate documentele fără potrivire?')
      : tt('dib.clearConfirm', 'Golești lista? Documentele asociate rămân la curse.');
    if (!confirm(msg)) return;
    gas('docInboxDelete', [{ scope: scope }]).then(after);
  }

  return { mount: mount, open: open, close: close, refresh: refresh,
    _pick: _pick, _assign: _assign, _retry: _retry, _del: _del, _delAll: _delAll };
})();
