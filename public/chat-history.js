// ============================================================
//  VallorSoft — public/chat-history.js
//  💬 Chat-beszélgetések — ellenőrző nézet (admin + manager).
//   • Adminisztráció → „💬 Chat-beszélgetések" fül (`chat-history`):
//     Admin a cég BÁRMELY felhasználójának beszélgetéseit látja (szűrés
//     felhasználóra / szövegre / dátumra), törölheti; Manager a sajátjait.
//   • A chat fejlécének 🕘 gombja: a saját korábbi beszélgetések (modal).
//  Csak sima szöveg — fájl / feltöltött kép itt nincs. Szerver:
//  handlers/chatHistory.js (chatHistoryList / chatHistoryGet / chatHistoryDelete).
// ============================================================
(function () {
  'use strict';

  function T(k, v) { return (window.t ? window.t(k, v) : k); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }
  function fmt(d) { try { return d ? new Date(d).toLocaleString() : ''; } catch (_) { return ''; } }
  function fmtD(d) { try { return d ? new Date(d).toLocaleDateString() : ''; } catch (_) { return ''; } }

  // Két példány: 'pane' (Adminisztráció fül) és 'own' (a chat 🕘 modalja).
  var I = {};
  function inst(key) {
    if (!I[key]) I[key] = { key: key, rows: [], users: [], isAdmin: false, sel: null, conv: null, msgs: [], q: '', uid: '', from: '', to: '', offset: 0, more: false, retention: 365, busy: false };
    return I[key];
  }
  function root(key) { return document.getElementById(key === 'own' ? 'chhOwnBox' : 'chatHistoryBox'); }

  function frame(st) {
    var bar = '<div class="chh-bar">'
      + (st.key === 'pane' && st.isAdmin
        ? '<select class="select chh-in" onchange="ChatHistory._f(\'' + st.key + '\',\'uid\',this.value)"><option value="">' + esc(T('chh.allUsers')) + '</option>'
          + st.users.map(function (u) { return '<option value="' + Number(u.id) + '"' + (String(st.uid) === String(u.id) ? ' selected' : '') + '>' + esc(u.nume) + (u.deleted ? ' (' + esc(T('chh.deletedUser')) + ')' : '') + '</option>'; }).join('') + '</select>'
        : '')
      + '<input class="input chh-in chh-q" type="search" placeholder="' + esc(T('chh.searchPh')) + '" value="' + esc(st.q) + '" onkeydown="if(event.key===\'Enter\'){ChatHistory._f(\'' + st.key + '\',\'q\',this.value);}">'
      + '<input class="input chh-in" type="date" value="' + esc(st.from) + '" title="' + esc(T('chh.from')) + '" onchange="ChatHistory._f(\'' + st.key + '\',\'from\',this.value)">'
      + '<input class="input chh-in" type="date" value="' + esc(st.to) + '" title="' + esc(T('chh.to')) + '" onchange="ChatHistory._f(\'' + st.key + '\',\'to\',this.value)">'
      + '<button class="btn" type="button" onclick="ChatHistory._search(\'' + st.key + '\')">🔍 ' + esc(T('chh.search')) + '</button>'
      + '</div>';
    return '<div class="chh-top">'
      + (st.key === 'pane' ? '<h2 class="h-title" style="margin-top:0;">' + esc(T('chh.title')) + '</h2>' : '')
      + '<p class="chh-hint">' + esc(T(st.isAdmin && st.key === 'pane' ? 'chh.hintAdmin' : 'chh.hintOwn', { d: st.retention })) + '</p>'
      + bar + '</div>'
      + '<div class="chh-grid' + (st.sel ? ' has-sel' : '') + '"><div class="chh-list" id="chhList_' + st.key + '"></div><div class="chh-view" id="chhView_' + st.key + '"></div></div>';
  }

  function renderList(st) {
    var el = document.getElementById('chhList_' + st.key);
    if (!el) return;
    if (!st.rows.length) { el.innerHTML = '<div class="chh-empty">' + esc(T(st.busy ? 'chh.loading' : 'chh.empty')) + '</div>'; return; }
    el.innerHTML = st.rows.map(function (c) {
      return '<button type="button" class="chh-item' + (st.sel === c.id ? ' on' : '') + '" onclick="ChatHistory._open(\'' + st.key + '\',' + Number(c.id) + ')">'
        + '<div class="chh-it-t">' + esc(c.title || '💬') + '</div>'
        + (c.summary ? '<div class="chh-it-s">' + esc(c.summary) + '</div>' : '')
        + '<div class="chh-it-m">' + (st.isAdmin && st.key === 'pane' ? '<span class="chh-user">👤 ' + esc(c.user_name) + (c.user_deleted ? ' (' + esc(T('chh.deletedUser')) + ')' : '') + '</span>' : '')
        + '<span>💬 ' + Number(c.msg_count || 0) + '</span><span>' + esc(fmt(c.updated_at)) + '</span></div></button>';
    }).join('') + (st.more ? '<button type="button" class="btn ghost chh-more" onclick="ChatHistory._more(\'' + st.key + '\')">' + esc(T('chh.more')) + '</button>' : '');
  }

  function renderView(st) {
    var el = document.getElementById('chhView_' + st.key);
    if (!el) return;
    var c = st.conv;
    if (!c) { el.innerHTML = '<div class="chh-empty">' + esc(T('chh.pick')) + '</div>'; return; }
    var h = '<div class="chh-vh">'
      + '<button type="button" class="btn ghost chh-back" onclick="ChatHistory._close(\'' + st.key + '\')">← ' + esc(T('chh.back')) + '</button>'
      + '<div class="chh-vt">' + esc(c.title || '💬') + '</div>'
      + '<div class="chh-vm">👤 ' + esc(c.user_name) + (c.user_deleted ? ' (' + esc(T('chh.deletedUser')) + ')' : '') + (c.user_email ? ' · ' + esc(c.user_email) : '') + ' · ' + esc(fmtD(c.created_at)) + ' → ' + esc(fmt(c.updated_at)) + '</div>'
      + (c.own && window.OrderChat && window.OrderChat.resume ? '<button type="button" class="btn ghost chh-res" onclick="ChatHistory._resume(\'' + st.key + '\',' + Number(c.id) + ')">↩️ ' + esc(T('chh.resume')) + '</button>' : '')
      + (st.isAdmin && st.key === 'pane' ? '<button type="button" class="btn ghost chh-del" onclick="ChatHistory._del(\'' + st.key + '\',' + Number(c.id) + ')">🗑 ' + esc(T('chh.delete')) + '</button>' : '')
      + '</div>';
    if (c.summary) h += '<div class="chh-sum">🧠 ' + esc(c.summary) + '</div>';
    h += '<div class="chh-msgs">';
    st.msgs.forEach(function (m) {
      h += '<div class="chh-msg ' + (m.role === 'user' ? 'me' : 'ai') + '">'
        + '<div class="chh-mt">' + esc(m.text).replace(/\n/g, '<br>') + '</div>'
        + (m.card ? '<details class="chh-card"><summary>📋 ' + esc(T('chh.card')) + '</summary><div>' + esc(m.card).replace(/\n/g, '<br>') + '</div></details>' : '')
        + '<div class="chh-mm">' + esc(fmt(m.at)) + (m.noai ? ' · <span class="chh-noai" title="' + esc(T('chh.noaiTip')) + '">📎 ' + esc(T('chh.noai')) + '</span>' : '') + '</div>'
        + '</div>';
    });
    h += '</div>';
    el.innerHTML = h;
  }

  function load(key, append) {
    var st = inst(key);
    if (st.busy) return;
    st.busy = true;
    if (!append) { st.offset = 0; st.rows = []; renderList(st); }
    var args = { q: st.q, from: st.from, to: st.to, offset: st.offset };
    if (key === 'pane' && st.uid) args.user_id = st.uid;
    window.gas('chatHistoryList', [args]).then(function (r) {
      st.busy = false;
      var box = root(key);
      if (!r || !r.ok) { if (box) box.innerHTML = '<div class="chh-empty">' + esc((r && r.err) || T('common.error')) + '</div>'; return; }
      st.isAdmin = !!r.is_admin; st.users = r.users || []; st.more = !!r.more; st.retention = r.retention_days || 365;
      st.rows = append ? st.rows.concat(r.rows || []) : (r.rows || []);
      if (!append || !document.getElementById('chhList_' + key)) { if (box) box.innerHTML = frame(st); renderView(st); }
      renderList(st);
    }).catch(function () { st.busy = false; var box = root(key); if (box) box.innerHTML = '<div class="chh-empty">' + esc(T('common.error')) + '</div>'; });
  }

  function open(key, id) {
    var st = inst(key);
    st.sel = id;
    window.gas('chatHistoryGet', [{ id: id }]).then(function (r) {
      if (!r || !r.ok) { if (window.toast) window.toast((r && r.err) || T('common.error'), 'err'); return; }
      st.conv = r.conversation; st.msgs = r.messages || [];
      var g = root(key) && root(key).querySelector('.chh-grid');
      if (g) g.classList.add('has-sel');
      renderList(st); renderView(st);
      var v = document.getElementById('chhView_' + key);
      var mm = v && v.querySelector('.chh-msgs');
      if (mm) mm.scrollTop = mm.scrollHeight;
    });
  }

  // ─── Publikus API ───
  window.ChatHistory = {
    // Adminisztráció fül.
    mount: function () { if (root('pane')) load('pane'); },
    // A chat 🕘 gombja: a saját beszélgetések modalban.
    openOwn: function () {
      var m = document.getElementById('chhOwnModal');
      if (!m) {
        m = document.createElement('div');
        m.id = 'chhOwnModal';
        m.className = 'modal-back';
        m.innerHTML = '<div class="chh chh-modal"><div class="chh-mh"><div class="chh-vt">🕘 ' + esc(T('chh.ownTitle')) + '</div>'
          + '<button class="btn ghost" type="button" onclick="ChatHistory.closeOwn()" aria-label="close">✕</button></div><div id="chhOwnBox"></div></div>';
        m.addEventListener('click', function (e) { if (e.target === m) window.ChatHistory.closeOwn(); });
        document.body.appendChild(m);
      }
      var mc = document.getElementById('mainContent') || document.querySelector('.main-content');
      m.firstChild.setAttribute('data-theme', (mc && mc.getAttribute('data-theme')) || 'light');
      m.classList.add('open');
      var st = inst('own'); st.sel = null; st.conv = null;
      load('own');
    },
    closeOwn: function () { var m = document.getElementById('chhOwnModal'); if (m) m.classList.remove('open'); },
    _f: function (key, field, val) { inst(key)[field] = String(val || ''); load(key); },
    _search: function (key) {
      var b = root(key); var q = b && b.querySelector('.chh-q');
      inst(key).q = q ? String(q.value || '') : '';
      load(key);
    },
    _more: function (key) { var st = inst(key); st.offset = st.rows.length; load(key, true); },
    _open: open,
    // Saját beszélgetés folytatása a chatben (a szerver csak a sajátot adja vissza).
    _resume: function (key, id) {
      if (key === 'own') window.ChatHistory.closeOwn();
      if (window.OrderChat && window.OrderChat.resume) window.OrderChat.resume(id);
    },
    _close: function (key) {
      var st = inst(key); st.sel = null; st.conv = null;
      var g = root(key) && root(key).querySelector('.chh-grid');
      if (g) g.classList.remove('has-sel');
      renderList(st); renderView(st);
    },
    _del: function (key, id) {
      if (!window.confirm(T('chh.delConfirm'))) return;
      window.gas('chatHistoryDelete', [{ id: id }]).then(function (r) {
        if (!r || !r.ok) { if (window.toast) window.toast((r && r.err) || T('common.error'), 'err'); return; }
        if (window.toast) window.toast(T('chh.deleted'), 'ok');
        var st = inst(key); st.sel = null; st.conv = null;
        load(key);
      });
    },
  };
})();
