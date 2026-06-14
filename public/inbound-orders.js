// public/inbound-orders.js — „Megrendelések" fül: beérkező fuvar-megrendelések kezelése.
// Globál: window.InboundOrders.mount(targetIdOrEl)
window.InboundOrders = (function () {
  const FIELDS = [
    ['client', 'Ügyfél'], ['client_cui', 'CUI'], ['ref', 'Referencia'],
    ['loc_incarcare', 'Felrakó'], ['loc_descarcare', 'Lerakó'],
    ['data_incarcare', 'Felrakás dátuma'], ['data_descarcare', 'Lerakás dátuma'],
    ['pret', 'Ár'], ['valuta', 'Pénznem'], ['km', 'Km'], ['greutate', 'Súly'],
    ['rendszam_camion', 'Vontató rendszám'], ['rendszam_remorca', 'Pótkocsi rendszám'],
    ['observatii', 'Megjegyzés'],
  ];
  const STATUS = { new: 'Új', parsed: 'Feldolgozva', reviewed: 'Ellenőrizve', approved: 'Jóváhagyva', rejected: 'Elvetve' };

  function ensureStyle() {
    if (document.getElementById('io-style')) return;
    const s = document.createElement('style'); s.id = 'io-style';
    s.textContent = `
      .io-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
      .io-head h2{margin:0;font-size:20px}
      .io-spacer{flex:1}
      .io-btn{cursor:pointer;border:1px solid #cdd6e4;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;background:#fff}
      .io-btn--red{background:#ef4444;color:#fff;border-color:#ef4444}
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
    if (!r.ok) throw new Error(d.error || ('Hiba (' + r.status + ')'));
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
        '<h2>📥 Megrendelések</h2>' +
        '<label class="io-toggle"><input type="checkbox" id="ioAi"> AI-kiolvasás</label>' +
        '<div class="io-spacer"></div>' +
        '<button class="io-btn io-btn--ghost" id="ioPoll">Lekérdezés most</button>' +
        '<button class="io-btn io-btn--ghost" id="ioRefresh">Frissítés</button>' +
      '</div>' +
      '<div id="ioInfo"></div>' +
      '<div id="ioList"><div class="io-empty">Betöltés…</div></div>';
    const $ = (id) => root.querySelector('#' + id);

    // AI ki/be + adatkezelési figyelmeztetés bekapcsoláskor
    async function loadSettings() {
      try {
        const s = await api('GET', '/api/inbound-orders/settings');
        $('ioAi').checked = !!s.ai_enabled;
        if (!s.intake_configured) $('ioInfo').innerHTML = '<div class="io-warn">A megrendelés-postafiók még nincs beállítva. Állítsd be az <b>Integrációk</b> menüpontban (📧 Megrendelés email fiók). Addig a lista üres marad; a „Lekérdezés most” gomb beállítás után működik.</div>';
      } catch (e) {}
    }
    $('ioAi').addEventListener('change', async function () {
      const on = $('ioAi').checked;
      if (on && !confirm('Adatkezelési figyelmeztetés: bekapcsolva a megrendelők szövege/PDF-je egy külső AI-szolgáltatóhoz (Google Gemini) kerül feldolgozásra. Csak akkor kapcsold be, ha ezt az adatkezelést elfogadod. Bekapcsolod?')) {
        $('ioAi').checked = false; return;
      }
      try { await api('POST', '/api/inbound-orders/settings', { ai_enabled: on }); }
      catch (e) { alert(e.message); $('ioAi').checked = !on; }
    });
    $('ioPoll').addEventListener('click', async function () {
      const b = $('ioPoll'); b.disabled = true; b.textContent = 'Lekérdezés…';
      try { const r = await api('POST', '/api/inbound-orders/poll'); await load(); if (r.skipped) alert('A postafiók még nincs beállítva.'); }
      catch (e) { alert(e.message); } finally { b.disabled = false; b.textContent = 'Lekérdezés most'; }
    });
    $('ioRefresh').addEventListener('click', function () { load(); });

    function card(it) {
      const ex = it.extracted || {};
      const fieldsHtml = FIELDS.map(function (f) {
        const v = ex[f[0]] == null ? '' : ex[f[0]];
        return '<div class="io-f"><label>' + f[1] + '</label>' +
          '<input data-k="' + f[0] + '" class="' + (v === '' ? 'empty' : '') + '" value="' + esc(v) + '"></div>';
      }).join('');
      const st = it.status, badge = 'io-b-' + st;
      const done = (st === 'approved' || st === 'rejected');
      return '<div class="io-card" data-id="' + it.id + '" data-email="' + esc(it.source_email || '') + '">' +
        '<div class="io-meta">' +
          '<span class="io-badge ' + badge + '">' + (STATUS[st] || st) + '</span>' +
          '<span class="io-conf ' + confClass(it.confidence) + '">Megbízhatóság: ' + Math.round((it.confidence || 0) * 100) + '%</span>' +
          (it.ai_used ? '<span>· AI</span>' : '<span>· kézi/heurisztika</span>') +
          '<span>· ' + esc(it.source_email || '—') + '</span>' +
          '<span>· ' + esc(it.subject || '') + '</span>' +
          (it.pdf_name ? '<a href="/api/inbound-orders/' + it.id + '/pdf" target="_blank">📎 Eredeti PDF</a>' : '') +
          (it.created_order_id ? '<span>→ <b>' + esc(it.created_order_id) + '</b></span>' : '') +
        '</div>' +
        (done ? '' :
          '<div class="io-grid">' + fieldsHtml + '</div>' +
          '<div class="io-acts">' +
            '<button class="io-btn io-btn--ghost" data-act="save">💾 Mentés</button>' +
            '<button class="io-btn io-btn--ghost" data-act="email">✉️ Válasz</button>' +
            '<button class="io-btn io-btn--ghost" data-act="reparse">↻ Újrafeldolgozás</button>' +
            '<button class="io-btn io-btn--green" data-act="approve">✓ Elfogadás → Disponibil</button>' +
            '<button class="io-btn io-btn--ghost" data-act="assignToggle">+ Sofőr kiosztása</button>' +
            '<button class="io-btn io-btn--red" data-act="reject">✕ Elvetés</button>' +
          '</div>' +
          '<div class="io-assign">' +
            '<div class="io-f"><label>Sofőr e-mail (belső)</label><input data-a="email_sofer"></div>' +
            '<div class="io-f"><label>Sofőr neve</label><input data-a="nume_sofer"></div>' +
            '<div class="io-f"><label>Vontató rendszám</label><input data-a="rendszam_camion" value="' + esc(ex.rendszam_camion || '') + '"></div>' +
            '<button class="io-btn io-btn--green" data-act="approveAssign">✓ Elfogadás + sofőr → Alocat</button>' +
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
        $('ioList').innerHTML = '<div class="io-done">✓ Nincs feldolgozatlan megrendelés.' +
          (totalHandled ? ' <span style="font-weight:400;">(' + totalHandled + ' korábbi elintézve)</span>' : '') + '</div>';
        return;
      }
      if (idx < 0) idx = 0;
      if (idx > pending.length - 1) idx = pending.length - 1;
      const it = pending[idx];
      const nav =
        '<div class="io-nav">' +
          '<button class="io-btn io-btn--ghost" data-nav="prev"' + (idx === 0 ? ' disabled' : '') + '>◀ Előző</button>' +
          '<div><span class="io-count">' + (idx + 1) + ' / ' + pending.length + ' feldolgozatlan megrendelés</span>' +
            '<div class="io-sub">A legutóbb beérkezett megrendelés van elöl. Elintézés (elfogadás/elvetés) után automatikusan a következő jön.</div></div>' +
          '<div class="io-spacer"></div>' +
          '<button class="io-btn io-btn--red" data-nav="next"' + (idx >= pending.length - 1 ? ' disabled' : '') + '>Következő ▶</button>' +
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
              if (!window.ClientMail) { alert('Az e-mail modul nem töltött be.'); return; }
              const ex = collect(cardEl);
              ClientMail.open({ to: cardEl.dataset.email || '', inbound_order_id: id,
                context: { client: ex.client, ref: ex.ref, loc_incarcare: ex.loc_incarcare, loc_descarcare: ex.loc_descarcare, pret: ex.pret, order_id: '' } });
              return;
            }
            btn.disabled = true;
            // save/reparse: maradunk az aktuális elemen; approve/reject: az elem kikerül → marad az index (a következő csúszik a helyére)
            if (act === 'save') { await api('PUT', '/api/inbound-orders/' + id, { extracted: collect(cardEl) }); await load(true); }
            else if (act === 'reparse') { await api('POST', '/api/inbound-orders/' + id + '/reparse'); await load(true); }
            else if (act === 'reject') { if (confirm('Biztosan elveted?')) { await api('POST', '/api/inbound-orders/' + id + '/reject'); await load(true); } else btn.disabled = false; }
            else if (act === 'approve') { await api('PUT', '/api/inbound-orders/' + id, { extracted: collect(cardEl) }); const r = await api('POST', '/api/inbound-orders/' + id + '/approve', {}); alert('Létrehozva: ' + r.order_id + ' (' + r.status + ')'); await load(true); }
            else if (act === 'approveAssign') { await api('PUT', '/api/inbound-orders/' + id, { extracted: collect(cardEl) }); const r = await api('POST', '/api/inbound-orders/' + id + '/approve', { assign: assignData(cardEl) }); alert('Létrehozva: ' + r.order_id + ' (' + r.status + ')'); await load(true); }
          } catch (e) { alert(e.message); btn.disabled = false; }
        });
      });
    }

    async function load(keepIdx) {
      try {
        // A portál-kérések a külön „Ügyfél kérések" fülre mennek — itt csak e-mail intake.
        const d = await api('GET', '/api/inbound-orders?exclude_source=portal');
        const items = d.items || [];
        pending = items.filter(isPending);   // a szerver received_at DESC szerint adja → legújabb elöl
        totalHandled = items.length - pending.length;
        if (!keepIdx) idx = 0;               // friss betöltésnél a legutolsóval kezdünk
        renderCurrent();
      } catch (e) { $('ioList').innerHTML = '<div class="io-empty">' + esc(e.message) + '</div>'; }
    }

    loadSettings();
    load();
  }
  return { mount };
})();
