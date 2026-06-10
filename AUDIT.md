# VallorSoft — Átfogó weboldal-audit

**Dátum:** 2026-06-10 · **Cél:** éles indulás ~300 felhasználóval (multi-tenant)
**Módszer:** a teljes kódbázis kézi átvizsgálata 5 területen — biztonság, szerver-oldali logika, integrációk/szolgáltatások, adatbázis + skálázás, frontend. Minden lelet a tényleges forráskód alapján, fájl:sor hivatkozással. A kritikus állítások kétszeresen ellenőrizve.

---

## 📋 Javítási napló (élő státusz)

A teljes hibalista **6 lépésben (6 commit)** kerül kijavításra. Állapot:

| Lépés | Tartalom | Státusz |
|-------|----------|---------|
| **1. Kritikus biztonság + stabilitás** | K1, K2, K3 (adatszivárgó végpontok), K5 (pool error-handler + dispatcher try/catch + unhandledRejection), M9 (devStats guard), K22 (login timing-oracle) | ✅ **KÉSZ** |
| **2. Azonosítók + DB-integritás** | K4 (CMD/FUV ütközés), K6 (sorszám-nullázás), M2 (dupla számla), M4 (push-index), M5 (FK ON DELETE), M6 (migráció-szinkron), M7 (GIN index) | ✅ **KÉSZ** |
| **3. Tranzakciók + szolgáltatás-robusztusság** | M1 (tranzakciók), M3 (scheduler-őr), M8 (2FA rate-limit), M10 (méretsapkák), M12 (OCR-út), K06–K08 (Brevo timeout, e-mail escape, intake-hibakezelés) | ⏳ következik |
| **4. XSS-mentesítés + PWA-ikonok** | K7 (legacy render-függvények + soferApi HTML escape), M11 (ikonok) | ⬜ |
| **5. Közepes szerver-javítások** | K01 (diurna időzóna), K02 (HERE-elszámolás), K03–K05 (cégszűrések), K10 (béta-adapterek), K12–K16, K23 | ⬜ |
| **6. Frontend + maradék** | K11 (GPS-polling), K18 (feature-kulcsok), K19–K21, alacsony prioritású tételek | ⬜ |

**1. lépésben elvégzett javítások (részletesen):**
- **K1** — `routes/soferApi.js`: a `/api/pdf-download/:id` mostantól bejelentkezést követel és cégre szűr (`email_sofer IN (SELECT email FROM users WHERE company_id=$2)`).
- **K2** — `handlers/documents.js` (`orderDocGet`): cégszűrés az `orders`-re joinolva (a régi sorok NULL `company_id`-ja miatt nem közvetlen oszlopszűréssel).
- **K3** — `handlers/documents.js` (`orderDocSaveSigned`): az UPDATE `FROM orders o ... AND o.company_id=$3` szűréssel fut.
- **K5** — `db.js`: pool-hangolás (`max:20`, timeoutok, keepAlive) + `pool.on('error')` kezelő; `routes/execute.js`: a dispatcher `await` + try/catch-ben hívja a handlereket; `server.js`: `process.on('unhandledRejection')` védőháló.
- **M9** — `handlers/developer.js` (`devStats`): `is_dev` jogosultság-ellenőrzés pótolva.
- **K22** — `routes/auth.js`: nem létező emailnél is fut dummy bcrypt-összehasonlítás (felhasználó-felsorolás időzítésből nem lehetséges).
- ✅ Tesztek: 5 suite / 17 teszt zöld.

**2. lépésben elvégzett javítások (részletesen):**
- **K4** — új `lib/ids.js` (`genDocId`): időbélyeg+random base36 azonosító (pl. `CMD-MQ8JYKJ4ZSE`, ≤20 karakter) a 9000 értékes véletlen helyett. Átírva: `handlers/orders.js` (comCreate), `routes/inbound-orders.js` (approve), `routes/soferApi.js` (fuvarlevel-save).
- **K6** — `routes/soferApi.js`: a `POST /api/document-series` prefix-mentése többé NEM nullázza a `current_seq`-et (duplikált hivatalos bizonylatszám kizárva).
- **M2** — `services/invoicing.js`: `emitInvoice` és `emitStorno` tranzakcióban, a fuvar sorára vett `FOR UPDATE` zárral fut — párhuzamos kérésnél sem készülhet dupla éles számla a szolgáltatónál; plusz DB-szintű részleges unique index.
- **M4–M5–M7** — új `db/audit-hardening.sql` migráció: push `endpoint_hash` duplikátum-takarítás + unique index (az `ON CONFLICT` mostantól tényleg működik), `orders.client_id → ON DELETE SET NULL`, `billing_integrations.company_id → ON DELETE CASCADE`, `companies.subscription_plan_id → ON DELETE SET NULL`, GIN index a `fuvarlevelek.order_ids`-re.
- **M7 (lekérdezés)** — `handlers/orders.js` (`getMySoferOrders`): `jsonb_exists()` → `?` operátor, hogy a GIN indexet ténylegesen használja a Postgres.
- **M6** — `server.js`: indulási **migráció-futtató** `schema_migrations` nyilvántartással — minden `db/*.sql` pontosan egyszer fut le (két menetben a fájlnév-sorrendi függőségek miatt); az élesítési checklist 2. pontja (kézi migráció-futtatás) ezzel automatizálva.
- ✅ Tesztek: 5 suite / 17 teszt zöld; `genDocId` füstteszt OK.

