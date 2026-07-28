// ============================================================
//  VallorSoft — sofer.js
//  Kivágva a sofer.html inline <script> blokkjaiból, BÁJTRA AZONOS.
// ============================================================
// HTML-escape a szerverről jövő adatokhoz (tárolt XSS ellen)
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ============================================================
// SESSION STATE — oldal frissítés utáni visszaállítás
// sessionStorage: csak ugyanazon a fülön él, új fülön üres
// ============================================================
var SS_KEY = 'vs_sofer_state';

function stateSave(extra) {
  try {
    var cur = stateGet();
    var merged = Object.assign({}, cur, extra || {});
    // Sofőr-horgony: a közös telefonon a másik sofőr session-je NE hívja
    // fel a piszkozatot. A `_meData.email` (authMe után elérhető) mindig
    // frissítjük — így a leak-védelem tudja, kihez tartozik.
    var _me = (typeof _meData === 'object' && _meData && _meData.email) ? String(_meData.email).toLowerCase() : '';
    if (_me) merged.driverEmail = _me;
    sessionStorage.setItem(SS_KEY, JSON.stringify(merged));
  } catch(e) {}
}

function stateGet() {
  try {
    return JSON.parse(sessionStorage.getItem(SS_KEY) || '{}');
  } catch(e) { return {}; }
}

function stateClear() {
  try { sessionStorage.removeItem(SS_KEY); } catch(e) {}
}

// Menetlevél piszkozat mentése (debounce 600ms)
var _draftTimer = null;
function draftSave() {
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(function() {
    var step2Visible = document.getElementById('fuvarStep2').style.display !== 'none';
    if (!step2Visible) return;

    // Pontok
    var puncte = [];
    document.querySelectorAll('#puncteContainer .dyn-row').forEach(function(row) {
      puncte.push({
        tip: (row.querySelector('.punct-tip') || {}).value || '',
        loc: (row.querySelector('.punct-loc') || {}).value || '',
        data: (row.querySelector('.punct-data') || {}).value || ''
      });
    });

    // Tankolások
    var alimentari = [];
    document.querySelectorAll('#alimentariContainer .dyn-row').forEach(function(row) {
      alimentari.push({
        loc: (row.querySelector('.alim-loc') || {}).value || '',
        data: (row.querySelector('.alim-data') || {}).value || '',
        tip: (row.querySelector('.alim-tip') || {}).value || 'Motorină',
        litru: (row.querySelector('.alim-lit') || {}).value || '0',
        km: (row.querySelector('.alim-km') || {}).value || '0',
        plata: (row.querySelector('.alim-plata') || {}).value || 'Card',
        suma: (row.querySelector('.alim-suma') || {}).value || '0'
      });
    });

    // Kiadások
    var achizitii = [];
    document.querySelectorAll('#achizitiiContainer .dyn-row').forEach(function(row) {
      achizitii.push({
        produs: (row.querySelector('.ach-prod') || {}).value || '',
        loc: (row.querySelector('.ach-loc') || {}).value || '',
        data: (row.querySelector('.ach-data') || {}).value || '',
        pret: (row.querySelector('.ach-pret') || {}).value || '0',
        plata: (row.querySelector('.ach-plata') || {}).value || 'Card'
      });
    });

    stateSave({
      draft: {
        camion: document.getElementById('fCamion').value,
        remorca: document.getElementById('fRemorca').value,
        kmInc: document.getElementById('fKmInc').value,
        kmSf: document.getElementById('fKmSf').value,
        cantInc: document.getElementById('fCantInc').value,
        cantSf: document.getElementById('fCantSf').value,
        mentiuni: document.getElementById('fMentiuni').value,
        puncte: puncte,
        alimentari: alimentari,
        achizitii: achizitii,
        orderIds: _selectedOrderIds,
        summary: document.getElementById('selectedOrdersSummary').innerHTML
      }
    });
  }, 600);
}

function draftRestore(draft) {
  if (!draft) return;
  document.getElementById('fCamion').value = draft.camion || '';
  document.getElementById('fRemorca').value = draft.remorca || '';
  document.getElementById('fKmInc').value = draft.kmInc || '0';
  document.getElementById('fKmSf').value = draft.kmSf || '0';
  document.getElementById('fCantInc').value = draft.cantInc || '0';
  document.getElementById('fCantSf').value = draft.cantSf || '0';
  document.getElementById('fMentiuni').value = draft.mentiuni || '';

  // Útvonal pontok visszaállítása
  document.getElementById('puncteContainer').innerHTML = '';
  punctIdx = 0;
  (draft.puncte || []).forEach(function(p) {
    // Tag-eket is visszaadjuk (fuvar-visszakötés + Plecare/Sosire idő)
    addPunctRow(p.loc, p.tip, p.data, {
      orderId: p.orderId, role: p.role, time: p.time
    });
  });

  // Tankolások visszaállítása
  document.getElementById('alimentariContainer').innerHTML = '';
  alimIdx = 0;
  (draft.alimentari || []).forEach(function(a) {
    addAlimRow(a);
  });

  // Kiadások visszaállítása
  document.getElementById('achizitiiContainer').innerHTML = '';
  achIdx = 0;
  (draft.achizitii || []).forEach(function(a) {
    addAchRow(a);
  });

  // Kiválasztott fuvar ID-k és összesítő
  _selectedOrderIds = draft.orderIds || [];
  if (draft.summary) {
    document.getElementById('selectedOrdersSummary').innerHTML = draft.summary;
  }
  // Piszkozat-visszaállítás után újraszámoljuk az „Út időpontjait" a
  // (frissen visszaadott) Plecare/Sosire sorokból.
  if (typeof _syncTripTimesFromPuncte === 'function') _syncTripTimesFromPuncte();
}

function draftClear() {
  stateSave({ draft: null });
}

// ============================================================
//  HELYI (offline) MENETLEVÉL-PISZKOZATOK — a TELEFONON tárolva
//  localStorage-ban (a sessionStorage-os auto-draft PERZISZTENS párja).
//  A sofőr indulás előtt beír pár adatot, gombnyomásra elmenti a
//  telefonjára; az OFFLINE is látható a PWA-ban, és offline szerkeszthető.
//  Internet CSAK a beküldéshez kell.
// ============================================================
var LS_DRAFTS_KEY = 'vs_sofer_local_drafts';
var _curLocalDraftId = null;

// A közös JSON-storage helper (`_perDriverGetJson`/`_perDriverSetJson`)
// lentebb (a `_driverStoreKey`-vel együtt) definiált — mindkettő a
// bejelentkezett sofőr e-mail-jét fűzi a kulcshoz, így közös telefonon
// több sofőr külön „memoriát" tart. Visszafelé kompatibilis: első
// alkalommal az esetleges régi közös kulcs átvevődik fallback-ként.
function soferLoadLocalDrafts() { return _perDriverGetJson(LS_DRAFTS_KEY, []) || []; }
function soferStoreLocalDrafts(arr) { _perDriverSetJson(LS_DRAFTS_KEY, arr || []); }

// A teljes menetlevél-űrlap begyűjtése (a beküldött mezők szuperhalmaza).
function soferCollectFull() {
  var puncte = [];
  document.querySelectorAll('#puncteContainer .dyn-row').forEach(function (row) {
    var punct = {
      tip: (row.querySelector('.punct-tip') || {}).value || '',
      loc: (row.querySelector('.punct-loc') || {}).value || '',
      data: (row.querySelector('.punct-data') || {}).value || ''
    };
    // Tag-eket is elmentjük a helyi/piszkozat-visszaállításhoz
    var oid  = row.getAttribute('data-order-id');
    var role = row.getAttribute('data-role');
    var tm   = row.getAttribute('data-time');
    if (oid)  punct.orderId = oid;
    if (role) punct.role = role;
    if (tm)   punct.time = tm;
    puncte.push(punct);
  });
  var alimentari = [];
  document.querySelectorAll('#alimentariContainer .dyn-row').forEach(function (row) {
    alimentari.push({
      loc: (row.querySelector('.alim-loc') || {}).value || '',
      data: (row.querySelector('.alim-data') || {}).value || '',
      tip: (row.querySelector('.alim-tip') || {}).value || 'Motorină',
      litru: (row.querySelector('.alim-lit') || {}).value || '0',
      km: (row.querySelector('.alim-km') || {}).value || '0',
      plata: (row.querySelector('.alim-plata') || {}).value || 'Card',
      suma: (row.querySelector('.alim-suma') || {}).value || '0'
    });
  });
  var achizitii = [];
  document.querySelectorAll('#achizitiiContainer .dyn-row').forEach(function (row) {
    achizitii.push({
      produs: (row.querySelector('.ach-prod') || {}).value || '',
      loc: (row.querySelector('.ach-loc') || {}).value || '',
      data: (row.querySelector('.ach-data') || {}).value || '',
      pret: (row.querySelector('.ach-pret') || {}).value || '0',
      plata: (row.querySelector('.ach-plata') || {}).value || 'Card'
    });
  });
  function gv(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  return {
    fisa: gv('fFisa'),
    camion: gv('fCamion'), remorca: gv('fRemorca'),
    kmInc: gv('fKmInc'), kmSf: gv('fKmSf'),
    cantInc: gv('fCantInc'), cantSf: gv('fCantSf'),
    mentiuni: gv('fMentiuni'),
    indulasDt: gv('fIndulasDt'), erkezesDt: gv('fErkezesDt'),
    hataratok: (typeof collectHataratok === 'function' ? collectHataratok() : []),
    puncte: puncte, alimentari: alimentari, achizitii: achizitii,
    orderIds: _selectedOrderIds,
    summary: (document.getElementById('selectedOrdersSummary') || {}).innerHTML || ''
  };
}

// A teljes űrlap visszaállítása egy elmentett adatból (a step2-n).
function soferApplyFull(data) {
  if (!data) return;
  draftRestore(data);   // közös mezők + puncte/alimentari/achizitii + orderIds/summary
  function sv(id, v) { var el = document.getElementById(id); if (el) el.value = (v == null ? '' : v); }
  sv('fFisa', data.fisa);
  sv('fIndulasDt', data.indulasDt);
  sv('fErkezesDt', data.erkezesDt);
  var hc = document.getElementById('hatarContainer');
  if (hc) {
    hc.innerHTML = '';
    (data.hataratok || []).forEach(function (h) {
      if (typeof addHatarRow === 'function') addHatarRow(h.datetime, h.direction);
    });
  }
  if (typeof updateDiurnaPreview === 'function') updateDiurnaPreview();
}

// A jelenlegi űrlap mentése a telefonra (helyi piszkozat). silent=true → nincs toast.
function saveLocalDraft(silent) {
  var data = soferCollectFull();
  var arr = soferLoadLocalDrafts();
  var label = (data.camion || '').trim();
  if (data.puncte && data.puncte[0] && data.puncte[0].loc) label += (label ? ' · ' : '') + data.puncte[0].loc;
  if (!label) label = t('sof.localDraftUnnamed');
  var now = Date.now();
  var existing = _curLocalDraftId ? arr.filter(function (d) { return d.id === _curLocalDraftId; })[0] : null;
  if (existing) {
    existing.label = label; existing.savedAt = now; existing.data = data;
  } else {
    _curLocalDraftId = 'd' + now;
    arr.unshift({ id: _curLocalDraftId, label: label, savedAt: now, data: data });
  }
  soferStoreLocalDrafts(arr);
  renderLocalDrafts();
  if (!silent) toast(t('sof.localDraftSaved'), 'ok');
}

// Egy elmentett helyi piszkozat betöltése a szerkesztőbe (offline is működik).
function loadLocalDraft(id) {
  var d = soferLoadLocalDrafts().filter(function (x) { return x.id === id; })[0];
  if (!d) return;
  _curLocalDraftId = id;
  goSec('fuvar');
  // A mentett adatból töltünk (nem a kiválasztott fuvarokból), ezért közvetlenül
  // a 2. lépést mutatjuk, majd alkalmazzuk a mentett menetlevél-adatot.
  document.getElementById('fuvarStep1').style.display = 'none';
  document.getElementById('fuvarStep2').style.display = 'block';
  soferApplyFull(d.data);
  if (typeof attachDraftListeners === 'function') attachDraftListeners();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// Helyi piszkozat törlése (megerősítéssel).
function deleteLocalDraft(id) {
  if (!confirm(t('sof.localDraftConfirmDel'))) return;
  var arr = soferLoadLocalDrafts().filter(function (x) { return x.id !== id; });
  soferStoreLocalDrafts(arr);
  if (_curLocalDraftId === id) _curLocalDraftId = null;
  renderLocalDrafts();
  toast(t('sof.localDraftDeleted'), '');
}

// A mentett helyi piszkozatok listája (a menetlevél 1. lépésén; offline is látszik).
function renderLocalDrafts() {
  var box = document.getElementById('localDraftsBox');
  if (!box) return;
  var arr = soferLoadLocalDrafts();
  if (!arr.length) {
    box.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:6px 2px;">' + esc(t('sof.localDraftNone')) + '</div>';
    return;
  }
  box.innerHTML = arr.map(function (d) {
    var when = '';
    try { when = new Date(d.savedAt).toLocaleString(); } catch (e) {}
    return '<div class="local-draft-item" style="display:flex;align-items:center;gap:8px;justify-content:space-between;'
      + 'background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.25);border-radius:10px;padding:10px 12px;margin-bottom:8px;">'
      + '<div style="min-width:0;flex:1;" onclick="loadLocalDraft(\'' + d.id + '\')">'
      + '<div style="font-weight:700;font-size:14px;color:var(--soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📄 ' + esc(d.label) + '</div>'
      + '<div style="font-size:11px;color:var(--muted);">' + esc(when) + '</div></div>'
      + '<button class="btn-mini" onclick="loadLocalDraft(\'' + d.id + '\')" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(59,130,246,0.4);background:rgba(59,130,246,0.12);color:#3b82f6;font-weight:700;">'
      + esc(t('sof.localDraftLoad')) + '</button>'
      + '<button class="btn-mini" onclick="deleteLocalDraft(\'' + d.id + '\')" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(239,68,68,0.35);background:rgba(239,68,68,0.1);color:#ef4444;">🗑</button>'
      + '</div>';
  }).join('');
}

// Oldal bezárás/frissítés előtt azonnal mentünk
window.addEventListener('beforeunload', function() {
  var step2Visible = document.getElementById('fuvarStep2').style.display !== 'none';
  if (step2Visible) draftSave();
});

// ============================================================
// TOAST
// ============================================================
function toast(m, k) {
  var e = document.createElement('div');
  e.className = 'toast ' + (k || '');
  e.textContent = m;
  document.getElementById('toasts').appendChild(e);
  setTimeout(function() { e.remove(); }, 3000);
}

// ============================================================
// NAVIGÁCIÓ
// ============================================================
var sections = ['dash','border','fuvar','docs','chat'];

function goSec(id) {
  sections.forEach(function(s) {
    document.getElementById('sec-' + s).classList.add('hidden');
  });
  var next = document.getElementById('sec-' + id);
  if (!next) return;
  next.classList.remove('hidden');
  next.classList.add('sec-entering');
  setTimeout(function() { next.classList.remove('sec-entering'); }, 220);
  next.scrollTop = 0;            // a panel belül görget (nem a body) — tetejére
  window.scrollTo({ top: 0, behavior: 'instant' });

  // A 🐛 FAB (jobb alsó sarok) ütközne a chat küldés gombbal → chat nézetben elrejtjük
  var fab = document.getElementById('bugFab');
  if (fab) fab.style.display = (id === 'chat') ? 'none' : 'flex';

  stateSave({ sec: id });
  if (id === 'border') loadBorderLog();
  if (id === 'fuvar')  { loadSoferOrders(); if (typeof renderLocalDrafts === 'function') renderLocalDrafts(); }
  if (id === 'docs')   loadDocOrderOptions();
  // A bon-várólista mindkét helyen látszik (főoldal + menetlevél 1. lépés)
  if (id === 'dash' || id === 'fuvar') { if (typeof renderPendingReceipts === 'function') renderPendingReceipts(); }
}

// ============================================================
// TELEFONOS „VISSZA" GOMB — appon belüli visszalépés (ne jelentkezzen ki)
// ============================================================
// A rendszer-vissza gombot elkapjuk: (1) menetlevél 2. lépésén → vissza az 1.
// lépésre; (2) nyitott modal → bezárás; (3) al-oldalon → vissza a főoldalra;
// (4) a főoldalon DUPLA visszával lép ki (a session megmarad). Így egyetlen
// vissza-nyomás nem lép ki / nem jelentkeztet ki, csak visszanavigál.
(function initSoferBackButton(){
  var _backTs = 0, _exiting = false;
  function repush(){ try { history.pushState({ vsSofer: true }, ''); } catch(e){} }
  try { history.pushState({ vsSofer: true }, ''); } catch(e){}   // kezdő csapda-állapot
  window.addEventListener('popstate', function(){
    if (_exiting) return;
    // 1) Menetlevél 2. lépés → vissza az 1. lépésre
    var step2 = document.getElementById('fuvarStep2');
    var fuvarSec = document.getElementById('sec-fuvar');
    if (fuvarSec && !fuvarSec.classList.contains('hidden') && step2 && step2.style.display !== 'none') {
      try { fuvarBackStep1(); } catch(e){}
      repush(); return;
    }
    // 2) Nyitott modal → bezárás (áru-leadás / hibajelentés)
    var ho = document.getElementById('hoModal'), bug = document.getElementById('bugModal');
    if (ho && ho.style.display === 'flex')  { try { closeHandover(); }  catch(e){} repush(); return; }
    if (bug && bug.style.display === 'flex') { try { closeBugReport(); } catch(e){} repush(); return; }
    // 3) Al-oldalon → vissza a főoldalra
    var active = 'dash';
    ['dash','border','fuvar','docs','chat'].forEach(function(s){
      var el = document.getElementById('sec-'+s);
      if (el && !el.classList.contains('hidden')) active = s;
    });
    if (active !== 'dash') { try { goSec('dash'); } catch(e){} repush(); return; }
    // 4) Főoldalon: dupla-vissza (2 mp-en belül) → kilépés; egyébként jelzés + maradás
    var now = Date.now();
    if (now - _backTs < 2000) { _exiting = true; try { history.back(); } catch(e){} return; }
    _backTs = now;
    try { toast(t('sof.backExitHint'), ''); } catch(e){}
    repush();
  });
})();

// ============================================================
// HATÁRÁTLÉPÉS
// ============================================================
function sendBorderCross(tip, tara) {
  var statusEl = document.getElementById('gpsStatus');
  statusEl.innerHTML = '<div class="gps-badge"><span class="spinner"></span> ' + t('sof.gpsFetch') + '</div>';

  function doSend(lat, lng) {
    fetch('/api/border-cross', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tip: tip, tara: tara, gps_lat: lat, gps_lng: lng,
        locatie: lat ? (lat.toFixed(4) + ', ' + lng.toFixed(4)) : null })
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.success) {
        toast(tip === 'Intrare' ? t('sof.roInSaved') : t('sof.roOutSaved'), 'ok');
        statusEl.innerHTML = lat
          ? '<div class="gps-badge">📍 GPS: ' + lat.toFixed(4) + ', ' + lng.toFixed(4) + '</div>'
          : '<div class="gps-badge">' + t('sof.savedNoGps') + '</div>';
        loadBorderLog();
      } else {
        toast(t('common.error') + ': ' + (d.err || t('sof.unknown')), 'err');
        statusEl.innerHTML = '';
      }
    });
  }

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      function(pos) { doSend(pos.coords.latitude, pos.coords.longitude); },
      function() { doSend(null, null); },
      { timeout: 8000 }
    );
  } else {
    doSend(null, null);
  }
}

