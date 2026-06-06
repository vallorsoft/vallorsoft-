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
var sections = ['dash','border','fuvar','docs','chat','shift'];;

function goSec(id) {
  sections.forEach(function(s) {
    document.getElementById('sec-' + s).classList.add('hidden');
  });
  var next = document.getElementById('sec-' + id);
  next.classList.remove('hidden');
  next.classList.add('sec-entering');
  setTimeout(function() { next.classList.remove('sec-entering'); }, 220);
  window.scrollTo({ top: 0, behavior: 'instant' });

  stateSave({ sec: id });
  if (id === 'border') loadBorderLog();
  if (id === 'fuvar')  loadSoferOrders();
  if (id === 'shift')  loadShiftState();
  if (id !== 'shift' && _shiftTimer) { clearInterval(_shiftTimer); _shiftTimer = null; }
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
    _soferOrdersCache = d.result || [];
    var el = document.getElementById('soferOrderList');
    if (!_soferOrdersCache.length) {
      el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:13px;">Nincs hozzárendelt fuvar.</div>';
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
// MŰSZAK (SHIFT) — STATE, TIMER, API
// ============================================================
var _shiftData        = null;   // legutolsó API adat
var _shiftTimer       = null;   // setInterval: 1s timer a szekción
var _shiftPoll        = null;   // setInterval: 30s polling
var _showRestPicker   = false;  // lokális flag: nap zárása után REST picker látszik
 
// Polling indítása (szerver indítás után, és navigáció után)
function startShiftPoll() {
  if (_shiftPoll) clearInterval(_shiftPoll);
  _shiftPoll = setInterval(loadShiftState, 30000);
}
 
// ── Adatlekérés és renderelés ─────────────────────────────────
function loadShiftState() {
  fetch('/api/shift/current')
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (!d.ok) return;
      _shiftData = d.shift;
      renderShiftBanner(d.shift, d.locked_until);
      // Szekció csak akkor renderel, ha látható (vagy ha REST picker flag él)
      var secVisible = !document.getElementById('sec-shift').classList.contains('hidden');
      if (secVisible || _showRestPicker) {
        renderShiftSection(d.shift, d.locked_until);
      }
    }).catch(function(){});
}
 
// ── BANNER RENDERELÉS (főoldal kártya) ────────────────────────
function renderShiftBanner(shift, lockedUntil) {
  var banner  = document.getElementById('shiftBanner');
  var label   = document.getElementById('scLabel');
  var timer   = document.getElementById('scTimer');
  var ico     = document.getElementById('scIco');
  var sub     = document.getElementById('scSub');
  var euWrap  = document.getElementById('scEuWrap');
  var euFill  = document.getElementById('scEuFill');
  if (!banner) return;
 
  // Osztályok reset
  banner.className = 'shift-card';
 
  if (!shift) {
    if (lockedUntil && new Date(lockedUntil) > new Date()) {
      banner.classList.add('sc-locked');
      label.textContent = '🔒 Heti zárolás';
      timer.textContent = fmtCountdown(lockedUntil);
      ico.textContent   = '🔒';
      sub.textContent   = 'Koppints a részletekért';
    } else {
      label.textContent = 'Nincs aktív műszak';
      timer.textContent = '▶ Indítás';
      ico.textContent   = '🕐';
      sub.textContent   = 'Koppints a nap kezdéséhez';
    }
    euWrap.style.display = 'none';
    return;
  }
 
  if (shift.status === 'ACTIVE') {
    banner.classList.add('sc-active');
    label.textContent = '🟢 Aktív műszak';
    ico.textContent   = '🟢';
    sub.textContent   = (shift.shift_index_in_week || 1) + '. nap · ' +
                        parseFloat(shift.weekly_hours_total || 0).toFixed(1) + 'ó a héten';
    euWrap.style.display = 'block';
    updateEuFill(euFill, calcActiveH(shift));
    timer.textContent = fmtSecs(calcActiveSecs(shift));
  } else if (shift.status === 'PAUSED') {
    banner.classList.add('sc-paused');
    label.textContent = '⏸ Szünet';
    ico.textContent   = '⏸';
    sub.textContent   = 'Koppints a visszatéréshez';
    timer.textContent = fmtSecs(calcPauseSecs(shift));
    euWrap.style.display = 'none';
  } else if (shift.status === 'REST') {
    banner.classList.add('sc-rest');
    label.textContent = '😴 Pihenő';
    ico.textContent   = '😴';
    timer.textContent = shift.rest_type === 'vacation' ? '🏖 Szabadság' : (shift.rest_type || '—');
    sub.textContent   = shift.next_shift_start
      ? 'Következő: ' + fmtDt(shift.next_shift_start)
      : 'Koppints a részletekért';
    euWrap.style.display = 'none';
  }
}
 
