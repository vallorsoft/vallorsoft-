// ============================================================
//  VallorSoft — manager.js  (SZEREP-SPECIFIKUS)
//  Csak a manager-egyedi fuggvenyek (szigorubb jogosultsag!) + init.
//  Kozos fuggvenyek: console-shared.js (elobb toltodik).
// ============================================================
const VS_ROLE = 'manager';

/* ── Bug report ── */
function submitBugReport(){
  var txt = document.getElementById('bugText').value.trim();
  if(!txt || txt.length<5){ toast('Írj le legalább 5 karaktert!','err'); return; }
  var btn = document.getElementById('bugSubmitBtn');
  btn.disabled=true; btn.textContent='Küldés...';
  gas('sendBugReport',[txt,'manager']).then(function(r){
    btn.disabled=false; btn.textContent='📤 Küldés';
    if(r&&r.ok){ toast('Hibajelentés elküldve, köszönjük!','ok'); closeBugReport(); }
    else { toast((r&&r.err)||'Hiba történt','err'); }
  });
}

document.querySelectorAll('.sidebar .tab, .sidebar .sub-tab').forEach(function(t){
  t.onclick=function(e){
    if(t.id==='userParentTab'){toggleUserMenu();return;}
    if(t.id==='ordersParentTab'){toggleOrdersMenu();return;}
    activateTab(t.dataset.tab);
  };
});

function loadTab(name){
    if(name==='dash') loadDash();
    if(name==='orders-form'){loadOrderFormData(); mountClientPicker();}
  if(name==='orders-list'){loadOrders();}
  if(name==='inbound' && window.InboundOrders) InboundOrders.mount('inboundBox');
    if(name==='received-fuv'){loadReceivedFuvarlevelek();loadDocSeries();}
    if(name==='driver-docs-pane') loadDriverUploadedDocs();
      if(name==='users') loadUsers();
    if(name==='invites') loadInvites();
    if(name==='vehicles') loadVehicles();
    if(name==='external-drivers') loadExtDrivers();
    if(name==='signature') initAdminSigCanvas();
  if(name==='shift-fleet') { loadShiftFleet(); loadDiurnaStats(); }
  if(name==='clients' && window.ClientsPage) ClientsPage.mount('clientsBox');
  }

// Ügyfélválasztó a fuvarűrlapon (egyszer mountoljuk; a kiválasztott nevet a meglévő
// szöveges Ügyfél mezőbe is bemásolja, így a fuvar-mentés változatlanul működik).
var _clientPickerMounted=false;
function mountClientPicker(){
  if(_clientPickerMounted || !window.ClientPicker) return;
  var box=document.getElementById('clientPickerBox');
  if(!box) return;
  ClientPicker.mount(box, {
    hiddenInputId:'orderClientId',
    onSelect:function(c){ var t=document.getElementById('oClient'); if(t) t.value=c.denumire||''; }
  });
  _clientPickerMounted=true;
}

/* ─── BEÁLLÍTÁSOK PANE ─── */
function loadSettingsPane(){
  gas('authMe').then(function(u){
    if(!u) return;
    document.getElementById('stNume').value    = u.nume  || '';
    document.getElementById('stEmail').value   = u.email || '';
    document.getElementById('stTel').value     = u.tel   || '';
    document.getElementById('stPozicio').value = u.pozicio || '';
  });
  gas('settings2faStatus').then(function(r){
    var dot   = document.getElementById('st2faDot');
    var label = document.getElementById('st2faLabel');
    var desc  = document.getElementById('st2faDesc');
    var disW  = document.getElementById('st2faDisableWrap');
    var enW   = document.getElementById('st2faEnableWrap');
    if(r && r.totp_enabled){
      dot.style.background   = 'var(--ok)';
      label.textContent      = 'Aktív — fiókod védett';
      desc.textContent       = 'A kétlépéses hitelesítés be van kapcsolva.';
      disW.style.display     = '';
      enW.style.display      = 'none';
    } else {
      dot.style.background   = 'var(--warn)';
      label.textContent      = 'Nincs bekapcsolva';
      desc.textContent       = 'Javasolt a 2FA aktiválása a fiókod védelméhez.';
      disW.style.display     = 'none';
      enW.style.display      = '';
    }
  });
}

// ── 2FA Settings bekapcsolás ──────────────────────────────

function loadDash(){
  gas('userListAll').then(u=>{ document.getElementById('cUsers').textContent=u.length; });
  gas('getFuvarlevelek').then(d=>{ document.getElementById('countFuv').textContent=d.length; });
  gas('dashStats').then(function(r){
    if(!r||!r.ok) return;
    document.getElementById('dashCegNev').textContent = r.ceg_nev;

    // KPI
    const total = r.statuszok.reduce(function(s,x){return s+x.db;},0);
    const aktiv = r.statuszok.filter(function(x){return x.status==='In Curs'||x.status==='Alocat';}).reduce(function(s,x){return s+x.db;},0);
    document.getElementById('kpiTotal').textContent = total;
    document.getElementById('kpiAktiv').textContent = aktiv;

    const colors = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7','#06b6d4'];

    // Státusz grafikon (doughnut)
    var ctx1 = document.getElementById('chartStatusz');
    if(ctx1._chart) ctx1._chart.destroy();
    ctx1._chart = new Chart(ctx1, { type:'doughnut', data:{
      labels: r.statuszok.map(function(x){return x.status;}),
      datasets:[{data: r.statuszok.map(function(x){return x.db;}), backgroundColor:colors, borderWidth:0}]
    }, options:{plugins:{legend:{labels:{color:'#8a97a8'}}}}});

    // Havi bevétel (bar)
    var ctx2 = document.getElementById('chartBevetel');
    if(ctx2._chart) ctx2._chart.destroy();
    ctx2._chart = new Chart(ctx2, { type:'bar', data:{
      labels: r.havi_bevetel.map(function(x){return x.ho;}),
      datasets:[{label:'EUR', data: r.havi_bevetel.map(function(x){return parseFloat(x.osszeg)||0;}),
        backgroundColor:'rgba(59,130,246,0.6)', borderColor:'#3b82f6', borderWidth:1}]
    }, options:{plugins:{legend:{display:false}}, scales:{x:{ticks:{color:'#8a97a8'}},y:{ticks:{color:'#8a97a8'}}}}});

    // Sofőr km (horizontal bar)
    var ctx3 = document.getElementById('chartKm');
    if(ctx3._chart) ctx3._chart.destroy();
    ctx3._chart = new Chart(ctx3, { type:'bar', data:{
      labels: r.sofor_km.map(function(x){return x.nume_sofer;}),
      datasets:[{label:'km', data: r.sofor_km.map(function(x){return parseFloat(x.total_km)||0;}),
        backgroundColor:'rgba(34,197,94,0.6)', borderColor:'#22c55e', borderWidth:1}]
    }, options:{indexAxis:'y', plugins:{legend:{display:false}}, scales:{x:{ticks:{color:'#8a97a8'}},y:{ticks:{color:'#8a97a8'}}}}});

    // Jármű kihasználtság (bar)
    var ctx4 = document.getElementById('chartJarmu');
    if(ctx4._chart) ctx4._chart.destroy();
    ctx4._chart = new Chart(ctx4, { type:'bar', data:{
      labels: r.jarmu_kihasznaltsag.map(function(x){return x.rendszam;}),
      datasets:[{label:'Fuvarok', data: r.jarmu_kihasznaltsag.map(function(x){return x.fuvarok;}),
        backgroundColor:'rgba(245,158,11,0.6)', borderColor:'#f59e0b', borderWidth:1}]
    }, options:{plugins:{legend:{display:false}}, scales:{x:{ticks:{color:'#8a97a8'}},y:{ticks:{color:'#8a97a8'}}}}});
  });
}

