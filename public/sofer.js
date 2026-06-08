// ============================================================
//  VallorSoft — sofer.js
//  Kivágva a sofer.html inline <script> blokkjaiból, BÁJTRA AZONOS.
// ============================================================
// ============================================================
// SESSION STATE — oldal frissítés utáni visszaállítás
// sessionStorage: csak ugyanazon a fülön él, új fülön üres
// ============================================================
var SS_KEY = 'vs_sofer_state';

function stateSave(extra) {
  try {
    var cur = stateGet();
    var merged = Object.assign({}, cur, extra || {});
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
        pret: (row.querySelector('.ach-pret') || {}).value || '0',
        plata: (row.querySelector('.ach-plata') || {}).value || 'Card'
      });
    });

    stateSave({
      draft: {
        fisa: document.getElementById('fFisa').value,
        cursaSapt: document.getElementById('fCursaSapt').value,
        camion: document.getElementById('fCamion').value,
        remorca: document.getElementById('fRemorca').value,
        kmInc: document.getElementById('fKmInc').value,
        kmSf: document.getElementById('fKmSf').value,
        diurnaEx: document.getElementById('fDiurnaEx').value,
        diurnaIn: document.getElementById('fDiurnaIn').value,
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
  document.getElementById('fFisa').value = draft.fisa || '';
  document.getElementById('fCursaSapt').value = draft.cursaSapt || '';
  document.getElementById('fCamion').value = draft.camion || '';
  document.getElementById('fRemorca').value = draft.remorca || '';
  document.getElementById('fKmInc').value = draft.kmInc || '0';
  document.getElementById('fKmSf').value = draft.kmSf || '0';
  document.getElementById('fDiurnaEx').value = draft.diurnaEx || '0';
  document.getElementById('fDiurnaIn').value = draft.diurnaIn || '0';
  document.getElementById('fCantInc').value = draft.cantInc || '0';
  document.getElementById('fCantSf').value = draft.cantSf || '0';
  document.getElementById('fMentiuni').value = draft.mentiuni || '';

  // Útvonal pontok visszaállítása
  document.getElementById('puncteContainer').innerHTML = '';
  punctIdx = 0;
  (draft.puncte || []).forEach(function(p) {
    addPunctRow(p.loc, p.tip, p.data);
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
}

function draftClear() {
  stateSave({ draft: null });
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
  if (id === 'fuvar')  loadSoferOrders();
}

// ============================================================
// HATÁRÁTLÉPÉS
// ============================================================
function sendBorderCross(tip, tara) {
  var statusEl = document.getElementById('gpsStatus');
  statusEl.innerHTML = '<div class="gps-badge"><span class="spinner"></span> GPS lekérés...</div>';

  function doSend(lat, lng) {
    fetch('/api/border-cross', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tip: tip, tara: tara, gps_lat: lat, gps_lng: lng,
        locatie: lat ? (lat.toFixed(4) + ', ' + lng.toFixed(4)) : null })
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.success) {
        toast(tip === 'Intrare' ? '🇷🇴 Románia BE rögzítve!' : '🇷🇴 Románia KI rögzítve!', 'ok');
        statusEl.innerHTML = lat
          ? '<div class="gps-badge">📍 GPS: ' + lat.toFixed(4) + ', ' + lng.toFixed(4) + '</div>'
          : '<div class="gps-badge">⚠️ GPS nélkül rögzítve</div>';
        loadBorderLog();
      } else {
        toast('Hiba: ' + (d.err || 'ismeretlen'), 'err');
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
    if (!list.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;">Nincs rögzített átlépés.</div>'; return; }
    el.innerHTML = list.slice(0, 20).map(function(l) {
      var dt = l.created_at ? new Date(l.created_at).toLocaleString('hu-HU') : '—';
      return '<div class="border-log-item">'
        + '<strong>' + (l.tip === 'Intrare' ? '🇷🇴 BE' : '🇷🇴 KI') + '</strong>'
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
    _soferOrdersCache = (d.result || []).filter(function(o) { return o.waybill_visible; });
    var el = document.getElementById('soferOrderList');
    if (!_soferOrdersCache.length) {
      el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:13px;">Nincs menetlevélre váró fuvar.</div>';
      return;
    }
    el.innerHTML = _soferOrdersCache.map(function(o) {
      var checked = _selectedOrderIds.indexOf(o.id) !== -1;
      return '<label style="display:flex;align-items:flex-start;gap:12px;background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:10px;cursor:pointer;">'
        + '<input type="checkbox" value="' + o.id + '" ' + (checked ? 'checked' : '') + ' onchange="toggleOrderSel(this)" style="margin-top:3px;width:18px;height:18px;accent-color:#e10b1a;flex-shrink:0;">'
        + '<div>'
        + '<div style="font-weight:700;font-size:14px;color:#fff;">' + (o.client || '—') + ' <span style="font-size:11px;color:var(--muted);">#' + o.id + '</span> <span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(255,255,255,0.1);">' + (o.status||'—') + '</span></div>'
        + '<div style="font-size:12px;color:var(--soft);margin-top:3px;">📍 ' + (o.loc_incarcare || '—') + ' → ' + (o.loc_descarcare || '—') + '</div>'
        + (o.rendszam_camion ? '<div style="font-size:11px;color:var(--muted);margin-top:2px;">🚛 ' + o.rendszam_camion + (o.rendszam_remorca ? ' / ' + o.rendszam_remorca : '') + '</div>' : '')
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

function fuvarStep2() {
  if (!_selectedOrderIds.length) { toast('Jelölj be legalább egy fuvart!', 'err'); return; }
  var selected = _soferOrdersCache.filter(function(o) { return _selectedOrderIds.indexOf(o.id) !== -1; });
  var sumEl = document.getElementById('selectedOrdersSummary');
  sumEl.innerHTML = '<b style="color:#fff;">✅ ' + selected.length + ' fuvar kiválasztva:</b><br>'
    + selected.map(function(o) {
        return '• ' + (o.client || '—') + ': ' + (o.loc_incarcare || '—') + ' → ' + (o.loc_descarcare || '—');
      }).join('<br>');

  var first = selected[0];
  if (first && first.rendszam_camion) {
    document.getElementById('fCamion').value = first.rendszam_camion;
    document.getElementById('fRemorca').value = first.rendszam_remorca || '';
  }

  document.getElementById('puncteContainer').innerHTML = '';
  punctIdx = 0;
  selected.forEach(function(o) {
    if (o.loc_incarcare) addPunctRow(o.loc_incarcare, 'Încărcare');
    if (o.loc_descarcare) addPunctRow(o.loc_descarcare, 'Descărcare');
  });

  document.getElementById('fuvarStep1').style.display = 'none';
  document.getElementById('fuvarStep2').style.display = 'block';
  document.getElementById('alimentariContainer').innerHTML = '';
  document.getElementById('achizitiiContainer').innerHTML = '';
  alimIdx = 0; achIdx = 0;

  // Piszkozat figyeli a változásokat
  attachDraftListeners();
  stateSave({ fuvarStep: 2 });
}

function fuvarBackStep1() {
  document.getElementById('fuvarStep2').style.display = 'none';
  document.getElementById('fuvarStep1').style.display = 'block';
  stateSave({ fuvarStep: 1 });
}

// Input változások figyelése → piszkozat auto-mentés
function attachDraftListeners() {
  var ids = ['fCursaSapt','fCamion','fRemorca','fKmInc','fKmSf','fDiurnaEx','fDiurnaIn','fCantInc','fCantSf','fMentiuni'];
  ids.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) {
      el.removeEventListener('input', draftSave);
      el.addEventListener('input', draftSave);
    }
  });
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

function addPunctRow(locVal, tipVal, dataVal) {
  punctIdx++;
  var d = document.createElement('div');
  d.className = 'dyn-row';
  var tipOptions = ['Încărcare','Descărcare','Tranzit','Vamă','Parcare','Altele'];
  var today = new Date().toISOString().split('T')[0];
  d.innerHTML = '<button class="del-row" onclick="this.parentNode.remove();draftSave()">✕</button>'
    + '<div class="g2">'
    + '<div class="field"><label>Tip punct</label><select class="input punct-tip" style="padding:10px 14px;" onchange="draftSave()">'
    + tipOptions.map(function(t) { return '<option' + (t === (tipVal || 'Încărcare') ? ' selected' : '') + '>' + t + '</option>'; }).join('')
    + '</select></div>'
    + '<div class="field"><label>Dată</label><input class="input punct-data" type="date" value="' + (dataVal || today) + '" onchange="draftSave()"></div>'
    + '</div>'
    + '<div class="field"><label>Localitate / Adresă</label><input class="input punct-loc" placeholder="pl. Budapest, Keleti pu." value="' + (locVal || '') + '" oninput="draftSave()"></div>';
  document.getElementById('puncteContainer').appendChild(d);
}

function addAlimRow(a) {
  alimIdx++;
  a = a || {};
  var d = document.createElement('div');
  d.className = 'dyn-row';
  d.innerHTML = '<button class="del-row" onclick="this.parentNode.remove();draftSave()">✕</button>'
    + '<div class="field"><label>Helyszín & Dátum</label><input class="input alim-loc" placeholder="pl. Győr, 2025-01-15" value="' + (a.loc || '') + '" oninput="draftSave()"></div>'
    + '<div class="g2">'
    + '<div class="field"><label>Tip combustibil</label><select class="input alim-tip" style="padding:10px 14px;" onchange="draftSave()"><option' + (a.tip === 'AdBlue' ? '' : ' selected') + '>Motorină</option><option' + (a.tip === 'AdBlue' ? ' selected' : '') + '>AdBlue</option></select></div>'
    + '<div class="field"><label>Litri</label><input class="input alim-lit" type="number" value="' + (a.litru || '0') + '" inputmode="numeric" oninput="draftSave()"></div>'
    + '</div>'
    + '<div class="g3">'
    + '<div class="field"><label>Km</label><input class="input alim-km" type="number" value="' + (a.km || '0') + '" inputmode="numeric" oninput="draftSave()"></div>'
    + '<div class="field"><label>Plată</label><select class="input alim-plata" style="padding:10px 14px;" onchange="draftSave()"><option>Card</option><option>Cash</option><option>Flota Card</option><option>DKV</option></select></div>'
    + '<div class="field"><label>Sumă (RON)</label><input class="input alim-suma" type="number" value="' + (a.suma || '0') + '" inputmode="numeric" oninput="draftSave()"></div>'
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
  var d = document.createElement('div');
  d.className = 'dyn-row';
  d.innerHTML = '<button class="del-row" onclick="this.parentNode.remove();draftSave()">✕</button>'
    + '<div class="field"><label>Produs / Serviciu</label><input class="input ach-prod" placeholder="pl. Autostrăzi vigneta" value="' + (a.produs || '') + '" oninput="draftSave()"></div>'
    + '<div class="g2">'
    + '<div class="field"><label>Helyszín</label><input class="input ach-loc" placeholder="pl. Győr" value="' + (a.loc || '') + '" oninput="draftSave()"></div>'
    + '<div class="field"><label>Sumă (RON)</label><input class="input ach-pret" type="number" value="' + (a.pret || '0') + '" inputmode="numeric" oninput="draftSave()"></div>'
    + '</div>'
    + '<div class="field"><label>Plată</label><select class="input ach-plata" style="padding:10px 14px;" onchange="draftSave()"><option>Card</option><option>Cash</option><option>Flota Card</option><option>DKV</option></select></div>';
  document.getElementById('achizitiiContainer').appendChild(d);
  if (a.plata) {
    var sel = d.querySelector('.ach-plata');
    if (sel) sel.value = a.plata;
  }
}

// ============================================================
// MENETLEVÉL BEKÜLDÉS
// ============================================================
function submitFuvarlevel() {
  var fisa = (document.getElementById('fFisa') ? document.getElementById('fFisa').value.trim() : '');
  // Sorszámot a szerver generálja automatikusan

  var puncte = [];
  document.querySelectorAll('#puncteContainer .dyn-row').forEach(function(row) {
    puncte.push({
      tip: (row.querySelector('.punct-tip') || {}).value || '',
      loc: (row.querySelector('.punct-loc') || {}).value || '',
      data: (row.querySelector('.punct-data') || {}).value || ''
    });
  });

  var alimentari = [];
  document.querySelectorAll('#alimentariContainer .dyn-row').forEach(function(row) {
    alimentari.push({
      loc: (row.querySelector('.alim-loc') || {}).value || '',
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
      pret: parseFloat((row.querySelector('.ach-pret') || {}).value) || 0,
      plata: (row.querySelector('.ach-plata') || {}).value || 'Card'
    });
  });

  var locPlecare = puncte.length ? puncte[0].loc : '';
  var locSosire = puncte.length > 1 ? puncte[puncte.length - 1].loc : '';

  var payload = {
    numarFisa: fisa,
    cursaSaptamanii: document.getElementById('fCursaSapt').value,
    numarCamion: document.getElementById('fCamion').value,
    numarRemorca: document.getElementById('fRemorca').value,
    kmInceput: document.getElementById('fKmInc').value,
    kmSfarsit: document.getElementById('fKmSf').value,
    locPlecare: locPlecare,
    locSosire: locSosire,
    diurnaExterna: document.getElementById('fDiurnaEx').value,
    diurnaInterna: document.getElementById('fDiurnaIn').value,
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
      toast('✅ Menetlevél elküldve!', 'ok');
      draftClear();
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
        alimIdx = 0; achIdx = 0; punctIdx = 0;
        loadSoferOrders();
      }, 500);
    } else {
      toast('Hiba: ' + (d.err || 'ismeretlen'), 'err');
    }
  }).catch(function() { toast('Hálózati hiba', 'err'); });
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
  if (!file) { toast('Válassz fájlt!', 'err'); return; }
  var fr = new FileReader();
  fr.onload = function(e) {
    fetch('/api/doc-upload', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: e.target.result, numeFisier: file.name, tip: selDocTip }) })
    .then(function(r) { return r.json(); }).then(function(d) {
      if (d.success) { toast('✅ Feltöltve!', 'ok'); goSec('dash'); }
      else { toast('Hiba: ' + (d.err || 'ismeretlen'), 'err'); }
    });
  };
  fr.readAsDataURL(file);
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
// INIT — authMe + állapot visszaállítás
// ============================================================
var _meData = null;

fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ functionName: 'authMe' }) })
.then(function(r) { return r.json(); }).then(function(d) {
  if (!d.result) { window.location.href = '/login'; return; }
  _meData = d.result;
  document.getElementById('meBadge').textContent = d.result.nume;
  if (window.VS_PUSH) VS_PUSH.init(d.result.email, d.result.pozicio);
    initFirebaseChat(d.result);
    loadDashOrders();

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
      toast('📝 Piszkozat visszaállítva', 'ok');
    });
    return;
  }

  // Aktív szekció visszaállítás
  if (state.sec && state.sec !== 'dash') {
    goSec(state.sec);
  }
});

