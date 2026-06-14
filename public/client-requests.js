// public/client-requests.js — „Ügyfél kérések" fül.
// Az ügyfél-portálról beérkezett fuvar-kérések (inbound_orders, source='portal').
// Ügyfelenként egy LENYITHATÓ szekció; benne a kérések DÁTUM szerint naplózva,
// alapból ÖSSZECSUKOTT sorként (sorszám + van-e csatolt fájl). Kattintásra
// lenyílik a teljes, szerkeszthető áru-adatlap:
//   📄 Kiolvasás (AI a dokumentumból, AI-kapcsolóval) → automatikus mező-kitöltés,
//   ✓ Elfogadás (valódi fuvar, Disponibil) / ✕ Elvetés.
// A szerver-végpontokat újrahasznosítja (/api/inbound-orders…), NEM duplikál logikát.
window.ClientRequests = (function () {
  // Szerkeszthető mezők (kulcs = inbound `extracted` + az approve által olvasott kulcsok).
  const FIELDS = [
    ['ref', 'Referință / Referencia'],
    ['loc_incarcare', 'Adresă încărcare / Felrakó'],
    ['loc_descarcare', 'Adresă descărcare / Lerakó'],
    ['data_incarcare', 'Dată încărcare / Felrakás'],
    ['data_descarcare', 'Dată descărcare / Lerakás'],
    ['suly_kg', 'Greutate kg / Súly'],
    ['hossz_cm', 'Lungime cm / Hossz'],
    ['szel_cm', 'Lățime cm / Szél.'],
    ['mag_cm', 'Înălțime cm / Mag.'],
    ['observatii', 'Observații / Megjegyzés'],
  ];
  const STATUS = { new: 'Nou / Új', parsed: 'Procesat / Feldolgozva', reviewed: 'În așteptare / Várakozik',
    approved: 'Aprobat / Jóváhagyva', rejected: 'Respins / Elvetve' };

  function ensureStyle() {
    if (document.getElementById('cr-style')) return;
    const s = document.createElement('style'); s.id = 'cr-style';
    s.textContent = `
      .cr-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
      .cr-head h2{margin:0;font-size:20px}
      .cr-spacer{flex:1}
      .cr-toggle{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;cursor:pointer}
      .cr-btn{cursor:pointer;border:1px solid var(--glass-border-dark,#2a3744);border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;background:var(--bg-panel-raised,#141c25);color:var(--text-primary,#e9eef5)}
      .cr-btn--green{background:#16a34a;color:#fff;border-color:#16a34a}
      .cr-btn--red{background:#ef4444;color:#fff;border-color:#ef4444}
      .cr-btn--ghost{opacity:.92}
      .cr-empty{color:var(--text-muted,#8a97a8);padding:16px 2px}
      .cr-warn{background:#fdf0d8;color:#8a5a00;border:1px solid #f0d9a8;border-radius:8px;padding:8px 10px;font-size:12px;margin-bottom:12px}
      .main-content[data-theme="light"] .cr-btn{background:#fff;color:#1f2d3d;border-color:#cdd6e4}
      /* Ügyfél-akkordion */
      .cr-client{border:1px solid var(--glass-border-dark,#26323e);border-radius:12px;margin-bottom:12px;overflow:hidden;background:var(--bg-panel,#0c1218)}
      .main-content[data-theme="light"] .cr-client{background:#fff;border-color:#e3e9f2}
      .cr-chead{display:flex;align-items:center;gap:10px;cursor:pointer;padding:12px 14px;user-select:none}
      .cr-chead:hover{background:rgba(255,255,255,.03)}
      .main-content[data-theme="light"] .cr-chead:hover{background:#f4f7fb}
      .cr-cname{font-weight:700;font-size:15px}
      .cr-cmail{font-size:12px;color:var(--text-muted,#8a97a8)}
      .cr-ccount{margin-left:auto;background:var(--status-warn,#f59e0b);color:#1a1205;font-weight:800;font-size:12px;border-radius:999px;padding:2px 9px}
      .cr-arrow{transition:transform .15s;font-size:13px;color:var(--text-muted,#8a97a8)}
      .cr-client.open .cr-arrow{transform:rotate(90deg)}
      .cr-cbody{display:none;padding:0 14px 12px}
      .cr-client.open .cr-cbody{display:block}
      /* Egy kérés (összecsukott sor → kattintásra lenyíló adatlap) */
      .cr-req{border-top:1px dashed var(--glass-border-dark,#26323e)}
      .main-content[data-theme="light"] .cr-req{border-color:#e6ecf5}
      .cr-rhead{display:flex;align-items:center;gap:10px;padding:10px 2px;cursor:pointer;user-select:none;font-size:13px}
      .cr-req.done .cr-rhead{cursor:default}
      .cr-rarrow{font-size:12px;color:var(--text-muted,#8a97a8);transition:transform .15s;width:12px}
      .cr-req.open .cr-rarrow{transform:rotate(90deg)}
      .cr-seq{font-weight:800;color:#6366f1;min-width:42px}
      .cr-file{font-size:12px}
      .cr-file.has{color:var(--status-info,#3b82f6);font-weight:700}
      .cr-file.no{color:var(--text-muted,#8a97a8)}
      .cr-date{color:var(--text-muted,#8a97a8)}
      .cr-badge{font-size:11px;font-weight:700;border-radius:999px;padding:3px 9px;background:#e3f7ec;color:#137a40;margin-left:auto}
      .cr-badge.done{background:#dff3e6;color:#0f7a3a}
      .cr-rbody{display:none;padding:2px 0 14px}
      .cr-req.open .cr-rbody{display:block}
      .cr-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 12px}
      .cr-f label{display:block;font-size:11px;color:var(--text-muted,#7c8aa0);margin-bottom:2px}
      .cr-f input,.cr-f select{width:100%;border:1px solid var(--glass-border-dark,#2a3744);border-radius:7px;padding:7px 9px;font-size:13px;background:var(--bg-panel-raised,#141c25);color:var(--text-primary,#e9eef5)}
      .main-content[data-theme="light"] .cr-f input,.main-content[data-theme="light"] .cr-f select{background:#fff;color:#1f2d3d;border-color:#d3dded}
      .cr-docrow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
      .cr-doc{display:inline-flex;align-items:center;gap:5px}
      .cr-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .cr-done-row{color:#0f7a3a;font-weight:600;padding:2px 0 8px}
      @media(max-width:640px){.cr-grid{grid-template-columns:1fr}}`;
    document.head.appendChild(s);
  }
  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || ('Eroare (' + r.status + ')'));
    return d;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  function fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleString('ro-RO', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return String(d).slice(0, 16).replace('T', ' '); }
  }

  function mount(target) {
    ensureStyle();
    const root = typeof target === 'string' ? document.getElementById(target) : target;
    if (!root) return;
    const expanded = new Set();   // lenyitott kérések id-jei (újratöltéskor megőrizve)
    const itemsById = {};         // id → eredeti inbound elem (a rejtett extracted-kulcsok megőrzéséhez)
    let aiEnabled = false;

    root.innerHTML =
      '<div class="cr-head">' +
        '<h2>📋 Cereri clienți / Ügyfél kérések</h2>' +
        '<label class="cr-toggle" title="Citire automată cu AI / Automatikus AI-kiolvasás">' +
          '<input type="checkbox" id="crAi"> 🤖 AI</label>' +
        '<div class="cr-spacer"></div>' +
        '<button class="cr-btn cr-btn--ghost" id="crRefresh">↻ Reîmprospătează / Frissítés</button>' +
      '</div>' +
      '<div id="crInfo"></div>' +
      '<div id="crList"><div class="cr-empty">Se încarcă… / Betöltés…</div></div>';
    const $ = (id) => root.querySelector('#' + id);
    $('crRefresh').addEventListener('click', function () { load(); });

    // ── AI ki/be (közös cég-szintű beállítás a Megrendelésekkel) ──
    async function loadSettings() {
      try {
        const s = await api('GET', '/api/inbound-orders/settings');
        aiEnabled = !!s.ai_enabled;
        $('crAi').checked = aiEnabled;
      } catch (e) {}
    }
    $('crAi').addEventListener('change', async function () {
      const on = $('crAi').checked;
      if (on && !confirm('Avertisment GDPR: cu AI activat, textul/documentul cererii este trimis spre procesare unui furnizor AI extern (Google Gemini). / Adatkezelési figyelmeztetés: bekapcsolva a kérés szövege/dokumentuma egy külső AI-szolgáltatóhoz (Google Gemini) kerül. Bekapcsolod?')) {
        $('crAi').checked = false; return;
      }
      try { await api('POST', '/api/inbound-orders/settings', { ai_enabled: on }); aiEnabled = on; }
      catch (e) { toast(e.message, 'err'); $('crAi').checked = !on; }
    });

    function bodyHtml(it) {
      const ex = it.extracted || {};
      const done = (it.status === 'approved' || it.status === 'rejected');
      if (done) {
        return '<div class="cr-done-row">' +
          (it.status === 'approved' ? '✓ Transformat în cursă / Fuvarrá alakítva' : '✕ Respins / Elvetve') +
          (it.created_order_id ? ' → <b>' + esc(it.created_order_id) + '</b>' : '') + '</div>';
      }
      const fieldsHtml = FIELDS.map(function (f) {
        const k = f[0];
        let v = ex[k]; if (v == null && k === 'suly_kg') v = ex.greutate;
        v = (v == null ? '' : v);
        return '<div class="cr-f"><label>' + f[1] + '</label><input data-k="' + k + '" value="' + esc(v) + '"></div>';
      }).join('');
      const ltSel = '<div class="cr-f"><label>Tip / Típus (FTL/LTL)</label><select data-k="load_type">' +
        ['', 'FTL', 'LTL'].map(o => '<option' + (o === (ex.load_type || '') ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></div>';
      const docRow = it.pdf_name
        ? '<div class="cr-docrow">' +
            '<a class="cr-doc" href="/api/inbound-orders/' + it.id + '/pdf" target="_blank">📎 ' + esc(it.pdf_name) + '</a>' +
            '<button class="cr-btn cr-btn--ghost" data-act="reparse">📄 Citește cu AI / Kiolvasás (AI)</button>' +
          '</div>'
        : '';
      return docRow +
        '<div class="cr-grid">' + fieldsHtml + ltSel + '</div>' +
        '<div class="cr-acts">' +
          '<button class="cr-btn cr-btn--ghost" data-act="save">💾 Salvează / Mentés</button>' +
          '<button class="cr-btn cr-btn--green" data-act="approve">✓ Acceptă → cursă / Elfogadás</button>' +
          '<button class="cr-btn cr-btn--red" data-act="reject">✕ Respinge / Elvetés</button>' +
        '</div>';
    }

    // Egy kérés-sor: alapból összecsukva (sorszám + fájl-jelző + dátum + státusz)
    function reqRow(it, seq) {
      const done = (it.status === 'approved' || it.status === 'rejected');
      const open = expanded.has(String(it.id));
      const hasFile = !!it.pdf_name;
      return '<div class="cr-req' + (done ? ' done' : '') + (open ? ' open' : '') + '" data-id="' + it.id + '">' +
        '<div class="cr-rhead">' +
          (done ? '<span class="cr-rarrow" style="visibility:hidden">▶</span>' : '<span class="cr-rarrow">▶</span>') +
          '<span class="cr-seq">#' + seq + '</span>' +
          '<span class="cr-file ' + (hasFile ? 'has' : 'no') + '">' + (hasFile ? '📎 cu document / van fájl' : '— fără document / nincs fájl') + '</span>' +
          '<span class="cr-date">' + fmtDate(it.received_at || it.created_at) + '</span>' +
          '<span class="cr-badge' + (done ? ' done' : '') + '">' + (STATUS[it.status] || it.status) + '</span>' +
        '</div>' +
        '<div class="cr-rbody">' + bodyHtml(it) + '</div>' +
      '</div>';
    }

    function collect(reqEl) {
      // Az eredeti extracted-ből indulunk, hogy a NEM látható kulcsok (pl. `client`
      // = az ügyfél neve) ne vesszenek el mentéskor/elfogadáskor.
      const orig = (itemsById[String(reqEl.dataset.id)] || {}).extracted || {};
      const ex = Object.assign({}, orig);
      reqEl.querySelectorAll('[data-k]').forEach(function (i) { ex[i.getAttribute('data-k')] = i.value.trim() || null; });
      if (ex.suly_kg != null) ex.greutate = ex.suly_kg;   // az approve mindkét kulcsot nézi
      return ex;
    }

    function clientSection(group, seqMap) {
      const reqs = group.items.map(it => reqRow(it, seqMap[String(it.id)])).join('');
      const pendingN = group.items.filter(it => it.status !== 'approved' && it.status !== 'rejected').length;
      return '<div class="cr-client' + (pendingN ? ' open' : '') + '">' +
        '<div class="cr-chead">' +
          '<span class="cr-arrow">▶</span>' +
          '<div><div class="cr-cname">' + esc(group.name || group.email || '—') + '</div>' +
            '<div class="cr-cmail">' + esc(group.email || '') + '</div></div>' +
          (pendingN ? '<span class="cr-ccount">' + pendingN + ' noi / új</span>' : '<span class="cr-cmail" style="margin-left:auto">' + group.items.length + ' total</span>') +
        '</div>' +
        '<div class="cr-cbody">' + reqs + '</div>' +
      '</div>';
    }

    function bind() {
      // Ügyfél-akkordion nyit/zár
      root.querySelectorAll('.cr-chead').forEach(function (h) {
        h.addEventListener('click', function () { h.parentElement.classList.toggle('open'); });
      });
      // Kérés-sor nyit/zár (a feldolgozott „done" sor nem nyitható)
      root.querySelectorAll('.cr-req').forEach(function (reqEl) {
        if (reqEl.classList.contains('done')) return;
        const head = reqEl.querySelector('.cr-rhead');
        head.addEventListener('click', function () {
          const id = String(reqEl.dataset.id);
          if (reqEl.classList.toggle('open')) expanded.add(id); else expanded.delete(id);
        });
        // Műveleti gombok (a body-ban; ne buborékoljanak a sor-fejlécre)
        reqEl.querySelectorAll('[data-act]').forEach(function (btn) {
          btn.addEventListener('click', async function (e) {
            e.stopPropagation();
            const id = String(reqEl.dataset.id), act = btn.dataset.act;
            try {
              btn.disabled = true;
              expanded.add(id);   // a művelet után maradjon nyitva
              if (act === 'save') { await api('PUT', '/api/inbound-orders/' + id, { extracted: collect(reqEl) }); toast('💾 Salvat / Mentve', 'ok'); await load(); }
              else if (act === 'reparse') { await api('POST', '/api/inbound-orders/' + id + '/reparse'); toast(aiEnabled ? '🤖 Citit cu AI / Kiolvasva (AI)' : '📄 Citit / Kiolvasva', 'ok'); await load(); }
              else if (act === 'reject') { if (confirm('Respingeți cererea? / Elveted a kérést?')) { expanded.delete(id); await api('POST', '/api/inbound-orders/' + id + '/reject'); await load(); } else btn.disabled = false; }
              else if (act === 'approve') {
                await api('PUT', '/api/inbound-orders/' + id, { extracted: collect(reqEl) });
                const r = await api('POST', '/api/inbound-orders/' + id + '/approve', {});
                expanded.delete(id);
                toast('✓ Cursă creată / Fuvar létrehozva: ' + r.order_id, 'ok');
                await load();
                if (typeof refreshInboundCount === 'function') refreshInboundCount();
              }
            } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
          });
        });
      });
    }

    async function load() {
      try {
        const d = await api('GET', '/api/inbound-orders?source=portal');
        const items = d.items || [];
        Object.keys(itemsById).forEach(k => delete itemsById[k]);
        items.forEach(function (it) { itemsById[String(it.id)] = it; });
        if (!items.length) { $('crInfo').innerHTML = ''; $('crList').innerHTML = '<div class="cr-empty">Nu există cereri de la clienți. / Nincs ügyfél-kérés.</div>'; return; }
        // Sorszám: beérkezés sorrendjében (legrégebbi = #1), stabil az egyes kérésekre
        const byDateAsc = items.slice().sort((a, b) =>
          new Date(a.received_at || a.created_at || 0) - new Date(b.received_at || b.created_at || 0));
        const seqMap = {}; byDateAsc.forEach((it, i) => { seqMap[String(it.id)] = i + 1; });
        // Csoportosítás ügyfél szerint (source_email); a kérések dátum szerint (a szerver received_at DESC-et ad)
        const map = {};
        items.forEach(function (it) {
          const key = (it.source_email || '—').toLowerCase();
          if (!map[key]) map[key] = { email: it.source_email || '', name: (it.extracted && it.extracted.client) || '', items: [] };
          map[key].items.push(it);
          if (!map[key].name && it.extracted && it.extracted.client) map[key].name = it.extracted.client;
        });
        const groups = Object.keys(map).map(k => map[k]);
        const pend = g => g.items.filter(it => it.status !== 'approved' && it.status !== 'rejected').length;
        const latest = g => Math.max.apply(null, g.items.map(it => new Date(it.received_at || it.created_at || 0).getTime()));
        groups.sort((a, b) => (pend(b) - pend(a)) || (latest(b) - latest(a)));
        $('crInfo').innerHTML = '';
        $('crList').innerHTML = groups.map(g => clientSection(g, seqMap)).join('');
        bind();
      } catch (e) { $('crList').innerHTML = '<div class="cr-empty">' + esc(e.message) + '</div>'; }
    }

    loadSettings();
    load();
  }
  return { mount };
})();
