// lib/docArchive + middleware/archiveLock — éves dokumentum-archívum.
jest.mock('../../db', () => ({ query: jest.fn() }));
const pool = require('../../db');
const arch = require('../../lib/docArchive');
const { archiveLock } = require('../../middleware/archiveLock');

describe('határidő-fázisok', () => {
  test('30 nap felett ok, 6–30 warn, ≤5 (és lejárt) lock', () => {
    expect(arch.phaseOf(31)).toBe('ok');
    expect(arch.phaseOf(30)).toBe('warn');
    expect(arch.phaseOf(6)).toBe('warn');
    expect(arch.phaseOf(5)).toBe('lock');
    expect(arch.phaseOf(-3)).toBe('lock');
  });
  test('napok száma felfelé kerekítve', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(arch.daysLeftOf(new Date(now + 4.2 * 86400000), now)).toBe(5);
  });
});

describe('kód', () => {
  test('16 számjegy, nem 0-val kezdődik', () => {
    for (let i = 0; i < 50; i++) expect(arch.newCode()).toMatch(/^[1-9]\d{15}$/);
  });
  test('a kivonat cégfüggő és szóközt/kötőjelet figyelmen kívül hagy', () => {
    expect(arch.codeHash(5, '1234 5678-9012')).toBe(arch.codeHash(5, '123456789012'));
    expect(arch.codeHash(5, '123456789012')).not.toBe(arch.codeHash(6, '123456789012'));
  });
  test('rossz hosszúságú kód: nincs DB-hívás', async () => {
    pool.query.mockReset();
    expect((await arch.confirm(5, '123')).ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('helyes kód → új határidő a saját cégnél', async () => {
    pool.query.mockReset();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 9 }] }).mockResolvedValueOnce({ rows: [] });
    const r = await arch.confirm(5, '1234567890123456', 'a@b.ro');
    expect(r.ok).toBe(true);
    expect(pool.query.mock.calls[0][1]).toEqual([5, arch.codeHash(5, '1234567890123456'), 'a@b.ro']);
    expect(pool.query.mock.calls[1][0]).toMatch(/UPDATE companies SET doc_archive_due_at/);
    expect(pool.query.mock.calls[1][1][0]).toBe(5);
  });
});

describe('fájl-segédek', () => {
  test('data URL / nyers base64 / URL / Buffer', () => {
    expect(arch.decodeData('data:application/pdf;base64,JVBERg==')).toMatchObject({ mime: 'application/pdf' });
    expect(arch.decodeData('data:application/pdf;base64,JVBERg==').buf.toString()).toBe('%PDF');
    expect(arch.decodeData('JVBERg==', 'application/pdf').buf.toString()).toBe('%PDF');
    expect(arch.decodeData('https://x.ro/a.pdf')).toEqual({ url: 'https://x.ro/a.pdf' });
    expect(arch.decodeData(Buffer.from('ab')).buf.length).toBe(2);
    expect(arch.decodeData(null)).toBeNull();
  });
  test('biztonságos név, havi mappa', () => {
    expect(arch.safe('../Factură / 2026:1')).not.toMatch(/[/:]|\.\./);
    expect(arch.monthOf('2026-03-05T10:00:00Z')).toBe('2026-03');
    expect(arch.monthOf(null)).toBe('fara_data');
  });
});

describe('archiveLock middleware', () => {
  const run = async (user, path, body, locked) => {
    pool.query.mockReset();
    arch.invalidate(5);
    const due = new Date(Date.now() + (locked ? 2 : 100) * 86400000);
    pool.query.mockResolvedValueOnce({ rows: [{ created_at: null, doc_archive_due_at: due }] })
      .mockResolvedValue({ rows: [{ last_confirmed: null, pending: false }] });
    const req = { session: { user }, path, body };
    const res = { status: jest.fn(function () { return this; }), json: jest.fn() };
    const next = jest.fn();
    await archiveLock(req, res, next);
    return { res, next };
  };
  const ADMIN = { pozicio: 'Admin', company_id: 5 };
  test('zár: Admin API-hívás 423', async () => {
    const { res, next } = await run(ADMIN, '/api/execute', { functionName: 'comList' }, true);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(423);
    expect(res.json.mock.calls[0][0].result.archive_lock).toBe(true);
  });
  test('zár: az archívum-hívások és a letöltés átmennek', async () => {
    expect((await run(ADMIN, '/api/execute', { functionName: 'docArchiveConfirm' }, true)).next).toHaveBeenCalled();
    expect((await run(ADMIN, '/api/doc-archive/download', {}, true)).next).toHaveBeenCalled();
  });
  test('nincs zár: minden megy', async () => {
    expect((await run(ADMIN, '/api/execute', { functionName: 'comList' }, false)).next).toHaveBeenCalled();
  });
  test('sofőr és developer nincs zárolva', async () => {
    expect((await run({ pozicio: 'Sofer', company_id: 5 }, '/api/execute', { functionName: 'x' }, true)).next).toHaveBeenCalled();
    expect((await run({ pozicio: 'Admin', company_id: 5, is_dev: true }, '/api/execute', { functionName: 'x' }, true)).next).toHaveBeenCalled();
  });
  test('oldal-betöltés (nem /api) átmegy — a felület mutatja a zárat', async () => {
    expect((await run(ADMIN, '/admin', {}, true)).next).toHaveBeenCalled();
  });
});

describe('handlerek szerep-kapuja', () => {
  const H = require('../../handlers/docArchive');
  test.each(['docArchiveStatus', 'docArchiveConfirm'])('%s: Sofer tiltva', async (fn) => {
    pool.query.mockReset();
    const res = { json: jest.fn() };
    await H[fn]({ session: { user: { pozicio: 'Sofer', company_id: 5 } }, headers: {} }, res, [{}]);
    expect(res.json.mock.calls[0][0].result.ok).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
