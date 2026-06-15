/* ============================================================
   VallorSoft Landing Page — landing.js
   ============================================================ */

/* ── i18n translations ────────────────────────────────────── */
const translations = {
  ro: {
    cookieTitle: 'Cookie-uri și confidențialitate',
    cookieText: 'Folosim doar cookie-uri necesare în mod implicit. Cookie-urile analitice și de marketing sunt activate doar după acordul dvs.',
    cookieNecessary: 'Doar necesare',
    cookieSettings: 'Setări',
    cookieAcceptAll: 'Accept toate',
    cookieSettingsTitle: 'Setări Cookie',
    cookieFunctional: 'Cookie-uri necesare',
    cookieFunctionalDesc: 'Necesare pentru autentificare, limbă și securitate. Nu pot fi dezactivate.',
    cookieAnalytics: 'Cookie-uri analitice',
    cookieAnalyticsDesc: 'Ne ajută să înțelegem cum utilizați platforma.',
    cookieMarketing: 'Cookie-uri de marketing',
    cookieMarketingDesc: 'Utilizate pentru reclame personalizate.',
    cookieSave: 'Salvează preferințele',
    navFeatures: 'Funcționalități',
    navHow: 'Cum funcționează',
    navPricing: 'Prețuri',
    navBlog: 'Blog',
    navContact: 'Contact',
    loginBtn: 'Autentificare',
    startBtn: 'Începe gratuit',
    heroBadge: 'Orientat pe șofer · Fără hârtii · Automatizat',
    heroTitle: 'Cele mai multe softuri de transport sunt create pentru management. Noi am început cu șoferul.',
    heroSubtitle: 'Pentru că în transport, cel mai valoros dat se naște întotdeauna la șofer.',
    startFreeBtn: 'Începe gratuit — 14 zile',
    trialNote: '✓ Fără card bancar  ·  ✓ Anulare oricând  ·  ✓ Acces imediat',
    heroBullet1: 'Nicio foaie de parcurs scrisă de mână',
    heroBullet2: 'Niciun calcul manual de diurnă',
    heroBullet3: 'Niciun bon fiscal pierdut',
    heroNote: 'Mai puțin birocrație pentru șofer · Mai mult control pentru firmă',
    sfWeek: {
      title: 'Șofer — săptămâna curentă',
      dateRange: 'Iun. 14–20',
      route: 'Cluj-Napoca → Budapest → Timișoara · 1 240 km',
      days: ['L','Ma','Mi','J','V','S','D'],
      events: [
        { label: 'Cursă înregistrată', sub: 'Data de start notată pe foaia de parcurs — diurna pornește automat' },
        { label: '🛂 Trecere frontieră — Ungaria', sub: '🤖 Diurnă: +1 zi — automat', auto: true },
        { label: '⛽ Alimentare — 120 L', sub: '📷 Bon fotografiat' },
        { label: '🛒 Achiziție — 45 €', sub: 'Vignietă autostradă' },
        { label: '🛂 Retur frontieră — România', sub: '🤖 Diurnă finalizată: 4 zile', auto: true },
        { label: '📦 Schimb remorcă · Depozitare', sub: 'Notificare push → dispecer' },
        { label: '📄 Generare foaie de parcurs', steps: '① Selectare cursă  →  ② Trimitere', result: 'MT-2026-0042 · Tipăribilă ✓', final: true },
      ],
      footer: ['4 zile diurnă', '1 240 km', '1 click PDF'],
    },
    statTrips: 'Curse active',
    statGps: 'GPS acoperire',
    statRevenue: 'Venituri lunare',
    trustLabel: 'Integrat cu',
    featuresTitle: 'Funcționalități principale',
    featuresSubtitle: 'Tot ce aveți nevoie pentru a gestiona o flotă modernă de transport',
    feat1Title: 'Managementul curselor',
    feat1Desc: 'Creare, planificare și monitorizare curse. Import CSV, board Gantt, radar de întoarcere.',
    feat2Title: 'Urmărire GPS live',
    feat2Desc: 'Poziție în timp real, hartă interactivă, istoric traseu și snapshot km zilnic.',
    feat3Title: 'Facturare automată',
    feat3Desc: 'Emitere factură direct din cursă. Suport FGO, SmartBill, Oblio, iFactura, Facturis.',
    feat4Title: 'Portal clienți',
    feat4Desc: 'Clientul vede statusul curselor, descarcă documente și poate solicita transport nou.',
    feat5Title: 'Statistici & rapoarte',
    feat5Desc: '7 tab-uri de analiză: financiar, combustibil, șoferi, vehicule, clienți. Export CSV.',
    feat6Title: 'Tabelă de planificare',
    feat6Desc: 'Vizualizare Gantt cu drag & drop, zoom, reordonare vehicule și radar de întoarcere.',
    feat7Title: 'Documente & CMR',
    feat7Desc: 'Generare scrisoare de trăsură, POD foto, ZIP masiv pentru contabilitate.',
    feat8Title: 'Subcontractori',
    feat8Desc: 'Gestiune parteneri externi cu portal propriu, facturi furnizori și urmărire datorii.',
    howTitle: 'Cum funcționează',
    howSubtitle: 'Sunteți operațional în mai puțin de 30 de minute',
    step1Title: 'Înregistrare',
    step1Desc: 'Creați un cont gratuit în 2 minute. Fără card bancar, fără contracte.',
    step2Title: 'Configurare',
    step2Desc: 'Adăugați vehicule, șoferi și integrați GPS-ul și sistemul de facturare.',
    step3Title: 'Începeți activitatea',
    step3Desc: 'Creați prima cursă, urmăriți flota în timp real și emiteți factura automat.',
    pricingTitle: 'Planuri și prețuri',
    pricingSubtitle: 'Prețuri transparente, fără costuri ascunse',
    monthly: 'Lunar',
    yearly: 'Anual',
    planBasic: 'Basic',
    perMonth: '/lună',
    pf1: 'până la 5 vehicule',
    pf2: 'Managementul curselor',
    pf3: 'Urmărire GPS',
    pf4: 'Facturare (1 provider)',
    pf5: 'Suport e-mail',
    startTrial: 'Testează gratuit',
    popular: 'Popular',
    pp1: 'Vehicule nelimitate',
    pp2: 'Toate funcționalitățile Basic',
    pp3: 'Portal clienți & subcontractori',
    pp4: 'Statistici avansate',
    pp5: 'Tabelă de planificare Gantt',
    pp6: 'Toate providerele de facturare',
    pp7: 'Suport prioritar',
    custom: 'Personalizat',
    ep1: 'Tot din Pro',
    ep2: 'SLA dedicat',
    ep3: 'Integrări personalizate',
    ep4: 'Onboarding asistat',
    ep5: 'Contract anual',
    contactUs: 'Contactați-ne',
    blogTitle: 'Resurse & Noutăți',
    tagDigital: 'Digitalizare',
    blog1Title: 'Digitalizarea transportului rutier în România',
    blog1Desc: 'Cum ajută tehnologia la eficientizarea flotelor și reducerea costurilor operaționale.',
    blog2Title: 'e-Factura 2026 — tot ce trebuie să știți',
    blog2Desc: 'Ghid complet privind obligațiile e-Factura pentru transportatori și cum VallorSoft automatizează procesul.',
    blog3Title: 'Codul UIT și RO e-Transport — ghid practic',
    blog3Desc: 'Ce este codul UIT, când este obligatoriu și cum gestionați declarațiile prin CargoTrack.',
    registerTitle: 'Începeți testarea gratuită',
    registerSub: '14 zile gratuite — fără card bancar, anulare oricând.',
    labelCompany: 'Denumire companie',
    labelEmail: 'Adresă e-mail',
    labelPassword: 'Parolă',
    termsCheck: 'Accept Termenii și Condițiile',
    privacyCheck: 'Accept Politica de Confidențialitate',
    submitRegister: 'Creați cont gratuit',
    contactTitle: 'Contact',
    contactDesc: 'Suntem disponibili pentru întrebări, demonstrații și oferte personalizate.',
    contactName: 'Nume',
    contactMessage: 'Mesaj',
    sendBtn: 'Trimite mesaj',
    footerTagline: 'Platformă SaaS pentru transport rutier & management flotă — România',
    footerTerms: 'Termeni și Condiții',
    footerPrivacy: 'Politica de Confidențialitate',
    footerCookiePolicy: 'Politica Cookie',
    footerDpa: 'DPA',
    footerSecurity: 'Securitate',
    footerCookies: 'Setări Cookie',
    footerRights: 'Toate drepturile rezervate.',
    footerIntegrations: 'Integrat nativ cu sisteme GPS și programe de facturare — FGO, SmartBill, Oblio, iFactura, Facturis, CargoTrack, Fomco, ANAF și Stripe.',
    showcaseTitle: 'Platforma în acțiune',
    showcaseSubtitle: 'Interfață modernă, accesibilă de pe orice dispozitiv',
    mon1Label: 'Dashboard',
    mon2Label: 'Managementul curselor',
    mon3Label: 'Statistici & rapoarte',
    phone1Label: 'Aplicație șofer',
    phone2Label: 'Urmărire GPS',
    demoBtn: 'Demo',
    strip1Title: 'Management curse',
    strip1Desc: 'Curse, foi de parcurs, tablă de planificare',
    strip2Title: 'GPS în timp real',
    strip2Desc: 'Poziție live, traseu, snapshot km',
    strip3Title: 'Facturare automată',
    strip3Desc: 'e-Factura, 5 adaptoare de facturare',
    strip4Title: 'Integrare e-Factura',
    strip4Desc: 'ANAF SPV, status automat',
    strip5Title: 'Rapoarte detaliate',
    strip5Desc: 'Financiar, șoferi, clienți, vehicule',
    modulesTitle: 'Un sistem, pentru toate sarcinile',
    modulesSubtitle: 'Structură modulară — plătești doar ce folosești.',
    mod1Title: 'Management curse',
    mod1Desc: 'Gestiunea curselor, clienților, vehiculelor și subcontractorilor',
    mod2Title: 'Urmărire GPS',
    mod2Desc: 'Poziție în timp real, integrare CargoTrack/Fomco',
    mod3Title: 'Facturare',
    mod3Desc: 'Emitere automată facturi prin 5 furnizori',
    mod4Title: 'e-Factura',
    mod4Desc: 'Transmitere ANAF SPV, interogare automată status',
    mod5Title: 'Documente & CMR',
    mod5Desc: 'Scrisoare trăsură, POD foto, export ZIP contabilitate',
    mod6Title: 'Portaluri',
    mod6Desc: 'Portal clienți și subcontractori separate',
    mod7Title: 'Statistici',
    mod7Desc: 'Analiză pe 7 tab-uri: financiar, combustibil, șoferi, clienți',
    mod8Title: 'Tablă de planificare',
    mod8Desc: 'Vizualizare Gantt, radar întoarcere, drag & drop',
    statsTitle: 'Cifre care vorbesc de la sine',
    stat1: 'Satisfacție clienți',
    stat2: 'Integrări active',
    stat3: 'Vehicule gestionate',
    stat4: 'Suport',
    testimonialTitle: 'Ce spun clienții noștri',
    t1Text: '"VallorSoft ne-a transformat complet modul de lucru. Totul e transparent, economisim timp și bani."',
    t2Text: '"Integrarea e-Factura și urmărirea GPS funcționează impecabil. Recomand tuturor."',
    t3Text: '"În sfârșit un sistem care înțelege nevoile reale ale transportului."',
    ctaTitle: 'Ești pregătit pentru o activitate mai eficientă?',
    ctaSubtitle: 'Testează VallorSoft gratuit 14 zile, fără obligații.',
    ctaBtn: 'Începeți testarea gratuită',
    footerProduct: 'Produs',
    footerCompany: 'Companie',
    footerAbout: 'Despre noi',
    footerContact: 'Contact',
    footerLegal: 'Legal',
    bp1: 'Funcții de bază',
    bp2: 'Urmărire GPS',
    bp3: 'Facturare',
    bp4: 'Suport e-mail',
    startNow: 'Începe acum',
    customPrice: 'Preț personalizat',
  },
  hu: {
    cookieTitle: 'Cookie-k és adatvédelem',
    cookieText: 'Alapértelmezés szerint csak szükséges cookie-kat használunk. Az analitikai és marketing cookie-k csak az Ön hozzájárulása után aktiválódnak.',
    cookieNecessary: 'Csak szükségesek',
    cookieSettings: 'Beállítások',
    cookieAcceptAll: 'Mindet elfogadom',
    cookieSettingsTitle: 'Cookie beállítások',
    cookieFunctional: 'Szükséges cookie-k',
    cookieFunctionalDesc: 'A hitelesítéshez, a nyelvi beállításhoz és a biztonsághoz szükségesek. Nem tilthatók le.',
    cookieAnalytics: 'Analitikai cookie-k',
    cookieAnalyticsDesc: 'Segítenek megérteni, hogyan használja a platformot.',
    cookieMarketing: 'Marketing cookie-k',
    cookieMarketingDesc: 'Személyre szabott hirdetésekhez használatosak.',
    cookieSave: 'Beállítások mentése',
    navFeatures: 'Funkciók',
    navHow: 'Hogyan működik',
    navPricing: 'Árak',
    navBlog: 'Blog',
    navContact: 'Kapcsolat',
    loginBtn: 'Bejelentkezés',
    startBtn: 'Kezdem',
    heroBadge: 'Sofőr-centrikus · Papírmentes · Automatizált',
    heroTitle: 'A legtöbb fuvarozási szoftver a vezetőségnek készült. Mi a sofőrrel kezdtük.',
    heroSubtitle: 'Mert a fuvarozásban a legértékesebb adat mindig a sofőrnél keletkezik.',
    startFreeBtn: 'Kezdem ingyen — 14 nap',
    trialNote: '✓ Bankkártya nélkül  ·  ✓ Bármikor lemondható  ·  ✓ Azonnali hozzáférés',
    heroBullet1: 'Nincs több papíros menetlevél',
    heroBullet2: 'Nincs több napidíj-számolgatás',
    heroBullet3: 'Nincs több elveszett tankolási bizonylat',
    heroNote: 'Kevesebb adminisztráció a sofőrnek · Több kontroll a cégnek',
    sfWeek: {
      title: 'Sofőr — aktuális hét',
      dateRange: 'Jún. 14–20',
      route: 'Kolozsvár → Budapest → Temesvár · 1 240 km',
      days: ['H','K','Sze','Cs','P','Szo','V'],
      events: [
        { label: 'Fuvar rögzítve', sub: 'Kezdő dátum a menetlevélen — diurna automatikusan elindul' },
        { label: '🛂 Határátlépés — Magyarország', sub: '🤖 Diurna: +1 nap — automatikus', auto: true },
        { label: '⛽ Tankolás — 120 L', sub: '📷 Bizonylat lefotózva' },
        { label: '🛒 Vásárlás — 45 €', sub: 'Autópálya-matrica' },
        { label: '🛂 Visszalépés — Románia', sub: '🤖 Diurna lezárva: 4 nap', auto: true },
        { label: '📦 Pótkocsi csere · Raktározás', sub: 'Push értesítés → diszpécser' },
        { label: '📄 Menetlevél generálás', steps: '① Fuvar kijelölés  →  ② Küldés', result: 'MT-2026-0042 · Nyomtatható ✓', final: true },
      ],
      footer: ['4 nap diurna', '1 240 km', '1 kattintás PDF'],
    },
    statTrips: 'Aktív fuvarok',
    statGps: 'GPS lefedettség',
    statRevenue: 'Havi bevétel',
    trustLabel: 'Integrálva',
    featuresTitle: 'Főbb funkciók',
    featuresSubtitle: 'Minden, amire szüksége van egy modern fuvarpark kezeléséhez',
    feat1Title: 'Fuvarkezelés',
    feat1Desc: 'Fuvarok létrehozása, tervezése és nyomon követése. CSV-import, Gantt-tábla, visszfuvar-radar.',
    feat2Title: 'Élő GPS-követés',
    feat2Desc: 'Valós idejű pozíció, interaktív térkép, útvonal-előzmény és napi km-snapshot.',
    feat3Title: 'Automatikus számlázás',
    feat3Desc: 'Számla kiállítása közvetlenül a fuvarból. FGO, SmartBill, Oblio, iFactura, Facturis.',
    feat4Title: 'Ügyfélportál',
    feat4Desc: 'Az ügyfél látja a fuvar státuszát, letöltheti a dokumentumokat, és új fuvart igényelhet.',
    feat5Title: 'Statisztikák és riportok',
    feat5Desc: '7 elemző tab: pénzügy, üzemanyag, sofőrök, járművek, ügyfelek. CSV-export.',
    feat6Title: 'Tervezőtábla',
    feat6Desc: 'Gantt-nézet drag & drop-pal, zoom, jármű-átrendezés és visszfuvar-radar.',
    feat7Title: 'Dokumentumok és CMR',
    feat7Desc: 'Fuvarlevél generálás, POD-fotó, tömeges ZIP letöltés könyveléshez.',
    feat8Title: 'Alvállalkozók',
    feat8Desc: 'Külső partnerek kezelése saját portállal, szállítói számlák és tartozáskövetés.',
    howTitle: 'Hogyan működik',
    howSubtitle: '30 percen belül működőképes a rendszer',
    step1Title: 'Regisztráció',
    step1Desc: '2 perc alatt ingyenes fiók létrehozása. Bankkártya és szerződés nélkül.',
    step2Title: 'Beállítás',
    step2Desc: 'Járművek, sofőrök hozzáadása, GPS és számlázó integrálása.',
    step3Title: 'Indulás',
    step3Desc: 'Az első fuvar létrehozása, a flotta valós idejű követése és az automatikus számlázás.',
    pricingTitle: 'Csomagok és árak',
    pricingSubtitle: 'Átlátható árak, rejtett költségek nélkül',
    monthly: 'Havi',
    yearly: 'Éves',
    planBasic: 'Alap',
    perMonth: '/hó',
    pf1: 'legfeljebb 5 jármű',
    pf2: 'Fuvarkezelés',
    pf3: 'GPS-követés',
    pf4: 'Számlázás (1 provider)',
    pf5: 'E-mail támogatás',
    startTrial: 'Ingyenes próba',
    popular: 'Népszerű',
    pp1: 'Korlátlan jármű',
    pp2: 'Minden Alap funkció',
    pp3: 'Ügyfél- és alvállalkozói portál',
    pp4: 'Haladó statisztikák',
    pp5: 'Gantt tervezőtábla',
    pp6: 'Minden számlázó provider',
    pp7: 'Prioritásos támogatás',
    custom: 'Egyedi',
    ep1: 'Minden Pro tartalom',
    ep2: 'Dedikált SLA',
    ep3: 'Egyedi integrációk',
    ep4: 'Segített bevezetés',
    ep5: 'Éves szerződés',
    contactUs: 'Kapcsolatfelvétel',
    blogTitle: 'Cikkek és újdonságok',
    tagDigital: 'Digitalizáció',
    blog1Title: 'A közúti fuvarozás digitalizálása Romániában',
    blog1Desc: 'Hogyan segít a technológia a flottahatékonyság növelésében és az üzemeltetési költségek csökkentésében.',
    blog2Title: 'e-Factura 2026 — amit tudni kell',
    blog2Desc: 'Teljes útmutató a fuvarozókra vonatkozó e-Factura kötelezettségekről és a VallorSoft automatizálásáról.',
    blog3Title: 'UIT-kód és RO e-Transport — gyakorlati útmutató',
    blog3Desc: 'Mi az UIT-kód, mikor kötelező, és hogyan intézze a CargoTrack segítségével.',
    registerTitle: 'Ingyenes próba indítása',
    registerSub: '14 nap ingyenesen — bankkártya nélkül, bármikor lemondható.',
    labelCompany: 'Cégnév',
    labelEmail: 'E-mail cím',
    labelPassword: 'Jelszó',
    termsCheck: 'Elfogadom az Általános Szerződési Feltételeket',
    privacyCheck: 'Elfogadom az Adatvédelmi nyilatkozatot',
    submitRegister: 'Ingyenes fiók létrehozása',
    contactTitle: 'Kapcsolat',
    contactDesc: 'Elérhetők vagyunk kérdések, bemutatók és egyedi ajánlatok esetén.',
    contactName: 'Név',
    contactMessage: 'Üzenet',
    sendBtn: 'Üzenet küldése',
    footerTagline: 'SaaS platform közúti fuvarozáshoz és flottakezeléshez — Románia',
    footerTerms: 'Általános Szerződési Feltételek',
    footerPrivacy: 'Adatvédelmi nyilatkozat',
    footerCookiePolicy: 'Cookie-szabályzat',
    footerDpa: 'DPA',
    footerSecurity: 'Biztonság',
    footerCookies: 'Cookie beállítások',
    footerRights: 'Minden jog fenntartva.',
    footerIntegrations: 'Natívan integrálva GPS-rendszerekkel és számlázó programokkal — FGO, SmartBill, Oblio, iFactura, Facturis, CargoTrack, Fomco, ANAF és Stripe.',
    showcaseTitle: 'A platform működés közben',
    showcaseSubtitle: 'Modern felület, bármilyen eszközről elérhető',
    mon1Label: 'Vezérlőpult',
    mon2Label: 'Fuvarkezelés',
    mon3Label: 'Statisztikák',
    phone1Label: 'Sofőr alkalmazás',
    phone2Label: 'GPS követés',
    demoBtn: 'Demo',
    strip1Title: 'Fuvarkezelés',
    strip1Desc: 'Fuvarok, menetlevelek, tervezőtábla',
    strip2Title: 'Valós idejű GPS',
    strip2Desc: 'Élő pozíció, útvonal, snapshot km',
    strip3Title: 'Automatizált számlázás',
    strip3Desc: 'e-Factura, 5 számlázó-adapter',
    strip4Title: 'e-Factura integráció',
    strip4Desc: 'ANAF SPV, automatikus státusz',
    strip5Title: 'Részletes riportok',
    strip5Desc: 'Pénzügy, sofőrök, ügyfelek, járművek',
    modulesTitle: 'Egy rendszer, minden feladatra',
    modulesSubtitle: 'Moduláris felépítés — csak azt fizeted, amit használsz.',
    mod1Title: 'Fuvarmenedzsment',
    mod1Desc: 'Fuvarok, ügyfelek, járművek, alvállalkozók kezelése',
    mod2Title: 'GPS Követés',
    mod2Desc: 'Valós idejű pozíció, CargoTrack/Fomco integráció',
    mod3Title: 'Számlázás',
    mod3Desc: 'Automatikus számla-kiállítás 5 provideren keresztül',
    mod4Title: 'e-Factura',
    mod4Desc: 'ANAF SPV-beküldés, automatikus státusz-lekérdezés',
    mod5Title: 'Dokumentumok & CMR',
    mod5Desc: 'CMR/fuvarlevél, POD-fotó, könyvelői ZIP export',
    mod6Title: 'Portálok',
    mod6Desc: 'Ügyfél-portál és alvállalkozói portál elkülönítve',
    mod7Title: 'Statisztika',
    mod7Desc: '7 füles elemzés: pénzügy, üzemanyag, sofőrök, ügyfelek',
    mod8Title: 'Tervezőtábla',
    mod8Desc: 'Gantt-nézet, visszfuvar-radar, drag & drop',
    statsTitle: 'Számok, amelyek magukért beszélnek',
    stat1: 'Ügyfél elégedettség',
    stat2: 'Aktív integráció',
    stat3: 'Kezelt jármű',
    stat4: 'Támogatás',
    testimonialTitle: 'Ügyfeleink mondták',
    t1Text: '"A VallorSoft teljesen átalakította a munkánkat. Minden átlátható, minden helyen van, idő és pénz spórolunk."',
    t2Text: '"Az e-Factura integráció és a GPS követés kifogástalanul működik. Mindenkinek ajánlom."',
    t3Text: '"Végre egy rendszer, ami érti a fuvarozás valódi igényeit."',
    ctaTitle: 'Készen állsz a hatékonyabb működésre?',
    ctaSubtitle: 'Próbáld ki a VallorSoft-ot 14 napig ingyen, kötelezettségek nélkül.',
    ctaBtn: 'Ingyenes próba indítása',
    footerProduct: 'Termék',
    footerCompany: 'Cég',
    footerAbout: 'Rólunk',
    footerContact: 'Kapcsolat',
    footerLegal: 'Jog',
    bp1: 'Alap funkciók',
    bp2: 'GPS követés',
    bp3: 'Számlázás',
    bp4: 'E-mail támogatás',
    startNow: 'Kezdés most',
    customPrice: 'Egyedi ár',
  }
};

