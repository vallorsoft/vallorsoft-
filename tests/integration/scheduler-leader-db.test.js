// ============================================================
//  Ütemező vezető-választás (lib/schedulerLeader.js) — VALÓDI Postgres.
//  Két „példány" versenyez: egyszerre csak egy vezető; lejárt bérletet
//  a másik átveszi; release után azonnal átvehető.
// ============================================================
const { hasDb } = require('../helpers/real-db');
const d = hasDb() ? describe : describe.skip;

d('schedulerLeader (valódi DB)', () => {
  let pool, leader;
  beforeAll(async () => {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(require('fs').readFileSync(require('path').join(__dirname, '../../db/scheduler-leader.sql'), 'utf8'));
    leader = require('../../lib/schedulerLeader');
  });
  beforeEach(async () => { await pool.query('DELETE FROM scheduler_leader'); leader._reset(); });
  afterAll(async () => { await pool.end(); });

  test('első példány megszerzi, a másik (idegen holder) nem', async () => {
    expect(await leader.tryAcquire(pool)).toBe(true);
    // Idegen példány szimulálása: a sort egy másik holderre írjuk, érvényes bérlettel.
    await pool.query(`UPDATE scheduler_leader SET holder='other:1', expires_at=NOW()+interval '60 seconds'`);
    expect(await leader.tryAcquire(pool)).toBe(false);
  });

  test('lejárt idegen bérletet átvesz', async () => {
    await pool.query(`INSERT INTO scheduler_leader (name, holder, expires_at) VALUES ('main','dead:1', NOW()-interval '1 second')`);
    expect(await leader.tryAcquire(pool)).toBe(true);
    const r = await pool.query('SELECT holder FROM scheduler_leader');
    expect(r.rows[0].holder).toBe(leader.holderId());
  });

  test('saját bérlet megújítható; release után törlődik', async () => {
    const log = { log() {}, warn() {}, error() {} };
    const start = jest.fn();
    const h = leader.runWhenLeader(pool, start, { log });
    await new Promise((r) => setTimeout(r, 200));
    h.stop();
    expect(start).toHaveBeenCalledTimes(1);
    expect(leader.isLeader()).toBe(true);
    expect(await leader.tryAcquire(pool)).toBe(true);   // megújítás
    await leader.release(pool);
    const r = await pool.query('SELECT COUNT(*)::int n FROM scheduler_leader');
    expect(r.rows[0].n).toBe(0);
  });
});

describe('schedulerLeader (mock) — fail-open', () => {
  test('hiányzó tábla (42P01) → vezetőként indul (régi viselkedés)', async () => {
    const leader = require('../../lib/schedulerLeader');
    leader._reset();
    const err = Object.assign(new Error('relation does not exist'), { code: '42P01' });
    const pool = { query: jest.fn().mockRejectedValue(err) };
    const start = jest.fn();
    const h = leader.runWhenLeader(pool, start, { log: { log() {}, warn() {}, error() {} } });
    await new Promise((r) => setTimeout(r, 20));
    h.stop();
    expect(start).toHaveBeenCalledTimes(1);
  });

  test('átmeneti DB-hiba → NEM indít (másik példány lehet a vezető)', async () => {
    const leader = require('../../lib/schedulerLeader');
    leader._reset();
    const pool = { query: jest.fn().mockRejectedValue(new Error('timeout')) };
    const start = jest.fn();
    const h = leader.runWhenLeader(pool, start, { log: { log() {}, warn() {}, error() {} } });
    await new Promise((r) => setTimeout(r, 20));
    h.stop();
    expect(start).not.toHaveBeenCalled();
  });
});
