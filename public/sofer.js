// ============================================================
//  VallorSoft — sofer.js
//  Kivágva a sofer.html inline <script> blokkjaiból, BÁJTRA AZONOS.
// ============================================================
// HTML-escape a szerverről jövő adatokhoz (tárolt XSS ellen)
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// Város-név kinyerése teljes címből — a sofőr-felületen mindenhol
// olvashatóbb, ha a fuvar-sorokban CSAK a városnevet mutatjuk (nem a
// teljes utca+irsz+ország szöveget). Példa:
//   "Strada Pictor Rosenthal, 107061, Ploiești, România" → "Ploiești"
//   "Strada Uzinei, 555400 Copșa Mică"                  → "Copșa Mică"
// Heurisztika: vesszőnkénti bontás; kihagyjuk a street-prefixes /
// irányítószám / ország-nevet / önálló házszámot; a maradékból az
// első nem-üres darab a város (a vezető irszám levágva).
function _cityOf(loc) {
  var s = String(loc || '').trim();
  if (!s) return '';
  var parts = s.split(',').map(function(p){ return p.trim(); }).filter(Boolean);
  if (!parts.length) return s;
  var STREET_RE  = /^(strada|str\.?|bd\.?|b-?dul|bulevardul|calea|șos(eaua)?|sos(eaua)?|șos\.?|sos\.?|aleea|piaț[aă]|piata|cart(ier)?\.?|sat|nr\.?|intrarea|intr\.?|drumul|dr\.?|splaiul|spl\.?|fund[aă]tura|fnd\.?)\b/i;
  var COUNTRY_RE = /^(rom[aâ]nia|ungaria|magyarorsz[aá]g|hungary|moldova|republica moldova|bulgaria|serbia|srbija|s[eé]rbia|ukraine|ucraina|austria|germania|deutschland|italia|italy|fran[țt]a|france|slovakia|slovacia|slovenia|croa[țt]ia|greece|grecia|poland|polska|polonia|cehia|czech|belgium|belgia|nederland|holland|olanda|luxemburg|switzerland|elve[țt]ia|espa[ñn]a|spania|portugal|portugalia|turkey|turcia|denmark|danemarca|sweden|suedia|norway|norvegia|finland|finlanda|ireland|irlanda|marea britanie|uk|united kingdom)$/i;
  var POSTAL_RE  = /^\d{3,8}[a-z]?$/i;
  // Irányítószám-prefixes darab (RO: „cod 527166", HU: „irsz. 4025",
  // int.: „cp 400000") — a részt kihagyjuk, mert nem város.
  var POSTAL_PREFIX_RE = /^(cod(ul)?|cp|c\.p\.|postal|irsz\.?|ir\.sz\.?|zip|plz)\s*[:.]?\s*\d{3,8}[a-z]?$/i;
  // Megye-prefix („jud. Covasna", „judetul Cluj") — a rendszer szerint ez
  // megye, nem város; de ha semmi más nem marad, ezt megtartjuk fallback-nek.
  var COUNTY_RE = /^(jud\.?|județul|judetul|megye)\b/i;
  var countyFallback = '';
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!p) continue;
    if (POSTAL_RE.test(p)) continue;
    if (POSTAL_PREFIX_RE.test(p)) continue;
    if (COUNTRY_RE.test(p)) continue;
    if (STREET_RE.test(p)) continue;
    if (/^\d+[a-z]?$/i.test(p)) continue;
    if (COUNTY_RE.test(p)) { if (!countyFallback) countyFallback = p; continue; }
    // Vezető irányítószám levágása a részen belül („555400 Copșa Mică" → „Copșa Mică")
    var stripped = p.replace(/^\d{3,8}[a-z]?\s+/i, '').trim();
    if (stripped) return stripped;
  }
  return countyFallback || parts[parts.length - 1] || s;
}

// ============================================================
// 🔌 SESSION-RECOVERY OVERLAY (session-guard-től hívva)
// ============================================================
// A `session-guard.js` a `visibilitychange` során észreveheti, hogy a
// szerver-session lejárt (`authMe` NULL) vagy offline vagyunk. Ha a
// hivo oldal beallitja a `VS_INAPP_SESSION_RECOVER = true`-t, akkor
// NEM redirectel /login-re; ehelyett meghivja a
// `window.__vsShowSessionOverlay(reason)`-t. Itt egy overlay-t mutatunk
// két gombbal: 🔄 Frissítés (window.location.reload()) és Kilépés
// (login-oldalra vissza, ha valóban ki akar lépni). Offline állapotban
// is látja a felület — az „Elavult" felirat jelzi, hogy amíg a hálózat
// vissza nem jön, a szerver-akciók nem futnak.
window.VS_INAPP_SESSION_RECOVER = true;
window.__vsShowSessionOverlay = function (reason) {
  try {
    var ov = document.getElementById('vsSessionOverlay');
    if (!ov) return;
    // Már látszik → csak a státuszt frissítjük (pl. offline → online)
    var st = document.getElementById('vsSessionStatus');
    var isOnline = (typeof navigator !== 'undefined') ? navigator.onLine : true;
    var _t = (window.t && typeof t === 'function') ? t : function (k) { return k; };
    var reasonKey = (reason === 'offline' || !isOnline) ? 'sof.sess.offline'
                   : (reason === 'idle' ? 'sof.sess.idle'
                   : (reason === 'resume' ? 'sof.sess.resume' : 'sof.sess.expired'));
    if (st) st.textContent = _t(reasonKey);
    ov.style.display = 'flex';
  } catch (e) {}
};
function vsSessionRefresh() {
  // Egyszerű reload — ha valóban van session, a felület újratölt; ha
  // nincs, a szerver /login-re irányít (a normál login-flow), ami a
  // sofőr által elvárt viselkedés. Offline állapotban a böngésző hibát
  // ad → a driver újra kell próbálja, addig a felület megmarad
  // (nem redirectelünk el neki).
  try { window.location.reload(); } catch (e) {}
}
function vsSessionLogout() {
  // Explicit kilépés: session-t töröljük szerver-oldalon (best-effort)
  // és login-oldalra megyünk. Offline esetén csak navigálunk — a
  // szerver-cookie a következő online belépéskor tisztul.
  try {
    fetch('/api/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName: 'authLogout', arguments: [] }),
      credentials: 'same-origin'
    }).then(function () { window.location.href = '/login'; })
      .catch(function () { window.location.href = '/login'; });
  } catch (e) { window.location.href = '/login'; }
}
// Ha az `online` esemény visszajön, próbáljunk csendben ellenőrizni:
// ha a szerver ismer minket, csukjuk be az overlay-t; ha nem, marad
// (a driver a Frissítést nyomja meg).
window.addEventListener('online', function () {
  var ov = document.getElementById('vsSessionOverlay');
  if (!ov || ov.style.display !== 'flex') return;
  try {
    fetch('/api/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName: 'authMe' }),
      credentials: 'same-origin'
    })
    .then(function (r) { return r.json().catch(function () { return {}; }); })
    .then(function (d) {
      if (d && d.result != null) {
        ov.style.display = 'none';
      } else {
        // A session valóban megszűnt — csak a státuszt frissítjük.
        window.__vsShowSessionOverlay('expired');
      }
    })
    .catch(function () { /* még mindig instabil — hagyjuk az overlay-t */ });
  } catch (e) {}
});

// ============================================================
// SESSION STATE — oldal frissítés utáni visszaállítás
// sessionStorage: csak ugyanazon a fülön él, új fülön üres
// ============================================================
var SS_KEY = 'vs_sofer_state';

// ── A menetlevél-piszkozat TARTÓS tárolása ─────────────────────────────
// KORÁBBAN: `sessionStorage`. Az a tab/PWA élettartamáig él — amint az OS
// memória-nyomás miatt kilövi a háttérben lévő appot (telefon-lock után
// tipikusan percek-órák), a sofőr MINDEN beírt adata elveszett, és elölről
// kellett kezdenie. Csak az explicit „💾 Mentés a telefonra" gomb írt
// localStorage-ba — amit a sofőr nem feltétlenül nyomott meg.
//
// MOSTANTÓL: per-sofőr `localStorage` (ugyanaz a kulcs-séma, mint a
// mentett piszkozatoknál és a bon-várólistánál) → túléli az app-kilövést,
// az újraindítást és a kijelentkezést is. A közös telefon nem probléma: a
// kulcs a bejelentkezett sofőr e-mailjét tartalmazza.
//
// Migráció: első olvasáskor átvesszük a régi `sessionStorage`-értéket, ha
// van (a most futó munkamenet ne vesszen el a frissítéskor).
function _stateMigrateOnce() {
  try {
    if (window._vsStateMigrated) return;
    window._vsStateMigrated = true;
    var cur = _perDriverGetJson(SS_KEY, null);
    if (cur && typeof cur === 'object') return;      // már van tartós érték
    var legacy = sessionStorage.getItem(SS_KEY);
    if (legacy) _perDriverSetJson(SS_KEY, JSON.parse(legacy));
  } catch (e) {}
}

function stateSave(extra) {
  try {
    var cur = stateGet();
    var merged = Object.assign({}, cur, extra || {});
    var _me = (typeof _meData === 'object' && _meData && _meData.email) ? String(_meData.email).toLowerCase() : '';
    if (_me) merged.driverEmail = _me;
    _perDriverSetJson(SS_KEY, merged);
    // Tükrözés a sessionStorage-ba is: ha a localStorage megtelt vagy a
    // böngésző tiltja (privát mód), legalább a munkamenet végéig megvan.
    try { sessionStorage.setItem(SS_KEY, JSON.stringify(merged)); } catch (e) {}
  } catch(e) {}
}

function stateGet() {
  try {
    _stateMigrateOnce();
    var v = _perDriverGetJson(SS_KEY, null);
    if (v && typeof v === 'object') return v;
    return JSON.parse(sessionStorage.getItem(SS_KEY) || '{}');
  } catch(e) { return {}; }
}

// Kijelentkezéskor a navigációs állapotot dobjuk, de a PISZKOZATOT NEM —
// a sofőr kiléphet és később folytathatja. (A per-sofőr kulcs miatt közös
// telefonon sem látja más.)
function stateClear() {
  try {
    var cur = stateGet();
    var keep = (cur && cur.draft) ? { draft: cur.draft, driverEmail: cur.driverEmail } : {};
    _perDriverSetJson(SS_KEY, keep);
    sessionStorage.removeItem(SS_KEY);
  } catch(e) {}
}

// Menetlevél piszkozat mentése (debounce 600ms)
var _draftTimer = null;

// ============================================================
// MEGERŐSÍTŐ MODAL (a natív `confirm()` helyett)
// ============================================================
// A visszavonhatatlan műveleteknél (állomás-léptetés, határátlépés) a
// rendszer-dialógus helyett a felület SAJÁT modalja kérdez: nagy, egymástól
// jól elkülönülő gombok (a „Mégse" semleges, az „Igen" hangsúlyos), hogy
// vezetés után, kesztyűs kézzel se lehessen véletlenül igent nyomni.
//
// Használat: `sofConfirm({ title, msg, ok, tone }, function(){ ...igen ág... })`
// A `tone` a megerősítő gomb színe: 'primary' (alap) | 'danger' | 'ok'.
var _sofConfirmCb = null;
function sofConfirm(opts, onOk) {
  opts = opts || {};
  var m = document.getElementById('sofConfirmModal');
  // Nincs modal a DOM-ban (régi, beragadt HTML) → visszaesünk a natív
  // kérdésre: SOSEM hajtjuk végre némán a visszavonhatatlan műveletet.
  if (!m) {
    if (confirm((opts.title ? opts.title + '\n\n' : '') + (opts.msg || ''))) { if (onOk) onOk(); }
    return;
  }
  var ico = document.getElementById('sofConfirmIco');
  var ttl = document.getElementById('sofConfirmTitle');
  var msg = document.getElementById('sofConfirmMsg');
  var ok  = document.getElementById('sofConfirmOkBtn');
  if (ico) ico.textContent = opts.ico || '❓';
  if (ttl) ttl.textContent = opts.title || '';
  if (msg) msg.textContent = opts.msg || '';
  if (ok) {
    ok.textContent = opts.ok || t('sof.cfm.yes');
    ok.className = 'sof-cf-btn ok tone-' + (opts.tone || 'primary');
  }
  _sofConfirmCb = onOk || null;
  m.style.display = 'flex';
}
function sofConfirmCancel() {
  var m = document.getElementById('sofConfirmModal');
  if (m) m.style.display = 'none';
  _sofConfirmCb = null;
}
function sofConfirmOk() {
  var cb = _sofConfirmCb;
  sofConfirmCancel();
  if (cb) cb();
}

// ============================================================
// ⏱️ Idő-picker megerősítő modal — állomás-gomb + határátlépés
// ============================================================
// A `sofConfirm` helyett használjuk, ha a szerver esemény-időt vár:
// alap az AKTUÁLIS idő (mai nap, hh:mm), de a sofőr szerkesztheti, ha
// lekésett a nyomással (pl. már megtörtént a lerakás, csak most tudja
// megnyomni). „Most" gombbal újra a mostani időre állítható. A callback
// egy ISO string-et kap (pl. "2026-08-06T14:32:00.000Z"), vagy null-t,
// ha a sofőr üresen hagyta (a szerver ilyenkor NOW()-t használ).
//
// Használat: `sofTimeConfirm({ title, msg, ok, ico }, function(atIso){ ... })`
var _sofTimeCb = null;
function _sofPad2(n) { n = Number(n); return (n < 10 ? '0' : '') + n; }
function _sofLocalDatetimeValue(d) {
  // datetime-local input-formátum: YYYY-MM-DDTHH:MM (helyi idő,
  // időzóna nélkül) — a böngésző így renderelja.
  return d.getFullYear() + '-' + _sofPad2(d.getMonth() + 1) + '-' + _sofPad2(d.getDate())
       + 'T' + _sofPad2(d.getHours()) + ':' + _sofPad2(d.getMinutes());
}
function sofTimeSetNow() {
  var inp = document.getElementById('sofTimeInput');
  if (inp) inp.value = _sofLocalDatetimeValue(new Date());
}
function sofTimeCancel() {
  var m = document.getElementById('sofTimeModal');
  if (m) m.style.display = 'none';
  _sofTimeCb = null;
}
function sofTimeOk() {
  var cb = _sofTimeCb;
  var inp = document.getElementById('sofTimeInput');
  var raw = inp ? inp.value : '';
  var iso = null;
  if (raw) {
    // A datetime-local input mindig helyi időt ad → új Date() helyesen
    // parseolja (böngésző helyi zónája). ISO-ra a `.toISOString()` UTC-t
    // ad, amit a szerver `::timestamptz`-ként fogad el.
    var d = new Date(raw);
    if (d instanceof Date && !isNaN(d.getTime())) iso = d.toISOString();
  }
  sofTimeCancel();
  if (cb) cb(iso);
}
function sofTimeConfirm(opts, onOk) {
  opts = opts || {};
  var m = document.getElementById('sofTimeModal');
  // Nincs modal (régi, beragadt HTML) → egyszerű megerősítés fallback,
  // NOW() küldés (null ISO); soha ne hajtsuk végre némán, ha a sofőr
  // nem hagyja jóvá.
  if (!m) {
    if (confirm((opts.title ? opts.title + '\n\n' : '') + (opts.msg || ''))) {
      if (onOk) onOk(null);
    }
    return;
  }
  var ico = document.getElementById('sofTimeIco');
  var ttl = document.getElementById('sofTimeTitle');
  var msg = document.getElementById('sofTimeMsg');
  var ok  = document.getElementById('sofTimeOkBtn');
  if (ico) ico.textContent = opts.ico || '⏱️';
  if (ttl) ttl.textContent = opts.title || '';
  if (msg) msg.textContent = opts.msg || '';
  if (ok) ok.textContent = opts.ok || t('sof.cfm.yes');
  // Input alap: az `opts.initialIso` ha megadva (pl. utólagos szerkesztés
  // már rögzített időpontra), különben a MAI idő (kényelmes, csak leokéz);
  // szerkeszthető, ha pár perccel korábban történt / lekésett. A `max` a
  // mostani + 1 óra (pár perces jövőt engedünk a szerver +2 perces
  // türelmén belül; a szerver úgyis validál).
  var inp = document.getElementById('sofTimeInput');
  if (inp) {
    var now = new Date();
    var initV = null;
    if (opts.initialIso) {
      try {
        var di = new Date(opts.initialIso);
        if (di instanceof Date && !isNaN(di.getTime())) initV = _sofLocalDatetimeValue(di);
      } catch (e) {}
    }
    inp.value = initV || _sofLocalDatetimeValue(now);
    var max = new Date(now.getTime() + 60 * 60 * 1000);
    inp.max = _sofLocalDatetimeValue(max);
  }
  _sofTimeCb = onOk || null;
  m.style.display = 'flex';
}

// ============================================================
// ÖSSZECSUKHATÓ SZEKCIÓK a menetlevél 2. lépésén
// ============================================================
// A kitöltő eddig egyetlen, ~10 szekciós hosszú lap volt: telefonon sok
// görgetés, és nem látszott, hol tart a sofőr. A három „nehéz" szekció
// (útvonal-pontok / tankolás / kiadás) mostantól összecsukható, és a
// fejlécben látszik a lényeg (hány sor, mennyi liter/összeg). Alapból az
// van nyitva, amiben VAN adat — üresen indulva minden csukva, így a lap
// rövid és átlátható.
//
// Pusztán megjelenítés: a mezők a DOM-ban maradnak (csak `display:none`),
// tehát minden gyűjtő/validáció/húzás változatlanul működik.
var WB_SECTIONS = [
  { key: 'puncte', head: 'sof.routePoints',  box: 'puncteContainer',     btns: ['addPunctRow'] },
  { key: 'alim',   head: 'sof.fuelings',     box: 'alimentariContainer', btns: ['addAlimRow', 'scanReceiptPick'] },
  { key: 'ach',    head: 'sof.expenses',     box: 'achizitiiContainer',  btns: ['addAchRow', 'scanReceiptPick'] }
];

function _wbSecCount(key) {
  var box = document.getElementById(
    key === 'puncte' ? 'puncteContainer' : key === 'alim' ? 'alimentariContainer' : 'achizitiiContainer');
  return box ? box.querySelectorAll('.dyn-row').length : 0;
}

// A fejléc jobb oldalára kerülő rövid összegzés („3 · 418 L").
function _wbSecSummary(key) {
  var n = _wbSecCount(key);
  if (!n) return '';
  if (key === 'alim') {
    var l = 0;
    document.querySelectorAll('#alimentariContainer .dyn-row').forEach(function (r) {
      l += parseFloat((r.querySelector('.alim-lit') || {}).value) || 0;
    });
    return n + (l ? ' · ' + l.toLocaleString(t('sof.locale'), { maximumFractionDigits: 0 }) + ' L' : '');
  }
  if (key === 'ach') {
    var sum = 0;
    document.querySelectorAll('#achizitiiContainer .dyn-row').forEach(function (r) {
      sum += parseFloat((r.querySelector('.ach-pret') || {}).value) || 0;
    });
    return n + (sum ? ' · ' + sum.toLocaleString(t('sof.locale'), { maximumFractionDigits: 0 }) + ' RON' : '');
  }
  return String(n);
}

function wbSecToggle(key) {
  var wrap = document.getElementById('wbsec-' + key);
  if (!wrap) return;
  var open = !wrap.classList.contains('collapsed');
  wrap.classList.toggle('collapsed', open);
  var head = document.getElementById('wbsech-' + key);
  if (head) {
    var car = head.querySelector('.wbsec-caret');
    if (car) car.textContent = open ? '▸' : '▾';
  }
}

function wbSecRefresh() {
  WB_SECTIONS.forEach(function (s) {
    var el = document.getElementById('wbsecn-' + s.key);
    if (el) el.textContent = _wbSecSummary(s.key);
  });
}

// A meglévő `.section-head` + konténer + gombok köré épít egy burkot.
// Idempotens: másodszori hívásra csak frissít.
function wbSecInit() {
  WB_SECTIONS.forEach(function (s) {
    if (document.getElementById('wbsec-' + s.key)) return;      // már megvan
    var box = document.getElementById(s.box);
    if (!box) return;
    // A szekció feje: a konténer ELŐTTI `.section-head`.
    var head = box.previousElementSibling;
    while (head && !head.classList.contains('section-head')) head = head.previousElementSibling;
    if (!head) return;
    // A szekcióhoz tartozó elemek: a KONTÉNER + az utána közvetlenül
    // következő „➕ hozzáadás" / scan gomb-sorok. SZÁNDÉKOSAN nem a
    // „következő section-head-ig" szabály: az utolsó szekció (Kiadások)
    // után nincs több fejléc, így az elnyelné a megjegyzés-mezőt és a
    // BEKÜLDÉS-GOMBOKAT is — csukott állapotban eltűnnének.
    var members = [box];
    var n = box.nextElementSibling;
    while (n && !n.classList.contains('section-head')) {
      var isAddRow = n.classList.contains('add-row-btn') || n.querySelector('.add-row-btn');
      if (!isAddRow) break;
      members.push(n);
      n = n.nextElementSibling;
    }

    var wrap = document.createElement('div');
    wrap.className = 'wbsec-body';
    wrap.id = 'wbsec-' + s.key;
    head.parentNode.insertBefore(wrap, members[0]);
    members.forEach(function (m) { wrap.appendChild(m); });

    // A fejlécet kattinthatóvá tesszük (a meglévő data-i18n szöveg marad).
    head.id = 'wbsech-' + s.key;
    head.classList.add('wbsec-head');
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    var badge = document.createElement('span');
    badge.className = 'wbsec-count';
    badge.id = 'wbsecn-' + s.key;
    head.appendChild(badge);
    var caret = document.createElement('span');
    caret.className = 'wbsec-caret';
    caret.textContent = '▾';
    head.appendChild(caret);
    head.addEventListener('click', function () { wbSecToggle(s.key); });
    head.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wbSecToggle(s.key); }
    });

    // Alapállapot: ami üres, az csukva (rövid, átlátható lap).
    if (!_wbSecCount(s.key)) wbSecToggle(s.key);
  });
  wbSecRefresh();
}

// ============================================================
// HELYSZÍN-JAVASLATOK (a cég korábbi menetleveleiből)
// ============================================================
// A sofőr a helyszín/termék mezőket vezetés után, egy kézzel gépeli. A
// cég eddigi menetleveleibe MÁR beírt értékeket felkínáljuk natív
// `<datalist>`-tel (nincs saját legördülő-motor → nem ütközik a sorok
// húzásos átrendezésével, és mobilon a natív javaslat-sáv jelenik meg).
// Egyszer töltjük be, a menetlevél 2. lépésének megnyitásakor.
var _sugCache = null;

function sugLoad() {
  if (_sugCache) { sugRender(); return; }
  fetch('/api/execute', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getFuvarlevelFieldSuggestions' })
  })
    .then(function (r) { return r.json(); })
    .then(function (d) { _sugCache = (d && d.result) || {}; sugRender(); })
    .catch(function () { _sugCache = {}; });
}

// A datalist-eket egyszer építjük fel a body végén; az input-ok `list`
// attribútummal hivatkoznak rájuk (a dinamikus sorok is, létrehozáskor).
function sugRender() {
  var s = _sugCache || {};
  // A handler LAPOS kulcsokat ad (punct_loc / alim_loc / ach_loc / ach_produs).
  var sets = {
    'sug-punct-loc': s.punct_loc || [],
    'sug-alim-loc':  s.alim_loc  || [],
    'sug-ach-loc':   s.ach_loc   || [],
    'sug-ach-prod':  s.ach_produs || []
  };
  Object.keys(sets).forEach(function (id) {
    var dl = document.getElementById(id);
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = id;
      document.body.appendChild(dl);
    }
    var vals = (sets[id] || []).filter(Boolean).slice(0, 300);
    dl.innerHTML = vals.map(function (v) { return '<option value="' + esc(v) + '">'; }).join('');
  });
}

// ============================================================
// ÉLŐ KM / ÜZEMANYAG ELLENŐRZÉS (a menetlevél 2. lépésén)
// ============================================================
// A szerver eddig csendben `Math.max(0, kmSf - kmInc)`-et számolt: egy
// elgépelt záró km (kisebb a kezdőnél) 0 km + 0 fogyasztás lett, és senki
// nem szólt. Itt a sofőr AZONNAL látja a megtett km-t és a becsült
// fogyasztást, mielőtt beküldené.
var FUEL_MIN_L100 = 20, FUEL_MAX_L100 = 38;   // a reális sáv (mint a havi statisztikánál)
var KM_SANITY_MAX = 5000;                     // ennél több km egy menetlevélen gyanús

// A jelenlegi űrlap km/üzemanyag adatai + a származtatott értékek.
function _kmFuelState() {
  var num = function (id) { var el = document.getElementById(id); return parseFloat(el && el.value) || 0; };
  var kmInc = num('fKmInc'), kmSf = num('fKmSf');
  var cantInc = num('fCantInc'), cantSf = num('fCantSf');
  var tankolt = 0;
  document.querySelectorAll('#alimentariContainer .dyn-row').forEach(function (row) {
    // AdBlue NEM üzemanyag a fogyasztás szempontjából
    var tip = (row.querySelector('.alim-tip') || {}).value;
    if (tip === 'AdBlue') return;
    tankolt += parseFloat((row.querySelector('.alim-lit') || {}).value) || 0;
  });
  var km = kmSf - kmInc;                       // SZÁNDÉKOSAN lehet negatív → ezt jelezzük
  var used = cantInc + tankolt - cantSf;
  var l100 = (km > 0 && used > 0) ? (used * 100 / km) : null;
  return { kmInc: kmInc, kmSf: kmSf, cantInc: cantInc, cantSf: cantSf,
           tankolt: tankolt, km: km, used: used, l100: l100 };
}

// A doboz újrarajzolása. `severity`: 'err' (blokkoló) > 'warn' > '' (rendben).
function updateKmFuelCheck() {
  if (typeof wbSecRefresh === 'function') { try { wbSecRefresh(); } catch (e) {} }
  var box = document.getElementById('kmFuelCheck');
  if (!box) return;
  var s = _kmFuelState();
  // Amíg nincs érdemi adat, ne zavarjuk a sofőrt.
  if (!s.kmInc && !s.kmSf && !s.cantInc && !s.cantSf && !s.tankolt) {
    box.style.display = 'none'; return;
  }
  var rows = [], sev = '';
  if (s.kmSf > 0 && s.km < 0) {
    sev = 'err';
    rows.push('<div class="km-check-row err">⚠️ ' + esc(t('sof.km.negative')) + '</div>');
  } else if (s.km > 0) {
    rows.push('<div class="km-check-row">🛣️ ' + esc(t('sof.km.driven')) + ': <b>' + s.km.toLocaleString(t('sof.locale')) + ' km</b></div>');
    if (s.km > KM_SANITY_MAX) {
      if (sev !== 'err') sev = 'warn';
      rows.push('<div class="km-check-row warn">⚠️ ' + esc(t('sof.km.tooMuch')) + '</div>');
    }
  }
  if (s.used < 0) {
    if (sev !== 'err') sev = 'warn';
    rows.push('<div class="km-check-row warn">⚠️ ' + esc(t('sof.km.fuelImpossible')) + '</div>');
  } else if (s.l100 != null) {
    var val = s.l100.toFixed(1);
    var out = (s.l100 < FUEL_MIN_L100 || s.l100 > FUEL_MAX_L100);
    if (out && sev !== 'err') sev = 'warn';
    rows.push('<div class="km-check-row' + (out ? ' warn' : '') + '">⛽ ' + esc(t('sof.km.consumption'))
      + ': <b>' + val + ' L/100km</b>' + (out ? ' — ' + esc(t('sof.km.outOfRange')) : '') + '</div>');
  }
  if (!rows.length) { box.style.display = 'none'; return; }
  box.className = 'km-check' + (sev ? ' ' + sev : '');
  box.innerHTML = rows.join('');
  box.style.display = 'block';
}

// ── KÖZÖS sor-gyűjtők ────────────────────────────────────────────────
// Egy helyen, mert három hívó használja őket (auto-piszkozat, telefonra
// mentés, beküldés). Korábban mindhárom SAJÁT másolattal dolgozott, és a
// `draftSave` verziója LEHAGYTA a `time` / `orderId` / `role` mezőket —
// így egyetlen billentyűleütés (600 ms auto-mentés) után elveszett a
// Plecare/Sosire ÓRÁJA (12:00-ra esett vissza → rossz diurna) és a
// fuvar-visszakötés (az `orders.incarcat_at`/`descarcat_at` nem frissült).
// Innentől mindhárom út UGYANEZT a függvényt hívja → nem tud elcsúszni.
function _collectPuncte() {
  var out = [];
  document.querySelectorAll('#puncteContainer .dyn-row').forEach(function (row) {
    var p = {
      tip:  (row.querySelector('.punct-tip')  || {}).value || '',
      loc:  (row.querySelector('.punct-loc')  || {}).value || '',
      data: (row.querySelector('.punct-data') || {}).value || '',
      time: (row.querySelector('.punct-time') || {}).value || ''
    };
    var oid  = row.getAttribute('data-order-id');
    var role = row.getAttribute('data-role');
    var stopId = row.getAttribute('data-stop-id');
    if (oid)  p.orderId = oid;
    if (role) p.role = role;
    if (stopId) p.stopId = stopId;
    out.push(p);
  });
  return out;
}
// Egy fuvar puncte-sorai a menetlevélhez. Multi-stop: minden még nem
// waybill-ezett stopot felveszünk (pickup → 'Încărcare' role='loading';
// delivery → 'Descărcare' role='unloading'), stopId-vel tag-elve. Ha nincs
// stops-tömb (nem-migrált fuvar), a legacy loc_incarcare/loc_descarcare +
// waybill_phase alapján esünk vissza a régi 1-1 pontos viselkedésre.
// Visszaadott alak: [[loc, tip, data (YYYY-MM-DD), opts], …]
//
// `filter` (opcionális): { byOrder: { orderId: { stopId: true, ... } } }
//   Ha meg van adva, a stops-ágban CSAK azokat a stopokat vesszük fel,
//   amelyeket a filter kifejezetten engedélyez. Használat: az
//   auto-kiválasztás (_autoCollectCompletedStops) csak az elvégzett
//   (done_at NOT NULL) állomásokat rakja fel; a többi (nyitott) stop nem
//   kerül a menetlevélre a Plecare pillanatában. A picker-alapú út
//   (`_applyPickerDiff`) filter nélkül hív → a régi teljes-stopos
//   viselkedést kapja (a sofőr kézzel dönt).
function _buildWaybillPuncteForOrder(o, filter) {
  var ymd = function (v) { return v ? String(v).slice(0, 10) : ''; };
  var stopMatchesFilter = function (s) {
    if (!filter || !filter.byOrder) return true;
    var m = filter.byOrder[o.id];
    return !!(m && m[s.id]);
  };
  var stops = Array.isArray(o && o.stops) ? o.stops : [];
  if (stops.length) {
    var pickups = stops.filter(function (s) { return s.kind === 'pickup'   && !s.waybilled_at && stopMatchesFilter(s); })
                      .sort(function (a, b) { return a.stop_index - b.stop_index; });
    var deliveries = stops.filter(function (s) { return s.kind === 'delivery' && !s.waybilled_at && stopMatchesFilter(s); })
                      .sort(function (a, b) { return a.stop_index - b.stop_index; });
    var out = [];
    pickups.forEach(function (s) {
      if (s.loc) out.push([s.loc, 'Încărcare', ymd(s.data) || ymd(o.data_incarcare),
                          { orderId: o.id, role: 'loading', stopId: s.id }]);
    });
    deliveries.forEach(function (s) {
      if (s.loc) out.push([s.loc, 'Descărcare', ymd(s.data) || ymd(o.data_descarcare),
                          { orderId: o.id, role: 'unloading', stopId: s.id }]);
    });
    return out;
  }
  // Legacy fallback ágon a filter nem érvényes (nincs stopId, amire szűrjünk).
  // Ha a hívó filter-el jött (auto-collect), és a fuvarnak nincs stopja,
  // csak akkor engedjük tovább, ha az egész fuvar szerepel a filterben.
  if (filter && filter.byOrder && !filter.byOrder[o.id]) return [];
  // Legacy fallback
  var phase = o.waybill_phase;
  var loadDate = ymd(o.data_incarcare);
  var unloadDate = ymd(o.data_descarcare);
  var res = [];
  if (phase === 'loading') {
    if (o.loc_incarcare) res.push([o.loc_incarcare, 'Încărcare', loadDate, { orderId: o.id, role: 'loading' }]);
  } else if (phase === 'unloading') {
    if (o.loc_descarcare) res.push([o.loc_descarcare, 'Descărcare', unloadDate, { orderId: o.id, role: 'unloading' }]);
  } else {
    if (o.loc_incarcare)  res.push([o.loc_incarcare,  'Încărcare',  loadDate,   { orderId: o.id, role: 'loading' }]);
    if (o.loc_descarcare) res.push([o.loc_descarcare, 'Descărcare', unloadDate, { orderId: o.id, role: 'unloading' }]);
  }
  return res;
}
// `numeric=true` → a számokat számmá alakítjuk (beküldés); egyébként a
// nyers string marad (piszkozat — a félig beírt érték se vesszen el).
function _collectAlim(numeric) {
  var num = function (v) { return numeric ? (parseFloat(v) || 0) : (v || '0'); };
  var out = [];
  document.querySelectorAll('#alimentariContainer .dyn-row').forEach(function (row) {
    out.push({
      loc:   (row.querySelector('.alim-loc')  || {}).value || '',
      data:  (row.querySelector('.alim-data') || {}).value || '',
      tip:   (row.querySelector('.alim-tip')  || {}).value || 'Motorină',
      litru: num((row.querySelector('.alim-lit')  || {}).value),
      km:    num((row.querySelector('.alim-km')   || {}).value),
      plata: (row.querySelector('.alim-plata')|| {}).value || 'Card',
      suma:  num((row.querySelector('.alim-suma') || {}).value)
    });
  });
  return out;
}
function _collectAch(numeric) {
  var num = function (v) { return numeric ? (parseFloat(v) || 0) : (v || '0'); };
  var out = [];
  document.querySelectorAll('#achizitiiContainer .dyn-row').forEach(function (row) {
    out.push({
      produs: (row.querySelector('.ach-prod') || {}).value || '',
      loc:    (row.querySelector('.ach-loc')  || {}).value || '',
      data:   (row.querySelector('.ach-data') || {}).value || '',
      pret:   num((row.querySelector('.ach-pret') || {}).value),
      plata:  (row.querySelector('.ach-plata')|| {}).value || 'Card'
    });
  });
  return out;
}

function draftSave() {
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(function() {
    var step2Visible = document.getElementById('fuvarStep2').style.display !== 'none';
    if (!step2Visible) return;

    var puncte     = _collectPuncte();
    var alimentari = _collectAlim(false);
    var achizitii  = _collectAch(false);

    stateSave({
      draft: {
        camion: document.getElementById('fCamion').value,
        remorca: document.getElementById('fRemorca').value,
        kmInc: document.getElementById('fKmInc').value,
        kmSf: document.getElementById('fKmSf').value,
        cantInc: document.getElementById('fCantInc').value,
        cantSf: document.getElementById('fCantSf').value,
        mentiuni: document.getElementById('fMentiuni').value,
        puncte: puncte,
        alimentari: alimentari,
        achizitii: achizitii,
        orderIds: _selectedOrderIds,
        summary: document.getElementById('selectedOrdersSummary').innerHTML
      }
    });
  }, 600);
}

function draftRestore(draft) {
  if (!draft) return;
  document.getElementById('fCamion').value = draft.camion || '';
  document.getElementById('fRemorca').value = draft.remorca || '';
  document.getElementById('fKmInc').value = draft.kmInc || '0';
  document.getElementById('fKmSf').value = draft.kmSf || '0';
  document.getElementById('fCantInc').value = draft.cantInc || '0';
  document.getElementById('fCantSf').value = draft.cantSf || '0';
  document.getElementById('fMentiuni').value = draft.mentiuni || '';

  // Útvonal pontok visszaállítása
  document.getElementById('puncteContainer').innerHTML = '';
  punctIdx = 0;
  (draft.puncte || []).forEach(function(p) {
    // Tag-eket is visszaadjuk (fuvar-visszakötés + Plecare/Sosire idő +
    // multi-stop stopId)
    addPunctRow(p.loc, p.tip, p.data, {
      orderId: p.orderId, role: p.role, stopId: p.stopId, time: p.time
    });
  });

  // Tankolások visszaállítása
  document.getElementById('alimentariContainer').innerHTML = '';
  alimIdx = 0;
  (draft.alimentari || []).forEach(function(a) {
    addAlimRow(a);
  });

  // Kiadások visszaállítása
  document.getElementById('achizitiiContainer').innerHTML = '';
  achIdx = 0;
  (draft.achizitii || []).forEach(function(a) {
    addAchRow(a);
  });

  // Kiválasztott fuvar ID-k és összesítő
  _selectedOrderIds = draft.orderIds || [];
  if (draft.summary) {
    document.getElementById('selectedOrdersSummary').innerHTML = draft.summary;
  }
  // Piszkozat-visszaállítás után újraszámoljuk az „Út időpontjait" a
  // (frissen visszaadott) Plecare/Sosire sorokból.
  if (typeof _syncTripTimesFromPuncte === 'function') _syncTripTimesFromPuncte();
}

function draftClear() {
  stateSave({ draft: null });
}

// ============================================================
//  HELYI (offline) MENETLEVÉL-PISZKOZATOK — a TELEFONON tárolva
//  localStorage-ban (a sessionStorage-os auto-draft PERZISZTENS párja).
//  A sofőr indulás előtt beír pár adatot, gombnyomásra elmenti a
//  telefonjára; az OFFLINE is látható a PWA-ban, és offline szerkeszthető.
//  Internet CSAK a beküldéshez kell.
// ============================================================
var LS_DRAFTS_KEY = 'vs_sofer_local_drafts';
var _curLocalDraftId = null;

// A közös JSON-storage helper (`_perDriverGetJson`/`_perDriverSetJson`)
// lentebb (a `_driverStoreKey`-vel együtt) definiált — mindkettő a
// bejelentkezett sofőr e-mail-jét fűzi a kulcshoz, így közös telefonon
// több sofőr külön „memoriát" tart. Visszafelé kompatibilis: első
// alkalommal az esetleges régi közös kulcs átvevődik fallback-ként.
function soferLoadLocalDrafts() { return _perDriverGetJson(LS_DRAFTS_KEY, []) || []; }
function soferStoreLocalDrafts(arr) { _perDriverSetJson(LS_DRAFTS_KEY, arr || []); }

