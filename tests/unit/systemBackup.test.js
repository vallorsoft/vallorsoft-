// services/systemBackup + systemRestore — tiszta segédek (DB nélkül).
jest.mock('../../db', () => ({ query: jest.fn(), connect: jest.fn() }));
const sys = require('../../services/systemBackup');
const rst = require('../../services/systemRestore');

describe('változás-követő trigger', () => {
  test('függvénynév: stabil, egyedi, érvényes azonosító', () => {
    expect(sys.fnName('orders')).toBe(sys.fnName('orders'));
    expect(sys.fnName('orders')).not.toBe(sys.fnName('order_s'));
    expect(sys.fnName('x'.repeat(80)).length).toBeLessThanOrEqual(63);
    expect(sys.fnName('a-b c')).toMatch(/^sys_tc_[a-z0-9_]+$/i);
  });
  test('csak a kulcs-oszlopokat olvassa, idézőjelezve; kulcs-változás → régi kulcs törlésként', () => {
    const sql = sys.triggerFunctionSql("we'ird", ['company_id', 'feature_key']);
    expect(sql).toContain("'we''ird'");
    expect(sql).toContain(`jsonb_build_object('company_id', NEW."company_id", 'feature_key', NEW."feature_key")`);
    expect(sql).toContain(`(OLD."company_id" IS DISTINCT FROM NEW."company_id") OR (OLD."feature_key" IS DISTINCT FROM NEW."feature_key")`);
    expect(sql).not.toMatch(/to_jsonb\(NEW\)/);   // nem másolja a teljes sort
  });
  test('a munkamenet- és a napló-táblák kimaradnak', () => {
    ['session', 'sys_change_log', 'system_backup_runs', 'scheduler_leader'].forEach((t) => expect(sys.SKIP.has(t)).toBe(true));
  });
});

describe('fájlnevek és kapcsolat', () => {
  test('két mentés sosem kap azonos nevet (ugyanabban a pillanatban sem)', () => {
    const d = new Date(Date.UTC(2026, 10, 22, 3, 0, 0, 123));
    const a = sys.keyFor('delta', d), b = sys.keyFor('delta', d);
    expect(a).toMatch(/^system\/2026\/11\/delta-20261122T030000123Z-[0-9a-f]{6}\.vsbk$/);
    expect(a).not.toBe(b);
    expect(sys.keyFor('full', d)).toMatch(/\.vsdb$/);
  });
  test('a Neon pooler-végpontja helyett a közvetlen (pg_dump-hoz)', () => {
    expect(sys.directUrl('postgres://u:p@ep-cool-1-pooler.eu-central-1.aws.neon.tech/db?sslmode=require'))
      .toBe('postgres://u:p@ep-cool-1.eu-central-1.aws.neon.tech/db?sslmode=require');
    expect(sys.directUrl('postgres://u:p@localhost/db')).toBe('postgres://u:p@localhost/db');
  });
});

describe('visszaállítási terv', () => {
  const list = [
    { kind: 'full', key: 'F1', created_at: '2026-10-01T03:00:00Z' },
    { kind: 'delta', key: 'D1', base_key: 'F1', created_at: '2026-10-02T03:00:00Z' },
    { kind: 'full', key: 'F2', created_at: '2026-10-31T03:00:00Z' },
    { kind: 'delta', key: 'D2', base_key: 'F2', created_at: '2026-11-01T03:00:00Z' },
    { kind: 'delta', key: 'D3', base_key: 'F2', created_at: '2026-11-02T03:00:00Z' },
  ];
  test('a legfrissebb állapot: utolsó teljes + az arra épülő változások', () => {
    const p = rst.planRestore(list);
    expect(p.full.key).toBe('F2');
    expect(p.deltas.map((d) => d.key)).toEqual(['D2', 'D3']);
  });
  test('adott időpontra: az előtte lévő lánc, a későbbi változások nélkül', () => {
    expect(rst.planRestore(list, '2026-11-01T12:00:00Z').deltas.map((d) => d.key)).toEqual(['D2']);
    const p = rst.planRestore(list, '2026-10-15T00:00:00Z');
    expect(p.full.key).toBe('F1');
    expect(p.deltas.map((d) => d.key)).toEqual(['D1']);
  });
  test('teljes mentés nélkül nincs terv', () => {
    expect(rst.planRestore([{ kind: 'delta', key: 'X', base_key: 'F', created_at: '2026-01-01' }])).toBeNull();
  });
});
