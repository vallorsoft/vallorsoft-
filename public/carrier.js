// ============================================================
//  VallorSoft — public/carrier.js  (alvállalkozói portál kliens)
//  Belépés/jelszó + rád osztott fuvarok + dokumentum le-/feltöltés
//  + saját jármű felvitele. Adat: /api/carrier/*.
// ============================================================
(function () {
  var _orders = [], _vehicles = [], _setToken = null;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function show(v) { ['viewLogin', 'viewSet', 'viewDash'].forEach(function (x) { $(x).classList.toggle('hidden', x !== v); }); }
  function toast(m, k) { var el = $('toast'); el.textContent = m; el.className = 'toast show ' + (k || ''); clearTimeout(window.__tt); window.__tt = setTimeout(function () { el.className = 'toast ' + (k || ''); }, 2600); }
  function api(method, url, body) { return fetch(url, { method: method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json(); }); }
  function fmtD(d) { if (!d) return '—'; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? (p[2] + '.' + p[1] + '.') : d; }
  function ST(status) {
    var M = { Disponibil: { c: 'b-info', k: 'car.stWait' }, Alocat: { c: 'b-warn', k: 'car.stAllocated' }, 'In Curs': { c: 'b-ok', k: 'car.stOnRoad' }, Finalizat: { c: 'b-info', k: 'car.stDone' }, Extern: { c: 'b-warn', k: 'car.stExtern' } };
    var m = M[status]; return m ? { c: m.c, t: t(m.k) } : { c: 'b-info', t: status };
  }

  function init() {
    var q = new URLSearchParams(location.search); _setToken = q.get('token');
    if (_setToken) { show('viewSet'); return; }
    api('GET', '/api/carrier/me').then(function (r) { if (r && r.ok) { fillMe(r); show('viewDash'); loadAll(); } else show('viewLogin'); }).catch(function () { show('viewLogin'); });
  }
  function fillMe(r) { $('dCarrier').textContent = r.carrier_nev || r.nev || ''; $('dCeg').textContent = t('car.carrierLabel') + ' ' + (r.ceg_nev || ''); $('dAv').textContent = (r.carrier_nev || r.email || '?').charAt(0).toUpperCase(); }
  function login() { var e = $('liEmail').value.trim(), p = $('liPass').value; if (!e || !p) { toast(t('car.needLogin'), 'err'); return; } api('POST', '/api/carrier/login', { email: e, password: p }).then(function (r) { if (r && r.ok) { api('GET', '/api/carrier/me').then(function (m) { if (m.ok) fillMe(m); show('viewDash'); loadAll(); }); } else toast((r && r.err) || t('car.badLogin'), 'err'); }); }
  function setPw() { var a = $('spPass').value, b = $('spPass2').value; if (a.length < 6) { toast(t('car.min6'), 'err'); return; } if (a !== b) { toast(t('car.pwMismatch'), 'err'); return; } api('POST', '/api/carrier/set-password', { token: _setToken, password: a }).then(function (r) { if (r && r.ok) { history.replaceState(null, '', '/carrier'); api('GET', '/api/carrier/me').then(function (m) { if (m.ok) fillMe(m); show('viewDash'); loadAll(); }); toast(t('car.pwSet'), 'ok'); } else toast((r && r.err) || t('common.error'), 'err'); }); }
  function logout() { api('POST', '/api/carrier/logout').then(function () { location.href = '/carrier'; }); }

  function loadAll() { loadOrders(); loadVehicles(); loadMyDocs(); }

  function loadOrders() {
    api('GET', '/api/carrier/orders').then(function (r) {
      if (!r || !r.ok) { $('dOrders').innerHTML = '<div class="mut" style="text-align:center;padding:20px">' + esc(t('common.loadError')) + '.</div>'; return; }
      _orders = r.orders || []; var s = r.stats || {};
      $('dStats').innerHTML = tile(t('car.statActive'), s.active || 0) + tile(t('car.statOnRoad'), s.onroad || 0, '#15803d') + tile(t('car.statPayable'), (Math.round(s.payable || 0)) + ' €', '#b45309');
      // a fuvar-választó az upload-hoz
      var sel = $('uOrder'); if (sel) sel.innerHTML = '<option value="">' + esc(t('car.general')) + '</option>' + _orders.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.id) + ' · ' + esc(o.loc_incarcare || '') + '→' + esc(o.loc_descarcare || '') + '</option>'; }).join('');
      if (!_orders.length) { $('dOrders').innerHTML = '<div class="mut" style="text-align:center;padding:24px">' + esc(t('car.noOrders')) + '</div>'; return; }
      $('dOrders').innerHTML = _orders.map(card).join('');
    });
  }
  function tile(k, v, col) { return '<div class="glass tile"><div class="k">' + esc(k) + '</div><div class="v" style="' + (col ? 'color:' + col : '') + '">' + v + '</div></div>'; }
  function card(o) {
    var st = ST(o.status);
    var docs = (o.documents || []).map(function (d) {
      var url = d.src === 'order' ? '/api/carrier/order-doc/' + d.id : '/api/carrier/document/' + d.id;
      return '<a class="chip" href="' + url + '" target="_blank">' + (d.src === 'order' ? '📄' : '📎') + ' ' + esc(d.name) + '</a>';
    }).join('');
    return '<div class="ord"><div class="row1"><span class="id">' + esc(o.id) + '</span><span class="badge ' + st.c + '">● ' + esc(st.t) + '</span>'
      + (o.load_type ? '<span class="badge b-info">' + esc(o.load_type) + '</span>' : '')
      + (o.carrier_cost ? '<span class="badge b-warn" style="margin-left:auto">' + esc(t('car.fee')) + ' ' + Math.round(o.carrier_cost) + ' €</span>' : '') + '</div>'
      + '<div class="route">' + esc(o.loc_incarcare || '—') + ' → ' + esc(o.loc_descarcare || '—') + '</div>'
      + '<div class="meta">' + (o.rendszam_camion ? '<span>🚛 ' + esc(o.rendszam_camion) + '</span>' : '')
      + '<span>📅 ' + esc(t('car.loadingLabel')) + ' ' + fmtD(o.data_incarcare) + '</span>' + (o.suly_kg ? '<span>⚖️ ' + o.suly_kg + ' kg</span>' : '')
      + (o.ref ? '<span>' + esc(t('car.refLabel')) + ' ' + esc(o.ref) + '</span>' : '') + '</div>'
      + '<div class="docs">' + (docs || '<span class="mut" style="font-size:12px">' + esc(t('car.noDocsYet')) + '</span>') + '</div></div>';
  }

  function loadVehicles() {
    api('GET', '/api/carrier/vehicles').then(function (r) {
      var box = $('dVehicles'); if (!box) return;
      _vehicles = (r && r.items) || [];
      box.innerHTML = _vehicles.length ? _vehicles.map(function (v) {
        return '<div class="vrow" id="vrow_' + v.id + '">'
          + '<div style="flex:1">'
          + '<b>' + esc(v.rendszam_camion || '') + '</b>'
          + (v.rendszam_remorca ? ' + ' + esc(v.rendszam_remorca) : '')
          + (v.marca ? ' <span class="mut">' + esc(v.marca) + ' ' + esc(v.model || '') + '</span>' : '')
          + (v.an_fabricatie ? ' <span class="mut" style="font-size:11px">📅 ' + esc(v.an_fabricatie) + '</span>' : '')
          + (v.sofer_nev ? ' <span class="mut" style="font-size:11px">👤 ' + esc(v.sofer_nev) + (v.sofer_tel ? ' · 📞 ' + esc(v.sofer_tel) : '') + '</span>' : '')
          + (v.nota ? ' <span class="mut" style="font-size:11px;display:block">📝 ' + esc(v.nota) + '</span>' : '')
          + (v.cargo_length_cm ? ' <span class="mut" style="font-size:11px;display:block">📐 ' + esc(v.cargo_length_cm) + '×' + esc(v.cargo_width_cm) + '×' + esc(v.cargo_height_cm) + ' cm' + (v.trailer_kind ? ' (' + esc(v.trailer_kind) + ')' : '') + '</span>' : '')
          + '</div>'
          + '<button class="btn" style="padding:5px 9px;font-size:11px" onclick="Carrier.editVehicle(' + v.id + ')" title="' + esc(t('car.editVehicle')) + '">✎</button>'
          + '<button class="btn" style="padding:5px 9px" onclick="Carrier.delVehicle(' + v.id + ')">✕</button>'
          + '</div>';
      }).join('') : '<div class="mut" style="font-size:12px">' + esc(t('car.noVehicleYet')) + '</div>';
    });
  }
  function editVehicle(id) {
    var v = _vehicles.find(function (x) { return x.id === id; });
    if (!v) return;
    var row = $('vrow_' + id); if (!row) return;
    row.innerHTML = '<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;width:100%">'
      + '<input class="inp" id="ve_cam_' + id + '" value="' + esc(v.rendszam_camion || '') + '" style="flex:1;min-width:90px;padding:7px 9px">'
      + '<input class="inp" id="ve_rem_' + id + '" value="' + esc(v.rendszam_remorca || '') + '" placeholder="' + esc(t('car.phTrailer')) + '" style="flex:1;min-width:80px;padding:7px 9px">'
      + '<input class="inp" id="ve_marca_' + id + '" value="' + esc(v.marca || '') + '" placeholder="' + esc(t('car.phBrand')) + '" style="flex:1;min-width:70px;padding:7px 9px">'
      + '<input class="inp" id="ve_model_' + id + '" value="' + esc(v.model || '') + '" placeholder="' + esc(t('car.phModel')) + '" style="flex:1;min-width:70px;padding:7px 9px">'
      + '<input class="inp" id="ve_sofer_' + id + '" value="' + esc(v.sofer_nev || '') + '" placeholder="' + esc(t('car.phDriver')) + '" style="flex:2;min-width:110px;padding:7px 9px">'
      + '<input class="inp" id="ve_sofertel_' + id + '" value="' + esc(v.sofer_tel || '') + '" placeholder="' + esc(t('car.phDriverTel')) + '" type="tel" style="flex:1;min-width:90px;padding:7px 9px">'
      + '<input class="inp" id="ve_an_' + id + '" value="' + esc(v.an_fabricatie || '') + '" placeholder="' + esc(t('car.phYear')) + '" type="number" min="1990" max="2030" style="flex:1;min-width:80px;padding:7px 9px">'
      + '<textarea class="inp" id="ve_nota_' + id + '" placeholder="' + esc(t('car.phNote')) + '" style="flex:2;min-width:140px;padding:7px 9px;resize:vertical">' + esc(v.nota || '') + '</textarea>'
      + '<select class="inp" id="ve_tkind_' + id + '" style="flex:1;min-width:110px;padding:7px 9px" onchange="carrierKindFill(' + id + ')">'
      + '<option value="">' + esc(t('car.trailerKindPick')) + '</option>'
      + '<option value="standard"' + (v.trailer_kind==='standard'?' selected':'') + '>' + esc(t('car.trailerStd')) + '</option>'
      + '<option value="mega"' + (v.trailer_kind==='mega'?' selected':'') + '>' + esc(t('car.trailerMega')) + '</option>'
      + '</select>'
      + '<input class="inp" id="ve_clen_' + id + '" value="' + esc(v.cargo_length_cm || '') + '" placeholder="' + esc(t('car.phCargoLen')) + '" type="number" min="100" max="2000" style="flex:1;min-width:75px;padding:7px 9px">'
      + '<input class="inp" id="ve_cwid_' + id + '" value="' + esc(v.cargo_width_cm || '') + '" placeholder="' + esc(t('car.phCargoWid')) + '" type="number" min="100" max="350" style="flex:1;min-width:75px;padding:7px 9px">'
      + '<input class="inp" id="ve_chei_' + id + '" value="' + esc(v.cargo_height_cm || '') + '" placeholder="' + esc(t('car.phCargoHei')) + '" type="number" min="50" max="400" style="flex:1;min-width:75px;padding:7px 9px">'
      + '<button class="btn ok" style="padding:5px 10px" onclick="Carrier.saveVehicle(' + id + ')">✓</button>'
      + '<button class="btn" style="padding:5px 10px" onclick="Carrier.loadVehicles()">✕</button>'
      + '</div>';
  }
  function saveVehicle(id) {
    var g = function (sfx) { var el = document.getElementById(sfx + '_' + id); return el ? el.value.trim() : ''; };
    var cam = g('ve_cam'); if (!cam) { toast(t('car.tractorReq'), 'err'); return; }
    var anRaw = g('ve_an'); var anVal = anRaw ? parseInt(anRaw, 10) || null : null;
    var rem = g('ve_rem');
    var cLen = g('ve_clen') ? parseInt(g('ve_clen'), 10) || null : null;
    var cWid = g('ve_cwid') ? parseInt(g('ve_cwid'), 10) || null : null;
    var cHei = g('ve_chei') ? parseInt(g('ve_chei'), 10) || null : null;
    if (rem && (!cLen || !cWid || !cHei)) { toast(t('car.dimRequired'), 'err'); return; }
    api('PUT', '/api/carrier/vehicles/' + id, { rendszam_camion: cam, rendszam_remorca: rem, marca: g('ve_marca'), model: g('ve_model'), sofer_nev: g('ve_sofer'), sofer_tel: g('ve_sofertel'), an_fabricatie: anVal, nota: g('ve_nota'), trailer_kind: g('ve_tkind'), cargo_length_cm: cLen, cargo_width_cm: cWid, cargo_height_cm: cHei }).then(function (r) {
      if (r && r.ok) { toast(t('car.vehicleSaved'), 'ok'); loadVehicles(); } else toast((r && r.err) || t('common.error'), 'err');
    });
  }
  function addVehicle() {
    var cam = ($('vCam').value || '').trim().toUpperCase();
    if (!cam) { toast(t('car.tractorReq'), 'err'); return; }
    // GDPR check — sofőr névnél kötelező figyelmeztetés
    var sofer = $('vSofer') ? $('vSofer').value.trim() : '';
    function doSave() {
      var anRaw = $('vAn') ? $('vAn').value.trim() : '';
      var rem = $('vRem') ? $('vRem').value.trim() : '';
      var cLen = $('vCargoLen') ? parseInt($('vCargoLen').value, 10) || null : null;
      var cWid = $('vCargoWid') ? parseInt($('vCargoWid').value, 10) || null : null;
      var cHei = $('vCargoHei') ? parseInt($('vCargoHei').value, 10) || null : null;
      if (rem && (!cLen || !cWid || !cHei)) { toast(t('car.dimRequired'), 'err'); return; }
      api('POST', '/api/carrier/vehicles', {
        rendszam_camion: cam,
        rendszam_remorca: rem,
        marca: $('vMarca') ? $('vMarca').value.trim() : '',
        model: $('vModel') ? $('vModel').value.trim() : '',
        sofer_nev: sofer,
        sofer_tel: $('vSoferTel') ? $('vSoferTel').value.trim() : '',
        an_fabricatie: anRaw ? (parseInt(anRaw, 10) || null) : null,
        nota: $('vNota') ? $('vNota').value.trim() : '',
        trailer_kind: $('vTrailerKind') ? $('vTrailerKind').value : null,
        cargo_length_cm: cLen,
        cargo_width_cm: cWid,
        cargo_height_cm: cHei
      }).then(function (r) {
        if (r && r.ok) {
          toast(t('car.vehicleAdded'), 'ok');
          ['vCam', 'vRem', 'vMarca', 'vModel', 'vSofer', 'vSoferTel', 'vAn', 'vNota', 'vCargoLen', 'vCargoWid', 'vCargoHei'].forEach(function (i) { if ($(i)) $(i).value = ''; });
          if ($('vTrailerKind')) $('vTrailerKind').value = '';
          loadVehicles();
        } else toast((r && r.err) || t('common.error'), 'err');
      });
    }
    if (!sessionStorage.getItem('car_gdpr_veh_ok')) {
      var modal = document.getElementById('gdprVehModal');
      if (modal) {
        modal.style.display = 'flex';
        window._gdprVehPendingSave = doSave;
      } else { doSave(); }
    } else { doSave(); }
  }
  window.carrierKindFill = function (id) {
    var kind = (document.getElementById('ve_tkind_' + id) || {}).value;
    if (!kind) return;
    var hei = kind === 'mega' ? 305 : 260;
    var lenEl = document.getElementById('ve_clen_' + id);
    var widEl = document.getElementById('ve_cwid_' + id);
    var heiEl = document.getElementById('ve_chei_' + id);
    if (lenEl && !lenEl.value) lenEl.value = 1360;
    if (widEl && !widEl.value) widEl.value = 248;
    if (heiEl && !heiEl.value) heiEl.value = hei;
  };
  window.gdprVehAccept = function () {
    sessionStorage.setItem('car_gdpr_veh_ok', '1');
    var modal = document.getElementById('gdprVehModal');
    if (modal) modal.style.display = 'none';
    if (window._gdprVehPendingSave) { window._gdprVehPendingSave(); window._gdprVehPendingSave = null; }
  };
  function delVehicle(id) { api('DELETE', '/api/carrier/vehicles/' + id).then(function (r) { if (r && r.ok) { toast(t('common.deleted'), 'ok'); loadVehicles(); } }); }

  function loadMyDocs() {
    api('GET', '/api/carrier/documents').then(function (r) {
      var box = $('dMyDocs'); if (!box) return; var items = (r && r.items) || [];
      if (!items.length) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="mut" style="font-size:11px;margin-bottom:5px">' + esc(t('car.myUploads')) + '</div>' + items.map(function (d) {
        return '<a class="chip" href="/api/carrier/document/' + d.id + '" target="_blank" style="margin:0 5px 5px 0">📎 ' + esc(d.file_name || '') + (d.order_id ? ' · ' + esc(d.order_id) : '') + '</a>';
      }).join('');
    });
  }
  function upload() {
    var f = ($('uFile').files || [])[0]; if (!f) { toast(t('car.pickFile'), 'err'); return; }
    if (f.size > 10 * 1024 * 1024) { toast(t('car.fileTooBig'), 'err'); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      api('POST', '/api/carrier/upload', { file_name: f.name, mime: f.type || 'application/octet-stream', data_base64: String(e.target.result || ''), kind: $('uKind').value, order_id: $('uOrder').value || null }).then(function (r) {
        if (r && r.ok) { toast('📎 ' + t('car.uploaded'), 'ok'); $('uFile').value = ''; loadMyDocs(); loadOrders(); } else toast((r && r.err) || t('common.error'), 'err');
      });
    };
    reader.readAsDataURL(f);
  }

  window.Carrier = { login: login, setPw: setPw, logout: logout, addVehicle: addVehicle, editVehicle: editVehicle, saveVehicle: saveVehicle, delVehicle: delVehicle, upload: upload, loadVehicles: loadVehicles };
  // Nyelvváltáskor a JS-ből renderelt tartalmat újrarajzoljuk
  window.onLangChange = function () { if (!$('viewDash').classList.contains('hidden')) loadAll(); };
  document.addEventListener('DOMContentLoaded', init);
})();
