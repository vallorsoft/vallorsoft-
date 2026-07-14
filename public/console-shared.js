// ============================================================
//  VallorSoft — console-shared.js  (OLDAL ALAP)
//  Az admin és manager konzol KÖZÖS, logikailag azonos fuggvenyei.
//  96 fuggveny — itt EGYSZER kell javitani.
//  Betoltes a HTML-ben: ELOBB ez, UTANA admin.js / manager.js.
// ============================================================

// ── Jelszó-szabály (közös, a szerverrel azonos) — min. 8 + kis/nagybetű + szám + szimbólum ──
// Csak románul írja ki a követelményt (a felhasználó-felé menő szöveg románul).
var VS_PW_ERR = 'Parola trebuie să aibă minim 8 caractere și să conțină o literă mică, o literă mare, o cifră și un simbol (ex. _).';
function vsPwValid(pw){
  pw = String(pw || '');
  return pw.length >= 8 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}

// ── Sofőr-mód (egyszerűsített diszpécser nézet) állapota ──
// Kliens-oldali, localStorage-ban tárolt kapcsoló: bekapcsolva CSAK a sofőrrel
// való kapcsolattartás menüpontjai látszanak (fuvar-kiírás/kezelés, tervezőtábla,
// menetlevelek/iratok, belső sofőrök, chat + Beállítások). Nem érinti a szerver-
// adatokat vagy a jogosultságokat — csak a menüt szűri meg vizuálisan.
try{ window._vsDriverMode = (localStorage.getItem('vs-driver-mode')==='1'); }catch(e){ window._vsDriverMode=false; }
// A sofőr-módban látható menüpontok (data-tab kulcsok). A Beállítások mindig elérhető.
var VS_DRIVER_MODE_TABS = ['dash','orders-form','orders-list','orders-planner',
  'received-fuv','driver-docs-pane','internal-drivers','chat','settings'];
function vsDriverModeOn(){ return window._vsDriverMode===true; }

// Egy menü-levél (tab / sub-tab / link) data-tab kulcsa; az útvonaltervező <a>-nak nincs.
function _vsTabKey(el){
  var k = el.getAttribute('data-tab');
  if(k) return k;
  if(el.tagName==='A' && /\/utvonaltervezes/.test(el.getAttribute('href')||'')) return 'utvonaltervezes';
  return null;
}

// A sidebar láthatóságának EGYSÉGES újraszámítása: csomag-kapcsoló (getMyFeatures)
// + sofőr-mód szűrő egyben. Ez az egyetlen forrás — így a két szűrő nem üti egymást.
function vsRecomputeSidebar(){
  var feats = window._vsFeatures || {};
  var dm = vsDriverModeOn();
  var coreKeys = {};
  (window.VS_FEATURES||[]).forEach(function(f){ if(f.core) coreKeys[f.key]=1; });
  // Minden menü-levél láthatóságának újraszámítása
  document.querySelectorAll('.sidebar .tab[data-tab], .sidebar .sub-tab, .sidebar a.tab-link').forEach(function(el){
    if(el.classList.contains('nav-head')) return;   // a szülő-fejlécet külön kezeljük
    var key = _vsTabKey(el);
    if(!key) return;
    var hidden = false;
    if(!coreKeys[key] && feats[key]===false) hidden = true;         // csomag-kapcsoló
    if(dm && VS_DRIVER_MODE_TABS.indexOf(key)===-1) hidden = true;  // sofőr-mód szűrő
    el.style.display = hidden ? 'none' : '';
  });
  // Üres almenük + szülő-fülek elrejtése; visszaállítás, ha (újra) van látható elem
  document.querySelectorAll('.sidebar .menu-group').forEach(function(grp){
    var sub=grp.querySelector('.submenu');
    if(!sub) return;
    var parent=grp.querySelector('.tab[id$="ParentTab"]');
    var vis=Array.prototype.filter.call(sub.querySelectorAll('.sub-tab, a.tab-link'),function(s){return s.style.display!=='none';});
    if(!vis.length){ if(parent) parent.style.display='none'; sub.style.display='none'; }
    else { if(parent) parent.style.display=''; sub.style.display=''; }
  });
  // Ha az aktív fül időközben rejtett lett -> ugrás egy elérhető fülre
  var active=document.querySelector('.sidebar .tab.active, .sidebar .sub-tab.active');
  if(active && active.style.display==='none'){ activateTab(dm ? 'orders-list' : 'dash'); }
}

// A felső sávi kapcsoló-gomb kinézetének szinkronizálása az állapottal.
function vsSyncDriverModeUI(){
  var on=vsDriverModeOn();
  // A body.vs-dm osztály kapcsolja be a sofőr-mód mobil-optimalizált,
  // nagyobb/áttekinthetőbb stílusát (style.css, csak erre az osztályra szűrve).
  if(document.body) document.body.classList.toggle('vs-dm', on);
  var btn=document.getElementById('driverModeToggle');
  if(!btn) return;
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', on?'true':'false');
  var lbl = (typeof t==='function')
    ? (on ? t('dm.exit') : t('dm.enter'))
    : (on ? 'Teljes nézet' : 'Sofőr mód');
  btn.title = lbl;
}

// Gombnyomásra váltás a sofőr-mód és a teljes nézet között.
function toggleDriverMode(){
  window._vsDriverMode = !vsDriverModeOn();
  try{ localStorage.setItem('vs-driver-mode', window._vsDriverMode ? '1':'0'); }catch(e){}
  // A menü-drawer állapotát visszaállítjuk (sofőr-módban a sidebar hamburger mögé kerül)
  if(typeof closeSidebar==='function') closeSidebar();
  vsSyncDriverModeUI();
  vsRecomputeSidebar();
  // Sofőr-módba lépéskor a fuvar-kezelésre ugrunk (a diszpécser fő munkaterülete)
  if(window._vsDriverMode) activateTab('orders-list');
}

// ── Funkció-kapcsolók (előfizetés) — letiltott menük elrejtése ──
// A cég kikapcsolt funkciói nem jelennek meg a sidebarban. Hiányzó kulcs = engedélyezett.
function applyFeatureFlags(){
  if(!window.gas) return;
  gas('getMyFeatures').then(function(r){
    if(r&&r.ok){
      var feats = r.features||{};
      window._vsFeatures = feats;   // nem-menü funkciók (pl. tracking gomb) ellenőrzéséhez
      if(typeof initOrderMapFeature==='function') initOrderMapFeature();   // térképes km/előnézet (opt-in)
      // Fuvar CSV-import gomb elrejtése, ha a developer kikapcsolta (alapból be)
      var _impBtn=document.getElementById('ordersImportBtnBox');
      if(_impBtn) _impBtn.style.display = (feats['orders-import']===false) ? 'none' : '';
    }
    // A sidebar láthatóság (csomag-kapcsoló + sofőr-mód) egy közös számításból —
    // akkor is lefut (sofőr-mód szűrő), ha a funkció-lekérés hibázott.
    vsRecomputeSidebar();
    vsSyncDriverModeUI();
  }).catch(function(){ vsRecomputeSidebar(); vsSyncDriverModeUI(); });
}

function activateTab(name){
  document.querySelectorAll('.sidebar .tab, .sidebar .sub-tab').forEach(function(x){x.classList.remove('active');});
  var tabEl=document.querySelector('.sidebar [data-tab="'+name+'"]');
  if(tabEl){
    tabEl.classList.add('active');
    var sub=tabEl.closest?tabEl.closest('.submenu'):null;
    if(sub){var grp=sub.closest?sub.closest('.menu-group'):null;if(grp){
      // Single-open accordion: a cél csoport kinyitása előtt a többi nyitott csoport becsukása
      document.querySelectorAll('.sidebar .menu-group.open').forEach(function(o){ if(o!==grp) o.classList.remove('open'); });
      grp.classList.add('open');
    }}
  }
  document.querySelectorAll('.pane').forEach(function(p){p.classList.add('hidden');});
  var pane=document.querySelector('.pane[data-pane="'+name+'"]');
  if(pane)pane.classList.remove('hidden');
  try{sessionStorage.setItem('vs_admin_tab',name);}catch(e){}
  // Fix felső sáv breadcrumb frissítése az aktív menüpont címkéjével
  try{
    var bc=document.getElementById('vsBreadCurrent');
    if(bc && tabEl){ var sp=tabEl.querySelector('span'); bc.textContent=(sp?sp.textContent:tabEl.textContent||'').trim(); }
  }catch(e){}
  loadTab(name);
  // Mobilon a menüpontra koppintás után zárjuk be a drawert, hogy látszódjon a tartalom
  if(window.innerWidth<=768 && typeof closeSidebar==='function') closeSidebar();
}

// Nyelvváltáskor: a JS-ből generált (nem data-i18n) tartalom nem frissül magától,
// ezért az aktívan látszó fül betöltőjét újrafuttatjuk az új nyelven.
// (A statikus data-i18n elemeket az I18N motor már frissítette.)
window.onLangChange = function(){
  try {
    var active = document.querySelector('.pane:not(.hidden)');
    var name = active && active.getAttribute('data-pane');
    if(name && typeof loadTab === 'function') loadTab(name);
  } catch(e){}
};

function addStampToPage(){
  if(!pdfDocProxy){ toast(t('cs.pdfFirst'),'err'); return; }
  if(!savedStampBase64){ toast(t('cs.noStamp'),'err'); return; }
  createDraggableItem(savedStampBase64,'stamp');
  toast(t('cs.stampAdded'),'ok');
}

async function burnAndDownloadDoc(){
  toast(t('cs.burning'),'');
  const dataUrl = await buildSignedPdf();
  if(!dataUrl) return;
  const a=document.createElement('a');
  a.href=dataUrl;
  a.download='alairt_megrendelo.pdf';
  a.click();
}

async function burnAndSaveDoc(){
  toast(t('cs.burning'),'');
  const dataUrl = await buildSignedPdf();
  if(!dataUrl) return;
  gas('orderDocSaveSigned',[currentDocId,dataUrl]).then(r=>{
    if(r.ok){ toast(t('cs.savedToSystem'),'ok'); loadDocList(currentDocOrderId); closeSignModal(); }
    else{ toast(r.err||t('cs.saveError'),'err'); }
  });
}

function chatGetLabel(roomId,meta,me){
  if(roomId==='manager')return '📡 Sofőrök → Diszpécser (csoport)';
  if(roomId==='admin_manager')return '🔐 Admin ↔ Manager';
  if(roomId.startsWith('dm_')){
    // Kinyerjük a másik fél emailjét
    var inner=roomId.replace('dm_','');
    var parts=inner.split('_X_');
    if(parts.length===2){
      var myEsc=(me.email||'').toLowerCase().replace(/@/g,'__').replace(/\./g,'_d_');
      var otherEsc=parts[0]===myEsc?parts[1]:parts[0];
      var decoded=otherEsc.replace(/__/g,'@').replace(/_d_/g,'.');
      return meta.otherName?meta.otherName+' ('+decoded+')':decoded;
    }
  }
  return meta.label||roomId;
}

function chatOpenNewRoom(){
  gas('userListAll').then(function(list){
    var sel=document.getElementById('newRoomUser');
    if(!sel)return;
    sel.innerHTML=list
      .filter(function(u){return u.email!==(_meChat&&_meChat.email);})
      .map(function(u){
        return '<option value="'+u.email+'|'+u.pozicio+'|'+escHtml(u.nume||u.email)+'">'
          +escHtml(u.nume||u.email)+' ('+u.pozicio+')</option>';
      }).join('');
  });
  var modal=document.getElementById('newRoomModal');
  if(modal)modal.style.display='flex';
}

function chatStartNewRoom(){
  var sel=document.getElementById('newRoomUser');
  if(!sel||!sel.value)return;
  var parts=sel.value.split('|');
  var email=parts[0],role=parts[1],name=parts[2]||parts[0];
  var roomId=dmRoomId(_meChat.email,email);
  _fbDb.ref('chats/'+_chatCompanyId+'/rooms/'+roomId+'/meta').set({
    roomId:roomId,
    label:name+' ↔ '+(_meChat.nume||''),
    otherName:name,
    otherEmail:email,
    participants:[_meChat.email||'',email],
    lastMsg:'',
    lastTime:firebase.database.ServerValue.TIMESTAMP
  });
  var modal=document.getElementById('newRoomModal');
  if(modal)modal.style.display='none';
  setTimeout(function(){openChatRoom(roomId);},400);
}

function clearAdminSig(){if(sigCtx)sigCtx.clearRect(0,0,sigCanvas.width,sigCanvas.height);}

function clearOrderSel() {
  document.querySelectorAll('.orderRowCb').forEach(function(c){ c.checked = false; });
  var sa = document.getElementById('selectAllOrders');
  if (sa) sa.checked = false;
  updateOrderSelBar();
}

function clearSignCanvas(){
  if(signCtxEl)signCtxEl.clearRect(0,0,signCanvasEl.width,signCanvasEl.height);
}

function close2faSetupModal() {
  document.getElementById('modal2faSetup').classList.remove('open');
}

function closeBugReport(){ document.getElementById('bugModal').classList.remove('open'); }

function closeDocModal(){
  document.getElementById('docModal').classList.remove('open');
}

function closeExtDriverModal(){document.getElementById('extDriverModal').classList.remove('open');}

function closeModal(){document.getElementById('userModal').classList.remove('open');}

function closeOrderEditModal() {
  document.getElementById('orderEditModal').classList.remove('open');
}

function closeQuickVehicle() {
  document.getElementById('quickVehicleModal').classList.remove('open');
}

function closeSidebar() {
  document.getElementById('mainSidebar').classList.remove('mob-open');
  document.getElementById('sidebarOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function closeSignModal(){
  document.getElementById('signModal').classList.remove('open');
}

function closeVehicleModal(){document.getElementById('vehicleModal').classList.remove('open');}

function createExtDriver(){
  const d={nume:document.getElementById('edNume').value.trim(),firma:document.getElementById('edFirma').value.trim(),telefon:document.getElementById('edTelefon').value.trim(),email:document.getElementById('edEmail').value.trim(),rendszam_camion:document.getElementById('edCamion').value.trim(),rendszam_remorca:document.getElementById('edRemorca').value.trim(),nota:document.getElementById('edNota').value.trim()};
  if(!d.nume&&!d.firma){toast(t('cs.driverOrCompanyReq'),'err');return;}
  gas('extDriverCreate',[d]).then(r=>{if(r.ok){toast(t('cs.driverAdded'),'ok');['edNume','edFirma','edTelefon','edEmail','edCamion','edRemorca','edNota'].forEach(id=>{document.getElementById(id).value='';});loadExtDrivers();}else{toast(r.err||t('common.error'),'err');}});
}

function createInv(){
  var poz   = document.getElementById('invPoz').value;
  var email = document.getElementById('invEmail').value.trim();
  var nume  = document.getElementById('invNume').value.trim();
  var tel   = document.getElementById('invTel').value.trim();
  gas('invCreate',[poz, email, nume, tel]).then(function(r){
    if(r&&r.ok){ toast(t('cs.codePrefix')+r.kod,'ok'); loadInvites();
      document.getElementById('invEmail').value='';
      document.getElementById('invNume').value='';
      document.getElementById('invTel').value=''; }
    else toast((r&&r.err)||'Hiba','err');
  });
}

// ════════════════════════════════════════════════════════════
//  Térképes cím-kiegészítés + auto-km + útvonal-előnézet (OPT-IN)
//  Funkció-kapcsoló: 'order-route-map' (a developer kapcsolja cégenként).
//  A köztespontok CSAK a km-számításhoz/előnézethez vannak — NEM megállók.
// ════════════════════════════════════════════════════════════
var _orderMapOn = false;
var RM_CFG = {
  create: { load:'oLoad',    loadDD:'oLoadDD',     unload:'oUnload',   unloadDD:'oUnloadDD',   km:'oKm',  btn:'oMapBtn'  },
  edit:   { load:'oeLocInc', loadDD:'oeLocIncDD',  unload:'oeLocDesc', unloadDD:'oeLocDescDD', km:'oeKm', btn:'oeMapBtn' },
};
function _rmFresh(){ return { via:[], km:null, dur:null, polyline:[], waypoints:[], kmAuto:true, lastKey:null }; }
var _rmState = { create:_rmFresh(), edit:_rmFresh() };
var _rmLeaflet=null, _rmLayers=null, _rmWhich=null, _rmClickAdds=false;

/// Általános cím-autocomplete (Photon proxy). onPick(lat,lng): a kiválasztás után fut.
function vsAttachAutocomplete(inputId, ddId, onPick){
  var input=document.getElementById(inputId), dd=document.getElementById(ddId);
  if(!input||!dd||input._vsAcBound) return; input._vsAcBound=true;
  var timer=null;
  input.addEventListener('input', function(){
    var q=input.value.trim(); if(timer)clearTimeout(timer);
    input._vsLat=null; input._vsLng=null; // kézi gépelés törli a cached koordinátát
    if(q.length<3){ dd.classList.remove('open'); dd.innerHTML=''; return; }
    timer=setTimeout(function(){
      fetch('/api/geo-autocomplete?q='+encodeURIComponent(q),{credentials:'same-origin'})
        .then(function(r){return r.json();}).then(function(d){
          var items=(d&&d.items)||[];
          if(!items.length){ dd.classList.remove('open'); dd.innerHTML=''; return; }
          dd.innerHTML=items.map(function(it){ var label=it.label||it.title; var main=it.title||label;
            var lat=it.lat!=null?it.lat:'', lng=it.lng!=null?it.lng:'';
            return '<div class="vs-ac-item" data-label="'+esc(label)+'" data-lat="'+lat+'" data-lng="'+lng+'"><div class="ac-main">'+esc(main)+'</div><div class="ac-sub">'+esc(label)+'</div></div>'; }).join('');
          dd.classList.add('open');
          Array.prototype.forEach.call(dd.querySelectorAll('.vs-ac-item'), function(el){
            el.addEventListener('mousedown', function(e){ e.preventDefault();
              input.value=el.getAttribute('data-label');
              var lat=parseFloat(el.getAttribute('data-lat')), lng=parseFloat(el.getAttribute('data-lng'));
              input._vsLat=isNaN(lat)?null:lat; input._vsLng=isNaN(lng)?null:lng;
              dd.classList.remove('open'); dd.innerHTML='';
              if(onPick) onPick(input._vsLat, input._vsLng); });
          });
        }).catch(function(){ dd.classList.remove('open'); });
    },300);
  });
  input.addEventListener('keydown', function(e){ if(e.key==='Escape') dd.classList.remove('open'); });
}

// Bekötés a fuvar-kiíró + szerkesztő mezőkre (csak ha a kapcsoló BE van).
function initOrderMapFeature(){
  // ⭐ Kedvenc helyszínek gyors-választó a cím-mezőkhöz — független az
  // order-route-map kapcsolótól (mindig elérhető, csak hozzáad egy gombot;
  // a Photon autocomplete érintetlen marad). Ha sikerült a választás és a
  // térképes funkció be van, az útvonal/km is újraszámol.
  if(window.FavLocations){
    ['create','edit'].forEach(function(which){
      var c=RM_CFG[which];
      FavLocations.attachPicker(c.load, 'load', function(){ if(typeof orderRouteRecalc==='function') orderRouteRecalc(which); });
      FavLocations.attachPicker(c.unload, 'unload', function(){ if(typeof orderRouteRecalc==='function') orderRouteRecalc(which); });
    });
  }
  // Alapból BE (a kódbázis „hiányzó sor = bekapcsolva" konvenciója szerint);
  // a developer cégenként KI tudja kapcsolni (explicit enabled=false).
  _orderMapOn = !(window._vsFeatures && window._vsFeatures['order-route-map']===false);
  if(!_orderMapOn) return;
  if(!window._vsAcCloseBound){ window._vsAcCloseBound=true;
    document.addEventListener('click', function(e){
      Array.prototype.forEach.call(document.querySelectorAll('.vs-ac-dd.open'), function(dd){
        if(!dd.parentElement.contains(e.target)) dd.classList.remove('open'); });
    });
  }
  ['create','edit'].forEach(function(which){
    var c=RM_CFG[which];
    vsAttachAutocomplete(c.load, c.loadDD, function(){ orderRouteRecalc(which); });
    vsAttachAutocomplete(c.unload, c.unloadDD, function(){ orderRouteRecalc(which); });
    var li=document.getElementById(c.load), ui=document.getElementById(c.unload);
    if(li&&!li._vsBlur){ li._vsBlur=true; li.addEventListener('blur', function(){ setTimeout(function(){ orderRouteRecalc(which); },150); }); }
    if(ui&&!ui._vsBlur){ ui._vsBlur=true; ui.addEventListener('blur', function(){ setTimeout(function(){ orderRouteRecalc(which); },150); }); }
    var km=document.getElementById(c.km);
    if(km&&!km._vsKm){ km._vsKm=true; km.addEventListener('input', function(){ _rmState[which].kmAuto=false; }); }
    var btn=document.getElementById(c.btn);
    if(btn&&!btn._vsBtn){ btn._vsBtn=true; btn.addEventListener('click', function(){ openRouteMap(which); }); }
  });
}

function _rmBuildWps(which){
  var c=RM_CFG[which], st=_rmState[which];
  var loadEl=document.getElementById(c.load), unloadEl=document.getElementById(c.unload);
  var load=((loadEl||{}).value||'').trim();
  var unload=((unloadEl||{}).value||'').trim();
  if(!load||!unload) return null;
  var lWp={type:'loading',address:load};
  if(loadEl && loadEl._vsLat!=null){ lWp.lat=loadEl._vsLat; lWp.lng=loadEl._vsLng; }
  var uWp={type:'unloading',address:unload};
  if(unloadEl && unloadEl._vsLat!=null){ uWp.lat=unloadEl._vsLat; uWp.lng=unloadEl._vsLng; }
  var wps=[lWp];
  st.via.forEach(function(v){ wps.push(v.lat!=null?{type:'waypoint',lat:v.lat,lng:v.lng,address:v.address||null}:{type:'waypoint',address:v.address}); });
  wps.push(uWp);
  return wps;
}

// Felrakó+lerakó(+köztespontok) → km + polyline. A km mezőt csak akkor tölti,
// ha üres VAGY korábban is automata volt (kézi érték nyer).
function orderRouteRecalc(which){
  if(!_orderMapOn) return;
  var c=RM_CFG[which], st=_rmState[which];
  var wps=_rmBuildWps(which); if(!wps) return;
  var key=JSON.stringify(wps);
  if(key===st.lastKey && st.polyline.length){ if(_rmWhich===which) routeMapDraw(which); return; }
  st.lastKey=key;
  gas('orderRouteEstimate',[{waypoints:wps}]).then(function(r){
    if(!r||!r.ok){ return; }  // csendben — a kézi km marad
    st.km=r.km; st.dur=r.durationSeconds; st.polyline=r.polyline||[]; st.waypoints=r.waypoints||[];
    var kmEl=document.getElementById(c.km);
    if(kmEl && (st.kmAuto || !String(kmEl.value||'').trim())){ kmEl.value=r.km; st.kmAuto=true; }
    var btn=document.getElementById(c.btn); if(btn) btn.style.display='';
    if(_rmWhich===which){ routeMapDraw(which); renderRouteVia(which); }
  }).catch(function(){});
}

// A fuvarra mentendő útvonal-metaadat (NEM tartalmaz megállókat).
function buildRouteGeo(which){
  var st=_rmState[which];
  if(!_orderMapOn || !st || !st.waypoints || st.waypoints.length<2) return undefined;
  return { waypoints: st.waypoints.map(function(w){ return { type:w.type, address:(w.label||w.address||null), lat:w.lat, lng:w.lng }; }),
           km: st.km, durationSeconds: st.dur };
}
function resetRouteState(which){
  _rmState[which]=_rmFresh();
  var b=document.getElementById(RM_CFG[which].btn); if(b) b.style.display='none';
}

// ── Útvonal-előnézet modal (mindig VILÁGOS térkép) ──
function ensureRouteMapModal(){
  if(document.getElementById('routeMapModal')) return;
  var d=document.createElement('div'); d.id='routeMapModal';
  d.innerHTML='<div class="rmm-card">'
    +'<div class="rmm-head"><b class="text-primary" style="font-size:15px;">'+t('cs.rm.title')+'</b>'
    +'<span id="rmmKm" class="badge info" style="margin-left:6px;">—</span>'
    +'<span style="margin-left:auto;display:flex;gap:8px;">'
      +'<button id="rmmSaveBtn" class="btn primary" style="padding:5px 12px;display:none;" onclick="routeMapSave()">💾 '+t('cs.rm.save')+'</button>'
      +'<button class="btn ghost" style="padding:5px 12px;" onclick="closeRouteMap()">'+t('cs.rm.close')+'</button>'
    +'</span></div>'
    +'<div class="rmm-body">'
    +'<div class="rmm-map" id="rmmMap"></div>'
    +'<div class="rmm-side">'
      +'<div class="text-muted" style="font-size:12px;margin-bottom:10px;line-height:1.45;">'+t('cs.rm.viaHint')+'</div>'
      +'<div id="rmmViaList"></div>'
      +'<div class="rmm-via"><div class="vs-ac-wrap"><input class="input" id="rmmViaInput" placeholder="'+t('cs.rm.viaPh')+'" autocomplete="off"><div class="vs-ac-dd" id="rmmViaInputDD"></div></div>'
      +'<button class="btn ok" style="padding:9px 11px;" onclick="routeMapAddViaFromInput()">➕</button></div>'
      +'<label style="display:flex;align-items:center;gap:7px;font-size:12px;margin-top:10px;cursor:pointer;"><input type="checkbox" id="rmmClickAdd" onchange="_rmClickAdds=this.checked;"> '+t('cs.rm.clickAdd')+'</label>'
      +'<button class="btn ghost" style="width:100%;margin-top:10px;padding:8px;font-size:12px;" onclick="routeMapClearVia()">'+t('cs.rm.clearVia')+'</button>'
    +'</div></div></div>';
  document.body.appendChild(d);
  vsAttachAutocomplete('rmmViaInput','rmmViaInputDD',null);
}
function initRouteLeaflet(){
  if(typeof L==='undefined'){ toast(t('cs.mapNotLoaded'),'err'); return; }
  if(_rmLeaflet){ setTimeout(function(){ _rmLeaflet.invalidateSize(); },50); return; }
  _rmLeaflet=L.map('rmmMap',{zoomControl:true}).setView([46,25],5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    { subdomains:'abcd', maxZoom:19, attribution:'© OpenStreetMap, © CARTO' }).addTo(_rmLeaflet);
  _rmLayers=L.layerGroup().addTo(_rmLeaflet);
  _rmLeaflet.on('click', function(e){ if(_rmClickAdds && _rmWhich){ routeMapAddVia(_rmWhich,{lat:e.latlng.lat,lng:e.latlng.lng}); } });
  setTimeout(function(){ _rmLeaflet.invalidateSize(); },80);
}
function rmFmtDur(sec){ sec=Math.round(sec||0); var h=Math.floor(sec/3600), m=Math.round((sec%3600)/60); return (h>0?(h+'ó '):'')+m+'p'; }
function routeMapDraw(which){
  if(!_rmLeaflet||!_rmLayers) return;
  _rmLayers.clearLayers();
  var st=_rmState[which];
  var km=document.getElementById('rmmKm'); if(km) km.textContent=(st.km!=null?(st.km+' km'):'—')+(st.dur?(' · '+rmFmtDur(st.dur)):'');
  if(st.polyline && st.polyline.length){
    var line=L.polyline(st.polyline,{color:'#6366f1',weight:5,opacity:0.85}).addTo(_rmLayers);
    try{ _rmLeaflet.fitBounds(line.getBounds(),{padding:[30,30]}); }catch(e){}
  }
  (st.waypoints||[]).forEach(function(w){
    if(w.lat==null) return;
    var color=w.type==='loading'?'#22c55e':w.type==='unloading'?'#ef4444':'#3b82f6';
    var lbl=w.type==='loading'?'Felrakó':w.type==='unloading'?'Lerakó':'Köztes';
    L.circleMarker([w.lat,w.lng],{radius:7,color:'#fff',weight:2,fillColor:color,fillOpacity:1})
      .addTo(_rmLayers).bindTooltip(lbl+(w.label?': '+w.label:''),{direction:'top'});
  });
}
function renderRouteVia(which){
  var box=document.getElementById('rmmViaList'); if(!box) return;
  var st=_rmState[which];
  // 💾 mentés gomb: csak a SZERKESZTŐBŐL (létező fuvar) + ha van köztespont — a térképen menthető
  var sb=document.getElementById('rmmSaveBtn');
  if(sb){ sb.style.display = (which==='edit' && typeof _oeOrderId!=='undefined' && _oeOrderId && st.via.length>0) ? '' : 'none'; }
  if(!st.via.length){ box.innerHTML='<div class="text-muted" style="font-size:12px;margin-bottom:8px;">'+t('cs.rm.noVia')+'</div>'; return; }
  box.innerHTML=st.via.map(function(v,i){
    var lbl=v.address||(v.lat!=null?(Number(v.lat).toFixed(3)+', '+Number(v.lng).toFixed(3)):'?');
    return '<div class="rmm-via"><span class="badge info" style="flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🔵 '+esc(lbl)+'</span>'
      +'<button class="btn danger" style="padding:6px 10px;" onclick="routeMapRemoveVia(\''+which+'\','+i+')">✕</button></div>';
  }).join('');
}
function openRouteMap(which){
  _rmWhich=which; ensureRouteMapModal();
  document.getElementById('routeMapModal').classList.add('open');
  var cb=document.getElementById('rmmClickAdd'); if(cb){ cb.checked=false; } _rmClickAdds=false;
  setTimeout(function(){ initRouteLeaflet(); renderRouteVia(which); routeMapDraw(which);
    // ha nincs még vonal (pl. szerkesztőből nyitva), számoljuk újra
    if(!_rmState[which].polyline.length){ _rmState[which].lastKey=null; orderRouteRecalc(which); }
  },60);
}
function closeRouteMap(){ var m=document.getElementById('routeMapModal'); if(m) m.classList.remove('open'); _rmWhich=null; }
// Az aktuális útvonalat (köztespontokkal) a fuvarra menti — a térkép NYITVA marad,
// folytatható tovább. Csak a szerkesztőből (létező fuvar). A km + route_geo mentődik,
// így a 🛣️ útdíj-becslés is már ezt a finomított útvonalat használja.
function routeMapSave(){
  if(_rmWhich!=='edit' || typeof _oeOrderId==='undefined' || !_oeOrderId){ toast(t('cs.rm.saveOnlyEdit'),'err'); return; }
  var st=_rmState['edit'];
  var rg=buildRouteGeo('edit');
  if(!rg){ toast(t('cs.rm.saveNoRoute'),'err'); return; }
  var payload={ route_geo: rg };
  if(st && st.km!=null) payload.km=st.km;
  var btn=document.getElementById('rmmSaveBtn'); if(btn) btn.disabled=true;
  gas('comUpdate',[_oeOrderId, payload]).then(function(r){
    if(btn) btn.disabled=false;
    if(r&&r.ok){
      toast(t('cs.rm.saved'),'ok');
      // a szerkesztő km mezőjét is szinkronban tartjuk (de a térkép nyitva marad)
      var kmEl=document.getElementById(RM_CFG.edit.km); if(kmEl && st && st.km!=null){ kmEl.value=st.km; _rmState.edit.kmAuto=true; }
    } else { toast((r&&r.err)||'Eroare la salvare','err'); }
  }).catch(function(){ if(btn) btn.disabled=false; toast('Eroare la salvare','err'); });
}
function routeMapAddViaFromInput(){
  var inp=document.getElementById('rmmViaInput'); var v=(inp&&inp.value||'').trim();
  if(!v||!_rmWhich) return; routeMapAddVia(_rmWhich,{address:v}); if(inp) inp.value='';
}
function routeMapAddVia(which, pt){
  var st=_rmState[which]; if(st.via.length>=7){ toast(t('cs.maxVia'),'err'); return; }
  st.via.push(pt); st.lastKey=null; renderRouteVia(which); orderRouteRecalc(which);
}
function routeMapRemoveVia(which, i){
  var st=_rmState[which]; st.via.splice(i,1); st.lastKey=null; renderRouteVia(which); orderRouteRecalc(which);
}
function routeMapClearVia(which){
  which=which||_rmWhich; if(!which) return;
  var st=_rmState[which]; st.via=[]; st.lastKey=null; renderRouteVia(which); orderRouteRecalc(which);
}

// ── Rakomány-típus (FTL/LTL) + méretek segédek ──
// Két pipa, de egymást kizárják: ha az egyiket bepipálod, a másik lekerül.
function loadTypeExclusive(me, otherId){
  if(me.checked){const o=document.getElementById(otherId);if(o)o.checked=false;}
  refreshDimReq();
}
// a két checkbox állapota → 'FTL' | 'LTL' | null
function loadTypeValue(ftlId, ltlId){
  if((document.getElementById(ftlId)||{}).checked)return 'FTL';
  if((document.getElementById(ltlId)||{}).checked)return 'LTL';
  return null;
}
// LTL kiválasztásakor a „méretek kötelező" jelzés pirossá vált (kiíró + szerkesztő)
function refreshDimReq(){
  [['oLtl','oDimReq'],['oeLtl','oeDimReq']].forEach(function(p){
    var ltl=document.getElementById(p[0]), hint=document.getElementById(p[1]);
    if(hint) hint.style.color = (ltl&&ltl.checked) ? 'var(--status-danger)' : 'var(--text-muted)';
  });
}
// fuvarlista-badge: FTL = teljes áru (kék), LTL = részrakomány (sárga) + méret
function loadTypeBadge(lt, dims){
  var d = dims ? ' <span class="badge" style="font-size:10px;padding:1px 6px;background:rgba(255,255,255,0.06);color:var(--text-muted);" title="'+t('cs.tt.cargoSize')+'">📐 '+dims+'</span>' : '';
  if(lt==='FTL')return ' <span class="badge info" title="'+t('cs.tt.ftl')+'" style="font-size:10px;padding:1px 6px;">FTL</span>'+d;
  if(lt==='LTL')return ' <span class="badge warn" title="'+t('cs.tt.ltl')+'" style="font-size:10px;padding:1px 6px;">LTL</span>'+d;
  return d;
}
// h×sz×m cm string a méretekből (vagy üres)
function dimStr(h,w,m){ return (h&&w&&m)?(h+'×'+w+'×'+m):''; }

// ════════════════════════════════════════════════════════════
//  Fuvar-CSV import (tömeges) — oszlop-párosítóval, mint az
//  üzemanyagkártya-importnál. A nem párosított oszlopok a fuvar
//  import_extra mezőjébe kerülnek (nem vész el adat).
// ════════════════════════════════════════════════════════════
var _oiHeader = [], _oiRows = [];
// minden importálható fuvar-mező + fejléc-felismerő regex
var OI_FIELDS = [
  { k:'client',          label:'Ügyfél',            re:/client|ugyfel|ügyf|customer|beneficiar|megrend/i },
  { k:'ref',             label:'Referencia',        re:/\bref|rendel|order\s*(no|nr|id)|comand|hivatk/i },
  { k:'loc_incarcare',   label:'Felrakó',           re:/felrak|incarc|loading|^load|pickup|origin|honnan|berak/i },
  { k:'loc_descarcare',  label:'Lerakó',            re:/lerak|descarc|unload|deliver|dest|hova|kirak/i },
  { k:'data_incarcare',  label:'Felrakás dátuma',   re:/(felrak|incarc|load|pickup).*(dat|date|nap)/i },
  { k:'data_descarcare', label:'Lerakás dátuma',    re:/(lerak|descarc|unload|deliv).*(dat|date|nap)/i },
  { k:'pret',            label:'Ár',                re:/\bar\b|ár|pret|price|fuvardij|díj|tarif|fee|amount/i },
  { k:'km',              label:'Km',                re:/\bkm\b|távol|distan|distanta/i },
  { k:'suly_kg',         label:'Súly (kg)',         re:/suly|súly|weight|greutate|\bkg\b|tonna|massa/i },
  { k:'load_type',       label:'FTL/LTL típus',     re:/ftl|ltl|rakomany|rakomány|load.?type|tip.*marf/i },
  { k:'hossz_cm',        label:'Hossz (cm)',        re:/hossz|length|lungim|\blung/i },
  { k:'szel_cm',         label:'Szélesség (cm)',    re:/szel|width|latim|\blat\b/i },
  { k:'mag_cm',          label:'Magasság (cm)',     re:/magas|height|inalt|\bmag\b/i },
  { k:'rendszam_camion', label:'Vontató rendszám',  re:/vontat|camion|truck|tractor|kamion/i },
  { k:'rendszam_remorca',label:'Pótkocsi rendszám', re:/potkocs|pótkocs|remorc|trailer|utánf/i },
  { k:'nume_sofer',      label:'Sofőr neve',        re:/sofer|sofőr|driver|conducator/i },
  { k:'email_sofer',     label:'Sofőr e-mail',      re:/e-?mail/i },
  { k:'firma_extern',    label:'Külsős cég',        re:/extern|subcontr|transportator|alváll/i },
  { k:'telefon_extern',  label:'Külsős telefon',    re:/tel|phone|telefon|mobil/i },
];

function openOrderImport(){
  ensureOrderImportModal();
  document.getElementById('orderImportModal').classList.add('open');
  _oiHeader=[]; _oiRows=[];
  document.getElementById('oiMapping').innerHTML='';
  document.getElementById('oiResult').innerHTML='';
  var f=document.getElementById('oiFile'); if(f) f.value='';
}
function closeOrderImport(){ var m=document.getElementById('orderImportModal'); if(m) m.classList.remove('open'); }
function ensureOrderImportModal(){
  if(document.getElementById('orderImportModal')) return;
  var d=document.createElement('div'); d.id='orderImportModal';
  d.innerHTML='<div class="oi-card">'
    +'<div class="oi-head"><b class="text-primary" style="font-size:15px;">'+t('cs.oi.title')+'</b>'
    +'<button class="btn ghost" style="margin-left:auto;padding:5px 12px;" onclick="closeOrderImport()">'+t('cs.oi.close')+'</button></div>'
    +'<div class="oi-body">'
    +'<div class="text-muted" style="font-size:12px;margin-bottom:10px;line-height:1.5;">'+t('cs.oi.hint')+'</div>'
    +'<div class="field" style="max-width:420px;"><label>'+t('cs.oi.csvFile')+'</label><input class="input" type="file" id="oiFile" accept=".csv,.txt" onchange="orderImportParse()"></div>'
    +'<div id="oiMapping" style="margin-top:14px;"></div>'
    +'<div id="oiResult" style="margin-top:12px;"></div>'
    +'</div></div>';
  document.body.appendChild(d);
}

function orderImportParse(){
  var f=(document.getElementById('oiFile')||{}).files;
  if(!f||!f[0]) return;
  var reader=new FileReader();
  reader.onload=function(e){
    var text=String(e.target.result||'');
    var lines=text.split(/\r?\n/).filter(function(l){return l.trim();});
    if(lines.length<2){ toast(t('cs.csvEmpty'),'err'); return; }
    var delim=[';',',','\t','|'].sort(function(a,b){ return lines[0].split(b).length - lines[0].split(a).length; })[0];
    var split=function(l){ return l.split(delim).map(function(c){ return c.replace(/^"|"$/g,'').trim(); }); };
    _oiHeader=split(lines[0]);
    _oiRows=lines.slice(1).map(split);

    var opts='<option value="">'+t('cs.oi.noneExtra')+'</option>'+_oiHeader.map(function(h,i){ return '<option value="'+i+'">'+esc(h||(t('cs.oi.col')+(i+1)))+'</option>'; }).join('');
    var cells=OI_FIELDS.map(function(fl){
      return '<div class="field" style="margin:0;"><label>'+esc(fl.label)+'</label>'
        +'<select class="select" id="oiCol_'+fl.k+'" onchange="orderImportPreview()">'+opts+'</select></div>';
    }).join('');
    document.getElementById('oiMapping').innerHTML=
      '<div class="glass-soft" style="padding:14px;">'
      +'<div class="text-primary" style="font-size:13px;font-weight:700;margin-bottom:10px;">'+t('cs.oi.mapTitle')+_oiRows.length+t('cs.oi.rowsSep')+'<code>'+(delim==='\t'?'TAB':esc(delim))+'</code>)</div>'
      +'<div class="oi-map-grid">'+cells+'</div>'
      +'<div style="display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap;">'
      +'<button class="btn primary" onclick="orderImportRun(this)">📥 '+_oiRows.length+t('cs.oi.importBtn')+'</button>'
      +'<span id="oiUnmapped" class="text-muted" style="font-size:11.5px;"></span>'
      +'</div>'
      +'<div id="oiPreview" style="margin-top:12px;"></div>'
      +'</div>';
    // a guess-értékek beállítása (a fenti inline <script> nem fut innerHTML-ből)
    var taken2={};
    OI_FIELDS.forEach(function(fl){
      var sel=document.getElementById('oiCol_'+fl.k); if(!sel) return;
      for(var i=0;i<_oiHeader.length;i++){ if(!taken2[i] && fl.re.test(_oiHeader[i]||'')){ sel.value=String(i); taken2[i]=true; break; } }
    });
    orderImportPreview();
  };
  reader.readAsText(f[0],'utf-8');
}

function oiColIndex(k){ var v=(document.getElementById('oiCol_'+k)||{}).value; return v===''||v==null?-1:parseInt(v,10); }
function oiNum(s){
  s=String(s==null?'':s).replace(/\s/g,'');
  if(/,\d{1,2}$/.test(s)) s=s.replace(/\./g,'').replace(',','.'); else s=s.replace(/,/g,'');
  var n=parseFloat(s); return isFinite(n)?n:null;
}
function oiDate(s){
  s=String(s||'').trim(); var m;
  m=s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/); if(m) return m[1]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[3]).slice(-2);
  m=s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/); if(m) return m[3]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[1]).slice(-2);
  return null;
}
function oiLoadType(s){
  s=String(s||'').toLowerCase();
  if(/ftl|teljes|full|complet/.test(s)) return 'FTL';
  if(/ltl|rész|resz|part|grup/.test(s)) return 'LTL';
  return null;
}
// egy CSV-sor → fuvar-objektum (+ import_extra a nem párosított oszlopokból)
function oiBuildRow(r){
  var used={}, o={};
  OI_FIELDS.forEach(function(fl){
    var ci=oiColIndex(fl.k); if(ci<0||ci>=r.length) return; used[ci]=true;
    var v=r[ci];
    if(fl.k==='pret'||fl.k==='km'||fl.k==='suly_kg'||/_cm$/.test(fl.k)) o[fl.k]=oiNum(v);
    else if(fl.k.indexOf('data_')===0) o[fl.k]=oiDate(v);
    else if(fl.k==='load_type') o[fl.k]=oiLoadType(v);
    else o[fl.k]=(v||'').trim();
  });
  if(o.email_sofer) o.sofer_type='Intern';
  else if(o.firma_extern) o.sofer_type='Extern';
  var extra={};
  _oiHeader.forEach(function(h,i){ if(!used[i] && (r[i]||'').trim()!=='') extra[h||('oszlop'+(i+1))]=String(r[i]).trim(); });
  if(Object.keys(extra).length) o.import_extra=extra;
  return o;
}
function orderImportPreview(){
  var un=document.getElementById('oiUnmapped'); var pv=document.getElementById('oiPreview');
  if(!_oiHeader.length){ if(un)un.textContent=''; if(pv)pv.innerHTML=''; return; }
  var used={}; OI_FIELDS.forEach(function(fl){ var ci=oiColIndex(fl.k); if(ci>=0) used[ci]=true; });
  var unmapped=_oiHeader.filter(function(h,i){ return !used[i]; });
  if(un) un.innerHTML = unmapped.length
    ? t('cs.oi.unmapped',{n:unmapped.length, cols:esc(unmapped.join(', ').slice(0,120))})
    : t('cs.oi.allMapped');
  // előnézet: első 3 sor a párosítás szerint
  var cols=OI_FIELDS.filter(function(fl){ return oiColIndex(fl.k)>=0; });
  var head='<tr>'+cols.map(function(fl){ return '<th>'+esc(fl.label)+'</th>'; }).join('')+(unmapped.length?'<th>'+t('cs.oi.extraCol')+'</th>':'')+'</tr>';
  var body=_oiRows.slice(0,3).map(function(r){
    var o=oiBuildRow(r);
    return '<tr>'+cols.map(function(fl){ var v=o[fl.k]; return '<td>'+esc(v==null||v===''?'—':String(v))+'</td>'; }).join('')
      +(unmapped.length?'<td class="text-muted">'+esc(o.import_extra?Object.keys(o.import_extra).length+t('cs.oi.fields'):'—')+'</td>':'')+'</tr>';
  }).join('');
  if(pv) pv.innerHTML='<div class="text-muted" style="font-size:11px;margin-bottom:4px;">'+t('cs.oi.preview')+'</div><div class="oi-prev"><table><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>';
}
function orderImportRun(btn){
  if(!_oiRows.length){ toast(t('cs.csvFirst'),'err'); return; }
  var rows=_oiRows.map(oiBuildRow);
  if(btn){ btn.disabled=true; btn.textContent=t('cs.oi.importing'); }
  gas('bulkCreateOrders',[{rows:rows}]).then(function(r){
    if(btn){ btn.disabled=false; btn.textContent='📥 '+_oiRows.length+t('cs.oi.importBtn'); }
    var res=document.getElementById('oiResult');
    if(r&&r.ok){
      toast(t('cs.importDone')+r.inserted+t('cs.oi.created')+(r.skipped?(' · '+r.skipped+t('cs.oi.skipped')):''),'ok');
      if(res) res.innerHTML='<div class="glass-soft" style="padding:12px;border:1px solid rgba(34,197,94,0.4);">'
        +'<b style="color:var(--status-ok);">✅ '+r.inserted+t('cs.oi.created')+'</b>'
        +(r.skipped?(' <span class="text-muted">'+r.skipped+t('cs.oi.skipped')+'</span>'):'')
        +'</div>';
      if(typeof loadOrders==='function') loadOrders();
    } else { toast((r&&r.err)||t('cs.importError'),'err'); }
  }).catch(function(){ if(btn){btn.disabled=false;} toast(t('cs.importError'),'err'); });
}