function loadBorderLog() {
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getBorderLogs' }) })
  .then(function(r) { return r.json(); }).then(function(d) {
    var list = d.result || [];
    var el = document.getElementById('borderLogList');
    if (!list.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;">' + t('sof.noCross') + '</div>'; return; }
    el.innerHTML = list.slice(0, 20).map(function(l) {
      var dt = l.created_at ? new Date(l.created_at).toLocaleString(t('sof.locale')) : '—';
      return '<div class="border-log-item">'
        + '<strong>' + (l.tip === 'Intrare' ? t('sof.crossIn') : t('sof.crossOut')) + '</strong>'
        + ' — ' + dt
        + (l.locatie ? '<br><span style="font-size:11px;color:var(--muted);">📍 ' + l.locatie + '</span>' : '')
        + '</div>';
    }).join('');
  });
}

// ============================================================
// MENETLEVÉL — fuvar kiválasztás
// ============================================================
var _soferOrdersCache = [];
var _selectedOrderIds = [];

function loadSoferOrders() {
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getMySoferOrders' }) })
  .then(function(r) { return r.json(); }).then(function(d) {
    // Minden kiosztott fuvar, DE amiről már mentett menetlevél készült, az a
    // mentéstől számított 3 nap után kiesik (waybill_visible — szerver számolja).
    // Defenzív: ha a mező hiányzik (pl. régi, újra nem indított szerver), MUTASSUK
    // a fuvart (csak az explicit false rejt) — így nem tűnnek el a fuvarok.
    _soferOrdersCache = (d.result || []).filter(function(o) { return o.waybill_visible !== false; });
    var el = document.getElementById('soferOrderList');
    if (!_soferOrdersCache.length) {
      el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:13px;">' + t('sof.noWaybillOrders') + '</div>';
      return;
    }
    el.innerHTML = _soferOrdersCache.map(function(o) {
      var checked = _selectedOrderIds.indexOf(o.id) !== -1;
      var phaseBadge = '';
      if (o.waybill_phase === 'loading') {
        phaseBadge = ' <span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(34,197,94,0.2);color:#4ade80;">📤 ' + t('sof.phaseLoading') + '</span>';
      } else if (o.waybill_phase === 'unloading') {
        phaseBadge = ' <span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(99,102,241,0.25);color:#a5b4fc;">📥 ' + t('sof.phaseUnloading') + '</span>';
      }
      return '<label style="display:flex;align-items:flex-start;gap:12px;background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:10px;cursor:pointer;">'
        + '<input type="checkbox" value="' + o.id + '" ' + (checked ? 'checked' : '') + ' onchange="toggleOrderSel(this)" style="margin-top:3px;width:18px;height:18px;accent-color:#3b82f6;flex-shrink:0;">'
        + '<div>'
        + '<div style="font-weight:700;font-size:14px;color:#fff;">' + esc(o.client || '—') + ' <span style="font-size:11px;color:var(--muted);">#' + o.id + '</span> <span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(255,255,255,0.1);">' + esc(o.status||'—') + '</span>' + phaseBadge + '</div>'
        + '<div style="font-size:12px;color:var(--soft);margin-top:3px;">📍 ' + esc(o.loc_incarcare || '—') + ' → ' + esc(o.loc_descarcare || '—') + '</div>'
        + (o.rendszam_camion ? '<div style="font-size:11px;color:var(--muted);margin-top:2px;">🚛 ' + esc(o.rendszam_camion) + (o.rendszam_remorca ? ' / ' + esc(o.rendszam_remorca) : '') + '</div>' : '')
        + '</div></label>';
    }).join('');
  });
}

function toggleOrderSel(cb) {
  var id = cb.value;
  if (cb.checked) {
    if (_selectedOrderIds.indexOf(id) === -1) _selectedOrderIds.push(id);
  } else {
    _selectedOrderIds = _selectedOrderIds.filter(function(x) { return x !== id; });
  }
}

// EGYETLEN menetlevél-létrehozó belépési pont (a korábbi „Tovább →
// kitöltés" + „Menetlevél fuvar nélkül" gombok egyesítve): amelyik fuvar
// be van pipálva, az bekerül; ha egy sincs, fuvar nélküli menetlevél
// készül (a kézi km/rendszám/pont adatokból; a szerver üres order_ids-t
// elfogad, a statisztika a sofőr e-mailjéhez kötődik).
//
// Első lépésként MINDIG rákérdez az INDULÁSI helyre (Plecare) — a válasz
// egy `Plecare` sor lesz a puncte-ban (helyszín kötelező, dátum kötelező,
// óra+perc opcionális). Ha van már mentett/piszkozat Plecare, kihagyja a
// dialógust. Alap: „Garaj-Arcus" (localStorage-ban memoriál).
var _pendingPlecare = null;
function fuvarCreate() {
  // Ha van piszkozatban már Plecare-sor, nem kérdez újra.
  var hasPlecareInDraft = false;
  try {
    var _st = JSON.parse(sessionStorage.getItem(SS_KEY) || '{}');
    var _dr = _st && _st.draft;
    hasPlecareInDraft = !!(_dr && (_dr.puncte || []).some(function (p) { return p.tip === 'Plecare'; }));
  } catch (_e) {}
  if (hasPlecareInDraft) { fuvarStep2(true); return; }
  wbLocDialog('start', function (res) {
    if (!res) return;                // Mégse — marad az 1. lépésen
    _pendingPlecare = res;           // fuvarStep2 innen olvassa
    fuvarStep2(true);
  });
}
// Visszafelé kompatibilitás: régi (gyorsítótárazott) sofer.html még ezt hívja.
function fuvarNoOrder() {
  _selectedOrderIds = [];
  fuvarStep2(true);
}

function fuvarStep2(allowEmpty) {
  // Az `allowEmpty` paraméter már csak visszafelé-kompatibilitásból van itt:
  // egyetlen gomb van, és az MINDIG továbbenged — pipa nélkül fuvar nélküli
  // menetlevél készül (nincs „jelölj be legalább egy fuvart" akadály).
  var selected = _soferOrdersCache.filter(function(o) { return _selectedOrderIds.indexOf(o.id) !== -1; });
  var sumEl = document.getElementById('selectedOrdersSummary');
  if (!selected.length) {
    sumEl.innerHTML = '<b style="color:#fff;">' + t('sof.noOrderSummary') + '</b>';
  } else {
  sumEl.innerHTML = '<b style="color:#fff;">✅ ' + t('sof.selectedOrders', { n: selected.length }) + '</b><br>'
    + selected.map(function(o) {
        return '• ' + esc(o.client || '—') + ': ' + esc(o.loc_incarcare || '—') + ' → ' + esc(o.loc_descarcare || '—');
      }).join('<br>');
  }

  // Rendszám előtöltése: elsőként a kiválasztott fuvarból; ha ott nincs (pl.
  // fuvar nélküli menetlevél), a nekem kiosztott vontató + alapértelmezett
  // pótkocsi rendszámából. Mindkettő szerkeszthető (csak alapérték). Üres mezőt
  // nem írunk felül (piszkozat-visszatöltés védelme).
  var first = selected[0];
  var camEl = document.getElementById('fCamion');
  var remEl = document.getElementById('fRemorca');
  if (first && first.rendszam_camion) {
    camEl.value = first.rendszam_camion;
    remEl.value = first.rendszam_remorca || '';
  } else if (_myAssignedVehicle && _myAssignedVehicle.rendszam_camion) {
    if (!camEl.value) camEl.value = _myAssignedVehicle.rendszam_camion;
    if (!remEl.value && _myAssignedVehicle.rendszam_remorca) remEl.value = _myAssignedVehicle.rendszam_remorca;
  }
  // Kezdő üzemanyag-szint átvitel az adott jármű utolsó menetleveléből.
  if (camEl.value) prefillWaybillReadings(camEl.value);

  // Indulás/érkezés dátum előtöltése a TÉNYLEGES állomás-időből (incarcat_at /
  // descarcat_at), fallback a fuvar tervezett dátumára (data_incarcare/descarcare).
  // CSAK a dátumot töltjük (óra 00:00 → a sofőr állítja); üres mezőt nem írunk
  // felül piszkozat visszatöltésekor. Több fuvar: legkorábbi felrakás / legkésőbbi lerakás.
  var _ymdOf = function(v){ return v ? String(v).slice(0, 10) : ''; };
  var loadDates = [], unloadDates = [];
  selected.forEach(function(o){
    var l = _ymdOf(o.incarcat_at) || _ymdOf(o.data_incarcare);
    var u = _ymdOf(o.descarcat_at) || _ymdOf(o.data_descarcare);
    if (l) loadDates.push(l);
    if (u) unloadDates.push(u);
  });
  var depEl = document.getElementById('fIndulasDt');
  var arrEl = document.getElementById('fErkezesDt');
  if (depEl && !depEl.value && loadDates.length) {
    depEl.value = loadDates.sort()[0] + 'T00:00';           // legkorábbi felrakás
  }
  if (arrEl && !arrEl.value && unloadDates.length) {
    arrEl.value = unloadDates.sort()[unloadDates.length - 1] + 'T00:00';  // legkésőbbi lerakás
  }
  if (typeof updateDiurnaPreview === 'function') { try { updateDiurnaPreview(); } catch (e) {} }

  document.getElementById('puncteContainer').innerHTML = '';
  punctIdx = 0;

  // 1) Plecare (indulási pont) — vagy a most bekért (fuvarCreate modal-ból),
  //    vagy piszkozat-visszaállításkor a mentett Plecare sor.
  var _plecare = _pendingPlecare;
  if (!_plecare) {
    try {
      var _st1 = JSON.parse(sessionStorage.getItem(SS_KEY) || '{}');
      var _pl = ((_st1.draft || {}).puncte || []).find(function (p) { return p.tip === 'Plecare'; });
      if (_pl) _plecare = { loc: _pl.loc, date: String(_pl.data || '').slice(0, 10), time: _pl.time || '' };
    } catch (_e2) {}
  }
  if (_plecare) {
    addPunctRow(_plecare.loc, 'Plecare', _plecare.date, { time: _plecare.time });
  }
  _pendingPlecare = null;

  // 2) A kiválasztott fuvarokból az Incarcare/Descarcare sorok — a DÁTUM a
  //    fuvar tervezett `data_incarcare`/`data_descarcare`-ből előtöltve
  //    (a sofőr átírhatja, ha másnap történt). A sorok `data-order-id` +
  //    `data-role` tag-et kapnak → a beküldéskor a szerver ezekből frissíti
  //    az `orders.incarcat_at`/`descarcat_at`-ot (tényleges dátum).
  selected.forEach(function(o) {
    var phase = o.waybill_phase;
    var loadDate = _ymdOf(o.data_incarcare);
    var unloadDate = _ymdOf(o.data_descarcare);
    if (phase === 'loading') {
      // Alocat / In Curs: csak a felrakási adatok — az Extern fuvarhoz nincs lerakó még
      if (o.loc_incarcare) addPunctRow(o.loc_incarcare, 'Încărcare', loadDate, { orderId: o.id, role: 'loading' });
    } else if (phase === 'unloading') {
      // Finalizat, már volt menetlevélbe foglalva (rakodás): csak lerakási adatok
      if (o.loc_descarcare) addPunctRow(o.loc_descarcare, 'Descărcare', unloadDate, { orderId: o.id, role: 'unloading' });
    } else {
      // complete vagy ismeretlen: mindkettő (régi viselkedés / egyszerű fuvar)
      if (o.loc_incarcare) addPunctRow(o.loc_incarcare, 'Încărcare', loadDate, { orderId: o.id, role: 'loading' });
      if (o.loc_descarcare) addPunctRow(o.loc_descarcare, 'Descărcare', unloadDate, { orderId: o.id, role: 'unloading' });
    }
  });

  // 3) Sosire (érkezési pont) — visszalépéskor a piszkozatból visszahozzuk;
  //    egyébként a beküldéskor (submitFuvarlevel) kérdez rá a modal, ott
  //    kerül a puncte végére.
  try {
    var _st4 = JSON.parse(sessionStorage.getItem(SS_KEY) || '{}');
    var _sos = ((_st4.draft || {}).puncte || []).find(function (p) { return p.tip === 'Sosire'; });
    if (_sos) addPunctRow(_sos.loc, 'Sosire', String(_sos.data || '').slice(0, 10), { time: _sos.time });
  } catch (_e3) {}

  document.getElementById('fuvarStep1').style.display = 'none';
  document.getElementById('fuvarStep2').style.display = 'block';
  document.getElementById('alimentariContainer').innerHTML = '';
  document.getElementById('achizitiiContainer').innerHTML = '';
  alimIdx = 0; achIdx = 0;

  // Ha a sofőr korábban a főoldalról scannelt bonokat és elfogadta őket
  // (rrAccept: step2 zárva → sessionStorage-piszkozatba pusholtuk), most
  // állítsuk vissza a DOM-ba is — különben a következő draftSave (üres
  // konténer) felülírná őket. Az igazságforrás a sessionStorage; ha a
  // fuvarStep1-ből ide léptünk, csak a tankolás/vásárlás sorok érintettek
  // (a km/rendszám/dátum előtöltés fentebb már megvolt, üres mezőt nem
  // írunk felül).
  try {
    var _st = JSON.parse(sessionStorage.getItem(SS_KEY) || '{}');
    var _dr = _st && _st.draft;
    if (_dr) {
      (_dr.alimentari || []).forEach(function (a) { addAlimRow(a); });
      (_dr.achizitii  || []).forEach(function (a) { addAchRow(a); });
    }
  } catch (_e) { /* nincs érvényes piszkozat — üresen indul */ }

  // Piszkozat figyeli a változásokat
  attachDraftListeners();
  // Út időpontjai (hidden fIndulasDt/fErkezesDt) szinkron a Plecare/Sosire-ból
  if (typeof _syncTripTimesFromPuncte === 'function') _syncTripTimesFromPuncte();
  stateSave({ fuvarStep: 2 });
}

function fuvarBackStep1() {
  document.getElementById('fuvarStep2').style.display = 'none';
  document.getElementById('fuvarStep1').style.display = 'block';
  stateSave({ fuvarStep: 1 });
}

// A menetlevél „Út időpontjai" (kezdő / záró datetime) mostantól automatikusan
// a Plecare (első ilyen sor) és Sosire (utolsó ilyen sor) dátumából +
// opcionális óra:percéből képződik → a `fIndulasDt` / `fErkezesDt` hidden
// input-okba írunk (a `updateDiurnaPreview`, `submitFuvarlevel`, offline
// draft mind ezeket használja). Óra: `data-time` attribútum ('HH:MM'),
// hiányában 12:00 (délelőtt indul, este ér — nincs időzóna-csúszás a
// day-boundary-n). Az érték `datetime-local` formátumú: 'YYYY-MM-DDTHH:MM'.
function _syncTripTimesFromPuncte() {
  var rows = document.querySelectorAll('#puncteContainer .dyn-row');
  var plecDt = '', sosDt = '';
  rows.forEach(function (row) {
    var tip  = (row.querySelector('.punct-tip')  || {}).value;
    var date = (row.querySelector('.punct-data') || {}).value;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    var time = row.getAttribute('data-time');
    if (!time || !/^\d{2}:\d{2}$/.test(time)) time = '12:00';
    var dt = date + 'T' + time;
    if (tip === 'Plecare' && !plecDt) plecDt = dt;      // első Plecare nyer
    if (tip === 'Sosire')             sosDt  = dt;      // utolsó Sosire nyer
  });
  var indEl = document.getElementById('fIndulasDt');
  var arrEl = document.getElementById('fErkezesDt');
  if (indEl && indEl.value !== plecDt) indEl.value = plecDt;
  if (arrEl && arrEl.value !== sosDt)  arrEl.value = sosDt;
  if (typeof updateDiurnaPreview === 'function') { try { updateDiurnaPreview(); } catch (e) {} }
}
// A puncte container változásaira (dropdown / dátum / helyszín módosul)
// automatikusan szinkronizáljuk a hidden input-okat. Egyetlen delegated
// listener az egész konténerre — a `.dyn-row`-k dinamikusan jönnek/mennek.
(function _hookPuncteSync() {
  function bind() {
    var pc = document.getElementById('puncteContainer');
    if (!pc || pc._vsTripSyncBound) return;
    pc._vsTripSyncBound = true;
    pc.addEventListener('change', _syncTripTimesFromPuncte);
    pc.addEventListener('input',  _syncTripTimesFromPuncte);
    // Ugyanitt kötjük be a pont-sorok átrendezését (hosszan nyomva → húzás).
    if (typeof _punctDragInit === 'function') _punctDragInit();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else { bind(); }
})();

// Input változások figyelése → piszkozat auto-mentés
function attachDraftListeners() {
  var ids = ['fCamion','fRemorca','fKmInc','fKmSf','fCantInc','fCantSf','fMentiuni'];
  ids.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) {
      el.removeEventListener('input', draftSave);
      el.addEventListener('input', draftSave);
    }
  });
  // Rendszám kézi módosításakor a kezdő üzemanyag-szintet az új jármű utolsó
  // menetleveléből tölti (csak ha a kezdő mező üres/0 — beírt értéket nem ír felül).
  var camEl = document.getElementById('fCamion');
  if (camEl && !camEl._fuelBound) {
    camEl._fuelBound = true;
    camEl.addEventListener('change', function() {
      if (camEl.value) prefillWaybillReadings(camEl.value.trim());
    });
  }
  // Dinamikus sorok figyelése MutationObserver-rel
  ['puncteContainer','alimentariContainer','achizitiiContainer'].forEach(function(cId) {
    var container = document.getElementById(cId);
    if (!container._observer) {
      var obs = new MutationObserver(draftSave);
      obs.observe(container, { childList: true, subtree: true, characterData: true });
      container._observer = obs;
    }
  });
}