/* ── Sofőr hét timeline ─────────────────────────────────────── */
function renderSoferTimeline() {
  const lang = localStorage.getItem('vs-landing-lang') || 'ro';
  const t = translations[lang] || translations.ro;
  const w = t.sfWeek;
  const el = document.getElementById('soferTimeline');
  if (!w || !el) return;

  const dotTypes = ['lp-dot-active','lp-dot-done','lp-dot-done','lp-dot-done','lp-dot-done','lp-dot-done','lp-dot-final'];

  const items = w.events.map((ev, i) => {
    const isLast = i === w.events.length - 1;
    let content = `<span class="lp-sw-label">${ev.label}</span>`;
    if (ev.sub) content += `<span class="lp-sw-sub${ev.auto ? ' lp-sw-auto' : ''}">${ev.sub}</span>`;
    if (ev.steps) content += `<span class="lp-sw-steps">${ev.steps}</span>`;
    if (ev.result) content += `<span class="lp-sw-result">${ev.result}</span>`;
    return `<div class="lp-sw-item">
      <div class="lp-sw-day">${w.days[i]}</div>
      <div class="lp-sw-dot-col">
        <div class="lp-sw-dot ${dotTypes[i] || 'lp-dot-done'}"></div>
        ${!isLast ? '<div class="lp-sw-line"></div>' : ''}
      </div>
      <div class="lp-sw-content">${content}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="lp-sw-header">
      <span class="lp-sw-title">📱 ${w.title}</span>
      <span class="lp-sw-range">${w.dateRange}</span>
    </div>
    <div class="lp-sw-trip">${w.route}</div>
    <div class="lp-sw-timeline">${items}</div>
    <div class="lp-sw-footer">${w.footer.map(f => `<span>${f}</span>`).join('')}</div>`;
}

/* ── Apply language ─────────────────────────────────────────── */
function applyLanguage(lang) {
  localStorage.setItem('vs-landing-lang', lang);
  const t = translations[lang] || translations.ro;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (t[key] !== undefined) el.textContent = t[key];
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const key = el.dataset.i18nPh;
    if (t[key] !== undefined) el.placeholder = t[key];
  });
  const toggle = document.getElementById('languageToggle');
  if (toggle) toggle.textContent = lang === 'ro' ? 'HU' : 'RO';
  document.documentElement.lang = lang;
  renderSoferTimeline();
}