**Következik (3. lépés):** tranzakciók a többlépéses írásokra (comCreate order+leg, inbound approve, devCompanyDelete), scheduler átfedés-őr, 2FA rate-limit, kérés/melléklet-méretsapkák, OCR-út javítása, Brevo timeout + e-mail HTML-escape, intake hibakezelés (levél ne vesszen el némán).

---

## Vezetői összefoglaló

A rendszer architektúrája (RPC dispatcher + REST, multi-tenant szűrés, titkosított integrációs kulcsok, dizájn-rendszer) **alapvetően jó és 300 felhasználóra méretezhető**. Az indulást azonban **3 kategória blokkolja**:

1. **Adatszivárgás más cégek felé** — egy védelem nélküli menetlevél-letöltő végpont + két dokumentum-IDOR (K1–K3).
2. **Garantált működési hibák növekvő adatmennyiségnél** — a `CMD-xxxx`/`FUV-xxxx` azonosítók csak 9000 lehetséges értékből sorsolódnak (ütközés ~100+ rekordnál), a pg Pool hibakezelő nélkül a teljes szervert leállíthatja, a sorszám-prefix mentése nullázza a hivatalos menetlevél-számlálót (K4–K6).
3. **Tárolt XSS** — a sofőr által megadott név/adat a legacy admin-render függvényeken keresztül szkriptként fut le az Admin munkamenetében (K7).

Ami **nem igényel munkát**: SQL-paraméterezés, titkosítás, session-kezelés, jelszó-reset, indexelés, sorszámozó upsert, a frontend újabb kártya-moduljai, GPS/push/AI szolgáltatások hibatűrése. Részletes lista a dokumentum végén.

---

## 🔴 KRITIKUS — éles indulás előtt kötelező

### K1. Menetlevél-letöltés hitelesítés és cégszűrés nélkül
`routes/soferApi.js:212` — a `GET /api/pdf-download/:id` végponton **nincs `requireLogin` és nincs `company_id` szűrés**:
```js
router.get('/api/pdf-download/:id', async (req, res) => {
  const r = await pool.query('SELECT * FROM fuvarlevelek WHERE id = $1', [req.params.id]);
```
Az azonosító `FUV-1000…FUV-9999` (9000 lehetséges érték, `soferApi.js:86`), tehát **bárki az internetről, bejelentkezés nélkül végigpörgetheti és letöltheti az összes cég összes menetlevelét** (sofőrnevek, útvonalak, rendszámok, tankolások, határátlépések).
**Javítás:** `requireLogin` + cégszűrés (join a `users`-re `email_sofer` alapján, `company_id` ellenőrzéssel) — a szomszédos `/api/doc-download/:id` már jól csinálja. Hosszabb távon kitalálhatatlan azonosító (`crypto.randomUUID()`).

### K2. `orderDocGet` — más cég dokumentumának olvasása (IDOR)
`handlers/documents.js:90-104` — csak bejelentkezést ellenőriz, `company_id`-t nem:
```js
SELECT file_name, original_base64, signed_base64 FROM order_documents WHERE id = $1
```
Bármely bejelentkezett user (akár más cég sofőrje) a sorfolytonos egész `docId` végigpörgetésével letöltheti az összes fuvar-dokumentumot (CMR-ek, megrendelő PDF-ek).
**Javítás:** join az `orders`-re és `o.company_id = req.session.user.company_id` szűrés (ahogy az `orderDocList` már teszi).

### K3. `orderDocSaveSigned` — más cég dokumentumának felülírása (IDOR)
`handlers/documents.js:111-123` — `UPDATE order_documents SET signed_base64=$1 ... WHERE id=$2`, cégszűrés nélkül. Egy másik cég Admin/Manager-e felülírhatja bármely cég aláírt dokumentumát.
**Javítás:** `AND company_id = $3` (az oszlop létezik az `order_documents`-en), vagy join az `orders`-en.