// ============================================================
// FIREBASE CHAT — Sofőr oldal
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
        document.getElementById('chatInitMsg').textContent = '⚠️ Chat konfiguráció hiányzik.';
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
    .catch(function() { document.getElementById('chatInitMsg').textContent = '⚠️ Chat nem elérhető.'; });
}

function soferShowContactList(me) {
  var contactView = document.getElementById('chatContactView');
  contactView.style.display = 'flex';
  document.getElementById('chatRoomView').style.display = 'none';

  var listEl = document.getElementById('chatContactList');
  if (!_chatManagers.length) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;">Nincs elérhető manager.</div>';
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
  msgsEl.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:20px;">Betöltés...</div>';

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
      var ts = msg.ts ? new Date(msg.ts).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }) : '';
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
    fromName: _meData.nume || 'Sofőr',
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
      fromName: _meData.nume || 'Sofőr',
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
  if(!txt || txt.length<5){ toast('Írj le legalább 5 karaktert!','err'); return; }
  var btn = document.getElementById('bugSubmitBtn');
  btn.disabled=true; btn.textContent='Küldés...';
  fetch('/api/execute',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({functionName:'sendBugReport',arguments:[txt,'sofer']})})
  .then(function(r){return r.json();}).then(function(d){
    btn.disabled=false; btn.textContent='📤 Küldés';
    var r=d.result;
    if(r&&r.ok){ toast('Hibajelentés elküldve, köszönjük!','ok'); closeBugReport(); }
    else { toast((r&&r.err)||'Hiba történt','err'); }
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

// Egy kiosztott fuvar kártyája — új .fuvar-card kinézet + MEGŐRZÖTT akciógombok.
// Alocat → Elfogadom, In Curs → Elvégeztem, Finalizat → nincs státuszváltó (csak UIT).
function renderFuvarCard(o) {
  var isAlocat = o.status === 'Alocat';
  var isCurs   = o.status === 'In Curs';
  var isFinal  = o.status === 'Finalizat';
  var statusCls = isAlocat ? 'warn' : 'ok';
  var statusTxt = isFinal ? '✓ Teljesítve' : (o.status || 'Alocat');
  var truck = o.rendszam_camion ? ('🚛 ' + o.rendszam_camion + (o.rendszam_remorca ? ' / ' + o.rendszam_remorca : '')) : '';
  var actionBtn =
      isAlocat ? '<button class="sh-btn resume"  onclick="driverOrderStatus(\'' + o.id + '\',\'In Curs\')">✅ Elfogadom</button>' :
      isCurs   ? '<button class="sh-btn confirm" onclick="driverOrderStatus(\'' + o.id + '\',\'Finalizat\')">🏁 Elvégeztem</button>' :
                 '';
  return '' +
    '<div class="fuvar-card">' +
      '<div class="fuvar-destination">📍 ' + (o.loc_incarcare||'—') + ' → ' + (o.loc_descarcare||'—') + '</div>' +
      '<div class="fuvar-meta">' +
        '<span>#' + o.id + '</span>' +
        (o.client ? '<span>' + o.client + '</span>' : '') +
        (truck ? '<span>' + truck + '</span>' : '') +
        '<span class="fuvar-status ' + statusCls + '">' + statusTxt + '</span>' +
      '</div>' +
      '<div class="fuvar-actions">' +
        '<button class="sh-btn uit" onclick="SoferUit.open(\'' + o.id + '\')" title="UIT-kódok (RO e-Transport)">🚛 UIT</button>' +
        actionBtn +
      '</div>' +
    '</div>';
}

function loadDashOrders() {
  fetch('/api/execute', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ functionName:'getMySoferOrders' }) })
  .then(function(r){ return r.json(); })
  .then(function(d){
    var list = d.result || [];
    var el = document.getElementById('kiosztottList');
    if (!el) return;
    // Dashboard: aktív (Alocat/In Curs) + Finalizat a teljesítéstől 3 napig (szerver számolja).
    var active = list.filter(function(o){ return o.dash_visible; });
    updateScrollBehavior(active);
    if (!active.length) {
      el.innerHTML = '<div class="kiosztott-empty">Nincs aktív kiosztott fuvar.</div>';
      return;
    }
    el.innerHTML = active.map(renderFuvarCard).join('');
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
      toast(status==='In Curs' ? '✅ Fuvar elfogadva!' : '🏁 Fuvar teljesítve! Manager értesítve.', 'ok');
      loadDashOrders();
    } else {
      toast(d.err||'Hiba', 'err');
    }
  });
}