document.getElementById('languageToggle')?.addEventListener('click', () => {
  const cur = localStorage.getItem('vs-landing-lang') || 'ro';
  applyLanguage(cur === 'ro' ? 'hu' : 'ro');
});

applyLanguage(localStorage.getItem('vs-landing-lang') || 'ro');

/* ── Landing szövegek DB override (best-effort, dev által szerkeszthető) ─── */
(function() {
  try {
    fetch('/api/landing-texts')
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data) return;
        var changed = false;
        if (data.ro && typeof data.ro === 'object' && Object.keys(data.ro).length) {
          Object.assign(translations.ro, data.ro);
          changed = true;
        }
        if (data.hu && typeof data.hu === 'object' && Object.keys(data.hu).length) {
          Object.assign(translations.hu, data.hu);
          changed = true;
        }
        if (changed) {
          var cur = localStorage.getItem('vs-landing-lang') || 'ro';
          applyLanguage(cur);
        }
      })
      .catch(function() { /* DB nem elérhető — alapértelmezett szövegekkel megy tovább */ });
  } catch(e) { /* no-op */ }
})();

/* ── Scroll reveal ──────────────────────────────────────────── */
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

/* ── Navbar scroll ──────────────────────────────────────────── */
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar?.classList.toggle('scrolled', window.scrollY > 40);
}, { passive: true });

