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
    'common.deleted': { hu: 'Törölve', ro: 'Șters' },
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

    // ── Közös tábla-fejlécek / mezők ──
    'col.name': { hu: 'Név', ro: 'Nume' },
    'col.phone': { hu: 'Telefon', ro: 'Telefon' },
    'col.position': { hu: 'Pozíció', ro: 'Poziție' },
    'col.action': { hu: 'Művelet', ro: 'Acțiune' },
    'col.actions': { hu: 'Műveletek', ro: 'Acțiuni' },
    'col.note': { hu: 'Megjegyzés', ro: 'Mențiune' },
    'col.status': { hu: 'Státusz', ro: 'Status' },
    'col.plate': { hu: 'Rendszám', ro: 'Nr. înmatriculare' },
    'col.brand': { hu: 'Márka', ro: 'Marcă' },
    'col.model': { hu: 'Model', ro: 'Model' },
    'col.year': { hu: 'Év', ro: 'An' },
    'col.code': { hu: 'Kód', ro: 'Cod' },
    'fld.optional': { hu: '(opcionális)', ro: '(opțional)' },
    'fld.note': { hu: 'Megjegyzés', ro: 'Mențiune' },
    'fld.notePh': { hu: 'opcionális', ro: 'opțional' },

    // ── Munkatársak (users) ──
    'users.title': { hu: 'Munkatársak kezelése', ro: 'Gestionare angajați' },

    // ── Meghívók (invites) ──
    'inv.position': { hu: 'Pozíció', ro: 'Poziție' },
    'inv.email': { hu: 'E-mail', ro: 'E-mail' },
    'inv.name': { hu: 'Név', ro: 'Nume' },
    'inv.phone': { hu: 'Telefon', ro: 'Telefon' },
    'inv.generate': { hu: '+ Kód generálása', ro: '+ Generează cod' },

    // ── Belső sofőrök ──
    'intern.sub': { hu: 'Sofőr pozíciójú regisztrált felhasználók', ro: 'Utilizatori înregistrați cu rol de șofer' },

    // ── Külső sofőrök ──
    'extern.sub': { hu: 'Cégen kívüli sofőrök és cégek címjegyzéke', ro: 'Agendă șoferi și firme externe' },
    'extern.addTitle': { hu: 'Új külső sofőr / cég hozzáadása', ro: 'Adăugare șofer / firmă externă' },
    'extern.tractorPlate': { hu: 'Vontató rendszám', ro: 'Nr. cap tractor' },
    'extern.trailerPlate': { hu: 'Pótkocsi rendszám', ro: 'Nr. remorcă' },
    'extern.addBtn': { hu: '+ Sofőr hozzáadása', ro: '+ Adaugă șofer' },
    'extern.colTractor': { hu: 'Vontató', ro: 'Cap tractor' },
    'extern.colTrailer': { hu: 'Pótkocsi', ro: 'Remorcă' },

    // ── Járművek ──
    'veh.sub': { hu: 'Vontatók és pótkocsik nyilvántartása', ro: 'Evidența capetelor tractoare și remorcilor' },
    'veh.tractors': { hu: 'Vontatók', ro: 'Capete tractoare' },
    'veh.trailers': { hu: 'Pótkocsik', ro: 'Remorci' },
    'veh.plateReq': { hu: 'Rendszám *', ro: 'Nr. înmatriculare *' },
    'veh.addTractor': { hu: '+ Vontató hozzáadása', ro: '+ Adaugă cap tractor' },
    'veh.addTrailer': { hu: '+ Pótkocsi hozzáadása', ro: '+ Adaugă remorcă' },
    'veh.kind': { hu: 'Típus (rakfelület)', ro: 'Tip (suprafață încărcare)' },
    'veh.kindStandard': { hu: 'Standard (260 cm)', ro: 'Standard (260 cm)' },
    'veh.kindMega': { hu: 'Mega (305 cm)', ro: 'Mega (305 cm)' },
    'veh.cargoLen': { hu: 'Rakfelület hossz (cm)', ro: 'Lungime utilă (cm)' },
    'veh.cargoWid': { hu: 'Rakfelület szélesség (cm)', ro: 'Lățime utilă (cm)' },
    'veh.cargoHei': { hu: 'Rakfelület magasság (cm)', ro: 'Înălțime utilă (cm)' },

    // ── Aláírás / bélyegző ──
    'sig.drawTitle': { hu: 'Digitális Aláírás Rajzolása', ro: 'Desenare semnătură digitală' },
    'sig.clear': { hu: 'Törlés', ro: 'Șterge' },
    'sig.save': { hu: 'Mentés', ro: 'Salvează' },
    'sig.stampTitle': { hu: 'Bélyegző feltöltése (PNG)', ro: 'Încărcare ștampilă (PNG)' },
    'sig.stampSave': { hu: 'Bélyegző mentése', ro: 'Salvează ștampila' },
    'sig.previewTitle': { hu: 'Aktuális bélyegző előnézete', ro: 'Previzualizare ștampilă curentă' },
    'sig.notSaved': { hu: 'Nincs mentve.', ro: 'Nesalvat.' },

    // ── Chat ──
    'chat.connecting': { hu: 'Firebase kapcsolódás...', ro: 'Conectare Firebase...' },
    'chat.chats': { hu: 'Csevegések', ro: 'Conversații' },
    'chat.newChat': { hu: 'Új chat indítása', ro: 'Începe o conversație nouă' },
    'chat.loading': { hu: 'Betöltés...', ro: 'Se încarcă...' },
    'chat.pickChat': { hu: 'Válassz csevegést', ro: 'Alege o conversație' },
    'chat.pickFromList': { hu: '← Válassz egy csevegést a listából', ro: '← Alege o conversație din listă' },
    'chat.msgPh': { hu: 'Üzenet írása...', ro: 'Scrie un mesaj...' },
    'chat.pickUser': { hu: 'Felhasználó kiválasztása', ro: 'Selectare utilizator' },
    'chat.start': { hu: 'Chat indítása', ro: 'Începe conversația' },

    // ── Flotta-modulok közös ──
    'fe.loading': { hu: 'Betöltés...', ro: 'Se încarcă...' },
    'fe.calcing': { hu: 'Számítás...', ro: 'Se calculează...' },
    'fe.errMigrate': { hu: 'Hiba — futtasd a phase3 migrációt!', ro: 'Eroare — rulează migrarea phase3!' },
    'fe.add': { hu: '+ Hozzáadás', ro: '+ Adaugă' },
    'fe.choose': { hu: '— Válassz —', ro: '— Alege —' },
    'fe.print': { hu: '🖨️ Nyomtatás', ro: '🖨️ Tipărire' },

    // Lejáratok — dokumentum-típusok
    'fe.doc.itp': { hu: 'ITP (műszaki)', ro: 'ITP (tehnică)' },
    'fe.doc.rca': { hu: 'RCA (kötelező bizt.)', ro: 'RCA (asig. obligatorie)' },
    'fe.doc.casco': { hu: 'CASCO', ro: 'CASCO' },
    'fe.doc.rovinieta': { hu: 'Rovinietă', ro: 'Rovinietă' },
    'fe.doc.cmrIns': { hu: 'CMR-biztosítás', ro: 'Asigurare CMR' },
    'fe.doc.tahoCalib': { hu: 'Tahográf-hitelesítés', ro: 'Verificare tahograf' },
    'fe.doc.tahoCard': { hu: 'Tahográf-kártya', ro: 'Card tahograf' },
    'fe.doc.tahoDl': { hu: 'Tahográf-letöltés (28 nap)', ro: 'Descărcare tahograf (28 zile)' },
    'fe.doc.adr': { hu: 'ADR-engedély', ro: 'Autorizație ADR' },
    'fe.doc.community': { hu: 'Közösségi engedély', ro: 'Licență comunitară' },
    'fe.doc.license': { hu: 'Jogosítvány', ro: 'Permis de conducere' },
    'fe.doc.atestat': { hu: 'Atestat (szakmai)', ro: 'Atestat (profesional)' },
    'fe.doc.medical': { hu: 'Orvosi/pszichológiai', ro: 'Medical/psihologic' },
    'fe.doc.other': { hu: 'Egyéb', ro: 'Altele' },

    // Lejáratok — űrlap/lista
    'fe.exp.entity': { hu: 'Mire vonatkozik', ro: 'La ce se referă' },
    'fe.exp.vehicle': { hu: '🚛 Jármű', ro: '🚛 Vehicul' },
    'fe.exp.driver': { hu: '👤 Sofőr', ro: '👤 Șofer' },
    'fe.exp.company': { hu: '🏢 Cég', ro: '🏢 Firmă' },
    'fe.exp.vehOrDrv': { hu: 'Jármű / Sofőr', ro: 'Vehicul / Șofer' },
    'fe.exp.document': { hu: 'Dokumentum', ro: 'Document' },
    'fe.exp.expiryDate': { hu: 'Lejárat dátuma', ro: 'Data expirării' },
    'fe.exp.alertDays': { hu: 'Riasztás (nappal előtte)', ro: 'Alertă (zile înainte)' },
    'fe.exp.expired': { hu: 'LEJÁRT ({n} napja)', ro: 'EXPIRAT (acum {n} zile)' },
    'fe.exp.inDays': { hu: '{n} nap múlva', ro: 'peste {n} zile' },
    'fe.exp.companyLevel': { hu: '— Cég-szintű —', ro: '— La nivel de firmă —' },
    'fe.exp.noItems': { hu: 'Nincs még rögzített lejárat. Add fel az első dokumentumot fent! 👆', ro: 'Nicio expirare înregistrată. Adaugă primul document sus! 👆' },
    'fe.exp.newTitle': { hu: '➕ Új lejárat rögzítése', ro: '➕ Înregistrare expirare nouă' },
    'fe.exp.listTitle': { hu: '⏰ Nyilvántartott lejáratok', ro: '⏰ Expirări înregistrate' },
    'fe.exp.listHint': { hu: 'A rendszer naponta ellenőrzi, és a riasztási ablakban <b>push-értesítést</b> küld az Admin/Manager felhasználóknak (hetente ismételve a lejáratig).', ro: 'Sistemul verifică zilnic și trimite <b>notificare push</b> utilizatorilor Admin/Manager în fereastra de alertă (repetat săptămânal până la expirare).' },
    'fe.exp.colState': { hu: 'Állapot', ro: 'Stare' },
    'fe.exp.giveDate': { hu: 'Add meg a lejárati dátumot!', ro: 'Introdu data expirării!' },
    'fe.exp.updated': { hu: '✅ Frissítve', ro: '✅ Actualizat' },
    'fe.exp.saved': { hu: '✅ Lejárat rögzítve', ro: '✅ Expirare înregistrată' },
    'fe.exp.editToast': { hu: 'Szerkesztés — a fenti űrlapban módosíts, majd „+ Hozzáadás”', ro: 'Editare — modifică în formularul de sus, apoi „+ Adaugă”' },
    'fe.exp.delConfirm': { hu: 'Törlöd ezt a lejárat-tételt?', ro: 'Ștergi această expirare?' },

    // Szerviz
    'fe.sv.cat.oil': { hu: '🛢 Olajcsere', ro: '🛢 Schimb ulei' },
    'fe.sv.cat.tire': { hu: '🛞 Gumi', ro: '🛞 Anvelope' },
    'fe.sv.cat.repair': { hu: '🔧 Javítás', ro: '🔧 Reparație' },
    'fe.sv.cat.maint': { hu: '⚙️ Karbantartás', ro: '⚙️ Întreținere' },
    'fe.sv.cat.other': { hu: '📎 Egyéb', ro: '📎 Altele' },
    'fe.sv.vehicleReq': { hu: 'Jármű *', ro: 'Vehicul *' },
    'fe.sv.date': { hu: 'Dátum', ro: 'Data' },
    'fe.sv.km': { hu: 'Km-állás', ro: 'Km bord' },
    'fe.sv.type': { hu: 'Típus', ro: 'Tip' },
    'fe.sv.cost': { hu: 'Költség (RON)', ro: 'Cost (RON)' },
    'fe.sv.desc': { hu: 'Leírás', ro: 'Descriere' },
    'fe.sv.nextDate': { hu: 'Köv. esedékes (dátum)', ro: 'Următoarea scadență (dată)' },
    'fe.sv.nextKm': { hu: 'Köv. esedékes (km)', ro: 'Următoarea scadență (km)' },
    'fe.sv.addBtn': { hu: '+ Rögzítés', ro: '+ Înregistrare' },
    'fe.sv.noItems': { hu: 'Nincs még szerviz-bejegyzés.', ro: 'Nicio înregistrare de service.' },
    'fe.sv.newTitle': { hu: '➕ Szerviz-esemény rögzítése', ro: '➕ Înregistrare eveniment service' },
    'fe.sv.logTitle': { hu: '🔧 Szerviz-napló', ro: '🔧 Jurnal service' },
    'fe.sv.logHint': { hu: 'A költségek beépülnek a <b>Statisztika → Jármű kihasználtság</b> riportba (Szerviz oszlop + Eredmény). A „köv. esedékes” km-et az élő GPS km-órával tudod összevetni a jármű-statisztikán.', ro: 'Costurile intră în raportul <b>Statistici → Utilizare vehicule</b> (coloana Service + Rezultat). Km-ul „următoarea scadență” poate fi comparat cu kilometrajul GPS live în statistica vehiculului.' },
    'fe.sv.colKm': { hu: 'Km', ro: 'Km' },
    'fe.sv.colNext': { hu: 'Köv. esedékes', ro: 'Următoarea scadență' },
    'fe.sv.pickVehicle': { hu: 'Válassz járművet!', ro: 'Alege un vehicul!' },
    'fe.sv.saved': { hu: '✅ Szerviz rögzítve', ro: '✅ Service înregistrat' },
    'fe.sv.delConfirm': { hu: 'Törlöd ezt a szerviz-bejegyzést?', ro: 'Ștergi această înregistrare de service?' },

    // Decont
    'fe.dc.title': { hu: '💶 Sofőr-elszámolás (decont)', ro: '💶 Decont șofer' },
    'fe.dc.driverReq': { hu: 'Sofőr *', ro: 'Șofer *' },
    'fe.dc.periodFrom': { hu: 'Időszak kezdete', ro: 'Început perioadă' },
    'fe.dc.periodTo': { hu: 'Időszak vége', ro: 'Sfârșit perioadă' },
    'fe.dc.calc': { hu: '📊 Elszámolás', ro: '📊 Decont' },
    'fe.dc.advTitle': { hu: '➕ Előleg kiadása', ro: '➕ Acordare avans' },
    'fe.dc.amountReq': { hu: 'Összeg (RON) *', ro: 'Sumă (RON) *' },
    'fe.dc.date': { hu: 'Dátum', ro: 'Data' },
    'fe.dc.advNotePh': { hu: 'pl. kassza-feltöltés', ro: 'ex. alimentare casă' },
    'fe.dc.advSaveBtn': { hu: '💵 Kiadás rögzítése', ro: '💵 Înregistrare plată' },
    'fe.dc.pickDriver': { hu: 'Válassz sofőrt!', ro: 'Alege un șofer!' },
    'fe.dc.advGiven': { hu: 'Kiadott előleg ({n} db)', ro: 'Avans acordat ({n} buc)' },
    'fe.dc.cashSpend': { hu: 'Készpénzes költés (menetlevelek)', ro: 'Cheltuieli numerar (foi de parcurs)' },
    'fe.dc.balance': { hu: 'Kassza-egyenleg ({s})', ro: 'Sold casă ({s})' },
    'fe.dc.toCompany': { hu: 'visszajár a cégnek', ro: 'se returnează firmei' },
    'fe.dc.toDriver': { hu: 'a sofőrnek jár', ro: 'i se cuvine șoferului' },
    'fe.dc.diurnaEnt': { hu: 'Diurna-járandóság ({e} külső + {i} belső nap)', ro: 'Drept diurnă ({e} zile externe + {i} interne)' },
    'fe.dc.ratesLabel': { hu: '⚙️ Diurna napidíj-ráták (RON/nap):', ro: '⚙️ Tarife diurnă (RON/zi):' },
    'fe.dc.extPh': { hu: 'külső', ro: 'extern' },
    'fe.dc.intPh': { hu: 'belső', ro: 'intern' },
    'fe.dc.ratesHint': { hu: 'Beállítás után a diurna-járandóság automatikusan számolódik.', ro: 'După setare, dreptul de diurnă se calculează automat.' },
    'fe.dc.noSpend': { hu: 'Nincs költés az időszakban.', ro: 'Nicio cheltuială în perioadă.' },
    'fe.dc.noAdv': { hu: 'Nincs előleg az időszakban.', ro: 'Niciun avans în perioadă.' },
    'fe.dc.period': { hu: 'Az időszakban: {km} km · {db} menetlevél', ro: 'În perioadă: {km} km · {db} foi de parcurs' },
    'fe.dc.spendByMethod': { hu: '🛒 Költések fizetési mód szerint (RON)', ro: '🛒 Cheltuieli după modalitate de plată (RON)' },
    'fe.dc.colMethod': { hu: 'Mód', ro: 'Mod' },
    'fe.dc.colItem': { hu: 'Tétel', ro: 'Articol' },
    'fe.dc.colSum': { hu: 'Összeg', ro: 'Sumă' },
    'fe.dc.advances': { hu: '💵 Kiadott előlegek', ro: '💵 Avansuri acordate' },
    'fe.dc.colSumRon': { hu: 'Összeg (RON)', ro: 'Sumă (RON)' },
    'fe.dc.colGiver': { hu: 'Kiadta', ro: 'Acordat de' },
    'fe.dc.ratesSaved': { hu: '✅ Ráták mentve', ro: '✅ Tarife salvate' },
    'fe.dc.advSaved': { hu: '💵 Előleg rögzítve', ro: '💵 Avans înregistrat' },
    'fe.dc.advDelConfirm': { hu: 'Törlöd ezt az előleget?', ro: 'Ștergi acest avans?' },
    'fe.dc.settleSuffix': { hu: 'elszámolás', ro: 'decont' },

    // Üzemanyagkártya
    'fe.fc.title': { hu: '⛽ Üzemanyagkártya-kivonat importálása (OMV / MOL / DKV / Eurowag / egyéb CSV)', ro: '⛽ Import extras card carburant (OMV / MOL / DKV / Eurowag / alt CSV)' },
    'fe.fc.hint': { hu: 'Töltsd fel a kártya-szolgáltató CSV-kivonatát, párosítsd az oszlopokat, és importálj. A kétszeri import nem duplikál (tranzakció-azonosítás). Az összevetés megmutatja, hol tér el a kártyás tankolás a sofőr által beírttól.', ro: 'Încarcă extrasul CSV al furnizorului de card, potrivește coloanele și importă. Importul repetat nu duplică (identificare tranzacție). Comparația arată unde diferă alimentarea pe card de cea introdusă de șofer.' },
    'fe.fc.source': { hu: 'Forrás', ro: 'Sursă' },
    'fe.fc.other': { hu: 'Egyéb', ro: 'Altele' },
    'fe.fc.csvFile': { hu: 'CSV fájl', ro: 'Fișier CSV' },
    'fe.fc.csvEmpty': { hu: 'A CSV üres vagy csak fejléc.', ro: 'CSV-ul este gol sau doar antet.' },
    'fe.fc.compareTitle': { hu: '⚖️ Kártya vs. sofőr-tankolás (e hónap, liter)', ro: '⚖️ Card vs. alimentare șofer (luna curentă, litri)' },
    'fe.fc.colCardL': { hu: 'Kártya (L)', ro: 'Card (L)' },
    'fe.fc.colDrvL': { hu: 'Sofőr beírta (L)', ro: 'Introdus de șofer (L)' },
    'fe.fc.colDiffL': { hu: 'Eltérés (L)', ro: 'Diferență (L)' },
    'fe.fc.colCardRon': { hu: 'Kártya-költség (RON)', ro: 'Cost card (RON)' },
    'fe.fc.compareHint': { hu: '🔴 = 10%-nál nagyobb eltérés — érdemes ellenőrizni (elírás vagy hiányzó menetlevél).', ro: '🔴 = diferență mai mare de 10% — merită verificat (greșeală sau foaie lipsă).' },
    'fe.fc.noTx': { hu: 'Még nincs importált tranzakció ebben a hónapban.', ro: 'Încă nicio tranzacție importată în această lună.' },
    'fe.fc.listTitle': { hu: '🧾 Importált kártya-tranzakciók (e hónap: {db} db · {l} L · {ron} RON)', ro: '🧾 Tranzacții card importate (luna curentă: {db} buc · {l} L · {ron} RON)' },
    'fe.fc.colProduct': { hu: 'Termék', ro: 'Produs' },
    'fe.fc.colLiter': { hu: 'Liter', ro: 'Litri' },
    'fe.fc.mapTitle': { hu: 'Oszlop-párosítás ({n} sor)', ro: 'Potrivire coloane ({n} rânduri)' },
    'fe.fc.colDateReq': { hu: 'Dátum *', ro: 'Data *' },
    'fe.fc.colPlateReq': { hu: 'Rendszám *', ro: 'Nr. înmatriculare *' },
    'fe.fc.colQtyReq': { hu: 'Liter *', ro: 'Litri *' },
    'fe.fc.colAmountReq': { hu: 'Összeg (RON) *', ro: 'Sumă (RON) *' },
    'fe.fc.import': { hu: '📥 Import', ro: '📥 Import' },
    'fe.fc.preview': { hu: 'Előnézet: ', ro: 'Previzualizare: ' },
    'fe.fc.mapReq': { hu: 'Párosítsd a kötelező (*) oszlopokat!', ro: 'Potrivește coloanele obligatorii (*)!' },
    'fe.fc.noValid': { hu: 'Egy érvényes sor sem állt össze — ellenőrizd a párosítást!', ro: 'Niciun rând valid — verifică potrivirea!' },
    'fe.fc.importDone': { hu: '📥 Import kész: {ins} új, {skip} kihagyva (duplikált/hibás)', ro: '📥 Import gata: {ins} noi, {skip} omise (duplicate/eronate)' },

    // Vezérlőpult lejárat-riasztás
    'fe.dash.expired': { hu: 'LEJÁRT', ro: 'EXPIRAT' },
    'fe.dash.days': { hu: '{n} nap', ro: '{n} zile' },
    'fe.dash.docsExpiring': { hu: '{n} lejáró dokumentum', ro: '{n} documente care expiră' },
    'fe.dash.expiredCount': { hu: ' ({n} LEJÁRT!)', ro: ' ({n} EXPIRATE!)' },
    'fe.dash.toExpiries': { hu: '→ Lejáratok', ro: '→ Expirări' },

    // ── Tervezőtábla (planner) ──
    'pl.today': { hu: 'Ma', ro: 'Azi' },
    'pl.week1': { hu: '1 hét', ro: '1 săpt.' },
    'pl.week2': { hu: '2 hét', ro: '2 săpt.' },
    'pl.week4': { hu: '4 hét', ro: '4 săpt.' },
    'pl.dense': { hu: '🗜 Sűrű', ro: '🗜 Compact' },
    'pl.comfy': { hu: '🔍 Kényelmes', ro: '🔍 Confortabil' },
    'pl.densityTitle': { hu: 'Sűrű / kényelmes nézet', ro: 'Vedere compactă / confortabilă' },
    'pl.searchPh': { hu: '🔍 Ügyfél, ID, város...', ro: '🔍 Client, ID, oraș...' },
    'pl.status': { hu: 'Státusz', ro: 'Status' },
    'pl.driver': { hu: 'Sofőr', ro: 'Șofer' },
    'pl.onlyBusy': { hu: 'csak fuvaros', ro: 'doar cu curse' },
    'pl.poolTitle': { hu: '📥 Kiosztásra vár', ro: '📥 Așteaptă alocare' },
    'pl.poolHint': { hu: '— koppints rá, majd válassz járművet/napot (gépen húzható is)', ro: '— apasă, apoi alege vehicul/zi (pe PC se poate trage)' },
    'pl.poolEmpty': { hu: 'Minden fuvar ki van osztva. ✅', ro: 'Toate cursele sunt alocate. ✅' },
    'pl.radarTitle': { hu: '💡 Visszfuvar-radar', ro: '💡 Radar curse retur' },
    'pl.radarSub': { hu: '— kiosztatlan fuvarok a legközelebb végző kamionokkal párosítva (üresjárat-minimalizálás)', ro: '— curse nealocate asociate cu camioanele care termină cel mai aproape (minimizare mers în gol)' },
    'pl.emptyKm': { hu: 'km üresjárat', ro: 'km mers în gol' },
    'pl.cargoOnTrailer': { hu: '🅿️ áru a pótkocsin:', ro: '🅿️ marfă pe remorcă:' },
    'pl.inWarehouse': { hu: '📦 raktárban:', ro: '📦 în depozit:' },
    'pl.noDriver': { hu: '⚠️ nincs sofőr', ro: '⚠️ fără șofer' },
    'pl.noVehicle': { hu: 'nincs jármű', ro: 'fără vehicul' },
    'pl.loadAt': { hu: 'Felrakás', ro: 'Încărcare' },
    'pl.unloadAt': { hu: 'Lerakás', ro: 'Descărcare' },
    'pl.assign': { hu: '🔄 Kiosztás', ro: '🔄 Alocare' },
    'pl.reassign': { hu: '🔄 Áthelyezés', ro: '🔄 Realocare' },
    'pl.edit': { hu: '✏️ Szerkesztés', ro: '✏️ Editare' },
    'pl.unassign': { hu: '✕ Kiosztás törlése', ro: '✕ Anulare alocare' },
    'pl.assignDo': { hu: '✓ Kioszt', ro: '✓ Alocă' },
    'pl.vehicleCol': { hu: 'JÁRMŰ', ro: 'VEHICUL' },
    'pl.utilization': { hu: 'KIHASZNÁLTSÁG', ro: 'GRAD UTILIZARE' },
    'pl.abMobile': { hu: 'koppints a cél-jármű kártyájára (a kiválasztott napra kerül)', ro: 'apasă pe cardul vehiculului țintă (se pune pe ziua aleasă)' },
    'pl.abDesktop': { hu: 'koppints/ejtsd egy jármű napjára', ro: 'apasă/trage pe ziua unui vehicul' },
    'pl.abPoolNote': { hu: ', vagy a „Kiosztásra vár” sávra a törléshez', ro: ', sau pe bara „Așteaptă alocare” pentru anulare' },
    'pl.cancel': { hu: '✕ Mégse', ro: '✕ Anulează' },

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
