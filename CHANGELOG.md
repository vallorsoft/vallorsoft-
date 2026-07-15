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

## 2026-07-15 — Sofőr: kattintható fuvar-kártya + kinyíló fel-/lerakási részletek (másolható)

- **Sofőr főoldal, kiosztott fuvarok:** a fuvar-kártya **fejléce mostantól
  kattintható** → kinyílik egy részlet-panel:
  - 🏢 **Ügyfél** (a fuvar `client` mezője),
  - ⬆️ **Felrakás**: helyszín + időpont (dátum),
  - ⬇️ **Lerakás**: helyszín + időpont (dátum),
  - 📝 **Megjegyzés** (a fuvar `ref`/referencia mezője), ha van.
- **Vágólapra másolás:** a felrakó helyszín, a lerakó helyszín és a megjegyzés
  mellett **📋 gomb** — gombnyomásra a szöveg a vágólapra kerül (Clipboard API,
  `execCommand('copy')` tartalékkal), visszajelző toasttal. A másolandó szöveg
  biztonságos JS-map-ből jön (nincs felhasználói adat onclick-attribútumban).
- **Szerver (`handlers/orders.js`):** a `getMySoferOrders` mostantól a
  `data_incarcare`/`data_descarcare` dátumot is visszaadja (a `client`/`ref` már
  eddig is). Nincs séma-változás.
- **Kliens:** `public/sofer.js` (`renderFuvarCard` + `toggleFuvarDetails`/`soferCopy`/
  `fmtFuvarDay`), `public/sofer.css` (részlet-panel + 📋 gomb + kattintható fejléc),
  `public/i18n.js` (10 új `sof.det.*` kulcs, RO-alap+HU), cache-bust `?v=20260715fdet`.
  Az akciógombok (UIT / Elfogadom / Elvégeztem / Áru leadása) érintetlenek. DOM-shim
  harnesszel verifikálva; **596 Jest zöld**.

## 2026-07-15 — Fix: fuvar-kiírás cím-autocomplete — Nominatim tartalék a Photon mellé

