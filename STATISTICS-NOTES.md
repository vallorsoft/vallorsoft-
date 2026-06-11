# Statisztika & Riport modul — fejlesztési jegyzet

> Állapot: **1. fázis KÉSZ** (2026-06-11). Ez a jegyzet rögzíti, mi épült be és mi van hátra.

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

## ⬜ Hátralévő ötletek (2. fázis)
1. **Fuvar-jövedelmezőség egy pénznemben** — EUR↔RON árfolyam-beállítás (cégenként vagy BNR API), utána profit/fuvar és profit/km számítható (a fuvarlevelek `order_ids` mezője már összeköti a költségeket a fuvarokkal).
2. **Top útvonalak** — leggyakoribb felrakó→lerakó párok átlagárral.
3. **Riasztások az Áttekintésen** — túlfogyasztó jármű (>15% a névleges felett), 30+ napos kintlévőség badge.
4. **Havi PDF/e-mail összefoglaló** az adminnak (Brevo már be van kötve).
5. **Sofőr mini-statisztika** a sofőr mobilfelületén (saját km / fuvar / diurna e hónapban).
6. **Ügyfél fizetési határidő** (`clients.payment_term_days`) → „lejárt" kintlévőség pontosabb számítása.
7. **GPS-km napi snapshot-naplózás** (új tábla) → GPS-km vs. sofőr által beírt km automatikus összevetés, eltérés-riasztás.
8. **HERE-költség sor a Pénzügy fülön** (a meglévő `getMyHereUsage` handlerből).

## Élesítési teendők
1. `db/order-payments.sql` lefuttatása az éles DB-n (idempotens).
2. Szerver-újraindítás (új handler-modul).
3. Böngészőben hard refresh (`Ctrl+Shift+R`) — az új JS/HTML statikus.
4. Admin: 🔐 Jogosultságok fülön Manager-engedélyek kiosztása.
