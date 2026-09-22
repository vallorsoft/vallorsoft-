// ============================================================
//  KIADÁS-KATEGÓRIÁK — kliens-oldali párja a `lib/expenseCategories.js`-nek
// ============================================================
// A menetlevél vásárlás-sorának kategória-választóját (sofőr felület +
// admin menetlevél-szerkesztő) ebből építjük. A felirat az i18n
// `sof.cat.<key>` kulcsából jön (RO-alap + HU).
//
// FIGYELEM: a szerver-oldali párja a `lib/expenseCategories.js`; a kettőt a
// `tests/unit/expense-categories.test.js` egyezésre kényszeríti. Új
// kategória → MINDKÉT fájl + i18n kulcs (RO+HU).
window.VS_EXPENSE_CATS = [
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

// `<option>` lista egy kiválasztott kulccsal. A `t()` az i18n-ből jön; ha
// még nem töltődött be, a nyers kulcs helyett a kategória-kulcsot mutatjuk.
window.vsExpenseCatOptions = function (selected) {
  var sel = window.VS_EXPENSE_CATS.indexOf(selected) >= 0 ? selected : 'altele';
  var tr = (typeof t === 'function') ? t : function (k) { return k; };
  return window.VS_EXPENSE_CATS.map(function (k) {
    var label = tr('sof.cat.' + k);
    if (label === 'sof.cat.' + k) label = k;          // i18n még nincs kész
    return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + label + '</option>';
  }).join('');
};
