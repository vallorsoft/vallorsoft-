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

## 2026-06-17 — CargoTMS-hézagok Fázis A/1: BNR + Teljesített fuvarok + Aktív flotta (PR #167)

> Három új, read-only oldal a meglévő adatból, menübe rendezve — a hiánylista (CargoTMS-összevetés) Fázis A első köre.

- **BNR árfolyam** (`bnr-rate`, Pénzügy) — `handlers/bnr.js` `getBnrRate`: a meglévő `services/bnr.js` élő EUR/RON + a cég `eur_ron_rate` (Admin/Manager kapu, `company_id=$1` paraméteres). Pane KPI-sávval + frissítés.
- **Teljesített fuvarok** (`orders-done`, Fuvarok) — `handlers/ordersDone.js` `getFinishedOrders`: `status='Finalizat'`, `company_id=$1` + opcionális `from/to` (validált), `COALESCE(finalized_at,created_at)`-re. Read-only archív tábla + KPI-sáv + CSV-export. A fő Fuvarok-kezelés érintetlen.
- **Aktív flotta** (`active-fleet`, Flotta) — a **meglévő** `getActiveVehiclePositions` + `getVehicleStatusSummary` újrahasználva: dedikált élő Leaflet-térkép (`#fleetMap`, világos csempe) + jármű-státusz lista + KPI-sáv. Nincs új GPS-logika, saját map-id (nem `dashMap`).
- **Wiring:** új `public/console-pages.js` (mindkét konzolon), `loadTab` (admin/manager), `feature-catalog.js` (3 kulcs), `i18n.js` (`nav.*`/`bnr.*`/`od.*`/`af.*`, RO-alap+HU). Cache-bust `?v=20260617a1`. Minden read `company_id`-szűrt + paraméteres, role-gated; auth/billing/orders-render érintetlen; 93 Jest zöld.

## 2026-06-16 — Pénzügy: Kimenő + Bejövő számlák almenük (PR #166)

> A Pénzügy csoport két új számla-aloldalt kap — a meglévő funkciók újrahasználásával (nincs duplikáció).

- **Backend (egyetlen új végpont):** `routes/invoices.js` `GET /api/invoices` — cégre szűrt kimenő számla-lista (`WHERE i.company_id=$1`, opcionális `?from=&to=` paraméteres, `ORDER BY created_at DESC LIMIT 500`, generikus hiba). A kiállítás/storno/státusz végpontok változatlanok.
- **📤 Kimenő számlák** (`invoices-out`, új `public/invoices-out.js`): a cég kimenő számláinak listája (szám/ügyfél/dátum/összeg/ÁFA/státusz-pirula/e-Factura/PDF), KPI-sávval (Összes/Kiállított/Sztornózott/Össz. érték a lekért listából). Műveletek a **meglévő** végpontokon: PDF (`pdf_link`), Storno (`/api/orders/:id/invoice/storno`), Státusz (`/api/invoices/:id/status`). A per-fuvar 🧾 kiállító gomb érintetlen.
- **📥 Bejövő számlák** (`invoices-in`): a kész alvállalkozói AP (`loadCarrierAp` + `carrierInvoice*` handlerek) **áthelyezve** ide a Külső sofőröktől — egyetlen `#carrierApBox` konzolonként (nincs duplikált id); az alvállalkozó-törzs a Külső sofőröknél marad.
- **Wiring:** `loadTab` (admin/manager.js) `invoices-out`→`loadInvoicesOut`, `invoices-in`→`loadCarrierAp`; `feature-catalog.js` (cégenként kapcsolható) + `i18n.js` (`nav.invoicesOut/In` + `invo.*`, RO-alap+HU). Cache-bust `?v=20260616inv`. **Biztonság:** az új végpont `company_id`-szűrt + paraméteres; auth/multi-tenant/billing-logika érintetlen. 93 Jest zöld.

## 2026-06-16 — Meleg paletta-hézagok lezárása (gombok, intake/chat, Útvonaltervezés) (PR #165)

> A warm-rollout befejezése: a konzol-skin által nem érintett hideg-kék/sötét pontok átszínezve. Csak szín — szöveg/szerkezet/logika érintetlen.

