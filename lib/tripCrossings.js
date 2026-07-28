// ============================================================
//  VallorSoft — Menetlevél határátlépések (GPS-gombokból)
// ------------------------------------------------------------
//  A sofőr a főoldali KÉT gombbal ("🇷🇴 ROMÁNIA BE" / "🇷🇴 ROMÁNIA KI")
//  rögzíti a határátlépést — GPS-koordinátával, egyetlen koppintással.
//  A menetlevélen NINCS kézi bevitel: a diurna KIZÁRÓLAG ezekből a
//  rögzítésekből számolódik, a menetlevél Plecare (indulás) és Sosire
//  (érkezés) dátuma közötti ablakban.
//
//  Ez a modul EGY helyen tartja a lekérdezést, hogy a mentés (fuvarlevel-save)
//  és az előnézet (previewTripDiurna) SOSE térhessen el egymástól.
// ============================================================

// Az ablak a menetlevél NAPJAIT fedi le (nem a pontos órát): a diurna
// naptári napokban számol, és a sofőr a határon gyakran a menetlevélbe
// írt óra ELŐTT/UTÁN koppint. Ezért az indulás napjának 00:00-jától az
// érkezés napjának 23:59:59-éig gyűjtünk.
//
// A `naive` parse (időzóna-jelölés nélküli 'YYYY-MM-DDTHH:MM') szándékosan
// azonos a `fuvarlevelek.indulas_dt` mentésekor használttal — így az ablak
// és a tárolt időpont ugyanazt jelenti.
function _dayStart(dtStr) {
  const d = new Date(String(dtStr).slice(0, 10) + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}
function _dayEnd(dtStr) {
  const d = new Date(String(dtStr).slice(0, 10) + 'T23:59:59.999');
  return isNaN(d.getTime()) ? null : d;
}

// A `border_crossings.tip` a sofőr-gomb értéke ('Intrare' | 'Iesire').
// A diurna-motor 'IN' | 'OUT' irányt vár.
function _dir(tip) {
  if (tip === 'Intrare' || tip === 'IN') return 'IN';
  return 'OUT';                       // 'Iesire' és minden más → kilépés
}

function _row(r) {
  return {
    datetime: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    direction: _dir(r.tip),
    tara: r.tara || null,
    locatie: r.locatie || null,
    source: 'gps'                     // a főoldali gombból — nem kézi bevitel
  };
}

/**
 * A menetlevél időszakára eső határátlépések a sofőr GPS-rögzítéseiből.
 *
 * @returns {Promise<{ inWindow: Array, forCalc: Array }>}
 *   `inWindow` — az időszakban rögzített átlépések (ez kerül a menetlevélbe
 *                és a sofőr előnézetébe).
 *   `forCalc`  — ugyanez, de elé fűzve az ablak ELŐTTI utolsó átlépés is.
 *                Erre azért van szükség, mert a diurna-motor alapból
 *                „Romániában van" állapotból indul: ha a sofőr már az
 *                előző menetlevélen kilépett és még nem jött vissza, e
 *                nélkül tévesen INTERN napokat számolnánk.
 */
async function fetchTripCrossings(pool, email, indulasDt, erkezesDt) {
  const empty = { inWindow: [], forCalc: [] };
  if (!pool || !email || !indulasDt || !erkezesDt) return empty;
  const from = _dayStart(indulasDt);
  const to = _dayEnd(erkezesDt);
  if (!from || !to || from > to) return empty;

  // Multi-tenant: a `border_crossings` a sofőr e-mailjéhez kötött (nincs
  // company_id oszlopa), és mindig a BEJELENTKEZETT sofőr e-mailjével
  // hívjuk — így idegen cég adata nem érhető el.
  const win = await pool.query(
    `SELECT tip, tara, locatie, created_at
       FROM border_crossings
      WHERE LOWER(email_sofer) = LOWER($1)
        AND created_at >= $2 AND created_at <= $3
      ORDER BY created_at ASC
      LIMIT 200`,
    [email, from, to]
  );
  const seed = await pool.query(
    `SELECT tip, tara, locatie, created_at
       FROM border_crossings
      WHERE LOWER(email_sofer) = LOWER($1)
        AND created_at < $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [email, from]
  );

  const inWindow = win.rows.map(_row);
  const forCalc = seed.rows.length ? [_row(seed.rows[0])].concat(inWindow) : inWindow.slice();
  return { inWindow, forCalc };
}

module.exports = { fetchTripCrossings };
