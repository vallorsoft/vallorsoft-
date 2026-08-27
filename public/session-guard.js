/* ============================================================
   VallorSoft — Session Guard
   Automatikus kijelentkeztetes inaktivitas utan.
   Minden vedett oldal betolti (admin, manager, sofer, developer).
   ============================================================ */

(function() {
  'use strict';

  // ---- Beallitasok ----
  // Alap: 30 perc. A hivo oldal felulirhatja: window.VS_IDLE_LIMIT_MIN = <perc>.
  // Peldaul a sofor mobil-app kozben oraig nem koppint (vezet) -> a sofer.html
  // 8 orat allit be, hogy a szerver-cookie (7 nap) elottii esemenyek ne veszszenek.
  var _idleMin = (typeof window !== 'undefined' && Number(window.VS_IDLE_LIMIT_MIN) > 0)
    ? Number(window.VS_IDLE_LIMIT_MIN) : 30;
  var IDLE_LIMIT_MS   = _idleMin * 60 * 1000;
  var WARN_BEFORE_MS  = 2 * 60 * 1000;   // 2 perccel elotte figyelmeztetes
  var CHECK_INTERVAL  = 15 * 1000;       // 15 mp-enkent ellenoriz

  var lastActivity = Date.now();
  var warned       = false;
  var warnBanner   = null;
  var authPingInFlight = false;
  // A PWA/tab background-ba kerülésének időbélyege — a visibilitychange
  // `visible` ágán ebből számoljuk, mennyi ideig volt hidden. Ha bőven
  // huzamosabb (in-app recovery mód alatt legalább `HIDDEN_MIN_RECOVER_MS`),
  // MINDIG mutatjuk az overlay-t → a Frissítés gombbal a sofőr egy koppintással
  // friss adatért megy vissza a szerverhez (nem beragadt cache).
  var hiddenAt = 0;
  var HIDDEN_MIN_RECOVER_MS = 30 * 1000;  // 30 mp — egy villanás/push-notif nem trigger, egy valódi bezárás igen

  // In-app session-recovery: ha a hivo oldal (pl. sofer.html) beallitja
  // a window.VS_INAPP_SESSION_RECOVER = true-t, akkor NEM iranyitunk at
  // /login-re. Helyette a window.__vsShowSessionOverlay(reason)-t hivjuk
  // meg, ami saját overlay-t mutat („Frissites / Kilepes"). Igy offline
  // allapotban is a szeme elott marad a felulet, a sofor nem panikol.
  function _inappRecoverEnabled() {
    try { return !!window.VS_INAPP_SESSION_RECOVER; } catch(e) { return false; }
  }
  function _tryInappRecover(reason) {
    if (!_inappRecoverEnabled()) return false;
    try {
      if (typeof window.__vsShowSessionOverlay === 'function') {
        window.__vsShowSessionOverlay(reason || 'expired');
        return true;
      }
    } catch(e) {}
    return false;
  }

  // ---- Aktivitas frissites ----
  function markActivity() {
    lastActivity = Date.now();
    if (warned) {
      warned = false;
      removeWarnBanner();
    }
  }

  // Felhasznaloi esemenyek figyelese
  ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(function(evt) {
    document.addEventListener(evt, markActivity, { passive: true });
  });

  // ---- Kilepes ----
  function doLogout(reason) {
    try {
      // Push leiratkozas ha van
      if (window.VS_PUSH && typeof VS_PUSH.unsubscribe === 'function') {
        // nem varunk ra, csak elinditjuk
      }
    } catch(e) {}

    // Session torles a szerveren
    fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName: 'authLogout', arguments: [] })
    }).then(function() {
      redirectToLogin(reason);
    }).catch(function() {
      redirectToLogin(reason);
    });
  }

  function redirectToLogin(reason) {
    // In-app recovery mod (sofer.html) — ha a hivo oldal ezt kerte, NEM
    // navigalunk el; helyette overlay-t mutatunk, hogy a felulet ott
    // maradjon, es a driver egy Frissites-sel visszakerulhessen.
    if (_tryInappRecover(reason)) return;
    var url = '/login';
    if (reason === 'idle') url += '?timeout=1';
    window.location.href = url;
  }

  // ---- Figyelmezteto banner ----
  function showWarnBanner(secondsLeft) {
    if (warnBanner) {
      updateWarnCountdown(secondsLeft);
      return;
    }
    warnBanner = document.createElement('div');
    warnBanner.id = 'vs-session-warn';
    warnBanner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0',
      'background:linear-gradient(180deg,#b91c1c,#991b1b)',
      'color:#fff', 'z-index:99999', 'padding:14px 20px',
      'display:flex', 'align-items:center', 'justify-content:center',
      'gap:16px', 'font-size:14px', 'font-weight:600',
      'box-shadow:0 4px 20px rgba(0,0,0,0.5)',
      'flex-wrap:wrap'
    ].join(';');
    warnBanner.innerHTML =
      '<span>\u26A0\uFE0F Hamarosan automatikusan kijelentkezel inaktivit\u00E1s miatt: ' +
      '<b id="vs-session-countdown">' + secondsLeft + '</b> mp</span>' +
      '<button id="vs-session-stay" style="background:#fff;color:#991b1b;border:none;' +
      'border-radius:8px;padding:8px 18px;font-weight:700;cursor:pointer;font-size:13px;">' +
      'Bejelentkezve maradok</button>';
    document.body.appendChild(warnBanner);

    document.getElementById('vs-session-stay').onclick = function() {
      markActivity();
    };
  }

  function updateWarnCountdown(secondsLeft) {
    var el = document.getElementById('vs-session-countdown');
    if (el) el.textContent = secondsLeft;
  }

  function removeWarnBanner() {
    if (warnBanner && warnBanner.parentNode) {
      warnBanner.parentNode.removeChild(warnBanner);
    }
    warnBanner = null;
  }

  // ---- Foellenorzo ciklus ----
  setInterval(function() {
    var idle = Date.now() - lastActivity;

    if (idle >= IDLE_LIMIT_MS) {
      doLogout('idle');
      return;
    }

    if (idle >= (IDLE_LIMIT_MS - WARN_BEFORE_MS)) {
      warned = true;
      var secondsLeft = Math.ceil((IDLE_LIMIT_MS - idle) / 1000);
      showWarnBanner(secondsLeft);
    }
  }, CHECK_INTERVAL);

  // ---- Tab kozotti szinkronizalas (ha egyik tabban kilep, mindenhol) ----
  // Ha az egyik fulon aktivitas van, a tobbi is frissul
  window.addEventListener('storage', function(e) {
    if (e.key === 'vs_last_activity') {
      lastActivity = Date.now();
    }
  });
  document.addEventListener('click', function() {
    try { localStorage.setItem('vs_last_activity', Date.now()); } catch(e) {}
  }, { passive: true });

  // ---- Fedezetlen mobil-eset: telefon lock -> tab-hatterbe -> setInterval
  //      throttolodik iOS/Androidon (percenkent 1-szer vagy ritkabban), es
  //      amikor a felhasznalo visszater, sokszor kesve dont. Emiatt lehet
  //      "app latszik, de nem mukodik" allapot: a szerver-session esetleg mar
  //      megszunt (pl. deploy vagy explicit kileptetes miatt), a kliens
  //      viszont nem tudja. Megoldas: visibilitychange-en AZONNAL:
  //        1) ha az idle mar tullepte a limitet -> tiszta kileptetes,
  //        2) egyebkent silent authMe ping -> ha a szerver mar nem lat minket,
  //           azonnal atiranyitas /login-re (nem kell a felhasznalonak
  //           manualisan Kilepest nyomnia).
  document.addEventListener('visibilitychange', function() {
    // Hidden-ba kerülés: rögzítjük az időbélyeget, hogy a visszatéréskor
    // el tudjuk dönteni, mennyi ideig volt a lap háttérben.
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    if (document.visibilityState !== 'visible') return;
    var idle = Date.now() - lastActivity;
    if (idle >= IDLE_LIMIT_MS) {
      doLogout('idle');
      return;
    }
    // ── In-app recovery (sofőr PWA): ha a lap ELÉG SOKÁIG (30+ mp) volt
    // hidden-ben, MINDIG mutassuk az overlay-t. Így amikor a sofőr a PWA-ból
    // kilép és visszalép, egyértelmű "🔄 Frissítés" gombbal élő adatért megy
    // a szerverhez — sosem hisz beragadt cache-nek, sosem gondolja, hogy
    // "offline" a szerver, ha valójában csak a cache-t nézi. Rövid (< 30 mp)
    // háttér-villanás (push-notification, gyors app-switch) nem trigger.
    if (_inappRecoverEnabled() && hiddenAt > 0) {
      var hiddenFor = Date.now() - hiddenAt;
      hiddenAt = 0;
      if (hiddenFor >= HIDDEN_MIN_RECOVER_MS) {
        _tryInappRecover('resume');
        return;
      }
    }
    if (authPingInFlight) return;
    // Ha explicit offline vagyunk (navigator.onLine=false), NE tegyunk
    // meg egy varhatoan bukott hivast — in-app modban rogton mutassuk
    // meg a recovery overlay-t, hogy a driver tudja, most nem elerheto
    // a szerver. Nem-in-app modban egyszeruen ne csinaljunk semmit
    // (redirect nelkul, mint eddig).
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      _tryInappRecover('offline');
      return;
    }
    authPingInFlight = true;
    try {
      fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ functionName: 'authMe' }),
        credentials: 'same-origin'
      })
      .then(function(r) { return r.json().catch(function(){ return {}; }); })
      .then(function(d) {
        authPingInFlight = false;
        // authMe null-t ad, ha nincs bejelentkezett user (session lejart, torolve).
        if (!d || d.result == null) redirectToLogin('expired');
      })
      .catch(function() {
        authPingInFlight = false;
        // Halozati hiba — in-app modban jelezzuk, hogy nem tudtuk
        // ellenorizni a session-t; a driver egy Frissitesre visszater.
        _tryInappRecover('offline');
      });
    } catch(e) { authPingInFlight = false; }
  });

})();