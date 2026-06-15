// VallorSoft — BNR EUR/RON árfolyam lekérdező
// Napi szintű cache; lekérdezés: https://www.bnr.ro/nbrfxrates.xml

const https = require('https');

let _cache = { rate: null, date: null };

// EUR/RON árfolyamot ad vissza, vagy null-t hiba esetén
async function fetchBnrEurRon() {
  const today = new Date().toISOString().slice(0, 10);
  if (_cache.date === today && _cache.rate) return _cache.rate;

  return new Promise((resolve) => {
    const req = https.get('https://www.bnr.ro/nbrfxrates.xml', (res) => {
      let xml = '';
      res.on('data', (d) => { xml += d; });
      res.on('end', () => {
        const m = xml.match(/<Rate currency="EUR">([0-9.]+)<\/Rate>/);
        if (m) {
          const rate = parseFloat(m[1]);
          _cache = { rate, date: today };
          console.log('[BNR] EUR/RON árfolyam frissítve:', rate);
          resolve(rate);
        } else {
          console.warn('[BNR] EUR árfolyam nem található az XML-ben');
          resolve(null);
        }
      });
    });
    req.on('error', (e) => {
      console.warn('[BNR] Lekérdezési hiba:', e.message);
      resolve(null);
    });
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}

module.exports = { fetchBnrEurRon };