// A teljes menetlevél-űrlap begyűjtése (a beküldött mezők szuperhalmaza).
function soferCollectFull() {
  var puncte     = _collectPuncte();
  var alimentari = _collectAlim(false);
  var achizitii  = _collectAch(false);
  function gv(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  return {
    fisa: gv('fFisa'),
    camion: gv('fCamion'), remorca: gv('fRemorca'),
    kmInc: gv('fKmInc'), kmSf: gv('fKmSf'),
    cantInc: gv('fCantInc'), cantSf: gv('fCantSf'),
    mentiuni: gv('fMentiuni'),
    indulasDt: gv('fIndulasDt'), erkezesDt: gv('fErkezesDt'),
    // `hataratok` NINCS a piszkozatban: a határátlépés a főoldali gombokból
    // (`border_crossings`) származik, a szerver a beküldéskor gyűjti be.
    puncte: puncte, alimentari: alimentari, achizitii: achizitii,
    orderIds: _selectedOrderIds,
    summary: (document.getElementById('selectedOrdersSummary') || {}).innerHTML || ''
  };
}

// A teljes űrlap visszaállítása egy elmentett adatból (a step2-n).
function soferApplyFull(data) {
  if (!data) return;
  draftRestore(data);   // közös mezők + puncte/alimentari/achizitii + orderIds/summary
  function sv(id, v) { var el = document.getElementById(id); if (el) el.value = (v == null ? '' : v); }
  sv('fFisa', data.fisa);
  sv('fIndulasDt', data.indulasDt);
  sv('fErkezesDt', data.erkezesDt);
  // A határátlépéseket nem a piszkozat hordozza (a szerver gyűjti a
  // GPS-rögzítésekből) — csak az előnézetet frissítjük az új ablakra.
  if (typeof updateDiurnaPreview === 'function') updateDiurnaPreview();
}

// A jelenlegi űrlap mentése a telefonra (helyi piszkozat). silent=true → nincs toast.
function saveLocalDraft(silent) {
  var data = soferCollectFull();
  var arr = soferLoadLocalDrafts();
  var label = (data.camion || '').trim();
  if (data.puncte && data.puncte[0] && data.puncte[0].loc) label += (label ? ' · ' : '') + data.puncte[0].loc;
  if (!label) label = t('sof.localDraftUnnamed');
  var now = Date.now();
  var existing = _curLocalDraftId ? arr.filter(function (d) { return d.id === _curLocalDraftId; })[0] : null;
  if (existing) {
    existing.label = label; existing.savedAt = now; existing.data = data;
  } else {
    _curLocalDraftId = 'd' + now;
    arr.unshift({ id: _curLocalDraftId, label: label, savedAt: now, data: data });
  }
  soferStoreLocalDrafts(arr);
  renderLocalDrafts();
  if (!silent) toast(t('sof.localDraftSaved'), 'ok');
}

// Egy elmentett helyi piszkozat betöltése a szerkesztőbe (offline is működik).
function loadLocalDraft(id) {
  var d = soferLoadLocalDrafts().filter(function (x) { return x.id === id; })[0];
  if (!d) return;
  _curLocalDraftId = id;
  goSec('fuvar');
  // A mentett adatból töltünk (nem a kiválasztott fuvarokból), ezért közvetlenül
  // a 2. lépést mutatjuk, majd alkalmazzuk a mentett menetlevél-adatot.
  document.getElementById('fuvarStep1').style.display = 'none';
  document.getElementById('fuvarStep2').style.display = 'block';
  soferApplyFull(d.data);
  if (typeof attachDraftListeners === 'function') attachDraftListeners();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// Helyi piszkozat törlése (megerősítéssel).
function deleteLocalDraft(id) {
  if (!confirm(t('sof.localDraftConfirmDel'))) return;
  var arr = soferLoadLocalDrafts().filter(function (x) { return x.id !== id; });
  soferStoreLocalDrafts(arr);
  if (_curLocalDraftId === id) _curLocalDraftId = null;
  renderLocalDrafts();
  toast(t('sof.localDraftDeleted'), '');
}

// ── „Van egy megkezdett menetleveled" folytatás-sáv ──────────────────
// A piszkozat mostantól tartósan (localStorage, per-sofőr) él, tehát
// túléli az app-kilövést. De ha a sofőr nem a menetlevél 2. lépésén volt,
// amikor az app leállt, az automatikus visszaállítás nem indul — így nem
// tudná, hogy a munkája megvan. Ez a sáv megmutatja és egy koppintással
// folytathatóvá teszi.
function _draftHasContent(dr) {
  if (!dr) return false;
  if ((dr.puncte || []).length || (dr.alimentari || []).length || (dr.achizitii || []).length) return true;
  return !!(dr.camion || dr.remorca || dr.mentiuni
    || (parseFloat(dr.kmInc) || 0) || (parseFloat(dr.kmSf) || 0));
}

function renderDraftResume() {
  var box = document.getElementById('draftResumeBox');
  if (!box) return;
  // A 2. lépésen már a piszkozatban vagyunk — nincs mit felajánlani.
  var step2 = document.getElementById('fuvarStep2');
  if (step2 && step2.style.display !== 'none') { box.style.display = 'none'; return; }
  var dr = (stateGet() || {}).draft;
  if (!_draftHasContent(dr)) { box.style.display = 'none'; return; }

  var bits = [];
  if ((dr.puncte || []).length)     bits.push('📍 ' + dr.puncte.length);
  if ((dr.alimentari || []).length) bits.push('⛽ ' + dr.alimentari.length);
  if ((dr.achizitii || []).length)  bits.push('🛒 ' + dr.achizitii.length);
  var km = (parseFloat(dr.kmSf) || 0) - (parseFloat(dr.kmInc) || 0);
  if (km > 0) bits.push('🛣️ ' + km.toLocaleString(t('sof.locale')) + ' km');

  box.innerHTML =
    '<div class="resume-title">📄 ' + esc(t('sof.resume.title')) + '</div>'
    + '<div class="resume-sub">' + esc(dr.camion || '') + (bits.length ? (dr.camion ? ' · ' : '') + bits.join(' · ') : '') + '</div>'
    + '<div class="resume-actions">'
    + '<button type="button" class="resume-go" onclick="resumeDraft()">' + esc(t('sof.resume.continue')) + '</button>'
    + '<button type="button" class="resume-drop" onclick="discardDraft()">' + esc(t('sof.resume.discard')) + '</button>'
    + '</div>';
  box.style.display = 'block';
}

// Folytatás: a 2. lépés megnyitása a TELJES mentett tartalommal.
function resumeDraft() {
  var dr = (stateGet() || {}).draft;
  if (!dr) return;
  document.getElementById('fuvarStep1').style.display = 'none';
  document.getElementById('fuvarStep2').style.display = 'block';
  draftRestore(dr);
  attachDraftListeners();
  if (typeof sugLoad === 'function')   { try { sugLoad(); }   catch (e) {} }
  if (typeof wbSecInit === 'function') { try { wbSecInit(); } catch (e) {} }
  stateSave({ sec: 'fuvar', fuvarStep: 2 });
  renderDraftResume();
  window.scrollTo({ top: 0, behavior: 'instant' });
  toast(t('sof.draftRestoredLong'), 'ok');
}

function discardDraft() {
  if (!confirm(t('sof.resume.confirmDiscard'))) return;
  // Törlés előtt a tankolás/vásárlás sorokat átmentjük az orphan binbe,
  // hogy a következő menetlevél kezdésekor a popup felajánlja őket
  // (a sofőr által beírt/bon-alapú adat így soha nem vész el egy törléstől).
  try {
    var dr = (stateGet() || {}).draft;
    if (dr) orphanSaveFromDraft(dr);
  } catch (_) {}
  draftClear();
  renderDraftResume();
  toast(t('sof.resume.discarded'), '');
}

// A mentett helyi piszkozatok listája (a menetlevél 1. lépésén; offline is látszik).
function renderLocalDrafts() {
  var box = document.getElementById('localDraftsBox');
  if (!box) return;
  var arr = soferLoadLocalDrafts();
  if (!arr.length) {
    box.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:6px 2px;">' + esc(t('sof.localDraftNone')) + '</div>';
    return;
  }
  box.innerHTML = arr.map(function (d) {
    var when = '';
    try { when = new Date(d.savedAt).toLocaleString(); } catch (e) {}
    // Tartalom-összegzés: a puszta „rendszám · első helyszín" alapján nem
    // lehetett eldönteni, melyik piszkozatot kell megnyitni.
    var dd = d.data || {};
    var bits = [];
    var nP = (dd.puncte || []).length, nA = (dd.alimentari || []).length, nC = (dd.achizitii || []).length;
    if (nP) bits.push('📍 ' + nP);
    if (nA) bits.push('⛽ ' + nA);
    if (nC) bits.push('🛒 ' + nC);
    var kmDiff = (parseFloat(dd.kmSf) || 0) - (parseFloat(dd.kmInc) || 0);
    if (kmDiff > 0) bits.push('🛣️ ' + kmDiff.toLocaleString(t('sof.locale')) + ' km');
    var pendBadge = d.pendingSubmit
      ? '<span class="draft-pending">⏳ ' + esc(t('sof.outbox.waiting')) + '</span>' : '';
    return '<div class="local-draft-item" style="display:flex;align-items:center;gap:8px;justify-content:space-between;'
      + 'background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.25);border-radius:10px;padding:10px 12px;margin-bottom:8px;">'
      + '<div style="min-width:0;flex:1;" onclick="loadLocalDraft(\'' + d.id + '\')">'
      + '<div style="font-weight:700;font-size:14px;color:var(--soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📄 ' + esc(d.label) + pendBadge + '</div>'
      + '<div style="font-size:11px;color:var(--muted);">' + esc(when) + (bits.length ? ' · ' + bits.join(' · ') : '') + '</div></div>'
      + '<button class="btn-mini" onclick="loadLocalDraft(\'' + d.id + '\')" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(59,130,246,0.4);background:rgba(59,130,246,0.12);color:#3b82f6;font-weight:700;">'
      + esc(t('sof.localDraftLoad')) + '</button>'
      + '<button class="btn-mini" onclick="deleteLocalDraft(\'' + d.id + '\')" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(239,68,68,0.35);background:rgba(239,68,68,0.1);color:#ef4444;">🗑</button>'
      + '</div>';
  }).join('');
}

// Oldal bezárás/frissítés előtt azonnal mentünk
window.addEventListener('beforeunload', function() {
  var step2Visible = document.getElementById('fuvarStep2').style.display !== 'none';
  if (step2Visible) draftSave();
});

// ============================================================
// TOAST
// ============================================================
function toast(m, k) {
  var e = document.createElement('div');
  e.className = 'toast ' + (k || '');
  e.textContent = m;
  document.getElementById('toasts').appendChild(e);
  setTimeout(function() { e.remove(); }, 3000);
}

// ============================================================
// NAVIGÁCIÓ
// ============================================================
var sections = ['dash','border','fuvar','docs','chat'];

function goSec(id) {
  sections.forEach(function(s) {
    document.getElementById('sec-' + s).classList.add('hidden');
  });
  var next = document.getElementById('sec-' + id);
  if (!next) return;
  next.classList.remove('hidden');
  next.classList.add('sec-entering');
  setTimeout(function() { next.classList.remove('sec-entering'); }, 220);
  next.scrollTop = 0;            // a panel belül görget (nem a body) — tetejére
  window.scrollTo({ top: 0, behavior: 'instant' });

  // A 🐛 FAB (jobb alsó sarok) ütközne a chat küldés gombbal → chat nézetben elrejtjük
  var fab = document.getElementById('bugFab');
  if (fab) fab.style.display = (id === 'chat') ? 'none' : 'flex';

  stateSave({ sec: id });
  if (id === 'border') loadBorderLog();
  if (id === 'fuvar')  {
    loadSoferOrders();
    if (typeof renderLocalDrafts === 'function') renderLocalDrafts();
    if (typeof renderDraftResume === 'function') renderDraftResume();
  }
  if (id === 'docs')   loadDocOrderOptions();
  // A bon-várólista mindkét helyen látszik (főoldal + menetlevél 1. lépés)
  if (id === 'dash' || id === 'fuvar') { if (typeof renderPendingReceipts === 'function') renderPendingReceipts(); }
}

// ============================================================
// TELEFONOS „VISSZA" GOMB — appon belüli visszalépés (ne jelentkezzen ki)
// ============================================================
// A rendszer-vissza gombot elkapjuk: (1) menetlevél 2. lépésén → vissza az 1.
// lépésre; (2) nyitott modal → bezárás; (3) al-oldalon → vissza a főoldalra;
// (4) a főoldalon DUPLA visszával lép ki (a session megmarad). Így egyetlen
// vissza-nyomás nem lép ki / nem jelentkeztet ki, csak visszanavigál.
(function initSoferBackButton(){
  var _backTs = 0, _exiting = false;
  function repush(){ try { history.pushState({ vsSofer: true }, ''); } catch(e){} }
  try { history.pushState({ vsSofer: true }, ''); } catch(e){}   // kezdő csapda-állapot
  window.addEventListener('popstate', function(){
    if (_exiting) return;
    // 1) Menetlevél 2. lépés → vissza az 1. lépésre
    var step2 = document.getElementById('fuvarStep2');
    var fuvarSec = document.getElementById('sec-fuvar');
    if (fuvarSec && !fuvarSec.classList.contains('hidden') && step2 && step2.style.display !== 'none') {
      try { fuvarBackStep1(); } catch(e){}
      repush(); return;
    }
    // 2) Nyitott modal → bezárás (áru-leadás / hibajelentés)
    var ho = document.getElementById('hoModal'), bug = document.getElementById('bugModal');
    if (ho && ho.style.display === 'flex')  { try { closeHandover(); }  catch(e){} repush(); return; }
    if (bug && bug.style.display === 'flex') { try { closeBugReport(); } catch(e){} repush(); return; }
    // 3) Al-oldalon → vissza a főoldalra
    var active = 'dash';
    ['dash','border','fuvar','docs','chat'].forEach(function(s){
      var el = document.getElementById('sec-'+s);
      if (el && !el.classList.contains('hidden')) active = s;
    });
    if (active !== 'dash') { try { goSec('dash'); } catch(e){} repush(); return; }
    // 4) Főoldalon: dupla-vissza (2 mp-en belül) → kilépés; egyébként jelzés + maradás
    var now = Date.now();
    if (now - _backTs < 2000) { _exiting = true; try { history.back(); } catch(e){} return; }
    _backTs = now;
    try { toast(t('sof.backExitHint'), ''); } catch(e){}
    repush();
  });
})();

// ============================================================
// HATÁRÁTLÉPÉS
// ============================================================
// Megerősítés a rögzítés ELŐTT (mint az állomás-gomboknál): a határátlépés a
// sofőr felületéről NEM vonható vissza, és a menetlevél diurnáját (extern/intern
// napok) KÖZVETLENÜL ebből számoljuk (`lib/tripCrossings.js` + `calculateDiurna`)
// — egy félrenyomott BE/KI a napidíjat rontja el. A kérdés az irányt nevezi meg.
function sendBorderCross(tip, tara) {
  // ── SoferTour demó-intercept: a bemutató alatt a határátlépés-gombot
  //    csak vizuálisan próbáljuk — semmit nem küldünk a szervernek.
  if (window.SoferTour && window.SoferTour.demoIntercept &&
      window.SoferTour.demoIntercept('border', (tip === 'Intrare' ? 'RO BE' : 'RO KI'))) {
    return;
  }
  var act = (tip === 'Intrare') ? t('sof.crossIn') : t('sof.crossOut');
  // Idő-picker modal — a diurna-ablak szempontjából a beírt óra:perc
  // (BE/KI) DÖNTŐ, ezért engedjük a sofőrnek utólag pótolni is.
  sofTimeConfirm({
    ico: '🛂',
    title: t('sof.crossConfirmTitle', { act: act }),
    msg: t('sof.crossConfirmMsg'),
    ok: act
  }, function (atIso) { _sendBorderCrossGo(tip, tara, atIso); });
}
function _sendBorderCrossGo(tip, tara, atIso) {
  var statusEl = document.getElementById('gpsStatus');
  statusEl.innerHTML = '<div class="gps-badge"><span class="spinner"></span> ' + t('sof.gpsFetch') + '</div>';

  function doSend(lat, lng) {
    var payload = { tip: tip, tara: tara, gps_lat: lat, gps_lng: lng,
      locatie: (lat != null && lng != null) ? (lat.toFixed(4) + ', ' + lng.toFixed(4)) : null };
    if (atIso) payload.at = atIso;
    fetch('/api/border-cross', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.success) {
        toast(tip === 'Intrare' ? t('sof.roInSaved') : t('sof.roOutSaved'), 'ok');
        statusEl.innerHTML = lat
          ? '<div class="gps-badge">📍 GPS: ' + lat.toFixed(4) + ', ' + lng.toFixed(4) + '</div>'
          : '<div class="gps-badge">' + t('sof.savedNoGps') + '</div>';
        loadBorderLog();
      } else {
        toast(t('common.error') + ': ' + (d.err || t('sof.unknown')), 'err');
        statusEl.innerHTML = '';
      }
    });
  }

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      function(pos) { doSend(pos.coords.latitude, pos.coords.longitude); },
      function() { doSend(null, null); },
      { timeout: 8000 }
    );
  } else {
    doSend(null, null);
  }
}

function loadBorderLog() {
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getBorderLogs' }) })
  .then(function(r) { return r.json(); }).then(function(d) {
    var list = d.result || [];
    var el = document.getElementById('borderLogList');
    if (!list.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;">' + t('sof.noCross') + '</div>'; return; }
    el.innerHTML = list.slice(0, 20).map(function(l) {
      var dt = l.created_at ? new Date(l.created_at).toLocaleString(t('sof.locale')) : '—';
      // A `locatie` DB-ből jön (a sofőr saját beküldése), ezért escape-elni
      // kell — különben egy rosszindulatú `/api/border-cross` hívás tárolt
      // XSS-t okozna a saját fuvarnaplójában (és bárkinél, aki a listát
      // megnyitja).
      return '<div class="border-log-item">'
        + '<strong>' + (l.tip === 'Intrare' ? t('sof.crossIn') : t('sof.crossOut')) + '</strong>'
        + ' — ' + esc(dt)
        + (l.locatie ? '<br><span style="font-size:11px;color:var(--muted);">📍 ' + esc(l.locatie) + '</span>' : '')
        + '</div>';
    }).join('');
  });
}

// ============================================================
// MENETLEVÉL — fuvar kiválasztás
// ============================================================
var _soferOrdersCache = [];
var _selectedOrderIds = [];

function loadSoferOrders() {
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getMySoferOrders' }) })
  .then(function(r) { return r.json(); }).then(function(d) {
    // Minden kiosztott fuvar, DE amiről már mentett menetlevél készült, az a
    // mentéstől számított 3 nap után kiesik (waybill_visible — szerver számolja).
    // Defenzív: ha a mező hiányzik (pl. régi, újra nem indított szerver), MUTASSUK
    // a fuvart (csak az explicit false rejt) — így nem tűnnek el a fuvarok.
    _soferOrdersCache = (d.result || []).filter(function(o) { return o.waybill_visible !== false; });
    var el = document.getElementById('soferOrderList');
    if (!_soferOrdersCache.length) {
      el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:13px;">' + t('sof.noWaybillOrders') + '</div>';
      return;
    }
    el.innerHTML = _soferOrdersCache.map(function(o) {
      var checked = _selectedOrderIds.indexOf(o.id) !== -1;
      var phaseBadge = '';
      if (o.waybill_phase === 'loading') {
        phaseBadge = ' <span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(34,197,94,0.2);color:#4ade80;">📤 ' + t('sof.phaseLoading') + '</span>';
      } else if (o.waybill_phase === 'unloading') {
        phaseBadge = ' <span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(99,102,241,0.25);color:#a5b4fc;">📥 ' + t('sof.phaseUnloading') + '</span>';
      }
      // Olvasható formátum (mint mindenhol a sofőr felületen): felrakás
      // dátum · cég · város  →  lerakás dátum · város · cég. A belső
      // CMD-azonosítót SEHOL nem mutatjuk (a sofőr felé zajt visz).
      var _loadDay   = fmtFuvarDay(o.data_incarcare)   || '';
      var _unloadDay = fmtFuvarDay(o.data_descarcare)  || '';
      var _loadCity  = _cityOf(o.loc_incarcare)   || (o.loc_incarcare  || '—');
      var _unloadCity= _cityOf(o.loc_descarcare)  || (o.loc_descarcare || '—');
      var _lFirma = (o.firma_incarcare  || '').trim();
      var _dFirma = (o.firma_descarcare || '').trim();
      var _pick = [(_loadDay?'📅 '+_loadDay:''), (_lFirma?'🏢 '+_lFirma:''), '📍 '+_loadCity].filter(Boolean).join(' · ');
      var _drop = [(_unloadDay?'📅 '+_unloadDay:''), '📍 '+_unloadCity, (_dFirma?'🏢 '+_dFirma:'')].filter(Boolean).join(' · ');
      return '<label style="display:flex;align-items:flex-start;gap:12px;background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:10px;cursor:pointer;">'
        + '<input type="checkbox" value="' + esc(o.id) + '" ' + (checked ? 'checked' : '') + ' onchange="toggleOrderSel(this)" style="margin-top:3px;width:18px;height:18px;accent-color:#3b82f6;flex-shrink:0;">'
        + '<div>'
        + '<div style="font-weight:700;font-size:13px;color:#fff;">' + esc(_pick) + '</div>'
        + '<div style="font-size:12px;color:var(--soft);margin-top:2px;">↓ ' + esc(_drop) + '</div>'
        + '<div style="margin-top:4px;"><span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(255,255,255,0.1);">' + esc(o.status||'—') + '</span>' + phaseBadge + '</div>'
        + (o.rendszam_camion ? '<div style="font-size:11px;color:var(--muted);margin-top:2px;">🚛 ' + esc(o.rendszam_camion) + (o.rendszam_remorca ? ' / ' + esc(o.rendszam_remorca) : '') + '</div>' : '')
        + '</div></label>';
    }).join('');
  });
}

function toggleOrderSel(cb) {
  var id = cb.value;
  if (cb.checked) {
    if (_selectedOrderIds.indexOf(id) === -1) _selectedOrderIds.push(id);
  } else {
    _selectedOrderIds = _selectedOrderIds.filter(function(x) { return x !== id; });
  }
}

// EGYETLEN menetlevél-létrehozó belépési pont (a korábbi „Tovább →
// kitöltés" + „Menetlevél fuvar nélkül" gombok egyesítve): amelyik fuvar
// be van pipálva, az bekerül; ha egy sincs, fuvar nélküli menetlevél
// készül (a kézi km/rendszám/pont adatokból; a szerver üres order_ids-t
// elfogad, a statisztika a sofőr e-mailjéhez kötődik).
//
// Első lépésként MINDIG rákérdez az INDULÁSI helyre (Plecare) — a válasz
// egy `Plecare` sor lesz a puncte-ban (helyszín kötelező, dátum kötelező,
// óra+perc opcionális). Ha van már mentett/piszkozat Plecare, kihagyja a
// dialógust. Alap: „Garaj-Arcus" (localStorage-ban memoriál).
// EGYETLEN menetlevél-létrehozó belépési pont — új folyamat:
//   1. Ha VAN mentett piszkozat → dialog: „Folytatjuk vagy töröljük?"
//        FOLYTAT: rögtön a 2. lépésbe ugrunk (resumeDraft), majd a picker
//                 megnyílik add/remove módban — a már bent lévő fuvarok
//                 pre-checked, a sofőr hozzáadhat/eltávolíthat.
//        TÖRÖL:   piszkozat elvetve, üresen indulunk (mintha nem lett
//                 volna mentett) → Plecare-dialog → picker (fresh).
//   2. Ha NINCS piszkozat → Plecare-dialog → picker (fresh) → step2.
//
// A picker csak akkor jelenik meg, ha tényleg dönteni kell mit rakjunk a
// menetlevélre — az 1. lépés kezdőképernyője már NEM tartalmazza a
// fuvar-listát. A picker forrása a `_soferOrdersCache` (getMySoferOrders,
// waybill_visible=true). Kijelölés nélkül is folytat, DE lezárni csak
// akkor lehet, ha nincs olyan Finalizat fuvar, amelynek a `finalized_at`-je
// a menetlevél indulása UTÁN van, és kimaradt (`_validateNoLeftoverOrders`).
var _pendingPlecare = null;
// Auto-collect (2026-08-21): a fresh menetlevél Plecare után NEM a pickert
// nyitja, hanem automatikusan begyűjti azokat a stopokat, amiket a sofőr
// már elvégzett (done_at NOT NULL) és még nincs waybill-ezve — a Plecare
// dátumától számítva. Az `_autoStopFilter` a fuvarStep2-nek adja át, hogy
// a `_buildWaybillPuncteForOrder` csak ezeket a stopokat rakja fel; az
// ugyanahhoz a fuvarhoz tartozó, még NYITOTT stopok nem szennyezik be
// a menetlevelet. Picker-alapú add/remove (fuvarPickAgain) törli a filter-t,
// hogy a sofőr kézi választása pontosan érvényesüljön.
var _autoStopFilter = null;
function fuvarCreate() {
  var st = stateGet() || {};
  if (_draftHasContent(st.draft)) {
    _draftContinueOrDelete(function (choice) {
      if (choice === 'continue') _continueSavedDraft();
      else if (choice === 'delete') {
        // Törlés előtt a tankolás/vásárlás sorokat átmentjük az orphan
        // binbe — a következő menetlevél kezdésekor a popup felajánlja
        // hozzáadásra (a sofőr által beírt/bon-alapú adat nem vész el).
        try { orphanSaveFromDraft(st.draft); } catch (_) {}
        draftClear();
        renderDraftResume();
        _startFreshWaybill();
      }
      // 'cancel' → nem csinálunk semmit, marad az 1. lépésen
    });
    return;
  }
  _startFreshWaybill();
}
// „Folytat / Töröl / Mégse" dialog. Natív confirm-lánc: első koppintás
// eldönti (folytat vagy nem); ha nem, MÁSODIK koppintás dönti el, hogy
// tényleg töröl vagy csak mégse. Ez visszavonhatatlan műveletnél a
// legszigorúbb: két külön koppintás kell a piszkozat eldobásához.
function _draftContinueOrDelete(cb) {
  var wantContinue = confirm(t('sof.draftCont.ask'));
  if (wantContinue) { cb('continue'); return; }
  var wantDelete = confirm(t('sof.draftCont.deleteConfirm'));
  cb(wantDelete ? 'delete' : 'cancel');
}
function _startFreshWaybill() {
  _selectedOrderIds = [];
  _autoStopFilter = null;
  wbLocDialog('start', function (res) {
    if (!res) return;                // Mégse — marad az 1. lépésen
    _pendingPlecare = res;           // fuvarStep2 innen olvassa
    // AUTO-COLLECT: nem nyitunk pickert. Begyűjtjük az összes már
    // elvégzett (done_at NOT NULL) és még nem waybill-ezett stopot a
    // Plecare pillanatától; ebből építjük a `_selectedOrderIds`-t és
    // az `_autoStopFilter`-t, majd egyenesen step2-re lépünk.
    var proceed = function () {
      _autoCollectCompletedStops();
      var added = _selectedOrderIds.length;
      // Popup: van korábban scannelt / árva tankolás-vásárlás sor?
      // A `openPendingAddModal` a kiválasztottakat a `_pendingAddRows`-ba
      // teszi, amit a `fuvarStep2` az alim/ach konténerbe olvas.
      openPendingAddModal(function () {
        fuvarStep2(true);
        if (added) {
          setTimeout(function () { toast(t('sof.auto.added', { n: added }), 'ok'); }, 100);
        } else {
          setTimeout(function () { toast(t('sof.auto.empty'), 'info'); }, 100);
        }
      });
    };
    if (!_soferOrdersCache.length) {
      fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ functionName: 'getMySoferOrders' }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        _soferOrdersCache = (d.result || []).filter(function (o) { return o.waybill_visible !== false; });
        proceed();
      })
      .catch(function () { proceed(); });
    } else {
      proceed();
    }
  });
}

// A menetlevél kezdésekor felajánljuk az orphan bin + a ready-státuszú
// scannelt bonok hozzáadását az új menetlevélhez. A sofőr pipálja, mi
// kerüljön be. Kihagyáskor a tételek a helyükön maradnak (a beküldés
// előtt még egyszer szólunk, ha date-ben belelógnak az útba).
//
//  cb() — hívjuk mindenképpen a folytatás előtt (popup zárult).
//
// A kiválasztott sorokat a `_pendingAddRows` globális változóba tesszük;
// a `fuvarStep2` az alim/ach konténerek kiürítése UTÁN olvassa be.
var _pendingAddRows = null;   // { alim: [], ach: [] } vagy null

// A ready-státuszú scannelt bon a queue-ból alim/ach sorrá konvertálva.
function _receiptToRow(it) {
  var f = (it && it.fields) || {};
  var today = (typeof _todayLocalDate === 'function') ? _todayLocalDate() : '';
  var kind = it.kind || (f.kind === 'fuel' ? 'fuel' : 'purchase');
  if (kind === 'fuel') {
    return {
      _rid: it.id, _rk: 'fuel',
      loc:   f.loc  || '',
      data:  f.data || today,
      tip:   (f.tip === 'AdBlue' ? 'AdBlue' : 'Motorină'),
      litru: (f.litru != null ? String(f.litru) : '0'),
      km:    (f.km    != null ? String(f.km)    : '0'),
      plata: f.plata || 'Card',
      suma:  (f.suma  != null ? String(f.suma)  : '0')
    };
  }
  return {
    _rid: it.id, _rk: 'purchase',
    produs: f.produs || '',
    loc:    f.loc  || '',
    data:   f.data || today,
    pret:   (f.suma != null ? String(f.suma) : '0'),
    plata:  f.plata || 'Card'
  };
}

// A hozzáadható tételek listája: orphan bin sorai + a queue ready sorai
// egy egységes listaként. `src` mutatja a forrást (bin/queue).
function _collectPendingAddItems() {
  var out = [];
  var bin = orphanLoad();
  (bin.alim || []).forEach(function (a, i) { out.push({ src: 'bin', kind: 'fuel',     idx: i, row: a }); });
  (bin.ach  || []).forEach(function (a, i) { out.push({ src: 'bin', kind: 'purchase', idx: i, row: a }); });
  var q = rcptQueueLoad();
  q.forEach(function (it) {
    if (it && it.status === 'ready') {
      var row = _receiptToRow(it);
      out.push({ src: 'queue', kind: row._rk, id: it.id, row: row });
    }
  });
  return out;
}

// Popup megnyitása. Ha nincs hozzáadható tétel → azonnal `cb()`.
function openPendingAddModal(cb) {
  var items = _collectPendingAddItems();
  if (!items.length) { _pendingAddRows = null; if (typeof cb === 'function') cb(); return; }
  var m = document.getElementById('pendingAddModal');
  var list = document.getElementById('pendingAddList');
  if (!m || !list) {
    // Régi HTML (még nem cache-frissítve) → nem blokkolunk, mint eddig.
    _pendingAddRows = null;
    if (typeof cb === 'function') cb();
    return;
  }
  _pendingAddCb = cb || function () {};
  _pendingAddItems = items;
  // Alap: mindegyik pipálva (a sofőr könnyen indíthat mindet vagy leszedhet)
  list.innerHTML = items.map(function (it, i) {
    var r = it.row || {};
    var icon = (it.kind === 'fuel') ? '⛽' : '🛒';
    var kindLabel = (it.kind === 'fuel') ? t('sof.rr.kindFuel') : t('sof.rr.kindPurchase');
    var srcBadge = (it.src === 'queue')
      ? '<span class="pa-src pa-src-q">📷 ' + esc(t('sof.rr.kindPurchase') === kindLabel ? '' : '') + esc(t('sof.pa.srcScan')) + '</span>'
      : '<span class="pa-src pa-src-b">' + esc(t('sof.pa.srcSaved')) + '</span>';
    var d = r.data ? esc(String(r.data).slice(0, 10)) : '—';
    var sumNum = (it.kind === 'fuel') ? (parseFloat(r.suma) || 0) : (parseFloat(r.pret) || 0);
    var sum = '';
    if (sumNum) { try { sum = sumNum.toLocaleString(t('sof.locale')) + ' RON'; } catch (_) { sum = String(sumNum) + ' RON'; } }
    var loc = r.loc || r.produs || '—';
    var extra = '';
    if (it.kind === 'fuel') {
      var lit = parseFloat(r.litru) || 0;
      if (lit) extra = lit + ' L';
    } else if (r.produs && r.loc) {
      extra = esc(r.loc);
    }
    return '<label class="pa-item">'
      + '<input type="checkbox" class="pa-chk" data-idx="' + i + '" checked>'
      + '<div class="pa-body">'
      + '<div class="pa-head">' + icon + ' ' + esc(loc) + ' ' + srcBadge + '</div>'
      + '<div class="pa-sub">📅 ' + d + (sum ? ' · 💵 ' + esc(sum) : '') + (extra ? ' · ' + extra : '') + '</div>'
      + '</div>'
      + '</label>';
  }).join('');
  m.style.display = 'flex';
}

var _pendingAddCb = null;
var _pendingAddItems = [];

// „Mind" / „Semmi" gyors-pipa a popupban.
function pendingAddSelectAll(on) {
  document.querySelectorAll('#pendingAddList .pa-chk').forEach(function (cb) { cb.checked = !!on; });
}

function pendingAddConfirm() {
  var selected = [];
  document.querySelectorAll('#pendingAddList .pa-chk').forEach(function (cb) {
    if (cb.checked) {
      var i = parseInt(cb.getAttribute('data-idx'), 10);
      if (!isNaN(i) && _pendingAddItems[i]) selected.push(_pendingAddItems[i]);
    }
  });
  // A kiválasztott tételeket a fuvarStep2-nek átadjuk, ÉS eltávolítjuk
  // a forrásból (orphan bin / queue). Ha bin: idx-alapján töröljük.
  // Ha queue: rcptQueueRemove (a kép is takarítódik).
  var rowsAlim = [], rowsAch = [];
  var binDelAlim = {}, binDelAch = {};
  var queueDelIds = [];
  selected.forEach(function (it) {
    if (it.src === 'bin') {
      if (it.kind === 'fuel') binDelAlim[it.idx] = true;
      else                    binDelAch[it.idx]  = true;
    } else if (it.src === 'queue') {
      queueDelIds.push(it.id);
    }
    if (it.kind === 'fuel') rowsAlim.push(it.row);
    else                    rowsAch.push(it.row);
  });
  // Orphan bin — törlés indexek szerint
  var bin = orphanLoad();
  bin.alim = (bin.alim || []).filter(function (_a, i) { return !binDelAlim[i]; });
  bin.ach  = (bin.ach  || []).filter(function (_a, i) { return !binDelAch[i];  });
  orphanStore(bin);
  // Queue — id-alapján töröljük (a kép is)
  queueDelIds.forEach(function (id) { try { rcptQueueRemove(id); } catch (_) {} });
  _pendingAddRows = (rowsAlim.length || rowsAch.length) ? { alim: rowsAlim, ach: rowsAch } : null;
  _pendingAddClose();
}

function pendingAddSkip() {
  // Kihagyás — a tételek a helyükön maradnak; a beküldés előtt még
  // egyszer szólunk, ha date-ben belelógnak az útba.
  _pendingAddRows = null;
  _pendingAddClose();
}

function _pendingAddClose() {
  var m = document.getElementById('pendingAddModal');
  if (m) m.style.display = 'none';
  var cb = _pendingAddCb; _pendingAddCb = null; _pendingAddItems = [];
  if (typeof cb === 'function') cb();
}

// A menetlevél kezdéskor: a sofőr által már ELVÉGZETT (done_at NOT NULL)
// és még nem waybill-ezett stopokat automatikusan a menetlevélbe teszi.
// Csak azokat a stopokat vesszük fel, amelyek done_at-je >= a Plecare
// pillanata (Plecare előtti "elveszett" elvégzett stop nem szennyezi
// be az új menetlevelet — az történelmi, külön kezelendő). Egy fuvarhoz
// tartozó NYITOTT (done_at IS NULL) stopok kimaradnak — a következő
// menetlevélen kerülnek fel, amikor a sofőr azokat is elvégzi.
function _autoCollectCompletedStops() {
  var sinceIso = _plecareStartIso();
  var orderIds = [];
  var byOrder = {};
  _soferOrdersCache.forEach(function (o) {
    if (o && o.waybill_visible === false) return;
    var stops = Array.isArray(o.stops) ? o.stops : [];
    var picked = {};
    var any = false;
    stops.forEach(function (s) {
      if (!s || !s.done_at || s.waybilled_at) return;
      if (sinceIso && String(s.done_at) < sinceIso) return;
      picked[s.id] = true;
      any = true;
    });
    if (any) {
      orderIds.push(o.id);
      byOrder[o.id] = picked;
    }
  });
  _selectedOrderIds = orderIds;
  _autoStopFilter = orderIds.length ? { since: sinceIso, byOrder: byOrder } : null;
}

// Plecare időpont ISO-ban a stop-szűréshez. Prioritás:
//   1) _pendingPlecare (frissen bekért érték a wbLocDialog-ból)
//   2) DOM-ban lévő Plecare sor (piszkozat visszatöltés utáni állapot)
// Óra nélkül 00:00-t használ (a nap eleje = "Plecare után minden").
function _plecareStartIso() {
  var day = '';
  var timeStr = '00:00';
  if (_pendingPlecare && _pendingPlecare.date) {
    day = String(_pendingPlecare.date).slice(0, 10);
    if (_pendingPlecare.time && /^\d{1,2}:\d{2}$/.test(_pendingPlecare.time)) {
      timeStr = _pendingPlecare.time.length === 4 ? '0' + _pendingPlecare.time : _pendingPlecare.time;
    }
  } else {
    day = _plecareStartDay();
    var pc = document.getElementById('puncteContainer');
    if (pc) {
      var row = pc.querySelector('.dyn-row');
      if (row) {
        var tip = (row.querySelector('.punct-tip') || {}).value;
        var tv  = (row.querySelector('.punct-time') || {}).value || '';
        if (tip === 'Plecare' && /^\d{1,2}:\d{2}$/.test(tv)) {
          timeStr = tv.length === 4 ? '0' + tv : tv;
        }
      }
    }
  }
  if (!day) return '';
  return day + 'T' + timeStr + ':00';
}
function _continueSavedDraft() {
  // A meglévő piszkozat sorai már a stopokra vannak tag-elve; nincs
  // szükség auto-filterre — a picker (ha nyílik) filter nélkül dolgozik.
  _autoStopFilter = null;
  // A resumeDraft már a step2-t nyitja meg + visszatölti a mezőket + puncte-t.
  resumeDraft();
  // Piszkozat folytatásakor NEM nyitjuk meg automatikusan a pickert —
  // a sofőr a step2-ben lévő „✏️ Fuvarok kezelése" gombbal utólag
  // hozzáadhat/levehet fuvart, ha szükséges. A folytatás önmagában
  // hallgatólagosan érvényben tartja a mentett kijelöléseket.
}
// Visszafelé kompatibilitás: régi (gyorsítótárazott) sofer.html még ezt hívja.
function fuvarNoOrder() {
  _selectedOrderIds = [];
  _autoStopFilter = null;
  fuvarStep2(true);
}