### K4. 4-jegyű véletlen elsődleges kulcsok — ütközés garantált
- `handlers/orders.js:137` és `routes/inbound-orders.js` (approve): `id = "CMD-" + Math.floor(1000 + Math.random()*9000)`
- `routes/soferApi.js:86`: `"FUV-" + Math.floor(1000 + Math.random()*9000)`

Mindkettő **globális PRIMARY KEY az összes cégen át**, mindössze 9000 lehetséges értékkel, ütközés-kezelés nélkül. Születésnap-paradoxon: **~112 rekordnál már 50% az ütközés esélye** — 300 felhasználónál ez heteken belül „Szerver hiba" üzenetekkel elhasaló fuvar-/menetlevél-mentést jelent. Ez nem elméleti kockázat, hanem garantált meghibásodás.
**Javítás:** szekvenciából képzett azonosító (`CMD-` + `nextval`, a `document_series` minta újrahasznosítható), vagy nagy entrópiájú random + `23505` hibakód esetén újragenerálás ciklusban.

### K5. pg Pool hibakezelő és hangolás nélkül — teljes szerverleállás kockázata
`db.js:7-9` — `new Pool({ connectionString })`, semmi más. **Sehol nincs `pool.on('error')`** a repóban. Felhős Postgresnél (Neon/Render) az idle kapcsolatokat a szolgáltató eldobja; egy kezeletlen `error` esemény az idle kliensen **leállítja a Node folyamatot**. Ehhez kapcsolódik: nincs `process.on('unhandledRejection')` sem a `server.js`-ben, és a `routes/execute.js:26-32` dispatcher try/catch nélkül hívja a handlereket.
**Javítás:**
```js
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000, keepAlive: true,
});
pool.on('error', (err) => console.error('PG pool idle kliens hiba:', err.message));
```
Plusz a dispatcherben: `try { await handler(req,res,args); } catch(e){ ... }`, és `process.on('unhandledRejection', ...)` a `server.js`-ben. Élesben a pooler-es (pgbouncer) connection stringet használd.

### K6. Sorszám-prefix mentése nullázza a menetlevél-számlálót
`routes/soferApi.js:65` — a `POST /api/document-series`:
```sql
ON CONFLICT (company_id,doc_type,year) DO UPDATE SET prefix=$3, current_seq=0
```
A prefix bármilyen újramentése **visszaállítja a sorszámot 0-ra**, így a következő menetlevél **már kiadott hivatalos sorszámot kap újra** (duplikált bizonylatszám). A `/next` és a `fuvarlevel-save` atomikus növelése egyébként helyes — ez az egy végpont rontja el.
**Javítás:** `DO UPDATE SET prefix=$3, updated_at=NOW()` — a `current_seq`-et ne írja; vagy csak akkor nullázzon, ha tényleg új évet nyit.

### K7. Tárolt XSS a legacy render-függvényekben + a menetlevél-HTML-ben
Az `esc()`/`escHtml()` helper létezik (`console-shared.js:313`), az újabb modulok használják is — de a régi render-kód tucatnyi helyen nyers `innerHTML`-be fűzi a felhasználói adatot. **Egy sofőr a saját nevébe írt `<img src=x onerror=...>` payloaddal JS-t futtat az Admin munkamenetében** (teljes RPC-hozzáférés). Érintett helyek:
- `console-shared.js:437` (külsős sofőrök), `:449-460` (belsős sofőrök), `:467-477` (meghívók), `:518-526` (beérkezett menetlevelek), `:841` (járműtábla), `:785/831/833/835` (`<option>`-ok rendszámból/névből), `:403` (határnapló), `:810-823` (dokumentum-csoportok)
- `admin.js:108-109` (`loadUsers` — ráadásul `onclick='editUser(${JSON.stringify(u)})'`: a teljes sor-JSON HTML-attribútumban, egy aposztróf a névben eltöri/injektál)
- `sofer.js:251-260, 277-280, 819-843` (fuvar-kártyák)
- `developer.html:538-566` (`loadCegek` — csak az aposztrófot escape-eli), `:691-693` (hibajelentő user-mezők nyersen)
- **Szerver-oldalon:** `routes/soferApi.js:271-343` — a menetlevél-HTML (`${f.nume_sofer}`, `${f.alte_mentiuni}`, `${a.loc}` stb.) escape nélkül; a CSP `scriptSrc 'unsafe-inline'` miatt nem véd. K1-gyel kombinálva nyilvánosan elérhető tárolt XSS.

