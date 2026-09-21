# Sofőr felület — átvizsgálás (2026-09-21)

> **STÁTUSZ: az 1–4. hiba JAVÍTVA** (ugyanezen a napon, a feltárás utáni commitban).
> Az 5–6. pont szándékosan megfigyelés maradt. A javítások részletei a
> `CHANGELOG.md` 2026-09-21-i bejegyzésében; a biztonsági vonatkozás az
> `AUDIT.md` 21. lépésében. Regresszió-védelem:
> `tests/integration/sofer-ui-fixes.test.js` (+11 eset), **1281 Jest zöld**.

Átvizsgált fájlok: `public/sofer.html`, `public/sofer.js` (6330 sor), `public/sofer.css`,
`public/sofer-uit.js`, `public/uit-format.js`, `routes/soferApi.js`,
`handlers/receiptScan.js`, `handlers/documents.js` (sofőr-érintett részek).

**Kiindulási állapot:** a teljes Jest-suite ZÖLD (1270 teszt / 77 suite, 45 valós-DB skip).
Szintaxis-hiba nincs; nincs bekötetlen `onclick`; nincs hiányzó i18n-kulcs
(347 sofőr-kulcs mind megvan RO+HU-ban); nincs duplikált függvény-definíció.
A megtalált hibák tehát mind **futásidejű / viselkedési** hibák, amiket a
meglévő tesztek nem fednek le.

---

## 1. HIBA — Az áru-/tankolás-sorok NEM escape-elik a beírt értéket (adatvesztés + injekció)

**✅ JAVÍTVA** — `esc(...)` mind a kilenc `value="…"` interpolációra (`sofer.js` `addAlimRow`/`addAchRow`).

**Hol:** `public/sofer.js` `addAlimRow()` 2603–2613. sor, `addAchRow()` 2630–2634. sor.

**Mi a baj:** a mezők értéke escape-elés nélkül kerül a `value="..."` attribútumba:

```js
'... value="' + (a.loc || '') + '" oninput="draftSave()">'      // 2603
'... value="' + (a.produs || '') + '" oninput="draftSave()">'   // 2630
```

Ha az érték **idézőjelet** tartalmaz, az attribútum ott elvágódik: a helyszín/termék
neve csonkul (a sofőr adata elveszik egy pénzügyi bizonylatról), a maradék pedig
kósza HTML-attribútumként értelmeződik.

**Mikor fordul elő a gyakorlatban:** a 📷 **AI bon-kiolvasás** (`rrAccept` →
`addAlimRow(f)` / `addAchRow(f)`) a Gemini által a bonról leolvasott `loc`/`produs`
szöveget adja át. A szerver `_sanitize`-ja fehérlistáz, de **nem escape-el**.
Egy `MOL "Vest"` jellegű töltőállomás-név elég hozzá. Ugyanez a piszkozat
visszatöltésekor (`draftRestore`) és kézi bevitelnél is.

**Bizonyíték, hogy elnézés és nem szándék:** ugyanezeket a mezőket a bon-áttekintő
modál (3231–3242. sor) **escape-eli** (`esc2`), és a útvonal-pont sor (2160. sor)
is `esc(locVal || '')`-t használ. Csak a tankolás/vásárlás sor maradt ki.

**Érintett mezők:** `alim-loc`, `alim-lit`, `alim-km`, `alim-suma`, `alim-data`,
`ach-prod`, `ach-loc`, `ach-pret`, `ach-data` (9 mező).

**Javítás:** `esc(...)` a kilenc `value="..."` interpolációra.

---

## 2. HIBA — A telefonos VISSZA gomb 10 modált nem zár be (beragadt overlay)

**✅ JAVÍTVA** — új `_SOF_MODALS` nyilvántartás + `_sofCloseTopModal()`; a modál-zárás a menetlevél-lépés ELŐTT fut.

**Hol:** `public/sofer.js` `initSoferBackButton()` 1034–1064. sor.

**Mi a baj:** a `popstate`-csapda csak két modált ismer:

```js
var ho = document.getElementById('hoModal'), bug = document.getElementById('bugModal');
```

A sofőr felületen viszont **12** modál van. A hiányzó tíz:
`companyInfoModal`, `orderPickerModal`, `wbLocModal`, `wbConfirmModal`,
`receiptReviewModal`, `sofConfirmModal`, `sofTimeModal`, `sofChoiceModal`,
`pendingAddModal`, `orphRangeModal`.

**Következmény:** ha bármelyik nyitva van és a sofőr megnyomja a rendszer-vissza
gombot, a kód továbbesik a 3. ágra (`goSec('dash')`) vagy a 4. ágra (kilépés-jelzés).
A modál **láthatóan ott marad a főoldal fölött**, elnyeli a koppintásokat, és a
függőben lévő callback (`cb`) sosem hívódik meg — a felület befagy, a sofőrnek
ki kell lépnie és vissza.

Rosszabb eset: menetlevél 2. lépésén nyitott `wbConfirmModal`-lal az 1. ág fut
le (`fuvarBackStep1()`), tehát a lépés bezárul, a megerősítő modál viszont rajta marad.

**Megjegyzés:** az admin/manager konzol ezt már megoldotta (PR #442, generikus
`_vsCloseTopModal()`), a sofőr oldal viszont nem kapta meg.

**Javítás:** generikus, a legfelső nyitott modált bezáró segéd, a sofőr-modálok
saját `close*` függvényeivel.

---

## 3. HIBA — A lehúzással-frissítés (PTR) elrabolja a Cégadatok modál görgetését

