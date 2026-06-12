// ============================================================
//  VallorSoft — stats.js  (STATISZTIKA & RIPORT modul)
//  Admin + Manager konzol közös statisztika-fülei (stats-* panes).
//  Betöltés a HTML-ben: console-shared.js UTÁN (gas, esc, toast kell).
//  Grafikonok: Chart.js (CDN, már betöltve az oldalon).
//
//  Pénznemek: a fuvar-ár EUR-ban van (lásd fuvar-szerkesztő), a sofőr
//  által rögzített költségek (tankolás/kiadás) RON-ban — a kettőt NEM
//  vonjuk össze, mindenhol kiírjuk az egységet.
// ============================================================

(window.registerI18n||function(d){(window.__i18nQueue=window.__i18nQueue||[]).push(d);})({
  // szűrősáv / közös
  'stat.period': { hu: '📅 Időszak:', ro: '📅 Perioadă:' },
  'stat.preset.12m': { hu: 'Elmúlt 12 hónap', ro: 'Ultimele 12 luni' },
  'stat.preset.year': { hu: 'Idei év', ro: 'Anul curent' },
  'stat.preset.3m': { hu: 'Elmúlt 3 hónap', ro: 'Ultimele 3 luni' },
  'stat.preset.month': { hu: 'E hónap', ro: 'Luna curentă' },
  'stat.preset.prev': { hu: 'Előző hónap', ro: 'Luna precedentă' },
  'stat.preset.custom': { hu: 'Egyedi időszak', ro: 'Perioadă personalizată' },
  'stat.apply': { hu: 'Alkalmaz', ro: 'Aplică' },
  'stat.refresh': { hu: '🔄 Frissítés', ro: '🔄 Reîmprospătare' },
  'stat.loading': { hu: 'Betöltés...', ro: 'Se încarcă...' },
  'stat.error': { hu: 'Hiba', ro: 'Eroare' },
  'stat.errorOccurred': { hu: 'Hiba történt', ro: 'A apărut o eroare' },
  'stat.csvExport': { hu: '⬇️ CSV export', ro: '⬇️ Export CSV' },
  'stat.noDataPeriod': { hu: 'Nincs adat az időszakban.', ro: 'Nu există date în perioadă.' },
  'stat.noData': { hu: 'Nincs adat.', ro: 'Nu există date.' },

  // fizetés badge
  'stat.pay.paid': { hu: 'Fizetve', ro: 'Plătit' },
  'stat.pay.partial': { hu: 'Részben', ro: 'Parțial' },
  'stat.pay.unpaid': { hu: 'Kintlévő', ro: 'Restant' },

  // áttekintés
  'stat.alert.fuelOver': { hu: 'túlfogyasztás:', ro: 'consum excesiv:' },
  'stat.alert.nominal': { hu: 'névleges:', ro: 'nominal:' },
  'stat.alert.orders': { hu: 'fuvar', ro: 'curse' },
  'stat.alert.overdue': { hu: '30+ napja kintlévő — összesen', ro: 'restante de peste 30 zile — în total' },
  'stat.alert.toFinance': { hu: '→ Pénzügy', ro: '→ Finanțe' },
  'stat.rate.label': { hu: '💱 Árfolyam (1 EUR = ? RON):', ro: '💱 Curs valutar (1 EUR = ? RON):' },
  'stat.rate.phEg': { hu: 'pl. 4.97', ro: 'ex. 4.97' },
  'stat.rate.bnrTitle': { hu: 'A BNR hivatalos napi árfolyamának betöltése', ro: 'Încărcarea cursului oficial zilnic BNR' },
  'stat.save': { hu: 'Mentés', ro: 'Salvează' },
  'stat.rate.hint': { hu: 'Eredmény-számításhoz (EUR bevétel − RON költség). Üresen = nincs profit-számítás.', ro: 'Pentru calculul rezultatului (venit EUR − cost RON). Gol = fără calcul de profit.' },
  'stat.ov.noClosedOrders': { hu: 'Nincs lezárt fuvar az időszakban.', ro: 'Nu există curse finalizate în perioadă.' },
  'stat.tile.revenueClosed': { hu: 'Bevétel (lezárt fuvarok)', ro: 'Venit (curse finalizate)' },
  'stat.tile.closedOrders': { hu: 'Lezárt fuvar', ro: 'Curse finalizate' },
  'stat.tile.closedSub': { hu: 'kiírt,', ro: 'emise,' },
  'stat.tile.closedSub2': { hu: 'törölt', ro: 'anulate' },
  'stat.tile.kmDriven': { hu: 'Megtett km (menetlevelek)', ro: 'Km parcurși (foi de parcurs)' },
  'stat.tile.fleetAvgConsum': { hu: 'Flotta átlagfogyasztás', ro: 'Consum mediu flotă' },
  'stat.tile.diurnaDays': { hu: 'Diurna napok (külső / belső)', ro: 'Zile diurnă (extern / intern)' },
  'stat.tile.collected': { hu: 'Beszedett összeg', ro: 'Sumă încasată' },
  'stat.tile.receivables': { hu: 'Kintlévőség', ro: 'Creanțe' },
  'stat.tile.orders': { hu: 'fuvar', ro: 'curse' },
  'stat.tile.result': { hu: 'Eredmény (bevétel − sofőr-költségek,', ro: 'Rezultat (venit − costuri șoferi,' },
  'stat.tile.atRate': { hu: 'árfolyamon)', ro: 'la curs)' },
  'stat.panel.monthlyRevenue': { hu: '📈 Havi bevétel (EUR)', ro: '📈 Venit lunar (EUR)' },
  'stat.panel.monthlyCost': { hu: '💸 Havi költségek (RON) — tankolás + vásárlás', ro: '💸 Costuri lunare (RON) — alimentare + cumpărături' },
  'stat.panel.monthlyResult': { hu: '🎯 Havi eredmény (EUR,', ro: '🎯 Rezultat lunar (EUR,' },
  'stat.panel.monthlyResultEnd': { hu: 'árfolyamon)', ro: 'la curs)' },
  'stat.panel.topRoutes': { hu: '🗺️ Top útvonalak (lezárt fuvarok)', ro: '🗺️ Top rute (curse finalizate)' },
  'stat.th.route': { hu: 'Útvonal', ro: 'Rută' },
  'stat.th.order': { hu: 'Fuvar', ro: 'Cursă' },
  'stat.th.avgKm': { hu: 'Átlag km', ro: 'Km mediu' },
  'stat.th.avgPriceEur': { hu: 'Átlagár (EUR)', ro: 'Preț mediu (EUR)' },
  'stat.th.revenueEur': { hu: 'Bevétel (EUR)', ro: 'Venit (EUR)' },
  'stat.chart.revenueEur': { hu: 'Bevétel (EUR)', ro: 'Venit (EUR)' },
  'stat.chart.fuelRon': { hu: 'Üzemanyag (RON)', ro: 'Combustibil (RON)' },
  'stat.chart.purchasesRon': { hu: 'Vásárlások (RON)', ro: 'Cumpărături (RON)' },
  'stat.chart.resultEur': { hu: 'Eredmény (EUR)', ro: 'Rezultat (EUR)' },

  // pénzügy
  'stat.fin.noAccess': { hu: 'Nincs hozzáférésed a pénzügyi riporthoz', ro: 'Nu ai acces la raportul financiar' },
  'stat.fin.overdue': { hu: 'Lejárt', ro: 'Depășit' },
  'stat.fin.days': { hu: 'nap', ro: 'zile' },
  'stat.fin.payBtn': { hu: '💰 Fizetés', ro: '💰 Plată' },
  'stat.fin.noReceivables': { hu: 'Nincs kintlévőség. 🎉', ro: 'Nu există creanțe. 🎉' },
  'stat.tile.revenueClosedShort': { hu: 'Bevétel (lezárt)', ro: 'Venit (finalizat)' },
  'stat.tile.collectedShort': { hu: 'Beszedett', ro: 'Încasat' },
  'stat.tile.totalReceivables': { hu: 'Teljes kintlévőség', ro: 'Total creanțe' },
  'stat.tile.avgRatePerKm': { hu: 'Átlag fuvardíj / km', ro: 'Tarif mediu cursă / km' },
  'stat.tile.avgPayTime': { hu: 'Átlagos fizetési idő', ro: 'Termen mediu de plată' },
  'stat.panel.revVsCollected': { hu: '📊 Bevétel vs. beszedett (EUR / hó)', ro: '📊 Venit vs. încasat (EUR / lună)' },
  'stat.panel.agingTitle': { hu: '⏰ Kintlévőség öregedése (a teljesítés óta)', ro: '⏰ Vechimea creanțelor (de la finalizare)' },
  'stat.aging.0_30': { hu: '0–30 nap (EUR)', ro: '0–30 zile (EUR)' },
  'stat.aging.31_60': { hu: '31–60 nap (EUR)', ro: '31–60 zile (EUR)' },
  'stat.aging.60p': { hu: '60+ nap (EUR)', ro: '60+ zile (EUR)' },
  'stat.panel.overdueOrders': { hu: '📋 Kintlévő fuvarok', ro: '📋 Curse cu creanțe' },
  'stat.th.client': { hu: 'Ügyfél', ro: 'Client' },
  'stat.th.priceEur': { hu: 'Ár (EUR)', ro: 'Preț (EUR)' },
  'stat.th.paid': { hu: 'Fizetve', ro: 'Plătit' },
  'stat.th.balance': { hu: 'Hátralék', ro: 'Rest de plată' },
  'stat.th.completed': { hu: 'Teljesítve', ro: 'Finalizat' },
  'stat.th.due': { hu: 'Esedékes', ro: 'Scadent' },
  'stat.th.status': { hu: 'Státusz', ro: 'Status' },
  'stat.chart.collectedEur': { hu: 'Beszedett (EUR)', ro: 'Încasat (EUR)' },

  // fuvar-szintű eredmény
  'stat.profit.title': { hu: '🎯 Fuvar-szintű eredmény (a menetlevél-költségek fuvaronként szétosztva)', ro: '🎯 Rezultat pe cursă (costurile foilor de parcurs repartizate pe curse)' },
  'stat.profit.note': { hu: 'A tankolás/vásárlás-költség a menetlevélen szereplő fuvarok között egyenlően oszlik; az <b style="color:#fbbf24;">útdíj</b> (EUR) is levonódik az eredményből — közelítő érték.', ro: 'Costul de alimentare/cumpărături se împarte egal între cursele de pe foaia de parcurs; <b style="color:#fbbf24;">taxa de drum</b> (EUR) se scade și ea din rezultat — valoare aproximativă.' },
  'stat.profit.setRate': { hu: '<b>Állíts be árfolyamot az Áttekintésen az Eredmény-oszlophoz.</b>', ro: '<b>Setează cursul valutar în Prezentare generală pentru coloana Rezultat.</b>' },
  'stat.th.km': { hu: 'Km', ro: 'Km' },
  'stat.th.tollEur': { hu: 'Útdíj (EUR)', ro: 'Taxă drum (EUR)' },
  'stat.th.carrierEur': { hu: 'Alváll. (EUR)', ro: 'Subcontr. (EUR)' },
  'stat.th.costRon': { hu: 'Költség (RON)', ro: 'Cost (RON)' },
  'stat.th.resultEur': { hu: 'Eredmény (EUR)', ro: 'Rezultat (EUR)' },

  // fogyasztás
  'stat.fuel.noFill': { hu: 'Nincs tankolás az időszakban.', ro: 'Nu există alimentări în perioadă.' },
  'stat.tile.fueledDiesel': { hu: 'Tankolt motorină', ro: 'Motorină alimentată' },
  'stat.tile.fuelCost': { hu: 'Üzemanyag-költség', ro: 'Cost combustibil' },
  'stat.tile.avgPrice': { hu: 'Átlagár', ro: 'Preț mediu' },
  'stat.panel.monthlyFuel': { hu: '📊 Havi tankolás (RON)', ro: '📊 Alimentări lunare (RON)' },
  'stat.panel.payMethodFuel': { hu: '💳 Fizetési mód megoszlás (tankolás)', ro: '💳 Distribuție metodă de plată (alimentare)' },
  'stat.panel.consumByVeh': { hu: '🚛 Járművenkénti fogyasztás — tényleges vs. névleges', ro: '🚛 Consum pe vehicul — real vs. nominal' },
  'stat.th.plate': { hu: 'Rendszám', ro: 'Număr înmatriculare' },
  'stat.th.dieselL': { hu: 'Motorină (L)', ro: 'Motorină (L)' },
  'stat.th.actualConsum': { hu: 'Tényl. L/100km', ro: 'Real L/100km' },
  'stat.th.nominal': { hu: 'Névleges', ro: 'Nominal' },
  'stat.th.diff': { hu: 'Eltérés', ro: 'Diferență' },
  'stat.th.waybill': { hu: 'Menetlevél', ro: 'Foaie de parcurs' },
  'stat.panel.fills100': { hu: '🧾 Tankolások (utolsó 100)', ro: '🧾 Alimentări (ultimele 100)' },
  'stat.th.date': { hu: 'Dátum', ro: 'Dată' },
  'stat.th.driver': { hu: 'Sofőr', ro: 'Șofer' },
  'stat.th.vehicle': { hu: 'Jármű', ro: 'Vehicul' },
  'stat.th.place': { hu: 'Hely', ro: 'Locație' },
  'stat.th.type': { hu: 'Típus', ro: 'Tip' },
  'stat.th.liter': { hu: 'Liter', ro: 'Litri' },
  'stat.th.sumRon': { hu: 'Összeg (RON)', ro: 'Sumă (RON)' },
  'stat.th.payment': { hu: 'Fizetés', ro: 'Plată' },
  'stat.chart.dieselRon': { hu: 'Motorină (RON)', ro: 'Motorină (RON)' },
  'stat.chart.adblueRon': { hu: 'AdBlue (RON)', ro: 'AdBlue (RON)' },

  // vásárlások
  'stat.pur.noPurchase': { hu: 'Nincs vásárlás az időszakban.', ro: 'Nu există cumpărături în perioadă.' },
  'stat.tile.totalDriverSpend': { hu: 'Összes sofőr-költés', ro: 'Total cheltuieli șoferi' },
  'stat.tile.itemPurchase': { hu: 'Tétel (vásárlás)', ro: 'Articole (cumpărături)' },
  'stat.tile.ofWhichCash': { hu: 'Ebből készpénz (elszámolandó)', ro: 'Din care numerar (de decontat)' },
  'stat.panel.monthlySpend': { hu: '📊 Havi költés (RON)', ro: '📊 Cheltuieli lunare (RON)' },
  'stat.panel.topProducts': { hu: '🏷️ Top termékek / szolgáltatások', ro: '🏷️ Top produse / servicii' },
  'stat.panel.spendByDriver': { hu: '👤 Sofőrönkénti költés (RON)', ro: '👤 Cheltuieli pe șofer (RON)' },
  'stat.th.item': { hu: 'Tétel', ro: 'Articole' },
  'stat.panel.payMethod': { hu: '💳 Fizetési mód', ro: '💳 Metodă de plată' },
  'stat.panel.purchases100': { hu: '🧾 Vásárlások (utolsó 100)', ro: '🧾 Cumpărături (ultimele 100)' },
  'stat.th.product': { hu: 'Termék', ro: 'Produs' },
  'stat.th.priceRon': { hu: 'Ár (RON)', ro: 'Preț (RON)' },
  'stat.chart.spendRon': { hu: 'Költés (RON)', ro: 'Cheltuieli (RON)' },
  'stat.chart.sumRon': { hu: 'Összeg (RON)', ro: 'Sumă (RON)' },

  // sofőr teljesítmény
  'stat.panel.topDrivers': { hu: '🏆 Top sofőrök bevétel szerint (EUR)', ro: '🏆 Top șoferi după venit (EUR)' },
  'stat.panel.driverPerf': { hu: '👤 Sofőr teljesítmény-tábla', ro: '👤 Tabel performanță șoferi' },
  'stat.th.kmWaybill': { hu: 'Km (menetlevél)', ro: 'Km (foaie de parcurs)' },
  'stat.th.fuelRon': { hu: 'Üzemanyag (RON)', ro: 'Combustibil (RON)' },
  'stat.th.purchaseRon': { hu: 'Vásárlás (RON)', ro: 'Cumpărături (RON)' },
  'stat.th.closed': { hu: 'Lezárt', ro: 'Finalizate' },
  'stat.th.diurnaKB': { hu: 'Diurna K/B', ro: 'Diurnă E/I' },

  // jármű kihasználtság
  'stat.veh.idle': { hu: 'Álló', ro: 'Staționat' },
  'stat.veh.active': { hu: 'Aktív', ro: 'Activ' },
  'stat.panel.topVehicles': { hu: '🏆 Top járművek bevétel szerint (EUR)', ro: '🏆 Top vehicule după venit (EUR)' },
  'stat.panel.vehTable': { hu: '🚛 Jármű-tábla', ro: '🚛 Tabel vehicule' },
  'stat.th.state': { hu: 'Állapot', ro: 'Stare' },
  'stat.th.serviceRon': { hu: 'Szerviz (RON)', ro: 'Service (RON)' },

  // GPS km összehasonlítás
  'stat.panel.gpsKm': { hu: '🛰️ GPS-km vs. menetlevél-km (napi km-óra naplóból)', ro: '🛰️ Km GPS vs. km foaie de parcurs (din jurnalul zilnic de kilometraj)' },
  'stat.th.gpsKm': { hu: 'GPS-km', ro: 'Km GPS' },
  'stat.th.driverEntered': { hu: 'Sofőr beírta', ro: 'Introdus de șofer' },
  'stat.th.measureDays': { hu: 'Mérési napok', ro: 'Zile măsurate' },
  'stat.gpsKm.days': { hu: 'nap', ro: 'zile' },
  'stat.gpsKm.note': { hu: 'A GPS-km a napi automatikus km-óra snapshotokból számolódik — az első adatok a bekapcsolás utáni 2. naptól jelennek meg.', ro: 'Km GPS se calculează din instantaneele zilnice automate de kilometraj — primele date apar din a 2-a zi după activare.' },

  // GPS flotta snapshot
  'stat.gps.running': { hu: 'Jár', ro: 'Pornit' },
  'stat.gps.stopped': { hu: 'Áll', ro: 'Oprit' },
  'stat.panel.liveFleet': { hu: '🛰️ Élő flotta-adatok (CargoTrack GPS)', ro: '🛰️ Date flotă în timp real (CargoTrack GPS)' },
  'stat.th.ignition': { hu: 'Gyújtás', ro: 'Contact' },
  'stat.th.speed': { hu: 'Sebesség', ro: 'Viteză' },
  'stat.th.fuelLevel': { hu: 'Üzemanyag-szint', ro: 'Nivel combustibil' },
  'stat.th.odoGps': { hu: 'Km-óra (GPS)', ro: 'Kilometraj (GPS)' },
  'stat.th.consumption': { hu: 'Fogyasztás', ro: 'Consum' },
  'stat.th.lastSignal': { hu: 'Utolsó jel', ro: 'Ultimul semnal' },
  'stat.gps.note': { hu: 'Az üzemanyag-szint / km-óra csak akkor jelenik meg, ha a GPS-eszköz méri (CAN-bus kapcsolat).', ro: 'Nivelul de combustibil / kilometrajul apare doar dacă dispozitivul GPS le măsoară (conexiune CAN-bus).' },

  // ügyfél riport
  'stat.cli.anafActive': { hu: 'ANAF aktív', ro: 'ANAF activ' },
  'stat.cli.anafInactive': { hu: 'ANAF inaktív', ro: 'ANAF inactiv' },
  'stat.panel.topClients': { hu: '🏆 Top ügyfelek bevétel szerint (EUR)', ro: '🏆 Top clienți după venit (EUR)' },
  'stat.panel.clientTable': { hu: '🤝 Ügyfél-tábla', ro: '🤝 Tabel clienți' },
  'stat.th.receivableEur': { hu: 'Kintlévő (EUR)', ro: 'Creanță (EUR)' },
  'stat.th.avgPayTime': { hu: 'Átl. fizetési idő', ro: 'Termen mediu plată' },

  // jogosultságok
  'stat.perm.noManager': { hu: 'Nincs Manager felhasználó a cégben.', ro: 'Nu există utilizator Manager în firmă.' },
  'stat.perm.financeVisible': { hu: 'Pénzügy látható', ro: 'Finanțe vizibil' },
  'stat.perm.title': { hu: '🔐 Pénzügyi riport láthatósága', ro: '🔐 Vizibilitatea raportului financiar' },
  'stat.perm.intro': { hu: 'Itt adhatsz engedélyt a Manager munkatársaknak a <b>Pénzügy</b> riport (bevétel, beszedett, kintlévőség) megtekintésére. Admin mindig lát mindent; engedély nélkül a Manager a Pénzügy fület és a pénzügyi oszlopokat nem látja.', ro: 'Aici poți acorda permisiune colegilor Manager să vadă raportul <b>Finanțe</b> (venit, încasat, creanțe). Adminul vede întotdeauna totul; fără permisiune, Managerul nu vede fila Finanțe și coloanele financiare.' },
  'stat.th.name': { hu: 'Név', ro: 'Nume' },
  'stat.th.email': { hu: 'E-mail', ro: 'E-mail' },
  'stat.th.position': { hu: 'Pozíció', ro: 'Funcție' },
  'stat.th.permission': { hu: 'Engedély', ro: 'Permisiune' },
  'stat.perm.granted': { hu: '✅ Engedély megadva', ro: '✅ Permisiune acordată' },
  'stat.perm.revoked': { hu: 'Engedély visszavonva', ro: 'Permisiune revocată' },

  // CSV / toast
  'stat.csv.loadFirst': { hu: 'Előbb töltsd be az adatokat!', ro: 'Încarcă mai întâi datele!' },
  'stat.csv.h.order': { hu: 'Fuvar', ro: 'Cursă' },
  'stat.csv.h.client': { hu: 'Ügyfél', ro: 'Client' },
  'stat.csv.h.priceEur': { hu: 'Ár (EUR)', ro: 'Preț (EUR)' },
  'stat.csv.h.paid': { hu: 'Fizetve', ro: 'Plătit' },
  'stat.csv.h.balance': { hu: 'Hátralék', ro: 'Rest de plată' },
  'stat.csv.h.completed': { hu: 'Teljesítve', ro: 'Finalizat' },
  'stat.csv.h.daysElapsed': { hu: 'Eltelt nap', ro: 'Zile scurse' },
  'stat.csv.h.status': { hu: 'Státusz', ro: 'Status' },
  'stat.csv.h.date': { hu: 'Dátum', ro: 'Dată' },
  'stat.csv.h.driver': { hu: 'Sofőr', ro: 'Șofer' },
  'stat.csv.h.vehicle': { hu: 'Jármű', ro: 'Vehicul' },
  'stat.csv.h.place': { hu: 'Hely', ro: 'Locație' },
  'stat.csv.h.type': { hu: 'Típus', ro: 'Tip' },
  'stat.csv.h.liter': { hu: 'Liter', ro: 'Litri' },
  'stat.csv.h.sumRon': { hu: 'Összeg (RON)', ro: 'Sumă (RON)' },
  'stat.csv.h.payment': { hu: 'Fizetés', ro: 'Plată' },
  'stat.csv.h.product': { hu: 'Termék', ro: 'Produs' },
  'stat.csv.h.priceRon': { hu: 'Ár (RON)', ro: 'Preț (RON)' },
  'stat.csv.h.email': { hu: 'E-mail', ro: 'E-mail' },
  'stat.csv.h.kmWaybill': { hu: 'Km (menetlevél)', ro: 'Km (foaie de parcurs)' },
  'stat.csv.h.fuelRon': { hu: 'Üzemanyag (RON)', ro: 'Combustibil (RON)' },
  'stat.csv.h.purchaseRon': { hu: 'Vásárlás (RON)', ro: 'Cumpărături (RON)' },
  'stat.csv.h.resultEur': { hu: 'Eredmény (EUR)', ro: 'Rezultat (EUR)' },
  'stat.csv.h.diurnaExt': { hu: 'Diurna külső', ro: 'Diurnă extern' },
  'stat.csv.h.diurnaInt': { hu: 'Diurna belső', ro: 'Diurnă intern' },
  'stat.csv.h.waybill': { hu: 'Menetlevél', ro: 'Foaie de parcurs' },
  'stat.csv.h.closed': { hu: 'Lezárt', ro: 'Finalizate' },
  'stat.csv.h.revenueEur': { hu: 'Bevétel (EUR)', ro: 'Venit (EUR)' },
  'stat.csv.h.plate': { hu: 'Rendszám', ro: 'Număr înmatriculare' },
  'stat.csv.h.brand': { hu: 'Márka', ro: 'Marcă' },
  'stat.csv.h.serviceRon': { hu: 'Szerviz (RON)', ro: 'Service (RON)' },
  'stat.csv.h.nominal': { hu: 'Névleges', ro: 'Nominal' },
  'stat.csv.h.cui': { hu: 'CUI', ro: 'CUI' },
  'stat.csv.h.km': { hu: 'Km', ro: 'Km' },
  'stat.csv.h.receivableEur': { hu: 'Kintlévő (EUR)', ro: 'Creanță (EUR)' },
  'stat.csv.h.avgPayDays': { hu: 'Átl. fizetési nap', ro: 'Zile medii de plată' },

  // setPreset / saveRate / fetchBnr
  'stat.dateRangeReq': { hu: 'Add meg a kezdő és záró dátumot!', ro: 'Introdu data de început și de sfârșit!' },
  'stat.rateSaved': { hu: '💱 Árfolyam mentve', ro: '💱 Curs valutar salvat' },
  'stat.bnrTodayDefault': { hu: 'ma', ro: 'azi' },
  'stat.bnrToast': { hu: '🏦 BNR árfolyam', ro: '🏦 Curs BNR' },
  'stat.bnrToastClick': { hu: '— kattints a Mentésre!', ro: '— apasă pe Salvează!' },
  'stat.bnrUnavailable': { hu: 'A BNR nem elérhető', ro: 'BNR indisponibil' }
});

