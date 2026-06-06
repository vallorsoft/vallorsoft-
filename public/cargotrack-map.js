// public/cargotrack-map.js  (a cargotrack-where-is.html-ből rendezve)
window.CargoTrackWhereIs = (function () {
  const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
  const LEAFLET_JS  = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  let map, marker;

  function ensureStyles() {
    if (document.getElementById('ctw-style')) return;
    const s = document.createElement('style'); s.id = 'ctw-style';
    s.textContent = `
      .ctw-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}
      .ctw-box{background:#fff;border-radius:14px;width:100%;max-width:560px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.25)}
      .ctw-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #eef1f6}
      .ctw-h-title{font-weight:600}
      .ctw-close{border:none;background:none;font-size:22px;line-height:1;cursor:pointer;color:#6b7280}
      .ctw-map{height:300px;width:100%;background:#eef1f6}
      .ctw-info{display:flex;flex-wrap:wrap;gap:14px;padding:14px 16px;font-size:14px}
      .ctw-info b{display:block;font-size:12px;color:#6b7280;font-weight:600}
      .ctw-state{padding:24px 16px;text-align:center;color:#6b7280;font-size:14px}
    `;
    document.head.appendChild(s);
  }
  function loadLeaflet() {
    return new Promise((resolve) => {
      if (window.L) return resolve();
      if (!document.querySelector('link[href="' + LEAFLET_CSS + '"]')) {
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = LEAFLET_CSS; document.head.appendChild(l);
      }
      const sc = document.createElement('script'); sc.src = LEAFLET_JS; sc.onload = resolve; document.body.appendChild(sc);
    });
  }
  function fmtTime(iso) { try { return new Date(iso).toLocaleString('hu-HU'); } catch (_) { return iso; } }

  function close() { const o = document.getElementById('ctw-overlay'); if (o) o.remove(); map = null; marker = null; }

  async function show(rendszam, label) {
    ensureStyles();
    const overlay = document.createElement('div');
    overlay.className = 'ctw-overlay'; overlay.id = 'ctw-overlay';
    overlay.innerHTML =
      '<div class="ctw-box">' +
        '<div class="ctw-head"><div class="ctw-h-title">Hol a kocsi? — ' + (label ? label + ' · ' : '') + rendszam + '</div>' +
        '<button class="ctw-close" aria-label="Bezár">×</button></div>' +
        '<div class="ctw-map" id="ctw-map" style="display:none"></div>' +
        '<div class="ctw-info" id="ctw-info" style="display:none"></div>' +
        '<div class="ctw-state" id="ctw-state">Pozíció lekérése…</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.ctw-close').addEventListener('click', close);

    const stateEl = overlay.querySelector('#ctw-state');
    try {
      const res = await fetch('/api/cargotrack/position?rendszam=' + encodeURIComponent(rendszam), { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { stateEl.textContent = data.error || ('Hiba (' + res.status + ')'); return; }
      const p = data.position;
      if (!p || p.latitude == null) { stateEl.textContent = data.message || 'Nincs friss pozícióadat.'; return; }

      await loadLeaflet();
      stateEl.style.display = 'none';
      const mapEl = overlay.querySelector('#ctw-map'); mapEl.style.display = '';
      const infoEl = overlay.querySelector('#ctw-info'); infoEl.style.display = '';

      map = L.map(mapEl).setView([p.latitude, p.longitude], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
      marker = L.marker([p.latitude, p.longitude]).addTo(map);
      setTimeout(() => map.invalidateSize(), 100);

      const fuel = (p.fuel_level != null) ? Math.round(p.fuel_level) + ' L' : '—';
      const speed = (p.speed != null) ? Math.round(p.speed) + ' km/h' : '—';
      infoEl.innerHTML =
        '<div><b>Üzemanyag</b>' + fuel + '</div>' +
        '<div><b>Sebesség</b>' + speed + '</div>' +
        '<div><b>Gyújtás</b>' + (p.ignition || '—') + '</div>' +
        '<div><b>Utolsó jel</b>' + fmtTime(p.datetime) + '</div>';
    } catch (e) {
      stateEl.textContent = 'Hiba: ' + e.message;
    }
  }

  return { show, close };
})();
