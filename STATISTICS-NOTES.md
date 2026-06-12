# VallorSoft — fejlesztési állapot-jegyzet

> Utolsó frissítés: **2026-06-11**. Ez a fájl a teljes fejlesztési sorozat
> állapotát rögzíti: mi készült el, hogyan élesítendő, és mi maradt hátra.
> (A kód-térkép a CLAUDE.md-ben; ez itt a "hol tartunk" dokumentum.)

---

## ✅ ELKÉSZÜLT — modulonként

### 📊 Statisztika & Riport (új főmenü, legördülő)
- 7 riport-fül: **Áttekintés** (KPI-k, riasztások, top útvonalak, havi bevétel/költség/eredmény grafikonok), **Pénzügy** 🔒 (bevétel vs. beszedett, kintlévőség-öregedés, kintlévő-lista esedékességgel, fuvar-szintű profit), **Fogyasztás** (tényleges vs. névleges, túlfogyasztás-jelzés), **Vásárlások**, **Sofőr teljesítmény**, **Jármű kihasználtság** (élő GPS-adatok + GPS-km vs. menetlevél-km), **Ügyfél riport** + admin-only **🔐 Jogosultságok**.
- Közös időszak-szűrő + CSV-exportok minden fülön. Chart.js grafikonok.
- **💱 EUR↔RON árfolyam** (admin állítja, 🏦 BNR-gomb a hivatalos napi árfolyamhoz) → Eredmény-számítás mindenhol. Pénznem-szabály: fuvar-ár EUR, sofőr-költség RON — csak árfolyammal vonjuk össze.
- **Pénzügy-jogosultság**: Manager csak akkor látja, ha az admin engedélyezte (szerveroldali gate is).

### 💰 Fizetés-követés
- A Finalizat fuvarokon 💰 gomb (szín = állapot): részfizetés kézzel VAGY „Teljes hátralék" egy gombbal; visszaállítás; a Pénzügy-riportból is hívható.
- Ügyfél-szintű **fizetési határidő** (15/30/45 nap…) → pontos „Esedékes/Lejárt"; lejárt kintlévőség riasztás az Áttekintésen.

### 🗺️ Térkép-stack — TELJESEN INGYENES (HERE lecserélve)
- Csempék: CartoDB/OSM · címkereső+geokódolás: Photon · útvonal: OSRM.
- Nincs API-kulcs, nincs díj. Opcionális `ORS_API_KEY` (ingyenes regisztráció) → **kamionos** `driving-hgv` profil súly/méret-korlátokkal, OSRM-fallbackkel; a felület jelzi a profilt.

### 🚛 Flotta & Megfelelés
- **⏰ Lejáratok**: ITP/RCA/CASCO/rovinietă/CMR-bizt./tahográf/ADR/jogosítvány/atestat/orvosi — jármű- vagy sofőr-szinten; 12 órás scheduler **push-riasztással**; Vezérlőpult riasztás-sáv.
- **🔧 Szerviz-napló**: km, kategória, költség, következő esedékesség — a költség beépül a jármű-eredménybe.
- **💶 Sofőr-elszámolás (decont)**: előlegek vs. készpénzes menetlevél-költések = kassza-egyenleg + diurna-járandóság (cég-ráták); nyomtatható.
- **⛽ Üzemanyagkártya-import**: generikus CSV oszlop-párosítóval (OMV/MOL/DKV/Eurowag), duplikáció-védelem; **kártya vs. sofőr-tankolás eltérés-riport** (>10% piros).
- **🛰️ GPS-naplók**: napi km-óra snapshot → GPS-km vs. beírt km összevetés.
- **🚛 Sofőr↔jármű hozzárendelés** (Belső sofőrök fül): jármű-választó minden sofőrnél, 🛰️ jelzés ha a jármű GPS-re kötött.

### 📅 Tervezőtábla 2.0 (diszpécser-tábla)
- **Asztali Gantt**: fuvar-sáv felrakástól lerakásig; sáv-húzás = mozgatás, jobb-szél = lerakó-dátum átméretezés; ⚠️ ütközés-jelzés; ma-vonal; kihasználtság-hősor; szűrők; 1-2-4 hetes zoom; GPS-pont a járműsávban.
- **Mobil napi nézet**: dátum-szalag + nagy jármű-kártyák, koppintásos kiosztás.
- Fuvar-popover: gyors dátum-szerkesztés, áthelyezés, kiosztás-törlés.
- **💡 VISSZFUVAR-RADAR (adu-ász — másnál nincs)**: a kiosztatlan fuvarok felrakóit a kamionok várható pozíciójával párosítja (előző fuvar lerakója, ingyenes geokódolás + cache), üresjárat-km-mel rangsorolva, foglaltság-ellenőrzéssel, **egy koppintásos kiosztással**.

### 🌍 Ügyfél tracking-link (prémium)
- Fuvaronként 🌍 gomb → publikus, tokenes, román nyelvű követő-oldal (`/t/<token>`): útvonal, státusz, rendszám + élő GPS-pozíció térképen. Minimális adatkiadás (ár/sofőr-adat nélkül).

### 🧾 Számlázás-kiegészítők
- **e-Factura (ANAF SPV) státusz**: a számla-modal 🔄 gombja lekéri a szolgáltatótól és eltárolja → 📨 jelző a fuvarlistán.
- **📷 POD**: a sofőr fotója fuvarhoz köthető (csak a saját cég fuvarjához) → 📷N jelző.

