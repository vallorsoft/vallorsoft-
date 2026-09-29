// ============================================================
//  VallorSoft — Munkamenet-újraellenőrzés (session revalidation)
//
//  Gond: a szerepkör (pozicio), a cég és a jogosultság a belépéskor a
//  session-be íródott, és 7 napig SOHA nem ellenőrződött újra. Így:
//    - a LETILTOTT (blocked) vagy TÖRÖLT felhasználó a meglévő session-nel
//      tovább dolgozhatott (akár 7 napig);
//    - a LEFOKOZOTT Admin (pl. Admin → Sofer) megtartotta az Admin-jogot;
//    - a lemondott/lejárt előfizetésű cég felhasználói bent maradtak;
//    - jelszó-csere/-reset után a többi (pl. ellopott) session élve maradt;
//    - a portál/alvállalkozó-belépő letiltása (activ=false) sem hatott.
//
//  Megoldás: REVALIDATE_MS-enként (alap 60 mp) egy olcsó, PK-alapú lekérdezés
//  frissíti a session-t a DB-ből; érvénytelen állapotnál a session-szerep
//  törlődik → a requireLogin/pageGuard a szokott módon 401-et / login-
//  átirányítást ad. DB-hiba esetén FAIL-OPEN (átmeneti hiba ne zárjon ki
//  mindenkit) — a következő kérésnél újrapróbálja.
// ============================================================
const crypto = require('crypto');
const pool = require('../db');

const REVALIDATE_MS = Math.max(5000, parseInt(process.env.SESSION_REVALIDATE_MS, 10) || 60 * 1000);

// Jelszó-ujjlenyomat: a hash-ből származtatott rövid érték — ha a jelszó
// megváltozik (csere / reset / admin-beállítás), minden régi session kiesik.
function pwFingerprint(passwordHash) {
  if (!passwordHash) return null;
  return crypto.createHash('sha256').update(String(passwordHash)).digest('hex').slice(0, 16);
}

function _companyBlocked(c) {
  if (!c) return false;
  if (c.subscription_status === 'inactive' || c.subscription_status === 'cancelled') return true;
  if (c.paid_until && new Date(c.paid_until) < new Date()) return true;
  return false;
}

async function _checkUser(req) {
  const u = req.session.user;
  const r = await pool.query(
    `SELECT u.id, u.nume, u.email, u.pozicio, u.company_id, u.pozicio_dev, u.blocked,
            u.password_hash, c.subscription_status, c.paid_until
       FROM users u LEFT JOIN companies c ON c.id = u.company_id
      WHERE u.id = $1`, [u.id]);
  const row = r.rows[0];
  const dev = !!(row && row.pozicio_dev);
  const reason =
    !row ? 'deleted' :
    (row.blocked && !dev) ? 'blocked' :
    (!dev && row.company_id && _companyBlocked(row)) ? 'subscription' :
    (u.pwf && pwFingerprint(row.password_hash) !== u.pwf) ? 'password-changed' : null;
  if (reason) {
    req.session.user = null;
    req.sessionRevokedReason = reason;
    return;
  }
  // Friss adat a session-be (lefokozás / cég-áthelyezés / névváltás azonnal hat).
  u.pozicio = row.pozicio;
  u.company_id = row.company_id;
  u.is_dev = dev;
  u.nume = row.nume;
  u.email = row.email;
  if (!u.pwf) u.pwf = pwFingerprint(row.password_hash);   // régi session: most kap ujjlenyomatot
}

async function _checkPortal(req, key, table) {
  const pu = req.session[key];
  const r = await pool.query(`SELECT activ FROM ${table} WHERE id = $1 AND company_id = $2`,
    [pu.id, pu.company_id]);
  if (!r.rows.length || r.rows[0].activ === false) req.session[key] = null;
}

async function sessionRevalidate(req, res, next) {
  const s = req.session;
  if (!s || (!s.user && !s.clientUser && !s.carrierUser)) return next();
  const now = Date.now();
  if (s._revalAt && now - s._revalAt < REVALIDATE_MS) return next();
  try {
    if (s.user && s.user.id) await _checkUser(req);
    if (s.clientUser && s.clientUser.id) await _checkPortal(req, 'clientUser', 'client_users');
    if (s.carrierUser && s.carrierUser.id) await _checkPortal(req, 'carrierUser', 'carrier_users');
    s._revalAt = now;
  } catch (e) {
    // Fail-open: átmeneti DB-hiba ne jelentkeztessen ki mindenkit.
    console.warn('session-revalidate hiba (fail-open):', e && e.message);
  }
  next();
}

// Session-fixation védelem: belépéskor ÚJ session-azonosító. A régi session
// (és benne esetleg egy támadó által előre ültetett azonosító) érvénytelenné
// válik. A megőrzendő mezőket a hívó adja át. Tesztkörnyezetben (mock session
// regenerate nélkül) egyszerűen továbblép.
function regenerateSession(req, keep) {
  return new Promise((resolve) => {
    if (!req.session || typeof req.session.regenerate !== 'function') {
      if (req.session && keep) Object.assign(req.session, keep);
      return resolve();
    }
    req.session.regenerate((err) => {
      if (err) console.warn('session regenerate hiba:', err.message);
      if (keep && req.session) Object.assign(req.session, keep);
      resolve();
    });
  });
}

module.exports = { sessionRevalidate, regenerateSession, pwFingerprint, REVALIDATE_MS };