// „✏️ Fuvarok kezelése" gomb a step2-ből — a picker újranyitása utólag
// (add/remove). Ugyanaz, mint a continue-ág, csak a felhasználó explicit
// kérésére. A picker megnyitása megtartja az auto-filtert a MEGLÉVŐ
// (már beszúrt) sorokra, de az UTÁN hozzáadott új fuvarok TELJES nem-
// waybill-ezett stopokkal jönnek (_applyPickerDiff filter nélkül hív) —
// mert a sofőr így kézzel, tudatosan felveszi a nyitott állomásokat is.
function fuvarPickAgain() {
  _openOrderPicker('continue', function (picked) {
    if (picked == null) return;
    _applyPickerDiff(picked);
  });
}

// ============================================================
// FUVAR-PICKER (modal) — a menetlevélre kerülő fuvarok kiválasztása
// ============================================================
// A picker a `_soferOrdersCache`-ből dolgozik (getMySoferOrders szűrése:
// `waybill_visible=true`). A phase-badge mutatja, hogy a fuvar felrakó
// (loading), lerakó (unloading) vagy egyben megy (complete).
//   mode='fresh'    → nincs pre-checked
//   mode='continue' → a jelenlegi `_selectedOrderIds` pre-checked (a
//                     sofőr hozzáad/levesz)
// Visszatérés: cb(null) = Mégse, cb([ids]) = az új teljes kijelölés.
var _opCb = null;
function _openOrderPicker(mode, cb) {
  _opCb = cb || function () {};
  var m = document.getElementById('orderPickerModal');
  var hint = document.getElementById('opHint');
  var list = document.getElementById('opList');
  if (!m || !hint || !list) { _opCb([]); return; }   // régi HTML → csak továbbengedjük
  var render = function () {
    var items = _soferOrdersCache.slice();
    var startDay = _plecareStartDay();
    hint.textContent = (mode === 'continue')
      ? t('sof.pick.hintContinue')
      : t('sof.pick.hintFresh');
    if (!items.length) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;">'
        + esc(t('sof.pick.empty')) + '</div>';
      return;
    }
    items.sort(function (a, b) {
      var da = String(a.data_incarcare || a.incarcat_at || a.finalized_at || a.created_at || '');
      var db = String(b.data_incarcare || b.incarcat_at || b.finalized_at || b.created_at || '');
      return da.localeCompare(db);
    });
    list.innerHTML = items.map(function (o) {
      var checked = _selectedOrderIds.indexOf(o.id) !== -1;
      var phaseBadge = '';
      if (o.waybill_phase === 'loading') {
        phaseBadge = ' <span class="op-badge op-badge-load">📤 ' + t('sof.phaseLoading') + '</span>';
      } else if (o.waybill_phase === 'unloading') {
        phaseBadge = ' <span class="op-badge op-badge-unload">📥 ' + t('sof.phaseUnloading') + '</span>';
      }
      var mustBadge = '';
      if (o.status === 'Finalizat' && startDay && (o.finalized_at || '') > startDay + 'T00:00:00') {
        mustBadge = ' <span class="op-badge op-badge-must" title="'
          + esc(t('sof.pick.mustTitle')) + '">⚠️ ' + esc(t('sof.pick.must')) + '</span>';
      }
      // ÚJ olvasható formátum: felrakás dátum · cég · város  →  lerakás dátum · város · cég
      // (CMD-azonosító a sofőrnek NEM jelenik meg — csak a fuvar tartalma számít)
      var loadDay   = fmtFuvarDay(o.data_incarcare)   || esc(t('sof.det.date'));
      var unloadDay = fmtFuvarDay(o.data_descarcare)  || esc(t('sof.det.date'));
      var loadCity   = _cityOf(o.loc_incarcare)   || (o.loc_incarcare   || '—');
      var unloadCity = _cityOf(o.loc_descarcare)  || (o.loc_descarcare  || '—');
      var loadFirma   = (o.firma_incarcare  || '').trim();
      var unloadFirma = (o.firma_descarcare || '').trim();
      var pickLine = '📅 ' + esc(loadDay)
        + (loadFirma  ? ' · 🏢 ' + esc(loadFirma)  : '')
        + ' · 📍 ' + esc(loadCity);
      var dropLine = '📅 ' + esc(unloadDay)
        + ' · 📍 ' + esc(unloadCity)
        + (unloadFirma ? ' · 🏢 ' + esc(unloadFirma) : '');
      return '<label class="op-item">'
        + '<input type="checkbox" value="' + esc(o.id) + '" ' + (checked ? 'checked' : '')
        + ' onchange="_opToggle(this)">'
        + '<div class="op-body">'
        + '<div class="op-head">' + pickLine + phaseBadge + mustBadge + '</div>'
        + '<div class="op-route">↓ ' + dropLine + '</div>'
        + (o.rendszam_camion ? '<div class="op-plate">🚛 ' + esc(o.rendszam_camion)
              + (o.rendszam_remorca ? ' / ' + esc(o.rendszam_remorca) : '') + '</div>' : '')
        + '</div></label>';
    }).join('');
  };
  if (!_soferOrdersCache.length) {
    fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName: 'getMySoferOrders' }) })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      _soferOrdersCache = (d.result || []).filter(function (o) { return o.waybill_visible !== false; });
      render();
    })
    .catch(function () { render(); });
  } else {
    render();
  }
  m.style.display = 'flex';
}
function _opToggle(cb) {
  var id = cb.value;
  if (cb.checked) {
    if (_selectedOrderIds.indexOf(id) === -1) _selectedOrderIds.push(id);
  } else {
    _selectedOrderIds = _selectedOrderIds.filter(function (x) { return x !== id; });
  }
}
function opAccept() {
  var m = document.getElementById('orderPickerModal');
  if (m) m.style.display = 'none';
  var cb = _opCb; _opCb = null;
  if (cb) cb(_selectedOrderIds.slice());
}
function opCancel() {
  var m = document.getElementById('orderPickerModal');
  if (m) m.style.display = 'none';
  var cb = _opCb; _opCb = null;
  if (cb) cb(null);
}

// A menetlevél indulási napja (YYYY-MM-DD) — a Plecare sorból elsősorban
// (mert az a valódi indulás), különben a piszkozatból, végül a Plecare-
// dialog eredményéből.
function _plecareStartDay() {
  var pc = document.getElementById('puncteContainer');
  if (pc) {
    var row = pc.querySelector('.dyn-row');
    if (row) {
      var tip = (row.querySelector('.punct-tip') || {}).value;
      var dv  = (row.querySelector('.punct-data') || {}).value || '';
      if (tip === 'Plecare' && /^\d{4}-\d{2}-\d{2}$/.test(dv)) return dv;
    }
  }
  try {
    var st = stateGet(), pl = ((st.draft || {}).puncte || []).find(function (p) { return p.tip === 'Plecare'; });
    if (pl && pl.data) return String(pl.data).slice(0, 10);
  } catch (e) {}
  if (_pendingPlecare && _pendingPlecare.date) return String(_pendingPlecare.date).slice(0, 10);
  return '';
}

// Continue módban: a picker új listáját (kijelölések) rávetítjük a step2
// puncte-sorra. Eltávolítjuk azokat a fuvar-tag-elt sorokat, amiket a
// sofőr LEVETT; és hozzáadjuk (Sosire ELÉ) azokat, amiket felvett. A
// meglévő (bent maradó) sorokhoz NEM nyúlunk, hogy a sofőr által beírt
// dátum/óra ne vesszen el.
function _applyPickerDiff(newIds) {
  var pc = document.getElementById('puncteContainer');
  if (!pc) return;
  var existing = {};   // orderId → { loading: row, unloading: row }
  pc.querySelectorAll('.dyn-row').forEach(function (row) {
    var oid = row.getAttribute('data-order-id');
    var role = row.getAttribute('data-role');
    if (!oid || !role) return;
    existing[oid] = existing[oid] || {};
    existing[oid][role] = row;
  });
  Object.keys(existing).forEach(function (oid) {
    if (newIds.indexOf(oid) === -1) {
      Object.keys(existing[oid]).forEach(function (role) {
        var row = existing[oid][role];
        if (row && row.parentNode) row.parentNode.removeChild(row);
      });
    }
  });
  var sosireRow = null;
  pc.querySelectorAll('.dyn-row').forEach(function (row) {
    if (sosireRow) return;
    if ((row.querySelector('.punct-tip') || {}).value === 'Sosire') sosireRow = row;
  });
  var _ymdOf = function (v) { return v ? String(v).slice(0, 10) : ''; };
  var added = 0;
  newIds.forEach(function (oid) {
    if (existing[oid]) return;                                    // már bent volt
    var o = _soferOrdersCache.find(function (x) { return x.id === oid; });
    if (!o) return;
    var toAdd = _buildWaybillPuncteForOrder(o);
    toAdd.forEach(function (args) {
      addPunctRow(args[0], args[1], args[2], args[3]);
      var lastRow = pc.lastElementChild;
      if (sosireRow && lastRow !== sosireRow) { pc.insertBefore(lastRow, sosireRow); }
    });
    added += toAdd.length;
  });
  _punctRenumber();
  if (typeof _syncTripTimesFromPuncte === 'function') _syncTripTimesFromPuncte();
  _refreshSelectedOrdersSummary();
  draftSave();
  if (added) toast(t('sof.pick.added', { n: added }), 'ok');
}

// A step2 tetején lévő „✅ N fuvar" összesítő újrarajzolása a jelenlegi
// `_selectedOrderIds` + `_soferOrdersCache` alapján. A `fuvarStep2` első
// beépítéskor már beállítja; a picker utólagos módosításnál ezt hívjuk.
function _refreshSelectedOrdersSummary() {
  var sumEl = document.getElementById('selectedOrdersSummary');
  if (!sumEl) return;
  var selected = _soferOrdersCache.filter(function (o) { return _selectedOrderIds.indexOf(o.id) !== -1; });
  if (!selected.length) {
    sumEl.innerHTML = '<b style="color:#fff;">' + t('sof.noOrderSummary') + '</b>';
    return;
  }
  sumEl.innerHTML = '<b style="color:#fff;">✅ ' + t('sof.selectedOrders', { n: selected.length }) + '</b><br>'
    + selected.map(function (o) {
        return '• ' + esc(o.loc_incarcare || '—') + ' → ' + esc(o.loc_descarcare || '—');
      }).join('<br>');
}

// Lezárási védőháló: ha a `_soferOrdersCache`-ban van olyan Finalizat
// fuvar, ami az indulási nap UTÁN lett elvégezve (`finalized_at > startDay`),
// és nincs a menetlevélen (`_selectedOrderIds` és a puncte-tag-ek sem
// tartalmazzák), NEM engedjük lezárni. A sofőrnek felkínáljuk a pickert.
// Az indulás előtti Finalizat fuvarok kimaradása megengedett (történelmi).
function _validateNoLeftoverOrders() {
  var startDay = _plecareStartDay();
  if (!startDay) return true;             // nincs indulási nap → nem tudunk értékelni, engedjük
  var onWaybill = {};
  _selectedOrderIds.forEach(function (id) { onWaybill[id] = true; });
  var pc = document.getElementById('puncteContainer');
  if (pc) {
    pc.querySelectorAll('.dyn-row[data-order-id]').forEach(function (row) {
      onWaybill[row.getAttribute('data-order-id')] = true;
    });
  }
  var missing = _soferOrdersCache.filter(function (o) {
    if (o.status !== 'Finalizat') return false;
    if (onWaybill[o.id]) return false;
    var f = o.finalized_at || '';
    return f && f > startDay + 'T00:00:00';
  });
  if (!missing.length) return true;
  toast(t('sof.pick.leftover', { n: missing.length }), 'err');
  fuvarPickAgain();
  return false;
}

function fuvarStep2(allowEmpty) {
  // Az `allowEmpty` paraméter már csak visszafelé-kompatibilitásból van itt:
  // egyetlen gomb van, és az MINDIG továbbenged — pipa nélkül fuvar nélküli
  // menetlevél készül (nincs „jelölj be legalább egy fuvart" akadály).
  var selected = _soferOrdersCache.filter(function(o) { return _selectedOrderIds.indexOf(o.id) !== -1; });
  var sumEl = document.getElementById('selectedOrdersSummary');
  if (!selected.length) {
    sumEl.innerHTML = '<b style="color:#fff;">' + t('sof.noOrderSummary') + '</b>';
  } else {
  sumEl.innerHTML = '<b style="color:#fff;">✅ ' + t('sof.selectedOrders', { n: selected.length }) + '</b><br>'
    + selected.map(function(o) {
        return '• ' + esc(o.loc_incarcare || '—') + ' → ' + esc(o.loc_descarcare || '—');
      }).join('<br>');
  }

  // Rendszám előtöltése: elsőként a kiválasztott fuvarból; ha ott nincs (pl.
  // fuvar nélküli menetlevél), a nekem kiosztott vontató + alapértelmezett
  // pótkocsi rendszámából. Mindkettő szerkeszthető (csak alapérték). Üres mezőt
  // nem írunk felül (piszkozat-visszatöltés védelme).
  var first = selected[0];
  var camEl = document.getElementById('fCamion');
  var remEl = document.getElementById('fRemorca');
  if (first && first.rendszam_camion) {
    camEl.value = first.rendszam_camion;
    remEl.value = first.rendszam_remorca || '';
  } else if (_myAssignedVehicle && _myAssignedVehicle.rendszam_camion) {
    if (!camEl.value) camEl.value = _myAssignedVehicle.rendszam_camion;
    if (!remEl.value && _myAssignedVehicle.rendszam_remorca) remEl.value = _myAssignedVehicle.rendszam_remorca;
  }
  // Kezdő üzemanyag-szint átvitel az adott jármű utolsó menetleveléből.
  if (camEl.value) prefillWaybillReadings(camEl.value);

  // Indulás/érkezés dátum előtöltése a TÉNYLEGES állomás-időből (incarcat_at /
  // descarcat_at), fallback a fuvar tervezett dátumára (data_incarcare/descarcare).
  // CSAK a dátumot töltjük (óra 00:00 → a sofőr állítja); üres mezőt nem írunk
  // felül piszkozat visszatöltésekor. Több fuvar: legkorábbi felrakás / legkésőbbi lerakás.
  var _ymdOf = function(v){ return v ? String(v).slice(0, 10) : ''; };
  var loadDates = [], unloadDates = [];
  selected.forEach(function(o){
    var l = _ymdOf(o.incarcat_at) || _ymdOf(o.data_incarcare);
    var u = _ymdOf(o.descarcat_at) || _ymdOf(o.data_descarcare);
    if (l) loadDates.push(l);
    if (u) unloadDates.push(u);
  });
  var depEl = document.getElementById('fIndulasDt');
  var arrEl = document.getElementById('fErkezesDt');
  if (depEl && !depEl.value && loadDates.length) {
    depEl.value = loadDates.sort()[0] + 'T00:00';           // legkorábbi felrakás
  }
  if (arrEl && !arrEl.value && unloadDates.length) {
    arrEl.value = unloadDates.sort()[unloadDates.length - 1] + 'T00:00';  // legkésőbbi lerakás
  }
  if (typeof updateDiurnaPreview === 'function') { try { updateDiurnaPreview(); } catch (e) {} }

  document.getElementById('puncteContainer').innerHTML = '';
  punctIdx = 0;

  // 1) Plecare (indulási pont) — vagy a most bekért (fuvarCreate modal-ból),
  //    vagy piszkozat-visszaállításkor a mentett Plecare sor.
  var _plecare = _pendingPlecare;
  if (!_plecare) {
    try {
      var _st1 = stateGet();
      var _pl = ((_st1.draft || {}).puncte || []).find(function (p) { return p.tip === 'Plecare'; });
      if (_pl) _plecare = { loc: _pl.loc, date: String(_pl.data || '').slice(0, 10), time: _pl.time || '' };
    } catch (_e2) {}
  }
  if (_plecare) {
    addPunctRow(_plecare.loc, 'Plecare', _plecare.date, { time: _plecare.time });
  }
  _pendingPlecare = null;

  // 2) A kiválasztott fuvarokból a puncte-sorok — a KÖZÖS
  //    `_buildWaybillPuncteForOrder(o, filter)` kezeli a multi-stop esetet
  //    is: minden olyan stopot felvesz, amit még nem waybill-eztünk
  //    (waybilled_at IS NULL), és tag-eli a stopId-vel. A régi (nem-migrált)
  //    fuvarra legacy loc_*/data_*.
  //    Ha `_autoStopFilter` be van állítva (fresh menetlevél auto-collect
  //    útján érkeztünk), csak a filter által engedélyezett — vagyis a már
  //    ELVÉGZETT — stopok kerülnek fel; a fuvar még nyitott stopjai nem.
  selected.forEach(function(o) {
    _buildWaybillPuncteForOrder(o, _autoStopFilter).forEach(function (args) {
      addPunctRow(args[0], args[1], args[2], args[3]);
    });
  });

  // 3) Sosire (érkezési pont) — visszalépéskor a piszkozatból visszahozzuk;
  //    egyébként a beküldéskor (submitFuvarlevel) kérdez rá a modal, ott
  //    kerül a puncte végére.
  try {
    var _st4 = stateGet();
    var _sos = ((_st4.draft || {}).puncte || []).find(function (p) { return p.tip === 'Sosire'; });
    if (_sos) addPunctRow(_sos.loc, 'Sosire', String(_sos.data || '').slice(0, 10), { time: _sos.time });
  } catch (_e3) {}

  document.getElementById('fuvarStep1').style.display = 'none';
  document.getElementById('fuvarStep2').style.display = 'block';
  document.getElementById('alimentariContainer').innerHTML = '';
  document.getElementById('achizitiiContainer').innerHTML = '';
  alimIdx = 0; achIdx = 0;

  // Ha a sofőr korábban a főoldalról scannelt bonokat és elfogadta őket
  // (rrAccept: step2 zárva → sessionStorage-piszkozatba pusholtuk), most
  // állítsuk vissza a DOM-ba is — különben a következő draftSave (üres
  // konténer) felülírná őket. Az igazságforrás a sessionStorage; ha a
  // fuvarStep1-ből ide léptünk, csak a tankolás/vásárlás sorok érintettek
  // (a km/rendszám/dátum előtöltés fentebb már megvolt, üres mezőt nem
  // írunk felül).
  try {
    var _st = stateGet();
    var _dr = _st && _st.draft;
    if (_dr) {
      (_dr.alimentari || []).forEach(function (a) { addAlimRow(a); });
      (_dr.achizitii  || []).forEach(function (a) { addAchRow(a); });
    }
  } catch (_e) { /* nincs érvényes piszkozat — üresen indul */ }

  // Pending-add popup által kiválasztott tételek: orphan binből + ready
  // scannelt bonokból származó sorok. A `_pendingAddRows`-ban gyűjtöttük
  // össze, itt a DOM-ba tesszük, majd egy `draftSave`-vel biztosítjuk,
  // hogy a következő auto-piszkozatba is bekerüljenek.
  if (_pendingAddRows) {
    var _add = _pendingAddRows;
    _pendingAddRows = null;
    (_add.alim || []).forEach(function (a) { addAlimRow(a); });
    (_add.ach  || []).forEach(function (a) { addAchRow(a);  });
    try { draftSave(); } catch (_) {}
  }

  // Piszkozat figyeli a változásokat
  attachDraftListeners();
  // Helyszín-javaslatok (a cég korábbi menetleveleiből) — egyszer töltjük
  if (typeof sugLoad === 'function') { try { sugLoad(); } catch (e) {} }
  // Összecsukható szekciók (ami üres, az alapból csukva → rövid lap)
  if (typeof wbSecInit === 'function') { try { wbSecInit(); } catch (e) {} }
  // Út időpontjai (hidden fIndulasDt/fErkezesDt) szinkron a Plecare/Sosire-ból
  if (typeof _syncTripTimesFromPuncte === 'function') _syncTripTimesFromPuncte();
  stateSave({ fuvarStep: 2 });
}

function fuvarBackStep1() {
  document.getElementById('fuvarStep2').style.display = 'none';
  document.getElementById('fuvarStep1').style.display = 'block';
  stateSave({ fuvarStep: 1 });
  if (typeof renderDraftResume === 'function') renderDraftResume();
}

// A menetlevél „Út időpontjai" (kezdő / záró datetime) automatikusan a
// Plecare (első ilyen sor) és Sosire (utolsó ilyen sor) dátumából + ÓRÁJÁBÓL
// képződik → a `fIndulasDt` / `fErkezesDt` hidden input-okba írunk (a
// `updateDiurnaPreview`, `submitFuvarlevel`, offline draft mind ezeket
// használja). Az óra a sor SAJÁT `.punct-time` mezőjéből jön: a Plecare/
// Sosire modal KÖTELEZŐEN bekéri, és utána a soron javítható is.
// Az érték `datetime-local` formátumú: 'YYYY-MM-DDTHH:MM'.
function _syncTripTimesFromPuncte() {
  var rows = document.querySelectorAll('#puncteContainer .dyn-row');
  var plecDt = '', sosDt = '';
  rows.forEach(function (row) {
    var tip  = (row.querySelector('.punct-tip')  || {}).value;
    var date = (row.querySelector('.punct-data') || {}).value;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    // Az óra a sor SAJÁT mezőjéből (a Plecare/Sosire modal kötelezően
    // bekéri, utána itt javítható). A 12:00 fallback már csak a régi,
    // óra nélkül mentett piszkozatokra vonatkozik — FIGYELEM: pont a
    // 12:00 az a határ, aminél a diurna az indulás/érkezés napját NEM
    // számolja, ezért kérjük be kötelezően.
    var time = (row.querySelector('.punct-time') || {}).value;
    if (!time || !/^\d{2}:\d{2}$/.test(time)) time = '12:00';
    var dt = date + 'T' + time;
    if (tip === 'Plecare' && !plecDt) plecDt = dt;      // első Plecare nyer
    if (tip === 'Sosire')             sosDt  = dt;      // utolsó Sosire nyer
  });
  var indEl = document.getElementById('fIndulasDt');
  var arrEl = document.getElementById('fErkezesDt');
  if (indEl && indEl.value !== plecDt) indEl.value = plecDt;
  if (arrEl && arrEl.value !== sosDt)  arrEl.value = sosDt;
  if (typeof updateDiurnaPreview === 'function') { try { updateDiurnaPreview(); } catch (e) {} }
}
// A puncte container változásaira (dropdown / dátum / helyszín módosul)
// automatikusan szinkronizáljuk a hidden input-okat. Egyetlen delegated
// listener az egész konténerre — a `.dyn-row`-k dinamikusan jönnek/mennek.
(function _hookPuncteSync() {
  function bind() {
    var pc = document.getElementById('puncteContainer');
    if (!pc || pc._vsTripSyncBound) return;
    pc._vsTripSyncBound = true;
    pc.addEventListener('change', _syncTripTimesFromPuncte);
    pc.addEventListener('input',  _syncTripTimesFromPuncte);
    // Ugyanitt kötjük be a pont-sorok átrendezését (hosszan nyomva → húzás).
    if (typeof _punctDragInit === 'function') _punctDragInit();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else { bind(); }
})();

// Input változások figyelése → piszkozat auto-mentés
function attachDraftListeners() {
  var ids = ['fCamion','fRemorca','fKmInc','fKmSf','fCantInc','fCantSf','fMentiuni'];
  ids.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) {
      el.removeEventListener('input', draftSave);
      el.addEventListener('input', draftSave);
    }
  });
  // Km / üzemanyag élő ellenőrzés — a négy szám-mezőre + a tankolás-sorokra
  // (utóbbi a konténer-MutationObserveren és a sorok `oninput`-ján át fut).
  ['fKmInc','fKmSf','fCantInc','fCantSf'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el && !el._kmCheckBound) {
      el._kmCheckBound = true;
      el.addEventListener('input', updateKmFuelCheck);
    }
  });
  var alimBox = document.getElementById('alimentariContainer');
  if (alimBox && !alimBox._kmCheckBound) {
    alimBox._kmCheckBound = true;
    alimBox.addEventListener('input', updateKmFuelCheck);
    alimBox.addEventListener('change', updateKmFuelCheck);
  }
  updateKmFuelCheck();
  // Rendszám kézi módosításakor a kezdő üzemanyag-szintet az új jármű utolsó
  // menetleveléből tölti (csak ha a kezdő mező üres/0 — beírt értéket nem ír felül).
  var camEl = document.getElementById('fCamion');
  if (camEl && !camEl._fuelBound) {
    camEl._fuelBound = true;
    camEl.addEventListener('change', function() {
      if (camEl.value) prefillWaybillReadings(camEl.value.trim());
    });
  }
  // Dinamikus sorok figyelése MutationObserver-rel
  ['puncteContainer','alimentariContainer','achizitiiContainer'].forEach(function(cId) {
    var container = document.getElementById(cId);
    if (!container._observer) {
      var obs = new MutationObserver(draftSave);
      obs.observe(container, { childList: true, subtree: true, characterData: true });
      container._observer = obs;
    }
  });
}

// ============================================================
// DINAMIKUS SOROK
// ============================================================
var alimIdx = 0, achIdx = 0, punctIdx = 0;

function addPunctRow(locVal, tipVal, dataVal, opts) {
  // opts (opcionális) — tag-adatok, hogy a driver által megadott felrakási/lerakási
  // dátum vissza tudja kötni a menetlevél sorát a fuvarra a beküldéskor:
  //   { orderId, role: 'loading'|'unloading', time: 'HH:MM' }
  // Plecare/Sosire sorokhoz csak `time` (opcionális, óra:perc). A tag-eket
  // data-* attribútumként tároljuk a sor <div>-jén, hogy a payload-gyűjtő
  // (submitFuvarlevel / soferCollectFull) egy helyen olvassa vissza.
  opts = opts || {};
  punctIdx++;
  var d = document.createElement('div');
  // `punct-row`: az útvonal-pont sorok átrendezhetők (hosszan nyomva → húzás),
  // ezért kapnak külön osztályt (a tankolás/vásárlás sorok NEM mozgathatók).
  d.className = 'dyn-row punct-row';
  // Alapból CSUKVA, ha van pre-fill helység (behozott adat) → egy-soros
  // összefoglaló + ✏️ szerkesztés. Új üres sor NYITVA marad.
  if (locVal) d.classList.add('collapsed');
  if (opts.orderId) d.setAttribute('data-order-id', opts.orderId);
  if (opts.role)    d.setAttribute('data-role', opts.role);
  // Multi-drop: a konkrét order_stop id — így a menetlevél-mentés a stopId
  // szerint tudja waybilled-nek jelölni (nem csak az elsőt kind-en belül).
  if (opts.stopId)  d.setAttribute('data-stop-id', opts.stopId);
  // Plecare + Sosire: az induló/érkező „garaj" jellegű pontok — a menetlevél
  // MINDIG ezekkel indul és zárul. A többi típus a régi lista.
  var tipOptions = ['Plecare','Încărcare','Descărcare','Tranzit','Vamă','Parcare','Sosire','Altele'];
  var today = new Date().toISOString().split('T')[0];
  var initTip = tipVal || 'Încărcare';
  var initDate = dataVal || today;
  var initTime = opts.time || '';
  var initCity = (typeof _cityOf === 'function' && _cityOf(locVal || '')) || (locVal || '—');
  d.innerHTML =
    // ── ÖSSZECSUKOTT ÖSSZEFOGLALÓ SÁV — CSAK #N · város · dátum
    //    (óra NEM), + ✏️ szerkeszt + ✕ törlés. Város + dátum két
    //    kissebb betűs sorra tördel, ha nem fér egy sorba — a kártya
    //    magassága ugyanaz marad. A sáv üres részén hosszan nyomva
    //    átrendezhető (a húzó logika `.punct-row`-ra célzik).
      '<div class="punct-summary" onclick="punctRowExpand(this)">'
    +   '<span class="punct-sum-grip" title="' + esc(t('sof.dragHint')) + '">⠿</span>'
    +   '<span class="punct-sum-idx"></span>'
    +   '<div class="punct-sum-body">'
    +     '<span class="punct-sum-city">' + esc(initCity) + '</span>'
    +     '<span class="punct-sum-date">' + esc(initDate) + '</span>'
    +   '</div>'
    +   '<button type="button" class="punct-sum-edit" onclick="event.stopPropagation();punctRowExpand(this)" title="' + esc(t('sof.editRow')) + '">✏️</button>'
    +   '<button type="button" class="punct-sum-del" onclick="event.stopPropagation();punctRowRemove(this)" title="✕">✕</button>'
    + '</div>'
    // ── SZERKESZTŐ TÖRZS — mezők + drag-fogantyú + „csukás" gomb.
    + '<div class="punct-body">'
    +   '<button class="del-row" onclick="punctRowRemove(this)">✕</button>'
    +   '<div class="punct-grip">'
    +     '<span class="punct-grip-idx"></span>'
    +     '<span class="punct-grip-ico">⠿</span>'
    +     '<span class="punct-grip-hint">' + t('sof.dragHint') + '</span>'
    +     '<button type="button" class="punct-collapse-btn" onclick="punctRowCollapse(this)" title="' + esc(t('sof.collapseRow')) + '">▲</button>'
    +   '</div>'
    +   '<div class="field"><label>' + t('sof.punctType') + '</label><select class="input punct-tip" onchange="draftSave();_updatePunctSummary(this)">'
    +   tipOptions.map(function(opt) { return '<option' + (opt === initTip ? ' selected' : '') + '>' + opt + '</option>'; }).join('')
    +   '</select></div>'
    // Dátum + ÓRA egy sorban.
    +   '<div class="g2">'
    +     '<div class="field"><label>' + t('sof.date') + '</label><input class="input punct-data" type="date" value="' + esc(initDate) + '" onchange="draftSave();_updatePunctSummary(this)"></div>'
    +     '<div class="field"><label>' + t('sof.time') + '</label><input class="input punct-time" type="time" value="' + esc(initTime) + '" onchange="draftSave();_updatePunctSummary(this)"></div>'
    +   '</div>'
    +   '<div class="field"><label>' + t('sof.localityAddr') + '</label><input class="input punct-loc" list="sug-punct-loc" placeholder="' + t('sof.punctLocPh') + '" value="' + esc(locVal || '') + '" oninput="draftSave();_updatePunctSummary(this)"></div>'
    + '</div>';
  document.getElementById('puncteContainer').appendChild(d);
  _punctRenumber();
}

// ── Sor kibontása / összecsukása ─────────────────────────────
// A sofőr a `#N város · dátum` összefoglaló sorra kattintva (VAGY a ✏️
// gombra) kinyitja szerkeszteni, a törzsben lévő ▲ „csukás" gombbal
// visszazárja. Az `.collapsed` osztály állítása CSS-en át rejt/mutat.
function punctRowExpand(el) {
  var row = el && el.closest ? el.closest('.dyn-row.punct-row') : null;
  if (row) row.classList.remove('collapsed');
}
function punctRowCollapse(el) {
  var row = el && el.closest ? el.closest('.dyn-row.punct-row') : null;
  if (!row) return;
  row.classList.add('collapsed');
  _updatePunctSummary(row);
}

// ── Összefoglaló sáv frissítése ─────────────────────────────
// A szerkesztő-mezők (`.punct-loc`, `.punct-data`, `.punct-time`)
// bármely change-e után újrarenderel: helység `_cityOf`-fal városra vág,
// dátum + óra változatlanul.
function _updatePunctSummary(el) {
  var row = el && el.closest ? el.closest('.dyn-row.punct-row') : (el && el.classList && el.classList.contains('punct-row') ? el : null);
  if (!row) return;
  var loc = row.querySelector('.punct-loc');
  var data = row.querySelector('.punct-data');
  var sumCity = row.querySelector('.punct-sum-city');
  var sumDate = row.querySelector('.punct-sum-date');
  if (sumCity && loc) {
    var v = loc.value || '';
    var city = (typeof _cityOf === 'function' && _cityOf(v)) || (v || '—');
    sumCity.textContent = city;
  }
  if (sumDate && data) sumDate.textContent = data.value || '';
}

// ============================================================
// ÚTVONAL-PONTOK ÁTRENDEZÉSE (hosszan nyomva → húzás)
// ============================================================
// A sofőr a menetlevél útvonal-pontjait EGYBEN (típus + dátum + helység)
// mozgathatja: a soron hosszan nyomva a kártya „kiugrik" (kiemelkedik és
// követi az ujjat), közben egy vízszintes vonal jelzi, MELYIK KÉT PONT KÖZÉ
// kerül. Felengedésre a sor a jelzett helyre kerül.
//
// Miért saját pointer-alapú megoldás a HTML5 drag&drop helyett: a natív DnD
// mobil böngészőkön gyakorlatilag nem használható (nincs touch-támogatás),
// a Pointer Events viszont egérrel és érintéssel is ugyanazt az utat járja.
//
// A sorrend a mentés szempontjából a DOM-sorrend (a payload-gyűjtők a
// `#puncteContainer .dyn-row` sorrendjében olvasnak), ezért a csere után
// elég a `draftSave()` + `_syncTripTimesFromPuncte()` (a Plecare/Sosire
// horgony változhatott).
var PUNCT_DRAG_HOLD_MS = 400;   // ennyi ideig kell nyomva tartani a megfogáshoz
var PUNCT_DRAG_SLOP_PX = 10;    // ennél nagyobb elmozdulás előtte = görgetés

var _punctDrag = null;          // az aktív húzás állapota (null, ha nincs)

// A konténer közvetlen pont-sorai (a húzás-jelző vonal NEM `.dyn-row`).
function _punctRows() {
  var pc = document.getElementById('puncteContainer');
  if (!pc) return [];
  return Array.prototype.filter.call(pc.children, function (el) {
    return el.classList && el.classList.contains('dyn-row');
  });
}

// A fogantyú sorszám-buborékainak újraszámozása (1..N) — hozzáadás, törlés
// és átrendezés után. Frissíti mind a szerkesztő-fogantyút, mind az
// összefoglaló-sáv számozását.
function _punctRenumber() {
  _punctRows().forEach(function (row, i) {
    var sumIdx = row.querySelector('.punct-sum-idx');
    if (sumIdx) sumIdx.textContent = String(i + 1);
    var el = row.querySelector('.punct-grip-idx');
    if (el) el.textContent = String(i + 1);
  });
}

// Pont-sor törlése (a ✕ gombról) — a régi inline `parentNode.remove()`
// helyett, hogy az újraszámozás és az idő-szinkron is lefusson.
function punctRowRemove(btn) {
  var row = btn.closest ? btn.closest('.dyn-row') : btn.parentNode;
  if (row && row.parentNode) row.parentNode.removeChild(row);
  _punctRenumber();
  if (typeof _syncTripTimesFromPuncte === 'function') _syncTripTimesFromPuncte();
  draftSave();
}

// A görgethető ős (ha a lap nem az ablakkal görög) — az él-közeli
// automatikus görgetéshez és a húzás közbeni görgetés-korrekcióhoz.
function _punctScrollEl(el) {
  var n = el && el.parentNode;
  while (n && n.nodeType === 1) {
    var ov = '';
    try { ov = getComputedStyle(n).overflowY; } catch (e) {}
    if (/(auto|scroll|overlay)/.test(ov) && n.scrollHeight > n.clientHeight + 2) return n;
    n = n.parentNode;
  }
  return null;
}
function _punctScrollTop(st) {
  return st.scroller ? st.scroller.scrollTop
                     : (window.pageYOffset || document.documentElement.scrollTop || 0);
}

function _punctDragInit() {
  var pc = document.getElementById('puncteContainer');
  if (!pc || pc._vsDragBound) return;
  pc._vsDragBound = true;
  pc.addEventListener('pointerdown', _punctPointerDown);
  // Hosszan nyomásra a mobil böngésző kontextus-menüt nyitna — húzás közben nem kérünk belőle.
  pc.addEventListener('contextmenu', function (e) { if (_punctDrag) e.preventDefault(); });
}

function _punctPointerDown(e) {
  if (_punctDrag) return;
  if (e.button != null && e.button !== 0) return;          // csak bal gomb / érintés
  var tgt = e.target;
  if (!tgt || !tgt.closest) return;
  // A beviteli mezőkről NEM indítunk húzást (különben nem lehetne
  // szerkeszteni/kijelölni) — a fogantyú, a címkék és a sor üres felülete marad.
  if (tgt.closest('input, select, textarea, button, a')) return;
  var row = tgt.closest('.punct-row');
  var pc  = document.getElementById('puncteContainer');
  if (!row || !pc || row.parentNode !== pc) return;
  if (_punctRows().length < 2) return;                     // egy sort nincs mihez rendezni

  var st = {
    row: row, pc: pc,
    startX: e.clientX, startY: e.clientY, lastY: e.clientY,
    active: false, timer: null, line: null, before: null,
    scroller: null, scrollRef: 0, rafPending: false
  };
  _punctDrag = st;
  st.timer = setTimeout(function () { _punctDragActivate(st); }, PUNCT_DRAG_HOLD_MS);

  document.addEventListener('pointermove', _punctPointerMove, { passive: false });
  document.addEventListener('pointerup', _punctPointerUp);
  document.addEventListener('pointercancel', _punctPointerCancel);
  // Nem-passzív touchmove: aktív húzás közben ez tiltja le a lapgörgetést.
  document.addEventListener('touchmove', _punctTouchGuard, { passive: false });
}

function _punctTouchGuard(e) {
  if (_punctDrag && _punctDrag.active && e.cancelable) e.preventDefault();
}

function _punctDragActivate(st) {
  if (_punctDrag !== st) return;
  st.timer = null;
  st.active = true;
  st.scroller = _punctScrollEl(st.pc);
  st.scrollRef = _punctScrollTop(st);
  st.row.classList.add('punct-dragging');
  document.body.classList.add('punct-drag-active');
  if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) {} }   // tapintható visszajelzés
  var line = document.createElement('div');
  line.className = 'punct-drop-line';
  st.pc.appendChild(line);
  st.line = line;
  _punctDragUpdate(st);
}

// A húzott sor követi az ujjat, és kiszámoljuk, MELYIK sor ELÉ kerülne
// (`st.before`; `null` = a lista végére). A jelző-vonalat a konténerhez
// képest abszolút pozicionáljuk — így a sorok nem ugrálnak húzás közben.
function _punctDragUpdate(st) {
  var dy = (st.lastY - st.startY) + (_punctScrollTop(st) - st.scrollRef);
  st.row.style.transform = 'translateY(' + dy + 'px) scale(1.03)';

  var rows = _punctRows().filter(function (r) { return r !== st.row; });
  var before = null;
  for (var i = 0; i < rows.length; i++) {
    var rc = rows[i].getBoundingClientRect();
    if (st.lastY < rc.top + rc.height / 2) { before = rows[i]; break; }
  }
  st.before = before;

  var top;
  if (before) top = before.offsetTop - 6;
  else if (rows.length) {
    var last = rows[rows.length - 1];
    top = last.offsetTop + last.offsetHeight + 4;
  } else top = 0;
  st.line.style.top = top + 'px';
}