let myEmail = '';  // sajat email a connection-bol

function loadUsers(){
  gas('userListAll').then(list => {
    document.querySelector('#tblUsers tbody').innerHTML = list.map(u => {
      const isSelf = u.email.toLowerCase() === myEmail.toLowerCase();
      // Manager csak Sofer mellett, vagy sajat magat szerkesztheti; Admint NEM
      const canEdit = u.pozicio !== 'Admin' || isSelf;
      const editBtn = canEdit
        ? `<button class="btn primary" style="padding:4px 10px;font-size:12px;" onclick='editUser(${JSON.stringify(u)})'>Szerk</button>`
        : '<span style="color:var(--muted);font-size:12px;">—</span>';
      // Torol gomb csak Sofer mellett (sajat magat se torolheti)
      const delBtn = (u.pozicio === 'Sofer' && !isSelf)
        ? ` <button class="btn danger" style="padding:4px 10px;font-size:12px;" onclick="deleteUser('${u.email}','${u.nume}')">Töröl</button>`
        : '';
      return `<tr><td>${u.nume}</td><td>${u.email}</td><td>${u.tel||'—'}</td><td><span class="badge info">${u.pozicio}</span></td><td>${editBtn}${delBtn}</td></tr>`;
    }).join('');
  });
}

function deleteUser(email, nev){
  if(!confirm('Biztosan törlöd: '+nev+' ('+email+')?\n\nEz a művelet nem visszavonható!'))return;
  gas('userDelete',[email]).then(r=>{
    if(r.ok){
      toast('Sofőr törölve!','ok');
      loadUsers();
      loadDash();
    }else{
      toast(r.err||'Hiba történt','err');
    }
  });
}

function editUser(u){
  uNume.value = u.nume;
  uEmail.value = u.email;
  uTel.value = u.tel || '';
  uPoz.value = u.pozicio;
  uPwd.value = '';

  const isSelf = u.email.toLowerCase() === myEmail.toLowerCase();

  // Jelszo mezo SOR-jat (a szulo .field elemet) elrejtjuk, ha nem sajat magat szerkeszti
  const pwdField = document.getElementById('uPwd').closest('.field');
  pwdField.style.display = isSelf ? '' : 'none';

  // Pozicio mezot lezarjuk, ha sajat magat szerkeszti (nem fokozhatja le magat / nem adhat Admint maganak)
  // VAGY ha nem sajat maga es nem Admin a Manager (mert akkor csak Manager/Sofer kozott valthatna, de erre nincs ok)
  document.getElementById('uPoz').disabled = isSelf;

  // Admin opcio eltavolitasa a Pozicio dropdown-bol Manager szamara (Managernek nem szabad Admint generalni)
  const poz = document.getElementById('uPoz');
  // ujraepitjuk az opciokat: Manager szamara csak Manager/Sofer
  const allowed = ['Manager', 'Sofer'];
  poz.innerHTML = allowed.map(p => `<option ${p===u.pozicio?'selected':''}>${p}</option>`).join('');

  document.getElementById('userModal').classList.add('open');
}

function saveUser(){
  var f = { nume: uNume.value, tel: uTel.value };
  // poziciot csak akkor kuldjuk, ha a select NEM disabled (azaz nem sajat magat szerkeszti)
  if (!document.getElementById('uPoz').disabled) {
    f.pozicio = uPoz.value;
  }
  // jelszot csak sajat magaval kuldhet
  const isSelf = uEmail.value.toLowerCase() === myEmail.toLowerCase();
  if (isSelf && uPwd.value) {
    f.jelszo = uPwd.value;
  }
  gas('userUpdate', [uEmail.value, f]).then(r => {
    if (r && r.ok) {
      toast('Sikeresen mentve!', 'ok');
      closeModal();
      loadUsers();
      loadDash();
    } else {
      toast((r && r.err) || 'Hiba történt', 'err');
    }
  });
}

var _driverDocsCache = [];

// FUVAR
let internDriversCache=[],externDriversCache=[],camionCache=[],remorcaCache=[];

