// ============================================================
//  VallorSoft — public/order-chat.js
//  💬 Szöveges fuvarkiírás (AI-chat) — admin + manager.
//
//  Bal oldalt chat (a diszpécser szabad szöveggel leírja a fuvart, az AI
//  visszakérdez, kattintható válaszgombokkal), jobb oldalt EGYBEN a teljes
//  fuvar-előnézet (megrendelő, útvonal minden állomással, áru, kiosztás,
//  ár/km, hiányzó tételek). Javítás a chatben; mentés az előnézet gombjával
//  (`orderChatCreate` → a szerveren a meglévő `comCreate`).
//  Szerver: handlers/orderChat.js. Csomag-kapu: `ai-szoveges-fuvar` (Pro).
// ============================================================
(function () {
  'use strict';

  var S = { messages: [], draft: {}, questions: [], notes: [], missing: [], ready: false, busy: false, saved: null, uitDocs: {} };

  function T(k, v) { return (window.t ? window.t(k, v) : k); }
  function lang() { try { return (window.I18N && window.I18N.get()) || 'ro'; } catch (_) { return 'ro'; } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }
  function $(id) { return document.getElementById(id); }
  function _isMobile() { try { return window.matchMedia('(max-width: 860px)').matches; } catch (_) { return false; } }
  var _tab = 'chat';
  // Telefonon egyszerre egy panel látszik (chat VAGY előnézet) — asztalon mindkettő.
  function tab(which) {
    _tab = which === 'prev' ? 'prev' : 'chat';
    var m = $('ochModal'); if (!m) return;
    m.classList.toggle('och-show-prev', _tab === 'prev');
    var a = $('ochTabChat'), b = $('ochTabPrev');
    if (a) a.classList.toggle('on', _tab === 'chat');
    if (b) b.classList.toggle('on', _tab === 'prev');
    if (_tab === 'chat') { var box = $('ochMsgs'); if (box) box.scrollTop = box.scrollHeight; }
    else { var pv = $('ochPrev'); if (pv) pv.scrollTop = 0; }
  }
  // Fül-jelvény: ✅ ha kész, ⚠️N ha hiányzik valami, semmi ha még nincs adat.
  function renderTabBadge() {
    var bd = $('ochTabBadge'); if (!bd) return;
    var tb = $('ochTabPrev');
    if (S.saved || S.ready) { bd.textContent = '✅'; bd.className = 'och-tab-b ok'; }
    else if (S.messages.length && S.missing.length) { bd.textContent = '⚠️ ' + S.missing.length; bd.className = 'och-tab-b warn'; }
    else { bd.textContent = ''; bd.className = 'och-tab-b'; }
    if (tb) tb.classList.toggle('pulse', !!(S.ready && !S.saved && _tab !== 'prev'));
  }

  // ─── Dátum megjelenítés: 2026-10-12 · hétfő ───
  function fmtDate(d) {
    if (!d) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(d);
    if (!m) return esc(d);
    var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    var wd = '';
    try { wd = dt.toLocaleDateString(lang() === 'hu' ? 'hu-HU' : 'ro-RO', { weekday: 'long', timeZone: 'UTC' }); } catch (_) {}
    return esc(m[3] + '.' + m[2] + '.' + m[1]) + (m[4] ? ' ' + esc(m[4]) : '') + (wd ? ' <span class="och-wd">' + esc(wd) + '</span>' : '');
  }
  function fmtNum(n) { try { return Number(n).toLocaleString('ro-RO'); } catch (_) { return String(n); } }

  // ─── Modal váz ───
  function ensureModal() {
    var m = $('ochModal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'ochModal';
    m.className = 'modal-back';
    m.innerHTML = ''
      + '<div class="och-box">'
      +   '<div class="och-head">'
      +     '<div><div class="och-title">' + esc(T('och.title')) + '</div><div class="och-sub">' + esc(T('och.sub')) + '</div></div>'
      +     '<div class="och-head-btns">'
      +       '<button class="btn ghost och-reset" type="button" onclick="OrderChat.reset()" title="' + esc(T('och.reset')) + '">🔄<span class="och-reset-l"> ' + esc(T('och.reset').replace(/^🔄\s*/, '')) + '</span></button>'
      +       '<button class="btn ghost och-x" type="button" onclick="OrderChat.close()" aria-label="close">✕</button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="och-tabs" role="tablist">'
      +     '<button type="button" class="och-tab on" id="ochTabChat" onclick="OrderChat.tab(\'chat\')">💬 ' + esc(T('och.tabChat')) + '</button>'
      +     '<button type="button" class="och-tab" id="ochTabPrev" onclick="OrderChat.tab(\'prev\')">📋 ' + esc(T('och.tabPrev')) + ' <span class="och-tab-b" id="ochTabBadge"></span></button>'
      +   '</div>'
      +   '<div class="och-body">'
      +     '<div class="och-chat">'
      +       '<div class="och-msgs" id="ochMsgs"></div>'
      +       '<div class="och-qs" id="ochQs"></div>'
      +       '<div class="och-input">'
      +         '<textarea id="ochInput" rows="3" placeholder="' + esc(T(_isMobile() ? 'och.phMobile' : 'och.ph')) + '" autocomplete="off" data-lpignore="true" data-1p-ignore></textarea>'
      +         '<div class="och-send-col">'
      +           '<button class="btn primary" id="ochSend" type="button" onclick="OrderChat.send()">' + esc(T('och.send')) + '</button>'
      +           '<div class="och-uit-btns">'
      +             '<button class="btn ghost och-uit-btn" type="button" onclick="OrderChat.uit(\'camera\')" title="' + esc(T('och.uitPhotoTip')) + '">📷 UIT</button>'
      +             '<button class="btn ghost och-uit-btn" type="button" onclick="OrderChat.uit(\'file\')" title="' + esc(T('och.uitFileTip')) + '">📎 UIT</button>'
      +           '</div>'
      +         '</div>'
      +       '</div>'
      +     '</div>'
      +     '<div class="och-prev" id="ochPrev"></div>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(m);
    var ta = m.querySelector('#ochInput');
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    return m;
  }

  function open() {
    var m = ensureModal();
    // A téma a .main-content-en él; a body-hoz fűzött modal átveszi.
    var mc = document.getElementById('mainContent') || document.querySelector('.main-content');
    m.setAttribute('data-theme', (mc && mc.getAttribute('data-theme')) || 'light');
    m.classList.add('open');
    if (!S.messages.length) renderAll();
    setTimeout(function () { var ta = $('ochInput'); if (ta) ta.focus(); }, 50);
  }
  function close() {
    var m = $('ochModal');
    if (m) m.classList.remove('open');
  }
  function reset(force) {
    if (!force && S.messages.length && !S.saved && !window.confirm(T('och.resetAsk'))) return;
    S = { messages: [], draft: {}, questions: [], notes: [], missing: [], ready: false, busy: false, saved: null, uitDocs: {} };
    var m = $('ochModal');
    if (m) { m.remove(); }
    _tab = 'chat';
    open();
  }

  // ─── Render ───
  function renderMsgs() {
    var box = $('ochMsgs');
    if (!box) return;
    var h = '<div class="och-msg ai">' + esc(T('och.welcome')) + '<div class="och-mut" style="margin-top:6px;">✏️ ' + esc(T('och.editHint')) + '</div><div class="och-mut" style="margin-top:4px;">✉️ ' + esc(T('och.mailHint')) + '</div></div>';
    S.messages.forEach(function (m) {
      h += '<div class="och-msg ' + (m.role === 'assistant' ? 'ai' : 'me') + (m.err ? ' err' : '') + '">' + esc(m.text).replace(/\n/g, '<br>') + '</div>';
    });
    if (S.busy) h += '<div class="och-msg ai busy"><span class="och-dots"><i></i><i></i><i></i></span> ' + esc(T('och.thinking')) + '</div>';
    if (S.ready && !S.saved && !S.busy) {
      // Telefonon az előnézet külön fülön van — innen egy koppintással odaér.
      h += '<button type="button" class="och-ready-cta" onclick="OrderChat.tab(\'prev\')">✅ ' + esc(T('och.readyCta')) + ' →</button>';
    }
    if (S.saved && S.saved.mail) {
      h += '<div class="och-msg ai ok">' + esc(T('och.mailSent', { to: S.saved.to })) + '</div>';
    } else if (S.saved) {
      h += '<div class="och-msg ai ok">' + esc(T(S.saved.updated ? 'och.updated' : 'och.saved', { no: S.saved.fuvar_no || S.saved.id }))
        + '<div style="margin-top:8px;"><button class="btn primary" type="button" onclick="OrderChat.openList()">' + esc(T('och.openList')) + '</button></div></div>';
    }
    box.innerHTML = h;
    box.scrollTop = box.scrollHeight;
  }

  function renderQs() {
    var box = $('ochQs');
    if (!box) return;
    if (S.saved || !S.questions.length) { box.innerHTML = ''; return; }
    box.innerHTML = S.questions.map(function (q, qi) {
      var opts = (q.options || []).map(function (o, oi) {
        return '<button class="och-chip" type="button" onclick="OrderChat.pick(' + qi + ',' + oi + ')">' + esc(o) + '</button>';
      }).join('');
      return '<div class="och-q"><div class="och-q-t">❓ ' + esc(q.text) + '</div>' + (opts ? '<div class="och-chips">' + opts + '</div>' : '') + '</div>';
    }).join('');
  }

  function missingLabel(k) {
    var m = /^stop_(loc|date)_(\d+)$/.exec(k);
    if (m) return T(m[1] === 'loc' ? 'och.m.stopLoc' : 'och.m.stopDate', { n: (+m[2] + 1) });
    return T('och.m.' + k);
  }

  function row(label, val, extra) {
    return '<div class="och-row"><div class="och-l">' + esc(label) + '</div><div class="och-v">' + val + (extra || '') + '</div></div>';
  }
  function badge(txt, cls) { return ' <span class="och-badge ' + (cls || '') + '">' + esc(txt) + '</span>'; }

  function renderPrev() {
    var box = $('ochPrev');
    if (!box) return;
    var d = S.draft || {};
    if (d.mode === 'email') { box.innerHTML = renderMailPrev(d); return; }
    var stops = d.stops || [];
    var has = S.messages.length > 0;
    var h = '<div class="och-prev-h">' + esc(T('och.preview')) + '</div>';
    if (d.edit_order_id) h += '<div class="och-editbar">✏️ ' + esc(T('och.editing', { no: d.edit_fuvar_no || d.edit_order_id })) + '</div>';
    if (!has) { box.innerHTML = h + '<div class="och-empty">' + esc(T('och.previewEmpty')) + '</div>'; return; }

    // Megrendelő
    var cNote = '';
    (S.notes || []).forEach(function (n) {
      if (n.type === 'client_saved') cNote = badge(T('och.clientSaved'), 'ok');
      else if (n.type === 'client_existing' && !cNote) cNote = badge(T('och.clientKnown'), 'ok');
      else if (n.type === 'client_new' && !cNote) cNote = badge(T('och.clientNew'), 'warn');
      else if (n.type === 'anaf_error') cNote = badge(T('och.anafErr'), 'warn');
    });
    if (d.learned_client) cNote = badge(T('och.learned'), 'info') + cNote;
    if (!cNote && d.client_id) cNote = badge(T('och.clientKnown'), 'ok');
    var sec1 = row(T('och.client'), d.client ? '<b>' + esc(d.client) + '</b>' + (d.client_cui ? ' <span class="och-mut">CUI ' + esc(d.client_cui) + '</span>' : '') : '<span class="och-miss">' + esc(T('och.none')) + '</span>', cNote);
    if (d.ref) sec1 += row(T('och.ref'), esc(d.ref));

    // Útvonal — minden állomás egyben
    var st = '<div class="och-stops">';
    stops.forEach(function (s, i) {
      var pu = s.kind === 'pickup';
      st += '<div class="och-stop ' + (pu ? 'pu' : 'de') + '">'
        + '<div class="och-stop-n">' + (i + 1) + '</div>'
        + '<div class="och-stop-b">'
        +   '<div class="och-stop-k">' + (pu ? '⬆️ ' + esc(T('och.pickup')) : '⬇️ ' + esc(T('och.delivery')))
        +     ' · ' + (s.data ? fmtDate(s.data) : '<span class="och-miss">📅 ?</span>') + '</div>'
        +   '<div class="och-stop-f">' + (s.firma ? '🏢 ' + esc(s.firma) : '') + '</div>'
        +   '<div class="och-stop-a">📍 ' + (s.loc ? esc(s.loc) : '<span class="och-miss">?</span>') + (s.fav ? badge(T('och.fav'), 'info') : '') + (s.learned ? badge(T('och.learned'), 'info') : '') + '</div>'
        + '</div></div>';
    });
    if (!stops.length) st += '<div class="och-miss">' + esc(T('och.none')) + '</div>';
    st += '</div>';

    // Áru
    var cargo = d.load_type ? '<b>' + esc(d.load_type) + '</b>' + (d.learned_cargo ? badge(T('och.learned'), 'info') : '') : '<span class="och-miss">FTL / LTL ?</span>';
    var sec3 = row(T('och.cargo'), cargo);
    if (d.suly_kg) sec3 += row(T('och.weight'), esc(fmtNum(d.suly_kg)) + ' kg');
    if (d.hossz_cm || d.szel_cm || d.mag_cm) sec3 += row(T('och.dims'), esc((d.hossz_cm || '?') + '×' + (d.szel_cm || '?') + '×' + (d.mag_cm || '?')) + ' cm');

    // Kiosztás
    var sec4 = row(T('och.driver'), d.nume_sofer ? '<b>' + esc(d.nume_sofer) + '</b>' + (d.auto_driver ? badge(T('och.auto'), 'info') : '') + (d.learned_driver ? badge(T('och.learned'), 'info') : '') : '<span class="och-mut">' + esc(T('och.noDriver')) + '</span>');
    sec4 += row(T('och.truck'), d.rendszam_camion ? '<span class="och-plate">' + esc(d.rendszam_camion) + '</span>' + (d.auto_truck ? badge(T('och.auto'), 'info') : '') : esc(T('och.none')));
    sec4 += row(T('och.trailer'), d.rendszam_remorca ? '<span class="och-plate">' + esc(d.rendszam_remorca) + '</span>' + (d.auto_trailer ? badge(T('och.auto'), 'info') : '') : esc(T('och.none')));

    // Ár + km
    var km = d.km != null ? d.km : d.route_km;
    var sec5 = row(T('och.price'), d.pret != null ? '<b>' + esc(fmtNum(d.pret)) + ' EUR</b>' : esc(T('och.none')));
    var uits = d.uit_codes || [];
    var uitH = uits.map(function (c, i) {
      var doc = S.uitDocs[c];
      return '<span class="och-uit-chip">' + (doc ? (doc.mime === 'application/pdf' ? '📄 ' : '📷 ') : '') + esc(_uitFmt(c))
        + ' <button type="button" onclick="OrderChat.uitRemove(' + i + ')" title="✕">✕</button></span>';
    }).join('');
    if (d.edit_uit_existing) uitH += '<span class="och-mut"> ' + esc(T('och.uitExisting', { n: d.edit_uit_existing })) + '</span>';
    var secUit = row('🚛 UIT', uitH || '<span class="och-mut">' + esc(T('och.uitNone')) + '</span>');
    sec5 += row(T('och.km'), km != null ? esc(fmtNum(km)) + ' km' + (d.km == null ? badge(T('och.auto'), 'info') : '') : esc(T('och.none')));

    h += '<div class="och-card">'
      + '<div class="och-sec">' + sec1 + '</div>'
      + '<div class="och-sec"><div class="och-sec-h">🛣️ ' + esc(T('och.route')) + '</div>' + st + '</div>'
      + '<div class="och-sec">' + sec3 + '</div>'
      + '<div class="och-sec">' + sec4 + '</div>'
      + '<div class="och-sec">' + sec5 + '</div>'
      + '<div class="och-sec">' + secUit + '</div>'
      + '</div>';

    if (S.missing && S.missing.length && !S.saved) {
      h += '<div class="och-missbox">⚠️ ' + esc(T('och.missing')) + ': ' + S.missing.map(function (k) { return esc(missingLabel(k)); }).join(', ') + '</div>';
    }
    if (!S.saved) {
      h += '<div class="och-hint">' + esc(T('och.fixHint')) + '</div>'
        + '<button class="btn primary och-save" id="ochSave" type="button" onclick="OrderChat.save()"' + (S.ready && !S.busy ? '' : ' disabled') + '>' + esc(T(d.edit_order_id ? 'och.saveEdit' : 'och.save')) + '</button>';
    }
    box.innerHTML = h;
  }

  function renderAll() { renderMsgs(); renderQs(); renderPrev(); renderTabBadge(); }

  // ─── Küldés ───
  function send(textOverride) {
    if (S.busy || S.saved) return;
    var ta = $('ochInput');
    var text = String(textOverride != null ? textOverride : (ta ? ta.value : '')).trim();
    if (!text) return;
    if (ta && textOverride == null) ta.value = '';
    S.messages.push({ role: 'user', text: text });
    S.busy = true; S.questions = [];
    renderAll();
    var hist = S.messages.filter(function (m) { return !m.err; }).map(function (m) { return { role: m.role, text: m.text }; });
    window.gas('orderChatTurn', [{ messages: hist, draft: S.draft, lang: lang() }]).then(function (r) {
      S.busy = false;
      if (!r || !r.ok) {
        S.messages.push({ role: 'assistant', text: '⚠️ ' + ((r && r.err) || T('och.err')), err: true });
      } else {
        S.draft = r.draft || {};
        S.questions = r.questions || [];
        S.notes = (r.notes || []).concat((S.notes || []).filter(function (n) { return n.type === 'client_saved'; }));
        S.missing = r.missing || [];
        S.ready = !!r.ready;
        S.mail = r.mode === 'email' ? { att: r.attachments_avail || [], builders: r.builders_avail || [], tracking: !!r.tracking_available, client: r.client || '' } : null;
        if (r.reply) S.messages.push({ role: 'assistant', text: r.reply });
      }
      renderAll();
    }).catch(function (e) {
      S.busy = false;
      S.messages.push({ role: 'assistant', text: '⚠️ ' + ((e && e.message) || T('och.err')), err: true });
      renderAll();
    });
  }

  function pick(qi, oi) {
    var q = S.questions[qi];
    if (!q || !q.options || q.options[oi] == null) return;
    send(q.options[oi]);
  }

  function save() {
    if (S.draft && S.draft.mode === 'email') return mailSend(false);
    if (!S.ready || S.busy || S.saved) return;
    var btn = $('ochSave');
    if (btn) { btn.disabled = true; btn.textContent = T('och.saving'); }
    S.busy = true;
    var series = document.getElementById('oSeria');
    window.gas('orderChatCreate', [{ draft: S.draft, series_id: series && series.value ? series.value : null, uit_docs: _uitDocsFor(S.draft.uit_codes) }]).then(function (r) {
      S.busy = false;
      if (!r || !r.ok) {
        S.messages.push({ role: 'assistant', text: '⚠️ ' + ((r && r.err) || T('och.err')), err: true });
        if (r && r.missing) { S.missing = r.missing; S.ready = false; }
        renderAll();
        return;
      }
      S.saved = { id: r.id, fuvar_no: r.fuvar_no, updated: !!r.updated };
      tab('chat');
      if (typeof window.toast === 'function') window.toast(T(r.updated ? 'och.updated' : 'och.saved', { no: r.fuvar_no || r.id }), 'ok');
      if (typeof window.loadOrders === 'function') { try { window.loadOrders(); } catch (_) {} }
      renderAll();
    }).catch(function (e) {
      S.busy = false;
      S.messages.push({ role: 'assistant', text: '⚠️ ' + ((e && e.message) || T('och.err')), err: true });
      renderAll();
    });
  }

  function openList() {
    close();
    if (typeof window.activateTab === 'function') window.activateTab('orders-list');
    S = { messages: [], draft: {}, questions: [], notes: [], missing: [], ready: false, busy: false, saved: null, uitDocs: {} };
    var m = $('ochModal'); if (m) m.remove();
    _tab = 'chat';
  }

  // ─── 🚛 UIT: 📷 fotó / 📎 feltöltés (kép vagy PDF) → AI-kiolvasás ───
  // A kódok a vázlatba kerülnek (az AI is látja), a bizonylat csak a
  // böngészőben vár, és a mentéskor megy fel a kódok mellé.
  var DOCS_MAX = 15 * 1024 * 1024; // a kérés-korlát (20 MB) alatt
  function _uitFmt(c) { return (window.UitFmt && window.UitFmt.format) ? window.UitFmt.format(c) : c; }
  function _uitNorm(c) { return (window.UitFmt && window.UitFmt.normalize) ? window.UitFmt.normalize(c) : String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16); }
  function _uitDocsFor(codes) {
    var out = {}, total = 0;
    (codes || []).forEach(function (c) {
      var d = S.uitDocs[c];
      if (!d || total + d.b64.length > DOCS_MAX) return;
      out[c] = d; total += d.b64.length;
    });
    return out;
  }
  function uit(mode) {
    if (S.busy || S.saved) return;
    if (!window.UitScan) { S.messages.push({ role: 'assistant', text: '⚠️ ' + T('och.err'), err: true }); renderAll(); return; }
    window.UitScan.pick(mode).then(function (p) {
      if (!p) return;
      if (!p.codes.length) { S.messages.push({ role: 'assistant', text: '⚠️ ' + T('uitscan.none'), err: true }); renderAll(); return; }
      var list = (S.draft.uit_codes || []).slice(), added = [];
      p.codes.forEach(function (c) {
        var n = _uitNorm(c);
        if (!n) return;
        S.uitDocs[n] = { b64: p.b64, mime: p.mime };
        if (list.indexOf(n) === -1) { list.push(n); added.push(_uitFmt(n)); }
      });
      S.draft = Object.assign({}, S.draft, { uit_codes: list });
      S.messages.push({ role: 'assistant', text: '🚛 ' + T('och.uitAdded', { codes: added.length ? added.join(', ') : '—' }) });
      renderAll();
    }).catch(function (e) {
      S.messages.push({ role: 'assistant', text: '⚠️ ' + ((e && e.message) || T('och.err')), err: true });
      renderAll();
    });
  }
  function uitRemove(i) {
    var list = (S.draft.uit_codes || []).slice();
    var c = list.splice(i, 1)[0];
    if (c) delete S.uitDocs[c];
    S.draft = Object.assign({}, S.draft, { uit_codes: list });
    renderAll();
  }


  // ─── ✉️ E-mail mód (ugyanaz a chat — amit a felhasználó ír, abba kezd) ───
  // Szerver: handlers/mailChat.js (a küldés a meglévő sendOrderEmail-en).
  function renderMailPrev(d) {
    var M = S.mail || { att: [], builders: [], tracking: false };
    var h = '<div class="och-prev-h">✉️ ' + esc(T('och.mailPreview')) + (d.fuvar_no ? ' · <span class="och-plate">' + esc(d.fuvar_no) + '</span>' : '') + '</div>';
    if (!d.order_id) h += '<div class="och-mut" style="margin:-4px 0 8px;">' + esc(T('och.mailGeneral')) + '</div>';
    var to = d.to_email ? '<b>' + esc(d.to_email) + '</b>' + (d.recipient === 'client' ? badge(T('och.client'), 'info') : d.recipient === 'carrier' ? badge(T('och.carrier'), 'info') : d.recipient === 'named' && d.recipient_name ? badge(d.recipient_name, 'info') : '') + (d.learned_to ? badge(T('och.learned'), 'info') : '') : '<span class="och-miss">' + esc(T('och.none')) + '</span>';
    var sec = row(T('och.to'), to) + row(T('och.subject'), d.subject ? '<b>' + esc(d.subject) + '</b>' : '<span class="och-miss">' + esc(T('och.none')) + '</span>');
    var tpl = '';
    if (d.builder_template_id) {
      var b = (M.builders || []).filter(function (x) { return x.id === d.builder_template_id; })[0];
      tpl = row(T('och.template'), '🎨 ' + esc(b ? b.name : '#' + d.builder_template_id) + ' <button type="button" class="och-x-mini" onclick="OrderChat.mailToggle(\'tpl\')">✕</button>');
    }
    var body = '<div class="och-mail-body">' + (d.body ? esc(d.body).replace(/\n/g, '<br>') : '<span class="och-miss">' + esc(T('och.none')) + '</span>')
      + (d.include_tracking ? '<div class="och-mut" style="margin-top:8px;">🌍 ' + esc(T('och.trackingLine')) + '</div>' : '') + '</div>';
    var att = (M.att || []).map(function (a) {
      var on = (d.attachments || []).indexOf(a.key) >= 0;
      return '<button type="button" class="och-att' + (on ? ' on' : '') + '" onclick="OrderChat.mailToggle(\'att\',\'' + esc(a.key) + '\')">' + (on ? '✓ ' : '+ ') + esc(a.label) + '</button>';
    }).join('');
    if (M.tracking) {
      att += '<button type="button" class="och-att' + (d.include_tracking ? ' on' : '') + '" onclick="OrderChat.mailToggle(\'trk\')">' + (d.include_tracking ? '✓ ' : '+ ') + '🌍 ' + esc(T('och.tracking')) + '</button>';
    }
    h += '<div class="och-card"><div class="och-sec">' + sec + tpl + '</div>'
      + '<div class="och-sec"><div class="och-sec-h">📝 ' + esc(T('och.mailBody')) + '</div>' + body + '</div>'
      + (d.order_id ? '<div class="och-sec"><div class="och-sec-h">📎 ' + esc(T('och.attach')) + '</div><div class="och-atts">' + (att || '<span class="och-mut">' + esc(T('och.none')) + '</span>') + '</div></div>' : '')
      + '</div>';
    if (S.missing && S.missing.length && !S.saved) {
      h += '<div class="och-missbox">⚠️ ' + esc(T('och.missing')) + ': ' + S.missing.map(function (k) { return esc(missingLabel(k)); }).join(', ') + '</div>';
    }
    if (!S.saved) {
      h += '<div class="och-hint">' + esc(T('och.mailFixHint')) + '</div>'
        + '<div class="och-mail-btns">'
        + '<button class="btn ghost" type="button" onclick="OrderChat.mailSend(true)"' + (d.body && !S.busy ? '' : ' disabled') + '>✉️ ' + esc(T('och.sendTest')) + '</button>'
        + '<button class="btn primary och-save" id="ochSave" type="button" onclick="OrderChat.mailSend(false)"' + (S.ready && !S.busy ? '' : ' disabled') + '>📤 ' + esc(T('och.mailSend')) + '</button>'
        + '</div>';
    }
    return h;
  }
  function mailToggle(what, key) {
    if (S.saved || S.busy) return;
    var d = Object.assign({}, S.draft);
    if (what === 'att') {
      var l = (d.attachments || []).slice(), i = l.indexOf(key);
      if (i >= 0) l.splice(i, 1); else l.push(key);
      d.attachments = l;
    } else if (what === 'trk') d.include_tracking = !d.include_tracking;
    else if (what === 'tpl') d.builder_template_id = null;
    S.draft = d;
    renderPrev();
  }
  function mailSend(test) {
    var d = S.draft || {};
    if (S.busy || S.saved || !d.body) return;
    if (!test) {
      if (!S.ready) return;
      if (!window.confirm(T('och.mailConfirm', { to: d.to_email }))) return;
    }
    S.busy = true; renderAll();
    window.gas('mailChatSend', [{ draft: d, test: !!test, lang: lang() }]).then(function (r) {
      S.busy = false;
      if (!r || !r.ok) {
        S.messages.push({ role: 'assistant', text: '⚠️ ' + ((r && r.err) || T('och.err')), err: true });
      } else if (test) {
        S.messages.push({ role: 'assistant', text: '✉️ ' + T('och.mailTestSent') });
        if (typeof window.toast === 'function') window.toast(T('och.mailTestSent'), 'ok');
      } else {
        S.saved = { mail: true, to: d.to_email };
        tab('chat');
        if (typeof window.toast === 'function') window.toast(T('och.mailSent', { to: d.to_email }), 'ok');
      }
      renderAll();
    }).catch(function (e) {
      S.busy = false;
      S.messages.push({ role: 'assistant', text: '⚠️ ' + ((e && e.message) || T('och.err')), err: true });
      renderAll();
    });
  }

  // ─── Lebegő gomb (mint a 🐛 hibabejelentő) — minden fülön látszik ───
  // A csomag-kapu (`ai-szoveges-fuvar`) után kapcsolja be az applyFeatureFlags.
  function setFab(visible) {
    var b = $('ochFab');
    if (!b) {
      if (!visible) return;
      b = document.createElement('button');
      b.id = 'ochFab';
      b.type = 'button';
      b.className = 'och-fab';
      b.setAttribute('data-i18n-title', 'och.fab');
      b.title = T('och.fab');
      b.setAttribute('aria-label', T('och.fab'));
      b.innerHTML = '<span class="och-fab-i">💬</span><span class="och-fab-t">AI</span>';
      b.addEventListener('click', open);
      document.body.appendChild(b);
    }
    b.style.display = visible ? '' : 'none';
  }

  window.OrderChat = { open: open, close: close, reset: reset, send: send, pick: pick, save: save, openList: openList, tab: tab, uit: uit, uitRemove: uitRemove, setFab: setFab, mailSend: mailSend, mailToggle: mailToggle };
})();