// Az ablak/konténer alsó-felső szélénél automatikus görgetés, hogy hosszú
// listában is el lehessen jutni a kívánt helyre.
function _punctAutoScroll(st) {
  var margin = 90;
  var vh = window.innerHeight || document.documentElement.clientHeight;
  var d = 0;
  if (st.lastY < margin) d = -Math.ceil((margin - st.lastY) / 6);
  else if (st.lastY > vh - margin) d = Math.ceil((st.lastY - (vh - margin)) / 6);
  if (!d) return;
  if (st.scroller) st.scroller.scrollTop += d;
  else window.scrollBy(0, d);
}

function _punctPointerMove(e) {
  var st = _punctDrag;
  if (!st) return;
  st.lastY = e.clientY;
  if (!st.active) {
    // Még a nyomva-tartás alatt vagyunk: ha a sofőr elmozdítja az ujját,
    // az görgetési szándék → nem húzunk.
    if (Math.abs(e.clientY - st.startY) > PUNCT_DRAG_SLOP_PX ||
        Math.abs(e.clientX - st.startX) > PUNCT_DRAG_SLOP_PX) _punctDragEnd(false);
    return;
  }
  if (e.cancelable) e.preventDefault();
  if (st.rafPending) return;
  st.rafPending = true;
  requestAnimationFrame(function () {
    st.rafPending = false;
    if (_punctDrag !== st || !st.active) return;
    _punctAutoScroll(st);
    _punctDragUpdate(st);
  });
}

function _punctPointerUp() {
  if (_punctDrag) _punctDragEnd(_punctDrag.active);
}

// A böngésző elvette a gesztust (pl. rendszer-gesztus, hívás) → NEM rendezünk
// át; a sor visszaáll a helyére.
function _punctPointerCancel() {
  if (_punctDrag) _punctDragEnd(false);
}

// `commit=true` → a sor a jelzett helyre kerül; `false` → minden marad.
function _punctDragEnd(commit) {
  var st = _punctDrag;
  if (!st) return;
  _punctDrag = null;
  if (st.timer) clearTimeout(st.timer);
  document.removeEventListener('pointermove', _punctPointerMove);
  document.removeEventListener('pointerup', _punctPointerUp);
  document.removeEventListener('pointercancel', _punctPointerCancel);
  document.removeEventListener('touchmove', _punctTouchGuard);
  if (st.line && st.line.parentNode) st.line.parentNode.removeChild(st.line);
  st.row.style.transform = '';
  st.row.classList.remove('punct-dragging');
  document.body.classList.remove('punct-drag-active');
  if (!st.active) return;
  // A felengedést követő „szellem-kattintás" (címke → mező-fókusz) elnyelése.
  _punctSuppressClick();
  if (!commit) return;
  // Sorrend-változás index-alapon (nem `nextSibling`-gel: a konténerben
  // szövegcsomópont is állhat két sor között).
  var rows = _punctRows();
  var curIdx = rows.indexOf(st.row);
  var tgtIdx = st.before ? rows.indexOf(st.before) : rows.length;
  if (tgtIdx > curIdx) tgtIdx--;                           // önmagát kivéve
  if (tgtIdx === curIdx) return;                           // ugyanoda engedte vissza
  if (st.before) st.pc.insertBefore(st.row, st.before);
  else           st.pc.appendChild(st.row);
  _punctRenumber();
  if (typeof _syncTripTimesFromPuncte === 'function') _syncTripTimesFromPuncte();
  draftSave();
  st.row.classList.add('punct-dropped');
  setTimeout(function () { st.row.classList.remove('punct-dropped'); }, 500);
}

function _punctSuppressClick() {
  var sup = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
  document.addEventListener('click', sup, true);
  setTimeout(function () { document.removeEventListener('click', sup, true); }, 350);
}

// A helyi (böngésző) mai dátum YYYY-MM-DD alakban — a per-tétel dátum-mező
// alapértelmezett értéke (a sofőr csak akkor módosítja, ha nem ma tankolt/
// vásárolt).
function _todayLocalDate(){
  var d = new Date();
  var p = function(n){ return String(n).padStart(2,'0'); };
  return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
}

// ── Menetlevél Plecare/Sosire dialógus (indulási/érkezési hely) ──
// A sofőr az ÚJ menetlevél nyitásakor beírja, honnan indul (Plecare); a
// beküldéskor beírja, hova érkezett (Sosire). Alap: az utoljára használt
// helyszín (localStorage), első alkalommal „Garaj-Arcus". A dátum kötelező
// (alap: ma), az óra+perc opcionális. A kitöltött értékek egy új Plecare/
// Sosire puncte-sort adnak a menetlevélhez, és a cég-szintű memória a
// KÖVETKEZŐ menetlevélnél is felajánlja.
var LS_GARAJ_START = 'vs_sofer_garaj_start';
var LS_GARAJ_END   = 'vs_sofer_garaj_end';
var GARAJ_DEFAULT  = 'Garaj-Arcus';
// A memoriál sofőrönként külön: a közös telefonra több sofőr is beléphet,
// az ő „garaj"-uk lehet más. A kulcshoz a bejelentkezett email-t fűzzük;
// visszafelé kompatibilitás: ha nincs még sofőr-specifikus érték, egyszer
// átvesszük a régi (közös) kulcsot fallbackként.
function _driverStoreKey(base) {
  var email = (typeof _meData === 'object' && _meData && _meData.email) ? String(_meData.email).toLowerCase() : '';
  return base + (email ? ':' + email : '');
}
function _getLastLoc(baseKey) {
  try {
    var perDriver = localStorage.getItem(_driverStoreKey(baseKey));
    if (perDriver && perDriver.trim()) return perDriver;
    var shared = localStorage.getItem(baseKey);       // legacy közös érték
    return (shared && shared.trim()) ? shared : GARAJ_DEFAULT;
  } catch (e) { return GARAJ_DEFAULT; }
}
function _setLastLoc(baseKey, val) {
  try { if (val && val.trim()) localStorage.setItem(_driverStoreKey(baseKey), val.trim()); } catch (e) {}
}

// JSON per-driver helper — a mentett menetlevél-piszkozat + AI bon-scan
// várólista + minden más „a következő menetlevélre megjegyzett" adat
// ugyanezt a mintát követi. Legacy közös kulcs egyszeri fallback (nem
// írjuk felül, csak átvesszük a következő mentésig).
function _perDriverGetJson(baseKey, defaultVal) {
  try {
    var perDriver = localStorage.getItem(_driverStoreKey(baseKey));
    if (perDriver !== null) return JSON.parse(perDriver);
    var legacy = localStorage.getItem(baseKey);
    if (legacy !== null) {
      try { localStorage.setItem(_driverStoreKey(baseKey), legacy); } catch (e) {}
      return JSON.parse(legacy);
    }
    return (typeof defaultVal !== 'undefined') ? defaultVal : null;
  } catch (e) { return (typeof defaultVal !== 'undefined') ? defaultVal : null; }
}
// A mentés NEM nyelheti el csendben a hibát: ha a localStorage megtelt
// (a bon-várólista thumbnail-jei a fő fogyasztók), a sofőr azt hinné,
// hogy mentett — pedig semmi nem íródott ki. Ezért teli tárnál előbb
// helyet csinálunk (régi bon-thumbnailek eldobása), majd újrapróbáljuk;
// ha még így sem megy, SZÓLUNK.
var _quotaWarned = false;
function _perDriverSetJson(baseKey, val) {
  var key = _driverStoreKey(baseKey);
  var payload = JSON.stringify(val == null ? null : val);
  try {
    localStorage.setItem(key, payload);
    return true;
  } catch (e) {
    // 1) Helyfelszabadítás: a bon-várólista képei a legnagyobb tételek.
    try {
      var q = _perDriverGetJson(LS_RCPT_QUEUE_KEY, []) || [];
      if (q.length) {
        q.forEach(function (it) { it.thumb = ''; });          // a thumbnail elhagyható
        localStorage.setItem(_driverStoreKey(LS_RCPT_QUEUE_KEY), JSON.stringify(q));
      }
    } catch (_) {}
    try {
      localStorage.setItem(key, payload);
      return true;
    } catch (e2) {
      // 2) Tényleg nincs hely → egyszeri figyelmeztetés a sofőrnek.
      if (!_quotaWarned) {
        _quotaWarned = true;
        try { toast(t('sof.storageFull'), 'err'); } catch (_) {}
      }
      return false;
    }
  }
}

// wbLocDialog(kind, cb): kind = 'start' | 'end'; cb(null) = mégse, cb({loc,date,time})
function wbLocDialog(kind, cb) {
  var m = document.getElementById('wbLocModal');
  if (!m) { cb(null); return; }
  var isStart = (kind === 'start');
  var lastLoc = isStart ? _getLastLoc(LS_GARAJ_START) : _getLastLoc(LS_GARAJ_END);
  document.getElementById('wbLocTitle').textContent = isStart ? t('sof.wb.startTitle') : t('sof.wb.endTitle');
  document.getElementById('wbLocHint').textContent  = isStart ? t('sof.wb.startHint')  : t('sof.wb.endHint');
  document.getElementById('wbLocInput').value = lastLoc;
  document.getElementById('wbLocDate').value  = _todayLocalDate();
  // Az óra:perc KÖTELEZŐ, ezért a MOSTANI időt ajánljuk fel alapértéknek:
  // a sofőr az indulás/érkezés pillanatában nyitja meg ezt a párbeszédet,
  // így jellemzően csak jóváhagyja. Átírható.
  var _now = new Date();
  document.getElementById('wbLocHour').value = String(_now.getHours()).padStart(2, '0');
  document.getElementById('wbLocMin').value  = String(_now.getMinutes()).padStart(2, '0');
  document.getElementById('wbLocOk').onclick = function () {
    var loc = document.getElementById('wbLocInput').value.trim();
    if (!loc) { toast(t('sof.wb.locRequired'), 'err'); return; }
    // Dátum KÖTELEZŐ — a menetlevél „Út időpontjai" (kezdő/záró dátum)
    // ebből képződik, ezért nem lehet üres. Az alapérték a ma, de a
    // sofőr átírhatja; kiürítés + OK = hibaüzenet.
    var date = (document.getElementById('wbLocDate').value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast(t('sof.wb.dateRequired'), 'err'); return; }
    // ÓRA:PERC is KÖTELEZŐ — a diurna 12:00-szabállyal dolgozik (az indulás
    // napja csak <12:00 esetén számít, az érkezés napja csak >12:00 esetén),
    // ezért óra nélkül nem lehet pontosan számolni. A régi „üres → 12:00"
    // alapérték pont a határon állt, és csendben ELDOBTA az első és az
    // utolsó napot.
    var hhRaw = String(document.getElementById('wbLocHour').value || '').trim();
    var mmRaw = String(document.getElementById('wbLocMin').value  || '').trim();
    if (hhRaw === '' || mmRaw === '') { toast(t('sof.wb.timeRequired'), 'err'); return; }
    var h = parseInt(hhRaw, 10), mn = parseInt(mmRaw, 10);
    if (isNaN(h) || isNaN(mn) || h < 0 || h > 23 || mn < 0 || mn > 59) {
      toast(t('sof.wb.timeInvalid'), 'err'); return;
    }
    var timeStr = String(h).padStart(2, '0') + ':' + String(mn).padStart(2, '0');
    _setLastLoc(isStart ? LS_GARAJ_START : LS_GARAJ_END, loc);
    m.style.display = 'none';
    cb({ loc: loc, date: date, time: timeStr });
  };
  document.getElementById('wbLocCancel').onclick = function () {
    m.style.display = 'none';
    cb(null);
  };
  m.style.display = 'flex';
  setTimeout(function () {
    var el = document.getElementById('wbLocInput');
    if (el) { el.focus(); try { el.select(); } catch (e) {} }
  }, 100);
}

function addAlimRow(a) {
  alimIdx++;
  a = a || {};
  var dt = (typeof a.data === 'string' && a.data) ? a.data.slice(0,10) : _todayLocalDate();
  var d = document.createElement('div');
  d.className = 'dyn-row';
  d.innerHTML = '<button class="del-row" onclick="this.parentNode.remove();draftSave()">✕</button>'
    + '<div class="g2">'
    + '<div class="field"><label>' + t('sof.location') + '</label><input class="input alim-loc" list="sug-alim-loc" placeholder="' + t('sof.alimLocPh') + '" value="' + (a.loc || '') + '" oninput="draftSave()"></div>'
    + '<div class="field"><label>' + t('sof.date') + '</label><input class="input alim-data" type="date" value="' + dt + '" onchange="draftSave()"></div>'
    + '</div>'
    + '<div class="g2">'
    + '<div class="field"><label>' + t('sof.fuelType') + '</label><select class="input alim-tip" style="padding:10px 14px;" onchange="draftSave()"><option' + (a.tip === 'AdBlue' ? '' : ' selected') + '>Motorină</option><option' + (a.tip === 'AdBlue' ? ' selected' : '') + '>AdBlue</option></select></div>'
    + '<div class="field"><label>' + t('sof.liters') + '</label><input class="input alim-lit" type="number" value="' + (a.litru || '0') + '" inputmode="numeric" oninput="draftSave()"></div>'
    + '</div>'
    + '<div class="g3">'
    + '<div class="field"><label>' + t('sof.km') + '</label><input class="input alim-km" type="number" value="' + (a.km || '0') + '" inputmode="numeric" oninput="draftSave()"></div>'
    + '<div class="field"><label>' + t('sof.payment') + '</label><select class="input alim-plata" style="padding:10px 14px;" onchange="draftSave()"><option>Card</option><option>Cash</option><option>Flota Card</option><option>DKV</option></select></div>'
    + '<div class="field"><label>' + t('sof.sumRon') + '</label><input class="input alim-suma" type="number" value="' + (a.suma || '0') + '" inputmode="numeric" oninput="draftSave()"></div>'
    + '</div>';
  document.getElementById('alimentariContainer').appendChild(d);
  // Plată visszaállítás
  if (a.plata) {
    var sel = d.querySelector('.alim-plata');
    if (sel) sel.value = a.plata;
  }
}

function addAchRow(a) {
  achIdx++;
  a = a || {};
  var dt = (typeof a.data === 'string' && a.data) ? a.data.slice(0,10) : _todayLocalDate();
  var d = document.createElement('div');
  d.className = 'dyn-row';
  d.innerHTML = '<button class="del-row" onclick="this.parentNode.remove();draftSave()">✕</button>'
    + '<div class="field"><label>' + t('sof.product') + '</label><input class="input ach-prod" list="sug-ach-prod" placeholder="' + t('sof.achProdPh') + '" value="' + (a.produs || '') + '" oninput="draftSave()"></div>'
    + '<div class="g3">'
    + '<div class="field"><label>' + t('sof.location') + '</label><input class="input ach-loc" list="sug-ach-loc" placeholder="' + t('sof.achLocPh') + '" value="' + (a.loc || '') + '" oninput="draftSave()"></div>'
    + '<div class="field"><label>' + t('sof.date') + '</label><input class="input ach-data" type="date" value="' + dt + '" onchange="draftSave()"></div>'
    + '<div class="field"><label>' + t('sof.sumRon') + '</label><input class="input ach-pret" type="number" value="' + (a.pret || '0') + '" inputmode="numeric" oninput="draftSave()"></div>'
    + '</div>'
    + '<div class="field"><label>' + t('sof.payment') + '</label><select class="input ach-plata" style="padding:10px 14px;" onchange="draftSave()"><option>Card</option><option>Cash</option><option>Flota Card</option><option>DKV</option></select></div>';
  document.getElementById('achizitiiContainer').appendChild(d);
  if (a.plata) {
    var sel = d.querySelector('.ach-plata');
    if (sel) sel.value = a.plata;
  }
}

// ============================================================
// 📷 BON SZKENNELÉS (AI) — HÁTTÉR-FELDOLGOZÁS + PERZISZTENS
// VÁRÓLISTA. A sofőr főoldalról vagy a menetlevél 2. lépéséből
// koppinthat egy bonra; a fájl kliens-oldalon (canvas) lekicsinyül,
// és háttérben (fetch, keepalive) elindul a Gemini kiolvasás. A
// sofőr közben mást csinál, akár ki is lép a képernyőről; a
// feldolgozott bonok „Bon eredmények" kártyaként jelennek meg a
// főoldalon — kattintásra elfogadhatók (a menetlevél-piszkozatba
// kerülnek) vagy elvethetők.
//
// Perzisztencia: a metaadat (státusz, kiolvasott mezők, thumbnail) a
// localStorage-ban (LS_RCPT_QUEUE_KEY), a TELJES fotó pedig az
// IndexedDB-ben (`_rcptImg*`) — utóbbi addig őrzi, amíg a sofőr el nem
// fogadja vagy el nem dobja a kiolvasást, így megszakadt feldolgozás
// után sem kell újra fotózni.
// ============================================================

// Ha az admin/manager a Menetlevelek fülön KIKAPCSOLTA az AI-t (vagy
// nincs GEMINI_API_KEY a szerveren), a főoldali + menetlevél-lépés-2
// bon-szkennelés gombjai NE látszódjanak — értelmetlen lenne értük
// koppintani. A szerver oldalán is védve van (scanReceipt tiltás), ez
// csak a UI-t igazítja. Ha a hívás sikertelen (pl. régi szerver, ahol
// a getMyBonScanEnabled RPC még nem létezik), inkább MUTATJUK a
// gombot (biztonságosabb → a szerver úgyis eldönti).
function applyBonScanVisibility() {
  fetch('/api/execute', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getMyBonScanEnabled' })
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var r = (d && d.result) || {};
      // Alapból: mutass — ne rejts pillanatra betöltéskor.
      if (r.ok === false) { _setBonScanVisible(true); return; }
      _setBonScanVisible(!!r.usable, r);
    })
    .catch(function () { _setBonScanVisible(true); });
}

// `visible=false` esetén NEM tüntetjük el némán a gombot: a sofőr csak
// annyit látna, hogy „nem működik az AI". Helyette letiltva marad, és
// kiírjuk a KONKRÉT okot (nincs API-kulcs a szerveren / a cégnél ki van
// kapcsolva) — így a hibajelentés is használható lesz.
function _setBonScanVisible(visible, diag) {
  var reason = '';
  if (!visible && diag) {
    if (diag.hasKey === false)      reason = t('sof.scan.noKey');
    else if (diag.enabled === false) reason = t('sof.scan.disabled');
    else                             reason = t('sof.scan.unavailable');
  }
  var applyBtn = function (b) {
    if (!b) return;
    b.style.display = '';                       // marad látható, csak tiltott
    b.disabled = !visible;
    b.classList.toggle('scan-btn-off', !visible);
    if (!visible) b.title = reason;
    else b.removeAttribute('title');
  };
  // Főoldali narancs kártya (a dashboard-on) + a menetlevél scan-gombjai
  var dashCard = document.querySelector('.dash-scan-card');
  if (dashCard) {
    dashCard.style.display = '';
    applyBtn(dashCard.querySelector('.dash-scan-btn'));
    var note = dashCard.querySelector('.scan-off-note');
    if (!visible) {
      if (!note) {
        note = document.createElement('div');
        note.className = 'scan-off-note';
        dashCard.appendChild(note);
      }
      note.textContent = reason;
    } else if (note) { note.remove(); }
  }
  document.querySelectorAll('#fuvarStep1 .scan-btn, #fuvarStep2 .scan-btn').forEach(applyBtn);
  var step1Pending = document.getElementById('fuvarStep1PendingBox');
  if (step1Pending && !visible) { step1Pending.style.display = 'none'; }
}
var _receiptScanKind = null;     // 'fuel' | 'purchase' | null (dashboardról jött)
var LS_RCPT_QUEUE_KEY = 'vs_sofer_receipt_queue';
var RCPT_MAX_ITEMS    = 20;      // a régiek magától kiesnek (FIFO)

// A bon-scan várólista sofőrönként külön (`_perDriverGetJson`): egy közös
// telefonon másik sofőr nem látja/nem tudja elfogadni az előző sofőr
// scannelt bonjait. Legacy közös kulcs egyszeri fallback (nem íródik
// felül; a következő mentés már csak a per-driver kulcsba kerül).
function rcptQueueLoad() { return _perDriverGetJson(LS_RCPT_QUEUE_KEY, []) || []; }
function rcptQueueStore(arr) {
  // Régi elemek levágása (méret-védelem — FIFO)
  _perDriverSetJson(LS_RCPT_QUEUE_KEY, (arr || []).slice(-RCPT_MAX_ITEMS));
}
function rcptQueueAdd(item) {
  var q = rcptQueueLoad(); q.push(item); rcptQueueStore(q); return item.id;
}
function rcptQueueUpdate(id, patch) {
  var q = rcptQueueLoad();
  for (var i = 0; i < q.length; i++) if (q[i].id === id) {
    q[i] = Object.assign({}, q[i], patch); rcptQueueStore(q); return q[i];
  }
  return null;
}
// A tétel véglegesen lekerül a listáról — elfogadva (`rrAccept`) VAGY
// eldobva (`rrRemove`/`rrDiscard`). Csak ITT töröljük a megőrzött képet
// is: egyetlen ponton, hogy egyik út se hagyjon szemetet, és egyik se
// dobja el a fotót idő előtt.
function rcptQueueRemove(id) {
  var q = rcptQueueLoad().filter(function (x) { return x.id !== id; });
  rcptQueueStore(q);
  _rcptImgDel(id);
}
function rcptNewId() {
  return 'r' + Date.now() + Math.random().toString(36).slice(2, 8);
}

// ============================================================
// ORPHAN BIN — árva tankolás/vásárlás sorok, amiknek nincs (még) menetlevele
// ============================================================
// Ha a sofőr scannel egy bont VAGY kézzel írt be tankolást/vásárlást,
// de közben törli / még nincs menetlevele, ez az adat NEM veszhet el:
// az orphan bin megőrzi a sort, és a következő menetlevél kezdésekor
// egy popup ablakban felajánljuk hozzáadásra. Ha be sem rakja, akkor a
// menetlevél beküldése előtt még egyszer szólunk, ha a sor dátuma az
// indulás–érkezés ablakba esik (date-only, nem óra).
// Formátum: { alim: [{loc,data,tip,litru,km,plata,suma}], ach: [{...}] }
var LS_ORPHAN_KEY = 'vs_sofer_orphan_items';

function orphanLoad() {
  var o = _perDriverGetJson(LS_ORPHAN_KEY, { alim: [], ach: [] }) || {};
  return { alim: Array.isArray(o.alim) ? o.alim : [], ach: Array.isArray(o.ach) ? o.ach : [] };
}
function orphanStore(o) {
  _perDriverSetJson(LS_ORPHAN_KEY, {
    alim: (o && Array.isArray(o.alim)) ? o.alim : [],
    ach:  (o && Array.isArray(o.ach))  ? o.ach  : []
  });
}
function orphanAddAlim(row) { var o = orphanLoad(); o.alim.push(row); orphanStore(o); }
function orphanAddAch(row)  { var o = orphanLoad(); o.ach.push(row);  orphanStore(o); }
function orphanClearAll()   { orphanStore({ alim: [], ach: [] }); }
function orphanCount()      { var o = orphanLoad(); return (o.alim.length + o.ach.length); }

// Az aktuális draft alim/ach sorait az orphan binbe menti (törlés/discard
// előtt hívjuk). Csak a valódi tartalmú sorokat vesszük fel — az üresen
// hagyott „➕ hozzáadás" sorokat kihagyjuk, hogy ne szemeteljenek.
function orphanSaveFromDraft(draft) {
  if (!draft) return 0;
  var added = 0;
  var alim = Array.isArray(draft.alimentari) ? draft.alimentari : [];
  var ach  = Array.isArray(draft.achizitii)  ? draft.achizitii  : [];
  alim.forEach(function (a) {
    if (!a) return;
    var hasContent = (a.loc || a.data ||
                      (parseFloat(a.litru) || 0) || (parseFloat(a.km) || 0) ||
                      (parseFloat(a.suma)  || 0));
    if (hasContent) { orphanAddAlim(a); added++; }
  });
  ach.forEach(function (a) {
    if (!a) return;
    var hasContent = (a.loc || a.data || a.produs || (parseFloat(a.pret) || 0));
    if (hasContent) { orphanAddAch(a); added++; }
  });
  return added;
}

// ============================================================
// BON-KÉP MEGŐRZÉS (IndexedDB) — a fotó nem veszhet el, amíg a
// kiolvasás elfogadva nincs
// ============================================================
// Eddig CSAK a 128px-es thumbnail került a localStorage-ba, a teljes kép
// kizárólag a `_scanReceiptTry` closure-jében élt. Ha az app közben
// leállt (OS háttér-kilövés), a sofőr elhagyta a képernyőt, vagy mind a
// 3 retry elbukott, a kép VÉGLEG elveszett: a tétel „error"-ra váltott,
// ahol csak ✕ volt → újra kellett fotózni, pedig a bon addigra sokszor
// már a kukában van.
//
// Miért IndexedDB és nem localStorage: egy 1600px-es JPEG base64-je
// 100–500 KB, a várólista max 20 tétel → akár 10 MB. A localStorage
// kvótája jellemzően 5 MB, és azon OSZTOZIK a menetlevél-piszkozattal —
// ha a képek megtöltenék, a piszkozat mentése hasalna el, ami pontosan
// az előző kör (#298) adatvesztésének a gyökere volt. Az IndexedDB
// kvótája nagyságrenddel nagyobb és külön tárterület → a piszkozat
// sosem szorul ki miatta.
//
// A kép törlése CSAK elfogadáskor (`rrAccept`) vagy kifejezett eldobáskor
// (`rrRemove`/`rrDiscard`) történik. Ha az IndexedDB nem elérhető (privát
// mód, régi böngésző), minden a régi módon fut tovább — csak a megőrzés
// marad el, semmi nem törik el.
var RCPT_IDB_NAME     = 'vs_sofer_receipts';
var RCPT_IDB_STORE    = 'images';
var RCPT_IMG_MAX_DAYS = 14;          // gazdátlan kép végső takarítása
var _rcptIdb = null, _rcptIdbFailed = false;

function _rcptIdbOpen(cb) {
  if (_rcptIdb) { cb(_rcptIdb); return; }
  if (_rcptIdbFailed || typeof indexedDB === 'undefined') { cb(null); return; }
  try {
    var req = indexedDB.open(RCPT_IDB_NAME, 1);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(RCPT_IDB_STORE)) {
        db.createObjectStore(RCPT_IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = function () { _rcptIdb = req.result; cb(_rcptIdb); };
    req.onerror   = function () { _rcptIdbFailed = true; cb(null); };
  } catch (e) { _rcptIdbFailed = true; cb(null); }
}

// A képet a tétel id-jével tároljuk; a `driver` mező azért kell, hogy a
// közös telefonon a takarítás ne nyúljon a MÁSIK sofőr képeihez.
function _rcptImgPut(id, payload, cb) {
  cb = cb || function () {};
  _rcptIdbOpen(function (db) {
    if (!db) { cb(false); return; }
    try {
      var tx = db.transaction(RCPT_IDB_STORE, 'readwrite');
      tx.objectStore(RCPT_IDB_STORE).put({
        id: id,
        driver: _driverStoreKey(''),
        mimeType: payload.mimeType,
        data: payload.data,
        savedAt: Date.now()
      });
      tx.oncomplete = function () { cb(true); };
      tx.onerror    = function () { cb(false); };
      tx.onabort    = function () { cb(false); };
    } catch (e) { cb(false); }
  });
}

function _rcptImgGet(id, cb) {
  _rcptIdbOpen(function (db) {
    if (!db) { cb(null); return; }
    try {
      var req = db.transaction(RCPT_IDB_STORE, 'readonly').objectStore(RCPT_IDB_STORE).get(id);
      req.onsuccess = function () {
        var r = req.result;
        cb(r && r.data ? { mimeType: r.mimeType, data: r.data } : null);
      };
      req.onerror = function () { cb(null); };
    } catch (e) { cb(null); }
  });
}

function _rcptImgDel(id) {
  _rcptIdbOpen(function (db) {
    if (!db) return;
    try { db.transaction(RCPT_IDB_STORE, 'readwrite').objectStore(RCPT_IDB_STORE).delete(id); } catch (e) {}
  });
}

// Gazdátlan képek takarítása: amit a JELENLEGI sofőr várólistája már nem
// tartalmaz (elfogadta/eldobta egy régebbi munkamenetben), plusz bármely
// sofőr RCPT_IMG_MAX_DAYS-nél régebbi képe (végső védőháló, hogy egy
// vissza nem térő sofőr képei se hízzanak a végtelenségig).
function _rcptImgPrune() {
  _rcptIdbOpen(function (db) {
    if (!db) return;
    try {
      var live = {};
      rcptQueueLoad().forEach(function (it) { live[it.id] = true; });
      var me = _driverStoreKey('');
      var cutoff = Date.now() - RCPT_IMG_MAX_DAYS * 24 * 60 * 60 * 1000;
      var store = db.transaction(RCPT_IDB_STORE, 'readwrite').objectStore(RCPT_IDB_STORE);
      var req = store.openCursor();
      req.onsuccess = function () {
        var cur = req.result;
        if (!cur) return;
        var v = cur.value || {};
        var mine = (v.driver === me);
        if ((mine && !live[v.id]) || (v.savedAt || 0) < cutoff) cur.delete();
        cur.continue();
      };
    } catch (e) {}
  });
}

// A főoldali „📷 Bon szkennelés" gomb — a Gemini dönti el, tankolás
// vagy vásárlás (a szerver „kind"-ja fehérlistázott).
function scanReceiptPickFromDash() {
  _receiptScanKind = null;
  var f = document.getElementById('receiptScanFile');
  if (!f) return;
  f.value = '';
  f.click();
}

// A menetlevél 2. lépésének két gombja (fuel/purchase) — a felhasználó
// választása fallback, ha a Gemini nem tud dönteni.
function scanReceiptPick(kind) {
  _receiptScanKind = (kind === 'purchase') ? 'purchase' : 'fuel';
  var f = document.getElementById('receiptScanFile');
  if (!f) return;
  f.value = '';
  f.click();
}

// Kép lekicsinyítése base64-be + thumbnail. PDF-nél nincs thumbnail (a
// FileReader csak a nyers base64-et adja); a queue-listán ikonnal jelöljük.
function _receiptToPayload(file, cb) {
  if (!file) { cb(null); return; }
  if (file.type === 'application/pdf') {
    var fr = new FileReader();
    fr.onload = function () {
      var s = String(fr.result || '');
      var i = s.indexOf(',');
      cb({ mimeType: 'application/pdf', data: i >= 0 ? s.slice(i + 1) : s, thumb: '' });
    };
    fr.onerror = function () { cb(null); };
    fr.readAsDataURL(file);
    return;
  }
  var img = new Image();
  var url = URL.createObjectURL(file);
  img.onload = function () {
    try {
      // Full képet a szerverre (1600px hosszú oldal, JPEG q=0.85).
      var maxDim = 1600;
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      var scale = Math.min(1, maxDim / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
      var fullDataUrl = cv.toDataURL('image/jpeg', 0.85);
      var i = fullDataUrl.indexOf(',');
      var b64 = i >= 0 ? fullDataUrl.slice(i + 1) : fullDataUrl;
      // Külön kis thumbnail (128px), csak megjelenítéshez.
      var tScale = Math.min(1, 128 / Math.max(w, h));
      var tw = Math.round(w * tScale), th = Math.round(h * tScale);
      var tv = document.createElement('canvas');
      tv.width = tw; tv.height = th;
      tv.getContext('2d').drawImage(img, 0, 0, tw, th);
      var thumb = tv.toDataURL('image/jpeg', 0.7);
      cb({ mimeType: 'image/jpeg', data: b64, thumb: thumb });
    } catch (e) { cb(null); }
    finally { URL.revokeObjectURL(url); }
  };
  img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
  img.src = url;
}

// Háttérben elindítjuk a feldolgozást; a UI azonnal frissül (van egy új
// „processing" sor a listában), és a sofőr mást csinálhat.
//
// FONTOS: a scan-fetch NEM `keepalive:true` — a Fetch-spec a keepalive
// kéréseket 64 KiB body-ra korlátozza. Egy 1600px-re méretezett JPEG
// base64-je is bőven 100–500 KB → keepalive-vel a böngésző el se küldi
// (TypeError → .catch() → „Nem sikerült beolvasni a bont"). Ez volt a
// gyökérok, amiért a bon-scan látszólag „nem működött". A perzisztens
// localStorage queue + a queueMaint 3-perces takarítás gondoskodik
// arról, hogy oldal-elhagyáskor sem vész el semmi (a folyamatban lévő
// sor error-ra vált, a sofőr újra tudja fotózni).
function scanReceiptStart(file) {
  var busy = document.getElementById('receiptScanBusy');
  if (busy) busy.style.display = 'block';
  _receiptToPayload(file, function (payload) {
    if (busy) busy.style.display = 'none';
    if (!payload) { toast(t('sof.scanReadErr'), 'err'); return; }

    // Új queue-elem: a localStorage-ba csak a metaadat + a kis thumbnail
    // megy, a TELJES kép az IndexedDB-be (`_rcptImgPut`).
    var id = rcptNewId();
    rcptQueueAdd({
      id: id,
      createdAt: Date.now(),
      status: 'processing',
      kindHint: _receiptScanKind, // 'fuel' | 'purchase' | null
      thumb: payload.thumb || '',
      fields: null,
      error: null,
      hasImage: false             // az IDB-mentés sikere után igaz
    });
    renderPendingReceipts();
    toast(t('sof.scanQueued'), 'ok');

    // A képet a HÁLÓZATI hívás ELŐTT tesszük el: ha a fetch közben az OS
    // kilövi az appot, a fotó akkor is megvan, és a sofőr egy koppintással
    // újraindíthatja a kiolvasást (nem kell újra fotózni).
    _rcptImgPut(id, payload, function (saved) {
      if (saved) { rcptQueueUpdate(id, { hasImage: true }); renderPendingReceipts(); }
      // Auto-retry hálózati vagy átmeneti szerver-hibánál (429/503/5xx).
      // Nem-átmeneti hibáknál (400, tiltás, konfig-hiba) azonnal error →
      // NINCS auto-retry, de a kép megmarad → kézi újrapróbálás lehet.
      _scanReceiptTry(id, payload, 0);
    });
  });
}

// Kézi újrapróbálás a MEGŐRZÖTT képből — az „error" tétel 🔄 gombja.
// Nincs újrafotózás: a kép az IndexedDB-ben van a felvétel pillanata óta.
function rrRetry(id) {
  var it = rcptQueueLoad().find(function (x) { return x.id === id; });
  if (!it) return;
  rcptQueueUpdate(id, { status: 'processing', error: null, attempt: null, maxAttempts: null });
  renderPendingReceipts();
  _rcptImgGet(id, function (payload) {
    if (!payload) {
      // A kép mégsem elérhető (IDB nincs / kitakarítva) — őszintén megmondjuk.
      rcptQueueUpdate(id, { status: 'error', error: t('sof.rr.interrupted'), hasImage: false });
      renderPendingReceipts();
      return;
    }
    _scanReceiptTry(id, payload, 0);
  });
}

// Egy próbálkozás — sikertelenség esetén rekurzívan indítja a következőt
// backoff-fal. `attempt` 0-alapú; MAX_ATTEMPTS a felső határ.
function _scanReceiptTry(id, payload, attempt) {
  var MAX_ATTEMPTS = 3;
  var BACKOFFS = [0, 5000, 15000]; // 0s, 5s, 15s — kb. 20 mp max összesen
  // FIGYELEM: `BACKOFFS[attempt] || 15000` NEM jó — a legelső próbánál
  // (attempt=0) a tömbérték 0, ami HAMIS, így a `||` 15 000-re váltott:
  // minden bon-scan 15 másodpercet várt az ELSŐ kérés előtt is. A sofőr
  // ennyit nézte a pörgő spinnert, mielőtt bármi elindult volna.
  var wait = (attempt < BACKOFFS.length) ? BACKOFFS[attempt] : 15000;

  // A queue-elemet frissítjük, hogy a UI mutassa a próbálkozás-számot.
  if (attempt > 0) {
    rcptQueueUpdate(id, {
      status: 'processing', error: null,
      attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS
    });
    renderPendingReceipts();
  }

  setTimeout(function () {
    // NINCS `keepalive:true` — a base64 kép jellemzően 100–500 KB, a
    // spec 64 KiB-re korlátozza a keepalive body-t → TypeError → .catch().
    // A perzisztens localStorage queue + a queueMaint 3 perces takarítás
    // fedezi az oldal-elhagyás esetét (ld. a scanReceiptStart komment).
    fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName: 'scanReceipt', arguments: [{
        mimeType: payload.mimeType, data: payload.data
      }] })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var r = (d && d.result) || {};
        if (r.ok) {
          var f = r.fields || {};
          var kind = (f.kind === 'fuel' || f.kind === 'purchase')
            ? f.kind
            : (_receiptScanKind || 'purchase');
          rcptQueueUpdate(id, { status: 'ready', fields: f, kind: kind, attempt: null, maxAttempts: null });
          renderPendingReceipts();
          return;
        }
        // Átmeneti szerver-hiba: 429 (kvóta/limit), 503 (túlterhelés),
        // 5xx (belső hiba). Végleges: 400 (rossz kérés), 403 (tiltás),
        // egyéb 4xx → nincs értelme újrapróbálni.
        var status = r.status || 0;
        var transient = (status === 429 || status === 503 || status >= 500);
        if (transient && attempt + 1 < MAX_ATTEMPTS) {
          _scanReceiptTry(id, payload, attempt + 1);
          return;
        }
        rcptQueueUpdate(id, { status: 'error', error: r.err || t('sof.scanFailed'), attempt: null, maxAttempts: null });
        renderPendingReceipts();
      })
      .catch(function () {
        // Hálózati hiba → mindig átmeneti, retry-oljuk (a MAX-ig).
        if (attempt + 1 < MAX_ATTEMPTS) {
          _scanReceiptTry(id, payload, attempt + 1);
          return;
        }
        rcptQueueUpdate(id, { status: 'error', error: t('sof.scanFailed'), attempt: null, maxAttempts: null });
        renderPendingReceipts();
      });
  }, wait);
}

