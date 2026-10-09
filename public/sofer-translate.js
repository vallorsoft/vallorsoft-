// ============================================================
//  VallorSoft — public/sofer-translate.js
//  🌐 Sofőr-fordító: lebegő kis ikon → fordító-panel két móddal.
//   • 🗣️ Beszélgetés (tolmács): két nagy mikrofon-gomb (Én / Partner);
//     a böngésző felismeri a beszédet, a szerver (AI) lefordítja, a
//     fordítást a telefon hangosan felolvassa a másik nyelven.
//   • ✍️ Szöveg: beírt / bediktált szöveg fordítása, felolvasás, másolás.
//  A beszédfelismerés + felolvasás a böngészőben fut (Web Speech API);
//  a szerverre CSAK a szöveg megy (`translateText`), ott sem tárolódik.
//  Az ikon csak akkor jelenik meg, ha a cégnél a funkció elérhető
//  (`getTranslateStatus` → usable).
// ============================================================
(function () {
  'use strict';

  // ISO kód, BCP-47 (beszédhez), saját nyelvű név.
  var LANGS = [
    ['ro', 'ro-RO', 'Română'], ['hu', 'hu-HU', 'Magyar'], ['en', 'en-GB', 'English'],
    ['de', 'de-DE', 'Deutsch'], ['fr', 'fr-FR', 'Français'], ['it', 'it-IT', 'Italiano'],
    ['es', 'es-ES', 'Español'], ['pt', 'pt-PT', 'Português'], ['nl', 'nl-NL', 'Nederlands'],
    ['pl', 'pl-PL', 'Polski'], ['cs', 'cs-CZ', 'Čeština'], ['sk', 'sk-SK', 'Slovenčina'],
    ['sl', 'sl-SI', 'Slovenščina'], ['hr', 'hr-HR', 'Hrvatski'], ['sr', 'sr-RS', 'Srpski'],
    ['bg', 'bg-BG', 'Български'], ['el', 'el-GR', 'Ελληνικά'], ['tr', 'tr-TR', 'Türkçe'],
    ['uk', 'uk-UA', 'Українська'], ['ru', 'ru-RU', 'Русский'], ['lt', 'lt-LT', 'Lietuvių'],
    ['lv', 'lv-LV', 'Latviešu'], ['et', 'et-EE', 'Eesti'], ['sv', 'sv-SE', 'Svenska'],
    ['da', 'da-DK', 'Dansk'], ['no', 'nb-NO', 'Norsk'], ['fi', 'fi-FI', 'Suomi'],
  ];
  // „Most én beszélek" a PARTNER saját nyelvén — hogy a külföldi fél is
  // tudja, melyik gombot nyomja meg (a sofőr nyelvén alatta kicsiben).
  var SPEAK = {
    ro: 'Vorbesc eu', hu: 'Én beszélek', en: "I'm speaking", de: 'Ich spreche', fr: 'Je parle', it: 'Parlo io',
    es: 'Hablo yo', pt: 'Eu falo', nl: 'Ik spreek', pl: 'Mówię ja', cs: 'Mluvím já', sk: 'Hovorím ja',
    sl: 'Govorim jaz', hr: 'Ja govorim', sr: 'Ja govorim', bg: 'Аз говоря', el: 'Μιλάω εγώ', tr: 'Ben konuşuyorum',
    uk: 'Я говорю', ru: 'Я говорю', lt: 'Kalbu aš', lv: 'Es runāju', et: 'Mina räägin', sv: 'Jag pratar',
    da: 'Jeg taler', no: 'Jeg snakker', fi: 'Minä puhun',
  };
  function langRow(c) { for (var i = 0; i < LANGS.length; i++) if (LANGS[i][0] === c) return LANGS[i]; return null; }
  function bcp(c) { var r = langRow(c); return r ? r[1] : c; }
  function lname(c) { var r = langRow(c); return r ? r[2] : c; }

  function tt(k) { try { return window.t ? window.t(k) : k; } catch (_) { return k; } }
  function uiLang() { try { return (window.I18N && window.I18N.get && window.I18N.get()) || 'ro'; } catch (_) { return 'ro'; } }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function note(m, k) { if (typeof window.toast === 'function') { try { window.toast(m, k); return; } catch (_) {} } }
  function rpc(fn, a) {
    return fetch('/api/execute', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName: fn, arguments: a ? [a] : [] }) })
      .then(function (r) { return r.json(); }).then(function (d) { return (d && d.result) || { ok: false }; });
  }

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var S = {
    tab: lsGet('vs_tr_tab', 'conv'),
    me: lsGet('vs_tr_me', ''),
    other: lsGet('vs_tr_other', 'de'),
    target: lsGet('vs_tr_target', 'de'),
    auto: lsGet('vs_tr_auto', '1') !== '0',
    log: [], rec: null, recSide: null, busy: 0,
  };

  // ── Felolvasás ──
  function speak(text, code) {
    if (!text || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = bcp(code);
      var vs = window.speechSynthesis.getVoices() || [];
      for (var i = 0; i < vs.length; i++) {
        if (String(vs[i].lang || '').toLowerCase().indexOf(String(code).toLowerCase()) === 0) { u.voice = vs[i]; break; }
      }
      u.rate = 0.95;
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }
  function stopSpeak() { try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (_) {} }

  // ── Beszédfelismerés ──
  function stopListen() {
    if (S.rec) { try { S.rec.onend = null; S.rec.stop(); } catch (_) {} }
    S.rec = null; S.recSide = null; paintMics(); status('');
  }
  function listen(side, onText) {
    if (!SR) { note(tt('sof.tr.noSpeech'), 'err'); var inp = $('trConvIn'); if (inp) inp.focus(); return; }
    if (S.rec) { var same = S.recSide === side; stopListen(); if (same) return; }
    stopSpeak(); // a saját felolvasást ne hallja vissza a mikrofon
    var code = side === 'me' ? S.me : side === 'other' ? S.other : S.me;
    var r = new SR();
    r.lang = bcp(code); r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    var finalText = '';
    r.onresult = function (ev) {
      var interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript;
        else interim += ev.results[i][0].transcript;
      }
      status('🎙️ ' + (finalText + interim));
    };
    r.onerror = function (ev) {
      if (ev && (ev.error === 'not-allowed' || ev.error === 'service-not-allowed')) note(tt('sof.tr.micDenied'), 'err');
    };
    r.onend = function () {
      S.rec = null; S.recSide = null; paintMics(); status('');
      var txt = finalText.trim();
      if (txt) onText(txt);
    };
    S.rec = r; S.recSide = side; paintMics(); status('🎙️ ' + tt('sof.tr.listening') + ' (' + lname(code) + ')');
    try { r.start(); } catch (_) { stopListen(); }
  }

  function status(s) { var el = $('trStat'); if (el) el.textContent = s || ''; }

  // ── Fordítás (szerver) ──
  function translate(text, source, target, context) {
    S.busy++; status('⏳ ' + tt('sof.tr.translating'));
    return rpc('translateText', { text: text, source: source, target: target, context: context || '' })
      .then(function (r) { S.busy--; if (!S.busy) status(''); return r; })
      .catch(function () { S.busy--; if (!S.busy) status(''); return { ok: false, err: tt('sof.tr.error') }; });
  }

  // ── Beszélgetés ──
  function convContext() {
    return S.log.slice(-4).map(function (e) { return (e.side === 'me' ? 'A: ' : 'B: ') + e.src + (e.tr ? ' → ' + e.tr : ''); }).join('\n');
  }
  function utter(side, text) {
    var src = side === 'me' ? S.me : S.other;
    var dst = side === 'me' ? S.other : S.me;
    var ctx = convContext();
    var e = { side: side, src: text, tr: null, dst: dst, err: null };
    S.log.push(e); if (S.log.length > 60) S.log.shift();
    paintLog();
    translate(text, src, dst, ctx).then(function (r) {
      if (r && r.ok) { e.tr = r.translation; if (S.auto) speak(e.tr, dst); }
      else e.err = (r && r.err) || tt('sof.tr.error');
      paintLog();
    });
  }
  function paintLog() {
    var box = $('trLog'); if (!box) return;
    if (!S.log.length) { box.innerHTML = '<div class="tr-empty">' + esc(tt('sof.tr.convHint')) + '</div>'; return; }
    box.innerHTML = S.log.map(function (e, i) {
      return '<div class="tr-bub ' + (e.side === 'me' ? 'me' : 'oth') + '">'
        + '<div class="tr-src">' + esc(e.src) + '</div>'
        + (e.tr ? '<div class="tr-tr">' + esc(e.tr) + '</div>'
          + '<button type="button" class="tr-say" onclick="trSayLog(' + i + ')" aria-label="' + esc(tt('sof.tr.speak')) + '">🔊</button>'
          : e.err ? '<div class="tr-err">⚠️ ' + esc(e.err) + '</div>' : '<div class="tr-wait">…</div>')
        + '</div>';
    }).join('');
    box.scrollTop = box.scrollHeight;
  }
  function paintMics() {
    var bm = $('trMicMe'), bo = $('trMicOther'), bt = $('trTxtMic');
    if (bm) { bm.classList.toggle('on', S.recSide === 'me'); bm.innerHTML = '🎤 ' + esc(tt('sof.tr.meSpeaks')) + '<small>' + esc(lname(S.me)) + '</small>'; }
    if (bo) { bo.classList.toggle('on', S.recSide === 'other'); bo.innerHTML = '🎤 ' + esc(SPEAK[S.other] || lname(S.other)) + '<small>' + esc(tt('sof.tr.otherSpeaks') + ' · ' + lname(S.other)) + '</small>'; }
    if (bt) bt.classList.toggle('on', S.recSide === 'text');
  }

  // ── Panel ──
  function opts(sel) {
    return LANGS.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === sel ? ' selected' : '') + '>' + esc(l[2]) + '</option>'; }).join('');
  }
  function build() {
    if ($('trModal')) return;
    var m = document.createElement('div');
    m.id = 'trModal'; m.className = 'tr-modal'; m.style.display = 'none';
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.onclick = function (ev) { if (ev.target === m) window.trClose(); };
    document.body.appendChild(m);
  }
  function render() {
    var m = $('trModal'); if (!m) return;
    if (!S.me) S.me = uiLang() === 'hu' ? 'hu' : 'ro';
    var conv = S.tab === 'conv';
    m.innerHTML = '<div class="tr-card">'
      + '<div class="tr-head"><b>🌐 ' + esc(tt('sof.tr.title')) + '</b>'
      + '<button type="button" class="tr-x" onclick="trClose()" aria-label="✕">✕</button></div>'
      + '<div class="tr-tabs"><button type="button" class="' + (conv ? 'act' : '') + '" onclick="trTab(\'conv\')">🗣️ ' + esc(tt('sof.tr.tabConv')) + '</button>'
      + '<button type="button" class="' + (!conv ? 'act' : '') + '" onclick="trTab(\'text\')">✍️ ' + esc(tt('sof.tr.tabText')) + '</button></div>'
      + (conv ? convHtml() : textHtml())
      + '<div class="tr-stat" id="trStat"></div>'
      + '</div>';
    if (conv) paintLog();
    paintMics();
  }
  function convHtml() {
    return '<div class="tr-langs">'
      + '<label><span>' + esc(tt('sof.tr.me')) + '</span><select id="trMe" onchange="trSetLang(\'me\',this.value)">' + opts(S.me) + '</select></label>'
      + '<button type="button" class="tr-swap" onclick="trSwap()" aria-label="⇄">⇄</button>'
      + '<label><span>' + esc(tt('sof.tr.other')) + '</span><select id="trOther" onchange="trSetLang(\'other\',this.value)">' + opts(S.other) + '</select></label></div>'
      + '<div class="tr-log" id="trLog"></div>'
      + '<div class="tr-mics"><button type="button" id="trMicMe" class="tr-mic me" onclick="trListen(\'me\')"></button>'
      + '<button type="button" id="trMicOther" class="tr-mic oth" onclick="trListen(\'other\')"></button></div>'
      + '<div class="tr-typed"><input id="trConvIn" class="tr-in" maxlength="1500" placeholder="' + esc(tt('sof.tr.typeHere')) + '" onkeydown="if(event.key===\'Enter\'){trSend(\'me\')}">'
      + '<button type="button" onclick="trSend(\'me\')" title="' + esc(tt('sof.tr.meSpeaks')) + '">' + esc(tt('sof.tr.sendMe')) + '</button>'
      + '<button type="button" onclick="trSend(\'other\')" title="' + esc(tt('sof.tr.otherSpeaks')) + '">' + esc(tt('sof.tr.sendOther')) + '</button></div>'
      + '<div class="tr-foot"><label><input type="checkbox" ' + (S.auto ? 'checked' : '') + ' onchange="trAuto(this.checked)"> 🔊 ' + esc(tt('sof.tr.autoSpeak')) + '</label>'
      + '<button type="button" class="tr-clear" onclick="trClear()">🗑 ' + esc(tt('sof.tr.clear')) + '</button></div>'
      + (SR ? '' : '<div class="tr-warn">' + esc(tt('sof.tr.noSpeech')) + '</div>');
  }
  function textHtml() {
    return '<div class="tr-langs one"><label><span>' + esc(tt('sof.tr.target')) + '</span><select id="trTarget" onchange="trSetLang(\'target\',this.value)">' + opts(S.target) + '</select></label></div>'
      + '<textarea id="trTxt" class="tr-ta" maxlength="1500" rows="4" placeholder="' + esc(tt('sof.tr.typeHere')) + '"></textarea>'
      + '<div class="tr-row">' + (SR ? '<button type="button" id="trTxtMic" class="tr-btn ghost" onclick="trDictate()">🎤</button>' : '')
      + '<button type="button" class="tr-btn" onclick="trDoText()">🌐 ' + esc(tt('sof.tr.translate')) + '</button></div>'
      + '<div class="tr-res" id="trRes" style="display:none"><div id="trResTxt" class="tr-res-txt"></div>'
      + '<div class="tr-row"><button type="button" class="tr-btn ghost" onclick="trSayRes()">🔊 ' + esc(tt('sof.tr.speak')) + '</button>'
      + '<button type="button" class="tr-btn ghost" onclick="trCopyRes()">📋 ' + esc(tt('sof.tr.copy')) + '</button></div></div>';
  }

  // ── Globális (onclick) belépési pontok ──
  window.trOpen = function () { build(); render(); $('trModal').style.display = 'flex'; };
  window.trClose = function () { stopListen(); stopSpeak(); var m = $('trModal'); if (m) m.style.display = 'none'; };
  window.trTab = function (t) { stopListen(); S.tab = t === 'text' ? 'text' : 'conv'; lsSet('vs_tr_tab', S.tab); render(); };
  window.trSetLang = function (which, v) {
    if (!langRow(v)) return;
    S[which] = v; lsSet('vs_tr_' + which, v); paintMics();
  };
  window.trSwap = function () { var x = S.me; S.me = S.other; S.other = x; lsSet('vs_tr_me', S.me); lsSet('vs_tr_other', S.other); render(); };
  window.trAuto = function (on) { S.auto = !!on; lsSet('vs_tr_auto', on ? '1' : '0'); if (!on) stopSpeak(); };
  window.trClear = function () { S.log = []; stopSpeak(); paintLog(); };
  window.trListen = function (side) { listen(side, function (txt) { utter(side, txt); }); };
  window.trSend = function (side) {
    var inp = $('trConvIn'); var v = inp ? inp.value.trim() : '';
    if (!v) return; inp.value = ''; utter(side === 'other' ? 'other' : 'me', v);
  };
  window.trSayLog = function (i) { var e = S.log[i]; if (e && e.tr) speak(e.tr, e.dst); };
  window.trDictate = function () {
    listen('text', function (txt) { var ta = $('trTxt'); if (ta) { ta.value = (ta.value ? ta.value + ' ' : '') + txt; } window.trDoText(); });
  };
  var _res = '';
  window.trDoText = function () {
    var ta = $('trTxt'); var v = ta ? ta.value.trim() : '';
    if (!v) { note(tt('sof.tr.empty'), 'err'); return; }
    translate(v, null, S.target, '').then(function (r) {
      var box = $('trRes'), t = $('trResTxt'); if (!box || !t) return;
      box.style.display = 'block';
      if (r && r.ok) { _res = r.translation; t.textContent = _res; t.classList.remove('err'); if (S.auto) speak(_res, S.target); }
      else { _res = ''; t.textContent = '⚠️ ' + ((r && r.err) || tt('sof.tr.error')); t.classList.add('err'); }
    });
  };
  window.trSayRes = function () { if (_res) speak(_res, S.target); };
  window.trCopyRes = function () {
    if (!_res) return;
    var done = function () { note(tt('sof.tr.copied'), 'ok'); };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(_res).then(done, function () {}); return; } } catch (_) {}
    try { var x = document.createElement('textarea'); x.value = _res; document.body.appendChild(x); x.select(); document.execCommand('copy'); x.remove(); done(); } catch (_) {}
  };

  // ── Lebegő ikon — csak ha a funkció elérhető ──
  function mountFab() {
    if ($('trFab')) return;
    var b = document.createElement('button');
    b.id = 'trFab'; b.type = 'button'; b.textContent = '🌐';
    b.title = tt('sof.tr.fab'); b.setAttribute('aria-label', tt('sof.tr.fab'));
    b.onclick = window.trOpen;
    document.body.appendChild(b);
  }
  function init() {
    rpc('getTranslateStatus').then(function (r) { if (r && r.ok && r.usable) mountFab(); }).catch(function () {});
    // A hangok listája némely böngészőben késve töltődik.
    try { if (window.speechSynthesis) window.speechSynthesis.getVoices(); } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.SoferTranslate = { open: window.trOpen, close: window.trClose, _langs: LANGS, _state: S };
})();
