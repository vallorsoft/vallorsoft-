# VallorSoft — Változásnapló (elvégzett munka)

> **Mire való ez a fájl?** Ide kerül MINDEN elvégzett és **mainre mergelt** feladat —
> dátummal, PR-számmal és rövid leírással —, hogy később **vissza lehessen lapozni,
> mi van kész**. Ez a „napirend kész oldala": a részletes architektúra/állapot a
> `CLAUDE.md`-ben, a biztonsági audit a `AUDIT.md`-ben él; ez a fájl a kronologikus,
> gyorsan átfutható kész-lista (legújabb felül).
>
> **SZABÁLY (kötelező, nem kell külön kérni):** minden befejezett (mergelt) feladat
> után **ide is be kell írni egy bejegyzést** (legfelülre), ÉS frissíteni kell a
> `CLAUDE.md` „Fejlesztési állapot" + `AUDIT.md` „Javítási napló" szekcióját. Egy
> feladat addig nincs kész, amíg ez a három hely (CHANGELOG + CLAUDE + AUDIT) nem
> tükrözi.

---

## 2026-06-14 — Multi-tenant adatszivárgás audit + javítás (PR #94)

- **3 agentes tenant-izolációs átvizsgálás** (handlers / routes / services+lib, ~87 fájl): hogy minden cég adata a saját `company_id`-jén belül maradjon.
- **1 KRITIKUS javítva** — `handlers/documents.js` `orderDocUpload`: a kliens-megadta `orderId`-t ownership-ellenőrzés nélkül szúrta be → „A" cég dokumentumot fűzhetett „B" cég fuvarához (cross-tenant write). Fix: INSERT előtt `SELECT 1 FROM orders WHERE id=$1 AND company_id=$2`; élesben verifikálva (saját→OK, idegen→blokkolva).
- **Defenzív:** `services/push.js` `sendPushToRole` JOIN köti a `u.company_id = ps.company_id`-t is.
- **Verifikált biztonságos:** routes (portál `client_id`, alvállalkozó `carrier_id`, developer-export is_dev-gated), services cégenkénti ciklusai + cache-kulcsai; az e-mail-alapú joinok nem kihasználhatók (`users.email` globálisan UNIQUE). 108 teszt zöld. Részletek: `AUDIT.md` 11. lépés.

---

## 2026-06-14 — FGO-menü ikonjavítás + átfogó átvilágítás (PR #92–#93)

