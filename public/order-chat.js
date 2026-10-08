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
      +           (_speechOk() ? '<button class="btn ghost och-mic" id="ochMic" type="button" onclick="OrderChat.mic()" title="' + esc(T('och.micTip')) + '">🎤</button>' : '')
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
    var h = '<div class="och-msg ai">' + esc(T('och.welcome')) + '<div class="och-mut" style="margin-top:6px;">✏️ ' + esc(T('och.editHint')) + '</div><div class="och-mut" style="margin-top:4px;">✉️ ' + esc(T('och.mailHint')) + '</div><div class="och-mut" style="margin-top:4px;">📍 ' + esc(T('och.infoHint')) + '</div><div class="och-mut" style="margin-top:4px;">⚡ ' + esc(T('och.opsHint')) + '</div></div>';
    S.messages.forEach(function (m) {
      // m.html: a szerver által renderelt (escape-elt) sofőr-információs kártya.
      h += '<div class="och-msg ' + (m.role === 'assistant' ? 'ai' : 'me') + (m.err ? ' err' : '') + (m.sys ? ' sys' : '') + (m.html ? ' info' : '') + '">'
        + (m.html ? '<div class="och-info-reply">' + esc(m.text) + '</div>' + m.html : esc(m.text).replace(/\n/g, '<br>')) + '</div>';
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
    _applyActed(box);
    box.scrollTop = box.scrollHeight;
  }
  function _applyActed(box) {
    var acted = S.acted || {};
    Array.prototype.forEach.call(box.querySelectorAll('[data-tok]'), function (b) {
      if (acted[b.getAttribute('data-tok')]) { b.disabled = true; b.classList.add('och-act-used'); }
    });
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
  // A napi összefoglaló NEM nyílik meg magától — csak kérésre („mai teendők”, „napi összefoglaló”),
  // a chatOps.detectCompany BRIEF_RE ágán.

  // ─── 📎 Dokumentum feltöltése a chat-kártyáról → a meglévő feltöltő ablak ───
  function docUp(btn) {
    if (!window.OrderDocs || !window.OrderDocs.openUpload) {
      S.messages.push({ role: 'assistant', text: '⚠️ ' + T('och.docOff'), err: true, local: true }); renderMsgs(); return;
    }
    var oid = btn && btn.getAttribute('data-oid');
    window.OrderDocs.openUpload(oid || null, (btn && btn.getAttribute('data-lbl')) || null, (btn && btn.getAttribute('data-dt')) || null);
  }

  // ─── Megerősítést kérő chat-művelet (✅ / ✕ gomb a kártyán) ───
  function act(btn) {
    var tok = btn && btn.getAttribute('data-tok');
    if (!tok || S.busy || (S.acted || {})[tok]) return;
    var args = { token: tok, lang: lang() };
    var inpId = btn.getAttribute('data-input');
    if (inpId) {
      var inp = $(inpId);
      var v = inp ? String(inp.value || '').trim() : '';
      if (!v) { if (inp) inp.focus(); S.messages.push({ role: 'assistant', text: '⚠️ ' + T('och.needClient'), err: true }); renderMsgs(); return; }
      args.client_name = v;
    }
    S.acted = S.acted || {};
    S.acted[tok] = 'busy';
    S.busy = true; renderMsgs();
    window.gas('orderChatAction', [args]).then(function (r) {
      S.busy = false;
      if (r && r.ok) {
        S.acted[tok] = 'done';
        S.messages.push({ role: 'assistant', sys: true, text: r.reply || '✅', local: true });
        if (typeof window.loadOrders === 'function' && r.order_id) { try { window.loadOrders(); } catch (_) {} }
      } else {
        delete S.acted[tok];
        S.messages.push({ role: 'assistant', text: '⚠️ ' + ((r && r.err) || T('och.err')), err: true });
      }
      renderMsgs();
    }).catch(function (e) {
      S.busy = false; delete S.acted[tok];
      S.messages.push({ role: 'assistant', text: '⚠️ ' + ((e && e.message) || T('och.err')), err: true });
      renderMsgs();
    });
  }
  function actCancel(btn) {
    var tok = btn && btn.getAttribute('data-tok');
    if (!tok || (S.acted || {})[tok]) return;
    S.acted = S.acted || {};
    S.acted[tok] = 'cancel';
    S.messages.push({ role: 'assistant', sys: true, text: T('och.actCancelled'), local: true });
    renderMsgs();
  }
  // Árajánlatból fuvar: a szöveg a beíró mezőbe kerül (a felhasználó küldi el).
  function prefill(btn) {
    var txt = btn && btn.getAttribute('data-text');
    var ta = $('ochInput');
    if (!txt || !ta) return;
    ta.value = txt; ta.focus();
    if (_isMobile()) tab('chat');
  }

  // ─── 🎤 Hangbevitel (Web Speech API; ha nincs, a gomb nem jelenik meg) ───
  function _speechOk() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
  var _rec = null;
  function mic() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    var btn = $('ochMic');
    if (_rec) { try { _rec.stop(); } catch (_) {} return; }
    var ta = $('ochInput');
    var base = ta ? ta.value : '';
    _rec = new SR();
    _rec.lang = lang() === 'hu' ? 'hu-HU' : 'ro-RO';
    _rec.interimResults = true;
    _rec.continuous = false;
    _rec.onresult = function (e) {
      var txt = '';
      for (var i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      if (ta) ta.value = (base ? base.replace(/\s+$/, '') + ' ' : '') + txt;
    };
    _rec.onend = function () { _rec = null; if (btn) btn.classList.remove('rec'); if (ta) ta.focus(); };
    _rec.onerror = function () { _rec = null; if (btn) btn.classList.remove('rec'); };
    if (btn) btn.classList.add('rec');
    try { _rec.start(); } catch (_) { _rec = null; if (btn) btn.classList.remove('rec'); }
  }

  function send(textOverride) {
    if (S.busy || S.saved) return;
    var ta = $('ochInput');
    var text = String(textOverride != null ? textOverride : (ta ? ta.value : '')).trim();
    if (!text) return;
    if (ta && textOverride == null) ta.value = '';
    S.messages.push({ role: 'user', text: text });
    S.busy = true;
    if (S._draftQs) { S.questions = S._draftQs; S._draftQs = null; }
    var _keepQs = S.questions; S.questions = [];
    renderAll();
    var hist = S.messages.filter(function (m) { return !m.err; }).map(function (m) { return { role: m.role, text: m.text, local: !!m.local }; });
    window.gas('orderChatTurn', [{ messages: hist, draft: S.draft, lang: lang() }]).then(function (r) {
      S.busy = false;
      if (!r || !r.ok) {
        S.messages.push({ role: 'assistant', text: '⚠️ ' + ((r && r.err) || T('och.err')), err: true });
      } else if (r.info) {
        // Sofőr-kérdés válasza: a fuvar-vázlat / előnézet érintetlen marad.
        // AI nélkül megválaszolt kérdés: a kérdés és a válasz sem megy később az AI-hoz.
        for (var li = S.messages.length - 1; li >= 0; li--) { if (S.messages[li].role === 'user') { S.messages[li].local = true; break; } }
        S.messages.push({ role: 'assistant', text: r.reply || '', html: r.info_html || '', local: true });
        if (r.questions && r.questions.length) { S._draftQs = _keepQs; S.questions = r.questions; }
        else S.questions = _keepQs;
      } else {
        S._draftQs = null;
        S.draft = r.draft || {};
        S.questions = r.questions || [];
        S.notes = (r.notes || []).concat((S.notes || []).filter(function (n) { return n.type === 'client_saved'; }));
        S.missing = r.missing || [];
        S.ready = !!r.ready;
        S.mail = r.mode === 'email' ? { att: r.attachments_avail || [], builders: r.builders_avail || [], tracking: !!r.tracking_available, client: r.client || '' } : null;
        S.mailHtml = r.mode === 'email' ? (r.preview_html || '') : '';
        S.placeholders = r.placeholders || [];
        if (r.reply) S.messages.push({ role: 'assistant', text: r.reply });
        // A ténylegesen megtörtént változások — a rendszer írja, nem az AI.
        if (r.changes && r.changes.length) {
          S.messages.push({ role: 'assistant', sys: true, text: r.changes.map(function (c) { return /^[⛔⚠️]/.test(c) ? c : '✅ ' + c; }).join('\n') });
        }
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

  // Az információs kártya „Fuvar megnyitása" gombja: a chat bezárul (állapota
  // megmarad), a fuvar-adatlap nyílik.
  function openOrder(id) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(id || ''))) return;
    close();
    if (window.EntityDetail && typeof window.EntityDetail.openOrder === 'function') window.EntityDetail.openOrder(id);
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
    if (d.reply_mail_id) h += '<div class="och-editbar">↩️ ' + esc(T('och.replyBar')) + '</div><div class="och-mut" style="margin:-4px 0 8px;">🔒 ' + esc(T('och.replyPrivacy')) + '</div>';
    else if (!d.order_id) h += '<div class="och-mut" style="margin:-4px 0 8px;">' + esc(T('och.mailGeneral')) + '</div>';
    var to = d.to_email ? '<b>' + esc(d.to_email) + '</b>' + (d.recipient === 'client' ? badge(T('och.client'), 'info') : d.recipient === 'carrier' ? badge(T('och.carrier'), 'info') : d.recipient === 'named' && d.recipient_name ? badge(d.recipient_name, 'info') : '') + (d.learned_to ? badge(T('och.learned'), 'info') : '') : '<span class="och-miss">' + esc(T('och.none')) + '</span>';
    var sec = row(T('och.to'), to) + row(T('och.subject'), d.subject ? '<b>' + esc(d.subject) + '</b>' : '<span class="och-miss">' + esc(T('och.none')) + '</span>');
    var tpl = '';
    if (d.builder_template_id) {
      var b = (M.builders || []).filter(function (x) { return x.id === d.builder_template_id; })[0];
      tpl = row(T('och.template'), '🎨 ' + esc(b ? b.name : '#' + d.builder_template_id) + ' <button type="button" class="och-x-mini" onclick="OrderChat.mailToggle(\'tpl\')">✕</button>');
    }
    var inner = (d.body ? esc(d.body).replace(/\n/g, '<br>') : '<span class="och-miss">' + esc(T('och.none')) + '</span>')
      + (d.include_tracking ? '<div style="margin-top:8px;opacity:.75;">🌍 ' + esc(T('och.trackingLine')) + '</div>' : '');
    var body = d.builder_template_id ? '<div class="och-mail-body">' + inner + '</div>'
      : (S.mailHtml ? '<div class="och-mail-real">' + S.mailHtml + '</div>' : _styledPreview(inner, d.style));
    var cardsH = (d.cards || []).map(function (c) {
      return '<span class="och-uit-chip">🚚 ' + esc(c.ref) + ' <button type="button" onclick="OrderChat.mailToggle(\'card\',\'' + esc(c.ref) + '\')" title="✕">✕</button></span>';
    }).join('');
    if (cardsH) body = '<div class="och-mut" style="margin:0 0 6px;">' + esc(T('och.cards')) + ': ' + cardsH + '</div>' + body;
    if (S.placeholders && S.placeholders.length) {
      body = '<div class="och-missbox">⛔ ' + esc(T('och.phBlock')) + ': <b>' + S.placeholders.map(esc).join(' · ') + '</b></div>' + body;
    }
    var lookBtns = '<div class="och-look">'
      + (d.style_default ? '<span class="och-badge ok">⭐ ' + esc(T('och.lookDefault')) + '</span>' : '<button type="button" class="och-att" onclick="OrderChat.mailSaveLook()">⭐ ' + esc(T('och.lookSave')) + '</button>')
      + ' <button type="button" class="och-att" onclick="OrderChat.mailResetLook()">↺ ' + esc(T('och.lookReset')) + '</button>'
      + '<div class="och-mut" style="margin-top:4px;">🎨 ' + esc(T('och.lookHint')) + '</div></div>';
    var att = (M.att || []).map(function (a) {
      var on = (d.attachments || []).indexOf(a.key) >= 0;
      return '<button type="button" class="och-att' + (on ? ' on' : '') + '" onclick="OrderChat.mailToggle(\'att\',\'' + esc(a.key) + '\')">' + (on ? '✓ ' : '+ ') + esc(a.label) + '</button>';
    }).join('');
    if (M.tracking) {
      att += '<button type="button" class="och-att' + (d.include_tracking ? ' on' : '') + '" onclick="OrderChat.mailToggle(\'trk\')">' + (d.include_tracking ? '✓ ' : '+ ') + '🌍 ' + esc(T('och.tracking')) + '</button>';
    }
    h += '<div class="och-card"><div class="och-sec">' + sec + tpl + '</div>'
      + '<div class="och-sec"><div class="och-sec-h">📝 ' + esc(T('och.mailBody')) + '</div>' + body + lookBtns + '</div>'
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
  // Előnézet a szerver lib/mailStyle.js renderStyled-jével azonos szerkezetben.
  function _hx(v, def) { return /^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : def; }
  // Kontraszt (a szerver lib/mailStyle.js-ével azonos számítás).
  function _lum(h) {
    var c = [1, 3, 5].map(function (i) { var v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function _contrast(a, b) { var x = _lum(a), y = _lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function _readableOn(bg) { return _contrast('#111827', bg) >= _contrast('#ffffff', bg) ? '#111827' : '#ffffff'; }
  function _ensureText(t, bg) { return _contrast(t, bg) >= 4.5 ? t : _readableOn(bg); }
  function _styledPreview(inner, st) {
    st = st || {};
    var accent = _hx(st.accent, '#f6711e'), bg = _hx(st.bg, '#ffffff'), card = _hx(st.card, '#ffffff');
    var text = _ensureText(_hx(st.text, '#2a2018'), card), bandText = _readableOn(accent);
    var align = st.align === 'center' ? 'center' : 'left';
    var font = st.font === 'serif' ? 'Georgia,serif' : 'Arial,sans-serif';
    var name = esc(T('och.lookSender'));
    var head = st.header === 'band'
      ? '<div style="background:' + accent + ';color:' + bandText + ';padding:10px 14px;text-align:' + align + ';border-radius:8px 8px 0 0;font-weight:800;">' + name + '</div>'
      : st.header === 'none' ? '' : '<div style="padding:10px 14px 4px;text-align:' + align + ';font-weight:800;">' + name + '</div><div style="height:3px;background:' + accent + ';margin:4px 14px 0;"></div>';
    return '<div class="och-mail-styled" style="background:' + bg + ';padding:10px;border-radius:10px;border:1px solid #e2e8f0;">'
      + '<div style="background:' + card + ';color:' + text + ';font-family:' + font + ';border-radius:8px;">' + head
      + '<div style="padding:12px 14px;font-size:14px;line-height:1.55;text-align:' + align + ';">' + inner + '</div></div>'
      + '<div style="margin-top:8px;padding:8px 12px;background:#f3f4f6;border-top:2px solid #1f2937;border-radius:0 0 6px 6px;color:#111827;font:600 12px Arial,sans-serif;">🏢 ' + esc(T('och.footerPrev')) + '</div></div>';
  }
  function mailSaveLook() {
    if (S.busy) return;
    window.gas('mailChatSaveStyle', [{ draft: S.draft }]).then(function (r) {
      if (r && r.ok) { S.draft = Object.assign({}, S.draft, { style_default: true }); S.messages.push({ role: 'assistant', text: '⭐ ' + T('och.lookSaved') }); }
      else S.messages.push({ role: 'assistant', text: '⚠️ ' + ((r && r.err) || T('och.err')), err: true });
      renderAll();
    });
  }
  function mailResetLook() {
    if (S.busy) return;
    window.gas('mailChatSaveStyle', [{ reset: true }]).then(function (r) {
      if (r && r.ok) { S.draft = Object.assign({}, S.draft, { style: null, style_default: false }); S.messages.push({ role: 'assistant', text: '↺ ' + T('och.lookResetDone') }); }
      else S.messages.push({ role: 'assistant', text: '⚠️ ' + ((r && r.err) || T('och.err')), err: true });
      renderAll();
    });
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
    else if (what === 'card') d.cards = (d.cards || []).filter(function (c) { return c.ref !== key; });
    S.draft = d;
    renderPrev();
    if (what === 'card' || what === 'trk') mailRefreshPreview();
  }
  // Az előnézet újrarajzolása a szerverről (kártya kivétele / követő-link után).
  function mailRefreshPreview() {
    window.gas('mailChatPreview', [{ draft: S.draft }]).then(function (r) {
      if (r && r.ok) { S.mailHtml = r.preview_html || ''; S.placeholders = r.placeholders || []; renderPrev(); }
    });
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

  // ─── ↩️ Válasz egy megnyitott levélre (a 📥 Levelek fülről). Az AI a levelet
  //     nem kapja meg — csak azt, amit a felhasználó a chatbe ír. ───
  function openReply(ctx) {
    if (!ctx || !ctx.id) return;
    S = { messages: [], draft: {}, questions: [], notes: [], missing: ['body'], ready: false, busy: false, saved: null, uitDocs: {} };
    var m = $('ochModal'); if (m) m.remove();
    _tab = 'chat';
    var s0 = String(ctx.subject || '');
    S.draft = { mode: 'email', reply_mail_id: ctx.id, recipient: 'other', to_email: ctx.from_email, recipient_name: ctx.from_name || null,
      subject: /^(re|aw)\s*:/i.test(s0) ? s0 : 'Re: ' + s0, body: '' };
    S.mail = { att: [], builders: [], tracking: false };
    S.messages.push({ role: 'assistant', text: T('och.replyStart', { to: ctx.from_name || ctx.from_email }) });
    open();
    renderAll();
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

  window.OrderChat = { open: open, close: close, reset: reset, send: send, pick: pick, save: save, openList: openList, openOrder: openOrder, tab: tab, uit: uit, uitRemove: uitRemove, setFab: setFab, mailSend: mailSend, openReply: openReply, act: act, actCancel: actCancel, docUp: docUp, prefill: prefill, mic: mic, mailToggle: mailToggle, mailSaveLook: mailSaveLook, mailResetLook: mailResetLook };
})();
