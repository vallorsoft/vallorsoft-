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
    if(t.classList.contains('nav-head')){ if(typeof toggleGroup==='function') toggleGroup(t); return; }
    if(!t.dataset.tab) return;
    activateTab(t.dataset.tab);
  };
});

function loadTab(name){
    if(name==='dash') loadDash();
    if(name==='ops-center'){ if(typeof loadOpsCenter==='function') loadOpsCenter(); }
    if(name==='orders-form'){loadOrderFormData(); mountClientPicker();}
  if(name==='orders-list'){loadOrders();}
  if(name==='orders-deleted'){ if(typeof loadDeletedOrders==='function') loadDeletedOrders(); }
  if(name==='inbound' && window.InboundOrders) InboundOrders.mount('inboundBox');
  if(name==='client-requests' && window.ClientRequests) ClientRequests.mount('clientReqBox');
    if(name==='received-fuv'){loadReceivedFuvarlevelek();loadDocSeries();loadBonScanCard();}
    if(name==='driver-docs-pane') loadDriverUploadedDocs();
    if(name==='ecmr' && window.ECmr) ECmr.mount('ecmrBox');
    if(name==='quotes' && window.Quotes) Quotes.mount('quotesBox');
    if(name==='fav-locations' && window.FavLocations) FavLocations.mount('favLocBox');
      if(name==='users') loadUsers();
    if(name==='invites') loadInvites();
    if(name==='vehicles') loadVehicles();
    if(name==='external-drivers'){ loadExtDrivers(); if(typeof loadCarriers==='function') loadCarriers(); }
    if(name==='invoices-out'){ if(typeof loadInvoicesOut==='function') loadInvoicesOut(); }
    if(name==='invoices-in'){ if(typeof loadCarrierAp==='function') loadCarrierAp(); }
    if(name==='payment-schedule'){ if(typeof loadPaymentSchedule==='function') loadPaymentSchedule(); }
    if(name==='bnr-rate'){ if(typeof loadBnrRate==='function') loadBnrRate(); }
    if(name==='notifications'){ if(window.Notifications) Notifications.loadPage(); }
    if(name==='mail-log'){ if(typeof loadMailLog==='function') loadMailLog(); }
    if(name==='email-templates' && window.EmailTemplates) EmailTemplates.mount('emailTemplatesBox');
    if(name==='orders-done'){ if(typeof loadOrdersDone==='function') loadOrdersDone(); }
    if(name==='active-fleet'){ if(typeof loadActiveFleet==='function') loadActiveFleet(); }
    if(name==='internal-drivers') loadInternalDrivers();
    if(name==='company-settings' && window.CompanySettings) CompanySettings.mount('companySettingsBox');
    if(name==='pdf-settings' && window.PdfSettings) PdfSettings.mount('pdfSettingsBox');
    if(name==='chat'){ if(typeof loadWhatsappChatPane==='function') loadWhatsappChatPane(); }
    if(name==='signature') initAdminSigCanvas();
  if(name==='clients' && window.ClientsPage){ ClientsPage.mount('clientsBox'); if(typeof loadClientPortalAccess==='function') loadClientPortalAccess(); }
  if(name && name.indexOf('stats-')===0 && window.VS_STATS) VS_STATS.load(name);
  if(['expiries','service-log','decont','fuel-import'].indexOf(name)!==-1 && window.FleetExtra) FleetExtra.load(name);
  if(name==='orders-planner' && window.Planner) Planner.load();
  if(name==='warehouse') loadWarehouseTab();
  if(name==='billing'){
    if(window.EmailIntakeCard) EmailIntakeCard.mount('emailIntakeCardBox', {readOnly:true});
  }
  }

// Ügyfélválasztó a fuvarűrlapon (egyszer mountoljuk; a kiválasztott nevet a meglévő
// szöveges Ügyfél mezőbe is bemásolja, így a fuvar-mentés változatlanul működik).
var _clientPickerMounted=false;
/* ─── BEÁLLÍTÁSOK PANE ─── */
// ── 2FA Settings bekapcsolás ──────────────────────────────

// A vezérlőpult-renderelés a console-shared.js loadDashboard()-jában él (közös admin/manager).
let myEmail = '';  // sajat email a connection-bol

