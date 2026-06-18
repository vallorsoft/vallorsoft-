// public/templated-email.js
// Közös „Sablonból küldés" dialógus — bármely cégszintű TRANZAKCIÓS e-mail
// sablont (handlers/emailTemplates.js) elküld egy tetszőleges címzettnek.
// A küldés a meglévő gas('sendTemplatedEmail')-en megy: a cég SAJÁT sablonja,
// a {{változók}} szerver-oldalon escape-elve (nincs injekció).
//
//   sendTemplatedEmailDialog({ templateKey, keys, vars, toEmail, title })
//     templateKey : alapból kiválasztott sablon-kulcs
//     keys        : választható kulcsok (1 elem → fix, nincs választó)
//     vars        : előkitöltött {{változó}} értékek (objektum)
//     toEmail     : előkitöltött címzett (opcionális)
//     title       : dialógus-cím (opcionális)
(function () {
  // Kulcsonkénti változó-készlet (megegyezik a handlers/emailTemplates.js fehérlistájával).
  var VARSETS = {
    order_confirm_carrier: ['order_id', 'route', 'client'],
    order_status_change:   ['order_id', 'route', 'status'],
    quote_send:            ['client', 'route', 'pret'],
    invoice_notify:        ['client', 'invoice_no', 'order_id'],
    generic:               ['subject', 'message'],
  };
  function tt(k, fb) { try { if (typeof t === 'function') { var v = t(k); if (v && v !== k) return v; } } catch (e) {} return fb; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
  function varLabel(v) { return tt('etpl.var.' + v, v); }

  window.sendTemplatedEmailDialog = function (opts) {
    opts = opts || {};
    var keys = (opts.keys && opts.keys.length) ? opts.keys.filter(function (k) { return VARSETS[k]; }) : Object.keys(VARSETS);
    if (!keys.length) keys = Object.keys(VARSETS);
    var curKey = (opts.templateKey && keys.indexOf(opts.templateKey) >= 0) ? opts.templateKey : keys[0];
    var prefill = opts.vars || {};

    var ovl = document.createElement('div');
    ovl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
    function close() { try { document.body.removeChild(ovl); } catch (e) {} }

    function varFieldsHtml(key) {
      return (VARSETS[key] || []).map(function (v) {
        var big = (v === 'message');
        var val = prefill[v] != null ? prefill[v] : '';
        return '<div class="field"><label>' + esc(varLabel(v)) + ' <code style="opacity:.6;font-size:11px;">{{' + v + '}}</code></label>' +
          (big
            ? '<textarea class="textarea" data-tplvar="' + v + '" rows="3">' + esc(val) + '</textarea>'
            : '<input class="input" data-tplvar="' + v + '" value="' + esc(val) + '">') +
          '</div>';
      }).join('');
    }

    var keySelHtml = keys.length > 1
      ? '<div class="field"><label>' + tt('etpl.pickTpl', 'Șablon') + '</label><select class="select" id="steKey">' +
          keys.map(function (k) { return '<option value="' + k + '"' + (k === curKey ? ' selected' : '') + '>' + esc(tt('etpl.key.' + k, k)) + '</option>'; }).join('') +
        '</select></div>'
      : '';

    ovl.innerHTML =
      '<div class="glass" style="padding:20px;max-width:480px;width:100%;border-radius:14px;max-height:90vh;overflow:auto;">' +
        '<h3 class="h-title" style="margin-top:0;">' + (opts.title ? esc(opts.title) : tt('etpl.sendFromTpl', '📧 Sablonból küldés')) + '</h3>' +
        keySelHtml +
        '<div class="field"><label>' + tt('etpl.recipient', 'Destinatar') + '</label><input class="input" id="steTo" type="email" placeholder="email@..." value="' + esc(opts.toEmail || '') + '"></div>' +
        '<div id="steVars">' + varFieldsHtml(curKey) + '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">' +
          '<button class="btn ghost" id="steCancel">' + tt('etpl.cancel', 'Anulează') + '</button>' +
          '<button class="btn primary" id="steSend">' + tt('etpl.send', 'Trimite') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ovl);
    ovl.addEventListener('click', function (e) { if (e.target === ovl) close(); });
    ovl.querySelector('#steCancel').addEventListener('click', close);

    var keySel = ovl.querySelector('#steKey');
    if (keySel) keySel.addEventListener('change', function () {
      curKey = keySel.value;
      ovl.querySelector('#steVars').innerHTML = varFieldsHtml(curKey);
    });

    ovl.querySelector('#steSend').addEventListener('click', function () {
      var to = (ovl.querySelector('#steTo').value || '').trim();
      if (!to) { toast(tt('etpl.recipient', 'Destinatar'), 'err'); return; }
      var key = keySel ? keySel.value : curKey;
      var vars = {};
      Array.prototype.forEach.call(ovl.querySelectorAll('[data-tplvar]'), function (el) {
        vars[el.getAttribute('data-tplvar')] = el.value || '';
      });
      var lang = 'ro';
      try { if (window.I18N && typeof I18N.get === 'function') lang = I18N.get(); } catch (e) {}
      var btn = ovl.querySelector('#steSend'); btn.disabled = true;
      gas('sendTemplatedEmail', [{ template_key: key, to_email: to, lang: lang, vars: vars }]).then(function (d) {
        if (d && d.ok) { toast(tt('etpl.sent', 'E-mail trimis') + ': ' + to, 'ok'); close(); }
        else { toast((d && d.err) || tt('common.error', 'Eroare'), 'err'); btn.disabled = false; }
      });
    });
  };
})();