// ── Fuvar kereső / szűrő ──────────────────────────────────
var _ordersAllCache = [];
var _origLoadOrders;
function renderFilteredOrders(list) {
  var tbody = document.getElementById('tblOrdersBody');
  if (!tbody) return;
  if (!list.length) { tbody.innerHTML='<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:20px;">Nincs találat.</td></tr>'; return; }
  tbody.innerHTML = list.map(function(c){
    var soferInfo='—';
    if(c.sofer_type==='Intern')soferInfo=c.nume_sofer||c.email_sofer||'—';
    else if(c.sofer_type==='Extern')soferInfo=c.nume_sofer||c.firma_extern||'—';
    var sc='info';
    if(c.status==='Alocat')sc='warn';
    if(c.status==='In Curs'||c.status==='Finalizat')sc='ok';
    if(c.status==='Anulat')sc='err';
    if(c.status==='Extern')sc='warn';

    // Státusz dropdown — gombszerű, színes, kattintható
    var statuses = ['Disponibil','Alocat','In Curs','Finalizat','Anulat'];
    var selStyle = 'cursor:pointer;font-size:11px;font-weight:700;border-radius:8px;padding:4px 20px 4px 8px;'+
      'border:1px solid;appearance:auto;-webkit-appearance:auto;outline:none;min-width:80px;';
    var bgMap = {
      'info': 'background:rgba(59,130,246,0.18);color:#60a5fa;border-color:rgba(59,130,246,0.4);',
      'warn': 'background:rgba(245,158,11,0.18);color:#fbbf24;border-color:rgba(245,158,11,0.4);',
      'ok':   'background:rgba(34,197,94,0.18);color:#4ade80;border-color:rgba(34,197,94,0.4);',
      'err':  'background:rgba(239,68,68,0.18);color:#f87171;border-color:rgba(239,68,68,0.4);'
    };
    var statusSel = '<select onchange="quickStatusChange(\''+c.id+'\',this)" '+
      'style="'+selStyle+(bgMap[sc]||bgMap['info'])+'">'+
      statuses.map(function(s){
        return '<option value="'+s+'" '+(c.status===s?'selected':'')+' style="background:#0c1218;color:#e9eef5;">'+s+'</option>';
      }).join('')+
    '</select>';

    // Szakaszok (order_legs)
    // Szakaszok (order_legs) — biztonságos parse
    var legs = [];
    try {
      legs = Array.isArray(c.legs_json) ? c.legs_json :
             (typeof c.legs_json === 'string' && c.legs_json.length > 2 ? JSON.parse(c.legs_json) : []);
    } catch(e) { legs = []; }
    var legCount = legs.length;
    var routeCell = esc(c.loc_incarcare||'—')+' → '+esc(c.loc_descarcare||'—');
    if (legCount > 0) {
      routeCell += '<div style="margin-top:4px;">';
      legs.forEach(function(l){
        if (l.loc_preluare) {
          routeCell += '<div style="font-size:11px;color:var(--muted);padding-left:8px;border-left:2px solid rgba(225,11,26,0.4);margin-top:2px;">↳ '+esc(l.loc_preluare)+'</div>';
        }
      });
      routeCell += '</div>';
    }
    var soferCell = esc(soferInfo);
    if (legCount > 0) {
      soferCell += ' <span style="font-size:10px;background:rgba(225,11,26,0.15);color:#f87171;border:1px solid rgba(225,11,26,0.3);border-radius:6px;padding:1px 6px;white-space:nowrap;">+'+legCount+' váltás</span>';
      soferCell += '<div style="margin-top:4px;">';
      legs.forEach(function(l){
        soferCell += '<div style="font-size:11px;color:var(--muted);margin-top:2px;">↳ '+esc(l.sofer||'—')+(l.rendszam?' <span style="opacity:.6;">'+esc(l.rendszam)+'</span>':'')+'</div>';
      });
      soferCell += '</div>';
    }

    // ── Integrációs gombok (CargoTrack térkép + UIT + Számlázás) ──
    var integBtns = '';
    if (c.rendszam_camion && window.CargoTrackWhereIs) {
      integBtns += '<button class="btn ghost" title="Hol a kocsi? (térkép)" style="padding:4px 10px;font-size:12px;" '+
        'onclick="CargoTrackWhereIs.show(\''+esc(c.rendszam_camion)+'\',\''+c.id+'\')">🗺️</button>';
    }
    if (window.UitPanel) {
      integBtns += '<button class="btn ghost uit-btn" title="UIT-kódok (RO e-Transport)" style="padding:4px 10px;font-size:12px;" '+
        'data-uit-oid="'+c.id+'" onclick="UitPanel.open(\''+c.id+'\',\''+esc(c.rendszam_camion||'')+'\')">'+
        '+UIT<span class="uit-ind" data-uit-ind="'+c.id+'" style="margin-left:3px;"></span></button>';
    }
    if (c.status==='Finalizat' && window.InvoiceModal) {
      integBtns += '<button class="btn primary" title="Számlázás" style="padding:4px 10px;font-size:12px;" '+
        'onclick="InvoiceModal.open(\''+c.id+'\')">🧾</button>';
    }

    return '<tr><td><b>'+c.id+'</b></td><td>'+esc(c.client||'—')+'</td>'+
      '<td>'+routeCell+'</td>'+
      '<td>'+(c.km||'—')+'</td><td>'+(c.pret||'—')+'</td>'+
      '<td>'+soferCell+'</td><td>'+esc(c.rendszam_camion||'—')+'</td>'+
      '<td>'+statusSel+'</td>'+
      '<td style="display:flex;gap:4px;flex-wrap:wrap;">'+
        '<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="openDocModal(\''+c.id+'\')">📎</button>'+
        '<button class="btn primary" style="padding:4px 10px;font-size:12px;" onclick="openOrderEdit(\''+c.id+'\')">✏️</button>'+
        integBtns+
      '</td>'+
      '<td style="text-align:center;vertical-align:middle;">'+
        '<input type="checkbox" class="orderRowCb" value="'+c.id+'" onchange="updateOrderSelBar()" '+
        'style="width:16px;height:16px;cursor:pointer;accent-color:#e10b1a;">'+
      '</td></tr>';
  }).join('');
  updateOrderSelBar();
  decorateUitIndicators(list);
}

// ── UIT-állapot jelzése a fuvar sorában (+UIT gomb melletti szimbólum) ──
function decorateUitIndicators(list){
  if(window.UIT_COMING_SOON) return;
  if(!window.UitPanel) return;
  var ids=(list||[]).map(function(c){return c.id;}).filter(Boolean);
  if(!ids.length) return;
  fetch('/api/uit/summary?order_ids='+encodeURIComponent(ids.join(',')),{credentials:'same-origin'})
    .then(function(r){return r.json();}).then(function(d){
      var sum=(d&&d.summary)||{};
      document.querySelectorAll('[data-uit-ind]').forEach(function(el){
        var s=sum[el.getAttribute('data-uit-ind')];
        if(!s||!s.total){ el.textContent=''; el.title=''; return; }
        var sym = s.error?'❌' : s.active?'✅' : s.new?'⏳' : '⏹️';
        el.textContent=' '+sym+(s.total>1?'×'+s.total:'');
        el.title=s.total+' UIT · aktív:'+s.active+' hiba:'+s.error;
      });
    }).catch(function(){});
}
window.__uitRefresh=function(){ try{ decorateUitIndicators(_ordersAllCache); }catch(e){} };

// ── Kijelölés & letöltés logika ───────────────────────────

