// ============================================================
//  VallorSoft — fleet-extra.js  (FLOTTA & MEGFELELÉS modulok)
//  1) Lejáratok & riasztások (expiries) — ITP/RCA/rovinietă/tahográf...
//  2) Szerviz & karbantartás (service-log)
//  3) Sofőr-elszámolás / decont (decont)
//  Admin + Manager konzol közös füljei. Betöltés: console-shared.js UTÁN.
// ============================================================

(window.registerI18n || function (d) { (window.__i18nQueue = window.__i18nQueue || []).push(d); })({
  'fl.loading': { hu: 'Betöltés...', ro: 'Se încarcă...' },
  'fl.calculating': { hu: 'Számítás...', ro: 'Se calculează...' },
  'fl.err': { hu: 'Hiba', ro: 'Eroare' },
  'fl.errMigr': { hu: 'Hiba — futtasd a phase3 migrációt!', ro: 'Eroare — rulează migrarea phase3!' },
  'fl.deleted': { hu: 'Törölve', ro: 'Șters' },
  // Dokumentum-típusok (lejáratok)
  'fl.doc.itp': { hu: 'ITP (műszaki)', ro: 'ITP (tehnică)' },
  'fl.doc.rca': { hu: 'RCA (kötelező bizt.)', ro: 'RCA (asig. obligatorie)' },
  'fl.doc.casco': { hu: 'CASCO', ro: 'CASCO' },
  'fl.doc.rovinieta': { hu: 'Rovinietă', ro: 'Rovinietă' },
  'fl.doc.cmr': { hu: 'CMR-biztosítás', ro: 'Asigurare CMR' },
  'fl.doc.tahoVerif': { hu: 'Tahográf-hitelesítés', ro: 'Verificare tahograf' },
  'fl.doc.tahoCard': { hu: 'Tahográf-kártya', ro: 'Card tahograf' },
  'fl.doc.tahoDl': { hu: 'Tahográf-letöltés (28 nap)', ro: 'Descărcare tahograf (28 zile)' },
  'fl.doc.adr': { hu: 'ADR-engedély', ro: 'Autorizație ADR' },
  'fl.doc.comm': { hu: 'Közösségi engedély', ro: 'Licență comunitară' },
  'fl.doc.license': { hu: 'Jogosítvány', ro: 'Permis de conducere' },
  'fl.doc.atestat': { hu: 'Atestat (szakmai)', ro: 'Atestat (profesional)' },
  'fl.doc.medical': { hu: 'Orvosi/pszichológiai', ro: 'Medical/psihologic' },
  'fl.doc.other': { hu: 'Egyéb', ro: 'Altele' },
  // Lejáratok — űrlap
  'fl.exp.addTitle': { hu: '➕ Új lejárat rögzítése', ro: '➕ Înregistrare expirare nouă' },
  'fl.exp.entity': { hu: 'Mire vonatkozik', ro: 'La ce se referă' },
  'fl.exp.entVehicle': { hu: '🚛 Jármű', ro: '🚛 Vehicul' },
  'fl.exp.entDriver': { hu: '👤 Sofőr', ro: '👤 Șofer' },
  'fl.exp.entCompany': { hu: '🏢 Cég', ro: '🏢 Firmă' },
  'fl.exp.vehOrDrv': { hu: 'Jármű / Sofőr', ro: 'Vehicul / Șofer' },
  'fl.exp.companyLevel': { hu: '— Cég-szintű —', ro: '— La nivel de firmă —' },
  'fl.exp.document': { hu: 'Dokumentum', ro: 'Document' },
  'fl.exp.expiryDate': { hu: 'Lejárat dátuma', ro: 'Data expirării' },
  'fl.exp.alertDays': { hu: 'Riasztás (nappal előtte)', ro: 'Alertă (zile înainte)' },
  'fl.exp.note': { hu: 'Megjegyzés', ro: 'Observație' },
  'fl.exp.optional': { hu: 'opcionális', ro: 'opțional' },
  'fl.exp.add': { hu: '+ Hozzáadás', ro: '+ Adăugare' },
  // Lejáratok — lista
  'fl.exp.listTitle': { hu: '⏰ Nyilvántartott lejáratok', ro: '⏰ Expirări înregistrate' },
  'fl.exp.listHint': { hu: 'A rendszer naponta ellenőrzi, és a riasztási ablakban <b>push-értesítést</b> küld az Admin/Manager felhasználóknak (hetente ismételve a lejáratig).', ro: 'Sistemul verifică zilnic și în fereastra de alertă trimite <b>notificare push</b> utilizatorilor Admin/Manager (repetat săptămânal până la expirare).' },
  'fl.exp.colEntity': { hu: 'Jármű / Sofőr', ro: 'Vehicul / Șofer' },
  'fl.exp.colDoc': { hu: 'Dokumentum', ro: 'Document' },
  'fl.exp.colExpiry': { hu: 'Lejárat', ro: 'Expirare' },
  'fl.exp.colStatus': { hu: 'Állapot', ro: 'Stare' },
  'fl.exp.colNote': { hu: 'Megjegyzés', ro: 'Observație' },
  'fl.exp.empty': { hu: 'Nincs még rögzített lejárat. Add fel az első dokumentumot fent! 👆', ro: 'Nu există încă expirări înregistrate. Adaugă primul document mai sus! 👆' },
  'fl.exp.badgeExpired': { hu: 'LEJÁRT ({n} napja)', ro: 'EXPIRAT (acum {n} zile)' },
  'fl.exp.badgeDays': { hu: '{n} nap múlva', ro: 'peste {n} zile' },
  'fl.exp.needDate': { hu: 'Add meg a lejárati dátumot!', ro: 'Introdu data expirării!' },
  'fl.exp.updated': { hu: '✅ Frissítve', ro: '✅ Actualizat' },
  'fl.exp.saved': { hu: '✅ Lejárat rögzítve', ro: '✅ Expirare înregistrată' },
  'fl.exp.editHint': { hu: 'Szerkesztés — a fenti űrlapban módosíts, majd „+ Hozzáadás”', ro: 'Editare — modifică în formularul de mai sus, apoi „+ Adăugare”' },
  'fl.exp.confirmDel': { hu: 'Törlöd ezt a lejárat-tételt?', ro: 'Ștergi această expirare?' },
  // Szerviz
  'fl.sv.cat.oil': { hu: '🛢 Olajcsere', ro: '🛢 Schimb ulei' },
  'fl.sv.cat.tire': { hu: '🛞 Gumi', ro: '🛞 Anvelope' },
  'fl.sv.cat.repair': { hu: '🔧 Javítás', ro: '🔧 Reparație' },
  'fl.sv.cat.maint': { hu: '⚙️ Karbantartás', ro: '⚙️ Întreținere' },
  'fl.sv.cat.other': { hu: '📎 Egyéb', ro: '📎 Altele' },
  'fl.sv.addTitle': { hu: '➕ Szerviz-esemény rögzítése', ro: '➕ Înregistrare eveniment service' },
  'fl.sv.vehicle': { hu: 'Jármű *', ro: 'Vehicul *' },
  'fl.sv.choose': { hu: '— Válassz —', ro: '— Alege —' },
  'fl.sv.date': { hu: 'Dátum', ro: 'Data' },
  'fl.sv.km': { hu: 'Km-állás', ro: 'Kilometraj' },
  'fl.sv.kmPh': { hu: 'pl. 450000', ro: 'ex. 450000' },
  'fl.sv.type': { hu: 'Típus', ro: 'Tip' },
  'fl.sv.cost': { hu: 'Költség (RON)', ro: 'Cost (RON)' },
  'fl.sv.desc': { hu: 'Leírás', ro: 'Descriere' },
  'fl.sv.descPh': { hu: 'pl. olaj + szűrők', ro: 'ex. ulei + filtre' },
  'fl.sv.nextDate': { hu: 'Köv. esedékes (dátum)', ro: 'Următoarea scadență (data)' },
  'fl.sv.nextKm': { hu: 'Köv. esedékes (km)', ro: 'Următoarea scadență (km)' },
  'fl.sv.nextKmPh': { hu: 'pl. 530000', ro: 'ex. 530000' },
  'fl.sv.save': { hu: '+ Rögzítés', ro: '+ Înregistrare' },
  'fl.sv.logTitle': { hu: '🔧 Szerviz-napló', ro: '🔧 Jurnal de service' },
  'fl.sv.logHint': { hu: 'A költségek beépülnek a <b>Statisztika → Jármű kihasználtság</b> riportba (Szerviz oszlop + Eredmény). A „köv. esedékes" km-et az élő GPS km-órával tudod összevetni a jármű-statisztikán.', ro: 'Costurile sunt incluse în raportul <b>Statistici → Utilizare vehicule</b> (coloana Service + Rezultat). Kilometrajul „următoarei scadențe" poate fi comparat cu odometrul GPS live în statistica vehiculului.' },
  'fl.sv.colVeh': { hu: 'Jármű', ro: 'Vehicul' },
  'fl.sv.colDate': { hu: 'Dátum', ro: 'Data' },
  'fl.sv.colKm': { hu: 'Km', ro: 'Km' },
  'fl.sv.colType': { hu: 'Típus', ro: 'Tip' },
  'fl.sv.colDesc': { hu: 'Leírás', ro: 'Descriere' },
  'fl.sv.colCost': { hu: 'Költség (RON)', ro: 'Cost (RON)' },
  'fl.sv.colNext': { hu: 'Köv. esedékes', ro: 'Următoarea scadență' },
  'fl.sv.empty': { hu: 'Nincs még szerviz-bejegyzés.', ro: 'Nu există încă înregistrări de service.' },
  'fl.sv.needVeh': { hu: 'Válassz járművet!', ro: 'Alege un vehicul!' },
  'fl.sv.saved': { hu: '✅ Szerviz rögzítve', ro: '✅ Service înregistrat' },
  'fl.sv.confirmDel': { hu: 'Törlöd ezt a szerviz-bejegyzést?', ro: 'Ștergi această înregistrare de service?' },
  // Decont
  'fl.dc.title': { hu: '💶 Sofőr-elszámolás (decont)', ro: '💶 Decont șofer' },
  'fl.dc.driver': { hu: 'Sofőr *', ro: 'Șofer *' },
  'fl.dc.choose': { hu: '— Válassz —', ro: '— Alege —' },
  'fl.dc.periodFrom': { hu: 'Időszak kezdete', ro: 'Început perioadă' },
  'fl.dc.periodTo': { hu: 'Időszak vége', ro: 'Sfârșit perioadă' },
  'fl.dc.run': { hu: '📊 Elszámolás', ro: '📊 Decont' },
  'fl.dc.advTitle': { hu: '➕ Előleg kiadása', ro: '➕ Acordare avans' },
  'fl.dc.amount': { hu: 'Összeg (RON) *', ro: 'Sumă (RON) *' },
  'fl.dc.advNotePh': { hu: 'pl. kassza-feltöltés', ro: 'ex. alimentare casă' },
  'fl.dc.advSave': { hu: '💵 Kiadás rögzítése', ro: '💵 Înregistrare plată' },
  'fl.dc.needDriver': { hu: 'Válassz sofőrt!', ro: 'Alege un șofer!' },
  'fl.dc.advTotal': { hu: 'Kiadott előleg ({n} db)', ro: 'Avans acordat ({n} buc.)' },
  'fl.dc.cashSpend': { hu: 'Készpénzes költés (menetlevelek)', ro: 'Cheltuieli numerar (foi de parcurs)' },
  'fl.dc.balLabel': { hu: 'Kassza-egyenleg ({n})', ro: 'Sold casă ({n})' },
  'fl.dc.balToCompany': { hu: 'visszajár a cégnek', ro: 'se returnează firmei' },
  'fl.dc.balToDriver': { hu: 'a sofőrnek jár', ro: 'se cuvine șoferului' },
  'fl.dc.diurnaLabel': { hu: 'Diurna-járandóság ({ext} külső + {int} belső nap)', ro: 'Drept diurnă ({ext} zile externe + {int} zile interne)' },
  'fl.dc.rateNote': { hu: '⚙️ Diurna napidíj-ráták (RON/nap):', ro: '⚙️ Tarife diurnă (RON/zi):' },
  'fl.dc.rateExt': { hu: 'külső', ro: 'extern' },
  'fl.dc.rateInt': { hu: 'belső', ro: 'intern' },
  'fl.dc.rateSave': { hu: 'Mentés', ro: 'Salvare' },
  'fl.dc.rateHint': { hu: 'Beállítás után a diurna-járandóság automatikusan számolódik.', ro: 'După setare, dreptul de diurnă se calculează automat.' },
  'fl.dc.ratesSaved': { hu: '✅ Ráták mentve', ro: '✅ Tarife salvate' },
  'fl.dc.noSpend': { hu: 'Nincs költés az időszakban.', ro: 'Nu există cheltuieli în perioadă.' },
  'fl.dc.noAdv': { hu: 'Nincs előleg az időszakban.', ro: 'Nu există avans în perioadă.' },
  'fl.dc.settleTitle': { hu: '📋 {name} — elszámolás ({from} → {to})', ro: '📋 {name} — decont ({from} → {to})' },
  'fl.dc.periodSummary': { hu: 'Az időszakban: {km} km · {ml} menetlevél', ro: 'În perioadă: {km} km · {ml} foi de parcurs' },
  'fl.dc.print': { hu: '🖨️ Nyomtatás', ro: '🖨️ Tipărire' },
  'fl.dc.spendTitle': { hu: '🛒 Költések fizetési mód szerint (RON)', ro: '🛒 Cheltuieli după modul de plată (RON)' },
  'fl.dc.colMode': { hu: 'Mód', ro: 'Mod' },
  'fl.dc.colItem': { hu: 'Tétel', ro: 'Poziții' },
  'fl.dc.colAmount': { hu: 'Összeg', ro: 'Sumă' },
  'fl.dc.advListTitle': { hu: '💵 Kiadott előlegek', ro: '💵 Avansuri acordate' },
  'fl.dc.colDate': { hu: 'Dátum', ro: 'Data' },
  'fl.dc.colAmountRon': { hu: 'Összeg (RON)', ro: 'Sumă (RON)' },
  'fl.dc.colNote': { hu: 'Megjegyzés', ro: 'Observație' },
  'fl.dc.colBy': { hu: 'Kiadta', ro: 'Acordat de' },
  'fl.dc.advSaved': { hu: '💵 Előleg rögzítve', ro: '💵 Avans înregistrat' },
  'fl.dc.confirmDelAdv': { hu: 'Törlöd ezt az előleget?', ro: 'Ștergi acest avans?' },
  // Üzemanyagkártya-import
  'fl.fc.importTitle': { hu: '⛽ Üzemanyagkártya-kivonat importálása (OMV / MOL / DKV / Eurowag / egyéb CSV)', ro: '⛽ Import extras card carburant (OMV / MOL / DKV / Eurowag / alt CSV)' },
  'fl.fc.importHint': { hu: 'Töltsd fel a kártya-szolgáltató CSV-kivonatát, párosítsd az oszlopokat, és importálj. A kétszeri import nem duplikál (tranzakció-azonosítás). Az összevetés megmutatja, hol tér el a kártyás tankolás a sofőr által beírttól.', ro: 'Încarcă extrasul CSV al furnizorului de card, mapează coloanele și importă. Importul repetat nu duplică (identificare tranzacții). Comparația arată unde diferă alimentarea pe card față de cea introdusă de șofer.' },
  'fl.fc.source': { hu: 'Forrás', ro: 'Sursă' },
  'fl.fc.srcOther': { hu: 'Egyéb', ro: 'Altele' },
  'fl.fc.file': { hu: 'CSV fájl', ro: 'Fișier CSV' },
  'fl.fc.csvEmpty': { hu: 'A CSV üres vagy csak fejléc.', ro: 'CSV-ul este gol sau conține doar antet.' },
  'fl.fc.mapTitle': { hu: 'Oszlop-párosítás ({n} sor)', ro: 'Mapare coloane ({n} rânduri)' },
  'fl.fc.colDate': { hu: 'Dátum *', ro: 'Data *' },
  'fl.fc.colPlate': { hu: 'Rendszám *', ro: 'Nr. înmatriculare *' },
  'fl.fc.colQty': { hu: 'Liter *', ro: 'Litri *' },
  'fl.fc.colAmount': { hu: 'Összeg (RON) *', ro: 'Sumă (RON) *' },
  'fl.fc.colProduct': { hu: 'Termék', ro: 'Produs' },
  'fl.fc.import': { hu: '📥 Import', ro: '📥 Import' },
  'fl.fc.preview': { hu: 'Előnézet: ', ro: 'Previzualizare: ' },
  'fl.fc.needCols': { hu: 'Párosítsd a kötelező (*) oszlopokat!', ro: 'Mapează coloanele obligatorii (*)!' },
  'fl.fc.noValidRow': { hu: 'Egy érvényes sor sem állt össze — ellenőrizd a párosítást!', ro: 'Niciun rând valid — verifică maparea!' },
  'fl.fc.importDone': { hu: '📥 Import kész: {ins} új, {skip} kihagyva (duplikált/hibás)', ro: '📥 Import finalizat: {ins} noi, {skip} omise (duplicate/eronate)' },
  'fl.fc.cmpTitle': { hu: '⚖️ Kártya vs. sofőr-tankolás (e hónap, liter)', ro: '⚖️ Card vs. alimentare șofer (luna curentă, litri)' },
  'fl.fc.cmpColPlate': { hu: 'Rendszám', ro: 'Nr. înmatriculare' },
  'fl.fc.cmpColCard': { hu: 'Kártya (L)', ro: 'Card (L)' },
  'fl.fc.cmpColDrv': { hu: 'Sofőr beírta (L)', ro: 'Introdus de șofer (L)' },
  'fl.fc.cmpColDiff': { hu: 'Eltérés (L)', ro: 'Diferență (L)' },
  'fl.fc.cmpColCardCost': { hu: 'Kártya-költség (RON)', ro: 'Cost card (RON)' },
  'fl.fc.cmpHint': { hu: '🔴 = 10%-nál nagyobb eltérés — érdemes ellenőrizni (elírás vagy hiányzó menetlevél).', ro: '🔴 = diferență mai mare de 10% — merită verificat (greșeală sau foaie de parcurs lipsă).' },
  'fl.fc.listTitle': { hu: '🧾 Importált kártya-tranzakciók (e hónap: {db} db · {l} L · {ron} RON)', ro: '🧾 Tranzacții card importate (luna curentă: {db} buc. · {l} L · {ron} RON)' },
  'fl.fc.listColDate': { hu: 'Dátum', ro: 'Data' },
  'fl.fc.listColSource': { hu: 'Forrás', ro: 'Sursă' },
  'fl.fc.listColPlate': { hu: 'Rendszám', ro: 'Nr. înmatriculare' },
  'fl.fc.listColProduct': { hu: 'Termék', ro: 'Produs' },
  'fl.fc.listColLiter': { hu: 'Liter', ro: 'Litri' },
  'fl.fc.listColAmount': { hu: 'Összeg (RON)', ro: 'Sumă (RON)' },
  'fl.fc.listEmpty': { hu: 'Még nincs importált tranzakció ebben a hónapban.', ro: 'Încă nu există tranzacții importate în această lună.' },
  // Vezérlőpult lejárat-riasztás
  'fl.dash.expired': { hu: 'LEJÁRT', ro: 'EXPIRAT' },
  'fl.dash.days': { hu: '{n} nap', ro: '{n} zile' },
  'fl.dash.expiringDocs': { hu: '{n} lejáró dokumentum', ro: '{n} documente care expiră' },
  'fl.dash.expiredCount': { hu: ' ({n} LEJÁRT!)', ro: ' ({n} EXPIRATE!)' },
  'fl.dash.toExpiries': { hu: '→ Lejáratok', ro: '→ Expirări' },
});

