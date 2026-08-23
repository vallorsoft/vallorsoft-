// public/sofer-tour.js — Sofőr onboarding + demó bemutató
// ----------------------------------------------------------------------
//   Cél: az ELSŐ belépő sofőrt (aki még sosem használta) végigvezeti a
//   felület minden fontos elemén EGY DEMÓ fuvarral, amit tényleg
//   nyomogathat (állomás-gomb, határátlépés, menetlevél). Semmi nem
//   megy át a szerverre — a demó fuvar `_isDemo:true` jelzővel a
//   `_soferOrdersCache`-be van injektálva, a kritikus akciók (állomás,
//   határátlépés, menetlevél-küldés, dok-feltöltés, áru-leadás)
//   `SoferTour.demoIntercept()` guarddal esnek ki, és a tour előre-
//   lép egy „✅ Kész" toasttal.
//
//   Bármikor újranyitható a „🎓 Bemutatás" nav-kártyával — így a
//   sofőr magától tanulhat, nem kell külön képzés.
//
//   Perzisztencia: `localStorage['vs_sofer_tour_done:<email>'] = '1'`
//     — csak azt jelzi, HOGY egyszer már látta. Nem tiltja az újrafutást.
//
//   Publikus API:
//     SoferTour.start(force?)   — elindítja a bemutatót (force=true → mindig)
//     SoferTour.stop()          — megszakítja
//     SoferTour.isDone()        — látta-e már ez a sofőr
//     SoferTour.demoIntercept(orderIdOrKind, action) →
//         ha a demó aktív + a művelet a demó fuvarra vonatkozik: true
//         (a hívó ilyenkor NE menjen a szerverre, a tour advance-t hív)
// ----------------------------------------------------------------------
(function () {
  'use strict';

  var STORAGE_PREFIX = 'vs_sofer_tour_done:';
  var DEMO_ID        = 'CMD-DEMO-001';
  var DEMO_FUVAR_NO  = 'DEMO-2026-0001';

  // ── Fordított szöveg fallbackkel (a `t()` az i18n-motorból jön;
  //    ha valamiért nincs betöltve, a kulcs helyett a magyar szöveget adjuk).
  function T(key, def) {
    try {
      if (typeof window.t === 'function') {
        var v = window.t(key);
        if (v && v !== key) return v;
      }
    } catch(e){}
    return def;
  }

  // ── State ──
  var _state = {
    active: false,      // fut-e most a tour
    stepIdx: 0,         // hányadik lépésnél tartunk
    email: '',          // per-driver kulcshoz
    lang: 'ro',         // aktuális nyelv snapshot
    demoInjected: false // benne van-e a demó fuvar a cache-ben
  };

  // ── Demó fuvar ──
  //   A rendes fuvar-adatszerkezetet követi (getMySoferOrders válasza).
  //   A `_isDemo:true` az egyetlen extra kulcs; a rendes render kód
  //   érintetlenül renderel — a felül lévő badge-t a tour rakja rá.
  function _todayIso(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + (offsetDays || 0));
    return d.toISOString().slice(0, 10);
  }
  function _buildDemoTrip() {
    return {
      id: DEMO_ID,
      _isDemo: true,
      fuvar_no: DEMO_FUVAR_NO,
      status: 'Alocat',
      client: '',
      firma_incarcare: 'DEMO Feladó SRL',
      loc_incarcare:   'Cluj-Napoca, RO',
      data_incarcare:  _todayIso(0),
      firma_descarcare:'DEMO Címzett SRL',
      loc_descarcare:  'București, RO',
      data_descarcare: _todayIso(1),
      rendszam_camion: 'DEMO-01',
      rendszam_remorca:'DEMO-02',
      suly_kg: 22000,
      load_type: 'FTL',
      dash_visible: true,
      waybill_visible: false, // menetlevél-pickerbe SOSEM megy be
      ref: T('sof.tour.demoRef', '📚 DEMO — csak tanuláshoz. Nyomogasd nyugodtan, semmi nem kerül a szerverre.'),
      handover_status: null,
      stops: [
        { id: 'demoS1', stop_index: 0, kind: 'pickup',   loc: 'Cluj-Napoca', firma: 'DEMO Feladó SRL',   arrived_at: null, done_at: null, waybilled_at: null },
        { id: 'demoS2', stop_index: 1, kind: 'delivery', loc: 'București',   firma: 'DEMO Címzett SRL', arrived_at: null, done_at: null, waybilled_at: null }
      ]
    };
  }

  // Injektálja / kiveszi a demó fuvart a globális cache-ből + újrarender.
  function _injectDemo() {
    if (_state.demoInjected) return;
    if (!Array.isArray(window._soferOrdersCache)) window._soferOrdersCache = [];
    // Duplikáció-védelem: ha valamiért már ott van, ki előbb.
    window._soferOrdersCache = window._soferOrdersCache.filter(function(o){ return o && o.id !== DEMO_ID; });
    window._soferOrdersCache.unshift(_buildDemoTrip());
    _state.demoInjected = true;
    _rerenderDash();
  }
  function _removeDemo() {
    if (!_state.demoInjected) return;
    if (Array.isArray(window._soferOrdersCache)) {
      window._soferOrdersCache = window._soferOrdersCache.filter(function(o){ return o && o.id !== DEMO_ID; });
    }
    _state.demoInjected = false;
    _rerenderDash();
  }
  function _demoTripRef() {
    if (!Array.isArray(window._soferOrdersCache)) return null;
    for (var i = 0; i < window._soferOrdersCache.length; i++) {
      if (window._soferOrdersCache[i] && window._soferOrdersCache[i].id === DEMO_ID) return window._soferOrdersCache[i];
    }
    return null;
  }

  // A demó fuvar-kártya újrarajzolása a rendes render-úton keresztül.
  function _rerenderDash() {
    var el = document.getElementById('kiosztottList');
    if (!el || typeof window.renderFuvarCard !== 'function') return;
    var active = (window._soferOrdersCache || []).filter(function(o){
      if (typeof o.dash_visible === 'boolean') return o.dash_visible;
      return o.status === 'Alocat' || o.status === 'In Curs';
    });
    // Legrégebbi = #1 (mint a valós loadDashOrders)
    active = active.slice().reverse();
    if (!active.length) {
      el.innerHTML = '<div class="kiosztott-empty">' + T('sof.noActiveOrders', 'Nincs aktív fuvar.') + '</div>';
      return;
    }
    el.innerHTML = active.map(function(o, i){ return window.renderFuvarCard(o, i + 1); }).join('');
    // Adjunk egy vizuális DEMO-badge-et a demó kártyának, hogy a sofőr
    // sose tévessze össze valós fuvarral.
    var cards = el.querySelectorAll('.fuvar-card, .fuvar-header, div');
    for (var k = 0; k < cards.length; k++) {
      var c = cards[k];
      // A rendes render nem tesz `data-order-id`-t a wrapperre — az id-t
      // a kártyán belül a másoló map tartalmazza; egyszerűbb marker: a
      // rendszám „DEMO-01" szövegre keresünk.
      if (c.textContent && c.textContent.indexOf('DEMO-01') !== -1 && !c.querySelector('.st-demo-badge')) {
        var badge = document.createElement('div');
        badge.className = 'st-demo-badge';
        badge.textContent = T('sof.tour.demoBadge', '📚 DEMO — tanuláshoz');
        c.insertBefore(badge, c.firstChild);
        c.setAttribute('data-tour-demo', '1');
        break;
      }
    }
  }

  // ==================================================================
  // OVERLAY + TOOLTIP CSS (egyszer, mount-kor)
  // ==================================================================
  function _ensureStyle() {
    if (document.getElementById('sofer-tour-style')) return;
    var s = document.createElement('style');
    s.id = 'sofer-tour-style';
    s.textContent = ''
      // Teljes-képernyős, félig-átlátszó fátyol.
      + '.st-ov{position:fixed;inset:0;background:rgba(15,23,42,0.62);backdrop-filter:blur(3px);z-index:9990;'
      + '  transition:opacity .18s ease;opacity:0;pointer-events:auto;}'
      + '.st-ov.on{opacity:1;}'
      // Reflektor-ablak (spotlight) — abszolút pozicionált, kikeretezi a célt,
      // átengedi a koppintást a mögötte lévő valódi gombra.
      + '.st-spot{position:fixed;z-index:9991;border-radius:14px;pointer-events:none;'
      + '  box-shadow:0 0 0 4px #f59e0b, 0 0 0 9999px rgba(15,23,42,0.62);'
      + '  transition:top .22s ease, left .22s ease, width .22s ease, height .22s ease;}'
      + '.st-spot.pulse::after{content:"";position:absolute;inset:-6px;border-radius:18px;'
      + '  border:3px solid #fbbf24;animation:st-pulse 1.4s ease-in-out infinite;pointer-events:none;}'
      + '@keyframes st-pulse{0%,100%{opacity:.9;transform:scale(1);}50%{opacity:.35;transform:scale(1.08);}}'
      // Tooltip-kártya
      + '.st-tip{position:fixed;z-index:9992;max-width:min(360px,92vw);background:#fff;color:#0f172a;'
      + '  border-radius:16px;box-shadow:0 20px 50px rgba(15,23,42,0.35);padding:16px 18px;'
      + '  font-family:inherit;font-size:14px;line-height:1.5;transition:top .22s ease, left .22s ease;}'
      + '.st-tip .st-progress{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11px;'
      + '  color:#64748b;font-weight:700;letter-spacing:.4px;}'
      + '.st-tip .st-bar{flex:1;height:5px;background:#e2e8f0;border-radius:99px;overflow:hidden;}'
      + '.st-tip .st-bar>i{display:block;height:100%;background:linear-gradient(90deg,#3b82f6,#6366f1);'
      + '  transition:width .3s ease;}'
      + '.st-tip h4{margin:0 0 6px;font-size:16px;line-height:1.3;color:#0f172a;font-weight:800;}'
      + '.st-tip p{margin:0 0 12px;color:#334155;}'
      + '.st-tip .st-callout{font-size:12.5px;color:#0369a1;background:#f0f9ff;border-left:3px solid #38bdf8;'
      + '  padding:8px 10px;border-radius:6px;margin:6px 0 12px;}'
      + '.st-btns{display:flex;gap:8px;flex-wrap:wrap;}'
      + '.st-btn{flex:1;min-width:100px;padding:11px 14px;border-radius:10px;border:0;font-weight:700;'
      + '  font-size:14px;cursor:pointer;font-family:inherit;}'
      + '.st-btn.primary{background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;}'
      + '.st-btn.ghost{background:#f1f5f9;color:#475569;}'
      + '.st-btn.skip{background:transparent;color:#94a3b8;font-weight:600;font-size:12px;flex:0 0 auto;}'
      + '.st-tip .st-arrow{position:absolute;width:14px;height:14px;background:#fff;transform:rotate(45deg);}'
      // DEMO-badge a fuvar-kártyán (a valós rendertől megkülönbözteti)
      + '.st-demo-badge{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.4px;'
      + '  padding:3px 9px;border-radius:99px;background:linear-gradient(135deg,#f59e0b,#d97706);'
      + '  color:#1e293b;margin-bottom:6px;}'
      // 🎓 „Bemutatás" nav-kártya kiemelése
      + '.sofer-nav-card.tour{background:linear-gradient(135deg,#eff6ff,#e0e7ff);'
      + '  border:1.5px dashed #6366f1;}'
      + '.sofer-nav-card.tour .nav-icon{filter:none;}'
      // Welcome / kész modal (center-card, nincs anchor)
      + '.st-center{position:fixed;inset:0;z-index:9993;display:flex;align-items:center;justify-content:center;'
      + '  padding:20px;background:rgba(15,23,42,0.72);backdrop-filter:blur(6px);}'
      + '.st-center-card{background:#fff;color:#0f172a;border-radius:20px;padding:24px;max-width:420px;'
      + '  width:100%;box-shadow:0 30px 70px rgba(15,23,42,0.4);}'
      + '.st-center-card .st-ico{font-size:44px;text-align:center;margin-bottom:8px;}'
      + '.st-center-card h3{margin:0 0 8px;font-size:20px;text-align:center;font-weight:800;}'
      + '.st-center-card p{margin:0 0 16px;text-align:center;color:#475569;font-size:14px;line-height:1.5;}'
      ;
    document.head.appendChild(s);
  }

  // ==================================================================
  // OVERLAY / SPOTLIGHT / TOOLTIP
  // ==================================================================
  var _ov = null, _spot = null, _tip = null, _centerModal = null;

  function _mount() {
    _ensureStyle();
    if (!_ov) {
      _ov = document.createElement('div');
      _ov.className = 'st-ov';
      _ov.addEventListener('click', function(e){
        // Az overlayre koppintás NEM lép tovább (véletlen érintés) — de
        // a spotlight-lyuk átengedi a klikket a valódi gombra.
        e.stopPropagation();
      });
      document.body.appendChild(_ov);
    }
    if (!_spot) {
      _spot = document.createElement('div');
      _spot.className = 'st-spot';
      document.body.appendChild(_spot);
    }
    if (!_tip) {
      _tip = document.createElement('div');
      _tip.className = 'st-tip';
      document.body.appendChild(_tip);
    }
  }

  function _unmount() {
    [_ov, _spot, _tip, _centerModal].forEach(function(el){
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    _ov = _spot = _tip = _centerModal = null;
    // Nav-kártya kiemelés vissza.
    var tcard = document.getElementById('soferTourNavCard');
    if (tcard) tcard.classList.remove('tour');
  }

  // A célelem valós pozícióját kiolvassuk és a spotlight + tooltip
  // pozíciót ehhez igazítjuk.
  function _positionSpotlight(target) {
    if (!target || !_spot) { if (_spot) _spot.style.display = 'none'; return null; }
    _spot.style.display = 'block';
    var r = target.getBoundingClientRect();
    var pad = 8;
    _spot.style.top    = (r.top - pad)    + 'px';
    _spot.style.left   = (r.left - pad)   + 'px';
    _spot.style.width  = (r.width + pad*2)  + 'px';
    _spot.style.height = (r.height + pad*2) + 'px';
    return r;
  }
  function _positionTooltip(rect) {
    if (!_tip) return;
    var t = _tip;
    var vh = window.innerHeight, vw = window.innerWidth;
    var tw = Math.min(360, vw * 0.92);
    t.style.maxWidth = tw + 'px';
    // Adjunk pár ms-t a méret megállapításra.
    setTimeout(function(){
      var th = t.offsetHeight || 200;
      var top, left;
      if (!rect) {
        // Nincs anchor → középre.
        top  = Math.max(20, (vh - th) / 2);
        left = Math.max(10, (vw - tw) / 2);
      } else {
        // Preferáltan a cél ALATT; ha nem fér, FÖLÖTT.
        var spaceBelow = vh - rect.bottom;
        var spaceAbove = rect.top;
        if (spaceBelow >= th + 24 || spaceBelow >= spaceAbove) {
          top = rect.bottom + 16;
        } else {
          top = Math.max(12, rect.top - th - 16);
        }
        // Vízszintesen próbáljuk a cél alá centrálni, de ne lógjon ki.
        left = rect.left + rect.width / 2 - tw / 2;
        if (left < 10) left = 10;
        if (left + tw > vw - 10) left = vw - tw - 10;
      }
      t.style.top  = top  + 'px';
      t.style.left = left + 'px';
    }, 10);
  }

  // ==================================================================
  // LÉPÉSEK
  //   Minden lépés: {
  //     id, section?, anchor: () => Element|null, title, body, callout?,
  //     waitClick?: boolean,    — ha true, a NEXT gomb elrejtve, várunk
  //                                a cél elem valódi koppintására
  //     onEnter?: () => void,   — a lépés megjelenítése előtt (pl. goSec)
  //     onExit?: () => void,    — a lépés elhagyásakor
  //     nextLabel?              — a NEXT gomb szövege
  //   }
  // ==================================================================
  var STEPS = [
    // 0 — WELCOME
    {
      id: 'welcome',
      center: true,
      title: T('sof.tour.s0.title', '👋 Üdv a VallorSoft-ban!'),
      body:  T('sof.tour.s0.body', 'Ez egy kb. 2 perces bemutató. Végigmegyünk egy DEMÓ fuvaron — tényleg nyomogathatod a gombokat, semmi nem kerül a szerverre. Ha bármikor mégse akarod, a „Kihagyom" gombbal befejezed.'),
      nextLabel: T('sof.tour.s0.start', 'Kezdés →')
    },
    // 1 — Vezérlőpult / logó / nyelvváltó
    {
      id: 'topbar',
      onEnter: function(){ if (typeof goSec === 'function') goSec('dash'); },
      anchor: function(){ return document.querySelector('.sofer-header'); },
      title: T('sof.tour.s1.title', 'Ez a főoldalad'),
      body:  T('sof.tour.s1.body', 'A logóra bármikor koppintva ide térsz vissza. Jobbra a nyelvet válthatod (RO/HU) és látod a nevedet.')
    },
    // 2 — Kiosztott fuvarok szekció (DEMO fuvarral)
    {
      id: 'orders',
      onEnter: function(){ _injectDemo(); },
      anchor: function(){ return document.querySelector('.kiosztott-section'); },
      title: T('sof.tour.s2.title', 'Ide jönnek a fuvaraid'),
      body:  T('sof.tour.s2.body', 'Amit a diszpécser rád oszt, itt jelenik meg. Most raktunk ide egy DEMÓ fuvart, hogy tudd, hogy néz ki.'),
      callout: T('sof.tour.s2.callout', 'Az igazi fuvaron a felrakó/lerakó címét és dátumát látod majd.')
    },
    // 3 — Kártya kinyitása
    {
      id: 'expand',
      anchor: function(){
        var el = document.querySelector('[data-tour-demo="1"]');
        // A fuvar-kártya fejléce a kattintható rész — visszaadjuk azt, ami
        // biztosan van (a kártya wrapperje).
        return el || document.querySelector('.kiosztott-section');
      },
      title: T('sof.tour.s3.title', 'Koppints a fuvar-kártyára'),
      body:  T('sof.tour.s3.body', 'Kinyitja a részleteket: ügyfél, felrakási / lerakási cím + cég, dátum, súly, súly, referencia — minden, amit a diszpécser megadott.'),
      waitClick: true,
      waitTargetClick: function(target){
        // Bárhol kattint a demó kártyán belül → tovább.
        return target && (target.closest && target.closest('[data-tour-demo="1"]'));
      },
      nextLabel: T('sof.tour.next', 'Kihagyom →')
    },
    // 4 — Állomás-gomb (a fejlécen)
    {
      id: 'stopBtn',
      anchor: function(){
        var demo = document.querySelector('[data-tour-demo="1"]');
        if (!demo) return null;
        return demo.querySelector('.sh-btn.confirm.fuvar-head-action') || demo.querySelector('.sh-btn.confirm');
      },
      title: T('sof.tour.s4.title', 'Az „állomás-gomb" — a legfontosabb'),
      body:  T('sof.tour.s4.body', 'Ezzel léptet a fuvar. A gépe eldönti, mi jön: 📍 felrakóhoz értem → 📦 felrakódtam → 📍 lerakóhoz értem → ✅ leürítettem. Az iroda azonnal látja.'),
      callout: T('sof.tour.s4.callout', 'Koppints rá és próbáld ki — DEMÓ, nem küld semmit.'),
      waitClick: true,
      waitTargetClick: function(target){
        return target && (target.closest && target.closest('.sh-btn.confirm'))
               && target.closest('[data-tour-demo="1"]');
      }
    },
    // 5 — Határátlépés menü
    {
      id: 'navBorder',
      onEnter: function(){ if (typeof goSec === 'function') goSec('dash'); },
      anchor: function(){ return document.querySelector('.sofer-nav-card[onclick*="border"]'); },
      title: T('sof.tour.s5.title', '🛂 Határátlépés — napidíj automata'),
      body:  T('sof.tour.s5.body', 'RO határon átléptél? Itt jelzed BE / KI. A rendszer a napidíjat (diurna) EBBŐL számolja — a menetlevélbe már be van írva.'),
      waitClick: true,
      waitTargetClick: function(target){
        return target && (target.closest && target.closest('.sofer-nav-card[onclick*="border"]'));
      }
    },
    // 6 — Határátlépés BE gomb
    {
      id: 'borderIn',
      onEnter: function(){ if (typeof goSec === 'function') goSec('border'); },
      anchor: function(){ return document.querySelector('.border-btn.in'); },
      title: T('sof.tour.s6.title', 'Koppints a 🇷🇴 RO BE gombra'),
      body:  T('sof.tour.s6.body', 'Kérdez, mikor léptél át (mostani idő az alap; ha lekésted, javíthatod), majd rögzíti. DEMÓ — nem küldjük el.'),
      waitClick: true,
      waitTargetClick: function(target){
        return target && (target.closest && target.closest('.border-btn'));
      }
    },
    // 7 — Menetlevél nav
    {
      id: 'navWaybill',
      onEnter: function(){ if (typeof goSec === 'function') goSec('dash'); },
      anchor: function(){ return document.querySelector('.sofer-nav-card[onclick*="fuvar"]'); },
      title: T('sof.tour.s7.title', '📄 Menetlevél'),
      body:  T('sof.tour.s7.body', 'A napi/heti út dokumentálása: km-óra, tankolás, vásárlások, útvonal pontok. A rendszer AUTOMATIKUSAN menti, amit beírsz — nem kell külön mentened.'),
      waitClick: true,
      waitTargetClick: function(target){
        return target && (target.closest && target.closest('.sofer-nav-card[onclick*="fuvar"]'));
      }
    },
    // 8 — Menetlevél létrehozása gomb
    {
      id: 'waybillCreate',
      onEnter: function(){ if (typeof goSec === 'function') goSec('fuvar'); },
      anchor: function(){ return document.querySelector('button[onclick="fuvarCreate()"]'); },
      title: T('sof.tour.s8.title', 'Így indítod: „📄 Menetlevél létrehozása"'),
      body:  T('sof.tour.s8.body', 'Először megkérdezi, honnan indulsz (Plecare). Utána egy listából bepipálod, melyik elvégzett fuvar kerüljön a menetlevélbe (vagy hagyod üresen).'),
      callout: T('sof.tour.s8.callout', 'Ne nyomj rá most — csak nézzük meg. A „Tovább" gombbal továbblépünk.')
    },
    // 9 — Bon szkennelés
    {
      id: 'scan',
      anchor: function(){ return document.querySelector('#fuvarStep1ScanBtn'); },
      title: T('sof.tour.s9.title', '📷 Bon szkennelés (AI)'),
      body:  T('sof.tour.s9.body', 'Fotózd le a tankolós vagy vásárlós bont — az AI kiolvassa (helyszín, dátum, összeg, liter, kártya/készpénz). Nem kell begépelni. Ha kilépnél a képernyőről, háttérben tovább dolgozik.'),
      callout: T('sof.tour.s9.callout', 'A főoldalról is elérhető (dashboard tetején).')
    },
    // 10 — Iratok
    {
      id: 'navDocs',
      onEnter: function(){ if (typeof goSec === 'function') goSec('dash'); },
      anchor: function(){ return document.querySelector('.sofer-nav-card[onclick*="docs"]'); },
      title: T('sof.tour.s10.title', '📁 Iratok / CMR'),
      body:  T('sof.tour.s10.body', 'CMR / aláírt POD / Számla / Vám / Egyéb — fotózol vagy PDF-et választasz. TÖBB fájl egyszerre is mehet. POD-nál a fuvart is válaszd ki (opcionális).')
    },
    // 11 — Chat
    {
      id: 'navChat',
      anchor: function(){ return document.querySelector('.sofer-nav-card[onclick*="WhatsApp"]'); },
      title: T('sof.tour.s11.title', '💬 Chat'),
      body:  T('sof.tour.s11.body', 'A cég WhatsApp-számát nyitja meg (a diszpécser állítja be). Így küldesz üzenetet, képet közvetlenül.')
    },
    // 12 — PTR
    {
      id: 'ptr',
      anchor: function(){ return document.querySelector('.kiosztott-section'); },
      title: T('sof.tour.s12.title', '↓ Húzd le → frissítés'),
      body:  T('sof.tour.s12.body', 'A képernyő tetején (ahol nem görgethető feljebb) húzd le az ujjaddal → a lap frissül, ahogy a natív telefonos appokban. Új fuvarnál ez kell.')
    },
    // 13 — Bug FAB
    {
      id: 'bugFab',
      anchor: function(){ return document.getElementById('bugFab'); },
      title: T('sof.tour.s13.title', '🐛 Ha valami nem működik'),
      body:  T('sof.tour.s13.body', 'A jobb alsó sarokban lévő 🐛 gombra koppints, írd le mi történt — a fejlesztő azonnal megkapja. Vezetés után is használható, nagy gomb.')
    },
    // 14 — VÉGE
    {
      id: 'done',
      center: true,
      onEnter: function(){ _removeDemo(); if (typeof goSec === 'function') goSec('dash'); },
      title: T('sof.tour.s14.title', '🎉 Ennyi!'),
      body:  T('sof.tour.s14.body', 'A DEMÓ fuvar eltűnt. A főoldalról a „🎓 Bemutatás" gombbal BÁRMIKOR újranyithatod ezt a bemutatót — nyugodtan tanulj vele. Sok sikert az úton!'),
      nextLabel: T('sof.tour.s14.close', 'Bezárás')
    }
  ];

  // ==================================================================
  // LÉPÉS-RENDERELÉS
  // ==================================================================
  var _clickCapture = null; // globális klikk-figyelő a waitClick lépésekhez

  function _clearClickCapture() {
    if (_clickCapture) {
      document.removeEventListener('click', _clickCapture, true);
      _clickCapture = null;
    }
  }

  function _showStep(idx) {
    if (idx < 0 || idx >= STEPS.length) { stop(); return; }
    _state.stepIdx = idx;
    var st = STEPS[idx];
    _clearClickCapture();

    // onEnter side-effect (goSec, injektálás)
    if (typeof st.onEnter === 'function') { try { st.onEnter(); } catch(e){} }

    // Kis várakozás, hogy a DOM (goSec után) frissüljön.
    setTimeout(function(){
      _mount();

      // CENTER (welcome / done) — spotlight nélkül, saját modal.
      if (st.center) {
        if (_ov) _ov.classList.remove('on');
        if (_spot) _spot.style.display = 'none';
        if (_tip) _tip.style.display = 'none';
        _renderCenterCard(st);
        return;
      }

      // Overlay bekapcsolva.
      if (_centerModal && _centerModal.parentNode) {
        _centerModal.parentNode.removeChild(_centerModal);
        _centerModal = null;
      }
      if (_ov) _ov.classList.add('on');
      if (_tip) _tip.style.display = '';

      // Cél elem lekérése.
      var target = null;
      try { target = st.anchor ? st.anchor() : null; } catch(e){}
      var rect = _positionSpotlight(target);
      if (target) {
        try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e){}
        // A pozíció újraszámolása scroll után.
        setTimeout(function(){ rect = _positionSpotlight(target); _positionTooltip(rect); }, 260);
      }
      if (_spot) _spot.classList.add('pulse');

      // Tooltip tartalom
      _renderTooltip(st);
      _positionTooltip(rect);

      // waitClick: figyeljük a cél elemre a valós koppintást.
      if (st.waitClick) {
        _clickCapture = function(e){
          if (typeof st.waitTargetClick === 'function' && st.waitTargetClick(e.target)) {
            // Egy kis késleltetéssel léptetünk, hogy a valós click-handler
            // (goSec, driverStopAction interception, sendBorderCross interception)
            // előbb lefusson.
            setTimeout(function(){ next(); }, 400);
          }
        };
        document.addEventListener('click', _clickCapture, true);
      }
    }, 60);
  }

  function _renderTooltip(st) {
    if (!_tip) return;
    var progress = Math.round(((_state.stepIdx) / (STEPS.length - 1)) * 100);
    var html = ''
      + '<div class="st-progress">'
      +   '<span>' + (_state.stepIdx + 1) + ' / ' + STEPS.length + '</span>'
      +   '<div class="st-bar"><i style="width:' + progress + '%;"></i></div>'
      + '</div>'
      + '<h4>' + _esc(st.title) + '</h4>'
      + '<p>' + _esc(st.body) + '</p>'
      + (st.callout ? '<div class="st-callout">' + _esc(st.callout) + '</div>' : '')
      + '<div class="st-btns">';
    if (_state.stepIdx > 0) {
      html += '<button class="st-btn ghost" onclick="SoferTour._prev()">' + _esc(T('sof.tour.prev', '← Vissza')) + '</button>';
    }
    if (st.waitClick) {
      // Csak kihagyó gomb — a fő cselekvés a valódi klikk.
      html += '<button class="st-btn ghost" onclick="SoferTour._next()">' + _esc(st.nextLabel || T('sof.tour.skipStep', 'Kihagyom →')) + '</button>';
    } else {
      html += '<button class="st-btn primary" onclick="SoferTour._next()">' + _esc(st.nextLabel || T('sof.tour.next', 'Tovább →')) + '</button>';
    }
    html += '</div>';
    // Skip mindig elérhető (kis szürke) — kivéve az utolsó lépésen.
    if (_state.stepIdx < STEPS.length - 1) {
      html += '<div style="text-align:center;margin-top:8px;">'
           + '<button class="st-btn skip" onclick="SoferTour.stop()">' + _esc(T('sof.tour.stop', 'Kihagyom a bemutatót')) + '</button>'
           + '</div>';
    }
    _tip.innerHTML = html;
  }

  function _renderCenterCard(st) {
    if (_centerModal && _centerModal.parentNode) _centerModal.parentNode.removeChild(_centerModal);
    _centerModal = document.createElement('div');
    _centerModal.className = 'st-center';
    _centerModal.innerHTML = ''
      + '<div class="st-center-card">'
      +   '<div class="st-ico">' + (st.id === 'welcome' ? '👋' : '🎉') + '</div>'
      +   '<h3>' + _esc(st.title) + '</h3>'
      +   '<p>' + _esc(st.body) + '</p>'
      +   '<div class="st-btns">'
      +     (st.id === 'welcome'
              ? '<button class="st-btn ghost" onclick="SoferTour.stop()">' + _esc(T('sof.tour.skip', 'Kihagyom')) + '</button>'
              : '')
      +     '<button class="st-btn primary" onclick="SoferTour._next()">' + _esc(st.nextLabel || T('sof.tour.next', 'Tovább →')) + '</button>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(_centerModal);
  }

  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function(m){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m];
  }); }

  // ==================================================================
  // NAVIGÁCIÓ
  // ==================================================================
  function next() {
    if (!_state.active) return;
    if (_state.stepIdx >= STEPS.length - 1) { stop(true); return; }
    var st = STEPS[_state.stepIdx];
    if (st && typeof st.onExit === 'function') { try { st.onExit(); } catch(e){} }
    _showStep(_state.stepIdx + 1);
  }
  function prev() {
    if (!_state.active) return;
    if (_state.stepIdx <= 0) return;
    _showStep(_state.stepIdx - 1);
  }

  function start(force) {
    if (_state.active && !force) return;
    _state.active = true;
    _state.stepIdx = 0;
    _state.email = _readEmail();
    _mount();
    _showStep(0);
  }

  function stop(finished) {
    _clearClickCapture();
    _removeDemo();
    _unmount();
    _state.active = false;
    if (finished || _state.stepIdx > 2) {
      // Ha látta legalább pár lépést, jelöljük "kész"-nek.
      _markDone();
    }
  }

  // ==================================================================
  // DEMÓ-INTERCEPT — hívja a sofer.js kritikus akcióinak eleje.
  //   Ha visszatér `true`, a hívó NE menjen a szerverre — kiiratunk egy
  //   „✅ DEMÓ: ..." toastot, és auto-továbblépünk a következő lépésre.
  //
  //   orderIdOrKind: 'CMD-DEMO-001' vagy 'border'/'waybill'/'doc'/'handover'
  //   action: rövid szöveges leírás a toasthoz
  // ==================================================================
  function demoIntercept(orderIdOrKind, action) {
    if (!_state.active) {
      // Nem fut tour, DE a demó fuvar bent maradhatott → ha a hívás rá vonatkozik, védekezz.
      if (orderIdOrKind === DEMO_ID) {
        _removeDemo();
        _showToast('📚 DEMO — nem hajtjuk végre.');
        return true;
      }
      return false;
    }
    // Tour fut. Ha a művelet a demó fuvarra vonatkozik, vagy globális művelet
    // (border/waybill/doc/handover) egy olyan lépésben, ami erre vár, intercept.
    var currentStep = STEPS[_state.stepIdx];
    var isDemoOrder = (orderIdOrKind === DEMO_ID);
    var isGlobal    = (orderIdOrKind === 'border' || orderIdOrKind === 'waybill'
                      || orderIdOrKind === 'doc' || orderIdOrKind === 'handover');
    if (!isDemoOrder && !isGlobal) return false;

    // Border/waybill/doc/handover mindig intercept, ha tour fut (a sofőr
    // nem küldjön el valódit véletlenül) — de csak a megfelelő lépésen
    // léptet automatikusan.
    _showToast('✅ ' + T('sof.tour.demoToast', 'DEMÓ') + ': ' + (action || ''));
    return true;
  }

  function _showToast(msg) {
    try {
      if (typeof window.toast === 'function') { window.toast(msg, 'ok'); return; }
    } catch(e){}
    // Fallback (nem szép, de működik)
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);'
      + 'background:#16a34a;color:#fff;padding:10px 16px;border-radius:10px;z-index:9999;'
      + 'font-weight:700;box-shadow:0 8px 20px rgba(0,0,0,0.25);';
    document.body.appendChild(el);
    setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 2500);
  }

  // ==================================================================
  // PERZISZTENCIA
  // ==================================================================
  function _readEmail() {
    try {
      if (window._meData && window._meData.email) return String(window._meData.email).toLowerCase();
    } catch(e){}
    return '';
  }
  function _key() { return STORAGE_PREFIX + (_state.email || _readEmail() || '_'); }
  function isDone() {
    try { return localStorage.getItem(_key()) === '1'; } catch(e){ return false; }
  }
  function _markDone() {
    try { localStorage.setItem(_key(), '1'); } catch(e){}
  }

  function resetSeen() {
    try { localStorage.removeItem(_key()); } catch(e){}
  }

  // ==================================================================
  // PUBLIKUS API + AUTO-START ELSŐ BELÉPÉSKOR
  // ==================================================================
  window.SoferTour = {
    start: start,
    stop:  stop,
    isDone: isDone,
    resetSeen: resetSeen,
    demoIntercept: demoIntercept,
    // Belső, HTML-onclick-ből hívott aliaszok:
    _next: next,
    _prev: prev,
    // Reflow (nyelvváltás vagy ablak-átméretezés után újrarender)
    _reflow: function(){
      if (!_state.active) return;
      _showStep(_state.stepIdx);
    }
  };

  // Nyelvváltáskor újraszámoljuk a szövegeket → újrarender.
  var _prevOnLang = window.onLangChange;
  window.onLangChange = function(lang){
    try { if (typeof _prevOnLang === 'function') _prevOnLang(lang); } catch(e){}
    if (window.SoferTour) window.SoferTour._reflow();
  };
  // Ablak-átméretezésre a spotlight/tooltip pozíciót újraszámoljuk.
  window.addEventListener('resize', function(){
    if (_state.active) {
      var st = STEPS[_state.stepIdx];
      if (st && !st.center && typeof st.anchor === 'function') {
        var target = null; try { target = st.anchor(); } catch(e){}
        var rect = _positionSpotlight(target);
        _positionTooltip(rect);
      }
    }
  });

  // ── Auto-start elhalasztva: a sofer.js `authMe.then`-jében hívjuk,
  //    hogy legyen `_meData.email` az `isDone()`-hoz.
})();
