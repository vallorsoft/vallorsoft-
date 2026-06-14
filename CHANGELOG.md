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
