// ============================================================
//  Munkamenet-újraellenőrzés (middleware/sessionRevalidate.js)
//  Letiltott / törölt / lefokozott user, lejárt cég, jelszócsere,
//  letiltott portál-belépő → a régi session nem él tovább.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);
const { pool, rows, reset } = require('../helpers/db-mock');
const { sessionRevalidate, regenerateSession, pwFingerprint } = require('../../middleware/sessionRevalidate');

const HASH = '$2b$10$abcdefghijklmnopqrstuv';

function mkReq(sess) { return { session: sess }; }
function run(req) { return new Promise((r) => sessionRevalidate(req, {}, r)); }
function userRow(over) {
  return Object.assign({ id: 5, nume: 'Ana', email: 'a@x.ro', pozicio: 'Admin', company_id: 1,
    pozicio_dev: false, blocked: false, password_hash: HASH, subscription_status: 'active', paid_until: null }, over);
}
function baseUser(over) {
  return Object.assign({ id: 5, nume: 'Ana', email: 'a@x.ro', pozicio: 'Admin', company_id: 1,
    pwf: pwFingerprint(HASH) }, over);
}

beforeEach(() => reset());

describe('sessionRevalidate — belső felhasználó', () => {
  test('session nélkül nem kérdez DB-t', async () => {
    await run(mkReq({}));
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('érvényes user: marad, adatok frissülnek (lefokozás azonnal hat)', async () => {
    pool.query.mockResolvedValueOnce(rows([userRow({ pozicio: 'Sofer', nume: 'Ana B' })]));
    const req = mkReq({ user: baseUser() });
    await run(req);
    expect(req.session.user).toBeTruthy();
    expect(req.session.user.pozicio).toBe('Sofer');
    expect(req.session.user.nume).toBe('Ana B');
  });

  test('törölt user → session.user törlődik', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const req = mkReq({ user: baseUser() });
    await run(req);
    expect(req.session.user).toBeNull();
    expect(req.sessionRevokedReason).toBe('deleted');
  });

  test('letiltott user → kijelentkeztetve', async () => {
    pool.query.mockResolvedValueOnce(rows([userRow({ blocked: true })]));
    const req = mkReq({ user: baseUser() });
    await run(req);
    expect(req.session.user).toBeNull();
    expect(req.sessionRevokedReason).toBe('blocked');
  });

  test('developer nem tiltható, és cég-előfizetés sem zárja ki', async () => {
    pool.query.mockResolvedValueOnce(rows([userRow({ blocked: true, pozicio_dev: true, subscription_status: 'cancelled' })]));
    const req = mkReq({ user: baseUser() });
    await run(req);
    expect(req.session.user).toBeTruthy();
    expect(req.session.user.is_dev).toBe(true);
  });

  test('lemondott / lejárt cég-előfizetés → kijelentkeztetve', async () => {
    pool.query.mockResolvedValueOnce(rows([userRow({ subscription_status: 'cancelled' })]));
    const r1 = mkReq({ user: baseUser() });
    await run(r1);
    expect(r1.session.user).toBeNull();

    pool.query.mockResolvedValueOnce(rows([userRow({ paid_until: new Date(Date.now() - 86400000) })]));
    const r2 = mkReq({ user: baseUser() });
    await run(r2);
    expect(r2.session.user).toBeNull();
    expect(r2.sessionRevokedReason).toBe('subscription');
  });

  test('jelszócsere után a régi session kiesik', async () => {
    pool.query.mockResolvedValueOnce(rows([userRow({ password_hash: '$2b$10$UJHASH' })]));
    const req = mkReq({ user: baseUser() });
    await run(req);
    expect(req.session.user).toBeNull();
    expect(req.sessionRevokedReason).toBe('password-changed');
  });

  test('régi session (nincs pwf) → ujjlenyomatot kap, nem esik ki', async () => {
    pool.query.mockResolvedValueOnce(rows([userRow()]));
    const req = mkReq({ user: baseUser({ pwf: undefined }) });
    await run(req);
    expect(req.session.user.pwf).toBe(pwFingerprint(HASH));
  });

  test('throttle: REVALIDATE_MS-en belül nem kérdez újra', async () => {
    pool.query.mockResolvedValueOnce(rows([userRow()]));
    const req = mkReq({ user: baseUser() });
    await run(req);
    await run(req);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('DB-hiba → fail-open (a user bent marad)', async () => {
    pool.query.mockRejectedValueOnce(new Error('conn reset'));
    const req = mkReq({ user: baseUser() });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await run(req);
    warn.mockRestore();
    expect(req.session.user).toBeTruthy();
  });
});

describe('sessionRevalidate — portál-belépők', () => {
  test('letiltott ügyfél-portál belépő → clientUser törlődik (cégre szűrt lekérdezés)', async () => {
    pool.query.mockResolvedValueOnce(rows([{ activ: false }]));
    const req = mkReq({ clientUser: { id: 3, company_id: 1 } });
    await run(req);
    expect(req.session.clientUser).toBeNull();
    expect(pool.query.mock.calls[0][0]).toMatch(/client_users WHERE id = \$1 AND company_id = \$2/);
  });

  test('törölt alvállalkozói belépő → carrierUser törlődik', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const req = mkReq({ carrierUser: { id: 3, company_id: 1 } });
    await run(req);
    expect(req.session.carrierUser).toBeNull();
  });
});

describe('regenerateSession', () => {
  test('valódi session: regenerate hívódik, a megtartott mezők átkerülnek', async () => {
    const sess = { regenerate: jest.fn((cb) => cb()) };
    const req = { session: sess };
    await regenerateSession(req, { foo: 1 });
    expect(sess.regenerate).toHaveBeenCalled();
    expect(req.session.foo).toBe(1);
  });
  test('mock session (regenerate nélkül) → nem dob', async () => {
    const req = { session: {} };
    await expect(regenerateSession(req)).resolves.toBeUndefined();
  });
});