/* ── Hamburger ──────────────────────────────────────────────── */
const hamburger = document.getElementById('hamburger');
const navMenu   = document.getElementById('navMenu');
hamburger?.addEventListener('click', () => {
  navMenu?.classList.toggle('open');
});
document.querySelectorAll('.nav-links a').forEach(a => {
  a.addEventListener('click', () => navMenu?.classList.remove('open'));
});

/* ── Pricing toggle ─────────────────────────────────────────── */
const monthlyBtn = document.getElementById('toggleMonthly');
const yearlyBtn  = document.getElementById('toggleYearly');

function setPricing(yearly) {
  document.querySelectorAll('.price-val[data-monthly]').forEach(el => {
    const val = yearly ? el.dataset.yearly : el.dataset.monthly;
    if (val) el.textContent = '€' + val;
  });
  monthlyBtn?.classList.toggle('active', !yearly);
  yearlyBtn?.classList.toggle('active', yearly);
}

monthlyBtn?.addEventListener('click', () => setPricing(false));
yearlyBtn?.addEventListener('click',  () => setPricing(true));

/* ── Cookie consent ─────────────────────────────────────────── */
const cookieBanner = document.getElementById('cookieBanner');
const cookieModal  = document.getElementById('cookieModal');

function hideBanner() { cookieBanner?.classList.add('hidden'); }

