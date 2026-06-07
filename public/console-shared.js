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

function createOrder(){
  const st=document.querySelector('input[name="oSoferType"]:checked');
  const type=st?st.value:'None';
  const p={
    client:document.getElementById('oClient').value.trim(),
    ref:document.getElementById('oRef').value.trim(),
    pret:document.getElementById('oPret').value,
    km:document.getElementById('oKm').value,
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
  gas('comCreate',[p]).then(r=>{
    if(r&&r.ok){
      toast('Fuvar mentve! ID: '+r.id,'ok');
      loadOrders();
      ['oClient','oRef','oPret','oKm','oLoad','oUnload','oLoadDate','oUnloadDate','oExternNume','oExternFirma','oExternTelefon'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
      document.querySelectorAll('input[name="oSoferType"]').forEach(r=>{if(r.value==='None')r.checked=true;});
      onSoferTypeChange('None');
    }else{toast((r&&r.err)||'Hiba történt','err');}
  });
}

function createVehicle(tip){
  let prefix=tip==='Vontato'?'vt':'pt';
  const v={tip:tip,rendszam:document.getElementById(prefix+'Rendszam').value.trim(),marca:document.getElementById(prefix+'Marca').value.trim(),model:document.getElementById(prefix+'Model').value.trim(),an:document.getElementById(prefix+'An').value,nota:document.getElementById(prefix+'Nota').value.trim()};
  if(!v.rendszam){toast('A rendszám kötelező!','err');return;}
  gas('vehicleCreate',[v]).then(r=>{if(r.ok){toast((tip==='Vontato'?'Vontató':'Pótkocsi')+' hozzáadva!','ok');['Rendszam','Marca','Model','An','Nota'].forEach(f=>{document.getElementById(prefix+f).value='';});loadVehicles();}else{toast(r.err||'Hiba történt','err');}});
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

function loadBorderLogs(){gas('getBorderLogs').then(list=>{document.querySelector('#tblBorderLogs tbody').innerHTML=list.map(l=>`<tr><td>${l.created_at?new Date(l.created_at).toLocaleString('hu-HU'):'—'}</td><td>${l.nume_sofer||l.email_sofer||'—'}</td><td><span class="badge warn">${l.tip||'—'}</span></td><td>${l.gps_lat?('📍 '+parseFloat(l.gps_lat).toFixed(4)+', '+parseFloat(l.gps_lng).toFixed(4)):'GPS n/a'}</td></tr>`).join('');});}


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
      sel.innerHTML = '<option value="">Összes sofőr</option>' + sofors.map(function(s){return '<option value="'+s+'">'+s+'</option>';}).join('');
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
    tb.innerHTML=list.map(d=>`<tr><td>${d.nume||'—'}</td><td>${d.firma||'—'}</td><td>${d.telefon||'—'}</td><td>${d.email||'—'}</td><td>${d.rendszam_camion||'—'}</td><td>${d.rendszam_remorca||'—'}</td><td>${d.nota||'—'}</td><td><button class="btn primary" style="padding:4px 10px;font-size:12px;" onclick="editExtDriver(${d.id})">Szerk</button> <button class="btn danger" style="padding:4px 10px;font-size:12px;" onclick="deleteExtDriver(${d.id})">Töröl</button></td></tr>`).join('');
  });
}

function loadInternalDrivers(){
  gas('getInternalDrivers').then(function(list){
    var tbody = document.querySelector('#tblInternalDrivers tbody');
    if(!tbody) return;
    if(!list||!list.length){
      tbody.innerHTML='<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:24px;">Nincs regisztrált belső sofőr.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(function(d){
      var safeJson = JSON.stringify(d).replace(/"/g,'&quot;');
      return '<tr>'
        +'<td>'+d.nume+'</td>'
        +'<td>'+d.email+'</td>'
        +'<td>'+(d.tel||'—')+'</td>'
        +'<td>'
        +'<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="editUser('+safeJson+')">Szerkeszt</button> '
        +'<button class="btn danger" style="padding:4px 10px;font-size:12px;" onclick="deleteUser(\''+d.email+'\',\''+d.nume+'\')">Töröl</button>'
        +'</td>'
        +'</tr>';
    }).join('');
  });
}

function loadInvites(){
  gas('invListAll').then(list=>{
    if(!Array.isArray(list)){document.querySelector('#tblInv tbody').innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--muted);">Nincs meghívókód.</td></tr>';return;}
    document.querySelector('#tblInv tbody').innerHTML=list.map(i=>{
      var sc=i.status==='Aktiv'?'ok':i.status==='Felhasznalva'?'info':'err';
      return '<tr>'
        +'<td><b style="color:#fff;">'+i.kod+'</b></td>'
        +'<td>'+i.pozicio+'</td>'
        +'<td>'+(i.nume||'—')+'</td>'
        +'<td>'+(i.email||'—')+'</td>'
        +'<td>'+(i.tel||'—')+'</td>'
        +'<td><span class="badge '+sc+'">'+i.status+'</span></td>'
        +'<td><button class="btn ghost" style="padding:3px 10px;font-size:12px;" onclick="revokeInv(\''+i.kod+'\')" '+(i.status!=='Aktiv'?'disabled':'')+'>Visszavon</button></td>'
        +'</tr>';
    }).join('');
  });
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
}

