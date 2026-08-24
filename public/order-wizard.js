// ============================================================
//  public/order-wizard.js
//  Fuvar-kiírás WIZARD (admin+manager) — lépésenkénti kitöltés + PDF-szerű
//  ellenőrző lap. A meglévő legacy űrlap (`.pane[data-pane="orders-form"]`
//  > `.glass`) DOM-jából dolgozik: a hozzátartozó .field-eket / blokkokat
//  a wizard step-body-jaiba mozgatja, a step 2 (állomások) SAJÁT UI-val
//  fut (kártya-lista fel/le rendezéssel), a Tovább pillanatában szinkronizál
//  a legacy `#oLoad/#oLoadFirma/#oLoadDate/#oUnload/#oUnloadFirma/#oUnloadDate`
//  mezőkbe + `#oExtraStopsList`-be (`addExtraStopRow`). A mentés a legacy
//  `createOrder()`-t hívja — minden szerver-oldal érintetlen.
//
//  A wizard csak a `.pane[data-pane="orders-form"]` paneln él; más pane érintetlen.
// ============================================================
(function () {
  'use strict';

  // ── Globális állapot ──
  var OC = window.OC = {
    mounted: false,
    step: 1,
    maxStep: 6,           // 5 kitöltő lépés + 1 review
    stops: [],            // [{kind:'pickup'|'delivery', loc, firma, data, time}]
    _acId: 0,             // wizard-input azonosító
    openStopIdx: 0        // step 2 akkordeon: melyik állomás nyitva (0-alapú)
  };

  // ── Segéd: i18n (fallback a magyar szöveggel) ──
  function T(k, def) {
    try { if (typeof t === 'function') { var v = t(k); if (v && v !== k) return v; } } catch (e) {}
    return def;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── A legacy panelen található nagyobb blokkok cache-e ──
  // Mount-kor beazonosítjuk és kimozgatjuk őket a wizard step-body-jaiba.
  // A `#oLoad/#oLoadFirma/#oLoadDate/#oUnload/#oUnloadFirma/#oUnloadDate` mezők
  // a rejtett `.glass` panelben MARADNAK — a step 2 saját UI-ja szinkronizálja
  // őket (értékeket írunk beléjük a Tovább-nál, olvasunk belőlük visszalépéskor).
  var LEGACY_KEYS = {
    // step 1
    client:  { step: 1, sel: '#oClient',   type: 'field' },
    ref:     { step: 1, sel: '#oRef',      type: 'field' },
    seria:   { step: 1, sel: '#oSeria',    type: 'field' },
    // step 3
    ftl:     { step: 3, sel: '#oFtl',      type: 'field' },
    suly:    { step: 3, sel: '#oSuly',     type: 'field' },
    dims:    { step: 3, sel: '#oHossz',    type: 'field' },
    // step 4 — a sofőr-típus radio-blokk, a belső/külső blokk és a jármű-választó
    driverType: { step: 4, sel: null, type: 'special-driver-type' },
    internBlock:{ step: 4, sel: '#oInternBlock', type: 'raw' },
    externBlock:{ step: 4, sel: '#oExternBlock', type: 'raw' },
    vehicles:   { step: 4, sel: null, type: 'special-vehicles' },
    // step 5
    pret:    { step: 5, sel: '#oPret',     type: 'field' },
    km:      { step: 5, sel: '#oKm',       type: 'field' },
    uit:     { step: 5, sel: '#oUit',      type: 'field' }
  };

  function _closestField(el) {
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains('field')) return el;
      el = el.parentElement;
    }
    return null;
  }

  // ── MOUNT ──
  function ocInit() {
    var pane = document.querySelector('.pane[data-pane="orders-form"]');
    if (!pane) return;
    if (OC.mounted && pane.querySelector('#ocWizardShell')) {
      // Már mountolva — csak frissítsük a step-et (pl. tab-váltás).
      _refreshView();
      return;
    }
    OC.mounted = true;

    var glass = pane.querySelector('.glass');
    if (!glass) return;

    // 1) A legacy .glass panelt elrejtjük (a benne lévő mezők DOM-ban maradnak).
    glass.classList.add('oc-legacy-glass');
    glass.style.display = 'none';

    // 2) A wizard-shell beszúrása a pane elejére (az AI-scan + CSV-import
    //    gombokat a wizard-tetejére mozgatjuk).
    var shell = document.createElement('div');
    shell.id = 'ocWizardShell';
    shell.className = 'oc-shell';
    shell.innerHTML = _shellHtml();
    pane.insertBefore(shell, pane.firstChild);

    // 3) AI-scan + CSV-import blokkok áthelyezése a wizard tetejére.
    var aiBox = document.getElementById('ordScanBtnBox');
    var csvBox = document.getElementById('ordersImportBtnBox');
    var topSlot = shell.querySelector('#ocTopTools');
    if (aiBox && topSlot) topSlot.appendChild(aiBox);
    if (csvBox && topSlot) topSlot.appendChild(csvBox);

    // 4) A LEGACY_KEYS-ben szereplő blokkok áthelyezése a step-body-kba.
    Object.keys(LEGACY_KEYS).forEach(function (k) {
      var spec = LEGACY_KEYS[k];
      var node = _resolveLegacy(spec, glass);
      if (!node) return;
      var slot = shell.querySelector('#ocStepBody' + spec.step);
      if (slot) {
        // Ha field-típus, az egész .field-et visszük.
        if (spec.type === 'field') {
          var f = _closestField(node);
          if (f) slot.appendChild(f);
        } else {
          slot.appendChild(node);
        }
      }
    });

    // 5) A step 2 saját UI-jának első rajzolása.
    _renderStep2();

    // 6) Kezdeti nézet.
    _refreshView();

    // 7) A step 2 wizard-input autocomplete-jei csak akkor működnek, ha a
    //    step 2 aktív. Bekötést lazyn a _renderStep2-ben végezzük.

    // 8) Ha AI-scan előre töltötte a legacy mezőket, azt tükrözzük a wizard
    //    állomás-listájába (első megjelenéskor). A későbbi scan-t is elfogjuk
    //    egy 5 mp-es figyelővel (opcionális) — de a legegyszerűbb: a step 2
    //    minden újrarajzoláskor a legacy értékeket felszippantja (ha még üres
    //    a wizard-lista).
    _syncStopsFromLegacyIfEmpty();
  }

  function _resolveLegacy(spec, glass) {
    if (spec.sel) return glass.querySelector(spec.sel);
    if (spec.type === 'special-driver-type') {
      // Az `<input name="oSoferType">` szülőjének (`div style="margin-top:20px;...">`).
      var r = glass.querySelector('input[name="oSoferType"]');
      if (!r) return null;
      var p = r;
      // A wrapper egy <div>, ami tartalmazza a fejlécet + a 3 radio-label-t.
      // Kereséssel: a legközelebbi olyan div, aminek van "SOFŐR TÍPUSA" jellegű header-je
      // (data-i18n="form.driverType"). Egyszerűbb: a radio szülő két szintjét felmegyünk.
      while (p && p !== glass) {
        if (p.querySelector && p.querySelector('[data-i18n="form.driverType"]')) return p;
        p = p.parentElement;
      }
      return null;
    }
    if (spec.type === 'special-vehicles') {
      // A `.grid-2`, amiben a `#oCamionSelect` van. A szülő div (margin-top:10px;) az egész blokk.
      var cs = glass.querySelector('#oCamionSelect');
      if (!cs) return null;
      var g2 = cs.closest('.grid-2');
      if (!g2) return null;
      // A `.grid-2` szülő az egész blokk-wrapper (a submit gomb ELŐTT).
      return g2.parentElement || g2;
    }
    return null;
  }

  function _shellHtml() {
    // Minden lépés önálló card: .oc-step-card > (nyitva: .oc-step-head + .oc-step-content) |
    //                                          (csukva: .oc-step-bar egyetlen soros összegzés)
    // A wizard motor a .oc-step-card-on 'state' osztályt kapcsol: 'open' | 'done' | 'pending'
    // 'done'  → csak a bar látszik (kattintható → ocGoStep visszalép)
    // 'open'  → head + content
    // 'pending' → csak a bar látszik szürkébben (nem kattintható)
    function _stepCard(n, titleKey, titleDef, bodyId) {
      return ''
        + '<div class="oc-step-card" data-step="' + n + '" data-state="pending">'
        +   '<div class="oc-step-bar" onclick="ocStepBarClick(' + n + ')">'
        +     '<div class="oc-step-bar-num"><span class="oc-sb-idx">' + (n < 6 ? n : '✓') + '</span></div>'
        +     '<div class="oc-step-bar-body">'
        +       '<div class="oc-step-bar-title" data-i18n="' + titleKey + '">' + esc(titleDef) + '</div>'
        +       '<div class="oc-step-bar-sum" id="ocStepSum' + n + '"></div>'
        +     '</div>'
        +     '<div class="oc-step-bar-act">'
        +       '<span class="oc-step-bar-edit" title="' + esc(T('oc.edit', 'Javítás')) + '">✏️</span>'
        +     '</div>'
        +   '</div>'
        +   '<div class="oc-step-open">'
        +     '<div class="oc-step-head">'
        +       '<span class="oc-step-num">' + (n < 6 ? n : '✓') + '</span>'
        +       '<h3 class="oc-step-title" data-i18n="' + titleKey + '">' + esc(titleDef) + '</h3>'
        +     '</div>'
        +     '<div class="oc-step-content" id="' + bodyId + '"></div>'
        +   '</div>'
        + '</div>';
    }
    return ''
      + '<div id="ocTopTools" class="oc-top-tools"></div>'
      + '<div class="oc-progress" id="ocProgress"></div>'
      + '<div class="oc-body">'
      +   _stepCard(1, 'oc.step1Title', 'Ügyfél', 'ocStepBody1')
      +   _stepCard(2, 'oc.step2Title', 'Állomások (felrakók / lerakók)', 'ocStepBody2')
      +   _stepCard(3, 'oc.step3Title', 'Áru', 'ocStepBody3')
      +   _stepCard(4, 'oc.step4Title', 'Kiosztás (sofőr + jármű)', 'ocStepBody4')
      +   _stepCard(5, 'oc.step5Title', 'Ár, távolság és UIT', 'ocStepBody5')
      +   _stepCard(6, 'oc.step6Title', 'Ellenőrzés és mentés', 'ocStepBody6')
      // A nav a .oc-body gyereke — a _refreshView a nyitott card után helyezi.
      +   '<div class="oc-nav" id="ocNav">'
      +     '<button type="button" class="btn ghost" id="ocBtnBack" onclick="ocPrev()"><span data-i18n="oc.back">← Vissza</span></button>'
      +     '<div class="oc-nav-spacer"></div>'
      +     '<button type="button" class="btn primary" id="ocBtnNext" onclick="ocNext()"><span data-i18n="oc.next">Tovább →</span></button>'
      +     '<button type="button" class="btn primary" id="ocBtnSubmit" style="display:none;" onclick="ocSubmit()"><span data-i18n="oc.submit">✅ Fuvar mentése</span></button>'
      +   '</div>'
      + '</div>';
  }

  // ── Nézet-frissítés (progress + step-láthatóság + gombok + review) ──
  function _refreshView() {
    var shell = document.getElementById('ocWizardShell');
    if (!shell) return;

    // Progress-sáv
    var prog = document.getElementById('ocProgress');
    if (prog) {
      var labels = [
        T('oc.p1', 'Ügyfél'),
        T('oc.p2', 'Állomások'),
        T('oc.p3', 'Áru'),
        T('oc.p4', 'Kiosztás'),
        T('oc.p5', 'Ár'),
        T('oc.p6', 'Ellenőrzés')
      ];
      var out = '';
      for (var i = 1; i <= OC.maxStep; i++) {
        var cls = 'oc-pdot';
        if (i === OC.step) cls += ' active';
        else if (i < OC.step) cls += ' done';
        out += '<div class="' + cls + '" onclick="ocGoStep(' + i + ')" title="' + esc(labels[i - 1]) + '">'
          + '<span class="oc-pn">' + (i < OC.step ? '✓' : i) + '</span>'
          + '<span class="oc-pl">' + esc(labels[i - 1]) + '</span>'
          + '</div>';
        if (i < OC.maxStep) out += '<div class="oc-pline"></div>';
      }
      prog.innerHTML = out;
    }

    // Card-állapotok: done (bar látszik) | open (head+content) | pending (bar szürkén)
    var cards = shell.querySelectorAll('.oc-step-card');
    var openCard = null;
    Array.prototype.forEach.call(cards, function (card) {
      var n = parseInt(card.getAttribute('data-step'), 10);
      var state = (n < OC.step) ? 'done' : (n === OC.step ? 'open' : 'pending');
      card.setAttribute('data-state', state);
      // Ha done → frissítsük a bar-összegzést a legfrissebb adatokból
      if (state === 'done') _renderStepBarSummary(n);
      if (state === 'open') openCard = card;
    });

    // Nav a nyitott card KÖZVETLEN utána — a jövőbeli (pending) step-bar-ok
    // csak a nav ALATT jelennek meg. Természetes olvasás-irány: kész lépések ▸
    // aktuális card ▸ Tovább gomb ▸ mi jön még. A `.oc-nav` DOM-mozgatva a
    // helyére; ha nincs open card (fallback), az `.oc-body` végén marad.
    var navEl = document.getElementById('ocNav');
    if (navEl && openCard && openCard.nextSibling !== navEl) {
      openCard.parentNode.insertBefore(navEl, openCard.nextSibling);
    }

    // Nav gombok
    var back = document.getElementById('ocBtnBack');
    var next = document.getElementById('ocBtnNext');
    var subm = document.getElementById('ocBtnSubmit');
    if (back) back.style.visibility = (OC.step > 1) ? 'visible' : 'hidden';
    if (OC.step === OC.maxStep) {
      if (next) next.style.display = 'none';
      if (subm) subm.style.display = '';
    } else {
      if (next) next.style.display = '';
      if (subm) subm.style.display = 'none';
    }

    // Ha a review lapra léptünk, most rendereljünk.
    if (OC.step === 6) _renderReview();

    // Ha a step 2-re léptünk vissza, a state-et a legacy mezőkből is
    // frissítsük (pl. utólagos AI-scan után).
    if (OC.step === 2) _syncStopsFromLegacyIfEmpty();

    // Ha a step 3-ra léptünk, a méret-kötelező jelzés frissítése (a legacy JS is használja).
    if (OC.step === 3 && typeof refreshDimReq === 'function') { try { refreshDimReq(); } catch (e) {} }

    // Reszponzív: az aktuálisan nyitott step tetejére görget (hogy a felette
    // lévő bar-ok között ne kelljen felgörgetni).
    try {
      var openCard = shell.querySelector('.oc-step-card[data-state="open"]');
      var target = openCard || shell;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {}
  }

  // ── Bar-kattintás: visszaugrik a lépéshez (csak done → open átjárás) ──
  function ocStepBarClick(n) {
    if (n === OC.step) return;      // nyitva van, nincs teendő
    if (n > OC.step) return;        // jövőbeli lépés: még nem érhető el
    ocGoStep(n);
  }

  // ── Egyetlen step bar-jának összegző-szövegét frissíti (done állapotban). ──
  function _renderStepBarSummary(n) {
    var el = document.getElementById('ocStepSum' + n);
    if (!el) return;
    var v = _readAllLegacy();
    var txt = '';
    if (n === 1) {
      var parts = [];
      if (v.client) parts.push(v.client);
      if (v.ref) parts.push(v.ref);
      if (v.series_prefix) parts.push(v.series_prefix);
      txt = parts.join(' · ') || esc(T('oc.empty', '(üres)'));
    } else if (n === 2) {
      var pu = OC.stops.filter(function (s) { return s.kind === 'pickup'; }).length;
      var de = OC.stops.filter(function (s) { return s.kind === 'delivery'; }).length;
      if (!pu && !de) { txt = esc(T('oc.noStops', 'Nincs állomás')); }
      else {
        // Első pickup helyszín → első delivery helyszín + darabszám
        var first = OC.stops[0], last = OC.stops[OC.stops.length - 1];
        var route = [];
        if (first && first.loc) route.push(first.loc);
        if (last && last !== first && last.loc) route.push(last.loc);
        var count = ' · ' + pu + '⬆ / ' + de + '⬇';
        txt = esc(route.join(' → ')) + count;
      }
    } else if (n === 3) {
      var t3 = [];
      if (v.load_type) t3.push(v.load_type);
      if (v.suly_kg) t3.push(v.suly_kg + ' kg');
      if (v.hossz_cm && v.szel_cm && v.mag_cm) t3.push(v.hossz_cm + '×' + v.szel_cm + '×' + v.mag_cm);
      txt = t3.length ? esc(t3.join(' · ')) : esc(T('oc.empty', '(üres)'));
    } else if (n === 4) {
      var t4 = [];
      if (v.sofer_type === 'Intern' && v.nume_sofer) t4.push(esc(v.nume_sofer));
      else if (v.sofer_type === 'Extern') {
        var eb = [];
        if (v.nume_sofer) eb.push(esc(v.nume_sofer));
        if (v.firma_extern) eb.push(esc(v.firma_extern));
        t4.push(eb.join(' / ') || esc(T('form.externDriver', 'Külső')));
      } else t4.push(esc(T('form.noDriver', 'Sofőr nélkül')));
      if (v.rendszam_camion) t4.push('🚚 ' + esc(v.rendszam_camion));
      if (v.rendszam_remorca) t4.push('🚛 ' + esc(v.rendszam_remorca));
      txt = t4.join(' · ');
    } else if (n === 5) {
      var t5 = [];
      if (v.pret) t5.push(v.pret);
      if (v.km) t5.push(v.km + ' km');
      if (v.uit) t5.push('UIT ' + esc(((window.UitFmt && window.UitFmt.format) ? window.UitFmt.format(v.uit) : v.uit)));
      txt = t5.length ? t5.join(' · ') : esc(T('oc.empty', '(üres)'));
    }
    el.innerHTML = txt;
  }

  // ── Lépés-navigáció ──
  function ocGoStep(n) {
    n = Math.max(1, Math.min(OC.maxStep, n | 0));
    // Ha lefelé lépünk, a jelenlegi step "commit" logikája.
    _commitCurrentStep();
    OC.step = n;
    _refreshView();
  }

  function ocNext() {
    if (!_validateCurrentStep()) return;
    _commitCurrentStep();
    OC.step = Math.min(OC.maxStep, OC.step + 1);
    _refreshView();
  }

  function ocPrev() {
    _commitCurrentStep();
    OC.step = Math.max(1, OC.step - 1);
    _refreshView();
  }

  function _validateCurrentStep() {
    if (OC.step === 1) {
      var cn = (document.getElementById('oClient') || {}).value;
      if (!cn || !String(cn).trim()) {
        _toast(T('cs.clientNameReq', 'Kérlek adj meg ügyfelet.'), 'err');
        return false;
      }
    }
    if (OC.step === 2) {
      // Legalább 1 felrakó + 1 lerakó szükséges — a szerver úgyis ellenőrzi,
      // itt csak figyelmeztetünk (helyszín vagy dátum legalább egy).
      var pu = OC.stops.filter(function (s) { return s.kind === 'pickup'; });
      var de = OC.stops.filter(function (s) { return s.kind === 'delivery'; });
      if (!pu.length || !de.length) {
        _toast(T('oc.needStops', 'Legalább egy felrakási és egy lerakási állomás kell.'), 'err');
        return false;
      }
    }
    if (OC.step === 3) {
      var ftl = (document.getElementById('oFtl') || {}).checked;
      var ltl = (document.getElementById('oLtl') || {}).checked;
      if (!ftl && !ltl) { _toast(T('cs.pickLoadType', 'Válaszd ki a rakomány típusát (FTL/LTL).'), 'err'); return false; }
      if (ltl) {
        var h = (document.getElementById('oHossz') || {}).value;
        var w = (document.getElementById('oSzel') || {}).value;
        var m = (document.getElementById('oMag') || {}).value;
        if (!h || !w || !m) { _toast(T('cs.ltlDimsReq', 'LTL-nél a méretek (h × sz × m) kötelezők.'), 'err'); return false; }
      }
    }
    return true;
  }

  function _commitCurrentStep() {
    if (OC.step === 2) _commitStopsToLegacy();
  }

  // ── Step 2 — SAJÁT UI (állomás-kártyák átrendezhetők) ──
  function _renderStep2() {
    var host = document.getElementById('ocStepBody2');
    if (!host) return;
    host.innerHTML =
      '<div class="oc-hint">' + esc(T('oc.stopsHintAcc',
        'Add hozzá az állomásokat a bevitel sorrendjében. Csak EGY nyílt egyszerre — új állomás hozzáadásával az előző összecsukódik. A km-számítás a felsorolás sorrendjében fűzi össze az összeset.')) + '</div>' +
      '<div id="ocStopsList" class="oc-stops"></div>' +
      '<div class="oc-stops-actions">' +
        '<button type="button" class="btn ghost" onclick="ocStopAdd(\'pickup\')">➕ ⬆️ ' + esc(T('oc.addPickup', 'Felrakó')) + '</button>' +
        '<button type="button" class="btn ghost" onclick="ocStopAdd(\'delivery\')">➕ ⬇️ ' + esc(T('oc.addDelivery', 'Lerakó')) + '</button>' +
      '</div>';
    _renderStopsList();
  }

  function _renderStopsList() {
    var list = document.getElementById('ocStopsList');
    if (!list) return;
    if (!OC.stops.length) {
      list.innerHTML = '<div class="oc-empty">' + esc(T('oc.noStops', 'Még nincs egy állomás sem — add hozzá az első felrakót.')) + '</div>';
      return;
    }
    // Akkordeon: EGYSZERRE egyetlen állomás-kártya nyitva (openStopIdx),
    // a többi összecsukott bar. A bar-ra kattintva nyílik, a Tovább / új
    // stop hozzáadás automatikusan zárja az előzőt.
    if (OC.openStopIdx == null || OC.openStopIdx >= OC.stops.length) OC.openStopIdx = OC.stops.length - 1;

    list.innerHTML = OC.stops.map(function (s, i) {
      var isOpen = (i === OC.openStopIdx);
      var kindIcon = (s.kind === 'pickup') ? '⬆️' : '⬇️';
      var kindLabel = (s.kind === 'pickup')
        ? esc(T('oc.pickup', 'Felrakás'))
        : esc(T('oc.delivery', 'Lerakás'));
      var badge = '<span class="oc-badge ' + (s.kind === 'pickup' ? 'pickup' : 'delivery') + '">'
        + kindIcon + ' ' + kindLabel + '</span>';

      // Összecsukott bar-tartalom (rövid összefoglaló)
      var barSum = '';
      var sumParts = [];
      if (s.loc) sumParts.push('📍 ' + esc(s.loc));
      if (s.firma) sumParts.push('🏢 ' + esc(s.firma));
      if (s.data) {
        var dt = esc((s.data || '').slice(0, 10)) + (s.time ? ' ' + esc(s.time) : '');
        sumParts.push('📅 ' + dt);
      }
      barSum = sumParts.length ? sumParts.join(' · ')
        : '<i class="oc-empty-sub">' + esc(T('oc.stopEmpty', 'kitöltésre vár')) + '</i>';

      // BAR (mindig ott van; open állapotban rejtett)
      var barHtml = ''
        + '<div class="oc-stop-bar" onclick="ocStopOpen(' + i + ')">'
        +   '<div class="oc-stop-bar-num">#' + (i + 1) + '</div>'
        +   '<div class="oc-stop-bar-badge">' + badge + '</div>'
        +   '<div class="oc-stop-bar-sum">' + barSum + '</div>'
        +   '<div class="oc-stop-bar-act">'
        +     '<button type="button" class="oc-ord-btn" onclick="event.stopPropagation();ocStopMove(' + i + ',-1)" title="' + esc(T('oc.moveUp', 'Feljebb')) + '"' + (i === 0 ? ' disabled' : '') + '>⬆</button>'
        +     '<button type="button" class="oc-ord-btn" onclick="event.stopPropagation();ocStopMove(' + i + ',1)" title="' + esc(T('oc.moveDown', 'Lejjebb')) + '"' + (i === OC.stops.length - 1 ? ' disabled' : '') + '>⬇</button>'
        +     '<button type="button" class="oc-ord-btn danger" onclick="event.stopPropagation();ocStopRemove(' + i + ')" title="' + esc(T('common.delete', 'Törlés')) + '">✕</button>'
        +     '<span class="oc-stop-bar-edit" title="' + esc(T('oc.edit', 'Javítás')) + '">✏️</span>'
        +   '</div>'
        + '</div>';

      // NYITOTT tartalom
      var acId = 'ocStopLoc_' + i;
      var acDdId = 'ocStopLocDD_' + i;
      var firmaId = 'ocStopFirma_' + i;
      var openHtml = ''
        + '<div class="oc-stop-open">'
        +   '<div class="oc-stop-top">'
        +     badge
        +     '<div class="oc-stop-toggle">'
        +       '<button type="button" class="oc-toggle-btn' + (s.kind === 'pickup' ? ' on' : '') + '" onclick="ocStopSetKind(' + i + ',\'pickup\')">⬆️ ' + esc(T('oc.pickup', 'Felrakás')) + '</button>'
        +       '<button type="button" class="oc-toggle-btn' + (s.kind === 'delivery' ? ' on' : '') + '" onclick="ocStopSetKind(' + i + ',\'delivery\')">⬇️ ' + esc(T('oc.delivery', 'Lerakás')) + '</button>'
        +     '</div>'
        +   '</div>'
        +   '<div class="oc-stop-grid">'
        +     '<div class="oc-field">'
        +       '<label>' + esc(T('oc.stopLoc', 'Helység / cím')) + '</label>'
        +       '<div class="vs-ac-wrap"><input class="input oc-in-loc" id="' + acId + '" data-sg="loc" placeholder="' + esc(T('form.locPh', 'Helység')) + '" value="' + esc(s.loc || '') + '" autocomplete="off"><div class="vs-ac-dd" id="' + acDdId + '"></div></div>'
        +     '</div>'
        +     '<div class="oc-field">'
        +       '<label>' + esc(T('oc.stopFirma', 'Cég (felrakó/lerakó)')) + '</label>'
        +       '<input class="input oc-in-firma" id="' + firmaId + '" data-sg="firma" placeholder="' + esc(T('form.firmaPh', 'Cég neve')) + '" value="' + esc(s.firma || '') + '" autocomplete="off">'
        +     '</div>'
        +     '<div class="oc-field">'
        +       '<label>' + esc(T('oc.stopDate', 'Dátum')) + '</label>'
        +       '<input class="input oc-in-date" type="date" value="' + esc((s.data || '').slice(0, 10)) + '">'
        +     '</div>'
        +     '<div class="oc-field">'
        +       '<label>' + esc(T('oc.stopTime', 'Idő (opc.)')) + '</label>'
        +       '<input class="input oc-in-time" type="time" value="' + esc(s.time || '') + '">'
        +     '</div>'
        +   '</div>'
        +   '<div class="oc-stop-close-row">'
        +     '<button type="button" class="btn ghost" onclick="ocStopCollapse()">' + esc(T('oc.stopCollapse', '▲ Bezárás')) + '</button>'
        +   '</div>'
        + '</div>';

      return ''
        + '<div class="oc-stop-card' + (isOpen ? ' open' : ' collapsed') + '" data-idx="' + i + '">'
        +   barHtml
        +   openHtml
        + '</div>';
    }).join('');

    // Élő beírás → állapot-frissítés
    Array.prototype.forEach.call(list.querySelectorAll('.oc-stop-card'), function (card) {
      var i = parseInt(card.getAttribute('data-idx'), 10);
      var loc = card.querySelector('.oc-in-loc');
      var firma = card.querySelector('.oc-in-firma');
      var dt = card.querySelector('.oc-in-date');
      var tm = card.querySelector('.oc-in-time');
      if (loc) loc.addEventListener('input', function () { OC.stops[i].loc = loc.value; });
      if (firma) firma.addEventListener('input', function () { OC.stops[i].firma = firma.value; });
      if (dt) dt.addEventListener('input', function () { OC.stops[i].data = dt.value; });
      if (tm) tm.addEventListener('input', function () { OC.stops[i].time = tm.value; });

      // Autocomplete (Photon)
      if (loc && typeof vsAttachAutocomplete === 'function') {
        var acId = loc.id;
        var ddId = 'ocStopLocDD_' + i;
        try { vsAttachAutocomplete(acId, ddId, function () { /* pick-callback: nincs teendő */ }); } catch (e) {}
      }
      // ⭐ Mentett helyek picker — a stop kind-hez illő szűrő
      // (pickup → load, delivery → unload). Ha kind vált, a picker-gomb marad
      // (a `_favPickerBound` őr csak egyszer köti); a kind csak új render-nél
      // számít, így új szűrő kell → a bind-guardot resetáljuk kind-váltásnál.
      if (loc && window.FavLocations && typeof FavLocations.attachPicker === 'function') {
        try {
          var favKind = OC.stops[i].kind === 'pickup' ? 'load' : 'unload';
          FavLocations.attachPicker(loc.id, favKind);
        } catch (e) {}
      }
    });
    // A `data-sg` inputokra a KÖZÖS delegált autocomplete (console-shared.js
    // `ensureOrderSgDelegate`) automatikusan felfut fókusz/gépeléskor.
    // Előmelegítés: ha még nincs betöltve a javaslat-map, elindítjuk.
    try { if (typeof ocSgLoad === 'function') ocSgLoad(); } catch (e) {}
  }

  // ── Állomás-műveletek (accordion-tudatos) ──
  function ocStopAdd(kind) {
    // Új stop hozzáadása → az előző (nyitva lévő) automatikusan bezáródik,
    // az új nyílik meg.
    OC.stops.push({ kind: (kind === 'pickup' ? 'pickup' : 'delivery'), loc: '', firma: '', data: '', time: '' });
    OC.openStopIdx = OC.stops.length - 1;
    _renderStopsList();
  }
  function ocStopRemove(i) {
    if (i < 0 || i >= OC.stops.length) return;
    OC.stops.splice(i, 1);
    // openStopIdx normalizálás
    if (OC.stops.length === 0) OC.openStopIdx = null;
    else if (OC.openStopIdx >= OC.stops.length) OC.openStopIdx = OC.stops.length - 1;
    else if (OC.openStopIdx > i) OC.openStopIdx--;
    _renderStopsList();
  }
  function ocStopMove(i, dir) {
    var j = i + dir;
    if (j < 0 || j >= OC.stops.length) return;
    var tmp = OC.stops[i]; OC.stops[i] = OC.stops[j]; OC.stops[j] = tmp;
    // openStopIdx követi a mozgatást, ha a mozgatott elem volt nyitva
    if (OC.openStopIdx === i) OC.openStopIdx = j;
    else if (OC.openStopIdx === j) OC.openStopIdx = i;
    _renderStopsList();
  }
  function ocStopSetKind(i, kind) {
    if (i < 0 || i >= OC.stops.length) return;
    OC.stops[i].kind = (kind === 'pickup' ? 'pickup' : 'delivery');
    _renderStopsList();
  }
  // Akkordeon: adott állomás nyitása (a többi automatikusan bezáródik)
  function ocStopOpen(i) {
    if (i < 0 || i >= OC.stops.length) return;
    if (OC.openStopIdx === i) { OC.openStopIdx = null; }
    else { OC.openStopIdx = i; }
    _renderStopsList();
  }
  // Nyitott bezárása (▲ Bezárás gomb)
  function ocStopCollapse() {
    OC.openStopIdx = null;
    _renderStopsList();
  }

  // ── Szinkronizáció a legacy id-kbe (Tovább / lép a review-ra) ──
  // Az interleaved sorrend (2 felrakó → 5 lerakó → 3 felrakó → 1 lerakó) végig
  // megőrzött: a legacy top-mezőkbe a SORREND SZERINTI első pickup / delivery
  // kerül; az `oExtraStopsList` sorai az OC.stops interleaved rendjében (az
  // első pickup / delivery kihagyásával). A createOrder az OC.stops-ból küldi
  // az ordered `stops[]`-ot a szervernek (`window.__ocStopsSeq`-en át).
  function _commitStopsToLegacy() {
    // Publikáljuk a jelenlegi (interleaved) sorrendet a createOrder-nek. Ez a
    // szerver oldalán az `orders.stops[]` payloadba kerül, ami a `seq_index`-et
    // megőrzi az `order_stops` táblában → a sofőr is így látja.
    window.__ocStopsSeq = OC.stops.map(function (s) {
      return { kind: s.kind, loc: s.loc || '', firma: s.firma || '', data: s.data || '', time: s.time || '' };
    });

    // Legacy top-mezők — az OC.stops-ban ELSŐKÉNT talált pickup / delivery.
    // (Nem a listákra bontott „első pickup / első delivery" — hanem a bevitel
    // sorrendjében az első előfordulás. Ez konzisztens a `seq_index`-szel.)
    var firstPu = null, firstDe = null;
    for (var i = 0; i < OC.stops.length; i++) {
      var st = OC.stops[i];
      if (!firstPu && st.kind === 'pickup')   firstPu = st;
      if (!firstDe && st.kind === 'delivery') firstDe = st;
      if (firstPu && firstDe) break;
    }
    _setVal('oLoad',       (firstPu && firstPu.loc) || '');
    _setVal('oLoadFirma',  (firstPu && firstPu.firma) || '');
    _setVal('oLoadDate',   _mkDtLocal(firstPu));
    _setVal('oUnload',      (firstDe && firstDe.loc) || '');
    _setVal('oUnloadFirma', (firstDe && firstDe.firma) || '');
    _setVal('oUnloadDate',  _mkDtLocal(firstDe));

    // Extra pontok — a bevitel sorrendjében (interleaved), a top-mezőkbe
    // került első pickup + első delivery kihagyásával. Így a `_collectExtraStops`
    // DOM-sorrendben olvassa vissza őket, ha valamiért a stops[] nem érne el
    // a szerverre (legacy fallback).
    var extraList = document.getElementById('oExtraStopsList');
    if (extraList) {
      extraList.innerHTML = '';
      if (typeof addExtraStopRow === 'function') {
        var sawPu = false, sawDe = false;
        OC.stops.forEach(function (s) {
          if (s.kind === 'pickup' && !sawPu) { sawPu = true; return; }
          if (s.kind === 'delivery' && !sawDe) { sawDe = true; return; }
          addExtraStopRow(s.kind, 'oExtraStopsList', { loc: s.loc, firma: s.firma, data: s.data });
        });
      }
    }

    // Ha a `orderRouteRecalc` elérhető → az útvonal újraszámol (opcionális,
    // a legacy autocomplete is ezt tenné). Csendes.
    if (typeof orderRouteRecalc === 'function') { try { orderRouteRecalc('create'); } catch (e) {} }
  }

  // Fordítva: ha a legacy mezőkben már van adat (AI-scan / szerkesztés
  // közbeni visszalépés utáni beolvasás) és a wizard-lista üres — szinkronizál.
  // Előnyben az interleaved __ocStopsSeq (a Tovább/Vissza megőrzi a sorrendet).
  function _syncStopsFromLegacyIfEmpty() {
    if (OC.stops.length > 0) return;
    // 1) Ha az előző step Tovább-ja már publikálta az interleaved sorrendet,
    //    onnan pontosan visszaállítjuk (nem a DOM-ból, ami két szakaszra van vágva).
    if (Array.isArray(window.__ocStopsSeq) && window.__ocStopsSeq.length) {
      OC.stops = window.__ocStopsSeq.map(function (s) {
        return { kind: s.kind === 'pickup' ? 'pickup' : 'delivery',
                 loc: s.loc || '', firma: s.firma || '', data: s.data || '', time: s.time || '' };
      });
      _renderStopsList();
      return;
    }
    // 2) Egyébként legacy top-mezők + DOM extra-sorok (AI-scan / import).
    var arr = [];
    var loadLoc = (document.getElementById('oLoad') || {}).value || '';
    var loadFirma = (document.getElementById('oLoadFirma') || {}).value || '';
    var loadDt = (document.getElementById('oLoadDate') || {}).value || '';
    var unloadLoc = (document.getElementById('oUnload') || {}).value || '';
    var unloadFirma = (document.getElementById('oUnloadFirma') || {}).value || '';
    var unloadDt = (document.getElementById('oUnloadDate') || {}).value || '';
    if (loadLoc || loadFirma || loadDt) {
      arr.push({ kind: 'pickup', loc: loadLoc, firma: loadFirma, data: _dtDate(loadDt), time: _dtTime(loadDt) });
    }
    if (unloadLoc || unloadFirma || unloadDt) {
      arr.push({ kind: 'delivery', loc: unloadLoc, firma: unloadFirma, data: _dtDate(unloadDt), time: _dtTime(unloadDt) });
    }
    // Extra sorok (ha valamiért már ott vannak — pl. szerkesztő-visszaút).
    var extras = document.querySelectorAll('#oExtraStopsList .oe-extra-row');
    Array.prototype.forEach.call(extras, function (r) {
      var kind = r.dataset.kind === 'pickup' ? 'pickup' : 'delivery';
      var loc = ((r.querySelector('.oe-x-loc') || {}).value || '').trim();
      var firma = ((r.querySelector('.oe-x-firma') || {}).value || '').trim();
      var data = ((r.querySelector('.oe-x-data') || {}).value || '');
      if (loc || firma || data) arr.push({ kind: kind, loc: loc, firma: firma, data: data, time: '' });
    });
    OC.stops = arr;
    _renderStopsList();
  }

  function _setVal(id, v) {
    var el = document.getElementById(id);
    if (!el) return;
    el.value = v || '';
  }
  function _mkDtLocal(s) {
    if (!s) return '';
    var d = (s.data || '').slice(0, 10);
    if (!d) return '';
    var t = (s.time && /^\d{2}:\d{2}/.test(s.time)) ? s.time.slice(0, 5) : '00:00';
    return d + 'T' + t;
  }
  function _dtDate(s) { s = String(s || ''); return s.slice(0, 10); }
  function _dtTime(s) {
    s = String(s || '');
    var m = s.match(/T(\d{2}:\d{2})/);
    return m ? m[1] : '';
  }

  // ── Review lap ──
  function _renderReview() {
    var host = document.getElementById('ocStepBody6');
    if (!host) return;
    // Legacy értékek felolvasása (ezek az igazságforrás — a wizard mindig ide szinkronizál).
    var v = _readAllLegacy();
    var typeStr = v.load_type || '—';
    var dims = (v.hossz_cm && v.szel_cm && v.mag_cm)
      ? (v.hossz_cm + ' × ' + v.szel_cm + ' × ' + v.mag_cm + ' cm')
      : '—';
    var pu = OC.stops.filter(function (s) { return s.kind === 'pickup'; });
    var de = OC.stops.filter(function (s) { return s.kind === 'delivery'; });
    var stopsList = OC.stops.map(function (s) {
      var icon = s.kind === 'pickup' ? '⬆️' : '⬇️';
      var when = s.data ? esc(s.data) + (s.time ? ' · ' + esc(s.time) : '') : '';
      var loc = esc(s.loc || '—');
      var firma = s.firma ? '<div class="ocr-sub">' + esc(s.firma) + '</div>' : '';
      return '<li>' + icon + ' <b>' + loc + '</b>' + (when ? ' <span class="ocr-when">' + when + '</span>' : '') + firma + '</li>';
    }).join('');

    var driverStr = '—';
    if (v.sofer_type === 'Intern' && v.nume_sofer) driverStr = esc(v.nume_sofer) + ' (' + esc(T('form.internDriver', 'Belső')) + ')';
    else if (v.sofer_type === 'Extern') {
      var eb = [];
      if (v.nume_sofer) eb.push(esc(v.nume_sofer));
      if (v.firma_extern) eb.push(esc(v.firma_extern));
      if (v.telefon_extern) eb.push(esc(v.telefon_extern));
      driverStr = eb.length ? eb.join(' · ') + ' (' + esc(T('form.externDriver', 'Külső')) + ')' : esc(T('form.externDriver', 'Külső sofőr'));
    } else {
      driverStr = esc(T('form.noDriver', 'Sofőr nélkül'));
    }

    host.innerHTML =
      '<div class="oc-review">' +
        '<div class="ocr-doc">' +
          '<div class="ocr-doc-head">' +
            '<div class="ocr-doc-title">📄 ' + esc(T('oc.reviewTitle', 'Fuvar előnézete')) + '</div>' +
            '<div class="ocr-doc-hint">' + esc(T('oc.reviewHint', 'Ellenőrizd az adatokat. Bármely szekció a ✏️ Javítás gombbal módosítható.')) + '</div>' +
          '</div>' +

          _sec('1', T('oc.step1Title', 'Ügyfél'),
            '<div class="ocr-row"><b>' + esc(T('form.client', 'Ügyfél')) + ':</b> ' + esc(v.client || '—') + '</div>' +
            '<div class="ocr-row"><b>' + esc(T('form.ref', 'Referencia')) + ':</b> ' + esc(v.ref || '—') + '</div>' +
            (v.series_prefix ? '<div class="ocr-row"><b>' + esc(T('form.seria', 'Sorozat')) + ':</b> ' + esc(v.series_prefix) + '</div>' : '')
          ) +

          _sec('2', T('oc.step2Title', 'Állomások'),
            '<div class="ocr-stops-summary">' + esc(T('oc.pickupCount', 'Felrakó')) + ': <b>' + pu.length + '</b> · ' +
              esc(T('oc.deliveryCount', 'Lerakó')) + ': <b>' + de.length + '</b></div>' +
            '<ul class="ocr-stops">' + (stopsList || '<li><i>' + esc(T('oc.noStops', 'Nincs állomás')) + '</i></li>') + '</ul>'
          ) +

          _sec('3', T('oc.step3Title', 'Áru'),
            '<div class="ocr-row"><b>' + esc(T('form.loadType', 'Rakomány')) + ':</b> ' + esc(typeStr) + '</div>' +
            '<div class="ocr-row"><b>' + esc(T('form.weight', 'Súly')) + ':</b> ' + (v.suly_kg ? esc(v.suly_kg) + ' kg' : '—') + '</div>' +
            '<div class="ocr-row"><b>' + esc(T('form.dims', 'Méretek')) + ':</b> ' + dims + '</div>'
          ) +

          _sec('4', T('oc.step4Title', 'Kiosztás'),
            '<div class="ocr-row"><b>' + esc(T('form.driverType', 'Sofőr')) + ':</b> ' + driverStr + '</div>' +
            '<div class="ocr-row"><b>' + esc(T('form.tractorPlate', 'Vontató')) + ':</b> ' + esc(v.rendszam_camion || '—') + '</div>' +
            '<div class="ocr-row"><b>' + esc(T('form.trailerPlate', 'Pótkocsi')) + ':</b> ' + esc(v.rendszam_remorca || '—') + '</div>'
          ) +

          _sec('5', T('oc.step5Title', 'Ár, távolság és UIT'),
            '<div class="ocr-row"><b>' + esc(T('form.price', 'Ár')) + ':</b> ' + (v.pret ? esc(v.pret) : '—') + '</div>' +
            '<div class="ocr-row"><b>' + esc(T('form.km', 'Távolság')) + ':</b> ' + (v.km ? esc(v.km) + ' km' : '—') + '</div>' +
            _legsBreakdownHtml() +
            '<div class="ocr-row"><b>' + esc(T('form.uit', 'UIT-kód')) + ':</b> ' +
              (v.uit ? esc(((window.UitFmt && window.UitFmt.format) ? window.UitFmt.format(v.uit) : v.uit)) : '—') + '</div>'
          ) +

        '</div>' +
      '</div>';
  }

  function _sec(step, title, bodyHtml) {
    return '<div class="ocr-sec">' +
      '<div class="ocr-sec-head">' +
        '<div class="ocr-sec-title"><span class="ocr-sec-num">' + step + '</span> ' + esc(title) + '</div>' +
        '<button type="button" class="btn ghost ocr-edit" onclick="ocGoStep(' + step + ')">✏️ ' + esc(T('oc.edit', 'Javítás')) + '</button>' +
      '</div>' +
      '<div class="ocr-sec-body">' + bodyHtml + '</div>' +
    '</div>';
  }

  function _readAllLegacy() {
    var _v = function (id) { var e = document.getElementById(id); return e ? e.value : ''; };
    var st = document.querySelector('input[name="oSoferType"]:checked');
    var sofer_type = st ? st.value : 'None';
    var nume_sofer = '';
    if (sofer_type === 'Intern') {
      var sel = document.getElementById('oInternDriver');
      if (sel && sel.selectedIndex >= 0) {
        var lbl = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
        nume_sofer = (lbl || '').split(' (')[0] || '';
      }
    } else if (sofer_type === 'Extern') {
      nume_sofer = _v('oExternNume');
    }
    var ftl = (document.getElementById('oFtl') || {}).checked;
    var ltl = (document.getElementById('oLtl') || {}).checked;
    var lt = ftl ? 'FTL' : (ltl ? 'LTL' : '');
    var seriesSel = document.getElementById('oSeria');
    var seriesPrefix = '';
    if (seriesSel && seriesSel.selectedIndex >= 0 && seriesSel.options[seriesSel.selectedIndex]) {
      seriesPrefix = (seriesSel.options[seriesSel.selectedIndex].text || '').replace(/\s*★.*$/, '').trim();
    }
    return {
      client: _v('oClient'),
      ref: _v('oRef'),
      series_prefix: seriesPrefix,
      pret: _v('oPret'),
      km: _v('oKm'),
      uit: _v('oUit'),
      suly_kg: _v('oSuly'),
      load_type: lt,
      hossz_cm: _v('oHossz'), szel_cm: _v('oSzel'), mag_cm: _v('oMag'),
      sofer_type: sofer_type,
      nume_sofer: nume_sofer,
      firma_extern: _v('oExternFirma'),
      telefon_extern: _v('oExternTelefon'),
      rendszam_camion: _v('oCamionSelect'),
      rendszam_remorca: _v('oRemorcaSelect')
    };
  }

  // ── Beküldés — a legacy createOrder()-t hívjuk, ami mindent ismer. ──
  function ocSubmit() {
    if (typeof createOrder !== 'function') { _toast('createOrder nem elérhető', 'err'); return; }
    // A createOrder() sikeres mentésnél saját maga ürít, mi is resetelünk utána.
    var prevLen = OC.stops.length;
    createOrder();
    // A createOrder aszinkron — 1500 ms múlva megnézzük, hogy megjelent-e a
    // sikeres toast (nincs public jelzés). Egyszerűbb: figyeljük az `oClient`
    // mezőt: ha kiürült, sikeres volt.
    setTimeout(function () {
      var cn = (document.getElementById('oClient') || {}).value;
      if (!cn) {
        OC.stops = [];
        try { window.__ocStopsSeq = null; } catch (e) {}
        _renderStopsList();
        OC.step = 1;
        _refreshView();
      }
    }, 1500);
    // A `_ocStops`-ot a következő nyitáskor a `_syncStopsFromLegacyIfEmpty` üresen
    // hagyja (üres legacy mezőkkel), így a lista tiszta lesz.
    var _ = prevLen;
  }

  function _toast(msg, kind) {
    if (typeof toast === 'function') { try { toast(msg, kind || 'info'); return; } catch (e) {} }
    try { console.log('[wizard]', msg); } catch (e) {}
  }

  // ── Szakasz-bontás (leg-breakdown) a review-lapra, ha van multi-stop chain ──
  // A `_rmState.create.legs` a `orderRouteRecalc` sikeres válaszából érkezik
  // (console-shared.js `st.legs = r.legs`); itt csak megjelenítjük.
  function _legsBreakdownHtml() {
    var st = (typeof window._rmState === 'object' && window._rmState && window._rmState.create) || null;
    var legs = st && Array.isArray(st.legs) ? st.legs : [];
    if (!legs || legs.length < 2) return '';   // 1 szakasz = egyszerű útvonal, nem érdekes
    var rows = legs.map(function (leg, i) {
      var fromShort = _cityShort(leg.fromLabel);
      var toShort = _cityShort(leg.toLabel);
      var km = (leg.km != null) ? (leg.km + ' km') : '—';
      return '<div class="ocr-leg-row"><span class="ocr-leg-idx">#' + (i + 1) + '</span>' +
        '<span class="ocr-leg-path">📍 ' + esc(fromShort) + ' → ' + esc(toShort) + '</span>' +
        '<span class="ocr-leg-km">' + esc(km) + '</span></div>';
    }).join('');
    return '<div class="ocr-legs">' +
      '<div class="ocr-legs-head">' + esc(T('oc.legsHead', 'Szakaszok (a bevitel sorrendjében)')) + ' — ' +
        legs.length + ' ' + esc(T('oc.legsUnit', 'szakasz')) + '</div>' +
      rows +
      '</div>';
  }
  // A label első jelentős darabja (városnév) — a bontás olvashatóbb így.
  function _cityShort(label) {
    if (!label) return '—';
    var parts = String(label).split(',').map(function (p) { return p.trim(); }).filter(Boolean);
    if (!parts.length) return String(label);
    // Kihagyjuk az utca-prefixet („Strada", „Bd." stb.) és az irszámot, ha az első darab az
    var STREET = /^(strada|str\.?|bd\.?|bulevardul|calea|aleea|piata|sat|sos\.?)\s/i;
    var POSTAL = /^\d{3,6}(\s|$)/;
    for (var i = 0; i < parts.length; i++) {
      if (STREET.test(parts[i]) || POSTAL.test(parts[i])) continue;
      return parts[i];
    }
    return parts[0];
  }

  // Callback a console-shared.js `orderRouteRecalc` végén — ha a review lap
  // nyitva van, újrarajzoljuk (hogy az új leg-bontás megjelenjen).
  window.__ocOnRouteChanged = function (which, result) {
    try {
      if (which !== 'create') return;
      if (OC.step !== 6) return;    // review nincs nyitva → majd következő nyitáskor
      _renderReview();
    } catch (_) {}
  };

  // ── Publikus API (globálisan az onclick-hez) ──
  window.ocInit = ocInit;
  window.ocGoStep = ocGoStep;
  window.ocNext = ocNext;
  window.ocPrev = ocPrev;
  window.ocSubmit = ocSubmit;
  window.ocStopAdd = ocStopAdd;
  window.ocStopRemove = ocStopRemove;
  window.ocStopMove = ocStopMove;
  window.ocStopSetKind = ocStopSetKind;
  window.ocStopOpen = ocStopOpen;
  window.ocStopCollapse = ocStopCollapse;
  window.ocStepBarClick = ocStepBarClick;
})();
