// ============================================================
//  Ideiglenes WhatsApp-alapú "chat" — handlerek egység- és
//  integrációs tesztje. A Firebase-chat átmeneti kiváltása:
//    - getCompanyWhatsapp     (Admin/Manager/Sofer, olvasás)
//    - saveCompanyWhatsapp    (Admin/Manager, írás; audit)
//    - listDriversForWhatsapp (Admin/Manager, csak SAJÁT cég sofőrjei)
//
//  Fókuszok:
//    - E.164 normalizálás (csak számjegy; 7–15 hossz)
//    - Szerep-kapu (Sofer NEM írhat/nem listázhat)
//    - company_id szűrés (multi-tenant; a session ad company_id-t)
//    - _normalizePhone NEM regisztrálódik az /api/execute registrybe
//      (nem-enumerable export)
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { pool, rows, reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

function call(fn, args) {
  return request(app).post('/api/execute').send({ functionName: fn, arguments: args });
}

const CID = 1;
const ADMIN   = { ...fixtures.admin,   company_id: CID };
const MANAGER = { ...fixtures.manager, company_id: CID };
const SOFER   = { ...fixtures.sofer,   company_id: CID };

beforeEach(() => reset());

// ═══ _normalizePhone (közvetlen unit-teszt) ═════════════════════
describe('_normalizePhone', () => {
  const { _normalizePhone } = require('../../handlers/whatsappChat');

  test('csak számjegyeket tart meg (+, szóköz, kötőjel eltűnik)', () => {
    expect(_normalizePhone('+40 712 345 678')).toBe('40712345678');
    expect(_normalizePhone('+40-712-345-678')).toBe('40712345678');
    expect(_normalizePhone('0712345678')).toBe('0712345678');
  });

  test('túl rövid vagy túl hosszú -> null', () => {
    expect(_normalizePhone('123456')).toBeNull();     // 6 jegy — kevés
    expect(_normalizePhone('1234567890123456')).toBeNull(); // 16 jegy
  });

  test('üres / null / undefined / whitespace -> null', () => {
    expect(_normalizePhone('')).toBeNull();
    expect(_normalizePhone(null)).toBeNull();
    expect(_normalizePhone(undefined)).toBeNull();
    expect(_normalizePhone('   ')).toBeNull();
  });

  test('határeset: pontosan 7 és 15 jegy elfogadva', () => {
    expect(_normalizePhone('1234567')).toBe('1234567');
    expect(_normalizePhone('123456789012345')).toBe('123456789012345');
  });
});

// ═══ Registry-védelem: _normalizePhone NEM RPC ══════════════════
describe('_normalizePhone NEM hívható /api/execute-en át (nem-enumerable)', () => {
  test('ismeretlen funkcio', async () => {
    setUser(ADMIN);
    const res = await call('_normalizePhone', ['+40712345678']);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/necunoscuta/i);
  });
});

// ═══ getCompanyWhatsapp ═════════════════════════════════════════
describe('getCompanyWhatsapp', () => {
  test('bejelentkezés nélkül elutasít (requireLogin)', async () => {
    setUser(null);
    const res = await call('getCompanyWhatsapp', []);
    // requireLogin: 401 státusz
    expect([401, 403]).toContain(res.status);
  });

  test('Sofer olvashat — a saját cége számát', async () => {
    setUser(SOFER);
    pool.query.mockResolvedValueOnce(rows([{ whatsapp_number: '+40 712 345 678' }]));
    const res = await call('getCompanyWhatsapp', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.number).toBe('40712345678'); // normalizált
    // A lekérdezés company_id=$1 kell legyen a saját cégre.
    expect(pool.query.mock.calls[0][0]).toMatch(/FROM companies WHERE id=\$1/i);
    expect(pool.query.mock.calls[0][1]).toEqual([CID]);
  });

  test('Manager olvashat — nincs beállított szám -> null', async () => {
    setUser(MANAGER);
    pool.query.mockResolvedValueOnce(rows([{ whatsapp_number: null }]));
    const res = await call('getCompanyWhatsapp', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.number).toBeNull();
  });

  test('Admin olvashat — érvénytelen (túl rövid) tárolt érték -> null', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ whatsapp_number: '123' }]));
    const res = await call('getCompanyWhatsapp', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.number).toBeNull();
  });
});

// ═══ saveCompanyWhatsapp ════════════════════════════════════════
describe('saveCompanyWhatsapp', () => {
  test('Sofer NEM írhat (Acces interzis)', async () => {
    setUser(SOFER);
    const res = await call('saveCompanyWhatsapp', [{ number: '+40712345678' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('érvénytelen szám elutasít (nincs UPDATE)', async () => {
    setUser(ADMIN);
    const res = await call('saveCompanyWhatsapp', [{ number: '12' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/invalid/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('sikeres mentés (Manager) — normalizált szám mentődik', async () => {
    setUser(MANAGER);
    pool.query
      .mockResolvedValueOnce({ rowCount: 1 })  // UPDATE companies
      .mockResolvedValueOnce({ rowCount: 1 }); // audit
    const res = await call('saveCompanyWhatsapp', [{ number: '+40 712 345 678' }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.number).toBe('40712345678');
    // UPDATE companies SET whatsapp_number=$1 WHERE id=$2
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE companies SET whatsapp_number=\$1 WHERE id=\$2/i);
    expect(params).toEqual(['40712345678', CID]);
  });

  test('üres szám -> törlés (null írás)', async () => {
    setUser(ADMIN);
    pool.query
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('saveCompanyWhatsapp', [{ number: '' }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.number).toBeNull();
    expect(pool.query.mock.calls[0][1]).toEqual([null, CID]);
  });
});

// ═══ listDriversForWhatsapp ════════════════════════════════════
describe('listDriversForWhatsapp', () => {
  test('Sofer NEM listázhat', async () => {
    setUser(SOFER);
    const res = await call('listDriversForWhatsapp', []);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('Manager: SAJÁT cég belső sofőrjei — telefon normalizálva', async () => {
    setUser(MANAGER);
    pool.query.mockResolvedValueOnce(rows([
      { id: 1, nume: 'Kiss János',  email: 'k@ceg.hu', tel: '+40 712 345 678', pozicio: 'Sofer' },
      { id: 2, nume: 'Nagy Éva',    email: 'e@ceg.hu', tel: null,               pozicio: 'Sofer' },
    ]));
    const res = await call('listDriversForWhatsapp', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.drivers).toHaveLength(2);
    expect(res.body.result.drivers[0].tel_normalized).toBe('40712345678');
    expect(res.body.result.drivers[1].tel_normalized).toBeNull();
    // A lekérdezés a saját cégre szűr + pozicio='Sofer' + blocked=false
    const [sql, params] = pool.query.mock.calls[0];
    expect(String(sql)).toMatch(/company_id=\$1 AND pozicio='Sofer'/i);
    expect(String(sql)).toMatch(/COALESCE\(blocked,false\)=false/i);
    expect(params).toEqual([CID]);
  });

  test('Admin: hibás tárolt telefon -> tel_normalized=null (jelzésre)', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([
      { id: 3, nume: 'X',  email: 'x@ceg.hu', tel: '12', pozicio: 'Sofer' },
    ]));
    const res = await call('listDriversForWhatsapp', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.drivers[0].tel_normalized).toBeNull();
    expect(res.body.result.drivers[0].tel).toBe('12'); // eredeti kirajzolásra
  });
});
