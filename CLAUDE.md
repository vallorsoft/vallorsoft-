# CLAUDE.md — VallorSoft

Fuvarozási / flottakezelő webalkalmazás (Node.js + Express 5 + PostgreSQL).
**Kétnyelvű felület: román alap + magyar váltó** (`public/i18n.js`, `data-i18n`; téma-kapcsoló melletti nyelvváltó). A szerveroldali kifelé menő üzenetek románul (a push/e-mail kétnyelvű RO/HU). Román (RO) piacra szabott integrációkkal (**univerzális számlázó**: FGO/SmartBill/Oblio/iFactura/Facturis, ANAF/UIT e-fuvarlevél). PWA + web push, Firebase, multi-tenant (cégenként elkülönített adat).

> **Aktuális fókusz:** kinézet (UI) és funkciók javítása. A „Felületek és kinézet” szekció a térkép ehhez — melyik oldal melyik fájlokból áll, hol a CSS, mi a dizájn-rendszer.

## Fejlesztési állapot (2026-06-13)

Tesztek zöldek (**60 Jest**, 12 suite). **CI: GitHub Actions** (`.github/workflows/ci.yml`) — minden PR-en és main-push után `npm ci && npm test` Node 22 + **Postgres 16 service**-szel; ha van `DATABASE_URL`, a valódi-DB integrációs suite is fut (54 mock + 6 valós-DB), enélkül a 6 valós-DB teszt kihagyódik. Deploy-teendő: szerver-restart (a `db/*.sql` migrációk automatikusan lefutnak) + böngésző hard refresh.

> **Őszinte állapot / mi hiányzik az „egészhez" (2026-06-13):** a *funkciók* nagyrészt megvannak, a hiányok inkább megbízhatóság/üzemeltetés: **(1) CI + valódi tesztlefedettség** (ma a RO-fordítás némán elrontott 5 tesztet — nincs pusholáskori futtatás); **(2) teherautó-pontos routing + valós útdíj** (most OSRM autós profil = becslés); **(3) ANAF teljes bekötés** (e-Factura SPV-feltöltés; a sofőr-UIT `UIT_COMING_SOON`-nal KI); **(4) üzemeltetés**: hibamonitorozás, strukturált log, DB-backup, health-check; **(5) adat-konzisztencia**: `order_legs` vs `orders.email_sofer` igazságforrás rendezése; **(6) SaaS-vízvezeték**: csomag-limit kikényszerítés, önkiszolgáló fizetés, GDPR export/törlés, audit-napló.

**Legújabb kör (i18n RO-elsődlegesség + fuvar/tervezőtábla UX + sofőr-folyamat + teszt-zöldítés):**
1. **Kétnyelvű kifelé menő üzenetek (RO / HU együtt)** — push-értesítések (lejáró dok., áru-leadás, fuvar-státusz, chat) és a havi összefoglaló e-mail; a meghívó/jelszó-reset e-mail már korábban kétnyelvű volt (`lang`-param). HTML `<title>`-ök mind a 12 oldalon `data-i18n`-nel.
2. **Szerveroldali integráció-/válasz-üzenetek románra** (~310 string a `services/`+`handlers/`+`routes/`-ban: számlázó-adapterek, ANAF/UIT, GPS, validáció, `'Szerver hiba'→'Eroare de server'` stb.). A belső `console.*` naplók + kódkommentek magyarul maradtak; a kétnyelvű push-payloadok és a `lang`-os e-mail-sablonok érintetlenek. **A böngésző-felület RO-alap + HU-váltó.**
3. **Fuvar-kezelés hibajavítások** (`handlers/orders.js`, `routes/ordersRest.js`, `console-shared.js`): az **Extern** fuvar tévesen „Disponibil"-ként jelent meg a lista státusz-dropdownjában (hiányzott az opció) → javítva + ismeretlen státusz mindig beszúrva; a **Parkolt/Raktarban** dropdown-opció „Status invalid"-ot dobott → a `quick-status` route most ugyanazt fogadja, mint a `comUpdate`, és Raktarban-ból kilépéskor feloldja a raktári tételt; **fantom sofőr-név** (Extern→None váltáskor) → háromállapotú `nume_sofer` + extern mezők ürítése; a szerkesztőben sofőr-hozzárendelés **most lépteti** a státuszt (Disponibil→Alocat/Extern); elavult `telefon_extern`/`external_driver_id` törlése.
4. **Méretezhető + áthelyezhető fuvarlista-oszlopok** (`console-shared.js`): a fejléc jobb szélén húzható méretező-fogantyú, és a fejléc-cella **húzással átrendezhető** (HTML5 DnD); szélesség+sorrend `localStorage`-ban (`vs-cols-orders`, `{widths,order}` formátum); `table-layout:fixed` → a kiszabott fuvarok többsoros cellái is arányosan nőnek; „↔ Oszlopok" reset gomb. Az utolsó (checkbox) oszlop fixen a végén.
5. **Tervezőtábla méretezhető + áthelyezhető** (`planner.js`): jármű-sorok **átrendezése húzással** (⋮⋮ fogantyú, `vs-planner-veh-order`); **arányos zoom csúszka** (🔎 60–150% → oszlop/sormagasság/jármű-oszlop ÉS betűméret `--p2-rail`/`--p2-fs` CSS-változókkal); **táblán belüli méretezés** (RAIL + nap-oszlop W húzható); ↺ nézet-reset. A sáv-interakció (`rzStart` `colW()`-on át) és a kiosztás (`data-day`) érintetlen — a koordináta-matek helyes.
6. **Sofőr-folyamat átvizsgálás + javítás** (`handlers/orders.js`, `sofer.js`): a **Parkolt/Raktarban** fuvar is `dash_visible`, ha még a sofőrhöz van rendelve (nem tűnik el némán) + olvasható kártya (leadás helyével, gomb nélkül); `comUpdate` **email-normalizálás** (trim+lowercase, mint a create/planner úton). Az átvizsgálás megerősítette: a `finalized_at` trigger, a `driver-status` tulajdonos-ellenőrzés, a handover-kérés és a POD/UIT cég-szűrés helyesen bekötött.
7. **Teszt-zöldítés**: `npm install` (631 csomag) + **require-sweep** (mind a 77 szerver-modul tisztán betöltődik, 0 hiba) feltárta, hogy a RO-fordítás 5 tesztet elrontott (magyar szövegre illesztettek) → a teszt-elvárások a tényleges román szövegekre frissítve (`tests/integration/auth.test.js`, `execute.test.js`). **42/42 zöld.**

