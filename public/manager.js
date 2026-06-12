// ============================================================
//  VallorSoft — manager.js  (SZEREP-SPECIFIKUS)
//  Csak a manager-egyedi fuggvenyek (szigorubb jogosultsag!) + init.
//  Kozos fuggvenyek: console-shared.js (elobb toltodik).
// ============================================================

// ── i18n szotar (RO alap / HU) — 'mg.' namespace ──
(window.registerI18n||function(d){(window.__i18nQueue=window.__i18nQueue||[]).push(d);})({
  'mg.bug.min': { hu: 'Írj le legalább 5 karaktert!', ro: 'Scrie cel puțin 5 caractere!' },
  'mg.bug.sending': { hu: 'Küldés...', ro: 'Se trimite...' },
  'mg.bug.submit': { hu: '📤 Küldés', ro: '📤 Trimite' },
  'mg.bug.sent': { hu: 'Hibajelentés elküldve, köszönjük!', ro: 'Raportul a fost trimis, mulțumim!' },
  'mg.err.generic': { hu: 'Hiba történt', ro: 'A apărut o eroare' },
  'mg.err.load': { hu: 'Betöltési hiba', ro: 'Eroare la încărcare' },
  'mg.user.del': { hu: 'Töröl', ro: 'Șterge' },
  'mg.user.edit': { hu: 'Szerk', ro: 'Editează' },
  'mg.user.confirmDel': { hu: 'Biztosan törlöd: {nev} ({email})?\n\nEz a művelet nem visszavonható!', ro: 'Sigur ștergi: {nev} ({email})?\n\nAceastă acțiune este ireversibilă!' },
  'mg.user.driverDeleted': { hu: 'Sofőr törölve!', ro: 'Șofer șters!' },
  'mg.user.saved': { hu: 'Sikeresen mentve!', ro: 'Salvat cu succes!' },
  'mg.doc.loading': { hu: 'Betöltés...', ro: 'Se încarcă...' },
  'mg.doc.empty': { hu: 'Nincs még feltöltve megrendelő ehhez a fuvarhoz.', ro: 'Nu există încă comandă încărcată pentru acest transport.' },
  'mg.doc.th.name': { hu: 'Fájlnév', ro: 'Nume fișier' },
  'mg.doc.th.by': { hu: 'Feltöltő', ro: 'Încărcat de' },
  'mg.doc.th.date': { hu: 'Dátum', ro: 'Dată' },
  'mg.doc.th.status': { hu: 'Státusz', ro: 'Stare' },
  'mg.doc.th.actions': { hu: 'Műveletek', ro: 'Acțiuni' },
  'mg.doc.signed': { hu: 'Aláírt', ro: 'Semnat' },
  'mg.doc.unsigned': { hu: 'Aláíratlan', ro: 'Nesemnat' },
  'mg.doc.btnEdit': { hu: '✍️ Szerkeszt', ro: '✍️ Editează' },
  'mg.doc.btnSigned': { hu: '⬇️ Aláírt', ro: '⬇️ Semnat' },
  'mg.doc.btnOriginal': { hu: '⬇️ Eredeti', ro: '⬇️ Original' }
});

function T(k,v){return (typeof window.t==='function')?window.t(k,v):k;}

const VS_ROLE = 'manager';

/* ── Bug report ── */
function submitBugReport(){
  var txt = document.getElementById('bugText').value.trim();
  if(!txt || txt.length<5){ toast(T('mg.bug.min'),'err'); return; }
  var btn = document.getElementById('bugSubmitBtn');
  btn.disabled=true; btn.textContent=T('mg.bug.sending');
  gas('sendBugReport',[txt,'manager']).then(function(r){
    btn.disabled=false; btn.textContent=T('mg.bug.submit');
    if(r&&r.ok){ toast(T('mg.bug.sent'),'ok'); closeBugReport(); }
    else { toast((r&&r.err)||T('mg.err.generic'),'err'); }
  });
}

