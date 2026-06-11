# Statisztika & Riport + Flotta-modulok — fejlesztési jegyzet

> Állapot: **1–3. fázis KÉSZ** (2026-06-11). Ez a jegyzet rögzíti, mi épült be és mi van hátra.

## ✅ Beépítve (3. fázis — flotta & megfelelés modulok)

0. **HERE → ingyenes térkép-stack**: csempék CartoDB/OSM, címkereső+geokódolás Photon, útvonal OSRM (autós profil, kulcs és díj nélkül). `HERE_API_KEY` nem kell többé; a HERE pool/árazás kód legacy.
1. **⏰ Lejáratok & riasztások** (`expiries` fül, Flotta & Megfelelés csoport) — ITP/RCA/CASCO/rovinietă/CMR-bizt./tahográf/ADR/jogosítvány/atestat lejáratok jármű- vagy sofőr-szinten (`document_expiries`). A scheduler 12 óránként ellenőriz, és **push-riasztást** küld az Admin/Manager-eknek (hetente ismételve); a Vezérlőpulton riasztás-sáv (`dashExpiryAlert`).
2. **🔧 Szerviz & karbantartás** (`service-log` fül) — szerviz-napló (`vehicle_service_log`): dátum, km, kategória (olaj/gumi/javítás), költség RON, következő esedékesség (dátum/km). A költség beépül a Statisztika → Jármű kihasználtság riportba (Szerviz oszlop + Eredmény-számítás).
3. **💶 Sofőr-elszámolás / decont** (`decont` fül, Fuvarozás csoport) — előleg-kiadás (`driver_advances`) vs. készpénzes menetlevél-költések = **kassza-egyenleg**; diurna-járandóság (napok × cég-ráta, `companies.diurna_ext_rate/int_rate`, admin állítja a felületen); fizetési mód szerinti bontás; nyomtatható.
4. **Fizetési határidő** (`clients.payment_term_days`, ügyfél-űrlapon) — a kintlévőség „Esedékes/Lejárt" számítása ügyfelenként pontos; az Áttekintés lejárt-riasztása is ezt használja.
5. **e-Factura státusz-jelzés** — a fuvarlista 🧾 pipáján 📨 szimbólum + tooltip az ANAF SPV státusszal (`invoices.efactura_status`).
6. **📷 POD (proof of delivery)** — a sofőr a fotót (új „POD" típus) **fuvarhoz kötheti**; a fuvarlistában 📷N jelző, az Iratok fülön 🔗 fuvar-badge (`documents.order_id`).
7. Minden új fül a **feature-katalógusban** (`decont`, `expiries`, `service-log`) — a developer cégenként/előfizetés szerint kapcsolja.

## ✅ Beépítve (2. fázis)

1. **EUR↔RON árfolyam + Eredmény (profit)** — az admin az Áttekintés tetején állítja az árfolyamot (💱, `setEurRonRate`, `companies.eur_ron_rate`, migráció: `db/company-eur-ron.sql`). Ha be van állítva: Eredmény-KPI + havi eredmény oszlopdiagram (zöld/piros) az Áttekintésen, „Eredmény (EUR)" oszlop a Sofőr- és Jármű-táblákban. Árfolyam nélkül a profit-elemek nem jelennek meg.
2. **Top útvonalak** — az Áttekintésen: leggyakoribb felrakó→lerakó párok (fuvarszám, átlag km, átlagár, bevétel).
3. **Riasztások az Áttekintésen** — ⛽ túlfogyasztó jármű (tényleges > névleges +15%, min. 300 km) és ⏰ 30+ napja lejárt kintlévőség (csak pénzügy-jogosultsággal; kattintásra a Pénzügy fülre visz).
4. **HERE-költség a Pénzügy fülön** — ingyenes pool kihasználtság (progress-sáv) + szolgáltatásonkénti havi költség (a meglévő `getMyHereUsage`-ből).
5. **Sofőr mini-statisztika** — a sofőr mobilfelület főoldalán „📊 E havi teljesítményem": lezárt fuvar, km, diurna, tankolt liter (`getMySoferStats` — csak a SAJÁT adatait látja).

## ✅ Beépítve (1. fázis)

### Új főmenü: „📊 Statisztika" (admin + manager sidebar, legördülő)
| Fül | data-tab | Tartalom |
|---|---|---|
| Áttekintés | `stats-overview` | KPI-kártyák (bevétel EUR, lezárt fuvar, km, átlagfogyasztás, diurna; jogosultsággal: beszedett + kintlévő), havi bevétel vonaldiagram, havi költség (üzemanyag+vásárlás) halmozott oszlop |
| Pénzügy 🔒 | `stats-finance` | bevétel vs. beszedett /hó, kintlévőség-öregedés (0–30/31–60/60+ nap), kintlévő fuvarok listája 💰 gombbal, EUR/km, átlagos fizetési idő, CSV |
| Fogyasztás | `stats-fuel` | tankolt liter/költség/átlagár, flotta L/100km, járművenként tényleges vs. névleges fogyasztás (eltérés-badge: >10% piros), havi tankolás Motorină/AdBlue bontásban, fizetési mód fánk, tankolás-lista, CSV |
| Vásárlások | `stats-purchases` | összes sofőr-költés, készpénz kiemelve (elszámolás), havi költés, top termékek, sofőrönkénti bontás, fizetési mód, lista, CSV |
| Sofőr teljesítmény | `stats-drivers` | rangsor (🥇🥈🥉): fuvarszám, lezárt, bevétel, menetlevél-km, L/100km, üzemanyag-/vásárlás-költség, diurna napok, CSV |
| Jármű kihasználtság | `stats-vehicles` | fuvar/bevétel/EUR/km/fogyasztás rendszámonként + **élő CargoTrack flotta-adatok** (üzemanyag-szint, GPS km-óra, gyújtás, sebesség — v2 API `calculated_inputs`), CSV |
| Ügyfél riport | `stats-clients` | bevétel-toplista, fuvarszám, ANAF-badge; jogosultsággal: kintlévő/ügyfél + átlag fizetési idő, CSV |
| 🔐 Jogosultságok | `stats-permissions` | **csak admin.html-ben** — Manager-enként kapcsoló a Pénzügy láthatóságra |

Közös szűrősáv minden fülön: elmúlt 12 hónap (alap) / idei év / 3 hónap / e hónap / előző hónap / egyedi dátumtartomány.

### Fizetés-követés (💰 gomb)
- A **Fuvar kezelés** listában a `Finalizat` fuvarokon jelenik meg a 💰 gomb (piros=kintlévő, sárga=részben, zöld ✓=fizetve).
- Modal: ár / eddig fizetve / hátralék összegzés, **kézi részösszeg VAGY „Teljes hátralék" gomb**, fizetési mód (átutalás/készpénz/kompenzáció/egyéb), megjegyzés, téves rögzítés nullázása.
- Backend: `markOrderPayment` — göngyölt `paid_amount`, automata státusz (`unpaid`/`partial`/`paid`), csak Finalizat fuvaron.
- A Pénzügy riport kintlévő-listájából is hívható.

### Jogosultság-rendszer (admin adja)
- `user_permissions` tábla (`perm_key='stats_finance'`). **Hiányzó sor = NINCS engedély** (szigorú alapért.).
- Admin (és developer) mindig lát mindent; Manager csak engedéllyel látja a Pénzügy fület + a pénzügyi oszlopokat (Áttekintés beszedett/kintlévő KPI, Ügyfél riport kintlévő oszlop).
- Védelem **szerver-oldalon is**: `getFinanceStats` elutasít engedély nélkül; a kliens csak elrejti a fület.

### Fájlok
- `db/order-payments.sql` — migráció (orders fizetés-mezők + user_permissions). **Élesítés előtt lefuttatandó!**
- `handlers/statisticsHandlers.js` — az összes riport-handler + fizetés + jogosultságok + `getGpsFleetSnapshot`
- `routes/execute.js` — registry-bővítés
- `public/stats.js` — a teljes riport-UI (Chart.js, már CSP-engedélyezett jsdelivr CDN-ről)
- `public/console-shared.js` — 💰 gomb a fuvarlistában + fizetés-modal logika (közös szekció)
- `public/admin.html`, `public/manager.html` — sidebar menücsoport, panes, payModal, stats.js include
- `public/admin.js`, `public/manager.js` — loadTab + statsParentTab bekötés
- `public/feature-catalog.js` — 7 új kapcsolható funkció (`Statisztika & Riport` csoport, developer cégenként kapcsolhatja / csomagba teheti)
- `handlers/orders.js` — comList visszaadja a `payment_status`/`paid_amount` mezőket

### Pénznem-kezelés (fontos!)
- Fuvar-ár: **EUR** (a meglévő felülettel konzisztensen), sofőr-költségek (tankolás/vásárlás): **RON**.
- A kettőt **nem vonjuk össze** egy profit-számba — mindenhol kiírjuk az egységet.

## ✅ Beépítve (4. fázis — első kör)
1. **🌍 Ügyfél tracking-link** (prémium, `tracking` kapcsoló): a fuvarlistán 🌍 gomb → publikus, tokenes román nyelvű követő-oldal (`/t/<token>`, `public/track.html`, `routes/track.js`): útvonal, státusz, rendszám + **élő GPS-pozíció** térképen (60s szerver-cache, 2 perces auto-frissítés). Migráció: `db/order-tracking.sql`. Szerveroldali feature-gate is.
2. **🏦 BNR árfolyam-gomb** a 💱 mezőnél (`getBnrRate` — a BNR napi XML-jéből, 1 órás cache).
3. **e-Factura státusz TÉNYLEGES bekötése**: a számla-modal 🔄 gombja a szolgáltatótól (FGO getstatus) lekéri és eltárolja az `invoices.efactura_status`-t — ezt mutatja a 📨 jelző.

## ✅ Beépítve (4. fázis — második kör)
1. **📅 Diszpécser-tervezőtábla** (`orders-planner` fül, Fuvarfeladatok almenü) — jármű×nap rács 2 hétre: a fuvar-chipek a felrakó-napjukon, a kiosztott vontató sorában; **drag&drop kiosztás** (jármű + felrakó-dátum), visszahúzás = kiosztás törlése; kattintás = fuvar-szerkesztő; hét-lapozás.
2. **⛽ Üzemanyagkártya-import** (`fuel-import` fül, Flotta csoport) — generikus CSV-import **oszlop-párosítóval** (automatikus oszlop-tippek, román/magyar számformátum + többféle dátumformátum), duplikáció-védelem (hash); **kártya vs. sofőr-tankolás eltérés-riport** (>10% piros).
3. **📧 Havi e-mail összefoglaló** — a hónap első napjaiban automatikusan kiküldi az előző hónap riportját (lezárt fuvar, bevétel, km, üzemanyag, kintlévőség) a cég admin(jai)nak Brevo-n; küldés-napló (nincs dupla); cégenként kikapcsolható (`monthly-report` kapcsoló).
4. **🛰️ Napi GPS km-óra snapshot** (`gps_mileage_log`, napi scheduler) → a Jármű kihasználtság fülön **GPS-km vs. menetlevél-km** összevetés (>10% eltérés piros).
5. **🎯 Fuvar-szintű eredmény** a Pénzügy fülön — a menetlevél-költségek a `order_ids` szerint fuvarokra osztva; árfolyammal Eredmény (EUR) oszlop.
6. **🚛 Kamionos routing ingyen**: ha az `.env`-ben van `ORS_API_KEY` (OpenRouteService, ingyenes regisztráció), az útvonaltervező `driving-hgv` profillal, a megadott súly/méret-korlátokkal tervez (OSRM-fallback); az eredmény-panel jelzi a használt profilt.
7. CSV-exportokban Eredmény + Szerviz oszlopok.

## ⬜ Hátralévő (csak külső függéssel)
1. **Bursă-integráció** (Trans.eu / Timocom) — partneri API-szerződés és kulcsok kellenek a szolgáltatóktól; ha megvannak, a Megrendelések fül mintájára köthető be.

## Élesítési teendők
1. Migrációk az éles DB-n (idempotensek): `order-payments.sql`, `invites-nume-tel.sql`, `company-eur-ron.sql`, `phase3-modules.sql`, `order-tracking.sql`, **`phase4-modules.sql`**.
2. Szerver-újraindítás (új handler-modulok + scheduler).
3. Böngészőben hard refresh (`Ctrl+Shift+R`).
4. Admin: 🔐 jogosultságok + 💱 árfolyam + diurna-ráták beállítása; developer: új funkciók (decont/expiries/service-log) csomag-hozzárendelése.
5. A `HERE_API_KEY` törölhető az `.env`-ből.