// A főoldali kártya frissítése.
function renderPendingReceipts() {
  // Több konténer is lehet: a főoldali kártya és a menetlevél 1. lépése
  // (az egyesített „Menetlevél létrehozása" képernyő) — ugyanaz a várólista.
  var boxes = document.querySelectorAll('.pending-receipts-box');
  if (!boxes.length) return;
  var q = rcptQueueLoad();
  if (!q.length) {
    boxes.forEach(function (b) { b.style.display = 'none'; b.innerHTML = ''; });
    return;
  }
  var html = q.slice().reverse().map(function (it) {
    var badge = '', title = '';
    if (it.status === 'processing') {
      var attSuffix = (it.attempt && it.maxAttempts)
        ? ' (' + it.attempt + '/' + it.maxAttempts + ')'
        : '';
      badge = '<span class="pending-badge pb-processing">' + t('sof.rr.processing') + attSuffix + '</span>';
      title = (it.attempt && it.attempt > 1) ? t('sof.rr.retrying') : t('sof.rr.processingTitle');
    } else if (it.status === 'ready') {
      badge = '<span class="pending-badge pb-ready">' + t('sof.rr.ready') + '</span>';
      var f = it.fields || {};
      // Gemini-kiolvasás → a `loc`/`valuta` mezőt a szerver `_sanitize`
      // (fehérlistázott max-hossz), DE nem HTML-escape-eli. A `title`
      // közvetlenül a `innerHTML`-be kerül lentebb, ezért ITT escape kell.
      title = (it.kind === 'fuel' ? '⛽ ' : '🛒 ') + esc(f.loc || '—')
            + (f.suma != null ? (' · ' + esc(f.suma) + ' ' + esc(f.valuta || '')) : '');
    } else {
      badge = '<span class="pending-badge pb-error">' + t('sof.rr.error') + '</span>';
      // Az `it.error` szerver-oldali hibaüzenet — a `receiptScan.js` 300
      // karakteren csonkolja, de nem HTML-escape-eli. Escape kell, mert
      // a `title` közvetlenül `innerHTML`-be kerül.
      title = esc(it.error || t('sof.scanFailed'));
      if (it.hasImage) title += ' · ' + esc(t('sof.rr.photoKept'));
    }
    var timeStr = new Date(it.createdAt).toLocaleTimeString();
    var thumb = it.thumb
      ? '<img class="pending-thumb" src="' + it.thumb + '" alt="">'
      : '<div class="pending-thumb" style="display:flex;align-items:center;justify-content:center;font-size:22px;">📄</div>';
    var actions = '';
    if (it.status === 'ready') {
      actions = '<button class="btn-mini ok" onclick="rrOpen(\'' + it.id + '\')">' + t('sof.rr.review') + '</button>'
              + '<button class="btn-mini err" onclick="rrRemove(\'' + it.id + '\')">✕</button>';
    } else if (it.status === 'error') {
      // A megőrzött képből egy koppintással újraindítható a kiolvasás.
      actions = (it.hasImage
                  ? '<button class="btn-mini ok" onclick="rrRetry(\'' + it.id + '\')">' + t('sof.rr.retry') + '</button>'
                  : '')
              + '<button class="btn-mini err" onclick="rrRemove(\'' + it.id + '\')">✕</button>';
    } else {
      actions = '<div class="spinner"></div>';
    }
    return '<div class="pending-item">'
      + thumb
      + '<div class="pending-body"><div class="pending-title">' + badge + title + '</div>'
      + '<div class="pending-sub">' + timeStr + '</div></div>'
      + '<div class="pending-actions">' + actions + '</div>'
      + '</div>';
  }).join('');
  boxes.forEach(function (b) { b.style.display = 'block'; b.innerHTML = html; });
}

// ─── Review modal — a sofőr átnézheti/javíthatja a mezőket, majd
// elfogadhatja (a menetlevél-piszkozatba kerül).
var _rrCurrentId = null;

function rrOpen(id) {
  var q = rcptQueueLoad();
  var it = null;
  for (var i = 0; i < q.length; i++) if (q[i].id === id) { it = q[i]; break; }
  if (!it || it.status !== 'ready') return;
  _rrCurrentId = id;

  var thumbEl = document.getElementById('rrThumbWrap');
  var imgStyle = 'max-width:120px;max-height:120px;border-radius:10px;border:1px solid var(--border);';
  thumbEl.innerHTML = it.thumb
    ? '<img src="' + it.thumb + '" style="' + imgStyle + '">'
    : '';
  // Ha a thumbnailt a localStorage kvóta-védelme eldobta (`_perDriverSetJson`),
  // a megőrzött teljes képből pótoljuk — a sofőr lássa, MELYIK bont nézi át.
  if (!it.thumb && it.hasImage) {
    _rcptImgGet(id, function (payload) {
      if (!payload || _rrCurrentId !== id || !thumbEl) return;
      thumbEl.innerHTML = '<img src="data:' + payload.mimeType + ';base64,' + payload.data
                        + '" style="' + imgStyle + '">';
    });
  }

  var f = it.fields || {};
  var isFuel = it.kind === 'fuel';
  var esc2 = function (v) { return (v == null) ? '' : String(v).replace(/"/g, '&quot;'); };
  var fields = document.getElementById('rrFields');
  var plataOpts = ['Card', 'Cash', 'Flota Card', 'DKV'].map(function (p) {
    return '<option' + (f.plata === p ? ' selected' : '') + '>' + p + '</option>';
  }).join('');
  var rows = '';
  rows += '<div class="rr-row"><label>' + t('sof.rr.kind') + '</label>'
        + '<select id="rrKind"><option value="fuel"' + (isFuel ? ' selected' : '') + '>⛽ ' + t('sof.rr.kindFuel') + '</option>'
        + '<option value="purchase"' + (!isFuel ? ' selected' : '') + '>🛒 ' + t('sof.rr.kindPurchase') + '</option></select></div>';
  rows += '<div class="rr-row"><label>' + t('sof.location') + '</label><input id="rrLoc" value="' + esc2(f.loc) + '"></div>';
  rows += '<div class="rr-row"><label>' + t('sof.date') + '</label><input id="rrData" type="date" value="' + esc2(f.data || _todayLocalDate()) + '"></div>';
  if (isFuel) {
    rows += '<div class="rr-row"><label>' + t('sof.fuelType') + '</label>'
          + '<select id="rrTip"><option' + (f.tip === 'AdBlue' ? '' : ' selected') + '>Motorină</option>'
          + '<option' + (f.tip === 'AdBlue' ? ' selected' : '') + '>AdBlue</option></select></div>';
    rows += '<div class="rr-row"><label>' + t('sof.liters') + '</label><input id="rrLitru" type="number" value="' + esc2(f.litru != null ? f.litru : 0) + '"></div>';
    rows += '<div class="rr-row"><label>' + t('sof.km') + '</label><input id="rrKm" type="number" value="' + esc2(f.km != null ? f.km : 0) + '"></div>';
  } else {
    rows += '<div class="rr-row"><label>' + t('sof.product') + '</label><input id="rrProdus" value="' + esc2(f.produs) + '"></div>';
  }
  rows += '<div class="rr-row"><label>' + t('sof.sumRon') + '</label><input id="rrSuma" type="number" value="' + esc2(f.suma != null ? f.suma : 0) + '"></div>';
  rows += '<div class="rr-row"><label>' + t('sof.payment') + '</label><select id="rrPlata">' + plataOpts + '</select></div>';
  fields.innerHTML = rows;

  // A „kind" váltásra újrarajzol (fuel↔purchase mezők váltása).
  document.getElementById('rrKind').addEventListener('change', function () {
    var it2 = rcptQueueLoad().find(function (x) { return x.id === _rrCurrentId; });
    if (!it2) return;
    it2.kind = document.getElementById('rrKind').value;
    // A már beírt közös mezőket megőrizzük (loc/data/suma/plata),
    // hogy a váltás után ne vesszen el a sofőr munkája.
    var cur = { loc: (document.getElementById('rrLoc') || {}).value, data: (document.getElementById('rrData') || {}).value,
                suma: (document.getElementById('rrSuma') || {}).value, plata: (document.getElementById('rrPlata') || {}).value };
    it2.fields = Object.assign({}, it2.fields || {}, cur);
    rcptQueueUpdate(_rrCurrentId, { kind: it2.kind, fields: it2.fields });
    rrOpen(_rrCurrentId);
  });

  document.getElementById('receiptReviewModal').style.display = 'flex';
}

function rrClose() {
  document.getElementById('receiptReviewModal').style.display = 'none';
  _rrCurrentId = null;
}

function rrDiscard() {
  if (!_rrCurrentId) { rrClose(); return; }
  if (!confirm(t('sof.rr.confirmDiscard'))) return;
  rrRemove(_rrCurrentId);
  rrClose();
}

function rrRemove(id) {
  rcptQueueRemove(id);
  renderPendingReceipts();
}

// A modal mezői → a sessionStorage-i menetlevél-piszkozatba egy új
// tankolás vagy vásárlás sor; ha a menetlevél 2. lépés éppen nyitva,
// a DOM sor is beszúródik.
function rrAccept() {
  if (!_rrCurrentId) return;
  var kind = (document.getElementById('rrKind') || {}).value || 'purchase';
  var loc  = (document.getElementById('rrLoc')  || {}).value || '';
  var data = (document.getElementById('rrData') || {}).value || _todayLocalDate();
  var suma = (document.getElementById('rrSuma') || {}).value || '0';
  var plata= (document.getElementById('rrPlata')|| {}).value || 'Card';

  var newRow;
  if (kind === 'fuel') {
    var tip   = (document.getElementById('rrTip')   || {}).value || 'Motorină';
    var litru = (document.getElementById('rrLitru') || {}).value || '0';
    var km    = (document.getElementById('rrKm')    || {}).value || '0';
    newRow = { loc: loc, data: data, tip: tip, litru: litru, km: km, plata: plata, suma: suma };
  } else {
    var produs = (document.getElementById('rrProdus') || {}).value || '';
    newRow = { produs: produs, loc: loc, data: data, pret: suma, plata: plata };
  }

  // Ha a menetlevél 2. lépés (fuvarStep2) nyitva van → közvetlenül a DOM-ba
  // teszem a sort (és a draftSave menti automatikusan). Ha step2 nem nyitva,
  // DE van megkezdett draft (a sofőr félbehagyta) → a draft alimentari/
  // achizitii listájához fűzöm, hogy a következő megnyitásnál látszódjon.
  // Ha NINCS draft ÉS nincs step2 → NEM hozunk létre üres draft-ot csak
  // ezért; az adat az orphan binbe kerül, és a következő menetlevél
  // kezdésekor felajánljuk hozzáadásra. (Így nem keletkezik "árva" üres
  // menetlevél-piszkozat, ami folyton felajánlja a folytatást.)
  var step2 = document.getElementById('fuvarStep2');
  var step2Visible = step2 && step2.style.display !== 'none';
  if (step2Visible && ((kind === 'fuel' && typeof addAlimRow === 'function')
                    || (kind === 'purchase' && typeof addAchRow === 'function'))) {
    if (kind === 'fuel') addAlimRow(newRow); else addAchRow(newRow);
    try { draftSave(); } catch (_) {}
  } else {
    var st = stateGet();
    if (st && st.draft) {
      // Van megkezdett menetlevél → beleillesztjük az új sort a piszkozatba.
      var draft = st.draft;
      if (kind === 'fuel') { draft.alimentari = draft.alimentari || []; draft.alimentari.push(newRow); }
      else { draft.achizitii = draft.achizitii || []; draft.achizitii.push(newRow); }
      stateSave({ draft: draft });
    } else {
      // Nincs menetlevél — orphan binbe, majd a következő menetlevél
      // kezdésekor a popup felajánlja hozzáadásra.
      if (kind === 'fuel') orphanAddAlim(newRow);
      else                 orphanAddAch(newRow);
    }
  }

  // ── TANULÁS: a sofőr által megerősített (esetleg javított) mezőket
  // elküldjük a szervernek, hogy a receipt_scan_samples-be kerüljenek
  // template-ként. Legközelebb ugyanattól a kereskedőtől (MOL/OMV/
  // Kaufland stb.) beérkező bonok pontosabban kiolvasódnak — a Gemini
  // few-shot promptja tartalmazni fogja a mostani mezőket. Best-effort:
  // hiba esetén NEM törünk semmit (a piszkozatba már bekerült a sor).
  try {
    // Az eredeti queue-tétel valuta-ja (a modal-ban nem szerkeszthető)
    var _q = rcptQueueLoad(), _origVal = null;
    for (var _i = 0; _i < _q.length; _i++) {
      if (_q[_i].id === _rrCurrentId && _q[_i].fields) { _origVal = _q[_i].fields.valuta || null; break; }
    }
    var confirmed = {
      kind: kind,
      loc: loc,
      data: data,
      plata: plata,
      suma: parseFloat(suma) || null,
      valuta: _origVal,
      tip:    (kind === 'fuel')     ? tip : null,
      litru:  (kind === 'fuel')     ? (parseFloat(litru) || null) : null,
      km:     (kind === 'fuel')     ? (parseFloat(km)    || null) : null,
      produs: (kind === 'purchase') ? produs : null,
      confidence: 1.0
    };
    fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ functionName: 'confirmReceiptExtraction', arguments: [{ fields: confirmed }] })
    }).catch(function () { /* best-effort — a UI menete független */ });
  } catch (_) { /* nincs baj — csak nem tanul ebből a bonból */ }

  toast(t('sof.rr.accepted'), 'ok');
  rcptQueueRemove(_rrCurrentId);
  renderPendingReceipts();
  rrClose();
}

document.addEventListener('DOMContentLoaded', function () {
  var f = document.getElementById('receiptScanFile');
  if (f) f.addEventListener('change', function () {
    if (f.files && f.files[0]) scanReceiptStart(f.files[0]);
  });

  // Ha az előző munkamenetben a fetch nem tudott befejeződni (app leállt,
  // hálózat megszakadt), a „processing" tétel örökké függőben maradna →
  // átvisszük „error"-ra, hogy legalább el lehessen vetni. A már ready
  // (kiolvasott) és error tételek maradnak. Küszöb: 3 perc — hogy a
  // legrosszabb esetben (3 retry × 30s Gemini timeout + 20s backoff)
  // se törjük meg a folyamatot, ami még lehet, hogy csak most fejeződik be.
  renderPendingReceipts();
});

// A várólista karbantartása. FONTOS: ezt CSAK az authMe után szabad
// futtatni — a lista kulcsa per-sofőr (`_driverStoreKey`), és amíg a
// `_meData` nincs meg, a csupasz (legacy) kulcsról olvasnánk, azaz a
// sofőr tételeit meg sem látnánk.
function rcptQueueMaint() {
  var q = rcptQueueLoad();
  var changed = false;
  var now = Date.now();
  var resume = [];
  for (var i = 0; i < q.length; i++) {
    if (q[i].status === 'processing' && (now - (q[i].createdAt || 0) > 3 * 60 * 1000)) {
      if (q[i].hasImage) {
        // A fotó megvan → nem zsákutca: magától folytatjuk a kiolvasást.
        resume.push(q[i].id);
      } else {
        q[i].status = 'error';
        q[i].error = t('sof.rr.interrupted');
        changed = true;
      }
    }
  }
  if (changed) rcptQueueStore(q);
  renderPendingReceipts();
  // A megszakadt tételek újraindítása a megőrzött képből (a sofőrnek nem
  // kell semmit tennie), majd a gazdátlan képek takarítása.
  resume.forEach(function (id) { rrRetry(id); });
  _rcptImgPrune();
}

// ============================================================
// HATÁRÁTLÉPÉS — CSAK a főoldali két gombból (GPS), kézi bevitel NINCS
// ============================================================
// A menetlevélről a kézi „➕ Átlépés hozzáadása" szekció eltávolítva: a
// sofőr a határon EGY gombot nyom (🇷🇴 BE / 🇷🇴 KI), az GPS-szel rögzül a
// `border_crossings` táblába, és a diurnát a szerver ebből számolja a
// menetlevél Plecare→Sosire dátum-ablakában. Itt csak MEGJELENÍTJÜK, mit
// talált a szerver — így a sofőr beküldés ELŐTT látja, ha lemaradt egy
// átlépés, és még pótolhatja a főoldali gombbal.
//
// Az előnézet UGYANAZT a szerver-számítást kéri le (`previewTripDiurna`),
// amit a mentés is használ → az előnézet és a mentett érték nem térhet el.
var _diurnaTimer = null;
var _diurnaLastKey = '';

function updateDiurnaPreview() {
  var el = document.getElementById('diurnaPreview');
  if (!el) return;
  var dep = (document.getElementById('fIndulasDt') || {}).value || '';
  var arr = (document.getElementById('fErkezesDt') || {}).value || '';

  if (!dep || !arr) {
    // Még nincs Plecare/Sosire dátum → megmondjuk, mi hiányzik.
    _diurnaLastKey = '';
    el.className = 'diurna-box empty';
    el.innerHTML = '<div class="diurna-hint">' + esc(t('sof.dr.needDates')) + '</div>';
    return;
  }

  // Ugyanarra az ablakra nem kérdezünk újra (a puncte-konténer minden
  // billentyűleütésre `input` eseményt küld a sync-en át).
  var key = dep + '|' + arr;
  if (key === _diurnaLastKey) return;
  _diurnaLastKey = key;

  clearTimeout(_diurnaTimer);
  _diurnaTimer = setTimeout(function () {
    fetch('/api/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName: 'previewTripDiurna', arguments: [{ indulasDt: dep, erkezesDt: arr }] })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var r = (d && d.result) || {};
        if (!r.ok) { _renderDiurnaBox(dep, arr, null); return; }
        _renderDiurnaBox(dep, arr, r);
      })
      .catch(function () {
        // Offline: a diurnát a szerver a beküldéskor úgyis kiszámolja —
        // itt csak jelezzük, hogy most nem tudjuk megmutatni.
        _diurnaLastKey = '';        // legyen újrapróbálható, ha visszajön a net
        _renderDiurnaBox(dep, arr, null);
      });
  }, 350);
}

function _renderDiurnaBox(dep, arr, r) {
  var el = document.getElementById('diurnaPreview');
  if (!el) return;
  var depD = String(dep).slice(0, 10), arrD = String(arr).slice(0, 10);
  var head = '<div class="diurna-window">🕐 ' + esc(depD) + ' → ' + esc(arrD)
           + (r && r.days ? ' · ' + r.days + ' ' + esc(t('sofer.days')) : '') + '</div>';

  if (!r) {
    el.className = 'diurna-box';
    el.innerHTML = head + '<div class="diurna-hint">' + esc(t('sof.dr.offline')) + '</div>';
    return;
  }

  var list = r.crossings || [];
  if (!list.length) {
    // Nincs átlépés az ablakban — ez lehet teljesen helyes (belföldi út),
    // de ha külföldön járt, most tudja pótolni. Gomb a főoldali rögzítőre.
    el.className = 'diurna-box empty';
    el.innerHTML = head
      + '<div class="diurna-hint">' + esc(t('sof.dr.none')) + '</div>'
      + '<button type="button" class="diurna-go" onclick="goSec(\'border\')">'
      + esc(t('sof.dr.goRecord')) + '</button>';
    return;
  }

  var rows = list.map(function (c) {
    var isIn = c.direction === 'IN';
    var when = '';
    try { when = new Date(c.datetime).toLocaleString(t('sof.locale'), {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { when = String(c.datetime || ''); }
    return '<div class="diurna-row">'
      + '<span class="diurna-dir ' + (isIn ? 'in' : 'out') + '">'
      + esc(isIn ? t('sofer.crossIn') : t('sofer.crossOut')) + '</span>'
      + '<span class="diurna-when">' + esc(when) + '</span>'
      + (c.locatie ? '<span class="diurna-loc">📍 ' + esc(c.locatie) + '</span>' : '')
      + '</div>';
  }).join('');

  el.className = 'diurna-box';
  el.innerHTML = head
    + '<div class="diurna-count">' + list.length + ' ' + esc(t('sofer.crossingCount')) + '</div>'
    + rows
    + '<div class="diurna-hint">' + esc(t('sof.dr.hint')) + '</div>'
    + '<button type="button" class="diurna-go" onclick="goSec(\'border\')">'
    + esc(t('sof.dr.goRecord')) + '</button>';
}

// ============================================================
// MENETLEVÉL BEKÜLDÉS
// ============================================================
// A záró km NEM lehet kisebb a kezdőnél — a szerver ezt eddig csendben
// 0 km-re vágta (0 fogyasztással), és a hibás menetlevél hivatalos
// bizonylattá vált. Blokkoló; `true` = mehet tovább.
function _validateKm() {
  var s = _kmFuelState();
  if (s.kmSf > 0 && s.km < 0) {
    toast(t('sof.km.negative'), 'err');
    updateKmFuelCheck();
    try {
      var el = document.getElementById('fKmSf');
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
    } catch (e) {}
    return false;
  }
  return true;
}

function submitFuvarlevel() {
  // ── SoferTour demó-intercept: a bemutató alatt a menetlevél-küldést
  //    nem hajtjuk végre (élesben MT-YYYY-XXXX sorszámot kapna).
  if (window.SoferTour && window.SoferTour.demoIntercept &&
      window.SoferTour.demoIntercept('waybill', 'Menetlevél beküldés')) {
    return;
  }
  // Ha még nincs Sosire (érkezési) sor a puncte-ban, elsőként azt kérdezzük
  // be egy modal-on (a sofőr megadja, hová érkezett). Ha mégse — nem
  // küldünk. Ha van már Sosire, egyből megy a beküldés (retry, vagy a
  // sofőr korábban maga adott hozzá).
  // A km-ellenőrzés MÉG A SOSIRE-DIALÓGUS ELŐTT fut: különben a sofőr
  // előbb kitölti az érkezési helyet/időt, és csak utána derülne ki, hogy
  // a km hibás — felesleges kör.
  if (!_validateKm()) return;
  // Lezárási védőháló: az indulás UTÁN elvégzett Finalizat fuvar nem
  // maradhat kimaradva. Ha van ilyen, felkínáljuk a pickert (a validátor
  // maga hívja meg), és most nem küldünk. A sofőr a pickerben pipálja
  // be, majd újra ráüt a beküldés gombra.
  if (typeof _validateNoLeftoverOrders === 'function' && !_validateNoLeftoverOrders()) return;

  var hasSosire = false;
  document.querySelectorAll('#puncteContainer .dyn-row').forEach(function (row) {
    if ((row.querySelector('.punct-tip') || {}).value === 'Sosire') hasSosire = true;
  });
  if (!hasSosire) {
    wbLocDialog('end', function (res) {
      if (!res) return;   // Mégse — nem küldünk, marad az űrlap
      addPunctRow(res.loc, 'Sosire', res.date, { time: res.time });
      draftSave();
      _submitFuvarlevelFinal();
    });
    return;
  }
  _submitFuvarlevelFinal();
}

function _submitFuvarlevelFinal() {
  // Az „Út időpontjai" (fIndulasDt/fErkezesDt) mostantól a Plecare/Sosire
  // pontok dátumából automatikusan képződik. Beküldés előtt egy utolsó
  // sync — biztosan a legfrissebb értékek kerüljenek a payload-ba.
  if (typeof _syncTripTimesFromPuncte === 'function') _syncTripTimesFromPuncte();

  // A Plecare és a Sosire soron a HELYSZÍN, a DÁTUM és az ÓRA is kötelező:
  // ezekből képződik a diurna-ablak, és a 12:00-szabály miatt az óra a
  // napidíjat is befolyásolja. A modal mindhármat bekéri, de a sor utólag
  // szerkeszthető (és kézzel is felvehető) — itt fogjuk meg.
  var _missing = null, _missingField = null;
  document.querySelectorAll('#puncteContainer .dyn-row').forEach(function (row) {
    if (_missing) return;
    var tip = (row.querySelector('.punct-tip') || {}).value;
    if (tip !== 'Plecare' && tip !== 'Sosire') return;
    var lv = ((row.querySelector('.punct-loc')  || {}).value || '').trim();
    var dv = (row.querySelector('.punct-data') || {}).value || '';
    var tv = (row.querySelector('.punct-time') || {}).value || '';
    if (!lv)                                   { _missing = row; _missingField = '.punct-loc'; }
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(dv))  { _missing = row; _missingField = '.punct-data'; }
    else if (!/^\d{2}:\d{2}$/.test(tv))        { _missing = row; _missingField = '.punct-time'; }
  });
  if (_missing) {
    toast(t(_missingField === '.punct-loc' ? 'sof.wb.tripLocMissing' : 'sof.wb.tripTimeMissing'), 'err');
    try {
      _missing.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var el = _missing.querySelector(_missingField);
      if (el) el.focus();
    } catch (e) {}
    return;
  }

  // Beküldés előtt: ha az orphan binben van olyan (korábban félbehagyott
  // / bon-alapú) tankolás vagy vásárlás sor, aminek DÁTUMA az indulás–
  // érkezés napok közé esik (óra nem számít), a rendszer szól. A sofőr
  // eldönti: hozzáadja a menetlevélhez VAGY törli a binből (nyilván nem
  // ide tartozik). Ha nincs ilyen sor → azonnal tovább az összegzőre.
  var _orphRange = _orphanRangeItems();
  if (_orphRange.length) {
    _openOrphanRangeModal(_orphRange, function () {
      // A sofőr döntése után folytatjuk a beküldést a normál módon
      // (a modal action-jai vagy hozzáadtak/töröltek, vagy nem).
      wbConfirmOpen();
    });
    return;
  }

  // Utolsó lépés: összegző + megerősítés. A menetlevél MT-YYYY-XXXX
  // sorszámot kap és nem vonható vissza, ezért a sofőr lássa, mi megy el.
  wbConfirmOpen();
}

// Az orphan binből azokat a sorokat adja vissza, amiknek dátuma az
// aktuális indulás–érkezés DÁTUM-ablakba esik (óra nem számít, ahogy
// a felhasználó kérte). Formátum: [{ src:'bin', kind, idx, row }].
function _orphanRangeItems() {
  var dep = (document.getElementById('fIndulasDt') || {}).value || '';
  var arr = (document.getElementById('fErkezesDt') || {}).value || '';
  var depD = dep ? String(dep).slice(0, 10) : '';
  var arrD = arr ? String(arr).slice(0, 10) : '';
  if (!depD || !arrD) return [];
  // Ha valaki fordítva írta be, az összehasonlítás legyen szimmetrikus
  var lo = depD, hi = arrD;
  if (lo > hi) { var _tmp = lo; lo = hi; hi = _tmp; }
  var bin = orphanLoad();
  var res = [];
  (bin.alim || []).forEach(function (a, i) {
    var d = a && a.data ? String(a.data).slice(0, 10) : '';
    if (d && d >= lo && d <= hi) res.push({ src: 'bin', kind: 'fuel', idx: i, row: a });
  });
  (bin.ach || []).forEach(function (a, i) {
    var d = a && a.data ? String(a.data).slice(0, 10) : '';
    if (d && d >= lo && d <= hi) res.push({ src: 'bin', kind: 'purchase', idx: i, row: a });
  });
  return res;
}

var _orphRangeCb = null;
var _orphRangeItemsCache = [];

function _openOrphanRangeModal(items, cb) {
  var m = document.getElementById('orphRangeModal');
  var list = document.getElementById('orphRangeList');
  if (!m || !list) { if (typeof cb === 'function') cb(); return; }   // régi HTML
  _orphRangeCb = cb || function () {};
  _orphRangeItemsCache = items || [];
  list.innerHTML = items.map(function (it, i) {
    var r = it.row || {};
    var icon = (it.kind === 'fuel') ? '⛽' : '🛒';
    var d = r.data ? esc(String(r.data).slice(0, 10)) : '—';
    var sumNum = (it.kind === 'fuel') ? (parseFloat(r.suma) || 0) : (parseFloat(r.pret) || 0);
    var sum = '';
    if (sumNum) { try { sum = sumNum.toLocaleString(t('sof.locale')) + ' RON'; } catch (_) { sum = String(sumNum) + ' RON'; } }
    var loc = r.loc || r.produs || '—';
    return '<label class="pa-item">'
      + '<input type="checkbox" class="or-chk" data-i="' + i + '" checked>'
      + '<div class="pa-body">'
      + '<div class="pa-head">' + icon + ' ' + esc(loc) + '</div>'
      + '<div class="pa-sub">📅 ' + d + (sum ? ' · 💵 ' + esc(sum) : '') + '</div>'
      + '</div>'
      + '</label>';
  }).join('');
  m.style.display = 'flex';
}

function orphRangeAdd() {
  // A pipáltakat hozzáadja a menetlevélhez (a DOM-ba is, hogy a beküldő
  // gyűjtő látni fogja őket), és törli az orphan binből.
  var selIdx = [];
  document.querySelectorAll('#orphRangeList .or-chk').forEach(function (cb) {
    if (cb.checked) selIdx.push(parseInt(cb.getAttribute('data-i'), 10));
  });
  var toRemoveAlim = {}, toRemoveAch = {};
  selIdx.forEach(function (i) {
    var it = _orphRangeItemsCache[i];
    if (!it) return;
    if (it.kind === 'fuel') { addAlimRow(it.row); toRemoveAlim[it.idx] = true; }
    else                    { addAchRow(it.row);  toRemoveAch[it.idx]  = true; }
  });
  var bin = orphanLoad();
  bin.alim = (bin.alim || []).filter(function (_a, i) { return !toRemoveAlim[i]; });
  bin.ach  = (bin.ach  || []).filter(function (_a, i) { return !toRemoveAch[i];  });
  orphanStore(bin);
  try { draftSave(); } catch (_) {}
  _closeOrphRange();
}

function orphRangeDelete() {
  // A pipáltakat TÖRLI az orphan binből (nem tartoznak ide) — nem kerülnek
  // a menetlevélre.
  if (!confirm(t('sof.or.confirmDelete'))) return;
  var selIdx = [];
  document.querySelectorAll('#orphRangeList .or-chk').forEach(function (cb) {
    if (cb.checked) selIdx.push(parseInt(cb.getAttribute('data-i'), 10));
  });
  var toRemoveAlim = {}, toRemoveAch = {};
  selIdx.forEach(function (i) {
    var it = _orphRangeItemsCache[i];
    if (!it) return;
    if (it.kind === 'fuel') toRemoveAlim[it.idx] = true;
    else                    toRemoveAch[it.idx]  = true;
  });
  var bin = orphanLoad();
  bin.alim = (bin.alim || []).filter(function (_a, i) { return !toRemoveAlim[i]; });
  bin.ach  = (bin.ach  || []).filter(function (_a, i) { return !toRemoveAch[i];  });
  orphanStore(bin);
  _closeOrphRange();
}

function orphRangeCancel() {
  // Mégse: sem nem adja hozzá, sem nem törli (a bin változatlan);
  // folytatás a beküldő összegzővel.
  _closeOrphRange();
}

function _closeOrphRange() {
  var m = document.getElementById('orphRangeModal');
  if (m) m.style.display = 'none';
  var cb = _orphRangeCb; _orphRangeCb = null; _orphRangeItemsCache = [];
  if (typeof cb === 'function') cb();
}

// ── Beküldés-összegző (mit küldünk el?) ─────────────────────────────
function wbConfirmOpen() {
  var m = document.getElementById('wbConfirmModal');
  var body = document.getElementById('wbConfirmBody');
  if (!m || !body) { _submitFuvarlevelSend(); return; }   // régi HTML → egyből küld

  var s = _kmFuelState();
  var puncte = _collectPuncte();
  var alim = _collectAlim(true), ach = _collectAch(true);
  var dep = (document.getElementById('fIndulasDt') || {}).value || '';
  var arr = (document.getElementById('fErkezesDt') || {}).value || '';
  var fmtDt = function (v) { return v ? String(v).replace('T', ' ') : '—'; };
  var nf = function (n, unit) {
    return (isFinite(n) ? n.toLocaleString(t('sof.locale'), { maximumFractionDigits: 1 }) : '0') + (unit || '');
  };
  var row = function (label, val, cls) {
    return '<div class="cf-row' + (cls ? ' ' + cls : '') + '">'
      + '<span class="cf-lbl">' + esc(label) + '</span>'
      + '<span class="cf-val">' + esc(val) + '</span></div>';
  };

  var html = '';
  html += row(t('sof.cf.trip'), fmtDt(dep) + '  →  ' + fmtDt(arr));
  html += row(t('sof.cf.plate'),
    ((document.getElementById('fCamion') || {}).value || '—')
    + (((document.getElementById('fRemorca') || {}).value) ? ' / ' + document.getElementById('fRemorca').value : ''));
  html += row(t('sof.km.driven'), nf(s.km, ' km'));
  if (s.l100 != null) {
    var outOfRange = (s.l100 < FUEL_MIN_L100 || s.l100 > FUEL_MAX_L100);
    html += row(t('sof.km.consumption'), s.l100.toFixed(1) + ' L/100km', outOfRange ? 'warn' : '');
  }
  html += row(t('sof.cf.points'), String(puncte.length));
  html += row(t('sof.cf.fuelings'), alim.length + ' · ' + nf(s.tankolt, ' L'));
  var achSum = 0; ach.forEach(function (a) { achSum += parseFloat(a.pret) || 0; });
  html += row(t('sof.cf.purchases'), ach.length + (achSum ? ' · ' + nf(achSum, ' RON') : ''));
  html += row(t('sof.cf.orders'), String((_selectedOrderIds || []).length));
  body.innerHTML = html;
  m.style.display = 'flex';
}
function wbConfirmCancel() {
  var m = document.getElementById('wbConfirmModal');
  if (m) m.style.display = 'none';
}
function wbConfirmGo() {
  wbConfirmCancel();
  _submitFuvarlevelSend();
}

// A tényleges beküldés — a validációk és a megerősítő összegző UTÁN fut.
function _submitFuvarlevelSend() {
  // Km-ellenőrzés (a `submitFuvarlevel` már lefuttatta a Sosire-dialógus
  // előtt; itt a közvetlen/retry hívási útra ismételjük meg).
  if (!_validateKm()) return;
  var fisa = (document.getElementById('fFisa') ? document.getElementById('fFisa').value.trim() : '');
  // Sorszámot a szerver generálja automatikusan

  // Fuvar-visszakötő tag-ek (`orderId`/`role`) + a Plecare/Sosire órája is
  // benne van — a közös gyűjtő adja, ugyanaz, amit a piszkozat ment.
  var puncte     = _collectPuncte();
  var alimentari = _collectAlim(true);
  var achizitii  = _collectAch(true);

  // Az indulási/érkezési helyszín TÍPUS szerint (nem pozíció szerint): a
  // pont-sorok húzással átrendezhetők, így a Plecare/Sosire nem feltétlenül
  // az első/utolsó sor. Fallback a régi pozíció-alapú viselkedésre.
  var _byTip = function (tip) {
    for (var i = 0; i < puncte.length; i++) if (puncte[i].tip === tip) return puncte[i];
    return null;
  };
  var _lastByTip = function (tip) {
    for (var i = puncte.length - 1; i >= 0; i--) if (puncte[i].tip === tip) return puncte[i];
    return null;
  };
  var _pl = _byTip('Plecare'), _so = _lastByTip('Sosire');
  var locPlecare = _pl ? _pl.loc : (puncte.length ? puncte[0].loc : '');
  var locSosire  = _so ? _so.loc : (puncte.length > 1 ? puncte[puncte.length - 1].loc : '');

  var payload = {
    numarFisa: fisa,
    numarCamion: document.getElementById('fCamion').value,
    numarRemorca: document.getElementById('fRemorca').value,
    kmInceput: document.getElementById('fKmInc').value,
    kmSfarsit: document.getElementById('fKmSf').value,
    locPlecare: locPlecare,
    locSosire: locSosire,
    indulasDt: document.getElementById('fIndulasDt').value || null,
    erkezesDt: document.getElementById('fErkezesDt').value || null,
    // `hataratok` NEM megy a payloadban: a szerver a sofőr GPS-rögzítéseiből
    // (`border_crossings`) gyűjti be az indulás→érkezés ablakra, és abból
    // számolja a diurnát. Kézi bevitel nincs.
    cantInceput: document.getElementById('fCantInc').value,
    cantSfarsit: document.getElementById('fCantSf').value,
    alteMentiuni: document.getElementById('fMentiuni').value,
    puncte: puncte,
    alimentari: alimentari,
    achizitii: achizitii,
    tranzite: [],
    orderIds: _selectedOrderIds
  };

  fetch('/api/fuvarlevel-save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload) })
  .then(function(r) { return r.json(); }).then(function(d) {
    if (d.success) {
      toast(d.docNumber ? (t('sof.waybillSentNum', { num: d.docNumber })) : t('sof.waybillSent'), 'ok');
      draftClear();
      // Sikeres beküldés után a hozzá tartozó HELYI piszkozatot is töröljük
      // (ha mentett piszkozatból indult), és frissítjük a listát.
      if (_curLocalDraftId) {
        soferStoreLocalDrafts(soferLoadLocalDrafts().filter(function (x) { return x.id !== _curLocalDraftId; }));
        _curLocalDraftId = null;
        if (typeof renderLocalDrafts === 'function') renderLocalDrafts();
      }
      _selectedOrderIds = [];
      _autoStopFilter = null;
      goSec('dash');
      setTimeout(function() {
        document.getElementById('fuvarStep1').style.display = '';
        document.getElementById('fuvarStep2').style.display = 'none';
        document.getElementById('alimentariContainer').innerHTML = '';
        document.getElementById('achizitiiContainer').innerHTML = '';
        document.getElementById('puncteContainer').innerHTML = '';
        if(document.getElementById('fFisa')) document.getElementById('fFisa').value = '';
        document.getElementById('fCamion').value = '';
        document.getElementById('fRemorca').value = '';
        document.getElementById('fKmInc').value = '0';
        document.getElementById('fKmSf').value = '0';
        document.getElementById('fCantInc').value = '0';
        document.getElementById('fCantSf').value = '0';
        document.getElementById('fMentiuni').value = '';
        document.getElementById('fIndulasDt').value = '';
        document.getElementById('fErkezesDt').value = '';
        _diurnaLastKey = '';
        if (typeof updateDiurnaPreview === 'function') updateDiurnaPreview();
        alimIdx = 0; achIdx = 0; punctIdx = 0;
        loadSoferOrders();
      }, 500);
    } else {
      toast(t('common.error') + ': ' + (d.err || t('sof.unknown')), 'err');
    }
  }).catch(function() {
    // Nincs internet a beküldéshez → az adat NE vesszen el: a telefonra
    // mentjük, és KÜLDÉSRE VÁRÓ-ra jelöljük. Innentől a rendszer magától
    // újrapróbálja (hálózat visszatér / app előtérbe kerül / indulás) —
    // a sofőrnek nem kell emlékeznie rá.
    saveLocalDraft(true);
    _outboxMark(_curLocalDraftId, true);
    renderLocalDrafts();
    toast(t('sof.outbox.queued'), 'err');
  });
}

// ============================================================
// KIMENŐ SOR (OUTBOX) — offline beküldés automatikus újraküldése
// ============================================================
// A bon-scannernek volt auto-retry-a, a MENETLEVÉLNEK — ami sokkal
// fontosabb — nem: offline beküldésnél az adat elmentődött a telefonra,
// de a sofőrnek KELLETT emlékeznie, hogy visszatérjen és újraküldje.
// Innentől a küldésre váró piszkozatot a rendszer magától megpróbálja
// elküldeni, amint van hálózat.
var _outboxBusy = false;

function _outboxMark(id, pending) {
  if (!id) return;
  var arr = soferLoadLocalDrafts();
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].id === id) { arr[i].pendingSubmit = !!pending; break; }
  }
  soferStoreLocalDrafts(arr);
}

function _outboxPending() {
  return soferLoadLocalDrafts().filter(function (d) { return d.pendingSubmit; });
}

