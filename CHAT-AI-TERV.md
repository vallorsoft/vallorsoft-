# 💬 AI-chat 2.0 — a teljes rendszer irányítása chatből (kidolgozás)

> Állapot: **TERV** (2026-10-09). Még nincs implementálva. A cél: az admin/manager
> konzol MINDEN funkcióját, menüpontját és gombját a chatből, természetes nyelven
> lehessen használni — úgy, hogy a biztonsági szabályok (multi-tenant, szerep,
> ✅-megerősítés, „az AI nem lát dokumentumot / személyes adatot") megmaradjanak.

---

## 1. Miért nem érti most sok mindent? (diagnózis)

A mostani chat (`handlers/orderChat.js` → `lib/chatOps.js` → `lib/driverInfo.js` →
AI-vázlat) **kézzel írt regex-láncra** épül:

```
detectDocUpload → detectOrderView → detectMessage → detectContact → detectSmallTalk
→ detectSuggest → detectQuote → detectBulk → detectFocusFollowUp → detectAction
→ detectCompany → (driverInfo) → (mailChat) → AI új-fuvar vázlat
```

Ebből következő korlátok:

| # | Probléma | Következmény |
|---|----------|--------------|
| 1 | Csak ~15 szándék ismert (fizetés, státusz, dátum, ár, kiosztás, posta, tömeges, ajánlat, elérhetőség, lista, sofőr-infó, e-mail, dok-feltöltés). | A rendszer ~420 RPC-funkciójából kb. **25 érhető el** chatből. Járművek, lejáratok, szerviz, raktár, ügyfelek, alvállalkozók, számlák, menetlevelek, sofőr-elszámolás, kalkulátor, dok-nyilvántartás, beállítások — **semmi**. |
| 2 | A regexek szó-alapúak (`fold()` + `\b(postaz\w*|…)\b`). | Elírás, szinonima, más szórend, kevert HU/RO mondat, hosszabb körülírás → nem illeszkedik. |
| 3 | Az első találó detektor nyer (sorrend-függő lánc). | Egy mondatban két kérés („zárd le a 0042-t és küldd el a számlát Bilkának") → csak az egyik fut le. |
| 4 | Ami egyik detektorra sem illik, az **új-fuvar AI-vázlatba** esik. | A gép „fuvar-kiírásnak" értelmez egy teljesen más kérést (ez a legzavaróbb hiba). |
| 5 | Nincs „nem értem — erre gondoltál?" visszakérdezés. | A felhasználó nem tudja, mit rontott el; nincs tanulási visszacsatolás. |
| 6 | Nincs navigáció: a chat nem tud oldalt/modalt megnyitni. | „Nyisd meg a 0042 szerkesztőjét" / „mutasd a tervezőtáblát" nem működik. |

**Következtetés:** a regex-láncot nem bővíteni kell tovább detektoronként (420 funkcióra ez
fenntarthatatlan), hanem egy **egységes képesség-katalógusra (tool-registry) + AI-szándékfelismerésre**
kell átállni, ahol a meglévő determinisztikus logika gyors előszűrőként megmarad.

---

## 2. Célkép — mit tudjon a chat

### 2.0 Hatókör (eldöntve, 2026-10-09)

A chat-irányítás **az Admin és a Manager felületen** él (`/admin`, `/manager` — a meglévő 💬 lebegő
gomb minden fülön). A **sofőr** (`/sofer`), a **könyvelő**, az **ügyfél-** és az **alvállalkozói
portál**, valamint a **developer** felület **nem** kap chat-irányítást.

Szerep szerinti különbségek — a chat mindig pontosan azt engedi, amit a felület:

| | Admin | Manager |
|---|---|---|
| Fuvar, flotta, sofőr, ügyfél, alvállalkozó, dokumentum, levelezés, kalkulátor | ✅ | ✅ |
| Pénzügyi számok (bevétel, kintlévőség, árrés, eredmény) | ✅ | csak `stats_finance` joggal |
| Fuvar törlése | ✅ | csak `orders_delete` joggal |
| Számla kiállítása / storno | ✅ | csak `invoice_issue` joggal |
| Felhasználók kezelése, meghívó | ✅ | csak `users_manage` joggal |
| Integrációk, Jogosultságok, cég-beállítások írása, cél-értékek, időzített riport | ✅ | ❌ (nem is kínálja fel) |

A katalógus minden képessége `roles` + opcionális `perm` (granulált jog, `handlers/permissions.js`
`hasPerm`) mezőt kap; az AI-hoz CSAK a bejelentkezett felhasználónak elérhető képességek sémái
mennek, így a Manager nem is kap javaslatot olyanra, amit nem tehet meg. A végső kapu
változatlanul a meglévő handler.

1. **Bármit megkérdezni** (olvasás): „hány fuvar van úton?", „mikor jár le a B104VLR ITP-je?",
   „mennyivel tartozunk Gondos Imrének?", „mi a kintlévőség Bilkánál?", „mennyi volt a szeptemberi
   átlagfogyasztás?".
2. **Bármit végrehajtani** (írás, mindig ✅-re): fuvar kiírás/szerkesztés/törlés/visszaállítás,
   kiosztás, státusz, áru-leadás, raktár; jármű/sofőr/ügyfél/alvállalkozó felvétele és módosítása;
   lejárat/szerviz rögzítés, halasztás, „elvégezve"; járandóság + kifizetés; számla kiállítás/storno;
   menetlevél szerkesztés; dok-sorszám foglalás; e-mail küldés; meghívó; beállítás-váltás…
3. **Navigálni** (UI-parancs): „nyisd meg…", „mutasd…", „ugorj a…" → a chat a megfelelő fület /
   modalt nyitja meg, előtöltve.
4. **Több lépést egyben**: „Írd ki Arad → Győr 1200 EUR-ért holnapra, add Gondosnak és küldd el a
   megbízást e-mailben" → egy **terv-kártya** 3 lépéssel, egy ✅-vel (vagy lépésenként).
5. **Visszakérdezni** hiányzó/kétértelmű adatnál gombokkal, és **mondani, ha nem tudja** (soha nem
   esik bele csendben a fuvar-vázlatba).
6. **Visszavonni**: „vond vissza az előzőt" → az utolsó chat-művelet inverze (ahol értelmezhető).

---

## 3. Architektúra

```
 felhasználó szövege (+ előzmény, + aktuális fül/fuvar a kliensről)
        │
        ▼
 ┌─────────────────────────────┐   1) gyors út: determinisztikus felismerők
 │  Router (lib/chatRouter.js) │      (a mostani chatOps/driverInfo — megmarad)
 └─────────────┬───────────────┘   2) ha nincs biztos találat → AI szándék-osztályozó
               ▼
 ┌─────────────────────────────┐   az AI CSAK a képesség-katalógus sémáit kapja
 │  AI tervező (Gemini, JSON)  │   (név + leírás + paraméter-séma), cég-adatot NEM
 └─────────────┬───────────────┘   → kimenet: [{tool, args}] lépés-lista + kérdések
               ▼
 ┌─────────────────────────────┐   minden lépésre: szerep-kapu, feature-flag,
 │  Validátor + feloldó        │   arg-fehérlista, nevek → id feloldás SZERVEREN
 └─────────────┬───────────────┘   (sofőr, rendszám, ügyfél, fuvarszám, dátum, pénz)
               ▼
   olvasó tool → azonnal fut, kártya       író tool → előnézet-kártya + aláírt token
   UI tool → kliens-parancs (activateTab…)          ✅ → executeAction → meglévő handler
```

### 3.1 Képesség-katalógus (`lib/chatTools/`)

Egyetlen igazságforrás, domainenként egy fájl (`orders.js`, `fleet.js`, `finance.js`, …).
Minden képesség **a meglévő handlert hívja** (`callH` mintán, ugyanazzal a `req`-gel) — nincs
párhuzamos üzleti logika.

```js
{
  name: 'expiry.add',                       // egyedi név
  domain: 'fleet',
  kind: 'write',                            // 'read' | 'write' | 'ui' | 'danger'
  roles: ['Admin', 'Manager'],
  perm: null,                               // pl. 'orders_delete' — Managernél kötelező granulált jog
  feature: 'expiries',                      // feature-catalog kulcs (csomag-kapu)
  desc: { hu: 'Lejárat rögzítése járműhöz / sofőrhöz', ro: 'Adaugă scadență…' },
  examples: { hu: ['a B104VLR ITP-je jövő márciusban jár le'], ro: ['ITP B104VLR expiră în martie'] },
  params: {                                 // JSON-séma — EZT kapja az AI
    target: { type: 'vehicle|driver', required: true },
    doc_type: { type: 'enum', values: ['itp','rca','rovinieta','tahograf', …] },
    expires_at: { type: 'date', required: true },
  },
  resolve: async (ctx, args) => {…},        // név→id, rendszám-normalizálás, validálás
  preview: (ctx, resolved) => rows,         // kártya-sorok (régi → új érték)
  run: (ctx, resolved) => callH(fc.expirySave, ctx.req, [ … ]),
  undo: (ctx, result) => callH(fc.expiryDelete, ctx.req, [result.id]),  // opcionális
  ui: { tab: 'expiries' },                  // „mutasd" esetén ide navigál
}
```

Közös paraméter-típusok (egyszer megírva, mindenhol használva): `order` (fuvarszám / rövid szám /
„ez a fuvar"), `driver`, `vehicle`, `trailer`, `client`, `carrier`, `date`, `period`, `money`,
`plate`, `email`, `enum`. A feloldók a mostani `findOrder` / `findEntity` / `findClient` /
`moneyIn` / `dateIn` / `monthScope` függvényekből készülnek (kiemelve `lib/chatResolve.js`-be).

### 3.2 AI szándék-osztályozó / tervező

- **Bemenet az AI felé**: a felhasználó szövege + rövid előzmény + az aktuálisan **szerepnek és
  csomagnak megfelelő** tool-sémák (csak név/leírás/paraméter/példák) + a felület kontextusa
  (melyik fül van nyitva, melyik fuvar van fókuszban — csak azonosító, nem tartalom).
- **Nem kap**: cég-listát (sofőrnevek, ügyfelek, rendszámok), fuvar-adatot, dokumentumot, e-mailt —
  ugyanúgy, mint ma. A nevek a szerveren oldódnak fel.
- **Kimenet (JSON)**: `{ steps: [{tool, args}], ask: [{param, question, options?}], confidence }`.
- **Két lépcső a költség miatt**: (1) olcsó domain-osztályozás (≈10 domain), (2) csak az adott
  domain tool-sémái mennek a második hívásba → kisebb prompt, kevesebb tévedés.
- A meglévő `lib/geminiJson.js` modell-láncát használja (429/503/404 → következő modell).
- A Gemini natív **function calling**-ja is opció; a JSON-kimenet + saját validálás elég és
  modell-független.

### 3.3 Biztonsági szabályok (változatlanul érvényesek)

1. **Minden írás ✅-re**, HMAC-aláírt, 15 perces, user+cég-hez kötött tokennel (a mai
   `signAction`/`verifyAction`). A token a **feloldott** argumentumokat tartalmazza, végrehajtáskor
   újra-validálunk (cég-tagság, státusz).
2. A végrehajtás **mindig a meglévő handleren** megy → szerep-kapu, `company_id`-szűrés, audit,
   csomag-limit ott már bent van. A chat nem kerülhet meg semmit.
3. `kind:'danger'` (törlés, storno, tömeges >20 elem, GDPR anonimizálás, felhasználó letiltása,
   számla kiállítás) → **dupla megerősítés** (beírandó „IGEN"/fuvarszám), és nem fűzhető láncba.
4. Az AI **nem** kap dokumentumot, levéltartalmat, személyes adatot (CNP, telefon, e-mail, GPS) —
   a válasz-kártyát a szerver rendereli.
5. Developer-funkciók (`handlers/developer.js`) és jogi oldalak szerkesztése **kimarad** a chatből.
6. Audit: `order.chat_action` → általános `chat.action` (tool-név + entitás-id, tartalom nélkül).
7. Rate-limit a chat-végpontra (csúszóablak, mint a `translate`-nél).

### 3.4 UI-parancsok (navigáció)

A válasz `ui` mezőt kaphat, amit a kliens (`public/order-chat.js`) végrehajt:

```js
{ ui: { op: 'tab', tab: 'orders-planner' } }
{ ui: { op: 'openOrder', id: 'CMD-…' } }        // openOrderEdit
{ ui: { op: 'openPostDelivery', id: … } }       // vsPostDeliveryOpen
{ ui: { op: 'filter', tab: 'orders-list', chip: 'unpaid', month: '2026-09' } }
{ ui: { op: 'prefill', form: 'orders-form', values: {…} } }   // a wizard előtöltése
```

Fehérlistás `op`-ok + `data-tab` értékek (a `feature-catalog.js`-ből) → a kliens csak ismert
parancsot hajt végre. A chat-ablak navigálás után nyitva marad (mobilon összecsukódik egy buborékká).

### 3.5 Többlépéses terv

- Az AI több lépést adhat; a szerver mindegyiket validálja, és **egy terv-kártyát** mutat
  (lépésenként: mit csinál, előtte/utána).
- A lépések függhetnek egymástól (`$1.order_id` → az első lépés eredménye).
- ✅ „Mind" vagy lépésenkénti ✅/✖. Hibánál megáll, a már lefutott lépések listája látszik.
- `danger` lépés nem lehet terv része.

### 3.6 „Nem értettem" + tanulás

- Ha a bizalom alacsony vagy egy kötelező paraméter hiányzik → **visszakérdez gombokkal**, soha nem
  esik bele csendben az új-fuvar vázlatba. Az új-fuvar vázlat CSAK akkor indul, ha a szándék
  kifejezetten `order.create`.
- „Erre gondoltál?" — a 3 legvalószínűbb képesség gombként.
- **Félreértés-napló** (opcionális, cégenként kapcsolható, 30 napos megőrzés): a fel nem ismert
  mondat + amit a felhasználó végül választott → a **🧠 Tanult adatok** fülön látszik/törölhető,
  és cégenkénti példa-mondatként visszakerül az osztályozó promptjába (few-shot, mint a bon-scan).
- Fejlesztői oldalon ugyanezek (anonimizálva, cég nélkül) adják a **regressziós korpuszt**.

### 3.7 Visszavonás

`chat_action_log` (cég, user, tool, entitás, előtte/utána snapshot csak a módosított mezőkre,
időbélyeg). „Vond vissza" → az utolsó saját, visszavonható művelet `undo`-ja, szintén ✅-re.
Nem visszavonható (pl. elküldött e-mail, kiállított számla) → a kártya ezt előre jelzi.

---

## 4. Lefedettség — domainenkénti képesség-lista

Jelölés: 🔎 olvasás · ✏️ írás (✅) · ⚠️ veszélyes (dupla ✅) · 🧭 navigáció · ✔️ már működik.

### 4.1 Fuvarok (`orders.js`, `orderPostDelivery.js`, `handover.js`, `orderTemplates.js`, `quotes.js`)
- ✔️ fuvar adatlap, dokumentum-állapot, listák (aktív/kiosztásra váró/lezárt/kifizetetlen)
- ✔️ ✏️ státusz, dátum, ár, kiosztás sofőrre/rendszámra, fizetés, posta/számlaszám, tömeges
- ✏️ új fuvar (meglévő AI-vázlat, de csak explicit szándékra), több fel-/lerakó pont
- ✏️ bármely mező módosítása (cím, cég, súly, FTL/LTL, méret, referencia, megjegyzés, NC-kód, UIT)
- ✏️ köztes megálló hozzáadása / sorrend módosítása
- ✏️ pótkocsi-csere, alvállalkozóra adás (+ alvállalkozói díj → árrés)
- ⚠️ törlés, ✏️ visszaállítás törölt fuvarból, ✏️ lezárás visszavonása (`resetOrderMilestones`)
- ✏️ áru-leadás (parkolt / raktárba), leadás-kérés jóváhagyása/elutasítása
- ✏️ sablon mentése / „ismételd meg a tegnapi Bilka fuvart"
- ✏️ árajánlat → fuvar konverzió; 🔎 ajánlatok listája
- ✏️ megbízás (Comanda de Transport) generálása + e-mail alvállalkozónak
- 🔎 útdíj-becslés, km-becslés („mennyi Arad–Győr kamionnal?")
- 🧭 tervezőtábla, visszfuvar-radar („ki tudja hozni a 0042-t?" — `getPlannerMatches`)
- ✏️ beérkező (e-mail/portál) kérés elfogadása / elvetése

### 4.2 Flotta (`fleet.js`, `fleetCompliance.js`, `entityDetail.js`)
- 🔎 jármű-adatlap, élő pozíció („hol van a B104VLR?"), km, üzemanyag, akkumulátor
- ✏️ jármű felvétele / módosítása (rendszám, típus, fogyasztás, tartály-korrekció)
- ✏️ sofőr↔vontató, vontató↔pótkocsi párosítás
- 🔎/✏️ lejáratok (ITP/RCA/rovinieta/tahográf/ADR…): listázás, rögzítés, módosítás
- 🔎/✏️ szerviz: esedékesek, rögzítés, halasztás, „elvégezve" pipált tételekkel
- 🔎 üzemanyagkártya-eltérések, fogyasztási anomáliák
- 🧭 aktív flotta térkép, GPS napi útvonal

### 4.3 Sofőrök (`users.js`, `driverActivity.js`, `fleetCompliance.js` decont)
- ✔️ 🔎 hol tart, tankolás, fogyasztás, határ, menetlevél, ki van úton
- 🔎 sofőr-aktivitás (fotók, események) összefoglalója
- ✏️ járandóság felvétele („Gondosnak 6 nap diurna 70 euró"), napok kijelölése
- ✏️ kifizetés (részleges/teljes, EUR/RON, BNR), ütemezett kifizetés
- 🔎 hátralék, „mit fedez" a kifizetés; 🧭 Decont lunar / oficial / sumar megnyitása, nyomtatás
- ✏️ alapbér, személyes adatok (szerződésszám — CNP NEM megy AI-ba, csak kártyán írható be)
- ✏️ meghívó küldése új sofőrnek; ⚠️ letiltás

### 4.4 Ügyfelek és alvállalkozók (`clients` REST, `carriers.js`, `clientPortal.js`)
- 🔎 ügyfél-profil, kintlévőség, fizetési szokás
- ✏️ új ügyfél CUI-ból (ANAF), módosítás, fizetési határidő
- ✏️ portál-meghívó küldése / letiltása
- ✏️ alvállalkozó felvétele (ANAF), csoport, jármű + GPS-link
- 🔎/✏️ bejövő (AP) számla rögzítése, fizetve jelölés, öregítés

### 4.5 Pénzügy és számlázás (`invoices` REST, `paymentSchedule.js`, `bnr.js`, `statisticsHandlers.js`)
- 🔎 kimenő/bejövő számlák, fizetési ütemterv, BNR árfolyam, fuvar-szintű eredmény
- ⚠️ számla kiállítása fuvarból (a cég számlázó-szolgáltatóján), ⚠️ storno
- 🔎 kintlévőség, árrés, havi bevétel

### 4.6 Dokumentumok (`documents.js`, `orderDocs.js`, `documentRegister.js`, `ecmr.js`, `pdfWorkspace.js`)
- ✔️ dokumentum feltöltése fuvarhoz (a fájl a felületen töltődik fel, nem AI-hoz)
- 🔎 „hiányzik a CMR a 0042-ről?", hiányzó menetlevelek
- ✏️ menetlevél mező-javítás, átkötés másik sofőrre; ⚠️ menetlevél törlése
- ✏️ sorszám foglalása a dokumentum-nyilvántartásban („adj egy számot a FCT mappából")
- ✏️ e-CMR létrehozása; 🧭 aláírás/pecsét munkatér

### 4.7 Statisztika (`statsV2.js`, `statsInsights.js`, `statsReports.js`)
- 🔎 bármely KPI időszakra („mennyi volt a bevétel szeptemberben, előző évhez képest?")
- 🔎 anomália-központ („mi a legfontosabb teendő ma?")
- ✏️ cél-érték beállítása, időzített riport felvétele
- 🧭 adott fül + időszak + szűrő megnyitása

### 4.8 Levelezés (`mailChat.js`, `mailbox.js`, `orderEmail.js`, `emailTemplates.js`)
- ✔️ levél fuvarról / általános levél, válasz, sablon, kinézet
- 🔎 „jött levél a Bilkától?" (csak fejléc), 🧭 levél megnyitása

### 4.9 Költség-kalkulátor (`costCalculator.js`)
- 🔎 „mennyibe kerül Arad–Lyon a B104VLR-rel 3 nap alatt?" → kalkuláció futtatása, mentése
- ✏️ költség-tétel felvétele járműhöz/sofőrhöz/céghez

### 4.10 Beállítások / adminisztráció (`companySettings.js`, `permissions.js`, `notifications.js`)
- 🔎 értesítések, mail-napló
- ✏️ cégadatok, fuvar-sorozat, kedvenc helyszín, Manager-jogosultság (csak Admin)
- Kimarad: jelszó, 2FA, integrációs kulcsok, GDPR anonimizálás, előfizetés-lemondás (csak felületen)

---

## 5. Felület (UX)

- **Kártya-típusok** egységesítve: `info` (olvasás), `action` (előtte → utána, ✅/✖),
  `plan` (több lépés), `ask` (gombos visszakérdezés), `nav` („Megnyitottam: Tervezőtábla").
- **Kontextus-tudatosság**: a kliens minden körben elküldi a nyitott fület és a kijelölt fuvarokat
  → „ezeket zárd le" a kijelölt sorokra vonatkozik.
- **Gyors-javaslatok** a beviteli mező felett, a nyitott fülhöz illően (pl. Lejáratok fülön:
  „Mi jár le 30 napon belül?").
- **`/` parancsok** haladóknak: `/fuvar 0042`, `/jármű B104VLR`, `/sofőr Gondos`.
- **Diktálás** (már van 🎤) + felolvasás opcionálisan (vezetés közben a sofőr-oldalon később).
- A chat **minden fülön** elérhető (már van 💬 FAB), és megjegyzi a beszélgetést fül-váltáskor.

---

## 6. Ütemterv (fázisok, mind külön PR)

| Fázis | Tartalom | Eredmény |
|------|----------|----------|
| **0 — Diagnózis** | A „nem értette" mondatok összegyűjtése (a felhasználótól + napló) → korpusz `tests/chat-corpus/*.json` (mondat → várt tool + args). Jelenlegi találati arány mérése. | Mérhető kiinduló pont |
| **1 — Váz** | `lib/chatTools/` katalógus + `chatResolve.js` (feloldók kiemelése) + `chatRouter.js`. A mai ~15 művelet átköltöztetése tool-formára, viselkedés-változás nélkül. „Nem értettem → erre gondoltál?" a fuvar-vázlatba esés helyett. | Ugyanaz tud, de bővíthető; nincs csendes félreértés |
| **2 — AI-szándék** | Kétlépcsős AI-osztályozó a katalógus sémáin; determinisztikus gyors út elöl marad. Korpusz-teszt a CI-ben. | A szórend/elírás/kevert nyelv már nem gond |
| **3 — Navigáció** | `ui` parancsok, kontextus küldése, gyors-javaslatok. | „Nyisd meg…", „mutasd…" |
| **4 — Fuvar + Flotta teljes** | 4.1 + 4.2 összes tool | A napi diszpécser-munka 80%-a chatből |
| **5 — Sofőr-elszámolás + Pénzügy** | 4.3 + 4.5 (danger kezeléssel) | Járandóság, kifizetés, számla chatből |
| **6 — Többlépéses terv + visszavonás** | `plan` kártya, `chat_action_log`, `undo` | Összetett kérések egy mondatban |
| **7 — Maradék domainek** | 4.4, 4.6–4.10 | Teljes lefedettség |
| **8 — Tanulás** | Félreértés-napló, cégenkénti few-shot, Tanult adatok fül bővítés | Cégre hangolt megértés |

Minden fázis végén: `npm test` zöld + korpusz-arány ≥ előző fázis, CHANGELOG / CLAUDE.md / AUDIT.md
frissítés (ELSŐ SZABÁLY 6. pont), Fly.io deploy.

---

## 7. Tesztelés és minőség

- **Korpusz-teszt** (`tests/chat-corpus/`): HU + RO + kevert mondatok, elírásokkal; minden
  tool-hoz legalább 10 mondat. Mock-AI módban a determinisztikus út, valós-AI módban (kulccsal,
  nem CI-ben) a teljes út mérhető. Cél: ≥95% helyes tool + args.
- **Biztonsági tesztek tool-onként**: idegen cég entitása → elutasítás; Sofer szerep → nincs
  hozzáférés; kikapcsolt feature → nem kínálja fel; lejárt/hamis token → elutasítás.
- **Regresszió-őr**: minden tool `run`-ja a registry-ben létező handlert hív (mint a mai
  duplikált-handler őr-teszt).
- **Költség-figyelés**: AI-hívás / chat-kör számláló cégenként; a determinisztikus találatok
  aránya a cél (minél több AI nélkül).

---

## 8. Kockázatok

| Kockázat | Kezelés |
|----------|---------|
| AI rossz toolt választ | Minden írás előnézet + ✅; alacsony bizalomnál visszakérdez |
| AI kitalál argumentumot (nem létező sofőr/rendszám) | Feloldás csak szerveren; ismeretlen név → visszakérdez listával |
| Prompt-injekció (pl. ügyfélnév vagy fuvar-megjegyzés szövegében) | Az AI nem kap cég-adatot; a tool-választás után a szerver validál; danger nem láncolható |
| Gemini kvóta / kiesés | Determinisztikus gyors út + modell-lánc; kiesésnél „most csak egyszerű parancsok működnek" |
| Túl nagy prompt 420 tool-lal | Kétlépcsős domain-szűrés; csak a szerepnek/csomagnak elérhető tool-ok |
| Felhasználó véletlenül jóváhagy | Danger dupla ✅, visszavonás, audit |

---

## 9. Nyitott kérdések (döntés kell)

1. **Mely félreértések a legfontosabbak?** A képernyőkép nem érkezett meg — kérem újra, vagy a
   félreértett mondatokat szövegként; ezek lesznek a korpusz első elemei és a Fázis 1 prioritásai.
2. **Sorrend**: Fuvar + Flotta először (javaslat), vagy a Sofőr-elszámolás?
3. **Félreértés-napló**: szabad-e cégenként (kapcsolhatóan, 30 napig) tárolni a fel nem ismert
   mondatokat a tanuláshoz?
4. **Számla kiállítás / storno chatből**: engedjük (dupla ✅-vel), vagy maradjon csak felületen?
5. **Csomag**: a teljes chat-irányítás a Pro csomagtól (`ai-szoveges-fuvar`), vagy új kulcs
   (`ai-asszisztens`) külön árazással?
6. ~~Sofőr-oldal~~ — **eldöntve:** csak az Admin és a Manager felület (lásd 2.0).
