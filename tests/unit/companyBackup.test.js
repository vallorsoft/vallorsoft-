// ============================================================
//  Unit-teszt — cégenkénti Google Drive biztonsági mentés
//  (lib/backupFile, services/companyBackup, lib/googleDrive, handlers/backup)
//  Mock DB-vel — éles DB és Google nem kell.
// ============================================================
process.env.INTEGRATION_ENC_KEY = process.env.INTEGRATION_ENC_KEY || 'a'.repeat(64);
jest.mock('../../db', () => require('../helpers/db-mock').pool);
jest.mock('../../lib/audit', () => ({ fromReq: async () => {} }));
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: async () => true }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pool, rows, reset } = require('../helpers/db-mock');
const bf = require('../../lib/backupFile');
const svc = require('../../services/companyBackup');
const drive = require('../../lib/googleDrive');
const H = require('../../handlers/backup');

const tmp = (n) => path.join(os.tmpdir(), 'vsbk-test-' + process.pid + '-' + n + '.vsbk');
function call(fn, user, args) {
  return new Promise((resolve) => { fn({ session: { user } }, { json: (p) => resolve(p.result) }, args); });
}
beforeEach(() => reset());

describe('lib/backupFile — titkosított formátum', () => {
  test('körüljárás: írás → olvasás, bytea Bufferként $b64-ben', async () => {
    const p = tmp('rt');
    const key = bf.companyKey(5);
    const w = bf.createWriter(p, key);
    await w.writeLine({ type: 'meta', company_id: 5 });
    await w.writeLine({ t: 'orders', r: { id: 'CMD-1', pdf: Buffer.from('hello') } });
    await w.writeLine({ type: 'end' });
    const { size } = await w.close();
    expect(size).toBeGreaterThan(20);
    const raw = fs.readFileSync(p);
    expect(raw.subarray(0, 4).toString()).toBe('VSBK');
    expect(raw.includes(Buffer.from('CMD-1'))).toBe(false); // nem olvasható nyíltan
    const lines = [];
    await bf.readFile(p, key, (l) => lines.push(l));
    expect(lines).toHaveLength(3);
    expect(lines[1].r.pdf.$b64).toBe(Buffer.from('hello').toString('base64'));
    fs.unlinkSync(p);
  });

  test('másik cég kulcsával nem fejthető vissza; módosított fájl elutasítva', async () => {
    const p = tmp('x');
    const w = bf.createWriter(p, bf.companyKey(1));
    for (let i = 0; i < 50; i++) await w.writeLine({ t: 'x', r: { i } });
    await w.close();
    await expect(bf.readFile(p, bf.companyKey(2), () => {})).rejects.toThrow();
    const buf = fs.readFileSync(p); buf[30] ^= 0xff; fs.writeFileSync(p, buf);
    await expect(bf.readFile(p, bf.companyKey(1), () => {})).rejects.toThrow();
    fs.unlinkSync(p);
  });

  test('cégenként eltérő, de determinisztikus kulcs', () => {
    expect(bf.companyKey(1).equals(bf.companyKey(1))).toBe(true);
    expect(bf.companyKey(1).equals(bf.companyKey(2))).toBe(false);
  });
});

describe('időzítés (Europe/Bucharest)', () => {
  // 2026-11-06 00:30 UTC = 02:30 Bukarest (téli idő, UTC+2)
  const now = new Date(Date.UTC(2026, 10, 6, 0, 30));
  test('bucharestParts', () => {
    expect(svc.bucharestParts(now)).toEqual({ date: '2026-11-06', hour: 2 });
  });
  test('isDue: óra előtt nem, után igen; ma már futott → nem', () => {
    expect(svc.isDue(3, null, now)).toBe(false);
    expect(svc.isDue(2, null, now)).toBe(true);
    expect(svc.isDue(1, new Date(Date.UTC(2026, 10, 5, 0, 0)), now)).toBe(true);   // tegnap futott
    expect(svc.isDue(1, new Date(Date.UTC(2026, 10, 5, 23, 10)), now)).toBe(false); // 01:10 bukaresti ma
  });
  test('fájlnév', () => {
    expect(svc.backupFileName(9, new Date(Date.UTC(2026, 0, 2, 3, 4)))).toBe('vallorsoft-backup-c9-20260102-0304.vsbk');
  });
});