function saveConsent(prefs) {
  localStorage.setItem('vs-cookie-consent', JSON.stringify({ ...prefs, ts: Date.now() }));
  hideBanner();
  if (prefs.analytics) loadAnalytics();
}

if (!localStorage.getItem('vs-cookie-consent')) {
  cookieBanner?.classList.remove('hidden');
}

document.getElementById('acceptNecessary')?.addEventListener('click', () =>
  saveConsent({ necessary: true, analytics: false, marketing: false }));

document.getElementById('acceptAllCookies')?.addEventListener('click', () =>
  saveConsent({ necessary: true, analytics: true, marketing: true }));

function openCookieModal() { cookieModal?.classList.remove('hidden'); }

document.getElementById('openCookieSettings')?.addEventListener('click', openCookieModal);
document.getElementById('footerCookieBtn')?.addEventListener('click',    openCookieModal);

document.getElementById('saveCookieSettings')?.addEventListener('click', () => {
  const analytics = document.getElementById('analyticsCookies')?.checked ?? false;
  const marketing = document.getElementById('marketingCookies')?.checked ?? false;
  saveConsent({ necessary: true, analytics, marketing });
  cookieModal?.classList.add('hidden');
});

cookieModal?.addEventListener('click', e => {
  if (e.target === cookieModal) cookieModal.classList.add('hidden');
});