// ============================================================
// DINAMIKUS SOROK
// ============================================================
var alimIdx = 0, achIdx = 0, punctIdx = 0;

function addPunctRow(locVal, tipVal, dataVal, opts) {
  // opts (opcionális) — tag-adatok, hogy a driver által megadott felrakási/lerakási
  // dátum vissza tudja kötni a menetlevél sorát a fuvarra a beküldéskor:
  //   { orderId, role: 'loading'|'unloading', time: 'HH:MM' }
  // Plecare/Sosire sorokhoz csak `time` (opcionális, óra:perc). A tag-eket
  // data-* attribútumként tároljuk a sor <div>-jén, hogy a payload-gyűjtő
  // (submitFuvarlevel / soferCollectFull) egy helyen olvassa vissza.
  opts = opts || {};
  punctIdx++;
  var d = document.createElement('div');
  // `punct-row`: az útvonal-pont sorok átrendezhetők (hosszan nyomva → húzás),
  // ezért kapnak külön osztályt (a tankolás/vásárlás sorok NEM mozgathatók).
  d.className = 'dyn-row punct-row';
  if (opts.orderId) d.setAttribute('data-order-id', opts.orderId);
  if (opts.role)    d.setAttribute('data-role', opts.role);
  if (opts.time)    d.setAttribute('data-time', opts.time);
  // Plecare + Sosire: az induló/érkező „garaj" jellegű pontok — a menetlevél
  // MINDIG ezekkel indul és zárul. A többi típus a régi lista.
  var tipOptions = ['Plecare','Încărcare','Descărcare','Tranzit','Vamă','Parcare','Sosire','Altele'];
  var today = new Date().toISOString().split('T')[0];
  d.innerHTML = '<button class="del-row" onclick="punctRowRemove(this)">✕</button>'
    // Fogantyú-sáv: sorszám + „húzd" jelzés. A sor BÁRMELY nem-beviteli
    // része (fogantyú, címkék, üres felület) hosszan nyomva megfogható.
    + '<div class="punct-grip"><span class="punct-grip-idx"></span>'
    + '<span class="punct-grip-ico">⠿</span>'
    + '<span class="punct-grip-hint">' + t('sof.dragHint') + '</span></div>'
    + '<div class="g2">'
    + '<div class="field"><label>' + t('sof.punctType') + '</label><select class="input punct-tip" style="padding:10px 14px;" onchange="draftSave()">'
    + tipOptions.map(function(opt) { return '<option' + (opt === (tipVal || 'Încărcare') ? ' selected' : '') + '>' + opt + '</option>'; }).join('')
    + '</select></div>'
    + '<div class="field"><label>' + t('sof.date') + '</label><input class="input punct-data" type="date" value="' + esc(dataVal || today) + '" onchange="draftSave()"></div>'
    + '</div>'
    + '<div class="field"><label>' + t('sof.localityAddr') + '</label><input class="input punct-loc" placeholder="' + t('sof.punctLocPh') + '" value="' + esc(locVal || '') + '" oninput="draftSave()"></div>';
  document.getElementById('puncteContainer').appendChild(d);
  _punctRenumber();
}

// ============================================================
// ÚTVONAL-PONTOK ÁTRENDEZÉSE (hosszan nyomva → húzás)
// ============================================================
// A sofőr a menetlevél útvonal-pontjait EGYBEN (típus + dátum + helység)
// mozgathatja: a soron hosszan nyomva a kártya „kiugrik" (kiemelkedik és
// követi az ujjat), közben egy vízszintes vonal jelzi, MELYIK KÉT PONT KÖZÉ
// kerül. Felengedésre a sor a jelzett helyre kerül.
//
// Miért saját pointer-alapú megoldás a HTML5 drag&drop helyett: a natív DnD
// mobil böngészőkön gyakorlatilag nem használható (nincs touch-támogatás),
// a Pointer Events viszont egérrel és érintéssel is ugyanazt az utat járja.
//
// A sorrend a mentés szempontjából a DOM-sorrend (a payload-gyűjtők a
// `#puncteContainer .dyn-row` sorrendjében olvasnak), ezért a csere után
// elég a `draftSave()` + `_syncTripTimesFromPuncte()` (a Plecare/Sosire
// horgony változhatott).
var PUNCT_DRAG_HOLD_MS = 400;   // ennyi ideig kell nyomva tartani a megfogáshoz
var PUNCT_DRAG_SLOP_PX = 10;    // ennél nagyobb elmozdulás előtte = görgetés

var _punctDrag = null;          // az aktív húzás állapota (null, ha nincs)

// A konténer közvetlen pont-sorai (a húzás-jelző vonal NEM `.dyn-row`).
function _punctRows() {
  var pc = document.getElementById('puncteContainer');
  if (!pc) return [];
  return Array.prototype.filter.call(pc.children, function (el) {
    return el.classList && el.classList.contains('dyn-row');
  });
}

// A fogantyú sorszám-buborékainak újraszámozása (1..N) — hozzáadás, törlés
// és átrendezés után.
function _punctRenumber() {
  _punctRows().forEach(function (row, i) {
    var el = row.querySelector('.punct-grip-idx');
    if (el) el.textContent = String(i + 1);
  });
}

// Pont-sor törlése (a ✕ gombról) — a régi inline `parentNode.remove()`
// helyett, hogy az újraszámozás és az idő-szinkron is lefusson.
function punctRowRemove(btn) {
  var row = btn.closest ? btn.closest('.dyn-row') : btn.parentNode;
  if (row && row.parentNode) row.parentNode.removeChild(row);
  _punctRenumber();
  if (typeof _syncTripTimesFromPuncte === 'function') _syncTripTimesFromPuncte();
  draftSave();
}

// A görgethető ős (ha a lap nem az ablakkal görög) — az él-közeli
// automatikus görgetéshez és a húzás közbeni görgetés-korrekcióhoz.
function _punctScrollEl(el) {
  var n = el && el.parentNode;
  while (n && n.nodeType === 1) {
    var ov = '';
    try { ov = getComputedStyle(n).overflowY; } catch (e) {}
    if (/(auto|scroll|overlay)/.test(ov) && n.scrollHeight > n.clientHeight + 2) return n;
    n = n.parentNode;
  }
  return null;
}
function _punctScrollTop(st) {
  return st.scroller ? st.scroller.scrollTop
                     : (window.pageYOffset || document.documentElement.scrollTop || 0);
}

function _punctDragInit() {
  var pc = document.getElementById('puncteContainer');
  if (!pc || pc._vsDragBound) return;
  pc._vsDragBound = true;
  pc.addEventListener('pointerdown', _punctPointerDown);
  // Hosszan nyomásra a mobil böngésző kontextus-menüt nyitna — húzás közben nem kérünk belőle.
  pc.addEventListener('contextmenu', function (e) { if (_punctDrag) e.preventDefault(); });
}

function _punctPointerDown(e) {
  if (_punctDrag) return;
  if (e.button != null && e.button !== 0) return;          // csak bal gomb / érintés
  var tgt = e.target;
  if (!tgt || !tgt.closest) return;
  // A beviteli mezőkről NEM indítunk húzást (különben nem lehetne
  // szerkeszteni/kijelölni) — a fogantyú, a címkék és a sor üres felülete marad.
  if (tgt.closest('input, select, textarea, button, a')) return;
  var row = tgt.closest('.punct-row');
  var pc  = document.getElementById('puncteContainer');
  if (!row || !pc || row.parentNode !== pc) return;
  if (_punctRows().length < 2) return;                     // egy sort nincs mihez rendezni

  var st = {
    row: row, pc: pc,
    startX: e.clientX, startY: e.clientY, lastY: e.clientY,
    active: false, timer: null, line: null, before: null,
    scroller: null, scrollRef: 0, rafPending: false
  };
  _punctDrag = st;
  st.timer = setTimeout(function () { _punctDragActivate(st); }, PUNCT_DRAG_HOLD_MS);

  document.addEventListener('pointermove', _punctPointerMove, { passive: false });
  document.addEventListener('pointerup', _punctPointerUp);
  document.addEventListener('pointercancel', _punctPointerCancel);
  // Nem-passzív touchmove: aktív húzás közben ez tiltja le a lapgörgetést.
  document.addEventListener('touchmove', _punctTouchGuard, { passive: false });
}

function _punctTouchGuard(e) {
  if (_punctDrag && _punctDrag.active && e.cancelable) e.preventDefault();
}

function _punctDragActivate(st) {
  if (_punctDrag !== st) return;
  st.timer = null;
  st.active = true;
  st.scroller = _punctScrollEl(st.pc);
  st.scrollRef = _punctScrollTop(st);
  st.row.classList.add('punct-dragging');
  document.body.classList.add('punct-drag-active');
  if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) {} }   // tapintható visszajelzés
  var line = document.createElement('div');
  line.className = 'punct-drop-line';
  st.pc.appendChild(line);
  st.line = line;
  _punctDragUpdate(st);
}

// A húzott sor követi az ujjat, és kiszámoljuk, MELYIK sor ELÉ kerülne
// (`st.before`; `null` = a lista végére). A jelző-vonalat a konténerhez
// képest abszolút pozicionáljuk — így a sorok nem ugrálnak húzás közben.
function _punctDragUpdate(st) {
  var dy = (st.lastY - st.startY) + (_punctScrollTop(st) - st.scrollRef);
  st.row.style.transform = 'translateY(' + dy + 'px) scale(1.03)';

  var rows = _punctRows().filter(function (r) { return r !== st.row; });
  var before = null;
  for (var i = 0; i < rows.length; i++) {
    var rc = rows[i].getBoundingClientRect();
    if (st.lastY < rc.top + rc.height / 2) { before = rows[i]; break; }
  }
  st.before = before;

  var top;
  if (before) top = before.offsetTop - 6;
  else if (rows.length) {
    var last = rows[rows.length - 1];
    top = last.offsetTop + last.offsetHeight + 4;
  } else top = 0;
  st.line.style.top = top + 'px';
}

// Az ablak/konténer alsó-felső szélénél automatikus görgetés, hogy hosszú
// listában is el lehessen jutni a kívánt helyre.
function _punctAutoScroll(st) {
  var margin = 90;
  var vh = window.innerHeight || document.documentElement.clientHeight;
  var d = 0;
  if (st.lastY < margin) d = -Math.ceil((margin - st.lastY) / 6);
  else if (st.lastY > vh - margin) d = Math.ceil((st.lastY - (vh - margin)) / 6);
  if (!d) return;
  if (st.scroller) st.scroller.scrollTop += d;
  else window.scrollBy(0, d);
}

function _punctPointerMove(e) {
  var st = _punctDrag;
  if (!st) return;
  st.lastY = e.clientY;
  if (!st.active) {
    // Még a nyomva-tartás alatt vagyunk: ha a sofőr elmozdítja az ujját,
    // az görgetési szándék → nem húzunk.
    if (Math.abs(e.clientY - st.startY) > PUNCT_DRAG_SLOP_PX ||
        Math.abs(e.clientX - st.startX) > PUNCT_DRAG_SLOP_PX) _punctDragEnd(false);
    return;
  }
  if (e.cancelable) e.preventDefault();
  if (st.rafPending) return;
  st.rafPending = true;
  requestAnimationFrame(function () {
    st.rafPending = false;
    if (_punctDrag !== st || !st.active) return;
    _punctAutoScroll(st);
    _punctDragUpdate(st);
  });
}

function _punctPointerUp() {
  if (_punctDrag) _punctDragEnd(_punctDrag.active);
}

// A böngésző elvette a gesztust (pl. rendszer-gesztus, hívás) → NEM rendezünk
// át; a sor visszaáll a helyére.
function _punctPointerCancel() {
  if (_punctDrag) _punctDragEnd(false);
}

// `commit=true` → a sor a jelzett helyre kerül; `false` → minden marad.
function _punctDragEnd(commit) {
  var st = _punctDrag;
  if (!st) return;
  _punctDrag = null;
  if (st.timer) clearTimeout(st.timer);
  document.removeEventListener('pointermove', _punctPointerMove);
  document.removeEventListener('pointerup', _punctPointerUp);
  document.removeEventListener('pointercancel', _punctPointerCancel);
  document.removeEventListener('touchmove', _punctTouchGuard);
  if (st.line && st.line.parentNode) st.line.parentNode.removeChild(st.line);
  st.row.style.transform = '';
  st.row.classList.remove('punct-dragging');
  document.body.classList.remove('punct-drag-active');
  if (!st.active) return;
  // A felengedést követő „szellem-kattintás" (címke → mező-fókusz) elnyelése.
  _punctSuppressClick();
  if (!commit) return;
  // Sorrend-változás index-alapon (nem `nextSibling`-gel: a konténerben
  // szövegcsomópont is állhat két sor között).
  var rows = _punctRows();
  var curIdx = rows.indexOf(st.row);
  var tgtIdx = st.before ? rows.indexOf(st.before) : rows.length;
  if (tgtIdx > curIdx) tgtIdx--;                           // önmagát kivéve
  if (tgtIdx === curIdx) return;                           // ugyanoda engedte vissza
  if (st.before) st.pc.insertBefore(st.row, st.before);
  else           st.pc.appendChild(st.row);
  _punctRenumber();
  if (typeof _syncTripTimesFromPuncte === 'function') _syncTripTimesFromPuncte();
  draftSave();
  st.row.classList.add('punct-dropped');
  setTimeout(function () { st.row.classList.remove('punct-dropped'); }, 500);
}

function _punctSuppressClick() {
  var sup = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
  document.addEventListener('click', sup, true);
  setTimeout(function () { document.removeEventListener('click', sup, true); }, 350);
}

// A helyi (böngésző) mai dátum YYYY-MM-DD alakban — a per-tétel dátum-mező
// alapértelmezett értéke (a sofőr csak akkor módosítja, ha nem ma tankolt/
// vásárolt).
function _todayLocalDate(){
  var d = new Date();
  var p = function(n){ return String(n).padStart(2,'0'); };
  return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
}

// ── Menetlevél Plecare/Sosire dialógus (indulási/érkezési hely) ──
// A sofőr az ÚJ menetlevél nyitásakor beírja, honnan indul (Plecare); a
// beküldéskor beírja, hova érkezett (Sosire). Alap: az utoljára használt
// helyszín (localStorage), első alkalommal „Garaj-Arcus". A dátum kötelező
// (alap: ma), az óra+perc opcionális. A kitöltött értékek egy új Plecare/
// Sosire puncte-sort adnak a menetlevélhez, és a cég-szintű memória a
// KÖVETKEZŐ menetlevélnél is felajánlja.
var LS_GARAJ_START = 'vs_sofer_garaj_start';
var LS_GARAJ_END   = 'vs_sofer_garaj_end';
var GARAJ_DEFAULT  = 'Garaj-Arcus';
// A memoriál sofőrönként külön: a közös telefonra több sofőr is beléphet,
// az ő „garaj"-uk lehet más. A kulcshoz a bejelentkezett email-t fűzzük;
// visszafelé kompatibilitás: ha nincs még sofőr-specifikus érték, egyszer
// átvesszük a régi (közös) kulcsot fallbackként.
function _driverStoreKey(base) {
  var email = (typeof _meData === 'object' && _meData && _meData.email) ? String(_meData.email).toLowerCase() : '';
  return base + (email ? ':' + email : '');
}
function _getLastLoc(baseKey) {
  try {
    var perDriver = localStorage.getItem(_driverStoreKey(baseKey));
    if (perDriver && perDriver.trim()) return perDriver;
    var shared = localStorage.getItem(baseKey);       // legacy közös érték
    return (shared && shared.trim()) ? shared : GARAJ_DEFAULT;
  } catch (e) { return GARAJ_DEFAULT; }
}
function _setLastLoc(baseKey, val) {
  try { if (val && val.trim()) localStorage.setItem(_driverStoreKey(baseKey), val.trim()); } catch (e) {}
}

