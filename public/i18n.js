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

    // ── Vezérlőpult (dashboard) ──
    'dash.subtitle': { hu: 'Cég dashboard', ro: 'Panou firmă' },
    'dash.kpiTotal': { hu: 'Összes fuvar', ro: 'Total curse' },
    'dash.kpiActive': { hu: 'Aktív fuvar', ro: 'Curse active' },
    'dash.kpiUsers': { hu: 'Felhasználók', ro: 'Utilizatori' },
    'dash.kpiWaybills': { hu: 'Beérkezett menetlevelek', ro: 'Foi de parcurs primite' },
    'dash.recentOrders': { hu: 'Legutóbbi fuvarok', ro: 'Curse recente' },
    'dash.allOrders': { hu: 'Összes fuvar →', ro: 'Toate cursele →' },
    'dash.colOrder': { hu: 'Fuvar', ro: 'Cursă' },
    'dash.colDest': { hu: 'Úticél', ro: 'Destinație' },
    'dash.colDriver': { hu: 'Sofőr', ro: 'Șofer' },
    'dash.colStatus': { hu: 'Státusz', ro: 'Status' },
    'dash.colDate': { hu: 'Dátum', ro: 'Data' },
    'dash.loading': { hu: 'Betöltés...', ro: 'Se încarcă...' },
    'dash.loadFail': { hu: 'Nem sikerült betölteni.', ro: 'Încărcarea a eșuat.' },
    'dash.noOrders': { hu: 'Nincs fuvar.', ro: 'Nicio cursă.' },
    'dash.vehStatus': { hu: 'Jármű státusz', ro: 'Status vehicule' },
    'dash.vehActive': { hu: 'Aktív járművek', ro: 'Vehicule active' },
    'dash.vehIdle': { hu: 'Álló járművek', ro: 'Vehicule oprite' },
    'dash.vehUnknown': { hu: 'Ismeretlen', ro: 'Necunoscut' },
    'dash.noGpsData': { hu: 'Nincs aktív GPS adat', ro: 'Nu există date GPS active' },
    'dash.noGpsSetup': { hu: 'GPS integráció nincs beállítva', ro: 'Integrarea GPS nu este configurată' },
    'dash.speed': { hu: 'Sebesség', ro: 'Viteză' },
    // Fuvar-státuszok (DB román → felirat)
    'status.Finalizat': { hu: 'Teljesítve', ro: 'Finalizat' },
    'status.InCurs': { hu: 'Folyamatban', ro: 'În curs' },
    'status.Alocat': { hu: 'Várakozik', ro: 'Alocat' },
    'status.Disponibil': { hu: 'Tervezetlen', ro: 'Disponibil' },
    'status.Extern': { hu: 'Külső', ro: 'Extern' },
    'status.Anulat': { hu: 'Törölve', ro: 'Anulat' },

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
