# CLAUDE.md — VallorSoft

> ## ⚠️ ELSŐ SZABÁLY — MINDEN ÚJÍTÁS ELŐTT OLVASD EL (mindig)
> **A projekt ÉRETT, működő rendszer. Semmit nem építünk a vákuumba.** Bármilyen új funkció / módosítás / „újítás” előtt — akár új beszélgető-ablakban kérem, akár nem, ezt NEM kell külön kérnem:
> 1. **Először keresd meg, létezik-e már** a kért dolog vagy egy közeli rokona (grep/Explore). Ami már megvan, azt **ahhoz igazítjuk / kibővítjük / javítjuk**, NEM építünk párhuzamos másodikat.
> 2. **Illeszd a meglévő mintákhoz**: RPC `handlers/` + `routes/execute.js` registry VAGY klasszikus REST `routes/`; közös admin/manager kód a `console-shared.js` „KÖZÖS” szekciójában (ott javítsd, EGYSZER); dizájn-tokenek a `public/style.css` `:root`-jából; i18n `data-i18n` + RO-alap/HU-váltó; multi-tenant `company_id`-szűrés; paraméteres SQL.
> 3. **Ne törj el kész dolgot.** Már KÉSZ és bekötött (ne építsd újra, csak igazítsd, ha kell): **audit-napló, GDPR export/anonimizálás, csomag-limit kikényszerítés, Stripe-váz, health-check, strukturált log, opcionális Sentry, pg_dump backup**, univerzális számlázó (5 provider), térkép-stack (OSM/Photon/OSRM + opc. HERE/Google), útdíj-becslés, áru-leadás/raktár, alvállalkozó/AP, ügyfél- és alvállalkozói portál, könyvelői hub, statisztika, tervezőtábla/radar.
> 4. **Migráció = inkrementális `db/*.sql`** (auto-fut induláskor, `schema_migrations` könyvelés) — ne nyúlj a `schema.sql`-hez meglévő tábla módosításához.
> 5. **A végén:** `npm test` zöld + (ha van) require-sweep, majd commit a megadott feature-branchre, **PR létrehozása és merge** (nem kell külön kérni — az elvégzett és jóváhagyott feladatokat mindig PR-ral mergeld mainre).
> 6. **NAPIRENDET FRISSÍTENI (kötelező, nem kell külön kérni):** minden befejezett (mergelt) feladat után **MINDIG** vezesd át három helyen, hogy később vissza lehessen lapozni, mi van kész: (a) **`CHANGELOG.md`** — új bejegyzés LEGFELÜLRE (dátum + PR-szám + rövid leírás); (b) ennek a fájlnak (`CLAUDE.md`) a „Fejlesztési állapot" szekciója (új „Legújabb kör" + dátum); (c) **`AUDIT.md`** „Javítási napló (élő státusz)" — ha biztonsági/audit-tételt érint. Egy feladat addig NEM kész, amíg ez a három hely nem tükrözi.
> 7. **ÉLES DEPLOY = CSAK Fly.io** (`vallorsoft.fly.dev`, `FLY-DEPLOY.md`). A **Rendert TÖBBÉ NEM használjuk / NEM deployoljuk** — a CI-ből a Render-hook lépés törölve, a `RENDER_DEPLOY_HOOK_URL` secret elhagyható. Ne állítsd vissza, ne írj új Render-lépést, ne javasold Renderre költözést. Minden sikeres main-merge automatikusan élesedik Fly-on (`FLY_API_TOKEN` secret); ha a Fly deploy elakad, azt javítsd — NE tegyél oda Render-fallbacket.
>
> Röviden: **igazíts, ne duplikálj; bővíts, ne törj; a kész munkát írd a napirendbe; élesíteni CSAK Fly.io-ra.**
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

**Legújabb kör (2026-07-23 — ÚJ: bon-scanner TANULÁS (few-shot per merchant) + közös `lib/geminiJson` helper + nem-szivárgás megerősítés):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökér:** egy adott töltőállomás (MOL/OMV/Kaufland) bonja gyakorlatilag egyforma a láncon belül — ha a rendszer emlékezne, a KÖVETKEZŐ MOL bon pontosabb lenne. Plusz: a modell-lánc + fetch kód eddig duplikálva volt a fuvar-inbound `reparse`-ban és a bon-scannerben.
2. **Közös `lib/geminiJson.js` helper** (ÚJ) — modell-lánc (429/503 → következő modell, mind külön napi kerettel), 5xx retry (max 3), hibaüzenetek + fetch (kulcs HEADER-ben) EGY forráson. API: `extractJson({ systemPrompt, parts, models? })` → `{ json, model }`. `services/order-ai/gemini.js` és `handlers/receiptScan.js` REFAKTORÁLVA erre.
3. **Migráció `db/receipt-scan-samples.sql`** (idempotens): `receipt_scan_samples` + `UNIQUE (company_id, merchant_key)` — cégenként/merchantonként EGY aktív template. `ON CONFLICT DO UPDATE` = self-healing (a legutóbb megerősített felülírja a régit).
4. **`scanReceipt` few-shot**: minden hívás előtt a cég legutóbbi 5 EGYEDI merchant-mintáját (`DISTINCT ON`) függeszti a Gemini system-prompthoz. **CSAK STABIL mezőket** (kind/loc/tip/plata/valuta/produs) ad példaként — a per-transaction mezők (data/suma/litru/km) SZÁNDÉKOSAN kihagyva, hogy a Gemini ne másolja őket az ÚJ bonhoz.
5. **`confirmReceiptExtraction` handler** — a sofőr Elfogadás gombjára (`rrAccept` → best-effort fetch `keepalive:true`) upsert-tel eltárolja a mezőket a `receipt_scan_samples`-be. Merchant-key normalizálva: első jelentős szó (≥3 hosszú + betűt tartalmaz) — „MOL Arad" → „mol", „OMV Petrom Bucuresti" → „omv", „SC MOL SRL" → „mol", „1300" → üres (nem tárol). Kapuk `Sofer|Admin|Manager` + `ai-kiolvasas`. Audit-naplózva. DB-hiba → csendes noop (UI nem törik).
6. **NEM-SZIVÁRGÁS védőháló**: audit (mind scan, mind confirm) CSAK metaadatot tárol (modell/kind/confidence/merchant); a base64 kép SOHA nem kerül logba/DB-be. Request-log csak metódus/útvonal/státusz. Global error handler csak err.message/stack/path. Hibaüzenet 300 karakteren csonkolva a kliens felé (echo-back védelem). localStorage csak 128px thumbnail. `fields` JSONB csak bon-mezők (sofőr-név, kártyaszám SOHA).
7. **19 új Jest** (`geminiJson.test.js` 8 + `receiptScan.test.js` +11 az új tanuló + confirm + csonkolás körre); **teljes suite 691 zöld** (672 → 691). Cache-bust `?v=20260723learn`.