function downloadSelectedOrders() {
  var checked = document.querySelectorAll('.orderRowCb:checked');
  if (!checked.length) { toast('Jelölj ki legalább egy fuvart!', 'err'); return; }
  var ids = Array.from(checked).map(function(cb){ return String(cb.value); });
  var selected = _ordersAllCache.filter(function(c){ return ids.indexOf(String(c.id)) !== -1; });
  var now = new Date().toLocaleDateString('hu-HU');

  function parselegs(c) {
    try {
      if (Array.isArray(c.legs_json)) return c.legs_json;
      if (typeof c.legs_json === 'string' && c.legs_json.length > 2) return JSON.parse(c.legs_json);
    } catch(e) {}
    return [];
  }

  var rows = selected.map(function(c){
    var soferInfo = '—';
    if (c.sofer_type === 'Intern') soferInfo = c.nume_sofer || c.email_sofer || '—';
    else if (c.sofer_type === 'Extern') soferInfo = c.nume_sofer || c.firma_extern || '—';
    var legs = parselegs(c);
    var legCount = legs.length;

    var out = '<tr style="background:#fff;">'+
      '<td style="font-weight:bold;vertical-align:top;">'+esc(String(c.id))+'</td>'+
      '<td style="vertical-align:top;">'+esc(c.client||'—')+'</td>'+
      '<td style="vertical-align:top;">'+esc(c.ref||'—')+'</td>'+
      '<td style="vertical-align:top;">'+esc(c.loc_incarcare||'—')+'</td>'+
      '<td style="vertical-align:top;">'+esc(c.loc_descarcare||'—')+'</td>'+
      '<td style="text-align:right;vertical-align:top;">'+esc(String(c.km||'—'))+'</td>'+
      '<td style="text-align:right;vertical-align:top;">'+esc(String(c.pret||'—'))+'</td>'+
      '<td style="vertical-align:top;">'+esc(soferInfo)+
        (legCount > 0 ? ' <b style="color:#c00;font-size:10px;">(+'+legCount+' váltás)</b>' : '')+
      '</td>'+
      '<td style="vertical-align:top;">'+esc(c.rendszam_camion||'—')+(c.rendszam_remorca?' / '+esc(c.rendszam_remorca):'')+'</td>'+
      '<td style="text-align:center;vertical-align:top;font-weight:700;">'+esc(c.status||'—')+'</td>'+
    '</tr>';

    legs.forEach(function(l, idx){
      out += '<tr style="background:#eef3ff;">'+
        '<td style="padding-left:18px;font-size:11px;color:#444;border-left:3px solid #2563eb;">↳ '+(idx+1)+'. váltás</td>'+
        '<td colspan="2" style="font-size:11px;color:#666;font-style:italic;">Sofőrváltás / szakasz</td>'+
        '<td style="font-size:11px;font-weight:700;color:#1a3a6b;">'+esc(l.loc_preluare||'—')+'</td>'+
        '<td style="font-size:11px;color:#aaa;">—</td>'+
        '<td></td><td></td>'+
        '<td style="font-size:11px;font-weight:700;">'+esc(l.sofer||'—')+'</td>'+
        '<td style="font-size:11px;">'+esc(l.rendszam||'—')+'</td>'+
        '<td></td>'+
      '</tr>';
    });

    return out;
  }).join('');

  var hasLegs = selected.some(function(c){ return parselegs(c).length > 0; });

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">'+
    '<title>Fuvarfeladatok — '+now+'</title>'+
    '<style>'+
    'body{font-family:Arial,sans-serif;padding:24px;font-size:13px;color:#000;}'+
    'h1{font-size:18px;text-align:center;margin:0 0 2px;}'+
    '.sub{text-align:center;font-size:12px;color:#555;margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid #000;}'+
    'table{width:100%;border-collapse:collapse;margin-top:8px;}'+
    'th{background:#d0d0d0;border:1px solid #aaa;padding:6px 8px;font-size:11px;text-align:left;white-space:nowrap;}'+
    'td{border:1px solid #ddd;padding:5px 8px;vertical-align:top;}'+
    '.legend{font-size:11px;color:#444;margin-top:10px;padding:7px 12px;background:#eef3ff;border-left:3px solid #2563eb;}'+
    '.footer{font-size:11px;color:#aaa;margin-top:12px;}'+
    '.no-print{margin-bottom:16px;}'+
    '@media print{.no-print{display:none;}body{padding:10px;}}'+
    '</style></head><body>'+
    '<div class="no-print"><button onclick="window.print()" style="padding:10px 24px;background:#0f172a;color:#fff;font-weight:bold;border:none;border-radius:6px;font-size:14px;cursor:pointer;">🖨️ Nyomtatás / PDF mentés</button></div>'+
    '<h1>VALLOR TEAM SRL — Fuvarfeladatok</h1>'+
    '<div class="sub">Nyomtatva: '+now+' &nbsp;·&nbsp; '+selected.length+' fuvar'+(hasLegs?' &nbsp;·&nbsp; <span style="color:#2563eb;font-weight:700;">kék sorok = váltások</span>':'')+'</div>'+
    '<table><thead><tr>'+
    '<th>#ID</th><th>Ügyfél</th><th>Ref</th><th>Felrakás / Átvétel</th><th>Lerakás</th>'+
    '<th>KM</th><th>Ár (EUR)</th><th>Sofőr / Váltó sofőr</th><th>Vontató / Pótkocsi</th><th>Státusz</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table>'+
    (hasLegs ? '<div class="legend">ℹ️ Kék háttérrel: utólag hozzáadott váltások — sofőrcsere, átvételi hely, jármű adatokkal.</div>' : '')+
    '<div class="footer">VallorSoft fuvarmenedzsment · Generálva: '+now+'</div>'+
    '</body></html>';

  var blob = new Blob([html], {type:'text/html;charset=utf-8'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'fuvarok-'+now.replace(/\./g,'-')+'.html';
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1000);
  toast('✅ Letöltve — a váltások kék sorban jelennek meg!', 'ok');
}

// KULSO SOFOROK
let extDriverCache=[];

// GYORS JARMU HOZZAADAS (fuvar formrol)

// JARMUVEK
let vehicleCache=[];

// ALAIRAS
var sigCanvas,sigCtx,isDrawing=false;
function initAdminSigCanvas(){
  sigCanvas=document.getElementById('adminSigCanvas');if(!sigCanvas)return;sigCtx=sigCanvas.getContext('2d');
  // a meretet kis kesleltetessel allitjuk be, hogy a bongeszо mar kirajzolja a panelt
  setTimeout(function(){
    var w=sigCanvas.offsetWidth||sigCanvas.clientWidth||500;
    var h=sigCanvas.offsetHeight||sigCanvas.clientHeight||180;
    sigCanvas.width=w; sigCanvas.height=h;
    sigCtx=sigCanvas.getContext('2d');
    sigCtx.strokeStyle='#000'; sigCtx.lineWidth=3;
  },80);
  function getPos(e){var r=sigCanvas.getBoundingClientRect();return{x:(e.clientX||e.touches[0].clientX)-r.left,y:(e.clientY||e.touches[0].clientY)-r.top};}
  sigCanvas.onmousedown=function(e){isDrawing=true;var p=getPos(e);sigCtx.beginPath();sigCtx.moveTo(p.x,p.y);};
  sigCanvas.onmousemove=function(e){if(!isDrawing)return;e.preventDefault();var p=getPos(e);sigCtx.lineTo(p.x,p.y);sigCtx.stroke();};
  sigCanvas.ontouchstart=function(e){e.preventDefault();isDrawing=true;var p=getPos(e);sigCtx.beginPath();sigCtx.moveTo(p.x,p.y);};
  sigCanvas.ontouchmove=function(e){e.preventDefault();if(!isDrawing)return;var p=getPos(e);sigCtx.lineTo(p.x,p.y);sigCtx.stroke();};
  window.ontouchend=function(){isDrawing=false;};
  window.onmouseup=function(){isDrawing=false;};
  loadAdminSigPreview();
}

gas('authMe').then(u => {
  if (!u || u.pozicio !== 'Manager') { window.location.href = '/login'; return; }
  myEmail = u.email;
  document.getElementById('meBadge').textContent = u.nume;
  initFirebaseChatPanel(u);
  if (window.VS_PUSH) VS_PUSH.init(u.email, u.pozicio);
  var savedTab = '';
  var savedRoom = '';
  try { savedTab = sessionStorage.getItem('vs_manager_tab') || 'dash'; savedRoom = sessionStorage.getItem('vs_manager_chat_room') || ''; } catch(e) {}
  if (savedTab === 'chat' && savedRoom) { window._restoreChatRoom = savedRoom; }
  activateTab(savedTab || 'dash');
});

// ===== MEGRENDELO DOKUMENTUM FUGGVENYEK =====
let currentDocOrderId = null;
let currentDocId      = null;
let signCanvasEl, signCtxEl, isSignDrawing = false;
let savedStampBase64  = null;

// PDF.js / pdf-lib alapu alairo motor allapota
let pdfDocProxy   = null;   // a betoltott PDF (PDF.js objektum)
let pdfRawBytes   = null;   // a PDF eredeti byte-jai (pdf-lib-hez)
let signCurrentPage = 1;    // melyik oldalt nezzuk eppen (1-tol)
let signTotalPages  = 1;
let signRenderScale = 1;    // a kirajzolt canvas / PDF pont aranya
let placedItems   = [];     // a feltett elemek: {pageNum, type, dataUrl, el}

function loadDocList(orderId){
  const wrap = document.getElementById('docListWrap');
  wrap.innerHTML = '<div style="color:var(--muted);font-size:13px;">Betöltés...</div>';
  gas('orderDocList',[orderId]).then(list => {
    if(!list||list.length===0){
      wrap.innerHTML='<div style="color:var(--muted);font-size:13px;">Nincs még feltöltve megrendelő ehhez a fuvarhoz.</div>';
      return;
    }
    wrap.innerHTML='<table class="table"><thead><tr><th>Fájlnév</th><th>Feltöltő</th><th>Dátum</th><th>Státusz</th><th>Műveletek</th></tr></thead><tbody>'
      +list.map(d=>{
  const signedBtn = d.has_signed
    ? '<button class="btn ok" style="padding:4px 10px;font-size:12px;" onclick="downloadDoc('+d.id+',\'signed\')">⬇️ Aláírt</button>'
    : '';
  const statusBadge = d.has_signed
    ? '<span class="badge ok">Aláírt</span>'
    : '<span class="badge warn">Aláíratlan</span>';
  return '<tr>'
    +'<td><b>'+d.file_name+'</b></td>'
    +'<td>'+d.uploaded_by+'</td>'
    +'<td>'+(d.created_at?d.created_at.toString().substring(0,16).replace('T',' '):'—')+'</td>'
    +'<td>'+statusBadge+'</td>'
    +'<td style="display:flex;gap:6px;flex-wrap:wrap;">'
    +'<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="openSignModal('+d.id+',\'original\')">✍️ Szerkeszt</button>'
    +signedBtn
    +'<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="downloadDoc('+d.id+',\'original\')">⬇️ Eredeti</button>'
    +'</td>'
    +'</tr>';
}).join('')
      +'</tbody></table>';
  });
}
function openSignModal(docId,which){
  currentDocId=docId;
  document.getElementById('signModal').classList.add('open');

  // tisztitas
  placedItems.forEach(it=>{ if(it.el) it.el.remove(); });
  placedItems=[];
  pdfDocProxy=null; pdfRawBytes=null; signCurrentPage=1; signTotalPages=1;
  document.getElementById('signPageInfo').textContent='betöltés...';

  // pecset betoltese (mint eddig)
  document.getElementById('signStampImg').style.display='none';
  document.getElementById('signNoStamp').style.display='inline';
  savedStampBase64=null;
  gas('stampGet').then(r=>{
    if(r&&r.ok&&r.base64){
      savedStampBase64=r.base64;
      document.getElementById('signStampImg').src=r.base64;
      document.getElementById('signStampImg').style.display='block';
      document.getElementById('signNoStamp').style.display='none';
    }
  });

  // rajzolo vaszon beallitasa
  setTimeout(()=>{
    signCanvasEl=document.getElementById('signCanvas');
    signCtxEl=signCanvasEl.getContext('2d');

    function resizeSignCanvas(){
      var rect=signCanvasEl.getBoundingClientRect();
      var dpr=window.devicePixelRatio||1;
      var w=Math.round(rect.width||300);
      var h=Math.round(rect.height||140);
      signCanvasEl.width=w*dpr;
      signCanvasEl.height=h*dpr;
      signCtxEl=signCanvasEl.getContext('2d');
      signCtxEl.scale(dpr,dpr);
      signCtxEl.strokeStyle='#000';
      signCtxEl.lineWidth=2.5;
      signCtxEl.lineCap='round';
      signCtxEl.lineJoin='round';
    }
    resizeSignCanvas();

    const getP=function(e){
      var r=signCanvasEl.getBoundingClientRect();
      var src=e.touches?e.touches[0]:e;
      return{x:src.clientX-r.left, y:src.clientY-r.top};
    };
    signCanvasEl.addEventListener('mousedown',function(e){e.preventDefault();isSignDrawing=true;var p=getP(e);signCtxEl.beginPath();signCtxEl.moveTo(p.x,p.y);});
    signCanvasEl.addEventListener('mousemove',function(e){if(!isSignDrawing)return;var p=getP(e);signCtxEl.lineTo(p.x,p.y);signCtxEl.stroke();});
    signCanvasEl.addEventListener('touchstart',function(e){e.preventDefault();isSignDrawing=true;var p=getP(e);signCtxEl.beginPath();signCtxEl.moveTo(p.x,p.y);},{passive:false});
    signCanvasEl.addEventListener('touchmove',function(e){e.preventDefault();if(!isSignDrawing)return;var p=getP(e);signCtxEl.lineTo(p.x,p.y);signCtxEl.stroke();},{passive:false});
    window.addEventListener('mouseup',function(){isSignDrawing=false;});
    window.addEventListener('touchend',function(){isSignDrawing=false;});
  },300);

  // PDF betoltese es kirajzolasa
  gas('orderDocGet',[docId,which]).then(async r=>{
    if(!r.ok||!r.base64){ toast(r.err||'PDF betöltési hiba','err'); return; }
    try{
      // a base64 dataURL-bol nyers byte-ok
      const b64 = r.base64.indexOf(',')>=0 ? r.base64.split(',')[1] : r.base64;
      const bin = atob(b64);
      pdfRawBytes = new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) pdfRawBytes[i]=bin.charCodeAt(i);

      pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      pdfDocProxy = await pdfjsLib.getDocument({data: pdfRawBytes.slice()}).promise;
      signTotalPages = pdfDocProxy.numPages;
      signCurrentPage = 1;
      await renderSignPage(signCurrentPage);
    }catch(err){
      console.error(err);
      toast('Nem sikerült megnyitni a PDF-et','err');
    }
  });
}