// Egy tétel elküldése a MENTETT adatból (nem a DOM-ból) — a sofőr közben
// bármelyik képernyőn lehet, akár másik menetlevelet is szerkeszthet.
function _outboxSendOne(item, cb) {
  var d = item && item.data;
  if (!d) { cb(false); return; }
  var payload = {
    numarFisa: d.fisa || '',
    numarCamion: d.camion, numarRemorca: d.remorca,
    kmInceput: d.kmInc, kmSfarsit: d.kmSf,
    locPlecare: '', locSosire: '',
    indulasDt: d.indulasDt || null, erkezesDt: d.erkezesDt || null,
    cantInceput: d.cantInc, cantSfarsit: d.cantSf,
    alteMentiuni: d.mentiuni,
    puncte: d.puncte || [], alimentari: d.alimentari || [],
    achizitii: d.achizitii || [], tranzite: [],
    orderIds: d.orderIds || []
  };
  // Az indulási/érkezési helyszín a mentett pontokból, TÍPUS szerint.
  (payload.puncte || []).forEach(function (p) {
    if (p.tip === 'Plecare' && !payload.locPlecare) payload.locPlecare = p.loc || '';
    if (p.tip === 'Sosire') payload.locSosire = p.loc || '';
  });
  fetch('/api/fuvarlevel-save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(function (r) { return r.json(); })
    .then(function (res) { cb(!!(res && res.success), res && res.docNumber); })
    .catch(function () { cb(false); });
}

// Az összes küldésre váró tétel megpróbálása, egyesével. Sikeres küldés →
// a helyi piszkozat törlődik (mint a normál beküldésnél).
function outboxFlush(silent) {
  if (_outboxBusy) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  var pending = _outboxPending();
  if (!pending.length) return;
  _outboxBusy = true;
  var sent = 0, idx = 0;
  var next = function () {
    if (idx >= pending.length) {
      _outboxBusy = false;
      renderLocalDrafts();
      if (sent) {
        toast(t('sof.outbox.sent', { n: sent }), 'ok');
        try { loadSoferOrders(); } catch (e) {}
      }
      return;
    }
    var it = pending[idx++];
    _outboxSendOne(it, function (ok) {
      if (ok) {
        sent++;
        soferStoreLocalDrafts(soferLoadLocalDrafts().filter(function (x) { return x.id !== it.id; }));
        if (_curLocalDraftId === it.id) _curLocalDraftId = null;
      }
      next();                       // sikertelen → marad a sorban, később újra
    });
  };
  next();
}

// Kiváltók: hálózat visszatér, app előtérbe kerül, oldal-betöltés.
window.addEventListener('online', function () { outboxFlush(true); });
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') outboxFlush(true);
});
document.addEventListener('DOMContentLoaded', function () {
  setTimeout(function () { outboxFlush(true); }, 3000);
});

// ============================================================
// IRATOK
// ============================================================
var selDocTip = 'CMR';
function selDocType(el, tip) {
  selDocTip = tip;
  document.querySelectorAll('.doc-type-btn').forEach(function(b) { b.classList.remove('sel'); });
  el.classList.add('sel');
}
function previewFile(input) {
  var files = input.files ? Array.prototype.slice.call(input.files) : [];
  if (!files.length) return;
  // Több fájl is választható (egy CMR gyakran 3–4 lap) — a nevek felsorolva.
  var names = files.map(function (f) { return f.name; }).join(', ');
  document.getElementById('filePreviewName').textContent =
    '📎 ' + (files.length > 1 ? (files.length + ' × ') : '') + names;
  document.getElementById('filePreview').style.display = 'block';
}

// A fotót feltöltés ELŐTT lekicsinyítjük (max 2000px hosszú oldal, JPEG
// q=0.85): egy mai telefon-fotó nyersen 3–8 MB, base64-ben 4–11 MB — ez
// mobilneten lassú, gyakran elhasal, és a `documents.storage_url` base64
// szövegként hízik a DB-ben. 2000px-en az aláírás/pecsét bőven olvasható.
// PDF-et NEM alakítunk (marad az eredeti).
var DOC_MAX_DIM = 2000;
function _docToBase64(file, cb) {
  if (!file) { cb(null); return; }
  if (file.type === 'application/pdf' || !/^image\//.test(file.type || '')) {
    var fr = new FileReader();
    fr.onload = function () { cb(String(fr.result || '')); };
    fr.onerror = function () { cb(null); };
    fr.readAsDataURL(file);
    return;
  }
  var img = new Image();
  var url = URL.createObjectURL(file);
  img.onload = function () {
    try {
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      var scale = Math.min(1, DOC_MAX_DIM / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
      cb(cv.toDataURL('image/jpeg', 0.85));
    } catch (e) { cb(null); }
    finally { URL.revokeObjectURL(url); }
  };
  img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
  img.src = url;
}

var _docUploading = false;
function uploadDoc() {
  if (_docUploading) return;                      // dupla-koppintás védelem
  // ── SoferTour demó-intercept: bemutató alatt a dokumentum nem
  //    kerül a szerverre — csak vizuálisan próbáljuk.
  if (window.SoferTour && window.SoferTour.demoIntercept &&
      window.SoferTour.demoIntercept('doc', 'Dokumentum feltöltés')) {
    return;
  }
  var input = document.getElementById('dFile');
  var files = (input && input.files) ? Array.prototype.slice.call(input.files) : [];
  if (!files.length) { toast(t('sof.pickFile'), 'err'); return; }
  var orderId = (document.getElementById('docOrderSel') || {}).value || null;
  var btn = document.querySelector('#filePreview .submit-btn');
  var nameEl = document.getElementById('filePreviewName');
  _docUploading = true;
  if (btn) { btn.disabled = true; }

  var done = 0, failed = 0;
  var setProgress = function () {
    if (btn) btn.textContent = t('sof.doc.uploading', { n: done + 1, total: files.length });
  };
  var finish = function () {
    _docUploading = false;
    if (btn) { btn.disabled = false; btn.textContent = t('sofer.submit'); }
    if (input) input.value = '';
    if (nameEl) nameEl.textContent = '';
    document.getElementById('filePreview').style.display = 'none';
    if (failed && done) toast(t('sof.doc.partial', { ok: done, bad: failed }), 'err');
    else if (failed)    toast(t('common.error'), 'err');
    else { toast(t('common.uploaded'), 'ok'); goSec('dash'); }
  };

  // Sorosan töltünk fel (nem párhuzamosan): mobilneten megbízhatóbb, és a
  // haladás is követhető.
  var next = function (i) {
    if (i >= files.length) { finish(); return; }
    setProgress();
    _docToBase64(files[i], function (b64) {
      if (!b64) { failed++; done++; next(i + 1); return; }
      fetch('/api/doc-upload', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: b64, numeFisier: files[i].name, tip: selDocTip, orderId: orderId }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d.success) failed++; })
      .catch(function () { failed++; })
      .then(function () { done++; next(i + 1); });
    });
  };
  next(0);
}

// A fuvar-választó feltöltése a sofőr saját (aktív + friss) fuvarjaival.
// A dokumentum-feltöltésnél a nemrég lezárt fuvart is felkínáljuk (POD/CMR
// fotó utólagos csatolása), ezért waybill_visible-t használunk — nem dash_visible-t.
// (A főoldal dash_visible-je szigorúbb: Finalizat sosem látszik.)
function loadDocOrderOptions() {
  var sel = document.getElementById('docOrderSel');
  if (!sel) return;
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getMySoferOrders' }) })
  .then(function(r) { return r.json(); }).then(function(d) {
    var list = (d.result || []).filter(function(o) { return o.waybill_visible !== false; });
    // Olvasható fuvar-címke: felrakás dátum · cég · város  →  lerakás dátum · város · cég
    // (belső CMD-azonosító a sofőr felé sehol nem jelenik meg — az érték a select-en marad)
    sel.innerHTML = '<option value="">' + t('sofer.docNoOrder') + '</option>'
      + list.map(function(o) {
          var loadDay   = fmtFuvarDay(o.data_incarcare)  || '';
          var unloadDay = fmtFuvarDay(o.data_descarcare) || '';
          var loadCity   = _cityOf(o.loc_incarcare)   || (o.loc_incarcare   || '?');
          var unloadCity = _cityOf(o.loc_descarcare)  || (o.loc_descarcare  || '?');
          var loadFirma   = (o.firma_incarcare  || '').trim();
          var unloadFirma = (o.firma_descarcare || '').trim();
          var left  = [loadDay,  loadFirma,  loadCity ].filter(Boolean).join(' · ');
          var right = [unloadDay, unloadCity, unloadFirma].filter(Boolean).join(' · ');
          return '<option value="' + esc(o.id) + '">'
            + esc(left || '?') + '  →  ' + esc(right || '?')
            + '</option>';
        }).join('');
  }).catch(function() {});
}


// ============================================================
// LOGOUT
// ============================================================
function logoutSofer() {
  stateClear();
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'authLogout' }) })
  .then(function() { window.location.href = '/login'; })
  .catch(function() { window.location.href = '/login'; });
}

// ============================================================
// NEKEM KIOSZTOTT JÁRMŰ (vontató + pótkocsi) — főoldali kiírás
// ============================================================
// A Belső sofőrök fülön az admin/manager rendeli hozzám a vontatót + a hozzá
// tartozó alapértelmezett pótkocsit. Itt a főoldal tetején látom a rendszámo(ka)t,
// és a menetlevél ezekből tölt előre (szerkeszthetően).
var _myAssignedVehicle = null;
function loadMyAssignedVehicle() {
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getMyAssignedVehicle' }) })
  .then(function(r) { return r.json(); }).then(function(d) {
    var res = d && d.result;
    _myAssignedVehicle = (res && res.ok && res.assigned) ? res.assigned : null;
    var box = document.getElementById('myVehicleBox');
    if (!box) return;
    if (!_myAssignedVehicle || !_myAssignedVehicle.rendszam_camion) { box.style.display = 'none'; return; }
    var v = _myAssignedVehicle;
    // A márka-mező helyére a jármű-kártya jobb szélére egy kis Online/Offline
    // állapot-pirula kerül (`#myVehStatusBtn`). Alapból zöld „Online"; háttérben
    // ping-eli a szervert (`_vehStatusStart`) és `online`/`offline` eseményekre
    // is reagál. Ha offline, koppintásra ellenőriz + frissíti az adatokat
    // (loadDash/loadMini/loadMyAssignedVehicle) → NEM kell újralépni belépéssel,
    // mint eddig, hogy élő adatot lássunk. A CSS `.mv-status-btn`-nel.
    var trailerRow = v.rendszam_remorca
      ? '<div class="mv-row"><span class="mv-ico">🚛</span><span class="mv-plate">' + esc(v.rendszam_remorca) + '</span></div>'
      : '';
    box.innerHTML =
      '<div class="mv-card">' +
        '<div class="mv-head">' + t('sof.myVehicle') + '</div>' +
        '<div class="mv-row">' +
          '<span class="mv-ico">🚚</span>' +
          '<span class="mv-plate">' + esc(v.rendszam_camion) + '</span>' +
          '<button type="button" id="myVehStatusBtn" class="mv-status-btn is-online" ' +
            'onclick="vehStatusClick()" aria-label="' + esc(t('sof.stateOnline')) + '">' +
            '<span class="mv-status-dot"></span>' +
            '<span class="mv-status-txt">' + esc(t('sof.stateOnline')) + '</span>' +
          '</button>' +
        '</div>' +
        trailerRow +
      '</div>';
    box.style.display = '';
    // Élő akku-feszültség lekérése háttérben (best-effort — a kártya már látszik).
    // A CargoTrack eszközfüggően adja vissza; ha nincs, csendben elmarad.
    _loadMyVehicleBattery(v.rendszam_camion);
    // Élő állapot-figyelő indítása (idempotens — csak első alkalommal indít).
    if (typeof _vehStatusStart === 'function') { try { _vehStatusStart(); } catch(e) {} }
  }).catch(function() {});
}

// ─── Online/Offline állapot-pirula a jármű-kártyán ──────────────────
// A `#myVehStatusBtn` gomb (a márka-mező helyén) mutatja, hogy a kliens
// tudja-e érni a szervert. Alapból zöld „Online"; háttér-ping (45 mp),
// `online`/`offline` böngésző-események, és a visibilitychange (tab-vissza)
// együtt frissítik. Offline állapotban koppintás → azonnali ping;
// ha megvan a szerver, visszavált Online-ra ÉS frissíti a főoldali adatokat
// (loadDashOrders + loadSoferMiniStats + loadMyAssignedVehicle) → a sofőr
// azonnal élő adatot lát, NEM kell kijelentkezni + belépni.
var _vehStatusState = 'online';        // 'online' | 'offline' | 'checking'
var _vehStatusTimer = null;
var _vehStatusStarted = false;
var _vehStatusLastPingAt = 0;

function _vehStatusPaint() {
  var btn = document.getElementById('myVehStatusBtn');
  if (!btn) return;
  var txt = btn.querySelector('.mv-status-txt');
  btn.classList.remove('is-online', 'is-offline', 'is-checking');
  var key;
  if (_vehStatusState === 'offline')      { btn.classList.add('is-offline');  key = 'sof.stateOffline'; }
  else if (_vehStatusState === 'checking'){ btn.classList.add('is-checking'); key = 'sof.stateChecking'; }
  else                                    { btn.classList.add('is-online');   key = 'sof.stateOnline'; }
  var label = t(key);
  if (txt) txt.textContent = label;
  btn.setAttribute('aria-label', label);
}

function _vehStatusSet(state) {
  if (_vehStatusState === state) return;
  _vehStatusState = state;
  _vehStatusPaint();
}

// Könnyű ping a szerverhez. A `/healthz` auth nélküli, gyors végpont
// (routes/health.js). AbortController-rel 6 mp-es timeout — mobil-hálón
// a fetch némán tudna „lógni". `cache:'no-store'` — CDN/SW ne adja vissza
// stale-ből OK-t.
function _vehStatusPing(cb) {
  var now = Date.now();
  _vehStatusLastPingAt = now;
  var ctrl = null;
  var to = null;
  try { ctrl = new AbortController(); to = setTimeout(function(){ try { ctrl.abort(); } catch(e){} }, 6000); } catch(e) {}
  fetch('/healthz', { method: 'GET', cache: 'no-store', credentials: 'same-origin', signal: ctrl ? ctrl.signal : undefined })
    .then(function(r) { if (to) clearTimeout(to); if (typeof cb === 'function') cb(!!(r && r.ok)); })
    .catch(function()  { if (to) clearTimeout(to); if (typeof cb === 'function') cb(false); });
}

function _vehStatusStart() {
  if (_vehStatusStarted) return;
  _vehStatusStarted = true;
  // Böngésző-események: azonnali reakció offline/online váltásra.
  try {
    window.addEventListener('offline', function() { _vehStatusSet('offline'); });
    window.addEventListener('online',  function() { _vehStatusPing(function(ok){ _vehStatusSet(ok ? 'online' : 'offline'); }); });
  } catch(e) {}
  // Első ping ~5 mp múlva (az oldal induláskor amúgy is fetch-el; ne torlódjon).
  setTimeout(function() {
    if (navigator && navigator.onLine === false) { _vehStatusSet('offline'); return; }
    _vehStatusPing(function(ok){ _vehStatusSet(ok ? 'online' : 'offline'); });
  }, 5000);
  // Rendszeres ping 45 mp-enként — a márka-mező helyén ülő pirula így
  // magától mutatja a valós állapotot, nem várunk explicit felhasználói
  // interakcióra. Ha a lap háttérben van (document.hidden), kihagyjuk
  // (kímélet + a mobil OS amúgy is throttolná).
  _vehStatusTimer = setInterval(function() {
    if (document && document.hidden) return;
    if (navigator && navigator.onLine === false) { _vehStatusSet('offline'); return; }
    _vehStatusPing(function(ok){ _vehStatusSet(ok ? 'online' : 'offline'); });
  }, 45000);
}

// Koppintás a pirulára — offline-ban ellenőriz és frissít; online-ban is
// kézi frissítést indít (a sofőr azt jelzi, „most akarok friss adatot").
function vehStatusClick() {
  // Debounce — 2 mp-en belül a második koppintás ne lőjön újabb ping-et.
  if (Date.now() - _vehStatusLastPingAt < 2000) return;
  _vehStatusSet('checking');
  _vehStatusPing(function(ok) {
    _vehStatusSet(ok ? 'online' : 'offline');
    if (ok) {
      // A szerver él → azonnal frissítjük a főoldali kártyákat, hogy a sofőr
      // élő adatot lásson (a stale kliens-cache — pl. `_soferOrdersCache` —
      // felülíródik a friss szerver-válasszal). A `sec-dash`-en lévő elemek
      // szimpla `try/catch`-ban, mert ha nincs valamelyik, ne akadjon meg.
      try { if (typeof loadDashOrders === 'function') loadDashOrders(); } catch(e) {}
      try { if (typeof loadSoferMiniStats === 'function') loadSoferMiniStats(); } catch(e) {}
      try { if (typeof loadMyAssignedVehicle === 'function') loadMyAssignedVehicle(); } catch(e) {}
      try { if (typeof renderPendingReceipts === 'function') renderPendingReceipts(); } catch(e) {}
      try { if (typeof toast === 'function') toast(t('sof.refreshed'), 'ok'); } catch(e) {}
    } else {
      try { if (typeof toast === 'function') toast(t('sof.stateOfflineHint'), 'warn'); } catch(e) {}
    }
  });
}
// Publikálás inline `onclick`-hez (a HTML-ben `vehStatusClick()` hívjuk).
try { window.vehStatusClick = vehStatusClick; } catch(e) {}

// ─── Élő akku-feszültség a jármű-kártyához ──────────────────────
// A `getCurrentGpsReadings` handler visszaadja a jármű-akku V értékét
// (eszközfüggő; ha a CargoTrack nem adja, `battery_voltage=null`, semmit
// sem mutatunk). Kettős küszöb: >20V → 24V-os teherautó (warn <22.5,
// danger <22.0), különben 12V-os (warn <12.0, danger <11.5). A cége +
// tulajdon-ellenőrzés szerver-oldalon (sofőr csak saját autójára kap).
function _loadMyVehicleBattery(plate) {
  if (!plate) return;
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getCurrentGpsReadings', arguments: [plate] }) })
  .then(function(r) { return r.json(); }).then(function(d) {
    var res = d && d.result;
    if (!res || !res.ok || !res.available) return;
    var box = document.getElementById('myVehicleBox');
    if (!box || box.style.display === 'none') return;
    var inner = box.firstElementChild;
    if (!inner) return;
    // Ha már van akku-sor (pl. nyelvváltás után újrafutott), leváltjuk.
    var old = inner.querySelector('.sof-batt-line');
    if (old) old.parentNode.removeChild(old);

    // CSAK a nyers feszültséget mutatjuk. A `state_of_charge` fallback kikapcsolva,
    // mert a valós Ruptela-flottán mindig 0-t adott (nem-EV jármű, indirekt becslés
    // sincs konfigurálva) — a „🔋 0%" félrevezető volt. A voltage-hez CargoTrack-nél
    // kell engedélyeztetni az `external_voltage` firmware/config-ot.
    var v = (res.battery_voltage != null) ? parseFloat(res.battery_voltage) : null;
    if (v == null || !isFinite(v)) return;
    var isTruck = v > 20;                                   // 24V rendszer heurisztika
    var warn = isTruck ? v < 22.5 : v < 12.0;
    var danger = isTruck ? v < 22.0 : v < 11.5;
    var color = danger ? '#dc2626' : (warn ? '#d97706' : '#0f172a');
    var warnTxt = (warn || danger) ? ' <span style="color:#d97706;font-size:12px;">— ' + esc(t('sof.battWarn')) + '</span>' : '';
    var html = '🔋 <b style="color:' + color + ';">' + v.toFixed(1) + ' V</b>' + warnTxt;

    var line = document.createElement('div');
    line.className = 'sof-batt-line';
    line.style.cssText = 'margin-top:6px;font-size:13px;color:#334155;';
    line.innerHTML = html;
    inner.appendChild(line);
  }).catch(function() {});
}

// A menetlevél kezdő üzemanyag-szintjének ÉS kezdő km-óra állásának előtöltése
// az adott rendszám utolsó menetleveléből (záró érték → új kezdő érték). Mindkét
// mezőt CSAK akkor tölti, ha üres/0 (a sofőr által beírt értéket sosem írjuk
// felül). A rendszám kézzel átírható, ezért a plate paramétert adjuk át.
function _fillIfEmpty(el, val) {
  if (!el || val == null) return;
  var now = String(el.value || '').trim();
  if (now !== '' && now !== '0') return;   // már beírt / átvitt érték — nem nyúlunk hozzá
  el.value = val;
}
function prefillWaybillReadings(plate) {
  var incEl = document.getElementById('fCantInc');   // kezdő üzemanyag
  var kmEl  = document.getElementById('fKmInc');      // kezdő km-óra
  if (!plate || (!incEl && !kmEl)) return;
  // Ha mindkét kezdő mezőben már van érték, nincs mit tenni.
  var fuelBusy = !incEl || (String(incEl.value || '').trim() !== '' && String(incEl.value || '').trim() !== '0');
  var kmBusy   = !kmEl  || (String(kmEl.value  || '').trim() !== '' && String(kmEl.value  || '').trim() !== '0');
  if (fuelBusy && kmBusy) return;
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getLastVehicleReadings', arguments: [plate] }) })
  .then(function(r) { return r.json(); }).then(function(d) {
    var res = d && d.result;
    if (!res || !res.ok) return;
    _fillIfEmpty(incEl, res.fuel);
    _fillIfEmpty(kmEl, res.km);
    if (typeof draftSave === 'function') { try { draftSave(); } catch (e) {} }
  }).catch(function() {});
}
// Visszafelé kompatibilis alias (a régi hívási pontokhoz).
function prefillFuelStart(plate) { return prefillWaybillReadings(plate); }

// ============================================================
// ZÁRÓ Km / ZÁRÓ üzemanyag lekérése ÉLŐ GPS-ből (sofőr gombja)
// ------------------------------------------------------------
// A sofőr a menetlevél 2. lépésén a „📍 GPS" gombbal a záró km-óra
// állását, a „⛽ GPS" gombbal a záró tartály-szintet (litert) tudja
// betölteni a hozzárendelt vontató CargoTrack-adataiból. A záró
// mezőt FELÜLÍRJA (ez EXPLICIT sofőr-akció, nem csendes prefill),
// és kilövi az `input` eventet, hogy a #kmFuelCheck valós idejű
// ellenőrzés + az auto-piszkozat is újrafusson. A tartály-szint
// KORRIGÁLT érték (a szerver alkalmazza a jármű `fuel_correction_l`
// offsetjét — a nyers GPS-érték sosem megy ki a kliensbe).
//
// Rendszám-forrás: elsődlegesen a #fCamion beviteli mező (amit a
// menetlevél-form eleve előtölt a kiosztott vontatóból); ha üres,
// visszaesünk a `_myAssignedVehicle` cache-re. Rendszám nélkül a
// gomb toastol és nem hív. Sofőrnek CSAK a saját párosított
// vontatójára ad választ a szerver (más jármű nem elérhető).
// ============================================================

// Közös segéd: rendszám az űrlapról vagy a kiosztásból.
function _sofPlateForGps() {
  var el = document.getElementById('fCamion');
  var v = el && String(el.value || '').trim();
  if (v) return v;
  if (_myAssignedVehicle && _myAssignedVehicle.rendszam_camion) {
    return String(_myAssignedVehicle.rendszam_camion).trim();
  }
  return '';
}

// Közös segéd: gomb-zár + spinner + válasz-toast — csökkenti a
// duplikált Promise-kezelést a két függvény között (km / fuel).
function _sofGpsFetch(btnId, onOk) {
  var plate = _sofPlateForGps();
  if (!plate) { toast(t('sof.gpsNoPlate'), 'err'); return; }
  var btn = document.getElementById(btnId);
  var orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getCurrentGpsReadings', arguments: [plate] }) })
  .then(function(r) { return r.json(); }).then(function(d) {
    var res = d && d.result;
    if (!res || !res.ok) { toast((res && res.err) || t('sof.gpsError'), 'err'); return; }
    if (!res.available) { toast((res && res.err) || t('sof.gpsNoData'), 'err'); return; }
    onOk(res);
  }).catch(function() { toast(t('sof.gpsError'), 'err'); })
  .then(function() { if (btn) { btn.disabled = false; btn.textContent = orig; } });
}

// 📍 Záró km lekérése GPS-ből → #fKmSf (az élő km-óra állás, nyers).
function fetchGpsEndKm() {
  _sofGpsFetch('btnGpsKmEnd', function(res) {
    if (res.mileage == null) { toast(t('sof.gpsNoKm'), 'err'); return; }
    var el = document.getElementById('fKmSf');
    if (!el) return;
    var val = Math.round(Number(res.mileage));
    el.value = String(val);
    // Kiváltjuk az `input` eventet, hogy a #kmFuelCheck (élő ellenőrzés)
    // és a draftSave (600ms debounce) is újrafusson.
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    if (typeof draftSave === 'function') { try { draftSave(); } catch (e) {} }
    toast(t('sof.gpsKmFetched', { val: val }), 'ok');
  });
}

// ⛽ Záró üzemanyag-szint lekérése GPS-ből → #fCantSf. A szerver már
// KORRIGÁLT értéket ad (a jármű `fuel_correction_l` offsetjével); a
// sofőr csak a valós tartály-szintet látja, a nyers GPS-értéket soha.
function fetchGpsEndFuel() {
  _sofGpsFetch('btnGpsFuelEnd', function(res) {
    if (res.fuel_level == null) { toast(t('sof.gpsNoFuel'), 'err'); return; }
    var el = document.getElementById('fCantSf');
    if (!el) return;
    // 1 tizedesjegyre kerekítjük (a szerver már 1 tizedesig kerekít,
    // itt is konzisztensen mutatjuk — a mező egészet is elfogad).
    var val = Math.round(Number(res.fuel_level) * 10) / 10;
    el.value = String(val);
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    if (typeof draftSave === 'function') { try { draftSave(); } catch (e) {} }
    toast(t('sof.gpsFuelFetched', { val: val }), 'ok');
  });
}

// ============================================================
// SAJÁT HAVI MINI-STATISZTIKA (főoldal) — motivációs összegző
// ============================================================
function loadSoferMiniStats() {
  var box = document.getElementById('soferMiniStats');
  if (!box) return;
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getMySoferStats' }) })
  .then(function(r) { return r.json(); }).then(function(d) {
    var s = d.result;
    if (!s || !s.ok) return;
    function n(x) { var v = parseFloat(x); return isFinite(v) ? v.toLocaleString(t('sof.locale'), { maximumFractionDigits: 0 }) : '0'; }
    // Világos téma: fehér kártya + olvasható sötét/akcentes szöveg. A méret/rács
    // az .sof-mstat* OSZTÁLYOKBÓL jön (sofer.css) — kompakt 2×2, ~20%-kal kisebb —,
    // NEM inline grid-stílusból (különben a style.css mobil felülírója
    // egyoszloposra törné). Per-csempe akcent a motivációs hatáshoz.
    // A csempe alá másodlagos sor(ok) kerülnek (.sof-mstat-prev) — apró szürke
    // múlt havi viszonyítás; 0 esetén is kiírjuk (motivációs hatás).
    // A KM csempe KÉT prev-sort mutat: „teljes hó" (GPS-delta) + „leadott"
    // (menetlevél-alap) — a többi csempe egyet.
    var lastMo = t('sof.lastMonthShort');
    var lblFull = t('sof.mstatFull');
    var lblSubm = t('sof.mstatSubmitted');
    function tile(ico, val, lbl, accent, prev, prev2) {
      return '<div class="sof-mstat">'
        + '<div class="sof-mstat-ico">' + ico + '</div>'
        + '<div class="sof-mstat-val" style="color:' + accent + ';">' + val + '</div>'
        + '<div class="sof-mstat-lbl">' + lbl + '</div>'
        + '<div class="sof-mstat-prev">' + prev + '</div>'
        + (prev2 ? '<div class="sof-mstat-prev">' + prev2 + '</div>' : '')
        + '</div>';
    }
    // KM csempe: „teljes hó" (GPS-delta, ha van) + „leadott" (menetlevél).
    // Ha nincs GPS-delta (km_prev_gps = 0), csak a „leadott" jelenik meg,
    // hogy ne legyen felesleges „teljes hó: 0" sor.
    var kmGps = parseFloat(s.km_prev_gps) || 0;
    var kmPrev1, kmPrev2;
    if (kmGps > 0) {
      kmPrev1 = lblFull + ': ' + n(kmGps);
      kmPrev2 = lblSubm + ': ' + n(s.km_prev);
    } else {
      kmPrev1 = lastMo + ': ' + n(s.km_prev);
      kmPrev2 = null;
    }

    // TANKOLVA csempe: átlagfogyasztás (L/100km) — jelen havi eddigi + múlt havi.
    // Kerekítés 1 tizedesre; null → „—". A csempe alján kiírunk egy figyelmeztetést
    // ha valamelyik érték kívül esik [20, 38] tartományon (⚠️ Elmaradt menetlevél)
    // VAGY a két hó közti eltérés > 4.5 L/100km (⚠️ Nézze át a menetlevelet).
    function fmtAvg(v) {
      if (v == null || !isFinite(parseFloat(v))) return '—';
      return parseFloat(v).toFixed(1) + ' L/100km';
    }
    var avgLabelCurr = t('sof.avgCurr') + ': ' + fmtAvg(s.avg_curr);
    var avgLabelPrev = t('sof.avgPrev') + ': ' + fmtAvg(s.avg_prev);
    var warn = null;
    if (s.warn_range) warn = t('sof.warnRange');
    else if (s.warn_diff) warn = t('sof.warnDiff');

    // 1×3 rács (3 csempe egymás mellett szorosan) — a diurna kivéve, marad a
    // LEZÁRT / KM / TANKOLVA. A csempék ~15%-kal magasabbak (sofer.css),
    // hogy a másodlagos prev-sorok kiférjenek.
    // A TANKOLVA csempén 3 prev-sor: avg_curr, avg_prev, opcionális warn-sor.
    // A warn-sor a `sof-mstat-warn` CSS-osztályt kapja (narancs, félkövér).
    box.innerHTML = '<div class="sof-mstat-h">' + t('sof.myMonthPerf') + '</div>'
      + '<div class="sof-mstat-grid">'
      + tile('✅', n(s.lezart), t('sof.statClosed'), '#16a34a', lastMo + ': ' + n(s.lezart_prev))
      + tile('🛣️', n(s.km), t('sof.statKm'), '#2563eb', kmPrev1, kmPrev2)
      + '<div class="sof-mstat">'
        + '<div class="sof-mstat-ico">⛽</div>'
        + '<div class="sof-mstat-val" style="color:#d97706;">' + n(s.tankolt_l) + ' L</div>'
        + '<div class="sof-mstat-lbl">' + t('sof.statFueled') + '</div>'
        + '<div class="sof-mstat-prev">' + avgLabelCurr + '</div>'
        + '<div class="sof-mstat-prev">' + avgLabelPrev + '</div>'
        + (warn ? '<div class="sof-mstat-warn">⚠️ ' + warn + '</div>' : '')
      + '</div>'
      + '</div>';
    box.style.display = '';
  }).catch(function() {});
}

// ============================================================
// INIT — authMe + állapot visszaállítás
// ============================================================
var _meData = null;

// ── GDPR adatvédelmi tájékoztató (informare) — visszaigazolásig banner ──
function loadGdprNotice() {
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getMyPrivacyNotice', arguments: [] }) })
  .then(function(r){ return r.json(); }).then(function(d){
    var res = d && d.result;
    if (!res || !res.ok || !res.notice || res.acknowledged) return;
    var b = document.getElementById('gdprBanner');
    var tx = document.getElementById('gdprBannerText');
    if (tx) tx.textContent = res.notice + (res.dpo_contact ? ('\nDPO: ' + res.dpo_contact) : '');
    if (b) b.style.display = '';
  }).catch(function(){});
}
function gdprAck() {
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'ackPrivacyNotice', arguments: [] }) })
  .then(function(r){ return r.json(); }).then(function(d){
    if (d && d.result && d.result.ok) { var b = document.getElementById('gdprBanner'); if (b) b.style.display = 'none'; }
  }).catch(function(){});
}

fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ functionName: 'authMe' }) })
.then(function(r) { return r.json(); }).then(function(d) {
  if (!d.result) { window.location.href = '/login'; return; }
  _meData = d.result;
  // Leak-védelem közös telefonon: a piszkozat kulcsa mostantól per-sofőr
  // (`vs_sofer_state:<email>`), tehát másik sofőr eleve nem látja. Ami
  // maradhatott: a MIGRÁCIÓ előtti, közös `sessionStorage`-érték — ha az
  // egy MÁSIK sofőré, azt dobjuk, mielőtt a migráció átvenné.
  try {
    var _existing = JSON.parse(sessionStorage.getItem(SS_KEY) || '{}');
    var _ownerEmail = String(_existing.driverEmail || '').toLowerCase();
    var _meEmail = String(_meData.email || '').toLowerCase();
    if (_ownerEmail && _meEmail && _ownerEmail !== _meEmail) {
      sessionStorage.removeItem(SS_KEY);
    }
  } catch (_e) {}
  document.getElementById('meBadge').textContent = d.result.nume;
  if (window.VS_PUSH) VS_PUSH.init(d.result.email, d.result.pozicio);
    // Chat ideiglenesen: WhatsApp-átirányítás — Firebase-chat kikapcsolva.
    // A régi initFirebaseChat kódot érintetlenül hagyjuk, hogy könnyen
    // visszavonható legyen (csak nem hívjuk innen).
    loadDashOrders();
    loadSoferMiniStats();
    loadMyAssignedVehicle();
    loadGdprNotice();
    applyBonScanVisibility();
    // Bon-várólista karbantartás — csak ITT, a `_meData` ismeretében (a
    // lista kulcsa per-sofőr): megszakadt feldolgozás folytatása a
    // megőrzött képből + gazdátlan képek takarítása.
    rcptQueueMaint();
    // ── ELSŐ BELÉPÉS: átirányítás a /sofer-demo sandbox-ra ──
    // A jelenlegi appra rárakott overlay-tour helyett önálló DEMO oldal —
    // ott minden gomb tényleg működik (lokális state), semmi nem megy
    // a szerverre. Csak akkor irányítunk, ha:
    //  - ez a sofőr még sosem látta (`vs_sofer_demo_seen` localStorage)
    //  - a GDPR-banner NEM látszik (annak elsőbbsége van)
    //  - nincs mentett menetlevél-piszkozat (nem szakítjuk meg)
    // A „🎓 Bemutatás" nav-kártyával bárki bármikor újranyithatja.
    try {
      setTimeout(function(){
        var seen = false;
        try { seen = localStorage.getItem('vs_sofer_demo_seen') === '1'; } catch(_){}
        if (seen) return;
        var gdpr = document.getElementById('gdprBanner');
        if (gdpr && gdpr.style.display !== 'none') return;
        // Draft-előfoglalás (nyitott menetlevél) — hagyjuk békén.
        try {
          var st = stateGet && stateGet();
          if (st && st.draft) return;
        } catch(_){}
        window.location.href = '/sofer-demo';
      }, 1200);
    } catch (_) {}

  // ── Állapot visszaállítás ──
  var state = stateGet();

  // Menetlevél piszkozat visszaállítás (legmagasabb prioritás)
  if (state.draft && state.sec === 'fuvar' && state.fuvarStep === 2) {
    goSec('fuvar');
    // Fuvarok betöltése után visszaállítjuk
    fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName: 'getMySoferOrders' }) })
    .then(function(r) { return r.json(); }).then(function(d2) {
      _soferOrdersCache = d2.result || [];
      // Step2 megnyitása
      document.getElementById('fuvarStep1').style.display = 'none';
      document.getElementById('fuvarStep2').style.display = 'block';
      draftRestore(state.draft);
      attachDraftListeners();
      toast(t('sof.draftRestored'), 'ok');
    });
    return;
  }

  // Aktív szekció visszaállítás
  if (state.sec && state.sec !== 'dash') {
    goSec(state.sec);
  }
});

// ============================================================
// CHAT — IDEIGLENESEN: WhatsApp átirányítás
// ------------------------------------------------------------
// A sofőr a chat-kártyáról közvetlenül a cég WhatsApp-számára ugrik
// (a manager/admin állítja be a saját konzolján). Ha nincs beállítva,
// jelzést kap. A régi Firebase-chat logika ALATTA érintetlen — csak
// nem hívjuk sehol (könnyen visszavonható).
// ============================================================
function openWhatsAppFromChatCard() {
  fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getCompanyWhatsapp', arguments: [] }) })
  .then(function(r){ return r.json(); })
  .then(function(d){
    var num = d && d.result && d.result.ok ? d.result.number : null;
    if (!num) {
      // Nincs szám: jelzés + a chat pane-en is látszik a hint.
      try { toast(t('sof.waNotConfigured'), 'warn'); } catch(e){}
      try {
        var hint = document.getElementById('soferWaHint');
        if (hint) hint.textContent = t('sof.waNotConfigured');
      } catch(e){}
      try { goSec('chat'); } catch(e){}
      return;
    }
    // wa.me a legrobusztusabb: webről a WhatsApp Web-et, mobilon a
    // natív alkalmazást nyitja. A '+' NEM kell — a szerver már csak
    // számjegyeket ad vissza (normalizePhone).
    window.location.href = 'https://wa.me/' + encodeURIComponent(num);
  })
  .catch(function(){
    try { toast(t('sof.waError'), 'err'); } catch(e){}
  });
}

// ============================================================
// FIREBASE CHAT — Sofőr oldal  (LEGACY, jelenleg nem hívott)
// ============================================================
var _fbDb = null, _chatCompanyId = null;
var _chatCurrentRoom = null, _chatUnsubscribe = null, _chatRoomsListener = null;
var _chatManagers = [];

function dmRoomId(emailA, emailB) {
  var a = emailA.toLowerCase().replace(/@/g,'__').replace(/\./g,'_d_');
  var b = emailB.toLowerCase().replace(/@/g,'__').replace(/\./g,'_d_');
  return 'dm_' + (a < b ? a + '_X_' + b : b + '_X_' + a);
}

function initFirebaseChat(me) {
  fetch('/api/firebase-config')
    .then(function(r) { return r.json(); })
    .then(function(cfg) {
      if (!cfg || !cfg.apiKey) {
        document.getElementById('chatInitMsg').textContent = t('sof.chatNoConfig');
        return;
      }
      var s1 = document.createElement('script');
      s1.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js';
      document.head.appendChild(s1);
      s1.onload = function() {
        var sAuth = document.createElement('script');
        sAuth.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js';
        document.head.appendChild(sAuth);
        sAuth.onload = function() {
        var s2 = document.createElement('script');
        s2.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js';
        document.head.appendChild(s2);
        s2.onload = function() {
          if (!firebase.apps.length) firebase.initializeApp(cfg);
          // Firebase custom token bejelentkezes (company_id alapu vedelem)
          fetch('/api/firebase-token').then(function(r){return r.json();}).then(function(td){
            var authPromise = (td.ok && td.token && firebase.auth)
              ? firebase.auth().signInWithCustomToken(td.token).catch(function(e){ console.warn('FB auth hiba:', e); })
              : Promise.resolve();
            authPromise.then(function(){
          _fbDb = firebase.database();
          _chatCompanyId = String(me.company_id || 'global');
          fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ functionName: 'userListAll' }) })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            var list = d.result || [];
            _chatManagers = list.filter(function(u) {
              return (u.pozicio === 'Manager' || u.pozicio === 'Admin') && u.email !== me.email;
            });
            document.getElementById('chatInitMsg').style.display = 'none';
            soferShowContactList(me);

            // Chat szoba visszaállítás
            var state = stateGet();
            if (state.chatRoom) {
              var manager = _chatManagers.find(function(u) {
                return dmRoomId(me.email, u.email) === state.chatRoom;
              });
              if (manager) {
                setTimeout(function() { soferOpenRoom(me, manager); }, 300);
              }
            }
          });
            }); // authPromise.then vege
          }); // firebase-token fetch vege
        }; // s2.onload vege
        }; // sAuth.onload vege
      };
    })
    .catch(function() { document.getElementById('chatInitMsg').textContent = t('sof.chatUnavailable'); });
}

