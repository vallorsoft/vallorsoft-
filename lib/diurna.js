// ============================================================
//  VallorSoft — Diurna kalkulátor
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
//
//  Napi bontás: Europe/Bucharest szerinti naptári napok. A korábbi
//  UTC-s bontásnál egy éjfél körüli határátlépés (RO = UTC+2/+3)
//  rossz naphoz került, ami az EXTERN/INTERN (≥12 óra) besorolást —
//  azaz a napidíjat — torzította.
//
//  Új hívási mód (sofőr által megadott indulás/érkezés + határátlépések):
//    calculateDiurna(indulasDt, erkezesDt, hataratok)
//    - indulasDt: string pl. "2025-01-06T10:00" (helyi idő)
//    - erkezesDt: string pl. "2025-01-10T21:00" (helyi idő)
//    - hataratok: [{datetime:"2025-01-07T08:00", direction:"OUT"|"IN"}, ...]
//
//  Régi hívási mód (border_crossings sorok) visszafelé kompatibilis:
//    calculateDiurna(crossings)  — tömb, első elem .crossed_at tulajdonsággal
// ============================================================
const TZ = 'Europe/Bucharest';

// Az adott pillanat bukaresti offsete (ms). A 'sv-SE' locale ISO-szerű
// formátumot ad (YYYY-MM-DD HH:mm:ss), amiből UTC-ként visszaolvasva
// megkapjuk az eltolást.
function tzOffsetMs(date) {
  const iso = date.toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T') + 'Z';
  return new Date(iso).getTime() - date.getTime();
}

// Bukaresti helyi időre tolt időbélyeg — így a meglévő UTC-napos
// vágás helyi éjféleknél vág. (DST-váltás napján a határ ±1 órát
// csúszhat — a napidíj-számításnál ez elfogadható.)
function toLocal(ts) {
  return new Date(ts.getTime() + tzOffsetMs(ts));
}

// ---------------------------------------------------------------
// Új számítás: sofőr által megadott indulás/érkezés + határátlépések
// Szabály:
//   - Indulás napja: csak akkor számít, ha az indulás 12:00 előtt volt
//   - Érkezés napja: csak akkor számít, ha az érkezés 12:00 után volt
//   - Közbülső napok: mindig számítanak
//   - Típus (EXTERN/INTERN): ha délben (12:00-kor) Románián kívül volt → EXTERN, különben INTERN
// ---------------------------------------------------------------
function calculateDiurnaFromTrip(indulasDt, erkezesDt, hataratok) {
  if (!indulasDt || !erkezesDt) return { externDays: 0, internDays: 0, crossingLog: [] };

  const depTs = new Date(indulasDt);
  const arrTs = new Date(erkezesDt);
  if (isNaN(depTs) || isNaN(arrTs) || arrTs <= depTs) {
    return { externDays: 0, internDays: 0, crossingLog: [] };
  }

  // Határátlépések rendezve időrend szerint
  const crossings = (Array.isArray(hataratok) ? hataratok : [])
    .filter(h => h && h.datetime)
    .map(h => ({ ts: new Date(h.datetime), direction: h.direction }))
    .filter(h => !isNaN(h.ts))
    .sort((a, b) => a.ts - b.ts);

  // Naptári napok gyűjtése (YYYY-MM-DD) amelyeken a sofőr úton volt.
  // Indulás napja: beleszámít ha indulás < 12:00 (helyi)
  // Érkezés napja: beleszámít ha érkezés > 12:00 (helyi)
  // Közbülső napok: mind
  const depLocal = toLocal(depTs);
  const arrLocal = toLocal(arrTs);

  const depDay = depLocal.toISOString().slice(0, 10);
  const arrDay = arrLocal.toISOString().slice(0, 10);
  const depHour = depLocal.getUTCHours() + depLocal.getUTCMinutes() / 60;
  const arrHour = arrLocal.getUTCHours() + arrLocal.getUTCMinutes() / 60;

  // Napok listája
  const days = [];
  let cur = new Date(depDay + 'T00:00:00Z');
  const arrDayDate = new Date(arrDay + 'T00:00:00Z');
  while (cur <= arrDayDate) {
    days.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86400000);
  }

  // Szűrés: indulás és érkezés napja feltételhez kötött
  const activeDays = days.filter(d => {
    if (d === depDay && d === arrDay) {
      // Egynapos út: indulás < 12 ÉS érkezés > 12 kell
      return depHour < 12 && arrHour > 12;
    }
    if (d === depDay) return depHour < 12;
    if (d === arrDay) return arrHour > 12;
    return true; // közbülső nap mindig
  });

  if (!activeDays.length) return { externDays: 0, internDays: 0, crossingLog: [] };

  // Minden naphoz meghatározzuk, hogy 12:00-kor Románián kívül volt-e
  // A határátlépések alapján: induláskor belül (IN) van, OUT = kilép, IN = visszalép
  let externDays = 0, internDays = 0;
  const crossingLog = activeDays.map(day => {
    // 12:00 az adott napon (helyi idő — a nap ISO dátuma bukaresti éjféltől számítva)
    // Egyszerűsítés: UTC-ban a nap + 10 óra (UTC+2 esetén 12:00 helyi ≈ 10:00 UTC)
    const noon = new Date(day + 'T10:00:00Z'); // közelítés UTC+2 esetén (DST nélkül)

    // Végigmegyünk a határátlépéseken: noon előtti utolsó állapot dönti el
    let outsideAtNoon = false;
    for (const c of crossings) {
      if (c.ts > noon) break;
      if (c.direction === 'OUT') outsideAtNoon = true;
      else if (c.direction === 'IN') outsideAtNoon = false;
    }

    const type = outsideAtNoon ? 'EXTERN' : 'INTERN';
    if (type === 'EXTERN') externDays++; else internDays++;
    return { day, type };
  });

  return { externDays, internDays, crossingLog };
}