async function renderSignPage(num){
  if(!pdfDocProxy) return;
  // a masik oldalon levo elemeket elrejtjuk, az aktualisat mutatjuk
  placedItems.forEach(it=>{ if(it.el) it.el.style.display = (it.pageNum===num?'block':'none'); });

  const page = await pdfDocProxy.getPage(num);
  const stage = document.getElementById('signPdfStage');
  const canvas = document.getElementById('signPdfCanvas');
  const ctx = canvas.getContext('2d');

  // a rendelkezesre allo szelessegre igazitjuk
  const baseViewport = page.getViewport({scale:1});
  const maxW = stage.clientWidth || 560;
  signRenderScale = maxW / baseViewport.width;
  const viewport = page.getViewport({scale: signRenderScale});

  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({canvasContext: ctx, viewport}).promise;

  document.getElementById('signPageInfo').textContent = num + ' / ' + signTotalPages;
}

// egy mozgathato + atmeretezheto elem letrehozasa a PDF folott
function createDraggableItem(dataUrl, type){
  const stage = document.getElementById('signPdfStage');
  const box = document.createElement('div');
  box.style.cssText='position:absolute;left:40px;top:40px;width:160px;border:2px dashed #2d7;'
    +'cursor:move;touch-action:none;background:rgba(255,255,255,0.15);box-sizing:border-box;';
  const img = document.createElement('img');
  img.src=dataUrl;
  img.style.cssText='width:100%;display:block;pointer-events:none;user-select:none;';
  box.appendChild(img);

  // atmeretezo fogantyu a jobb also sarokban
  const handle=document.createElement('div');
  handle.style.cssText='position:absolute;right:-8px;bottom:-8px;width:18px;height:18px;'
    +'background:#2d7;border:2px solid #fff;border-radius:50%;cursor:nwse-resize;touch-action:none;';
  box.appendChild(handle);

  // torlo gomb
  const del=document.createElement('div');
  del.textContent='✕';
  del.style.cssText='position:absolute;right:-8px;top:-12px;width:20px;height:20px;line-height:18px;'
    +'text-align:center;background:#e44;color:#fff;border-radius:50%;cursor:pointer;font-size:12px;';
  box.appendChild(del);

  const item={pageNum:signCurrentPage, type, dataUrl, el:box};
  del.onclick=(e)=>{ e.stopPropagation(); box.remove(); placedItems=placedItems.filter(x=>x!==item); };

  // --- DRAG (mozgatas) ---
  let dragging=false, dragOX=0, dragOY=0;
  const startDrag=(cx,cy)=>{ dragging=true; const r=box.getBoundingClientRect(); dragOX=cx-r.left; dragOY=cy-r.top; };
  const moveDrag=(cx,cy)=>{
    if(!dragging) return;
    const sr=stage.getBoundingClientRect();
    let x=cx-sr.left-dragOX, y=cy-sr.top-dragOY;
    x=Math.max(0,Math.min(x, stage.clientWidth-box.offsetWidth));
    y=Math.max(0,Math.min(y, stage.clientHeight-box.offsetHeight));
    box.style.left=x+'px'; box.style.top=y+'px';
  };
  box.addEventListener('mousedown',e=>{ if(e.target===handle) return; e.preventDefault(); startDrag(e.clientX,e.clientY); });
  box.addEventListener('touchstart',e=>{ if(e.target===handle) return; startDrag(e.touches[0].clientX,e.touches[0].clientY); },{passive:true});
  window.addEventListener('mousemove',e=>moveDrag(e.clientX,e.clientY));
  window.addEventListener('touchmove',e=>{ if(dragging){ e.preventDefault(); moveDrag(e.touches[0].clientX,e.touches[0].clientY);} },{passive:false});
  window.addEventListener('mouseup',()=>dragging=false);
  window.addEventListener('touchend',()=>dragging=false);

  // --- RESIZE (atmeretezes a sarokbol) ---
  let resizing=false, startW=0, startX=0;
  const aspect = ()=> (img.naturalHeight/img.naturalWidth)||0.4;
  handle.addEventListener('mousedown',e=>{ e.stopPropagation(); resizing=true; startW=box.offsetWidth; startX=e.clientX; });
  handle.addEventListener('touchstart',e=>{ e.stopPropagation(); resizing=true; startW=box.offsetWidth; startX=e.touches[0].clientX; },{passive:true});
  const doResize=(cx)=>{ if(!resizing) return; let w=Math.max(40, startW+(cx-startX)); box.style.width=w+'px'; };
  window.addEventListener('mousemove',e=>doResize(e.clientX));
  window.addEventListener('touchmove',e=>{ if(resizing){ e.preventDefault(); doResize(e.touches[0].clientX);} },{passive:false});
  window.addEventListener('mouseup',()=>resizing=false);
  window.addEventListener('touchend',()=>resizing=false);

  stage.appendChild(box);
  placedItems.push(item);
}