function createOrder(){
  const st=document.querySelector('input[name="oSoferType"]:checked');
  const type=st?st.value:'None';
  const p={
    client:document.getElementById('oClient').value.trim(),
    ref:document.getElementById('oRef').value.trim(),
    series_id:(document.getElementById('oSeria')||{}).value||null,
    pret:document.getElementById('oPret').value,
    km:document.getElementById('oKm').value,
    suly_kg:(document.getElementById('oSuly')||{}).value||null,
    load_type:loadTypeValue('oFtl','oLtl'),
    hossz_cm:(document.getElementById('oHossz')||{}).value||null,
    szel_cm:(document.getElementById('oSzel')||{}).value||null,
    mag_cm:(document.getElementById('oMag')||{}).value||null,
    route_geo:buildRouteGeo('create'),
    loc_incarcare:document.getElementById('oLoad').value.trim(),
    loc_descarcare:document.getElementById('oUnload').value.trim(),
    data_incarcare:document.getElementById('oLoadDate').value||null,
    data_descarcare:document.getElementById('oUnloadDate').value||null,
    sofer_type:type==='None'?null:type,
    rendszam_camion:document.getElementById('oCamionSelect').value||null,
    rendszam_remorca:document.getElementById('oRemorcaSelect').value||null,
  };
  if(type==='Intern'){const sel=document.getElementById('oInternDriver');p.email_sofer=sel.value;p.nume_sofer=sel.options[sel.selectedIndex]?sel.options[sel.selectedIndex].text.split(' (')[0]:'';}
  else if(type==='Extern'){p.nume_sofer=document.getElementById('oExternNume').value.trim();p.firma_extern=document.getElementById('oExternFirma').value.trim();p.telefon_extern=document.getElementById('oExternTelefon').value.trim();const eid=document.getElementById('oExternSelect').value;p.external_driver_id=eid?parseInt(eid,10):null;}
  if(!p.client){toast(t('cs.clientNameReq'),'err');return;}
  if(!p.load_type){toast(t('cs.pickLoadType'),'err');return;}
  if(p.load_type==='LTL' && (!p.hossz_cm||!p.szel_cm||!p.mag_cm)){toast(t('cs.ltlDimsReq'),'err');return;}
  gas('comCreate',[p]).then(r=>{
    if(r&&r.ok){
      let extra='';
      if(r.paired_driver)extra=' · '+t('cs.pairedDriver')+r.paired_driver;
      else if(r.paired_vehicle)extra=' · '+t('cs.pairedVehicle')+r.paired_vehicle;
      if(r.paired_trailer)extra+=' · '+t('cs.pairedTrailer')+r.paired_trailer;
      toast(t('cs.orderSavedId')+r.id+extra,'ok');
      loadOrders();
      ['oClient','oRef','oPret','oKm','oSuly','oHossz','oSzel','oMag','oLoad','oUnload','oLoadDate','oUnloadDate','oExternNume','oExternFirma','oExternTelefon'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
      ['oFtl','oLtl'].forEach(id=>{const el=document.getElementById(id);if(el)el.checked=false;});
      refreshDimReq();
      if(typeof resetRouteState==='function')resetRouteState('create');
      document.querySelectorAll('input[name="oSoferType"]').forEach(r=>{if(r.value==='None')r.checked=true;});
      onSoferTypeChange('None');
    }else{toast((r&&r.err)||t('common.error'),'err');}
  });
}

function createVehicle(tip){
  let prefix=tip==='Vontato'?'vt':'pt';
  const v={tip:tip,rendszam:document.getElementById(prefix+'Rendszam').value.trim(),marca:document.getElementById(prefix+'Marca').value.trim(),model:document.getElementById(prefix+'Model').value.trim(),an:document.getElementById(prefix+'An').value,nota:document.getElementById(prefix+'Nota').value.trim()};
  if(tip==='Potkocsi'){
    // rakodási felület (opcionális, alapértelmezés előtöltve)
    v.trailer_kind=(document.getElementById('ptKind')||{}).value||null;
    v.cargo_length_cm=(document.getElementById('ptCargoLen')||{}).value||null;
    v.cargo_width_cm=(document.getElementById('ptCargoWid')||{}).value||null;
    v.cargo_height_cm=(document.getElementById('ptCargoHei')||{}).value||null;
  }
  if(!v.rendszam){toast(t('cs.plateReq'),'err');return;}
  gas('vehicleCreate',[v]).then(r=>{if(r.ok){toast((tip==='Vontato'?t('cs.vtractor'):t('cs.vtrailer'))+t('cs.added'),'ok');['Rendszam','Marca','Model','An','Nota'].forEach(f=>{document.getElementById(prefix+f).value='';});if(tip==='Potkocsi'&&typeof resetTrailerFormDefaults==='function')resetTrailerFormDefaults();loadVehicles();}else{toast(r.err||t('common.error'),'err');}});
}

function deleteExtDriver(id){
  const d=extDriverCache.find(x=>x.id===id);
  const nev=d?(d.nume||d.firma||'?'):'?';
  if(!confirm(t('cs.cf.delConfirmName')+nev+'?'))return;
  gas('extDriverDelete',[id]).then(r=>{if(r.ok){toast(t('common.deletedX'),'ok');loadExtDrivers();}else{toast(r.err||t('common.error'),'err');}});
}

function deleteLeg(legId) {
  if (!confirm(t('cs.cf.delLeg'))) return;
  gas('deleteOrderLeg', [legId]).then(function(r) {
    if (r && r.ok) {
      toast(t('common.deleted'),'ok');
      fetch('/api/execute', {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({functionName:'getOrderById',arguments:[_oeOrderId]})})
      .then(r=>r.json()).then(d => renderOeLegs(d.legs||[]));
    }
  });
}

function deleteVehicle(id){
  const v=vehicleCache.find(x=>x.id===id);
  const rendszam=v?v.rendszam:'?';
  if(!confirm(t('cs.cf.delVehicle',{plate:rendszam})))return;
  gas('vehicleDelete',[id]).then(r=>{if(r.ok){toast(t('common.deletedX'),'ok');loadVehicles();}else{toast(r.err||t('common.error'),'err');}});
}

function dmRoomId(emailA,emailB){
  var a=emailA.toLowerCase().replace(/@/g,'__').replace(/\./g,'_d_');
  var b=emailB.toLowerCase().replace(/@/g,'__').replace(/\./g,'_d_');
  return 'dm_'+(a<b?a+'_X_'+b:b+'_X_'+a);
}

function editExtDriver(id){
  const d=extDriverCache.find(x=>x.id===id);
  if(!d){toast(t('cs.driverNotFound'),'err');return;}
  document.getElementById('edEditId').value=d.id;
  document.getElementById('edEditNume').value=d.nume||'';
  document.getElementById('edEditFirma').value=d.firma||'';
  document.getElementById('edEditTelefon').value=d.telefon||'';
  document.getElementById('edEditEmail').value=d.email||'';
  document.getElementById('edEditCamion').value=d.rendszam_camion||'';
  document.getElementById('edEditRemorca').value=d.rendszam_remorca||'';
  document.getElementById('edEditNota').value=d.nota||'';
  document.getElementById('extDriverModal').classList.add('open');
}

function editVehicle(id){
  const v=vehicleCache.find(x=>x.id===id);
  if(!v){toast(t('cs.vehicleNotFound'),'err');return;}
  document.getElementById('vehEditId').value=v.id;
  document.getElementById('vehEditTip').value=v.tip;
  document.getElementById('vehEditRendszam').value=v.rendszam||'';
  document.getElementById('vehEditMarca').value=v.marca||'';
  document.getElementById('vehEditModel').value=v.model||'';
  document.getElementById('vehEditAn').value=v.an||'';
  document.getElementById('vehEditNota').value=v.nota||'';
  // Teherjármű paraméterek (útvonaltervezés)
  var _vset=function(id,val){var el=document.getElementById(id);if(el)el.value=(val!=null?val:'');};
  _vset('vehEditHeight', v.height_cm);
  _vset('vehEditWidth', v.width_cm);
  _vset('vehEditLength', v.length_cm);
  _vset('vehEditWeight', v.weight_kg);
  _vset('vehEditAxleWeight', v.weight_per_axle_kg);
  _vset('vehEditAxleCount', v.axle_count!=null?v.axle_count:2);
  _vset('vehEditTrailerCount', v.trailer_count!=null?v.trailer_count:0);
  _vset('vehEditTruckType', v.truck_type||'straight');
  _vset('vehEditTunnel', v.tunnel_category||'');
  _vset('vehEditHazmat', v.hazardous_goods||'');
  _vset('vehEditFuel', v.fuel_per_100km);
  // Rakodási felület — csak pótkocsinál; üres mezőknél alapértelmezés előtöltve
  var cargoWrap=document.getElementById('vehTrailerCargoWrap');
  if(cargoWrap){
    cargoWrap.style.display = v.tip==='Potkocsi' ? 'block' : 'none';
    if(v.tip==='Potkocsi'){
      var kind=v.trailer_kind||'standard';
      _vset('vehEditTrailerKind', kind);
      _vset('vehEditCargoLen', v.cargo_length_cm!=null?v.cargo_length_cm:TRAILER_DEFAULTS.len);
      _vset('vehEditCargoWid', v.cargo_width_cm!=null?v.cargo_width_cm:TRAILER_DEFAULTS.wid);
      _vset('vehEditCargoHei', v.cargo_height_cm!=null?v.cargo_height_cm:(kind==='mega'?TRAILER_DEFAULTS.heiMega:TRAILER_DEFAULTS.heiStd));
    }
  }
  document.getElementById('vehicleModal').classList.add('open');
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fillExternDriver(){
  const sel=document.getElementById('oExternSelect');
  const id=parseInt(sel.value,10);
  if(!id){['oExternNume','oExternFirma','oExternTelefon'].forEach(x=>{document.getElementById(x).value='';});return;}
  const d=externDriversCache.find(x=>x.id===id);
  if(!d)return;
  document.getElementById('oExternNume').value=d.nume||'';
  document.getElementById('oExternFirma').value=d.firma||'';
  document.getElementById('oExternTelefon').value=d.telefon||'';
}

function filterCamions(){const q=document.getElementById('oCamionSearch').value.toLowerCase();renderCamions(camionCache.filter(v=>v.rendszam.toLowerCase().includes(q)||(v.marca||'').toLowerCase().includes(q)));}

function filterExternDrivers(){const q=document.getElementById('oExternSearch').value.toLowerCase();renderExternDrivers(externDriversCache.filter(d=>(d.nume||'').toLowerCase().includes(q)||(d.firma||'').toLowerCase().includes(q)));}

function filterInternDrivers(){const q=document.getElementById('oInternSearch').value.toLowerCase();renderInternDrivers(internDriversCache.filter(u=>u.nume.toLowerCase().includes(q)||u.email.toLowerCase().includes(q)));}

function filterOrders() {
  var q = ((document.getElementById('orderSearch')||{}).value||'').toLowerCase();
  var st = (document.getElementById('orderStatusFilter')||{}).value||'';
  var filtered = _ordersAllCache.filter(function(c){
    var txt = [c.id,c.client,c.ref,c.loc_incarcare,c.loc_descarcare,
               c.email_sofer,c.nume_sofer,c.rendszam_camion].join(' ').toLowerCase();
    return (!q||txt.includes(q))&&(!st||c.status===st);
  });
  renderFilteredOrders(filtered);
}

function filterRemorcas(){const q=document.getElementById('oRemorcaSearch').value.toLowerCase();renderRemorcas(remorcaCache.filter(v=>v.rendszam.toLowerCase().includes(q)||(v.marca||'').toLowerCase().includes(q)));}

function gas(fn,args){return new Promise(function(res,rej){fetch('/api/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({functionName:fn,arguments:args||[]})}).then(r=>r.json()).then(d=>{res(d.result);}).catch(rej);});}

function initFirebaseChatPanel(me){
  _meChat=me;
  fetch('/api/firebase-config')
    .then(function(r){return r.json();})
    .then(function(cfg){
      if(!cfg||!cfg.apiKey){
        var el=document.getElementById('chatLoadMsg');
        if(el)el.textContent=t('cs.chatMissing');
        return;
      }
      var s1=document.createElement('script');
      s1.src='https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js';
      document.head.appendChild(s1);
      s1.onload=function(){
        var sAuth=document.createElement('script');
        sAuth.src='https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js';
        document.head.appendChild(sAuth);
        sAuth.onload=function(){
        var s2=document.createElement('script');
        s2.src='https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js';
        document.head.appendChild(s2);
        s2.onload=function(){
          if(!firebase.apps.length)firebase.initializeApp(cfg);
          fetch('/api/firebase-token').then(function(r){return r.json();}).then(function(td){
            var authPromise=(td.ok&&td.token&&firebase.auth)
              ?firebase.auth().signInWithCustomToken(td.token).catch(function(e){console.warn('FB auth hiba:',e);})
              :Promise.resolve();
            authPromise.then(function(){
          _fbDb=firebase.database();
          _chatCompanyId=String(me.company_id||'global');
          var el=document.getElementById('chatLoadMsg');
          if(el)el.style.display='none';
          var ca=document.getElementById('chatApp');
          if(ca)ca.style.display='';
          startRoomListListener(me);
            });
          });
        };
        };
      };
    })
    .catch(function(){
      var el=document.getElementById('chatLoadMsg');
      if(el)el.textContent=t('cs.chatUnavail');
    });
}

function loadAdminSigPreview(){gas('stampGet').then(r=>{if(r&&r.ok&&r.base64){document.getElementById('adminSigPreview').src=r.base64;document.getElementById('adminSigPreview').style.display='block';document.getElementById('noSigText').style.display='none';}});}

function loadBorderLogs(){gas('getBorderLogs').then(list=>{document.querySelector('#tblBorderLogs tbody').innerHTML=list.map(l=>`<tr><td>${l.created_at?new Date(l.created_at).toLocaleString('hu-HU'):'—'}</td><td>${esc(l.nume_sofer||l.email_sofer||'—')}</td><td><span class="badge warn">${esc(l.tip||'—')}</span></td><td>${l.gps_lat?('📍 '+parseFloat(l.gps_lat).toFixed(4)+', '+parseFloat(l.gps_lng).toFixed(4)):'GPS n/a'}</td></tr>`).join('');});}


function loadDocSeries() {
  fetch('/api/document-series?type=MT').then(function(r){return r.json();}).then(function(d){
    if (!d.ok) return;
    var inp = document.getElementById('docSeriesPrefix');
    if (inp) inp.value = d.prefix||'MT';
    var seq = document.getElementById('docSeriesCurrentSeq');
    if (seq) seq.textContent = d.currentSeq||0;
    updateDocSeriesPreview();
  }).catch(function(){});
}

function loadDriverUploadedDocs() {
  var container = document.getElementById('docGroupsContainer');
  if (container) container.innerHTML = '<div style="text-align:center;color:var(--muted);padding:40px;"><div class="spinner" style="margin:0 auto 10px;"></div>'+t('fe.loading')+'</div>';
  gas('getDriverDocs').then(function(list) {
    _driverDocsCache = list || [];
    var sel = document.getElementById('docFilterSofer');
    if (sel) {
      var sofors = [...new Set(_driverDocsCache.map(function(d){return d.nume_sofer||d.email_sofer;}).filter(Boolean))].sort();
      sel.innerHTML = '<option value="">'+t('cs.allDrivers')+'</option>' + sofors.map(function(s){return '<option value="'+esc(s)+'">'+esc(s)+'</option>';}).join('');
    }
    renderDocGroups();
  });
}

function loadExtDrivers(){
  gas('extDriverList').then(list=>{
    if(!Array.isArray(list))list=[];
    extDriverCache=list;
    const tb=document.querySelector('#tblExtDrivers tbody');
    if(list.length===0){tb.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--muted);">'+t('cs.noExtDriver')+'</td></tr>';return;}
    tb.innerHTML=list.map(d=>`<tr><td>${vsAvatar(d.nume||'')}${esc(d.nume||'—')}</td><td>${esc(d.firma||'—')}</td><td>${esc(d.telefon||'—')}</td><td>${esc(d.email||'—')}</td><td>${esc(d.rendszam_camion||'—')}</td><td>${esc(d.rendszam_remorca||'—')}</td><td>${esc(d.nota||'—')}</td><td><button class="btn primary" style="padding:4px 10px;font-size:12px;" onclick="editExtDriver(${d.id})">${t('cs.editShort')}</button> <button class="btn danger" style="padding:4px 10px;font-size:12px;" onclick="deleteExtDriver(${d.id})">${t('cs.del')}</button></td></tr>`).join('');
  }).catch(function(e){ console.error('loadExtDrivers hiba:', e); toast(t('common.loadError'),'err'); });
}

function loadInternalDrivers(){
  // Sofőr-lista + jármű-hozzárendelés (a jármű mellett 🛰️ = GPS-re kötve)
  gas('getDriverVehicleAssignments').then(function(r){
    var tbody = document.querySelector('#tblInternalDrivers tbody');
    if(!tbody) return;
    if(!r || !r.ok){ tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px;">'+t('common.loadError')+'</td></tr>'; return; }
    var list = r.drivers||[];
    var vehicles = r.vehicles||[];
    var trailers = r.trailers||[];
    if(!list.length){
      tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px;">'+t('cs.noIntDriver')+'</td></tr>';
      return;
    }
    // fejléc-frissítés (Jármű oszlop hozzáadása, ha még nincs)
    var thead = document.querySelector('#tblInternalDrivers thead tr');
    if(thead && thead.children.length === 4){
      var th = document.createElement('th');
      th.textContent = t('cs.assignedVehicle');
      thead.insertBefore(th, thead.children[3]);
    }
    // XSS-védelem: a sor-adatot gyorsítótárból (index alapján) adjuk át, NEM HTML-attribútumba ágyazva
    window._vsIntDrvCache = list;
    tbody.innerHTML = list.map(function(d, i){
      var myVeh = vehicles.find(function(v){ return (v.assigned_driver_email||'').toLowerCase() === d.email.toLowerCase(); });
      var opts = '<option value="">'+t('cs.noVehicleDash')+'</option>' + vehicles.map(function(v){
        var takenBy = v.assigned_driver_email && v.assigned_driver_email.toLowerCase() !== d.email.toLowerCase();
        var lbl = v.rendszam + (v.has_gps ? ' 🛰️' : '') + (v.marca ? ' — ' + v.marca : '') + (takenBy ? t('cs.atOtherDriver') : '');
        return '<option value="'+v.id+'"'+(myVeh && myVeh.id===v.id ? ' selected':'')+'>'+esc(lbl)+'</option>';
      }).join('');
      var gpsBadge = myVeh
        ? (myVeh.has_gps
            ? ' <span class="badge ok" title="'+t('cs.tt.gpsLinked')+'">🛰️ GPS</span>'
            : ' <span class="badge warn" title="'+t('cs.tt.gpsNotLinked')+'">'+t('cs.noGps')+'</span>')
        : '';
      // Alapértelmezett pótkocsi a hozzárendelt vontatóhoz (auto-párosítás
      // fuvar-kiíráskor) — csak ha a sofőrnek van vontatója.
      var trailerSel = '';
      if(myVeh){
        var topts = '<option value="">'+t('cs.noDefaultTrailer')+'</option>' + trailers.map(function(t){
          var lbl = t.rendszam + (t.marca ? ' — ' + t.marca : '');
          return '<option value="'+t.id+'"'+(String(myVeh.default_trailer_id)===String(t.id)?' selected':'')+'>'+esc(lbl)+'</option>';
        }).join('');
        trailerSel = '<div style="margin-top:5px;">'
          +'<select class="select" style="max-width:230px;padding:6px 8px;font-size:12px;display:inline-block;" '
          +'title="'+t('cs.tt.defaultTrailer')+'" '
          +'onchange="assignDefaultTrailerUi('+myVeh.id+', this.value)">'+topts+'</select></div>';
      }
      return '<tr>'
        +'<td>'+vsAvatar(d.nume||'')+esc(d.nume)+'</td>'
        +'<td>'+esc(d.email)+'</td>'
        +'<td>'+esc(d.tel||'—')+'</td>'
        +'<td style="white-space:nowrap;">'
        +'<select class="select" style="max-width:230px;padding:6px 8px;font-size:12.5px;display:inline-block;" '
        +'onchange="assignDriverVehicleUi(window._vsIntDrvCache['+i+'].email, this.value)">'+opts+'</select>'
        +gpsBadge
        +trailerSel
        +'</td>'
        +'<td>'
        +'<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="EntityDetail.openDriver(window._vsIntDrvCache['+i+'].email, window._vsIntDrvCache['+i+'].nume)">'+t('ed.details')+'</button> '
        +'<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="editUser(window._vsIntDrvCache['+i+'])">'+t('cs.edit')+'</button> '
        +'<button class="btn danger" style="padding:4px 10px;font-size:12px;" onclick="deleteUser(window._vsIntDrvCache['+i+'].email,window._vsIntDrvCache['+i+'].nume)">'+t('cs.del')+'</button>'
        +'</td>'
        +'</tr>';
    }).join('');
  }).catch(function(e){ console.error('loadInternalDrivers hiba:', e); toast(t('common.loadError'),'err'); });
}

// Jármű-hozzárendelés mentése a sofőr sorából
function assignDriverVehicleUi(email, vehicleId){
  gas('assignDriverVehicle', [email, vehicleId || null]).then(function(r){
    if(r && r.ok){ toast(vehicleId ? t('cs.vehAssigned') : t('cs.assignRemoved'), 'ok'); loadInternalDrivers(); }
    else { toast((r && r.err) || t('common.error'), 'err'); loadInternalDrivers(); }
  });
}

// Alapértelmezett pótkocsi mentése a vontatóhoz (Belső sofőrök fül)
function assignDefaultTrailerUi(vehicleId, trailerId){
  gas('assignDefaultTrailer', [vehicleId, trailerId || null]).then(function(r){
    if(r && r.ok){ toast(trailerId ? t('cs.trailerPairSaved') : t('cs.trailerPairRemoved'), 'ok'); }
    else { toast((r && r.err) || t('common.error'), 'err'); loadInternalDrivers(); }
  });
}

// ── Ügyfél-portál hozzáférések (az Ügyfelek fülön) ──
var _cpClients = [];
function loadClientPortalAccess(){
  var box=document.getElementById('clientPortalAccessBox'); if(!box) return;
  // OPT-IN funkció: csak ha a developer bekapcsolta ennél a cégnél
  if(!(window._vsFeatures && window._vsFeatures['client-portal']===true)){
    box.innerHTML='<div class="glass" style="padding:14px 18px;"><div class="text-muted" style="font-size:12.5px;">'+t('cs.cp.offHint')+'</div></div>';
    return;
  }
  box.innerHTML='<div class="glass" style="padding:18px 20px;"><div style="font-size:16px;font-weight:800;margin-bottom:4px;">'+t('cs.cp.title')+'</div>'
    +'<div class="text-muted" style="font-size:12.5px;margin-bottom:14px;">'+t('cs.cp.hint')+'</div>'
    +'<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-bottom:16px;">'
    +'<div class="field" style="margin:0;min-width:220px;position:relative;" id="cpClientWrap">'
    +'<label>'+t('cs.cp.client')+'</label>'
    +'<input class="input" id="cpClientDisplay" readonly placeholder="'+t('cs.cp.pickClient')+'" style="cursor:pointer;" onclick="cpDropToggle(event)" autocomplete="off">'
    +'<input type="hidden" id="cpClientSel">'
    +'<div id="cpClientDrop" class="cp-client-drop" style="display:none;">'
    +'<div style="padding:8px 8px 4px;"><input class="input" id="cpClientSearch" placeholder="Keresés..." style="margin:0;font-size:13px;" oninput="cpDropFilter()" onclick="event.stopPropagation()"></div>'
    +'<div id="cpClientList" style="max-height:220px;overflow-y:auto;padding:4px 6px 6px;"></div>'
    +'</div></div>'
    +'<div class="field" style="margin:0;min-width:200px;"><label>'+t('cs.cp.contactEmail')+' <span style="color:var(--brand-red);">*</span></label><input class="input" id="cpEmail" type="email" required placeholder="pl. logisztika@gyar.ro"></div>'
    +'<div class="field" style="margin:0;min-width:150px;"><label>'+t('cs.cp.nameOpt')+'</label><input class="input" id="cpNev"></div>'
    +'<button class="btn ok" style="height:42px;" onclick="cpInvite()">'+t('cs.cp.sendInvite')+'</button>'
    +'</div>'
    +'<div id="cpInviteLink"></div>'
    +'<div id="cpList"><div class="text-muted" style="font-size:12px;">'+t('fe.loading')+'</div></div>'
    +'</div>';
  // bezárás külső kattintásra (idempotens — removeEventListener után add)
  document.removeEventListener('click', cpDropClose);
  document.addEventListener('click', cpDropClose);
  // ügyfél-lista a választóhoz ( /api/clients válasza: { clients:[...] } )
  fetch('/api/clients',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(list){
    _cpClients=Array.isArray(list)?list:((list&&(list.clients||list.rows))||[]);
    cpDropRender('');
  }).catch(function(){});
  cpRefresh();
}
function cpRefresh(){
  gas('clientPortalList').then(function(r){
    var el=document.getElementById('cpList'); if(!el) return;
    if(!r||!r.ok){ el.innerHTML='<div class="text-muted" style="font-size:12px;">'+t('common.loadError')+'</div>'; return; }
    var items=r.items||[];
    if(!items.length){ el.innerHTML='<div class="text-muted" style="font-size:12px;padding:6px 0;">'+t('cs.cp.noAccess')+'</div>'; return; }
    window._cpItems=items;
    el.innerHTML=items.map(function(it,i){
      var status = it.pending_invite ? '<span class="badge warn">'+t('cs.cp.inviteSent')+'</span>'
        : (it.activ ? '<span class="badge ok">'+t('st.bActive')+'</span>' : '<span class="badge err">'+t('cs.cp.disabled')+'</span>');
      var last = it.last_login ? (t('cs.cp.lastLogin')+String(it.last_login).replace('T',' ').slice(0,16)) : t('cs.cp.neverLogin');
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border,rgba(255,255,255,.08));border-radius:10px;margin-bottom:6px;background:rgba(255,255,255,.02);">'
        +'<div style="flex:1;min-width:0;"><div style="font-weight:700;">'+esc(it.email)+'</div>'
        +'<div class="text-muted" style="font-size:12px;">'+esc(it.client_nev||'')+' · '+esc(last)+'</div></div>'
        +status
        +'<button class="btn ghost" style="padding:6px 10px;font-size:12px;" onclick="cpToggle('+i+')">'+(it.activ?t('cs.cp.disable'):t('cs.cp.enable'))+'</button>'
        +'</div>';
    }).join('');
  });
}
function cpDropToggle(e){
  e.stopPropagation();
  var d=document.getElementById('cpClientDrop'); if(!d) return;
  var open=d.style.display==='none';
  d.style.display=open?'block':'none';
  if(open){ var s=document.getElementById('cpClientSearch'); if(s){ s.value=''; s.focus(); cpDropRender(''); } }
}
function cpDropClose(e){
  var wrap=document.getElementById('cpClientWrap');
  if(wrap&&!wrap.contains(e.target)){
    var d=document.getElementById('cpClientDrop'); if(d) d.style.display='none';
  }
}
function cpDropFilter(){
  var q=(document.getElementById('cpClientSearch')||{}).value||'';
  cpDropRender(q);
}
function cpDropRender(q){
  var el=document.getElementById('cpClientList'); if(!el) return;
  var lower=q.toLowerCase();
  var list=_cpClients.filter(function(c){ return !q||((c.denumire||'').toLowerCase().indexOf(lower)>=0); });
  if(!list.length){
    el.innerHTML='<div class="text-muted" style="font-size:12px;padding:6px 4px;">'+(_cpClients.length?'Nincs találat.':t('cs.cp.noClients'))+'</div>';
    return;
  }
  el.innerHTML=list.map(function(c){
    var label=esc(c.denumire||('#'+c.id));
    return '<div data-cpid="'+c.id+'" data-cpnev="'+label+'" onclick="cpDropPick(+this.dataset.cpid,this.dataset.cpnev)" style="padding:7px 8px;border-radius:7px;cursor:pointer;font-size:13.5px;" onmouseover="this.style.background=\'rgba(128,128,128,.12)\'" onmouseout="this.style.background=\'\'">'+label+'</div>';
  }).join('');
}
function cpDropPick(id, nev){
  var h=document.getElementById('cpClientSel'); if(h) h.value=id;
  var d=document.getElementById('cpClientDisplay'); if(d) d.value=nev;
  var drop=document.getElementById('cpClientDrop'); if(drop) drop.style.display='none';
}
function cpInvite(){
  var cid=(document.getElementById('cpClientSel')||{}).value;
  var email=(document.getElementById('cpEmail')||{}).value.trim();
  var nev=(document.getElementById('cpNev')||{}).value.trim();
  if(!cid){ toast(t('cs.pickClient'),'err'); return; }
  if(!email){ toast(t('cs.contactEmailReq'),'err'); return; }
  gas('clientPortalInvite',[{client_id:cid, email:email, nev:nev}]).then(function(r){
    if(r&&r.ok){
      toast(r.emailed?t('cs.inviteSentMail2'):t('cs.inviteCreated'),'ok');
      var lb=document.getElementById('cpInviteLink');
      if(lb) lb.innerHTML='<div class="glass-soft" style="padding:10px 12px;margin-bottom:12px;border:1px solid rgba(34,197,94,.4);font-size:12px;">'
        +(r.emailed?'✉️ A meghívót elküldtük e-mailben. ':'')+'Jelszó-beállító link (másolható): <br><code style="word-break:break-all;color:var(--text-primary);">'+esc(r.link)+'</code></div>';
      document.getElementById('cpEmail').value=''; document.getElementById('cpNev').value='';
      var hid=document.getElementById('cpClientSel'); if(hid) hid.value='';
      var disp=document.getElementById('cpClientDisplay'); if(disp) disp.value='';
      cpRefresh();
    } else toast((r&&r.err)||'Hiba','err');
  });
}
function cpToggle(i){
  var it=(window._cpItems||[])[i]; if(!it) return;
  gas('clientPortalSetActive',[it.id, !it.activ]).then(function(r){
    if(r&&r.ok){ toast(it.activ?t('cs.disabled2'):t('cs.activated'),'ok'); cpRefresh(); }
    else toast((r&&r.err)||'Hiba','err');
  });
}

// ════════════════════════════════════════════════════════════
//  Útdíj (toll) — becslés a fuvar útvonalából + ráta-szerkesztő
// ════════════════════════════════════════════════════════════
var CC_FLAG = { DE:'🇩🇪',AT:'🇦🇹',HU:'🇭🇺',FR:'🇫🇷',IT:'🇮🇹',PL:'🇵🇱',CZ:'🇨🇿',SK:'🇸🇰',SI:'🇸🇮',BE:'🇧🇪',NL:'🇳🇱',RO:'🇷🇴',BG:'🇧🇬',HR:'🇭🇷',ES:'🇪🇸',CH:'🇨🇭' };
function renderTollBreak(tg){
  var box=document.getElementById('oeTollBreak'); if(!box) return;
  if(!tg || !Array.isArray(tg.byCountry) || !tg.byCountry.length){ box.innerHTML=''; return; }
  var rows=tg.byCountry.map(function(c){
    return '<tr><td>'+(CC_FLAG[c.cc]||'')+' '+esc(c.name||c.cc)+'</td><td style="text-align:right;">'+c.km+' km</td>'
      +'<td style="text-align:right;color:var(--muted);">'+(c.mode==='vignette'?t('cs.toll.vignette'):((c.eur_per_km!=null?c.eur_per_km:'')+' €/km'))+'</td>'
      +'<td style="text-align:right;font-weight:700;">'+c.cost+' €</td></tr>';
  }).join('');
  box.innerHTML='<div class="glass-soft" style="padding:10px 12px;border:1px solid rgba(245,158,11,.35);">'
    +'<div class="text-muted" style="font-size:11.5px;font-weight:700;margin-bottom:6px;">'+t('cs.toll.breakdown')+(tg.pending?t('cs.toll.partial'):'')+'</div>'
    +'<table style="width:100%;border-collapse:collapse;font-size:12px;">'
    +'<tbody>'+rows+'<tr><td style="font-weight:800;border-top:1px solid var(--border,rgba(255,255,255,.1));padding-top:6px;">'+t('cs.toll.total')+'</td><td colspan="2" style="border-top:1px solid var(--border,rgba(255,255,255,.1));"></td>'
    +'<td style="text-align:right;font-weight:800;color:#fbbf24;border-top:1px solid var(--border,rgba(255,255,255,.1));">'+(tg.total||0)+' €</td></tr></tbody></table></div>';
}
function estimateOrderToll(){
  if(!_oeOrderId){ toast(t('cs.saveOrderFirst'),'err'); return; }
  var precise = !!((document.getElementById('oeTollPrecise')||{}).checked);
  toast(t('cs.tollEstimating'),'ok');
  gas('estimateToll',[_oeOrderId, {precise:precise}]).then(function(r){
    if(r&&r.ok){
      var el=document.getElementById('oeToll'); if(el) el.value=(r.toll&&r.toll.total!=null?r.toll.total:'');
      renderTollBreak(r.toll);
      var src = (r.source==='here') ? t('cs.toll.srcHere') : t('cs.toll.srcEstimate');
      // ha pontosat kértek, de becslés jött (nincs HERE-kulcs), jelezzük
      var note = (precise && r.source!=='here') ? ' '+t('cs.toll.preciseUnavail') : '';
      toast(t('cs.tollEstimated')+(r.toll?r.toll.total:0)+' · '+src+note,'ok');
    } else toast((r&&r.err)||t('cs.toll.estError'),'err');
  });
}
// ── Ráta-szerkesztő modal ──
function openTollRates(){
  ensureTollRatesModal();
  document.getElementById('tollRatesModal').classList.add('open');
  gas('getTollRates').then(function(r){
    var body=document.getElementById('trBody'); if(!body) return;
    if(!r||!r.ok){ body.innerHTML='<div class="text-muted" style="padding:14px;">'+t('common.loadError')+'</div>'; return; }
    window._trRates=r.rates||[];
    body.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr>'
      +'<th style="text-align:left;padding:6px 8px;color:var(--muted);">'+t('cs.toll.country')+'</th><th style="text-align:left;padding:6px 8px;color:var(--muted);">'+t('cs.toll.type')+'</th>'
      +'<th style="text-align:left;padding:6px 8px;color:var(--muted);">€/km</th><th style="text-align:left;padding:6px 8px;color:var(--muted);">'+t('cs.toll.vignetteEur')+'</th></tr></thead><tbody>'
      +window._trRates.map(function(rt,i){
        return '<tr style="border-top:1px solid var(--border,rgba(255,255,255,.08));">'
          +'<td style="padding:6px 8px;">'+(CC_FLAG[rt.cc]||'')+' '+esc(rt.name)+(rt.custom?' <span class="badge ok" style="font-size:9px;">'+t('cs.toll.custom')+'</span>':'')+'</td>'
          +'<td style="padding:6px 8px;"><select class="select" id="tr_mode_'+i+'" style="padding:5px 6px;font-size:12px;"><option value="perkm"'+(rt.mode==='perkm'?' selected':'')+'>'+t('cs.toll.perKm')+'</option><option value="vignette"'+(rt.mode==='vignette'?' selected':'')+'>'+t('cs.toll.vignette')+'</option></select></td>'
          +'<td style="padding:6px 8px;"><input class="input" id="tr_km_'+i+'" type="number" step="0.01" value="'+(rt.eur_per_km||0)+'" style="width:90px;padding:5px 7px;font-size:12px;"></td>'
          +'<td style="padding:6px 8px;"><input class="input" id="tr_vig_'+i+'" type="number" step="0.01" value="'+(rt.vignette_eur||0)+'" style="width:90px;padding:5px 7px;font-size:12px;"></td></tr>';
      }).join('')+'</tbody></table>';
  });
}
function ensureTollRatesModal(){
  if(document.getElementById('tollRatesModal')) return;
  var d=document.createElement('div'); d.id='tollRatesModal';
  d.style.cssText='position:fixed;inset:0;z-index:5200;display:none;align-items:flex-start;justify-content:center;padding:24px 16px;overflow-y:auto;background:rgba(3,6,10,.72);';
  d.innerHTML='<div class="glass" style="width:min(680px,100%);background:var(--bg-panel-raised,#141c25);">'
    +'<div style="display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--border,rgba(255,255,255,.08));">'
    +'<b class="text-primary" style="font-size:15px;">'+t('cs.toll.modalTitle')+'</b>'
    +'<button class="btn ghost" style="margin-left:auto;padding:5px 12px;" onclick="closeTollRates()">✕</button></div>'
    +'<div style="padding:14px 18px;"><div class="text-muted" style="font-size:12px;margin-bottom:10px;">'+t('cs.toll.modalHint')+'</div>'
    +'<div id="trBody"></div>'
    +'<div style="margin-top:14px;display:flex;gap:8px;"><button class="btn primary" onclick="saveTollRatesUi()">'+t('cs.toll.save')+'</button>'
    +'<button class="btn ghost" onclick="closeTollRates()">'+t('common.cancel')+'</button></div></div></div>';
  d.addEventListener('mousedown',function(e){ if(e.target===d) closeTollRates(); });
  document.body.appendChild(d);
}
function closeTollRates(){ var m=document.getElementById('tollRatesModal'); if(m) m.classList.remove('open'); }
function saveTollRatesUi(){
  var rates=(window._trRates||[]).map(function(rt,i){
    return { cc:rt.cc, mode:(document.getElementById('tr_mode_'+i)||{}).value||'perkm',
      eur_per_km:(document.getElementById('tr_km_'+i)||{}).value||0,
      vignette_eur:(document.getElementById('tr_vig_'+i)||{}).value||0 };
  });
  gas('saveTollRates',[rates]).then(function(r){
    if(r&&r.ok){ toast(t('cs.tollRatesSaved'),'ok'); closeTollRates(); }
    else toast((r&&r.err)||'Hiba','err');
  });
}
// a modal .open class kezelése (display)
(function(){ var s=document.createElement('style'); s.textContent='#tollRatesModal.open{display:flex!important;}'; document.head.appendChild(s); })();

// ════════════════════════════════════════════════════════════
//  Alvállalkozó (carrier) + szállítói számla (AP) — admin oldal
// ════════════════════════════════════════════════════════════
window._carriersCache = null;
function ensureCarriers(cb){
  if(window._carriersCache){ if(cb)cb(); return; }
  gas('carrierList').then(function(r){ window._carriersCache=(r&&r.ok&&r.items)||[]; if(cb)cb(); });
}
function fillCarrierSelect(selId, selectedId){
  var sel=document.getElementById(selId); if(!sel) return;
  var list=window._carriersCache||[];
  sel.innerHTML='<option value="">— nincs —</option>'+list.map(function(c){
    return '<option value="'+c.id+'"'+(String(selectedId)===String(c.id)?' selected':'')+'>'+esc(c.nev)+(c.cui?' ('+esc(c.cui)+')':'')+'</option>';
  }).join('');
}
function oeUpdateMargin(){
  var pret=parseFloat((document.getElementById('oePret')||{}).value)||0;
  var cost=parseFloat((document.getElementById('oeCarrierCost')||{}).value)||0;
  var el=document.getElementById('oeMargin'); if(!el) return;
  if(cost>0){ var m=pret-cost; el.innerHTML=t('cs.ca.margin')+'<b style="color:'+(m>=0?'var(--status-ok)':'var(--status-danger)')+';">'+(m>=0?'+':'')+Math.round(m)+' €</b>'; }
  else el.textContent='';
}

var _carrierGroupFilter=''; // '' = mind; szám = group_id; 'none' = csoport nélküli
function loadCarriers(){
  var box=document.getElementById('carriersBox'); if(!box) return;
  window._carriersCache=null; window._carrierGroupsCache=null;
  // Csoportok + alvállalkozók párhuzamosan
  Promise.all([gas('carrierGroupList'), gas('carrierList')]).then(function(rr){
    window._carrierGroupsCache=(rr[0]&&rr[0].ok&&rr[0].items)||[];
    window._carriersCache=(rr[1]&&rr[1].ok&&rr[1].items)||[];
    renderCarriers();
  });
}
function _carrierGroupOptions(selVal){
  var groups=window._carrierGroupsCache||[];
  var opts='<option value=""'+(selVal==null||selVal===''?' selected':'')+'>'+t('cs.cg.noGroup')+'</option>';
  groups.forEach(function(g){ opts+='<option value="'+g.id+'"'+(String(selVal)===String(g.id)?' selected':'')+'>'+esc(g.name)+'</option>'; });
  return opts;
}
function renderCarriers(){
  var box=document.getElementById('carriersBox'); if(!box) return;
  var items=window._carriersCache||[];
  var groups=window._carrierGroupsCache||[];
  // Szűrés a kiválasztott csoportra (a render mindig a teljes cache-ből indul)
  var filtered=items.filter(function(c){
    if(_carrierGroupFilter===''||_carrierGroupFilter==null) return true;
    if(_carrierGroupFilter==='none') return !c.group_id;
    return String(c.group_id)===String(_carrierGroupFilter);
  });
  var rows=filtered.map(function(c){
    var i=items.indexOf(c);
    var cmr='—';
    if(c.cmr_insurance_expiry){ var d=new Date(c.cmr_insurance_expiry); var days=Math.round((d-new Date())/86400000);
      cmr = days<0 ? '<span class="badge err">'+t('cs.ca.expired')+'</span>' : days<30 ? '<span class="badge warn">'+days+t('cs.ca.days')+'</span>' : '<span class="badge ok">'+String(c.cmr_insurance_expiry).slice(0,7)+'</span>'; }
    var ob=Math.round(parseFloat(c.open_balance)||0);
    var grpSel='<select class="select cg-row-sel" style="padding:3px 6px;font-size:12px;min-width:120px;" onchange="carrierSetGroupUi('+c.id+',this.value)">'+_carrierGroupOptions(c.group_id)+'</select>';
    return '<tr style="'+(!c.aktiv?'opacity:.5;':'')+'">'
      +'<td><b class="text-primary">'+esc(c.nev)+'</b>'+(c.portal_users?' <span class="badge ok" style="font-size:9px;">'+t('cs.ca.portal')+'</span>':'')+'</td>'
      +'<td>'+esc(c.cui||'—')+'</td><td>'+grpSel+'</td><td>'+(c.payment_term_days||30)+t('cs.ca.days')+'</td><td>'+cmr+'</td>'
      +'<td style="text-align:right;color:'+(ob>0?'#ff6b75':'inherit')+';font-weight:700;">'+ob+' €</td>'
      +'<td style="white-space:nowrap;">'
      +'<button class="btn ghost" style="padding:4px 9px;font-size:12px;" onclick="carrierEditUi('+i+')">'+t('cs.editShort')+'</button> '
      +'<button class="btn ghost" style="padding:4px 9px;font-size:12px;" onclick="carrierInvitePrompt('+c.id+')" title="'+t('cs.tt.carrierInvite')+'">🔑</button> '
      +'<button class="btn danger" style="padding:4px 9px;font-size:12px;" onclick="carrierDeleteUi('+c.id+')">✕</button></td></tr>';
  }).join('');
  // Csoport-szűrő legördülő
  var filterOpts='<option value=""'+(_carrierGroupFilter===''?' selected':'')+'>'+t('cs.cg.allGroups')+'</option>'
    +'<option value="none"'+(_carrierGroupFilter==='none'?' selected':'')+'>'+t('cs.cg.noGroup')+'</option>';
  groups.forEach(function(g){ filterOpts+='<option value="'+g.id+'"'+(String(_carrierGroupFilter)===String(g.id)?' selected':'')+'>'+esc(g.name)+' ('+(g.carrier_count||0)+')</option>'; });
  // Csoport-kezelő lista (átnevezés/törlés)
  var grpRows=groups.map(function(g){
    return '<tr><td><b class="text-primary">'+esc(g.name)+'</b></td><td>'+(g.carrier_count||0)+'</td>'
      +'<td style="white-space:nowrap;">'
      +'<button class="btn ghost" style="padding:3px 8px;font-size:12px;" onclick="carrierGroupRename('+g.id+')">'+t('common.edit')+'</button> '
      +'<button class="btn danger" style="padding:3px 8px;font-size:12px;" onclick="carrierGroupDeleteUi('+g.id+')">✕</button></td></tr>';
  }).join('');
  box.innerHTML='<div class="glass" style="padding:20px;margin-bottom:16px;"><div style="font-size:15px;font-weight:800;margin-bottom:4px;">'+t('cs.cg.title')+'</div>'
    +'<div class="text-muted" style="font-size:12.5px;margin-bottom:12px;">'+t('cs.cg.hint')+'</div>'
    +'<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px;">'
    +'<div class="field" style="flex:1;min-width:160px;"><label>'+t('cs.cg.newName')+'</label><input class="input" id="cgNewName"></div>'
    +'<button class="btn ok" onclick="carrierGroupAdd()">'+t('cs.cg.addBtn')+'</button></div>'
    +(groups.length?('<table class="table"><thead><tr><th>'+t('cs.cg.colName')+'</th><th>'+t('cs.cg.colCount')+'</th><th>'+t('col.action')+'</th></tr></thead><tbody>'+grpRows+'</tbody></table>'):'<div class="text-muted" style="font-size:12.5px;">'+t('cs.cg.none')+'</div>')
    +'</div>'
    +'<div class="glass" style="padding:20px;"><div style="font-size:16px;font-weight:800;margin-bottom:4px;">'+t('cs.ca.title')+'</div>'
    +'<div class="text-muted" style="font-size:12.5px;margin-bottom:14px;">'+t('cs.ca.hint')+'</div>'
    +'<div class="grid-3" style="margin-bottom:12px;">'
    +'<div class="field"><label>'+t('cs.ca.companyName')+'</label><input class="input" id="caNev"></div>'
    +'<div class="field"><label>'+t('cs.ca.cui')+'</label><input class="input" id="caCui"></div>'
    +'<div class="field"><label>'+t('common.email')+'</label><input class="input" id="caEmail"></div>'
    +'<div class="field"><label>'+t('form.phone')+'</label><input class="input" id="caTel"></div>'
    +'<div class="field"><label>'+t('cs.ca.payTerm')+'</label><input class="input" id="caTerm" type="number" value="30"></div>'
    +'<div class="field"><label>'+t('cs.ca.cmrExpiry')+'</label><input class="input" id="caCmr" type="date"></div>'
    +'<div class="field"><label>IBAN</label><input class="input" id="caIban"></div>'
    +'<div class="field"><label>'+t('cs.cg.group')+'</label><select class="select" id="caGroup">'+_carrierGroupOptions('')+'</select></div>'
    +'<div class="field"><label>'+t('fld.note')+'</label><input class="input" id="caNota"></div>'
    +'</div>'
    +'<input type="hidden" id="caId"><button class="btn primary" onclick="carrierSaveUi()">'+t('cs.ca.saveBtn')+'</button> <button class="btn ghost" onclick="carrierFormReset()">'+t('cs.ca.newEmpty')+'</button>'
    +'<div id="carrierInviteLink" style="margin-top:12px;"></div>'
    +'<div style="display:flex;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap;"><label style="font-size:12.5px;font-weight:600;">'+t('cs.cg.filter')+'</label>'
    +'<select class="select" style="max-width:240px;" onchange="carrierGroupFilterSet(this.value)">'+filterOpts+'</select></div>'
    +'<table class="table" style="margin-top:10px;"><thead><tr><th>'+t('cs.ca.colCompany')+'</th><th>CUI</th><th>'+t('cs.cg.group')+'</th><th>'+t('cs.ca.colPayTerm')+'</th><th>'+t('cs.ca.colCmr')+'</th><th style="text-align:right;">'+t('cs.ca.colOpenDebt')+'</th><th>'+t('col.action')+'</th></tr></thead>'
    +'<tbody>'+(rows||'<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:14px;">'+t('cs.ca.none')+'</td></tr>')+'</tbody></table></div>';
}
function carrierGroupFilterSet(v){ _carrierGroupFilter=v; renderCarriers(); }
function carrierGroupAdd(){
  var el=document.getElementById('cgNewName'); var name=el?el.value.trim():'';
  if(!name){ toast(t('cs.cg.nameReq'),'err'); return; }
  gas('carrierGroupSave',[{name:name}]).then(function(r){ if(r&&r.ok){ toast(t('common.saved'),'ok'); loadCarriers(); } else toast((r&&r.err)||t('common.error'),'err'); });
}
function carrierGroupRename(id){
  var groups=window._carrierGroupsCache||[]; var g=groups.filter(function(x){return x.id===id;})[0];
  var name=prompt(t('cs.cg.renamePrompt'), g?g.name:''); if(name==null) return; name=name.trim(); if(!name) return;
  gas('carrierGroupSave',[{id:id,name:name}]).then(function(r){ if(r&&r.ok){ toast(t('common.saved'),'ok'); loadCarriers(); } else toast((r&&r.err)||t('common.error'),'err'); });
}
function carrierGroupDeleteUi(id){
  if(!confirm(t('cs.cg.delConfirm'))) return;
  gas('carrierGroupDelete',[id]).then(function(r){ if(r&&r.ok){ toast(t('common.deleted'),'ok'); if(String(_carrierGroupFilter)===String(id))_carrierGroupFilter=''; loadCarriers(); } else toast((r&&r.err)||t('common.error'),'err'); });
}
function carrierSetGroupUi(carrierId, groupId){
  gas('carrierSetGroup',[carrierId, groupId||null]).then(function(r){ if(r&&r.ok){ toast(t('common.saved'),'ok'); loadCarriers(); } else toast((r&&r.err)||t('common.error'),'err'); });
}
function carrierFormReset(){ ['caNev','caCui','caEmail','caTel','caIban','caNota'].forEach(function(i){var e=document.getElementById(i);if(e)e.value='';}); var t=document.getElementById('caTerm');if(t)t.value='30'; var c=document.getElementById('caCmr');if(c)c.value=''; var id=document.getElementById('caId');if(id)id.value=''; var g=document.getElementById('caGroup');if(g)g.value=''; }
function carrierEditUi(i){
  var c=(window._carriersCache||[])[i]; if(!c) return;
  document.getElementById('caId').value=c.id;
  document.getElementById('caNev').value=c.nev||''; document.getElementById('caCui').value=c.cui||'';
  document.getElementById('caEmail').value=c.email||''; document.getElementById('caTel').value=c.telefon||'';
  document.getElementById('caTerm').value=c.payment_term_days||30; document.getElementById('caCmr').value=c.cmr_insurance_expiry?String(c.cmr_insurance_expiry).slice(0,10):'';
  document.getElementById('caIban').value=c.iban||''; document.getElementById('caNota').value=c.nota||'';
  var grp=document.getElementById('caGroup'); if(grp) grp.value=c.group_id||'';
  document.getElementById('carriersBox').scrollIntoView({behavior:'smooth',block:'start'});
}
function carrierSaveUi(){
  var p={ id:document.getElementById('caId').value||null, nev:document.getElementById('caNev').value.trim(),
    cui:document.getElementById('caCui').value.trim(), email:document.getElementById('caEmail').value.trim(),
    telefon:document.getElementById('caTel').value.trim(), payment_term_days:document.getElementById('caTerm').value,
    cmr_insurance_expiry:document.getElementById('caCmr').value||null, iban:document.getElementById('caIban').value.trim(),
    group_id:(document.getElementById('caGroup')||{}).value||'',
    nota:document.getElementById('caNota').value.trim() };
  if(!p.nev){ toast(t('cs.companyNameReq'),'err'); return; }
  gas('carrierSave',[p]).then(function(r){ if(r&&r.ok){ toast(t('cs.carrierSaved'),'ok'); carrierFormReset(); loadCarriers(); loadCarrierAp(); } else toast((r&&r.err)||t('common.error'),'err'); });
}
function carrierDeleteUi(id){
  if(!confirm(t('cs.ca.delConfirm'))) return;
  gas('carrierDelete',[id]).then(function(r){ if(r&&r.ok){ toast(t('common.deleted'),'ok'); loadCarriers(); } else toast((r&&r.err)||t('cs.ca.notDeletable'),'err'); });
}
function carrierInvitePrompt(carrierId){
  var email=prompt(t('cs.ca.invitePrompt')); if(!email) return;
  gas('carrierPortalInvite',[{carrier_id:carrierId, email:email.trim()}]).then(function(r){
    if(r&&r.ok){ toast(r.emailed?t('cs.ca.inviteSentMail'):t('cs.ca.inviteCopy'),'ok');
      var lb=document.getElementById('carrierInviteLink');
      if(lb) lb.innerHTML='<div class="glass-soft" style="padding:10px 12px;border:1px solid rgba(34,197,94,.4);font-size:12px;">'+(r.emailed?t('cs.ca.sentByMail'):'')+t('cs.ca.pwLink')+'<br><code style="word-break:break-all;color:var(--text-primary);">'+esc(r.link)+'</code></div>';
      loadCarriers();
    } else toast((r&&r.err)||t('common.error'),'err');
  });
}

// ── Szállítói számlák (AP) ──
function loadCarrierAp(){
  var box=document.getElementById('carrierApBox'); if(!box) return;
  Promise.all([gas('carrierInvoiceList'), gas('carrierVehicleList')]).then(function(results){
    var r = results[0]; var vr = results[1];
    if(!r||!r.ok){ box.innerHTML=''; return; }
    var s=r.summary||{}, items=r.items||[];

    // Járművek carrier szerint csoportosítva
    var vehByCarrier = {};
    window._carrierVehCache = (vr && vr.ok && vr.items) || [];
    window._carrierVehCache.forEach(function(v){
      var k = String(v.carrier_id);
      if(!vehByCarrier[k]) vehByCarrier[k] = [];
      vehByCarrier[k].push(v);
    });

    // Csoportosítás carrier szerint
    var groups = {};
    items.forEach(function(it){
      var key = String(it.carrier_id);
      if(!groups[key]) groups[key] = { carrier_id: it.carrier_id, carrier_nev: it.carrier_nev||'—', invoices: [], total_open: 0 };
      groups[key].invoices.push(it);
      if(it.status !== 'paid') groups[key].total_open += (parseFloat(it.amount)||0) - (parseFloat(it.paid_amount)||0);
    });

    var accordionHtml = Object.values(groups).sort(function(a,b){ return (a.carrier_nev||'').localeCompare(b.carrier_nev||''); }).map(function(g){
      var cnt = g.invoices.length;
      var openStr = g.total_open > 0 ? Math.round(g.total_open) + ' EUR ' + t('cs.ap.open') : t('cs.ap.settled');
      var gid = 'cg_' + g.carrier_id;

      // Járművek szekció — a GPS oszlop csak ha a 'carrier-gps' funkció be van kapcsolva
      var gpsFeat = !(window._vsFeatures && window._vsFeatures['carrier-gps'] === false);
      var vehs = vehByCarrier[String(g.carrier_id)] || [];
      var vehHtml = vehs.length
        ? '<table style="width:100%;font-size:12px;border-collapse:collapse;">'
          + '<thead><tr>'
          + '<th style="padding:4px 8px;text-align:left;border-bottom:1px solid var(--border);">Vontató</th>'
          + '<th style="padding:4px 8px;text-align:left;border-bottom:1px solid var(--border);">Pótkocsi</th>'
          + '<th style="padding:4px 8px;text-align:left;border-bottom:1px solid var(--border);">Márka/Modell</th>'
          + '<th style="padding:4px 8px;text-align:left;border-bottom:1px solid var(--border);">Sofőr</th>'
          + (gpsFeat ? '<th style="padding:4px 8px;text-align:left;border-bottom:1px solid var(--border);">GPS</th>' : '')
          + '</tr></thead><tbody>'
          + vehs.map(function(v){
              var gpsBadge = v.has_gps_key ? '🛰️' : (v.track_url ? '🔗' : '<span style="color:var(--text-muted);">—</span>');
              return '<tr>'
                + '<td style="padding:4px 8px;">'+esc(v.rendszam_camion||'—')+'</td>'
                + '<td style="padding:4px 8px;color:var(--text-muted);">'+esc(v.rendszam_remorca||'—')+'</td>'
                + '<td style="padding:4px 8px;color:var(--text-muted);">'+esc([v.marca,v.model].filter(Boolean).join(' ')||'—')+'</td>'
                + '<td style="padding:4px 8px;color:var(--text-muted);">'+esc(v.sofer_nev||'—')+'</td>'
                + (gpsFeat ? ('<td style="padding:4px 8px;white-space:nowrap;">'+gpsBadge
                  + ' <button class="btn ghost" style="padding:2px 8px;font-size:11px;" onclick="openCarrierVehGps('+v.id+')">'+t('cs.cv.gpsBtn')+'</button></td>') : '')
                + '</tr>';
            }).join('')
          + '</tbody></table>'
        : '<span style="font-size:12px;color:var(--text-muted);">'+t('cs.ap.noVehicles')+'</span>';

      // Számla sorok
      var invoiceRows = g.invoices.map(function(it){
        var rem = Math.round((parseFloat(it.amount)||0)-(parseFloat(it.paid_amount)||0));
        var due='—';
        if(it.due_date){ var days=Math.round((new Date(it.due_date)-new Date())/86400000);
          due = days<0?('<span class="badge err">'+t('cs.ap.expiredDays',{n:-days})+'</span>'):days<=7?('<span class="badge warn">'+days+' '+t('cs.ap.days')+'</span>'):String(it.due_date).slice(0,10); }
        var stB = it.status==='paid'?'<span class="badge ok">'+t('pay.paid')+'</span>':it.status==='partial'?'<span class="badge warn">'+t('cs.ap.partialAmt',{n:Math.round(it.paid_amount||0)})+'</span>':'<span class="badge err">'+t('cs.ap.toPay')+'</span>';
        var orderIds=(function(){ try{ return Array.isArray(it.order_ids)?it.order_ids:JSON.parse(it.order_ids||'[]'); }catch(e){ return []; } })();
        return '<div style="padding:8px 12px;border-bottom:1px solid var(--border);font-size:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
          +'<span style="font-weight:600;">📄 '+esc(it.invoice_number||'—')+'</span>'
          +(orderIds.length?'<span style="color:var(--muted);font-size:11px;">'+esc(orderIds.join(', '))+'</span>':'')
          +'<span>'+Math.round(it.amount)+' '+esc(it.currency||'EUR')+'</span>'
          +'<span>'+due+'</span>'
          +'<span>'+stB+'</span>'
          +'<span style="margin-left:auto;display:flex;gap:4px;">'
          +(it.status!=='paid'?'<button class="btn ok" style="padding:3px 8px;font-size:11px;" onclick="carrierInvoicePayUi('+it.id+','+rem+')">'+t('cs.ap.payBtn')+'</button>':'')
          +'<button class="btn danger" style="padding:3px 8px;font-size:11px;" onclick="carrierInvoiceDeleteUi('+it.id+')">✕</button>'
          +'</span></div>';
      }).join('');

      // Accordion kártya
      return '<div class="glass-soft" style="margin-bottom:8px;border-radius:12px;overflow:hidden;">'
        // Fejléc (accordion header)
        +'<div style="padding:12px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;background:rgba(99,102,241,0.10);border-bottom:2px solid rgba(99,102,241,0.22);" onclick="carrierApToggle(\''+gid+'\')">'
        +'<span style="font-size:15px;font-weight:800;color:var(--text-primary);flex:1;">🚚 '+esc(g.carrier_nev)+'</span>'
        +'<span style="font-size:12px;color:#6366f1;font-weight:600;">'+cnt+' '+t('cs.ap.invoiceCount')+' · '+esc(openStr)+(vehs.length?' · '+vehs.length+' '+t('cs.ap.vehicleCount'):'')+'</span>'
        +'<button class="btn ghost" style="padding:3px 8px;font-size:11px;" onclick="event.stopPropagation();carrierApDocs('+g.carrier_id+')">📎 '+t('cs.ap.docsBtn')+'</button>'
        +'<span id="'+gid+'_arr" style="color:#6366f1;font-size:14px;transition:transform .2s;">▼</span>'
        +'</div>'
        // Lenyíló rész (alapból NYITVA)
        +'<div id="'+gid+'">'
        // Dokumentumok szekció
        +'<div id="'+gid+'_docs" style="background:rgba(99,102,241,0.05);padding:8px 12px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border);">📎 '+t('cs.ap.docsLoading')+'</div>'
        // Járművek szekció
        +'<div style="padding:8px 12px;background:rgba(99,102,241,0.03);border-bottom:1px solid var(--border);">'
        +'<div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:6px;">🚗 '+t('cs.ap.vehicles')+'</div>'
        + vehHtml
        +'</div>'
        // Számlák szekció
        +(invoiceRows || '<div style="padding:10px 12px;font-size:12px;color:var(--text-muted);">'+t('cs.ap.noInvoices')+'</div>')
        +'</div>'
        +'</div>';
    }).join('');

    box.innerHTML = '<div class="glass" style="padding:20px;">'
      +'<div style="font-size:16px;font-weight:800;margin-bottom:10px;">'+t('cs.ap.title')+'</div>'
      // Stat tile-ok
      +'<div class="dash-stats" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px;">'
      +apTile(t('cs.ap.openTotal'), Math.round(s.open_total||0)+' €', '#ff6b75')+apTile(t('cs.ap.dueSoon'), Math.round(s.due_soon||0)+' €', '#fbbf24')
      +apTile(t('cs.ap.overdue'), Math.round(s.overdue||0)+' €', (s.overdue>0?'#ff6b75':''))+apTile(t('cs.ap.openInvoices'), (s.open_cnt||0)+t('cs.ap.pcs'),'')
      +'</div>'
      // Új számla form
      +'<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:14px;">'
      +'<div class="field" style="margin:0;min-width:170px;"><label>'+t('cs.ap.carrier')+'</label><select class="select" id="ciCarrier" onchange="apLoadOrders()"><option value="">—</option></select></div>'
      +'<div class="field" style="margin:0;"><label>'+t('cs.ap.invNum')+'</label><input class="input" id="ciNum" style="max-width:140px;"></div>'
      +'<div class="field" style="margin:0;"><label>'+t('cs.ap.issueDate')+'</label><input class="input" id="ciIssue" type="date" style="max-width:150px;"></div>'
      +'<div class="field" style="margin:0;"><label>'+t('cs.ap.dueDate')+'</label><input class="input" id="ciDue" type="date" style="max-width:150px;"></div>'
      +'<div class="field" style="margin:0;"><label>'+t('cs.ap.amount')+'</label><input class="input" id="ciAmount" type="number" style="max-width:110px;"></div>'
      +'<div class="field" style="margin:0;"><label>'+t('cs.ap.currency')+'</label><select class="select" id="ciCurr" style="max-width:90px;"><option>EUR</option><option>RON</option><option>HUF</option><option>PLN</option></select></div>'
      +'<button class="btn primary" style="height:42px;" onclick="carrierInvoiceSaveUi()">'+t('cs.ap.saveInvoice')+'</button>'
      +'</div>'
      +'<div class="field" id="ciOrdersWrap" style="display:none;"><label>'+t('cs.ap.whichOrders')+'</label><select class="select" id="ciOrders" multiple size="3" style="height:auto;"></select></div>'
      // Carrier accordion-ok
      +(accordionHtml || '<div style="text-align:center;color:var(--muted);padding:20px;font-size:13px;">'+t('cs.ap.none')+'</div>')
      +'</div>';

    ensureCarriers(function(){ fillCarrierSelect('ciCarrier',''); });

    // Dokumentumok lazy-load minden carrier-hez
    Object.values(groups).forEach(function(g){
      var gid = 'cg_' + g.carrier_id;
      carrierApLoadDocs(g.carrier_id, gid + '_docs');
    });
  });
}

function carrierApToggle(gid){
  var panel = document.getElementById(gid);
  var arrow = document.getElementById(gid + '_arr');
  if(!panel) return;
  var open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  if(arrow) arrow.style.transform = open ? 'rotate(-90deg)' : '';
}

function carrierApLoadDocs(carrierId, targetId){
  var el = document.getElementById(targetId); if(!el) return;
  gas('carrierGetDocs', { carrierId: carrierId }).then(function(d){
    if(!d || !d.ok || !d.docs || !d.docs.length){
      el.innerHTML = '<em style="font-size:12px;color:var(--text-muted);">'+t('cs.ap.noDocs')+'</em>';
      return;
    }
    // Csoportosítás order_id szerint
    var byOrder = {};
    d.docs.forEach(function(doc){
      var key = doc.order_id ? String(doc.order_id) : '__none__';
      if(!byOrder[key]) byOrder[key] = [];
      byOrder[key].push(doc);
    });
    var html = '';
    Object.keys(byOrder).sort().forEach(function(orderId){
      var docs = byOrder[orderId];
      html += '<div style="padding:6px 0;border-bottom:1px solid var(--border);">'
        +'<div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:4px;">'
        +(orderId==='__none__'?'📁 '+t('cs.ap.docNoOrder'):'📦 '+t('cs.ap.docByOrder')+': '+esc(orderId))+'</div>'
        +docs.map(function(doc){
          var icon = (doc.mime||'').indexOf('pdf')>=0 ? '📄' : '🖼';
          return '<div style="display:flex;align-items:center;gap:6px;padding:2px 0;">'
            +icon+' <span style="font-size:12px;flex:1;">'+esc(doc.file_name||'—')+'</span>'
            +'<span class="badge info" style="font-size:10px;">'+esc(doc.kind||'')+'</span>'
            +'<button class="btn ghost" style="padding:2px 7px;font-size:11px;" onclick="carrierDocDl('+doc.id+',\''+esc(doc.file_name||'dok')+'\')">⬇</button>'
            +'</div>';
        }).join('')
        +'</div>';
    });
    el.innerHTML = html;
  });
}
function apTile(k,v,col){ return '<div class="glass-soft" style="padding:12px 14px;"><div style="font-size:11px;color:var(--muted);">'+esc(k)+'</div><div style="font-size:20px;font-weight:800;margin-top:3px;'+(col?'color:'+col:'')+'">'+v+'</div></div>'; }
function apLoadOrders(){
  var cid=(document.getElementById('ciCarrier')||{}).value;
  var wrap=document.getElementById('ciOrdersWrap'), sel=document.getElementById('ciOrders');
  if(!cid){ if(wrap)wrap.style.display='none'; return; }
  gas('carrierAssignableOrders',[cid]).then(function(r){
    if(!sel) return; var items=(r&&r.ok&&r.items)||[];
    sel.innerHTML=items.map(function(o){ return '<option value="'+esc(o.id)+'">'+esc(o.id)+' · '+esc(o.loc_incarcare||'')+'→'+esc(o.loc_descarcare||'')+(o.pret?' · '+Math.round(o.pret)+'€':'')+'</option>'; }).join('');
    if(wrap)wrap.style.display=items.length?'block':'none';
  });
}
function carrierInvoiceSaveUi(){
  var orderIds=[]; var sel=document.getElementById('ciOrders');
  if(sel) Array.prototype.forEach.call(sel.selectedOptions||[],function(o){ orderIds.push(o.value); });
  var p={ carrier_id:(document.getElementById('ciCarrier')||{}).value, invoice_number:(document.getElementById('ciNum')||{}).value.trim(),
    issue_date:(document.getElementById('ciIssue')||{}).value||null, due_date:(document.getElementById('ciDue')||{}).value||null,
    amount:(document.getElementById('ciAmount')||{}).value||0, currency:(document.getElementById('ciCurr')||{}).value||'EUR', order_ids:orderIds };
  if(!p.carrier_id){ toast(t('cs.pickCarrier'),'err'); return; }
  gas('carrierInvoiceSave',[p]).then(function(r){ if(r&&r.ok){ toast(t('cs.invoiceSaved'),'ok'); ['ciNum','ciAmount'].forEach(function(i){document.getElementById(i).value='';}); loadCarrierAp(); loadCarriers(); } else toast((r&&r.err)||'Hiba','err'); });
}
function carrierInvoicePayUi(id, rem){
  var v=prompt(t('cs.cf.paidAmount')+rem+'):'); if(v===null) return;
  var arg = v.trim()===''?'full':v.trim();
  gas('carrierInvoicePayment',[id, arg]).then(function(r){ if(r&&r.ok){ toast(t('cs.paymentSaved'),'ok'); loadCarrierAp(); loadCarriers(); } else toast((r&&r.err)||t('common.error'),'err'); });
}
function carrierInvoiceDeleteUi(id){ if(!confirm(t('cs.cf.delInvoice'))) return; gas('carrierInvoiceDelete',[id]).then(function(r){ if(r&&r.ok){ toast(t('common.deleted'),'ok'); loadCarrierAp(); loadCarriers(); } }); }

// ── Alvállalkozói jármű GPS-beállítás (megosztott link + opc. CargoTrack kulcs) ──
function openCarrierVehGps(id){
  var v=(window._carrierVehCache||[]).filter(function(x){return x.id===id;})[0]||{};
  var ovl=document.createElement('div');
  ovl.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  ovl.innerHTML='<div class="glass" style="padding:20px;max-width:480px;width:100%;border-radius:14px;max-height:92vh;overflow:auto;">'
    +'<h3 class="h-title" style="margin-top:0;">📍 '+t('cs.cv.gpsTitle')+' — <b>'+esc(v.rendszam_camion||'')+'</b></h3>'
    +'<div class="text-muted" style="font-size:12px;margin-bottom:12px;">'+t('cs.cv.gpsHint')+'</div>'
    +'<div class="field"><label>'+t('cs.cv.trackUrl')+'</label><input class="input" id="cvgUrl" type="url" placeholder="https://..." value="'+esc(v.track_url||'')+'"></div>'
    +'<div class="field"><label>'+t('cs.cv.gpsObjectId')+'</label><input class="input" id="cvgObj" placeholder="CargoTrack object_id" value="'+esc(v.gps_object_id||'')+'"></div>'
    +'<div class="field"><label>'+t('cs.cv.gpsApiKey')+'</label><input class="input" id="cvgKey" type="password" autocomplete="new-password" placeholder="'+(v.has_gps_key?'••••••••':'')+'"></div>'
    +(v.has_gps_key?'<div class="text-muted" style="font-size:11px;margin:-6px 0 10px;">'+t('cs.cv.keyKept')+'</div>':'')
    +'<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap;">'
    +'<button class="btn ghost" id="cvgCancel">'+t('etpl.cancel')+'</button>'
    +'<button class="btn primary" id="cvgSave">'+t('common.save')+'</button>'
    +'</div></div>';
  document.body.appendChild(ovl);
  function close(){ try{document.body.removeChild(ovl);}catch(e){} }
  ovl.addEventListener('click',function(e){ if(e.target===ovl) close(); });
  ovl.querySelector('#cvgCancel').addEventListener('click',close);
  ovl.querySelector('#cvgSave').addEventListener('click',function(){
    var p={ id:id,
      track_url:(ovl.querySelector('#cvgUrl').value||'').trim(),
      gps_object_id:(ovl.querySelector('#cvgObj').value||'').trim(),
      gps_api_key:(ovl.querySelector('#cvgKey').value||'') };
    gas('carrierVehicleSetGps',[p]).then(function(r){
      if(r&&r.ok){ toast(t('common.saved'),'ok'); close(); loadCarrierAp(); }
      else toast((r&&r.err)||t('common.error'),'err');
    });
  });
}

// ── Carrier dokumentumok modal (AP fülből) ──
function ensureCarrierDocsModal(){
  if(document.getElementById('carrierDocsModal')) return;
  var d=document.createElement('div');
  d.id='carrierDocsModal'; d.className='modal-back';
  d.innerHTML='<div class="modal glass" style="max-width:520px;">'
    +'<h3 style="margin-bottom:12px;">📎 Documente alvállalkozó</h3>'
    +'<div id="carrierDocsModalBody"></div>'
    +'<div style="margin-top:14px;text-align:right;">'
    +'<button class="btn ghost" onclick="document.getElementById(\'carrierDocsModal\').classList.remove(\'open\')">✕ Închide</button>'
    +'</div></div>';
  document.body.appendChild(d);
  (function(){ var s=document.createElement('style'); s.textContent='#carrierDocsModal.open{display:flex!important;}'; document.head.appendChild(s); })();
}
function carrierApDocs(carrierId){
  ensureCarrierDocsModal();
  var modal=document.getElementById('carrierDocsModal');
  var body=document.getElementById('carrierDocsModalBody');
  body.innerHTML='<div style="color:var(--text-muted);padding:12px 0;">Se încarcă…</div>';
  modal.classList.add('open');
  gas('carrierGetDocs',{carrierId:carrierId}).then(function(d){
    if(!d||!d.ok){ body.innerHTML='<div style="color:var(--status-danger);">'+(d&&d.err?esc(d.err):'Eroare')+'</div>'; return; }
    var docs=d.docs||[];
    var listHtml='';
    if(!docs.length){
      listHtml='<p style="color:var(--text-muted);font-size:13px;">Niciun document.</p>';
    } else {
      listHtml='<div style="margin-bottom:12px;">';
      docs.forEach(function(doc){
        var icon=(doc.mime&&doc.mime.indexOf('pdf')>=0)?'📄':'🖼';
        listHtml+='<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border,rgba(255,255,255,.1));">'
          +icon+' <span style="flex:1;font-size:13px;">'+esc(doc.file_name||'')+'</span>'
          +'<span class="badge info" style="font-size:11px;">'+esc(doc.kind||'')+'</span>'
          +'<button class="btn ghost" style="font-size:12px;" onclick="carrierDocDl('+doc.id+',\''+esc(doc.file_name||'document')+'\')">⬇</button>'
          +'</div>';
      });
      listHtml+='</div>';
    }
    // Faktúra feltöltés
    listHtml+='<div style="margin-top:10px;">'
      +'<div style="font-size:12px;font-weight:600;margin-bottom:6px;">➕ Faktúra feltöltése</div>'
      +'<input type="file" id="apDocFile_'+carrierId+'" accept=".pdf,.jpg,.jpeg,.png" style="font-size:12px;color:var(--text-primary);">'
      +'<button class="btn primary" style="margin-top:8px;font-size:12px;" onclick="carrierApDocUpload('+carrierId+')">📤 Feltöltés</button>'
      +'</div>';
    body.innerHTML=listHtml;
  });
}
function carrierDocDl(docId, fileName){
  gas('carrierDocDownload',{docId:docId}).then(function(d){
    if(!d||!d.ok){ toast('Eroare descărcare','err'); return; }
    var a=document.createElement('a');
    a.href=d.data_base64;
    a.download=d.file_name||fileName||'document';
    a.click();
  });
}
function carrierApDocUpload(carrierId){
  var inp=document.getElementById('apDocFile_'+carrierId);
  if(!inp||!inp.files||!inp.files.length){ toast('Selectează un fișier','err'); return; }
  var f=inp.files[0];
  if(f.size>10*1024*1024){ toast('Fișier prea mare (max 10MB)','err'); return; }
  var reader=new FileReader();
  reader.onload=function(e){
    gas('carrierDocUploadAdmin',{
      carrierId:carrierId,
      fileName:f.name,
      mime:f.type||'application/octet-stream',
      data_base64:e.target.result,
      kind:'invoice'
    }).then(function(d){
      if(d&&d.ok){ toast('Factură încărcată ✓','ok'); carrierApDocs(carrierId); }
      else toast((d&&d.err)||'Eroare','err');
    });
  };
  reader.readAsDataURL(f);
}

// ── GDPR: adat-export + anonimizálás — admin Integrációk ──
function loadGdpr(){
  var box=document.getElementById('gdprBox'); if(!box) return;
  box.innerHTML='<div class="glass-soft" style="padding:16px;">'
    +'<div class="text-primary" style="font-weight:700;margin-bottom:6px;">🔐 '+t('cs.gdpr.title')+'</div>'
    +'<div class="text-muted" style="font-size:12px;margin-bottom:10px;">'+t('cs.gdpr.hint')+'</div>'
    +'<button class="btn primary" style="padding:8px 14px;" onclick="exportGdpr(this)">'+t('cs.gdpr.export')+'</button>'
    +'</div>';
}
function exportGdpr(btn){
  if(btn){ btn.disabled=true; }
  gas('exportCompanyData').then(function(r){
    if(btn){ btn.disabled=false; }
    if(!r||!r.ok){ toast((r&&r.err)||t('common.error'),'err'); return; }
    try{
      var blob=new Blob([JSON.stringify(r,null,2)],{type:'application/json'});
      var url=URL.createObjectURL(blob);
      var a=document.createElement('a');
      a.href=url; a.download='vallorsoft-gdpr-export-'+(new Date().toISOString().slice(0,10))+'.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); },1000);
      toast(t('cs.gdpr.exported'),'ok');
    }catch(e){ toast(t('common.error'),'err'); }
  }).catch(function(){ if(btn){btn.disabled=false;} toast(t('common.error'),'err'); });
}

function loadInvites(){
  gas('invListAll').then(list=>{
    if(!Array.isArray(list)){document.querySelector('#tblInv tbody').innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--muted);">'+t('cs.noInvites')+'</td></tr>';return;}
    document.querySelector('#tblInv tbody').innerHTML=list.map(i=>{
      var sc=i.status==='Aktiv'?'ok':i.status==='Felhasznalva'?'info':'err';
      return '<tr>'
        +'<td><b style="color:var(--text-primary,#e9eef5);">'+esc(i.kod)+'</b></td>'
        +'<td>'+i.pozicio+'</td>'
        +'<td>'+esc(i.nume||'—')+'</td>'
        +'<td>'+esc(i.email||'—')+'</td>'
        +'<td>'+esc(i.tel||'—')+'</td>'
        +'<td><span class="badge '+sc+'">'+i.status+'</span></td>'
        +'<td><button class="btn ghost" style="padding:3px 10px;font-size:12px;" onclick="revokeInv(\''+esc(i.kod)+'\')" '+(i.status!=='Aktiv'?'disabled':'')+'>'+t('cs.revoke')+'</button></td>'
        +'</tr>';
    }).join('');
  }).catch(function(e){ console.error('loadInvites hiba:', e); toast(t('common.loadError'),'err'); });
}

function loadOrderFormData(){
  gas('userListAll').then(list=>{internDriversCache=list.filter(u=>u.pozicio==='Sofer');renderInternDrivers(internDriversCache);});
  gas('extDriverList').then(list=>{externDriversCache=Array.isArray(list)?list:[];renderExternDrivers(externDriversCache);});
  Promise.all([gas('vehicleList'), gas('carrierVehicleList')]).then(function(res){
    var list = Array.isArray(res[0]) ? res[0] : [];
    var cvItems = (res[1] && res[1].ok && res[1].items) ? res[1].items : [];
    camionCache = list.filter(v=>v.tip==='Vontato');
    remorcaCache = list.filter(v=>v.tip==='Potkocsi');
    renderCamions(camionCache, cvItems);
    renderRemorcas(remorcaCache);
  });
  // jármű/sofőr választásra a párja automatikusan kitöltődik (ha üres)
  const cs=document.getElementById('oCamionSelect');if(cs)cs.onchange=orderFormPairFromVehicle;
  const ds=document.getElementById('oInternDriver');if(ds)ds.onchange=orderFormPairFromDriver;
}

// ── Fuvarok kezelése — interaktív KPI mutató-sáv (vsMetricBand) ──
// A számokat a már lekért teljes fuvar-listából (_ordersAllCache) számolja,
// NEM a kliens-oldali szűrt nézetből → a KPI-k stabilak maradnak. Nincs új
// hálózati hívás. Kompakt (alacsony) sáv — a Statisztika .tall módja nélkül.
function renderOrdersMetricBand(list){
  var el = document.getElementById('ordersMetricBand');
  if (!el || typeof vsMetricBand !== 'function') return;
  list = Array.isArray(list) ? list : [];
  var total = list.length;
  var aktivSet = { 'In Curs':1, 'Alocat':1, 'Extern':1 };
  var aktiv = list.filter(function(c){ return aktivSet[c.status]; }).length;
  var varakozo = list.filter(function(c){ return c.status === 'Disponibil'; }).length;
  var lezart = list.filter(function(c){ return c.status === 'Finalizat'; }).length;
  el.innerHTML = vsMetricBand([
    { l: t('dash.kpiTotal'),   v: total,    sub: t('dash.kpiActive') + ': ' + aktiv },
    { l: t('dash.kpiActive'),  v: aktiv,    sub: 'In Curs / Alocat / Extern' },
    { l: t('list.kpiWaiting'), v: varakozo, sub: 'Disponibil' },
    { l: t('list.kpiClosed'),  v: lezart,   sub: 'Finalizat' }
  ]);
}

// A fuvar-kiíró sorozat-választójának feltöltése (alapértelmezett kijelölve).
// A választott séria id-je a createOrder payload series_id mezőjébe megy.
function populateOrderSeriaSelect(){
  var sel=document.getElementById('oSeria'); if(!sel)return;
  gas('orderSeriesList').then(function(r){
    if(!r||!r.ok||!Array.isArray(r.series))return;
    var prev=sel.value;
    sel.innerHTML=r.series.map(function(s){
      return '<option value="'+s.id+'"'+(s.is_default?' selected':'')+'>'+esc(s.prefix)+(s.is_default?' ★':'')+'</option>';
    }).join('');
    // Ha volt korábbi kézi választás és még létezik, megtartjuk.
    if(prev && sel.querySelector('option[value="'+prev+'"]')) sel.value=prev;
  }).catch(function(){});
}

function loadOrders(){
  populateOrderSeriaSelect();
  gas('comList').then(list=>{
    if(!Array.isArray(list))list=[];
    _ordersAllCache = list;
    renderOrdersMetricBand(list);
    renderFilteredOrders(list);
    // A fejléc statikus (a tbody cserélődik); a méretező/átrendező egyszer
    // fűződik fel, az oszlop-SORREND viszont minden render után újra
    // alkalmazódik a friss sorokra.
    requestAnimationFrame(function(){ enhanceOrdersTable(); });
  });
  if(typeof loadPendingHandovers==='function')loadPendingHandovers();
}

// ───────────────────────────────────────────────────────────────
//  Méretezhető + átrendezhető táblázat-oszlopok (mint egy weboldalon)
//  - Méretezés: a fejléc jobb szélén húzható fogantyú.
//  - Átrendezés: a fejléc-cellát megfogva (HTML5 drag) más helyre húzható.
//  Mindkettő localStorage-ban őrződik. A tárolt formátum kulcsonként:
//    { widths: { <kanonikusOszlopIndex>: px }, order: [ <kanonikusIndex>, … ] }
//  Minden th megkapja a kanonikus data-ci indexét; a body sorok mindig
//  kanonikus sorrendben renderelődnek, ezért render után átrendezzük őket.
//  table-layout:fixed → a kiszabott fuvarok többsoros cellái is arányosan
//  kapnak helyet. Az utolsó (checkbox) oszlop fixen a végén marad.
// ───────────────────────────────────────────────────────────────
var _colDrag = null, _colDragSrc = null;
function enhanceOrdersTable(){
  var table = document.getElementById('tblOrders');
  if(!table) return;
  if(!table._colEnhanced){ _initColEnhance(table, 'vs-cols-orders'); table._colEnhanced = true; }
  _applyColOrder(table, 'vs-cols-orders');
}
function _colState(key){
  var s = {};
  try { s = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch(e){ s = {}; }
  if(!s.widths){                    // régi lapos formátum migrációja ({idx:px})
    var flat = {}, hasFlat = false;
    Object.keys(s).forEach(function(k){ if(/^\d+$/.test(k)){ flat[k] = s[k]; hasFlat = true; } });
    s = { widths: hasFlat ? flat : {}, order: s.order || null };
  }
  if(!s.widths) s.widths = {};
  return s;
}
function _saveColState(key, st){
  try { localStorage.setItem(key, JSON.stringify({ widths: st.widths || {}, order: st.order || null })); } catch(e){}
}
function _initColEnhance(table, key){
  var head = table.tHead && table.tHead.rows[0];
  if(!head || !head.cells.length) return;
  var ths = head.cells, n = ths.length;
  var st = _colState(key);
  table._colKey = key;
  table.classList.add('resizable');
  table.style.width = 'auto';                  // nőhet a konténeren túl → vízszintes görgetés
  for(var i=0;i<n;i++){
    var th = ths[i];
    th.dataset.ci = i;                          // kanonikus oszlop-index (a pristine HTML sorrend)
    th.style.minWidth = '40px';
    var w = (st.widths[i] != null) ? st.widths[i] : (th.offsetWidth || 0);
    if(w>0) th.style.width = w + 'px';
    if(i < n-1){                                // az utolsó (checkbox) oszlop fix
      var grip = document.createElement('div');
      grip.className = 'col-resizer';
      grip.title = t('cs.colResizeHint');
      grip.addEventListener('mousedown', _colResizeStart);
      grip.addEventListener('touchstart', _colResizeStart, {passive:false});
      th.appendChild(grip);
      th.setAttribute('draggable', 'true');     // átrendezés
      th.title = t('cs.colMoveHint');
      th.addEventListener('dragstart', _colDragStart);
      th.addEventListener('dragover', _colDragOver);
      th.addEventListener('dragleave', _colDragLeave);
      th.addEventListener('drop', _colDrop);
      th.addEventListener('dragend', _colDragEnd);
    }
  }
  if(st.order && st.order.length === n) _reorderThead(table, st.order);
}
function _reorderThead(table, order){
  var head = table.tHead && table.tHead.rows[0];
  if(!head) return;
  var map = {};
  [].forEach.call(head.cells, function(th){ map[th.dataset.ci] = th; });
  order.forEach(function(ci){ if(map[ci]) head.appendChild(map[ci]); });
}
// A mentett oszlop-sorrend alkalmazása a fejlécre ÉS a (kanonikusan renderelt) body-sorokra
function _applyColOrder(table, key){
  var st = _colState(key);
  var head = table.tHead && table.tHead.rows[0];
  if(!head) return;
  if(!st.order || !st.order.length) return;
  if(st.order.length !== head.cells.length){    // oszlopszám változott → elavult sorrend eldobása
    st.order = null; _saveColState(key, st); return;
  }
  _reorderThead(table, st.order);
  var body = table.tBodies[0];
  if(!body) return;
  [].forEach.call(body.rows, function(row){
    if(row.cells.length !== st.order.length) return;   // üres-állapot (colspan) sor → kihagyás
    var cells = [].slice.call(row.cells);
    st.order.forEach(function(ci){ row.appendChild(cells[+ci]); });
  });
}
// ── Méretezés ──
function _colResizeStart(e){
  var grip = e.currentTarget, th = grip.parentNode;
  th.setAttribute('draggable', 'false');        // resize közben ne induljon oszlop-húzás
  var x = e.touches ? e.touches[0].clientX : e.clientX;
  _colDrag = { grip:grip, th:th, startX:x, startW:th.offsetWidth };
  grip.classList.add('active');
  document.body.style.cursor = 'col-resize';
  document.addEventListener('mousemove', _colResizeMove);
  document.addEventListener('mouseup', _colResizeEnd);
  document.addEventListener('touchmove', _colResizeMove, {passive:false});
  document.addEventListener('touchend', _colResizeEnd);
  e.preventDefault(); e.stopPropagation();
}
function _colResizeMove(e){
  if(!_colDrag) return;
  var x = e.touches ? e.touches[0].clientX : e.clientX;
  var w = Math.max(48, _colDrag.startW + (x - _colDrag.startX));
  _colDrag.th.style.width = w + 'px';
  if(e.cancelable) e.preventDefault();
}
function _colResizeEnd(){
  if(!_colDrag) return;
  var th = _colDrag.th, table = th.closest('table');
  _colDrag.grip.classList.remove('active');
  document.body.style.cursor = '';
  th.setAttribute('draggable', 'true');
  if(table){
    var key = table._colKey, st = _colState(key);
    st.widths[th.dataset.ci] = Math.round(th.offsetWidth);
    _saveColState(key, st);
  }
  _colDrag = null;
  document.removeEventListener('mousemove', _colResizeMove);
  document.removeEventListener('mouseup', _colResizeEnd);
  document.removeEventListener('touchmove', _colResizeMove);
  document.removeEventListener('touchend', _colResizeEnd);
}
// ── Átrendezés (HTML5 drag-and-drop a fejlécen) ──
function _colDragStart(e){
  _colDragSrc = e.currentTarget;
  e.currentTarget.classList.add('col-dragging');
  try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', e.currentTarget.dataset.ci); } catch(_){}
}
function _colDragOver(e){
  if(!_colDragSrc || e.currentTarget === _colDragSrc) return;
  e.preventDefault();
  try { e.dataTransfer.dropEffect = 'move'; } catch(_){}
  e.currentTarget.classList.add('col-drop-target');
}
function _colDragLeave(e){ e.currentTarget.classList.remove('col-drop-target'); }
function _colDrop(e){
  e.preventDefault();
  var target = e.currentTarget;
  target.classList.remove('col-drop-target');
  if(!_colDragSrc || target === _colDragSrc) return;
  var table = target.closest('table');
  if(!table) return;
  var key = table._colKey;
  var head = table.tHead.rows[0];
  var order = [].map.call(head.cells, function(th){ return th.dataset.ci; });  // jelenlegi látható sorrend
  var srcCi = _colDragSrc.dataset.ci, tgtCi = target.dataset.ci;
  order = order.filter(function(c){ return c !== srcCi; });
  order.splice(order.indexOf(tgtCi), 0, srcCi);          // a forrást a cél elé szúrjuk
  var st = _colState(key); st.order = order; _saveColState(key, st);
  _applyColOrder(table, key);
}
function _colDragEnd(e){
  e.currentTarget.classList.remove('col-dragging');
  var table = e.currentTarget.closest('table');
  if(table) [].forEach.call(table.querySelectorAll('.col-drop-target'), function(x){ x.classList.remove('col-drop-target'); });
  _colDragSrc = null;
}
// Oszlopok visszaállítása alaphelyzetbe (szélesség + sorrend) — a lista fejléc-gombja
function resetOrderColumns(){
  var table = document.getElementById('tblOrders');
  if(!table) return;
  try { localStorage.removeItem('vs-cols-orders'); } catch(e){}
  var head = table.tHead && table.tHead.rows[0];
  if(head){
    var cells = [].slice.call(head.cells);
    cells.sort(function(a,b){ return (+a.dataset.ci) - (+b.dataset.ci); });   // kanonikus sorrend
    cells.forEach(function(th){
      th.style.width = ''; th.removeAttribute('draggable'); th.title = '';
      var g = th.querySelector('.col-resizer'); if(g) g.remove();
      head.appendChild(th);
    });
  }
  table.classList.remove('resizable');
  table.style.width = '';
  table._colEnhanced = false;
  loadOrders();   // kanonikus újrarenderelés + friss enhance a természetes szélességekből
}

function loadReceivedFuvarlevelek(){
  gas('getFuvarlevelek').then(list=>{
    var tb=document.querySelector('#tblReceivedFuv tbody');
    if(!list||list.length===0){tb.innerHTML='<tr><td colspan="5">'+t('cs.noWaybills')+'</td></tr>';return;}
    tb.innerHTML=list.map(f=>`<tr>`
      +`<td><b style="color:#6366f1;">${esc(f.numar_fisa||'—')}</b></td>`
      +`<td><b style="color:var(--text-primary);">${esc(f.file_name||'—')}</b></td>`
      +`<td>${esc(f.nume_sofer||f.email_sofer||'—')}</td>`
      +`<td>${f.data_completare?new Date(f.data_completare).toLocaleString('hu-HU'):'—'}</td>`
      +`<td style="display:flex;gap:6px;flex-wrap:wrap;">`
        +`<button class="btn ghost" style="padding:5px 10px;" onclick="openPdfView('${f.id}')">👁 PDF</button>`
        +`<button class="btn primary" style="padding:5px 10px;" onclick="openFuvEdit('${f.id}')">${t('cs.editLong')}</button>`
      +`</td></tr>`).join('');
  });
}

// ===== Menetlevél PDF in-app nézet (web + PWA: NEM új lap, hanem iframe modal) =====
function openPdfView(id){
  if(!id) return;
  var fr=document.getElementById('pdfFrame');
  if(fr) fr.src='/api/pdf-download/'+id;
  var m=document.getElementById('pdfViewModal');
  if(m) m.classList.add('open');
}
function closePdfView(){
  var m=document.getElementById('pdfViewModal');
  if(m) m.classList.remove('open');
  var fr=document.getElementById('pdfFrame');
  if(fr) fr.src='about:blank';
}
function printPdfView(){
  var fr=document.getElementById('pdfFrame');
  try{ fr.contentWindow.focus(); fr.contentWindow.print(); }
  catch(e){ toast(t('cs.printFailed'),'err'); }
}

// ===== Menetlevél megtekintés / szerkesztés (Admin/Manager) =====
function feEsc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function feRowPunct(p){p=p||{};return '<div class="fe-row" style="display:grid;grid-template-columns:1fr 2fr 1.2fr auto;gap:6px;align-items:center;">'
  +'<input class="input fe-p-tip" data-sg="punct_tip" placeholder="Tip" value="'+feEsc(p.tip)+'">'
  +'<input class="input fe-p-loc" data-sg="punct_loc" placeholder="Localitate" value="'+feEsc(p.loc)+'">'
  +'<input class="input fe-p-data" placeholder="Dată" value="'+feEsc(p.data)+'">'
  +'<button class="btn ghost" style="padding:4px 9px;" onclick="this.parentNode.remove()">✕</button></div>';}

function feRowAlim(a){a=a||{};return '<div class="fe-row" style="display:grid;grid-template-columns:1.4fr 1fr .7fr .7fr .8fr .8fr auto;gap:6px;align-items:center;">'
  +'<input class="input fe-a-loc" data-sg="alim_loc" placeholder="Loc" value="'+feEsc(a.loc)+'">'
  +'<input class="input fe-a-tip" data-sg="alim_tip" placeholder="Combustibil" value="'+feEsc(a.tip||'Motorină')+'">'
  +'<input class="input fe-a-lit" type="number" placeholder="L" value="'+feEsc(a.litru)+'">'
  +'<input class="input fe-a-km" type="number" placeholder="Km" value="'+feEsc(a.km)+'">'
  +'<input class="input fe-a-plata" data-sg="alim_plata" placeholder="Plată" value="'+feEsc(a.plata||'Card')+'">'
  +'<input class="input fe-a-suma" type="number" placeholder="Sumă" value="'+feEsc(a.suma)+'">'
  +'<button class="btn ghost" style="padding:4px 9px;" onclick="this.parentNode.remove()">✕</button></div>';}

function feRowAch(c){c=c||{};return '<div class="fe-row" style="display:grid;grid-template-columns:1.4fr 1.4fr .8fr .8fr auto;gap:6px;align-items:center;">'
  +'<input class="input fe-c-loc" data-sg="ach_loc" placeholder="Loc" value="'+feEsc(c.loc)+'">'
  +'<input class="input fe-c-prod" data-sg="ach_produs" placeholder="Produs" value="'+feEsc(c.produs)+'">'
  +'<input class="input fe-c-pret" type="number" placeholder="Preț" value="'+feEsc(c.pret)+'">'
  +'<input class="input fe-c-plata" data-sg="ach_plata" placeholder="Plată" value="'+feEsc(c.plata||'Card')+'">'
  +'<button class="btn ghost" style="padding:4px 9px;" onclick="this.parentNode.remove()">✕</button></div>';}

function feAddPunct(){document.getElementById('fePuncte').insertAdjacentHTML('beforeend', feRowPunct());}
function feAddAlim(){document.getElementById('feAlim').insertAdjacentHTML('beforeend', feRowAlim());}
function feAddAch(){document.getElementById('feAch').insertAdjacentHTML('beforeend', feRowAch());}

function closeFuvEdit(){document.getElementById('fuvEditModal').classList.remove('open');if(typeof feSgClose==='function')feSgClose();}

// Timestamp → <input type="datetime-local"> érték (YYYY-MM-DDTHH:mm, helyi idő).
function feToLocalDtInput(ts){
  if(!ts) return '';
  var d=new Date(ts); if(isNaN(d.getTime())) return '';
  var p=function(n){return String(n).padStart(2,'0');};
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes());
}

// Timestamp → <input type="date"> érték (YYYY-MM-DD). UTC dátum-rész, hogy
// a kezdő/végző dátum stabil maradjon (a szerver UTC-éjfélként tárolja).
function feToDateInput(ts){
  if(!ts) return '';
  var d=new Date(ts); if(isNaN(d.getTime())) return '';
  return d.toISOString().slice(0,10);
}

// Menetlevél-modal mód: 'edit' (beküldött szerkesztése) vagy 'create' (kézi
// létrehozás). A create mód ugyanazt a modált használja, üres mezőkkel + sofőr-
// választóval; mentéskor a fuvarlevelCreate handlert hívja.
var _fuvMode='edit';
function feApplyMode(mode){
  _fuvMode=mode;
  var pickRow=document.getElementById('feDriverPickRow');
  var pdfBtn=document.getElementById('fePdfBtn');
  var title=document.getElementById('feTitle');
  if(pickRow) pickRow.style.display=(mode==='create')?'':'none';
  if(pdfBtn) pdfBtn.style.display=(mode==='create')?'none':'';
  if(title) title.textContent=(mode==='create')?t('fed.createTitle'):t('fed.title');
}

// Kézi menetlevél-készítés (Admin/Manager): üres modal + sofőr-választó.
function openFuvCreate(){
  feApplyMode('create');
  document.getElementById('feId').value='';
  var em=document.getElementById('feEmailSofer'); if(em) em.value='';
  document.getElementById('feSeria').textContent=t('fed.autoSerial');
  ['feNumeSofer','feNumarFisa','feCamion','feRemorca','feMentiuni','feOrderIds'].forEach(function(idn){var e=document.getElementById(idn);if(e)e.value='';});
  ['feKmInc','feKmSf','feDiurnaEx','feDiurnaIn','feCantInc','feCantSf','feTotalPret'].forEach(function(idn){var e=document.getElementById(idn);if(e)e.value='';});
  ['feDataCompletare','feIndulasDate','feErkezesDate'].forEach(function(idn){var e=document.getElementById(idn);if(e)e.value='';});
  document.getElementById('fePuncte').innerHTML='';
  document.getElementById('feAlim').innerHTML='';
  document.getElementById('feAch').innerHTML='';
  // Sofőr-választó feltöltése a cég belső sofőrjeiből.
  var sel=document.getElementById('feDriverPick');
  if(sel){
    sel.innerHTML='<option value="">'+feEsc(t('fed.pickDriverNone'))+'</option>';
    gas('getInternalDrivers').then(function(list){
      (list||[]).forEach(function(dv){
        var o=document.createElement('option');
        o.value=dv.email||''; o.textContent=dv.nume||dv.email||'—';
        o.setAttribute('data-nume',dv.nume||'');
        sel.appendChild(o);
      });
    }).catch(function(){});
  }
  document.getElementById('fuvEditModal').classList.add('open');
  feSetStaticSg();
  gas('getFuvarlevelFieldSuggestions').then(function(sg){ feSgInit(sg||{}); }).catch(function(){});
}

// Sofőr kiválasztva a legördülőből → kitölti a nevet + tárolja az e-mailt
// (a szerver ehhez a cég-felhasználóhoz köti a menetlevelet). Üresre állítva
// a kézi név marad érvényben (a létrehozó e-mailje lesz a tenant-horgony).
function feDriverPicked(){
  var sel=document.getElementById('feDriverPick'); if(!sel) return;
  var opt=sel.options[sel.selectedIndex];
  var em=document.getElementById('feEmailSofer');
  if(sel.value){
    if(em) em.value=sel.value;
    var nm=opt?opt.getAttribute('data-nume'):'';
    if(nm) document.getElementById('feNumeSofer').value=nm;
  } else {
    if(em) em.value='';
  }
}

function openFuvEdit(id){
  gas('getFuvarlevelDetail',[id]).then(function(r){
    if(!r||!r.ok){toast(r&&r.err||t('cs.cannotLoad'),'err');return;}
    var f=r.fuv;
    feApplyMode('edit');
    document.getElementById('feId').value=f.id;
    var feTp=document.getElementById('feTotalPret'); if(feTp) feTp.value=(f.total_pret!=null&&Number(f.total_pret)!==0)?f.total_pret:'';
    document.getElementById('feSeria').textContent=f.numar_fisa||t('cs.noSerial');
    document.getElementById('feNumeSofer').value=f.nume_sofer||'';
    document.getElementById('feNumarFisa').value=f.numar_fisa||'';
    document.getElementById('feCamion').value=f.numar_camion||'';
    document.getElementById('feRemorca').value=f.numar_remorca||'';
    document.getElementById('feKmInc').value=f.km_inceput||0;
    document.getElementById('feKmSf').value=f.km_sfarsit||0;
    document.getElementById('feDiurnaEx').value=f.diurna_externa||0;
    document.getElementById('feDiurnaIn').value=f.diurna_interna||0;
    document.getElementById('feCantInc').value=f.cant_inceput||0;
    document.getElementById('feCantSf').value=f.cant_sfarsit||0;
    document.getElementById('feMentiuni').value=f.alte_mentiuni||'';
    var feDt=document.getElementById('feDataCompletare'); if(feDt) feDt.value=feToLocalDtInput(f.data_completare);
    var feOi=document.getElementById('feOrderIds'); if(feOi) feOi.value=Array.isArray(f.order_ids)?f.order_ids.join(', '):'';
    var feIn=document.getElementById('feIndulasDate'); if(feIn) feIn.value=feToDateInput(f.indulas_dt);
    var feEr=document.getElementById('feErkezesDate'); if(feEr) feEr.value=feToDateInput(f.erkezes_dt);
    var puncte=Array.isArray(f.puncte)?f.puncte:[];
    var alim=Array.isArray(f.alimentari)?f.alimentari:[];
    var ach=Array.isArray(f.achizitii)?f.achizitii:[];
    document.getElementById('fePuncte').innerHTML=puncte.length?puncte.map(feRowPunct).join(''):'';
    document.getElementById('feAlim').innerHTML=alim.length?alim.map(feRowAlim).join(''):'';
    document.getElementById('feAch').innerHTML=ach.length?ach.map(feRowAch).join(''):'';
    document.getElementById('fuvEditModal').classList.add('open');
    // Mező-autocomplete: a korábban beírt értékek felkínálása gépelés közben.
    feSetStaticSg();
    gas('getFuvarlevelFieldSuggestions').then(function(sg){ feSgInit(sg||{}); }).catch(function(){});
  });
}

// ===== Menetlevél-szerkesztő mező-autocomplete (korábban beírt értékek) =====
// A cég eddigi menetleveleibe ugyanabba a mezőbe már beírt értékeket kínálja
// fel gépelés közben (Admin/Manager). Megosztott, body-hoz fűzött legördülő +
// a szerkesztő-modálra delegált input/focus kezelés (a dinamikusan hozzáadott
// sorok is automatikusan kapnak javaslatot a `data-sg` attribútumon át).
var _feSg = {};        // kulcs -> [értékek]
var _feSgDD = null;    // megosztott legördülő
var _feSgEl = null;    // aktuális mező

function feSetStaticSg(){
  var map={feNumeSofer:'nume_sofer',feCamion:'numar_camion',feRemorca:'numar_remorca',feMentiuni:'alte_mentiuni'};
  Object.keys(map).forEach(function(idn){ var el=document.getElementById(idn); if(el) el.setAttribute('data-sg',map[idn]); });
}

function feSgEnsureDD(){
  if(_feSgDD) return _feSgDD;
  _feSgDD=document.createElement('div');
  _feSgDD.id='feSgDD';
  _feSgDD.style.cssText='position:fixed;z-index:100000;display:none;max-height:240px;overflow:auto;'
    +'border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);font-size:13px;padding:4px;';
  document.body.appendChild(_feSgDD);
  window.addEventListener('scroll', feSgClose, true);
  window.addEventListener('resize', feSgClose);
  document.addEventListener('mousedown', function(e){
    if(!_feSgDD || _feSgDD.style.display==='none') return;
    if(e.target===_feSgEl || _feSgDD.contains(e.target)) return;
    feSgClose();
  });
  return _feSgDD;
}
function feSgClose(){ if(_feSgDD){ _feSgDD.style.display='none'; _feSgDD.innerHTML=''; } _feSgEl=null; }

function feSgTheme(){
  var mc=document.querySelector('.main-content');
  var dark=!mc || mc.getAttribute('data-theme')!=='light';
  return dark ? {bg:'#141c25',bd:'#2a3645',tx:'#e9eef5',hv:'#1f2a36'}
              : {bg:'#ffffff',bd:'#cbd5e1',tx:'#0f172a',hv:'#eef2ff'};
}

function feSgRender(el){
  var key=el.getAttribute('data-sg'); if(!key){ feSgClose(); return; }
  var list=_feSg[key]||[]; if(!list.length){ feSgClose(); return; }
  var q=(el.value||'').trim().toLowerCase();
  var matches=(q?list.filter(function(v){return String(v).toLowerCase().indexOf(q)>=0;}):list.slice())
    .filter(function(v){return String(v).toLowerCase()!==q;});
  if(!matches.length){ feSgClose(); return; }
  matches=matches.slice(0,12);
  var th=feSgTheme(), dd=feSgEnsureDD();
  dd.style.background=th.bg; dd.style.border='1px solid '+th.bd; dd.style.color=th.tx;
  dd.innerHTML=matches.map(function(v){
    return '<div class="fe-sg-item" data-v="'+feEsc(v)+'" style="padding:6px 9px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+feEsc(v)+'</div>';
  }).join('');
  Array.prototype.forEach.call(dd.querySelectorAll('.fe-sg-item'),function(it){
    it.addEventListener('mouseenter',function(){ it.style.background=th.hv; });
    it.addEventListener('mouseleave',function(){ it.style.background=''; });
    it.addEventListener('mousedown',function(e){ e.preventDefault();
      el.value=it.getAttribute('data-v');
      try{ el.dispatchEvent(new Event('input',{bubbles:true})); }catch(_){}
      feSgClose(); try{ el.focus(); }catch(_){}
    });
  });
  var r=el.getBoundingClientRect();
  dd.style.left=Math.round(r.left)+'px';
  dd.style.top=Math.round(r.bottom+2)+'px';
  dd.style.minWidth=Math.max(160,Math.round(r.width))+'px';
  dd.style.maxWidth=Math.max(240,Math.round(r.width))+'px';
  dd.style.display='block';
  _feSgEl=el;
}

function feSgInit(suggest){
  _feSg=suggest||{};
  var modal=document.getElementById('fuvEditModal');
  if(!modal || modal._feSgBound) return;   // a delegált kötés egyszer
  modal._feSgBound=true;
  modal.addEventListener('input', function(e){ var el=e.target; if(el&&el.getAttribute&&el.getAttribute('data-sg')) feSgRender(el); });
  modal.addEventListener('focusin', function(e){ var el=e.target; if(el&&el.getAttribute&&el.getAttribute('data-sg')) feSgRender(el); });
  modal.addEventListener('keydown', function(e){ if(e.key==='Escape') feSgClose(); });
}

function saveFuvEdit(){
  var id=document.getElementById('feId').value;
  var puncte=[].map.call(document.querySelectorAll('#fePuncte .fe-row'),function(r){return {tip:r.querySelector('.fe-p-tip').value,loc:r.querySelector('.fe-p-loc').value,data:r.querySelector('.fe-p-data').value};});
  var alimentari=[].map.call(document.querySelectorAll('#feAlim .fe-row'),function(r){return {loc:r.querySelector('.fe-a-loc').value,tip:r.querySelector('.fe-a-tip').value,litru:parseFloat(r.querySelector('.fe-a-lit').value)||0,km:parseFloat(r.querySelector('.fe-a-km').value)||0,plata:r.querySelector('.fe-a-plata').value,suma:parseFloat(r.querySelector('.fe-a-suma').value)||0};});
  var achizitii=[].map.call(document.querySelectorAll('#feAch .fe-row'),function(r){return {loc:r.querySelector('.fe-c-loc').value,produs:r.querySelector('.fe-c-prod').value,pret:parseFloat(r.querySelector('.fe-c-pret').value)||0,plata:r.querySelector('.fe-c-plata').value};});
  var payload={
    nume_sofer:document.getElementById('feNumeSofer').value,
    numar_fisa:document.getElementById('feNumarFisa').value,
    numar_camion:document.getElementById('feCamion').value,
    numar_remorca:document.getElementById('feRemorca').value,
    km_inceput:document.getElementById('feKmInc').value,
    km_sfarsit:document.getElementById('feKmSf').value,
    diurna_externa:document.getElementById('feDiurnaEx').value,
    diurna_interna:document.getElementById('feDiurnaIn').value,
    cant_inceput:document.getElementById('feCantInc').value,
    cant_sfarsit:document.getElementById('feCantSf').value,
    alte_mentiuni:document.getElementById('feMentiuni').value,
    total_pret:(document.getElementById('feTotalPret')||{}).value||null,
    data_completare:(document.getElementById('feDataCompletare')||{}).value||null,
    order_ids:(((document.getElementById('feOrderIds')||{}).value)||'').split(',').map(function(s){return s.trim();}).filter(Boolean),
    indulas_date:(document.getElementById('feIndulasDate')||{}).value||null,
    erkezes_date:(document.getElementById('feErkezesDate')||{}).value||null,
    puncte:puncte, alimentari:alimentari, achizitii:achizitii
  };
  if(_fuvMode==='create'){
    if(!String(payload.nume_sofer||'').trim()){ toast(t('fed.driverRequired'),'err'); return; }
    payload.email_sofer=(document.getElementById('feEmailSofer')||{}).value||'';
    gas('fuvarlevelCreate',[payload]).then(function(r){
      if(r&&r.ok){toast(t('fed.created'),'ok');closeFuvEdit();loadReceivedFuvarlevelek();}
      else toast(r&&r.err||'Eroare de server','err');
    });
    return;
  }
  gas('fuvarlevelUpdate',[id,payload]).then(function(r){
    if(r&&r.ok){toast(t('cs.waybillSaved'),'ok');closeFuvEdit();loadReceivedFuvarlevelek();}
    else toast(r&&r.err||'Szerver hiba','err');
  });
}


function loadVehicles(){
  gas('vehicleList').then(list=>{
    if(!Array.isArray(list))list=[];
    vehicleCache=list;
    var vontatok=list.filter(v=>v.tip==='Vontato');
    var potkocsik=list.filter(v=>v.tip==='Potkocsi');
    renderVehicleTable('tblVontato',vontatok);
    renderVehicleTable('tblPotkocsi',potkocsik);
    var band=document.getElementById('vehiclesMetricBand');
    if(band && typeof vsMetricBand==='function'){
      band.innerHTML=vsMetricBand([
        { l:t('veh.bandTotal'), v:list.length, sub:t('veh.tractors')+': '+vontatok.length },
        { l:t('veh.tractors'), v:vontatok.length, sub:'' },
        { l:t('veh.trailers'), v:potkocsik.length, sub:'' }
      ]);
    }
  }).catch(function(e){ console.error('loadVehicles hiba:', e); toast(t('common.loadError'),'err'); });
}

function logout(){gas('authLogout').then(function(){window.location.href='/login';}).catch(function(){window.location.href='/login';});}

function oeToggleSoferType() {
  var t = document.getElementById('oeSoferType').value;
  document.getElementById('oeInternWrap').style.display = t === 'Intern' ? '' : 'none';
  document.getElementById('oeExternWrap').style.display = t === 'Extern' ? '' : 'none';
  document.getElementById('oeExternFirmaWrap').style.display = t === 'Extern' ? '' : 'none';
  // Ha nem Extern, ürítsük az alvállalkozói mezőket — különben a mentés a
  // korábbi (rejtett) értéket írná a nume_sofer/firma_extern oszlopba.
  if (t !== 'Extern') {
    var _n = document.getElementById('oeNumeSoferExtern'); if (_n) _n.value = '';
    var _f = document.getElementById('oeFirmaExtern'); if (_f) _f.value = '';
  }
}

function onSoferTypeChange(type){document.getElementById('oInternBlock').style.display=type==='Intern'?'block':'none';document.getElementById('oExternBlock').style.display=type==='Extern'?'block':'none';}

// ── Sofőr↔jármű auto-párosítás a fuvar-kiíró űrlapon ──
// (vehicles.assigned_driver_email — a Belső sofőrök fülön rögzített pár.)
// Csak ÜRES mezőt tölt ki, látható és szabadon átírható.
function orderFormPairFromVehicle(){
  const plate=document.getElementById('oCamionSelect').value;if(!plate)return;
  const v=camionCache.find(x=>x.rendszam===plate);
  if(!v)return;
  // pótkocsi auto-kitöltés a vontató alapértelmezett pótkocsijából (csak üres mezőbe)
  const remSel=document.getElementById('oRemorcaSelect');
  if(remSel&&!remSel.value&&v.default_trailer_id){
    const tr=remorcaCache.find(x=>String(x.id)===String(v.default_trailer_id));
    if(tr){const ropt=[...remSel.options].find(o=>o.value===tr.rendszam);
      if(ropt){remSel.value=tr.rendszam;toast(t('cs.pairedTrailer')+tr.rendszam+t('cs.oe.modifiable'),'ok');}}
  }
  // sofőr auto-kitöltés a vontatóhoz rendelt belső sofőrből
  if(!v.assigned_driver_email)return;
  const st=document.querySelector('input[name="oSoferType"]:checked');
  if(st&&st.value==='Extern')return;
  const drvSel=document.getElementById('oInternDriver');
  if(!drvSel||drvSel.value)return;
  const email=String(v.assigned_driver_email).toLowerCase();
  const opt=[...drvSel.options].find(o=>o.value.toLowerCase()===email);
  if(!opt)return;
  document.querySelectorAll('input[name="oSoferType"]').forEach(r=>{r.checked=(r.value==='Intern');});
  onSoferTypeChange('Intern');
  drvSel.value=opt.value;
  toast(t('cs.pairedDriver')+opt.text.split(' (')[0]+' (módosítható)','ok');
}
function orderFormPairFromDriver(){
  const drvSel=document.getElementById('oInternDriver');
  const email=String(drvSel&&drvSel.value||'').toLowerCase();if(!email)return;
  const camSel=document.getElementById('oCamionSelect');
  if(!camSel||camSel.value)return;
  const v=camionCache.find(x=>String(x.assigned_driver_email||'').toLowerCase()===email);
  if(!v)return;
  const opt=[...camSel.options].find(o=>o.value===v.rendszam);
  if(!opt)return;
  camSel.value=v.rendszam;
  toast(t('cs.pairedVehicle')+v.rendszam+' (módosítható)','ok');
}

function openBugReport(){
  document.getElementById('bugText').value='';
  document.getElementById('bugModal').classList.add('open');
  setTimeout(function(){document.getElementById('bugText').focus();},150);
}

function openChatRoom(roomId){
  try{sessionStorage.setItem('vs_admin_chat_room',roomId);}catch(e){}
  if(!_fbDb||!_meChat)return;
  if(_chatUnsubscribe){_chatUnsubscribe();_chatUnsubscribe=null;}
  _chatCurrentRoom=roomId;

  var meta=_roomsSnapData[roomId]||{};
  var label=chatGetLabel(roomId,meta,_meChat);
  var hn=document.getElementById('chatHeadName');
  var hs=document.getElementById('chatHeadSub');
  var ha=document.getElementById('chatHeadAv');
  if(hn)hn.textContent=label;
  if(hs)hs.textContent=meta.lastFrom?'Utolsó: '+meta.lastFrom+'':(meta.participants?meta.participants.join(', '):'');
  if(ha)ha.textContent=(label.replace(/[^a-zA-Z\u00C0-\u024F]/g,'')||'?').charAt(0).toUpperCase();

  var msgsEl=document.getElementById('chatMsgs');
  if(msgsEl)msgsEl.innerHTML='<div style="text-align:center;color:var(--muted);font-size:12px;padding:20px;">'+t('fe.loading')+'</div>';

  var ref=_fbDb.ref('chats/'+_chatCompanyId+'/rooms/'+roomId+'/messages');
  var query=ref.orderByChild('ts').limitToLast(100);
  var listener=query.on('value',function(snap){
    if(!msgsEl)return;
    msgsEl.innerHTML='';
    snap.forEach(function(child){
      var msg=child.val();
      var isMine=(msg.fromEmail===(_meChat.email||''));
      var bubble=document.createElement('div');
      bubble.className='bubble '+(isMine?'me':'other');
      var ts=msg.ts?new Date(msg.ts).toLocaleTimeString('hu-HU',{hour:'2-digit',minute:'2-digit'}):'';
      bubble.innerHTML=(!isMine
        ?'<div style="font-size:10px;font-weight:700;margin-bottom:3px;opacity:.7;">'+escHtml(msg.fromName||'')+' <span style="opacity:.5;font-weight:400;">'+escHtml(msg.fromRole||'')+'</span></div>'
        :'')
        +'<div>'+escHtml(msg.text||'')+'</div>'
        +'<div style="font-size:10px;opacity:.5;text-align:right;margin-top:4px;">'+ts+'</div>';
      msgsEl.appendChild(bubble);
    });
    msgsEl.scrollTop=msgsEl.scrollHeight;
  });
  _chatUnsubscribe=function(){query.off('value',listener);};
  renderAdminRoomList(_meChat);
}


function openDocModal(orderId){
  currentDocOrderId = orderId;
  document.getElementById('docModalOrderId').textContent = orderId;
  document.getElementById('docUploadInput').value = '';
  document.getElementById('docModal').classList.add('open');
  loadDocList(orderId);
}

function openQuickVehicle(tip) {
  document.getElementById('qvTip').value = tip;
  document.getElementById('quickVehicleTitle').textContent = tip === 'Vontato' ? t('cs.newTractor') : t('cs.newTrailer');
  document.getElementById('qvRendszam').value = '';
  document.getElementById('qvMarca').value = '';
  document.getElementById('qvModel').value = '';
  document.getElementById('qvAn').value = '';
  document.getElementById('qvNota').value = '';
  document.getElementById('quickVehicleModal').classList.add('open');
}

function quickStatusChange(id, sel) {
  var newStatus = sel.value;
  var sc = newStatus==='Alocat'||newStatus==='Extern'?'warn':
           newStatus==='In Curs'||newStatus==='Finalizat'?'ok':
           newStatus==='Anulat'?'err':
           newStatus==='Parkolt'?'park':
           newStatus==='Raktarban'?'wh':'info';
  var bgMap = {
    'info': 'background:rgba(59,130,246,0.18);color:#2563eb;border-color:rgba(59,130,246,0.4);',
    'warn': 'background:rgba(245,158,11,0.18);color:#d97706;border-color:rgba(245,158,11,0.45);',
    'ok':   'background:rgba(34,197,94,0.18);color:#16a34a;border-color:rgba(34,197,94,0.4);',
    'err':  'background:rgba(239,68,68,0.18);color:#dc2626;border-color:rgba(239,68,68,0.4);',
    'park': 'background:rgba(20,184,166,0.18);color:#0f766e;border-color:rgba(20,184,166,0.4);',
    'wh':   'background:rgba(249,115,22,0.18);color:#c2410c;border-color:rgba(249,115,22,0.45);'
  };
  var base = 'cursor:pointer;font-size:11px;font-weight:700;border-radius:8px;padding:4px 20px 4px 8px;border:1px solid;appearance:auto;-webkit-appearance:auto;outline:none;min-width:80px;';
  sel.style.cssText = base + (bgMap[sc]||bgMap['info']);
  fetch('/api/orders/' + encodeURIComponent(id) + '/quick-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if (d.ok) {
      toast(t('cs.statusPrefix') + newStatus, 'ok');
      var idx = -1;
      _ordersAllCache.forEach(function(c,i){ if(String(c.id)===String(id)) idx=i; });
      if (idx !== -1) _ordersAllCache[idx].status = newStatus;
    } else {
      toast(d.err || t('common.error'), 'err');
      loadOrders();
    }
  }).catch(function(){ toast(t('common.connError'), 'err'); loadOrders(); });
}

// ── Anulare (lágy törlés) i18n-kulcsok regisztrálása (RO-alap + HU) ──
// Az i18n.js DICT-jét futásidőben bővítjük, hogy ne kelljen másik fájlt módosítani.
(function(){
  try {
    if (window.I18N && window.I18N.dict) {
      var D = window.I18N.dict;
      if (!D['cs.ol.mCancel'])           D['cs.ol.mCancel']           = { hu: 'Törlés (Anulat)', ro: 'Anulare' };
      if (!D['cs.ol.cancelOrderTitle'])  D['cs.ol.cancelOrderTitle']  = { hu: 'Fuvar törlése (Anulat státusz)', ro: 'Anulează transportul (status Anulat)' };
      if (!D['cs.ol.cancelledLocked'])   D['cs.ol.cancelledLocked']   = { hu: 'Anulált fuvar — nem szerkeszthető', ro: 'Transport anulat — nu poate fi modificat' };
      if (!D['cs.cf.cancelOrder'])       D['cs.cf.cancelOrder']       = { hu: 'Biztosan törlöd (Anulat) ezt a fuvart? Látható marad, de nem szerkeszthető tovább.', ro: 'Sigur anulezi acest transport? Rămâne vizibil, dar nu mai poate fi modificat.' };
    }
  } catch(e) {}
})();

// Lágy törlés: a fuvart 'Anulat'-ra állítja (comDelete). Nem fizikai törlés.
function cancelOrder(id){
  if (!confirm(t('cs.cf.cancelOrder'))) return;
  gas('comDelete', [String(id)]).then(function(r){
    if (r && r.ok) {
      toast(r.err || t('common.deleted'), 'ok');   // r.err itt csak „deja anulat" info lehet
      if (typeof loadOrders === 'function') loadOrders();
    } else {
      toast((r && r.err) || t('common.error'), 'err');
    }
  }).catch(function(){ toast(t('common.connError'), 'err'); });
}

function renderAdminRoomList(me){
  var listEl=document.getElementById('chatRoomList');
  if(!listEl)return;
  var keys=Object.keys(_roomsSnapData);
  // Csak azok a szobák ahol én érintett vagyok (email megjelenik a room id-ban)
  var myEsc=(me.email||'').toLowerCase().replace(/@/g,'__').replace(/\./g,'_d_');
  var myRooms=keys.filter(function(k){
    return k.indexOf(myEsc)!==-1||k==='manager'||k==='admin_manager';
  });
  myRooms.sort(function(a,b){
    return((_roomsSnapData[b]||{}).lastTime||0)-((_roomsSnapData[a]||{}).lastTime||0);
  });
  if(!myRooms.length){
    listEl.innerHTML='<div style="padding:16px 12px;font-size:12px;color:var(--muted);">'+t('cs.noChat')+'</div>';
    return;
  }
  listEl.innerHTML=myRooms.map(function(rId){
    var meta=_roomsSnapData[rId]||{};
    var label=chatGetLabel(rId,meta,me);
    var last=meta.lastMsg?'<div class="lst">'+escHtml(meta.lastMsg.substring(0,42))+'</div>':'';
    var av=(label.replace(/[^a-zA-Z\u00C0-\u024F]/g,'')||'?').charAt(0).toUpperCase();
    var active=(_chatCurrentRoom===rId)?'background:rgba(255,255,255,0.06);border-left:2px solid #3b82f6;':'';
    var ts=meta.lastTime?new Date(meta.lastTime).toLocaleTimeString('hu-HU',{hour:'2-digit',minute:'2-digit'}):'';
    return '<div class="contact" onclick="openChatRoom(\''+rId+'\')" style="'+active+'position:relative;">'
      +'<div class="av">'+av+'</div>'
      +'<div class="meta"><div class="nm">'+escHtml(label)+'</div>'+last+'</div>'
      +(ts?'<div style="font-size:10px;color:var(--muted);position:absolute;right:10px;top:14px;">'+ts+'</div>':'')
      +'</div>';
  }).join('');
}

function renderCamions(list, carrierVehs){
  var sel=document.getElementById('oCamionSelect'); if(!sel) return;
  var ownHtml = list.length
    ? '<optgroup label="'+t('cs.ownVehicles')+'">'+list.map(v=>'<option value="'+esc(v.rendszam)+'">'+esc(v.rendszam)+(v.marca?' — '+esc(v.marca):'')+(v.model?' '+esc(v.model):'')+' </option>').join('')+'</optgroup>'
    : '';
  var cvGroups = {};
  (carrierVehs||[]).forEach(function(cv){ var k=cv.carrier_nev||'Alvállalkozó'; if(!cvGroups[k])cvGroups[k]=[]; cvGroups[k].push(cv); });
  var cvHtml = Object.keys(cvGroups).sort().map(function(nev){
    return '<optgroup label="🚚 '+esc(nev)+'">'+cvGroups[nev].map(function(cv){
      return '<option value="'+esc(cv.rendszam_camion)+'">'+esc(cv.rendszam_camion)+(cv.marca?' — '+esc(cv.marca):'')+(cv.sofer_nev?' 👤'+esc(cv.sofer_nev):'')+' ('+esc(nev)+')</option>';
    }).join('')+'</optgroup>';
  }).join('');
  sel.innerHTML='<option value="">'+t('cs.notSetDash')+'</option>'+ownHtml+cvHtml;
}

function renderDocGroups() {
  var container = document.getElementById('docGroupsContainer');
  if (!container) return;
  var filterSofer = (document.getElementById('docFilterSofer')||{}).value||'';
  var filterTip   = (document.getElementById('docFilterTip')||{}).value||'';
  var list = _driverDocsCache.filter(function(d) {
    if (filterSofer && (d.nume_sofer||d.email_sofer) !== filterSofer) return false;
    if (filterTip   && d.tip !== filterTip) return false;
    return true;
  });
  if (!list.length) { container.innerHTML='<div style="text-align:center;color:var(--muted);padding:40px;">'+t('cs.noMatch')+'</div>'; return; }
  var groups = {};
  list.forEach(function(d) {
    var nev = d.nume_sofer||d.email_sofer||'—';
    var nap = d.created_at ? new Date(d.created_at).toLocaleDateString('hu-HU') : '—';
    var key = nev+'||'+nap;
    if (!groups[key]) groups[key] = {nev:nev, nap:nap, docs:[]};
    groups[key].docs.push(d);
  });
  var html = '';
  Object.values(groups).forEach(function(g) {
    html += '<div style="margin-bottom:24px;">';
    html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 0 8px;border-bottom:1px solid var(--border);margin-bottom:12px;">';
    html += '<span style="font-size:15px;font-weight:700;color:var(--text-primary);">👤 '+esc(g.nev)+'</span>';
    html += '<span style="font-size:12px;color:var(--muted);background:var(--bg-3);padding:3px 10px;border-radius:20px;border:1px solid var(--border);">📅 '+g.nap+'</span>';
    html += '<span style="font-size:12px;color:var(--muted);">'+g.docs.length+t('cs.files')+'</span>';
    html += '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;">';
    g.docs.forEach(function(d) {
      var bc = d.tip==='CMR'?'ok':d.tip==='Számla'?'info':'warn';
      var time = d.created_at ? new Date(d.created_at).toLocaleTimeString('hu-HU',{hour:'2-digit',minute:'2-digit'}) : '';
      html += '<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:14px;">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;"><span class="badge '+bc+'">'+esc(d.tip||t('cs.other'))+'</span>'
        +(d.order_id?'<span class="badge info" title="'+t('cs.tt.linkedToOrder')+'">🔗 '+esc(d.order_id)+'</span>':'')
        +'<span style="font-size:11px;color:var(--muted);">'+time+'</span></div>';
      html += '<div style="font-size:12px;color:var(--soft);margin-bottom:10px;word-break:break-all;">'+esc(d.file_name||'—')+'</div>';
      html += '<div style="display:flex;gap:6px;">';
      html += '<a href="/api/doc-download/'+d.id+'" target="_blank" class="btn primary" style="flex:1;text-align:center;text-decoration:none;padding:8px 6px;font-size:12px;">'+t('cs.view')+'</a>';
      html += '<a href="/api/doc-download/'+d.id+'" download class="btn ghost" style="flex:1;text-align:center;text-decoration:none;padding:8px 6px;font-size:12px;">'+t('cs.download')+'</a>';
      html += '</div></div>';
    });
    html += '</div></div>';
  });
  container.innerHTML = html;
}

function renderExternDrivers(list){const sel=document.getElementById('oExternSelect');if(!sel)return;sel.innerHTML='<option value="">'+t('cs.manualDriver')+'</option>'+list.map(d=>`<option value="${esc(d.id)}">${esc(d.nume||'')} ${d.firma?'/ '+esc(d.firma):''}</option>`).join('');}

function renderInternDrivers(list){const sel=document.getElementById('oInternDriver');if(!sel)return;sel.innerHTML='<option value="">'+t('cs.pickDriverDash')+'</option>'+list.map(u=>`<option value="${esc(u.email)}">${esc(u.nume)} (${esc(u.email)})</option>`).join('');}

function renderRemorcas(list){const sel=document.getElementById('oRemorcaSelect');if(!sel)return;sel.innerHTML='<option value="">'+t('cs.notSetDash')+'</option>'+list.map(v=>`<option value="${esc(v.rendszam)}">${esc(v.rendszam)}${v.marca?' — '+esc(v.marca):''}${v.model?' '+esc(v.model):''}</option>`).join('');}


function renderVehicleTable(tableId,list){
  const tb=document.querySelector('#'+tableId+' tbody');
  if(!list||list.length===0){tb.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--muted);">'+t('cs.noneAdded')+'</td></tr>';return;}
  tb.innerHTML=list.map(v=>`<tr><td><b>${esc(v.rendszam)}</b></td><td>${esc(v.marca||'—')}</td><td>${esc(v.model||'—')}</td><td>${v.an||'—'}</td><td>${esc(v.nota||'—')}</td><td><button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="EntityDetail.openVehicle(${v.id})">${t('ed.details')}</button> <button class="btn primary" style="padding:4px 10px;font-size:12px;" onclick="editVehicle(${v.id})">${t('cs.editShort')}</button> <button class="btn danger" style="padding:4px 10px;font-size:12px;" onclick="deleteVehicle(${v.id})">${t('cs.del')}</button></td></tr>`).join('');
}

function revokeInv(kod){
  if(!confirm(t('cs.revokeConfirm',{kod:kod})))return;
  gas('invRevoke',[kod]).then(r=>{if(r.ok){toast(t('cs.revoked'),'ok');loadInvites();}else{toast(r.err||t('common.error'),'err');}});
}

function saveAdminSigDraw(){var dataUrl=sigCanvas.toDataURL('image/png');gas('stampSave',[dataUrl]).then(()=>{toast(t('cs.sigSaved'),'ok');loadAdminSigPreview();});}

function saveAdminSigFile(){var fi=document.getElementById('sigFile');if(!fi.files.length)return;var fr=new FileReader();fr.onload=function(e){gas('stampSave',[e.target.result]).then(()=>{toast(t('cs.stampSaved'),'ok');loadAdminSigPreview();});};fr.readAsDataURL(fi.files[0]);}

function saveDocSeries() {
  var prefix = ((document.getElementById('docSeriesPrefix')||{}).value||'').trim();
  if (!prefix) { toast(t('cs.givePrefix'),'err'); return; }
  fetch('/api/document-series',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({docType:'MT',prefix:prefix})})
  .then(function(r){return r.json();}).then(function(d){
    if (d.ok) { toast(t('cs.seriesSaved')+prefix+'-'+new Date().getFullYear()+'-0001-től','ok'); loadDocSeries(); }
    else toast(d.err||'Hiba','err');
  });
}

function saveExtDriver(){
  const id=parseInt(document.getElementById('edEditId').value,10);
  const fields={nume:document.getElementById('edEditNume').value.trim(),firma:document.getElementById('edEditFirma').value.trim(),telefon:document.getElementById('edEditTelefon').value.trim(),email:document.getElementById('edEditEmail').value.trim(),rendszam_camion:document.getElementById('edEditCamion').value.trim(),rendszam_remorca:document.getElementById('edEditRemorca').value.trim(),nota:document.getElementById('edEditNota').value.trim()};
  if(!fields.nume&&!fields.firma){toast(t('cs.driverOrCompanyReq'),'err');return;}
  gas('extDriverUpdate',[id,fields]).then(r=>{if(r.ok){toast(t('common.saved'),'ok');closeExtDriverModal();loadExtDrivers();}else{toast(r.err||t('common.error'),'err');}});
}

function saveQuickVehicle() {
  const tip = document.getElementById('qvTip').value;
  const v = {
    tip: tip,
    rendszam: document.getElementById('qvRendszam').value.trim(),
    marca: document.getElementById('qvMarca').value.trim(),
    model: document.getElementById('qvModel').value.trim(),
    an: document.getElementById('qvAn').value,
    nota: document.getElementById('qvNota').value.trim(),
  };
  if (!v.rendszam) {
    toast(t('cs.plateReq'), 'err');
    return;
  }
  gas('vehicleCreate', [v]).then(r => {
    if (r.ok) {
      toast((tip === 'Vontato' ? t('cs.vtractor') : t('cs.vtrailer')) + t('cs.added'), 'ok');
      closeQuickVehicle();
      // frissitjuk a dropdown-t es automatikusan kivalasztjuk az ujat
      gas('vehicleList').then(list => {
        if (!Array.isArray(list)) list = [];
        camionCache = list.filter(x => x.tip === 'Vontato');
        remorcaCache = list.filter(x => x.tip === 'Potkocsi');
        renderCamions(camionCache);
        renderRemorcas(remorcaCache);
        // automatikusan kivalasztjuk az uj jarmuvet
        if (tip === 'Vontato') {
          const sel = document.getElementById('oCamionSelect');
          for (let i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === v.rendszam) {
              sel.selectedIndex = i;
              break;
            }
          }
        } else {
          const sel = document.getElementById('oRemorcaSelect');
          for (let i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === v.rendszam) {
              sel.selectedIndex = i;
              break;
            }
          }
        }
        // Jarművek oldalt is frissitjuk ha nyitva van
        if (vehicleCache.length > 0) loadVehicles();
      });
    } else {
      toast(r.err || t('common.error'), 'err');
    }
  });
}

function saveVehicle(){
  const id=parseInt(document.getElementById('vehEditId').value,10);
  var _vget=function(idv){var el=document.getElementById(idv);return el?el.value:'';};
  const fields={
    rendszam:document.getElementById('vehEditRendszam').value.trim(),
    marca:document.getElementById('vehEditMarca').value.trim(),
    model:document.getElementById('vehEditModel').value.trim(),
    an:document.getElementById('vehEditAn').value,
    nota:document.getElementById('vehEditNota').value.trim(),
    // Teherjármű paraméterek (útvonaltervezés) — a szerver parse-olja/null-ozza
    height_cm:_vget('vehEditHeight'),
    width_cm:_vget('vehEditWidth'),
    length_cm:_vget('vehEditLength'),
    weight_kg:_vget('vehEditWeight'),
    weight_per_axle_kg:_vget('vehEditAxleWeight'),
    axle_count:_vget('vehEditAxleCount'),
    trailer_count:_vget('vehEditTrailerCount'),
    truck_type:_vget('vehEditTruckType'),
    tunnel_category:_vget('vehEditTunnel'),
    hazardous_goods:_vget('vehEditHazmat'),
    fuel_per_100km:_vget('vehEditFuel'),
  };
  // Rakodási felület — csak pótkocsinál küldjük
  if(document.getElementById('vehEditTip').value==='Potkocsi'){
    fields.trailer_kind=_vget('vehEditTrailerKind');
    fields.cargo_length_cm=_vget('vehEditCargoLen');
    fields.cargo_width_cm=_vget('vehEditCargoWid');
    fields.cargo_height_cm=_vget('vehEditCargoHei');
  }
  if(!fields.rendszam){toast(t('cs.plateReq'),'err');return;}
  gas('vehicleUpdate',[id,fields]).then(r=>{if(r.ok){toast(t('common.saved'),'ok');closeVehicleModal();loadVehicles();}else{toast(r.err||t('common.error'),'err');}});
}

function settings2faConfirm() {
  var code = document.getElementById('setup2faCode').value.trim();
  if (!code || code.length !== 6) { toast(t('cs.give6digit'),'err'); return; }
  var btn = document.getElementById('btn2faConfirm');
  btn.disabled = true; btn.textContent = '...';
  fetch('/api/2fa/settings-verify', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ token: code })
  }).then(function(r){ return r.json(); }).then(function(d){
    btn.disabled = false; btn.textContent = t('cs.confirm');
    if (d.success) {
      document.getElementById('modal2faSetup').classList.remove('open');
      toast(t('cs.2faOn'),'ok');
      loadSettingsPane();
    } else {
      toast(d.message||t('cs.wrongCode'),'err');
    }
  });
}

