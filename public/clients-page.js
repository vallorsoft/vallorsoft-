// public/clients-page.js  (a clients-page.html-ből rendezve render-függvénnyé)
// Használat:  ClientsPage.mount('konténerElemId')   — a fül/oldal megnyitásakor hívd.
(window.registerI18n||function(d){(window.__i18nQueue=window.__i18nQueue||[]).push(d);})({
  'cl.searchPlaceholder': { hu: 'Keresés név vagy CUI szerint…', ro: 'Căutare după nume sau CUI…' },
  'cl.addClient': { hu: '+ Ügyfél hozzáadása', ro: '+ Adaugă client' },
  'cl.thName': { hu: 'Név', ro: 'Nume' },
  'cl.thCui': { hu: 'CUI', ro: 'CUI' },
  'cl.thCity': { hu: 'Helység', ro: 'Localitate' },
  'cl.thVat': { hu: 'ÁFA', ro: 'TVA' },
  'cl.loading': { hu: 'Betöltés…', ro: 'Se încarcă…' },
  'cl.formTitleAdd': { hu: 'Ügyfél hozzáadása', ro: 'Adaugă client' },
  'cl.formTitleEdit': { hu: 'Ügyfél szerkesztése', ro: 'Editare client' },
  'cl.lblName': { hu: 'Név (kötelező)', ro: 'Nume (obligatoriu)' },
  'cl.lblType': { hu: 'Típus', ro: 'Tip' },
  'cl.optPj': { hu: 'Cég (PJ)', ro: 'Persoană juridică (PJ)' },
  'cl.optPf': { hu: 'Magánszemély (PF)', ro: 'Persoană fizică (PF)' },
  'cl.lblRegCom': { hu: 'Reg. Com.', ro: 'Reg. Com.' },
  'cl.lblCountry': { hu: 'Ország', ro: 'Țară' },
  'cl.lblCounty': { hu: 'Megye', ro: 'Județ' },
  'cl.lblCity': { hu: 'Helység', ro: 'Localitate' },
  'cl.lblAddress': { hu: 'Cím', ro: 'Adresă' },
  'cl.lblEmail': { hu: 'E-mail', ro: 'E-mail' },
  'cl.lblPhone': { hu: 'Telefon', ro: 'Telefon' },
  'cl.lblBank': { hu: 'Bank', ro: 'Bancă' },
  'cl.lblDefaultTva': { hu: 'Alap ÁFA %', ro: 'TVA implicit %' },
  'cl.lblCurrency': { hu: 'Pénznem', ro: 'Monedă' },
  'cl.lblPaymentTerm': { hu: 'Fizetési határidő (nap)', ro: 'Termen de plată (zile)' },
  'cl.lblNote': { hu: 'Megjegyzés', ro: 'Observație' },
  'cl.cancel': { hu: 'Mégse', ro: 'Anulează' },
  'cl.save': { hu: 'Mentés', ro: 'Salvează' },
  'cl.edit': { hu: 'Szerkeszt', ro: 'Editează' },
  'cl.noClients': { hu: 'Nincs ügyfél.', ro: 'Niciun client.' },
  'cl.vatActive': { hu: 'aktív', ro: 'activ' },
  'cl.errPrefix': { hu: 'Hiba ', ro: 'Eroare ' },
  'cl.enterCui': { hu: 'Írd be a CUI-t a lekérdezéshez.', ro: 'Introdu CUI-ul pentru interogare.' },
  'cl.anafQuery': { hu: 'ANAF lekérdezés…', ro: 'Interogare ANAF…' },
  'cl.anafNotFound': { hu: 'Az ANAF nem talált ilyen CUI-t.', ro: 'ANAF nu a găsit acest CUI.' },
  'cl.anafBadChecksum': { hu: ' (a CUI ellenőrzőszáma sem stimmel)', ro: ' (cifra de control a CUI-ului este invalidă)' },
  'cl.vatPayer': { hu: 'ÁFA-alany', ro: 'Plătitor de TVA' },
  'cl.notVatPayer': { hu: 'NEM ÁFA-alany', ro: 'Neplătitor de TVA' },
  'cl.anafActive': { hu: 'aktív', ro: 'activ' },
  'cl.anafInactive': { hu: 'INAKTÍV/radiált — kockázat!', ro: 'INACTIV/radiat — risc!' },
  'cl.filledFromAnaf': { hu: 'Kitöltve az ANAF-ból · ', ro: 'Completat din ANAF · ' },
  'cl.nameRequired': { hu: 'A név kötelező.', ro: 'Numele este obligatoriu.' },
  'cl.saving': { hu: 'Mentés…', ro: 'Se salvează…' },
});
function T(k,v){return (typeof window.t==='function')?window.t(k,v):k;}
window.ClientsPage = (function () {
  const STYLE = "\n  .cl-wrap{max-width:900px}\n  .cl-top{display:flex;gap:8px;margin-bottom:12px}\n  .cl-search{flex:1;font-size:16px;padding:9px 11px;border:1px solid #d0d5dd;border-radius:8px}\n  .cl-table{width:100%;border-collapse:collapse;font-size:14px;background:#fff;border:1px solid #e2e6ee;border-radius:10px;overflow:hidden}\n  .cl-table th,.cl-table td{text-align:left;padding:9px 10px;border-bottom:1px solid #eef1f6}\n  .cl-table th{font-size:12px;color:#6b7280}\n  .cl-empty{color:#9aa3b2;text-align:center;padding:14px}\n  .cl-pill{font-size:11px;padding:2px 7px;border-radius:999px}\n  .cl-pill--ok{background:#e7f6ec;color:#1a7f37}.cl-pill--no{background:#eef1f6;color:#5b6577}\n  .cl-btn{font-size:14px;padding:9px 14px;border-radius:8px;border:1px solid transparent;cursor:pointer;touch-action:manipulation}\n  .cl-btn--primary{background:#2563eb;color:#fff}.cl-btn--ghost{background:#fff;border:1px solid #d0d5dd;color:#374151}\n  .cl-btn--sm{padding:5px 10px;font-size:13px}\n  .cl-ov{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}\n  .cl-box{background:#fff;border-radius:14px;width:100%;max-width:640px;max-height:90vh;overflow:auto}\n  .cl-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #eef1f6;position:sticky;top:0;background:#fff}\n  .cl-h{font-weight:600}.cl-x{border:none;background:none;font-size:22px;cursor:pointer;color:#6b7280}\n  .cl-b{padding:14px 16px}\n  .cl-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}\n  .cl-full{grid-column:1 / -1}\n  .cl-l{display:flex;flex-direction:column;font-size:12px;color:#6b7280;gap:5px}\n  .cl-in{font-size:16px;padding:8px 10px;border:1px solid #d0d5dd;border-radius:8px;color:#111}\n  .cl-cui{display:flex;gap:6px}.cl-cui .cl-in{flex:1}\n  .cl-msg{font-size:13px;min-height:18px;margin-bottom:8px}.cl-msg--ok{color:#1a7f37}.cl-msg--err{color:#c0341a}\n  .cl-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}\n  @media(max-width:560px){.cl-grid{grid-template-columns:1fr}}\n";
  const MARKUP = "<!-- \"Ügyfelek\" menüoldal: felül \"Ügyfél hozzáadása\", alatta kereshető lista. Önálló, hivatkozással betölthető. -->\n\n<div class=\"cl-wrap\" id=\"clWrap\">\n  <div class=\"cl-top\">\n    <input id=\"clSearch\" class=\"cl-search\" data-i18n-ph=\"cl.searchPlaceholder\" placeholder=\"Keresés név vagy CUI szerint…\">\n    <button id=\"clAdd\" class=\"cl-btn cl-btn--primary\" data-i18n=\"cl.addClient\">+ Ügyfél hozzáadása</button>\n  </div>\n  <table class=\"cl-table\"><thead><tr><th data-i18n=\"cl.thName\">Név</th><th data-i18n=\"cl.thCui\">CUI</th><th data-i18n=\"cl.thCity\">Helység</th><th data-i18n=\"cl.thVat\">ÁFA</th><th></th></tr></thead>\n    <tbody id=\"clRows\"><tr><td colspan=\"5\" class=\"cl-empty\" data-i18n=\"cl.loading\">Betöltés…</td></tr></tbody>\n  </table>\n</div>\n\n<!-- Hozzáadás/szerkesztés modal -->\n<div class=\"cl-ov\" id=\"clOv\" style=\"display:none\">\n  <div class=\"cl-box\">\n    <div class=\"cl-head\"><div class=\"cl-h\" id=\"clFormTitle\" data-i18n=\"cl.formTitleAdd\">Ügyfél hozzáadása</div><button class=\"cl-x\" id=\"clClose\">×</button></div>\n    <div class=\"cl-b\">\n      <div class=\"cl-msg\" id=\"clMsg\"></div>\n      <div class=\"cl-grid\">\n        <label class=\"cl-l cl-full\"><span data-i18n=\"cl.lblName\">Név (kötelező)</span><input id=\"f_denumire\" class=\"cl-in\"></label>\n        <label class=\"cl-l\"><span data-i18n=\"cl.lblType\">Típus</span>\n          <select id=\"f_tip\" class=\"cl-in\"><option value=\"PJ\" data-i18n=\"cl.optPj\">Cég (PJ)</option><option value=\"PF\" data-i18n=\"cl.optPf\">Magánszemély (PF)</option></select>\n        </label>\n        <label class=\"cl-l\">CUI / CIF\n          <span class=\"cl-cui\"><input id=\"f_cui_cif\" class=\"cl-in\"><button id=\"clAnaf\" class=\"cl-btn cl-btn--ghost\" type=\"button\">ANAF</button></span>\n        </label>\n        <label class=\"cl-l\"><span data-i18n=\"cl.lblRegCom\">Reg. Com.</span><input id=\"f_reg_com\" class=\"cl-in\"></label>\n        <label class=\"cl-l\"><span data-i18n=\"cl.lblCountry\">Ország</span><input id=\"f_tara\" class=\"cl-in\" value=\"RO\"></label>\n        <label class=\"cl-l\"><span data-i18n=\"cl.lblCounty\">Megye</span><input id=\"f_judet\" class=\"cl-in\"></label>\n        <label class=\"cl-l\"><span data-i18n=\"cl.lblCity\">Helység</span><input id=\"f_localitate\" class=\"cl-in\"></label>\n        <label class=\"cl-l cl-full\"><span data-i18n=\"cl.lblAddress\">Cím</span><input id=\"f_adresa\" class=\"cl-in\"></label>\n        <label class=\"cl-l\"><span data-i18n=\"cl.lblEmail\">E-mail</span><input id=\"f_email\" class=\"cl-in\"></label>\n        <label class=\"cl-l\"><span data-i18n=\"cl.lblPhone\">Telefon</span><input id=\"f_telefon\" class=\"cl-in\"></label>\n        <label class=\"cl-l\">IBAN<input id=\"f_iban\" class=\"cl-in\"></label>\n        <label class=\"cl-l\"><span data-i18n=\"cl.lblBank\">Bank</span><input id=\"f_banca\" class=\"cl-in\"></label>\n        <label class=\"cl-l\"><span data-i18n=\"cl.lblDefaultTva\">Alap ÁFA %</span><input id=\"f_default_tva\" class=\"cl-in\" type=\"number\"></label>\n        <label class=\"cl-l\"><span data-i18n=\"cl.lblCurrency\">Pénznem</span><input id=\"f_valuta\" class=\"cl-in\" value=\"RON\"></label>\n        <label class=\"cl-l\"><span data-i18n=\"cl.lblPaymentTerm\">Fizetési határidő (nap)</span><input id=\"f_payment_term_days\" class=\"cl-in\" type=\"number\" placeholder=\"30\"></label>\n        <label class=\"cl-l cl-full\"><span data-i18n=\"cl.lblNote\">Megjegyzés</span><input id=\"f_nota\" class=\"cl-in\"></label>\n      </div>\n      <div class=\"cl-foot\"><button class=\"cl-btn cl-btn--ghost\" id=\"clCancel\" data-i18n=\"cl.cancel\">Mégse</button><button class=\"cl-btn cl-btn--primary\" id=\"clSave\" data-i18n=\"cl.save\">Mentés</button></div>\n    </div>\n  </div>\n</div>";
  function ensureStyle() {
    if (document.getElementById("clients-page-style")) return;
    const s = document.createElement('style'); s.id = "clients-page-style"; s.textContent = STYLE; document.head.appendChild(s);
  }
  function mount(target) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) { console.warn("clients-page.js: nincs konténer"); return; }
    ensureStyle();
    el.innerHTML = MARKUP;
    if (typeof window.applyI18n === 'function') window.applyI18n(el);
    run(el);
  }
  function run(root) {
    
    (function () {
      const $ = (id) => document.getElementById(id);
      const F = ['denumire','tip','cui_cif','reg_com','tara','judet','localitate','adresa','email','telefon','iban','banca','default_tva','valuta','nota','payment_term_days'];
      let editId = null;
      const setMsg = (t, k) => { $('clMsg').textContent = t || ''; $('clMsg').className = 'cl-msg' + (k ? ' cl-msg--' + k : ''); };
    
      async function api(method, url, body) {
        const res = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        const d = await res.json().catch(() => ({})); if (!res.ok) throw new Error(d.error || (T('cl.errPrefix') + res.status)); return d;
      }
      async function loadList() {
        const q = $('clSearch').value.trim();
        try {
          const d = await api('GET', '/api/clients' + (q ? '?q=' + encodeURIComponent(q) : ''));
          const rows = $('clRows');
          if (!d.clients.length) { rows.innerHTML = '<tr><td colspan="5" class="cl-empty">' + T('cl.noClients') + '</td></tr>'; return; }
          rows.innerHTML = '';
          d.clients.forEach(c => {
            const tr = document.createElement('tr');
            const vat = c.anaf_status ? (c.anaf_status === 'activ' ? '<span class="cl-pill cl-pill--ok">' + T('cl.vatActive') + '</span>' : '<span class="cl-pill cl-pill--no">' + esc(c.anaf_status) + '</span>') : '';
            tr.innerHTML = '<td>' + esc(c.denumire) + '</td><td>' + esc(c.cui_cif || '') + '</td><td>' + esc(c.localitate || '') + '</td><td>' + vat + '</td>' +
              '<td style="text-align:right"><button class="cl-btn cl-btn--ghost cl-btn--sm">' + T('cl.edit') + '</button></td>';
            tr.querySelector('button').addEventListener('click', () => openForm(c));
            rows.appendChild(tr);
          });
        } catch (e) { $('clRows').innerHTML = '<tr><td colspan="5" class="cl-empty">' + e.message + '</td></tr>'; }
      }
      function esc(s){return String(s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}
    
      function openForm(c) {
        editId = c ? c.id : null;
        $('clFormTitle').textContent = c ? T('cl.formTitleEdit') : T('cl.formTitleAdd');
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
        if (!cui) return setMsg(T('cl.enterCui'), 'err');
        setMsg(T('cl.anafQuery'));
        try {
          const r = await api('GET', '/api/clients/anaf?cui=' + encodeURIComponent(cui));
          if (!r.found) return setMsg(r.error || (T('cl.anafNotFound') + (r.validChecksum === false ? T('cl.anafBadChecksum') : '')), 'err');
          if (r.name) $('f_denumire').value = r.name;
          if (r.address) $('f_adresa').value = r.address;
          if (r.regCom) $('f_reg_com').value = r.regCom;
          if (r.phone && !$('f_telefon').value) $('f_telefon').value = r.phone;
          const flags = [r.vatPayer ? T('cl.vatPayer') : T('cl.notVatPayer'), r.active ? T('cl.anafActive') : T('cl.anafInactive')];
          setMsg(T('cl.filledFromAnaf') + flags.join(' · '), r.active ? 'ok' : 'err');
        } catch (e) { setMsg(e.message, 'err'); }
      });
    
      $('clSave').addEventListener('click', async () => {
        const body = {}; F.forEach(f => body[f] = $('f_' + f).value.trim());
        if (!body.denumire) return setMsg(T('cl.nameRequired'), 'err');
        setMsg(T('cl.saving'));
        try {
          if (editId) await api('PUT', '/api/clients/' + editId, body);
          else await api('POST', '/api/clients', body);
          closeForm(); loadList();
        } catch (e) { setMsg(e.message, 'err'); }
      });
    
      loadList();

      if (window.I18N && typeof window.I18N.onLang === 'function') {
        window.I18N.onLang(function () {
          if (!document.body.contains($('clRows'))) return;
          if (typeof window.applyI18n === 'function') window.applyI18n(root);
          $('clFormTitle').textContent = editId ? T('cl.formTitleEdit') : T('cl.formTitleAdd');
          loadList();
        });
      }
    })();

  }
  return { mount };
})();
