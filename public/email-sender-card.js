// public/email-sender-card.js
// CÉG SAJÁT FELADÓ-FIÓK (SMTP / Brevo) — Integrációk fül.
// Ezen a fiókon mennek ki a cég KÜLSŐ levelei (sablonból küldés ügyfélnek,
// vizuális e-mail-szerkesztő). A KÖZÖS VallorSoft cím csak rendszer-
// értesítéseket küld (regisztráció, lejárat, szerviz) + a teszt-leveleket.
// Backend (újrahasznált): ebSenderGet / ebSenderSave / ebSenderTest / ebSenderDelete
// (handlers/emailBuilder.js). Mentés/törlés CSAK Admin.
window.EmailSenderCard = (function () {
  function tt(k, fb) { try { if (typeof t === 'function') { var v = t(k); if (v && v !== k) return v; } } catch (e) {} return fb; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }

  function mount(boxId) {
    var box = document.getElementById(boxId);
    if (!box) return;
    box.innerHTML =
      '<div class="glass" style="padding:22px;">' +
        '<h3 style="font-size:16px;margin:0 0 4px;color:var(--text-primary);">📮 ' + tt('es.title', 'Feladó-fiók — kimenő levelek (SMTP)') + '</h3>' +
        '<p style="color:var(--muted);font-size:13px;margin:0 0 14px;">' + tt('es.intro', 'A cég KÜLSŐ levelei (sablonból küldés ügyfélnek, e-mail-szerkesztő) erről a fiókról mennek. A rendszer-értesítéseket továbbra is a közös VallorSoft cím küldi.') + '</p>' +
        '<div class="grid-2" style="gap:12px;align-items:start;">' +
          fld('es.method', 'Mód', '<select class="select" id="esPrefer"><option value="smtp">SMTP</option><option value="brevo">Brevo (API)</option></select>') +
          fld('es.fromName', 'Feladó neve', '<input class="input" id="esFromName" placeholder="Firma SRL">') +
          fld('es.fromEmail', 'Feladó e-mail', '<input class="input" id="esFromEmail" type="email" placeholder="office@firma.ro">') +
          fld('es.host', 'SMTP szerver', '<input class="input" id="esHost" placeholder="smtp.firma.ro">') +
          fld('es.port', 'Port', '<input class="input" id="esPort" type="number" placeholder="587">') +
          '<div class="field" style="margin:0;align-self:end;"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="esSecure"> ' + tt('es.secure', 'Biztonságos (SSL/TLS, port 465)') + '</label></div>' +
          fld('es.user', 'Felhasználó', '<input class="input" id="esUser" placeholder="office@firma.ro">') +
          fld('es.pass', 'Jelszó', '<input class="input" id="esPass" type="password" autocomplete="new-password" placeholder="••••••">') +
          fld('es.brevoKey', 'Brevo API-kulcs (opcionális fallback)', '<input class="input" id="esBrevoKey" type="password" autocomplete="new-password" placeholder="xkeysib-...">') +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">' +
          '<button class="btn primary" id="esSave">' + tt('es.save', '💾 Mentés') + '</button>' +
          '<button class="btn ghost" id="esTest">' + tt('es.test', '✉️ Teszt magamnak') + '</button>' +
          '<button class="btn ghost" id="esDelete" style="color:var(--status-danger);">' + tt('es.delete', '🗑 Törlés') + '</button>' +
          '<span id="esStatus" style="align-self:center;font-size:12px;color:var(--muted);"></span>' +
        '</div>' +
      '</div>';

    gas('ebSenderGet').then(function (r) {
      if (!r || !r.ok) return;
      setVal('esPrefer', r.prefer || 'smtp');
      setVal('esFromName', r.from_name || '');
      setVal('esFromEmail', r.from_email || '');
      setVal('esHost', r.host || '');
      setVal('esPort', r.port || '');
      var sec = document.getElementById('esSecure'); if (sec) sec.checked = !!r.secure;
      setVal('esUser', r.user || '');
      if (r.has_pass) ph('esPass', '•••••• (mentve)');
      if (r.has_brevo_key) ph('esBrevoKey', '•••••• (mentve)');
      var st = document.getElementById('esStatus');
      if (st) st.textContent = r.configured ? tt('es.configured', 'Beállítva') : tt('es.notConfigured', 'Nincs beállítva');
    });

    on('esSave', function () {
      var payload = {
        prefer: val('esPrefer'),
        from_name: val('esFromName').trim(),
        from_email: val('esFromEmail').trim(),
        host: val('esHost').trim(),
        port: val('esPort').trim(),
        secure: !!(document.getElementById('esSecure') || {}).checked,
        user: val('esUser').trim(),
        pass: val('esPass'),
        brevo_api_key: val('esBrevoKey'),
      };
      gas('ebSenderSave', [payload]).then(function (d) {
        if (d && d.ok) { toast(tt('es.saved', 'Feladó-fiók mentve'), 'ok'); mount(boxId); }
        else toast((d && d.err) || tt('common.error', 'Eroare'), 'err');
      });
    });
    on('esTest', function () {
      toast(tt('es.testing', 'Teszt küldése…'), 'ok');
      gas('ebSenderTest').then(function (d) {
        if (d && d.ok) toast((d.message || tt('es.testOk', 'Teszt elküldve')), 'ok');
        else toast((d && d.err) || tt('common.error', 'Eroare'), 'err');
      });
    });
    on('esDelete', function () {
      if (!confirm(tt('es.delConfirm', 'Törlöd a feladó-fiókot?'))) return;
      gas('ebSenderDelete').then(function (d) {
        if (d && d.ok) { toast(tt('es.deleted', 'Törölve'), 'ok'); mount(boxId); }
        else toast((d && d.err) || tt('common.error', 'Eroare'), 'err');
      });
    });
  }

  function fld(key, fb, inner) {
    return '<div class="field" style="margin:0;"><label>' + esc(tt(key, fb)) + '</label>' + inner + '</div>';
  }
  function val(id) { var e = document.getElementById(id); return e ? (e.value || '') : ''; }
  function setVal(id, v) { var e = document.getElementById(id); if (e) e.value = v == null ? '' : v; }
  function ph(id, v) { var e = document.getElementById(id); if (e) e.placeholder = v; }
  function on(id, fn) { var e = document.getElementById(id); if (e) e.addEventListener('click', fn); }

  return { mount: mount };
})();