describe('mit mentünk', () => {
  test('discoverTables: company_id / order_id / email_sofer hatókör, rendszer-táblák kihagyva', async () => {
    pool.query.mockResolvedValueOnce(rows([
      { table_name: 'orders', column_name: 'company_id' }, { table_name: 'orders', column_name: 'id' },
      { table_name: 'order_x', column_name: 'order_id' },
      { table_name: 'border_crossings', column_name: 'email_sofer' }, { table_name: 'border_crossings', column_name: 'id' },
      { table_name: 'session', column_name: 'company_id' },
      { table_name: 'company_backup_runs', column_name: 'company_id' },
      { table_name: 'geo_cache', column_name: 'id' },
    ]));
    const specs = await svc.discoverTables(pool);
    const by = Object.fromEntries(specs.map((s) => [s.table, s]));
    expect(by.companies.scope).toBe('self');
    expect(by.orders).toEqual({ table: 'orders', scope: 'company', hasId: true });
    expect(by.order_x).toEqual({ table: 'order_x', scope: 'order', hasId: false });
    expect(by.border_crossings.scope).toBe('driver');
    expect(by.session).toBeUndefined();
    expect(by.company_backup_runs).toBeUndefined();
    expect(by.geo_cache).toBeUndefined(); // nincs céghez köthető oszlop
  });

  test('scopeWhere mindig a $1 cég-paraméterre szűr', () => {
    ['self', 'company', 'order', 'driver'].forEach((s) => expect(svc.scopeWhere(s)).toMatch(/\$1/));
    expect(() => svc.scopeWhere('x')).toThrow();
  });

  test('buildSnapshot: lapozás id szerint, minden lekérdezés a céget kapja', async () => {
    const p = tmp('snap');
    const big = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, company_id: 4 }));
    pool.query
      .mockResolvedValueOnce(rows([{ id: 4, nev: 'Teszt SRL' }]))                 // companies
      .mockResolvedValueOnce(rows([{ table_name: 'orders', column_name: 'company_id' }, { table_name: 'orders', column_name: 'id' }]))
      .mockResolvedValueOnce(rows([{ id: 4, nev: 'Teszt SRL' }]))                 // companies (self)
      .mockResolvedValueOnce(rows(big))                                           // orders 1. lap
      .mockResolvedValueOnce(rows([{ id: 1001, company_id: 4 }]));                // orders 2. lap
    const r = await svc.buildSnapshot(pool, 4, p);
    expect(r.counts).toEqual({ companies: 1, orders: 1001 });
    expect(r.rows).toBe(1002);
    pool.query.mock.calls.slice(2).forEach((c) => expect(c[1][0]).toBe(4));
    expect(pool.query.mock.calls[4][0]).toMatch(/id > \$2/);
    const lines = [];
    await bf.readFile(p, bf.companyKey(4), (l) => lines.push(l));
    expect(lines[0].type).toBe('meta');
    expect(lines[lines.length - 1]).toMatchObject({ type: 'end', rows: 1002 });
    fs.unlinkSync(p);
  });
});

describe('lib/googleDrive', () => {
  test('authUrl: csak drive.file + offline + state', () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid'; process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'sec';
    const u = new URL(drive.authUrl('st123'));
    expect(u.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/drive.file');
    expect(u.searchParams.get('scope')).not.toMatch(/auth\/drive(\s|$)/);
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('state')).toBe('st123');
    expect(u.searchParams.get('redirect_uri')).toMatch(/\/api\/backup\/google\/callback$/);
  });
  test('emailFromIdToken', () => {
    const tok = 'x.' + Buffer.from(JSON.stringify({ email: 'a@b.ro' })).toString('base64url') + '.y';
    expect(drive.emailFromIdToken(tok)).toBe('a@b.ro');
    expect(drive.emailFromIdToken('rossz')).toBeNull();
  });
});

