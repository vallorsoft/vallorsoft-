// ============================================================
//  VallorSoft — public/mail-inbox.js
//  📥 Levelek: CSAK feladó + tárgy + dátum listája. A levelet a felhasználó
//  nyitja meg kattintással (élőben az IMAP-ról, nem tárolódik), és onnan
//  válaszol: ↩️ kézzel (sablon, csatolmány, kinézet) vagy 💬 AI-val — az AI
//  a levelet nem látja, csak a chatbe írt szöveget.
//  Szerver: handlers/mailbox.js. Globál: window.MailInbox.mount(el)
// ============================================================
(function () {
  'use strict';
  function T(k, v) { return window.t ? window.t(k, v) : k; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); }
  function $(id) { return document.getElementById(id); }
  function fmtDt(d) { if (!d) return ''; try { return new Date(d).toLocaleString(window.I18N && I18N.get() === 'hu' ? 'hu-HU' : 'ro-RO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } }
  function toastx(m, k) { if (typeof window.toast === 'function') window.toast(m, k); else alert(m); }
  function theme() { var mc = document.getElementById('mainContent') || document.querySelector('.main-content'); return (mc && mc.getAttribute('data-theme')) || 'light'; }

  var S = { root: null, items: [], q: '', mail: null, od: null };

  function mount(target) {
    var root = typeof target === 'string' ? $(target) : target;
    if (!root) return;
    S.root = root;
    root.innerHTML = ''
      + '<div class="mbx-head">'
      +   '<input class="input" id="mbxQ" placeholder="' + esc(T('mb.search')) + '" autocomplete="off" data-lpignore="true">'
      +   '<button class="btn ghost" id="mbxSync" type="button">🔄 ' + esc(T('mb.sync')) + '</button>'
      + '</div>'
      + '<div class="mbx-note">🔒 ' + esc(T('mb.privacy')) + '</div>'
      + '<div id="mbxList"><div class="text-muted">…</div></div>';
    var qt;
    $('mbxQ').addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(function () { S.q = $('mbxQ').value.trim(); load(); }, 300); });
    $('mbxSync').addEventListener('click', sync);
    load();
  }

  function load() {
    gas('mailInboxList', [{ kind: 'inbox', q: S.q }]).then(function (r) {
      if (!r || !r.ok) { $('mbxList').innerHTML = '<div class="mbx-empty">' + esc((r && r.err) || T('mb.err')) + '</div>'; return; }
      S.items = r.items || [];
      render();
    });
  }
  function sync() {
    var b = $('mbxSync'); b.disabled = true;
    gas('mailSyncNow', []).then(function (r) {
      b.disabled = false;
      if (!r || !r.ok) return toastx((r && r.err) || T('mb.err'), 'err');
      if (!r.accounts) toastx(T('mb.noAccount'), 'warn');
      else if (r.errors && r.errors.length) toastx(r.errors[0], 'err');
      else toastx(T('mb.synced', { n: r.added || 0 }), 'ok');
      load();
    }).catch(function () { b.disabled = false; });
  }

  function render() {
    if (!S.items.length) { $('mbxList').innerHTML = '<div class="mbx-empty">' + esc(T('mb.empty')) + '</div>'; return; }
    $('mbxList').innerHTML = '<div class="mbx-list">' + S.items.map(function (it) {
      return '<div class="mbx-row' + (it.opened_at ? '' : ' unread') + '" data-id="' + it.id + '" role="button" tabindex="0">'
        + '<div class="mbx-from">' + (it.opened_at ? '' : '<span class="mbx-dot"></span>') + esc(it.from_name || it.from_email)
        + (it.from_name ? ' <span class="mbx-mail">' + esc(it.from_email) + '</span>' : '') + '</div>'
        + '<div class="mbx-subj">' + esc(it.subject || T('mb.noSubject')) + '</div>'
        + '<div class="mbx-meta">'
        +   (it.fuvar_no ? '<span class="mbx-tag">🚚 ' + esc(it.fuvar_no) + '</span>' : '')
        +   (it.replied_at ? '<span class="mbx-tag ok">↩️ ' + esc(T('mb.replied')) + '</span>' : '')
        +   '<span class="mbx-acc">' + esc(it.account || '') + '</span><span>' + esc(fmtDt(it.received_at)) + '</span>'
        + '</div></div>';
    }).join('') + '</div>';
    S.root.querySelectorAll('.mbx-row').forEach(function (el) {
      el.addEventListener('click', function () { openMail(+el.dataset.id); });
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') openMail(+el.dataset.id); });
    });
  }

  // ─── Modal segéd ───
  function modal(id, html) {
    var m = $(id);
    if (!m) { m = document.createElement('div'); m.id = id; m.className = 'modal-back'; document.body.appendChild(m); }
    m.setAttribute('data-theme', theme());
    m.innerHTML = '<div class="modal glass mbx-modal">' + html + '</div>';
    m.classList.add('open');
    m.onclick = function (e) { if (e.target === m) m.classList.remove('open'); };
    return m;
  }
  function closeModal(id) { var m = $(id); if (m) m.classList.remove('open'); }

  // ─── Megnyitás (= engedély). A tartalom csak itt, a böngészőben látszik. ───
  function openMail(id) {
    var m = modal('mbxView', '<div class="text-muted" style="padding:20px;">⏳ ' + esc(T('mb.opening')) + '</div>');
    gas('mailOpen', [{ id: id }]).then(function (r) {
      if (!r || !r.ok) { m.querySelector('.mbx-modal').innerHTML = '<div class="mbx-empty">' + esc((r && r.err) || T('mb.err')) + '</div><div class="mbx-btns"><button class="btn ghost" onclick="MailInbox.close(\'mbxView\')">✕</button></div>'; return; }
      var ml = S.mail = r.mail;
      var row = S.items.filter(function (x) { return x.id === id; })[0]; if (row) row.opened_at = row.opened_at || new Date().toISOString();
      var atts = (ml.attachments || []).map(function (a) {
        return '<button class="mbx-att" type="button" onclick="MailInbox.att(' + ml.id + ',' + a.idx + ')">📎 ' + esc(a.name) + ' <span class="mbx-mail">' + Math.max(1, Math.round((a.size || 0) / 1024)) + ' KB</span></button>';
      }).join('');
      var ord = ml.order ? '<div class="mbx-order">🚚 ' + esc(T('mb.linked')) + ': <b>' + esc(ml.order.fuvar_no) + '</b> · ' + esc([ml.order.loc_incarcare, ml.order.loc_descarcare].filter(Boolean).join(' → ')) + '</div>' : '';
      m.querySelector('.mbx-modal').innerHTML = ''
        + '<div class="mbx-mhead"><div><div class="mbx-msubj">' + esc(ml.subject || T('mb.noSubject')) + '</div>'
        + '<div class="mbx-mail">' + esc(T('mb.from')) + ': <b>' + esc(ml.from_name || '') + '</b> &lt;' + esc(ml.from_email) + '&gt; · ' + esc(fmtDt(ml.received_at)) + '</div></div>'
        + '<button class="btn ghost" type="button" onclick="MailInbox.close(\'mbxView\')">✕</button></div>'
        + ord
        + '<pre class="mbx-text">' + esc(ml.text || '') + '</pre>'
        + (atts ? '<div class="mbx-atts">' + atts + '</div>' : '')
        + '<div class="mbx-btns">'
        +   '<button class="btn ghost" type="button" onclick="MailInbox.dismiss(' + ml.id + ')">🗑 ' + esc(T('mb.hide')) + '</button>'
        +   (window.OrderChat && window.OrderChat.openReply ? '<button class="btn ghost" type="button" onclick="MailInbox.aiReply()">💬 ' + esc(T('mb.aiReply')) + '</button>' : '')
        +   '<button class="btn primary" type="button" onclick="MailInbox.reply()">↩️ ' + esc(T('mb.reply')) + '</button>'
        + '</div>';
      render();
    });
  }

  function att(id, idx) {
    gas('mailAttachment', [{ id: id, idx: idx }]).then(function (r) {
      if (!r || !r.ok) return toastx((r && r.err) || T('mb.err'), 'err');
      var bin = atob(r.base64), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([arr], { type: r.type }));
      var a = document.createElement('a'); a.href = url; a.download = r.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    });
  }
  function dismiss(id) {
    if (!confirm(T('mb.hideAsk'))) return;
    gas('mailDismiss', [{ id: id }]).then(function () { closeModal('mbxView'); load(); });
  }
  function aiReply() {
    var ml = S.mail; if (!ml) return;
    closeModal('mbxView');
    window.OrderChat.openReply({ id: ml.id, from_email: ml.from_email, from_name: ml.from_name, subject: ml.subject });
  }

  // ─── ↩️ Válasz ablak (kézi) — fuvarhoz kötött levélnél sablon + csatolmány + követő-link ───
  function reply() {
    var ml = S.mail; if (!ml) return;
    closeModal('mbxView');
    var s0 = String(ml.subject || '');
    var subj = /^(re|aw)\s*:/i.test(s0) ? s0 : 'Re: ' + s0;
    S.od = null;
    var m = modal('mbxReply', ''
      + '<div class="mbx-mhead"><div class="mbx-msubj">↩️ ' + esc(T('mb.reply')) + '</div><button class="btn ghost" type="button" onclick="MailInbox.close(\'mbxReply\')">✕</button></div>'
      + '<div class="mbx-fl"><span>' + esc(T('mb.to')) + '</span><b>' + esc(ml.from_email) + '</b> 🔒</div>'
      + '<div class="mbx-fl"><span>' + esc(T('mb.subject')) + '</span><b>' + esc(subj) + '</b></div>'
      + '<div id="mbxTplBox"></div>'
      + '<textarea class="textarea" id="mbxBody" rows="8" placeholder="' + esc(T('mb.bodyPh')) + '"></textarea>'
      + '<label class="mbx-chk"><input type="checkbox" id="mbxQuote" checked> ' + esc(T('mb.quote')) + '</label>'
      + '<div id="mbxAttBox"></div>'
      + '<div class="mbx-mail" style="margin:6px 0;">🏢 ' + esc(T('mb.footerNote')) + '</div>'
      + '<div class="mbx-btns"><button class="btn ghost" type="button" onclick="MailInbox.send(true)">✉️ ' + esc(T('mb.test')) + '</button>'
      + '<button class="btn primary" type="button" id="mbxSendBtn" onclick="MailInbox.send(false)">📤 ' + esc(T('mb.send')) + '</button></div>');
    m.dataset.subj = subj;
    if (ml.order) {
      gas('getOrderEmailData', [{ order_id: ml.order.id, lang: (window.I18N && I18N.get()) || 'ro' }]).then(function (d) {
        if (!d || !d.ok) return;
        S.od = d;
        var tpls = d.templates || [];
        if (tpls.length) {
          $('mbxTplBox').innerHTML = '<select class="select" id="mbxTpl"><option value="">' + esc(T('mb.tplPick')) + '</option>'
            + tpls.map(function (t, i) { return '<option value="' + i + '">' + esc(t.name || t.key) + '</option>'; }).join('') + '</select>';
          $('mbxTpl').addEventListener('change', function () {
            var t = tpls[+this.value]; if (!t) return;
            $('mbxBody').value = t.body || t.text || '';
          });
        }
        var chips = (d.attachments || []).map(function (a) {
          return '<label class="mbx-chk"><input type="checkbox" class="mbxAtt" value="' + esc(a.key) + '"> ' + esc(a.label) + '</label>';
        }).join('');
        if (d.tracking_available) chips += '<label class="mbx-chk"><input type="checkbox" id="mbxTrk"> 🌍 ' + esc(T('mb.tracking')) + '</label>';
        if (chips) $('mbxAttBox').innerHTML = '<div class="mbx-sec">📎 ' + esc(T('mb.attach')) + ' (' + esc(ml.order.fuvar_no) + ')</div>' + chips;
      });
    }
  }

  function send(test) {
    var ml = S.mail; if (!ml) return;
    var body = ($('mbxBody').value || '').trim();
    if (!body) return toastx(T('mb.emptyBody'), 'warn');
    var atts = Array.prototype.map.call(document.querySelectorAll('.mbxAtt:checked'), function (x) { return x.value; });
    var trk = !!($('mbxTrk') && $('mbxTrk').checked);
    if (!test) {
      // Előnézet: mit csinál a rendszer, mielőtt kimegy.
      var msg = T('mb.confirm', { to: ml.from_email, subj: $('mbxReply').dataset.subj })
        + (atts.length ? '\n📎 ' + atts.length + ' ' + T('mb.attN') : '') + (trk ? '\n🌍 ' + T('mb.tracking') : '')
        + '\n\n' + body.slice(0, 400) + (body.length > 400 ? '…' : '');
      if (!confirm(msg)) return;
    }
    var b = $('mbxSendBtn'); if (b) b.disabled = true;
    gas('mailReply', [{ id: ml.id, body: body, quote: $('mbxQuote').checked, attachments: atts, include_tracking: trk, test: !!test }]).then(function (r) {
      if (b) b.disabled = false;
      if (!r || !r.ok) return toastx((r && r.err) || T('mb.err'), 'err');
      if (test) return toastx(T('mb.testSent'), 'ok');
      toastx(T('mb.sent', { to: r.to }), 'ok');
      closeModal('mbxReply');
      load();
    }).catch(function () { if (b) b.disabled = false; });
  }

  window.MailInbox = { mount: mount, close: closeModal, att: att, dismiss: dismiss, reply: reply, aiReply: aiReply, send: send, reload: load };
})();