// JSON per-driver helper — a mentett menetlevél-piszkozat + AI bon-scan
// várólista + minden más „a következő menetlevélre megjegyzett" adat
// ugyanezt a mintát követi. Legacy közös kulcs egyszeri fallback (nem
// írjuk felül, csak átvesszük a következő mentésig).
function _perDriverGetJson(baseKey, defaultVal) {
  try {
    var perDriver = localStorage.getItem(_driverStoreKey(baseKey));
    if (perDriver !== null) return JSON.parse(perDriver);
    var legacy = localStorage.getItem(baseKey);
    if (legacy !== null) {
      try { localStorage.setItem(_driverStoreKey(baseKey), legacy); } catch (e) {}
      return JSON.parse(legacy);
    }
    return (typeof defaultVal !== 'undefined') ? defaultVal : null;
  } catch (e) { return (typeof defaultVal !== 'undefined') ? defaultVal : null; }
}
function _perDriverSetJson(baseKey, val) {
  try { localStorage.setItem(_driverStoreKey(baseKey), JSON.stringify(val == null ? null : val)); } catch (e) {}
}

// wbLocDialog(kind, cb): kind = 'start' | 'end'; cb(null) = mégse, cb({loc,date,time})
function wbLocDialog(kind, cb) {
  var m = document.getElementById('wbLocModal');
  if (!m) { cb(null); return; }
  var isStart = (kind === 'start');
  var lastLoc = isStart ? _getLastLoc(LS_GARAJ_START) : _getLastLoc(LS_GARAJ_END);
  document.getElementById('wbLocTitle').textContent = isStart ? t('sof.wb.startTitle') : t('sof.wb.endTitle');
  document.getElementById('wbLocHint').textContent  = isStart ? t('sof.wb.startHint')  : t('sof.wb.endHint');
  document.getElementById('wbLocInput').value = lastLoc;
  document.getElementById('wbLocDate').value  = _todayLocalDate();
  document.getElementById('wbLocHour').value  = '';
  document.getElementById('wbLocMin').value   = '';
  document.getElementById('wbLocOk').onclick = function () {
    var loc = document.getElementById('wbLocInput').value.trim();
    if (!loc) { toast(t('sof.wb.locRequired'), 'err'); return; }
    // Dátum KÖTELEZŐ — a menetlevél „Út időpontjai" (kezdő/záró dátum)
    // ebből képződik, ezért nem lehet üres. Az alapérték a ma, de a
    // sofőr átírhatja; kiürítés + OK = hibaüzenet.
    var date = (document.getElementById('wbLocDate').value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast(t('sof.wb.dateRequired'), 'err'); return; }
    var hhRaw = document.getElementById('wbLocHour').value;
    var mmRaw = document.getElementById('wbLocMin').value;
    var timeStr = '';
    if (hhRaw !== '' || mmRaw !== '') {
      var h = parseInt(hhRaw || '0', 10); if (isNaN(h)) h = 0; h = Math.max(0, Math.min(23, h));
      var mn = parseInt(mmRaw || '0', 10); if (isNaN(mn)) mn = 0; mn = Math.max(0, Math.min(59, mn));
      timeStr = String(h).padStart(2, '0') + ':' + String(mn).padStart(2, '0');
    }
    _setLastLoc(isStart ? LS_GARAJ_START : LS_GARAJ_END, loc);
    m.style.display = 'none';
    cb({ loc: loc, date: date, time: timeStr });
  };
  document.getElementById('wbLocCancel').onclick = function () {
    m.style.display = 'none';
    cb(null);
  };
  m.style.display = 'flex';
  setTimeout(function () {
    var el = document.getElementById('wbLocInput');
    if (el) { el.focus(); try { el.select(); } catch (e) {} }
  }, 100);
}

function addAlimRow(a) {
  alimIdx++;
  a = a || {};
  var dt = (typeof a.data === 'string' && a.data) ? a.data.slice(0,10) : _todayLocalDate();
  var d = document.createElement('div');
  d.className = 'dyn-row';
  d.innerHTML = '<button class="del-row" onclick="this.parentNode.remove();draftSave()">✕</button>'
    + '<div class="g2">'
    + '<div class="field"><label>' + t('sof.location') + '</label><input class="input alim-loc" placeholder="' + t('sof.alimLocPh') + '" value="' + (a.loc || '') + '" oninput="draftSave()"></div>'
    + '<div class="field"><label>' + t('sof.date') + '</label><input class="input alim-data" type="date" value="' + dt + '" onchange="draftSave()"></div>'
    + '</div>'
    + '<div class="g2">'
    + '<div class="field"><label>' + t('sof.fuelType') + '</label><select class="input alim-tip" style="padding:10px 14px;" onchange="draftSave()"><option' + (a.tip === 'AdBlue' ? '' : ' selected') + '>Motorină</option><option' + (a.tip === 'AdBlue' ? ' selected' : '') + '>AdBlue</option></select></div>'
    + '<div class="field"><label>' + t('sof.liters') + '</label><input class="input alim-lit" type="number" value="' + (a.litru || '0') + '" inputmode="numeric" oninput="draftSave()"></div>'
    + '</div>'
    + '<div class="g3">'
    + '<div class="field"><label>' + t('sof.km') + '</label><input class="input alim-km" type="number" value="' + (a.km || '0') + '" inputmode="numeric" oninput="draftSave()"></div>'
    + '<div class="field"><label>' + t('sof.payment') + '</label><select class="input alim-plata" style="padding:10px 14px;" onchange="draftSave()"><option>Card</option><option>Cash</option><option>Flota Card</option><option>DKV</option></select></div>'
    + '<div class="field"><label>' + t('sof.sumRon') + '</label><input class="input alim-suma" type="number" value="' + (a.suma || '0') + '" inputmode="numeric" oninput="draftSave()"></div>'
    + '</div>';
  document.getElementById('alimentariContainer').appendChild(d);
  // Plată visszaállítás
  if (a.plata) {
    var sel = d.querySelector('.alim-plata');
    if (sel) sel.value = a.plata;
  }
}

function addAchRow(a) {
  achIdx++;
  a = a || {};
  var dt = (typeof a.data === 'string' && a.data) ? a.data.slice(0,10) : _todayLocalDate();
  var d = document.createElement('div');
  d.className = 'dyn-row';
  d.innerHTML = '<button class="del-row" onclick="this.parentNode.remove();draftSave()">✕</button>'
    + '<div class="field"><label>' + t('sof.product') + '</label><input class="input ach-prod" placeholder="' + t('sof.achProdPh') + '" value="' + (a.produs || '') + '" oninput="draftSave()"></div>'
    + '<div class="g3">'
    + '<div class="field"><label>' + t('sof.location') + '</label><input class="input ach-loc" placeholder="' + t('sof.achLocPh') + '" value="' + (a.loc || '') + '" oninput="draftSave()"></div>'
    + '<div class="field"><label>' + t('sof.date') + '</label><input class="input ach-data" type="date" value="' + dt + '" onchange="draftSave()"></div>'
    + '<div class="field"><label>' + t('sof.sumRon') + '</label><input class="input ach-pret" type="number" value="' + (a.pret || '0') + '" inputmode="numeric" oninput="draftSave()"></div>'
    + '</div>'
    + '<div class="field"><label>' + t('sof.payment') + '</label><select class="input ach-plata" style="padding:10px 14px;" onchange="draftSave()"><option>Card</option><option>Cash</option><option>Flota Card</option><option>DKV</option></select></div>';
  document.getElementById('achizitiiContainer').appendChild(d);
  if (a.plata) {
    var sel = d.querySelector('.ach-plata');
    if (sel) sel.value = a.plata;
  }
}

// ============================================================
// 📷 BON SZKENNELÉS (AI) — HÁTTÉR-FELDOLGOZÁS + PERZISZTENS
// VÁRÓLISTA. A sofőr főoldalról vagy a menetlevél 2. lépéséből
// koppinthat egy bonra; a fájl kliens-oldalon (canvas) lekicsinyül,
// és háttérben (fetch, keepalive) elindul a Gemini kiolvasás. A
// sofőr közben mást csinál, akár ki is lép a képernyőről; a
// feldolgozott bonok „Bon eredmények" kártyaként jelennek meg a
// főoldalon — kattintásra elfogadhatók (a menetlevél-piszkozatba
// kerülnek) vagy elvethetők.
//
// Perzisztencia: localStorage (LS_RCPT_QUEUE_KEY). A teljes fotót
// NEM tároljuk (méret-korlát); csak egy kis thumbnailt őrzünk meg
// megjelenítéshez, és a Gemini kiolvasott mezőit.
// ============================================================

// Ha az admin/manager a Menetlevelek fülön KIKAPCSOLTA az AI-t (vagy
// nincs GEMINI_API_KEY a szerveren), a főoldali + menetlevél-lépés-2
// bon-szkennelés gombjai NE látszódjanak — értelmetlen lenne értük
// koppintani. A szerver oldalán is védve van (scanReceipt tiltás), ez
// csak a UI-t igazítja. Ha a hívás sikertelen (pl. régi szerver, ahol
// a getMyBonScanEnabled RPC még nem létezik), inkább MUTATJUK a
// gombot (biztonságosabb → a szerver úgyis eldönti).
function applyBonScanVisibility() {
  fetch('/api/execute', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getMyBonScanEnabled' })
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var r = (d && d.result) || {};
      // Alapból: mutass — ne rejts pillanatra betöltéskor.
      var usable = (r.ok === false) ? true : !!r.usable;
      _setBonScanVisible(usable);
    })
    .catch(function () { _setBonScanVisible(true); });
}

function _setBonScanVisible(visible) {
  // Főoldali narancs kártya (a dashboard-on)
  var dashCard = document.querySelector('.dash-scan-card');
  if (dashCard) dashCard.style.display = visible ? '' : 'none';
  // A menetlevél 1. lépéses (egyesített) + 2. lépéses fuel/purchase scan-gombok
  var stepBtns = document.querySelectorAll('#fuvarStep1 .scan-btn, #fuvarStep2 .scan-btn');
  stepBtns.forEach(function (b) { b.style.display = visible ? '' : 'none'; });
  // A menetlevél 1. lépéses várólista-doboz (a főoldali a .dash-scan-card-ban van)
  var step1Pending = document.getElementById('fuvarStep1PendingBox');
  if (step1Pending && !visible) { step1Pending.style.display = 'none'; }
}
var _receiptScanKind = null;     // 'fuel' | 'purchase' | null (dashboardról jött)
var LS_RCPT_QUEUE_KEY = 'vs_sofer_receipt_queue';
var RCPT_MAX_ITEMS    = 20;      // a régiek magától kiesnek (FIFO)

// A bon-scan várólista sofőrönként külön (`_perDriverGetJson`): egy közös
// telefonon másik sofőr nem látja/nem tudja elfogadni az előző sofőr
// scannelt bonjait. Legacy közös kulcs egyszeri fallback (nem íródik
// felül; a következő mentés már csak a per-driver kulcsba kerül).
function rcptQueueLoad() { return _perDriverGetJson(LS_RCPT_QUEUE_KEY, []) || []; }
function rcptQueueStore(arr) {
  // Régi elemek levágása (méret-védelem — FIFO)
  _perDriverSetJson(LS_RCPT_QUEUE_KEY, (arr || []).slice(-RCPT_MAX_ITEMS));
}
function rcptQueueAdd(item) {
  var q = rcptQueueLoad(); q.push(item); rcptQueueStore(q); return item.id;
}
function rcptQueueUpdate(id, patch) {
  var q = rcptQueueLoad();
  for (var i = 0; i < q.length; i++) if (q[i].id === id) {
    q[i] = Object.assign({}, q[i], patch); rcptQueueStore(q); return q[i];
  }
  return null;
}
function rcptQueueRemove(id) {
  var q = rcptQueueLoad().filter(function (x) { return x.id !== id; });
  rcptQueueStore(q);
}
function rcptNewId() {
  return 'r' + Date.now() + Math.random().toString(36).slice(2, 8);
}

// A főoldali „📷 Bon szkennelés" gomb — a Gemini dönti el, tankolás
// vagy vásárlás (a szerver „kind"-ja fehérlistázott).
function scanReceiptPickFromDash() {
  _receiptScanKind = null;
  var f = document.getElementById('receiptScanFile');
  if (!f) return;
  f.value = '';
  f.click();
}

// A menetlevél 2. lépésének két gombja (fuel/purchase) — a felhasználó
// választása fallback, ha a Gemini nem tud dönteni.
function scanReceiptPick(kind) {
  _receiptScanKind = (kind === 'purchase') ? 'purchase' : 'fuel';
  var f = document.getElementById('receiptScanFile');
  if (!f) return;
  f.value = '';
  f.click();
}

// Kép lekicsinyítése base64-be + thumbnail. PDF-nél nincs thumbnail (a
// FileReader csak a nyers base64-et adja); a queue-listán ikonnal jelöljük.
function _receiptToPayload(file, cb) {
  if (!file) { cb(null); return; }
  if (file.type === 'application/pdf') {
    var fr = new FileReader();
    fr.onload = function () {
      var s = String(fr.result || '');
      var i = s.indexOf(',');
      cb({ mimeType: 'application/pdf', data: i >= 0 ? s.slice(i + 1) : s, thumb: '' });
    };
    fr.onerror = function () { cb(null); };
    fr.readAsDataURL(file);
    return;
  }
  var img = new Image();
  var url = URL.createObjectURL(file);
  img.onload = function () {
    try {
      // Full képet a szerverre (1600px hosszú oldal, JPEG q=0.85).
      var maxDim = 1600;
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      var scale = Math.min(1, maxDim / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
      var fullDataUrl = cv.toDataURL('image/jpeg', 0.85);
      var i = fullDataUrl.indexOf(',');
      var b64 = i >= 0 ? fullDataUrl.slice(i + 1) : fullDataUrl;
      // Külön kis thumbnail (128px), csak megjelenítéshez.
      var tScale = Math.min(1, 128 / Math.max(w, h));
      var tw = Math.round(w * tScale), th = Math.round(h * tScale);
      var tv = document.createElement('canvas');
      tv.width = tw; tv.height = th;
      tv.getContext('2d').drawImage(img, 0, 0, tw, th);
      var thumb = tv.toDataURL('image/jpeg', 0.7);
      cb({ mimeType: 'image/jpeg', data: b64, thumb: thumb });
    } catch (e) { cb(null); }
    finally { URL.revokeObjectURL(url); }
  };
  img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
  img.src = url;
}

// Háttérben elindítjuk a feldolgozást; a UI azonnal frissül (van egy új
// „processing" sor a listában), és a sofőr mást csinálhat.
//
// FONTOS: a scan-fetch NEM `keepalive:true` — a Fetch-spec a keepalive
// kéréseket 64 KiB body-ra korlátozza. Egy 1600px-re méretezett JPEG
// base64-je is bőven 100–500 KB → keepalive-vel a böngésző el se küldi
// (TypeError → .catch() → „Nem sikerült beolvasni a bont"). Ez volt a
// gyökérok, amiért a bon-scan látszólag „nem működött". A perzisztens
// localStorage queue + a queueMaint 3-perces takarítás gondoskodik
// arról, hogy oldal-elhagyáskor sem vész el semmi (a folyamatban lévő
// sor error-ra vált, a sofőr újra tudja fotózni).
function scanReceiptStart(file) {
  var busy = document.getElementById('receiptScanBusy');
  if (busy) busy.style.display = 'block';
  _receiptToPayload(file, function (payload) {
    if (busy) busy.style.display = 'none';
    if (!payload) { toast(t('sof.scanReadErr'), 'err'); return; }

    // Új queue-elem — csak a thumbnailt tároljuk (a nyers base64-et NEM)
    var id = rcptNewId();
    rcptQueueAdd({
      id: id,
      createdAt: Date.now(),
      status: 'processing',
      kindHint: _receiptScanKind, // 'fuel' | 'purchase' | null
      thumb: payload.thumb || '',
      fields: null,
      error: null
    });
    renderPendingReceipts();
    toast(t('sof.scanQueued'), 'ok');

    // Auto-retry hálózati vagy átmeneti szerver-hibánál (429/503/5xx).
    // A payload (base64) végig a closure-ban él → a retry a memóriában
    // meglévő képet küldi újra (nem kell újra fotózni). Nem-átmeneti
    // hibáknál (400, tiltás, konfig-hiba) azonnal error → NINCS retry.
    _scanReceiptTry(id, payload, 0);
  });
}

// Egy próbálkozás — sikertelenség esetén rekurzívan indítja a következőt
// backoff-fal. `attempt` 0-alapú; MAX_ATTEMPTS a felső határ.
function _scanReceiptTry(id, payload, attempt) {
  var MAX_ATTEMPTS = 3;
  var BACKOFFS = [0, 5000, 15000]; // 0s, 5s, 15s — kb. 20 mp max összesen
  var wait = BACKOFFS[attempt] || 15000;

  // A queue-elemet frissítjük, hogy a UI mutassa a próbálkozás-számot.
  if (attempt > 0) {
    rcptQueueUpdate(id, {
      status: 'processing', error: null,
      attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS
    });
    renderPendingReceipts();
  }

  setTimeout(function () {
    // NINCS `keepalive:true` — a base64 kép jellemzően 100–500 KB, a
    // spec 64 KiB-re korlátozza a keepalive body-t → TypeError → .catch().
    // A perzisztens localStorage queue + a queueMaint 3 perces takarítás
    // fedezi az oldal-elhagyás esetét (ld. a scanReceiptStart komment).
    fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName: 'scanReceipt', arguments: [{
        mimeType: payload.mimeType, data: payload.data
      }] })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var r = (d && d.result) || {};
        if (r.ok) {
          var f = r.fields || {};
          var kind = (f.kind === 'fuel' || f.kind === 'purchase')
            ? f.kind
            : (_receiptScanKind || 'purchase');
          rcptQueueUpdate(id, { status: 'ready', fields: f, kind: kind, attempt: null, maxAttempts: null });
          renderPendingReceipts();
          return;
        }
        // Átmeneti szerver-hiba: 429 (kvóta/limit), 503 (túlterhelés),
        // 5xx (belső hiba). Végleges: 400 (rossz kérés), 403 (tiltás),
        // egyéb 4xx → nincs értelme újrapróbálni.
        var status = r.status || 0;
        var transient = (status === 429 || status === 503 || status >= 500);
        if (transient && attempt + 1 < MAX_ATTEMPTS) {
          _scanReceiptTry(id, payload, attempt + 1);
          return;
        }
        rcptQueueUpdate(id, { status: 'error', error: r.err || t('sof.scanFailed'), attempt: null, maxAttempts: null });
        renderPendingReceipts();
      })
      .catch(function () {
        // Hálózati hiba → mindig átmeneti, retry-oljuk (a MAX-ig).
        if (attempt + 1 < MAX_ATTEMPTS) {
          _scanReceiptTry(id, payload, attempt + 1);
          return;
        }
        rcptQueueUpdate(id, { status: 'error', error: t('sof.scanFailed'), attempt: null, maxAttempts: null });
        renderPendingReceipts();
      });
  }, wait);
}

