// ============================================================
//  VallorSoft — admin.js  (SZEREP-SPECIFIKUS)
//  Csak az admin-egyedi fuggvenyek + oldal-init.
//  Kozos fuggvenyek: console-shared.js (elobb toltodik).
// ============================================================
const VS_ROLE = 'admin';

/* ── Bug report ── */
function submitBugReport(){
  var txt = document.getElementById('bugText').value.trim();
  if(!txt || txt.length<5){ toast('Írj le legalább 5 karaktert!','err'); return; }
  var btn = document.getElementById('bugSubmitBtn');
  btn.disabled=true; btn.textContent='Küldés...';
  gas('sendBugReport',[txt,'admin']).then(function(r){
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
  if(name==='received-fuv'){loadReceivedFuvarlevelek();loadDocSeries();}
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
  if(name==='chat'){ if(typeof loadWhatsappChatPane==='function') loadWhatsappChatPane(); }
  if(name==='signature') initAdminSigCanvas();
  if(name==='settings') loadSettingsPane();
  if(name==='company-settings' && window.CompanySettings) CompanySettings.mount('companySettingsBox');
  if(name==='pdf-settings' && window.PdfSettings) PdfSettings.mount('pdfSettingsBox');
  if(name==='elofizetesek') loadElofizetesek();
  if(name==='internal-drivers') loadInternalDrivers();
  if(name==='clients' && window.ClientsPage){ ClientsPage.mount('clientsBox'); if(typeof loadClientPortalAccess==='function') loadClientPortalAccess(); }
  if(name && name.indexOf('stats-')===0 && window.VS_STATS) VS_STATS.load(name);
  if(['expiries','service-log','decont','fuel-import'].indexOf(name)!==-1 && window.FleetExtra) FleetExtra.load(name);
  if(name==='orders-planner' && window.Planner) Planner.load();
  if(name==='warehouse') loadWarehouseTab();
  if(name==='integrations'){
    if(typeof loadGdpr==='function') loadGdpr();
    if(window.EmailSenderCard)  EmailSenderCard.mount('emailSenderCardBox');
    if(window.EmailIntakeCard)  EmailIntakeCard.mount('emailIntakeCardBox', {readOnly:false});
    if(window.BillingCard)      BillingCard.mount('billingCardBox');
    if(window.CargoTrackCard)   CargoTrackCard.mount('ctCardBox');
    if(window.CargoTrackPairing) CargoTrackPairing.mount('ctPairBox');
  }
}

// Ügyfélválasztó a fuvarűrlapon (egyszer mountoljuk; a kiválasztott nevet a meglévő
// szöveges Ügyfél mezőbe is bemásolja, így a fuvar-mentés változatlanul működik).
var _clientPickerMounted=false;
/* ─── BEÁLLÍTÁSOK PANE ─── */
// ── 2FA Settings bekapcsolás ──────────────────────────────

// A vezérlőpult-renderelés a console-shared.js loadDashboard()-jában él (közös admin/manager).
function loadUsers(){
  gas('userListAll').then(list=>{
    // XSS-védelem: a sor-adatot gyorsítótárból (index alapján) adjuk át, NEM HTML-attribútumba ágyazva
    window._vsUsersCache = list;
    document.querySelector('#tblUsers tbody').innerHTML=list.map((u,i)=>{
      const isSelf = u.email.toLowerCase() === myEmail.toLowerCase();
      const canDel = !isSelf && u.pozicio !== 'Admin';
      const delBtn = canDel ? `<button class="btn danger" style="padding:4px 10px;font-size:12px;" onclick="deleteUserIdx(${i})">Töröl</button>` : '';
      const anonBtn = (!isSelf && !u.pozicio_dev) ? ` <button class="btn ghost" style="padding:4px 10px;font-size:12px;" title="${t('cs.gdpr.anonymize')}" onclick="anonymizeUserIdx(${i})">🔐</button>` : '';
      return `<tr><td>${vsAvatar(u.nume||'')}${esc(u.nume)}</td><td>${esc(u.email)}</td><td>${esc(u.tel||'—')}</td><td><span class="vs-cellpill">${esc(u.pozicio||'')}</span></td><td><button class="btn primary" style="padding:4px 10px;font-size:12px;" onclick="editUserIdx(${i})">Szerk</button> ${delBtn}${anonBtn}</td></tr>`;
    }).join('');
  }).catch(function(e){ console.error('loadUsers hiba:', e); toast('Betöltési hiba','err'); });
}
// Gyorsítótár-alapú hívók (a felhasználói adat nem kerül HTML-attribútumba)
window.editUserIdx = (i) => editUser(window._vsUsersCache[i]);
window.deleteUserIdx = (i) => { const u = window._vsUsersCache[i]; deleteUser(u.email, u.nume); };
window.anonymizeUserIdx = (i) => {
  const u = window._vsUsersCache[i];
  if (!u || !u.id) { toast(t('common.error'),'err'); return; }
  if (!confirm(t('cs.gdpr.anonConfirm'))) return;
  gas('anonymizeUser',[u.id]).then(r=>{ if(r&&r.ok){ toast(t('common.savedOk'),'ok'); loadUsers(); } else toast((r&&r.err)||t('common.error'),'err'); });
};

function deleteUser(email, nev){
  if(!confirm('Biztosan törlöd: '+nev+' ('+email+')?\n\nEz a művelet nem visszavonható!'))return;
  gas('userDelete',[email]).then(r=>{
    if(r.ok){
      toast('Felhasználó törölve!','ok');
      loadUsers();
      loadDash();
    }else{
      toast(r.err||'Hiba történt','err');
    }
  });
}
function editUser(u){uNume.value=u.nume;uEmail.value=u.email;uTel.value=u.tel||'';uPoz.value=u.pozicio;uPwd.value='';if(document.getElementById('uPwd2'))document.getElementById('uPwd2').value='';document.getElementById('userModal').classList.add('open');}
function saveUser(){
  var f={nume:uNume.value,tel:uTel.value,pozicio:uPoz.value};
  if(uPwd.value){
    var p2=(document.getElementById('uPwd2')||{}).value;
    if(uPwd.value!==p2){toast('Cele două parole nu coincid.','err');return;}
    if(!vsPwValid(uPwd.value)){toast(VS_PW_ERR,'err');return;}
    f.jelszo=uPwd.value;
  }
  gas('userUpdate',[uEmail.value,f]).then(()=>{toast('Sikeresen mentve!','ok');closeModal();loadUsers();loadDash();});
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
// 1 kérés a látható fuvarokra; a domináns státusz szimbóluma kerül a gombra.
// A modal bezárása után frissítsük a jelzéseket.
window.__uitRefresh=function(){ try{ decorateUitIndicators(_ordersAllCache); }catch(e){} };

// ── Kijelölés & letöltés logika ───────────────────────────

// KULSO SOFOROK
let extDriverCache=[];

// GYORS JARMU HOZZAADAS (fuvar formrol)

// JARMUVEK
let vehicleCache=[];

// ALAIRAS
var sigCanvas,sigCtx,isDrawing=false;
let myEmail = '';
gas('authMe').then(u=>{
  if(!u||u.pozicio!=='Admin'){window.location.href='/login';return;}
  document.getElementById('meBadge').textContent=u.nume;
  myEmail=u.email;
  // Chat ideiglenesen: WhatsApp-átirányítás — Firebase-panel kikapcsolva.
  // A régi initFirebaseChatPanel a console-shared.js-ben érintetlen; a
  // chat fülön a loadTab betölti a WhatsApp UI-t (loadWhatsappChatPane).
  // Push ertesitesek inicializalasa
  if(window.VS_PUSH) VS_PUSH.init(u.email, u.pozicio);
  var savedTab='';
  var savedRoom='';
  try{savedTab=sessionStorage.getItem('vs_admin_tab')||'dash';savedRoom=sessionStorage.getItem('vs_admin_chat_room')||'';}catch(e){}
  if(savedTab==='chat'&&savedRoom){window._restoreChatRoom=savedRoom;}
  activateTab(savedTab||'dash');
  applyFeatureFlags();
  if(typeof startInboundWatcher==='function') startInboundWatcher();  // lebegő fuvarkérés-figyelő
});
let currentDocOrderId = null;
let currentDocId      = null;
let signCanvasEl, signCtxEl, isSignDrawing = false;
let savedStampBase64  = null;

// PDF.js / pdf-lib alapu alairo motor allapota
let pdfDocProxy   = null;
let pdfRawBytes   = null;
let signCurrentPage = 1;
let signTotalPages  = 1;
let signRenderScale = 1;
let placedItems   = [];

function loadDocList(orderId){
  const wrap = document.getElementById('docListWrap');
  wrap.innerHTML = '<div style="color:var(--muted);font-size:13px;">Betöltés...</div>';
  gas('orderDocList',[orderId]).then(list => {
    if(!list||list.length===0){
      wrap.innerHTML='<div style="color:var(--muted);font-size:13px;">Nincs még feltöltve megrendelő ehhez a fuvarhoz.</div>';
      return;
    }
    wrap.innerHTML='<table class="table"><thead><tr><th>Fájlnév</th><th>Feltöltő</th><th>Dátum</th><th>Státusz</th><th>Műveletek</th></tr></thead><tbody>'
      +list.map(d=>`<tr>
        <td><b>${d.file_name}</b></td>
        <td>${d.uploaded_by}</td>
        <td>${d.created_at?d.created_at.toString().substring(0,16).replace('T',' '):'—'}</td>
        <td>${d.has_signed?'<span class="badge ok">Aláírt</span>':'<span class="badge warn">Aláíratlan</span>'}</td>
        <td style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="openSignModal(${d.id},'original')">✍️ Szerkeszt</button>
          ${d.has_signed?`<button class="btn ok" style="padding:4px 10px;font-size:12px;" onclick="downloadDoc(${d.id},'signed')">⬇️ Aláírt</button>`:''}
          <button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="downloadDoc(${d.id},'original')">⬇️ Eredeti</button>
        </td>
      </tr>`).join('')
      +'</tbody></table>';
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

// ============================================================
// FUVAR SZERKESZTŐ MODAL
// ============================================================
var _oeOrderId = null;
var _oeSoferCache = [], _oeCamionCache = [], _oeRemorcaCache = [];

/* ── Mobil sidebar (hamburger) ── */
// Tab és sub-tab kattintasra mobilon bezarul a sidebar
// (userParentTab NEM zarodik, csak toggelja a submenüt)
document.querySelectorAll('.sidebar .tab, .sidebar .sub-tab').forEach(function(el) {
  el.addEventListener('click', function() {
    if (window.innerWidth <= 768 && !el.classList.contains('nav-head')) {
      setTimeout(function() { closeSidebar(); }, 120);
    }
  });
});

 
 


// ── Dokumentum széria konfigurátor ───────────────────────

 


