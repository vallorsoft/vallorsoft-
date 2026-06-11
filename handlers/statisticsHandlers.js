// ============================================================
//  VallorSoft — handlers/statisticsHandlers.js
//  Statisztika & Riport modul (admin/manager konzol, stats-* fülek)
//  + fizetés-rögzítés (💰 gomb a Finalizat fuvarokon)
//  + statisztika-jogosultságok (admin adja a Pénzügy láthatóságot)
//
//  Minden lekérdezés company_id-re szűr (multi-tenant!). A fuvarlevelek
//  táblának nincs company_id oszlopa — a cég-szűrés a users joinon
//  keresztül megy (email_sofer -> users.email + users.company_id).
// ============================================================
const pool = require('../db');
const ctSvc = require('../services/cargotrack');
const { decrypt } = require('../lib/crypto');

const handlers = {};

// ── Közös segédek ────────────────────────────────────────────

function _isAdminOrManager(req) {
  return req.session.user && ['Admin', 'Manager'].includes(req.session.user.pozicio);
}

function _deny(res) {
  return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
}

// args: {from:'YYYY-MM-DD', to:'YYYY-MM-DD'} — hiányzó érték esetén
// alapértelmezés: elmúlt 12 hónap kezdete → holnap (a mai nap is beleessen).
function _range(args) {
  const a = (args && !Array.isArray(args)) ? args : ((args && args[0]) || {});
  let from = new Date(); from.setMonth(from.getMonth() - 12); from.setDate(1);
  let to = new Date(); to.setDate(to.getDate() + 1);
  const pf = a.from ? new Date(a.from) : null;
  const pt = a.to ? new Date(a.to) : null;
  if (pf && !isNaN(pf)) from = pf;
  if (pt && !isNaN(pt)) { to = pt; to.setDate(to.getDate() + 1); } // inkluzív záró nap
  return { from, to };
}

// Pénzügyi riport láthatóság: Admin mindig; Manager csak ha az admin
// engedélyezte (user_permissions, perm_key='stats_finance').
async function _canSeeFinance(req) {
  const me = req.session.user;
  if (!me) return false;
  if (me.pozicio === 'Admin' || me.is_dev) return true;
  if (me.pozicio !== 'Manager') return false;
  const r = await pool.query(
    `SELECT up.enabled FROM user_permissions up
     JOIN users u ON u.id = up.user_id
     WHERE LOWER(u.email) = LOWER($1) AND u.company_id = $2 AND up.perm_key = 'stats_finance'`,
    [me.email, me.company_id]
  );
  return !!(r.rows.length && r.rows[0].enabled);
}

// Cég-szűrt fuvarlevél FROM-blokk (a users joinon át).
const FUV_FROM = `
  FROM fuvarlevelek f
  JOIN users u ON LOWER(u.email) = LOWER(f.email_sofer) AND u.company_id = $1
`;

