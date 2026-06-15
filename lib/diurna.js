// ============================================================
//  VallorSoft — Diurna kalkulátor (menetlevél-alapú)
//
//  Új algoritmus: GPS-alapú határátlépés helyett menetlevél-alapú
//  számítás. Az indulás/érkezés datetime + kézi határátlépések
//  (hataratok JSONB) alapján dönti el, melyik nap EXTERN vagy INTERN.
//
//  Szabály (12:00 szabály, Europe/Bucharest):
//    - Indulás napja: csak akkor számít, ha indulás < 12:00
//    - Érkezés napja: csak akkor számít, ha érkezés > 12:00
//    - Közbülső nap: mindig számít
//    - Adott nap típusa: mi volt a sofőr helyzete déli 12:00-kor?
//      (OUT = kilépett RO-ból → kívül; IN = visszalépett → belül)
//      12:00-kor kívül → EXTERN, belül → INTERN
//
//  Docstring példa:
//    departureDt  = "2025-01-06T10:00:00"  (Hétfő, < 12:00 → számít)
//    arrivalDt    = "2025-01-10T21:00:00"  (Péntek, > 12:00 → számít)
//    crossings    = [
//      { datetime: "2025-01-07T11:00:00", direction: "OUT" },  // Kedd 11:00
//      { datetime: "2025-01-09T19:30:00", direction: "IN"  },  // Csütörtök 19:30
//    ]
//    Napok: Jan 6 (Hétfő), Jan 7 (Kedd), Jan 8 (Szerda), Jan 9 (Csütörtök), Jan 10 (Péntek)
//    12:00-kor:
//      Jan 6  → OUT még nem volt → belül → INTERN
//      Jan 7  → OUT 11:00-kor, 12:00-kor már kívül → EXTERN
//      Jan 8  → kívül (az OUT óta nem volt IN) → EXTERN
//      Jan 9  → kívül (IN csak 19:30-kor) → EXTERN
//      Jan 10 → IN jan 9 19:30-kor volt, jan 10 12:00-kor belül → INTERN
//    Eredmény: 3 EXTERN (Jan 7, 8, 9) + 2 INTERN (Jan 6, 10)
// ============================================================
'use strict';

const TZ = 'Europe/Bucharest';

// Bukaresti helyi dátum-string (YYYY-MM-DD) egy Date-ből
function toBucharestDateStr(date) {
  return date.toLocaleDateString('sv-SE', { timeZone: TZ }); // sv-SE → YYYY-MM-DD
}

// Bukaresti helyi óra + perc egy Date-ből (0–23, 0–59)
function toBucharestHHMM(date) {
  const parts = date.toLocaleString('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // "HH:mm" formátum
  const [h, m] = parts.split(':').map(Number);
  return { h, m };
}

// Bukaresti éjféltől eltelt percek egy Date-ből
function toLocalMinutes(date) {
  const { h, m } = toBucharestHHMM(date);
  return h * 60 + m;
}

/**
 * Visszaadja az adott bukaresti nap (YYYY-MM-DD) déli 12:00-jának UTC Date objektumát.
 * Pl. "2025-01-07" → new Date("2025-01-07T10:00:00Z") (UTC+2 télen)
 */
function getBucharestNoon(dateStr) {
  // Próbálunk 09:00, 10:00, 11:00 UTC-vel, és megnézzük, melyiknél 12:00 a bukaresti óra
  // UTC+2 télen → 10:00 UTC = 12:00 Bucharest
  // UTC+3 nyáron → 09:00 UTC = 12:00 Bucharest
  for (const utcHour of [9, 10, 11]) {
    const candidate = new Date(`${dateStr}T${String(utcHour).padStart(2, '0')}:00:00Z`);
    const { h } = toBucharestHHMM(candidate);
    if (h === 12) return candidate;
  }
  // Fallback: 10:00 UTC (UTC+2, téli idő)
  return new Date(`${dateStr}T10:00:00Z`);
}

/**
 * Menetlevél-alapú diurna számítás.
 *
 * @param {Date|string|null} departureDt  - Indulás időpontja
 * @param {Date|string|null} arrivalDt    - Érkezés időpontja
 * @param {Array} crossings               - Határátlépések: [{datetime, direction: "OUT"|"IN"}, ...]
 * @returns {{ externDays: number, internDays: number, crossingLog: Array }}
 */
function calculateDiurna(departureDt, arrivalDt, crossings) {
  // null/undefined → nulla nap
  if (!departureDt || !arrivalDt) {
    return { externDays: 0, internDays: 0, crossingLog: [] };
  }

  const dep = new Date(departureDt);
  const arr = new Date(arrivalDt);

  if (isNaN(dep.getTime()) || isNaN(arr.getTime()) || dep > arr) {
    return { externDays: 0, internDays: 0, crossingLog: [] };
  }

  // Határátlépések normalizálása és időrendbe rendezése
  const sorted = (crossings || [])
    .filter(c => c && c.datetime && (c.direction === 'OUT' || c.direction === 'IN'))
    .map(c => ({ ts: new Date(c.datetime), direction: c.direction }))
    .filter(c => !isNaN(c.ts.getTime()))
    .sort((a, b) => a.ts - b.ts);

  // Naptári napok listája departureDt.date-tól arrivalDt.date-ig (Bucharest TZ)
  const depDateStr = toBucharestDateStr(dep);
  const arrDateStr = toBucharestDateStr(arr);

  // Generáljuk a napok listáját
  const days = [];
  // Menjünk végig naptári naponként a bukaresti dátum-stringek alapján
  const depMidnightUTC = new Date(depDateStr + 'T00:00:00Z');
  const cur = new Date(depMidnightUTC);
  while (toBucharestDateStr(cur) <= arrDateStr) {
    days.push(toBucharestDateStr(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const depMinutes = toLocalMinutes(dep);  // indulás percei Bucharestben
  const arrMinutes = toLocalMinutes(arr);  // érkezés percei Bucharestben
  const NOON = 12 * 60; // 720 perc

  let externDays = 0;
  let internDays = 0;
  const crossingLog = [];

  for (const day of days) {
    // 1. Számít-e ez a nap?
    let counts = true;
    if (day === depDateStr && day === arrDateStr) {
      // Indulás és érkezés ugyanaz a nap: indulás < 12:00 ÉS érkezés > 12:00 kell
      if (depMinutes >= NOON || arrMinutes <= NOON) counts = false;
    } else if (day === depDateStr) {
      // Indulás napja: csak ha indulás < 12:00
      if (depMinutes >= NOON) counts = false;
    } else if (day === arrDateStr) {
      // Érkezés napja: csak ha érkezés > 12:00
      if (arrMinutes <= NOON) counts = false;
    }
    // Közbülső nap: mindig számít (counts marad true)

    if (!counts) continue;

    // 2. Típus meghatározása: mi volt a sofőr helyzete 12:00-kor ezen a napon?
    const noon12Bucharest = getBucharestNoon(day);

    // Állapot déli 12:00-kor: végigmegyünk az összes crossing-on, ami <= noon12Bucharest
    let isOutside = false; // kezdetben Románián belül
    for (const c of sorted) {
      if (c.ts > noon12Bucharest) break;
      if (c.direction === 'OUT') isOutside = true;
      else if (c.direction === 'IN') isOutside = false;
    }

    const type = isOutside ? 'EXTERN' : 'INTERN';
    if (type === 'EXTERN') externDays++;
    else internDays++;

    crossingLog.push({ day, type });
  }

  return { externDays, internDays, crossingLog };
}

module.exports = { calculateDiurna };