function loadUsers(){
  gas('userListAll').then(list => {
    // XSS-védelem: a sor-adatot gyorsítótárból (index alapján) adjuk át, NEM HTML-attribútumba ágyazva
    window._vsUsersCache = list;
    document.querySelector('#tblUsers tbody').innerHTML = list.map((u, i) => {
      const isSelf = u.email.toLowerCase() === myEmail.toLowerCase();
      // Manager csak Sofer mellett, vagy sajat magat szerkesztheti; Admint NEM
      const canEdit = u.pozicio !== 'Admin' || isSelf;
      const editBtn = canEdit
        ? `<button class="btn primary" style="padding:4px 10px;font-size:12px;" onclick="editUserIdx(${i})">Szerk</button>`
        : '<span style="color:var(--muted);font-size:12px;">—</span>';
      // Torol gomb csak Sofer mellett (sajat magat se torolheti)
      const delBtn = (u.pozicio === 'Sofer' && !isSelf)
        ? ` <button class="btn danger" style="padding:4px 10px;font-size:12px;" onclick="deleteUserIdx(${i})">Töröl</button>`
        : '';
      return `<tr><td>${vsAvatar(u.nume||'')}${esc(u.nume)}</td><td>${esc(u.email)}</td><td>${esc(u.tel||'—')}</td><td><span class="vs-cellpill">${esc(u.pozicio||'')}</span></td><td>${editBtn}${delBtn}</td></tr>`;
    }).join('');
  }).catch(function(e){ console.error('loadUsers hiba:', e); toast('Betöltési hiba','err'); });
}
// Gyorsítótár-alapú hívók (a felhasználói adat nem kerül HTML-attribútumba)
window.editUserIdx = (i) => editUser(window._vsUsersCache[i]);
window.deleteUserIdx = (i) => { const u = window._vsUsersCache[i]; deleteUser(u.email, u.nume); };

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
  if (document.getElementById('uPwd2')) document.getElementById('uPwd2').value = '';

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
    var p2m = (document.getElementById('uPwd2') || {}).value;
    if (uPwd.value !== p2m) { toast('Cele două parole nu coincid.', 'err'); return; }
    if (!vsPwValid(uPwd.value)) { toast(VS_PW_ERR, 'err'); return; }
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
// ── Számla-állapot jelzése a fuvar sorában (🧾 gomb melletti szimbólum) ──
window.__invoiceRefresh=function(){ try{ decorateInvoiceIndicators(_ordersAllCache); }catch(e){} };

// ── UIT-állapot jelzése a fuvar sorában (+UIT gomb melletti szimbólum) ──
window.__uitRefresh=function(){ try{ decorateUitIndicators(_ordersAllCache); }catch(e){} };

// ── Kijelölés & letöltés logika ───────────────────────────

// KULSO SOFOROK
let extDriverCache=[];

// GYORS JARMU HOZZAADAS (fuvar formrol)

// JARMUVEK
let vehicleCache=[];

// ALAIRAS
var sigCanvas,sigCtx,isDrawing=false;
gas('authMe').then(u => {
  if (!u || u.pozicio !== 'Manager') { window.location.href = '/login'; return; }
  myEmail = u.email;
  document.getElementById('meBadge').textContent = u.nume;
  // Chat ideiglenesen: WhatsApp-átirányítás — Firebase-panel kikapcsolva.
  // A régi initFirebaseChatPanel a console-shared.js-ben érintetlen; a
  // chat fülön a loadTab betölti a WhatsApp UI-t (loadWhatsappChatPane).
  if (window.VS_PUSH) VS_PUSH.init(u.email, u.pozicio);
  var savedTab = '';
  var savedRoom = '';
  try { savedTab = sessionStorage.getItem('vs_manager_tab') || 'dash'; savedRoom = sessionStorage.getItem('vs_manager_chat_room') || ''; } catch(e) {}
  if (savedTab === 'chat' && savedRoom) { window._restoreChatRoom = savedRoom; }
  activateTab(savedTab || 'dash');
  applyFeatureFlags();
  if(typeof startInboundWatcher==='function') startInboundWatcher();  // lebegő fuvarkérés-figyelő
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
// egy mozgathato + atmeretezheto elem letrehozasa a PDF folott
// a feltett elemeket raegeti a PDF-re (pdf-lib) -> uj PDF byte-ok
// ============================================================
// FIREBASE CHAT — Admin/Manager oldal (dm_ privát szobák)
// Room ID: dm_{kisebb_email_escaped}_X_{nagyobb_email_escaped}
// Manager: írhat bármely sofőrnek/adminnak, sofőr visszaírhat
// Admin: mindenkivel írhat
// ============================================================
var _fbDb=null,_chatCompanyId=null,_meChat=null;
var _chatCurrentRoom=null,_chatUnsubscribe=null,_roomsSnapData={};

// ============================================================
// FUVAR SZERKESZTŐ MODAL
// ============================================================
var _oeOrderId=null,_oeSoferCache=[],_oeCamionCache=[],_oeRemorcaCache=[];
/* ── Mobil sidebar (hamburger) ── */
document.querySelectorAll('.sidebar .tab, .sidebar .sub-tab').forEach(function(el) {
  el.addEventListener('click', function() {
    if (window.innerWidth <= 768 && !el.classList.contains('nav-head')) {
      setTimeout(function() { closeSidebar(); }, 120);
    }
  });
});

 
// Polling indítás: 30 másodpercenként frissül a flotta státusz amíg az aktuális tab
 
// HTML escape (XSS védelem inline render-eknél)


// ── Dokumentum széria konfigurátor ───────────────────────

 