// A főoldali kártya frissítése.
function renderPendingReceipts() {
  // Több konténer is lehet: a főoldali kártya és a menetlevél 1. lépése
  // (az egyesített „Menetlevél létrehozása" képernyő) — ugyanaz a várólista.
  var boxes = document.querySelectorAll('.pending-receipts-box');
  if (!boxes.length) return;
  var q = rcptQueueLoad();
  if (!q.length) {
    boxes.forEach(function (b) { b.style.display = 'none'; b.innerHTML = ''; });
    return;
  }
  var html = q.slice().reverse().map(function (it) {
    var badge = '', title = '';
    if (it.status === 'processing') {
      var attSuffix = (it.attempt && it.maxAttempts)
        ? ' (' + it.attempt + '/' + it.maxAttempts + ')'
        : '';
      badge = '<span class="pending-badge pb-processing">' + t('sof.rr.processing') + attSuffix + '</span>';
      title = (it.attempt && it.attempt > 1) ? t('sof.rr.retrying') : t('sof.rr.processingTitle');
    } else if (it.status === 'ready') {
      badge = '<span class="pending-badge pb-ready">' + t('sof.rr.ready') + '</span>';
      var f = it.fields || {};
      title = (it.kind === 'fuel' ? '⛽ ' : '🛒 ') + (f.loc || '—') + (f.suma != null ? (' · ' + f.suma + ' ' + (f.valuta || '')) : '');
    } else {
      badge = '<span class="pending-badge pb-error">' + t('sof.rr.error') + '</span>';
      title = it.error || t('sof.scanFailed');
    }
    var timeStr = new Date(it.createdAt).toLocaleTimeString();
    var thumb = it.thumb
      ? '<img class="pending-thumb" src="' + it.thumb + '" alt="">'
      : '<div class="pending-thumb" style="display:flex;align-items:center;justify-content:center;font-size:22px;">📄</div>';
    var actions = '';
    if (it.status === 'ready') {
      actions = '<button class="btn-mini ok" onclick="rrOpen(\'' + it.id + '\')">' + t('sof.rr.review') + '</button>'
              + '<button class="btn-mini err" onclick="rrRemove(\'' + it.id + '\')">✕</button>';
    } else if (it.status === 'error') {
      actions = '<button class="btn-mini err" onclick="rrRemove(\'' + it.id + '\')">✕</button>';
    } else {
      actions = '<div class="spinner"></div>';
    }
    return '<div class="pending-item">'
      + thumb
      + '<div class="pending-body"><div class="pending-title">' + badge + title + '</div>'
      + '<div class="pending-sub">' + timeStr + '</div></div>'
      + '<div class="pending-actions">' + actions + '</div>'
      + '</div>';
  }).join('');
  boxes.forEach(function (b) { b.style.display = 'block'; b.innerHTML = html; });
}

// ─── Review modal — a sofőr átnézheti/javíthatja a mezőket, majd
// elfogadhatja (a menetlevél-piszkozatba kerül).
var _rrCurrentId = null;

function rrOpen(id) {
  var q = rcptQueueLoad();
  var it = null;
  for (var i = 0; i < q.length; i++) if (q[i].id === id) { it = q[i]; break; }
  if (!it || it.status !== 'ready') return;
  _rrCurrentId = id;

  var thumbEl = document.getElementById('rrThumbWrap');
  thumbEl.innerHTML = it.thumb
    ? '<img src="' + it.thumb + '" style="max-width:120px;max-height:120px;border-radius:10px;border:1px solid var(--border);">'
    : '';

  var f = it.fields || {};
  var isFuel = it.kind === 'fuel';
  var esc2 = function (v) { return (v == null) ? '' : String(v).replace(/"/g, '&quot;'); };
  var fields = document.getElementById('rrFields');
  var plataOpts = ['Card', 'Cash', 'Flota Card', 'DKV'].map(function (p) {
    return '<option' + (f.plata === p ? ' selected' : '') + '>' + p + '</option>';
  }).join('');
  var rows = '';
  rows += '<div class="rr-row"><label>' + t('sof.rr.kind') + '</label>'
        + '<select id="rrKind"><option value="fuel"' + (isFuel ? ' selected' : '') + '>⛽ ' + t('sof.rr.kindFuel') + '</option>'
        + '<option value="purchase"' + (!isFuel ? ' selected' : '') + '>🛒 ' + t('sof.rr.kindPurchase') + '</option></select></div>';
  rows += '<div class="rr-row"><label>' + t('sof.location') + '</label><input id="rrLoc" value="' + esc2(f.loc) + '"></div>';
  rows += '<div class="rr-row"><label>' + t('sof.date') + '</label><input id="rrData" type="date" value="' + esc2(f.data || _todayLocalDate()) + '"></div>';
  if (isFuel) {
    rows += '<div class="rr-row"><label>' + t('sof.fuelType') + '</label>'
          + '<select id="rrTip"><option' + (f.tip === 'AdBlue' ? '' : ' selected') + '>Motorină</option>'
          + '<option' + (f.tip === 'AdBlue' ? ' selected' : '') + '>AdBlue</option></select></div>';
    rows += '<div class="rr-row"><label>' + t('sof.liters') + '</label><input id="rrLitru" type="number" value="' + esc2(f.litru != null ? f.litru : 0) + '"></div>';
    rows += '<div class="rr-row"><label>' + t('sof.km') + '</label><input id="rrKm" type="number" value="' + esc2(f.km != null ? f.km : 0) + '"></div>';
  } else {
    rows += '<div class="rr-row"><label>' + t('sof.product') + '</label><input id="rrProdus" value="' + esc2(f.produs) + '"></div>';
  }
  rows += '<div class="rr-row"><label>' + t('sof.sumRon') + '</label><input id="rrSuma" type="number" value="' + esc2(f.suma != null ? f.suma : 0) + '"></div>';
  rows += '<div class="rr-row"><label>' + t('sof.payment') + '</label><select id="rrPlata">' + plataOpts + '</select></div>';
  fields.innerHTML = rows;

  // A „kind" váltásra újrarajzol (fuel↔purchase mezők váltása).
  document.getElementById('rrKind').addEventListener('change', function () {
    var it2 = rcptQueueLoad().find(function (x) { return x.id === _rrCurrentId; });
    if (!it2) return;
    it2.kind = document.getElementById('rrKind').value;
    // A már beírt közös mezőket megőrizzük (loc/data/suma/plata),
    // hogy a váltás után ne vesszen el a sofőr munkája.
    var cur = { loc: (document.getElementById('rrLoc') || {}).value, data: (document.getElementById('rrData') || {}).value,
                suma: (document.getElementById('rrSuma') || {}).value, plata: (document.getElementById('rrPlata') || {}).value };
    it2.fields = Object.assign({}, it2.fields || {}, cur);
    rcptQueueUpdate(_rrCurrentId, { kind: it2.kind, fields: it2.fields });
    rrOpen(_rrCurrentId);
  });

  document.getElementById('receiptReviewModal').style.display = 'flex';
}

function rrClose() {
  document.getElementById('receiptReviewModal').style.display = 'none';
  _rrCurrentId = null;
}

function rrDiscard() {
  if (!_rrCurrentId) { rrClose(); return; }
  if (!confirm(t('sof.rr.confirmDiscard'))) return;
  rrRemove(_rrCurrentId);
  rrClose();
}

function rrRemove(id) {
  rcptQueueRemove(id);
  renderPendingReceipts();
}

// A modal mezői → a sessionStorage-i menetlevél-piszkozatba egy új
// tankolás vagy vásárlás sor; ha a menetlevél 2. lépés éppen nyitva,
// a DOM sor is beszúródik.
function rrAccept() {
  if (!_rrCurrentId) return;
  var kind = (document.getElementById('rrKind') || {}).value || 'purchase';
  var loc  = (document.getElementById('rrLoc')  || {}).value || '';
  var data = (document.getElementById('rrData') || {}).value || _todayLocalDate();
  var suma = (document.getElementById('rrSuma') || {}).value || '0';
  var plata= (document.getElementById('rrPlata')|| {}).value || 'Card';

  var newRow;
  if (kind === 'fuel') {
    var tip   = (document.getElementById('rrTip')   || {}).value || 'Motorină';
    var litru = (document.getElementById('rrLitru') || {}).value || '0';
    var km    = (document.getElementById('rrKm')    || {}).value || '0';
    newRow = { loc: loc, data: data, tip: tip, litru: litru, km: km, plata: plata, suma: suma };
  } else {
    var produs = (document.getElementById('rrProdus') || {}).value || '';
    newRow = { produs: produs, loc: loc, data: data, pret: suma, plata: plata };
  }

  // Ha a menetlevél 2. lépés (fuvarStep2) nyitva van → közvetlenül a DOM-ba
  // teszem a sort (és a draftSave menti automatikusan). Különben a
  // sessionStorage-i piszkozatot módosítom közvetlenül, hogy a következő
  // fuvarStep2 megnyitásakor ott legyen a sor.
  var step2 = document.getElementById('fuvarStep2');
  var step2Visible = step2 && step2.style.display !== 'none';
  if (step2Visible && ((kind === 'fuel' && typeof addAlimRow === 'function')
                    || (kind === 'purchase' && typeof addAchRow === 'function'))) {
    if (kind === 'fuel') addAlimRow(newRow); else addAchRow(newRow);
    try { draftSave(); } catch (_) {}
  } else {
    // A jelenlegi piszkozatot betöltjük (ha van), és hozzáfűzzük az új
    // sort — a fuvarStep2 legközelebbi megnyitásakor a draftRestore() ezt
    // visszaállítja. Ha még nincs draft, alap-vázlatot indítunk.
    var st = (function () { try { return JSON.parse(sessionStorage.getItem(SS_KEY) || '{}'); } catch (_) { return {}; } })();
    var draft = st.draft || {
      camion: '', remorca: '', kmInc: '0', kmSf: '0', cantInc: '0', cantSf: '0',
      mentiuni: '', puncte: [], alimentari: [], achizitii: [], orderIds: [], summary: ''
    };
    if (kind === 'fuel') { draft.alimentari = draft.alimentari || []; draft.alimentari.push(newRow); }
    else { draft.achizitii = draft.achizitii || []; draft.achizitii.push(newRow); }
    st.draft = draft;
    try { sessionStorage.setItem(SS_KEY, JSON.stringify(st)); } catch (_) {}
  }

  // ── TANULÁS: a sofőr által megerősített (esetleg javított) mezőket
  // elküldjük a szervernek, hogy a receipt_scan_samples-be kerüljenek
  // template-ként. Legközelebb ugyanattól a kereskedőtől (MOL/OMV/
  // Kaufland stb.) beérkező bonok pontosabban kiolvasódnak — a Gemini
  // few-shot promptja tartalmazni fogja a mostani mezőket. Best-effort:
  // hiba esetén NEM törünk semmit (a piszkozatba már bekerült a sor).
  try {
    // Az eredeti queue-tétel valuta-ja (a modal-ban nem szerkeszthető)
    var _q = rcptQueueLoad(), _origVal = null;
    for (var _i = 0; _i < _q.length; _i++) {
      if (_q[_i].id === _rrCurrentId && _q[_i].fields) { _origVal = _q[_i].fields.valuta || null; break; }
    }
    var confirmed = {
      kind: kind,
      loc: loc,
      data: data,
      plata: plata,
      suma: parseFloat(suma) || null,
      valuta: _origVal,
      tip:    (kind === 'fuel')     ? tip : null,
      litru:  (kind === 'fuel')     ? (parseFloat(litru) || null) : null,
      km:     (kind === 'fuel')     ? (parseFloat(km)    || null) : null,
      produs: (kind === 'purchase') ? produs : null,
      confidence: 1.0
    };
    fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ functionName: 'confirmReceiptExtraction', arguments: [{ fields: confirmed }] })
    }).catch(function () { /* best-effort — a UI menete független */ });
  } catch (_) { /* nincs baj — csak nem tanul ebből a bonból */ }

  toast(t('sof.rr.accepted'), 'ok');
  rcptQueueRemove(_rrCurrentId);
  renderPendingReceipts();
  rrClose();
}

document.addEventListener('DOMContentLoaded', function () {
  var f = document.getElementById('receiptScanFile');
  if (f) f.addEventListener('change', function () {
    if (f.files && f.files[0]) scanReceiptStart(f.files[0]);
  });

  // Ha az előző munkamenetben a fetch nem tudott befejeződni (app leállt,
  // hálózat megszakadt), a „processing" tétel örökké függőben maradna →
  // átvisszük „error"-ra, hogy legalább el lehessen vetni. A már ready
  // (kiolvasott) és error tételek maradnak. Küszöb: 3 perc — hogy a
  // legrosszabb esetben (3 retry × 30s Gemini timeout + 20s backoff)
  // se törjük meg a folyamatot, ami még lehet, hogy csak most fejeződik be.
  var q = rcptQueueLoad();
  var changed = false;
  var now = Date.now();
  for (var i = 0; i < q.length; i++) {
    if (q[i].status === 'processing' && (now - (q[i].createdAt || 0) > 3 * 60 * 1000)) {
      q[i].status = 'error';
      q[i].error = t('sof.rr.interrupted');
      changed = true;
    }
  }
  if (changed) rcptQueueStore(q);
  renderPendingReceipts();
});

// ============================================================
// HATÁRÁTLÉPÉS SOROK
// ============================================================
function addHatarRow(dt, dir) {
  dt = dt || '';
  dir = dir || 'OUT';
  var c = document.getElementById('hatarContainer');
  var row = document.createElement('div');
  row.className = 'dynamic-row';
  row.innerHTML = '<input class="input" type="datetime-local" value="' + dt + '" style="flex:2;" placeholder="Dátum + óra">'
    + '<select class="select" style="flex:1;">'
    + '<option value="OUT"' + (dir === 'OUT' ? ' selected' : '') + '>' + t('sofer.crossOut') + '</option>'
    + '<option value="IN"' + (dir === 'IN' ? ' selected' : '') + '>' + t('sofer.crossIn') + '</option>'
    + '</select>'
    + '<button class="del-row-btn" onclick="this.parentElement.remove();updateDiurnaPreview()">✕</button>';
  c.appendChild(row);
  row.querySelector('input[type=datetime-local]').addEventListener('change', updateDiurnaPreview);
  row.querySelector('select').addEventListener('change', updateDiurnaPreview);
}

function collectHataratok() {
  var rows = document.querySelectorAll('#hatarContainer .dynamic-row');
  var result = [];
  rows.forEach(function(row) {
    var dt = row.querySelector('input[type=datetime-local]').value;
    var dir = row.querySelector('select').value;
    if (dt) result.push({ datetime: dt, direction: dir });
  });
  return result.sort(function(a, b) { return a.datetime.localeCompare(b.datetime); });
}

function updateDiurnaPreview() {
  var dep = document.getElementById('fIndulasDt').value;
  var arr = document.getElementById('fErkezesDt').value;
  var el = document.getElementById('diurnaPreview');
  if (!dep || !arr) { el.style.display = 'none'; return; }
  // Kliens oldali gyors előnézet (szerver a mentéskor számol véglegesen)
  var depD = dep.slice(0, 10), arrD = arr.slice(0, 10);
  var crossings = collectHataratok();
  var days = Math.ceil((new Date(arr) - new Date(dep)) / 86400000) + 1;
  el.style.display = 'block';
  el.textContent = '🕐 Út: ' + depD + ' → ' + arrD + ' · ' + days + ' nap · ' + crossings.length + ' határátlépés rögzítve';
}

// ============================================================
// MENETLEVÉL BEKÜLDÉS
// ============================================================
function submitFuvarlevel() {
  // Ha még nincs Sosire (érkezési) sor a puncte-ban, elsőként azt kérdezzük
  // be egy modal-on (a sofőr megadja, hová érkezett). Ha mégse — nem
  // küldünk. Ha van már Sosire, egyből megy a beküldés (retry, vagy a
  // sofőr korábban maga adott hozzá).
  var hasSosire = false;
  document.querySelectorAll('#puncteContainer .dyn-row').forEach(function (row) {
    if ((row.querySelector('.punct-tip') || {}).value === 'Sosire') hasSosire = true;
  });
  if (!hasSosire) {
    wbLocDialog('end', function (res) {
      if (!res) return;   // Mégse — nem küldünk, marad az űrlap
      addPunctRow(res.loc, 'Sosire', res.date, { time: res.time });
      draftSave();
      _submitFuvarlevelFinal();
    });
    return;
  }
  _submitFuvarlevelFinal();
}

