// ============================================================
//  generateHereInvoice — a VallorSoft (developer) SAJÁT számlázójával
//  állít ki szolgáltatási számlát a cégeknek. Regressziós őr:
//   - csak developer hívhatja
//   - eladó = vevő TILOS (a developer nem számlázhat a saját cégének)
//   - a célcég számlázó-kulcsához SOHA nem nyúl (a self-invoice ág DB-t sem hív)
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware } = require('../helpers/session-mock');
const pool = require('../../db');

const app = express();
app.use(express.json());
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

function exec(fn, args) {
  return request(app).post('/api/execute').send({ functionName: fn, arguments: args || [] });
}

const devUser = { id: 99, email: 'dev@vallorsoft.hu', nume: 'Dev', pozicio: 'Admin', company_id: 5, is_dev: true };

beforeEach(() => reset());

describe('generateHereInvoice (developer szolgáltatás-számla)', () => {
  test('nem-developer → ok:false (Doar developer)', async () => {
    setUser({ id: 30, email: 'admin@ceg.hu', nume: 'Admin', pozicio: 'Admin', company_id: 1 });
    const res = await exec('generateHereInvoice', [{ company_id: 2 }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/developer/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('eladó = vevő TILOS: a developer nem számlázhat a saját cégének → ok:false, DB-t nem hívja', async () => {
    setUser(devUser);
    const res = await exec('generateHereInvoice', [{ company_id: 5 }]); // == session company_id
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/propria firma|emitent/i);
    expect(pool.query).not.toHaveBeenCalled(); // a célcég kulcsához hozzá sem ér
  });

  test('hiányzó company_id → ok:false', async () => {
    setUser(devUser);
    const res = await exec('generateHereInvoice', [{}]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/lipseste|firmei/i);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
