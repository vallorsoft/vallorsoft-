// public/cargotrack-pairing.js  (a cargotrack-pairing.html-ből rendezve render-függvénnyé)
// Használat:  CargoTrackPairing.mount('konténerElemId')   — a fül/oldal megnyitásakor hívd.
window.CargoTrackPairing = (function () {
  const STYLE = "\n  .ctp{max-width:680px;border:1px solid #e2e6ee;border-radius:12px;padding:16px;background:#fff}\n  .ctp-title{font-weight:600;font-size:16px}\n  .ctp-sub{font-size:13px;color:#6b7280;margin:2px 0 12px}\n  .ctp-msg{font-size:13px;min-height:18px;margin-bottom:8px}\n  .ctp-msg--ok{color:#1a7f37}.ctp-msg--err{color:#c0341a}\n  .ctp-table{width:100%;border-collapse:collapse;font-size:14px}\n  .ctp-table th,.ctp-table td{text-align:left;padding:8px 6px;border-bottom:1px solid #eef1f6}\n  .ctp-table th{font-size:12px;color:#6b7280;font-weight:600}\n  .ctp-name{font-weight:500}.ctp-id{font-size:11px;color:#9aa3b2}\n  .ctp-in{font-size:16px;padding:7px 9px;border:1px solid #d0d5dd;border-radius:8px;width:140px}\n  .ctp-btn{font-size:13px;padding:7px 12px;border-radius:8px;border:1px solid #d0d5dd;background:#fff;cursor:pointer;touch-action:manipulation}\n  .ctp-btn--ok{border-color:#2563eb;color:#2563eb}\n  .ctp-empty{color:#9aa3b2;text-align:center;padding:14px}\n  .ctp-tick{color:#1a7f37;font-weight:700;margin-left:6px}\n";
  const MARKUP = "<!-- Járműpárosító: a CargoTrack-járművekhez rendeled a rendszámot. Az Integrációk fülre vagy a Járművek menübe. -->\n\n<div class=\"ctp\" id=\"ctPair\">\n  <div class=\"ctp-title\">Járművek párosítása (CargoTrack)</div>\n  <div class=\"ctp-sub\">Rendeld hozzá a CargoTrack-járművekhez a rendszámot, hogy a fuvarnál a megfelelő autó helye jelenjen meg.</div>\n  <div class=\"ctp-msg\" id=\"ctpMsg\"></div>\n  <table class=\"ctp-table\">\n    <thead><tr><th>CargoTrack jármű</th><th>Rendszám</th><th></th></tr></thead>\n    <tbody id=\"ctpRows\"><tr><td colspan=\"3\" class=\"ctp-empty\">Betöltés…</td></tr></tbody>\n  </table>\n</div>";
  function ensureStyle() {
    if (document.getElementById("cargotrack-pairing-style")) return;
    const s = document.createElement('style'); s.id = "cargotrack-pairing-style"; s.textContent = STYLE; document.head.appendChild(s);
  }
  function mount(target) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) { console.warn("cargotrack-pairing.js: nincs konténer"); return; }
    ensureStyle();
    el.innerHTML = MARKUP;
    run(el);
  }
  function run(root) {
    
    (function () {
      const rowsEl = document.getElementById('ctpRows');
      const msgEl = document.getElementById('ctpMsg');
      const setMsg = (t, k) => { msgEl.textContent = t || ''; msgEl.className = 'ctp-msg' + (k ? ' ctp-msg--' + k : ''); };
      const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
    
      async function api(method, url, body) {
        const res = await fetch(url, { method, credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || ('Hiba (' + res.status + ')'));
        return d;
      }
    
      async function load() {
        try {
          const [objRes, mapRes] = await Promise.all([
            api('GET', '/api/integrations/cargotrack/objects'),
            api('GET', '/api/integrations/cargotrack/map'),
          ]);
          const mapped = {}; (mapRes.mappings || []).forEach(m => mapped[m.object_id] = m.rendszam);
          const objs = objRes.objects || [];
          if (!objs.length) { rowsEl.innerHTML = '<tr><td colspan="3" class="ctp-empty">Nincs jármű a fiókban.</td></tr>'; return; }
          rowsEl.innerHTML = '';
          objs.forEach(o => {
            const tr = document.createElement('tr');
            const label = esc(o.name + (o.plate ? ' · ' + o.plate : ''));
            tr.innerHTML =
              '<td><div class="ctp-name">' + label + '</div><div class="ctp-id">' + esc(o.object_id) + '</div></td>' +
              '<td><input class="ctp-in" placeholder="pl. B104VLR" value="' + (mapped[o.object_id] || '') + '"></td>' +
              '<td><button class="ctp-btn ctp-btn--ok">Mentés</button><span class="ctp-tick" style="display:none">✓</span></td>';
            const input = tr.querySelector('input'), btn = tr.querySelector('button'), tick = tr.querySelector('.ctp-tick');
            btn.addEventListener('click', async () => {
              const rendszam = input.value.trim().toUpperCase();
              if (!rendszam) return setMsg('Adj meg rendszámot.', 'err');
              btn.disabled = true; setMsg('Mentés…');
              try {
                await api('POST', '/api/integrations/cargotrack/map',
                  { rendszam, object_id: o.object_id, object_name: o.name });
                tick.style.display = ''; setMsg('Mentve: ' + rendszam + ' → ' + label, 'ok');
              } catch (e) { setMsg(e.message, 'err'); }
              finally { btn.disabled = false; }
            });
            rowsEl.appendChild(tr);
          });
        } catch (e) {
          rowsEl.innerHTML = '<tr><td colspan="3" class="ctp-empty">' + e.message + '</td></tr>';
        }
      }
      load();
    })();
    
  }
  return { mount };
})();