function addSignatureToPage(){
  if(!pdfDocProxy){ toast('Előbb töltsd be a PDF-et!','err'); return; }
  // ures-e a rajz?
  const blank=document.createElement('canvas'); blank.width=signCanvasEl.width; blank.height=signCanvasEl.height;
  if(signCanvasEl.toDataURL()===blank.toDataURL()){ toast('Előbb rajzolj aláírást!','err'); return; }
  createDraggableItem(signCanvasEl.toDataURL('image/png'),'sign');
  toast('Aláírás hozzáadva – húzd a helyére','ok');
}

// a feltett elemeket raegeti a PDF-re (pdf-lib) -> uj PDF byte-ok
async function buildSignedPdf(){
  if(placedItems.length===0){ toast('Nincs elhelyezett aláírás vagy pecsét!','err'); return null; }
  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.load(pdfRawBytes.slice());
  const pages = pdfDoc.getPages();
  const stage = document.getElementById('signPdfStage');

  for(const it of placedItems){
    const page = pages[it.pageNum-1];
    if(!page) continue;
    const pw = page.getWidth(), ph = page.getHeight();

    // a doboz pozicioja a stage-hez kepest (kepernyo px)
    const boxLeft = parseFloat(it.el.style.left)||0;
    const boxTop  = parseFloat(it.el.style.top)||0;
    const boxW    = it.el.offsetWidth;
    const boxH    = it.el.offsetHeight;

    // a kirajzolt PDF canvas merete a stage-ben
    const canvas = document.getElementById('signPdfCanvas');
    const cw = canvas.width, ch = canvas.height;

    // kepernyo px -> PDF pont atvaltas (a canvas a stage-ben kozepre van igazitva)
    const offsetX = (stage.clientWidth - cw)/2;
    const relX = boxLeft - offsetX;
    const relY = boxTop;

    const scaleX = pw / cw;
    const scaleY = ph / ch;
    const pdfX = relX * scaleX;
    const pdfW = boxW * scaleX;
    const pdfH = boxH * scaleY;
    // pdf-lib koordinata alulrol felfele megy
    const pdfY = ph - (relY*scaleY) - pdfH;

    const pngBytes = await fetch(it.dataUrl).then(r=>r.arrayBuffer());
    const png = await pdfDoc.embedPng(pngBytes);
    page.drawImage(png, {x:pdfX, y:pdfY, width:pdfW, height:pdfH});
  }

  const out = await pdfDoc.save();
  // base64 dataURL keszitese
  let binary=''; const bytes=new Uint8Array(out);
  const chunk=8192;
  for(let i=0;i<bytes.length;i+=chunk){ binary+=String.fromCharCode.apply(null, bytes.subarray(i,i+chunk)); }
  return 'data:application/pdf;base64,'+btoa(binary);
}

function downloadDoc(docId,which){
  gas('orderDocGet',[docId,which]).then(r=>{
    if(!r.ok||!r.base64){toast(r.err||'Letöltési hiba','err');return;}
    // a tartalom alapjan dontjuk el a kiterjesztest (regi alairtak PNG-k lehetnek)
    let ext='.pdf';
    if(r.base64.indexOf('data:image/png')===0) ext='.png';
    else if(r.base64.indexOf('data:image/jpeg')===0) ext='.jpg';
    else if(r.base64.indexOf('data:application/pdf')===0) ext='.pdf';
    // alapnev a fajlnevbol, kiterjesztes nelkul
    let base=(r.fileName||'dokumentum').replace(/\.[^.]+$/,'');
    const a=document.createElement('a');
    a.href=r.base64;
    a.download=(which==='signed'?'alairt_':'')+base+ext;
    a.click();
  });
}

// ============================================================
// FIREBASE CHAT — Admin/Manager oldal (dm_ privát szobák)
// Room ID: dm_{kisebb_email_escaped}_X_{nagyobb_email_escaped}
// Manager: írhat bármely sofőrnek/adminnak, sofőr visszaírhat
// Admin: mindenkivel írhat
// ============================================================
var _fbDb=null,_chatCompanyId=null,_meChat=null;
var _chatCurrentRoom=null,_chatUnsubscribe=null,_roomsSnapData={};

function chatSend(){
  if(!_fbDb||!_meChat||!_chatCurrentRoom)return;
  var input=document.getElementById('chatInput');
  var text=(input?input.value:'').trim();
  if(!text)return;
  if(input)input.value='';
  _fbDb.ref('chats/'+_chatCompanyId+'/rooms/'+_chatCurrentRoom+'/messages').push({
    fromEmail:_meChat.email||'',
    fromName:_meChat.nume||'Manager',
    fromRole:_meChat.pozicio||'Manager',
    text:text,
    ts:firebase.database.ServerValue.TIMESTAMP
  });
  _fbDb.ref('chats/'+_chatCompanyId+'/rooms/'+_chatCurrentRoom+'/meta').update({
    lastMsg:text.substring(0,80),
    lastTime:firebase.database.ServerValue.TIMESTAMP,
    lastFrom:_meChat.nume
  });
  // Push ertesites
  if(window.VS_PUSH){
    var roomId=_chatCurrentRoom;
    var toEmails=[];
    var toRoles=[];
    if(roomId&&roomId.startsWith('dm_')){
      var inner=roomId.replace('dm_','');
      var parts=inner.split('_X_');
      if(parts.length===2){
        var myEsc=(typeof _meChat!=='undefined'&&_meChat.email||'').toLowerCase().replace(/@/g,'__').replace(/\./g,'_d_');
        var otherEsc=parts[0]===myEsc?parts[1]:parts[0];
        var otherEmail=otherEsc.replace(/__/g,'@').replace(/_d_/g,'.');
        toEmails=[otherEmail];
      }
    } else if(roomId==='manager'){
      toRoles=['Manager','Admin'];
    }
    VS_PUSH.notifyChat({toEmails:toEmails,toRoles:toRoles,fromName:(typeof _meChat!=='undefined'?_meChat.nume:''),text:(typeof text!=='undefined'?text:''),room:roomId,companyId:(typeof _chatCompanyId!=='undefined'?_chatCompanyId:null)});
  }
}