function soferShowContactList(me) {
  var contactView = document.getElementById('chatContactView');
  contactView.style.display = 'flex';
  document.getElementById('chatRoomView').style.display = 'none';

  var listEl = document.getElementById('chatContactList');
  if (!_chatManagers.length) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;">' + t('sof.noManager') + '</div>';
    return;
  }

  listEl.innerHTML = _chatManagers.map(function(u) {
    var av = (u.nume || u.email).replace(/[^a-zA-Z]/g, '').charAt(0).toUpperCase() || '?';
    var roomId = dmRoomId(me.email, u.email);
    return '<div onclick="soferOpenRoom(_meData, ' + JSON.stringify(u).replace(/"/g, '&quot;') + ')" '
      + 'style="display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .15s;" '
      + 'onmouseenter="this.style.background=\'rgba(255,255,255,0.04)\'" onmouseleave="this.style.background=\'\'"> '
      + '<div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#1d4ed8);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:17px;color:#fff;flex-shrink:0;">' + av + '</div>'
      + '<div><div style="font-weight:700;font-size:14px;color:#fff;">' + escHtml(u.nume || u.email) + '</div>'
      + '<div style="font-size:11px;color:var(--muted);margin-top:2px;">' + escHtml(u.pozicio || '') + '</div></div>'
      + '</div>';
  }).join('');

  // Rooms listener — olvasatlan jelzők frissítése
  if (_chatRoomsListener) _chatRoomsListener();
  if (_fbDb) {
    var ref = _fbDb.ref('chats/' + _chatCompanyId + '/rooms');
    ref.on('value', function() {}); // figyelés aktív
    _chatRoomsListener = function() { ref.off(); };
  }
}

function soferOpenRoom(me, manager) {
  var roomId = dmRoomId(me.email, manager.email);
  stateSave({ chatRoom: roomId });

  document.getElementById('chatContactView').style.display = 'none';
  document.getElementById('chatRoomView').style.display = 'flex';

  var name = manager.nume || manager.email;
  document.getElementById('chatHeadName').textContent = name;
  var av = name.replace(/[^a-zA-Z]/g, '').charAt(0).toUpperCase() || '?';
  document.getElementById('chatHeadAv').textContent = av;

  if (_chatUnsubscribe) { _chatUnsubscribe(); _chatUnsubscribe = null; }
  _chatCurrentRoom = roomId;

  var msgsEl = document.getElementById('chatMsgs');
  msgsEl.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:20px;">' + t('common.loading') + '</div>';

  var ref = _fbDb.ref('chats/' + _chatCompanyId + '/rooms/' + roomId + '/messages');
  var query = ref.orderByChild('ts').limitToLast(100);

  var listener = query.on('value', function(snap) {
    msgsEl.innerHTML = '';
    snap.forEach(function(child) {
      var msg = child.val();
      var isMine = (msg.fromEmail === (_meData.email || ''));
      var bubble = document.createElement('div');
      bubble.style.cssText = 'max-width:80%;padding:9px 13px;border-radius:16px;font-size:14px;word-break:break-word;margin-bottom:2px;'
        + (isMine
          ? 'align-self:flex-end;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border-bottom-right-radius:3px;'
          : 'align-self:flex-start;background:rgba(255,255,255,0.08);border:1px solid var(--border-bright);color:var(--text);border-bottom-left-radius:3px;');
      var ts = msg.ts ? new Date(msg.ts).toLocaleTimeString(t('sof.locale'), { hour: '2-digit', minute: '2-digit' }) : '';
      bubble.innerHTML = (!isMine
          ? '<div style="font-size:10px;color:var(--muted);margin-bottom:3px;font-weight:600;">' + escHtml(msg.fromName || '') + '</div>'
          : '')
        + '<div>' + escHtml(msg.text || '') + '</div>'
        + '<div style="font-size:10px;opacity:.5;text-align:right;margin-top:4px;">' + ts + '</div>';
      msgsEl.appendChild(bubble);
    });
    msgsEl.scrollTop = msgsEl.scrollHeight;
  });

  _chatUnsubscribe = function() { query.off('value', listener); };
}

function soferChatBack() {
  if (_chatUnsubscribe) { _chatUnsubscribe(); _chatUnsubscribe = null; }
  _chatCurrentRoom = null;
  stateSave({ chatRoom: null });
  document.getElementById('chatRoomView').style.display = 'none';
  document.getElementById('chatContactView').style.display = 'flex';
}

function chatSend() {
  if (!_fbDb || !_meData || !_chatCurrentRoom) return;
  var input = document.getElementById('chatInput');
  var text = input.value.trim();
  if (!text) return;
  input.value = '';
  _fbDb.ref('chats/' + _chatCompanyId + '/rooms/' + _chatCurrentRoom + '/messages').push({
    fromEmail: _meData.email || '',
    fromName: _meData.nume || t('sof.driver'),
    fromRole: 'Sofer',
    text: text,
    ts: firebase.database.ServerValue.TIMESTAMP
  });
  _fbDb.ref('chats/' + _chatCompanyId + '/rooms/' + _chatCurrentRoom + '/meta').update({
    lastMsg: text.substring(0, 80),
    lastTime: firebase.database.ServerValue.TIMESTAMP,
    lastFrom: _meData.nume
  });
  // Push ertesites a Managernek / Adminnak
  if(window.VS_PUSH){
    var roomId = _chatCurrentRoom;
    var toEmails = [];
    var toRoles  = [];
    if(roomId && roomId.startsWith('dm_')){
      var inner = roomId.replace('dm_','');
      var parts = inner.split('_X_');
      if(parts.length===2){
        var myEsc=(_meData.email||'').toLowerCase().replace(/@/g,'__').replace(/\./g,'_d_');
        var otherEsc=parts[0]===myEsc?parts[1]:parts[0];
        toEmails=[otherEsc.replace(/__/g,'@').replace(/_d_/g,'.')];
      }
    } else {
      toRoles = ['Manager','Admin'];
    }
    VS_PUSH.notifyChat({
      toEmails: toEmails,
      toRoles:  toRoles,
      fromName: _meData.nume || t('sof.driver'),
      text:     text,
      room:     roomId,
      companyId: _chatCompanyId
    });
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js');
  });
}

/* ── Bug report ── */
function openBugReport(){
  document.getElementById('bugText').value='';
  document.getElementById('bugModal').style.display='flex';
  setTimeout(function(){document.getElementById('bugText').focus();},150);
}
function closeBugReport(){ document.getElementById('bugModal').style.display='none'; }
function submitBugReport(){
  var txt = document.getElementById('bugText').value.trim();
  if(!txt || txt.length<5){ toast(t('sof.bug.minChars'),'err'); return; }
  var btn = document.getElementById('bugSubmitBtn');
  btn.disabled=true; btn.textContent=t('sof.sending');
  fetch('/api/execute',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({functionName:'sendBugReport',arguments:[txt,'sofer']})})
  .then(function(r){return r.json();}).then(function(d){
    btn.disabled=false; btn.textContent=t('sof.bug.send');
    var r=d.result;
    if(r&&r.ok){ toast(t('sof.bug.thanks'),'ok'); closeBugReport(); }
    else { toast((r&&r.err)||t('sof.errOccurred'),'err'); }
  });
}

// ── Kiosztott fuvarok a főoldalon ────────────────────────
// A dashboard görgetését CSAK a #soferWrap-en kapcsoljuk (a body marad
// overflow:hidden — ez az app-shell alapja). Van fuvar → görgethető dashboard.
function updateScrollBehavior(orders) {
  var wrap = document.getElementById('soferWrap');
  if (!wrap) return;
  if (orders && orders.length > 0) wrap.classList.add('scrollable');
  else wrap.classList.remove('scrollable');
}

// Kártya-kattintással kinyíló részletek másolható szövegei (biztonságos:
// a felhasználói adatot NEM injektáljuk onclick-be, hanem ebből a map-ből
// olvassuk ki a fuvar id alapján).
var _fuvarCopy = {};

// DATE (fel-/lerakás) olvasható formázása; hiba/üres → '—'.
function fmtFuvarDay(v) {
  if (!v) return '';
  try {
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString(t('sof.locale'), { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch (e) { return String(v); }
}
// Időbélyeg (állomás visszaigazolás) — hónap.nap óra:perc.
function fmtFuvarDateTime(v) {
  if (!v) return '';
  try {
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleString(t('sof.locale'), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return String(v); }
}

// A fuvar 4 állomása — EGY gomb lépteti (a szerver dönti el a következőt).
var MS_STEPS = [
  { col: 'sosit_incarcare_at',  key: 'sof.ms.arriveLoad' },
  { col: 'incarcat_at',         key: 'sof.ms.loaded' },
  { col: 'sosit_descarcare_at', key: 'sof.ms.arriveUnload' },
  { col: 'descarcat_at',        key: 'sof.ms.unloaded' }
];

// Egy gombnyomás → a szerver a következő üres állomást rögzíti (időbélyeg),
// és értesíti az irodát; az utolsónál a fuvar Finalizat lesz.
// FONTOS: az állomás NEM visszavonható (a szerver mindig a KÖVETKEZŐ üres
// állomást tölti ki), ezért beküldés ELŐTT megerősítést kérünk — a gomb a
// fuvar-kártya fejlécén ül, vezetés után, kesztyűs kézzel könnyen félrenyomható.
// A `stepIdx` a kliens által számolt következő állomás (a gomb felirata is
// ebből jön) — csak a kérdés szövegéhez kell; a döntést továbbra is a szerver
// hozza. Érvénytelen/hiányzó index esetén általános kérdést teszünk fel.
function driverMilestone(id, stepIdx) {
  // ── SoferTour demó-intercept: a DEMÓ fuvarra a szerverre NEM megyünk.
  if (window.SoferTour && window.SoferTour.demoIntercept &&
      window.SoferTour.demoIntercept(id, 'Állomás-léptetés (legacy)')) {
    return;
  }
  var step = (typeof stepIdx === 'number' && MS_STEPS[stepIdx]) ? MS_STEPS[stepIdx] : null;
  var act  = step ? t(step.key) : t('sof.ms.recorded');
  // Idő-picker modal: alap a MOSTANI idő, de szerkeszthető, ha a sofőr
  // lekésett a nyomással (utólag pótolja a valós időt). A szerver az
  // `at` paramétert használja NOW() helyett.
  sofTimeConfirm({
    ico: '🚚',
    title: t('sof.ms.confirmTitle', { act: act }),
    msg: t('sof.ms.confirmMsg'),
    ok: act
  }, function (atIso) { _driverMilestoneGo(id, atIso); });
}
function _driverMilestoneGo(id, atIso) {
  fetch('/api/orders/' + id + '/driver-milestone', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(atIso ? { at: atIso } : {})
  })
  .then(function (r) { return r.json(); })
  .then(function (d) {
    if (d && d.ok) {
      var lblKey = { arriveLoad: 'sof.ms.arriveLoad', loaded: 'sof.ms.loaded',
                     arriveUnload: 'sof.ms.arriveUnload', unloaded: 'sof.ms.unloaded' }[d.step];
      toast('✅ ' + t(lblKey || 'sof.ms.recorded'), 'ok');
      loadDashOrders();
    } else { toast((d && d.err) || t('sof.errOccurred'), 'err'); }
  })
  .catch(function () { toast(t('sof.errOccurred'), 'err'); });
}

// ── Utólagos idő-korrekció EGY konkrét stopon (📍 sosire / 📦 done) ──
// A fuvar-kártyán a per-stop idővonal minden sorára ott a kis ✏️ gomb;
// megnyomásra idő-picker modal (a jelenlegi értékkel előtöltve), Ok után
// a szerver a `stop-edit` végponton frissíti a `arrived_at` vagy `done_at`
// oszlopot. Sorrend-konzisztencia: done_at szerkesztése az arrived_at-et
// is beállítja, ha az még üres volt (szerver-oldalon lefedve).
function editStopTime(orderId, stopId, field, currentIso, labelKey) {
  // Bemutató alatt / DEMÓ fuvarra a szerverre NEM megyünk (SoferTour intercept).
  if (window.SoferTour && window.SoferTour.demoIntercept &&
      window.SoferTour.demoIntercept(orderId, 'Stop idő korrekció')) {
    return;
  }
  if (!orderId || !stopId || !['arrived_at', 'done_at'].includes(field)) return;
  var actLbl = t(labelKey || 'sof.ms.recorded');
  sofTimeConfirm({
    ico: '✏️',
    title: t('sof.ms.editTitle', { act: actLbl }) || ('Idő javítása — ' + actLbl),
    msg: t('sof.ms.editMsg') || 'Állítsd be a valós időt. Az iroda automatikusan értesül.',
    ok: t('sof.ms.editSave') || '💾 Mentés',
    initialIso: currentIso || null
  }, function (atIso) {
    if (!atIso) return; // Mégse
    fetch('/api/orders/' + orderId + '/stop-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stopId: stopId, field: field, at: atIso })
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.ok) {
        toast('✏️ ' + (t('sof.ms.editedOk') || 'Idő javítva'), 'ok');
        loadDashOrders();
      } else {
        toast((d && d.err) || t('sof.errOccurred'), 'err');
      }
    })
    .catch(function () { toast(t('sof.errOccurred'), 'err'); });
  });
}

// ── Több felrakó/lerakó pont — új stop-event úton ─────────────
// Az `o.stops` (getMySoferOrders) alapján kiszámoljuk a lehetséges következő
// eseményeket. Ha csak egy lehet, azonnal megerősítést kérünk (mint eddig);
// ha több (pl. 5 lerakási pont, még mind nyitva), előugró választó.
// A pickup fázis szigorúan sorrendben megy (általában 1 pickup van), a
// delivery fázisban a sofőr választhatja, melyik pontra érkezett/tett be.
function _computeNextStopOptions(o) {
  var stops = Array.isArray(o.stops) ? o.stops : [];
  if (!stops.length) return null; // legacy fallback
  // ── INTERLEAVED: a fuvar-beviteli SORRENDBEN járjuk végig ──
  // A `seq_index` a bevitel sorrendje (0..N-1); ha nincs (régi sor migráció
  // előttről), fallback: pickup-ok elöl (kind DESC), majd stop_index ASC.
  var seq = stops.slice().sort(function (a, b) {
    var A = (a && a.seq_index != null) ? a.seq_index : 999999;
    var B = (b && b.seq_index != null) ? b.seq_index : 999999;
    if (A !== B) return A - B;
    var ak = a && a.kind === 'pickup' ? 0 : 1;
    var bk = b && b.kind === 'pickup' ? 0 : 1;
    if (ak !== bk) return ak - bk;
    return (a && a.stop_index || 0) - (b && b.stop_index || 0);
  });
  // Az első még nem lezárt stop a következő akció horgonya.
  var idx = -1;
  for (var i = 0; i < seq.length; i++) { if (!seq[i].done_at) { idx = i; break; } }
  if (idx < 0) return [];
  var cur = seq[idx];
  var opts = [];
  // Ha még nem érkezett meg → érkezés választható. Ha megérkezett de nincs
  // elvégezve → elvégzés. Ha a következő szomszédos stop-ok is delivery-k
  // ÉS mindegyik felrakó lezárult, a sofőr választhat közülük (mint eddig
  // a több lerakós ág).
  if (!cur.arrived_at) opts.push({ stop: cur, event: 'arrive' });
  else if (!cur.done_at) opts.push({ stop: cur, event: 'done' });
  // Extra ág: ha a jelenlegi delivery, és utána is delivery(k) jönnek úgy,
  // hogy minden pickup már done → mindegyik nyitva választható.
  if (cur.kind === 'delivery') {
    var allPickupsDone = seq.filter(function (s) { return s.kind === 'pickup'; }).every(function (p) { return !!p.done_at; });
    if (allPickupsDone) {
      for (var j = idx + 1; j < seq.length; j++) {
        var s2 = seq[j];
        if (s2.kind !== 'delivery') break;
        if (!s2.arrived_at) opts.push({ stop: s2, event: 'arrive' });
        else if (!s2.done_at) opts.push({ stop: s2, event: 'done' });
      }
    }
  }
  return opts;
}
function _stopEventLabel(opt) {
  var kind = opt.stop.kind;
  var ev = opt.event;
  var key = kind === 'pickup'
    ? (ev === 'arrive' ? 'sof.ms.arriveLoad' : 'sof.ms.loaded')
    : (ev === 'arrive' ? 'sof.ms.arriveUnload' : 'sof.ms.unloaded');
  return t(key);
}
// Új „gomb-értesítő": a fuvar-kártya fejlécének + részlet-panelének
// állomás-gombja hívja. Az `o` (a fuvar-objektum) alapján dönt.
function driverStopAction(orderId) {
  // ── SoferTour demó-intercept: a DEMÓ fuvarra vonatkozó állomás-léptetés
  //    NEM megy a szerverre — a tour toastol és auto-továbblép.
  //    Emellett a demó `stops` tömbjén elvégezzük a lokális léptetést,
  //    hogy a következő „állomás-gomb" felirat is stimmeljen (📍 → 📦 →
  //    📍 → ✅), ha a sofőr még koppintgat.
  if (window.SoferTour && window.SoferTour.demoIntercept &&
      window.SoferTour.demoIntercept(orderId, 'Állomás-léptetés')) {
    try {
      var demo = (_soferOrdersCache || []).filter(function(x){ return x.id === orderId; })[0];
      if (demo && Array.isArray(demo.stops)) {
        for (var _i = 0; _i < demo.stops.length; _i++) {
          var _s = demo.stops[_i];
          if (!_s.arrived_at) { _s.arrived_at = new Date().toISOString(); break; }
          if (!_s.done_at)    { _s.done_at    = new Date().toISOString(); break; }
        }
        if (typeof loadDashOrders === 'function' && demo.stops.every(function(s){ return s.done_at; })) {
          demo.status = 'Finalizat';
        }
        // Újrarender a főoldalon (a rendes render-út a cache-ből).
        var el = document.getElementById('kiosztottList');
        if (el && typeof renderFuvarCard === 'function') {
          var active = _soferOrdersCache.filter(function(o){
            if (typeof o.dash_visible === 'boolean') return o.dash_visible;
            return o.status === 'Alocat' || o.status === 'In Curs';
          }).slice().reverse();
          el.innerHTML = active.map(function(o, i){ return renderFuvarCard(o, i + 1); }).join('') || el.innerHTML;
        }
      }
    } catch (_e) {}
    return;
  }
  var o = (_soferOrdersCache || []).filter(function (x) { return x.id === orderId; })[0];
  if (!o) return;
  var opts = _computeNextStopOptions(o);
  if (opts === null) {
    // Legacy fuvar (nincs stops-tömb): a régi 4-lépéses szerver-út.
    return driverMilestone(orderId, -1);
  }
  if (!opts.length) { toast(t('sof.ms.allDone') || 'Toate etapele înregistrate.', 'ok'); return; }
  if (opts.length === 1) {
    var opt = opts[0];
    _soferStopConfirmPrompt(orderId, opt);
    return;
  }
  // Több nyitott lehetőség → választó modal
  sofChoice(orderId, opts);
}
// Egy adott stop-opciónál felteszi az idő-picker modalt (alap: mostani
// idő, szerkeszthető). Igenre a stop-event-et küldi az `at` ISO-val.
function _soferStopConfirmPrompt(orderId, opt) {
  var act = _stopEventLabel(opt);
  var stopName = opt.stop.loc || ('#' + (opt.stop.stop_index + 1));
  sofTimeConfirm({
    ico: opt.stop.kind === 'pickup' ? '📦' : '📍',
    title: t('sof.ms.confirmTitle', { act: act }),
    msg: t('sof.ms.confirmStop', { loc: stopName }) || (act + ' — ' + stopName),
    ok: act
  }, function (atIso) { _soferStopEventGo(orderId, opt.stop.id, opt.event, atIso); });
}
function _soferStopEventGo(orderId, stopId, event, atIso) {
  var payload = { stopId: stopId, event: event };
  if (atIso) payload.at = atIso;
  fetch('/api/orders/' + orderId + '/stop-event', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(function (r) { return r.json(); })
  .then(function (d) {
    if (d && d.ok) {
      toast('✅ ' + t('sof.ms.recorded'), 'ok');
      loadDashOrders();
    } else { toast((d && d.err) || t('sof.errOccurred'), 'err'); }
  })
  .catch(function () { toast(t('sof.errOccurred'), 'err'); });
}

// A stop-választó modal betöltője. Nagy gombokat rak függőlegesen — vezetés
// után, kesztyűs kézzel is jól nyomható.
function sofChoice(orderId, opts) {
  var m = document.getElementById('sofChoiceModal');
  if (!m) {
    // Fallback: ha valamiért a modal HTML nincs betöltve, natív dialógot
    // adunk — némán ne hajtson végre.
    var label = opts.map(function (o, i) { return (i + 1) + ') ' + _stopEventLabel(o) + ' — ' + (o.stop.loc || '#' + (o.stop.stop_index + 1)); }).join('\n');
    var pick = window.prompt(label, '1');
    var n = parseInt(pick, 10);
    if (!isFinite(n) || n < 1 || n > opts.length) return;
    var op = opts[n - 1];
    _soferStopConfirmPrompt(orderId, op);
    return;
  }
  var host = document.getElementById('sofChoiceBtns');
  host.innerHTML = '';
  opts.forEach(function (op) {
    var btn = document.createElement('button');
    btn.className = 'sof-cf-btn ok';
    var stopName = op.stop.loc || ('#' + (op.stop.stop_index + 1));
    var kindIco = op.stop.kind === 'pickup' ? '📦' : '📍';
    btn.textContent = kindIco + ' ' + _stopEventLabel(op) + ' — ' + stopName;
    btn.onclick = function () {
      sofChoiceCancel();
      // Stop kiválasztva → idő-picker modal a jóváhagyáshoz/szerkesztéshez
      _soferStopConfirmPrompt(orderId, op);
    };
    host.appendChild(btn);
  });
  m.style.display = 'flex';
}
function sofChoiceCancel() {
  var m = document.getElementById('sofChoiceModal');
  if (m) m.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════
// 🏢 CÉGADATOK MODAL — a főoldali "Cégadatok" nav-kártyához.
// A sofőr vásárláskor/számla-igényléskor a boltos elé tudja tenni
// a cég hivatalos adatait — nem kell fejből mondania. A mezőket az
// Admin/Manager tölti a "Cég & arculat" panelen. Read-only,
// company_id szerint tenant-szűrt szerver-oldalon (getMyCompanyInfo).
// ═══════════════════════════════════════════════════════════════
var _ciCache = null; // 📋 másoló gomb closure-nélküli hivatkozáshoz — a fent
// definiált globális `esc()`-et (sofer.js:6) használja HTML-escape-hez.
function openCompanyInfo() {
  var m = document.getElementById('companyInfoModal');
  if (!m) return;
  m.style.display = 'flex';
  var body = document.getElementById('companyInfoBody');
  if (body) body.innerHTML = '<div class="ci-loading">' + t('sofer.loadingDots') + '</div>';
  fetch('/api/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'getMyCompanyInfo', arguments: [] })
  }).then(function(r){ return r.json(); }).then(function(d){
    var r = (d && d.result) || {};
    if (!r.ok) {
      _ciCache = null;
      if (body) body.innerHTML = '<div class="ci-empty">' + esc(r.err || t('sof.ci.loadErr')) + '</div>';
      return;
    }
    _ciCache = r;
    _ciRenderCard(r);
  }).catch(function(){
    _ciCache = null;
    if (body) body.innerHTML = '<div class="ci-empty">' + t('sof.ci.loadErr') + '</div>';
  });
}
function closeCompanyInfo() {
  var m = document.getElementById('companyInfoModal');
  if (m) m.style.display = 'none';
}
function _ciRenderCard(r) {
  var body = document.getElementById('companyInfoBody');
  if (!body) return;
  // Sorrend: azonosítók (számlához kell) → cím → banki → kapcsolat.
  // Csak nem-üres sorok jelennek meg; ha egy adat sincs, üzenet.
  var tvaLabel = null;
  if (r.tvaPlatitor === true)  tvaLabel = t('sof.ci.tvaYes');
  else if (r.tvaPlatitor === false) tvaLabel = t('sof.ci.tvaNo');
  var rows = [
    { k:'nev',           label: t('sof.ci.nev'),           v: r.nev },
    { k:'cui',           label: t('sof.ci.cui'),           v: r.cui },
    { k:'regCom',        label: t('sof.ci.regCom'),        v: r.regCom },
    { k:'euid',          label: t('sof.ci.euid'),          v: r.euid },
    { k:'tvaPlatitor',   label: t('sof.ci.tvaPlatitor'),   v: tvaLabel, copy:false },
    { k:'capitalSocial', label: t('sof.ci.capitalSocial'), v: r.capitalSocial },
    { k:'adresa',        label: t('sof.ci.adresa'),        v: r.adresa },
    { k:'iban',          label: t('sof.ci.iban'),          v: r.iban },
    { k:'banca',         label: t('sof.ci.banca'),         v: r.banca },
    { k:'igazgatoNev',   label: t('sof.ci.igazgatoNev'),   v: r.igazgatoNev },
    { k:'emailContact',  label: t('sof.ci.emailContact'),  v: r.emailContact },
    { k:'telefon',       label: t('sof.ci.telefon'),       v: r.telefon },
    { k:'website',       label: t('sof.ci.website'),       v: r.website },
  ].filter(function(x){ return x.v != null && String(x.v).trim() !== ''; });
  if (!rows.length) {
    body.innerHTML = '<div class="ci-empty">' + t('sof.ci.empty') + '</div>';
    return;
  }
  var html = rows.map(function(x){
    var copyBtn = (x.copy === false) ? '' :
      '<button class="ci-copy" onclick="ciCopy(\'' + x.k + '\')" title="' + t('sof.det.copy') + '">📋</button>';
    return '<div class="ci-row">' +
      '<div class="ci-lbl">' + esc(x.label) + '</div>' +
      '<div class="ci-val-wrap">' +
        '<div class="ci-val">' + esc(x.v) + '</div>' +
        copyBtn +
      '</div>' +
    '</div>';
  }).join('');
  body.innerHTML = html;
}
function ciCopy(field) {
  if (!_ciCache) return;
  var txt = _ciCache[field];
  if (!txt) { toast(t('sof.det.nothingToCopy'), 'err'); return; }
  txt = String(txt);
  var done = function(){ toast(t('sof.det.copied'), 'ok'); };
  var fallback = function() {
    try {
      var ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta); done();
    } catch (e) { toast(t('sof.det.copyFail'), 'err'); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(done).catch(fallback);
  } else { fallback(); }
}

// Globális cache a fuvar-objektumokhoz (a stop-választónak kell)
var _soferOrdersCache = [];

// A kártyán belüli fel-/lerakás blokk ki-/becsukása (`kind`: 'load'|'unload').
// Az alapállapotot a fuvar fázisa adja (lásd `renderFuvarCard`), de a sofőr
// bármikor átkapcsolhatja — a másik szekciót NEM csukjuk be helyette
// (előfordul, hogy egyszerre kell látni a felrakó és a lerakó címét).
function toggleFuvarSec(id, kind) {
  var body  = document.getElementById('fdbody_' + kind + '_' + id);
  var caret = document.getElementById('fdcar_' + kind + '_' + id);
  var sec   = document.getElementById('fdsec_' + kind + '_' + id);
  if (!body) return;
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (caret) caret.textContent = open ? '▸' : '▾';
  if (sec && sec.classList) sec.classList.toggle('open', !open);
}

// Multi-stop akkordeon: egy adott stop ki-/becsukása a fuvar-kártya
// „Útvonal (a diszpécser sorrendjében)" szekciójában. Másik stop
// nyitásakor a korábban nyitva lévő automatikusan bezáródik → mindig
// EGY nyitott stop → egyértelmű, épp mi jön.
function toggleFuvarStop(orderId, seqIdx) {
  var body  = document.getElementById('fdstop_' + orderId + '_' + seqIdx);
  if (!body) return;
  var caret = document.getElementById('fdstopc_' + orderId + '_' + seqIdx);
  var sec   = document.getElementById('fdstops_' + orderId + '_' + seqIdx);
  var wasOpen = body.style.display !== 'none';
  // Először CSUKJUK be az ÖSSZES többi stopot ugyanezen fuvaron
  // (akkordeon-viselkedés). A `fdstop_<orderId>_` prefix csak ehhez a
  // fuvarhoz tartozik, így másik fuvar stopjai érintetlenek.
  var prefix = 'fdstop_' + orderId + '_';
  var all = document.querySelectorAll('[id^="' + prefix + '"]');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el === body) continue;
    if (el.style.display !== 'none') {
      el.style.display = 'none';
      var idNum = el.id.substring(prefix.length);
      var otherCaret = document.getElementById('fdstopc_' + orderId + '_' + idNum);
      var otherSec   = document.getElementById('fdstops_' + orderId + '_' + idNum);
      if (otherCaret) otherCaret.textContent = '▸';
      if (otherSec && otherSec.classList) otherSec.classList.remove('open');
    }
  }
  // Majd a célt átbillentjük (ha nyitva volt → csuk; ha csukva → nyit).
  body.style.display = wasOpen ? 'none' : 'block';
  if (caret) caret.textContent = wasOpen ? '▸' : '▾';
  if (sec && sec.classList) sec.classList.toggle('open', !wasOpen);
}

// Kattintásra a kártya részletei ki-/becsukódnak (felrakás/lerakás + megjegyzés).
function toggleFuvarDetails(id) {
  var el = document.getElementById('det_' + id);
  var arr = document.getElementById('exp_' + id);
  if (!el) return;
  var open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  // Egységes lenyíló-ikon az egész felületen: csukva ▸, nyitva ▾.
  if (arr) arr.textContent = open ? '▸' : '▾';
}

// Egy mező (felrakó/lerakó helyszín vagy megjegyzés) vágólapra másolása.
function soferCopy(id, kind) {
  var rec = _fuvarCopy[id];
  var txt = rec ? (rec[kind] || '') : '';
  if (!txt) { toast(t('sof.det.nothingToCopy'), 'err'); return; }
  var done = function () { toast(t('sof.det.copied'), 'ok'); };
  var fallback = function () {
    try {
      var ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta); done();
    } catch (e) { toast(t('sof.det.copyFail'), 'err'); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(done).catch(fallback);
  } else { fallback(); }
}

