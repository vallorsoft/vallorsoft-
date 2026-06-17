# CLAUDE.md — VallorSoft

> ## ⚠️ ELSŐ SZABÁLY — MINDEN ÚJÍTÁS ELŐTT OLVASD EL (mindig)
> **A projekt ÉRETT, működő rendszer. Semmit nem építünk a vákuumba.** Bármilyen új funkció / módosítás / „újítás” előtt — akár új beszélgető-ablakban kérem, akár nem, ezt NEM kell külön kérnem:
> 1. **Először keresd meg, létezik-e már** a kért dolog vagy egy közeli rokona (grep/Explore). Ami már megvan, azt **ahhoz igazítjuk / kibővítjük / javítjuk**, NEM építünk párhuzamos másodikat.
> 2. **Illeszd a meglévő mintákhoz**: RPC `handlers/` + `routes/execute.js` registry VAGY klasszikus REST `routes/`; közös admin/manager kód a `console-shared.js` „KÖZÖS” szekciójában (ott javítsd, EGYSZER); dizájn-tokenek a `public/style.css` `:root`-jából; i18n `data-i18n` + RO-alap/HU-váltó; multi-tenant `company_id`-szűrés; paraméteres SQL.
> 3. **Ne törj el kész dolgot.** Már KÉSZ és bekötött (ne építsd újra, csak igazítsd, ha kell): **audit-napló, GDPR export/anonimizálás, csomag-limit kikényszerítés, Stripe-váz, health-check, strukturált log, opcionális Sentry, pg_dump backup**, univerzális számlázó (5 provider), térkép-stack (OSM/Photon/OSRM + opc. HERE/Google), útdíj-becslés, áru-leadás/raktár, alvállalkozó/AP, ügyfél- és alvállalkozói portál, könyvelői hub, statisztika, tervezőtábla/radar.
> 4. **Migráció = inkrementális `db/*.sql`** (auto-fut induláskor, `schema_migrations` könyvelés) — ne nyúlj a `schema.sql`-hez meglévő tábla módosításához.
> 5. **A végén:** `npm test` zöld + (ha van) require-sweep, majd commit a megadott feature-branchre, **PR létrehozása és merge** (nem kell külön kérni — az elvégzett és jóváhagyott feladatokat mindig PR-ral mergeld mainre).
> 6. **NAPIRENDET FRISSÍTENI (kötelező, nem kell külön kérni):** minden befejezett (mergelt) feladat után **MINDIG** vezesd át három helyen, hogy később vissza lehessen lapozni, mi van kész: (a) **`CHANGELOG.md`** — új bejegyzés LEGFELÜLRE (dátum + PR-szám + rövid leírás); (b) ennek a fájlnak (`CLAUDE.md`) a „Fejlesztési állapot" szekciója (új „Legújabb kör" + dátum); (c) **`AUDIT.md`** „Javítási napló (élő státusz)" — ha biztonsági/audit-tételt érint. Egy feladat addig NEM kész, amíg ez a három hely nem tükrözi.
>
> Röviden: **igazíts, ne duplikálj; bővíts, ne törj; a kész munkát írd a napirendbe.**
>
> ### Keresztmetsző KÖTELEZŐ kör — minden új funkcióra automatikusan alkalmazom (nem kell kérni)
> **Infra (magától jár):** strukturált kérés-log + globális hibakezelő (nem szivárog stack-trace) + health-check + opc. Sentry; `db/*.sql` migráció-futtató; i18n/téma-betöltő; session/auth middleware; CSP/helmet/rate-limit.
> **Konvenció (ezt én kötöm be minden új funkcióba):**
> 1. **Multi-tenant**: minden SQL `WHERE company_id=$x` (`req.session.user.company_id`).
> 2. **Paraméteres SQL** ($1,$2…), soha string-összefűzés.
> 3. **Kétnyelvűség (RO-alap+HU)**: felület `data-i18n`/`t()` (RO+HU pár az `i18n.js`-ben); szerver-hibaüzenet/validáció/integráció-válasz **románul**; push/e-mail a usernek **csak románul** (a HU szövegek eltávolítva — PR #136); belső `console.*`+komment magyarul.
> 4. **Szerep-/jogvédelem**: API `requireLogin`+`requireRole`; oldal `requirePageLogin/Role`; RPC-nél a handlerben.
> 5. **Audit-napló**: minden írásra (create/update/delete, státuszváltás, pénzügy/integráció) `audit.fromReq(req,'domain.action',entityType,entityId,detail)` — best-effort (`lib/audit.js`).
> 6. **GDPR**: ha személyes adatot tárol (név/e-mail/tel/GPS) → bekötés `handlers/gdpr.js` `exportUserData` + `anonymizeUser` körébe.
> 7. **Csomag-limit**: ha számolható erőforrást hoz létre → `planLimits.checkLimit(cid, kind)` a create-úton (NULL-limit = korlátlan; `lib/planLimits.js`).
> 8. **Funkció-kapcsoló**: ha önálló menüpont/oldal → `public/feature-catalog.js` (`key=data-tab`) + szerver-kapu ha kell.
> 9. **Titkosítás**: integrációs kulcs/jelszó AES-256-GCM (`lib/crypto.js`, `INTEGRATION_ENC_KEY`), maszkolva, kliensbe sosem (proxy endpoint).
> 10. **Migráció**: séma-változás = új inkrementális `db/*.sql` (nem a `schema.sql`).
>
> *Megjegyzés: a 4–9 nem globális hook, hanem bevett konvenció — a `checkLimit`/`audit.fromReq`/`gdpr.js`/`crypto.js` segédek teszik egysorossá. A meglévő funkciók fokozatosan kapják meg (nem visszamenőleges tömegmunka), az ÚJ funkciók viszont mindig.*

Fuvarozási / flottakezelő webalkalmazás (Node.js + Express 5 + PostgreSQL).
**Kétnyelvű felület: román alap + magyar váltó** (`public/i18n.js`, `data-i18n`; téma-kapcsoló melletti nyelvváltó). A szerveroldali kifelé menő üzenetek románul (a push/e-mail kétnyelvű RO/HU). Román (RO) piacra szabott integrációkkal (**univerzális számlázó**: FGO/SmartBill/Oblio/iFactura/Facturis, ANAF/UIT e-fuvarlevél). PWA + web push, Firebase, multi-tenant (cégenként elkülönített adat).

> **Aktuális fókusz:** kinézet (UI) és funkciók javítása. A „Felületek és kinézet” szekció a térkép ehhez — melyik oldal melyik fájlokból áll, hol a CSS, mi a dizájn-rendszer.
>
> ### 📍 Hol tartunk (2026-06-15 vége) — állapot + következő fókusz
> **KÉSZ ebben a nagy körben (PR #87–#94, mind mergelve + élesítve):**
> - **Teljes frontend-redesign** a landing prémium kék/indigó palettájára (világos-alap + dark navy; gradiens kártyák, felső sheen, kék glow gombok, gradiens KPI) — MINDEN oldal (admin/manager konzol, auth, jogi, sofőr `sofer.css`, developer, útvonaltervezés, ügyfél-portál, követés, alvállalkozó, könyvelő). Csak megjelenés, funkció érintetlen.
> - **Admin konzol FGO-elrendezés:** ikonos (monokróm vonalas SVG) 10-főmenüs sidebar (32 menüpont), **fix felső sáv** (breadcrumb + nyelv/téma), **globális kereső** (`Ctrl+K` command palette: menü-navigáció + élő adatkeresés `handlers/globalSearch.js`-en át — fuvar/ügyfél/jármű/sofőr, `company_id`-szűrt).
> - **Átfogó átvilágítás** (3 agent: HTML/JS/szerver) + élesben (futó szerver) tesztelés: olvashatóság/kontraszt-javítások, szín-maradékok rendezése, 108 teszt zöld, require-sweep 82 modul 0 hiba.
> - **Multi-tenant adatszivárgás-audit** (`AUDIT.md` 11. lépés): 1 KRITIKUS cross-tenant write (`orderDocUpload`) javítva, defenzív push.js megerősítés; a többi réteg verifikáltan izolált.
>
> **MÉG NINCS / nyitott (következő alkalmakra):**
> - **KÖVETKEZŐ FÓKUSZ: a LANDING PAGE** (`index.html` + `landing.css` + `landing.js`) — finomítás/bővítés. Ötlet a lezárt #77-ből: „showcase" szekció (3 monitor + 2 telefon mockup, `public/img/` képekkel) átemelése a JELENLEGI prémium landingre (a régi verzió visszahozása nélkül). A #77 PR lezárva (elavult volt), a tartalmát NEM mergeltük.
> - **✅ KÉSZ — Manager FGO-menüsítés:** az ikonos főmenü + fix felső sáv + globális kereső már a **manageren is** (a manager tényleges menüpontjaival). A **developer** (`developer.html`, saját inline-nav) és a **könyvelő** (`konyvelo.html`, egylapos dok-hub) szándékosan más szerkezetű — ezek NEM kaptak FGO-sidebart (nem console-shared.js-alapúak); ha kell, külön kör.
> - **✅ KÉSZ — Globális kereső bővítés:** a `globalSearch` már keres fuvar/ügyfél/jármű/sofőr + **megrendelések/menetlevelek/számlák** közt is.
> - Lásd még lent a „Nyitott jövőbeli munka" (Stripe éles, SAF-T) — nem sürgős.

## Fejlesztési állapot (2026-06-15)

Tesztek zöldek (**106 Jest**, 24 suite). **CI: GitHub Actions** (`.github/workflows/ci.yml`) — minden PR-en és main-push után `npm ci && npm test` Node 22 + **Postgres 16 service**-szel; ha van `DATABASE_URL`, a valódi-DB integrációs suite is fut, enélkül azok kihagyódnak (a CI `--runInBand`/soros — a valódi-DB fájlok közös DB-t használnak). Deploy-teendő: szerver-restart (a `db/*.sql` migrációk automatikusan lefutnak) + böngésző hard refresh.

> **Hiánylista — a 2026-06-13-i ütemterv LEZÁRVA:** **(1) ✅ CI + valódi tesztek** (mock + valós-DB, 106 teszt); **(2) ✅ teherautó-routing váltó** (ORS `driving-hgv`, alap ingyenes OSRM) **+ ✅ valós útdíj váltó** (HERE „Pontos", alap becslés); **(3) ✅ UIT CargoTrack deep-link** (ANAF-integráció helyett, providerkénti URL-sablon — `uit_deeplink_templates` JSONB; `cargotrack-et.js`/`fomco-et.js` törölve); **(4) ✅ üzemeltetés** (health-check `/healthz`+`/readyz`, strukturált log, opcionális Sentry, opcionális pg_dump backup); **(5) ✅ leg ↔ `orders.email_sofer` szinkron**; **(6) ✅ SaaS-vízvezeték** (csomag-limit kikényszerítés, audit-napló, GDPR export/anonimizálás, Stripe-váz); **(7) ✅ e-Factura státusz automatikus lekérdezés** (3 órás scheduler, SmartBill/Oblio `getInvoice` implementálva, `efactura_last_raw`/`efactura_checked_at` tárolás); **(8) ✅ ANAF CUI strukturált cím** (utca/helység/megye külön mezők, `adresa_sediu_social` alapján). **Nyitott jövőbeli munka:** Stripe éles bekötés (kulcsok + price_xxx — utolsó lépés, nem sürgős), SAF-T D406 XML (jövőbeli javaslat, a könyvelő SAGA/WinMentor CSV-ből generál egyelőre). **RO megfelelőség:** a rendszer megfelel — minden ANAF-kommunikáció (e-Factura SPV-beküldés) a számlázó-providereken (FGO/SmartBill/Oblio stb.) keresztül történik, saját ANAF-kapcsolat NEM kell és NEM is akarunk. Az UIT-kódot sem mi generáljuk — a sofőr/cég a CargoTrack/Fomco deep-linken keresztül intézi. A GPS→ANAF élő e-Transport-transzmisszió NEM feladatunk.

**Legújabb kör (2026-06-17 — CargoTMS-hézagok Fázis A/2: Alvállalkozó-csoportok + Kedvenc helyszínek, PR #168):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Alvállalkozó-csoportok** (`db/carrier-groups.sql` + `handlers/carriers.js`): `carrier_groups` + `carriers.group_id`; `carrierGroupList/Save/Delete` + `carrierSetGroup`. Biztonság: fuvarozó↔csoport kötés előtt mindkét entitás tulajdon-ellenőrzése, `_am` kapu, audit. UI a Külső sofőrök fülön (csoport-kezelő + szűrő).
2. **Kedvenc helyszínek** (`db/fav-locations.sql` + `handlers/favLocations.js`): `favorite_locations`; company_id-szűrt, input-korlát, `type` fehérlista, audit. UI: `fav-locations` (Beállítások) + gyors-kitöltés a fuvar-űrlapon (Photon megőrizve). `feature-catalog`+`i18n` (RO-alap+HU), cache-bust `?v=20260617a2`; 93 Jest zöld.
3. **Folyamatban:** Fázis B (Operatív központ, SLA, jármű/sofőr-adatlap) → C → D. Bursă kihagyva.

**Korábbi kör (2026-06-17 — CargoTMS-hézagok Fázis A/1: BNR + Teljesített fuvarok + Aktív flotta, PR #167):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **BNR árfolyam** (`handlers/bnr.js`, Pénzügy) — élő EUR/RON (`services/bnr.js`) + cég-ráta; **Teljesített fuvarok** (`handlers/ordersDone.js`, Fuvarok) — `Finalizat`-archív + CSV; **Aktív flotta** (Flotta) — a meglévő GPS-handlerek dedikált térkép-nézetben. Mind read-only, `company_id`-szűrt + paraméteres, Admin/Manager kapu.
2. **Wiring:** új `public/console-pages.js`, `loadTab` admin/manager, `feature-catalog.js` (3 kulcs), `i18n.js` (RO-alap+HU). Cache-bust `?v=20260617a1`; 93 Jest zöld.
3. **Folyamatban (CargoTMS-hiánylista):** Fázis A/2 (Alvállalkozó-csoportok + Kedvenc helyszínek) → B (Operatív központ, SLA, jármű/sofőr-adatlap) → C (Árajánlatok, Értesítések+Mail-napló, e-mail/PDF sablon, granulált jog, fizetési ütemterv, branding) → D (tabos fuvar-adatlap, ügyfél-profil). Bursă kihagyva.

**Korábbi kör (2026-06-16 — Pénzügy: Kimenő + Bejövő számlák almenük, PR #166):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Új végpont** `routes/invoices.js` `GET /api/invoices` — cégre szűrt (`company_id=$1`) kimenő számla-lista, paraméteres `?from=&to=`, generikus hiba. **📤 Kimenő számlák** (`public/invoices-out.js`): lista + KPI-sáv, a műveletek a MEGLÉVŐ végpontokon (PDF/storno/státusz); a per-fuvar 🧾 kiállítás érintetlen.
2. **📥 Bejövő számlák** (`invoices-in`): a kész alvállalkozói AP (`loadCarrierAp`) **áthelyezve** ide a Külső sofőröktől (egyetlen `#carrierApBox`/konzol, nincs duplikáció); az alvállalkozó-törzs ott marad.
3. **Wiring:** `loadTab` admin/manager, `feature-catalog.js` (Pénzügy), `i18n.js` (RO-alap+HU). Cache-bust `?v=20260616inv`. Biztonság: új végpont `company_id`-szűrt + paraméteres, auth/billing érintetlen; 93 Jest zöld.

**Korábbi kör (2026-06-16 — Meleg paletta-hézagok lezárása, PR #165):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökérok:** `style.css` `.main-content .btn.primary` régi **`!important` kék** gradiense ütötte felül a meleget → minden konzol-gomb kék maradt; most napnyugta gradiens. (`.stat-val`/`.stat-ico` is.)
2. **Modul-kártyák** (`billing-card.js`/`cargotrack-card.js`/`cargotrack-pairing.js`) kék akcentjei melegre; **e-mail-intake** + **chat** kártya téma-érzékeny olvasható melegre (`.eic`/`.chat-*`); a külön **`utvonaltervezes.html`** (saját inline) átszínezve (gombok/háttér/logó), a Leaflet érintetlen.
3. Csak szín; cache-bust `?v=20260616warm2`; 93 Jest zöld. **Ezzel a teljes meleg arculat (konzol + landing + e-mail + külön oldalak) lezárva** — a Bursă/tőzsde továbbra is kihagyva (kérésre).

**Korábbi kör (2026-06-16 — KPI-sáv érték-HTML fix + e-mail sablonok átszínezése, PR #164):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **HIBAJAVÍTÁS `console-shared.js` `vsBandInner`** — a KPI-sáv `v` (érték) **nem escape-elt** többé (a hívók megbízható megjelenítő HTML-t adnak, pl. mértékegység `<span>`); eddig nyersként jelent meg a Statisztika-oldalakon. A címke/sub/trend escape-elt marad. Cache-bust `?v=20260616fix`.
2. **E-mail sablonok meleg átszínezése** (`services/email.js`, `routes/trial-select.js`, `services/scheduler.js`, `routes/public-register.js`) — csak szín; szöveg/link/változó/tárgy/küldés érintetlen; státusz-színek megőrizve; 93 Jest zöld.
3. **Még hátra (paletta-hézagok):** modul-kártya gombok (Integrációk), e-mail-intake/chat sötét kártya, külön Útvonaltervezés oldal (saját inline stílus) — következő kör.

**Korábbi kör (2026-06-16 — Avatar + pirula a többi listatáblán, PR #163):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Közös `vsAvatar(name)`** (`console-shared.js`, escape-elt monogram) + `.vs-av`/`.vs-cellpill` CSS (téma-érzékeny) — a fuvar-tábla kinézete kiterjesztve: **Munkatársak** (avatar + `pozicio`-pirula), **Belső/Külső sofőrök** (avatar), **Ügyfelek** (avatar). Display-only, minden gomb/oszlop megőrizve. Cache-bust `?v=20260616pill`; 93 Jest zöld.
2. **Még hátra (kérésre):** az összes e-mail sablon átszínezése a meleg palettára (`services/email.js`, `routes/trial-select.js`, `services/scheduler.js`) — csak szín.

**Korábbi kör (2026-06-16 — ÚJ modul: e-CMR digitális fuvarlevél, PR #162):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`db/ecmr.sql` + `handlers/ecmr.js`** — egy fuvarhoz tartozó e-CMR, max. 3 fél (feladó/fuvarozó/címzett) aláírásával (`order_ecmr` tábla, idempotens migráció). **Biztonság:** `ecmrCreate` a fuvar tulajdonjogát ellenőrzi beszúrás előtt (nincs cross-tenant write); minden SQL `company_id`-szűrt + paraméteres; `ecmrSign` oszlopnév a `PARTIES` fehérlistából; `isAdminManager` kapu; input-korlátok; audit minden íráson.
2. **GDPR:** `handlers/gdpr.js` `exportCompanyData` kibővítve az e-CMR aláírás-adataival (a 6. szabály szerint). Anonimizálás NEM (jogi megőrzés Legea 82/1991 → 5 év). `routes/developer-export.js` is tartalmazza.
3. **Frontend:** `public/ecmr.js` (📝 aloldal a Dokumentumok alatt) + `feature-catalog.js` + `i18n.js` (RO-alap+HU) + `routes/execute.js` regisztráció. Cache-bust `?v=20260616ecmr`; 93 Jest zöld. **A Bursă/tőzsde szándékosan KIMARADT** (kérésre). Hátra: státusz-pirula/avatar a többi táblára (opcionális).

**Korábbi kör (2026-06-16 — ÚJ modul: CO₂ riport, PR #161):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`handlers/statisticsHandlers.js` `getCo2Report`** — új Statisztika-aloldal (`stats-co2`): a cég CO₂-kibocsátása a már tárolt üzemanyag-/km-adatból (diesel 2,64 kg/l, AdBlue kizárva). **Read-only, `_isAdminOrManager` kapu, minden SQL `company_id`-szűrt + paraméteres** (üzemanyag közvetlen; km a `FUV_FROM` users-joinján át), nincs új tábla, nincs személyes adat. Össz. CO₂/liter/CO₂-per-100km/fa-egyenérték + havi bontás + jármű top-10.
2. **`public/stats.js` `loadCo2`** (`.tall` sáv + Chart.js + tábla + CSV), `admin.html`/`manager.html` 🌱 aloldal + pane, `feature-catalog.js`, `i18n.js` (RO-alap+HU). Cache-bust `?v=20260616co2`; 93 Jest zöld.
3. **Még hátra (Bursă KIVÉVE):** e-CMR (valódi MVP, aláírás-folyamat) + státusz-pirula/avatar a többi táblára.

**Korábbi kör (2026-06-16 — Landing page meleg átszínezés, PR #160):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`public/landing.css`** — a publikus landing a konzol meleg arculatát kapja: `--lp-*` tokenek kék/indigó → napnyugta narancs(`#f6711e`)/korall(`#f6517b`) + krém(`#faf6f0`) + espresso(`#1e1812`) + meleg teal(`#0d9488`). CSAK szín; tartalom/layout/szöveg/i18n/JS érintetlen, státusz-színek megőrizve. Cache-bust `landing.css?v=20260616warmland`; 93 Jest zöld.
2. **Folyamatban (a Bursă/tőzsde KIVÉVE):** státusz-pirula/avatar a többi listatáblára → CO₂-riport (valódi) → e-CMR (valódi MVP) — mind külön PR, multi-tenant/auth/paraméteres SQL/audit betartva.

**Korábbi kör (2026-06-16 — Fázis 2 / 9. lépés: teljes meleg paletta a konzolon, PR #159):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`public/style.css`** — a konzol egységes **meleg arculatot** kap (krém + espresso + napnyugta akcent) a kék/indigó helyett: konzolra szűkített (`.main-content`/`.sidebar`/`.vs-topbar`), **additív** blokk a fájl VÉGÉN (a meglévő szabályok érintetlenek → könnyen visszavonható; más oldalakat nem érint). Világos + sötét (espresso, nem navy) téma is; sidebar espresso-gradiens; primary/link/aktív/fókusz/logó → napnyugta narancs; „info/folyamatban" → meleg teal.
2. **Tervezőtábla** layout/szélesség változatlan (csak átszínezés); a Visszfuvar-radar meleg keretet kap. A KPI-sáv/`.vsl-*`/`.h-title` harmonizál. Cache-bust `?v=20260616warm`. Nincs JS/HTML/handler/biztonság-érintés; 93 Jest zöld. *(Vizuális finomhangolás élesben várható.)*
3. **Még hátra (opcionális):** a `.vsl-*` státusz-pilla/avatar kiterjesztése a többi listatáblára; a 3 ÚJ modul (Bursă/e-CMR/CO₂) — külön döntésre.

**Korábbi kör (2026-06-16 — Fázis 2 / 8. lépés: Fuvarok-kezelés tábla vizuális gazdagítás, PR #158):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`console-shared.js` `renderFilteredOrders`** — a fuvar-tábla a mockup kinézetét kapja: vizuális útvonal (felrakó • ─→ 📍 lerakó), sofőr-monogram-avatar (`vslAvatar`), státusz-pirula (`<select>`-re `vsl-pill` osztály, a funkció érintetlen), sor-bal státuszcsík. CSAK megjelenés — a 10 oszlop, oszlop-méretezés/átrendezés, kijelölés, tömeges letöltés, inline státusz-váltó, akciógombok byte-pontosan megőrizve.
2. **`style.css`** — `#tblOrders`-re **szűkített** `.vsl-*` szabályok (nincs globális hatás). Cache-bust `?v=20260616olist`. Backend/SQL/auth nem változott; 93 Jest zöld.
3. **Még hátra:** C kiterjesztése a többi listatáblára; D — teljes meleg paletta a konzolon (**a Tervezőtábla maradjon teljes szélességben mint eddig; a Visszfuvar-radar kaphat új arculatot**). Standing: minden gomb működjön, biztonság/adatszivárgás végig figyelve.

**Korábbi kör (2026-06-16 — Fázis 2 / 7. lépés: egységes oldal-fej, PR #157):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`public/style.css`** — a panel-/szekciócímek finom napnyugta-gradiens **akcent-csíkot** kapnak (`.main-content .h-title::before`, `--vs-warm-grad`), egységes ritmussal. CSS-only, konzolra szűkítve, abszolút `::before` (nem rendezi át a cím gyerekeit), könnyen visszavonható. Cache-bust `?v=20260616band6`.
2. Nincs HTML-átírás, nincs funkció-/backend-érintés; 93 Jest zöld. Ezzel a **B (egységes oldal-fej)** alap-szintje kész.
3. **Még hátra (KÜLÖN JÓVÁHAGYÁSSAL):** C — táblázat-csiszolás (státusz-pillák, sor-akciók, útvonal-vizu, avatar; a fuvar-tábla funkcióit érinti → kockázatos); D — meleg paletta konzol-szintű kiterjesztése (nagy, átfogó színváltás).

**Korábbi kör (2026-06-16 — Fázis 2 / 6. lépés: KPI-sáv a Beérkező + Ügyfél kérések oldalon, PR #156):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`inbound-orders.js`** (`#ioBand`: Feldolgozatlan/Elintézett/Összes a már lekért adatból) + **`client-requests.js`** (`#crBand`: Összes/Új/Elvetett a status-mezőből) kompakt sávot kap; additív, a listák/elfogadás/AI-kiolvasás érintetlenek; `typeof`-guard.
2. **`i18n.js`** +`inb.kpi*`/`cr.kpi*` (RO-alap+HU); cache-bust `?v=20260616band5`. **Ezzel az A (KPI-sávok) kör lezárult** — a sáv minden releváns oldalon él. Backend/SQL/auth nem változott; 93 Jest zöld.
3. **Még hátra:** B (egységes oldal-fej) — additív, sok panelt érint; majd a kockázatos C (táblázat-csiszolás) + D (meleg paletta) — **külön jóváhagyással**.

**Korábbi kör (2026-06-16 — Fázis 2 / 5. lépés: KPI-sáv a Járművek + Ügyfelek oldalon, PR #155):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`console-shared.js`** (`loadVehicles`: Járművek összesen/Vontatók/Pótkocsik a `#vehiclesMetricBand`-be) + **`clients-page.js`** (`renderBand`: Ügyfelek összesen/Cégek/Magánszemélyek a `#clMetricBand`-be) kompakt sávot kap a már lekért listából; additív, a táblák/űrlapok/ANAF/portál érintetlenek.
2. **`i18n.js`** +`veh.bandTotal`, `cl.band*` (RO-alap+HU); `admin.html`/`manager.html` `#vehiclesMetricBand` + cache-bust `?v=20260616band4`. Backend/SQL/auth nem változott; 93 Jest zöld.
3. **Még hátra (additív):** Beérkező megrendelések + Ügyfél kérések sáv, egységes oldal-fej. Kockázatos: C (táblázat-csiszolás) + D (meleg paletta) — **külön jóváhagyással**.

**Korábbi kör (2026-06-16 — Fázis 2 / 4. lépés: KPI-sáv a Lejáratok + Üzemanyagkártya oldalon, PR #154):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`public/fleet-extra.js`** — `loadExpiries` (Figyelt dok./Hamarosan/Lejárt/Rendben a `_expItems`-ből) és `fcLoadData` (Tankolás/Liter/Költség a fuel `total`-ból) kompakt `vsMetricBand`-et kap; additív, az űrlapok/táblák/CSV/eltérés-riport érintetlenek; `typeof`-guard.
2. **`public/i18n.js`** — új `fe.exp.kpi*` / `fe.fc.kpi*` kulcsok (RO-alap+HU). Cache-bust `?v=20260616band3`. Backend/SQL/auth nem változott; 93 Jest zöld.
3. **Következő (additív):** Járművek/Ügyfelek/Beérkező sáv + egységes oldal-fej; majd a kockázatos C (táblázat-csiszolás) + D (meleg paletta) — ezek **külön jóváhagyással**.

**Korábbi kör (2026-06-16 — Fázis 2 / 3. lépés: KPI-sáv a Fuvarok-kezelés oldalon, PR #153):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`public/console-shared.js`** — `renderOrdersMetricBand`: a `loadOrders` a `comList` teljes listájából számolt KPI-kkal tölti a (kompakt) sávot (Összes/Aktív/Kiosztásra vár/Lezárt); additív, a táblázat és funkciói (oszlop-átméretezés/átrendezés, kijelölés, letöltés, státusz-dropdown) **érintetlenek**, nincs új hálózati hívás, nincs koholt trend.
2. **`admin.html`/`manager.html`** — `#ordersMetricBand` a cím alatt; `i18n.js` +2 kulcs (`list.kpiWaiting`/`list.kpiClosed`); cache-bust `?v=20260616band2`. 93 Jest zöld.
3. **Következő:** további listaoldalak (Járművek/Ügyfelek/Lejáratok/…) + egységes oldal-fej; majd táblázat-csiszolás (óvatosan, a tábla-funkciókat megőrizve) és a meleg paletta konzol-szintű kiterjesztése.

**Korábbi kör (2026-06-16 — Fázis 2 / 2. lépés: KPI-sáv a Statisztikán + Sofőr-elszámoláson, PR #152):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`public/stats.js`** — a `.tall` `vsMetricBand` kiterjesztve a riport-oldalakra (Áttekintés/Pénzügy/Fogyasztás/Vásárlások) a régi `.dash-stats` csempék helyett; a jogosultság-feltételes mutatók (beszedett/kintlévőség/eredmény) megőrizve. Grafikon/tábla/szűrő/CSV érintetlen.
2. **`public/fleet-extra.js`** — a `decont` 4 csempéje a sávra cserélve. Eredeti i18n-címkék + értékek, **nincs koholt trend** (a handlerek nem adnak idősort). Backend/SQL/auth nem változott; 93 Jest zöld.
3. **Következő:** listaoldalak (Fuvarok-kezelés/Járművek/Ügyfelek/Lejáratok/…) sáv + egységes oldal-fej (a tábla-funkciókat megőrizve), majd táblázat-csiszolás és a meleg paletta konzol-szintű kiterjesztése.

**Korábbi kör (2026-06-16 — Fázis 2 / 1. lépés: interaktív KPI mutató-sáv a Vezérlőpulton, PR #151):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Új közös komponens `vsMetricBand`** (`public/console-shared.js` + `public/style.css` `.vsmb*`) — a KPI-négyzetek helyett egy **85/15 mutató-sáv**: balra nagy gradiens fő-szám (meleg napnyugta akcent `--vs-warm-grad`), jobbra 3 kis kocka egymás alatt, a kockák árnyalata a **fontossági sorrend** szerint (narancs-skála). **Kattintásra cserél** (a kocka a grafikonra ugrik, a fő-szám vissza). Alap alacsony; `.tall` mód a Statisztikának. Téma-érzékeny + reszponzív.
2. **Vezérlőpult bekötve valós adattal** — `loadDashboard` egy `Promise.all`-ban (`dashStats`+`userListAll`+`getFuvarlevelek`) tölti a sávot (Összes/Aktív fuvar, Felhasználók, Menetlevél); a `t`/idősor opcionális → nincs koholt trend. `admin.html`/`manager.html`: `#dashMetricBand` konténer, cache-bust `?v=20260616band`. 93 Jest zöld.
3. **Háttér:** a teljes Fázis-2 arculatot (meleg paletta, oldalankénti sáv + oldal-fej/táblázat-csiszolás) végigkattintható prototípusban hagytuk jóvá; ez az 1. éles lépés (Vezérlőpult). A többi oldal inkrementálisan jön; a 3 ÚJ modul (Bursă/e-CMR/CO₂) még prototípus, külön döntésre.

**Korábbi kör (2026-06-16 — Menü-átrendezés 1. fázis: domének szerinti csoportosítás, PR #149):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`public/admin.html` + `public/manager.html`** — a sidebar főmenü-csoportok a CargoTMS-mintára domének szerint átrendezve (saját kinézet, vonalas SVG ikonok, accordion megtartva — CSAK az elrendezés): a külön „Megrendelések" főmenü a **Fuvarok** alá olvadt (beérkező + ügyfél-kérések); az **Üzemanyagkártya** a **Flotta** csoportba; új **„Pénzügy"** csoport (Pénzügy-riport + Sofőr-elszámolás a Statisztikából kiemelve); a **Jogosultságok** (admin) + **Aláírás & bélyegző** az **Adminisztráció** csoportba; a **Statisztika** ezután tisztán riport. Admin↔manager egységes váz.
2. **`public/i18n.js`** — 2 új csoport-fejléc kulcs (`nav.financeHead`, `nav.statsHead`, RO-alap+HU); cache-bust `i18n.js?v=20260616menu`. A `data-tab` kulcsok, `pane`-ek és minden menü-logika (`[id$="ParentTab"]` feature-flag rejtés, accordion, beérkező-badge) változatlan. 93 Jest zöld.
3. **Jóváhagyott, még nyitott:** 2. fázis — megjelenés-csiszolás (egységes oldal-fej + űrlap-kártya + táblázat-pillák); a Lejárat/Szerviz felvitele a jármű/sofőr adatlapról is (a globális lista megtartásával).

**Korábbi kör (2026-06-16 — Landing árazás: csomag-feature-ek a kiválasztott nyelven):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`db/zz-plan-features-bilingual-final.sql`** (ÚJ migráció) — a 4 csomag `subscription_plans.features`-ét kétnyelvű `{ro,hu}` objektumokra állítja. A `zz-` előtag miatt minden korábbi feature-állító migráció (`package-setup*.sql` egynyelvű HU stringek) UTÁN fut → ez a végső; éles DB-n a következő deploykor egyszer lefut. A `f[lang]`-render így a választott nyelven (RO-alap) mutatja a feature-listát.

**Korábbi kör (2026-06-16 — Landing: nincs egymás melletti kétnyelvű felirat):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`landing.js`** RO fordítás-értékek egynyelvűre (`billingMonthly`/`billingAnnual`/`billingAnnualBadge`/`addonTitle` — eddig `RO / HU` formátum). **`index.html`** `#pricing` statikus fallback: havi/éves váltó + kiegészítők-cím egynyelvű, a 4 csomag fallback feature-listája románra (RO-alap), `loginDispatcher` fallback románra. Cache-bust `landing.js?v=20260616pw`.

**Korábbi kör (2026-06-16 — Regisztráció: nincs egymás melletti kétnyelvű felirat):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`register.html`** ingyenes-trial + meghívókódos űrlap minden beégetett kétnyelvű/HU szövege `data-i18n`-re cserélve → a nyelvváltó kapcsoló intézi (RO-alap). 11 új `reg.*` i18n kulcs (`i18n.js`). Az i18n-motor alapból RO + magától beilleszt egy 🇷🇴/🇭🇺 kapcsolót. Cache-bust `i18n.js?v=...pw3`.

**Korábbi kör (2026-06-16 — Jelszó-szabály finomítás: csak román követelmény + jelszó kétszer):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Követelmény-szöveg csak románul** — `lib/passwordPolicy.js` `POLICY_ERR` románra szűkítve; a kliens-feliratok + i18n-kulcsok (`rst.pwHint`/`rst.minLen`/`por.pwMin6`/`car.min6`/`cs.pwMin6` + register-hintek + `PW_ERR`) mind románul (nyelvtől függetlenül).
2. **Jelszó-megerősítés (kétszeri bevitel)** — `register.html` mindkét reg-mód + admin/manager user-szerkesztő (`uPwd2`); eltérésnél `Cele două parole nu coincid.`, nem küld. Közös `vsPwValid`/`VS_PW_ERR` a `console-shared.js`-ben. A reset/portál/alvállalkozó/saját-csere már korábban is kétmezős volt.

**Korábbi kör (2026-06-16 — Kötelező erős jelszó-szabály):** *(részletes kész-lista: `CHANGELOG.md`; biztonsági napló: `AUDIT.md`)*
1. **`lib/passwordPolicy.js`** (ÚJ, közös) — `validatePassword(pw)`: min. 8 karakter + legalább 1 kisbetű/1 nagybetű/1 számjegy/1 szimbólum (pl. `_`); kétnyelvű (RO+HU) hibaüzenet. EGY forrás, mindenhol ezt hívjuk.
2. **Szerveroldali kikényszerítés mind a 6 jelszó-beállító úton** (`handlers/auth.js`, `handlers/users.js` ×2, `routes/auth.js`, `routes/public-register.js`, `routes/portal.js`, `routes/carrier-portal.js`) — a régi `length < 6` ellenőrzés cseréje. A **belépés (`bcrypt.compare`) érintetlen** → a már regisztrált felhasználók (jelenleg a developer) régi jelszava működik, NINCS kényszerített csere.
3. **Kliens-oldali validáció + feliratok + i18n** (`register.html`, `reset-password.html`, `portal.js`, `carrier.js`, `console-shared.js`, `i18n.js`) — azonos szabály, gyors visszajelzés a beküldés előtt.
4. **Teszt:** `tests/unit/passwordPolicy.test.js` (8 eset) + `execute.test.js` fixture-jelszó frissítve; 93 Jest zöld.

**Korábbi kör (2026-06-15 — Admin Előfizetések almenü + developer fizetés-aktiválás, PR #138):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`public/admin.html`** — Beállítások sidebar nav-head csoporttá alakítva: 👤 Fiók + 💳 Előfizetés almenük; régi subscriptionCard eltávolítva; új `elofizetesek` pane (státusz, csomag-választó havi/éves toggle-lal, referencia-kártya banki adatokkal, fizetési előzmények).
2. **`handlers/billingHandlers.js`** — `requestSubscriptionExtension`: payment_request létrehozás, admin fizetési email, developer értesítő email (`DEV_NOTIFY_EMAIL`/vallorsoft@gmail.com); `getMyPaymentRequests`: saját céges kérelmek listája.
3. **`handlers/developer.js`** — `devActivatePayment`: pending kérelmet paid-re állít + company paid_until/subscription_status frissítés (éves +12 hó, havi +1 hó).
4. **`public/developer.html`** — Fizetési kérelmek tábla: ✅ Aktiválás gomb pending sorokon.
5. **`public/console-shared.js`** — `loadElofizetesek`, `elofSetBilling`, `elofRenderPlans`, `elofLoadHistory`, `elofRequestPlan` funkciók; `loadSubscriptionCard` eltávolítva.

**Korábbi kör (2026-06-15 — Emailek csak románul, PR #136):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`routes/trial-select.js`** — fizetési email + köszönő oldal: tábla-feliratok, szekció-fejlécek, instrukciók, CTA gomb, tárgy — mind csak román.
2. **`services/scheduler.js`** — havi riport email: tábla-feliratok, tárgy, footer-megjegyzés — csak román (trial lejárat + emlékeztető az előző körben már RO-only volt).
3. **`services/email.js`** — `buildInviteHtml` mindig `L='ro'`; `sendResetEmail` tárgy mindig román; DB sablon body_ro elsőbbséggel.
4. **`tests/unit/invite-email.test.js`** — elvárások frissítve román szövegekre; 111 teszt zöld.

**Korábbi kör (2026-06-15 — Add-on árak + Trial email + éves árazás, PR #130–#133):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **CLAUDE.md + CHANGELOG docs (PR #130)** — PR #129 dokumentáció pótlása.
2. **Bérlői adattisztítás szkript (PR #131)** — `scripts/purge-all-tenants.sql`: egyszeri manual cleanup (NEM auto-fut); companies CASCADE + manuális táblák; developer user megmarad.
3. **Trial email rendszer (PR #132)** — `db/bank-payment-details.sql`: `payment_requests` tábla; `services/bnr.js`: BNR EUR/RON napi árfolyam; `routes/trial-select.js`: HMAC-tokenes csomag-választó link → fizetési email (összeg EUR+RON+TVA 21%+referencia VS-YYYYMM-XXXX); `services/scheduler.js`: 3 és 1 nappal trial lejárat előtt emlékeztető (4 csomag × havi+éves link); `handlers/developer.js`: `devGetBankDetails`/`devSaveBankDetails`/`devGetPaymentRequests`; Developer `🏦 Banki adatok` + `💸 Fizetési kérelmek` fülek; `public/index.html`/`landing.css`/`landing.js`: éves/havi váltó toggle, éves ár = 11 hónap × havidíj, `−1 lună` badge.
4. **Add-on árak (PR #133)** — `handlers/developer.js`: `devGetAddonPrices`/`devSaveAddonPrices`; Developer Banki adatok pane: add-on szerkesztő form; `public/index.html`: `.lp-addon-section` chip-sor a #pricing alatt; `public/landing.css`: chip stílusok; `public/landing.js`: `fetchAddons`/`renderAddonPrices` (kétnyelvű), `_cachedAddonPrices`, `addonTitle` i18n.

**Korábbi kör (2026-06-15 — Rendszer-emailek link fix + Landing #pricing redesign + kétnyelvű feature-lista, PR #126–#129):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Email link fix (PR #128)** — `db/fix-reset-email-template.sql`: törli a hibás Markdown-szintaxisú `email_sys_*` DB-sablonokat (reset/invite/welcome/trial_expiry) → beégetett HTML fallbackek; `services/email.js`: `applyTemplateVars rawVars` + `{{reset_url_btn}}/{{invite_url_btn}}/{{*_link}}` HTML-változók jövőbeli sablonokhoz.
2. **Landing pricing (PR #126)** — `public/landing.css`: `--lp-green`, `.lp-plan-green/blue/indigo/dark` per-csomag `--plan-accent`, 4 oszlopos rács, `.lp-plan-audience`, `.lp-pricing-vat`; `public/landing.js`: `renderPricingGrid` újraírva (features JSONB → bullets, re-render HU↔RO váltáskor, 8 új i18n kulcs); `public/index.html`: statikus fallback → 4 valós csomag + ÁFA-megjegyzés.
3. **Kétnyelvű feature-lista (PR #129)** — `db/plan-features-bilingual.sql`: `subscription_plans.features` JSONB frissítve `[{"ro":"...","hu":"..."}]` formátumra (mind a 4 csomag); `public/landing.js` `renderPricingGrid` + `public/subscription.html` `buildFeaturesList`: objektum-alapú bilingual rendering, visszafelé kompatibilis string fallbackkel.

**Korábbi kör (2026-06-15 — Csomag finomítás + 4 csomag auto-setup, PR #124–#125):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`db/package-setup.sql`** — 4 csomag teljes beállítása induláskor: Alap/Standard/Pro/Business limitek (max_users/vehicles/sofors, fuvar=korlátlan), marketing bullet-pontok, plan_features tiltott feature-ök (Alap:29 KI, Standard:13 KI, Pro:7 KI, Business: mind BE).
2. **`db/package-setup-v2.sql`** — delta: sofőr-limitek helyes arányra (Alap=4/Standard=10/Pro=40/Business=100), chat kivéve Alapból → Standard-tól elérhető, bullet-pontok frissítve.

**Korábbi kör (2026-06-15 — 6 prémium feature gate + megosztott featureEnabled, PR #123):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`lib/featureEnabled.js`** — megosztott helper: `company_features` (cég-override) > `plan_features` (csomag) > `true`; cég-szintű egyedi beállítás felülírja a csomagot. Developer mindig átmegy.
2. **`public/feature-catalog.js`** — 6 új csomag-gate key: `visszfuvar-radar`, `toll-becsles`, `ai-kiolvasas`, `gps-integracio`, `szamlazas-integracio`, `konyvelo-szerepkor`.
3. **Szerver gate-ek:** `getPlannerMatches` (visszfuvar-radar), `estimateToll` (toll-becsles), `/reparse` (ai-kiolvasas), `getPositions` (gps-integracio), `saveBilling`+`testBilling` (szamlazas-integracio), `invCreate(Konyvelo)`+`/konyvelo` page (konyvelo-szerepkor).

**Korábbi kör (2026-06-15 — Landing nav cleanup + vissza gomb szín javítás, PR #122):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`public/login.html` / `portal.html` / `carrier.html`** — vissza gomb: fehér/átlátszó → sötét szöveg (#475569) + szürke keret (#cbd5e1), látható a világos (#f7f9fc) háttereken.
2. **`public/index.html`** — asztali navból eltávolítva az Ügyfél/Alvállalkozói portál linkek; `lp-mobile-only` osztállyal csak mobilos hamburger menüben látszanak.
3. **`public/landing.js` / `i18n.js`** — Diszpécser dropdown alcíme: Admin · Manager · Könyvelő · Sofőr (HU/RO).

**Korábbi kör (2026-06-15 — Carrier járművek megjelenítése a planificatorban, PR #114):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`handlers/orders.js`** — `getPlannerData`: `carrier_vehicles JOIN carriers` lekérés (`company_id`-szűrt), `carrierVehicles` tömbként a válaszban.
2. **`public/planner.js`** — `_carrierVeh` állapot-változó; Gantt-nézetben elválasztó-fejléccel vizuálisan megkülönböztetett sorok (indigó szín, 🚚 ikon, `carrier_nev` felirat, fuvar-sávok drag&drop-pal); mobil napi nézetben szintén megjelenik a carrier-lista.
3. **`routes/carrier-portal.js`** — ellenőrizve: GET/POST/DELETE `/api/carrier/vehicles` mindhárom végpont `company_id AND carrier_id` szűrést tartalmaz (javítás nem volt szükséges).

**Korábbi kör (2026-06-15 — Menetlevél form: indulás/érkezés + határátlépések + diurna, PR #113):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`db/fuvarlevel-trip-times.sql`** — `fuvarlevelek.indulas_dt/erkezes_dt TIMESTAMPTZ` + `hataratok JSONB DEFAULT '[]'` (auto-migráció).
2. **`lib/diurna.js`** — `calculateDiurna(departureDt, arrivalDt, crossings)` menetlevél-alapú diurna: 12:00 szabály, Europe/Bucharest DST-biztos; indulás napja számít ha < 12:00, érkezés napja ha > 12:00, közbülső napok mindig; nap típusa: sofőr helyzete 12:00-kor (OUT → EXTERN). Visszafelé kompatibilis: tömb első arg → régi GPS/`border_crossings` legacy ág.
3. **`routes/soferApi.js`** — `indulasDt`+`erkezesDt` megvan → form-alapú diurna; hiányzik → `border_crossings` GPS fallback; INSERT +3 oszlop ($29–$31).
4. **`public/sofer.html`** — `🕐 Út időpontjai` (2 datetime-local) + `🛂 Határátlépések` dinamikus szekció + `diurnaPreview`.
5. **`public/sofer.js`** — `addHatarRow()`, `collectHataratok()`, `updateDiurnaPreview()`; payload + reset kibővítve.
6. **`public/i18n.js`** — 11 új i18n kulcs (tripTimes, departureTime, arrivalTime, borderCrossings, addCrossing, crossingDate, crossingDir, crossOut, crossIn, days, crossingCount).

**Korábbi kör (2026-06-15 — Vizuális landing szerkesztő + blog cikkek, PR #111):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **🌐 `public/landing-editor.html`** — teljes képernyős vizuális szerkesztő (`/developer/landing-editor`, is_dev): bal sidebar szekciólista (▲▼ sorrendmozgatás, 👁 láthatóság), blog cikk szerkesztők (RO+HU cím+tartalom); jobb iframe az élő landing page-gel; duplaklikk bármely `[data-i18n]` elemre → inline szerkesztés → `devSaveLandingTexts`; mentés egyszerre (`devSaveSectionOrder` is).
2. **📰 Blog cikk oldal** — `public/blog-post.html` (publikus, `/blog/1|2|3`); `routes/blog.js` (`GET /api/blog/:id`); tartalom `developer_settings` `blog_post_N` kulcsban; landing blog kártyák „Citeste mai mult" linket kaptak.
3. **⚙️ Backend** — `GET /api/landing-texts` + `sectionOrder`/`sectionVisibility`; `devSaveSectionOrder`, `devGetBlogPost`, `devSaveBlogPost` handlerek; `landing.js` `applySectionOrder/Visibility()`; minden szekció `data-vs-section` attribútumot kapott.
4. **🧹 Developer panel** — régi `🌐 Landing szövegek` fül + pane + ~305 sor JS eltávolítva; helyette `🌐 Landing szerkesztő ↗` link (új ablakban).

**Korábbi kör (2026-06-15 — Developer szerkeszthető tartalmak: landing + email + csomag + push, PR #103):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **🌐 Landing szövegek** (`routes/landing-texts.js`, `devGetLandingContent`/`devSaveLandingContent`) — hero/USP marketing szövegek `developer_settings`-ből; `GET /api/landing-texts` publikus.
2. **✉️ Rendszer-email sablonok** (`services/email.js`, `devGetSystemEmailTemplate`/`devSaveSystemEmailTemplate`) — 4 rendszer-email típus (meghívó/reset/üdvözlő/trial lejárat) szerkeszthető tárgy+RO/HU törzzsel; hardcoded fallback.
3. **📦 Csomag marketing bullet pontok** (`db/plan-features-bullets.sql`, `billingHandlers.js`, `subscription.html`) — `subscription_plans.features JSONB` bullet-lista; developer szerkeszti, előfizetési oldalon ✓ listaként jelenik meg.
4. **🔔 Push értesítés sablonok** (`lib/pushTemplates.js`, `devGetPushTemplates`/`devSavePushTemplates`) — 5 push-típus RO+HU title/body; in-memory cache; bekötve: portál-kérés, áru-leadás, fuvar-státusz.

**Korábbi kör (2026-06-15 — Developer 📋 Jogi oldalak szerkesztő + kötelező visszaigazolás, PR #102):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`legal_consents` tábla** (`db/legal-consents.sql`) — visszaigazolás-napló minden felhasználó-típusra (`user`/`client_user`/`carrier_user`); `page_key`+`version`+IP.
2. **`routes/legal.js`** — dinamikus jogi oldalak DB-ből + `pending-ack`/`ack` REST endpoint (minden session-típusra).
3. **`devGetLegalPage`/`devSaveLegalPage`** — Quill HTML CRUD a `developer_settings`-ben; auto last-update; bekezdés diff; `notify_version`.
4. **`public/legal-ack.js`** — fullscreen román modal, nem bezárható, diff, audit-log.
5. **Developer `📋 Jogi oldalak` fül** — Quill.js WYSIWYG 5 oldal; értesítő checkbox.
6. **`legal-ack.js` bekötve** admin/manager/sofer/portal/carrier/konyvelo oldalakba.

**Korábbi kör (2026-06-15 — Developer 📥 Regisztrációk fül + email sablon küldő, PR #101):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`developer_settings` tábla** (`db/developer-email-templates.sql`) — kulcs-érték JSONB; email sablon (`email_template` kulcs) itt él; auto-migráció.
2. **4 új RPC handler** (`handlers/developer.js`): `devGetTrialCompanies` (cég-lista admin e-maillel + csomag + státusz), `devGetEmailTemplate`/`devSaveEmailTemplate` (sablon CRUD), `devSendCompanyEmail` (változó-behelyettesítés + Brevo küldés).
3. **`sendDeveloperEmail`** (`services/email.js`) — VallorSoft branded dark HTML wrapper, Brevo API, exportálva.
4. **Developer UI** (`developer.html`) — `📥 Regisztrációk` sidebar tab; pane: sablon szerkesztő (tárgy + HTML törzs + `{{változó}}` lista) + cégek táblázat per-sor `📧 Email` gombbal.

**Korábbi kör (2026-06-15 — Landing page i18n + mobil optimalizálás, PR #100):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **~58 hiányzó i18n kulcs** pótolva mindkét nyelvhez (`ro`+`hu`) — feature strip, modulok, statisztika, testimonialok, CTA, footer fejlécek, árazás fallback.
2. **Mobil navbar**: 860px-en login elrejt (lang + register marad); 480px-en csak lang toggle.
3. **Hero mobilon**: sofőr-hét timeline megjelenik (fölé kerül), nem tűnik el.
4. **Hamburger menü**: login link hozzáadva mobilos listához.

**Korábbi kör (2026-06-14 — Developer csomag-limitek + plan_features funkció-kapcsolók, PR #99):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`plan_features` tábla** (`db/plan-features.sql`) — csomag-szintű funkció-kapcsolók (plan_id, feature_key, enabled); auto-migráció. `subscription_plans.max_sofors` új limit-oszlop.
2. **Hierarchia**: `company_features` (cég-szintű dev override) > `plan_features` (csomag default) > `true`; `getMyFeatures` (dashboard.js) + `featureEnabled` (pages.js) egységesen alkalmazza.
3. **Limit mezők a plan editorban** (`developer.html`) — max_users/vehicles/orders_month/sofors + stripe_price_id; 0=tiltott, üres=korlátlan.
4. **⚙️ Funkció-kapcsolók per csomag** — VS_FEATURES katalógus csoportosítva, három állapot; `getPlanFeatures` + `setPlanFeature` developer RPC-ek.
5. **`planLimits.js`** — `sofors` kind hozzáadva.

**Korábbi kör (2026-06-14 — Önkiszolgáló SaaS regisztráció + trial, PR #98):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Nyilvános cég-regisztráció** (`routes/public-register.js`, `POST /api/public-register`) — meghívókód nélküli cég-létrehozás; 14 napos trial, Admin user, üdvözlő e-mail (RO/HU), IP rate-limit (3/óra).
2. **`register.html` dual-mode** — `?kod=` param → meghívókódos (változatlan); param nélkül → ingyenes cég-regisztráció; toggle-link a két mód között.
3. **Trial lejárat ütemező** (`startTrialExpiryScheduler`) — naponta ellenőrzi az aznap lejáró trial-okat, RO/HU e-mailt küld `/subscription` linkkel; `companies.trial_email_sent` flag.
4. **`/subscription` oldal** (`public/subscription.html`) — standalone landing-skin oldal; 4 csomag DB-ből (`/api/public-plans`); Stripe Checkout ha konfigurálva, fallback kapcsolat ha nem; trial banner bejelentkezett Adminnak.
5. **`getMySubscription` RPC** + **Admin Beállítások → 💳 Előfizetés kártya** — státusz, hátralévő napok, „Csomag választása" gomb trial/inaktív esetén.
6. **Landing `#pricing`** — JS-ből tölti be a 4 csomagot (`/api/public-plans`), statikus fallback megmarad.
7. **Migráció** `db/saas-trial.sql` — `companies.trial_email_sent BOOLEAN`.

**Korábbi kör (2026-06-14 — Landing: sofőr-hét timeline + hero USP + „Hogyan működik" + brand-indigo, PR #97):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Brand szín frissítés** — „Soft" logo: piros (#e10b1a) → indigó (#6366f1); `--brand-indigo` token bevezetve a `style.css`-ben; `.vs-logo .soft` és `.chat-side .av` gradiens frissítve; CLAUDE.md Márka szekció frissítve.
2. **Hero sofőr-hét timeline** (`index.html`/`landing.css`/`landing.js`) — GPS monitor ki; 7 napos animált glassmorphism kártya (határátlépés → diurna auto, tankolás, vásárlás, visszalépés, pótkocsi csere/raktározás, menetlevél generálás); JS-renderelt RO+HU i18n.
3. **Hero USP szöveg** — badge/H1/alcím + 3 ✕ bullet + heroNote; sofőr-centrikus marketing szöveg (user által megadott).
4. **Showcase → „Hogyan működik"** — dashboard monitor mockup ki; 3 lépéses `#how` szekció; navbar link frissítve.
5. CSS nettó −187 sor.

**Korábbi kör (2026-06-14 — Landing showcase finomítás: 1 monitor + valósághű Vezérlőpult + arányosabb hero/sáv):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Showcase egyetlen monitorra** (`index.html`/`landing.css`) — a korábbi 3 monitor + 2 telefon zsúfolt összkép helyett egy kiemelt monitor, rajta valósághű Vezérlőpult-mockup (sötét sidebar + 4 KPI-kártya 27/5/4/7 + fuvar-tábla státusz-pillákkal + világos OSM-szerű térkép élő pulse-szal + jármű-státusz sor); a holt mockup/telefon CSS törölve. `<img onerror>` a `/img/sc-dashboard.png`-re (friss képpel auto-csere).
2. **Arányosabb felső blokk** — feature-strip (felső világos sáv) megnagyobbítva (padding 40→76px, ikon 1.6→2.4rem), arányosan visszavéve a hero-ból (`min-height` 100→80vh). 108 teszt zöld.

**Korábbi kör (2026-06-14 — Landing: showcase szekció + integráció-felirat):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Új „A platform működés közben" showcase szekció** (`index.html`/`landing.css`) a hero után — eszköz-mockup a `landing.js`-ben már létező, de sosem beépített showcase i18n-kulcsokra (`showcaseTitle`, `mon1-3Label`, `phone1-2Label`); sötét háttéren; `<img onerror>` a `/img/sc-*.png`-re (a régi `monitor1.png` elavult, nem használjuk). *(A showcase elrendezését a következő kör 1 monitorra finomította.)*
2. **Integrációs logó-szekció → egysoros footer-felirat** — a logós `#integrations` blokk + nav/footer-linkjei + a holt `.lp-int-*` CSS kivéve; helyette a footer alsó sorában kétnyelvű (RO/HU) `footerIntegrations` felirat a GPS-/számlázó-integrációkról. 108 teszt zöld.

**Korábbi kör (2026-06-14 — FGO-menü UX: kattintás-fix + accordion + fix sidebar/fejléc):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Kattintás-regresszió javítva** (`admin.js`/`manager.js`) — a sidebar kötése felülírta az új `.nav-head` toggle-jét és csak a régi parent-id-ket kezelte → az új FGO-fejlécek nem nyíltak le / kiürült a tartalom. Generikus: bármely `.nav-head` → `toggleGroup`, levél (`data-tab`) → `activateTab`.
2. **Single-open accordion** (`console-shared.js` `toggleGroup`/`activateTab`) — másik főmenüre kattintva az előző becsukódik (egyszerre egy nyitva).
3. **Fix sidebar + fix fejléc** (`style.css`, app-shell `@media min-width:769px`) — a bal panel és a keresős felső sáv görgetéskor fixen marad, csak a tartalom görgödik; a mobil drawer érintetlen.

**Korábbi kör (2026-06-14 — Manager FGO-menü + globális kereső bővítés):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Manager konzol FGO-elrendezés** (`manager.html`) — ikonos 10-főmenüs sidebar + fix felső sáv (breadcrumb + `Ctrl+K` kereső + nyelv/téma) + `global-search.js`, a manager tényleges menüpontjaival (Integrációk/Jogosultságok kihagyva). 30 data-tab ↔ 30 pane.
2. **Globális kereső bővítés** (`handlers/globalSearch.js`) — +Megrendelések (`inbound_orders`), +Menetlevelek (`fuvarlevelek`, users-emailen át tenant-szűrt), +Számlák (`invoices`); paraméteres, `company_id`-szűrt, role-gated. Élesben verifikálva, 108 teszt zöld.

**Korábbi kör (2026-06-14 — Multi-tenant adatszivárgás audit, PR #94):** *(részletes kész-lista: `CHANGELOG.md`; biztonsági napló: `AUDIT.md` 11. lépés)*
1. **Tenant-izolációs átvizsgálás (3 agent, ~87 fájl) + 1 KRITIKUS fix:** `handlers/documents.js` `orderDocUpload` a kliens-megadta `orderId`-t ownership-ellenőrzés nélkül szúrta be (cross-tenant write) → INSERT előtt `orders WHERE id=$1 AND company_id=$2` ellenőrzés. `services/push.js` defenzív `u.company_id=ps.company_id` JOIN. A routes/services réteg egyébként erős izolációval; az e-mail-joinok nem kihasználhatók (`users.email` UNIQUE). 108 teszt zöld.

**Korábbi kör (2026-06-14 — FGO-menü ikonjavítás + átfogó átvilágítás, PR #92–#93):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **FGO-menü ikonjavítás (PR #92):** a közvetlen menüpontoknál a `data-i18n` a belső `<span>`-ra került (az i18n a `.tab`-on kitörölte az SVG-t); sidebar menü-rés 3px.
2. **Átfogó átvilágítás + élesben tesztelés (PR #93):** 3 agentes átvizsgálás (HTML/kliens-JS/szerver) + futó szerveres teszt. Olvashatóság/kontraszt-javítások (cookies/login/jogi), kliens-JS szín-maradékok → landing paletta, cache-bust. Élesben: oldalak 200/302, nincs 500, `globalSearch`/`comList`/`dashStats` autentikáltan OK; require-sweep 82 modul 0 hiba; i18n teljes; 108 teszt zöld.

**Korábbi kör (2026-06-14 — Fix felső sáv + ikonos FGO-menü + globális kereső, PR #91):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Ikonos FGO-navigáció + fix felső sáv + globális kereső az ADMIN konzolon.** 10 főmenü/32 menüpont monokróm vonalas SVG ikonokkal (`toggleGroup`); Üzemanyagkártya → Adminisztráció. Fix sticky felső sáv (breadcrumb + `Ctrl+K` kereső + nyelv/téma). Command palette (`public/global-search.js`): menü-navigáció + élő adatkeresés (`handlers/globalSearch.js` RPC, `company_id`-szűrt, fuvarok/ügyfelek/járművek/sofőrök). A `data-tab`/funkció változatlan. Manager + többi konzol következő kör.

**Korábbi kör (2026-06-14 — Teljes weboldal redesign, PR #87–#90):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **A teljes frontend a landing prémium dizájnját kapta** — világos-alap, kék (#3b82f6) / indigó (#6366f1) paletta, mélység-effektek (gradiens kártyák + felső sheen + kék glow gombok + radiális háttér-fény + gradiens KPI). Konzol (admin/manager) light+dark a `style.css`-ben (light alapértelmezett, dark navy); a többi oldal (auth, jogi, sofőr `sofer.css`, developer+routing lila→kék/indigó, portál+követés, alvállalkozó, könyvelő) page-scoped skinnel; konzol-JS szín-takarítás (badge/Chart.js/márka-piros→indigó). **CSAK megjelenés — funkció változatlan.** Térkép-csempék végig világosak. 108 teszt zöld.

**Korábbi kör (2026-06-14 — Developer cégenkénti hozzáférés-statisztika, PR #86):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Developer „👥 Hozzáférések" fül** (`handlers/developer.js` `devCompanyAccess`, `developer.html`) — a cég részletek-modaljában cégenként felhasználók/alvállalkozók/ügyfelek bontásban összes/aktív/inaktív/meghívott + utolsó belépés (last_login táblázat). Portál-belépőknél meghívott=`pass_hash` NULL.
2. **`users.last_login`** (`db/user-last-login.sql`) — a fő belépés (`routes/auth.js` login + 2FA) frissíti.

**Korábbi kör (2026-06-14 — Ügyfél-portál beküldött kérések, PR #85):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Ügyfél-portál mutatja a beküldött kéréseket** (`routes/portal.js` `/api/portal/orders` + `portal.js`) — a „📦 Transporturile tale" eddig csak a fuvarokat mutatta; a függő/elutasított portál-kérések „eltűntek". Mostantól „📋 Beküldött kéréseid" szekció státusszal (feldolgozás alatt / elutasítva), az elfogadott kihagyva (fuvarként látszik). RO+HU i18n.

**Korábbi kör (2026-06-14 — Tervezőtábla minden aktív fuvar + ügyfél automatikus, PR #84):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Tervezőtábla — minden aktív fuvar** (`handlers/orders.js` `getPlannerData`) — a dátum-ablak helyett mostantól MINDEN aktív státuszú fuvar (`Disponibil`/`Alocat`/`In Curs`/`Extern`/`Parkolt`/`Raktarban`) bekerül a dátumtól függetlenül (eddig a héten kívüli aktív fuvar eltűnt); a dátumozott/Finalizat az ablakban marad, `Anulat` kizárva.
2. **Ügyfél-kérés megrendelő automatikus** — a `client-requests.js` `collect()` megőrzi az eredeti `extracted`-et (a `client` nem vész el), az `approve` pedig a portál forrás-e-mailjéből (`client_users → clients.denumire`) feloldja az ügyfél nevét + linkeli (`orders.client_id`).

**Korábbi kör (2026-06-14 — Ügyfél kérések fül + lebegő fuvarkérés-értesítő):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Lebegő, oldalfüggetlen értesítő-sáv** (`console-shared.js` `startInboundWatcher`) — minden admin/manager fülön látszik, amíg van feldolgozatlan beérkező; 45 mp polling (`GET /api/inbound-orders/count`), kattintásra a fülre ugrik, sidebar-badge; új kérésnél web push (`routes/portal.js` `sendPushToRole`, RO/HU).
2. **Új „📋 Ügyfél kérések" fül** (`public/client-requests.js`, `data-tab=client-requests`, `feature-catalog.js`) — a portál-kérések (`inbound_orders` `source='portal'`) **ügyfelenként lenyitható szekcióban**, a kérések alapból **összecsukott sorként** (sorszám beérkezés-sorrendben + „van/nincs fájl" jelző + dátum + státusz), **kattintásra nyílik** a teljes szerkeszthető áru-adatlap (lenyitott állapot megőrződik). Fejléc **AI-kapcsoló** (cég-szintű) → „📄 Kiolvasás (AI)" (reparse) automatikus mező-kitöltés; „✓ Elfogadás → Disponibil" / „✕ Elvetés". A portál-kérés **többé NEM a „Megrendelések" fülön** (a list-endpoint `?source=`/`?exclude_source=` szűrővel; az approve a teljes áru-adatot átviszi: `suly_kg`/`load_type`/`hossz_cm`/`szel_cm`/`mag_cm`).
3. **Bővített portál fuvar-igénylő űrlap** (`portal.html`/`portal.js`) — teljes áru-bevitel **minden mező opcionálisan** + **opcionális dokumentum-feltöltés** (PDF/kép, max 10 MB).

**Korábbi kör (2026-06-14 — Developer export 500 teljes javítás, PR #81):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Developer export 500 — további 5 tábla oszlopnevei** (`routes/developer-export.js`) — a #80 után is hibázott, mert a clients (`cui`→`cui_cif`, `contact_person` törölve), vehicles (`marka`→`marca`, `tipus`→`tip`, `ev`→`an`), fuvarlevelek, inbound_orders és order_uit_codes lekérdezés is rossz neveket használt. A clients/vehicles nem volt `.catch`-elve → ezek dobták a tartós 500-at. Valós Postgres 16-on verifikálva: mind a 14 lekérdezés hibamentes, 200 + érvényes ZIP.
2. **ZIP mappa-struktúra** (`lib/zip.js`) — a `uniqueName` mostantól megtartja a `/`-t ZIP-mappa-elválasztóként (szegmensenkénti sanitizálással, path-traversal védelemmel); eddig `csv/orders.csv`→`csv_orders.csv` laposodott. A könyvelői hub (`routes/accounting.js`) almappás ZIP-je is profitál.

**Korábbi kör (2026-06-14 — Automatikus Render deploy + hibajavítások, PR #80):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **CI auto-deploy Render-re** (`.github/workflows/ci.yml`) — új `deploy` job: main-push után a tesztek zöld esetén `curl POST $RENDER_DEPLOY_HOOK_URL` élesít automatikusan. PR-eken nem fut.
2. **Developer export 500-as hiba javítva** (`routes/developer-export.js`) — az `orders` és `order_legs` SQL lekérdezések nem létező oszlopneveket használtak (`rendszam`, `felrako`, `lerako`, `ar`, `ar_valuta`, `cim`, `sorrend` stb.), amelyek PostgreSQL hibát okoztak → minden 📦 export 500-as szerverhiba volt. Javítva a valódi mezőnevekre (`pret`, `loc_incarcare`, `loc_descarcare`, `rendszam_camion`, `leg_number`, `loc_preluare` stb.).

**Korábbi kör (2026-06-14 — Jogi megfelelőség + Developer cég-adatexport ZIP):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Jogi oldalak kiegészítése (GDPR/T&C)** — terms.html / privacy.html / dpa.html / cookies.html / security.html-be a megadott RO-jogi szövegek (GPS-kizárás, e-Factura felelősség, adatmegőrzési idők, 72 órás breach-notifikáció). register.html kötelező checkbox pár (Terms + Privacy accept) JS-validációval. CLAUDE.md jogi/GDPR szekció (VALLOR TEAM SRL adatok, adatfeldolgozók, jogalapok, megőrzési idők).
2. **Developer cég-adatexport ZIP** (`routes/developer-export.js`) — 📦 gomb minden cégkártyán; `GET /api/developer/export/:id` (is_dev gated); CSV (orders, order_legs, clients, vehicles, carriers, users, invoices, carrier_invoices, fuvarlevelek, inbound_orders, uit_codes) + bináris dok (order_documents, POD, carrier_docs) egyetlen ZIP-ben. 400 MB vészfék, jelszó-hash kizárva.

**Korábbi kör (2026-06-14 — Ügyfelek oldal UX/hibajavítás + CI-zöldítés):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Ügyfél-portál meghívó szerver-hiba javítva** (PR #74) — a „Meghívó küldése" `Eroare de server`-t dobott: a `handlers/clientPortal.js` + `routes/portal.js` (belépés/jelszó-beállítás) a NEM létező `clients.nev` oszlopra hivatkozott (a tábla név-oszlopa `denumire`). Mindhárom helyen javítva; a meghívó kecsesen leromlik e-mail-konfig nélkül is (set-password link + `emailed:false`).
2. **Kereshető ügyfél-választó + világos/sötét szín-javítás** (PR #69, #73, `f83126e`) — az „👥 Ügyfél-portál hozzáférések" meghívó-sávban a sima `<select>` helyett kereső mezős legördülő (a hozzáadott ügyfelekből, `denumire` névvel); téma-érzékeny `.cp-client-drop` (világos: világos háttér+sötét betű, sötét: fordítva) és a mentett-ügyfelek tábla (`clients-page.js`) sötét-módú felülírásai.
3. **CI-zöldítés** (PR #71, #72) — a per-provider UIT-átállás után a `dev-integrations` valódi-DB teszt a `uit_templates` map + `uit_template_legacy` + `gps_providers` API-ra igazítva (a teszt csak `DATABASE_URL` mellett fut → lokálisan kimaradt, CI-ben piros volt); a `db/uit-deeplink-per-provider.sql` migráció `IF EXISTS` guardot kapott a régi `uit_deeplink_template` oszlopra. Valós Postgres 16-tal verifikálva: **24 suite / 108 teszt zöld**.

**Korábbi kör (2026-06-14 — e-Factura automata státusz + UIT deeplink refaktor + ANAF CUI cím):**
1. **e-Factura automatikus státusz-lekérdezés** (`services/scheduler.js` `startEFacturaStatusScheduler`) — 3 órás scheduler: a kiállított számláknál (`status='issued'`, ≤60 nap) a billing provider `getInvoice()` hívásával lekéri az ANAF SPV státuszt, elmenti `efactura_status`/`efactura_last_raw`/`efactura_checked_at` mezőkbe. SmartBill és Oblio `getInvoice` valódi API-hívással implementálva (`services/billing/`). Migráció: `db/efactura-status-poll.sql`.
2. **UIT deeplink refaktor** — GPS→ANAF küldés teljesen eltávolítva (`services/gps/cargotrack-et.js`, `fomco-et.js` törölve; `routes/uit.js` `/start`/`/stop` route-ok törölve). Per-provider deeplink sablon: `companies.uit_deeplink_templates JSONB` (`db/uit-deeplink-per-provider.sql`). Developer oldalon GPS-providerenként (CargoTrack, Fomco) külön URL-sablon. Admin/manager UIT-panel: kód bevitel → mentés → deeplink megnyitás pre-fill adatokkal. Sofőr UIT nézet egyszerűsítve.
3. **ANAF CUI strukturált cím** (`services/clients.js`) — az `adresa_sediu_social` strukturált mezőkből épül a teljes cím (utca+házszám, kiegészítő, helység, megye `Jud.` előtaggal, irányítószám); `county`/`locality` külön mezőként is visszaadva.

**Korábbi kör (RO-megfelelőség + térképes útvonal-előnézet bekapcsolva + ügyfél-portál meghívó-fix):**
1. **RO megfelelőségi kör** (kutatás: ANAF e-Factura, e-Transport/UIT, ANSPDCP/GDPR + fuvarengedélyek — a rendszer már nagyrészt megfelelt; a hézagok pótolva):
   - **UIT lejárat-figyelmeztetés** — a lejáró (5/15 napos érvényesség végéhez közeledő, még nem leállított) aktív UIT-kódok a Vezérlőpult lejárat-sávjában (🛣️), a `document_expiries` riasztások mellé olvasztva (`getExpiryAlerts`, nincs séma-változás, best-effort).
   - **e-Transport adatok** (`db/order-etransport.sql`: `orders.nc_code`/`marfa_value`/`marfa_currency`/`needs_uit`) — NC/HS-kód + áru-érték + „UIT szükséges" pipa a fuvar-szerkesztő „📑 RO e-Transport" csoportjában (`comUpdate` dinamikus mezők); a fuvarlistán **⚠️ „UIT lipsă / hiányzó UIT"** badge, ha `needs_uit` ÉS nincs aktív UIT-kód (`comList` `uit_active_count`).
   - **GDPR adatvédelmi tájékoztató + sofőr-visszaigazolás** (`db/gdpr-settings.sql`: `gdpr_settings` + `gdpr_consents`; `handlers/gdpr.js`: `getGdprSettings`/`saveGdprSettings`/`getMyPrivacyNotice`/`ackPrivacyNotice`) — Legea 190/2018: a munkavállalói GPS-monitoring előzetes tájékoztatást igényel. Admin **Beállítások → 🔒 GDPR** kártya (tájékoztató szöveg, DPO, „GPS csak üzleti célra" jelző, megőrzési megjegyzés); a **sofőr belépéskor visszaigazolja** (banner → „Am înțeles"; a tájékoztató módosítása `updated_at` után újra kell). Audit-naplózva. A GDPR-export (`exportUserData`) kiterjesztve a portál-belépőkre (`client_users`/`carrier_users`, jelszó-hash nélkül).
   - **copie conformă** dok-típus a lejárat-figyeléshez (`fe.doc.copieConforma`); az **ADR** és **Licență comunitară** már korábban benne volt.
   - *Szándékosan NEM épült és NEM is kell:* GPS→ANAF élő e-Transport-transzmisszió (az ANAF API nem stabil, és a VallorSoft nem küld közvetlenül semmit az ANAF-nak — minden e-Factura és e-Transport kommunikáció a számlázó-providereken keresztül megy); SAF-T D406 XML (a könyvelő a SAGA/WinMentor CSV-ből generálja saját programjával). Az UIT-kódot sem mi generáljuk — CargoTrack deep-link.
2. **Térképes útvonal-előnézet (`order-route-map`) ALAPBÓL BE** — eddig is működött (Leaflet világos térkép, köztespont cím-ből vagy térkép-kattintással, `type:'waypoint'` — NEM `order_legs`/lerakópont, csak az útvonalat/km-et + útdíjat módosítja), de opt-in volt. Most a „hiányzó sor = bekapcsolva" konvenció szerint alapból aktív (a developer cégenként KI tudja kapcsolni); kliens (`initOrderMapFeature`) + szerver (`routeMapFeatureOn`, inbound `/approve`) egységesen, `feature-catalog.js`-ből az `optIn` levéve. **🗺️ gomb az „Útdíj" sorban is** (a Km melletti mellett) → `openRouteMap('edit')`. **💾 helyben mentés**: köztespont után a térkép fejlécében „💾 Útvonal mentése" gomb (csak meglévő fuvarnál) — a `route_geo`+`km` azonnal a fuvarra mentődik (`comUpdate`), **a térkép NYITVA marad** (folytatható); a 🛣️ útdíj-becslés már a mentett útvonalat használja.
3. **Ügyfél-portál meghívó-fix** (`console-shared.js` `loadClientPortalAccess`) — a `/api/clients` `{ clients:[...] }` formátumát a kliens nem parse-olta (csak `Array`/`.rows`-t), ezért **üres maradt az ügyfél-választó** és nem lehetett meghívni. Javítva (`list.clients||list.rows`), üres lista esetén jelzés. Az **e-mail továbbra is kötelező** (kliens + szerver `EMAIL_RE`) — most `*` jelöléssel + `type=email` — és a meghívó **e-mailben kimegy az ügyfélnek** (`clientPortalInvite` → `portal._sendInvite` → `sendResetEmail`/Brevo, set-password linkkel).

**Korábbi kör (i18n RO-elsődlegesség + fuvar/tervezőtábla UX + sofőr-folyamat + teszt-zöldítés):**
1. **Kétnyelvű kifelé menő üzenetek (RO / HU együtt)** — push-értesítések (lejáró dok., áru-leadás, fuvar-státusz, chat) és a havi összefoglaló e-mail; a meghívó/jelszó-reset e-mail már korábban kétnyelvű volt (`lang`-param). HTML `<title>`-ök mind a 12 oldalon `data-i18n`-nel.
2. **Szerveroldali integráció-/válasz-üzenetek románra** (~310 string a `services/`+`handlers/`+`routes/`-ban: számlázó-adapterek, ANAF/UIT, GPS, validáció, `'Szerver hiba'→'Eroare de server'` stb.). A belső `console.*` naplók + kódkommentek magyarul maradtak; a kétnyelvű push-payloadok és a `lang`-os e-mail-sablonok érintetlenek. **A böngésző-felület RO-alap + HU-váltó.**
3. **Fuvar-kezelés hibajavítások** (`handlers/orders.js`, `routes/ordersRest.js`, `console-shared.js`): az **Extern** fuvar tévesen „Disponibil"-ként jelent meg a lista státusz-dropdownjában (hiányzott az opció) → javítva + ismeretlen státusz mindig beszúrva; a **Parkolt/Raktarban** dropdown-opció „Status invalid"-ot dobott → a `quick-status` route most ugyanazt fogadja, mint a `comUpdate`, és Raktarban-ból kilépéskor feloldja a raktári tételt; **fantom sofőr-név** (Extern→None váltáskor) → háromállapotú `nume_sofer` + extern mezők ürítése; a szerkesztőben sofőr-hozzárendelés **most lépteti** a státuszt (Disponibil→Alocat/Extern); elavult `telefon_extern`/`external_driver_id` törlése.
4. **Méretezhető + áthelyezhető fuvarlista-oszlopok** (`console-shared.js`): a fejléc jobb szélén húzható méretező-fogantyú, és a fejléc-cella **húzással átrendezhető** (HTML5 DnD); szélesség+sorrend `localStorage`-ban (`vs-cols-orders`, `{widths,order}` formátum); `table-layout:fixed` → a kiszabott fuvarok többsoros cellái is arányosan nőnek; „↔ Oszlopok" reset gomb. Az utolsó (checkbox) oszlop fixen a végén.
5. **Tervezőtábla méretezhető + áthelyezhető** (`planner.js`): jármű-sorok **átrendezése húzással** (⋮⋮ fogantyú, `vs-planner-veh-order`); **arányos zoom csúszka** (🔎 60–150% → oszlop/sormagasság/jármű-oszlop ÉS betűméret `--p2-rail`/`--p2-fs` CSS-változókkal); **táblán belüli méretezés** (RAIL + nap-oszlop W húzható); ↺ nézet-reset. A sáv-interakció (`rzStart` `colW()`-on át) és a kiosztás (`data-day`) érintetlen — a koordináta-matek helyes.
6. **Sofőr-folyamat átvizsgálás + javítás** (`handlers/orders.js`, `sofer.js`): a **Parkolt/Raktarban** fuvar is `dash_visible`, ha még a sofőrhöz van rendelve (nem tűnik el némán) + olvasható kártya (leadás helyével, gomb nélkül); `comUpdate` **email-normalizálás** (trim+lowercase, mint a create/planner úton). Az átvizsgálás megerősítette: a `finalized_at` trigger, a `driver-status` tulajdonos-ellenőrzés, a handover-kérés és a POD/UIT cég-szűrés helyesen bekötött.
7. **Teszt-zöldítés**: `npm install` (631 csomag) + **require-sweep** (mind a 77 szerver-modul tisztán betöltődik, 0 hiba) feltárta, hogy a RO-fordítás 5 tesztet elrontott (magyar szövegre illesztettek) → a teszt-elvárások a tényleges román szövegekre frissítve (`tests/integration/auth.test.js`, `execute.test.js`). **42/42 zöld.**

**Korábbi kör (cserélhető térkép-szolgáltató — megbízhatóság):**
1. **Cserélhető geokódolás + cím-autocomplete** (`lib/mapsProvider.js`) — cégenként **HERE** vagy **Google** kulcsos szolgáltató, VAGY az alap **ingyenes** (Photon/OSM). Minden keyes hívás **biztonságosan visszaesik az ingyenesre** hiba/kulcs-hiány esetén (sosem rosszabb a mostaninál). Tárolás: `company_integrations` `provider='maps'` (`category='maps'`, `meta.vendor`, `credentials_enc` AES). **Beállítás: a DEVELOPER állítja cégenként** a cég-részletek modal „🔌 Integrációk" fülén (`devGetCompanyIntegrations`/`devSaveCompanyMaps`/`devSaveCompanyUit`); a cég-admin Integrációk fülén ez MÁR NINCS (a HERE-kulcs fizetős/továbbszámlázott, a developer kezeli). A HERE-kulcs egyben a fuvar-szerkesztő „🎯 Pontos (HERE)" útdíj-váltóját is bekapcsolja. Az `efactura`/UIT CargoTrack deep-link sablon (`companies.uit_deeplink_template`) szintén itt, developer-oldalon állítható. Bekötve: `/api/geo-autocomplete` (firebase.js) + `estimateRoute(waypoints, companyId)` geokódolása (`routeEstimate.js` → orderRouteEstimate/toll/inbound) + a HERE-útdíj (`lib/tollProvider.js`). *(A korábbi admin-oldali `mapsGetProvider`/`mapsSaveProvider`/`mapsTestProvider` handlerek megmaradtak, de nincs rájuk UI.)*
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
2. **Funkció-kapcsoló** `order-route-map` — **ALAPBÓL BE** (a „hiányzó sor = bekapcsolva" konvenció szerint; a developer cégenként KI tudja kapcsolni explicit `enabled=false`-szal). Kliens (`initOrderMapFeature`: `!==false`) + szerver (`routeMapFeatureOn`: hiányzó sor = `true`) + inbound `/approve` egységesen. *(Korábban opt-in/alapból-KI volt — a legújabb körben váltottuk default-on-ra.)* Kikapcsolva a kiíró a régi, kézi módban marad.
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
- Márka: `--brand-indigo #6366f1` (a „Soft” — indigó/lila), `--brand-white #fff` (a „Vallor”), `--brand-red #e10b1a` (piros akcent: col-resizer, tábla drop-target, veh-params — NEM a logóban).
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
  **`order-status-handover-check.sql`** (az `orders_status_check` bővítése `Parkolt`/`Raktarban`-nal — a `schema.sql` eredeti CHECK-je nem engedte ezeket, így friss DB-n az áru-leadás DB-szinten elhasalt volna; a valós-DB integrációs teszt tárta fel),
  **`order-etransport.sql`** (RO e-Transport: `orders.nc_code` NC/HS-kód + `marfa_value`/`marfa_currency` áru-érték + `needs_uit` jelző — a fuvar-szerkesztő „📑 RO e-Transport" csoportja; a fuvarlistán ⚠️ „UIT lipsă" badge, ha `needs_uit` és nincs aktív UIT),
  **`gdpr-settings.sql`** (`gdpr_settings` cégenkénti adatvédelmi tájékoztató/DPO/„GPS csak üzleti célra"/megőrzés + `gdpr_consents` sofőr-visszaigazolás időbélyeg+IP — Legea 190/2018; `handlers/gdpr.js`, admin Beállítások 🔒 GDPR kártya + sofőr-banner).
- Fő táblák: `companies` (+`subscription_plan_id`), `users` (+`blocked`, `pozicio_dev`, `totp_*`), `vehicles` (+`height_cm/width_cm/length_cm/weight_kg/weight_per_axle_kg/axle_count/trailer_count/truck_type/tunnel_category/hazardous_goods/fuel_per_100km`), `orders` (+`tractor_id/trailer_id/client_id` — gyakran NULL, a rendszám a tényleges hivatkozás), `order_legs`, `order_documents`, `fuvarlevelek`, `clients`, `company_integrations` (GPS + `provider='email_intake'` IMAP-konfig is itt, titkosítva), `vehicle_gps_map` (**rendszam↔object_id, NINCS tárolt lat/lng** — a pozíció élőben jön), `order_uit_codes`, `inbound_orders`, `company_branding`, `email_templates`, `client_emails`, `push_subscriptions`, `bug_reports`, **`company_features`**, **`billing_integrations`** (cégenkénti számlázó, `credentials` JSONB AES-titkosítva), **`subscription_plans`**, **`here_feature_flags`** (HERE szolgáltatás-árak), **`here_usage_log`** (havi tranzakció-napló), **`warehouse_items`** (raktárba adott áru — méretek/darabszám/súly/lapszám), **`gdpr_settings`**/**`gdpr_consents`** (adatvédelmi tájékoztató + sofőr-visszaigazolás), `driver_shifts` (használaton kívül), `session`.

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
Routing (opcionális): **`ORS_API_KEY`** (OpenRouteService, ingyenes) — az útvonaltervező **kamionos váltója** (🚛) ezzel él; alapból ingyenes autós (OSRM). Üzemeltetés (opcionális): **`LOG_FORMAT=json`** (alapból production-ban; strukturált JSON-log a `lib/logger`-ből), **`LOG_LEVEL`** (`debug|info|warn|error`, alap `info`), **`SENTRY_DSN`** (ha be van állítva ÉS a `@sentry/node` telepítve → hiba-jelentés; különben no-op), **DB-mentés**: `BACKUP_ENABLED=true` + `BACKUP_DIR` (+ opc. `BACKUP_INTERVAL_HOURS`=24, `BACKUP_RETENTION_DAYS`=14). SaaS-fizetés (opcionális): **`STRIPE_SECRET_KEY`** + **`STRIPE_WEBHOOK_SECRET`** (és `npm i stripe`) → önkiszolgáló előfizetés (`lib/stripe.js`/`handlers/stripe.js`/`routes/stripe-webhook.js`); enélkül „not-configured" (no-op). Útdíj/térkép: cégenkénti HERE-kulcs (a maps-provider keretrendszerből) → a fuvar-szerkesztő „🎯 Pontos (HERE)" útdíj-váltója.

## Üzemeltetés (health-check + log)
- **Health-check** (auth nélkül, `routes/health.js`): `GET /healthz` (liveness — a folyamat fut-e), `GET /readyz` (readiness — DB `SELECT 1`, 200/503). Load balancer / uptime-monitor / konténer ezeket pingeli.
- **Strukturált kérés-naplózás** (`middleware/requestLog.js` + `lib/logger.js`): minden API-/oldal-kérésre egy sor (metódus/út/státusz/idő/`X-Request-Id`), a statikus fájlokat és a health-t kihagyva. `LOG_FORMAT=json` esetén egysoros JSON (aggregátor-barát).
- **Globális védőháló** a `server.js`-ben: `unhandledRejection`/`uncaughtException` strukturált naplózással (a folyamat tovább fut), ismeretlen `/api` útra 404 JSON, és egy záró **hibakezelő** (sosem szivárogtat stack-trace-t a kliensnek).
- **Opcionális hibamonitorozás** (`lib/errorReporter.js`): `SENTRY_DSN` + telepített `@sentry/node` esetén a process- és route-hibakezelők Sentry-be is jelentenek; enélkül no-op (a `@sentry/node` NEM kötelező függőség).
- **Opcionális automatikus DB-mentés** (`services/backup.js`, `startBackupScheduler`): alapból KI; `BACKUP_ENABLED=true` + `BACKUP_DIR` esetén ütemezett `pg_dump | gzip` (PG\* env-en, a jelszó nem kerül a parancssorba), retencióval. Külső cron is használható helyette.

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

---

## Jogi / GDPR adatok (privacy policy + terms alapanyag)

### Adatkezelő (Operator)
- **Denumire:** VALLOR TEAM SRL
- **CUI:** 47859317
- **Nr. Reg. Com.:** J2023000114142 (EUID: ROONRC.J2023000114142)
- **Sediu:** Sat Arcus, Cart. Poiana Arcusului nr. 102, cod 527166, jud. Covasna
- **Tel:** 0769532015 · **E-mail:** vallorsoft@gmail.com
- **Administrator:** Pető-Lőrincz Imre-Norbert
- **Înființată:** 2023-03-22

### Adatfeldolgozók (Împuterniciți / Sub-processors)

| Szolgáltató | Szerep | Székhely | Megjegyzés |
|---|---|---|---|
| **Brevo (Sendinblue SAS)** | e-mail (meghívók, értesítések) | Párizs, Franciaország 🇫🇷 | EU → nincs extra dokumentáció |
| **Stripe Payments Europe, Ltd** | online fizetés | Dublin, Írország 🇮🇪 | EU entitás → EU adatkezelés |
| **Google Firebase (Google LLC)** | chat, push értesítések | USA → EU DPF + SCCs | EU–US Data Privacy Framework (2023) alapján legális; Google DPA szükséges |
| **CargoTrack / Fomco** | GPS helyadat (sofőrök) | Románia 🇷🇴 | EU → nincs extra |
| **[HOSTING — KITÖLTENDŐ]** | szerverszolgáltatás | [ország] | Ha EU → ok; ha USA → SCCs kell |

> **Google Firebase jogi alap:** az EU–US Data Privacy Framework (Európai Bizottság 2023/1795 határozata) alapján az USA megfelelő védelmi szintűnek minősül; emellett Google Standard Contractual Clauses (SCCs) és DPA elérhető a [Google Cloud DPA](https://cloud.google.com/terms/data-processing-addendum) oldalán. Privacy policy-ban fel kell tüntetni: *„Adattovábbítás harmadik országba (USA) az EU–US Data Privacy Framework és SCCs alapján."*

### Kezelt személyes adatok
- **Sofőrök:** név, e-mail, telefonszám, valós idejű GPS pozíció
- **Ügyfelek (client portal):** név, e-mail, kapcsolattartó adatok
- **Alvállalkozók (carrier portal):** név, e-mail
- **GDPR-visszaigazolás:** IP-cím, időbélyeg (`gdpr_consents` tábla)
- **Regisztrációkor:** cégnév, e-mail, jelszó (bcrypt hash)
- **Fuvarlevelek:** feladó/átvevő személyes adatai

### Jogi alapok (Temei legal — GDPR Art. 6)
- **(1)(b) Szerződés teljesítése** — fuvar- és ügyfél-adatok kezelése
- **(1)(c) Törvényi kötelezettség** — számlák, könyvelés (Legea 82/1991)
- **(1)(a) Hozzájárulás** — GPS-megfigyelés (Legea 190/2018 — sofőr belépéskor visszaigazolja, `gdpr_consents`)
- **(1)(f) Jogos érdek** — biztonsági naplók, audit trail

### Megőrzési idők
- Számlák: **5 év** (Legea 82/1991)
- Alkalmazotti GPS-adatok: **foglalkoztatás + 1 év**
- Session adatok: **kijelentkezésig**
- GDPR-visszaigazolások: **3 év**
- Audit log: **1 év**

### Alkalmazandó jogszabályok
- **GDPR** (Regulamentul UE 2016/679)
- **Legea 190/2018** — GDPR romániai implementációja; GPS-megfigyelésnél előzetes tájékoztatás kötelező (a rendszerben `gdpr_settings` + sofőr-banner bekötve)
- **Legea 82/1991** — könyvelési megőrzési kötelezettség (5 év)
- **EU–US Data Privacy Framework** (2023) — US adatfeldolgozók jogalapja