- **Gyökérok:** `public/style.css` `.main-content .btn.primary` egy régi redesign-blokkban **`!important` kék** gradienst használt, ami felülütötte a meleg szabályt → **minden konzol primary-gomb kék maradt** (GDPR „Adat-export", számlázó „Tovább", CargoTrack „Mentés"). A blokk most napnyugta gradiens (`#fb8c3a→#f6517b`), keret/glow meleg. (A `.stat-val`/`.stat-ico` régi indigó `!important` is melegre.)
- **Modul-kártyák:** `billing-card.js` (`ACCENT` `#6366f1`→`#f6711e`), `cargotrack-card.js`/`cargotrack-pairing.js` (`#2563eb`→`#f6711e`).
- **E-mail-intake kártya** (`email-intake-card.js` + `style.css` `.eic` téma-szabályok): a sötét navy → olvasható (világos = krém+sötét szöveg, sötét = espresso+világos szöveg).
- **Belső chat** (`style.css` `.chat-*` téma-szabályok): olvasható meleg (saját üzenet = napnyugta gradiens, másiké = világos/espresso kártya); az avatar-gradiens is meleg.
- **Útvonaltervezés oldal** (`utvonaltervezes.html`, saját inline stílus): háttér-radálok, mód-gombok („Autós/Útvonal tervezése"), kijelölt jármű, betöltő-marker, „Soft" logó → meleg; a Leaflet-térkép és vezérlők érintetlenek (zöld=GPS/piros=lerakó szemantika megtartva).
- Cache-bust `?v=20260616warm2`. `node --check` OK, 93 Jest zöld; backend/teszt/KPI-sáv/fuvar-tábla/e-mail-sablon nem érintve.

## 2026-06-16 — Meleg utánkövetés: KPI-sáv érték-HTML fix + e-mail sablonok átszínezése (PR #164)

> Élesben jelentett hiba + a warm-rollout befejezése. (1) A KPI-sávban az érték HTML-je escape-elve jelent meg a Statisztika-oldalakon; (2) az összes kimenő e-mail sablon a meleg palettára színezve.

- **`public/console-shared.js` `vsBandInner`** — **HIBAJAVÍTÁS:** a `v` (érték) **nem escape-elt** többé, mert a hívók (pl. a Statisztika a mértékegységet kis `<span>`-ban) megbízható megjelenítő HTML-t adnak — eddig `0 <span…>EUR</span>` nyersként jelent meg (CO₂/Áttekintés/Pénzügy). A címke (`l`)/sub/trend escape-elt marad (XSS-biztos; a `v` sosem nyers user-input). Cache-bust `console-shared.js?v=20260616fix`.
- **E-mail sablonok meleg átszínezése (csak szín):** `services/email.js` (meghívó/reset/üdvözlő-wrapper/developer-wrapper), `routes/trial-select.js` (fizetési e-mail + köszönő oldal), `services/scheduler.js` (havi riport + trial-emlékeztető), `routes/public-register.js` (üdvözlő). Kék/indigó → napnyugta narancs/korall + espresso/krém; a szöveg/link/`{{változó}}`/tárgy/küldés-logika **érintetlen**, a státusz-színek (zöld/piros/borostyán) megőrizve. 93 Jest zöld (incl. `invite-email.test.js`).
- **Még hátra (paletta-hézagok):** néhány modul-kártya gomb még kék (Integrációk: GDPR/számlázó/CargoTrack), az e-mail-intake + chat kártya sötét, és a külön Útvonaltervezés oldal (saját inline stílus) — következő körben.

## 2026-06-16 — Avatar + pirula a többi listatáblán (PR #163)

> A fuvar-tábla „avatar + pirula" kinézete kiterjesztve a többi konzol-listára. Display-only, additív — a gombok/oszlopok/akciók érintetlenek.

- **Közös `vsAvatar(name)`** (`public/console-shared.js`, `window`-re kitéve) — escape-elt monogram-avatar, determinisztikus szín; `.vs-av`/`.vs-cellpill` CSS (`public/style.css`, téma-érzékeny light+dark).
- Bekötve: **Munkatársak** (`admin.js`/`manager.js` — avatar a név elé, `pozicio` → `.vs-cellpill`), **Belső sofőrök** + **Külső sofőrök** (`console-shared.js` — avatar a név elé), **Ügyfelek** (`clients-page.js` — avatar a `denumire` elé; az ÁFA-pirula marad). Minden gomb (Szerk/Törlés/Anonimizálás/stb.) byte-pontosan megőrizve.
- Cache-bust `?v=20260616pill`. Backend/SQL/auth nem változott; 93 Jest zöld.

## 2026-06-16 — ÚJ modul: e-CMR (digitális CMR többfeles aláírással) (PR #162)

> Új, valódi modul a Dokumentumok alatt: egy fuvarhoz tartozó elektronikus CMR, amit max. 3 fél (feladó/fuvarozó/címzett) ír alá. EU-piaci alapelvárás (Transporeon/Timocom/Trans.eu). MVP: rögzítés + aláírás-állapot követés. Multi-tenant + GDPR-tudatos.

- **`db/ecmr.sql`** (ÚJ, idempotens migráció) — `order_ecmr` tábla: `company_id`, `order_id`, `status` (draft/partial/completed/cancelled), és per-fél `*_name`/`*_signed_at`/`*_ip`/`*_sig` oszlopok; index `(company_id, order_id)`. Auto-fut induláskor.
- **`handlers/ecmr.js`** (ÚJ) — `ecmrList/ecmrGet/ecmrCreate/ecmrSign`. **Biztonság:** `ecmrCreate` beszúrás ELŐTT ellenőrzi a fuvar tulajdonjogát (`orders WHERE id=$1 AND company_id=$2` → nincs cross-tenant write); minden SQL `company_id`-szűrt + paraméteres; az `ecmrSign` oszlopnév-interpoláció a `PARTIES` **fehérlistából** (a `party`-t a SQL előtt validálja); `isAdminManager` kapu az írásokon; input-korlátok (név 200 / sig 200 KB / IP 64); **audit** minden íráson; generikus hibaüzenet.
- **GDPR:** **`handlers/gdpr.js` `exportCompanyData` kibővítve** az `order_ecmr` aláírás-adataival (név/IP/időbélyeg; a rajzolt aláírás-kép kizárva) — a 6. szabály szerint a személyes adat bekerül a GDPR-exportba. Anonimizálás NEM (jogi megőrzés, Legea 82/1991 → 5 év, felülírja a törlést). A `routes/developer-export.js` céges-export is tartalmazza.
- **Frontend:** `public/ecmr.js` (lista per-fél aláírás-pillákkal, „létrehozás fuvarból", per-fél aláírás), `ecmr` aloldal a Dokumentumok csoportban (📝) admin+manager; `feature-catalog.js` (cégenként kapcsolható) + `i18n.js` (24 kulcs, RO-alap+HU). `routes/execute.js` regisztráció. Cache-bust `?v=20260616ecmr`. 93 Jest zöld.

## 2026-06-16 — ÚJ modul: CO₂ riport (valódi, olvasás-only) (PR #161)

> Új Statisztika-aloldal (`stats-co2`): a cég CO₂-kibocsátása a már tárolt üzemanyag-/km-adatból. EU fenntarthatósági elvárás; megkülönböztető marketing-érv. Read-only, nincs új tábla/migráció, nincs személyes adat.

- **`handlers/statisticsHandlers.js`** — `getCo2Report(req,res,args)`: `_isAdminOrManager` kapu (mint a többi stats-handler); minden SQL **`company_id`-szűrt + paraméteres** (üzemanyag: `company_id=$1`; km: `FUV_FROM` users-joinján át `u.company_id=$1`). Diesel **2,64 kg CO₂/liter**; AdBlue kizárva. Visszaad: össz. CO₂ (t), liter, CO₂/100km (ha van km), fa-egyenérték, havi bontás, jármű top-10. Olvasás-only, generikus hibaüzenet.
- **`public/stats.js`** — `loadCo2()`: `.tall` KPI-sáv + havi Chart.js oszlop + jármű-tábla + CSV; valós érték, nincs koholt trend.
- **`admin.html`/`manager.html`** — `stats-co2` aloldal a Statisztika csoportban (🌱) + pane; **`feature-catalog.js`** + **`i18n.js`** (RO-alap+HU). Cache-bust `?v=20260616co2`. 93 Jest zöld.

## 2026-06-16 — Landing page meleg átszínezés (PR #160)

> A publikus landing a konzol új **meleg arculatát** kapja: kék/indigó → napnyugta narancs/korall + krém + espresso + meleg teal. CSAK szín — a tartalom, layout, szövegek, i18n, JS-logika érintetlen.

- **`public/landing.css`** — a `--lp-*` paletta-tokenek meleg értékekre: primer `#3b82f6`→`#f6711e` (narancs), másodlagos `#6366f1`→`#f6517b` (korall), `--lp-grad` napnyugta gradiens, `--lp-teal #0d9488` pop, sötét szekciók navy→espresso (`#1e1812`/`#271f18`), világos `#f7f9fc`→krém `#faf6f0`, szöveg/keret meleg. A státusz-színek (zöld ok / piros hiba) megőrizve; a „Soft" logó a napnyugta gradiensen.
- **`public/index.html`** — cache-bust `landing.css?v=20260616warmland`. `landing.js` nem változott (csak osztálynevek, nem szín-értékek). 93 Jest zöld.

## 2026-06-16 — Fázis 2 (9. lépés): teljes meleg paletta a konzolon (PR #159)

> A admin/manager konzol egységes **meleg arculatot** kap (krém + espresso + napnyugta akcent), a kék/indigó helyett. **Additív, könnyen visszavonható** réteg: egyetlen, kommentelt blokk a `style.css` VÉGÉN — a meglévő szabályok érintetlenek, más oldalakat (login/portál/sofőr/developer/landing) nem érint.

- **`public/style.css`** — konzolra szűkített (`.main-content`/`.sidebar`/`.vs-topbar`) meleg-skin: **világos** (krém #faf6f0, krém kártyák, meleg keret/szöveg) és **sötét** (espresso #1e1812→#271f18, NEM navy) téma is; sidebar espresso-gradiens; primary gomb/link/aktív fül/fókusz/logó-akcent → napnyugta narancs; az „info/folyamatban" hideg kék → **meleg teal**. A KPI-sáv, a `.vsl-*` fuvar-tábla és a `.h-title` akcent érintetlen (harmonizál).
- **Tervezőtábla:** a layout/szélesség **változatlan** (csak átszínezés, nincs `width/grid/flex`); a Visszfuvar-radar panel meleg keretet kap.
- Cache-bust `style.css?v=20260616warm`. Tisztán additív (0 törölt sor), nincs JS/HTML/handler/biztonság-érintés; 93 Jest zöld. *(Vizuális finomhangolás élesben várható.)*

## 2026-06-16 — Fázis 2 (8. lépés): Fuvarok-kezelés tábla — vizuális gazdagítás (PR #158)

> A fuvar-tábla a mockup kinézetét kapja: vizuális útvonal (felrakó • ─→ 📍 lerakó), sofőr-monogram-avatar, státusz-pirula és sor-bal státuszcsík. **CSAK megjelenés** — minden interaktív funkció (oszlop-átméretezés/átrendezés, kijelölés, tömeges letöltés, inline státusz-váltó, akciógombok) byte-pontosan megőrizve; a 10 oszlop és sorrend változatlan.

- **`public/console-shared.js`** — `renderFilteredOrders`: a route/sofőr cella belső tartalma dekoratív burkot kap (`vsl-route`, `vslAvatar`), a státusz-`<select>` `vsl-pill` osztályt (az `onchange="quickStatusChange"`, `disabled`, opciók, inline szín változatlan), a `<tr>`/első cella státusz-osztályt a bal csíkhoz. Új `vslAvatar()` segéd (csak megjelenítés).
- **`public/style.css`** — `#tblOrders`-re **szűkített** `.vsl-*` szabályok (route/avatar/pill/sorcsík/akciógomb); nincs globális hatás.
- Cache-bust `console-shared.js`/`style.css` `?v=20260616olist`. Backend/SQL/auth/handler nem változott; a tábla-logika (resize/reorder/selection/download/dropdown) érintetlen; 93 Jest zöld.

## 2026-06-16 — Fázis 2 (7. lépés): egységes oldal-fej (gradiens akcent-csík a címek elé) (PR #157)

> A panel-/szekciócímek egységes ritmust kapnak: finom napnyugta-gradiens akcent-csík a `.h-title` elé. CSS-only, a konzolra szűkítve (`.main-content`), abszolút pozíciójú `::before` → nem rendezi át a cím gyerekeit; könnyen visszavonható. Nincs HTML-átírás, nincs funkció-érintés.

- **`public/style.css`** — `.main-content .h-title::before` (5px gradiens csík, `--vs-warm-grad`), `padding-left:15px`, finom `letter-spacing`/`.h-sub` ritmus. Cache-bust `style.css?v=20260616band6`.
- Backend/SQL/auth/HTML-szerkezet nem változott; 93 Jest zöld.

## 2026-06-16 — Fázis 2 (6. lépés): KPI-sáv a Beérkező megrendelések és Ügyfél kérések oldalon (PR #156)

> Az A (KPI-sávok) kör lezárása: a kompakt mutató-sáv a két beérkező-oldalra, a már lekért listából. Additív — a listák, elfogadás/elvetés, AI-kiolvasás érintetlenek.

- **`public/inbound-orders.js`** — `load()`: sáv a `#ioBand`-be a már lekért adatból: **Feldolgozatlan** (hero) / **Elintézett** / **Összes megrendelés**. (A lista `?exclude_source=portal` → nincs félrevezető e-mail/portál bontás, helyette pending/handled/total.)
- **`public/client-requests.js`** — `load()`: sáv a `#crBand`-be: **Összes kérés** (hero) / **Új/várakozik** / **Elvetett** (a meglévő status-mezőből; az üres ág előtt is renderel).
- **`public/i18n.js`** — `inb.kpi*` / `cr.kpi*` kulcsok (RO-alap + HU). Cache-bust `?v=20260616band5`. `typeof`-guard; backend/SQL/auth nem változott; 93 Jest zöld.
- Ezzel a KPI-sáv minden releváns konzol-oldalon él (a form/chat/beállítás-jellegű oldalakon a mockupban sem volt sáv).

## 2026-06-16 — Fázis 2 (5. lépés): KPI-sáv a Járművek és Ügyfelek oldalon (PR #155)

> A (kompakt) mutató-sáv a Járművek és Ügyfelek oldalra, a már lekért listából. Additív — a táblák, űrlapok, ANAF-keresés, portál-hozzáférés érintetlenek.

- **`public/console-shared.js`** — `loadVehicles`: a `vehicleList`-ből számolt sáv (Járművek összesen [hero] / Vontatók / Pótkocsik) a `#vehiclesMetricBand` konténerbe.
- **`public/clients-page.js`** — `loadList` → `renderBand`: a `/api/clients` válaszból (Ügyfelek összesen [hero] / Cégek `PJ` / Magánszemélyek `PF`) a `#clMetricBand`-be; `typeof`-guard, `window.t` fallback (IIFE-modul).
- **`public/admin.html` + `public/manager.html`** — `#vehiclesMetricBand` konténer a vehicles pane-ben; cache-bust `console-shared/i18n/clients-page ?v=20260616band4`.
- **`public/i18n.js`** — `veh.bandTotal`, `cl.bandTotal/bandPj/bandPf` (RO-alap+HU); `veh.tractors/trailers` újrahasználva. Backend/SQL/auth nem változott; 93 Jest zöld.

## 2026-06-16 — Fázis 2 (4. lépés): KPI-sáv a Lejáratok és Üzemanyagkártya oldalon (PR #154)

> A (kompakt) mutató-sáv a Flotta két riport-jellegű oldalára, a már kiszámolt adatból. Additív — az űrlapok, táblák, CSV-import, eltérés-riport érintetlenek.

- **`public/fleet-extra.js`** — `loadExpiries`: a `_expItems`-ből számolt sáv (Figyelt dok. [hero] / Hamarosan lejár / Lejárt / Rendben — a meglévő `days_left`/`alert_days` logikával). `fcLoadData`: a fuel-lista `total`-jából sáv (Tankolás [hero] / Liter / Költség). `typeof vsMetricBand === 'function'` guard, kompakt mód.
- **`public/i18n.js`** — új `fe.exp.kpi*` / `fe.fc.kpi*` kulcsok (RO-alap + HU); a `fe.fc.colLiter` újrahasználva.
- **`admin.html`/`manager.html`** — cache-bust `i18n.js?v=20260616band3`, `fleet-extra.js?v=20260616band3`. Backend/SQL/auth nem változott; `node --check` OK, 93 Jest zöld.

## 2026-06-16 — Fázis 2 (3. lépés): KPI mutató-sáv a Fuvarok-kezelés oldalon (PR #153)

> A (kompakt) mutató-sáv a Fuvarok-kezelés oldal tetejére, a már lekért fuvar-listából számolt értékekkel. Additív — a táblázat és minden funkciója érintetlen.

- **`public/console-shared.js`** — új `renderOrdersMetricBand(list)`; a `loadOrders` a `comList` teljes (szűretlen) eredményéből (`_ordersAllCache`) tölti a sávot: **Összes fuvar** (hero) · **Aktív** (In Curs/Alocat/Extern) · **Kiosztásra vár** (Disponibil) · **Lezárt** (Finalizat). A kliens-oldali szűrés csak a táblát rendezi, a KPI-k stabilak. Nincs új hálózati hívás, nincs koholt trend.
- **`public/admin.html` + `public/manager.html`** — `#ordersMetricBand` konténer a cím alatt, a szűrő-sor előtt; a táblázat (`#tblOrders`), oszlop-átméretezés/átrendezés, kijelölés, letöltés-sáv, státusz-dropdownok **érintetlenek**. Cache-bust `?v=20260616band2`.
- **`public/i18n.js`** — 2 új kulcs (`list.kpiWaiting`, `list.kpiClosed`, RO-alap+HU) az inline kétnyelvű feliratok helyett. `node --check` OK, 93 Jest zöld.

## 2026-06-16 — Fázis 2 (2. lépés): KPI mutató-sáv a Statisztikán és a Sofőr-elszámoláson (PR #152)

> A `.tall` (magas) mutató-sáv kiterjesztése a riport-oldalakra — a régi 4-csempés KPI-sorok helyett. Csak megjelenés; az adat, a grafikonok, a táblák és a szűrők változatlanok.

- **`public/stats.js`** — 4 KPI-csempesor cseréje `vsMetricBand([...],{tall:true})`-re: **Áttekintés** (5 alap mutató + feltételesen beszedett/kintlévőség, ill. eredmény — a jogosultság-feltételek megőrizve), **Pénzügy** (5), **Fogyasztás** (4), **Vásárlások** (3). A grafikonok, táblák, szűrő-sáv, CSV-export, BNR/ráta-sor érintetlen. (A Sofőr/Jármű/Ügyfél riport oldalakon nincs KPI-csempesor — ott nem volt mit cserélni.)
- **`public/fleet-extra.js`** — a `decont` (Sofőr-elszámolás) 4 csempéje (Előleg/Készpénz/Egyenleg/Diurna) → `vsMetricBand({tall:true})`; az alsó táblák, ráta-szerkesztő, nyomtatás érintetlen.
- Mindenhol az **eredeti i18n-címkék** (ikon + `t(...)`) és értékek; **nincs koholt trend/sparkline** (a riport-handlerek nem adnak idősort). Backend/SQL/auth/handler **nem változott**. `node --check` OK, **93 Jest zöld**.

## 2026-06-16 — Fázis 2 (1. lépés): interaktív KPI mutató-sáv a Vezérlőpulton (PR #151)

> A megjelenés-csiszolás első éles lépése: a Vezérlőpult 4 különálló KPI-négyzete helyett egy egységes, interaktív **mutató-sáv** (a jóváhagyott „C" minta alapján). Saját, meleg signature-akcent (napnyugta gradiens), a funkció és az adat változatlan.

- **`public/style.css`** — új `vsMetricBand` komponens (`.vsmb*`): 85/15 rács, balra nagy gradiens fő-szám (`--vs-warm-grad` napnyugta narancs→korall), jobbra 3 kis kocka egymás alatt; a kockák bal-csík árnyalata a **fontossági sorrendet** követi (`#ea580c → #f97316 → #fb923c → #fdba74`). Alap: alacsony (`min-height:120px`); `.tall` módban magasabb (Statisztikának). Téma-érzékeny (light/dark), reszponzív (mobilon a fő-szám felül, kockák alatta).
- **`public/console-shared.js`** — `vsMetricBand(metrics,opts)` + `vsBandPick(i)` közös renderelő: **kattintásra a kis kocka a grafikonra ugrik, a mostani fő-szám visszaugrik a helyére** (átúszással). A `t`/`s` (trend/idősor) opcionális → ahol nincs valós adat, elmarad (nincs koholt trend). `loadDashboard` átírva: `dashStats`+`userListAll`+`getFuvarlevelek` egy `Promise.all`-ban → a sávot **valós értékkel** tölti (Összes/Aktív fuvar, Felhasználók, Menetlevél).
- **`public/admin.html` + `public/manager.html`** — a `.dash-stats` 4 csempe helyén `#dashMetricBand` konténer; cache-bust `style.css?v=20260616band`, `console-shared.js?v=20260616band`. 93 Jest zöld.
- **Következő lépések:** a sáv kiterjesztése a többi listaoldalra + egységes oldal-fej/táblázat-csiszolás; a valós trend-grafikonokhoz (sparkline) egy könnyű history-lekérdezés; a meleg paletta fokozatos kiterjesztése. (A 3 javasolt ÚJ modul — Bursă / e-CMR / CO₂ — még csak prototípus, külön döntésre.)

## 2026-06-16 — Landing árazás: a csomag-feature-ek is a kiválasztott nyelven (DB-fix)

> Az előző kör után a landing árazásánál a **csomag-feature listák** még mindig magyarul látszottak (miközben a lap románul) — mert a `package-setup*.sql` migrációk **egynyelvű magyar string** tömbként írták a `subscription_plans.features`-t a kétnyelvű objektumok helyett. A render (`f[lang]`) csak objektumnál nyelv-helyes.

- **`db/zz-plan-features-bilingual-final.sql`** (ÚJ migráció) — a 4 csomag `features`-ét a mérvadó kétnyelvű `{ro,hu}` objektum formátumra állítja. A `zz-` előtag miatt a migráció-futtató ABC-sorrendjében MINDEN korábbi feature-állító (`package-setup*.sql`, `plan-features-*.sql`) UTÁN fut → friss DB-n is ez a végső; a meglévő (éles) DB-n új fájlként egyszer lefut a következő deploykor és felülírja a magyar stringeket. Idempotens.
- A `handlers/billingHandlers.js` `updateSubscriptionPlan` már megőrzi a bilingual objektumokat (nincs regresszió, ha a developer szerkeszti a csomagot).

## 2026-06-16 — Menü-átrendezés 1. fázis: domének szerinti csoportosítás (admin + manager) (PR #149)

> A CargoTMS-mintára áttekinthetőbb menüstruktúra — a saját kinézet (vonalas SVG ikonok, accordion, dizájn-tokenek) és a funkciók teljes megtartásával. CSAK a menüpontok csoportosítása változott domének szerint; a `data-tab` kulcsok, a `pane`-ek és minden logika érintetlen.

- **`public/admin.html` + `public/manager.html`** — a sidebar főmenü-csoportok átrendezve: a külön „Megrendelések" főmenü a **Fuvarok** alá olvasztva (beérkező + ügyfél-kérések); az **Üzemanyagkártya** a **Flotta** csoportba (Adminból); új **„Pénzügy"** csoport (Pénzügy-riport + Sofőr-elszámolás kiemelve a Statisztikából); a **Jogosultságok** (admin) + **Aláírás & bélyegző** az **Adminisztráció** csoportba; a **Statisztika** csoport ezután tisztán riport (a „& Pénzügy" elnevezés megszűnt). Admin és manager egységes vázon.
- **`public/i18n.js`** — 2 új csoport-fejléc kulcs: `nav.financeHead` (Finanțe/Pénzügy), `nav.statsHead` (Statistici/Statisztika), RO-alap + HU. Cache-bust `i18n.js?v=20260616menu`.
- Minden menü-logika `data-tab` / `[id$="ParentTab"]` alapú → a feature-flag rejtés, a single-open accordion és a beérkező-értesítő badge változatlanul működik. Nincs duplikált/elveszett menüpont (32 menüpont, mindnek van pane-je). 93 Jest zöld.
- **Következő (jóváhagyott, még nyitott):** 2. fázis — megjelenés-csiszolás (egységes oldal-fej + űrlap-kártya + táblázat-pillák); a Lejárat/Szerviz felvitele a jármű/sofőr adatlapról is.

## 2026-06-16 — Landing: nincs egymás melletti kétnyelvű felirat (árazás + oldal)

> A landing árazás-szekciója egymás mellett mutatta a két nyelvet (havi/éves váltó, kiegészítők cím). Kérés: SEHOL ne legyen két nyelv egyszerre — a nyelvváltó intézze, RO-alap.

- **`public/landing.js`** — a RO fordítás-objektum kétnyelvű értékei egynyelvűre javítva: `billingMonthly` `'Lunar / Havonta'`→`'Lunar'`, `billingAnnual` `'Anual / Éves'`→`'Anual'`, `billingAnnualBadge` `'−1 lună / −1 hó'`→`'−1 lună'`, `addonTitle` `'Resurse suplimentare / Kiegészítők'`→`'Resurse suplimentare'`. (A HU értékek már egynyelvűek voltak; a renderelés `f[lang]`-gal nyelv-helyes.)
- **`public/index.html`** — a `#pricing` statikus fallback javítva: a havi/éves váltó + kiegészítők-cím beégetett kétnyelvű szövege egynyelvűre; a 4 csomag fallback feature-listája magyarról **románra** (a lap alapnyelve RO; az API-betöltés úgyis felülírja, de a fallback se legyen rossz nyelvű); `loginDispatcher`/`Sub` fallback románra igazítva.
- Cache-bust: `landing.js?v=20260616pw` (eddig nem volt verziózva). 93 Jest zöld.

## 2026-06-16 — Regisztráció: nincs többé egymás melletti kétnyelvű felirat (i18n + RO-alap)

> A regisztrációs oldal ingyenes-trial űrlapja egymás mellett mutatta a két nyelvet (pl. „Cégnév / Numele companiei", „Jelszó / Parolă"). A felhasználó kérése: SEHOL ne legyen egymás mellett két nyelv — ezt a nyelvváltó kapcsoló intézze, alapértelmezett a román.

- **`public/register.html`** — az ingyenes-trial űrlap minden beégetett kétnyelvű/magyar szövege `data-i18n`/`data-i18n-ph`/`data-i18n-html` kulcsra cserélve (cégnév, teljes név, telefon, jelszó, megerősítés, beleegyezés-szövegek, gomb, váltó-linkek, alcím). A meghívókódos űrlap maradék beégetett szövegei is i18n-esítve (beleegyezés, „Nincs meghívókód?"). Az alcímet a `showFreeMode`/`showInviteMode` már `data-i18n` attribútummal állítja, így a váltó újrafordítja.
- **`public/i18n.js`** — 11 új `reg.*` kulcs (RO+HU): `freeSubtitle`, `companyName`, `companyNamePh`, `phoneOpt`, `acceptTermsHtml`, `acceptPrivacyHtml`, `freeSubmit`, `haveInvite`, `loginWithCode`, `noInvite`, `freeRegLink`. (A motor alapértelmezése már RO, és magától beilleszt egy 🇷🇴/🇭🇺 kapcsolót.)
- A jelszó-követelmény hint továbbra is **csak románul** (az előző kör szerint). Cache-bust `i18n.js?v=...pw3`. 93 Jest zöld.

## 2026-06-16 — Jelszó-szabály finomítás: követelmény csak románul + jelszó kétszer (megerősítés)

> A PR #144 utáni két kérés: (1) a jelszó-követelmény szövege CSAK románul jelenjen meg, (2) minden regisztrációnál és jelszó-cserénél kétszer kelljen megadni a jelszót, és csak egyezés esetén érvényes (elgépelés ellen).

- **Csak román követelmény-szöveg** — `lib/passwordPolicy.js` `POLICY_ERR` románra szűkítve (HU rész törölve); a kliens-feliratok és i18n-kulcsok (`rst.pwHint`, `rst.minLen`, `por.pwMin6`, `car.min6`, `cs.pwMin6`, register-hintek, `PW_ERR`) mind románul (a HU érték is a román szövegre állítva, hogy nyelvtől függetlenül románul mutassa).
- **Jelszó-megerősítés (kétszeri bevitel) a regisztrációnál** — `public/register.html`: mindkét reg-mód (nyilvános trial + meghívókódos) új „Jelszó megerősítése / Confirmă parola" mezőt kapott (`freeJelszo2`/`jelszo2`); a két jelszó eltérésekor `Cele două parole nu coincid.` és nem küld. (A reset/portál/alvállalkozó/saját-jelszó-csere már korábban is kétmezős volt.)
- **Admin/Manager user-szerkesztő jelszó-megerősítés** — `public/admin.html`/`manager.html` `uPwd2` mező; `admin.js`/`manager.js` `saveUser` egyezés- + erősség-ellenőrzés; közös `vsPwValid`/`VS_PW_ERR` a `console-shared.js`-ben (EGY forrás).
- **Cache-bust** bump (`...pw2`) az érintett JS-ekre. 93 Jest zöld.

## 2026-06-16 — Kötelező erős jelszó-szabály (min. 8 + kis/nagybetű + szám + szimbólum)

> Egy Google Jelszóvizsgálat-értesítés nyomán: a rendszerben gyenge/újrahasznált teszt-jelszavak voltak. Mostantól MINDEN új jelszó-beállításnál kötelező az erős jelszó. A belépést (`bcrypt.compare`) NEM érinti → a már regisztrált felhasználók (jelenleg a developer) régi jelszava változatlanul működik, nincs kényszerített csere.

- **`lib/passwordPolicy.js`** (ÚJ, közös — EGY forrás) — `validatePassword(pw)` → `{ ok, err }`: min. 8 karakter ÉS legalább 1 kisbetű + 1 nagybetű + 1 számjegy + 1 szimbólum (nem betű/szám, pl. `_`). Kétnyelvű (RO-alap + HU) hibaüzenet.
- **Szerveroldali kikényszerítés mind a 6 jelszó-beállító úton** (a régi `length < 6` csere): `handlers/auth.js` (meghívós regisztráció), `handlers/users.js` (admin által beállított jelszó + saját jelszó-csere), `routes/auth.js` (jelszó-reset), `routes/public-register.js` (nyilvános trial-regisztráció), `routes/portal.js` + `routes/carrier-portal.js` (ügyfél-/alvállalkozói portál belépő-beállítás).
- **Kliens-oldali validáció + feliratok** (azonos szabály, gyors visszajelzés): `public/register.html` (mindkét reg-mód + hint), `public/reset-password.html` (+hint), `public/portal.js`, `public/carrier.js`, `public/console-shared.js` (Beállítások → jelszó-csere); `public/i18n.js` 6 kulcs frissítve + `rst.pwHint` új.
- **Teszt:** `tests/unit/passwordPolicy.test.js` (8 eset); `tests/integration/execute.test.js` fixture-jelszó `titok123` → `Titok123_`. **20 suite / 93 Jest zöld** (6 valódi-DB suite kihagyva DB nélkül).

## 2026-06-16 — Sofőr mini-statisztika: 2×2 rács + világos-téma olvashatóság

- **`public/sofer.js`** — a főoldali motivációs havi mini-statisztika (lezárt fuvar / km / diurna / tankolás) `repeat(4,1fr)` egysoros rács helyett **2×2 rácsban** (2-2), így nem húzza el az oldalt. A csempék a sofőr **világos témájához** igazítva: fehér kártya (`--sof-card`) + sötét/akcentes érték (per-csempe szín: zöld/kék/indigó/borostyán) + muted címke — a korábbi `color:#fff` + áttetsző fehér háttér olvashatatlan volt világos alapon.
- **`public/sofer.html`** — `sofer.js` cache-bust `?v=20260616a`.

## 2026-06-16 — HERE/előfizetési számla a developer SAJÁT számlázójával (nem a célcég kulcsával)

> Biztonsági javítás: eddig a `generateHereInvoice` (developer) **dekódolta és használta a célcég számlázó-kulcsát** a HERE/előfizetési számla kiállításához (a developer hozzáfért a cég kulcsához, és eladó=vevő számla jött létre). **24 suite → 25 suite / 115 Jest teszt zöld.**

- **`handlers/billingHandlers.js`** — `generateHereInvoice`: a számlát mostantól a **VallorSoft (developer) saját** `billing_integrations` rekordja állítja ki (session `company_id`), a célcég kulcsához SOHA nem nyúl; **self-invoice tiltva** (ha `company_id == developer cége` → `Emitentul nu poate fi si client`); ha a developernek nincs számlázója → „Configurati mai intai integrarea de facturare VallorSoft". `buildHereInvoice` többé nem olvassa a célcég `credentials`-ét; `previewHereInvoice` a kiállító (VallorSoft) providerét mutatja.
- **`public/i18n.js`** — `dev.billingOwnDesc` pontosítva: a developer saját számlázója a szolgáltatási (előfizetés + HERE) számlákhoz, a cégek kulcsához nem nyúl. *(A developer billing-kártya UI — `developer.html` `devBillingCardBox` + BillingCard — már korábban létezett.)*
- **`tests/integration/here-invoice.test.js`** (új) — regressziós őr: csak developer hívhatja; self-invoice tilos (DB-t sem hív); hiányzó company_id.

## 2026-06-16 — Teljeskörű átvilágítás: biztonsági javítások + hiányosság-rendrakás

> Teljes audit (4 párhuzamos agent + valódi-DB tesztek). **24 suite / 112 Jest teszt zöld** élő Postgres ellen; require-sweep 91 modul 0 hiba; szerver-boot smoke OK.

**Biztonság (multi-tenant / szerepkör):**
- **`services/push.js` + `routes/push.js` + `handlers/handover.js`** — `sendPushToEmail` `company_id`-szűrést kapott: a `/api/chat-notify` `toEmails` listája eddig cégek között is kézbesített push-t (cross-tenant injekció) → a hívók átadják a session cég-azonosítóját, a lekérdezés `AND company_id=$` szerint szűr.
- **`handlers/users.js` `userUpdate`** — a Manager eddig egy Sofőrt Admin/Manager szerepre emelhetett (jogosultság-emelés) → a Manager már csak `Sofer` pozíciót állíthat (összhangban `invCreate`/`userDelete`).
- **`routes/soferApi.js`** — `doc-download`/`pdf-download`: a sofőr eddig a cégen belül más sofőr dokumentumát/menetlevelét is letölthette (`:id` léptetés) → Sofer szerepnél `email_sofer = saját email` kikötés; Admin/Manager (diszpécser) változatlanul mindent lát.
- **`lib/trialToken.js` (új) + `routes/trial-select.js` + `services/scheduler.js`** — a trial-link HMAC token két helyen duplikálódott (csonkolt 16 hex / 64 bit) → közös helper, teljes HMAC-SHA256 digest; a generálás és az ellenőrzés többé nem csúszhat szét.
- **`server.js`** — production fail-fast: `SESSION_SECRET` nélkül a szerver nem indul el éles módban.

**Hiányosság / „semmibe vezető" funkciók rendrakása:**
- **`handlers/orders.js` `comDelete` → soft-delete**: a fuvar fizikai törlése helyett `Anulat` státuszra állítás (látható marad, de nem szerkeszthető); `comUpdate`/`plannerAssign`/`routes/ordersRest.js` quick-status zárolja az Anulált fuvart; `public/console-shared.js` 🗑 Anulare-gomb + Anulat sorok letiltott vezérlőkkel.
- **Duplikáció megszüntetve** — a redundáns legacy `public/invoicing-card.js` (FGO-only, félrevezető „hamarosan" opciókkal) törölve; marad az univerzális `BillingCard` (mind az 5 provider). `admin.html`/`admin.js` takarítva.
- **ANAF strukturált cím** — `routes/clients.js`/`services/clients.js`/`public/clients-page.js`: a VIES endpoint törölve (csak ANAF marad); a cég-adatlekérés külön mezőket tölt (Stradă/Nr./Localitate/Județ/Cod poștal) egy sor helyett. Migráció: `db/clients-address-fields.sql`.
- **Halott kód törölve** — `handlers/developer.js` `devGetLandingTexts`, `handlers/mapsProvider.js` `mapsGetProvider/Save/Test`, `public/feature-catalog.js` `VS_HERE_FEATURES`, `public/landing.js` halott `#registerForm`/`#contactForm` listenerek; `landing.js` regisztráció-fetch `/api/register` → `/api/public-register`.

## 2026-06-15 — Admin Előfizetések almenü + developer fizetés-aktiválás (PR #138)

- **`public/admin.html`** — Beállítások sidebar: leaf tab → nav-head csoport két almenüvel (👤 Fiók / 💳 Előfizetés); régi subscriptionCard eltávolítva; új `data-pane="elofizetesek"` pane hozzáadva (státusz, csomag-választó, referencia-kártya, fizetési előzmények)
- **`handlers/billingHandlers.js`** — `requestSubscriptionExtension`: payment_request létrehozás, admin fizetési email (banki adatokkal, összeg EUR+RON+TVA), developer értesítő email (DEV_NOTIFY_EMAIL / vallorsoft@gmail.com); `getMyPaymentRequests`: admin látja a saját cégének kérelmeit
- **`handlers/developer.js`** — `devActivatePayment`: pending kérelmet paid-re állít, company paid_until + subscription_status frissítés (éves +12 hó, havi +1 hó, meglévő jövőbeli lejárattól számítva)
- **`public/developer.html`** — Fizetési kérelmek tábla: 9. Művelet oszlop, ✅ Aktiválás gomb pending sorokon
- **`public/console-shared.js`** — `loadElofizetesek`, `elofSetBilling`, `elofRenderPlans`, `elofLoadHistory`, `elofRequestPlan`; `loadSubscriptionCard` eltávolítva `loadSettingsPane`-ből
- **`public/admin.js`** — `loadTab` bővítve `elofizetesek` esettel

---

## 2026-06-15 — Emailek csak románul (PR #136)

- **`routes/trial-select.js`** — fizetési email + köszönő oldal: tábla-feliratok, szekció-fejlécek, instrukciók, CTA gomb, tárgy — mind csak román (HU szövegek eltávolítva)
- **`services/scheduler.js`** — havi riport email: tábla-feliratok, tárgy, footer-megjegyzés — csak román
- **`services/email.js`** — `buildInviteHtml` mindig `L='ro'`; `sendResetEmail` tárgy mindig román; DB sablon `body_ro` elsőbbséggel
- **`tests/unit/invite-email.test.js`** — elvárások frissítve román szövegekre (111 teszt zöld)

---

## 2026-06-15 — Add-on árak — landing chips + developer szerkesztő (PR #133)

- **`handlers/developer.js`** — `devGetAddonPrices` / `devSaveAddonPrices`: add-on árak `developer_settings` `addon_prices` JSONB kulcsban (alapértelmezett: jármű=3€, munkatárs=2€, sofőr=1€/hó)
- **`public/developer.html`** — 🏦 Banki adatok pane alján „Add-on árak" form; `loadBankDetails()` egyszerre tölti banki + addon adatot; `saveAddonPrices()` mentés
- **`public/index.html`** — `.lp-addon-section` chip-sor a #pricing szekció aljára (alapból rejtett, JS tölti fel)
- **`public/landing.css`** — `.lp-addon-section` / `.lp-addon-grid` / `.lp-addon-chip` stílusok
- **`public/landing.js`** — `_cachedAddonPrices` + `fetchAddons()` IIFE + `renderAddonPrices()` (kétnyelvű /lună|/hó); `applyLanguage()` re-rendereli; `addonTitle` i18n kulcs (RO+HU)

---

## 2026-06-15 — Kétnyelvű csomag feature-lista a landing árazási kártyákon (PR #129)

- **`db/plan-features-bilingual.sql`** — `subscription_plans.features` JSONB frissítve `[{"ro":"...","hu":"..."}]` formátumra mind a 4 csomagnál (28 bullet-pont RO+HU)
- **`public/landing.js`** — `renderPricingGrid`: objektum-elem esetén `f[lang]||f.ro` a megfelelő nyelv; visszafelé kompatibilis string fallback; nyelvváltáskor automatikusan újrarenderel
- **`public/subscription.html`** — `buildFeaturesList`: ugyanaz a logika `document.lang` alapján

---

## 2026-06-15 — Rendszer-emailek linkje kattinthatatlan volt — javítva (PR #128)

- **`db/fix-reset-email-template.sql`** — törli az összes hibás `email_sys_*` DB-sablont (reset/invite/welcome/trial_expiry); a beégetett, helyes HTML e-mailek lépnek életbe szerver-restart után
- **`services/email.js`** — `applyTemplateVars(text, vars, rawVars)`: a `rawVars`-ban lévő változók HTML-escape nélkül kerülnek be; `sendInviteEmail` + `sendResetEmail` átad `{{invite_url_btn}}`, `{{reset_url_btn}}`, `{{invite_url_link}}`, `{{reset_url_link}}` HTML-változókat jövőbeli sablonokhoz

---

## 2026-06-15 — Landing #pricing: 4 csomagos rács, per-csomag színek, kétnyelvű, ÁFA-megjegyzés (PR #126)

- **`public/landing.css`** — `--lp-green` token; `.lp-plan-green/.blue/.indigo/.dark` szín-módosítók `--plan-accent` CSS-változóval; 4 oszlopos rács (1024px → 2×2, 640px → 1 col); `.lp-plan-audience` célközönség-sor; `.lp-pricing-vat` ÁFA-megjegyzés
- **`public/landing.js`** — `_cachedPlans` + `renderPricingGrid` újraírás: `p.features` JSONB → bullet-lista; per-csomag szín/badge/CTA; `applyLanguage`-ban re-render; 8 új i18n kulcs (RO+HU): `planAlapAudience/Standard/Pro/Business`, `planStartBtn/ContactBtn/Popular`, `pricingVatNote`
- **`public/index.html`** — statikus fallback: 4 valós csomag (Alap/Standard/Pro/Business) helyes tartalommal, CSS osztályokkal és `#lpPricingVat` elemmel

---

## 2026-06-15 — Csomag finomítás: sofőr limitek + chat Standard-ra (PR #125)

- **`db/package-setup-v2.sql`** — delta migráció: meglévő szerveren is lefut
- `max_sofors` reálisabb arányra növelve: Alap=4 / Standard=10 / Pro=40 / Business=100
- `chat` kivéve az Alap csomagból → Standard-tól BE (kis cégnél nincs valódi igény)
- Marketing bullet-pontok frissítve (Alap: chat ki, Standard: chat be)

---

## 2026-06-15 — 4 csomag automatikus beállítása induláskor (PR #124)

- **`db/package-setup.sql`** — induláskor automatikusan beállítja a 4 csomagot
- Alap / Standard / Pro / Business: limitek, marketing bullet-pontok, plan_features
- Alap: 29 feature KI · Standard: 13 KI · Pro: 7 KI · Business: mind BE
- 2-menetes migráció-rendszerbe illeszkedik (függőségek pass 2-ben oldódnak)

---

## 2026-06-15 — 6 prémium feature gate + megosztott featureEnabled helper (PR #123)

- **`lib/featureEnabled.js`** — új megosztott helper: `company_features` (cég-override) > `plan_features` (csomag) > `true` hierarchia; cég-szintű egyedi beállítás felülírja a csomag-alapértéket
- **`public/feature-catalog.js`** — 6 új feature key: `visszfuvar-radar`, `toll-becsles`, `ai-kiolvasas`, `gps-integracio`, `szamlazas-integracio`, `konyvelo-szerepkor`
- **Szerver-oldali gate-ek bekötve:**
  - `handlers/orders.js` `getPlannerMatches` → `visszfuvar-radar` (üres matches, nem hiba)
  - `handlers/toll.js` `estimateToll` → `toll-becsles`
  - `routes/inbound-orders.js` `/reparse` → `ai-kiolvasas` (403 Gemini-hívás előtt)
  - `lib/vehiclePositions.js` `getPositions` → `gps-integracio` (üres pozíciók, nem hiba)
  - `handlers/billingHandlers.js` `saveBillingIntegration` + `testBillingIntegration` → `szamlazas-integracio`
  - `handlers/invites.js` `invCreate` (Konyvelo) + `routes/pages.js` `/konyvelo` → `konyvelo-szerepkor`
- **Developer (`is_dev`) mindig átmegy** minden gate-en
- `routes/pages.js`: helyi `featureEnabled` duplikáció eltávolítva → shared lib

---

## 2026-06-15 — Landing nav cleanup + vissza gomb szín javítás (PR #122)

- **`public/login.html` / `portal.html` / `carrier.html`** — vissza gomb stílus javítva: a világos háttéren (`#f7f9fc`) láthatatlan fehér/átlátszó stílus (`rgba(255,255,255,0.08)`) helyett sötét szöveg (`#475569`) és szürke keret (`#cbd5e1`) — jól olvasható kontraszttal
- **`public/index.html`** — „Ügyfél-portál" és „Alvállalkozói portál" linkek eltávolítva az asztali navigációból (megmaradnak a mobilos hamburger menüben `lp-mobile-only` osztállyal)
- **`public/landing.js` / `i18n.js`** — login dropdown Diszpécser/Admin alcíme frissítve: Admin · Manager · Könyvelő · Sofőr (HU) / Admin · Manager · Contabil · Șofer (RO)
- **`public/landing.css`** — `.lp-mobile-only` CSS: asztali nézeten rejtett, mobil ≤860px-en látható

---

## 2026-06-15 — Carrier járművek megjelenítése a planificatorban (PR #114)

- **`handlers/orders.js`** — `getPlannerData`: `carrier_vehicles JOIN carriers` lekérés (`company_id`-szűrt), `carrierVehicles` tömbként visszaadva
- **`public/planner.js`** — `_carrierVeh` állapot-változó; Gantt-nézetben elválasztó-fejléccel vizuálisan megkülönböztetett sorok (indigó szín, 🚚 ikon, `carrier_nev` felirat, fuvar-sávok drag&drop-pal); mobil napi nézetben szintén megjelenik a carrier-lista
- **`routes/carrier-portal.js`** — ellenőrizve: GET/POST/DELETE `/api/carrier/vehicles` mindhárom végpont `company_id AND carrier_id` szűrést tartalmaz (javítás nem volt szükséges)

---

## 2026-06-15 — Menetlevél form: indulás/érkezés + határátlépések + diurna (PR #113)

- **`db/fuvarlevel-trip-times.sql`** — új migráció: `fuvarlevelek.indulas_dt TIMESTAMPTZ`, `erkezes_dt TIMESTAMPTZ`, `hataratok JSONB DEFAULT '[]'` oszlopok
- **`lib/diurna.js`** — `calculateDiurna(departureDt, arrivalDt, crossings)`: menetlevél-alapú diurna számítás (12:00 szabály, Europe/Bucharest DST-biztos, nap EXTERN ha a sofőr 12:00-kor Románián kívül volt); visszafelé kompatibilis: ha az első arg tömb → régi `border_crossings` alapú legacy ág
- **`routes/soferApi.js`** — ha `indulasDt`+`erkezesDt` megvan → új form-alapú diurna; ha hiányzik → `border_crossings` GPS fallback; INSERT +3 paraméter (`$29`–`$31`)
- **`public/sofer.html`** — az auto-diurna üzenet helyett `🕐 Út időpontjai` (2 datetime-local mező) + `🛂 Határátlépések` dinamikus sor-szekció + `diurnaPreview` előnézet
- **`public/sofer.js`** — `addHatarRow()`, `collectHataratok()`, `updateDiurnaPreview()`; payload + reset kibővítve; DOMContentLoaded hallgatók
- **`public/i18n.js`** — 11 új i18n kulcs RO+HU párokkal (tripTimes, departureTime, arrivalTime, borderCrossings, addCrossing, crossingDate, crossingDir, crossOut, crossIn, days, crossingCount)

## 2026-06-15 — Vizuális landing szerkesztő + blog cikkek (PR #111)

- **🌐 `public/landing-editor.html`** — teljes képernyős vizuális szerkesztő: bal sidebar (szekciólista ▲▼ sorrendmozgatás + 👁 láthatóság-toggle, blog cikk szerkesztők), jobb oldal iframe az élő landing page-gel. Iframe-betöltés után injektált overlay: minden `[data-i18n]` elem duplaklikkel szerkeszthető (lebegő input/textarea → `editorTextChange(key, value)` a parent ablakba). RO/HU nyelv-toggle reloadolja az iframe-t a `vs-lang` localStorage kulccsal. Mentés: `devSaveLandingTexts` + `devSaveSectionOrder` egyszerre.
- **📰 Blog cikk részletes oldal** — `public/blog-post.html` (publikus, landing.css), `/blog/1|2|3` route (`routes/pages.js`); cikk tartalom (`GET /api/blog/:id`, `routes/blog.js`) a `developer_settings`-ből töltődik; RO+HU cím + HTML tartalom; landing blog kártyák „Citeste mai mult →" / „Tovább olvasom →" linkeket kaptak (`data-i18n="blogReadMore"`).
- **⚙️ Backend** — `GET /api/landing-texts` kibővítve: visszaadja a `sectionOrder` + `sectionVisibility` mezőket is; `handlers/developer.js`: `devSaveSectionOrder`, `devGetBlogPost`, `devSaveBlogPost`; új `routes/blog.js`; `/developer/landing-editor` + `/blog/:id` page route-ok.
- **🗂️ `public/index.html`** — minden fő szekció `data-vs-section` attribútumot kapott (hero/strip/how/features/stats/testimonials/pricing/blog/contact/cta).
- **🔄 `public/landing.js`** — `applySectionOrder()` + `applySectionVisibility()` funkciók; `blogReadMore` i18n kulcs (RO+HU).
- **🧹 `public/developer.html`** — régi `🌐 Landing szövegek` fül + pane + ~305 sor JS (`LANDING_KEY_HELP`, `LANDING_DEFAULTS`, `LANDING_SECTIONS` stb.) eltávolítva; helyette `🌐 Landing szerkesztő ↗` gomb (új ablakban nyit).
- 108 teszt zöld.

## 2026-06-15 — Developer szerkeszthető tartalmak: landing + email + csomag + push (PR #103)

- **🌐 Landing szövegek** (`routes/landing-texts.js`, `handlers/developer.js` `devGetLandingContent`/`devSaveLandingContent`) — a landing page marketing szövegei (hero H1/alcím/badge, 3 bullet, heroNote, USP cím/leírás) DB-ből töltődnek (`developer_settings` `landing_content` kulcs); `GET /api/landing-texts` publikus; developer szerkesztheti és mentheti.
- **✉️ Rendszer-email sablonok** (`services/email.js`, `handlers/developer.js` `devGetSystemEmailTemplate`/`devSaveSystemEmailTemplate`) — 4 email-típus szerkeszthető: meghívó, jelszó-reset, üdvözlő (trial cég-regisztráció), trial lejárat; tárgy + RO/HU törzs; `{{változó}}` lista; hardcoded fallback ha nincs sablon mentve.
- **📦 Csomag marketing bullet pontok** (`db/plan-features-bullets.sql`, `handlers/billingHandlers.js`, `public/subscription.html`) — `subscription_plans.features JSONB` tömb: developer a csomag-szerkesztőben szöveges bullet pontokat adhat meg; az előfizetés-oldalon ✓ jelölt listában jelenik meg.
- **🔔 Push értesítés sablonok** (`lib/pushTemplates.js`, `handlers/developer.js` `devGetPushTemplates`/`devSavePushTemplates`) — 5 push-típus title/body szerkeszthető RO+HU párban; in-memory cache `invalidateCache()`-szel; bekötve: portál beérkező kérés, áru-leadás (request/confirm/reject), fuvar sofőr-státusz; hardcoded DEFAULTS fallback.

## 2026-06-15 — Developer 📋 Jogi oldalak szerkesztő + kötelező visszaigazolás (PR #102)

- **`legal_consents` tábla** (`db/legal-consents.sql`) — visszaigazolás-napló: `user_type` (user/client_user/carrier_user), `user_id`, `page_key`, `version` (timestamp), `acknowledged_at`, `ip`.
- **`routes/legal.js`** — dinamikus `/terms`, `/privacy`, `/cookies`, `/dpa`, `/security` (DB tartalomból, fallback: statikus fájl) + `GET /api/legal/pending-ack` + `POST /api/legal/ack` (minden session-típusra: bejelentkezett user, ügyfél-portál, alvállalkozói portál).
- **`devGetLegalPage` + `devSaveLegalPage`** (`handlers/developer.js`) — Quill HTML → `developer_settings` DB; auto-frissíti az „Ultima actualizare" sort; bekezdés-szintű diff (zöld/piros); `notify_version` beállítása = kötelező visszaigazolás.
- **`public/legal-ack.js`** — fullscreen modal (nem bezárható, csak „Am luat la cunoștință" gombbal); diff megjelenítés (hozzáadott/törölt bekezdések); link az oldalhoz; több módosítás esetén egymás után; audit-naplózva.
- **Developer `📋 Jogi oldalak` fül** (`developer.html`) — Quill.js WYSIWYG szerkesztő (cdnjs); 5 oldal-fül; mentés + „Kötelező visszaigazolás küldése minden felhasználónak" checkbox.
- **`legal-ack.js` bekötve** 6 oldalba: `admin.html`, `manager.html`, `sofer.html`, `portal.html`, `carrier.html`, `konyvelo.html`.

## 2026-06-15 — Developer 📥 Regisztrációk fül — cég-lista + email sablon küldő (PR #101)

- **`developer_settings` tábla** (`db/developer-email-templates.sql`) — kulcs-érték JSONB tárolás; email sablon (`email_template` kulcs) itt él; auto-migráció induláskor.
- **`devGetTrialCompanies`** (`handlers/developer.js`) — az összes regisztrált céget listázza: cégnév, admin e-mail, csomag neve, előfizetési státusz, trial lejárat.
- **`devGetEmailTemplate` / `devSaveEmailTemplate`** — sablon olvasás / UPSERT (`developer_settings`); tárgy + HTML törzs.
- **`devSendCompanyEmail`** — sablon változóit behelyettesíti (`{{ceg_nev}}`, `{{email}}`, `{{paid_until}}`, `{{nap_maradt}}`, `{{subscription_url}}`), majd `sendDeveloperEmail`-en át Brevo-n küldi.
- **`sendDeveloperEmail`** (`services/email.js`) — VallorSoft branded (sötét, indigó #6366f1) Brevo e-mail; `escHtml` XSS-védelem; exportálva.
- **Developer UI** (`public/developer.html`) — `📥 Regisztrációk` tab a sidebarban; pane: email sablon szerkesztő (tárgy + HTML törzs + változó-lista) + regisztrált cégek táblázat per-cég `📧 Email` gombbal.

## 2026-06-15 — Landing page i18n hiányzó kulcsok + mobil optimalizálás (PR #100)

- **~58 hiányzó i18n kulcs pótolva** (`public/landing.js`) — RO módban is HU szöveg látszott a feature stripben, moduloknál, statisztikánál, testimonialsoknál, CTA szekciónál, footer fejléceknél, árazás fallbacknél.
- **Mobil navbar**: 860px-en `.lp-btn-ghost` (login szöveglink) elrejt — csak lang toggle + register gomb marad; 480px-en a register is elrejt, csak lang toggle látszik.
- **Hero mobile**: sofőr-hét timeline 640px alatt `display:none` helyett `order:-1` — megjelenik a szöveg felett (single-column); `lp-sofer-week { max-width: 100% }`.
- **Hamburger menü** (`index.html`): login link hozzáadva a mobilos nav listájához.

## 2026-06-14 — Developer csomag-limitek + plan_features funkció-kapcsolók (PR #99)

- **`plan_features` tábla** (`db/plan-features.sql`) — csomag-szintű funkció-kapcsolók: `plan_id + feature_key + enabled`; auto-migráció induláskor. `subscription_plans.max_sofors` új limit-oszlop.
- **Hierarchia**: `company_features` (cég-szintű dev override) > `plan_features` (csomag default) > `true` (alapból minden engedélyezett). `getMyFeatures` (dashboard.js) és `featureEnabled` (pages.js) egységesen.
- **Limit mezők a plan editorban** (`developer.html`) — `max_users`, `max_vehicles`, `max_orders_per_month`, `max_sofors`, `stripe_price_id`; 0=tiltott, üres=korlátlan (`planLimits.checkLimit` logika).
- **⚙️ Funkció-kapcsolók per csomag** — VS_FEATURES katalógus csoportosítva, három állapot (BE / KI / Alapértelmezett=BE); `getPlanFeatures` + `setPlanFeature` developer RPC-ek (`handlers/billingHandlers.js`).
- **`planLimits.js`** — `sofors` kind hozzáadva (`MAX(Sofer poziciójú userek)`).

## 2026-06-14 — Önkiszolgáló SaaS regisztráció + trial előfizetés-kezelés (PR #98)

- **Nyilvános cég-regisztráció** (`routes/public-register.js`, `POST /api/public-register`) — bárki létrehozhat céget meghívókód nélkül; 14 napos trial (`subscription_status='trial'`, `paid_until=NOW+14`), Admin user automatikus létrehozás, üdvözlő e-mail (RO/HU), IP-alapú rate-limit (3/óra).
- **`register.html` dual-mode** — URL paraméter alapján automatikusan vált: nincs `?kod=` → ingyenes cég-regisztráció (Cégnév + adatok + T&C + „14 napos ingyenes próba indítása" gomb); `?kod=VS-XXXX` → meglévő meghívókódos flow (változatlan). Toggle-link a két mód között.
- **Trial lejárat ütemező** (`startTrialExpiryScheduler`, `services/scheduler.js`) — naponta (60s késleltetés majd 24h ciklus) ellenőrzi az aznap lejáró trial-okat (`paid_until=CURRENT_DATE`), RO/HU e-mailt küld `/subscription` linkkel; `companies.trial_email_sent` flag megakadályozza a dupla küldést.
- **`/subscription` oldal** (`public/subscription.html`) — standalone, landing-skin oldalon 4 csomag a DB-ből (`GET /api/public-plans`), Stripe Checkout ha konfigurálva (`gas('createSubscriptionCheckout')`), fallback e-mail/banki kapcsolat ha nem; bejelentkezett Adminnak trial státusz banner.
- **`getMySubscription` RPC** (`handlers/billingHandlers.js`) — Admin saját előfizetési státusz: státusz, hátralévő napok, csomagnév, Stripe konfigurált-e.
- **Admin Beállítások → 💳 Előfizetés kártya** (`admin.html`, `console-shared.js` `loadSubscriptionCard`) — státusz + hátralévő napok megjelenítés, „Csomag választása" gomb trial/inaktív esetén.
- **Landing árazás** (`index.html`, `landing.js`) — `#lpPricingGrid` JS tölti be `/api/public-plans`-ból (4 csomag DB-ből, 2. kiemelt); statikus fallback megmarad hiba esetén.
- **Migráció** (`db/saas-trial.sql`) — `companies.trial_email_sent BOOLEAN DEFAULT false`.

## 2026-06-14 — Landing: sofőr-hét timeline + hero USP + „Hogyan működik" + brand-indigo (PR #97)

- **Brand szín frissítés** (`style.css`, `CLAUDE.md`) — a „Soft" logo betűje pirosról (`--brand-red #e10b1a`) indigóra (`--brand-indigo #6366f1`) váltott; `.vs-logo .soft` és `.chat-side .av` gradiens frissítve. `landing.css`-ben már helyes volt (`--lp-indigo`).
- **Hero jobb oldal: GPS monitor ki, sofőr-hét timeline be** (`index.html`, `landing.css`, `landing.js`) — animált glassmorphism kártya, 7 nap: fuvar rögzítés (dátum → diurna auto) · határátlépés → `🤖 +1 nap auto` · tankolás 📷 · vásárlás · visszalépés → `🤖 4 nap lezárva` · pótkocsi csere/raktározás push → diszpécser · menetlevél ① fuvar kijelölés → ② küldés → `MT-2026-0042 · Nyomtatható ✓`. JS-renderelt, RO+HU i18n.
- **Hero bal oldal: sofőr-centrikus USP szöveg** — badge/H1/alcím + 3 ✕ bullet (papíros menetlevél / napidíj / bizonylat) + heroNote CTA; RO+HU.
- **Showcase monitor ki → „Hogyan működik" szekció** — dashboard mockup törölve, helyette 3 lépéses `#how` szekció (meglévő i18n kulcsok: howTitle/step1-3). Navbar 3. link: `#about` → `#how`.
- **CSS nettó: −187 sor** (hero monitor + showcase + lp-dash-* CSS törölve; timeline + how + hero bullets hozzáadva).

---

## 2026-06-14 — Landing showcase finomítás: 1 monitor + valósághű Vezérlőpult + arányosabb hero/sáv

- **Showcase egyetlen monitorra egyszerűsítve** (`index.html`/`landing.css`) — a korábbi 3 monitor + 2 telefon zsúfolt összkép helyett **egy kiemelt monitor**, rajta **valósághű Vezérlőpult-mockup**: sötét sidebar (menü-csíkok + aktív kiemelés) · 4 KPI-kártya (27/5/4/7, kék/zöld/indigó/borostyán) · „Curse recente" fuvar-tábla státusz-pillákkal · **világos OSM-szerű térkép** élő piros pulse-marker-rel · jármű-státusz sor. Világos „képernyő" a sötét szekció-háttéren → screenshot-hatás. A holt mockup/telefon CSS (`.lp-shot-row*`, `.lp-phone*`, `.lp-mock-*`, `.lp-monitor-sm`) törölve. `<img onerror>` továbbra is a `/img/sc-dashboard.png`-re (friss képpel auto-csere).
- **Arányosabb felső blokk** — a **feature-strip** (felső világos sáv) megnagyobbítva (padding 40→76px, ikon 1.6→2.4rem, nagyobb cím/leírás), és **arányosan visszavéve a hero-ból** (`min-height` 100→80vh, kisebb padding) → kiegyensúlyozottabb oldal-összkép.
- CSS kiegyensúlyozott, `landing.js` érvényes, **108 teszt zöld**.

---

## 2026-06-14 — Landing: showcase szekció + integráció-felirat a footerbe

- **Új „A platform működés közben" showcase szekció** (`index.html`, `landing.css`) a hero után: **3 monitor + 2 telefon** eszköz-mockup, a `landing.js`-ben **már létező, de sosem beépített** i18n-kulcsokra (`showcaseTitle`/`showcaseSubtitle`, `mon1-3Label`, `phone1-2Label`). Tartalom: márka-konzisztens **CSS/SVG mockup** (Vezérlőpult-kártyák, fuvar-tábla státusz-pillákkal, statisztika-oszlopdiagram, sofőr-app trip-kártya, GPS mini-térkép animált pulse-szal) a hero-monitor stílusában, **sötét háttéren** (fehér→sötét→világos ritmus, hero-glow rímmel). Minden eszköz `<img onerror>`-ral a `/img/sc-*.png` útra mutat → **friss, aktuális képpel automatikusan lecserélődik** (a régi `monitor1.png`-t NEM használjuk, az elavult). Reszponzív (1024/640px), `.reveal` animáció, JS-módosítás nélkül.
- **Integrációs logó-szekció kivéve, egysoros felirattá alakítva** — a logós `#integrations` blokk (FGO/SmartBill/Oblio/iFactura/Facturis/ANAF/CargoTrack/Fomco/Stripe/Brevo) eltávolítva a nav- és footer-linkjeivel + a most árván maradt `.lp-int-*` CSS-sel együtt; helyette a **footer alsó sorában** (a nyelvváltó mellett) egy szépen megfogalmazott, **kétnyelvű (RO/HU)** felirat a GPS- és számlázó-integrációkról (`footerIntegrations` i18n-kulcs).
- CSS kiegyensúlyozott, `landing.js` érvényes, **108 teszt zöld**.

---

## 2026-06-14 — Single-open accordion menü + fix sidebar/fejléc (app-shell)

- **Accordion (single-open)** (`console-shared.js`): a `toggleGroup` mostantól bezárja a többi nyitott főmenüt, mielőtt a kattintottat nyitja — egyszerre csak egy főmenü van nyitva, és ha másik főmenüre kattintasz, az előző becsukódik (ugyanarra a fejlécre 2. kattintás becsuk). Az `activateTab` is bezárja a többi csoportot a navigált elem szülő-csoportjának nyitása előtt (globális keresőből/visszaállításból is konzisztens).
- **Fix sidebar + fix fejléc** (`style.css`, `@media min-width:769px` — app-shell): a bal panel (főmenük) ÉS a felső sáv (fejléc + kereső) **fixen marad görgetéskor**, csak a tartalom görgödik. `app-layout` height:100vh+overflow:hidden, `sidebar` height:100vh+overflow-y:auto (hosszú menü a sidebaron belül görgödik), `main-content` height:100vh (a `vs-topbar` sticky a tetején). A mobil (≤768px) drawer-elrendezés érintetlen + explicit `height:auto;overflow:visible` védelem. node --check zöld, CSS zárójel-egyensúly OK.

---

## 2026-06-14 — FGO-menü kattintás-regresszió javítva (admin + manager)

- **Hiba:** a sidebar kattintás-kötése (`admin.js`/`manager.js`) felülírta az új `.nav-head` fejlécek inline `toggleGroup`-ját, és csak a RÉGI parent-id-ket (orders/stats/userParentTab) kezelte → az új FGO-fejlécek (Megrendelések/Dokumentumok/Flotta) `data-tab` nélkül `activateTab(undefined)`-ot hívtak: **nem nyíltak le az almenük, és a tartalom kiürült**.
- **Javítás:** a kötés generikus lett — bármely `.nav-head` → `toggleGroup` (lenyit), levél (`data-tab`) → `activateTab` (pane nyit); a mobil-sidebar-záró kötés is a `.nav-head`-et zárja ki. Determinisztikus szimulációval verifikálva mind a 4 eset (fejléc/levél/almenü/link); a többi oldal nem érintett (nincs `.nav-head`). node --check zöld, cache-bust bump.

---

## 2026-06-14 — Manager FGO-menü + globális kereső bővítés

- **Manager konzol FGO-elrendezés** (`manager.html`) — az admin mintájára: ikonos (monokróm vonalas SVG) 10-főmenüs sidebar a manager TÉNYLEGES menüpontjaival (Integrációk + Jogosultságok kihagyva — nincs pane-jük; a manager-specifikus „📥 E-mail feldolgozás" megtartva), **fix felső sáv** (breadcrumb + `Ctrl+K` kereső + nyelv/téma a dash-topbarból áthelyezve), `global-search.js` bekötve. 30 `data-tab` ↔ 30 pane 1:1. Csak megjelenés, funkció változatlan.
- **Globális kereső bővítés** (`handlers/globalSearch.js`) — 3 új kategória a meglévő 5 mellé: **Megrendelések** (`inbound_orders`, portál→`client-requests`/e-mail→`inbound` tab), **Menetlevelek** (`fuvarlevelek`, tenant-szűrés a sofőr-e-mailen át a `users.company_id`-vel), **Számlák** (`invoices`, →`orders-list`). Paraméteres SQL, `company_id`-szűrt, role-gated (Admin/Manager), kategóriánként LIMIT 6. Élesben verifikálva: manager belépés → /manager 200; `globalSearch('MARFA')` mindhárom új kategóriát visszaadja; idegen tenant menetlevele kiszűrve; 108 teszt zöld. **Hátralévő:** landing page (következő fókusz); developer/könyvelő külön nézet.

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
