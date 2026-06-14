// public/client-mail.js — Kliens-e-mail szerkesztő: sablon vagy szabad szöveg, logó, küldés.
// Globál: window.ClientMail.open({ to, context, inbound_order_id, order_id })
window.ClientMail = (function () {
  function ensureStyle() {
    if (document.getElementById('cm-style')) return;
    const s = document.createElement('style'); s.id = 'cm-style';
    s.textContent = `
      .cm-ov{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10001;padding:14px}
      .cm-box{background:#fff;color:#0b0f14;width:100%;max-width:620px;max-height:92vh;overflow:auto;border-radius:14px;padding:18px}
      .cm-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
      .cm-h h3{margin:0;font-size:17px}.cm-x{background:none;border:0;font-size:24px;cursor:pointer;color:#6b7a90}
      .cm-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}
      .cm-l{font-size:12px;color:#6b7a90;display:block;margin:8px 0 3px}
      .cm-in,.cm-sel,.cm-ta{width:100%;border:1px solid #d3dded;border-radius:8px;padding:9px;font-size:14px;box-sizing:border-box}
      .cm-ta{min-height:150px;resize:vertical;font-family:inherit}
      .cm-btn{cursor:pointer;border:1px solid #cdd6e4;border-radius:8px;padding:9px 13px;font-size:13px;font-weight:600;background:#fff}
      .cm-btn--red{background:#3b82f6;color:#fff;border-color:#3b82f6}.cm-btn--ghost{background:#f4f7fb}
      .cm-hint{font-size:11px;color:#8a97a8;margin-top:4px}
      .cm-sec{border-top:1px solid #eef2f7;margin-top:14px;padding-top:12px}
      .cm-logo img{max-height:46px;max-width:200px;border:1px solid #eef2f7;border-radius:6px;padding:4px;background:#fff}
      .cm-tpl{display:flex;gap:6px;align-items:center;border:1px solid #eef2f7;border-radius:8px;padding:7px 9px;margin-bottom:6px;font-size:13px}
      .cm-tpl b{flex:1}
      .cm-hist{font-size:12px;color:#5b6b82;border-left:3px solid #e3e9f2;padding:4px 10px;margin:6px 0}
      .cm-err{color:#b3271a;font-size:12px}`;
    document.head.appendChild(s);
  }
  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || ('Hiba (' + r.status + ')'));
    return d;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const nl2br = (s) => esc(s).replace(/\n/g, '<br>');
  function fill(tpl, ctx) {
    return String(tpl || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (ctx && ctx[k] != null ? ctx[k] : ''));
  }

  function open(opts) {
    opts = opts || {}; ensureStyle();
    const ctx = opts.context || {};
    const ov = document.createElement('div'); ov.className = 'cm-ov';
    ov.innerHTML =
      '<div class="cm-box">' +
        '<div class="cm-h"><h3>✉️ E-mail a kliensnek</h3><button class="cm-x" id="cmX">&times;</button></div>' +
        '<label class="cm-l">Címzett</label><input class="cm-in" id="cmTo" value="' + esc(opts.to || '') + '">' +
        '<label class="cm-l">Sablon (opcionális)</label>' +
        '<div class="cm-row"><select class="cm-sel" id="cmTpl" style="flex:1"><option value="">— Szabad szöveg —</option></select>' +
          '<button class="cm-btn cm-btn--ghost" id="cmTplManage">Sablonok</button></div>' +
        '<label class="cm-l">Tárgy</label><input class="cm-in" id="cmSubj" value="">' +
        '<label class="cm-l">Üzenet</label><textarea class="cm-ta" id="cmBody"></textarea>' +
        '<div class="cm-hint">Helyettesíthető mezők: {{client}}, {{ref}}, {{loc_incarcare}}, {{loc_descarcare}}, {{pret}}, {{order_id}}</div>' +
        (opts.inbound_order_id ? '<div class="cm-row"><label><input type="checkbox" id="cmAttach"> A beérkező megrendelő PDF csatolása</label></div>' : '') +
        '<div class="cm-row"><div id="cmErr" class="cm-err"></div><div style="flex:1"></div>' +
          '<button class="cm-btn cm-btn--ghost" id="cmLogo">Logó</button>' +
          '<button class="cm-btn cm-btn--red" id="cmSend">Küldés</button></div>' +
        '<div class="cm-sec" id="cmExtra" style="display:none"></div>' +
        '<div class="cm-sec"><label class="cm-l">Korábbi üzenetek</label><div id="cmHist"><span class="cm-hint">—</span></div></div>' +
      '</div>';
    document.body.appendChild(ov);
    const $ = (id) => ov.querySelector('#' + id);
    const close = () => ov.remove();
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    $('cmX').addEventListener('click', close);

    let templates = [];
    async function loadTemplates() {
      try {
        const d = await api('GET', '/api/email-templates'); templates = d.items || [];
        $('cmTpl').innerHTML = '<option value="">— Szabad szöveg —</option>' +
          templates.map(t => '<option value="' + t.id + '">' + esc(t.name) + '</option>').join('');
      } catch (e) {}
    }
    $('cmTpl').addEventListener('change', function () {
      const t = templates.find(x => String(x.id) === $('cmTpl').value);
      if (!t) return;
      $('cmSubj').value = fill(t.subject, ctx);
      $('cmBody').value = fill(t.body, ctx);
    });

    // küldés
    $('cmSend').addEventListener('click', async function () {
      $('cmErr').textContent = '';
      const to = $('cmTo').value.trim(), subject = $('cmSubj').value.trim(), body = $('cmBody').value.trim();
      if (!to || !body) { $('cmErr').textContent = 'Címzett és üzenet kötelező.'; return; }
      const btn = $('cmSend'); btn.disabled = true; btn.textContent = 'Küldés…';
      try {
        await api('POST', '/api/client-mail/send', {
          to, subject, html: nl2br(body),
          inbound_order_id: opts.inbound_order_id || null, order_id: opts.order_id || null,
          attach_inbound_pdf: $('cmAttach') ? $('cmAttach').checked : false,
        });
        btn.textContent = 'Elküldve ✓'; await loadHistory();
        setTimeout(close, 800);
      } catch (e) { $('cmErr').textContent = e.message; btn.disabled = false; btn.textContent = 'Küldés'; }
    });

    // beszélgetés-előzmény
    async function loadHistory() {
      if (!opts.inbound_order_id && !opts.order_id) return;
      try {
        const q = opts.inbound_order_id ? 'inbound_order_id=' + opts.inbound_order_id : 'order_id=' + encodeURIComponent(opts.order_id);
        const d = await api('GET', '/api/client-mail?' + q);
        const items = d.items || [];
        $('cmHist').innerHTML = items.length
          ? items.map(m => '<div class="cm-hist"><b>' + esc(m.subject || '(nincs tárgy)') + '</b> → ' + esc(m.to_email) +
              ' <span class="cm-hint">' + new Date(m.sent_at).toLocaleString('hu-HU') + (m.status === 'error' ? ' · HIBA' : '') + '</span></div>').join('')
          : '<span class="cm-hint">Még nincs elküldött üzenet.</span>';
      } catch (e) {}
    }

    // Logó kezelő
    $('cmLogo').addEventListener('click', async function () {
      const box = $('cmExtra'); box.style.display = 'block';
      box.innerHTML = '<label class="cm-l">Cég-logó (az e-mailek fejlécében jelenik meg)</label>' +
        '<div class="cm-logo" id="cmLogoPrev"><span class="cm-hint">Betöltés…</span></div>' +
        '<div class="cm-row"><input type="file" id="cmLogoFile" accept="image/*">' +
        '<button class="cm-btn cm-btn--ghost" id="cmLogoDel">Eltávolítás</button></div>' +
        '<div class="cm-hint">A logó megjelenik a kimenő e-mailek tetején (a „VallorSoft” felirat helyén). Élő megjelenéshez az APP_URL és a BREVO_* beállítása szükséges.</div>';
      async function refresh() {
        try { const d = await api('GET', '/api/branding/logo');
          $('cmLogoPrev').innerHTML = d.has ? '<img src="' + d.dataUri + '">' : '<span class="cm-hint">Nincs feltöltött logó.</span>';
        } catch (e) {}
      }
      $('cmLogoFile').addEventListener('change', function (e) {
        const f = e.target.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = async function () {
          try { await api('POST', '/api/branding/logo', { base64: rd.result, mime: f.type || 'image/png' }); await refresh(); }
          catch (err) { alert(err.message); }
        };
        rd.readAsDataURL(f);
      });
      $('cmLogoDel').addEventListener('click', async function () { try { await api('DELETE', '/api/branding/logo'); await refresh(); } catch (e) { alert(e.message); } });
      refresh();
    });

    // Sablonkezelő
    $('cmTplManage').addEventListener('click', async function () {
      const box = $('cmExtra'); box.style.display = 'block';
      function render() {
        box.innerHTML = '<label class="cm-l">E-mail sablonok</label><div id="cmTplList"></div>' +
          '<div class="cm-row"><button class="cm-btn cm-btn--ghost" id="cmTplNew">+ Új sablon</button></div>';
        $('cmTplList').innerHTML = templates.length
          ? templates.map(t => '<div class="cm-tpl"><b>' + esc(t.name) + '</b>' +
              '<button class="cm-btn cm-btn--ghost" data-edit="' + t.id + '">Szerkeszt</button>' +
              '<button class="cm-btn cm-btn--ghost" data-del="' + t.id + '">Töröl</button></div>').join('')
          : '<span class="cm-hint">Még nincs sablon. Hozz létre egyet.</span>';
        box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
          if (!confirm('Törlöd a sablont?')) return;
          try { await api('DELETE', '/api/email-templates/' + b.dataset.del); await loadTemplates(); render(); } catch (e) { alert(e.message); }
        }));
        box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editor(templates.find(x => String(x.id) === b.dataset.edit))));
        $('cmTplNew').addEventListener('click', () => editor(null));
      }
      function editor(t) {
        box.innerHTML = '<label class="cm-l">Sablon neve</label><input class="cm-in" id="etName" value="' + esc(t ? t.name : '') + '">' +
          '<label class="cm-l">Tárgy</label><input class="cm-in" id="etSubj" value="' + esc(t ? t.subject : '') + '">' +
          '<label class="cm-l">Szöveg</label><textarea class="cm-ta" id="etBody">' + esc(t ? t.body : '') + '</textarea>' +
          '<div class="cm-hint">Mezők: {{client}}, {{ref}}, {{loc_incarcare}}, {{loc_descarcare}}, {{pret}}, {{order_id}}</div>' +
          '<div class="cm-row"><button class="cm-btn cm-btn--ghost" id="etBack">Vissza</button><div style="flex:1"></div><button class="cm-btn cm-btn--red" id="etSave">Mentés</button></div>';
        $('etBack').addEventListener('click', render);
        $('etSave').addEventListener('click', async function () {
          const payload = { name: $('etName').value.trim(), subject: $('etSubj').value, body: $('etBody').value };
          if (!payload.name) { alert('A név kötelező.'); return; }
          try {
            if (t) await api('PUT', '/api/email-templates/' + t.id, payload);
            else await api('POST', '/api/email-templates', payload);
            await loadTemplates(); render();
          } catch (e) { alert(e.message); }
        });
      }
      render();
    });

    loadTemplates();
    loadHistory();
  }
  return { open };
})();
