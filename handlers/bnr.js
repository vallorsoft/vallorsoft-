// ============================================================
//  VallorSoft — handlers/bnr.js
//  BNR EUR/RON árfolyam aloldal (read-only).
//  A meglévő services/bnr.js szolgáltatást használja a hivatalos
//  napi árfolyamhoz, és a cég tárolt eur_ron_rate értékét adja vissza.
//  Multi-tenant: a cég-árfolyam company_id-re szűrt, paraméteres lekérdezés.
// ============================================================
const pool = require('../db');
const { fetchBnrEurRon, getRateFor } = require('../services/bnr');

const handlers = {};

// A jelenlegi BNR EUR/RON árfolyam + a cég tárolt eur_ron_rate értéke.
handlers.getBnrRate = async function (req, res, args) {
  try {
    if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const cid = req.session.user.company_id;

    // Cég tárolt árfolyama (company_id-szűrt, paraméteres)
    const cR = await pool.query(
      'SELECT eur_ron_rate FROM companies WHERE id = $1',
      [cid]
    );
    const companyRate = cR.rows[0] && cR.rows[0].eur_ron_rate != null
      ? Number(cR.rows[0].eur_ron_rate) : null;

    // Hivatalos BNR árfolyam (a meglévő szolgáltatásból; hiba esetén null)
    const bnrRate = await fetchBnrEurRon();

    return res.json({ result: {
      ok: true,
      bnr_rate: bnrRate,
      company_rate: companyRate,
      fetched_at: new Date().toISOString()
    } });
  } catch (err) {
    console.error('getBnrRate hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Egy valuta BNR árfolyama egy adott napra (RON / 1 egység) — a sofőr
// menetlevél-űrlapja hívja, amikor a tétel valutáját / dátumát állítja.
// Nyilvános adat, de csak bejelentkezett Sofer/Admin/Manager érheti el.
handlers.getBnrRateFor = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!u || !['Sofer', 'Admin', 'Manager'].includes(u.pozicio)) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    const a = (Array.isArray(args) ? args[0] : args) || {};
    const { normalizeCurrency } = require('../lib/itemCurrency');
    const cur = normalizeCurrency(a.currency);
    if (!cur) return res.json({ result: { ok: false, err: 'Valută necunoscută' } });
    const hit = await getRateFor(cur, a.date);
    if (!hit) return res.json({ result: { ok: false, err: 'Cursul BNR nu este disponibil pentru această dată' } });
    return res.json({ result: { ok: true, currency: hit.currency, rate: hit.rate, date: hit.date } });
  } catch (err) {
    console.error('getBnrRateFor hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
