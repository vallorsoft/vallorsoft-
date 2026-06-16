// public/email-intake-card.js
// "📧 Megrendelés email fiók" kártya az Integrációk / Számlázó fülre.
// Cégenként megadható IMAP postafiók (Gmail / Outlook / Egyedi). A hitelesítő
// adatok titkosítva, szerver oldalon tárolódnak — sosem kerülnek vissza nyíltan.
// RPC: gas('getEmailIntakeConfig' | 'saveEmailIntakeConfig' | 'testEmailIntakeConfig' | 'deleteEmailIntakeConfig').
// Használat: EmailIntakeCard.mount('emailIntakeCardBox', { readOnly:false });
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
    + ".eic-prov button:hover{border-color:var(--eic-accent,#f6711e);background:rgba(246,113,30,.07);}"
    + ".eic-prov .ic{font-size:24px;}"
    + ".eic-field{margin-bottom:12px;}"
    + ".eic-field label{display:block;font-size:13px;color:var(--text-primary);margin-bottom:6px;font-weight:600;}"
    + ".eic-field input{width:100%;font-size:15px;padding:10px 12px;border:1px solid var(--glass-border-dark,rgba(255,255,255,.12));"
    + "border-radius:var(--radius-sm,8px);background:rgba(255,255,255,.04);color:var(--text-primary);box-sizing:border-box;}"
    + ".eic-hint{font-size:12px;color:var(--text-muted);margin-top:5px;line-height:1.5;}"
    + ".eic-hint a{color:var(--eic-accent,#f6711e);}"
    + ".eic-row{display:flex;gap:10px;}.eic-row .eic-field{flex:1;}"
    + ".eic-chk{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--text-primary);cursor:pointer;}"
    + ".eic-msg{font-size:13px;margin:10px 0 0;min-height:18px;}"
    + ".eic-msg.ok{color:#22c55e;}.eic-msg.err{color:#ef4444;}"
    + ".eic-actions{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;}"
    + ".eic-btn{font-size:14px;font-weight:600;padding:10px 16px;border-radius:var(--radius-sm,8px);border:1px solid transparent;cursor:pointer;transition:.15s;}"
    + ".eic-btn.primary{background:var(--eic-accent,#f6711e);color:#fff;}"
    + ".eic-btn.ghost{background:transparent;border-color:var(--glass-border-dark,rgba(255,255,255,.18));color:var(--text-primary);}"
    + ".eic-btn.danger{background:transparent;border-color:rgba(239,68,68,.5);color:#ef4444;}"
    + ".eic-btn[disabled]{opacity:.5;cursor:default;}"
    + ".eic-kv{display:flex;justify-content:space-between;font-size:14px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);}"
    + ".eic-kv span:first-child{color:var(--text-muted);}.eic-kv span:last-child{color:var(--text-primary);font-weight:600;}";

  var PROV = {
    gmail:   { label: 'Gmail', icon: '✉️' },
    outlook: { label: 'Outlook', icon: '✉️' },
    custom:  { label: 'Egyedi IMAP', icon: '🛠' },
  };

  function ensureStyle() {
    if (document.getElementById('eic-style')) return;
    var s = document.createElement('style'); s.id = 'eic-style'; s.textContent = STYLE; document.head.appendChild(s);
  }
  function E(s) { return (window.esc ? esc(s) : String(s == null ? '' : s)); }
  function call(fn, a) { return window.gas ? gas(fn, a ? [a] : []) : Promise.reject(new Error('gas hiányzik')); }

  function relTime(iso) {
    if (!iso) return 'soha';
    var t = new Date(iso).getTime(); if (isNaN(t)) return '—';
    var d = Math.floor((Date.now() - t) / 1000);
    if (d < 60) return 'most';
    if (d < 3600) return Math.floor(d / 60) + ' perce';
    if (d < 86400) return Math.floor(d / 3600) + ' órája';
    return new Date(iso).toLocaleDateString('hu-HU');
  }
  function dateHu(iso) { if (!iso) return '—'; var dt = new Date(iso); return isNaN(dt) ? '—' : dt.toLocaleDateString('hu-HU'); }
  function dateHuTime(iso) { if (!iso) return '—'; var dt = new Date(iso); return isNaN(dt) ? '—' : dt.toLocaleString('hu-HU'); }

  function mount(target, opts) {
    var el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return;
    ensureStyle();
    var ctx = { el: el, readOnly: !!(opts && opts.readOnly), accent: (opts && opts.accent) || '#f6711e' };
    el.style.setProperty('--eic-accent', ctx.accent);
    load(ctx);
  }

  function load(ctx) {
    ctx.el.innerHTML = '<div class="eic"><div class="eic-title">📧 Megrendelés email fiók</div><div class="eic-sub">Betöltés…</div></div>';
    call('getEmailIntakeConfig').then(function (r) {
      if (!r || !r.ok) return renderError(ctx, (r && r.err) || 'Nem elérhető.');
      if (r.configured) renderConfigured(ctx, r);
      else renderEmpty(ctx);
    }).catch(function () { renderError(ctx, 'Hálózati hiba.'); });
  }

  function shell(ctx, badge, inner) {
    return '<div class="eic">'
      + '<div class="eic-head"><div class="eic-title">📧 Megrendelés email fiók</div>'
      + (badge || '') + '</div>' + inner + '</div>';
  }

  function renderError(ctx, msg) {
    ctx.el.innerHTML = shell(ctx, '', '<div class="eic-msg err">' + E(msg) + '</div>');
  }

  // ── Nincs beállítva ──
  function renderEmpty(ctx) {
    if (ctx.readOnly) {
      ctx.el.innerHTML = shell(ctx, '<span class="eic-badge off">Nincs beállítva</span>',
        '<div class="eic-sub">Még nincs megrendelés-fiók beállítva. A beállítást az Admin kezeli.</div>');
      return;
    }
    var inner = '<div class="eic-sub">Nincs beállítva — add meg azt az email fiókot, amelyre a megrendeléseket kapod. <b>A mentés pillanatától</b> csak az azután beérkező leveleket dolgozza fel (a régieket nem).</div>'
      + '<div style="font-size:13px;color:var(--text-primary);font-weight:600;margin-bottom:8px;">Válassz szolgáltatót:</div>'
      + '<div class="eic-prov">'
      + '<button data-prov="gmail"><span class="ic">✉️</span>Gmail</button>'
      + '<button data-prov="outlook"><span class="ic">✉️</span>Outlook</button>'
      + '<button data-prov="custom"><span class="ic">🛠</span>Egyedi IMAP</button>'
      + '</div>';
    ctx.el.innerHTML = shell(ctx, '<span class="eic-badge off">Nincs beállítva</span>', inner);
    ctx.el.querySelectorAll('.eic-prov button').forEach(function (b) {
      b.onclick = function () { renderForm(ctx, b.getAttribute('data-prov'), {}); };
    });
  }

  // ── Beállítva (státusz) ──
  function renderConfigured(ctx, r) {
    var prov = PROV[r.provider] ? PROV[r.provider].label : (r.provider || '—');
    var kv = '<div class="eic-kv"><span>Szolgáltató</span><span>' + E(prov) + '</span></div>'
      + (r.email ? '<div class="eic-kv"><span>Email</span><span>' + E(r.email) + '</span></div>' : '')
      + '<div class="eic-kv"><span>Postafiók</span><span>' + E(r.mailbox || 'INBOX') + '</span></div>'
      + '<div class="eic-kv"><span>Beállítva</span><span>' + dateHu(r.configured_at) + '</span></div>'
      + (r.since ? '<div class="eic-kv"><span>Csak ettől dolgozza fel</span><span>' + dateHuTime(r.since) + '</span></div>' : '')
      + '<div class="eic-kv" style="border-bottom:none;"><span>Utolsó lekérdezés</span><span>' + relTime(r.last_polled_at) + '</span></div>';

    if (ctx.readOnly) {
      ctx.el.innerHTML = shell(ctx, '<span class="eic-badge ok">✅ Aktív</span>',
        kv + '<div class="eic-sub" style="margin:14px 0 0;">A beállítást az Admin kezeli.</div>');
      return;
    }
    var inner = kv + '<div class="eic-msg" id="eicMsg"></div>'
      + '<div class="eic-actions">'
      + '<button class="eic-btn ghost" id="eicTest">🔌 Tesztelés</button>'
      + '<button class="eic-btn primary" id="eicEdit">✏️ Módosítás</button>'
      + '<button class="eic-btn danger" id="eicDel">🗑 Törlés</button>'
      + '</div>';
    ctx.el.innerHTML = shell(ctx, '<span class="eic-badge ok">✅ Aktív</span>', inner);

    var msg = ctx.el.querySelector('#eicMsg');
    ctx.el.querySelector('#eicTest').onclick = function () {
      setMsg(msg, 'Tesztelés…', '');
      call('testEmailIntakeConfig').then(function (rr) {
        if (rr && rr.ok) setMsg(msg, '✅ ' + rr.message, 'ok');
        else setMsg(msg, '❌ ' + ((rr && rr.err) || 'Hiba'), 'err');
      });
    };
    ctx.el.querySelector('#eicEdit').onclick = function () { renderForm(ctx, r.provider || 'gmail', { mailbox: r.mailbox }); };
    ctx.el.querySelector('#eicDel').onclick = function () {
      if (!confirm('Biztosan törlöd a megrendelés email fiók beállítását? A lekérdezés ezután leáll.')) return;
      call('deleteEmailIntakeConfig').then(function (rr) {
        if (rr && rr.ok) { if (window.toast) toast('Beállítás törölve', 'ok'); renderEmpty(ctx); }
        else setMsg(msg, '❌ ' + ((rr && rr.err) || 'Hiba'), 'err');
      });
    };
  }

  // ── Űrlap (hozzáadás / módosítás) ──
  function renderForm(ctx, provider, prefill) {
    provider = PROV[provider] ? provider : 'gmail';
    var p = prefill || {};
    var title = provider === 'gmail' ? 'Gmail beállítása'
      : provider === 'outlook' ? 'Outlook/Office365 beállítása' : 'Egyedi IMAP beállítása';

    var fields = '';
    if (provider === 'custom') {
      fields += '<div class="eic-row">'
        + '<div class="eic-field"><label>IMAP szerver</label><input id="eicHost" value="' + E(p.host || '') + '" placeholder="mail.cegem.ro"></div>'
        + '<div class="eic-field" style="max-width:120px;"><label>Port</label><input id="eicPort" type="number" value="' + E(p.port || 993) + '"></div>'
        + '</div>'
        + '<div class="eic-field"><label class="eic-chk"><input type="checkbox" id="eicTls" ' + (p.tls === false ? '' : 'checked') + '> TLS (biztonságos kapcsolat)</label></div>';
    }
    fields += '<div class="eic-field"><label>Email cím</label><input id="eicEmail" value="' + E(p.email || '') + '" placeholder="rendeles@cegem.com"></div>';
    if (provider === 'gmail') {
      fields += '<div class="eic-field"><label>App jelszó</label><input id="eicPass" type="password" placeholder="•••• •••• •••• ••••">'
        + '<div class="eic-hint">ⓘ Nem a Gmail jelszavad! Hozz létre app jelszót: '
        + '<a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com</a> → Biztonság → Kétlépéses hitelesítés → App jelszavak.</div></div>';
    } else {
      fields += '<div class="eic-field"><label>Jelszó</label><input id="eicPass" type="password" placeholder="••••••••••••"></div>';
    }
    fields += '<div class="eic-field"><label>Postafiók</label><input id="eicMailbox" value="' + E(p.mailbox || 'INBOX') + '" placeholder="INBOX"></div>';

    var inner = '<div class="eic-sub" style="font-weight:600;color:var(--text-primary);">' + E(title) + '</div>'
      + fields
      + '<div class="eic-msg" id="eicMsg"></div>'
      + '<div class="eic-actions">'
      + '<button class="eic-btn ghost" id="eicTest">🔌 Kapcsolat tesztelése</button>'
      + '<button class="eic-btn ghost" id="eicBack">← Vissza</button>'
      + '<button class="eic-btn primary" id="eicSave">💾 Mentés</button>'
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
      busy(true); setMsg(msg, 'Tesztelés…', '');
      call('testEmailIntakeConfig', gather()).then(function (rr) {
        busy(false);
        if (rr && rr.ok) setMsg(msg, '✅ ' + rr.message, 'ok');
        else setMsg(msg, '❌ ' + ((rr && rr.err) || 'Hiba'), 'err');
      }).catch(function () { busy(false); setMsg(msg, '❌ Hálózati hiba', 'err'); });
    };
    ctx.el.querySelector('#eicSave').onclick = function () {
      busy(true); setMsg(msg, 'Mentés…', '');
      call('saveEmailIntakeConfig', gather()).then(function (rr) {
        busy(false);
        if (rr && rr.ok) { if (window.toast) toast('Beállítás mentve', 'ok'); load(ctx); }
        else setMsg(msg, '❌ ' + ((rr && rr.err) || 'Hiba'), 'err');
      }).catch(function () { busy(false); setMsg(msg, '❌ Hálózati hiba', 'err'); });
    };
  }

  function setMsg(el, text, kind) { if (!el) return; el.textContent = text || ''; el.className = 'eic-msg' + (kind ? ' ' + kind : ''); }

  return { mount: mount };
})();