(function () {
  'use strict';

  function T(k, v) { return (typeof window.t === 'function') ? window.t(k, v) : k; }

  // ── Állapot ─────────────────────────────────────────────
  var _stCharts = {};        // canvasId -> Chart példány (újrarajzolásnál destroy)
  var _stData = {};          // pane -> utolsó szerver-válasz (CSV exporthoz)
  var _stPerms = { finance: false, loaded: false };
  var _stRange = { preset: '12m', from: null, to: null };

  // ── Segédek ─────────────────────────────────────────────
  function stNum(x, dec) {
    var n = parseFloat(x);
    if (!isFinite(n)) return '—';
    return n.toLocaleString('hu-HU', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 2 : dec });
  }
  function stDate(d) { return d ? new Date(d).toLocaleDateString('hu-HU') : '—'; }

  function stRangeDates() {
    var now = new Date();
    var from, to = new Date(now);
    function ymd(d) { return d.toISOString().slice(0, 10); }
    switch (_stRange.preset) {
      case 'month':  from = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'prev':   from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                     to = new Date(now.getFullYear(), now.getMonth(), 0); break;
      case '3m':     from = new Date(now.getFullYear(), now.getMonth() - 3, 1); break;
      case 'year':   from = new Date(now.getFullYear(), 0, 1); break;
      case 'custom': return { from: _stRange.from, to: _stRange.to };
      case '12m':
      default:       from = new Date(now.getFullYear(), now.getMonth() - 12, 1); break;
    }
    return { from: ymd(from), to: ymd(to) };
  }

  // Közös szűrősáv (időszak) — minden stats-pane tetején
  function stFilterBar(pane) {
    var presets = [
      ['12m', T('stat.preset.12m')], ['year', T('stat.preset.year')], ['3m', T('stat.preset.3m')],
      ['month', T('stat.preset.month')], ['prev', T('stat.preset.prev')], ['custom', T('stat.preset.custom')]
    ];
    var r = stRangeDates();
    return '<div class="glass" style="padding:12px 16px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
      + '<span class="text-muted" style="font-size:12px;font-weight:700;">' + T('stat.period') + '</span>'
      + '<select class="select" style="max-width:190px;padding:8px 10px;font-size:13px;" onchange="VS_STATS.setPreset(this.value,\'' + pane + '\')">'
      + presets.map(function (p) { return '<option value="' + p[0] + '"' + (_stRange.preset === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('')
      + '</select>'
      + '<span id="stCustomRange" style="display:' + (_stRange.preset === 'custom' ? 'inline-flex' : 'none') + ';gap:8px;align-items:center;">'
      + '<input class="input" type="date" id="stFrom" value="' + (r.from || '') + '" style="padding:7px 10px;font-size:13px;max-width:150px;">'
      + '<span class="text-muted">→</span>'
      + '<input class="input" type="date" id="stTo" value="' + (r.to || '') + '" style="padding:7px 10px;font-size:13px;max-width:150px;">'
      + '<button class="btn primary" style="padding:7px 14px;font-size:12px;" onclick="VS_STATS.applyCustom(\'' + pane + '\')">' + T('stat.apply') + '</button>'
      + '</span>'
      + '<span style="margin-left:auto;"></span>'
      + '<button class="btn ghost" style="padding:7px 14px;font-size:12px;" onclick="VS_STATS.load(\'' + pane + '\')">' + T('stat.refresh') + '</button>'
      + '</div>';
  }

  function stTile(ico, val, lbl, color) {
    return '<div class="glass stat-tile"><div class="stat-ico">' + ico + '</div>'
      + '<div><div class="stat-val text-primary" style="' + (color ? 'color:' + color + ' !important;' : '') + '">' + val + '</div>'
      + '<div class="stat-lbl text-muted">' + lbl + '</div></div></div>';
  }

  function stPanel(title, bodyHtml, extraHead) {
    return '<div class="glass" style="padding:18px;margin-bottom:14px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">'
      + '<div class="text-primary" style="font-size:15px;font-weight:700;">' + title + '</div>'
      + (extraHead || '')
      + '</div>' + bodyHtml + '</div>';
  }

  function stChartCanvas(id, h) {
    return '<div style="position:relative;height:' + (h || 260) + 'px;"><canvas id="' + id + '"></canvas></div>';
  }

  // Chart.js példány létrehozás — a korábbi azonos canvasen lévőt eldobjuk
  function stChart(id, cfg) {
    var el = document.getElementById(id);
    if (!el || typeof Chart === 'undefined') return;
    if (_stCharts[id]) { try { _stCharts[id].destroy(); } catch (e) {} }
    cfg.options = cfg.options || {};
    cfg.options.responsive = true;
    cfg.options.maintainAspectRatio = false;
    cfg.options.plugins = cfg.options.plugins || {};
    if (!cfg.options.plugins.legend) cfg.options.plugins.legend = { labels: { color: '#8a97a8', boxWidth: 12, font: { size: 11 } } };
    if (cfg.type !== 'doughnut' && cfg.type !== 'pie') {
      cfg.options.scales = cfg.options.scales || {};
      ['x', 'y'].forEach(function (ax) {
        cfg.options.scales[ax] = Object.assign({
          ticks: { color: '#8a97a8', font: { size: 11 } },
          grid: { color: 'rgba(138,151,168,0.12)' }
        }, cfg.options.scales[ax] || {});
      });
    }
    _stCharts[id] = new Chart(el.getContext('2d'), cfg);
  }

  // Hónap-tengely összefésülés több sorozatból: [{ho:'YYYY-MM',...}] tömbökből
  function stMonths(arrays) {
    var set = {};
    arrays.forEach(function (a) { (a || []).forEach(function (r) { set[r.ho] = true; }); });
    return Object.keys(set).sort();
  }
  function stSeries(months, rows, key) {
    var m = {}; (rows || []).forEach(function (r) { m[r.ho] = parseFloat(r[key]) || 0; });
    return months.map(function (ho) { return m[ho] || 0; });
  }

  // CSV export (UTF-8 BOM — Excel-kompatibilis)
  function stCsv(filename, headers, rows) {
    var lines = [headers.join(';')].concat(rows.map(function (r) {
      return r.map(function (c) {
        var s = String(c == null ? '' : c).replace(/"/g, '""');
        return /[;"\n]/.test(s) ? '"' + s + '"' : s;
      }).join(';');
    }));
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  var PAY_BADGE_K = {
    paid:    { cls: 'ok',   k: 'stat.pay.paid' },
    partial: { cls: 'warn', k: 'stat.pay.partial' },
    unpaid:  { cls: 'err',  k: 'stat.pay.unpaid' }
  };
  function payBadge(status) {
    var b = PAY_BADGE_K[status];
    return b ? '<span class="badge ' + b.cls + '">' + T(b.k) + '</span>' : '';
  }

  // ── Jogosultság: a Pénzügy fül láthatósága (admin adja) ──
  function applyPerms(cb) {
    if (_stPerms.loaded) { if (cb) cb(); return; }
    if (!window.gas) { if (cb) cb(); return; }
    gas('getMyStatsPermissions').then(function (r) {
      _stPerms.loaded = true;
      _stPerms.finance = !!(r && r.ok && r.finance);
      if (!_stPerms.finance) {
        document.querySelectorAll('.sidebar [data-tab="stats-finance"]').forEach(function (el) { el.style.display = 'none'; });
      }
      if (cb) cb();
    }).catch(function () { if (cb) cb(); });
  }

  // ════════════════════════════════════════════════════════
  //  1) ÁTTEKINTÉS (stats-overview)
  // ════════════════════════════════════════════════════════
  function loadOverview() {
    var box = document.getElementById('statsOverviewBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-overview') + '<div class="text-muted" style="padding:30px;text-align:center;">' + T('stat.loading') + '</div>';
    gas('getStatsOverview', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-overview') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || T('stat.error')) + '</div>'; return; }
      _stData['stats-overview'] = r;
      var k = r.kpi, fin = r.finance;
      var rate = parseFloat(r.eur_ron_rate) || null;

      // Eredmény (profit) — csak beállított árfolyammal: EUR bevétel − RON költség/árfolyam
      var ktgTotalRon = (r.havi_koltseg || []).reduce(function (s, h) {
        return s + (parseFloat(h.uzemanyag) || 0) + (parseFloat(h.vasarlas) || 0);
      }, 0);
      var eredmeny = rate ? (parseFloat(k.bevetel) || 0) - ktgTotalRon / rate : null;

      // Riasztások (túlfogyasztás / lejárt kintlévőség)
      var alertsHtml = '';
      (r.alerts || []).forEach(function (a) {
        if (a.type === 'fuel') {
          alertsHtml += '<div style="display:flex;gap:8px;align-items:center;padding:8px 12px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.35);border-radius:10px;font-size:13px;">'
            + '⛽ <b class="text-primary">' + esc(a.rendszam) + '</b>&nbsp;' + T('stat.alert.fuelOver') + ' <b style="color:var(--status-warn);">'
            + stNum(a.consum, 1) + ' L/100km</b>&nbsp;<span class="text-muted">(' + T('stat.alert.nominal') + ' ' + stNum(a.nevleges, 1) + ')</span></div>';
        } else if (a.type === 'overdue') {
          alertsHtml += '<div style="display:flex;gap:8px;align-items:center;padding:8px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.35);border-radius:10px;font-size:13px;cursor:pointer;" onclick="activateTab(\'stats-finance\')">'
            + '⏰ <b style="color:var(--status-danger);">' + stNum(a.db, 0) + ' ' + T('stat.alert.orders') + '</b>&nbsp;' + T('stat.alert.overdue') + ' <b style="color:var(--status-danger);">'
            + stNum(a.osszeg, 0) + ' EUR</b>&nbsp;<span class="text-muted">' + T('stat.alert.toFinance') + '</span></div>';
        }
      });
      if (alertsHtml) alertsHtml = '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">' + alertsHtml + '</div>';

      // Árfolyam-beállító (csak Admin) — az eredmény-számításhoz
      var rateRow = '';
      if (typeof VS_ROLE !== 'undefined' && VS_ROLE === 'admin') {
        rateRow = '<div class="glass" style="padding:10px 16px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
          + '<span class="text-muted" style="font-size:12px;font-weight:700;">' + T('stat.rate.label') + '</span>'
          + '<input class="input" id="stEurRon" type="number" step="0.0001" min="0" value="' + (rate || '') + '" placeholder="' + T('stat.rate.phEg') + '" style="max-width:120px;padding:7px 10px;font-size:13px;">'
          + '<button class="btn ghost" style="padding:7px 12px;font-size:12px;" title="' + T('stat.rate.bnrTitle') + '" onclick="VS_STATS.fetchBnr()">🏦 BNR</button>'
          + '<button class="btn primary" style="padding:7px 14px;font-size:12px;" onclick="VS_STATS.saveRate()">' + T('stat.save') + '</button>'
          + '<span class="text-muted" style="font-size:11px;">' + T('stat.rate.hint') + '</span>'
          + '</div>';
      }

      // Top útvonalak tábla
      var utvRows = (r.top_utvonalak || []).map(function (u) {
        return '<tr><td>' + esc(u.loc_incarcare) + ' <span class="text-muted">→</span> ' + esc(u.loc_descarcare) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(u.db, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(u.atlag_km, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(u.atlag_ar, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(u.bevetel, 0) + '</td></tr>';
      }).join('') || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:14px;">' + T('stat.ov.noClosedOrders') + '</td></tr>';

      var tiles =
        stTile('💶', stNum(k.bevetel, 0) + ' <span style="font-size:13px;">EUR</span>', T('stat.tile.revenueClosed'))
        + stTile('📦', stNum(k.lezart, 0), T('stat.tile.closedOrders') + ' (' + stNum(k.osszes, 0) + ' ' + T('stat.tile.closedSub') + ' ' + stNum(k.torolt, 0) + ' ' + T('stat.tile.closedSub2') + ')')
        + stTile('🛣️', stNum(k.fuvarlevel_km, 0) + ' km', T('stat.tile.kmDriven'))
        + stTile('⛽', stNum(k.consum_100, 1) + ' L/100km', T('stat.tile.fleetAvgConsum'))
        + stTile('🗓️', stNum(k.diurna_ext, 0) + ' / ' + stNum(k.diurna_int, 0), T('stat.tile.diurnaDays'));
      if (fin) {
        tiles += stTile('💰', stNum(fin.beszedett, 0) + ' <span style="font-size:13px;">EUR</span>', T('stat.tile.collected'), 'var(--status-ok)')
          + stTile('⏳', stNum(fin.kintlevo, 0) + ' <span style="font-size:13px;">EUR</span>', T('stat.tile.receivables') + ' (' + stNum(fin.kintlevo_db, 0) + ' ' + T('stat.tile.orders') + ')', 'var(--status-danger)');
      }
      if (eredmeny != null) {
        tiles += stTile('🎯', stNum(eredmeny, 0) + ' <span style="font-size:13px;">EUR</span>',
          T('stat.tile.result') + ' ' + stNum(rate, 2) + ' ' + T('stat.tile.atRate'),
          eredmeny >= 0 ? 'var(--status-ok)' : 'var(--status-danger)');
      }
      box.innerHTML = stFilterBar('stats-overview')
        + alertsHtml
        + rateRow
        + '<div class="dash-stats" style="margin-bottom:16px;">' + tiles + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;">'
        + stPanel(T('stat.panel.monthlyRevenue'), stChartCanvas('stChOvBevetel'))
        + stPanel(T('stat.panel.monthlyCost'), stChartCanvas('stChOvKoltseg'))
        + (rate ? stPanel(T('stat.panel.monthlyResult') + ' ' + stNum(rate, 2) + ' ' + T('stat.panel.monthlyResultEnd') + ')', stChartCanvas('stChOvEredmeny')) : '')
        + stPanel(T('stat.panel.topRoutes'),
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + T('stat.th.route') + '</th><th style="text-align:right;">' + T('stat.th.order') + '</th><th style="text-align:right;">' + T('stat.th.avgKm') + '</th><th style="text-align:right;">' + T('stat.th.avgPriceEur') + '</th><th style="text-align:right;">' + T('stat.th.revenueEur') + '</th></tr></thead>'
            + '<tbody>' + utvRows + '</tbody></table></div>')
        + '</div>';

      var months = stMonths([r.havi_bevetel, r.havi_koltseg]);
      stChart('stChOvBevetel', {
        type: 'line',
        data: { labels: months, datasets: [{
          label: T('stat.chart.revenueEur'), data: stSeries(months, r.havi_bevetel, 'osszeg'),
          borderColor: '#e10b1a', backgroundColor: 'rgba(225,11,26,0.15)', fill: true, tension: 0.3
        }]}
      });
      stChart('stChOvKoltseg', {
        type: 'bar',
        data: { labels: months, datasets: [
          { label: T('stat.chart.fuelRon'), data: stSeries(months, r.havi_koltseg, 'uzemanyag'), backgroundColor: 'rgba(245,158,11,0.7)', stack: 'k' },
          { label: T('stat.chart.purchasesRon'), data: stSeries(months, r.havi_koltseg, 'vasarlas'), backgroundColor: 'rgba(59,130,246,0.7)', stack: 'k' }
        ]},
        options: { scales: { x: { stacked: true }, y: { stacked: true } } }
      });
      if (rate) {
        var bev = stSeries(months, r.havi_bevetel, 'osszeg');
        var uz = stSeries(months, r.havi_koltseg, 'uzemanyag');
        var va = stSeries(months, r.havi_koltseg, 'vasarlas');
        var profit = months.map(function (_, i) { return Math.round(bev[i] - (uz[i] + va[i]) / rate); });
        stChart('stChOvEredmeny', {
          type: 'bar',
          data: { labels: months, datasets: [{
            label: T('stat.chart.resultEur'), data: profit,
            backgroundColor: profit.map(function (v) { return v >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)'; })
          }]}
        });
      }
    });
  }

  // ════════════════════════════════════════════════════════
  //  2) PÉNZÜGY (stats-finance) — jogosultsághoz kötött
  // ════════════════════════════════════════════════════════
  function loadFinance() {
    var box = document.getElementById('statsFinanceBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-finance') + '<div class="text-muted" style="padding:30px;text-align:center;">' + T('stat.loading') + '</div>';
    gas('getFinanceStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) {
        box.innerHTML = stFilterBar('stats-finance')
          + '<div class="glass" style="padding:40px;text-align:center;">'
          + '<div style="font-size:36px;margin-bottom:10px;">🔒</div>'
          + '<div class="text-primary" style="font-weight:700;margin-bottom:6px;">' + T('stat.fin.noAccess') + '</div>'
          + '<div class="text-muted" style="font-size:13px;">' + esc((r && r.err) || T('stat.errorOccurred')) + '</div></div>';
        return;
      }
      _stData['stats-finance'] = r;
      var m = r.mutatok, ag = r.aging;
      var kintlevoTotal = (parseFloat(ag.d0_30) || 0) + (parseFloat(ag.d31_60) || 0) + (parseFloat(ag.d60p) || 0);
      var beszedett = (r.havi || []).reduce(function (s, x) { return s + (parseFloat(x.beszedett) || 0); }, 0);

      var listRows = (r.kintlevo_lista || []).map(function (o) {
        var marad = (parseFloat(o.pret) || 0) - (parseFloat(o.paid_amount) || 0);
        return '<tr>'
          + '<td><b class="text-primary">' + esc(String(o.id)) + '</b></td>'
          + '<td>' + esc(o.client || '—') + '</td>'
          + '<td style="text-align:right;">' + stNum(o.pret, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(o.paid_amount, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;color:var(--status-danger);">' + stNum(marad, 0) + '</td>'
          + '<td>' + stDate(o.finalized_at) + '</td>'
          + '<td style="text-align:center;">' + stDate(o.esedekes)
          + (o.lejart ? ' <span class="badge err">' + T('stat.fin.overdue') + '</span>' : ' <span class="badge warn">' + stNum(o.napok, 0) + ' ' + T('stat.fin.days') + '</span>') + '</td>'
          + '<td>' + payBadge(o.payment_status) + '</td>'
          + '<td><button class="btn ok" style="padding:4px 10px;font-size:12px;" '
          + 'onclick="openPaymentModal(\'' + esc(String(o.id)) + '\',' + (parseFloat(o.pret) || 0) + ',' + (parseFloat(o.paid_amount) || 0) + ')">' + T('stat.fin.payBtn') + '</button></td>'
          + '</tr>';
      }).join('') || '<tr><td colspan="9" class="text-muted" style="text-align:center;padding:18px;">' + T('stat.fin.noReceivables') + '</td></tr>';

      box.innerHTML = stFilterBar('stats-finance')
        + '<div class="dash-stats" style="margin-bottom:16px;">'
        + stTile('💶', stNum(m.bevetel, 0) + ' <span style="font-size:13px;">EUR</span>', T('stat.tile.revenueClosedShort'))
        + stTile('💰', stNum(beszedett, 0) + ' <span style="font-size:13px;">EUR</span>', T('stat.tile.collectedShort'), 'var(--status-ok)')
        + stTile('⏳', stNum(kintlevoTotal, 0) + ' <span style="font-size:13px;">EUR</span>', T('stat.tile.totalReceivables'), 'var(--status-danger)')
        + stTile('📏', stNum(m.per_km, 2) + ' EUR/km', T('stat.tile.avgRatePerKm'))
        + stTile('⌛', m.atlag_fizetesi_nap != null ? stNum(m.atlag_fizetesi_nap, 0) + ' ' + T('stat.fin.days') : '—', T('stat.tile.avgPayTime'))
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;">'
        + stPanel(T('stat.panel.revVsCollected'), stChartCanvas('stChFinHavi'))
        + stPanel(T('stat.panel.agingTitle'),
            '<div class="dash-veh-grid">'
            + '<div class="dash-mini glass-soft"><div style="font-size:20px;">🟢</div><div style="font-size:22px;font-weight:800;color:var(--status-warn);">' + stNum(ag.d0_30, 0) + '</div><div class="text-muted" style="font-size:11px;">' + T('stat.aging.0_30') + '</div></div>'
            + '<div class="dash-mini glass-soft"><div style="font-size:20px;">🟠</div><div style="font-size:22px;font-weight:800;color:var(--status-warn);">' + stNum(ag.d31_60, 0) + '</div><div class="text-muted" style="font-size:11px;">' + T('stat.aging.31_60') + '</div></div>'
            + '<div class="dash-mini glass-soft"><div style="font-size:20px;">🔴</div><div style="font-size:22px;font-weight:800;color:var(--status-danger);">' + stNum(ag.d60p, 0) + '</div><div class="text-muted" style="font-size:11px;">' + T('stat.aging.60p') + '</div></div>'
            + '</div>')
        + '</div>'
        + stPanel(T('stat.panel.overdueOrders'), '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + T('stat.th.order') + '</th><th>' + T('stat.th.client') + '</th><th style="text-align:right;">' + T('stat.th.priceEur') + '</th><th style="text-align:right;">' + T('stat.th.paid') + '</th><th style="text-align:right;">' + T('stat.th.balance') + '</th><th>' + T('stat.th.completed') + '</th><th style="text-align:center;">' + T('stat.th.due') + '</th><th>' + T('stat.th.status') + '</th><th></th></tr></thead>'
            + '<tbody>' + listRows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-finance\')">' + T('stat.csvExport') + '</button>')
        + '<div id="stProfitBox"></div>';

      loadOrderProfit();

      var months = stMonths([r.havi]);
      stChart('stChFinHavi', {
        type: 'bar',
        data: { labels: months, datasets: [
          { label: T('stat.chart.revenueEur'), data: stSeries(months, r.havi, 'bevetel'), backgroundColor: 'rgba(225,11,26,0.65)' },
          { label: T('stat.chart.collectedEur'), data: stSeries(months, r.havi, 'beszedett'), backgroundColor: 'rgba(34,197,94,0.65)' }
        ]}
      });
    });
  }

  // Fuvar-szintű eredmény (a menetlevél-költségek fuvarokra osztva)
  function loadOrderProfit() {
    var box = document.getElementById('stProfitBox');
    if (!box) return;
    gas('getOrderProfit', stRangeDates()).then(function (r) {
      if (!r || !r.ok || !(r.rows || []).length) { box.innerHTML = ''; return; }
      var rate = parseFloat(r.eur_ron_rate) || null;
      var rows = r.rows.map(function (o) {
        var ktg = parseFloat(o.koltseg_ron) || 0;
        var toll = parseFloat(o.toll_cost) || 0;
        var carrier = parseFloat(o.carrier_cost) || 0;
        var profitCell = '';
        if (rate) {
          var p = (parseFloat(o.pret) || 0) - ktg / rate - toll - carrier;
          profitCell = '<td style="text-align:right;font-weight:700;color:' + (p >= 0 ? 'var(--status-ok)' : 'var(--status-danger)') + ';">' + stNum(p, 0) + '</td>';
        }
        return '<tr><td><b class="text-primary">' + esc(String(o.id)) + '</b></td>'
          + '<td>' + esc(o.client || '—') + '</td>'
          + '<td>' + stDate(o.finalized_at) + '</td>'
          + '<td style="text-align:right;">' + stNum(o.km, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(o.pret, 0) + '</td>'
          + '<td style="text-align:right;color:' + (toll > 0 ? '#fbbf24' : 'inherit') + ';">' + (toll > 0 ? stNum(toll, 0) : '—') + '</td>'
          + '<td style="text-align:right;color:' + (carrier > 0 ? '#ff6b75' : 'inherit') + ';">' + (carrier > 0 ? stNum(carrier, 0) : '—') + '</td>'
          + '<td style="text-align:right;">' + stNum(ktg, 0) + '</td>'
          + profitCell + '</tr>';
      }).join('');
      box.innerHTML = stPanel(T('stat.profit.title'),
        '<p class="text-muted" style="font-size:12px;margin:0 0 10px;">' + T('stat.profit.note')
        + (rate ? '' : ' ' + T('stat.profit.setRate')) + '</p>'
        + '<div style="overflow-x:auto;"><table class="table">'
        + '<thead><tr><th>' + T('stat.th.order') + '</th><th>' + T('stat.th.client') + '</th><th>' + T('stat.th.completed') + '</th><th style="text-align:right;">' + T('stat.th.km') + '</th><th style="text-align:right;">' + T('stat.th.revenueEur') + '</th><th style="text-align:right;">' + T('stat.th.tollEur') + '</th><th style="text-align:right;">' + T('stat.th.carrierEur') + '</th><th style="text-align:right;">' + T('stat.th.costRon') + '</th>'
        + (rate ? '<th style="text-align:right;">' + T('stat.th.resultEur') + '</th>' : '') + '</tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>');
    }).catch(function () { box.innerHTML = ''; });
  }

  // ════════════════════════════════════════════════════════
  //  3) FOGYASZTÁS (stats-fuel)
  // ════════════════════════════════════════════════════════
  function loadFuel() {
    var box = document.getElementById('statsFuelBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-fuel') + '<div class="text-muted" style="padding:30px;text-align:center;">' + T('stat.loading') + '</div>';
    gas('getFuelStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-fuel') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || T('stat.error')) + '</div>'; return; }
      _stData['stats-fuel'] = r;

      var totL = 0, totS = 0;
      (r.havi || []).forEach(function (h) { if (h.tip !== 'AdBlue') { totL += parseFloat(h.litru) || 0; totS += parseFloat(h.suma) || 0; } });
      var avgPrice = totL > 0 ? totS / totL : 0;
      var totKm = 0, totMot = 0;
      (r.jarmuvek || []).forEach(function (j) { totKm += parseFloat(j.km) || 0; totMot += parseFloat(j.motorina) || 0; });
      var fleetAvg = totKm > 0 ? (totMot / totKm) * 100 : 0;

      var vehRows = (r.jarmuvek || []).map(function (j) {
        var consum = (parseFloat(j.km) > 0) ? (parseFloat(j.motorina) / parseFloat(j.km)) * 100 : 0;
        var nevleges = parseFloat(j.nevleges) || 0;
        var diffBadge = '—';
        if (nevleges > 0 && consum > 0) {
          var diff = ((consum - nevleges) / nevleges) * 100;
          var cls = diff > 10 ? 'err' : diff > 0 ? 'warn' : 'ok';
          diffBadge = '<span class="badge ' + cls + '">' + (diff >= 0 ? '+' : '') + stNum(diff, 1) + '%</span>';
        }
        return '<tr><td><b class="text-primary">' + esc(j.rendszam || '—') + '</b></td>'
          + '<td style="text-align:right;">' + stNum(j.km, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(j.motorina, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + (consum > 0 ? stNum(consum, 1) : '—') + '</td>'
          + '<td style="text-align:right;">' + (nevleges > 0 ? stNum(nevleges, 1) : '—') + '</td>'
          + '<td style="text-align:center;">' + diffBadge + '</td>'
          + '<td style="text-align:right;">' + stNum(j.menetlevelek, 0) + '</td></tr>';
      }).join('') || '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:18px;">' + T('stat.noDataPeriod') + '</td></tr>';

      var fillRows = (r.lista || []).map(function (a) {
        return '<tr><td>' + stDate(a.data_completare) + '</td>'
          + '<td>' + esc(a.nume_sofer || '—') + '</td>'
          + '<td>' + esc(a.numar_camion || '—') + '</td>'
          + '<td>' + esc(a.loc || '—') + '</td>'
          + '<td>' + esc(a.tip || '—') + '</td>'
          + '<td style="text-align:right;">' + stNum(a.litru, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(a.suma, 0) + '</td>'
          + '<td>' + esc(a.plata || '—') + '</td></tr>';
      }).join('') || '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:18px;">' + T('stat.fuel.noFill') + '</td></tr>';

      box.innerHTML = stFilterBar('stats-fuel')
        + '<div class="dash-stats" style="margin-bottom:16px;">'
        + stTile('⛽', stNum(totL, 0) + ' L', T('stat.tile.fueledDiesel'))
        + stTile('💸', stNum(totS, 0) + ' RON', T('stat.tile.fuelCost'))
        + stTile('🏷️', stNum(avgPrice, 2) + ' RON/L', T('stat.tile.avgPrice'))
        + stTile('📉', stNum(fleetAvg, 1) + ' L/100km', T('stat.tile.fleetAvgConsum'))
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;">'
        + stPanel(T('stat.panel.monthlyFuel'), stChartCanvas('stChFuelHavi'))
        + stPanel(T('stat.panel.payMethodFuel'), stChartCanvas('stChFuelPlata'))
        + '</div>'
        + stPanel(T('stat.panel.consumByVeh'),
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + T('stat.th.plate') + '</th><th style="text-align:right;">' + T('stat.th.km') + '</th><th style="text-align:right;">' + T('stat.th.dieselL') + '</th><th style="text-align:right;">' + T('stat.th.actualConsum') + '</th><th style="text-align:right;">' + T('stat.th.nominal') + '</th><th style="text-align:center;">' + T('stat.th.diff') + '</th><th style="text-align:right;">' + T('stat.th.waybill') + '</th></tr></thead>'
            + '<tbody>' + vehRows + '</tbody></table></div>')
        + stPanel(T('stat.panel.fills100'),
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + T('stat.th.date') + '</th><th>' + T('stat.th.driver') + '</th><th>' + T('stat.th.vehicle') + '</th><th>' + T('stat.th.place') + '</th><th>' + T('stat.th.type') + '</th><th style="text-align:right;">' + T('stat.th.liter') + '</th><th style="text-align:right;">' + T('stat.th.sumRon') + '</th><th>' + T('stat.th.payment') + '</th></tr></thead>'
            + '<tbody>' + fillRows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-fuel\')">' + T('stat.csvExport') + '</button>');

      var months = stMonths([r.havi]);
      var motorina = r.havi.filter(function (h) { return h.tip !== 'AdBlue'; });
      var adblue = r.havi.filter(function (h) { return h.tip === 'AdBlue'; });
      stChart('stChFuelHavi', {
        type: 'bar',
        data: { labels: months, datasets: [
          { label: T('stat.chart.dieselRon'), data: stSeries(months, motorina, 'suma'), backgroundColor: 'rgba(245,158,11,0.7)', stack: 'f' },
          { label: T('stat.chart.adblueRon'), data: stSeries(months, adblue, 'suma'), backgroundColor: 'rgba(59,130,246,0.7)', stack: 'f' }
        ]},
        options: { scales: { x: { stacked: true }, y: { stacked: true } } }
      });
      stChart('stChFuelPlata', {
        type: 'doughnut',
        data: {
          labels: (r.fizetesi_mod || []).map(function (p) { return p.plata; }),
          datasets: [{ data: (r.fizetesi_mod || []).map(function (p) { return parseFloat(p.suma) || 0; }),
            backgroundColor: ['#e10b1a', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#8a97a8'] }]
        }
      });
    });
  }

  // ════════════════════════════════════════════════════════
  //  4) VÁSÁRLÁSOK (stats-purchases)
  // ════════════════════════════════════════════════════════
  function loadPurchases() {
    var box = document.getElementById('statsPurchasesBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-purchases') + '<div class="text-muted" style="padding:30px;text-align:center;">' + T('stat.loading') + '</div>';
    gas('getPurchaseStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-purchases') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || T('stat.error')) + '</div>'; return; }
      _stData['stats-purchases'] = r;

      var totS = 0, totDb = 0;
      (r.havi || []).forEach(function (h) { totS += parseFloat(h.suma) || 0; totDb += parseInt(h.db, 10) || 0; });
      var cashRow = (r.fizetesi_mod || []).find(function (p) { return /cash/i.test(p.plata || ''); });

      var listRows = (r.lista || []).map(function (c) {
        return '<tr><td>' + stDate(c.data_completare) + '</td>'
          + '<td>' + esc(c.nume_sofer || '—') + '</td>'
          + '<td>' + esc(c.numar_camion || '—') + '</td>'
          + '<td>' + esc(c.produs || '—') + '</td>'
          + '<td>' + esc(c.loc || '—') + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(c.pret, 0) + '</td>'
          + '<td>' + esc(c.plata || '—') + '</td></tr>';
      }).join('') || '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:18px;">' + T('stat.pur.noPurchase') + '</td></tr>';

      var soferRows = (r.soforok || []).map(function (s) {
        return '<tr><td>' + esc(s.sofer || '—') + '</td>'
          + '<td style="text-align:right;">' + stNum(s.db, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(s.suma, 0) + '</td></tr>';
      }).join('') || '<tr><td colspan="3" class="text-muted" style="text-align:center;padding:14px;">' + T('stat.noData') + '</td></tr>';

      box.innerHTML = stFilterBar('stats-purchases')
        + '<div class="dash-stats" style="margin-bottom:16px;">'
        + stTile('🛒', stNum(totS, 0) + ' RON', T('stat.tile.totalDriverSpend'))
        + stTile('🧾', stNum(totDb, 0), T('stat.tile.itemPurchase'))
        + stTile('💵', cashRow ? stNum(cashRow.suma, 0) + ' RON' : '0 RON', T('stat.tile.ofWhichCash'), 'var(--status-warn)')
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;">'
        + stPanel(T('stat.panel.monthlySpend'), stChartCanvas('stChPurHavi'))
        + stPanel(T('stat.panel.topProducts'), stChartCanvas('stChPurTermek'))
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;">'
        + stPanel(T('stat.panel.spendByDriver'),
            '<div style="overflow-x:auto;"><table class="table"><thead><tr><th>' + T('stat.th.driver') + '</th><th style="text-align:right;">' + T('stat.th.item') + '</th><th style="text-align:right;">' + T('stat.th.sumRon') + '</th></tr></thead><tbody>' + soferRows + '</tbody></table></div>')
        + stPanel(T('stat.panel.payMethod'), stChartCanvas('stChPurPlata'))
        + '</div>'
        + stPanel(T('stat.panel.purchases100'),
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + T('stat.th.date') + '</th><th>' + T('stat.th.driver') + '</th><th>' + T('stat.th.vehicle') + '</th><th>' + T('stat.th.product') + '</th><th>' + T('stat.th.place') + '</th><th style="text-align:right;">' + T('stat.th.priceRon') + '</th><th>' + T('stat.th.payment') + '</th></tr></thead>'
            + '<tbody>' + listRows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-purchases\')">' + T('stat.csvExport') + '</button>');

      var months = stMonths([r.havi]);
      stChart('stChPurHavi', {
        type: 'bar',
        data: { labels: months, datasets: [{ label: T('stat.chart.spendRon'), data: stSeries(months, r.havi, 'suma'), backgroundColor: 'rgba(59,130,246,0.7)' }] }
      });
      stChart('stChPurTermek', {
        type: 'bar',
        data: {
          labels: (r.termekek || []).map(function (t) { return t.produs; }),
          datasets: [{ label: T('stat.chart.sumRon'), data: (r.termekek || []).map(function (t) { return parseFloat(t.suma) || 0; }), backgroundColor: 'rgba(168,85,247,0.7)' }]
        },
        options: { indexAxis: 'y' }
      });
      stChart('stChPurPlata', {
        type: 'doughnut',
        data: {
          labels: (r.fizetesi_mod || []).map(function (p) { return p.plata; }),
          datasets: [{ data: (r.fizetesi_mod || []).map(function (p) { return parseFloat(p.suma) || 0; }),
            backgroundColor: ['#e10b1a', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#8a97a8'] }]
        }
      });
    });
  }

  // ════════════════════════════════════════════════════════
  //  5) SOFŐR TELJESÍTMÉNY (stats-drivers)
  // ════════════════════════════════════════════════════════
  function loadDrivers() {
    var box = document.getElementById('statsDriversBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-drivers') + '<div class="text-muted" style="padding:30px;text-align:center;">' + T('stat.loading') + '</div>';
    gas('getDriverStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-drivers') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || T('stat.error')) + '</div>'; return; }
      _stData['stats-drivers'] = r;
      var list = r.soforok || [];
      var rate = parseFloat(r.eur_ron_rate) || null;

      var rows = list.map(function (s, i) {
        var medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '';
        var profitCell = '';
        if (rate) {
          var p = (parseFloat(s.bevetel) || 0) - ((parseFloat(s.uzemanyag_ktg) || 0) + (parseFloat(s.vasarlas_ktg) || 0)) / rate;
          profitCell = '<td style="text-align:right;font-weight:700;color:' + (p >= 0 ? 'var(--status-ok)' : 'var(--status-danger)') + ';">' + stNum(p, 0) + '</td>';
        }
        return '<tr>'
          + '<td><b class="text-primary">' + medal + esc(s.nume || s.email || '—') + '</b></td>'
          + '<td style="text-align:right;">' + stNum(s.fuvarok, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(s.lezart, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(s.bevetel, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(s.total_km, 0) + '</td>'
          + '<td style="text-align:right;">' + (parseFloat(s.consum_100) > 0 ? stNum(s.consum_100, 1) : '—') + '</td>'
          + '<td style="text-align:right;">' + stNum(s.uzemanyag_ktg, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(s.vasarlas_ktg, 0) + '</td>'
          + profitCell
          + '<td style="text-align:center;">' + stNum(s.diurna_ext, 0) + ' / ' + stNum(s.diurna_int, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(s.menetlevelek, 0) + '</td>'
          + '</tr>';
      }).join('') || '<tr><td colspan="11" class="text-muted" style="text-align:center;padding:18px;">' + T('stat.noDataPeriod') + '</td></tr>';

      box.innerHTML = stFilterBar('stats-drivers')
        + stPanel(T('stat.panel.topDrivers'), stChartCanvas('stChDrvTop'))
        + stPanel(T('stat.panel.driverPerf'),
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + T('stat.th.driver') + '</th><th style="text-align:right;">' + T('stat.th.order') + '</th><th style="text-align:right;">' + T('stat.th.closed') + '</th><th style="text-align:right;">' + T('stat.th.revenueEur') + '</th><th style="text-align:right;">' + T('stat.th.kmWaybill') + '</th><th style="text-align:right;">L/100km</th><th style="text-align:right;">' + T('stat.th.fuelRon') + '</th><th style="text-align:right;">' + T('stat.th.purchaseRon') + '</th>'
            + (rate ? '<th style="text-align:right;">' + T('stat.th.resultEur') + '</th>' : '')
            + '<th style="text-align:center;">' + T('stat.th.diurnaKB') + '</th><th style="text-align:right;">' + T('stat.th.waybill') + '</th></tr></thead>'
            + '<tbody>' + rows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-drivers\')">' + T('stat.csvExport') + '</button>');

      var top = list.slice(0, 10);
      stChart('stChDrvTop', {
        type: 'bar',
        data: {
          labels: top.map(function (s) { return s.nume || s.email; }),
          datasets: [{ label: T('stat.chart.revenueEur'), data: top.map(function (s) { return parseFloat(s.bevetel) || 0; }), backgroundColor: 'rgba(225,11,26,0.7)' }]
        },
        options: { indexAxis: 'y' }
      });
    });
  }

  // ════════════════════════════════════════════════════════
  //  6) JÁRMŰ KIHASZNÁLTSÁG (stats-vehicles) + GPS pillanatkép
  // ════════════════════════════════════════════════════════
  function loadVehiclesStats() {
    var box = document.getElementById('statsVehiclesBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-vehicles') + '<div class="text-muted" style="padding:30px;text-align:center;">' + T('stat.loading') + '</div>';
    gas('getVehicleStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-vehicles') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || T('stat.error')) + '</div>'; return; }
      _stData['stats-vehicles'] = r;
      var list = r.jarmuvek || [];
      var rate = parseFloat(r.eur_ron_rate) || null;

      var rows = list.map(function (v) {
        var nevleges = parseFloat(v.nevleges) || 0;
        var consum = parseFloat(v.consum_100) || 0;
        var diffBadge = '—';
        if (nevleges > 0 && consum > 0) {
          var diff = ((consum - nevleges) / nevleges) * 100;
          var cls = diff > 10 ? 'err' : diff > 0 ? 'warn' : 'ok';
          diffBadge = '<span class="badge ' + cls + '">' + (diff >= 0 ? '+' : '') + stNum(diff, 1) + '%</span>';
        }
        return '<tr>'
          + '<td><b class="text-primary">' + esc(v.rendszam_eredeti || v.rendszam || '—') + '</b>'
          + (v.marca ? '<div class="text-muted" style="font-size:11px;">' + esc(v.marca) + (v.model ? ' ' + esc(v.model) : '') + (v.an ? ' · ' + v.an : '') + '</div>' : '') + '</td>'
          + '<td style="text-align:center;">' + (v.activ === false ? '<span class="badge err">' + T('stat.veh.idle') + '</span>' : '<span class="badge ok">' + T('stat.veh.active') + '</span>') + '</td>'
          + '<td style="text-align:right;">' + stNum(v.fuvarok, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(v.lezart, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(v.bevetel, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(v.bevetel_per_km, 2) + '</td>'
          + '<td style="text-align:right;">' + stNum(v.total_km, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(v.uzemanyag_ktg, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(v.szerviz_ktg, 0) + '</td>'
          + (rate ? (function () {
              var p = (parseFloat(v.bevetel) || 0) - ((parseFloat(v.uzemanyag_ktg) || 0) + (parseFloat(v.szerviz_ktg) || 0)) / rate;
              return '<td style="text-align:right;font-weight:700;color:' + (p >= 0 ? 'var(--status-ok)' : 'var(--status-danger)') + ';">' + stNum(p, 0) + '</td>';
            })() : '')
          + '<td style="text-align:right;">' + (consum > 0 ? stNum(consum, 1) : '—') + '</td>'
          + '<td style="text-align:center;">' + diffBadge + '</td>'
          + '</tr>';
      }).join('') || '<tr><td colspan="12" class="text-muted" style="text-align:center;padding:18px;">' + T('stat.noDataPeriod') + '</td></tr>';

      box.innerHTML = stFilterBar('stats-vehicles')
        + '<div id="stGpsSnapshotBox"></div>'
        + '<div id="stGpsKmBox"></div>'
        + stPanel(T('stat.panel.topVehicles'), stChartCanvas('stChVehTop'))
        + stPanel(T('stat.panel.vehTable'),
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + T('stat.th.vehicle') + '</th><th style="text-align:center;">' + T('stat.th.state') + '</th><th style="text-align:right;">' + T('stat.th.order') + '</th><th style="text-align:right;">' + T('stat.th.closed') + '</th><th style="text-align:right;">' + T('stat.th.revenueEur') + '</th><th style="text-align:right;">EUR/km</th><th style="text-align:right;">' + T('stat.th.kmWaybill') + '</th><th style="text-align:right;">' + T('stat.th.fuelRon') + '</th><th style="text-align:right;">' + T('stat.th.serviceRon') + '</th>'
            + (rate ? '<th style="text-align:right;">' + T('stat.th.resultEur') + '</th>' : '')
            + '<th style="text-align:right;">L/100km</th><th style="text-align:center;">' + T('stat.th.diff') + '</th></tr></thead>'
            + '<tbody>' + rows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-vehicles\')">' + T('stat.csvExport') + '</button>');

      var top = list.filter(function (v) { return (parseFloat(v.bevetel) || 0) > 0; }).slice(0, 10);
      stChart('stChVehTop', {
        type: 'bar',
        data: {
          labels: top.map(function (v) { return v.rendszam_eredeti || v.rendszam; }),
          datasets: [{ label: T('stat.chart.revenueEur'), data: top.map(function (v) { return parseFloat(v.bevetel) || 0; }), backgroundColor: 'rgba(34,197,94,0.7)' }]
        },
        options: { indexAxis: 'y' }
      });

      loadGpsSnapshot();
      loadGpsKmCompare();
    });
  }

  // GPS-km (napi snapshot-napló) vs. a sofőr által beírt menetlevél-km
  function loadGpsKmCompare() {
    var box = document.getElementById('stGpsKmBox');
    if (!box) return;
    gas('getGpsKmComparison', stRangeDates()).then(function (r) {
      if (!r || !r.ok || !(r.rows || []).length) { box.innerHTML = ''; return; }
      var rows = r.rows.map(function (x) {
        var warn = x.diff_pct != null && Math.abs(x.diff_pct) > 10;
        return '<tr><td><b class="text-primary">' + esc(x.rendszam) + '</b></td>'
          + '<td style="text-align:right;">' + stNum(x.gps_km, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(x.drv_km, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;color:' + (warn ? 'var(--status-danger)' : 'inherit') + ';">' + (x.diff_km > 0 ? '+' : '') + stNum(x.diff_km, 0) + '</td>'
          + '<td style="text-align:center;">' + (x.diff_pct != null ? '<span class="badge ' + (warn ? 'err' : 'ok') + '">' + (x.diff_pct > 0 ? '+' : '') + stNum(x.diff_pct, 1) + '%</span>' : '—') + '</td>'
          + '<td class="text-muted" style="text-align:right;font-size:12px;">' + stNum(x.napok, 0) + ' ' + T('stat.gpsKm.days') + '</td></tr>';
      }).join('');
      box.innerHTML = stPanel(T('stat.panel.gpsKm'),
        '<div style="overflow-x:auto;"><table class="table">'
        + '<thead><tr><th>' + T('stat.th.plate') + '</th><th style="text-align:right;">' + T('stat.th.gpsKm') + '</th><th style="text-align:right;">' + T('stat.th.driverEntered') + '</th><th style="text-align:right;">' + T('stat.th.diff') + '</th><th style="text-align:center;">%</th><th style="text-align:right;">' + T('stat.th.measureDays') + '</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>'
        + '<div class="text-muted" style="font-size:11px;margin-top:6px;">' + T('stat.gpsKm.note') + '</div>');
    }).catch(function () { box.innerHTML = ''; });
  }

  // CargoTrack élő flotta-adatok (üzemanyag-szint, km-óra, gyújtás) — ha a
  // GPS-eszköz méri. A handler 60 mp-es szerver-cache-t használ.
  function loadGpsSnapshot() {
    var box = document.getElementById('stGpsSnapshotBox');
    if (!box) return;
    gas('getGpsFleetSnapshot').then(function (r) {
      if (!r || !r.ok || !r.gps_configured || !(r.vehicles || []).length) { box.innerHTML = ''; return; }
      var rows = r.vehicles.map(function (v) {
        var ign = v.ignition === 'ON' || v.ignition === true || v.ignition === 'on';
        return '<tr><td><b class="text-primary">' + esc(v.rendszam || v.object_name || '—') + '</b></td>'
          + '<td style="text-align:center;">' + (ign ? '<span class="badge ok">' + T('stat.gps.running') + '</span>' : '<span class="badge info">' + T('stat.gps.stopped') + '</span>') + '</td>'
          + '<td style="text-align:right;">' + (v.speed != null ? stNum(v.speed, 0) + ' km/h' : '—') + '</td>'
          + '<td style="text-align:right;">' + (v.fuel_level != null ? stNum(v.fuel_level, 0) + ' L' : '—') + '</td>'
          + '<td style="text-align:right;">' + (v.mileage != null ? stNum(v.mileage, 0) + ' km' : '—') + '</td>'
          + '<td style="text-align:right;">' + (v.fuel_consumption != null ? stNum(v.fuel_consumption, 1) : '—') + '</td>'
          + '<td class="text-muted" style="font-size:12px;">' + (v.datetime ? new Date(v.datetime).toLocaleString('hu-HU') : '—') + '</td></tr>';
      }).join('');
      box.innerHTML = stPanel(T('stat.panel.liveFleet'),
        '<div style="overflow-x:auto;"><table class="table">'
        + '<thead><tr><th>' + T('stat.th.vehicle') + '</th><th style="text-align:center;">' + T('stat.th.ignition') + '</th><th style="text-align:right;">' + T('stat.th.speed') + '</th><th style="text-align:right;">' + T('stat.th.fuelLevel') + '</th><th style="text-align:right;">' + T('stat.th.odoGps') + '</th><th style="text-align:right;">' + T('stat.th.consumption') + '</th><th>' + T('stat.th.lastSignal') + '</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>'
        + '<div class="text-muted" style="font-size:11px;margin-top:8px;">' + T('stat.gps.note') + '</div>');
    }).catch(function () { box.innerHTML = ''; });
  }

  // ════════════════════════════════════════════════════════
  //  7) ÜGYFÉL RIPORT (stats-clients)
  // ════════════════════════════════════════════════════════
  function loadClients() {
    var box = document.getElementById('statsClientsBox');
    if (!box) return;
    box.innerHTML = stFilterBar('stats-clients') + '<div class="text-muted" style="padding:30px;text-align:center;">' + T('stat.loading') + '</div>';
    gas('getClientStats', stRangeDates()).then(function (r) {
      if (!r || !r.ok) { box.innerHTML = stFilterBar('stats-clients') + '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || T('stat.error')) + '</div>'; return; }
      _stData['stats-clients'] = r;
      var list = r.ugyfelek || [];
      var fin = !!r.finance;

      var rows = list.map(function (u) {
        var anaf = u.anaf_status === 'activ' ? '<span class="badge ok">' + T('stat.cli.anafActive') + '</span>'
          : u.anaf_status === 'inactiv' ? '<span class="badge err">' + T('stat.cli.anafInactive') + '</span>' : '';
        return '<tr><td><b class="text-primary">' + esc(u.ugyfel || '—') + '</b>'
          + (u.cui_cif ? '<div class="text-muted" style="font-size:11px;">' + esc(u.cui_cif) + '</div>' : '') + '</td>'
          + '<td>' + anaf + '</td>'
          + '<td style="text-align:right;">' + stNum(u.fuvarok, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(u.lezart, 0) + '</td>'
          + '<td style="text-align:right;font-weight:700;">' + stNum(u.bevetel, 0) + '</td>'
          + '<td style="text-align:right;">' + stNum(u.km, 0) + '</td>'
          + (fin ? '<td style="text-align:right;color:' + ((parseFloat(u.kintlevo) || 0) > 0 ? 'var(--status-danger)' : 'inherit') + ';font-weight:700;">' + stNum(u.kintlevo, 0) + '</td>' : '')
          + (fin ? '<td style="text-align:center;">' + (u.atlag_fizetesi_nap != null ? stNum(u.atlag_fizetesi_nap, 0) + ' nap' : '—') + '</td>' : '')
          + '</tr>';
      }).join('') || '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:18px;">' + T('stat.noDataPeriod') + '</td></tr>';

      box.innerHTML = stFilterBar('stats-clients')
        + stPanel(T('stat.panel.topClients'), stChartCanvas('stChCliTop'))
        + stPanel(T('stat.panel.clientTable'),
            '<div style="overflow-x:auto;"><table class="table">'
            + '<thead><tr><th>' + T('stat.th.client') + '</th><th>ANAF</th><th style="text-align:right;">' + T('stat.th.order') + '</th><th style="text-align:right;">' + T('stat.th.closed') + '</th><th style="text-align:right;">' + T('stat.th.revenueEur') + '</th><th style="text-align:right;">' + T('stat.th.km') + '</th>'
            + (fin ? '<th style="text-align:right;">' + T('stat.th.receivableEur') + '</th><th style="text-align:center;">' + T('stat.th.avgPayTime') + '</th>' : '')
            + '</tr></thead><tbody>' + rows + '</tbody></table></div>',
            '<button class="btn ghost" style="padding:6px 12px;font-size:12px;" onclick="VS_STATS.csv(\'stats-clients\')">' + T('stat.csvExport') + '</button>');

      var top = list.slice(0, 10);
      stChart('stChCliTop', {
        type: 'bar',
        data: {
          labels: top.map(function (u) { return u.ugyfel; }),
          datasets: [{ label: T('stat.chart.revenueEur'), data: top.map(function (u) { return parseFloat(u.bevetel) || 0; }), backgroundColor: 'rgba(59,130,246,0.7)' }]
        },
        options: { indexAxis: 'y' }
      });
    });
  }

  // ════════════════════════════════════════════════════════
  //  8) JOGOSULTSÁGOK (stats-permissions) — CSAK ADMIN
  // ════════════════════════════════════════════════════════
  function loadPermissions() {
    var box = document.getElementById('statsPermissionsBox');
    if (!box) return;
    box.innerHTML = '<div class="text-muted" style="padding:30px;text-align:center;">' + T('stat.loading') + '</div>';
    gas('getStatsPermissions').then(function (r) {
      if (!r || !r.ok) { box.innerHTML = '<div class="text-muted" style="padding:20px;">' + esc((r && r.err) || T('stat.error')) + '</div>'; return; }
      var rows = (r.users || []).map(function (u) {
        return '<tr><td><b class="text-primary">' + esc(u.nume || '—') + '</b></td>'
          + '<td>' + esc(u.email) + '</td>'
          + '<td><span class="badge info">' + esc(u.pozicio) + '</span></td>'
          + '<td style="text-align:center;">'
          + '<label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;">'
          + '<input type="checkbox" ' + (u.finance_enabled ? 'checked' : '') + ' style="width:18px;height:18px;cursor:pointer;accent-color:#22c55e;" '
          + 'onchange="VS_STATS.setPerm(' + u.id + ', this.checked)">'
          + '<span style="font-size:12px;" class="text-muted">' + T('stat.perm.financeVisible') + '</span></label>'
          + '</td></tr>';
      }).join('') || '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:18px;">' + T('stat.perm.noManager') + '</td></tr>';

      box.innerHTML = stPanel(T('stat.perm.title'),
        '<p class="text-muted" style="font-size:13px;margin:0 0 14px;">' + T('stat.perm.intro') + '</p>'
        + '<div style="overflow-x:auto;"><table class="table">'
        + '<thead><tr><th>' + T('stat.th.name') + '</th><th>' + T('stat.th.email') + '</th><th>' + T('stat.th.position') + '</th><th style="text-align:center;">' + T('stat.th.permission') + '</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>');
    });
  }

  function setPerm(userId, enabled) {
    gas('setStatsPermission', [userId, enabled]).then(function (r) {
      if (r && r.ok) toast(enabled ? T('stat.perm.granted') : T('stat.perm.revoked'), 'ok');
      else { toast((r && r.err) || T('stat.error'), 'err'); loadPermissions(); }
    });
  }

  // ── CSV exportok (az utoljára betöltött adatból) ────────
  function csvExport(pane) {
    var r = _stData[pane];
    if (!r) { toast(T('stat.csv.loadFirst'), 'err'); return; }
    var stamp = new Date().toISOString().slice(0, 10);
    if (pane === 'stats-finance') {
      stCsv('kintlevoseg-' + stamp + '.csv',
        [T('stat.csv.h.order'), T('stat.csv.h.client'), T('stat.csv.h.priceEur'), T('stat.csv.h.paid'), T('stat.csv.h.balance'), T('stat.csv.h.completed'), T('stat.csv.h.daysElapsed'), T('stat.csv.h.status')],
        (r.kintlevo_lista || []).map(function (o) {
          return [o.id, o.client, o.pret, o.paid_amount, (parseFloat(o.pret) || 0) - (parseFloat(o.paid_amount) || 0), stDate(o.finalized_at), o.napok, o.payment_status];
        }));
    } else if (pane === 'stats-fuel') {
      stCsv('tankolasok-' + stamp + '.csv',
        [T('stat.csv.h.date'), T('stat.csv.h.driver'), T('stat.csv.h.vehicle'), T('stat.csv.h.place'), T('stat.csv.h.type'), T('stat.csv.h.liter'), T('stat.csv.h.sumRon'), T('stat.csv.h.payment')],
        (r.lista || []).map(function (a) { return [stDate(a.data_completare), a.nume_sofer, a.numar_camion, a.loc, a.tip, a.litru, a.suma, a.plata]; }));
    } else if (pane === 'stats-purchases') {
      stCsv('vasarlasok-' + stamp + '.csv',
        [T('stat.csv.h.date'), T('stat.csv.h.driver'), T('stat.csv.h.vehicle'), T('stat.csv.h.product'), T('stat.csv.h.place'), T('stat.csv.h.priceRon'), T('stat.csv.h.payment')],
        (r.lista || []).map(function (c) { return [stDate(c.data_completare), c.nume_sofer, c.numar_camion, c.produs, c.loc, c.pret, c.plata]; }));
    } else if (pane === 'stats-drivers') {
      var dRate = parseFloat(r.eur_ron_rate) || null;
      stCsv('sofor-teljesitmeny-' + stamp + '.csv',
        [T('stat.csv.h.driver'), T('stat.csv.h.email'), T('stat.csv.h.order'), T('stat.csv.h.closed'), T('stat.csv.h.revenueEur'), T('stat.csv.h.kmWaybill'), 'L/100km', T('stat.csv.h.fuelRon'), T('stat.csv.h.purchaseRon'), T('stat.csv.h.resultEur'), T('stat.csv.h.diurnaExt'), T('stat.csv.h.diurnaInt'), T('stat.csv.h.waybill')],
        (r.soforok || []).map(function (s) {
          var p = dRate ? Math.round((parseFloat(s.bevetel) || 0) - ((parseFloat(s.uzemanyag_ktg) || 0) + (parseFloat(s.vasarlas_ktg) || 0)) / dRate) : '';
          return [s.nume, s.email, s.fuvarok, s.lezart, s.bevetel, s.total_km, s.consum_100, s.uzemanyag_ktg, s.vasarlas_ktg, p, s.diurna_ext, s.diurna_int, s.menetlevelek];
        }));
    } else if (pane === 'stats-vehicles') {
      var vRate = parseFloat(r.eur_ron_rate) || null;
      stCsv('jarmu-kihasznaltsag-' + stamp + '.csv',
        [T('stat.csv.h.plate'), T('stat.csv.h.brand'), T('stat.csv.h.order'), T('stat.csv.h.closed'), T('stat.csv.h.revenueEur'), 'EUR/km', T('stat.csv.h.kmWaybill'), T('stat.csv.h.fuelRon'), T('stat.csv.h.serviceRon'), T('stat.csv.h.resultEur'), 'L/100km', T('stat.csv.h.nominal')],
        (r.jarmuvek || []).map(function (v) {
          var p = vRate ? Math.round((parseFloat(v.bevetel) || 0) - ((parseFloat(v.uzemanyag_ktg) || 0) + (parseFloat(v.szerviz_ktg) || 0)) / vRate) : '';
          return [v.rendszam_eredeti || v.rendszam, (v.marca || '') + ' ' + (v.model || ''), v.fuvarok, v.lezart, v.bevetel, v.bevetel_per_km, v.total_km, v.uzemanyag_ktg, v.szerviz_ktg, p, v.consum_100, v.nevleges];
        }));
    } else if (pane === 'stats-clients') {
      stCsv('ugyfel-riport-' + stamp + '.csv',
        [T('stat.csv.h.client'), T('stat.csv.h.cui'), T('stat.csv.h.order'), T('stat.csv.h.closed'), T('stat.csv.h.revenueEur'), T('stat.csv.h.km'), T('stat.csv.h.receivableEur'), T('stat.csv.h.avgPayDays')],
        (r.ugyfelek || []).map(function (u) { return [u.ugyfel, u.cui_cif, u.fuvarok, u.lezart, u.bevetel, u.km, u.kintlevo, u.atlag_fizetesi_nap]; }));
    }
  }

  // ── Publikus API ────────────────────────────────────────
  var _stCurrentPane = null;
  window.VS_STATS = {
    load: function (name) {
      _stCurrentPane = name;
      applyPerms(function () {
        if (name === 'stats-overview') loadOverview();
        else if (name === 'stats-finance') loadFinance();
        else if (name === 'stats-fuel') loadFuel();
        else if (name === 'stats-purchases') loadPurchases();
        else if (name === 'stats-drivers') loadDrivers();
        else if (name === 'stats-vehicles') loadVehiclesStats();
        else if (name === 'stats-clients') loadClients();
        else if (name === 'stats-permissions') loadPermissions();
      });
    },
    setPreset: function (preset, pane) {
      _stRange.preset = preset;
      if (preset === 'custom') {
        var bar = document.getElementById('stCustomRange');
        if (bar) bar.style.display = 'inline-flex';
        return; // az Alkalmaz gomb tölt újra
      }
      VS_STATS.load(pane);
    },
    applyCustom: function (pane) {
      var f = (document.getElementById('stFrom') || {}).value;
      var t = (document.getElementById('stTo') || {}).value;
      if (!f || !t) { toast(T('stat.dateRangeReq'), 'err'); return; }
      _stRange.preset = 'custom'; _stRange.from = f; _stRange.to = t;
      VS_STATS.load(pane);
    },
    csv: csvExport,
    setPerm: setPerm,
    applyPerms: applyPerms,
    saveRate: function () {
      var v = (document.getElementById('stEurRon') || {}).value;
      gas('setEurRonRate', [v === '' ? null : v]).then(function (r) {
        if (r && r.ok) { toast(T('stat.rateSaved'), 'ok'); VS_STATS.load('stats-overview'); }
        else toast((r && r.err) || T('stat.error'), 'err');
      });
    },
    fetchBnr: function () {
      gas('getBnrRate').then(function (r) {
        if (r && r.ok) {
          var inp = document.getElementById('stEurRon');
          if (inp) inp.value = r.rate;
          toast(T('stat.bnrToast') + ' (' + (r.date || T('stat.bnrTodayDefault')) + '): ' + r.rate + ' ' + T('stat.bnrToastClick'), 'ok');
        } else toast((r && r.err) || T('stat.bnrUnavailable'), 'err');
      });
    }
  };

  // A Pénzügy fül elrejtése jogosultság nélkül — már betöltéskor
  // (a guard a szerveren is megvan: getFinanceStats elutasít).
  if (window.gas) applyPerms();

  // Nyelvváltáskor a jelenleg látható stats-fül újrarenderelése
  if (window.I18N && window.I18N.onLang) {
    window.I18N.onLang(function () {
      if (!_stCurrentPane) return;
      var box = document.getElementById('statsOverviewBox') || document.getElementById('statsFinanceBox');
      // csak akkor renderelünk újra, ha a stats-felület látható (van betöltött adat)
      if (Object.keys(_stData).length || _stCurrentPane === 'stats-permissions') {
        VS_STATS.load(_stCurrentPane);
      }
    });
  }
})();

// ── Statisztika almenü nyit/zár (sidebar szülő-fül) ────────
function toggleStatsMenu() {
  var el = document.getElementById('statsSubmenu');
  if (el && el.parentElement) el.parentElement.classList.toggle('open');
}