function loadAnalytics() {
  if (window._analyticsLoaded) return;
  window._analyticsLoaded = true;
  /* Ide jöhet pl. Google Analytics / Plausible script injektálás */
}

/* ── Toast ──────────────────────────────────────────────────── */
function showToast(msg, type = 'success') {
  const tc = document.getElementById('toastContainer');
  if (!tc) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  tc.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

/* ── Register form ──────────────────────────────────────────── */
document.getElementById('registerForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const btn  = document.getElementById('registerSubmit');
  const lang = localStorage.getItem('vs-landing-lang') || 'ro';

  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company:  form.company.value.trim(),
        email:    form.email.value.trim().toLowerCase(),
        password: form.password.value,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || (lang === 'hu' ? 'Sikeres regisztráció!' : 'Înregistrare reușită!'), 'success');
      form.reset();
    } else {
      showToast(data.message || (lang === 'hu' ? 'Hiba történt' : 'Eroare'), 'error');
    }
  } catch {
    showToast(lang === 'hu' ? 'Hálózati hiba' : 'Eroare de rețea', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = translations[lang]?.submitRegister || 'Creați cont gratuit'; }
  }
});

/* ── Contact form ───────────────────────────────────────────── */
document.getElementById('contactForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const lang = localStorage.getItem('vs-landing-lang') || 'ro';
  showToast(lang === 'hu' ? 'Üzenet elküldve!' : 'Mesaj trimis!', 'success');
  e.target.reset();
});