function settings2faDisable(){
  var pwd = document.getElementById('st2faDisablePwd').value;
  if(!pwd){ toast(t('cs.givePassword'),'err'); return; }
  if(!confirm(t('cs.cf.disable2fa'))) return;
  gas('settings2faDisable',[{currentPwd:pwd}]).then(function(r){
    if(r&&r.ok){
      toast(t('cs.2faOff'),'ok');
      document.getElementById('st2faDisablePwd').value='';
      loadSettingsPane();
    } else {
      toast((r&&r.err)||'Hiba','err');
    }
  });
}

function settings2faStart() {
  document.getElementById('setup2faQrWrap').innerHTML = '<div class="spinner" style="margin:0 auto;"></div>';
  document.getElementById('setup2faCode').value = '';
  document.getElementById('modal2faSetup').classList.add('open');
  fetch('/api/2fa/settings-setup', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d.success) {
        document.getElementById('setup2faQrWrap').innerHTML =
          '<img src="'+d.qr+'" style="width:180px;height:180px;border-radius:8px;">';
      } else {
        document.getElementById('setup2faQrWrap').innerHTML =
          '<p style="color:var(--err);">'+( d.message||'Hiba')+'</p>';
      }
    });
}

function settingsChangePassword(){
  var cur  = document.getElementById('stPwdCurrent').value;
  var nw   = document.getElementById('stPwdNew').value;
  var nw2  = document.getElementById('stPwdNew2').value;
  if(!cur||!nw||!nw2){ toast(t('cs.allFieldsReq'),'err'); return; }
  if(nw!==nw2){ toast(t('cs.pwMismatch'),'err'); return; }
  if(nw.length<8 || !/[a-z]/.test(nw) || !/[A-Z]/.test(nw) || !/[0-9]/.test(nw) || !/[^A-Za-z0-9]/.test(nw)){ toast(t('cs.pwMin6'),'err'); return; }
  gas('settingsChangePassword',[{current:cur,newPwd:nw}]).then(function(r){
    if(r&&r.ok){
      toast(t('cs.pwChanged'),'ok');
      document.getElementById('stPwdCurrent').value='';
      document.getElementById('stPwdNew').value='';
      document.getElementById('stPwdNew2').value='';
    } else {
      toast((r&&r.err)||'Hiba','err');
    }
  });
}

