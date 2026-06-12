// public/email-intake-card.js
// "📧 Megrendelés email fiók" kártya az Integrációk / Számlázó fülre.
// Cégenként megadható IMAP postafiók (Gmail / Outlook / Egyedi). A hitelesítő
// adatok titkosítva, szerver oldalon tárolódnak — sosem kerülnek vissza nyíltan.
// RPC: gas('getEmailIntakeConfig' | 'saveEmailIntakeConfig' | 'testEmailIntakeConfig' | 'deleteEmailIntakeConfig').
// Használat: EmailIntakeCard.mount('emailIntakeCardBox', { readOnly:false });
(window.registerI18n||function(d){(window.__i18nQueue=window.__i18nQueue||[]).push(d);})({
  'in.card.title': { hu: '📧 Megrendelés email fiók', ro: '📧 Cont email comenzi' },
  'in.card.loading': { hu: 'Betöltés…', ro: 'Se încarcă…' },
  'in.card.unavailable': { hu: 'Nem elérhető.', ro: 'Indisponibil.' },
  'in.card.netErr': { hu: 'Hálózati hiba.', ro: 'Eroare de rețea.' },
  'in.prov.custom': { hu: 'Egyedi IMAP', ro: 'IMAP personalizat' },
  'in.badge.off': { hu: 'Nincs beállítva', ro: 'Neconfigurat' },
  'in.badge.active': { hu: '✅ Aktív', ro: '✅ Activ' },
  'in.empty.readonly': { hu: 'Még nincs megrendelés-fiók beállítva. A beállítást az Admin kezeli.', ro: 'Încă nu este configurat un cont de comenzi. Configurarea o gestionează Adminul.' },
  'in.empty.intro': { hu: 'Nincs beállítva — add meg azt az email fiókot, amelyre a megrendeléseket kapod. <b>A mentés pillanatától</b> csak az azután beérkező leveleket dolgozza fel (a régieket nem).', ro: 'Neconfigurat — introdu contul de email pe care primești comenzile. <b>Din momentul salvării</b> procesează doar mesajele primite ulterior (nu cele vechi).' },
  'in.empty.choose': { hu: 'Válassz szolgáltatót:', ro: 'Alege furnizorul:' },
  'in.kv.provider': { hu: 'Szolgáltató', ro: 'Furnizor' },
  'in.kv.email': { hu: 'Email', ro: 'Email' },
  'in.kv.mailbox': { hu: 'Postafiók', ro: 'Căsuță poștală' },
  'in.kv.configuredAt': { hu: 'Beállítva', ro: 'Configurat' },
  'in.kv.since': { hu: 'Csak ettől dolgozza fel', ro: 'Procesează doar de la' },
  'in.kv.lastPoll': { hu: 'Utolsó lekérdezés', ro: 'Ultima interogare' },
  'in.cfg.readonly': { hu: 'A beállítást az Admin kezeli.', ro: 'Configurarea o gestionează Adminul.' },
  'in.btn.test': { hu: '🔌 Tesztelés', ro: '🔌 Testare' },
  'in.btn.edit': { hu: '✏️ Módosítás', ro: '✏️ Modificare' },
  'in.btn.delete': { hu: '🗑 Törlés', ro: '🗑 Ștergere' },
  'in.btn.testConn': { hu: '🔌 Kapcsolat tesztelése', ro: '🔌 Testează conexiunea' },
  'in.btn.back': { hu: '← Vissza', ro: '← Înapoi' },
  'in.btn.save': { hu: '💾 Mentés', ro: '💾 Salvare' },
  'in.msg.testing': { hu: 'Tesztelés…', ro: 'Se testează…' },
  'in.msg.saving': { hu: 'Mentés…', ro: 'Se salvează…' },
  'in.msg.err': { hu: 'Hiba', ro: 'Eroare' },
  'in.msg.netErr': { hu: '❌ Hálózati hiba', ro: '❌ Eroare de rețea' },
  'in.confirm.delete': { hu: 'Biztosan törlöd a megrendelés email fiók beállítását? A lekérdezés ezután leáll.', ro: 'Sigur ștergi configurarea contului de email pentru comenzi? Interogarea se va opri.' },
  'in.toast.deleted': { hu: 'Beállítás törölve', ro: 'Configurare ștearsă' },
  'in.toast.saved': { hu: 'Beállítás mentve', ro: 'Configurare salvată' },
  'in.form.gmail': { hu: 'Gmail beállítása', ro: 'Configurare Gmail' },
  'in.form.outlook': { hu: 'Outlook/Office365 beállítása', ro: 'Configurare Outlook/Office365' },
  'in.form.custom': { hu: 'Egyedi IMAP beállítása', ro: 'Configurare IMAP personalizat' },
  'in.f.imapHost': { hu: 'IMAP szerver', ro: 'Server IMAP' },
  'in.f.port': { hu: 'Port', ro: 'Port' },
  'in.f.tls': { hu: 'TLS (biztonságos kapcsolat)', ro: 'TLS (conexiune securizată)' },
  'in.f.emailAddr': { hu: 'Email cím', ro: 'Adresă email' },
  'in.f.appPass': { hu: 'App jelszó', ro: 'Parolă aplicație' },
  'in.f.password': { hu: 'Jelszó', ro: 'Parolă' },
  'in.f.mailbox': { hu: 'Postafiók', ro: 'Căsuță poștală' },
  'in.hint.gmail': { hu: 'ⓘ Nem a Gmail jelszavad! Hozz létre app jelszót: <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com</a> → Biztonság → Kétlépéses hitelesítés → App jelszavak.', ro: 'ⓘ Nu parola ta Gmail! Creează o parolă de aplicație: <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com</a> → Securitate → Verificare în doi pași → Parole aplicații.' },
  'in.rel.never': { hu: 'soha', ro: 'niciodată' },
  'in.rel.now': { hu: 'most', ro: 'acum' },
  'in.rel.minAgo': { hu: '{n} perce', ro: 'acum {n} min' },
  'in.rel.hourAgo': { hu: '{n} órája', ro: 'acum {n} h' },
});
function T(k,v){return (typeof window.t==='function')?window.t(k,v):k;}
window.EmailIntakeCard = (function () {
  var STYLE = ""
    + ".eic{border:1px solid var(--glass-border-dark,rgba(255,255,255,.08));border-radius:var(--radius-lg,18px);"
    + "padding:20px;background:var(--glass-bg-dark,rgba(255,255,255,.03));max-width:560px;}"
    + ".eic-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:6px;}"
    + ".eic-title{font-weight:700;font-size:16px;color:var(--text-primary);}"
    + ".eic-sub{font-size:13px;color:var(--text-muted);margin:2px 0 16px;}"
    + ".eic-badge{font-size:12px;font-weight:700;border-radius:999px;padding:4px 11px;white-space:nowrap;}"
    + ".eic-badge.off{background:rgba(138,151,168,.18);color:var(--text-muted);}"
    + ".eic-badge.ok{background:rgba(34,197,94,.16);color:#22c55e;}"
    + ".eic-prov{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:6px;}"
    + ".eic-prov button{display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 8px;"
    + "border:1px solid var(--glass-border-dark,rgba(255,255,255,.1));border-radius:var(--radius-md,12px);"
    + "background:rgba(255,255,255,.02);color:var(--text-primary);cursor:pointer;font-size:14px;font-weight:600;transition:.15s;}"
    + ".eic-prov button:hover{border-color:var(--eic-accent,#e10b1a);background:rgba(225,11,26,.07);}"
    + ".eic-prov .ic{font-size:24px;}"
    + ".eic-field{margin-bottom:12px;}"
    + ".eic-field label{display:block;font-size:13px;color:var(--text-primary);margin-bottom:6px;font-weight:600;}"
    + ".eic-field input{width:100%;font-size:15px;padding:10px 12px;border:1px solid var(--glass-border-dark,rgba(255,255,255,.12));"
    + "border-radius:var(--radius-sm,8px);background:rgba(255,255,255,.04);color:var(--text-primary);box-sizing:border-box;}"
    + ".eic-hint{font-size:12px;color:var(--text-muted);margin-top:5px;line-height:1.5;}"
    + ".eic-hint a{color:var(--eic-accent,#e10b1a);}"
    + ".eic-row{display:flex;gap:10px;}.eic-row .eic-field{flex:1;}"
    + ".eic-chk{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--text-primary);cursor:pointer;}"
    + ".eic-msg{font-size:13px;margin:10px 0 0;min-height:18px;}"
    + ".eic-msg.ok{color:#22c55e;}.eic-msg.err{color:#ef4444;}"
    + ".eic-actions{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;}"
    + ".eic-btn{font-size:14px;font-weight:600;padding:10px 16px;border-radius:var(--radius-sm,8px);border:1px solid transparent;cursor:pointer;transition:.15s;}"
    + ".eic-btn.primary{background:var(--eic-accent,#e10b1a);color:#fff;}"
    + ".eic-btn.ghost{background:transparent;border-color:var(--glass-border-dark,rgba(255,255,255,.18));color:var(--text-primary);}"
    + ".eic-btn.danger{background:transparent;border-color:rgba(239,68,68,.5);color:#ef4444;}"
    + ".eic-btn[disabled]{opacity:.5;cursor:default;}"
    + ".eic-kv{display:flex;justify-content:space-between;font-size:14px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);}"
    + ".eic-kv span:first-child{color:var(--text-muted);}.eic-kv span:last-child{color:var(--text-primary);font-weight:600;}";

  var PROV = {
    gmail:   { label: 'Gmail', icon: '✉️' },
    outlook: { label: 'Outlook', icon: '✉️' },
    custom:  { labelKey: 'in.prov.custom', icon: '🛠' },
  };
  function provLabel(key) { var p = PROV[key]; if (!p) return key; return p.labelKey ? T(p.labelKey) : p.label; }
  function curLang() { return (localStorage.getItem('vs-lang') === 'hu') ? 'hu-HU' : 'ro-RO'; }

  function ensureStyle() {
    if (document.getElementById('eic-style')) return;
    var s = document.createElement('style'); s.id = 'eic-style'; s.textContent = STYLE; document.head.appendChild(s);
  }
  function E(s) { return (window.esc ? esc(s) : String(s == null ? '' : s)); }
  function call(fn, a) { return window.gas ? gas(fn, a ? [a] : []) : Promise.reject(new Error('gas hiányzik')); }

  function relTime(iso) {
    if (!iso) return T('in.rel.never');
    var t = new Date(iso).getTime(); if (isNaN(t)) return '—';
    var d = Math.floor((Date.now() - t) / 1000);
    if (d < 60) return T('in.rel.now');
    if (d < 3600) return T('in.rel.minAgo', { n: Math.floor(d / 60) });
    if (d < 86400) return T('in.rel.hourAgo', { n: Math.floor(d / 3600) });
    return new Date(iso).toLocaleDateString(curLang());
  }
  function dateHu(iso) { if (!iso) return '—'; var dt = new Date(iso); return isNaN(dt) ? '—' : dt.toLocaleDateString(curLang()); }
  function dateHuTime(iso) { if (!iso) return '—'; var dt = new Date(iso); return isNaN(dt) ? '—' : dt.toLocaleString(curLang()); }

  function mount(target, opts) {
    var el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return;
    ensureStyle();
    var ctx = { el: el, readOnly: !!(opts && opts.readOnly), accent: (opts && opts.accent) || '#e10b1a' };
    el.style.setProperty('--eic-accent', ctx.accent);
    load(ctx);
  }

  function load(ctx) {
    ctx.el.innerHTML = '<div class="eic"><div class="eic-title">' + E(T('in.card.title')) + '</div><div class="eic-sub">' + E(T('in.card.loading')) + '</div></div>';
    call('getEmailIntakeConfig').then(function (r) {
      if (!r || !r.ok) return renderError(ctx, (r && r.err) || T('in.card.unavailable'));
      if (r.configured) renderConfigured(ctx, r);
      else renderEmpty(ctx);
    }).catch(function () { renderError(ctx, T('in.card.netErr')); });
  }

  function shell(ctx, badge, inner) {
    return '<div class="eic">'
      + '<div class="eic-head"><div class="eic-title">' + E(T('in.card.title')) + '</div>'
      + (badge || '') + '</div>' + inner + '</div>';
  }

  function renderError(ctx, msg) {
    ctx.el.innerHTML = shell(ctx, '', '<div class="eic-msg err">' + E(msg) + '</div>');
  }

  // ── Nincs beállítva ──
  function renderEmpty(ctx) {
    if (ctx.readOnly) {
      ctx.el.innerHTML = shell(ctx, '<span class="eic-badge off">' + E(T('in.badge.off')) + '</span>',
        '<div class="eic-sub">' + E(T('in.empty.readonly')) + '</div>');
      return;
    }
    var inner = '<div class="eic-sub">' + T('in.empty.intro') + '</div>'
      + '<div style="font-size:13px;color:var(--text-primary);font-weight:600;margin-bottom:8px;">' + E(T('in.empty.choose')) + '</div>'
      + '<div class="eic-prov">'
      + '<button data-prov="gmail"><span class="ic">✉️</span>Gmail</button>'
      + '<button data-prov="outlook"><span class="ic">✉️</span>Outlook</button>'
      + '<button data-prov="custom"><span class="ic">🛠</span>' + E(T('in.prov.custom')) + '</button>'
      + '</div>';
    ctx.el.innerHTML = shell(ctx, '<span class="eic-badge off">' + E(T('in.badge.off')) + '</span>', inner);
    ctx.el.querySelectorAll('.eic-prov button').forEach(function (b) {
      b.onclick = function () { renderForm(ctx, b.getAttribute('data-prov'), {}); };
    });
  }

  // ── Beállítva (státusz) ──
  function renderConfigured(ctx, r) {
    var prov = PROV[r.provider] ? provLabel(r.provider) : (r.provider || '—');
    var kv = '<div class="eic-kv"><span>' + E(T('in.kv.provider')) + '</span><span>' + E(prov) + '</span></div>'
      + (r.email ? '<div class="eic-kv"><span>' + E(T('in.kv.email')) + '</span><span>' + E(r.email) + '</span></div>' : '')
      + '<div class="eic-kv"><span>' + E(T('in.kv.mailbox')) + '</span><span>' + E(r.mailbox || 'INBOX') + '</span></div>'
      + '<div class="eic-kv"><span>' + E(T('in.kv.configuredAt')) + '</span><span>' + dateHu(r.configured_at) + '</span></div>'
      + (r.since ? '<div class="eic-kv"><span>' + E(T('in.kv.since')) + '</span><span>' + dateHuTime(r.since) + '</span></div>' : '')
      + '<div class="eic-kv" style="border-bottom:none;"><span>' + E(T('in.kv.lastPoll')) + '</span><span>' + relTime(r.last_polled_at) + '</span></div>';

    if (ctx.readOnly) {
      ctx.el.innerHTML = shell(ctx, '<span class="eic-badge ok">' + E(T('in.badge.active')) + '</span>',
        kv + '<div class="eic-sub" style="margin:14px 0 0;">' + E(T('in.cfg.readonly')) + '</div>');
      return;
    }
    var inner = kv + '<div class="eic-msg" id="eicMsg"></div>'
      + '<div class="eic-actions">'
      + '<button class="eic-btn ghost" id="eicTest">' + E(T('in.btn.test')) + '</button>'
      + '<button class="eic-btn primary" id="eicEdit">' + E(T('in.btn.edit')) + '</button>'
      + '<button class="eic-btn danger" id="eicDel">' + E(T('in.btn.delete')) + '</button>'
      + '</div>';
    ctx.el.innerHTML = shell(ctx, '<span class="eic-badge ok">' + E(T('in.badge.active')) + '</span>', inner);

    var msg = ctx.el.querySelector('#eicMsg');
    ctx.el.querySelector('#eicTest').onclick = function () {
      setMsg(msg, T('in.msg.testing'), '');
      call('testEmailIntakeConfig').then(function (rr) {
        if (rr && rr.ok) setMsg(msg, '✅ ' + rr.message, 'ok');
        else setMsg(msg, '❌ ' + ((rr && rr.err) || T('in.msg.err')), 'err');
      });
    };
    ctx.el.querySelector('#eicEdit').onclick = function () { renderForm(ctx, r.provider || 'gmail', { mailbox: r.mailbox }); };
    ctx.el.querySelector('#eicDel').onclick = function () {
      if (!confirm(T('in.confirm.delete'))) return;
      call('deleteEmailIntakeConfig').then(function (rr) {
        if (rr && rr.ok) { if (window.toast) toast(T('in.toast.deleted'), 'ok'); renderEmpty(ctx); }
        else setMsg(msg, '❌ ' + ((rr && rr.err) || T('in.msg.err')), 'err');
      });
    };
  }

  // ── Űrlap (hozzáadás / módosítás) ──
  function renderForm(ctx, provider, prefill) {
    provider = PROV[provider] ? provider : 'gmail';
    var p = prefill || {};
    var title = provider === 'gmail' ? T('in.form.gmail')
      : provider === 'outlook' ? T('in.form.outlook') : T('in.form.custom');

    var fields = '';
    if (provider === 'custom') {
      fields += '<div class="eic-row">'
        + '<div class="eic-field"><label>' + E(T('in.f.imapHost')) + '</label><input id="eicHost" value="' + E(p.host || '') + '" placeholder="mail.cegem.ro"></div>'
        + '<div class="eic-field" style="max-width:120px;"><label>' + E(T('in.f.port')) + '</label><input id="eicPort" type="number" value="' + E(p.port || 993) + '"></div>'
        + '</div>'
        + '<div class="eic-field"><label class="eic-chk"><input type="checkbox" id="eicTls" ' + (p.tls === false ? '' : 'checked') + '> ' + E(T('in.f.tls')) + '</label></div>';
    }
    fields += '<div class="eic-field"><label>' + E(T('in.f.emailAddr')) + '</label><input id="eicEmail" value="' + E(p.email || '') + '" placeholder="rendeles@cegem.com"></div>';
    if (provider === 'gmail') {
      fields += '<div class="eic-field"><label>' + E(T('in.f.appPass')) + '</label><input id="eicPass" type="password" placeholder="•••• •••• •••• ••••">'
        + '<div class="eic-hint">' + T('in.hint.gmail') + '</div></div>';
    } else {
      fields += '<div class="eic-field"><label>' + E(T('in.f.password')) + '</label><input id="eicPass" type="password" placeholder="••••••••••••"></div>';
    }
    fields += '<div class="eic-field"><label>' + E(T('in.f.mailbox')) + '</label><input id="eicMailbox" value="' + E(p.mailbox || 'INBOX') + '" placeholder="INBOX"></div>';

    var inner = '<div class="eic-sub" style="font-weight:600;color:var(--text-primary);">' + E(title) + '</div>'
      + fields
      + '<div class="eic-msg" id="eicMsg"></div>'
      + '<div class="eic-actions">'
      + '<button class="eic-btn ghost" id="eicTest">' + E(T('in.btn.testConn')) + '</button>'
      + '<button class="eic-btn ghost" id="eicBack">' + E(T('in.btn.back')) + '</button>'
      + '<button class="eic-btn primary" id="eicSave">' + E(T('in.btn.save')) + '</button>'
      + '</div>';
    ctx.el.innerHTML = shell(ctx, '', inner);

    var msg = ctx.el.querySelector('#eicMsg');
    function gather() {
      var a = {
        provider: provider,
        email: val('eicEmail'),
        password: val('eicPass'),
        mailbox: val('eicMailbox') || 'INBOX',
      };
      if (provider === 'custom') {
        a.host = val('eicHost');
        a.port = parseInt(val('eicPort'), 10) || 993;
        a.tls = !!(ctx.el.querySelector('#eicTls') && ctx.el.querySelector('#eicTls').checked);
      }
      return a;
    }
    function val(id) { var e = ctx.el.querySelector('#' + id); return e ? e.value.trim() : ''; }
    function busy(on) { ['eicTest', 'eicBack', 'eicSave'].forEach(function (id) { var b = ctx.el.querySelector('#' + id); if (b) b.disabled = on; }); }

    ctx.el.querySelector('#eicBack').onclick = function () { load(ctx); };
    ctx.el.querySelector('#eicTest').onclick = function () {
      busy(true); setMsg(msg, T('in.msg.testing'), '');
      call('testEmailIntakeConfig', gather()).then(function (rr) {
        busy(false);
        if (rr && rr.ok) setMsg(msg, '✅ ' + rr.message, 'ok');
        else setMsg(msg, '❌ ' + ((rr && rr.err) || T('in.msg.err')), 'err');
      }).catch(function () { busy(false); setMsg(msg, T('in.msg.netErr'), 'err'); });
    };
    ctx.el.querySelector('#eicSave').onclick = function () {
      busy(true); setMsg(msg, T('in.msg.saving'), '');
      call('saveEmailIntakeConfig', gather()).then(function (rr) {
        busy(false);
        if (rr && rr.ok) { if (window.toast) toast(T('in.toast.saved'), 'ok'); load(ctx); }
        else setMsg(msg, '❌ ' + ((rr && rr.err) || T('in.msg.err')), 'err');
      }).catch(function () { busy(false); setMsg(msg, T('in.msg.netErr'), 'err'); });
    };
  }

  function setMsg(el, text, kind) { if (!el) return; el.textContent = text || ''; el.className = 'eic-msg' + (kind ? ' ' + kind : ''); }

  return { mount: mount };
})();
