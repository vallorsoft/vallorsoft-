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

## 2026-08-25 — Sofőr felület: teljes kontraszt + szimmetria kör (PR #360)

### Miért
A sofőr felület kártyái, keretei, gombjai és modáljai stílusban keveredtek — helyenként vékony (1px) halvány szürke keret (`#e2e8f0`) alig látszott a világos háttéren, a címke-szövegek muted-szürkéje (`#64748b`) beleolvadt a fehér card-okba, és a padding-értékek nem egyeztek (különböző kártya-típusok között 13-15px vegyesen). Kérés: a teljes sofőr-oldal legyen KONTRASZTOSABB és SZIMMETRIKUSABB.

### Mit
1. **`public/sofer.css` — új „KONTRASZT + SZIMMETRIA KÖR" blokk a fájl VÉGÉN** (~230 sor, additív; a scope `.sofer-wrap` + a toast/modal wrapperekre szűkítve → más felületet nem érint; a fájl végén → felülíró jogán él).
2. **Design-tokenek per-scope felülírva:** `--sof-border` `#e2e8f0` → **`#94a3b8`** (jól látható kék-szürke); `--sof-border-soft` `#eef2f7` → **`#cbd5e1`**; `--sof-muted` `#64748b` → **`#334155`** (címke/metaadat kontraszt++).
3. **Kártyák uniform 1.5px keret + egységes shadow-lépcső:** `.sofer-glass` / `.fuvar-card` / `.sof-mstat` / `.dyn-row` / `#myVehicleBox`. Padding-ritmus: glass+fuvar 16px, mstat 14px 6px, dyn-row 14px; border-radius 16/14/14. Nav-kártyák szintén 1.5px + hover-glow; logout-kártya piros keret `#fca5a5`.
4. **Formok:** `.input` / `.textarea` / `select.input` **1.5px** keret; szöveg `#0f172a` + font-weight 600; placeholder `#64748b`; fókusz `#1d4ed8` kék + 4px 20% glow. Címkék (`.field label` / `.section-head` / `.sof-mstat-lbl` / `.fd-lbl` / `.kiosztott-title`) `#334155` — jól olvasható.
5. **Gombok uniform 48px min-height** (`.sofer-btn` / `.sh-btn` / `.back-btn`); ghost/secondary 1.5px szürke keret + tinta-kitöltés, aktív állapotban `#f1f5f9`; primary mélyebb kék gradient `#2563eb → #4f46e5` + `0 8px 22px rgba(37,99,235,0.36)` glow; resume zöld gradient `#16a34a → #15803d`. Fuvar-akciógombok gap 8→10px szimmetriára; `.sh-btn` padding 12px 14px.
6. **Fuvar-kártya részletek:** 1.5px szaggatott szeparátor a details-nél; `.fd-sec-h` mélyebb kék `#1d4ed8` (jobban kiválik a fehér card-ból); `.fd-firma` / `.fd-val` tömör fekete `#0f172a`; `.fd-ms-row.done` szintén `#0f172a`; időpontok `#1d4ed8`. Fuvar-szám pill mélyebb kék gradient `#2563eb → #1d4ed8`. Státusz-pilulák 1.5px keret + font-weight 800.
7. **Toast + modálok** (9 modal: sofConfirm / sofTime / sofChoice / wbConfirm / wbLoc / orderPicker / receiptReview / pendingAdd / orphRange / hoModal / bugModal): egységes 1.5px `#94a3b8` keret + `0 20px 55px rgba(15,23,42,0.28)` shadow. Toast tömör ok/err színek (`#15803d` / `#b91c1c` szöveg, `#16a34a` / `#dc2626` keret).
8. **Bug FAB:** 1.5px sárga `#f59e0b` keret + erősebb shadow. **PTR pill:** 1.5px + font-weight 700.
9. **Havi mini-statisztika:** gap 4→6px szimmetria; `.sof-mstat-val` `#0f172a`; `.sof-mstat-prev` `#475569` + font-weight 600 (olvashatóbb kontraszt).
10. **Menetlevél step2 punct sum pill-ek:** mélyebb kék `#1d4ed8` index-buborék; edit gomb `#1d4ed8`/`#1e3a8a`; del gomb `#dc2626`/`#991b1b`.

### Fájlok / végpontok
- **Kliens**: `public/sofer.css` (+230 sor a fájl végén, kontraszt + szimmetria pass); `public/sofer.html` cache-bust `sofer.css?v=20260825wbcard2` → `?v=20260825contrast`.
- **Szerver / DB / handler érintetlen** — tisztán megjelenés.

### Ellenőrzés
- **981 Jest zöld** (61/68 suite, 45 skip valós-DB) — nincs regresszió.
- A blokk `.sofer-wrap` + toast/modal wrapperekre szűkítve → az admin/manager/routing/portál/carrier felületet NEM érinti.

---

## 2026-08-25 — Fuvar-kiírás wizard: Vissza+Tovább a nyitott card BELSEJÉBEN + auto-center + kontrasztos keret (PR #358)

### Miért
A fuvar-kiírás 6-lépéses wizardján a nav-sáv (Vissza + Tovább / ✅ Mentés) a nyitott step-card ALATT lebegett, elkülönült elemként (`.oc-nav` a `.oc-body` közvetlen gyereke, DOM-mozgatva a nyitott card mögé). A képen látszik: a „Tovább" gomb a card KERETÉN KÍVÜL, jobb alul lóg. Kérés: a gomb a card része legyen, mellette a Vissza gomb, és step-váltás után az új card a képernyő közepén jelenjen meg (ne kelljen csúsztatni), plusz a card-kerete legyen kontrasztosabb.

### Mit
1. **`public/order-wizard.js` `_refreshView`** — a `#ocNav` mostantól a nyitott `.oc-step-card` `.oc-step-open` végére DOM-mozgatva (`openWrap.appendChild(navEl)`), nem a card mellé. Így a Vissza + Tovább gomb a card részévé válik.
2. **Vissza gomb mindig látszik** — `back.style.visibility = 'visible'`, `back.disabled = (OC.step <= 1)`. Step 1-en disabled (opacity 0.45), de vizuálisan ott van a Tovább mellett → a felhasználó látja, hogy vissza-lépési lehetőség létezik.
3. **Auto-center step-váltáskor** — `scrollIntoView({behavior:'smooth', block:'center'})` (eddig `block:'start'` volt). Mobilon a Tovább kattintás után az új nyitott card a képernyő KÖZEPÉN jelenik meg — nem kell külön csúsztatni.
4. **Kontrasztosabb kártya-keretek** (`public/style.css`) — `.oc-step-card` alap keret 1px → 2px, szín `var(--border, #e2e8f0)` → `#94a3b8` szürke; nyitott step-card `border-color: #2563eb` (eddig `#3b82f6`), erősebb kék glow (`box-shadow 0 6px 22px rgba(37,99,235,0.18)`), akcent-csík 4px → 5px, szín gradient `#2563eb → #4f46e5`. Done state: zöld (`#16a34a`) keret+akcent. Pending state: szaggatott szürke (`border-style: dashed`). Sötét-módra külön overrideok (`#60a5fa` open, `#475569` pending).
5. **Nav belső elrendezés** (`.oc-nav`) — felül elválasztó vonal (`border-top: 1px solid rgba(148,163,184,0.35)`), `padding: 14px 0 4px; margin-top: 18px`; a Vissza (ghost) gomb 1.5px szürke keretes tinta-kitöltéssel (világos+sötét téma külön), disabled állapotban opacity 0.45.

### Fájlok / végpontok
- **Kliens**: `public/order-wizard.js` (`_refreshView` DOM-mozgatás + `scrollIntoView block:'center'`), `public/style.css` (kontraszt-kör). Cache-bust: `?v=20260825navin` (order-wizard.js + style.css az admin.html/manager.html-ben).
- **Szerver / DB / handler érintetlen** — tisztán a `.pane[data-pane="orders-form"]` wizardját érinti.

### Ellenőrzés
- **981 Jest zöld** (61/68 suite, 45 skip valós-DB) — nincs regresszió; `node -c public/order-wizard.js` szintaxis OK.
- Kézi ellenőrzés (élesben): `/admin` és `/manager` → Fuvarok → Fuvar kiírás → Tovább kattintás → új card a képernyő közepén, a Vissza+Tovább gombok a card belsejében, a card-kerete kontrasztos (kék 2px + akcent-csík).

---

## 2026-08-25 — Sofőr DEMÓ FIX: a `data-i18n` kulcsok most tényleg megjelennek (kulcs-ütközés + regisztráció-hiány)

### Miért
Az előző kör (PR #353) után a sofőr még mindig nyers kulcs-neveket látott a mockupban (`dm.mock.allocated`, `dm.badge`, `dm.brandNote` stb.), és a bemutató kilépés-gombján „Teljes nézet" jelent meg. Két gyökér-ok:
1. **Kulcs-ütközés**: a `dm.*` prefix már foglalt volt az i18n.js közös DICT-jében (`dm.enter=Sofőr mód`, `dm.exit=Teljes nézet` a driver-mode togglenek) — a demo `dm.exit=← Ieșire` felülíródott az `Teljes nézet`-re.
2. **Regisztráció-hiány**: az inline `_DM_FALLBACK` szótár csak a wizard-panel `_t()` függvényén át élt; az `i18n.js` `applyI18n()` a `[data-i18n]` attribútumokat a KÖZÖS `DICT`-ből olvasta — ahol a `dm.mock.*` / `dm.badge` kulcsok NEM léteztek → nyers kulcs jelent meg minden mockup-elemen.

### Mit
1. **`public/sofer-demo.html`** — mind a 261 `dm.*` előfordulás átnevezve `demo.*`-ra (261 sorban) `sed`-del: `dm.mock.*` → `demo.mock.*`, `dm.g.*` → `demo.g.*`, `dm.guide.*` → `demo.guide.*`, `dm.badge`/`dm.brandNote`/`dm.exit` → `demo.*`. A `dm.enter`/`dm.exit` (driver-mode toggle) az i18n.js-ben érintetlen.
2. **Új `DEMO_DICT` (RO + HU)** — 138 kulcs, mind a mockup, mind a wizard-panel; a valós Romanian felirat + magyar párja. A régi RO-only fallback szótár helyett most nyelvváltásra is helyesen reagál.
3. **Regisztráció az `i18n.js` közös DICT-jébe** — az inline script tetején (SZINKRON, még a DOMContentLoaded ELŐTT — mert az inline script a body VÉGÉN van, tehát parse-time során fut, mielőtt `i18n.js` `boot()`-ja az `applyI18n(document)`-tel elkezdi olvasni a `[data-i18n]`-eket). `Object.keys(DEMO_DICT).forEach(function(k){ window.I18N.dict[k] = DEMO_DICT[k]; });`
4. **`window._DM_FALLBACK`** most a `DEMO_DICT.ro` értékekből derivált (a HU-t a valós i18n intézi) — az inline `_t()` biztonsági fallback marad, ha az `i18n.js` valamiért nem érné el.
5. **~150 sor holt kód törölve** (a régi RO-only fallback szótár, ami mostantól redundáns).
6. **`tests/integration/sofer-demo-page.test.js`** — a 13 wizard-lépés elvárás `dm.g.s*` → `demo.g.s*`-ra frissítve. **5/5 teszt zöld.**

Cache-bust: `i18n.js?v=20260825demofix`. **981 Jest zöld** (nincs regresszió). Csak a `/sofer-demo` oldalt érinti.

---

## 2026-08-25 — Sofőr DEMÓ: a nevek/mezők a valós felülethez igazítva + realista menetlevél-mockup

### Miért
Sofőr visszajelzés a `/sofer-demo` sandbox oldalról: (1) a nav-gombok feliratai kevertek a valódival („Frontieră" a demóban vs. „Trecere frontieră" élesben; „Foaie parcurs" vs. „Foaie de parcurs"; „Documente" vs. „Documente / CMR"); (2) a fuvar-kártya a mockupban a MEGBÍZÓ nevét („Client: DEMO Client SRL") mutatta — de a valós `renderFuvarCard` szándékosan SEHOL nem jeleníti meg a `o.client`-et (kommentbe rögzítve); (3) a menetlevél-bemutató 3 mezőre redukálva (Km început, Km sfârșit, Alte mențiuni) — az éles menetlevél viszont 8 szekcióval fut: vontató+pótkocsi rendszám, km-óra + GPS gomb, Timpi cursă (automat), Treceri frontieră (automat + diurna), Puncte de traseu (Plecare/Încărcare/Descărcare/Sosire típusokkal), Stare combustibil + GPS, Alimentări, Achiziții, Alte mențiuni. A sofőr tehát belépéskor teljesen mást lát, mint amit a demóban gyakorolt.

### Mit

1. **`public/sofer-demo.html` (~910 sor) teljes újraírás** — a mockup mind a nav-gombok, mind a fuvar-kártya, mind a menetlevél-kitöltő a valós Romanian felirat + szerkezet szerint épül fel.
2. **Nav-gomb feliratok szinkronizálva** a valós `sofer.navBorder=Trecere frontieră` / `sofer.navWaybill=Foaie de parcurs` / `sofer.navDocs=Documente / CMR` (RO) i18n kulcsokkal — a `dm.mock.nav*` fallback szótár is frissítve.
3. **Fuvar-kártya realista szerkezete**: (a) fejléc: `#1 badge + 📅 azi · 📍 Cluj-Napoca` + `↓ 📅 mâine · 📍 București` (matches valós `_cityOf` + kettős fel-/lerakás sor), (b) kinyíló panel: `🚛` rendszám sor + `⚖️` súly+FTL, majd KÜLÖN `⬆️ Încărcare` és `⬇️ Descărcare` szekció (mint a valós `.p-fd-sec-h` + `.p-fd-sec-b`) — Firmă / Adresă / Dată mezőkkel. **A megbízó (`o.client`) neve SEHOL nem jelenik meg** (megfelel a valós renderFuvarCard komment-rögzített szabálynak). (c) az állomás-idővonal (📍→📦→📍→✅) és az `⛔ Predare marfă` gomb is ott van, mint élesben.
4. **„Nekem kiosztott jármű" kártya** hozzáadva a scene tetejére (mint a valós `#myVehicleBox`) — vontató + pótkocsi rendszám monospace formában.
5. **Menetlevél STEP 2 teljes újraírás** — a mockup pontosan a valós `sofer.html` `#fuvarStep2` szerkezetét tükrözi:
   - Kiválasztott fuvarok összesítő sáv + „✏️ Gestionare curse" gomb
   - Vontató+pótkocsi rendszám (Număr camion / remorcă)
   - Km început / sfârșit (📍 GPS mező-ikon)
   - „🕐 Timpi cursă (automat)" info-doboz
   - „🛂 Treceri frontieră (automat)" + diurna-példa doboz
   - „📍 Puncte de traseu" — 4 példa-sor típus-badge-ekkel (`Plecare` kék / `Încărcare` zöld / `Descărcare` piros / `Sosire` lila) + `➕ Adaugă punct` gomb
   - „🛢 Stare combustibil" — Cantitate început/sfârșit (⛽ GPS gomb)
   - „⛽ Alimentări" — példa-sor (MOL Cluj · 150 L · Card flotă · 900 RON) + `➕ Adaugă alimentare` + `📷 Scanare bon (AI)` gomb
   - „🛒 Achiziții" — példa-sor (Kaufland · Apă · Numerar · 45 RON) + add + scan
   - „Alte mențiuni" textarea + „💡 Salvare automată" hint
6. **Wizard 12 → 13 lépés** — új `dm.g.s8` lépés a menetlevél MEZŐINEK bemutatására: „Ce câmpuri sunt pe foaia de parcurs" — végigmutatja a scene-en, mit lát a sofőr, és bátorítja, hogy próbáljon rá minden szekcióra (mind kattintható a mockupban). A régi lépések 8-11 → 9-12-re csúsztak.
7. **`tests/integration/sofer-demo-page.test.js`** — a „12 wizard-lépés" elvárás → „13"-ra; a for-loop `i < 12` → `i < 13`. **5/5 teszt zöld.**

Cache-bust: `sofer-demo.html` inline `i18n.js?v=20260825demo`. Nincs séma-változás, nincs új szerver-handler, nincs új i18n kulcs (a `_DM_FALLBACK` szótár tartalmazza az összes új demo-feliratot). **Csak a `/sofer-demo` oldalt érinti** — a valós `/sofer` felület érintetlen.

---

## 2026-08-24 — Wizard: nav-gomb közvetlen a nyitott card alá + kontraszt-javítás (chip / step-bar / stop-bar / .ocr-legs)

### Miért
Két visszajelzés a PR #350–#351 után: (1) a Tovább/Vissza nav-sáv a wizard aljára ragadt — a nyitott card ALATT rögtön a jövőbeli (pending) step-bar-ok jöttek, nem a Tovább gomb. Természetes olvasás-irány: kész lépések ▸ aktuális card ▸ Tovább gomb ▸ mi jön még. (2) Több kontraszt-hiba a nemrég bevezetett elemeken: a nyitott stop bar-ja `opacity:0.4`-en szinte olvashatatlan volt; a pending step-bar `opacity:0.55`-nél is túl halvány; sötét témán a `.oc-stop-card` régi `#f8fafc` háttere feltűnő mismatch a `#0f172a` step-card ellenében.

### Mit

1. **Nav-gomb áthelyezés** (`public/order-wizard.js`) — a `.oc-nav` mostantól a `.oc-body` gyereke `id="ocNav"`-val. A `_refreshView` végén DOM-mozgatva a jelenlegi nyitott `.oc-step-card` KÖZVETLEN utána (`openCard.parentNode.insertBefore(navEl, openCard.nextSibling)`). Ha nincs nyitott card (fallback: OC.step=6+ review), a nav a body végén marad.
2. **Nav vizuális erősítés** (`style.css`) — a nav most sáv-szerű padding (12px 4px), a border-top felül elhagyva (nem kell választóvonal, a card kerete jelöli a határt). A primary „Tovább" gomb kap egy erős kék gradient + shadow-t (`0 4px 12px -3px rgba(59,130,246,0.4)`); hover-nél `translateY(-1px)`.
3. **Pending step-bar opacity** 0.55 → 0.72. A `_stepBarSum` szöveg is átvált `var(--muted)`-re a pending állapotban (a done-nál `#334155`/`#cbd5e1` — erős olvashatóság). A pending card kap egy `background:transparent` + finom szürke `.oc-sb-idx` badge-et.
4. **Sötét-mód `.oc-stop-card`** — a régi `#f8fafc` háttér lecserélve `rgba(255,255,255,0.03)`-ra, border `rgba(255,255,255,0.10)`-re. Nyitott állapotban `rgba(59,130,246,0.06)` háttér + `#3b82f6` border (kiemelt aktív). A toggle/ord gombok és field-label sötét-mód színei is javítva.
5. **Nyitott stop-bar opacity** 0.4 → 0.85 (a nyitott állomás fejlécén a bar szinte olvashatatlan volt).
6. **`.vs-chip` erősítés** — explicit `background:#ffffff` + `color:#0f172a` a világos módra (nem függ a `--panel` fallbacktől); hover `#1d4ed8` kék szín + `rgba(59,130,246,0.08)` háttér. Sötét-mód: `rgba(255,255,255,0.05)` bg, `#e2e8f0` szöveg, hover `#93c5fd`. A chip-n badge kontrasztosabb `#e2e8f0`/`#475569`.
7. **`.vs-chip-bar` sötét-mód bg** `#0c1218` → `#111c30` (matches `--bg-panel-raised`) — kevésbé feltűnő átmenet a `.glass` felett.
8. **`.ocr-legs` (leg-breakdown) erősítés** — bg `0.06` → `0.08` (világos) / `0.10` → `0.12` (sötét); border `0.18` → `0.25` / `0.25` → `0.35`. Head szín `#3b82f6` → `#2563eb` (világos) / új `#93c5fd` (sötét); km-szám `#3b82f6` → `#1d4ed8` / `#60a5fa` (sötét). A leg-sorra explicit `color: #0f172a` (világos) / `#e2e8f0` (sötét) — nem függ tokenektől.
9. **Nincs séma-, szerver- vagy handler-változás.** Cache-bust `?v=20260824navcnt` (style.css + order-wizard.js) mind admin.html + manager.html.

### Teszt
- Szintaxis-check `order-wizard.js` — zöld
- **981 Jest zöld** (0 törött, 45 skipped valós-DB)
- Vizuális ellenőrzés élesben (mindkét téma)

## 2026-08-24 — Comenzi (fuvar-kezelés) tábla: sticky chip-szűrő + súly-badge + tömörebb sorok (Routena-tömör kinézet)

### Miért
A fuvar-lista funkcionálisan erős (oszlop-átméretezés/átrendezés, csekbox+tömeges letöltés, státusz-inline-váltó, radar), de vizuálisan zsúfoltabb volt mint a Routena — sok fehér-tér és szín-inkonzisztencia. Kérés: kompaktabb kinézet, gyors-szűrő chipek (Aktív / Kiosztásra vár / Extern / Lezárt / Áru-leadás / Törölt), és a Marfă cellába a meglévő FTL/LTL+méret mellé a súly is jelenjen meg.

### Mit
1. **Kompaktabb sorok** (`style.css`) — `#tblOrders tbody td` padding 8px 10px + font-size 12.5px + line-height 1.4; fejléc uppercase 11px betű. Zebra `nth-child(even)` halvány szürke + erősebb kék hover (téma-érzékeny). Bal-akcens-csík 3px→4px hogy a tömörebb sorban is jól látszódjon.
2. **Sticky chip-szűrő** (`console-shared.js` + `admin.html`/`manager.html`) — új `renderOrdersChipBar` a `renderOrdersMetricBand` után hívva. 7 chip: Mind · Aktív · Kiosztásra vár · Alvállalkozói · Lezárt · Áru-leadás · Törölt. Élő darabszám a chip-en. Sticky (`position:sticky; top:0`), horizontal scroll mobilon. Aktív chip lila gradiens.
3. **Chip-filter logika** (`filterOrders`) — új `window._orderChipFilter` állapot + `_ORDER_CHIP_GROUPS` mapping csoport → státusz-lista (pl. `active: ['Alocat','In Curs','Extern']`). Additív a meglévő szöveges + státusz-dropdown szűrővel; nincs új szerver-hívás. `chipOrdersFilter(key)` átvált, `renderOrdersChipBar` újrarajzol.
4. **Marfă súly-badge** (`loadTypeBadge`) — új harmadik paraméter `weightKg`. Ha van (>0), lila `⚖ 14 000 kg` pill jelenik meg az FTL/LTL badge mellett és a méret előtt. `ro-RO` locale-lel formázva (14 000). `renderFilteredOrders` átadja a `c.suly_kg`-ot.
5. **A `filterOrders` `fuvar_no`-t is keres** — eddig csak a belső `orders.id`-re szűrt szöveges keresésre; mostantól az ember-olvasható `CMD-YYYY-XXXX` fuvar-számra is.
6. **i18n** — 8 új kulcs: `list.chipAll/chipActive/chipAvailable/chipExtern/chipFinalized/chipHandover/chipCancelled` + `cs.tt.cargoWeight`. RO-alap+HU. Cache-bust `?v=20260824comenzi` (style.css + console-shared.js + i18n.js) mind admin.html + manager.html.

### Amit NEM változtat
- Szerver-oldal érintetlen — pusztán kliens megjelenés + kliens-szűrés
- A meglévő `orderSearch` + `orderStatusFilter` dropdown megmarad, a chip csak MELLÉ jön (additív szűrő)
- Oszlop-átméretezés/átrendezés + kijelölés + tömeges letöltés + státusz-inline-váltó változatlan
- A KPI-band (Összes/Aktív/Vár/Lezárt) érintetlen

### Teszt
- **981 Jest zöld** (0 törött, 45 skipped valós-DB)
- Szintaxis-check `console-shared.js` + `i18n.js` — zöld

## 2026-08-24 — Fuvar-kiírás: cardosított wizard + Step 2 akkordeon + multi-stop route & toll (seq-order)

### Miért
Két kifogás a Routena-összehasonlításból: (1) a fuvar-kiírás wizard még sok mezőt egyszerre mutatott keret nélkül; (2) a km- és útdíj-számítás CSAK az első felrakó és első lerakó közti távolságot adta — a multi-drop fuvar többi állomását teljesen ignorálta. A kliens `_rmBuildWps` csak a top-mezőket és a térkép-`via` pontokat használta; a wizard extra állomásait (`window.__ocStopsSeq` és `#oExtraStopsList`) átugrotta. A backend `estimateRoute` már tudott N pontos láncot, csak nem kapta meg.

### Mit

1. **Wizard cardosítás** (`public/order-wizard.js` + `style.css`) — minden 6 lépés önálló `.oc-step-card` (1.5px keret, 14px sugarú sarok, bal-oldali akcent-csík). Három állapot per card: `open` (nyitva, kék akcent + kiemelt keret), `done` (előző lépés, zöld akcent, csak 1-soros összegző bar), `pending` (jövőbeli lépés, halvány bar, nem kattintható). A done bar-ra kattintva vissza lehet ugrani (mint az `ocGoStep`).
2. **Step-bar tartalom** (`_renderStepBarSummary`) — minden lépés kiírja a lényeget 1 sorban: 1. Ügyfél + Referencia · 2. Első helyszín → Utolsó helyszín + felrakó/lerakó darabszám · 3. FTL/LTL · Súly · Méret · 4. Sofőr · vontató · pótkocsi · 5. Ár · km · UIT. A ✏️ jelzi hogy kattintható.
3. **Step 2 állomás-akkordeon** — az `.oc-stop-card` mostantól `open` VAGY `collapsed` állapotú; alapból csak EGY nyitva egyszerre (`OC.openStopIdx`). Új állomás hozzáadásakor az előző automatikusan bezáródik → az új nyílik. Csukott állomás egy soros bar: `#N · badge · 📍 helyszín · 🏢 cég · 📅 dátum · [⬆⬇✕✏️]`. Kattintásra az adott bar nyílik és bezárja az előzőt. Nyitott állomásban új „▲ Bezárás" gomb.
4. **Multi-stop route + toll (seq-order)** — `console-shared.js` `_rmBuildWps` mostantól három forrásból tud waypoint-láncot építeni (prioritás sorrendben): (a) `window.__ocStopsSeq` — wizard közvetlen igazságforrás, a bevitel (seq_index) sorrendjében; (b) top-mezők + `#oExtraStopsList` (create) vagy `#oeExtraStopsList` (edit) DOM-sorrendben — top felrakó FIRST, extras a DOM-ban látott sorrendben, top lerakó LAST; (c) klasszikus 1 felrakó + térkép-`via` pontok + 1 lerakó (fallback). A számítás MINDIG a megadott sorrendben fűzi össze — semmilyen geográfiai optimalizálás.
5. **Backend leg-breakdown** (`lib/routeEstimate.js`) — `estimateRoute` visszaad `legs: [{fromLabel, toLabel, km, durationSeconds}]` tömböt is; waypoint-limit 9 → 20 (OSRM fair-use határon belül; egy tipikus multi-drop fuvar 3-5 stop, komplex esetek 10-15). `handlers/routePlannerHandlers.js` `orderRouteEstimate` átadja a `legs` tömböt.
6. **Toll (`estimateToll`)** — a handler már eddig is a `route_geo.waypoints` alapján dolgozott, ami mostantól MINDEN stopot tartalmaz (az `orderRouteRecalc` sikeres válasza után az `st.waypoints` kimenti a `buildRouteGeo` révén az `orders.route_geo`-ba a szerkesztő 💾 gomb hatására). Multi-stop chain esetén az országonkénti km-bontás pontosan a teljes láncra vonatkozik.
7. **Review-lap szakasz-bontás** — Step 5 új panel (`.ocr-legs`): ha ≥2 szakasz (multi-stop), listázza őket sorszámmal (`#1 · Cluj → Timișoara · 500 km`, `#2 · Timișoara → Wien · 700 km` …); a `_cityShort` heurisztika kiszűri az utca-prefixet és irszámot a jobb olvashatóság kedvéért. A `window.__ocOnRouteChanged` callback (a `orderRouteRecalc` végén hívva) frissíti a review-t ha nyitva van.
8. **i18n** — 7 új kulcs (`oc.stopsHintAcc`, `oc.stopCollapse`, `oc.stopEmpty`, `oc.empty`, `oc.legsHead`, `oc.legsUnit`; a `oc.stopsHint` felváltva). RO-alap + HU pár. Cache-bust `?v=20260824wcard` — `style.css`, `console-shared.js`, `order-wizard.js`, `i18n.js` mind (admin.html + manager.html).

### Amit NEM változtat
- Szerver-oldali fuvar-mentés (`comCreate`, multi-stop payload, `stops[]` seq_index) érintetlen — a wizard továbbra is a legacy `createOrder()`-t hívja
- A `_commitStopsToLegacy` viselkedés változatlan (top-mezőkbe elsőnek beírt pickup/delivery, `#oExtraStopsList`-be a többi interleaved-sorrendben)
- A klasszikus 1 felrakó + 1 lerakó fuvar-flow változatlan, a térkép-`via` funkció megmarad
- A többi 4 pane (Beérkező, Ügyfél kérések, stb.) nincs érintve

### Teszt
- Szintaxis-check mind az 5 módosított JS-fájlra (order-wizard.js, console-shared.js, routeEstimate.js, routePlannerHandlers.js, i18n.js) — zöld
- **981 Jest zöld** (0 törött, 45 skipped valós-DB); nincs regresszió
- Vizuális ellenőrzés a jelenlegi cache-bust utáni élesben teendő

## 2026-08-24 — Sofőr fuvar-kártya: multi-stop akkordeon — minden stop külön csukható, alapból CSAK a következő van nyitva

### Miért
A multi-drop fuvarnál (interleaved: pu→de→pu…) a „🛣️ Útvonal (a diszpécser sorrendjében)" szekció **egyszerre az ÖSSZES stopot** kinyitva mutatta — a sofőrnek végig kellett görgetnie a listát, hogy megtudja, épp mi jön. A stopok között nem volt hierarchia; a következő teendő nem ugrott ki.

### Mit tesz
1. **`public/sofer.js` `renderFuvarCard` (interleaved ág)** — minden `.fd-stop-block.fd-stop-seq` mostantól **egyénileg összecsukható** (`fd-stop-coll`); a fejlécen státusz-badge + kind-ikon + `stop_index` # + `seq_index` sorszám mellé kompakt összegzés (📍 város · 🏢 cég) került, hogy csukott állapotban is azonosítható. Az első nem-elvégzett (`!done_at`) stop kap **narancs „ez jön / urmează" badge**-et + kék halo keretet, ÉS alapból nyitva van; az összes többi csukva.
2. **Új `toggleFuvarStop(orderId, seqIdx)` (`public/sofer.js`)** — akkordeon: másik stop nyitásakor a korábban nyitva lévő automatikusan bezáródik. A `fdstop_<orderId>_<seqIdx>` prefix miatt más fuvar stopjai érintetlenek. Enter/Space is működik (billentyűzet-elérhetőség).
3. **`public/sofer.css`** — új `.fd-stop-coll` blokk: kattintható fejléc hover-rel, chevron ▸/▾ a fejléc jobb szélén, kompakt sum-sor csukott állapotban, „ez jön" narancs pilula (`.fd-stop-next`), és a nyitott stop kártya diszkrét kék keret + halo (`0 0 0 2px rgba(96,165,250,0.15)`) — egy pillantással kiderül, épp mi jön.
4. **i18n** — 1 új kulcs (`sof.det.next`, RO+HU). Cache-bust `sofer.html` `?v=20260824stopacc` (i18n.js + sofer.js + sofer.css).
5. **Nem érintett** — klasszikus fuvar (1 fel + 1 lerakó, VAGY tisztán pu…→de…) marad a jól ismert kétszekciós ⬆️/⬇️ elrendezésben (fázis-vezérelt open/close); a fuvar-kártya összecsukott fejléce (dátum · cég · város) érintetlen; állomás-idővonal (🚚 Fuvar állapota) érintetlen; állomás-akciógomb (`driverStopAction`) érintetlen; multi-drop UIT-gomb minden lerakónál a kinyitott stop-blokkban látszik (mint eddig).

### Regresszió-védelem
- `tests/integration/sofer-client-flow.test.js` + `sofer-tour.test.js` — **52 zöld** (nincs regresszió az állomás-léptetésben / draft-restore / offline outbox / demó-intercept fluxusokban).

### Kockázat
Alacsony — tisztán kliens-oldali render + CSS + egy új top-level segéd (`toggleFuvarStop`); szerver-oldal, DB és háló-hívás érintetlen.

---

## 2026-08-24 — Fuvar-kiírás: állomás-sorrend megőrzése (interleaved) + autocomplete mostantól MINDEN cím-/cég-mezőn

### Miért
A diszpécser bevitele „2 felrakó → 5 lerakó → 3 felrakó → 1 lerakó" sorrendben eddig ELVESZETT: a szerver a `order_stops` táblát kind-en belüli `stop_index` szerint tárolta, a sofőr felülete pedig két külön szekcióban (ELÖL az ÖSSZES felrakó, HÁTUL az ÖSSZES lerakó) rendelte. A sofőrnek nem volt látható a bevitel valós sorrendje, és „ugyanaz a cím" második beírása is a hátsó szakaszba került → úgy tűnt, „nem enged duplikálni". Emellett a wizard step 2 + Extra stops sorok nem használták a `getOrderFieldSuggestions` autocomplete-et, tehát a korábban beírt cím/cég ott NEM javasolódott.

### Mit tesz
1. **Új `order_stops.seq_index` oszlop** (`db/order-stops-seq.sql`, idempotens migráció) — GLOBÁLIS bevitel-sorrend (0..N-1) a fuvaron belül. A kind-en belüli `stop_index` megmarad (mirror-trigger és per-kind indexelés arra épül). Backfill: régi soroknál `pickups-elöl, deliveries-utána` — bit-azonos a régi UI-val.
2. **`lib/orderStops.js` `normalizeStops(o)` — ordered `stops[]` bemenet elsőbbség** — a szerver mostantól elsőként az `o.stops[]` egyetlen ordered tömbjét használja (megőrzi az interleaved sorrendet). A régi `pickups[]/deliveries[]` út visszamenőleg működik (fallback). A visszaadott `normalized` új `seq` mezőt tartalmaz (a bevitel sorrendje). `replaceStopsForOrder` INSERT-el `seq_index`-et.
3. **`handlers/orders.js`** — `getMySoferOrders` / `getOrderById` / `comList` JSON_AGG mostantól `seq_index`-et is olvas és `ORDER BY COALESCE(s.seq_index, 999999) ASC` szerint rendez. A régi kind DESC / stop_index ASC csak fallback.
4. **`public/order-wizard.js` `_commitStopsToLegacy`** — publikálja az `OC.stops` interleaved tömbjét `window.__ocStopsSeq`-be; a top-mezőkbe a BEVITEL SORRENDJÉBEN első pickup + első delivery kerül; az `oExtraStopsList` sorai szintén DOM-hű interleaved rendben (nem pickups-elöl-deliveries-utána). `_syncStopsFromLegacyIfEmpty` elsősorban a `__ocStopsSeq`-ből tölt vissza (Vissza/Tovább lépés).
5. **`public/console-shared.js` `createOrder` / `saveOrderEdit`** — küldi az új ordered `stops[]` payloadot (a wizard-ból VAGY top+extras DOM-sorrendből). A régi `pickups[]/deliveries[]` mezőket is elküldjük visszafelé kompatibilis fallback-ként. `populateExtraStopsFromOrder` a szerkesztő újratöltésénél `seq_index` szerint iterál, és pontosan azt a pickup/delivery-t hagyja ki, amely a top-mezőket tükrözi (stop_index=0 pickup + MAX(stop_index) delivery) — nincs duplikáció, a sorrend megőrizve.
6. **`public/sofer.js` `renderFuvarCard`** — új `_seqStops` (seq_index szerinti sorrend). Ha 2+ kind-váltás történik a sorrendben (valódi interleaved, pl. pu→de→pu), egyetlen 🛣️ „Útvonal (a diszpécser sorrendjében)" szekció, minden stop kind-badge + státusz + `stop_index` #-szám + `seq_index` sorszámmal. Klasszikus fuvarnál (1 fel + 1 lerakó vagy pu…→de…) marad a jól ismert kétszekciós ⬆️/⬇️ elrendezés. `_computeNextStopOptions` szintén seq_index szerint jár: az első nem-lezárt stop a következő akció horgonya.
7. **Autocomplete kiterjesztése** — a `getOrderFieldSuggestions` (`handlers/orders.js`) új UNIÓS `loc` és `firma` kulcsokat is visszaad: minden korábbi fuvar `loc_incarcare`/`loc_descarcare`/`order_stops.loc` és `firma_incarcare`/`firma_descarcare`/`order_stops.firma` értékét EGY listába uniózva. A wizard step 2 inputjai (`ocStopLoc_i`/`ocStopFirma_i`) és az `addExtraStopRow` új extra-sorok `data-sg="loc"`/`data-sg="firma"` attribútumot kapnak → a közös `ensureOrderSgDelegate` legördülő automatikusan felkínálja ugyanazokat a javaslatokat, mint a top-mezőknél. Az extra-sorok Photon-autocomplete-et + ⭐ FavLocations pickert is kapnak (kind-hű szűrés: pickup→load, delivery→unload).
8. **Duplikáció mostantól explicit engedélyezett** — a fenti fix mellékhatása: ugyanazt a mentett helyet több stop-on bármikor kiválasztható; ugyanaz a cím/cég többször beírható (autocomplete csak javasol, sosem tilt).

### Fájl-lista
- Új: `db/order-stops-seq.sql`.
- Módosított: `lib/orderStops.js`, `handlers/orders.js`, `public/order-wizard.js`, `public/console-shared.js`, `public/sofer.js`, `public/i18n.js` (`sof.det.route` új kulcs RO+HU), `public/admin.html`+`manager.html`+`sofer.html` cache-bust `?v=20260824seq`.
- Teszt: `tests/unit/orderStops.test.js` — új „stops[] ordered — interleaved sorrend megőrizve seq_index-ben" eset (4-stop interleaved bevitel → seq_index [0,1,2,3] + kind [pu,de,pu,de]); a régi replaceStopsForOrder-teszt oszlop-sorrend frissítve (arrived_at $10). **981 Jest zöld** (0 törött, 45 skipped valós-DB).

---

## 2026-08-24 — Sofőr BEMUTATÓ V2 — teljes újratervezés: önálló `/sofer-demo` sandbox oldal (mindenben nyomogatható)

### Miért
Sofőr visszajelzés: **„nem használható ez, nem lehet szimulálni a használatot"**. A valós felületre rakott overlay-tour (PR #344 → #346) alapvetően nem működött jól — a demó fuvart injektáltuk a valós cache-be, a valós fetch-eket próbáltuk mockolni interceptekkel, ami sok ponton szivárogó és félrevezető volt. A sofőr nem tudta „megélni" a felületet.

### Mit tesz — TELJES ÚJRATERVEZÉS
1. **Új önálló oldal `/sofer-demo`** (`public/sofer-demo.html`, ~800 sor standalone HTML+CSS+JS) — a valós felülettől TELJESEN ELSZIGETELT sandbox. Nincs backend-hívás; minden lokális `in-memory` state-ben él. A sofőr TÉNYLEG végigkoppintja: kártya kinyit, állomás-gomb léptet (📍→📦→📍→✅ vizuálisan), határátlépés BE/KI mock napló, menetlevél mock kitöltés (km, mentés-toast), iratok, chat, PTR, bug FAB.
2. **Telefon-mockup a képernyő közepén** — sötét telefon-keret, világos képernyő a valós sofer-felület stílusában (fejléc + kártyák + nagy gombok). Bal oldalon (asztalon) vagy alul (mobilon) egy magyarázat-panel: „N/12 lépés" progressbar + cím + törzs + hint + Vissza/Tovább/Kihagyás gombok.
3. **12 lépéses interaktív wizard**: (1) Welcome → (2) Főoldal áttekintés → (3) Fuvar-kártya kinyit → (4) Állomás-gomb (kattintásra léptet) → (5) Menü-áttekintés → (6) Határátlépés (kattintásra napló) → (7) Menetlevél → (8) „Menetlevél létrehozása" (kattintásra 2. lépés form) → (9) Iratok → (10) Chat → (11) PTR (pill villan) → (12) 🎉 Kész + „Nyisd meg az igazi appot" gomb.
4. **A wizard reagál a mockup-interakcióra** — az interaktív lépéseken (`waitAction: true`): ha a sofőr rákoppint a mockup megfelelő gombjára, a wizard AUTOMATIKUSAN továbblép; ha nem találja, a jobb oldalon „Tovább →" gombbal kézzel is léphet.
5. **Auto-átirányítás első belépéskor** — `sofer.js` az `authMe.then()`-ben: ha `!localStorage['vs_sofer_demo_seen']` és a GDPR-banner nem látszik és nincs mentett menetlevél-piszkozat → 1.2 s után `window.location.href = '/sofer-demo'`. A demó Kilépés gombja beállítja a `vs_sofer_demo_seen=1` jelzőt, így legközelebb már nem irányít újra.
6. **„🎓 Bemutatás" nav-kártya a főoldalon** — a `/sofer-demo`-ra ugrik (nem indít overlay-tour-t). Bárki bármikor újranyithatja tanulásra.
7. **Régi overlay-tour ELTÁVOLÍTVA a valós appról** — a `sofer-tour.js` betöltése kikerült a `sofer.html`-ből (a fájl a diszken marad opcionális törléshez); a `sofer.js`-ben az intercept-guardok (`window.SoferTour && …`) biztonságosan false-ra esnek, tehát a valós fetch-ek tisztán futnak.

### Szerver / DB
- **1 új route** `routes/pages.js`: `GET /sofer-demo` `Sofer|Admin|Manager` szerep-védelemmel, statikus HTML-t szolgál ki. Nincs séma-változás, nincs új handler.

### Kliens
- **ÚJ `public/sofer-demo.html`** — önálló standalone oldal (HTML + CSS + JS + fallback szótár).
- **`public/sofer.html`** — a „🎓 Bemutatás" nav-kártya `onclick` `/sofer-demo`-ra ugrik; a `sofer-tour.js` betöltés kivéve; cache-bust `?v=20260824demo`.
- **`public/sofer.js`** — az `authMe.then()` auto-start ág átirányít `/sofer-demo`-ra (a régi `SoferTour.start(true)` helyett), figyelembe véve a `vs_sofer_demo_seen` localStorage jelzőt + GDPR-banner + mentett draft.
- **`routes/pages.js`** — új `/sofer-demo` route.

### Teszt
- **ÚJ `tests/integration/sofer-demo-page.test.js`** (5 új eset): route regisztrálva Sofer/Admin/Manager védelemmel; HTML fő struktúra (mockup + 5 scene + wizard nav + Kilépés → `/sofer`); mind a 12 wizard-lépés i18n kulcsa; inline JS szintaxis-tiszta + minden publikus fn exportálva; VM-ben boot: `guideNext` / `mockNavToScene` / `mockBorderTap` / `mockStopStep` / `mockWbCreate` / `mockToast` hibamentesen fut.
- **Frissítve `tests/integration/sofer-tour.test.js`**: az auto-start regressziós teszt most a `/sofer-demo` átirányítást ellenőrzi (`vs_sofer_demo_seen` + `window.location.href = '/sofer-demo'`) a régi `SoferTour.start(true)` helyett.
- **980 Jest zöld** (előző 975 → 980, +5 új demo-teszt), 45 skip valós-DB. Nincs regresszió.

---

## 2026-08-23 — Sofőr bemutató: átlátszó overlay (a valós app végig látszik) + „Bemutatás" gomb dupla széles

### Miért
Sofőr visszajelzés: „nem lett a legjobb mert elhomályosítja a hátteret nem a valós appot mutassa be plusz a bemutato gomb dupla szeles legyen". Két gyökér-ok:
1. Az overlay `rgba(15,23,42,0.62)` fátylat rakott a valós app-ra, és a spotlight `box-shadow: 0 0 0 9999px rgba(...,0.62)` a lyukon kívül is elsötétített → a sofőr a bemutatóban nem a valós felületet látta, hanem egy sötét fátyolt egy kis lyukkal.
2. A „🎓 Bemutatás" nav-kártya csak egy oszlopot foglalt a 2-oszlopos gridben — apró volt, könnyen elveszett.

### Mit tesz
1. **Overlay teljesen átlátszó** — `background: transparent` (a `pointer-events: auto` marad, hogy a mellé-kattintást elfogja és ne kattintson a sofőr másra véletlenül a spotlighton kívül).
2. **Spotlight 4-rétegű vastag narancs kiemelés** (`box-shadow`) — belső narancs keret + fehér kontraszt-gyűrű + narancs glow + széles halo → a valós app végig látszik, a spotlight a fátyol nélkül is jól kiugrik.
3. **Pulzáló gyűrű erősebb** — nagyobb (`scale 1.15`) és halványabb (`opacity 0.3`) alsó pontig, hogy fátyol nélkül is figyelemfelkeltő legyen.
4. **„🎓 Bemutatás" nav-kártya dupla széles** — `style="grid-column: 1 / -1"` (teljes szélesség egy sorban). Konzisztencia miatt a **Kilépés kártya is span 2**-re állítva → két nagy sáv a nav-grid alján a Határátlépés/Menetlevél/Iratok/Chat 2×2 rácsa alatt.
5. **Cache-bust** `sofer.html` `?v=20260823tour3`.

### Szerver / DB
- Nincs változás — tisztán kliens-oldali CSS + inline stílus.

### Kliens
- **`public/sofer-tour.js`** — `.st-ov` `background` `rgba(15,23,42,0.62)` → `transparent`, `backdrop-filter:blur(3px)` törölve. `.st-spot` `box-shadow` átírva 4-rétegűre (narancs keret + fehér gyűrű + glow + halo, a `9999px` sötétítő fátyol EL). `.st-spot.pulse::after` `scale(1.08)`→`scale(1.15)`, `opacity .35`→`.3`.
- **`public/sofer.html`** — a `#soferTourNavCard` + a `logout` nav-kártya inline `style="grid-column: 1 / -1"`; script cache-bust `?v=20260823tour3`.

### Teszt
- **975 Jest zöld** (nincs regresszió). A tour-teszt visszafelé kompatibilis (a demó-injekció és a `SoferTour` API viselkedése azonos, csak a megjelenés változott).

---

## 2026-08-23 — Sofőr bemutató UX-fix: tooltip max-magasság + belső scroll + sticky footer, MINDEN lépésen „Tovább" gomb

### Miért
A PR #344 után a sofőr jelezte, hogy a bemutató alatt „van ami kiesik a képernyőből és nem katintható tovább". Két gyökér:
1. A tooltip `position: fixed` volt magasság-korlát nélkül — hosszú szövegű + calloutos lépésen kis képernyőn (alacsony viewport) a Vissza/Tovább/Kihagyom gombsor lelógott a viewport-ból, elérhetetlen lett.
2. A `waitClick` lépéseken nem volt „Tovább" primary gomb — csak a valódi kiemelt gomb megkoppintása léptetett (vagy a Kihagyom, ami leállította a teljes tour-t). Ha a sofőr nem találta / nem tudta megnyomni a kiemelt gombot (pl. a spotlight alatt más elemre koppint), beragadt.

### Mit tesz
1. **`.st-tip` átalakítás** — `display: flex; flex-direction: column; max-height: calc(100vh - 24px); box-sizing: border-box`. A tartalom két részre bomlik:
   - **`.st-body`** — görgethető törzs (`overflow-y: auto`, `min-height: 0`): progressbar + cím + magyarázat + callout + „👉 Koppints a kiemelt gombra vagy nyomd a Tovább-ot" hint. Ha a szöveg nem fér, itt scrollál.
   - **`.st-footer`** — sticky lábléc (`position: sticky; bottom: 0; background: #fff`): a Vissza/Tovább gombsor + halvány „Kihagyom a bemutatót" link MINDIG látszik.
2. **MINDEN nem-utolsó lépésen primary „Tovább →" gomb** — a `waitClick` esetekben is (eddig csak a Kihagyom volt). Ha a sofőr nem találja a kiemelt gombot vagy a spotlight nem működik, kézzel léphet. A valódi klikk továbbra is működik (spotlight átengedi + capture-listener léptet).
3. **`_positionTooltip` finomítás** — új „egyik sem fér el" fallback: ha se alul se felül nem fér a teljes tooltip, viewport-belülre kényszerítjük (`top = max(12, vh - th - 12)`), és a belső scroll biztosítja, hogy minden elérhető.
4. **Kompaktabb tooltip** — kisebb padding (14/16), kisebb betű (13.5px a gombokon, 11.5px a hint-en), 80px min-width a gombokon (kis képernyőn három gomb is elfér egy sorban).
5. **1 új i18n kulcs** (`sof.tour.tapReal`, RO+HU) + cache-bust `sofer.html` `?v=20260823tour2`.

### Szerver / DB
- Nincs változás — tisztán kliens-oldali CSS + JS finomítás.

### Kliens
- **`public/sofer-tour.js`** — CSS blokk a `.st-tip`-re és gyerekeire átírva (max-height, flex, sticky footer); `_renderTooltip` szétosztva `.st-body` + `.st-footer` szerkezetre; `_positionTooltip` új „nem fér el" fallback ág.
- **`public/i18n.js`** — új `sof.tour.tapReal` (RO+HU).
- **`public/sofer.html`** — `sofer-tour.js` + `i18n.js` cache-bust `?v=20260823tour2`.

### Teszt
- Szintaxis-ellenőrzés + teljes suite: **975 Jest zöld** (nincs regresszió); a `sofer-tour.test.js` mind a 10 esete zöld (a struktúra-változás visszafelé kompatibilis — a `SoferTour` API és a demó-injekció viselkedése azonos).

---

## 2026-08-23 — Sofőr: interaktív első-belépéses BEMUTATÓ (DEMÓ fuvarral) + „🎓 Bemutatás" gomb az újranyitáshoz

### Miért
Az új sofőrt eddig kézzel kellett betanítani a felületre — mi micsoda, mi függ össze mivel, mit ne bántson. Volt aki az „állomás-gombot" nem merte megnyomni, mert nem tudta hogy VISSZAVONHATATLAN, más a menetlevelet nem találta meg, harmadik a bon-scannerről nem tudott. Kérés: **az első regisztrációba legyen példa fuvar és példa menetlevél is, hogy tényleg nyomogassa végig, és legyen „Demó" gomb, amivel bármikor újranyithatja** — így képzés nélkül is megtanulja magától.

### Mit tesz
1. **Új önálló modul `public/sofer-tour.js`** (~700 sor, IIFE) — `window.SoferTour = { start(force), stop(), isDone(), resetSeen(), demoIntercept(kind, action), _next(), _prev(), _reflow() }`. Semmi új szerver-oldal; tisztán kliens.
2. **DEMÓ fuvar injektálva a főoldali `_soferOrdersCache`-be** (`id: 'CMD-DEMO-001'`, `_isDemo: true`, Cluj-Napoca → București, DEMO-01/DEMO-02 rendszám, FTL 22 000 kg, 2 stop-tömb). A rendes `renderFuvarCard` renderelni tudja; a wrapper `data-order-id` + `data-tour-demo="1"` markert kap, a kártya tetejére napnyugta gradiens **📚 DEMÓ** badge kerül — sose téveszti össze valós fuvarral.
3. **14 lépéses coach-mark walkthrough** (RO-alap + HU): 👋 Welcome center-card → topbar/nyelvváltó → kiosztott fuvarok szekció → DEMÓ kártya kinyitása (várja a valódi klikket) → állomás-gomb (várja a valódi klikket, léptet: 📍→📦→📍→✅) → 🛂 Határátlépés menü → 🇷🇴 RO BE gomb (várja a klikket) → 📄 Menetlevél menü → „📄 Menetlevél létrehozása" gomb → 📷 Bon szkennelés (AI) → 📁 Iratok/CMR → 💬 Chat → ↓ Pull-to-refresh → 🐛 Bug FAB → 🎉 Kész center-card.
4. **Interaktív, tényleg végigkoppintható** — a lépések nagy része (kártya-kinyitás, állomás-gomb, határátlépés BE, menetlevél/iratok/chat nav) a valódi UI-elemre vár koppintás-figyelővel (globális `click` capture). A sofőr **tényleg megnyomja** a valós gombot; a demó-intercept guardolja, hogy ne menjen a szerverre.
5. **Demó-intercept 6 kritikus akcióra** (`driverStopAction`, `driverMilestone`, `sendBorderCross`, `submitFuvarlevel`, `uploadDoc`, `submitHandover`): a `sofer.js` a függvény elején hívja a `SoferTour.demoIntercept()`-et — ha aktív tour vagy DEMÓ id, azonnal `return` (nincs fetch, nincs bizonylat, nincs riasztás), csak egy „✅ DEMÓ: …" toast + auto-továbblép a következő lépésre. A DEMÓ id-re a védőháló akkor is él, ha a tour már véget ért (racing-védelem).
6. **Az állomás-gomb a DEMÓ kártyán is „élőben" léptet vizuálisan** — a `driverStopAction`-ba tett intercept-ág a demó `stops` tömbjén elvégzi a lokális lépést (`arrived_at`/`done_at` NOW), és újrarajzolja a kártyát → a következő gomb-felirat is stimmel (📍→📦→📍→✅), a sofőr érezhető visszajelzést kap.
7. **„🎓 Bemutatás" nav-kártya a főoldal grid-jén** (a Kilépés fölött) — kék-indigó szaggatott keretes; koppintásra `SoferTour.start(true)` → az adott sofőr bármikor újranyithatja tanulásra. `localStorage['vs_sofer_tour_done:<email>'] = '1'` csak azt jelzi, hogy egyszer már látta (auto-start feltétele) — nem tiltja az újrafuttatást.
8. **Első belépés auto-start** — a `sofer.js` `authMe.then()` végén, a `_meData` betöltése után 1.2 s késleltetéssel: ha `!SoferTour.isDone()` ÉS a GDPR-banner nem látszik (annak elsőbbsége van) → `SoferTour.start(true)`. Aki már látta, nem kap újra automatán, csak ha rákoppint a gombra.
9. **Overlay UX** — teljes-képernyős fátyol + spotlight-lyuk a célon (átengedi a valós koppintást) + tooltip-kártya (progressbar, cím, magyarázat, opcionális callout, Vissza/Tovább gombok + halvány „Kihagyom a bemutatót" link). A tooltip a cél alatt/fölött pozicionál (viewport-tudatos), a spotlight körül pulzáló sárga gyűrű. Center-card a welcome/kész lépéshez. Nyelvváltásra `_reflow()` újrarajzol.

### Szerver / DB
- **Nincs séma-változás, nincs új szerver-handler** — tisztán kliens-oldali. A demó SEMMILYEN valós adatot nem hoz létre (a demó-intercept a fetch előtt jár).

### Kliens
- **ÚJ `public/sofer-tour.js`** (~700 sor). Cache-bust `?v=20260823tour`.
- **`public/sofer.html`** — új `<div class="sofer-nav-card" id="soferTourNavCard">🎓 Bemutatás</div>` a nav-grid-en (Kilépés fölött); új `<script src="/sofer-tour.js?v=20260823tour"></script>` a `sofer.js` után; `i18n.js` cache-bust `?v=20260823tour`.
- **`public/sofer.js`** — (a) auto-start ág az `authMe.then()`-ben (1.2 s után, GDPR-banner elsőbbség); (b) demó-intercept guard a 6 kritikus akció elején (`driverStopAction`, `driverMilestone`, `sendBorderCross`, `submitFuvarlevel`, `uploadDoc`, `submitHandover`); (c) `renderFuvarCard` a wrapperre `data-order-id="…"` + demó esetén `data-tour-demo="1"` + tetejére `.st-demo-badge` — a tour így találja meg a kártyát és a benne lévő valós gombokat.
- **`public/i18n.js`** — **48 új `sof.tour.*` kulcs** (RO-alap + HU): navigációs feliratok (`navBtn`, `demoBadge`, `demoRef`, `demoToast`, `next`/`prev`/`skip`/`stop`), és a 15 lépés címei + törzsei + calloutjai (`s0.title`/`s0.body`/`s0.start`, `s1.title/body`, …, `s14.title/body/close`).

### Teszt
- **ÚJ `tests/integration/sofer-tour.test.js` (10 új eset)**: IIFE hibamentesen betölt és exportálja az API-t; `isDone`/`resetSeen`/`stop(true)` perzisztencia; `start()` a welcome center-modalt a body-hoz csatolja (VallorSoft + Kezdés szöveg); `_next()` × 2 → DEMÓ fuvar bekerül a cache-be, `_isDemo=true`, kirenderelődik a `#kiosztottList`-be `data-tour-demo="1"` markerrel; `stop()` eltávolítja a DEMÓ fuvart ÉS a tour DOM-ot; `demoIntercept` aktív tour alatt border/waybill/doc/handover→true, egyéb→false; tour NÉLKÜL a DEMÓ id-re továbbra is true (védőháló); regresszió-védelem: a sofer.js 6 kritikus útján és a `renderFuvarCard`-ban ott vannak az intercept-hívások + a demó-markerek; az auto-start ág is bent van. **975 Jest zöld** (előző 965 → 975, +10; nincs regresszió).

---

## 2026-08-22 — Sofőr: lehúzással frissítés (pull-to-refresh, natív PWA-érzet)

### Miért
A sofőr felület mobil PWA-ban (kezdőképernyőre telepítve) a natív böngésző pull-to-refresh-t elveszti — a `body`-n szándékos `overflow:hidden` + `overscroll-behavior:none` blokkolja (különben a menetlevél-form billentyűzet-visszapattanása véletlenül refresh-hez vezetne). A sofőrök jelezték, hogy a többi mobil-appban ezt megszokták → új adat lekérésére most az al-menük közötti nav-kattintás vagy az app újranyitás kell.

### Mit tesz
1. **Új közös pull-to-refresh** (`initSoferPullToRefresh` IIFE a `public/sofer.js` végén) — a látható `.pane-sofer` (fő görgethető panel) tetején, ha a `scrollTop === 0` és a sofőr lefelé húz, egy pill jelenik meg középen felül: `↓ Húzd le a frissítéshez` → küszöb (70 px lassított útból) fölött zöld gradiensre vált `↑ Elengedéskor frissítés` → elengedéskor spinner + `Frissítés…`.
2. **Aktív szekció szerinti újratöltés** — `sec-dash` esetén `loadDashOrders` + `loadSoferMiniStats` + `loadMyAssignedVehicle` + `renderPendingReceipts` + `applyBonScanVisibility`; `sec-fuvar`-nál (csak step1-en) `loadSoferOrders` + `renderDraftResume` + `renderPendingReceipts` — a step2 menetlevél-űrlap adatait NEM bántja; `sec-border` → `loadBorderLog`; `sec-docs` → `loadDocOrderOptions`; `sec-chat` (WhatsApp-átirányítós) érintetlen.
3. **Blokkolt esetek** — folyamatban lévő frissítés, nyitott modal (`hoModal`/`bugModal`/`wbConfirmModal`/`receiptReviewModal`/`orderPickerModal`/`wbLocModal`/`sofConfirmModal`/`sofTimeModal`/`sofChoiceModal`/`pendingAddModal`/`orphRangeModal`), bevitel közben (INPUT/TEXTAREA/SELECT/contentEditable). Ha a húzás közben a sofőr feljebb görget (scrollTop > 0), a PTR megszakad.
4. **Csak érintőképernyős eszközön aktív** — `hasTouch` = `'ontouchstart' in window || navigator.maxTouchPoints > 0`; asztali gépnél az IIFE azonnal return-ol, semmi nem történik.
5. **CSS** (`public/sofer.css` új blokk): `.sof-ptr` pill (fixed top center, kék→zöld gradiens ready/refresh állapotban, `env(safe-area-inset-top)` figyelembevétel a notchos telefonokhoz), `@keyframes sof-ptr-spin` a spinnerhez. A pill `pointer-events:none` — nem zavarja meg a görgetést, csak vizuális.
6. **Sub-mp visszatérés** — a `refreshCurrent` fire-and-forget indítja a betöltőket, 900 ms után a pill visszahúzódik és unlockolja a következő húzást. A háttérben az egyes handlerek folytatják az adatlekérést és renderelést a saját ütemükben.

### Szerver / DB
- **Nincs séma-változás, nincs új szerver-handler** — tisztán kliens-oldali fluxus a meglévő `load*` handlereket használva.

### Kliens
- **`public/sofer.js`** — új `initSoferPullToRefresh` IIFE a fájl végén (~185 sor): `ensurePill` / `setState` / `visiblePane` / `isModalOpen` / `refreshCurrent` / `onStart` / `onMove` / `onEnd` (touch event handlerek), THRESHOLD/MAX_PULL/DAMP konstansok.
- **`public/sofer.css`** — új `.sof-ptr` + `.sof-ptr.ready` + `.sof-ptr.refresh` + `.sof-ptr-icon` + `@keyframes sof-ptr-spin` blokk a fájl végén.
- **`public/i18n.js`** — 3 új kulcs (`sof.ptr.pull`, `sof.ptr.release`, `sof.ptr.refreshing`, RO-alap + HU). Cache-bust `sofer.html` `sofer.js`+`sofer.css`+`i18n.js` `?v=20260822ptr`.

### Teszt
- Szintaxis-ellenőrzés + teljes suite: **965 Jest zöld** (nincs regresszió, 42/42 sofer-client-flow zöld). A PTR IIFE a teszt-sandboxban azonnal return-ol (`hasTouch` = false → nincs touch-event a JSDOM-mentes stubban), így nincs mit tesztelni belőle unit-szinten; a hozzáférhető szempontok (tartja a `_meData`-t stb.) érintetlenek.

---

## 2026-08-22 — Sofőr menetlevél: bon-scan orphan bin, „mentett" és „elkezdett" menetlevél összeolvasztása, pending-add popup

### Miért
Ha a sofőr rácsapott a `📷 Bon szkennelés (AI)` gombra, DE közben nem volt megkezdett menetlevele, a rendszer az `rrAccept`-nél **automatikusan létrehozott egy teljesen üres draft-ot** csak azért, hogy legyen hová tenni a scannelt tétel. Ez a következő menetlevél-nyitáskor mint „megkezdett menetlevél" jelent meg és folytatásra kínálta magát. Ráadásul volt egy külön „Mentett menetlevelek (telefonon)" szekció is (a manuális `saveLocalDraft`-hoz), ami két szinte azonos rendszert működtetett párhuzamosan → tipikus zavaró élmény. Ha a sofőr törölte a piszkozatot, a beírt / bon-alapú tankolás/vásárlás sorok **elvesztek**.

### Mit tesz
1. **Az `rrAccept` NEM hoz létre üres draft-ot** többé. Ha nincs step2 és nincs megkezdett draft → a scannelt tétel az **orphan binbe** (`vs_sofer_orphan_items`, per-sofőr localStorage) kerül. Van megkezdett draft → mint eddig, oda kerül.
2. **A menetlevél Plecare-je után új „📋 Korábbi tétel — hozzáadod?" popup** — az orphan bin sorai + a queue ready-státuszú scannelt bonjai egyetlen listában, alapból mind pipálva, `Mind` / `Egy sem` gyors-választással. `✓ Hozzáadás`: a kijelöltek a szerkesztőbe kerülnek + a forrásból (bin / queue + kép) törlődnek. `Kihagyás`: érintetlen, a beküldés előtt még egyszer szólunk.
3. **A törölt draft tankolás/vásárlás sorai megmaradnak** — `fuvarCreate` „TÖRLÉS"-ága és `discardDraft` egyaránt az orphan binbe menti az alim/ach sorokat, MIELŐTT a draft-ot törli (csak a valódi tartalmú sorokat, üres „➕" sorokat kihagyva). A következő menetlevél nyitásakor a popup magától felajánlja őket.
4. **„Mentett menetlevelek (telefonon)" szekció eltávolítva** — a sofer.html-ből a szakasz-fejléc + lista + a step2 `💾 Mentés a telefonra` gomb kikerült. Csak az automatikusan-mentett draft él (per-sofőr localStorage-ban, éppúgy mint eddig), tehát a sofőr NEM lát külön „mentett" és „elkezdett" listát. Az offline outbox mechanizmus háttérben tovább használja a `soferLoadLocalDrafts` array-t `pendingSubmit=true` jelzővel — funkcionálisan érintetlen, csak nincs manuális UI hozzá.
5. **Beküldés előtti figyelmeztetés** — a `_submitFuvarlevelFinal`-ban, a `wbConfirmOpen` ELŐTT: ha az orphan binben van olyan tétel, aminek DÁTUMA (óra nem számít, ahogy a felhasználó kérte) az indulás–érkezés napok közé esik, a `orphRangeModal` felugrik. A sofőr eldönti: `✓ Hozzáadás` (a menetlevélre + törlés a binből) / `🗑 Törlés` (nem ide tartozik, dupla-confirm-mel törli a binből) / `Mégse` (folytatja a beküldést, a bin változatlan).

### Szerver / DB
- **Nincs séma-változás, nincs új szerver-handler** — a fluxus tisztán kliens-oldali. A meglévő `scanReceipt` / `confirmReceiptExtraction` / `fuvarlevel-save` végpontok érintetlenek.

### Kliens
- **`public/sofer.js`** — új orphan-bin szekció (`LS_ORPHAN_KEY`, `orphanLoad/Store/AddAlim/AddAch/ClearAll/Count/SaveFromDraft`); új pending-add popup szekció (`_pendingAddRows` állapot, `_receiptToRow`, `_collectPendingAddItems`, `openPendingAddModal`, `pendingAddSelectAll`, `pendingAddConfirm`, `pendingAddSkip`, `_pendingAddClose`); új orphan-range szekció (`_orphanRangeItems`, `_openOrphanRangeModal`, `orphRangeAdd`, `orphRangeDelete`, `orphRangeCancel`, `_closeOrphRange`). Módosítva: `rrAccept` (no-draft → orphan bin), `fuvarCreate` (delete-ág → `orphanSaveFromDraft`), `discardDraft` (ua.), `_startFreshWaybill` (Plecare után `openPendingAddModal` → `fuvarStep2`), `fuvarStep2` (a `_pendingAddRows` konzumálása az alim/ach konténerbe), `_submitFuvarlevelFinal` (orphan-range check a `wbConfirmOpen` előtt).
- **`public/sofer.html`** — `#localDraftsBox` szekció-fejléc eltávolítva, a hordozó div `display:none`-ra váltva (a legacy `renderLocalDrafts` hívások nem törnek). `💾 Mentés a telefonra` gomb kivéve a step2-ből. Új modálok: `#pendingAddModal` (📋 Korábbi tétel — hozzáadod?) és `#orphRangeModal` (⚠️ Mentett tétel a menetlevél időszakában) — a projekt sof-modal mintáját követve (glass, ujjbarát gombok, világos/sötét téma).
- **`public/i18n.js`** — 15 új kulcs (`sof.pa.*` × 8 + `sof.or.*` × 6 + `sof.resume.discarded` átfogalmazva); az `sof.offlineHint` szöveg is átfogalmazva („nincs mentett vs. elkezdett — csak elkezdett" konvencióhoz igazítva). Cache-bust: `sofer.html` `sofer.js`+`i18n.js` `?v=20260822orphan`.

### Teszt
- **`tests/integration/sofer-client-flow.test.js`** +8 új eset a `describe('orphan bin — árva tankolás/vásárlás sorok megőrzése')`-ben: (a) rrAccept nincs draft → orphan binbe, NEM keletkezik üres draft; (b) rrAccept van draft → a draftba, orphan érintetlen; (c) `fuvarCreate` DELETE-ág → alim/ach az orphan binbe; (d) `discardDraft` → alim/ach átmenődik; (e) `orphanSaveFromDraft` üres sort NEM ment; (f) `_orphanRangeItems` DÁTUM-alapú (nem óra) szűrés; (g) `openPendingAddModal` üres kollekcióra azonnal callback; (h) van orphan → modal nyílik, `pendingAddSkip` → cb + bin érintetlen. **965 Jest zöld** (957 → 965, +8; 7 skip valós-DB), nincs regresszió.

### Jövőbeli takarítás (nem sürgős)
- A `saveLocalDraft` / `loadLocalDraft` / `deleteLocalDraft` / `renderLocalDrafts` függvények megmaradtak (az offline outbox mechanizmus + a `renderLocalDrafts()` hívások a kódban), de UI-ból eltávolítva. Ha az offline outbox-ot később külön adat-struktúrára cseréljük, ezek is elhagyhatók.

---

## 2026-08-21 — Szerviz-napló: Halasztás / Elvégezve modal + pipálható tétel-lista + jelzés-újratervezés

### Miért
Amikor a rendszer szerviz-esedékességet jelez (vezérlőpult sárga/piros sáv „🔧 Revizii scadente"), eddig csak egy `activateTab('service-log')` link volt — a felhasználó átment a szerviz-naplóra és kézzel új sort írt. Nem volt gyors út **halasztani** (pl. „még 2000 km múlva"), és nem volt strukturált mód rögzíteni, MIT csinált (olaj + olajszűrő + levegőszűrő stb.) — csak szabad szöveget.

### Mit tesz
1. **Vezérlőpult riasztási sáv chip-jei kattinthatók** (`renderDashServiceAlert`) — minden érintett jármű `🔧 rendszám — X km túllépve` chip-je gombként viselkedik: rákattintva a szerviz-esedékesség **döntés-modalja** nyílik (Halasztás vagy Elvégezve). A többi szó (🔧 ikon, cím) a szerviz-naplóra ugrik (régi viselkedés).
2. **Szerviz-napló táblán is új gombok** — minden nyitott (nem `closed_at`, van `next_due_*`) sornál `🕐 Halasztás` + `✅ Elvégezve` gomb a törlő mellett. Lezárt sor `🔒 Lezárva` badge, halasztott sor `🕐 N×` badge (postpone_count), pipált tételek `✓ N tétel` badge (tooltip a teljes lista).
3. **Halasztás-modal** — új dátum + új km mező + preset gombok (`+7 / +14 / +30 / +60 / +90 nap`, `+1000 / +2000 / +5000 / +10000 km`) + opc. megjegyzés (az `[Amânat] …` a leírás végére csatolódik, a régi tartalmat NEM írja felül). A régi sor `next_due_*` felülíródik, `postpone_count++`, `last_alert_at=NULL` (a scheduler újra tud jelezni a KÖVETKEZŐ esedékességnél).
4. **Elvégezve-modal** — dátum + km + leírás + költség + kategória + **pipálható tétel-lista** (Olaj / Olajszűrő / Üzemanyag-szűrő motorina / Levegőszűrő / Pollenszűrő / AdBlue szűrő / Levegőszárító szűrő / Fékbetét / Féktárcsa / Hűtőfolyadék / Váltóolaj / Differenciálolaj / Gumi / Ablaktörlő / Akkumulátor / Vezérműszíj) + `Egyéb` szabad-szöveg — 16 fehérlistás kulcs + `other`. A modal alján **következő esedékesség** blokk (új `next_due_date` + `next_due_km`, alapból mai + 1 év / aktuális km + 40 000 — felülírható). Ha egyik sincs kitöltve, dupla-confirm.
5. **A régi sor megmarad** — `closed_at=NOW()`, `closed_by_service_id=új_id`, `next_due_*=NULL` (a scheduler többé nem jelez rá); az új sor önálló bejegyzés a most elvégzett munkával + saját köv. esedékességgel — a szerviz-napló így teljes történetet mutat.

### Szerver
- **Új migráció `db/service-postpone-and-items.sql`** (idempotens): `vehicle_service_log.items JSONB DEFAULT '[]'` (pipált tételek fehérlistás kulccsal + `other` szabad-szöveg note), `postpone_count INTEGER DEFAULT 0`, `last_postponed_at TIMESTAMPTZ`, `closed_at TIMESTAMPTZ`, `closed_by_service_id INTEGER REFERENCES vehicle_service_log(id) ON DELETE SET NULL`.
- **`handlers/fleetCompliance.js` — 2 új RPC handler** (Admin/Manager, cégre szűrt, audit-elt, `_isAdminOrManager` szerep-kapu):
  - `servicePostpone(id, {next_due_date?, next_due_km?, note?})` — `UPDATE vehicle_service_log SET next_due_* = COALESCE(...), postpone_count++, last_postponed_at=NOW(), last_alert_at=NULL WHERE id=$1 AND company_id=$2 AND closed_at IS NULL`. Legalább egyik új érték (dátum vagy km) kötelező. A régi `description`-höz `[Amânat] <note>` fűződik (nem írja felül).
  - `serviceComplete(id, {service_date, km, cost_ron, description, category, items[], next_due_date, next_due_km})` — **tranzakcióban**: (a) `SELECT FOR UPDATE` cégre szűrve + `closed_at IS NULL`, (b) `INSERT` új sor a most elvégzett munkával + a friss `next_due_*` értékkel, (c) `UPDATE` régi sor `closed_at=NOW(), closed_by_service_id=<új_id>, next_due_km=NULL, next_due_date=NULL, last_alert_at=NULL`. A `_normalizeServiceItems` a bemenetet fehérlistázza (`SERVICE_ITEM_SET` — 17 kulcs), duplikátumokat szűr, note ≤120 char, max 32 tétel.
- **`serviceList` bővítve** — visszaadja az `items`, `postpone_count`, `last_postponed_at`, `closed_at`, `closed_by_service_id` mezőket + a válasz-tetején `item_keys` fehérlistát (a kliens innen tudja a modal-checkboxokat renderelni). A régi hívók visszafelé-kompatibilisek.
- **`serviceCreate` kiterjesztve** — új `items` mező (opc.), ugyanaz a `_normalizeServiceItems` fehérlistával, audit-elve.
- **`computeServiceDueAlerts`** — a `last_srv` WITH-CTE bővült `AND s.closed_at IS NULL`-lel → lezárt sor SOSEM jelez tovább (a scheduler push/e-mail/dashboard mind ebből dolgozik).

### Kliens
- **`public/fleet-extra.js`** — új közös segédek: `SVC_ITEM_KEYS_FALLBACK` (17 kulcs), `_svLastItems` + `_svItemKeys` + `_svModalItemId` state, `_svFindItem(id)` (szerviz-napló cache + dashboard riasztás-cache), `_svEnsureModal()` (a projekt `.modal-back` + `.modal.glass` mintája + kattintás-a-háttérre-bezár), `svCloseModal`, `_svOpen(id)` (fejléc-info: rendszám + márka/típus + km/dátum-esedékesség). Új publikus API: `svOpenDecide`, `svOpenPostpone`, `svPostDatePreset`, `svPostKmPreset`, `svSubmitPostpone`, `svOpenComplete`, `svSubmitComplete`, `svCloseModal`.
- **`renderDashServiceAlert`** — a chip-ek `svOpenDecide(id)`-ot hívnak (`event.stopPropagation()`), a többi kattintás a szerviz-naplóra ugrik. A dashboard `window._svAlertCache = r.items` — a modal a szerviz-napló betöltése nélkül is elérheti a jármű-adatokat.
- **`loadServiceLog` táblán** — új badge-ek (`✓ N tétel` / `🔒 Lezárva` / `🕐 N×`), a sor-akciók helyén 🕐 Halasztás + ✅ Elvégezve + ✕ Törlés; a lezárt sorok `opacity:0.75`.
- **`public/i18n.js`** — 45 új i18n kulcs (`fe.sv.decideTitle`/`postponeBtn`/`postponeHint`/`doneBtn`/`doneHint`/`postponeTitle`/`newDate`/`newKm`/`days`/`postponeNote`/`postponeNotePh`/`postponeSubmit`/`needDateOrKm`/`postponed`/`doneTitle`/`descPh`/`itemsHead`/`itemsShort`/`otherNote`/`otherNotePh`/`nextHead`/`nextHint`/`noNextConfirm`/`doneSubmit`/`completed`/`closed`/`postponeCountTip`/`currentNextKm`/`currentNextDate` + 17 `fe.sv.item.*` tétel-címke + `fe.dash.chipTip`) — RO-alap + HU. Cache-bust: `admin.html`/`manager.html` `i18n.js?v=20260821svcpost` + `fleet-extra.js?v=20260821svcpost`.

### Biztonság + Multi-tenant
- Minden új SQL `company_id=$X`-re szűr; a `serviceComplete` `SELECT FOR UPDATE` + `INSERT` + `UPDATE` cégre-szűrt tranzakcióban → idegen cég sora sosem érinthető.
- `_normalizeServiceItems` fehérlistázza a beérkező tömböt (ismeretlen kulcs csendesen eldobva, note ≤120 char, max 32 tétel) → nincs JSONB-injekció.
- `_isAdminOrManager` szerep-kapu ELŐBB, MINT `pool.connect()` (nincs kapcsolat-foglalás jogosulatlan hívásra).
- Audit minden íráson (`service.postpone`/`service.complete`/`service.create` — a régi + új id-vel + tétel-számmal).

### Teszt
- Új `tests/integration/service-postpone-complete.test.js` — 9 új eset: Sofer-tiltás, üres bemenet, sikeres halasztás (`postpone_count++`, `last_alert_at=NULL`, cégre szűrt WHERE), lezárt/idegen sor visszautasítása, Sofer serviceComplete-tiltás, tranzakciós ROLLBACK üres SELECT-nél, teljes lifecycle (BEGIN → SELECT → INSERT → UPDATE → COMMIT + fehérlista alkalmazása + `closed_by_service_id`), multi-tenant SELECT WHERE, `serviceList` visszaadja az `items` + `item_keys` mezőt.
- **957 Jest zöld** (948 → 957, 45 skip valós-DB), nincs regresszió.

---

## 2026-08-21 — Sofőr menetlevél: elvégzett állomások automatikus felvétele (nincs pipálgatás)

### Miért
A menetlevél kezdésekor a sofőr eddig egy pickerben kézzel pipálta ki, melyik fuvarok kerüljenek fel — közben a rendszer már tudta a sofőr állomás-gombjaiból (📍 odaért / 📦 elvégezte), hogy melyik felrakás/lerakás elvégzett. Kérés: a Plecare után automatikusan tegye fel az elvégzett (`done_at NOT NULL`, `waybilled_at IS NULL`) állomásokat, a Plecare pillanata után. A picker csak explicit „✏️ Fuvarok kezelése" gombra nyíljon.

### Mi történik most
1. **`_startFreshWaybill`** (fresh menetlevél) — Plecare-dialog után NEM nyit pickert. Meghívja az új `_autoCollectCompletedStops()`-ot: végigmegy a `_soferOrdersCache`-en, összeszedi a `done_at NOT NULL && !waybilled_at && done_at >= plecareStartIso` stopokat. Ebből épül a `_selectedOrderIds` és az új `_autoStopFilter = { since, byOrder: { orderId: {stopId:true,...} } }`.
2. **`_buildWaybillPuncteForOrder(o, filter)`** — új `filter` paraméter. Ha be van állítva, csak a filter által engedélyezett stopokat rakja fel (auto-collect: csak elvégzett; picker-diff: filter nélkül, teljes nem-waybill-ezett stopokkal). Így egy multi-stop fuvarnál a még NYITOTT lerakás nem szennyezi be a menetlevelet — az a következő kör témája, amikor a sofőr azt is elvégzi.
3. **`fuvarStep2`** — az `_autoStopFilter`-t átadja a `_buildWaybillPuncteForOrder`-nek. A Plecare és Sosire sor a régi módon jön (Plecare-dialog / draft-restore / submit-modal), közé kerülnek az elvégzett állomások (típus + helyszín + dátum).
4. **`_continueSavedDraft`** — a piszkozat folytatásakor sem nyílik automatikusan a picker; a mentett rows úgy maradnak, ahogy voltak. A sofőr utólag a step2 „✏️ Fuvarok kezelése" gombjával hívhatja elő a pickert (`fuvarPickAgain`).
5. **`_plecareStartIso()`** új segéd — Plecare időpont ISO stringben a stop-szűréshez (`YYYY-MM-DDTHH:MM:SS`). Prioritás: `_pendingPlecare` (frissen bekért) → DOM Plecare sor → `_plecareStartDay()`. Óra nélkül `00:00`.
6. **Visszavonhatóság kézben:** ha a sofőr félrenyomta az állomás-gombot, az admin a PR #322 „🔁 Lezárás visszavonása" + sofőr új idő-picker modal (PR-ok az elmúlt körökből) továbbra is működik. Az `_autoStopFilter` csak a jelenlegi menetlevél felépítésére hat, DB-ben nem tárolódik.

### Felület
- **Fresh menetlevél:** „📄 Menetlevél létrehozása" → Plecare-modal → EGYENESEN step2 (picker átugorva). Toast az első pillanatban: „✅ N elvégzett fuvar automatikusan hozzáadva" VAGY „Nincs Plecare óta elvégzett fuvar — üresen kezdesz".
- **Utólagos módosítás:** step2-ben „✏️ Fuvarok kezelése" gombbal a picker felnyílik (mint korábban), a diff filter nélkül dolgozik → a hozzáadott új fuvar TELJES nem-waybill-ezett stopokkal jön (a sofőr tudatosan felveszi a nyitott állomásokat is).
- **Piszkozat folytatása:** a picker automatikus felnyílása megszűnt — a mentett rows megmaradnak, a sofőr utólag módosíthatja.

### Fájlok
- `public/sofer.js` — új `_autoStopFilter`, `_autoCollectCompletedStops()`, `_plecareStartIso()`; `_startFreshWaybill` / `_continueSavedDraft` / `fuvarNoOrder` / submit-success mind reseteli az `_autoStopFilter`-t; `_buildWaybillPuncteForOrder(o, filter)`; `fuvarStep2` átadja a filtert.
- `public/i18n.js` — 2 új kulcs: `sof.auto.added`, `sof.auto.empty` (RO-alap + HU).
- `public/sofer.html` — cache-bust `?v=20260821autowb` (sofer.js + i18n.js).
- `tests/integration/sofer-client-flow.test.js` — 4 érintett teszt frissítve az új viselkedésre + 1 új eset (auto-collect üres → step2 mégis megnyílik).

### Teszt
- `npm test`: **948 Jest zöld** (45 skip valós-DB), sofer-client-flow suite 34/34 zöld (33 → 34, +1 új eset). Nincs regresszió.

---

## 2026-08-21 — Sofőr főoldal: élő jármű-akkumulátor feszültség a kiosztott jármű kártyán (CargoTrack GPS-ből)

### Miért
A sofőr csak az útközben derül ki, ha az akkumulátor gyengül (téli hidegben kritikus). A CargoTrack (Ruptela FM-Track) `coordinates` végpont a `calculated_inputs`-ban visszaadja a jármű akku-feszültségét — csak nem húztuk ki. Egy sor a saját jármű-kártyán elég ahhoz, hogy a sofőr induláskor lássa („🔋 12.4 V"), gyenge érték esetén figyelmeztetést kapjon.

### Mit
- **`services/cargotrack.js` `getLatestStatus` bővítés** — új `battery_voltage` mező a válaszban. Defenzív mezőnév-lista (`external_voltage`/`power_supply_voltage`/`ext_voltage`/`main_voltage`/`vehicle_battery_voltage`/`battery_voltage_ext`/`battery_voltage`/`voltage`) mind a `calculated_inputs` mind a `raw_inputs` bemenetből — a Ruptela eszközök eszközfüggően eltérő kulcsokon adják vissza. Ha egyik sem jön → null → a felület elrejti.
- **`lib/vehiclePositions.js` `getReadingsForPlate`** — átadja a `battery_voltage`-et; az `available` gate kiterjed rá (voltage-only eszköz sem esik ki „nem elérhető"-re).
- **`handlers/orders.js` `getCurrentGpsReadings`** — visszaadja a nyers `battery_voltage`-et (nincs korrekció, mint a fuel-nél; a kliens dönti el a küszöböt).
- **`public/sofer.js`** — új `_loadMyVehicleBattery(plate)` a `loadMyAssignedVehicle` VÉGÉN meghívva (best-effort, a jármű-kártya már látszik amikor kér); ha van érték, egy `.sof-batt-line` sor kerül a kártya végére: 🔋 X.X V, kettős küszöb-heurisztikával (>20V → 24V teherautó rendszer, warn <22.5V / danger <22.0V; ≤20V → 12V rendszer, warn <12.0V / danger <11.5V), színes érték + „acumulator slab" figyelmeztetés-badge. Ha a CargoTrack nem adja az értéket (eszközfüggő), a kártya változatlan.
- **Új i18n kulcs `sof.battWarn`** (RO „acumulator slab" / HU „gyenge akkumulátor"); cache-bust `sofer.js` + `i18n.js` `?v=20260821batt`.

### Nem érinti
- Az admin/manager Vezérlőpult térképe és a `getPositions` (nem hozza a voltage-et — a Vezérlőpult célja a pozíció-áttekintés, nem az eszköz-diagnosztika). A menetlevél záró km / fuel-lekérés érintetlen.
- Szerep-kapu változatlan: sofőr CSAK a saját kiosztott vontatójára kap voltage-et; admin/manager bármelyik cégen belüli vontatóra. Nincs cross-tenant szivárgás.

### Teszt
`getReadingsForPlate` mockolt a meglévő `sofer-handlers.test.js`-ben (a `battery_voltage` opcionális) → **947 Jest zöld** (45 skip valós-DB). Új teszt nem kellett; a felület a null-t elrejti (a régi mockok null-t adnak → a kártyához nem kerül új sor).

---

## 2026-08-20 — UIT-kód egyszerűsítés: 1 kitölthető mező kiíráskor + több UIT / fuvar + 📷 fotó→AI kiolvasás + képmegőrzés

### Miért
A régi UIT-kezelés több lépcsős volt (deep-link a szolgáltatóhoz, sofőr csak 0 UIT-ig adhatott hozzá, minden bevitel eltérő formátumú). A napi gyakorlat egyszerűbb: a diszpécser a fuvar-kiíráskor egy mezőbe beírja a UIT-ot, a sofőr a fuvar-kártyáján a 🚛 UIT gombra kattintva egy bezárható ablakban látja, és papírról több kódot is felvihet — kézzel vagy 📷 fotóval, az AI-kiolvasás mindegyiket felismeri.

### Mit
- **Új `lib/uitFormat.js` + `public/uit-format.js`** — közös UIT-formázó: normalizál (uppercase + csak A-Z0-9 + max 16 kar.), formáz („XXXX-XXXX-XXXX-XXXX", 4-esével kötőjel), és az input-mezőre köti az élő formázást (kurzor-pozíció-megőrzéssel). A DB-be normalizált forma kerül, a felület mindig formázottan mutatja.
- **Új `handlers/uitScan.js` (`scanUitFromImage` RPC, registry-be regisztrálva)** — a papírra írt UIT-ot Gemini-vel kiolvasás; `codes[]` tömböt ad (több kód/fotó, duplikátum-szűrt, ≤ 20). Kapuk: Sofer|Admin|Manager + `ai-kiolvasas` csomag-flag + `GEMINI_API_KEY`. Max 8 MB, kép-only (PDF nem). Audit CSAK metaadat (a base64 SOHA nem kerül logba/DB-be).
- **`routes/uit.js` bővítés** — a bemenetet `normalizeUit` szűri (kötőjelek/szóközök kivágva); a `/api/orders/:id/uit` (Admin/Manager) és `/api/sofer/orders/:id/uit` (Sofer) elfogad `photo_b64`/`photo_mime`/`source` mezőket; a sofőr MOSTANTÓL TÖBB UIT-ot is felvihet (a régi „csak ha 0 van" korlát megszűnt); új `GET /api/uit/:uid/photo` a képet inline data-URL-ként adja, auth-védett.
- **`db/order-uit-photo.sql`** (idempotens migráció) — `order_uit_codes` új oszlopai: `photo_b64 TEXT`, `photo_mime TEXT`, `source TEXT DEFAULT 'manual'`. Auto-fut induláskor.
- **`handlers/orders.js` `comCreate`** — új `uit_codes` payload-mező (array); a fuvar mentése után best-effort UIT-beszúrás `order_uit_codes`-ba (`source='manual'`). Hibaesetén a fuvar mentve marad, a UIT-et utólag is felviheti.
- **`public/admin.html` + `public/manager.html`** — fuvar-kiírás űrlap új `#oUit` mezője (auto-format), és a fuvar-szerkesztő (`orderEditModal`) új UIT-blokkja: input + ➕ Hozzáadás + lista a meglévőkről (kép-linkkel + törlővel). A `console-shared.js` `createOrder` és `openOrderEdit`/`loadOeUitList`/`oeAddUit`/`oeDeleteUit` bekötve.
- **`public/order-wizard.js`** — a Step 5 (Ár és távolság → most „Ár, távolság és UIT") elfogadja a `#oUit` mezőt; a review-lapon is szerepel a formázott UIT.
- **`public/sofer-uit.js`** — teljes átírás: bezárható modal (💠 X gomb, backdrop-click), lista a fuvar UIT-jaival (📷 AI vs. ✋ kézi + 🖼️ fotó-megnyitás + 🔗 deep-link), új „📷 Fotó" gomb (mobil-kamera → canvas 1600px JPEG q=0.85 → Gemini → minden felismert kódra külön mentés a fotóval). Élő formázás (`UitFmt.attach`) az input-on.
- **`public/uit-panel.js`** — ugyanazon UX az Admin/Manager oldalon (⋯ → UIT-kódok gomb). Egységes stílus, kép-megnyitás, 📷 gomb, deep-link.
- **`public/i18n.js`** — új kulcsok: `form.uit`/`form.uitHint`/`form.uitPh`, `edit.uit`/`edit.uitHint`/`edit.uitAdd`/`edit.uitEmpty`, `cs.uit.needCode`/`cs.uit.added`/`cs.uit.delConfirm` (RO-alap + HU). Az `oc.step5Title` „Ár, távolság és UIT" névre bővült.
- **Cache-bust**: `admin.html` + `manager.html` + `sofer.html` — `i18n.js`/`console-shared.js`/`sofer-uit.js`/`uit-panel.js`/`order-wizard.js` → `?v=20260820uit`, `uit-format.js` bekötve.

### Teszt
- **947 Jest zöld** (926 → 947, +21 új):
  - `tests/unit/uit-format.test.js` (11): normalizál (kötőjel/szóköz/ékezet/max 16), formáz (4-es blokkok), validál (üres/kizárólag jelek → invalid).
  - `tests/unit/uit-scan.test.js` (10): szerep/env/csomag kapuk, MIME-fehérlista, `_sanitize` (kötőjel-eltávolítás, duplikátum-szűrés, hosszú lista → 20-ra vág), Gemini mock-út (siker + 429 hiba).
- **135 modul require-sweep zöld**; **17 web-smoke** eset zöld — a `routes/uit.js` új végpontjai (`/api/uit/:uid/photo`) és a `handlers/uitScan.js` a route-listába tisztán bemount.

### Biztonság / adatszivárgás
- Minden UIT-lekérdezés `company_id`-szűrt; a `_sanitizePhoto` MIME-white-list + méret-limit (8 MB).
- A fotó tárolt formája base64 az `order_uit_codes.photo_b64`-ban, csak auth-védett endpoint (`/api/uit/:uid/photo`) adja ki, ownership-ellenőrzéssel.
- A Gemini-hívás base64-je SOHA nem kerül audit-logba/DB-be — csak a hívás alatt él memóriában.
- A UIT-input hosszkorlát a szerveroldalon (`normalizeUit` → 16 kar.) is érvényes (kliens-oldali maxLength=19 csak UX).

---

## 2026-08-20 — Sofőr fuvar-kártya: 📋 vágólap-másoló gomb visszatért a felrakó/lerakó cégre és címre (multi-drop is)

### Miért
Az előző körben (CMD → olvasható formátum) a sofőr fuvar-kártyájának kinyíló részén ELTŰNT a 📋 vágólap-másoló gomb a helyszín, cég és megjegyzés mezőkről — pedig ez a napi művelet (a sofőr a felrakó/lerakó cég címét beteszi a navigációba). Gyökér-ok: a MIGRÁLT (multi-drop) fuvarok a `_stopRows(s)` úton mennek, amely `copyKind=null`-t adott át a `detRow`-nak → a `soferCopy` gomb suppress-elődött. A régi (nem-migrált) fuvarnál a legacy ág `'load'`/`'unload'` copyKind-et adott — ott működött, de a cég-mezőre AZ SEM.

### Mit
- **`public/sofer.js`** `_fuvarCopy[o.id]` bővítése — a legacy `load`/`unload`/`note` mellett új kulcsok: `load_firma`/`unload_firma` (legacy cég-nevekhez), és minden per-stop `pickup_<i>_loc`/`pickup_<i>_firma`/`delivery_<i>_loc`/`delivery_<i>_firma` (a `o.stops` tömbből, `pickup`/`delivery` szeparált 0-alapú indexszel, `stop_index` szerint rendezve). Így multi-drop fuvarnál MINDEN felrakó/lerakó cége és címe külön másolható.
- **`_stopRows(s, kind, idx)`** aláírás-bővítés: a helyszín ÉS a cég 📋-gombja csak akkor jelenik meg, ha a mező nem üres (`s.firma ? firmaKey : null`). A dátumhoz továbbra sincs 📋-gomb (nem szokás vágólapra tenni).
- **Legacy (nem-migrált) ág** — `loadSec`/`unloadSec` `detRow('sof.det.company', …)` mostantól `'load_firma'`/`'unload_firma'` kulcsot ad üres cégnél `null`-lal (nem villan felesleges gomb). A `note` (`ref`) továbbra is másolható.
- **`soferCopy(id, kind)`** változatlan (map-lookup + Clipboard API + textarea-fallback + toast) — a bővítés az adat-oldalon van.
- **Cache-bust**: `sofer.html` `sofer.js` → `?v=20260820copy`. `soferCopy` XSS-biztos marad: a kulcs (a copyKind string) beépített, nem user-input; az érték a MAP-ből jön, HTML-escape a toast-szövegre nem kell (a Clipboard API nem HTML-t másol).

### Teszt
- **924 Jest zöld** (nincs regresszió).
- Kézi trace: multi-drop fuvar (`o.stops = [{pickup,idx:0,loc:'Arad',firma:'ACME'},{delivery,idx:1,loc:'Cluj',firma:'Beta'}]`) → `_fuvarCopy[id]` tartalmaz `pickup_0_loc='Arad'`/`pickup_0_firma='ACME'`/`delivery_0_loc='Cluj'`/`delivery_0_firma='Beta'` → mindegyikre 📋 megjelenik, kattintásra a `soferCopy` a helyes szöveget másolja.

---

## 2026-08-20 — Sofőr fuvar-lista + kezelés-tábla átláthatóság: CMD-azonosító helyett dátum · cég · város

### Miért
A sofőr felület három helyén (dokumentum-feltöltő fuvar-választó, menetlevél-picker modal, főoldali fuvar-kártya) a fuvart a belső, véletlen `orders.id` (pl. `CMD-MT181GD5NBL`) + teljes utca+irsz+ország cím azonosította. Ez a mobil-viewporton (kis fuvar-választón is) 2-3 sort tolt egyetlen fuvarra, a CMD-kód semmit nem mondott a sofőrnek, a hosszú cím pedig eltakarta a lényeget (mikor · kinek · hova). Kérés: helyette **felrakás dátum · cég · város → lerakás dátum · város · cég**; a rendszer maga ismerje fel a város-nevet a teljes címből (a fuvar-űrlapon nincs külön város-mező). Emellett a fuvar-kezelés (admin/manager) első cellájában a „CMD-szám" mostantól **kizárólag a rendszer által kiosztott, ember-olvasható `fuvar_no`** (CMD-YYYY-XXXX) — a belső, véletlen id NEM kerül a cellába.

### Mit
- **`public/sofer.js`** — új `_cityOf(loc)` heurisztika (a fejléc-`esc` mellett): vesszőnkénti bontás, kiszűri a street-prefixeket (`Strada`/`Bd.`/`Calea`/`Aleea`/`Sat`/`Cart.`/…), az irányítószámot (önmagában és „555400 Copșa Mică" vezetéken), az ország-nevet (RO/HU/DE/…), a „cod NNNNNN" / „cp NNNNNN" / „irsz." típusú postal-prefixet és az önálló házszámot; az első maradék rész a város. Ha csak megye („Jud. Covasna") marad, azt tartja fallback-nek. Backward-compat: csak-város input érintetlen. 13 verifikációs eset zöld.
- **Menetlevél-picker modal** (`_openOrderPicker`, `sofer.js`): op-item eddigi `<b>o.client</b> 📅 date → date` + `📍 loc_incarcare → loc_descarcare` helyett új kétsoros olvasható formátum — `📅 dátum · 🏢 firma_incarcare · 📍 város  ↓  📅 dátum · 📍 város · 🏢 firma_descarcare`. Fázis-badge / „⚠️ lezáráshoz kell" / rendszám érintetlen.
- **Dokumentum-feltöltő fuvar-választó** (`loadDocOrderOptions`, `sofer.js`): a `<option>` szöveg mostantól `dátum · cég · város  →  dátum · város · cég` — a value (`o.id`) változatlan, tehát a fetch payload érintetlen.
- **Sofőr főoldali fuvar-kártya** (`renderFuvarCard`, `sofer.js`): összecsukott fejléc új felépítése — `#N` sorszám-badge + `<span class="fuvar-head-pick">…</span> → <span class="fuvar-head-drop">…</span>`; a `📅 nap · 🏢 cég · 📍 város` mindkét oldalon. Bővített nézet (`metaHtml`) — kiszedve az `<span>#o.id</span>` (belső CMD-azonosító), marad a kamion + státusz. A `sof.det.company`/`sof.det.date` már meglévő i18n kulcsokat használjuk.
- **(Rejtett) `loadSoferOrders` lista** (`sofer.js`): a `soferOrderList` DOM display:none-ban van (PR #294 óta), de a jövőbeli visszakapcsolhatóság miatt itt is átvezetve az olvasható formátumra.
- **Fuvar kezelés (admin/manager) idCell** (`renderFilteredOrders`, `console-shared.js`): `c.fuvar_no ? '<b>'+fuvar_no+'</b>' : '<b class="text-muted">—</b>'` — a régi fallback (belső véletlen `orders.id` a cellába) törölve; támogatáshoz továbbra is a `title` tooltipben marad. A régi „Cancelled orders" fuvarlista `idCell`-e (`getCancelledOrders`) érintetlen — az is `fuvar_no`-t részesíti előnyben; visszaesési fallback ott marad, mert az anulált fuvar szerkeszthetetlen.
- **`public/sofer.css`** — új `.fuvar-headtxt .fuvar-head-pick/.fuvar-head-drop/.fuvar-head-arrow` szabályok: asztalon egysoros ` → ` nyíllal, `@media (max-width:640px)` alatt a felrakás és lerakás külön sorra, a nyíl középre. Nincs layout-változás a többi elemen.
- **Cache-bust**: `sofer.html` `sofer.js`+`sofer.css` `?v=20260820rocity`; `admin.html`+`manager.html` `console-shared.js?v=20260820rocity`.

### Teszt
- **924 Jest zöld** (nincs regresszió). A `_cityOf` heurisztika 13 külön eset (RO/HU/rövid/hosszú/házszám/megye-fallback/„cod NNNNNN") mind zöld.
- Node-harnesszel a `_openOrderPicker` sor-renderelő stringje verifikálva a screenshoton szereplő címekkel (`Strada Pictor Rosenthal, 107061, Ploiești, România` → `Ploiești`; `Strada Uzinei, 555400 Copșa Mică` → `Copșa Mică`; `Strada Poetului 101B, 310479, Arad, România` → `Arad`).

---

## 2026-08-20 — Wizard top-tools: kompakt egy-soros elrendezés mobilon és PC-n (PR #329)

### Miért
A PR #328 után a két „belépő" gomb (📄 AI kiolvasás + 📥 CSV import) egymás mellé került, DE mobil-viewporton (390px) a `flex-wrap: wrap` engedte őket alá törni, és a hosszú feliratok kilógtak a viewportról. Kérés: mobilon is mindig egymás mellett, kompaktabb, a felirat 2 sorban is elférjen.

### Mit
- **`public/style.css`** `.oc-top-tools` `flex-wrap: wrap → nowrap` (mindig egy sorban); a boxok `flex:1 1 0 + min-width:0 + display:flex; flex-direction:column` (az AI-status doboz az AI-gomb ALATT marad, nem szélesíti a row-t). Gombok kisebbek (`padding:8px 10px !important; font-size:12px !important; line-height:1.25 !important; min-height:48px; box-sizing:border-box`), és a felirat sortörhető (`white-space:normal !important; word-break:break-word; overflow-wrap:anywhere`) — a „Megrendelő feltöltése + AI kiolvasás" / „CSV import — több fuvar egyszerre" szépen 2 sorban ül.
- **Mobil-tuning** `@media (max-width:520px)`: `.oc-shell` `padding:22→14px; border-radius:16→12px`; `.oc-top-tools` `gap:8→6px`; gombok `padding:8×6px; font-size:11px; min-height:52px`. A shell-en `box-sizing:border-box; max-width:100%; overflow:hidden` — soha nem lóg túl a viewporton.
- **`public/admin.html` + `manager.html`** — cache-bust `style.css` → `?v=20260820wiz3`.

### Teszt
- Vizuális ellenőrzés headless Chromiummal — 480px szélességű viewporton a shell 453px, mindkét gomb 209px, felirat 2 sorra tördel, semmi nem lóg túl; 1400px-en egy soros, kompakt.
- Nincs JS-változás → tesztek változatlanul zöldek.

---

## 2026-08-20 — Wizard top-tools: CSV import + AI kiolvasás egymás mellett, hint nélkül (PR #328)

### Miért
A wizard tetején a két „belépő" gomb (📥 CSV import + 📄 Megrendelő feltöltése + AI kiolvasás) eddig egymás alatt volt, és mindegyik alá ki volt írva egy apró szürke hint (pl. „gyári fuvarlista (.csv) — oszlop-párosítással" / „PDF / JPG / PNG — az AI kitölti a mezőket, a fájl a fuvarhoz csatolódik"). Kérés: legyen a két gomb egymás mellett, és a hint alattuk NE látszódjon — a gomb-felirat elég önmagában.

### Mit
- **`public/style.css`** `.oc-top-tools` — `flex-direction: column → row` + `flex-wrap: wrap` (mobilon még mindig két sorra tud törni); `align-items: flex-start`. Új szabály: `.oc-top-tools .text-muted { display:none }` — a legacy `#ordersImportBtnBox` + `#ordScanBtnBox` box-okban lévő hint-spaneket elrejti. Az AI-scan élő állapot-doboz (`#ordScanStatus`) továbbra is az AI-gomb ALATT marad, mert az futásidejű visszajelzés.
- **`public/admin.html` + `manager.html`** — cache-bust `style.css` → `?v=20260820wiz2`.

### Teszt
- Vizuális ellenőrzés headless Chromiummal — a két gomb egymás mellett a wizard tetején, hint-textek nem látszanak, layout kompakt.
- Nincs JS-változás → 924 Jest zöld megmarad (a wiz PR-ben már bizonyítva).

---

## 2026-08-20 — Fuvar-kiírás wizard: 5 lépéses folyamat + PDF-szerű ellenőrző lap (PR #327)

### Miért
Az admin/manager **Fuvar → Kiírás** oldalán eddig egy hosszú, egyoldalas űrlap volt (ügyfél, referencia, sorozat, ár, km, súly, FTL/LTL, méretek, felrakó/lerakó cím+cég+dátum, extra multi-drop pontok külön blokkban, sofőr-radio, belső/külső sofőr, vontató, pótkocsi, egy nagy „Mentés" gomb) — sok mező egyszerre, a több felrakó/lerakó pont pedig egy külön „TÖBB FELRAKÁSI / LERAKÁSI PONT" szekcióban, elszigetelten. Kérés: **lépcsős menetű kiírás** — egyesivel/csoportosítva dobja fel a mezőket, a felrakó/lerakó pontokat pedig **egységes, egymás után adódó kártyaként**, minden ponthoz X-elés (felrakó vagy lerakó) + saját adatok, és a végén egy **PDF-szerű ellenőrző lap** minden szekció mellett „✏️ Javítás" gombbal + a fel/lerakó pontok fel/le átrendezhetők, ha a sorrend nem lenne jó.

### Mit
1. **Új `public/order-wizard.js`** (~430 sor) — wizard motor:
   - `ocInit()` átveszi a `.pane[data-pane="orders-form"]`-t: elrejti a legacy `.glass` panelt, létrehozza az `#ocWizardShell`-t (AI-scan + CSV-import a tetején, progress-sáv, 6 step, alul `[← Vissza] [Tovább →]` / `[✅ Fuvar mentése]` nav).
   - **A legacy `.field`-eket / blokkokat átmozgatja (`.appendChild`) a step-body-kba** — id-k változatlanok, az összes meglévő JS (client-picker, ANAF, autocomplete, jármű/sofőr-választók, `refreshDimReq`, `loadTypeExclusive`, `onSoferTypeChange`, `orderRouteRecalc`) továbbra is működik.
   - **Step 1 (Ügyfél)** — client-picker + ref + sorozat. **Step 2 (Állomások)** — **SAJÁT UI** kártya-listával (⬆⬇✕ átrendezés + ⬆️ Felrakás / ⬇️ Lerakás X-toggle + helység + cég + dátum + opc. idő; a wizard `vsAttachAutocomplete` + `FavLocations.attachPicker`-t hív a saját input-jaira). **Step 3 (Áru)** — FTL/LTL + súly + méretek. **Step 4 (Kiosztás)** — sofőr-radio + belső/külső sofőr + vontató/pótkocsi. **Step 5 (Ár és távolság)** — ár + km (🗺️).
   - **`_commitStopsToLegacy()`** — a wizard `_ocStops[]` listáját a Tovább pillanatában a legacy mezőkbe szinkronizálja: első pickup → `oLoad`/`oLoadFirma`/`oLoadDate`, első delivery → `oUnload`/`oUnloadFirma`/`oUnloadDate`, a többi → `oExtraStopsList` a meglévő `addExtraStopRow` hívással. Fordított irányban (`_syncStopsFromLegacyIfEmpty`) az AI-scan / CSV-import által kitöltött legacy mezőket a wizard-listába szippantja.
   - **Step 6 (Ellenőrzés)** — **PDF-szerű review**: fehér oldal-szerű dokumentum, minden szekció mellett `✏️ Javítás` gomb (`ocGoStep(N)` visszaugrik az adott step-re), a végén nagy `✅ Fuvar mentése` — ami a MEGLÉVŐ `createOrder()`-t hívja (payload/formátum + szerver-oldal 100%-ban változatlan; multi-stop `pickups[]/deliveries[]` a szerverre változatlan). Sikeres mentés után `_ocStops` üres, wizard step 1-re visszaáll.
   - **Validáció** — step 1: ügyfél kötelező; step 2: legalább 1 felrakó + 1 lerakó; step 3: FTL/LTL kötelező (LTL-nél méretek is), kliens + szerver ugyanaz.
2. **`public/style.css` wizard blokk** — `.oc-shell` / `.oc-progress` (6 pöttyes sáv, aktív gradiens, kész zöld pipa) / `.oc-step-*` / `.oc-stops` + `.oc-stop-card` (kártya + fel/le/✕ gombok + toggle-sor) / `.oc-review` + `.ocr-doc` (PDF-szerű fehér oldal, sötét téma is), világos + sötét téma-érzékeny, reszponzív ≤820px (progress-címkék elrejtve, kártya 2 oszlop) / ≤520px (kártya 1 oszlop, nav-gombok flex).
3. **`public/i18n.js`** — 30+ új `oc.*` kulcs (`oc.step1Title`..`oc.step6Title`, `oc.p1`..`oc.p6`, `oc.back`/`next`/`submit`/`edit`, `oc.stopsHint`/`addPickup`/`addDelivery`/`pickup`/`delivery`/`moveUp`/`moveDown`, `oc.stopLoc`/`stopFirma`/`stopDate`/`stopTime`, `oc.noStops`/`needStops`, `oc.reviewTitle`/`reviewHint`, `oc.pickupCount`/`deliveryCount`) — mind RO-alap + HU.
4. **`public/admin.html` + `manager.html`** — `order-wizard.js` script include a szerep-JS előtt; cache-bust `style.css`/`i18n.js`/`admin.js`/`manager.js` → `?v=20260820wiz`.
5. **`public/admin.js` + `manager.js`** — a `loadTab('orders-form')` most: `loadOrderFormData(); mountClientPicker(); populateOrderSeriaSelect(); setTimeout(ocInit, 0);` (a wizard mount a legacy mezők DOM-ba kerülése UTÁN fusson).

### Miért működik / miért nem törnek a meglévő funkciók
- A wizard **kizárólag a UI-t rendezi át** — a `createOrder()` payloadja, a `comCreate`/`bulkCreateOrders`/inbound-`/approve` szerver-oldal érintetlen. A multi-stop `pickups[]/deliveries[]` logika (`db/order-stops.sql`, `lib/orderStops.js`) változatlan.
- Az id-k (`#oClient`, `#oLoad*`, `#oUnload*`, `#oExtraStopsList`, `#oFtl`/`#oLtl`, `#oInternDriver`, `#oCamionSelect`, `#oExternNume`, stb.) mind megmaradnak → a `client-picker.js`, `orderScanFill()` (AI-kiolvasás), `openQuickVehicle()`, `filterInternDrivers()`, `filterCamions()`, `refreshDimReq()`, `loadTypeExclusive()`, `orderRouteRecalc()` mind ugyanúgy találkoznak a mezőikkel.
- Az AI-scan (megrendelő PDF feltöltés → Gemini kiolvasás) és a CSV-import gombok a wizard **tetején mindig láthatók** (a legacy `#ordScanBtnBox` + `#ordersImportBtnBox` átmozgatva); a scan a legacy `oLoad`/`oUnload`/... mezőkbe ír, amit a step 2 megnyitásakor a `_syncStopsFromLegacyIfEmpty` a wizard-lista kártyáiba szippant → **a felhasználó a wizardon látja, amit az AI kiolvasott**.

### Teszt
- **924 Jest zöld** (56 suite, 7 skipped valós-DB) — nincs regresszió a szerver-oldalon (a wizard tisztán kliens).
- **Szintaxis-check** (`new Function`) — zöld.
- **Jsdom integrációs teszt** (`scratchpad/wizard-integration.js`): mount + step-body-populálás (client, ref, sorozat / driverType / vehicles / pret / km); wizard-step2 saját UI (`#ocStopsList` létrejön); add-stops (pickup + delivery); ⬆⬇ reorder (index-swap); kind-toggle (pickup↔delivery); validáció: üres ügyfél / hiányzó FTL-LTL → blokkol + toast; `_commitStopsToLegacy` — első pickup a `oLoad`-ba, első delivery a `oUnload`-ba, `oLoadDate=2026-08-25T00:00`, extra delivery a `#oExtraStopsList`-be (`addExtraStopRow` hívva); review-lap tartalma (Test Kft / Arad / Bucuresti / Cluj / FTL) + `ocGoStep(1..5)` edit-gombok mind renderelve — **minden zöld**.
- **Vizuális ellenőrzés** headless Chromiummal — a wizard-shell, a progress-sáv, a stops-kártyák és a PDF-review együttesen olvasható és arányos (mockup a 2. és 6. lépésről).

### Kompatibilitás
- **A régi funkciók mind megmaradnak** — csak a menete változott. A tervezőtáblás/radaros kiosztás, az AI-scan, a CSV-import, a szerkesztő-modal (`openOrderEdit`) érintetlen.
- **Kikapcsolható a wizard?** Nincs feature-flag rá (nem kértél) — a menete végig egységes. Ha később ki kell kapcsolni, elég az `ocInit()` hívást kikommentelni a `loadTab`-okban → a legacy `.glass` visszakerül `display:''`-re.

---

## 2026-08-06 — CargoTrack GPS whitelist-figyelő (`services/cargotrack-monitor.js`) + Fly egress IP allokálva

### Miért
A CargoTrack (Ruptela FM-Track) **2026-08-04-től IP-alapú hozzáférés-védelmet** aktivált a Public API-hoz. 2026-08-20-ig el kellett küldeni a szerver kimenő IP-jét, különben a GPS-integráció (`services/cargotrack.js` → `api.fm-track.com`) lehal. Elvégezve: allokáltunk egy dedikált Fly-egress IPv4-et (`209.71.106.103`) + IPv6-ot (`2a09:8280:e612:1:0:138:b1f1:0`) `fra` régióra, és megküldtük mind CargoTrack-nek, mind Ruptelának. **Utólagos biztonsági háló**: az API-hívások 401/403 státuszainak figyelése — ha mégis kiesnénk a whitelistből, e-mailt kapunk.

### Változások

#### 1) Új Fly.io GitHub Actions workflow (PR #324 + #325)
- `.github/workflows/fly-egress-ip.yml`: manuálisan indítható (workflow_dispatch), a meglévő `FLY_API_TOKEN` secrettel allokál dedikált egress IP-t.
- Két mód: `list` (csak listáz), `allocate` (allokál a `fra` régióra).
- Mobilról használható a GitHub Actions felületről — nem kell Termux/flyctl a telefonra.
- PR #324 először a deprecated `fly machine egress-ip allocate` (per-gép) paranccsal → PR #325 lecserélte a modern `fly ips allocate-egress -a vallorsoft -r fra` (app-scoped, per-régió) parancsra. Költség: **1 × $3.60/hó** (IPv6 ingyen jár mellé), régiónként max 64 gépet kiszolgál.

#### 2) Új `services/cargotrack-monitor.js` — hitelesítési hiba-figyelő
- `recordAuthFailure(status)` — a `services/cargotrack.js` `fmGet`-je hívja minden 401/403 válaszra. Fire-and-forget, sosem dob.
- Rolling window (10 perc) + küszöb (3 hiba) + debounce (6 óra) — egy riasztási burstből EGY e-mail megy, utána 6 órán át néma.
- Az e-mail a `DEV_NOTIFY_EMAIL` env-re (fallback: `vallorsoft@gmail.com`) megy a KÖZÖS VallorSoft Brevo feladóról (`sendClientEmail`), tartalmazza a valószínű okot (IP-whitelist / kulcs-visszavonás) + a Fly egress IP-t + teendő-listát.
- Konfigurálható env-vel: `CARGOTRACK_ALERT_WINDOW_MS` / `_THRESHOLD` / `_DEBOUNCE_MS` (alapok: 10 perc / 3 hiba / 6 óra).
- **Nincs séma-változás, nincs DB-függőség** — process-live in-memory state.

#### 3) `services/cargotrack.js` bekötés
- Csak 3 sor változás: `const _monitor = require('./cargotrack-monitor')` + `try { _monitor.recordAuthFailure(res.status); } catch(_){}` a `!res.ok` ágban. Az fmGet kimenő viselkedése változatlan (a monitor sosem dob).

### Teszt
- Új `tests/unit/cargotrack-monitor.test.js` — **10 új eset**: küszöb alatt / küszöb elérésekor / env-fallback / debounce / debounce lejárta után / ablakon kívüli hibák / csak 401-403 / e-mail-küldés dobás elnyelése / nem-számbeli status / `fmGet` integrációs bekötés.
- **Teljes suite 924 zöld** (913 → 924).

### Fájlok
- `services/cargotrack.js` (bekötés, 3 sor)
- `services/cargotrack-monitor.js` (ÚJ, ~90 sor)
- `tests/unit/cargotrack-monitor.test.js` (ÚJ, ~130 sor)
- `.github/workflows/fly-egress-ip.yml` (ÚJ; PR #324 + #325 külön PR-ek)

---

## 2026-08-06 — Admin milestone-szerkesztő + 🔁 „Lezárás visszavonása" — a beragadt fuvarok javítására

### Miért
A PR #322-vel a jövőbeli menetlevél-beküldések már nem tudják automatikusan Finalizat-ra váltani a driver-owned fuvart — DE a **régi bug által már beragadt** fuvarokat javítani kell tudni admin-oldalról. A `CMD-MS8NDEHONVF` kép ezt mutatja: `descarcat_at = 03.08 15:00` (a régi bug tette be a puncte-sor `data:'2026-08-03'`-ból), miközben a driver 05.08 23:43-kor tényleg megérkezett a lerakóhoz — de a `descarcat_at` már be volt égve, így a driver nem tud továbblépni, és a fuvar `Finalizat`-ban ragad inkonzisztens időpontokkal.

### Változások

#### 1) Admin milestone-időbélyeg-szerkesztő (`handlers/orders.js` `comUpdate`)
- A `comUpdate` új opcionális mezőket fogad: `sosit_incarcare_at`, `incarcat_at`, `sosit_descarcare_at`, `descarcat_at`.
- ISO string → parseolt `timestamptz` az UPDATE-be; `null` / `''` → `SET oszlop = NULL` (törlés). Érvénytelen érték → némán skip (a többi mező akkor is menthető).
- Bit-azonos a többi mezővel (`values.push`/`updates.push`), Admin/Manager-only kapu változatlan.

#### 2) 🔁 `resetOrderMilestones(orderId, { scope })` új handler
- **Admin/Manager only**, cégre szűrt, audit-naplózott.
- `scope: 'unload'` (alapértelmezett): a **lerakó-ágat teljesen NULL-ra hozza** — `orders.sosit_descarcare_at` + `descarcat_at` + minden `delivery` `order_stops.arrived_at`/`done_at`/`waybilled_at`. Ha a fuvar `Finalizat` volt, `In Curs`-ra visszaáll (`finalized_at` is NULL). A felrakó ág érintetlen.
- `scope: 'all'`: teljes reset (mind a 4 milestone + minden stop). A státusz az eredeti hozzárendelés szerint (Alocat / Extern / Disponibil).
- A `order_stops` reset szükséges, mert a mirror-trigger a következő stops-mutációkor visszaírná a NULL-ra állított `orders.*_at`-ot.

#### 3) UI (`public/admin.html` + `manager.html` + `console-shared.js` + `i18n.js`)
- Fuvar-szerkesztő modal új **„🚚 Sofőr-állomás időpontok"** blokk: 4 `datetime-local` mező, előtöltve a fuvar `sosit_incarcare_at` / `incarcat_at` / `sosit_descarcare_at` / `descarcat_at`-ból (helyi időzóna).
- **🔁 „Lezárás visszavonása"** gomb (borostyán/warn) a blokk fejlécén — dupla-confirm után `resetOrderMilestones` `scope:'unload'`.
- Mentéskor (`saveOrderEdit`): a 4 mező bekerül a `comUpdate` payload-jába (üres → `null`, különben ISO).
- 8 új i18n kulcs (`oe.milestonesHead/Hint/sositIncarcare/incarcat/sositDescarcare/descarcat/resetUnload/resetUnloadConfirm/resetUnloadDone`, RO-alap + HU).

### Teszt
- **913 Jest zöld** (45 skipped valós-DB, +7 új):
  - `orders.test.js` +2: `comUpdate` milestone-mezők (érvényes ISO → UPDATE, `null` → SET NULL; érvénytelen → némán skip).
  - `orders.test.js` +5: `resetOrderMilestones` (Sofer 403, Anulat elutasítás, `unload` NULL-ozás + Finalizat→In Curs, `all` mind + státusz-visszaléptetés, invalid scope).
- Cache-bust: `console-shared.js?v=20260806mile`, `i18n.js?v=20260806mile` (admin + manager).

### A `CMD-MS8NDEHONVF` javítása
1. Admin/Manager megnyitja a fuvart „✏️ Editează"-vel.
2. A „🚚 Sofőr-állomás időpontok" blokkban rákattint a **🔁 „Lezárás visszavonása"** gombra → megerősítés → a lerakó-ág NULL-ozódik, a fuvar `In Curs`-ra visszavált.
3. A sofőr a fuvar-kártyáján megnyomja a lerakás gombot → idő-picker modal (a PR #322-ből) → beállítja a valós lerakási időt (pl. `06.08 08:30`) → a fuvar `Finalizat` lesz konzisztens időbélyeggel.

Alternatíva a lépés 3 helyett: az admin a blokkban közvetlenül beírja a `descarcat_at`-ot (pl. `06.08 08:30`) és menti — a `comUpdate` beteszi a `orders.descarcat_at`-ot; a fuvar státuszát a Státusz-dropdownon manuálisan is `Finalizat`-ra állíthatja.

---

## 2026-08-06 — Sofőr-oldali kontrollok: fuvar-lezárás CSAK a sofőr kezében + idő-picker gombokra + session-recovery overlay

### Miért
Egy konkrét fuvarnál (CMD-MS8NDEHONVF) a lerakó tervezett dátuma be volt írva, de a sofőr még nem rögzítette a valódi lerakást — a rendszer mégis automatikusan Finalizat-ra állította. A gyökér: a menetlevél-beküldés (puncte a tervezett dátummal) `done_at`-et állított a stopokra → a `descarcat_at` mirror-mező NOT NULL lett → a végén auto-Finalizat. A menetlevél DOKUMENTUM (fuvar-lista összesítő), nem esemény; belső sofőrnél a tényleges felrakás/lerakás időpontját a driver a fuvar-kártya állomás-gombjaival rögzíti.

A gomb-nyomás körüli UX is bővült: eddig egy sima „biztos?" kérdés jött, ami félrenyomva rögtön rossz időt írt. Új idő-picker modal: mai idő az alapérték, de a sofőr utólag pótolhatja / szerkesztheti a valós időt.

Végül a session-lejáráskori élmény javult a driver-oldalon: eddig azonnal /login-re dobta a felületet, ami félrevezető volt („azt hittem be voltam jelentkezve"). Új saját overlay: „🔌 A munkamenet lejárt" + 🔄 Frissítés / Kilépés — offline állapotban is a szemünk előtt marad a felület.

### Változások

#### 1) Fuvar-lezárás CSAK a sofőr kezében (`routes/soferApi.js`)
- A `fuvarlevel-save` végpontban új szabály: **belső sofőrhöz kiosztott fuvarnál** (`email_sofer NOT NULL` ÉS státusz nem Extern) a menetlevél puncte-sorai CSAK `waybilled_at`-et állítanak; a `done_at`-et NEM. Így a mirror trigger sem állít `descarcat_at`-ot, és az auto-Finalizat SQL sem fut (a végén az `externOrders` tömbre szűkítve).
- **Extern / nincs internal driver** esetén a régi viselkedés marad: `done_at` is beállítódik + auto-Finalizat futhat — a külsős fuvarnál ugyanis nincs milestone-gomb.
- Belső fuvar státuszát a driver az „Elvégeztem" utolsó gomb-nyomásával zárja Finalizat-ra (`routes/ordersRest.js` `_applyStopEvent` — érintetlen).
- Új regressziós tesztek: `tests/integration/fuvarlevel-save-driver-owned.test.js` (+2 eset, mock-alapú).

#### 2) Idő-picker modal (`sofTimeConfirm`, `public/sofer.js`+`html`+`css`+`i18n.js`)
- Új `sofTimeModal` HTML + CSS a `sofConfirm` mellett: cím + magyarázó szöveg + `datetime-local` input (mai idő az alapérték, „Most" gombbal újra visszaállítható) + Igen/Mégse.
- Új kliens-függvények: `sofTimeConfirm(opts, onOk)` (`onOk` egy ISO string-et kap), `sofTimeOk`/`sofTimeCancel`/`sofTimeSetNow`.
- Átépítve: `driverMilestone`, `driverStopAction` (egy-opció ág), `sofChoice` (több lerakó → először stop-választás, aztán idő-picker), `sendBorderCross` (mindkét irányra).
- A `_driverMilestoneGo` / `_soferStopEventGo` / `_sendBorderCrossGo` új opcionális `atIso` paraméter → a fetch body-jában `at` ISO-string; üresen hagyva a szerver `NOW()`-t használ.
- Új i18n kulcsok: `sof.timeConfirm.at`/`now`/`hint` + `sof.sess.*` (session-overlay). A `sof.ms.confirmMsg` / `sof.ms.confirmStop` / `sof.crossConfirmMsg` szövegek frissítve („ha lekésted, lentebb a valós időt beállíthatod").

#### 3) Szerver-oldali `at` bemenet validációja
- **`routes/ordersRest.js`** új közös `parseAtInput(at)` (`MAX_BACKDATE_MS=7 nap`, `MAX_FUTURE_MS=2 perc`): érvénytelen/hiányzó → `null`, hívó a régi `NOW()`-ra esik vissza. Bekötve: `POST /api/orders/:id/driver-milestone` (mind a per-stop, mind a legacy 4-lépéses ág) és `POST /api/orders/:id/stop-event`.
- **`routes/soferApi.js`** ugyanez a szűrő `_parseBorderAt(at)`: a `POST /api/border-cross` INSERT-be explicit `created_at`-tal ír, ha kap érvényes ISO-t; egyébként a tábla default `NOW()`-t használ.
- Új tesztek: `sofer-routes.test.js` (+5 eset — érvényes `at`, jövőbeli/túl régi/nem-ISO → `NOW()`-fallback; border-cross `at` INSERT-be kerül).

#### 4) Session-recovery overlay (`public/session-guard.js` + `public/sofer.js` + `.html` + `.css` + `i18n.js`)
- A `session-guard.js` új „in-app recovery" ág: ha a hivo oldal beállítja a `window.VS_INAPP_SESSION_RECOVER = true`-t, a `visibilitychange` során expired session esetén NEM redirectel /login-re; helyette meghívja a `window.__vsShowSessionOverlay(reason)`-t. Offline állapotban is (a fetch-hívás előtt) ezt hívjuk.
- **`sofer.html`** új `#vsSessionOverlay` (🔌 ikon + cím + üzenet + státusz + 🔄 Frissítés / Kilépés gombok). **`sofer.css`** téma-egységes stílus.
- **`sofer.js`** `VS_INAPP_SESSION_RECOVER = true` + `__vsShowSessionOverlay` + `vsSessionRefresh` (reload) + `vsSessionLogout` (best-effort `authLogout` + `/login`). Új `online` esemény-figyelő: ha a hálózat visszajön ÉS az overlay látszik, csendes `authMe`-t próbál — ha a szerver megismer, bezárul; ha nem, a státusz frissül.
- Az admin/manager/developer oldalakat NEM érinti (a `VS_INAPP_SESSION_RECOVER` flag ott nem áll be → régi redirect-viselkedés).

### Teszt/verifikáció
- 906 Jest teszt zöld (45 skipped valós-DB). Új: `fuvarlevel-save-driver-owned.test.js` (+2), `sofer-routes.test.js` (+5), `sofer-client-flow.test.js` átírva (+1 új eset: üres input → nincs `at`).
- Cache-bust: `sofer.html` → `sofer.js/css/i18n.js?v=20260806evt`, `session-guard.js?v=20260806sess`.

### Ismert korlátok
- A `parseAtInput` `MAX_BACKDATE_MS = 7 nap` — ha a sofőr ennél régebbi eseményt akar utólag pótolni, a szerver `NOW()`-ra esik vissza (a diszpécser a menetlevél-szerkesztőben tudja korrigálni).
- A session-overlay offline állapotban valóban csak visszaengedi a felületre — a szerver-akciók (állomás-léptetés, menetlevél-beküldés) továbbra is szerver-hozzáférést igényelnek. A perzisztens localStorage-piszkozat + IndexedDB kép-megőrzés + offline outbox érintetlen.

---

## 2026-08-05 — Statisztika 2.0 utólagos kör: 🔎 Drill-in adatlap + 🆚 Multi-select összehasonlítás (max 5)

### Miért
A felhasználó kérése után: egy adott sofőrre / járműre / ügyfélre KATTINTVA a teljes tevékenysége látszódjon (aktív + lezárt fuvarok, dokumentumok, decont, tankolás-történet), és **legalább 5 entitást** ki lehessen jelölni oldalankénti összehasonlításhoz.

### Változások

#### Drill-in adatlap (`public/stats-v2/detail-modal.js` ÚJ, ~230 sor)
- Publikus API: `VS_STATS_V2_DETAIL.open('driver'|'vehicle'|'client', arg)`
- A modal a MEGLÉVŐ `handlers/entityDetail.js` handlereket hívja — nincs új szerver-oldal:
  - **Sofőr**: alap-adatok (e-mail, tel) + lejáratok (badge severity) + előlegek összesítő
  - **Jármű**: modell/típus/névl. fogyasztás + üzemanyagkártya-összesítő + lejáratok + szerviz-napló + tankolás-történet
  - **Ügyfél**: CUI/e-mail/fizetési határidő + fuvarok/összbevétel KPI + fuvarok táblája + számlák táblája
- Read-only — a szerkesztés/számlázás/POD a már létező (auditált) modulokon megy
- Reszponzív 2-oszlopos vagy 1-oszlopos elrendezés (`.sv2-det-cols`)

#### Multi-select összehasonlítás (`public/stats-v2/compare.js` ÚJ, ~170 sor)
- Publikus API: `VS_STATS_V2_CMP.{init, toggle, isSel, chkHtml, clear, setContext, openScope, openWith}`
- **Max 5 sor kijelölhető** ('drivers'/'clients'/'vehicles' külön scope), MIN 2 kell az összehasonlításhoz
- Kijelöléskor **floating action bar** jelenik meg (jobb alul): `N kijelölve  [Törlés]  [🆚 Összehasonlítás]`
- Compare modal: minden mutató sorban, entitás oszloponként, **best/worst automatikusan kiemelve** (zöld=legjobb, piros=leggyengébb, a `higherIsBetter` flag alapján)

#### Bekötés
- **Sofőrök tábla** (`pages/people.js`): checkbox oszlop, sorra kattintás → `_openDriver(email)` → modal; 6 metrika összehasonlítva (fuvar/lezárt/km/bevétel/L100km/avg_curr)
- **Ügyfelek tábla** (`pages/people.js`): checkbox oszlop, sorra kattintás → `_openClient(id)` → modal; 4-6 metrika (finance-jogtól függően, kintlévőség/átlag fiz. nap)
- **Jármű-kártyák** (`pages/fleet.js`): kis checkbox a kártya jobb felső sarkában, kártyára kattintva → `_openVehicle(id)` → modal; 7 metrika (fuvar/lezárt/km/bevétel/L100km/üzemanyag/szerviz)

#### Backend kiegészítés
- **`handlers/statisticsHandlers.js` `getClientStats`**: `MAX(o.client_id) AS client_id` a válaszban — a stats-v2 drill-in modal-hoz kell (az entitás-adatlap id-t vár). A régi kliens érintetlen (új mező, opcionális).

#### CSS + i18n
- `shell.css`: `.sv2-detail-*` (modal shell + 2-col layout), `.sv2-det-*` (metadata/KPI/panel), `.sv2-click-row` (kattintható sorok hover), `.sv2-sel-chk` (checkbox), `.sv2-compare-bar` (floating action bar animált slide-up-pal), `.sv2-cmp-table` (best/worst highlighting)
- `i18n.js`: **56 új** kulcs (34 `sv2.det.*` + 8 `sv2.cmp.*`), RO-alap + HU
- Cache-bust `?v=20260805k`

### Tesztek
- **898 Jest zöld** — a szerver-oldal minimál kiegészítése (`getClientStats` egy plusz oszlopa) nem törte a meglévő teszteket; a kliens-oldal tisztán frontend.

---

## 2026-08-05 — Statisztika 2.0 (PR #11): Legacy stats-menü elrejtve + záró dokumentálás

### Miért
A PR #1–#10 során a stats-v2 mint párhuzamos rendszer épült fel a régi `stats.js` mellé, hogy semmit ne törjön. Most, hogy mind az 5 fő tab kész, a régi 8 legacy sub-menü tétel elrejthető — az új rendszer az elsődleges (és egyetlen felkínált) statisztika-belépési pont.

### Változások
1. **`public/admin.html`** + **`public/manager.html`** — a Statisztika főmenü alól törölve a 8 legacy sub-tab (`stats-overview`, `stats-fuel`, `stats-purchases`, `stats-drivers`, `stats-vehicles`, `stats-clients`, `stats-co2`, `stats-sla`); marad az egyetlen aktív bejegyzés: `📊 Statisztika 2.0` (`stats-v2`).
2. **NEM eltávolítva** (rollback + biztonság miatt):
   - `public/stats.js` (~1500 sor) — továbbra is betöltődik, mert a `stats-permissions` handler-lookup (Admin-only jogosultság-kezelő) benne él.
   - A régi 8 `.pane[data-pane="stats-*"]` div-ek — a HTML-ben maradnak, csak a menü nem hivatkozik rájuk. Fallback deep-link-hez / kliens-oldali navigációhoz működnek.
   - `handlers/statisticsHandlers.js` a MEGLÉVŐ 23 handlerével — a stats-v2 oldalak MIND erre épülnek (get StatsOverview, getFinanceStats, getCarrierApAging, getVehicleStats, getFuelStats, getVehicleIdleStats, getServiceForecast, getCo2Report, getSlaStats, getOrderFunnel, getPurchaseStats, getDriverStats, getClientStats, getSoferConsumptionOverview).
3. **CLAUDE.md „Felületek és kinézet" `Statisztika & Riport` szekció újraírva** a stats-v2 új architektúrára — 5 fő tab, közös váz, új handlerek (statsV2/statsInsights/statsReports), új táblák (stats_views/stats_goals/stats_report_schedules), scheduler bekötés.

### Cache-bust
Nincs új v-verzió — a HTML-módosítás önmagában elég (böngésző-frissítés).

### Tesztek
- **898 Jest zöld** (nincs regresszió) — a régi menü tételeinek elrejtése kizárólag HTML-szerkesztés.

### Statisztika 2.0 tervezett 11 PR mindegyike KÉSZ:
| # | Cím | Merge-elt PR |
|---|---|---|
| 1 | Alap: közös váz + globális szűrő + mentett nézetek infra | #308-311 sorozat |
| 2 | 🏠 Áttekintés fül (Executive dashboard) | #311 |
| 3 | getStatsInsights aggregátor (anomália-központ) | #312 |
| 4 | 💰 Pénzügy fül (3 sub-tab) | #313 |
| 5 | 📈 Operáció fül (SLA + Funnel + Vásárlások) | #314 |
| 6 | 🚚 Flotta fül (jármű-kártyák + üzemanyag + CO₂) | #315 |
| 7 | 👥 Emberek fül (Sofőrök · Ügyfelek · Alvállalkozók) | #316 |
| 8 | 🎯 Cél-értékek UI + KPI-torony cél-jelzés | #317 |
| 9 | 📥 Egységes export-központ + nyomtatás-optimalizált nézet | #318 |
| 10 | 📧 Időzített e-mail riportok | #319 |
| 11 | Legacy stats-menü elrejtve + záró dokumentálás | ez a PR |

---

## 2026-08-05 — Statisztika 2.0 (PR #10): 📧 Időzített e-mail riportok

### Miért
A `stats_report_schedules` tábla (PR #1) eddig üresen élt. Ez a PR bekötötte a full workflow-t: Admin időzítést állít be (napi/heti/havi), a scheduler óránként ellenőrzi az esedékes riportokat, és e-mailben elküldi a KÖZÖS VallorSoft feladó-címről.

### Változások
1. **`handlers/statsReports.js`** (ÚJ, `routes/execute.js`-be regisztrálva) — `statsReportSchedule{List,Save,Delete}`. Írás **Admin only**, olvasás Admin/Manager. `schedule` fehérlista (`daily`/`weekly`/`monthly`), max 20 címzett, EMAIL_RE-validáció, tenant-védelem (cross-tenant view_id → 0 sor → elutasítás). Audit.
2. **`services/scheduler.js`** — új `startStatsReportScheduler`: óránként pörgeti a `enabled=true` sorokat; a `isDue()` a `schedule` + `last_run_at` alapján dönt (napi ≥22h, heti ≥6.5nap, havi ≥28nap). Egyszerű HTML-snapshot (előző hó KPI-k: lezárt fuvar / bevétel / km / kintlévőség) — `sendClientEmail`-en (KÖZÖS VallorSoft feladó, mint a monthly report), mailType `stats_report`. Sikeres küldés után `UPDATE last_run_at=NOW()`.
3. **`server.js`** — `startStatsReportScheduler()` bekötve a többi scheduler mellé.
4. **UI** (`public/stats-v2/shell.js`) — új 📧 gomb a szűrő-sáv jobb szélén (Admin only, a 🎯 mellett). Modal: név + gyakoriság (napi/heti/havi) + opcionális nézet-kötés + címzett-lista (vesszős) + „Aktív" pipa + „Utoljára futott" oszlop; sor-szintű aktiválás/kikapcsolás pipa + törlés gomb.
5. **`public/i18n.js`** — 20 új `sv2.rep.*` kulcs (RO-alap + HU).
6. **Nem PDF** — HTML-body a Brevo/SMTP-n át (a PDF-rendereléshez `puppeteer` kellene, ami ~150MB dependencia + memória; a HTML-riport ma is átmegy az e-mail kliensen).

### Tesztek
- **`tests/unit/statsReports.test.js`** (ÚJ, 14 új eset): szerep-védelem (Sofer/Manager tiltás), input-validáció (üres név, érvénytelen frekvencia, e-mail nélkül vagy érvénytelen e-mail), cross-tenant védelem (view_id 0 sor + schedule 0 sor), sikeres create/update/delete, string-recipients splitelés e-mail listára. **898 Jest zöld** (884 → 898); require-sweep 132 modul.

Cache-bust: `stats-v2/shell.js` `?v=20260805j`.

---

## 2026-08-05 — Statisztika 2.0 (PR #9): 📥 Egységes export-központ + nyomtatás-optimalizált nézet

### Miért
Eddig minden oldalnak volt ad-hoc CSV-exportja, kezelése inkonzisztens. Új közös `VS_STATS_V2_EXPORT` modul: egy `.button({...})` hívás — a hozzá tartozó menü automatikusan CSV / JSON / nyomtatás gombokat kínál.

### Változások
1. **`public/stats-v2/exporter.js`** (ÚJ, ~110 sor) — publikus API `VS_STATS_V2_EXPORT.{csv, json, copy, print, button, _menu, _doCsv, _doJson, _doPrint}`. A CSV BOM-mel (Excel-barát), a JSON pretty-printelve. A `button({data, columns, filename})` egy `<button>` HTML-t ad — click → floating menü, ami a 3 opciót kínálja.
2. **`public/stats-v2/shell.css`** — új `.sv2-exp-btn` + `.sv2-exp-menu` blokk (téma-érzékeny hover); print-mode media query, ami a szűrő-sávot és a tab-sort elrejti nyomtatáskor.
3. **Bekötés** (mintaként a főbb táblákhoz — a többi oldalt inkrementálisan lehet bővíteni ugyanezzel a pattern-nel):
   - `pages/finance.js` — a Kintlévőség sub-tab „Nyitott fuvarok (fizetetlen)" tábla export-gombot kap
   - `pages/people.js` — a Sofőr teljesítmény tábla export-gombot kap
   - `pages/fleet.js` — a Járművenkénti fogyasztás tábla export-gombot kap
4. **`public/admin.html`** + **`public/manager.html`** — `exporter.js` include ELÖL, cache-bust `?v=20260805i`.

### Tesztek
- **884 Jest zöld** — tisztán frontend.

Cache-bust: `stats-v2/exporter.js` + `shell.css` + érintett `pages/*.js` `?v=20260805i`.

---

## 2026-08-05 — Statisztika 2.0 (PR #8): 🎯 Cél-értékek UI + KPI-torony cél-jelzés

### Miért
A PR #1-ben az `stats_goals` tábla + a `statsGoalSet/List/Delete` handlerek felkerültek, de a felhasználó nem tudta kezelni őket a felületről, és a KPI-tornyok sem használták őket. Ez az UI-lezáró.

### Változások
1. **`public/stats-v2/shell.js`** — új 🎯 gomb a fent ragadó szűrő-sáv jobb szélén (Admin only, `state.is_admin` alapján). Modal: 8 kiválasztható metrika (revenue/profit/closed_orders/active_orders/consum_l100/km_month/utilization/on_time_pct) × 3 időszak (havi/negyedéves/éves) + célérték + pénznem + megjegyzés + törlés. A `statsGoalSet` upsert (UNIQUE per company_id+metric_key+period), a `statsGoalList` frissítés a mentés után. Publikus API: `VS_STATS_V2.getGoal(metric_key, period)`.
2. **`public/stats-v2/pages/overview.js`** — a KPI-tornyok most a `state.goals`-ból veszik a cél-értéket (revenue / closed_orders / consum_l100). Ha van, egy „Cél: X EUR" alsó sor jelenik meg a spark-line fölött (a PR #2 `kpiTower` `goalRow` már benne volt, csak a `goal:` mező tölti meg).
3. **`public/i18n.js`** — 24 új `sv2.goals.*` kulcs (RO-alap + HU).
4. **Cache-bust** `shell.js` + `pages/overview.js` `?v=20260805h`.

### Biztonság
- 🎯 gomb csak `is_admin` esetén jelenik meg (`statsGoalSet` szerver-oldali Admin-védelme a PR #1 unit-tesztjeivel fedve; a modal csak Admin-nak kínálja fel).
- Fehérlistán validált metric_key + period a szerveren; kliens is ugyanezt kínálja fel a dropdownokban.

### Tesztek
- **884 Jest zöld** (nincs regresszió) — a szerver-oldali handlerek a PR #1 `statsV2.test.js`-ben (7 eset a goal-utakhoz) már fedve; a klienshez nincs új szerver-teszt.

Cache-bust: `stats-v2/shell.js` + `pages/overview.js` `?v=20260805h`.

---

## 2026-08-05 — Statisztika 2.0 (PR #7): 👥 Emberek fül (Sofőrök · Ügyfelek · Alvállalkozók)

### Miért
A régi Statisztikában a Sofőr teljesítmény + Ügyfél riport 2 külön fülön élt, a fogyasztás-összehasonlítás egy 3.-on — a kliens-oldali kereső egyik táblán sem működött. Új Emberek fül alá 3 sub-tabra konszolidálva, mindegyik táblához azonos gépelős kereső.

### Változások
1. **`public/stats-v2/pages/people.js`** (ÚJ, ~230 sor) — `VS_STATS_V2.registerTab('people', {...})`. 3 belső sub-tab:
   - **👤 Sofőrök** — 3 KPI (aktív sofőrök, össz bevétel, cég-átlag fogyasztás küszöbbel) + kereső mező (név/e-mail) + teljesítmény-tábla avatar-monogrammal (determinisztikus szín, névből hash-elt): fuvar/lezárt/km/bevétel/L100km/**Δ vs. cég-átlag** (küszöb ±2.5 L/100km fölött ⚠️ warn háttérrel) / eredmény (EUR profit, ha van eur_ron_rate).
   - **🏢 Ügyfelek** — KPI-k + kereső (név/CUI) + avatar-os tábla: fuvar/lezárt/km/bevétel + (pénzügy-joggal) kintlévőség + átlag fizetési nap.
   - **🚚 Alvállalkozók** — placeholder-panel, ami átirányít a Pénzügy fül AP tabra (ott van a lényeg).
2. **`public/stats-v2/shell.css`** — új `.sv2-avatar` blokk (28×28 kör, monogram, kliens-oldali determinisztikus szín).
3. **Adatforrás**: MEGLÉVŐ `getDriverStats` + `getClientStats` + `getSoferConsumptionOverview` (a cég-átlag + Δ számításhoz) — nincs új szerver-oldal. A `finance` mező védi a pénzügyi oszlopokat (Manager engedély nélkül nem látja).
4. **`public/admin.html`** + **`public/manager.html`** — `people.js` include, cache-bust `?v=20260805g`.
5. **`public/i18n.js`** — 23 új `sv2.pp.*` kulcs (RO-alap + HU).

### Tesztek
- **884 Jest zöld** — tisztán frontend.

Cache-bust: `stats-v2/pages/people.js` + `shell.css` `?v=20260805g`.

---

## 2026-08-05 — Statisztika 2.0 (PR #6): 🚚 Flotta fül (jármű-kártyák + üzemanyag + állásidő + CO₂)

### Miért
A régi Statisztikában a flotta 3-4 fülre volt szétszórva (Jármű kihasználtság, Fogyasztás, CO₂, Járművek fülön az állásidő + szerviz-előrejelzés). Egy Flotta fül alá 4 sub-tabra konszolidálva, kliens-oldali keresővel.

### Változások
1. **`public/stats-v2/pages/fleet.js`** (ÚJ, ~330 sor) — `VS_STATS_V2.registerTab('fleet', {...})`. 4 belső sub-tab:
   - **🚚 Áttekintés** — 3 KPI (össz jármű, bevétel, km) + kliens-oldali kereső (rendszám/márka) + jármű-kártya rács (kártyánként rendszám monospace + aktív/inaktív badge + márka/model/év + 4 mini-KPI: fuvar, km, L/100km ± névleges, EUR); bal-oldali státusz-csík: zöld=OK, sárga=fogyasztás >15% eltérés, piros=>30%, szürke=inaktív.
   - **⛽ Fogyasztás** — 2 KPI (össz L + költség + RON/L) + havi tankolás oszlop (Motorină + AdBlue stacked) + jármű-fogyasztás tábla (menetlevelek, km, L, L/100km, névleges, eltérés % badge).
   - **💤 Állásidő + szerviz** — 3 KPI (átlag üres nap, sürgős szerviz, közelgő) + üres napok tábla (rendszám, szüne(te)k, átlag/össz/max nap) + szerviz-előrejelzés tábla (aktuális km, esedékesség km/dátum, hátralévő hét severity badge).
   - **🌱 CO₂** — 4 KPI (össz t CO₂, tankolt L, kg/100km, fa-egyenérték) + havi CO₂ oszlop + Top 10 jármű CO₂ tábla.
2. **`public/stats-v2/shell.css`** — új `.sv2-veh-*` blokk (jármű-kártya rács, státusz-csík változatok, aktív/inaktív badge, 2-oszlopos mini-KPI grid, hover-emelés).
3. **Adatforrás**: MEGLÉVŐ `getVehicleStats` + `getFuelStats` + `getVehicleIdleStats` + `getServiceForecast` + `getCo2Report` — nincs új szerver-oldal.
4. **`public/admin.html`** + **`public/manager.html`** — `fleet.js` include, cache-bust `?v=20260805f`.
5. **`public/i18n.js`** — 41 új `sv2.fl.*` kulcs (RO-alap + HU).

### Tesztek
- **884 Jest zöld** (nincs regresszió) — tisztán frontend.

Cache-bust: `stats-v2/pages/fleet.js` + `shell.css` `?v=20260805f`.

---

## 2026-08-05 — Statisztika 2.0 (PR #5): 📈 Operáció fül (SLA + Funnel + Vásárlások)

### Miért
A Statisztika operatív mutatói (SLA/életciklus, fuvar-státusz funnel, vásárlások) korábban 3 külön fülön éltek. A v2 vázon EGY „Operáció" fül alá 3 sub-tabra konszolidálva.

### Változások
1. **`public/stats-v2/pages/ops.js`** (ÚJ, ~230 sor) — `VS_STATS_V2.registerTab('ops', {...})`. 3 belső sub-tab:
   - **⏱️ SLA** — 4 KPI (kézbesítési arány, lemondási arány, kiszámlázási arány, átlag tranzit nap) + havi lezárt/törölt oszlopdiagram.
   - **🔻 Funnel** — vizuális fuvar-státusz funnel (kiírt → felrakóhoz → felrakva → lerakóhoz → leürít), gradiens-sáv az első lépéshez viszonyított %-kal + konverziós % lépések között; alatta táblázat az átlagos lépés-időkkel (perc/óra/nap auto-formázás) + teljes átfutás órákban.
   - **🛒 Vásárlások** — 2 KPI (össz + darabszám) + havi vásárlások oszlopdiagram + Top 10 termék + Top 10 sofőr tábla.
2. **`public/stats-v2/shell.css`** — új `.sv2-fnl*` blokk (funnel: 200/1fr/100 rács, indigó→lila gradiens-sáv, mobil-adaptív).
3. **Adatforrás**: a MEGLÉVŐ `getSlaStats` + `getOrderFunnel` + `getPurchaseStats` handlerek — nincs új szerver-oldal.
4. **`public/admin.html`** + **`public/manager.html`** — `ops.js` include, cache-bust `?v=20260805e`.
5. **`public/i18n.js`** — 27 új `sv2.ops.*` kulcs (RO-alap + HU).

### Tesztek
- **884 Jest zöld** (nincs regresszió) — a PR tisztán frontend.

Cache-bust: `stats-v2/pages/ops.js` + `shell.css` `?v=20260805e`.

---

## 2026-08-05 — Statisztika 2.0 (PR #4): 💰 Pénzügy fül (3 belső tab)

### Miért
A Pénzügy a régi Statisztikában egyetlen zsúfolt lapon élt (KPI-k + havi bevétel + öregítés + kintlévő fuvarok tábla + AP mind egyszerre). A v2 vázon 3 belső tabra bontva: Bevétel, Kintlévőség, Alvállalkozói AP — mindegyik saját fókusszal.

### Változások
1. **`public/stats-v2/pages/finance.js`** (ÚJ, ~280 sor) — `VS_STATS_V2.registerTab('finance', {...})`-en át. Belső sub-tab sáv (`.sv2-subtabs`) 3 gombbal:
   - **📊 Bevétel** — 3 KPI (bevétel + EUR/km, km, átlag fizetési idő) + havi bevétel/beszedett oszlopdiagram + beszedési arány % (line, 0-100 skálán).
   - **⏳ Kintlévőség** — 4 KPI (össz + 0-30 zöld / 31-60 sárga / 60+ piros) + doughnut chart + top 8 legnagyobb kintlévőség lista (severity szín) + top 30 nyitott fuvar tábla (client, összeg, fizetve, maradék, lezárva, esedékesség + lejárt/napok badge).
   - **📥 Alvállalkozói AP** — 4 KPI (össz + 0-30/31-60/60+) + doughnut + top 30 alvállalkozói nyitott számla tábla.
2. **`public/stats-v2/shell.css`** — új `.sv2-subtabs`/`.sv2-subtab.active` blokk (téma-érzékeny: sötét kártya kiemelés vs. világos árnyék).
3. **Adatforrás**: a MEGLÉVŐ `getFinanceStats` + `getCarrierApAging` handlerek — nincs új szerver-oldal. A pénzügyi jog kliens- és szerver-oldalon is védve: Manager `_canSeeFinance` engedély nélkül `🔒 nincs hozzáférés" üzenetet kap.
4. **`public/admin.html`** + **`public/manager.html`** — `finance.js` include; cache-bust `shell.css` + `finance.js` `?v=20260805d`.
5. **`public/i18n.js`** — 27 új `sv2.fin.*` kulcs (RO-alap + HU).

### Tesztek
- **884 Jest zöld** (nincs regresszió). A PR tisztán frontend — új szerver-teszt nincs; a pénzügy-védelmet a meglévő `getFinanceStats` tesztjei és a PR #1 `statsV2` tesztjei fedik.

Cache-bust: `stats-v2/pages/finance.js` + `shell.css` `?v=20260805d`.

---

## 2026-08-05 — Statisztika 2.0 (PR #3): `getStatsInsights` aggregátor (anomália-központ)

### Miért
A PR #2 Áttekintés fül eddig kliens-oldalon fésülte össze 3 külön handler (`getStatsOverview.alerts` + `getServiceForecast` + `getCarrierApAging`) kimenetét — ez korlátozott (nincs benne dokumentum-lejárat, UIT-hiány, lejáró UIT), és a jövőbeni PR-ek (Op / Fleet / People) is ugyanezekhez az anomáliákhoz nyúlnának. Egyetlen szerver-oldali handler: EGY forrás, EGY rendezés (severity + value), 1 fetch a klienstől.

### Változások
1. **`handlers/statsInsights.js`** (ÚJ, `routes/execute.js`-be regisztrálva) — `getStatsInsights`: 7 anomália-forrás egy handlerbe.
   - **Fogyasztás-anomália** (fuel_high): jármű 90-napos ténylegese >1.15× névleges (min 300 km). Dev >30% → danger, egyébként warn.
   - **Lejárt kintlévőség** (ar_overdue): a fizetési határidőn túli, nem fizetett fuvarok.
   - **Szerviz-előrejelzés** (service_due): a szerviz esedékessége <2 hét → danger, <6 hét → warn (GPS km-óra + havi átlag km alapján).
   - **AP-öregítés** (ap_60p/ap_31_60): alvállalkozói szállítói számla 60+ nap → danger, 31-60 → warn.
   - **Dokumentum-lejárat** (doc_expiry): ITP/RCA/tahográf stb. — 7 napon belül lejáró → danger, 30 napon belül → warn, egyébként info.
   - **Lejáró UIT** (uit_expiring): 2 napon belül lejáró, még nem leállított UIT-kód.
   - **Hiányzó UIT** (uit_missing): `orders.needs_uit=true`, de nincs aktív kód.
2. **Válasz-alak**: `{ ok, insights[], count_by_severity{danger,warn,info}, count_by_area{finance,fleet,ops,people}, can_finance }`.
   Minden insight objektum kliens-barát: `id`, `area`, `severity`, `icon`, `key`, `title`, `detail`, `value`, `tab`, `entity_type`, `entity_id`. A rendezés `severity` (danger > warn > info) + azonos szinten `value` csökkenőleg.
3. **Adatszivárgás-védelem**: minden lekérdezés `company_id`-szűrt, paraméteres SQL; a pénzügyi mutatók csak `_canSeeFinance` mellett — a Manager pénzügy-jog nélkül csak a nem-pénzügyi anomáliákat kapja. Az opcionális táblák (`order_uit_codes`, `document_expiries`, `gps_month_end_snapshots`) körül try/catch → migráció-tudatos, hiba esetén az adott forrás csendben üresre esik.
4. **`public/stats-v2/pages/overview.js`** — átáll az új `getStatsInsights`-re; ha nincs elérhető (átmeneti deploy előtt), a régi 3-handleres legacy összefésülés a fallback (`collectInsightsLegacy`).
5. **Bug-fix a rendezésben**: a `SEV_ORDER['danger']=0` érték a `||` operátorral falsy-ként `9`-re esett volna (a `danger` a rendezés végére került volna); `??` (nullish coalescing) javítva.
6. **Teszt** (`tests/unit/statsInsights.test.js`, 9 új eset): szerep-védelem (Sofer tiltva, Manager pénzügy-jog nélkül nem lát finance-t), üres források kezelés, rendezés (danger > warn > value), Admin bypass pénzügyi mutatókkal, multi-tenant company_id-vizsgálat. **884 Jest zöld** (875 → 884); require-sweep +1 modul (131 összesen), 0 hiba.

Cache-bust: `stats-v2/pages/overview.js` `?v=20260805c`.

---

## 2026-08-05 — Statisztika 2.0 (PR #2): 🏠 Áttekintés fül újraépítve (Executive dashboard)

### Miért
A PR #1-ben felállított v2 váz alá az első valódi tartalom: egy „10 mp alatt látszik minden" főoldal a régi 4 csempés Áttekintés helyett — KPI-tornyok spark-line-nal + trend Δ-vel, insight-sáv (top 3 fejlemény, kattintva a megfelelő fülre ugrik), havi bevétel/költség/eredmény idősor, top 5 ügyfél + top 5 útvonal, kattintható teendő-lista. Külön szerver-oldal NEM kell — a MEGLÉVŐ `getStatsOverview` + `getClientStats` + `getServiceForecast` + `getCarrierApAging` handlerekre épít (a PR #3 egyetlen `getInsights`-be fogja összegyűjteni).

### Változások
1. **`public/stats-v2/pages/overview.js`** (ÚJ, ~260 sor) — `VS_STATS_V2.registerTab('overview', {...})`-en át regisztrálva. 4 KPI-torony (bevétel + spark + Δ%, lezárt fuvar, cég-átlag fogyasztás, kintlévőség vagy anomáliák — jog-alapú), insight-sáv (getStatsOverview.alerts + service forecast sürgős + AP-öregítés 60+ nap → top 3 fejlemény kattintható link a megfelelő tabhoz), grafikon (havi bevétel + költség + eredmény ha van `eur_ron_rate`), top 5 ügyfél + top 5 útvonal, teendő-lista (severity szín: danger/warn/info).
2. **`public/stats-v2/shell.css`** — új PR #2 blokk: `.sv2-kpi-grid`/`.sv2-kpi` (bal-oldali akcens-csík, hover-emelés, spark), `.sv2-insight`/`.sv2-insight-ok`, `.sv2-grid-2col` (900px alatt 1 oszlop), `.sv2-todos`/`.sv2-todo-{danger,warn,info}`, `.sv2-rank`, `.sv2-chart-wrap`. Világos + sötét téma.
3. **`public/admin.html`** + **`public/manager.html`** — új `pages/overview.js?v=20260805b` include; cache-bust `shell.css?v=20260805b`.
4. **`public/i18n.js`** — 30 új `sv2.ov.*` kulcs (RO-alap + HU).

### Biztonság / adatszivárgás
Nincs új szerver-út — a meglévő handlerek `_isAdminOrManager` kapui + `_canSeeFinance` pénzügy-védelme érvényben van; a Sofer a `stats-v2` fület egyáltalán nem éri el (menü-elrejtés + `statsV2Init` kapu).

### Tesztek
- **875 Jest zöld** (a PR #1 tesztjei benn, PR #2 tisztán frontend — külön unit-teszt nincs; a lap élő adatokon rendereleődik). Nincs regresszió; require-sweep 130 modul 0 hiba.

Cache-bust: `stats-v2/pages/overview.js` + `shell.css` `?v=20260805b`.

---

## 2026-08-05 — Statisztika 2.0 (PR #1): közös váz + globális szűrő + mentett nézetek + KPI cél-értékek

### Miért
A jelenlegi 7-9 füles / 23-handleres Statisztika oldal átláthatatlan: minden fülnek külön szűrője van, nincs mentett nézet, nincs cél-érték, nincs egységes összehasonlítás („vs. előző időszak"). A teljes újraépítés első lépése egy közös v2 váz — a régi fülek érintetlenek, párhuzamosan futnak, amíg az új fő tabok (Áttekintés/Pénzügy/Flotta/Emberek/Operáció) fel nem épülnek a következő PR-ekben.

### Változások
1. **`db/stats-v2-init.sql`** (ÚJ, idempotens) — 3 tábla: `stats_views` (mentett nézet: config JSONB, is_shared), `stats_goals` (KPI cél-értékek per metric_key + period, `UNIQUE (company_id, metric_key, period)`), `stats_report_schedules` (időzített PDF-riport a PR #10-hez, most még üres).
2. **`handlers/statsV2.js`** (ÚJ, `routes/execute.js`-be regisztrálva) — 7 handler: `statsV2Init` (kezdeti csomag: szerep, pénzügy-jog, tab-lista, cél-értékek), `statsView{List,Save,Delete}`, `statsGoal{List,Set,Delete}`. Multi-tenant: minden lekérdezés `company_id`-szűrt, paraméteres SQL, audit. Saját nézet szerkeszthető; megosztottat csak a létrehozó vagy Admin írhat. Cél-értéket csak Admin állíthat. Config-korlát 32 KB, `metric_key`/`period` fehérlista.
3. **`public/stats-v2/shell.js`** (ÚJ, ~280 sor) — a v2 KÖZÖS váz: fent ragadó szűrő-sáv (időszak-preset ma/hét/hó/előző/negyedév/12h/év/egyedi + összehasonlítás vs. előző időszak / vs. előző év), fő tab-sor (Áttekintés/Pénzügy/Flotta/Emberek/Operáció), mentett nézetek dropdown (betöltés/mentés/törlés). Publikus API `VS_STATS_V2.registerTab(key, {label, render, onFilter?})` — a következő PR-ek ezen keresztül regisztrálják a tab-tartalmakat. Az egyes tab-tartalmak placeholderrel jelzik, hogy a következő körben érkeznek.
4. **`public/stats-v2/shell.css`** (ÚJ) — v2-specifikus stílusok (`[data-pane="stats-v2"]`-re szűkített), világos + sötét téma, mobil-adaptív, sticky topbar, saved-views dropdown.
5. **`public/admin.html`** + **`public/manager.html`** — új sidebar-tétel „📊 Statisztika 2.0" (`data-tab="stats-v2"`) a régi Statisztika főmenü tetejére; új `stats-v2` pane + CSS/JS include. **`admin.js`** + **`manager.js`** `loadTab` — stats-v2 → `VS_STATS_V2.load()`.
6. **`public/feature-catalog.js`** — új `stats-v2` kulcs (a régi `stats-*` kulcsok érintetlenek → a cég átmenetileg mindkettőt láthatja).
7. **`public/i18n.js`** — 32 új `sv2.*` + `nav.statsV2` kulcs (RO-alap + HU).
8. **Teszt** — `tests/unit/statsV2.test.js` (ÚJ, 23 eset): szerep-kapuk (Sofer tiltva, Manager pénzügy-jog nélkül), tenant-izoláció (más cég sora nem elérhető), tulajdon-védelem (más user nézetét Manager nem írhatja, Admin igen), cross-tenant védelem, cél-értékek fehérlistája + upsert. **898 Jest zöld** (875 → 898); require-sweep 130 modul 0 hiba.

Cache-bust: `stats-v2/shell.js`+`shell.css` `?v=20260805a`.

---

## 2026-08-04 — Fuvar több felrakó/lerakó pont (multi-drop) + menetlevél-láthatóság bug-fix

### Miért
Két hiány egyszerre:
1. **Bug**: ha egy fuvar `In Curs` állapotban került menetlevélbe (csak a felrakási pontja), pénteken beküldve, hétfőn lerakódott → `Finalizat`, a sofőr csak pénteken foglalkozik a menetlevéllel, de a fuvar addigra **eltűnt a menetlevél-pickerből** (mert már ≥1 menetlevélen szerepelt). A záró lerakási pontot már nem lehetett rögzíteni. Adatvesztés.
2. **Új funkció**: eddig egy fuvar CSAK 1 felrakási + 1 lerakási címet tárolt (`orders.loc_incarcare` / `loc_descarcare`). A valóságban gyakori az 1 felrakás → N (2-5-10) lerakási pontos fuvar; ehhez kézzel több fuvart kellett kiírni, ami statisztikailag/számlázásban rossz.

### Változások

1. **`db/order-stops.sql`** (ÚJ, idempotens) — `order_stops` tábla (kind = 'pickup'|'delivery', stop_index, loc, firma, data, ref, arrived_at, done_at, waybilled_at). A régi `orders.loc_incarcare/loc_descarcare/data_*/firma_*/sosit_*_at/incarcat_at/descarcat_at` mezők visszamenőleges kompatibilitás miatt MEGMARADNAK, származékként; egy `AFTER INSERT/UPDATE/DELETE ON order_stops` trigger tartja szinkronban őket (első pickup / utolsó delivery mint mirror; a `descarcat_at` csak akkor NOT NULL, ha ÖSSZES delivery done). Backfill: minden meglévő fuvarhoz 1 pickup#0 + 1 delivery#0 a régi top-mezőkből, időbélyegekkel; és a meglévő menetlevelek `puncte`-jából `waybilled_at` visszatöltés (orderId+role → kind).

2. **`lib/orderStops.js`** (ÚJ) — közös helper: `normalizeStops(o)` (pickups[]/deliveries[]/stops[] vagy top-fields fallback), `replaceStopsForOrder(db,orderId,cid,norm)` (törlés + upsert, az arrived_at/done_at/waybilled_at megőrzésével azonos kind+stop_index-en), `syncSingleStopFromTopFields(...)` (a régi kliens top-mező szerkesztésekor a pickup#0/delivery#0 stopot frissíti). Multi-tenant + input-validáció (255 char, 20 sor/kind).

3. **`handlers/orders.js`** — `comCreate`, `bulkCreateOrders`, `comUpdate`: elfogadják a `pickups[]`/`deliveries[]`/`stops[]` payloadot; ha nincs, top-szintű mezőkből legacy 1+1 stop. `comUpdate` „csak stops-módosítás" is érvényes szerkesztés. `getOrderById` visszaadja a `stops` tömböt. `comList` és `getMySoferOrders` LATERAL JOIN-nal `stops_json`, `stop_count`, `pickup_count`, `delivery_count`, `wb_open_pickup`, `wb_open_delivery` mezőket ad.

4. **Bug-fix — `getMySoferOrders` `waybill_visible`** (a fő kérés): a fuvar addig marad a menetlevél-pickerben, AMÍG VAN OLYAN STOP-JA, AMI NEM WAYBILLED (`waybilled_at IS NULL`). A régi „≥1 menetlevél → azonnal eltűnik" viselkedés eltűnt. Amikor MINDEN stop waybilled → azonnal eltűnik (nincs türelmi idő). Fallback: ha nincs egyetlen stop sem (nem-migrált sor), a régi szabály. Új `waybill_phase`: 'loading' amíg pickup-stop kell, 'unloading' amíg delivery-stop kell, 'complete' ha minden waybilled.

5. **`routes/ordersRest.js`** — új `POST /api/orders/:id/stop-event` `{stopId,event:'arrive'|'done'}`: ownership + tenant védett per-stop léptetés; első pickup arrive-nál `Disponibil/Alocat/Extern → In Curs`; ÖSSZES delivery done után `→ Finalizat`. A régi `POST /api/orders/:id/driver-milestone` MEGMARAD (visszafelé kompat): ha van legalább 1 order_stops sor, automatikusan a per-stop útra vált (szerver dönti el a következő nyitott stopot); ha nincs (nem-migrált/mock), a régi 4-fix-oszlopos ág fut.

6. **Sofőr-kártya UI** (`public/sofer.js` `renderFuvarCard`): a fuvar-kártya kinyíló része a `o.stops` alapján listázza az ÖSSZES pickup/delivery pontot (státusz-badge-dzsel: ✅ done / 📍 arrived / ○ todo). Az „állomás-gomb" az új `driverStopAction(orderId)`-t hívja: ha 1 opció van, mint eddig (confirm → POST /stop-event); ha több (több nyitott delivery), új `sofChoice()` előugró választó modal (nagy gombok függőlegesen — vezetés után is nyomható). A régi `driverMilestone` fallback nem-migrált fuvaroknál. A `getMySoferOrders` válasz `_soferOrdersCache`-ben tárolva.

7. **`public/sofer.html`** — új `#sofChoiceModal` (stop-választó, több nyitott delivery-nél). Cache-bust `?v=20260730multi` (sofer.html/js/css/i18n).

8. **`public/sofer.css`** — új `.fd-stop-block` (stop-kártya a kinyíló részben), `.fd-stop-done/arrived/todo` státusz-badge-ek. A `#sofChoiceModal` gombjai teljes szélességben, egymás alatt.

9. **Admin/manager fuvar-kiíró és -szerkesztő UI** (`public/admin.html`, `manager.html`, `console-shared.js`): új „TÖBB FELRAKÁSI / LERAKÁSI PONT (opcionális)" blokk mind a kiíró (`#oExtraStopsBox`/`#oExtraStopsList`), mind a szerkesztő (`#oeExtraStopsList`) modálban. Új `addExtraStopRow(kind, listId, seed)`, `_collectExtraStops(listId)`, `populateExtraStopsFromOrder(order, listId)` a `console-shared.js`-ben. Az első pickup / delivery a top-szintű mezőkben marad (visszafelé kompat); az extra sorok generálják a további `pickups[]`/`deliveries[]` elemeket. `createOrder` és `saveOrderEdit` küldi a payload-ba.

10. **AI kiolvasás** (`services/order-ai/gemini.js`): a `FIELDS` bővítve `pickups`/`deliveries` tömbökre + a prompt tanítja: „DACĂ SUNT MAI MULTE PUNCTE de încărcare / descărcare (ex. 1 încărcare + 5 descărcări), completează pickups[] și deliveries[] cu obiecte { loc, firma, data }". `handlers/orderScan.js` `sanitize` fehérlistázza a stopokat (255 char, 20 sor limit, csak loc/firma/data mező). `routes/inbound-orders.js` `/approve` a `ex.pickups`/`ex.deliveries`-t átadja az `orderStops.replaceStopsForOrder`-nek (best-effort, a fuvar mentése akkor is fut ha a stops elhasal).

11. **Menetlevél** (`public/sofer.js` + `routes/soferApi.js`): a puncte-sorok mostantól `data-stop-id` attribútumot is kapnak; a `_collectPuncte` visszaadja `stopId`-vel. Új közös `_buildWaybillPuncteForOrder(o)` — a `waybilled_at IS NULL` stopokat listázza (multi-stop-aware). A `/api/fuvarlevel-save` szerver: minden `puncte[i]`-re, ha van `stopId` (ownership-védett), az `order_stops` konkrét sorát jelöli done_at + waybilled_at-tel; ha nincs, az első még-nem-waybilled kind-ű stopra esik (fallback: legacy `orders.*_at` beírás nem-migrált sorra). A trigger frissíti a mirror mezőket; az auto-Finalizat léptetés csak akkor, ha az `orders.descarcat_at IS NOT NULL` (ÖSSZES delivery done a trigger által számolva).

12. **i18n** — új kulcsok: `sof.ms.confirmStop`, `sof.ms.nextStep`, `sof.ms.chooseStop(Msg)`, `sof.ms.allDone`, `sof.det.pickup/delivery/stops`, `form.extraStopsHead`, `form.addPickup/addDelivery`, `form.pickupExtra/deliveryExtra`, `form.locPh` (RO-alap + HU).

13. **Tesztek** — új: `tests/unit/orderStops.test.js` (7 eset: normalizeStops + replaceStopsForOrder mock DB), `tests/unit/get-my-sofer-orders-stops.test.js` (3 eset: SQL a stops LATERAL JOIN-nal + wb_open_* mezők + DB-hiba). Frissítve: `tests/integration/sofer-routes.test.js` (a legacy driver-milestone teszteknél extra `order_stops` üres SELECT mock), `tests/integration/orders-handover.test.js` (`getOrderById` új `stops` mező), `tests/unit/orderScan.test.js` (fehérlista + `pickups`/`deliveries` kulcsok). **851 Jest zöld** (843 → 851).

### Példa a bug-fix működésére (Peto-eset)
- Péntek 18:00: sofőr menetlevél-picker: fuvar #123 megjelenik `waybill_phase=loading`; sofőr felrakási pontot rakja fel, beküldi menetlevél → `waybilled_at` a pickup#0-ra. `wb_open_pickup=0`, `wb_open_delivery=1` → `waybill_visible=true`.
- Hétfő reggel: sofőr a lerakóhoz ér, koppint az állomás-gombra → delivery#0 done_at. Trigger frissíti `orders.descarcat_at`-ot → státusz `Finalizat`.
- Péntek 20:00 (következő menetlevél): a fuvar #123 MÉG MINDIG látszik a menetlevél-pickerben (`waybill_phase=unloading`, `wb_open_delivery=1`), a sofőr felrakja a lerakási pontot, beküldi. Ekkor `wb_open_delivery=0` → `waybill_visible=false` → azonnal eltűnik.



### Miért
A sofőr a menetlevél lezárásakor eddig kézzel írta be a záró km-óra állást és a záró üzemanyag-szintet — a vontatón álló műszerről leolvasva, gyakran memóriából. Fárasztó és hibaforrás (elgépelt km → hamis fogyasztás → sofőr-figyelmeztetés). A CargoTrack GPS eddig is szolgáltatta mind a két értéket (`mileage` + `fuel_level`) — ezt egy gombra le lehet kérni. A tartály-szintnél viszont a GPS gyakran eltér a valóstól (érzékelő-kalibráció, tartály-forma), ezért az admin jármű-adatlapon +/- literes korrekció adható, amit a szerver AUTOMATIKUSAN alkalmaz mielőtt a sofőr látja.

### Változások

1. **`db/vehicle-fuel-correction.sql`** (ÚJ, idempotens): `vehicles.fuel_correction_l NUMERIC(6,1)` — a GPS-mért tartály-szint és a valós tartály-szint közti fix eltérés (liter, +/-, NULL = nincs korrekció, csak Vontatóra értelmezett). NEM a L/100km fogyasztás — az továbbra is a `fuel_per_100km` mezőben.
2. **`lib/vehiclePositions.js`** — új exportált `getReadingsForPlate(cid, plate)`: cégen belül a rendszám-normalizált CargoTrack-lekérés (mileage + fuel_level + datetime). NEM cache-elt (a `getPositions` térkép-cache érintetlen). Multi-tenant szűrés, best-effort (nincs GPS/nincs kulcs → `available:false`).
3. **`handlers/orders.js`** — új `getCurrentGpsReadings(plate)` RPC:
   - Kapu: **Sofer|Admin|Manager**.
   - **Sofőr EXTRA szigor:** csak akkor kap választ, ha a jármű `assigned_driver_email` a bejelentkezett sofőrre mutat → más sofőr autójának GPS-adata NEM elérhető.
   - A `fuel_level` a jármű `fuel_correction_l` offsetjével **KORRIGÁLVA** megy vissza (a nyers GPS-érték SOSEM kerül a kliensbe). Negatív display 0-ra vág.
   - Példa: GPS 500 L + korrekció −20 L = a sofőr 480 L-t lát.
4. **`handlers/fleet.js` `vehicleUpdate`** — új `fuel_correction_l` mező fogadva a jármű-adatlap mentésekor. `vehicleList` (SELECT *) automatikusan visszaadja.
5. **Admin/Manager jármű-modal** (`admin.html` + `manager.html`) — új „GPS tartály-szint korrekció (L)" mező a Fogyasztás (L/100km) MELLETT, egyértelmű hint-szöveggel (NEM a fogyasztás; a sofőr menetlevél „⛽ GPS" gombjához alkalmazzuk); `console-shared.js` `editVehicle` betölti, `saveVehicle` küldi.
6. **Sofőr menetlevél** (`public/sofer.html`) — új **📍 GPS** gomb a záró km (`fKmSf`) mellett + új **⛽ GPS** gomb a záró üzemanyag (`fCantSf`) mellett; közös `.gps-input-row` + `.gps-fetch-btn` CSS (zöld gradiens, kompakt, ujjbarát, disabled állapot).
7. **Sofőr JS** (`public/sofer.js`) — új `fetchGpsEndKm()` / `fetchGpsEndFuel()`:
   - Rendszám a `#fCamion` mezőből vagy a `_myAssignedVehicle` cache-ből.
   - Közös `_sofGpsFetch(btnId, onOk)` helper: gomb-zár + spinner + `getCurrentGpsReadings` RPC + toast.
   - Sikerre a mezőt **FELÜLÍRJA** (ez EXPLICIT sofőr-akció, nem csendes prefill), kilövi az `input` eventet (a `#kmFuelCheck` élő ellenőrzés + `draftSave` újrafut).
8. **i18n** (`public/i18n.js`) — 11 új kulcs (RO-alap + HU): `vm.fuelCorr` + `vm.fuelCorrHint` (jármű-modal); `sof.gpsGetKmHint` / `sof.gpsGetFuelHint` (tooltip), `sof.gpsNoPlate` / `sof.gpsNoData` / `sof.gpsNoKm` / `sof.gpsNoFuel` / `sof.gpsError` (hiba-toastok), `sof.gpsKmFetched` / `sof.gpsFuelFetched` (`{val}` placeholder — sikeres toast).
9. **Teszt** (`tests/integration/sofer-handlers.test.js`) — új `getCurrentGpsReadings` describe blokk 13 eset: szerep-kapu (Konyvelo tiltva, bejelentkezés nélkül tiltva), üres rendszám → available:false, jármű nem található, MÁS sofőrhöz kiosztott jármű (nincs GPS-hívás!), sofőr saját járműve korrekció nélkül, negatív korrekció (−20 → 480), pozitív korrekció (+15 → 315), nagyon nagy negatív → 0-ra vág, Admin/Manager nincs assigned-check, csak mileage van (fuel_level:null), GPS nem elérhető, rendszám-normalizálás („b 1-2-3 vlr" → „B123VLR"), DB-hiba (nincs stack-szivárgás).
10. **Cache-bust** `?v=20260730gps` (sofer.html/js/css, admin.html/manager.html i18n + console-shared).

### Kompatibilitás
- Nincs törésváltozás. Ha nincs `fuel_correction_l` megadva, a nyers GPS-érték megy a sofőrhöz (mint eddig lenne, ha lenne ilyen gomb).
- Ha a jármű nincs CargoTrack-hoz párosítva / nincs `gps-integracio` flag → a gomb kilövi a hiba-toastot („Nincs friss GPS-adat…"), a sofőr kézzel folytathatja.
- A `fuel_per_100km` (fogyasztás) mező ÉS a korábbi `getLastVehicleReadings` (kezdő km + kezdő üzemanyag prefill előző menetlevélből) VÁLTOZATLAN.

### PR & Teszt
- Branch: `claude/sofor-gps-fuel-buttons-ibwcix`
- **840 Jest zöld** (45 skipped valós-DB), require-sweep 82 modul 0 hiba.

---

## 2026-07-29 — Fuvar-menetlevél életciklus: kötelező elhelyezés + azonnali eltűnés + dátum a pickerben

### Miért
A sofőr oldalon a Finalizat fuvarok a menetlevélbe helyezés után türelmi ideig (3 nap / 15 perc) látszottak a picker-ben — ez zavaró volt és felesleges. Emellett a fuvar-picker modal CMD-azonosítót mutatott, ami a sofőrnek semmitmondó; a felrakási/lerakási dátum informatívabb.

### Változások

1. **`handlers/orders.js` `getMySoferOrders`** — `waybill_visible` egyszerűsítve:
   - **Finalizat + 0 menetlevél = `true`** — KÖTELEZŐEN rá kell tenni menetlevélre (nem kerülheti el).
   - **Finalizat + ≥1 menetlevél = `false`** — AZONNAL eltűnik (nincs 3 napos / 15 perces türelmi idő).
   - **Aktív státuszok** (Alocat/In Curs/Parkolt/Raktarban) = `true` (változatlan).
   - `waybill_phase` egyszerűsítve: `loading` (aktív) / `unloading` (Finalizat, menetlevél nélkül) / `complete`.
   - `dash_visible` érintetlen (csak Alocat/In Curs = true).

2. **`public/sofer.js` `_openOrderPicker`** — a fuvar-kártyán a `#CMD-XXXXXXXXX` helyett a **felrakási → lerakási dátum** jelenik meg (`📅 2026-07-28 → 2026-07-30`), `data_incarcare`/`data_descarcare`-ból.

### Tesztek
859 Jest zöld (7 skipped valós-DB). Nincs regresszió.

---

## 2026-07-29 — Menetlevél: a „✏️ Fuvarok kezelése" gomb kitűnő, tömör kék lett (PR #305)

### Miért
A menetlevél 2. lépésén a „✏️ Fuvarok kezelése (hozzáadás/eltávolítás)" szaggatott keretes, átlátszó „szellem-gomb" volt (`background:transparent`, 1px dashed) — a világos lapon alig látszott, pedig ez nyitja a fuvar-pickert, és a lezárási védőháló (`_validateNoLeftoverOrders`) is ide küldi vissza a sofőrt.

### Mi változott
1. **`public/sofer.html`** — a beégetett inline stílus lekerült a gombról, helyette `class="submit-btn wb-manage"`. (Az `onclick`/`data-i18n` változatlan.)
2. **`public/sofer.css`** — új `.submit-btn.wb-manage`: tömör, a beküldő gombbal AZONOS családú, de **sötétebb/hidegebb kék** (`#0ea5e9 → #0369a1`, 1.5px `#075985` keret, kék glow). Így egyértelműen gomb és kitűnik, de nem versenyez a fő művelettel (a „📄 Menetlevél létrehozása" / „📤 Véglegesítés" marad a kék-indigó gradiens).
3. Cache-bust `?v=20260729ui` → `?v=20260729wbm`.

**Szerver-oldal, DB és minden JS-logika érintetlen** — tisztán megjelenés. **871 Jest zöld** (45 skipped valós-DB), headless Chromium (393 px) vizuális ellenőrzéssel.

---

## 2026-07-29 — Sofőr-felület: saját megerősítő modal + kontraszt-kör + fázis-vezérelt fel-/lerakás (PR #304)

### Miért
Három kérés egy körben: (1) a megerősítés a natív `confirm()` helyett a felület saját stílusában; (2) a teljes sofőr-felület legyen kontrasztos — a gombok tűnjenek ki, a menetlevél legyen egyértelmű, és ami lenyílik, azon legyen látható lenyíló-ikon; (3) a kiosztott fuvar kártyáján felrakodás előtt CSAK a felrakó látszódjon (a lerakó külön lenyitható), felrakodás után forduljon — és a megbízó cég neve ne jelenjen meg.

### Mi változott
1. **Saját megerősítő modal** (`#sofConfirmModal` + `sofConfirm(opts, onOk)` / `sofConfirmOk()` / `sofConfirmCancel()`): ikon + cím + magyarázat + két, egymástól jól elkülönülő gomb (semleges „Mégse" · hangsúlyos, `tone` szerint színezett igen). Az állomás-léptetés (`driverMilestone`) és a határátlépés (`sendBorderCross`) ezt használja; a tényleges művelet a `_driverMilestoneGo` / `_sendBorderCrossGo` ágon fut, tehát az „igen" nélkül SEMMI nem megy ki (a határátlépésnél GPS-lekérés sem). Ha a modal hiányozna a DOM-ból (beragadt régi HTML), a `sofConfirm` a natív `confirm()`-ra esik vissza — némán sosem hajtjuk végre a műveletet.
2. **Kontraszt-kör** (`public/sofer.css`, additív blokk a fájl VÉGÉN, könnyen visszavonható): erősebb tokenek (`--sof-border` #e2e8f0 → #cbd5e1, `--sof-muted` #64748b → #475569); a másodlagos gombok fehér helyett halvány-tinta kitöltést + 1.5px markáns keretet + sötét feliratot kaptak (`.sh-btn`, `.fd-copy`, `.add-row-btn`, `.back-btn`), az „⛔ Áru leadása" borostyán lett (a halvány lila felirat fehér alapon gyakorlatilag eltűnt); űrlap-címkék sötétebbek/vastagabbak, mezők 1.5px kerettel + erősebb fókusz-gyűrűvel; szekció-fejlécek sötét felirat + bal oldali gradiens akcent-csík; státusz-pirulák telített háttérrel.
3. **Egységes lenyíló-ikon**: minden összecsukható elem (fuvar-kártya fej, menetlevél-szekciók, fel-/lerakás blokk) kerek, keretes chevron-jelzőt kapott — **csukva ▸, nyitva ▾** (eddig a kártyafej ▾/▴-t használt, a szekciók ▸/▾-t).
4. **Fázis-vezérelt fuvar-kártya** (`renderFuvarCard`): a fel- és lerakás külön összecsukható blokk (`fdPhaseSec` + `toggleFuvarSec(id, kind)`). Amíg nincs `incarcat_at`, a **felrakás** van nyitva és elöl, a lerakó egy koppintással lenyitható; felrakodás után a **lerakás** kerül előre nyitva, a felrakó marad lenyithatóként. A csukott fejlécen ott a helyszín-összegzés, hogy egy pillantásból látszódjon.
5. **A megbízó cég neve (`orders.client`) sehol nem jelenik meg a sofőrnek** — sem a kártyán (meta-sor + korábbi `fd-firma`), sem a fuvar-pickerben, sem a menetlevél kiválasztott-fuvarok összegzőjében (helyette a fuvar-szám ill. a felrakó → lerakó útvonal azonosít). A **felrakó/lerakó cég** (`firma_incarcare` / `firma_descarcare`) továbbra is látszik — az a sofőr munkája.
6. **i18n**: a `sof.ms.confirmAsk` / `sof.crossConfirmAsk` egysoros kulcsok cím + magyarázat párra bomlottak (`sof.ms.confirmTitle`/`Msg`, `sof.crossConfirmTitle`/`Msg`), + `sof.cfm.yes`. Cache-bust `?v=20260729ui` (`i18n.js`, `sofer.js`, `sofer.css`).

### Nem érintett
Szerver-oldal és DB változatlan. A `getMySoferOrders` már eddig is visszaadta a 4 állomás-időbélyeget, ezért a fázis-váltás új lekérdezés nélkül működik.

### Teszt
`tests/integration/sofer-client-flow.test.js` — a 7 régi `confirm()`-alapú eset átírva a modalra, +5 új: a hívás önmagában nem küld (modal nyílik) · Mégse → semmi · Igen → POST · a modal címe a soron következő állomást / az irányt nevezi meg · fallback-ág; továbbá a `renderFuvarCard` fázis-logikája (nyitott/csukott blokk + sorrend), a megbízó-név hiánya és a `toggleFuvarSec` ikon-váltása. **866 → 871 Jest zöld** (45 skipped valós-DB). Vizuális ellenőrzés headless Chromiummal (393 px), a VALÓDI `renderFuvarCard`-kimenettel és a valódi `sofer.css`-szel.

---

## 2026-07-29 — Sofőr: a határátlépés BE/KI gomb is megerősítést kér (PR #303)

### Miért
Ugyanaz a minta, mint az állomás-gomboknál (PR #302), a második egykoppintásos, visszavonhatatlan műveletre. A `🇷🇴 ROMÁNIA BE` / `KI` gomb eddig azonnal rögzítette az átlépést a jelenlegi idővel + GPS-pozícióval. A sofőr a saját felületéről **nem tudja törölni** a rossz sort, és a menetlevél **diurnáját KÖZVETLENÜL ebből számoljuk** (`lib/tripCrossings.js` → `calculateDiurna` 12:00-szabály) — egy félrenyomott BE/KI a napidíjat (extern/intern napok) rontja el, ami pénzben mérhető hiba.

### Mi változott
1. **`public/sofer.js` `sendBorderCross(tip, tara)`** — a rögzítés (és a GPS-lekérés) ELŐTT `confirm()`. A kérdés az **irányt** nevezi meg (`sof.crossIn` / `sof.crossOut`), és jelzi, hogy most rögzül az idő + GPS-pozíció, ebből számoljuk a diurnát, és nem vonható vissza. Mégse → **még GPS-t sem kér** (nincs felesleges pozíció-lekérés).
2. **`public/i18n.js`** — új `sof.crossConfirmAsk` kulcs (RO-alap + HU), `{act}` placeholderrel. A szöveg szándékosan KÜLÖN az állomás-gombokétól (ott „az iroda értesítést kap", itt a diurna a tét).
3. **`public/sofer.html`** — cache-bust `?v=20260729msask` → `?v=20260729ask2` (`i18n.js` + `sofer.js`).

### Nem érintett
Szerver-oldal és DB változatlan (`routes/soferApi.js` `POST /api/border-cross` + a PR #300-as bemenet-szigorítás); a menetlevél „🚛 Határátlépés rögzítése" gombja továbbra is csak a rögzítő-képernyőre navigál (`goSec('border')`), maga nem ír.

### Teszt
+3 eset a `tests/integration/sofer-client-flow.test.js`-ben: `confirm=false` → **nincs** `/api/border-cross` hívás ÉS nincs `getCurrentPosition`; `confirm=true` → POST a helyes `tip`/`tara` payloaddal; a kérdés külön nevezi meg a BE-t és a KI-t. **863 → 866 Jest zöld** (45 skipped valós-DB).

---

## 2026-07-29 — Sofőr: az állomás-gomb (odaért / felrakodott / stb.) megerősítést kér (PR #302)

### Miért
A sofőr fuvar-kártyáján az állomás-léptető gomb (`➜ Megérkeztem a felrakóhoz` / `Felrakodtam` / `Megérkeztem a lerakóhoz` / `Leürítettem`) eddig **egyetlen koppintásra azonnal** rögzítette az időbélyeget és értesítette az irodát. Ez a napi 4× használt művelet, és a gomb a kártya **fejlécén** ül (`fuvar-head-action`) — épp azért, hogy vezetés után, kesztyűs kézzel ne kelljen előbb kinyitni a kártyát; ugyanez teszi könnyen félrenyomhatóvá. Az állomás **nem vonható vissza**: a szerver mindig a következő üres állomást tölti ki, az első `In Curs`-ra, az utolsó `Finalizat`-ra lépteti a fuvart.

### Mi változott
1. **`public/sofer.js` `driverMilestone(id, stepIdx)`** — a fetch ELŐTT `confirm()`. A kérdés a soron következő állomást nevezi meg („Biztos, hogy »Felrakodtam«?"), és jelzi, hogy az időpont most rögzül + az iroda értesítést kap + nem vonható vissza. A `stepIdx` CSAK a kérdés szövegéhez kell — a döntést továbbra is a **szerver** hozza (a `d.step`-ből jövő toast változatlan). Érvénytelen/hiányzó index (beragadt régi HTML) → általános kérdés, de **kérdez**; némán sosem küld.
2. **Mindkét hívó** (kinyíló rész `actionBtn` + fejléc-gomb `headActionBtn`) átadja a már kiszámolt `msNextIdx`-et.
3. **`public/i18n.js`** — új `sof.ms.confirmAsk` kulcs (RO-alap + HU), `{act}` placeholderrel (a `t(key, vars)` már támogatja).
4. **`public/sofer.html`** — cache-bust `?v=20260728pick` → `?v=20260729msask` (`i18n.js` + `sofer.js`), hogy a beragadt mobil-cache lecserélődjön.

### Nem érintett
Szerver-oldal és DB változatlan (`routes/ordersRest.js` `POST /api/orders/:id/driver-milestone`); az irodai idővonal (`public/entity-detail.js` saját `_MS_STEPS`, read-only) szintén.

### Teszt
+4 eset a `tests/integration/sofer-client-flow.test.js`-ben (a valódi `public/sofer.js` VM-mel, DOM-stubon): `confirm=false` → **nincs** `/driver-milestone` hívás; `confirm=true` → POST a helyes végpontra; a kérdés a soron következő állomást nevezi meg (`stepIdx=2` → `arriveUnload`); hiányzó/tartományon kívüli `stepIdx` → általános kérdés, de továbbra is kérdez. **859 → 863 Jest zöld** (45 skipped valós-DB).

---

## 2026-07-29 — Sofőr-funkciók teljes lefedettsége (+84 új teszt) + 2 XSS-fix a naplórenderben + border-cross bemenet-validáció

### Miért
Kérés: „csinálj teszteket minden sofőr-funkcióval, és javítsd a hibákat, mostantól élesbe hibamentesen". A #299/#300 kör után átvizsgáltam, mit tesztel már valami (getMySoferOrders, scanReceipt, handover-lánc, GDPR export, getFuvarlevelFieldSuggestions, getMySoferStats, tripCrossings stb.) és mit nem — a hiánylistát pótoltam, közben találtam két valódi hibát.

### Hozzáadott tesztek

**`tests/integration/sofer-handlers.test.js` (+37 eset):**
- `getMyAssignedVehicle` — szerep-kapu (csak Sofer), cég+email kisbetűs illesztés, DB-hiba kecses lezárás.
- `getLastVehicleReadings` — Sofer/Admin/Manager engedélyezett, rendszám normalizálása („B 123" → „B123"), újabb GPS-snapshot **felülír** menetlevél-értéket, régebbi NEM ír felül, snapshot-lekérdezés hibája nem buktatja el (best-effort).
- `previewTripDiurna` — bejelentkezés-kapu, hiányzó dátum → ready:false, sofőrnek **nem** látszik externDays/internDays (csak Admin/Managernek).
- `getBonScanSettings` / `setBonScanEnabled` / `deleteBonScanSample` — szerep-kapu, `SELF_ALLOWED_KEYS` fehérlista (ismeretlen kulcs → `ai-bon-scan`-re esik), samples-lekérdezés hibatűrése, idegen cég mintája nem törölhető (rowCount=0), az érvénytelen id (0/negatív/NaN/string) elutasítva.
- `getMyBonScanEnabled` — bejelentkezés-kapu, idegen szerep (Konyvelo) tiltva, GEMINI_API_KEY hiányában `hasKey:false`+`usable:false`.
- `getMyPrivacyNotice` — nincs notice → notice:null, friss ack → acknowledged:true, régi ack az újabb frissítéshez → acknowledged:false.
- `ackPrivacyNotice` — X-Forwarded-For első IP-je kerül be, company_id+user_id+kind='privacy_notice' a WHERE-ben.

**`tests/integration/sofer-routes.test.js` (+30 eset):**
- `POST /api/border-cross` — bejelentkezés-kapu, DB-hívás session-adatokkal (email/nume a szerverről), gps lat/lng parseFloat, hiányzó tip → 'Iesire' default.
- `POST /api/doc-upload` — orderId nélkül safeOrderId=null, **idegen cég fuvar-ID → NULL-ra vág** (nincs cross-tenant csatolás, ownership-check WHERE-je cégre szűrt), saját cég fuvar-ID megőrzve.
- `GET /api/doc-download/:id` — Sofer csak SAJÁT dokumentumot lát (WHERE tartalmazza az email-szűrőt), Admin/Manager cégen belül minden dokumentumot, data-URL PDF → inline, nyers base64 → attachment, üres storage_url → 404.
- `POST /api/orders/:id/driver-status` — nem-Sofer 403, érvénytelen státusz → nem hívja a DB-t, tulajdon-ellenőrzés WHERE-je (id + company_id + LOWER(email)), happy path (In Curs → UPDATE + push).
- `POST /api/orders/:id/driver-milestone` — nem-Sofer 403, idegen fuvar → tulajdon-ellenőrzés, Finalizat/Anulat/Parkolt/Raktarban → nem léptet, minden állomás kész → hibaüzenet, első állomás → status='In Curs', utolsó → status='Finalizat', köztes állomás NEM módosít státuszt, Extern státuszból a 2. állomásnál nem lép In Curs-ra.

**`tests/integration/sofer-client-flow.test.js` (+20 eset):**
Kliens-oldali `public/sofer.js` VM-alapú futtatása minimál DOM-stubbal:
- `fuvarCreate` fluxus (nincs draft / FOLYTAT / TÖRÖL / MÉGSE), `_opToggle` bejelöl/levesz, `opAccept` / `opCancel`.
- `_validateNoLeftoverOrders` — nincs indulási nap → engedi, indulás UTÁN elvégzett Finalizat → false + err-toast + picker újranyitása, INDULÁS ELŐTT elvégzett Finalizat kimaradása engedve, bepipálva engedi.
- IndexedDB képmegőrzés (#299 regresszió-védelem) — `_rcptImgPut/Get/Del` körforgás, `rcptQueueRemove` egyetlen ponton törli a képet, `_rcptImgPrune` MÁS sofőr képéhez nem nyúl, IndexedDB nélkül kecses leromlás.
- Offline outbox — `_outboxSendOne` a locPlecare/locSosire-t TÍPUS szerint tölti (nem első/utolsó), `outboxFlush` pending tétel sikeres → törlődik, offline állapotban nem próbálkozik.
- Per-sofőr storage kulcs: `vs_sofer_state:<email>` formátumban él.

### 2 valós XSS-javítás és 1 bemenet-szigorítás

**`public/sofer.js` `loadBorderLog`** — a `border_crossings.locatie` DB-ből jön (a sofőr saját beküldése), és eddig **escape nélkül** került `innerHTML`-be. Rosszindulatú `/api/border-cross` hívás (nem a kliensről, hanem közvetlen POST) tárolt XSS-t okozhatott a sofőr saját fuvarnaplójában. Javítás: `esc(l.locatie)`.

**`public/sofer.js` `renderPendingReceipts`** — a bon-scan kártya cím/hibaüzenet mezői (`f.loc`, `f.suma`, `f.valuta`, `it.error`) Gemini-válaszból/szerver-hibaüzenetből jönnek. A `_sanitize` fehérlistázza a hosszot, de HTML-t **nem** escape-el, viszont a `title` közvetlenül `innerHTML`-be került. Javítás: `esc(...)` mindenütt.

**`routes/soferApi.js` `POST /api/border-cross`** — a `tip` mezőt eddig szabadon fogadta (VARCHAR(20) → csendes megcsonkolás), a `gps_lat/lng`-t `parseFloat`-tal (`NaN`/`Infinity`/tartományon kívüli érték is a DB-be kerülhetett), és a `locatie` hossz-korlát sem volt. Szigorítás: `tip` fehérlista (`Intrare`/`Iesire`, egyébként `Iesire` default), `tara`→50 char, `locatie`→255 char, `gps_lat`/`gps_lng` `|n| ≤ 180 && Number.isFinite`, különben NULL.

### Teszt
**856 → 859 Jest zöld** (7 skipped valós-DB, változatlan baseline). +84 új teszt, +3 zöld a bemenet-validáció szigorítása után is (nincs regresszió). Napirend: CHANGELOG.md, CLAUDE.md, AUDIT.md (18. lépés — a két XSS-fix + border-cross bemenet-védelem).

---

## 2026-07-28 — Menetlevél: fuvar-picker (a fuvar-lista csak akkor jön elő, amikor kell) + mentett-piszkozat folytat/töröl dialog + kimaradt Finalizat blokkolja a lezárást

### Miért
A menetlevél 1. lépése eddig egy zsúfolt képernyő volt: minden kiosztott fuvar listája + „Menetlevél létrehozása" gomb + AI-scan + „mentett menetlevél folytatása" sáv. A sofőr rögtön szembesült a fuvar-listával, mielőtt eldöntötte volna, hogy egyáltalán ÚJ menetlevelet készít, vagy a mentettet folytatja. Emellett a mentett piszkozat kezelése is homályos volt: a „Menetlevél létrehozása" gomb bemutatta a fuvar-lista bepipálását, majd a step2-t nyitotta — mentett tartalom + új fuvar keveredett anélkül, hogy a sofőr választhatott volna. Végül a lezárás nem védte magát: ha egy fuvar a menetlevél indulása UTÁN lett elvégezve és kimaradt, a sofőr így véglegesítette az MT-YYYY-XXXX bizonylatot.

### Mi változott (`public/sofer.html`, `sofer.js`, `sofer.css`, `i18n.js`)
1. **Csak 3 dolog látszik a menetlevél kezdőképernyőjén:** „📄 Menetlevél létrehozása" gomb · „📷 Bon szkennelés (AI)" · a mentett-piszkozat folytatás sáv (ha van). A régi bepipálós fuvar-lista (`#soferOrderList`) `display:none`-nal maradt (a `loadSoferOrders` cache-e ugyanúgy tölt, csak nem rajzol).
2. **„Menetlevél létrehozása" → mentett piszkozat kezelése.** Ha van megkezdett menetlevél: dialog kérdez. **FOLYTAT** → `resumeDraft()` (rögtön step2), majd megnyílik a picker `continue` módban (a jelenlegi kijelölés pre-checked, add/remove). **TÖRÖL** → két külön koppintás (visszavonhatatlan → biztonsági megerősítés): a piszkozat és a kijelölés is ürül, majd a fresh folyamat indul. **MÉGSE** → semmi nem történik.
3. **Új fuvar-picker modal** (`#orderPickerModal`, `_openOrderPicker(mode, cb)`): a `_soferOrdersCache`-ből (waybill_visible=true) mutatja a fuvarokat, indulási dátum szerint rendezve. Phase-badge (📤 loading / 📥 unloading) és `⚠️ lezáráshoz kell` jelzés az indulás után elvégzett Finalizat sorokon. „→ Tovább" / „← Mégse" — Mégse a fresh úton visszatart step2-től.
4. **„✏️ Fuvarok kezelése" gomb a step2-ben** — a picker utólag is nyitható. A visszaadott új kijelölésre a `_applyPickerDiff(newIds)` illeszti a `puncte`-t: levett fuvar tag-elt sorai törlődnek, hozzáadott fuvar Incarcare/Descarcare sorai a Sosire ELÉ kerülnek (a fázis szerint egyet vagy kettőt), a meglévő sorok érintetlenek (a sofőr által beírt dátum/óra nem vész el).
5. **Lezárási védőháló** (`_validateNoLeftoverOrders`): `submitFuvarlevel` első lépéseként fut. Ha van olyan Finalizat fuvar a `_soferOrdersCache`-ben, aminek `finalized_at > Plecare-dátum` és nincs a menetlevélen, blokkolja a beküldést, err-toasttal figyelmeztet, és rögtön megnyitja a pickert (a sofőr bepipálja, majd újra ráüt a lezárásra). Az indulás előtti Finalizat kimaradása megengedett (történelmi).
6. **`_plecareStartDay()`** közös segéd (DOM Plecare sor → piszkozat → `_pendingPlecare`) — a lezárás-validáció és a picker `⚠️ lezáráshoz kell` badge is ebből dolgozik → konzisztens ítélet.
7. **13 új i18n kulcs** (RO-alap + HU), új CSS blokk a picker-modalra (világos kártya, ugyanaz a stílus, mint a többi mobil modal); cache-bust `?v=20260728pick`. Szerver-oldal és DB érintetlen (a `getMySoferOrders` amúgy is visszaadja a `finalized_at`-et, `waybill_phase`-t, `waybill_visible`-t).

### Teszt
**772 Jest zöld** (változatlan baseline) + DOM-shim harness a picker-fluxusra (18 eset): nincs draft → Plecare + picker + step2; VAN draft/FOLYTAT → resumeDraft + continue picker; VAN draft/TÖRÖL → draft+kijelölés ürül, fresh picker; MÉGSE → semmi nem történik; leftover-validátor kimaradt Finalizatra false + err-toast + picker újranyitása; bepipálva engedi; nincs indulási dátum → engedi.

---

## 2026-07-28 — Bon-scan: a lefotózott bon a kiolvasás elfogadásáig MEGMARAD (IndexedDB) + 15 mp-es holt idő megszüntetve

### Miért
Kérdés érkezett, hogy a sofőr által feltöltött képet canvas-szal átalakítjuk-e, vagy nyersen kezeljük. **Átalakítjuk** — mindkét feltöltési út canvas-on megy (bon-scan 1600px, dokumentum 2000px, JPEG q=0.85; PDF szándékosan nyers marad). A valódi hiány a kép **megőrzése** volt:

1. **A lefotózott bon elveszett, ha bármi közbejött.** A várólista `localStorage`-ba CSAK a 128px-es thumbnailt írta; a teljes kép kizárólag a `_scanReceiptTry` closure-jében élt. Ha az OS kilőtte a háttérben lévő appot, a sofőr elhagyta a képernyőt, vagy mind a 3 auto-retry elbukott, a fotó **véglegesen** eltűnt: a tétel `error`-ra váltott, ahol egyetlen gomb volt, a ✕. Újra kellett fotózni — csakhogy a `receiptScanFile` input `capture="environment"`-tel a kamerát nyitja, a kép sok készüléken **nem kerül be a galériába**, a papír bon pedig addigra gyakran már a kukában van.
2. **Minden bon-scan 15 másodpercet várt az ELSŐ kérés előtt.** A `_scanReceiptTry` `var wait = BACKOFFS[attempt] || 15000` sora: `BACKOFFS[0]` értéke `0`, ami **hamis**, így a `||` minden első próbánál 15 000-re váltott. A sofőr ennyit nézte a spinnert, mielőtt bármi elindult volna — ez érdemben hozzájárult a „nem működik a bon-scan" élményhez (a #287–#289 körök más gyökereket javítottak).

### Mi változott (`public/sofer.js`, `i18n.js`, `sofer.html`)
1. **Teljes kép az IndexedDB-be** (új `_rcptIdbOpen`/`_rcptImgPut`/`_rcptImgGet`/`_rcptImgDel`/`_rcptImgPrune`). **Miért nem localStorage:** egy 1600px-es JPEG base64-je 100–500 KB, a lista max 20 tétel → akár 10 MB, miközben a localStorage kvótája ~5 MB, és azon **osztozik a menetlevél-piszkozattal** — ez volt a #298-as adatvesztés gyökere. Az IndexedDB külön, nagyságrenddel nagyobb tárterület → a piszkozat sosem szorul ki.
2. **A kép a hálózati hívás ELŐTT mentődik** (`scanReceiptStart`), a tétel `hasImage` jelzőt kap. A kép törlése **egyetlen ponton**, a `rcptQueueRemove`-ban történik — amit az elfogadás (`rrAccept`) és az eldobás (`rrRemove`/`rrDiscard`) is hív → sem idő előtti törlés, sem visszamaradt szemét.
3. **Új `rrRetry(id)` + 🔄 gomb** az `error` tételen: a megőrzött képből indítja újra a kiolvasást, **újrafotózás nélkül**. A hibaüzenet mellett kiírjuk, hogy a fotó megvan.
4. **Induláskor magától folytatódik** a megszakadt feldolgozás (`rcptQueueMaint`): a 3 percnél régebben „processing" tétel, ha van képe, újraindul; ha nincs, marad az őszinte `error`. A karbantartás **az authMe UTÁNRA került** — a lista kulcsa per-sofőr (`_driverStoreKey`), így a `_meData` nélkül futó régi hívás a csupasz legacy kulcsról olvasott, azaz a sofőr tételeit meg sem látta.
5. **Backoff-fix:** `(attempt < BACKOFFS.length) ? BACKOFFS[attempt] : 15000` → az első próba tényleg azonnal indul (0s → 5s → 15s, a komment szerint).
6. **Takarítás** (`_rcptImgPrune`): a jelenlegi sofőr listájáról már lekerült képek + bármely sofőr 14 napnál régebbi képe. Közös telefonon a **másik sofőr képéhez nem nyúl** (`driver` mező). Ha az IndexedDB nem elérhető (privát mód, régi böngésző), minden a régi módon fut — csak a megőrzés marad el, semmi nem törik el.
7. **Review-modal:** ha a thumbnailt a localStorage kvóta-védelme eldobta, a megőrzött teljes képből pótoljuk (a sofőr lássa, melyik bont nézi át). 2 új i18n kulcs (`sof.rr.retry`, `sof.rr.photoKept`, RO-alap + HU), cache-bust `?v=20260728img`.

### Teszt
**772 Jest zöld** (változatlan baseline) + DOM-shim harness az IndexedDB-réteghez (16 eset): kép-megőrzés, a localStorage érintetlensége, újraindítás a tárolt képből, induláskori auto-folytatás, elfogadáskori törlés, kép nélküli tétel őszinte error-ja, közös telefon / másik sofőr izolációja, IndexedDB nélküli kecses leromlás, és a 15 mp-es holt idő hiánya (ez a harness mérte ki a backoff-hibát).

---

## 2026-07-28 — Sofőr UX-kör: km-validáció, állomás-gomb a kártyán, offline outbox, tartós piszkozat, összecsukható szekciók, helyszín-javaslatok

### Miért
A sofőr-oldal átvilágítása után a prioritás-lista tételei egy körben. A legsúlyosabb kettő valódi adatvesztés volt:

1. **A telefonos mentés „hosszabb idő után" elvesztette a beírt adatot.** Gyökér: a menetlevél auto-piszkozata `sessionStorage`-ban élt, ami a tab/PWA élettartamáig tart — amint az OS memória-nyomás miatt kilőtte a háttérben lévő appot (telefon-lock után tipikusan percek-órák), MINDEN beírt adat elveszett, és a sofőr elölről kezdhette. `localStorage`-ba csak az explicit „💾 Mentés a telefonra" gomb írt, amit a sofőr nem feltétlenül nyomott meg.
2. **A hibás km csendben 0-ra vágódott.** A szerver `Math.max(0, kmSf - kmInc)`-et számolt: egy elgépelt záró km (kisebb a kezdőnél) 0 km + 0 fogyasztás lett, figyelmeztetés nélkül — és a hibás menetlevél hivatalos bizonylattá vált (MT-YYYY-XXXX).

### Mit
1. **TARTÓS piszkozat** — az auto-mentés `sessionStorage` → **per-sofőr `localStorage`** (`vs_sofer_state:<email>`), ugyanaz a kulcs-séma, mint a mentett piszkozatoknál. Túléli az app-kilövést, az újraindítást és a kijelentkezést is (a `stateClear` mostantól a navigációs állapotot dobja, a piszkozatot megtartja). A `sessionStorage`-ba tükrözünk (privát mód / tele tár esetére), és egyszeri migrációval átvesszük a régi munkamenet-értéket. Új **„📄 Van egy megkezdett menetleveled"** folytatás-sáv a menetlevél 1. lépésén, ha a navigációs állapot elveszett volna.
2. **Kvóta-védelem** — a `_perDriverSetJson` eddig NÉMÁN elnyelte a mentés-hibát: tele localStorage-nál a sofőr azt hitte, mentett, pedig semmi nem íródott ki. Most teli tárnál előbb helyet csinál (bon-thumbnailek eldobása), újrapróbál, és ha még így sem megy, **szól** (`sof.storageFull`).
3. **Élő km/üzemanyag ellenőrzés** (`#kmFuelCheck`) — megtett km + becsült fogyasztás (L/100km) élőben, a mezők alatt. Negatív km → piros, **blokkoló** (a beküldés a Sosire-dialógus ELŐTT áll meg, hogy ne kelljen feleslegesen kitölteni az érkezést); >5000 km vagy a 20–38 L/100km sávon kívüli fogyasztás → narancs figyelmeztetés; „záró üzemanyag > kezdő + tankolt" → jelzés. Az AdBlue kimarad a fogyasztásból.
4. **Állomás-gomb az ÖSSZECSUKOTT fuvar-kártyán** — a napi 4× használt művelet („megérkeztem a felrakóhoz" stb.) eddig két koppintás volt (kártya kinyit + gomb). Most a fejlécben is ott a soron következő állomás gombja; `stopPropagation`, tehát nem nyitja ki a kártyát.
5. **Offline OUTBOX** — a menetlevélnek eddig nem volt auto-újraküldése (a bon-scannernek igen): offline beküldésnél az adat elmentődött, de a sofőrnek KELLETT emlékeznie, hogy visszatérjen. Most a küldésre váró piszkozat „⏳ Küldésre vár" jelzést kap, és a rendszer magától elküldi, amint van hálózat (`online` esemény / app előtérbe kerül / indulás).
6. **Dokumentum-feltöltés** — a fotó feltöltés ELŐTT lekicsinyítve (max 2000px, JPEG q=0.85; egy mai telefon-fotó nyersen 3–8 MB, base64-ben 4–11 MB → mobilneten lassú, gyakran elhasal, és a `documents.storage_url` base64-ként hízott); **több fájl egyszerre** (`multiple` — egy CMR gyakran 3–4 lap), soros feltöltés haladásjelzővel; a gomb feltöltés alatt **letiltva** (eddig a dupla-koppintás két sort hozott létre).
7. **AI bon-scan: a gomb nem tűnik el némán** — eddig `usable=false` esetén (nincs `GEMINI_API_KEY` / a cégnél kikapcsolva) a kártya egyszerűen eltűnt, a sofőr csak annyit látott, hogy „nem működik az AI". Most letiltva marad, és kiírja a KONKRÉT okot.
8. **Összecsukható szekciók** a menetlevél 2. lépésén (pontok / tankolás / kiadás) — a fejlécben a lényeg („3 · 418 L"), az üres szekció alapból csukva → rövidebb, átláthatóbb lap. A mezők a DOM-ban maradnak, tehát minden gyűjtő/validáció/húzás változatlan.
9. **Helyszín-javaslatok a sofőrnek** — a `getFuvarlevelFieldSuggestions` (eddig Admin/Manager-only) mostantól a sofőrnek is válaszol (ugyanaz a `company_id`-szűrt halmaz: saját cégen belül MÁR beírt értékek, nincs új kitettség). A helyszín/termék mezők natív `<datalist>`-tel kínálják a korábbi értékeket — a sofőr vezetés után, egy kézzel gépel.
10. **Beküldés-összegző** — a menetlevél MT-YYYY-XXXX sorszámot kap és nem vonható vissza, ezért véglegesítés előtt egy áttekintő modal (időszak, rendszám, km, fogyasztás, pontok/tankolások/kiadások/fuvarok száma).
11. **`loc_plecare`/`loc_sosire` + helyszín-kötelezőség** — a Plecare/Sosire soron a helyszín is kötelező (a modal bekérte, a kézzel felvett sor kikerülte). Beégetett magyar placeholderek → román alap (RO-alap szabály).

**772 teszt zöld** valódi Postgres 16-tal; minden tétel headless Chromiummal (393px), futó szerverrel élesben verifikálva — köztük a bejelentett hiba pontos szimulációja (tab megszüntetése = app-kilövés → a piszkozat visszaáll). Cache-bust `?v=20260728keep`.

## 2026-07-28 — Menetlevél: a Plecare/Sosire ÓRÁJA is kötelező (pontos diurna) + a piszkozat többé nem dobja el az órát/fuvar-tageket

### Miért
Az előző körben a határátlépés a főoldali GPS-gombokból számol, de a diurna-ablak két végpontja (Plecare/Sosire) **óra nélkül** is elmenthető volt — ilyenkor a rendszer **12:00-ra** esett vissza. Ez a lehető legrosszabb alapérték: a 12:00 pontosan az a határ, aminél a `calculateDiurna` az **indulás napját** (`depHour >= 12` → kihagyva) és az **érkezés napját** (`arrHour <= 12` → kihagyva) NEM számolja. Egy valós 06:45 → 20:00 út így 4 nap helyett 3 napot kapott — a sofőr **csendben elvesztett egy nap napidíjat**.

Ráadásul kiderült, hogy a modálban megadott óra amúgy sem élte túl az első billentyűleütést: a `draftSave()` (600 ms-os auto-piszkozat) csak `tip`/`loc`/`data`-t gyűjtött, miközben a `draftRestore()` `time`/`orderId`/`role` mezőket is várt. Az óra tehát **mindig** elveszett — és vele a fuvar-visszakötő tag-ek is, amiktől a beküldés az `orders.incarcat_at`/`descarcat_at`-ot frissíti (a PR #292/#293 funkciója némán elromlott piszkozat-visszatöltés után).

### Mit
1. **Óra:perc KÖTELEZŐ a Plecare/Sosire modálban** (`wbLocDialog`) — üres vagy érvénytelen (óra 0–23, perc 0–59) érték esetén hibaüzenet, a modal nyitva marad. Két új i18n kulcs (`sof.wb.timeRequired`, `sof.wb.timeInvalid`).
2. **Alapérték a MOSTANI idő** — a sofőr az indulás/érkezés pillanatában nyitja meg a párbeszédet, így jellemzően csak jóváhagyja. Átírható.
3. **Az óra láthatóvá és szerkeszthetővé vált a pont-soron** (`.punct-time`, `type="time"`, a dátum mellett). Eddig a modal lefutása után nem lehetett javítani, csak a sor törlésével — pont annál az adatnál, ami a napidíjat befolyásolja.
4. **KÖZÖS sor-gyűjtők** (`_collectPuncte` / `_collectAlim` / `_collectAch`) — a három korábbi, egymástól eltérő másolat (auto-piszkozat, telefonra mentés, beküldés) helyett EGY forrás. Ez javítja a fenti adatvesztést: a piszkozat mostantól a `time` + `orderId` + `role` mezőket is megőrzi. A beküldés továbbra is számmá alakítja az értékeket (`numeric` kapcsoló), a piszkozat a nyers stringet tartja (a félig beírt szám se vesszen el).
5. **Beküldés-validáció** — ha a sofőr utólag kiüríti a Plecare/Sosire sor dátum- vagy óra-mezőjét, a beküldés blokkol, a hibás sorra görget és fókuszál (`sof.wb.tripTimeMissing`).
6. **`loc_plecare` / `loc_sosire` TÍPUS szerint** (nem pozíció szerint) — a PR #295 óta a pont-sorok húzással átrendezhetők, így a Plecare/Sosire nem feltétlenül az első/utolsó sor; a régi `puncte[0]` / `puncte[last]` olvasás rossz helyszínt menthetett. Fallback a régi viselkedésre.
7. **`_syncTripTimesFromPuncte`** a sor `.punct-time` mezőjéből olvas (a `data-time` attribútum megszűnt — egyetlen igazságforrás). A 12:00 fallback már csak a régi, óra nélkül mentett piszkozatokra vonatkozik.
8. Cache-bust `?v=20260728hour`. **772 teszt zöld**; a kötelező óra, az érvénytelen-óra blokk, a soron látható óra, az auto-piszkozat óra-megőrzése és a beküldés-blokk headless Chromiummal (393px) élesben verifikálva.

## 2026-07-28 — Menetlevél: a határátlépés KIZÁRÓLAG a főoldali 2 gombból (GPS) — kézi bevitel megszűnt, a diurna ebből számol

### Miért
A határátlépés eddig **kétszer** volt bekérve, két egymásról nem tudó rendszerben: a sofőr a határon megnyomta a főoldali „🇷🇴 ROMÁNIA BE / KI" gombot (GPS-koordinátával, `border_crossings` tábla), majd a menetlevél kitöltésekor **ugyanazt az átlépést újra beírta kézzel** (`datetime-local` sorok → `fuvarlevelek.hataratok`). A napidíjat (diurna) a **kézi** bevitel határozta meg — a valós GPS-rögzítést a menetlevél soha nem olvasta be. Ez dupla munka volt, és a pénzt egy elgépelhető, utólag emlékezetből pótolt adat döntötte el.

### Mit
1. **Kézi bevitel TÖRÖLVE a menetlevélről** — `public/sofer.html`: a „🛂 Határátlépések" szekció + `#hatarContainer` + „➕ Átlépés hozzáadása" gomb eltávolítva. `public/sofer.js`: `addHatarRow()` és `collectHataratok()` törölve, minden hívási pontjukkal együtt (piszkozat-mentés/-visszaállítás, beküldés-payload, űrlap-reset). A kliens **nem küld** többé `hataratok` mezőt.
2. **Új közös segéd `lib/tripCrossings.js`** — `fetchTripCrossings(pool, email, indulasDt, erkezesDt)`. Az ablak a menetlevél **naptári napjait** fedi (indulás napjának 00:00 → érkezés napjának 23:59), mert a diurna naptári napokban számol és a sofőr a határon gyakran a menetlevélbe írt óra előtt/után koppint. Az `'Iesire'/'Intrare'` → `'OUT'/'IN'` fordítás itt, egy helyen. Multi-tenant: mindig a **bejelentkezett** sofőr e-mailjére szűr (a `border_crossings` e-mail-kulcsú, nincs company_id oszlopa).
3. **SEED — az ablak előtti utolsó átlépés is beleszámít.** A diurna-motor alapból „Romániában van" állapotból indul; ha a sofőr már az ELŐZŐ menetlevélen kilépett és még nem tért vissza, e nélkül tévesen INTERN napokat számolnánk. A seed a **számításba** bekerül, a menetlevél naplójába **nem** (ott csak az időszak tényleges átlépései látszanak).
4. **Szerver — `routes/soferApi.js` `/api/fuvarlevel-save`**: a klienstől érkező `hataratok` **szándékosan eldobva** (régi, gyorsítótárazott `sofer.js` még küldhetné); a `fuvarlevelek.hataratok`-ba a GPS-rögzítések kerülnek (`source:'gps'`, hely, irány, időbélyeg), a diurna pedig a **meglévő** `calculateDiurna(dep, arr, crossings)` 12:00-szabályával számol — a számítási logika NEM változott.
5. **Új handler `previewTripDiurna`** (`handlers/documents.js`) — a menetlevél-űrlap élő előnézete UGYANAZT a lekérdezést és UGYANAZT a `calculateDiurna` hívást használja, mint a mentés → az előnézet és a mentett érték **nem térhet el**. (A régi kliens-oldali becslés `Math.ceil(napok)+1` volt, ami eltért a szerver 12:00-szabályától.) **Szerep-függő válasz:** az EXTERN/INTERN napszám (pénzügyi adat) CSAK Admin/Manager-nek megy — a sofőr a napló + a napok számát látja, a diurna a felületén továbbra sem jelenik meg (mint a menetlevél-PDF-en sem).
6. **Új olvasható napló-doboz a menetlevélen** (`.diurna-box`, `sofer.css`) — időszak + átlépés-lista (irány-badge, időpont, GPS-helyszín) + magyarázat + nagy „🚛 Határátlépés rögzítése" gomb, ami a főoldali rögzítőre ugrik. Így a sofőr **beküldés előtt** látja, ha lemaradt egy átlépés, és még pótolhatja. Üres időszaknál narancs figyelmeztető állapot.
7. **Admin kézi menetlevél is egységes** (`fuvarlevelCreate`) — eddig üres átlépés-listával számolt (mindig INTERN); mostantól a kiválasztott sofőr GPS-átlépéseiből, és a naplót is eltárolja. A kézzel beírt diurna-napok felülbírálása változatlanul működik.
8. **6 új i18n kulcs** (`sof.dr.*`, RO-alap + HU); a beégetett magyar előnézet-szöveg (`'🕐 Út: … nap … határátlépés rögzítve'`) és a `placeholder="Dátum + óra"` megszűnt. Cache-bust `?v=20260728border`.
9. **Teszt** — új `tests/unit/tripCrossings.test.js` (10 eset: nap-alapú ablak, irány-fordítás, seed be/ki hatása a diurnára, e-mail-szűrés, szerep-függő válasz) + 2 új valódi-DB integrációs eset (`fuvarlevelek-db.test.js`: a kliens hamis `hataratok`-ja NEM használódik; belföldi út → 0 extern nap). A `tests/helpers/real-db.js` `truncateAll` kiegészítve a `border_crossings` táblával (nincs FK a companies-ra → a CASCADE nem vitte, átszivárgott a tesztek közt). **772 teszt zöld** valódi Postgres 16-tal.

## 2026-07-28 — Sofőr menetlevél: útvonal-pontok átrendezhetők (hosszan nyomva → húzás, beszúrás-jelző vonallal)

### Miért
A menetlevél útvonal-pontjai eddig abban a sorrendben álltak, ahogy létrejöttek (Plecare → a kiválasztott fuvarok fel-/lerakásai → Sosire). Ha a sofőr a valóságban más sorrendben járta be a pontokat (pl. két fuvar lerakása felcserélődött), csak úgy tudta javítani, hogy a mezőket egyesével átgépelte. Kérés: a pont **egyben** (típus + dátum + helység) legyen mozgatható, **telefonról főként hosszan nyomva tartva** — a kártya „ugorjon ki", és egy vonal előre jelezze, melyik két pont közé kerül.

### Mit
1. **`public/sofer.js` — új pointer-alapú átrendező** (`_punctDragInit` + `_punctPointerDown`/`Move`/`Up`/`Cancel`, `_punctDragActivate`/`Update`/`End`). Hosszan nyomva (**400 ms**) a sor „kiugrik" (kiemelt árnyék + `scale(1.03)`, `navigator.vibrate(30)` tapintható visszajelzés) és követi az ujjat; felengedésre a jelzett helyre kerül. Nem a natív HTML5 drag&drop (mobilon használhatatlan), hanem **Pointer Events** → érintés és egér ugyanazon az úton.
2. **Beszúrás-jelző vonal** (`.punct-drop-line`) — a konténerhez képest **abszolút** pozicionált, így a sorok NEM ugrálnak húzás közben; a cél-pozíció a többi sor függőleges felezőpontjához mérve dől el.
3. **Görgetés-barát**: a long-press LEJÁRTA ELŐTT >10px elmozdulás = görgetési szándék → nincs húzás. Aktív húzás közben nem-passzív `touchmove` + `preventDefault` tiltja a lapgörgetést, a képernyő szélénél automatikus görgetés fut, és a közben elmozduló görgetés-pozíciót korrigáljuk (nem csúszik ki a sor az ujj alól). `pointercancel` (a böngésző elvette a gesztust) → **nem** rendez át.
4. **Fogantyú-sáv minden pont-soron** (`.punct-grip`): **sorszám-buborék (1..N)** + `⠿` ikon + „Ține apăsat pentru a muta" jelzés. A húzás a fogantyúról, a címkékről és a sor üres felületéről indul; a **beviteli mezőkről NEM** (a szerkeszthetőség/kijelölés érintetlen).
5. **Sorrend-változás kezelése**: a payload-gyűjtők eleve DOM-sorrendben olvasnak, ezért a csere után elég a `draftSave()` + `_syncTripTimesFromPuncte()` (az „Út időpontjai" horgony **első Plecare / utolsó Sosire** — átrendezés után változhat) + `_punctRenumber()`. Ha a sofőr ugyanoda engedi vissza a sort, index-alapú összehasonlítás ismeri fel → nincs felesleges mentés. Új `punctRowRemove()` a pont-sor ✕ gombjára (a régi inline `parentNode.remove()` helyett) → törlés után is helyes a számozás + az idő-szinkron.
6. **`public/sofer.css`** — `.punct-grip`/`.punct-grip-idx`/`.punct-grip-ico`/`.punct-grip-hint`, `.punct-dragging` (kiemelés), `.punct-dropped` (letevés-villanás), `.punct-drop-line` (jelző-vonal), `#puncteContainer{position:relative}` + `user-select:none` a címkéken/húzás közben (nincs szöveg-kijelölés / iOS callout).
7. **i18n** 1 új kulcs (`sof.dragHint`, RO-alap + HU). Cache-bust `?v=20260728drag` (sofer.html/js/css + i18n.js). A **tankolás/vásárlás sorok NEM mozgathatók** (csak a `punct-row` osztályú pont-sorok), a szerver-oldal **érintetlen**.

### Ellenőrzés
**716 Jest zöld** (45 suite, 43 valós-DB skip). A húzó-logika DOM-shim harnesszel verifikálva (**22 eset**): sorszámozás, fölfelé/lefelé mozgatás, görgetési szándék elkülönítése, mezőről nem indul húzás, egy sor esetén nincs húzás, ugyanoda visszaengedve nincs mentés, jelző-vonal pozíciója, dragging/drop osztályok, törlés utáni újraszámozás.

---

## 2026-07-28 — Sofőr: MINDEN localStorage memoria per-sofőr + Plecare/Sosire dátum kötelező + Út időpontjai automatikusan a Plecare/Sosire-ból

### Miért
Az előző körben csak a Plecare/Sosire garaj-memoriál lett per-sofőr; a **mentett menetlevél-piszkozatok** (`vs_sofer_local_drafts`) és a **bon-scan AI várólista** (`vs_sofer_receipt_queue`) még mindig közös localStorage kulcsban éltek — közös telefonon másik sofőr láthatta/módosíthatta őket. Emellett a menetlevélen a Plecare/Sosire dátum + a régi „Út időpontjai" (Plecare/Sosire datetime-local) redundáns volt: két helyen kellett beírni ugyanazt.

### Mi készült
1. **Per-sofőr JSON storage helper** (`public/sofer.js` `_perDriverGetJson` / `_perDriverSetJson`) — a `_driverStoreKey(base)` (email-suffixes kulcs) általánosítva: minden a következő menetlevélre megjegyzett localStorage-érték ezen megy át. Legacy fallback: első alkalommal az esetleges közös kulcs átvevődik a per-driver kulcsba, onnantól csak a per-driver kulcsba írunk.
2. **`soferLoadLocalDrafts`/`soferStoreLocalDrafts` és `rcptQueueLoad`/`rcptQueueStore` átvezetve** a per-driver helper-re. Ugyanazon a telefonon két sofőr külön mentett piszkozatokat és külön AI-scan várólistát lát.
3. **sessionStorage-draft leak-védelem** — a `stateSave` mostantól `driverEmail: <me.email>` mezőt is ír a piszkozatba; az `authMe` befutása után, ha a sessionStorage-draftban az email nem egyezik a jelenlegi sofőrrel, kidobjuk. Közös telefonon a másik sofőr session-jéből ottragadt piszkozat így nem tér vissza.
4. **Plecare/Sosire modal DÁTUM kötelező** (`wbLocDialog`) — a `wbLocDate` mostantól strict validált (`YYYY-MM-DD`): a kiürítés + OK toast-hibát dob (`sof.wb.dateRequired`, RO+HU). A helyszín már eddig is kötelező volt; az óra:perc opcionális marad.
5. **Régi „Út időpontjai" mezők (fIndulasDt/fErkezesDt) automatizálva** — a `public/sofer.html`-ben a két `datetime-local` input `type="hidden"`-re cserélve, a látható szekció informatív magyarázó dobozzá alakítva (RO+HU: „a Plecare/Sosire dátumából számoljuk"). Új `_syncTripTimesFromPuncte()` a Plecare (első) + Sosire (utolsó) sorból képezi az `fIndulasDt` / `fErkezesDt` értékét (`YYYY-MM-DDTHH:MM`, `data-time` attribútum vagy 12:00 default). Delegated `input`/`change` listener a puncte-container-en → a sor-módosítás magától frissíti a rejtett input-okat, a `updateDiurnaPreview` is újrafut.
6. **Beküldés + piszkozat-visszaállítás sync** — a `_submitFuvarlevelFinal` mindig `_syncTripTimesFromPuncte()`-t hív a payload olvasása előtt; a `fuvarStep2` a puncte-építés után; a `draftRestore` (offline mentés visszaállítás) is. A szerver (`routes/soferApi.js`) érintetlen — ugyanabban a formátumban kapja az `indulasDt`/`erkezesDt`-t, mint eddig.
7. **A menetlevél sor dátuma közvetlenül szerkeszthető** — a Plecare/Sosire sor `.punct-data` input-ja (a `addPunctRow` DOM-alap) natív `type="date"` mező, kattintásra a rendszer naptára nyílik. A hidden input-ok auto-szinkron miatt a change azonnal hat az Út időpontjaira és a diurna-előnézetre.
8. **3 új i18n kulcs** (`sof.wb.dateRequired`, `sof.tripTimesAutoHead`, `sof.tripTimesAutoHint`, RO-alap + HU). Cache-bust `?v=20260728pers`. Szerver-oldal ÉRINTETLEN — **716 Jest zöld**; per-driver storage + trip-time-sync DOM-shim harnesszel verifikálva (12 eset zöld: A ment / B nem lát / A visszatér / legacy fallback / óra nélkül → 12:00 / több Plec-Sos első-utolsó nyer / nincs Plec-Sos → üres / rossz dátum → üres).

---

## 2026-07-28 — Menetlevél: per-sofőr Plecare/Sosire memoriál + a driver-beírt lerakás auto-Finalizat + LEZÁRT FUVAR bucket a `descarcat_at`-ra is

### Miért
Az előző kör (Plecare/Sosire modálok) a „legutóbbi garaj" értéket **közös** localStorage kulcsban tárolta — ha ugyanazon a telefonon több sofőr is használja az appot, felülírták egymást. A driver által beírt lerakási dátum a fuvarra átment (`descarcat_at`), de a fuvar státusza aktív maradt → a főoldali „LEZÁRT FUVAR" mini-csempe nem számolt a driver-beírt kész fuvarokkal.

### Mi készült
1. **Per-sofőr Plecare/Sosire memoriál** (`public/sofer.js` `_driverStoreKey` + `_getLastLoc`/`_setLastLoc`) — a `vs_sofer_garaj_start`/`_end` kulcshoz mostantól a bejelentkezett `_meData.email` fűződik: pl. `vs_sofer_garaj_start:peto@example.com`. Ugyanazon a telefonon két sofőr külön értéket lát/ment. **Visszafelé kompatibilis**: ha még nincs per-driver érték, egyszer a régi közös kulcsot használja fallback-ként; onnantól csak a per-driver kulcsba ír (a közös érték érintetlen). DOM-shim harnesszel verifikálva (A ment „Depou-Arad", B ment „Bara-Timisoara", A visszatér → saját érték).
2. **Auto-Finalizat aktív fuvarokra a driver menetlevél-beküldésekor** (`routes/soferApi.js` `/api/fuvarlevel-save`) — ha a driver puncte-ban `role='unloading'` sor van érvényes dátummal, és az adott fuvar státusza `Alocat`/`In Curs`, a szerver a `descarcat_at` UPDATE után átállítja a státuszt `Finalizat`-ra (a `finalized_at` trigger magától fut). **Extern / Parkolt / Raktarban** érintetlen (azokat a diszpécser zárja). Tenant-szűrt, best-effort — hiba nem buktatja a mentést.
3. **LEZÁRT FUVAR mini-stat a `descarcat_at`-ra is bucketol** (`handlers/statisticsHandlers.js` `getMySoferStats`) — a hónap-bucket lánc `COALESCE(finalized_at, descarcat_at, data_descarcare, created_at)`; a driver-beírt tényleges lerakás így pontos hónapba kerül akkor is, ha a `finalized_at` trigger utólag más időt írt (pl. késői mentés). A `WHERE status='Finalizat'` szűrés változatlan. **716 Jest zöld**.

---

## 2026-07-28 — Menetlevél: Plecare/Sosire (garaj-garaj) modálok + fuvar felrakási/lerakási dátum autofill + tényleges dátum a fuvar-kártyán

### Miért
A sofőr eddig kézzel írta be a menetlevélbe a felrakó/lerakó pontokhoz a dátumot, pedig a fuvar kártyáján a diszpécser már megadta a tervezett dátumokat. Emellett a menetlevél nem tükrözte, hogy a nap honnan indult (pl. Garaj-Arcus) és hova ért — a puncte lista rögtön az első felrakóval kezdődött. A fuvarkártyán is csak a tervezett dátum látszott; a sofőr által beírt tényleges rakodási dátum sehol nem jelent meg.

### Mi készült
1. **Új Plecare + Sosire típus a puncte dropdownban** (`public/sofer.js`) — a `Pont típusa` legördülő `['Plecare','Încărcare','Descărcare','Tranzit','Vamă','Parcare','Sosire','Altele']`; a menetlevél mindig egy Plecare (indulási pont) sorral kezdődik és egy Sosire (érkezési pont) sorral zárul.
2. **Modal a Plecare-ra a „📄 Menetlevél létrehozása" gombra** (`public/sofer.html` `#wbLocModal` + `public/sofer.js` `wbLocDialog('start', cb)`) — kötelező helyszín (alap: „Garaj-Arcus", localStorage-ban memoriál `vs_sofer_garaj_start`), kötelező dátum (alap: ma), opcionális óra + perc. OK → a puncte-be `Plecare` sor kerül; Mégse → marad az 1. lépésen. Ha a piszkozatban már van Plecare (visszalépés), nem kérdez újra.
3. **Modal a Sosire-ra a „📤 Menetlevél elküldése" gombra** — ugyanaz a modal, „🏁 Hová érkeztél?" fejléccel + `vs_sofer_garaj_end` memória. Csak a **beküldéskor** kérdez (nem a „💾 Mentés a telefonra" úton). Ha már van Sosire sor (retry), rögtön küld.
4. **Fuvar felrakási/lerakási dátumok autofill a puncte-ba** — a `fuvarStep2` a kiválasztott fuvarokból generálja az `Incarcare`/`Descarcare` sorokat, és **előtölti a dátumot** a fuvar `data_incarcare`/`data_descarcare` mezőjéből (`_ymdOf`). A sor `data-order-id` + `data-role` (loading/unloading) tag-et kap → a beküldéskor a szerver ez alapján köti vissza a fuvarra.
5. **Szerver — driver puncte dátumai → `orders.incarcat_at`/`descarcat_at`** (`routes/soferApi.js` `/api/fuvarlevel-save`, INSERT után) — a tagelt puncte-sorokból `UPDATE orders SET incarcat_at|descarcat_at = $data::timestamp WHERE id=$orderId AND company_id=$cid` (multi-tenant kapu; dátum-validáció `YYYY-MM-DD`, 12:00 UTC időzóna-biztosnak). Best-effort — hiba nem buktatja a menetlevél mentését. A **tervezett `data_incarcare`/`data_descarcare` érintetlen** (a diszpécser szemszögéből marad).
6. **Fuvar-kártya kinyíló részén kettős dátum** (`renderFuvarCard`) — ha a tervezett és tényleges dátum megegyezik / csak egyik van, egy érték látszik; ha eltér, „**Terv.**: 2026-07-28 · **Tényl.**: 2026-07-29" formában (`_fmtDualDate`). A `sof.det.planShort`/`sof.det.actualShort` i18n kulcsok (RO+HU).
7. **Piszkozat + soferCollectFull** — a puncte-hoz mostantól átmennek az `orderId`/`role`/`time` tag-ek is (session-piszkozat, offline helyi mentés, visszaállítás mind). `draftRestore` ezekkel hívja `addPunctRow`-t → visszalépéskor a Plecare + tagelt felrakó/lerakó sorok megmaradnak.
8. **10 új i18n kulcs** (`sof.wb.startTitle`/`endTitle`/`startHint`/`endHint`/`loc`/`date`/`time`/`ok`/`locRequired`, `sof.det.planShort`/`actualShort`, RO-alap + HU); cache-bust `sofer.html` `?v=20260728garaj`. Szerver-oldalon egyetlen best-effort UPDATE — **716 Jest zöld**; a modal + tag-áthaladás + szerver-oldali szűrés DOM-shim harnesszel verifikálva.

---

## 2026-07-28 — Sofőr menetlevél: a 2 létrehozó gomb EGY „📄 Menetlevél létrehozása" gombbá olvasztva + AI bon-kiolvasás ugyanoda

### Miért
A sofőr menetlevél 1. lépésén KÉT gomb állt egymás alatt („Tovább → Menetlevél kitöltése" és „➕ Menetlevél fuvar nélkül"), pedig a kettő ugyanoda vezet — az egyetlen különbség, hogy van-e bepipálva fuvar. Aki fuvar nélkül akart menetlevelet, annak a második gombot kellett megtalálnia; aki elfelejtett pipálni, hibaüzenetet kapott. Kérés: EGY gomb legyen, ami magától kezeli mindkét esetet (bepipált fuvar → bekerül; nincs pipa → fuvar nélküli menetlevél), és az AI bon/számla-kiolvasás is ide kerüljön.

### Mi készült
1. **EGY gomb (`public/sofer.html`)** — a két gomb helyén egy „📄 Menetlevél létrehozása" gomb (`fuvarCreate()`), alatta egy halvány magyarázó sor: *„A bejelölt fuvarok bekerülnek a menetlevélbe; pipa nélkül fuvar nélküli menetlevél készül."* Mindkét korábbi gomb tudása megmarad, az útvonal ugyanaz (`fuvarStep2`) — a kiválasztott fuvarok összesítője, a rendszám/km/üzemanyag/dátum-előtöltés és az útvonal-pont generálás változatlan; pipa nélkül a `sof.noOrderSummary` jelzés + kézi kitöltés (a szerver üres `order_ids`-t elfogad, a statisztika a sofőr e-mailjéhez kötődik).
2. **Nincs többé „jelölj be legalább egy fuvart" akadály** (`public/sofer.js`) — a `fuvarStep2` blokkoló guardja kivéve (az `allowEmpty` paraméter visszafelé-kompatibilitásból marad); a `fuvarNoOrder` megmarad vékony aliasként, hogy a beragadt (gyorsítótárazott) régi `sofer.html` se hasaljon el.
3. **AI bon-kiolvasás a menetlevél 1. lépésén is** — új „📷 Bon szkennelés (AI)" gomb a létrehozó gomb alatt, a főoldali kártyával AZONOS háttér-feldolgozásra (`scanReceiptPickFromDash()` → ugyanaz a perzisztens `localStorage` várólista, ugyanaz a `scanReceipt` RPC; nincs párhuzamos scan-út). A 2. lépés fuel/purchase scan-gombjai érintetlenek.
4. **Közös várólista-render** — a `renderPendingReceipts` mostantól MINDEN `.pending-receipts-box` konténerbe rendel (főoldali kártya + új `#fuvarStep1PendingBox`), így a menetlevél-képernyőn is látszik a „⏳ Feldolgozás…" / „Áttekintés" tétel; a `goSec('fuvar')` is újrarajzolja. Az elfogadott sorok ugyanúgy a piszkozatba kerülnek (a `fuvarStep2` visszatölti őket).
5. **Funkció-kapcsoló tisztelve** — a `_setBonScanVisible` (`ai-bon-scan` flag) az új 1. lépéses gombot és várólista-dobozt is elrejti, ha a cégnél ki van kapcsolva.
6. **i18n** 3 új kulcs (`sof.createWaybill`, `sof.createWaybillHint`, `sof.scanReceiptAny`, RO-alap + HU); cache-bust `sofer.html` → `i18n.js`/`sofer.js` `?v=20260728wbone`. Szerver-oldal ÉRINTETLEN — **716 Jest zöld**; a többdobozos render DOM-shim harnesszel verifikálva.

---

## 2026-07-28 — ÚJ: fuvar-kiírás — megrendelő feltöltése (PDF/JPG) + AI kiolvasás → előtöltött mezők + a fájl a fuvarhoz csatolva

### Miért
A megrendelő eddig KÉT úton juthatott be automatikusan kiolvasva: e-mail-intake (IMAP) vagy ügyfél-portál. Ha a diszpécser kapja meg a megrendelőt (WhatsApp, kézbe adott papír, letöltött PDF), végig kézzel gépelte be a fuvar-kiíró űrlapot. Kérés: a kiíráson EGY gomb, ami feltölt (PDF/JPG/stb.), az AI ugyanúgy kiolvassa mint az e-mailes megrendelőt, a mezők előtöltődnek, és a „Fuvarfeladat mentése" után a feltöltött fájl a fuvar dokumentumai közé kerül.

### Mi készült
1. **Új handler `handlers/orderScan.js`** (`scanOrderDocument` RPC, `routes/execute.js` registry-be regisztrálva) — a feltöltött fájlt a **KÖZÖS `services/order-ai`-ra** adja (UGYANAZ a prompt/mező-készlet + `lib/geminiJson` modell-lánc, mint az e-mail-intake kiolvasásnál; NINCS párhuzamos AI-logika). Kapuk: bejelentkezés + **Admin|Manager** + `ai-kiolvasas` csomag-flag. Formátum-fehérlista (PDF/JPEG/PNG/WEBP/HEIC), max **8 MB**. PDF-nél a `services/pdf-extract` szöveg-kinyerés is lefut → AI-hiba vagy hiányzó `GEMINI_API_KEY` esetén a **heurisztikus tartalék** tölt (`ai_used:false` jelzéssel, nem hibázik el). A válasz **fehérlistán validált** (nincs „kreatív" kulcs-szivárgás a kliensbe): számok számmá, dátum csak ISO, `load_type` csak FTL/LTL, rendszám nagybetűsítve, `greutate → suly_kg`. Audit-naplózva (`order.scan`) — **CSAK metaadat**, a fájl tartalma sosem kerül naplóba.
2. **`services/order-ai/gemini.js` általánosítva** — a régi PDF-only inline hívás mellé `fileBuffer`+`mimeType` (kép VAGY PDF) út; a `pdfBuffer` hívási forma (e-mail intake) byte-azonosan működik tovább. A `FIELDS`/prompt **6 új mezővel** bővült: `firma_incarcare`, `firma_descarcare`, `load_type`, `hossz_cm`, `szel_cm`, `mag_cm` (a kiíró űrlapnak mind van mezője) — így az **e-mailes megrendelés is** többet olvas ki.
3. **`routes/inbound-orders.js` `/approve`** — a két új cégmező (`firma_incarcare`/`firma_descarcare`) bekötve az INSERT-be (a `load_type`/dimenziók/`greutate` már eddig is mappelve voltak) → a kiolvasott adat nem esik el a jóváhagyásnál sem.
4. **Kliens (`public/console-shared.js`, KÖZÖS admin/manager kód)** — új `orderScanPick`/`orderScanFile`/`orderScanFill`/`renderOrdScanStatus`/`orderScanClear`/`_ordScanAttachTo`. A kép kliens-oldalon canvas-szal 1600px-re kicsinyítve (JPEG q=0.85) megy az AI-hoz, a **csatolmány viszont az EREDETI fájl** data-URL-je. A kitöltés csak a NEM üres AI-értékeket írja (a kézi tartalmat null mező nem törli); a dátum-csak érték `T00:00`-tal egészül ki a `datetime-local` mezőnek; a rendszám csak akkor kerül be, ha a cég flottájában VAN ilyen jármű (szóköz/kisbetű-független illesztés); FTL/LTL a két kizáró pipára + `refreshDimReq()`; a végén `orderRouteRecalc('create')` (a kiolvasott km-et nem írja felül). A mezőn kívüli info (CUI/pénznem/megjegyzés) a status-kártyán látszik, hogy ne veszjen el.
5. **Csatolás mentés után** — a `createOrder` sikeres válaszában `_ordScanAttachTo(r.id)` a **meglévő `orderDocUpload`** RPC-t hívja (tenant-ellenőrzött, nincs új upload-út) → a megrendelő a fuvar dokumentumai közt van, a meglévő aláírás/letöltés flow-val. A status-kártya „csatolás" pipája kikapcsolható; hiba esetén a fuvar akkor is elmentve marad (figyelmeztetés + a Feltöltött iratok fülön pótolható).
6. **UI + i18n** — új `#ordScanBtnBox` a Fuvar kiírás pane-en (admin + manager), a CSV-import gomb alatt; a gomb az `ai-kiolvasas` csomag-kapcsolóra rejtődik (`applyFeatureFlags`, alapból be). 17 új i18n kulcs (`form.aiScan*`, `cs.os.*`) RO-alap + HU. Cache-bust `?v=20260728ordscan` (admin/manager html → console-shared.js + i18n.js).
7. **Teszt** — új `tests/unit/orderScan.test.js` (13 eset: szerep-/csomag-/formátum-/méret-kapuk, PDF+kép út, teljes mező-normalizálás, ismeretlen kulcs nem propagál, érvénytelen dátum/típus → null, kulcs nélküli + 429-es tartalék). Plusz jsdom-harness a VALÓDI `admin.html` űrlapja ellen (mező-kitöltés, rendszám-illesztés, csatolás-hívás). **Teljes suite 716 Jest zöld** (43 skip valós DB).

## 2026-07-23 — FIX: bon-scan IGAZI gyökérok — `keepalive:true` 64 KiB body-limit → base64 kép el se ment a szerverre

### Miért
A megelőző körben (PR #288) a Gemini-lánc végre stabil lett (6 flash modell + 404-tolerancia), a szerver-oldal jó — de a sofőr főoldalán a bon-scan MÉG mindig hiába dob „Nem sikerült beolvasni a bont"-ot. A képernyőkép elárulta, hogy a kártya kizárólag a KLIENS-oldali fallback-szöveget (`t('sof.scanFailed')`) mutatja — szerver-oldali `err` mező nélkül. Ez a szöveg csak a `.catch()`-ből jön, ami azt jelenti: a fetch magától elhasal, még az /api/execute be se érkezik.

### Gyökérok
A `scanReceiptStart` (`public/sofer.js` PR #284) a fetch-et `keepalive:true`-val indítja, hogy az oldal-elhagyás után is befejeződjön. **A Fetch-specifikáció 64 KiB-re korlátozza a `keepalive:true` kérések body-jét** (a whatwg spec kifejezetten „throw a TypeError"-t ír elő body > 64 KiB esetén). Egy 1600px-re méretezett JPEG (q=0.85) base64-je azonban jellemzően 100–500 KB → a Chrome / mobil böngésző MÉG a küldés előtt eldobja TypeError-ral → a fetch `.catch()`-e fut → a kártya a fallback-szöveget mutatja. Ez a hiba PR #284 óta latens (kezdettől ott van), a felhasználó eddigi „működött korábban" észlelése valószínűleg apró tesztképekre vonatkozott, amelyek épp beléptek a 64 KiB alá.

### Mit csinál
1. **`public/sofer.js` `_scanReceiptTry`** — a `keepalive: true` KIVÉVE a scan-fetch-ből (körüljárva kommentelve, hogy miért nem tehető vissza). A confirm-fetch (`confirmReceiptExtraction`, ~200 bájt JSON) érintetlen — az beleférne a 64 KiB-be és néha kell is az oldal-elhagyáskor.
2. **`scanReceiptStart` fej-komment frissítve** a gyökérok magyarázatával (jövőbeli regresszió-védelem: aki visszatenné a `keepalive:true`-t, azonnal látja, miért nem szabad).
3. **`public/sofer.html` cache-bust** `?v=20260723retry` → `?v=20260723keepalive` → a mobil-cache-be beragadt régi JS mindenképp lecserélődik.

### Miért így
- A perzisztens localStorage-queue (`vs_sofer_receipt_queue`) + a `queueMaint` 3 perces takarítása fedezi az oldal-elhagyás esetét: ha a sofőr épp a fetch alatt lép ki, a következő nyitáskor a folyamatban lévő tétel error-ra vált (nem ragad be), és újra fotózható. A `keepalive` „akkor is befejeződik" garantálhatta volna ezt, de a 64 KiB-korlát miatt a fetch úgyse indul el — tehát az egész trade-off értelmetlen a mi image-body-nkra.
- **Szerver-oldalon (PR #288 óta) minden rendben van** — a szerver az /api/execute-ra érkező scanReceipt-et helyesen dolgozza fel; csak sose kapott kérést, mert a böngésző eldobta.

### Regresszió-védelem
- 237 Jest zöld (a fix kliens-oldali, teszt nélküli — a body-limit specifikációs viselkedés, nem szerver-logika).
- Cache-bust: a régi (kliens-oldalon cache-elt) `sofer.js` biztos lecserélődik minden mobilon.

## 2026-07-23 — FIX: bon-scan „nem működik" a sofőr főoldalon — retired/paid modellek kiszedve a láncból + 404-tolerancia

### Miért
A sofőr jelezte: az előző körös lánc-bővítés (PR #287, 6 → 11 modell) ÓTA a bon-scanner nem működik. Egy már működő platform HTML-doku (`geminidoc.html`) egy egyszerűbb 6-modellos ingyenes láncot mutat (a HTML explicit kimondja: „Fizetős modell — `gemini-pro`/`ultra`/`1.5-pro` — szándékosan nincs a listában"). Innen jött az össze-hasonlítás.

### Gyökérok
Az előző körben (PR #287) a láncba bekerült pro/exp/1.5-pro modellek jelentős része **retired vagy fizetős**:
- `gemini-1.5-flash` / `-flash-8b` / `-1.5-pro` / `-1.5-pro-002` — Google 2025-09-24-én deprecated-elte, sok esetben 404-et ad.
- `gemini-2.0-flash-exp` / `gemini-exp-1206` — kísérleti/preview, gyakran 404.
- `gemini-2.5-pro` — GA, de mikroszkopikus ingyenes keret (2 RPM / 50 RPD).

A régi `extractJson` viszont **csak 429/503-on** ugrott tovább a következő modellre. A 4 flash után az első visszavont modell 404-et dobott → azonnali `throw` → a lánc leállt, a maradék modellek sose futottak, a felhasználó „nem sikerült beolvasni"-t kapott.

### Mit csinál
1. **`lib/geminiJson.js` `DEFAULT_MODELS` 11 → 6 stabil ingyenes flash modell** (a HTML `FREE_CHAIN`-hez igazítva): `2.0-flash`, `2.0-flash-lite`, `2.5-flash`, `2.5-flash-lite`, `1.5-flash`, `1.5-flash-8b`. Pro / experimental / exp-1206 kikerült.
2. **`extractJson` fallback-lista bővítve 404 + 500-zal**: a 429/503 mellé (a callGemini már 3-szor retryzott 5xx-re — a persistent 500 „next model"; a 404 = „ez a modell erre a kulcsra / régióra nem elérhető", pl. később visszavont modell). A 400/401/403 továbbra is azonnal áll (a bemenet/auth a hibás, nem a modell).
3. **`tests/unit/geminiJson.test.js`** új eset: 404 az elsőn → továbblép a következő modellre (regresszió-védelem a jövőbeli lánc-változtatások ellen).

### Miért így
- A HTML-alapú lánc STABIL: csak azok a modellek, amelyeknek gyakorlatilag garantált ingyenes napi kerete van — 6 × ~1500 RPD keret bőven fedi egy közepes flotta bon-forgalmát (~9000/nap).
- A 404-tolerancia **defenzív**: ha a jövőben egy modell visszavonódik és nem vesszük észre, a lánc nem hasal el hangosan — csendben átugrik.

### Regresszió-védelem
- 237 Jest zöld (tests/unit).

## 2026-07-23 — Bővítés: Gemini modell-lánc 6 → 11 modell (pro + exp variánsok is) + részletes AI-hiba diagnosztika

### Miért
A sofőr jelezte: egy tiszta MOL bon fotózásra „Nem sikerült beolvasni" hibát kap még 3 retry után is. A gyökér-lehetőség: valamennyi (mind a 6) Gemini modell napi ingyenes kvótája elfogyott (a felhasználó testel + több sofőr fotózik). A megoldás: több modell a láncba → több független napi keret → ~10× több scan naponta.

### Mit csinál
1. **`lib/geminiJson.js` `DEFAULT_MODELS` bővítve 6 → 11 modellre** — a meglévő flash modellek mellett a Gemini pro-változatok és experimental variánsok is bekerülnek a láncba (mind KÜLÖN napi ingyenes kerettel):
   - Flash (magas napi keret, elsődleges): `2.0-flash`, `2.5-flash`, `2.0-flash-lite`, `2.5-flash-lite`, `1.5-flash`, `1.5-flash-8b`
   - Flash preview/exp: `2.0-flash-exp`
   - Pro (erősebb, kisebb napi keret, jó fallback nehezebb bonokhoz): `2.5-pro`, `1.5-pro-002`, `1.5-pro`
   - Végső fallback experimental: `exp-1206`
2. **Részletes AI-hiba diagnosztika**:
   - `lib/geminiJson.js`: minden modell-kudarc egy `attempts[]` tömbben gyűjtve; ha végül minden modell elhasal, a napló mutatja modellenként (`gemini-2.0-flash:429, gemini-2.5-flash:429, ...`). Sikeres modell után is naplózva, ha voltak előtte kudarcok.
   - Az utolsó modell státuszkódja belekerül a felhasználói hibaüzenetbe („supraîncărcate (429)"), és a modellek száma is („Toate cele 11 modele…"). A base64 sosem kerül a naplóba.
3. **`handlers/receiptScan.js`** AI-hiba naplózás bővítve (`status` + `msg` + `attempts` — a base64 nem).

### Miért így
- **A pro modellek később jönnek** a láncban, mert kisebb ingyenes kerettel rendelkeznek — a flash 1500 RPD helyett a pro csak ~50/nap. Így nem égetjük el a kis keretet feleslegesen; csak akkor jön a pro, ha az összes flash már kifogyott (vagy pl. Google-oldali szerver-túlterhelés miatt 503-at ad).
- **11 modell × külön keret** → egy napra ~15–20 000 scan is lehet ingyenesen, ami messze több, mint amennyi bon egy nap alatt születik egy közepes flottánál.
- **A napló + hibaüzenet** most már diagnosztizálható: ha ismét „nem sikerül", a fly-log megmutatja, melyik modell adta a nem-recoverable hibát (pl. 400 = rossz kép, 401 = kulcs-probléma, 403 = gate).

### Regresszió-védelem
- 701 Jest zöld. Az existing modell-lánc szemantika érintetlen (429/503 → next; 400/401/403 → azonnal áll).

---

## 2026-07-23 — Fix: bon-scan auto-retry átmeneti hibáknál (429/503/5xx/network) — nem esik le első hibára

### Miért
A sofőr azt jelezte: fotózás után a queue-tétel „Nem sikerült beolvasni a bont" hibára esett és nem próbálta újra. A régi kód az első hibára `error` státuszra váltott (nem különböztette meg az átmeneti / végleges hibákat), és nem próbálta újra.

### Mi történt
1. **Új `_scanReceiptTry(id, payload, attempt)` (`public/sofer.js`)** — a `scanReceiptStart` most csak elindítja az első próbát, a fetch-loop külön függvényben él. Rekurzív: sikertelenség esetén saját magát hívja +1 `attempt`-tel.
2. **Átmeneti hibák → retry, legfeljebb 3× (backoff 0s → 5s → 15s ≈ 20s max)**:
   - HTTP 429 (kvóta/rate-limit), 503 (Gemini túlterhelés), 5xx (belső hiba) — a szerver a `status`-t hozzácsatolja a válaszhoz.
   - Hálózati hiba (`.catch`) — mindig átmeneti.
3. **Végleges hibák → azonnali error, NINCS retry**: 400 (rossz kérés), 403 (tiltás), egyéb 4xx (pl. `Serviciul AI nu este configurat`, `Functie AI nedisponibila`, `Format nesuportat`). Ezeknél az újrapróbálás értelmetlen.
4. **UI visszajelzés**: a queue-tétel a retry alatt `processing` státuszban marad (nem villog error-t); a badge mutatja a próbálkozás-számot („⏳ Feldolgozás… (2/3)"); a cím „🔄 Újrapróbálkozás…" szöveget mutat. A payload (base64) végig a closure-ban él — nem kell újra fotózni.
5. **Cleanup küszöb bumpolva 60s → 3 perc** — hogy a legrosszabb esetben (3 retry × 30s Gemini timeout + 20s backoff ≈ 110s) se törjük meg egy még FUTÓ folyamatot a page-load védőháló.
6. **Új i18n**: `sof.rr.retrying` (RO+HU). Cache-bust `?v=20260723retry` (sofer.html/js/css + i18n.js).

### Miért így
- **Átmeneti vs. végleges elválasztása** azért fontos, hogy ne pörögjön értelmetlenül 3-szor egy 400-as hibán (a szerver ugyanazt válaszolja), viszont egy Gemini 503 vagy 4G-drop után rögtön ne feladja.
- **Rövid backoff** (5s + 15s), hogy a sofőr még mindig a képernyőn legyen, amikor a szám ready-re vált.
- **A payload memóriában marad** (nem tároljuk localStorage-ban) — biztonságos + nem foglal helyet. Cserébe: ha a sofőr a retry közben bezárja az app-ot, a payload elvész → a 3 perces cleanup magától „error"-ra állítja.

### Regresszió-védelem
- 701 Jest zöld (szerver-oldal érintetlen — csak kliens `sofer.js`).

---

## 2026-07-23 — ÚJ: külön `ai-bon-scan` feature-flag + admin/manager önkiszolgáló BE/KI kapcsoló a Menetlevelek fülön + betanult minták nézet/törlés + sofőr főoldalon a gomb csak ha be van kapcsolva

### Miért
Az admin kérte: (1) a bon-szkennelő NE az e-mail-parser `ai-kiolvasas` flag-jével legyen egybegyúrva — legyen KÜLÖN kapcsolható. (2) A cég Admin/Manager-je ne várjon a developerre, ha a saját cégére akarja engedélyezni/tiltani — ez a Menetlevelek fülön legyen a helyén. (3) Legyen látható, milyen mintákat tanult meg a rendszer (MOL/OMV/Kaufland…), és rosszul betanultat lehessen törölni. (4) A sofőr NE lásson gombot, ha úgyis csak hibaüzenetet kapna (a cég kikapcsolta / nincs API-kulcs).

### Mi történt

1. **Feature-flag split** (`public/feature-catalog.js`): a régi `ai-kiolvasas` most csak az e-mail-kiolvasásé (címke frissítve: „AI kiolvasás — e-mail 🤖"); az új **`ai-bon-scan`** („AI bon-szkennelés 📷") a bon-scannerre él. A `handlers/receiptScan.js` (`scanReceipt` + `confirmReceiptExtraction`) mostantól az új kulcsra gate-el. Új kulcs → nincs `company_features` / `plan_features` sor → `featureEnabled()` default `true` → visszafelé kompatibilis (minden meglévő cégnél magától be van kapcsolva; az admin kikapcsolhatja).

2. **Önkiszolgáló handlerek** (`handlers/receiptScan.js`):
   - **`getBonScanSettings`** (Admin/Manager, read-only): a jelenlegi flag-állapot (`featureEnabled` a teljes hierarchián) + a cég-override (`company_features.enabled` ha van) + a `receipt_scan_samples` teljes lista (minden merchantonként).
   - **`setBonScanEnabled`** (Admin/Manager, audit-naplózott): fehérlistás kulcsra (`SELF_ALLOWED_KEYS = ['ai-bon-scan']`) INSERT/UPDATE a `company_features` táblába. Nem `ai-bon-scan` kulcsot próbálni → felülírja `ai-bon-scan`-re (nincs cross-flag módosítás). A developer-oldal továbbra is minden kulcsot kezelhet — ez csak a saját cégre, csak erre az egy kulcsra.
   - **`deleteBonScanSample`** (Admin/Manager, audit): egy betanult mintát töröl a cégéből (`DELETE ... WHERE id=$1 AND company_id=$2`); ha nem SAJÁT sor → 0 érintett sor → hiba.
   - **`getMyBonScanEnabled`** (Sofer|Admin|Manager, read-only): egy bool + `hasKey` (van-e `GEMINI_API_KEY`) + `usable = (flag && hasKey)`. Nem szivárog cég-belső infó; a sofőr UI ez alapján rejt/mutat gombot.

3. **Admin/Manager UI — Menetlevelek fül** (`public/admin.html` + `public/manager.html`):
   - Új `#bonScanCard` a `pane[data-pane="received-fuv"]` legelső blokkjaként.
   - `console-shared.js` új közös függvények: **`loadBonScanCard`** (fetch + render), **`_renderBonScanCard`** (címke + kapcsoló + override-badge + minta-lista), **`_renderBonScanSamples`** (táblázat: merchant, stabil mezők, sample_count, updated_at, 🗑 gomb), **`setBonScanEnabled`** (kapcsoló change → RPC + toast + újratöltés), **`deleteBonScanSample`** (confirm + RPC + toast + újratöltés). A `loadTab('received-fuv')` mindkét felületen meghívja.

4. **Sofőr — a gomb csak ha usable** (`public/sofer.js`):
   - Új **`applyBonScanVisibility`** (`getMyBonScanEnabled`) → ha nem `usable`, a `.dash-scan-card` (főoldali narancs gomb + várólista-doboz) és a `#fuvarStep2 .scan-btn` gombok `display:none`. Ha a hívás sikertelen (régi szerver stb.) → biztonságosabb: MUTAT (a szerver úgyis eldönti).
   - Beindítás: sofőr boot után (a `loadDashOrders/loadSoferMiniStats/loadMyAssignedVehicle` mellett).

5. **i18n** — 15 új `bscan.*` kulcs (RO-alap + HU) a kapcsolóhoz, override-badge-hez, minta-táblázat fejléceihez, confirm/toast szövegekhez.

6. **Cache-bust** — `admin.html`/`manager.html`/`sofer.html`: `console-shared.js` + `i18n.js` + `sofer.js` `?v=20260723bscan`; `sofer.css` `?v=20260723bscanq`.

7. **Teszt** — **10 új eset** a `tests/unit/receiptScan.test.js`-ben (`getBonScanSettings` szerep-kapu + válasz-alak; `setBonScanEnabled` szerep-kapu + fehérlistás kulcs-védelem + UPSERT; `deleteBonScanSample` szerep-kapu + `WHERE company_id` + 0-rows-hiba; `getMyBonScanEnabled` bool + no-key eset; `SELF_ALLOWED_KEYS` invariáns). Teljes suite **701 zöld** (691 → 701).

### Miért így
- **Whitelist a self-service handleren**: az admin nem tud tetszőleges `feature_key`-t állítani a saját cégére (nem tudja felülírni pl. az `ai-kiolvasas`-t vagy `konyvelo-szerepkor`-t). Csak az explicit engedélyezett `ai-bon-scan`. Új user-controlled flag-hez explicit bővítés kell → nincs tolerancia hiba.
- **Fresh-branch a merged PR után**: PR #284 mergelve → új munka új commit-sor main-ről (CLAUDE.md 7. szabály); nem stackelünk merged PR fölé.
- **Sofer-UI fail-open**: ha a `getMyBonScanEnabled` bármi okból hibázik, MUTATJA a gombot (a szerver úgyis a végső döntés). Régi szerver + új kliens kombó nem fagyasztja el a felhasználót.
- **A tanulás megmarad**: a `receipt_scan_samples` tábla és a few-shot promptolás változatlan. Az admin csak a KAPCSOLÓT és a nézetet kapja meg.

---

## 2026-07-23 — ÚJ: bon-scanner TANULÁS (few-shot per merchant) + közös `lib/geminiJson` helper + nem-szivárgás megerősítés

### Miért
Az előző körben (lentebb) beépített bon-scanner mindig „üresen" hívta a Gemini-t. Ugyanakkor egy adott töltőállomás (MOL/OMV/Petrom/Kaufland stb.) bonja gyakorlatilag EGYFORMA a láncon belül — ha a rendszer emlékezne, hogy a MOL-nál hol vannak a mezők, a KÖVETKEZŐ MOL bon pontosabb lenne. Kérés: „tanulja meg adott bonon az adatok hol találhatók". Kérés #2: a modell-lánc + fetch logika legyen egy közös segédben (ne duplikálva a fuvar-inbound `reparse`-ban és a bon-scannerben). Kérés #3: „ha menti a képet, ne szivárogjon ki".

### Mi történt

1. **Közös `lib/geminiJson.js` helper** (ÚJ) — a Gemini modell-lánc (429/503 → következő modell külön napi kerettel), a 5xx-es retry (max 3 attempt), a hibaüzenetek + a fetch (kulcs headerben, timeout, JSON-parse) EGYETLEN forráson él. Egyszerű API: `extractJson({ systemPrompt, parts, models? })` → `{ json, model }`; dobás `e.status`-szal. Env: `GEMINI_MODELS` (vesszős lista) vagy `GEMINI_MODEL` (egy modell) felülírja a 6-elemű alapláncot.

2. **`services/order-ai/gemini.js` REFAKTOR** — a helyi `callGemini` + modell-lánc + retry kód TÖRÖLVE; az `extract()` most `lib/geminiJson`-t hív. A 429/503-nál a régi „Sistemul a comutat pe citirea integrată…" emberbaráti kiegészítés megőrizve → az `order-ai/index.js` fallback szemantikája változatlan (semmi nem törik).

3. **`handlers/receiptScan.js` REFAKTOR + TANULÁS** — a helyi callGemini/DEFAULT_MODELS TÖRÖLVE, a helyére `extractJson` hívás. **Új tanuló-réteg:**
   - **Migráció `db/receipt-scan-samples.sql`** (idempotens): `receipt_scan_samples (id, company_id, merchant_key, merchant_label, fields, sample_count, created_at, updated_at)` + `UNIQUE (company_id, merchant_key)` — cégenként/merchantonként EGY aktív minta (a legutóbb megerősített felülírja a régit → self-healing).
   - **`scanReceipt` few-shot**: minden hívás előtt lekéri a cég legutóbbi 5 EGYEDI merchant-mintáját (`DISTINCT ON (merchant_key) ORDER BY updated_at DESC LIMIT 5`), és a Gemini system-promptjához függeszti őket példaként. **CSAK STABIL mezőket** ad példaként (kind/loc/tip/plata/valuta/produs); a per-transaction mezőket (data/suma/litru/km) SZÁNDÉKOSAN kihagyja, hogy a Gemini ne másolja azokat az ÚJ bonhoz. Válaszban `learned_from: N` jelzi, hány mintát használt.
   - **Új `confirmReceiptExtraction` handler**: a sofőr Elfogadás gombjára hívva. Sanitize a mezőket, kinyeri a `merchant_key`-t (`normalizeMerchant`: `loc` első jelentős szava, legalább 3 hosszú + betűt tartalmaz → „MOL Arad" → „mol"; „OMV Petrom" → „omv"; „SC MOL SRL" → „mol"; „1300" → üres → nem tárol), majd `INSERT … ON CONFLICT (company_id, merchant_key) DO UPDATE SET fields = EXCLUDED.fields, sample_count = +1`. Kapuk: bejelentkezés + `Sofer|Admin|Manager` + `ai-kiolvasas` (konzisztens a `scanReceipt`-tel). Audit-naplózva (`receipt.confirm`). **DB-hiba (tábla hiányzik / permission) → csendes noop** — a UI menete független.
   - **Kliens (`public/sofer.js` `rrAccept`)**: a modal Elfogadás után best-effort `fetch(scanReceiptExtraction ...)` `keepalive:true`-vel; a sofőr átléphet más képernyőre, a tanulás a háttérben elmegy. Hiba esetén nem törik semmi (a menetlevél-piszkozatba már bekerült a sor).

4. **NEM-SZIVÁRGÁS védőháló + megerősítés**:
   - **Audit** (mind `scanReceipt`, mind `confirmReceiptExtraction`): CSAK metaadat (modell / kind / confidence / minta-szám / merchant-kulcs). A **base64 kép SOHA** nem kerül audit-logba / DB-be — csak a Gemini-hívás alatt él memóriában, utána V8 GC.
   - **Request-log** (`middleware/requestLog.js`): csak metódus/útvonal/státusz/ms/request-id — **NEM logol body-t** (verifikálva).
   - **Global error handler** (`server.js`): csak `err.message`/`err.stack`/`req.path` — nem logol body-t.
   - **Hibaválasz csonkolva 300 karakterre** (`scanReceipt` catch): egy esetleges „echo-back" Gemini-hiba sem szivárogtathat vissza többet a kliensre.
   - **localStorage queue** (kliens): csak 128px thumbnail — a teljes base64-et SOSEM tárolja (perzisztencia + méret-védelem).
   - **Új-táblás `fields` JSONB**: csak bon-mezők (loc, kind, tip, plata, valuta, produs, + per-transaction data/suma/litru/km) — sofőr-név, kártyaszám, sofőr-email SOHA nem kerül ide.

5. **Teszt** — **19 új eset**, teljes suite **691 Jest zöld** (43 skip valós DB):
   - `tests/unit/geminiJson.test.js` (ÚJ, 8 eset): siker, 429→next model, 400→azonnal áll, minden modell 429→végső hiba, nincs API-kulcs→NO_KEY, kulcs header-ben (nem query), DEFAULT_MODELS.
   - `tests/unit/receiptScan.test.js` (+11 új eset): `_normalizeMerchant` határesetek (MOL Arad/Timișoara/SC MOL SRL/tiszta szám/üres/null), few-shot bekerül a system-promptba, üres mintáknál változatlan alap-promt, stabil mezők vs per-transaction mezők szétválasztása (data/suma NEM megy példaként!), samples-lekérdezés hibája nem törik el a scan-t, confirm szerep-kapu, mezők nélküli confirm → noop, valós confirm → UPSERT normalizált merchant-key-vel, confirm DB-hiba → csendes noop, hibaüzenet 300 karakteren csonkolva.

### Miért így
- **Few-shot > fingerprint**: az image-alapú fingerprintelés (pHash) merchant-azonosítást igényelne még Gemini előtt (bonyolult, egy extra AI-hívás vagy heurisztika). A few-shot kisebb overhead (5 × ~150 token = ~750 token per hívás, gemini-flash-en filléres) és Gemini pattern-matching-jét használja: az IMAGE önmagában tartalmazza a layout-ot, a példák csak konzisztens értelmezést nudge-olnak.
- **DISTINCT ON merchant_key**: 5 különböző lánc mintáját adjuk példaként — Gemini így többféle layout-ot lát, és a fizikai bon-képhez a leginkább illeszkedőt „választja". Nem kell tudnunk előre, melyik merchant-tól jött a bon.
- **Per-transaction mezők KIHAGYVA a példákból**: a Gemini ne másolja a régi bon összegét/dátumát az újba! A régi bon példa csak a STRUKTÚRÁT tanítja, nem az értékeket.
- **Csendes DB-fallback**: ha a `receipt_scan_samples` migráció még nem futott le (első deploy), a scan tovább megy hint nélkül; ha a confirm DB-je hibázik, a sofőr UI-ja nem törik el.

### Regresszió-védelem
- **Teljes suite 691 Jest zöld** (require-sweep 125 modul 0 hiba). Az e-mail-inbound `reparse` (order-ai) útja változatlan viselkedésű — az integrációs tesztek verifikálják.
- A `sanitize` továbbra is fehérlistán szűr, most a confirm bemenetét is ellenőrzi (nem lehet a DB-be írni tetszőleges `plata`-t vagy nem-ISO dátumot).
- Cache-bust `?v=20260723learn` (sofer.html/js/css + i18n.js).

---

## 2026-07-22 — ÚJ: főoldali „📷 Bon szkennelés" gomb + háttér-feldolgozás + perzisztens elfogadás-várólista

### Miért
Az előző körben (lentebb) a bon-fotózás a menetlevél 2. lépésén belül működött csak — és blokkolt: amíg a Gemini válaszolt, a sofőr a spinnert nézte. Kérés: a **főoldalról egy gomb** fotózzon; a feldolgozás **háttérben** menjen, hogy a sofőr közben dolgozhasson; ha időközben kilép a képernyőről, később **rákattinthasson és elfogadhassa** a kiolvasott adatokat.

### Mi történt
1. **Főoldali kártya (`sec-dash`)** — új „📷 Bon szkennelés (AI) — háttérben feldolgozódik" narancs gomb (`sof.dashScanBtn`) a mini-statisztika alatt; koppintásra a natív kamerát/galériát nyitja. A gomb + a várólista egyetlen `dash-scan-card` kártyában él.

2. **Fire-and-forget fetch + perzisztens várólista** (`localStorage` `vs_sofer_receipt_queue`, max 20 tétel FIFO) — a `scanReceiptStart(file)` a kép kliens-oldali átméretezése (1600px hosszú oldal, JPEG q=0.85) után egy új `processing` státuszú tételt ír a várólistába (thumbnail + időbélyeg), majd elindítja a `fetch(/api/execute { keepalive:true })`-t → a válasz **nem várt** módon később futtatja a callbacket, ami a tételt `ready` (mezőkkel) vagy `error` státuszra írja át. A sofőr közben szabadon lép más képernyőre. A `keepalive:true` garantálja, hogy még a képernyő elhagyásakor is befejeződik a kérés. Toast: „Feltöltve — folytathatod, majd elfogadhatod".

3. **Elfogadás-modal (`#receiptReviewModal`)** — a főoldali várólistában minden `ready` tétel „Áttekintés" gombja megnyit egy modalt, amiben a sofőr **szerkesztheti** a kiolvasott mezőket (Gemini nem tévedhetetlen), és tetszés szerint fuel↔purchase **típust is válthat** (a közös mezők — helyszín/dátum/összeg/fizetés — átkerülnek a másik nézetbe). Elfogadáskor a mezők egy új `alim`/`ach` sorként a menetlevél-piszkozatba (`sessionStorage`) kerülnek; ha a menetlevél 2. lépés éppen nyitva van, a DOM sor is beszúródik azonnal (`addAlimRow`/`addAchRow` + `draftSave`). Ha még nincs piszkozat, egy alap-vázlat automatikusan létrejön → a következő menetlevél-nyitáskor a `draftRestore` visszaállítja.

4. **Elvetés** — „✕" gombbal (confirm-mel) a tétel törlődik a várólistából.

5. **Robusztusság** — oldal-betöltéskor minden 60 mp-nél régebbi `processing` tétel automatikusan `error` státuszra vált (`sof.rr.interrupted`: „A feldolgozás megszakadt — kérlek fotózz újra") — így nem ragad örökké függőben, ha a fetch egy szélsőséges esetben (app kill, hálózat) nem tudott befejeződni. A `visibilitychange` (tab-visszatérés) is újrarajzolja a várólistát, és a `goSec('dash')` is.

6. **A menetlevél 2. lépésén megmarad a fuel/purchase gomb-pár** (a gyors, közvetlen kiválasztásra), de mindkét út **ugyanabba a perzisztens várólistába** ír — a sofőr átléphet a főoldalra, és a lépés 2. gombbal indított feldolgozás is a főoldali kártyán jelenik meg.

7. **HALMOZOTT + MEGLÉVŐ ROKON — `fuvarStep2` restore** — a `rrAccept` (step2 zárva úton) a scannelt sort a sessionStorage-piszkozatba pusholja; a `fuvarStep2` a konténerek üresre-állítása után **visszaolvassa a piszkozatot** (`_dr.alimentari.forEach → addAlimRow`, `_dr.achizitii.forEach → addAchRow`). **Kezelt esetek:** (a) a sofőr kézzel bevisz 2 tankolást, majd a főoldalról scannel egy 3.-at → mindhárom megmarad; (b) 3 külön bont fényképez → 3 különálló queue-tétel, 3 külön elfogadás, 3 külön `addAlimRow`/`addAchRow` (append, nem cserél); (c) fresh menetlevélnél is: a fuvarStep2-t megnyitva a scannelt sorok megjelennek, nem vesznek el a következő `draftSave`-nél. Cache-bust `?v=20260722scanq2`.

8. **i18n** — 17 új `sof.dashScanBtn`/`sof.scanQueued`/`sof.rr.*` kulcs (RO-alap + HU).

### Regresszió-védelem
- **Szerver-oldal (`handlers/receiptScan.js`) ÉRINTETLEN** — az előző körös 12 Jest-teszt továbbra is zöld; teljes suite **672 zöld** (43 skip valós DB-teszt). Require-sweep 125 modul 0 hiba.
- A `sanitize` (backend fehérlista) minden mezőt védetten enged át → a szerkeszthető modalba is csak fehérlistás mezők (fuel: tip/litru/km/plata/suma; purchase: produs/plata/suma; közös: loc/data) kerülnek.
- **Nincs séma-változás**, nincs új szerver-modul, nincs új függőség.

---

## 2026-07-22 — ÚJ: sofőr menetlevél — bon (tankolás/vásárlás) fotózás → AI (Gemini) kiolvasás → új sor előtöltve

### Miért
A sofőrök gyakran útközben tankolnak vagy vásárolnak (mosás, gumi, olaj, autópálya-matrica stb.), és a menetlevélbe a bonrol kézzel kellett átvezetniük minden mezőt (helyszín, dátum, liter, összeg, fizetés-mód). Ez időt visz és hibalehetőség (elgépelt liter, rossz dátum). Kérés: fotózza le a bont, az AI olvassa ki, és a menetlevél Tankolások/Kiadások szekciójába egy előtöltött sor kerüljön — amit a sofőr átnéz és a többi mezővel együtt menti; a hiányzó mezők üresen maradnak.

### Mi történt
1. **Új backend handler `handlers/receiptScan.js` (`scanReceipt` RPC)** — a sofőr/admin/manager egy base64-esbe csomagolt bon-fotót vagy PDF-et küld; a handler bon-specifikus rendszer-prompttal hívja a Google Gemini-t (ugyanaz a modell-lánc mint a fuvar-inbound `reparse`-nál: `gemini-2.0-flash` → `-flash-lite` → `-2.5-flash` → `-2.5-flash-lite` → `-1.5-flash` → `-1.5-flash-8b`; 429/503 esetén automatikusan a következő modellre vált, mert minden modellnek külön napi ingyenes kerete van). A Gemini a bont a `kind: "fuel"|"purchase"` mezővel is besorolja (Motorină/AdBlue = fuel; minden más = purchase), és visszaadja a `loc`/`data (YYYY-MM-DD)`/`tip (Motorină|AdBlue)`/`litru`/`km`/`plata (Card|Cash|Flota Card|DKV)`/`suma`/`valuta`/`produs`/`confidence` mezőket. A handler **fehérlistán validál** minden érkező mezőt (`plata`/`tip` csak a menetlevél-űrlap opcióiból; `data` csak ISO YYYY-MM-DD; számokat számmá konvertál) — nem propagál "kreatív" Gemini-kulcsokat a kliensbe. Kapuk: bejelentkezés + `Sofer|Admin|Manager` szerep + `ai-kiolvasas` csomag-flag (a fuvar-inbound `reparse` gate-jével egyenlő) + `GEMINI_API_KEY` env. Base64-méret korlát 8 MB (mobil-fotó bőven belefér). Audit-naplózva (`receipt.scan`).

2. **Sofőr UI (`public/sofer.html` + `sofer.js`)** — a menetlevél 2. lépésén (⛽ Tankolások / 🛒 Kiadások) az „➕ Tankolás/Kiadás hozzáadása" gomb MELLÉ egy **narancs „📷 Bon szkennelés (AI)" gomb** került (kétnyelvű `data-i18n`). Koppintásra a rejtett `<input type="file" accept="image/*,application/pdf" capture="environment">` a natív kamerát/galériát nyitja. A kép **kliens-oldalon átméretezve** (max 1600px hosszú oldal, JPEG q=0.85, canvas) — a mobil-fotó (5–15 MB) is elfér a szerver 8 MB-os korlátjában, és a Gemini gyorsabban válaszol. Kiolvasás közben egy narancs „🔎 Bon feldolgozása AI-val…" sáv látszik. A válasz mezői a Gemini `kind`-jét követve **egy új `addAlimRow(f)` vagy `addAchRow(f)` sorba** töltődnek (a `sof.alim-*`/`ach-*` mezőkbe — pontosan úgy, mintha a sofőr kézzel írta volna be), majd `draftSave()` a piszkozatba menti — a sofőr átnézheti és javíthatja mielőtt beküldi a menetlevelet.

3. **i18n** — 6 új `sof.scan*` kulcs a `public/i18n.js`-ben (`scanReceiptFuel`/`scanReceiptPurchase`/`scanBusy`/`scanOk`/`scanFailed`/`scanReadErr`), RO-alap + HU.

4. **Regisztráció + cache-bust** — a `handlers/receiptScan` bekötve a `routes/execute.js` registry-be. Cache-bust: `sofer.html` `sofer.js?v=20260722scan` + `i18n.js?v=20260722scan`.

5. **Teszt (`tests/unit/receiptScan.test.js`, 12 eset)** — Gemini `fetch`-e mockolva: szerep-kapuk (sofer/admin/manager engedve, más tiltva; nincs bejelentkezés → tiltva), csomag-kapu (feature ki → tiltva), env-kapu (`GEMINI_API_KEY` nélkül → jelezve), fájl-validáció (rossz mimetype, üres, >8 MB), fuel + purchase kiolvasás fehérlistázva, `_sanitize` (ismeretlen `plata`/`tip`/nem-ISO `data`/nem-szám `confidence` mind kiszűrve), modell-lánc (mind 429 → érthető végső hiba; 400 → azonnal áll). **12/12 zöld → teljes suite 672 Jest zöld (43 skip valós DB-teszt).**

### Miért így
- **Nincs séma-változás** — a bon-fotó a menetlevél-piszkozatba egy új tankolás/vásárlás sorként érkezik; a szerver nem ment külön táblát a nyers képhez (a fotó a menetlevél-beküldéskor a meglévő `fuvarlevelek` folyamaton át kerülhet, ha kell — külön kör). Ez a leggyorsabb, legkevesebbet érintő megoldás.
- **A Gemini rendszer-promt bon-specifikus** — nem az `order-ai` (fuvar-megrendelés) prompt egy általánosítása, mert a bon-mezők (kind/litru/km/plata/tip/produs) mások, és a Gemini akkor a legpontosabb, ha egyértelmű, mit várunk. A modell-lánc + fetch pattern viszont a bevált (order-ai `gemini.js`) kód mintáját követi.
- **Csomag-kapu ugyanaz** (`ai-kiolvasas`) — az AI-kiolvasás egyetlen csomag-flag mögé rendezve; nincs új feature-flag, ami menedzselni kell.
- **A Gemini `kind`-je felülbírálja a gomb-választást** — ha a sofőr a „Vásárlás"-gombra koppintott, de az AI fuel-bonnak látja (vagy fordítva), a Gemini besorolását követjük. Így a rossz gombra koppintva sem raked el semmit.

### Regresszió-védelem
- **12 új Jest** (szerep/env/csomag-kapu + fájl-validáció + siker fuel/purchase + `_sanitize` + modell-lánc + azonnali-hiba). **Teljes suite 672 zöld** (require-sweep 125 zöld).
- A `sanitize` **fehérlistán** engedi át a mezőket → egy jövőbeli Gemini-modell-váltás sem szivárogtathat váratlan kulcsot a kliensbe.
- A kliens **kép-átméretezés** biztosítja, hogy a mobil-fotó ne blokkoljon a szerver 8 MB-os határánál (silent), és a Gemini inline-limitjéhez is bőven fér.

---

## 2026-07-22 — FIX: sofőr mobil-app „telefon-lock után nem működik, csak Kilépés+újralépés után" — visibility-alapú session-recovery + 8 órás idle-limit + főoldali auto-refresh

### Miért
Sofőrök jelezték: ha a telefon lockol/az app 30–60+ percig háttérben van, majd visszatérnek, az app „nem működik" — a kártyák üresek, kattintások nem történnek, csak akkor jön rendbe, ha manuálisan kijelentkeznek és újra belépnek. Két gyökér:
1. **Túl agresszív idle-timeout.** A közös `public/session-guard.js` 30 perc inaktivitás után kényszerkilépést dob (`doLogout('idle')`), de mobilon a `setInterval` háttérbe kerülve throttolódik (iOS/Chrome max. 1×/perc), és amikor a felhasználó visszatér, a döntés késve fut le — közben a képernyő-koppintás resetelheti a `lastActivity`-t → a kliens fut tovább „bejelentkezettként", miközben lehet, hogy a szerver-session már megszűnt. Sofőrre 30 perc egyébként is túl rövid (vezetés közben óráig nem koppint a kijelzőre).
2. **Nincs `visibilitychange` figyelő.** A tab feléledésekor sem az idle-döntés, sem egy „session még él?" ping nem futott le — a stale UI + esetleg halott szerver-session csak az első backend-hívásnál derül ki, de a `sofer.js` egyetlen fetch-je sem kezeli a 401-et (csak az induló `authMe` redirectel). Innen a „Kilépés → belépés = megoldás" tapasztalat.

### Mi változott
1. **`public/session-guard.js`** — új `visibilitychange` figyelő: amikor a tab újra láthatóvá válik (`document.visibilityState === 'visible'`), (a) azonnal ellenőrzi az idle-t → ha a limit fölött van, a szokásos `doLogout('idle')` fut (tiszta `/login?timeout=1` redirect); (b) különben egy csendes `authMe` pinget indít — ha a válasz `result: null` (a szerver-session megszűnt), azonnal `/login?timeout=1`-re irányít, hogy a sofőrnek NE kelljen manuálisan Kilépést nyomnia. `authPingInFlight` őr a duplikáció ellen. `IDLE_LIMIT_MS` mostantól konfigurálható: `window.VS_IDLE_LIMIT_MIN` (perc) felülírja az alap 30-at.
2. **`public/sofer.html`** — sofőr-app-specifikus felülírás: `<script>window.VS_IDLE_LIMIT_MIN = 480;</script>` a session-guard betöltése ELŐTT → 8 óra idle-limit (a szerver-cookie 7 nap; addig nem kényszerkilépés vezetés közben). A többi konzol (admin/manager/developer/utvonaltervezes/email-builder) marad az alap 30 percen — a mögöttük álló felhasználó folyamatosan a gépnél van, ott a szigorúbb kilépés indokolt.
3. **`public/sofer.js`** — új `visibilitychange` figyelő: a tab-visszatéréskor, ha a főoldal (`#sec-dash`) van előtérben, újratölti a kiosztott fuvarokat (`loadDashOrders`), a havi mini-statisztikát (`loadSoferMiniStats`) és a kiosztott jármű blokkot (`loadMyAssignedVehicle`) — így a friss adat azonnal látszik, nem a hátterezés előtti stale UI. 20 mp-es rate-limit (`_visRefreshLastAt`), hogy gyors tab-váltogatásnál ne köpködjön kéréseket. **A menetlevél-piszkozat / beírt űrlap NEM nulázódik**: csak `sec-dash`-en fut, más aloldalon nem.
4. **Cache-bust minden érintett HTML-en** — `session-guard.js` régi `?v=20260614qa` → `?v=20260722sess` mind a hat oldalon (`sofer.html`, `admin.html`, `manager.html`, `developer.html`, `email-builder.html`, `utvonaltervezes.html`), hogy a fejlesztést mindenki friss verzióval kapja. `sofer.html` `?v=20260721dashnum` → `?v=20260722sess`.
5. **Nem érintett**: a szerver-oldali `express-session` (7 napos cookie), a `handlers/auth.js` `authLogout`, a `middleware/pageGuard.js` — mindegyik változatlan. A javítás tisztán kliens-oldali. **702 Jest zöld** (a session-guard tisztán DOM-oldal, nem tesztelt egységként; a szerver oldali auth/session tesztek érintetlenek).

---

## 2026-07-22 — Sofőr főoldal mini-statisztika: diurna csempe kivéve (csak Admin/Manager látja); 3 csempe egymás mellett szorosan + ~15%-kal magasabb

### Miért
A sofőr havi mini-statisztikáján 4 csempe volt (LEZÁRT / KM / DIURNA / TANKOLVA). A diurna napok száma pénzügyi/elszámolási információ — a sofőr főoldalán feleslegesen látszott. A kérés: a diurnát csak Admin/Manager lássa, a menetlevélen (PDF-ben) továbbra is szerepeljen mint eddig — csak a sofőr saját PDF-nézetéből tűnjön el.

### Mi változott
1. **`public/sofer.js` `loadSoferMiniStats`** — a `tile('🗓️', ..., 'statDiurna', ...)` sor eltávolítva; a `sof-mstat-grid` mostantól 3 csempét renderel: LEZÁRT / KM / TANKOLVA. A `getMySoferStats` handler változatlan (a diurna adat továbbra is jön a válaszban, csak nem jelenítjük meg — a sofőr statisztika-jogosultsága nem változik, más felületet nem érint).
2. **`public/sofer.css` `.sof-mstat-grid`** — `grid-template-columns: repeat(2, 1fr)` → `repeat(3, 1fr)`, `gap: 8px` → `4px` (szoros egymás mellett). `.sof-mstat` `padding: 9px 6px` → `14px 5px` — ~15%-kal magasabb csempe, hogy a TANKOLVA prev-sorok (múlt hó, e havi átlagfogyasztás, opcionális warn) kényelmesen kiférjenek. A csempe többi tokene (border-radius, akcentek, tipográfia, `.sof-mstat-prev`/`.sof-mstat-warn`) érintetlen.
3. **`routes/soferApi.js` `/api/pdf-download/:id`** — a menetlevél HTML/PDF a `Diurnă externă:` + `Diurnă internă:` sort mostantól csak akkor rendereli, ha a néző NEM sofőr (`isSofer` már meg volt: `req.session.user.pozicio === 'Sofer'`). Admin/Manager (diszpécser) a saját cége bármely menetlevelén továbbra is látja — a menetlevél többi mezője (útvonal-pontok, tankolások, kiadások, fogyasztás, mentések) minden szerepnek változatlan.
4. **A diurna kalkuláció változatlan** (`routes/soferApi.js` `/api/fuvarlevel-save` a `calculateDiurna(indulasDt, erkezesDt, hataratok)`-ból tölti a `diurna_externa`/`diurna_interna` oszlopokat). A sofőr menetlevél-űrlapján az „Út időpontjai" + „Határátlépések" szekció + `#diurnaPreview` (a rövid „🕐 Út: dep → arr · N nap · X határátlépés" trip-összegző) érintetlen — ezek a kalkuláció bemeneti mezői, nem diurna-értéket mutatnak.
5. **Regresszió-védelem** — a `tests/integration/fuvarlevelek-db.test.js` `GET /api/pdf-download/:id` tesztjei Admin-ként futnak → a `'zile'` felirat továbbra is megjelenik a PDF-ben (nincs teszt-módosítás). A `sofer-mini-stats.test.js` a handler adat-alakját teszteli, nem a UI csempéket, ezért érintetlen. Cache-bust: `sofer.html` `?v=20260721dashnum` → `?v=20260722diurna` (mind CSS, mind JS).

---

## 2026-07-22 — FIX: sofőr átlagfogyasztás (`avg_curr`/`avg_prev`) PER-TÉTEL DÁTUM szerint — konzisztens a UI-n megjelenő TANKOLVA-val

### Gyökér

A **2026-07-21-i per-tétel dátum** bevezetése után (menetlevél tankolás/vásárlás sorai
külön naptáras `data` mezőt kaptak, és a `getFuelStats`/`getPurchaseStats` per-tétel
dátum szerint bucketolt), a sofőr főoldali **TANKOLVA csempéjén** megjelenő e havi
átlagfogyasztás (`avg_curr`) inkonzisztens értéket adott a mellette megjelenő
**TANKOLVA liter-értékkel** (`tl_curr`):

- **`tl_curr` (kijelzés — HELYES):** per-tétel dátum szerint bucketolva — a
  júliusi menetlevélbe utólag beírt június-dátumú tétel a **júniusi kosárba** kerül.
- **`avg_curr` képlet — HIBÁS volt:** a `calcAvg` `tanked`-e a menetlevél TELJES
  `alimentari`-tömbjét összegezte (`fls.reduce(SUM(litru))`), **függetlenül** a
  tételek per-tétel dátumától → a júliusi menetlevélbe utólag beírt júniusi
  tankolás is bekerült a júliusi képletbe → **hamisan magas L/100km**.

**Peto konkrét esete** (7215 km, TANKOLVA: 2018 L, kijelzett avg: **36.6 L/100km**):
- Egyszerű arány: 2018/72.15 = 27.97 L/100km
- Kijelzett: 36.6 → a képlet ~2640 L-lel számolt (~620 L eltérés)
- Ez pontosan az inkonzisztencia jele: a `tl_curr` a július-dátumú tételekre szűrt
  (2018 L), a képlet viszont a menetlevél összes tételét beszámolta (~2640 L,
  beleértve a júniusi dátumú vagy más hónapba tartozó tételeket).

### Fix (`handlers/statisticsHandlers.js`)

Mindkét érintett handler `calcAvg` képlete új opcionális `tanked` paramétert kapott
— ha megadva, azt használja tanked-nek (ez a per-tétel dátum szerint bucketolt
liter-érték, ugyanaz mint a UI-n megjelenő TANKOLVA), különben fallback = a régi
menetlevél-alimentari SUM (backward-compat, régi hívók).

1. **`getMySoferStats` `calcAvg`** — új opcionális `tanked` paraméter. A két
   hívási hely (`avg_prev`/`avg_curr`) most explicit átadja a fő-ciklusban már
   helyesen kiszámolt `tl_prev`/`tl_curr` értéket → a képlet és a UI ugyanazt a
   liter-értéket használja.
2. **`getSoferConsumptionOverview` `calcAvg`** — ugyanaz a paraméter-bővítés,
   plusz új helyi `_bucketWaybillLiters(fl)` / `sumBucketLiters(fls)` segéd, ami
   sofőrönként bucketolja a menetlevelek `alimentari` tömbjeit per-tétel dátum
   szerint (a `getMySoferStats` fő-ciklusával azonos szemantika: nem-átívelő
   waybill → dátumozott tétel a saját hónapjához, dátum nélküli → érkezés-hónap;
   átívelő → dátumozott tétel a saját hónapjához, dátum nélküli → napok szerinti
   arányos fallback). A `calcAvg` mindkét hívása most a bucketolt `curr`/`prev`
   értéket kapja `tanked`-ként.

### Nem érintett

- A `tl_curr`/`tl_prev` mezők értéke változatlan — csak az `avg_curr`/`avg_prev`
  képletbe kerülnek most helyesen bekötve.
- A `getFuelStats` (jármű-oldali fogyasztás) képlete változatlan — az menetlevél-
  alapú `motorina_folosit / total_km` aggregátumot mutat, ami önmagában
  konzisztens (`f.eff_date` szerint).
- A `motorina_folosit` mentése (menetlevél `cant_inc + total_alim - cant_sf`)
  változatlan — az adattárolás alsóbb szintjén NEM avatkozunk be.

### Teszt

- **`tests/integration/sofer-mini-stats.test.js`** — új eset (18. teszt):
  „PETO-ESET: júl. menetlevél jún.-dátumú tétellel — avg_curr per-tétel dátum
  szerint, NEM a teljes alimentari-SUM". 7215 km + 2 tankolás (500 L jún.
  28-i + 2018 L júl. 10-i dátummal). A régi buggy képlet ~34.90 L/100km-t
  adott (2518 L tanked), az új helyes érték ~27.97 L/100km (2018 L tanked).
- **`tests/integration/sofer-consumption-overview.test.js`** — új eset (9.
  teszt): ugyanaz a Peto-eset admin cross-sofőr panelben. Egységes viselkedés.
- **703 Jest zöld** (700 → 703, 43 skip valós-DB nélkül).



### Cél

Négy új, adott adatokból származó statisztika a rendszerben (a felhasználó
kérésére) + a Sofőrök / Járművek / Ügyfelek statisztika-táblák bővítése
**kereső mezővel** és **2 sor összehasonlítási** UI-val.

### Új szerver-handlerek (`handlers/statisticsHandlers.js`)

Mind `_isAdminOrManager` kapu + `company_id`-szűrt + paraméteres SQL,
automatikusan bekötve a `routes/execute.js` registry-en át.

- **`getVehicleIdleStats`** — Jármű állásidő (üres napok fuvarok közt):
  ablak-függvénnyel (LAG) az előző Finalizat `finalized_at` → következő
  aktív fuvar `data_incarcare` pozitív különbségeinek átlaga, össze és
  max járművenként. Az időszak-szűrő a következő fuvar `created_at`-jére.
  Járművek fülre.
- **`getServiceForecast`** — Szerviz-előrejelzés (esedékesség hetekben):
  az utolsó `vehicle_service_log.next_due_km` + jármű utolsó 90 napos
  menetlevél-km átlaga + GPS hó-vég snapshot `mileage`-ből. Sürgős (≤2
  hét), figyelmeztető (≤6 hét), normál — kliens színez. Járművek fülre.
- **`getOrderFunnel`** — Fuvar-státusz funnel (kiírt → felrakóhoz →
  felrakva → lerakóhoz → leürít) + minden lépés közti átlagos idő
  percben/órában, a 4 új milestone-időbélyeg (`sosit_incarcare_at` /
  `incarcat_at` / `sosit_descarcare_at` / `descarcat_at`) alapján. SLA
  fülre.
- **`getCarrierApAging`** — Alvállalkozói AP-öregítés (0-30/31-60/60+
  nap) a `carrier_invoices`-ból, effektív esedékesség `due_date` →
  `issue_date+30` → `created_at+30` fallback lánccal. Pénzügyi jog-védett
  (`_canSeeFinance`); legrégebbi kintlévő szállítói számlák listája
  (max 200). Pénzügy fülre.

### Kliens — közös kereső + összehasonlítás segédek

`public/stats.js` — új moduláris helper (`_stCmpState` map + 5 függvény):

- **`stCompareToolbarHtml(pane, placeholder)`** — a tábla fejlécében
  kereső input + kijelölés-info + „🆚 Összehasonlítás" gomb.
- **`stCompareCellHtml(pane, key)`** — soronkénti checkbox-cella (első
  oszlop, `data-cmp-pane` + `data-cmp-key`).
- **`stCompareInit(pane, cfg)`** — a load() után hívva; a kereső
  eseményt felteszi (`data-cmp-label` alapú kliens-szűrés a
  `tr[data-cmp-key]` sorokra) + a delegált checkbox-kezelést a
  `box._stCmpBound` flag-gel EGYSZER regisztrálja, max 2 sort enged,
  a 3.-at visszaveszi (toast).
- **`openCompare(pane)`** — overlay-modal, metrikánként párhuzamosan
  mutatja a két entitást (érték + Δ, jobbik zöldre színezve;
  `higherIsBetter:false`-val a fogyasztás/RON-költség „kevesebb a jobb";
  `noWinner:true` szöveges cellához).
- Bekötés: **Sofőrök** (`loadDrivers` — 9 metrika: fuvarok/lezárt/
  bevétel/km/L100km/üzemanyag/vásárlás/diurna/menetlevél), **Járművek**
  (`loadVehiclesStats` — 9 metrika: fuvarok/lezárt/bevétel/EUR-km/
  km/üzemanyag/szerviz/L100km/névleges), **Ügyfelek** (`loadClients` —
  4-6 metrika finance-jogtól függően).

### Új panelek a meglévő pane-eken

- **Járművek pane**: „💤 Állásidő" + „🔧 Szerviz-előrejelzés" — a Top
  chart alatt, alul a meglévő GPS-km panelekhez sorolva.
- **Pénzügy pane**: „🧾 Alvállalkozói AP-öregítés" — a fuvar-profit
  panel alá.
- **SLA pane**: „🔻 Fuvar-státusz funnel + átlagos idők" — a KPI-sáv
  alá. Progressbar-vizu (bal→jobb csökkenő) + %-os konverzió az előző
  lépéshez + `fmtDuration` perc/óra/nap az átlagos idő-mezőknél.

### i18n

~30 új kulcs RO-alap + HU:
- `st.ve.pIdle`/`gapCount`/`avgIdleDays`/`totalIdleDays`/`maxIdleDays`/`idleHint`
- `st.ve.pService`/`currentKm`/`nextDueKm`/`nextDueDate`/`monthlyKm`/`dueIn`/`dueNow`/`weeks`/`serviceHint`
- `st.fin.pCarrierAp`/`noCarrierAp`/`cInvoice`/`cAmount`/`cIssue`/`daysShort`/`carrierApHint`
- `st.sla.pFunnel`/`stKiirt`/`stFelrakohoz`/`stFelrakva`/`stLerakohoz`/`stLeurit`/`avgLbl`/`totalTime`
- `st.cmp.*` — közös: `search`/`searchDriver`/`searchVehicle`/`searchClient`/`btn`/`selected`/`max2`/`title`/`metric`

Cache-bust: `stats.js?v=20260722cmp`.

### Tesztek

Új: `tests/integration/stats-new-handlers.test.js` — 10 mock-eset:
- Szerep-kapu (Sofer NEM hívhatja mind a 4 handlert).
- `getVehicleIdleStats` visszaadja a jarmuvek listát + company_id
  kényszerítve.
- `getServiceForecast` sürgős/figyelmeztető helyesen jelölve; rendezés
  sürgős-elöl.
- `getOrderFunnel` funnel + lepesek válasz-alak; null-átlag is átmegy.
- `getCarrierApAging`: Manager pénzügyi jog nélkül → `forbidden:true`;
  Admin: aging + lista visszaadva.

**700 Jest zöld** (690 → 700; valós Postgres 16-tal + mock).

### Deploy

Fly.io szerver-restart (nincs migráció) + böngésző hard refresh a
cache-bust érvényesítéséhez.

---

## 2026-07-21 — Sofőr főoldal: elvégzett + parkolt/raktári fuvar CSAK a menetlevélbe kerül + fuvar-kártyák sorszámmal (#1..N) + összecsukott fejléc = szám + felrakás dátuma + felrakási hely

### Gyökér

Két összefüggő UX-igény:
1. A `Finalizat` (elvégzett) fuvar eddig a sofőr **főoldalán** is látszott a
   teljesítés utáni türelmi ideig (0 menetlevélig „örökké", 1× után 3 nap,
   2× után 15 perc). Ugyanígy a `Parkolt`/`Raktarban` (áru-leadás) fuvar is
   ott maradt a főoldalon, ha az `email_sofer` még a sofőrre mutatott. A
   sofőr főoldalon már lezárt/leadott fuvarokkal találkozott — a **kész +
   leadott fuvar helye a menetlevél**, nem a főoldal.
2. Az összecsukott fuvar-kártya csak a `felrakó → lerakó` címeket mutatta,
   sorszám nem volt → a sofőr nem látta, hányadik fuvarát kell csinálnia.

### Változtatás

**`handlers/orders.js` `getMySoferOrders`** — a `dash_visible` szigorodott:
mostantól CSAK a **valóban élő** aktív fuvar (`Alocat`, `In Curs`) látszik
a főoldalon; a `Finalizat` + `Parkolt` + `Raktarban` mind `dash_visible=false`
(függetlenül a menetlevél-számtól és a `finalized_at` időtől). A
`waybill_visible` (menetlevél-picker) logikája **változatlan** — a
lezárt/leadott fuvar ott a mentett menetlevélig / 3 napig / 15 percig
továbbra is kiválasztható (a Parkolt/Raktarban továbbra is `true`
horgonnyal).

**`public/sofer.js` `loadDashOrders`** — a szűrt aktív listát megfordítjuk
(szerver `created_at DESC` → kliens ASC, legrégebbi fuvar = #1), és a
`renderFuvarCard(o, idx)` 1-alapú `idx`-et kap. Így új kiosztás nem üti át
a meglévő fuvarok sorszámát: a régiek maradnak (#1, #2), az újak a végére
kerülnek (#3, #4, #5). Amikor egy fuvar lezárul (Finalizat / Parkolt /
Raktarban), kiesik a listából — a következő kiosztás így újra 1-től számoz
(nem `#5,#6,#7`, hanem `#3,#4,#5` példa: 4 aktívból 2 lezárul → maradék
2 = #1,#2 → új 3 kiosztás = #3,#4,#5). A kliens-oldali defenzív fallback
(dash_visible mező hiányában) is szigorodott: csak `Alocat`/`In Curs`.

**`public/sofer.js` `renderFuvarCard`** — az összecsukott fejléc új
felépítése: `#N` badge + `📅 felrakás dátuma` + `📍 felrakási hely` + `▾`.
A lerakó és minden további részlet (ügyfél, cégek, dátumok, állomás-idővonal,
UIT/leadás gombok) marad a kinyíló részben (kattintásra → változatlan). A
felrakás dátumát a meglévő `fmtFuvarDay(data_incarcare)` formázza.

**`public/sofer.js` `loadDocOrderOptions`** — a Feltöltött iratok fuvar-
választója átvált `dash_visible`-ről `waybill_visible`-re, hogy a
nemrég lezárt fuvarhoz utólag POD/CMR fotót is csatolni lehessen
(különben a szigorúbb főoldal-szűrő ezt is elrejtette volna).

**`public/sofer.css`** — új `.fuvar-num` szám-badge (kék `--sof-primary`
kör, fehér 12px félkövér); a `.fuvar-destination` `flex`-re vált (szám +
szöveg + nyíl egy sorban); `.fuvar-headtxt` `flex: 1 1 auto` a hosszú
felrakási cím elipszisezéséhez.

### Teszt

`tests/integration/db-orders.test.js` — a régi „Finalizat menetlevél
nélkül SOSEM tűnik el" eset a `dash_visible`-re már nem érvényes; helyette
elkülönített `dash_visible` (csak aktív) + `waybill_visible` (menetlevél-
horgony) elvárás-blokk (`CMD-A/P/R/FN/FO/FW`). **647 Jest zöld**
(41 suite / 43 skip DB nélkül). Cache-bust `sofer.css/js?v=20260721dashnum`.

### Fájlok

`handlers/orders.js` (dash_visible egyszerűsítés + komment),
`public/sofer.js` (loadDashOrders reverse + idx, renderFuvarCard(o,idx)
új fejléc, docs picker → waybill_visible),
`public/sofer.css` (`.fuvar-num` badge + `.fuvar-destination` flex),
`public/sofer.html` (cache-bust),
`tests/integration/db-orders.test.js` (elvárás-frissítés),
`CHANGELOG.md` + `CLAUDE.md`.

---

---

## 2026-07-21 — Menetlevél: tankolás/vásárlás per-tétel DÁTUM (naptár-választó, mai alapérték) → statisztika is per-tétel dátum szerint

### Gyökér

A menetlevél tankolás (`alimentari`) és vásárlás (`achizitii`) sorai eddig
egyetlen szabadszöveges „Locație & Dată" mezőt kaptak, dátum-mező nem
tartozott a tételhez. Emiatt egy átívelő menetlevélben (pl. jún. 28 → júl. 3)
a júniusi tankolás a júliusi statisztikába csúszott (a hónap-szűrés a
menetlevél `eff_date`-je alapján történt), és a sofőr havi mini-statisztikája
a tankolt litert **napok szerint arányosan** bontotta a két hónap közt.

### Változtatás

**Sofőr menetlevél űrlap** (`public/sofer.html`+`sofer.js`): a régi „Locație
& Dată" szövegmező **szétvált**: `Locație` (szabadszöveg) + **`Data`**
(natív `type="date"` naptár-picker). Alapérték a **mai (helyi) dátum**, óra
NINCS. A `draftSave` / `soferCollectFull` / `submitFuvarlevel` gyűjtő
tömbök a `data` mezőt is beszúrják (backward-compatible: hiányzó `data`
= üres string). A `sof.alimLocPh` placeholder „pl. Győr"-ra egyszerűsödött
(a dátum kikerült).

**Admin/Manager menetlevél-szerkesztő** (`public/console-shared.js`
`feRowAlim`/`feRowAch`): új `type="date"` oszlop, közös `_feTodayLocalDate`
alap, meglévő értéket visszaállít; `saveFuvEdit` beolvassa a `data` mezőt
(`.fe-a-data`/`.fe-c-data`).

**PDF export** (`routes/soferApi.js` `/api/pdf-download/:id`): Alimentări +
Achiziții táblák új „Data" oszloppal (`Loc | Data | …`); `_fmtItemDate`
YYYY-MM-DD-re vágja a tárolt értéket.

**Statisztika per-tétel dátum szerint** (`handlers/statisticsHandlers.js`):
- `getFuelStats`, `getPurchaseStats`: közös
  `ITEM_DATE = COALESCE(NULLIF(elem->>'data','')::date, f.eff_date::date)`
  kifejezéssel szűr/csoportosít — a hónap-bontás mostantól a tétel saját
  dátuma szerint. Régi (dátum nélküli) tétel fallback: menetlevél `eff_date`.
- `getMySoferStats`: a tankolt liter tétel-alapon sorolódik a jelen/előző
  havi kosárba. Nem-átívelő menetlevélben is: ha egy tétel dátuma más
  hónapba esik (pl. utólag rögzített), a helyes hónap kosarába kerül.
  Dátum nélküli tétel = napi arány / eff-hónap fallback. Diurna + km
  változatlanul (nincs per-tétel dátum ezekhez).

Adatbázis-változás nincs (a JSONB már eleve tetszőleges kulcsokat őriz).

### Teszt

`tests/integration/sofer-mini-stats.test.js` — 3 új eset a per-tétel
dátum-viselkedésre (átívelő tétel-alapú 400 jún./300 júl., dátum nélküli
tétel napi arány fallback, utólag beírt más-hónapos tétel). **647 Jest
zöld** (644 → 647).

### Deploy

Fly.io szerver-restart (nincs migráció) + böngésző hard refresh (cache-bust
`?v=20260721itemdate` a `sofer.js`/`console-shared.js`-hez).

---

## 2026-07-18 — Ideiglenes WhatsApp-alapú chat: sofőr → cég WhatsApp, manager → sofőr WhatsApp

A belső Firebase-alapú chat átmenetileg **WhatsApp-átirányításra** vált. A cél,
hogy a sofőrök egy kattintással a manager/admin által beállított cég
WhatsApp-számára jussanak (natív app vagy WhatsApp Web nyílik), a manager/admin
oldalon pedig a chat fül a sofőrjeit listázza, kattintásra pedig az adott
sofőr saját `users.tel` számára nyitja a WhatsApp-ot. A régi Firebase-chat
kód érintetlen — csak nincs meghívva, így könnyen visszaállítható.

- **Migráció** `db/company-whatsapp-chat.sql` (idempotens): `companies.whatsapp_number VARCHAR(30)` — a manager/admin által beállított WhatsApp-szám. NEM módosítjuk a meglévő `companies.telefon` mezőt (az a cég kapcsolattartó telefonja, más lehet, mint a sofőrökkel operatív számra).
- **`handlers/whatsappChat.js`** (ÚJ, regisztrálva a `routes/execute.js`-ben) 3 RPC:
  - `getCompanyWhatsapp` — Admin/Manager/Sofer, olvasás; `company_id`-szűrt; normalizált (csak számjegyek) számot ad vissza vagy `null`-t.
  - `saveCompanyWhatsapp` — Admin/Manager, írás; E.164 normalizálás (7–15 számjegy), üres → törlés (NULL), audit (`company.whatsapp_save`).
  - `listDriversForWhatsapp` — Admin/Manager, csak SAJÁT cég belső sofőrjei (`pozicio='Sofer' AND COALESCE(blocked,false)=false`); a válasz `tel_normalized` mezője a WhatsApp-nyitóhoz.
  - Belső segéd `_normalizePhone` **nem-enumerable exportként** — a `routes/execute.js` `Object.assign` registry-je NEM veszi föl, `/api/execute`-en át NEM hívható (regressziós teszttel is fedve).
- **Sofőr oldal** (`public/sofer.html` + `sofer.js`): a chat nav-kártya `onclick`-je `openWhatsAppFromChatCard()` — a szerverről kéri a cég számát és a `wa.me/<szám>`-ra ugrik (mobilon natív app, weben WhatsApp Web). Ha nincs beállítva: barátságos jelzés + a `sec-chat` pane belül is látszik a hint. A régi `initFirebaseChat` HÍVÁS eltávolítva (a függvény érintetlen).
- **Admin/Manager oldal** (`public/console-shared.js` + `admin.js`/`manager.js`): a `chatPane` div-be dinamikusan injektálódik két kártya — (1) „Cég WhatsApp száma" kártya (mentés/törlés Admin/Managernek), (2) sofőr-lista (avatar + név + telefon; kattintva `wa.me/<sofer_tel>` új tabon). Az `initFirebaseChatPanel` HÍVÁS mindkét szerep-JS-ben eltávolítva (a függvény érintetlen); a `loadTab('chat')` hívja az új közös `loadWhatsappChatPane()`-t.
- **i18n** (`public/i18n.js`, RO-alap + HU): új `sof.wa*` kulcsok (átirányítás-cím/hint/gomb/hibaüzenetek) + `wa.*` kulcsok (kártya-címek, telefonmező-címke, „nincs sofőr"/„nincs telefon" jelzések).
- **Teszt** `tests/integration/whatsapp-chat.test.js` (16 új eset): `_normalizePhone` határesetek (7/15 jegy, +/szóköz/kötőjel eltűnik, túl rövid/hosszú → null); szerep-kapu (Sofer NEM írhat/nem listázhat, bejelentkezés nélkül 401); `company_id` szűrés a SELECT/UPDATE-ben; érvénytelen tárolt szám → `null` a válaszban; üres bejövő szám → törlés (NULL írás); registry-védelem (`_normalizePhone` nem hívható `/api/execute`-en át — „Functie necunoscuta"). **644 Jest zöld** (628 → 644).
- **Cache-bust:** `admin.html`/`manager.html` `?v=20260718wa`, `sofer.html` `?v=20260718wa`.

---

## 2026-07-18 — Fuvarkezelés: Törölt fuvarok almenü + mező-autocomplete + auto-szakasz eltávolítva

Három admin/manager UX-javítás egy körben a fuvar-modulhoz.

1. **🗑️ Törölt fuvarok almenü.** A `comDelete`-tel törölt (`Anulat`) fuvarok
   mostantól **eltűnnek a fő fuvarlistából** (a `handlers/orders.js` `comList`
   `WHERE o.company_id = $1 AND o.status <> 'Anulat'`), és egy külön
   „**🗑️ Törölt fuvarok**" almenüben jelennek meg (Fuvarok csoport, admin +
   manager). A pane a `getCancelledOrders` handlerből (cégre szűrt, csak
   Anulat, Admin/Manager) tölti az adatot; minden sor „↩️ Visszaállítás"
   gombbal jár, ami a `restoreOrder(id)`-vel `Anulat → Disponibil` állapotra
   hozza (audit, granulált jog: Manager csak `orders_delete` engedéllyel).
   `feature-catalog.js` új kulcs: `orders-deleted` (developer ki/be
   kapcsolhatja). i18n: `nav.ordersDeleted`, `del.*` (RO-alap + HU).

2. **📝 Mező-autocomplete a fuvar-kiíráson és a szerkesztőben.** Minden
   szöveges mezőnél (Ügyfél, Referencia, Felrakási/Lerakási cég, Külső sofőr
   neve/cége/telefonja + szerkesztőben Rakodás/Lerakás helye) gépeléskor a
   cég eddigi (nem Anulat) fuvarjaiba **ugyanabba a mezőbe** már beírt egyedi
   értékek jelennek meg legördülőben — a mintát a menetlevél-szerkesztő
   `getFuvarlevelFieldSuggestions`-ból örököltük. Új handler
   `getOrderFieldSuggestions` (Admin/Manager, cégre szűrt, mezőnként max 300
   érték); kliens: `data-sg` attribútum a mezőkön + globális, delegált
   `data-sg` handler `public/console-shared.js`-ben, ami a body-hoz fűzött
   DD-t (`_feSgDD`) újrahasznosítja (fuvar-modálon belül a menetlevél
   szuggeszcióit adja, kívül a fuvar-adatokat). `ocSgLoad()` előmelegítés
   `loadOrders`/`loadOrderFormData`-ból, így az első fókusz azonnal kínál.

3. **➖ Auto-szakasz eltávolítva.** A `handlers/orders.js` `comCreate`,
   `bulkCreateOrders` és a `routes/inbound-orders.js` `/approve` út **NEM**
   hoz létre automatikusan kezdő `order_legs` sort — a fuvar egyetlen INSERT-
   tel jön létre; szakasz csak explicit „➕ Szakasz" gombra (`addOrderLeg`)
   keletkezik. A `syncOrderTopFromActiveLeg` viselkedése nem változott:
   0 szakasz esetén a top-szintű `orders.*` marad az igazságforrás; szakasz-
   felvételkor a top a legutolsó szakaszra állítódik (visszafelé kompatibilis).

**Tesztek:** `tests/integration/db-orders.test.js` frissítve az új
semantikára (nincs auto-leg; a deleteOrderLeg-teszt 2 explicit `addOrderLeg`-
gel indul, a top-visszaesés így verifikálható). **627 Jest zöld**.

---

## 2026-07-18 — Statisztika Sofőrök: km-oszlopok is a fogyasztás-összehasonlításban (E havi km, Múlt hó GPS/leadott)

A sofőr főoldali mini-csempéin megjelenő „teljes hó: X / leadott: Y" km-értékek és
az „e havi + múlt havi átlagfogyasztás" mostantól a manager/admin
**Statisztika → Sofőrök → ⛽ Fogyasztás összehasonlítás** panel táblájában is
láthatók — sofőrönként, egyben áttekinthetően.

1. **`handlers/statisticsHandlers.js` `getSoferConsumptionOverview`** kiegészítve:
   sofőrönként új mezők a válaszban — `km_curr` (jelen havi menetlevél-alap
   total_km összeg érkezés-hó horgony szerint), `km_prev` (múlt havi menetlevél-
   alap, ugyanaz), `km_prev_gps` (múlt havi GPS-alap „teljes hónap": a sofőrhöz
   kiosztott járművek prev / prev-prev hó-vég snapshotjainak deltájának összege
   — `gps_month_end_snapshots`). A menetlevél-query a `total_km` mezővel bővítve;
   a GPS-delta a már betöltött `snapMap`/`snapMapPP` + `platesByEmail` map-ekből
   számol → nincs új query. `company_id`-szűrés, `_isAdminOrManager` kapu, sofőr
   NEM éri el.
2. **`public/stats.js` `loadDrivers`** — a fogyasztás-összehasonlítás tábla 3
   új oszloppal bővül az avg oszlopok elé: **E havi km**, **Múlt hó — teljes
   (GPS)**, **Múlt hó — leadott**. Ha a GPS-alap > 5%-kal nagyobb, mint a
   leadott (menetlevél-alap), a „teljes (GPS)" cella narancsszín + `+X%` badge
   → jelzi, hogy hiányzó menetlevél lehet. A meglévő sofőr-teljesítmény tábla
   (`getDriverStats`, időszak-szűrős) érintetlen.
3. **`public/i18n.js`** — 6 új kulcs (RO-alap + HU-váltó): `st.dr.cKmCurr`,
   `st.dr.cKmCurrTip`, `st.dr.cKmPrevGps`, `st.dr.cKmPrevGpsTip`,
   `st.dr.cKmPrevWb`, `st.dr.cKmPrevWbTip` (a tooltip elmagyarázza a forrást).
4. **Teszt** `tests/integration/sofer-consumption-overview.test.js` — 3 új eset:
   (a) `km_curr`/`km_prev` menetlevél total_km összegzés érkezés-hó horgony
   szerint; (b) `km_prev_gps` kiosztott járművek delta-összege rendszám-
   normalizálással (pl. „B 111" ↔ „B111"); (c) `km_prev_gps = 0`, ha csak az
   egyik snapshot van meg. **627 Jest zöld** (624 → 627).

---

## 2026-07-18 — Sofőr-fogyasztás cross-comparison a Statisztika oldalon (manager/admin only)

A Statisztika → Sofőrök oldalra új szekció került: **⛽ Fogyasztás összehasonlítás
(L/100km)** — minden belső sofőr e havi + előző havi átlagfogyasztása egy
táblázatban, cég-átlaggal és eltérés-oszloppal. A > **2.5 L/100km** cég-átlagtól
való eltérésű sofőrök **narancs háttérrel + ⚠️** kiemelve, rendezés eltérés-
csökkenő sorrendben. **Sofőr NEM éri el** ezt az adatot (csak Admin/Manager).

1. **`handlers/statisticsHandlers.js` `getSoferConsumptionOverview`** (ÚJ,
   `_isAdminOrManager` kapu) — a cég belső Sofer-userjeire aggregátumos
   avg_curr + avg_prev + avg_diff számítás ugyanazzal a képlettel, mint a
   `getMySoferStats` ((`start_tank + tankolt − end_tank) × 100 / km`).
   GPS-elsőbbség (snapshotok) → menetlevél-fallback. Válasz: `sofers[]` +
   `company_avg` + `threshold: 2.5`. Sofőrönként `deviation_from_avg` +
   `deviates` (bool). Rendezés: kiemeltek elöl.
2. **Kliens (`public/stats.js` `loadDrivers`)** — a meglévő sofőr-teljesítmény-
   tábla ALÁ új panel: „⛽ Fogyasztás összehasonlítás (L/100km)". Fejlécben
   a cég-átlag + eltérés-küszöb, táblában sofőrönként: e havi átlag / múlt
   havi átlag / hó-közti eltérés / cég-átlagtól való eltérés (⚠️ ha
   deviates). Deviates sorok narancs háttérrel + félkövér narancs eltérés-
   érték. Best-effort: hiba esetén szimplán nem jelenik meg (a régi
   tábla látszik).
3. **i18n** új kulcsok (RO+HU): `st.dr.pFuelCompare`, `st.dr.pFuelCompareAvg`,
   `st.dr.pFuelCompareThr`, `st.dr.cAvgCurr`, `st.dr.cAvgPrev`, `st.dr.cAvgDiff`,
   `st.dr.cDevFromAvg`. Cache-bust `stats.js` `?v=20260718fuelx`.
4. **Teszt (`tests/integration/sofer-consumption-overview.test.js`)** —
   szerep-kapu (Sofer tiltva, Admin/Manager átmegy), üres sofőrlista,
   két sofőr eltérő avg-gel (cég-átlag + deviates flag helyes), nagy
   eltérés (mindkettő deviates, rendezés). **624 Jest zöld** (619 → 624).

## 2026-07-18 — Sofőr TANKOLVA csempe: átlagfogyasztás L/100km + anomália-figyelmeztetés

A sofőr TANKOLVA csempéjén két új sor jelenik meg: **e havi eddigi átlag** (a
legutolsó menetlevél km/tankolásig) és **múlt hó átlag** (a teljes előző hó).
Ha az érték kívül esik a 20–38 L/100km sávon, VAGY a két hó közti eltérés
> 4.5 L/100km, a csempe alján figyelmeztetés jelenik meg. A manager külön push
+ notification-t kap, ha az eltérés > 2.5 L/100km.

**Képlet** (mindkét ág): `(start_tank + tankolt − end_tank) × 100 / megtett_km`

1. **`handlers/statisticsHandlers.js` `getMySoferStats`** — új
   `avg_curr`/`avg_prev`/`avg_diff` mezők a válaszban, plusz `warn_range` (érték
   <20 vagy >38), `warn_diff` (|Δ| > 4.5, sofőr), `manager_warn_diff` (|Δ| > 2.5,
   manager). Új: menetlevél query kiegészítve `cant_inceput`/`cant_sfarsit`
   mezőkkel; snapshot query kiegészítve `fuel_level`-lel; snapMap/snapMapPP
   most `{mileage, fuel_level}` objektumot tárol.
2. **Adatforrás-szabály:**
   - **GPS-elsőbbség**: prev-prev-hó-vég snapshot (start_tank/km) + prev-hó-vég
     snapshot (end_tank/km, ill. jelen hónál a legutolsó menetlevél end);
     tankolt SUM az alimentari-ból.
   - **Menetlevél-fallback**: az adott havi menetlevelek közül az elsőnek
     `cant_inceput`/`km_inceput` a start; az utolsónak `cant_sfarsit`/`km_sfarsit`
     az end; tankolt = alimentari SUM.
   - Több kiosztott jármű esetén az aggregátum snapshot érték (SUM per jármű).
3. **Manager push + notification** (best-effort, dedup 1× per sofőr/hónap):
   `notifications` tábla `type='fuel_deviation'` + push az Admin/Manager felé.
   A dedup a `body`-ban egy egyedi kulcsot keres (sofőr email + hónap).
4. **Kliens (`sofer.js` `loadSoferMiniStats`)** — a TANKOLVA csempe új három
   sort jelenít meg: „e havi átlag: X L/100km", „múlt hó átlag: Y L/100km",
   opcionális warn-sor „⚠️ Elmaradt menetlevél beadása" (range warn) vagy
   „⚠️ Nézze át a menetlevelet, tankolást" (diff warn). Új CSS
   `.sof-mstat-warn` (narancs, félkövér). i18n `sof.avgCurr` / `sof.avgPrev`
   / `sof.warnRange` / `sof.warnDiff` (RO+HU). Cache-bust
   `sofer.js`/`sofer.css`/`i18n.js` `?v=20260718fuel`.
5. **Teszt** — 4 új eset: normál sáv (nincs warn), Peto-eset (nincs waybill →
   avg = null, nincs warn), nagy diff (>4.5, sofőr+manager warn), közepes diff
   (>2.5 de ≤4.5, csak manager warn). **619 Jest zöld** (615 → 619).

## 2026-07-18 — Sofőr mini-statisztika: „teljes hó" (GPS) + „leadott" (menetlevél) külön a KM csempén

A múlt havi KM csempén mostantól KÉT sor jelenik meg:
- **„teljes hó: X"** — GPS-alapú (két egymást követő hó-vég snapshot deltája)
- **„leadott: Y"** — menetlevél-alapú (SUM(total_km) waybillekből)

Így a sofőr lát ha hiányos a menetlevél-leadása (Peto-eset: valós 11 188 km, de 0
menetlevél → csempe: „teljes hó: 11 188 / leadott: 0"). Motivációs cél: hívja
fel a figyelmet a hiányzó bevitelre.

1. **`handlers/statisticsHandlers.js` `getMySoferStats`** — új mező a válaszban:
   `km_prev_gps` (GPS-alap = „teljes hónap"). A régi `km_prev` (menetlevél-alap =
   „leadott") **változatlan**. A számítás: a sofőr KIOSZTOTT járműveire
   (`vehicles.assigned_driver_email = saját email`) → a prev-month-end és
   prev-prev-month-end snapshot deltáinak összege. Ha a prev-prev snapshot
   hiányzik, `km_prev_gps = 0`.
2. **Kliens (`public/sofer.js` `loadSoferMiniStats.tile()`)** — a KM csempe
   most KÉT prev-sort tud megjeleníteni: ha van GPS-teljes (`km_prev_gps > 0`),
   akkor „teljes hó: X" + „leadott: Y" két sorban; ha nincs (GPS off vagy nincs
   snapshot), a régi egy soros „múlt hó: X" marad. A többi csempe (LEZÁRT
   FUVAR, DIURNA, TANKOLVA) egyforrású → egy „múlt hó" sor.
3. **i18n** — két új kulcs: `sof.mstatFull` (HU „teljes hó" / RO „lună completă")
   + `sof.mstatSubmitted` (HU „leadott" / RO „livrat"). Cache-bust
   `sofer.js`/`sofer.css`/`i18n.js` `?v=20260718gps`.
4. **Snapshot lookup bővítés** — a snapshot query mostantól KÉT hónap-vég
   snapshotát kéri le egyszerre (prev-month + prev-prev-month) egy SELECT-tel.
   A prev-month-end tovább szolgál az átívelő menetlevelek splittelésénél is.
5. **Teszt** — 4 új eset a dual-mező viselkedésre (Peto-eset, mindkettő
   párhuzamosan, több jármű, hiányzó prev-prev). Régi MAX-alapú teszt
   frissítve az új szétválasztott mezőkre. **615 Jest zöld** (611 → 615).

## 2026-07-18 — Sofőr mini-statisztika: hónap-határon átívelő menetlevél SZÉTBONTÁSA

A sofőr főoldali mini-statisztikában (getMySoferStats) a **hónap-határon átívelő
menetlevél** (pl. jún. 28 → júl. 3) mostantól automatikusan szétosztódik a két
hónap közt — a sofőr EGY menetlevelet tölt ki, a rendszer háttérben szétvágja
a statisztikai bevitelt (km + diurna + tankolt liter).

Példa a júl. előző körben bevezetett GPS snapshot alapján: **jún. 28 → júl. 3
menetlevél** (km_inceput 99 800, km_sfarsit 100 500) + **jún. 30. 23:59 GPS
snapshot 100 000** → jún. 200 km + júl. 500 km; napok szerinti 3-3 arány →
diurna + tankolt liter fele-fele.

1. **`handlers/statisticsHandlers.js` `getMySoferStats`** — a régi FILTER-es
   SQL-t felváltotta egy nyers menetlevél-lekérdezés + JS-alapú aggregáció.
   Új lekérdezések: (a) menetlevelek nyers mezők (id, plate, indulas_dt,
   erkezes_dt, km_inceput, km_sfarsit, total_km, diurna_*, alimentari), (b)
   hónap-határok SQL-ből (`m_curr`, `m_prev`), (c) az előző hó GPS-snapshotjai
   a cégre.
2. **Szétbontási szabály (JS-oldal):**
   - **Nem-átívelő** menetlevél (`indulas_dt` és `erkezes_dt` ugyanabban a
     hónapban): teljes érték az érkezés-hónaphoz. Változatlan viselkedés.
   - **Átívelő + van snapshot** a járműre az előző hó végén:
     - **KM**: prev = max(0, snapshot − km_inceput); curr = max(0, km_sfarsit
       − snapshot). Pontos, GPS-alapú.
     - **DIURNA + TANKOLT LITER**: napok szerinti arányosítás (a menetlevél
       naptári napjai közt, hónap-váltás nap egészben a saját hónapjához).
       A diurna intrinsic per-napi, a fuel-t sajnos nem tudjuk per-tétel
       dátumhoz kötni (az `alimentari` nem tárol dátumot), ezért ez a
       legjobb becslés.
   - **Átívelő + nincs snapshot** (GPS ki, vagy még nem futott le): KM is
     napok szerinti arányos (fallback).
3. **Menetlevél-számláló** (`menetlevelek`) — továbbra is érkezés-hónap
   alapján (a menetlevél mint EGYSÉG az érkezés-hónapba tartozik; a szám
   nem bomlik).
4. **Teszt (`tests/integration/sofer-mini-stats.test.js`)** — teljesen
   átírva a 4-lekérdezéses chainre: szerep-kapu, üres, nem-átívelő
   (jún.+júl. tisztán), átívelő + snapshot (jún. 28 → júl. 3), átívelő
   snapshot nélkül (napok arányos fallback), vegyes eset (átívelő + tiszta
   júliusi együtt). **611 Jest zöld** (609 → 611).

## 2026-07-18 — Hó-végi GPS km + üzemanyag-szint snapshot → következő menetlevél pre-fillje

A CargoTrack GPS-ből a hónap **utolsó napjának 23:59-hez legközelebbi** olvasása
(km-óra + üzemanyag-szint) automatikusan rögzül minden párosított járműre; ez a
következő hónap első menetlevelénél a **kezdő km + kezdő üzemanyag** pre-fill
alapja lesz. A hónap-határon átívelő menetlevél (pl. jún. 28 → júl. 3) NEM
csorbul: a júl. 3-i menetlevél záró értéke újabb mint a jún. 30-i snapshot, ezért
azt a legutolsó menetlevelet a snapshot nem írja felül.

1. **Migráció `db/gps-month-end-snapshot.sql`** (idempotens, auto-fut) —
   új `gps_month_end_snapshots` tábla: `(company_id, rendszam, year, month,
   mileage, fuel_level, snapped_at)`, `UNIQUE (company_id, rendszam, year, month)`
   + index. A `fuel_level` a CargoTrack `calculated_inputs.fuel_level` nyers
   értéke (eszköz-függő: liter vagy %, ha az eszköz méri; a sofőr felülírhatja).
2. **Ütemező `services/scheduler.js` `startMonthEndSnapshotScheduler`** —
   20 perces ciklus. Europe/Bucharest zóna alapján ellenőrzi, hogy ma van-e a
   hónap utolsó napja ÉS az óra ≥ 23. Ha igen, minden CargoTrack-cégnél minden
   párosított járműre `getLatestStatus` → mileage + fuel_level upsert
   (`ON CONFLICT UPDATE`, a hó-végi 23:00-23:59 ablakban 3 tick fut →
   ~23:40 vagy 23:59-hez legközelebbi olvasás marad). Bind `server.js`-ben.
   A CargoTrack service hiánya esetén no-op (`try/catch require`).
3. **Handler `handlers/orders.js` `getLastVehicleReadings`** — a meglévő
   utolsó-menetlevél sub-select kiegészülve az `erkezes_dt` (fallback
   `indulas_dt`) mezővel. Új: a `gps_month_end_snapshots` legfrissebb sora a
   járműre. Ha `snapshot.snapped_at > last_arrival`, akkor a snapshot
   `mileage` + `fuel_level` felülírja a pre-fillt. Best-effort try/catch a
   snapshot-táblára → migráció nélkül a régi viselkedés érvényben marad
   (visszafelé kompatibilis). Cross-tenant izoláció változatlan (cégre + plate-re
   szűrt lekérdezés).
4. **Teszt `tests/integration/gps-month-end-snapshot.test.js`** (mock-db,
   9 eset): nincs snapshot / snapshot újabb (jún. 30 → júl. 5 nyer) / snapshot
   régebbi (jún. 28 → júl. 3 átívelő nyer) / snapshot nélkül üres menetlevél /
   csak mileage a snapshotban (fuel a menetlevélből) / tábla-hiba fallback /
   auth-hiba / üres rendszám / cégre + normalizált rendszámra szűrt lekérdezés.
   **609 Jest zöld** (600 → 609, +9).

## 2026-07-17 — CI: Render-deploy kivéve, éles CSAK Fly.io

A Rendert többé NEM használjuk / NEM deployoljuk — az éles oldal a **Fly.io**-n fut
(`vallorsoft.fly.dev`, `FLY-DEPLOY.md`).

1. **`.github/workflows/ci.yml`** — a `deploy` job (Render deploy-hook `curl`) TÖRÖLVE.
   Marad: `test` (Jest, Node 22 + Postgres 16) + `deploy-fly`
   (`superfly/flyctl-actions`, `FLY_API_TOKEN` secret). A workflow-fejléc kommentje is
   frissítve. A `RENDER_DEPLOY_HOOK_URL` GitHub secret elhagyható.
2. **`CLAUDE.md` ELSŐ SZABÁLY** — új 7. pont: „Éles deploy = CSAK Fly.io. A Rendert
   NEM használjuk / NEM deployoljuk. Ne állítsd vissza a Render-lépést, ne javasold
   Renderre költözést. Fly deploy elakadásnál azt javítsd — NE tegyél oda
   Render-fallbacket." A múltbeli történelmi Render-bejegyzések (2026-06-14 kör,
   ANAF-log, APP_URL-fix hivatkozások) érintetlenek — csak az élő deploy útvonala
   változott.

## 2026-07-17 — Sofőr havi mini-statisztika: előző havi érték minden csempén (viszonyítás)

A sofőr főoldali 4 mini-csempéjén (LEZÁRT FUVAR / KM / DIURNA / TANKOLVA) mostantól az
**aktuális havi érték MELLETT az előző havi is** megjelenik — kicsiben, halványan („múlt
hó: X" / RO: „lună trecută: X"), a csempe méretét és a rácsot érintetlenül hagyva.
Motivációs viszonyítási pont: 0 esetén is kiírja.

1. **Szerver (`handlers/statisticsHandlers.js` `getMySoferStats`)** — ugyanabban az egy
   SELECT-ben számoljuk a jelen és az előző havi értékeket `FILTER (WHERE …)`
   segédzáradékokkal. Új mezők a válaszban: `lezart_prev`, `km_prev`, `diurna_ext_prev`,
   `diurna_int_prev`, `tankolt_l_prev`. A jelen havi és előző havi szűrők a **beírt
   út-dátum** (menetlevél: `COALESCE(erkezes_dt, indulas_dt, data_completare)` — eff_date)
   ill. a **lezárás** (fuvar: `COALESCE(finalized_at, data_descarcare, created_at)`)
   szerint mennek — ugyanaz a robusztus horgony, mint a jelen havi mutatóknál. Az előző
   havi ablak: `>= DATE_TRUNC('month', NOW() - INTERVAL '1 month')` ÉS
   `< DATE_TRUNC('month', NOW())`. A tenant-védelem változatlan: `company_id` +
   `LOWER(email_sofer) = LOWER(saját email)`.
2. **Kliens (`public/sofer.js` `loadSoferMiniStats` / `tile()`)** — a csempe HTML-je
   kiegészült egy másodlagos `<div class="sof-mstat-prev">` sorral, ami a `*_prev`
   értéket jeleníti meg. Új CSS (`sofer.css` `.sof-mstat-prev`): 11px, `#94a3b8`, halvány
   — a csempe padding/rács változatlan. i18n új kulcs `sof.lastMonthShort` (HU „múlt hó" /
   RO „lună trecută"). Cache-bust `sofer.js`/`sofer.css`/`i18n.js` `?v=20260717prev`.
3. **Teszt (`tests/integration/sofer-mini-stats.test.js`)** — mock-db harness 4 esettel:
   szerep-kapu (nem-sofőr elutasítva), a válasz tartalmazza az összes új `*_prev` mezőt,
   a jelen + előző havi horgony megjelenik a menetlevél-SQL-ben (`km_prev`,
   `tankolt_l_prev`, `NOW() - INTERVAL '1 month'` regex), és 0 érték is kiírásra kerül
   (motivációs hatás). **600 Jest zöld** (a korábbi 596 + 4 új).

## 2026-07-17 — Régi/törölt sofőr adatainak VÉGLEGES törlése + sofőr mini-statisztika forrás-megerősítés

1. **Szellem-sofőr törlése (Belső sofőrök fül)** — a „🔀 Régi sofőr menetleveleinek
   átrendezése" kártyán minden szellem-sofőr sorában új **🗑️ Törlés** gomb (megerősítő
   ablakkal). Új `purgeDriverData(email)` handler (`handlers/documents.js`, Admin/Manager,
   audit): **véglegesen** törli az adott email menetleveleit + feltöltött dokumentumait
   (→ eltűnik a statisztikából), bontja a jármű-hozzárendelést, és ha maradt hozzá
   Sofer-felhasználó a cégben, azt is törli. Csak a SAJÁT cég adatait érinti
   (`company_id`-horgony/cég-user); önmagát (admint) nem törölheti. A kártya akkor is
   megjelenik, ha nincs átrendezési cél-sofőr (a törlés így is elérhető). i18n `cs.gd.delete*`.
2. **Sofőr havi mini-statisztika forrás-megerősítés** (`getMySoferStats`) — a **LEZÁRT
   FUVAR** a tényleges lezárt (`Finalizat`) fuvarokból számol (robusztus hónap-szűrő:
   `COALESCE(finalized_at, data_descarcare, created_at)` — hiányzó `finalized_at` sem rejt
   el fuvart); a **KM / DIURNA / TANKOLVA** a sofőrre kiosztott VAGY általa készített
   menetlevelekből (`email_sofer` = sofőr, beírt út-dátum szerinti hónap). *(Ha a mutatók
   0-t mutatnak, az adat jellemzően egy másik/törölt e-mail alatt van — a szellem-sofőr
   kártyán átrendezhető a helyes sofőrre.)*

Cache-bust `console-shared.js`/`i18n.js` `?v=20260717purge`. **596 Jest zöld** + mock-db teszt.

## 2026-07-16 — UX: bezárható fuvarkérés-értesítő + sofőr telefonos vissza-gomb + kézi sofőrnév védelme

Három kliens-oldali UX-javítás (nincs szerver-/séma-változás):

1. **Bezárható „beérkező fuvarkérés" értesítő** — a lebegő `#inboundAlert` sáv (admin/
   manager) most **✕ gombot** kapott (`console-shared.js`): bezárva elrejtődik, és csak
   akkor jön vissza, ha **újabb** kérés érkezik (a feldolgozatlan szám a bezáráskori fölé
   nő — `window._inboundDismissedCount`). CSS `.ia-x` (`_inboundEnsureStyle`).
2. **Sofőr telefonos „vissza" gomb — appon belüli visszalépés, nincs kijelentkezés**
   (`sofer.js`): a rendszer-vissza gombot elkapjuk (History API csapda) — (a) menetlevél
   2. lépésén → vissza az 1. lépésre; (b) nyitott modal → bezárás; (c) al-oldalon → vissza
   a főoldalra; (d) a főoldalon **dupla** visszával lép ki (a session megmarad). Egyetlen
   vissza-nyomás többé nem jelentkeztet ki. i18n `sof.backExitHint` (RO+HU).
3. **Kézi sofőrnév védelme a menetlevél-szerkesztőben** (`console-shared.js` `feDriverPicked`):
   a sofőr-választóból történő választás a nevet **CSAK akkor tölti ki, ha a mező üres** — a
   kézzel beírt/módosított nevet **soha nem írja felül**. A választó a statisztika-horgonyt
   (`email_sofer`) állítja, a megjelenített név kézzel szabadon marad.

Cache-bust `console-shared.js`/`i18n.js`/`sofer.js` `?v=20260716uxfix`. **596 Jest zöld**
+ DOM-shim harness (kézi név megmarad / üres név kitöltődik / banner-dismiss logika).

## 2026-07-16 — Régi/törölt sofőr menetleveleinek tömeges átrendezése aktuális sofőrre (statisztika-szellem megszüntetése)

A törölt sofőr helyreállított (company_id-horgonyzott) menetlevelei a statisztikában
külön soron („szellemként") jelentek meg a régi e-mailje alatt — és az új sofőr nem
kapta meg ezeket, csak egyenkénti szerkesztő-átkötéssel. Most egy kattintással
tömegesen átrendezhetők.

- **`handlers/documents.js`** — `getWaybillDrivers` (Admin/Manager): a cég
  menetleveleiben előforduló sofőr-emailek + név + darabszám + `is_current` (aktuális
  cég-felhasználó-e). A `reassignDriverWaybills(fromEmail, toEmail)` (Admin/Manager):
  a régi/szellem sofőr ÖSSZES menetlevelét (és POD-dokumentumát) átköti egy **aktuális
  cég-sofőrre** (validált cél; `email_sofer`+`nume_sofer` frissítés) → a statisztika
  ekkor az új sofőrhöz sorolja, a szellem eltűnik. Csak a cég adatait érinti
  (`company_id`-horgony/cég-user), audit-naplózva.
- **Belső sofőrök fül** — új „🔀 Régi sofőr menetleveleinek átrendezése" kártya
  (`#ghostDriverBox`, `loadGhostDrivers`/`reassignGhostDriver`): a szellem-sofőrök
  listája darabszámmal + aktuális-sofőr választó + „→ Átrendez". Az e-mailt
  gyorsítótárból olvassuk (nem az onclick-be ágyazva — nincs injekció).
- i18n `cs.gd.*` (RO-alap + HU), cache-bust `console-shared.js`/`i18n.js`
  `?v=20260716ghost`. **596 Jest zöld** + mock-db handler-teszt.

## 2026-07-16 — MINDEN menetlevél-szűrés/rendezés/statisztika a beírt út-dátum szerint (nem a kitöltés dátuma)

A menetlevél korábban sok helyen a **kitöltés/létrehozás** dátuma (`data_completare`)
szerint szűrődött/rendeződött/összesítődött. Kérésre mostantól MINDENHOL a
sofőr/manager/admin által beírt **tényleges út-dátum** számít: az érkezési
(`erkezes_dt`), fallback indulási (`indulas_dt`), végső fallback a kitöltés
(`data_completare`, csak a dátum nélküli régi soroknál).

- **Statisztika** (`handlers/statisticsHandlers.js`) — a közös `FUV_FROM` blokk új
  `eff_date` = `COALESCE(erkezes_dt, indulas_dt, data_completare)` oszlopot ad; MINDEN
  menetlevél-alapú szűrés/havi-bontás (`WHERE`/`TO_CHAR`/`ORDER BY`) erre vált
  (Áttekintés bevétel/km/diurna/fogyasztás idősor, Üzemanyag, Vásárlások, Sofőrök,
  Járművek). A `getMySoferStats` (sofőr havi mini-stat) is a beírt út-dátum szerint
  számol. A megjelenített dátum-oszlopok is az út-dátumot mutatják (`AS data_completare`).
- **Fuvarlevelek lista** (`handlers/documents.js`) — rendezés
  `COALESCE(erkezes_dt, indulas_dt, data_completare) DESC`.
- **Sofőr-elszámolás (decont), szerviz-esedékesség km, üzemanyag/vásárlás riport**
  (`handlers/fleetCompliance.js`) — a dátum-szűrők az út-dátumra váltva.
- **Globális kereső** (`handlers/globalSearch.js`) + **developer árva-menetlevél lista**
  (`handlers/developer.js`) — rendezés az út-dátum szerint.
- **Havi e-mail riport** (`services/scheduler.js`) — a menetlevél-aggregáció az
  út-dátum szerint.
- Szerver-only; a `finalized_at`/`created_at` alapú **fuvar (orders)** metrikák
  változatlanok (azok nem a menetlevél kitöltés-dátuma). **596 Jest zöld** + valós
  Postgres 16 verifikáció (a júniusban ÉRKEZETT, de júliusban KITÖLTÖTT menetlevél a
  júniusi hónaphoz számít).

## 2026-07-16 — Menetlevél sorbavétel a beírt indulási/érkezési dátum szerint (km/üzemanyag-átvitel)

A következő menetlevél kezdő km/üzemanyag értékét (a `getLastVehicleReadings`
átvitel) eddig a **kitöltés/létrehozás** dátuma (`data_completare`) szerinti
„legutóbbi" menetlevélből vettük. A helyes sorrend a sofőr/manager/admin által a
menetlevélbe **beírt út-dátumok** szerinti — így a valóban legkésőbb ÉRKEZETT út
záró értéke lesz a következő menetlevél kezdő értéke.

- **`getLastVehicleReadings` (`handlers/orders.js`)** — a „legutóbbi" menetlevél
  sorbavétele mostantól `ORDER BY COALESCE(erkezes_dt, indulas_dt) DESC NULLS LAST`
  (érkezési, fallback indulási dátum), NEM `data_completare` szerint. A beírt
  dátummal nem rendelkező sor csak akkor jöhet szóba, ha nincs dátumozott
  (`NULLS LAST`). A `cant_sfarsit>0` / `km_sfarsit>0` szűrő + a cégre-szűrés
  változatlan.
- Szerver-only (a kliens hívása változatlan). **596 Jest zöld** + valós Postgres
  16 verifikáció: a később KITÖLTÖTT, de korábban ÉRKEZETT menetlevél már nem
  „üti felül" a valóban utolsó utat.

## 2026-07-16 — FIX: a kézi menetlevél bevétele megjelenik a sofőr statisztikájában

Sofőrre osztás után a menetlevél km/diurna/fogyasztás adatai már megjelentek a
Sofőrök (stats-drivers) nézetben, DE a **bevétel** (kézi menetlevél `total_pret`)
nem — mert a per-sofőr bevétel eddig CSAK a fuvarokból (`orders`) számolt. Így a
menetlevél „bevétele" nem látszott a sofőrnél (miközben az Áttekintés összbevétele
már tartalmazta — inkonzisztencia).

- **`getDriverStats` (`handlers/statisticsHandlers.js`)** — a menetlevél-oldali
  aggregáció most a `SUM(f.total_pret)`-et is lekéri (`menetlevel_bevetel`), és a
  sofőr `bevetel`-éhez adja (a fuvar-bevétel megmarad). Így a Sofőrök nézet a fuvar
  ÉS a kézi menetlevél bevételét is mutatja, összhangban az Áttekintéssel. A
  csak-kézi-menetlevéllel rendelkező sofőr is megjelenik a helyes bevétellel.
- Szerver-only változás (a kliens már a `s.bevetel`-t rajzolja). **596 Jest zöld**
  + mock-db teszt (fuvar+menetlevél összeg / csak-kézi-menetlevél sofőr).

> **Megjegyzés a dátum-szűrőhöz:** a Statisztika alapból az **utolsó 12 hónapot**
> mutatja (`data_completare` szerint). Ha egy visszakapott menetlevél ennél régebbi,
> a dátum-tartományt kézzel kell kitágítani, hogy megjelenjen.

## 2026-07-16 — Menetlevél átköthető aktuális sofőrre (szerkesztőben) — statisztika-horgony

A visszakapott (törölt sofőrtől származó) menetlevelek a cég Fuvarlevelek oldalán
megjelennek, de a `nume_sofer`/`email_sofer` a régi (törölt) sofőrre mutatott — így
nem számítottak egy AKTUÁLIS sofőr statisztikájába. Most a menetlevél-szerkesztőben
átköthetők:

1. **`fuvarlevelUpdate` (`handlers/documents.js`)** — új `email_sofer` mező: ha a
   kliens egy sofőrt választ, és az a **saját cég** felhasználója, a menetlevél
   `email_sofer`-e (a statisztika-/tenant-horgony) átíródik rá; üres/idegen esetén a
   meglévő marad (COALESCE) → nincs cross-tenant átkötés, és a régi horgony nem vész el.
2. **Szerkesztő UI (`public/console-shared.js`)** — a sofőr-választó legördülő (eddig
   csak a kézi „Új menetlevél" módban) most a **szerkesztésnél is** látszik, előre a
   menetlevél jelenlegi sofőrjére állítva (`fePopulateDriverPicker`); mentéskor a
   `saveFuvEdit` az `email_sofer`-t is küldi. Így a törölt sofőrtől visszakapott
   menetlevél egy kattintással egy aktuális sofőrhöz rendelhető, és bekerül annak
   statisztikájába.
3. Cache-bust `console-shared.js?v=20260716drvbind`. **596 Jest zöld** + mock-db
   handler-teszt (érvényes cég-sofőr átköt / üres marad / idegen elutasít).

## 2026-07-16 — Árva menetlevél helyreállítás bővítése: rendszám-alapú backfill + developer kézi hozzárendelő

Az admin által **kézzel** létrehozott menetlevélnek jellemzően NINCS fuvar-
hivatkozása (`order_ids` üres — időszaki keresetből születik), ezért a fuvar-alapú
backfill nem éri el, ha a menetlevelet egy azóta törölt sofőrhöz rendelték. Két új
helyreállítási út:

1. **Rendszám-alapú backfill** — `db/fuvarlevelek-company-id-plate-backfill.sql`
   (idempotens, valós Postgres 16-on verifikálva): az árva menetlevél `numar_camion`
   (majd `numar_remorca`) rendszámát a cégek járműveihez (`vehicles.rendszam`)
   illeszti; ha **egyértelműen** egyetlen céghez tartozik, annak a horgonyát kapja.
   Kétértelmű rendszámnál NEM állít vissza → nincs cross-tenant elszivárgás.
2. **Developer „🧾 Árva menetlevelek" fül** (`public/developer.html` +
   `handlers/developer.js` `devListOrphanWaybills`/`devAssignWaybillCompany`, is_dev):
   a maradék, automatikusan nem visszaállítható menetlevelek (törölt sofőr + nincs
   fuvar/egyértelmű rendszám) listája az azonosító adatokkal + a rendszámból **tippelt
   cég**; a developer egy legördülővel a helyes céghez rendeli (audit-naplózva).
   Garantált manuális helyreállítás bármely árva sorra.

**596 Jest zöld** + mock-db handler-teszt + valós Postgres backfill-verifikáció.

## 2026-07-16 — FIX: belső sofőr törlésekor a menetlevelei/dokumentumai NE vesszenek el

**Gyökérok:** a menetlevél (`fuvarlevelek`) és a sofőr-dokumentum (`documents`)
eddig CSAK az `email_sofer` → `users.company_id` joinon át kötődött a céghez.
Amikor egy belső sofőrt (Belső sofőrök fül → `userDelete`) töröltek, a `users`
sor eltűnt, a join megszakadt → a sofőr menetlevelei/dokumentumai **eltűntek a
cég nézetéből** (bár fizikailag megmaradtak a táblában). Így lehetett egy cégnek
0 látható menetlevele, pedig valójában több is volt (pl. `vallorteam23@gmail.com`).

**Javítás — közvetlen `company_id` horgony, ami túléli a sofőr törlését:**
1. **Migráció `db/fuvarlevelek-documents-company-id.sql`** (idempotens, valós
   Postgres 16-on verifikálva) — `company_id` oszlop a `fuvarlevelek` + `documents`
   táblára, visszamenőleges feltöltés két forrásból: (a) a még létező sofőr
   `users.company_id`-ja (email-egyezés); (b) az **árva** soroknál (törölt sofőr) a
   hivatkozott fuvar cége (`order_ids[0]` / `documents.order_id` → `orders.company_id`)
   → a MÁR törölt sofőrök menetlevelei is visszakerülnek a helyes céghez.
2. **`userDelete` (`handlers/users.js`)** — a `users` sor törlése ELŐTT rögzíti a
   `company_id`-t a sofőr menetleveleire/dokumentumaira (best-effort) → jövőbeli
   törlésnél sem veszik el semmi.
3. **Beszúrás-horgonyzás** — minden új menetlevél/dokumentum eleve kap `company_id`-t:
   `routes/soferApi.js` (`fuvarlevel-save`, `doc-upload`), `handlers/documents.js`
   (`fuvarlevelCreate`).
4. **Olvasás-oldal `company_id`-tudatos** (elsődleges `company_id`, fallback a régi
   email-join): `getFuvarlevelek`, `getFuvarlevelDetail`, `fuvarlevelUpdate`,
   `getOrdersMissingWaybill`, `getDriverDocs` (`handlers/documents.js`);
   `getLastVehicleReadings` (`handlers/orders.js`); a **statisztika** közös
   `FUV_FROM` blokkja (`handlers/statisticsHandlers.js`) → minden riport egyszerre;
   PDF/dok letöltés (`routes/soferApi.js`); a fuvar-email POD-fotó lista+csatolás
   (`handlers/orderEmail.js`); developer cég-összesítő + export
   (`handlers/developer.js`, `routes/developer-export.js`). A **feltöltött POD/CMR
   képek** (`documents` tábla) ugyanígy `company_id`-horgonyt kapnak (feltöltéskor
   `doc-upload`), és a migráció a `documents.order_id`→`orders.company_id` alapján
   az árva (törölt sofőr) fotókat is visszaköti. Az `order_documents` (fuvarhoz
   csatolt iratok) **eleve** `company_id`-horgonyzott volt — azt a törlés sosem
   érintette.
5. **Teszt** — `documents.test.js` frissítve (üres user-listánál is lekérdez a
   `company_id`-horgony miatt). **596 Jest zöld**; a recovery valós Postgres-en
   verifikálva (árva menetlevelek visszakerülnek a céghez, idempotens újrafuttatás).

> **Megjegyzés:** egy **fuvar nélküli** menetlevél (`order_ids` üres) egy MÁR törölt
> sofőrtől nem állítható vissza automatikusan (nincs cég-jel a soron); az újak és a
> törlés-előtti horgonyzás viszont ezt is lefedik a jövőre nézve.

## 2026-07-16 — Menetlevél-automatizáció: km-óra átvitel + hiányzó menetlevél lista + fogyasztási anomália-jelző

Három, a meglévő adatra épülő automatizálás (nincs séma-változás). **596 Jest zöld**
+ mock-db és DOM-shim harness.

1. **Km-óra átvitel (az üzemanyag-átvitel ikertestvére)** — a `getLastFuelLevel`
   handler átalakítva `getLastVehicleReadings`-re (`handlers/orders.js`): egy
   rendszámhoz a cég utolsó menetleveléből a záró **üzemanyag-szint** (`cant_sfarsit`)
   ÉS a záró **km-óra állás** (`km_sfarsit`) is (egymástól függetlenül, a legutóbbi
   nem-nulla értékből; visszafelé kompatibilis `level`=fuel mező). A sofőr menetlevél
   kitöltője (`prefillWaybillReadings`, `sofer.js`) a `Cantitate început`-ot ÉS a
   `Km început`-et is ebből tölti elő (mindkettőt csak ha üres/0 — beírt értéket nem
   ír felül; rendszám kézi váltásakor újratölt). Így a záró km automatikusan a
   következő menetlevél kezdő km-je → hézagmentes km-nyilvántartás.
2. **Hiányzó menetlevél teendő-lista (Admin/Manager)** — új `getOrdersMissingWaybill`
   handler (`handlers/documents.js`, cégre szűrt, read-only): a **lezárt** (`Finalizat`)
   fuvarok, amelyekhez még egyetlen menetlevél sem készült (a fuvar id-ja egyetlen
   `fuvarlevelek.order_ids` tömbben sem szerepel — `@> to_jsonb`). A FUVARLEVELEK
   oldal tetején sárga teendő-sáv (`#missingWaybillBand`, `loadMissingWaybills` a
   `console-shared.js`-ben) fuvar-számmal/ügyféllel/útvonallal/sofőrrel.
3. **Fogyasztási anomália-jelző (üzemanyag-lopás gyanú)** — a `getFuvarlevelek`
   (`handlers/documents.js`) minden menetlevél `consum_100`-ját a jármű
   `fuel_per_100km` alapértékéhez hasonlítja (rendszám szerint, normalizálva); >25%
   eltérésnél `consum_anomaly` ='high' (▲ túlfogyasztás, piros) / 'low' (▼, kék) +
   `consum_dev_pct`. A menetlevél-listában ⚠️ badge a fájlnév mellett (`fuvAnomalyBadge`),
   tooltipben a tényleges vs. alapérték fogyasztás. Csak Admin/Manager listáján számol.
4. **i18n** `cs.missingWbTitle`/`cs.missingWbHint`/`cs.anomTitle` (RO-alap + HU).
   Cache-bust `console-shared.js`/`i18n.js`/`sofer.js` `?v=20260716auto3`.

## 2026-07-16 — Sofőr: kiosztott jármű kiírása + menetlevél rendszám-/üzemanyag-előtöltés

Tisztán a meglévő párosításra épül (nincs séma-változás): a sofőr↔vontató
(`vehicles.assigned_driver_email`) + vontató↔alapértelmezett pótkocsi
(`vehicles.default_trailer_id`) párosítást az Admin/Manager **már eddig is**
beállítja a Belső sofőrök fülön (`assignDriverVehicle`/`assignDefaultTrailer`).
Ez a kör a **sofőr-oldalt** egészíti ki. **596 Jest zöld** + mock-db és DOM-shim harness.

1. **Sofőr látja a neki kiosztott járművet** — új `getMyAssignedVehicle` handler
   (`handlers/orders.js`, Sofer, cégre szűrt): a bejelentkezett sofőrhöz rendelt
   vontató + alapértelmezett pótkocsi rendszáma. A sofőr főoldal tetején új
   `#myVehicleBox` kártya (🚚 vontató-rendszám + márka/típus, 🚛 pótkocsi-rendszám),
   csak ha van párosítás (`sofer.html`/`sofer.js` `loadMyAssignedVehicle`).
2. **Menetlevél rendszám-előtöltés (szerkeszthető)** — `fuvarStep2` (`sofer.js`):
   ha a kiválasztott fuvarban nincs rendszám (pl. fuvar nélküli menetlevél), a
   `Număr camion`/`Număr remorcă` a nekem kiosztott járműből töltődik alapértékként
   (üres mezőt nem ír felül, a sofőr szabadon átírja).
3. **Üzemanyag-szint átvitel a következő menetlevélre** — új `getLastFuelLevel(plate)`
   handler (`handlers/orders.js`, Sofer+Admin/Manager, cégre szűrt, normalizált
   rendszám-illesztés): egy adott jármű legutóbbi menetleveléből a záró szint
   (`cant_sfarsit`, ha >0). A menetlevél kitöltő a `Cantitate început`-ot ebből
   tölti elő (`prefillFuelStart`) — az első menetlevél 0-ról indul, de ha rögzítve
   volt pl. kezdő 100 L / záró 380 L, a következő menetlevél kezdő szintje 380 L
   lesz (a sofőr felül tudja írni). Rendszám kézi módosításakor újratölt (csak ha
   a kezdő mező üres/0).
4. **i18n** `sof.myVehicle` (RO-alap + HU). Cache-bust `sofer.js`/`i18n.js` `?v=20260716pair`.

## 2026-07-16 — Sofőr: menetlevél kiválasztott fuvar nélkül is

Tisztán kliens-oldali (HTML/JS/i18n), nincs szerver-/séma-változás — a
`/api/fuvarlevel-save` végpont már eddig is elfogadott üres `orderIds`-t.
**596 Jest zöld** + DOM-shim harness verifikáció.

1. **Új „➕ Menetlevél fuvar nélkül" gomb** a sofőr menetlevél 1. lépésén
   (`public/sofer.html`) — a fuvar-választó lista alatt, másodlagos (nem-kék)
   stílussal. A sofőr így kiválasztott fuvar nélkül is elkészítheti a
   menetlevelet (pl. üres/tervezés-alatti menet, magánmenet), a km/rendszám/
   pont-adatokat kézzel beírva.
2. **`fuvarStep2(allowEmpty)` + `fuvarNoOrder()` (`public/sofer.js`)** — a
   léptető most opcionális `allowEmpty` jelzőt kap: `true` esetén üres
   fuvar-listával is a kitöltő lépésre visz (a „legalább egy fuvar" toast csak
   a normál `fuvarStep2()` úton él). Üres kiválasztásnál az összesítő a
   „menetlevél fuvar nélkül" jelzést mutatja; a rendszám/dátum/pont-előtöltés
   üres listánál kihagyódik (meglévő guard-ok). A beküldés `orderIds: []`-t
   küld → a statisztika a sofőr e-mailjéhez kötődik, mint eddig.
3. **i18n** (`public/i18n.js`) — `sof.noOrderWaybill` + `sof.noOrderSummary`
   (RO-alap + HU). Cache-bust `sofer.js`/`i18n.js` `?v=20260716noord`.
4. **Megjegyzés:** az Admin/Manager kézi menetlevél-készítés (sofőr-választó +
   statisztika-kötés az `email_sofer`→`users.company_id` joinon át) már korábban
   kész volt (`fuvarlevelCreate`, 2026-06-29); ez a kör a sofőr-oldalt egészíti ki.

## 2026-07-16 — Mobil UI rendberakás: admin/manager felső sáv + sofőr főoldal

Tisztán kliens-oldali (HTML/CSS/JS), nincs szerver-/séma-változás. **596 Jest zöld.**

1. **Admin/Manager felső sáv (`.vs-topbar`) mobilon nem lóg ki / nem takar (`public/style.css`)** —
   gyökérok: a sáv (breadcrumb + kereső `flex:1` + jobb-oldali gombok: nyelv/sofőr-mód/
   téma/értesítés) egy sorba préselődött → a jobb-oldali gombok kilógtak és a
   `overflow-x:hidden` levágta őket (a téma-kapcsoló „eltűnt"), a kereső ráült a
   breadcrumb-ra. Javítás: a `@media (max-width:768px)` alatt a sáv **tördel**
   (`flex-wrap`), 1. sor = breadcrumb + gombok (mind látszik), 2. sor = teljes
   szélességű kereső; a negatív margó a 12px-es mobil paddinghoz igazítva. `≤380px`:
   a breadcrumb elbújik, a gombok teljes szélességben `space-between`. Minden admin/
   manager oldalt érint (a sáv globális).
2. **Sofőr havi statisztika 2×2, ~20%-kal kisebb (`public/sofer.css`+`sofer.js`)** —
   gyökérok: a `soferMiniStats` inline `grid-template-columns:repeat(2,1fr)`-t adott,
   de a sofőr oldal a `style.css`-t is betölti, amelynek mobil felülírója
   (`[style*="display:grid"][style*="grid-template-columns"] → 1fr`) a rácsot
   **egyoszloposra** törte (4 nagy, egymás alatti kártya). Javítás: a rács + csempék
   most **osztályból** (`.sof-mstat-grid`/`.sof-mstat`) kapják a méretet (a felülíró
   osztályt nem talál el) → valódi 2×2, kompaktabb (padding 12→9, ikon 20→16, érték
   18→15px), teljes szélességű.
3. **Sofőr kiosztott-fuvar kártya: összecsukva CSAK a fel-/lerakó cím (`public/sofer.js`)** —
   a kártya összecsukott állapotban most kizárólag a `📍 felrakó → lerakó` címet + nyilat
   mutatja; a meta-sor (#szám, ügyfél, kamion, státusz), a részletek és az akciógombok
   (UIT / állomás-léptetés / áru-leadás) a **kinyíló** részbe kerültek → kattintásra
   megnő a „buborék", a fejlécre újra kattintva összecsukható.
4. **Sofőr felső sáv: a nyelvváltó nem lóg a névre (`sofer.html`+`sofer.css`)** —
   eddig nem volt `#langSwitch` konténer, ezért az i18n.js **fixen, lebegve** rakta a
   HU/RO váltót a jobb felső sarokba, rátakarva a név-jelvényt. Most inline `#langSwitch`
   a fejlécben (logó | nyelvváltó + név), világos, olvasható pill-stílussal.

---

## 2026-07-15 — Állomás-visszajelzés kiegészítés: irodai idővonal + menetlevél-előtöltés + kozmetika

Három fejlesztés a sofőr 4 lépéses állomás-visszajelzéséhez (mind kliens-oldali,
nincs szerver-/séma-változás):

1. **Irodai idővonal** (`public/entity-detail.js`) — az admin/manager **fuvar-adatlap**
   Áttekintés fülén megjelenik a „🚚 Fuvar állapota (sofőr-visszajelzés)" idővonal:
   a 4 állomás ✅ + időbélyeggel / ○ hátralévővel. Így a diszpécser egy pillantással
   látja, hol tart a fuvar (nem csak a röpke push-ból). A `getOrderDetail` `o.*`-ot ad,
   így az időbélyegek már elérhetők; új `ed.ms.*` i18n kulcsok (RO+HU). Csak aktív
   fuvaron vagy ha van rögzített állomás jelenik meg.
2. **Menetlevél-előtöltés** (`public/sofer.js` `fuvarStep2`) — a menetlevél „Út
   időpontjai" indulás/érkezés mezőjét a rendszer **előtölti a tényleges állomás-
   dátumból** (`incarcat_at` → indulás, `descarcat_at` → érkezés), fallback a fuvar
   tervezett `data_incarcare`/`data_descarcare` dátumára. **Csak a dátumot** tölti
   (óra 00:00 → a sofőr állítja); üres mezőt piszkozat-visszatöltéskor nem ír felül;
   több fuvarnál a legkorábbi felrakás / legkésőbbi lerakás.
3. **Kozmetika** (`public/sofer.js`) — a `Finalizat` fuvar kártyáján **CSAK akkor**
   jelenik meg az állomás-idővonal, ha van rögzített állomás (különben — pl. az admin
   kézzel zárta le — nem mutat üres `○ ○ ○ ○`-t). Aktív fuvaron továbbra is mindig látszik.

Cache-bust `?v=20260715ofc`. DOM-shim harnesszel verifikálva (idővonal-láthatóság +
dátum-logika); **596 Jest zöld**.

## 2026-07-15 — Sofőr: a Finalizat fuvar menetlevél nélkül SOSEM tűnik el

- **Követelmény:** amíg egy fuvarból **nem készült menetlevél**, addig a lezárt
  (`Finalizat`) fuvar **semmiképp** nem eshet ki a sofőr felületéről (eddig 3 nap
  után menetlevél nélkül is kiesett).
- **`handlers/orders.js` `getMySoferOrders`** — mind a `dash_visible` (főoldali
  kártya), mind a `waybill_visible` (menetlevél-választó) CASE kap egy új ágat:
  `Finalizat AND waybill_count = 0 → true` (mindig látszik). A meglévő fade változatlan:
  ≥2 menetlevél → 15 perc az utolsó mentés után; 1 menetlevél → 3 nap a lezárástól.
  Az aktív státuszok (Alocat/In Curs/Parkolt/Raktarban) továbbra is mindig látszanak.
- **Teszt** (`tests/integration/db-orders.test.js`) frissítve az új viselkedésre:
  5 napos Finalizat menetlevél nélkül → `true`; 5 napos Finalizat 1 menetlevéllel →
  `false`. Valós Postgres-en verifikálva; **637 teszt zöld** (a teljes valódi-DB
  készlettel).

## 2026-07-15 — Sofőr: 4 lépéses állomás-visszajelzés (odaért → megrakodott → odaért → leürített)

- **Egy gomb fuvar-kártyánként**, ami lenyomásra végiglépteti a fuvar 4 állomását,
  mindegyik **külön időbélyeget** kap, és minden lépésnél **push** megy az irodának
  (Admin/Manager):
  1. 📍 megérkezett a felrakóhoz (`sosit_incarcare_at`) → a fuvar `In Curs` lesz,
  2. 📦 felrakodott (`incarcat_at`),
  3. 📍 megérkezett a lerakóhoz (`sosit_descarcare_at`),
  4. ✅ leürített (`descarcat_at`) → a fuvar `Finalizat` lesz.
- **Szerver-oldali léptetés** (`routes/ordersRest.js` `POST /api/orders/:id/driver-milestone`,
  Sofer role): a szerver dönti el a KÖVETKEZŐ üres állomást (nem lehet kihagyni /
  visszajátszani), időbélyeget ír `NOW()`-val, státuszt léptet (első→In Curs,
  utolsó→Finalizat), tulajdon-ellenőrzött (`company_id` + `email_sofer`), push best-effort.
- **Migráció** `db/order-driver-milestones.sql` — 4 `TIMESTAMPTZ` oszlop (idempotens,
  auto-fut). A meglévő status-logika (Alocat/In Curs/Finalizat) érintetlen.
- **Sofőr-kártya** (`public/sofer.js`): a régi „Elfogadom"/„Elvégeztem" két gombot
  **egyetlen léptető gomb** váltja (a következő lépés felirata); a kinyíló panel egy
  **állomás-idővonalat** mutat (✅ kész + időbélyeg / ○ hátralévő). `getMySoferOrders`
  visszaadja a 4 időbélyeget; `sofer.css` idővonal-stílus; `i18n.js` 7 új `sof.ms.*`
  kulcs (RO-alap+HU), cache-bust `?v=20260715ms`. DOM-shim harnesszel verifikálva
  (léptetés + idővonal + Finalizat/Parkolt esetek); **596 Jest zöld**.

## 2026-07-15 — Fuvar: külön felrakási / lerakási cégnév (feladó / címzett)

- **Új adatmezők:** az `orders` eddig egyetlen cégmezőt tárolt (`client` =
  megrendelő). Most **külön felrakási cég** (`firma_incarcare`) és **lerakási cég**
  (`firma_descarcare`) is rögzíthető — a sofőrnek gyakran a konkrét feladó/címzett
  cég neve kell. Migráció: `db/order-load-unload-firma.sql` (idempotens, auto-fut).
- **Admin/Manager fuvar-űrlap** (kiíró + szerkesztő): „Felrakási cég" a felrakás
  helye mellett, „Lerakási cég" a lerakás helye mellett (opcionális). Bekötve:
  `comCreate` (INSERT), `comUpdate` (feltételes UPDATE, üres → törlés), `getOrderById`
  (`SELECT *` → a szerkesztő előtölti). Input-korlát 255, paraméteres SQL.
- **Sofőr fuvar-kártya:** a kinyíló részlet-panel Felrakás/Lerakás szekciója
  mostantól a **cég nevét is** kiírja (a helyszín + időpont fölött). Szerver:
  `getMySoferOrders` visszaadja a `firma_incarcare`/`firma_descarcare` mezőt.
- **Kliens:** `admin.html`/`manager.html` (kiíró + szerkesztő mezők),
  `console-shared.js` (beolvasás/reset/előtöltés/mentés), `sofer.js` (kártya),
  `i18n.js` (`form.loadFirma`/`form.unloadFirma`/`form.firmaPh`/`sof.det.company`,
  RO-alap+HU), cache-bust `?v=20260715firma`. **596 Jest zöld.**

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