function settingsSaveProfile(){
  var nume = document.getElementById('stNume').value.trim();
  var tel  = document.getElementById('stTel').value.trim();
  if(!nume){ toast(t('cs.nameReq'),'err'); return; }
  gas('settingsSaveProfile',[{nume:nume,tel:tel}]).then(function(r){
    if(r&&r.ok){
      toast(t('cs.profileSaved'),'ok');
      document.getElementById('meBadge').textContent = nume;
    } else {
      toast((r&&r.err)||t('common.error'),'err');
    }
  });
}


function signNextPage(){
  if(signCurrentPage<signTotalPages){ signCurrentPage++; renderSignPage(signCurrentPage); }
}

function signPrevPage(){
  if(signCurrentPage>1){ signCurrentPage--; renderSignPage(signCurrentPage); }
}

function startRoomListListener(me){
  if(!_fbDb)return;
  var ref=_fbDb.ref('chats/'+_chatCompanyId+'/rooms');
  // Korábbi listener leválasztása — újra-inicializálásnál (pl. újra-belépés
  // ugyanabban a fülben) ne halmozódjanak a Firebase listenerek.
  if(window._roomListRef){ try{ window._roomListRef.off('value'); }catch(_){} }
  window._roomListRef=ref;
  ref.on('value',function(snap){
    _roomsSnapData={};
    snap.forEach(function(child){
      _roomsSnapData[child.key]=child.val().meta||{};
    });
    renderAdminRoomList(me);
    // ── Chat szoba visszaállítás frissítés után ──
    if(window._restoreChatRoom){
      var rId=window._restoreChatRoom;
      window._restoreChatRoom=null;
      if(_roomsSnapData[rId]){setTimeout(function(){openChatRoom(rId);},200);}
    }
  });
}