function loadOrders(){
  gas('comList').then(list=>{
    if(!Array.isArray(list))list=[];
    _ordersAllCache = list;
    renderFilteredOrders(list);
    return; // legacy map lent törölve
    list.map(c=>{
      let soferInfo='—';
      if(c.sofer_type==='Intern')soferInfo=c.nume_sofer||c.email_sofer||'—';
      else if(c.sofer_type==='Extern')soferInfo=c.nume_sofer||c.firma_extern||'—';
      let sc='info';
      if(c.status==='Alocat')sc='warn';
      if(c.status==='In Curs')sc='ok';
      if(c.status==='Finalizat')sc='ok';
      if(c.status==='Anulat')sc='err';
      if(c.status==='Extern')sc='warn';
     return`<tr><td><b>${c.id}</b></td><td>${c.client||'—'}</td><td>${c.loc_incarcare||'—'} → ${c.loc_descarcare||'—'}</td><td>${c.km||'—'}</td><td>${c.pret||'—'}</td><td>${soferInfo}</td><td>${c.rendszam_camion||'—'}</td><td><span class="badge ${sc}">${c.status}</span></td><td style="display:flex;gap:4px;"><button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="openDocModal('${c.id}')">📎</button><button class="btn primary" style="padding:4px 10px;font-size:12px;" onclick="openOrderEdit('${c.id}')">✏️</button></td></tr>`;
    }).join('');
  });
}

function loadReceivedFuvarlevelek(){
  gas('getFuvarlevelek').then(list=>{
    var tb=document.querySelector('#tblReceivedFuv tbody');
    if(!list||list.length===0){tb.innerHTML='<tr><td colspan="4">Nincs beküldött fuvarlevél.</td></tr>';return;}
    tb.innerHTML=list.map(f=>`<tr><td><b style="color:#fff;">${f.file_name||'—'}</b></td><td>${f.nume_sofer||f.email_sofer||'—'}</td><td>${f.data_completare?new Date(f.data_completare).toLocaleString('hu-HU'):'—'}</td><td><a href="/api/pdf-download/${f.id}" target="_blank" class="btn primary" style="text-decoration:none;padding:5px 10px;">Letöltés</a></td></tr>`).join('');
  });
}


function loadVehicles(){
  gas('vehicleList').then(list=>{
    if(!Array.isArray(list))list=[];
    vehicleCache=list;
    renderVehicleTable('tblVontato',list.filter(v=>v.tip==='Vontato'));
    renderVehicleTable('tblPotkocsi',list.filter(v=>v.tip==='Potkocsi'));
  });
}

function logout(){gas('authLogout').then(function(){window.location.href='/login';}).catch(function(){window.location.href='/login';});}

function oeToggleSoferType() {
  var t = document.getElementById('oeSoferType').value;
  document.getElementById('oeInternWrap').style.display = t === 'Intern' ? '' : 'none';
  document.getElementById('oeExternWrap').style.display = t === 'Extern' ? '' : 'none';
  document.getElementById('oeExternFirmaWrap').style.display = t === 'Extern' ? '' : 'none';
}

function onSoferTypeChange(type){document.getElementById('oInternBlock').style.display=type==='Intern'?'block':'none';document.getElementById('oExternBlock').style.display=type==='Extern'?'block':'none';}

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

function renderCamions(list){const sel=document.getElementById('oCamionSelect');if(!sel)return;sel.innerHTML='<option value="">— Nincs megadva —</option>'+list.map(v=>`<option value="${v.rendszam}">${v.rendszam}${v.marca?' — '+v.marca:''}${v.model?' '+v.model:''}</option>`).join('');}

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
    html += '<span style="font-size:15px;font-weight:700;color:#fff;">👤 '+g.nev+'</span>';
    html += '<span style="font-size:12px;color:var(--muted);background:var(--bg-3);padding:3px 10px;border-radius:20px;border:1px solid var(--border);">📅 '+g.nap+'</span>';
    html += '<span style="font-size:12px;color:var(--muted);">'+g.docs.length+' fájl</span>';
    html += '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;">';
    g.docs.forEach(function(d) {
      var bc = d.tip==='CMR'?'ok':d.tip==='Számla'?'info':'warn';
      var time = d.created_at ? new Date(d.created_at).toLocaleTimeString('hu-HU',{hour:'2-digit',minute:'2-digit'}) : '';
      html += '<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:14px;">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span class="badge '+bc+'">'+(d.tip||'Egyéb')+'</span><span style="font-size:11px;color:var(--muted);">'+time+'</span></div>';
      html += '<div style="font-size:12px;color:var(--soft);margin-bottom:10px;word-break:break-all;">'+(d.file_name||'—')+'</div>';
      html += '<div style="display:flex;gap:6px;">';
      html += '<a href="/api/doc-download/'+d.id+'" target="_blank" class="btn primary" style="flex:1;text-align:center;text-decoration:none;padding:8px 6px;font-size:12px;">👁 Megtekint</a>';
      html += '<a href="/api/doc-download/'+d.id+'" download class="btn ghost" style="flex:1;text-align:center;text-decoration:none;padding:8px 6px;font-size:12px;">⬇ Letölt</a>';
      html += '</div></div>';
    });
    html += '</div></div>';
  });
  container.innerHTML = html;
}