// ── SZEKCIÓ RENDERELÉS (sec-shift tartalom) ───────────────────
function renderShiftSection(shift, lockedUntil) {
  // Timer törlése (majd újra indul ha ACTIVE)
  if (_shiftTimer) { clearInterval(_shiftTimer); _shiftTimer = null; }
 
  var actions     = document.getElementById('shiftActions');
  var pausePanel  = document.getElementById('shiftPausePanel');
  var restPanel   = document.getElementById('shiftRestPanel');
  var lockedPanel = document.getElementById('shiftLockedPanel');
  var statCard    = document.getElementById('shiftStatCard');
  var secLabel    = document.getElementById('shiftSecLabel');
  var secTimer    = document.getElementById('shiftSecTimer');
  var weekLabel   = document.getElementById('shiftWeekLabel');
  var weekVal     = document.getElementById('shiftWeekVal');
  var euWrap      = document.getElementById('shiftSecEuWrap');
  var euFill      = document.getElementById('shiftSecEuFill');
  var euLegend    = document.getElementById('shiftEuLegend');
  if (!actions) return;
 
  // Reset mindent
  actions.innerHTML       = '';
  pausePanel.style.display  = 'none';
  restPanel.style.display   = 'none';
  lockedPanel.style.display = 'none';
  euWrap.style.display      = 'none';
  euLegend.style.display    = 'none';
  statCard.style.borderColor = 'var(--border-bright)';
 
  // ── LOCKED ─────────────────────────────────────────────────
  if (!shift && lockedUntil && new Date(lockedUntil) > new Date()) {
    secLabel.textContent = '🔒 HETI ZÁROLÁS';
    secTimer.textContent = fmtCountdown(lockedUntil);
    weekLabel.textContent = '';
    weekVal.textContent   = '';
    statCard.style.borderColor = 'rgba(239,68,68,0.45)';
    lockedPanel.style.display  = 'block';
    document.getElementById('shiftLockedText').textContent =
      'Felszabadul: ' + fmtDt(lockedUntil);
    _showRestPicker = false;
    return;
  }
 
  // ── REST PICKER — nap zárása után (lokális flag) ────────────
  if (!shift && _showRestPicker) {
    secLabel.textContent  = '⏹ NAP LEZÁRVA';
    secTimer.textContent  = '😴';
    weekLabel.textContent = 'Válassz pihenőt!';
    weekVal.textContent   = '';
    statCard.style.borderColor = 'rgba(59,130,246,0.45)';
    restPanel.style.display    = 'block';
    // Szabadság dátum default: holnap
    var tom = new Date();
    tom.setDate(tom.getDate() + 1);
    document.getElementById('vacDate').value = tom.toISOString().split('T')[0];
    return;
  }
 
  // ── NINCS SHIFT ────────────────────────────────────────────
  if (!shift) {
    secLabel.textContent  = 'NINCS AKTÍV MŰSZAK';
    secTimer.textContent  = '—';
    weekLabel.textContent = '';
    weekVal.textContent   = '';
    actions.innerHTML =
      '<button class="sh-btn start" style="width:100%;padding:22px;font-size:18px;" onclick="shiftStart()">' +
      '▶ Nap kezdése</button>';
    return;
  }
 
  // Heti info (minden státusznál)
  weekLabel.textContent = (shift.shift_index_in_week || 1) + '. nap a héten';
  weekVal.textContent   = parseFloat(shift.weekly_hours_total || 0).toFixed(1) + ' ó';
 
  // ── ACTIVE ─────────────────────────────────────────────────
  if (shift.status === 'ACTIVE') {
    secLabel.textContent = '🟢 AKTÍV MŰSZAK';
    statCard.style.borderColor = 'rgba(34,197,94,0.45)';
    euWrap.style.display    = 'block';
    euLegend.style.display  = 'flex';
    updateEuFill(euFill, calcActiveH(shift));
    // 1 mp-es timer
    (function startT(){
      secTimer.textContent = fmtSecs(calcActiveSecs(shift));
      updateEuFill(euFill, calcActiveH(shift));
      // banner timer is frissítése
      var bt = document.getElementById('scTimer');
      if (bt) bt.textContent = fmtSecs(calcActiveSecs(shift));
      _shiftTimer = setInterval(function(){
        secTimer.textContent = fmtSecs(calcActiveSecs(shift));
        updateEuFill(euFill, calcActiveH(shift));
        if (bt) bt.textContent = fmtSecs(calcActiveSecs(shift));
      }, 1000);
    })();
    actions.innerHTML =
      '<button class="sh-btn pause" onclick="shiftPause()">⏸ Szünet</button>' +
      '<button class="sh-btn close" onclick="shiftCloseConfirm()">⏹ Nap zárása</button>';
  }
 
  // ── PAUSED ─────────────────────────────────────────────────
  else if (shift.status === 'PAUSED') {
    secLabel.textContent = '⏸ SZÜNET';
    statCard.style.borderColor = 'rgba(251,191,36,0.45)';
    (function startPT(){
      secTimer.textContent = fmtSecs(calcPauseSecs(shift));
      _shiftTimer = setInterval(function(){
        secTimer.textContent = fmtSecs(calcPauseSecs(shift));
        var bt = document.getElementById('scTimer');
        if (bt) bt.textContent = fmtSecs(calcPauseSecs(shift));
      }, 1000);
    })();
    pausePanel.style.display = 'block';
    actions.innerHTML =
      '<button class="sh-btn close" style="width:100%;" onclick="shiftCloseConfirm()">' +
      '⏹ Nap zárása szünetből</button>';
  }
 
  // ── REST ───────────────────────────────────────────────────
  else if (shift.status === 'REST') {
    secLabel.textContent = '😴 PIHENŐ';
    statCard.style.borderColor = 'rgba(59,130,246,0.45)';
    secTimer.textContent = shift.next_shift_start ? fmtDt(shift.next_shift_start) : (shift.rest_type || '—');
    weekLabel.textContent = (shift.shift_index_in_week || 1) + '. nap a héten';
    actions.innerHTML = '<button class="sh-btn cancel" style="width:100%;margin-top:12px;" onclick="shiftCancelRest()">🗑 Pihenő megszüntetése</button>';
  }
}
 