function _submitFuvarlevelFinal() {
  // Az „Út időpontjai" (fIndulasDt/fErkezesDt) mostantól a Plecare/Sosire
  // pontok dátumából automatikusan képződik. Beküldés előtt egy utolsó
  // sync — biztosan a legfrissebb értékek kerüljenek a payload-ba.
  if (typeof _syncTripTimesFromPuncte === 'function') _syncTripTimesFromPuncte();
  var fisa = (document.getElementById('fFisa') ? document.getElementById('fFisa').value.trim() : '');
  // Sorszámot a szerver generálja automatikusan

  var puncte = [];
  document.querySelectorAll('#puncteContainer .dyn-row').forEach(function(row) {
    var punct = {
      tip: (row.querySelector('.punct-tip') || {}).value || '',
      loc: (row.querySelector('.punct-loc') || {}).value || '',
      data: (row.querySelector('.punct-data') || {}).value || ''
    };
    // Fuvar-visszakötő tag-ek: a driver által megadott felrakási/lerakási
    // dátum a szerveren átmegy az `orders.incarcat_at`/`descarcat_at`-ra.
    var oid  = row.getAttribute('data-order-id');
    var role = row.getAttribute('data-role');
    var tm   = row.getAttribute('data-time');
    if (oid)  punct.orderId = oid;
    if (role) punct.role = role;
    if (tm)   punct.time = tm;
    puncte.push(punct);
  });

  var alimentari = [];
  document.querySelectorAll('#alimentariContainer .dyn-row').forEach(function(row) {
    alimentari.push({
      loc: (row.querySelector('.alim-loc') || {}).value || '',
      data: (row.querySelector('.alim-data') || {}).value || '',
      tip: (row.querySelector('.alim-tip') || {}).value || 'Motorină',
      litru: parseFloat((row.querySelector('.alim-lit') || {}).value) || 0,
      km: parseFloat((row.querySelector('.alim-km') || {}).value) || 0,
      plata: (row.querySelector('.alim-plata') || {}).value || 'Card',
      suma: parseFloat((row.querySelector('.alim-suma') || {}).value) || 0
    });
  });

  var achizitii = [];
  document.querySelectorAll('#achizitiiContainer .dyn-row').forEach(function(row) {
    achizitii.push({
      produs: (row.querySelector('.ach-prod') || {}).value || '',
      loc: (row.querySelector('.ach-loc') || {}).value || '',
      data: (row.querySelector('.ach-data') || {}).value || '',
      pret: parseFloat((row.querySelector('.ach-pret') || {}).value) || 0,
      plata: (row.querySelector('.ach-plata') || {}).value || 'Card'
    });
  });

  var locPlecare = puncte.length ? puncte[0].loc : '';
  var locSosire = puncte.length > 1 ? puncte[puncte.length - 1].loc : '';

  var payload = {
    numarFisa: fisa,
    numarCamion: document.getElementById('fCamion').value,
    numarRemorca: document.getElementById('fRemorca').value,
    kmInceput: document.getElementById('fKmInc').value,
    kmSfarsit: document.getElementById('fKmSf').value,
    locPlecare: locPlecare,
    locSosire: locSosire,
    indulasDt: document.getElementById('fIndulasDt').value || null,
    erkezesDt: document.getElementById('fErkezesDt').value || null,
    hataratok: collectHataratok(),
    cantInceput: document.getElementById('fCantInc').value,
    cantSfarsit: document.getElementById('fCantSf').value,
    alteMentiuni: document.getElementById('fMentiuni').value,
    puncte: puncte,
    alimentari: alimentari,
    achizitii: achizitii,
    tranzite: [],
    orderIds: _selectedOrderIds
  };

  fetch('/api/fuvarlevel-save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload) })
  .then(function(r) { return r.json(); }).then(function(d) {
    if (d.success) {
      toast(d.docNumber ? (t('sof.waybillSentNum', { num: d.docNumber })) : t('sof.waybillSent'), 'ok');
      draftClear();
      // Sikeres beküldés után a hozzá tartozó HELYI piszkozatot is töröljük
      // (ha mentett piszkozatból indult), és frissítjük a listát.
      if (_curLocalDraftId) {
        soferStoreLocalDrafts(soferLoadLocalDrafts().filter(function (x) { return x.id !== _curLocalDraftId; }));
        _curLocalDraftId = null;
        if (typeof renderLocalDrafts === 'function') renderLocalDrafts();
      }
      _selectedOrderIds = [];
      goSec('dash');
      setTimeout(function() {
        document.getElementById('fuvarStep1').style.display = '';
        document.getElementById('fuvarStep2').style.display = 'none';
        document.getElementById('alimentariContainer').innerHTML = '';
        document.getElementById('achizitiiContainer').innerHTML = '';
        document.getElementById('puncteContainer').innerHTML = '';
        if(document.getElementById('fFisa')) document.getElementById('fFisa').value = '';
        document.getElementById('fCamion').value = '';
        document.getElementById('fRemorca').value = '';
        document.getElementById('fKmInc').value = '0';
        document.getElementById('fKmSf').value = '0';
        document.getElementById('fCantInc').value = '0';
        document.getElementById('fCantSf').value = '0';
        document.getElementById('fMentiuni').value = '';
        document.getElementById('fIndulasDt').value = '';
        document.getElementById('fErkezesDt').value = '';
        document.getElementById('hatarContainer').innerHTML = '';
        document.getElementById('diurnaPreview').style.display = 'none';
        alimIdx = 0; achIdx = 0; punctIdx = 0;
        loadSoferOrders();
      }, 500);
    } else {
      toast(t('common.error') + ': ' + (d.err || t('sof.unknown')), 'err');
    }
  }).catch(function() {
    // Nincs internet a beküldéshez → az adat NE vesszen el: automatikusan
    // a telefonra mentjük helyi piszkozatként, és jelezzük a sofőrnek.
    saveLocalDraft(true);
    toast(t('sof.offlineSaved'), 'err');
  });
}

// ============================================================
// IRATOK
// ============================================================
var selDocTip = 'CMR';
function selDocType(el, tip) {
  selDocTip = tip;
  document.querySelectorAll('.doc-type-btn').forEach(function(b) { b.classList.remove('sel'); });
  el.classList.add('sel');
}
function previewFile(input) {
  if (input.files && input.files[0]) {
    document.getElementById('filePreviewName').textContent = '📎 ' + input.files[0].name;
    document.getElementById('filePreview').style.display = 'block';
  }
}
function uploadDoc() {
  var file = document.getElementById('dFile').files[0];
  if (!file) { toast(t('sof.pickFile'), 'err'); return; }
  var orderId = (document.getElementById('docOrderSel') || {}).value || null;
  var fr = new FileReader();
  fr.onload = function(e) {
    fetch('/api/doc-upload', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: e.target.result, numeFisier: file.name, tip: selDocTip, orderId: orderId }) })
    .then(function(r) { return r.json(); }).then(function(d) {
      if (d.success) { toast(t('common.uploaded'), 'ok'); goSec('dash'); }
      else { toast(t('common.error') + ': ' + (d.err || t('sof.unknown')), 'err'); }
    });
  };
  fr.readAsDataURL(file);
}

// A fuvar-választó feltöltése a sofőr saját (aktív + friss) fuvarjaival.
// A dokumentum-feltöltésnél a nemrég lezárt fuvart is felkínáljuk (POD/CMR
// fotó utólagos csatolása), ezért waybill_visible-t használunk — nem dash_visible-t.
// (A főoldal dash_visible-je szigorúbb: Finalizat sosem látszik.)
function loadDocOrderOptions() {
  var sel = document.getElementById('docOrderSel');
  if (!sel) return;
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getMySoferOrders' }) })
  .then(function(r) { return r.json(); }).then(function(d) {
    var list = (d.result || []).filter(function(o) { return o.waybill_visible !== false; });
    sel.innerHTML = '<option value="">' + t('sofer.docNoOrder') + '</option>'
      + list.map(function(o) {
          return '<option value="' + o.id + '">' + o.id + ' — '
            + (o.loc_incarcare || '?') + ' → ' + (o.loc_descarcare || '?') + '</option>';
        }).join('');
  }).catch(function() {});
}


// ============================================================
// LOGOUT
// ============================================================
function logoutSofer() {
  stateClear();
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'authLogout' }) })
  .then(function() { window.location.href = '/login'; })
  .catch(function() { window.location.href = '/login'; });
}

// ============================================================
// NEKEM KIOSZTOTT JÁRMŰ (vontató + pótkocsi) — főoldali kiírás
// ============================================================
// A Belső sofőrök fülön az admin/manager rendeli hozzám a vontatót + a hozzá
// tartozó alapértelmezett pótkocsit. Itt a főoldal tetején látom a rendszámo(ka)t,
// és a menetlevél ezekből tölt előre (szerkeszthetően).
var _myAssignedVehicle = null;
function loadMyAssignedVehicle() {
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getMyAssignedVehicle' }) })
  .then(function(r) { return r.json(); }).then(function(d) {
    var res = d && d.result;
    _myAssignedVehicle = (res && res.ok && res.assigned) ? res.assigned : null;
    var box = document.getElementById('myVehicleBox');
    if (!box) return;
    if (!_myAssignedVehicle || !_myAssignedVehicle.rendszam_camion) { box.style.display = 'none'; return; }
    var v = _myAssignedVehicle;
    var rem = v.rendszam_remorca
      ? '<span style="margin-left:14px;">🚛 <b style="color:#0f172a;">' + esc(v.rendszam_remorca) + '</b></span>'
      : '';
    box.innerHTML = '<div style="background:linear-gradient(180deg,rgba(59,130,246,0.10),rgba(99,102,241,0.06));'
      + 'border:1px solid rgba(59,130,246,0.30);border-radius:14px;padding:12px 14px;margin-bottom:14px;">'
      + '<div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px;">'
      + t('sof.myVehicle') + '</div>'
      + '<div style="font-size:16px;color:#1e293b;">'
      + '🚚 <b style="color:#0f172a;">' + esc(v.rendszam_camion) + '</b>'
      + (v.marca ? ' <span style="font-size:12px;color:#64748b;">' + esc(v.marca) + (v.model ? ' ' + esc(v.model) : '') + '</span>' : '')
      + rem
      + '</div></div>';
    box.style.display = '';
  }).catch(function() {});
}

// A menetlevél kezdő üzemanyag-szintjének ÉS kezdő km-óra állásának előtöltése
// az adott rendszám utolsó menetleveléből (záró érték → új kezdő érték). Mindkét
// mezőt CSAK akkor tölti, ha üres/0 (a sofőr által beírt értéket sosem írjuk
// felül). A rendszám kézzel átírható, ezért a plate paramétert adjuk át.
function _fillIfEmpty(el, val) {
  if (!el || val == null) return;
  var now = String(el.value || '').trim();
  if (now !== '' && now !== '0') return;   // már beírt / átvitt érték — nem nyúlunk hozzá
  el.value = val;
}
function prefillWaybillReadings(plate) {
  var incEl = document.getElementById('fCantInc');   // kezdő üzemanyag
  var kmEl  = document.getElementById('fKmInc');      // kezdő km-óra
  if (!plate || (!incEl && !kmEl)) return;
  // Ha mindkét kezdő mezőben már van érték, nincs mit tenni.
  var fuelBusy = !incEl || (String(incEl.value || '').trim() !== '' && String(incEl.value || '').trim() !== '0');
  var kmBusy   = !kmEl  || (String(kmEl.value  || '').trim() !== '' && String(kmEl.value  || '').trim() !== '0');
  if (fuelBusy && kmBusy) return;
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getLastVehicleReadings', arguments: [plate] }) })
  .then(function(r) { return r.json(); }).then(function(d) {
    var res = d && d.result;
    if (!res || !res.ok) return;
    _fillIfEmpty(incEl, res.fuel);
    _fillIfEmpty(kmEl, res.km);
    if (typeof draftSave === 'function') { try { draftSave(); } catch (e) {} }
  }).catch(function() {});
}
// Visszafelé kompatibilis alias (a régi hívási pontokhoz).
function prefillFuelStart(plate) { return prefillWaybillReadings(plate); }

// ============================================================
// SAJÁT HAVI MINI-STATISZTIKA (főoldal) — motivációs összegző
// ============================================================
function loadSoferMiniStats() {
  var box = document.getElementById('soferMiniStats');
  if (!box) return;
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getMySoferStats' }) })
  .then(function(r) { return r.json(); }).then(function(d) {
    var s = d.result;
    if (!s || !s.ok) return;
    function n(x) { var v = parseFloat(x); return isFinite(v) ? v.toLocaleString(t('sof.locale'), { maximumFractionDigits: 0 }) : '0'; }
    // Világos téma: fehér kártya + olvasható sötét/akcentes szöveg. A méret/rács
    // az .sof-mstat* OSZTÁLYOKBÓL jön (sofer.css) — kompakt 2×2, ~20%-kal kisebb —,
    // NEM inline grid-stílusból (különben a style.css mobil felülírója
    // egyoszloposra törné). Per-csempe akcent a motivációs hatáshoz.
    // A csempe alá másodlagos sor(ok) kerülnek (.sof-mstat-prev) — apró szürke
    // múlt havi viszonyítás; 0 esetén is kiírjuk (motivációs hatás).
    // A KM csempe KÉT prev-sort mutat: „teljes hó" (GPS-delta) + „leadott"
    // (menetlevél-alap) — a többi csempe egyet.
    var lastMo = t('sof.lastMonthShort');
    var lblFull = t('sof.mstatFull');
    var lblSubm = t('sof.mstatSubmitted');
    function tile(ico, val, lbl, accent, prev, prev2) {
      return '<div class="sof-mstat">'
        + '<div class="sof-mstat-ico">' + ico + '</div>'
        + '<div class="sof-mstat-val" style="color:' + accent + ';">' + val + '</div>'
        + '<div class="sof-mstat-lbl">' + lbl + '</div>'
        + '<div class="sof-mstat-prev">' + prev + '</div>'
        + (prev2 ? '<div class="sof-mstat-prev">' + prev2 + '</div>' : '')
        + '</div>';
    }
    // KM csempe: „teljes hó" (GPS-delta, ha van) + „leadott" (menetlevél).
    // Ha nincs GPS-delta (km_prev_gps = 0), csak a „leadott" jelenik meg,
    // hogy ne legyen felesleges „teljes hó: 0" sor.
    var kmGps = parseFloat(s.km_prev_gps) || 0;
    var kmPrev1, kmPrev2;
    if (kmGps > 0) {
      kmPrev1 = lblFull + ': ' + n(kmGps);
      kmPrev2 = lblSubm + ': ' + n(s.km_prev);
    } else {
      kmPrev1 = lastMo + ': ' + n(s.km_prev);
      kmPrev2 = null;
    }

    // TANKOLVA csempe: átlagfogyasztás (L/100km) — jelen havi eddigi + múlt havi.
    // Kerekítés 1 tizedesre; null → „—". A csempe alján kiírunk egy figyelmeztetést
    // ha valamelyik érték kívül esik [20, 38] tartományon (⚠️ Elmaradt menetlevél)
    // VAGY a két hó közti eltérés > 4.5 L/100km (⚠️ Nézze át a menetlevelet).
    function fmtAvg(v) {
      if (v == null || !isFinite(parseFloat(v))) return '—';
      return parseFloat(v).toFixed(1) + ' L/100km';
    }
    var avgLabelCurr = t('sof.avgCurr') + ': ' + fmtAvg(s.avg_curr);
    var avgLabelPrev = t('sof.avgPrev') + ': ' + fmtAvg(s.avg_prev);
    var warn = null;
    if (s.warn_range) warn = t('sof.warnRange');
    else if (s.warn_diff) warn = t('sof.warnDiff');

    // 1×3 rács (3 csempe egymás mellett szorosan) — a diurna kivéve, marad a
    // LEZÁRT / KM / TANKOLVA. A csempék ~15%-kal magasabbak (sofer.css),
    // hogy a másodlagos prev-sorok kiférjenek.
    // A TANKOLVA csempén 3 prev-sor: avg_curr, avg_prev, opcionális warn-sor.
    // A warn-sor a `sof-mstat-warn` CSS-osztályt kapja (narancs, félkövér).
    box.innerHTML = '<div class="sof-mstat-h">' + t('sof.myMonthPerf') + '</div>'
      + '<div class="sof-mstat-grid">'
      + tile('✅', n(s.lezart), t('sof.statClosed'), '#16a34a', lastMo + ': ' + n(s.lezart_prev))
      + tile('🛣️', n(s.km), t('sof.statKm'), '#2563eb', kmPrev1, kmPrev2)
      + '<div class="sof-mstat">'
        + '<div class="sof-mstat-ico">⛽</div>'
        + '<div class="sof-mstat-val" style="color:#d97706;">' + n(s.tankolt_l) + ' L</div>'
        + '<div class="sof-mstat-lbl">' + t('sof.statFueled') + '</div>'
        + '<div class="sof-mstat-prev">' + avgLabelCurr + '</div>'
        + '<div class="sof-mstat-prev">' + avgLabelPrev + '</div>'
        + (warn ? '<div class="sof-mstat-warn">⚠️ ' + warn + '</div>' : '')
      + '</div>'
      + '</div>';
    box.style.display = '';
  }).catch(function() {});
}

// ============================================================
// INIT — authMe + állapot visszaállítás
// ============================================================
var _meData = null;