function renderExternDrivers(list){const sel=document.getElementById('oExternSelect');if(!sel)return;sel.innerHTML='<option value="">— Új sofőr beírása kézzel —</option>'+list.map(d=>`<option value="${d.id}">${d.nume||''} ${d.firma?'/ '+d.firma:''}</option>`).join('');}

function renderInternDrivers(list){const sel=document.getElementById('oInternDriver');if(!sel)return;sel.innerHTML='<option value="">— Válassz sofőrt —</option>'+list.map(u=>`<option value="${u.email}">${u.nume} (${u.email})</option>`).join('');}

function renderRemorcas(list){const sel=document.getElementById('oRemorcaSelect');if(!sel)return;sel.innerHTML='<option value="">— Nincs megadva —</option>'+list.map(v=>`<option value="${v.rendszam}">${v.rendszam}${v.marca?' — '+v.marca:''}${v.model?' '+v.model:''}</option>`).join('');}


function renderVehicleTable(tableId,list){
  const tb=document.querySelector('#'+tableId+' tbody');
  if(!list||list.length===0){tb.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--muted);">Nincs még felvéve.</td></tr>';return;}
  tb.innerHTML=list.map(v=>`<tr><td><b>${v.rendszam}</b></td><td>${v.marca||'—'}</td><td>${v.model||'—'}</td><td>${v.an||'—'}</td><td>${v.nota||'—'}</td><td><button class="btn primary" style="padding:4px 10px;font-size:12px;" onclick="editVehicle(${v.id})">Szerk</button> <button class="btn danger" style="padding:4px 10px;font-size:12px;" onclick="deleteVehicle(${v.id})">Töröl</button></td></tr>`).join('');
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

/* ── HERE Maps konfiguráció + csempe-URL (a kulcs a szerverről jön) ── */
function getHereConfig() {
  if (window._hereCfgPromise) return window._hereCfgPromise;
  window._hereCfgPromise = fetch('/api/here-config', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : {}; })
    .catch(function () { return {}; });
  return window._hereCfgPromise;
}
function hereTileUrl(theme, apiKey) {
  // HERE Raster Tile API v3 (a v2.1 maptile API le lett kapcsolva).
  var style = (theme === 'light') ? 'explore.day' : 'explore.night';
  return 'https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/png?style=' + style +
    '&size=512&apiKey=' + apiKey;
}
// CartoDB tartalék, ha nincs HERE kulcs (a térkép ne maradjon üres)
function cartoTileUrl(theme) {
  return theme === 'light'
    ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
}

/* ── Téma (light/dark) — a .main-content[data-theme] attribútumon ── */
function toggleTheme() {
  var mc = document.getElementById('mainContent');
  if (!mc) return;
  var next = (mc.getAttribute('data-theme') === 'light') ? 'dark' : 'light';
  mc.setAttribute('data-theme', next);
  try { localStorage.setItem('vs-theme', next); } catch (e) {}
  syncThemeToggleIcon();
  // Térkép-csempék cseréje a témához (HERE, vagy CartoDB tartalék)
  if (window._dashMap && window._dashTileLayer) {
    window._dashTileLayer.setUrl(window._hereApiKey
      ? hereTileUrl(next, window._hereApiKey)
      : cartoTileUrl(next));
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
  syncThemeToggleIcon();
  initDashMap();
  refreshDashVehicles();
  if (window._dashVehTimer) clearInterval(window._dashVehTimer);
  window._dashVehTimer = setInterval(refreshDashVehicles, 30000);
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

  // HERE csempék (a kulcs a /api/here-config-ról); ha nincs kulcs -> CartoDB tartalék.
  getHereConfig().then(function (cfg) {
    var key = (cfg && cfg.apiKey) || null;
    window._hereApiKey = key;
    if (window._dashTileLayer && window._dashMap) window._dashMap.removeLayer(window._dashTileLayer);
    window._dashTileLayer = key
      ? L.tileLayer(hereTileUrl(theme, key),
          { attribution: '© HERE Technologies', maxZoom: 20, tileSize: 512, zoomOffset: -1 })
      : L.tileLayer(cartoTileUrl(theme),
          { attribution: '© CARTO', maxZoom: 19, subdomains: 'abcd' });
    if (window._dashMap) {
      window._dashTileLayer.addTo(window._dashMap);
      window._dashMap.invalidateSize();
    }
  });

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
