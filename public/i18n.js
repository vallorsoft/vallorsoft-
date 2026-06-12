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
    'common.loadErr': { hu: 'Betöltési hiba.', ro: 'Eroare la încărcare.' },
    'common.email': { hu: 'E-mail', ro: 'E-mail' },
    'common.password': { hu: 'Jelszó', ro: 'Parolă' },
    'common.required': { hu: 'kötelező', ro: 'obligatoriu' },

    // ── Oldalsáv / menü (admin + manager) ──
    'nav.grpOverview': { hu: 'Áttekintés', ro: 'Prezentare generală' },
    'nav.dash': { hu: 'Vezérlőpult', ro: 'Panou de control' },
    'nav.grpLogistics': { hu: 'Fuvarozás & Logisztika', ro: 'Transport & Logistică' },
    'nav.orders': { hu: 'Fuvarfeladatok ▾', ro: 'Curse ▾' },
    'nav.ordersForm': { hu: 'Kiírás', ro: 'Creare' },
    'nav.ordersList': { hu: 'Kezelés', ro: 'Gestionare' },
    'nav.inbound': { hu: 'Megrendelések', ro: 'Comenzi primite' },
    'nav.planner': { hu: '📅 Tervezőtábla', ro: '📅 Planificator' },
    'nav.waybills': { hu: 'Fuvarlevelek', ro: 'Foi de parcurs' },
    'nav.warehouse': { hu: '📦 Raktár', ro: '📦 Depozit' },
    'nav.decont': { hu: 'Sofőr-elszámolás', ro: 'Decont șofer' },
    'nav.driverDocs': { hu: 'Feltöltött Iratok & CMR-ek', ro: 'Documente & CMR-uri' },
    'nav.routePlanning': { hu: 'Útvonaltervezés', ro: 'Planificare rută' },
    'nav.grpStats': { hu: 'Statisztika & Riport', ro: 'Statistici & Rapoarte' },
    'nav.stats': { hu: '📊 Statisztika ▾', ro: '📊 Statistici ▾' },
    'nav.overview': { hu: 'Áttekintés', ro: 'Prezentare generală' },
    'nav.finance': { hu: 'Pénzügy', ro: 'Financiar' },
    'nav.consum': { hu: 'Fogyasztás', ro: 'Consum' },
    'nav.purchases': { hu: 'Vásárlások', ro: 'Achiziții' },
    'nav.driversPerf': { hu: 'Sofőr teljesítmény', ro: 'Performanță șoferi' },
    'nav.vehUsage': { hu: 'Jármű kihasználtság', ro: 'Utilizare vehicule' },
    'nav.clientReport': { hu: 'Ügyfél riport', ro: 'Raport clienți' },
    'nav.permissions': { hu: '🔐 Jogosultságok', ro: '🔐 Permisiuni' },
    'nav.grpFleet': { hu: 'Flotta & Megfelelés', ro: 'Flotă & Conformitate' },
    'nav.expiries': { hu: '⏰ Lejáratok', ro: '⏰ Expirări' },
    'nav.service': { hu: '🔧 Szerviz & karbantartás', ro: '🔧 Service & întreținere' },
    'nav.fuelCard': { hu: '⛽ Üzemanyagkártya', ro: '⛽ Card carburant' },
    'nav.grpAdmin': { hu: 'Adminisztráció', ro: 'Administrare' },
    'nav.users': { hu: 'Felhasználók ▾', ro: 'Utilizatori ▾' },
    'nav.staff': { hu: 'Munkatársak kezelése', ro: 'Gestionare angajați' },
    'nav.invites': { hu: 'Meghívókódok', ro: 'Coduri de invitație' },
    'nav.internalDrivers': { hu: 'Belső sofőrök', ro: 'Șoferi interni' },
    'nav.externalDrivers': { hu: 'Külső sofőrök', ro: 'Șoferi externi' },
    'nav.vehicles': { hu: 'Járművek', ro: 'Vehicule' },
    'nav.clients': { hu: 'Ügyfelek', ro: 'Clienți' },
    'nav.integrations': { hu: 'Integrációk', ro: 'Integrări' },
    'nav.signature': { hu: 'Aláírás és Bélyegző', ro: 'Semnătură și ștampilă' },
    'nav.grpComm': { hu: 'Kommunikáció', ro: 'Comunicare' },
    'nav.chat': { hu: 'Belső Chat', ro: 'Chat intern' },
    'nav.settings': { hu: 'Beállítások', ro: 'Setări' },
    'nav.billing': { hu: 'Számlázó', ro: 'Facturare' },

    // ── Fuvar-kiíró űrlap (orders-form) ──
    'form.newOrderTitle': { hu: 'Új fuvarfeladat kiírása', ro: 'Creare cursă nouă' },
    'form.newOrder': { hu: 'Új fuvarfeladat', ro: 'Cursă nouă' },
    'form.csvImport': { hu: '📥 CSV import — több fuvar egyszerre', ro: '📥 Import CSV — mai multe curse odată' },
    'form.csvImportHint': { hu: 'pl. gyári fuvarlista (.csv) — oszlop-párosítással', ro: 'ex. listă curse de la fabrică (.csv) — cu potrivire de coloane' },
    'form.client': { hu: 'Ügyfél / Client', ro: 'Client' },
    'form.clientHint': { hu: 'Vagy válassz a mentett ügyfelek közül (ANAF-ellenőrzött adatok, számlázáshoz).', ro: 'Sau alege dintre clienții salvați (date verificate ANAF, pentru facturare).' },
    'form.ref': { hu: 'Referencia', ro: 'Referință' },
    'form.refPh': { hu: 'opcionális', ro: 'opțional' },
    'form.price': { hu: 'Ár / Preț', ro: 'Preț' },
    'form.km': { hu: 'Távolság / Km', ro: 'Distanță / Km' },
    'form.weight': { hu: 'Súly / kg', ro: 'Greutate / kg' },
    'form.weightHint': { hu: '(részrakomány-ellenőrzéshez)', ro: '(pentru verificare grupaj)' },
    'form.loadType': { hu: 'Rakomány típusa', ro: 'Tip marfă' },
    'form.ftlHint': { hu: '(teljes áru)', ro: '(marfă completă)' },
    'form.ltlHint': { hu: '(részrakomány)', ro: '(grupaj)' },
    'form.dims': { hu: 'Méretek (cm)', ro: 'Dimensiuni (cm)' },
    'form.dimReq': { hu: '— LTL-nél kötelező', ro: '— obligatoriu la LTL' },
    'form.phLen': { hu: 'Hossz', ro: 'Lungime' },
    'form.phWid': { hu: 'Szél.', ro: 'Lățime' },
    'form.phHei': { hu: 'Mag.', ro: 'Înălțime' },
    'form.loadLoc': { hu: 'Felrakás helye', ro: 'Loc încărcare' },
    'form.loadTime': { hu: 'Felrakás ideje', ro: 'Data încărcării' },
    'form.unloadLoc': { hu: 'Lerakás helye', ro: 'Loc descărcare' },
    'form.unloadTime': { hu: 'Lerakás ideje', ro: 'Data descărcării' },
    'form.driverType': { hu: 'SOFŐR TÍPUSA', ro: 'TIP ȘOFER' },
    'form.internDriver': { hu: 'Belső sofőr', ro: 'Șofer intern' },
    'form.externDriver': { hu: 'Külső sofőr', ro: 'Șofer extern' },
    'form.noDriver': { hu: 'Sofőr nélkül', ro: 'Fără șofer' },
    'form.selectIntern': { hu: 'Belső sofőr kiválasztása', ro: 'Selectare șofer intern' },
    'form.prevExtern': { hu: 'Korábbi külső sofőr (opcionális)', ro: 'Șofer extern anterior (opțional)' },
    'form.newDriverManual': { hu: '— Új sofőr beírása kézzel —', ro: '— Introdu manual un șofer nou —' },
    'form.driverName': { hu: 'Sofőr neve', ro: 'Nume șofer' },
    'form.companyName': { hu: 'Cég neve', ro: 'Nume firmă' },
    'form.phone': { hu: 'Telefon', ro: 'Telefon' },
    'form.tractorPlate': { hu: 'Vontató rendszám', ro: 'Nr. cap tractor' },
    'form.trailerPlate': { hu: 'Pótkocsi rendszám', ro: 'Nr. remorcă' },
    'form.newShort': { hu: '+ Új', ro: '+ Nou' },
    'form.notSet': { hu: '— Nincs megadva —', ro: '— Neselectat —' },
    'form.saveOrder': { hu: 'Fuvarfeladat mentése', ro: 'Salvează cursa' },
    'form.searchName': { hu: 'Keresés névben / cégben...', ro: 'Căutare după nume / firmă...' },

    // ── Fuvar-lista (orders-list) ──
    'list.title': { hu: 'Fuvarfeladatok kezelése', ro: 'Gestionare curse' },
    'list.searchPh': { hu: '🔍 Ügyfél, sofőr, ID...', ro: '🔍 Client, șofer, ID...' },
    'list.allStatus': { hu: 'Minden státusz', ro: 'Toate statusurile' },
    'list.colId': { hu: 'ID', ro: 'ID' },
    'list.colClient': { hu: 'Ügyfél', ro: 'Client' },
    'list.colRoute': { hu: 'Útvonal', ro: 'Rută' },
    'list.colKm': { hu: 'KM', ro: 'KM' },
    'list.colPrice': { hu: 'Ár', ro: 'Preț' },
    'list.colDriver': { hu: 'Sofőr', ro: 'Șofer' },
    'list.colTractor': { hu: 'Vontató', ro: 'Cap tractor' },
    'list.colStatus': { hu: 'Státusz', ro: 'Status' },
    'list.colActions': { hu: 'Műveletek', ro: 'Acțiuni' },
    'list.selectAll': { hu: 'Mind kijelöl', ro: 'Selectează tot' },
    'list.clearSel': { hu: '✕ Törlés', ro: '✕ Șterge' },
    'list.download': { hu: '⬇️ Letöltés (nyomtatható)', ro: '⬇️ Descărcare (printabil)' },

    // ── Fuvar-szerkesztő modal (orderEditModal) ──
    'edit.title': { hu: '✏️ Fuvar szerkesztése —', ro: '✏️ Editare cursă —' },
    'edit.client': { hu: 'Ügyfél', ro: 'Client' },
    'edit.loadLoc': { hu: 'Rakodás helye', ro: 'Loc încărcare' },
    'edit.loadDate': { hu: 'Rakodás dátuma', ro: 'Data încărcării' },
    'edit.unloadDate': { hu: 'Lerakás dátuma', ro: 'Data descărcării' },
    'edit.price': { hu: 'Ár (EUR)', ro: 'Preț (EUR)' },
    'edit.km': { hu: 'Km', ro: 'Km' },
    'edit.weight': { hu: 'Súly (kg)', ro: 'Greutate (kg)' },
    'edit.toll': { hu: '🛣️ Útdíj (EUR)', ro: '🛣️ Taxă drum (EUR)' },
    'edit.tollHint': { hu: '— becsült, kézzel módosítható', ro: '— estimat, modificabil manual' },
    'edit.estimate': { hu: '🛣️ Becslés', ro: '🛣️ Estimare' },
    'edit.rates': { hu: '⚙️ Ráták', ro: '⚙️ Tarife' },
    'edit.carrier': { hu: '🚚 Alvállalkozó (Extern fuvarnál)', ro: '🚚 Subcontractor (la cursă Extern)' },
    'edit.carrierCostPh': { hu: 'Alvállalkozói díj (EUR)', ro: 'Tarif subcontractor (EUR)' },
    'edit.none': { hu: '— nincs —', ro: '— niciunul —' },
    'edit.noneDash': { hu: '— Nincs —', ro: '— Niciunul —' },
    'edit.status': { hu: 'Státusz', ro: 'Status' },
    'edit.driverVehicle': { hu: '🚛 Sofőr / Jármű', ro: '🚛 Șofer / Vehicul' },
    'edit.soferType': { hu: 'Sofőr típus', ro: 'Tip șofer' },
    'edit.externName': { hu: 'Extern sofőr neve', ro: 'Nume șofer extern' },
    'edit.externFirm': { hu: 'Extern cég', ro: 'Firmă externă' },
    'edit.choose': { hu: '— Válassz —', ro: '— Alege —' },
    'edit.legsTitle': { hu: '🔄 Jármű / Sofőr váltások', ro: '🔄 Schimbări vehicul / șofer' },
    'edit.addLeg': { hu: '+ Váltás hozzáadása', ro: '+ Adaugă schimbare' },
    'edit.save': { hu: '💾 Mentés', ro: '💾 Salvează' },

    // ── Pane-címek (admin/manager fülek) ──
    'pane.vehicles': { hu: 'Járművek kezelése', ro: 'Gestionare vehicule' },
    'pane.invites': { hu: 'Meghívókódok generálása', ro: 'Generare coduri de invitație' },
    'pane.profile': { hu: '👤 Profil adatok', ro: '👤 Date profil' },
    'pane.docSeries': { hu: '📋 Dokumentum szériák', ro: '📋 Serii documente' },
    'pane.docs': { hu: '📷 Feltöltött iratok és CMR-ek', ro: '📷 Documente încărcate și CMR-uri' },
    'pane.integrations': { hu: '🔌 Integrációk', ro: '🔌 Integrări' },
    'pane.changePw': { hu: '🔑 Jelszó módosítása', ro: '🔑 Schimbare parolă' },
    'pane.2fa': { hu: '🛡️ Kétlépéses hitelesítés (2FA)', ro: '🛡️ Autentificare în doi pași (2FA)' },
    'pane.staff': { hu: 'Munkatársak kezelése', ro: 'Gestionare angajați' },
    'pane.clients': { hu: 'Ügyfelek', ro: 'Clienți' },
    'pane.settings': { hu: 'Beállítások', ro: 'Setări' },
    'set.emailLangTitle': { hu: '✉️ Kimenő e-mailek nyelve', ro: '✉️ Limba e-mailurilor trimise' },
    'set.emailLangHint': { hu: 'A meghívó- és jelszó-e-mailek ezen a nyelven mennek ki. Alapértelmezés: román.', ro: 'E-mailurile de invitație și de resetare parolă se trimit în această limbă. Implicit: română.' },
    'set.emailLangLabel': { hu: 'E-mail nyelve', ro: 'Limba e-mailului' },
    'sofer.navBorder': { hu: 'Határátlépés', ro: 'Trecere frontieră' },
    'sofer.navWaybill': { hu: 'Menetlevél', ro: 'Foaie de parcurs' },
    'sofer.navDocs': { hu: 'Iratok / CMR', ro: 'Documente / CMR' },
    'sofer.navChat': { hu: 'Chat', ro: 'Chat' },
    'sofer.allocated': { hu: 'Kiosztott fuvarok', ro: 'Curse alocate' },
    'sofer.loadingDots': { hu: 'Betöltés...', ro: 'Se încarcă...' },
    'sofer.borderTitle': { hu: '🛂 Határátlépés', ro: '🛂 Trecere frontieră' },
    'sofer.recentCross': { hu: 'Legutóbbi átlépések', ro: 'Treceri recente' },
    'sofer.waybillTitle': { hu: '📄 Menetlevél', ro: '📄 Foaie de parcurs' },
    'sofer.pickOrders': { hu: 'Jelöld be a fuvarokat amelyeket ebbe a menetlevélbe szeretnél:', ro: 'Bifează cursele pe care vrei să le incluzi în această foaie de parcurs:' },
    'sofer.loadingOrders': { hu: 'Fuvarok betöltése...', ro: 'Se încarcă cursele...' },
    'sofer.nextFill': { hu: 'Tovább → Menetlevél kitöltése', ro: 'Continuă → Completare foaie de parcurs' },
    'sofer.fillTitle': { hu: '📄 Menetlevél kitöltése', ro: '📄 Completare foaie de parcurs' },
    'sofer.fCamion': { hu: 'Vontató rendszám', ro: 'Număr camion' },
    'sofer.fRemorca': { hu: 'Pótkocsi rendszám', ro: 'Număr remorcă' },
    'sofer.kmStart': { hu: 'Kezdő km', ro: 'Km început' },
    'sofer.kmEnd': { hu: 'Záró km', ro: 'Km sfârșit' },
    'sofer.diurna': { hu: 'Diurna (kiküldetési napok)', ro: 'Diurnă (zile delegație)' },
    'sofer.diurnaAuto': { hu: '🤖 Automatikusan számolva a rögzített határátlépésekből.', ro: '🤖 Calculat automat din trecerile de frontieră înregistrate.' },
    'sofer.addPoint': { hu: '➕ Pont hozzáadása', ro: '➕ Adaugă punct' },
    'sofer.fuelState': { hu: '🛢 Üzemanyag állapot', ro: '🛢 Stare combustibil' },
    'sofer.cantStart': { hu: 'Kezdő mennyiség (L)', ro: 'Cantitate început (L)' },
    'sofer.cantEnd': { hu: 'Záró mennyiség (L)', ro: 'Cantitate sfârșit (L)' },
    'sofer.addAlim': { hu: '➕ Tankolás hozzáadása', ro: '➕ Adaugă alimentare' },
    'sofer.addAch': { hu: '➕ Kiadás hozzáadása', ro: '➕ Adaugă cheltuială' },
    'sofer.otherNotes': { hu: 'Egyéb megjegyzések', ro: 'Alte mențiuni' },
    'sofer.otherNotesPh': { hu: 'Egyéb megjegyzések...', ro: 'Alte mențiuni...' },
    'sofer.sendWaybill': { hu: '📤 Menetlevél elküldése', ro: '📤 Trimite foaia de parcurs' },
    'sofer.docsTitle': { hu: '📷 Iratok feltöltése', ro: '📷 Încărcare documente' },
    'sofer.docPod': { hu: '✍️ POD (aláírt CMR)', ro: '✍️ POD (CMR semnat)' },
    'sofer.docInvoice': { hu: '🧾 Számla', ro: '🧾 Factură' },
    'sofer.docCustoms': { hu: '🏛 Vám', ro: '🏛 Vamă' },
    'sofer.docOther': { hu: '📎 Egyéb', ro: '📎 Altele' },
    'sofer.docOrderHint': { hu: 'Fuvar (opcionális — POD-nál ajánlott):', ro: 'Cursă (opțional — recomandat la POD):' },
    'sofer.docNoOrder': { hu: '— Nincs fuvarhoz kötve —', ro: '— Fără cursă —' },
    'sofer.tapFile': { hu: 'Koppints a fájl kiválasztásához', ro: 'Apasă pentru a alege fișierul' },
    'sofer.photoOrPdf': { hu: 'Fénykép vagy PDF', ro: 'Fotografie sau PDF' },
    'sofer.submit': { hu: '📤 Beküldés', ro: '📤 Trimite' },
    'sofer.chatConnect': { hu: 'Kapcsolódás a chathez...', ro: 'Conectare la chat...' },
    'sofer.messages': { hu: '💬 Üzenetek', ro: '💬 Mesaje' },
    'sofer.msgPh': { hu: 'Üzenet...', ro: 'Mesaj...' },

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
    'login.timeout': { hu: 'Biztonsági okból kiléptettünk inaktivitás miatt. Jelentkezz be újra.', ro: 'Din motive de securitate v-am deconectat din cauza inactivității. Autentificați-vă din nou.' },
    // ── Ügyfél-portál (/portal) ──
    'pt.subtitle': { hu: 'Ügyfélportál', ro: 'Portal client' },
    'pt.onlyYours': { hu: 'Csak a saját céged fuvarjait látod.', ro: 'Vezi doar cursele propriei firme.' },
    'pt.inviteNote': { hu: 'A hozzáférést a fuvarozód adja meghívóval.', ro: 'Accesul îl oferă transportatorul prin invitație.' },
    'pt.setPw': { hu: 'Állítsd be a jelszavad', ro: 'Setează-ți parola' },
    'pt.newPw': { hu: 'Új jelszó (min. 6 karakter)', ro: 'Parolă nouă (min. 6 caractere)' },
    'pt.pwAgain': { hu: 'Jelszó újra', ro: 'Repetă parola' },
    'pt.saveEnter': { hu: 'Mentés és belépés', ro: 'Salvează și intră' },
    'pt.newOrderReq': { hu: '＋ Új fuvar igénylése', ro: '＋ Solicită o cursă nouă' },
    'pt.reqHint': { hu: 'Az igénylést a diszpécser hagyja jóvá, és bekerül a fuvarok közé.', ro: 'Solicitarea este aprobată de dispecer și intră în lista de curse.' },
    'pt.yourOrders': { hu: '📦 A te fuvarjaid', ro: '📦 Cursele tale' },
    'pt.fromAddr': { hu: 'Felrakó címe *', ro: 'Adresă încărcare *' },
    'pt.toAddr': { hu: 'Lerakó címe *', ro: 'Adresă descărcare *' },
    'pt.weight': { hu: 'Súly (kg)', ro: 'Greutate (kg)' },
    'pt.type': { hu: 'Típus', ro: 'Tip' },
    'pt.loadDate': { hu: 'Felrakás dátuma', ro: 'Data încărcării' },
    'pt.note': { hu: 'Megjegyzés', ro: 'Mențiune' },
    'pt.sendReq': { hu: 'Igénylés elküldése →', ro: 'Trimite solicitarea →' },
    'pt.howTitle': { hu: 'ℹ️ Hogyan működik', ro: 'ℹ️ Cum funcționează' },
    'pt.howBody': { hu: 'Itt a saját fuvarjaidat látod élőben. A 🗺️ Követés gombbal megnézed, hol a kamion; a dokumentumokat (visszaigazolás, számla, aláírt CMR/POD) letöltöd. Új fuvart az ＋ Új fuvar igénylése gombbal kérhetsz.', ro: 'Aici vezi cursele tale în timp real. Cu butonul 🗺️ Urmărire vezi unde e camionul; descarci documentele (confirmare, factură, CMR/POD semnat). Soliciți o cursă nouă cu butonul ＋ Solicită o cursă nouă.' },
    // status + kártya (portal.js)
    'pt.stAvail': { hu: 'Kiosztásra vár', ro: 'Așteaptă alocare' },
    'pt.stAlloc': { hu: 'Kiosztva', ro: 'Alocată' },
    'pt.stRoad': { hu: 'Úton', ro: 'În cursă' },
    'pt.stDone': { hu: 'Teljesített', ro: 'Finalizată' },
    'pt.stParked': { hu: 'Parkolt', ro: 'Parcată' },
    'pt.stWh': { hu: 'Raktárban', ro: 'În depozit' },
    'pt.stExtern': { hu: 'Külsős', ro: 'Extern' },
    'pt.kpiActive': { hu: 'Aktív fuvar', ro: 'Curse active' },
    'pt.kpiRoad': { hu: 'Úton most', ro: 'Acum în cursă' },
    'pt.kpiTotal': { hu: 'Összes (lista)', ro: 'Total (listă)' },
    'pt.kpiUnpaid': { hu: 'Fizetésre vár', ro: 'De încasat' },
    'pt.noOrders': { hu: 'Még nincs fuvarod nálunk rögzítve.', ro: 'Nu există încă nicio cursă înregistrată.' },
    'pt.payWait': { hu: 'Fizetésre vár', ro: 'De încasat' },
    'pt.allocPending': { hu: '🚛 kiosztás alatt', ro: '🚛 în alocare' },
    'pt.loadAt': { hu: '📅 Felrakás: ', ro: '📅 Încărcare: ' },
    'pt.unloadAt': { hu: '🏁 Lerakás: ', ro: '🏁 Descărcare: ' },
    'pt.liveTrack': { hu: '🗺️ Élő követés', ro: '🗺️ Urmărire live' },
    'pt.reqSent': { hu: '✅ Igénylés elküldve a diszpécsernek!', ro: '✅ Solicitare trimisă dispecerului!' },
    'pt.fromToReq': { hu: 'A felrakó és lerakó cím kötelező.', ro: 'Adresa de încărcare și descărcare sunt obligatorii.' },
    'pt.badLogin': { hu: 'Hibás belépés', ro: 'Autentificare eșuată' },
    'pt.giveEmailPw': { hu: 'Add meg az e-mailt és jelszót.', ro: 'Introdu e-mailul și parola.' },
    'pt.pwMin': { hu: 'A jelszó legalább 6 karakter legyen.', ro: 'Parola trebuie să aibă minim 6 caractere.' },
    'pt.pwMismatch': { hu: 'A két jelszó nem egyezik.', ro: 'Cele două parole nu coincid.' },
    'pt.pwSet': { hu: 'Jelszó beállítva — üdv a portálon!', ro: 'Parolă setată — bun venit pe portal!' },
    'pt.carrier': { hu: 'Fuvarozó: ', ro: 'Transportator: ' },
    // ── Alvállalkozói portál (/carrier) ──
    'cp.subtitle': { hu: 'Alvállalkozói portál', ro: 'Portal subcontractant' },
    'cp.yourOrders': { hu: '📦 Rád osztott fuvarok', ro: '📦 Curse alocate ție' },
    'cp.myVehicles': { hu: '🚚 Járműveim', ro: '🚚 Vehiculele mele' },
    'cp.tractorPh': { hu: 'Vontató rendszám *', ro: 'Nr. cap tractor *' },
    'cp.trailerPh': { hu: 'Pótkocsi', ro: 'Remorcă' },
    'cp.brandPh': { hu: 'Márka', ro: 'Marca' },
    'cp.modelPh': { hu: 'Modell', ro: 'Model' },
    'cp.addVehicle': { hu: '＋ Jármű felvitele', ro: '＋ Adaugă vehicul' },
    'cp.vehNote': { hu: 'A felvitt járművet a diszpécser látja a kiosztásnál.', ro: 'Vehiculul adăugat este vizibil dispecerului la alocare.' },
    'cp.docUpload': { hu: '📎 Dokumentum feltöltése', ro: '📎 Încărcare document' },
    'cp.kindCmr': { hu: 'Aláírt CMR / POD', ro: 'CMR semnat / POD' },
    'cp.kindInvoice': { hu: 'Számla', ro: 'Factură' },
    'cp.kindInsurance': { hu: 'CMR-biztosítás', ro: 'Asigurare CMR' },
    'cp.kindContract': { hu: 'Szerződés', ro: 'Contract' },
    'cp.kindOther': { hu: 'Egyéb', ro: 'Altele' },
    'cp.toOrder': { hu: 'Fuvarhoz (opcionális)', ro: 'La cursă (opțional)' },
    'cp.general': { hu: '— általános —', ro: '— general —' },
    'cp.filePdf': { hu: 'Fájl (PDF/kép)', ro: 'Fișier (PDF/imagine)' },
    'cp.uploadBtn': { hu: 'Feltöltés', ro: 'Încarcă' },
    'cp.kpiActive': { hu: 'Aktív fuvar', ro: 'Curse active' },
    'cp.kpiRoad': { hu: 'Úton most', ro: 'Acum în cursă' },
    'cp.kpiPayable': { hu: 'Neked fizetendő', ro: 'De încasat ție' },
    'cp.noOrders': { hu: 'Még nincs rád osztott fuvar.', ro: 'Nu există încă nicio cursă alocată.' },
    'cp.noVehicles': { hu: 'Még nincs felvitt jármű.', ro: 'Nu există încă niciun vehicul adăugat.' },
    'cp.noDocs': { hu: 'Nincs dokumentum még.', ro: 'Niciun document încă.' },
    'cp.fee': { hu: 'Díj: ', ro: 'Tarif: ' },
    'cp.myUploads': { hu: 'Feltöltéseim:', ro: 'Încărcările mele:' },
    'cp.pwMin6': { hu: 'Min. 6 karakter.', ro: 'Min. 6 caractere.' },
    'cp.pwSet': { hu: 'Jelszó beállítva!', ro: 'Parolă setată!' },
    'cp.tractorReq': { hu: 'A vontató rendszáma kötelező.', ro: 'Nr. de înmatriculare al capului tractor este obligatoriu.' },
    'cp.vehAdded': { hu: '🚚 Jármű felvéve', ro: '🚚 Vehicul adăugat' },
    'cp.deleted': { hu: 'Törölve', ro: 'Șters' },
    'cp.chooseFile': { hu: 'Válassz fájlt.', ro: 'Alege un fișier.' },
    'cp.fileTooBig': { hu: 'A fájl túl nagy (max 10 MB).', ro: 'Fișierul este prea mare (max 10 MB).' },
    'cp.uploaded': { hu: '📎 Feltöltve', ro: '📎 Încărcat' },
  };

  function getLang() {
    try { var l = localStorage.getItem('vs-lang'); if (l === 'hu' || l === 'ro') return l; } catch (e) {}
    // Alapértelmezés MINDENHOL: román. (Csak akkor más, ha a felhasználó kézzel HU-ra vált.)
    return 'ro';
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