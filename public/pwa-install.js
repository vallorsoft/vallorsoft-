// ============================================================
//  VallorSoft — pwa-install.js
//  Kis "telepítés/letöltés" gomb (FAB) a jobb alsó sarokban, ami a PWA-t
//  telepíti a készülékre (beforeinstallprompt). A sofőr felületen mindig,
//  az admin/manager felületen CSAK sofőr-módban látszik
//  (window.VS_PWA_INSTALL.setEnabled(bool)).
//  A gomb csak akkor jelenik meg, ha a böngésző valóban telepíthetőnek
//  jelzi az appot (Chrome/Edge/Android) ÉS még nincs telepítve.
// ============================================================
(function () {
  var deferred = null;
  // Alap: engedélyezett (sofer). Az admin/manager a betöltés előtt false-ra
  // állítja (window.__pwaInstallDefault=false), majd sofőr-módban kapcsolja be.
  var enabled = (window.__pwaInstallDefault !== false);

  function isStandalone() {
    try {
      return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
        || window.navigator.standalone === true;
    } catch (e) { return false; }
  }

  function ensureBtn() {
    var b = document.getElementById('pwaInstallFab');
    if (b) return b;
    if (!document.body) return null;
    b = document.createElement('button');
    b.id = 'pwaInstallFab';
    b.type = 'button';
    b.title = 'Instalează aplicația';
    b.setAttribute('aria-label', 'Instalează aplicația');
    b.textContent = '⬇️';
    b.style.cssText = 'position:fixed;right:24px;bottom:84px;z-index:600;width:44px;height:44px;'
      + 'border-radius:50%;border:1px solid rgba(34,197,94,0.5);'
      + 'background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;'
      + 'font-size:20px;line-height:1;cursor:pointer;display:none;'
      + 'align-items:center;justify-content:center;'
      + 'box-shadow:0 6px 20px rgba(22,163,74,0.42);transition:transform .15s ease;'
      + 'padding-bottom:calc(env(safe-area-inset-bottom, 0px));';
    b.addEventListener('touchstart', function () { b.style.transform = 'scale(.92)'; }, { passive: true });
    b.addEventListener('touchend', function () { b.style.transform = ''; });
    b.onclick = doInstall;
    document.body.appendChild(b);
    return b;
  }

  function refresh() {
    var b = ensureBtn();
    if (!b) return;
    b.style.display = (deferred && enabled && !isStandalone()) ? 'flex' : 'none';
  }

  function doInstall() {
    if (!deferred) return;
    deferred.prompt();
    var d = deferred;
    d.userChoice.then(function () { deferred = null; refresh(); }).catch(function () {});
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    refresh();
  });
  window.addEventListener('appinstalled', function () { deferred = null; refresh(); });

  window.VS_PWA_INSTALL = {
    setEnabled: function (v) { enabled = !!v; refresh(); },
    isAvailable: function () { return !!deferred; }
  };

  if (document.body) refresh();
  else document.addEventListener('DOMContentLoaded', refresh);
})();