**Korábbi kör (2026-07-22 — ÚJ: főoldali „📷 Bon szkennelés" gomb + háttér-feldolgozás + perzisztens elfogadás-várólista):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökér:** az előző körben (menetlevél 2. lépésén) a bon-fotózás blokkolt — a sofőr a spinnert nézte. Kérés: főoldalról egy gomb fotózzon, a feldolgozás háttérben menjen, és ha időközben kilépik, később rákattinthasson és elfogadhassa a kiolvasott adatokat.
2. **Főoldali kártya** (`sec-dash`) — új „📷 Bon szkennelés (AI) — háttérben feldolgozódik" narancs gomb + várólista-panel egyetlen `dash-scan-card`-ban a mini-statisztika alatt.
3. **Fire-and-forget fetch + perzisztens várólista** (`localStorage vs_sofer_receipt_queue`, max 20 tétel FIFO): `scanReceiptStart(file)` a kép átméretezése (1600px hosszú oldal, JPEG q=0.85) után új `processing` tételt (thumbnail + időbélyeg) ír a listába, majd `fetch(/api/execute, { keepalive:true })` — a válasz később futtatja a callback-et, ami `ready` (mezőkkel) vagy `error` státuszra írja át. A sofőr közben szabadon lép más képernyőre; a `keepalive:true` garantálja a fetch befejezését.
4. **Elfogadás-modal** (`#receiptReviewModal`) — a `ready` tétel „Áttekintés" gombja megnyitja: a sofőr szerkesztheti a mezőket, sőt fuel↔purchase típust is válthat (közös mezők átkerülnek). Elfogadáskor a mezők egy új `alim`/`ach` sorként a menetlevél-piszkozatba (sessionStorage) kerülnek; ha a 2. lépés nyitva, a DOM sor is beszúródik azonnal. Nincs nyitott piszkozat → alap-vázlat automatikusan létrejön; a következő menetlevél-nyitáskor a `draftRestore` visszaállítja.
5. **Robusztusság** — 60 mp-nél régebbi függő `processing` tétel oldal-betöltéskor automatikusan `error`-ra vált (megszakadt fetch nem ragad). `visibilitychange` (tab-visszatérés) és `goSec('dash')` is újrarajzolja a várólistát.
6. **A menetlevél 2. lépés fuel/purchase gombja megmarad** (gyors, közvetlen kiválasztásra), de mindkét út UGYANABBA a perzisztens várólistába ír.
7. **`fuvarStep2` restore** — a scannelt sorok akkor sem vesznek el, ha a sofőr a főoldalról elfogadta őket ELŐBB (step2 még nem volt nyitva) → a `fuvarStep2` a konténerek üresre-állítása után visszaolvassa a sessionStorage-piszkozat `alimentari`/`achizitii` tömbjét (`addAlimRow`/`addAchRow` sorrendben). Így minden működik: (a) kézi rows + scan, (b) 3 külön bon fényképezése (3 külön queue-tétel + 3 külön append), (c) fresh menetlevél scan-nel indítva. Cache-bust `?v=20260722scanq2`.
8. **i18n** — 17 új `sof.dashScanBtn`/`sof.scanQueued`/`sof.rr.*` (RO-alap + HU). **Szerver-oldal ÉRINTETLEN** (`handlers/receiptScan.js`) → az előző körös 12 Jest zöld; teljes suite **672 Jest zöld** (43 skip valós DB).

**Korábbi kör (2026-07-22 — ÚJ: sofőr menetlevél — bon (tankolás/vásárlás) fotózás → AI (Gemini) kiolvasás → új sor előtöltve):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökér:** a sofőrök gyakran útközben tankolnak/vásárolnak; a bonrol kézzel átvezetni minden mezőt (helyszín, dátum, liter, összeg, fizetés-mód) időt visz és hibalehetőség. Kérés: fotózás → AI kiolvasás → menetlevélbe egy előtöltött sor, hiányzó mezők üresen; a sofőr átnézi és a menetlevél többi részével együtt menti.
2. **Új handler `handlers/receiptScan.js` (`scanReceipt` RPC, `routes/execute.js` registry-be regisztrálva)** — a Google Gemini-re bon-specifikus rendszer-prompttal (`kind: "fuel"|"purchase"` + `loc`/`data (YYYY-MM-DD)`/`tip (Motorină|AdBlue)`/`litru`/`km`/`plata (Card|Cash|Flota Card|DKV)`/`suma`/`valuta`/`produs`/`confidence`) küld base64 képet vagy PDF-et; ugyanaz a modell-lánc, mint az `order-ai` `reparse`-nál (429/503 → következő modell — külön napi ingyenes keret). **Kapuk:** bejelentkezés + `Sofer|Admin|Manager` + `ai-kiolvasas` csomag-flag + `GEMINI_API_KEY`. **Fehérlistán validált** válasz (a `plata`/`tip` a menetlevél-űrlap opcióiból, `data` csak ISO, számok számmá) — nincs "kreatív" kulcs-szivárgás a kliensbe. Base64 méret max 8 MB. Audit-naplózva (`receipt.scan`).
3. **Sofőr UI (`public/sofer.html` + `sofer.js`)** — a menetlevél 2. lépésén (⛽ Tankolások / 🛒 Kiadások) az „➕ Hozzáadás" gomb mellé **narancs „📷 Bon szkennelés (AI)" gomb**; koppintásra a rejtett `<input type="file" accept="image/*,application/pdf" capture="environment">` a natív kamerát/galériát nyitja. A kép kliens-oldalon canvas-szal átméretezve (max 1600px hosszú oldal, JPEG q=0.85) → a mobil-fotó bőven belefér a 8 MB-os korlátba. A válasz mezői a Gemini `kind`-je szerint `addAlimRow(f)` VAGY `addAchRow(f)` sort tesznek, majd `draftSave()`; a sofőr átnézi és a menetlevél többi részével együtt menti/küldi.
4. **i18n** — 6 új `sof.scan*` kulcs (RO-alap + HU). Cache-bust `sofer.html`/`sofer.js`/`i18n.js` `?v=20260722scan`.
5. **Teszt** (`tests/unit/receiptScan.test.js`, 12 eset — szerep/env/csomag-kapuk + fájl-validáció + fuel/purchase kiolvasás + `_sanitize` + modell-lánc + azonnali-hiba); **teljes suite 672 Jest zöld** (43 skip valós DB-teszt).

**Korábbi kör (2026-07-22 — FIX: sofőr mobil-app „telefon-lock után nem működik, csak Kilépés+újralépés" — visibility-alapú session-recovery + 8 órás idle-limit + főoldali auto-refresh):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökér:** sofőrök jelezték, hogy ha az app 30–60+ percig háttérben volt (telefon-lock), a visszatérésnél „nem működik" — a kártyák üresek, kattintások nem történnek, csak manuális Kilépés+újralépéssel javul. Két ok: (a) a közös `public/session-guard.js` 30 perces idle-timeoutja mobilon a `setInterval`-t throttolja iOS/Chrome — a döntés késve fut, közben a képernyő-koppintás resetelheti a `lastActivity`-t, így a kliens fut tovább „bejelentkezettként", miközben a szerver-session esetleg már megszűnt; (b) nincs `visibilitychange` figyelő, a `sofer.js` egyetlen fetch-je sem kezeli a 401-et → csak Kilépés+belépés törölné tisztán a stale UI-t.
2. **`public/session-guard.js`** — új `visibilitychange` figyelő: (a) idle-limit fölött → `doLogout('idle')` (tiszta `/login?timeout=1` redirect); (b) különben csendes `authMe` ping → ha `result: null`, azonnal `/login?timeout=1`. `authPingInFlight` őr a duplikáció ellen. Az `IDLE_LIMIT_MS` mostantól `window.VS_IDLE_LIMIT_MIN` (perc) felülírásra reagál — az alap 30 perc marad, ha nincs override.
3. **`public/sofer.html`** — a session-guard betöltése ELŐTT `<script>window.VS_IDLE_LIMIT_MIN = 480;</script>` → 8 óra idle-limit a sofőrre (a szerver-cookie 7 nap). A többi konzol (admin/manager/developer/utvonaltervezes/email-builder) marad az alap 30 percen — ott a felhasználó a gépnél ül, ott a szigorúbb kilépés indokolt.
4. **`public/sofer.js`** — új `visibilitychange` figyelő: a tab-visszatéréskor, ha a főoldal (`#sec-dash`) van előtérben, újratölti `loadDashOrders`+`loadSoferMiniStats`+`loadMyAssignedVehicle`-t → azonnal friss adat, nem stale UI. 20 mp-es rate-limit (`_visRefreshLastAt`). **A menetlevél-piszkozat/beírt űrlap NEM nulázódik** (csak `sec-dash`-en fut).
5. **Cache-bust** — `session-guard.js` `?v=20260614qa` → `?v=20260722sess` mind a hat oldalon (sofer/admin/manager/developer/utvonaltervezes/email-builder); `sofer.html`+`sofer.js` `?v=20260721dashnum` → `?v=20260722sess`.
6. **Nem érintett** — szerver-oldali `express-session` (7 napos cookie), `handlers/auth.js` `authLogout`, `middleware/pageGuard.js`. Tisztán kliens-oldali javítás. **702 Jest zöld.**

**Korábbi kör (2026-07-22 — Sofőr főoldal mini-statisztika: diurna csempe kivéve (csak Admin/Manager látja); 3 csempe szorosan + ~15%-kal magasabb):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökér:** a sofőr havi mini-statisztikán 4 csempe volt (LEZÁRT / KM / DIURNA / TANKOLVA). A diurna napok pénzügyi/elszámolási információ — a főoldalán feleslegesen látszott. Kérés: diurnát csak Admin/Manager lássa; a menetlevélen (PDF) továbbra is szerepeljen mint eddig.
2. **`public/sofer.js` `loadSoferMiniStats`** — a `tile('🗓️', ..., 'statDiurna', ...)` sor eltávolítva; 3 csempe marad: LEZÁRT / KM / TANKOLVA. `getMySoferStats` handler változatlan (a diurna adat még jön a válaszban, csak nem jelenítjük meg — más felületet nem érint).
3. **`public/sofer.css` `.sof-mstat-grid`** — `repeat(2, 1fr)` → `repeat(3, 1fr)`, `gap: 8px` → `4px` (szoros). `.sof-mstat` `padding: 9px 6px` → `14px 5px` — ~15%-kal magasabb csempe, hogy a TANKOLVA prev-sorok (múlt hó, e havi/múlt havi átlagfogyasztás, opcionális warn) kényelmesen kiférjenek.
4. **`routes/soferApi.js` `/api/pdf-download/:id`** — a menetlevél HTML/PDF a `Diurnă externă:` + `Diurnă internă:` sort mostantól csak Admin/Manager nézőnek rendereli (`isSofer` ág üres string). A sofőr saját menetlevelén nem látszik; a diszpécser a cége bármely menetlevelén továbbra igen. A menetlevél többi mezője (útvonal-pontok, tankolások, kiadások, fogyasztás, mentések) minden szerepnek változatlan.
5. **A diurna kalkuláció változatlan** (menetlevél-beküldés `calculateDiurna(indulasDt, erkezesDt, hataratok)` → `diurna_externa`/`diurna_interna` oszlopok). A sofőr űrlapjának „Út időpontjai" + „Határátlépések" + `#diurnaPreview` trip-összegzője érintetlen (bemeneti mezők, nem diurna-érték).
6. **Regresszió-védelem** — `tests/integration/fuvarlevelek-db.test.js` `/api/pdf-download/:id` Admin-ként fut → `'zile'` továbbra is a PDF-ben (nincs teszt-módosítás). Cache-bust: `sofer.html` `?v=20260721dashnum` → `?v=20260722diurna`.

**Korábbi kör (2026-07-22 — FIX: sofőr átlagfogyasztás (`avg_curr`/`avg_prev`) PER-TÉTEL DÁTUM szerint — konzisztens a UI TANKOLVA-val):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökér:** a 2026-07-21-i per-tétel dátum bevezetése után a UI-n megjelenő e havi TANKOLVA (`tl_curr`) helyesen per-tétel dátum szerint bucketolt, DE a MELLETTE megjelenő e havi átlagfogyasztás (`avg_curr` L/100km) képlete még a menetlevél TELJES `alimentari`-tömbjét összegezte → egy júliusi menetlevélbe utólag beírt júniusi tankolás is a júliusi képletbe került → hamisan magas L/100km. Peto konkrét esete: 7215 km + 2018 L TANKOLVA → egyszerű arány 27.97, kijelzett érték 36.6 (a képlet ~2640 L-lel dolgozott, ~620 L extra a más-hónapos tételekből).
2. **Fix (`handlers/statisticsHandlers.js`):** a `calcAvg` mindkét helyen (`getMySoferStats` + `getSoferConsumptionOverview`) új opcionális `tanked` paramétert kapott — ha megadva, azt használja (a per-tétel dátum szerint bucketolt liter-érték), különben fallback = a régi menetlevél-alimentari SUM (backward-compat). A `getMySoferStats` átadja a fő-ciklusban már helyesen kiszámolt `tl_prev`/`tl_curr` értéket. A `getSoferConsumptionOverview` új helyi `_bucketWaybillLiters` / `sumBucketLiters` segédeket kapott (a `getMySoferStats` fő-ciklusával azonos szemantika: dátumozott tétel a saját hónapjához, dátum nélküli → érkezés-hónap / napok szerinti arányos fallback átívelő menetlevélnél) → sofőrönként bucketol, majd `tanked`-ként átadja a `calcAvg`-nek.
3. **Nem érintett:** a `tl_curr`/`tl_prev` mezők értéke változatlan (csak most az `avg`-képletbe helyesen bekötve); a `getFuelStats` jármű-oldali képlete változatlan (menetlevél-alapú aggregátum, önmagában konzisztens); a `motorina_folosit` mentése (menetlevélben) változatlan.
4. **Teszt** — új Peto-eset mindkét handlerre (`sofer-mini-stats.test.js` + `sofer-consumption-overview.test.js`): 7215 km + 500 L jún.-dátumú + 2018 L júl.-dátumú tétel → régi buggy: ~34.90 L/100km (2518 L tanked), új: ~27.97 L/100km (2018 L tanked). **703 Jest zöld** (700 → 703).

**Korábbi kör (2026-07-22 — Statisztika: 4 új mutató + kereső/összehasonlítás a Sofőrök/Járművek/Ügyfelek táblákon):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **4 új szerver-handler** (`handlers/statisticsHandlers.js`), mind `_isAdminOrManager` kapu + company_id-szűrt, paraméteres SQL:
   - **`getVehicleIdleStats`** — jármű állásidő (üres napok fuvarok közt): ablak-függvénnyel az előző Finalizat.finalized_at → következő aktív fuvar.data_incarcare pozitív különbségeinek átlaga, össze és max járművenként. Járművek fülre.
   - **`getServiceForecast`** — szerviz-előrejelzés: az utolsó `vehicle_service_log.next_due_km` + havi 90 napos menetlevél-km átlag + GPS hó-vég snapshot mileage-ből → hetek hátra (≤2 sürgős, ≤6 figyelmeztető). Járművek fülre.
   - **`getOrderFunnel`** — fuvar-státusz funnel + átlagos idők a 4 új milestone-időbélyeg (`sosit_incarcare_at` / `incarcat_at` / `sosit_descarcare_at` / `descarcat_at`) alapján. SLA fülre.
   - **`getCarrierApAging`** — alvállalkozói AP-öregítés (0-30/31-60/60+ nap) a `carrier_invoices`-ból, effektív esedékesség `due_date` → `issue_date+30` → `created_at+30` fallback lánccal. Pénzügyi jog-védett (`_canSeeFinance`). Pénzügy fülre.
2. **Kliens (`public/stats.js`) — közös kereső + összehasonlítás segédek** (`stCompareInit`, `stCompareToolbarHtml`, `stCompareCellHtml`, `openCompare`) a Sofőrök / Járművek / Ügyfelek táblákon:
   - Kereső mező a tábla fejlécében — kliens-oldali sor-szűrés (`data-cmp-label` alapján, nincs új szerver-hívás).
   - Első oszlop checkbox — max 2 sor jelölhető (toast + 3.-at visszaveszi).
   - „🆚 Összehasonlítás" gomb → overlay-modal, metrikánként párhuzamosan mutatja a két entitást (érték + Δ, jobbik zöldre színezve; `higherIsBetter:false`-val a fogyasztás/RON-költség „kevesebb a jobb").
   - Egyszeri delegate-registráció (`box._stCmpBound` flag) → többszöri `load()` sem duplázza.
3. **Új panelek a meglévő pane-eken:** Járművek — „💤 Állásidő" + „🔧 Szerviz-előrejelzés"; Pénzügy — „🧾 Alvállalkozói AP-öregítés"; SLA — „🔻 Fuvar-státusz funnel + átlagos idők" (progressbar-szerű vizuál, %-os konverzió az előző lépéshez, `fmtDuration` perc/óra/nap).
4. **i18n** ~30 új kulcs (`st.ve.pIdle`/`pService`/`weeks`/`serviceHint`/…, `st.fin.pCarrierAp`/`cInvoice`/…, `st.sla.pFunnel`/`stKiirt`…, `st.cmp.*` közös), mind RO-alap + HU. Cache-bust `stats.js?v=20260722cmp`.
5. **Teszt** — új `tests/integration/stats-new-handlers.test.js` (10 mock-eset: szerep-kapu + válasz-alak + fin-jog + adat-alapú sürgős-jelzés). **700 Jest zöld** (690 → 700; valós Postgres 16-tal).

**Korábbi kör (2026-07-21 — Sofőr főoldal: elvégzett + parkolt/raktári fuvar CSAK a menetlevélbe + fuvar-kártyák sorszámmal (#1..N) + összecsukott fejléc = szám + felrakás dátuma + felrakási hely):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökér:** (a) eddig a `Finalizat` fuvar a sofőr főoldalán is látszott a lezárás utáni türelmi ideig (0 menetlevélig „örökké", 1× után 3 nap, 2× után 15 perc); és a `Parkolt`/`Raktarban` (áru-leadás) fuvar is ott maradt, ha az `email_sofer` még a sofőrre mutatott. A kész + leadott fuvar helye a menetlevél, nem a főoldal. (b) Az összecsukott fuvar-kártya csak a fel-/lerakó címeket mutatta, sorszám nem volt.
2. **`handlers/orders.js` `getMySoferOrders`** — a `dash_visible` szigorodott: CSAK a **valóban élő** aktív fuvar (`Alocat`/`In Curs`) látszik a főoldalon; `Finalizat` + `Parkolt` + `Raktarban` mind `dash_visible=false`. A `waybill_visible` (menetlevél-picker) logikája **változatlan** — a lezárt/leadott fuvar ott a mentett menetlevélig / 3 napig / 15 percig továbbra is kiválasztható (Parkolt/Raktarban továbbra is `true`).
3. **`public/sofer.js` `loadDashOrders`** — a szűrt aktív listát megfordítjuk (szerver `created_at DESC` → kliens ASC, legrégebbi = #1), és `renderFuvarCard(o, idx)` 1-alapú `idx`-et kap. Új kiosztás nem üti át a meglévők sorszámát: a régiek maradnak, az újak a végére kerülnek (magasabb #). Lezárt/leadott fuvar (Finalizat/Parkolt/Raktarban) kiesik → következő kiosztás újra 1-től számoz (4 aktív → 2 lezárul → maradék 2 = #1,#2 → új 3 kiosztás = #3,#4,#5, NEM #5,#6,#7). Kliens defenzív fallback szintén szigorodott (Alocat/In Curs).
4. **`renderFuvarCard`** — az összecsukott fejléc új felépítése: `#N` badge + `📅 felrakás dátuma` + `📍 felrakási hely` + `▾`. A lerakó és minden további részlet (ügyfél, cégek, dátumok, állomás-idővonal, UIT/leadás gombok) marad a kinyíló részben (kattintásra → változatlan). `public/sofer.css` új `.fuvar-num` szám-badge (kék `--sof-primary`, fehér); `.fuvar-destination` flex-re vált.
5. **`loadDocOrderOptions`** — a Feltöltött iratok fuvar-választója átvált `dash_visible`-ről `waybill_visible`-re, hogy a nemrég lezárt/leadott fuvarhoz utólag POD/CMR fotót is csatolni lehessen.
6. **Teszt** (`tests/integration/db-orders.test.js`) — a régi „Finalizat menetlevél nélkül SOSEM tűnik el" eset a `dash_visible`-re már nem érvényes; helyette elkülönített `dash_visible` (csak Alocat/In Curs) + `waybill_visible` (Finalizat + Parkolt/Raktarban horgony) elvárás-blokk. **647 Jest zöld** (41 suite). Cache-bust `sofer.css/js?v=20260721dashnum`.

**Korábbi kör (2026-07-21 — Menetlevél: tankolás/vásárlás per-tétel DÁTUM (naptár-választós, mai alapérték) → statisztika is per-tétel dátum szerint):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökér:** a tankolás (`alimentari`) és vásárlás (`achizitii`) sorai eddig egyetlen „Locație & Dată" szöveges mezőt kaptak, dátum-mező NEM tartozott a tételhez → egy átívelő menetlevél (pl. jún. 28 → júl. 3) fuvarlevélben a júniusi tankolás a júliusi statisztikába csúszott (a hónap-szűrés a menetlevél `eff_date`-je alapján történt), és a sofőr havi mini-statisztikája a tankolt litert napok szerint arányosan bontotta.
2. **Sofőr űrlap** (`public/sofer.html`+`sofer.js`): a `Locație & Dată` szövegmező szétvált **`Locație`** (szabadszöveg, mint eddig) + **`Data`** (natív `type="date"` naptár-picker) mezőre; alapérték **a mai (helyi) dátum**, kattintva naptárral választható, óra nincs. Mind a `draftSave` / `soferCollectFull` / `submitFuvarlevel` gyűjtő tömbei tartalmazzák a `data`-t (visszamenőleges tolerancia: hiányzó `data` = üres string). Placeholder `sof.alimLocPh` „pl. Győr" — dátum kikerült.
3. **Admin/Manager menetlevél-szerkesztő** (`public/console-shared.js`): a `feRowAlim`/`feRowAch` rács új `type="date"` oszloppal bővült (közös `_feTodayLocalDate` alap, meglévő értéket visszaállít); `saveFuvEdit` beolvassa a `data` mezőt (`.fe-a-data`/`.fe-c-data`). Adatbázis nem módosul — a JSONB már eleve tetszőleges kulcsokat őriz.
4. **PDF export** (`routes/soferApi.js` `/api/pdf-download/:id`): Alimentări/Achiziții táblák új „Data" oszlopot kaptak (`Loc | Data | …`); a `_fmtItemDate` a `YYYY-MM-DD`-t vagy ISO-t nap-részre vágja.
5. **Statisztika per-tétel dátum szerint** (`handlers/statisticsHandlers.js`): `getFuelStats` és `getPurchaseStats` közös `ITEM_DATE = COALESCE(NULLIF(elem->>'data','')::date, f.eff_date::date)` kifejezéssel szűr/csoportosít — a hónap-bontás mostantól a tétel saját dátuma szerint (fallback régi soroknál a menetlevél `eff_date`-jére). Ugyanígy a sofőr havi mini-statisztika `getMySoferStats`: a tankolt liter tétel-alapon sorolódik a jelen/előző havi kosárba (dátum nélküli tétel = napok szerinti arányos fallback), a diurna és km változatlanul (nincs per-tétel dátum ezekhez).
6. **Teszt** (`tests/integration/sofer-mini-stats.test.js`): 3 új eset — átívelő tétel-alapú (400 jún., 300 júl., NEM 350-350), datetime nélküli tétel arányos fallback, utólag beírt más-hónapos tétel a helyes kosárba. **647 Jest zöld** (644 → 647). Cache-bust `?v=20260721itemdate`.

**Korábbi kör (2026-07-18 — Ideiglenes WhatsApp-alapú chat: sofőr → cég WhatsApp, manager → sofőr WhatsApp):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A belső Firebase-chat átmenetileg WhatsApp-átirányításra vált. Sofőrnek a chat-kártya `wa.me/<cég_szám>`-ra ugrik (a manager állítja be); a manager/admin oldalon a chat fül a SAJÁT cég belső sofőrjeit listázza, kattintva `wa.me/<sofer_tel>` nyílik új tabon. A régi Firebase-chat kód érintetlen (nincs hívva) — könnyen visszakapcsolható.
2. **`db/company-whatsapp-chat.sql`** (idempotens): `companies.whatsapp_number VARCHAR(30)` — külön a meglévő `companies.telefon` mezőtől (az a cég kapcsolattartó száma, más lehet).
3. **`handlers/whatsappChat.js`** (ÚJ, `routes/execute.js`-be regisztrálva) — `getCompanyWhatsapp` (Admin/Manager/Sofer), `saveCompanyWhatsapp` (Admin/Manager, audit, E.164 normalizálás 7–15 jegy), `listDriversForWhatsapp` (Admin/Manager, csak SAJÁT cég sofőrjei — `pozicio='Sofer' AND COALESCE(blocked,false)=false`, `tel_normalized` mezővel). A belső `_normalizePhone` **nem-enumerable exportként** — nem RPC (regressziós teszttel is védett).
4. **Sofőr** (`public/sofer.html`+`sofer.js`): a chat nav-kártya `openWhatsAppFromChatCard()`-ra vált, `sec-chat` pane egyszerűsített (átirányítás-üzenet + gomb). `initFirebaseChat` HÍVÁS eltávolítva. **Admin/Manager** (`console-shared.js`+`admin.js`/`manager.js`): a `chatPane` div-be dinamikusan renderelt WhatsApp UI (`loadWhatsappChatPane()`) — cég-szám kártya (mentés/törlés) + sofőr-lista avatarral. `initFirebaseChatPanel` HÍVÁS eltávolítva.
5. **i18n** `sof.wa*` (sofőr) + `wa.*` (admin/manager) RO-alap + HU. **Teszt** (16 új eset): `_normalizePhone` határesetek, szerep-kapu, `company_id` szűrés, registry-védelem. Cache-bust `?v=20260718wa`; **644 Jest zöld** (628 → 644).

**Korábbi kör (2026-07-18 — Fuvarkezelés: Törölt fuvarok almenü + mező-autocomplete + auto-szakasz eltávolítva):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **🗑️ Törölt fuvarok almenü:** a `comDelete`-tel törölt (`Anulat`) fuvarok eltűnnek a fő fuvarlistából (`comList` szerver-oldalon szűr: `status <> 'Anulat'`) és külön **„🗑️ Törölt fuvarok"** almenüben jelennek meg (admin+manager, Fuvarok csoport). Új handler `getCancelledOrders` (cégre szűrt, Admin/Manager) + `restoreOrder(id)` (Anulat→Disponibil, granulált jog: Manager csak `orders_delete`-tel, audit). `public/feature-catalog.js` új kulcs: `orders-deleted`; i18n `nav.ordersDeleted`, `del.*` (RO-alap+HU).
2. **📝 Mező-autocomplete a fuvar-kiíráson és a szerkesztőben:** minden szöveges mezőnél (`oClient`/`oRef`/`oLoadFirma`/`oUnloadFirma`/`oExternNume`/`oExternFirma`/`oExternTelefon` + szerkesztőben `oeClient`/`oeRef`/`oeLocInc`/`oeLocDesc`/`oeFirmaInc`/`oeFirmaDesc`/`oeNumeSoferExtern`/`oeFirmaExtern`) gépelés közben a cég eddigi (nem Anulat) fuvarjaiba UGYANABBA a mezőbe már beírt egyedi értékek jelennek meg. Új handler `getOrderFieldSuggestions` (Admin/Manager, cégre szűrt, mezőnként max 300). Kliens: `data-sg` attribútum + globális, delegált `data-sg` handler `console-shared.js`-ben, ami a menetlevél-szerkesztő body-hoz fűzött DD-jét (`_feSgDD`) újrahasznosítja (fuvar-modálon belül `_feSg`, kívül `_ocSg`). `ocSgLoad()` előmelegítés `loadOrders`/`loadOrderFormData`-ból → az első fókusz azonnal kínál.
3. **➖ Auto-szakasz eltávolítva:** a `handlers/orders.js` `comCreate`, `bulkCreateOrders` és a `routes/inbound-orders.js` `/approve` út **NEM hoz létre automatikusan** kezdő `order_legs` sort — a fuvar egyetlen INSERT-tel jön létre; szakasz csak explicit „➕ Szakasz" gombra (`addOrderLeg`) keletkezik. A `syncOrderTopFromActiveLeg` viselkedése változatlan (0 leg → `orders.*` top marad az igazságforrás; szakasz-felvételkor a top a legutolsóhoz állítódik). Tesztek: `tests/integration/db-orders.test.js` frissítve az új semantikára — **627 Jest zöld**.

**Korábbi kör (2026-07-18 — Statisztika Sofőrök: km-oszlopok is a fogyasztás-összehasonlításban):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A sofőr főoldali mini-csempéin megjelenő „teljes hó: X / leadott: Y" km-értékek és „e havi + múlt havi átlagfogyasztás" mostantól a manager/admin **Statisztika → Sofőrök → ⛽ Fogyasztás összehasonlítás** paneljében is látszik — sofőrönként, egyben.
2. **`handlers/statisticsHandlers.js` `getSoferConsumptionOverview`** kiegészítve `km_curr`/`km_prev`/`km_prev_gps` mezőkkel a válaszban. `km_curr`+`km_prev`: menetlevél `total_km` sofőrönkénti összege érkezés-hó horgony szerint (`_flsInMonth` már szűr). `km_prev_gps`: a sofőr kiosztott járműveire (`vehicles.assigned_driver_email`) a prev / prev-prev `gps_month_end_snapshots.mileage` deltáinak összege. Nincs új query — a már betöltött `snapMap`/`snapMapPP` + `platesByEmail` map-ből. `_isAdminOrManager` kapu, sofőr NEM éri el.
3. **`public/stats.js` `loadDrivers`** — 3 új oszlop: **E havi km / Múlt hó — teljes (GPS) / Múlt hó — leadott**. Ha GPS-alap > 5%-kal a leadott felett → narancs cella + `+X%` badge (hiányzó menetlevél jelzés). A meglévő sofőr-teljesítmény tábla (`getDriverStats`) érintetlen.
4. **i18n** `st.dr.cKmCurr`/`Tip`, `st.dr.cKmPrevGps`/`Tip`, `st.dr.cKmPrevWb`/`Tip` (RO-alap + HU).
5. **Teszt** (3 új eset: menetlevél-összeg, GPS-delta rendszám-normalizálással, hiányzó snapshot fallback). **627 Jest zöld** (624 → 627).

**Korábbi kör (2026-07-18 — Sofőr-fogyasztás cross-comparison — Statisztika oldal, manager/admin only):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A **Statisztika → Sofőrök** oldalra új szekció: **⛽ Fogyasztás összehasonlítás (L/100km)** — minden belső sofőr e havi + előző havi átlagfogyasztása egy táblázatban, cég-átlaggal és eltérés-oszloppal. > 2.5 L/100km eltérés → narancs háttér + ⚠️ jelzés. Sofőr NEM éri el.
2. **Új handler `getSoferConsumptionOverview`** (Admin/Manager only, `_isAdminOrManager` kapu) — ugyanaz a képlet mint a `getMySoferStats` ((`start_tank + tankolt − end_tank) × 100 / km`); GPS-elsőbbség → menetlevél-fallback. Válasz: `sofers[]` + `company_avg` + `threshold: 2.5`. Rendezés: kiemeltek elöl.
3. **Kliens (`public/stats.js` `loadDrivers`)** — a meglévő sofőr-teljesítmény-tábla ALÁ új panel; deviates sorok narancs háttérrel + ⚠️. Cache-bust `?v=20260718fuelx`.
4. **i18n** `st.dr.pFuelCompare*` + `st.dr.cAvg*` (RO+HU).
5. **Teszt** (5 új eset: szerep-kapu Sofer/Admin/Manager + két sofőr avg + nagy eltérés). **624 Jest zöld** (619 → 624).

**Korábbi kör (2026-07-18 — Sofőr TANKOLVA csempe: átlagfogyasztás L/100km + anomália-figyelmeztetés):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A sofőr TANKOLVA csempéjén két új sor: **e havi eddigi átlag** (a legutolsó menetlevél km/tankolásig) + **múlt hó átlag** (teljes előző hó). Képlet: `(start_tank + tankolt − end_tank) × 100 / km`.
2. **Adatforrás**: GPS-elsőbbség (prev/prev-prev hó-vég snapshotok, `fuel_level`+`mileage`); menetlevél-fallback (első/utolsó havi menetlevél `cant_inceput`/`cant_sfarsit`/`km_inceput`/`km_sfarsit`). Tankolt = alimentari SUM (mindig menetlevélből). Több kiosztott jármű: aggregátum összeg.
3. **Figyelmeztetések**: érték <20 vagy >38 → sofőr „Elmaradt menetlevél beadása"; |Δ havonta| > 4.5 → sofőr „Nézze át a menetlevelet"; |Δ| > 2.5 → manager push + notification (`type='fuel_deviation'`, dedup 1× per sofőr/hónap).
4. **Handler** (`getMySoferStats`) új mezők: `avg_curr`/`avg_prev`/`avg_diff`/`warn_range`/`warn_diff`/`manager_warn_diff`. Menetlevél query kibővítve `cant_*` mezőkkel; snapshot query `fuel_level`-lel. Manager push best-effort a `services/push.js`-en át.
5. **Kliens (`sofer.js` `loadSoferMiniStats`)**: TANKOLVA csempe 3 új sor (avg_curr, avg_prev, opcionális warn); új CSS `.sof-mstat-warn` (narancs). i18n `sof.avgCurr`/`sof.avgPrev`/`sof.warnRange`/`sof.warnDiff` (RO+HU). Cache-bust `?v=20260718fuel`. **619 Jest zöld** (615 → 619).

**Korábbi kör (2026-07-18 — Sofőr mini-statisztika: „teljes hó" (GPS) + „leadott" (menetlevél) külön):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A múlt havi **KM csempén** most KÉT sor jelenik meg: „teljes hó: X" (GPS-alapú, két egymást követő hó-vég snapshot deltája) + „leadott: Y" (menetlevél-alapú). Peto-eset megoldva: valós 11 188 km GPS, 0 menetlevél → csempe „teljes hó: 11 188 / leadott: 0".
2. **`getMySoferStats`** — új `km_prev_gps` mező a válaszban (régi `km_prev` = menetlevél változatlan). A GPS-alap a sofőr KIOSZTOTT járműveire (`vehicles.assigned_driver_email`) számol delta-összeget a prev-month-end és prev-prev-month-end snapshotokból. Snapshot lookup bővítve KÉT hónap-végre egy SELECT-tel.
3. **Kliens (`sofer.js` `tile()`)** — a KM csempe kétsoros prev módra bővítve (`prev2` param). Ha `km_prev_gps > 0` → „teljes hó" + „leadott"; ha 0 → régi egysoros „múlt hó". Többi csempe egyforrású, egy sor marad.
4. **i18n** `sof.mstatFull` / `sof.mstatSubmitted` (RO+HU). Cache-bust `?v=20260718gps`.
5. **Teszt** (4 új eset a dual-mezőre + régi MAX-teszt frissítve). **615 Jest zöld** (611 → 615).

**Korábbi kör (2026-07-18 — Sofőr mini-statisztika: hó-határon átívelő menetlevél SZÉTBONTÁSA):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A sofőr főoldali havi mini-statisztikájában (`getMySoferStats`) az átívelő menetlevél (pl. jún. 28 → júl. 3) mostantól automatikusan szétosztódik a két hónapba — a sofőr EGY menetlevelet tölt ki, a rendszer háttérben szétvágja a statisztikai bevitelt (km + diurna + tankolt liter).
2. **Régi FILTER-es SQL → nyers menetlevél-lekérdezés + JS-alapú aggregáció.** Új lekérdezések: menetlevelek nyers mezők, hónap-határok (`m_curr`/`m_prev` SQL-ből), az előző hó GPS-snapshotjai a cégre.
3. **Szétbontási szabály (JS):** átívelő + snapshot → KM pontosan a snapshotnál vágódik (jún = snapshot − km_inceput; júl = km_sfarsit − snapshot); DIURNA + TANKOLT LITER napok szerint arányos (a diurna intrinsic per-napi; az alimentari nem tárol dátumot). Átívelő snapshot nélkül → KM is arányos napok szerint (fallback). Nem-átívelő menetlevél: teljes érték az érkezés-hónaphoz (változatlan).
4. **Menetlevél-számláló** továbbra is érkezés-hónap alapján (a menetlevél mint EGYSÉG az érkezés-hónapba tartozik; a szám nem bomlik).
5. **Teszt** (6 eset): szerep-kapu / üres / nem-átívelő / átívelő + snapshot / átívelő + fallback / vegyes. **611 Jest zöld** (609 → 611).

**Korábbi kör (2026-07-18 — Hó-végi GPS km + üzemanyag-szint snapshot → következő menetlevél pre-fillje):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A CargoTrack GPS-ből a hónap **utolsó napjának 23:59-hez legközelebbi** olvasása (km-óra + üzemanyag-szint) automatikusan rögzül minden párosított járműre; ez a következő hónap első menetlevelénél a kezdő km + kezdő üzemanyag pre-fill alapja lesz.
2. **Migráció `db/gps-month-end-snapshot.sql`** (idempotens): `gps_month_end_snapshots (company_id, rendszam, year, month, mileage, fuel_level, snapped_at)` + `UNIQUE (company_id, rendszam, year, month)`. A fuel_level a CargoTrack nyers `calculated_inputs.fuel_level` (liter/%, eszköz-függő; sofőr felülírhatja).
3. **Ütemező `services/scheduler.js` `startMonthEndSnapshotScheduler`** (bind: `server.js`) — 20 perces ciklus. Europe/Bucharest zóna: ha ma a hónap utolsó napja ÉS óra ≥ 23, minden CargoTrack-cég minden párosított járművére `getLatestStatus` → mileage + fuel_level upsert `ON CONFLICT UPDATE`. A 23:00-23:59 ablakban 3 tick → a 23:59-hez legközelebbi olvasás marad.
4. **`getLastVehicleReadings` (handlers/orders.js)** — új sub-select az utolsó menetlevél `erkezes_dt` (fallback `indulas_dt`) mezőjére; a `gps_month_end_snapshots` legfrissebb sorát is lekéri. Ha `snapshot.snapped_at > last_arrival`, a snapshot mileage/fuel_level felülírja a pre-fillt. Átívelő menetlevél (jún. 28 → júl. 3) nem csorbul: a júl. 3-i menetlevél újabb → a snapshot nem nyer. Best-effort try/catch (migráció nélkül régi viselkedés). Cross-tenant izoláció változatlan.
5. **Teszt** (`tests/integration/gps-month-end-snapshot.test.js`, 9 eset). **609 Jest zöld** (600 → 609).

**Korábbi kör (2026-07-17 — CI: Render-deploy kivéve, éles CSAK Fly.io):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A **Rendert többé NEM használjuk / NEM deployoljuk** — az éles oldal a **Fly.io**-n fut (`vallorsoft.fly.dev`, `FLY-DEPLOY.md`). `.github/workflows/ci.yml`: a `deploy` job (Render deploy-hook curl) TÖRÖLVE; marad a `test` (Jest) + `deploy-fly` (`superfly/flyctl-actions`, `FLY_API_TOKEN` secret). A `RENDER_DEPLOY_HOOK_URL` secret elhagyható.
2. **CLAUDE.md ELSŐ SZABÁLY 7. pont hozzáadva:** „Éles deploy = CSAK Fly.io. Ne állítsd vissza a Render lépést, ne javasold Renderre költözést." A múltbeli Render-hivatkozások (2026-06-14 kör, ANAF-log, APP_URL-fix) történelmi bejegyzésként érintetlenek.

**Korábbi kör (2026-07-17 — Sofőr havi mini-statisztika: előző havi érték a csempéken):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A sofőr főoldali 4 mini-csempéjén (LEZÁRT FUVAR / KM / DIURNA / TANKOLVA) mostantól az aktuális havi érték MELLETT az **előző havi is** megjelenik — kicsiben, halványan („múlt hó: X" / RO: „lună trecută: X"), a csempe méretét/rácsot érintetlenül. 0 esetén is kiírja (motivációs viszonyítás).
2. **Szerver (`getMySoferStats`)** — egyetlen SELECT-ben, `FILTER (WHERE …)` záradékokkal: új mezők `lezart_prev`, `km_prev`, `diurna_ext_prev`, `diurna_int_prev`, `tankolt_l_prev`. LEZÁRT FUVAR-nál a `COALESCE(finalized_at,data_descarcare,created_at)`, menetlevél-mutatóknál a `COALESCE(erkezes_dt,indulas_dt,data_completare)` (eff_date) horgony változatlan; előző havi ablak `DATE_TRUNC('month', NOW() - INTERVAL '1 month')` ≤ x < `DATE_TRUNC('month', NOW())`. Tenant-védelem (company_id + `LOWER(email_sofer)`) érintetlen.
3. **Kliens (`sofer.js` `tile()`)** — másodlagos sor `.sof-mstat-prev` (11px, `#94a3b8`, `sofer.css`) minden csempén; i18n `sof.lastMonthShort` (HU/RO). Cache-bust `sofer.js`/`sofer.css`/`i18n.js` `?v=20260717prev`. Mock-db harness (`tests/integration/sofer-mini-stats.test.js`, 4 eset). **600 Jest zöld**.

**Korábbi kör (2026-07-17 — Szellem-sofőr adat-törlés + sofőr mini-statisztika forrás-megerősítés):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Szellem-sofőr VÉGLEGES törlése** (Belső sofőrök fül, 🗑️ gomb megerősítéssel): `purgeDriverData(email)` (`handlers/documents.js`, Admin/Manager, audit) törli az adott email menetleveleit + dokumentumait + jármű-hozzárendelését + maradék Sofer-user-ét (csak cég-adat, önmagát nem). A kártya cél-sofőr nélkül is megjelenik. i18n `cs.gd.delete*`.
2. **`getMySoferStats` forrás-megerősítés:** LEZÁRT FUVAR a `Finalizat` fuvarokból (robusztus hónap: `COALESCE(finalized_at,data_descarcare,created_at)`); KM/DIURNA/TANKOLVA a sofőrre kiosztott/általa készített menetlevelekből (`email_sofer`, eff_date-hónap). Cache-bust `?v=20260717purge`; **596 Jest zöld**.

**Korábbi kör (2026-07-16 — UX: bezárható fuvarkérés-értesítő + sofőr vissza-gomb + kézi sofőrnév védelme):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Bezárható beérkező-fuvarkérés sáv** (`#inboundAlert` ✕ gomb, `console-shared.js`) — bezárva csak új kérésnél (nő a szám) jön vissza (`_inboundDismissedCount`).
2. **Sofőr telefonos vissza-gomb** (`sofer.js`, History API csapda) — appon belül lép vissza (menetlevél 2.→1. lépés / modal-zárás / al-oldal→főoldal), a főoldalon dupla-vissza lép ki; egyetlen vissza nem jelentkeztet ki. i18n `sof.backExitHint`.
3. **Kézi sofőrnév védelme** (`feDriverPicked`) — a menetlevél-szerkesztő sofőr-választója a nevet csak ÜRES mezőnél tölti ki, a kézzel beírtat sosem írja felül (a választó az `email_sofer` statisztika-horgonyt állítja). Cache-bust `?v=20260716uxfix`; **596 Jest zöld**.

**Korábbi kör (2026-07-16 — Régi/törölt sofőr menetleveleinek tömeges átrendezése aktuális sofőrre):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A törölt sofőr helyreállított menetlevelei a statisztikában „szellemként" (régi email alatt) jelentek meg; az új sofőr nem kapta meg őket. Új `getWaybillDrivers` + `reassignDriverWaybills(fromEmail,toEmail)` (`handlers/documents.js`, Admin/Manager): a szellem-sofőr ÖSSZES menetlevelét (+POD-dokumentumát) egy kattintással átköti egy aktuális cég-sofőrre (validált cél, `email_sofer`+`nume_sofer`, csak cég-adat, audit). UI: Belső sofőrök fül „🔀 Régi sofőr menetleveleinek átrendezése" kártya (`loadGhostDrivers`/`reassignGhostDriver`). i18n `cs.gd.*`, cache-bust `?v=20260716ghost`; **596 Jest zöld**.

**Korábbi kör (2026-07-16 — MINDEN menetlevél-szűrés/rendezés/statisztika a beírt út-dátum szerint):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A menetlevél korábban sok helyen a kitöltés dátuma (`data_completare`) szerint szűrődött/rendeződött/összesítődött; mostantól MINDENHOL a beírt út-dátum: `eff_date = COALESCE(erkezes_dt, indulas_dt, data_completare)`. Statisztika (`statisticsHandlers.js` közös `FUV_FROM` új `eff_date` oszlop → minden menetlevél-szűrés/havi-bontás; `getMySoferStats` is), Fuvarlevelek lista rendezés (`documents.js`), decont/szerviz-km/üzemanyag-riport (`fleetCompliance.js`), globális kereső (`globalSearch.js`), developer árva-lista (`developer.js`), havi e-mail riport (`scheduler.js`). A fuvar (orders) `finalized_at`/`created_at` metrikák változatlanok. Szerver-only; **596 Jest zöld** + valós Postgres 16 (a júniusban érkezett, júliusban kitöltött menetlevél a júniushoz számít).

**Korábbi kör (2026-07-16 — Menetlevél sorbavétel a beírt indulási/érkezési dátum szerint):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A következő menetlevél kezdő km/üzemanyag értéke (`getLastVehicleReadings` átvitel) eddig a kitöltés dátuma (`data_completare`) szerinti „legutóbbi" menetlevélből jött. Most a sorbavétel a menetlevélbe **beírt** út-dátum szerinti: `ORDER BY COALESCE(erkezes_dt, indulas_dt) DESC NULLS LAST` (érkezési, fallback indulási) — a valóban legkésőbb érkezett út záró értéke lesz a következő kezdő értéke. Szerver-only (`handlers/orders.js`); **596 Jest zöld** + valós Postgres 16 verifikáció (a később kitöltött, de korábban érkezett menetlevél nem üti felül a valódi utolsó utat).

**Korábbi kör (2026-07-16 — FIX: a kézi menetlevél bevétele megjelenik a sofőr statisztikájában):** *(részletes kész-lista: `CHANGELOG.md`)*
1. Sofőrre osztás után a menetlevél km/diurna/fogyasztás már látszott a Sofőrök nézetben, de a bevétel (kézi menetlevél `total_pret`) nem — mert a per-sofőr bevétel csak a fuvarokból (`orders`) számolt. Javítás: `getDriverStats` (`handlers/statisticsHandlers.js`) most a `SUM(f.total_pret)`-et is lekéri (`menetlevel_bevetel`) és a sofőr `bevetel`-éhez adja (fuvar-bevétel megmarad) → összhangban az Áttekintés összbevételével. Szerver-only; **596 Jest zöld** + mock-teszt. *(Megj.: a Statisztika alapból az utolsó 12 hónapot mutatja `data_completare` szerint — régebbi menetlevélhez tágítani kell a dátum-tartományt.)*

**Korábbi kör (2026-07-16 — Menetlevél átköthető aktuális sofőrre a szerkesztőben — statisztika-horgony):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A visszakapott (törölt sofőrtől származó) menetlevél `email_sofer`-e a régi sofőrre mutatott → nem számított aktuális sofőr statisztikájába. Most a menetlevél-szerkesztőben átköthető: `fuvarlevelUpdate` (`handlers/documents.js`) új `email_sofer` mező — csak SAJÁT cég-sofőrre köt át (validált), üres/idegen esetén a meglévő marad (COALESCE, nincs cross-tenant). A sofőr-választó legördülő (eddig csak kézi „Új menetlevél"-nél) most a szerkesztésnél is látszik, a jelenlegi sofőrre állítva (`fePopulateDriverPicker`); `saveFuvEdit` küldi az `email_sofer`-t. Cache-bust `console-shared.js?v=20260716drvbind`; **596 Jest zöld**.

**Korábbi kör (2026-07-16 — Árva menetlevél helyreállítás bővítése: rendszám-backfill + developer kézi hozzárendelő):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökér:** az admin által kézzel létrehozott menetlevélnek jellemzően nincs fuvar-hivatkozása (`order_ids` üres), ezért a #257 fuvar-alapú backfill nem éri el, ha törölt sofőrhöz volt rendelve. Két új út a maradék árva sorokra.
2. **Rendszám-backfill** `db/fuvarlevelek-company-id-plate-backfill.sql` (idempotens, valós Postgres 16-on verifikálva): az árva menetlevél `numar_camion`/`numar_remorca` rendszámát a `vehicles.rendszam`-hoz illeszti; egyértelmű (egyetlen céghez tartozó) egyezésnél kapja a horgonyt, kétértelműnél nem (nincs cross-tenant szivárgás).
3. **Developer „🧾 Árva menetlevelek" fül** (`handlers/developer.js` `devListOrphanWaybills`/`devAssignWaybillCompany`, `public/developer.html`, is_dev): a `company_id IS NULL` menetlevelek listája + rendszámból tippelt cég; a developer legördülővel a helyes céghez rendeli (audit). Garantált manuális helyreállítás. **596 Jest zöld**.

**Korábbi kör (2026-07-16 — FIX: belső sofőr törlésekor a menetlevelei/dokumentumai ne vesszenek el):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökérok:** a `fuvarlevelek`/`documents` eddig CSAK az `email_sofer`→`users.company_id` joinon át kötődött a céghez; a sofőr (`userDelete`) törlésekor a join megszakadt → a menetlevelei/dokumentumai eltűntek a cég nézetéből (fizikailag megmaradtak). Emiatt lehetett 0 látható menetlevele egy cégnek.
2. **Javítás — közvetlen `company_id` horgony** (túléli a törlést): migráció `db/fuvarlevelek-documents-company-id.sql` (idempotens, valós Postgres 16-on verifikálva) — `company_id` oszlop + visszamenőleges feltöltés (élő sofőr `users.company_id`-ja ÉS árva soroknál a hivatkozott fuvar `orders.company_id`-ja `order_ids[0]`/`order_id` alapján). `userDelete` a törlés ELŐTT rögzíti a `company_id`-t. Minden beszúrás eleve horgonyoz (`fuvarlevel-save`/`doc-upload`/`fuvarlevelCreate`).
3. **Olvasás `company_id`-tudatos** (fallback a régi email-join): `getFuvarlevelek`/`getFuvarlevelDetail`/`fuvarlevelUpdate`/`getOrdersMissingWaybill`/`getDriverDocs`, `getLastVehicleReadings`, a statisztika közös `FUV_FROM` blokkja, PDF/dok letöltés, developer összesítő+export. Teszt frissítve; **596 Jest zöld**. *(Korlát: egy fuvar nélküli menetlevél MÁR törölt sofőrtől nem állítható vissza — nincs cég-jel; az újak/törlés-előtti horgonyzás lefedi.)*

**Korábbi kör (2026-07-16 — Menetlevél-automatizáció: km-óra átvitel + hiányzó menetlevél lista + fogyasztási anomália):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Km-óra átvitel:** a `getLastFuelLevel` → `getLastVehicleReadings` (`handlers/orders.js`) mostantól a záró üzemanyag-szintet ÉS a záró km-óra állást is adja (egymástól függetlenül, legutóbbi nem-nulla értékből; `level`=fuel visszafelé kompatibilis). A sofőr menetlevél `prefillWaybillReadings` (`sofer.js`) a `Cantitate început`-ot és a `Km început`-et is előtölti (csak üres/0-t; rendszám-váltáskor újratölt) → hézagmentes km-nyilvántartás.
2. **Hiányzó menetlevél lista:** új `getOrdersMissingWaybill` (`handlers/documents.js`, Admin/Manager, cégre szűrt) — a `Finalizat` fuvarok, amikhez nincs menetlevél (`order_ids` nem tartalmazza — `@> to_jsonb`); a FUVARLEVELEK oldal tetején sárga teendő-sáv (`#missingWaybillBand`/`loadMissingWaybills`).
3. **Fogyasztási anomália-jelző:** a `getFuvarlevelek` a `consum_100`-at a jármű `fuel_per_100km` alapértékéhez veti (rendszám-normalizált); >25% → `consum_anomaly` high/low + `consum_dev_pct`; ⚠️ badge a menetlevél-listában (`fuvAnomalyBadge`). i18n `cs.missingWbTitle`/`cs.missingWbHint`/`cs.anomTitle` (RO+HU), cache-bust `?v=20260716auto3`; **596 Jest zöld**.

**Korábbi kör (2026-07-16 — Sofőr: kiosztott jármű kiírása + menetlevél rendszám-/üzemanyag-előtöltés):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A sofőr↔vontató (`vehicles.assigned_driver_email`) + vontató↔alapértelmezett pótkocsi (`vehicles.default_trailer_id`) párosítást az Admin/Manager **már eddig is** beállítja a Belső sofőrök fülön (`assignDriverVehicle`/`assignDefaultTrailer`, `getDriverVehicleAssignments`) — ez a kör a sofőr-oldalt egészíti ki. Nincs séma-változás.
2. **`getMyAssignedVehicle`** (`handlers/orders.js`, Sofer, cégre szűrt) — a bejelentkezett sofőrhöz rendelt vontató + alapértelmezett pótkocsi rendszáma; a sofőr főoldal tetején `#myVehicleBox` kártya (🚚 vontató + 🚛 pótkocsi rendszám), `loadMyAssignedVehicle`.
3. **Menetlevél rendszám-előtöltés** (`fuvarStep2`): ha a kiválasztott fuvarban nincs rendszám (fuvar nélküli menetlevél is), a `Număr camion`/`remorcă` a kiosztott járműből töltődik alapértékként (üres mezőt nem ír felül, szerkeszthető).
4. **Üzemanyag-átvitel:** `getLastFuelLevel(plate)` (Sofer+Admin/Manager, cégre szűrt, normalizált rendszám) az adott jármű utolsó menetleveléből a záró szintet (`cant_sfarsit`>0) adja; a `Cantitate început` ebből tölt elő (`prefillFuelStart`) — első menetlevél 0-ról indul, utána a záró szint lesz a következő kezdő szint (felülírható; rendszám-váltáskor újratölt, ha üres/0). i18n `sof.myVehicle` (RO+HU), cache-bust `?v=20260716pair`; **596 Jest zöld**.

**Korábbi kör (2026-07-16 — Sofőr: menetlevél kiválasztott fuvar nélkül is):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A sofőr menetlevél 1. lépésén új **„➕ Menetlevél fuvar nélkül" gomb** (`sofer.html`) → `fuvarNoOrder()` → `fuvarStep2(true)` (`sofer.js`): kiválasztott fuvar nélkül is a kitöltő lépésre visz (a „legalább egy fuvar" toast csak a normál úton él); üres kiválasztásnál az összesítő a „fuvar nélkül" jelzést mutatja, a rendszám/dátum/pont-előtöltés kihagyódik. A beküldés `orderIds: []`-t küld (a `/api/fuvarlevel-save` már eddig is elfogadta), a statisztika a sofőr e-mailjéhez kötődik. i18n `sof.noOrderWaybill`/`sof.noOrderSummary` (RO+HU), cache-bust `?v=20260716noord`. Tisztán kliens-oldali; **596 Jest zöld** + DOM-shim harness.
2. **Megjegyzés:** az Admin/Manager kézi menetlevél-készítés (sofőr-választó + statisztika-kötés az `email_sofer`→`users.company_id` joinon át — `fuvarlevelCreate`, `openFuvCreate`/`feDriverPicked`) már korábban kész (2026-06-29); ez a kör a sofőr-oldalt egészíti ki a „fuvar nélkül" úttal.

**Korábbi kör (2026-07-15 — Állomás-visszajelzés kiegészítés: irodai idővonal + menetlevél-előtöltés + kozmetika):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Irodai idővonal:** az admin/manager fuvar-adatlap (`entity-detail.js`) Áttekintés fülén a 4 állomás ✅+időbélyeg / ○ (a `getOrderDetail` `o.*`-ból); új `ed.ms.*` kulcsok (RO+HU); csak aktív fuvaron vagy ha van rögzített állomás.
2. **Menetlevél-előtöltés** (`sofer.js` `fuvarStep2`): az indulás/érkezés a tényleges állomás-dátumból (`incarcat_at`/`descarcat_at`), fallback tervezett `data_incarcare`/`data_descarcare`; **csak dátum** (óra 00:00 → sofőr állítja), üres mezőt nem ír felül; több fuvarnál legkorábbi felrakás / legkésőbbi lerakás.
3. **Kozmetika:** a `Finalizat` kártyán csak akkor jelenik meg az idővonal, ha van rögzített állomás (nincs üres `○○○○`). Cache-bust `?v=20260715ofc`; kliens-oldali, **596 Jest zöld**.

**Korábbi kör (2026-07-15 — Sofőr: a Finalizat fuvar menetlevél nélkül SOSEM tűnik el):** *(részletes kész-lista: `CHANGELOG.md`)*
1. Amíg egy fuvarból **nem készült menetlevél**, a lezárt (`Finalizat`) fuvar semmiképp nem eshet ki a sofőr felületéről. `getMySoferOrders` `dash_visible` + `waybill_visible` új ág: `Finalizat AND waybill_count=0 → true`. A meglévő fade változatlan (≥2 menetlevél → 15 perc; 1 → 3 nap; aktív státuszok mindig). Teszt frissítve; valós Postgres-en **637 teszt zöld**.

**Korábbi kör (2026-07-15 — Sofőr: 4 lépéses állomás-visszajelzés):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A sofőr fuvar-kártyáján **egy gomb** (fuvaronként külön) lenyomásra végiglépteti a 4 állomást, mindegyik **külön időbélyeggel** + **push az irodának**: 📍 felrakóhoz ért (`sosit_incarcare_at`→In Curs) → 📦 felrakodott (`incarcat_at`) → 📍 lerakóhoz ért (`sosit_descarcare_at`) → ✅ leürített (`descarcat_at`→Finalizat).
2. **Szerver** (`routes/ordersRest.js` `POST /api/orders/:id/driver-milestone`, Sofer): a szerver dönti el a következő üres állomást (nem kihagyható/visszajátszható), `NOW()` időbélyeg, státusz-léptetés, tulajdon-ellenőrzött. Migráció `db/order-driver-milestones.sql` (4 TIMESTAMPTZ, idempotens). A meglévő status-logika érintetlen.
3. **Kliens** (`sofer.js`/`sofer.css`/`i18n.js`): a régi „Elfogadom/Elvégeztem" két gombot egy léptető gomb váltja; a kinyíló panelben **állomás-idővonal** (✅+időbélyeg / ○ hátra); `getMySoferOrders` visszaadja a 4 időbélyeget; 7 új `sof.ms.*` kulcs (RO+HU), cache-bust `?v=20260715ms`. Harnesszel verifikálva; **596 Jest zöld**.

**Korábbi kör (2026-07-15 — Fuvar: külön felrakási / lerakási cégnév):** *(részletes kész-lista: `CHANGELOG.md`)*
1. Az `orders` eddig egyetlen cégmezőt tárolt (`client` = megrendelő); most **külön felrakási cég** (`firma_incarcare`) és **lerakási cég** (`firma_descarcare`) is rögzíthető (feladó/címzett). Migráció: `db/order-load-unload-firma.sql` (idempotens, auto-fut).
2. **Admin/Manager fuvar-űrlap** (kiíró + szerkesztő) új „Felrakási cég"/„Lerakási cég" mező a helyszín mellett; bekötve `comCreate`/`comUpdate` (üres→törlés, 255-korlát, paraméteres) + `getOrderById` `SELECT *` előtöltés. A **sofőr fuvar-kártya** kinyíló panelje a cég nevét is kiírja (`getMySoferOrders` visszaadja). `console-shared.js`/`sofer.js`/`i18n.js` (`form.loadFirma`/`unloadFirma`/`firmaPh`/`sof.det.company`, RO+HU), cache-bust `?v=20260715firma`; **596 Jest zöld**.

**Korábbi kör (2026-07-15 — Sofőr: kattintható fuvar-kártya + kinyíló fel-/lerakási részletek, másolható):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A sofőr főoldali kiosztott-fuvar kártyájának **fejléce kattintható** → kinyílik egy részlet-panel: 🏢 ügyfél (`client`), ⬆️ Felrakás (helyszín + dátum), ⬇️ Lerakás (helyszín + dátum), 📝 Megjegyzés (`ref`), ha van. A felrakó/lerakó helyszín + megjegyzés mellett **📋 vágólapra-másoló gomb** (Clipboard API + `execCommand` tartalék, toast-visszajelzés). A másolandó szöveg biztonságos JS-map-ből (nincs felhasználói adat onclick-ben).
2. **Szerver:** `getMySoferOrders` visszaadja a `data_incarcare`/`data_descarcare` dátumot is (nincs séma-változás). **Kliens:** `sofer.js`/`sofer.css`/`i18n.js` (10 új `sof.det.*` kulcs, RO+HU), cache-bust `?v=20260715fdet`; az akciógombok érintetlenek. DOM-shim harnesszel verifikálva; **596 Jest zöld**. *(Megj.: az adatmodellben egyetlen cégmező van — `client` megrendelő; külön feladó/címzett cégnév nincs.)*

**Korábbi kör (2026-07-15 — Fix: fuvar-kiírás cím-autocomplete Nominatim tartalékkal):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökérok:** a fuvar-kiírás cím-autocomplete-je csak a publikus `photon.komoot.io`-ra épült; a `jsonGet` a nem-OK választ (429/5xx/blokk) csendben `{}`-ra nyelte → üres találati lista („nem ad találatot").
2. **Javítás (`lib/mapsProvider.js`):** a `jsonGet` mostantól dob nem-OK státusznál; `_acFree` = **Photon → Nominatim fallback** (OSM hivatalos geocoder, RO/HU bias, tiszta címkék + lat/lng); a `_geoFree` km-becslés-geokódolás ugyanígy. A kulcsos HERE/Google út érintetlen. Tisztán szerver-oldal, nincs séma-/UI-változás; mock-fetch harnesszel verifikálva; **596 Jest zöld**.

**Korábbi kör (2026-07-14 — Sofőr mód: ~15%-kal kisebb megjelenítés + letisztult fejléc):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **~15%-kal kisebb** az egész sofőr-mód: mezők/gombok 56→48px, betű 17→15px, címke 15.5→13.5px, alap-betű 14px, szakasz-cím 20px, checkbox 19px; menüpontok 19→16.5px / 64→56px (de nagy/egykezes marad).
2. **Letisztult fejléc:** az oldalnév nem vágódik le („k" helyett a teljes név, hosszúnál „…"); `vs-tb-left` flex:1+min-width:0 + `text-overflow:ellipsis`; kompaktabb hamburger/téma/mód gombok (48px), kisebb HU/RO, alacsonyabb sáv (64px). Csak `body.vs-dm` + `@media (max-width:1024px)`, a fájl végén (felülírja a korábbit). Cache-bust `style.css?v=20260714smaller15`. Headless Chromiummal (393px) verifikálva; 596 Jest zöld.

**Korábbi kör (2026-07-14 — Sofőr mód: teljes szélességű tartalom + vastag fejléc + nagy hamburger-menü):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Nincs üres oldalsáv:** a 600px-es középre-zárt oszlop eltávolítva → a tartalom és a felső sáv teljes szélességű, egy vonalban. **Vastagabb fejléc** (min-height:76px), **nagyobb gombok** (hamburger + téma/mód 56px, nagyobb HU/RO, 19px oldalnév).
2. **Nagy, egykezes hamburger-menü:** drawer 90vw (max 400px), nagy menüpontok (19px főmenü/18px almenü, 64/60px sorok, 26px ikon). **Szél-levágás minden panelon** (`overflow-x:hidden`+`max-width:100vw`) → sehol nincs oldalirányú húzogatás. Cache-bust `style.css?v=20260714fullwidth`. Headless Chromiummal (900px+393px) verifikálva; 596 Jest zöld; a teljes nézet érintetlen.

**Korábbi kör (2026-07-14 — Sofőr mód: nagyobb ujjbarát méretek ≤1024px-en + tiszta fejléc):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökérok:** a telefon gyakran 769–1024px logikai szélességen renderel („asztali nézet"), ezért a korábbi nagy méretek (`@media max-width:768px`) nem érvényesültek → minden kicsinek tűnt. Javítás: a nagy/érintő-barát méretek `@media max-width:1024px`-re (csak `body.vs-dm`).
2. **Nagyobb űrlapmezők** (56px, 17px betű, nagyobb címke/térköz, 22px checkbox/radio), **56px gombok**; **tiszta fejléc** (🏠+„›" elrejtve, csak az oldalnév; 50px hamburger + téma/mód gombok; nagyobb HU/RO). Cache-bust `style.css?v=20260714bigfields`. Headless Chromiummal (900px) verifikálva; 596 Jest zöld; a teljes nézet érintetlen.

**Korábbi kör (2026-07-14 — Sofőr mód: teljes mobil-barát pass — nincs oldalirányú húzogatás + nagyobb):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **A lap sosem lóg ki oldalra** sofőr-módban telefonon (≤1024px): `body.vs-dm`+`.main-content` `overflow-x:hidden`+`max-width:100vw` → nincs bal-jobb húzogatás. A **széles táblázatok** (Fuvarlevelek/Belső sofőrök stb., a kártyás Fuvar-kezelés kivételével) a saját dobozukon belül görgethetők (`display:block;overflow-x:auto`) → semmilyen adat nem tűnik el, az oszlop-igazítás megmarad.
2. **Nagyobb/barátibb:** alap-betűméret 15.5px, szakasz-cím 21px, űrlap-címke 14px; a Méretek + hasonló flexes input-sorok szükség esetén új sorba törnek. Csak megjelenés, `body.vs-dm`+`@media(max-width:1024px)`-re szűrve; a teljes nézet + Tervezőtábla érintetlen. Cache-bust `style.css?v=20260714mobilefit`. Headless Chromiummal (390px) verifikálva (9-oszlopos tábla: lap nem lóg ki, tábla a dobozában görget); 596 Jest zöld.

**Korábbi kör (2026-07-14 — PWA-telepítő gomb a jobb alsó sarokban):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Új kis „⬇️" FAB** a jobb alsó sarokban, ami a natív PWA-telepítő ablakot nyitja (`beforeinstallprompt`) → az app a kezdőképernyőre tehető. A **sofőr felületen mindig**, az **admin/manager felületen CSAK sofőr-módban** látszik. Csak akkor jelenik meg, ha a böngésző telepíthetőnek jelzi (Chrome/Edge/Android) és még nincs telepítve; a bug-FAB fölé igazítva.
2. **Kliens-oldal, nincs szerver-/DB-változás:** `public/pwa-install.js` (ÚJ, közös) — FAB + `window.VS_PWA_INSTALL.setEnabled(bool)`; `sofer.html` alapból engedélyezve, `admin.html`/`manager.html` `__pwaInstallDefault=false` + a `console-shared.js` `vsSyncDriverModeUI` kapcsolja a sofőr-móddal. Cache-bust `pwa-install.js?v=20260714pwa` / `console-shared.js?v=20260714drvmode5`. DOM-shim harnessel verifikálva; 596 Jest zöld.

**Korábbi kör (2026-07-14 — Sofőr mód telefon-finomítás: kiírás egy oszlop, kezelés-kártya 2 oszlop):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Fuvar-kiírás űrlap telefonon egy oszlopban** (sofőr-mód, ≤1024px): a `.grid-2/3/4` → 1 oszlop, `grid-column:span` resetelve → a korábban jobbra kilógó/levágott mezők (Referencia/Ár/Súly/Méretek/idők/Pótkocsi) most teljes szélességben. **Fuvar-kezelés kártya 2 oszlopban:** 2 mező soronként (ID|Ügyfél, KM|Ár, Vontató|Státusz), a hosszú cellák (Útvonal/Sofőr/Műveletek) full-width → rövidebb, kitölti a képernyőt.
2. **Csak megjelenés:** `public/style.css` additív, `body.vs-dm` + `@media (max-width:1024px)`-re szűkítve; a teljes nézet érintetlen. Cache-bust `style.css?v=20260714drvmode4`. Headless Chromiummal (390px) verifikálva.

**Korábbi kör (2026-07-14 — Sofőr menetlevél: offline mentés a telefonra, internet csak a beküldéshez):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Új „💾 Mentés a telefonra" gomb** a sofőr menetlevél-kitöltőn: indulás előtt a sofőr beír pár adatot, gombnyomásra a **telefonjára** menti (localStorage `vs_sofer_local_drafts`), offline is látható/szerkeszthető a PWA-ban; internet **csak a beküldéshez** kell. „📥 Mentett menetlevelek (telefonon)" lista az 1. lépésen (Megnyitás/Törlés). Offline beküldéskor az adat nem vész el (auto helyi mentés + jelzés); sikeres beküldés törli a helyi piszkozatot.
2. **PWA offline (Fly.io):** `public/sw.js` network-first + **futásidejű cache** (a sikeres azonos-eredetű oldal/JS/CSS elmentve → offline betölt); a SW `self.location.origin`-alapú, tehát automatikusan a kiszolgáló hostot (fly.io) követi; CACHE `v5`→`v6`.
3. **Kliens-oldal, nincs szerver-/DB-változás:** `public/sofer.js` perzisztens local-draft réteg a meglévő sessionStorage-os auto-draft mellé; `public/sofer.html` gomb+lista; `public/i18n.js` 10 új `sof.*` kulcs (RO-alap+HU). Cache-bust `?v=20260714offline`. Node-harness verifikáció (mentés/update/render/törlés); 596 Jest zöld.

**Korábbi kör (2026-07-14 — Sofőr mód: hamburger menü + mobil-kártyás fuvar-táblázat):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Hamburger a sofőr-módban:** új ☰ gomb a felső sávban (`vs-dm-burger`); a 769–1024px sávban (telefon „asztali nézetben"/kis tablet) sofőr-módban a sidebar off-canvas drawerré válik (a meglévő `toggleSidebar`/`closeSidebar` mechanikán), a tartalom teljes szélességű. ≤768px-en a meglévő mobil hamburger marad.
2. **KIÍRT FUVAROK táblázat → mobil-kártyák (≤1024px, sofőr-módban):** fejléc rejtve, minden sor kártya, a cellák `data-label` alapján címkézve (a `renderFilteredOrders` a cellákra `data-label`-t tesz — a teljes nézetet nem érinti), fuvar-szám kiemelten, nagy művelet-gombok, checkbox-oszlop rejtve; a `.table{min-width:560px}` felülírva. `public/style.css` additív, `body.vs-dm`-re szűkített blokk; cache-bust `?v=20260714drvmode3`. Headless Chromiummal verifikálva (390px + 900px); 596 Jest zöld.

**Korábbi kör (2026-07-14 — CI: automatikus Fly.io deploy — az éles oldal Fly-on fut):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökérok:** az éles környezet Render → Fly.io-ra költözött (`vallorsoft.fly.dev`, lásd `FLY-DEPLOY.md`), de a CI `deploy` jobja csak a Render deploy-hookot hívta → a main-merge sosem frissítette az éles Fly-appot (csak kézi `fly deploy`). Ezért nem jelentek meg az élesen a mergelt változások (Sofőr mód stb.).
2. **Javítás (`.github/workflows/ci.yml`):** új `deploy-fly` job — sikeres teszt után main-push-ra `flyctl deploy --remote-only` (`superfly/flyctl-actions`). **Egyszeri teendő: `FLY_API_TOKEN` GitHub secret** (token: `fly tokens create deploy`). Secret nélkül a lépés kecsesen kihagyódik (nincs piros CI); a Render job megmarad, szintén secret-guard mögött. YAML validálva.

**Korábbi kör (2026-07-14 — Fix: lemondott (cancelled) cég reaktiválása nem maradt meg):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökérok:** a developer szerkesztő modálja (`saveCeg`) MINDIG küld `paid_until`-t (üres mezőnél `null`-t); a régi reaktiválás-blokk csak `paid_until === undefined` esetén futott (a „🔓 Activare" gomb útja), így a modál-úton a `subscription_cancel_at` bent maradt + `paid_until` NULL/múlt lett → a napi cancel-scheduler visszaállította `cancelled`-re. (Kézi Neon-szerkesztésnél ugyanígy.)
2. **Javítás (`handlers/developer.js`):** a reaktiválás IDEMPOTENS és minden úton egységes. `devCompanyUpdate` — ha a cél státusz `active`, MINDIG törli a `subscription_cancel_at`+`cancel_lastday_notified` jelzőt, és a `paid_until`-t érvényes jövőbeli értékre hozza (explicit jövőbeli dátum tisztelve; NULL/múlt/nincs → `NOW()+30 nap`; meglévő jövőbeli nem rövidül). `devActivatePayment` is törli a lemondás-jelzőt. Teszt +2 eset; 596 Jest zöld.

**Korábbi kör (2026-07-14 — Sofőr mód: mobil-optimalizált, nagyobb & áttekinthetőbb kezelőfelület):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A „Sofőr mód" (🚚) most **érintő-barát egyszerű kezelést** is ad, nem csak menü-szűrést: bekapcsolva a `body` megkapja a `vs-dm` osztályt (`public/console-shared.js` `vsSyncDriverModeUI`), és a felület nagyobb/letisztultabb lesz. Nagyobb menüpontok (54–60px), nagyobb gombok (min. 46px, mobilon 52px) és űrlapmezők (46–50px), egyszerűbb felső sáv (a `Ctrl+K` globális kereső elrejtve, nagyobb téma/mód gombok), mobilon nagyobb hamburger + szélesebb menü-drawer.
2. **Kliens-oldal, nincs szerver-/DB-változás:** `public/style.css` additív, **kizárólag `body.vs-dm`-re szűkített** blokk a fájl végén (desktop + mobil ≤768px media query) — a teljes nézet érintetlen, könnyen visszavonható. Cache-bust `?v=20260714drvmode2`. A valódi `vsSyncDriverModeUI` a `body.vs-dm`-et mindkét irányban helyesen kapcsolja; 594 Jest zöld.

**Korábbi kör (2026-07-14 — ÚJ: „Sofőr mód" — egygombos egyszerűsített diszpécser nézet):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Cél:** az admin/manager gyakran csak a sofőrrel kapcsolattartáshoz használja a konzolt (fuvar-kiírás + menetlevél-kezelés) — a teljes menü ilyenkor felesleges. Új **🚚 felső-sávi kapcsoló** (`driverModeToggle`, a téma-gomb mellett): gombnyomásra a sidebar leegyszerűsödik, CSAK a sofőr-releváns menüpontok látszanak (Vezérlőpult · Fuvar kiírás/kezelés · Tervezőtábla · Fuvarlevelek · Feltöltött iratok & CMR · Belső sofőrök · Belső chat · Beállítások). `localStorage`-ban őrződik (`vs-driver-mode`).
2. **Kizárólag kliens-oldal (nincs szerver-/DB-/jogosultság-változás):** `public/console-shared.js` KÖZÖS szekció — `VS_DRIVER_MODE_TABS` fehérlista + `vsRecomputeSidebar()`, amely a **csomag-kapcsolót (`getMyFeatures`) és a sofőr-mód szűrőt EGY közös számításba** vonja (a két szűrő így nem üti egymást; üres szülő-csoportok automatikusan becsukódnak/visszaállnak). `applyFeatureFlags` erre épül át. `admin.html`/`manager.html` topbar-gomb, `style.css` `.dm-toggle.active`, `i18n.js` `dm.enter`/`dm.exit` (RO-alap+HU); cache-bust `?v=20260714drvmode`. A valódi kód DOM-modell elleni ellenőrzése zöld; **594 Jest zöld**.

**Korábbi kör (2026-07-09 — Fix: developer reaktiválás — `paid_until` is auto-hosszabbodik trial-lejárat után, PR #233):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökérok:** a developer cégkártya „🔓 Activare" gombja (`unblockCeg` → `devCompanyUpdate`) csak a `subscription_status`-t állította `'active'`-ra, a `paid_until` a múltban maradt (trial-nél `NOW()+14 nap`, utána lejárt). A login-kapu (`routes/auth.js:136`) `paid_until < NOW()`-ra tovább elutasította a belépést („Abonamentul firmei a expirat…"). Ha volt `subscription_cancel_at`, a napi cancel-scheduler másnap újra `'cancelled'`-re állította volna.
2. **`handlers/developer.js` `devCompanyUpdate`** — szerver-oldali védelem: reaktiváláskor (`status='active'`), ha nincs explicit `paid_until` a hívásban, és a jelenlegi NULL vagy múlt → auto-hosszabbítás `NOW() + 30 nap`, `trial_email_sent=false` reset, és (ha be van állítva) `subscription_cancel_at=NULL` + `cancel_lastday_notified=false`.
3. **Nem érinti:** explicit `paid_until` a szerkesztő modálból (`saveCeg`) — tiszteletben tartva; jövőbeli `paid_until` — nem íródik felül; blokkolás (`status='inactive'`) — érintetlen; `devActivatePayment` (payment_request út) — már helyes volt. **Teszt:** `tests/integration/dev-company-reactivate.test.js` — 6 új eset; **246 Jest zöld**.

**Korábbi kör (2026-06-29 — Kézi menetlevél-készítés (Admin/Manager) + össz-bevétel mező):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **„➕ Új menetlevél" a FUVARLEVELEK oldalon** (`received-fuv` pane, admin+manager): az Admin/Manager kézzel hozhat létre menetlevelet, ugyanúgy, mint egy beküldött szerkesztését — a meglévő `#fuvEditModal` újrahasználva (üres mezők, kétmódú edit/create). Sofőr a cég belső sofőrjeiből választható (`getInternalDrivers` legördülő) VAGY szabadon beírható. A sor a **statisztikába is ugyanúgy beleszámít** (tenant-kötés `email_sofer`→`users.company_id`): választott sofőrnél az ő e-mailje, kézi névnél a létrehozó (Admin/Manager) e-mailje a horgony.
2. **Új össz-bevétel mező** (`fuvarlevelek.total_pret`, nettó EUR — `db/fuvarlevel-price.sql`): a kézi menetlevél nem kiírt fuvarból születik, ezért egy mezőbe írható az adott időszak teljes nettó keresete; a Statisztika Áttekintés bevétele = Finalizat fuvarok + kézi `total_pret` (KPI + havi idősor).
3. **`handlers/documents.js`** új `fuvarlevelCreate` (Admin/Manager, `genDocId('FUV')`, cégenkénti MT-YYYY-XXXX sorszám, szerveroldali derivált km/üzemanyag/diurna, audit-mentes best-effort sorszám) + `fuvarlevelUpdate`/`getFuvarlevelDetail` `total_pret`-tel (COALESCE — sofőr-beküldést nem nulláz); `getFuvarlevelek` admin-lista a cég ÖSSZES felhasználójára (a kézi menetlevél is megjelenik). **`handlers/statisticsHandlers.js`** `getStatsOverview` bevétel + havi idősor a kézi menetlevél-bevétellel. `public/console-shared.js` `openFuvCreate`/`feDriverPicked`/`feApplyMode` + `saveFuvEdit` elágazás; i18n `fed.addNew`/`fed.createTitle`/`fed.pickDriver`/`fed.totalPret`… (RO-alap+HU); cache-bust `?v=20260629fuvcreate`. DB nélkül **240 Jest zöld** (+ require-sweep).

**Korábbi kör (2026-06-28 — Fuvarlap nyomtatás csak románul + kezdő/végző dátum óra nélkül, PR #227):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Nyomtatott fuvarlap (PDF) csak románul:** `routes/soferApi.js` `/api/pdf-download/:id` — a szekciócímek magyar glosszái törölve (`(Útvonal pontok)`/`(Tankolások)`/`(Kiadások)`/`(Megjegyzések)`), `Fuvar ID-k`→`ID-uri cursă`, `nap`→`zile`, `Data / ora plecare/sosire` (időponttal) → `Data plecare`/`Data sosire` **dátum óra nélkül** (új `fmtDateRo`, UTC). 2. **Kezdő/végző dátum óra nélkül szerkeszthető (Admin/Manager):** `admin.html`/`manager.html` két új `type="date"` mező (`feIndulasDate`/`feErkezesDate` → `indulas_dt`/`erkezes_dt`); `console-shared.js` `feToDateInput` (UTC); `handlers/documents.js` `fuvarlevelUpdate` `::timestamptz` UTC-éjfél, hiányzó→`COALESCE`. i18n `fed.startDate`/`fed.endDate`; cache-bust `?v=20260628fed2`. Teszt +2; valós DB-vel **281 teszt zöld**.

**Korábbi kör (2026-06-28 — Menetlevél: dátum + fuvar ID-k szerkeszthetők (Admin/Manager), PR #226):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A menetlevél-szerkesztő modálban a **Dátum** (`data_completare`) és a **Fuvar ID-k** (`order_ids`, vesszős lista) is szerkeszthető (eddig csak megjelentek). `admin.html`/`manager.html` két új mező (`feDataCompletare` datetime-local + `feOrderIds`); `console-shared.js` `openFuvEdit` feltölt (`feToLocalDtInput`) + `saveFuvEdit` beolvas; `handlers/documents.js` `fuvarlevelUpdate` perzisztál (`data_completare::timestamp`, `order_ids::jsonb`, hiányzó→`COALESCE` megtart). i18n `fed.dataCompletare`/`fed.orderIds`; cache-bust `?v=20260628fed`. Teszt +2 eset; valós DB-vel **279 teszt zöld**.

**Korábbi kör (2026-06-28 — Belső tesztek bővítése: require-sweep + web-smoke + menetlevél valós-DB, PR #225):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`tests/unit/require-sweep.test.js`** (ÚJ) — automatizált require-sweep: minden modul (`handlers`/`routes`/`services`/`lib`/`middleware`) betöltődik-e (a `../db` mockolva). **`tests/integration/web-smoke.test.js`** (ÚJ) — a server.js teljes route-listája felmountolódik; publikus oldalak 200; védett oldalak login nélkül → `/login`; szerep-eltérés → saját oldal; `/healthz`. **`tests/integration/fuvarlevelek-db.test.js`** (ÚJ, valós DB) — menetlevél teljes út: `fuvarlevel-save`, **`pdf-download` regresszió-őr** (companies.nev join — a korábbi `c.denumire` 500-as bug), `getFuvarlevelek`/`Detail`/`Update`, `getFuvarlevelFieldSuggestions` (distinct + szerep-védelem + cross-tenant). Valós DB-vel **277 teszt zöld** (31 suite); DB nélkül 240 zöld + 37 skip. A CI Postgres 16 service-szel a teljeset futtatja.

**Korábbi kör (2026-06-28 — Menetlevél-szerkesztő: mező-autocomplete a korábbi értékekből, PR #224):** *(részletes kész-lista: `CHANGELOG.md`)*
1. Admin/Manager menetlevél-szerkesztésekor minden szöveges mező gépelés közben felkínálja a cég eddigi menetleveleibe UGYANABBA a mezőbe már beírt, egyedi értékeket. **`handlers/documents.js`** új `getFuvarlevelFieldSuggestions` (Admin/Manager, `company_id`-szűrt, csak olvasás): top-szintű mezők (nume_sofer/numar_camion/numar_remorca/alte_mentiuni) + a JSONB tömbök kulcsai (`puncte` tip/loc, `alimentari` loc/tip/plata, `achizitii` loc/produs/plata); egyedi, nem üres, max 300/mező. **`public/console-shared.js`** könnyű, a szerkesztő-modálra delegált autocomplete-motor (megosztott, body-hoz fűzött `fixed` legördülő, téma-érzékeny); statikus mezők + dinamikus sorok `data-sg`-n át, textarea is. Numerikus mezők kimaradnak. Cache-bust `?v=20260628sg`. Valós Postgres 16-on verifikálva (Admin javaslatok / Sofer tiltva / nincs cross-tenant szivárgás); 130 Jest zöld.

**Korábbi kör (2026-06-28 — Fix: menetlevél PDF letöltés „Eroare de server", PR #223):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`routes/soferApi.js`** `/api/pdf-download/:id` — a `companies` táblát tévesen `c.denumire`-ként kérdezte le (a `companies` névoszlopa `nev`; a `denumire` a `clients` tábláé) → `column c.denumire does not exist` → `500 Eroare de server`, üres PDF-nézet. Javítva `c.nev AS company_denumire`-re. A FUVARLEVELEK oldalon a 👁 PDF megnyitása újra mutatja a menetlevelet. Teljes `denumire`-átvizsgálás: ez volt az egyetlen téves `companies`-hivatkozás. Valós Postgres 16-on verifikálva; 130 Jest zöld.

**Korábbi kör (2026-06-21 — Kedvenc helyszínek: autocomplete + koordináta-kezelés, PR #221):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`lib/mapsProvider.js`** `_acFree`/`_acHere` — mostantól `lat`/`lng`-t is visszaad minden autocomplete találatnál (Photon: `geometry.coordinates`, HERE: `position.lat/lng`).
2. **`public/console-shared.js`** `vsAttachAutocomplete` — kézi gépeléskor `input._vsLat`/`_vsLng` törlése; autocomplete-választáskor beállítása; `onPick(lat, lng)` hívás (visszafelé kompatibilis).
3. **`public/console-shared.js`** `_rmBuildWps` — ha a felrakó/lerakó input-on van `_vsLat`/`_vsLng`, azt átadja a waypoint-nak → `estimateRoute` kihagyja a geokódolást, gyorsabb és pontosabb km-becslés.
4. **`public/fav-locations.js`** — cím-mező Photon autocomplete-tel; mentéskor lat/lng tárolás; 📍 badge táblában + picker menüben; fuvar-kiírásból ⭐ választáskor koordináta bekerül az input-ra.

**Korábbi kör (2026-06-21 — Photon autocomplete javítás: Romania bias + POI cég-találatok):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`lib/mapsProvider.js`** `_acFree` — Romania centroid bias (`lat=45.9&lon=24.9&location_bias_scale=0.5`), limit 6→8, POI-típus felismerés (`_POI_KEYS`: amenity/shop/office/craft/industrial/tourism stb.) → streetAddr is bekerül a sub-labelbe POI esetén, `seen` Set duplikáció-szűrés. Az OSM-ben szereplő romániai cégek/üzletek mostantól jobban előjönnek a fuvar-kiíró cím-autocomplete-ben. (Teljes lefedettséghez HERE API kulcs szükséges a developer panelen.)

**Korábbi kör (2026-06-21 — Blog rendszer: EasyMDE szerkesztő + slug-alapú URL-ek + sitemap.xml):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`db/blog-posts.sql`** (ÚJ, idempotens) — `blog_posts` tábla kétnyelvű mezőkkel (title/content/excerpt/meta_desc RO+HU), cover_image_url, is_published, published_at. A 3 meglévő blog cikk automatikusan migrál predefinált slug-okkal.
2. **`routes/blog.js`** — `GET /api/blog/list` (közzétett cikkek), `GET /api/blog/:slug` (slug VAGY numerikus id, visszafelé kompatibilis), `GET /sitemap.xml` (dinamikus XML: statikus lapok + cikkek).
3. **`handlers/developer.js`** — `devListBlogPosts`/`devCreateBlogPost`/`devGetBlogPost`/`devSaveBlogPost`/`devPublishBlogPost`/`devDeleteBlogPost` (is_dev gated, audit). Slug validáció `[a-z0-9-]{3,200}`, unique conflict kezelés.
4. **`public/blog-editor.html`** (ÚJ) — developer blog kezelő (`/developer/blog`): kétpaneles layout, EasyMDE 2.18.0 RO+HU Markdown szerkesztő, slug auto-generálás, SEO meta karakter-számláló.
5. **`public/blog.html`** (ÚJ) — publikus blog lista (`/blog`), kártyás, API-ból töltve, RO/HU.
6. **`public/blog-post.html`** (FELÜLÍRVA) — dinamikus meta/OG tagek, Article ld+json, marked.js Markdown→HTML.
7. **`public/landing-editor.html`** — régi 3-accordion blog szerkesztő → link a `/developer/blog`-ba.
8. **`public/index.html`** — blog linkek `/blog/1|2|3` → slug URL-ekre. 140 Jest zöld.

**Korábbi kör (2026-06-21 — Fuvar-sorozatok: cégenként állítható/választható fuvar-szám előtag):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A fuvar-szám előtagja eddig fixen `CMD` volt. Most a cég SAJÁT MAGÁNAK állíthatja (mint a menetlevél-szériát): alapból `CMD`, de **új sorozatot is felvehet, átnevezhet**, beállíthat alapértelmezettet, és **fuvar-kiíráskor választhat** közülük. Háttér-garancia: a valódi azonosító továbbra is a cégfüggetlen véletlen `orders.id`, minden lekérdezés `company_id`-szűrt → két cég fuvarjai sosem keverednek.
2. **`db/order-series.sql`** (ÚJ, idempotens) — `order_series` (megjelenített `prefix` + belső `seq_key` + `is_default`); minden cég kap egy alapértelmezett `CMD` szériát (`seq_key='CMD'` → a meglévő számláló folytatódik). A `prefix` elválik a `seq_key`-től → átnevezhető a számlálás megszakítása nélkül. **`lib/orderNo.js`** `getDefaultSeries`/`resolveOrderSeries` (idegen szériát sosem ad — saját defaultra esik vissza) + `nextFuvarNo(db,cid,year,series)`. **`handlers/orderSeries.js`** (ÚJ) list/save(létrehozás+átnevezés)/setDefault/delete — CSAK Admin írhat, company_id-szűrt, `[A-Z0-9]{1,10}` (`MT` foglalt), audit.
3. **Bekötés:** `comCreate` (`series_id`) + `bulkCreateOrders` (importonként közös széria) + inbound approve. **UI:** fuvar-kiíró „Fuvar-sorozat" választó (`oSeria`) + Beállítások → 📋 Számozás → 🚚 Fuvar-sorozatok kezelő. i18n `form.seria`+`comset.os.*` (RO+HU), cache-bust `?v=20260621os`. Valós Postgres 16-on verifikálva (folytatás/független számláló/átnevezés-folytonosság/cross-tenant fallback/idempotencia); 100 Jest zöld.

**Korábbi kör (2026-06-20 — ÚJ: ember-olvasható fuvar-szám CMD-YYYY-XXXX):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A fuvar azonosítója eddig csak a belső véletlen kulcs volt (`orders.id`, pl. `CMD-MBKZ41X07AF`). Most minden fuvar kap egy cégenként/évenként növekvő, ember-olvasható **fuvar-számot** (pl. `CMD-2026-0001`); a belső `orders.id` VÁLTOZATLAN (minden FK/hivatkozás rá épül), a fuvar-szám csak megjelenítési/keresési érték.
2. **`db/order-fuvar-no.sql`** (ÚJ, idempotens) — `orders.fuvar_no VARCHAR(30)` + index + visszamenőleges feltöltés (cégenként/évenként, `created_at`-sorrend) + a `document_series` `CMD`-számláló szinkronizálása. **`lib/orderNo.js`** (ÚJ) `nextFuvarNo(db,cid,year)` a meglévő `document_series` mintán (mint a menetlevél MT-YYYY-XXXX). Bekötve best-effort módon (hiba → `fuvar_no=NULL`, a fuvar mentése akkor is fut): `handlers/orders.js` `comCreate`+`bulkCreateOrders`, `routes/inbound-orders.js` approve.
3. **Megjelenítés:** `comList` visszaadja; a fuvar-lista első cellája a fuvar-számot mutatja (belső id tooltipben), az entitás-adatlap „Nr. cursă" sorral, a globális kereső is keres rá. i18n `ed.o.fuvarNo` (RO-alap+HU), cache-bust `?v=20260620fno`. Valós Postgres 16-on verifikálva (backfill + szinkron + folytatás + idempotencia); 100 Jest zöld.

**Korábbi kör (2026-06-19 — Fix: ANAF CUI-lekérdezés robusztusság):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`services/clients.js`** — `fetchJson` timeout 12 s → **25 s** (ANAF sokszor lassú). Ha `fetch()` dob (SSL/hálózati hiba), a `err.cause.message` is bekerül a hibaüzenetbe — a Render-logban és a felhasználónak is látható lesz a valódi ok (pl. SSL chain-hiba). `!r.ok` és `!r.data` esetén külön, érthetőbb hibaszövegek (RO).
2. **`routes/clients.js`** — `console.error` naplózás az ANAF-hibáknál (CUI + részletes üzenet → Render-napló).

**Korábbi kör (2026-06-19 — Fix: HERE útdíj-becslés nem adott vissza HERE-eredményt):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`lib/mapsProvider.js`** — `bump()` exportálva (`module.exports`-ból hiányzott). A `handlers/toll.js` sikeres HERE-hívás után `maps.bump(cid,'here')`-t hívott, ami `TypeError`-t dobott → try/catch elkapta → HERE-eredmény elveszett, kód visszaesett ingyenes becslésre. Javítás után a „🎯 Pontos (HERE)" jelölőnégyzettel + per-cég HERE-kulccsal valóban HERE-eredmény érkezik (`source:'here'`).

**Korábbi kör (2026-06-19 — Galéria-sablonok: minden gomb működik vagy eltűnik):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A sablonok összes beépített gombja valódi linkre mutat, vagy ha nincs link, eltűnik (nincs „halott" `href="#"` gomb). `public/email-gallery.js`: `btn`/`gbtn` alap-href `{{action_url}}`, az 5 inline CTA-gomb is, követő-gombok `{{track_url}}`; a footer Dezabonare/Contact változatlan.
2. Küldéskor (`handlers/orderEmail.js` `_applyBuilderVars` + `handlers/emailBuilder.js` `applyVars`): üres gomb-link → `__VS_REMOVE__` jelölő → a teljes `<a>` gomb törlődik egy záró regexszel. **`public/order-email.js`** új opcionális „🔗 Link a sablon gombjaihoz" mező (`button_link`, http/https) a `{{action_url}}`-höz; a követés-gomb a `/t/<token>` linket használja. i18n `oe.btnLink`/`oe.btnLinkNote`; cache-bust `?v=20260619btn`; 100 Jest zöld.

**Korábbi kör (2026-06-19 — Galéria-sablonok: céges logó + működő követő-gomb):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A 30 beépített galéria-sablon (`public/email-gallery.js`) fejléccellájába `{{logo}}` helyőrző került (fehér chip mögötte → bármilyen háttéren látszik; üres, ha nincs feltöltött logó). A két követő-gomb `href="{{track_url}}"`-t kap.
2. Küldéskori behelyettesítés: **`handlers/orderEmail.js`** `_applyBuilderVars` — `{{logo}}` nyers logó-HTML (céges `company_branding`, escape-elt URL), `{{track_url}}` a fuvar `/t/<token>` linkje (token-gen, ha `tracking` elérhető; különben `#`). **`handlers/emailBuilder.js`** `applyVars`/`ebSend` ugyanígy (`{{track_url}}`→`#`, nincs fuvar-kontextus). Minden logó-feloldás company_id-szűrt. A már elmentett saját sablonok a token nélkül készültek → a galériából újra mentve jelenik meg. Cache-bust `email-gallery.js?v=20260619logo`; 100 Jest zöld.

**Korábbi kör (2026-06-19 — „Email a fuvarról": vizuális sablon-választó + céges logó):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A fuvar ✉️ „Email despre cursă" dialógusa most a mentett **vizuális sablonok** (e-mail szerkesztő + galériából mentett) közül is választhat: **`handlers/orderEmail.js`** `getOrderEmailData` → `builder_templates` (id/név/tárgy, company_id-szűrt); `sendOrderEmail` új `builder_template_id` → a sablon teljes HTML-je a törzs, a `{{változók}}` escape-elt behelyettesítéssel (ownership id+company_id). **`public/order-email.js`** új „Vizuális sablon" választó (tárgy-előtöltés + jelzés).
2. **Céges logó az e-mail fejlécében** — a kiküldött levél (valós + teszt) fejlécében a cég feltöltött logója (`company_branding`, `/branding/logo/<cid>.png`); ha nincs, marad az alapértelmezett „vallorSoft". A branding-keret közös segéd (`services/email.js` `wrapBrandedEmail`, exportálva); vizuális sablonnál nem csomagoljuk be újra. i18n `oe.tplVisual`/`oe.tplVisualNote`; cache-bust `?v=20260619oetpl`; 100 Jest zöld.

**Korábbi kör (2026-06-18 — Alvállalkozói GPS mint developer funkció-kapcsoló):** *(részletes kész-lista: `CHANGELOG.md`)*
1. Az új funkciók mind kezelhetők a developernél (csomag `getPlanFeatures`/`setPlanFeature` + cég `devGetCompanyFeatures`/`devSetCompanyFeature`), mert a `VS_FEATURES`-ben vannak. Egyetlen kivétel volt: az **alvállalkozói jármű-GPS** — most külön `carrier-gps` kulcs (alapból BE = nem törő). Szerver-gate: `carrierVehicleSetGps`, carrier-portál POST/PUT (kikapcsolva a tárolt adat marad), `track.js` (ügyfél-oldal), `/api/carrier/me` `gps_enabled`. Kliens: diszpécser GPS-oszlop/gomb + portál GPS-mezők elrejtve, ha ki. 100 Jest zöld; cache-bust `?v=20260618cgps2`.

**Korábbi kör (2026-06-18 — Szerep-oldalak kétnyelvűsítés lezárása):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A sofőr/portál/alvállalkozó/könyvelő oldalak már nagyrészt i18n-eltek voltak (a JS-ek `t()`-znek, a HTML `data-i18n`/`<span data-i18n>`). Egyetlen valódi maradék: a **carrier.html GDPR jármű-modal** (RO/HU-inline → `data-i18n`) + vissza-link; +6 `car.*` kulcs. Ellenőrzés: 0 bekötetlen felirat, nincs beégetett toast/confirm a JS-ekben, minden kulcs létezik; 100 Jest zöld; cache-bust `?v=20260618roles`. A **developer** felület szándékosan kimarad (is_dev belső eszköz, HU).

**Korábbi kör (2026-06-18 — Teljes admin+manager panel-kétnyelvűsítés):** *(részletes kész-lista: `CHANGELOG.md`)*
1. Az admin és manager konzol ÖSSZES paneljének/moduljának beégetett magyar felirata bekötve i18n-be (RO-alap + HU): ~260 elem `data-i18n`/`-ph`/`-html`/`-title`; **161 új kulcs** az `i18n.js`-ben (a két konzol azonos modaljai KÖZÖS kulcsokkal). Csak attribútum-hozzáadás — `id`/`onclick`/logika változatlan (verifikálva). Nem fordítandó kódok (státusz/pénznem/szerep) érintetlenek. 0 maradék `<label>`, nincs hiányzó/duplikált kulcs, nincs gyerek-kontrollos label; 100 Jest zöld. Cache-bust `?v=20260618panes`.

**Korábbi kör (2026-06-18 — Menü/almenü kétnyelvűsítés: maradék emojis almenük):** *(részletes kész-lista: `CHANGELOG.md`)*
1. Az admin/manager sidebar 3 színes-emojis almenüje beégetett magyar volt (`👤 Fiók`, `💳 Előfizetés`) → most `data-i18n`. Új kulcsok: `nav.account`, `nav.subscription`. Ellenőrizve: mind az 57 `nav.*` kulcs létezik. Cache-bust `i18n.js?v=20260618navi`; 100 Jest zöld. A két konzol teljes menüje RO-alap + HU-váltó.

**Korábbi kör (2026-06-18 — Integrációk kártyák i18n: RO-alap + HU-váltó):** *(részletes kész-lista: `CHANGELOG.md`)*
1. Az Integrációk fül kártyái kevert RO/HU feliratúak voltak → most mind RO-alap + HU-váltó. **`i18n.js`** ~95 új kulcs (`intg.*`/`eic.*`/`bc.*`/`ctc.*`); **`admin.html`** fül-fejlécek `data-i18n`; **`email-intake-card.js`**+**`billing-card.js`** teljes `t()`-átírás (nyelvváltáskor `onLangChange→loadTab` újrarendel); **`cargotrack-card.js`** statikus markup `data-i18n` (`I18N.apply` mount után) + dinamikus `t()`. Cache-bust `?v=20260618i18n`; 100 Jest zöld.

**Korábbi kör (2026-06-18 — Feladó-fiók duplikáció megszüntetése, szerepfüggő):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A „Cont expeditor / Feladó-fiók" (SMTP/Brevo) kártya KÉT helyen volt (Integrációk `email-sender-card.js` + `/email-builder` „Cont expeditor" panel), ugyanazt az `ebSender*` configot szerkesztve. **Szerepfüggő dedup:** Manager → az e-mail szerkesztőben marad (nem éri el az Integrációkat); Admin → ott elrejtve (`window.__ebHideSender`: nav-kártya + `#sec-sender` rejtve, `ebSwitch` guard, párosítás-warn az Integrációkra mutat), nála az Integrációk a forrás. `public/email-builder.js`; cache-bust `?v=20260618dedup`; 100 Jest zöld.

**Korábbi kör (2026-06-18 — Integrációk oldal: egységes, szimmetrikus kártyák):** *(részletes kész-lista: `CHANGELOG.md`)*
1. Az Integrációk fülön 3 eltérő kártya-stílus keveredett (`.glass` / beégetett `.ct-card` 560px / `.eic`) → aszimmetria. **`public/style.css`** additív, **`[data-pane="integrations"]`-re szűkített** blokk: minden kártya azonos szélesség/padding(22px)/sarok/keret/térköz; a CargoTrack kártya téma-igazítva (világos+sötét). **`public/billing-card.js`**: számlázó-chipek egyenlő oszlopos rácsban. Cache-bust `?v=20260618sym`; 100 Jest zöld. Más oldalt nem érint.

**Korábbi kör (2026-06-18 — Jogi oldalak (RO) bővítése az alvállalkozói GPS-funkcióval):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A román jogi/GDPR oldalak frissítve az új alvállalkozói GPS-adatkezeléshez: **`privacy.html`** §4.4.1 (alvállalkozói járművek GPS-e: megosztott link / AES-titkosított CargoTrack kulcs; az alvállalkozó önálló adatkezelő) + §4.4.2 (publikus követő-link minimális adat); **`terms.html`** §14.1 (szavatosság + sofőr-tájékoztatás); **`dpa.html`** adatkategória + subprocesszor-sor (verzió 1.1). A CLAUDE.md Jogi/GDPR szekció is kiegészítve. A statikus oldalak a dinamikus jogi rendszer fallbackjei.

**Korábbi kör (2026-06-18 — ÚJ: alvállalkozói jármű GPS-követés — megosztott link + opc. CargoTrack kulcs):** *(részletes kész-lista: `CHANGELOG.md`)*
1. Eddig csak a SAJÁT flotta GPS-ét lehetett követni. Most az **alvállalkozó (Extern) járművéhez** is: (1) **megosztott publikus követő-link** (bármilyen GPS-ből), és/vagy (2) **CargoTrack object_id + API-kulcs** élő pozícióhoz a térképen. Felvitel: alvállalkozói portál + diszpécser; megjelenik az ügyfél követő-oldalán is.
2. **`db/carriers-vehicle-gps.sql`** (`carrier_vehicles` + `track_url`/`gps_object_id`/`gps_api_key_enc` AES; kulcs sosem megy kliensbe). **`routes/track.js`** carrier-fallback (rendszám-egyezés szóköz/kisbetű-független) → autó-marker és/vagy `external_url`. **`handlers/carriers.js`** `carrierVehicleSetGps` (titkosítás, jelszó-megőrzés, audit) + `carrierVehicleList` nem szivárogtat kulcsot. **`routes/carrier-portal.js`** portál-CRUD a GPS-mezőkkel.
3. **UI:** diszpécser jármű-tábla „GPS" oszlop + 📍 modal, portál jármű-form GPS-mezők, `track.html` „🛰️ Urmărire externă" gomb. i18n `trk.externalTrack`/`cs.cv.*`/`car.*`; cache-bust `?v=20260618cargps`. 100 Jest zöld.

**Korábbi kör (2026-06-18 — Tracking: élő GPS minden aktív státusznál):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A követő-oldalon „Poziția GPS nu este disponibilă" volt párosított GPS mellett is, mert a pozíciót csak `Alocat`/`In Curs` státusznál kértük le → a `Disponibil` (Înregistrat) fuvarnál sosem jött.
2. **`routes/track.js`** — az élő GPS-lekérés minden AKTÍV státuszra (`Disponibil`/`Alocat`/`Extern`/`In Curs`/`Parkolt`/`Raktarban`); `Finalizat`/`Anulat` kizárva. 100 Jest zöld.

**Korábbi kör (2026-06-18 — Tracking-oldal: tervezett útvonal térkép élő GPS nélkül is):** *(részletes kész-lista: `CHANGELOG.md`)*
1. A publikus követő-oldal (`/t/<token>`) élő GPS hiányában eddig csak szöveget mutatott üres oldallal. Most: ha nincs GPS, a **felrakó → lerakó tervezett útvonal** jelenik meg térképen.
2. **`routes/track.js`** — `route: { from, to }` a válaszban (felrakó/lerakó geokódolva `geocodeCached`-dzsel, `geo_cache` + tokenenkénti 1h cache, best-effort). **`public/track.html`** — GPS → autó-pozíció; nincs GPS de van útvonal → zöld/piros `circleMarker` + szaggatott vonal `fitBounds`-szal; egyik sincs → régi szöveg. 100 Jest zöld.

**Korábbi kör (2026-06-18 — Fix (VALÓDI gyökérok): hibás/markdown-os `APP_URL` env → minden e-mail-link érvénytelen):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökérok:** maga az **`APP_URL` env volt markdown-osan beállítva** (Render) → `base + '/útvonal'` = `[url](url)/útvonal`; a token jó volt, a hibás base (zárójelek) törték el. Minden APP_URL-ből épülő linket érintett (követés/meghívó/reset/portál/előfizetés). **TEENDŐ a Renderen:** az `APP_URL`-t tiszta URL-re állítani.
2. **`lib/appUrl.js`** (ÚJ) — `appBaseUrl(fallback)`: tiszta báziscím akkor is, ha az env markdown-osan/körítéssel jött (kinyeri a `(...)`-beli vagy az első http(s) URL-t, záró `/` levágva). Bekötve MINDEN APP_URL-ből linket építő helyen (orderEmail/email/auth/clientPortal/carriers/public-register/trial-select/subscription-cancel/scheduler/billingHandlers/emailTemplates/developer/stripe/client-mail).
3. **`tests/unit/app-url.test.js`** (ÚJ) — 100 Jest zöld. **Deploy + a Render `APP_URL` javítása után él.** *(Az előző körös `htmlToPlainText` plain-text fix is bent marad — kiegészítő védelem.)*

**Korábbi kör (2026-06-18 — Fix: követő-link érvénytelen e-mailben — markdown `[url](url)` zárójelek, PR #199):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Gyökérok:** a leveleket **csak HTML-tartalommal** (`htmlContent`) küldtük → a **Brevo automatikusan generált sima-szöveges változatot, és a linkeket markdown formában (`[url](url)`) írta ki**; a plain-text részt mutató kliensek a **zárójeleknél elvágták** a publikus `/t/<token>` követő-linket (a token jó volt). Renderen különösen érint (cégenkénti **Brevo fallback**).
2. **`services/email.js`** — új `htmlToPlainText()` segéd (a linkeket **nyers URL-ként** adja vissza, sosem `[ ]`/`( )` köré csomagolva) + explicit szöveges rész minden küldő-ágon (`textContent` Brevónál, `text` nodemailernél): `sendClientEmail`, `_brevoSendCompany`, `getCompanyMailer` SMTP, meghívó/jelszó-reset/developer/lemondás. Exportálva.
3. **`tests/unit/email-plaintext.test.js`** (ÚJ) — a követő-link nyers URL, nincs `()`/`[]`. 96 Jest zöld. **Deploy/restart után él.**

**Korábbi kör (2026-06-18 — Sablon→csatolmány auto-pipa + pecsét/aláírás ráégetés CSP-fix):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`public/order-email.js`** — sablon kiválasztásakor a megfelelő csatolmány **opcionális** auto-bejelölése (`invoice_notify`→számla, `order_confirm_carrier`→megrendelő aláírt-preferált); csak bejelöl, módosítható. Cache-bust `?v=20260618oe3`.
2. **`server.js` CSP-fix** — `connectSrc` +`data:` +`https://cdnjs.cloudflare.com` +`blob:` → a `pdf.js` worker betöltődik (blob-worker) és a `pdf-lib` `fetch(dataURL)` megy → a **pecsét/aláírás ráégetés** (`buildSignedPdf`/aláíró-ablak) végre működik. Deploy után él; 93 Jest zöld.

**Korábbi kör (2026-06-18 — „Email a fuvarról" bővítés: követő-link + mentett sablonok + teszt):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Követő-link pipa** — `sendOrderEmail` `include_tracking` → a publikus `/t/<token>` link a body-ba (token-gen a `tracking` gate mögött). **Mentett sablonok** — `getOrderEmailData` `templates` (a cég sablonjai a fuvar-adattal előtöltve, `emailTemplates.renderCompanyTemplates` NEM-enumerable segéddel) → a dialógus sablon-választója kitölti a tárgyat+üzenetet.
2. **Teszt** — `sendOrderEmail` `test:true` → KÖZÖS VallorSoft címről (`sendClientEmail`) a saját címre (csatolmányokkal); a valós küldés továbbra is a cég SMTP-jén.
3. **`public/order-email.js`** — sablon-választó + „🌍 Követő-link" checkbox + „✉️ Teszt magamnak" gomb; i18n `oe.tracking/tpl/test/...` (RO-alap+HU), cache-bust `?v=20260618oe2`; 93 Jest zöld.

**Korábbi kör (2026-06-18 — „Email a fuvarról": pipálós fuvar-adatok + csatolmányok):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`services/email.js`** `getCompanyMailer.send`/`_brevoSendCompany` mostantól **csatolmányt** is küld (`attachments:[{name,contentBase64}]` → nodemailer/Brevo).
2. **`handlers/orderEmail.js`** (ÚJ, regisztrálva) — `getOrderEmailData` (fuvar-mezők + ügyfél-e-mail + elérhető csatolmányok: order_documents eredeti/aláírt, `documents` POD-fotók, `invoices` PDF) + `sendOrderEmail` (kipipált mezők → adat-tábla, kipipált csatolmányok base64-ben, cég SAJÁT SMTP-jén; Admin/Manager, company_id-szűrt, audit, darab/méret-korlát).
3. **`public/order-email.js`** (ÚJ) `openOrderEmail(orderId)` — pipálós dialógus (címzett bármilyen cím, tárgy, üzenet, „Fuvar-adatok" + „Csatolmányok" checkbox-csoport); a fuvar ⋯ menü „✉️ Email a fuvarról". i18n `oe.*`+`cs.ol.mOrderMail` (RO-alap+HU), cache-bust `?v=20260618oe`; 93 Jest zöld.

**Korábbi kör (2026-06-18 — Külső levelek a cég SMTP-jén, közös cím csak rendszer-értesítésre):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Szabály:** a cég KÜLSŐ levelei (sablonból küldés ügyfélnek, e-mail-szerkesztő) a **cég saját SMTP-fiókján** mennek (Integrációknál beállítva); a **közös VallorSoft cím** csak rendszer-értesítést (regisztráció/lejárat/szerviz) + teszt-levelet küld.
2. **`handlers/emailTemplates.js` `sendTemplatedEmail`:** valós küldés → `getCompanyMailer` (cég SMTP, Brevo-fallback); nincs beállítva → RO hiba „…SMTP… în Integrări". Teszt (`test:true`) → közös címről a belépett user SAJÁT címére (más címet nem fogad el).
3. **`public/email-sender-card.js`** (ÚJ) — feladó-fiók (SMTP/Brevo) kártya az **Integrációk** fülön (csak Admin), a meglévő `ebSender*` handlereken; `admin.js` `loadTab('integrations')` mountolja. i18n `es.*`+`etpl.sentTest` (RO-alap+HU); cache-bust `?v=20260618tpl2`; 93 Jest zöld.

**Korábbi kör (2026-06-18 — Tranzakciós e-mail sablon: közvetlen küldés címzettnek + folyamatba kötés):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`public/templated-email.js`** (ÚJ, közös) — `sendTemplatedEmailDialog({templateKey,keys,vars,toEmail})`: sablon-választós + címzett + `{{változó}}`-mezős dialógus, a meglévő `gas('sendTemplatedEmail')`-re (cég sablonja, escape-elt változók, `mail_log`).
2. **Bekötés:** E-mail sablonok oldal → „📧 Küldés címzettnek" gomb minden sablonhoz; **fuvar ⋯ menü** → „📧 Sablonból e-mail" (`vsSendOrderTplMail`, `_ordersAllCache`-ből előtöltve); **Kimenő számlák** → 📧 (`invOutSendTpl`, `invoice_notify` előtöltve). i18n `etpl.sendToBtn`/`cs.ol.mTplMail`/`etpl.var.*` (RO-alap+HU), cache-bust `?v=20260618tpl`; 93 Jest zöld.
3. **Címzett auto-kitöltés:** a `comList` (`clients.email` join `o.client_id`-n) és a `/api/invoices` lista (`orders`→`clients` join) visszaadja az ügyfél e-mailjét → a dialógus előtölti a címzettet (`toEmail`); hiányzó `client_id`/e-mail esetén üres (kézzel pótolható). Cache-bust `?v=20260618tpl2`.

**Korábbi kör (2026-06-18 — Km-/dátum-alapú szerviz-esedékesség riasztás (GPS km) + e-mail a lejáratokról/szervizekről):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`db/service-due-alert.sql`** — `vehicle_service_log.last_alert_at` (riasztás-ismétlés duplikáció-őr). **`handlers/fleetCompliance.js`** új `computeServiceDueAlerts(cid,{onlyStale})` (NEM-enumerable belső segéd) + `getServiceDueAlerts` handler (Admin/Manager, read-only): a szerviz `next_due_km`-jét az **élő GPS km-órával** (`gps_mileage_log` legutóbbi snapshot), a `next_due_date`-et a mai dátummal veti össze (küszöb 2000 km / 30 nap, vagy túllépve).
2. **`services/scheduler.js`** új `startServiceDueScheduler` (12 órás): push + Notifications + **e-mail a KÖZÖS VallorSoft címről** (`sendClientEmail` → `BREVO_SENDER`, mint a regisztrációnál; RO) az esedékes szervizekről; hetente ismétel (`last_alert_at`). A **`startExpiryScheduler`** is **e-mailt** küld a meglévő push/notify mellé. Közös segéd: `_alertEmailBody` + `_emailAlertToAdmins` (best-effort — Brevo nélkül kihagyja). Bekötve a `server.js`-ben.
3. **Vezérlőpult:** `public/fleet-extra.js` `renderDashServiceAlert` (🔧 sáv → Szerviz-napló) + `#dashServiceAlert` az admin/manager vezérlőpulton (`console-shared.js` `loadDashboard`); 4 új i18n kulcs (RO-alap+HU). Cache-bust `?v=20260618svc`; 93 Jest zöld.
4. **Valós idejű + részletes (követő körben):** a GPS km-óra leolvasás **óránként** fut (`GPS_MILEAGE_INTERVAL_MIN`, alap 60), és minden cég km-frissítése UTÁN **azonnal** ellenőrzi a szerviz-esedékességet (`_dispatchServiceAlerts`) → a km-alapú riasztás nem vár a 12 órás seprésre. Ha nincs GPS-kilométeróra, a `computeServiceDueAlerts` a **menetlevél-km-ből becsli** az aktuális km-et (utolsó szerviz km + azóta megtett `fuvarlevelek.total_km`). Az e-mail járművenként **autó-adatot** (rendszám/márka/típus/aktuális km) + **szerviz-adatot** (esedékesség km/dátum, állapot, típus, utolsó szerviz) ír ki.

**Korábbi kör (2026-06-18 — Előfizetés lemondás (dezabonare) türelmi idővel + visszavonás):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`db/subscription-cancel.sql`** — `companies.subscription_cancel_at` (lemondás-jelző, NULL=nincs) + `cancel_lastday_notified`. A lemondás NEM állítja azonnal `cancelled`-re a státuszt (a `routes/auth.js` login-kapuja a `cancelled`-t/lejárt `paid_until`-t azonnal tiltja) → a státusz `active`/`trial` marad, a hozzáférés a `paid_until`-ig megmarad, és magától ér véget.
2. **`handlers/billingHandlers.js`** — `cancelSubscription`/`reactivateSubscription` (Admin, audit); `getMySubscription` +`cancel_pending`/`cancel_at`/`can_cancel`. **`routes/subscription-cancel.js`** — publikus `GET /abonament/reactivare?cid&tok` (login nélkül, HMAC-token a lemondás idejéhez kötve, timing-safe; egyszer használatos lemondásonként) → törli a jelzőt, RO visszajelző oldal.
3. **`services/email.js` `sendSubscriptionCancelEmail`** (RO, közös Brevo feladó, „M-am răzgândit" gomb) + **`services/scheduler.js` `startCancelReminderScheduler`** (utolsó-napi emlékeztető + lejárt lemondottak véglegesítése). UI: Beállítások → 💳 Előfizetés — „Anulează abonamentul" / piros sáv + „↩️ M-am răzgândit". Cache-bust `console-shared.js?v=20260618cancel`; 93 Jest zöld.

**Korábbi kör (2026-06-17 — ÚJ modul: vizuális e-mail szerkesztő + cég saját feladó-fiókról küldés):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`public/email-builder.html`+`email-builder.js` + `handlers/emailBuilder.js`** — őrzött `/email-builder` (Admin/Manager, `email-builder` kapu); **GrapesJS** vizuális e-mail-sablon szerkesztő KÜLSŐ kapcsolatoknak (ügyfél/jövőbeli/alvállalkozó/egyéb), NEM a platform usereinek. 5 kártya: Új sablon · Megtekintés/Szerkesztés · HTML-feltöltés · Párosítás & Küldés · **📮 Feladó-fiók**. CRUD + sablon↔kontakt párosítás + kiküldés + napló (mind `company_id`-szűrt, tulajdon-ellenőrzött, EMAIL_RE, escape-elt `{{változók}}`, köteg-korlát 200, audit).
2. **A küldés a CÉG SAJÁT fiókjáról megy (nem közös címről):** `services/email.js` `getCompanyMailer`/`loadCompanySender` — feladó-konfig `company_integrations` `provider='email_sender'`-ben AES-titkosítva; **SMTP elsőbbség** (nodemailer `verify()`), kapcsolat-hiba esetén (pl. Render ingyenes csomag tiltja az 587/465-öt) **cégenkénti Brevo** fallback. Beállítatlan feladó-fiók → nem küld, figyelmeztet. `mail_log` naplózás (`type='builder'`).
3. **Tárolás:** `db/email-builder.sql` (idempotens: `email_builder_templates`/`email_contacts`/`email_template_pairings`); a feladó-fiók a meglévő `company_integrations`-ban (nincs új tábla). CSP: 1 sor (`cdn.jsdelivr.net` → `styleSrc`). `feature-catalog`+`i18n` (~95 `eb.*` RO+HU). **Élesben tesztelendő** (a GrapesJS-szerkesztő headless környezetben nem renderel).
4. **Galéria — 30 kész sablon, mindenki számára (PR #180+#181):** `public/email-gallery.js` — beépített (kódból jövő, NEM cégenkénti DB-tétel) sablonok különböző színekben/formákban: 12 alap (napnyugta/óceán/erdő/espresso/minimál/korall/teal/lila/borostyán/navy/piros/pasztel) + 18 új — **komolyabb/sűrűbb** (számla, részletes árajánlat tétel-táblával, havi riport stat-rács, hivatalos értesítés, több szekciós hírlevél, fuvar-állapot tábla, árlista, időpont-visszaigazolás, éves összegzés) és **futurisztikus** (neon, üveg-gradiens, terminál, holografikus, cyberpunk, elektromos minimál, kozmikus) + 2 modern. Mind e-mail-biztos (táblázat + inline CSS, gradiensnél `solid` fallback) és `{{nev}}/{{cegnev}}/{{datum}}` helyőrzős. UI: új „🎨 Galéria" kártya → élő előnézet + „Használ" (a GrapesJS-be tölti ÚJ sablonként → testreszabás + saját mentés). Tisztán kliensoldali. Cache-bust `?v=20260617eb4`; 93 Jest zöld.
5. **Üzemeltetési tanulság (deploy):** a 30-sablonos PR (#181) main-push CI-futása a `concurrency: cancel-in-progress` miatt megszakadt → a Render auto-deploy nem futott (az élesen a 12-sablonos verzió maradt). Megoldás: a sikeres commit (`17470dd`) CI-futásának **rerun**-ja (a `deploy` job ekkor lefutott). **Tudnivaló a jövőre:** gyors egymás utáni main-merge-eknél a régi futás megszakadhat — ilyenkor a deploy-t újra kell indítani (workflow rerun), vagy a `deploy` jobot ki kell venni a `cancel-in-progress` alól.

**Korábbi kör (2026-06-17 — Új landing page meleg arculattal, eredeti szöveggel + szerkesztő-kompatibilisen, PR #178):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`public/index.html`+`landing.css`+`landing.js`** — a publikus landing a jóváhagyott meleg arculatra cserélve. **Originalitás:** új hero-szlogen + minden szöveg saját hangon, a tiltott CargoTMS/xCargo-frázisok 0 előfordulással (ellenőrizve).
2. **Szerkesztő-kompatibilis:** 10 szekció `data-vs-section` (a szerkesztő `DEFAULT_ORDER`-jével), 158 `data-i18n` RO+HU, blog `/blog/:id` — a developer landing-szerkesztő (inline-szöveg + szakasz-sorrend/láthatóság + blog) végig működik, a `landing-editor.html` változtatás nélkül.
3. **Bekötés:** árazás `/api/public-plans` (havi/éves), „Încearcă gratuit"→`/register`, login-lenyíló→`/login`//`/portal`//`/carrier`, RO/HU váltó. Cache-bust `?v=20260617land`; 93 Jest zöld.

**Korábbi kör (2026-06-17 — CargoTMS-hézagok Fázis D/2: PDF-sablon beállítások — a hiánylista A–D KÉSZ, PR #177):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`db/pdf-templates.sql` + `handlers/pdfTemplates.js`** — per-cég/per-doktípus PDF (fejléc/lábléc/akcent/logó); a logó+szín a `company_branding`-ből. `pdfTemplateList/Get` (Admin/Manager), `pdfTemplateSave` (Admin; `doc_type` fehérlista, hex/hossz-validáció, audit), company_id-szűrt.
2. **Bekötés:** a fuvar-lista print stílusozva; a szolgáltatói számlák kizárva (provider rajzolja); waybill/cmr/invoice_note tárolás+előnézet. UI 📄 „PDF-sablonok" (Beállítások). `feature-catalog`+`i18n` (RO-alap+HU), cache-bust `?v=20260617d2`; 93 Jest zöld.
3. **A teljes CargoTMS-hiánylista (A–D) kész** (Bursă kihagyva). **Hátra:** a landing page új arculatra cserélése — a developer landing-szerkesztő horgait (`data-i18n`/`data-vs-section`/sectionOrder/blog) megtartva; a ChatGPT-HTML/mockup jóváhagyására vár.

**Korábbi kör (2026-06-17 — CargoTMS-hézagok Fázis D/1: Fuvar-adatlap + Ügyfél-profil, PR #176):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`handlers/entityDetail.js`** `getOrderDetail`/`getClientProfile` — tulajdon-ellenőrzés + company_id; fuvarnál dok/POD/számla/szakasz/tracking + `audit_log` idővonal (cégre szűrt); ügyfélnél fuvarok/számlák/portál (hash nélkül). `_isAdminOrManager`, read-only.
2. **UI** `public/entity-detail.js` — tabos fuvar- és ügyfél-adatlap; „🔎 Részletek" a fuvar-tábla `⋯` menüjébe (additív, a `comUpdate`/szerkesztő érintetlen) + ügyfél-listára; szerkesztés a meglévő `openOrderEdit`/akciókra linkel. `i18n ed.*` (RO-alap+HU), cache-bust `?v=20260617d1`; 93 Jest zöld.
3. **Folyamatban:** Fázis D/2 — PDF-sablon szerkesztő (a hiánylista vége). Utána: landing (szerkesztő-tudatos kör). Bursă kihagyva.

**Korábbi kör (2026-06-17 — CargoTMS-hézagok Fázis C/5: E-mail sablon-kezelő, PR #175):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`db/company-email-templates.sql` + `handlers/emailTemplates.js`** — cégenkénti, kategorizált, kétnyelvű tranzakciós sablonok (külön tárolás a developer/client-mail sablonoktól). `emailTemplateList/Save` (Admin/Manager, company-szűrt, `key` fehérlista, audit) + `sendTemplatedEmail` (EMAIL_RE-validáció, `applyTemplateVars` HTML-escape → nincs injekció, meglévő `sendClientEmail`+`logMail`).
2. **UI** `public/email-templates.js` — ✉️ aloldal (Adminisztráció, RO/HU szerkesztő + teszt-küldés) + „📧 Sablonból küldés" az Árajánlatok során. `feature-catalog`+`i18n` (RO-alap+HU), cache-bust `?v=20260617c5`; 93 Jest zöld. **A Fázis C teljes.**
3. **Folyamatban:** Fázis D — tabos fuvar-adatlap · ügyfél-profil · PDF-sablon szerkesztő. Bursă kihagyva.

**Korábbi kör (2026-06-17 — CargoTMS-hézagok Fázis C/4: Cég-branding & beállítások, PR #174):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`handlers/companySettings.js`** — „Cég & arculat" pane (Beállítások): logó (meglévő `/api/branding/logo`), márka-szín (hex-validált), PDF-fejléc, `eur_ron_rate`, menetlevél-prefix (meglévő `document_series`). Olvasás Admin/Manager, írás **csak Admin**, `company_id`-szűrt, audit.
2. **`db/company-settings.sql`** (idempotens) — `company_branding.brand_color`+`pdf_header_text`. A számlázó serie/TVA/pénznem a `billing_integrations`-ban marad (nem duplikálva). `feature-catalog`+`i18n` (RO-alap+HU), cache-bust `?v=20260617c4`; 93 Jest zöld.
3. **Folyamatban:** Fázis C maradék (e-mail sablon-kezelő) → D (tabos fuvar-adatlap, ügyfél-profil, PDF-szerkesztő). Bursă kihagyva.

**Korábbi kör (2026-06-17 — CargoTMS-hézagok Fázis C/3: Granulált jogosultságok + Fizetési ütemterv, PR #173):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Granulált jog** — `handlers/permissions.js` (`getCompanyPermissions`/`setUserPermission`, Admin; cég-ellenőrzés + `perm_key` fehérlista + audit). `hasPerm()` nem-enumerable. Szerver-kapu (Admin-bypass): `comDelete`→`orders_delete`, invoice/emit→`invoice_issue`. UI: Manager×jog mátrix a Jogosultságok pane-en. (Nincs új tábla — `user_permissions` újrahasználva.)
2. **Fizetési ütemterv** (`payment-schedule`, Pénzügy, read-only) — `handlers/paymentSchedule.js`: `carrier_invoices` due + `invoices` proxy (`finalized_at + clients.payment_term_days`). `vsMetricBand` + tábla. `feature-catalog`+`i18n` (RO-alap+HU), cache-bust `?v=20260617c3`; 93 Jest zöld.
3. **Folyamatban:** Fázis C maradék (cég-branding + e-mail/PDF sablon) → D (tabos fuvar-adatlap, ügyfél-profil, PDF-szerkesztő). Bursă kihagyva.

**Korábbi kör (2026-06-17 — CargoTMS-hézagok Fázis C/2: Értesítési központ + Mail-napló, PR #172):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`db/notifications.sql`** (`notifications` + `mail_log`) + **`handlers/notifications.js`**/`mailLog.js`. A belső `notify()`/`logMail()` **nem-enumerable** (nem hívható `/api/execute`-en → nincs cross-tenant injekció); `mailLogList` Admin/Manager (címzett-e-mail PII). Minden lekérdezés company_id-szűrt.
2. **Bekötés:** `services/email.js` minden küldő-ág végén best-effort mail-napló (company_id átadva minden hívóról; küldés érintetlen); 2 tiszta eseménynél értesítés (portál-igény + lejárat-scheduler). **GDPR:** export kibővítve `notifications`+`mail_log`-gal.
3. **UI:** 🔔 felső sáv dropdown + `notifications`/`mail-log` aloldal (Adminisztráció). `feature-catalog`+`i18n` (RO-alap+HU), cache-bust `?v=20260617c2`; 93 Jest zöld.
4. **Folyamatban (Fázis C maradék → D):** e-mail/PDF sablon-kezelő · granulált jogosultság · fizetési ütemterv · cég-branding; majd tabos fuvar-adatlap · ügyfél-profil · PDF-szerkesztő. Bursă kihagyva.

**Korábbi kör (2026-06-17 — CargoTMS-hézagok Fázis C/1: Árajánlatok modul, PR #171):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`db/quotes.sql` + `handlers/quotes.js`** — ajánlat-kezelő: `quoteList/Save/SetStatus/ToOrder`. A `quoteToOrder` a MEGLÉVŐ `comCreate`-et hívja (nincs forkolt fuvar-logika); update/konverzió előtt tulajdon-ellenőrzés, státusz-fehérlista, `_am` kapu, audit, paraméteres SQL.
2. **`public/quotes.js`** — KPI-sáv + űrlap (ClientPicker) + tábla „→ Fuvar" gombbal; `quotes` aloldal a Fuvarok alatt, `feature-catalog`+`i18n` (RO-alap+HU), cache-bust `?v=20260617c1`; 93 Jest zöld.
3. **Folyamatban (Fázis C):** Értesítések+Mail-napló → e-mail/PDF sablon → granulált jog → fizetési ütemterv → branding; majd **D**. Bursă kihagyva.

**Korábbi kör (2026-06-17 — CargoTMS-hézagok Fázis B/2: Jármű/sofőr-adatlap tabos drill-in, PR #170):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **`handlers/entityDetail.js`** `getVehicleDetail`/`getDriverDetail` — tulajdon-ellenőrzés elöl (`id=$1 AND company_id=$2`), majd entitásra szűrt lejáratok/szerviz/tankolás (sofőrnél decont). `Admin/Manager`, read-only, paraméteres.
2. **UI** `public/entity-detail.js` — „Részletek" a jármű/belső-sofőr táblán → tabos modal; a Lejárat/Szerviz felvitel a MEGLÉVŐ `expirySave`/`serviceCreate`-tel (előtöltve). A globális Lejáratok/Szerviz/Üzemanyag oldal változatlan. `i18n ed.*` (RO-alap+HU), cache-bust `?v=20260617b2`; 93 Jest zöld.
3. **Folyamatban:** Fázis C (Árajánlatok, Értesítések+Mail-napló, e-mail/PDF sablon, granulált jog, fizetési ütemterv, branding) → D (tabos fuvar-adatlap, ügyfél-profil, PDF-szerkesztő). Bursă kihagyva.

**Korábbi kör (2026-06-17 — CargoTMS-hézagok Fázis B/1: Operatív központ + SLA-analitika, PR #169):** *(részletes kész-lista: `CHANGELOG.md`)*
1. **Operatív központ** (`handlers/opsCenter.js`, GENERAL) — egy `company_id`-szűrt aggregáció (aktív fuvar, mai fel-/lerakás, késő, hiányzó UIT/fuvarozó, lejáró AP-számla + dok, kintlévőség-proxy). Gyors-akciók + prioritás-sor + egészség-sor; `_isAdminOrManager`, read-only.
2. **SLA-analitika** (`getSlaStats`, Statisztika) — lemondási/kézbesített/kiszámlázási arány + átlag tranzit + havi trend; a pontos visszaigazolási-idő KIHAGYVA (nincs per-esemény időbélyeg). `loadSla` (vsMetricBand+Chart.js). `feature-catalog`+`i18n` (RO-alap+HU), cache-bust `?v=20260617b1`; 93 Jest zöld.
3. **Folyamatban:** Fázis B/2 (jármű/sofőr-adatlap a Lejárat/Szervizzel) → C → D. Bursă kihagyva.

**Korábbi kör (2026-06-17 — CargoTMS-hézagok Fázis A/2: Alvállalkozó-csoportok + Kedvenc helyszínek, PR #168):** *(részletes kész-lista: `CHANGELOG.md`)*
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
  **`order-fuvar-no.sql`** (`orders.fuvar_no` — ember-olvasható, cégenként/évenként növekvő fuvar-szám `CMD-YYYY-XXXX` a `document_series` `doc_type='CMD'`-ből; `lib/orderNo.js` `nextFuvarNo`; a belső `orders.id` véletlen kulcs változatlan; visszamenőleges feltöltés + számláló-szinkron a migrációban),
  **`order-series.sql`** (`order_series` tábla — cégenként választható fuvar-szám-előtagok: megjelenített `prefix` + belső `seq_key` + `is_default`; a számláló a `document_series`-ben él `doc_type=seq_key`-vel → az előtag átnevezhető a számlálás megszakítása nélkül; minden cég kap egy alapértelmezett `CMD` szériát; `handlers/orderSeries.js` CRUD, fuvar-kiíráskor választható `series_id`),
  **`client-portal.sql`** (`client_users` tábla — ügyfél-portál belépés; `inbound_orders.source` — a portálról érkező fuvar-igény forrás-jelzése),
  **`order-toll.sql`** (`orders.toll_cost/toll_geo` — fuvar-útdíj + országonkénti bontás; `toll_rates` cégenkénti ráták; `geo_country_cache` lat/lng-rács → ország-kód az útdíj km-bontáshoz),
  **`carriers-ap.sql`** (alvállalkozó-modul: `carriers` törzs + `carrier_invoices` szállítói számlák/AP + `orders.carrier_id/carrier_cost` + alvállalkozói portál `carrier_users`/`carrier_vehicles`/`carrier_documents`),
  **`role-konyvelo.sql`** (a `users`/`invites.pozicio` CHECK-constraint bővítése a `Konyvelo` szerepkörrel — könyvelői felület),
  **`order-status-handover-check.sql`** (az `orders_status_check` bővítése `Parkolt`/`Raktarban`-nal — a `schema.sql` eredeti CHECK-je nem engedte ezeket, így friss DB-n az áru-leadás DB-szinten elhasalt volna; a valós-DB integrációs teszt tárta fel),
  **`order-etransport.sql`** (RO e-Transport: `orders.nc_code` NC/HS-kód + `marfa_value`/`marfa_currency` áru-érték + `needs_uit` jelző — a fuvar-szerkesztő „📑 RO e-Transport" csoportja; a fuvarlistán ⚠️ „UIT lipsă" badge, ha `needs_uit` és nincs aktív UIT),
  **`gdpr-settings.sql`** (`gdpr_settings` cégenkénti adatvédelmi tájékoztató/DPO/„GPS csak üzleti célra"/megőrzés + `gdpr_consents` sofőr-visszaigazolás időbélyeg+IP — Legea 190/2018; `handlers/gdpr.js`, admin Beállítások 🔒 GDPR kártya + sofőr-banner),
  **`email-builder.sql`** (vizuális e-mail szerkesztő: `email_builder_templates` sablonok + `email_contacts` külső kontaktok + `email_template_pairings` sablon↔kontakt párosítás — cégenkénti, paraméteres, tulajdon-ellenőrzött; a kimenő levelek a cég SAJÁT feladó-fiókjáról mennek — SMTP/Brevo a `company_integrations` `provider='email_sender'`-ben AES-titkosítva, NINCS új tábla erre; `handlers/emailBuilder.js`, `/email-builder` oldal + 30-elemű beépített galéria `public/email-gallery.js`),
  **`subscription-cancel.sql`** (előfizetés-lemondás türelmi idővel: `companies.subscription_cancel_at` lemondás-jelző + `cancel_lastday_notified`; a hozzáférés a `paid_until`-ig megmarad, a státusz nem lesz azonnal `cancelled`; `handlers/billingHandlers.js` `cancelSubscription`/`reactivateSubscription`, `routes/subscription-cancel.js` publikus újraaktiváló link, `services/scheduler.js` `startCancelReminderScheduler`),
  **`fuvarlevelek-documents-company-id.sql`** (a `fuvarlevelek` + `documents` táblára `company_id` horgony — a menetlevél/dokumentum eddig csak az `email_sofer`→`users.company_id` joinon át kötődött a céghez, így a belső sofőr törlésekor "eltűnt"; a migráció visszamenőlegesen feltölti — élő sofőr `users.company_id`-ja, árva soroknál a hivatkozott fuvar `orders.company_id`-ja `order_ids[0]`/`order_id` alapján —, a beszúrások/olvasások innentől erre horgonyoznak, a `userDelete` a törlés előtt rögzíti).
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
| **Alvállalkozó saját GPS-rendszere** | kiszervezett fuvar járművének pozíciója (megosztott link vagy az alvállalkozó által megadott API-kulcs) | az alvállalkozó határozza meg | Az alvállalkozó önálló adatkezelő a saját sofőrjei felé (Legea 190/2018); a kulcs AES-titkosítva tárolva |
| **[HOSTING — KITÖLTENDŐ]** | szerverszolgáltatás | [ország] | Ha EU → ok; ha USA → SCCs kell |

> **Google Firebase jogi alap:** az EU–US Data Privacy Framework (Európai Bizottság 2023/1795 határozata) alapján az USA megfelelő védelmi szintűnek minősül; emellett Google Standard Contractual Clauses (SCCs) és DPA elérhető a [Google Cloud DPA](https://cloud.google.com/terms/data-processing-addendum) oldalán. Privacy policy-ban fel kell tüntetni: *„Adattovábbítás harmadik országba (USA) az EU–US Data Privacy Framework és SCCs alapján."*

### Kezelt személyes adatok
- **Sofőrök:** név, e-mail, telefonszám, valós idejű GPS pozíció
- **Ügyfelek (client portal):** név, e-mail, kapcsolattartó adatok
- **Alvállalkozók (carrier portal):** név, e-mail; jármű GPS-követés (megosztott link és/vagy AES-titkosított CargoTrack API-kulcs + object_id) — a kiszervezett fuvar járművének pozíciójához. Az alvállalkozó felel a saját sofőrjei tájékoztatásáért.
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