// ── IDŐSZÁMÍTÁSOK ──────────────────────────────────────────────
function calcActiveSecs(shift) {
  if (!shift || !shift.day_started_at) return 0;
  var elapsed = (Date.now() - new Date(shift.day_started_at).getTime()) / 1000;
  var paused  = (shift.paused_total_minutes || 0) * 60;
  if (shift.status === 'PAUSED' && shift.paused_at) {
    paused += (Date.now() - new Date(shift.paused_at).getTime()) / 1000;
  }
  return Math.max(0, elapsed - paused);
}
function calcActiveH(shift)  { return calcActiveSecs(shift) / 3600; }
function calcPauseSecs(shift) {
  if (!shift || !shift.paused_at) return 0;
  return Math.max(0, (Date.now() - new Date(shift.paused_at).getTime()) / 1000);
}
 
// ── FORMÁZÓK ──────────────────────────────────────────────────
function fmtSecs(s) {
  var h = Math.floor(s/3600), m = Math.floor((s%3600)/60), ss = Math.floor(s%60);
  return p2(h)+':'+p2(m)+':'+p2(ss);
}
function p2(n){ return n<10?'0'+n:''+n; }
function fmtDt(iso) {
  return new Date(iso).toLocaleString('hu-HU',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
}
function fmtCountdown(iso) {
  var diff = Math.max(0, new Date(iso).getTime() - Date.now());
  var h = Math.floor(diff/3600000), m = Math.floor((diff%3600000)/60000);
  return h+'ó '+m+'p';
}
function updateEuFill(el, h) {
  if (!el) return;
  var pct = Math.min(100, (h/15)*100);
  el.style.width = pct+'%';
  el.className = 'eu-fill' + (h>=13?' d':h>=11?' w':'');
}
 
// ── API HÍVÁSOK ───────────────────────────────────────────────
function shiftStart() {
  fetch('/api/shift/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
    .then(function(r){return r.json();})
    .then(function(d){
      if (d.ok) {
        toast('▶ Műszak elindítva!','ok');
        _showRestPicker = false;
        loadShiftState();
      } else if (d.locked) {
        toast('🔒 '+d.message,'err');
        loadShiftState();
      } else {
        toast('Hiba: '+(d.message||'ismeretlen'),'err');
      }
    }).catch(function(){toast('Hálózati hiba','err');});
}
 
function shiftPause() {
  fetch('/api/shift/pause',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
    .then(function(r){return r.json();})
    .then(function(d){
      if (d.ok) { toast('⏸ Szünet elindítva','ok'); loadShiftState(); }
      else { toast('Hiba: '+(d.message||''),'err'); }
    });
}
 
function shiftResume() {
  fetch('/api/shift/resume',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
    .then(function(r){return r.json();})
    .then(function(d){
      if (d.ok) { toast('✅ Visszatértél a műszakba!','ok'); loadShiftState(); }
      else { toast('Hiba: '+(d.message||''),'err'); }
    });
}
 
function shiftCloseConfirm() {
  var a = document.getElementById('shiftActions');
  if (!a) return;
  a.innerHTML =
    '<div style="width:100%;">' +
    '<div style="font-size:13px;color:var(--muted);text-align:center;margin-bottom:10px;">Biztosan lezárod a napot?</div>' +
    '<div style="display:flex;gap:10px;">' +
    '<button class="sh-btn confirm" style="flex:1;" onclick="shiftClose()">✅ Igen, lezárom</button>' +
    '<button class="sh-btn cancel"  style="flex:1;" onclick="loadShiftState()">← Vissza</button>' +
    '</div></div>';
}
 
function shiftClose() {
  fetch('/api/shift/close',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
    .then(function(r){return r.json();})
    .then(function(d){
      if (d.ok) {
        if (d.is_overtime) toast('⚠️ Túllépte a 15 órás EU limitet!','err');
        if (d.locked_until) toast('🔒 Heti zárolás aktív','err');
        toast('⏹ Nap lezárva — válassz pihenőt!','ok');
        _showRestPicker = true;
        loadShiftState();
      } else {
        toast('Hiba: '+(d.message||''),'err');
      }
    });
}
 

function shiftCancelRest() {
  if (!confirm('Biztosan megszünteted a pihenőt? Ezután új műszakot indíthatsz.')) return;
  fetch('/api/shift/cancel-rest', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'})
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d.ok) { toast('Pihenő törölve. Indíthatsz új műszakot.','ok'); loadShiftState(); }
      else toast(d.message||'Hiba','err');
    });
}

function shiftRest(type, hours) {
  var body = {rest_type:type};
  if (hours !== undefined) body.rest_hours = hours;
  fetch('/api/shift/rest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json();})
    .then(function(d){
      if (d.ok) {
        var ns = d.next_shift_start ? fmtDt(d.next_shift_start) : '—';
        toast('😴 Pihenő beállítva. Értesítő: '+ns+' előtt.','ok');
        _showRestPicker = false;
        loadShiftState();
      } else {
        toast('Hiba: '+(d.message||''),'err');
      }
    });
}
 
function shiftVacation() {
  var dateVal = document.getElementById('vacDate').value;
  var hourVal = parseInt(document.getElementById('vacHour').value);
  if (!dateVal) { toast('Add meg a visszatérés dátumát!','err'); return; }
  if (isNaN(hourVal)||hourVal<0||hourVal>23) { toast('Az óra 0–23 között legyen!','err'); return; }
  var target = new Date(dateVal);
  target.setHours(hourVal,0,0,0);
  var hoursUntil = (target.getTime()-Date.now())/3600000;
  if (hoursUntil<=0) { toast('A dátum a múltban van!','err'); return; }
  shiftRest('vacation', parseFloat(hoursUntil.toFixed(1)));
}
 
function shiftSnooze(hours) {
  fetch('/api/shift/snooze-pause',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({snooze_hours:hours})})
    .then(function(r){return r.json();})
    .then(function(d){
      if (d.ok) toast('⏰ Emlékeztető '+hours+' óra múlva.','ok');
    });
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
    loadShiftState();
    startShiftPoll();
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
function loadDashOrders() {
  fetch('/api/execute', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ functionName:'getMySoferOrders' }) })
  .then(function(r){ return r.json(); })
  .then(function(d){
    var list = d.result || [];
    var el = document.getElementById('dashOrderList');
    if (!el) return;
    var active = list.filter(function(o){ return o.status==='Alocat'||o.status==='In Curs'; });
    if (!active.length) {
      el.innerHTML = '<div style="text-align:center;padding:12px 0;color:var(--muted);font-size:13px;">Nincs aktív kiosztott fuvar.</div>';
      return;
    }
    el.innerHTML = active.map(function(o){
      var isAlocat = o.status === 'Alocat';
      var sc = isAlocat ? 'warn' : 'ok';
      return '<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:10px;">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">'+
          '<div style="font-weight:700;font-size:14px;color:#fff;">'+(o.client||'—')+
            ' <span style="font-size:11px;color:var(--muted);">#'+o.id+'</span>'+
          '</div>'+
          '<span class="badge '+sc+'">'+o.status+'</span>'+
        '</div>'+
        '<div style="font-size:12px;color:var(--soft);margin-bottom:10px;">'+
          '📍 '+(o.loc_incarcare||'—')+' → '+(o.loc_descarcare||'—')+
        '</div>'+
        (o.rendszam_camion ? '<div style="font-size:11px;color:var(--muted);margin-bottom:10px;">🚛 '+o.rendszam_camion+(o.rendszam_remorca?' / '+o.rendszam_remorca:'')+'</div>' : '')+
        '<div style="display:flex;gap:8px;">'+
          '<button class="sh-btn" style="flex:0 0 auto;padding:13px 12px;font-size:13px;background:rgba(255,255,255,.08);border:1px solid var(--border);color:#fff;" onclick="SoferUit.open(\''+o.id+'\')" title="UIT-kódok (RO e-Transport)">🚛 UIT</button>'+
          (isAlocat ? '<button class="sh-btn resume" style="flex:1;padding:13px 8px;font-size:13px;" onclick="driverOrderStatus(\''+o.id+'\',\'In Curs\')">✅ Elfogadom</button>' : '')+
          (!isAlocat ? '<button class="sh-btn confirm" style="flex:1;padding:13px 8px;font-size:13px;" onclick="driverOrderStatus(\''+o.id+'\',\'Finalizat\')">🏁 Elvégeztem</button>' : '')+
        '</div>'+
      '</div>';
    }).join('');
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