describe('handlers/backup — jogosultság + validáció', () => {
  const ADMIN = { id: 1, pozicio: 'Admin', company_id: 7 };
  const MGR = { id: 2, pozicio: 'Manager', company_id: 7 };
  const SOFER = { id: 3, pozicio: 'Sofer', company_id: 7 };

  test.each(['backupGetStatus', 'backupSaveSettings', 'backupDisconnect', 'backupRunNow'])(
    '%s — csak Admin (Manager/Sofer tiltva, DB-hívás nélkül)', async (fn) => {
      for (const u of [MGR, SOFER, null]) expect((await call(H[fn], u, [{}])).ok).toBe(false);
      expect(pool.query).not.toHaveBeenCalled();
    });

  test.each(['devBackupStatus', 'devBackupVsDisconnect'])('%s — csak developer', async (fn) => {
    expect((await call(H[fn], ADMIN, [])).ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('backupSaveSettings: hibás óra / megőrzés elutasítva', async () => {
    expect((await call(H.backupSaveSettings, ADMIN, [{ run_hour: 25, drive_retention: 'forever' }])).ok).toBe(false);
    expect((await call(H.backupSaveSettings, ADMIN, [{ run_hour: 2, drive_retention: '7' }])).ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('backupSaveSettings: mentés a saját cégre', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const r = await call(H.backupSaveSettings, ADMIN, [{ enabled: true, run_hour: 3, drive_retention: '365' }]);
    expect(r.ok).toBe(true);
    expect(pool.query.mock.calls[0][1]).toEqual([7, true, 3, '365']);
  });

  test('backupRunNow: Drive nélkül nem indul', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid'; process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'sec';
    pool.query.mockResolvedValueOnce(rows([])); // nincs gdrive_backup integráció
    const r = await call(H.backupRunNow, ADMIN, []);
    expect(r.ok).toBe(false);
    expect(pool.query.mock.calls[0][1]).toEqual([7]);
  });

  test('backupGetStatus: a token sosem kerül a válaszba', async () => {
    pool.query
      .mockResolvedValueOnce(rows([{ status: 'connected', status_message: null, meta: { email: 'x@y.ro' }, connected: true }]))
      .mockResolvedValueOnce(rows([]))   // settings
      .mockResolvedValueOnce(rows([]))   // runs
      .mockResolvedValueOnce(rows([]));  // vs drive
    const r = await call(H.backupGetStatus, ADMIN, []);
    expect(r.ok).toBe(true);
    expect(r.connected).toBe(true);
    expect(r.email).toBe('x@y.ro');
    expect(JSON.stringify(r)).not.toMatch(/credentials|refresh/);
  });
});

describe('services/companyRestore — tiszta segédek', () => {
  const rst = require('../../services/companyRestore');
  test('topoOrder: szülő a gyerek előtt, kör esetén is minden tábla benne', () => {
    const o = rst.topoOrder(['order_stops', 'orders', 'clients'], [
      { child: 'order_stops', parent: 'orders' }, { child: 'orders', parent: 'clients' }, { child: 'orders', parent: 'companies' }]);
    expect(o.indexOf('clients')).toBeLessThan(o.indexOf('orders'));
    expect(o.indexOf('orders')).toBeLessThan(o.indexOf('order_stops'));
    const cyc = rst.topoOrder(['a', 'b'], [{ child: 'a', parent: 'b' }, { child: 'b', parent: 'a' }]);
    expect(cyc.sort()).toEqual(['a', 'b']);
  });
  test('toParam: jsonb → JSON szöveg, bytea → Buffer, null marad', () => {
    expect(rst.toParam({ km: 12 }, 'jsonb')).toBe('{"km":12}');
    expect(rst.toParam([1, 2], 'json')).toBe('[1,2]');
    expect(Buffer.isBuffer(rst.toParam({ $b64: 'aGk=' }, 'bytea'))).toBe(true);
    expect(rst.toParam(null, 'jsonb')).toBeNull();
    expect(rst.toParam('x', 'text')).toBe('x');
  });
  test('rowBelongs: más cég sora sosem kerül vissza', () => {
    expect(rst.rowBelongs({ company_id: 7 }, 'company', 7)).toBe(true);
    expect(rst.rowBelongs({ company_id: 8 }, 'company', 7)).toBe(false);
  });
  test('a cég-sor és a mentés-naplók sosem állnak vissza', () => {
    ['companies', 'session', 'company_backup_runs', 'company_backup_restores'].forEach((t) => expect(rst.NO_RESTORE.has(t)).toBe(true));
  });
});

describe('handlers/backup — visszaállítás jogosultság + megerősítés', () => {
  const ADMIN = { id: 1, pozicio: 'Admin', company_id: 7 };
  const MGR = { id: 2, pozicio: 'Manager', company_id: 7 };
  test.each(['backupRestorePreview', 'backupRestoreStatus', 'backupRestoreConfirm'])('%s — csak Admin', async (fn) => {
    expect((await call(H[fn], MGR, [{}])).ok).toBe(false);
    expect((await call(H[fn], null, [{}])).ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('megerősítő szó nélkül nem indul, DB-írás sincs', async () => {
    const r = await call(H.backupRestoreConfirm, ADMIN, [{ job_id: 3, confirm: 'igen' }]);
    expect(r.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('megerősítés csak kész előnézetből, saját cégre (atomikus UPDATE)', async () => {
    pool.query.mockResolvedValueOnce(rows([])); // nincs preview_ready sor
    const r = await call(H.backupRestoreConfirm, ADMIN, [{ job_id: 3, confirm: 'restaurare' }]);
    expect(r.ok).toBe(false);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/status='preview_ready'/);
    expect(params).toEqual([3, 7]);
  });
  test('előnézet: idegen / nem létező mentés elutasítva (company_id a WHERE-ben)', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const r = await call(H.backupRestorePreview, ADMIN, [{ run_id: 55, source: 'company' }]);
    expect(r.ok).toBe(false);
    expect(pool.query.mock.calls[0][1]).toEqual([55, 7]);
  });
  test('státusz: saját cégre szűrve', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const r = await call(H.backupRestoreStatus, ADMIN, [{ job_id: 9 }]);
    expect(r.ok).toBe(true);
    expect(pool.query.mock.calls[0][1]).toEqual([9, 7]);
    expect(r.confirm_word).toBe('RESTAURARE');
  });
});