// ── GDPR adatvédelmi tájékoztató (informare) — visszaigazolásig banner ──
function loadGdprNotice() {
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getMyPrivacyNotice', arguments: [] }) })
  .then(function(r){ return r.json(); }).then(function(d){
    var res = d && d.result;
    if (!res || !res.ok || !res.notice || res.acknowledged) return;
    var b = document.getElementById('gdprBanner');
    var tx = document.getElementById('gdprBannerText');
    if (tx) tx.textContent = res.notice + (res.dpo_contact ? ('\nDPO: ' + res.dpo_contact) : '');
    if (b) b.style.display = '';
  }).catch(function(){});
}
function gdprAck() {
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'ackPrivacyNotice', arguments: [] }) })
  .then(function(r){ return r.json(); }).then(function(d){
    if (d && d.result && d.result.ok) { var b = document.getElementById('gdprBanner'); if (b) b.style.display = 'none'; }
  }).catch(function(){});
}

fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ functionName: 'authMe' }) })
.then(function(r) { return r.json(); }).then(function(d) {
  if (!d.result) { window.location.href = '/login'; return; }
  _meData = d.result;
  // sessionStorage-draft leak-védelem közös telefonon: ha az előző
  // sofőr által otthagyott piszkozat még benne van a tabban, de más
  // sofőr jelentkezett be, dobjuk. A `stateSave` innentől mindig
  // hozzáírja a `driverEmail`-t, hogy a következő ellenőrzés menjen.
  try {
    var _existing = JSON.parse(sessionStorage.getItem(SS_KEY) || '{}');
    var _ownerEmail = String(_existing.driverEmail || '').toLowerCase();
    var _meEmail = String(_meData.email || '').toLowerCase();
    if (_ownerEmail && _ownerEmail !== _meEmail) {
      sessionStorage.removeItem(SS_KEY);
    } else {
      // Első alkalommal (nincs driverEmail) horgonyozzuk a jelenlegihez
      if (!_ownerEmail && _meEmail) {
        _existing.driverEmail = _meEmail;
        sessionStorage.setItem(SS_KEY, JSON.stringify(_existing));
      }
    }
  } catch (_e) {}
  document.getElementById('meBadge').textContent = d.result.nume;
  if (window.VS_PUSH) VS_PUSH.init(d.result.email, d.result.pozicio);
    // Chat ideiglenesen: WhatsApp-átirányítás — Firebase-chat kikapcsolva.
    // A régi initFirebaseChat kódot érintetlenül hagyjuk, hogy könnyen
    // visszavonható legyen (csak nem hívjuk innen).
    loadDashOrders();
    loadSoferMiniStats();
    loadMyAssignedVehicle();
    loadGdprNotice();
    applyBonScanVisibility();

  // ── Állapot visszaállítás ──
  var state = stateGet();

  // Menetlevél piszkozat visszaállítás (legmagasabb prioritás)
  if (state.draft && state.sec === 'fuvar' && state.fuvarStep === 2) {
    goSec('fuvar');
    // Fuvarok betöltése után visszaállítjuk
    fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName: 'getMySoferOrders' }) })
    .then(function(r) { return r.json(); }).then(function(d2) {
      _soferOrdersCache = d2.result || [];
      // Step2 megnyitása
      document.getElementById('fuvarStep1').style.display = 'none';
      document.getElementById('fuvarStep2').style.display = 'block';
      draftRestore(state.draft);
      attachDraftListeners();
      toast(t('sof.draftRestored'), 'ok');
    });
    return;
  }

  // Aktív szekció visszaállítás
  if (state.sec && state.sec !== 'dash') {
    goSec(state.sec);
  }
});

// ============================================================
// CHAT — IDEIGLENESEN: WhatsApp átirányítás
// ------------------------------------------------------------
// A sofőr a chat-kártyáról közvetlenül a cég WhatsApp-számára ugrik
// (a manager/admin állítja be a saját konzolján). Ha nincs beállítva,
// jelzést kap. A régi Firebase-chat logika ALATTA érintetlen — csak
// nem hívjuk sehol (könnyen visszavonható).
// ============================================================
function openWhatsAppFromChatCard() {
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getCompanyWhatsapp', arguments: [] }) })
  .then(function(r){ return r.json(); })
  .then(function(d){
    var num = d && d.result && d.result.ok ? d.result.number : null;
    if (!num) {
      // Nincs szám: jelzés + a chat pane-en is látszik a hint.
      try { toast(t('sof.waNotConfigured'), 'warn'); } catch(e){}
      try {
        var hint = document.getElementById('soferWaHint');
        if (hint) hint.textContent = t('sof.waNotConfigured');
      } catch(e){}
      try { goSec('chat'); } catch(e){}
      return;
    }
    // wa.me a legrobusztusabb: webről a WhatsApp Web-et, mobilon a
    // natív alkalmazást nyitja. A '+' NEM kell — a szerver már csak
    // számjegyeket ad vissza (normalizePhone).
    window.location.href = 'https://wa.me/' + encodeURIComponent(num);
  })
  .catch(function(){
    try { toast(t('sof.waError'), 'err'); } catch(e){}
  });
}

// ============================================================
// FIREBASE CHAT — Sofőr oldal  (LEGACY, jelenleg nem hívott)
// ============================================================
var _fbDb = null, _chatCompanyId = null;
var _chatCurrentRoom = null, _chatUnsubscribe = null, _chatRoomsListener = null;
var _chatManagers = [];

function dmRoomId(emailA, emailB) {
  var a = emailA.toLowerCase().replace(/@/g,'__').replace(/\./g,'_d_');
  var b = emailB.toLowerCase().replace(/@/g,'__').replace(/\./g,'_d_');
  return 'dm_' + (a < b ? a + '_X_' + b : b + '_X_' + a);
}

function initFirebaseChat(me) {
  fetch('/api/firebase-config')
    .then(function(r) { return r.json(); })
    .then(function(cfg) {
      if (!cfg || !cfg.apiKey) {
        document.getElementById('chatInitMsg').textContent = t('sof.chatNoConfig');
        return;
      }
      var s1 = document.createElement('script');
      s1.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js';
      document.head.appendChild(s1);
      s1.onload = function() {
        var sAuth = document.createElement('script');
        sAuth.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js';
        document.head.appendChild(sAuth);
        sAuth.onload = function() {
        var s2 = document.createElement('script');
        s2.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js';
        document.head.appendChild(s2);
        s2.onload = function() {
          if (!firebase.apps.length) firebase.initializeApp(cfg);
          // Firebase custom token bejelentkezes (company_id alapu vedelem)
          fetch('/api/firebase-token').then(function(r){return r.json();}).then(function(td){
            var authPromise = (td.ok && td.token && firebase.auth)
              ? firebase.auth().signInWithCustomToken(td.token).catch(function(e){ console.warn('FB auth hiba:', e); })
              : Promise.resolve();
            authPromise.then(function(){
          _fbDb = firebase.database();
          _chatCompanyId = String(me.company_id || 'global');
          fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ functionName: 'userListAll' }) })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            var list = d.result || [];
            _chatManagers = list.filter(function(u) {
              return (u.pozicio === 'Manager' || u.pozicio === 'Admin') && u.email !== me.email;
            });
            document.getElementById('chatInitMsg').style.display = 'none';
            soferShowContactList(me);

            // Chat szoba visszaállítás
            var state = stateGet();
            if (state.chatRoom) {
              var manager = _chatManagers.find(function(u) {
                return dmRoomId(me.email, u.email) === state.chatRoom;
              });
              if (manager) {
                setTimeout(function() { soferOpenRoom(me, manager); }, 300);
              }
            }
          });
            }); // authPromise.then vege
          }); // firebase-token fetch vege
        }; // s2.onload vege
        }; // sAuth.onload vege
      };
    })
    .catch(function() { document.getElementById('chatInitMsg').textContent = t('sof.chatUnavailable'); });
}

function soferShowContactList(me) {
  var contactView = document.getElementById('chatContactView');
  contactView.style.display = 'flex';
  document.getElementById('chatRoomView').style.display = 'none';

  var listEl = document.getElementById('chatContactList');
  if (!_chatManagers.length) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;">' + t('sof.noManager') + '</div>';
    return;
  }

  listEl.innerHTML = _chatManagers.map(function(u) {
    var av = (u.nume || u.email).replace(/[^a-zA-Z]/g, '').charAt(0).toUpperCase() || '?';
    var roomId = dmRoomId(me.email, u.email);
    return '<div onclick="soferOpenRoom(_meData, ' + JSON.stringify(u).replace(/"/g, '&quot;') + ')" '
      + 'style="display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .15s;" '
      + 'onmouseenter="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseleave="this.style.background=\'\'"> '
      + '<div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#1d4ed8);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:17px;color:#fff;flex-shrink:0;">' + av + '</div>'
      + '<div><div style="font-weight:700;font-size:14px;color:#fff;">' + escHtml(u.nume || u.email) + '</div>'
      + '<div style="font-size:11px;color:var(--muted);margin-top:2px;">' + escHtml(u.pozicio || '') + '</div></div>'
      + '</div>';
  }).join('');

  // Rooms listener — olvasatlan jelzők frissítése
  if (_chatRoomsListener) _chatRoomsListener();
  if (_fbDb) {
    var ref = _fbDb.ref('chats/' + _chatCompanyId + '/rooms');
    ref.on('value', function() {}); // figyelés aktív
    _chatRoomsListener = function() { ref.off(); };
  }
}

function soferOpenRoom(me, manager) {
  var roomId = dmRoomId(me.email, manager.email);
  stateSave({ chatRoom: roomId });

  document.getElementById('chatContactView').style.display = 'none';
  document.getElementById('chatRoomView').style.display = 'flex';

  var name = manager.nume || manager.email;
  document.getElementById('chatHeadName').textContent = name;
  var av = name.replace(/[^a-zA-Z]/g, '').charAt(0).toUpperCase() || '?';
  document.getElementById('chatHeadAv').textContent = av;

  if (_chatUnsubscribe) { _chatUnsubscribe(); _chatUnsubscribe = null; }
  _chatCurrentRoom = roomId;

  var msgsEl = document.getElementById('chatMsgs');
  msgsEl.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:20px;">' + t('common.loading') + '</div>';

  var ref = _fbDb.ref('chats/' + _chatCompanyId + '/rooms/' + roomId + '/messages');
  var query = ref.orderByChild('ts').limitToLast(100);

  var listener = query.on('value', function(snap) {
    msgsEl.innerHTML = '';
    snap.forEach(function(child) {
      var msg = child.val();
      var isMine = (msg.fromEmail === (_meData.email || ''));
      var bubble = document.createElement('div');
      bubble.style.cssText = 'max-width:80%;padding:9px 13px;border-radius:16px;font-size:14px;word-break:break-word;margin-bottom:2px;'
        + (isMine
          ? 'align-self:flex-end;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border-bottom-right-radius:3px;'
          : 'align-self:flex-start;background:rgba(255,255,255,0.08);border:1px solid var(--border-bright);color:var(--text);border-bottom-left-radius:3px;');
      var ts = msg.ts ? new Date(msg.ts).toLocaleTimeString(t('sof.locale'), { hour: '2-digit', minute: '2-digit' }) : '';
      bubble.innerHTML = (!isMine
          ? '<div style="font-size:10px;color:var(--muted);margin-bottom:3px;font-weight:600;">' + escHtml(msg.fromName || '') + '</div>'
          : '')
        + '<div>' + escHtml(msg.text || '') + '</div>'
        + '<div style="font-size:10px;opacity:.5;text-align:right;margin-top:4px;">' + ts + '</div>';
      msgsEl.appendChild(bubble);
    });
    msgsEl.scrollTop = msgsEl.scrollHeight;
  });

  _chatUnsubscribe = function() { query.off('value', listener); };
}

function soferChatBack() {
  if (_chatUnsubscribe) { _chatUnsubscribe(); _chatUnsubscribe = null; }
  _chatCurrentRoom = null;
  stateSave({ chatRoom: null });
  document.getElementById('chatRoomView').style.display = 'none';
  document.getElementById('chatContactView').style.display = 'flex';
}

function chatSend() {
  if (!_fbDb || !_meData || !_chatCurrentRoom) return;
  var input = document.getElementById('chatInput');
  var text = input.value.trim();
  if (!text) return;
  input.value = '';
  _fbDb.ref('chats/' + _chatCompanyId + '/rooms/' + _chatCurrentRoom + '/messages').push({
    fromEmail: _meData.email || '',
    fromName: _meData.nume || t('sof.driver'),
    fromRole: 'Sofer',
    text: text,
    ts: firebase.database.ServerValue.TIMESTAMP
  });
  _fbDb.ref('chats/' + _chatCompanyId + '/rooms/' + _chatCurrentRoom + '/meta').update({
    lastMsg: text.substring(0, 80),
    lastTime: firebase.database.ServerValue.TIMESTAMP,
    lastFrom: _meData.nume
  });
  // Push ertesites a Managernek / Adminnak
  if(window.VS_PUSH){
    var roomId = _chatCurrentRoom;
    var toEmails = [];
    var toRoles  = [];
    if(roomId && roomId.startsWith('dm_')){
      var inner = roomId.replace('dm_','');
      var parts = inner.split('_X_');
      if(parts.length===2){
        var myEsc=(_meData.email||'').toLowerCase().replace(/@/g,'__').replace(/\./g,'_d_');
        var otherEsc=parts[0]===myEsc?parts[1]:parts[0];
        toEmails=[otherEsc.replace(/__/g,'@').replace(/_d_/g,'.')];
      }
    } else {
      toRoles = ['Manager','Admin'];
    }
    VS_PUSH.notifyChat({
      toEmails: toEmails,
      toRoles:  toRoles,
      fromName: _meData.nume || t('sof.driver'),
      text:     text,
      room:     roomId,
      companyId: _chatCompanyId
    });
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js');
  });
}

/* ── Bug report ── */
function openBugReport(){
  document.getElementById('bugText').value='';
  document.getElementById('bugModal').style.display='flex';
  setTimeout(function(){document.getElementById('bugText').focus();},150);
}
function closeBugReport(){ document.getElementById('bugModal').style.display='none'; }
function submitBugReport(){
  var txt = document.getElementById('bugText').value.trim();
  if(!txt || txt.length<5){ toast(t('sof.bug.minChars'),'err'); return; }
  var btn = document.getElementById('bugSubmitBtn');
  btn.disabled=true; btn.textContent=t('sof.sending');
  fetch('/api/execute',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({functionName:'sendBugReport',arguments:[txt,'sofer']})})
  .then(function(r){return r.json();}).then(function(d){
    btn.disabled=false; btn.textContent=t('sof.bug.send');
    var r=d.result;
    if(r&&r.ok){ toast(t('sof.bug.thanks'),'ok'); closeBugReport(); }
    else { toast((r&&r.err)||t('sof.errOccurred'),'err'); }
  });
}

// ── Kiosztott fuvarok a főoldalon ────────────────────────
// A dashboard görgetését CSAK a #soferWrap-en kapcsoljuk (a body marad
// overflow:hidden — ez az app-shell alapja). Van fuvar → görgethető dashboard.
function updateScrollBehavior(orders) {
  var wrap = document.getElementById('soferWrap');
  if (!wrap) return;
  if (orders && orders.length > 0) wrap.classList.add('scrollable');
  else wrap.classList.remove('scrollable');
}

// Kártya-kattintással kinyíló részletek másolható szövegei (biztonságos:
// a felhasználói adatot NEM injektáljuk onclick-be, hanem ebből a map-ből
// olvassuk ki a fuvar id alapján).
var _fuvarCopy = {};