### 📧 Automatizmusok (schedulerek)
- Lejárat-figyelő (12 h, push) · havi e-mail összefoglaló az adminoknak (Brevo, hónap elején, küldés-naplóval) · napi GPS km-óra snapshot · e-mail intake (megvolt).
- **Migráció-futtató**: minden `db/*.sql` automatikusan lefut a szerver indulásakor (egyszer, `schema_migrations` könyveléssel) — **élesítésnél nincs kézi DB-munka**.

### 🧑‍💼 Sofőr-felület
- 📊 „E havi teljesítményem" mini-statisztika a főoldalon; POD-típus + fuvar-választó a fotófeltöltésnél.

### 🔧 Javítások
- **Meghívókód-rendszer**: a regisztráció login-fal mögött volt (sosem működhetett) → publikus whitelist; státusz-mező elírás; hiányzó nume/tel oszlopok; visszavont kód tiltása. +2 integrációs teszt.
- **Tervezőtábla mobil**: koppintásos kiosztás (a drag&drop érintőn nem megy).
- **Világos téma kontraszt**: a tervező fejléce/sávjai/popoverje light-módban is olvashatók.
- **Biztonsági audit**: mind a 33 új handler tenant-szűrése ellenőrizve; 2 rés javítva (fuvar-profit menetlevél-szűrés, POD cross-tenant csatolás).

### 🎛️ Előfizetés-kezelés (developer)
Minden új fül/funkció a feature-katalógusban, a developer cégenként kapcsolja: `stats-*` (7), `orders-planner`, `decont`, `expiries`, `service-log`, `fuel-import`, `tracking`, `monthly-report`.

### 🧪 Demo-adatok (2-es cég, automatikusan beszúródnak)
- **27 fuvar** (CMD-DEMO01–27): kiosztatlan/kiosztott/úton/külsős/teljesített; fizetett/részfizetett/kintlévő/LEJÁRT; ütközés-demo; **sofőr nélküli elkezdett munkák**; radar-célpontok.
- **7 menetlevél** (MT-DEMO01–07) tankolásokkal, kiadásokkal, diurnával — a fuvarokhoz kötve; egyik túlfogyasztó.
- **2. sofőr: Norbi** (`petonorbi96@gmail.com` / jelszó: `Demo1234` — be tud lépni) + **2. vontató: CV104VLR** (Volvo, 2022) hozzárendelésekkel.
- **2 külső sofőr** (Jani/Proba srl, Mircea/SpeedCargo) külsős fuvarokkal.
- 4 demo ügyfél fizetési határidővel · 6 lejárat (ITP LEJÁRT!) · 4 szerviz-tétel · 3 előleg · 10 kártya-tranzakció (szándékos eltéréssel) · 3 POD-fotó · GPS km-naplók mindkét kamionra.
- **Törlés**: szólj, és készítek törlő-migrációt (minden demo-elem jelölt: `CMD-DEMO%`, `MT-DEMO%`, „DEMO" megjegyzés).

---

## 🚀 Élesítés / a TE teendőid

1. **Deploy/restart** → migrációk + demo-adatok automatikusan betöltődnek (szerver-log: „Migráció lefuttatva: …").
2. Böngészőben **hard refresh** (mobilon PWA újranyitás).
3. Admin-beállítások a felületen: 🔐 Manager-jogosultságok (Pénzügy), 💱 árfolyam (🏦 BNR-gombbal), diurna-ráták (Decont fül).
4. Developer: új funkciók csomag-hozzárendelése cégenként.
5. Opcionális: `ORS_API_KEY` az `.env`-be (kamionos útvonaltervezés) — ingyenes kulcs: openrouteservice.org.
6. A `HERE_API_KEY` törölhető az `.env`-ből.

---

## ⬜ MI MARADT EL (és miért)

1. **Bursă-integráció (Trans.eu / Timocom)** — ehhez a szolgáltatókkal kötött partneri API-szerződés és kulcsok kellenek; amint megvannak, a Megrendelések fül mintájára beköthető (fuvarok behúzása + szabad kapacitás meghirdetése).
2. **e-Factura státusz automatikus (időzített) frissítése** — most a számla-modal 🔄 gombjával kézi; egy óránkénti scheduler-job rátehető, ha kell.
3. **HERE prémium funkciók UI-ja** (valós idejű forgalom, időjárás, üzemanyagárak, megálló-optimalizáló) — a kapcsolók léteznek a katalógusban, de a HERE lecserélése után ezek inaktívak; ORS/más ingyenes forrásból részben pótolhatók, ha igény van rá.
4. **Tervezőtábla finomságok** (későbbre): óránkénti felbontás, sofőr-szabadság/elérhetőség réteg, sáv bal-szélének húzása (felrakó-dátum), nyomtatható heti terv.
5. **Visszfuvar-radar v2**: ✅ élő GPS-pozíció már bevonva (ha nincs/lezárult az utolsó fuvar — `lib/vehiclePositions.js`, közös cache a Vezérlőpulttal); ✅ részrakomány-súly ellenőrzés (`orders.suly_kg` + `⚖️ túlsúly` badge). HÁTRA: OSRM-mel valós közúti km a légvonal helyett, radar push-értesítés új találatnál, fuvar-szintű rak-dimenziók a pótkocsi `cargo_*_cm` rakfelülettel összevetve.
6. **Demo-adatok törlő migrációja** — igény szerint, egy szavadba kerül.
