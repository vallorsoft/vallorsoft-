// ============================================================
//  VallorSoft — handlers/globalSearch.js
//  Globális kereső a felső sávi kereséshez (CSAK szerver-oldal).
//  Hívás: handlers.globalSearch(req, res, args)
//  Válasz: res.json({ result: { ok, groups:[{key,label,items:[{id,title,subtitle,tab}]}] } })
//
//  Konvenciók: paraméteres SQL, multi-tenant company_id-szűrés, szerep-kapu
//  (orders + sofőrök csak Admin/Manager). Minden lekérdezés best-effort:
//  ha egy tábla/oszlop hiányzik, az adott kategória üres marad (nem buktat).
// ============================================================
const pool = require('../db');

const handlers = {};

// Egy kategória találatainak normalizálása groups-elemmé (csak ha van találat).
function pushGroup(groups, key, label, tab, rows, mapFn) {
  if (!rows || !rows.length) return;
  const items = rows.map((r) => Object.assign({ tab }, mapFn(r)));
  groups.push({ key, label, items });
}

handlers.globalSearch = async function (req, res, args) {
  try {
    // Bejelentkezett felhasználó kötelező (multi-tenant + szerep).
    if (!req.session || !req.session.user) {
      return res.json({ result: { ok: false } });
    }
    const cid = req.session.user.company_id;
    const role = req.session.user.pozicio;
    const isStaff = ['Admin', 'Manager'].includes(role);

    // Keresőszöveg — tömb-arg vagy sima string is jöhet.
    const q = (Array.isArray(args) ? args[0] : (args || '')).toString().trim();
    if (q.length < 2) {
      return res.json({ result: { ok: true, groups: [] } });
    }
    // ILIKE minta: a $2 paraméter maga a keresőszöveg, a % SQL-ben fűződik hozzá.
    const like = q;

    // ── Fuvarok (csak Admin/Manager) ──────────────────────────
    const ordersP = isStaff
      ? pool.query(
          `SELECT id, client, loc_incarcare, loc_descarcare, status, rendszam_camion
             FROM orders
            WHERE company_id = $1
              AND (id ILIKE '%'||$2||'%' OR client ILIKE '%'||$2||'%'
                   OR loc_incarcare ILIKE '%'||$2||'%' OR loc_descarcare ILIKE '%'||$2||'%'
                   OR rendszam_camion ILIKE '%'||$2||'%' OR ref ILIKE '%'||$2||'%')
            ORDER BY created_at DESC
            LIMIT 6`,
          [cid, like]
        ).catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] });

    // ── Ügyfelek ──────────────────────────────────────────────
    const clientsP = pool.query(
      `SELECT id, denumire, cui_cif, email
         FROM clients
        WHERE company_id = $1
          AND (denumire ILIKE '%'||$2||'%' OR cui_cif ILIKE '%'||$2||'%' OR email ILIKE '%'||$2||'%')
        LIMIT 6`,
      [cid, like]
    ).catch(() => ({ rows: [] }));

    // ── Járművek ──────────────────────────────────────────────
    const vehiclesP = pool.query(
      `SELECT id, rendszam, marca, tip
         FROM vehicles
        WHERE company_id = $1
          AND (rendszam ILIKE '%'||$2||'%' OR marca ILIKE '%'||$2||'%')
        LIMIT 6`,
      [cid, like]
    ).catch(() => ({ rows: [] }));

    // ── Sofőrök (belső userek, csak Admin/Manager) ────────────
    const usersP = isStaff
      ? pool.query(
          `SELECT id, nume, email, pozicio
             FROM users
            WHERE company_id = $1
              AND pozicio_dev IS NOT TRUE
              AND (nume ILIKE '%'||$2||'%' OR email ILIKE '%'||$2||'%')
            LIMIT 6`,
          [cid, like]
        ).catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] });

    // ── Külső sofőrök (ha létezik a tábla) ────────────────────
    const externalP = pool.query(
      `SELECT id, nume, telefon, email
         FROM external_drivers
        WHERE company_id = $1
          AND (nume ILIKE '%'||$2||'%' OR telefon ILIKE '%'||$2||'%')
        LIMIT 6`,
      [cid, like]
    ).catch(() => ({ rows: [] }));

    const [orders, clients, vehicles, users, externals] = await Promise.all([
      ordersP, clientsP, vehiclesP, usersP, externalP,
    ]);

    const groups = [];

    pushGroup(groups, 'orders', 'Fuvarok', 'orders-list', orders.rows, (r) => ({
      id: r.id,
      title: r.id,
      subtitle: [
        r.client || '',
        (r.loc_incarcare || '') + '→' + (r.loc_descarcare || ''),
        '(' + (r.status || '') + ')',
      ].filter(Boolean).join(' · '),
    }));

    pushGroup(groups, 'clients', 'Ügyfelek', 'clients', clients.rows, (r) => ({
      id: r.id,
      title: r.denumire,
      subtitle: r.cui_cif || r.email || '',
    }));

    pushGroup(groups, 'vehicles', 'Járművek', 'vehicles', vehicles.rows, (r) => ({
      id: r.id,
      title: r.rendszam,
      subtitle: r.marca || '',
    }));

    pushGroup(groups, 'users', 'Sofőrök', 'users', users.rows, (r) => ({
      id: r.id,
      title: r.nume,
      subtitle: r.email || '',
    }));

    pushGroup(groups, 'external_drivers', 'Külső sofőrök', 'external-drivers', externals.rows, (r) => ({
      id: r.id,
      title: r.nume,
      subtitle: r.telefon || r.email || '',
    }));

    return res.json({ result: { ok: true, groups } });
  } catch (e) {
    console.error('globalSearch hiba:', e);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