// DATE (fel-/lerakás) olvasható formázása; hiba/üres → '—'.
function fmtFuvarDay(v) {
  if (!v) return '';
  try {
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString(t('sof.locale'), { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch (e) { return String(v); }
}
// Időbélyeg (állomás visszaigazolás) — hónap.nap óra:perc.
function fmtFuvarDateTime(v) {
  if (!v) return '';
  try {
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleString(t('sof.locale'), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return String(v); }
}

// A fuvar 4 állomása — EGY gomb lépteti (a szerver dönti el a következőt).
var MS_STEPS = [
  { col: 'sosit_incarcare_at',  key: 'sof.ms.arriveLoad' },
  { col: 'incarcat_at',         key: 'sof.ms.loaded' },
  { col: 'sosit_descarcare_at', key: 'sof.ms.arriveUnload' },
  { col: 'descarcat_at',        key: 'sof.ms.unloaded' }
];

// Egy gombnyomás → a szerver a következő üres állomást rögzíti (időbélyeg),
// és értesíti az irodát; az utolsónál a fuvar Finalizat lesz.
function driverMilestone(id) {
  fetch('/api/orders/' + id + '/driver-milestone', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  })
  .then(function (r) { return r.json(); })
  .then(function (d) {
    if (d && d.ok) {
      var lblKey = { arriveLoad: 'sof.ms.arriveLoad', loaded: 'sof.ms.loaded',
                     arriveUnload: 'sof.ms.arriveUnload', unloaded: 'sof.ms.unloaded' }[d.step];
      toast('✅ ' + t(lblKey || 'sof.ms.recorded'), 'ok');
      loadDashOrders();
    } else { toast((d && d.err) || t('sof.errOccurred'), 'err'); }
  })
  .catch(function () { toast(t('sof.errOccurred'), 'err'); });
}

// Kattintásra a kártya részletei ki-/becsukódnak (felrakás/lerakás + megjegyzés).
function toggleFuvarDetails(id) {
  var el = document.getElementById('det_' + id);
  var arr = document.getElementById('exp_' + id);
  if (!el) return;
  var open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (arr) arr.textContent = open ? '▾' : '▴';
}

// Egy mező (felrakó/lerakó helyszín vagy megjegyzés) vágólapra másolása.
function soferCopy(id, kind) {
  var rec = _fuvarCopy[id];
  var txt = rec ? (rec[kind] || '') : '';
  if (!txt) { toast(t('sof.det.nothingToCopy'), 'err'); return; }
  var done = function () { toast(t('sof.det.copied'), 'ok'); };
  var fallback = function () {
    try {
      var ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta); done();
    } catch (e) { toast(t('sof.det.copyFail'), 'err'); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(done).catch(fallback);
  } else { fallback(); }
}

// Egy kiosztott fuvar kártyája — új .fuvar-card kinézet + MEGŐRZÖTT akciógombok.
// Alocat → Elfogadom, In Curs → Elvégeztem, Finalizat → nincs státuszváltó (csak UIT).
// `idx` (1-alapú): a sofőr által látott sorszám a jelenlegi aktív fuvarok
// között — összecsukott fejlécben #-badge-ként jelenik meg. Ha az aktív
// fuvarok elfogynak, a következő kiosztás újra 1-től indul (a lezárt fuvar
// dash_visible=false, nem számít bele).
function renderFuvarCard(o, idx) {
  var isAlocat = o.status === 'Alocat';
  var isCurs   = o.status === 'In Curs';
  var isFinal  = o.status === 'Finalizat';
  var isParked = o.status === 'Parkolt';
  var isWh     = o.status === 'Raktarban';
  // Parkolt/Raktarban: a fuvar a sofőrhöz van rendelve, de leadott áru —
  // csak olvasható (a diszpécser intézi a folytatást), nincs gomb.
  var statusCls = (isAlocat || isParked || isWh) ? 'warn' : 'ok';
  var statusTxt = isFinal ? t('sof.statusDone')
                : isParked ? (t('sof.statusParked') + (o.handover_loc ? ' @ ' + esc(o.handover_loc) : ''))
                : isWh ? (t('sof.statusWarehouse') + (o.handover_loc ? ' @ ' + esc(o.handover_loc) : ''))
                : esc(o.status || 'Alocat');
  var truck = o.rendszam_camion ? ('🚛 ' + esc(o.rendszam_camion) + (o.rendszam_remorca ? ' / ' + esc(o.rendszam_remorca) : '')) : '';
  // Állomás-gomb: EGY gomb, ami a következő üres állomást mutatja; a szerver
  // rögzíti az időbélyeget és lépteti (utolsónál Finalizat). Csak aktív fuvaron.
  var msNextIdx = -1;
  for (var _i = 0; _i < MS_STEPS.length; _i++) { if (!o[MS_STEPS[_i].col]) { msNextIdx = _i; break; } }
  var actionBtn = '';
  if ((isAlocat || isCurs) && msNextIdx >= 0) {
    actionBtn = '<button class="sh-btn confirm" onclick="driverMilestone(\'' + o.id + '\')">' +
                '➜ ' + t(MS_STEPS[msNextIdx].key) + '</button>';
  }
  // ⛔ Áru leadása (defekt / pótkocsi-csere) — a kérést a diszpécser igazolja vissza
  var hoPending = o.handover_status === 'Fuggoben';
  var hoBtn = '';
  if (hoPending) {
    hoBtn = '<span class="fuvar-status warn">' + t('sof.handoverPending') + (o.handover_loc ? ' @ ' + esc(o.handover_loc) : '') + '</span>';
  } else if (isAlocat || isCurs) {
    hoBtn = '<button class="sh-btn" style="border:1px solid rgba(99,102,241,0.5);color:#a5b4fc;background:rgba(99,102,241,0.12);" ' +
      'onclick="openHandover(\'' + o.id + '\')" title="' + t('sof.handoverBtnTitle') + '">' + t('sof.ho.title') + '</button>';
  }
  // Kattintható részletek forrás-adatai (biztonságos map, nem HTML-attribútum)
  _fuvarCopy[o.id] = {
    load: o.loc_incarcare || '',
    unload: o.loc_descarcare || '',
    note: o.ref || ''
  };
  // Kettős dátum: TERVEZETT (dispatcher `data_incarcare`/`data_descarcare`)
  // + TÉNYLEGES (a driver menetlevelében beírt vagy az állomás-milestone-ból
  // származó `incarcat_at`/`descarcat_at`). Ha megegyezik vagy csak egyik van,
  // egy értéket mutatunk; ha eltér, „Terv.: X · Tényl.: Y" formátumban.
  var dLoadPlan   = fmtFuvarDay(o.data_incarcare);
  var dLoadActual = fmtFuvarDay(o.incarcat_at);
  var dUnloadPlan   = fmtFuvarDay(o.data_descarcare);
  var dUnloadActual = fmtFuvarDay(o.descarcat_at);
  function _fmtDualDate(planD, actualD) {
    if (!planD && !actualD) return '';
    if (planD && actualD && planD !== actualD) {
      return t('sof.det.planShort') + ': ' + planD + '  ·  ' + t('sof.det.actualShort') + ': ' + actualD;
    }
    return planD || actualD;
  }
  var dLoad = _fmtDualDate(dLoadPlan, dLoadActual);
  var dUnload = _fmtDualDate(dUnloadPlan, dUnloadActual);
  // Egy részlet-sor: címke + érték + 📋 másoló gomb (ha van mit másolni)
  function detRow(labelKey, val, copyKind) {
    if (!val) return '';
    var btn = copyKind
      ? '<button class="fd-copy" onclick="soferCopy(\'' + o.id + '\',\'' + copyKind + '\')" title="' + t('sof.det.copy') + '">📋</button>'
      : '';
    return '<div class="fd-row"><div class="fd-cell"><span class="fd-lbl">' + t(labelKey) + '</span>' +
           '<span class="fd-val">' + esc(val) + '</span></div>' + btn + '</div>';
  }
  // Meta-sor (#szám, ügyfél, kamion, státusz) — a KINYÍLÓ részbe kerül,
  // hogy összecsukott állapotban CSAK a fel-/lerakó cím látszódjon.
  var metaHtml =
    '<div class="fuvar-meta">' +
      '<span>#' + o.id + '</span>' +
      (o.client ? '<span>' + esc(o.client) + '</span>' : '') +
      (truck ? '<span>' + truck + '</span>' : '') +
      '<span class="fuvar-status ' + statusCls + '">' + statusTxt + '</span>' +
    '</div>';
  var details =
    '<div class="fuvar-details" id="det_' + o.id + '" style="display:none">' +
      metaHtml +
      (o.client ? '<div class="fd-firma">🏢 ' + esc(o.client) + '</div>' : '') +
      '<div class="fd-sec">' +
        '<div class="fd-sec-h">⬆️ ' + t('sof.det.loading') + '</div>' +
        detRow('sof.det.company', o.firma_incarcare, null) +
        detRow('sof.det.location', o.loc_incarcare, 'load') +
        detRow('sof.det.date', dLoad, null) +
      '</div>' +
      '<div class="fd-sec">' +
        '<div class="fd-sec-h">⬇️ ' + t('sof.det.unloading') + '</div>' +
        detRow('sof.det.company', o.firma_descarcare, null) +
        detRow('sof.det.location', o.loc_descarcare, 'unload') +
        detRow('sof.det.date', dUnload, null) +
      '</div>' +
      (o.ref ? '<div class="fd-sec">' +
        '<div class="fd-sec-h">📝 ' + t('sof.det.note') + '</div>' +
        detRow('sof.det.note', o.ref, 'note') +
      '</div>' : '') +
      // Állomás-idővonal: a 4 lépés + időbélyeg (✅ kész / ○ hátra).
      // Finalizat fuvarnál CSAK akkor, ha van rögzített állomás (különben üres ○○○○).
      ((!isParked && !isWh && (isAlocat || isCurs || MS_STEPS.some(function(s){return o[s.col];}))) ? '<div class="fd-sec">' +
        '<div class="fd-sec-h">🚚 ' + t('sof.ms.progress') + '</div>' +
        MS_STEPS.map(function (s) {
          var done = o[s.col];
          return '<div class="fd-ms-row' + (done ? ' done' : '') + '">' +
            '<span class="fd-ms-ico">' + (done ? '✅' : '○') + '</span>' +
            '<span class="fd-ms-lbl">' + t(s.key) + '</span>' +
            (done ? '<span class="fd-ms-time">' + esc(fmtFuvarDateTime(o[s.col])) + '</span>' : '') +
          '</div>';
        }).join('') +
      '</div>' : '') +
      // Akciógombok (UIT / állomás-léptetés / áru-leadás) — szintén a
      // kinyíló részben, hogy összecsukva tiszta legyen a kártya.
      '<div class="fuvar-actions">' +
        '<button class="sh-btn uit" onclick="SoferUit.open(\'' + o.id + '\')" title="' + t('sof.uitTitle') + '">🚛 UIT</button>' +
        actionBtn +
        hoBtn +
      '</div>' +
    '</div>';
  // Összecsukott állapot: #-badge (sorszám) + felrakás dátuma + felrakási hely
  // + nyíl. Kattintásra kinyílik (megnő a kártya) a többi infóval, a fejlécre
  // újra kattintva összecsukható. A lerakó/további részlet a `details`-ben van.
  var num = (typeof idx === 'number' && idx > 0) ? idx : null;
  var loadDay = fmtFuvarDay(o.data_incarcare);
  var headBits = [];
  if (loadDay) headBits.push('📅 ' + esc(loadDay));
  headBits.push('📍 ' + esc(o.loc_incarcare || '—'));
  return '' +
    '<div class="fuvar-card">' +
      '<div class="fuvar-head" role="button" tabindex="0" onclick="toggleFuvarDetails(\'' + o.id + '\')" ' +
           'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();toggleFuvarDetails(\'' + o.id + '\');}">' +
        '<div class="fuvar-destination">' +
          (num ? '<span class="fuvar-num">#' + num + '</span>' : '') +
          '<span class="fuvar-headtxt">' + headBits.join(' · ') + '</span>' +
          '<span class="fuvar-expand" id="exp_' + o.id + '">▾</span>' +
        '</div>' +
      '</div>' +
      details +
    '</div>';
}

// ── ⛔ Áru leadása (sofőr-kérés, a diszpécser igazolja vissza) ──
var _hoOid = null;
function openHandover(oid) {
  _hoOid = oid;
  ['hoLoc','hoQty','hoLen','hoWid','hoHei','hoWeight','hoDocPages','hoNote'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  var u = document.getElementById('hoQtyUnit'); if (u) u.value = 'paletta';
  document.querySelectorAll('input[name="hoType"]').forEach(function(r){ r.checked = (r.value === 'trailer'); });
  hoTypeChange();
  document.getElementById('hoModal').style.display = 'flex';
  setTimeout(function(){ var l = document.getElementById('hoLoc'); if (l) l.focus(); }, 150);
}
function closeHandover() { document.getElementById('hoModal').style.display = 'none'; }
function hoTypeChange() {
  var tt = (document.querySelector('input[name="hoType"]:checked') || {}).value;
  document.getElementById('hoWhBlock').style.display = tt === 'warehouse' ? 'block' : 'none';
}
function submitHandover() {
  var type = (document.querySelector('input[name="hoType"]:checked') || {}).value;
  var loc = document.getElementById('hoLoc').value.trim();
  if (!loc) { toast(t('sof.ho.locRequired'), 'err'); return; }
  var d = { type: type, location: loc, note: document.getElementById('hoNote').value.trim() || null };
  if (type === 'warehouse') {
    d.qty = document.getElementById('hoQty').value;
    d.qty_unit = document.getElementById('hoQtyUnit').value;
    d.length_cm = document.getElementById('hoLen').value;
    d.width_cm = document.getElementById('hoWid').value;
    d.height_cm = document.getElementById('hoHei').value;
    d.weight_kg = document.getElementById('hoWeight').value;
    d.doc_pages = document.getElementById('hoDocPages').value;
  }
  var btn = document.getElementById('hoSubmitBtn');
  btn.disabled = true; btn.textContent = t('sof.sending');
  fetch('/api/execute', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ functionName:'driverHandoverRequest', arguments:[_hoOid, d] }) })
  .then(function(r){ return r.json(); })
  .then(function(resp){
    btn.disabled = false; btn.textContent = t('sof.ho.send');
    var r = resp.result;
    if (r && r.ok) {
      toast(t('sof.ho.sent'), 'ok');
      closeHandover();
      loadDashOrders();
      if (type === 'warehouse') {
        // azonnali felszólítás: dokumentumok fotózása, a fuvarhoz kötve
        var oid = _hoOid;
        setTimeout(function(){
          toast(t('sof.ho.photoNow'), 'err');
          goSec('docs');
          var sel = document.getElementById('docOrderSel');
          if (sel) sel.value = oid;
        }, 600);
      }
    } else { toast((r && r.err) || t('sof.errOccurred'), 'err'); }
  });
}

function loadDashOrders() {
  fetch('/api/execute', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ functionName:'getMySoferOrders' }) })
  .then(function(r){ return r.json(); })
  .then(function(d){
    var list = d.result || [];
    var el = document.getElementById('kiosztottList');
    if (!el) return;
    // Dashboard: CSAK élő aktív fuvar (Alocat/In Curs). A Finalizat + Parkolt
    // + Raktarban „lezárt/leadott" → már a menetlevél-picker-be tartozik.
    // Defenzív: ha a dash_visible mező hiányzik (régi, újra nem indított
    // szerver), visszaesünk a szigorúbb státusz-alapú szűrésre.
    var active = list.filter(function(o){
      if (typeof o.dash_visible === 'boolean') return o.dash_visible;
      return o.status === 'Alocat' || o.status === 'In Curs';
    });
    // A szerver `created_at DESC` sorrendben ad — a főoldali sorszámhoz
    // (legrégebbi = #1) megfordítjuk. Így új kiosztás nem üti át a meglévők
    // sorszámát: a régiek maradnak, az újak a végére kerülnek (magasabb #).
    // A lezárt fuvar kiesik → a következő kiosztás újra 1-től számoz.
    active.reverse();
    updateScrollBehavior(active);
    if (!active.length) {
      el.innerHTML = '<div class="kiosztott-empty">' + t('sof.noActiveOrders') + '</div>';
      return;
    }
    el.innerHTML = active.map(function(o, i){ return renderFuvarCard(o, i + 1); }).join('');
  });
}

function driverOrderStatus(id, status) {
  fetch('/api/orders/'+id+'/driver-status', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ status: status })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if (d.ok) {
      toast(status==='In Curs' ? t('sof.orderAccepted') : t('sof.orderCompleted'), 'ok');
      loadDashOrders();
    } else {
      toast(d.err||t('common.error'), 'err');
    }
  });
}

// ── Indulás/Érkezés mezők: change-listener a diurna előnézethez ──
document.addEventListener('DOMContentLoaded', function() {
  var depEl = document.getElementById('fIndulasDt');
  var arrEl = document.getElementById('fErkezesDt');
  if (depEl) depEl.addEventListener('change', updateDiurnaPreview);
  if (arrEl) arrEl.addEventListener('change', updateDiurnaPreview);
});

// ── Tab-visszatérés (telefon feléled, PWA elotérbe kerul): frissítjük a
//    főoldal kritikus blokkjait, hogy a stale UI ne érje váratlanul a sofőrt
//    (új kiosztott fuvar, sofőr↔jármű váltás, havi mini-statisztika). A
//    session-guard oldalán a szerver-session-t is ellenőrizzük ugyanekkor
//    (visibilitychange → authMe ping → tiszta redirect ha halott).
//    Csak a főoldalon (sec-dash), hogy a menetlevél-piszkozat/beírt űrlap
//    NE nulázódjon a listák újratöltésétől. Rate-limit: legfeljebb 20 mp-enként.
var _visRefreshLastAt = 0;
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState !== 'visible') return;
  var now = Date.now();
  if (now - _visRefreshLastAt < 20000) return;
  _visRefreshLastAt = now;
  var dashSec = document.getElementById('sec-dash');
  if (!dashSec || dashSec.classList.contains('hidden')) return;
  try { if (typeof loadDashOrders === 'function') loadDashOrders(); } catch(e) {}
  try { if (typeof loadSoferMiniStats === 'function') loadSoferMiniStats(); } catch(e) {}
  try { if (typeof loadMyAssignedVehicle === 'function') loadMyAssignedVehicle(); } catch(e) {}
  try { if (typeof renderPendingReceipts === 'function') renderPendingReceipts(); } catch(e) {}
});

// ── Nyelvváltáskor a JS-ből renderelt részek újrarajzolása ──
// (a static data-i18n elemeket a motor magától frissíti; itt a dinamikus
//  listák/kártyák kerülnek újrarenderelésre — a menetlevél-űrlap és a nyitott
//  chat-szoba állapotát NEM bántjuk, hogy ne vesszen el a beírt adat)
window.onLangChange = function(lang) {
  try { if (typeof loadDashOrders === 'function') loadDashOrders(); } catch(e) {}
  try { if (typeof loadSoferMiniStats === 'function') loadSoferMiniStats(); } catch(e) {}
  try {
    var borderSec = document.getElementById('sec-border');
    if (borderSec && !borderSec.classList.contains('hidden')) loadBorderLog();
  } catch(e) {}
  try {
    var docsSec = document.getElementById('sec-docs');
    if (docsSec && !docsSec.classList.contains('hidden')) loadDocOrderOptions();
  } catch(e) {}
  try {
    var fuvarStep1 = document.getElementById('fuvarStep1');
    var fuvarSec = document.getElementById('sec-fuvar');
    // Csak az 1. lépés (fuvar-kiválasztó) renderelődik újra — a 2. lépés űrlapja marad
    if (fuvarSec && !fuvarSec.classList.contains('hidden') && fuvarStep1 && fuvarStep1.style.display !== 'none') {
      loadSoferOrders();
    }
  } catch(e) {}
  try {
    // Chat kontaktlista újrarajzolása, ha az a nézet aktív
    var cv = document.getElementById('chatContactView');
    if (_meData && cv && cv.style.display !== 'none') soferShowContactList(_meData);
  } catch(e) {}
};