- **Gyökérok:** a fuvar-kiírás felrakó/lerakó cím-mezőjének autocomplete-je
  KIZÁRÓLAG a publikus `photon.komoot.io`-ra támaszkodott, és a `jsonGet` a
  nem-OK választ (429 rate-limit / 5xx / blokk / nem-JSON) **csendben `{}`-ra
  nyelte** → a felület üres találati listát kapott („nem ad találatokat").
- **Javítás (`lib/mapsProvider.js`):**
  1. `jsonGet` mostantól **dob** nem-OK HTTP-státusznál (nem nyeli el csendben),
     így a hívó a tartalékra eshet.
  2. `_acFree` = **Photon → Nominatim fallback**: ha a Photon hibázik VAGY nem ad
     találatot, a hívás a **Nominatim** (OSM hivatalos geocoder, RO/HU/MD/BG/RS
     bias) tartalékra esik; a címkék tiszták (nincs utcanév-duplikáció), lat/lng-t
     is ad. `_geoFree` (km-becslés geokódolás) ugyanígy Photon→Nominatim.
  3. A kulcsos HERE/Google út érintetlen (továbbra is elsőbbség, majd ingyenes fallback).
- Tisztán szerver-oldali, nincs séma-/UI-változás. Mock-fetch harnesszel
  verifikálva (Photon-leállás → Nominatim találat; Photon-jó út); **596 Jest zöld**.

## 2026-07-14 — Sofőr mód: ~15%-kal kisebb megjelenítés + letisztult fejléc

- **~15%-kal kisebb** az egész sofőr-mód (a korábbi „nagy" méretek finomítva):
  űrlapmezők/gombok **56px→48px**, betűméret 17→15px, címkék 15.5→13.5px, alap
  tartalom-betű 15.5→14px, szakasz-cím 23→20px, checkbox/rádió 22→19px; a
  hamburger-menü menüpontjai is kisebbek (19→16.5px főmenü, 64→56px sorok), de
  továbbra is nagyok/egykezesek.
- **Letisztult fejléc:** a felső sávban az oldalnév (breadcrumb) **nem vágódik le**
  többé („k" helyett a teljes név, hosszúnál „…" ellipszissel) — a `vs-tb-left`
  `flex:1`+`min-width:0`, a név `text-overflow:ellipsis`; kompaktabb hamburger +
  téma/mód gombok (56→48px), kisebb HU/RO nyelvváltó, alacsonyabb sáv (76→64px).
- **A fejléc sem lóg ki:** a felső sáv **negatív oldal-margóit nulláztuk** (a `-16px`
  full-bleed margó a 12px-es padding mellett ~4px-et túlnyúlt a képernyőn kétoldalt → ez
  volt a fejléc-túllógás egyik oka), a vezérlők kompaktabbak (téma/mód gomb 44px, harang
  40px, kisebb HU/RO, kisebb térköz), a breadcrumb rugalmasan zsugorodik (ellipszis) →
  a jobb szélső gomb (☀️) sem lóg ki. NINCS `overflow:hidden` a sávon (különben a
  harang-értesítő legördülője levágódna).
- Csak megjelenés, `body.vs-dm` + `@media (max-width:1024px)`, a fájl végén (felülírja
  a korábbi méreteket). Cache-bust `style.css?v=20260714hdrfit`. Headless Chromiummal
  verifikálva: nincs oldalgörgetés (pageOver=0), a ☀️ befér, a hosszú oldalnév „…"-tal
  csonkol. 596 Jest zöld; a teljes/normál nézet érintetlen.

## 2026-07-14 — Sofőr mód: teljes szélességű tartalom + vastag fejléc + nagy hamburger-menü

- **Nincs üres oldalsáv:** a korábbi 600px-es középre-zárt oszlop **eltávolítva** → a
  tartalom (űrlap, kártyák) és a felső sáv a **képernyő teljes szélességét** használja
  (a „2 szél" eltűnt), a fejléc és a tartalom **egy vonalban** van.
- **Vastagabb fejléc, nagyobb gombok:** a felső sáv `min-height:76px`, nagyobb padding;
  a hamburger + téma/mód gombok **56px**, a nyelvváltó (HU/RO) nagyobb, az oldalnév 19px.
- **Nagy, egykezes hamburger-menü:** a drawer **90vw** (max 400px, közel teljes képernyős),
  nagy menüpontok (**19px** főmenü / 18px almenü, 64/60px magas sorok, 26px ikon) → nagy
  betűkkel, hüvelykujjal kényelmesen.
- **Szél-levágás MINDEN oldalon:** `body.vs-dm` + `.main-content` `overflow-x:hidden` +
  `max-width:100vw` minden panelra → a lap sehol nem húzogatható oldalra (a széles
  táblák a saját dobozukban görgetnek).
- Csak megjelenés, `body.vs-dm` + `@media (max-width:1024px)`. Cache-bust
  `style.css?v=20260714fullwidth`. Headless Chromiummal (900px + 393px) verifikálva:
  full-width tartalom (input a teljes szélességben), 0px oldalgörgetés, nagy drawer-menü.
  596 Jest zöld; a teljes/normál nézet érintetlen.

## 2026-07-14 — Sofőr mód: nagyobb ujjbarát méretek ≤1024px-en + tiszta fejléc

- **Gyökérok:** a telefon gyakran **769–1024px logikai szélességen** renderel („asztali
  nézet" / nagy DPR), ezért a korábbi nagy/érintő-barát méretek (amik `@media
  max-width:768px`-re szóltak) **nem érvényesültek** a telefonon → minden „kicsinek"
  tűnt (a kisebb asztali-mód méretek látszottak).
- **Javítás (`public/style.css`, csak `body.vs-dm` + `@media max-width:1024px`):**
  - **Nagyobb, ujjbarát űrlapmezők:** input/select/textarea **56px** magas, **17px**
    betű, nagyobb padding + rádió/checkbox 22px; nagyobb címkék (15.5px, félkövér) és
    mező-térköz (20px); a gombok **56px**; szakasz-cím 23px. → Kényelmesen kitölthető.
  - **Tisztább fejléc:** a felső sávban a 🏠 + „›" elrejtve, csak az **aktuális oldalnév**
    marad (félkövér, nagyobb); a hamburger + téma/mód gombok **50px** (nagy tap-target);
    a nyelvváltó (HU/RO) nagyobb.
- **FIX szélességű, középre zárt tartalom-oszlop:** a tartalom-panelek (űrlap, kártyák)
  max. **600px** széles, középre zárt oszlopba kerülnek → a beviteli mező **nem lesz túl
  széles** asztali-nézetű telefonon (900px-en 600px, nem 840px), a lap **soha nem lóg ki
  oldalra**, és minden befér. A felső sáv teljes szélességű marad.
- Cache-bust `style.css?v=20260714fixwidth`. Headless Chromiummal **393px + 900px**-en
  verifikálva: nincs oldalgörgetés egyik szélességen sem (mért 0px túllógás), az input
  393px-en teljes szélességű, 900px-en 600px-re zárt. 596 Jest zöld. A teljes nézet érintetlen.

## 2026-07-14 — Sofőr mód: teljes mobil-barát pass — nincs oldalirányú húzogatás + nagyobb

- **A LAP soha nem lóg ki oldalra** sofőr-módban telefonon (≤1024px): `body.vs-dm` +
  `.main-content` `overflow-x:hidden` + `max-width:100vw` → **nincs bal-jobb húzogatás**
  egyetlen oldalon sem.
- **A széles táblázatok** (Fuvarlevelek, Belső sofőrök stb. — a már kártyás Fuvar-kezelés
  kivételével) a **saját dobozukon belül** görgethetők vízszintesen (`display:block;
  overflow-x:auto`) → a lap maga fix marad, és **semmilyen adat nem tűnik el** (nem vágjuk
  le az oszlopokat). Az oszlop-igazítás megmarad.
- **Nagyobb / barátibb:** nagyobb alap-betűméret a tartalomban (15.5px), nagyobb
  szakasz-címek (21px) és űrlap-címkék (14px); a Méretek (Hossz/Szél./Mag.) és hasonló
  flexes input-sorok szükség esetén új sorba törnek (nem lógnak ki).
- **Csak megjelenés (kliens-oldal):** `public/style.css` additív, `body.vs-dm` +
  `@media (max-width:1024px)`-re szűkítve — a teljes/normál nézet és a Tervezőtábla
  (saját `.p2-*` scroll) érintetlen. Cache-bust `style.css?v=20260714mobilefit`.
- **Verifikáció:** headless Chromiummal (390px) — 9-oszlopos széles tábla: a **lap nem
  lóg ki** (over=0px), a tábla a saját dobozában görgethető, az oszlopok igazítva; a
  fuvar-kiírás egy oszlop + a kezelés-kártya 2 oszlop változatlanul jó. 596 Jest zöld.

## 2026-07-14 — PWA-telepítő gomb a jobb alsó sarokban (sofőr + sofőr-mód admin/manager)

- **Új kis „⬇️ telepítés" FAB** a jobb alsó sarokban, ami a böngésző natív PWA-telepítő
  ablakát nyitja meg (`beforeinstallprompt`) → a felhasználó a **kezdőképernyőre teheti**
  az appot. A **sofőr felületen mindig** látszik, az **admin/manager felületen CSAK
  sofőr-módban** (a téma-gomb melletti 🚚 kapcsoló bekapcsolt állapotában).
- **Okos megjelenés:** a gomb csak akkor jelenik meg, ha a böngésző valóban
  telepíthetőnek jelzi az appot (Chrome/Edge/Android) ÉS még nincs telepítve
  (standalone módban / telepítés után elrejtőzik). A bug-jelentő FAB fölé van igazítva
  (nincs átfedés).
- **Hogyan (kliens-oldal, nincs szerver-/DB-változás):** `public/pwa-install.js` (ÚJ,
  közös) — `beforeinstallprompt` elkapása + FAB + `window.VS_PWA_INSTALL.setEnabled(bool)`;
  `public/sofer.html` betölti (alapból engedélyezve); `public/admin.html`/`manager.html`
  betölti (`window.__pwaInstallDefault=false`), és a `console-shared.js` `vsSyncDriverModeUI`
  kapcsolja a sofőr-móddal együtt. Cache-bust `pwa-install.js?v=20260714pwa`,
  `console-shared.js?v=20260714drvmode5`.
- **Verifikáció:** a valódi FAB-logika DOM-shim harnessen: install-prompt→megjelenik,
  setEnabled(false/true)→rejt/mutat, kattintás→`prompt()`, telepítés után→elrejtőzik.
  596 Jest zöld.

## 2026-07-14 — Sofőr mód telefon-finomítás: kiírás egy oszlopban, kezelés-kártya 2 oszlopban

- **Fuvar-KIÍRÁS űrlap telefonon egy oszlopban:** sofőr-módban (≤1024px) minden beviteli
  mező **egymás alá** kerül (a `.grid-2`/`.grid-3`/`.grid-4` → 1 oszlop, a `grid-column:span`
  resetelve) → a korábban jobb oldalon **kilógó/levágott** mezők (Referencia, Ár, Súly,
  Méretek, Felrakás/Lerakás ideje, Pótkocsi) most teljes szélességben látszanak.
- **Fuvar-KEZELÉS kártya 2 oszlopban:** a mobil-kártya mostantól **2 mező soronként**
  (ID | Ügyfél · KM | Ár · Vontató | Státusz), a hosszú/rich cellák (Útvonal, Sofőr,
  Műveletek) teljes szélességben → rövidebb, áttekinthetőbb kártya, ami kitölti a telefon
  képernyőjét (a korábbi 1-mező-soronkénti, túl hosszú nézet helyett).
- **Csak megjelenés (kliens-oldal):** `public/style.css` additív, `body.vs-dm`-re +
  `@media (max-width:1024px)`-re szűkítve — a teljes/normál nézet érintetlen. Cache-bust
  `style.css?v=20260714drvmode4`. Headless Chromiummal (390px) verifikálva.

## 2026-07-14 — Sofőr menetlevél: offline mentés a telefonra (PWA), internet csak a beküldéshez

- **Új „💾 Mentés a telefonra" gomb** a sofőr menetlevél-kitöltő oldalán: indulás
  előtt a sofőr beír pár adatot, gombnyomásra **a telefonjára menti** (localStorage),
  és az **offline is látható** a PWA-ban, offline szerkeszthető. Internet **csak a
  beküldéshez** kell.
- **„📥 Mentett menetlevelek (telefonon)" lista** a menetlevél 1. lépésén: a mentett
  piszkozatok címkével + időbélyeggel, „Megnyitás" (betöltés a szerkesztőbe) és „🗑"
  (törlés) gombbal. Offline is megjelenik.
- **Offline-biztos beküldés:** ha a beküldéskor nincs internet, az adat NEM vész el —
  automatikusan helyi piszkozatként a telefonra mentődik, és a sofőr jelzést kap
  („Nincs internet — mentve a telefonra. Küldd el később."). Sikeres beküldés után a
  hozzá tartozó helyi piszkozat automatikusan törlődik.
- **PWA offline betöltés (Fly.io):** a service worker (`sw.js`) most **network-first +
  futásidejű cache** — a sikeres azonos-eredetű oldal/JS/CSS válaszokat elmenti, így a
  sofőr-oldal a helyi piszkozatokkal **offline is betöltődik**. A SW azonos-eredetű
  (`self.location.origin`), tehát automatikusan a kiszolgáló hostot (fly.io) követi.
  CACHE `v5`→`v6` (frissülés kikényszerítése).
- **Hogyan (kliens-oldal, nincs szerver-/DB-változás):** `public/sofer.js` — perzisztens
  local-draft réteg (`soferCollectFull`/`soferApplyFull`/`saveLocalDraft`/`loadLocalDraft`/
  `deleteLocalDraft`/`renderLocalDrafts`) a meglévő (sessionStorage-os) auto-draft mellé;
  `public/sofer.html` — gomb + lista + offline-tipp; `public/i18n.js` — 10 új `sof.*` kulcs
  (RO-alap+HU); `public/sw.js` — offline cache. Cache-bust `sofer.js/i18n.js/sofer.css?v=20260714offline`.
- **Verifikáció:** a valódi local-draft kód node-harnessen: üres→„nincs mentett", mentés→1
  elem (fişă/határátlépés is elmentve), újramentés→marad 1 (nem duplikál), lista renderel,
  törlés→0. **596 Jest zöld.**

## 2026-07-14 — Sofőr mód: hamburger menü + mobil-kártyás fuvar-táblázat

- **Hamburger menü a sofőr-módban:** új ☰ gomb a felső sávban (`vs-dm-burger`).
  A 769–1024px sávban (telefon „asztali nézetben" / kis tablet) sofőr-módban a
  sidebar **off-canvas drawerré** válik, a hamburger nyitja/zárja, a tartalom
  teljes szélességű lesz. ≤768px-en a meglévő mobil felső sáv hamburgere marad.
- **A KIÍRT FUVAROK táblázata mobilon kártyás nézet (≤1024px, sofőr-módban):** a
  fejléc elrejtve, minden fuvar egy **kártya**, a cellák a `data-label` alapján
  címkézve (Ügyfél / Útvonal / KM / Ár / Sofőr / Vontató / Státusz), a fuvar-szám
  kiemelten a kártya tetején, a művelet-gombok nagyok/tapinthatók, a checkbox-oszlop
  (tömeges kijelölés — asztali funkció) rejtve. A `.table { min-width:560px }` mobil-
  szabály felülírva → nincs vízszintes túlfolyás.
- **Hogyan (kliens-oldal, nincs szerver-/DB-változás):** `public/console-shared.js`
  `renderFilteredOrders` — `data-label` a cellákon (a teljes nézetet nem érinti);
  `toggleDriverMode` a drawer-állapotot visszaállítja (`closeSidebar`).
  `public/admin.html`/`manager.html` — ☰ gomb a `vs-topbar`-ban. `public/style.css`
  additív, **kizárólag `body.vs-dm`-re szűkített** blokk. Cache-bust `?v=20260714drvmode3`.
- **Verifikáció:** headless Chromiummal (a valódi `style.css`-re) 390px és 900px szélességen
  renderelve — a kártyás nézet és a 900px-es hamburger+drawer helyesen jelenik meg. 596 Jest zöld.

## 2026-07-14 — CI: automatikus Fly.io deploy (az éles oldal Fly-on fut, nem Renderen)

- **Tünet:** a mainre mergelt változások (pl. a 🚚 Sofőr mód, a cancel-fix) **nem
  jelentek meg az éles oldalon** (`vallorsoft.fly.dev`).
- **Gyökérok:** az éles környezet átköltözött **Render → Fly.io**-ra (lásd
  `FLY-DEPLOY.md`), de a CI (`.github/workflows/ci.yml`) `deploy` jobja **csak a Render
  deploy-hookot** hívta (`RENDER_DEPLOY_HOOK_URL`). Így a main-merge egy elavult Render
  környezetet frissített, az éles Fly.io alkalmazást **soha** — az csak kézi
  `fly deploy`-jal frissült.
- **Javítás (`.github/workflows/ci.yml`):** új **`deploy-fly`** job — sikeres tesztek
  után, main-push-ra `flyctl deploy --remote-only` (`superfly/flyctl-actions`). **Egyszeri
  teendő:** a `FLY_API_TOKEN` GitHub secret beállítása (Repo → Settings → Secrets →
  Actions; token: `fly tokens create deploy`). Ha a secret hiányzik, a lépés **kecsesen
  kihagyódik** (a CI nem lesz piros). A meglévő Render job megmarad (szintén secret-guard
  mögött), így semmi nem törik el.

## 2026-07-14 — Fix: lemondott (cancelled) cég reaktiválása nem maradt meg („aktiválom, de visszavált")

- **Tünet:** egy `cancelled` státuszú, regisztrált cég a developer felületről (vagy
  akár közvetlenül Neonban) **nem volt véglegesen aktiválható** — státusza visszaállt
  `cancelled`-re / „nem íródott át".
- **Gyökérok:** a developer **szerkesztő modálja** (`saveCeg`) MINDIG küld `paid_until`-t
  (üres mezőnél explicit `null`-t). A régi reaktiválás-blokk csak akkor futott, ha
  `paid_until === undefined` (a „🔓 Activare" gomb útja), így a modál-úton **a
  `subscription_cancel_at` lemondás-jelző bent maradt**, a `paid_until` pedig NULL/múlt
  lett. A napi **cancel-scheduler** (`services/scheduler.js`) ezután a lejárt
  `paid_until` + beállított `subscription_cancel_at` miatt visszaállította a státuszt
  `cancelled`-re. Ugyanez történt kézi Neon-szerkesztésnél is.
- **Javítás (`handlers/developer.js`):** a reaktiválás mostantól **IDEMPOTENS és minden
  úton egységes**. `devCompanyUpdate` — ha a cél státusz `active`, **MINDIG** törli a
  `subscription_cancel_at` + `cancel_lastday_notified` jelzőt, és a `paid_until`-t
  érvényes (jövőbeli) értékre hozza: explicit jövőbeli dátumot tisztel, NULL/múlt/nincs
  esetén `NOW()+30 nap`, egy már meglévő jövőbeli dátumot viszont nem rövidít.
  `devActivatePayment` (fizetés-aktiválás) is törli a lemondás-jelzőt. Így „minden
  felhasználással" (gomb, modál, fizetés-aktiválás) a cég valóban használható marad.
- **Teszt (`tests/integration/dev-company-reactivate.test.js`):** +2 eset (modál-út
  explicit `null` és múlt `paid_until`), a NULL-esetes assert frissítve (cancel-jelző
  MINDIG törlődik); **596 Jest zöld**.

## 2026-07-14 — Sofőr mód: mobil-optimalizált, nagyobb & áttekinthetőbb kezelőfelület

- A „Sofőr mód" (🚚) mostantól **érintő-barát, egyszerű kezelést** is ad, nem csak
  menü-szűrést: bekapcsolva a `body` megkapja a `vs-dm` osztályt, és a felület
  nagyobb, letisztultabb lesz.
- **Mit ad (csak sofőr-módban, csak `body.vs-dm`-re szűrve — a teljes nézet változatlan):**
  - **Nagyobb menüpontok** (54–60px magas sorok, nagyobb betű + ikon) → könnyebb koppintás.
  - **Nagyobb, jól látható gombok** (min. 46px, mobilon 52px) és **nagyobb űrlapmezők**
    (min. 46–50px) → egyszerűbb kitöltés.
  - **Egyszerűbb felső sáv:** a globális kereső (`Ctrl+K`) elrejtve, a téma/mód gombok
    nagyobbak; mobilon nagyobb hamburger + szélesebb menü-drawer + nagyobb logó.
- **Hogyan (kliens-oldal, nincs szerver-/DB-változás):** `public/console-shared.js`
  `vsSyncDriverModeUI()` a `body.vs-dm` osztályt kapcsolja; `public/style.css`
  additív, **kizárólag `body.vs-dm`-re szűkített** blokk a fájl végén (desktop + mobil
  ≤768px media query). Cache-bust `style.css?v=20260714drvmode2` +
  `console-shared.js?v=20260714drvmode2`.
- **Verifikáció:** a valódi `vsSyncDriverModeUI` a `body.vs-dm` osztályt mindkét irányban
  helyesen kapcsolja (be/ki), CSS zárójel-egyensúly OK; **594 Jest zöld**.

## 2026-07-14 — ÚJ: „Sofőr mód" — egygombos egyszerűsített diszpécser nézet (admin + manager)

- **Miért:** az admin/manager gyakran csak a **sofőrrel való kapcsolattartáshoz** használja
  a konzolt (fuvarokat ír ki, kezeli a menetleveleket) — a teljes menü ilyenkor zavaró.
- **Mit:** a felső sávban új **🚚 gomb** (`driverModeToggle`, a téma-kapcsoló mellett) —
  gombnyomásra a sidebar leegyszerűsödik, és CSAK a sofőr-releváns menüpontok látszanak:
  **Vezérlőpult · Fuvar kiírás · Fuvar kezelés · Tervezőtábla · Fuvarlevelek ·
  Feltöltött iratok & CMR-ek · Belső sofőrök · Belső chat · Beállítások**. Bekapcsolva a
  fuvar-kezelésre ugrik; a gomb meleg akcenttel jelzi az aktív állapotot. A választás
  `localStorage`-ban őrződik (`vs-driver-mode`), belépéskor visszaáll.
- **Hogyan (nincs szerver-/DB-változás):** `public/console-shared.js` (KÖZÖS szekció) —
  új `VS_DRIVER_MODE_TABS` fehérlista + `vsRecomputeSidebar()` (a **csomag-kapcsoló +
  sofőr-mód szűrő EGY közös számításból**, így a két szűrő nem üti egymást),
  `toggleDriverMode()`/`vsSyncDriverModeUI()`. Az `applyFeatureFlags` erre a közös
  számításra épül át (funkció-lekérés hibája esetén is lefut). `admin.html`/`manager.html`
  topbar-gomb, `style.css` `.dm-toggle.active`, `i18n.js` `dm.enter`/`dm.exit` (RO-alap+HU).
  Cache-bust `?v=20260714drvmode`.
- **Verifikáció:** a valódi kód (`vsRecomputeSidebar`) DOM-modell elleni ellenőrzése:
  OFF=mind az 51 menüpont, ON=pontosan a 9-elemű fehérlista (üres szülő-csoportok
  becsukva), OFF-ra visszaállva teljes restore, és a csomag-kapcsoló sofőr-módban is
  felülír. **594 Jest zöld** (37 suite; DB-s suite-ok DATABASE_URL nélkül kihagyva).

## 2026-07-09 — Fix: developer reaktiválás — a `paid_until` is auto-hosszabbodik trial-lejárat után (PR #233)

- **Bug:** a developer cégkártya **„🔓 Activare"** gombja (`unblockCeg` → `devCompanyUpdate`)
  csak a `subscription_status`-t állította `'active'`-ra, a `paid_until` a múltban maradt
  (trial regisztrációnál `NOW()+14 nap`, utána lejárt). Így a felhasználó **mégsem tudott
  belépni**: a login-kapu (`routes/auth.js:136`, `paid_until < NOW()`) tovább elutasította
  „Abonamentul firmei a expirat (dátum)" üzenettel. Emellett a napi `startCancelReminderScheduler`
  másnap újra `'cancelled'`-re állította volna a státuszt, ha volt `subscription_cancel_at`.
- **Javítás** (`handlers/developer.js` `devCompanyUpdate`): ha reaktiválás (`status='active'`)
  és nincs explicit `paid_until` a hívásban, és a jelenlegi `paid_until` NULL vagy múlt →
  auto-hosszabbítás **`NOW() + 30 nap`**, `trial_email_sent=false` reset, és (ha be van
  állítva) `subscription_cancel_at=NULL` + `cancel_lastday_notified=false` törlés.
- **Nem érinti:** explicit `paid_until` a szerkesztő modálból (`saveCeg`) — tiszteletben tartva;
  jövőbeli `paid_until` — nem íródik felül; blokkolás (`status='inactive'`) — `paid_until`
  érintetlen; `devActivatePayment` (payment_request út) — már helyes volt.
- **Teszt:** `tests/integration/dev-company-reactivate.test.js` — 6 új eset (nem-dev
  interzis, múlt paid_until + cancel_at, NULL paid_until, jövőbeli megtartás, explicit
  paid_until, inactive-set). **246 Jest zöld** (240 → 246).

---

## 2026-06-29 — Kézi menetlevél-készítés (Admin/Manager) + össz-bevétel mező

- **Új „➕ Új menetlevél" gomb a FUVARLEVELEK oldalon** (admin + manager): az Admin/Manager
  pont úgy hozhat létre menetlevelet, mint ahogy egy beküldöttet szerkeszt — a meglévő
  szerkesztő-modált használja újra (üres mezőkkel). A **sofőr kiválasztható a cég belső
  sofőrjei közül** (legördülő, `getInternalDrivers`) **vagy szabadon beírható egy név**.
  A sor **ugyanúgy beleszámít a statisztikába** (tenant-kötés az `email_sofer` → `users.company_id`
  joinon át): kiválasztott sofőrnél az ő e-mailje, kézi névnél a létrehozó (Admin/Manager)
  e-mailje a tenant-horgony.
- **Új össz-bevétel mező** (`fuvarlevelek.total_pret`, nettó EUR) — mivel a kézi menetlevél
  nem egy kiírt fuvarból születik, egy önálló mezőbe írható az adott időszak teljes nettó
  keresete; a Statisztika **Áttekintés** fülén a fuvar-bevételhez adódik (KPI + havi idősor).
- **`db/fuvarlevel-price.sql`** (ÚJ, idempotens) — `total_pret NUMERIC(12,2) DEFAULT 0`.
  **`handlers/documents.js`** új `fuvarlevelCreate` (Admin/Manager, `genDocId('FUV')`,
  cégenkénti MT-YYYY-XXXX sorszám, szerveroldali derivált km/üzemanyag/diurna), `fuvarlevelUpdate`
  +`total_pret` (COALESCE — sofőr-beküldést nem nulláz), `getFuvarlevelek` admin-lista a cég
  ÖSSZES felhasználójára (a kézi menetlevél is megjelenik). **`handlers/statisticsHandlers.js`**
  `getStatsOverview` bevétel = kiírt fuvar (Finalizat) + kézi menetlevél `total_pret`.
- **UI:** a `#fuvEditModal` kétmódú (edit/create); sofőr-választó + 💶 össz-bevétel mező;
  `public/console-shared.js` `openFuvCreate`/`feDriverPicked`/mód-váltó + `saveFuvEdit` elágazás.
  i18n `fed.addNew`/`fed.createTitle`/`fed.pickDriver`/`fed.totalPret`… (RO-alap+HU), cache-bust
  `?v=20260629fuvcreate`. Valós DB nélkül 240 Jest zöld (+ require-sweep).

## 2026-06-28 — Fuvarlap nyomtatás CSAK románul + kezdő/végző dátum óra nélkül (PR #227)

- **Nyomtatott fuvarlap (PDF) — minden magyar felirat eltávolítva**, csak román:
  `routes/soferApi.js` `/api/pdf-download/:id` — a szekciócímek magyar glosszái
  törölve (`Puncte de traseu (Útvonal pontok)` → `Puncte de traseu`, ugyanígy
  Alimentări/Achiziții/Alte mențiuni); `Fuvar ID-k` → `ID-uri cursă`; `... nap` →
  `... zile`; `Data / ora plecare/sosire` (időponttal) → `Data plecare`/`Data sosire`
  **dátum óra nélkül** (új `fmtDateRo`, UTC-formázás a nap-stabilitásért).
- **Kezdő + végző dátum szerkeszthető óra nélkül (Admin/Manager):** `admin.html`/
  `manager.html` két új `type="date"` mező (`feIndulasDate`/`feErkezesDate` →
  `indulas_dt`/`erkezes_dt`); `console-shared.js` `openFuvEdit` feltölt
  (`feToDateInput`, UTC dátum-rész) + `saveFuvEdit` beolvas; `handlers/documents.js`
  `fuvarlevelUpdate` perzisztál (`::timestamptz`, UTC-éjfél, hiányzó→`COALESCE`).
- i18n `fed.startDate`/`fed.endDate`; cache-bust `?v=20260628fed2`.
- Teszt: `fuvarlevelek-db.test.js` +2 eset (PDF csak-román őr + kezdő/végző dátum);
  valós DB-vel **281 teszt zöld**.

---

## 2026-06-28 — Menetlevél: a dátum és a fuvar ID-k is szerkeszthetők (Admin/Manager) (PR #226)

- A menetlevél-szerkesztő modálban (Admin/Manager) most a **Dátum** (`data_completare`,
  `datetime-local`) és a **Fuvar ID-k** (`order_ids`, vesszővel elválasztva) is
  szerkeszthető — eddig csak megjelentek, de nem lehetett őket módosítani.
- **`public/admin.html` + `public/manager.html`** — két új mező a modal rácsában
  (`feDataCompletare`, `feOrderIds`); `data-i18n` (RO-alap + HU).
- **`public/console-shared.js`** — `openFuvEdit` feltölti a két mezőt (`feToLocalDtInput`
  helyi datetime-local konverzió; order_ids → vesszős lista); `saveFuvEdit` beolvassa
  (trim + üres kiszűrése).
- **`handlers/documents.js` `fuvarlevelUpdate`** — perzisztálja a `data_completare`-t
  (`::timestamp`) és az `order_ids`-t (`::jsonb`); hiányzó/üres érték → a meglévő marad
  (`COALESCE`), érvénytelen dátum → szintén marad.
- `i18n.js` `fed.dataCompletare`/`fed.orderIds`; cache-bust `?v=20260628fed`.
- Teszt: `tests/integration/fuvarlevelek-db.test.js` +2 eset (szerkesztés + COALESCE-megtartás);
  valós DB-vel **279 teszt zöld**.

---

## 2026-06-28 — Belső tesztek bővítése: require-sweep + web-smoke + menetlevél valós-DB (PR #225)

- **`tests/unit/require-sweep.test.js`** (ÚJ) — automatizált require-sweep: MINDEN
  modul a `handlers/`/`routes/`/`services/`/`lib/`/`middleware/` alól betöltődik-e
  hiba nélkül (a `../db` mockolva, nincs valódi kapcsolat). Syntax-/export-hibát
  azonnal elkap (a CLAUDE.md-ben eddig kézi „require-sweep" volt).
- **`tests/integration/web-smoke.test.js`** (ÚJ) — a teljes web-réteg (a server.js
  route-listája) felmountolódik-e; publikus oldalak 200; védett oldalak login
  nélkül → `/login`; szerep-eltérés → saját oldalra; `/healthz` 200. DB mockolva.
- **`tests/integration/fuvarlevelek-db.test.js`** (ÚJ, valós DB) — menetlevél teljes
  út: `POST /api/fuvarlevel-save` (indulas/erkezes/hataratok oszlopokkal),
  **`GET /api/pdf-download/:id` regresszió-őr** (a `companies.nev` join — a korábbi
  `c.denumire` bug ezt 500-ra vitte), `getFuvarlevelek`/`getFuvarlevelDetail`/
  `fuvarlevelUpdate`, és a `getFuvarlevelFieldSuggestions` (distinct + szerep-védelem
  + cross-tenant izoláció).
- Eredmény: **valós DB-vel 277 teszt zöld** (31 suite); DB nélkül 240 zöld + 37 skip
  (a valós-DB suite-ok). A CI Postgres 16 service-szel a teljes készlet fut.

---

## 2026-06-28 — Menetlevél-szerkesztő: mező-autocomplete a korábbi értékekből (PR #224)

- Admin/Manager menetlevél-szerkesztésekor minden szöveges mező gépelés közben
  felkínálja a cég eddigi menetleveleibe UGYANABBA a mezőbe már beírt, egyedi
  értékeket (autocomplete).
- **`handlers/documents.js`** — ÚJ `getFuvarlevelFieldSuggestions` (Admin/Manager,
  `company_id`-szűrt, csak olvasás): top-szintű mezők (nume_sofer, numar_camion,
  numar_remorca, alte_mentiuni) + a JSONB tömbök kulcsai (puncte tip/loc,
  alimentari loc/tip/plata, achizitii loc/produs/plata); egyedi, nem üres, max 300/mező.
- **`public/console-shared.js`** — könnyű, a szerkesztő-modálra delegált
  autocomplete-motor (megosztott, body-hoz fűzött fixed legördülő, téma-érzékeny);
  statikus mezők + dinamikusan hozzáadott sorok `data-sg`-n át; textarea is.
- Numerikus mezők (km/cantitate/litri/sumă/preț) szándékosan kimaradnak.
- Cache-bust `console-shared.js?v=20260628sg`. Valós Postgres 16-on verifikálva
  (Admin javaslatok, Sofer tiltva, nincs cross-tenant szivárgás); 130 Jest zöld.

---

## 2026-06-28 — Fix: menetlevél PDF letöltés „Eroare de server" (PR #223)

- **Gyökérok:** a `routes/soferApi.js` `/api/pdf-download/:id` útvonala a `companies`
  táblát `c.denumire`-ként kérdezte le, de a `companies` névoszlopa `nev` (a `denumire`
  a `clients` tábláé) → `column c.denumire does not exist` → a route `500 Eroare de
  server`-rel válaszolt, és a menetlevél PDF semmilyen adatot nem mutatott.
- **Javítás:** `c.denumire` → `c.nev` (alias `company_denumire` változatlan).
- Teljes kódbázis-átvizsgálás `denumire`-re: ez volt az EGYETLEN hely, ahol a `companies`
  táblát tévesen `denumire`-ként hivatkozták (máshol a `c.denumire` a `clients` tábláé,
  a cégnév `co.nev`). Valós Postgres 16-on reprodukálva + verifikálva; 130 Jest zöld.

---

## 2026-06-21 — Kedvenc helyszínek: autocomplete + koordináta-kezelés (PR #221)

- `lib/mapsProvider.js` — `_acFree` (Photon) és `_acHere` mostantól `lat`/`lng`-t is visszaad
- `public/console-shared.js` `vsAttachAutocomplete` — kézi gépeléskor koordináta törlése;
  autocomplete-választáskor `input._vsLat`/`_vsLng` beállítása; `onPick(lat, lng)` (visszafelé kompatibilis)
- `public/console-shared.js` `_rmBuildWps` — ismert koordináta átadása a waypoint-ba
  → geokódolás kihagyható, gyorsabb és pontosabb km-becslés
- `public/fav-locations.js` — cím-mező Photon autocomplete-tel; mentéskor lat/lng tárolás;
  📍 badge a táblában és a picker menüben; fuvar-kiírásból választáskor koordináta beállítva

---

## 2026-06-21 — Photon autocomplete javítás: Romania bias + POI cég-találatok

- `lib/mapsProvider.js` — Romania területi bias (`lat=45.9&lon=24.9&location_bias_scale=0.5`),
  limit 6→8, POI-típus felismerés (amenity/shop/office/craft/...) → utca+házszám a
  label-ben, duplikáció-szűrés. A cím-autocomplete mostantól az OSM-ben szereplő
  romániai cégeket/üzleteket is jobban megtalálja.

---

## 2026-06-21 — Blog rendszer: EasyMDE szerkesztő + slug-alapú URL-ek + sitemap.xml

- **`db/blog-posts.sql`** (ÚJ, idempotens) — `blog_posts` tábla: SERIAL id, egyedi slug,
  kétnyelvű mezők (title/content/excerpt/meta_desc RO+HU), cover_image_url, is_published,
  published_at. A meglévő 3 blog cikk (`developer_settings` `blog_post_1/2/3`) automatikusan
  átmigrál predefinált slug-okkal.
- **`routes/blog.js`** (FELÜLÍRVA) — `GET /api/blog/list` (közzétett cikkek listája),
  `GET /api/blog/:slug` (visszafelé kompatibilis: slug ÉS numerikus id is elfogadott),
  `GET /sitemap.xml` (dinamikus XML-sitemap: statikus oldalak + közzétett blog cikkek).
- **`handlers/developer.js`** (bővítve) — `devListBlogPosts`, `devGetBlogPost`,
  `devSaveBlogPost` (slug validáció, unique constraint kezelés), `devCreateBlogPost`,
  `devPublishBlogPost`, `devDeleteBlogPost` — mind is_dev gated + audit.
- **`public/blog-editor.html`** (ÚJ) — developer blog kezelő (`/developer/blog`): kétpaneles
  elrendezés (lista + szerkesztő), EasyMDE 2.18.0 Markdown szerkesztő RO+HU nyelven,
  slug auto-generálás ékezetleítéssel, SEO meta leírás karakterszámlálóval, cover image URL,
  közzététel/törlés gombok.
- **`public/blog.html`** (ÚJ) — publikus blog lista oldal (`/blog`): kártyás elrendezés
  cover képpel vagy emoji fallbackkel, RO/HU kétnyelvű, API-ból töltve.
- **`public/blog-post.html`** (FELÜLÍRVA) — slug-alapú blog cikk oldal: dinamikus meta tagek,
  OG tagek, Article structured data (ld+json), marked.js Markdown→HTML renderelés, CTA blokk.
- **`public/landing-editor.html`** (egyszerűsítve) — a régi 3-accordion blog szerkesztő
  eltávolítva; helyette link a `/developer/blog` szerkesztőbe.
- **`public/index.html`** — blog kártyák linkjei `/blog/1|2|3` → slug-alapú URL-ekre frissítve.
- **`routes/pages.js`** — `/blog` és `/blog/:slug` route-ok bekötve, `/developer/blog` gated.

---

## 2026-06-21 — Fuvar-sorozatok: cégenként állítható/választható fuvar-szám előtag

- **Igény:** a fuvar-szám előtagja eddig fixen `CMD` volt. Mostantól a cég SAJÁT MAGÁNAK
  állíthatja (mint a menetlevél-szériát): alapból `CMD`, de **új sorozatot is felvehet,
  átnevezhet**, beállíthat alapértelmezettet, és **fuvar-kiíráskor választhat** közülük.
- **Háttér-garancia:** a fuvar valódi azonosítója továbbra is a háttérben generált,
  cégfüggetlen véletlen kulcs (`orders.id`), és minden lekérdezés `company_id`-szűrt →
  két cég fuvarjai sosem keverednek, akkor sem, ha azonos fuvar-számot választanak.
- **`db/order-series.sql`** (ÚJ, idempotens) — `order_series` tábla (megjelenített
  `prefix` + belső `seq_key` + `is_default`); minden meglévő cég kap egy alapértelmezett
  `CMD` szériát (`seq_key='CMD'` → a meglévő `document_series` `CMD` számláló folytatódik).
  A `prefix` ELVÁLIK a `seq_key`-től → az előtag átnevezhető a számlálás megszakítása nélkül.
- **`lib/orderNo.js`** — `getDefaultSeries` + `resolveOrderSeries(db,cid,seriesId)` (idegen
  szériát sosem ad — a cég alapértelmezettjére esik vissza) + `nextFuvarNo(db,cid,year,series)`.
- **`handlers/orderSeries.js`** (ÚJ, regisztrálva) — `orderSeriesList` (Admin/Manager),
  `orderSeriesSave` (létrehozás/átnevezés), `orderSeriesSetDefault`, `orderSeriesDelete`
  (az alapértelmezett nem törölhető); CSAK Admin írhat, company_id-szűrt, `prefix`
  validáció (`[A-Z0-9]{1,10}`, `MT` foglalt), audit minden íráson.
- **Bekötés:** `handlers/orders.js` `comCreate` (`series_id`) + `bulkCreateOrders`
  (importonként egy közös széria) + `routes/inbound-orders.js` approve — mind a választott
  vagy alapértelmezett szériát használja.
- **UI:** a fuvar-kiíró űrlap „Fuvar-sorozat" választója (`oSeria`, alapértelmezett ★);
  a Beállítások → Cég & arculat → 📋 Számozás alatt **🚚 Fuvar-sorozatok** kezelő (lista
  következő számmal, alapértelmezett-jelölés, átnevezés, törlés, új felvétele). i18n
  `form.seria` + `comset.os.*` (RO-alap+HU); cache-bust `?v=20260621os`.
- **Verifikáció:** valós Postgres 16-on — default folytatás, új széria független számláló,
  átnevezés-folytonosság, cross-tenant fallback (idegen széria → saját default), migráció
  idempotencia; 100 Jest zöld + require-sweep.

## 2026-06-20 — ÚJ: ember-olvasható fuvar-szám (CMD-YYYY-XXXX)

- **Gyökér-igény:** a fuvar azonosítója eddig csak a belső, véletlenszerű kulcs volt
  (`orders.id`, pl. `CMD-MBKZ41X07AF`) — gép-barát, de csúnya és nem sorszámozott.
  Most minden fuvar kap egy cégenként/évenként növekvő, ember-olvasható fuvar-számot
  (pl. `CMD-2026-0001`); a belső `orders.id` VÁLTOZATLAN marad (minden FK/hivatkozás
  rá épül) — a fuvar-szám csak megjelenítési/keresési érték.
- **`db/order-fuvar-no.sql`** (ÚJ migráció, idempotens) — `orders.fuvar_no VARCHAR(30)`
  + `idx_orders_fuvar_no (company_id, fuvar_no)`; **visszamenőleges feltöltés** a meglévő
  fuvarokra (cégenként/évenként, `created_at`-sorrendben) + a `document_series` `CMD`
  számláló szinkronizálása a backfillelt maximumra, hogy az ÚJ fuvarok onnan folytassák.
  A sorszámozás a meglévő `document_series` mintát használja (mint a menetlevél MT-YYYY-XXXX).
- **`lib/orderNo.js`** (ÚJ) — `nextFuvarNo(db, companyId, year)`: cégenként/évenként növekvő
  fuvar-szám a `document_series`-ből (`doc_type='CMD'`); a `db` lehet pool vagy tranzakciós
  kliens. Bekötve a 3 fuvar-létrehozó úton (mind best-effort: hiba esetén `fuvar_no=NULL`,
  a fuvar mentése akkor is fut): **`handlers/orders.js`** `comCreate` + `bulkCreateOrders`,
  **`routes/inbound-orders.js`** approve.
- **Megjelenítés:** `comList` visszaadja a `fuvar_no`-t; a **fuvar-lista** első cellája a
  fuvar-számot mutatja (a belső id tooltipben), az **entitás-adatlap** (`getOrderDetail`/
  `entity-detail.js`) „Nr. cursă / Fuvar-szám" sorral; a **globális kereső** is keres rá és
  azt jeleníti meg. i18n `ed.o.fuvarNo` (RO-alap+HU); cache-bust `?v=20260620fno`.
- **Verifikáció:** valós Postgres 16-on a backfill (cégenként/évenként 1..N), a
  `document_series` szinkron, a `nextFuvarNo` folytatása és a migráció idempotenciája
  ellenőrizve; 100 Jest zöld + require-sweep.

## 2026-06-19 — Fix: ANAF CUI-lekérdezés robusztusság — timeout 25s, SSL cause-logging, jobb hibaüzenetek

- **`services/clients.js`** — `fetchJson` timeout 12 s → 25 s (ANAF lassú); hibaüzenet enrichment: a Node.js `undici`
  (`err.cause`) SSL/hálózati hiba részletei is megjelennek a szerver-naplóban és a kliens hibaüzenetben; `!r.ok` és
  `!r.data` esetén külön, érthetőbb román hibaüzenet (`Eroare ANAF (HTTP 5xx)` / `răspuns invalid`).
- **`routes/clients.js`** — `console.error` naplózás az ANAF-hibáknál (CUI + hibaüzenet → Render-logban látszik).

---

## 2026-06-19 — Fix: HERE útdíj-becslés sosem adott vissza HERE-eredményt (`bump` nem volt exportálva)

- **`lib/mapsProvider.js`** — a `bump()` függvény hozzáadva az `module.exports`-hoz. A `handlers/toll.js`
  `maps.bump(cid, 'here')`-t hívott a sikeres HERE-hívás után, de a függvény nem volt exportálva →
  `TypeError` → try/catch elkapta → a HERE-eredmény elveszett, a kód visszaesett az ingyenes becslésre.
  Megoldás: `bump` exportálva. A „🎯 Pontos (HERE)" jelölőnégyzet + beállított per-cég HERE-kulcs esetén
  mostantól valóban HERE-eredmény érkezik (`source: 'here'`).

---

## 2026-06-19 — Galéria-sablonok: minden gomb működik vagy eltűnik (nincs „halott" gomb)

> Folytatás: a sablonok ÖSSZES beépített gombja vagy valódi linkre mutat (reagál kattintásra),
> vagy — ha nincs link — **eltűnik a levélből** (nem marad rákattinthatatlan `href="#"` gomb).

- **`public/email-gallery.js`** — a `btn`/`gbtn` alapértelmezett linkje `#` helyett `{{action_url}}`;
  az 5 inline CTA-gomb (DESCOPERĂ, Află mai mult, Rămânem în legătură, Hai să începem, [ EXECUTĂ ])
  is `{{action_url}}`-t kap; a követő-gombok `{{track_url}}`-t. A footer Dezabonare/Contact linkek
  változatlanok (nem gombok).
- **Küldéskori behelyettesítés + tisztítás** (`handlers/orderEmail.js` `_applyBuilderVars`,
  `handlers/emailBuilder.js` `applyVars`): a `{{track_url}}`/`{{action_url}}` üres értéke egy
  eltávolító-jelölővé (`__VS_REMOVE__`) fordul, majd egy záró regex a **teljes `<a>` gombot törli**.
  Így link nélkül nem marad gomb; linkkel működik.
- **`public/order-email.js`** — új opcionális „🔗 Link a sablon gombjaihoz" mező (`button_link`,
  csak http/https) → a `{{action_url}}` gombok ide mutatnak; a „követés" gomb a fuvar `/t/<token>`
  linkjét használja. i18n `oe.btnLink`/`oe.btnLinkNote` (RO-alap + HU). Cache-bust
  `?v=20260619btn`. 100 Jest zöld.

## 2026-06-19 — Galéria-sablonok: céges logó a fejlécbe + működő követő-gomb ({{logo}}/{{track_url}})

> A 30 beépített e-mail-galéria sablon mostantól a **cég feltöltött logóját** jeleníti meg a
> fejlécben, és a „Urmărește" gombok a megosztott **követő-linkre** mutatnak (eddig `href="#"` volt).

- **`public/email-gallery.js`** — mind a 30 sablon fejléccellájába bekerült a `{{logo}}` helyőrző
  (fehér „chip" mögötte → bármilyen háttéren látszik; üres, ha nincs feltöltött logó → a fejléc
  változatlan). A két követő-gomb (✅ visszaigazolás, 🚚 fuvar-állapot) `href="{{track_url}}"`-t kap
  (`btn`/`gbtn` opcionális `href` paraméter).
- **`handlers/orderEmail.js`** — `_applyBuilderVars` a `{{logo}}`-t nyers HTML-ként (céges logó-kép,
  escape-elt URL) helyettesíti, a `{{track_url}}`-t a fuvar publikus `/t/<token>` linkjére (token-gen,
  ha a `tracking` funkció elérhető; különben `#`). A logó a feltöltött `company_branding`-ből.
- **`handlers/emailBuilder.js`** — `applyVars` + `ebSend` ugyanezt: `{{logo}}` a cég logója,
  `{{track_url}}` → `#` (a builder-küldésnek nincs fuvar-kontextusa). company_id-szűrt logó-feloldás.
- **Megjegyzés:** a korábban már elmentett saját sablonok a token nélkül készültek — a logó/követő-gomb
  a galériából **újra használt** (újra mentett) sablonoknál jelenik meg. Cache-bust
  `email-gallery.js?v=20260619logo`. 100 Jest zöld.

## 2026-06-19 — „Email a fuvarról": vizuális sablon-választó + céges logó a fejlécben

> A fuvar ✉️ „Email despre cursă" dialógusában mostantól a mentett **vizuális sablonok**
> (e-mail szerkesztő + galériából mentett) közül is lehet választani, és a kiküldött
> levél fejlécében a cég **feltöltött logója** jelenik meg (ha nincs, marad a „vallorSoft").

- **`handlers/orderEmail.js`** — `getOrderEmailData` mostantól visszaadja a cég
  `email_builder_templates` sablonjait is (`builder_templates`: id/név/tárgy, company_id-szűrt).
  `sendOrderEmail` új `builder_template_id` paraméter: ha választott, a sablon teljes
  HTML-je lesz a levél törzse, a `{{változók}}` ({{nev}}/{{cegnev}}/{{datum}} + fuvar-mezők
  order_id/route/status/pret/km) escape-elt behelyettesítéssel feloldva (ownership: id+company_id).
- **Céges logó az e-mail fejlécében** — a kiküldött levél (valós ÉS teszt) fejlécében a cég
  feltöltött logója (`company_branding`, `/branding/logo/<cid>.png`), ha nincs feltöltve,
  az alapértelmezett „vallorSoft" felirat marad. A branding-keret közös segéddé emelve
  (`services/email.js` `wrapBrandedEmail`, exportálva); a `sendClientEmail` is ezt használja.
  Vizuális sablonnál NEM csomagoljuk be újra (a sablon a saját arculatát hozza).
- **`public/order-email.js`** — második „Vizuális sablon (szerkesztő / galéria)" választó;
  kiválasztáskor a tárgy előtöltődik + jelzés, hogy a levél a sablon HTML-jével megy ki.
  i18n `oe.tplVisual`/`oe.tplVisualNote` (RO-alap + HU); cache-bust `order-email.js?v=20260619oetpl`,
  `i18n.js?v=20260619oetpl`. 100 Jest zöld.

---

## 2026-06-18 — Alvállalkozói GPS-követés mint developer funkció-kapcsoló (csomag + cég)

> Ellenőrzés: az új funkciók kezelhetők-e a developernél (csomagban engedélyezni/kivenni ÉS cégenként)? A legtöbb új funkció már a `VS_FEATURES` katalógusban van → a developer mind csomag- (`getPlanFeatures`/`setPlanFeature`), mind cégszinten (`devGetCompanyFeatures`/`devSetCompanyFeature`) kapcsolja. **Egyetlen kivétel volt: az alvállalkozói jármű-GPS** — nem volt önálló kulcsa (a `carrier-portal`/`tracking` alá bújt). Most külön kapcsolható.

- **`public/feature-catalog.js`** — új `carrier-gps` kulcs (Alvállalkozói jármű GPS-követés 🛰️). Alapból BE (hiányzó sor = engedélyezett → nem törő), a developer csomag- és cégszinten letilthatja.
- **Szerver-gate-ek** (`featureEnabled(cid,'carrier-gps')`): `handlers/carriers.js` `carrierVehicleSetGps` (diszpécser mentés tiltva, ha ki); `routes/carrier-portal.js` POST/PUT — GPS-mezők csak ha be (kikapcsolva a tárolt adat érintetlen marad); `routes/track.js` — az ügyfél követő-oldalon az alvállalkozói pozíció/külső-link csak ha be; `/api/carrier/me` `gps_enabled` jelző.
- **Kliens:** a diszpécser jármű-tábla „GPS" oszlopa/gombja + az alvállalkozói portál GPS-mezői (add-form + inline szerkesztő) elrejtve, ha a funkció ki van kapcsolva (`window._vsFeatures` / `me.gps_enabled`).
- 100 Jest zöld; require-sweep OK. Cache-bust `feature-catalog/console-shared/carrier ?v=20260618cgps2`.

## 2026-06-18 — Szerep-oldalak kétnyelvűsítés lezárása (sofőr/portál/alvállalkozó/könyvelő)

> A teljes admin+manager kör után a maradék szerep-oldalak átnézése. Eredmény: ezek **már nagyrészt i18n-eltek** voltak (a sofer.js/portal.js/carrier.js/konyvelo.js bőven `t()`-zik, a HTML-labelek `data-i18n`/`<span data-i18n>` mintát használnak). Egyetlen valódi maradék: az alvállalkozói portál GDPR jármű-modalja egymás mellett RO/HU volt.

- **`public/carrier.html`** — a GDPR jármű-figyelmeztető modal (cím, szöveg, „Mégsem"/„Értem →" gombok) és a vissza-link RO/HU-inline helyett `data-i18n`-re; **`i18n.js`** +6 `car.*` kulcs (`backHome`/`gdprVehTitle`/`gdprVehText`/`gdprCancel`/`gdprOk`).
- **Ellenőrzés:** sofer/portal/konyvelo HTML-ben 0 bekötetlen felirat; a JS-ekben nincs beégetett `toast/confirm/alert` (mind `t()`); minden hivatkozott kulcs létezik; `i18n.js` parse OK; 100 Jest zöld. Cache-bust `i18n.js?v=20260618roles`.
- *(A **developer** felület szándékosan kimarad — `is_dev`-only belső eszköz, HU-központú a konvenció szerint.)*

## 2026-06-18 — Teljes admin+manager panel-kétnyelvűsítés (minden felirat bekötve)

> Az admin és manager konzol ÖSSZES paneljének és moduljának beégetett magyar felirata bekötve az i18n-be (RO-alap + HU-váltó): mezőcímkék, gombok, szekció-/modal-fejlécek, `<option>`-ök, táblázat-fejlécek, hint-szövegek, placeholderök és tooltip-ek.

- **`public/admin.html` + `public/manager.html`** — ~**260 elem** kapott `data-i18n` / `data-i18n-ph` / `data-i18n-html` / `data-i18n-title` attribútumot (a két konzol azonos modaljai — user-szerkesztő, jármű-szerkesztő, külső-sofőr, gyors-jármű, menetlevél, fizetés, hibajelentés — KÖZÖS kulcsokkal). Csak attribútum-hozzáadás: az `id`/`onclick`/`class`/logika **bájtra változatlan** (onclick-darabszám 86=86 admin, 82=82 manager; id 316=316).
- **`public/i18n.js`** — **161 új kulcs** (RO+HU), a meglévők újrahasználva. A gyerek-kontrollos labeleknél a szöveg `<span data-i18n>`-be került (nincs gyermek-törlés).
- A nem fordítandó értékek szándékosan érintetlenek: státusz-kódok (`Disponibil/Alocat/...`), pénznemek (`EUR/RON`), szerepkörök.
- **Ellenőrzés:** 0 maradék beégetett `<label>` mindkét fájlban; minden hivatkozott kulcs létezik; nincs duplikált kulcs; nincs gyerek-kontrollos `data-i18n` label; `i18n.js` parse OK; 100 Jest zöld. Cache-bust `i18n.js?v=20260618panes`.

## 2026-06-18 — Kétnyelvűsítés folyt.: szerep-oldalak nav-ellenőrzés + Beállítások profil-szekció

> A menü/almenü kör után a többi szerep-oldal navigációja és a Beállítások panel látható feliratai.

- **Nav-ellenőrzés (nincs hiba):** a **sofőr** alsó-nav (`sofer.nav*`) és a **könyvelő** tab-jai (`kon.tab*`) már `data-i18n`-eltek, a kulcsok léteznek; az **ügyfél-portál** és **alvállalkozói portál** nem tab-alapú. → a navigáció minden szerep-oldalon RO-alap + HU-váltó.
- **Beállítások panel — Profil adatok (admin + manager):** a beégetett mezőcímkék i18n-eltek: **`i18n.js`** +5 kulcs (`set.fullName`/`set.emailReadonly`/`set.phone`/`set.position`/`set.saveProfile`); **`admin.html`**+**`manager.html`** `data-i18n`(+`data-i18n-ph`). Cache-bust `i18n.js?v=20260618set`; 100 Jest zöld.
- *(A panel-tartalmak teljes kétnyelvűsítése iteratív — ez a profil-szekcióval indult; a többi panel külön körökben.)*

## 2026-06-18 — Menü/almenü kétnyelvűsítés: a maradék emojis almenük (Fiók, Előfizetés)

> Az admin/manager sidebar menü- és almenüpontjai szinte mind `data-i18n`-eltek (RO+HU), de **3 színes-emojis almenü** beégetett magyar maradt → RO-ban is magyarul látszott.

- **`public/i18n.js`** — 2 új kulcs: `nav.account` (👤 Cont / 👤 Fiók), `nav.subscription` (💳 Abonament / 💳 Előfizetés).
- **`public/admin.html`** — „👤 Fiók" (`data-tab=settings`) → `data-i18n="nav.account"`; „💳 Előfizetés" (`data-tab=elofizetesek`) → `data-i18n="nav.subscription"`.
- **`public/manager.html`** — „👤 Fiók" → `data-i18n="nav.account"`.
- Ellenőrizve: az admin+manager sidebar **mind az 57 `nav.*` kulcsa** létezik az i18n.js-ben (nincs literálként megjelenő kulcs). Cache-bust `i18n.js?v=20260618navi`; 100 Jest zöld. Ezzel a két konzol teljes menüje RO-alap + HU-váltó.

## 2026-06-18 — Integrációk kártyák i18n: RO-alap + HU-váltó (egységes nyelv)

> Az Integrációk fülön a kártyák kevert RO/HU feliratúak voltak (a Feladó-fiók románul, az e-mail-intake / számlázó / CargoTrack beégetett magyarral). Most mind a konvenció szerinti: **RO-alap + HU-váltó** az i18n-en.

- **`public/i18n.js`** — ~95 új kulcs (RO+HU): `intg.*` (fül-fejlécek), `eic.*` (e-mail-intake), `bc.*` (számlázó), `ctc.*` (CargoTrack).
- **`public/admin.html`** — az Integrációk fül-fejlécek `data-i18n`/`data-i18n-html` (intro + Fuvar-számlázás + GPS/Flotta).
- **`public/email-intake-card.js`** + **`billing-card.js`** — teljes átírás `t()`-re (a render nyelvváltáskor frissül a `onLangChange → loadTab('integrations')` úton); dátum/relatív-idő a választott nyelv lokáljával.
- **`public/cargotrack-card.js`** — a statikus markup `data-i18n` attribútumokkal (`I18N.apply` a mount után), a dinamikus szövegek (badge/gombok/üzenetek) `t()`-vel.
- Cache-bust `i18n.js`/kártyák `?v=20260618i18n`; 100 Jest zöld. *(A Feladó-fiók kártya — `email-sender-card.js` — már korábban i18n-elt volt.)*

## 2026-06-18 — Feladó-fiók duplikáció megszüntetése (szerepfüggő)

> A „Cont expeditor / Feladó-fiók" (SMTP/Brevo) beállító kártya KÉT helyen jelent meg, ugyanazt a backend-konfigot szerkesztve (azonos `ebSender*` handlerek): az **Integrációk** oldalon (`email-sender-card.js`, csak Admin) ÉS az **E-mail szerkesztő** (`/email-builder`, Admin+Manager) „Cont expeditor" paneljén.

- **Szerepfüggő megoldás:** a Manager nem éri el az Integrációkat, ezért neki **az e-mail szerkesztőben marad** a feladó-fiók; az **Adminnál elrejtjük** az e-mail szerkesztőből (nála az Integrációk a forrás) → egy szerep sem látja két helyen.
- **`public/email-builder.js`** — `boot()`: `getMyFeatures.pozicio` alapján, ha NEM Manager, elrejti a „Feladó-fiók" nav-kártyát + `#sec-sender` panelt (`window.__ebHideSender`). `ebSwitch` guard: `sender` panelre Adminnál nem navigál (→ `/admin`). A párosítás-figyelmeztetés Adminnál az Integrációkra mutat. A küldés/párosítás változatlan.
- A backend (`ebSenderSave` „csak Admin") és az Integrációk `email-sender-card.js` **érintetlen**. Cache-bust `email-builder.js?v=20260618dedup`; 100 Jest zöld.

## 2026-06-18 — Integrációk oldal: egységes, szimmetrikus kártya-megjelenés

> Az Integrációk fülön három eltérő stílusú kártya keveredett (`.glass` 18–22px, a CargoTrack `.ct-card` beégetett fehérrel + `max-width:560px` + 16px, az e-mail-intake `.eic`), ezért aszimmetrikus volt. Most minden kártya azonos kinézetű.

- **`public/style.css`** (additív, a fájl végén, **csak `[data-pane="integrations"]` alá szűkítve**) — minden szekció-kártya azonos szélesség (full), padding (22px), sarok (`--radius-lg`), keret (világosban `#e2e8f0`) és térköz (20px); a **CargoTrack kártya a rendszer-témához igazítva** (világos+sötét: háttér/keret/szöveg/inputok/gombok), így már nem a beégetett fehér 560px-es widget. Más oldalt nem érint.
- **`public/billing-card.js`** — a számlázó-választó chipek **egyenlő oszlopos rácsban** (`repeat(auto-fit,minmax(120px,1fr))`, középre igazítva) a korábbi változó szélességű flex helyett → szimmetrikus sor.
- Cache-bust `style.css`/`billing-card.js` `?v=20260618sym`. 100 Jest zöld. *(A kártyák kevert RO/HU feliratai külön i18n-kör — ez a kör csak a vizuális szimmetria.)*

## 2026-06-18 — Jogi oldalak (RO) bővítése az alvállalkozói GPS-funkcióval

> Az alvállalkozói jármű GPS-követés bevezetése után a román jogi/GDPR oldalak frissítve, hogy lefedjék az új adatkezelést.

- **`public/privacy.html`** — új §4.4.1 (alvállalkozói járművek GPS-e: megosztott link és/vagy az alvállalkozó által megadott CargoTrack object_id+API-kulcs; az alvállalkozó önálló adatkezelő a saját sofőrjei felé, Legea 190/2018; a kulcs AES-256-GCM-mel titkosítva, sosem kerül vissza) + §4.4.2 (publikus követő-link minimális adattal, visszavonható token); §7 destinatari + a HU összefoglaló kiegészítve.
- **`public/terms.html`** — új §14.1 (az alvállalkozó/Ügyfél szavatolja, hogy joga van a link/kulcs megosztásához és tájékoztatta a sofőrjeit; a kulcsok titkosítva, a publikus link minimális adatot mutat).
- **`public/dpa.html`** — §5 új adatkategória-sor (alvállalkozói GPS) + §9 subprocesszor-sor (alvállalkozó saját GPS-rendszere). Verzió 1.1, dátum 18.06.2026 (privacy/terms/dpa).
- **`CLAUDE.md`** Jogi/GDPR szekció: subprocesszor-tábla + „Kezelt személyes adatok" kiegészítve. *(A statikus oldalak a dinamikus jogi rendszer fallbackjei; kötelező újra-visszaigazolás nem indul automatikusan — ha kell, a developer a `notify_version`-nel kérheti.)*

## 2026-06-18 — ÚJ: alvállalkozói (carrier) jármű GPS-követés — megosztott link + opc. CargoTrack kulcs

> Eddig csak a SAJÁT flotta GPS-ét lehetett követni (a cég CargoTrack-fiókján). Mostantól az **alvállalkozó (Extern fuvar) járművéhez** is köthető követés: (1) **megosztott publikus követő-link** (bármilyen GPS-rendszerből), és/vagy (2) **CargoTrack object_id + API-kulcs** az élő pozícióhoz a térképen. Felvitel az **alvállalkozói portálon** (a fuvarozó maga) ÉS a **diszpécser** oldaláról; a link az **ügyfél követő-oldalán** is megjelenik.

- **`db/carriers-vehicle-gps.sql`** (ÚJ migráció) — `carrier_vehicles` + `track_url`, `gps_object_id`, `gps_api_key_enc` (AES-256-GCM). A kulcs a kliensbe SOHA nem kerül vissza (csak „van-e kulcs" jelző). A fájlnév a `carriers-ap.sql` UTÁN rendeződik (a tábla onnan jön).
- **`routes/track.js`** — ha a saját flotta nem ad pozíciót, a `carrier_vehicles`-ből (rendszám-egyezés szóköz-/kisbetű-függetlenül) feloldja: élő CargoTrack pozíció (saját kulccsal) → autó-marker, és/vagy `external_url` → „Urmărire externă" gomb. Best-effort, cache-elt.
- **`handlers/carriers.js`** — `carrierVehicleList` már nem szivárogtatja a titkosított kulcsot (csak `has_gps_key`); új `carrierVehicleSetGps` (Admin/Manager, tulajdon-ellenőrzött, AES-titkosítás, jelszó-megőrzés, audit).
- **`routes/carrier-portal.js`** — a portál jármű-CRUD kezeli a `track_url` + `gps_object_id` + `gps_api_key` mezőket (titkosítva, link-validációval, kulcs-megőrzéssel).
- **UI:** diszpécser (Bejövő számlák → alvállalkozói jármű-tábla „GPS" oszlop + 📍 szerkesztő-modal), alvállalkozói portál (jármű add/edit GPS-mezők + 🛰️/🔗 jelző), publikus `track.html` („🛰️ Urmărire externă" gomb). Új i18n `trk.externalTrack` / `cs.cv.*` / `car.*` (RO-alap+HU); cache-bust `?v=20260618cargps`. 100 Jest zöld.

## 2026-06-18 — Tracking: élő GPS minden aktív státusznál (nem csak Alocat/In Curs)

> A követő-oldalon a térkép megjelent, de „Poziția GPS nu este disponibilă" volt akkor is, ha a jármű GPS-re volt kötve és párosítva — mert az élő pozíciót csak `Alocat`/`In Curs` státusznál kértük le. A `Disponibil` (Înregistrat) fuvarnál így sosem jött a pozíció.

- **`routes/track.js`** — az élő GPS-lekérés státusz-feltétele kibővítve **minden aktív státuszra**: `Disponibil`, `Alocat`, `Extern`, `In Curs`, `Parkolt`, `Raktarban`. A lezárt/törölt (`Finalizat`/`Anulat`) kizárva (ott a jármű már más fuvaron lehet → félrevezető lenne; a `Finalizat` a kézbesítve-jelzést kapja, a tervezett-útvonal térkép marad). Párosítás/kulcs/cache logika változatlan. 100 Jest zöld.

## 2026-06-18 — Tracking-oldal: tervezett útvonal térkép élő GPS nélkül is

> A publikus követő-oldal (`/t/<token>`) eddig élő GPS hiányában csak egy „Poziția GPS nu este disponibilă" szöveget mutatott, alatta üres oldallal. Mostantól, ha nincs élő GPS, a **felrakó → lerakó tervezett útvonal** jelenik meg térképen.

- **`routes/track.js`** — a `/api/track/:token` válasz új `route: { from, to }` mezőt ad: a felrakó/lerakó cím **geokódolva** (`lib/routeEstimate.geocodeCached`, `geo_cache` mögött + tokenenkénti 1 órás memória-cache; best-effort — hiba nem dönti el az oldalt). Minimális adatkiadás elve megőrizve (nincs új érzékeny mező).
- **`public/track.html`** — térkép-render: élő GPS → autó-pozíció (mint eddig); ha nincs GPS, de van geokódolt útvonal → **felrakó (zöld) → lerakó (piros) `circleMarker` + szaggatott összekötő vonal**, `fitBounds`-szal; ha egyik sincs → a régi szöveges jelzés. A markerek `circleMarker`-ek (nincs külső ikon-kép függés). 100 Jest zöld.

## 2026-06-18 — Fix (valódi gyökérok): hibás/markdown-os `APP_URL` env → minden e-mail-link érvénytelen

> A követő-link a `[https://...](https://...)/t/<token>` formában ment ki, mert maga az **`APP_URL` környezeti változó volt markdown-osan beállítva** (Render env): `base + '/útvonal'` így `[url](url)/útvonal`-t adott. A token mindig jó volt — a zárójelek (a hibás base) törték el. Ez minden APP_URL-ből épülő linket érintett (követés, meghívó, jelszó-reset, portál/alvállalkozó, előfizetés).

- **TEENDŐ a Renderen:** az `APP_URL` env-et tiszta URL-re kell állítani (`https://vallorsoft.onrender.com`), markdown/zárójel nélkül.
- **`lib/appUrl.js`** (ÚJ) — `appBaseUrl(fallback)`: a tiszta báziscímet adja vissza akkor is, ha az `APP_URL` markdown-osan/körítéssel lett megadva (kinyeri a `(...)`-ben lévő URL-t, ill. az első http(s) URL-t; záró `/` levágva). Így egy elgépelt env sem tudja eltörni a linkeket.
- **Bekötve** minden APP_URL-ből linket építő helyen: `handlers/orderEmail.js`, `services/email.js`, `routes/auth.js`, `handlers/clientPortal.js`, `handlers/carriers.js`, `routes/public-register.js`, `routes/trial-select.js`, `routes/subscription-cancel.js`, `services/scheduler.js`, `handlers/billingHandlers.js`, `handlers/emailTemplates.js`, `handlers/developer.js`, `handlers/stripe.js`, `routes/client-mail.js`.
- **`tests/unit/app-url.test.js`** (ÚJ) — markdown/záró-perjel/üres/körítés esetek. 100 Jest zöld. **Deploy/restart + a Render `APP_URL` javítása után él.**

## 2026-06-18 — Fix: követő-link érvénytelen e-mailben (markdown `[url](url)` zárójelek) — PR #199

> A kiküldött e-mailekben a publikus követő-link (`/t/<token>`) **érvénytelen** volt: markdown `[url](url)/t/token` formában jelent meg, és a levelező-/chat-appok a **zárójeleknél elvágták** a linket. A token mindig jó volt — csak a zárójelek rontották el.

- **Gyökérok:** a kód mindenhol rendes HTML `<a>` linket állít elő, de a leveleket **csak `htmlContent`-tel** küldtük ki → a **Brevo automatikusan generál sima-szöveges változatot, és a linkeket markdown formában (`[url](url)`) írja**. A plain-text részt mutató kliensek így törött linket kaptak. Renderen ez különösen érint, mert a kimenő levél a cégenkénti **Brevo fallbacken** megy.
- **`services/email.js`** — új `htmlToPlainText()` segéd (a linkeket **nyers URL-ként** adja vissza, sosem `[ ]`/`( )` köré csomagolva), és minden küldő-ágra explicit szöveges rész (`textContent` Brevónál, `text` nodemailernél): `sendClientEmail`, `_brevoSendCompany`, `getCompanyMailer` SMTP, valamint a meghívó/jelszó-reset/developer/lemondás rendszer-levelek. Exportálva teszteléshez.
- **`tests/unit/email-plaintext.test.js`** (ÚJ) — a követő-link nyers URL, nincs `()`/`[]`; eltérő linkszövegnél „szöveg: URL". 96 Jest zöld (30 kihagyott valódi-DB suite). **Deploy/restart után él.**

## 2026-06-18 — Sablon→csatolmány auto-pipa (opcionális) + pecsét/aláírás ráégetés CSP-fix

> Két dolog: (1) az „Email a fuvarról" sablon-választója bejelöli a megfelelő csatolmányt (opcionális, módosítható); (2) javítva a pecsét/aláírás ráégetés, ami CSP-blokk miatt nem működött.

- **`public/order-email.js`** — sablon kiválasztásakor a megfelelő csatolmány **automatikus (de opcionális) bejelölése**: `invoice_notify` → számla-PDF; `order_confirm_carrier` → megrendelő-dok (az **aláírt/pecsételt** verzió preferálva, ha van). Csak bejelöl (nem vesz le), a felhasználó szabadon módosítja. Cache-bust `?v=20260618oe3`.
- **`server.js` CSP-fix (pecsét/aláírás ráégetés)** — a `connectSrc` kibővítve: **`data:`** (a `pdf-lib` `fetch(dataURL)`-ja az aláírás/pecsét PNG-hez), **`https://cdnjs.cloudflare.com`** + **`blob:`** (a `pdf.js` worker letöltése → blob-worker; a `workerSrc` eddig is `'self' blob:` volt, de a cross-origin worker-URL-t a böngésző blokkolta, a fetch-fallbacket pedig a `connectSrc` tiltotta). Ezzel az aláíró-ablak renderel + a `buildSignedPdf` ráégeti a pecsétet/aláírást. **Deploy/restart után él.**

## 2026-06-18 — „Email a fuvarról" bővítés: követő-link pipa + mentett sablonok + teszt (közös cím)

> Az „Email a fuvarról" összeállító kiegészült: (1) pipálható a **követő-link** (fuvar elfogadva/visszaigazolva + autó-követés), (2) **mentett sablonokból** előtölthető a tárgy+üzenet, (3) **teszt** gomb, ami a **közös VallorSoft címről** a saját címedre küld (a valós küldés továbbra is csak a cég SMTP-jén megy).

- **`handlers/orderEmail.js`** — `getOrderEmailData` most ad `templates` (a cég mentett tranzakciós sablonjai, a fuvar adataival szövegesen előtöltve), `tracking_available`/`tracking_url` mezőt is. `sendOrderEmail`: új `include_tracking` (a publikus `/t/<token>` link beszúrása a body-ba — token-generálás a `tracking` feature-gate mögött) és `test` (a KÖZÖS címről `sendClientEmail`-lel a saját címre; a valós küldés a cég SMTP-jén). Csatolmányok a tesztben is mennek.
- **`handlers/emailTemplates.js`** — új NEM-enumerable `renderCompanyTemplates(cid,lang,vars)` segéd: a fehérlistás sablonok (tárolt vagy alapértelmezett) `{{vars}}`-behelyettesítve + HTML→szöveg, az összeállító előtöltéséhez.
- **`public/order-email.js`** — sablon-választó (előtölti a tárgyat+üzenetet), „🌍 Követő-link" checkbox (ha a funkció elérhető), „✉️ Teszt magamnak" gomb. i18n `oe.tracking/tpl/tplNone/test/testSentTo` (RO-alap+HU). Cache-bust `?v=20260618oe2`; 93 Jest zöld.

## 2026-06-18 — „Email a fuvarról": pipálós fuvar-adatok + csatolmányok (megrendelő/számla/fotók)

> Egy kiírt fuvarhoz tartozó levél tetszőleges címre (külső VAGY belső). Küldés előtt pipálással választod ki, MELY fuvar-adat kerüljön a szövegbe és MELY fájl menjen csatolmányként (megrendelő eredeti/aláírt-pecsételt, sofőr-POD-fotók, számla-PDF). Ami nincs pipálva, az nem kerül bele.

- **`services/email.js`** — a `getCompanyMailer.send` + `_brevoSendCompany` mostantól **csatolmányt** is küld (`attachments:[{name,contentBase64}]` → nodemailer `attachments` / Brevo `attachment`).
- **`handlers/orderEmail.js`** (ÚJ) — `getOrderEmailData(order_id)`: a fuvar kiválasztható adat-mezői (RO címkékkel) + ügyfél-e-mail + **elérhető csatolmányok felsorolása** (order_documents eredeti/aláírt, `documents` POD-fotók a fuvarhoz, `invoices` PDF-link) — mind `company_id`-szűrt, base64 nélkül. `sendOrderEmail`: a kipipált mezőkből épít adat-táblát + a kipipált csatolmányokat base64-ben feloldja (data-URI strip; külső URL/számla-PDF best-effort letöltés; darab- és méret-korlát), majd a **cég saját SMTP-/feladó-fiókján** küld (nincs beállítva → RO hiba). Admin/Manager, paraméteres, audit.
- **`public/order-email.js`** (ÚJ) — `openOrderEmail(orderId)` dialógus: címzett (ügyfél-e-mail előtöltve, bármilyen cím), tárgy, üzenet, **„Fuvar-adatok" checkbox-csoport** (alap: bepipálva), **„Csatolmányok" checkbox-csoport** (alap: kipipálatlan). A fuvar ⋯ menüjében „✉️ Email a fuvarról" váltja a korábbi egyszerű sablon-küldést.
- **i18n** `cs.ol.mOrderMail` + `oe.*` (RO-alap+HU); regisztráció `routes/execute.js`. Cache-bust `?v=20260618oe`; 93 Jest zöld.

## 2026-06-18 — Külső levelek a cég SMTP-jén, közös cím csak rendszer-értesítésre

> Tiszta szétválasztás: a cég KÜLSŐ levelei (sablonból küldés ügyfélnek/más cégnek, e-mail-szerkesztő) a **cég saját SMTP-fiókján** mennek (Integrációknál beállítva); a **közös VallorSoft cím** csak rendszer-értesítést küld (regisztráció, lejárat, szerviz) — és a teszt-leveleket.

- **`handlers/emailTemplates.js` `sendTemplatedEmail`** — valós küldés (külső címzett) mostantól a **cég saját feladó-fiókján** (`getCompanyMailer` → SMTP, Brevo-fallback). Ha nincs beállítva → RO hibaüzenet: „Configurați contul de e-mail (SMTP) în Integrări…". A **teszt** (`test:true`) a KÖZÖS VallorSoft címről a belépett felhasználó SAJÁT címére megy (a megadott címet figyelmen kívül hagyja — nem lehet vele bárhová küldeni).
- **`public/email-sender-card.js`** (ÚJ) — a feladó-fiók (SMTP/Brevo) beállító kártya az **Integrációk** fülön (`#emailSenderCardBox`, csak Admin), a meglévő `ebSenderGet/Save/Test/Delete` handlereken. Bekötve `admin.js` `loadTab('integrations')`-be.
- **`public/email-templates.js`** — a teszt-küldés `test:true`-val megy (saját címre); ~25 új `es.*` + `etpl.sentTest` i18n kulcs (RO-alap+HU).
- A **vizuális e-mail-szerkesztő** (`ebSend`) eddig is a cég SMTP-jén ment — változatlan, így a szabály egységes. Cache-bust `?v=20260618tpl2`; 93 Jest zöld.

## 2026-06-18 — Tranzakciós e-mail sablon: közvetlen küldés címzettnek + folyamatba kötés

> A „Șabloane e-mail" (tranzakciós sablonok) eddig csak szerkeszthető + teszt-küldés (saját címre) volt. Most bármely sablon közvetlenül elküldhető valódi címzettnek, és a fuvar- ill. számla-folyamatba is be van kötve.

- **`public/templated-email.js`** (ÚJ, közös) — `window.sendTemplatedEmailDialog({templateKey, keys, vars, toEmail, title})`: dialógus sablon-választóval (ha több kulcs), címzett-mezővel és a sablon `{{változó}}`-mezőivel; a meglévő `gas('sendTemplatedEmail')`-t hívja (cég sablonja, szerver-oldali escape). Bekötve admin/manager HTML-be.
- **E-mail sablonok oldal** (`public/email-templates.js`) — minden sablonhoz **„📧 Küldés címzettnek"** gomb (a teszt-küldés mellett) → a dialógust a sablon kulcsára rögzítve nyitja.
- **Fuvar-folyamat** (`public/console-shared.js`) — a fuvar-sor ⋯ menüjében **„📧 Sablonból e-mail"**: `vsSendOrderTplMail` a `_ordersAllCache`-ből (idézőjel-biztos) tölti elő az `order_id`/`route`/`client`/`status`-t.
- **Számla-folyamat** (`public/invoices-out.js`) — a Kimenő számlák során **📧** gomb: `invOutSendTpl` a `invoice_notify` sablont tölti elő (`client`/`invoice_no`/`order_id`).
- **i18n** (`public/i18n.js`) — `etpl.sendToBtn`, `cs.ol.mTplMail`, `etpl.var.*` (RO-alap+HU). Cache-bust `?v=20260618tpl`. A küldés a KÖZÖS VallorSoft Brevo-címről megy (mint eddig is a `sendTemplatedEmail`), `mail_log`-ba naplózva; 93 Jest zöld.
- **Címzett auto-kitöltés (követő commit):** a fuvar (`handlers/orders.js` `comList` → `clients.email` join `o.client_id`-n) és a számla (`routes/invoices.js` lista → `orders`→`clients` join) mostantól visszaadja az ügyfél e-mailjét, és a dialógus **előtölti a címzettet** (`vsSendOrderTplMail`/`invOutSendTpl` `toEmail`). Ha nincs `client_id`/e-mail, a mező üres marad (kézzel kitölthető). Cache-bust `?v=20260618tpl2`.

## 2026-06-18 — Szerviz-riasztás valós idejűvé tétele + részletes (autó+szerviz) e-mail

> A km-alapú szerviz-riasztás már nem a 12 órás seprésre vár, hanem a GPS-km friss leolvasása után azonnal megy; az e-mail pedig járművenként kiírja a teljes autó- és szerviz-adatot.

- **`services/scheduler.js` `startGpsMileageScheduler`** — a GPS km-óra leolvasás **24 óránként → óránként** (env `GPS_MILEAGE_INTERVAL_MIN`, alap 60, min 5; átfedés-őr). Minden cég km-frissítése **UTÁN AZONNAL** lefut a szerviz-esedékesség ellenőrzés (`_dispatchServiceAlerts`) → a km-alapú push + e-mail a leolvasási cikluson belül megy, nem 12 óra múlva.
- **Közös `_dispatchServiceAlerts(cid)`** kiemelve (push + Notifications + e-mail + `last_alert_at` hetente-egyszer őr). A `startServiceDueScheduler` (12 órás) megmaradt **seprés-biztonsági hálóként** (dátum-alapú esedékesség + GPS nélküli cégek).
- **Részletes e-mail** (`handlers/fleetCompliance.js` `computeServiceDueAlerts` + e-mail-törzs) — járművenként blokk: **autó-adat** (rendszám, márka/típus, aktuális km-óra) + **szerviz-adat** (esedékesség km/dátum, állapot, szerviz típusa RO-ul, utolsó szerviz dátuma, **költség RON**, **megjegyzés** teljes hosszában max 300 kar). A `_alertEmailBody` rugalmas (táblázat VAGY blokk). 93 Jest zöld.

## 2026-06-18 — Km-/dátum-alapú szerviz-esedékesség riasztás (GPS km) + e-mail értesítő a lejáratokról és szervizekről

> Két új, teljesen bekötött funkció: (1) a szerviz „köv. esedékes km" összevetése az élő GPS km-órával → push + vezérlőpult-sáv, amikor közeleg/elérte; (2) a lejáratokról ÉS az esedékes szervizekről e-mail is megy az Admin/Manager felhasználóknak a cég saját feladó-fiókjáról (RO).

- **`db/service-due-alert.sql`** (idempotens) — `vehicle_service_log.last_alert_at DATE` (hetente-egyszer duplikáció-őr a riasztás-ismétléshez, mint a `document_expiries`-nél). A `next_due_km`/`next_due_date` mezők már léteztek.
- **`handlers/fleetCompliance.js`** — új `computeServiceDueAlerts(cid, {onlyStale})` belső segéd (NEM-enumerable → `/api/execute`-en át nem hívható): járművenként a LEGUTÓBBI szerviz `next_due_km`-jét veti össze az aktuális kilométerórával (a nagyobbat veszi: élő GPS km-óra `gps_mileage_log` **VAGY** menetlevél-becslés = utolsó szerviz km + azóta megtett `fuvarlevelek.total_km` — így GPS-kilométeróra nélkül is működik), illetve a `next_due_date`-et a mai dátummal. Küszöb: 2000 km / 30 nap (vagy már túllépve). Új `getServiceDueAlerts` handler (Admin/Manager, read-only, `company_id`-szűrt, paraméteres).
- **`services/scheduler.js`** — új `startServiceDueScheduler` (12 órás): a küszöbön belüli/túllépett szervizekről **push** (`sendPushToRole` Admin/Manager) + **Notifications-központ** (`notify`) + **e-mail** (a **KÖZÖS VallorSoft címről** — `sendClientEmail` → `BREVO_SENDER`, pont mint a regisztrációs/rendszer-leveleknél; RO). Hetente ismétel (`last_alert_at`). A **`startExpiryScheduler`** is kap **e-mailt** a meglévő push/notify mellé (a lejáró dokumentumokról). Új közös segédek: `_alertEmailBody` (RO törzs; a fejlécet a `sendClientEmail` rakja rá) + `_emailAlertToAdmins` (a cég Admin/Manager felhasználóinak a közös címről, best-effort — Brevo nélkül csendben kihagyja).
- **Vezérlőpult-sáv:** `public/fleet-extra.js` `renderDashServiceAlert` (🔧 sáv: „még N km"/„N km túllépve"/„N nap"/„LEJÁRT", kattintásra a Szerviz-naplóra ugrik) — új `#dashServiceAlert` konténer az admin/manager vezérlőpulton, `loadDashboard` hívja (`console-shared.js`). 4 új i18n kulcs (`fe.dash.serviceDue/kmLeft/kmOver/toService`, RO-alap+HU).
- **Bekötés:** `server.js` `startServiceDueScheduler()`; cache-bust `i18n/console-shared/fleet-extra.js?v=20260618svc`. Multi-tenant + paraméteres SQL + best-effort e-mail; 93 Jest zöld.

## 2026-06-18 — Előfizetés lemondás (dezabonare) türelmi idővel + visszavonás

> Az Admin az Előfizetés pane-en lemondhatja az előfizetést, de a hozzáférés a már kifizetett időszak végéig megmarad. E-mail értesítő „M-am răzgândit" gombbal, és az utolsó napon emlékeztető.

- **`db/subscription-cancel.sql`** (idempotens) — `companies.subscription_cancel_at` (lemondás időpontja, NULL = nincs) + `cancel_lastday_notified`. A lemondás **NEM** állítja azonnal `cancelled`-re a státuszt (azt a login-kapu tiltaná) — a státusz `active`/`trial` marad, a hozzáférés a meglévő `paid_until`-kapun ér véget magától.
- **`handlers/billingHandlers.js`** — `cancelSubscription` (Admin; csak aktív/trial + hátralévő idő esetén; beteszi a jelzőt, RO értesítő e-mailt küld a `paid_until`-ig tartó hozzáférésről + „M-am răzgândit" linkkel; audit), `reactivateSubscription` (Admin; törli a jelzőt; audit). A `getMySubscription` mostantól ad `cancel_pending`/`cancel_at`/`can_cancel` mezőt is.
- **`routes/subscription-cancel.js`** — publikus `GET /abonament/reactivare?cid&tok` (bejelentkezés nélkül, az e-mail gombja): HMAC-token (a lemondás időpontjához kötve, timing-safe összevetés) → törli a jelzőt, meleg arculatú RO visszajelző oldal. A token újraaktiválás után érvénytelen.
- **`services/email.js` `sendSubscriptionCancelEmail`** — RO platform-értesítő (közös Brevo feladóról), „M-am răzgândit" zöld gombbal; lemondáskor és az utolsó napon is. `mail_log` (`type='subscription'`).
- **`services/scheduler.js` `startCancelReminderScheduler`** (24 órás) — az utolsó napon (`paid_until = ma`) emlékeztető e-mail a lemondott, de még hozzáférő cégeknek („még meggondolhatja magát"), majd a lejárt lemondott cégek véglegesítése `cancelled` státuszra.
- **UI:** Admin → Beállítások → 💳 Előfizetés státusz-kártyáján „Anulează abonamentul" gomb; lemondás után piros sáv a hátralévő napokkal + „↩️ M-am răzgândit" gomb. RO feliratok. Cache-bust `console-shared.js?v=20260618cancel`; 93 Jest zöld.

## 2026-06-17 — Beállítások pane-fix + PDF/e-mail kész sablon-galériák

> Két javítás: (1) az Admin **Beállítások** almenüinek pane-jei a teljes weblap aljára renderelődtek; (2) a PDF-sablonokhoz és a tranzakciós e-mail sablonokhoz is bekerült a „kész sablon" galéria (mint a vizuális e-mail-szerkesztőnél).

1. **HIBAJAVÍTÁS — Beállítások pane-ek a weblap alá csúsztak** (`public/admin.html`): a `company-settings`, `pdf-settings` és `elofizetesek` pane-ek a `#mainContent`/`app-layout` lezárása UTÁN voltak a DOM-ban (elárvult, 0-behúzású blokk), ezért az almenüre kattintva a tartalom a teljes oldal alján jelent meg, nem a normál content-területen. A három pane visszahelyezve a `#mainContent`-en belülre; a lezáró tagek a panek után. Div-egyensúly ellenőrizve (590/590). A `manager.html` már helyes volt.
2. **PDF kész sablonok** (`public/pdf-gallery.js` ÚJ — `window.PDF_PRESETS`): dokumentumtípusonként (Fuvar-lista/Menetlevél/CMR/Számla-kísérő) **≥3 kész preset**, az ELSŐ minden típusnál az „Implicit (sistem)" — a rendszer által automatikusan kitöltött kinézet, így a meglévő alap is választható/visszaállítható tételként jelenik meg. A presetek kódból jönnek (mindenkinek elérhető), egy kattintással az űrlapba töltődnek (fejléc/lábléc/akcent/logó), majd a felhasználó testreszabja és SAJÁT sablonként menti (meglévő `pdfTemplateSave`). UI: „✨ Kész sablonok" sor a `pdf-settings.js`-ben (`applyPreset`).
3. **Tranzakciós e-mail kész sablonok** (`public/email-templates-gallery.js` ÚJ — `window.ETPL_PRESETS`): kulcsonként (fuvar-visszaigazolás/státusz/árajánlat/számla/általános) **≥3 kétnyelvű (RO+HU) preset** (Implicit + Formális + Barátságos). Egy kattintással a kártya Tárgy/Törzs mezőibe töltődik, majd a meglévő `emailTemplateSave`-vel mentődik. UI a `email-templates.js`-ben (`applyPreset`).
4. **Wiring:** új script-ek az `admin.html`+`manager.html`-be (`pdf-gallery.js`, `email-templates-gallery.js`), cache-bust `?v=20260617tpl`; 4 új i18n kulcs (`pdfset.presets`/`presetLoaded`, `etpl.presets`/`presetLoaded`, RO-alap+HU). Backend érintetlen (a presetek kliens-oldaliak, a meglévő mentő-végpontokat hívják). 93 Jest zöld.
5. **PDF sablon-mockupok** (`public/pdf-template-mockups.html`, jóváhagyásra) — önálló, A4-stílusú, nyomtatható mockup 5 dokumentumról: **Listă comenzi**, **Notă însoțitoare factură**, **Aviz de însoțire a mărfii** (új opció), **CMR** (a hivatalos CMR/IRU formanyomtatvány hű mása: 1–24 dobozok, kitölthető `contenteditable` mezők, 5 példány-szín váltó + háromnyelvű változat RO·EN·DE / RO·EN·FR egymás alatti feliratokkal), **e-CMR** (digitális modell: QES aláírás 3/3 + observații + SHA-256/QR). Csak vizuális minta — a tényleges PDF-bekötés a jóváhagyás utáni külön kör.

## 2026-06-17 — E-mail galéria: 30 kész sablon mindenki számára (PR #180 + #181)

> A vizuális e-mail-szerkesztő (`/email-builder`) „🎨 Galéria" füle 30 beépített, kész e-mail-sablonnal — különböző színekben és formákban. Egy kattintással a szerkesztőbe tölthető, testreszabható és saját sablonként menthető.

- **`public/email-gallery.js`** — a sablonok **kódból** jönnek (nem cégenkénti DB-tétel) → minden cég ugyanazt a galériát látja, nincs cégenkénti feltöltés. 30 db:
  - **12 alap** (PR #180): 🌅 Napnyugta · 🌊 Óceán üzleti · ✅ Erdő visszaigazolás · 🖤 Espresso prémium · ⚪ Minimál · 🎉 Korall promó · 📰 Teal hírlevél · 🟣 Lila kreatív · 🔔 Borostyán emlékeztető · 🏢 Navy klasszikus · 🔴 Piros sürgős · 💗 Pasztel köszönő.
  - **+18 új** (PR #181) — **komolyabb/sűrűbb:** 🧾 Számla/kimutatás (tétel-tábla) · 📋 Részletes árajánlat (rúta-tábla) · 📊 Havi riport (stat-rács) · ⚖️ Hivatalos értesítés · 🗞️ Több szekciós hírlevél · 🚚 Fuvar-állapot tábla · 💲 Árlista · 📅 Időpont-visszaigazolás · 🏆 Éves összegzés; **futurisztikus:** ⚡ Neon · 🔮 Üveg-gradiens · 💻 Terminál/tech · 🌈 Holografikus · 🌃 Cyberpunk · 🔷 Elektromos minimál · 🌌 Kozmikus; **modern:** ☁️ Lágy modern · 🎨 Gradiens mesh.
- **E-mail-biztosság:** mind táblázatos elrendezés + inline CSS; a gradienses (futurisztikus) sablonoknál `solid` szín-fallback a nem támogató kliensekhez (pl. Outlook). Mindegyik a `{{nev}}` / `{{cegnev}}` / `{{datum}}` helyőrzőket használja.
- **UI:** új „🎨 Galéria" nav-kártya + panel — élő, kicsinyített (sandbox-olt iframe) előnézet + „✏️ Használ" (a GrapesJS-be tölti ÚJ sablonként → testreszabás + saját mentés) + 👁️ nagyítható előnézet. Új `darkWrap`/`gbtn` segédek a sötét/futurisztikus kártyákhoz. RO+HU nevek. **Tisztán kliensoldali** — backend/DB érintetlen. Cache-bust `?v=20260617eb4`; 93 Jest zöld.
- **Deploy-javítás:** a 30-sablonos PR (#181) main-push CI-futása a `concurrency: cancel-in-progress` miatt megszakadt, így a Render auto-deploy nem futott (élesen a 12-sablonos verzió maradt) → a `17470dd` commit CI-futásának **rerun**-jával a `deploy` job lefutott, az élesedés megtörtént.

## 2026-06-17 — ÚJ modul: vizuális e-mail szerkesztő + cég saját feladó-fiókról küldés

> Teljes vizuális (GrapesJS) e-mail-sablon szerkesztő KÜLSŐ kapcsolatoknak (ügyfél/jövőbeli ügyfél/alvállalkozó/egyéb) — NEM a platform felhasználóinak. A kimenő levelek a **cég SAJÁT e-mail-fiókjáról** mennek (SMTP nodemailer és/vagy cégenkénti Brevo), **nem egy közös címről**.

- **`public/email-builder.html` + `email-builder.js`** — őrzött `/email-builder` oldal (Admin/Manager, `email-builder` feature-kapu); GrapesJS + `grapesjs-preset-newsletter` a `cdn.jsdelivr.net`-ről. 5 nav-kártya: **Új sablon** (vizuális szerkesztő, logó-beszúrás a meglévő `/api/branding/logo`-ból, base64-kép), **Megtekintés/Szerkesztés**, **HTML-feltöltés** (kliensoldali FileReader), **Párosítás & Küldés** (kontaktok + sablon↔kontakt párosítás + kiküldés + napló), **📮 Feladó-fiók** (a cég saját küldő-fiókja). Meleg arculat + RO-alap/HU.
- **`handlers/emailBuilder.js`** — RPC: `ebTemplateList/Get/Save/Delete`, `ebContactList/Save/Delete`, `ebPairingGet/Save`, `ebSend`, `ebSendLog`, valamint **`ebSenderGet/Save/Test/Delete`** (feladó-fiók). Mind `company_id`-szűrt + paraméteres + tulajdon-ellenőrzött; sablon/kontakt/párosítás Admin/Manager, a feladó-fiók **csak Admin**. EMAIL_RE minden címzettre, `{{nev}}/{{cegnev}}/{{datum}}` **escape-elt** (nincs injekció), köteg-korlát 200, audit minden íráson/küldésen.
- **Cég saját feladás (`services/email.js` `getCompanyMailer`/`loadCompanySender`)** — a feladó-konfig `company_integrations` `provider='email_sender'`-ben, **AES-256-GCM** titkosítva (titok sosem megy ki, csak `has_pass`/`has_brevo_key`). **SMTP elsőbbség** (nodemailer, `verify()` a köteg előtt); ha a kapcsolat nem áll össze (pl. Render ingyenes csomag tiltja az 587/465-öt) ÉS van cégenkénti **Brevo** API-kulcs → arra esik vissza. Ha nincs feladó-fiók beállítva, **NEM** küld közös címről — egyértelmű figyelmeztetés. A küldés a meglévő `mail_log`-ba naplóz (`type='builder'`).
- **Tárolás:** `db/email-builder.sql` (idempotens) — `email_builder_templates` + `email_contacts` + `email_template_pairings`; a feladó-fiók a meglévő `company_integrations`-ban (nincs új tábla). **CSP:** egyetlen sor — `cdn.jsdelivr.net` a `styleSrc`-hez (GrapesJS CSS). `feature-catalog.js` (`email-builder`, Adminisztráció) + `i18n.js` (~95 `eb.*` kulcs RO+HU). Cache-bust `?v=20260617eb2`; 93 Jest zöld.

## 2026-06-17 — Új landing page (meleg arculat) — eredeti szöveggel, szerkesztő-kompatibilisen (PR #178)

> A publikus landing lecserélve a jóváhagyott meleg arculatra. 100% eredeti szöveg (semmi nem hasonlít a CargoTMS/xCargo/más RO TMS-re), a developer landing-szerkesztő végig működik.

- **`public/index.html` + `landing.css` + `landing.js`** — új design: sticky nav (RO/HU + portál-választó login-lenyíló + „Încearcă gratuit"), hero 60/40 dashboard-mockuppal, integráció-sáv, előnyök, modulok, „Cum funcționează", 4 csomag (havi/éves), vélemények, GYIK, CTA, lábléc a cég-adatokkal.
- **Originalitás:** a hero-szlogen lecserélve („Dispecerat, flotă și facturare — care lucrează în ritmul tău."); minden versenytárs-ízű felirat saját hangra átírva; a tiltott CargoTMS-frázisok ellenőrzötten **0** előfordulás.
- **Szerkesztő-kompatibilitás:** mind a **10 szekció** `data-vs-section`-t kap a szerkesztő `DEFAULT_ORDER`-jével (szakasz-sorrend + láthatóság működik), **158 szerkeszthető szöveg** `data-i18n` RO+HU lefedettséggel (`devSaveLandingTexts`/`/api/landing-texts` él), a blog-kártyák `/blog/:id` + kulcsok érintetlenek. A `landing-editor.html` nem igényelt változtatást.
- **Bekötés:** árazás a `/api/public-plans`-ból (havi/éves, éves=11×, TVA, EUR; RO fallback), „Încearcă gratuit" → `/register`, login-lenyíló → `/login`//`/portal`//`/carrier`, RO/HU váltó. Cache-bust `?v=20260617land`; 93 Jest zöld.

## 2026-06-17 — CargoTMS-hézagok Fázis D/2: PDF-sablon beállítások (PR #177) — a hiánylista A–D KÉSZ

> Per-cég, per-dokumentumtípus PDF-testreszabás (fejléc/lábléc/akcent/logó), a meglévő branding újrahasználásával. Ezzel a teljes CargoTMS-hiánylista (A–D, a Bursă kivételével) le van fedve.

- **`db/pdf-templates.sql`** (idempotens) — `pdf_templates(company_id, doc_type, header_text, footer_text, accent_color, show_logo, UNIQUE(company_id,doc_type))`; a logó + alap-szín a `company_branding`-ből (nincs duplikáció).
- **`handlers/pdfTemplates.js`** — `pdfTemplateList/Get` (Admin/Manager), `pdfTemplateSave` (**Admin**; `doc_type` fehérlista {order,waybill,cmr,invoice_note}, hex- + hossz-validáció, audit). Company_id-szűrt + paraméteres.
- **Bekötés (őszinte):** STÍLUSOZVA a fuvar-lista print/HTML export (`downloadSelectedOrders` — header/logó/lábléc/akcent). KIZÁRVA a szolgáltatói számlák (FGO/SmartBill/… — a provider rajzolja, jelölve a UI-ban). A `waybill/cmr/invoice_note` egyelőre tárolás + élő előnézet (jelölve), az aláírt-PDF (`buildSignedPdf`) érintetlen.
- **UI** `public/pdf-settings.js` — 📄 „PDF-sablonok" aloldal (Beállítások): per-típus űrlap + élő előnézet. `feature-catalog`+`i18n` (RO-alap+HU), cache-bust `?v=20260617d2`; 93 Jest zöld.

## 2026-06-17 — CargoTMS-hézagok Fázis D/1: Fuvar-adatlap + Ügyfél-profil (tabos drill-in) (PR #176)

> A listából megnyíló, tabos READ-nézet — a meglévő fuvar-szerkesztőt NEM írja át (csak olvasó-nézet + linkek a meglévő akciókra), a jármű/sofőr-adatlap mintájára.

- **`handlers/entityDetail.js`** — `getOrderDetail({id})` (tulajdon-ellenőrzés: `orders WHERE id=$1 AND company_id=$2`; majd `order_documents`/`documents` POD/`invoices`/`order_legs`/tracking + **`audit_log` idővonal cégre szűrve**, mert az `audit_log`-nak van `company_id`-ja) + `getClientProfile({id})` (ügyfél + fuvarai + számlái + portál-hozzáférés `pass_hash` nélkül). `_isAdminOrManager`, read-only, paraméteres.
- **UI** `public/entity-detail.js` — Fuvar: Áttekintés / Dokumentumok / Pénzügy / Szakaszok / **Aktivitás** / Portál; Ügyfél: Adatok / Fuvarok / Számlák / Portál. „🔎 Részletek" a fuvar-tábla `⋯` menüjébe (additív 7 soros blokk — a szerkesztő/státusz/akciók érintetlenek) és az ügyfél-listára. A szerkesztéshez a meglévő `openOrderEdit`/dok/számla akciókra linkel.
- `i18n` `ed.*` (RO-alap+HU), cache-bust `?v=20260617d1`; 93 Jest zöld; a `comUpdate`/orders-render érintetlen.

## 2026-06-17 — CargoTMS-hézagok Fázis C/5: E-mail sablon-kezelő (PR #175)

> Cégenkénti, kategorizált, kétnyelvű tranzakciós e-mail sablonok + sablonból küldés — a developer rendszer-sablonokat és a client-mail sablonokat NEM érintve.

- **`db/company-email-templates.sql`** (idempotens) — ÚJ `company_email_templates` tábla (`company_id`, `key`, `category`, `subject_ro/hu`, `body_ro/hu`, `active`, UNIQUE(company_id,key)). Külön tárolás (a developer `email_sys_*` a `developer_settings`-ben, a client-mail az `email_templates`-ben marad).
- **`handlers/emailTemplates.js`** — `emailTemplateList` (Admin/Manager, company-szűrt, a tárolt sorok a whitelist-defaultok fölé olvadva), `emailTemplateSave` (Admin/Manager, `key` fehérlista, hossz-korlát, upsert `(company_id,key)`-re, audit), `sendTemplatedEmail` (Admin/Manager; `EMAIL_RE` validáció, `template_key` fehérlista, company saját sablonja, `applyTemplateVars` **HTML-escape** → nincs injekció, a meglévő `sendClientEmail`+`logMail` küld). Kulcsok: order_confirm_carrier / order_status_change / quote_send / invoice_notify / generic (RO+HU default).
- **UI:** `public/email-templates.js` — ✉️ aloldal az Adminisztráció alatt (szerkesztő RO/HU + teszt-küldés); „📧 Sablonból küldés" gomb az **Árajánlatok** során (sablon + címzett, a kvótából előtöltött változókkal). `feature-catalog`+`i18n` (RO-alap+HU), cache-bust `?v=20260617c5`; 93 Jest zöld. **Ezzel a Fázis C teljes.**

## 2026-06-17 — CargoTMS-hézagok Fázis C/4: Cég-branding & beállítások (PR #174)

> Egységes „Cég & arculat" önkiszolgáló oldal — a meglévő branding/dok-széria/árfolyam infra újrahasználásával (nincs duplikáció).

- **`handlers/companySettings.js`** — `getCompanySettings` (Admin/Manager olvasás), `saveCompanySettings` (**csak Admin**): logó (a meglévő `/api/branding/logo` REST-en át), márka-szín (hex-validált), PDF-fejléc, `companies.eur_ron_rate`, és a menetlevél-prefix (a meglévő `document_series` upsert-logikájával). `company_id`-szűrt + paraméteres, audit.
- **`db/company-settings.sql`** (idempotens) — `company_branding.brand_color` + `pdf_header_text` (`ADD COLUMN IF NOT EXISTS`); meglévő oszlopot nem módosít. A számlázó `serie/TVA/pénznem` szándékosan a `billing_integrations`-ban marad (nincs duplikálva), a régi széria-widget és az aláírás-oldal érintetlen.
- **UI:** `public/company-settings.js` — Arculat (logó + szín + PDF-fejléc, élő előnézet) / Cég-adatok (EUR-RON) / Számozás; 🏢 „Cég & arculat" aloldal a Beállítások alatt; Manager csak olvas. `feature-catalog`+`i18n` (RO-alap+HU), cache-bust `?v=20260617c4`; 93 Jest zöld.

## 2026-06-17 — CargoTMS-hézagok Fázis C/3: Granulált jogosultságok + Fizetési ütemterv (PR #173)

> A meglévő `user_permissions` kiterjesztése Manager-jogokra (Admin mindig átmegy) + read-only cashflow-nézet. Nincs új tábla.

- **Granulált jogosultságok** — `handlers/permissions.js`: `getCompanyPermissions` (Admin), `setUserPermission` (Admin; a célfelhasználó cég-ellenőrzése, `perm_key` fehérlista, audit). Kulcsok: `stats_finance`, `orders_delete`, `invoice_issue`, `data_export`, `users_manage`. A `hasPerm()` segéd **nem-enumerable** (nem dispatchelhető). **Szerveroldali kapu (2, tiszta, Admin-bypass):** `comDelete` (Manager → `orders_delete`), `POST /api/orders/:id/invoice/emit` (Manager → `invoice_issue` middleware). A `data_export`/`users_manage` egyelőre UI-szintű (a meglévő útvonalak nem adnak tiszta egysoros kaput). UI: a Jogosultságok pane Manager × jog mátrix.
- **Fizetési ütemterv** (`payment-schedule`, Pénzügy, read-only) — `handlers/paymentSchedule.js`: bejövő (`carrier_invoices` due) + kimenő (az `invoices`-hoz a `finalized_at + clients.payment_term_days` proxy, az Operatív központtal konzisztensen); dátum-rendezett lista + totálok (be/ki/lejárt/7/30 nap). UI `vsMetricBand` + tábla irány/státusz-pillával.
- `feature-catalog` + `i18n` (RO-alap+HU), cache-bust `?v=20260617c3`. Minden lekérdezés `company_id`-szűrt + paraméteres; 93 Jest zöld; auth/billing/orders-logika érintetlen (csak additív kapuk).

## 2026-06-17 — CargoTMS-hézagok Fázis C/2: Értesítési központ + Mail-napló (PR #172)

> Értesítés-központ (🔔) + kiküldött-e-mail napló — multi-tenant, GDPR-tudatos. A két belső segéd (`notify`/`logMail`) **nem dispatchelhető** `/api/execute`-en (nem-enumerable) → nincs cross-tenant injekció.

- **`db/notifications.sql`** (idempotens) — `notifications` (company_id, user_id?, type, title, body, link_tab, read_at) + `mail_log` (company_id, to_email, subject, type, status, provider_id) + indexek.
- **`handlers/notifications.js`** — `notifList/notifUnreadCount/notifMarkRead/notifMarkAllRead` (scope `company_id=$1 AND (user_id IS NULL OR user_id=$2)`); `handlers/mailLog.js` — `mailLogList` **Admin/Manager** kapu (a címzett-e-mail PII). Belső `notify()`/`logMail()` `Object.defineProperty`-vel nem-enumerable (require-elérhető, de nem RPC).
- **Mail-napló bekötés:** `services/email.js` `_logMail()` minden küldő-ág végén (best-effort, try/catch — a küldést sosem buktatja); a `company_id` minden hívási útról átadva (invites/developer/auth-reset/carriers/client-mail/public-register/trial-select/billing/scheduler). Küldés-logika/szöveg/címzett változatlan.
- **Értesítés-bekötés (2 tiszta esemény):** portál-fuvarigény (`routes/portal.js`) + lejárat-scheduler (`services/scheduler.js`) a meglévő push mellé.
- **GDPR:** `handlers/gdpr.js` `exportCompanyData` kibővítve `notifications` + `mail_log`-gal (a 6. szabály szerint).
- **UI:** `public/notifications.js` (🔔 felső sáv dropdown + olvasatlan-badge, 60s poll) + `notifications` és `mail-log` aloldal az **Adminisztráció** alatt (`public/mail-log.js`). `feature-catalog`+`i18n` (RO-alap+HU). Cache-bust `?v=20260617c2`; 93 Jest zöld; auth/billing/küldés érintetlen.

## 2026-06-17 — CargoTMS-hézagok Fázis C/1: Árajánlatok (Quotes) modul (PR #171)

> Valódi ajánlat-kezelő — az elnyert ajánlatból egy kattintással fuvar lesz a MEGLÉVŐ fuvar-létrehozóval (nincs forkolt logika).

- **`db/quotes.sql`** (idempotens, valós PG16-on ellenőrizve) — `quotes` tábla (client_id/name, loc_from/to, price/valuta, status, valid_until, note, order_id, …) + `idx_quotes_company`.
- **`handlers/quotes.js`** — `quoteList` (bármely belépett, company-szűrt), `quoteSave` (Admin/Manager; update előtt tulajdon-ellenőrzés), `quoteSetStatus` (státusz-fehérlista {draft,sent,awarded,lost}), **`quoteToOrder`** (tulajdon-ellenőrzés → a meglévő `comCreate` hívása stub-res-szel; siker után `status='awarded'` + `order_id`). Mind paraméteres, audit minden íráson.
- **Frontend:** `public/quotes.js` (`Quotes.mount`) — KPI-sáv (Összes/Függő/Elnyert/Érték) + űrlap (ClientPicker újrahasználva) + tábla státusz-pillával és „→ Fuvar" gombbal. `quotes` aloldal a Fuvarok csoportban (admin+manager), `loadTab` bekötés, `feature-catalog.js` + `i18n.js` (`nav.quotes`+`qt.*`, RO-alap+HU). Cache-bust `?v=20260617c1`; 93 Jest zöld; orders/billing/auth érintetlen.

## 2026-06-17 — CargoTMS-hézagok Fázis B/2: Jármű- és sofőr-adatlap (tabos drill-in) (PR #170)

> A listából megnyíló, tabos entitás-adatlap — a Lejárat/Szerviz/Tankolás az adott járműre/sofőrre szűrve, és onnan is felvihető. A globális oldalak változatlanok.

- **`handlers/entityDetail.js`** — `getVehicleDetail({id})` + `getDriverDetail({email|id})`: **tulajdon-ellenőrzés elöl** (`SELECT … WHERE id=$1 AND company_id=$2` → ha nem a cégé, `{ok:false}`), majd az entitásra szűrt `document_expiries` (normalizált rendszám-egyezés) + `vehicle_service_log` (vehicle_id) + `fuel_card_transactions` (rendszám) / sofőrnél a `driver_advances` összegzés. Mind `company_id`-szűrt + paraméteres, `Admin/Manager` kapu, read-only.
- **Add-from-detail:** a Lejárat/Szerviz felvitel a Lejáratok/Szerviz fülről a **meglévő, auditált** `expirySave`/`serviceCreate`-et hívja, az entitással előtöltve — nincs párhuzamos mentő-logika.
- **UI:** `public/entity-detail.js` — „Részletek" gomb a jármű- és belső-sofőr táblákon → tabos modal (Adatok / Dokumentumok & Lejáratok / Szerviz / Tankolás; sofőrnél Decont, ha van). `vsAvatar`, warm stílus, egyetlen `#entityDetailModal` (nincs dup id).
- **Kihagyva (indokkal):** sofőr-tankolás (a `fuvarlevelek.alimentari` JSONB nem tisztán sofőrre köthető) — helyette a `driver_advances` összegzés. `i18n` `ed.*` (RO-alap+HU), cache-bust `?v=20260617b2`; 93 Jest zöld. Auth/global oldalak érintetlenek.

## 2026-06-17 — CargoTMS-hézagok Fázis B/1: Operatív központ + SLA-analitika (PR #169)

> Két read-only, aggregáló oldal a meglévő adatból — nincs új tábla, nincs írás, koholt adat nélkül.

- **Operatív központ** (`ops-center`, GENERAL) — `handlers/opsCenter.js` `getOpsCenter`: egyetlen `company_id`-szűrt aggregáció — aktív fuvar, mai fel-/lerakás, késő szállítás, **hiányzó UIT** (a `uit_active_count` logikával), hiányzó fuvarozó, lejáró AP-számla (`carrier_invoices` due≤7), lejáró dokumentum (`document_expiries`), kintlévőség-proxy (`finalized_at + clients.payment_term_days`, mert az `invoices`-nak nincs due-date oszlopa — kommentben jelölve). `_isAdminOrManager` kapu. UI: gyors-akció kártyák (`activateTab`), kattintható prioritás-sor, egészség-sor.
- **SLA & életciklus** (`stats-sla`, Statisztika) — `handlers/statisticsHandlers.js` `getSlaStats`: lemondási / kézbesített / kiszámlázási arány (invoices-join), átlag tranzit (`data_descarcare − data_incarcare`), havi trend (kész vs. lemondott). **Kihagyva (nem koholt):** pontos „visszaigazolási idő" — nincs per-esemény időbélyeg (jelölve `st.sla.note`). UI: `loadSla` (`vsMetricBand{tall}` + Chart.js + tábla).
- **Wiring:** `routes/execute.js`, `feature-catalog.js` (2 kulcs), `i18n.js` (`nav.opsCenter/slaStats` + `ops.*` + `st.sla.*`, RO-alap+HU). Cache-bust `?v=20260617b1`. Minden read `company_id`-szűrt + paraméteres, role-gated; 93 Jest zöld.

## 2026-06-17 — CargoTMS-hézagok Fázis A/2: Alvállalkozó-csoportok + Kedvenc helyszínek (PR #168)

> Két új funkció a hiánylistából — multi-tenant, tulajdon-ellenőrzéssel, audittal.

- **Alvállalkozó-csoportok** — `db/carrier-groups.sql` (idempotens): `carrier_groups` + `carriers.group_id`. `handlers/carriers.js`: `carrierGroupList/Save/Delete` + `carrierSetGroup`; a `carrierList` visszaadja a `group_name`-et, a `carrierSave` fogadja a `group_id`-t. **Biztonság:** a fuvarozó↔csoport kötés előtt MINDKÉT entitás tulajdon-ellenőrzése (`WHERE id=$1 AND company_id=$2`), `_am` (Admin/Manager) kapu, audit. UI a Külső sofőrök fülön: csoport-kezelő + szűrő + per-sor csoport-választó.
- **Kedvenc helyszínek** — `db/fav-locations.sql` (idempotens): `favorite_locations`. `handlers/favLocations.js`: `favLocationList` (bármely belépett), `favLocationSave/Delete` (Admin/Manager); `company_id`-szűrt, input-korlát (label≤120, address≤300), `type` fehérlista (load/unload/both), audit. UI: `fav-locations` aloldal (Beállítások; a manager Beállítások accordion-csoporttá alakítva) + **gyors-kitöltés** a fuvar-űrlap fel-/lerakó mezőihez (`FavLocations.attachPicker`, a Photon-autocomplete megőrizve, km/route újraszámítással).
- **Wiring:** `routes/execute.js` regisztráció, `feature-catalog.js` (`fav-locations` → Rendszer), `i18n.js` (`nav.favLocations`, `cs.cg.*`, `fav.*`, RO-alap+HU). Cache-bust `?v=20260617a2`. 93 Jest zöld; auth/AP/billing érintetlen.

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
