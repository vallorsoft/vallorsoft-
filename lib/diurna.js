// ============================================================
//  VallorSoft — Diurna kalkulátor
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
//
//  Napi bontás: Europe/Bucharest szerinti naptári napok. A korábbi
//  UTC-s bontásnál egy éjfél körüli határátlépés (RO = UTC+2/+3)
//  rossz naphoz került, ami az EXTERN/INTERN (≥12 óra) besorolást —
//  azaz a napidíjat — torzította.
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

// Régi GPS-alapú diurna számítás (border_crossings tábla sorokból).
// Visszafelé kompatibilitásért megőrizve — a /api/diurna-stats és a
// régi kódok ezen az ágon mennek tovább.
function _legacyCalculateDiurna(crossings) {
  if (!crossings || !crossings.length) return { externDays:0, internDays:0, crossingLog:[] };
  const dayMin = {};
  let lastOut = null;
  for (const c of crossings) {
    const ts = toLocal(new Date(c.crossed_at));
    if (c.direction === 'OUT') {
      lastOut = ts;
    } else if (c.direction === 'IN' && lastOut) {
      let cur = new Date(lastOut);
      while (cur < ts) {
        const dk = cur.toISOString().slice(0,10);
        const nextDay = new Date(dk); nextDay.setDate(nextDay.getDate()+1);
        const end = ts < nextDay ? ts : nextDay;
        dayMin[dk] = (dayMin[dk]||0) + Math.floor((end-cur)/60000);
        cur = end;
      }
      lastOut = null;
    }
  }
  let externDays=0, internDays=0;
  const crossingLog = Object.entries(dayMin).sort().map(([day,min]) => {
    const hours = +(min/60).toFixed(2);
    const type = hours>=12 ? 'EXTERN' : 'INTERN';
    if (type==='EXTERN') externDays++; else internDays++;
    return {day, minutes:min, hours, type};
  });
  return {externDays, internDays, crossingLog};
}

// Új menetlevél-alapú diurna számítás.
// indulasDt: ISO datetime string (indulás)
// erkezesDt: ISO datetime string (érkezés)
// hataratok: [{ datetime: ISO string, direction: 'OUT'|'IN' }] lista
//
// Számítási szabály:
//   - Az indulástól az érkezésig naptári naponként (bukaresti zóna) számol.
//   - Indulás napja: csak akkor számít, ha az indulás helyi ideje < 12:00.
//   - Érkezés napja: csak akkor számít, ha az érkezés helyi ideje > 12:00.
//   - Közbülső napok: mindig számítanak.
//   - Minden számolandó nap: a nap 12:00-kor (bukaresti idő) a sofőr Románián
//     kívül volt-e → EXTERN, különben INTERN.
//     (Alap: belül; OUT-átlépés kivülre visz, IN visszahozza.)
//
// Visszafelé kompatibilitás: ha az első argumentum tömb (régi hívás),
// átirányítjuk a legacy függvényre.
function calculateDiurna(indulasDtOrCrossings, erkezesDt, hataratok) {
  // Visszafelé kompatibilitás: régi hívási forma (array vagy null az első arg,
  // és nincs második argumentum — a régi kód csak egy paramétert ad)
  if (Array.isArray(indulasDtOrCrossings) || (indulasDtOrCrossings === null && erkezesDt === undefined)) {
    return _legacyCalculateDiurna(indulasDtOrCrossings);
  }

  const indulasDt = indulasDtOrCrossings;
  if (!indulasDt || !erkezesDt) return { externDays:0, internDays:0, crossingLog:[], days:0, extern:0, intern:0, details:[] };

  const depDate = new Date(indulasDt);
  const arrDate = new Date(erkezesDt);
  if (isNaN(depDate) || isNaN(arrDate) || depDate >= arrDate) {
    return { externDays:0, internDays:0, crossingLog:[], days:0, extern:0, intern:0, details:[] };
  }

  const crossList = Array.isArray(hataratok) ? hataratok : [];

  // Naptári napok (YYYY-MM-DD, bukaresti zónában)
  const depLocal = toLocal(depDate);
  const arrLocal = toLocal(arrDate);
  const depDay = depLocal.toISOString().slice(0,10);
  const arrDay = arrLocal.toISOString().slice(0,10);

  // Összes nap a tartomány alatt
  const days = [];
  let curDay = new Date(depDay + 'T00:00:00Z');
  const endDay = new Date(arrDay + 'T00:00:00Z');
  while (curDay <= endDay) {
    days.push(curDay.toISOString().slice(0,10));
    curDay = new Date(curDay.getTime() + 86400000);
  }

  // Indulás / érkezés helyi óra (0–24 skálán)
  const depHour = depLocal.getUTCHours() + depLocal.getUTCMinutes() / 60;
  const arrHour = arrLocal.getUTCHours() + arrLocal.getUTCMinutes() / 60;

  // Határátlépések UTC-ben
  const sortedCross = [...crossList]
    .filter(c => c && c.datetime)
    .map(c => ({ ts: new Date(c.datetime).getTime(), dir: c.direction === 'IN' ? 'IN' : 'OUT' }))
    .filter(c => !isNaN(c.ts))
    .sort((a,b) => a.ts - b.ts);

  // Románián kívül volt-e a sofőr a checkMs UTC pillanatban?
  function isOutsideRoAt(checkMs) {
    let outside = false;
    for (const c of sortedCross) {
      if (c.ts > checkMs) break;
      outside = (c.dir === 'OUT');
    }
    return outside;
  }

  let externDays = 0, internDays = 0;
  const details = [];

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    // Indulás napja: csak akkor számít, ha az indulás < 12:00
    if (i === 0 && depHour >= 12) continue;
    // Érkezés napja: csak akkor számít, ha az érkezés > 12:00
    if (i === days.length - 1 && arrHour <= 12) continue;

    // A nap bukaresti 12:00-ja: UTC-s közelítés (offset visszaforgatással)
    const localNoon = new Date(day + 'T12:00:00Z');
    const approxUtcNoon = localNoon.getTime() - tzOffsetMs(localNoon);

    const type = isOutsideRoAt(approxUtcNoon) ? 'EXTERN' : 'INTERN';
    if (type === 'EXTERN') externDays++; else internDays++;
    details.push({ date: day, type });
  }

  return {
    externDays,
    internDays,
    crossingLog: details.map(d => ({ day: d.date, type: d.type, minutes: 0, hours: 0 })),
    days: details.length,
    extern: externDays,
    intern: internDays,
    details
  };
}

module.exports = { calculateDiurna };