document.querySelectorAll('.sidebar .tab, .sidebar .sub-tab').forEach(function(t){
  t.onclick=function(e){
    if(t.id==='userParentTab'){toggleUserMenu();return;}
    if(t.id==='ordersParentTab'){toggleOrdersMenu();return;}
    if(t.id==='statsParentTab'){toggleStatsMenu();return;}
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
    if(name==='external-drivers'){ loadExtDrivers(); if(typeof loadCarriers==='function') loadCarriers(); if(typeof loadCarrierAp==='function') loadCarrierAp(); }
    if(name==='internal-drivers') loadInternalDrivers();
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
        ? `<button class="btn primary" style="padding:4px 10px;font-size:12px;" onclick="editUserIdx(${i})">${T('mg.user.edit')}</button>`
        : '<span style="color:var(--muted);font-size:12px;">—</span>';
      // Torol gomb csak Sofer mellett (sajat magat se torolheti)
      const delBtn = (u.pozicio === 'Sofer' && !isSelf)
        ? ` <button class="btn danger" style="padding:4px 10px;font-size:12px;" onclick="deleteUserIdx(${i})">${T('mg.user.del')}</button>`
        : '';
      return `<tr><td>${esc(u.nume)}</td><td>${esc(u.email)}</td><td>${esc(u.tel||'—')}</td><td><span class="badge info">${u.pozicio}</span></td><td>${editBtn}${delBtn}</td></tr>`;
    }).join('');
  }).catch(function(e){ console.error('loadUsers hiba:', e); toast(T('mg.err.load'),'err'); });
}
// Nyelvvaltaskor a felhasznalo-lista ujrarenderelese (csak ha mar betoltottuk)
if(window.I18N&&window.I18N.onLang) window.I18N.onLang(function(){ if(window._vsUsersCache) loadUsers(); });
// Gyorsítótár-alapú hívók (a felhasználói adat nem kerül HTML-attribútumba)
window.editUserIdx = (i) => editUser(window._vsUsersCache[i]);
window.deleteUserIdx = (i) => { const u = window._vsUsersCache[i]; deleteUser(u.email, u.nume); };

function deleteUser(email, nev){
  if(!confirm(T('mg.user.confirmDel',{nev:nev,email:email})))return;
  gas('userDelete',[email]).then(r=>{
    if(r.ok){
      toast(T('mg.user.driverDeleted'),'ok');
      loadUsers();
      loadDash();
    }else{
      toast(r.err||T('mg.err.generic'),'err');
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
      toast(T('mg.user.saved'), 'ok');
      closeModal();
      loadUsers();
      loadDash();
    } else {
      toast((r && r.err) || T('mg.err.generic'), 'err');
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
  initFirebaseChatPanel(u);
  if (window.VS_PUSH) VS_PUSH.init(u.email, u.pozicio);
  var savedTab = '';
  var savedRoom = '';
  try { savedTab = sessionStorage.getItem('vs_manager_tab') || 'dash'; savedRoom = sessionStorage.getItem('vs_manager_chat_room') || ''; } catch(e) {}
  if (savedTab === 'chat' && savedRoom) { window._restoreChatRoom = savedRoom; }
  activateTab(savedTab || 'dash');
  applyFeatureFlags();
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
  wrap.innerHTML = '<div style="color:var(--muted);font-size:13px;">'+T('mg.doc.loading')+'</div>';
  gas('orderDocList',[orderId]).then(list => {
    if(!list||list.length===0){
      wrap.innerHTML='<div style="color:var(--muted);font-size:13px;">'+T('mg.doc.empty')+'</div>';
      return;
    }
    wrap.innerHTML='<table class="table"><thead><tr><th>'+T('mg.doc.th.name')+'</th><th>'+T('mg.doc.th.by')+'</th><th>'+T('mg.doc.th.date')+'</th><th>'+T('mg.doc.th.status')+'</th><th>'+T('mg.doc.th.actions')+'</th></tr></thead><tbody>'
      +list.map(d=>{
  const signedBtn = d.has_signed
    ? '<button class="btn ok" style="padding:4px 10px;font-size:12px;" onclick="downloadDoc('+d.id+',\'signed\')">'+T('mg.doc.btnSigned')+'</button>'
    : '';
  const statusBadge = d.has_signed
    ? '<span class="badge ok">'+T('mg.doc.signed')+'</span>'
    : '<span class="badge warn">'+T('mg.doc.unsigned')+'</span>';
  return '<tr>'
    +'<td><b>'+d.file_name+'</b></td>'
    +'<td>'+d.uploaded_by+'</td>'
    +'<td>'+(d.created_at?d.created_at.toString().substring(0,16).replace('T',' '):'—')+'</td>'
    +'<td>'+statusBadge+'</td>'
    +'<td style="display:flex;gap:6px;flex-wrap:wrap;">'
    +'<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="openSignModal('+d.id+',\'original\')">'+T('mg.doc.btnEdit')+'</button>'
    +signedBtn
    +'<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="downloadDoc('+d.id+',\'original\')">'+T('mg.doc.btnOriginal')+'</button>'
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
    if (window.innerWidth <= 768 && el.id !== 'userParentTab' && el.id !== 'ordersParentTab' && el.id !== 'statsParentTab') {
      setTimeout(function() { closeSidebar(); }, 120);
    }
  });
});

 
// Polling indítás: 30 másodpercenként frissül a flotta státusz amíg az aktuális tab
 
// HTML escape (XSS védelem inline render-eknél)


// ── Dokumentum széria konfigurátor ───────────────────────

 


