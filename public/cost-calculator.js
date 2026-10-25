// ============================================================
//  public/cost-calculator.js — Költség-kalkulátor (Vallorcalc-port)
//  6 al-oldal: 🚚 Jármű-költségek · 👤 Sofőr-költségek · 🏢 Cég-költségek
//             · 🧮 Kalkuláció (2 forrás-mód) · 💾 Mentett · ⚙️ Beállítások
//  A kalkuláció alapból manuális bevitel. Egy kattintással
//  átváltható „Vallorsoft adatok" módra: fuvar-picker → auto-fill.
//  A mezők utána is kézzel felülírhatók (a rendszer nem zárolja).
// ============================================================
(function () {
  'use strict';

  const t = (k, fb) => (window.I18N && window.I18N.t ? window.I18N.t(k, fb) : (fb || k));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d) => (n == null || !Number.isFinite(Number(n))) ? '—' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 });
  const gas = window.gas;

  const STATE = { refs: null, settings: null, orders: null };

  // ─── PANE-elosztó — admin.js/manager.js `loadTab` innen hív ─
  window.loadCostCalculator = function (paneKey) {
    if (paneKey === 'vcalc-vehicle-costs') renderVehicleCosts();
    else if (paneKey === 'vcalc-driver-costs') renderDriverCosts();
    else if (paneKey === 'vcalc-company-costs') renderCompanyCosts();
    else if (paneKey === 'vcalc-run') renderCalcForm();
    else if (paneKey === 'vcalc-saved') renderSavedList();
    else if (paneKey === 'vcalc-settings') renderSettings();
  };

  async function loadRefs() {
    if (STATE.refs) return STATE.refs;
    const r = await gas('vcalcRefLists', [{}]);
    if (r && r.ok) STATE.refs = r; else STATE.refs = { vehicles: [], drivers: [] };
    return STATE.refs;
  }
  async function loadSettings(force) {
    if (STATE.settings && !force) return STATE.settings;
    const r = await gas('vcalcSettingsGet', [{}]);
    if (r && r.ok) STATE.settings = r.settings;
    return STATE.settings || {};
  }

  // ═══════════════════════════════════════════════════════════
  //  1) JÁRMŰ-KÖLTSÉGEK
  // ═══════════════════════════════════════════════════════════
  async function renderVehicleCosts() {
    const box = document.querySelector('.pane[data-pane="vcalc-vehicle-costs"]');
    if (!box) return;
    box.innerHTML = `<div class="glass"><h2 class="h-title">🚚 <span data-i18n="vcalc.vehCosts.title">Jármű-költségek</span></h2>
      <p class="text-muted" data-i18n="vcalc.vehCosts.hint">Vontatónkénti/pótkocsinkénti fix költségek (biztosítás, hitel, ITP, gumi, olajcsere…). A meglévő flottád (Járművek fül) az igazságforrás.</p>
      <div id="vciBox">${t('vcalc.loading', 'Betöltés…')}</div></div>`;
    const refs = await loadRefs();
    const list = (await gas('vcalcVehicleCostList', [{}])) || { ok: true, items: [] };
    const items = list.items || [];
    const grouped = {};
    for (const v of refs.vehicles) grouped[v.id] = { vehicle: v, items: [] };
    for (const it of items) { if (grouped[it.vehicle_id]) grouped[it.vehicle_id].items.push(it); }

    const html = [`<div style="margin-bottom:12px"><button class="btn primary" id="vciAdd" data-i18n="vcalc.vehCosts.add">+ Új költség-tétel</button></div>`];
    if (!refs.vehicles.length) {
      html.push(`<p class="text-muted" data-i18n="vcalc.vehCosts.noVehicles">Nincs jármű a flottában. Vidd fel a Járművek fülön először.</p>`);
    } else {
      for (const g of Object.values(grouped)) {
        html.push(`<div class="glass-soft" style="margin:12px 0;padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
            <div><b>${esc(g.vehicle.rendszam)}</b> <span class="text-muted">${esc(g.vehicle.marca || '')} ${esc(g.vehicle.tip || '')}</span></div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <span class="badge">${g.items.length} ${t('vcalc.f.itemsShort','tétel')}</span>
              <button class="btn small primary" data-vci-add-veh="${g.vehicle.id}" title="${t('vcalc.vehCosts.addForThis','Új költség-tétel ehhez a járműhöz')}">➕ ${t('vcalc.f.newItem','Új tétel')}</button>
              <button class="btn small" data-vci-seed="${g.vehicle.id}" title="${t('vcalc.seed.hint','Valorcalc alapértelmezett tételek betöltése')}">🎯 ${t('vcalc.seed.load','Alapértelmezett tételek')}</button>
            </div>
          </div>`);
        if (!g.items.length) html.push(`<p class="text-muted" style="font-size:12px" data-i18n="vcalc.vehCosts.noItems">Nincs költség-tétel.</p>`);
        else html.push(`<table class="table" style="font-size:12.5px"><thead><tr>
          <th data-i18n="vcalc.f.name">Név</th><th data-i18n="vcalc.f.basis">Alap</th>
          <th data-i18n="vcalc.f.interval">Intervallum</th><th data-i18n="vcalc.f.amount">Összeg (LEI)</th>
          <th></th></tr></thead><tbody>${g.items.map(it => `
          <tr><td>${esc(it.name)}</td>
              <td>${it.basis_type === 'km' ? 'km' : (t('vcalc.f.time', 'idő'))}</td>
              <td>${it.basis_type === 'km' ? (fmt(it.interval_km, 0) + ' km') : ((it.interval_months || 12) + ' ' + t('vcalc.f.mo', 'hó'))}</td>
              <td>${fmt(it.amount_lei)} ${it.is_gross ? '(br)' : '(net)'}</td>
              <td><button class="btn small" data-vci-edit="${it.id}">✎</button>
                  <button class="btn small danger" data-vci-del="${it.id}">🗑</button></td></tr>`).join('')}</tbody></table>`);
        html.push(`</div>`);
      }
    }
    document.getElementById('vciBox').innerHTML = html.join('');
    document.getElementById('vciAdd').onclick = () => openVciModal(null, refs);
    box.querySelectorAll('[data-vci-add-veh]').forEach(b => b.onclick = () => {
      openVciModal(null, refs, Number(b.dataset.vciAddVeh));
    });
    box.querySelectorAll('[data-vci-edit]').forEach(b => b.onclick = () => {
      const it = items.find(x => String(x.id) === b.dataset.vciEdit); if (it) openVciModal(it, refs);
    });
    box.querySelectorAll('[data-vci-del]').forEach(b => b.onclick = async () => {
      if (!confirm(t('vcalc.confirmDelete', 'Biztosan törlöd?'))) return;
      const r = await gas('vcalcVehicleCostDelete', [{ id: Number(b.dataset.vciDel) }]);
      if (r && r.ok) renderVehicleCosts(); else alert(r && r.err || 'Hiba');
    });
    box.querySelectorAll('[data-vci-seed]').forEach(b => b.onclick = async () => {
      const veh = refs.vehicles.find(v => String(v.id) === b.dataset.vciSeed);
      if (!veh) return;
      const has = grouped[veh.id] && grouped[veh.id].items.length > 0;
      const msg = has
        ? t('vcalc.seed.confirmReplace', 'Ehhez a járműhöz már vannak tételek. Betöltjük az alapértelmezett Valorcalc-tételeket a jelenlegiek MELLÉ? (Kattints Mégse-re, ha az összeset le akarod cserélni.)')
        : t('vcalc.seed.confirmAdd', 'Betöltjük az alapértelmezett Valorcalc-tételeket ehhez a járműhöz?');
      if (!confirm(msg)) {
        if (has && confirm(t('vcalc.seed.confirmReplaceForce', 'Lecseréled az ÖSSZES jelenlegi tételt az alapértelmezettre? (visszavonhatatlan)'))) {
          const r = await gas('vcalcVehicleCostSeedDefaults', [{ vehicle_id: Number(b.dataset.vciSeed), replace: true }]);
          if (r && r.ok) { alert(t('vcalc.seed.done','Betöltve') + ': ' + r.inserted); renderVehicleCosts(); } else alert(r && r.err || 'Hiba');
        }
        return;
      }
      const r = await gas('vcalcVehicleCostSeedDefaults', [{ vehicle_id: Number(b.dataset.vciSeed), replace: false }]);
      if (r && r.ok) { alert(t('vcalc.seed.done','Betöltve') + ': ' + r.inserted); renderVehicleCosts(); } else alert(r && r.err || 'Hiba');
    });
    if (window.I18N && window.I18N.apply) window.I18N.apply();
  }

  function openVciModal(it, refs, preselectVehicleId) {
    const selectedVehId = it ? it.vehicle_id : (preselectVehicleId || (refs.vehicles[0] && refs.vehicles[0].id) || null);
    const m = document.createElement('div'); m.className = 'modal-back';
    m.innerHTML = `<div class="modal glass" style="max-width:520px">
      <h3>${it ? t('vcalc.vehCosts.edit', 'Költség-tétel szerkesztése') : t('vcalc.vehCosts.add', '+ Új költség-tétel')}</h3>
      <div class="field"><label data-i18n="vcalc.f.vehicle">Jármű</label>
        <select id="vciVeh">${refs.vehicles.map(v => `<option value="${v.id}"${selectedVehId === v.id ? ' selected' : ''}>${esc(v.rendszam)} — ${esc(v.marca || '')} ${esc(v.tip || '')}</option>`).join('')}</select></div>
      <div class="field"><label data-i18n="vcalc.f.name">Név</label>
        <input id="vciName" class="input" value="${esc(it?.name || '')}" placeholder="pl. RCA, ITP, gumi, olajcsere"></div>
      <div class="grid-2">
        <div class="field"><label data-i18n="vcalc.f.basis">Alap</label>
          <select id="vciBasis"><option value="time"${it && it.basis_type === 'time' ? ' selected' : ''}>${t('vcalc.f.time', 'idő-alapú')}</option><option value="km"${it && it.basis_type === 'km' ? ' selected' : ''}>km-alapú</option></select></div>
        <div class="field"><label id="vciIntLbl" data-i18n="vcalc.f.interval">Intervallum</label>
          <input id="vciInt" class="input" type="number" step="0.01" value="${it ? (it.basis_type === 'km' ? (it.interval_km || '') : (it.interval_months || 12)) : 12}"></div>
      </div>
      <div class="grid-2">
        <div class="field"><label data-i18n="vcalc.f.amount">Összeg (LEI)</label>
          <input id="vciAmt" class="input" type="number" step="0.01" value="${it?.amount_lei ?? ''}"></div>
        <div class="field"><label data-i18n="vcalc.f.type">Típus</label>
          <select id="vciGross"><option value="true"${!it || it.is_gross ? ' selected' : ''}>${t('vcalc.f.gross', 'Bruttó')}</option><option value="false"${it && !it.is_gross ? ' selected' : ''}>${t('vcalc.f.net', 'Nettó')}</option></select></div>
      </div>
      <div class="field"><label data-i18n="vcalc.f.notes">Megjegyzés</label><textarea id="vciNotes" class="textarea">${esc(it?.notes || '')}</textarea></div>
      <div class="modal-actions"><button class="btn ghost" id="vciCancel" data-i18n="vcalc.cancel">Mégse</button><button class="btn primary" id="vciSave" data-i18n="vcalc.save">Mentés</button></div>
    </div>`;
    document.body.appendChild(m);
    const basisSel = m.querySelector('#vciBasis');
    const intLbl = m.querySelector('#vciIntLbl');
    const updLbl = () => { intLbl.textContent = basisSel.value === 'km' ? t('vcalc.f.intervalKm', 'Intervallum (km)') : t('vcalc.f.intervalMo', 'Intervallum (hó)'); };
    basisSel.onchange = updLbl; updLbl();
    m.querySelector('#vciCancel').onclick = () => m.remove();
    m.querySelector('#vciSave').onclick = async () => {
      const p = {
        id: it?.id, vehicle_id: Number(m.querySelector('#vciVeh').value),
        name: m.querySelector('#vciName').value.trim(),
        basis_type: basisSel.value,
        interval_km: basisSel.value === 'km' ? Number(m.querySelector('#vciInt').value) : null,
        interval_months: basisSel.value === 'time' ? Number(m.querySelector('#vciInt').value) : null,
        amount_lei: Number(m.querySelector('#vciAmt').value),
        is_gross: m.querySelector('#vciGross').value === 'true',
        notes: m.querySelector('#vciNotes').value.trim(),
      };
      const r = await gas('vcalcVehicleCostSave', [p]);
      if (r && r.ok) { m.remove(); renderVehicleCosts(); } else alert(r && r.err || 'Hiba');
    };
    if (window.I18N && window.I18N.apply) window.I18N.apply();
  }

  // ═══════════════════════════════════════════════════════════
  //  2) SOFŐR-KÖLTSÉGEK
  // ═══════════════════════════════════════════════════════════
  async function renderDriverCosts() {
    const box = document.querySelector('.pane[data-pane="vcalc-driver-costs"]');
    if (!box) return;
    box.innerHTML = `<div class="glass"><h2 class="h-title">👤 <span data-i18n="vcalc.drvCosts.title">Sofőr-költségek</span></h2>
      <p class="text-muted" data-i18n="vcalc.drvCosts.hint">Belső sofőrönként ÉVES fix bér-jellegű költségek (havi bér × 12, munkaruha, tanfolyam). A motor ezt (éves / munkahetek) × fuvar-hetek alapon rákeni a fuvarra.</p>
      <div id="dciBox">${t('vcalc.loading', 'Betöltés…')}</div></div>`;
    const refs = await loadRefs();
    const list = (await gas('vcalcDriverCostList', [{}])) || { ok: true, items: [] };
    const items = list.items || [];
    const grouped = {};
    for (const d of refs.drivers) grouped[d.id] = { driver: d, items: [] };
    for (const it of items) { if (grouped[it.driver_id]) grouped[it.driver_id].items.push(it); }
    const html = [`<div style="margin-bottom:12px"><button class="btn primary" id="dciAdd" data-i18n="vcalc.drvCosts.add">+ Új sofőr-költség</button></div>`];
    if (!refs.drivers.length) html.push(`<p class="text-muted" data-i18n="vcalc.drvCosts.noDrivers">Nincs belső sofőr. Vidd fel őket a Belső sofőrök fülön.</p>`);
    else for (const g of Object.values(grouped)) {
      html.push(`<div class="glass-soft" style="margin:12px 0;padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
          <div><b>${esc(g.driver.nume || '')}</b> <span class="text-muted">${esc(g.driver.email)}</span></div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <span class="badge">${g.items.length} ${t('vcalc.f.itemsShort','tétel')}</span>
            <button class="btn small primary" data-dci-add-drv="${g.driver.id}" title="${t('vcalc.drvCosts.addForThis','Új költség-tétel ehhez a sofőrhöz')}">➕ ${t('vcalc.f.newItem','Új tétel')}</button>
            <button class="btn small" data-dci-seed="${g.driver.id}" title="${t('vcalc.seed.hint','Valorcalc alapértelmezett tételek betöltése')}">🎯 ${t('vcalc.seed.load','Alapértelmezett tételek')}</button>
          </div>
        </div>`);
      if (!g.items.length) html.push(`<p class="text-muted" style="font-size:12px" data-i18n="vcalc.vehCosts.noItems">Nincs költség-tétel.</p>`);
      else html.push(`<table class="table" style="font-size:12.5px"><thead><tr>
        <th data-i18n="vcalc.f.name">Név</th><th data-i18n="vcalc.f.amountAnnual">Éves LEI</th><th></th></tr></thead>
        <tbody>${g.items.map(it => `<tr><td>${esc(it.name)}</td><td>${fmt(it.amount_lei)} ${it.is_gross ? '(br)' : '(net)'}</td>
          <td><button class="btn small" data-dci-edit="${it.id}">✎</button>
              <button class="btn small danger" data-dci-del="${it.id}">🗑</button></td></tr>`).join('')}</tbody></table>`);
      html.push(`</div>`);
    }
    document.getElementById('dciBox').innerHTML = html.join('');
    document.getElementById('dciAdd').onclick = () => openDciModal(null, refs);
    box.querySelectorAll('[data-dci-add-drv]').forEach(b => b.onclick = () => {
      openDciModal(null, refs, Number(b.dataset.dciAddDrv));
    });
    box.querySelectorAll('[data-dci-edit]').forEach(b => b.onclick = () => { const it = items.find(x => String(x.id) === b.dataset.dciEdit); if (it) openDciModal(it, refs); });
    box.querySelectorAll('[data-dci-del]').forEach(b => b.onclick = async () => {
      if (!confirm(t('vcalc.confirmDelete', 'Biztosan törlöd?'))) return;
      const r = await gas('vcalcDriverCostDelete', [{ id: Number(b.dataset.dciDel) }]);
      if (r && r.ok) renderDriverCosts(); else alert(r && r.err || 'Hiba');
    });
    box.querySelectorAll('[data-dci-seed]').forEach(b => b.onclick = async () => {
      const drv = refs.drivers.find(d => String(d.id) === b.dataset.dciSeed);
      if (!drv) return;
      const has = grouped[drv.id] && grouped[drv.id].items.length > 0;
      const msg = has
        ? t('vcalc.seed.confirmReplace', 'Ehhez a sofőrhöz már vannak tételek. Betöltjük az alapértelmezett Valorcalc-tételeket a jelenlegiek MELLÉ? (Kattints Mégse-re, ha az összeset le akarod cserélni.)')
        : t('vcalc.seed.confirmAdd', 'Betöltjük az alapértelmezett Valorcalc-tételeket ehhez a sofőrhöz?');
      if (!confirm(msg)) {
        if (has && confirm(t('vcalc.seed.confirmReplaceForce', 'Lecseréled az ÖSSZES jelenlegi tételt az alapértelmezettre? (visszavonhatatlan)'))) {
          const r = await gas('vcalcDriverCostSeedDefaults', [{ driver_id: Number(b.dataset.dciSeed), replace: true }]);
          if (r && r.ok) { alert(t('vcalc.seed.done','Betöltve') + ': ' + r.inserted); renderDriverCosts(); } else alert(r && r.err || 'Hiba');
        }
        return;
      }
      const r = await gas('vcalcDriverCostSeedDefaults', [{ driver_id: Number(b.dataset.dciSeed), replace: false }]);
      if (r && r.ok) { alert(t('vcalc.seed.done','Betöltve') + ': ' + r.inserted); renderDriverCosts(); } else alert(r && r.err || 'Hiba');
    });
    if (window.I18N && window.I18N.apply) window.I18N.apply();
  }

  function openDciModal(it, refs, preselectDriverId) {
    const selectedDrvId = it ? it.driver_id : (preselectDriverId || (refs.drivers[0] && refs.drivers[0].id) || null);
    const m = document.createElement('div'); m.className = 'modal-back';
    m.innerHTML = `<div class="modal glass" style="max-width:520px">
      <h3>${it ? t('vcalc.drvCosts.edit', 'Sofőr-költség szerkesztése') : t('vcalc.drvCosts.add', '+ Új sofőr-költség')}</h3>
      <div class="field"><label data-i18n="vcalc.f.driver">Sofőr</label>
        <select id="dciDrv">${refs.drivers.map(d => `<option value="${d.id}"${selectedDrvId === d.id ? ' selected' : ''}>${esc(d.nume || d.email)}</option>`).join('')}</select></div>
      <div class="field"><label data-i18n="vcalc.f.name">Név</label>
        <input id="dciName" class="input" value="${esc(it?.name || '')}" placeholder="pl. havi bér × 12"></div>
      <div class="grid-2">
        <div class="field"><label data-i18n="vcalc.f.amountAnnual">Éves LEI</label>
          <input id="dciAmt" class="input" type="number" step="0.01" value="${it?.amount_lei ?? ''}"></div>
        <div class="field"><label data-i18n="vcalc.f.type">Típus</label>
          <select id="dciGross"><option value="true"${!it || it.is_gross ? ' selected' : ''}>${t('vcalc.f.gross', 'Bruttó')}</option><option value="false"${it && !it.is_gross ? ' selected' : ''}>${t('vcalc.f.net', 'Nettó')}</option></select></div>
      </div>
      <div class="field"><label data-i18n="vcalc.f.notes">Megjegyzés</label><textarea id="dciNotes" class="textarea">${esc(it?.notes || '')}</textarea></div>
      <div class="modal-actions"><button class="btn ghost" id="dciCancel" data-i18n="vcalc.cancel">Mégse</button><button class="btn primary" id="dciSave" data-i18n="vcalc.save">Mentés</button></div>
    </div>`;
    document.body.appendChild(m);
    m.querySelector('#dciCancel').onclick = () => m.remove();
    m.querySelector('#dciSave').onclick = async () => {
      const p = {
        id: it?.id, driver_id: Number(m.querySelector('#dciDrv').value),
        name: m.querySelector('#dciName').value.trim(),
        amount_lei: Number(m.querySelector('#dciAmt').value),
        is_gross: m.querySelector('#dciGross').value === 'true',
        notes: m.querySelector('#dciNotes').value.trim(),
      };
      const r = await gas('vcalcDriverCostSave', [p]);
      if (r && r.ok) { m.remove(); renderDriverCosts(); } else alert(r && r.err || 'Hiba');
    };
    if (window.I18N && window.I18N.apply) window.I18N.apply();
  }

  // ═══════════════════════════════════════════════════════════
  //  3) CÉG-KÖLTSÉGEK
  // ═══════════════════════════════════════════════════════════
  async function renderCompanyCosts() {
    const box = document.querySelector('.pane[data-pane="vcalc-company-costs"]');
    if (!box) return;
    box.innerHTML = `<div class="glass"><h2 class="h-title">🏢 <span data-i18n="vcalc.coCosts.title">Cég-költségek</span></h2>
      <p class="text-muted" data-i18n="vcalc.coCosts.hint">Cég-szintű fix költségek (könyvelés, iroda, szoftver, adók, ügyvezetői bér). A rendszer szétosztja őket az aktív vontatók számára.</p>
      <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary" id="cciAdd" data-i18n="vcalc.coCosts.add">+ Új cég-költség</button>
        <button class="btn" id="cciSeed" title="${t('vcalc.seed.hint','Valorcalc alapértelmezett tételek betöltése')}">🎯 ${t('vcalc.seed.load','Alapértelmezett tételek')}</button>
      </div>
      <div id="cciBox">${t('vcalc.loading', 'Betöltés…')}</div></div>`;
    const list = (await gas('vcalcCompanyCostList', [{}])) || { ok: true, items: [] };
    const items = list.items || [];
    const cbox = document.getElementById('cciBox');
    if (!items.length) cbox.innerHTML = `<p class="text-muted" data-i18n="vcalc.coCosts.noItems">Nincs cég-költség tétel.</p>`;
    else cbox.innerHTML = `<table class="table"><thead><tr>
      <th data-i18n="vcalc.f.name">Név</th><th data-i18n="vcalc.f.basis">Alap</th>
      <th data-i18n="vcalc.f.intervalMo">Intervallum (hó)</th><th data-i18n="vcalc.f.amount">Összeg (LEI)</th><th></th></tr></thead>
      <tbody>${items.map(it => `<tr>
        <td>${esc(it.name)}</td>
        <td>${it.basis_type === 'km' ? 'km' : t('vcalc.f.time', 'idő')}</td>
        <td>${it.interval_months || 12}</td>
        <td>${fmt(it.amount_lei)} ${it.is_gross ? '(br)' : '(net)'}</td>
        <td><button class="btn small" data-cci-edit="${it.id}">✎</button>
            <button class="btn small danger" data-cci-del="${it.id}">🗑</button></td></tr>`).join('')}</tbody></table>`;
    document.getElementById('cciAdd').onclick = () => openCciModal(null);
    document.getElementById('cciSeed').onclick = async () => {
      const has = items.length > 0;
      const msg = has
        ? t('vcalc.seed.confirmReplace', 'Már vannak cég-tételek. Betöltjük az alapértelmezett Valorcalc-tételeket a jelenlegiek MELLÉ? (Kattints Mégse-re, ha az összeset le akarod cserélni.)')
        : t('vcalc.seed.confirmAdd', 'Betöltjük az alapértelmezett Valorcalc cég-tételeket?');
      if (!confirm(msg)) {
        if (has && confirm(t('vcalc.seed.confirmReplaceForce', 'Lecseréled az ÖSSZES jelenlegi tételt az alapértelmezettre? (visszavonhatatlan)'))) {
          const r = await gas('vcalcCompanyCostSeedDefaults', [{ replace: true }]);
          if (r && r.ok) { alert(t('vcalc.seed.done','Betöltve') + ': ' + r.inserted); renderCompanyCosts(); } else alert(r && r.err || 'Hiba');
        }
        return;
      }
      const r = await gas('vcalcCompanyCostSeedDefaults', [{ replace: false }]);
      if (r && r.ok) { alert(t('vcalc.seed.done','Betöltve') + ': ' + r.inserted); renderCompanyCosts(); } else alert(r && r.err || 'Hiba');
    };
    cbox.querySelectorAll('[data-cci-edit]').forEach(b => b.onclick = () => { const it = items.find(x => String(x.id) === b.dataset.cciEdit); if (it) openCciModal(it); });
    cbox.querySelectorAll('[data-cci-del]').forEach(b => b.onclick = async () => {
      if (!confirm(t('vcalc.confirmDelete', 'Biztosan törlöd?'))) return;
      const r = await gas('vcalcCompanyCostDelete', [{ id: Number(b.dataset.cciDel) }]);
      if (r && r.ok) renderCompanyCosts(); else alert(r && r.err || 'Hiba');
    });
    if (window.I18N && window.I18N.apply) window.I18N.apply();
  }

  function openCciModal(it) {
    const m = document.createElement('div'); m.className = 'modal-back';
    m.innerHTML = `<div class="modal glass" style="max-width:520px">
      <h3>${it ? t('vcalc.coCosts.edit', 'Cég-költség szerkesztése') : t('vcalc.coCosts.add', '+ Új cég-költség')}</h3>
      <div class="field"><label data-i18n="vcalc.f.name">Név</label>
        <input id="cciName" class="input" value="${esc(it?.name || '')}" placeholder="pl. Könyvelés, Iroda-bér, Szoftver"></div>
      <div class="grid-2">
        <div class="field"><label data-i18n="vcalc.f.basis">Alap</label>
          <select id="cciBasis"><option value="time"${!it || it.basis_type === 'time' ? ' selected' : ''}>${t('vcalc.f.time', 'idő-alapú')}</option><option value="km"${it && it.basis_type === 'km' ? ' selected' : ''}>km-alapú</option></select></div>
        <div class="field"><label data-i18n="vcalc.f.intervalMo">Intervallum (hó)</label>
          <input id="cciInt" class="input" type="number" value="${it?.interval_months ?? 12}"></div>
      </div>
      <div class="grid-2">
        <div class="field"><label data-i18n="vcalc.f.amount">Összeg (LEI)</label>
          <input id="cciAmt" class="input" type="number" step="0.01" value="${it?.amount_lei ?? ''}"></div>
        <div class="field"><label data-i18n="vcalc.f.type">Típus</label>
          <select id="cciGross"><option value="true"${!it || it.is_gross ? ' selected' : ''}>${t('vcalc.f.gross', 'Bruttó')}</option><option value="false"${it && !it.is_gross ? ' selected' : ''}>${t('vcalc.f.net', 'Nettó')}</option></select></div>
      </div>
      <div class="modal-actions"><button class="btn ghost" id="cciCancel" data-i18n="vcalc.cancel">Mégse</button><button class="btn primary" id="cciSave" data-i18n="vcalc.save">Mentés</button></div>
    </div>`;
    document.body.appendChild(m);
    m.querySelector('#cciCancel').onclick = () => m.remove();
    m.querySelector('#cciSave').onclick = async () => {
      const p = {
        id: it?.id, name: m.querySelector('#cciName').value.trim(),
        basis_type: m.querySelector('#cciBasis').value,
        interval_months: Number(m.querySelector('#cciInt').value) || 12,
        amount_lei: Number(m.querySelector('#cciAmt').value),
        is_gross: m.querySelector('#cciGross').value === 'true',
      };
      const r = await gas('vcalcCompanyCostSave', [p]);
      if (r && r.ok) { m.remove(); renderCompanyCosts(); } else alert(r && r.err || 'Hiba');
    };
    if (window.I18N && window.I18N.apply) window.I18N.apply();
  }

  // ═══════════════════════════════════════════════════════════
  //  4) KALKULÁCIÓ FORM (dual-mode: manuális ↔ Vallorsoft adatok)
  // ═══════════════════════════════════════════════════════════

  const F = {}; // mezőállapot

  async function renderCalcForm() {
    const box = document.querySelector('.pane[data-pane="vcalc-run"]');
    if (!box) return;
    const refs = await loadRefs();
    const settings = await loadSettings();
    const today = new Date().toISOString().slice(0, 10);

    // Alapállapot
    Object.assign(F, {
      source_mode: 'manual',
      // Összevont kalkuláció: egy vagy több fuvar (pl. 2 fuvar egy hét alatt).
      order_ids: [], orders_info: [], orders_totals: null,
      truck_vehicle_id: '', trailer_vehicle_id: '', driver_ids: [],
      period_from: today, period_to: today,
      trip_days: 5, trip_km: '', auto_km: null,
      fuel_method: 'per_liter', fuel_l_per_100km: 30, fuel_price_gross: '',
      fuel_total_gross: '',
      excisa_applied: false, fuel_discount_applied: false,
      tolls: [], toll_precise: false,
      // Csak az aktív VONTATÓK (tip='Vontato') — a pótkocsi ('Potkocsi') nem osztja a cég-költséget.
      active_trucks: Math.max(1, refs.vehicles.filter(v => v.tip === 'Vontato' && v.activ !== false).length || 1),
      freight_revenue_input: '', freight_revenue_currency: 'lei', freight_revenue_is_gross: true,
      bnr_eur_lei: Number(settings.eur_ron_rate) || 5.0, name: '',
    });

    box.innerHTML = `<div class="glass"><h2 class="h-title">🧮 <span data-i18n="vcalc.run.title">Fuvar-kalkuláció</span></h2>
      <p class="text-muted" data-i18n="vcalc.run.hint">Válassz forrást: kézzel írsz be mindent, VAGY egy meglévő fuvarból (Vallorsoft-adatokból) töltjük ki. Bármit felül tudsz írni számítás előtt.</p>

      <div class="glass-soft" style="padding:12px;margin:12px 0;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <b data-i18n="vcalc.run.source">Adatforrás:</b>
        <label style="cursor:pointer"><input type="radio" name="vcSrc" value="manual" checked> <span data-i18n="vcalc.run.srcManual">Manuális bevitel</span></label>
        <label style="cursor:pointer"><input type="radio" name="vcSrc" value="vallorsoft"> <span data-i18n="vcalc.run.srcVs">Vallorsoft-fuvar</span></label>
        <div id="vcOrderPickerBox" style="display:none;flex:1 1 100%">
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <input id="vcOrderSearch" class="input" style="flex:0 1 220px" placeholder="${esc(t('vcalc.run.orderSearchPh', '🔎 Keresés (szám, ügyfél, város)'))}">
            <select id="vcOrderPicker" style="flex:1 1 260px"><option value="">${t('vcalc.run.pickOrder', '— Válassz fuvart —')}</option></select>
          </div>
          <div class="text-muted" style="font-size:12px;margin-top:4px" data-i18n="vcalc.run.multiHint">Több fuvart is kiválaszthatsz — összevonva számolunk (km, útdíj és bevétel összeadva, az időszak a fuvarok dátumaiból).</div>
          <div id="vcOrderChips" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"></div>
        </div>
      </div>

      <div id="vcFormBody">${t('vcalc.loading', 'Betöltés…')}</div>
    </div>`;

    box.querySelectorAll('input[name="vcSrc"]').forEach(r => r.onchange = onSourceModeChange);
    document.getElementById('vcOrderPicker').onchange = onOrderPicked;
    document.getElementById('vcOrderSearch').oninput = fillOrderPicker;
    renderCalcBody();
    if (window.I18N && window.I18N.apply) window.I18N.apply();

    // Fuvar ⋯ menüből érkeztünk („🧮 Költség-kalkuláció") → azonnal fuvar-módba
    // váltunk és betöltjük a kiválasztott fuvart.
    if (STATE.pendingOrderId) {
      const oid = STATE.pendingOrderId; STATE.pendingOrderId = null;
      const radio = box.querySelector('input[name="vcSrc"][value="vallorsoft"]');
      if (radio) radio.checked = true;
      await onSourceModeChange({ target: { value: 'vallorsoft' } });
      F.order_ids = [oid];
      await reloadOrders();
    }
  }

  // Fuvar ⋯ menü → Költség-kalkuláció az adott fuvarra
  window.vcalcOpenForOrder = function (orderId) {
    if (!orderId) return;
    STATE.pendingOrderId = String(orderId);
    STATE.orders = null; // friss fuvar-lista (az új fuvar is legyen benne)
    if (typeof window.activateTab === 'function') window.activateTab('vcalc-run');
    else renderCalcForm();
  };

  function _orderLabel(o) {
    const no = o.fuvar_no || o.id;
    const km = Number(o.km) > 0 ? Number(o.km) : (Number(o.route_km) > 0 ? Number(o.route_km) : null);
    return [no, o.data_incarcare || '', o.client || '',
      (o.loc_incarcare || '') + ' → ' + (o.loc_descarcare || ''),
      km ? fmt(km, 0) + ' km' : t('vcalc.run.noKm', 'nincs km')].filter(Boolean).join(' · ');
  }

  // A fuvar-választó feltöltése (keresés szerint szűrve, a már kiválasztottak nélkül).
  function fillOrderPicker() {
    const sel = document.getElementById('vcOrderPicker'); if (!sel) return;
    const q = ((document.getElementById('vcOrderSearch') || {}).value || '').trim().toLowerCase();
    const list = (STATE.orders || []).filter(o => !F.order_ids.includes(o.id))
      .filter(o => !q || _orderLabel(o).toLowerCase().includes(q) || String(o.id).toLowerCase().includes(q));
    sel.innerHTML = `<option value="">${t(F.order_ids.length ? 'vcalc.run.addOrder' : 'vcalc.run.pickOrder', F.order_ids.length ? '➕ Újabb fuvar hozzáadása' : '— Válassz fuvart —')}</option>` +
      list.map(o => `<option value="${esc(o.id)}">${esc(_orderLabel(o))}</option>`).join('');
  }

  function renderOrderChips() {
    const el = document.getElementById('vcOrderChips'); if (!el) return;
    const info = {}; (F.orders_info || []).forEach(o => { info[o.id] = o; });
    el.innerHTML = F.order_ids.map(id => {
      const o = info[id] || {};
      return `<span class="badge info" style="display:inline-flex;align-items:center;gap:6px;padding:4px 8px">🚚 ${esc(o.fuvar_no || id)}${o.km ? ' · ' + fmt(o.km, 0) + ' km' : ''}
        <button class="btn small ghost" data-rm-order="${esc(id)}" style="padding:0 6px;min-height:0" title="✕">✕</button></span>`;
    }).join('');
    el.querySelectorAll('[data-rm-order]').forEach(b => b.onclick = async () => {
      F.order_ids = F.order_ids.filter(x => x !== b.dataset.rmOrder);
      await reloadOrders();
    });
  }

  async function onSourceModeChange(e) {
    F.source_mode = e.target.value;
    const pickerBox = document.getElementById('vcOrderPickerBox');
    if (F.source_mode === 'vallorsoft') {
      pickerBox.style.display = 'block';
      if (!STATE.orders) {
        const r = await gas('vcalcOrderPicker', [{}]);
        STATE.orders = (r && r.ok) ? r.orders : [];
      }
      fillOrderPicker(); renderOrderChips();
    } else {
      pickerBox.style.display = 'none';
      // Manuális módban a kalkuláció nem kötődik fuvarhoz.
      F.order_ids = []; F.orders_info = []; F.orders_totals = null; F.auto_km = null;
      F.tolls = F.tolls.filter(x => !x.auto);
      renderCalcBody();
    }
  }

  async function onOrderPicked(e) {
    const orderId = e.target.value;
    if (!orderId || F.order_ids.includes(orderId)) return;
    F.order_ids.push(orderId);
    await reloadOrders();
  }

  // A kiválasztott fuvar(ok) ÖSSZEVONT előtöltése. A fuvarokból jövő adatok
  // felülírják az űrlapot; ami nem derül ki (jármű/sofőr/bevétel), az ÜRÜL, hogy
  // egy korábbi fuvar adatai ne ragadjanak benne. A beírt km NEM íródik felül
  // (üresen hagyva a fuvarok km-összegével számolunk). Kézi útdíj-sorok maradnak.
  async function reloadOrders() {
    if (!F.order_ids.length) {
      F.orders_info = []; F.orders_totals = null; F.auto_km = null;
      F.tolls = F.tolls.filter(x => !x.auto);
      fillOrderPicker(); renderOrderChips(); renderCalcBody();
      return;
    }
    const r = await gas('vcalcPrefillFromOrders', [{ order_ids: F.order_ids }]);
    if (!r || !r.ok) { alert(r && r.err || 'Hiba a fuvar betöltésekor'); F.order_ids.pop(); fillOrderPicker(); renderOrderChips(); return; }
    const tot = r.totals || {};
    F.orders_info = r.orders || [];
    F.orders_totals = tot;
    F.auto_km = tot.km || null;
    F.period_from = r.period_from || F.period_from;
    F.period_to = r.period_to || F.period_from;
    F.trip_days = r.trip_days || 1;
    F.truck_vehicle_id = r.truck ? r.truck.id : '';
    F.trailer_vehicle_id = r.trailer ? r.trailer.id : '';
    F.driver_ids = (r.drivers || []).map(d => d.id);
    if (r.truck && Number(r.truck.fuel_per_100km) > 0) F.fuel_l_per_100km = Number(r.truck.fuel_per_100km);
    if (r.fuel_price_gross && !F.fuel_price_gross) F.fuel_price_gross = r.fuel_price_gross;
    F.active_trucks = r.active_trucks || F.active_trucks;
    F.bnr_eur_lei = r.bnr_eur_lei || F.bnr_eur_lei;
    // Útdíj: a fuvarokon már elmentett becslés (fuvaronként egy sor); a kézi sorok maradnak.
    F.tolls = F.tolls.filter(x => !x.auto).concat(F.orders_info.filter(o => o.toll_cost_eur).map(o => ({
      auto: true, order_id: o.id, input_currency: 'eur', amount: o.toll_cost_eur,
      description: t('vcalc.run.tollFromOrder', 'Útdíj (fuvar becslés)') + ' — ' + (o.fuvar_no || o.id),
    })));
    // A fuvar ára a rendszerben NETTÓ EUR (több fuvarnál összeadva).
    F.freight_revenue_input = tot.pret != null ? Math.round(tot.pret * 100) / 100 : '';
    F.freight_revenue_currency = 'eur'; F.freight_revenue_is_gross = false;
    const first = F.orders_info[0] || {};
    F.name = F.orders_info.length === 1
      ? (first.fuvar_no || first.id) + (first.ref ? ' — ' + first.ref : '')
      : F.orders_info.length + ' ' + t('vcalc.run.ordersShort', 'fuvar') + ' · ' + (F.period_from || '') + (F.period_to && F.period_to !== F.period_from ? ' → ' + F.period_to : '');
    fillOrderPicker(); renderOrderChips(); renderCalcBody();
  }

  // 🛣️ Útdíj fuvaronként az útvonalból — HERE („Pontos") vagy ingyenes becslés.
  async function calcTollsForOrders() {
    if (!F.order_ids.length) return;
    const btn = document.getElementById('vcTollCalc');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ ' + t('vcalc.loading', 'Betöltés…'); }
    const r = await gas('vcalcEstimateTolls', [{ order_ids: F.order_ids, precise: !!F.toll_precise }]);
    if (!r || !r.ok) { alert(r && r.err || 'Hiba'); renderCalcBody(); return; }
    const info = {}; (F.orders_info || []).forEach(o => { info[o.id] = o; });
    const errs = [];
    const autoLines = [];
    (r.items || []).forEach(it => {
      if (!it.ok) { errs.push((it.fuvar_no || it.order_id) + ': ' + it.err); return; }
      const src = it.source === 'here' ? 'HERE' : t('vcalc.run.tollEstimate', 'becslés');
      autoLines.push({ auto: true, order_id: it.order_id, input_currency: String(it.currency || 'EUR').toLowerCase() === 'eur' ? 'eur' : 'lei',
        amount: it.amount, description: t('vcalc.run.tollShort', 'Útdíj') + ' — ' + (it.fuvar_no || it.order_id) + ' (' + src + ')' });
      if (F.toll_precise && it.source !== 'here') errs.push((it.fuvar_no || it.order_id) + ': ' + t('vcalc.run.hereUnavail', 'HERE nem elérhető — becslés'));
    });
    // A sikertelen fuvarok korábbi (fuvaron mentett) sora megmarad.
    const okIds = autoLines.map(l => l.order_id);
    F.tolls = F.tolls.filter(x => !x.auto || !okIds.includes(x.order_id)).concat(autoLines);
    renderCalcBody();
    if (errs.length) alert(errs.join('\n'));
  }

  function renderCalcBody() {
    const body = document.getElementById('vcFormBody'); if (!body) return;
    const refs = STATE.refs || { vehicles: [], drivers: [] };
    body.innerHTML = `${_orderInfoHtml()}
      <div class="glass-soft" style="padding:14px;margin:12px 0">
        <b data-i18n="vcalc.run.bnrLabel">BNR EUR/LEI árfolyam</b>
        <input id="vcBnr" class="input" type="number" step="0.0001" value="${F.bnr_eur_lei}" style="width:140px;display:inline-block;margin-left:8px">
        <span class="text-muted" style="margin-left:8px">1 EUR = <b id="vcBnrShow">${fmt(F.bnr_eur_lei, 4)}</b> LEI</span>
      </div>

      <div class="glass-soft" style="padding:14px;margin:12px 0">
        <h3 data-i18n="vcalc.run.vehSec">Jármű + sofőr</h3>
        <div class="grid-2">
          <div class="field"><label data-i18n="vcalc.run.truck">Vontató</label>
            <div style="display:flex;gap:6px;align-items:center">
              <select id="vcTruck" style="flex:1"><option value="">—</option>${refs.vehicles.map(v => `<option value="${v.id}"${String(F.truck_vehicle_id) === String(v.id) ? ' selected' : ''}>${esc(v.rendszam)} — ${esc(v.marca || '')}</option>`).join('')}</select>
              <button class="btn small" id="vcAutoPair" title="${t('vcalc.run.autoPairHint', 'Kiválasztott vontatóból: pótkocsi + sofőr auto-kitöltés')}" data-i18n="vcalc.run.autoPair">🔗 Auto-párosítás</button>
            </div>
          </div>
          <div class="field"><label data-i18n="vcalc.run.trailer">Pótkocsi</label>
            <select id="vcTrailer"><option value="">—</option>${refs.vehicles.map(v => `<option value="${v.id}"${String(F.trailer_vehicle_id) === String(v.id) ? ' selected' : ''}>${esc(v.rendszam)}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label data-i18n="vcalc.run.drivers">Sofőr(ök)</label>
          <div id="vcDrvBadges" style="display:flex;flex-wrap:wrap;gap:6px">
            ${refs.drivers.map(d => `<label class="badge" style="cursor:pointer"><input type="checkbox" data-drv="${d.id}"${F.driver_ids.includes(d.id) ? ' checked' : ''}> ${esc(d.nume || d.email)}</label>`).join('')}
          </div>
        </div>
      </div>

      <div class="glass-soft" style="padding:14px;margin:12px 0">
        <h3 data-i18n="vcalc.run.tripSec">Fuvar adatok</h3>
        <div class="text-muted" style="font-size:12px;margin-bottom:6px" data-i18n="vcalc.run.periodHint">Időszak: mettől meddig tartott a munka (pl. 2 fuvar egy hét alatt). A napok száma ebből számolódik, de átírható.</div>
        <div class="grid-4">
          <div class="field"><label data-i18n="vcalc.run.periodFrom">Időszak kezdete</label><input id="vcStart" class="input" type="date" value="${esc(F.period_from || '')}"></div>
          <div class="field"><label data-i18n="vcalc.run.periodTo">Időszak vége</label><input id="vcEnd" class="input" type="date" value="${esc(F.period_to || '')}"></div>
          <div class="field"><label data-i18n="vcalc.run.tripDays">Napok száma *</label><input id="vcDays" class="input" type="number" min="1" value="${F.trip_days}"></div>
          <div class="field"><label data-i18n="vcalc.run.tripKm">Kilométer *</label><input id="vcKm" class="input" type="number" value="${esc(F.trip_km)}" placeholder="${F.auto_km ? esc(String(Math.round(F.auto_km))) : '2800'}">
            ${F.auto_km ? `<div class="text-muted" style="font-size:11.5px;margin-top:3px">${t('vcalc.run.kmAutoHint', 'Üresen hagyva a fuvarok km-ével számol')}: <b>${fmt(F.auto_km, 0)} km</b></div>` : ''}</div>
        </div>
      </div>

      <div class="glass-soft" style="padding:14px;margin:12px 0">
        <h3 data-i18n="vcalc.run.fuelSec">Üzemanyag</h3>
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <button class="btn ${F.fuel_method === 'per_liter' ? 'primary' : 'ghost'}" data-fm="per_liter" data-i18n="vcalc.run.fmPerL">L/100km alapján</button>
          <button class="btn ${F.fuel_method === 'fixed' ? 'primary' : 'ghost'}" data-fm="fixed" data-i18n="vcalc.run.fmFixed">Fix összeg (bruttó)</button>
        </div>
        <div id="vcFuelBody"></div>
      </div>

      <div class="glass-soft" style="padding:14px;margin:12px 0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 data-i18n="vcalc.run.tollSec">Útdíjak / extra</h3>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            ${F.order_ids.length ? `<label style="font-size:12.5px;cursor:pointer"><input type="checkbox" id="vcTollPrecise"${F.toll_precise ? ' checked' : ''}> ${t('vcalc.run.tollPrecise', '🎯 Pontos (HERE)')}</label>
            <button class="btn small primary" id="vcTollCalc">${t('vcalc.run.tollCalc', '🛣️ Útdíj számítása a fuvarokból')}</button>` : ''}
            <button class="btn small" id="vcTollAdd" data-i18n="vcalc.run.tollAdd">+ Hozzáadás</button>
          </div>
        </div>
        ${F.order_ids.length ? `<div class="text-muted" style="font-size:12px;margin:4px 0" data-i18n="vcalc.run.tollHint">Az útdíj fuvaronként az útvonalból számolódik (HERE, ha be van állítva; különben becslés). Kézzel is hozzáadhatsz sort.</div>` : ''}
        <div id="vcTolls"></div>
      </div>

      <div class="glass-soft" style="padding:14px;margin:12px 0">
        <label data-i18n="vcalc.run.activeTrucks">Aktív vontatók (cég-költség szétosztás)</label>
        <input id="vcActive" class="input" type="number" min="1" value="${F.active_trucks}" style="width:120px;display:inline-block;margin-left:8px">
      </div>

      <div class="glass-soft" style="padding:14px;margin:12px 0">
        <h3 data-i18n="vcalc.run.revSec">Bevétel / fuvar-díj (opcionális)</h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <input id="vcRev" class="input" type="number" step="0.01" value="${F.freight_revenue_input}" placeholder="pl. 3200" style="flex:1;min-width:140px">
          <select id="vcRevCur" style="width:100px"><option value="lei"${F.freight_revenue_currency === 'lei' ? ' selected' : ''}>LEI</option><option value="eur"${F.freight_revenue_currency === 'eur' ? ' selected' : ''}>EUR</option></select>
          <button class="btn ${F.freight_revenue_is_gross ? 'primary' : 'ghost'}" data-rev="true" data-i18n="vcalc.f.gross">Bruttó</button>
          <button class="btn ${!F.freight_revenue_is_gross ? 'primary' : 'ghost'}" data-rev="false" data-i18n="vcalc.f.net">Nettó</button>
        </div>
      </div>

      <div style="display:flex;gap:8px;margin:12px 0">
        <button class="btn primary" id="vcCalc" data-i18n="vcalc.run.calc">Kalkulálás</button>
        <input id="vcName" class="input" value="${esc(F.name)}" placeholder="${t('vcalc.run.namePh', 'Számítás neve (opcionális, mentéshez)')}" style="flex:1">
        <button class="btn ok" id="vcSave" data-i18n="vcalc.run.save">Mentés</button>
      </div>
      <div id="vcResult"></div>`;

    // hook mezők
    body.querySelector('#vcBnr').oninput = e => { F.bnr_eur_lei = Number(e.target.value) || 0; body.querySelector('#vcBnrShow').textContent = fmt(F.bnr_eur_lei, 4); };
    body.querySelector('#vcTruck').onchange = e => F.truck_vehicle_id = e.target.value ? Number(e.target.value) : '';
    body.querySelector('#vcTrailer').onchange = e => F.trailer_vehicle_id = e.target.value ? Number(e.target.value) : '';
    body.querySelectorAll('[data-drv]').forEach(cb => cb.onchange = () => {
      const id = Number(cb.dataset.drv);
      if (cb.checked && !F.driver_ids.includes(id)) F.driver_ids.push(id);
      if (!cb.checked) F.driver_ids = F.driver_ids.filter(x => x !== id);
    });
    // Időszak → napok száma (a beírt napszám átírható; dátum-változáskor újraszámol).
    const syncDays = () => {
      if (F.period_from && F.period_to && F.period_to >= F.period_from) {
        F.trip_days = Math.round((Date.parse(F.period_to + 'T00:00:00Z') - Date.parse(F.period_from + 'T00:00:00Z')) / 86400000) + 1;
        body.querySelector('#vcDays').value = F.trip_days;
      }
    };
    body.querySelector('#vcStart').oninput = e => { F.period_from = e.target.value; if (!F.period_to || F.period_to < F.period_from) { F.period_to = F.period_from; body.querySelector('#vcEnd').value = F.period_to; } syncDays(); };
    body.querySelector('#vcEnd').oninput = e => { F.period_to = e.target.value; syncDays(); };
    body.querySelector('#vcDays').oninput = e => F.trip_days = Number(e.target.value) || 1;
    body.querySelector('#vcKm').oninput = e => F.trip_km = e.target.value;
    body.querySelector('#vcActive').oninput = e => F.active_trucks = Number(e.target.value) || 1;
    body.querySelector('#vcRev').oninput = e => F.freight_revenue_input = e.target.value;
    body.querySelector('#vcRevCur').onchange = e => F.freight_revenue_currency = e.target.value;
    body.querySelectorAll('[data-rev]').forEach(b => b.onclick = () => { F.freight_revenue_is_gross = b.dataset.rev === 'true'; renderCalcBody(); });
    body.querySelector('#vcName').oninput = e => F.name = e.target.value;
    body.querySelectorAll('[data-fm]').forEach(b => b.onclick = () => { F.fuel_method = b.dataset.fm; renderCalcBody(); });
    body.querySelector('#vcTollAdd').onclick = () => { F.tolls.push({ description: '', amount: '', input_currency: 'eur' }); renderCalcBody(); };
    const tp = body.querySelector('#vcTollPrecise'); if (tp) tp.onchange = e => F.toll_precise = e.target.checked;
    const tc = body.querySelector('#vcTollCalc'); if (tc) tc.onclick = calcTollsForOrders;
    body.querySelector('#vcCalc').onclick = () => runCalc(false);
    body.querySelector('#vcSave').onclick = () => runCalc(true);
    const apBtn = body.querySelector('#vcAutoPair'); if (apBtn) apBtn.onclick = autoPairFromTruck;
    renderFuelBody(); renderTolls();
    if (window.I18N && window.I18N.apply) window.I18N.apply();
  }

  // A betöltött fuvar(ok) összegzése + figyelmeztetések (hiányzó km/ár/jármű, Extern)
  function _orderInfoHtml() {
    const list = F.orders_info || [];
    if (!list.length || !F.order_ids.length) return '';
    const tot = F.orders_totals || {};
    const no = (o) => esc(o.fuvar_no || o.id);
    const warn = [];
    const noKm = list.filter(o => !o.km), routeKm = list.filter(o => o.km && o.km_source === 'route');
    if (noKm.length) warn.push(t('vcalc.run.warnNoKmMulti', 'Nincs km-érték') + ': ' + noKm.map(no).join(', ') + ' — ' + t('vcalc.run.warnNoKmFix', 'írd be az összes km-t kézzel.'));
    if (routeKm.length) warn.push(t('vcalc.run.kmFromRouteMulti', 'A km a térképes útvonal-becslésből') + ': ' + routeKm.map(no).join(', '));
    if (!F.truck_vehicle_id && list.some(o => !o.is_extern)) warn.push(t('vcalc.run.warnNoTruck', 'A fuvar vontatója nincs a járművek között — válaszd ki kézzel.'));
    const trucks = [...new Set(list.map(o => o.rendszam_camion).filter(Boolean))];
    if (trucks.length > 1) warn.push(t('vcalc.run.warnMultiTruck', 'A fuvarokat különböző vontatók vitték') + ': ' + trucks.map(esc).join(', ') + ' — ' + t('vcalc.run.warnMultiTruck2', 'a kalkuláció egy vontató költségeivel számol.'));
    const noPrice = list.filter(o => o.pret == null);
    if (noPrice.length) warn.push(t('vcalc.run.warnNoPriceMulti', 'Nincs ár') + ': ' + noPrice.map(no).join(', '));
    const ext = list.filter(o => o.is_extern);
    if (ext.length) warn.push(t('vcalc.run.warnExtern', 'Extern (alvállalkozós) fuvar — a saját jármű-költség nem releváns.') + ' (' + ext.map(no).join(', ') + ')' +
      (tot.carrier_cost_eur ? ' ' + t('vcalc.run.carrierCost', 'Alvállalkozói díj') + ': <b>' + fmt(tot.carrier_cost_eur) + ' EUR</b>' : ''));
    const rows = list.map(o => `<div style="font-size:13px;margin-top:3px">🚚 <b>${no(o)}</b>${o.client ? ' · ' + esc(o.client) : ''} · ${esc(o.loc_incarcare || '—')} → ${esc(o.loc_descarcare || '—')}
        <span class="text-muted">${o.data_incarcare ? ' · 📅 ' + esc(o.data_incarcare) + (o.data_descarcare && o.data_descarcare !== o.data_incarcare ? ' → ' + esc(o.data_descarcare) : '') : ''}
        ${o.km ? ' · ' + fmt(o.km, 0) + ' km' : ''}${o.pret != null ? ' · 💶 ' + fmt(o.pret) + ' EUR' : ''}</span></div>`).join('');
    const sumLine = list.length > 1 ? `<div style="margin-top:6px;font-weight:700">Σ ${list.length} ${t('vcalc.run.ordersShort', 'fuvar')} · ${tot.km ? fmt(tot.km, 0) + ' km' : '—'}${tot.pret != null ? ' · ' + fmt(tot.pret) + ' EUR ' + t('vcalc.f.net', 'Nettó').toLowerCase() : ''}</div>` : '';
    return `<div class="glass-soft" style="padding:12px 14px;margin:12px 0;border-left:4px solid var(--status-info,#3b82f6)">
      ${rows}${sumLine}
      ${warn.map(w => `<div style="font-size:12.5px;margin-top:6px;color:var(--status-warn,#b45309)">⚠️ ${w}</div>`).join('')}
    </div>`;
  }

  function renderFuelBody() {
    const el = document.getElementById('vcFuelBody'); if (!el) return;
    if (F.fuel_method === 'per_liter') {
      el.innerHTML = `<div class="grid-2">
        <div class="field"><label data-i18n="vcalc.run.fuelL">Fogyasztás (L/100km)</label><input id="vcFuelL" class="input" type="number" step="0.1" value="${F.fuel_l_per_100km}"></div>
        <div class="field"><label data-i18n="vcalc.run.fuelP">Diesel ár (LEI/liter, bruttó)</label><input id="vcFuelP" class="input" type="number" step="0.01" value="${F.fuel_price_gross}" placeholder="7.55"></div>
      </div>
      <div style="margin-top:8px">${discountCheckboxes()}</div>`;
      el.querySelector('#vcFuelL').oninput = e => F.fuel_l_per_100km = Number(e.target.value) || 0;
      el.querySelector('#vcFuelP').oninput = e => F.fuel_price_gross = e.target.value;
    } else {
      el.innerHTML = `<div class="field"><label data-i18n="vcalc.run.fuelTotal">Összes üzemanyag költség (LEI, bruttó)</label>
        <input id="vcFuelTot" class="input" type="number" step="0.01" value="${F.fuel_total_gross}" placeholder="pl. 3200"></div>
        <div style="margin-top:8px">${discountCheckboxes()}</div>`;
      el.querySelector('#vcFuelTot').oninput = e => F.fuel_total_gross = e.target.value;
    }
    el.querySelectorAll('[data-disc]').forEach(cb => cb.onchange = () => {
      if (cb.dataset.disc === 'ex') F.excisa_applied = cb.checked;
      if (cb.dataset.disc === 'fd') F.fuel_discount_applied = cb.checked;
    });
    if (window.I18N && window.I18N.apply) window.I18N.apply();
  }

  function discountCheckboxes() {
    const s = STATE.settings || {};
    let h = '';
    if (s.excisa_discount_lei) h += `<label style="display:block;margin:4px 0"><input type="checkbox" data-disc="ex"${F.excisa_applied ? ' checked' : ''}> ${t('vcalc.run.excisa', 'Acciza kedvezmény')} (${fmt(s.excisa_discount_lei)} LEI)</label>`;
    if (s.fuel_discount_lei) h += `<label style="display:block;margin:4px 0"><input type="checkbox" data-disc="fd"${F.fuel_discount_applied ? ' checked' : ''}> ${t('vcalc.run.fuelDisc', 'Üzemanyag kedvezmény')} (${fmt(s.fuel_discount_lei)} LEI)</label>`;
    if (!h) h = `<p class="text-muted" style="font-size:12px" data-i18n="vcalc.run.noDisc">Nincs beállított kedvezmény (⚙️ Kalkulátor-beállítások).</p>`;
    return h;
  }

  function renderTolls() {
    const el = document.getElementById('vcTolls'); if (!el) return;
    if (!F.tolls.length) { el.innerHTML = `<p class="text-muted" style="font-size:12px" data-i18n="vcalc.run.noTolls">Nincs útdíj.</p>`; return; }
    el.innerHTML = F.tolls.map((t, i) => `<div style="display:flex;gap:6px;align-items:center;margin:4px 0">
      <input class="input" data-toll-desc="${i}" value="${esc(t.description)}" placeholder="Megnevezés" style="flex:1">
      <input class="input" data-toll-amt="${i}" type="number" step="0.01" value="${t.amount}" style="width:120px">
      <select data-toll-cur="${i}" style="width:80px"><option value="eur"${t.input_currency === 'eur' ? ' selected' : ''}>EUR</option><option value="lei"${t.input_currency === 'lei' ? ' selected' : ''}>LEI</option></select>
      <button class="btn small danger" data-toll-del="${i}">×</button></div>`).join('');
    el.querySelectorAll('[data-toll-desc]').forEach(x => x.oninput = e => F.tolls[Number(e.target.dataset.tollDesc)].description = e.target.value);
    el.querySelectorAll('[data-toll-amt]').forEach(x => x.oninput = e => F.tolls[Number(e.target.dataset.tollAmt)].amount = e.target.value);
    el.querySelectorAll('[data-toll-cur]').forEach(x => x.onchange = e => F.tolls[Number(e.target.dataset.tollCur)].input_currency = e.target.value);
    el.querySelectorAll('[data-toll-del]').forEach(x => x.onclick = e => { F.tolls.splice(Number(e.target.dataset.tollDel), 1); renderTolls(); });
  }

  async function runCalc(save) {
    if (!(Number(F.trip_km) > 0) && !(Number(F.auto_km) > 0)) { alert(t('vcalc.run.errKm', 'Kilométer kötelező')); return; }
    if (F.fuel_method === 'per_liter' && !(Number(F.fuel_price_gross) > 0) &&
        !confirm(t('vcalc.run.confirmNoFuel', 'Nincs megadva gázolaj-ár — az üzemanyag 0-val számolódik. Folytatod?'))) return;
    const payload = { ...F, save, start_date: F.period_from || null,
      // A beírt km elsőbbséget élvez; üresen a szerver a fuvarok km-összegével számol.
      trip_km: Number(F.trip_km) > 0 ? F.trip_km : '' };
    delete payload.orders_info; delete payload.orders_totals; delete payload.auto_km;
    const r = await gas('vcalcCalculate', [payload]);
    if (!r || !r.ok) { alert(r && r.err || 'Hiba'); return; }
    renderResult(r.result, r.serial_no);
    if (save && r.serial_no) alert(t('vcalc.run.saved', 'Mentve') + ': ' + r.serial_no);
  }

  function _resultTableHtml(res) {
    const lines = (res.lines || []).map(l => `<tr><td>${esc(l.name)}</td><td>${fmt(l.netLei)}</td><td>${fmt(l.vatLei)}</td><td>${fmt(l.grossLei)}</td></tr>`).join('');
    const profitHtml = res.profitNet != null ? `<tr class="${res.profitNet >= 0 ? 'ok' : 'danger'}"><td colspan="2"><b>${t('vcalc.res.profit', 'Profit')}</b></td>
      <td colspan="2"><b>${fmt(res.profitNet)} LEI · ${fmt(res.profitEur)} EUR</b></td></tr>` : '';
    return `<table class="table"><thead><tr><th data-i18n="vcalc.res.item">Tétel</th><th>Nettó LEI</th><th>ÁFA LEI</th><th>Bruttó LEI</th></tr></thead>
      <tbody>${lines}
        <tr><td><b>${t('vcalc.res.fuel', 'Üzemanyag')}</b></td><td>${fmt(res.fuelNet)}</td><td>${fmt(res.fuelVat)}</td><td>${fmt(res.fuelGross)}</td></tr>
        ${res.discountNet ? `<tr><td>${t('vcalc.res.discount', 'Kedvezmény')}</td><td>-${fmt(res.discountNet)}</td><td>0</td><td>-${fmt(res.discountNet)}</td></tr>` : ''}
        <tr><td>${t('vcalc.res.tolls', 'Útdíjak (nettó)')}</td><td>${fmt(res.tollNet)}</td><td>—</td><td>—</td></tr>
        <tr style="font-weight:800"><td>${t('vcalc.res.total', 'Összesen')}</td><td>${fmt(res.totalNet)}</td><td>${fmt(res.totalVat)}</td><td>${fmt(res.totalGross)}</td></tr>
        <tr class="text-muted"><td colspan="2">EUR-ban</td><td colspan="2">${fmt(res.totalNetEur)} nettó · ${fmt(res.totalGrossEur)} bruttó</td></tr>
        ${profitHtml}
      </tbody></table>`;
  }

  function renderResult(res, serial, meta) {
    const el = document.getElementById('vcResult'); if (!el) return;
    STATE.lastResult = { res, serial: serial || '', meta: meta || null };
    el.innerHTML = `<div class="glass-soft" style="padding:14px;margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0">${t('vcalc.res.title', 'Eredmény')} ${serial ? `<span class="badge">${esc(serial)}</span>` : ''}</h3>
        <div style="display:flex;gap:6px">
          <button class="btn small" id="vcPrintPdf" data-i18n="vcalc.res.printPdf">📄 PDF letöltés</button>
        </div>
      </div>
      ${_resultTableHtml(res)}</div>`;
    const b = document.getElementById('vcPrintPdf');
    if (b) b.onclick = () => exportResultToPdf(STATE.lastResult);
    if (window.I18N && window.I18N.apply) window.I18N.apply();
  }

  // ─── Auto-párosítás vontatóból (assigned_driver_email + default_trailer_id) ─
  function autoPairFromTruck() {
    const refs = STATE.refs || { vehicles: [], drivers: [] };
    if (!F.truck_vehicle_id) { alert(t('vcalc.run.errPickTruck', 'Előbb válassz vontatót')); return; }
    const truck = refs.vehicles.find(v => String(v.id) === String(F.truck_vehicle_id));
    if (!truck) return;
    const changes = [];
    // Pótkocsi
    if (truck.default_trailer_id) {
      const tr = refs.vehicles.find(v => String(v.id) === String(truck.default_trailer_id));
      if (tr) { F.trailer_vehicle_id = tr.id; changes.push('🚛 ' + tr.rendszam); }
    }
    // Sofőr (assigned_driver_email → driver id)
    if (truck.assigned_driver_email) {
      const drv = refs.drivers.find(d => (d.email || '').toLowerCase() === String(truck.assigned_driver_email).toLowerCase());
      if (drv && !F.driver_ids.includes(drv.id)) { F.driver_ids.push(drv.id); changes.push('👤 ' + (drv.nume || drv.email)); }
    }
    // Alap fogyasztás
    if (truck.fuel_per_100km && !F.fuel_l_per_100km) { F.fuel_l_per_100km = truck.fuel_per_100km; changes.push('⛽ ' + truck.fuel_per_100km + ' L/100km'); }
    if (!changes.length) alert(t('vcalc.run.autoPairNone', 'Ehhez a vontatóhoz nincs beállítva pár (Belső sofőrök fülön a jármű-modálban állítható).'));
    else alert(t('vcalc.run.autoPairDone', 'Auto-kitöltve: ') + changes.join(', '));
    renderCalcBody();
  }

  // ─── Saved calc — detail modal ─────────────────────────────
  async function openSavedDetail(id) {
    const r = await gas('vcalcCalcGet', [{ id: Number(id) }]);
    if (!r || !r.ok) { alert(r && r.err || 'Hiba'); return; }
    const c = r.calc || {};
    const res = c.result_json || {};
    const meta = { serial: c.serial_no || '', name: c.name || '', trip_km: c.trip_km, trip_days: c.trip_days, created_at: c.created_at, order_id: c.order_id || '' };
    const back = document.createElement('div'); back.className = 'modal-back'; back.style.zIndex = 10010;
    back.innerHTML = `<div class="modal glass" style="max-width:820px;max-height:90vh;overflow:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <h3 style="margin:0">💾 ${esc(c.name || t('vcalc.saved.title','Mentett kalkuláció'))} <span class="badge">${esc(c.serial_no || '')}</span></h3>
        <div style="display:flex;gap:6px">
          <button class="btn small" id="vcdPdf">📄 PDF</button>
          <button class="btn small ghost" id="vcdClose">✕</button>
        </div>
      </div>
      <div class="text-muted" style="font-size:12px;margin-bottom:8px">
        ${new Date(c.created_at).toLocaleString('ro-RO')} · ${fmt(c.trip_km, 0)} km · ${c.trip_days} ${t('vcalc.res.days','nap')}${(Array.isArray(c.order_ids) && c.order_ids.length > 1) ? ' · ' + c.order_ids.map(x => '<span class="badge">'+esc(x)+'</span>').join(' ') : (c.order_id ? ' · <span class="badge">'+esc(c.order_id)+'</span>' : '')}${c.period_from ? ' · 📅 ' + esc(String(c.period_from).slice(0,10)) + (c.period_to ? ' → ' + esc(String(c.period_to).slice(0,10)) : '') : ''}
      </div>
      ${_resultTableHtml(res)}
    </div>`;
    document.body.appendChild(back);
    back.querySelector('#vcdClose').onclick = () => back.remove();
    back.onclick = e => { if (e.target === back) back.remove(); };
    back.querySelector('#vcdPdf').onclick = () => exportResultToPdf({ res, serial: c.serial_no || '', meta });
    if (window.I18N && window.I18N.apply) window.I18N.apply();
  }

  // ─── PDF export (pdf-lib) ──────────────────────────────────
  async function exportResultToPdf(pack) {
    if (!pack || !pack.res) { alert('Nincs adat'); return; }
    if (typeof PDFLib === 'undefined') { alert('PDF könyvtár nincs betöltve'); return; }
    const res = pack.res, serial = pack.serial || '', meta = pack.meta || {};
    // ASCII-safe (Helvetica WinAnsi nem tudja az árvíztűrőt)
    const A = s => String(s == null ? '' : s).replace(/ă|â|Ă|Â/g, 'a').replace(/î|Î/g, 'i').replace(/ș|ş|Ș|Ş/g, 's').replace(/ț|ţ|Ț|Ţ/g, 't').replace(/ő|Ő/g, 'o').replace(/ű|Ű/g, 'u').replace(/[^\x00-\x7F]/g, '');
    const pdf = await PDFLib.PDFDocument.create();
    const page = pdf.addPage([595, 842]); // A4
    const font = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
    const bold = await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const black = PDFLib.rgb(0.05, 0.05, 0.05);
    const grey = PDFLib.rgb(0.45, 0.45, 0.45);
    let y = 800;
    const draw = (text, opts) => {
      opts = opts || {};
      page.drawText(A(text), { x: opts.x || 40, y: y, size: opts.size || 10, font: opts.bold ? bold : font, color: opts.color || black });
    };
    // Fejléc
    draw('CALCUL COST FUVAR', { size: 18, bold: true });
    y -= 24;
    if (serial) { draw('Serial: ' + serial, { size: 11, bold: true, color: grey }); y -= 16; }
    if (meta.name) { draw(meta.name, { size: 12 }); y -= 16; }
    const infoLine = [
      meta.trip_km ? (fmt(meta.trip_km, 0) + ' km') : '',
      meta.trip_days ? (meta.trip_days + ' zile') : '',
      meta.order_id ? ('Cursa: ' + meta.order_id) : '',
      meta.created_at ? ('Data: ' + new Date(meta.created_at).toLocaleDateString('ro-RO')) : (new Date().toLocaleDateString('ro-RO'))
    ].filter(Boolean).join(' · ');
    draw(infoLine, { size: 10, color: grey }); y -= 20;
    // Elválasztó vonal
    page.drawLine({ start: { x: 40, y: y }, end: { x: 555, y: y }, thickness: 1, color: grey });
    y -= 18;
    // Tétel-tábla fejléc
    const cols = [{ x: 40, w: 235, label: 'Descriere' }, { x: 275, w: 90, label: 'Net LEI', right: true }, { x: 365, w: 90, label: 'TVA LEI', right: true }, { x: 455, w: 100, label: 'Brut LEI', right: true }];
    cols.forEach(c => page.drawText(A(c.label), { x: c.right ? (c.x + c.w - font.widthOfTextAtSize(A(c.label), 9)) : c.x, y: y, size: 9, font: bold, color: grey }));
    y -= 4;
    page.drawLine({ start: { x: 40, y: y }, end: { x: 555, y: y }, thickness: 0.5, color: grey });
    y -= 12;
    // Sorok
    const drawRow = (name, n, v, g, boldRow) => {
      const f = boldRow ? bold : font;
      page.drawText(A(name), { x: 40, y: y, size: 9, font: f, color: black });
      [{ v: fmt(n), x: cols[1] }, { v: fmt(v), x: cols[2] }, { v: fmt(g), x: cols[3] }].forEach(cell => {
        const w = f.widthOfTextAtSize(cell.v, 9);
        page.drawText(cell.v, { x: cell.x.x + cell.x.w - w, y: y, size: 9, font: f, color: black });
      });
      y -= 13;
      if (y < 80) { const p = pdf.addPage([595, 842]); y = 800; }
    };
    (res.lines || []).forEach(l => drawRow(l.name || '', l.netLei || 0, l.vatLei || 0, l.grossLei || 0));
    drawRow('Combustibil', res.fuelNet || 0, res.fuelVat || 0, res.fuelGross || 0, true);
    if (res.discountNet) drawRow('Discount', -Math.abs(res.discountNet), 0, -Math.abs(res.discountNet));
    if (res.tollNet) { page.drawText(A('Taxe drum (net)'), { x: 40, y: y, size: 9, font: font, color: black });
      const tv = fmt(res.tollNet), tw = font.widthOfTextAtSize(tv, 9);
      page.drawText(tv, { x: cols[1].x + cols[1].w - tw, y: y, size: 9, font: font, color: black }); y -= 13; }
    // Total sor
    page.drawLine({ start: { x: 40, y: y + 4 }, end: { x: 555, y: y + 4 }, thickness: 0.5, color: grey });
    drawRow('TOTAL', res.totalNet || 0, res.totalVat || 0, res.totalGross || 0, true);
    y -= 4;
    draw('In EUR: ' + fmt(res.totalNetEur) + ' net · ' + fmt(res.totalGrossEur) + ' brut', { size: 10, color: grey }); y -= 18;
    // Profit
    if (res.profitNet != null) {
      const pColor = res.profitNet >= 0 ? PDFLib.rgb(0.1, 0.55, 0.15) : PDFLib.rgb(0.75, 0.1, 0.1);
      page.drawText(A('PROFIT: ' + fmt(res.profitNet) + ' LEI  ·  ' + fmt(res.profitEur) + ' EUR'), { x: 40, y: y, size: 13, font: bold, color: pColor });
      y -= 24;
    }
    // Lábléc
    page.drawText(A('Generat de VallorSoft · ' + new Date().toLocaleString('ro-RO')), { x: 40, y: 30, size: 8, font: font, color: grey });
    // Letöltés
    const bytes = await pdf.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'calcul_' + (serial || 'fara-serial') + '.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  // ═══════════════════════════════════════════════════════════
  //  5) MENTETT KALKULÁCIÓK
  // ═══════════════════════════════════════════════════════════
  async function renderSavedList() {
    const box = document.querySelector('.pane[data-pane="vcalc-saved"]');
    if (!box) return;
    box.innerHTML = `<div class="glass"><h2 class="h-title">💾 <span data-i18n="vcalc.saved.title">Mentett kalkulációk</span></h2>
      <div id="vcSavedBox">${t('vcalc.loading', 'Betöltés…')}</div></div>`;
    const r = (await gas('vcalcCalcList', [{}])) || { ok: true, items: [] };
    const items = r.items || [];
    if (!items.length) { document.getElementById('vcSavedBox').innerHTML = `<p class="text-muted" data-i18n="vcalc.saved.none">Még nincs mentett kalkuláció.</p>`; return; }
    document.getElementById('vcSavedBox').innerHTML = `<table class="table"><thead><tr>
      <th>Serial</th><th data-i18n="vcalc.saved.date">Dátum</th><th data-i18n="vcalc.saved.name">Név</th>
      <th data-i18n="vcalc.saved.mode">Forrás</th><th>Km</th><th>Nap</th>
      <th>Total EUR</th><th>Profit EUR</th><th></th></tr></thead>
      <tbody>${items.map(it => `<tr>
        <td><b>${esc(it.serial_no || '')}</b></td>
        <td>${new Date(it.created_at).toLocaleDateString('ro-RO')}</td>
        <td>${esc(it.name || '')}${(Array.isArray(it.order_ids) && it.order_ids.length > 1)
          ? ' <span class="badge">' + it.order_ids.length + ' ' + t('vcalc.run.ordersShort', 'fuvar') + '</span>'
          : (it.order_id ? ' <span class="badge">' + esc(it.order_id) + '</span>' : '')}${it.period_from ? '<div class="text-muted" style="font-size:12px">📅 ' + esc(it.period_from) + (it.period_to && it.period_to !== it.period_from ? ' → ' + esc(it.period_to) : '') + '</div>' : ''}</td>
        <td>${it.source_mode === 'vallorsoft' ? '📥 VS' : '✍️ ' + t('vcalc.saved.manual', 'manuális')}</td>
        <td>${fmt(it.trip_km, 0)}</td><td>${it.trip_days}</td>
        <td>${fmt(it.total_net_eur)}</td>
        <td class="${(it.profit_eur || 0) >= 0 ? 'ok' : 'danger'}">${it.profit_eur != null ? fmt(it.profit_eur) : '—'}</td>
        <td style="white-space:nowrap">
          <button class="btn small" data-cc-open="${it.id}" title="${t('vcalc.saved.open','Megnyitás')}">👁</button>
          <button class="btn small danger" data-cc-del="${it.id}">🗑</button>
        </td></tr>`).join('')}</tbody></table>`;
    document.querySelectorAll('[data-cc-open]').forEach(b => b.onclick = () => openSavedDetail(b.dataset.ccOpen));
    document.querySelectorAll('[data-cc-del]').forEach(b => b.onclick = async () => {
      if (!confirm(t('vcalc.confirmDelete', 'Biztosan törlöd?'))) return;
      const r = await gas('vcalcCalcDelete', [{ id: Number(b.dataset.ccDel) }]);
      if (r && r.ok) renderSavedList();
    });
    if (window.I18N && window.I18N.apply) window.I18N.apply();
  }

  // ═══════════════════════════════════════════════════════════
  //  6) BEÁLLÍTÁSOK
  // ═══════════════════════════════════════════════════════════
  async function renderSettings() {
    const box = document.querySelector('.pane[data-pane="vcalc-settings"]');
    if (!box) return;
    const s = await loadSettings(true);
    const isAdmin = window._meData && window._meData.pozicio === 'Admin';
    box.innerHTML = `<div class="glass"><h2 class="h-title">⚙️ <span data-i18n="vcalc.set.title">Kalkulátor-beállítások</span></h2>
      ${!isAdmin ? `<p class="text-muted" data-i18n="vcalc.set.viewOnly">Csak megtekintés — az Admin módosíthatja.</p>` : ''}
      <div class="grid-2">
        <div class="field"><label data-i18n="vcalc.set.annualKm">Éves km cél</label>
          <input id="vsAnnualKm" class="input" type="number" value="${s.annual_km_target ?? 120000}" ${isAdmin ? '' : 'disabled'}></div>
        <div class="field"><label data-i18n="vcalc.set.weeks">Munkahetek / év</label>
          <input id="vsWeeks" class="input" type="number" value="${s.working_weeks_per_year ?? 48}" ${isAdmin ? '' : 'disabled'}></div>
      </div>
      <div style="margin-top:14px">
        <h3 data-i18n="vcalc.set.excisa">Acciza kedvezmény</h3>
        <div class="grid-2">
          <div class="field"><label data-i18n="vcalc.f.amount">Összeg (LEI)</label>
            <input id="vsExLei" class="input" type="number" step="0.01" value="${s.excisa_discount_lei ?? ''}" ${isAdmin ? '' : 'disabled'}></div>
          <div class="field"><label data-i18n="vcalc.f.type">Típus</label>
            <select id="vsExType" ${isAdmin ? '' : 'disabled'}><option value="gross"${s.excisa_discount_type !== 'net' ? ' selected' : ''}>Bruttó</option><option value="net"${s.excisa_discount_type === 'net' ? ' selected' : ''}>Nettó</option></select></div>
        </div>
      </div>
      <div style="margin-top:14px">
        <h3 data-i18n="vcalc.set.fuelDisc">Üzemanyag kedvezmény</h3>
        <div class="grid-2">
          <div class="field"><label data-i18n="vcalc.f.amount">Összeg (LEI)</label>
            <input id="vsFdLei" class="input" type="number" step="0.01" value="${s.fuel_discount_lei ?? ''}" ${isAdmin ? '' : 'disabled'}></div>
          <div class="field"><label data-i18n="vcalc.f.type">Típus</label>
            <select id="vsFdType" ${isAdmin ? '' : 'disabled'}><option value="gross"${s.fuel_discount_type !== 'net' ? ' selected' : ''}>Bruttó</option><option value="net"${s.fuel_discount_type === 'net' ? ' selected' : ''}>Nettó</option></select></div>
        </div>
      </div>
      ${isAdmin ? `<div style="margin-top:14px"><button class="btn primary" id="vsSave" data-i18n="vcalc.save">Mentés</button></div>` : ''}
    </div>`;
    if (isAdmin) document.getElementById('vsSave').onclick = async () => {
      const p = {
        annual_km_target: Number(document.getElementById('vsAnnualKm').value) || 120000,
        working_weeks_per_year: Number(document.getElementById('vsWeeks').value) || 48,
        excisa_discount_lei: document.getElementById('vsExLei').value ? Number(document.getElementById('vsExLei').value) : null,
        excisa_discount_type: document.getElementById('vsExType').value,
        fuel_discount_lei: document.getElementById('vsFdLei').value ? Number(document.getElementById('vsFdLei').value) : null,
        fuel_discount_type: document.getElementById('vsFdType').value,
      };
      const r = await gas('vcalcSettingsSave', [p]);
      if (r && r.ok) { STATE.settings = r.settings; alert(t('vcalc.set.saved', 'Mentve')); } else alert(r && r.err || 'Hiba');
    };
    if (window.I18N && window.I18N.apply) window.I18N.apply();
  }
})();
