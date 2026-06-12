// public/client-picker.js  (a client-picker.html-ből rendezve)
(window.registerI18n||function(d){(window.__i18nQueue=window.__i18nQueue||[]).push(d);})({
  'cl.pickSearchPlaceholder': { hu: 'Ügyfél keresése…', ro: 'Caută client…' },
  'cl.pickNewTitle': { hu: 'Új ügyfél', ro: 'Client nou' },
  'cl.pickSelected': { hu: '✓ Kiválasztva: ', ro: '✓ Selectat: ' },
  'cl.pickNoResults': { hu: 'Nincs találat — használd a „+” gombot új ügyfélhez.', ro: 'Niciun rezultat — folosește butonul „+” pentru un client nou.' },
  'cl.pickQuickTitle': { hu: 'Új ügyfél (gyors)', ro: 'Client nou (rapid)' },
  'cl.pickNameReq': { hu: 'Név (kötelező)', ro: 'Nume (obligatoriu)' },
  'cl.pickCuiOpt': { hu: 'CUI / CIF (opcionális)', ro: 'CUI / CIF (opțional)' },
  'cl.cancel': { hu: 'Mégse', ro: 'Anulează' },
  'cl.save': { hu: 'Mentés', ro: 'Salvează' },
  'cl.nameRequired': { hu: 'A név kötelező.', ro: 'Numele este obligatoriu.' },
  'cl.errPrefix': { hu: 'Hiba ', ro: 'Eroare ' },
});
function T(k,v){return (typeof window.t==='function')?window.t(k,v):k;}
window.ClientPicker = (function () {
  function styles() {
    if (document.getElementById('cp-style')) return;
    const s = document.createElement('style'); s.id = 'cp-style';
    s.textContent = `
      .cp{position:relative}
      .cp-row{display:flex;gap:6px}
      .cp-in{flex:1;font-size:16px;padding:9px 11px;border:1px solid #d0d5dd;border-radius:8px}
      .cp-plus{font-size:18px;width:42px;border:1px solid #d0d5dd;border-radius:8px;background:#fff;cursor:pointer}
      .cp-list{position:absolute;left:0;right:48px;top:46px;background:#fff;border:1px solid #d0d5dd;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:240px;overflow:auto;z-index:50;display:none}
      .cp-item{padding:9px 11px;cursor:pointer;font-size:14px}
      .cp-item:hover{background:#f3f6fb}
      .cp-item small{color:#9aa3b2}
      .cp-none{padding:10px;color:#9aa3b2;font-size:13px}
      .cp-sel{font-size:13px;color:#1a7f37;margin-top:6px;min-height:16px}
      .cp-ov{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}
      .cp-box{background:#fff;border-radius:12px;width:100%;max-width:420px;padding:16px}
      .cp-box h4{margin:0 0 12px}
      .cp-f{display:flex;flex-direction:column;gap:5px;font-size:12px;color:#6b7280;margin-bottom:10px}
      .cp-btn{font-size:14px;padding:9px 14px;border-radius:8px;border:1px solid transparent;cursor:pointer}
      .cp-btn--primary{background:#2563eb;color:#fff}.cp-btn--ghost{background:#fff;border:1px solid #d0d5dd;color:#374151}
      .cp-foot{display:flex;gap:8px;justify-content:flex-end}
      .cp-msg{font-size:12px;color:#c0341a;min-height:14px;margin-bottom:6px}
    `;
    document.head.appendChild(s);
  }
  async function api(method, url, body) {
    const res = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = await res.json().catch(() => ({})); if (!res.ok) throw new Error(d.error || (T('cl.errPrefix') + res.status)); return d;
  }

  function mount(container, opts) {
    styles();
    opts = opts || {};
    container.classList.add('cp');
    container.innerHTML =
      '<div class="cp-row"><input class="cp-in" placeholder="' + esc(T('cl.pickSearchPlaceholder')) + '"><button class="cp-plus" title="' + esc(T('cl.pickNewTitle')) + '" type="button">+</button></div>' +
      '<div class="cp-list"></div><div class="cp-sel"></div>';
    const input = container.querySelector('.cp-in');
    const list = container.querySelector('.cp-list');
    const sel = container.querySelector('.cp-sel');
    const plus = container.querySelector('.cp-plus');

    function setSelected(c) {
      if (opts.hiddenInputId) { const h = document.getElementById(opts.hiddenInputId); if (h) h.value = c.id; }
      input.value = c.denumire; sel.textContent = T('cl.pickSelected') + c.denumire + (c.cui_cif ? ' (' + c.cui_cif + ')' : '');
      list.style.display = 'none';
      if (opts.onSelect) opts.onSelect(c);
    }
    async function search() {
      const q = input.value.trim();
      try {
        const d = await api('GET', '/api/clients' + (q ? '?q=' + encodeURIComponent(q) : ''));
        if (!d.clients.length) { list.innerHTML = '<div class="cp-none">' + esc(T('cl.pickNoResults')) + '</div>'; }
        else list.innerHTML = d.clients.map(c =>
          '<div class="cp-item" data-id="' + c.id + '">' + esc(c.denumire) + (c.cui_cif ? ' <small>' + esc(c.cui_cif) + '</small>' : '') + '</div>').join('');
        list.style.display = 'block';
        list.querySelectorAll('.cp-item').forEach((el, i) => el.addEventListener('click', () => setSelected(d.clients[i])));
      } catch (e) { list.innerHTML = '<div class="cp-none">' + e.message + '</div>'; list.style.display = 'block'; }
    }
    input.addEventListener('focus', search);
    input.addEventListener('input', () => { clearTimeout(window.__cpT); window.__cpT = setTimeout(search, 200); });
    document.addEventListener('click', (e) => { if (!container.contains(e.target)) list.style.display = 'none'; });
    plus.addEventListener('click', () => quickAdd(setSelected, input.value.trim()));
  }

  function quickAdd(onSaved, prefillName) {
    const ov = document.createElement('div'); ov.className = 'cp-ov';
    ov.innerHTML =
      '<div class="cp-box"><h4>' + esc(T('cl.pickQuickTitle')) + '</h4><div class="cp-msg"></div>' +
      '<label class="cp-f">' + esc(T('cl.pickNameReq')) + '<input class="cp-in" id="qa_name"></label>' +
      '<label class="cp-f">' + esc(T('cl.pickCuiOpt')) + '<input class="cp-in" id="qa_cui"></label>' +
      '<div class="cp-foot"><button class="cp-btn cp-btn--ghost" id="qa_cancel">' + esc(T('cl.cancel')) + '</button><button class="cp-btn cp-btn--primary" id="qa_save">' + esc(T('cl.save')) + '</button></div></div>';
    document.body.appendChild(ov);
    const name = ov.querySelector('#qa_name'); name.value = prefillName || '';
    const msg = ov.querySelector('.cp-msg');
    const close = () => ov.remove();
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    ov.querySelector('#qa_cancel').addEventListener('click', close);
    ov.querySelector('#qa_save').addEventListener('click', async () => {
      const denumire = name.value.trim();
      if (!denumire) { msg.textContent = T('cl.nameRequired'); return; }
      try {
        const d = await api('POST', '/api/clients', { denumire, cui_cif: ov.querySelector('#qa_cui').value.trim() });
        close(); onSaved(d.client);
      } catch (e) { msg.textContent = e.message; }
    });
  }
  function esc(s){return String(s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}

  return { mount };
})();