// ── Saját jogosultságaim (kliens-oldali fül-elrejtéshez) ─────
handlers.getMyStatsPermissions = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const finance = await _canSeeFinance(req);
    return res.json({ result: { ok: true, finance } });
  } catch (err) {
    console.error('getMyStatsPermissions hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ── Admin: jogosultságok listázása / állítása ────────────────
handlers.getStatsPermissions = async function (req, res, args) {
  try {
    if (!req.session.user || req.session.user.pozicio !== 'Admin') return _deny(res);
    const cid = req.session.user.company_id;
    const r = await pool.query(
      `SELECT u.id, u.nume, u.email, u.pozicio,
              COALESCE(up.enabled, FALSE) AS finance_enabled
       FROM users u
       LEFT JOIN user_permissions up
         ON up.user_id = u.id AND up.perm_key = 'stats_finance'
       WHERE u.company_id = $1 AND u.pozicio = 'Manager'
       ORDER BY u.nume`,
      [cid]
    );
    return res.json({ result: { ok: true, users: r.rows } });
  } catch (err) {
    console.error('getStatsPermissions hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

handlers.setStatsPermission = async function (req, res, args) {
  try {
    if (!req.session.user || req.session.user.pozicio !== 'Admin') return _deny(res);
    const cid = req.session.user.company_id;
    const userId = parseInt(args[0], 10);
    const enabled = !!args[1];
    if (!Number.isFinite(userId)) return res.json({ result: { ok: false, err: 'Hibás felhasználó' } });
    // Csak a saját cég Manager-e kapcsolható
    const ur = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND company_id = $2 AND pozicio = 'Manager'`,
      [userId, cid]
    );
    if (!ur.rows.length) return res.json({ result: { ok: false, err: 'A felhasználó nem található' } });
    await pool.query(
      `INSERT INTO user_permissions (company_id, user_id, perm_key, enabled, updated_at)
       VALUES ($1, $2, 'stats_finance', $3, NOW())
       ON CONFLICT (user_id, perm_key)
       DO UPDATE SET enabled = $3, updated_at = NOW()`,
      [cid, userId, enabled]
    );
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('setStatsPermission hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ── Fizetés rögzítése (💰 gomb a Finalizat fuvaron) ──────────
// args: [orderId, {amount, method, note, reset}]
//  - amount: most beszedett összeg (göngyölve adódik a paid_amount-hoz)
//  - reset:  true → fizetés nullázása (téves rögzítés javítása)
handlers.markOrderPayment = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const orderId = String(args[0] || '').trim();
    const p = args[1] || {};
    const or = await pool.query(
      `SELECT id, pret, paid_amount, status FROM orders WHERE id = $1 AND company_id = $2`,
      [orderId, cid]
    );
    if (!or.rows.length) return res.json({ result: { ok: false, err: 'Fuvar nem található' } });
    const o = or.rows[0];
    if (o.status !== 'Finalizat') {
      return res.json({ result: { ok: false, err: 'Csak Finalizat fuvarhoz rögzíthető fizetés' } });
    }

    if (p.reset) {
      await pool.query(
        `UPDATE orders SET payment_status='unpaid', paid_amount=0, paid_at=NULL,
                payment_method=NULL, payment_note=NULL, updated_at=NOW()
         WHERE id = $1 AND company_id = $2`,
        [orderId, cid]
      );
      return res.json({ result: { ok: true, payment_status: 'unpaid', paid_amount: 0 } });
    }

    const amount = parseFloat(p.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.json({ result: { ok: false, err: 'Érvénytelen összeg' } });
    }
    const pret = parseFloat(o.pret) || 0;
    const newPaid = Math.round(((parseFloat(o.paid_amount) || 0) + amount) * 100) / 100;
    const status = (pret > 0 && newPaid >= pret) ? 'paid' : 'partial';
    await pool.query(
      `UPDATE orders SET payment_status=$3, paid_amount=$4, paid_at=NOW(),
              payment_method=$5, payment_note=$6, updated_at=NOW()
       WHERE id = $1 AND company_id = $2`,
      [orderId, cid, status, newPaid, p.method || null, p.note || null]
    );
    return res.json({ result: { ok: true, payment_status: status, paid_amount: newPaid } });
  } catch (err) {
    console.error('markOrderPayment hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ── Áttekintés (stats-overview) ──────────────────────────────
handlers.getStatsOverview = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const { from, to } = _range(args);
    const P = [cid, from, to];

    // Fuvar-KPI-k (lezárt fuvar: finalized_at az időszakban)
    const kpiR = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status='Finalizat' AND finalized_at >= $2 AND finalized_at < $3)::int AS lezart,
              COUNT(*) FILTER (WHERE created_at >= $2 AND created_at < $3)::int AS osszes,
              COUNT(*) FILTER (WHERE status='Anulat' AND created_at >= $2 AND created_at < $3)::int AS torolt,
              COALESCE(SUM(pret) FILTER (WHERE status='Finalizat' AND finalized_at >= $2 AND finalized_at < $3),0)::numeric AS bevetel,
              COALESCE(SUM(km)   FILTER (WHERE status='Finalizat' AND finalized_at >= $2 AND finalized_at < $3),0)::numeric AS km
       FROM orders WHERE company_id = $1`, P
    );

    // Havi bevétel idősor (Finalizat, finalized_at szerint)
    const bevR = await pool.query(
      `SELECT TO_CHAR(finalized_at,'YYYY-MM') AS ho, SUM(pret)::numeric AS osszeg
       FROM orders
       WHERE company_id=$1 AND status='Finalizat' AND finalized_at >= $2 AND finalized_at < $3
       GROUP BY ho ORDER BY ho`, P
    );

    // Havi költség idősor + bontás (fuvarlevelek: tankolás + kiadás)
    const ktgR = await pool.query(
      `SELECT TO_CHAR(f.data_completare,'YYYY-MM') AS ho,
              COALESCE(SUM((SELECT COALESCE(SUM((a->>'suma')::numeric),0) FROM jsonb_array_elements(f.alimentari) a)),0) AS uzemanyag,
              COALESCE(SUM((SELECT COALESCE(SUM((c->>'pret')::numeric),0) FROM jsonb_array_elements(f.achizitii) c)),0) AS vasarlas
       ${FUV_FROM}
       WHERE f.data_completare >= $2 AND f.data_completare < $3
       GROUP BY ho ORDER BY ho`, P
    );

    // Fogyasztás + diurna összesítő (fuvarlevelekből)
    const fuvR = await pool.query(
      `SELECT COALESCE(SUM(f.total_km),0)::numeric AS total_km,
              COALESCE(SUM(f.motorina_folosit),0)::numeric AS motorina,
              COALESCE(SUM(f.diurna_externa),0)::int AS diurna_ext,
              COALESCE(SUM(f.diurna_interna),0)::int AS diurna_int
       ${FUV_FROM}
       WHERE f.data_completare >= $2 AND f.data_completare < $3`, P
    );

    // EUR↔RON árfolyam (admin állítja) — ezzel számolható eredmény (profit)
    const rateR = await pool.query('SELECT eur_ron_rate FROM companies WHERE id = $1', [cid]);
    const eurRonRate = rateR.rows.length && rateR.rows[0].eur_ron_rate != null
      ? parseFloat(rateR.rows[0].eur_ron_rate) : null;

    // Top útvonalak (lezárt fuvarok felrakó → lerakó párjai)
    const utvR = await pool.query(
      `SELECT loc_incarcare, loc_descarcare, COUNT(*)::int AS db,
              COALESCE(AVG(pret),0)::numeric AS atlag_ar,
              COALESCE(SUM(pret),0)::numeric AS bevetel,
              COALESCE(AVG(km),0)::numeric AS atlag_km
       FROM orders
       WHERE company_id=$1 AND status='Finalizat' AND finalized_at >= $2 AND finalized_at < $3
         AND COALESCE(loc_incarcare,'') <> '' AND COALESCE(loc_descarcare,'') <> ''
       GROUP BY loc_incarcare, loc_descarcare
       ORDER BY db DESC, bevetel DESC LIMIT 10`, P
    );

    // Riasztások — túlfogyasztó járművek: tényleges > névleges * 1.15 (min. 300 km,
    // hogy egy-egy rövid menetlevél ne riasszon feleslegesen)
    const alerts = [];
    const overR = await pool.query(
      `SELECT f.numar_camion AS rendszam,
              SUM(f.total_km)::numeric AS km,
              SUM(f.motorina_folosit)::numeric AS motorina,
              MAX(v.fuel_per_100km)::numeric AS nevleges
       ${FUV_FROM}
       JOIN vehicles v ON v.company_id = $1 AND UPPER(v.rendszam) = UPPER(f.numar_camion)
            AND v.fuel_per_100km > 0
       WHERE f.data_completare >= $2 AND f.data_completare < $3
       GROUP BY f.numar_camion
       HAVING SUM(f.total_km) >= 300
          AND (SUM(f.motorina_folosit) / NULLIF(SUM(f.total_km),0)) * 100 > MAX(v.fuel_per_100km) * 1.15`, P
    );
    overR.rows.forEach((v) => {
      const c = (parseFloat(v.motorina) / parseFloat(v.km)) * 100;
      alerts.push({
        type: 'fuel', rendszam: v.rendszam,
        consum: Math.round(c * 10) / 10, nevleges: parseFloat(v.nevleges)
      });
    });

    // Pénzügyi KPI-k csak jogosultsággal (beszedett / kintlévő)
    let finance = null;
    if (await _canSeeFinance(req)) {
      const finR = await pool.query(
        `SELECT COALESCE(SUM(LEAST(paid_amount, pret)),0)::numeric AS beszedett,
                COALESCE(SUM(GREATEST(pret - paid_amount, 0)),0)::numeric AS kintlevo,
                COUNT(*) FILTER (WHERE payment_status <> 'paid' AND pret > 0)::int AS kintlevo_db
         FROM orders
         WHERE company_id=$1 AND status='Finalizat' AND finalized_at >= $2 AND finalized_at < $3`, P
      );
      finance = finR.rows[0];

      // Riasztás: LEJÁRT kintlévőség — az ügyfél fizetési határideje szerint
      // (clients.payment_term_days, alapért. 30 nap); időszaktól független pillanatkép
      const odR = await pool.query(
        `SELECT COUNT(*)::int AS db, COALESCE(SUM(GREATEST(o.pret-o.paid_amount,0)),0)::numeric AS osszeg
         FROM orders o LEFT JOIN clients c ON c.id = o.client_id
         WHERE o.company_id=$1 AND o.status='Finalizat' AND o.payment_status <> 'paid'
           AND o.pret > 0
           AND NOW() > o.finalized_at + COALESCE(c.payment_term_days, 30) * INTERVAL '1 day'`,
        [cid]
      );
      if (odR.rows[0].db > 0) {
        alerts.push({ type: 'overdue', db: odR.rows[0].db, osszeg: odR.rows[0].osszeg });
      }
    }

    const k = kpiR.rows[0];
    const fv = fuvR.rows[0];
    const consum = (parseFloat(fv.total_km) > 0)
      ? Math.round((parseFloat(fv.motorina) / parseFloat(fv.total_km)) * 10000) / 100
      : 0;

    return res.json({ result: {
      ok: true,
      kpi: {
        bevetel: k.bevetel, lezart: k.lezart, osszes: k.osszes, torolt: k.torolt,
        km: k.km, fuvarlevel_km: fv.total_km, consum_100: consum,
        diurna_ext: fv.diurna_ext, diurna_int: fv.diurna_int
      },
      finance,
      eur_ron_rate: eurRonRate,
      top_utvonalak: utvR.rows,
      alerts,
      havi_bevetel: bevR.rows,
      havi_koltseg: ktgR.rows
    }});
  } catch (err) {
    console.error('getStatsOverview hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ── EUR↔RON árfolyam beállítása (csak Admin) ─────────────────
// args: [rate] — szám (pl. 4.97) vagy null/üres = törlés (nincs profit-számítás)
handlers.setEurRonRate = async function (req, res, args) {
  try {
    if (!req.session.user || req.session.user.pozicio !== 'Admin') return _deny(res);
    const cid = req.session.user.company_id;
    const raw = Array.isArray(args) ? args[0] : args;
    let rate = null;
    if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
      rate = parseFloat(raw);
      if (!Number.isFinite(rate) || rate < 0.5 || rate > 20) {
        return res.json({ result: { ok: false, err: 'Érvénytelen árfolyam (0.5–20 között adható meg)' } });
      }
    }
    await pool.query('UPDATE companies SET eur_ron_rate = $1 WHERE id = $2', [rate, cid]);
    return res.json({ result: { ok: true, eur_ron_rate: rate } });
  } catch (err) {
    console.error('setEurRonRate hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ── BNR hivatalos EUR↔RON árfolyam lekérése (segéd a 💱 mezőhöz) ──
// Forrás: a BNR napi XML-je (nyilvános, kulcs nélkül). 1 órás cache.
let _bnrCache = null; // { ts, rate, date }
handlers.getBnrRate = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    if (_bnrCache && Date.now() - _bnrCache.ts < 60 * 60 * 1000) {
      return res.json({ result: { ok: true, rate: _bnrCache.rate, date: _bnrCache.date } });
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    let xml;
    try {
      const r = await fetch('https://www.bnr.ro/nbrfxrates.xml', {
        signal: ctrl.signal, headers: { 'User-Agent': 'VallorSoft/1.0' } });
      xml = await r.text();
    } finally { clearTimeout(t); }
    const m = xml.match(/<Rate[^>]*currency="EUR"[^>]*>([\d.]+)<\/Rate>/i);
    const dm = xml.match(/<Cube[^>]*date="([\d-]+)"/i);
    if (!m) return res.json({ result: { ok: false, err: 'A BNR árfolyam nem olvasható ki.' } });
    const rate = parseFloat(m[1]);
    _bnrCache = { ts: Date.now(), rate, date: dm ? dm[1] : null };
    return res.json({ result: { ok: true, rate, date: _bnrCache.date } });
  } catch (err) {
    console.error('getBnrRate hiba:', err);
    return res.json({ result: { ok: false, err: 'A BNR nem elérhető.' } });
  }
};

// ── Pénzügy (stats-finance) — JOGOSULTSÁGHOZ KÖTÖTT ──────────
handlers.getFinanceStats = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    if (!(await _canSeeFinance(req))) {
      return res.json({ result: { ok: false, err: 'Az admin nem engedélyezte számodra a pénzügyi riportot', forbidden: true } });
    }
    const cid = req.session.user.company_id;
    const { from, to } = _range(args);
    const P = [cid, from, to];

    // Havi: kiszámlázható bevétel (Finalizat) + ténylegesen beszedett (paid_at hónapja)
    const haviR = await pool.query(
      `SELECT TO_CHAR(finalized_at,'YYYY-MM') AS ho,
              SUM(pret)::numeric AS bevetel,
              SUM(LEAST(paid_amount, pret))::numeric AS beszedett
       FROM orders
       WHERE company_id=$1 AND status='Finalizat' AND finalized_at >= $2 AND finalized_at < $3
       GROUP BY ho ORDER BY ho`, P
    );

    // Kintlévőség-öregedés (a finalizálás óta eltelt napok szerint)
    const agingR = await pool.query(
      `SELECT COALESCE(SUM(GREATEST(pret-paid_amount,0)) FILTER (WHERE finalized_at >= NOW() - INTERVAL '30 days'),0)::numeric AS d0_30,
              COALESCE(SUM(GREATEST(pret-paid_amount,0)) FILTER (WHERE finalized_at < NOW() - INTERVAL '30 days' AND finalized_at >= NOW() - INTERVAL '60 days'),0)::numeric AS d31_60,
              COALESCE(SUM(GREATEST(pret-paid_amount,0)) FILTER (WHERE finalized_at < NOW() - INTERVAL '60 days'),0)::numeric AS d60p
       FROM orders
       WHERE company_id=$1 AND status='Finalizat' AND payment_status <> 'paid' AND pret > 0`,
      [cid]
    );

    // Kintlévő fuvarok listája (legrégebbi elöl) — esedékesség az ügyfél
    // fizetési határidejéből (clients.payment_term_days, alapért. 30 nap)
    const listR = await pool.query(
      `SELECT o.id, COALESCE(c.denumire, o.client) AS client, o.pret, o.paid_amount,
              o.payment_status, o.finalized_at,
              EXTRACT(DAY FROM NOW() - o.finalized_at)::int AS napok,
              (o.finalized_at + COALESCE(c.payment_term_days, 30) * INTERVAL '1 day')::date AS esedekes,
              (NOW() > o.finalized_at + COALESCE(c.payment_term_days, 30) * INTERVAL '1 day') AS lejart
       FROM orders o LEFT JOIN clients c ON c.id = o.client_id
       WHERE o.company_id=$1 AND o.status='Finalizat' AND o.payment_status <> 'paid' AND o.pret > 0
       ORDER BY o.finalized_at ASC LIMIT 200`,
      [cid]
    );

    // Mutatók: ár/km + átlagos fizetési idő (finalizálás → utolsó fizetés)
    const mutR = await pool.query(
      `SELECT COALESCE(SUM(pret),0)::numeric AS bevetel,
              COALESCE(SUM(km),0)::numeric AS km,
              AVG(EXTRACT(DAY FROM paid_at - finalized_at)) FILTER (WHERE payment_status='paid' AND paid_at IS NOT NULL) AS atlag_fizetesi_nap
       FROM orders
       WHERE company_id=$1 AND status='Finalizat' AND finalized_at >= $2 AND finalized_at < $3`, P
    );
    const m = mutR.rows[0];
    const perKm = (parseFloat(m.km) > 0)
      ? Math.round((parseFloat(m.bevetel) / parseFloat(m.km)) * 100) / 100 : 0;

    return res.json({ result: {
      ok: true,
      havi: haviR.rows,
      aging: agingR.rows[0],
      kintlevo_lista: listR.rows,
      mutatok: {
        bevetel: m.bevetel, km: m.km, per_km: perKm,
        atlag_fizetesi_nap: m.atlag_fizetesi_nap != null ? Math.round(m.atlag_fizetesi_nap) : null
      }
    }});
  } catch (err) {
    console.error('getFinanceStats hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ── Fuvar-szintű eredmény (Pénzügy fül) — JOGOSULTSÁGHOZ KÖTÖTT ──
// A menetlevél-költségeket (tankolás+vásárlás) a menetlevélen szereplő
// fuvarok között EGYENLŐEN osztjuk szét (fuvarlevelek.order_ids), így
// fuvaronként becsült költség és — árfolyammal — eredmény adódik.
handlers.getOrderProfit = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    if (!(await _canSeeFinance(req))) {
      return res.json({ result: { ok: false, err: 'Nincs jogosultság a pénzügyi riporthoz', forbidden: true } });
    }
    const cid = req.session.user.company_id;
    const { from, to } = _range(args);

    const r = await pool.query(
      `SELECT o.id, COALESCE(c.denumire, o.client) AS client, o.pret, o.km, o.finalized_at,
              COALESCE(SUM(fl.ktg / NULLIF(fl.cnt, 0)), 0)::numeric AS koltseg_ron
       FROM orders o
       LEFT JOIN clients c ON c.id = o.client_id
       LEFT JOIN LATERAL (
         SELECT ((SELECT COALESCE(SUM((a->>'suma')::numeric),0) FROM jsonb_array_elements(f.alimentari) a)
               + (SELECT COALESCE(SUM((x->>'pret')::numeric),0) FROM jsonb_array_elements(f.achizitii) x)) AS ktg,
                jsonb_array_length(f.order_ids) AS cnt
         FROM fuvarlevelek f
         WHERE f.order_ids ? o.id::text
           -- tenant-szűrés: csak a SAJÁT cég sofőrjének menetlevele számítson
           -- (idegen cég sofőrje által beírt azonos fuvar-ID ne szivárogjon be)
           AND EXISTS (SELECT 1 FROM users u2
                       WHERE LOWER(u2.email) = LOWER(f.email_sofer) AND u2.company_id = o.company_id)
       ) fl ON true
       WHERE o.company_id = $1 AND o.status = 'Finalizat'
         AND o.finalized_at >= $2 AND o.finalized_at < $3
       GROUP BY o.id, c.denumire, o.client, o.pret, o.km, o.finalized_at
       ORDER BY o.finalized_at DESC LIMIT 100`,
      [cid, from, to]
    );

    const rateR = await pool.query('SELECT eur_ron_rate FROM companies WHERE id = $1', [cid]);
    const eurRonRate = rateR.rows.length && rateR.rows[0].eur_ron_rate != null
      ? parseFloat(rateR.rows[0].eur_ron_rate) : null;

    return res.json({ result: { ok: true, rows: r.rows, eur_ron_rate: eurRonRate } });
  } catch (err) {
    console.error('getOrderProfit hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ── Fogyasztás (stats-fuel) ──────────────────────────────────
handlers.getFuelStats = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const { from, to } = _range(args);
    const P = [cid, from, to];

    // Havi tankolás (liter + összeg + átlagár), Motorină/AdBlue bontásban
    const haviR = await pool.query(
      `SELECT TO_CHAR(f.data_completare,'YYYY-MM') AS ho,
              COALESCE(a.elem->>'tip','Motorină') AS tip,
              SUM((a.elem->>'litru')::numeric) AS litru,
              SUM((a.elem->>'suma')::numeric) AS suma
       ${FUV_FROM}, jsonb_array_elements(f.alimentari) a(elem)
       WHERE f.data_completare >= $2 AND f.data_completare < $3
       GROUP BY ho, tip ORDER BY ho`, P
    );

    // Járművenkénti tényleges fogyasztás vs. névleges (vehicles.fuel_per_100km)
    const jarmuR = await pool.query(
      `SELECT f.numar_camion AS rendszam,
              SUM(f.total_km)::numeric AS km,
              SUM(f.motorina_folosit)::numeric AS motorina,
              COUNT(*)::int AS menetlevelek,
              MAX(v.fuel_per_100km)::numeric AS nevleges
       ${FUV_FROM}
       LEFT JOIN vehicles v ON v.company_id = $1 AND UPPER(v.rendszam) = UPPER(f.numar_camion)
       WHERE f.data_completare >= $2 AND f.data_completare < $3 AND f.numar_camion IS NOT NULL AND f.numar_camion <> ''
       GROUP BY f.numar_camion ORDER BY km DESC`, P
    );

    // Fizetési mód megoszlás (tankolások)
    const plataR = await pool.query(
      `SELECT COALESCE(NULLIF(a.elem->>'plata',''),'?') AS plata,
              COUNT(*)::int AS db, SUM((a.elem->>'suma')::numeric) AS suma
       ${FUV_FROM}, jsonb_array_elements(f.alimentari) a(elem)
       WHERE f.data_completare >= $2 AND f.data_completare < $3
       GROUP BY plata ORDER BY suma DESC NULLS LAST`, P
    );

    // Tankolási lista (legutóbbi 100)
    const listaR = await pool.query(
      `SELECT f.data_completare, f.nume_sofer, f.numar_camion,
              a.elem->>'loc' AS loc, COALESCE(a.elem->>'tip','Motorină') AS tip,
              (a.elem->>'litru')::numeric AS litru, (a.elem->>'km')::numeric AS km,
              a.elem->>'plata' AS plata, (a.elem->>'suma')::numeric AS suma
       ${FUV_FROM}, jsonb_array_elements(f.alimentari) a(elem)
       WHERE f.data_completare >= $2 AND f.data_completare < $3
       ORDER BY f.data_completare DESC LIMIT 100`, P
    );

    return res.json({ result: {
      ok: true, havi: haviR.rows, jarmuvek: jarmuR.rows,
      fizetesi_mod: plataR.rows, lista: listaR.rows
    }});
  } catch (err) {
    console.error('getFuelStats hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ── Vásárlások / kiadások (stats-purchases) ──────────────────
handlers.getPurchaseStats = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const { from, to } = _range(args);
    const P = [cid, from, to];

    const haviR = await pool.query(
      `SELECT TO_CHAR(f.data_completare,'YYYY-MM') AS ho,
              COUNT(*)::int AS db, SUM((c.elem->>'pret')::numeric) AS suma
       ${FUV_FROM}, jsonb_array_elements(f.achizitii) c(elem)
       WHERE f.data_completare >= $2 AND f.data_completare < $3
       GROUP BY ho ORDER BY ho`, P
    );

    const termekR = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(c.elem->>'produs'),''),'?') AS produs,
              COUNT(*)::int AS db, SUM((c.elem->>'pret')::numeric) AS suma
       ${FUV_FROM}, jsonb_array_elements(f.achizitii) c(elem)
       WHERE f.data_completare >= $2 AND f.data_completare < $3
       GROUP BY produs ORDER BY suma DESC NULLS LAST LIMIT 15`, P
    );

    const soferR = await pool.query(
      `SELECT COALESCE(f.nume_sofer, f.email_sofer) AS sofer,
              COUNT(*)::int AS db, SUM((c.elem->>'pret')::numeric) AS suma
       ${FUV_FROM}, jsonb_array_elements(f.achizitii) c(elem)
       WHERE f.data_completare >= $2 AND f.data_completare < $3
       GROUP BY sofer ORDER BY suma DESC NULLS LAST`, P
    );

    const plataR = await pool.query(
      `SELECT COALESCE(NULLIF(c.elem->>'plata',''),'?') AS plata,
              COUNT(*)::int AS db, SUM((c.elem->>'pret')::numeric) AS suma
       ${FUV_FROM}, jsonb_array_elements(f.achizitii) c(elem)
       WHERE f.data_completare >= $2 AND f.data_completare < $3
       GROUP BY plata ORDER BY suma DESC NULLS LAST`, P
    );

    const listaR = await pool.query(
      `SELECT f.data_completare, f.nume_sofer, f.numar_camion,
              c.elem->>'produs' AS produs, c.elem->>'loc' AS loc,
              (c.elem->>'pret')::numeric AS pret, c.elem->>'plata' AS plata
       ${FUV_FROM}, jsonb_array_elements(f.achizitii) c(elem)
       WHERE f.data_completare >= $2 AND f.data_completare < $3
       ORDER BY f.data_completare DESC LIMIT 100`, P
    );

    return res.json({ result: {
      ok: true, havi: haviR.rows, termekek: termekR.rows,
      soforok: soferR.rows, fizetesi_mod: plataR.rows, lista: listaR.rows
    }});
  } catch (err) {
    console.error('getPurchaseStats hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ── Sofőr teljesítmény (stats-drivers) ───────────────────────
handlers.getDriverStats = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const { from, to } = _range(args);
    const P = [cid, from, to];

    // Fuvar-oldal: bevétel/fuvarszám/km a fuvarokból (belső sofőrök, email szerint)
    const ordR = await pool.query(
      `SELECT LOWER(email_sofer) AS email, MAX(nume_sofer) AS nume,
              COUNT(*)::int AS fuvarok,
              COUNT(*) FILTER (WHERE status='Finalizat')::int AS lezart,
              COALESCE(SUM(pret) FILTER (WHERE status='Finalizat'),0)::numeric AS bevetel,
              COALESCE(SUM(km),0)::numeric AS km
       FROM orders
       WHERE company_id=$1 AND email_sofer IS NOT NULL AND email_sofer <> ''
         AND created_at >= $2 AND created_at < $3
       GROUP BY LOWER(email_sofer)`, P
    );

    // Menetlevél-oldal: tényleges km, fogyasztás, tankolás-/kiadás-költség, diurna
    const fuvR = await pool.query(
      `SELECT LOWER(f.email_sofer) AS email, MAX(f.nume_sofer) AS nume,
              COUNT(*)::int AS menetlevelek,
              COALESCE(SUM(f.total_km),0)::numeric AS total_km,
              COALESCE(SUM(f.motorina_folosit),0)::numeric AS motorina,
              COALESCE(SUM(f.diurna_externa),0)::int AS diurna_ext,
              COALESCE(SUM(f.diurna_interna),0)::int AS diurna_int,
              COALESCE(SUM((SELECT COALESCE(SUM((a->>'suma')::numeric),0) FROM jsonb_array_elements(f.alimentari) a)),0) AS uzemanyag_ktg,
              COALESCE(SUM((SELECT COALESCE(SUM((c->>'pret')::numeric),0) FROM jsonb_array_elements(f.achizitii) c)),0) AS vasarlas_ktg
       ${FUV_FROM}
       WHERE f.data_completare >= $2 AND f.data_completare < $3
       GROUP BY LOWER(f.email_sofer)`, P
    );

    // Összefésülés email szerint
    const map = new Map();
    ordR.rows.forEach((r) => map.set(r.email, Object.assign({
      menetlevelek: 0, total_km: 0, motorina: 0, diurna_ext: 0, diurna_int: 0,
      uzemanyag_ktg: 0, vasarlas_ktg: 0
    }, r)));
    fuvR.rows.forEach((r) => {
      const cur = map.get(r.email) || { email: r.email, nume: r.nume, fuvarok: 0, lezart: 0, bevetel: 0, km: 0 };
      Object.assign(cur, {
        nume: cur.nume || r.nume,
        menetlevelek: r.menetlevelek, total_km: r.total_km, motorina: r.motorina,
        diurna_ext: r.diurna_ext, diurna_int: r.diurna_int,
        uzemanyag_ktg: r.uzemanyag_ktg, vasarlas_ktg: r.vasarlas_ktg
      });
      map.set(r.email, cur);
    });
    const soforok = [...map.values()].map((s) => {
      const tkm = parseFloat(s.total_km) || 0;
      s.consum_100 = tkm > 0 ? Math.round((parseFloat(s.motorina) / tkm) * 10000) / 100 : 0;
      return s;
    }).sort((a, b) => (parseFloat(b.bevetel) || 0) - (parseFloat(a.bevetel) || 0));

    // Árfolyam — a kliens ezzel számol Eredmény (EUR) oszlopot
    const rateR = await pool.query('SELECT eur_ron_rate FROM companies WHERE id = $1', [cid]);
    const eurRonRate = rateR.rows.length && rateR.rows[0].eur_ron_rate != null
      ? parseFloat(rateR.rows[0].eur_ron_rate) : null;

    return res.json({ result: { ok: true, soforok, eur_ron_rate: eurRonRate } });
  } catch (err) {
    console.error('getDriverStats hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ── Jármű kihasználtság (stats-vehicles) ─────────────────────
handlers.getVehicleStats = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const { from, to } = _range(args);
    const P = [cid, from, to];

    // Fuvar-oldal: fuvarszám / km / bevétel rendszámonként
    const ordR = await pool.query(
      `SELECT UPPER(rendszam_camion) AS rendszam,
              COUNT(*)::int AS fuvarok,
              COUNT(*) FILTER (WHERE status='Finalizat')::int AS lezart,
              COALESCE(SUM(pret) FILTER (WHERE status='Finalizat'),0)::numeric AS bevetel,
              COALESCE(SUM(km),0)::numeric AS km
       FROM orders
       WHERE company_id=$1 AND rendszam_camion IS NOT NULL AND rendszam_camion <> ''
         AND created_at >= $2 AND created_at < $3
       GROUP BY UPPER(rendszam_camion)`, P
    );

    // Menetlevél-oldal: tényleges km + üzemanyag rendszámonként
    const fuvR = await pool.query(
      `SELECT UPPER(f.numar_camion) AS rendszam,
              COALESCE(SUM(f.total_km),0)::numeric AS total_km,
              COALESCE(SUM(f.motorina_folosit),0)::numeric AS motorina,
              COALESCE(SUM((SELECT COALESCE(SUM((a->>'suma')::numeric),0) FROM jsonb_array_elements(f.alimentari) a)),0) AS uzemanyag_ktg
       ${FUV_FROM}
       WHERE f.data_completare >= $2 AND f.data_completare < $3
         AND f.numar_camion IS NOT NULL AND f.numar_camion <> ''
       GROUP BY UPPER(f.numar_camion)`, P
    );

    // Jármű-törzs (vontatók)
    const vehR = await pool.query(
      `SELECT id, UPPER(rendszam) AS rendszam, rendszam AS rendszam_eredeti, marca, model, an, activ,
              fuel_per_100km AS nevleges
       FROM vehicles WHERE company_id=$1 AND tip='Vontato' ORDER BY rendszam`,
      [cid]
    );

    // Szerviz-költség az időszakban (vehicle_service_log — migráció előtt
    // a tábla hiányozhat, ezért védve)
    const szervizByVehId = new Map();
    try {
      const szR = await pool.query(
        `SELECT vehicle_id, COALESCE(SUM(cost_ron),0)::numeric AS ktg
         FROM vehicle_service_log
         WHERE company_id=$1 AND service_date >= $2 AND service_date < $3
         GROUP BY vehicle_id`, P
      );
      szR.rows.forEach((r) => szervizByVehId.set(r.vehicle_id, parseFloat(r.ktg) || 0));
    } catch (_) { /* tábla még nincs migrálva */ }

    const map = new Map();
    vehR.rows.forEach((v) => map.set(v.rendszam, Object.assign({
      fuvarok: 0, lezart: 0, bevetel: 0, km: 0, total_km: 0, motorina: 0, uzemanyag_ktg: 0,
      szerviz_ktg: szervizByVehId.get(v.id) || 0
    }, v)));
    ordR.rows.forEach((r) => {
      const cur = map.get(r.rendszam) || { rendszam: r.rendszam, rendszam_eredeti: r.rendszam, total_km: 0, motorina: 0, uzemanyag_ktg: 0 };
      Object.assign(cur, { fuvarok: r.fuvarok, lezart: r.lezart, bevetel: r.bevetel, km: r.km });
      map.set(r.rendszam, cur);
    });
    fuvR.rows.forEach((r) => {
      const cur = map.get(r.rendszam) || { rendszam: r.rendszam, rendszam_eredeti: r.rendszam, fuvarok: 0, lezart: 0, bevetel: 0, km: 0 };
      Object.assign(cur, { total_km: r.total_km, motorina: r.motorina, uzemanyag_ktg: r.uzemanyag_ktg });
      map.set(r.rendszam, cur);
    });
    const jarmuvek = [...map.values()].map((v) => {
      const tkm = parseFloat(v.total_km) || 0;
      v.consum_100 = tkm > 0 ? Math.round((parseFloat(v.motorina) / tkm) * 10000) / 100 : 0;
      const bev = parseFloat(v.bevetel) || 0;
      const okm = parseFloat(v.km) || 0;
      v.bevetel_per_km = okm > 0 ? Math.round((bev / okm) * 100) / 100 : 0;
      return v;
    }).sort((a, b) => (parseFloat(b.bevetel) || 0) - (parseFloat(a.bevetel) || 0));

    // Árfolyam — a kliens ezzel számol Eredmény (EUR) oszlopot
    const rateR = await pool.query('SELECT eur_ron_rate FROM companies WHERE id = $1', [cid]);
    const eurRonRate = rateR.rows.length && rateR.rows[0].eur_ron_rate != null
      ? parseFloat(rateR.rows[0].eur_ron_rate) : null;

    return res.json({ result: { ok: true, jarmuvek, eur_ron_rate: eurRonRate } });
  } catch (err) {
    console.error('getVehicleStats hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ── Ügyfél riport (stats-clients) ────────────────────────────
handlers.getClientStats = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const { from, to } = _range(args);
    const finance = await _canSeeFinance(req);

    // Ügyfél = clients-link ha van, különben a szabad-szöveges orders.client
    const r = await pool.query(
      `SELECT COALESCE(c.denumire, NULLIF(TRIM(o.client),''), '?') AS ugyfel,
              MAX(c.cui_cif) AS cui_cif, MAX(c.anaf_status) AS anaf_status,
              COUNT(*)::int AS fuvarok,
              COUNT(*) FILTER (WHERE o.status='Finalizat')::int AS lezart,
              COALESCE(SUM(o.pret) FILTER (WHERE o.status='Finalizat'),0)::numeric AS bevetel,
              COALESCE(SUM(o.km),0)::numeric AS km,
              COALESCE(SUM(GREATEST(o.pret - o.paid_amount,0)) FILTER (WHERE o.status='Finalizat' AND o.payment_status <> 'paid'),0)::numeric AS kintlevo,
              AVG(EXTRACT(DAY FROM o.paid_at - o.finalized_at)) FILTER (WHERE o.payment_status='paid' AND o.paid_at IS NOT NULL) AS atlag_fizetesi_nap
       FROM orders o LEFT JOIN clients c ON c.id = o.client_id
       WHERE o.company_id=$1 AND o.created_at >= $2 AND o.created_at < $3
       GROUP BY ugyfel
       ORDER BY bevetel DESC LIMIT 100`,
      [cid, from, to]
    );

    const ugyfelek = r.rows.map((u) => {
      u.atlag_fizetesi_nap = u.atlag_fizetesi_nap != null ? Math.round(u.atlag_fizetesi_nap) : null;
      if (!finance) { u.kintlevo = null; u.atlag_fizetesi_nap = null; } // pénzügyi oszlopok csak engedéllyel
      return u;
    });

    return res.json({ result: { ok: true, finance, ugyfelek } });
  } catch (err) {
    console.error('getClientStats hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ── Sofőr mini-statisztika (a sofőr SAJÁT, e havi adatai) ────
// A sofőr mobilfelület főoldalán jelenik meg — motivációs összegző.
handlers.getMySoferStats = async function (req, res, args) {
  try {
    if (!req.session.user || req.session.user.pozicio !== 'Sofer') return _deny(res);
    const me = req.session.user;

    // Lezárt fuvarok e hónapban (a sofőr saját email-jére kiosztottak)
    const ordR = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status='Finalizat' AND finalized_at >= DATE_TRUNC('month', NOW()))::int AS lezart,
              COUNT(*) FILTER (WHERE status IN ('Alocat','In Curs'))::int AS aktiv
       FROM orders
       WHERE company_id = $1 AND LOWER(email_sofer) = LOWER($2)`,
      [me.company_id, me.email]
    );

    // Saját menetlevelek e hónapban: km, diurna, tankolt liter
    const fuvR = await pool.query(
      `SELECT COUNT(*)::int AS menetlevelek,
              COALESCE(SUM(total_km),0)::numeric AS km,
              COALESCE(SUM(diurna_externa),0)::int AS diurna_ext,
              COALESCE(SUM(diurna_interna),0)::int AS diurna_int,
              COALESCE(SUM((SELECT COALESCE(SUM((a->>'litru')::numeric),0)
                            FROM jsonb_array_elements(alimentari) a)),0) AS tankolt_l
       FROM fuvarlevelek
       WHERE LOWER(email_sofer) = LOWER($1)
         AND data_completare >= DATE_TRUNC('month', NOW())`,
      [me.email]
    );

    const o = ordR.rows[0], f = fuvR.rows[0];
    return res.json({ result: {
      ok: true,
      honap: new Date().toISOString().slice(0, 7),
      lezart: o.lezart, aktiv: o.aktiv,
      km: f.km, menetlevelek: f.menetlevelek,
      diurna_ext: f.diurna_ext, diurna_int: f.diurna_int,
      tankolt_l: f.tankolt_l
    }});
  } catch (err) {
    console.error('getMySoferStats hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// ── GPS flotta-pillanatkép (CargoTrack v2: üzemanyag + km-óra) ──
// A /coordinates v2 válasz calculated_inputs mezőit jelenítjük meg:
// fuel_level (tartályszint), fuel_consumption, mileage (GPS km-óra), rpm.
const _gpsCache = new Map(); // company_id -> { ts, payload }
const GPS_CACHE_MS = 60 * 1000;

handlers.getGpsFleetSnapshot = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;

    const cached = _gpsCache.get(cid);
    if (cached && Date.now() - cached.ts < GPS_CACHE_MS) {
      return res.json({ result: cached.payload });
    }

    const keyR = await pool.query(
      `SELECT credentials_enc, enabled FROM company_integrations
       WHERE company_id = $1 AND provider = 'cargotrack'`,
      [cid]
    );
    if (!keyR.rows.length || !keyR.rows[0].credentials_enc || !keyR.rows[0].enabled) {
      return res.json({ result: { ok: true, gps_configured: false, vehicles: [] } });
    }
    const apiKey = decrypt(keyR.rows[0].credentials_enc);

    const mapR = await pool.query(
      `SELECT rendszam, object_id, object_name FROM vehicle_gps_map
       WHERE company_id = $1 AND provider = 'cargotrack'`,
      [cid]
    );
    if (!mapR.rows.length) {
      return res.json({ result: { ok: true, gps_configured: true, vehicles: [] } });
    }

    const byObjectId = new Map();
    for (const m of mapR.rows) if (!byObjectId.has(m.object_id)) byObjectId.set(m.object_id, m);

    const settled = await Promise.allSettled(
      [...byObjectId.values()].map(async (m) => {
        const st = await ctSvc.getLatestStatus(apiKey, m.object_id);
        if (!st) return null;
        return {
          rendszam: m.rendszam,
          object_name: m.object_name || m.rendszam,
          datetime: st.datetime,
          ignition: st.ignition,
          speed: st.speed,
          fuel_level: st.fuel_level,
          fuel_consumption: st.fuel_consumption,
          mileage: st.mileage,
          rpm: st.rpm,
        };
      })
    );
    const vehicles = settled
      .filter((r) => r.status === 'fulfilled' && r.value)
      .map((r) => r.value);

    const payload = { ok: true, gps_configured: true, vehicles };
    _gpsCache.set(cid, { ts: Date.now(), payload });
    return res.json({ result: payload });
  } catch (err) {
    console.error('getGpsFleetSnapshot hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

module.exports = handlers;
