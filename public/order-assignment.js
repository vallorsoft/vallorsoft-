/* ============================================================
 *  VallorSoft — Comanda de Transport (megbízás/megrendelés)
 *  Kliens-oldali wizard-modal + PDF-generálás (pdf-lib).
 *  Csak Extern / sofőr nélküli fuvarra érhető el.
 *  A fuvar-kiírás (order-wizard.js) VIZUÁLIS MINTÁJÁT követi:
 *  card-alapú lépések (.oc-step-card), kontrasztos gombokkal.
 *  A PDF a KÖZÖS company_branding (logó + pecsét) és companies
 *  (nev/cui/reg_com/adresa/…) adatokra épül — multi-tenant.
 * ============================================================ */
(function(){
  'use strict';
  if (window.OrderAssignment) return;

  // Segédek
  function t(k, fallback){
    try { if (window.I18N && typeof window.I18N.t === 'function') { var v = window.I18N.t(k); if (v && v !== k) return v; } } catch(e){}
    return fallback != null ? fallback : k;
  }
  function esc(s){ s = s==null?'':String(s); return s.replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function toast(msg, kind){
    try { if (window.toast) return window.toast(msg, kind); } catch(e){}
    // fallback: rövid banner
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;background:'+(kind==='err'?'#7f1d1d':'#065f46')+';color:#fff;padding:10px 18px;border-radius:8px;font-weight:600;';
    d.textContent = msg; document.body.appendChild(d);
    setTimeout(function(){ d.remove(); }, 3200);
  }
  function gas(fn, args){
    return fetch('/api/execute', {
      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin',
      body: JSON.stringify({ functionName: fn, arguments: args||[] })
    }).then(function(r){ return r.json(); }).then(function(j){ return j.result; });
  }
  function fmtDate(d){
    if (!d) return '';
    try {
      var dt = new Date(d);
      if (isNaN(dt.getTime())) return String(d).slice(0,10);
      var y = dt.getFullYear(), m = String(dt.getMonth()+1).padStart(2,'0'), dd = String(dt.getDate()).padStart(2,'0');
      return y + '-' + m + '-' + dd;
    } catch(e){ return String(d).slice(0,10); }
  }
  function num(x){ if (x==null || x==='') return null; var n = Number(x); return Number.isFinite(n) ? n : null; }

  // A `13.6 m` alapérték: FTL-nél mindig; LTL-nél a rakomány `hossz_cm/100` (ha van).
  function defaultMetri(order){
    if (order && order.load_type === 'LTL' && order.hossz_cm) {
      var m = Math.round((Number(order.hossz_cm) / 100) * 10) / 10;
      if (m > 0 && m <= 20) return String(m);
    }
    return '13.6';
  }

  // ── Állapot ──────────────────────────────────────────────
  var OA = {
    orderId: null,
    step: 1,
    maxStep: 6,
    // Előtöltő snapshot (a szerverről):
    data: null,   // { order, carrier, stops, company, existing }
    carriers: [],
    // Szerkeszthető payload — a mentéshez és a PDF-render-hez:
    payload: {
      number_source: 'auto',        // 'auto' | 'custom'
      custom_number: '',
      carrier_id: null,
      price: null,
      currency: 'EUR',
      payment_term_days: 30,
      fields: {
        stops: { pickups: [], deliveries: [] },
        vehicle: {
          tip_camion: 'CAP TRACTOR / 13.6 m prelata standard',
          truck_kinds: [],
          flags: {
            doi_soferi:false, podea_goala:true, chingi:true, presuri:true,
            coltare:true, paleti_schimb:false, termodiagrama:false, cablu_vamal:true, adr:false
          },
          alte_specificatii: ''
        },
        driver: { name:'', phone:'' }
      }
    },
    _renderedPdfBlobUrl: null       // az élő előnézet iframe-hez
  };

  // ── Belépési pont ────────────────────────────────────────
  function open(orderId){
    if (!orderId) return;
    OA.orderId = String(orderId);
    OA.step = 1;
    _mountModalIfNeeded();
    document.getElementById('oaModal').classList.add('open');
    document.body.style.overflow = 'hidden';

    // Adatbetöltés (fuvar + carrier + stops + company + meglévő megbízás)
    _setBusy(true);
    Promise.all([
      gas('orderAssignmentGet', [OA.orderId]),
      gas('orderAssignmentCarriers', [])
    ]).then(function(rs){
      var d = rs[0], cs = rs[1];
      if (!d || !d.ok) { _setBusy(false); toast(d && d.err || t('oa.errLoad', 'Nu s-a putut incarca comanda.'), 'err'); close(); return; }
      OA.data = d;
      OA.carriers = (cs && cs.ok) ? (cs.items || []) : [];
      _hydratePayload(d);
      _renderAll();
      _setBusy(false);
    }).catch(function(e){
      _setBusy(false);
      toast(t('oa.errLoad', 'Nu s-a putut incarca comanda.'), 'err');
      console.error(e);
      close();
    });
  }

  function close(){
    var m = document.getElementById('oaModal'); if (m) m.classList.remove('open');
    document.body.style.overflow = '';
    if (OA._renderedPdfBlobUrl) { try { URL.revokeObjectURL(OA._renderedPdfBlobUrl); } catch(e){} OA._renderedPdfBlobUrl = null; }
  }

  // Előtöltés: a szerver adta snapshotból a szerkeszthető payload-ba
  function _hydratePayload(d){
    var o = d.order || {}, c = d.carrier || null, stops = d.stops || [], ex = d.existing || null;

    // Ha van meglévő megbízás, azt betöltjük (a fuvar-adat felülírás nem történik).
    if (ex) {
      OA.payload.number_source = ex.number_source || 'auto';
      OA.payload.custom_number = ex.custom_number || '';
      OA.payload.carrier_id = ex.carrier_id || (c ? c.id : null);
      OA.payload.price = ex.price != null ? Number(ex.price) : (o.carrier_cost != null ? o.carrier_cost : null);
      OA.payload.currency = ex.currency || o.valuta || 'EUR';
      OA.payload.payment_term_days = ex.payment_term_days != null ? ex.payment_term_days : (c && c.payment_term_days != null ? c.payment_term_days : 30);
      var ef = ex.fields || {};
      if (ef.stops && (ef.stops.pickups || ef.stops.deliveries)) {
        OA.payload.fields.stops = { pickups: ef.stops.pickups || [], deliveries: ef.stops.deliveries || [] };
      }
      if (ef.vehicle) {
        if (ef.vehicle.tip_camion != null) OA.payload.fields.vehicle.tip_camion = ef.vehicle.tip_camion;
        if (Array.isArray(ef.vehicle.truck_kinds)) OA.payload.fields.vehicle.truck_kinds = ef.vehicle.truck_kinds.slice();
        if (ef.vehicle.flags) Object.assign(OA.payload.fields.vehicle.flags, ef.vehicle.flags);
        if (ef.vehicle.alte_specificatii != null) OA.payload.fields.vehicle.alte_specificatii = ef.vehicle.alte_specificatii;
      }
      if (ef.driver) {
        OA.payload.fields.driver.name = ef.driver.name || '';
        OA.payload.fields.driver.phone = ef.driver.phone || '';
      }
    } else {
      OA.payload.carrier_id = c ? c.id : null;
      OA.payload.price = o.carrier_cost != null ? o.carrier_cost : null;
      OA.payload.currency = o.valuta || 'EUR';
      OA.payload.payment_term_days = c && c.payment_term_days != null ? c.payment_term_days : 30;
      OA.payload.fields.driver.name = o.nume_sofer_extern || o.nume_sofer || '';
      OA.payload.fields.driver.phone = o.telefon_sofer_extern || '';
    }

    // Stops előtöltése az `order_stops`-ból, ha üres.
    var pu = stops.filter(function(s){ return s.kind === 'pickup'; });
    var de = stops.filter(function(s){ return s.kind === 'delivery'; });
    function fillStopArr(fromArr, existingArr){
      // Minden stop-hoz sor; meglévő értékek megmaradnak (stop_id szerint párosítunk).
      var byId = {};
      (existingArr || []).forEach(function(x){ if (x && x.stop_id) byId[x.stop_id] = x; });
      return fromArr.map(function(s){
        var cur = byId[s.id] || {};
        return {
          stop_id: s.id,
          _loc: s.loc || '',
          _firma: s.firma || '',
          _data: fmtDate(s.data),
          interval: cur.interval || '',
          paleti: cur.paleti || '',
          tip_palet: cur.tip_palet || '',
          kg: cur.kg || '',
          metri: cur.metri || defaultMetri(o),
          referinta: cur.referinta || (s.ref || o.ref || ''),
          instructiuni: cur.instructiuni || ''
        };
      });
    }
    OA.payload.fields.stops.pickups   = fillStopArr(pu, OA.payload.fields.stops.pickups);
    OA.payload.fields.stops.deliveries = fillStopArr(de, OA.payload.fields.stops.deliveries);

    // Alapértelmezett kg: a fuvar `suly_kg` — minden sorra, csak ha még nincs.
    if (o.suly_kg) {
      ['pickups','deliveries'].forEach(function(k){
        OA.payload.fields.stops[k].forEach(function(row){
          if (!row.kg) row.kg = String(o.suly_kg);
        });
      });
    }
  }

  // ── Modal DOM (egyszer felépítve) ────────────────────────
  function _mountModalIfNeeded(){
    if (document.getElementById('oaModal')) return;
    var back = document.createElement('div');
    back.className = 'modal-back oa-modal-back';
    back.id = 'oaModal';
    back.innerHTML =
      '<div class="oa-modal-inner">'+
        '<div class="oa-modal-head">'+
          '<h2 class="oa-modal-title">📄 <span data-i18n="oa.title">'+esc(t('oa.title', 'Comanda de Transport'))+'</span>'+
            ' <span class="oa-sub" id="oaSubTitle" style="opacity:.75;font-weight:500;"></span></h2>'+
          '<button type="button" class="btn ghost" onclick="OrderAssignment.close()">✕</button>'+
        '</div>'+
        '<div class="oa-modal-body" id="oaBody">'+
          _shellHtml()+
        '</div>'+
      '</div>';
    document.body.appendChild(back);
    // Kattintás a hátterére: NE zárja (a felhasználó ne veszítse el a beírt adatokat).
    back.addEventListener('click', function(e){ if (e.target === back) { /* no-op */ } });
  }

  function _shellHtml(){
    function card(n, tk, td, bodyId){
      return '<div class="oc-step-card" data-step="'+n+'" data-state="pending">'+
        '<div class="oc-step-bar" onclick="OrderAssignment.goStep('+n+')">'+
          '<div class="oc-step-bar-num"><span class="oc-sb-idx">'+(n<6?n:'✓')+'</span></div>'+
          '<div class="oc-step-bar-body">'+
            '<div class="oc-step-bar-title" data-i18n="'+tk+'">'+esc(td)+'</div>'+
            '<div class="oc-step-bar-sum" id="oaSum'+n+'"></div>'+
          '</div>'+
          '<div class="oc-step-bar-act"><span class="oc-step-bar-edit">✏️</span></div>'+
        '</div>'+
        '<div class="oc-step-open">'+
          '<div class="oc-step-head">'+
            '<span class="oc-step-num">'+(n<6?n:'✓')+'</span>'+
            '<h3 class="oc-step-title" data-i18n="'+tk+'">'+esc(td)+'</h3>'+
          '</div>'+
          '<div class="oc-step-content" id="'+bodyId+'"></div>'+
        '</div>'+
      '</div>';
    }
    return '<div class="oc-shell oa-shell">'+
      '<div class="oc-progress" id="oaProgress"></div>'+
      '<div class="oc-body oa-body">'+
        card(1, 'oa.step1', '📋 Date de baza', 'oaStep1')+
        card(2, 'oa.step2', '⬆️ Puncte de incarcare', 'oaStep2')+
        card(3, 'oa.step3', '⬇️ Puncte de descarcare', 'oaStep3')+
        card(4, 'oa.step4', '🚛 Vehicul + echipare', 'oaStep4')+
        card(5, 'oa.step5', '👤 Sofer', 'oaStep5')+
        card(6, 'oa.step6', '📄 Verificare + PDF', 'oaStep6')+
        '<div class="oc-nav" id="oaNav">'+
          '<button type="button" class="btn ghost" id="oaBtnBack" onclick="OrderAssignment.prev()">← <span data-i18n="oa.back">'+esc(t('oa.back','Inapoi'))+'</span></button>'+
          '<div class="oc-nav-spacer"></div>'+
          '<button type="button" class="btn primary" id="oaBtnNext" onclick="OrderAssignment.next()"><span data-i18n="oa.next">'+esc(t('oa.next','Continuare'))+'</span> →</button>'+
          '<button type="button" class="btn primary" id="oaBtnSubmit" style="display:none;" onclick="OrderAssignment.finish()">✅ <span data-i18n="oa.save">'+esc(t('oa.save','Salveaza + PDF'))+'</span></button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }

  function _setBusy(b){
    var body = document.getElementById('oaBody'); if (!body) return;
    if (b) body.classList.add('oa-busy'); else body.classList.remove('oa-busy');
  }

  // ── Rajzolás ─────────────────────────────────────────────
  function _renderAll(){
    _renderProgress();
    _renderStepStates();
    _renderStepBodies();
    _updateNav();
    _updateSubTitle();
    if (window.I18N && typeof window.I18N.apply === 'function') { try { window.I18N.apply(document.getElementById('oaModal')); } catch(e){} }
  }

  function _updateSubTitle(){
    var st = document.getElementById('oaSubTitle'); if (!st) return;
    var o = (OA.data && OA.data.order) || {};
    var no = OA.payload.number_source === 'custom' ? (OA.payload.custom_number || '—') : (o.fuvar_no || o.id || '—');
    st.textContent = '· ' + no;
  }

  function _renderProgress(){
    var el = document.getElementById('oaProgress'); if (!el) return;
    var labels = [ t('oa.p1','Date'), t('oa.p2','Incarcare'), t('oa.p3','Descarcare'), t('oa.p4','Vehicul'), t('oa.p5','Sofer'), t('oa.p6','PDF') ];
    var out = '';
    for (var i=1; i<=OA.maxStep; i++){
      var cls = 'oc-pdot' + (i===OA.step?' active':(i<OA.step?' done':''));
      out += '<div class="'+cls+'" onclick="OrderAssignment.goStep('+i+')" title="'+esc(labels[i-1])+'">'+
        '<span class="oc-pn">'+(i<OA.step?'✓':i)+'</span>'+
        '<span class="oc-pl">'+esc(labels[i-1])+'</span>'+
      '</div>';
      if (i<OA.maxStep) out += '<div class="oc-pline"></div>';
    }
    el.innerHTML = out;
  }

  function _renderStepStates(){
    var modal = document.getElementById('oaModal'); if (!modal) return;
    var cards = modal.querySelectorAll('.oc-step-card');
    var openCard = null;
    Array.prototype.forEach.call(cards, function(card){
      var n = parseInt(card.getAttribute('data-step'),10);
      var state = n<OA.step ? 'done' : (n===OA.step ? 'open' : 'pending');
      card.setAttribute('data-state', state);
      if (state==='done') _renderBar(n);
      if (state==='open') openCard = card;
    });
    // Nav a nyitott card belsejébe
    var navEl = document.getElementById('oaNav');
    if (navEl && openCard){
      var wrap = openCard.querySelector('.oc-step-open');
      if (wrap && navEl.parentNode !== wrap) wrap.appendChild(navEl);
    }
  }

  function _renderBar(n){
    var el = document.getElementById('oaSum'+n); if (!el) return;
    var p = OA.payload, f = p.fields;
    var text = '';
    if (n===1) {
      var no = p.number_source==='custom' ? (p.custom_number || '—') : (t('oa.autoNr','automat'));
      var car = _carrierLabel();
      text = 'Nr: ' + no + ' · ' + car + ' · ' + (p.price != null ? (p.price + ' ' + (p.currency||'EUR')) : '—');
    } else if (n===2 || n===3) {
      var arr = n===2 ? f.stops.pickups : f.stops.deliveries;
      text = (arr.length || 0) + ' ' + (n===2 ? t('oa.locations','locatii') : t('oa.locations','locatii'));
    } else if (n===4) {
      text = (f.vehicle.tip_camion || '—');
    } else if (n===5) {
      text = (f.driver.name || '—') + (f.driver.phone ? ' · ' + f.driver.phone : '');
    } else if (n===6) {
      text = t('oa.reviewSum','Verificare + generare PDF');
    }
    el.textContent = text;
  }

  function _carrierLabel(){
    var cid = OA.payload.carrier_id;
    if (!cid) return t('oa.noCarrier','fara subcontractor');
    var c = OA.carriers.find(function(x){ return x.id === cid; });
    return c ? c.nev : ('#'+cid);
  }

  function _renderStepBodies(){
    // Step 1 — Alap-adatok
    var b1 = document.getElementById('oaStep1');
    if (b1) b1.innerHTML = _step1Html();

    // Step 2 — Felrakók
    var b2 = document.getElementById('oaStep2');
    if (b2) b2.innerHTML = _stopsHtml('pickups');

    // Step 3 — Lerakók
    var b3 = document.getElementById('oaStep3');
    if (b3) b3.innerHTML = _stopsHtml('deliveries');

    // Step 4 — Jármű
    var b4 = document.getElementById('oaStep4');
    if (b4) b4.innerHTML = _step4Html();

    // Step 5 — Sofőr
    var b5 = document.getElementById('oaStep5');
    if (b5) b5.innerHTML = _step5Html();

    // Step 6 — Ellenőrzés + PDF
    var b6 = document.getElementById('oaStep6');
    if (b6) b6.innerHTML = _step6Html();

    _bindStepHandlers();
    if (OA.step === 6) _generatePdfPreview();
  }

  function _step1Html(){
    var p = OA.payload, o = (OA.data && OA.data.order) || {};
    var carrierOpts = ['<option value="">— '+esc(t('oa.noCarrier','fara subcontractor'))+' —</option>']
      .concat(OA.carriers.map(function(c){
        return '<option value="'+c.id+'"'+(p.carrier_id===c.id?' selected':'')+'>'+esc(c.nev)+(c.cui?' · '+esc(c.cui):'')+'</option>';
      })).join('');
    return ''+
      '<div class="oa-grid oa-grid-2">'+
        '<div class="oa-card">'+
          '<div class="oa-lbl">'+esc(t('oa.numberSrc','Numarul comenzii'))+'</div>'+
          '<label class="oa-radio"><input type="radio" name="oaNrSrc" value="auto"'+(p.number_source==='auto'?' checked':'')+' onchange="OrderAssignment.setNrSource(this.value)"> '+
            '<span>'+esc(t('oa.autoNr','Automat (din cursa: '+(o.fuvar_no||o.id||'—')+')'))+'</span></label>'+
          '<label class="oa-radio"><input type="radio" name="oaNrSrc" value="custom"'+(p.number_source==='custom'?' checked':'')+' onchange="OrderAssignment.setNrSource(this.value)"> '+
            '<span>'+esc(t('oa.customNr','Numar propriu'))+'</span></label>'+
          '<input class="input oa-input" id="oaCustomNr" placeholder="ex. COM-2026-0042" value="'+esc(p.custom_number||'')+'" '+(p.number_source==='custom'?'':'disabled')+' oninput="OrderAssignment.setCustomNr(this.value)">'+
          '<div class="oa-hint">'+esc(t('oa.autoNrHint','Alap: a fuvar szama (' + (o.fuvar_no||o.id||'—') + ')'))+'</div>'+
        '</div>'+
        '<div class="oa-card">'+
          '<div class="oa-lbl">'+esc(t('oa.carrier','Subcontractor'))+'</div>'+
          '<select class="input oa-input" id="oaCarrier" onchange="OrderAssignment.setCarrier(this.value)">'+carrierOpts+'</select>'+
          '<div class="oa-hint">'+esc(t('oa.carrierHint','A cegadatok automatikusan a PDF-be kerulnek'))+'</div>'+
        '</div>'+
      '</div>'+
      '<div class="oa-grid oa-grid-3">'+
        '<div class="oa-card">'+
          '<div class="oa-lbl">'+esc(t('oa.price','Tarif convenit'))+'</div>'+
          '<input class="input oa-input" type="number" step="0.01" min="0" value="'+(p.price!=null?p.price:'')+'" oninput="OrderAssignment.setPrice(this.value)">'+
        '</div>'+
        '<div class="oa-card">'+
          '<div class="oa-lbl">'+esc(t('oa.currency','Moneda'))+'</div>'+
          '<select class="input oa-input" onchange="OrderAssignment.setCurrency(this.value)">'+
            ['EUR','RON','USD','HUF'].map(function(c){ return '<option value="'+c+'"'+(p.currency===c?' selected':'')+'>'+c+'</option>'; }).join('')+
          '</select>'+
        '</div>'+
        '<div class="oa-card">'+
          '<div class="oa-lbl">'+esc(t('oa.paymentTerm','Termen de plata (zile)'))+'</div>'+
          '<input class="input oa-input" type="number" step="1" min="0" max="365" value="'+(p.payment_term_days!=null?p.payment_term_days:30)+'" oninput="OrderAssignment.setPayTerm(this.value)">'+
        '</div>'+
      '</div>';
  }

  function _stopsHtml(which){
    var arr = OA.payload.fields.stops[which] || [];
    if (!arr.length) return '<div class="oa-empty">'+esc(t('oa.noStops','Nu sunt puncte'))+'</div>';
    return arr.map(function(row, idx){
      return ''+
      '<div class="oa-card oa-stop-card">'+
        '<div class="oa-stop-head">'+esc((which==='pickups'?'⬆️ Punct de incarcare #':'⬇️ Punct de descarcare #')+(idx+1))+'</div>'+
        '<div class="oa-grid oa-grid-2">'+
          '<div class="oa-field-ro">'+
            '<div class="oa-lbl">'+esc(t('oa.address','Adresa'))+'</div>'+
            '<div class="oa-ro">'+esc(row._loc || '—')+'</div>'+
          '</div>'+
          '<div class="oa-field-ro">'+
            '<div class="oa-lbl">'+esc(t('oa.firma','Firma'))+'</div>'+
            '<div class="oa-ro">'+esc(row._firma || '—')+'</div>'+
          '</div>'+
        '</div>'+
        '<div class="oa-grid oa-grid-4">'+
          '<div class="oa-field">'+
            '<div class="oa-lbl">'+esc(t('oa.date','Data'))+'</div>'+
            '<input class="input oa-input oa-ro-inp" value="'+esc(row._data||'')+'" readonly>'+
          '</div>'+
          '<div class="oa-field">'+
            '<div class="oa-lbl">'+esc(t('oa.interval','Interval (ex. 08:00-14:00)'))+'</div>'+
            '<input class="input oa-input" data-stop="'+which+':'+idx+':interval" value="'+esc(row.interval||'')+'">'+
          '</div>'+
          '<div class="oa-field">'+
            '<div class="oa-lbl">'+esc(t('oa.paleti','Nr. Paleti'))+'</div>'+
            '<input class="input oa-input" type="text" data-stop="'+which+':'+idx+':paleti" value="'+esc(row.paleti||'')+'">'+
          '</div>'+
          '<div class="oa-field">'+
            '<div class="oa-lbl">'+esc(t('oa.tipPalet','Tip Palet'))+'</div>'+
            '<input class="input oa-input" data-stop="'+which+':'+idx+':tip_palet" value="'+esc(row.tip_palet||'')+'" placeholder="EUR / ipari / …">'+
          '</div>'+
        '</div>'+
        '<div class="oa-grid oa-grid-2">'+
          '<div class="oa-field">'+
            '<div class="oa-lbl">'+esc(t('oa.kg','Kg'))+'</div>'+
            '<input class="input oa-input" type="text" data-stop="'+which+':'+idx+':kg" value="'+esc(row.kg||'')+'">'+
          '</div>'+
          '<div class="oa-field">'+
            '<div class="oa-lbl">'+esc(t('oa.metri','Metri Podea'))+'</div>'+
            '<input class="input oa-input" type="text" data-stop="'+which+':'+idx+':metri" value="'+esc(row.metri||'')+'">'+
          '</div>'+
        '</div>'+
        '<div class="oa-field">'+
          '<div class="oa-lbl">'+esc(t('oa.referinta','Referinta'))+'</div>'+
          '<input class="input oa-input" data-stop="'+which+':'+idx+':referinta" value="'+esc(row.referinta||'')+'">'+
        '</div>'+
        '<div class="oa-field">'+
          '<div class="oa-lbl">'+esc(t('oa.instructiuni','Instructiuni speciale'))+'</div>'+
          '<textarea class="input oa-input oa-txt" data-stop="'+which+':'+idx+':instructiuni" rows="2">'+esc(row.instructiuni||'')+'</textarea>'+
        '</div>'+
      '</div>';
    }).join('');
  }

  function _step4Html(){
    var v = OA.payload.fields.vehicle;
    var KINDS = ['standard','mega','frigo','prelata','duba','platforma','izoterm','walkingfloor','container','tautliner'];
    var FLAGS = ['doi_soferi','podea_goala','chingi','presuri','coltare','paleti_schimb','termodiagrama','cablu_vamal','adr'];
    var FLAG_LABELS = {
      doi_soferi:'2 soferi', podea_goala:'Podea goala', chingi:'Chingi', presuri:'Presuri antiderapante',
      coltare:'Coltare', paleti_schimb:'Paleti schimb', termodiagrama:'Termodiagrama printabila',
      cablu_vamal:'Cablu vamal', adr:'ADR'
    };
    return ''+
      '<div class="oa-card">'+
        '<div class="oa-lbl">'+esc(t('oa.tipCamion','TIP Camion'))+'</div>'+
        '<input class="input oa-input" id="oaTipCamion" value="'+esc(v.tip_camion||'')+'" oninput="OrderAssignment.setTipCamion(this.value)">'+
        '<div class="oa-hint">'+esc(t('oa.tipCamionHint','Alap: CAP TRACTOR / 13.6 m prelata standard'))+'</div>'+
      '</div>'+
      '<div class="oa-card">'+
        '<div class="oa-lbl">'+esc(t('oa.truckKinds','Tipuri de camion (multiple)'))+'</div>'+
        '<div class="oa-chip-grid">'+
          KINDS.map(function(k){
            var on = v.truck_kinds.indexOf(k) !== -1;
            return '<label class="oa-chip'+(on?' on':'')+'"><input type="checkbox" '+(on?'checked':'')+' onchange="OrderAssignment.toggleKind(\''+k+'\',this.checked)"> '+esc(k.charAt(0).toUpperCase()+k.slice(1))+'</label>';
          }).join('')+
        '</div>'+
      '</div>'+
      '<div class="oa-card">'+
        '<div class="oa-lbl">'+esc(t('oa.equipment','Echipare (DA/NU)'))+'</div>'+
        '<div class="oa-flags">'+
          FLAGS.map(function(k){
            var on = !!v.flags[k];
            return '<div class="oa-flag-row"><span class="oa-flag-lbl">'+esc(FLAG_LABELS[k])+'</span>'+
              '<div class="oa-flag-toggle">'+
              '<label class="oa-yn'+(on?' on':'')+'"><input type="radio" name="oaflag_'+k+'" '+(on?'checked':'')+' onchange="OrderAssignment.setFlag(\''+k+'\',true)"> DA</label>'+
              '<label class="oa-yn'+(!on?' on':'')+'"><input type="radio" name="oaflag_'+k+'" '+(!on?'checked':'')+' onchange="OrderAssignment.setFlag(\''+k+'\',false)"> NU</label>'+
              '</div></div>';
          }).join('')+
        '</div>'+
      '</div>'+
      '<div class="oa-card">'+
        '<div class="oa-lbl">'+esc(t('oa.alte','Alte specificatii'))+'</div>'+
        '<textarea class="input oa-input oa-txt" rows="2" oninput="OrderAssignment.setAlte(this.value)">'+esc(v.alte_specificatii||'')+'</textarea>'+
      '</div>';
  }

  function _step5Html(){
    var d = OA.payload.fields.driver;
    return ''+
      '<div class="oa-grid oa-grid-2">'+
        '<div class="oa-card">'+
          '<div class="oa-lbl">'+esc(t('oa.driverName','Nume sofer'))+'</div>'+
          '<input class="input oa-input" value="'+esc(d.name||'')+'" oninput="OrderAssignment.setDriver(\'name\', this.value)">'+
        '</div>'+
        '<div class="oa-card">'+
          '<div class="oa-lbl">'+esc(t('oa.driverPhone','Telefon sofer'))+'</div>'+
          '<input class="input oa-input" value="'+esc(d.phone||'')+'" oninput="OrderAssignment.setDriver(\'phone\', this.value)">'+
        '</div>'+
      '</div>';
  }

  function _step6Html(){
    var ex = OA.data && OA.data.existing;
    return ''+
      '<div class="oa-preview-wrap">'+
        '<div class="oa-preview-actions">'+
          '<button type="button" class="btn primary" onclick="OrderAssignment.saveAndDownload()">💾 '+esc(t('oa.saveDownload','Salveaza + descarca PDF'))+'</button>'+
          '<button type="button" class="btn" onclick="OrderAssignment.saveOnly()">💾 '+esc(t('oa.saveOnly','Doar salveaza'))+'</button>'+
          '<button type="button" class="btn" onclick="OrderAssignment.attachToOrder()">📎 '+esc(t('oa.attach','Ataseaza la cursa'))+'</button>'+
          '<button type="button" class="btn" onclick="OrderAssignment.emailToCarrier()">✉️ '+esc(t('oa.emailToCarrier','Trimite alv.'))+'</button>'+
          (ex ? '<button type="button" class="btn danger" onclick="OrderAssignment.deleteAssign()">🗑 '+esc(t('oa.deleteAssign','Sterge comanda'))+'</button>' : '')+
        '</div>'+
        '<div class="oa-preview-box">'+
          '<iframe id="oaPdfPreview" title="PDF preview" style="width:100%;height:70vh;border:1px solid var(--vs-border,#cbd5e1);border-radius:10px;background:#fff;"></iframe>'+
        '</div>'+
      '</div>';
  }

  function _bindStepHandlers(){
    // Stop-cellák (oninput helyett delegált eventek — így minden rerender után is működik).
    var modal = document.getElementById('oaModal'); if (!modal) return;
    if (modal._oaBound) return;
    modal._oaBound = true;
    modal.addEventListener('input', function(ev){
      var el = ev.target;
      var key = el && el.getAttribute && el.getAttribute('data-stop');
      if (!key) return;
      var parts = key.split(':'); if (parts.length !== 3) return;
      var arr = OA.payload.fields.stops[parts[0]] || [];
      var idx = parseInt(parts[1], 10);
      if (!arr[idx]) return;
      arr[idx][parts[2]] = el.value;
    });
  }

  function _updateNav(){
    var back = document.getElementById('oaBtnBack');
    var next = document.getElementById('oaBtnNext');
    var subm = document.getElementById('oaBtnSubmit');
    if (back) back.disabled = OA.step <= 1;
    if (OA.step === OA.maxStep){
      if (next) next.style.display='none';
      if (subm) subm.style.display='';
    } else {
      if (next) next.style.display='';
      if (subm) subm.style.display='none';
    }
  }

  // ── Navigáció ────────────────────────────────────────────
  function goStep(n){
    n = parseInt(n,10);
    if (!n || n < 1 || n > OA.maxStep) return;
    OA.step = n;
    _renderAll();
    setTimeout(function(){
      var oc = document.querySelector('#oaModal .oc-step-card[data-state="open"]');
      if (oc && oc.scrollIntoView) try { oc.scrollIntoView({block:'start', behavior:'smooth'}); } catch(e){}
    }, 30);
  }
  function prev(){ if (OA.step > 1) goStep(OA.step - 1); }
  function next(){ if (OA.step < OA.maxStep) goStep(OA.step + 1); }

  // ── Payload setterek ─────────────────────────────────────
  function setNrSource(v){
    OA.payload.number_source = v === 'custom' ? 'custom' : 'auto';
    var inp = document.getElementById('oaCustomNr');
    if (inp) inp.disabled = OA.payload.number_source !== 'custom';
    _updateSubTitle();
  }
  function setCustomNr(v){ OA.payload.custom_number = v || ''; _updateSubTitle(); }
  function setCarrier(v){
    var id = v ? parseInt(v,10) : null;
    OA.payload.carrier_id = Number.isFinite(id) ? id : null;
    // Ha van rá fizetési határidő snapshot, mutassuk fel; a felhasználó felülírhatja.
    var c = OA.carriers.find(function(x){ return x.id === OA.payload.carrier_id; });
    if (c && c.payment_term_days != null) OA.payload.payment_term_days = c.payment_term_days;
  }
  function setPrice(v){ OA.payload.price = v==='' ? null : num(v); }
  function setCurrency(v){ OA.payload.currency = (v||'EUR').toUpperCase(); }
  function setPayTerm(v){ OA.payload.payment_term_days = v==='' ? null : parseInt(v,10); }
  function setTipCamion(v){ OA.payload.fields.vehicle.tip_camion = v || ''; }
  function toggleKind(k, on){
    var arr = OA.payload.fields.vehicle.truck_kinds;
    var i = arr.indexOf(k);
    if (on && i === -1) arr.push(k);
    if (!on && i !== -1) arr.splice(i,1);
  }
  function setFlag(k, on){ OA.payload.fields.vehicle.flags[k] = !!on; }
  function setAlte(v){ OA.payload.fields.vehicle.alte_specificatii = v || ''; }
  function setDriver(k, v){ OA.payload.fields.driver[k] = v || ''; }

  // ── Alapértelmezett sablon (a jelenlegi hardcoded szövegek — a
  // Beállítások → Comanda de Transport sablon szerkesztő ezekre esik
  // vissza, ha egy mezőt sem írt át az admin). Egy mező NULL-ja is
  // erre a szótárra esik vissza → mindig van olvasható PDF.
  var DEFAULT_TEMPLATE = {
    legalTerms: [
      '1. COMANDA DE TRANSPORT',
      '1.1. Tariful contine toate elementele pretului cuvenit carausului, completare carnet TIR si scrisoare CMR, cheltuieli accesorii, cheltuieli de vama, precum si orice alte cheltuieli survenite de la incheierea contractului si pana la eliberare.',
      '1.2. Clauzele contractului de transport nu se negocieaza, comanda se va confirma in scris de transportator in termen de doua ore de la primire, fara rezerve sau obiectiuni.',
      '1.3. In cazul formularii unui accept diferit, comanda se considera acceptata in forma initiala originala, fara modificari.',
      '1.4. Este strict interzis lasarea camionului si al marfii fara paza si supraveghere. Este interzisa transbordarea marfii fara acord scris.',
      '1.5. Comenzile confirmate de transportator pot fi denuntate/retrase de Beneficiar fara consecinte juridice cel putin cu 4 ore inainte de incarcare.',
      '1.6. Denuntarea de catre Transportator al comenzii dupa confirmare atrage penalizare de 200 euro plus diferenta de cost.',
      '2. ACTE DE TRANSPORT',
      '2.1. Factura serviciului de transport in original, insotita de CMR original in 2 exemplare stampilat si confirmat de destinatar, se comunica in termen de cel mult 10 zile calendaristice de la data descarcarii.',
      '2.2. Plata pretului transportului se va efectua in termenul specificat pe comanda, calculata de la primirea in original al actelor doveditoare privind efectuarea transportului si a facturii.',
      '2.3. CMRul original semnat/stampilat la destinatar este actul care atesta efectuarea serviciului de transport si exportul marfii.',
      '2.4. In cazul in care pe CMR exista obiectiuni/mentiuni, Beneficiarul isi rezerva dreptul de a suspenda plata facturii pana la rezolvarea cazului.',
      '3. INCARCARE/DESCARCARE',
      '3.1. Transportatorul are obligatia de a prezenta la ora si locatia stabilita mijlocul de transport adecvat, in stare tehnica si igienica corespunzatoare.',
      '3.2. Transportatorul trebuie sa asigure dotarea camionului cu echipamentele necesare desfasurarii transportului.',
      '3.3. Ora de incarcare/descarcare este cel din comanda de transport sau fereastra de incarcare confirmata in scris.',
      '3.4. La primirea marfii transportatorul este obligat sa verifice: exactitatea mentiunilor din CMR, starea aparenta a marfii si a ambalajului.',
      '3.5. Transportatorul are obligatia sa asiste/participe atat la incarcare cat si la descarcare.',
      '3.6. Aranjarea si asigurarea marfii este sarcina Transportatorului.',
      '4. NEPREZENTARE, INTARZIERE, ABANDON',
      '4.1. Neprezentarea la incarcare se penalizeaza cu pana la 100% din pretul de transport conform comenzii de transport.',
      '4.2. Intarzierea transportatorului la operatiunile de incarcare/descarcare se penalizeaza cu 250 euro/fiecare 24 ore incepute.',
      '4.4. Este strict interzis parasirea locului de incarcare/descarcare fara acordul emitentului comenzii.',
      '5. TIMPUL LIBER DE INCARCARE/DESCARCARE',
      '5.1. Timpul liber pentru incarcare/descarcare/vamuire este de 24 ore libere, calculate de la data si ora stabilita in comanda.',
      '6. RASPUNDERE, ASIGURARE CMR',
      '6.1. Transportatorul trebuie sa aiba asigurare CMR in valoare de cel putin 200.000 euro.',
      '6.3. Transportatorul raspunde pentru pierderea totala sau partiala, pentru avarie si pentru intarzierea in eliberarea marfii.',
      '7. ALTE OBLIGATII',
      '7.2. Nu va putea contacta direct sau prin intermediari clientii emitentului comenzii, sub sanctiunea unei penalitati de 30.000 EUR pentru fiecare client.',
      '8. SALARIU SOFERI DETASATI TRANSNATIONALI',
      '8.1. Transportatorul garanteaza respectarea normativelor UE din Pachetul de Mobilitate 1 si a legilor privind salariul minim al soferilor detasati transnationali.',
      '9. DIVERSE',
      '9.1. Obligatiile Beneficiarului asumate nu sunt datorate cata vreme clientul acestuia nu achita contravaloarea transportului.',
      '9.10. Orice litigiu se va deferi spre solutionare instantelor judecatoresti competente din Sfantu Gheorghe, judetul Covasna, Romania.'
    ].join('\n'),
    footerNote: 'Contravaloarea facturii se va achita numai daca impreuna cu documentele de transport se trimite si comanda confirmata in original (toate paginile stampilate) si bon de palet daca este cazul.',
    importantNote: 'IMPORTANT! Confirmarea trebuie trimisa pe fax sau e-mail inainte de incarcare.',
    cuStima: 'Cu stima',
    beneficiarLbl: 'BENEFICIAR (Emitent comanda)',
    confirmareLbl: 'CONFIRMARE TRANSPORTATOR',
    semnaturaLbl: 'Semnatura si stampila',
    sectHead: { incarcare: 'INCARCARE', descarcare: 'DESCARCARE', detalii: 'DETALII TRANSPORT:' }
  };

  // Sablon-feloldás: mezőnkénti fallback a defaultra (üres sablon,
  // vagy csak részben átírt sablon esetén sem tűnik el semmi).
  function _resolveTemplate(){
    var co = (OA.data && OA.data.company) || {};
    var t = co.order_assignment_template || {};
    var d = DEFAULT_TEMPLATE;
    var sh = (t.sectHead && typeof t.sectHead === 'object') ? t.sectHead : {};
    return {
      legalTerms:    (t.legalTerms    && String(t.legalTerms).trim())    || d.legalTerms,
      footerNote:    (t.footerNote    && String(t.footerNote).trim())    || d.footerNote,
      importantNote: (t.importantNote && String(t.importantNote).trim()) || d.importantNote,
      cuStima:       (t.cuStima       && String(t.cuStima).trim())       || d.cuStima,
      beneficiarLbl: (t.beneficiarLbl && String(t.beneficiarLbl).trim()) || d.beneficiarLbl,
      confirmareLbl: (t.confirmareLbl && String(t.confirmareLbl).trim()) || d.confirmareLbl,
      semnaturaLbl:  (t.semnaturaLbl  && String(t.semnaturaLbl).trim())  || d.semnaturaLbl,
      sectHead: {
        incarcare:  (sh.incarcare  && String(sh.incarcare).trim())  || d.sectHead.incarcare,
        descarcare: (sh.descarcare && String(sh.descarcare).trim()) || d.sectHead.descarcare,
        detalii:    (sh.detalii    && String(sh.detalii).trim())    || d.sectHead.detalii
      }
    };
  }

  // Publikus a Beállítások szerkesztőnek (Reset gomb + placeholder).
  function getDefaultTemplate(){ return DEFAULT_TEMPLATE; }

  // ── PDF-generálás (pdf-lib, kliens-oldal) ────────────────
  // Layout: A4 (595.28 x 841.89 pt), 1 cm margó minden oldalon
  // (~28.35 pt). Az oldalak dinamikusan bővülnek — a szövegek
  // sorra tördelődnek (drawWrapped), a szakaszok automatikusan
  // új oldalra kerülnek, ha a maradék hely kevés (ensureSpace).
  // Semmi nem lóg túl: minden tábla-cella szintén tördelve.
  async function _generatePdfBytes(){
    if (typeof PDFLib === 'undefined') throw new Error('PDFLib not loaded');
    var pdfDoc = await PDFLib.PDFDocument.create();

    // Lapméret + 1 cm margó
    var PAGE_W = 595.28, PAGE_H = 841.89, M = 28.35;
    var CONTENT_W = PAGE_W - 2*M;
    var TOP_Y = PAGE_H - M;             // rajzolási y max
    var BOTTOM_Y = M + 22;              // láb (page-num) fölött 22 pt tartalék
    var pages = [];
    function addPage(){
      var p = pdfDoc.addPage([PAGE_W, PAGE_H]);
      pages.push(p);
      return p;
    }
    var page = addPage();
    var y = TOP_Y;
    // A pdf-lib beépített (WinAnsi) fontja NEM támogatja az árvíztűrő román
    // ékezeteket (ă/â/ș/ț/î) → ASCII-változatra fordítunk.
    var font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
    var bold = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    var oblique = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaOblique);

    function ascii(s){ return String(s||'')
      .replace(/[ăâáà]/g,'a').replace(/[ĂÂÁÀ]/g,'A')
      .replace(/[éèê]/g,'e').replace(/[ÉÈÊ]/g,'E')
      .replace(/[íì]/g,'i').replace(/[ÍÌ]/g,'I').replace(/[îÎ]/g,'i')
      .replace(/[óòô]/g,'o').replace(/[ÓÒÔ]/g,'O')
      .replace(/[úù]/g,'u').replace(/[ÚÙ]/g,'U')
      .replace(/[șş]/g,'s').replace(/[ȘŞ]/g,'S')
      .replace(/[țţ]/g,'t').replace(/[ȚŢ]/g,'T')
      .replace(/[őő]/g,'o').replace(/[ŐŐ]/g,'O')
      .replace(/[űű]/g,'u').replace(/[ŰŰ]/g,'U'); }

    // Új oldalra ugrás — a fő „y" flow-változó frissül.
    function ensureSpace(needed){
      if (y - needed < BOTTOM_Y) { page = addPage(); y = TOP_Y; }
    }
    function drawTextAt(pg, text, x, ty, size, useFont){
      pg.drawText(ascii(text), { x:x, y:ty, size:size, font: useFont||font, color: PDFLib.rgb(0,0,0) });
    }
    // Egyszerű ki-rajzolás a KÖVETKEZŐ sorra (flow y-ra) — auto oldal-törés.
    function drawLine(text, x, size, useFont){
      var f = useFont || font;
      var lh = size * 1.35;
      ensureSpace(lh);
      pg = page;
      pg.drawText(ascii(text), { x:x, y:y - size + 2, size:size, font:f, color: PDFLib.rgb(0,0,0) });
      y -= lh;
    }
    var pg = page; // aktuális oldal-mutató (a helperek frissítik)

    // Wrapped szöveg-blokk rajzolása X-től MAXW szélességgel, AUTO
    // oldal-töréssel — a hosszú bekezdés több oldalra is átfolyhat.
    function drawWrappedFlow(text, x, size, maxW, useFont){
      var f = useFont || font;
      var lh = size * 1.35;
      // Sorokra bontás \n mentén, majd szó-szintű tördelés.
      var paragraphs = ascii(text||'').split(/\n/);
      for (var pi=0; pi<paragraphs.length; pi++){
        var words = paragraphs[pi].split(/\s+/).filter(Boolean);
        var line = '';
        for (var i=0; i<words.length; i++){
          var trial = line ? (line + ' ' + words[i]) : words[i];
          var w = f.widthOfTextAtSize(trial, size);
          if (w > maxW && line){
            ensureSpace(lh);
            page.drawText(line, { x:x, y:y - size + 2, size:size, font:f, color:PDFLib.rgb(0,0,0) });
            y -= lh;
            line = words[i];
          } else {
            line = trial;
          }
        }
        if (line){
          ensureSpace(lh);
          page.drawText(line, { x:x, y:y - size + 2, size:size, font:f, color:PDFLib.rgb(0,0,0) });
          y -= lh;
        } else if (paragraphs[pi] === '') {
          // üres sor = kis térköz
          y -= lh * 0.5;
        }
      }
    }
    function drawRect(pgRef, x, ry, w, h, opts){
      pgRef.drawRectangle(Object.assign({ x:x, y:ry, width:w, height:h, borderColor:PDFLib.rgb(0.55,0.55,0.55), borderWidth:0.6 }, opts||{}));
    }
    // Wrapping helper — visszaadja a szöveg TÖRDELT sorait (tábla-cellához).
    function wrapLines(text, size, maxW, useFont){
      var f = useFont || font;
      var out = [];
      var paragraphs = ascii(text||'').split(/\n/);
      for (var pi=0; pi<paragraphs.length; pi++){
        var words = paragraphs[pi].split(/\s+/).filter(Boolean);
        var line = '';
        for (var i=0; i<words.length; i++){
          var trial = line ? (line + ' ' + words[i]) : words[i];
          if (f.widthOfTextAtSize(trial, size) > maxW && line){
            out.push(line); line = words[i];
          } else { line = trial; }
        }
        if (line) out.push(line);
        else if (paragraphs[pi] === '') out.push('');
      }
      return out;
    }

    var co = (OA.data && OA.data.company) || {};
    var o  = (OA.data && OA.data.order) || {};
    var p  = OA.payload;
    var c  = OA.carriers.find(function(x){ return x.id === p.carrier_id; }) || {};
    var comandaNr = (p.number_source === 'custom' && p.custom_number) ? p.custom_number : (o.fuvar_no || o.id || '');
    var TPL = _resolveTemplate();

    // ── FEJLÉC — minden oldal tetején (page-num a végén íródik).
    function drawHeader(){
      page.drawText(ascii('Comanda de Transport'), { x:M, y:PAGE_H - M - 12, size:13, font:bold, color:PDFLib.rgb(0,0,0) });
      page.drawText(ascii('Comanda Nr.:  ' + comandaNr), { x:M, y:PAGE_H - M - 28, size:11, font:bold, color:PDFLib.rgb(0,0,0) });
    }
    drawHeader();
    y = PAGE_H - M - 44;

    // Logó (jobb felső) — a margón belül.
    try {
      if (co.has_logo) {
        var lr = await fetch('/api/branding/logo', { credentials:'same-origin' }).then(function(r){ return r.json(); });
        if (lr && lr.dataUri) {
          var isPng = /^data:image\/png/.test(lr.dataUri);
          var bytesL = await fetch(lr.dataUri).then(function(x){ return x.arrayBuffer(); });
          var imgL = isPng ? await pdfDoc.embedPng(bytesL) : await pdfDoc.embedJpg(bytesL);
          var scale = 90 / Math.max(imgL.width, imgL.height);
          var lw = imgL.width * scale, lh = imgL.height * scale;
          page.drawImage(imgL, { x: PAGE_W - M - lw, y: PAGE_H - M - lh - 4, width: lw, height: lh });
        }
      }
    } catch(e){ console.warn('logo embed failed', e); }

    // ── KÉT KÁRTYA (alvállalkozó | mi cégünk) — a tartalmuk tördelten
    //    fér el a kártya belsejében; a magasság dinamikus a soroktól.
    var GAP = 12;
    var cardW = (CONTENT_W - GAP) / 2;
    var cardX1 = M, cardX2 = M + cardW + GAP;
    var cardTopY = y;
    var cardPad = 6;

    function cardLines(pairs){
      // pairs: [[label,value,bold?] ...]  → tördelve, sorok tömbje
      var out = [];
      pairs.forEach(function(pair){
        var label = pair[0], val = pair[1], isBold = !!pair[2];
        var full = label ? (label + ': ' + (val||'')) : (val||'');
        var f = isBold ? bold : font;
        var lines = wrapLines(full, 8.2, cardW - cardPad*2, f);
        if (!lines.length) lines = [''];
        lines.forEach(function(ln, i){ out.push({ text: ln, font: (i===0 && isBold) ? bold : font }); });
      });
      return out;
    }
    var leftPairs = [
      ['Numele firma', c.nev || '', true],
      ['Adresa', c.adresa || ''],
      ['Cod fiscal', c.cui || ''],
      ['Nr.Inm. O.R.C.', c.reg_com || ''],
      ['Telefon', c.telefon || ''],
      ['Email', c.email || '']
    ];
    var rightPairs = [
      ['', co.nev || '', true],
      ['Judet/Localitate', (co.adresa ? (co.adresa.split(',')[0]||'') : '')],
      ['Adresa', co.adresa || ''],
      ['Cod fiscal', co.cui || ''],
      ['Nr.Inm. O.R.C.', co.reg_com || ''],
      ['Telefon', co.telefon || ''],
      ['Email', co.email_contact || '']
    ];
    var leftLines = cardLines(leftPairs);
    var rightLines = cardLines(rightPairs);
    var maxRows = Math.max(leftLines.length, rightLines.length);
    var rowH = 11;
    var cardH = cardPad*2 + maxRows * rowH;
    // Rajzold a kereteket
    drawRect(page, cardX1, cardTopY - cardH, cardW, cardH);
    drawRect(page, cardX2, cardTopY - cardH, cardW, cardH);
    // Rajzold a sorokat
    function drawCard(lines, x0){
      var cy = cardTopY - cardPad - 8;
      lines.forEach(function(ln){
        page.drawText(ascii(ln.text), { x:x0 + cardPad, y:cy, size:8.2, font:ln.font, color:PDFLib.rgb(0,0,0) });
        cy -= rowH;
      });
    }
    drawCard(leftLines, cardX1);
    drawCard(rightLines, cardX2);
    y = cardTopY - cardH - 14;

    // ── INCARCARE tábla ─────────────────────────────────────
    // Oszlopok arányosan a CONTENT_W-hez (a régi 515 → CONTENT_W).
    // Adresa (kb 42%), Data (12%), Interval (10%), Paleti (7%), Tip (8%),
    // Kg (8%), M.Podea (13%)  → összeg ~100%.
    var COL_RATIOS = [0.42, 0.12, 0.10, 0.07, 0.08, 0.08, 0.13];
    var COL_HEADS = ['Adresa','Data','Interval','Paleti','Tip','Kg','M.Podea'];
    var COL_KEYS  = ['_loc','_data','interval','paleti','tip_palet','kg','metri'];
    var CELL_PAD = 3;

    function drawTableHead(headerText){
      ensureSpace(30);
      page.drawText(ascii(headerText), { x:M, y:y - 10, size:11, font:bold, color:PDFLib.rgb(0,0,0) });
      y -= 16;
      // Fejléc sáv
      ensureSpace(14);
      drawRect(page, M, y - 12, CONTENT_W, 12, { color: PDFLib.rgb(0.93,0.93,0.93) });
      var cx = M;
      for (var i=0; i<COL_HEADS.length; i++){
        var cw = CONTENT_W * COL_RATIOS[i];
        page.drawText(ascii(COL_HEADS[i]), { x:cx + CELL_PAD, y:y - 9, size:7.5, font:bold, color:PDFLib.rgb(0,0,0) });
        cx += cw;
      }
      y -= 14;
    }

    function drawTableRow(row, idx){
      // Cellák tördelése + a sor magassága a legmagasabb cellához igazodik.
      var cellLinesArr = [];
      var cx = M;
      for (var i=0; i<COL_KEYS.length; i++){
        var cw = CONTENT_W * COL_RATIOS[i];
        var raw = (i===0 ? (String(idx+1)+'. ') : '') + (row[COL_KEYS[i]] || '');
        var lines = wrapLines(raw, 7.5, cw - CELL_PAD*2, font);
        if (!lines.length) lines = [''];
        cellLinesArr.push({ x:cx, w:cw, lines:lines });
        cx += cw;
      }
      var maxL = 1;
      cellLinesArr.forEach(function(cc){ if (cc.lines.length > maxL) maxL = cc.lines.length; });
      var rH = Math.max(14, maxL * 10 + 4);
      // Extra sorok (referinta / instructiuni) becslés
      var extraH = 0;
      if (row.referinta) extraH += 10;
      if (row.instructiuni) extraH += 10;
      ensureSpace(rH + extraH + 2);
      drawRect(page, M, y - rH, CONTENT_W, rH);
      cellLinesArr.forEach(function(cc){
        var ly = y - 9;
        cc.lines.forEach(function(ln){
          page.drawText(ascii(ln), { x:cc.x + CELL_PAD, y:ly, size:7.5, font:font, color:PDFLib.rgb(0,0,0) });
          ly -= 10;
        });
      });
      y -= rH;
      if (row.referinta){
        drawWrappedFlow('Referinta: ' + row.referinta, M + 4, 7, CONTENT_W - 8, oblique);
      }
      if (row.instructiuni){
        drawWrappedFlow('Instr.: ' + row.instructiuni, M + 4, 7, CONTENT_W - 8, oblique);
      }
      y -= 2;
    }

    drawTableHead(TPL.sectHead.incarcare);
    (p.fields.stops.pickups || []).forEach(drawTableRow);

    y -= 8;
    drawTableHead(TPL.sectHead.descarcare);
    (p.fields.stops.deliveries || []).forEach(drawTableRow);

    // ── DETALII TRANSPORT ───────────────────────────────────
    y -= 10;
    ensureSpace(24);
    page.drawText(ascii(TPL.sectHead.detalii), { x:M, y:y - 10, size:11, font:bold, color:PDFLib.rgb(0,0,0) });
    y -= 16;
    var kinds = (p.fields.vehicle.truck_kinds || []).map(function(k){ return k.charAt(0).toUpperCase()+k.slice(1); }).join(' / ');
    drawWrappedFlow('Nr. Camion: '+(o.rendszam_camion_extern || o.rendszam_camion || '……..'), M, 9, CONTENT_W);
    drawWrappedFlow('TIP Camion: '+(p.fields.vehicle.tip_camion||'')+(kinds?' · '+kinds:''), M, 9, CONTENT_W);
    drawWrappedFlow('Regim transport: '+(o.load_type||'FTL'), M, 9, CONTENT_W);

    // Flag-ek 3 oszlopban, a margóhoz igazítva.
    var F = p.fields.vehicle.flags;
    var flagPairs = [
      ['2 soferi', F.doi_soferi], ['Podea goala', F.podea_goala], ['Chingi', F.chingi],
      ['Presuri antiderapante', F.presuri], ['Coltare', F.coltare], ['Paleti schimb', F.paleti_schimb],
      ['Termodiagrama printabila', F.termodiagrama], ['Cablu vamal', F.cablu_vamal], ['ADR', F.adr]
    ];
    var flagColW = CONTENT_W / 3;
    var flagRows = Math.ceil(flagPairs.length / 3);
    ensureSpace(flagRows * 12 + 4);
    for (var fi=0; fi<flagPairs.length; fi++){
      var col = fi % 3;
      var rowI = Math.floor(fi/3);
      var fx = M + col * flagColW;
      var fy = y - 8 - rowI * 12;
      // Cellán belül tördelt címke — hogy a hosszú „Termodiagrama printabila" ne csússzon.
      var flagText = flagPairs[fi][0] + ': ' + (flagPairs[fi][1]?'DA':'NU');
      var lines2 = wrapLines(flagText, 8, flagColW - 4, font);
      page.drawText(ascii(lines2[0] || flagText), { x:fx, y:fy, size:8, font:font, color:PDFLib.rgb(0,0,0) });
    }
    y -= flagRows * 12 + 4;

    if (p.fields.vehicle.alte_specificatii){
      ensureSpace(14);
      page.drawText(ascii('Alte specificatii:'), { x:M, y:y - 8, size:9, font:bold, color:PDFLib.rgb(0,0,0) });
      y -= 12;
      drawWrappedFlow(p.fields.vehicle.alte_specificatii, M, 8, CONTENT_W);
    }
    y -= 4;
    drawWrappedFlow('Nume sofer: '+(p.fields.driver.name||'')+'    |    Telefon sofer: '+(p.fields.driver.phone||''), M, 9, CONTENT_W);

    // ── JOGI SZÖVEG (sablon-alapú, auto-tördelés + oldal-törés)
    // Új oldalra ugrunk a legal szöveg elé, hogy vizuálisan elkülönüljön.
    page = addPage(); y = TOP_Y; drawHeader(); y = PAGE_H - M - 44;
    var legalParagraphs = String(TPL.legalTerms || '').split(/\n/);
    legalParagraphs.forEach(function(par){
      if (!par.trim()) { y -= 6; return; }
      // Cím-sor felismerés: „N.", „N.N." kezdet ÉS rövid → bold.
      var isTitle = /^\d+\.\s+[A-ZĂÂÎȘȚ]/.test(par) && par.length < 60;
      var f = isTitle ? bold : font;
      drawWrappedFlow(par, M, 8, CONTENT_W, f);
      y -= 3;
    });

    // ── TARIF + TERMEN DE PLATA ─────────────────────────────
    y -= 8;
    ensureSpace(30);
    drawWrappedFlow('Tarif convenit: '+(p.price!=null? p.price : '——')+' '+(p.currency||'EUR')+', pretul nu include tva.', M, 10, CONTENT_W, bold);
    y -= 4;
    drawWrappedFlow('Termen de plata: '+(p.payment_term_days!=null?p.payment_term_days:30)+' zile calendaristice de la data primirii documentelor de transport in original.', M, 10, CONTENT_W);

    // ── ZÁRÓ ALÁÍRÓ BLOKK — új oldalon.
    // KÉT egyenlő oszlop:
    //   BAL  = BENEFICIAR (mi, Vallor) — cégadat + „Cu stima" + a MI pecsétünk
    //   JOBB = TRANSPORTATOR (az alvállalkozó) — cégadata + ÜRES aláíró hely
    // (A régi verzió hibás volt: „CONFIRMARE TRANSPORTATOR" cím alá a
    //  MI cégadatunk került, és a carrier-nek nem maradt hely aláírni.)
    page = addPage(); y = TOP_Y; drawHeader(); y = PAGE_H - M - 44;
    drawWrappedFlow(TPL.footerNote, M, 9, CONTENT_W);
    y -= 16;

    var half = CONTENT_W / 2;
    var colGap = 12;
    var colW = (CONTENT_W - colGap) / 2;
    var leftX = M;
    var rightX = M + colW + colGap;

    // Két oszlop-fejléc egy sorban (BENEFICIAR | CONFIRMARE TRANSPORTATOR).
    ensureSpace(28);
    var benLines = wrapLines(TPL.beneficiarLbl, 10, colW, bold);
    var confLines = wrapLines(TPL.confirmareLbl, 10, colW, bold);
    var headRows = Math.max(benLines.length, confLines.length);
    benLines.forEach(function(ln, i){ page.drawText(ascii(ln), { x:leftX,  y:y - 10 - i*12, size:10, font:bold, color:PDFLib.rgb(0,0,0) }); });
    confLines.forEach(function(ln, i){ page.drawText(ascii(ln), { x:rightX, y:y - 10 - i*12, size:10, font:bold, color:PDFLib.rgb(0,0,0) }); });
    y -= 10 + headRows*12 + 6;

    // Alá vékony aláhúzás mindkét oszlop alá (vizuális elkülönítés)
    page.drawLine({ start:{x:leftX, y:y}, end:{x:leftX+colW, y:y}, thickness:0.6, color:PDFLib.rgb(0.55,0.55,0.55) });
    page.drawLine({ start:{x:rightX, y:y}, end:{x:rightX+colW, y:y}, thickness:0.6, color:PDFLib.rgb(0.55,0.55,0.55) });
    y -= 6;

    // Két oszlopnyi cégadat — közös helper (nem folyik át a másik oszlopba).
    function drawColLines(text, x, size, isBold){
      var f = isBold ? bold : font;
      var lines = wrapLines(text || '', size, colW - 2, f);
      return lines.map(function(ln){ return { text: ln, font: f, size: size }; });
    }
    // BAL — BENEFICIAR (mi)
    var leftBlocks = []
      .concat(drawColLines(co.nev || '', 10, true))
      .concat(drawColLines('Ügyvezető: ' + (co.igazgato_nev || '—'), 9, false))
      .concat(drawColLines('Adresa: ' + (co.adresa || '—'), 9, false))
      .concat(drawColLines('CUI: ' + (co.cui || '—') + (co.reg_com ? '  ·  Reg.Com.: ' + co.reg_com : ''), 9, false))
      .concat(drawColLines('Tel: ' + (co.telefon || '—'), 9, false))
      .concat(drawColLines('Email: ' + (co.email_contact || '—'), 9, false));
    // JOBB — TRANSPORTATOR (az alvállalkozó)
    var rightBlocks = []
      .concat(drawColLines(c.nev || '—', 10, true))
      .concat(drawColLines('Adresa: ' + (c.adresa || '—'), 9, false))
      .concat(drawColLines('CUI: ' + (c.cui || '—') + (c.reg_com ? '  ·  Reg.Com.: ' + c.reg_com : ''), 9, false))
      .concat(drawColLines('Tel: ' + (c.telefon || '—'), 9, false))
      .concat(drawColLines('Email: ' + (c.email || '—'), 9, false));

    // Rajzoljuk a két oszlopot egymás mellé.
    var maxRows = Math.max(leftBlocks.length, rightBlocks.length);
    ensureSpace(maxRows * 12 + 10);
    var blockStartY = y;
    for (var bi = 0; bi < maxRows; bi++){
      if (leftBlocks[bi])  page.drawText(ascii(leftBlocks[bi].text),  { x:leftX,  y:blockStartY - 10 - bi*12, size:leftBlocks[bi].size,  font:leftBlocks[bi].font,  color:PDFLib.rgb(0,0,0) });
      if (rightBlocks[bi]) page.drawText(ascii(rightBlocks[bi].text), { x:rightX, y:blockStartY - 10 - bi*12, size:rightBlocks[bi].size, font:rightBlocks[bi].font, color:PDFLib.rgb(0,0,0) });
    }
    y = blockStartY - 10 - maxRows*12 - 6;

    // „Cu stima" — a bal oszlopban (a beneficiar-tól jön).
    ensureSpace(20);
    var cuLines = wrapLines(TPL.cuStima, 11, colW, oblique);
    cuLines.forEach(function(ln, i){ page.drawText(ascii(ln), { x:leftX, y:y - 10 - i*14, size:11, font:oblique, color:PDFLib.rgb(0,0,0) }); });
    y -= 10 + cuLines.length*14 + 6;

    // „Semnatura si stampila" mindkét oszlop alján.
    ensureSpace(18);
    var semnLines = wrapLines(TPL.semnaturaLbl, 9, colW, bold);
    var semnRows = semnLines.length;
    semnLines.forEach(function(ln, i){
      page.drawText(ascii(ln), { x:leftX,  y:y - 10 - i*11, size:9, font:bold, color:PDFLib.rgb(0,0,0) });
      page.drawText(ascii(ln), { x:rightX, y:y - 10 - i*11, size:9, font:bold, color:PDFLib.rgb(0,0,0) });
    });
    y -= 10 + semnRows*11 + 4;

    // A BAL oszlopba a MI pecsétünk (ha van). A JOBB oszlop ÜRESEN
    // marad — oda kerül majd az alvállalkozó aláírása/pecsétje.
    var stampBottomLeftY = y;    // hova ér le a bal pecsét alja
    var STAMP_BOX_H = 110;       // reservált hely mindkét oszlop alá
    ensureSpace(STAMP_BOX_H + 8);
    try {
      if (co.has_stamp) {
        var s = await fetch('/api/branding/stamp', { credentials:'same-origin' }).then(function(r){ return r.json(); });
        if (s && s.dataUri) {
          var isPng2 = /^data:image\/png/.test(s.dataUri);
          var sb = await fetch(s.dataUri).then(function(x){ return x.arrayBuffer(); });
          var simg = isPng2 ? await pdfDoc.embedPng(sb) : await pdfDoc.embedJpg(sb);
          var scale2 = 100 / Math.max(simg.width, simg.height);
          var sw = simg.width * scale2, sh = simg.height * scale2;
          var sx = leftX + (colW - sw) / 2;
          var sy = y - sh - 6;
          page.drawImage(simg, { x: sx, y: sy, width: sw, height: sh, opacity: 0.9 });
          stampBottomLeftY = sy;
        }
      }
    } catch(e){ console.warn('stamp embed failed', e); }

    // A JOBB oszlopba egy „aláíró terület" keret — legyen látható helye
    // a carrier-nek az aláírásra/pecsétjükre.
    var boxTop = y - 4;
    var boxH = STAMP_BOX_H;
    var boxBottom = boxTop - boxH;
    page.drawRectangle({
      x: rightX, y: boxBottom, width: colW, height: boxH,
      borderColor: PDFLib.rgb(0.75,0.75,0.75), borderWidth: 0.6,
      borderDashArray: [3, 3]
    });
    // Halvány jelzés a keret alján, hogy hova kell aláírni.
    page.drawText(ascii('(spatiu pentru semnatura si stampila transportatorului)'),
      { x: rightX + 6, y: boxBottom + 6, size:7, font:oblique, color:PDFLib.rgb(0.55,0.55,0.55) });

    // A y-t levisszük annyira, hogy az IMPORTANT-jegyzet a keret ALÁ kerüljön.
    y = Math.min(stampBottomLeftY, boxBottom) - 14;

    ensureSpace(30);
    drawWrappedFlow(TPL.importantNote, M, 10, CONTENT_W, oblique);

    // ── LÁB — page-num minden oldalra ("Pagina: N/M")
    var total = pages.length;
    for (var pn=0; pn<pages.length; pn++){
      var footer = 'Pagina: ' + (pn+1) + '/' + total;
      var fw = font.widthOfTextAtSize(ascii(footer), 9);
      pages[pn].drawText(ascii(footer), { x: PAGE_W - M - fw, y: M / 2, size:9, font:font, color:PDFLib.rgb(0.3,0.3,0.3) });
    }

    var bytes = await pdfDoc.save();
    return bytes;
  }

  function _bytesToBase64(bytes){
    var binary = ''; var chunk = 8192;
    for (var i=0; i<bytes.length; i+=chunk){ binary += String.fromCharCode.apply(null, bytes.subarray(i, i+chunk)); }
    return btoa(binary);
  }

  async function _generatePdfPreview(){
    var iframe = document.getElementById('oaPdfPreview'); if (!iframe) return;
    try {
      var bytes = await _generatePdfBytes();
      OA._lastPdfBytes = bytes;
      var blob = new Blob([bytes], { type: 'application/pdf' });
      if (OA._renderedPdfBlobUrl) try { URL.revokeObjectURL(OA._renderedPdfBlobUrl); } catch(e){}
      OA._renderedPdfBlobUrl = URL.createObjectURL(blob);
      iframe.src = OA._renderedPdfBlobUrl;
    } catch(err) {
      console.error('PDF preview error:', err);
      toast(t('oa.errPdf', 'Nu s-a putut genera PDF.'), 'err');
    }
  }

  // ── Akciók ───────────────────────────────────────────────
  async function _saveWithPdf(){
    if (!OA._lastPdfBytes) await _generatePdfPreview();
    var b64 = OA._lastPdfBytes ? _bytesToBase64(OA._lastPdfBytes) : null;
    var body = Object.assign({}, OA.payload, { order_id: OA.orderId, rendered_pdf_base64: b64 });
    var r = await gas('orderAssignmentSave', [body]);
    return r;
  }

  async function saveOnly(){
    var r = await _saveWithPdf();
    if (r && r.ok) toast(t('oa.saved','Comanda salvata.'), 'ok');
    else toast((r && r.err) || t('oa.errSave','Eroare la salvare'), 'err');
  }
  async function saveAndDownload(){
    var r = await _saveWithPdf();
    if (r && r.ok) {
      var b64 = OA._lastPdfBytes ? _bytesToBase64(OA._lastPdfBytes) : null;
      if (b64){
        var a = document.createElement('a');
        a.href = 'data:application/pdf;base64,'+b64;
        a.download = 'Comanda-'+OA.orderId+'.pdf';
        a.click();
      }
      toast(t('oa.saved','Comanda salvata.'), 'ok');
    } else {
      toast((r && r.err) || t('oa.errSave','Eroare la salvare'), 'err');
    }
  }
  async function attachToOrder(){
    var r = await _saveWithPdf();
    if (!r || !r.ok) { toast((r && r.err) || t('oa.errSave','Eroare la salvare'), 'err'); return; }
    var b64 = _bytesToBase64(OA._lastPdfBytes);
    var rr = await gas('orderAssignmentAttachToDocs', [{ order_id: OA.orderId, base64: b64, file_name: 'Comanda-'+OA.orderId+'.pdf' }]);
    if (rr && rr.ok) toast(t('oa.attached','Atasat la documentele cursei.'), 'ok');
    else toast((rr && rr.err) || t('oa.errSave','Eroare'), 'err');
  }
  async function emailToCarrier(){
    // Egyszerű: a fuvar meglévő „openOrderEmail" dialógusát nyitjuk, ha van.
    // (Az attach előtte fusson, hogy legyen mit csatolni.)
    await attachToOrder();
    if (window.openOrderEmail) {
      close();
      try { window.openOrderEmail(OA.orderId); } catch(e){ toast(String(e), 'err'); }
    } else {
      toast(t('oa.emailManual','Documentul este in documentele cursei, il poti trimite din meniul cursei.'), 'ok');
    }
  }
  async function deleteAssign(){
    if (!confirm(t('oa.confirmDelete', 'Sigur stergi comanda de transport pentru aceasta cursa?'))) return;
    var r = await gas('orderAssignmentDelete', [OA.orderId]);
    if (r && r.ok) { toast(t('oa.deleted','Sters.'), 'ok'); close(); }
    else toast((r && r.err) || t('oa.errSave','Eroare'), 'err');
  }
  async function finish(){ return saveAndDownload(); }

  // ── Publikus API ─────────────────────────────────────────
  window.OrderAssignment = {
    open: open, close: close,
    goStep: goStep, prev: prev, next: next,
    setNrSource: setNrSource, setCustomNr: setCustomNr, setCarrier: setCarrier,
    setPrice: setPrice, setCurrency: setCurrency, setPayTerm: setPayTerm,
    setTipCamion: setTipCamion, toggleKind: toggleKind, setFlag: setFlag, setAlte: setAlte,
    setDriver: setDriver,
    saveOnly: saveOnly, saveAndDownload: saveAndDownload, attachToOrder: attachToOrder,
    emailToCarrier: emailToCarrier, deleteAssign: deleteAssign, finish: finish,
    // A Beállítások szerkesztőnek: a jelenlegi (hardcoded) alapértelmezett
    // sablon-értékek, hogy a „Reset alapértelmezettre" gomb és a placeholderek
    // szinkronban legyenek a PDF-generátorral (EGY forrás — nincs másolgatás).
    getDefaultTemplate: getDefaultTemplate
  };
})();
