// ============================================================
//  VallorSoft — console-shared.js  (OLDAL ALAP)
//  Az admin és manager konzol KÖZÖS, logikailag azonos fuggvenyei.
//  96 fuggveny — itt EGYSZER kell javitani.
//  Betoltes a HTML-ben: ELOBB ez, UTANA admin.js / manager.js.
// ============================================================

// ── Funkció-kapcsolók (előfizetés) — letiltott menük elrejtése ──
// A cég kikapcsolt funkciói nem jelennek meg a sidebarban. Hiányzó kulcs = engedélyezett.
function applyFeatureFlags(){
  if(!window.gas) return;
  gas('getMyFeatures').then(function(r){
    if(!r||!r.ok) return;
    var feats = r.features||{};
    window._vsFeatures = feats;   // nem-menü funkciók (pl. tracking gomb) ellenőrzéséhez
    if(typeof initOrderMapFeature==='function') initOrderMapFeature();   // térképes km/előnézet (opt-in)
    // Fuvar CSV-import gomb elrejtése, ha a developer kikapcsolta (alapból be)
    var _impBtn=document.getElementById('ordersImportBtnBox');
    if(_impBtn) _impBtn.style.display = (feats['orders-import']===false) ? 'none' : '';
    var cat = window.VS_FEATURES||[];
    cat.forEach(function(f){
      if(f.core) return;
      if(feats[f.key]!==false) return; // csak az explicit false rejt
      document.querySelectorAll('.sidebar [data-tab="'+f.key+'"]').forEach(function(el){ el.style.display='none'; });
      if(f.key==='utvonaltervezes'){
        document.querySelectorAll('.sidebar a.tab-link[href="/utvonaltervezes"]').forEach(function(el){ el.style.display='none'; });
      }
    });
    // Üres almenük + szülő-fülek elrejtése
    document.querySelectorAll('.sidebar .menu-group').forEach(function(grp){
      var sub=grp.querySelector('.submenu');
      if(!sub) return;
      var vis=Array.prototype.filter.call(sub.querySelectorAll('.sub-tab'),function(s){return s.style.display!=='none';});
      if(!vis.length){
        var parent=grp.querySelector('.tab[id$="ParentTab"]');
        if(parent) parent.style.display='none';
        sub.style.display='none';
      }
    });
    // Ha az aktív fül időközben rejtett lett -> ugrás a Vezérlőpultra
    var active=document.querySelector('.sidebar .tab.active, .sidebar .sub-tab.active');
    if(active && active.style.display==='none'){ activateTab('dash'); }
  });
}

function activateTab(name){
  document.querySelectorAll('.sidebar .tab, .sidebar .sub-tab').forEach(function(x){x.classList.remove('active');});
  var tabEl=document.querySelector('.sidebar [data-tab="'+name+'"]');
  if(tabEl){
    tabEl.classList.add('active');
    var sub=tabEl.closest?tabEl.closest('.submenu'):null;
    if(sub){var grp=sub.closest?sub.closest('.menu-group'):null;if(grp)grp.classList.add('open');}
  }
  document.querySelectorAll('.pane').forEach(function(p){p.classList.add('hidden');});
  var pane=document.querySelector('.pane[data-pane="'+name+'"]');
  if(pane)pane.classList.remove('hidden');
  try{sessionStorage.setItem('vs_admin_tab',name);}catch(e){}
  loadTab(name);
  // Mobilon a menüpontra koppintás után zárjuk be a drawert, hogy látszódjon a tartalom
  if(window.innerWidth<=768 && typeof closeSidebar==='function') closeSidebar();
}

function addStampToPage(){
  if(!pdfDocProxy){ toast('Előbb töltsd be a PDF-et!','err'); return; }
  if(!savedStampBase64){ toast('Nincs mentett pecsét!','err'); return; }
  createDraggableItem(savedStampBase64,'stamp');
  toast('Pecsét hozzáadva – húzd a helyére','ok');
}

async function burnAndDownloadDoc(){
  toast('Ráégetés folyamatban...','');
  const dataUrl = await buildSignedPdf();
  if(!dataUrl) return;
  const a=document.createElement('a');
  a.href=dataUrl;
  a.download='alairt_megrendelo.pdf';
  a.click();
}