**✅ JAVÍTVA** — a PTR `isModalOpen()`-je a közös `_sofAnyModalOpen()`-t hívja, így a `companyInfoModal` is blokkol.

**Hol:** `public/sofer.js` `isModalOpen()` 6218–6229. sor.

**Mi a baj:** a PTR blokkoló modál-listájából hiányzik a `companyInfoModal`:

```js
var modalIds = ['hoModal','bugModal','wbConfirmModal','receiptReviewModal',
                'orderPickerModal','wbLocModal','sofConfirmModal','sofTimeModal',
                'sofChoiceModal','pendingAddModal','orphRangeModal'];
```

A „🏢 Cégadatok" modál viszont **görgethető** (`sofer.css` 3043–3052:
`max-height: 88vh; overflow-y: auto`), és ~15 mezőt mutat — telefonon biztosan
túlnyúlik.

**Következmény:** a `touchstart` a `document`-en ül; nyitott Cégadatok-modálnál
`isModalOpen()` hamisat ad → a PTR elindul (a mögöttes panel `scrollTop`-ja 0),
a `touchmove` **`preventDefault()`-ot hív** → a modált nem lehet lefelé görgetni,
elengedésre pedig újratölti a mögötte lévő főoldalt. A sofőr pont akkor nem fér
hozzá a CUI-hoz/IBAN-hoz, amikor a boltban mutatnia kellene.

**Javítás:** `companyInfoModal` felvétele a listába (és a lista összevonása a
2. hiba modál-nyilvántartásával, hogy ne csússzon szét újra).

---

## 4. HIBA — Elavult cache-bust a MEGOSZTOTT fájlokon (a sofőr régi i18n/CSS-t kap)

**✅ JAVÍTVA** — `i18n.js?v=20260920wbveh`, `style.css?v=20260918payalloc`, `sofer.js?v=20260921sofaudit`.

**Hol:** `public/sofer.html` `<script>`/`<link>` verzió-paraméterek.

| Fájl | sofer.html | admin.html / manager.html | fájl utolsó módosítása |
|---|---|---|---|
| `i18n.js` | `?v=20260910r4` | `?v=20260920wbveh` | 2026-09-20 |
| `style.css` | `?v=20260716mobfix` | `?v=20260918payalloc` | 2026-09-18 |

**Mi a baj:** az `i18n.js` és a `style.css` **megosztott** fájl. A sofőr böngészője
a szeptember 10-i, illetve július 16-i verziót cache-eli és tartja. Ma még nem okoz
látható kárt (a 2026-09-20-i kulcsok `sv2.fl.*` statisztika-kulcsok), de **minden
jövőbeli sofőr-érintő i18n- vagy CSS-változás némán elakad** a sofőr telefonján —
pont az a hibaosztály, amit a projekt a cache-bust konvencióval kerülni akar.

**Javítás:** a sofer.html megosztott fájljainak verzió-paramétere a legfrissebbre.

---

## 5. MEGFIGYELÉS (nem javítom) — `t('sof.locale')` try/catch nélkül

`public/sofer.js` 10 helyen hívja `.toLocaleString(t('sof.locale'))`-t **védelem nélkül**
(372, 379, 546, 899, 962, 1136, 3542, 3794, 4487, 4959, 4968), miközben két helyen
(1395, 3711) a szerző `try/catch`-be tette. A kulcs (`sof.locale` → `ro-RO`/`hu-HU`)
megvan az `i18n.js`-ben, tehát ma nem dob; de ha az `i18n.js` betöltése elakad vagy a
kulcs eltűnik, a `t()` a nyers kulcsot adja vissza, amire a `toLocaleString`
`RangeError: Incorrect locale information provided` hibát dob, és a render megáll.
Latens törékenység, nem aktív hiba — külön körre hagyom.

## 6. MEGFIGYELÉS (nem javítom) — holt Firebase-chat kód

A chat 2026-07-18 óta WhatsApp-átirányítás. Az `initFirebaseChat` és társai
(`#chatContactView`, `#chatRoomView`, `#chatMsgs`, `#chatInput`, `#chatHeadAv`,
`#chatHeadName`, `#chatInitMsg`, `#chatContactList`) a `sofer.js`-ben maradtak,
de a hozzájuk tartozó DOM **nincs** a `sofer.html`-ben. Minden hivatkozás
null-védett, a kód nem hívódik — szándékos, visszakapcsolhatóságra hagyott holt kód.
Ugyanez a `#fFisa` (szerver generálja a sorszámot): minden olvasása őrzött.

---

## Amit ellenőriztem és RENDBEN volt

- Kliens↔szerver payload-szerződés a `/api/fuvarlevel-save`-en (minden mező egyezik).
- `getFuvarlevelFieldSuggestions`: a `Sofer` szerep benne van a kapuban, és a válasz
  lapos kulcsai (`punct_loc`/`alim_loc`/`ach_loc`/`ach_produs`) egyeznek a `sugRender`
  elvárásával; a `<datalist>`-eket a kliens dinamikusan hozza létre.
- `/api/border-cross`, `/api/doc-upload`, `/api/doc-download/:id`, `/api/pdf-download/:id`:
  auth-kapu, `company_id`-szűrés, cross-tenant védelem, bemenet-validáció rendben.
- Bon-scan retry-lánc (`BACKOFFS` 0/5/15 mp, a `|| 15000` bug javítva maradt),
  queue-karbantartás, IndexedDB kép-megőrzés.
- Nincs escape nélküli `innerHTML` a fuvar-kártyán / naplóban (a korábbi két XSS-fix áll).
- `goSec` szekció-lista teljes (`dash`/`border`/`fuvar`/`docs`/`chat`).
