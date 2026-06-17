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

    navFeatures: 'Funcții',
    navHow: 'Cum funcționează',
    navPricing: 'Prețuri',
    navBlog: 'Blog',
    navContact: 'Întrebări',

    loginBtn: 'Autentificare',
    loginDispatcher: 'Dispecerat',
    loginDispatcherSub: 'Admin · Manager · Contabil · Șofer',
    loginClient: 'Portal client',
    loginClientSub: 'Urmărire curse & documente',
    loginCarrier: 'Portal transportator',
    loginCarrierSub: 'Curse alocate & documente',
    startBtn: 'Încearcă gratuit',

    heroBadge: 'TMS pentru firme de transport din România',
    heroTitleA: 'Dispecerat, flotă și facturare',
    heroTitleB: 'care lucrează în ritmul tău.',
    heroSubtitle: 'vallorSoft strânge comenzile, vehiculele, șoferii, documentele și facturarea într-o platformă gândită pentru transportul românesc — în română și maghiară. Mai puține telefoane și hârtii, mai mult timp pentru curse.',
    heroTick1: 'Comenzile din e-mail devin curse cu un singur clic, citite automat (AI)',
    heroTick2: 'Poziție GPS live și radar de curse retur — mai puțini kilometri în gol',
    heroTick3: 'Facturi prin furnizorul tău (FGO, SmartBill, Oblio, iFactura, Facturis) + e-Factura',
    startFreeBtn: 'Încearcă 14 zile gratuit',
    demoBtn: 'Cere o demonstrație',
    heroNote: '✓ Fără card bancar · ✓ Configurare în câteva minute · ✓ Asistență în română și maghiară',

    mockRevenueLabel: 'Venit luna aceasta',
    mockActive: '37 curse active',
    mockProfitLabel: 'Profit',
    mockRecent: 'Curse recente',
    mockStInprogress: 'In Curs',
    mockStAlloc: 'Alocat',
    mockStDone: 'Finalizat',
    mockFleet: 'Flotă activă',
    mockFleetNote: '12 vehicule · 8 pe drum',

    trustLabel: 'Integrări și conformitate pentru piața din România',

    benefitsEyebrow: 'De ce vallorSoft',
    benefitsTitle: 'Mai puțin haos pe birou, mai mult control pe drum',
    benefit1Title: 'Dispecerat fără bâlbâieli',
    benefit1Desc: 'Centru operațional cu listă de priorități: ce pleacă azi, ce întârzie și ce document mai lipsește.',
    benefit2Title: 'Flota ta, pe hartă',
    benefit2Desc: 'Poziție live, estimare de sosire și radar de curse retur, ca să umpli remorca pe drumul de întoarcere.',
    benefit3Title: 'Bani urmăriți, nu ghiciți',
    benefit3Desc: 'Factură emisă rapid, profit calculat pe fiecare cursă, sold de încasat de la clienți și de plătit către transportatori.',
    benefit4Title: 'Pregătit pentru cerințele RO',
    benefit4Desc: 'e-Factura, e-Transport/UIT, alerte de expirare la ITP, RCA și rovinietă, plus respectarea regulilor GDPR.',

    featEyebrow: 'Module',
    featTitle: 'Tot fluxul unei firme de transport, fără salturi între programe',
    featSubtitle: 'De la prima ofertă până la factura încasată, totul stă în același loc.',
    featCol1Title: 'Curse & dispecerat',
    featCol1L1: 'Centru operațional cu tablou de bord zilnic',
    featCol1L2: 'Comenzi FTL și LTL cu planificator drag & drop',
    featCol1L3: 'Radar de curse retur și planificare rute pentru camioane',
    featCol1L4: 'Citire comenzi din e-mail cu AI și oferte de preț',
    featCol2Title: 'Flotă & conformitate',
    featCol2L1: 'Evidență vehicule, șoferi și transportatori parteneri',
    featCol2L2: 'Alerte de expirare pentru ITP, RCA, rovinietă și tahograf',
    featCol2L3: 'Jurnal de mentenanță și import de carduri de combustibil',
    featCol2L4: 'e-CMR, e-Transport/UIT și raport de emisii CO₂',
    featCol3Title: 'Finanțe & rapoarte',
    featCol3L1: 'Facturi emise și primite, sincronizate cu e-Factura',
    featCol3L2: 'Scadențar de plăți și decont pentru șoferi',
    featCol3L3: 'Statistici, indicatori SLA și profit calculat pe cursă',
    featCol3L4: 'Portal pentru clienți și transportatori, plus export contabil',

    howEyebrow: 'Simplu',
    howTitle: 'Cum funcționează',
    howSubtitle: 'De la cont nou la prima factură, în aceeași zi.',
    step1Title: 'Preiei cursa',
    step1Desc: 'Din e-mail (automat, cu AI), din portalul clientului sau manual — toate ajung în același loc.',
    step2Title: 'Aloci și urmărești',
    step2Desc: 'Pui șofer și vehicul, vezi poziția GPS live, documentele și statusul în timp real.',
    step3Title: 'Închizi și facturezi',
    step3Desc: 'Emiți factura prin furnizorul tău, o trimiți în e-Factura și vezi profitul rămas pe cursă.',

    pricingEyebrow: 'Prețuri',
    pricingTitle: 'Un plan pentru fiecare mărime de flotă',
    pricingSubtitle: 'Începi cu proba gratuită și crești pachetul pe măsură ce crește firma.',
    billingMonthly: 'Lunar',
    billingAnnual: 'Anual',
    billingAnnualBadge: '−1 lună',
    perMonth: '/lună',
    planAlapAudience: 'Pentru transportatori la început · 1–2 vehicule',
    planStandardAudience: 'Pentru flote în creștere · 3–5 vehicule',
    planProAudience: 'Pentru operare completă · 6–20 vehicule',
    planBusinessAudience: 'Pentru flote mari · 20+ vehicule',
    planStartBtn: 'Testează gratuit',
    planContactBtn: 'Contactează-ne',
    planPopular: 'Recomandat',
    customPrice: 'Personalizat',
    pricingVatNote: 'Prețurile sunt nete, fără TVA (21%). Plată în EUR sau RON (curs BNR). 14 zile gratuit, fără card.',
    addonTitle: 'Resurse suplimentare',

    testiEyebrow: 'Clienți',
    testimonialTitle: 'Ce spun transportatorii care lucrează cu noi',
    t1Text: '„Am lăsat în urmă fișierele Excel și apelurile fără sfârșit. Dispecerul vede totul pe un ecran, iar facturile pleacă la timp."',
    t1Name: 'Marius P.', t1Company: 'Director, firmă de transport · Cluj',
    t2Text: '„Radarul de curse retur ne-a tăiat din kilometrii goi. Se vede direct în profitul pe cursă, lună de lună."',
    t2Name: 'Andrei D.', t2Company: 'Dispecer · Timișoara',
    t3Text: '„e-Factura și e-Transport merg fără bătăi de cap. Totul e în limba noastră, iar echipa s-a obișnuit în câteva zile."',
    t3Name: 'Eszter K.', t3Company: 'Administrator · Sfântu Gheorghe',

    blogEyebrow: 'Resurse',
    blogTitle: 'Resurse & Noutăți',
    blog1Title: 'Digitalizarea transportului rutier în România',
    blog1Desc: 'Cum ajută tehnologia la eficientizarea flotelor și la reducerea costurilor de zi cu zi.',
    blog2Title: 'e-Factura 2026 — ce trebuie să știe transportatorii',
    blog2Desc: 'Ghid despre obligațiile e-Factura și cum automatizează vallorSoft întregul proces.',
    blog3Title: 'Codul UIT și RO e-Transport — ghid practic',
    blog3Desc: 'Ce este codul UIT, când e obligatoriu și cum îl gestionezi prin CargoTrack.',
    blogReadMore: 'Citește mai mult →',

    faqEyebrow: 'Întrebări',
    faqTitle: 'Întrebări frecvente',
    faq1Q: 'Cât durează proba gratuită?',
    faq1A: '14 zile, fără card bancar. Ai acces la toate funcțiile pachetului ales.',
    faq2Q: 'Trimite facturi în e-Factura (ANAF)?',
    faq2A: 'Da — prin furnizorul tău de facturare (FGO, SmartBill, Oblio, iFactura sau Facturis). Tu alegi furnizorul, noi ne ocupăm de restul.',
    faq3Q: 'Funcționează cu GPS-ul meu?',
    faq3A: 'Da, integrăm CargoTrack și Fomco pentru poziție live și estimare de consum.',
    faq4Q: 'Datele firmei mele sunt în siguranță?',
    faq4A: 'Da. Datele sunt separate pe fiecare firmă (multi-tenant), conform GDPR, cu export și dreptul de ștergere.',
    faq5Q: 'Pot renunța oricând?',
    faq5A: 'Da, fără obligații pe termen lung. Plătești lunar sau anual, cu o lună gratuită la plata anuală.',

    contactEmailTitle: 'E-mail', contactEmail: 'vallorsoft@gmail.com',
    contactPhoneTitle: 'Telefon', contactPhone: '+40 769 532 015',
    contactStartTitle: 'Începe acum',
    startNow: 'Încearcă gratuit',

    ctaTitle: 'Începe astăzi cu vallorSoft',
    ctaSubtitle: '14 zile gratuit, fără card. Te configurezi în câteva minute și pornești prima cursă.',
    ctaBtn: 'Încearcă gratuit',

    footerProduct: 'Produs',
    footerLegal: 'Legal',
    footerTagline: 'Platformă TMS pentru firme de transport din România. Comenzi, flotă, facturare și conformitate, dintr-un singur loc.',
    footerRights: 'Toate drepturile rezervate.',
    footerTerms: 'Termeni și condiții',
    footerPrivacy: 'Confidențialitate (GDPR)',
    footerDpa: 'DPA',
    footerCookiePolicy: 'Politica cookie-uri',
    footerSecurity: 'Securitate',
    footerCookies: 'Setări cookie',
    footerContactHead: 'Contact',
    footerCompanyName: 'VALLOR TEAM SRL',
    footerCompanyReg: 'CUI 47859317 · J2023000114142',
    footerCompanyAddr: 'Sat Arcuș, Cart. Poiana Arcușului nr. 102, cod 527166, jud. Covasna',
    footerCompanyContact: '📞 0769 532 015 · ✉ vallorsoft@gmail.com',
    footerIntegrations: 'Integrat nativ cu sisteme GPS și programe de facturare — FGO, SmartBill, Oblio, iFactura, Facturis, CargoTrack, Fomco și ANAF.',
    footerMade: 'Realizat în România 🇷🇴',
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
    navContact: 'Kérdések',

    loginBtn: 'Bejelentkezés',
    loginDispatcher: 'Diszpécser / Admin',
    loginDispatcherSub: 'Admin · Manager · Könyvelő · Sofőr',
    loginClient: 'Ügyfél-portál',
    loginClientSub: 'Fuvarkövetés és dokumentumok',
    loginCarrier: 'Alvállalkozói portál',
    loginCarrierSub: 'Kiosztott fuvarok és dokumentumok',
    startBtn: 'Ingyenes próba',

    heroBadge: 'TMS romániai fuvarozó cégeknek',
    heroTitleA: 'Diszpécserszolgálat, flotta és számlázás,',
    heroTitleB: 'a te tempódban.',
    heroSubtitle: 'A vallorSoft egy helyre gyűjti a fuvarokat, járműveket, sofőröket, dokumentumokat és a számlázást — a romániai fuvarozásra szabva, románul és magyarul. Kevesebb telefon és papír, több idő a fuvarokra.',
    heroTick1: 'Az e-mailes megrendelésekből egy kattintással fuvar lesz, AI olvassa ki',
    heroTick2: 'Élő GPS-pozíció és visszfuvar-radar — kevesebb üres kilométer',
    heroTick3: 'Számlázás a saját szolgáltatóddal (FGO, SmartBill, Oblio, iFactura, Facturis) + e-Factura',
    startFreeBtn: 'Próbáld ki 14 napig ingyen',
    demoBtn: 'Kérj bemutatót',
    heroNote: '✓ Bankkártya nélkül · ✓ Pár perces beállítás · ✓ Magyar és román támogatás',

    mockRevenueLabel: 'E havi bevétel',
    mockActive: '37 aktív fuvar',
    mockProfitLabel: 'Profit',
    mockRecent: 'Legutóbbi fuvarok',
    mockStInprogress: 'Folyamatban',
    mockStAlloc: 'Kiosztva',
    mockStDone: 'Lezárva',
    mockFleet: 'Aktív flotta',
    mockFleetNote: '12 jármű · 8 úton',

    trustLabel: 'Integrációk és megfelelőség a romániai piacra',

    benefitsEyebrow: 'Miért a vallorSoft',
    benefitsTitle: 'Kevesebb káosz az irodában, több kontroll az úton',
    benefit1Title: 'Diszpécserkedés akadozás nélkül',
    benefit1Desc: 'Operatív központ prioritás-listával: mi indul ma, mi késik és melyik dokumentum hiányzik még.',
    benefit2Title: 'A flottád a térképen',
    benefit2Desc: 'Élő pozíció, érkezés-becslés és visszfuvar-radar, hogy a hazafelé úton se menjen üresen a pótkocsi.',
    benefit3Title: 'Követett pénz, nem találgatás',
    benefit3Desc: 'Gyors számlakiállítás, fuvaronkénti profit, ügyfelektől beszedendő és fuvarozóknak fizetendő egyenleg.',
    benefit4Title: 'Felkészülve a román előírásokra',
    benefit4Desc: 'e-Factura, e-Transport/UIT, lejárati riasztások ITP-re, RCA-ra és matricára, plusz a GDPR-szabályok betartása.',

    featEyebrow: 'Modulok',
    featTitle: 'Egy fuvarozó cég teljes folyamata, programok közti ugrálás nélkül',
    featSubtitle: 'Az első ajánlattól a beszedett számláig minden egy helyen van.',
    featCol1Title: 'Fuvarok & diszpécser',
    featCol1L1: 'Operatív központ napi vezérlőpulttal',
    featCol1L2: 'FTL és LTL fuvarok drag & drop tervezőtáblával',
    featCol1L3: 'Visszfuvar-radar és kamionos útvonaltervezés',
    featCol1L4: 'Megrendelések kiolvasása e-mailből AI-jal, plusz árajánlatok',
    featCol2Title: 'Flotta & megfelelőség',
    featCol2L1: 'Járművek, sofőrök és partner fuvarozók nyilvántartása',
    featCol2L2: 'Lejárati riasztások ITP-re, RCA-ra, matricára és tachográfra',
    featCol2L3: 'Szerviznapló és üzemanyagkártya-import',
    featCol2L4: 'e-CMR, e-Transport/UIT és CO₂-kibocsátási riport',
    featCol3Title: 'Pénzügy & riportok',
    featCol3L1: 'Kimenő és bejövő számlák, e-Facturával szinkronban',
    featCol3L2: 'Fizetési ütemterv és sofőr-elszámolás',
    featCol3L3: 'Statisztikák, SLA-mutatók és fuvaronkénti profit',
    featCol3L4: 'Ügyfél- és alvállalkozói portál, plusz könyvelői export',

    howEyebrow: 'Egyszerű',
    howTitle: 'Hogyan működik',
    howSubtitle: 'Új fióktól az első számláig, akár egy nap alatt.',
    step1Title: 'Beveszed a fuvart',
    step1Desc: 'E-mailből (automatikusan, AI-jal), az ügyfélportálról vagy kézzel — minden egy helyre fut be.',
    step2Title: 'Kiosztod és követed',
    step2Desc: 'Sofőrt és járművet rendelsz hozzá, élőben látod a GPS-pozíciót, a dokumentumokat és a státuszt.',
    step3Title: 'Lezárod és számlázol',
    step3Desc: 'Kiállítod a számlát a saját szolgáltatóddal, beküldöd az e-Facturába, és látod a fuvaron maradt profitot.',

    pricingEyebrow: 'Árak',
    pricingTitle: 'Minden flottaméretnek megvan a maga csomagja',
    pricingSubtitle: 'Az ingyenes próbával kezdesz, és a céggel együtt nő a csomag is.',
    billingMonthly: 'Havonta',
    billingAnnual: 'Éves',
    billingAnnualBadge: '−1 hónap ingyen',
    perMonth: '/hó',
    planAlapAudience: 'Induló fuvarozóknak · 1–2 jármű',
    planStandardAudience: 'Növekvő flottáknak · 3–5 jármű',
    planProAudience: 'Teljes körű működéshez · 6–20 jármű',
    planBusinessAudience: 'Nagy flottáknak · 20+ jármű',
    planStartBtn: 'Ingyenes próba',
    planContactBtn: 'Kapcsolatfelvétel',
    planPopular: 'Ajánlott',
    customPrice: 'Egyedi',
    pricingVatNote: 'Az árak nettó árak, ÁFA nélkül (21%). Fizetés EUR-ban vagy RON-ban (BNR-árfolyam). 14 nap ingyen, kártya nélkül.',
    addonTitle: 'Kiegészítők',

    testiEyebrow: 'Ügyfelek',
    testimonialTitle: 'Mit mondanak a velünk dolgozó fuvarozók',
    t1Text: '„Magunk mögött hagytuk az Excel-táblákat és a végtelen telefonálást. A diszpécser egy képernyőn lát mindent, a számlák pedig időben indulnak."',
    t1Name: 'Marius P.', t1Company: 'Igazgató, fuvarozó cég · Kolozsvár',
    t2Text: '„A visszfuvar-radar lefaragta az üres kilométereket. Hónapról hónapra látszik a fuvaronkénti profitban."',
    t2Name: 'Andrei D.', t2Company: 'Diszpécser · Temesvár',
    t3Text: '„Az e-Factura és az e-Transport gond nélkül megy. Minden a saját nyelvünkön van, a csapat pár nap alatt megszokta."',
    t3Name: 'Eszter K.', t3Company: 'Ügyvezető · Sepsiszentgyörgy',

    blogEyebrow: 'Cikkek',
    blogTitle: 'Cikkek és újdonságok',
    blog1Title: 'A közúti fuvarozás digitalizálása Romániában',
    blog1Desc: 'Hogyan segít a technológia a flották hatékonyabbá tételében és a napi költségek csökkentésében.',
    blog2Title: 'e-Factura 2026 — amit a fuvarozóknak tudniuk kell',
    blog2Desc: 'Útmutató az e-Factura kötelezettségekről és arról, hogyan automatizálja a vallorSoft a teljes folyamatot.',
    blog3Title: 'UIT-kód és RO e-Transport — gyakorlati útmutató',
    blog3Desc: 'Mi az UIT-kód, mikor kötelező, és hogyan intézed a CargoTrackon keresztül.',
    blogReadMore: 'Tovább olvasom →',

    faqEyebrow: 'Kérdések',
    faqTitle: 'Gyakori kérdések',
    faq1Q: 'Meddig tart az ingyenes próba?',
    faq1A: '14 nap, bankkártya nélkül. A választott csomag minden funkciójához hozzáférsz.',
    faq2Q: 'Küld számlát az e-Facturába (ANAF)?',
    faq2A: 'Igen — a saját számlázó-szolgáltatódon keresztül (FGO, SmartBill, Oblio, iFactura vagy Facturis). Te választod a szolgáltatót, a többit mi intézzük.',
    faq3Q: 'Működik az én GPS-emmel?',
    faq3A: 'Igen, a CargoTrackot és a Fomcót integráljuk élő pozícióhoz és fogyasztás-becsléshez.',
    faq4Q: 'Biztonságban vannak a cégem adatai?',
    faq4A: 'Igen. Az adatok cégenként elkülönítve tárolódnak (multi-tenant), a GDPR szerint, exporttal és törlési joggal.',
    faq5Q: 'Bármikor lemondhatom?',
    faq5A: 'Igen, hosszú távú kötelezettség nélkül. Havonta vagy évente fizetsz, éves fizetésnél egy hónap ingyen.',

    contactEmailTitle: 'E-mail', contactEmail: 'vallorsoft@gmail.com',
    contactPhoneTitle: 'Telefon', contactPhone: '+40 769 532 015',
    contactStartTitle: 'Kezdés most',
    startNow: 'Ingyenes próba',

    ctaTitle: 'Kezdj még ma a vallorSoft-tal',
    ctaSubtitle: '14 nap ingyen, kártya nélkül. Pár perc alatt beállítod, és indíthatod az első fuvart.',
    ctaBtn: 'Ingyenes próba',

    footerProduct: 'Termék',
    footerLegal: 'Jog',
    footerTagline: 'TMS platform romániai fuvarozó cégeknek. Fuvarok, flotta, számlázás és megfelelőség, egy helyen.',
    footerRights: 'Minden jog fenntartva.',
    footerTerms: 'Általános Szerződési Feltételek',
    footerPrivacy: 'Adatvédelem (GDPR)',
    footerDpa: 'DPA',
    footerCookiePolicy: 'Cookie-szabályzat',
    footerSecurity: 'Biztonság',
    footerCookies: 'Cookie beállítások',
    footerContactHead: 'Kapcsolat',
    footerCompanyName: 'VALLOR TEAM SRL',
    footerCompanyReg: 'CUI 47859317 · J2023000114142',
    footerCompanyAddr: 'Sat Arcuș, Cart. Poiana Arcușului nr. 102, cod 527166, jud. Covasna',
    footerCompanyContact: '📞 0769 532 015 · ✉ vallorsoft@gmail.com',
    footerIntegrations: 'Natívan integrálva GPS-rendszerekkel és számlázó programokkal — FGO, SmartBill, Oblio, iFactura, Facturis, CargoTrack, Fomco és ANAF.',
    footerMade: 'Romániában készült 🇷🇴',
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
  if (_cachedPlans) renderPricingGrid(_cachedPlans);
  if (_cachedAddonPrices) renderAddonPrices(_cachedAddonPrices);
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

