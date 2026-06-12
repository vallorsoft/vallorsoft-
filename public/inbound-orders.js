// public/inbound-orders.js — „Megrendelések" fül: beérkező fuvar-megrendelések kezelése.
// Globál: window.InboundOrders.mount(targetIdOrEl)
(window.registerI18n||function(d){(window.__i18nQueue=window.__i18nQueue||[]).push(d);})({
  'in.io.title': { hu: '📥 Megrendelések', ro: '📥 Comenzi' },
  'in.io.aiRead': { hu: 'AI-kiolvasás', ro: 'Extragere AI' },
  'in.io.pollNow': { hu: 'Lekérdezés most', ro: 'Interoghează acum' },
  'in.io.polling': { hu: 'Lekérdezés…', ro: 'Se interoghează…' },
  'in.io.refresh': { hu: 'Frissítés', ro: 'Reîmprospătare' },
  'in.io.loading': { hu: 'Betöltés…', ro: 'Se încarcă…' },
  'in.io.intakeWarn': { hu: 'A megrendelés-postafiók még nincs beállítva. Állítsd be az <b>Integrációk</b> menüpontban (📧 Megrendelés email fiók). Addig a lista üres marad; a „Lekérdezés most" gomb beállítás után működik.', ro: 'Căsuța de comenzi nu este încă configurată. Configureaz-o în meniul <b>Integrări</b> (📧 Cont email comenzi). Până atunci lista rămâne goală; butonul „Interoghează acum" funcționează după configurare.' },
  'in.io.aiConsent': { hu: 'Adatkezelési figyelmeztetés: bekapcsolva a megrendelők szövege/PDF-je egy külső AI-szolgáltatóhoz (Google Gemini) kerül feldolgozásra. Csak akkor kapcsold be, ha ezt az adatkezelést elfogadod. Bekapcsolod?', ro: 'Avertisment privind prelucrarea datelor: activat, textul/PDF-ul comenzilor este procesat de un furnizor AI extern (Google Gemini). Activează doar dacă accepți această prelucrare. Activezi?' },
  'in.io.mailboxNotSet': { hu: 'A postafiók még nincs beállítva.', ro: 'Căsuța poștală nu este încă configurată.' },
  'in.io.fld.client': { hu: 'Ügyfél', ro: 'Client' },
  'in.io.fld.cui': { hu: 'CUI', ro: 'CUI' },
  'in.io.fld.ref': { hu: 'Referencia', ro: 'Referință' },
  'in.io.fld.loadLoc': { hu: 'Felrakó', ro: 'Loc încărcare' },
  'in.io.fld.unloadLoc': { hu: 'Lerakó', ro: 'Loc descărcare' },
  'in.io.fld.loadDate': { hu: 'Felrakás dátuma', ro: 'Data încărcării' },
  'in.io.fld.unloadDate': { hu: 'Lerakás dátuma', ro: 'Data descărcării' },
  'in.io.fld.price': { hu: 'Ár', ro: 'Preț' },
  'in.io.fld.currency': { hu: 'Pénznem', ro: 'Monedă' },
  'in.io.fld.km': { hu: 'Km', ro: 'Km' },
  'in.io.fld.weight': { hu: 'Súly', ro: 'Greutate' },
  'in.io.fld.tractorPlate': { hu: 'Vontató rendszám', ro: 'Nr. înmatriculare cap tractor' },
  'in.io.fld.trailerPlate': { hu: 'Pótkocsi rendszám', ro: 'Nr. înmatriculare remorcă' },
  'in.io.fld.note': { hu: 'Megjegyzés', ro: 'Observații' },
  'in.io.st.new': { hu: 'Új', ro: 'Nou' },
  'in.io.st.parsed': { hu: 'Feldolgozva', ro: 'Procesat' },
  'in.io.st.reviewed': { hu: 'Ellenőrizve', ro: 'Verificat' },
  'in.io.st.approved': { hu: 'Jóváhagyva', ro: 'Aprobat' },
  'in.io.st.rejected': { hu: 'Elvetve', ro: 'Respins' },
  'in.io.confidence': { hu: 'Megbízhatóság', ro: 'Fiabilitate' },
  'in.io.ai': { hu: 'AI', ro: 'AI' },
  'in.io.manual': { hu: 'kézi/heurisztika', ro: 'manual/euristică' },
  'in.io.origPdf': { hu: '📎 Eredeti PDF', ro: '📎 PDF original' },
  'in.io.act.save': { hu: '💾 Mentés', ro: '💾 Salvare' },
  'in.io.act.reply': { hu: '✉️ Válasz', ro: '✉️ Răspuns' },
  'in.io.act.reparse': { hu: '↻ Újrafeldolgozás', ro: '↻ Reprocesare' },
  'in.io.act.approve': { hu: '✓ Elfogadás → Disponibil', ro: '✓ Acceptare → Disponibil' },
  'in.io.act.assignDriver': { hu: '+ Sofőr kiosztása', ro: '+ Alocare șofer' },
  'in.io.act.reject': { hu: '✕ Elvetés', ro: '✕ Respingere' },
  'in.io.asg.driverEmail': { hu: 'Sofőr e-mail (belső)', ro: 'Email șofer (intern)' },
  'in.io.asg.driverName': { hu: 'Sofőr neve', ro: 'Nume șofer' },
  'in.io.asg.approveAssign': { hu: '✓ Elfogadás + sofőr → Alocat', ro: '✓ Acceptare + șofer → Alocat' },
  'in.io.emailModuleMissing': { hu: 'Az e-mail modul nem töltött be.', ro: 'Modulul de email nu s-a încărcat.' },
  'in.io.confirmReject': { hu: 'Biztosan elveted?', ro: 'Sigur respingi?' },
  'in.io.created': { hu: 'Létrehozva: {id} ({status})', ro: 'Creat: {id} ({status})' },
  'in.io.noPending': { hu: '✓ Nincs feldolgozatlan megrendelés.', ro: '✓ Nicio comandă neprocesată.' },
  'in.io.handledBefore': { hu: '({n} korábbi elintézve)', ro: '({n} rezolvate anterior)' },
  'in.io.prev': { hu: '◀ Előző', ro: '◀ Anterior' },
  'in.io.next': { hu: 'Következő ▶', ro: 'Următor ▶' },
  'in.io.countPending': { hu: '{i} / {n} feldolgozatlan megrendelés', ro: '{i} / {n} comenzi neprocesate' },
  'in.io.navHint': { hu: 'A legutóbb beérkezett megrendelés van elöl. Elintézés (elfogadás/elvetés) után automatikusan a következő jön.', ro: 'Cea mai recentă comandă este prima. După rezolvare (acceptare/respingere) urmează automat următoarea.' },
  'in.io.errPrefix': { hu: 'Hiba', ro: 'Eroare' },
});
function T(k,v){return (typeof window.t==='function')?window.t(k,v):k;}
window.InboundOrders = (function () {
  const FIELDS = [
    ['client', 'in.io.fld.client'], ['client_cui', 'in.io.fld.cui'], ['ref', 'in.io.fld.ref'],
    ['loc_incarcare', 'in.io.fld.loadLoc'], ['loc_descarcare', 'in.io.fld.unloadLoc'],
    ['data_incarcare', 'in.io.fld.loadDate'], ['data_descarcare', 'in.io.fld.unloadDate'],
    ['pret', 'in.io.fld.price'], ['valuta', 'in.io.fld.currency'], ['km', 'in.io.fld.km'], ['greutate', 'in.io.fld.weight'],
    ['rendszam_camion', 'in.io.fld.tractorPlate'], ['rendszam_remorca', 'in.io.fld.trailerPlate'],
    ['observatii', 'in.io.fld.note'],
  ];
  const STATUS = { new: 'in.io.st.new', parsed: 'in.io.st.parsed', reviewed: 'in.io.st.reviewed', approved: 'in.io.st.approved', rejected: 'in.io.st.rejected' };

  function ensureStyle() {
    if (document.getElementById('io-style')) return;
    const s = document.createElement('style'); s.id = 'io-style';
    s.textContent = `
      .io-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
      .io-head h2{margin:0;font-size:20px}
      .io-spacer{flex:1}
      .io-btn{cursor:pointer;border:1px solid #cdd6e4;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;background:#fff}
      .io-btn--red{background:#e10b1a;color:#fff;border-color:#e10b1a}
      .io-btn--green{background:#16a34a;color:#fff;border-color:#16a34a}
      .io-btn--ghost{background:#f4f7fb}
      .io-toggle{display:flex;align-items:center;gap:8px;font-size:13px}
      .io-warn{background:#fdf0d8;color:#8a5a00;border:1px solid #f0d9a8;border-radius:8px;padding:8px 10px;font-size:12px;margin-bottom:12px}
      .io-card{border:1px solid #e3e9f2;border-radius:12px;padding:14px;margin-bottom:12px;background:#fff}
      .io-meta{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:12px;color:#5b6b82;margin-bottom:10px}
      .io-badge{font-size:11px;font-weight:700;border-radius:999px;padding:3px 9px}
      .io-b-new{background:#e7eefb;color:#1f4fb0}.io-b-parsed{background:#eef3fa;color:#33485f}
      .io-b-reviewed{background:#e3f7ec;color:#137a40}.io-b-approved{background:#dff3e6;color:#0f7a3a}
      .io-b-rejected{background:#fde8e6;color:#b3271a}
      .io-conf{font-weight:700}.io-conf.low{color:#c2410c}.io-conf.mid{color:#a16207}.io-conf.hi{color:#137a40}
      .io-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 12px}
      .io-f label{display:block;font-size:11px;color:#6b7a90;margin-bottom:2px}
      .io-f input{width:100%;border:1px solid #d3dded;border-radius:7px;padding:7px 9px;font-size:13px}
      .io-f input.empty{background:#fff8ec;border-color:#f0d39a}
      .io-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .io-assign{border-top:1px dashed #e3e9f2;margin-top:10px;padding-top:10px;display:none;gap:8px;flex-wrap:wrap;align-items:end}
      .io-assign.open{display:flex}
      .io-empty{color:#6b7a90;padding:14px 2px}
      .io-nav{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;background:#f4f7fb;border:1px solid #e3e9f2;border-radius:10px;padding:8px 12px}
      .io-nav .io-count{font-weight:700;font-size:14px;color:#1f2d3d}
      .io-nav .io-sub{font-size:12px;color:#6b7a90}
      .io-done{background:#dff3e6;color:#0f7a3a;border:1px solid #bfe6cc;border-radius:10px;padding:14px;font-weight:600}
      @media(max-width:640px){.io-grid{grid-template-columns:1fr}}`;
    document.head.appendChild(s);
  }
  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || (T('in.io.errPrefix') + ' (' + r.status + ')'));
    return d;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  function confClass(c) { c = Number(c || 0); return c >= 0.7 ? 'hi' : c >= 0.4 ? 'mid' : 'low'; }

  function mount(target) {
    ensureStyle();
    const root = typeof target === 'string' ? document.getElementById(target) : target;
    if (!root) return;
    root.innerHTML =
      '<div class="io-head">' +
        '<h2>' + T('in.io.title') + '</h2>' +
        '<label class="io-toggle"><input type="checkbox" id="ioAi"> ' + T('in.io.aiRead') + '</label>' +
        '<div class="io-spacer"></div>' +
        '<button class="io-btn io-btn--ghost" id="ioPoll">' + T('in.io.pollNow') + '</button>' +
        '<button class="io-btn io-btn--ghost" id="ioRefresh">' + T('in.io.refresh') + '</button>' +
      '</div>' +
      '<div id="ioInfo"></div>' +
      '<div id="ioList"><div class="io-empty">' + T('in.io.loading') + '</div></div>';
    const $ = (id) => root.querySelector('#' + id);

    // AI ki/be + adatkezelési figyelmeztetés bekapcsoláskor
    async function loadSettings() {
      try {
        const s = await api('GET', '/api/inbound-orders/settings');
        $('ioAi').checked = !!s.ai_enabled;
        if (!s.intake_configured) $('ioInfo').innerHTML = '<div class="io-warn">' + T('in.io.intakeWarn') + '</div>';
      } catch (e) {}
    }
    $('ioAi').addEventListener('change', async function () {
      const on = $('ioAi').checked;
      if (on && !confirm(T('in.io.aiConsent'))) {
        $('ioAi').checked = false; return;
      }
      try { await api('POST', '/api/inbound-orders/settings', { ai_enabled: on }); }
      catch (e) { alert(e.message); $('ioAi').checked = !on; }
    });
    $('ioPoll').addEventListener('click', async function () {
      const b = $('ioPoll'); b.disabled = true; b.textContent = T('in.io.polling');
      try { const r = await api('POST', '/api/inbound-orders/poll'); await load(); if (r.skipped) alert(T('in.io.mailboxNotSet')); }
      catch (e) { alert(e.message); } finally { b.disabled = false; b.textContent = T('in.io.pollNow'); }
    });
    $('ioRefresh').addEventListener('click', function () { load(); });

    function card(it) {
      const ex = it.extracted || {};
      const fieldsHtml = FIELDS.map(function (f) {
        const v = ex[f[0]] == null ? '' : ex[f[0]];
        return '<div class="io-f"><label>' + esc(T(f[1])) + '</label>' +
          '<input data-k="' + f[0] + '" class="' + (v === '' ? 'empty' : '') + '" value="' + esc(v) + '"></div>';
      }).join('');
      const st = it.status, badge = 'io-b-' + st;
      const done = (st === 'approved' || st === 'rejected');
      return '<div class="io-card" data-id="' + it.id + '" data-email="' + esc(it.source_email || '') + '">' +
        '<div class="io-meta">' +
          '<span class="io-badge ' + badge + '">' + esc(STATUS[st] ? T(STATUS[st]) : st) + '</span>' +
          '<span class="io-conf ' + confClass(it.confidence) + '">' + esc(T('in.io.confidence')) + ': ' + Math.round((it.confidence || 0) * 100) + '%</span>' +
          (it.ai_used ? '<span>· ' + esc(T('in.io.ai')) + '</span>' : '<span>· ' + esc(T('in.io.manual')) + '</span>') +
          '<span>· ' + esc(it.source_email || '—') + '</span>' +
          '<span>· ' + esc(it.subject || '') + '</span>' +
          (it.pdf_name ? '<a href="/api/inbound-orders/' + it.id + '/pdf" target="_blank">' + esc(T('in.io.origPdf')) + '</a>' : '') +
          (it.created_order_id ? '<span>→ <b>' + esc(it.created_order_id) + '</b></span>' : '') +
        '</div>' +
        (done ? '' :
          '<div class="io-grid">' + fieldsHtml + '</div>' +
          '<div class="io-acts">' +
            '<button class="io-btn io-btn--ghost" data-act="save">' + T('in.io.act.save') + '</button>' +
            '<button class="io-btn io-btn--ghost" data-act="email">' + T('in.io.act.reply') + '</button>' +
            '<button class="io-btn io-btn--ghost" data-act="reparse">' + T('in.io.act.reparse') + '</button>' +
            '<button class="io-btn io-btn--green" data-act="approve">' + T('in.io.act.approve') + '</button>' +
            '<button class="io-btn io-btn--ghost" data-act="assignToggle">' + T('in.io.act.assignDriver') + '</button>' +
            '<button class="io-btn io-btn--red" data-act="reject">' + T('in.io.act.reject') + '</button>' +
          '</div>' +
          '<div class="io-assign">' +
            '<div class="io-f"><label>' + esc(T('in.io.asg.driverEmail')) + '</label><input data-a="email_sofer"></div>' +
            '<div class="io-f"><label>' + esc(T('in.io.asg.driverName')) + '</label><input data-a="nume_sofer"></div>' +
            '<div class="io-f"><label>' + esc(T('in.io.fld.tractorPlate')) + '</label><input data-a="rendszam_camion" value="' + esc(ex.rendszam_camion || '') + '"></div>' +
            '<button class="io-btn io-btn--green" data-act="approveAssign">' + T('in.io.asg.approveAssign') + '</button>' +
          '</div>') +
      '</div>';
    }

    function collect(cardEl) {
      const ex = {};
      cardEl.querySelectorAll('input[data-k]').forEach(function (i) { ex[i.getAttribute('data-k')] = i.value.trim() || null; });
      return ex;
    }
    function assignData(cardEl) {
      const a = {};
      cardEl.querySelectorAll('input[data-a]').forEach(function (i) { if (i.value.trim()) a[i.getAttribute('data-a')] = i.value.trim(); });
      if (a.email_sofer) a.sofer_type = 'Intern';
      return a;
    }

    // ── Egyszerre EGY feldolgozatlan megrendelést mutatunk (a legutolsót), lapozható ──
    let pending = [];   // feldolgozatlanok (új/feldolgozva/ellenőrizve), legújabb elöl
    let idx = 0;        // aktuális mutatott elem indexe
    let totalHandled = 0;
    const isPending = (it) => ['new', 'parsed', 'reviewed'].indexOf(it.status) >= 0;

    function renderCurrent() {
      if (!pending.length) {
        $('ioList').innerHTML = '<div class="io-done">' + T('in.io.noPending') +
          (totalHandled ? ' <span style="font-weight:400;">' + T('in.io.handledBefore', { n: totalHandled }) + '</span>' : '') + '</div>';
        return;
      }
      if (idx < 0) idx = 0;
      if (idx > pending.length - 1) idx = pending.length - 1;
      const it = pending[idx];
      const nav =
        '<div class="io-nav">' +
          '<button class="io-btn io-btn--ghost" data-nav="prev"' + (idx === 0 ? ' disabled' : '') + '>' + T('in.io.prev') + '</button>' +
          '<div><span class="io-count">' + T('in.io.countPending', { i: idx + 1, n: pending.length }) + '</span>' +
            '<div class="io-sub">' + T('in.io.navHint') + '</div></div>' +
          '<div class="io-spacer"></div>' +
          '<button class="io-btn io-btn--red" data-nav="next"' + (idx >= pending.length - 1 ? ' disabled' : '') + '>' + T('in.io.next') + '</button>' +
        '</div>';
      $('ioList').innerHTML = nav + card(it);
      bindCard();
    }

    function bindCard() {
      root.querySelectorAll('#ioList [data-nav]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.dataset.nav === 'prev') idx--; else idx++;
          renderCurrent();
        });
      });
      const cardEl = root.querySelector('.io-card');
      if (!cardEl) return;
      cardEl.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const id = cardEl.dataset.id; const act = btn.dataset.act;
          try {
            if (act === 'assignToggle') { cardEl.querySelector('.io-assign').classList.toggle('open'); return; }
            if (act === 'email') {
              if (!window.ClientMail) { alert(T('in.io.emailModuleMissing')); return; }
              const ex = collect(cardEl);
              ClientMail.open({ to: cardEl.dataset.email || '', inbound_order_id: id,
                context: { client: ex.client, ref: ex.ref, loc_incarcare: ex.loc_incarcare, loc_descarcare: ex.loc_descarcare, pret: ex.pret, order_id: '' } });
              return;
            }
            btn.disabled = true;
            // save/reparse: maradunk az aktuális elemen; approve/reject: az elem kikerül → marad az index (a következő csúszik a helyére)
            if (act === 'save') { await api('PUT', '/api/inbound-orders/' + id, { extracted: collect(cardEl) }); await load(true); }
            else if (act === 'reparse') { await api('POST', '/api/inbound-orders/' + id + '/reparse'); await load(true); }
            else if (act === 'reject') { if (confirm(T('in.io.confirmReject'))) { await api('POST', '/api/inbound-orders/' + id + '/reject'); await load(true); } else btn.disabled = false; }
            else if (act === 'approve') { await api('PUT', '/api/inbound-orders/' + id, { extracted: collect(cardEl) }); const r = await api('POST', '/api/inbound-orders/' + id + '/approve', {}); alert(T('in.io.created', { id: r.order_id, status: r.status })); await load(true); }
            else if (act === 'approveAssign') { await api('PUT', '/api/inbound-orders/' + id, { extracted: collect(cardEl) }); const r = await api('POST', '/api/inbound-orders/' + id + '/approve', { assign: assignData(cardEl) }); alert(T('in.io.created', { id: r.order_id, status: r.status })); await load(true); }
          } catch (e) { alert(e.message); btn.disabled = false; }
        });
      });
    }

    async function load(keepIdx) {
      try {
        const d = await api('GET', '/api/inbound-orders');
        const items = d.items || [];
        pending = items.filter(isPending);   // a szerver received_at DESC szerint adja → legújabb elöl
        totalHandled = items.length - pending.length;
        if (!keepIdx) idx = 0;               // friss betöltésnél a legutolsóval kezdünk
        renderCurrent();
      } catch (e) { $('ioList').innerHTML = '<div class="io-empty">' + esc(e.message) + '</div>'; }
    }

    loadSettings();
    load();

    // Nyelvváltáskor a teljes nézet újrarendelése (statikus fejléc + figyelmeztetés + lista)
    _lastRerender = function () {
      root.innerHTML =
        '<div class="io-head">' +
          '<h2>' + T('in.io.title') + '</h2>' +
          '<label class="io-toggle"><input type="checkbox" id="ioAi"> ' + T('in.io.aiRead') + '</label>' +
          '<div class="io-spacer"></div>' +
          '<button class="io-btn io-btn--ghost" id="ioPoll">' + T('in.io.pollNow') + '</button>' +
          '<button class="io-btn io-btn--ghost" id="ioRefresh">' + T('in.io.refresh') + '</button>' +
        '</div>' +
        '<div id="ioInfo"></div>' +
        '<div id="ioList"><div class="io-empty">' + T('in.io.loading') + '</div></div>';
      mount(root);
    };
  }
  var _lastRerender = null;
  if (window.I18N && typeof window.I18N.onLang === 'function') {
    window.I18N.onLang(function () { if (typeof _lastRerender === 'function') _lastRerender(); });
  }
  return { mount };
})();