/* ── Dinamikus árazási kártyák (/api/public-plans alapján) ─── */
function renderPricingGrid(plans) {
  const grid = document.getElementById('lpPricingGrid');
  if (!grid || !plans || !plans.length) return; // fallback statikus
  const lang = window._lang || localStorage.getItem('vs-landing-lang') || 'ro';
  const periodLabel = lang === 'hu' ? '/hó' : '/lună';
  const startLabel  = lang === 'hu' ? 'Kezdés most' : 'Începeți acum';
  const popLabel    = lang === 'hu' ? 'Legnépszerűbb' : 'Cel mai popular';

  grid.innerHTML = plans.map(function(p, i) {
    const featured = i === 1; // a második kártya kiemelt
    const price = p.price_net > 0 ? '€' + Math.round(p.price_net) : (lang === 'hu' ? 'Egyedi' : 'Personalizat');
    return '<div class="lp-pricing-card' + (featured ? ' lp-pricing-featured' : '') + ' reveal">'
      + (featured ? '<div class="lp-plan-badge">' + popLabel + '</div>' : '')
      + '<div class="lp-plan-name">' + escHtmlLp(p.name) + '</div>'
      + '<div class="lp-plan-price">'
      +   '<span class="lp-price-val">' + escHtmlLp(price) + '</span>'
      +   (p.price_net > 0 ? '<span class="lp-price-period">' + periodLabel + '</span>' : '')
      + '</div>'
      + '<ul class="lp-plan-features"><li>' + escHtmlLp(p.description || (lang === 'hu' ? 'Minden funkció' : 'Toate funcțiile')) + '</li></ul>'
      + '<a href="/register" class="' + (featured ? 'lp-btn-primary' : 'lp-btn-outline') + ' lp-btn-full">' + startLabel + '</a>'
      + '</div>';
  }).join('');
}

function escHtmlLp(v) {
  return String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Betöltés induláskor — ha hiba van, a statikus fallback marad
(function fetchPlans() {
  fetch('/api/public-plans')
    .then(function(r){ return r.json(); })
    .then(function(d){ if (d.ok && d.plans && d.plans.length) renderPricingGrid(d.plans); })
    .catch(function(){}); // csendben megőrzi a statikus fallback-et
})();