**Javítás:** minden szerverről jövő string menjen át az `esc()`-en; az `editUser`-nél ne attribútumba ágyazott JSON, hanem index/email átadása egy JS-tömbből; a soferApi HTML-sablonjában szerver-oldali escape-elő helper.

---

## 🟠 MAGAS — az első hetekben javítandó

### M1. Nincsenek tranzakciók a többlépéses írásoknál
A repó 251 query-hívása közt **egyetlen BEGIN/COMMIT sincs**. Konkrét veszélyhelyek:
- `handlers/orders.js:160-192` (`comCreate`): order-insert + leg-insert két külön hívás → láb nélküli fuvar maradhat.
- `routes/inbound-orders.js:161-177` (approve): 3 lépés tranzakció nélkül → hiba esetén létrejött fuvar, de „feldolgozatlan" inbound → **újrapróbálásnál duplikált fuvar**.
- `handlers/developer.js:90-107` (`devCompanyDelete`): ~10 egymás utáni DELETE → félbeszakadva árva sorok.

**Javítás:** `pool.connect()` + `BEGIN/COMMIT/ROLLBACK` ezeknél.

### M2. Dupla éles számla — versenyhelyzet a kibocsátásnál
`services/invoicing.js:75-85` (és `emitStorno` ~146-153): SELECT-majd-INSERT zár nélkül — két párhuzamos kérés mindkettő átmegy az „existing" ellenőrzésen és **két valódi számla készül a szolgáltatónál**.
**Javítás:** részleges unique index: `CREATE UNIQUE INDEX ... ON invoices(company_id, order_id) WHERE status='issued'` + `23505` elkapása; vagy `SELECT ... FOR UPDATE` tranzakcióban.

### M3. Scheduler-átfedés — dupla feldolgozás, Gemini-kvóta égetés
`services/scheduler.js:46-47` — a `setInterval(tick, 2*60*1000)` akkor is elsül, ha az előző `tick()` (PDF + OCR + 6-modelles Gemini-lánc, akár sok perc) még fut. Átfedő körök ugyanazt a mailboxot olvassák, ugyanazokat a leveleket dolgozzák fel kétszer (a DB-unique a duplikált sort védi ki, a duplikált munkát/kvótát nem).
**Javítás:** `let running=false` őr (futó tick alatt skip), vagy `setInterval` helyett önmagát újraütemező `setTimeout` a tick végén.

### M4. Push-feliratkozás: nem létező unique indexre hivatkozó ON CONFLICT
`routes/push.js:38` — `ON CONFLICT (endpoint_hash)`, de **sehol nem jön létre unique index** az `endpoint_hash`-en (a schema.sql:415 csak oszlopot ad hozzá). A fő ág így **mindig** 42P10-zel elszáll és minden feliratkozás a catch-ági DELETE+INSERT-en megy.
**Javítás:** `CREATE UNIQUE INDEX IF NOT EXISTS uq_push_subs_endpoint ON push_subscriptions(endpoint_hash);` (+ megfontolandó a teljes-JSONB-s `UNIQUE(email, subscription)` elhagyása).

### M5. FK-k ON DELETE nélkül — törlések futásidőben elszállnak
- `db/orders-client-link.sql:5` — `orders.client_id REFERENCES clients(id)`: az ügyfél törlése (`routes/clients.js:75-77`) FK-hibával elszáll, amint bármely fuvar hivatkozik rá. → `ON DELETE SET NULL`.
- `db/billing-integrations.sql:7` — `billing_integrations.company_id`: a `devCompanyDelete` elakad minden cégen, amely valaha számlázót konfigurált. → `ON DELETE CASCADE`. (Ugyanez átnézendő a `companies.subscription_plan_id`-nál.)

### M6. schema.sql elcsúszott a migrációktól — friss telepítés működésképtelen
A `schema.sql`-ből hiányzik minden újabb migráció tartalma: `billing_integrations`, `subscription_plans`, `here_feature_flags`, `here_usage_log`, `company_features`, `users.blocked`, `orders.finalized_at`, `orders.client_id`, a 11 jármű-routing-oszlop. Konkrétan: a login (`routes/auth.js:97`) a `blocked` oszlopot SELECT-eli — csak schema.sql-ből épített DB-n **senki nem tud belépni**.
**Javítás:** vagy minden `db/*.sql` befésülése a schema.sql-be, vagy az indulási guard (server.js:160-168 mintájára) futtassa le az összes idempotens migrációt.