**Korábbi kör (cserélhető térkép-szolgáltató — megbízhatóság):**
1. **Cserélhető geokódolás + cím-autocomplete** (`lib/mapsProvider.js`) — cégenként **HERE** vagy **Google** kulcsos szolgáltató, VAGY az alap **ingyenes** (Photon/OSM). Minden keyes hívás **biztonságosan visszaesik az ingyenesre** hiba/kulcs-hiány esetén (sosem rosszabb a mostaninál). Tárolás: `company_integrations` `provider='maps'` (`meta.vendor`, `credentials_enc` AES). Beállítás: az **admin Integrációk fülén** „🗺️ Térkép-szolgáltató" kártya (`loadMapsProvider`, handlerek `mapsGetProvider`/`mapsSaveProvider`/`mapsTestProvider`). Bekötve: `/api/geo-autocomplete` (firebase.js) + `estimateRoute(waypoints, companyId)` geokódolása (`routeEstimate.js` → orderRouteEstimate/toll/inbound). **A routing/útdíj továbbra is OSRM/ORS** — HERE-routing+toll a következő lépcső.
2. **Használat-számláló + továbbszámlázás** (`maps_usage` + `maps_pricing` táblák, `db/maps-usage.sql`/`db/maps-pricing.sql`) — a fizetős (HERE/Google) hívásokat cégenként/havonta számolja (0-ról; csak a keyes geokódolás/keresés). A cégeknek **NINCS ingyenes keret** — az első hívástól fizetnek **hivatalos ár + árrés%** szerint. A hivatalos egységárat (EUR/hívás) + árrést a **developer** állítja a HERE pane-en (`devGetMapsPricing`/`devSaveMapsPricing`), és látja a cégenkénti fizetendőt (`devMapsUsageOverview`). A cég Integrációk-kártyáján e havi hívásszám + **fizetendő €** (`mapsGetProvider` `cost_month`).

**Korábbi kör (könyvelői felület — dokumentum-hub + SAGA/WinMentor export):**
1. **Könyvelő szerepkör** (`pozicio='Konyvelo'`) — **csak az admin hívhatja meg** (a meghívó-rendszeren át; Manager nem). A `/konyvelo` oldalra jut be. Migráció: `db/role-konyvelo.sql` (a users/invites CHECK-constraint bővítése).
2. **Dokumentum-hub** (`/konyvelo`, `public/konyvelo.html`+`konyvelo.js`) — minden dokumentum **fuvarra és dátumra rendezve** (megrendelés-dok, POD-fotó, alvállalkozói feltöltés), időszak-szűrővel, többes kijelöléssel. **Tömeges ZIP-letöltés** kijelölés VAGY teljes hónap alapján (`lib/zip.js` — függőség nélküli store-ZIP; `POST /api/accounting/zip`). Aggregálás: `handlers/accounting.js` `getAccountingDocs`.
3. **SAGA/WinMentor CSV-export** (`GET /api/accounting/invoices.csv?kind=sales|purchases`) — kimenő (`invoices`) és bejövő/alvállalkozói (`carrier_invoices`) számlák UTF-8 CSV-ben (BOM, `;` — Excel/könyvelő-import). Route: `routes/accounting.js` (jogosultság: Admin/Manager/Konyvelo). Nincs új tábla (a meglévőkre épül).

**Korábbi kör (alvállalkozó + szállítói számla/AP + alvállalkozói portál):**
1. **Alvállalkozó-törzs** (`carriers` tábla) — külsős fuvarozó-cégek: CUI, e-mail/tel, IBAN, fizetési határidő, CMR-biztosítás lejárata, nyitott tartozás. Backend: `handlers/carriers.js`. UI: a **Külső sofőrök fülön** „🚚 Alvállalkozók" blokk (`loadCarriers` a console-shared.js-ben).
2. **Szállítói számla (AP)** (`carrier_invoices`) — beérkező alvállalkozói számla rögzítése egy/több **Extern fuvarhoz kötve**, fizetési határidő, részfizetés/„Fizetve" követés; **Tartozás-áttekintés** öregítéssel (esedékes/lejárt). UI: „💸 Szállítói számlák / Tartozások" blokk (`loadCarrierAp`).
3. **Fuvar ↔ alvállalkozó + költség** (`orders.carrier_id/carrier_cost`) — a fuvar-szerkesztőben alvállalkozó-választó + **alvállalkozói díj** + élő **árrés** (bevétel − díj). A **Pénzügy → Fuvar-szintű eredmény** levonja az alvállalkozói díjat (Extern fuvarnál a valós költség).
4. **Alvállalkozói portál** (`/carrier`, OPT-IN `carrier-portal`) — a külsős fuvarozó saját belépéssel látja a rá osztott fuvarokat + díjat, **dokumentumot tölt le/fel** (megrendelés-visszaigazolás, aláírt CMR, számla), és **a saját járművét felviszi** (`carrier_vehicles`, a diszpécser is látja). Külön session-szerep (`req.session.carrierUser`), `company_id`+`carrier_id` szűrés. Backend: `routes/carrier-portal.js`; UI: `public/carrier.html` + `carrier.js`. Táblák: `carrier_users`, `carrier_vehicles`, `carrier_documents`. Migráció: `db/carriers-ap.sql`.

**Korábbi kör (útdíj-becslés — a fuvar-eredménybe építve):**
1. **Útdíj (toll) becslés** — a fuvar-szerkesztőben 🛣️ Becslés gomb: a fuvar útvonalából (`route_geo` waypointjai → OSRM polyline) **országonkénti km**-et számol (rács-cache-elt reverse-geokódolás `geo_country_cache`, Photon), és a cég útdíj-rátáival kiszámolja a díjat. Kézzel felülírható (`orders.toll_cost`), a bontás `orders.toll_geo`-ban. Backend: `lib/tollEstimate.js` + `handlers/toll.js` (`estimateToll`/`getTollRates`/`saveTollRates`). NEM hatósági pontosságú — kézi felülírás mindig lehet.
2. **Cégenkénti útdíj-ráták** (`toll_rates` tábla, EU-alapértékekkel): országonként km-alapú €/km **vagy** matrica-flat €/fuvar. Szerkesztő: ⚙️ Ráták modal a fuvar-szerkesztőből (`openTollRates`).
3. **Beépül a fuvar-eredménybe**: a **Pénzügy → Fuvar-szintű eredmény** (`getOrderProfit` + `stats.js`) levonja az útdíjat — a profit végre valós. Migráció: `db/order-toll.sql`.

