// ============================================================
//  VallorSoft — public/mail-accounts-card.js
//  📬 Postafiókok (Integrációk fül): több IMAP-fiók, fiókonként szerep
//  (Megrendelések / Levelek+válasz), mappák és engedélyezett feladók.
//  A jelszó titkosítva a szerveren, sosem jön vissza. Csak Admin szerkeszt.
//  RPC: mailAccountList / mailAccountSave / mailAccountTest / mailAccountDelete.
//  Globál: window.MailAccountsCard.mount(el, {readOnly})
// ============================================================
(function () {
  'use strict';
  function T(k, v) { return window.t ? window.t(k, v) : k; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); }
  function $(id) { return document.getElementById(id); }
  function toastx(m, k) { if (typeof window.toast === 'function') window.toast(m, k); else alert(m); }
  var S = { root: null, list: [], canEdit: false };

  function mount(target) {
    var root = typeof target === 'string' ? $(target) : target;
    if (!root) return;
    S.root = root;
    root.innerHTML = '<div class="glass mac"><div class="mac-head"><div><div class="mac-title">📬 ' + esc(T('mac.title')) + '</div>'
      + '<div class="text-muted" style="font-size:13px;">' + esc(T('mac.sub')) + '</div></div>'
      + '<button class="btn primary" id="macAdd" type="button" style="display:none;">➕ ' + esc(T('mac.add')) + '</button></div>'
      + '<div id="macList" class="text-muted">…</div></div>';
    $('macAdd').addEventListener('click', function () { form(null); });
    load();
  }

  function load() {
    gas('mailAccountList', []).then(function (r) {
      if (!r || !r.ok) { $('macList').textContent = (r && r.err) || '—'; return; }
      S.list = r.accounts || []; S.canEdit = !!r.can_edit;
      $('macAdd').style.display = S.canEdit ? '' : 'none';
      if (!S.list.length) { $('macList').innerHTML = '<div class="text-muted">' + esc(T('mac.none')) + '</div>'; return; }
      $('macList').innerHTML = S.list.map(function (a) {
        var uses = [a.use_orders ? '📄 ' + T('mac.useOrders') : '', a.use_inbox ? '📥 ' + T('mac.useInbox') : ''].filter(Boolean).join(' · ') || '—';
        return '<div class="mac-acc">'
          + '<div class="mac-acc-h"><b>' + esc(a.label || a.email) + '</b> <span class="text-muted">' + esc(a.email || '') + '</span>'
          + (a.enabled ? '' : ' <span class="badge warn">' + esc(T('mac.off')) + '</span>')
          + (a.last_error ? ' <span class="badge err" title="' + esc(a.last_error) + '">⚠️ ' + esc(T('mac.error')) + '</span>' : '') + '</div>'
          + '<div class="mac-acc-m">' + esc(T('mac.use')) + ': ' + esc(uses) + '</div>'
          + '<div class="mac-acc-m">' + esc(T('mac.folders')) + ': ' + esc(a.folders) + ' · ' + esc(T('mac.allow')) + ': ' + esc(T('mac.allow_' + a.allow_mode)) + '</div>'
          + (S.canEdit ? '<div class="mac-acc-b"><button class="btn ghost" type="button" onclick="MailAccountsCard.edit(' + a.id + ')">✏️ ' + esc(T('mac.edit')) + '</button>'
            + '<button class="btn ghost" type="button" onclick="MailAccountsCard.test(' + a.id + ')">🔌 ' + esc(T('mac.test')) + '</button>'
            + '<button class="btn danger" type="button" onclick="MailAccountsCard.del(' + a.id + ')">🗑</button></div>' : '')
          + '</div>';
      }).join('');
    });
  }

  function form(id) {
    var a = S.list.filter(function (x) { return x.id === id; })[0] || { provider: 'gmail', folders: 'INBOX', use_orders: false, use_inbox: true, allow_mode: 'known', enabled: true };
    var m = $('macModal');
    if (!m) { m = document.createElement('div'); m.id = 'macModal'; m.className = 'modal-back'; document.body.appendChild(m); }
    var mc = document.getElementById('mainContent'); m.setAttribute('data-theme', (mc && mc.getAttribute('data-theme')) || 'light');
    var prov = ['gmail', 'outlook', 'custom'].map(function (p) { return '<option value="' + p + '"' + (a.provider === p ? ' selected' : '') + '>' + esc(T('mac.prov_' + p)) + '</option>'; }).join('');
    var allow = ['known', 'list', 'all'].map(function (k) {
      return '<label class="mac-chk"><input type="radio" name="macAllow" value="' + k + '"' + (a.allow_mode === k ? ' checked' : '') + '> ' + esc(T('mac.allow_' + k)) + '</label>';
    }).join('');
    m.innerHTML = '<div class="modal glass mbx-modal">'
      + '<div class="mbx-mhead"><div class="mbx-msubj">📬 ' + esc(T(id ? 'mac.edit' : 'mac.add')) + '</div><button class="btn ghost" type="button" onclick="document.getElementById(\'macModal\').classList.remove(\'open\')">✕</button></div>'
      + '<div class="field"><label>' + esc(T('mac.label')) + '</label><input class="input" id="macLabel" value="' + esc(a.label || '') + '"></div>'
      + '<div class="grid-2"><div class="field"><label>' + esc(T('mac.provider')) + '</label><select class="select" id="macProv">' + prov + '</select></div>'
      + '<div class="field"><label>E-mail</label><input class="input" id="macEmail" type="email" autocomplete="off" placeholder="' + esc(a.email || '') + '"></div></div>'
      + '<div class="field"><label>' + esc(T('mac.password')) + '</label><input class="input" id="macPass" type="password" autocomplete="new-password" placeholder="' + esc(id ? T('mac.passKeep') : '') + '">'
      + '<div class="text-muted" style="font-size:12px;">' + esc(T('mac.passHint')) + '</div></div>'
      + '<div class="grid-2" id="macCustom" style="display:none;"><div class="field"><label>IMAP host</label><input class="input" id="macHost"></div>'
      + '<div class="field"><label>Port</label><input class="input" id="macPort" value="993"></div></div>'
      + '<div class="field"><label>' + esc(T('mac.use')) + '</label>'
      + '<label class="mac-chk"><input type="checkbox" id="macOrders"' + (a.use_orders ? ' checked' : '') + '> 📄 ' + esc(T('mac.useOrders')) + ' <span class="text-muted">— ' + esc(T('mac.useOrdersHint')) + '</span></label>'
      + '<label class="mac-chk"><input type="checkbox" id="macInbox"' + (a.use_inbox ? ' checked' : '') + '> 📥 ' + esc(T('mac.useInbox')) + ' <span class="text-muted">— ' + esc(T('mac.useInboxHint')) + '</span></label></div>'
      + '<div class="field"><label>' + esc(T('mac.folders')) + '</label><input class="input" id="macFolders" value="' + esc(a.folders || 'INBOX') + '">'
      + '<div class="text-muted" style="font-size:12px;">' + esc(T('mac.foldersHint')) + '</div></div>'
      + '<div class="field"><label>' + esc(T('mac.allow')) + '</label>' + allow
      + '<textarea class="textarea" id="macList2" rows="2" placeholder="' + esc(T('mac.allowListPh')) + '">' + esc(a.allow_list || '') + '</textarea></div>'
      + '<label class="mac-chk"><input type="checkbox" id="macEnabled"' + (a.enabled ? ' checked' : '') + '> ' + esc(T('mac.enabled')) + '</label>'
      + '<div class="mbx-note">🔒 ' + esc(T('mac.privacy')) + '</div>'
      + '<div class="mbx-btns"><button class="btn ghost" type="button" id="macTestBtn">🔌 ' + esc(T('mac.test')) + '</button>'
      + '<button class="btn primary" type="button" id="macSave">💾 ' + esc(T('mac.save')) + '</button></div></div>';
    m.classList.add('open');
    function syncProv() { $('macCustom').style.display = $('macProv').value === 'custom' ? '' : 'none'; }
    $('macProv').addEventListener('change', syncProv); syncProv();
    function collect() {
      var r = document.querySelector('input[name="macAllow"]:checked');
      return { id: id, label: $('macLabel').value, provider: $('macProv').value, email: $('macEmail').value.trim(),
        password: $('macPass').value, host: $('macHost').value, port: $('macPort').value, folders: $('macFolders').value,
        use_orders: $('macOrders').checked, use_inbox: $('macInbox').checked, allow_mode: r ? r.value : 'known',
        allow_list: $('macList2').value, enabled: $('macEnabled').checked };
    }
    $('macTestBtn').addEventListener('click', function () {
      gas('mailAccountTest', [collect()]).then(function (r) { toastx(r && r.ok ? r.message : ((r && r.err) || 'Eroare'), r && r.ok ? 'ok' : 'err'); });
    });
    $('macSave').addEventListener('click', function () {
      var d = collect();
      if (!d.email && !id) return toastx(T('mac.needEmail'), 'warn');
      gas('mailAccountSave', [d]).then(function (r) {
        if (!r || !r.ok) return toastx((r && r.err) || 'Eroare', 'err');
        m.classList.remove('open'); toastx(T('mac.saved'), 'ok'); load();
      });
    });
  }

  function test(id) {
    gas('mailAccountTest', [{ id: id }]).then(function (r) { toastx(r && r.ok ? r.message : ((r && r.err) || 'Eroare'), r && r.ok ? 'ok' : 'err'); });
  }
  function del(id) {
    if (!confirm(T('mac.delAsk'))) return;
    gas('mailAccountDelete', [{ id: id }]).then(function (r) { if (!r || !r.ok) return toastx((r && r.err) || 'Eroare', 'err'); load(); });
  }

  window.MailAccountsCard = { mount: mount, edit: form, test: test, del: del, reload: load };
})();
