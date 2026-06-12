# CLAUDE.md — VallorSoft

Fuvarozási / flottakezelő webalkalmazás (Node.js + Express 5 + PostgreSQL).
Magyar nyelvű felület, román (RO) piacra szabott integrációkkal (**univerzális számlázó**: FGO/SmartBill/Oblio/iFactura/Facturis, ANAF/UIT e-fuvarlevél). PWA + web push, Firebase, multi-tenant (cégenként elkülönített adat).

> **Aktuális fókusz:** kinézet (UI) és funkciók javítása. A „Felületek és kinézet” szekció a térkép ehhez — melyik oldal melyik fájlokból áll, hol a CSS, mi a dizájn-rendszer.

## Fejlesztési állapot (2026-06-12)

Minden alábbi a **main-ben van** (utolsó commit: `e25f643`), tesztek zöldek (38 Jest). Deploy-teendő: szerver-restart (a `db/cargo-handover.sql` és `db/driver-vehicle-assign.sql` migráció automatikusan lefut) + böngésző hard refresh.

**Ebben a körben készült el:**
1. **Sofőr↔jármű auto-párosítás** — a Belső sofőrök fülön rögzített pár (`vehicles.assigned_driver_email`) alapján fuvar-kiíráskor / tervezőtáblás-radaros kiosztáskor a hiányzó fél automatikusan kitöltődik (szerver: `autoPairDriverVehicle`; az űrlapokon látható kliens-oldali kitöltés is). Csak üres mezőt tölt, Extern fuvarba nem nyúl.
2. **Átfedés-kezelés** — tervezőtáblán az átfedő fuvar csak sárga jelzés (részrakomány lehet, NEM hiba); az él-érintkezés (lerakó nap = következő felrakó nap) nem számít átfedésnek. A Visszfuvar-radar az átfedő fuvarú kamiont is javasolja `⚠️ átfedéssel` badge-dzsel.
3. **⛔ Áru-leadás + 📦 Raktár modul** — teljes folyamat (lásd részletesen lentebb a „⛔ Áru-leadás" szekciót): admin azonnali leadás / sofőr-kérés push-os visszaigazolással, `Parkolt`/`Raktarban` státuszok, Raktár fül, kötelező raktár-adatok + dokumentum-lapszám, folyamatos dok-figyelmeztetés.
4. **Pótkocsi rakodási felület** — `cargo_*_cm` + standard/mega, alapértelmezés 1360×248×260/305 cm (KÜLÖN a routing teljes méretétől).
5. **Biztonsági átvizsgálás lezárva** — payload-whitelist + hossz-korlátok, versenyhelyzet-védelem a visszaigazolásnál, szerveroldali `warehouse` feature-gate, raktári tétel életciklus-konzisztencia (dupla tétel / bent ragadás / árva sor javítva). Multi-tenant szűrés, szerepkörök, paraméteres SQL, XSS-védelem ellenőrizve az új kódban.

**Felmerült, még el nem kezdett ötletek:** vontató↔pótkocsi alapértelmezett pár (`default_trailer_id`), radar élő GPS-pozícióból, súly/méret-ellenőrzés részrakománynál (`orders.suly_kg` vs. pótkocsi rakfelület), sofőr-oldali leadás rate-limit.

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
- `req.session.user.pozicio` ∈ `Admin` | `Manager` | `Sofer`, plusz `is_dev` flag.
- API: `requireLogin` → 401, `requireRole(...)` → 403. Oldalak: `requirePageLogin` / `requirePageRole(...)`.
- Oldal-route-ok: `/admin`, `/manager`, `/sofer`, `/developer`, `/utvonaltervezes`, `/login`, `/register`, `/reset-password`.
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
  **`cargo-handover.sql`** (áru-leadás: `orders.handover_*` + `warehouse_items` raktár-tételek + `vehicles.cargo_*_cm`/`trailer_kind` pótkocsi rakodási felület; státuszok: `Parkolt`/`Raktarban`).
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