// Egy kiosztott fuvar kártyája — új .fuvar-card kinézet + MEGŐRZÖTT akciógombok.
// Alocat → Elfogadom, In Curs → Elvégeztem, Finalizat → nincs státuszváltó (csak UIT).
// `idx` (1-alapú): a sofőr által látott sorszám a jelenlegi aktív fuvarok
// között — összecsukott fejlécben #-badge-ként jelenik meg. Ha az aktív
// fuvarok elfogynak, a következő kiosztás újra 1-től indul (a lezárt fuvar
// dash_visible=false, nem számít bele).
function renderFuvarCard(o, idx) {
  var isAlocat = o.status === 'Alocat';
  var isCurs   = o.status === 'In Curs';
  var isFinal  = o.status === 'Finalizat';
  var isParked = o.status === 'Parkolt';
  var isWh     = o.status === 'Raktarban';
  // Parkolt/Raktarban: a fuvar a sofőrhöz van rendelve, de leadott áru —
  // csak olvasható (a diszpécser intézi a folytatást), nincs gomb.
  var statusCls = (isAlocat || isParked || isWh) ? 'warn' : 'ok';
  var statusTxt = isFinal ? t('sof.statusDone')
                : isParked ? (t('sof.statusParked') + (o.handover_loc ? ' @ ' + esc(o.handover_loc) : ''))
                : isWh ? (t('sof.statusWarehouse') + (o.handover_loc ? ' @ ' + esc(o.handover_loc) : ''))
                : esc(o.status || 'Alocat');
  var truck = o.rendszam_camion ? ('🚛 ' + esc(o.rendszam_camion) + (o.rendszam_remorca ? ' / ' + esc(o.rendszam_remorca) : '')) : '';
  // Állomás-gomb: a fuvar aktuális állapota alapján a driverStopAction dönti
  // el, hogy egyértelmű léptetés vagy több-választós előugró ablak. Nem-migrált
  // fuvarnál (nincs o.stops) a régi driverMilestone-hoz esik vissza.
  var _stopOpts = (typeof _computeNextStopOptions === 'function') ? _computeNextStopOptions(o) : null;
  var msNextIdx = -1;
  for (var _i = 0; _i < MS_STEPS.length; _i++) { if (!o[MS_STEPS[_i].col]) { msNextIdx = _i; break; } }
  var actionBtn = '';
  var headActionBtn = '';
  if ((isAlocat || isCurs)) {
    var actLabel = '', actHandler = '';
    if (_stopOpts && _stopOpts.length) {
      // Új stop-alapú út
      if (_stopOpts.length === 1) actLabel = _stopEventLabel(_stopOpts[0]);
      else actLabel = t('sof.ms.nextStep');
      actHandler = 'driverStopAction(\'' + o.id + '\')';
    } else if (_stopOpts === null && msNextIdx >= 0) {
      // Legacy 4-lépéses fallback (nincs stops-tömb, régi kliens/DB)
      actLabel = t(MS_STEPS[msNextIdx].key);
      actHandler = 'driverMilestone(\'' + o.id + '\',' + msNextIdx + ')';
    }
    if (actHandler) {
      actionBtn = '<button class="sh-btn confirm" onclick="' + actHandler + '">' +
                  '➜ ' + esc(actLabel) + '</button>';
      headActionBtn = '<button class="sh-btn confirm fuvar-head-action" ' +
        'onclick="event.stopPropagation();' + actHandler + '">' +
        '➜ ' + esc(actLabel) + '</button>';
    }
  }
  // ⛔ Áru leadása (defekt / pótkocsi-csere) — a kérést a diszpécser igazolja vissza
  var hoPending = o.handover_status === 'Fuggoben';
  var hoBtn = '';
  if (hoPending) {
    hoBtn = '<span class="fuvar-status warn">' + t('sof.handoverPending') + (o.handover_loc ? ' @ ' + esc(o.handover_loc) : '') + '</span>';
  } else if (isAlocat || isCurs) {
    // Kivételes művelet (defekt / pótkocsi-csere) — borostyán, hogy egyértelműen
    // elváljon a napi állomás-gombtól, de olvasható maradjon (a régi halvány
    // lila felirat fehér alapon gyakorlatilag eltűnt napfényben).
    hoBtn = '<button class="sh-btn ho" ' +
      'onclick="openHandover(\'' + o.id + '\')" title="' + t('sof.handoverBtnTitle') + '">' + t('sof.ho.title') + '</button>';
  }
  // Kattintható részletek forrás-adatai (biztonságos map, nem HTML-attribútum).
  // Legacy top-szintű mezők (nem-migrált fuvarnál) + minden per-stop mező (loc/firma)
  // per-kind + per-index kulccsal, hogy multi-drop fuvarnál minden felrakó/lerakó
  // helyszínét ÉS cégét külön lehessen másolni. Kulcs-séma:
  //   'load' / 'unload' / 'load_firma' / 'unload_firma'         → legacy top
  //   'pickup_0_loc' / 'pickup_0_firma' / 'delivery_2_loc' …    → per-stop
  //   'note'                                                    → megjegyzés (ref)
  var _fc = {
    load: o.loc_incarcare || '',
    unload: o.loc_descarcare || '',
    load_firma: (o.firma_incarcare || '').trim(),
    unload_firma: (o.firma_descarcare || '').trim(),
    note: o.ref || ''
  };
  if (Array.isArray(o.stops)) {
    var _pIdx = 0, _dIdx = 0;
    o.stops.slice().sort(function (a, b) { return (a.stop_index || 0) - (b.stop_index || 0); })
      .forEach(function (s) {
        if (s.kind === 'pickup') {
          _fc['pickup_' + _pIdx + '_loc']   = s.loc  || '';
          _fc['pickup_' + _pIdx + '_firma'] = (s.firma || '').trim();
          _pIdx++;
        } else if (s.kind === 'delivery') {
          _fc['delivery_' + _dIdx + '_loc']   = s.loc  || '';
          _fc['delivery_' + _dIdx + '_firma'] = (s.firma || '').trim();
          _dIdx++;
        }
      });
  }
  _fuvarCopy[o.id] = _fc;
  // Kettős dátum: TERVEZETT (dispatcher `data_incarcare`/`data_descarcare`)
  // + TÉNYLEGES (a driver menetlevelében beírt vagy az állomás-milestone-ból
  // származó `incarcat_at`/`descarcat_at`). Ha megegyezik vagy csak egyik van,
  // egy értéket mutatunk; ha eltér, „Terv.: X · Tényl.: Y" formátumban.
  var dLoadPlan   = fmtFuvarDay(o.data_incarcare);
  var dLoadActual = fmtFuvarDay(o.incarcat_at);
  var dUnloadPlan   = fmtFuvarDay(o.data_descarcare);
  var dUnloadActual = fmtFuvarDay(o.descarcat_at);
  function _fmtDualDate(planD, actualD) {
    if (!planD && !actualD) return '';
    if (planD && actualD && planD !== actualD) {
      return t('sof.det.planShort') + ': ' + planD + '  ·  ' + t('sof.det.actualShort') + ': ' + actualD;
    }
    return planD || actualD;
  }
  var dLoad = _fmtDualDate(dLoadPlan, dLoadActual);
  var dUnload = _fmtDualDate(dUnloadPlan, dUnloadActual);
  // Egy részlet-sor: címke + érték + 📋 másoló gomb (ha van mit másolni)
  function detRow(labelKey, val, copyKind) {
    if (!val) return '';
    var btn = copyKind
      ? '<button class="fd-copy" onclick="soferCopy(\'' + o.id + '\',\'' + copyKind + '\')" title="' + t('sof.det.copy') + '">📋</button>'
      : '';
    return '<div class="fd-row"><div class="fd-cell"><span class="fd-lbl">' + t(labelKey) + '</span>' +
           '<span class="fd-val">' + esc(val) + '</span></div>' + btn + '</div>';
  }
  // Meta-sor (kamion, státusz) — a KINYÍLÓ részbe kerül, hogy összecsukott
  // állapotban CSAK a fel-/lerakó adatai látszódjanak.
  // A MEGBÍZÓ (`o.client`) NEVE SZÁNDÉKOSAN SEHOL nem jelenik meg a sofőr
  // kártyáján: a sofőrnek a fel-/lerakó helyszín és az ottani cég a munkája,
  // a megrendelő cég neve nem tartozik rá (és csak zajt visz a kártyára).
  // A belső CMD-azonosító sem jelenik meg — a fuvart a felrakás dátuma/
  // helyszíne/cége és a lerakás dátuma/helyszíne/cége azonosítja.
  var metaHtml =
    '<div class="fuvar-meta">' +
      (truck ? '<span>' + truck + '</span>' : '') +
      '<span class="fuvar-status ' + statusCls + '">' + statusTxt + '</span>' +
    '</div>';
  // ── Fázis-vezérelt fel-/lerakás blokk ──────────────────────────
  // Amíg NINCS felrakodva, a sofőrt a FELRAKÁS érdekli → az van nyitva, a
  // lerakó egy koppintással lenyitható. Felrakodás után (`incarcat_at`)
  // fordul: a LERAKÁS nyílik ki, a felrakó marad lenyithatóként (pl. ha
  // vissza kell nézni a felrakó címét). Mindkettő bármikor ki-/becsukható.
  var loadedDone = !!o.incarcat_at;
  // Egy összecsukható fel-/lerakás szekció. `open` = alapból nyitva.
  function fdPhaseSec(kind, ico, headKey, sumTxt, rowsHtml, open) {
    var bid = 'fdbody_' + kind + '_' + o.id;
    var cid = 'fdcar_' + kind + '_' + o.id;
    return '<div class="fd-sec fd-coll' + (open ? ' open' : '') + '" id="fdsec_' + kind + '_' + o.id + '">' +
      '<div class="fd-sec-h" role="button" tabindex="0" ' +
           'onclick="toggleFuvarSec(\'' + o.id + '\',\'' + kind + '\')" ' +
           'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();toggleFuvarSec(\'' + o.id + '\',\'' + kind + '\');}">' +
        '<span class="fd-sec-t">' + ico + ' ' + t(headKey) + '</span>' +
        (sumTxt ? '<span class="fd-sec-sum">' + esc(sumTxt) + '</span>' : '') +
        '<span class="fd-caret" id="' + cid + '">' + (open ? '▾' : '▸') + '</span>' +
      '</div>' +
      '<div class="fd-sec-b" id="' + bid + '"' + (open ? '' : ' style="display:none"') + '>' + rowsHtml + '</div>' +
    '</div>';
  }
  // Több felrakó / lerakó pont — a o.stops tömbből építjük fel a szekciókat.
  // Ha nincs stops-tömb (nem-migrált fuvar), a régi top-szintű mezőkből.
  // A bevitel INTERLEAVED sorrendje `seq_index` alapján visszatükrözve.
  var _seqStops = Array.isArray(o.stops) ? o.stops.slice().sort(function (a, b) {
    var A = (a && a.seq_index != null) ? a.seq_index : 999999;
    var B = (b && b.seq_index != null) ? b.seq_index : 999999;
    if (A !== B) return A - B;
    var ak = a && a.kind === 'pickup' ? 0 : 1;
    var bk = b && b.kind === 'pickup' ? 0 : 1;
    if (ak !== bk) return ak - bk;
    return (a && a.stop_index || 0) - (b && b.stop_index || 0);
  }) : [];
  var _pickups = _seqStops.filter(function (s) { return s.kind === 'pickup'; });
  var _deliveries = _seqStops.filter(function (s) { return s.kind === 'delivery'; });
  // Multi-stop fuvarnál (3+ stop) MINDIG egyetlen sorrend-listát mutatunk,
  // hogy a sofőr pontosan a beírás rendjében lássa a fuvart — akkor is, ha
  // a bevitel véletlen „csoportosan" történt (pu, pu, pu, de, de). Klasszikus
  // 1 felrakó + 1 lerakó (max 2 stop) marad a jól ismert kétszekciós
  // ⬆️/⬇️ elrendezésben.
  var _interleaved = (_seqStops.length >= 3);
  function _stopStatusBadge(s) {
    if (s.done_at) return '<span class="fd-stop-done" title="' + esc(fmtFuvarDateTime(s.done_at)) + '">✅</span>';
    if (s.arrived_at) return '<span class="fd-stop-arrived" title="' + esc(fmtFuvarDateTime(s.arrived_at)) + '">📍</span>';
    return '<span class="fd-stop-todo">○</span>';
  }
  // A per-stop rows: a helyszín ÉS a cég is másolható vágólapra (📋). Kulcs:
  // 'pickup_<i>_loc' / 'pickup_<i>_firma' (a _fc map-be előre feltöltve).
  function _stopRows(s, kind, idx) {
    var firmaKey = kind + '_' + idx + '_firma';
    var locKey   = kind + '_' + idx + '_loc';
    var out =
      detRow('sof.det.company',  s.firma, s.firma ? firmaKey : null) +
      detRow('sof.det.location', s.loc,   s.loc   ? locKey   : null) +
      detRow('sof.det.date',     fmtFuvarDay(s.data), null);
    // Lerakónként külön 🚛 UIT gomb (multi-drop: minden lerakóhoz külön
    // UIT-kódot lehet felvinni). A badge a stophoz kötött UIT-ok darabszáma.
    if (kind === 'delivery' && s && s.id) {
      var uitN = parseInt(s.uit_count || 0, 10);
      var badge = uitN > 0 ? ' <span class="fd-uit-badge">' + uitN + '</span>' : '';
      out += '<div class="fd-row fd-uit-row">' +
        '<button type="button" class="sh-btn uit fd-uit-btn" ' +
          'onclick="SoferUit.open(\'' + o.id + '\',' + s.id + ')" ' +
          'title="' + t('sof.uitTitle') + '">🚛 UIT' + badge + '</button>' +
      '</div>';
    }
    return out;
  }
  var loadSec, unloadSec;
  if (_pickups.length) {
    var loadSum = _pickups.length === 1
      ? (_pickups[0].loc || '')
      : ((_pickups[0].loc || '') + ' (+' + (_pickups.length - 1) + ')');
    var loadBody = _pickups.map(function (s, i) {
      return '<div class="fd-stop-block">' +
        '<div class="fd-stop-h">' + _stopStatusBadge(s) + ' <b>' + t('sof.det.pickup') + ' #' + (i + 1) + '</b></div>' +
        _stopRows(s, 'pickup', i) +
      '</div>';
    }).join('');
    loadSec = fdPhaseSec('load', '⬆️', 'sof.det.loading', loadSum, loadBody, !loadedDone);
  } else {
    loadSec = fdPhaseSec('load', '⬆️', 'sof.det.loading', o.loc_incarcare,
      detRow('sof.det.company', o.firma_incarcare, o.firma_incarcare ? 'load_firma' : null) +
      detRow('sof.det.location', o.loc_incarcare, 'load') +
      detRow('sof.det.date', dLoad, null), !loadedDone);
  }
  if (_deliveries.length) {
    var lastDel = _deliveries[_deliveries.length - 1];
    var unloadSum = _deliveries.length === 1
      ? (lastDel.loc || '')
      : (lastDel.loc || '') + ' (' + _deliveries.length + ' ' + t('sof.det.stops') + ')';
    var unloadBody = _deliveries.map(function (s, i) {
      return '<div class="fd-stop-block">' +
        '<div class="fd-stop-h">' + _stopStatusBadge(s) + ' <b>' + t('sof.det.delivery') + ' #' + (i + 1) + '</b></div>' +
        _stopRows(s, 'delivery', i) +
      '</div>';
    }).join('');
    unloadSec = fdPhaseSec('unload', '⬇️', 'sof.det.unloading', unloadSum, unloadBody, loadedDone);
  } else {
    // Legacy (nem-migrált) fuvar — 1 lerakó, stop_id nincs. A UIT-gomb
    // ilyenkor is jelenik meg, stop_id nélkül (fuvar-szintű UIT-modal).
    var _legacyUitN = parseInt(o.uit_free_count || 0, 10);
    var _legacyBadge = _legacyUitN > 0 ? ' <span class="fd-uit-badge">' + _legacyUitN + '</span>' : '';
    unloadSec = fdPhaseSec('unload', '⬇️', 'sof.det.unloading', o.loc_descarcare,
      detRow('sof.det.company', o.firma_descarcare, o.firma_descarcare ? 'unload_firma' : null) +
      detRow('sof.det.location', o.loc_descarcare, 'unload') +
      detRow('sof.det.date', dUnload, null) +
      '<div class="fd-row fd-uit-row">' +
        '<button type="button" class="sh-btn uit fd-uit-btn" ' +
          'onclick="SoferUit.open(\'' + o.id + '\')" ' +
          'title="' + t('sof.uitTitle') + '">🚛 UIT' + _legacyBadge + '</button>' +
      '</div>', loadedDone);
  }
  // ── INTERLEAVED: ha a bevitel sorrendje pu↔de↔pu(↔de) — egyetlen sorrend-
  // szekciót renderelünk, a fuvart úgy mutatva, ahogy a diszpécser beírta.
  // Klasszikus (1 fel + 1 lerakó, vagy tisztán pu…→de…) esetben marad a jól
  // ismert kétszekciós ⬆️/⬇️ elrendezés.
  // Multi-stop akkordeon: MINDEN stop külön ki-/becsukható, alapból CSAK a
  // következő (első nem-elvégzett stop) van nyitva; másik nyitásakor a
  // korábban nyitva lévő automatikusan becsukódik → mindig egyértelmű, épp
  // mi jön.
  var routeSec = '';
  if (_interleaved && _seqStops.length) {
    // A „következő" stop = az első olyan, aminek nincs `done_at`. Ha minden
    // stop kész, egyik sincs alapból nyitva (a fuvar Finalizat felé tart).
    var _nextSeqIdx = -1;
    for (var _ni = 0; _ni < _seqStops.length; _ni++) {
      if (!_seqStops[_ni].done_at) { _nextSeqIdx = _ni; break; }
    }
    // A `_stopRows` firma+loc kulcsai a `_fc` map-ben már ott vannak (per-kind
    // + per-index feltöltve fentebb) — itt csak a kind-en belüli sorszámot
    // számoljuk vissza, hogy a másoló-gomb kulcsai stimmeljenek.
    var _pIdx2 = 0, _dIdx2 = 0;
    var routeBody = _seqStops.map(function (s, si) {
      var k = s.kind;
      var i = (k === 'pickup') ? _pIdx2++ : _dIdx2++;
      var kIco = k === 'pickup' ? '⬆️' : '⬇️';
      var kLbl = k === 'pickup' ? t('sof.det.pickup') : t('sof.det.delivery');
      var seqN = (s && s.seq_index != null) ? (s.seq_index + 1) : '';
      var isOpen = (si === _nextSeqIdx);
      var isNextBadge = isOpen ? ' <span class="fd-stop-next">' + (t('sof.det.next') || '') + '</span>' : '';
      // Összecsukott fejléc-összegzés: város · cég — hogy a sofőr nyitás
      // nélkül is tudja, melyik stop.
      var sumCity  = _cityOf(s.loc) || (s.loc || '');
      var sumFirma = (s.firma || '').trim();
      var sumBits = [];
      if (sumCity)  sumBits.push('📍 ' + esc(sumCity));
      if (sumFirma) sumBits.push('🏢 ' + esc(sumFirma));
      var sumHtml = sumBits.length ? '<span class="fd-stop-sum">' + sumBits.join(' · ') + '</span>' : '';
      var stopBodyId  = 'fdstop_' + o.id + '_' + si;
      var stopCaretId = 'fdstopc_' + o.id + '_' + si;
      var stopSecId   = 'fdstops_' + o.id + '_' + si;
      return '<div class="fd-stop-block fd-stop-seq fd-stop-coll' + (isOpen ? ' open' : '') + '" id="' + stopSecId + '">' +
        '<div class="fd-stop-h" role="button" tabindex="0" ' +
             'data-stop-toggle="1" ' +
             'onclick="toggleFuvarStop(\'' + o.id + '\',' + si + ')" ' +
             'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();toggleFuvarStop(\'' + o.id + '\',' + si + ');}">' +
          _stopStatusBadge(s) +
          ' <b>' + (seqN ? seqN + '. ' : '') + kIco + ' ' + kLbl + ' #' + (i + 1) + '</b>' +
          isNextBadge +
          sumHtml +
          '<span class="fd-caret fd-stop-caret" id="' + stopCaretId + '">' + (isOpen ? '▾' : '▸') + '</span>' +
        '</div>' +
        '<div class="fd-stop-b" id="' + stopBodyId + '"' + (isOpen ? '' : ' style="display:none"') + '>' +
          _stopRows(s, k, i) +
        '</div>' +
      '</div>';
    }).join('');
    var routeSum = _seqStops.length + ' ' + (t('sof.det.stops') || 'stop');
    routeSec = fdPhaseSec('route', '🛣️', 'sof.det.route', routeSum, routeBody, true);
  }
  var details =
    '<div class="fuvar-details" id="det_' + o.id + '" style="display:none">' +
      metaHtml +
      // Interleaved fuvar: egyetlen sorrend-szekció (a diszpécser bevitele).
      // Klasszikus fuvar: felrakodás előtt fel-, utána lerakó-szekció elöl.
      (_interleaved ? routeSec : (loadedDone ? (unloadSec + loadSec) : (loadSec + unloadSec))) +
      (o.ref ? '<div class="fd-sec">' +
        '<div class="fd-sec-h"><span class="fd-sec-t">📝 ' + t('sof.det.note') + '</span></div>' +
        detRow('sof.det.note', o.ref, 'note') +
      '</div>' : '') +
      // Állomás-idővonal:
      //   • Multi-drop (van o.stops): STOPONKÉNT 2 sor (📍 megérkeztem + 📦/✅ elvégeztem),
      //     kind/sorszám/városrövidítés jelzéssel; az első nem-lezárt stop kiemelve
      //     (narancs „ez jön" akcent). Ha egy stop mindkét mérföldköve kész,
      //     magától „ugrik" a következőre (compact ✅ Kész sor, ha akarjuk).
      //   • Legacy (nincs o.stops, csak top-mezők): a régi 4 lépés (backfilled fuvar).
      // Finalizat fuvarnál CSAK akkor, ha van rögzített állomás (különben üres ○○○○).
      ((!isParked && !isWh && (
          (Array.isArray(o.stops) && o.stops.length && (isAlocat || isCurs || o.stops.some(function(s){return s.arrived_at || s.done_at;}))) ||
          (isAlocat || isCurs || MS_STEPS.some(function(s){return o[s.col];}))
        )) ?
        '<div class="fd-sec">' +
          '<div class="fd-sec-h"><span class="fd-sec-t">🚚 ' + t('sof.ms.progress') + '</span></div>' +
          (Array.isArray(o.stops) && o.stops.length ?
            // ── PER-STOP: minden stopnak külön 2 sor ──
            (function () {
              // Első nem-lezárt (done_at IS NULL) stop = „aktív" — ezt kiemeljük.
              var activeIdx = -1;
              for (var _mi = 0; _mi < _seqStops.length; _mi++) {
                if (!_seqStops[_mi].done_at) { activeIdx = _mi; break; }
              }
              // Kind-en belüli sorszámhoz (#1, #2 …) számláló
              var puNo = 0, deNo = 0;
              return _seqStops.map(function (s, si) {
                var kindNo = (s.kind === 'pickup') ? (++puNo) : (++deNo);
                var kindIco  = s.kind === 'pickup' ? '⬆️' : '⬇️';
                var kindTxt  = t(s.kind === 'pickup' ? 'sof.det.pickup' : 'sof.det.delivery') || (s.kind === 'pickup' ? 'Felrakó' : 'Lerakó');
                var doneLbl  = t(s.kind === 'pickup' ? 'sof.ms.loaded' : 'sof.ms.unloaded');
                var arrLbl   = t(s.kind === 'pickup' ? 'sof.ms.arriveLoad' : 'sof.ms.arriveUnload');
                var cityShort = (typeof _cityOf === 'function' ? _cityOf(s.loc) : '') || (s.loc || '');
                var subCls = (si === activeIdx) ? ' fd-ms-active' : (s.done_at ? ' fd-ms-doneall' : '');
                var groupHead =
                  '<div class="fd-ms-group-h' + subCls + '">' +
                    kindIco + ' <b>' + esc(kindTxt) + ' #' + kindNo + '</b>' +
                    (cityShort ? ' · <span class="fd-ms-city">📍 ' + esc(cityShort) + '</span>' : '') +
                  '</div>';
                // ✏️ Utólagos idő-javítás gomb — csak akkor mutatjuk, ha a
                // sor időbélyegét már rögzítettük (különben a `stop-event`
                // úttal állítja be a sofőr először). Bezárt (Anulat) fuvart
                // a szerver úgyis nem enged; kliens-oldalon nem szűrünk.
                var arrKey = s.kind === 'pickup' ? 'sof.ms.arriveLoad' : 'sof.ms.arriveUnload';
                var doneKey = s.kind === 'pickup' ? 'sof.ms.loaded' : 'sof.ms.unloaded';
                var editArrBtn = s.arrived_at ?
                  '<button type="button" class="fd-ms-edit" title="' + esc(t('sof.ms.editHint') || 'Idő javítása') + '"' +
                  ' onclick="event.stopPropagation();editStopTime(\'' + o.id + '\',' + s.id + ',\'arrived_at\',\'' + esc(s.arrived_at) + '\',\'' + arrKey + '\')">✏️</button>' : '';
                var editDoneBtn = s.done_at ?
                  '<button type="button" class="fd-ms-edit" title="' + esc(t('sof.ms.editHint') || 'Idő javítása') + '"' +
                  ' onclick="event.stopPropagation();editStopTime(\'' + o.id + '\',' + s.id + ',\'done_at\',\'' + esc(s.done_at) + '\',\'' + doneKey + '\')">✏️</button>' : '';
                var rowArr =
                  '<div class="fd-ms-row' + (s.arrived_at ? ' done' : '') + '">' +
                    '<span class="fd-ms-ico">' + (s.arrived_at ? '✅' : '○') + '</span>' +
                    '<span class="fd-ms-lbl">📍 ' + esc(arrLbl) + '</span>' +
                    (s.arrived_at ? '<span class="fd-ms-time">' + esc(fmtFuvarDateTime(s.arrived_at)) + '</span>' : '') +
                    editArrBtn +
                  '</div>';
                var rowDone =
                  '<div class="fd-ms-row' + (s.done_at ? ' done' : '') + '">' +
                    '<span class="fd-ms-ico">' + (s.done_at ? '✅' : '○') + '</span>' +
                    '<span class="fd-ms-lbl">' + (s.kind === 'pickup' ? '📦 ' : '✅ ') + esc(doneLbl) + '</span>' +
                    (s.done_at ? '<span class="fd-ms-time">' + esc(fmtFuvarDateTime(s.done_at)) + '</span>' : '') +
                    editDoneBtn +
                  '</div>';
                return '<div class="fd-ms-group' + subCls + '">' + groupHead + rowArr + rowDone + '</div>';
              }).join('');
            })()
            :
            // ── LEGACY 4 lépés (backfilled 1+1 fuvar) ──
            MS_STEPS.map(function (s) {
              var done = o[s.col];
              return '<div class="fd-ms-row' + (done ? ' done' : '') + '">' +
                '<span class="fd-ms-ico">' + (done ? '✅' : '○') + '</span>' +
                '<span class="fd-ms-lbl">' + t(s.key) + '</span>' +
                (done ? '<span class="fd-ms-time">' + esc(fmtFuvarDateTime(o[s.col])) + '</span>' : '') +
              '</div>';
            }).join('')
          ) +
        '</div>' : '') +
      // Akciógombok (állomás-léptetés / áru-leadás) — a UIT-gomb most
      // LERAKÓNKÉNT jelenik meg a lerakó-sorban (multi-drop), nem itt.
      '<div class="fuvar-actions">' +
        actionBtn +
        hoBtn +
      '</div>' +
    '</div>';
  // Összecsukott állapot: #-badge (sorszám) + felrakás (dátum · cég · város)
  // → lerakás (dátum · város · cég) + nyíl. Kattintásra kinyílik (megnő a
  // kártya) a többi infóval, a fejlécre újra kattintva összecsukható. A
  // teljes cím + további részlet a `details`-ben van. CMD-azonosító a sofőr
  // felé SEHOL sem jelenik meg — az összecsukott fejléc a fuvar tartalmát
  // önmagában azonosítja (dátumok, felrakó/lerakó cég + város).
  var num = (typeof idx === 'number' && idx > 0) ? idx : null;
  var loadDayShort   = fmtFuvarDay(o.data_incarcare);
  var unloadDayShort = fmtFuvarDay(o.data_descarcare);
  var loadCity   = _cityOf(o.loc_incarcare)   || (o.loc_incarcare   || '—');
  var unloadCity = _cityOf(o.loc_descarcare)  || (o.loc_descarcare  || '—');
  var loadFirmaS   = (o.firma_incarcare  || '').trim();
  var unloadFirmaS = (o.firma_descarcare || '').trim();
  var pickBits = [];
  if (loadDayShort) pickBits.push('📅 ' + esc(loadDayShort));
  if (loadFirmaS)   pickBits.push('🏢 ' + esc(loadFirmaS));
  pickBits.push('📍 ' + esc(loadCity));
  var dropBits = [];
  if (unloadDayShort) dropBits.push('📅 ' + esc(unloadDayShort));
  dropBits.push('📍 ' + esc(unloadCity));
  if (unloadFirmaS)   dropBits.push('🏢 ' + esc(unloadFirmaS));
  var headTxt =
    '<span class="fuvar-head-pick">' + pickBits.join(' · ') + '</span>' +
    '<span class="fuvar-head-arrow"> → </span>' +
    '<span class="fuvar-head-drop">' + dropBits.join(' · ') + '</span>';
  // A `data-order-id` + (demó esetén) `data-tour-demo="1"` a SoferTour-nak
  // kell — a bemutató a demó kártyán belül várja a valós kattintást
  // (állomás-gomb, kártya-kinyitás).
  var _wrapAttrs = ' data-order-id="' + esc(o.id) + '"' + (o._isDemo ? ' data-tour-demo="1"' : '');
  var _demoHead  = o._isDemo ? '<div class="st-demo-badge">' + esc(t('sof.tour.demoBadge') || '📚 DEMO — tanuláshoz') + '</div>' : '';
  return '' +
    '<div class="fuvar-card"' + _wrapAttrs + '>' +
      _demoHead +
      '<div class="fuvar-head" role="button" tabindex="0" onclick="toggleFuvarDetails(\'' + o.id + '\')" ' +
           'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();toggleFuvarDetails(\'' + o.id + '\');}">' +
        '<div class="fuvar-destination">' +
          (num ? '<span class="fuvar-num">#' + num + '</span>' : '') +
          '<span class="fuvar-headtxt">' + headTxt + '</span>' +
          '<span class="fuvar-expand" id="exp_' + o.id + '">▸</span>' +
        '</div>' +
        headActionBtn +
      '</div>' +
      details +
    '</div>';
}

// ── ⛔ Áru leadása (sofőr-kérés, a diszpécser igazolja vissza) ──
var _hoOid = null;
function openHandover(oid) {
  _hoOid = oid;
  ['hoLoc','hoQty','hoLen','hoWid','hoHei','hoWeight','hoDocPages','hoNote'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  var u = document.getElementById('hoQtyUnit'); if (u) u.value = 'paletta';
  document.querySelectorAll('input[name="hoType"]').forEach(function(r){ r.checked = (r.value === 'trailer'); });
  hoTypeChange();
  document.getElementById('hoModal').style.display = 'flex';
  setTimeout(function(){ var l = document.getElementById('hoLoc'); if (l) l.focus(); }, 150);
}
function closeHandover() { document.getElementById('hoModal').style.display = 'none'; }
function hoTypeChange() {
  var tt = (document.querySelector('input[name="hoType"]:checked') || {}).value;
  document.getElementById('hoWhBlock').style.display = tt === 'warehouse' ? 'block' : 'none';
}
function submitHandover() {
  // ── SoferTour demó-intercept: bemutató alatt / DEMÓ fuvarra NEM
  //    küldünk kérést az irodának. Bezárjuk a modalt és toastolunk.
  if (window.SoferTour && window.SoferTour.demoIntercept &&
      (window.SoferTour.demoIntercept('handover', 'Áru leadás')
        || (_hoOid && String(_hoOid).indexOf('DEMO') === 0))) {
    try { document.getElementById('hoModal').style.display = 'none'; } catch(_){}
    return;
  }
  var type = (document.querySelector('input[name="hoType"]:checked') || {}).value;
  var loc = document.getElementById('hoLoc').value.trim();
  if (!loc) { toast(t('sof.ho.locRequired'), 'err'); return; }
  var d = { type: type, location: loc, note: document.getElementById('hoNote').value.trim() || null };
  if (type === 'warehouse') {
    d.qty = document.getElementById('hoQty').value;
    d.qty_unit = document.getElementById('hoQtyUnit').value;
    d.length_cm = document.getElementById('hoLen').value;
    d.width_cm = document.getElementById('hoWid').value;
    d.height_cm = document.getElementById('hoHei').value;
    d.weight_kg = document.getElementById('hoWeight').value;
    d.doc_pages = document.getElementById('hoDocPages').value;
  }
  var btn = document.getElementById('hoSubmitBtn');
  btn.disabled = true; btn.textContent = t('sof.sending');
  fetch('/api/execute', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ functionName:'driverHandoverRequest', arguments:[_hoOid, d] }) })
  .then(function(r){ return r.json(); })
  .then(function(resp){
    btn.disabled = false; btn.textContent = t('sof.ho.send');
    var r = resp.result;
    if (r && r.ok) {
      toast(t('sof.ho.sent'), 'ok');
      closeHandover();
      loadDashOrders();
      if (type === 'warehouse') {
        // azonnali felszólítás: dokumentumok fotózása, a fuvarhoz kötve
        var oid = _hoOid;
        setTimeout(function(){
          toast(t('sof.ho.photoNow'), 'err');
          goSec('docs');
          var sel = document.getElementById('docOrderSel');
          if (sel) sel.value = oid;
        }, 600);
      }
    } else { toast((r && r.err) || t('sof.errOccurred'), 'err'); }
  });
}

function loadDashOrders() {
  fetch('/api/execute', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ functionName:'getMySoferOrders' }) })
  .then(function(r){ return r.json(); })
  .then(function(d){
    var list = d.result || [];
    // Globális cache — a stop-választó modal a fuvar-objektumot innen olvassa.
    _soferOrdersCache = list;
    var el = document.getElementById('kiosztottList');
    if (!el) return;
    // Dashboard: CSAK élő aktív fuvar (Alocat/In Curs). A Finalizat + Parkolt
    // + Raktarban „lezárt/leadott" → már a menetlevél-picker-be tartozik.
    // Defenzív: ha a dash_visible mező hiányzik (régi, újra nem indított
    // szerver), visszaesünk a szigorúbb státusz-alapú szűrésre.
    var active = list.filter(function(o){
      if (typeof o.dash_visible === 'boolean') return o.dash_visible;
      return o.status === 'Alocat' || o.status === 'In Curs';
    });
    // A szerver `created_at DESC` sorrendben ad — a főoldali sorszámhoz
    // (legrégebbi = #1) megfordítjuk. Így új kiosztás nem üti át a meglévők
    // sorszámát: a régiek maradnak, az újak a végére kerülnek (magasabb #).
    // A lezárt fuvar kiesik → a következő kiosztás újra 1-től számoz.
    active.reverse();
    updateScrollBehavior(active);
    if (!active.length) {
      el.innerHTML = '<div class="kiosztott-empty">' + t('sof.noActiveOrders') + '</div>';
      return;
    }
    el.innerHTML = active.map(function(o, i){ return renderFuvarCard(o, i + 1); }).join('');
  });
}

function driverOrderStatus(id, status) {
  fetch('/api/orders/'+id+'/driver-status', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ status: status })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if (d.ok) {
      toast(status==='In Curs' ? t('sof.orderAccepted') : t('sof.orderCompleted'), 'ok');
      loadDashOrders();
    } else {
      toast(d.err||t('common.error'), 'err');
    }
  });
}

// Az indulás/érkezés mezők rejtettek (a Plecare/Sosire pontokból képződnek),
// ezért nem küldenek `change` eseményt — a diurna-előnézetet a
// `_syncTripTimesFromPuncte()` hívja közvetlenül, minden ablak-változáskor.

// ── Tab-visszatérés (telefon feléled, PWA elotérbe kerul): frissítjük a
//    főoldal kritikus blokkjait, hogy a stale UI ne érje váratlanul a sofőrt
//    (új kiosztott fuvar, sofőr↔jármű váltás, havi mini-statisztika). A
//    session-guard oldalán a szerver-session-t is ellenőrizzük ugyanekkor
//    (visibilitychange → authMe ping → tiszta redirect ha halott).
//    Csak a főoldalon (sec-dash), hogy a menetlevél-piszkozat/beírt űrlap
//    NE nulázódjon a listák újratöltésétől. Rate-limit: legfeljebb 20 mp-enként.
var _visRefreshLastAt = 0;
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState !== 'visible') return;
  var now = Date.now();
  if (now - _visRefreshLastAt < 20000) return;
  _visRefreshLastAt = now;
  var dashSec = document.getElementById('sec-dash');
  if (!dashSec || dashSec.classList.contains('hidden')) return;
  try { if (typeof loadDashOrders === 'function') loadDashOrders(); } catch(e) {}
  try { if (typeof loadSoferMiniStats === 'function') loadSoferMiniStats(); } catch(e) {}
  try { if (typeof loadMyAssignedVehicle === 'function') loadMyAssignedVehicle(); } catch(e) {}
  try { if (typeof renderPendingReceipts === 'function') renderPendingReceipts(); } catch(e) {}
});

// ── Nyelvváltáskor a JS-ből renderelt részek újrarajzolása ──
// (a static data-i18n elemeket a motor magától frissíti; itt a dinamikus
//  listák/kártyák kerülnek újrarenderelésre — a menetlevél-űrlap és a nyitott
//  chat-szoba állapotát NEM bántjuk, hogy ne vesszen el a beírt adat)
window.onLangChange = function(lang) {
  try { if (typeof loadDashOrders === 'function') loadDashOrders(); } catch(e) {}
  try { if (typeof loadSoferMiniStats === 'function') loadSoferMiniStats(); } catch(e) {}
  try {
    var borderSec = document.getElementById('sec-border');
    if (borderSec && !borderSec.classList.contains('hidden')) loadBorderLog();
  } catch(e) {}
  try {
    var docsSec = document.getElementById('sec-docs');
    if (docsSec && !docsSec.classList.contains('hidden')) loadDocOrderOptions();
  } catch(e) {}
  try {
    var fuvarStep1 = document.getElementById('fuvarStep1');
    var fuvarSec = document.getElementById('sec-fuvar');
    // Csak az 1. lépés (fuvar-kiválasztó) renderelődik újra — a 2. lépés űrlapja marad
    if (fuvarSec && !fuvarSec.classList.contains('hidden') && fuvarStep1 && fuvarStep1.style.display !== 'none') {
      loadSoferOrders();
    }
  } catch(e) {}
  try {
    // Chat kontaktlista újrarajzolása, ha az a nézet aktív
    var cv = document.getElementById('chatContactView');
    if (_meData && cv && cv.style.display !== 'none') soferShowContactList(_meData);
  } catch(e) {}
};

// ============================================================
// PULL-TO-REFRESH — lehúzással frissítés (mint natív mobil app / PWA)
// ============================================================
// A body-n `overscroll-behavior:none` blokkolja a natív böngésző-PTR-t
// (szándékos, hogy az app ne frissüljön véletlenül el a menetlevél-form
// billentyűzet-visszapattanásán); helyette saját, egyszerű implementáció:
// a látható `.pane-sofer` (fő görgethető panel) tetején — ha a scrollTop
// 0 és a sofőr lefelé húz — egy pill animáció jelenik meg. Küszöb fölött
// elengedéskor újratölti az aktív szekció adatait.
//
// Csak érintőképernyős eszközön aktív (touch). Blokkolva: bevitel közben,
// nyitott modal-ban, folyamatban lévő frissítés alatt.
(function initSoferPullToRefresh() {
  var hasTouch = ('ontouchstart' in window) || (navigator && navigator.maxTouchPoints > 0);
  if (!hasTouch) return;

  var THRESHOLD = 70;          // px a küszöb (lassított útból!)
  var MAX_PULL  = 120;         // px maximum húzási táv
  var DAMP      = 0.5;         // súrlódás — a natív érzethez
  var pill = null;
  var startY = 0, currentY = 0;
  var pulling = false, active = false, refreshing = false;
  var currentPane = null;

  function ensurePill() {
    if (pill) return;
    pill = document.createElement('div');
    pill.className = 'sof-ptr';
    pill.innerHTML = '<span class="sof-ptr-icon">↓</span><span class="sof-ptr-text"></span>';
    document.body.appendChild(pill);
  }

  function setState(state, dist) {
    if (!pill) ensurePill();
    var iconEl = pill.querySelector('.sof-ptr-icon');
    var textEl = pill.querySelector('.sof-ptr-text');
    if (state === 'idle') {
      pill.style.transform = 'translate(-50%, -60px)';
      pill.style.opacity = '0';
      pill.classList.remove('ready', 'refresh');
      return;
    }
    var y = Math.min(dist, MAX_PULL);
    pill.style.transform = 'translate(-50%, ' + Math.max(4, y - 30) + 'px)';
    pill.style.opacity = String(Math.min(1, dist / 40));
    if (state === 'pull') {
      pill.classList.remove('ready', 'refresh');
      iconEl.textContent = '↓';
      textEl.textContent = (typeof t === 'function') ? t('sof.ptr.pull') : 'Húzd le a frissítéshez';
    } else if (state === 'ready') {
      pill.classList.add('ready');
      pill.classList.remove('refresh');
      iconEl.textContent = '↑';
      textEl.textContent = (typeof t === 'function') ? t('sof.ptr.release') : 'Elengedéskor frissítés';
    } else if (state === 'refresh') {
      pill.classList.add('refresh');
      pill.classList.remove('ready');
      iconEl.innerHTML = '<span class="spinner"></span>';
      textEl.textContent = (typeof t === 'function') ? t('sof.ptr.refreshing') : 'Frissítés…';
      pill.style.transform = 'translate(-50%, 40px)';
      pill.style.opacity = '1';
    }
  }

  function visiblePane() {
    var panes = document.querySelectorAll('.pane-sofer');
    for (var i = 0; i < panes.length; i++) {
      if (!panes[i].classList.contains('hidden')) return panes[i];
    }
    return null;
  }

  function isModalOpen() {
    // Nyitott modal (display:flex) — a PTR blokkolva; a modal-belüli
    // görgetést ne befolyásolja.
    var modalIds = ['hoModal', 'bugModal', 'wbConfirmModal', 'receiptReviewModal',
                    'orderPickerModal', 'wbLocModal', 'sofConfirmModal', 'sofTimeModal',
                    'sofChoiceModal', 'pendingAddModal', 'orphRangeModal'];
    for (var i = 0; i < modalIds.length; i++) {
      var m = document.getElementById(modalIds[i]);
      if (m && m.style && m.style.display === 'flex') return true;
    }
    return false;
  }

  function refreshCurrent() {
    var pane = currentPane || visiblePane();
    setState('refresh', THRESHOLD);
    // Az aktív szekció adat-betöltői. Az egyes handlerek async fetch-ek —
    // a UI 900 ms után visszaáll, ami elég a legtöbb hálózati kérésre.
    try {
      if (!pane) return;
      var id = pane.id;
      if (id === 'sec-dash') {
        if (typeof loadDashOrders === 'function')        loadDashOrders();
        if (typeof loadSoferMiniStats === 'function')    loadSoferMiniStats();
        if (typeof loadMyAssignedVehicle === 'function') loadMyAssignedVehicle();
        if (typeof renderPendingReceipts === 'function') renderPendingReceipts();
        if (typeof applyBonScanVisibility === 'function') applyBonScanVisibility();
      } else if (id === 'sec-fuvar') {
        // Csak a fuvar-választó lépésen frissítünk (a step2 űrlap-adatait
        // NEM bántjuk — a piszkozat élne, de a listát nem kell újratölteni).
        var step2 = document.getElementById('fuvarStep2');
        if (!step2 || step2.style.display === 'none') {
          if (typeof loadSoferOrders === 'function')       loadSoferOrders();
          if (typeof renderDraftResume === 'function')     renderDraftResume();
          if (typeof renderPendingReceipts === 'function') renderPendingReceipts();
        }
      } else if (id === 'sec-border') {
        if (typeof loadBorderLog === 'function') loadBorderLog();
      } else if (id === 'sec-docs') {
        if (typeof loadDocOrderOptions === 'function') loadDocOrderOptions();
      }
      // sec-chat: WhatsApp-átirányítós (nincs mit frissíteni)
    } catch (_) {}
    setTimeout(function () {
      setState('idle', 0);
      refreshing = false;
    }, 900);
  }

  function onStart(e) {
    if (refreshing) return;
    // Ne indítson űrlap-bevitel közben (input/textarea/select) — a
    // billentyűzet fókusz + görgetés zavarása.
    var tgt = e.target || {};
    var tag = String(tgt.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tgt.isContentEditable) return;
    if (isModalOpen()) return;
    var pane = visiblePane();
    if (!pane) return;
    if ((pane.scrollTop || 0) > 0) return;
    var touch = (e.touches && e.touches[0]) || e;
    startY = touch.clientY;
    currentY = startY;
    pulling = true;
    active = false;
    currentPane = pane;
  }

  function onMove(e) {
    if (!pulling || refreshing) return;
    var touch = (e.touches && e.touches[0]) || e;
    currentY = touch.clientY;
    var dy = currentY - startY;
    // Ha közben a sofőr feljebb görgette (a scroll már nem 0), megszakad.
    if (currentPane && currentPane.scrollTop > 0) {
      pulling = false;
      if (active) setState('idle', 0);
      active = false;
      return;
    }
    if (dy <= 0) {
      if (active) setState('idle', 0);
      active = false;
      return;
    }
    if (!active) { active = true; ensurePill(); }
    // preventDefault csak akkor, ha valóban lefelé húzzuk (a scroll
    // fölött vagyunk) — így a görgetés máshol érintetlen.
    try { e.preventDefault(); } catch (_) {}
    var dist = Math.min(dy * DAMP, MAX_PULL);
    setState(dist >= THRESHOLD ? 'ready' : 'pull', dist);
  }

  function onEnd() {
    if (!pulling) return;
    pulling = false;
    if (!active) return;
    var dy = currentY - startY;
    var dist = dy * DAMP;
    if (dist >= THRESHOLD) {
      refreshing = true;
      refreshCurrent();
    } else {
      setState('idle', 0);
    }
    active = false;
  }

  document.addEventListener('touchstart',  onStart, { passive: true });
  document.addEventListener('touchmove',   onMove,  { passive: false });
  document.addEventListener('touchend',    onEnd,   { passive: true });
  document.addEventListener('touchcancel', onEnd,   { passive: true });
})();