(function () {
  'use strict';

  function T(k, v) { return (typeof window.t === 'function') ? window.t(k, v) : k; }

  function n2(x, dec) {
    var n = parseFloat(x);
    if (!isFinite(n)) return '—';
    return n.toLocaleString('hu-HU', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 2 : dec });
  }
  function d2(d) { return d ? new Date(d).toLocaleDateString('hu-HU') : '—'; }
  function ymd(d) { return d ? String(d).slice(0, 10) : ''; }

  function panel(title, body, extraHead) {
    return '<div class="glass" style="padding:18px;margin-bottom:14px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">'
      + '<div class="text-primary" style="font-size:15px;font-weight:700;">' + title + '</div>'
      + (extraHead || '') + '</div>' + body + '</div>';
  }

  // ════════════════════════════════════════════════════════
  //  1) LEJÁRATOK & RIASZTÁSOK
  // ════════════════════════════════════════════════════════
  // RO-specifikus, előre gyártott dokumentum-típusok (szabadon felülírható)
  // [tárolt érték (HU, szerverre megy), i18n-kulcs (megjelenítés)]
  var DOC_TYPES = [
    ['ITP (műszaki)', 'fl.doc.itp'], ['RCA (kötelező bizt.)', 'fl.doc.rca'], ['CASCO', 'fl.doc.casco'],
    ['Rovinietă', 'fl.doc.rovinieta'], ['CMR-biztosítás', 'fl.doc.cmr'], ['Tahográf-hitelesítés', 'fl.doc.tahoVerif'],
    ['Tahográf-kártya', 'fl.doc.tahoCard'], ['Tahográf-letöltés (28 nap)', 'fl.doc.tahoDl'],
    ['ADR-engedély', 'fl.doc.adr'], ['Közösségi engedély', 'fl.doc.comm'], ['Jogosítvány', 'fl.doc.license'],
    ['Atestat (szakmai)', 'fl.doc.atestat'], ['Orvosi/pszichológiai', 'fl.doc.medical'], ['Egyéb', 'fl.doc.other']];

  var _expItems = [];

  function loadExpiries() {
    var box = document.getElementById('expiriesBox');
    if (!box) return;
    box.innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + T('fl.loading') + '</div>';
    Promise.all([gas('expiryList'), gas('vehicleList'), gas('getInternalDrivers')]).then(function (rs) {
      var r = rs[0];
      if (!r || !r.ok) { box.innerHTML = '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || T('fl.errMigr')) + '</div>'; return; }
      _expItems = r.items || [];
      var vehicles = Array.isArray(rs[1]) ? rs[1] : [];
      var drivers = Array.isArray(rs[2]) ? rs[2] : [];

      // Új tétel űrlap
      var formHtml =
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;align-items:end;">'
        + '<div class="field" style="margin:0;"><label>' + T('fl.exp.entity') + '</label>'
        + '<select class="select" id="expEntityType" onchange="FleetExtra.expEntityChange()">'
        + '<option value="vehicle">' + T('fl.exp.entVehicle') + '</option><option value="driver">' + T('fl.exp.entDriver') + '</option><option value="company">' + T('fl.exp.entCompany') + '</option></select></div>'
        + '<div class="field" style="margin:0;"><label>' + T('fl.exp.vehOrDrv') + '</label>'
        + '<select class="select" id="expEntityLabel">'
        + vehicles.map(function (v) { return '<option value="' + esc(v.rendszam) + '">' + esc(v.rendszam) + (v.marca ? ' — ' + esc(v.marca) : '') + '</option>'; }).join('')
        + '</select></div>'
        + '<div class="field" style="margin:0;"><label>' + T('fl.exp.document') + '</label>'
        + '<select class="select" id="expDocType">' + DOC_TYPES.map(function (t) { return '<option value="' + esc(t[0]) + '">' + esc(T(t[1])) + '</option>'; }).join('') + '</select></div>'
        + '<div class="field" style="margin:0;"><label>' + T('fl.exp.expiryDate') + '</label><input class="input" id="expDate" type="date"></div>'
        + '<div class="field" style="margin:0;"><label>' + T('fl.exp.alertDays') + '</label><input class="input" id="expAlertDays" type="number" value="30" min="0" max="365"></div>'
        + '<div class="field" style="margin:0;"><label>' + T('fl.exp.note') + '</label><input class="input" id="expNote" placeholder="' + esc(T('fl.exp.optional')) + '"></div>'
        + '<button class="btn primary" style="height:42px;" onclick="FleetExtra.expSave()">' + T('fl.exp.add') + '</button>'
        + '</div>';

      // Lista — lejárat szerint, színezve
      var rows = _expItems.map(function (it, i) {
        var dl = parseInt(it.days_left, 10);
        var badge = dl < 0 ? '<span class="badge err">' + T('fl.exp.badgeExpired', { n: Math.abs(dl) }) + '</span>'
          : dl <= (it.alert_days || 30) ? '<span class="badge warn">' + T('fl.exp.badgeDays', { n: dl }) + '</span>'
          : '<span class="badge ok">' + T('fl.exp.badgeDays', { n: dl }) + '</span>';
        var ico = it.entity_type === 'driver' ? '👤' : it.entity_type === 'company' ? '🏢' : '🚛';
        return '<tr>'
          + '<td>' + ico + ' <b class="text-primary">' + esc(it.entity_label || '—') + '</b></td>'
          + '<td>' + esc(it.doc_type) + '</td>'
          + '<td>' + d2(it.expiry_date) + '</td>'
          + '<td style="text-align:center;">' + badge + '</td>'
          + '<td class="text-muted" style="font-size:12px;">' + esc(it.note || '') + '</td>'
          + '<td style="text-align:right;white-space:nowrap;">'
          + '<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="FleetExtra.expEdit(' + i + ')">✏️</button> '
          + '<button class="btn danger" style="padding:4px 10px;font-size:12px;" onclick="FleetExtra.expDelete(' + it.id + ')">✕</button></td>'
          + '</tr>';
      }).join('') || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:18px;">' + T('fl.exp.empty') + '</td></tr>';

      box.innerHTML =
        panel(T('fl.exp.addTitle'), formHtml)
        + panel(T('fl.exp.listTitle'),
          '<p class="text-muted" style="font-size:12px;margin:0 0 10px;">' + T('fl.exp.listHint') + '</p>'
          + '<div style="overflow-x:auto;"><table class="table">'
          + '<thead><tr><th>' + T('fl.exp.colEntity') + '</th><th>' + T('fl.exp.colDoc') + '</th><th>' + T('fl.exp.colExpiry') + '</th><th style="text-align:center;">' + T('fl.exp.colStatus') + '</th><th>' + T('fl.exp.colNote') + '</th><th></th></tr></thead>'
          + '<tbody>' + rows + '</tbody></table></div>');

      // a sofőr-választó tartalmát eltároljuk típus-váltáshoz
      window._expVehOpts = vehicles.map(function (v) { return { value: v.rendszam, label: v.rendszam + (v.marca ? ' — ' + v.marca : '') }; });
      window._expDrvOpts = drivers.map(function (u) { return { value: u.nume || u.email, label: (u.nume || '') + ' (' + u.email + ')' }; });
    });
  }

  function expEntityChange() {
    var t = (document.getElementById('expEntityType') || {}).value;
    var sel = document.getElementById('expEntityLabel');
    if (!sel) return;
    var opts = t === 'driver' ? (window._expDrvOpts || []) : t === 'company' ? [{ value: '', label: T('fl.exp.companyLevel') }] : (window._expVehOpts || []);
    sel.innerHTML = opts.map(function (o) { return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>'; }).join('');
  }

  var _expEditId = null;
  function expSave() {
    var f = {
      entity_type: (document.getElementById('expEntityType') || {}).value,
      entity_label: (document.getElementById('expEntityLabel') || {}).value,
      doc_type: (document.getElementById('expDocType') || {}).value,
      expiry_date: (document.getElementById('expDate') || {}).value,
      alert_days: (document.getElementById('expAlertDays') || {}).value,
      note: (document.getElementById('expNote') || {}).value,
    };
    if (!f.expiry_date) { toast(T('fl.exp.needDate'), 'err'); return; }
    gas('expirySave', [_expEditId, f]).then(function (r) {
      if (r && r.ok) { toast(_expEditId ? T('fl.exp.updated') : T('fl.exp.saved'), 'ok'); _expEditId = null; loadExpiries(); }
      else toast((r && r.err) || T('fl.err'), 'err');
    });
  }

  function expEdit(idx) {
    var it = _expItems[idx];
    if (!it) return;
    _expEditId = it.id;
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.value = v; };
    set('expEntityType', it.entity_type); expEntityChange();
    set('expEntityLabel', it.entity_label || '');
    set('expDocType', it.doc_type);
    set('expDate', ymd(it.expiry_date));
    set('expAlertDays', it.alert_days != null ? it.alert_days : 30);
    set('expNote', it.note || '');
    toast(T('fl.exp.editHint'), 'ok');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function expDelete(id) {
    if (!confirm(T('fl.exp.confirmDel'))) return;
    gas('expiryDelete', [id]).then(function (r) {
      if (r && r.ok) { toast(T('fl.deleted'), 'ok'); loadExpiries(); }
      else toast((r && r.err) || T('fl.err'), 'err');
    });
  }

  // ════════════════════════════════════════════════════════
  //  2) SZERVIZ & KARBANTARTÁS
  // ════════════════════════════════════════════════════════
  // [tárolt érték (szerverre megy), i18n-kulcs (megjelenítés)]
  var SERVICE_CATS = [['olajcsere', 'fl.sv.cat.oil'], ['gumi', 'fl.sv.cat.tire'], ['javitas', 'fl.sv.cat.repair'],
    ['karbantartas', 'fl.sv.cat.maint'], ['egyeb', 'fl.sv.cat.other']];

  function loadServiceLog() {
    var box = document.getElementById('serviceLogBox');
    if (!box) return;
    box.innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + T('fl.loading') + '</div>';
    Promise.all([gas('serviceList', [{}]), gas('vehicleList')]).then(function (rs) {
      var r = rs[0];
      if (!r || !r.ok) { box.innerHTML = '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || T('fl.errMigr')) + '</div>'; return; }
      var vehicles = (Array.isArray(rs[1]) ? rs[1] : []);
      var items = r.items || [];
      var catLbl = {}; SERVICE_CATS.forEach(function (c) { catLbl[c[0]] = T(c[1]); });

      var formHtml =
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end;">'
        + '<div class="field" style="margin:0;"><label>' + T('fl.sv.vehicle') + '</label><select class="select" id="svVeh">'
        + '<option value="">' + T('fl.sv.choose') + '</option>'
        + vehicles.map(function (v) { return '<option value="' + v.id + '">' + esc(v.rendszam) + (v.marca ? ' — ' + esc(v.marca) : '') + '</option>'; }).join('')
        + '</select></div>'
        + '<div class="field" style="margin:0;"><label>' + T('fl.sv.date') + '</label><input class="input" id="svDate" type="date" value="' + new Date().toISOString().slice(0, 10) + '"></div>'
        + '<div class="field" style="margin:0;"><label>' + T('fl.sv.km') + '</label><input class="input" id="svKm" type="number" placeholder="' + esc(T('fl.sv.kmPh')) + '"></div>'
        + '<div class="field" style="margin:0;"><label>' + T('fl.sv.type') + '</label><select class="select" id="svCat">'
        + SERVICE_CATS.map(function (c) { return '<option value="' + c[0] + '">' + esc(T(c[1])) + '</option>'; }).join('') + '</select></div>'
        + '<div class="field" style="margin:0;"><label>' + T('fl.sv.cost') + '</label><input class="input" id="svCost" type="number" step="0.01" placeholder="0"></div>'
        + '<div class="field" style="margin:0;grid-column:span 2;"><label>' + T('fl.sv.desc') + '</label><input class="input" id="svDesc" placeholder="' + esc(T('fl.sv.descPh')) + '"></div>'
        + '<div class="field" style="margin:0;"><label>' + T('fl.sv.nextDate') + '</label><input class="input" id="svNextDate" type="date"></div>'
        + '<div class="field" style="margin:0;"><label>' + T('fl.sv.nextKm') + '</label><input class="input" id="svNextKm" type="number" placeholder="' + esc(T('fl.sv.nextKmPh')) + '"></div>'
        + '<button class="btn primary" style="height:42px;" onclick="FleetExtra.svSave()">' + T('fl.sv.save') + '</button>'
        + '</div>';

      var rows = items.map(function (it) {
        return '<tr>'
          + '<td><b class="text-primary">' + esc(it.rendszam) + '</b></td>'
          + '<td>' + d2(it.service_date) + '</td>'
          + '<td style="text-align:right;">' + (it.km != null ? n2(it.km, 0) : '—') + '</td>'
          + '<td>' + (catLbl[it.category] || esc(it.category || '—')) + '</td>'
          + '<td>' + esc(it.description || '—') + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + (it.cost_ron != null ? n2(it.cost_ron, 0) : '—') + '</td>'
          + '<td class="text-muted" style="font-size:12px;">'
          + (it.next_due_date ? '📅 ' + d2(it.next_due_date) : '') + (it.next_due_km ? ' 🛣 ' + n2(it.next_due_km, 0) + ' km' : '') + '</td>'
          + '<td style="text-align:right;"><button class="btn danger" style="padding:4px 10px;font-size:12px;" onclick="FleetExtra.svDelete(' + it.id + ')">✕</button></td>'
          + '</tr>';
      }).join('') || '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:18px;">' + T('fl.sv.empty') + '</td></tr>';

      box.innerHTML =
        panel(T('fl.sv.addTitle'), formHtml)
        + panel(T('fl.sv.logTitle'),
          '<p class="text-muted" style="font-size:12px;margin:0 0 10px;">' + T('fl.sv.logHint') + '</p>'
          + '<div style="overflow-x:auto;"><table class="table">'
          + '<thead><tr><th>' + T('fl.sv.colVeh') + '</th><th>' + T('fl.sv.colDate') + '</th><th style="text-align:right;">' + T('fl.sv.colKm') + '</th><th>' + T('fl.sv.colType') + '</th><th>' + T('fl.sv.colDesc') + '</th><th style="text-align:right;">' + T('fl.sv.colCost') + '</th><th>' + T('fl.sv.colNext') + '</th><th></th></tr></thead>'
          + '<tbody>' + rows + '</tbody></table></div>');
    });
  }

  function svSave() {
    var f = {
      vehicle_id: (document.getElementById('svVeh') || {}).value,
      service_date: (document.getElementById('svDate') || {}).value,
      km: (document.getElementById('svKm') || {}).value,
      category: (document.getElementById('svCat') || {}).value,
      description: (document.getElementById('svDesc') || {}).value,
      cost_ron: (document.getElementById('svCost') || {}).value,
      next_due_date: (document.getElementById('svNextDate') || {}).value || null,
      next_due_km: (document.getElementById('svNextKm') || {}).value,
    };
    if (!f.vehicle_id) { toast(T('fl.sv.needVeh'), 'err'); return; }
    gas('serviceCreate', [f]).then(function (r) {
      if (r && r.ok) { toast(T('fl.sv.saved'), 'ok'); loadServiceLog(); }
      else toast((r && r.err) || T('fl.err'), 'err');
    });
  }

  function svDelete(id) {
    if (!confirm(T('fl.sv.confirmDel'))) return;
    gas('serviceDelete', [id]).then(function (r) {
      if (r && r.ok) { toast(T('fl.deleted'), 'ok'); loadServiceLog(); }
      else toast((r && r.err) || T('fl.err'), 'err');
    });
  }

  // ════════════════════════════════════════════════════════
  //  3) SOFŐR-ELSZÁMOLÁS (DECONT)
  // ════════════════════════════════════════════════════════
  var _dcDrivers = [];

  function monthRange() {
    var now = new Date();
    var from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
  }

  function loadDecont() {
    var box = document.getElementById('decontBox');
    if (!box) return;
    box.innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + T('fl.loading') + '</div>';
    gas('getInternalDrivers').then(function (list) {
      _dcDrivers = Array.isArray(list) ? list : [];
      var mr = monthRange();
      box.innerHTML =
        panel(T('fl.dc.title'),
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;align-items:end;">'
          + '<div class="field" style="margin:0;"><label>' + T('fl.dc.driver') + '</label><select class="select" id="dcDriver">'
          + '<option value="">' + T('fl.dc.choose') + '</option>'
          + _dcDrivers.map(function (u) { return '<option value="' + esc(u.email) + '">' + esc(u.nume || u.email) + '</option>'; }).join('')
          + '</select></div>'
          + '<div class="field" style="margin:0;"><label>' + T('fl.dc.periodFrom') + '</label><input class="input" id="dcFrom" type="date" value="' + mr.from + '"></div>'
          + '<div class="field" style="margin:0;"><label>' + T('fl.dc.periodTo') + '</label><input class="input" id="dcTo" type="date" value="' + mr.to + '"></div>'
          + '<button class="btn primary" style="height:42px;" onclick="FleetExtra.dcLoad()">' + T('fl.dc.run') + '</button>'
          + '</div>')
        + panel(T('fl.dc.advTitle'),
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end;">'
          + '<div class="field" style="margin:0;"><label>' + T('fl.dc.driver') + '</label><select class="select" id="advDriver">'
          + '<option value="">' + T('fl.dc.choose') + '</option>'
          + _dcDrivers.map(function (u) { return '<option value="' + esc(u.email) + '">' + esc(u.nume || u.email) + '</option>'; }).join('')
          + '</select></div>'
          + '<div class="field" style="margin:0;"><label>' + T('fl.dc.amount') + '</label><input class="input" id="advAmount" type="number" step="0.01" placeholder="0"></div>'
          + '<div class="field" style="margin:0;"><label>' + T('fl.sv.date') + '</label><input class="input" id="advDate" type="date" value="' + new Date().toISOString().slice(0, 10) + '"></div>'
          + '<div class="field" style="margin:0;"><label>' + T('fl.exp.note') + '</label><input class="input" id="advNote" placeholder="' + esc(T('fl.dc.advNotePh')) + '"></div>'
          + '<button class="btn ok" style="height:42px;" onclick="FleetExtra.advSave()">' + T('fl.dc.advSave') + '</button>'
          + '</div>')
        + '<div id="dcResult"></div>';
    });
  }

  function dcLoad() {
    var email = (document.getElementById('dcDriver') || {}).value;
    var from = (document.getElementById('dcFrom') || {}).value;
    var to = (document.getElementById('dcTo') || {}).value;
    if (!email) { toast(T('fl.dc.needDriver'), 'err'); return; }
    var out = document.getElementById('dcResult');
    out.innerHTML = '<div class="text-muted" style="padding:20px;text-align:center;">' + T('fl.calculating') + '</div>';
    Promise.all([
      gas('getDriverSettlement', [{ email: email, from: from, to: to }]),
      gas('advanceList', [{ email: email, from: from, to: to }])
    ]).then(function (rs) {
      var r = rs[0], advs = (rs[1] && rs[1].items) || [];
      if (!r || !r.ok) { out.innerHTML = '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || T('fl.err')) + '</div>'; return; }

      var bal = parseFloat(r.kassza_egyenleg) || 0;
      var balColor = bal >= 0 ? 'var(--status-ok)' : 'var(--status-danger)';
      var tiles =
        '<div class="dash-stats" style="margin-bottom:14px;">'
        + '<div class="glass stat-tile"><div class="stat-ico">💵</div><div><div class="stat-val text-primary">' + n2(r.eloleg_total, 0) + ' RON</div><div class="stat-lbl text-muted">' + T('fl.dc.advTotal', { n: r.eloleg_db }) + '</div></div></div>'
        + '<div class="glass stat-tile"><div class="stat-ico">🛒</div><div><div class="stat-val text-primary">' + n2(r.cash_koltes, 0) + ' RON</div><div class="stat-lbl text-muted">' + T('fl.dc.cashSpend') + '</div></div></div>'
        + '<div class="glass stat-tile"><div class="stat-ico">⚖️</div><div><div class="stat-val" style="color:' + balColor + ' !important;">' + n2(bal, 0) + ' RON</div><div class="stat-lbl text-muted">' + T('fl.dc.balLabel', { n: (bal >= 0 ? T('fl.dc.balToCompany') : T('fl.dc.balToDriver')) }) + '</div></div></div>'
        + '<div class="glass stat-tile"><div class="stat-ico">🗓️</div><div><div class="stat-val text-primary">'
        + (r.diurna.total != null ? n2(r.diurna.total, 0) + ' RON' : '—')
        + '</div><div class="stat-lbl text-muted">' + T('fl.dc.diurnaLabel', { ext: r.diurna.ext_nap, int: r.diurna.int_nap }) + '</div></div></div>'
        + '</div>';

      var rateNote = (r.diurna.total == null && typeof VS_ROLE !== 'undefined' && VS_ROLE === 'admin')
        ? '<div class="glass-soft" style="padding:12px 14px;margin-bottom:14px;font-size:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
          + '<span>' + T('fl.dc.rateNote') + '</span>'
          + '<input class="input" id="dcRateExt" type="number" step="0.01" placeholder="' + esc(T('fl.dc.rateExt')) + '" style="max-width:110px;padding:6px 10px;">'
          + '<input class="input" id="dcRateInt" type="number" step="0.01" placeholder="' + esc(T('fl.dc.rateInt')) + '" style="max-width:110px;padding:6px 10px;">'
          + '<button class="btn primary" style="padding:6px 12px;font-size:12px;" onclick="FleetExtra.dcSaveRates()">' + T('fl.dc.rateSave') + '</button>'
          + '<span class="text-muted" style="font-size:11px;">' + T('fl.dc.rateHint') + '</span></div>'
        : '';

      var ktgRows = (r.koltesek || []).map(function (k) {
        return '<tr><td>' + esc(k.plata) + '</td><td style="text-align:right;">' + n2(k.db, 0) + '</td><td style="text-align:right;font-weight:700;">' + n2(k.osszeg, 0) + '</td></tr>';
      }).join('') || '<tr><td colspan="3" class="text-muted" style="text-align:center;padding:12px;">' + T('fl.dc.noSpend') + '</td></tr>';

      var advRows = advs.map(function (a) {
        return '<tr><td>' + d2(a.given_at) + '</td><td style="text-align:right;font-weight:700;">' + n2(a.amount, 0) + '</td>'
          + '<td>' + esc(a.note || '—') + '</td><td class="text-muted" style="font-size:12px;">' + esc(a.created_by || '') + '</td>'
          + '<td style="text-align:right;"><button class="btn danger" style="padding:3px 9px;font-size:12px;" onclick="FleetExtra.advDelete(' + a.id + ')">✕</button></td></tr>';
      }).join('') || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:12px;">' + T('fl.dc.noAdv') + '</td></tr>';

      out.innerHTML =
        panel(T('fl.dc.settleTitle', { name: esc(r.sofer.nume || r.sofer.email), from: d2(from), to: d2(to) }),
          tiles + rateNote
          + '<div class="text-muted" style="font-size:12px;">' + T('fl.dc.periodSummary', { km: n2(r.km, 0), ml: n2(r.menetlevelek, 0) }) + '</div>',
          '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="window.print()">' + T('fl.dc.print') + '</button>')
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;">'
        + panel(T('fl.dc.spendTitle'),
          '<table class="table"><thead><tr><th>' + T('fl.dc.colMode') + '</th><th style="text-align:right;">' + T('fl.dc.colItem') + '</th><th style="text-align:right;">' + T('fl.dc.colAmount') + '</th></tr></thead><tbody>' + ktgRows + '</tbody></table>')
        + panel(T('fl.dc.advListTitle'),
          '<table class="table"><thead><tr><th>' + T('fl.dc.colDate') + '</th><th style="text-align:right;">' + T('fl.dc.colAmountRon') + '</th><th>' + T('fl.dc.colNote') + '</th><th>' + T('fl.dc.colBy') + '</th><th></th></tr></thead><tbody>' + advRows + '</tbody></table>')
        + '</div>';
    });
  }

  function dcSaveRates() {
    var ext = (document.getElementById('dcRateExt') || {}).value;
    var int_ = (document.getElementById('dcRateInt') || {}).value;
    gas('setDiurnaRates', [{ ext: ext, int: int_ }]).then(function (r) {
      if (r && r.ok) { toast(T('fl.dc.ratesSaved'), 'ok'); dcLoad(); }
      else toast((r && r.err) || T('fl.err'), 'err');
    });
  }

  function advSave() {
    var f = {
      email_sofer: (document.getElementById('advDriver') || {}).value,
      amount: (document.getElementById('advAmount') || {}).value,
      given_at: (document.getElementById('advDate') || {}).value,
      note: (document.getElementById('advNote') || {}).value,
    };
    if (!f.email_sofer) { toast(T('fl.dc.needDriver'), 'err'); return; }
    gas('advanceCreate', [f]).then(function (r) {
      if (r && r.ok) {
        toast(T('fl.dc.advSaved'), 'ok');
        var a = document.getElementById('advAmount'); if (a) a.value = '';
        // ha épp ennek a sofőrnek az elszámolása látszik, frissítjük
        if ((document.getElementById('dcDriver') || {}).value === f.email_sofer) dcLoad();
      } else toast((r && r.err) || T('fl.err'), 'err');
    });
  }

  function advDelete(id) {
    if (!confirm(T('fl.dc.confirmDelAdv'))) return;
    gas('advanceDelete', [id]).then(function (r) {
      if (r && r.ok) { toast(T('fl.deleted'), 'ok'); dcLoad(); }
      else toast((r && r.err) || T('fl.err'), 'err');
    });
  }

  // ════════════════════════════════════════════════════════
  //  4) ÜZEMANYAGKÁRTYA-IMPORT (generikus CSV + oszlop-párosítás)
  // ════════════════════════════════════════════════════════
  var _fcRows = [], _fcHeader = [];

  function loadFuelImport() {
    var box = document.getElementById('fuelImportBox');
    if (!box) return;
    var mr = monthRange();
    box.innerHTML =
      panel(T('fl.fc.importTitle'),
        '<p class="text-muted" style="font-size:12px;margin:0 0 12px;">' + T('fl.fc.importHint') + '</p>'
        + '<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;">'
        + '<div class="field" style="margin:0;"><label>' + T('fl.fc.source') + '</label><select class="select" id="fcSource" style="max-width:140px;">'
        + '<option value="omv">OMV/Petrom</option><option value="mol">MOL</option><option value="dkv">DKV</option><option value="eurowag">Eurowag</option><option value="egyeb">' + T('fl.fc.srcOther') + '</option></select></div>'
        + '<div class="field" style="margin:0;flex:1;min-width:200px;"><label>' + T('fl.fc.file') + '</label><input class="input" type="file" id="fcFile" accept=".csv,.txt" onchange="FleetExtra.fcParse()"></div>'
        + '</div>'
        + '<div id="fcMapping" style="margin-top:12px;"></div>')
      + '<div id="fcCompareBox"></div>'
      + '<div id="fcListBox"></div>';
    fcLoadData(mr.from, mr.to);
  }

  function fcLoadData(from, to) {
    Promise.all([gas('fuelCompare', [{ from: from, to: to }]), gas('fuelCardList', [{ from: from, to: to }])]).then(function (rs) {
      var cmpBox = document.getElementById('fcCompareBox');
      var listBox = document.getElementById('fcListBox');
      if (!cmpBox || !listBox) return;
      var cmp = rs[0], lst = rs[1];

      if (cmp && cmp.ok && (cmp.rows || []).length) {
        var rows = cmp.rows.map(function (x) {
          var warn = x.diff_pct != null && Math.abs(x.diff_pct) > 10;
          return '<tr><td><b class="text-primary">' + esc(x.rendszam || '—') + '</b></td>'
            + '<td style="text-align:right;">' + n2(x.card_l, 0) + '</td>'
            + '<td style="text-align:right;">' + n2(x.drv_l, 0) + '</td>'
            + '<td style="text-align:right;font-weight:700;color:' + (warn ? 'var(--status-danger)' : 'inherit') + ';">' + (x.diff_l > 0 ? '+' : '') + n2(x.diff_l, 0) + '</td>'
            + '<td style="text-align:center;">' + (x.diff_pct != null
              ? '<span class="badge ' + (warn ? 'err' : 'ok') + '">' + (x.diff_pct > 0 ? '+' : '') + n2(x.diff_pct, 1) + '%</span>' : '—') + '</td>'
            + '<td style="text-align:right;">' + n2(x.card_ron, 0) + '</td></tr>';
        }).join('');
        cmpBox.innerHTML = panel(T('fl.fc.cmpTitle'),
          '<div style="overflow-x:auto;"><table class="table">'
          + '<thead><tr><th>' + T('fl.fc.cmpColPlate') + '</th><th style="text-align:right;">' + T('fl.fc.cmpColCard') + '</th><th style="text-align:right;">' + T('fl.fc.cmpColDrv') + '</th><th style="text-align:right;">' + T('fl.fc.cmpColDiff') + '</th><th style="text-align:center;">%</th><th style="text-align:right;">' + T('fl.fc.cmpColCardCost') + '</th></tr></thead>'
          + '<tbody>' + rows + '</tbody></table></div>'
          + '<div class="text-muted" style="font-size:11px;margin-top:6px;">' + T('fl.fc.cmpHint') + '</div>');
      } else { cmpBox.innerHTML = ''; }

      if (lst && lst.ok) {
        var t = lst.total || {};
        var rows2 = (lst.items || []).map(function (it) {
          return '<tr><td>' + d2(it.tx_date) + '</td><td>' + esc(it.source || '—') + '</td>'
            + '<td><b class="text-primary">' + esc(it.rendszam || '—') + '</b></td>'
            + '<td>' + esc(it.product || '—') + '</td>'
            + '<td style="text-align:right;">' + n2(it.qty_l, 1) + '</td>'
            + '<td style="text-align:right;font-weight:700;">' + n2(it.amount_ron, 0) + '</td></tr>';
        }).join('') || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:14px;">' + T('fl.fc.listEmpty') + '</td></tr>';
        listBox.innerHTML = panel(T('fl.fc.listTitle', { db: n2(t.db, 0), l: n2(t.litru, 0), ron: n2(t.suma, 0) }),
          '<div style="overflow-x:auto;"><table class="table">'
          + '<thead><tr><th>' + T('fl.fc.listColDate') + '</th><th>' + T('fl.fc.listColSource') + '</th><th>' + T('fl.fc.listColPlate') + '</th><th>' + T('fl.fc.listColProduct') + '</th><th style="text-align:right;">' + T('fl.fc.listColLiter') + '</th><th style="text-align:right;">' + T('fl.fc.listColAmount') + '</th></tr></thead>'
          + '<tbody>' + rows2 + '</tbody></table></div>');
      }
    });
  }

  // CSV beolvasás + elválasztó-felismerés + oszlop-párosító UI
  function fcParse() {
    var f = (document.getElementById('fcFile') || {}).files;
    if (!f || !f[0]) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var text = String(e.target.result || '');
      var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
      if (lines.length < 2) { toast(T('fl.fc.csvEmpty'), 'err'); return; }
      var delim = [';', ',', '\t'].sort(function (a, b) {
        return lines[0].split(b).length - lines[0].split(a).length;
      })[0];
      var split = function (l) { return l.split(delim).map(function (c) { return c.replace(/^"|"$/g, '').trim(); }); };
      _fcHeader = split(lines[0]);
      _fcRows = lines.slice(1).map(split);

      var opts = '<option value="">—</option>' + _fcHeader.map(function (h, i) { return '<option value="' + i + '">' + esc(h) + '</option>'; }).join('');
      var sel = function (id, lbl) {
        return '<div class="field" style="margin:0;"><label>' + lbl + '</label><select class="select" id="' + id + '">' + opts + '</select></div>';
      };
      // automatikus oszlop-tippek a fejléc-nevek alapján
      var guess = function (re) { var i = _fcHeader.findIndex(function (h) { return re.test(h); }); return i >= 0 ? String(i) : ''; };
      document.getElementById('fcMapping').innerHTML =
        '<div class="glass-soft" style="padding:12px;">'
        + '<div class="text-primary" style="font-size:13px;font-weight:700;margin-bottom:8px;">' + T('fl.fc.mapTitle', { n: _fcRows.length }) + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;align-items:end;">'
        + sel('fcColDate', T('fl.fc.colDate')) + sel('fcColPlate', T('fl.fc.colPlate')) + sel('fcColQty', T('fl.fc.colQty'))
        + sel('fcColAmount', T('fl.fc.colAmount')) + sel('fcColProduct', T('fl.fc.colProduct'))
        + '<button class="btn primary" style="height:42px;" onclick="FleetExtra.fcImport()">' + T('fl.fc.import') + '</button>'
        + '</div>'
        + '<div class="text-muted" style="font-size:11px;margin-top:8px;">' + T('fl.fc.preview') + esc(_fcRows[0].slice(0, 6).join(' | ').slice(0, 140)) + '</div>'
        + '</div>';
      var setSel = function (id, v) { var el = document.getElementById(id); if (el && v) el.value = v; };
      setSel('fcColDate', guess(/dat|date|nap/i));
      setSel('fcColPlate', guess(/rendsz|plate|inmatric|nr\.?\s*auto|vehic|kfz/i));
      setSel('fcColQty', guess(/liter|litru|cantit|qty|menny/i));
      setSel('fcColAmount', guess(/suma|amount|brutto|total|ertek|érték|valoare/i));
      setSel('fcColProduct', guess(/produs|product|termek|termék|aru|áru/i));
    };
    reader.readAsText(f[0], 'utf-8');
  }

  function fcNum(s) {
    // román/magyar tizedesvessző + ezres-elválasztók kezelése
    s = String(s == null ? '' : s).replace(/\s/g, '');
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    return parseFloat(s);
  }
  function fcDate(s) {
    s = String(s || '').trim();
    var m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);          // yyyy-mm-dd
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);              // dd.mm.yyyy
    if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return null;
  }

  function fcImport() {
    var col = function (id) { var v = (document.getElementById(id) || {}).value; return v === '' ? -1 : parseInt(v, 10); };
    var ci = { d: col('fcColDate'), p: col('fcColPlate'), q: col('fcColQty'), a: col('fcColAmount'), pr: col('fcColProduct') };
    if (ci.d < 0 || ci.p < 0 || ci.q < 0 || ci.a < 0) { toast(T('fl.fc.needCols'), 'err'); return; }
    var rows = _fcRows.map(function (r) {
      return {
        tx_date: fcDate(r[ci.d]), rendszam: r[ci.p],
        qty_l: fcNum(r[ci.q]), amount_ron: fcNum(r[ci.a]),
        product: ci.pr >= 0 ? r[ci.pr] : null,
      };
    }).filter(function (r) { return r.tx_date && isFinite(r.qty_l) && isFinite(r.amount_ron); });
    if (!rows.length) { toast(T('fl.fc.noValidRow'), 'err'); return; }
    gas('fuelImportRows', [{ source: (document.getElementById('fcSource') || {}).value, rows: rows }]).then(function (r) {
      if (r && r.ok) {
        toast(T('fl.fc.importDone', { ins: r.inserted, skip: r.skipped }), 'ok');
        document.getElementById('fcMapping').innerHTML = '';
        var mr = monthRange(); fcLoadData(mr.from, mr.to);
      } else toast((r && r.err) || T('fl.err'), 'err');
    });
  }

  // ── Vezérlőpult lejárat-riasztás kártya (loadDashboard hívja) ──
  function renderDashExpiryAlert() {
    var box = document.getElementById('dashExpiryAlert');
    if (!box) return;
    gas('getExpiryAlerts').then(function (r) {
      if (!r || !r.ok || !(r.items || []).length) { box.innerHTML = ''; return; }
      var lejart = r.items.filter(function (i) { return i.days_left < 0; });
      var rows = r.items.slice(0, 6).map(function (i) {
        var ico = i.entity_type === 'driver' ? '👤' : '🚛';
        var col = i.days_left < 0 ? 'var(--status-danger)' : 'var(--status-warn)';
        return '<span style="white-space:nowrap;font-size:12px;">' + ico + ' <b>' + esc(i.entity_label || '') + '</b> '
          + esc(i.doc_type) + ' <span style="color:' + col + ';font-weight:700;">'
          + (i.days_left < 0 ? T('fl.dash.expired') : T('fl.dash.days', { n: i.days_left })) + '</span></span>';
      }).join(' · ');
      box.innerHTML = '<div class="glass" style="padding:12px 16px;margin-bottom:16px;border:1px solid '
        + (lejart.length ? 'rgba(239,68,68,0.4)' : 'rgba(245,158,11,0.4)') + ';cursor:pointer;display:flex;gap:10px;align-items:center;flex-wrap:wrap;" onclick="activateTab(\'expiries\')">'
        + '<span style="font-size:18px;">⏰</span>'
        + '<b class="text-primary" style="font-size:13px;">' + T('fl.dash.expiringDocs', { n: r.items.length })
        + (lejart.length ? T('fl.dash.expiredCount', { n: lejart.length }) : '') + ':</b> ' + rows
        + ' <span class="text-muted" style="font-size:12px;margin-left:auto;">' + T('fl.dash.toExpiries') + '</span></div>';
    }).catch(function () { box.innerHTML = ''; });
  }

  // ── Nyelvváltáskor a látható nézet újrarenderelése ──────
  function rerenderVisible() {
    if (document.getElementById('expiriesBox')) loadExpiries();
    if (document.getElementById('serviceLogBox')) loadServiceLog();
    if (document.getElementById('decontBox')) loadDecont();
    if (document.getElementById('fuelImportBox')) loadFuelImport();
    if (document.getElementById('dashExpiryAlert')) renderDashExpiryAlert();
  }
  if (window.I18N && typeof window.I18N.onLang === 'function') {
    window.I18N.onLang(rerenderVisible);
  }

  // ── Publikus API ────────────────────────────────────────
  window.FleetExtra = {
    load: function (name) {
      if (name === 'expiries') loadExpiries();
      else if (name === 'service-log') loadServiceLog();
      else if (name === 'decont') loadDecont();
      else if (name === 'fuel-import') loadFuelImport();
    },
    dashExpiryAlert: renderDashExpiryAlert,
    expEntityChange: expEntityChange, expSave: expSave, expEdit: expEdit, expDelete: expDelete,
    svSave: svSave, svDelete: svDelete,
    dcLoad: dcLoad, dcSaveRates: dcSaveRates, advSave: advSave, advDelete: advDelete,
    fcParse: fcParse, fcImport: fcImport,
  };
})();
