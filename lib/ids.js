// ============================================================
//  VallorSoft — Ütközésbiztos dokumentum-azonosító generátor
//  A korábbi PREFIX-1000..9999 minta csak 9000 lehetséges értéket
//  adott (globális PK!), ami ~100+ rekordnál már ütközött. Az új
//  formátum: PREFIX-<ms időbélyeg base36><3 random base36 jegy>,
//  pl. CMD-MBKZ41X07AF — 15 karakter, belefér a VARCHAR(20)-ba,
//  gyakorlatilag ütközésmentes (azonos ezredmásodpercen belül is
//  1/46656 az esély).
// ============================================================

function genDocId(prefix) {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, '0');
  return `${prefix}-${t}${r}`;
}

module.exports = { genDocId };