### M7. `getMySoferOrders` — táblaméretű lateral scan a sofőr-kezdőképernyőn
`handlers/orders.js:114-118` — a `jsonb_exists(f.order_ids, o.id)` lateral minden fuvar-sorhoz **teljes `fuvarlevelek` seq-scant** futtat, az összes cégen át. Pár ezer menetlevélnél meredeken lassul — és ez a leggyakrabban hívott sofőr-nézet.
**Javítás:** `CREATE INDEX IF NOT EXISTS idx_fuvarlevelek_order_ids ON fuvarlevelek USING gin (order_ids);`

### M8. 2FA-ellenőrzésen nincs rate-limit — TOTP brute force
`routes/auth.js:303` — helyes jelszó után a `/api/2fa/verify` korlátlan próbálkozást enged (`window:2` ≈ 5 érvényes kód/próba, 6 jegyű tér).
**Javítás:** rate-limiter a `/api/2fa/verify` és `/api/2fa/setup-verify` végpontokra + N hiba után a pending-session zárolása.

### M9. `devStats` — hiányzó developer-jogosultság
`handlers/developer.js:305-318` — egyedüliként nem ellenőrzi az `is_dev` flaget; bármely bejelentkezett user lekérheti a globális cég/user/fuvar-statisztikát. **Javítás:** `is_dev` guard, mint a többi `dev*` handlernél.

### M10. Korlátlan feltöltési méret — memória/tárhely DoS
`server.js:102-103` — `express.json({limit:'50mb'})`, és a base64-feltöltő utak (`doc-upload`, `orderDocUpload`, `stampSave`, e-mail mellékletek) mezőnkénti sapka nélkül. Pár párhuzamos 50 MB-os kérés kifektetheti az 512 MB-os Render-példányt; a Gemini-be inline küldött PDF 20 MB felett garantált 400-as.
**Javítás:** globális limit ~15-20 MB-ra, mezőnkénti base64-sapka (a branding-logó ~4 MB-os mintája jó), mellékletméret-szűrés az intake-ben (10-15 MB), `compression()` middleware hozzáadása.

### M11. PWA-ikonok: rossz formátum és méret — telepítés/push-ikon törött
A `manifest.json` és minden hivatkozás az `/icon192.png`, `/icon512.png` fájlokra mutat — ezek azonban **JPEG-ek** (196×196 és 532×532), miközben a manifest `image/png` 192/512-t deklarál. A valódi, jó méretű PNG-k (`icon-192.png`, `icon-512.png`) **használaton kívül** állnak.
**Javítás:** a manifest + kód átirányítása a kötőjeles, valódi PNG-kre, a JPEG-duplikátumok törlése.

### M12. Tesseract OCR PDF-bufferre hívva — halott kód
`services/pdf-extract.js:21` — `tesseract.recognize(pdfBuffer, ...)`: a tesseract.js **nem tud PDF-et olvasni**, a hiba pedig `catch(_){}`-ben némán elnyelődik → a szkennelt PDF-ek AI-mentes feldolgozása csendben üres szöveget ad.
**Javítás:** PDF→kép renderelés előtte (pdfjs-dist), vagy a tesseract-út kivezetése azzal, hogy szkennelt PDF-hez AI-mód kell; a hibát mindenképp logolni.

---

## 🟡 KÖZEPES — tervezett javítás (1-2 hónapon belül)