// ============================================================
// FUVAR SZERKESZTŐ MODAL
// ============================================================
var _oeOrderId=null,_oeSoferCache=[],_oeCamionCache=[],_oeRemorcaCache=[];
function openOrderEdit(id){
  _oeOrderId=id;
  document.getElementById('oeModalId').textContent=id;
  Promise.all([gas('userListAll'),gas('vehicleList')]).then(function(results){
    fetch('/api/execute',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({functionName:'getOrderById',arguments:[id]})})
    .then(r=>r.json()).then(function(d){
      var o=d.result; var legs=d.legs||[];
      if(!o){toast('Nem található','err');return;}
      document.getElementById('oeClient').value=o.client||'';
      document.getElementById('oeRef').value=o.ref||'';
      document.getElementById('oeLocInc').value=o.loc_incarcare||'';
      document.getElementById('oeLocDesc').value=o.loc_descarcare||'';
      document.getElementById('oeDataInc').value=o.data_incarcare?o.data_incarcare.split('T')[0]:'';
      document.getElementById('oeDataDesc').value=o.data_descarcare?o.data_descarcare.split('T')[0]:'';
      document.getElementById('oePret').value=o.pret||0;
      document.getElementById('oeKm').value=o.km||0;
      document.getElementById('oeStatus').value=o.status||'Disponibil';
      document.getElementById('oeSoferType').value=o.sofer_type||'';
      _oeSoferCache=results[0].filter(u=>u.pozicio==='Sofer');
      var sel=document.getElementById('oeEmailSofer');
      sel.innerHTML='<option value="">— Válassz —</option>'+_oeSoferCache.map(u=>'<option value="'+u.email+'"'+(u.email===o.email_sofer?' selected':'')+'>'+u.nume+' ('+u.email+')</option>').join('');
      var vehicles=results[1]||[];
      _oeCamionCache=vehicles.filter(v=>v.tip==='Vontato');
      _oeRemorcaCache=vehicles.filter(v=>v.tip==='Potkocsi');
      document.getElementById('oeCamion').innerHTML='<option value="">— Nincs —</option>'+_oeCamionCache.map(v=>'<option value="'+v.rendszam+'"'+(v.rendszam===o.rendszam_camion?' selected':'')+'>'+v.rendszam+(v.marca?' — '+v.marca:'')+'</option>').join('');
      document.getElementById('oeRemorca').innerHTML='<option value="">— Nincs —</option>'+_oeRemorcaCache.map(v=>'<option value="'+v.rendszam+'"'+(v.rendszam===o.rendszam_remorca?' selected':'')+'>'+v.rendszam+(v.marca?' — '+v.marca:'')+'</option>').join('');
      if(o.sofer_type==='Extern'){document.getElementById('oeNumeSoferExtern').value=o.nume_sofer||'';document.getElementById('oeFirmaExtern').value=o.firma_extern||'';}
      oeToggleSoferType();
      renderOeLegs(legs);
      document.getElementById('orderEditModal').classList.add('open');
    });
  });
}
function renderOeLegs(legs){var el=document.getElementById('oeLegsList');if(!legs.length){el.innerHTML='<div style="font-size:12px;color:var(--muted);padding:8px;">Nincs rögzített váltás.</div>';return;}el.innerHTML=legs.map(function(leg){return'<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:13px;display:flex;justify-content:space-between;align-items:center;"><div><b style="color:#fff;">'+leg.leg_number+'. szakasz</b>'+(leg.rendszam_camion?' 🚛 '+leg.rendszam_camion:'')+(leg.rendszam_remorca?' + '+leg.rendszam_remorca:'')+(leg.nume_sofer?' 👤 '+leg.nume_sofer:'')+(leg.loc_preluare?' 📍 '+leg.loc_preluare:'')+'</div><button onclick="deleteLeg('+leg.id+')" style="background:none;border:none;color:var(--err);cursor:pointer;font-size:16px;">✕</button></div>';}).join('');}
function oeAddLeg(){var soferType=document.getElementById('oeSoferType').value;var soferSel=document.getElementById('oeEmailSofer');var selectedUser=_oeSoferCache.find(u=>u.email===soferSel.value);var leg={sofer_type:soferType||null,email_sofer:soferSel.value||null,nume_sofer:selectedUser?selectedUser.nume:(document.getElementById('oeNumeSoferExtern').value||null),firma_extern:document.getElementById('oeFirmaExtern').value||null,rendszam_camion:document.getElementById('oeCamion').value||null,rendszam_remorca:document.getElementById('oeRemorca').value||null,loc_preluare:document.getElementById('oeLocInc').value||null,data_preluare:document.getElementById('oeDataInc').value||null};gas('addOrderLeg',[_oeOrderId,leg]).then(function(r){if(r&&r.ok){toast('Váltás hozzáadva!','ok');fetch('/api/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({functionName:'getOrderById',arguments:[_oeOrderId]})}).then(r=>r.json()).then(d=>renderOeLegs(d.legs||[]));}else{toast(r&&r.err||'Hiba','err');}});}
function saveOrderEdit(){var soferType=document.getElementById('oeSoferType').value;var soferSel=document.getElementById('oeEmailSofer');var selectedUser=_oeSoferCache.find(u=>u.email===soferSel.value);var payload={client:document.getElementById('oeClient').value,ref:document.getElementById('oeRef').value,loc_incarcare:document.getElementById('oeLocInc').value,loc_descarcare:document.getElementById('oeLocDesc').value,data_incarcare:document.getElementById('oeDataInc').value||null,data_descarcare:document.getElementById('oeDataDesc').value||null,pret:document.getElementById('oePret').value,km:document.getElementById('oeKm').value,status:document.getElementById('oeStatus').value,sofer_type:soferType||null,email_sofer:soferType==='Intern'?soferSel.value:null,nume_sofer:soferType==='Intern'?(selectedUser?selectedUser.nume:''):document.getElementById('oeNumeSoferExtern').value,firma_extern:soferType==='Extern'?document.getElementById('oeFirmaExtern').value:null,rendszam_camion:document.getElementById('oeCamion').value||null,rendszam_remorca:document.getElementById('oeRemorca').value||null};gas('comUpdate',[_oeOrderId,payload]).then(function(r){if(r&&r.ok){toast('✅ Mentve!','ok');closeOrderEditModal();loadOrders();}else{toast(r&&r.err||'Szerver hiba','err');}});}

/* ── Mobil sidebar (hamburger) ── */
document.querySelectorAll('.sidebar .tab, .sidebar .sub-tab').forEach(function(el) {
  el.addEventListener('click', function() {
    if (window.innerWidth <= 768 && el.id !== 'userParentTab' && el.id !== 'ordersParentTab') {
      setTimeout(function() { closeSidebar(); }, 120);
    }
  });
});

// ============================================================
// MŰSZAK FLOTTA STATISZTIKA — Manager dashboard
// ============================================================
var _sfWeekOffset = 0;
var _sfData = null;
var _sfPollInterval = null;
var _sfDriverDetailModal = null; // jövőbeli részletes modal
 
function shiftFleetWeek(delta) {
  var nw = _sfWeekOffset + delta;
  if (nw < 0) return;       // jövőbe nem
  if (nw > 52) return;      // 1 év max visszafelé
  _sfWeekOffset = nw;
  loadShiftFleet();
}
 
 
function renderShiftFleet(d) {
  // Hét label
  var lbl = document.getElementById('sfWeekLabel');
  if (lbl) {
    if (_sfWeekOffset === 0) {
      lbl.textContent = 'Aktuális hét';
    } else {
      var ws = new Date(d.week_start);
      var we = new Date(ws); we.setDate(we.getDate() + 6);
      var fmt = function(dt){ return dt.toLocaleDateString('hu-HU', {month:'short', day:'numeric'}); };
      lbl.textContent = fmt(ws) + ' – ' + fmt(we);
    }
  }
  document.getElementById('sfNextWeek').disabled = (_sfWeekOffset === 0);
 
  // ── KPI ───────────────────────────────────────────────────
  var k = d.kpi || {};
  document.getElementById('sfKpiActive').textContent     = k.active_count || 0;
  document.getElementById('sfKpiPaused').textContent     = k.paused_count || 0;
  document.getElementById('sfKpiRest').textContent       = k.rest_count || 0;
  document.getElementById('sfKpiVacation').textContent   = k.vacation_count || 0;
  document.getElementById('sfKpiActiveSub').textContent  = (k.total_drivers || 0) + ' sofőrből';
  document.getElementById('sfKpiRestSub').textContent    = (k.locked_count || 0) + ' zárolt';
 
  // ── Compliance grafikon (bar chart) ───────────────────────
  renderComplianceChart(d.compliance || []);
 
  // ── Pihenő átlagok grafikon (bar chart) ───────────────────
  renderRestChart(d.rest_avg || []);
 
  // ── Flotta státusz tábla ──────────────────────────────────
  renderFleetTable(d.fleet_status || []);
 
  // ── Compliance tábla ──────────────────────────────────────
  renderComplianceTable(d.compliance || []);
 
  // ── Túllépés riasztások ───────────────────────────────────
  renderOvertimeAlerts(d.overtime_alerts || []);
}
 
function renderComplianceChart(comp) {
  var ctx = document.getElementById('sfChartCompliance');
  if (!ctx || typeof Chart === 'undefined') return;
  if (ctx._chart) ctx._chart.destroy();
 
  // Color-kód: piros 80% felett, sárga 60-80%, zöld alatta
  var bgColors = comp.map(function(c){
    var pct = parseFloat(c.weekly_hours) / 90 * 100;
    return pct >= 80 ? 'rgba(239,68,68,0.7)'
         : pct >= 60 ? 'rgba(245,158,11,0.7)'
         : 'rgba(34,197,94,0.7)';
  });
 
  ctx._chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: comp.map(function(c){ return c.nume; }),
      datasets: [{
        label: 'óra',
        data: comp.map(function(c){ return parseFloat(c.weekly_hours) || 0; }),
        backgroundColor: bgColors,
        borderColor: '#1f2937',
        borderWidth: 1
      }]
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false },
                 tooltip: { callbacks: { label: function(c){ return c.parsed.x + ' óra'; } } } },
      scales: {
        x: { ticks: { color: '#8a97a8' },
             title: { display: true, text: 'óra (max 90)', color: '#8a97a8' },
             max: 100 },
        y: { ticks: { color: '#8a97a8' } }
      }
    }
  });
}
 
 
function renderFleetTable(fleet) {
  var tb = document.getElementById('sfFleetTblBody');
  if (!fleet.length) {
    tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px;">Nincs sofőr.</td></tr>';
    return;
  }
  tb.innerHTML = fleet.map(function(f){
    var statusBadge = renderStatusBadge(f.status, f.rest_type);
    var current = f.current_active_hours
      ? parseFloat(f.current_active_hours).toFixed(1) + ' ó'
      : (f.next_shift_start ? '↪ ' + new Date(f.next_shift_start).toLocaleString('hu-HU',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—');
    var weekIdx = f.shift_index_in_week || 0;
    var weekH = parseFloat(f.weekly_hours_total || 0).toFixed(1);
    var note = '';
    if (f.locked_until && new Date(f.locked_until) > new Date()) {
      note = '🔒 zárolva ' + new Date(f.locked_until).toLocaleString('hu-HU',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) + '-ig';
    } else if (f.is_overtime) {
      note = '<span style="color:#ef4444;">⚠️ túlóra</span>';
    } else if (f.status === 'PAUSED' && f.paused_at) {
      var pmin = Math.floor((Date.now() - new Date(f.paused_at).getTime()) / 60000);
      note = '⏰ ' + pmin + ' perce szünetel';
    }
    return '<tr>' +
      '<td><b style="color:#fff;">' + esc(f.nume) + '</b><br><span style="font-size:11px;color:var(--muted);">' + esc(f.email) + '</span></td>' +
      '<td>' + statusBadge + '</td>' +
      '<td>' + current + '</td>' +
      '<td>' + (weekIdx ? weekIdx + '. nap' : '—') + '</td>' +
      '<td>' + weekH + ' ó</td>' +
      '<td style="font-size:12px;">' + note + '</td>' +
    '</tr>';
  }).join('');
}
 
 
 
function renderOvertimeAlerts(alerts) {
  var el = document.getElementById('sfOvertimeList');
  if (!alerts.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:14px;">' +
                   'Nincs túllépés az utolsó 14 napban. ✅</div>';
    return;
  }
  el.innerHTML = alerts.map(function(a){
    var day = new Date(a.day_started_at).toLocaleDateString('hu-HU');
    var reason = a.overtime_reason ? esc(a.overtime_reason) : 'Indok nincs megadva';
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;' +
           'padding:10px 14px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.3);' +
           'border-radius:10px;margin-bottom:6px;flex-wrap:wrap;">' +
             '<div>' +
               '<b style="color:#fff;">' + esc(a.nume) + '</b> · ' +
               '<span style="color:var(--muted);font-size:12px;">' + day + '</span>' +
               '<div style="font-size:11px;color:var(--muted);margin-top:2px;">' + reason + '</div>' +
             '</div>' +
             '<div style="color:#f87171;font-weight:800;font-size:15px;">' + parseFloat(a.active_hours).toFixed(1) + ' ó</div>' +
           '</div>';
  }).join('');
}
 
function sfDriverDrillDown(driverId, nume) {
  // Egyelőre toast — későbbi modal implementáció helye
  // (a /api/shift/stats?driver_id=X&week_offset=Y endpoint kész és működik)
  toast('Részletes nézet (' + nume + ') — fejlesztés alatt.', 'ok');
}
 
// Polling indítás: 30 másodpercenként frissül a flotta státusz amíg az aktuális tab
 
// HTML escape (XSS védelem inline render-eknél)

// ── Diurna statisztika ──────────────────────────────────────
var _diurnaCache = [];

// ── Dokumentum széria konfigurátor ───────────────────────

 
// Polling automatikus indítása page load után
window.addEventListener('load', function(){ sfStartPoll(); });


