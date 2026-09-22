// ============================================================
//  KIADÁS-KATEGÓRIÁK (menetlevél „Achiziții / Cheltuieli" sorok)
// ============================================================
// A menetlevél vásárlás-sora eddig csak szabad szöveget (`produs`) tárolt,
// ezért a kiadás nem volt se szűrhető, se összesíthető, és a bon-kiolvasó
// AI sem tudta megmondani, MIT tartalmaz a bon — csak leírta.
//
// A kulcs (`key`) a DB-be kerülő, nyelvfüggetlen azonosító; a megjelenített
// felirat az `i18n.js` `sof.cat.<key>` kulcsából jön (RO-alap + HU). A
// szerver MINDIG ebből a fehérlistából validál — a Gemini „kreatív"
// kategóriája sosem kerül be (`normalizeCategory` → `altele`).
//
// FIGYELEM: a kliens-oldali párja a `public/expense-cat.js`; a kettőt a
// `tests/unit/expense-categories.test.js` bájtra egyezésre kényszeríti.
const EXPENSE_CATEGORIES = [
  'taxa_drum',   // útdíj / rovinietă / vignetă
  'feribot',     // komp
  'parcare',     // parkolás
  'spalare',     // mosás
  'reparatie',   // javítás / szerviz
  'piese',       // alkatrész
  'cazare',      // szállás
  'mancare',     // étkezés
  'amenda',      // bírság
  'altele'       // egyéb
];

// Ismeretlen / hiányzó érték → `altele` (sosem dobunk el kiadást amiatt,
// hogy a kategóriát nem sikerült beazonosítani).
function normalizeCategory(v) {
  const s = (v == null ? '' : String(v)).trim().toLowerCase();
  return EXPENSE_CATEGORIES.includes(s) ? s : 'altele';
}

// A Gemini-promptba illeszthető, vesszős felsorolás.
function categoryListForPrompt() {
  return EXPENSE_CATEGORIES.join('", "');
}

module.exports = { EXPENSE_CATEGORIES, normalizeCategory, categoryListForPrompt };