async function burnAndSaveDoc(){
  toast('Ráégetés folyamatban...','');
  const dataUrl = await buildSignedPdf();
  if(!dataUrl) return;
  gas('orderDocSaveSigned',[currentDocId,dataUrl]).then(r=>{
    if(r.ok){ toast('Mentve a rendszerbe!','ok'); loadDocList(currentDocOrderId); closeSignModal(); }
    else{ toast(r.err||'Mentési hiba','err'); }
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
  if(!d.nume&&!d.firma){toast('A sofőr neve vagy a cég neve kötelező!','err');return;}
  gas('extDriverCreate',[d]).then(r=>{if(r.ok){toast('Sofőr hozzáadva!','ok');['edNume','edFirma','edTelefon','edEmail','edCamion','edRemorca','edNota'].forEach(id=>{document.getElementById(id).value='';});loadExtDrivers();}else{toast(r.err||'Hiba történt','err');}});
}

function createInv(){
  var poz   = document.getElementById('invPoz').value;
  var email = document.getElementById('invEmail').value.trim();
  var nume  = document.getElementById('invNume').value.trim();
  var tel   = document.getElementById('invTel').value.trim();
  gas('invCreate',[poz, email, nume, tel]).then(function(r){
    if(r&&r.ok){ toast('✅ Kód: '+r.kod,'ok'); loadInvites();
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

// Általános cím-autocomplete (Photon proxy). onPick(): a kiválasztás után fut.
function vsAttachAutocomplete(inputId, ddId, onPick){
  var input=document.getElementById(inputId), dd=document.getElementById(ddId);
  if(!input||!dd||input._vsAcBound) return; input._vsAcBound=true;
  var timer=null;
  input.addEventListener('input', function(){
    var q=input.value.trim(); if(timer)clearTimeout(timer);
    if(q.length<3){ dd.classList.remove('open'); dd.innerHTML=''; return; }
    timer=setTimeout(function(){
      fetch('/api/geo-autocomplete?q='+encodeURIComponent(q),{credentials:'same-origin'})
        .then(function(r){return r.json();}).then(function(d){
          var items=(d&&d.items)||[];
          if(!items.length){ dd.classList.remove('open'); dd.innerHTML=''; return; }
          dd.innerHTML=items.map(function(it){ var label=it.label||it.title; var main=it.title||label;
            return '<div class="vs-ac-item" data-label="'+esc(label)+'"><div class="ac-main">'+esc(main)+'</div><div class="ac-sub">'+esc(label)+'</div></div>'; }).join('');
          dd.classList.add('open');
          Array.prototype.forEach.call(dd.querySelectorAll('.vs-ac-item'), function(el){
            el.addEventListener('mousedown', function(e){ e.preventDefault();
              input.value=el.getAttribute('data-label'); dd.classList.remove('open'); dd.innerHTML='';
              if(onPick) onPick(); });
          });
        }).catch(function(){ dd.classList.remove('open'); });
    },300);
  });
  input.addEventListener('keydown', function(e){ if(e.key==='Escape') dd.classList.remove('open'); });
}

// Bekötés a fuvar-kiíró + szerkesztő mezőkre (csak ha a kapcsoló BE van).
function initOrderMapFeature(){
  _orderMapOn = !!(window._vsFeatures && window._vsFeatures['order-route-map']===true);
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
  var load=((document.getElementById(c.load)||{}).value||'').trim();
  var unload=((document.getElementById(c.unload)||{}).value||'').trim();
  if(!load||!unload) return null;
  var wps=[{type:'loading',address:load}];
  st.via.forEach(function(v){ wps.push(v.lat!=null?{type:'waypoint',lat:v.lat,lng:v.lng,address:v.address||null}:{type:'waypoint',address:v.address}); });
  wps.push({type:'unloading',address:unload});
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
    +'<div class="rmm-head"><b class="text-primary" style="font-size:15px;">🗺️ Útvonal-előnézet</b>'
    +'<span id="rmmKm" class="badge info" style="margin-left:6px;">—</span>'
    +'<button class="btn ghost" style="margin-left:auto;padding:5px 12px;" onclick="closeRouteMap()">✕ Bezár</button></div>'
    +'<div class="rmm-body">'
    +'<div class="rmm-map" id="rmmMap"></div>'
    +'<div class="rmm-side">'
      +'<div class="text-muted" style="font-size:12px;margin-bottom:10px;line-height:1.45;">A köztespontok <b>csak a km-számításhoz és az útvonal-előnézethez</b> kellenek — NEM megállók. Add hozzá címmel, vagy kapcsold be a térkép-kattintást.</div>'
      +'<div id="rmmViaList"></div>'
      +'<div class="rmm-via"><div class="vs-ac-wrap"><input class="input" id="rmmViaInput" placeholder="Köztespont címe" autocomplete="off"><div class="vs-ac-dd" id="rmmViaInputDD"></div></div>'
      +'<button class="btn ok" style="padding:9px 11px;" onclick="routeMapAddViaFromInput()">➕</button></div>'
      +'<label style="display:flex;align-items:center;gap:7px;font-size:12px;margin-top:10px;cursor:pointer;"><input type="checkbox" id="rmmClickAdd" onchange="_rmClickAdds=this.checked;"> Térképre kattintás = köztespont</label>'
      +'<button class="btn ghost" style="width:100%;margin-top:10px;padding:8px;font-size:12px;" onclick="routeMapClearVia()">Köztespontok törlése</button>'
    +'</div></div></div>';
  document.body.appendChild(d);
  vsAttachAutocomplete('rmmViaInput','rmmViaInputDD',null);
}
function initRouteLeaflet(){
  if(typeof L==='undefined'){ toast('A térkép nem töltődött be.','err'); return; }
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
    var line=L.polyline(st.polyline,{color:'#e10b1a',weight:5,opacity:0.85}).addTo(_rmLayers);
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
  if(!st.via.length){ box.innerHTML='<div class="text-muted" style="font-size:12px;margin-bottom:8px;">Nincs köztespont.</div>'; return; }
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
function routeMapAddViaFromInput(){
  var inp=document.getElementById('rmmViaInput'); var v=(inp&&inp.value||'').trim();
  if(!v||!_rmWhich) return; routeMapAddVia(_rmWhich,{address:v}); if(inp) inp.value='';
}
function routeMapAddVia(which, pt){
  var st=_rmState[which]; if(st.via.length>=7){ toast('Legfeljebb 7 köztespont.','err'); return; }
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
function loadTypeBadge(t, dims){
  var d = dims ? ' <span class="badge" style="font-size:10px;padding:1px 6px;background:rgba(255,255,255,0.06);color:var(--text-muted);" title="Rakomány-méret (h×sz×m cm)">📐 '+dims+'</span>' : '';
  if(t==='FTL')return ' <span class="badge info" title="Full Truck Load — teljes rakomány" style="font-size:10px;padding:1px 6px;">FTL</span>'+d;
  if(t==='LTL')return ' <span class="badge warn" title="Less Than Truckload — részrakomány" style="font-size:10px;padding:1px 6px;">LTL</span>'+d;
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
    +'<div class="oi-head"><b class="text-primary" style="font-size:15px;">📥 Fuvar-CSV import</b>'
    +'<button class="btn ghost" style="margin-left:auto;padding:5px 12px;" onclick="closeOrderImport()">✕ Bezár</button></div>'
    +'<div class="oi-body">'
    +'<div class="text-muted" style="font-size:12px;margin-bottom:10px;line-height:1.5;">Töltsd fel a gyári/szállítói fuvarlistát (.csv). A rendszer felismeri az elválasztót, és fejléc-név alapján automatikusan párosítja az oszlopokat — ellenőrizd/javítsd, majd importálj. <b>A nem párosított oszlopok nem vesznek el:</b> a fuvar „Importált extra adatok" mezőjébe kerülnek (a szerkesztőben megnézhető).</div>'
    +'<div class="field" style="max-width:420px;"><label>CSV fájl</label><input class="input" type="file" id="oiFile" accept=".csv,.txt" onchange="orderImportParse()"></div>'
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
    if(lines.length<2){ toast('A CSV üres vagy csak fejléc.','err'); return; }
    var delim=[';',',','\t','|'].sort(function(a,b){ return lines[0].split(b).length - lines[0].split(a).length; })[0];
    var split=function(l){ return l.split(delim).map(function(c){ return c.replace(/^"|"$/g,'').trim(); }); };
    _oiHeader=split(lines[0]);
    _oiRows=lines.slice(1).map(split);

    var opts='<option value="">— (nincs / extra) —</option>'+_oiHeader.map(function(h,i){ return '<option value="'+i+'">'+esc(h||('oszlop '+(i+1)))+'</option>'; }).join('');
    var cells=OI_FIELDS.map(function(fl){
      return '<div class="field" style="margin:0;"><label>'+esc(fl.label)+'</label>'
        +'<select class="select" id="oiCol_'+fl.k+'" onchange="orderImportPreview()">'+opts+'</select></div>';
    }).join('');
    document.getElementById('oiMapping').innerHTML=
      '<div class="glass-soft" style="padding:14px;">'
      +'<div class="text-primary" style="font-size:13px;font-weight:700;margin-bottom:10px;">Oszlop-párosítás — '+_oiRows.length+' sor (elválasztó: <code>'+(delim==='\t'?'TAB':esc(delim))+'</code>)</div>'
      +'<div class="oi-map-grid">'+cells+'</div>'
      +'<div style="display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap;">'
      +'<button class="btn primary" onclick="orderImportRun(this)">📥 '+_oiRows.length+' fuvar importálása</button>'
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
    ? '⚠️ Nem párosított oszlop ('+unmapped.length+'): <b>'+esc(unmapped.join(', ').slice(0,120))+'</b> → a fuvar „Importált extra adatok" mezőjébe kerül.'
    : '✓ Minden oszlop párosítva.';
  // előnézet: első 3 sor a párosítás szerint
  var cols=OI_FIELDS.filter(function(fl){ return oiColIndex(fl.k)>=0; });
  var head='<tr>'+cols.map(function(fl){ return '<th>'+esc(fl.label)+'</th>'; }).join('')+(unmapped.length?'<th>+ extra</th>':'')+'</tr>';
  var body=_oiRows.slice(0,3).map(function(r){
    var o=oiBuildRow(r);
    return '<tr>'+cols.map(function(fl){ var v=o[fl.k]; return '<td>'+esc(v==null||v===''?'—':String(v))+'</td>'; }).join('')
      +(unmapped.length?'<td class="text-muted">'+esc(o.import_extra?Object.keys(o.import_extra).length+' mező':'—')+'</td>':'')+'</tr>';
  }).join('');
  if(pv) pv.innerHTML='<div class="text-muted" style="font-size:11px;margin-bottom:4px;">Előnézet (első 3 sor):</div><div class="oi-prev"><table><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>';
}
function orderImportRun(btn){
  if(!_oiRows.length){ toast('Előbb tölts fel egy CSV-t!','err'); return; }
  var rows=_oiRows.map(oiBuildRow);
  if(btn){ btn.disabled=true; btn.textContent='Importálás…'; }
  gas('bulkCreateOrders',[{rows:rows}]).then(function(r){
    if(btn){ btn.disabled=false; btn.textContent='📥 '+_oiRows.length+' fuvar importálása'; }
    var res=document.getElementById('oiResult');
    if(r&&r.ok){
      toast('📥 Import kész: '+r.inserted+' fuvar létrehozva'+(r.skipped?(' · '+r.skipped+' kihagyva'):''),'ok');
      if(res) res.innerHTML='<div class="glass-soft" style="padding:12px;border:1px solid rgba(34,197,94,0.4);">'
        +'<b style="color:var(--status-ok);">✅ '+r.inserted+' fuvar létrehozva.</b>'
        +(r.skipped?(' <span class="text-muted">'+r.skipped+' sor kihagyva (üres/hibás).</span>'):'')
        +'</div>';
      if(typeof loadOrders==='function') loadOrders();
    } else { toast((r&&r.err)||'Import hiba','err'); }
  }).catch(function(){ if(btn){btn.disabled=false;} toast('Import hiba','err'); });
}

function createOrder(){
  const st=document.querySelector('input[name="oSoferType"]:checked');
  const type=st?st.value:'None';
  const p={
    client:document.getElementById('oClient').value.trim(),
    ref:document.getElementById('oRef').value.trim(),
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
  if(!p.client){toast('Az ügyfél neve kötelező!','err');return;}
  if(!p.load_type){toast('Válaszd ki a rakomány típusát (FTL / LTL)!','err');return;}
  if(p.load_type==='LTL' && (!p.hossz_cm||!p.szel_cm||!p.mag_cm)){toast('Részrakománynál (LTL) a méretek (hossz/szél./mag.) kötelezők!','err');return;}
  gas('comCreate',[p]).then(r=>{
    if(r&&r.ok){
      let extra='';
      if(r.paired_driver)extra=' · 👤 párosított sofőr: '+r.paired_driver;
      else if(r.paired_vehicle)extra=' · 🚛 párosított jármű: '+r.paired_vehicle;
      if(r.paired_trailer)extra+=' · 🚚 párosított pótkocsi: '+r.paired_trailer;
      toast('Fuvar mentve! ID: '+r.id+extra,'ok');
      loadOrders();
      ['oClient','oRef','oPret','oKm','oSuly','oHossz','oSzel','oMag','oLoad','oUnload','oLoadDate','oUnloadDate','oExternNume','oExternFirma','oExternTelefon'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
      ['oFtl','oLtl'].forEach(id=>{const el=document.getElementById(id);if(el)el.checked=false;});
      refreshDimReq();
      if(typeof resetRouteState==='function')resetRouteState('create');
      document.querySelectorAll('input[name="oSoferType"]').forEach(r=>{if(r.value==='None')r.checked=true;});
      onSoferTypeChange('None');
    }else{toast((r&&r.err)||'Hiba történt','err');}
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
  if(!v.rendszam){toast('A rendszám kötelező!','err');return;}
  gas('vehicleCreate',[v]).then(r=>{if(r.ok){toast((tip==='Vontato'?'Vontató':'Pótkocsi')+' hozzáadva!','ok');['Rendszam','Marca','Model','An','Nota'].forEach(f=>{document.getElementById(prefix+f).value='';});if(tip==='Potkocsi'&&typeof resetTrailerFormDefaults==='function')resetTrailerFormDefaults();loadVehicles();}else{toast(r.err||'Hiba történt','err');}});
}

function deleteExtDriver(id){
  const d=extDriverCache.find(x=>x.id===id);
  const nev=d?(d.nume||d.firma||'?'):'?';
  if(!confirm('Biztosan törlöd: '+nev+'?'))return;
  gas('extDriverDelete',[id]).then(r=>{if(r.ok){toast('Törölve!','ok');loadExtDrivers();}else{toast(r.err||'Hiba történt','err');}});
}

function deleteLeg(legId) {
  if (!confirm('Törlöd ezt a váltást?')) return;
  gas('deleteOrderLeg', [legId]).then(function(r) {
    if (r && r.ok) {
      toast('Törölve','ok');
      fetch('/api/execute', {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({functionName:'getOrderById',arguments:[_oeOrderId]})})
      .then(r=>r.json()).then(d => renderOeLegs(d.legs||[]));
    }
  });
}

function deleteVehicle(id){
  const v=vehicleCache.find(x=>x.id===id);
  const rendszam=v?v.rendszam:'?';
  if(!confirm('Biztosan törlöd a(z) '+rendszam+' rendszámú járművet?'))return;
  gas('vehicleDelete',[id]).then(r=>{if(r.ok){toast('Törölve!','ok');loadVehicles();}else{toast(r.err||'Hiba történt','err');}});
}

function dmRoomId(emailA,emailB){
  var a=emailA.toLowerCase().replace(/@/g,'__').replace(/\./g,'_d_');
  var b=emailB.toLowerCase().replace(/@/g,'__').replace(/\./g,'_d_');
  return 'dm_'+(a<b?a+'_X_'+b:b+'_X_'+a);
}

function editExtDriver(id){
  const d=extDriverCache.find(x=>x.id===id);
  if(!d){toast('Sofőr nem található','err');return;}
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
  if(!v){toast('Jármű nem található','err');return;}
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
        if(el)el.textContent='⚠️ Chat konfiguráció hiányzik. Állítsd be a Firebase env változókat!';
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
      if(el)el.textContent='⚠️ Chat nem elérhető.';
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
  if (container) container.innerHTML = '<div style="text-align:center;color:var(--muted);padding:40px;"><div class="spinner" style="margin:0 auto 10px;"></div>Betöltés...</div>';
  gas('getDriverDocs').then(function(list) {
    _driverDocsCache = list || [];
    var sel = document.getElementById('docFilterSofer');
    if (sel) {
      var sofors = [...new Set(_driverDocsCache.map(function(d){return d.nume_sofer||d.email_sofer;}).filter(Boolean))].sort();
      sel.innerHTML = '<option value="">Összes sofőr</option>' + sofors.map(function(s){return '<option value="'+esc(s)+'">'+esc(s)+'</option>';}).join('');
    }
    renderDocGroups();
  });
}

function loadExtDrivers(){
  gas('extDriverList').then(list=>{
    if(!Array.isArray(list))list=[];
    extDriverCache=list;
    const tb=document.querySelector('#tblExtDrivers tbody');
    if(list.length===0){tb.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--muted);">Nincs még külső sofőr felvéve.</td></tr>';return;}
    tb.innerHTML=list.map(d=>`<tr><td>${esc(d.nume||'—')}</td><td>${esc(d.firma||'—')}</td><td>${esc(d.telefon||'—')}</td><td>${esc(d.email||'—')}</td><td>${esc(d.rendszam_camion||'—')}</td><td>${esc(d.rendszam_remorca||'—')}</td><td>${esc(d.nota||'—')}</td><td><button class="btn primary" style="padding:4px 10px;font-size:12px;" onclick="editExtDriver(${d.id})">Szerk</button> <button class="btn danger" style="padding:4px 10px;font-size:12px;" onclick="deleteExtDriver(${d.id})">Töröl</button></td></tr>`).join('');
  }).catch(function(e){ console.error('loadExtDrivers hiba:', e); toast('Betöltési hiba','err'); });
}

function loadInternalDrivers(){
  // Sofőr-lista + jármű-hozzárendelés (a jármű mellett 🛰️ = GPS-re kötve)
  gas('getDriverVehicleAssignments').then(function(r){
    var tbody = document.querySelector('#tblInternalDrivers tbody');
    if(!tbody) return;
    if(!r || !r.ok){ tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px;">Betöltési hiba.</td></tr>'; return; }
    var list = r.drivers||[];
    var vehicles = r.vehicles||[];
    var trailers = r.trailers||[];
    if(!list.length){
      tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px;">Nincs regisztrált belső sofőr.</td></tr>';
      return;
    }
    // fejléc-frissítés (Jármű oszlop hozzáadása, ha még nincs)
    var thead = document.querySelector('#tblInternalDrivers thead tr');
    if(thead && thead.children.length === 4){
      var th = document.createElement('th');
      th.textContent = '🚛 Hozzárendelt jármű';
      thead.insertBefore(th, thead.children[3]);
    }
    // XSS-védelem: a sor-adatot gyorsítótárból (index alapján) adjuk át, NEM HTML-attribútumba ágyazva
    window._vsIntDrvCache = list;
    tbody.innerHTML = list.map(function(d, i){
      var myVeh = vehicles.find(function(v){ return (v.assigned_driver_email||'').toLowerCase() === d.email.toLowerCase(); });
      var opts = '<option value="">— Nincs jármű —</option>' + vehicles.map(function(v){
        var takenBy = v.assigned_driver_email && v.assigned_driver_email.toLowerCase() !== d.email.toLowerCase();
        var lbl = v.rendszam + (v.has_gps ? ' 🛰️' : '') + (v.marca ? ' — ' + v.marca : '') + (takenBy ? ' (más sofőrnél)' : '');
        return '<option value="'+v.id+'"'+(myVeh && myVeh.id===v.id ? ' selected':'')+'>'+esc(lbl)+'</option>';
      }).join('');
      var gpsBadge = myVeh
        ? (myVeh.has_gps
            ? ' <span class="badge ok" title="A jármű GPS-re van kötve (CargoTrack)">🛰️ GPS</span>'
            : ' <span class="badge warn" title="A jármű nincs GPS-re kötve — párosítsd az Integrációk fülön">GPS nélkül</span>')
        : '';
      // Alapértelmezett pótkocsi a hozzárendelt vontatóhoz (auto-párosítás
      // fuvar-kiíráskor) — csak ha a sofőrnek van vontatója.
      var trailerSel = '';
      if(myVeh){
        var topts = '<option value="">— Nincs alapért. pótkocsi —</option>' + trailers.map(function(t){
          var lbl = t.rendszam + (t.marca ? ' — ' + t.marca : '');
          return '<option value="'+t.id+'"'+(String(myVeh.default_trailer_id)===String(t.id)?' selected':'')+'>'+esc(lbl)+'</option>';
        }).join('');
        trailerSel = '<div style="margin-top:5px;">'
          +'<select class="select" style="max-width:230px;padding:6px 8px;font-size:12px;display:inline-block;" '
          +'title="🚚 Alapértelmezett pótkocsi — fuvar-kiíráskor automatikusan kitöltődik (módosítható)" '
          +'onchange="assignDefaultTrailerUi('+myVeh.id+', this.value)">'+topts+'</select></div>';
      }
      return '<tr>'
        +'<td>'+esc(d.nume)+'</td>'
        +'<td>'+esc(d.email)+'</td>'
        +'<td>'+esc(d.tel||'—')+'</td>'
        +'<td style="white-space:nowrap;">'
        +'<select class="select" style="max-width:230px;padding:6px 8px;font-size:12.5px;display:inline-block;" '
        +'onchange="assignDriverVehicleUi(window._vsIntDrvCache['+i+'].email, this.value)">'+opts+'</select>'
        +gpsBadge
        +trailerSel
        +'</td>'
        +'<td>'
        +'<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="editUser(window._vsIntDrvCache['+i+'])">Szerkeszt</button> '
        +'<button class="btn danger" style="padding:4px 10px;font-size:12px;" onclick="deleteUser(window._vsIntDrvCache['+i+'].email,window._vsIntDrvCache['+i+'].nume)">Töröl</button>'
        +'</td>'
        +'</tr>';
    }).join('');
  }).catch(function(e){ console.error('loadInternalDrivers hiba:', e); toast('Betöltési hiba','err'); });
}

// Jármű-hozzárendelés mentése a sofőr sorából
function assignDriverVehicleUi(email, vehicleId){
  gas('assignDriverVehicle', [email, vehicleId || null]).then(function(r){
    if(r && r.ok){ toast(vehicleId ? '🚛 Jármű hozzárendelve' : 'Hozzárendelés törölve', 'ok'); loadInternalDrivers(); }
    else { toast((r && r.err) || 'Hiba', 'err'); loadInternalDrivers(); }
  });
}

// Alapértelmezett pótkocsi mentése a vontatóhoz (Belső sofőrök fül)
function assignDefaultTrailerUi(vehicleId, trailerId){
  gas('assignDefaultTrailer', [vehicleId, trailerId || null]).then(function(r){
    if(r && r.ok){ toast(trailerId ? '🚚 Pótkocsi-pár mentve' : 'Pótkocsi-pár törölve', 'ok'); }
    else { toast((r && r.err) || 'Hiba', 'err'); loadInternalDrivers(); }
  });
}

// ── Ügyfél-portál hozzáférések (az Ügyfelek fülön) ──
var _cpClients = [];
function loadClientPortalAccess(){
  var box=document.getElementById('clientPortalAccessBox'); if(!box) return;
  // OPT-IN funkció: csak ha a developer bekapcsolta ennél a cégnél
  if(!(window._vsFeatures && window._vsFeatures['client-portal']===true)){
    box.innerHTML='<div class="glass" style="padding:14px 18px;"><div class="text-muted" style="font-size:12.5px;">🔑 <b>Ügyfél-portál</b> — a megrendelőid saját belépéssel látnák a fuvarjaikat, dokumentumaikat, és új fuvart igényelhetnének. Ez a funkció jelenleg nincs bekapcsolva (a developer a Funkciók fülön engedélyezi).</div></div>';
    return;
  }
  box.innerHTML='<div class="glass" style="padding:18px 20px;"><div style="font-size:16px;font-weight:800;margin-bottom:4px;">👥 Ügyfél-portál hozzáférések</div>'
    +'<div class="text-muted" style="font-size:12.5px;margin-bottom:14px;">Meghívhatod az ügyfél kapcsolattartóját, hogy belépjen a <b>/portal</b> oldalon, és csak a SAJÁT cége fuvarjait lássa (státusz, élő követés, dokumentumok), illetve új fuvart igényeljen (jóváhagyással).</div>'
    +'<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-bottom:16px;">'
    +'<div class="field" style="margin:0;min-width:200px;"><label>Ügyfél</label><select class="select" id="cpClientSel"><option value="">— Válassz ügyfelet —</option></select></div>'
    +'<div class="field" style="margin:0;min-width:200px;"><label>Kapcsolattartó e-mail</label><input class="input" id="cpEmail" placeholder="pl. logisztika@gyar.ro"></div>'
    +'<div class="field" style="margin:0;min-width:150px;"><label>Név (opcionális)</label><input class="input" id="cpNev"></div>'
    +'<button class="btn ok" style="height:42px;" onclick="cpInvite()">＋ Meghívó küldése</button>'
    +'</div>'
    +'<div id="cpInviteLink"></div>'
    +'<div id="cpList"><div class="text-muted" style="font-size:12px;">Betöltés…</div></div>'
    +'</div>';
  // ügyfél-lista a választóhoz
  fetch('/api/clients',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(list){
    _cpClients=Array.isArray(list)?list:(list&&list.rows)||[];
    var sel=document.getElementById('cpClientSel'); if(!sel) return;
    sel.innerHTML='<option value="">— Válassz ügyfelet —</option>'+_cpClients.map(function(c){
      return '<option value="'+c.id+'">'+esc(c.nev||('#'+c.id))+'</option>'; }).join('');
  }).catch(function(){});
  cpRefresh();
}
function cpRefresh(){
  gas('clientPortalList').then(function(r){
    var el=document.getElementById('cpList'); if(!el) return;
    if(!r||!r.ok){ el.innerHTML='<div class="text-muted" style="font-size:12px;">Betöltési hiba.</div>'; return; }
    var items=r.items||[];
    if(!items.length){ el.innerHTML='<div class="text-muted" style="font-size:12px;padding:6px 0;">Még nincs portál-hozzáférés.</div>'; return; }
    window._cpItems=items;
    el.innerHTML=items.map(function(it,i){
      var status = it.pending_invite ? '<span class="badge warn">Meghívó kiküldve</span>'
        : (it.activ ? '<span class="badge ok">Aktív</span>' : '<span class="badge err">Letiltva</span>');
      var last = it.last_login ? ('utolsó belépés: '+String(it.last_login).replace('T',' ').slice(0,16)) : 'még nem lépett be';
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border,rgba(255,255,255,.08));border-radius:10px;margin-bottom:6px;background:rgba(255,255,255,.02);">'
        +'<div style="flex:1;min-width:0;"><div style="font-weight:700;">'+esc(it.email)+'</div>'
        +'<div class="text-muted" style="font-size:12px;">'+esc(it.client_nev||'')+' · '+esc(last)+'</div></div>'
        +status
        +'<button class="btn ghost" style="padding:6px 10px;font-size:12px;" onclick="cpToggle('+i+')">'+(it.activ?'Letiltás':'Aktiválás')+'</button>'
        +'</div>';
    }).join('');
  });
}
function cpInvite(){
  var cid=(document.getElementById('cpClientSel')||{}).value;
  var email=(document.getElementById('cpEmail')||{}).value.trim();
  var nev=(document.getElementById('cpNev')||{}).value.trim();
  if(!cid){ toast('Válassz ügyfelet!','err'); return; }
  if(!email){ toast('Add meg a kapcsolattartó e-mailjét!','err'); return; }
  gas('clientPortalInvite',[{client_id:cid, email:email, nev:nev}]).then(function(r){
    if(r&&r.ok){
      toast(r.emailed?'✉️ Meghívó elküldve e-mailben':'Meghívó létrehozva — másold ki a linket','ok');
      var lb=document.getElementById('cpInviteLink');
      if(lb) lb.innerHTML='<div class="glass-soft" style="padding:10px 12px;margin-bottom:12px;border:1px solid rgba(34,197,94,.4);font-size:12px;">'
        +(r.emailed?'✉️ A meghívót elküldtük e-mailben. ':'')+'Jelszó-beállító link (másolható): <br><code style="word-break:break-all;color:var(--text-primary);">'+esc(r.link)+'</code></div>';
      document.getElementById('cpEmail').value=''; document.getElementById('cpNev').value='';
      cpRefresh();
    } else toast((r&&r.err)||'Hiba','err');
  });
}
function cpToggle(i){
  var it=(window._cpItems||[])[i]; if(!it) return;
  gas('clientPortalSetActive',[it.id, !it.activ]).then(function(r){
    if(r&&r.ok){ toast(it.activ?'Letiltva':'Aktiválva','ok'); cpRefresh(); }
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
      +'<td style="text-align:right;color:var(--muted);">'+(c.mode==='vignette'?'matrica':((c.eur_per_km!=null?c.eur_per_km:'')+' €/km'))+'</td>'
      +'<td style="text-align:right;font-weight:700;">'+c.cost+' €</td></tr>';
  }).join('');
  box.innerHTML='<div class="glass-soft" style="padding:10px 12px;border:1px solid rgba(245,158,11,.35);">'
    +'<div class="text-muted" style="font-size:11.5px;font-weight:700;margin-bottom:6px;">Országonkénti bontás (a tervezett útvonalból)'+(tg.pending?' · ⚠️ részleges (geokódolás-keret)':'')+'</div>'
    +'<table style="width:100%;border-collapse:collapse;font-size:12px;">'
    +'<tbody>'+rows+'<tr><td style="font-weight:800;border-top:1px solid var(--border,rgba(255,255,255,.1));padding-top:6px;">Összesen</td><td colspan="2" style="border-top:1px solid var(--border,rgba(255,255,255,.1));"></td>'
    +'<td style="text-align:right;font-weight:800;color:#fbbf24;border-top:1px solid var(--border,rgba(255,255,255,.1));">'+(tg.total||0)+' €</td></tr></tbody></table></div>';
}
function estimateOrderToll(){
  if(!_oeOrderId){ toast('Előbb mentsd a fuvart.','err'); return; }
  toast('🛣️ Útdíj becslése az útvonalból…','ok');
  gas('estimateToll',[_oeOrderId]).then(function(r){
    if(r&&r.ok){
      var el=document.getElementById('oeToll'); if(el) el.value=(r.toll&&r.toll.total!=null?r.toll.total:'');
      renderTollBreak(r.toll);
      toast('🛣️ Becsült útdíj: '+(r.toll?r.toll.total:0)+' € (módosítható)','ok');
    } else toast((r&&r.err)||'Becslés hiba','err');
  });
}
// ── Ráta-szerkesztő modal ──
function openTollRates(){
  ensureTollRatesModal();
  document.getElementById('tollRatesModal').classList.add('open');
  gas('getTollRates').then(function(r){
    var body=document.getElementById('trBody'); if(!body) return;
    if(!r||!r.ok){ body.innerHTML='<div class="text-muted" style="padding:14px;">Betöltési hiba.</div>'; return; }
    window._trRates=r.rates||[];
    body.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr>'
      +'<th style="text-align:left;padding:6px 8px;color:var(--muted);">Ország</th><th style="text-align:left;padding:6px 8px;color:var(--muted);">Típus</th>'
      +'<th style="text-align:left;padding:6px 8px;color:var(--muted);">€/km</th><th style="text-align:left;padding:6px 8px;color:var(--muted);">matrica €</th></tr></thead><tbody>'
      +window._trRates.map(function(rt,i){
        return '<tr style="border-top:1px solid var(--border,rgba(255,255,255,.08));">'
          +'<td style="padding:6px 8px;">'+(CC_FLAG[rt.cc]||'')+' '+esc(rt.name)+(rt.custom?' <span class="badge ok" style="font-size:9px;">egyedi</span>':'')+'</td>'
          +'<td style="padding:6px 8px;"><select class="select" id="tr_mode_'+i+'" style="padding:5px 6px;font-size:12px;"><option value="perkm"'+(rt.mode==='perkm'?' selected':'')+'>km-alapú</option><option value="vignette"'+(rt.mode==='vignette'?' selected':'')+'>matrica</option></select></td>'
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
    +'<b class="text-primary" style="font-size:15px;">🛣️ Útdíj-ráták (kamion, &gt;12 t)</b>'
    +'<button class="btn ghost" style="margin-left:auto;padding:5px 12px;" onclick="closeTollRates()">✕</button></div>'
    +'<div style="padding:14px 18px;"><div class="text-muted" style="font-size:12px;margin-bottom:10px;">EU-alapértékekkel indul; itt cégre szabhatod. A „km-alapú" ország díja km×€/km, a „matrica" fix €/fuvar.</div>'
    +'<div id="trBody"></div>'
    +'<div style="margin-top:14px;display:flex;gap:8px;"><button class="btn primary" onclick="saveTollRatesUi()">Ráták mentése</button>'
    +'<button class="btn ghost" onclick="closeTollRates()">Mégse</button></div></div></div>';
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
    if(r&&r.ok){ toast('🛣️ Ráták mentve','ok'); closeTollRates(); }
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
  if(cost>0){ var m=pret-cost; el.innerHTML='Árrés: <b style="color:'+(m>=0?'var(--status-ok)':'var(--status-danger)')+';">'+(m>=0?'+':'')+Math.round(m)+' €</b>'; }
  else el.textContent='';
}

function loadCarriers(){
  var box=document.getElementById('carriersBox'); if(!box) return;
  window._carriersCache=null;
  gas('carrierList').then(function(r){
    window._carriersCache=(r&&r.ok&&r.items)||[];
    var items=window._carriersCache;
    var rows=items.map(function(c,i){
      var cmr='—';
      if(c.cmr_insurance_expiry){ var d=new Date(c.cmr_insurance_expiry); var days=Math.round((d-new Date())/86400000);
        cmr = days<0 ? '<span class="badge err">lejárt</span>' : days<30 ? '<span class="badge warn">'+days+' nap</span>' : '<span class="badge ok">'+String(c.cmr_insurance_expiry).slice(0,7)+'</span>'; }
      var ob=Math.round(parseFloat(c.open_balance)||0);
      return '<tr style="'+(!c.aktiv?'opacity:.5;':'')+'">'
        +'<td><b class="text-primary">'+esc(c.nev)+'</b>'+(c.portal_users?' <span class="badge ok" style="font-size:9px;">🔑 portál</span>':'')+'</td>'
        +'<td>'+esc(c.cui||'—')+'</td><td>'+(c.payment_term_days||30)+' nap</td><td>'+cmr+'</td>'
        +'<td style="text-align:right;color:'+(ob>0?'#ff6b75':'inherit')+';font-weight:700;">'+ob+' €</td>'
        +'<td style="white-space:nowrap;">'
        +'<button class="btn ghost" style="padding:4px 9px;font-size:12px;" onclick="carrierEditUi('+i+')">Szerk</button> '
        +'<button class="btn ghost" style="padding:4px 9px;font-size:12px;" onclick="carrierInvitePrompt('+c.id+')" title="Alvállalkozói portál meghívó">🔑</button> '
        +'<button class="btn danger" style="padding:4px 9px;font-size:12px;" onclick="carrierDeleteUi('+c.id+')">✕</button></td></tr>';
    }).join('');
    box.innerHTML='<div class="glass" style="padding:20px;"><div style="font-size:16px;font-weight:800;margin-bottom:4px;">🚚 Alvállalkozók</div>'
      +'<div class="text-muted" style="font-size:12.5px;margin-bottom:14px;">Külsős fuvarozó-cégek törzse — fizetési határidő, CMR-biztosítás, nyitott tartozás. A 🔑 gombbal portál-hozzáférést adsz nekik.</div>'
      +'<div class="grid-3" style="margin-bottom:12px;">'
      +'<div class="field"><label>Cégnév *</label><input class="input" id="caNev"></div>'
      +'<div class="field"><label>CUI / adószám</label><input class="input" id="caCui"></div>'
      +'<div class="field"><label>E-mail</label><input class="input" id="caEmail"></div>'
      +'<div class="field"><label>Telefon</label><input class="input" id="caTel"></div>'
      +'<div class="field"><label>Fizetési határidő (nap)</label><input class="input" id="caTerm" type="number" value="30"></div>'
      +'<div class="field"><label>CMR-biztosítás lejár</label><input class="input" id="caCmr" type="date"></div>'
      +'<div class="field"><label>IBAN</label><input class="input" id="caIban"></div>'
      +'<div class="field" style="grid-column:span 2;"><label>Megjegyzés</label><input class="input" id="caNota"></div>'
      +'</div>'
      +'<input type="hidden" id="caId"><button class="btn primary" onclick="carrierSaveUi()">＋ Alvállalkozó mentése</button> <button class="btn ghost" onclick="carrierFormReset()">Új/üres</button>'
      +'<div id="carrierInviteLink" style="margin-top:12px;"></div>'
      +'<table class="table" style="margin-top:16px;"><thead><tr><th>Cég</th><th>CUI</th><th>Fiz.hat.</th><th>CMR-bizt.</th><th style="text-align:right;">Nyitott tartozás</th><th>Művelet</th></tr></thead>'
      +'<tbody>'+(rows||'<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:14px;">Nincs alvállalkozó.</td></tr>')+'</tbody></table></div>';
  });
}
function carrierFormReset(){ ['caNev','caCui','caEmail','caTel','caIban','caNota'].forEach(function(i){var e=document.getElementById(i);if(e)e.value='';}); var t=document.getElementById('caTerm');if(t)t.value='30'; var c=document.getElementById('caCmr');if(c)c.value=''; var id=document.getElementById('caId');if(id)id.value=''; }
function carrierEditUi(i){
  var c=(window._carriersCache||[])[i]; if(!c) return;
  document.getElementById('caId').value=c.id;
  document.getElementById('caNev').value=c.nev||''; document.getElementById('caCui').value=c.cui||'';
  document.getElementById('caEmail').value=c.email||''; document.getElementById('caTel').value=c.telefon||'';
  document.getElementById('caTerm').value=c.payment_term_days||30; document.getElementById('caCmr').value=c.cmr_insurance_expiry?String(c.cmr_insurance_expiry).slice(0,10):'';
  document.getElementById('caIban').value=c.iban||''; document.getElementById('caNota').value=c.nota||'';
  document.getElementById('carriersBox').scrollIntoView({behavior:'smooth',block:'start'});
}
function carrierSaveUi(){
  var p={ id:document.getElementById('caId').value||null, nev:document.getElementById('caNev').value.trim(),
    cui:document.getElementById('caCui').value.trim(), email:document.getElementById('caEmail').value.trim(),
    telefon:document.getElementById('caTel').value.trim(), payment_term_days:document.getElementById('caTerm').value,
    cmr_insurance_expiry:document.getElementById('caCmr').value||null, iban:document.getElementById('caIban').value.trim(),
    nota:document.getElementById('caNota').value.trim() };
  if(!p.nev){ toast('A cégnév kötelező!','err'); return; }
  gas('carrierSave',[p]).then(function(r){ if(r&&r.ok){ toast('🚚 Alvállalkozó mentve','ok'); carrierFormReset(); loadCarriers(); loadCarrierAp(); } else toast((r&&r.err)||'Hiba','err'); });
}
function carrierDeleteUi(id){
  if(!confirm('Biztosan törlöd ezt az alvállalkozót?')) return;
  gas('carrierDelete',[id]).then(function(r){ if(r&&r.ok){ toast('Törölve','ok'); loadCarriers(); } else toast((r&&r.err)||'Nem törölhető','err'); });
}
function carrierInvitePrompt(carrierId){
  var email=prompt('Az alvállalkozó kapcsolattartójának e-mail címe (portál-meghívó):'); if(!email) return;
  gas('carrierPortalInvite',[{carrier_id:carrierId, email:email.trim()}]).then(function(r){
    if(r&&r.ok){ toast(r.emailed?'✉️ Portál-meghívó elküldve':'Meghívó kész — másold a linket','ok');
      var lb=document.getElementById('carrierInviteLink');
      if(lb) lb.innerHTML='<div class="glass-soft" style="padding:10px 12px;border:1px solid rgba(34,197,94,.4);font-size:12px;">'+(r.emailed?'✉️ Elküldve e-mailben. ':'')+'Jelszó-beállító link: <br><code style="word-break:break-all;color:var(--text-primary);">'+esc(r.link)+'</code></div>';
      loadCarriers();
    } else toast((r&&r.err)||'Hiba','err');
  });
}

// ── Szállítói számlák (AP) ──
function loadCarrierAp(){
  var box=document.getElementById('carrierApBox'); if(!box) return;
  gas('carrierInvoiceList').then(function(r){
    if(!r||!r.ok){ box.innerHTML=''; return; }
    var s=r.summary||{}; var items=r.items||[];
    var rows=items.map(function(it){
      var rem=Math.round((parseFloat(it.amount)||0)-(parseFloat(it.paid_amount)||0));
      var due='—', dueCls='';
      if(it.due_date){ var days=Math.round((new Date(it.due_date)-new Date())/86400000);
        due = days<0?('<span class="badge err">lejárt '+(-days)+' nap</span>'):days<=7?('<span class="badge warn">'+days+' nap</span>'):String(it.due_date).slice(0,10); }
      var stB = it.status==='paid'?'<span class="badge ok">Fizetve</span>':it.status==='partial'?'<span class="badge warn">Részben ('+Math.round(it.paid_amount)+')</span>':'<span class="badge err">Fizetendő</span>';
      var orderIds=(function(){ try{ return Array.isArray(it.order_ids)?it.order_ids:JSON.parse(it.order_ids||'[]'); }catch(e){ return []; } })();
      return '<tr><td>'+esc(it.carrier_nev||'')+'</td><td>'+esc(it.invoice_number||'—')+'</td>'
        +'<td style="font-size:11px;color:var(--muted);">'+esc(orderIds.join(', ')||'—')+'</td>'
        +'<td style="text-align:right;">'+Math.round(it.amount)+' '+esc(it.currency||'EUR')+'</td><td>'+due+'</td><td>'+stB+'</td>'
        +'<td style="white-space:nowrap;">'+(it.status!=='paid'?'<button class="btn ok" style="padding:4px 9px;font-size:12px;" onclick="carrierInvoicePayUi('+it.id+','+rem+')">Fizetve</button> ':'')
        +'<button class="btn danger" style="padding:4px 9px;font-size:12px;" onclick="carrierInvoiceDeleteUi('+it.id+')">✕</button></td></tr>';
    }).join('');
    box.innerHTML='<div class="glass" style="padding:20px;"><div style="font-size:16px;font-weight:800;margin-bottom:10px;">💸 Szállítói számlák / Tartozások (AP)</div>'
      +'<div class="dash-stats" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px;">'
      +apTile('Nyitott összesen', Math.round(s.open_total||0)+' €', '#ff6b75')+apTile('Esedékes 7 napon belül', Math.round(s.due_soon||0)+' €', '#fbbf24')
      +apTile('Lejárt', Math.round(s.overdue||0)+' €', (s.overdue>0?'#ff6b75':''))+apTile('Nyitott számla', (s.open_cnt||0)+' db','')+'</div>'
      +'<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:10px;">'
      +'<div class="field" style="margin:0;min-width:170px;"><label>Alvállalkozó</label><select class="select" id="ciCarrier" onchange="apLoadOrders()"><option value="">—</option></select></div>'
      +'<div class="field" style="margin:0;"><label>Számlaszám</label><input class="input" id="ciNum" style="max-width:140px;"></div>'
      +'<div class="field" style="margin:0;"><label>Kelt</label><input class="input" id="ciIssue" type="date" style="max-width:150px;"></div>'
      +'<div class="field" style="margin:0;"><label>Fiz. határidő</label><input class="input" id="ciDue" type="date" style="max-width:150px;"></div>'
      +'<div class="field" style="margin:0;"><label>Összeg</label><input class="input" id="ciAmount" type="number" style="max-width:110px;"></div>'
      +'<div class="field" style="margin:0;"><label>Pénznem</label><select class="select" id="ciCurr" style="max-width:90px;"><option>EUR</option><option>RON</option><option>HUF</option><option>PLN</option></select></div>'
      +'<button class="btn primary" style="height:42px;" onclick="carrierInvoiceSaveUi()">Számla rögzítése</button>'
      +'</div>'
      +'<div class="field" id="ciOrdersWrap" style="display:none;"><label>Mely fuvar(ok)hoz (Extern)</label><select class="select" id="ciOrders" multiple size="3" style="height:auto;"></select></div>'
      +'<table class="table" style="margin-top:12px;"><thead><tr><th>Alvállalkozó</th><th>Számla</th><th>Fuvar(ok)</th><th style="text-align:right;">Összeg</th><th>Esedékes</th><th>Állapot</th><th>Művelet</th></tr></thead>'
      +'<tbody>'+(rows||'<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:14px;">Nincs szállítói számla.</td></tr>')+'</tbody></table></div>';
    ensureCarriers(function(){ fillCarrierSelect('ciCarrier',''); });
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
  if(!p.carrier_id){ toast('Válassz alvállalkozót!','err'); return; }
  gas('carrierInvoiceSave',[p]).then(function(r){ if(r&&r.ok){ toast('🧾 Számla rögzítve','ok'); ['ciNum','ciAmount'].forEach(function(i){document.getElementById(i).value='';}); loadCarrierAp(); loadCarriers(); } else toast((r&&r.err)||'Hiba','err'); });
}
function carrierInvoicePayUi(id, rem){
  var v=prompt('Fizetett összeg (üres = teljes hátralék '+rem+'):'); if(v===null) return;
  var arg = v.trim()===''?'full':v.trim();
  gas('carrierInvoicePayment',[id, arg]).then(function(r){ if(r&&r.ok){ toast('💸 Fizetés rögzítve','ok'); loadCarrierAp(); loadCarriers(); } else toast((r&&r.err)||'Hiba','err'); });
}
function carrierInvoiceDeleteUi(id){ if(!confirm('Törlöd ezt a számlát?')) return; gas('carrierInvoiceDelete',[id]).then(function(r){ if(r&&r.ok){ toast('Törölve','ok'); loadCarrierAp(); loadCarriers(); } }); }

// ── Térkép-szolgáltató (geokódolás + autocomplete) — admin Integrációk ──
function loadMapsProvider(){
  var box=document.getElementById('mapsProviderBox'); if(!box) return;
  gas('mapsGetProvider').then(function(r){
    var vendor=(r&&r.ok&&r.vendor)||'free'; var hasKey=!!(r&&r.has_key);
    var usage=(r&&r.usage)||{month:0,prev:0};
    var costM=(r&&r.cost_month)||0; var costP=(r&&r.cost_prev)||0; var marginPct=(r&&r.margin_pct)||25;
    var usageHtml='';
    if(vendor!=='free'){
      var m=usage.month||0;
      usageHtml='<div class="glass-soft" style="padding:12px 14px;margin-top:14px;">'
        +'<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;">'
        +'<span style="font-size:12px;color:var(--muted);font-weight:700;">📊 E havi használat ('+vendor.toUpperCase()+')</span>'
        +'<span style="font-size:18px;font-weight:800;">'+m.toLocaleString('hu')+' <span style="font-size:12px;color:var(--muted);font-weight:500;">hívás</span></span>'
        +'<span style="margin-left:auto;font-size:12px;color:var(--muted);">Fizetendő:</span>'
        +'<span style="font-size:22px;font-weight:800;color:#fbbf24;">'+costM.toFixed(2)+' €</span></div>'
        +(costP?'<div style="font-size:11px;color:var(--muted);margin-top:4px;">Előző hó: '+(usage.prev||0).toLocaleString('hu')+' hívás · '+costP.toFixed(2)+' €</div>':'')
        +'<div style="font-size:10.5px;color:var(--muted);margin-top:6px;">⚠️ <b>Nincs ingyenes keret</b> — az első hívástól fizetsz (hivatalos ár + '+marginPct+'% árrés). Csak a fizetős (keyes) geokódolás/keresés számít, a cache-találat nem.</div>'
        +'</div>';
    }
    box.innerHTML='<div class="glass" style="padding:18px 20px;border:1px solid rgba(59,130,246,.35);">'
      +'<h3 style="font-size:16px;margin:0 0 4px;">🗺️ Térkép-szolgáltató (cím-keresés + geokódolás)</h3>'
      +'<p style="color:var(--muted);font-size:12.5px;margin:0 0 14px;line-height:1.5;">Minden cégen elérhető az <b>ingyenes</b> szolgáltató (kulcs és díj nélkül). Megbízhatóbb keresésért kapcsold ki az ingyeneset, és válassz <b>HERE</b>/<b>Google</b> szolgáltatót a saját kulcsoddal — ekkor az első hívástól fizetsz (hivatalos ár + árrés). A routing/útdíj továbbra is az OSRM/ORS stacken megy.</p>'
      +'<label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13.5px;font-weight:600;margin-bottom:6px;">'
      +'<input type="checkbox" id="mpFree" '+(vendor==='free'?'checked':'')+' onchange="mpToggleFree()" style="width:18px;height:18px;cursor:pointer;accent-color:#22c55e;"> 🆓 Ingyenes térkép használata (Photon/OSM) — díjmentes</label>'
      +'<div id="mpPaidWrap" style="'+(vendor==='free'?'display:none;':'')+'margin-top:10px;border-top:1px solid var(--border,rgba(255,255,255,.08));padding-top:12px;">'
      +'<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;">'
      +'<div class="field" style="margin:0;min-width:170px;"><label>Fizetős szolgáltató</label><select class="select" id="mpVendor">'
      +'<option value="here"'+(vendor==='here'?' selected':'')+'>HERE (ajánlott)</option>'
      +'<option value="google"'+(vendor==='google'?' selected':'')+'>Google Maps</option></select></div>'
      +'<div class="field" style="margin:0;flex:1;min-width:240px;"><label>API-kulcs '+(hasKey?'<span class="badge ok" style="font-size:10px;">tárolva</span>':'')+'</label><input class="input" id="mpKey" type="password" placeholder="'+(hasKey?'(változatlan, ha üresen hagyod)':'a szolgáltató API-kulcsa')+'"></div>'
      +'<button class="btn ghost" style="height:42px;" onclick="mpTest()">🔌 Teszt</button>'
      +'</div><div id="mpMsg" style="margin-top:8px;font-size:12px;"></div>'+usageHtml+'</div>'
      +'<button class="btn primary" style="margin-top:14px;" onclick="mpSave()">Mentés</button>'
      +'</div>';
  });
}
function mpToggleFree(){ var f=document.getElementById('mpFree'); var w=document.getElementById('mpPaidWrap'); if(w) w.style.display=(f&&f.checked)?'none':'block'; }
function mpTest(){
  var vendor=(document.getElementById('mpVendor')||{}).value; var key=(document.getElementById('mpKey')||{}).value;
  var m=document.getElementById('mpMsg'); if(m) m.innerHTML='<span class="text-muted">Tesztelés…</span>';
  gas('mapsTestProvider',[{vendor:vendor, key:key}]).then(function(r){
    if(!m) return;
    if(r&&r.ok&&r.valid) m.innerHTML='<span style="color:var(--status-ok);">✅ A kulcs működik.</span>';
    else if(r&&r.ok&&!r.valid) m.innerHTML='<span style="color:var(--status-danger);">❌ A kulcs nem érvényes / nem válaszolt.</span>';
    else m.innerHTML='<span style="color:var(--status-danger);">'+esc((r&&r.err)||'Teszt hiba')+'</span>';
  });
}
function mpSave(){
  var free=(document.getElementById('mpFree')||{}).checked;
  var vendor=free?'free':((document.getElementById('mpVendor')||{}).value||'here');
  var key=(document.getElementById('mpKey')||{}).value||'';
  gas('mapsSaveProvider',[{vendor:vendor, key:key}]).then(function(r){
    if(r&&r.ok){ toast(free?'🆓 Ingyenes térkép bekapcsolva':'🗺️ Térkép-szolgáltató mentve','ok'); loadMapsProvider(); }
    else toast((r&&r.err)||'Hiba','err');
  });
}

function loadInvites(){
  gas('invListAll').then(list=>{
    if(!Array.isArray(list)){document.querySelector('#tblInv tbody').innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--muted);">Nincs meghívókód.</td></tr>';return;}
    document.querySelector('#tblInv tbody').innerHTML=list.map(i=>{
      var sc=i.status==='Aktiv'?'ok':i.status==='Felhasznalva'?'info':'err';
      return '<tr>'
        +'<td><b style="color:#fff;">'+esc(i.kod)+'</b></td>'
        +'<td>'+i.pozicio+'</td>'
        +'<td>'+esc(i.nume||'—')+'</td>'
        +'<td>'+esc(i.email||'—')+'</td>'
        +'<td>'+esc(i.tel||'—')+'</td>'
        +'<td><span class="badge '+sc+'">'+i.status+'</span></td>'
        +'<td><button class="btn ghost" style="padding:3px 10px;font-size:12px;" onclick="revokeInv(\''+esc(i.kod)+'\')" '+(i.status!=='Aktiv'?'disabled':'')+'>Visszavon</button></td>'
        +'</tr>';
    }).join('');
  }).catch(function(e){ console.error('loadInvites hiba:', e); toast('Betöltési hiba','err'); });
}

function loadOrderFormData(){
  gas('userListAll').then(list=>{internDriversCache=list.filter(u=>u.pozicio==='Sofer');renderInternDrivers(internDriversCache);});
  gas('extDriverList').then(list=>{externDriversCache=Array.isArray(list)?list:[];renderExternDrivers(externDriversCache);});
  gas('vehicleList').then(list=>{
    if(!Array.isArray(list))list=[];
    camionCache=list.filter(v=>v.tip==='Vontato');
    remorcaCache=list.filter(v=>v.tip==='Potkocsi');
    renderCamions(camionCache);renderRemorcas(remorcaCache);
  });
  // jármű/sofőr választásra a párja automatikusan kitöltődik (ha üres)
  const cs=document.getElementById('oCamionSelect');if(cs)cs.onchange=orderFormPairFromVehicle;
  const ds=document.getElementById('oInternDriver');if(ds)ds.onchange=orderFormPairFromDriver;
}

function loadOrders(){
  gas('comList').then(list=>{
    if(!Array.isArray(list))list=[];
    _ordersAllCache = list;
    renderFilteredOrders(list);
  });
  if(typeof loadPendingHandovers==='function')loadPendingHandovers();
}

function loadReceivedFuvarlevelek(){
  gas('getFuvarlevelek').then(list=>{
    var tb=document.querySelector('#tblReceivedFuv tbody');
    if(!list||list.length===0){tb.innerHTML='<tr><td colspan="5">Nincs beküldött fuvarlevél.</td></tr>';return;}
    tb.innerHTML=list.map(f=>`<tr>`
      +`<td><b style="color:var(--brand-red);">${esc(f.numar_fisa||'—')}</b></td>`
      +`<td><b style="color:var(--text-primary);">${esc(f.file_name||'—')}</b></td>`
      +`<td>${esc(f.nume_sofer||f.email_sofer||'—')}</td>`
      +`<td>${f.data_completare?new Date(f.data_completare).toLocaleString('hu-HU'):'—'}</td>`
      +`<td style="display:flex;gap:6px;flex-wrap:wrap;">`
        +`<button class="btn ghost" style="padding:5px 10px;" onclick="openPdfView('${f.id}')">👁 PDF</button>`
        +`<button class="btn primary" style="padding:5px 10px;" onclick="openFuvEdit('${f.id}')">✏️ Szerkeszt</button>`
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
  catch(e){ toast('A nyomtatás nem indítható el','err'); }
}

// ===== Menetlevél megtekintés / szerkesztés (Admin/Manager) =====
function feEsc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function feRowPunct(p){p=p||{};return '<div class="fe-row" style="display:grid;grid-template-columns:1fr 2fr 1.2fr auto;gap:6px;align-items:center;">'
  +'<input class="input fe-p-tip" placeholder="Tip" value="'+feEsc(p.tip)+'">'
  +'<input class="input fe-p-loc" placeholder="Localitate" value="'+feEsc(p.loc)+'">'
  +'<input class="input fe-p-data" placeholder="Dată" value="'+feEsc(p.data)+'">'
  +'<button class="btn ghost" style="padding:4px 9px;" onclick="this.parentNode.remove()">✕</button></div>';}

function feRowAlim(a){a=a||{};return '<div class="fe-row" style="display:grid;grid-template-columns:1.4fr 1fr .7fr .7fr .8fr .8fr auto;gap:6px;align-items:center;">'
  +'<input class="input fe-a-loc" placeholder="Loc" value="'+feEsc(a.loc)+'">'
  +'<input class="input fe-a-tip" placeholder="Combustibil" value="'+feEsc(a.tip||'Motorină')+'">'
  +'<input class="input fe-a-lit" type="number" placeholder="L" value="'+feEsc(a.litru)+'">'
  +'<input class="input fe-a-km" type="number" placeholder="Km" value="'+feEsc(a.km)+'">'
  +'<input class="input fe-a-plata" placeholder="Plată" value="'+feEsc(a.plata||'Card')+'">'
  +'<input class="input fe-a-suma" type="number" placeholder="Sumă" value="'+feEsc(a.suma)+'">'
  +'<button class="btn ghost" style="padding:4px 9px;" onclick="this.parentNode.remove()">✕</button></div>';}

function feRowAch(c){c=c||{};return '<div class="fe-row" style="display:grid;grid-template-columns:1.4fr 1.4fr .8fr .8fr auto;gap:6px;align-items:center;">'
  +'<input class="input fe-c-loc" placeholder="Loc" value="'+feEsc(c.loc)+'">'
  +'<input class="input fe-c-prod" placeholder="Produs" value="'+feEsc(c.produs)+'">'
  +'<input class="input fe-c-pret" type="number" placeholder="Preț" value="'+feEsc(c.pret)+'">'
  +'<input class="input fe-c-plata" placeholder="Plată" value="'+feEsc(c.plata||'Card')+'">'
  +'<button class="btn ghost" style="padding:4px 9px;" onclick="this.parentNode.remove()">✕</button></div>';}

function feAddPunct(){document.getElementById('fePuncte').insertAdjacentHTML('beforeend', feRowPunct());}
function feAddAlim(){document.getElementById('feAlim').insertAdjacentHTML('beforeend', feRowAlim());}
function feAddAch(){document.getElementById('feAch').insertAdjacentHTML('beforeend', feRowAch());}

function closeFuvEdit(){document.getElementById('fuvEditModal').classList.remove('open');}

function openFuvEdit(id){
  gas('getFuvarlevelDetail',[id]).then(function(r){
    if(!r||!r.ok){toast(r&&r.err||'Nem tölthető be','err');return;}
    var f=r.fuv;
    document.getElementById('feId').value=f.id;
    document.getElementById('feSeria').textContent=f.numar_fisa||'(nincs sorszám)';
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
    var puncte=Array.isArray(f.puncte)?f.puncte:[];
    var alim=Array.isArray(f.alimentari)?f.alimentari:[];
    var ach=Array.isArray(f.achizitii)?f.achizitii:[];
    document.getElementById('fePuncte').innerHTML=puncte.length?puncte.map(feRowPunct).join(''):'';
    document.getElementById('feAlim').innerHTML=alim.length?alim.map(feRowAlim).join(''):'';
    document.getElementById('feAch').innerHTML=ach.length?ach.map(feRowAch).join(''):'';
    document.getElementById('fuvEditModal').classList.add('open');
  });
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
    puncte:puncte, alimentari:alimentari, achizitii:achizitii
  };
  gas('fuvarlevelUpdate',[id,payload]).then(function(r){
    if(r&&r.ok){toast('✅ Menetlevél mentve!','ok');closeFuvEdit();loadReceivedFuvarlevelek();}
    else toast(r&&r.err||'Szerver hiba','err');
  });
}


function loadVehicles(){
  gas('vehicleList').then(list=>{
    if(!Array.isArray(list))list=[];
    vehicleCache=list;
    renderVehicleTable('tblVontato',list.filter(v=>v.tip==='Vontato'));
    renderVehicleTable('tblPotkocsi',list.filter(v=>v.tip==='Potkocsi'));
  }).catch(function(e){ console.error('loadVehicles hiba:', e); toast('Betöltési hiba','err'); });
}

function logout(){gas('authLogout').then(function(){window.location.href='/login';}).catch(function(){window.location.href='/login';});}

function oeToggleSoferType() {
  var t = document.getElementById('oeSoferType').value;
  document.getElementById('oeInternWrap').style.display = t === 'Intern' ? '' : 'none';
  document.getElementById('oeExternWrap').style.display = t === 'Extern' ? '' : 'none';
  document.getElementById('oeExternFirmaWrap').style.display = t === 'Extern' ? '' : 'none';
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
    const t=remorcaCache.find(x=>String(x.id)===String(v.default_trailer_id));
    if(t){const ropt=[...remSel.options].find(o=>o.value===t.rendszam);
      if(ropt){remSel.value=t.rendszam;toast('🚚 Párosított pótkocsi kitöltve: '+t.rendszam+' (módosítható)','ok');}}
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
  toast('👤 Párosított sofőr kitöltve: '+opt.text.split(' (')[0]+' (módosítható)','ok');
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
  toast('🚛 Párosított jármű kitöltve: '+v.rendszam+' (módosítható)','ok');
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
  if(msgsEl)msgsEl.innerHTML='<div style="text-align:center;color:var(--muted);font-size:12px;padding:20px;">Betöltés...</div>';

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
  document.getElementById('quickVehicleTitle').textContent = tip === 'Vontato' ? 'Új vontató hozzáadása' : 'Új pótkocsi hozzáadása';
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
           newStatus==='Anulat'?'err':'info';
  var bgMap = {
    'info': 'background:rgba(59,130,246,0.18);color:#60a5fa;border-color:rgba(59,130,246,0.4);',
    'warn': 'background:rgba(245,158,11,0.18);color:#fbbf24;border-color:rgba(245,158,11,0.4);',
    'ok':   'background:rgba(34,197,94,0.18);color:#4ade80;border-color:rgba(34,197,94,0.4);',
    'err':  'background:rgba(239,68,68,0.18);color:#f87171;border-color:rgba(239,68,68,0.4);'
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
      toast('✅ Státusz: ' + newStatus, 'ok');
      var idx = -1;
      _ordersAllCache.forEach(function(c,i){ if(String(c.id)===String(id)) idx=i; });
      if (idx !== -1) _ordersAllCache[idx].status = newStatus;
    } else {
      toast(d.err || 'Hiba', 'err');
      loadOrders();
    }
  }).catch(function(){ toast('Kapcsolat hiba', 'err'); loadOrders(); });
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
    listEl.innerHTML='<div style="padding:16px 12px;font-size:12px;color:var(--muted);">Még nincs csevegés.<br>Kattints a + gombra!</div>';
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

function renderCamions(list){const sel=document.getElementById('oCamionSelect');if(!sel)return;sel.innerHTML='<option value="">— Nincs megadva —</option>'+list.map(v=>`<option value="${esc(v.rendszam)}">${esc(v.rendszam)}${v.marca?' — '+esc(v.marca):''}${v.model?' '+esc(v.model):''}</option>`).join('');}

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
  if (!list.length) { container.innerHTML='<div style="text-align:center;color:var(--muted);padding:40px;">Nincs találat.</div>'; return; }
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
    html += '<span style="font-size:12px;color:var(--muted);">'+g.docs.length+' fájl</span>';
    html += '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;">';
    g.docs.forEach(function(d) {
      var bc = d.tip==='CMR'?'ok':d.tip==='Számla'?'info':'warn';
      var time = d.created_at ? new Date(d.created_at).toLocaleTimeString('hu-HU',{hour:'2-digit',minute:'2-digit'}) : '';
      html += '<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:14px;">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;"><span class="badge '+bc+'">'+esc(d.tip||'Egyéb')+'</span>'
        +(d.order_id?'<span class="badge info" title="Fuvarhoz kötve">🔗 '+esc(d.order_id)+'</span>':'')
        +'<span style="font-size:11px;color:var(--muted);">'+time+'</span></div>';
      html += '<div style="font-size:12px;color:var(--soft);margin-bottom:10px;word-break:break-all;">'+esc(d.file_name||'—')+'</div>';
      html += '<div style="display:flex;gap:6px;">';
      html += '<a href="/api/doc-download/'+d.id+'" target="_blank" class="btn primary" style="flex:1;text-align:center;text-decoration:none;padding:8px 6px;font-size:12px;">👁 Megtekint</a>';
      html += '<a href="/api/doc-download/'+d.id+'" download class="btn ghost" style="flex:1;text-align:center;text-decoration:none;padding:8px 6px;font-size:12px;">⬇ Letölt</a>';
      html += '</div></div>';
    });
    html += '</div></div>';
  });
  container.innerHTML = html;
}

function renderExternDrivers(list){const sel=document.getElementById('oExternSelect');if(!sel)return;sel.innerHTML='<option value="">— Új sofőr beírása kézzel —</option>'+list.map(d=>`<option value="${esc(d.id)}">${esc(d.nume||'')} ${d.firma?'/ '+esc(d.firma):''}</option>`).join('');}

function renderInternDrivers(list){const sel=document.getElementById('oInternDriver');if(!sel)return;sel.innerHTML='<option value="">— Válassz sofőrt —</option>'+list.map(u=>`<option value="${esc(u.email)}">${esc(u.nume)} (${esc(u.email)})</option>`).join('');}

function renderRemorcas(list){const sel=document.getElementById('oRemorcaSelect');if(!sel)return;sel.innerHTML='<option value="">— Nincs megadva —</option>'+list.map(v=>`<option value="${esc(v.rendszam)}">${esc(v.rendszam)}${v.marca?' — '+esc(v.marca):''}${v.model?' '+esc(v.model):''}</option>`).join('');}


function renderVehicleTable(tableId,list){
  const tb=document.querySelector('#'+tableId+' tbody');
  if(!list||list.length===0){tb.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--muted);">Nincs még felvéve.</td></tr>';return;}
  tb.innerHTML=list.map(v=>`<tr><td><b>${esc(v.rendszam)}</b></td><td>${esc(v.marca||'—')}</td><td>${esc(v.model||'—')}</td><td>${v.an||'—'}</td><td>${esc(v.nota||'—')}</td><td><button class="btn primary" style="padding:4px 10px;font-size:12px;" onclick="editVehicle(${v.id})">Szerk</button> <button class="btn danger" style="padding:4px 10px;font-size:12px;" onclick="deleteVehicle(${v.id})">Töröl</button></td></tr>`).join('');
}

function revokeInv(kod){
  if(!confirm('Biztosan visszavonod a(z) '+kod+' kodot?'))return;
  gas('invRevoke',[kod]).then(r=>{if(r.ok){toast('Visszavonva!','ok');loadInvites();}else{toast(r.err||'Hiba','err');}});
}

function saveAdminSigDraw(){var dataUrl=sigCanvas.toDataURL('image/png');gas('stampSave',[dataUrl]).then(()=>{toast('Aláírás mentve!','ok');loadAdminSigPreview();});}

function saveAdminSigFile(){var fi=document.getElementById('sigFile');if(!fi.files.length)return;var fr=new FileReader();fr.onload=function(e){gas('stampSave',[e.target.result]).then(()=>{toast('Bélyegző elmentve!','ok');loadAdminSigPreview();});};fr.readAsDataURL(fi.files[0]);}

function saveDocSeries() {
  var prefix = ((document.getElementById('docSeriesPrefix')||{}).value||'').trim();
  if (!prefix) { toast('Add meg a prefixet!','err'); return; }
  fetch('/api/document-series',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({docType:'MT',prefix:prefix})})
  .then(function(r){return r.json();}).then(function(d){
    if (d.ok) { toast('✅ Széria elmentve — '+prefix+'-'+new Date().getFullYear()+'-0001-től','ok'); loadDocSeries(); }
    else toast(d.err||'Hiba','err');
  });
}

function saveExtDriver(){
  const id=parseInt(document.getElementById('edEditId').value,10);
  const fields={nume:document.getElementById('edEditNume').value.trim(),firma:document.getElementById('edEditFirma').value.trim(),telefon:document.getElementById('edEditTelefon').value.trim(),email:document.getElementById('edEditEmail').value.trim(),rendszam_camion:document.getElementById('edEditCamion').value.trim(),rendszam_remorca:document.getElementById('edEditRemorca').value.trim(),nota:document.getElementById('edEditNota').value.trim()};
  if(!fields.nume&&!fields.firma){toast('A sofőr neve vagy a cég neve kötelező!','err');return;}
  gas('extDriverUpdate',[id,fields]).then(r=>{if(r.ok){toast('Mentve!','ok');closeExtDriverModal();loadExtDrivers();}else{toast(r.err||'Hiba történt','err');}});
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
    toast('A rendszám kötelező!', 'err');
    return;
  }
  gas('vehicleCreate', [v]).then(r => {
    if (r.ok) {
      toast((tip === 'Vontato' ? 'Vontató' : 'Pótkocsi') + ' hozzáadva!', 'ok');
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
      toast(r.err || 'Hiba történt', 'err');
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
  if(!fields.rendszam){toast('A rendszám kötelező!','err');return;}
  gas('vehicleUpdate',[id,fields]).then(r=>{if(r.ok){toast('Mentve!','ok');closeVehicleModal();loadVehicles();}else{toast(r.err||'Hiba történt','err');}});
}

function settings2faConfirm() {
  var code = document.getElementById('setup2faCode').value.trim();
  if (!code || code.length !== 6) { toast('Add meg a 6 jegyű kódot!','err'); return; }
  var btn = document.getElementById('btn2faConfirm');
  btn.disabled = true; btn.textContent = '...';
  fetch('/api/2fa/settings-verify', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ token: code })
  }).then(function(r){ return r.json(); }).then(function(d){
    btn.disabled = false; btn.textContent = '✅ Megerősítés';
    if (d.success) {
      document.getElementById('modal2faSetup').classList.remove('open');
      toast('✅ 2FA sikeresen bekapcsolva!','ok');
      loadSettingsPane();
    } else {
      toast(d.message||'Helytelen kód','err');
    }
  });
}

function settings2faDisable(){
  var pwd = document.getElementById('st2faDisablePwd').value;
  if(!pwd){ toast('Add meg a jelszavadat!','err'); return; }
  if(!confirm('Biztosan kikapcsolod a kétlépéses hitelesítést? Ez csökkenti a fiókod biztonságát.')) return;
  gas('settings2faDisable',[{currentPwd:pwd}]).then(function(r){
    if(r&&r.ok){
      toast('2FA kikapcsolva.','ok');
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
  if(!cur||!nw||!nw2){ toast('Minden mező kötelező!','err'); return; }
  if(nw!==nw2){ toast('A két új jelszó nem egyezik!','err'); return; }
  if(nw.length<6){ toast('Az új jelszó legalább 6 karakter legyen!','err'); return; }
  gas('settingsChangePassword',[{current:cur,newPwd:nw}]).then(function(r){
    if(r&&r.ok){
      toast('Jelszó sikeresen módosítva!','ok');
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
  if(!nume){ toast('A név kötelező!','err'); return; }
  gas('settingsSaveProfile',[{nume:nume,tel:tel}]).then(function(r){
    if(r&&r.ok){
      toast('Profil mentve!','ok');
      document.getElementById('meBadge').textContent = nume;
    } else {
      toast((r&&r.err)||'Hiba történt','err');
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

function toggleAllOrders(cb) {
  document.querySelectorAll('.orderRowCb').forEach(function(c){ c.checked = cb.checked; });
  updateOrderSelBar();
}

function toggleOrdersMenu(){document.getElementById('ordersSubmenu').parentElement.classList.toggle('open');}

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
  if (el) el.textContent = 'Előnézet: '+p+'-'+y+'-0001 (új prefix esetén 1-től)';
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
  if(!file){toast('Válassz PDF fájlt!','err');return;}
  if(!currentDocOrderId){toast('Nincs kiválasztott fuvar!','err');return;}
  const reader=new FileReader();
  reader.onload=function(e){
    const b64=e.target.result;
    gas('orderDocUpload',[currentDocOrderId,file.name,b64]).then(r=>{
      if(r.ok){
        toast('Feltöltve!','ok');
        currentDocId=r.docId;
        loadDocList(currentDocOrderId);
        openSignModal(r.docId,'original');
      }else{
        toast(r.err||'Feltöltési hiba','err');
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
function loadDashboard() {
  // KPI: felhasználók + beérkezett menetlevelek
  gas('userListAll').then(function (u) {
    var e = document.getElementById('cUsers'); if (e) e.textContent = (u && u.length) || 0;
  });
  gas('getFuvarlevelek').then(function (d) {
    var e = document.getElementById('countFuv'); if (e) e.textContent = (d && d.length) || 0;
  });
  // Cég neve + fuvar-KPI-k
  gas('dashStats').then(function (r) {
    if (!r || !r.ok) return;
    var cn = document.getElementById('dashCegNev'); if (cn) cn.textContent = r.ceg_nev;
    var total = (r.statuszok || []).reduce(function (s, x) { return s + x.db; }, 0);
    var aktiv = (r.statuszok || [])
      .filter(function (x) { return x.status === 'In Curs' || x.status === 'Alocat'; })
      .reduce(function (s, x) { return s + x.db; }, 0);
    var t = document.getElementById('kpiTotal'); if (t) t.textContent = total;
    var a = document.getElementById('kpiAktiv');
    if (a) { a.textContent = aktiv; a.style.color = aktiv > 0 ? 'var(--status-ok)' : 'var(--text-muted)'; }
  });

  loadDashRecentOrders();
  loadDashVehicleSummary();
  // ⏰ Lejáró dokumentumok riasztás-sáv (fleet-extra.js)
  if (window.FleetExtra) FleetExtra.dashExpiryAlert();
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
  'Finalizat':  { c: 'ok',   t: 'Teljesítve' },
  'In Curs':    { c: 'warn', t: 'Folyamatban' },
  'Alocat':     { c: 'info', t: 'Várakozik' },
  'Disponibil': { c: 'err',  t: 'Tervezetlen' },
  'Extern':     { c: 'info', t: 'Külső' },
  'Anulat':     { c: 'err',  t: 'Törölve' }
};
function loadDashRecentOrders() {
  var tb = document.getElementById('dashRecentOrdersBody');
  if (!tb) return;
  gas('getRecentOrders', [8]).then(function (r) {
    if (!r || !r.ok) {
      tb.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:18px;">Nem sikerült betölteni.</td></tr>';
      return;
    }
    var list = r.orders || [];
    if (!list.length) {
      tb.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:18px;">Nincs fuvar.</td></tr>';
      return;
    }
    tb.innerHTML = list.map(function (o) {
      var drv = o.nume_sofer || o.driver_user_name || o.email_sofer || '—';
      var dest = o.loc_descarcare || '—';
      var sm = DASH_STATUS_MAP[o.status] || { c: 'info', t: o.status || '—' };
      var dt = o.created_at ? new Date(o.created_at).toLocaleDateString('hu-HU') : '—';
      return '<tr>'
        + '<td><b class="text-primary">' + esc(String(o.id)) + '</b></td>'
        + '<td>' + esc(dest) + '</td>'
        + '<td>' + esc(drv) + '</td>'
        + '<td><span class="badge ' + sm.c + '">' + esc(sm.t) + '</span></td>'
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
      { l: 'Aktív járművek', v: r.active || 0,   col: (r.active > 0 ? 'var(--status-ok)' : 'var(--text-muted)'), ico: '🟢' },
      { l: 'Álló járművek',  v: r.inactive || 0, col: 'var(--text-muted)', ico: '⚪' },
      { l: 'Ismeretlen',     v: r.unknown || 0,  col: 'var(--text-muted)', ico: '❔' }
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
      ph.bindTooltip(r.gps_configured ? 'Nincs aktív GPS adat' : 'GPS integráció nincs beállítva');
      ph.addTo(window._dashMarkers);
      return;
    }
    var bounds = [];
    pts.forEach(function (p) {
      var spd = (p.speed != null) ? Math.round(p.speed) + ' km/h' : '—';
      var m = L.circleMarker([p.lat, p.lng], {
        radius: 8, color: '#e10b1a', fillColor: '#e10b1a', fillOpacity: 0.85, weight: 2
      });
      m.bindTooltip('🚛 ' + (p.object_name || p.rendszam) + ' · ' + spd);
      m.bindPopup('<b>' + esc(p.object_name || p.rendszam) + '</b><br>Sebesség: ' + spd
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
        if(s.stornoed){ el.textContent=' ↩️'; var t='Számla stornózva: '+(s.storno_serie||'')+'-'+(s.storno_numar||''); el.title=t; if(btn)btn.title=t; }
        else {
          // e-Factura (ANAF SPV) státusz-jelzés a pipán: 📨 = beküldve/folyamatban
          var ef=(s.efactura||'').toLowerCase();
          var efSym = ef ? (/(valid|ok|accept)/.test(ef)?' 📨✓' : /(err|invalid|resp)/.test(ef)?' 📨✗' : ' 📨') : '';
          el.textContent=' ✅'+efSym;
          var t2='Számlázva: '+(s.serie||'')+'-'+(s.numar||'')+(s.efactura?(' · e-Factura: '+s.efactura):'');
          el.title=t2; if(btn)btn.title=t2;
        }
      });
    }).catch(function(){});
}

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
  if(!pdfDocProxy){ toast('Előbb töltsd be a PDF-et!','err'); return; }
  const blank=document.createElement('canvas'); blank.width=signCanvasEl.width; blank.height=signCanvasEl.height;
  if(signCanvasEl.toDataURL()===blank.toDataURL()){ toast('Előbb rajzolj aláírást!','err'); return; }
  createDraggableItem(signCanvasEl.toDataURL('image/png'),'sign');
  toast('Aláírás hozzáadva – húzd a helyére','ok');
}

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
    if(!r.ok||!r.base64){toast(r.err||'Letöltési hiba','err');return;}
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
function loadSettingsPane(){
  loadEmailLang();
  gas('authMe').then(function(u){
    if(!u) return;
    document.getElementById('stNume').value    = u.nume  || '';
    document.getElementById('stEmail').value   = u.email || '';
    document.getElementById('stTel').value     = u.tel   || '';
    document.getElementById('stPozicio').value = u.pozicio || '';
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

function openSignModal(docId,which){
  currentDocId=docId;
  document.getElementById('signModal').classList.add('open');

  placedItems.forEach(it=>{ if(it.el) it.el.remove(); });
  placedItems=[];
  pdfDocProxy=null; pdfRawBytes=null; signCurrentPage=1; signTotalPages=1;
  document.getElementById('signPageInfo').textContent='betöltés...';

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
    if(!r.ok||!r.base64){ toast(r.err||'PDF betöltési hiba','err'); return; }
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
      toast('Nem sikerült megnyitni a PDF-et','err');
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
    if(c.status==='Parkolt')sc='park';
    if(c.status==='Raktarban')sc='wh';

    // Státusz dropdown — gombszerű, színes, kattintható
    var statuses = ['Disponibil','Alocat','In Curs','Parkolt','Raktarban','Finalizat','Anulat'];
    var selStyle = 'cursor:pointer;font-size:11px;font-weight:700;border-radius:8px;padding:4px 20px 4px 8px;'+
      'border:1px solid;appearance:auto;-webkit-appearance:auto;outline:none;min-width:80px;';
    var bgMap = {
      'info': 'background:rgba(59,130,246,0.18);color:#60a5fa;border-color:rgba(59,130,246,0.4);',
      'warn': 'background:rgba(245,158,11,0.18);color:#fbbf24;border-color:rgba(245,158,11,0.4);',
      'ok':   'background:rgba(34,197,94,0.18);color:#4ade80;border-color:rgba(34,197,94,0.4);',
      'err':  'background:rgba(239,68,68,0.18);color:#f87171;border-color:rgba(239,68,68,0.4);',
      'park': 'background:rgba(192,38,211,0.18);color:#e879f9;border-color:rgba(192,38,211,0.4);',
      'wh':   'background:rgba(249,115,22,0.18);color:#fb923c;border-color:rgba(249,115,22,0.4);'
    };
    var statusSel = '<select onchange="quickStatusChange(\''+c.id+'\',this)" '+
      'style="'+selStyle+(bgMap[sc]||bgMap['info'])+'">'+
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
    var routeCell = esc(c.loc_incarcare||'—')+' → '+esc(c.loc_descarcare||'—')+loadTypeBadge(c.load_type, dimStr(c.hossz_cm,c.szel_cm,c.mag_cm));
    // Leadott áru jelzései (folytatásra váró fuvar — a lista tetején)
    if (c.status==='Parkolt') {
      routeCell += '<div style="margin-top:4px;"><span class="badge" style="background:rgba(192,38,211,0.18);color:#e879f9;border:1px solid rgba(192,38,211,0.4);">'+
        '🅿️ Áru a pótkocsin'+(c.rendszam_remorca?': '+esc(c.rendszam_remorca):'')+(c.handover_loc?' @ '+esc(c.handover_loc):'')+' — vontató+sofőr kell!</span></div>';
    }
    if (c.status==='Raktarban') {
      routeCell += '<div style="margin-top:4px;"><span class="badge" style="background:rgba(249,115,22,0.18);color:#fb923c;border:1px solid rgba(249,115,22,0.4);">'+
        '📦 Raktárban'+(c.handover_loc?' @ '+esc(c.handover_loc):'')+' — kiosztásra vár!</span>'+
        (parseInt(c.pod_count,10)>0?'':' <span class="badge err">⚠️ Dokumentum hiányzik!</span>')+'</div>';
    }
    if (c.handover_status==='Fuggoben') {
      routeCell += '<div style="margin-top:4px;"><span class="badge warn">⏳ Sofőr leadás-kérése visszaigazolásra vár'+
        (c.handover_loc?' @ '+esc(c.handover_loc):'')+'</span></div>';
    }
    if (legCount > 0) {
      routeCell += '<div style="margin-top:4px;">';
      legs.forEach(function(l){
        if (l.loc_preluare) {
          routeCell += '<div style="font-size:11px;color:var(--muted);padding-left:8px;border-left:2px solid rgba(225,11,26,0.4);margin-top:2px;">'+
            '↳ '+esc(l.loc_preluare)+
          '</div>';
        }
      });
      routeCell += '</div>';
    }

    // Sofőr cella: alap sofőr + váltások badge-del
    var soferCell = esc(soferInfo);
    if (legCount > 0) {
      soferCell += ' <span style="font-size:10px;background:rgba(225,11,26,0.15);color:#f87171;border:1px solid rgba(225,11,26,0.3);border-radius:6px;padding:1px 6px;white-space:nowrap;">+'+legCount+' váltás</span>';
      soferCell += '<div style="margin-top:4px;">';
      legs.forEach(function(l){
        soferCell += '<div style="font-size:11px;color:var(--muted);margin-top:2px;">'+
          '↳ '+esc(l.sofer||'—')+(l.rendszam?' <span style="opacity:.6;">'+esc(l.rendszam)+'</span>':'')+
        '</div>';
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
        'onclick="InvoiceModal.open(\''+c.id+'\')">🧾<span class="inv-ind" data-inv-ind="'+c.id+'" style="margin-left:2px;"></span></button>';
    }
    // 🌍 Ügyfél tracking-link (prémium funkció-kapcsoló: 'tracking')
    if (!(window._vsFeatures && window._vsFeatures['tracking']===false)) {
      integBtns += '<button class="btn ghost" title="Ügyfél követő-link másolása (publikus oldal)" style="padding:4px 10px;font-size:12px;" '+
        'onclick="copyTrackingLink(\''+c.id+'\')">🌍</button>';
    }
    // 📷 POD-jelző: a sofőr által ehhez a fuvarhoz csatolt fotók (aláírt CMR stb.)
    if (parseInt(c.pod_count, 10) > 0) {
      integBtns += '<span title="'+c.pod_count+' sofőr-fotó / POD csatolva (Feltöltött Iratok fül)" '+
        'style="font-size:12px;align-self:center;color:var(--status-ok);white-space:nowrap;">📷'+c.pod_count+'</span>';
    }
    // 💰 Fizetés rögzítése — CSAK Finalizat fuvaron jelenik meg.
    // Szín a fizetési állapot szerint: fizetve=zöld, részben=sárga, kintlévő=piros keret.
    if (c.status==='Finalizat') {
      var _ps = c.payment_status || 'unpaid';
      var _pTitle = _ps==='paid' ? 'Fizetve ('+(c.paid_amount||0)+')' :
                    _ps==='partial' ? 'Részben fizetve — fizetés rögzítése' : 'Kintlévő — fizetés rögzítése';
      var _pStyle = _ps==='paid' ? 'border-color:rgba(34,197,94,0.5);color:#4ade80;' :
                    _ps==='partial' ? 'border-color:rgba(245,158,11,0.5);color:#fbbf24;' :
                    'border-color:rgba(239,68,68,0.5);color:#f87171;';
      integBtns += '<button class="btn ghost" title="'+_pTitle+'" style="padding:4px 10px;font-size:12px;'+_pStyle+'" '+
        'onclick="openPaymentModal(\''+c.id+'\')">💰'+(_ps==='paid'?'✓':'')+'</button>';
    }
    // ⛔ Áru leadása (megszakítás) — aktív fuvaron; függő sofőr-kérésnél a banner kezeli
    if ((c.status==='Alocat'||c.status==='In Curs') && c.handover_status!=='Fuggoben') {
      integBtns += '<button class="btn ghost" title="Áru leadása (pótkocsin parkol / raktárba kerül)" '+
        'style="padding:4px 10px;font-size:12px;border-color:rgba(192,38,211,0.5);color:#e879f9;" '+
        'onclick="openHandoverModal(\''+c.id+'\')">⛔</button>';
    }

    return '<tr><td><b>'+c.id+'</b></td><td>'+esc(c.client||'—')+'</td>'+
      '<td>'+routeCell+'</td>'+
      '<td>'+(c.km||'—')+(c.route_km!=null&&c.route_km!==''?' <span class="badge info" style="font-size:10px;padding:1px 6px;white-space:nowrap;" title="Automata útvonal-km (térkép szerint) — összevetésre">🗺️ '+c.route_km+'</span>':'')+'</td><td>'+(c.pret||'—')+'</td>'+
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
      '</td>'+
      '</tr>';
  }).join('');
  updateOrderSelBar();
  decorateUitIndicators(list);
  decorateInvoiceIndicators(list);
}

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
        (legCount > 0 ? ' <b style="color:#c00;font-size:10px;">(+'+legCount+' váltás)</b>' : '')+
      '</td>'+
      '<td style="vertical-align:top;">'+esc(c.rendszam_camion||'—')+(c.rendszam_remorca?' / '+esc(c.rendszam_remorca):'')+'</td>'+
      '<td style="text-align:center;vertical-align:top;font-weight:700;">'+esc(c.status||'—')+'</td>'+
    '</tr>';

    // Váltás / szakasz alsorok
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
    (hasLegs ? '<div class="legend">ℹ️ Kék háttérrel: utólag hozzáadott váltások (order_legs) — sofőrcsere, átvételi hely, jármű adatokkal.</div>' : '')+
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
    gas('vehicleList')
  ]).then(function(results) {
    fetch('/api/execute', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({functionName:'getOrderById',arguments:[id]})})
    .then(r=>r.json()).then(function(d) {
      var o = d.result;
      var legs = d.legs || [];
      if (!o) { toast('Nem található','err'); return; }

      document.getElementById('oeClient').value = o.client||'';
      document.getElementById('oeRef').value = o.ref||'';
      // Importált extra adatok (CSV-import nem párosított oszlopai) — csak nézet
      var oeIe = document.getElementById('oeImportExtra');
      if(oeIe){
        var ie=o.import_extra; if(typeof ie==='string'){ try{ ie=JSON.parse(ie); }catch(e){ ie=null; } }
        if(ie && typeof ie==='object' && Object.keys(ie).length){
          oeIe.innerHTML='<div class="glass-soft" style="padding:10px 12px;border:1px solid rgba(59,130,246,0.35);">'
            +'<div class="text-primary" style="font-size:12px;font-weight:700;margin-bottom:6px;">📋 Importált extra adatok <span class="text-muted" style="font-weight:400;">(CSV-ből, nem párosított oszlopok)</span></div>'
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
      document.getElementById('oeStatus').value = o.status||'Disponibil';
      document.getElementById('oeSoferType').value = o.sofer_type||'';

      // Térképes útvonal-előnézet állapota a mentett route_geo-ból (ha van + a kapcsoló be)
      if(typeof resetRouteState==='function') resetRouteState('edit');
      if(_orderMapOn){
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
      sel.innerHTML = '<option value="">— Válassz —</option>' +
        _oeSoferCache.map(u => '<option value="'+esc(u.email)+'"'+(u.email===o.email_sofer?' selected':'')+'>'+esc(u.nume)+' ('+esc(u.email)+')</option>').join('');

      // Jármű dropdown
      var vehicles = results[1] || [];
      _oeCamionCache = vehicles.filter(v => v.tip === 'Vontato');
      _oeRemorcaCache = vehicles.filter(v => v.tip === 'Potkocsi');
      var camSel = document.getElementById('oeCamion');
      camSel.innerHTML = '<option value="">— Nincs —</option>' +
        _oeCamionCache.map(v => '<option value="'+esc(v.rendszam)+'"'+(v.rendszam===o.rendszam_camion?' selected':'')+'>'+esc(v.rendszam)+(v.marca?' — '+esc(v.marca):'')+'</option>').join('');
      var remSel = document.getElementById('oeRemorca');
      remSel.innerHTML = '<option value="">— Nincs —</option>' +
        _oeRemorcaCache.map(v => '<option value="'+esc(v.rendszam)+'"'+(v.rendszam===o.rendszam_remorca?' selected':'')+'>'+esc(v.rendszam)+(v.marca?' — '+esc(v.marca):'')+'</option>').join('');

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
        toast('👤 Párosított sofőr kitöltve: '+u.nume+' (módosítható)','ok');
      };
      sel.onchange = function(){
        if (!sel.value || camSel.value) return;
        var email = String(sel.value).toLowerCase();
        var v = _oeCamionCache.find(function(x){ return String(x.assigned_driver_email||'').toLowerCase() === email; });
        if (!v) return;
        camSel.value = v.rendszam;
        toast('🚛 Párosított jármű kitöltve: '+v.rendszam+' (módosítható)','ok');
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
    el.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px;">Nincs rögzített váltás.</div>';
    return;
  }
  el.innerHTML = legs.map(function(leg) {
    return '<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:13px;display:flex;justify-content:space-between;align-items:center;">'
      + '<div>'
      + '<b style="color:#fff;">' + leg.leg_number + '. szakasz</b>'
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
      toast('Váltás hozzáadva!', 'ok');
      // Frissítsük a legs listát
      fetch('/api/execute', {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({functionName:'getOrderById',arguments:[_oeOrderId]})})
      .then(r=>r.json()).then(d => renderOeLegs(d.legs||[]));
    } else { toast(r&&r.err||'Hiba','err'); }
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
    load_type:        loadTypeValue('oeFtl','oeLtl'),
    hossz_cm:         (document.getElementById('oeHossz')||{}).value||null,
    szel_cm:          (document.getElementById('oeSzel')||{}).value||null,
    mag_cm:           (document.getElementById('oeMag')||{}).value||null,
    route_geo:        buildRouteGeo('edit'),
    status:           document.getElementById('oeStatus').value,
    sofer_type:       soferType||null,
    email_sofer:      soferType==='Intern' ? soferSel.value : null,
    nume_sofer:       soferType==='Intern' ? (selectedUser ? selectedUser.nume : '') : document.getElementById('oeNumeSoferExtern').value,
    firma_extern:     soferType==='Extern' ? document.getElementById('oeFirmaExtern').value : null,
    rendszam_camion:  document.getElementById('oeCamion').value||null,
    rendszam_remorca: document.getElementById('oeRemorca').value||null,
  };
  // A már létező fuvart nem blokkoljuk: a típus üresen maradhat.
  // Csak ha LTL-re állítják, akkor kötelezők a méretek.
  if(payload.load_type==='LTL' && (!payload.hossz_cm||!payload.szel_cm||!payload.mag_cm)){toast('Részrakománynál (LTL) a méretek (hossz/szél./mag.) kötelezők!','err');return;}

  gas('comUpdate', [_oeOrderId, payload]).then(function(r) {
    if (r && r.ok) {
      toast('✅ Mentve!', 'ok');
      closeOrderEditModal();
      loadOrders();
    } else { toast(r&&r.err||'Szerver hiba','err'); }
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
  if(!isFinite(amount)||amount<=0){ toast('Adj meg érvényes összeget!','err'); return; }
  var p={
    amount:amount,
    method:document.getElementById('payMethod').value,
    note:document.getElementById('payNote').value.trim()
  };
  gas('markOrderPayment',[_payOrderId,p]).then(function(r){
    if(r&&r.ok){
      toast(r.payment_status==='paid'?'✅ Fuvar teljesen kifizetve!':'💰 Részfizetés rögzítve','ok');
      closePaymentModal();
      _afterPaymentRefresh();
    } else toast((r&&r.err)||'Hiba','err');
  });
}

function resetPayment(){
  if(!confirm('Biztosan nullázod a rögzített fizetéseket ennél a fuvarnál?')) return;
  gas('markOrderPayment',[_payOrderId,{reset:true}]).then(function(r){
    if(r&&r.ok){ toast('Fizetés visszaállítva (kintlévő)','ok'); closePaymentModal(); _afterPaymentRefresh(); }
    else toast((r&&r.err)||'Hiba','err');
  });
}

/* ── 🌍 Ügyfél tracking-link másolása (publikus /t/<token> oldal) ── */
function copyTrackingLink(orderId){
  gas('getTrackingLink',[orderId]).then(function(r){
    if(!r||!r.ok){ toast((r&&r.err)||'Hiba a link generálásánál','err'); return; }
    var url=location.origin+'/t/'+r.token;
    function done(){ toast('🌍 Követő-link a vágólapon — küldd el az ügyfélnek!','ok'); }
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(done).catch(function(){ prompt('Másold ki a linket:',url); });
    } else { prompt('Másold ki a linket:',url); }
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
    '<h3 id="hoTitle">⛔ Áru leadása</h3>'+
    '<div class="text-muted" id="hoSub" style="font-size:12.5px;margin-bottom:12px;"></div>'+
    '<div class="field"><label>Mi történik az áruval? *</label>'+
      '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:4px;">'+
      '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;"><input type="radio" name="hoType" value="trailer" checked onchange="hoTypeChange()"> 🅿️ Pótkocsin parkol (megrakva)</label>'+
      '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;"><input type="radio" name="hoType" value="warehouse" onchange="hoTypeChange()"> 📦 Raktárba kerül</label>'+
      '</div></div>'+
    '<div class="field"><label>Hol van az áru? (helység) *</label><input class="input" id="hoLoc" placeholder="pl. Brașov"></div>'+
    '<div class="field"><label>Változik a végső cél? (üresen marad a régi)</label><input class="input" id="hoNewDest" placeholder="pl. Constanța — csak ha módosul"></div>'+
    '<div id="hoWhBlock" style="display:none;">'+
      '<div class="text-muted" style="font-size:12px;font-weight:700;margin:6px 0 8px;">📦 Raktár-adatok (kötelező)</div>'+
      '<div class="grid-2">'+
      '<div class="field"><label>Darabszám *</label><input class="input" id="hoQty" type="number" min="1" placeholder="pl. 33"></div>'+
      '<div class="field"><label>Egység *</label><select class="select" id="hoQtyUnit"><option value="paletta">Paletta</option><option value="doboz">Doboz</option><option value="egyeb">Egyéb</option></select></div>'+
      '</div>'+
      '<div class="grid-3">'+
      '<div class="field"><label>Hossz (cm) *</label><input class="input" id="hoLen" type="number" min="1" placeholder="pl. 800"></div>'+
      '<div class="field"><label>Szélesség (cm) *</label><input class="input" id="hoWid" type="number" min="1" placeholder="pl. 248"></div>'+
      '<div class="field"><label>Magasság (cm) *</label><input class="input" id="hoHei" type="number" min="1" placeholder="pl. 220"></div>'+
      '</div>'+
      '<div class="grid-2">'+
      '<div class="field"><label>Súly (kg) *</label><input class="input" id="hoWeight" type="number" min="1" step="0.01" placeholder="pl. 12500"></div>'+
      '<div class="field"><label>Dokumentum lapszáma *</label><input class="input" id="hoDocPages" type="number" min="1" placeholder="pl. 10"></div>'+
      '</div>'+
      '<div class="text-muted" style="font-size:11.5px;margin-bottom:8px;">📷 Mentés után töltsd fel / fotózd le a dokumentumokat — amíg nincs feltöltve, a rendszer folyamatosan figyelmeztet.</div>'+
    '</div>'+
    '<div class="field"><label>Megjegyzés</label><input class="input" id="hoNote" placeholder="opcionális"></div>'+
    '<div class="row" style="margin-top:14px;display:flex;gap:10px;">'+
    '<button class="btn ghost col" onclick="closeHandoverModal()">Mégse</button>'+
    '<button class="btn primary col" id="hoSubmitBtn" onclick="submitHandover()">⛔ Leadás mentése</button>'+
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
  document.getElementById('hoTitle').textContent = _hoMode==='confirm' ? '✅ Sofőr-leadás visszaigazolása' : '⛔ Áru leadása';
  document.getElementById('hoSub').textContent = 'Fuvar: '+orderId+
    (_hoMode==='confirm' ? ' — a sofőr adatai előtöltve, javíthatod/kiegészítheted.' :
     ' — a fuvar felrakója a leadás helye lesz, és kiosztásra vár.');
  document.getElementById('hoSubmitBtn').textContent = _hoMode==='confirm' ? '✅ Visszaigazolás' : '⛔ Leadás mentése';
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
  if(!data.location){toast('A leadás helye (helység) kötelező!','err');return;}
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
      toast(type==='trailer'?'🅿️ Áru leadva — pótkocsin parkol, kiosztásra vár.':'📦 Áru raktárba adva — kiosztásra vár.','ok');
      closeHandoverModal();
      if(typeof loadOrders==='function')loadOrders();
      loadPendingHandovers();
      // Raktárnál azonnali felszólítás a dokumentum-feltöltésre
      if(type==='warehouse'&&typeof openDocModal==='function'){
        setTimeout(function(){ toast('📷 Töltsd fel az áru dokumentumait most!','err'); openDocModal(oid); },400);
      }
    } else toast((r&&r.err)||'Hiba','err');
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
      '<div class="text-primary" style="font-weight:800;font-size:13.5px;margin-bottom:6px;">⏳ Sofőr áru-leadás kérések — visszaigazolásra várnak ('+_hoPendingCache.length+')</div>'+
      _hoPendingCache.map(function(o,i){
        return '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--border);font-size:12.5px;">'+
          '<b class="text-primary">'+esc(String(o.id))+'</b>'+
          '<span class="text-muted">'+esc(o.nume_sofer||o.handover_by||'?')+' · '+
          (o.handover_type==='trailer'?'🅿️ pótkocsin parkol':'📦 raktárba került')+' @ <b>'+esc(o.handover_loc||'?')+'</b>'+
          (o.rendszam_remorca?' · pótkocsi: '+esc(o.rendszam_remorca):'')+'</span>'+
          '<span style="margin-left:auto;display:flex;gap:6px;">'+
          '<button class="btn ok" style="padding:4px 12px;font-size:12px;" onclick="hoConfirmIdx('+i+')">✓ Visszaigazol</button>'+
          '<button class="btn danger" style="padding:4px 12px;font-size:12px;" onclick="hoRejectIdx('+i+')">✕ Elutasít</button>'+
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
  if(!confirm('Elutasítod a(z) '+o.id+' leadás-kérését? A sofőr push-értesítést kap.'))return;
  gas('rejectHandover',[o.id]).then(function(r){
    if(r&&r.ok){ toast('Kérés elutasítva','ok'); loadPendingHandovers(); if(typeof loadOrders==='function')loadOrders(); }
    else toast((r&&r.err)||'Hiba','err');
  });
};

/* ── 📦 RAKTÁR FÜL ── */
function loadWarehouseTab(){
  var box=document.getElementById('warehouseBox');
  if(!box)return;
  box.innerHTML='<div class="glass" style="padding:20px;color:var(--text-muted);">Betöltés...</div>';
  gas('getWarehouseItems').then(function(list){
    list=Array.isArray(list)?list:[];
    var act=list.filter(function(w){return w.status==='Raktarban';});
    var noDocs=act.filter(function(w){return !parseInt(w.doc_count,10);}).length;
    var html='<div class="glass" style="padding:22px;">'+
      '<h2 class="h-title">📦 Raktár — leadott áruk</h2>'+
      '<div class="h-sub">Raktárba adott fuvarok: a felrakó a betárolás helye, kiosztással mennek tovább. '+
      'Jelenleg raktárban: <b>'+act.length+'</b>'+
      (noDocs?' · <span style="color:var(--status-danger);font-weight:700;">⚠️ '+noDocs+' tételnél hiányzik a dokumentum!</span>':'')+'</div></div>';
    if(!list.length){
      html+='<div class="glass text-muted" style="padding:22px;margin-top:16px;">Nincs raktárban lévő áru. A fuvarlistán a ⛔ gombbal adhatsz le árut raktárba.</div>';
      box.innerHTML=html; return;
    }
    html+='<div class="glass" style="padding:22px;margin-top:16px;overflow-x:auto;">'+
      '<table class="table"><thead><tr><th>Fuvar</th><th>Ügyfél</th><th>Raktár helye</th><th>Mennyiség</th>'+
      '<th>Foglalt hely (h×sz×m cm)</th><th>Súly (kg)</th><th>Dok. lapszám</th><th>Dokumentumok</th><th>Betárolva</th><th>Státusz</th><th>Művelet</th></tr></thead><tbody>'+
      list.map(function(w){
        var docs=parseInt(w.doc_count,10)||0;
        var inWh=w.status==='Raktarban';
        var docCell=docs>0
          ?'<span style="color:var(--status-ok);">📷 '+docs+' db</span>'
          :(inWh?'<span class="badge err">⚠️ Hiányzik — tölts fel!</span>':'<span class="text-muted">—</span>');
        return '<tr'+(inWh&&!docs?' style="background:rgba(239,68,68,0.06);"':'')+'>'+
          '<td><b>'+esc(String(w.order_id))+'</b></td>'+
          '<td>'+esc(w.client||'—')+'</td>'+
          '<td>'+esc(w.location||'—')+'<div class="text-muted" style="font-size:11px;">→ végcél: '+esc(w.loc_descarcare||'—')+'</div></td>'+
          '<td>'+(w.qty||'—')+' '+esc(w.qty_unit||'')+'</td>'+
          '<td>'+(w.length_cm||'—')+' × '+(w.width_cm||'—')+' × '+(w.height_cm||'—')+'</td>'+
          '<td>'+(w.weight_kg||'—')+'</td>'+
          '<td>'+(w.doc_pages||'—')+'</td>'+
          '<td>'+docCell+'</td>'+
          '<td>'+(w.created_at?new Date(w.created_at).toLocaleDateString('hu-HU'):'—')+'</td>'+
          '<td><span class="badge '+(inWh?'warn':'info')+'">'+(inWh?'📦 Raktárban':'✓ Kiadva')+'</span></td>'+
          '<td style="display:flex;gap:4px;flex-wrap:wrap;">'+
            '<button class="btn ghost" style="padding:4px 10px;font-size:12px;" title="Dokumentum feltöltése" onclick="openDocModal(\''+esc(String(w.order_id))+'\')">📎</button>'+
            '<button class="btn primary" style="padding:4px 10px;font-size:12px;" title="Fuvar szerkesztése / kiosztása" onclick="openOrderEdit(\''+esc(String(w.order_id))+'\')">✏️</button>'+
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