**Korábbi kör (ügyfél-portál — OPT-IN):**
1. **Ügyfél-portál** (`/portal`) — a megrendelő (clients kapcsolattartója) saját belépéssel CSAK a saját cégének fuvarjait látja: státusz, élő GPS-követés (világos térkép), dokumentum-letöltés (CMR/visszaigazolás `order_documents` + POD-fotó `documents`), és **új fuvart igényelhet** (a diszpécser „Beérkező megrendelések" listájába kerül `inbound_orders.source='portal'`, jóváhagyással lesz élő). Külön session-szerep (`req.session.clientUser`), minden lekérdezés `company_id` ÉS `client_id` szerint szűr; belső adat (sofőr-személyes, költség, profit) nem kerül ki. Backend: `routes/portal.js` (+ rate-limitelt login), `handlers/clientPortal.js` (admin: meghívás/lista/letiltás). UI: `public/portal.html` + `portal.js`; admin oldalon az **Ügyfelek fülön** „Ügyfél-portál hozzáférések" blokk (`loadClientPortalAccess` a console-shared.js-ben). Tábla: `client_users`. Migráció: `db/client-portal.sql`.
2. **OPT-IN funkció-kapcsoló** `client-portal` (alapból KI; a developer cégenként kapcsolja — `feature-catalog.js` `optIn:true`). Szerveroldali kapu a portál-belépésnél is.

**Korábbi kör (fuvar CSV-import):**
1. **Tömeges fuvar-import CSV-ből** (📥 gomb a fuvar-kiírón) — feltöltés → elválasztó-felismerés → **oszlop-párosító** (minden fuvar-mezőre, fejléc-név alapján automata tippel) → előnézet → `bulkCreateOrders` (megengedő: minden nem üres sorból fuvar lesz; soronkénti auto-párosítás sofőr/jármű/pótkocsi). UI: `console-shared.js` (`openOrderImport`, `orderImportParse`, `oiBuildRow`, `orderImportRun`), modal JS-injektálva, CSS a style.css-ben.
2. **Ismeretlen oszlopok megőrzése** — a nem párosított oszlopok a fuvar `orders.import_extra` JSONB-jébe kerülnek (nem vész el adat), és a **szerkesztőben** „📋 Importált extra adatok" blokkban megnézhetők (`oeImportExtra`). Migráció: `db/order-import-extra.sql`.
3. **Funkció-kapcsoló** `orders-import` (alapból BE, a developer kikapcsolhatja — a gomb elrejtődik).

**Korábbi kör (rakomány-típus kötelező + méretek):**
1. **FTL/LTL kötelező ÚJ fuvar kiírásakor** (`*` jelölés) — kliens- és szerveroldali (`comCreate`) validáció (`validateLoadTypeDims` a handlers/orders.js-ben). A **már létező fuvarok szerkesztését NEM blokkolja** (`comUpdate`: a típus üresen maradhat; csak ha LTL-re állítják, akkor kötelezők a méretek).
2. **Rakomány-méretek** (`orders.hossz_cm/szel_cm/mag_cm`) — három mező (hossz/szél./mag. cm) a kiírón és a szerkesztőn. **FTL-nél opcionális, LTL-nél KÖTELEZŐ** (LTL kiválasztásakor a „méret kötelező" jelzés pirosra vált — `refreshDimReq`). A fuvarlistában az FTL/LTL badge mellett `📐 h×sz×m` jelzi a méretet (`comList` adja vissza). Migráció: `db/order-dimensions.sql`. (A pótkocsi `cargo_*_cm` rakfelülettel összevethető — jövőbeli radar-méretellenőrzés alapja.)

**Korábbi kör (térképes fuvar-kiírás — OPT-IN):**
1. **Térképes cím-kiegészítés + auto-km + útvonal-előnézet** a fuvar-kiírón és a szerkesztőn — a felrakó/lerakó címnél gépelésre Photon-találatok (autocomplete), és OSRM-mel automatikusan számolja a km-et. A km mező mellett 🗺️ gomb → előugró Leaflet-térkép az útvonallal; a térképen **köztespont** adható (cím vagy térkép-kattintás) a km finomításához — ezek **CSAK a km-számításhoz/előnézethez** vannak, **NEM** megállók (nem `order_legs`). Kézi km-et nem ír felül. Az útvonal a fuvaron `orders.route_geo` JSONB-ben őrződik (a szerkesztőben újra megnyitható). Endpoint: `orderRouteEstimate` (kapuzatlan az `utvonaltervezes` prémiumtól, de **opt-in** kapcsoló mögött). UI: `console-shared.js` (`vsAttachAutocomplete`, `orderRouteRecalc`, `openRouteMap` stb.).
2. **OPT-IN funkció-kapcsoló** `order-route-map` — a developer cégenként kapcsolja be (a Funkciók fülön; **alapból KI**, csak explicit `enabled=true` aktivál — `feature-catalog.js` `optIn:true`, a developer.html ezt külön kezeli). Kikapcsolva a kiíró a régi, kézi módban marad.
3. **Minden térkép MINDIG világos csempével** jelenik meg (Vezérlőpult, útvonaltervező, ügyfél-követő `track.html`, az új előnézet) — a felület témájától függetlenül. Migráció: `db/order-route-geo.sql`.
4. **Beérkező (email) megrendelés automata km-e** — a beolvasott fuvar jóváhagyásakor (`routes/inbound-orders.js` `/approve`), ha az `order-route-map` kapcsoló be van, a szerver kiszámolja az automata útvonal-km-et (közös `lib/routeEstimate.js`) és a `route_geo`-ba menti — a beolvasott km-et NEM írja felül. A **fuvarlistában** (Fuvarok kezelése) a beolvasott km mellett `🗺️` badge mutatja az automata km-et (`comList` `route_km`). Tranzakción kívül, best-effort (nem buktatja a jóváhagyást). Az email-beolvasó nézet érintetlen.

**Korábbi kör (vontató↔pótkocsi pár, radar GPS, részrakomány-súly, leadás rate-limit):**
1. **Vontató↔pótkocsi alapértelmezett pár** (`vehicles.default_trailer_id`) — a Belső sofőrök fülön a vontatóhoz rendelhető egy alapértelmezett pótkocsi; fuvar-kiíráskor (`comCreate`) és tervezőtáblás/radaros kiosztáskor (`plannerAssign`) a hiányzó pótkocsi automatikusan kitöltődik (`autoPairTrailer` a handlers/orders.js-ben; az űrlapon kliens-oldali látható kitöltés is — `orderFormPairFromVehicle`). Csak ÜRES mezőt tölt. Handler: `assignDefaultTrailer` (fleet.js).
2. **Visszfuvar-radar élő GPS-pozícióból** — a kamion pozíció-becslése: ha nincs (vagy a mai napig már lezárult) az utolsó fuvara, a valós CargoTrack-pozíciót használja (`📍 élő GPS`), különben az utolsó fuvar lerakóját geokódolja. A GPS-lekérés a **közös** `lib/vehiclePositions.js`-ből jön (a Vezérlőpulttal osztott 30 mp-es cache).
3. **Részrakomány súly-ellenőrzés** (`orders.suly_kg`) — a fuvarhoz súly rögzíthető (kiíró + szerkesztő űrlap); a radar az átfedő (részrakományos) fuvarok együttes súlyát összegzi, és `⚖️ túlsúly` badge-dzsel jelez, ha túllépi a pótkocsi rakható tömegét (`MAX_PARTIAL_PAYLOAD_KG = 24000`). NEM zárja ki a javaslatot.
4. **Sofőr-oldali leadás rate-limit** — a `driverHandoverRequest` csúszóablakos limit (max 5 kérés / 10 perc / sofőr, `lib/slidingWindow.js`) — a sofőr ne tudja push-spammelni az adminokat.
5. **FTL/LTL rakomány-típus** (`orders.load_type`) — két egymást kizáró pipa a kiíró + szerkesztő űrlapon (FTL = teljes áru, LTL = részrakomány); badge a fuvarlista útvonal-cellájában; a radar `🚫 FTL` jelzéssel mutatja, ha az átfedő fuvar teljes rakomány (részrakomány nem fér fel). Migráció: `db/order-load-type.sql`.

**Korábbi kör (main, `e25f643`):**
1. **Sofőr↔jármű auto-párosítás** — a Belső sofőrök fülön rögzített pár (`vehicles.assigned_driver_email`) alapján fuvar-kiíráskor / tervezőtáblás-radaros kiosztáskor a hiányzó fél automatikusan kitöltődik (szerver: `autoPairDriverVehicle`; az űrlapokon látható kliens-oldali kitöltés is). Csak üres mezőt tölt, Extern fuvarba nem nyúl.
2. **Átfedés-kezelés** — tervezőtáblán az átfedő fuvar csak sárga jelzés (részrakomány lehet, NEM hiba); az él-érintkezés (lerakó nap = következő felrakó nap) nem számít átfedésnek. A Visszfuvar-radar az átfedő fuvarú kamiont is javasolja `⚠️ átfedéssel` badge-dzsel.
3. **⛔ Áru-leadás + 📦 Raktár modul** — teljes folyamat (lásd részletesen lentebb a „⛔ Áru-leadás" szekciót): admin azonnali leadás / sofőr-kérés push-os visszaigazolással, `Parkolt`/`Raktarban` státuszok, Raktár fül, kötelező raktár-adatok + dokumentum-lapszám, folyamatos dok-figyelmeztetés.
4. **Pótkocsi rakodási felület** — `cargo_*_cm` + standard/mega, alapértelmezés 1360×248×260/305 cm (KÜLÖN a routing teljes méretétől).
5. **Biztonsági átvizsgálás lezárva** — payload-whitelist + hossz-korlátok, versenyhelyzet-védelem a visszaigazolásnál, szerveroldali `warehouse` feature-gate, raktári tétel életciklus-konzisztencia (dupla tétel / bent ragadás / árva sor javítva). Multi-tenant szűrés, szerepkörök, paraméteres SQL, XSS-védelem ellenőrizve az új kódban.

**Felmerült, még el nem kezdett ötletek:** méret-ellenőrzés részrakománynál (a súly már megvan; a fuvar-szintű rakdimenziók még nincsenek — `orders` rak-méret mezők + a pótkocsi `cargo_*_cm` rakfelülettel összevetve), radar valós közúti km (OSRM, a légvonal helyett), radar push-értesítés új találatnál.

## Futtatás / parancsok

```powershell
npx nodemon server.js               # fejlesztés (auto-reload)
node server.js                      # http://localhost:3000
node create-admin.js                # első admin (adatok a fájl tetején)
node test-db.js                     # DB-kapcsolat teszt
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # INTEGRATION_ENC_KEY
npm install                         # függőségek (pl. @here/flexpolyline a térképhez)
```

- **Nincs `npm test`-alapú CI**, de van Jest (lásd lentebb). Lint nincs. Tesztelés kézzel / Jesttel.
- A statikus fájlok (`public/*.html`, `*.js`, `*.css`) **újraindítás nélkül** frissülnek (express.static) → böngészőben elég **hard refresh** (`Ctrl+Shift+R`). **Szerver-oldali** változás (`handlers/`, `routes/`, `services/`) után **újraindítás kell** (`node server.js`).

## Architektúra

A `server.js` csak init + middleware + route-mount. Üzleti logika:

| Mappa | Szerep |
|-------|--------|
| `routes/` | Express route-modulok (REST endpointok + oldal-route-ok) |
| `handlers/` | A `/api/execute` RPC-dispatcher függvényei (domain-logika) |
| `services/` | Külső integrációk (számlázók, GPS, e-mail, push, AI, scheduler) |
| `middleware/` | `auth.js` (API: requireLogin/requireRole), `pageGuard.js` (oldalak) |
| `lib/` | `crypto.js` (AES-256-GCM), `diurna.js`, `herePool.js` (HERE pool-elszámolás), `hereUsage.js` (használat-naplózás) |
| `public/` | HTML oldalak + kliens JS-ek + `style.css` |
| `db/` | **Inkrementális migrációk** (külön a `schema.sql`-től) |

### Két API-minta
1. **RPC dispatcher** — `POST /api/execute` `{ functionName, arguments }`. A `routes/execute.js` az összes `handlers/*` modult egy registry-be fűzi (`auth`, `orders`, `users`, `invites`, `fleet`, `documents`, `dashboard`, `developer`, `routePlannerHandlers`, `hereFeatureHandlers`, `billingHandlers`, `intakeHandlers`). Handler: `async (req,res,args)`, válasz `res.json({ result: { ok, err?, ... } })`. A kliensoldali `gas(fn,args)` ezt hívja és a `d.result`-ot adja vissza.
2. **Klasszikus REST** — a többi `routes/*` (auth, soferApi, push, clients, cargotrack, invoices, uit, inbound-orders, client-mail, firebase, ordersRest). Válasz `{ success, message }`.

### Szerepkörök és védelem
- `req.session.user.pozicio` ∈ `Admin` | `Manager` | `Sofer` | `Konyvelo` (könyvelő — csak az admin hívhatja meg, a `/konyvelo` dokumentum-hubot látja), plusz `is_dev` flag.
- API: `requireLogin` → 401, `requireRole(...)` → 403. Oldalak: `requirePageLogin` / `requirePageRole(...)`.
- Oldal-route-ok: `/admin`, `/manager`, `/sofer`, `/konyvelo` (könyvelő), `/developer`, `/utvonaltervezes`, `/login`, `/register`, `/reset-password`. Külön (session-szerepes) portálok: `/portal` (ügyfél), `/carrier` (alvállalkozó), `/t/:token` (publikus követés).
- **Tiltott felhasználó** (`users.blocked=true`) nem tud belépni (login elutasít); developer nem tiltható.

### Multi-tenant
Szinte minden lekérdezés `company_id`-re szűr. Új lekérdezésnél MINDIG szűrj cégre. (Pl. a `vehicleUpdate` `WHERE id=$1 AND company_id=$2`.)

---

## Felületek és kinézet (UI)

### Dizájn-rendszer — `public/style.css`
**Glassmorphism, sötét alap.** A `:root`-ban CSS-változók (dizájn-tokenek):
- Háttér: `--bg-deepest #05070b`, `--bg-panel #0c1218`, `--bg-panel-raised #141c25`.
- Szöveg: `--text-primary #e9eef5`, `--text-muted #8a97a8`.
- Márka: `--brand-red #e10b1a` (a „Soft”), `--brand-white #fff` (a „Vallor”).
- Státusz: `--status-ok #22c55e`, `--status-warn #f59e0b`, `--status-danger #ef4444`, `--status-info #3b82f6`.
- Üveg: `--glass-bg-dark/--glass-border-dark` (sötét), `--glass-bg-light/--glass-border-light` (világos).
- Sarkok: `--radius-lg 18px`, `--radius-md 12px`, `--radius-sm 8px`. (Régebbi alias: `--r-lg/--r-md/--r-sm`.)
- Fő komponens-osztályok: `.glass`, `.glass-soft`, `.btn` (+`.primary/.danger/.ok/.ghost`), `.input/.select/.textarea`, `.badge` (+`ok/warn/err/info`), `.table`, `.toast`, `.stat-tile`, `.dash-*`.
- Betűtípus: **Inter** (Google Fonts), fallback Segoe UI / Roboto.

### Light / Dark téma
- A téma a **`.main-content[data-theme="dark|light"]`** attribútumon él (NEM a body-n). A **sidebar mindig sötét** (`.sidebar { background: var(--bg-deepest)!important }`).
- Kapcsoló: `.theme-toggle` gomb (🌙/☀️) a felső sávban; `toggleTheme()` a `console-shared.js`-ben, mentés `localStorage('vs-theme')`, villanásmentes inline init script a HTML-ben.
- Light-mode olvashatóság: a `.text-primary`/`.text-muted` osztályok + felülírások a `style.css` redesign blokkjában.

### Oldalak (mind `public/`-ban)

| Oldal | HTML | Kliens JS | Mit csinál |
|------|------|-----------|------------|
| **Login/Reg** | `login.html`, `register.html`, `reset-password.html` | inline | belépés, 2FA, regisztráció meghívókóddal |
| **Admin konzol** | `admin.html` | `console-shared.js` (közös) + `admin.js` | teljes vezérlőpult + összes admin fül |
| **Manager konzol** | `manager.html` | `console-shared.js` + `manager.js` | mint az admin, kevesebb joggal (nincs Integrációk) |
| **Sofőr** | `sofer.html` | `sofer.js`, `sofer.css` | mobil-first sofőr felület (alsó nav) |
| **Developer** | `developer.html` | inline `<script>` | cégek/userek kezelése, **funkció-kapcsolók**, **számlázási áttekintés + előfizetési csomagok + HERE-szolgáltatás árak**, hibajelentések (lila `#a855f7` akcentus) |
| **Útvonaltervezés** | `utvonaltervezes.html` | inline `<script>` | HERE térkép + teherjármű-routing (lásd lentebb) |

**Admin/Manager felépítés:** bal `.sidebar` (sötét, menücsoportok `data-tab`-okkal) + `.main-content#mainContent` (panes, `.pane[data-pane="..."]`). A fül-váltás `activateTab(name)` (console-shared.js): elrejti az összes `.pane`-t, megmutatja a kiválasztottat, és `loadTab(name)`-et hív (a szerep-JS-ben). Mobilon a sidebar hamburger-drawer.

**K17 refaktor — közös admin/manager kód:** a korábban duplikált ~600 sor (fuvar-szerkesztő modal, aláíró-motor, chatSend, fuvarlista-render, dekorátorok, beállítások-pane stb. — 19 függvény) a **console-shared.js végén** él a „KÖZÖS ADMIN/MANAGER KÓD” szekcióban — **ott javítsd, EGYSZER**. Az admin.js/manager.js már csak a szándékosan eltérő függvényeket tartalmazza (loadTab, loadUsers, editUser/saveUser/deleteUser, loadDocList, submitBugReport) + az állapot-deklarációkat (sign…, pdf…, _chat…, _oe… — a közös függvények a globális scope-láncon át érik el).

**Moduláris kliens-kártyák (`public/*.js`):** az egyes fülek külön JS-fájlokból állnak, amiket a szerep-JS hív be — pl. számlázó-integráció (`billing-card.js`), számlázás/számla-modal (`invoicing-card.js`, `invoice-modal.js`), GPS (`cargotrack-card.js`, `cargotrack-map.js`, `cargotrack-pairing.js`), e-mail intake (`email-intake-card.js`), beérkező megrendelések (`inbound-orders.js`), UIT (`uit-panel.js`, `sofer-uit.js`), ügyfelek (`clients-page.js`, `client-picker.js`, `client-mail.js`), push (`push-client.js`), session-őrzés (`session-guard.js`), **statisztika (`stats.js`)**.

**4. fázis:** 📅 Tervezőtábla 2.0 (`orders-planner` fül, `public/planner.js` — asztali **Gantt-idővonal** sáv-mozgatással/átméretezéssel, átfedés-jelzéssel (sárga, NEM hiba — részrakomány lehet; az él-érintkezés, azaz lerakó nap = következő felrakó nap, nem számít átfedésnek), kihasználtság-sorral; mobilon **napi nézet** koppintásos kiosztással; **💡 Visszfuvar-radar**: a kiosztatlan fuvarok automatikus párosítása a kamionok várható pozíciójával — az átfedő fuvarú kamion is javaslat, `⚠️ átfedéssel` jelzéssel — `getPlannerData`/`plannerAssign`/`getPlannerMatches`, geokód-cache: `db/geo-cache.sql`), ⛽ Üzemanyagkártya-import (`fuel-import` fül — generikus CSV oszlop-párosítással, `fuel_card_transactions`, kártya vs. sofőr-tankolás eltérés-riport), 📧 havi e-mail összefoglaló (scheduler, `monthly-report` kapcsoló, `monthly_report_log`), 🛰️ napi GPS km-óra snapshot (`gps_mileage_log` + GPS-km vs. menetlevél-km panel a jármű-statisztikán), 🎯 fuvar-szintű eredmény a Pénzügy fülön (`getOrderProfit` — a fuvarlevél-költségek `order_ids` szerinti szétosztása).

**⛔ Áru-leadás (megszakított fuvar) + 📦 Raktár:** ha az áru útközben gazdátlan marad (defekt, pótkocsi-csere), a fuvar `Parkolt` (áru megrakott pótkocsin) vagy `Raktarban` státuszba kerül — a fuvarlista TETEJÉN marad, a felrakója a leadás helye lesz (az eredeti útvonal a szakasz-történetben), és kiosztásra vár (tervezőtábla/radar is ajánlja). Indítás: fuvarlista ⛔ gomb (admin/manager, azonnal végleges) VAGY a sofőr felületről kérés (`driverHandoverRequest` → push az adminoknak → fuvarlista-banner → `confirmHandover`/`rejectHandover`, csak visszaigazolással végleges). Raktárba adásnál KÖTELEZŐ: darabszám+egység, foglalt hely (h/sz/m cm), súly, **dokumentum-lapszám**; a dokumentum-feltöltés nem blokkol, de amíg nincs (`documents.order_id`), folyamatos ⚠️ figyelmeztetés (fuvarlista + Raktár fül). UI: `warehouse` fül (feature-kapcsolós), modal/banner/raktár-render a console-shared.js végén, backend: `handlers/handover.js`, migráció: `db/cargo-handover.sql` (`warehouse_items`, `orders.handover_*`). Folytatás-kiosztáskor (`plannerAssign`) a státusz `Alocat`, a raktári tétel `Kiadva`. **Pótkocsi rakodási felület**: `vehicles.cargo_length/width/height_cm` + `trailer_kind` (standard/mega) — KÜLÖN a routing teljes járműméretétől; űrlap-alapértelmezés első bevitelnél 1360×248, magasság 260 (standard) / 305 (mega) cm.

**Flotta & Megfelelés (3. fázis):** `expiries` (⏰ lejárat-figyelés: ITP/RCA/rovinietă/tahográf — `document_expiries`, 12 órás scheduler push-riasztással + Vezérlőpult-sáv), `service-log` (🔧 szerviz-napló, költség a jármű-statisztikába), `decont` (💶 sofőr-elszámolás: előlegek vs. készpénzes költések + diurna-ráták). UI: `public/fleet-extra.js`, backend: `handlers/fleetCompliance.js`, migráció: `db/phase3-modules.sql`. Plusz: ügyfél fizetési határidő (`clients.payment_term_days`), e-Factura jelzés a fuvarlistán, 📷 POD fuvar-csatolás (`documents.order_id`, a sofőr fotója fuvarhoz köthető).

**Statisztika & Riport (📊 főmenü, legördülő):** 7 fül (`stats-overview/finance/fuel/purchases/drivers/vehicles/clients`) + admin-only `stats-permissions`. Backend: `handlers/statisticsHandlers.js`, UI: `public/stats.js` (Chart.js, jsdelivr). A **Pénzügy** fül jogosultsághoz kötött: Admin mindig látja, Manager csak ha az admin a 🔐 Jogosultságok fülön engedélyezte (`user_permissions`, `perm_key='stats_finance'` — hiányzó sor = NINCS engedély; a gate szerveroldalon is él). **Fizetés-követés:** a Finalizat fuvarokon 💰 gomb (fuvarlista + Pénzügy riport) — részfizetés kézzel vagy „Teljes hátralék” gombbal, `orders.payment_status/paid_amount/paid_at` (`markOrderPayment`). Pénznem: fuvar-ár EUR, sofőr-költség RON — NEM vonjuk össze. Állapot/teendők: `STATISTICS-NOTES.md`.

**Vezérlőpult (`dash` pane) — redesign:** felső sáv (cégnév + téma-kapcsoló), 4 stat-kártya (`.dash-stats`/`.stat-tile`: Összes/Aktív fuvar, Felhasználók, Menetlevelek), majd `.dash-grid` (55/45): bal = „Legutóbbi fuvarok” tábla + „Jármű státusz”, jobb = **Leaflet térkép** (élő GPS pozíciók, HERE v3 csempe). Renderelés: `loadDashboard()` (console-shared.js), adat: `getRecentOrders`, `getVehicleStatusSummary`, `getActiveVehiclePositions` (handlers/dashboard.js).

### Funkció-kapcsolók (előfizetés) — fontos a UI-hoz
- A developer **cégenként** ki/be kapcsolhat menüpontokat. Tárolás: `company_features(company_id, feature_key, enabled)`. **Hiányzó sor = bekapcsolva** (alapból minden elérhető); csak az explicit `enabled=false` rejt.
- Katalógus (egy forrás): **`public/feature-catalog.js`** → `window.VS_FEATURES = [{key,label,group,core?}]`. A `key` az admin/manager sidebar `data-tab`-ja (az `utvonaltervezes` a link). `core:true` (Beállítások) sosem kapcsolható ki.
- Admin/Manager belépéskor `applyFeatureFlags()` (console-shared.js) lekéri a `getMyFeatures`-t és **elrejti** a letiltott füleket/almenüket (üres szülő-menüt is). Az `/utvonaltervezes` szerveroldalon is védve (route redirect + `calculateRoute` gate).
- Developer felület: a cég **Részletek → ⚙️ Funkciók** fülén kapcsolók (`devGetCompanyFeatures` / `devSetCompanyFeature`).

### Útvonaltervezés — `public/utvonaltervezes.html` + `handlers/routePlannerHandlers.js`
- **TELJESEN INGYENES stack (a HERE le lett cserélve, nincs API-kulcs):** csempék **CartoDB/OSM** (kliens, light/dark), cím-autocomplete + geokódolás **Photon** (`photon.komoot.io`, proxy: `/api/here-autocomplete` = `/api/geo-autocomplete`), útvonal **OSRM** (`router.project-osrm.org`, autós profil, szakaszonként külön hívás → színezett leg-polyline-ok). Minden külső hívás szerver-oldali, udvarias User-Agenttel.
- Handlerek: `getOrdersForRoutePlanning`, `getVehiclesForRouting`, `getVehicleGpsPosition` (élő CargoTrack pozíció), `calculateRoute` (válasz-formátum a régi HERE-s klienssel kompatibilis: `polyline/legs/waypoints/notices/violations/fuelEstimateL`).
- **FIGYELEM:** az OSRM autós profil — kamion-korlátozásokat (súly/magasság) NEM vesz figyelembe; a jármű-paraméter űrlap a fogyasztás-becsléshez maradt, a felület jelzi ezt. A `violations`/`notices` üres. (Upgrade-út: OpenRouteService `driving-hgv` ingyenes kulccsal — lásd STATISTICS-NOTES.)
- A `HERE_API_KEY` és a `@here/flexpolyline` már nem szükséges; a `lib/herePool.js`/`hereUsage.js` + developer árazás megmaradt (legacy, nem naplóz új tranzakciót).

---

## Adatbázis

- **`schema.sql`** — teljes friss séma (`CREATE TABLE IF NOT EXISTS`).
- **`db/*.sql`** — inkrementális migrációk, NEM részei a `schema.sql`-nek. **AUTOMATIKUSAN lefutnak a szerver indulásakor** (server.js migráció-futtató: minden fájl pontosan egyszer, `schema_migrations` könyveléssel) — kézi futtatás NEM kell, csak restart/deploy. A lista (idempotensek):
  `integrations.sql`, `inbound-orders-migration.sql`, `uit-migration.sql`, `uit-anaf-confirm.sql`,
  `orders-client-link.sql`, `email-branding-migration.sql`, `remove-shift-compliance.sql`,
  **`vehicle-truck-params.sql`** (teherjármű routing-mezők a `vehicles`-hez),
  **`feature-flags.sql`** (`company_features` tábla + `users.blocked`),
  **`billing-integrations.sql`** (`billing_integrations` + `subscription_plans` + `companies.subscription_plan_id`),
  **`here-usage.sql`** (`here_feature_flags` árazás + `here_usage_log` használat-mérés),
  **`orders-finalized-at.sql`** (`orders.finalized_at` + trigger — a sofőr-nézet 3-napos kiöregítéséhez),
  **`document-series.sql`** (`document_series` tábla — menetlevél cégenkénti automatikus sorszámozás, MT-YYYY-XXXX),
  **`order-payments.sql`** (fizetés-követés: `orders.payment_status/paid_amount/paid_at` + `user_permissions` — statisztika-jogosultságok),
  **`invites-nume-tel.sql`** (`invites.nume/tel` — a meghívó-generálás ezek nélkül hibázik),
  **`company-eur-ron.sql`** (`companies.eur_ron_rate` — statisztika eredmény-számítás),
  **`phase3-modules.sql`** (flotta-modulok: `document_expiries` lejárat-figyelés + `driver_advances` decont + `vehicle_service_log` szerviz + `clients.payment_term_days` + `documents.order_id` POD + `companies.diurna_*_rate`),
  **`order-tracking.sql`** (`orders.tracking_token` — publikus ügyfél követő-link),
  **`phase4-modules.sql`** (`fuel_card_transactions` üzemanyagkártya-import + `monthly_report_log` havi e-mail riport + `gps_mileage_log` napi GPS km-óra snapshot),
  **`geo-cache.sql`** (helységnév→koordináta cache a Visszfuvar-radarhoz),
  **`driver-vehicle-assign.sql`** (`vehicles.assigned_driver_email` — sofőr↔jármű hozzárendelés a Belső sofőrök fülön, GPS-jelzéssel; **auto-párosítás**: fuvar-kiíráskor (`comCreate`) és tervezőtáblás/radaros kiosztáskor (`plannerAssign`) a hiányzó pár automatikusan kitöltődik — `autoPairDriverVehicle` a handlers/orders.js-ben; az űrlapokon kliens-oldali látható kitöltés is, csak üres mezőbe),
  **`cargo-handover.sql`** (áru-leadás: `orders.handover_*` + `warehouse_items` raktár-tételek + `vehicles.cargo_*_cm`/`trailer_kind` pótkocsi rakodási felület; státuszok: `Parkolt`/`Raktarban`),
  **`default-trailer-and-weight.sql`** (`vehicles.default_trailer_id` — vontató↔pótkocsi alapértelmezett pár, auto-párosítás `comCreate`/`plannerAssign`-nál a `autoPairTrailer`-rel; `orders.suly_kg` — fuvar-súly a radar részrakomány-ellenőrzéséhez),
  **`order-load-type.sql`** (`orders.load_type` — 'FTL' teljes rakomány / 'LTL' részrakomány; két egymást kizáró pipa a kiíró+szerkesztő űrlapon, badge a fuvarlistán, `🚫 FTL` jelzés a radarban ha az átfedő fuvar teljes áru),
  **`order-route-geo.sql`** (`orders.route_geo` JSONB — a térképes fuvar-kiírás útvonal-előnézete: `{waypoints, km, durationSeconds}`; a köztespontok NEM megállók. Az `order-route-map` opt-in kapcsoló mögött; endpoint `orderRouteEstimate`),
  **`order-dimensions.sql`** (`orders.hossz_cm/szel_cm/mag_cm` — fuvar rakomány-méretek; FTL-nél opcionális, LTL-nél kötelező; a kiíró+szerkesztő űrlap és a szerver — `validateLoadTypeDims` — is ellenőrzi),
  **`order-import-extra.sql`** (`orders.import_extra` JSONB — a fuvar CSV-import nem párosított oszlopai; `bulkCreateOrders` tölti, a szerkesztő „Importált extra adatok" blokkban mutatja),
  **`client-portal.sql`** (`client_users` tábla — ügyfél-portál belépés; `inbound_orders.source` — a portálról érkező fuvar-igény forrás-jelzése),
  **`order-toll.sql`** (`orders.toll_cost/toll_geo` — fuvar-útdíj + országonkénti bontás; `toll_rates` cégenkénti ráták; `geo_country_cache` lat/lng-rács → ország-kód az útdíj km-bontáshoz),
  **`carriers-ap.sql`** (alvállalkozó-modul: `carriers` törzs + `carrier_invoices` szállítói számlák/AP + `orders.carrier_id/carrier_cost` + alvállalkozói portál `carrier_users`/`carrier_vehicles`/`carrier_documents`),
  **`role-konyvelo.sql`** (a `users`/`invites.pozicio` CHECK-constraint bővítése a `Konyvelo` szerepkörrel — könyvelői felület),
  **`order-status-handover-check.sql`** (az `orders_status_check` bővítése `Parkolt`/`Raktarban`-nal — a `schema.sql` eredeti CHECK-je nem engedte ezeket, így friss DB-n az áru-leadás DB-szinten elhasalt volna; a valós-DB integrációs teszt tárta fel).
- Fő táblák: `companies` (+`subscription_plan_id`), `users` (+`blocked`, `pozicio_dev`, `totp_*`), `vehicles` (+`height_cm/width_cm/length_cm/weight_kg/weight_per_axle_kg/axle_count/trailer_count/truck_type/tunnel_category/hazardous_goods/fuel_per_100km`), `orders` (+`tractor_id/trailer_id/client_id` — gyakran NULL, a rendszám a tényleges hivatkozás), `order_legs`, `order_documents`, `fuvarlevelek`, `clients`, `company_integrations` (GPS + `provider='email_intake'` IMAP-konfig is itt, titkosítva), `vehicle_gps_map` (**rendszam↔object_id, NINCS tárolt lat/lng** — a pozíció élőben jön), `order_uit_codes`, `inbound_orders`, `company_branding`, `email_templates`, `client_emails`, `push_subscriptions`, `bug_reports`, **`company_features`**, **`billing_integrations`** (cégenkénti számlázó, `credentials` JSONB AES-titkosítva), **`subscription_plans`**, **`here_feature_flags`** (HERE szolgáltatás-árak), **`here_usage_log`** (havi tranzakció-napló), **`warehouse_items`** (raktárba adott áru — méretek/darabszám/súly/lapszám), `driver_shifts` (használaton kívül), `session`.

## Integrációk (services/)

- **Univerzális számlázó — `services/billing/`** — provider-független keretrendszer (`index.js` → `PROVIDERS` katalógus + `getAdapter(provider, creds)` factory). Adapterek: `fgo-adapter.js`, `smartbill-adapter.js`, `oblio-adapter.js`, `ifactura-adapter.js`, `facturis-adapter.js` (közös `http.js`). A felület a `getAvailableProviders` alapján **dinamikus űrlapot** rajzol (provider-enkénti mezők + közös opcionális számla-beállítások: `serie`, `default_tva`, `currency`). Cégenkénti beállítás a `billing_integrations` táblában, `credentials` JSONB **AES-256-GCM**-mel titkosítva; mentésnél/tesztnél az üresen hagyott mezők a tárolt értéket öröklik (jelszó-megőrzés). Handlerek: `billingHandlers.js`. **A FUVAR-SZÁMLÁZÁS IS EZEN MEGY (K09):** a `services/invoicing.js` `getInvoiceConfig`-ja ELŐSZÖR a `billing_integrations`-t nézi (aktív provider → `emitViaProvider` + `toFrameworkInvoice` fordítja a legacy payloadot `createInvoice` formátumra), és csak utána esik vissza a régi FGO-útra (`company_integrations` category='invoicing', `invoiceAdapter.js`/`fgo.js`). Tesztek: `tests/unit/invoicing-bridge.test.js`.
- **Térkép-szolgáltatások — INGYENES** (lásd Útvonaltervezés): OSM/CartoDB + Photon + OSRM, kulcs és díj nélkül. A korábbi HERE pool-elszámolás (`lib/herePool.js`, `lib/hereUsage.js`, `hereFeatureHandlers.js`, developer-árazás, `here_usage_log`) LEGACY — a kód megmaradt, de új tranzakció nem naplózódik.
- **`cargotrack.js` + `gps/`** (`cargotrack-et.js`, `fomco-et.js`) + `gpsAdapter.js` — GPS (FM-Track/Ruptela), jármű↔GPS párosítás. `getLatestStatus(apiKey, objectId)` → élő pozíció (lat/lng/speed/datetime). Kulcs titkosítva a `company_integrations`-ban. **Auto-rendszámfelismerés:** a párosító (`public/cargotrack-pairing.js`) a CargoTrack `plate`/`name` mezőjéből normalizált rendszám-**javaslatot** tölt elő a még nem párosított járműveknél (`lib/plate.js` `normalizePlate`: nagybetű + csak betű/szám, pl. `B 104 VLR → B104VLR`). A felhasználó a „✓ Mind mentése" gombbal vagy soronként hagyja jóvá, és szabadon javíthatja. A pozíció-handler (`getActiveVehiclePositions`) 30 mp-es szerver-cache-t használ + azonos `object_id`-kat összevon.
- **`email-intake.js`** + `order-ai/` (gemini + heurisztika) + `pdf-extract.js` — IMAP megrendelés-feldolgozás. **Cégenkénti IMAP-konfig a weboldalon** (`intakeHandlers.js`, tárolás `company_integrations` `provider='email_intake'`). A **`scheduler.js`** 2 percenként végigpörgeti az engedélyezett cégeket (`intake.pollOnce`); **csak az aktiválás (`since`) utáni leveleket** dolgozza fel. Feldolgozott megrendelések az `inbound_orders` táblában, egyszerre egy feldolgozatlan, lapozható nézetben.
- **`email.js`** (Brevo), **`webpush.js`/`push.js`** (VAPID), **`firebase.js`** (chat, admin token). A meghívó-e-mail a **MEGHÍVOTT** nevével köszön (nem a cég igazgatójáéval) — `sendInviteEmail(toEmail, kod, pozicio, cegNev, meghivottNev)`; a HTML törzs a tesztelhető `buildInviteHtml()`-ben (reszponzív, CTA-gombos, nyers URL-ek nélkül). Minden Brevo-hívás 15 mp-es timeouttal (`fetchT`), az interpolált értékek `escHtml`-lel.
- Integrációs kulcsok AES-256-GCM titkosítva (`lib/crypto.js`, `INTEGRATION_ENC_KEY`), maszkolva jelennek meg.

## Műszak (driver_shifts) — ELTÁVOLÍTVA
A sofőr-műszak funkció teljesen el lett távolítva mindhárom felületről. A `driver_shifts` tábla adatmegőrzésért maradt; semmi nem hivatkozik rá. (`db/remove-shift-compliance.sql`.)

## Környezeti változók (.env)

Lokálisan `.env` (gitignore-olt). Kötelező: `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV`, `APP_URL`, `INTEGRATION_ENC_KEY`.
Térkép: nincs kulcs — ingyenes OSM/Photon/OSRM (a `HERE_API_KEY` már NEM kell). Opcionális: **`ORS_API_KEY`** (OpenRouteService, ingyenes regisztráció) → az útvonaltervező kamionos `driving-hgv` profillal tervez, OSRM-fallbackkel.
Push: `VAPID_PUBLIC_KEY/PRIVATE_KEY/EMAIL`. E-mail: `BREVO_API_KEY`, `BREVO_SENDER`, `MAIL_USER`.
Firebase: `FIREBASE_API_KEY/AUTH_DOMAIN/DB_URL/PROJECT_ID/APP_ID/SERVICE_ACCOUNT`. AI: `GEMINI_API_KEY`, `GEMINI_MODEL` (egy modell) vagy `GEMINI_MODELS` (vesszős lista — modell-lánc). A kiolvasó (`order-ai/gemini.js`) egy **modell-láncon** megy végig: 429 (napi kvóta/sebességkorlát) esetén automatikusan a következő modellre vált, mert minden modellnek KÜLÖN napi ingyenes kerete van. Alap lánc: `gemini-2.0-flash → -flash-lite → 2.5-flash → 2.5-flash-lite → 1.5-flash → 1.5-flash-8b`.
Intake (opcionális): `INTAKE_IMAP_HOST/PORT/USER/PASS/TLS`, `INTAKE_COMPANY_ID`, `INTAKE_MAILBOX`.
Routing (opcionális): **`ORS_API_KEY`** (OpenRouteService, ingyenes) — az útvonaltervező **kamionos váltója** (🚛) ezzel él; alapból ingyenes autós (OSRM). Üzemeltetés (opcionális): **`LOG_FORMAT=json`** (alapból production-ban; strukturált JSON-log a `lib/logger`-ből), **`LOG_LEVEL`** (`debug|info|warn|error`, alap `info`).

## Üzemeltetés (health-check + log)
- **Health-check** (auth nélkül, `routes/health.js`): `GET /healthz` (liveness — a folyamat fut-e), `GET /readyz` (readiness — DB `SELECT 1`, 200/503). Load balancer / uptime-monitor / konténer ezeket pingeli.
- **Strukturált kérés-naplózás** (`middleware/requestLog.js` + `lib/logger.js`): minden API-/oldal-kérésre egy sor (metódus/út/státusz/idő/`X-Request-Id`), a statikus fájlokat és a health-t kihagyva. `LOG_FORMAT=json` esetén egysoros JSON (aggregátor-barát).
- **Globális védőháló** a `server.js`-ben: `unhandledRejection`/`uncaughtException` strukturált naplózással (a folyamat tovább fut), ismeretlen `/api` útra 404 JSON, és egy záró **hibakezelő** (sosem szivárogtat stack-trace-t a kliensnek).

## Konvenciók

- Kód és kommentek **magyarul**. Sok modul „bájtra azonos” a régi `server.js`-ből — óvatosan módosíts.
- Paraméteres SQL ($1, $2 …) — soha ne fűzz stringet lekérdezésbe.
- A védett HTML-eket a `routes/pages.js` szolgálja ki guard mögött; a többi statikus a `public/`-ból.
- **CSP (helmet):** csak `cdnjs.cloudflare.com` + `cdn.jsdelivr.net` engedélyezett script/style CDN (az **unpkg NEM**). Térkép-csempe/HERE képek az `imgSrc: https:` alatt mennek. Új kliens-könyvtárat cdnjs-ről tölts. Rate-limit a `/api/login` és `/api/forgot-password` végpontokon.
- Új kliens-könyvtár szerver oldali kulccsal: SOHA ne tedd a kulcsot kliens JS-be — proxy endpoint (mint `/api/here-config`).

## Élesítés (go-live) checklist

1. ✅ `.env` minden kulccsal (`INTEGRATION_ENC_KEY`; térkép-kulcs NEM kell).
2. ⬜ Szerver-restart/deploy → a `db/*.sql` migrációk AUTOMATIKUSAN lefutnak (log: „Migráció lefuttatva: …"); ellenőrzés a `schema_migrations` táblában (incl. `vehicle-truck-params.sql`, `feature-flags.sql`, `remove-shift-compliance.sql`, `billing-integrations.sql`, `here-usage.sql`, `orders-finalized-at.sql`, `document-series.sql`, `order-payments.sql`, `invites-nume-tel.sql`, `company-eur-ron.sql`, `phase3-modules.sql`, `order-tracking.sql`, `phase4-modules.sql`).
3. ⬜ `npm install` az éles szerveren (`@here/flexpolyline` stb.).
4. ⬜ Számlázó-integráció (pl. FGO) `test` → `production` a cég Integrációk fülén.
5. ⬜ Deploy: `NODE_ENV=production`, HTTPS, reverse proxy (trust proxy beállítva).

## Tesztelés

- Jest + supertest: `npm test`, `npm run test:watch`, `npm run test:coverage`.
- `tests/unit/` (crypto, diurna, invoiceAdapter), `tests/integration/` (auth, execute), `tests/helpers/` (db/session mock — éles DB nem kell).
- Szerveroldali handler gyors kézi tesztje: kis `node` script `require('dotenv').config()` + handler hívás mock `req`/`res`-szel (a fejlesztés során így ellenőriztük a route-tervezőt és a feature-kapcsolókat a valós DB-n).