function toast(m,k){var e=document.createElement('div');e.className='toast '+(k||'');e.textContent=m;document.getElementById('toasts').appendChild(e);setTimeout(function(){e.remove();},3000);}

// ============================================================
//  BEÉRKEZŐ FUVARKÉRÉS-FIGYELŐ — lebegő, oldalfüggetlen értesítő-sáv
//  Minden admin/manager fülön látszik, amíg van feldolgozatlan
//  beérkező megrendelés (portál-kérés + e-mail intake). Kattintásra a
//  „Megrendelések" fülre ugrik. Periodikus polling (45 mp).
//  Kétnyelvű (RO-alap + HU), témaérzékeny. Közös admin/manager kód.
// ============================================================
function _inboundEnsureStyle(){
  if(document.getElementById('inbound-watch-style')) return;
  var s=document.createElement('style'); s.id='inbound-watch-style';
  s.textContent=
    '#inboundAlert{position:fixed;right:18px;bottom:18px;z-index:4000;max-width:330px;'+
      'display:none;align-items:center;gap:10px;cursor:pointer;'+
      'background:var(--bg-panel-raised,#141c25);color:var(--text-primary,#e9eef5);'+
      'border:1px solid var(--status-warn,#f59e0b);border-left:5px solid var(--status-warn,#f59e0b);'+
      'border-radius:var(--radius-md,12px);padding:12px 14px;'+
      'box-shadow:0 10px 30px rgba(0,0,0,.35);font-size:13px;line-height:1.35;'+
      'animation:inboundPulse 2s ease-in-out infinite}'+
    '#inboundAlert .ia-ico{font-size:22px;flex:0 0 auto}'+
    '#inboundAlert .ia-txt{flex:1}'+
    '#inboundAlert .ia-cnt{font-weight:800;color:var(--status-warn,#f59e0b)}'+
    '#inboundAlert .ia-sub{font-size:11px;color:var(--text-muted,#8a97a8);margin-top:2px}'+
    '.main-content[data-theme="light"] #inboundAlert{background:#fff;color:#1f2d3d}'+
    '@keyframes inboundPulse{0%,100%{box-shadow:0 10px 30px rgba(0,0,0,.35)}'+
      '50%{box-shadow:0 0 0 4px rgba(245,158,11,.25),0 10px 30px rgba(0,0,0,.35)}}'+
    '.sidebar [data-tab="inbound"] .ia-badge{display:inline-block;min-width:18px;'+
      'text-align:center;background:var(--status-danger,#ef4444);color:#fff;font-size:11px;'+
      'font-weight:800;border-radius:999px;padding:1px 6px;margin-left:6px}'+
    '@media(max-width:768px){#inboundAlert{bottom:74px;right:12px;left:12px;max-width:none}}';
  document.head.appendChild(s);
}
function _inboundEnsureBanner(){
  var el=document.getElementById('inboundAlert');
  if(el) return el;
  _inboundEnsureStyle();
  el=document.createElement('div');
  el.id='inboundAlert';
  el.setAttribute('role','button');
  el.title='Cereri / Megrendelések';
  el.innerHTML='<span class="ia-ico">🔔</span><div class="ia-txt"></div>';
  // Ha van ügyfél (portál) kérés, oda ugrunk; különben az e-mail Megrendelésekre.
  el.onclick=function(){
    var go=(window._inboundPortalCount>0)?'client-requests':'inbound';
    if(typeof activateTab==='function') activateTab(go);
  };
  document.body.appendChild(el);
  return el;
}
function _inboundSetBadge(tabKey, n){
  document.querySelectorAll('.sidebar [data-tab="'+tabKey+'"]').forEach(function(tab){
    var b=tab.querySelector('.ia-badge');
    if(n>0){
      if(!b){ b=document.createElement('span'); b.className='ia-badge'; tab.appendChild(b); }
      b.textContent=n;
    } else if(b){ b.remove(); }
  });
}
function _inboundUpdateUi(d){
  var count=d.count||0, portal=d.portal||0, email=Math.max(0,count-portal);
  window._inboundPortalCount=portal;
  var el=_inboundEnsureBanner();
  // Sidebar-badge-ek: az ügyfél-kérések a „client-requests", az e-mail intake az „inbound" fülön
  _inboundSetBadge('client-requests', portal);
  _inboundSetBadge('inbound', email);
  // Lebegő sáv (csak ha van feldolgozatlan)
  if(count>0){
    var roTxt = portal>0
      ? (portal+' cerere(ri) noi de la clienți')
      : (count+' comand(ă/ri) noi de procesat');
    var huTxt = portal>0
      ? (portal+' új ügyfél-kérés — click pentru procesare / kattints')
      : (count+' feldolgozatlan megrendelés — click / kattints');
    el.querySelector('.ia-txt').innerHTML=
      '<div><span class="ia-cnt">'+(portal>0?portal:count)+'</span> '+esc_(roTxt.replace(/^\d+\s/,''))+'</div>'+
      '<div class="ia-sub">'+esc_(huTxt)+'</div>';
    el.style.display='flex';
  } else {
    el.style.display='none';
  }
}
// Mini HTML-escape a sáv-szöveghez (XSS-védelem — bár fix szöveg, biztos ami biztos)
function esc_(s){return String(s==null?'':s).replace(/[&<>"]/g,function(m){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[m];});}
function refreshInboundCount(){
  // Csak admin/manager konzolon van értelme (a sidebar fül létezik)
  if(!document.querySelector('.sidebar [data-tab="inbound"]')) return;
  fetch('/api/inbound-orders/count',{credentials:'same-origin'})
    .then(function(r){ return r.ok?r.json():null; })
    .then(function(d){
      if(!d) return;
      var count=d.count||0;
      var prev=(typeof window._inboundPrevCount==='number')?window._inboundPrevCount:null;
      _inboundUpdateUi(d);
      // Ha NŐTT a szám (és nem az első betöltés) — rövid toast is jelez
      if(prev!==null && count>prev){
        toast('🔔 '+(count-prev)+' nouă cerere de transport / új fuvarkérés','');
      }
      window._inboundPrevCount=count;
    })
    .catch(function(){});
}
function startInboundWatcher(){
  if(window._inboundTimer) clearInterval(window._inboundTimer);
  refreshInboundCount();
  window._inboundTimer=setInterval(refreshInboundCount,45000);
}

function toggleAllOrders(cb) {
  document.querySelectorAll('.orderRowCb').forEach(function(c){ c.checked = cb.checked; });
  updateOrderSelBar();
}

function toggleOrdersMenu(){document.getElementById('ordersSubmenu').parentElement.classList.toggle('open');}
// Generikus lenyitó az ikonos FGO-menühöz: a kattintott fejléc .menu-group-ját nyitja/zárja.
function toggleGroup(el){
  var g = el.closest('.menu-group');
  if(!g) return;
  // Single-open accordion: a kattintott csoport nyitni fog-e
  var willOpen = !g.classList.contains('open');
  // Az összes többi nyitott csoport becsukása
  document.querySelectorAll('.sidebar .menu-group.open').forEach(function(o){ if(o!==g) o.classList.remove('open'); });
  // A kattintott csoport beállítása (második kattintás be is csukja)
  g.classList.toggle('open', willOpen);
}

function toggleSidebar() {
  var sb = document.getElementById('mainSidebar');
  var ov = document.getElementById('sidebarOverlay');
  sb.classList.toggle('mob-open');
  ov.classList.toggle('open');
  document.body.style.overflow = sb.classList.contains('mob-open') ? 'hidden' : '';
}

function toggleUserMenu(){document.getElementById('userMenuGroup').classList.toggle('open');}

function updateDocSeriesPreview() {
  var p = (document.getElementById('docSeriesPrefix')||{}).value||'MT';
  var y = new Date().getFullYear();
  var el = document.getElementById('docSeriesPreview');
  if (el) el.textContent = t('cs.previewPrefix')+p+'-'+y+'-0001'+t('cs.seriesPreviewSuffix');
}

function updateOrderSelBar() {
  var checked = document.querySelectorAll('.orderRowCb:checked');
  var bar = document.getElementById('orderSelBar');
  var cnt = document.getElementById('orderSelCount');
  if (!bar) return;
  if (checked.length > 0) {
    bar.style.display = 'block';
    cnt.textContent = checked.length + ' fuvar kiválasztva';
  } else {
    bar.style.display = 'none';
    var sa = document.getElementById('selectAllOrders');
    if (sa) sa.checked = false;
  }
}

function uploadOrderDoc(){
  const file=document.getElementById('docUploadInput').files[0];
  if(!file){toast(t('cs.pickPdf'),'err');return;}
  if(!currentDocOrderId){toast(t('cs.noOrderSelected'),'err');return;}
  const reader=new FileReader();
  reader.onload=function(e){
    const b64=e.target.result;
    gas('orderDocUpload',[currentDocOrderId,file.name,b64]).then(r=>{
      if(r.ok){
        toast(t('common.uploaded'),'ok');
        currentDocId=r.docId;
        loadDocList(currentDocOrderId);
        openSignModal(r.docId,'original');
      }else{
        toast(r.err||t('cs.uploadError'),'err');
      }
    });
  };
  reader.readAsDataURL(file);
}

// ============================================================
//  VEZÉRLŐPULT REDESIGN — közös dashboard + téma (light/dark)
//  Mind az admin, mind a manager konzol ezt használja.
// ============================================================

/* ── Térkép-csempe URL (OpenStreetMap / CartoDB — ingyenes, NINCS HERE kulcs) ── */
// A vezérlőpult térképe nem használ HERE-t és nem hívja a /api/here-config-ot.
// HERE Maps csak a külön Útvonaltervező oldalon (utvonaltervezes.html) van.
function cartoTileUrl(theme) {
  // Minden térkép MINDIG világos csempével jelenik meg (kérésre) — a téma
  // (light/dark) nem befolyásolja a térkép-csempéket.
  return 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
}

/* ── Téma (light/dark) — a .main-content[data-theme] attribútumon ── */
function toggleTheme() {
  var mc = document.getElementById('mainContent');
  if (!mc) return;
  var next = (mc.getAttribute('data-theme') === 'light') ? 'dark' : 'light';
  mc.setAttribute('data-theme', next);
  try { localStorage.setItem('vs-theme', next); } catch (e) {}
  syncThemeToggleIcon();
  // Térkép-csempék cseréje a témához (CartoDB / OpenStreetMap)
  if (window._dashMap && window._dashTileLayer) {
    window._dashTileLayer.setUrl(cartoTileUrl(next));
  }
}

function syncThemeToggleIcon() {
  var mc = document.getElementById('mainContent');
  var btn = document.getElementById('themeToggle');
  if (!mc || !btn) return;
  var light = mc.getAttribute('data-theme') === 'light';
  btn.textContent = light ? '☀️' : '🌙';
  btn.title = light ? 'Sötét mód' : 'Világos mód';
}

/* ── A teljes vezérlőpult betöltése ── */
/* ══ Fázis 2 — interaktív KPI mutató-sáv (85/15, kattintásra cserél) ══
   Közös admin/manager komponens. metrics: [{l,v,sub?,t?,d?,s?}], opts:{tall?}.
   A 3 kis kocka árnyalata a fontossági sorrendet követi (VSMB_SHADES).
   t/s opcionális — ahol nincs valós trend/idősor, ott egyszerűen elmarad. */
var VSMB_SHADES = ['#ea580c', '#f97316', '#fb923c', '#fdba74'];
var _vsmb = [], _vsmbFeat = 0;
function vsHeroSpark(data) {
  if (!data || !data.length) return '';
  var n = data.length, mn = Math.min.apply(0, data), mx = Math.max.apply(0, data), rng = (mx - mn) || 1;
  var pts = data.map(function (v, i) { return [(i / (n - 1)) * 100, 58 - ((v - mn) / rng) * 42 - 6]; });
  var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
  return '<svg class="hspk" viewBox="0 0 100 64" preserveAspectRatio="none"><path d="' + line + ' L 100 64 L 0 64 Z" fill="#fff" fill-opacity=".22"/><path d="' + line + '" fill="none" stroke="#fff" stroke-width="2.5"/></svg>';
}
function vsBandInner() {
  var f = _vsmb[_vsmbFeat] || _vsmb[0] || {};
  var heroTrend = f.t ? '<span class="b">' + esc(f.t) + '</span> ' : '';
  // FONTOS: a `v` (érték) megbízható megjelenítő HTML-t tartalmazhat (pl. a Statisztika
  // a mértékegységet kis <span>-ban adja) — a hívók építik, sosem nyers user-input —,
  // ezért NEM escape-eljük (különben a <span> nyersként jelenne meg). A címke (`l`),
  // a sub és a trend escape-elt marad.
  var hero = '<div class="vsmb-hero" id="vsmbHero"><div class="l">' + esc(f.l || '') + '</div>'
    + '<div class="v">' + (f.v == null ? '—' : String(f.v)) + '</div>'
    + '<div class="sub">' + heroTrend + esc(f.sub || '') + '</div>' + vsHeroSpark(f.s) + '</div>';
  var minis = '<div class="vsmb-minis">' + _vsmb.map(function (m, i) {
    if (i === _vsmbFeat) return '';
    var tr = m.t ? '<span class="tr ' + (m.d || 'flat') + '">' + esc(m.t) + '</span>' : '';
    return '<div class="vsmb-mini" style="--ac:' + VSMB_SHADES[i % VSMB_SHADES.length] + '" onclick="vsBandPick(' + i + ')">'
      + '<div class="l">' + esc(m.l || '') + '</div><div class="row"><span class="v">' + (m.v == null ? '—' : String(m.v)) + '</span>' + tr + '</div></div>';
  }).join('') + '</div>';
  return hero + minis;
}
function vsMetricBand(metrics, opts) {
  _vsmb = metrics || []; _vsmbFeat = 0;
  var tall = (opts && opts.tall) ? ' tall' : '';
  return '<div class="vsmb' + tall + '" id="vsmbWrap">' + vsBandInner() + '</div>';
}
function vsBandPick(i) {
  _vsmbFeat = i;
  var w = document.getElementById('vsmbWrap'); if (!w) return;
  w.innerHTML = vsBandInner();
  var h = document.getElementById('vsmbHero'); if (h) { h.style.animation = 'none'; void h.offsetWidth; h.style.animation = ''; }
}

function loadDashboard() {
  // Cég neve + 4 KPI együtt — az interaktív mutató-sávba (vsMetricBand)
  Promise.all([gas('dashStats'), gas('userListAll'), gas('getFuvarlevelek')]).then(function (rs) {
    var r = rs[0] || {};
    var users = (rs[1] && rs[1].length) || 0;
    var fuv = (rs[2] && rs[2].length) || 0;
    var cn = document.getElementById('dashCegNev'); if (cn && r.ceg_nev) cn.textContent = r.ceg_nev;
    var total = (r.statuszok || []).reduce(function (s, x) { return s + x.db; }, 0);
    var aktiv = (r.statuszok || [])
      .filter(function (x) { return x.status === 'In Curs' || x.status === 'Alocat'; })
      .reduce(function (s, x) { return s + x.db; }, 0);
    var box = document.getElementById('dashMetricBand');
    if (box) box.innerHTML = vsMetricBand([
      { l: t('dash.kpiTotal'), v: total, sub: t('dash.kpiActive') + ': ' + aktiv },
      { l: t('dash.kpiActive'), v: aktiv, sub: 'In Curs / Alocat' },
      { l: t('dash.kpiUsers'), v: users, sub: t('nav.staff') || '' },
      { l: t('dash.kpiWaybills'), v: fuv, sub: '' }
    ]);
  });

  loadDashRecentOrders();
  loadDashVehicleSummary();
  // ⏰ Lejáró dokumentumok riasztás-sáv (fleet-extra.js)
  if (window.FleetExtra) FleetExtra.dashExpiryAlert();
  // 🔧 Esedékes szervizek riasztás-sáv (km-/dátum-alapú, fleet-extra.js)
  if (window.FleetExtra && FleetExtra.dashServiceAlert) FleetExtra.dashServiceAlert();
  syncThemeToggleIcon();
  initDashMap();
  refreshDashVehicles();
  if (window._dashVehTimer) clearInterval(window._dashVehTimer);
  // 60s kliens-polling + 30s szerver-cache: 300 felhasználónál is észszerű
  // GPS-szolgáltatói terhelés (korábban 30s, cache nélkül).
  window._dashVehTimer = setInterval(refreshDashVehicles, 60000);
}

/* ── Legutóbbi fuvarok ── */
// A DB román státuszokat tárol — magyar címke + szín-leképezés.
var DASH_STATUS_MAP = {
  'Finalizat':  { c: 'ok',   k: 'status.Finalizat' },
  'In Curs':    { c: 'warn', k: 'status.InCurs' },
  'Alocat':     { c: 'info', k: 'status.Alocat' },
  'Disponibil': { c: 'err',  k: 'status.Disponibil' },
  'Extern':     { c: 'info', k: 'status.Extern' },
  'Anulat':     { c: 'err',  k: 'status.Anulat' }
};
function loadDashRecentOrders() {
  var tb = document.getElementById('dashRecentOrdersBody');
  if (!tb) return;
  gas('getRecentOrders', [8]).then(function (r) {
    if (!r || !r.ok) {
      tb.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:18px;">' + t('dash.loadFail') + '</td></tr>';
      return;
    }
    var list = r.orders || [];
    if (!list.length) {
      tb.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:18px;">' + t('dash.noOrders') + '</td></tr>';
      return;
    }
    tb.innerHTML = list.map(function (o) {
      var drv = o.nume_sofer || o.driver_user_name || o.email_sofer || '—';
      var dest = o.loc_descarcare || '—';
      var sm = DASH_STATUS_MAP[o.status] || { c: 'info' };
      var smt = sm.k ? t(sm.k) : (o.status || '—');
      var dt = o.created_at ? new Date(o.created_at).toLocaleDateString('hu-HU') : '—';
      return '<tr>'
        + '<td><b class="text-primary">' + esc(String(o.id)) + '</b></td>'
        + '<td>' + esc(dest) + '</td>'
        + '<td>' + esc(drv) + '</td>'
        + '<td><span class="badge ' + sm.c + '">' + esc(smt) + '</span></td>'
        + '<td class="text-muted">' + dt + '</td>'
        + '</tr>';
    }).join('');
  });
}

/* ── Jármű státusz összesítő ── */
function loadDashVehicleSummary() {
  var box = document.getElementById('dashVehicleSummary');
  if (!box) return;
  gas('getVehicleStatusSummary').then(function (r) {
    if (!r || !r.ok) { box.innerHTML = ''; return; }
    var cards = [
      { l: t('dash.vehActive'),  v: r.active || 0,   col: (r.active > 0 ? 'var(--status-ok)' : 'var(--text-muted)'), ico: '🟢' },
      { l: t('dash.vehIdle'),    v: r.inactive || 0, col: 'var(--text-muted)', ico: '⚪' },
      { l: t('dash.vehUnknown'), v: r.unknown || 0,  col: 'var(--text-muted)', ico: '❔' }
    ];
    box.innerHTML = cards.map(function (c) {
      return '<div class="dash-mini glass-soft">'
        + '<div style="font-size:20px;">' + c.ico + '</div>'
        + '<div style="font-size:24px;font-weight:800;color:' + c.col + ';">' + c.v + '</div>'
        + '<div class="text-muted" style="font-size:11px;">' + c.l + '</div>'
        + '</div>';
    }).join('');
  });
}

/* ── Térkép (Leaflet + CartoDB) ── */
function initDashMap() {
  if (typeof L === 'undefined') return;               // Leaflet még nem töltött be
  var el = document.getElementById('dashMap');
  if (!el) return;
  if (window._dashMap) { setTimeout(function () { window._dashMap.invalidateSize(); }, 150); return; }

  var mc = document.getElementById('mainContent');
  var light = mc && mc.getAttribute('data-theme') === 'light';
  var theme = light ? 'light' : 'dark';
  window._dashMap = L.map(el, { zoomControl: true })
    .setView([45.9432, 24.9668], 7);                  // Románia közepe
  window._dashMarkers = L.layerGroup().addTo(window._dashMap);

  // OpenStreetMap (CartoDB) csempék — ingyenes, nincs HERE kulcs ezen az oldalon.
  window._dashTileLayer = L.tileLayer(cartoTileUrl(theme),
    { attribution: '© OpenStreetMap © CARTO', maxZoom: 19, subdomains: 'abcd' }).addTo(window._dashMap);

  // A térkép gyakran üresen marad, ha induláskor a konténer mérete még nem véglegesült.
  // Több ütemezett invalidateSize + ablakméret-figyelő biztosítja a csempék kirajzolását.
  [0, 150, 400, 800].forEach(function (d) {
    setTimeout(function () { if (window._dashMap) window._dashMap.invalidateSize(); }, d);
  });
  if (!window._dashResizeBound) {
    window._dashResizeBound = true;
    window.addEventListener('resize', function () {
      if (window._dashMap) window._dashMap.invalidateSize();
    });
  }
  // ResizeObserver: ha a konténer mérete utólag véglegesül (layout/téma/orientáció),
  // a térkép újraméri magát → a csempék a TELJES felületet kitöltik (ne maradjon fekete sáv).
  if (window.ResizeObserver && !window._dashRO) {
    window._dashRO = new ResizeObserver(function () {
      if (window._dashMap) window._dashMap.invalidateSize();
    });
    window._dashRO.observe(el);
  }
}

function refreshDashVehicles() {
  if (!window._dashMap || !window._dashMarkers) return;
  // Ne pollozzon, ha a vezérlőpult nem látható
  var pane = document.querySelector('.pane[data-pane="dash"]');
  if (pane && pane.classList.contains('hidden')) return;

  gas('getActiveVehiclePositions').then(function (r) {
    if (!r || !r.ok || !window._dashMarkers) return;
    window._dashMarkers.clearLayers();
    var pts = r.positions || [];
    if (!pts.length) {
      // Nincs élő GPS adat -> placeholder Románia közepén
      var ph = L.circleMarker([45.9432, 24.9668], {
        radius: 9, color: '#8a97a8', fillColor: '#8a97a8', fillOpacity: 0.6, weight: 2
      });
      ph.bindTooltip(r.gps_configured ? t('dash.noGpsData') : t('dash.noGpsSetup'));
      ph.addTo(window._dashMarkers);
      return;
    }
    var bounds = [];
    pts.forEach(function (p) {
      var spd = (p.speed != null) ? Math.round(p.speed) + ' km/h' : '—';
      var m = L.circleMarker([p.lat, p.lng], {
        radius: 8, color: '#6366f1', fillColor: '#6366f1', fillOpacity: 0.85, weight: 2
      });
      m.bindTooltip('🚛 ' + (p.object_name || p.rendszam) + ' · ' + spd);
      m.bindPopup('<b>' + esc(p.object_name || p.rendszam) + '</b><br>' + t('dash.speed') + ': ' + spd
        + (p.datetime ? '<br>' + new Date(p.datetime).toLocaleString('hu-HU') : ''));
      m.addTo(window._dashMarkers);
      bounds.push([p.lat, p.lng]);
    });
    if (bounds.length === 1) window._dashMap.setView(bounds[0], 10);
    else if (bounds.length > 1) window._dashMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
  });
}


/* ════════════════════════════════════════════════════════════
   KÖZÖS ADMIN/MANAGER KÓD (K17 refaktor)
   Korábban az admin.js ÉS a manager.js külön-külön tartalmazta
   ezeket (~600 sor duplikáció) — minden javítást kétszer kellett
   elvégezni. Az állapot-változóik (sign…, pdf…, _chat…, _oe…) a
   szerep-JS-ekben deklaráltak; a globális scope-láncon át érik el.
   ════════════════════════════════════════════════════════════ */

function decorateInvoiceIndicators(list){
  if(!window.InvoiceModal) return;
  var ids=(list||[]).map(function(c){return c.id;}).filter(Boolean);
  if(!ids.length) return;
  fetch('/api/invoices/summary?order_ids='+encodeURIComponent(ids.join(',')),{credentials:'same-origin'})
    .then(function(r){return r.json();}).then(function(d){
      var sum=(d&&d.summary)||{};
      document.querySelectorAll('[data-inv-ind]').forEach(function(el){
        var s=sum[el.getAttribute('data-inv-ind')]; var btn=el.closest('button');
        if(!s||!s.invoiced){ el.textContent=''; el.title=''; return; }
        if(s.stornoed){ el.textContent=' ↩️'; var ttl=t('cs.invStornoed')+(s.storno_serie||'')+'-'+(s.storno_numar||''); el.title=ttl; if(btn)btn.title=ttl; }
        else {
          // e-Factura (ANAF SPV) státusz-jelzés a pipán: 📨 = beküldve/folyamatban
          var ef=(s.efactura||'').toLowerCase();
          var efSym = ef ? (/(valid|ok|accept)/.test(ef)?' 📨✓' : /(err|invalid|resp)/.test(ef)?' 📨✗' : ' 📨') : '';
          el.textContent=' ✅'+efSym;
          var ttl2=t('cs.invInvoiced')+(s.serie||'')+'-'+(s.numar||'')+(s.efactura?(t('cs.invEfactura')+s.efactura):'');
          el.title=ttl2; if(btn)btn.title=ttl2;
        }
      });
    }).catch(function(){});
}

function decorateUitIndicators(list){
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

// ── ⋯ Fuvar-műveletek kezelő-menü (popover) ──────────────────────────────
// A menü a sor cellájában él (rejtve), nyitáskor a <body>-ba portáljuk és
// position:fixed-del a ⋯ gomb mellé igazítjuk — így semmilyen overflow
// (.main-content / .glass) nem vágja le. Záráskor visszakerül a cellájába.
var _vsActOpenId = null;
function closeOrderActions(){
  if(_vsActOpenId==null) return;
  var m=document.getElementById('actmenu-'+_vsActOpenId);
  var cell=document.getElementById('actcell-'+_vsActOpenId);
  if(m){ m.style.display='none'; m.classList.remove('open'); if(cell && m.parentNode!==cell) cell.appendChild(m); }
  _vsActOpenId=null;
}
function toggleOrderActions(id, btn){
  if(_vsActOpenId===id){ closeOrderActions(); return; }
  closeOrderActions();
  var m=document.getElementById('actmenu-'+id);
  if(!m) return;
  document.body.appendChild(m);
  m.style.display='block'; m.style.visibility='hidden'; m.classList.add('open');
  var r=btn.getBoundingClientRect(), mw=m.offsetWidth, mh=m.offsetHeight, pad=8;
  var left=r.right-mw;
  if(left<pad) left=pad;
  if(left+mw>window.innerWidth-pad) left=window.innerWidth-mw-pad;
  var top=r.bottom+6;
  if(top+mh>window.innerHeight-pad){ var up=r.top-mh-6; top = up>pad ? up : Math.max(pad, window.innerHeight-mh-pad); }
  m.style.left=Math.round(left)+'px'; m.style.top=Math.round(top)+'px'; m.style.visibility='visible';
  _vsActOpenId=id;
}
if(!window._vsActInit){
  window._vsActInit=true;
  document.addEventListener('click', function(e){
    if(_vsActOpenId==null) return;
    if(e.target.closest && e.target.closest('[data-act-toggle]')) return; // a ⋯ gomb maga kezeli
    var m=document.getElementById('actmenu-'+_vsActOpenId);
    if(m && m.contains(e.target)) return; // menün belüli kattintás
    closeOrderActions();
  }, true);
  window.addEventListener('scroll', function(){ closeOrderActions(); }, true);
  window.addEventListener('resize', function(){ closeOrderActions(); });
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeOrderActions(); });
}

function loadDash(){ loadDashboard(); }

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

function addSignatureToPage(){
  if(!pdfDocProxy){ toast(t('cs.pdfFirst'),'err'); return; }
  const blank=document.createElement('canvas'); blank.width=signCanvasEl.width; blank.height=signCanvasEl.height;
  if(signCanvasEl.toDataURL()===blank.toDataURL()){ toast(t('cs.drawSigFirst'),'err'); return; }
  createDraggableItem(signCanvasEl.toDataURL('image/png'),'sign');
  toast(t('cs.sigAdded'),'ok');
}

async function buildSignedPdf(){
  if(placedItems.length===0){ toast(t('cs.noSigOrStamp'),'err'); return null; }
  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.load(pdfRawBytes.slice());
  const pages = pdfDoc.getPages();
  const stage = document.getElementById('signPdfStage');

  for(const it of placedItems){
    const page = pages[it.pageNum-1];
    if(!page) continue;
    const pw = page.getWidth(), ph = page.getHeight();

    const boxLeft = parseFloat(it.el.style.left)||0;
    const boxTop  = parseFloat(it.el.style.top)||0;
    const boxW    = it.el.offsetWidth;
    const boxH    = it.el.offsetHeight;

    const canvas = document.getElementById('signPdfCanvas');
    const cw = canvas.width, ch = canvas.height;

    const offsetX = (stage.clientWidth - cw)/2;
    const relX = boxLeft - offsetX;
    const relY = boxTop;

    const scaleX = pw / cw;
    const scaleY = ph / ch;
    const pdfX = relX * scaleX;
    const pdfW = boxW * scaleX;
    const pdfH = boxH * scaleY;
    const pdfY = ph - (relY*scaleY) - pdfH;

    const pngBytes = await fetch(it.dataUrl).then(r=>r.arrayBuffer());
    const png = await pdfDoc.embedPng(pngBytes);
    page.drawImage(png, {x:pdfX, y:pdfY, width:pdfW, height:pdfH});
  }

  const out = await pdfDoc.save();
  let binary=''; const bytes=new Uint8Array(out);
  const chunk=8192;
  for(let i=0;i<bytes.length;i+=chunk){ binary+=String.fromCharCode.apply(null, bytes.subarray(i,i+chunk)); }
  return 'data:application/pdf;base64,'+btoa(binary);
}

function downloadDoc(docId,which){
  gas('orderDocGet',[docId,which]).then(r=>{
    if(!r.ok||!r.base64){toast(r.err||t('cs.downloadError'),'err');return;}
    let ext='.pdf';
    if(r.base64.indexOf('data:image/png')===0) ext='.png';
    else if(r.base64.indexOf('data:image/jpeg')===0) ext='.jpg';
    else if(r.base64.indexOf('data:application/pdf')===0) ext='.pdf';
    let base=(r.fileName||'dokumentum').replace(/\.[^.]+$/,'');
    const a=document.createElement('a');
    a.href=r.base64;
    a.download=(which==='signed'?'alairt_':'')+base+ext;
    a.click();
  });
}

function initAdminSigCanvas(){
  sigCanvas=document.getElementById('adminSigCanvas');if(!sigCanvas)return;sigCtx=sigCanvas.getContext('2d');
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

function loadEmailLang(){
  var sel=document.getElementById('stEmailLang'); if(!sel) return;
  gas('getEmailLang').then(function(r){ if(r&&r.ok&&r.lang) sel.value=r.lang; });
}
function saveEmailLang(){
  var sel=document.getElementById('stEmailLang'); if(!sel) return;
  gas('setEmailLang',[sel.value]).then(function(r){
    if(r&&r.ok) toast(typeof t==='function'?'✉️ '+t('common.save'):'✉️ Mentve','ok');
    else toast((r&&r.err)||'Hiba','err');
  });
}
// ── Előfizetés kártya betöltése (csak Admin, settings pane-ben) ──
function loadSubscriptionCard() {
  var card = document.getElementById('subscriptionCard');
  if (!card) return;
  gas('authMe').then(function(u) {
    if (!u || u.pozicio !== 'Admin') return;
    card.style.display = '';
    gas('getMySubscription').then(function(r) {
      if (!r || !r.ok) return;
      var block = document.getElementById('subStatusText');
      var btn   = document.getElementById('subUpgradeBtn');
      if (!block) return;
      var statusMap = { active: '✅ Aktív', trial: '⏳ Próbaidőszak', inactive: '❌ Inaktív', cancelled: '🚫 Lemondott' };
      var txt = (statusMap[r.status] || r.status || '—');
      if (r.days_left !== null && r.days_left !== undefined) {
        txt += ' — ' + (r.days_left > 0 ? r.days_left + ' nap van hátra' : 'lejárt');
      }
      if (r.plan_name) txt += ' (' + r.plan_name + ')';
      block.textContent = txt;
      if (r.status === 'trial' || r.status === 'inactive') { if (btn) btn.style.display = ''; }
    });
  });
}

function loadSettingsPane(){
  loadEmailLang();
  gas('authMe').then(function(u){
    if(!u) return;
    document.getElementById('stNume').value    = u.nume  || '';
    document.getElementById('stEmail').value   = u.email || '';
    document.getElementById('stTel').value     = u.tel   || '';
    document.getElementById('stPozicio').value = u.pozicio || '';
    // GDPR / Adatvédelem kártya — csak Adminnak
    if (u.pozicio === 'Admin') {
      var gcard = document.getElementById('gdprSettingsCard');
      if (gcard) {
        gcard.style.display = '';
        gas('getGdprSettings').then(function(r){
          var s = (r && r.ok && r.settings) || {};
          var set=function(id,v){ var el=document.getElementById(id); if(el) el.value=v||''; };
          set('gdprNotice', s.privacy_notice); set('gdprDpo', s.dpo_contact); set('gdprRetention', s.retention_note);
          var cb=document.getElementById('gdprGpsBiz'); if(cb) cb.checked=!!s.gps_business_only;
        });
      }
    }
  });
  // 2FA státusz
  gas('settings2faStatus').then(function(r){
    var dot   = document.getElementById('st2faDot');
    var label = document.getElementById('st2faLabel');
    var desc  = document.getElementById('st2faDesc');
    var disW  = document.getElementById('st2faDisableWrap');
    var enW   = document.getElementById('st2faEnableWrap');
    if(r && r.totp_enabled){
      dot.style.background   = 'var(--ok)';
      label.textContent      = t('cs.2fa.activeProtected');
      desc.textContent       = t('cs.2fa.onDesc');
      disW.style.display     = '';
      enW.style.display      = 'none';
    } else {
      dot.style.background   = 'var(--warn)';
      label.textContent      = t('cs.2fa.notOn');
      desc.textContent       = t('cs.2fa.suggest');
      disW.style.display     = 'none';
      enW.style.display      = '';
    }
  });
}

// ── Előfizetések pane ────────────────────────────────────────────────────────
var _elofBilling = 'monthly';

function elofSetBilling(mode) {
  _elofBilling = mode;
  var mBtn = document.getElementById('elofBillingMonthly');
  var aBtn = document.getElementById('elofBillingAnnual');
  if (mBtn) mBtn.className = 'btn ' + (mode === 'monthly' ? 'primary' : 'ghost');
  if (aBtn) aBtn.className = 'btn ' + (mode === 'annual'  ? 'primary' : 'ghost');
  if (window._elofPlans) elofRenderPlans(window._elofPlans);
}

function elofRenderPlans(plans) {
  window._elofPlans = plans;
  var grid = document.getElementById('elofPlanGrid');
  if (!grid) return;
  var isAnnual = _elofBilling === 'annual';
  var esc = function(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
  grid.innerHTML = plans.map(function(p) {
    var monthly = parseFloat(p.price_net) || 0;
    var amount  = isAnnual ? monthly * 11 : monthly;
    var per     = isAnnual ? '/an (11 luni)' : '/lună';
    var isFree  = monthly === 0;
    return '<div style="border:1.5px solid var(--border);border-radius:10px;padding:14px;background:rgba(255,255,255,0.03);">'
      + '<div style="font-size:13px;font-weight:700;margin-bottom:6px;">' + esc(p.name) + '</div>'
      + (isFree
          ? '<div style="font-size:14px;font-weight:700;color:var(--muted);">Preț personalizat</div>'
          : '<div style="font-size:20px;font-weight:800;color:#6366f1;">€' + amount.toFixed(0) + '<span style="font-size:11px;font-weight:500;color:var(--muted);">' + per + '</span></div>')
      + (isFree
          ? '<a href="mailto:vallorsoft@gmail.com" style="display:block;text-align:center;margin-top:10px;padding:7px;background:#1e293b;color:#fff;border-radius:7px;font-size:12px;font-weight:600;text-decoration:none;">Contactați-ne</a>'
          : '<button style="width:100%;margin-top:8px;padding:7px;background:#6366f1;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;" onclick="elofRequestPlan(' + p.id + ')">📧 Kérelem</button>')
      + '</div>';
  }).join('');
}

function loadElofizetesek() {
  gas('getMySubscription').then(function(r) {
    var el = document.getElementById('elofSubText');
    var ex = document.getElementById('elofSubExpiry');
    if (!el || !r || !r.ok) return;
    var sm = { active: '✅ Aktív', trial: '⏳ Próbaidőszak', inactive: '❌ Inaktív', cancelled: '🚫 Lemondott' };
    el.textContent = (sm[r.status] || r.status || '—') + (r.plan_name ? ' — ' + r.plan_name : '');
    if (ex) ex.textContent = r.days_left !== null
      ? (r.days_left > 0 ? r.days_left + ' nap van hátra' : 'Lejárt') + (r.paid_until ? ' (' + new Date(r.paid_until).toLocaleDateString('ro-RO') + ')' : '')
      : '';
    elofRenderCancel(r);
  });
  fetch('/api/public-plans').then(function(rsp){ return rsp.json(); }).then(function(data){
    elofRenderPlans(data.plans || []);
  }).catch(function(){
    var g = document.getElementById('elofPlanGrid');
    if (g) g.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:10px;">Nem sikerült betölteni a csomagokat.</div>';
  });
  elofLoadHistory();
}

// Lemondás / visszavonás doboz a státusz-kártyán (RO feliratokkal).
function elofRenderCancel(r) {
  var box = document.getElementById('elofCancelBox');
  if (!box) return;
  var paidStr = r.paid_until ? new Date(r.paid_until).toLocaleDateString('ro-RO') : '';
  if (r.cancel_pending) {
    var dl = (r.days_left != null && r.days_left > 0) ? r.days_left : 0;
    box.innerHTML =
      '<div style="margin-top:14px;padding:14px;border-radius:10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.35);">'
      + '<div style="font-size:13px;font-weight:700;color:#ef4444;margin-bottom:4px;">🚫 Abonament anulat</div>'
      + '<div style="font-size:13px;color:var(--muted);margin-bottom:10px;">Aveți acces până la <b>' + paidStr + '</b>'
      + (dl ? ' (încă ' + dl + (dl === 1 ? ' zi' : ' zile') + ')' : '') + '. Vă puteți răzgândi oricând până atunci.</div>'
      + '<button class="btn primary" style="font-size:13px;" onclick="reactivateSubscription()">↩️ M-am răzgândit</button>'
      + '</div>';
  } else if (r.can_cancel) {
    box.innerHTML =
      '<div style="margin-top:14px;">'
      + '<button class="btn ghost" style="font-size:12px;color:#ef4444;border-color:rgba(239,68,68,0.4);" onclick="cancelSubscription()">Anulează abonamentul</button>'
      + '<div style="font-size:11px;color:var(--muted);margin-top:6px;">După anulare păstrați accesul până la sfârșitul perioadei plătite'
      + (paidStr ? ' (' + paidStr + ')' : '') + '. Veți primi un e-mail cu opțiunea de a vă răzgândi.</div>'
      + '</div>';
  } else {
    box.innerHTML = '';
  }
}

window.cancelSubscription = function() {
  if (!confirm('Sigur anulați abonamentul? Veți păstra accesul până la sfârșitul perioadei plătite.')) return;
  gas('cancelSubscription').then(function(r) {
    if (r && r.ok) {
      if (typeof toast === 'function') toast(r.already
        ? 'Abonamentul este deja anulat.'
        : 'Abonament anulat. Aveți acces până la finalul perioadei plătite — v-am trimis un e-mail.', 'success');
      loadElofizetesek();
    } else if (typeof toast === 'function') { toast((r && r.err) || 'Eroare', 'error'); }
    else { alert((r && r.err) || 'Eroare'); }
  });
};

window.reactivateSubscription = function() {
  gas('reactivateSubscription').then(function(r) {
    if (r && r.ok) {
      if (typeof toast === 'function') toast('Bine ați revenit! Abonamentul rămâne activ.', 'success');
      loadElofizetesek();
    } else if (typeof toast === 'function') { toast((r && r.err) || 'Eroare', 'error'); }
  });
};

function elofLoadHistory() {
  gas('getMyPaymentRequests').then(function(r) {
    var tbody = document.getElementById('elofHistTbody');
    if (!tbody) return;
    if (!r || !r.ok || !r.requests || !r.requests.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:16px;">Nincs fizetési előzmény</td></tr>';
      return;
    }
    var sc = { paid: '#22c55e', cancelled: '#94a3b8', pending: '#f59e0b' };
    var stl = { paid: '✅ Fizetve', cancelled: '✕ Törölve', pending: '⏳ Folyamatban' };
    var esc = function(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    tbody.innerHTML = r.requests.map(function(p) {
      return '<tr>'
        + '<td style="white-space:nowrap;">' + (p.created_at ? new Date(p.created_at).toLocaleDateString('ro-RO') : '—') + '</td>'
        + '<td>' + esc(p.plan_name || p.plan_id) + '</td>'
        + '<td>' + (p.billing_type === 'annual' ? '📅 Éves' : '📆 Havi') + '</td>'
        + '<td style="font-family:monospace;font-weight:700;font-size:12px;">' + esc(p.reference) + '</td>'
        + '<td style="text-align:right;">€' + (parseFloat(p.amount_eur)||0).toFixed(2) + '</td>'
        + '<td style="text-align:right;">' + (p.total_ron ? parseFloat(p.total_ron).toFixed(2) + ' RON' : '—') + '</td>'
        + '<td><span style="color:' + (sc[p.status]||'#94a3b8') + ';font-weight:600;font-size:12px;">' + (stl[p.status] || p.status) + '</span></td>'
        + '</tr>';
    }).join('');
  });
}

function elofRequestPlan(planId) {
  if (!confirm('Kérelmet küldesz a ' + (_elofBilling === 'annual' ? 'éves' : 'havi') + ' előfizetésre. Fizetési részleteket emailben kapod. Folytatod?')) return;
  gas('requestSubscriptionExtension', [planId, _elofBilling]).then(function(r) {
    if (!r || !r.ok) { toast((r && r.err) || 'Eroare la trimiterea cererii', 'err'); return; }
    var rc   = document.getElementById('elofRefCard');
    var refEl = document.getElementById('elofRefCode');
    if (rc && refEl) {
      refEl.textContent = r.reference || '—';
      var bb = document.getElementById('elofBankBlock');
      if (bb && r.bankDetails) {
        var b = r.bankDetails;
        var e = function(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
        bb.innerHTML = '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px 16px;">'
          + '<div style="font-size:12px;color:#166534;font-weight:700;margin-bottom:8px;">DATE CONT BANCAR</div>'
          + '<table style="width:100%;font-size:13px;border-collapse:collapse;">'
          + '<tr><td style="color:#475569;padding:3px 0;">Titular</td><td style="font-weight:600;">' + e(b.holder||'') + '</td></tr>'
          + '<tr><td style="color:#475569;padding:3px 0;">IBAN</td><td style="font-family:monospace;font-weight:600;">' + e(b.iban||'') + '</td></tr>'
          + '<tr><td style="color:#475569;padding:3px 0;">Bancă</td><td style="font-weight:600;">' + e(b.bank||'') + '</td></tr>'
          + (b.swift ? '<tr><td style="color:#475569;padding:3px 0;">SWIFT</td><td style="font-family:monospace;font-weight:600;">' + e(b.swift) + '</td></tr>' : '')
          + '</table></div>';
      }
      rc.style.display = '';
      rc.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    toast('Kérelem elküldve! Fizetési részleteket emailben kapod.', 'ok');
    elofLoadHistory();
  });
}

// GDPR adatvédelmi beállítások mentése (csak admin felületen jelenik meg)
function gdprSaveSettings(){
  var payload = {
    privacy_notice:    (document.getElementById('gdprNotice')||{}).value||'',
    dpo_contact:       (document.getElementById('gdprDpo')||{}).value||'',
    retention_note:    (document.getElementById('gdprRetention')||{}).value||'',
    gps_business_only: !!(document.getElementById('gdprGpsBiz')||{}).checked,
  };
  gas('saveGdprSettings',[payload]).then(function(r){
    var msg=document.getElementById('gdprSaveMsg');
    if(r&&r.ok){ if(msg){ msg.textContent='✓ '+t('common.saved'); setTimeout(function(){msg.textContent='';},2500); } toast(t('common.saved'),'ok'); }
    else { toast((r&&r.err)||'Eroare',  'err'); }
  });
}

function openSignModal(docId,which){
  currentDocId=docId;
  document.getElementById('signModal').classList.add('open');

  placedItems.forEach(it=>{ if(it.el) it.el.remove(); });
  placedItems=[];
  pdfDocProxy=null; pdfRawBytes=null; signCurrentPage=1; signTotalPages=1;
  document.getElementById('signPageInfo').textContent=t('cs.loadingLower');

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

  setTimeout(()=>{
    signCanvasEl=document.getElementById('signCanvas');
    signCtxEl=signCanvasEl.getContext('2d');

    // Helyes méret: ratio figyelembe véve (retina / mobile pixel ratio)
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

  gas('orderDocGet',[docId,which]).then(async r=>{
    if(!r.ok||!r.base64){ toast(r.err||t('cs.pdfLoadError'),'err'); return; }
    try{
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
      toast(t('cs.pdfOpenFail'),'err');
    }
  });
}

async function renderSignPage(num){
  if(!pdfDocProxy) return;
  placedItems.forEach(it=>{ if(it.el) it.el.style.display = (it.pageNum===num?'block':'none'); });

  const page = await pdfDocProxy.getPage(num);
  const stage = document.getElementById('signPdfStage');
  const canvas = document.getElementById('signPdfCanvas');
  const ctx = canvas.getContext('2d');

  const baseViewport = page.getViewport({scale:1});
  const maxW = stage.clientWidth || 560;
  signRenderScale = maxW / baseViewport.width;
  const viewport = page.getViewport({scale: signRenderScale});

  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({canvasContext: ctx, viewport}).promise;

  document.getElementById('signPageInfo').textContent = num + ' / ' + signTotalPages;
}

// Kör monogram-avatar a sofőr-névből (csak megjelenítés). 1-2 betű + determinisztikus
// háttérszín a névből (nincs adat-/eseménylogika). Üres/„—" névnél semleges avatar.
function vslAvatar(name){
  var s = (name==null ? '' : String(name)).trim();
  if(!s || s==='—'){ return '<span class="vsl-av vsl-av-empty" aria-hidden="true">–</span>'; }
  var parts = s.split(/\s+/).filter(Boolean);
  var ini = (parts[0]||'').charAt(0);
  if(parts.length>1) ini += (parts[parts.length-1]||'').charAt(0);
  ini = ini.toUpperCase();
  var h = 0; for(var i=0;i<s.length;i++){ h = (h*31 + s.charCodeAt(i)) % 360; }
  var bg = 'hsl('+h+',55%,42%)';
  return '<span class="vsl-av" aria-hidden="true" style="background:'+bg+';">'+esc(ini)+'</span>';
}

// Általános, táblafüggetlen monogram-avatar (a vslAvatar testvére, de a
// .vs-av generikus osztállyal — más listatáblákon is használható, nem csak a
// fuvarlistán). CSAK megjelenítés; a nevet escape-eljük (XSS-mentes).
function vsAvatar(name){
  var s = (name==null ? '' : String(name)).trim();
  if(!s || s==='—'){ return '<span class="vs-av vs-av-empty" aria-hidden="true">–</span>'; }
  var parts = s.split(/\s+/).filter(Boolean);
  var ini = (parts[0]||'').charAt(0);
  if(parts.length>1) ini += (parts[parts.length-1]||'').charAt(0);
  ini = ini.toUpperCase();
  var h = 0; for(var i=0;i<s.length;i++){ h = (h*31 + s.charCodeAt(i)) % 360; }
  var bg = 'hsl('+h+',55%,42%)';
  return '<span class="vs-av" aria-hidden="true" style="background:'+bg+';">'+esc(ini)+'</span>';
}
window.vsAvatar = vsAvatar;

// 📧 Sablonból e-mail egy fuvarhoz — a fuvar adatait a _ordersAllCache-ből
// olvassa (idézőjel-biztos: nem inline-interpolált), és a közös dialógust nyitja.
function vsSendOrderTplMail(orderId) {
  var c = (window._ordersAllCache || []).find(function (x) { return String(x.id) === String(orderId); });
  if (!c || typeof window.sendTemplatedEmailDialog !== 'function') return;
  var route = ((c.loc_incarcare || '') + ' → ' + (c.loc_descarcare || '')).trim();
  window.sendTemplatedEmailDialog({
    keys: ['order_confirm_carrier', 'order_status_change', 'generic'],
    templateKey: 'order_confirm_carrier',
    toEmail: c.client_email || '',
    vars: { order_id: String(c.id), route: route, client: c.client || '', status: c.status || '' },
  });
}
window.vsSendOrderTplMail = vsSendOrderTplMail;

function renderFilteredOrders(list) {
  var tbody = document.getElementById('tblOrdersBody');
  if (!tbody) return;
  // Újrarendereléskor a korábban <body>-ba portált nyitott kezelő-menüt eltakarítjuk
  // (különben árva, duplikált id-jú node marad a body-n).
  if (window.closeOrderActions) closeOrderActions();
  document.querySelectorAll('body > .vs-act-menu').forEach(function(n){ n.remove(); });
  if (!list.length) { tbody.innerHTML='<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:20px;">'+t('cs.noMatch')+'</td></tr>'; return; }
  tbody.innerHTML = list.map(function(c){
    // Anulált (törölt) fuvar: látható marad, de zárolt — semmilyen művelet nincs rajta.
    var isCancelled = (c.status==='Anulat');
    var soferInfo='—';
    if(c.sofer_type==='Intern')soferInfo=c.nume_sofer||c.email_sofer||'—';
    else if(c.sofer_type==='Extern')soferInfo=c.nume_sofer||c.firma_extern||'—';
    var sc='info';
    if(c.status==='Alocat')sc='warn';
    if(c.status==='In Curs'||c.status==='Finalizat')sc='ok';
    if(c.status==='Anulat')sc='err';
    if(c.status==='Extern')sc='warn';
    if(c.status==='Parkolt')sc='park';
    if(c.status==='Raktarban')sc='wh';

    // Státusz dropdown — gombszerű, színes, kattintható.
    // 'Extern' is a listában van (különben az Extern fuvar tévesen az első
    // opciót — Disponibil — mutatná); a fuvar AKTUÁLIS státuszát mindig
    // beszúrjuk, ha valamiért nem szerepelne a kanonikus listában.
    var statuses = ['Disponibil','Alocat','Extern','In Curs','Parkolt','Raktarban','Finalizat','Anulat'];
    if (c.status && statuses.indexOf(c.status) === -1) statuses = [c.status].concat(statuses);
    var selStyle = 'cursor:pointer;font-size:11px;font-weight:700;border-radius:8px;padding:4px 20px 4px 8px;'+
      'border:1px solid;appearance:auto;-webkit-appearance:auto;outline:none;min-width:80px;';
    var bgMap = {
      'info': 'background:rgba(59,130,246,0.18);color:#2563eb;border-color:rgba(59,130,246,0.4);',
      'warn': 'background:rgba(245,158,11,0.18);color:#d97706;border-color:rgba(245,158,11,0.45);',
      'ok':   'background:rgba(34,197,94,0.18);color:#16a34a;border-color:rgba(34,197,94,0.4);',
      'err':  'background:rgba(239,68,68,0.18);color:#dc2626;border-color:rgba(239,68,68,0.4);',
      'park': 'background:rgba(20,184,166,0.18);color:#0f766e;border-color:rgba(20,184,166,0.4);',
      'wh':   'background:rgba(249,115,22,0.18);color:#c2410c;border-color:rgba(249,115,22,0.45);'
    };
    // Anulált fuvarnál a dropdown letiltva (nem támasztható fel a felületről sem).
    var statusSel = '<select class="vsl-pill vsl-pill-'+sc+'" onchange="quickStatusChange(\''+c.id+'\',this)" '+
      (isCancelled?'disabled ':'')+
      'style="'+selStyle+(bgMap[sc]||bgMap['info'])+(isCancelled?'opacity:.7;cursor:not-allowed;':'')+'">'+
      statuses.map(function(s){
        return '<option value="'+s+'" '+(c.status===s?'selected':'')+' style="background:#0c1218;color:#e9eef5;">'+s+'</option>';
      }).join('')+
    '</select>';
    // Szakaszok (order_legs) — biztonságos parse
    var legs = [];
    try {
      legs = Array.isArray(c.legs_json) ? c.legs_json :
             (typeof c.legs_json === 'string' && c.legs_json.length > 2 ? JSON.parse(c.legs_json) : []);
    } catch(e) { legs = []; }
    var legCount = legs.length;

    // Útvonal cella: alap útvonal + FTL/LTL jelzés (+ méret) + szakasz közbülső pontok
    // Vizuális megjelenítés (csak kinézet): felrakó • ─ ─→ 📍 lerakó. A szöveg/adat
    // változatlan, az i18n érintetlen — pusztán egy dekoratív burok az értékek körül.
    var routeCell = '<span class="vsl-route">'+
        '<span class="vsl-route-pt">'+esc(c.loc_incarcare||'—')+'</span>'+
        '<span class="vsl-route-link" aria-hidden="true"><span class="vsl-route-pin">📍</span></span>'+
        '<span class="vsl-route-pt vsl-route-dst">'+esc(c.loc_descarcare||'—')+'</span>'+
      '</span>'+loadTypeBadge(c.load_type, dimStr(c.hossz_cm,c.szel_cm,c.mag_cm));
    // RO e-Transport: ha a fuvar UIT-kötelezettnek jelölt, de nincs aktív UIT-kódja → figyelmeztetés
    if (c.needs_uit && !(parseInt(c.uit_active_count,10)>0)) {
      routeCell += ' <span class="badge err" style="font-size:10px;padding:1px 6px;white-space:nowrap;" title="'+t('cs.ol.uitMissingTitle')+'">⚠️ '+t('cs.ol.uitMissing')+'</span>';
    }
    // Leadott áru jelzései (folytatásra váró fuvar — a lista tetején)
    if (c.status==='Parkolt') {
      routeCell += '<div style="margin-top:4px;"><span class="badge" style="background:rgba(20,184,166,0.18);color:#2dd4bf;border:1px solid rgba(20,184,166,0.4);">'+
        t('cs.ol.cargoOnTrailer')+(c.rendszam_remorca?': '+esc(c.rendszam_remorca):'')+(c.handover_loc?' @ '+esc(c.handover_loc):'')+t('cs.ol.needTractor')+'</span></div>';
    }
    if (c.status==='Raktarban') {
      routeCell += '<div style="margin-top:4px;"><span class="badge" style="background:rgba(249,115,22,0.18);color:#fb923c;border:1px solid rgba(249,115,22,0.4);">'+
        t('cs.ol.inWarehouse')+(c.handover_loc?' @ '+esc(c.handover_loc):'')+t('cs.ol.waitAlloc')+'</span>'+
        (parseInt(c.pod_count,10)>0?'':' <span class="badge err">'+t('cs.ol.docMissing')+'</span>')+'</div>';
    }
    if (c.handover_status==='Fuggoben') {
      routeCell += '<div style="margin-top:4px;"><span class="badge warn">'+t('cs.ol.handoverPending')+
        (c.handover_loc?' @ '+esc(c.handover_loc):'')+'</span></div>';
    }
    if (legCount > 0) {
      routeCell += '<div style="margin-top:4px;">';
      legs.forEach(function(l){
        if (l.loc_preluare) {
          routeCell += '<div style="font-size:11px;color:var(--muted);padding-left:8px;border-left:2px solid rgba(99,102,241,0.4);margin-top:2px;">'+
            '↳ '+esc(l.loc_preluare)+
          '</div>';
        }
      });
      routeCell += '</div>';
    }

    // Sofőr cella: kör monogram-avatar (csak kinézet) + alap sofőr + váltások badge-del.
    // Az avatar a sofőr nevéből képzett 1-2 betű, determinisztikus színnel; a név
    // szövege/adat-logikája változatlan.
    var soferCell = vslAvatar(soferInfo)+'<span class="vsl-driver-name">'+esc(soferInfo)+'</span>';
    if (legCount > 0) {
      soferCell += ' <span style="font-size:10px;background:rgba(99,102,241,0.15);color:#4f46e5;border:1px solid rgba(99,102,241,0.3);border-radius:6px;padding:1px 6px;white-space:nowrap;">+'+legCount+t('cs.ol.legBadge')+'</span>';
      soferCell += '<div style="margin-top:4px;">';
      legs.forEach(function(l){
        soferCell += '<div style="font-size:11px;color:var(--muted);margin-top:2px;">'+
          '↳ '+esc(l.sofer||'—')+(l.rendszam?' <span style="opacity:.6;">'+esc(l.rendszam)+'</span>':'')+
        '</div>';
      });
      soferCell += '</div>';
    }

    // ── ⋯ Kezelő-menü tételei (a sorban csak ✏️ + ⋯ marad; a többi ide kerül) ──
    // Minden tétel ikon + rövid szöveg; az állapot-indikátorok (UIT/számla/POD/fizetés)
    // a tétel jobb szélén jelennek meg. A dekorátorok ugyanazokat a [data-*-ind]
    // span-eket töltik, mint korábban — a menü a DOM-ban van (rejtve), így találják.
    var menuItems = '';
    // 🔎 Részletek (drill-in, csak olvasás) — a meglévő tételeket nem érinti
    if (window.EntityDetail) {
      menuItems += '<button class="vs-act-item" role="menuitem" title="'+t('ed.details')+'" '+
        'onclick="EntityDetail.openOrder(\''+c.id+'\');closeOrderActions()">'+
        '<span class="vs-act-ico">🔎</span><span class="vs-act-lbl">'+t('ed.details')+'</span></button>'+
        '<div class="vs-act-sep"></div>';
    }
    // 📎 Dokumentumok (mindig) — jobb szélén a POD-fotó jelző
    var podBadge = (parseInt(c.pod_count, 10) > 0)
      ? '<span class="vs-act-ind" style="color:var(--status-ok);" title="'+c.pod_count+t('cs.ol.podAttached')+'">📷'+c.pod_count+'</span>' : '';
    menuItems += '<button class="vs-act-item" role="menuitem" onclick="openDocModal(\''+c.id+'\');closeOrderActions()">'+
      '<span class="vs-act-ico">📎</span><span class="vs-act-lbl">'+t('cs.ol.mDocs')+'</span>'+podBadge+'</button>';
    // 🗺️ Hol a kocsi?
    if (c.rendszam_camion && window.CargoTrackWhereIs) {
      menuItems += '<button class="vs-act-item" role="menuitem" title="'+t('cs.ol.whereIs')+'" '+
        'onclick="CargoTrackWhereIs.show(\''+esc(c.rendszam_camion)+'\',\''+c.id+'\');closeOrderActions()">'+
        '<span class="vs-act-ico">🗺️</span><span class="vs-act-lbl">'+t('cs.ol.mWhere')+'</span></button>';
    }
    // ＋ UIT-kódok
    if (window.UitPanel) {
      menuItems += '<button class="vs-act-item uit-btn" role="menuitem" title="'+t('cs.ol.uitCodes')+'" data-uit-oid="'+c.id+'" '+
        'onclick="UitPanel.open(\''+c.id+'\',\''+esc(c.rendszam_camion||'')+'\');closeOrderActions()">'+
        '<span class="vs-act-ico">＋</span><span class="vs-act-lbl">'+t('cs.ol.mUit')+'</span>'+
        '<span class="vs-act-ind uit-ind" data-uit-ind="'+c.id+'"></span></button>';
    }
    // 🧾 Számlázás — CSAK Finalizat fuvaron
    if (c.status==='Finalizat' && window.InvoiceModal) {
      menuItems += '<button class="vs-act-item" role="menuitem" title="'+t('cs.ol.invoicing')+'" '+
        'onclick="InvoiceModal.open(\''+c.id+'\');closeOrderActions()">'+
        '<span class="vs-act-ico">🧾</span><span class="vs-act-lbl">'+t('cs.ol.mInvoice')+'</span>'+
        '<span class="vs-act-ind inv-ind" data-inv-ind="'+c.id+'"></span></button>';
    }
    // 💰 Fizetés rögzítése — CSAK Finalizat fuvaron; jobb szélén állapot-pötty (zöld/sárga/piros)
    if (c.status==='Finalizat') {
      var _ps = c.payment_status || 'unpaid';
      var _pTitle = _ps==='paid' ? t('cs.ol.paidAmt',{n:(c.paid_amount||0)}) :
                    _ps==='partial' ? t('cs.ol.partialPay') : t('cs.ol.unpaidPay');
      var _pCol = _ps==='paid' ? '#4ade80' : _ps==='partial' ? '#fbbf24' : '#f87171';
      menuItems += '<button class="vs-act-item" role="menuitem" title="'+_pTitle+'" '+
        'onclick="openPaymentModal(\''+c.id+'\');closeOrderActions()">'+
        '<span class="vs-act-ico">💰</span><span class="vs-act-lbl">'+t('cs.ol.mPay')+'</span>'+
        '<span class="vs-act-ind" style="color:'+_pCol+';">'+(_ps==='paid'?'✓':'●')+'</span></button>';
    }
    // 🌍 Ügyfél tracking-link (prémium funkció-kapcsoló: 'tracking')
    if (!(window._vsFeatures && window._vsFeatures['tracking']===false)) {
      menuItems += '<button class="vs-act-item" role="menuitem" title="'+t('cs.ol.copyTrack')+'" '+
        'onclick="copyTrackingLink(\''+c.id+'\');closeOrderActions()">'+
        '<span class="vs-act-ico">🌍</span><span class="vs-act-lbl">'+t('cs.ol.mTrack')+'</span></button>';
    }
    // ✉️ Email a fuvarról (pipálós: fuvar-adatok + csatolmányok; külső/belső cím)
    if (window.openOrderEmail) {
      menuItems += '<button class="vs-act-item" role="menuitem" title="'+t('cs.ol.mOrderMail')+'" '+
        'onclick="openOrderEmail(\''+c.id+'\');closeOrderActions()">'+
        '<span class="vs-act-ico">✉️</span><span class="vs-act-lbl">'+t('cs.ol.mOrderMail')+'</span></button>';
    } else if (window.sendTemplatedEmailDialog) {
      menuItems += '<button class="vs-act-item" role="menuitem" title="'+t('cs.ol.mTplMail')+'" '+
        'onclick="vsSendOrderTplMail(\''+c.id+'\');closeOrderActions()">'+
        '<span class="vs-act-ico">📧</span><span class="vs-act-lbl">'+t('cs.ol.mTplMail')+'</span></button>';
    }
    // ⛔ Áru leadása (megszakítás) — elválasztó után, danger színnel; aktív fuvaron
    if (!isCancelled && (c.status==='Alocat'||c.status==='In Curs') && c.handover_status!=='Fuggoben') {
      menuItems += '<div class="vs-act-sep"></div>'+
        '<button class="vs-act-item danger" role="menuitem" title="'+t('cs.ol.handoverTitle')+'" '+
        'onclick="openHandoverModal(\''+c.id+'\');closeOrderActions()">'+
        '<span class="vs-act-ico">⛔</span><span class="vs-act-lbl">'+t('cs.ol.mHandover')+'</span></button>';
    }
    // 🗑 Anulare (lágy törlés → Anulat) — csak még nem anulált fuvaron.
    if (!isCancelled) {
      menuItems += '<div class="vs-act-sep"></div>'+
        '<button class="vs-act-item danger" role="menuitem" title="'+t('cs.ol.cancelOrderTitle')+'" '+
        'onclick="cancelOrder(\''+c.id+'\');closeOrderActions()">'+
        '<span class="vs-act-ico">🗑</span><span class="vs-act-lbl">'+t('cs.ol.mCancel')+'</span></button>';
    }

    // Anulált sor: halványítva + áthúzva (látszik, de „holt"); a ✏️ szerkesztés letiltva.
    var rowStyle = isCancelled ? ' style="opacity:.55;"' : '';
    var clientCell = isCancelled
      ? '<span style="text-decoration:line-through;">'+esc(c.client||'—')+'</span> <span class="badge err" style="font-size:10px;">Anulat</span>'
      : esc(c.client||'—');
    var editBtn = isCancelled
      ? '<button class="btn ghost vs-act-edit" title="'+t('cs.ol.cancelledLocked')+'" disabled style="opacity:.5;cursor:not-allowed;">✏️</button>'
      : '<button class="btn primary vs-act-edit" title="'+t('cs.ol.mEdit')+'" onclick="openOrderEdit(\''+c.id+'\')">✏️</button>';
    // Első cella: az ember-olvasható fuvar-szám (CMD-YYYY-XXXX) látszik, ha van;
    // a belső azonosító (orders.id) tooltipben elérhető (támogatáshoz). Régi,
    // fuvar_no nélküli fuvarnál visszaesik a belső id-re.
    var idCell = c.fuvar_no
      ? '<b>'+esc(c.fuvar_no)+'</b>'
      : '<b>'+esc(String(c.id))+'</b>';
    // data-label a cellákon: sofőr-módban mobilon a táblázat kártyás nézetté
    // alakul, és a label (Ügyfél/Útvonal/…) a cella elé kerül (CSS ::before).
    return '<tr class="vsl-orow vsl-orow-'+sc+'"'+rowStyle+'><td class="vsl-orow-first" data-label="'+t('list.colId')+'" title="'+esc(String(c.id))+'">'+idCell+'</td><td data-label="'+t('list.colClient')+'">'+clientCell+'</td>'+
      '<td data-label="'+t('list.colRoute')+'">'+routeCell+'</td>'+
      '<td data-label="'+t('list.colKm')+'">'+(c.km||'—')+(c.route_km!=null&&c.route_km!==''?' <span class="badge info" style="font-size:10px;padding:1px 6px;white-space:nowrap;" title="'+t('cs.tt.autoRouteKm')+'">🗺️ '+c.route_km+'</span>':'')+'</td><td data-label="'+t('list.colPrice')+'">'+(c.pret||'—')+'</td>'+
      '<td data-label="'+t('list.colDriver')+'">'+soferCell+'</td><td data-label="'+t('list.colTractor')+'">'+esc(c.rendszam_camion||'—')+'</td>'+
      '<td data-label="'+t('list.colStatus')+'">'+statusSel+'</td>'+
      '<td class="vs-row-actions" id="actcell-'+c.id+'">'+
        editBtn+
        '<button class="btn ghost vs-act-more" data-act-toggle title="'+t('cs.ol.actMenu')+'" '+
          'onclick="toggleOrderActions(\''+c.id+'\',this)">⋯</button>'+
        '<div class="vs-act-menu" id="actmenu-'+c.id+'" role="menu" style="display:none;">'+menuItems+'</div>'+
      '</td>'+
      '<td style="text-align:center;vertical-align:middle;">'+
        '<input type="checkbox" class="orderRowCb" value="'+c.id+'" onchange="updateOrderSelBar()" '+
        'style="width:16px;height:16px;cursor:pointer;accent-color:#6366f1;">'+
      '</td>'+
      '</tr>';
  }).join('');
  updateOrderSelBar();
  decorateUitIndicators(list);
  decorateInvoiceIndicators(list);
  // A friss sorokra (szűrés/keresés esetén is) alkalmazzuk a mentett
  // oszlop-sorrendet — a sorok kanonikus sorrendben renderelődnek.
  var _ot = document.getElementById('tblOrders');
  if(_ot && _ot._colEnhanced) _applyColOrder(_ot, 'vs-cols-orders');
}

// ── PDF-sablon (order típus) betöltése a Fuvar-lista nyomtatáshoz ──
// A pdf_templates.order beállításait (fejléc/lábléc/akcent/logó) használja.
// Cégenkénti, session-szűrt; a logó a hitelesített /api/branding/logo-ból.
// Best-effort: ha nincs/hiba, az alap (sablon nélküli) nyomtatás megy.
function _vsEnsureOrderPdfTpl(cb){
  if(window._vsOrderPdfTpl){ cb(window._vsOrderPdfTpl); return; }
  try{
    gas('pdfTemplateGet',['order']).then(function(r){
      var tpl=(r&&r.ok&&r.template)||{};
      var fin=function(){ window._vsOrderPdfTpl=tpl; cb(tpl); };
      if(tpl.show_logo!==false){
        fetch('/api/branding/logo').then(function(x){return x.json();}).then(function(lg){
          if(lg&&lg.has&&lg.dataUri) tpl._logo=lg.dataUri;
          fin();
        }).catch(fin);
      } else { fin(); }
    }).catch(function(){ window._vsOrderPdfTpl={}; cb({}); });
  }catch(e){ window._vsOrderPdfTpl={}; cb({}); }
}

function downloadSelectedOrders() {
  var checked = document.querySelectorAll('.orderRowCb:checked');
  if (!checked.length) { toast(t('cs.pickAtLeastOne'), 'err'); return; }
  _vsEnsureOrderPdfTpl(function(_pdfTpl){ _downloadSelectedOrdersBuild(_pdfTpl); });
}

function _downloadSelectedOrdersBuild(_pdfTpl) {
  var checked = document.querySelectorAll('.orderRowCb:checked');
  if (!checked.length) { toast(t('cs.pickAtLeastOne'), 'err'); return; }
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

    // Alap sor
    var out = '<tr style="background:#fff;">'+
      '<td style="font-weight:bold;vertical-align:top;">'+esc(String(c.id))+'</td>'+
      '<td style="vertical-align:top;">'+esc(c.client||'—')+'</td>'+
      '<td style="vertical-align:top;">'+esc(c.ref||'—')+'</td>'+
      '<td style="vertical-align:top;">'+esc(c.loc_incarcare||'—')+'</td>'+
      '<td style="vertical-align:top;">'+esc(c.loc_descarcare||'—')+'</td>'+
      '<td style="text-align:right;vertical-align:top;">'+esc(String(c.km||'—'))+'</td>'+
      '<td style="text-align:right;vertical-align:top;">'+esc(String(c.pret||'—'))+'</td>'+
      '<td style="vertical-align:top;">'+esc(soferInfo)+
        (legCount > 0 ? ' <b style="color:#6366f1;font-size:10px;">(+'+legCount+t('cs.pr.legCount')+')</b>' : '')+
      '</td>'+
      '<td style="vertical-align:top;">'+esc(c.rendszam_camion||'—')+(c.rendszam_remorca?' / '+esc(c.rendszam_remorca):'')+'</td>'+
      '<td style="text-align:center;vertical-align:top;font-weight:700;">'+esc(c.status||'—')+'</td>'+
    '</tr>';

    // Váltás / szakasz alsorok
    legs.forEach(function(l, idx){
      out += '<tr style="background:#eef3ff;">'+
        '<td style="padding-left:18px;font-size:11px;color:#444;border-left:3px solid #2563eb;">↳ '+(idx+1)+t('cs.pr.legRow')+'</td>'+
        '<td colspan="2" style="font-size:11px;color:#666;font-style:italic;">'+t('cs.pr.legSection')+'</td>'+
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

  // ── PDF-sablon (order típus) alkalmazása — fejléc/lábléc/akcent/logó ──
  var _tpl = _pdfTpl || {};
  var _accent = (typeof _tpl.accent_color === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(_tpl.accent_color)) ? _tpl.accent_color : '#000000';
  var _tplHeader = (_tpl.header_text || '').trim();
  var _tplFooter = (_tpl.footer_text || '').trim();
  var _tplLogo = (_tpl.show_logo !== false && _tpl._logo) ? _tpl._logo : null;
  var _brandBlock = (_tplLogo || _tplHeader)
    ? '<div class="brandhdr">'+(_tplLogo?'<img src="'+_tplLogo+'" alt="logo">':'')+(_tplHeader?'<div class="brandtxt">'+esc(_tplHeader)+'</div>':'')+'</div>'
    : '';
  var _footerBlock = _tplFooter ? '<div class="brandftr">'+esc(_tplFooter)+'</div>' : '';

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">'+
    '<title>'+t('cs.pr.docTitle')+now+'</title>'+
    '<style>'+
    'body{font-family:Arial,sans-serif;padding:24px;font-size:13px;color:#000;}'+
    'h1{font-size:18px;text-align:center;margin:0 0 2px;}'+
    '.sub{text-align:center;font-size:12px;color:#555;margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid '+_accent+';}'+
    '.brandhdr{display:flex;gap:14px;align-items:center;border-bottom:3px solid '+_accent+';padding-bottom:10px;margin-bottom:14px;}'+
    '.brandhdr img{max-height:54px;max-width:160px;}'+
    '.brandhdr .brandtxt{white-space:pre-wrap;font-size:12px;font-weight:600;color:#111;}'+
    'table{width:100%;border-collapse:collapse;margin-top:8px;}'+
    'th{background:#d0d0d0;border:1px solid #aaa;padding:6px 8px;font-size:11px;text-align:left;white-space:nowrap;}'+
    'td{border:1px solid #ddd;padding:5px 8px;vertical-align:top;}'+
    '.legend{font-size:11px;color:#444;margin-top:10px;padding:7px 12px;background:#eef3ff;border-left:3px solid '+_accent+';}'+
    '.brandftr{font-size:11px;color:#555;margin-top:14px;padding-top:8px;border-top:1px solid #ddd;white-space:pre-wrap;}'+
    '.footer{font-size:11px;color:#aaa;margin-top:12px;}'+
    '.no-print{margin-bottom:16px;}'+
    '@media print{.no-print{display:none;}body{padding:10px;}}'+
    '</style></head><body>'+
    '<div class="no-print"><button onclick="window.print()" style="padding:10px 24px;background:#0f172a;color:#fff;font-weight:bold;border:none;border-radius:6px;font-size:14px;cursor:pointer;">'+t('cs.pr.printBtn')+'</button></div>'+
    _brandBlock+
    '<h1>'+t('cs.pr.heading')+'</h1>'+
    '<div class="sub">'+t('cs.pr.printedAt')+now+' &nbsp;·&nbsp; '+selected.length+t('cs.pr.orders')+(hasLegs?' &nbsp;·&nbsp; <span style="color:'+_accent+';font-weight:700;">'+t('cs.pr.blueLegs')+'</span>':'')+'</div>'+
    '<table><thead><tr>'+
    '<th>#ID</th><th>'+t('st.cClient')+'</th><th>'+t('cs.pr.colRef')+'</th><th>'+t('cs.pr.colLoad')+'</th><th>'+t('cs.pr.colUnload')+'</th>'+
    '<th>KM</th><th>'+t('cs.pr.colPrice')+'</th><th>'+t('cs.pr.colDriver')+'</th><th>'+t('cs.pr.colVehicle')+'</th><th>'+t('st.cStatus')+'</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table>'+
    (hasLegs ? '<div class="legend">'+t('cs.pr.legend')+'</div>' : '')+
    _footerBlock+
    '<div class="footer">'+t('cs.pr.footer')+now+'</div>'+
    '</body></html>';

  var blob = new Blob([html], {type:'text/html;charset=utf-8'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'fuvarok-'+now.replace(/\./g,'-')+'.html';
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1000);
  toast(t('cs.downloadedLegs'), 'ok');
}

function createDraggableItem(dataUrl, type){
  const stage = document.getElementById('signPdfStage');
  const box = document.createElement('div');
  box.style.cssText='position:absolute;left:40px;top:40px;width:160px;border:2px dashed #2d7;'
    +'cursor:move;touch-action:none;background:rgba(255,255,255,0.15);box-sizing:border-box;';
  const img = document.createElement('img');
  img.src=dataUrl;
  img.style.cssText='width:100%;display:block;pointer-events:none;user-select:none;';
  box.appendChild(img);

  const handle=document.createElement('div');
  handle.style.cssText='position:absolute;right:-8px;bottom:-8px;width:18px;height:18px;'
    +'background:#2d7;border:2px solid #fff;border-radius:50%;cursor:nwse-resize;touch-action:none;';
  box.appendChild(handle);

  const del=document.createElement('div');
  del.textContent='✕';
  del.style.cssText='position:absolute;right:-8px;top:-12px;width:20px;height:20px;line-height:18px;'
    +'text-align:center;background:#e44;color:#fff;border-radius:50%;cursor:pointer;font-size:12px;';
  box.appendChild(del);

  const item={pageNum:signCurrentPage, type, dataUrl, el:box};
  del.onclick=(e)=>{ e.stopPropagation(); box.remove(); placedItems=placedItems.filter(x=>x!==item); };

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

  let resizing=false, startW=0, startX=0;
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

function openOrderEdit(id) {
  _oeOrderId = id;
  document.getElementById('oeModalId').textContent = id;

  // Adatok betöltése. A getOrderById közvetlen fetch-csel megy, mert a gas()
  // a d.result-ot adja vissza, itt viszont a d.legs is kell — ezért NEM kérjük
  // le még egyszer a Promise.all-ban (korábban duplán futott).
  Promise.all([
    gas('userListAll'),
    gas('vehicleList'),
    gas('carrierVehicleList')
  ]).then(function(results) {
    fetch('/api/execute', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({functionName:'getOrderById',arguments:[id]})})
    .then(r=>r.json()).then(function(d) {
      var o = d.result;
      var legs = d.legs || [];
      if (!o) { toast(t('common.notFound'),'err'); return; }

      document.getElementById('oeClient').value = o.client||'';
      document.getElementById('oeRef').value = o.ref||'';
      // Importált extra adatok (CSV-import nem párosított oszlopai) — csak nézet
      var oeIe = document.getElementById('oeImportExtra');
      if(oeIe){
        var ie=o.import_extra; if(typeof ie==='string'){ try{ ie=JSON.parse(ie); }catch(e){ ie=null; } }
        if(ie && typeof ie==='object' && Object.keys(ie).length){
          oeIe.innerHTML='<div class="glass-soft" style="padding:10px 12px;border:1px solid rgba(59,130,246,0.35);">'
            +'<div class="text-primary" style="font-size:12px;font-weight:700;margin-bottom:6px;">'+t('cs.oe.importExtra')+'<span class="text-muted" style="font-weight:400;">'+t('cs.oe.importExtraSub')+'</span></div>'
            +'<div style="display:flex;flex-wrap:wrap;gap:6px;">'
            +Object.keys(ie).map(function(k){ return '<span class="badge" style="background:rgba(255,255,255,0.05);color:var(--text-muted);font-size:11px;">'+esc(k)+': <b class="text-primary">'+esc(String(ie[k]))+'</b></span>'; }).join('')
            +'</div></div>';
        } else { oeIe.innerHTML=''; }
      }
      document.getElementById('oeLocInc').value = o.loc_incarcare||'';
      document.getElementById('oeLocDesc').value = o.loc_descarcare||'';
      document.getElementById('oeDataInc').value = o.data_incarcare ? o.data_incarcare.split('T')[0] : '';
      document.getElementById('oeDataDesc').value = o.data_descarcare ? o.data_descarcare.split('T')[0] : '';
      document.getElementById('oePret').value = o.pret||0;
      document.getElementById('oeKm').value = o.km||0;
      var oeSulyEl = document.getElementById('oeSuly'); if(oeSulyEl) oeSulyEl.value = (o.suly_kg==null?'':o.suly_kg);
      var oeFtlEl = document.getElementById('oeFtl'); if(oeFtlEl) oeFtlEl.checked = (o.load_type==='FTL');
      var oeLtlEl = document.getElementById('oeLtl'); if(oeLtlEl) oeLtlEl.checked = (o.load_type==='LTL');
      var oeHoEl = document.getElementById('oeHossz'); if(oeHoEl) oeHoEl.value = (o.hossz_cm==null?'':o.hossz_cm);
      var oeSzEl = document.getElementById('oeSzel');  if(oeSzEl) oeSzEl.value = (o.szel_cm==null?'':o.szel_cm);
      var oeMaEl = document.getElementById('oeMag');   if(oeMaEl) oeMaEl.value = (o.mag_cm==null?'':o.mag_cm);
      if(typeof refreshDimReq==='function') refreshDimReq();
      var oeTollEl = document.getElementById('oeToll'); if(oeTollEl) oeTollEl.value = (o.toll_cost==null?'':o.toll_cost);
      var tg=o.toll_geo; if(typeof tg==='string'){ try{ tg=JSON.parse(tg); }catch(e){ tg=null; } }
      if(typeof renderTollBreak==='function') renderTollBreak(tg);
      var oeCcEl=document.getElementById('oeCarrierCost'); if(oeCcEl) oeCcEl.value=(o.carrier_cost==null?'':o.carrier_cost);
      if(typeof ensureCarriers==='function') ensureCarriers(function(){ fillCarrierSelect('oeCarrier', o.carrier_id); oeUpdateMargin(); });
      // RO e-Transport mezők feltöltése
      var oeNcEl=document.getElementById('oeNcCode'); if(oeNcEl) oeNcEl.value=(o.nc_code||'');
      var oeMvEl=document.getElementById('oeMarfaValue'); if(oeMvEl) oeMvEl.value=(o.marfa_value==null?'':o.marfa_value);
      var oeMcEl=document.getElementById('oeMarfaCurrency'); if(oeMcEl) oeMcEl.value=(o.marfa_currency||'RON');
      var oeNuEl=document.getElementById('oeNeedsUit'); if(oeNuEl) oeNuEl.checked=!!o.needs_uit;
      document.getElementById('oeStatus').value = o.status||'Disponibil';
      document.getElementById('oeSoferType').value = o.sofer_type||'';

      // Térképes útvonal-előnézet állapota a mentett route_geo-ból (ha van + a kapcsoló be)
      if(typeof resetRouteState==='function') resetRouteState('edit');
      if(_orderMapOn){
        // Az útdíj-sori 🗺️ gomb mindig elérhető a szerkesztőben (a térkép nyitásakor számol)
        var oeTmb=document.getElementById('oeTollMapBtn'); if(oeTmb) oeTmb.style.display='';
        var rg=o.route_geo; if(typeof rg==='string'){ try{ rg=JSON.parse(rg); }catch(e){ rg=null; } }
        if(rg && Array.isArray(rg.waypoints) && rg.waypoints.length>=2){
          _rmState.edit={ via: rg.waypoints.filter(function(w){return w.type==='waypoint';})
                              .map(function(w){ return { address:w.address, lat:w.lat, lng:w.lng }; }),
            km:rg.km, dur:rg.durationSeconds, polyline:[], waypoints:rg.waypoints, kmAuto:false, lastKey:null };
          var oeBtn=document.getElementById('oeMapBtn'); if(oeBtn) oeBtn.style.display='';
        }
      }

      // Sofőr dropdown
      var users = results[0] || [];
      _oeSoferCache = users.filter(u => u.pozicio === 'Sofer');
      var sel = document.getElementById('oeEmailSofer');
      sel.innerHTML = '<option value="">'+t('edit.choose')+'</option>' +
        _oeSoferCache.map(u => '<option value="'+esc(u.email)+'"'+(u.email===o.email_sofer?' selected':'')+'>'+esc(u.nume)+' ('+esc(u.email)+')</option>').join('');

      // Jármű dropdown
      var vehicles = results[1] || [];
      _oeCamionCache = vehicles.filter(v => v.tip === 'Vontato');
      _oeRemorcaCache = vehicles.filter(v => v.tip === 'Potkocsi');
      var carrierVehs = (results[2] && results[2].ok && results[2].items) ? results[2].items : [];
      var camSel = document.getElementById('oeCamion');
      // Carrier jármű optgroup csoportosítva carrier neve szerint
      var carrierGroups = {};
      carrierVehs.forEach(function(cv) {
        var k = esc(cv.carrier_nev || t('cs.ca.title'));
        if (!carrierGroups[k]) carrierGroups[k] = [];
        carrierGroups[k].push(cv);
      });
      var carrierOptHtml = Object.keys(carrierGroups).sort().map(function(nev) {
        return '<optgroup label="🚚 '+nev+'">'
          + carrierGroups[nev].map(function(cv) {
              return '<option value="'+esc(cv.rendszam_camion)+'"'+(cv.rendszam_camion===o.rendszam_camion?' selected':'')+'>'
                +esc(cv.rendszam_camion)+(cv.marca?' — '+esc(cv.marca):'')+' ('+esc(cv.carrier_nev||nev)+')'+'</option>';
            }).join('')
          + '</optgroup>';
      }).join('');
      camSel.innerHTML = '<option value="">'+t('edit.noneDash')+'</option>'
        + (_oeCamionCache.length ? '<optgroup label="'+t('cs.ownVehicles')+'">'
            + _oeCamionCache.map(v => '<option value="'+esc(v.rendszam)+'"'+(v.rendszam===o.rendszam_camion?' selected':'')+'>'+esc(v.rendszam)+(v.marca?' — '+esc(v.marca):'')+'</option>').join('')
            + '</optgroup>' : '')
        + carrierOptHtml;
      // Pótkocsi is kiegészül a carrier pótkocsi rendszámokkal
      var carrierRemHtml = carrierVehs.filter(function(cv){ return cv.rendszam_remorca; }).length
        ? '<optgroup label="🚚 '+t('cs.ca.title')+'">'
          + carrierVehs.filter(function(cv){ return cv.rendszam_remorca; })
              .map(function(cv){ return '<option value="'+esc(cv.rendszam_remorca)+'"'+(cv.rendszam_remorca===o.rendszam_remorca?' selected':'')+'>'+esc(cv.rendszam_remorca)+'</option>'; }).join('')
          + '</optgroup>'
        : '';
      var remSel = document.getElementById('oeRemorca');
      remSel.innerHTML = '<option value="">'+t('edit.noneDash')+'</option>'
        + (_oeRemorcaCache.length ? '<optgroup label="'+t('cs.ownVehicles')+'">'
            + _oeRemorcaCache.map(v => '<option value="'+esc(v.rendszam)+'"'+(v.rendszam===o.rendszam_remorca?' selected':'')+'>'+esc(v.rendszam)+(v.marca?' — '+esc(v.marca):'')+'</option>').join('')
            + '</optgroup>' : '')
        + carrierRemHtml;

      // Auto-párosítás a szerkesztőben (vehicles.assigned_driver_email):
      // jármű-választásra a párosított sofőr töltődik (és fordítva) —
      // csak ÜRES mezőbe, láthatóan, szabadon átírhatóan.
      camSel.onchange = function(){
        if (!camSel.value || sel.value) return;
        if (document.getElementById('oeSoferType').value === 'Extern') return;
        var v = _oeCamionCache.find(function(x){ return x.rendszam === camSel.value; });
        var email = v && v.assigned_driver_email ? String(v.assigned_driver_email).toLowerCase() : '';
        if (!email) return;
        var u = _oeSoferCache.find(function(x){ return String(x.email).toLowerCase() === email; });
        if (!u) return;
        document.getElementById('oeSoferType').value = 'Intern';
        oeToggleSoferType();
        sel.value = u.email;
        toast(t('cs.pairedDriver')+u.nume+t('cs.oe.modifiable'),'ok');
      };
      sel.onchange = function(){
        if (!sel.value || camSel.value) return;
        var email = String(sel.value).toLowerCase();
        var v = _oeCamionCache.find(function(x){ return String(x.assigned_driver_email||'').toLowerCase() === email; });
        if (!v) return;
        camSel.value = v.rendszam;
        toast(t('cs.pairedVehicle')+v.rendszam+t('cs.oe.modifiable'),'ok');
      };

      if (o.sofer_type === 'Extern') {
        document.getElementById('oeNumeSoferExtern').value = o.nume_sofer||'';
        document.getElementById('oeFirmaExtern').value = o.firma_extern||'';
      }
      oeToggleSoferType();

      // Legs renderelése
      renderOeLegs(legs);

      document.getElementById('orderEditModal').classList.add('open');
    });
  });
}

function renderOeLegs(legs) {
  var el = document.getElementById('oeLegsList');
  if (!legs.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px;">'+t('cs.oe.noLeg')+'</div>';
    return;
  }
  el.innerHTML = legs.map(function(leg) {
    return '<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:13px;display:flex;justify-content:space-between;align-items:center;">'
      + '<div>'
      + '<b style="color:var(--text-primary,#e9eef5);">' + leg.leg_number + t('cs.oe.legSection') + '</b>'
      + (leg.rendszam_camion ? ' &nbsp;🚛 ' + leg.rendszam_camion : '')
      + (leg.rendszam_remorca ? ' + ' + leg.rendszam_remorca : '')
      + (leg.nume_sofer ? ' &nbsp;👤 ' + leg.nume_sofer : '')
      + (leg.loc_preluare ? ' &nbsp;📍 ' + leg.loc_preluare : '')
      + '</div>'
      + '<button onclick="deleteLeg('+leg.id+')" style="background:none;border:none;color:var(--err);cursor:pointer;font-size:16px;">✕</button>'
      + '</div>';
  }).join('');
}

function oeAddLeg() {
  var camSel = document.getElementById('oeCamion');
  var remSel = document.getElementById('oeRemorca');
  var soferSel = document.getElementById('oeEmailSofer');
  var soferType = document.getElementById('oeSoferType').value;
  var selectedUser = _oeSoferCache.find(u => u.email === soferSel.value);

  var leg = {
    sofer_type: soferType||null,
    email_sofer: soferSel.value||null,
    nume_sofer: selectedUser ? selectedUser.nume : (document.getElementById('oeNumeSoferExtern').value||null),
    firma_extern: document.getElementById('oeFirmaExtern').value||null,
    rendszam_camion: camSel.value||null,
    rendszam_remorca: remSel.value||null,
    loc_preluare: document.getElementById('oeLocInc').value||null,
    data_preluare: document.getElementById('oeDataInc').value||null
  };

  gas('addOrderLeg', [_oeOrderId, leg]).then(function(r) {
    if (r && r.ok) {
      toast(t('cs.legAdded'), 'ok');
      // Frissítsük a legs listát
      fetch('/api/execute', {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({functionName:'getOrderById',arguments:[_oeOrderId]})})
      .then(r=>r.json()).then(d => renderOeLegs(d.legs||[]));
    } else { toast(r&&r.err||t('common.error'),'err'); }
  });
}

function saveOrderEdit() {
  var soferType = document.getElementById('oeSoferType').value;
  var soferSel = document.getElementById('oeEmailSofer');
  var selectedUser = _oeSoferCache.find(u => u.email === soferSel.value);

  var payload = {
    client:           document.getElementById('oeClient').value,
    ref:              document.getElementById('oeRef').value,
    loc_incarcare:    document.getElementById('oeLocInc').value,
    loc_descarcare:   document.getElementById('oeLocDesc').value,
    data_incarcare:   document.getElementById('oeDataInc').value||null,
    data_descarcare:  document.getElementById('oeDataDesc').value||null,
    pret:             document.getElementById('oePret').value,
    km:               document.getElementById('oeKm').value,
    suly_kg:          (document.getElementById('oeSuly')||{}).value||null,
    toll_cost:        (document.getElementById('oeToll')||{}).value||null,
    carrier_id:       (document.getElementById('oeCarrier')||{}).value||null,
    carrier_cost:     (document.getElementById('oeCarrierCost')||{}).value||null,
    nc_code:          (document.getElementById('oeNcCode')||{}).value||null,
    marfa_value:      (document.getElementById('oeMarfaValue')||{}).value||null,
    marfa_currency:   (document.getElementById('oeMarfaCurrency')||{}).value||'RON',
    needs_uit:        !!(document.getElementById('oeNeedsUit')||{}).checked,
    load_type:        loadTypeValue('oeFtl','oeLtl'),
    hossz_cm:         (document.getElementById('oeHossz')||{}).value||null,
    szel_cm:          (document.getElementById('oeSzel')||{}).value||null,
    mag_cm:           (document.getElementById('oeMag')||{}).value||null,
    route_geo:        buildRouteGeo('edit'),
    status:           document.getElementById('oeStatus').value,
    sofer_type:       soferType||null,
    email_sofer:      soferType==='Intern' ? soferSel.value : null,
    nume_sofer:       soferType==='Intern' ? (selectedUser ? selectedUser.nume : '')
                       : soferType==='Extern' ? document.getElementById('oeNumeSoferExtern').value : null,
    firma_extern:     soferType==='Extern' ? document.getElementById('oeFirmaExtern').value : null,
    rendszam_camion:  document.getElementById('oeCamion').value||null,
    rendszam_remorca: document.getElementById('oeRemorca').value||null,
  };
  // Ha nem Extern a fuvar, az elavult alvállalkozói telefonszám/külső-sofőr-id
  // törlődjön a DB-ből (a szerkesztő ezeket nem rögzíti, csak nullázza).
  if (soferType !== 'Extern') { payload.telefon_extern = null; payload.external_driver_id = null; }
  // A már létező fuvart nem blokkoljuk: a típus üresen maradhat.
  // Csak ha LTL-re állítják, akkor kötelezők a méretek.
  if(payload.load_type==='LTL' && (!payload.hossz_cm||!payload.szel_cm||!payload.mag_cm)){toast(t('cs.ltlDimsReq'),'err');return;}

  gas('comUpdate', [_oeOrderId, payload]).then(function(r) {
    if (r && r.ok) {
      toast(t('common.savedOk'), 'ok');
      closeOrderEditModal();
      loadOrders();
    } else { toast(r&&r.err||t('common.error'),'err'); }
  });
}

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
  // Push ertesites kuldese a cimzettnek
  if(window.VS_PUSH){
    var roomId=_chatCurrentRoom;
    // DM szobaban a masik felet ertesitjuk, csoportban a sofőröket
    var toEmails=[];
    var toRoles=[];
    if(roomId.startsWith('dm_')){
      // Kiszurjuk a masik felet a room ID-bol
      var inner=roomId.replace('dm_','');
      var parts=inner.split('_X_');
      if(parts.length===2){
        var myEsc=(_meChat.email||'').toLowerCase().replace(/@/g,'__').replace(/\./g,'_d_');
        var otherEsc=parts[0]===myEsc?parts[1]:parts[0];
        var otherEmail=otherEsc.replace(/__/g,'@').replace(/_d_/g,'.');
        toEmails=[otherEmail];
      }
    } else if(roomId==='manager'){
      toRoles=['Manager','Admin'];
    } else if(roomId==='admin_manager'){
      toRoles=['Admin','Manager'];
    }
    VS_PUSH.notifyChat({
      toEmails:toEmails,
      toRoles:toRoles,
      fromName:_meChat.nume,
      text:text,
      room:roomId,
      companyId:_chatCompanyId
    });
  }
}

/* ════════════════════════════════════════════════════════════
   FIZETÉS RÖGZÍTÉSE (💰 gomb a Finalizat fuvarokon) — közös
   admin/manager kód. Részfizetés kézzel, teljes hátralék egy
   gombnyomásra. Backend: markOrderPayment (statisticsHandlers).
   ════════════════════════════════════════════════════════════ */
var _payOrderId=null, _payPret=0, _payPaid=0;

// pret/paid opcionális — ha nincs megadva (fuvarlistából hívva),
// a _ordersAllCache-ből vesszük; a Pénzügy riport átadja közvetlenül.
function openPaymentModal(id, pret, paid){
  _payOrderId=id;
  if(pret==null){
    var c=(window._ordersAllCache||[]).find(function(x){return String(x.id)===String(id);});
    pret=c?parseFloat(c.pret)||0:0;
    paid=c?parseFloat(c.paid_amount)||0:0;
  }
  _payPret=parseFloat(pret)||0;
  _payPaid=parseFloat(paid)||0;
  var marad=Math.max(_payPret-_payPaid,0);
  document.getElementById('payOrderId').textContent=id;
  document.getElementById('payPretLbl').textContent=_payPret.toLocaleString('hu-HU');
  document.getElementById('payPaidLbl').textContent=_payPaid.toLocaleString('hu-HU');
  document.getElementById('payRemainLbl').textContent=marad.toLocaleString('hu-HU');
  document.getElementById('payAmount').value='';
  document.getElementById('payNote').value='';
  var rb=document.getElementById('payResetBtn');
  if(rb) rb.style.display=_payPaid>0?'':'none';
  document.getElementById('payModal').classList.add('open');
  setTimeout(function(){document.getElementById('payAmount').focus();},150);
}

function closePaymentModal(){ document.getElementById('payModal').classList.remove('open'); }

// „Teljes hátralék” gomb — a maradék összeget tölti az input-ba
function payFillFull(){
  var marad=Math.max(_payPret-_payPaid,0);
  document.getElementById('payAmount').value=marad>0?marad:_payPret;
}

function savePayment(){
  var amount=parseFloat(document.getElementById('payAmount').value);
  if(!isFinite(amount)||amount<=0){ toast(t('cs.validAmount'),'err'); return; }
  var p={
    amount:amount,
    method:document.getElementById('payMethod').value,
    note:document.getElementById('payNote').value.trim()
  };
  gas('markOrderPayment',[_payOrderId,p]).then(function(r){
    if(r&&r.ok){
      toast(r.payment_status==='paid'?t('cs.fullyPaid'):t('cs.partialPaySaved'),'ok');
      closePaymentModal();
      _afterPaymentRefresh();
    } else toast((r&&r.err)||'Hiba','err');
  });
}

function resetPayment(){
  if(!confirm(t('cs.cf.resetPay'))) return;
  gas('markOrderPayment',[_payOrderId,{reset:true}]).then(function(r){
    if(r&&r.ok){ toast(t('cs.payReset'),'ok'); closePaymentModal(); _afterPaymentRefresh(); }
    else toast((r&&r.err)||'Hiba','err');
  });
}

/* ── 🌍 Ügyfél tracking-link másolása (publikus /t/<token> oldal) ── */
function copyTrackingLink(orderId){
  gas('getTrackingLink',[orderId]).then(function(r){
    if(!r||!r.ok){ toast((r&&r.err)||'Hiba a link generálásánál','err'); return; }
    var url=location.origin+'/t/'+r.token;
    function done(){ toast(t('cs.trackLinkCopied'),'ok'); }
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(done).catch(function(){ prompt(t('cs.cf.copyLink'),url); });
    } else { prompt(t('cs.cf.copyLink'),url); }
  });
}

// Frissítés mentés után: fuvarlista, ha nyitva + Pénzügy riport, ha nyitva
function _afterPaymentRefresh(){
  var ordersPane=document.querySelector('.pane[data-pane="orders-list"]');
  if(ordersPane && !ordersPane.classList.contains('hidden') && typeof loadOrders==='function') loadOrders();
  var finPane=document.querySelector('.pane[data-pane="stats-finance"]');
  if(finPane && !finPane.classList.contains('hidden') && window.VS_STATS) VS_STATS.load('stats-finance');
  var ovPane=document.querySelector('.pane[data-pane="stats-overview"]');
  if(ovPane && !ovPane.classList.contains('hidden') && window.VS_STATS) VS_STATS.load('stats-overview');
}

/* ════════════════════════════════════════════════════════════
   ⛔ ÁRU-LEADÁS (megszakított fuvar) + 📦 RAKTÁR FÜL
   Közös admin/manager kód — a modal JS-ből épül (nincs HTML-duplikáció).
   ════════════════════════════════════════════════════════════ */
var _hoOrderId=null, _hoMode='direct'; // 'direct' = azonnali | 'confirm' = sofőr-kérés visszaigazolása

function ensureHandoverModal(){
  if(document.getElementById('handoverModal'))return;
  var d=document.createElement('div');
  d.id='handoverModal'; d.className='modal-back';
  d.innerHTML=
    '<div class="modal glass" style="max-width:520px;">'+
    '<h3 id="hoTitle">'+t('cs.ho.title')+'</h3>'+
    '<div class="text-muted" id="hoSub" style="font-size:12.5px;margin-bottom:12px;"></div>'+
    '<div class="field"><label>'+t('cs.ho.whatHappens')+'</label>'+
      '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:4px;">'+
      '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;"><input type="radio" name="hoType" value="trailer" checked onchange="hoTypeChange()"> '+t('cs.ho.parkTrailer')+'</label>'+
      '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;"><input type="radio" name="hoType" value="warehouse" onchange="hoTypeChange()"> '+t('cs.ho.toWarehouse')+'</label>'+
      '</div></div>'+
    '<div class="field"><label>'+t('cs.ho.whereCargo')+'</label><input class="input" id="hoLoc" placeholder="pl. Brașov"></div>'+
    '<div class="field"><label>'+t('cs.ho.newDest')+'</label><input class="input" id="hoNewDest" placeholder="'+t('cs.ho.newDestPh')+'"></div>'+
    '<div id="hoWhBlock" style="display:none;">'+
      '<div class="text-muted" style="font-size:12px;font-weight:700;margin:6px 0 8px;">'+t('cs.ho.whData')+'</div>'+
      '<div class="grid-2">'+
      '<div class="field"><label>'+t('cs.ho.qty')+'</label><input class="input" id="hoQty" type="number" min="1" placeholder="pl. 33"></div>'+
      '<div class="field"><label>'+t('cs.ho.unit')+'</label><select class="select" id="hoQtyUnit"><option value="paletta">'+t('cs.ho.uPallet')+'</option><option value="doboz">'+t('cs.ho.uBox')+'</option><option value="egyeb">'+t('cs.ho.uOther')+'</option></select></div>'+
      '</div>'+
      '<div class="grid-3">'+
      '<div class="field"><label>'+t('cs.ho.len')+'</label><input class="input" id="hoLen" type="number" min="1" placeholder="pl. 800"></div>'+
      '<div class="field"><label>'+t('cs.ho.wid')+'</label><input class="input" id="hoWid" type="number" min="1" placeholder="pl. 248"></div>'+
      '<div class="field"><label>'+t('cs.ho.hei')+'</label><input class="input" id="hoHei" type="number" min="1" placeholder="pl. 220"></div>'+
      '</div>'+
      '<div class="grid-2">'+
      '<div class="field"><label>'+t('cs.ho.weight')+'</label><input class="input" id="hoWeight" type="number" min="1" step="0.01" placeholder="pl. 12500"></div>'+
      '<div class="field"><label>'+t('cs.ho.docPages')+'</label><input class="input" id="hoDocPages" type="number" min="1" placeholder="pl. 10"></div>'+
      '</div>'+
      '<div class="text-muted" style="font-size:11.5px;margin-bottom:8px;">'+t('cs.ho.uploadHint')+'</div>'+
    '</div>'+
    '<div class="field"><label>'+t('fld.note')+'</label><input class="input" id="hoNote" placeholder="'+t('fld.notePh')+'"></div>'+
    '<div class="row" style="margin-top:14px;display:flex;gap:10px;">'+
    '<button class="btn ghost col" onclick="closeHandoverModal()">'+t('common.cancel')+'</button>'+
    '<button class="btn primary col" id="hoSubmitBtn" onclick="submitHandover()">'+t('cs.ho.saveBtn')+'</button>'+
    '</div></div>';
  document.body.appendChild(d);
}

function hoTypeChange(){
  var t=(document.querySelector('input[name="hoType"]:checked')||{}).value;
  document.getElementById('hoWhBlock').style.display = t==='warehouse' ? 'block' : 'none';
}

function openHandoverModal(orderId, prefill, mode){
  ensureHandoverModal();
  _hoOrderId=orderId; _hoMode=mode||'direct';
  var p=prefill||{};
  document.getElementById('hoTitle').textContent = _hoMode==='confirm' ? t('cs.ho.confirmTitle') : t('cs.ho.title');
  document.getElementById('hoSub').textContent = t('cs.ho.orderPrefix')+orderId+
    (_hoMode==='confirm' ? t('cs.ho.subConfirm') : t('cs.ho.subDirect'));
  document.getElementById('hoSubmitBtn').textContent = _hoMode==='confirm' ? t('cs.ho.confirmBtn') : t('cs.ho.saveBtn');
  document.querySelectorAll('input[name="hoType"]').forEach(function(r){ r.checked=(r.value===(p.type||'trailer')); });
  document.getElementById('hoLoc').value=p.location||'';
  document.getElementById('hoNewDest').value=p.new_dest||'';
  document.getElementById('hoQty').value=p.qty||'';
  document.getElementById('hoQtyUnit').value=p.qty_unit||'paletta';
  document.getElementById('hoLen').value=p.length_cm||'';
  document.getElementById('hoWid').value=p.width_cm||'';
  document.getElementById('hoHei').value=p.height_cm||'';
  document.getElementById('hoWeight').value=p.weight_kg||'';
  document.getElementById('hoDocPages').value=p.doc_pages||'';
  document.getElementById('hoNote').value=p.note||'';
  hoTypeChange();
  document.getElementById('handoverModal').classList.add('open');
}

function closeHandoverModal(){ document.getElementById('handoverModal').classList.remove('open'); }

function submitHandover(){
  var type=(document.querySelector('input[name="hoType"]:checked')||{}).value;
  var data={
    type:type,
    location:document.getElementById('hoLoc').value.trim(),
    new_dest:document.getElementById('hoNewDest').value.trim()||null,
    note:document.getElementById('hoNote').value.trim()||null,
  };
  if(!data.location){toast(t('cs.handoverLocReq'),'err');return;}
  if(type==='warehouse'){
    data.qty=document.getElementById('hoQty').value;
    data.qty_unit=document.getElementById('hoQtyUnit').value;
    data.length_cm=document.getElementById('hoLen').value;
    data.width_cm=document.getElementById('hoWid').value;
    data.height_cm=document.getElementById('hoHei').value;
    data.weight_kg=document.getElementById('hoWeight').value;
    data.doc_pages=document.getElementById('hoDocPages').value;
  }
  var fn=_hoMode==='confirm'?'confirmHandover':'orderHandover';
  var oid=_hoOrderId;
  gas(fn,[oid,data]).then(function(r){
    if(r&&r.ok){
      toast(type==='trailer'?t('cs.ho.savedTrailer'):t('cs.ho.savedWh'),'ok');
      closeHandoverModal();
      if(typeof loadOrders==='function')loadOrders();
      loadPendingHandovers();
      // Raktárnál azonnali felszólítás a dokumentum-feltöltésre
      if(type==='warehouse'&&typeof openDocModal==='function'){
        setTimeout(function(){ toast(t('cs.uploadDocsNow'),'err'); openDocModal(oid); },400);
      }
    } else toast((r&&r.err)||t('common.error'),'err');
  });
}

/* ── Függő sofőr-leadások bannere (fuvarlista tetején) ── */
var _hoPendingCache=[];
function loadPendingHandovers(){
  var pane=document.querySelector('.pane[data-pane="orders-list"]');
  if(!pane)return;
  var box=document.getElementById('hoPendingBox');
  if(!box){ box=document.createElement('div'); box.id='hoPendingBox'; pane.insertBefore(box,pane.firstChild); }
  gas('getPendingHandovers').then(function(list){
    _hoPendingCache=Array.isArray(list)?list:[];
    if(!_hoPendingCache.length){ box.innerHTML=''; return; }
    box.innerHTML='<div class="glass" style="padding:12px 16px;margin-bottom:14px;border:1px solid rgba(245,158,11,0.5);">'+
      '<div class="text-primary" style="font-weight:800;font-size:13.5px;margin-bottom:6px;">'+t('cs.ho.pendingTitle',{n:_hoPendingCache.length})+'</div>'+
      _hoPendingCache.map(function(o,i){
        return '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--border);font-size:12.5px;">'+
          '<b class="text-primary">'+esc(String(o.id))+'</b>'+
          '<span class="text-muted">'+esc(o.nume_sofer||o.handover_by||'?')+' · '+
          (o.handover_type==='trailer'?t('cs.ho.parkShort'):t('cs.ho.whShort'))+' @ <b>'+esc(o.handover_loc||'?')+'</b>'+
          (o.rendszam_remorca?t('cs.ho.trailerInfo')+esc(o.rendszam_remorca):'')+'</span>'+
          '<span style="margin-left:auto;display:flex;gap:6px;">'+
          '<button class="btn ok" style="padding:4px 12px;font-size:12px;" onclick="hoConfirmIdx('+i+')">'+t('cs.ho.confirmShort')+'</button>'+
          '<button class="btn danger" style="padding:4px 12px;font-size:12px;" onclick="hoRejectIdx('+i+')">'+t('cs.ho.rejectShort')+'</button>'+
          '</span></div>';
      }).join('')+'</div>';
  });
}
window.hoConfirmIdx=function(i){
  var o=_hoPendingCache[i]; if(!o)return;
  var p={};
  try{ p=typeof o.handover_payload==='string'?JSON.parse(o.handover_payload||'{}'):(o.handover_payload||{}); }catch(e){p={};}
  p.type=o.handover_type||p.type; p.location=o.handover_loc||p.location;
  openHandoverModal(o.id,p,'confirm');
};
window.hoRejectIdx=function(i){
  var o=_hoPendingCache[i]; if(!o)return;
  if(!confirm(t('cs.ho.rejectConfirm',{id:o.id})))return;
  gas('rejectHandover',[o.id]).then(function(r){
    if(r&&r.ok){ toast(t('cs.requestRejected'),'ok'); loadPendingHandovers(); if(typeof loadOrders==='function')loadOrders(); }
    else toast((r&&r.err)||t('common.error'),'err');
  });
};

/* ── 📦 RAKTÁR FÜL ── */
function loadWarehouseTab(){
  var box=document.getElementById('warehouseBox');
  if(!box)return;
  box.innerHTML='<div class="glass" style="padding:20px;color:var(--text-muted);">'+t('fe.loading')+'</div>';
  gas('getWarehouseItems').then(function(list){
    list=Array.isArray(list)?list:[];
    var act=list.filter(function(w){return w.status==='Raktarban';});
    var noDocs=act.filter(function(w){return !parseInt(w.doc_count,10);}).length;
    var html='<div class="glass" style="padding:22px;">'+
      '<h2 class="h-title">'+t('cs.wh.title')+'</h2>'+
      '<div class="h-sub">'+t('cs.wh.sub',{n:act.length})+
      (noDocs?t('cs.wh.docMissingCount',{n:noDocs}):'')+'</div></div>';
    if(!list.length){
      html+='<div class="glass text-muted" style="padding:22px;margin-top:16px;">'+t('cs.wh.empty')+'</div>';
      box.innerHTML=html; return;
    }
    html+='<div class="glass" style="padding:22px;margin-top:16px;overflow-x:auto;">'+
      '<table class="table"><thead><tr><th>'+t('st.cOrder')+'</th><th>'+t('st.cClient')+'</th><th>'+t('cs.wh.colWhLoc')+'</th><th>'+t('cs.wh.colQty')+'</th>'+
      '<th>'+t('cs.wh.colSpace')+'</th><th>'+t('cs.wh.colWeight')+'</th><th>'+t('cs.wh.colDocPages')+'</th><th>'+t('cs.wh.colDocs')+'</th><th>'+t('cs.wh.colStored')+'</th><th>'+t('st.cStatus')+'</th><th>'+t('col.action')+'</th></tr></thead><tbody>'+
      list.map(function(w){
        var docs=parseInt(w.doc_count,10)||0;
        var inWh=w.status==='Raktarban';
        var docCell=docs>0
          ?'<span style="color:var(--status-ok);">📷 '+docs+t('cs.wh.pcs')+'</span>'
          :(inWh?'<span class="badge err">'+t('cs.wh.docMissingUpload')+'</span>':'<span class="text-muted">—</span>');
        return '<tr'+(inWh&&!docs?' style="background:rgba(239,68,68,0.06);"':'')+'>'+
          '<td><b>'+esc(String(w.order_id))+'</b></td>'+
          '<td>'+esc(w.client||'—')+'</td>'+
          '<td>'+esc(w.location||'—')+'<div class="text-muted" style="font-size:11px;">'+t('cs.wh.finalDest')+esc(w.loc_descarcare||'—')+'</div></td>'+
          '<td>'+(w.qty||'—')+' '+esc(w.qty_unit||'')+'</td>'+
          '<td>'+(w.length_cm||'—')+' × '+(w.width_cm||'—')+' × '+(w.height_cm||'—')+'</td>'+
          '<td>'+(w.weight_kg||'—')+'</td>'+
          '<td>'+(w.doc_pages||'—')+'</td>'+
          '<td>'+docCell+'</td>'+
          '<td>'+(w.created_at?new Date(w.created_at).toLocaleDateString('hu-HU'):'—')+'</td>'+
          '<td><span class="badge '+(inWh?'warn':'info')+'">'+(inWh?t('cs.wh.inWh'):t('cs.wh.released'))+'</span></td>'+
          '<td style="display:flex;gap:4px;flex-wrap:wrap;">'+
            '<button class="btn ghost" style="padding:4px 10px;font-size:12px;" title="'+t('cs.wh.uploadDocTitle')+'" onclick="openDocModal(\''+esc(String(w.order_id))+'\')">📎</button>'+
            '<button class="btn primary" style="padding:4px 10px;font-size:12px;" title="'+t('cs.wh.editAllocTitle')+'" onclick="openOrderEdit(\''+esc(String(w.order_id))+'\')">✏️</button>'+
          '</td></tr>';
      }).join('')+'</tbody></table></div>';
    box.innerHTML=html;
  });
}

/* ── Pótkocsi rakodási felület — űrlap-segédek ──
   Alapértelmezés ELSŐ bevitelnél: 1360 × 248 cm, magasság standard 260 /
   mega 305 cm — szabadon átírható (a rakodási felület NEM a teljes méret). */
var TRAILER_DEFAULTS={len:1360,wid:248,heiStd:260,heiMega:305};
function ptKindChange(){
  var kind=(document.getElementById('ptKind')||{}).value;
  var hei=document.getElementById('ptCargoHei'); if(!hei)return;
  var v=parseInt(hei.value,10);
  // csak az alapértelmezett értéket cseréljük, kézi beírást nem
  if(!v||v===TRAILER_DEFAULTS.heiStd||v===TRAILER_DEFAULTS.heiMega){
    hei.value=kind==='mega'?TRAILER_DEFAULTS.heiMega:TRAILER_DEFAULTS.heiStd;
  }
}
function resetTrailerFormDefaults(){
  var f=function(id,val){var el=document.getElementById(id);if(el)el.value=val;};
  f('ptKind','standard'); f('ptCargoLen',TRAILER_DEFAULTS.len);
  f('ptCargoWid',TRAILER_DEFAULTS.wid); f('ptCargoHei',TRAILER_DEFAULTS.heiStd);
}
function vehEditKindChange(){
  var kind=(document.getElementById('vehEditTrailerKind')||{}).value;
  var hei=document.getElementById('vehEditCargoHei'); if(!hei)return;
  var v=parseInt(hei.value,10);
  if(!v||v===TRAILER_DEFAULTS.heiStd||v===TRAILER_DEFAULTS.heiMega){
    hei.value=kind==='mega'?TRAILER_DEFAULTS.heiMega:TRAILER_DEFAULTS.heiStd;
  }
}