/* ── Bejelentkezés dropdown ─────────────────────────────────── */
window.toggleLoginDrop = function () {
  const wrap = document.getElementById('loginWrap');
  const btn  = document.getElementById('loginToggle');
  if (!wrap) return;
  const open = wrap.classList.toggle('open');
  btn?.setAttribute('aria-expanded', open ? 'true' : 'false');
};
document.addEventListener('click', function (e) {
  const wrap = document.getElementById('loginWrap');
  if (wrap && !wrap.contains(e.target)) {
    wrap.classList.remove('open');
    document.getElementById('loginToggle')?.setAttribute('aria-expanded', 'false');
  }
});

/* ── Hamburger ──────────────────────────────────────────────── */
const hamburger = document.getElementById('hamburger');
const navMenu   = document.getElementById('navMenu');
hamburger?.addEventListener('click', () => {
  navMenu?.classList.toggle('open');
});
document.querySelectorAll('#navMenu a').forEach(a => {
  a.addEventListener('click', () => navMenu?.classList.remove('open'));
});

/* ── FAQ accordion ──────────────────────────────────────────── */
document.querySelectorAll('.qa').forEach(function (qa) {
  var q = qa.querySelector('.q');
  if (q) q.addEventListener('click', function () { qa.classList.toggle('open'); });
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

/* ── Dinamikus árazási kártyák (/api/public-plans alapján) ─── */
var _cachedPlans        = null;
var _cachedAddonPrices  = null;
var _billingMode        = 'monthly'; // 'monthly' | 'annual'

var _planColorClasses = ['lp-plan-green', 'lp-plan-blue', 'lp-plan-indigo', 'lp-plan-dark'];
var _planAudienceKeys = ['planAlapAudience', 'planStandardAudience', 'planProAudience', 'planBusinessAudience'];

function setBillingMode(mode) {
  _billingMode = mode;
  document.querySelectorAll('.lp-toggle-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.billing === mode);
  });
  if (_cachedPlans) renderPricingGrid(_cachedPlans);
}

function renderPricingGrid(plans) {
  const grid = document.getElementById('lpPricingGrid');
  if (!grid || !plans || !plans.length) return;
  _cachedPlans = plans;
  const lang     = localStorage.getItem('vs-landing-lang') || 'ro';
  const t        = translations[lang] || translations.ro;
  const isAnnual = (_billingMode === 'annual');
  const featuredIndex = 2; // Pro kártya kiemelt

  grid.innerHTML = plans.map(function(p, i) {
    const colorClass  = _planColorClasses[i] || 'lp-plan-blue';
    const isFeature   = (i === featuredIndex);
    const isDark      = (i === 3);
    const audienceKey = _planAudienceKeys[Math.min(i, _planAudienceKeys.length - 1)];
    const audience    = t[audienceKey] || escHtmlLp(p.description || '');

    const monthlyEur = parseFloat(p.price_net) || 0;
    const annualEur  = monthlyEur * 11; // 11 hónap = 12 hónap hozzáférés
    const moEqEur    = annualEur / 12;  // havi ekvivalens éves csomagnál

    let priceHtml;
    if (monthlyEur > 0) {
      if (isAnnual) {
        priceHtml = '<span class="lp-price-val">€' + annualEur + '</span>'
          + '<span class="lp-price-period">' + (lang === 'hu' ? '/év' : '/an') + '</span>'
          + '<div class="lp-price-annual-note">≈ €' + moEqEur.toFixed(2) + (lang === 'hu' ? '/hó' : '/lună') + '</div>'
          + '<div class="lp-price-saving">' + (lang === 'hu' ? '1 hónap ingyen' : '1 lună gratuită') + '</div>';
      } else {
        priceHtml = '<span class="lp-price-val">€' + Math.round(monthlyEur) + '</span>'
          + '<span class="lp-price-period">' + (lang === 'hu' ? '/hó' : '/lună') + '</span>';
      }
    } else {
      priceHtml = '<span class="lp-price-val lp-price-custom">'
        + (lang === 'hu' ? 'Egyedi' : 'Personalizat') + '</span>';
    }

    var liTick = '<span class="c"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" fill="none" stroke="currentColor" stroke-width="3"/></svg></span>';
    let featureItems = '';
    if (Array.isArray(p.features) && p.features.length) {
      featureItems = p.features.map(function(f) {
        var text = (f && typeof f === 'object') ? (f[lang] || f.ro || '') : String(f);
        return '<li>' + liTick + escHtmlLp(text) + '</li>';
      }).join('');
    } else if (p.description) {
      featureItems = '<li>' + liTick + escHtmlLp(p.description) + '</li>';
    }

    const billing  = isAnnual ? 'annual' : 'monthly';
    const ctaHref  = isDark ? '#contact' : ('/register?billing=' + billing);
    const ctaLabel = isDark ? (t.planContactBtn || (lang === 'hu' ? 'Kapcsolatfelvétel' : 'Contactați-ne'))
                            : (t.planStartBtn   || (lang === 'hu' ? 'Ingyenes próba' : 'Testează gratuit'));
    // .btn primary a kiemelt és a sötét (Business) kártyán is, hogy a meleg CTA-stílust kapja; a többi ghost
    const ctaClass = isFeature ? 'btn primary' : 'btn ghost';
    const badge    = isFeature
      ? '<div class="tag lp-plan-badge">' + (t.planPopular || (lang === 'hu' ? 'Ajánlott' : 'Recomandat')) + '</div>'
      : '';
    // a csomagnév színe a pozíció szerint (apus de soare paletta)
    var nameColors = ['#78716c', '#0d9488', '#f6711e', '#15803d'];
    var nameColor  = nameColors[i] || '#78716c';

    return '<div class="plan lp-pricing-card ' + colorClass + (isFeature ? ' hot lp-pricing-featured' : '') + ' reveal visible">'
      + badge
      + '<div class="lp-plan-name nm" style="color:' + nameColor + '">' + escHtmlLp(p.name) + '</div>'
      + '<div class="lp-plan-audience aud">' + escHtmlLp(audience) + '</div>'
      + '<div class="lp-plan-price price">' + priceHtml + '</div>'
      + '<ul class="lp-plan-features">' + featureItems + '</ul>'
      + '<a href="' + ctaHref + '" class="' + ctaClass + ' lp-btn-full">' + escHtmlLp(ctaLabel) + '</a>'
      + '</div>';
  }).join('');

  // ÁFA-megjegyzés a rács alatt
  const vatNote = document.getElementById('lpPricingVat');
  if (vatNote) vatNote.textContent = t.pricingVatNote || '';
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

// Add-on árak betöltése (best-effort)
(function fetchAddons() {
  fetch('/api/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName: 'devGetAddonPrices', arguments: [] })
  }).then(function(r) { return r.json(); })
    .then(function(d) {
      var prices = d && d.result && d.result.prices;
      if (prices) renderAddonPrices(prices);
    }).catch(function(){});
})();

function renderAddonPrices(prices) {
  _cachedAddonPrices = prices;
  var section = document.getElementById('lpAddonSection');
  var grid    = document.getElementById('lpAddonGrid');
  if (!section || !grid) return;
  var lang = localStorage.getItem('vs-landing-lang') || 'ro';
  var perMonth = lang === 'hu' ? '/hó' : '/lună';
  var items = [
    { icon: '🚛', ro: '+1 vehicul',    hu: '+1 jármű',     price: prices.vehicle },
    { icon: '👤', ro: '+1 angajat',    hu: '+1 munkatárs', price: prices.user },
    { icon: '🧑‍✈️', ro: '+1 șofer',   hu: '+1 sofőr',     price: prices.driver },
  ];
  grid.innerHTML = items.map(function(it) {
    var label = lang === 'hu' ? it.hu : it.ro;
    return '<div class="lp-addon-chip">'
      + it.icon + ' ' + escHtmlLp(label)
      + ' — <strong>€' + (parseFloat(it.price) || 0).toFixed(0) + perMonth + '</strong>'
      + '</div>';
  }).join('');
  section.style.display = '';
}

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
        if (data.sectionOrder && data.sectionOrder.length > 0) {
          applySectionOrder(data.sectionOrder);
        }
        if (data.sectionVisibility) {
          applySectionVisibility(data.sectionVisibility);
        }
      })
      .catch(function() { /* DB nem elérhető — alapértelmezett szövegekkel megy tovább */ });
  } catch(e) { /* no-op */ }
})();

function applySectionOrder(order) {
  var footer = document.querySelector('footer.lp-footer');
  if (!footer) return;
  var sections = {};
  document.querySelectorAll('[data-vs-section]').forEach(function(el) {
    sections[el.getAttribute('data-vs-section')] = el;
  });
  order.forEach(function(key) {
    if (sections[key] && footer.parentNode) {
      footer.parentNode.insertBefore(sections[key], footer);
    }
  });
}

function applySectionVisibility(visibility) {
  document.querySelectorAll('[data-vs-section]').forEach(function(el) {
    var key = el.getAttribute('data-vs-section');
    if (key in visibility) {
      el.style.display = visibility[key] === false ? 'none' : '';
    }
  });
}
