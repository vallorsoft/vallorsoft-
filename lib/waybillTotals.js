// ============================================================
//  MENETLEVÉL — derivált üzemanyag-mezők (EGY igazságforrás)
// ============================================================
// Eddig HÁROM helyen élt bájtra azonos másolatban (sofőr-beküldés
// `routes/soferApi.js`, admin szerkesztés + kézi létrehozás
// `handlers/documents.js`), és MINDHÁROM ugyanazt a hibát vitte:
//
//   alimentari.forEach(a => totalAlim += a.litru)     // ← típus NÉLKÜL
//
// A menetlevél-űrlap viszont KÉT üzemanyag-típust kínál (Motorină és
// AdBlue), így egy AdBlue-töltés litere is a dízel-fogyasztásba került:
// felnyomta a `motorina_folosit`-ot és a `consum_100`-at. Az AdBlue a
// dízel-fogyasztás néhány százaléka, ami pont a riasztási küszöb
// környékén billent: a sofőr „Nézze át a menetlevelet" figyelmeztetést
// kapott, a manager pedig eltérés-push-t, valós ok nélkül.
//
// A rendszer máshol MÁR tudta a különbséget (a CO₂-riport kifejezetten
// kiszűri az AdBlue-t, a `getFuelStats` típus szerint bont) — csak a
// menetlevél saját száma maradt ki.
//
// Mostantól: `total_alim` = CSAK dízel, `total_adblue` = külön mező.

// Egy tankolás-sor AdBlue-e? A típus a menetlevél-űrlap két opciójából
// jön (`Motorină` / `AdBlue`), de defenzíven kezeljük: ékezet-, kis/nagy-
// betű- és whitespace-független illesztés, mert a sor jöhet AI
// bon-kiolvasásból, piszkozat-visszatöltésből vagy admin-szerkesztésből is.
function isAdblueRow(row) {
  const tip = (row && row.tip != null) ? String(row.tip) : '';
  return /adblue/i.test(tip.replace(/\s+/g, ''));
}

function _num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// A menetlevél derivált üzemanyag-mezői EGY helyen.
//   alimentari : a tankolás-sorok tömbje (JSONB-ből vagy a kliens payloadból)
//   cantInc    : kezdő tartály-szint (L)
//   cantSf     : záró tartály-szint (L)
//   totalKm    : a menetlevélen megtett km
// Vissza: { totalAlim, totalAdblue, motorinaFolosit, consum100 }
function computeFuelTotals(alimentari, cantInc, cantSf, totalKm) {
  const rows = Array.isArray(alimentari) ? alimentari : [];
  let totalAlim = 0, totalAdblue = 0;
  rows.forEach(a => {
    const l = _num(a && a.litru);
    if (isAdblueRow(a)) totalAdblue += l;
    else totalAlim += l;                     // dízel (alapértelmezés)
  });
  // Kerekítés 2 tizedesre: a litereket a sofőr tizedesig írja, a lebegő-
  // pontos összeadás maradéka (pl. 0.30000000000000004) ne szivárogjon a
  // bizonylatra.
  const r2 = (n) => Math.round(n * 100) / 100;
  totalAlim = r2(totalAlim);
  totalAdblue = r2(totalAdblue);

  // A tartály-mérleg KIZÁRÓLAG a dízelre értelmes (az AdBlue külön
  // tartályban van, a `cant_inceput`/`cant_sfarsit` a dízel-szint).
  const motorinaFolosit = r2(Math.max(0, _num(cantInc) + totalAlim - _num(cantSf)));
  const km = _num(totalKm);
  const consum100 = km > 0 ? Math.round((motorinaFolosit / km * 100) * 100) / 100 : 0;

  return { totalAlim, totalAdblue, motorinaFolosit, consum100 };
}

module.exports = { computeFuelTotals, isAdblueRow };
