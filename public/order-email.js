// public/order-email.js
// „Email a fuvarról" — egy kiírt fuvarhoz tartozó levél összeállítása és
// kiküldése tetszőleges címre (külső VAGY belső). Pipálással választod ki,
// MELY fuvar-adatok kerüljenek a szövegbe, MELY fájlok (megrendelő eredeti/
// aláírt, sofőr-fotók, számla) menjenek csatolmányként, és kéred-e a követő-
// linket. Mentett sablonokból előtölthető a tárgy+üzenet. Ami nincs pipálva,
// az nem kerül bele. Valós küldés a cég SMTP-jén; teszt a közös címről magadnak.
(function () {
  function tt(k, fb) { try { if (typeof t === 'function') { var v = t(k); if (v && v !== k) return v; } } catch (e) {} return fb; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
  function lang() { try { if (window.I18N && typeof I18N.get === 'function') return I18N.get(); } catch (e) {} return 'ro'; }

  window.openOrderEmail = function (orderId) {
    gas('getOrderEmailData', [{ order_id: orderId, lang: lang() }]).then(function (d) {
      if (!d || !d.ok) { toast((d && d.err) || tt('common.error', 'Eroare'), 'err'); return; }
      build(orderId, d);
    });
  };

  function build(orderId, d) {
    var fields = d.fields || [];
    var atts = d.attachments || [];
    var tpls = d.templates || [];

    var fieldRows = fields.map(function (f) {
      return '<label class="oe-row"><input type="checkbox" class="oe-fld" value="' + esc(f.key) + '" checked> ' +
        '<span><b>' + esc(f.label) + ':</b> ' + esc(f.value) + '</span></label>';
    }).join('') || ('<div class="oe-empty">' + tt('oe.noFields', 'Nincs megjeleníthető adat.') + '</div>');

    var attRows = atts.map(function (a) {
      var ico = a.kind === 'photo' ? '📷' : a.kind === 'invoice' ? '🧾' : '📄';
      return '<label class="oe-row"><input type="checkbox" class="oe-att" value="' + esc(a.key) + '"> ' +
        '<span>' + ico + ' ' + esc(a.label) + '</span></label>';
    }).join('') || ('<div class="oe-empty">' + tt('oe.noAtt', 'Nincs csatolható fájl ehhez a fuvarhoz.') + '</div>');

    // Követő-link checkbox (csak ha a funkció elérhető a cégnél)
    var trkRow = d.tracking_available
      ? '<label class="oe-row"><input type="checkbox" id="oeTrk"> <span>🌍 ' +
          tt('oe.tracking', 'Követő-link az ügyfélnek (autó követése)') + '</span></label>'
      : '';

    // Sablon-előtöltő (mentett sablonok)
    var tplOpts = '<option value="">— ' + tt('oe.tplNone', 'nincs (saját szöveg)') + ' —</option>' +
      tpls.map(function (tp, i) { return '<option value="' + i + '">' + esc(tt('etpl.key.' + tp.key, tp.key)) + '</option>'; }).join('');
    var tplSel = tpls.length
      ? '<div class="field"><label>' + tt('oe.tpl', 'Sablon betöltése') + '</label><select class="select" id="oeTpl">' + tplOpts + '</select></div>'
      : '';

    var ovl = document.createElement('div');
    ovl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
    ovl.innerHTML =
      '<div class="glass" style="padding:20px;max-width:560px;width:100%;border-radius:14px;max-height:92vh;overflow:auto;">' +
        '<h3 class="h-title" style="margin-top:0;">✉️ ' + tt('oe.title', 'Email a fuvarról') + ' — <b>' + esc(orderId) + '</b></h3>' +
        '<div class="field"><label>' + tt('oe.to', 'Címzett (bármilyen cím)') + '</label>' +
          '<input class="input" id="oeTo" type="email" placeholder="email@..." value="' + esc(d.client_email || '') + '"></div>' +
        tplSel +
        '<div class="field"><label>' + tt('oe.subject', 'Tárgy') + '</label>' +
          '<input class="input" id="oeSubject" value="' + esc('Comandă ' + orderId) + '"></div>' +
        '<div class="field"><label>' + tt('oe.body', 'Üzenet') + '</label>' +
          '<textarea class="textarea" id="oeBody" rows="4" placeholder="' + esc(tt('oe.bodyPh', 'Scrieți mesajul…')) + '"></textarea></div>' +
        '<div class="oe-sec"><div class="oe-sec-h">' + tt('oe.fieldsHead', '📋 Fuvar-adatok a levélbe (pipáld, amit küldesz)') + '</div>' + fieldRows + trkRow + '</div>' +
        '<div class="oe-sec"><div class="oe-sec-h">' + tt('oe.attHead', '📎 Csatolmányok (pipáld, amit küldesz)') + '</div>' + attRows + '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap;">' +
          '<button class="btn ghost" id="oeCancel">' + tt('etpl.cancel', 'Anulează') + '</button>' +
          '<button class="btn ghost" id="oeTest">' + tt('oe.test', '✉️ Teszt magamnak') + '</button>' +
          '<button class="btn primary" id="oeSend">' + tt('etpl.send', 'Trimite') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ovl);
    injectCss();
    function close() { try { document.body.removeChild(ovl); } catch (e) {} }
    ovl.addEventListener('click', function (e) { if (e.target === ovl) close(); });
    ovl.querySelector('#oeCancel').addEventListener('click', close);

    // Sablon-választás → tárgy + üzenet előtöltése (szerkeszthető marad) +
    // a megfelelő csatolmány OPCIONÁLIS bejelölése (csak bejelöl, nem vesz le —
    // a felhasználó szabadon módosíthatja).
    function autoCheckAtt(tplKey) {
      var map = { invoice_notify: 'inv-', order_confirm_carrier: 'od-' };
      var pref = map[tplKey];
      if (!pref) return;
      var boxes = ovl.querySelectorAll('.oe-att');
      if (pref === 'od-') {
        // a megrendelőnél az aláírt/pecsételt verziót preferáljuk, ha van
        var signed = [].filter.call(boxes, function (b) { return /^od-\d+-signed$/.test(b.value); });
        var targets = signed.length ? signed : [].filter.call(boxes, function (b) { return /^od-\d+-original$/.test(b.value); });
        targets.forEach(function (b) { b.checked = true; });
      } else {
        [].forEach.call(boxes, function (b) { if (b.value.indexOf(pref) === 0) b.checked = true; });
      }
    }
    var tplEl = ovl.querySelector('#oeTpl');
    if (tplEl) tplEl.addEventListener('change', function () {
      var idx = tplEl.value;
      if (idx === '') return;
      var tp = tpls[parseInt(idx, 10)];
      if (!tp) return;
      if (tp.subject) ovl.querySelector('#oeSubject').value = tp.subject;
      ovl.querySelector('#oeBody').value = tp.body || '';
      autoCheckAtt(tp.key);
    });

    function doSend(isTest) {
      var to = (ovl.querySelector('#oeTo').value || '').trim();
      if (!isTest && !to) { toast(tt('oe.to', 'Címzett'), 'err'); return; }
      var payload = {
        order_id: orderId,
        to_email: to,
        test: !!isTest,
        subject: (ovl.querySelector('#oeSubject').value || '').trim(),
        body: ovl.querySelector('#oeBody').value || '',
        fields: [].map.call(ovl.querySelectorAll('.oe-fld:checked'), function (el) { return el.value; }),
        attachments: [].map.call(ovl.querySelectorAll('.oe-att:checked'), function (el) { return el.value; }),
        include_tracking: !!(ovl.querySelector('#oeTrk') && ovl.querySelector('#oeTrk').checked),
      };
      var btn = ovl.querySelector(isTest ? '#oeTest' : '#oeSend');
      var old = btn.textContent; btn.disabled = true; btn.textContent = tt('oe.sending', 'Se trimite…');
      gas('sendOrderEmail', [payload]).then(function (r) {
        if (r && r.ok) {
          var who = isTest ? tt('oe.testSentTo', 'Teszt elküldve (saját cím)') : (tt('oe.sent', 'E-mail elküldve') + ': ' + to);
          var extra = (r.attachments ? ' (' + r.attachments + ' ' + tt('oe.attCount', 'csatolmány') + ')' : '') +
                      (r.skipped ? ' — ' + r.skipped + ' ' + tt('oe.skipped', 'kihagyva') : '');
          toast(who + extra, 'ok');
          if (!isTest) close(); else { btn.disabled = false; btn.textContent = old; }
        } else { toast((r && r.err) || tt('common.error', 'Eroare'), 'err'); btn.disabled = false; btn.textContent = old; }
      });
    }

    ovl.querySelector('#oeSend').addEventListener('click', function () { doSend(false); });
    ovl.querySelector('#oeTest').addEventListener('click', function () { doSend(true); });
  }

  function injectCss() {
    if (document.getElementById('oe-css')) return;
    var s = document.createElement('style'); s.id = 'oe-css';
    s.textContent =
      '.oe-sec{margin-top:12px;border:1px solid var(--glass-border-light,rgba(0,0,0,.1));border-radius:10px;padding:10px 12px;}' +
      '.oe-sec-h{font-size:12px;color:var(--muted,#8a7d6e);margin-bottom:6px;font-weight:600;}' +
      '.oe-row{display:flex;gap:8px;align-items:flex-start;padding:4px 0;font-size:13px;cursor:pointer;}' +
      '.oe-row input{margin-top:3px;}' +
      '.oe-empty{font-size:12px;color:var(--muted,#8a7d6e);font-style:italic;}';
    document.head.appendChild(s);
  }
})();
