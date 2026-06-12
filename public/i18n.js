// ============================================================
//  VallorSoft — public/i18n.js  (kétnyelvűség: HU / RO)
//  HU az alap (jelenlegi), RO teljes fordítás, váltható. A motor:
//   - t(kulcs, vars)  → fordított szöveg az aktuális nyelven
//   - data-i18n="kulcs"        → elem textContent-je
//   - data-i18n-ph="kulcs"     → placeholder
//   - data-i18n-html="kulcs"   → innerHTML
//   - data-i18n-title="kulcs"  → title
//  A nyelv localStorage('vs-lang')-ban; alapból a böngésző RO/HU szerint,
//  különben HU. A jobb felső sarokba automatikusan kerül egy 🇭🇺/🇷🇴 kapcsoló
//  (vagy a #langSwitch konténerbe, ha van). Új felület: csak t()/data-i18n
//  kulcsokat használj, és vedd fel ide a HU+RO párt → máris kétnyelvű.
// ============================================================
(function () {
  var DICT = {
    // ── Közös ──
    'common.save': { hu: 'Mentés', ro: 'Salvează' },
    'common.cancel': { hu: 'Mégse', ro: 'Anulează' },
    'common.delete': { hu: 'Törlés', ro: 'Șterge' },
    'common.edit': { hu: 'Szerkesztés', ro: 'Editează' },
    'common.close': { hu: 'Bezár', ro: 'Închide' },
    'common.back': { hu: '← Vissza', ro: '← Înapoi' },
    'common.logout': { hu: 'Kilépés', ro: 'Ieșire' },
    'common.search': { hu: 'Keresés...', ro: 'Căutare...' },
    'common.loading': { hu: 'Betöltés…', ro: 'Se încarcă…' },
    'common.error': { hu: 'Hiba', ro: 'Eroare' },
    'common.serverError': { hu: 'Szerver hiba', ro: 'Eroare server' },
    'common.email': { hu: 'E-mail', ro: 'E-mail' },
    'common.password': { hu: 'Jelszó', ro: 'Parolă' },
    'common.required': { hu: 'kötelező', ro: 'obligatoriu' },

    // ── Login ──
    'login.subtitle': { hu: 'Fuvarmenedzsment Rendszer', ro: 'Sistem de management transport' },
    'login.email': { hu: 'E-mail cím', ro: 'Adresă de e-mail' },
    'login.password': { hu: 'Jelszó', ro: 'Parolă' },
    'login.signin': { hu: 'Bejelentkezés', ro: 'Autentificare' },
    'login.forgot': { hu: 'Elfelejtette a jelszavát?', ro: 'Ați uitat parola?' },
    'login.noAccount': { hu: 'Nincs még fiókja?', ro: 'Nu aveți cont încă?' },
    'login.register': { hu: 'Regisztráció kóddal', ro: 'Înregistrare cu cod' },
    'login.checking': { hu: 'Ellenőrzés...', ro: 'Se verifică...' },
    'login.allFields': { hu: 'Minden mező kitöltése kötelező!', ro: 'Toate câmpurile sunt obligatorii!' },
    'login.badCreds': { hu: 'Hibás belépési adatok!', ro: 'Date de autentificare incorecte!' },
    'login.commErr': { hu: 'Szerver kommunikációs hiba!', ro: 'Eroare de comunicare cu serverul!' },
    'login.2faTitle': { hu: 'Kétlépéses hitelesítés', ro: 'Autentificare în doi pași' },
    'login.2faHelp': { hu: 'Add meg a hitelesítő alkalmazásban (Google Authenticator) megjelenő 6 jegyű kódot.', ro: 'Introduceți codul din 6 cifre afișat în aplicația de autentificare (Google Authenticator).' },
    'login.6digit': { hu: '6 jegyű kód', ro: 'Cod din 6 cifre' },
    'login.trust30': { hu: '30 napig ne kérjen kódot ezen az eszközön', ro: 'Nu cere cod pe acest dispozitiv timp de 30 de zile' },
    'login.enter': { hu: 'Belépés', ro: 'Intră' },
    'login.lostPhone': { hu: 'Elveszett a telefonod? Használd valamelyik tartalék kódot.', ro: 'Ți-ai pierdut telefonul? Folosește unul dintre codurile de rezervă.' },
    'login.needCode': { hu: 'Add meg a kódot!', ro: 'Introduceți codul!' },
    'login.wrongCode': { hu: 'Helytelen kód', ro: 'Cod incorect' },
    'login.setupTitle': { hu: 'Biztonsági beállítás kötelező', ro: 'Configurare de securitate obligatorie' },
    'login.setupHelp': { hu: 'A fiókod védelmében kétlépéses hitelesítést kell beállítanod. Olvasd be a QR-kódot a Google Authenticator (vagy hasonló) alkalmazással.', ro: 'Pentru protecția contului trebuie să configurezi autentificarea în doi pași. Scanează codul QR cu aplicația Google Authenticator (sau similară).' },
    'login.cantScan': { hu: 'Nem tudod beolvasni? Írd be kézzel ezt a kulcsot:', ro: 'Nu poți scana? Introdu manual această cheie:' },
    'login.enterGenerated': { hu: 'Írd be a generált 6 jegyű kódot a megerősítéshez', ro: 'Introdu codul generat din 6 cifre pentru confirmare' },
    'login.confirmEnter': { hu: 'Megerősítés és belépés', ro: 'Confirmă și intră' },
    'login.setupErr': { hu: 'Hiba a 2FA beállításnál', ro: 'Eroare la configurarea 2FA' },
    'login.backupTitle': { hu: 'Tartalék kódok — mentsd el!', ro: 'Coduri de rezervă — salvează-le!' },
    'login.backupWarn': { hu: '⚠️ Ezeket a kódokat csak MOST látod. Mentsd el biztonságos helyre! Ha elveszted a telefonod, ezekkel tudsz belépni.', ro: '⚠️ Vezi aceste coduri DOAR ACUM. Salvează-le într-un loc sigur! Dacă îți pierzi telefonul, te poți autentifica cu ele.' },
    'login.savedNext': { hu: 'Elmentettem, tovább', ro: 'Le-am salvat, continuă' },
    'login.forgotSent': { hu: 'Ha létezik a fiók, elküldtük a linket.', ro: 'Dacă contul există, am trimis linkul.' },
    'login.enterEmailFirst': { hu: 'Adja meg az email címét a mezőben, majd kattintson újra!', ro: 'Introduceți adresa de e-mail în câmp, apoi faceți clic din nou!' },
    'login.timeout': { hu: 'Biztonsági okból kiléptettünk inaktivitás miatt. Jelentkezz be újra.', ro: 'Din motive de securitate v-am deconectat din cauza inactivității. Autentificați-vă din nou.' }
  };

  function getLang() {
    try { var l = localStorage.getItem('vs-lang'); if (l === 'hu' || l === 'ro') return l; } catch (e) {}
    try { if ((navigator.language || '').toLowerCase().indexOf('ro') === 0) return 'ro'; } catch (e) {}
    return 'hu';
  }
  function t(key, vars) {
    var e = DICT[key];
    var s = e ? (e[getLang()] || e.hu || key) : key;
    if (vars) Object.keys(vars).forEach(function (k) { s = String(s).replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]); });
    return s;
  }
  function applyI18n(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    root.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    root.querySelectorAll('[data-i18n-html]').forEach(function (el) { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
    root.querySelectorAll('[data-i18n-title]').forEach(function (el) { el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); });
  }
  function setLang(l) {
    if (l !== 'hu' && l !== 'ro') return;
    try { localStorage.setItem('vs-lang', l); } catch (e) {}
    document.documentElement.setAttribute('lang', l);
    applyI18n(document);
    syncSwitcher();
    if (typeof window.onLangChange === 'function') { try { window.onLangChange(l); } catch (e) {} }
  }
  function syncSwitcher() {
    var lang = getLang();
    document.querySelectorAll('[data-lang-btn]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-lang-btn') === lang);
    });
  }
  function injectSwitcher() {
    if (document.querySelector('[data-lang-btn]')) { syncSwitcher(); return; }
    var host = document.getElementById('langSwitch');
    var fixed = false;
    if (!host) { host = document.createElement('div'); host.id = 'langSwitch'; fixed = true; }
    host.innerHTML =
      '<button type="button" data-lang-btn="hu" onclick="I18N.set(\'hu\')" title="Magyar">🇭🇺 HU</button>'
      + '<button type="button" data-lang-btn="ro" onclick="I18N.set(\'ro\')" title="Română">🇷🇴 RO</button>';
    if (fixed) {
      host.style.cssText = 'position:fixed;top:10px;right:12px;z-index:99999;display:flex;gap:4px;';
      document.body.appendChild(host);
    }
    if (!document.getElementById('langSwitchStyle')) {
      var st = document.createElement('style'); st.id = 'langSwitchStyle';
      st.textContent = '#langSwitch button{cursor:pointer;font-size:12px;font-weight:700;padding:5px 9px;border-radius:8px;'
        + 'border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#8a97a8;font-family:inherit;}'
        + '#langSwitch button.active{background:var(--brand-red,#e10b1a);border-color:var(--brand-red,#e10b1a);color:#fff;}';
      document.head.appendChild(st);
    }
    syncSwitcher();
  }

  window.t = t;
  window.I18N = { t: t, set: setLang, get: getLang, apply: applyI18n, dict: DICT, mountSwitcher: injectSwitcher };

  function boot() {
    document.documentElement.setAttribute('lang', getLang());
    applyI18n(document);
    injectSwitcher();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
