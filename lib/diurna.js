// ============================================================
//  VallorSoft — Diurna kalkulátor
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
function calculateDiurna(crossings) {
  if (!crossings || !crossings.length) return { externDays:0, internDays:0, crossingLog:[] };
  const dayMin = {};
  let lastOut = null;
  for (const c of crossings) {
    const ts = new Date(c.crossed_at);
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

module.exports = { calculateDiurna };
