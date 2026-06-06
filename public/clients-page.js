// public/clients-page.js  (a clients-page.html-ből rendezve render-függvénnyé)
// Használat:  ClientsPage.mount('konténerElemId')   — a fül/oldal megnyitásakor hívd.
window.ClientsPage = (function () {
  const STYLE = "\n  .cl-wrap{max-width:900px}\n  .cl-top{display:flex;gap:8px;margin-bottom:12px}\n  .cl-search{flex:1;font-size:16px;padding:9px 11px;border:1px solid #d0d5dd;border-radius:8px}\n  .cl-table{width:100%;border-collapse:collapse;font-size:14px;background:#fff;border:1px solid #e2e6ee;border-radius:10px;overflow:hidden}\n  .cl-table th,.cl-table td{text-align:left;padding:9px 10px;border-bottom:1px solid #eef1f6}\n  .cl-table th{font-size:12px;color:#6b7280}\n  .cl-empty{color:#9aa3b2;text-align:center;padding:14px}\n  .cl-pill{font-size:11px;padding:2px 7px;border-radius:999px}\n  .cl-pill--ok{background:#e7f6ec;color:#1a7f37}.cl-pill--no{background:#eef1f6;color:#5b6577}\n  .cl-btn{font-size:14px;padding:9px 14px;border-radius:8px;border:1px solid transparent;cursor:pointer;touch-action:manipulation}\n  .cl-btn--primary{background:#2563eb;color:#fff}.cl-btn--ghost{background:#fff;border:1px solid #d0d5dd;color:#374151}\n  .cl-btn--sm{padding:5px 10px;font-size:13px}\n  .cl-ov{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}\n  .cl-box{background:#fff;border-radius:14px;width:100%;max-width:640px;max-height:90vh;overflow:auto}\n  .cl-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #eef1f6;position:sticky;top:0;background:#fff}\n  .cl-h{font-weight:600}.cl-x{border:none;background:none;font-size:22px;cursor:pointer;color:#6b7280}\n  .cl-b{padding:14px 16px}\n  .cl-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}\n  .cl-full{grid-column:1 / -1}\n  .cl-l{display:flex;flex-direction:column;font-size:12px;color:#6b7280;gap:5px}\n  .cl-in{font-size:16px;padding:8px 10px;border:1px solid #d0d5dd;border-radius:8px;color:#111}\n  .cl-cui{display:flex;gap:6px}.cl-cui .cl-in{flex:1}\n  .cl-msg{font-size:13px;min-height:18px;margin-bottom:8px}.cl-msg--ok{color:#1a7f37}.cl-msg--err{color:#c0341a}\n  .cl-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}\n  @media(max-width:560px){.cl-grid{grid-template-columns:1fr}}\n";
  const MARKUP = "<!-- \"Ügyfelek\" menüoldal: felül \"Ügyfél hozzáadása\", alatta kereshető lista. Önálló, hivatkozással betölthető. -->\n\n<div class=\"cl-wrap\" id=\"clWrap\">\n  <div class=\"cl-top\">\n    <input id=\"clSearch\" class=\"cl-search\" placeholder=\"Keresés név vagy CUI szerint…\">\n    <button id=\"clAdd\" class=\"cl-btn cl-btn--primary\">+ Ügyfél hozzáadása</button>\n  </div>\n  <table class=\"cl-table\"><thead><tr><th>Név</th><th>CUI</th><th>Helység</th><th>ÁFA</th><th></th></tr></thead>\n    <tbody id=\"clRows\"><tr><td colspan=\"5\" class=\"cl-empty\">Betöltés…</td></tr></tbody>\n  </table>\n</div>\n\n<!-- Hozzáadás/szerkesztés modal -->\n<div class=\"cl-ov\" id=\"clOv\" style=\"display:none\">\n  <div class=\"cl-box\">\n    <div class=\"cl-head\"><div class=\"cl-h\" id=\"clFormTitle\">Ügyfél hozzáadása</div><button class=\"cl-x\" id=\"clClose\">×</button></div>\n    <div class=\"cl-b\">\n      <div class=\"cl-msg\" id=\"clMsg\"></div>\n      <div class=\"cl-grid\">\n        <label class=\"cl-l cl-full\">Név (kötelező)<input id=\"f_denumire\" class=\"cl-in\"></label>\n        <label class=\"cl-l\">Típus\n          <select id=\"f_tip\" class=\"cl-in\"><option value=\"PJ\">Cég (PJ)</option><option value=\"PF\">Magánszemély (PF)</option></select>\n        </label>\n        <label class=\"cl-l\">CUI / CIF\n          <span class=\"cl-cui\"><input id=\"f_cui_cif\" class=\"cl-in\"><button id=\"clAnaf\" class=\"cl-btn cl-btn--ghost\" type=\"button\">ANAF</button></span>\n        </label>\n        <label class=\"cl-l\">Reg. Com.<input id=\"f_reg_com\" class=\"cl-in\"></label>\n        <label class=\"cl-l\">Ország<input id=\"f_tara\" class=\"cl-in\" value=\"RO\"></label>\n        <label class=\"cl-l\">Megye<input id=\"f_judet\" class=\"cl-in\"></label>\n        <label class=\"cl-l\">Helység<input id=\"f_localitate\" class=\"cl-in\"></label>\n        <label class=\"cl-l cl-full\">Cím<input id=\"f_adresa\" class=\"cl-in\"></label>\n        <label class=\"cl-l\">E-mail<input id=\"f_email\" class=\"cl-in\"></label>\n        <label class=\"cl-l\">Telefon<input id=\"f_telefon\" class=\"cl-in\"></label>\n        <label class=\"cl-l\">IBAN<input id=\"f_iban\" class=\"cl-in\"></label>\n        <label class=\"cl-l\">Bank<input id=\"f_banca\" class=\"cl-in\"></label>\n        <label class=\"cl-l\">Alap ÁFA %<input id=\"f_default_tva\" class=\"cl-in\" type=\"number\"></label>\n        <label class=\"cl-l\">Pénznem<input id=\"f_valuta\" class=\"cl-in\" value=\"RON\"></label>\n        <label class=\"cl-l cl-full\">Megjegyzés<input id=\"f_nota\" class=\"cl-in\"></label>\n      </div>\n      <div class=\"cl-foot\"><button class=\"cl-btn cl-btn--ghost\" id=\"clCancel\">Mégse</button><button class=\"cl-btn cl-btn--primary\" id=\"clSave\">Mentés</button></div>\n    </div>\n  </div>\n</div>";
  function ensureStyle() {
    if (document.getElementById("clients-page-style")) return;
    const s = document.createElement('style'); s.id = "clients-page-style"; s.textContent = STYLE; document.head.appendChild(s);
  }
  function mount(target) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) { console.warn("clients-page.js: nincs konténer"); return; }
    ensureStyle();
    el.innerHTML = MARKUP;
    run(el);
  }
  function run(root) {
    
    (function () {
      const $ = (id) => document.getElementById(id);
      const F = ['denumire','tip','cui_cif','reg_com','tara','judet','localitate','adresa','email','telefon','iban','banca','default_tva','valuta','nota'];
      let editId = null;
      const setMsg = (t, k) => { $('clMsg').textContent = t || ''; $('clMsg').className = 'cl-msg' + (k ? ' cl-msg--' + k : ''); };
    
      async function api(method, url, body) {
        const res = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        const d = await res.json().catch(() => ({})); if (!res.ok) throw new Error(d.error || ('Hiba ' + res.status)); return d;
      }
      async function loadList() {
        const q = $('clSearch').value.trim();
        try {
          const d = await api('GET', '/api/clients' + (q ? '?q=' + encodeURIComponent(q) : ''));
          const rows = $('clRows');
          if (!d.clients.length) { rows.innerHTML = '<tr><td colspan="5" class="cl-empty">Nincs ügyfél.</td></tr>'; return; }
          rows.innerHTML = '';
          d.clients.forEach(c => {
            const tr = document.createElement('tr');
            const vat = c.anaf_status ? (c.anaf_status === 'activ' ? '<span class="cl-pill cl-pill--ok">aktív</span>' : '<span class="cl-pill cl-pill--no">' + c.anaf_status + '</span>') : '';
            tr.innerHTML = '<td>' + esc(c.denumire) + '</td><td>' + esc(c.cui_cif || '') + '</td><td>' + esc(c.localitate || '') + '</td><td>' + vat + '</td>' +
              '<td style="text-align:right"><button class="cl-btn cl-btn--ghost cl-btn--sm">Szerkeszt</button></td>';
            tr.querySelector('button').addEventListener('click', () => openForm(c));
            rows.appendChild(tr);
          });
        } catch (e) { $('clRows').innerHTML = '<tr><td colspan="5" class="cl-empty">' + e.message + '</td></tr>'; }
      }
      function esc(s){return String(s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}
    
      function openForm(c) {
        editId = c ? c.id : null;
        $('clFormTitle').textContent = c ? 'Ügyfél szerkesztése' : 'Ügyfél hozzáadása';
        F.forEach(f => $('f_' + f).value = c ? (c[f] ?? '') : (f === 'tara' ? 'RO' : f === 'valuta' ? 'RON' : ''));
        setMsg(''); $('clOv').style.display = 'flex';
      }
      function closeForm() { $('clOv').style.display = 'none'; }
    
      $('clAdd').addEventListener('click', () => openForm(null));
      $('clClose').addEventListener('click', closeForm);
      $('clCancel').addEventListener('click', closeForm);
      $('clSearch').addEventListener('input', () => { clearTimeout(window.__clT); window.__clT = setTimeout(loadList, 250); });
    
      $('clAnaf').addEventListener('click', async () => {
        const cui = $('f_cui_cif').value.trim();
        if (!cui) return setMsg('Írd be a CUI-t a lekérdezéshez.', 'err');
        setMsg('ANAF lekérdezés…');
        try {
          const r = await api('GET', '/api/clients/anaf?cui=' + encodeURIComponent(cui));
          if (!r.found) return setMsg(r.error || 'Az ANAF nem talált ilyen CUI-t.' + (r.validChecksum === false ? ' (a CUI ellenőrzőszáma sem stimmel)' : ''), 'err');
          if (r.name) $('f_denumire').value = r.name;
          if (r.address) $('f_adresa').value = r.address;
          if (r.regCom) $('f_reg_com').value = r.regCom;
          if (r.phone && !$('f_telefon').value) $('f_telefon').value = r.phone;
          const flags = [r.vatPayer ? 'ÁFA-alany' : 'NEM ÁFA-alany', r.active ? 'aktív' : 'INAKTÍV/radiált — kockázat!'];
          setMsg('Kitöltve az ANAF-ból · ' + flags.join(' · '), r.active ? 'ok' : 'err');
        } catch (e) { setMsg(e.message, 'err'); }
      });
    
      $('clSave').addEventListener('click', async () => {
        const body = {}; F.forEach(f => body[f] = $('f_' + f).value.trim());
        if (!body.denumire) return setMsg('A név kötelező.', 'err');
        setMsg('Mentés…');
        try {
          if (editId) await api('PUT', '/api/clients/' + editId, body);
          else await api('POST', '/api/clients', body);
          closeForm(); loadList();
        } catch (e) { setMsg(e.message, 'err'); }
      });
    
      loadList();
    })();
    
  }
  return { mount };
})();