- **FGO-menü javítás (PR #92):** a közvetlen menüpontoknál (Vezérlőpult/Ügyfelek/Belső Chat/Beállítások) a `data-i18n` a `.tab`-on volt → az i18n felülírta a teljes tartalmat és kitörölte az SVG ikont; a `data-i18n` a belső `<span>`-ra került (ikon megmarad). A sidebar 20px-es menü-rése 3px-re szűkítve (FGO-tömör).
- **Átfogó átvilágítás + élesben tesztelés (PR #93):** 3 agentes teljes átvizsgálás (HTML / kliens-JS / szerver) + futó szerveres tesztelés. Javítva: `cookies.html` olvashatatlan `.cookie-pref-btn` → indigó; login 2FA-hint kontraszt (WCAG-AA); jogi oldalak maradék márka-pirosa → indigó; kliens-JS szín-maradékok (email-intake/billing/client-mail/uit-panel/sofer/planner/console-shared) → landing kék/indigó/teal; cache-bust bump. **Élesben verifikálva:** publikus oldalak 200, védettek 302→login, nincs 500, `globalSearch`/`comList`/`dashStats` autentikáltan működik; require-sweep 82 modul 0 hiba; i18n teljes; 24 suite / 108 teszt zöld.

---

## 2026-06-14 — Fix felső sáv + ikonos FGO-menü + globális kereső (admin, PR #91)

- **Ikonos FGO-stílusú navigáció** az admin konzolon (`admin.html`): 10 főmenü / 32 menüpont, monokróm vonalas (Feather) inline SVG ikonokkal, generikus lenyitással (`toggleGroup`). Csoportosítás: Vezérlőpult · Fuvarok ▾ · Megrendelések ▾ · Dokumentumok ▾ · Flotta ▾ · Statisztika & Pénzügy ▾ · Ügyfelek · Kommunikáció · Adminisztráció ▾ · Beállítások. Üzemanyagkártya átkerült a Flottából az Adminisztrációba. A `data-tab` kulcsok/funkciók változatlanok.
- **Fix felső sáv** (a landing mintájára, sticky + elmosott háttér): breadcrumb (az `activateTab` frissíti) + globális kereső-trigger (`Ctrl+K`) + nyelv/téma kapcsoló; light + dark.
- **Globális kereső — command palette** (`public/global-search.js`, `Ctrl+K`): menü/navigáció (32 menüpont) + ÉLŐ adatkeresés (`handlers/globalSearch.js` RPC — fuvarok/ügyfelek/járművek/sofőrök, `company_id`-szűrt paraméteres `ILIKE`, kategóriánként LIMIT 6); billentyű-navigáció. Valós Postgres-en cross-kategóriás találat verifikálva; 108 teszt zöld. (Egyelőre csak admin; manager + többi konzol következő kör.)

---

## 2026-06-14 — Teljes weboldal redesign: landing prémium kék/indigó (PR #87–#90)

- **Teljes frontend-átszabás** a landing letisztult, prémium dizájnjára (világos alap, kék #3b82f6 / indigó #6366f1 paletta, mélység-effektek: gradiens kártyák + felső fény-csillanás + kék glow gombok + lágy radiális háttér-fény + gradiens KPI). **Csak megjelenés — funkció/JS/ID/data-i18n/route/RPC változatlan.** 6 agenttel párhuzamosan.
  - **Konzol (admin/manager)** — `style.css` redesign-`:root` + light/dark téma a landing palettán (light alapértelmezett, dark navy #080f1a→#0d1526), vizuális mélység-réteg; sidebar aktív elem indigó (PR #88, #89).
  - **Auth + jogi** (login/register/reset/terms/privacy/dpa/cookies/security), **sofőr** (`sofer.css` teljes re-skin), **developer + útvonaltervezés** (lila→kék/indigó), **ügyfél-portál + követés**, **alvállalkozó + könyvelő** — page-scoped skin, a közös `style.css`-t nem törve (PR #90).
  - **Konzol-JS szín-takarítás** — státusz-badge-ek világos-olvashatóra, Chart.js paletta kék/indigó, márka-piros → indigó (piros csak danger); térkép-csempék végig világosak maradnak (PR #90).
  - Verifikáció: 8 JS `node --check` ✅, CSS zárójel-egyensúly ✅, 15 HTML tag-balansz ✅, 24 suite / 108 teszt zöld.

---

## 2026-06-14 — Developer cégenkénti hozzáférés-statisztika (PR #86)

- **Developer „👥 Hozzáférések" fül** (`handlers/developer.js` `devCompanyAccess` + `public/developer.html` + i18n) — a cég részletek-modaljában cégenként: felhasználók + alvállalkozók + ügyfelek bontásban összes / aktív / inaktív / meghívott számok + ki mikor lépett be utoljára (last_login táblázat). A fő userek aktív=nem tiltott, meghívott=aktív (fel nem használt) invite; a portál-belépők (carrier_users/client_users) aktív=aktivált+bekapcsolt, meghívott=`pass_hash` NULL, inaktív=`activ`=false.
- **`users.last_login`** (`db/user-last-login.sql`) — a fő belépés (`routes/auth.js` `/api/login` + 2FA verify) mostantól frissíti (a portál-usereknek már volt last_login).

---

## 2026-06-14 — Ügyfél-portál: beküldött kérések megjelenítése (PR #85)

- **Ügyfél-portál mutatja a beküldött kéréseket** (`routes/portal.js` `/api/portal/orders` + `public/portal.js`) — a „📦 Transporturile tale" eddig csak a valódi fuvarokat mutatta, a kliens által beküldött, még el nem fogadott (függő) vagy **elutasított** kérések sehol nem látszottak. Mostantól a portál egy „📋 Beküldött kéréseid" szekcióban jeleníti meg a kliens portál-kéréseit státusszal (feldolgozás alatt / elutasítva); az elfogadott kihagyva (az már fuvarként látszik, nincs duplikálás). Új i18n kulcsok (RO+HU).

---

## 2026-06-14 — Tervezőtábla minden aktív fuvar + ügyfél automatikus (PR #84)

- **Tervezőtábla — minden aktív fuvar behozása** (`handlers/orders.js` `getPlannerData`) — eddig csak a dátum-ablakba eső fuvarokat hozta be, így egy aktív (nem Finalizat/Anulat) fuvar, aminek a dátuma a látott héten kívül esett (pl. múlt heti, még `In Curs`), eltűnt a nézetből és a pool-ból is. Mostantól minden aktív státuszú fuvar (`Disponibil`/`Alocat`/`In Curs`/`Extern`/`Parkolt`/`Raktarban`) bekerül a dátumtól függetlenül; a dátumozott (akár Finalizat) az ablakban marad; `Anulat` kizárva.
- **Ügyfél kérés → fuvar: a megrendelő automatikus** — a diszpécsernek nem kell külön beírnia az ügyfelet. `client-requests.js` `collect()` az eredeti `extracted`-ből indul (a nem látható `client` kulcs nem vész el mentés/elfogadáskor); az `approve` szerver-oldalon a portál forrás-e-mailjéből (`client_users → clients.denumire`) feloldja az ügyfél nevét **és linkeli** a fuvart a meglévő ügyfél-rekordhoz (`orders.client_id`).

---

## 2026-06-14 — Ügyfél kérések fül + lebegő fuvarkérés-értesítő

- **Lebegő, oldalfüggetlen értesítő-sáv** (`console-shared.js` `startInboundWatcher`/`refreshInboundCount`) — minden admin/manager fülön látszik, amíg van feldolgozatlan beérkező (portál + e-mail intake); 45 mp-es polling (`GET /api/inbound-orders/count`), kattintásra a megfelelő fülre ugrik, sidebar-badge a „Megrendelések" (e-mail) és az „Ügyfél kérések" (portál) menüponton. Új beérkezésnél toast + web push az adminoknak/managereknek (`routes/portal.js` `sendPushToRole`, kétnyelvű RO/HU).
- **Új „📋 Ügyfél kérések" fül** a Fuvarfeladatok menüben (`public/client-requests.js`, `data-tab=client-requests`) — az ügyfél-portálról érkezett kérések (`inbound_orders` `source='portal'`) **ügyfelenként lenyitható szekcióban**, a kérések **dátum szerint naplózva**. Minden kérés teljes, szerkeszthető áru-adatlap; ha van csatolt dokumentum: „📄 Kiolvasás" (AI-reparse) → „✓ Elfogadás" valódi fuvarrá (Disponibil) / „✕ Elvetés". A portál-kérések **többé nem a „Megrendelések" (e-mail intake) fülön** jelennek meg (`?source=`/`?exclude_source=` szűrő a list-endpointon).
- **Bővített portál fuvar-igénylő űrlap** (`portal.html`/`portal.js`) — teljes áru-bevitel (referencia, fel-/lerakó, dátumok, súly, FTL/LTL, méretek, megjegyzés) **minden mező opcionális** + **opcionális dokumentum-feltöltés** (PDF/kép, max 10 MB, base64). Az approve a teljes áru-adatot átviszi a fuvarba (`suly_kg`/`load_type`/`hossz_cm`/`szel_cm`/`mag_cm`). Új i18n kulcsok (RO+HU).
- **Finomítás (PR #83):** az ügyfél-szekción belül a kérések alapból **összecsukott sorként** (sorszám beérkezés-sorrendben + „van/nincs csatolt fájl" jelző + dátum + státusz), **kattintásra nyílik** a teljes adatlap (a lenyitott állapot újratöltéskor megőrződik). **AI-kapcsoló** a fejlécben (cég-szintű, közös a Megrendelésekkel) — a „📄 Kiolvasás (AI)" a `reparse`-szal automatikusan kitölti a mezőket, mint a normál fuvar-kiolvasásnál.

---

## 2026-06-14 — Developer export 500 teljes javítás (PR #81)

- **PR #81 mergelt** — **`routes/developer-export.js` további 5 tábla oszlopnév-javítás + `lib/zip.js` mappa-struktúra.** A #80 csak az orders/order_legs lekérdezést igazította, de a clients (`cui`→`cui_cif`, `contact_person` törölve), vehicles (`marka`→`marca`, `tipus`→`tip`, `ev`→`an`), fuvarlevelek (`order_ids`/`data_completare`/`km_inceput` stb.), inbound_orders (`subject`/`confidence`/`source_email` stb.) és order_uit_codes (`valid_until`/`rendszam`/`provider`) is rossz neveket használt. A clients/vehicles nem volt `.catch`-elve → ezek dobták a tartós 500-at. `lib/zip.js` `uniqueName` mostantól megtartja a `/`-t mappa-elválasztóként (eddig `csv/orders.csv`→`csv_orders.csv` laposodott; a könyvelői hub is profitál). Valós Postgres 16-on verifikálva: mind a 14 export-lekérdezés hibamentes, a route 200-at ad érvényes ZIP-pel; 24 suite / 108 teszt zöld.

---

## 2026-06-14 — Automatikus Render deploy (PR #80)

- **PR #80 mergelt** — **CI auto-deploy** (`.github/workflows/ci.yml`): új `deploy` job, amely main-push esetén a tesztek sikeres lefutása után automatikusan élesít Render-re (`RENDER_DEPLOY_HOOK_URL` GitHub Secret curl POST hívással). PR-eken NEM fut, csak main-pushnál.

---

## 2026-06-14 — Developer cég-adatexport ZIP hibajavítás

- **PR mergelt** — **`routes/developer-export.js` SQL oszlopnév-javítás**: az export route az `orders` és `order_legs` táblákból nem létező oszlopneveket kérdezett le (`rendszam`, `felrako`, `lerako`, `indulas`, `erkezes`, `ar`, `ar_valuta`, `megjegyzes` az orders-nél; `cim`, `lat`, `lng`, `sorrend`, `tipus`, `megjegyzes` az order_legs-nél) → PostgreSQL azonnal hibát dobott → 500-as „Eroare de server" a UI-n. Javítva a tényleges mezőnevekre: `pret`, `loc_incarcare/descarcare`, `data_incarcare/descarcare`, `rendszam_camion/remorca`, `leg_number`, `loc_preluare/predare` stb.

---

## 2026-06-14 — Landing page teljes újraírás + 📦 gomb javítás

- **PR (jelen)** — **Landing page SaaS redesign** (`index.html` + `landing.css` teljes újraírás): sticky navbar, sötét gradiens hero (meglévő GPS SVG monitor megmaradva), 5-oszlopos feature strip, 8-kártyás modulszekció, 10 integrációs logo placeholder (`/fgologo.png` stb., onerror fallback), sötét stats sáv (98%/50+/1000+/24/7), 3 testimonial, 3 árazási terv (Professional kiemelt), CTA szekció, 4-oszlopos footer. `lp-` prefixes design token CSS, breakpointok 1024/640px.
- **PR (jelen)** — **📦 export gomb XSS-javítás** (`developer.html`): az `exportCeg` onclick attribútumból eltávolítva a `JSON.stringify(c.nev)` — csak `id` megy át, a nevet `_cegekCache`-ből olvassa a függvény (ugyanaz a minta mint `deleteCeg`/`openCegDetail`).

---

## 2026-06-14 — Jogi megfelelőség (GDPR/T&C) + Developer cég-adatexport ZIP

- **PR (jelen)** — **Jogi oldalak kiegészítése (terms, privacy, dpa, cookies, security) + regisztrációs checkbox (T&C / Privacy elfogadás).** A meglévő HTML-fájlokhoz pontosan a megadott szövegek hozzáadva; register.html-ben kötelező checkbox pár (Terms + Privacy) JS-validációval — a regisztráció nem indítható elfogadás nélkül. CLAUDE.md jogi/GDPR szekció hozzáadva (cégadatok, adatfeldolgozók, jogalapok, megőrzési idők, EU–US DPF).
- **PR (jelen)** — **Developer cég-adatexport ZIP** (szerződésbontási GDPR-kötelezettség). Új 📦 gomb a developer oldal minden cégkártyáján → `GET /api/developer/export/:id` (is_dev gated). A ZIP tartalmaz: `csv/` (orders, order_legs, clients, vehicles, carriers, users jelszó nélkül, invoices, carrier_invoices, fuvarlevelek, inbound_orders, order_uit_codes) + `documents/` (order_documents bináris) + `pod/` (POD fotók) + `carrier_docs/` (alvállalkozói dok). 400 MB vészfék. Forrás: `routes/developer-export.js` + `lib/zip.js` (meglévő).

---

## 2026-06-14 — UI/hibajavító kör (Ügyfelek oldal) + CI-zöldítés

- **PR #74** (`3367323`) — **Ügyfél-portál meghívó szerver-hiba javítva.** A „Meghívó
  küldése" gomb `Eroare de server`-t dobott: a `handlers/clientPortal.js` és a
  `routes/portal.js` (belépés + jelszó-beállítás) a NEM létező `clients.nev` oszlopra
  hivatkozott — a tábla név-oszlopa `denumire`. Javítva mindhárom helyen; a meghívó
  mostantól kecsesen leromlik e-mail-konfig nélkül is (set-password linket ad vissza
  `emailed:false`-szal, 500 helyett). Valós Postgres-szel reprodukálva + igazolva.
- **PR #73** (`236ab2b`) — **Világos/sötét téma szín-hibák az Ügyfelek oldalon.**
  Téma-érzékeny `.cp-client-drop` legördülő (világos: világos háttér + sötét betű;
  sötét: sötét háttér + világos betű) és a mentett-ügyfelek tábla (`clients-page.js`)
  sötét-módú felülírásai + a halvány világos-módú betű javítása.
- **PR #72** (`51d54c7`) — **CI-zöldítés (valódi ok):** a `dev-integrations` valódi-DB
  teszt a per-provider UIT API-ra igazítva (`uit_template` → `uit_templates` map +
  `uit_template_legacy` + `gps_providers`). A teszt csak `DATABASE_URL` mellett fut,
  ezért lokálisan kimaradt, a CI-ben viszont piros volt. Valós Postgres 16-tal
  verifikálva: 24 suite / 108 teszt zöld.
- **PR #71** (`bfdad61`) — **CI-zöldítés:** a `db/uit-deeplink-per-provider.sql`
  migráció `DO $$ IF EXISTS … $$` guardot kapott a régi `uit_deeplink_template`
  oszlopra (friss DB-n nem létezik → `column does not exist`).
- **`f83126e`** — Ügyfél-választó legördülő: `c.nev` → `c.denumire` mezőnév (a `#5/#6`
  helyett valódi nevek), data-attribútumos onclick (speciális karakterek nem törik),
  light-mode hover-szín.
- **PR #69** (`45e8a5f`) — **Ügyfél-portál: kereshető ügyfél-választó legördülő** a sima
  `<select>` helyett (kereső mező a tetején, a hozzáadott ügyfelekből választható).
- **PR #68** (`69c451c`) — **e-Factura automata státusz-lekérdezés** (3 órás scheduler,
  SmartBill/Oblio `getInvoice` valós API) **+ UIT deeplink refaktor** (GPS→ANAF küldés
  eltávolítva, per-provider deeplink sablon `companies.uit_deeplink_templates` JSONB,
  developer állítja GPS-providerenként) **+ ANAF CUI strukturált cím** (utca/helység/
  megye külön).

## 2026-06-14 előtti történet

A korábbi körök részletei a **`CLAUDE.md`** „Fejlesztési állapot" szekciójában
(kör-listák, legújabbtól visszafelé) és az **`AUDIT.md`** „Javítási napló (élő státusz)"
részében találhatók. Innentől minden új kör ebbe a fájlba is bekerül.
