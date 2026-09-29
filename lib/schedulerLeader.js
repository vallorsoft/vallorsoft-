// ============================================================
//  VallorSoft — Ütemező vezető-választás (leader election)
//
//  Gond: Fly.io-n több gép (machine) futhat egyszerre; a server.js
//  eddig MINDEN példányon elindította az összes ütemezőt → duplikált
//  e-mailek (trial-emlékeztető, fizetési értesítő, reggeli összefoglaló,
//  riportok), duplikált push-ok és kétszeres IMAP-feldolgozás.
//
//  Megoldás: DB-alapú BÉRLET (lease) a `scheduler_leader` táblában.
//  Nem pg advisory lock — az PgBouncer/Neon-pooler (tranzakciós mód)
//  mögött megbízhatatlan (a zár egy megosztott szerver-kapcsolaton
//  ragadhat). A bérlet bármilyen pooler mögött működik:
//    - a vezető ~LEASE_RENEW_MS-enként megújítja (expires_at = NOW()+TTL);
//    - ha a vezető leáll, a bérlete lejár, és egy másik példány átveszi.
//  Csak a vezető indítja el az ütemezőket (egyszer).
//
//  Fail-open: ha a tábla még nincs (első deploy, migráció előtt) vagy
//  SCHEDULER_LEADER=off, a példány vezetőként viselkedik (= régi működés).
// ============================================================
const os = require('os');
const crypto = require('crypto');

const LEASE_TTL_SEC = 90;
const LEASE_RENEW_MS = 30 * 1000;
const NAME = 'main';

// Egyedi példány-azonosító (Fly: FLY_MACHINE_ID; egyébként host+pid+véletlen).
const HOLDER = (process.env.FLY_MACHINE_ID || os.hostname()) + ':' + process.pid + ':' +
  crypto.randomBytes(3).toString('hex');

let _isLeader = false;
let _started = false;

function isLeader() { return _isLeader; }
function holderId() { return HOLDER; }

// Egy bérlet-kísérlet. true = mi vagyunk a vezető (megszereztük/megújítottuk).
async function tryAcquire(pool) {
  const r = await pool.query(
    `INSERT INTO scheduler_leader (name, holder, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval)
     ON CONFLICT (name) DO UPDATE
       SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
       WHERE scheduler_leader.holder = EXCLUDED.holder
          OR scheduler_leader.expires_at < NOW()
     RETURNING holder`,
    [NAME, HOLDER, String(LEASE_TTL_SEC)]
  );
  return r.rows.length > 0 && r.rows[0].holder === HOLDER;
}

// Elindítja a vezető-választást; a `start` callback PONTOSAN EGYSZER fut le,
// amikor ez a példány vezetővé válik.
function runWhenLeader(pool, start, opts) {
  opts = opts || {};
  const log = opts.log || console;
  const mode = String(process.env.SCHEDULER_LEADER || 'on').toLowerCase();

  const fire = () => {
    if (_started) return;
    _started = true;
    try { start(); } catch (e) { log.error('Ütemező-indítás hiba:', e && e.message); }
  };

  if (mode === 'off' || mode === 'false' || mode === '0') {
    _isLeader = true;
    fire();
    return { stop() {} };
  }

  let timer = null;
  const tick = async () => {
    try {
      const got = await tryAcquire(pool);
      if (got && !_isLeader) log.log('Ütemező-vezető: ez a példány (' + HOLDER + ')');
      if (!got && _isLeader) log.warn('Ütemező-vezető: a bérletet másik példány vette át (' + HOLDER + ')');
      _isLeader = got;
      if (got) fire();
    } catch (e) {
      // Tábla hiányzik (42P01) → régi viselkedés (egypéldányos üzem feltételezve).
      if (e && e.code === '42P01') {
        _isLeader = true;
        fire();
      } else {
        // Átmeneti DB-hiba: a már futó vezető marad vezető; új nem indul.
        log.warn('Ütemező-vezető bérlet-hiba:', e && e.message);
      }
    }
  };
  tick();
  timer = setInterval(tick, LEASE_RENEW_MS);
  if (timer.unref) timer.unref();
  return { stop() { clearInterval(timer); } };
}

// Leálláskor (SIGTERM) a bérletet elengedjük → a másik példány azonnal átveheti.
async function release(pool) {
  if (!_isLeader) return;
  try {
    await pool.query('DELETE FROM scheduler_leader WHERE name = $1 AND holder = $2', [NAME, HOLDER]);
  } catch (_) { /* best-effort */ }
  _isLeader = false;
}

// Teszthez: állapot visszaállítása.
function _reset() { _isLeader = false; _started = false; }

module.exports = { runWhenLeader, tryAcquire, release, isLeader, holderId, _reset, LEASE_TTL_SEC };
