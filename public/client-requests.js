// public/client-requests.js — „Ügyfél kérések" fül.
// Az ügyfél-portálról beérkezett fuvar-kérések (inbound_orders, source='portal').
// Ügyfelenként egy LENYITHATÓ szekció; benne a kérések DÁTUM szerint naplózva.
// Minden kérés teljes, szerkeszthető áru-adatlap + opcionális dokumentum:
//   📄 Kiolvasás (AI a dokumentumból) → ✓ Elfogadás (valódi fuvar, Disponibil) / ✕ Elvetés.
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
      .cr-btn{cursor:pointer;border:1px solid var(--glass-border-dark,#2a3744);border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;background:var(--bg-panel-raised,#141c25);color:var(--text-primary,#e9eef5)}
      .cr-btn--green{background:#16a34a;color:#fff;border-color:#16a34a}
      .cr-btn--red{background:#e10b1a;color:#fff;border-color:#e10b1a}
      .cr-btn--ghost{opacity:.92}
      .cr-empty{color:var(--text-muted,#8a97a8);padding:16px 2px}
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
      /* Egy kérés (dátum szerint naplózva) */
      .cr-req{border-top:1px dashed var(--glass-border-dark,#26323e);padding:12px 0}
      .main-content[data-theme="light"] .cr-req{border-color:#e6ecf5}
      .cr-meta{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--text-muted,#8a97a8);margin-bottom:10px}
      .cr-date{font-weight:700;color:var(--text-primary,#e9eef5)}
      .main-content[data-theme="light"] .cr-date{color:#1f2d3d}
      .cr-badge{font-size:11px;font-weight:700;border-radius:999px;padding:3px 9px;background:#e3f7ec;color:#137a40}
      .cr-badge.done{background:#dff3e6;color:#0f7a3a}
      .cr-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 12px}
      .cr-f label{display:block;font-size:11px;color:var(--text-muted,#7c8aa0);margin-bottom:2px}
      .cr-f input,.cr-f select{width:100%;border:1px solid var(--glass-border-dark,#2a3744);border-radius:7px;padding:7px 9px;font-size:13px;background:var(--bg-panel-raised,#141c25);color:var(--text-primary,#e9eef5)}
      .main-content[data-theme="light"] .cr-f input,.main-content[data-theme="light"] .cr-f select{background:#fff;color:#1f2d3d;border-color:#d3dded}
      .cr-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .cr-doc{display:inline-flex;align-items:center;gap:5px}
      .cr-done-row{color:#0f7a3a;font-weight:600;padding:6px 0}
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
    root.innerHTML =
      '<div class="cr-head">' +
        '<h2>📋 Cereri clienți / Ügyfél kérések</h2>' +
        '<div class="cr-spacer"></div>' +
        '<button class="cr-btn cr-btn--ghost" id="crRefresh">↻ Reîmprospătează / Frissítés</button>' +
      '</div>' +
      '<div id="crList"><div class="cr-empty">Se încarcă… / Betöltés…</div></div>';
    const $ = (id) => root.querySelector('#' + id);
    $('crRefresh').addEventListener('click', function () { load(); });

    function reqCard(it) {
      const ex = it.extracted || {};
      const done = (it.status === 'approved' || it.status === 'rejected');
      if (done) {
        return '<div class="cr-req" data-id="' + it.id + '">' +
          '<div class="cr-meta"><span class="cr-date">' + fmtDate(it.received_at || it.created_at) + '</span>' +
            '<span class="cr-badge done">' + (STATUS[it.status] || it.status) + '</span>' +
            (it.created_order_id ? '<span>→ <b>' + esc(it.created_order_id) + '</b></span>' : '') +
          '</div>' +
          '<div class="cr-done-row">' + (it.status === 'approved' ? '✓ Transformat în cursă / Fuvarrá alakítva' : '✕ Respins / Elvetve') + '</div>' +
        '</div>';
      }
      const fieldsHtml = FIELDS.map(function (f) {
        const k = f[0];
        let v = ex[k]; if (v == null && k === 'suly_kg') v = ex.greutate;
        v = (v == null ? '' : v);
        return '<div class="cr-f"><label>' + f[1] + '</label><input data-k="' + k + '" value="' + esc(v) + '"></div>';
      }).join('');
      // Típus (FTL/LTL) külön select (a FIELDS szöveges mezőktől eltér)
      const ltSel = '<div class="cr-f"><label>Tip / Típus (FTL/LTL)</label><select data-k="load_type">' +
        ['', 'FTL', 'LTL'].map(o => '<option' + (o === (ex.load_type || '') ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></div>';
      return '<div class="cr-req" data-id="' + it.id + '">' +
        '<div class="cr-meta">' +
          '<span class="cr-date">' + fmtDate(it.received_at || it.created_at) + '</span>' +
          '<span class="cr-badge">' + (STATUS[it.status] || it.status) + '</span>' +
          (it.pdf_name
            ? '<a class="cr-doc" href="/api/inbound-orders/' + it.id + '/pdf" target="_blank">📎 ' + esc(it.pdf_name) + '</a>' +
              '<button class="cr-btn cr-btn--ghost" data-act="reparse">📄 Citește documentul / Kiolvasás</button>'
            : '') +
        '</div>' +
        '<div class="cr-grid">' + fieldsHtml + ltSel + '</div>' +
        '<div class="cr-acts">' +
          '<button class="cr-btn cr-btn--ghost" data-act="save">💾 Salvează / Mentés</button>' +
          '<button class="cr-btn cr-btn--green" data-act="approve">✓ Acceptă → cursă / Elfogadás</button>' +
          '<button class="cr-btn cr-btn--red" data-act="reject">✕ Respinge / Elvetés</button>' +
        '</div>' +
      '</div>';
    }

    function collect(reqEl) {
      const ex = {};
      reqEl.querySelectorAll('[data-k]').forEach(function (i) { ex[i.getAttribute('data-k')] = i.value.trim() || null; });
      if (ex.suly_kg != null) ex.greutate = ex.suly_kg;   // az approve mindkét kulcsot nézi
      return ex;
    }

    function clientSection(group) {
      const reqs = group.items.map(reqCard).join('');
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
      // Akkordion nyit/zár
      root.querySelectorAll('.cr-chead').forEach(function (h) {
        h.addEventListener('click', function () { h.parentElement.classList.toggle('open'); });
      });
      // Kérés-műveletek
      root.querySelectorAll('.cr-req').forEach(function (reqEl) {
        reqEl.querySelectorAll('[data-act]').forEach(function (btn) {
          btn.addEventListener('click', async function (e) {
            e.stopPropagation();
            const id = reqEl.dataset.id, act = btn.dataset.act;
            try {
              btn.disabled = true;
              if (act === 'save') { await api('PUT', '/api/inbound-orders/' + id, { extracted: collect(reqEl) }); toast('💾 Salvat / Mentve', 'ok'); await load(); }
              else if (act === 'reparse') { await api('POST', '/api/inbound-orders/' + id + '/reparse'); toast('📄 Citit / Kiolvasva', 'ok'); await load(); }
              else if (act === 'reject') { if (confirm('Respingeți cererea? / Elveted a kérést?')) { await api('POST', '/api/inbound-orders/' + id + '/reject'); await load(); } else btn.disabled = false; }
              else if (act === 'approve') {
                await api('PUT', '/api/inbound-orders/' + id, { extracted: collect(reqEl) });
                const r = await api('POST', '/api/inbound-orders/' + id + '/approve', {});
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
        if (!items.length) { $('crList').innerHTML = '<div class="cr-empty">Nu există cereri de la clienți. / Nincs ügyfél-kérés.</div>'; return; }
        // Csoportosítás ügyfél szerint (source_email), a kérések dátum szerint (a szerver received_at DESC-et ad)
        const map = {};
        items.forEach(function (it) {
          const key = (it.source_email || '—').toLowerCase();
          if (!map[key]) map[key] = { email: it.source_email || '', name: (it.extracted && it.extracted.client) || '', items: [] };
          map[key].items.push(it);
          if (!map[key].name && it.extracted && it.extracted.client) map[key].name = it.extracted.client;
        });
        // Rendezés: a feldolgozatlan kérést tartalmazó ügyfelek elöl, azon belül a legutóbbi kérés szerint
        const groups = Object.keys(map).map(k => map[k]);
        const pend = g => g.items.filter(it => it.status !== 'approved' && it.status !== 'rejected').length;
        const latest = g => Math.max.apply(null, g.items.map(it => new Date(it.received_at || it.created_at || 0).getTime()));
        groups.sort((a, b) => (pend(b) - pend(a)) || (latest(b) - latest(a)));
        $('crList').innerHTML = groups.map(clientSection).join('');
        bind();
      } catch (e) { $('crList').innerHTML = '<div class="cr-empty">' + esc(e.message) + '</div>'; }
    }

    load();
  }
  return { mount };
})();
