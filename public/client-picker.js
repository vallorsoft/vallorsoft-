// public/client-picker.js — kereshető ügyfél-választó (fuvar-kiírás).
// Új ügyfél: „+" (gyors, kézi) vagy „ANAF" (CUI alapján, a hivatalos adatokkal —
// ha a cég ügyfelei közt már megvan, azt választja ki, nem hoz létre duplikátumot).
window.ClientPicker = (function () {
  function T(k, fb) { try { var v = window.t ? window.t(k) : null; return (v && v !== k) ? v : fb; } catch (_) { return fb; } }
  function styles() {
    if (document.getElementById('cp-style')) return;
    const s = document.createElement('style'); s.id = 'cp-style';
    s.textContent = `
      .cp{position:relative}
      .cp-row{display:flex;gap:6px}
      .cp-in{flex:1;min-width:0;font-size:16px;padding:9px 11px;border:1px solid #94a3b8;border-radius:8px;background:#fff;color:#0f172a}
      .cp-plus{font-size:18px;width:42px;border:1px solid #94a3b8;border-radius:8px;background:#fff;color:#0f172a;cursor:pointer}
      .cp-anaf{font-size:13px;font-weight:700;padding:0 12px;border:1px solid #1d4ed8;border-radius:8px;background:#1d4ed8;color:#fff;cursor:pointer;white-space:nowrap}
      .cp-list{position:absolute;left:0;right:0;top:46px;background:#fff;border:1px solid #94a3b8;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:240px;overflow:auto;z-index:50;display:none}
      .cp-item{padding:9px 11px;cursor:pointer;font-size:14px;color:#0f172a}
      .cp-item:hover{background:#eef2f7}
      .cp-item small{color:#475569}
      .cp-none{padding:10px;color:#475569;font-size:13px}
      .cp-sel{font-size:13px;color:#15803d;margin-top:6px;min-height:16px}
      .cp-ov{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}
      .cp-box{background:#fff;color:#0f172a;border-radius:12px;width:100%;max-width:420px;padding:16px}
      .cp-box h4{margin:0 0 12px;color:#0f172a}
      .cp-f{display:flex;flex-direction:column;gap:5px;font-size:12px;color:#334155;margin-bottom:10px}
      .cp-hint{font-size:12px;color:#475569;margin:-4px 0 10px}
      .cp-btn{font-size:14px;padding:9px 14px;border-radius:8px;border:1px solid transparent;cursor:pointer}
      .cp-btn--primary{background:#1d4ed8;color:#fff}.cp-btn--ghost{background:#fff;border:1px solid #94a3b8;color:#1e293b}
      .cp-btn[disabled]{opacity:.6;cursor:wait}
      .cp-foot{display:flex;gap:8px;justify-content:flex-end}
      .cp-msg{font-size:12px;color:#b91c1c;min-height:14px;margin-bottom:6px}
      [data-theme="dark"] .cp-sel{color:#4ade80}
    `;
    document.head.appendChild(s);
  }
  async function api(method, url, body) {
    const res = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = await res.json().catch(() => ({})); if (!res.ok) throw new Error(d.error || ('Eroare ' + res.status)); return d;
  }

  function mount(container, opts) {
    styles();
    opts = opts || {};
    container.classList.add('cp');
    container.innerHTML =
      '<div class="cp-row"><input class="cp-in" autocomplete="off" placeholder="' + esc(T('cp.searchPh', 'Caută client…')) + '">' +
      (opts.anaf ? '<button class="cp-anaf" type="button" title="' + esc(T('cp.anafTitle', 'Adaugă client după CUI (ANAF)')) + '">ANAF</button>' : '') +
      '<button class="cp-plus" title="' + esc(T('cp.newTitle', 'Client nou')) + '" type="button">+</button></div>' +
      '<div class="cp-list"></div><div class="cp-sel"></div>';
    const input = container.querySelector('.cp-in');
    const list = container.querySelector('.cp-list');
    const sel = container.querySelector('.cp-sel');
    const plus = container.querySelector('.cp-plus');
    const anafBtn = container.querySelector('.cp-anaf');
    let current = null;

    function setSelected(c) {
      if (!c || !c.id) return;
      current = c;
      if (opts.hiddenInputId) { const h = document.getElementById(opts.hiddenInputId); if (h) h.value = c.id; }
      input.value = c.denumire || ''; sel.textContent = '✓ ' + T('cp.selected', 'Selectat') + ': ' + (c.denumire || '') + (c.cui_cif ? ' (' + c.cui_cif + ')' : '');
      list.style.display = 'none';
      if (opts.onSelect) opts.onSelect(c);
    }
    function clear() {
      current = null;
      if (opts.hiddenInputId) { const h = document.getElementById(opts.hiddenInputId); if (h) h.value = ''; }
      input.value = ''; sel.textContent = '';
    }
    async function search() {
      const q = input.value.trim();
      try {
        const d = await api('GET', '/api/clients' + (q ? '?q=' + encodeURIComponent(q) : ''));
        if (!d.clients.length) { list.innerHTML = '<div class="cp-none">' + esc(T('cp.none', 'Niciun rezultat — folosește butonul ANAF sau „+” pentru client nou.')) + '</div>'; }
        else list.innerHTML = d.clients.map(c =>
          '<div class="cp-item" data-id="' + c.id + '">' + esc(c.denumire) + (c.cui_cif ? ' <small>' + esc(c.cui_cif) + '</small>' : '') + '</div>').join('');
        list.style.display = 'block';
        list.querySelectorAll('.cp-item').forEach((el, i) => el.addEventListener('click', () => setSelected(d.clients[i])));
      } catch (e) { list.innerHTML = '<div class="cp-none">' + esc(e.message) + '</div>'; list.style.display = 'block'; }
    }
    input.addEventListener('focus', search);
    input.addEventListener('input', () => { clearTimeout(window.__cpT); window.__cpT = setTimeout(search, 200); });
    document.addEventListener('click', (e) => { if (!container.contains(e.target)) list.style.display = 'none'; });
    plus.addEventListener('click', () => quickAdd(setSelected, input.value.trim()));
    if (anafBtn) anafBtn.addEventListener('click', () => anafAdd(setSelected, /^\s*(RO)?\s*\d{2,10}\s*$/i.test(input.value) ? input.value.trim() : ''));
    return { select: setSelected, clear: clear, current: function () { return current; } };
  }

  function dialog(title, bodyHtml, saveLabel) {
    const ov = document.createElement('div'); ov.className = 'cp-ov vs-light-surface';
    ov.innerHTML = '<div class="cp-box"><h4>' + esc(title) + '</h4><div class="cp-msg"></div>' + bodyHtml +
      '<div class="cp-foot"><button class="cp-btn cp-btn--ghost" data-x="cancel">' + esc(T('cp.cancel', 'Anulează')) + '</button>' +
      '<button class="cp-btn cp-btn--primary" data-x="save">' + esc(saveLabel) + '</button></div></div>';
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    ov.querySelector('[data-x="cancel"]').addEventListener('click', close);
    return { ov, close, msg: ov.querySelector('.cp-msg'), save: ov.querySelector('[data-x="save"]') };
  }

  // ANAF: CUI → a cég ügyfelei közt keres; ha nincs, az ANAF-ból felveszi.
  function anafAdd(onSaved, prefillCui) {
    const d = dialog(T('cp.anafHead', 'Client nou din ANAF'),
      '<label class="cp-f">CUI / CIF<input class="cp-in" id="qa_anaf_cui" inputmode="numeric" placeholder="RO12345678"></label>' +
      '<div class="cp-hint">' + esc(T('cp.anafHint', 'Datele oficiale (denumire, adresă, Reg. Com.) vin de la ANAF. Dacă firma există deja în clienți, o selectăm.')) + '</div>',
      T('cp.anafSave', 'Caută și adaugă'));
    const cui = d.ov.querySelector('#qa_anaf_cui'); cui.value = prefillCui || ''; cui.focus();
    const go = async () => {
      const v = cui.value.trim();
      if (!v) { d.msg.textContent = T('cp.cuiReq', 'CUI-ul este obligatoriu.'); return; }
      d.save.disabled = true; d.msg.textContent = '';
      try {
        const r = await api('POST', '/api/clients/from-cui', { cui: v });
        d.close(); onSaved(r.client);
        if (window.toast) window.toast((r.created ? T('cp.anafCreated', 'Client adăugat din ANAF') : T('cp.anafExisting', 'Client existent selectat')) + ': ' + r.client.denumire, 'ok');
      } catch (e) { d.msg.textContent = e.message; d.save.disabled = false; }
    };
    d.save.addEventListener('click', go);
    cui.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }

  function quickAdd(onSaved, prefillName) {
    const d = dialog(T('cp.quickHead', 'Client nou (rapid)'),
      '<label class="cp-f">' + esc(T('cp.nameReq', 'Denumire (obligatoriu)')) + '<input class="cp-in" id="qa_name"></label>' +
      '<label class="cp-f">' + esc(T('cp.cuiOpt', 'CUI / CIF (opțional)')) + '<input class="cp-in" id="qa_cui"></label>',
      T('cp.save', 'Salvează'));
    const name = d.ov.querySelector('#qa_name'); name.value = prefillName || '';
    d.save.addEventListener('click', async () => {
      const denumire = name.value.trim();
      if (!denumire) { d.msg.textContent = T('cp.nameMissing', 'Denumirea este obligatorie.'); return; }
      try {
        const r = await api('POST', '/api/clients', { denumire, cui_cif: d.ov.querySelector('#qa_cui').value.trim() });
        d.close(); onSaved(r.client);
      } catch (e) { d.msg.textContent = e.message; }
    });
  }
  function esc(s){return String(s == null ? '' : s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}

  return { mount };
})();