// ---------------------------------------------------------------
// Régi számítás: border_crossings DB-sorok alapján (visszafelé kompatibilis)
// ---------------------------------------------------------------
function calculateDiurnaFromCrossings(crossings) {
  if (!crossings || !crossings.length) return { externDays: 0, internDays: 0, crossingLog: [] };
  const dayMin = {};
  let lastOut = null;
  for (const c of crossings) {
    const ts = toLocal(new Date(c.crossed_at));
    if (c.direction === 'OUT') {
      lastOut = ts;
    } else if (c.direction === 'IN' && lastOut) {
      let cur = new Date(lastOut);
      while (cur < ts) {
        const dk = cur.toISOString().slice(0, 10);
        const nextDay = new Date(dk); nextDay.setDate(nextDay.getDate() + 1);
        const end = ts < nextDay ? ts : nextDay;
        dayMin[dk] = (dayMin[dk] || 0) + Math.floor((end - cur) / 60000);
        cur = end;
      }
      lastOut = null;
    }
  }
  let externDays = 0, internDays = 0;
  const crossingLog = Object.entries(dayMin).sort().map(([day, min]) => {
    const hours = +(min / 60).toFixed(2);
    const type = hours >= 12 ? 'EXTERN' : 'INTERN';
    if (type === 'EXTERN') externDays++; else internDays++;
    return { day, minutes: min, hours, type };
  });
  return { externDays, internDays, crossingLog };
}

// ---------------------------------------------------------------
// Egységes belépési pont — visszafelé kompatibilis
// Ha az első argumentum tömb → régi mód (border_crossings sorok)
// Ha string → új mód (indulasDt, erkezesDt, hataratok)
// ---------------------------------------------------------------
function calculateDiurna(firstArg, erkezesDt, hataratok) {
  if (Array.isArray(firstArg)) {
    // Régi hívás: calculateDiurna(crossingsArray)
    return calculateDiurnaFromCrossings(firstArg);
  }
  // Új hívás: calculateDiurna(indulasDt, erkezesDt, hataratok)
  return calculateDiurnaFromTrip(firstArg, erkezesDt, hataratok);
}

module.exports = { calculateDiurna };
