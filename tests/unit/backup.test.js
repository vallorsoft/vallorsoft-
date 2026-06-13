// ============================================================
//  services/backup — pg_dump mentés tiszta helper-darabjai
// ============================================================
const b = require('../../services/backup');

describe('services/backup', () => {
  test('backupFileName formátum + fileTimestamp körüljárás (UTC)', () => {
    const d = new Date(Date.UTC(2026, 5, 13, 9, 5, 7));
    const name = b.backupFileName(d);
    expect(name).toBe('vallorsoft-20260613-090507.sql.gz');
    expect(b.fileTimestamp(name)).toBe(d.getTime());
  });

  test('fileTimestamp nem illő névre null', () => {
    expect(b.fileTimestamp('valami.txt')).toBeNull();
    expect(b.fileTimestamp('')).toBeNull();
  });

  test('isExpired: 20 napos lejár (14 nap retenció), 5 napos nem, nem-illő név sosem', () => {
    const now = Date.UTC(2026, 5, 20, 0, 0, 0);
    expect(b.isExpired('vallorsoft-20260531-000000.sql.gz', now, 14)).toBe(true);  // ~20 nap
    expect(b.isExpired('vallorsoft-20260615-000000.sql.gz', now, 14)).toBe(false); // 5 nap
    expect(b.isExpired('mas.txt', now, 14)).toBe(false);
  });

  test('pgEnvFromUrl: PG* env-re bontja az URL-t (a jelszó NEM megy a parancssorba)', () => {
    const env = b.pgEnvFromUrl('postgres://u:p%40ss@host:5433/dbx?sslmode=require', {});
    expect(env.PGHOST).toBe('host');
    expect(env.PGPORT).toBe('5433');
    expect(env.PGUSER).toBe('u');
    expect(env.PGPASSWORD).toBe('p@ss');     // URL-dekódolt
    expect(env.PGDATABASE).toBe('dbx');
    expect(env.PGSSLMODE).toBe('require');
  });

  test('startBackupScheduler alapból KI (nincs BACKUP_ENABLED/BACKUP_DIR)', () => {
    const oe = process.env.BACKUP_ENABLED, od = process.env.BACKUP_DIR;
    delete process.env.BACKUP_ENABLED;
    delete process.env.BACKUP_DIR;
    expect(b.startBackupScheduler()).toBe(false);
    if (oe !== undefined) process.env.BACKUP_ENABLED = oe;
    if (od !== undefined) process.env.BACKUP_DIR = od;
  });
});