| # | Hely | Probléma | Javítás |
|---|------|----------|---------|
| K01 | `lib/diurna.js:16-17` | Időzóna-hiba: UTC-s napi bontás — RO-ban (UTC+2/3) éjfél körüli határátlépés rossz naphoz kerül, ami az EXTERN/INTERN (≥12h) besorolást, azaz a **napidíjat** torzítja | Explicit Europe/Bucharest időzónás bontás + teszt |
| K02 | `routes/firebase.js:33` | Minden `/api/here-config` hívás fix **20 raster_tile tranzakciót** naplóz becslésként — ebből **valós EUR-számla** készül | Tényleges tile-darabszám mérése vagy konzervatívabb/átlátható elszámolás |
| K03 | `handlers/users.js:140,199` + `handlers/fleet.js:288` | `userUpdate`/`userDelete` WHERE-je csak email (cégszűrés csak elő-ellenőrzésben); `extDriverUpdate` UPDATE-je **cégszűrés nélkül** (ez utóbbi tényleges cross-tenant írás) | `AND company_id=$n` magára az UPDATE/DELETE-re |
| K04 | `handlers/users.js:118,191` | „Utolsó admin" védelem globálisan számol, nem cégenként | `AND company_id=$1` a COUNT-ba |
| K05 | `handlers/invites.js:100-103` | `invRevoke` cégszűrés nélkül vonja vissza a kódot | `AND company_id=$2` |
| K06 | `services/email.js:53,108,163` | Brevo-hívásokon nincs timeout — beragadt kapcsolat beragadt user-kérést jelent | `fetchT` minta a `services/billing/http.js`-ből (15s) |
| K07 | `services/email.js:23-46,117-137` | HTML-injektálás a kimenő e-mailekbe (cégnév/usernév/logoUrl escape nélkül) — phishing-vektor | HTML-escape minden interpolált értékre |
| K08 | `services/email-intake.js:139-142` | Hibás levél némán `Seen`-re jelölve és **elveszik** (DB-hiba esetén is) | Log + csak sikeres INSERT után Seen, vagy `status='error'` sor |
| K09 | `services/invoicing.js` + `services/billing/` | Két párhuzamos számlázó-rendszer: a fuvar-számlázás ma is a legacy FGO-úton megy; aki SmartBill-t állít be az új felületen, **nem tud fuvart számlázni** | Fuvar-számlázás átkötése a `services/billing/`-re, utána a legacy kivezetése |
| K10 | `services/billing/ifactura-adapter.js:27-31`, `facturis-adapter.js:34-36` | A testConnection hálózati hibánál is `ok:true`-t ad; a végpontok bevallottan találgatottak | Béta-jelölés + valódi API-séma ellenőrzés go-live előtt |
| K11 | `console-shared.js:1188` + `handlers/dashboard.js:164-166` | 30 mp-es GPS-polling dashboardonként, járművenként 1-1 upstream CargoTrack-hívással — 300 usernél rate-limit kockázat | 60-90s intervallum + szerver-oldali ~30s cache + object_id dedup |
| K12 | `handlers/orders.js:43-67` (`comList`) | Nincs LIMIT (a cég összes valaha volt fuvara) + a leg-aggregáló al-lekérdezés a teljes `order_legs`-et járja | LIMIT/lapozás + `LEFT JOIN LATERAL ... WHERE order_id=o.id` |
| K13 | `routes/soferApi.js:40-44` | N+1 a `/api/diurna-stats`-ban: sofőrönként egy teljes-történetes lekérdezés | Egy lekérdezés `ANY($1)` + 90 napos szűrés, JS-csoportosítás |
| K14 | `handlers/documents.js:153-158` és sofőr-listák | Sofőr-ági listákon nincs LIMIT | LIMIT + lapozás |
| K15 | `routes/clients.js`, `routes/uit.js`, stb. | Nyers `e.message` megy a kliensnek (belső részletek szivárgása), inkonzisztens a „Szerver hiba" mintával | Generikus üzenet + szerver-oldali log |
| K16 | `admin.js:741-749` (+manager) | `openOrderEdit` kétszer kéri le ugyanazt a fuvart, az első eredmény eldobva | A már lekért eredmény használata |
| K17 | `admin.js` ↔ `manager.js` | ~600 sor bájtra azonos duplikáció (order-szerkesztő modal, chat, aláírás, UIT/számla-dekoráció) — minden javítást kétszer kell elvégezni | A közös kód átemelése a `console-shared.js`-be |
| K18 | `public/feature-catalog.js:20-21` | A `billing` kulcs csak a manageren, az `integrations` csak az adminon létezik tabként — a developer-kapcsolók fele-fele hatástalan a másik szerepkörön | Kulcsok összehangolása / dokumentálása |
| K19 | `console-shared.js:735` és listabetöltők | `loadUsers/loadVehicles/loadInvites/loadExtDrivers` hibaág nélkül — hálózati hibánál néma, beragadt táblázat | catch + toast/üres-állapot |
| K20 | `console-shared.js:1043` | Firebase room-list listener (`ref.on('value')`) soha nincs leválasztva — hosszú munkamenetnél halmozódik | `off()` tárolása és hívása |
| K21 | statikus assetek | Nincs verziózás (`?v=hash`) a script-hivatkozásokon — deploy után a felhasználók elavult JS-t futtathatnak (a projekt „hard refresh"-re épít, a végfelhasználó nem fogja) | Build-hash query string a script tagekre |
| K22 | `routes/auth.js:101-110` | Login timing-oracle: nem létező email azonnal visszatér (felhasználó-felsorolás) | Dummy-hash összehasonlítás hiányzó usernél |
| K23 | `handlers/developer.js:39-40` | `parseInt` radix és véges-ellenőrzés nélkül → `NaN` a DB felé | A `fleet.js` `_intOrNull` helperének újrahasznosítása |

---

## 🟢 ALACSONY — kényelmi/hosszútávú

- **bcrypt cost 10** → idővel 12 (`routes/auth.js:74`, `handlers/auth.js:66`).
- **`authRegister` a `requireLogin` mögött** (`routes/execute.js:26`) — a publikus regisztráció így nem működhet; tisztázandó, szándékos-e.
- **Gemini API-kulcs query stringben** (`services/order-ai/gemini.js:66`) → `x-goog-api-key` header.
- **Halott kód:** `fetchJsonSafe` (`routePlannerHandlers.js:71-80`), `console-shared.js:498` utáni elérhetetlen blokk, `services/clients.js:57` mindig-igaz feltétel (`'RO'.startsWith('RO')` — valószínűleg `cui.startsWith('RO')` volt a szándék).
- **Duplikált helperek:** `monthLabelHu`/`round2` (herePool.js ↔ billingHandlers.js), `objectIdForRendszam` (3 helyen), order+leg INSERT blokk (orders.js ↔ inbound-orders.js).
- **Növekedés-higiénia:** `here_usage_log` (autocomplete-onként 1 sor), `bug_reports`, `border_crossings`, `client_emails` korlátlanul nőnek — éves archiválás/összegzés elég.
- **Redundáns index:** `idx_users_email` duplikálja a UNIQUE-ot — törölhető.
- **`fuvarlevelek`-en nincs `company_id`** — email-joinon át megy a cégszűrés; email-váltásnál törik. Oszlop + backfill megfontolandó.
- **Frontend apróságok:** hiányzó `lang="hu"` (a route-tervezőn kívül mindenhol), `user-scalable=no` (WCAG-ellenes), hardcoded színek a kártya-modulok saját `<style>`-jaiban (dark módban is fehér modálok — `clients-page.js`, `invoice-modal.js`, `cargotrack-*.js` stb.; az `email-intake-card.js` és `billing-card.js` a jó minta), `alert()/confirm()` a `toast()` helyett (`inbound-orders.js`, `invoice-modal.js`), 9 db `console.log` a `push-client.js`-ben, a developer-oldal saját gyengébb `escHtml`-je (nem escape-eli a `"`-t).
- **FGO timeout-üzenet** 15 mp-et mond, a konstans 20s (`services/fgo.js:11,39`).
- **Oblio token-cache** hiánya (műveletenként új OAuth-token) — volumen-növekedésnél érdemes.
- **render.yaml:** nincs explicit `plan` — Starter (512 MB) az alapértelmezés; OCR + nagy bodyk mellett memóriafigyelés kell, vagy az OCR kivétele a kérés-útvonalból.

---

## ✅ Amihez NEM kell hozzányúlni

Ezek a részek átvizsgálva **rendben vannak, 300 felhasználóra elegendőek** — fölösleges (és kockázatos) lenne piszkálni őket:

**Biztonsági alapok**
- **SQL-paraméterezés** — mindenhol `$n` paraméterek, a dinamikus UPDATE-ek fix allowlistből építik az oszloplistát. SQL injection sehol.
- **`lib/crypto.js`** — AES-256-GCM helyesen: üzenetenként random 12 bájtos IV, auth tag ellenőrzés, 32 bájtos kulcs kikényszerítve.
- **Session/cookie** — `httpOnly`, `sameSite:lax`, `secure` élesben, szerver-oldali store (connect-pg-simple, auto-prune + expire index), `trust proxy`, 7 napos maxAge.
- **Jelszó-reset** — 32 bájtos random token, 1 órás lejárat, enumeráció-mentes válasz, token törlés használatkor.
- **Titkok kezelése** — semmilyen API-kulcs nincs kliens-kódban; HERE/Firebase/GPS/számlázó kulcsok hitelesített proxykon át, titkosítva tárolva, maszkolva visszaadva, FGO-kulcs megőrzése újramentéskor.
- **Helmet/CSP, HSTS, rate-limit** a loginon és a forgot-passwordön.
- **Multi-tenant szűrés a handlerek nagy többségében** — orders, vehicles (egy kivétellel), clients, invoices, uit, inbound-orders, client-mail, cargotrack, dashboard, route-planner mind a session-ből vett `company_id`-vel szűr.

**Adatbázis és skálázás**
- **`document_series` sorszámozás** — az atomikus `INSERT ... ON CONFLICT DO UPDATE current_seq+1 RETURNING` párhuzamosság-biztos (csak a K6-os prefix-setter rontja el).
- **Indexek** — a cégszűrős lekérdezési minták (orders, users, vehicles, clients, invites, order_legs, order_documents, inbound_orders, order_uit_codes, invoices, here_usage_log, push_subscriptions) mind indexeltek és illeszkednek a tényleges lekérdezésekhez.
- **Listavégpontok többsége korlátozott** (50–200-as LIMIT-ek).
- **Session-store karbantartás** automatikus.

**Szerver-oldali modulok**
- `middleware/auth.js` / `pageGuard.js`, `handlers/hereFeatureHandlers.js` (példaszerű validáció), `routes/cargotrack.js`, `routes/clients.js` (a hibaüzenet-szivárgáson kívül), a `handlers/fleet.js` `_intOrNull/_numOrNull/_enumOrNull` helperei (mintaként újrahasznosítandók), `lib/hereUsage.js`.

**Szolgáltatások/integrációk**
- **`services/billing/http.js`** — tiszta AbortController-es timeout, mind a 4 REST-adapter használja, 401/403/429 emberi üzenetekre fordítva.
- **`services/cargotrack.js`** és a GPS-adapterek — timeout, státuszkód-fordítás, okos friss-pozíció keresés.
- **`services/order-ai/gemini.js`** — modell-lánc failover 429-re, retry szerver-javasolt késleltetéssel, garantált heurisztikus fallback (AI-leállás nem veszít megrendelést).
- **`services/push.js`** — `Promise.allSettled` + lejárt feliratkozások automatikus takarítása; `webpush.js` kecses degradáció.
- **E-mail intake architektúra** — a 3 fázisú terv (gyors IMAP fetch → offline feldolgozás → rövid visszacsatlakozás flagelésre) jó; ImapFlow error-listener kivédi a process-crasht; nincs kapcsolat-szivárgás.
- **Scheduler hibaizolációja** — cégenkénti try/catch (egy cég rossz credentialje nem állítja le a kört); csak az átfedés-őr hiányzik (M3).

**Frontend**
- **Az újabb kártya-modulok** (`inbound-orders.js`, `clients-page.js`, `client-picker.js`, `uit-panel.js`, `cargotrack-*.js`, `client-mail.js`) következetesen escape-elnek — XSS-biztosak.
- **`session-guard.js`** — jól megépített: egy interval, idle-figyelmeztetés, tab-szinkron, nincs szivárgás.
- **`sw.js` fetch-stratégia** — helyes: nem-GET/API/cross-origin kihagyva, push + notificationclick + pushsubscriptionchange rendben (csak az ikon-útvonal hibás, M11).
- **`invoice-modal.js` dupla-küldés védelem**, a **dashboard-térkép életciklusa** (re-init guard, ResizeObserver flagekkel, timer-takarítás), a **`cargotrack-map.js`** takarítása, a **2FA login-flow**, a **reszponzív CSS** (dashboard-töréspontok, sofőr app-shell `dvh` + safe-area) — mind rendben.
- **Dizájn-token rendszer** (`style.css` `:root` változók, light-téma felülírások a shell-komponensekre) — jó alap, csak a kártya-modulok nem használják (alacsony prioritás).

---

## Javítási sorrend a 300 fős induláshoz

**0. blokk — indulás előtt kötelező (becslés: 2-4 nap):**
1. K1 + K2 + K3 — a három adatszivárgó végpont lezárása (pár soros javítások).
2. K5 — pool error-handler + dispatcher try/catch + unhandledRejection (stabilitás).
3. K4 — CMD/FUV azonosító-generálás cseréje (garantált hiba ~100 rekordnál).
4. K6 — sorszám-nullázás megszüntetése (1 soros SQL-javítás).
5. M4, M5, M6 — push-index, FK ON DELETE-ek, schema/migráció-szinkron (csendes, de biztos hibák).
6. M9 — `devStats` guard (1 sor).

**1. blokk — első 2 hét élesben:**
7. K7 — XSS-escape végigvezetése a legacy render-függvényeken + soferApi HTML.
8. M1, M2 — tranzakciók + dupla-számla unique index.
9. M3, M8, M10, M11, M12 — scheduler-őr, 2FA rate-limit, méretsapkák, PWA-ikonok, OCR-út.
10. M7 — GIN index a `fuvarlevelek.order_ids`-re.

**2. blokk — első 1-2 hónap:** a KÖZEPES lista, kiemelten K01 (napidíj-időzóna), K02 (HERE-elszámolás valódisága), K09 (számlázó-rendszerek egyesítése), K11 (GPS-polling), K17 (admin/manager duplikáció felszámolása).

**Tesztelési adósság:** a meglévő 5 tesztfájl csak a crypto/diurna/login/dispatcher alapokat fedi. Az új tesztek prioritása: (1) dokumentum-végpontok jogosultság-tesztjei (K1-K3 regresszió ellen), (2) sorszámozás párhuzamossági teszt, (3) `userUpdate` jogosultsági mátrix (utolsó admin, Manager-korlátok, cross-tenant), (4) `herePool.computePool` számlázási matek, (5) diurna többnapos/időzónás esetek.
