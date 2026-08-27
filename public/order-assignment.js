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

  // ── PDF-generálás (pdf-lib, kliens-oldal) ────────────────
  // Új (2026-08-27): FLOW-layout — a rögzített szövegek/szekciók egymás
  // UTÁN következnek, semmi nem lóg le, semmit nem takar el. A user-beírt
  // értékek (címek, ár, jogi pontok szövege) a saját sorukban maradnak;
  // csak a FIX-pozíciós rajzolást cseréljük futó Y-cursor + automatikus
  // új-oldal-mechanikára. A záró aláíró blokk: BAL = megrendelő (a mi
  // cégünk, aláírás + pecsét), JOBB = szállító (alvállalkozó, aláírás +
  // pecsét helye — üresen a partnernek).
  async function _generatePdfBytes(){
    if (typeof PDFLib === 'undefined') throw new Error('PDFLib not loaded');
    var pdfDoc = await PDFLib.PDFDocument.create();
    // A pdf-lib beépített (WinAnsi) fontja NEM támogatja az árvíztűrő román
    // ékezeteket (ă/â/ș/ț/ș/î) → StandardFonts.Helvetica-val a WinAnsiEncoding
    // hibát dob. Egyszerűsítés: minden szöveget WinAnsi-kompatibilis
    // változatra alakítunk (ékezetek helyettesítve). Nyomtatáskor egy
    // közepesen olvasható RO szöveget adunk; a jövőben egy TTF (Roboto)
    // beágyazása oldja meg a teljes UTF-8-at.
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

    function drawText(page, text, x, y, size, useFont){
      page.drawText(ascii(text), { x: x, y: y, size: size, font: useFont || font, color: PDFLib.rgb(0,0,0) });
    }
    function drawWrapped(page, text, x, y, size, maxW, useFont){
      var f = useFont || font;
      var words = ascii(text).split(/\s+/);
      var line = '';
      var yy = y;
      for (var i=0; i<words.length; i++){
        var trial = line ? (line + ' ' + words[i]) : words[i];
        var w = f.widthOfTextAtSize(trial, size);
        if (w > maxW && line){
          page.drawText(line, { x:x, y:yy, size:size, font:f, color:PDFLib.rgb(0,0,0) });
          yy -= size * 1.25; line = words[i];
        } else {
          line = trial;
        }
      }
      if (line){ page.drawText(line, { x:x, y:yy, size:size, font:f, color:PDFLib.rgb(0,0,0) }); yy -= size * 1.25; }
      return yy;
    }
    function drawRect(page, x, y, w, h, opts){
      page.drawRectangle(Object.assign({ x:x, y:y, width:w, height:h, borderColor:PDFLib.rgb(0.55,0.55,0.55), borderWidth:0.6 }, opts||{}));
    }

    var co = (OA.data && OA.data.company) || {};
    var o  = (OA.data && OA.data.order) || {};
    var p  = OA.payload;
    var c  = OA.carriers.find(function(x){ return x.id === p.carrier_id; }) || {};
    var comandaNr = (p.number_source === 'custom' && p.custom_number) ? p.custom_number : (o.fuvar_no || o.id || '');

    // ── FLOW-layout: futó Y-cursor + auto-új-oldal ───────────
    var PAGE_W = 595.28, PAGE_H = 841.89;
    var LEFT = 40, RIGHT = 555, WIDTH = RIGHT - LEFT;
    var TOP = 810, BOT = 60;         // hasznos terület
    var HEADER_H = 42;               // fejléc-magasság minden oldalon
    var pages = [], curPage = null, y = 0, pageNum = 0;

    // Logó base64 (egyszer betöltve) — a fejlécbe minden oldalra
    var logoEmbed = null;
    try {
      if (co.has_logo) {
        var rl = await fetch('/api/branding/logo', { credentials:'same-origin' }).then(function(r){ return r.json(); });
        if (rl && rl.dataUri) {
          var isPngL = /^data:image\/png/.test(rl.dataUri);
          var lbytes = await fetch(rl.dataUri).then(function(x){ return x.arrayBuffer(); });
          logoEmbed = isPngL ? await pdfDoc.embedPng(lbytes) : await pdfDoc.embedJpg(lbytes);
        }
      }
    } catch(e){ console.warn('logo embed failed', e); }

    // Pecsét base64 (a záró blokkban ELŐSZÖR a MI cégünk oldalára rakjuk)
    var stampEmbed = null;
    try {
      if (co.has_stamp) {
        var rs = await fetch('/api/branding/stamp', { credentials:'same-origin' }).then(function(r){ return r.json(); });
        if (rs && rs.dataUri) {
          var isPngS = /^data:image\/png/.test(rs.dataUri);
          var sbytes = await fetch(rs.dataUri).then(function(x){ return x.arrayBuffer(); });
          stampEmbed = isPngS ? await pdfDoc.embedPng(sbytes) : await pdfDoc.embedJpg(sbytes);
        }
      }
    } catch(e){ console.warn('stamp embed failed', e); }

    function drawHeader(page){
      // Fejléc-cím + Comanda Nr. — bal oldal; logó jobbra
      drawText(page, 'Comanda de Transport', LEFT, PAGE_H - 32, 14, bold);
      drawText(page, 'Comanda Nr.:  ' + comandaNr, LEFT, PAGE_H - 50, 11, bold);
      if (logoEmbed) {
        var scale = 60 / Math.max(logoEmbed.width, logoEmbed.height);
        var lw = logoEmbed.width * scale, lh = logoEmbed.height * scale;
        page.drawImage(logoEmbed, { x: RIGHT - lw, y: PAGE_H - 20 - lh, width: lw, height: lh });
      }
      // vékony elválasztó a fejléc alatt
      page.drawLine({ start:{x:LEFT, y:PAGE_H - 60}, end:{x:RIGHT, y:PAGE_H - 60},
        thickness: 0.5, color: PDFLib.rgb(0.7,0.7,0.7) });
    }
    function drawFooter(page, num){
      drawText(page, 'Pagina: '+num, RIGHT - 45, 20, 8);
    }
    function newPage(){
      curPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
      pages.push(curPage);
      pageNum++;
      drawHeader(curPage);
      drawFooter(curPage, pageNum);
      y = PAGE_H - 60 - 14;   // fejléc alatt kezdés
    }
    function need(h){
      if (y - h < BOT) newPage();
    }
    function writeText(text, size, useFont, dx){
      var f = useFont || font;
      var lineH = size * 1.3;
      need(lineH);
      drawText(curPage, text, LEFT + (dx||0), y - size, size, f);
      y -= lineH;
    }
    function writeWrapped(text, size, useFont){
      var f = useFont || font;
      var lineH = size * 1.35;
      var words = ascii(text).split(/\s+/);
      var line = '';
      for (var i=0; i<words.length; i++){
        var trial = line ? (line + ' ' + words[i]) : words[i];
        var w = f.widthOfTextAtSize(trial, size);
        if (w > WIDTH && line){
          need(lineH);
          curPage.drawText(line, { x:LEFT, y:y - size, size:size, font:f, color:PDFLib.rgb(0,0,0) });
          y -= lineH;
          line = words[i];
        } else {
          line = trial;
        }
      }
      if (line){
        need(lineH);
        curPage.drawText(line, { x:LEFT, y:y - size, size:size, font:f, color:PDFLib.rgb(0,0,0) });
        y -= lineH;
      }
    }
    function writeSpace(h){ y -= h; if (y < BOT) newPage(); }

    // ══════════════════════════════════════════════════════
    //   OLDAL — kezd: fejléc + partnerek + INCARCARE + …
    // ══════════════════════════════════════════════════════
    newPage();

    // — Partner-kártyák (bal = alvállalkozó/szállító, jobb = a mi cégünk) —
    var cardH = 90;
    need(cardH + 6);
    var cardY = y - cardH;
    // BAL: szállító (alvállalkozó)
    drawRect(curPage, LEFT, cardY, 250, cardH);
    drawText(curPage, 'TRANSPORTATOR', LEFT + 6, cardY + cardH - 12, 8, bold);
    drawText(curPage, 'Nume firma: ' + (c.nev||''), LEFT + 6, cardY + cardH - 26, 9, bold);
    drawText(curPage, 'Adresa: ' + (c.adresa||''), LEFT + 6, cardY + cardH - 40, 8);
    drawText(curPage, 'CUI: ' + (c.cui||''), LEFT + 6, cardY + cardH - 52, 8);
    drawText(curPage, 'Nr.Inm. O.R.C.: ' + (c.reg_com||''), LEFT + 6, cardY + cardH - 64, 8);
    drawText(curPage, 'Telefon: ' + (c.telefon||''), LEFT + 6, cardY + cardH - 76, 8);
    drawText(curPage, 'Email: ' + (c.email||''), LEFT + 6, cardY + cardH - 88, 8);
    // JOBB: mi (megrendelő/beneficiar)
    drawRect(curPage, LEFT + 265, cardY, 250, cardH);
    drawText(curPage, 'BENEFICIAR', LEFT + 271, cardY + cardH - 12, 8, bold);
    drawText(curPage, co.nev || '', LEFT + 271, cardY + cardH - 26, 9, bold);
    drawText(curPage, 'Adresa: ' + (co.adresa||''), LEFT + 271, cardY + cardH - 40, 8);
    drawText(curPage, 'CUI: ' + (co.cui||''), LEFT + 271, cardY + cardH - 52, 8);
    drawText(curPage, 'Nr.Inm. O.R.C.: ' + (co.reg_com||''), LEFT + 271, cardY + cardH - 64, 8);
    drawText(curPage, 'Telefon: ' + (co.telefon||''), LEFT + 271, cardY + cardH - 76, 8);
    drawText(curPage, 'Email: ' + (co.email_contact||''), LEFT + 271, cardY + cardH - 88, 8);
    y = cardY - 8;

    // — INCARCARE tábla —
    function drawTableSection(title, rows){
      need(16);
      drawText(curPage, title, LEFT, y - 10, 11, bold);
      y -= 14;
      // Fejléc-sor
      need(16);
      drawRect(curPage, LEFT, y - 14, WIDTH, 14, { color: PDFLib.rgb(0.93,0.93,0.93) });
      var headers = [['Adresa',6],['Data',225],['Interval',275],['Paleti',330],['Tip',370],['Kg',405],['M.Podea',440]];
      headers.forEach(function(hh){ drawText(curPage, hh[0], LEFT + hh[1], y - 11, 8, bold); });
      y -= 14;
      (rows || []).forEach(function(row, idx){
        need(20);
        drawRect(curPage, LEFT, y - 18, WIDTH, 18);
        drawText(curPage, String(idx+1)+'. '+(row._loc||''), LEFT + 6,   y - 12, 8);
        drawText(curPage, row._data||'',       LEFT + 225, y - 12, 8);
        drawText(curPage, row.interval||'',    LEFT + 275, y - 12, 8);
        drawText(curPage, row.paleti||'',      LEFT + 330, y - 12, 8);
        drawText(curPage, row.tip_palet||'',   LEFT + 370, y - 12, 8);
        drawText(curPage, row.kg||'',          LEFT + 405, y - 12, 8);
        drawText(curPage, row.metri||'',       LEFT + 440, y - 12, 8);
        y -= 18;
        if (row.referinta){ need(11); drawText(curPage, 'Referinta: '+row.referinta, LEFT + 6, y - 8, 7, oblique); y -= 11; }
        if (row.instructiuni){ need(11); drawText(curPage, 'Instr.: '+row.instructiuni, LEFT + 6, y - 8, 7, oblique); y -= 11; }
      });
      y -= 8;
    }
    drawTableSection('INCARCARE', p.fields.stops.pickups);
    drawTableSection('DESCARCARE', p.fields.stops.deliveries);

    // — DETALII TRANSPORT (flow) —
    writeText('DETALII TRANSPORT:', 11, bold);
    var kinds = (p.fields.vehicle.truck_kinds || []).map(function(k){ return k.charAt(0).toUpperCase()+k.slice(1); }).join(' / ');
    writeText('Nr. Camion: '+(o.rendszam_camion_extern || o.rendszam_camion || '……..'), 9);
    writeText('TIP Camion: '+(p.fields.vehicle.tip_camion||'')+(kinds?' · '+kinds:''), 9);
    writeText('Regim transport: '+(o.load_type||'FTL'), 9);
    var F = p.fields.vehicle.flags;
    var flagPairs = [
      ['2 soferi', F.doi_soferi], ['Podea goala', F.podea_goala], ['Chingi', F.chingi],
      ['Presuri antiderapante', F.presuri], ['Coltare', F.coltare], ['Paleti schimb', F.paleti_schimb],
      ['Termodiagrama printabila', F.termodiagrama], ['Cablu vamal', F.cablu_vamal], ['ADR', F.adr]
    ];
    var flagLineH = 12;
    for (var fi = 0; fi < flagPairs.length; fi += 3) {
      need(flagLineH);
      var yLine = y - 9;
      for (var fj = 0; fj < 3 && (fi+fj) < flagPairs.length; fj++) {
        var pair = flagPairs[fi+fj];
        drawText(curPage, pair[0]+': '+(pair[1]?'DA':'NU'), LEFT + fj*180, yLine, 8);
      }
      y -= flagLineH;
    }
    if (p.fields.vehicle.alte_specificatii){
      writeText('Alte specificatii:', 9, bold);
      writeWrapped(p.fields.vehicle.alte_specificatii, 8);
    }
    writeSpace(4);
    // Sofőr név + telefon egy sorban
    need(12);
    drawText(curPage, 'Nume sofer: '+(p.fields.driver.name||''), LEFT, y - 9, 9);
    drawText(curPage, 'Telefon sofer: '+(p.fields.driver.phone||''), LEFT + 280, y - 9, 9);
    y -= 14;

    // ══════════════════════════════════════════════════════
    //   JOGI PONTOK — flow, természetes törések
    // ══════════════════════════════════════════════════════
    writeSpace(10);
    var LEGAL = [
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
    ];
    LEGAL.forEach(function(par){
      var isTitle = /^\d+\.\s/.test(par) || /^\d+\.$/.test(par);
      // Section-title (pl. „1. COMANDA DE TRANSPORT") = rövidebb (<60 char) és
      // nem tartalmaz ':.' végén (a leírás-mondatok). Egyszerű heurisztika.
      var looksTitle = isTitle && par.length < 60 && par.toUpperCase() === par.slice(0, 3) + par.slice(3);
      // Külön extra hely a fő-fejezetek előtt (1./2./…), NEM a 1.1/2.1 sorok előtt
      if (/^\d+\.\s+[A-Z]/.test(par) && par.length < 60) writeSpace(4);
      writeWrapped(par, 8, looksTitle ? bold : font);
      writeSpace(2);
    });

    // — Tarif + Termen —
    writeSpace(6);
    writeText('Tarif convenit: '+(p.price!=null? p.price : '——')+' '+(p.currency||'EUR')+', pretul nu include TVA.', 10, bold);
    writeText('Termen de plata: '+(p.payment_term_days!=null?p.payment_term_days:30)+' zile calendaristice de la data primirii documentelor de transport in original.', 9);

    // — Záró figyelmeztetés —
    writeSpace(6);
    writeWrapped('Contravaloarea facturii se va achita numai daca impreuna cu documentele de transport se trimite si comanda confirmata in original (toate paginile stampilate) si bon de palet daca este cazul.', 9);
    writeSpace(4);
    writeText('IMPORTANT! Confirmarea trebuie trimisa pe fax sau e-mail inainte de incarcare.', 9, oblique);

    // ══════════════════════════════════════════════════════
    //   ZÁRÓ ALÁÍRÓ BLOKK — BAL = megrendelő (mi, aláírás+pecsét),
    //   JOBB = szállító (alvállalkozó, üres aláírás/pecsét helye)
    // ══════════════════════════════════════════════════════
    var SIG_H = 190;                    // aláíró blokk teljes magasság
    need(SIG_H + 20);
    writeSpace(14);
    var sigTop = y;
    var half = (WIDTH - 20) / 2;
    var leftX = LEFT, rightX = LEFT + half + 20;

    // Fejléc-sor
    drawText(curPage, 'BENEFICIAR (semnatura si stampila)', leftX, sigTop - 10, 10, bold);
    drawText(curPage, 'TRANSPORTATOR (semnatura si stampila)', rightX, sigTop - 10, 10, bold);
    // Vékony elválasztók a két oszlop alá
    curPage.drawLine({ start:{x:leftX, y:sigTop - 16}, end:{x:leftX + half, y:sigTop - 16},
      thickness: 0.4, color: PDFLib.rgb(0.7,0.7,0.7) });
    curPage.drawLine({ start:{x:rightX, y:sigTop - 16}, end:{x:rightX + half, y:sigTop - 16},
      thickness: 0.4, color: PDFLib.rgb(0.7,0.7,0.7) });

    // BAL — a mi cégünk (megrendelő) adatai + pecsét
    drawText(curPage, co.igazgato_nev || '', leftX, sigTop - 30, 10, bold);
    drawText(curPage, 'Nr. Tel: ' + (co.telefon || ''), leftX, sigTop - 44, 9);
    drawText(curPage, 'Email: '   + (co.email_contact || ''), leftX, sigTop - 56, 9);
    drawText(curPage, 'Cu stima,', leftX, sigTop - 74, 11, oblique);
    // Pecsét (bal oldalra)
    if (stampEmbed) {
      var stScale = 100 / Math.max(stampEmbed.width, stampEmbed.height);
      var stW = stampEmbed.width * stScale, stH = stampEmbed.height * stScale;
      curPage.drawImage(stampEmbed, { x: leftX + 10, y: sigTop - 74 - stH - 10, width: stW, height: stH, opacity: 0.9 });
    }

    // JOBB — szállító üres blokk (aláírás + pecsét helye)
    drawText(curPage, c.nev || '', rightX, sigTop - 30, 10, bold);
    drawText(curPage, 'Reprezentant: ______________________________', rightX, sigTop - 54, 9);
    drawText(curPage, 'Data: _______________________________________', rightX, sigTop - 74, 9);
    // Üres pecsét-hely körvonal (a partner tölti ki)
    drawRect(curPage, rightX + 10, sigTop - 175, 110, 90, { borderColor: PDFLib.rgb(0.75,0.75,0.75), borderWidth: 0.5 });
    drawText(curPage, '(loc pentru stampila)', rightX + 22, sigTop - 130, 8, oblique);

    y = sigTop - SIG_H;

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
    emailToCarrier: emailToCarrier, deleteAssign: deleteAssign, finish: finish
  };
})();
