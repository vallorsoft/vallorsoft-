// ============================================================
//  Unit-teszt — lib/chatTools (képesség-katalógus) + lib/chatRouter (AI-útválasztás).
//  DB, handlerek, AI mockolva — nincs hálózat.
// ============================================================
let mockRules = [];
const mockDbQuery = jest.fn(async (sql, params) => {
  for (const r of mockRules) if (r.match.test(sql)) return r.fn ? r.fn(sql, params) : { rows: r.rows || [] };
  return { rows: [] };
});
jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));
let mockFeatures = {};
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: async (cid, k) => mockFeatures[k] !== false }));
jest.mock('../../lib/audit', () => ({ fromReq: jest.fn(async () => {}) }));
const mockExtract = jest.fn();
jest.mock('../../lib/geminiJson', () => ({ extractJson: (...a) => mockExtract(...a) }));
let mockPerm = false;
jest.mock('../../handlers/permissions', () => ({ hasPerm: async () => mockPerm }));
let mockOrders = [];
jest.mock('../../lib/mailData', () => ({
  resolveOrderRefs: async (cid, refs) => {
    const r = String(refs[0]);
    const o = mockOrders.find((x) => cid === 7 && (x.fuvar_no.endsWith(r) || x.id === r));
    return o ? { found: [{ id: o.id }], missing: [], ambiguous: [] } : { found: [], missing: [r], ambiguous: [] };
  },
}));
const mockH = {
  comUpdate: jest.fn((req, res) => res.json({ result: { ok: true } })),
  comDelete: jest.fn((req, res) => res.json({ result: { ok: true } })),
  plannerAssign: jest.fn((req, res) => res.json({ result: { ok: true } })),
};
jest.mock('../../handlers/orders', () => ({
  comUpdate: (...a) => mockH.comUpdate(...a), comDelete: (...a) => mockH.comDelete(...a), plannerAssign: (...a) => mockH.plannerAssign(...a),
  restoreOrder: (req, res) => res.json({ result: { ok: true } }), resetOrderMilestones: (req, res) => res.json({ result: { ok: true } }),
  getTrackingLink: (req, res) => res.json({ result: { ok: true, token: 'tok' } }), getPlannerMatches: (req, res) => res.json({ result: { ok: true, matches: [] } }),
}));

const tools = require('../../lib/chatTools');
const resolve = require('../../lib/chatTools/resolve');
const router = require('../../lib/chatRouter');
const ops = require('../../lib/chatOps');

const ADMIN = { id: 3, company_id: 7, pozicio: 'Admin', email: 'a@x.ro' };
const MANAGER = { id: 4, company_id: 7, pozicio: 'Manager', email: 'm@x.ro' };
const req = (u) => ({ session: { user: Object.assign({}, u || ADMIN) }, headers: {}, ip: '1.1.1.1' });
const ORDER = { id: 'CMDX1', fuvar_no: 'CMD-2026-0042', status: 'Disponibil', pret: 1200, paid_amount: 0, client: 'Bilka',
  loc_incarcare: 'Brașov, RO', loc_descarcare: 'Bicske, HU', data_incarcare: '2026-10-09', data_descarcare: '2026-10-10', nume_sofer: null, rendszam_camion: null };
const NOW = new Date(2026, 9, 8, 12, 0, 0);

function baseRules() {
  return [
    { match: /FROM orders o WHERE o\.id = \$1 AND o\.company_id = \$2/, fn: (sql, p) => ({ rows: mockOrders.filter((o) => o.id === p[0] && p[1] === 7).map((o) => Object.assign({ fuvar_no_v: o.fuvar_no }, o)) }) },
    { match: /SELECT o\.id, o\.status, o\.pret/, fn: (sql, p) => ({ rows: mockOrders.filter((o) => o.id === p[0] && p[1] === 7) }) },
    { match: /FROM users WHERE company_id=\$1 AND pozicio='Sofer'/, rows: [{ email: 'peto@x.ro', nume: 'Pető-Lőrincz Imre' }, { email: 'ion@x.ro', nume: 'Ion Popescu' }] },
    { match: /LOWER\(email\) = \$2 AND pozicio = 'Sofer'/, fn: (sql, p) => ({ rows: p[1] === 'peto@x.ro' ? [{ email: 'peto@x.ro', nume: 'Pető-Lőrincz Imre' }] : [] }) },
    { match: /kind='driver_alias'/, rows: [] },
    { match: /SELECT rendszam FROM vehicles WHERE company_id=\$1$/, rows: [{ rendszam: 'B104VLR' }] },
    { match: /SELECT id, rendszam, tip, marca, model FROM vehicles/, rows: [{ id: 1, rendszam: 'B104VLR', tip: 'Vontato' }, { id: 2, rendszam: 'CJ36VSN', tip: 'Potkocsi' }] },
    { match: /chat_learned_intents/, rows: [] },
    { match: /AS no FROM orders o WHERE o\.company_id = \$1 AND o\.id = \$2/, fn: (sql, p) => ({ rows: mockOrders.filter((o) => o.id === p[1] && p[0] === 7).map((o) => ({ id: o.id, no: o.fuvar_no })) }) },
  ];
}

beforeEach(() => {
  mockOrders = [Object.assign({}, ORDER)];
  mockRules = baseRules();
  mockFeatures = {};
  mockPerm = false;
  mockExtract.mockReset();
  Object.values(mockH).forEach((f) => f.mockClear());
});

const ctxOf = (u, ui) => router.makeCtx(req(u), 'hu', 'teszt', [], router.cleanUi(ui, (u || ADMIN).pozicio), NOW);

describe('registry', () => {
  test('minden tool érvényes: név egyedi, kind ismert, írásnak preview+run, olvasásnak run', () => {
    const all = tools.all();
    expect(all.length).toBeGreaterThan(20);
    for (const t of all) {
      expect(t.name).toMatch(/^[a-z_]+\.[a-z_]+$/);
      if (t.kind === 'write' || t.kind === 'danger') { expect(typeof t.preview).toBe('function'); expect(typeof t.run).toBe('function'); expect(t.title).toBeTruthy(); }
      if (t.kind === 'read' || t.kind === 'ui') expect(typeof t.run).toBe('function');
      if (t.kind === 'delegate') expect(['draft', 'mail', 'edit']).toContain(t.delegate);
      expect(t.desc && t.desc.hu && t.desc.ro).toBeTruthy();
    }
  });
  test('minden H(modul, fn) hivatkozás létező handlerre mutat', () => {
    const fs = require('fs'); const path = require('path');
    const dir = path.join(__dirname, '../../lib/chatTools');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const re = /H\('([a-zA-Z]+)',\s*'([a-zA-Z]+)'\)/g; let m;
      while ((m = re.exec(src))) {
        const real = jest.requireActual('../../handlers/' + m[1]);
        expect(typeof real[m[2]]).toBe('function');
      }
    }
  });
  test('a navigációs fülek fehérlistája egyezik az admin/manager menüvel', () => {
    const fs = require('fs');
    const tabs = require('../../lib/chatTools/navTabs.json').map((x) => x.tab);
    const html = fs.readFileSync(require('path').join(__dirname, '../../public/admin.html'), 'utf8');
    for (const t of tabs.filter((x) => x !== 'billing')) expect(html).toContain('data-tab="' + t + '"');
  });
});

describe('hozzáférés', () => {
  test('Sofer semmit nem használhat', async () => {
    const list = await tools.available(req({ id: 9, company_id: 7, pozicio: 'Sofer' }));
    expect(list).toHaveLength(0);
  });
  test('Manager: granulált jog nélkül a fuvar-törlés és a fizetés nem elérhető', async () => {
    const names = (await tools.available(req(MANAGER))).map((t) => t.name);
    expect(names).not.toContain('order.delete');
    expect(names).not.toContain('order.payment');
    expect(names).toContain('order.update');
    mockPerm = true;
    const names2 = (await tools.available(req(MANAGER))).map((t) => t.name);
    expect(names2).toContain('order.delete');
  });
  test('kikapcsolt csomag-funkció → a tool nem elérhető', async () => {
    mockFeatures['quotes'] = false;
    const names = (await tools.available(req(ADMIN))).map((t) => t.name);
    expect(names).not.toContain('quote.list');
  });
});

describe('feloldók', () => {
  test('időszak', () => {
    expect(resolve.parsePeriod('2026-09', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(resolve.parsePeriod('last_month', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(resolve.parsePeriod('2026', NOW)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(resolve.parsePeriod('szeptember', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(resolve.parsePeriod('2026-10-01..2026-10-15', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-15' });
    expect(resolve.parsePeriod('blabla', NOW)).toBeNull();
  });
  test('szám / pénz', () => {
    expect(resolve.parseNumber('1.500')).toBe(1500);
    expect(resolve.parseNumber('1 350,50 EUR')).toBe(1350.5);
    expect(resolve.parseNumber(42)).toBe(42);
    expect(resolve.parseNumber('abc')).toBeNull();
  });
  test('fuvar: rövid szám, „current" a nyitott fuvarra, idegen cég → nem található', async () => {
    const c = ctxOf(ADMIN, { order: 'CMDX1' });
    expect((await resolve.resolve(c, { type: 'order' }, '42')).value).toEqual({ id: 'CMDX1', no: 'CMD-2026-0042' });
    expect((await resolve.resolve(c, { type: 'order' }, 'current')).value).toEqual({ id: 'CMDX1', no: 'CMD-2026-0042' });
    const other = ctxOf({ id: 5, company_id: 8, pozicio: 'Admin' }, {});
    expect((await resolve.resolve(other, { type: 'order' }, '0042')).err).toBeTruthy();
  });
  test('sofőr: név → e-mail szerveren; ismeretlen → hiba', async () => {
    const c = ctxOf(ADMIN, {});
    expect((await resolve.resolve(c, { type: 'driver' }, 'Peto')).value).toEqual({ email: 'peto@x.ro', name: 'Pető-Lőrincz Imre' });
    expect((await resolve.resolve(c, { type: 'driver' }, 'Kovacs')).err).toBeTruthy();
  });
  test('jármű: rendszám normalizálva; vontató-szűrés', async () => {
    const c = ctxOf(ADMIN, {});
    expect((await resolve.resolve(c, { type: 'tractor' }, 'b 104 vlr')).value).toMatchObject({ id: 1, plate: 'B104VLR' });
    expect((await resolve.resolve(c, { type: 'vehicle' }, 'XX999')).err).toBeTruthy();
  });
});

describe('prepare + execute', () => {
  test('írás: előnézet-kártya tokennel, változás előtte → utána', async () => {
    const c = ctxOf(ADMIN, {});
    const r = await tools.prepare(c, { tool: 'order.update', args: { order: '0042', pret: '1350' } });
    expect(r.write).toBe(true);
    expect(r.html).toContain('data-tok=');
    expect(r.html).toContain('1350');
    expect(mockH.comUpdate).not.toHaveBeenCalled();
    const tok = /data-tok="([^"]+)"/.exec(r.html)[1];
    const x = await ops.executeAction(req(ADMIN), tok.replace(/&amp;/g, '&'), {}, 'hu');
    expect(x.ok).toBe(true);
    expect(mockH.comUpdate).toHaveBeenCalledWith(expect.anything(), expect.anything(), ['CMDX1', { pret: 1350 }]);
  });
  test('hiányzó kötelező adat → visszakérdez, nem ír', async () => {
    const r = await tools.prepare(ctxOf(ADMIN, {}), { tool: 'order.update', args: { order: '0042' } });
    expect(r.write).toBeUndefined();
    expect(r.reply).toMatch(/Mit módosítsak/);
  });
  test('veszélyes művelet: IGEN nélkül nem fut', async () => {
    const r = await tools.prepare(ctxOf(ADMIN, {}), { tool: 'order.delete', args: { order: '0042' } });
    expect(r.html).toContain('och-danger');
    const tok = /data-tok="([^"]+)"/.exec(r.html)[1];
    const bad = await ops.executeAction(req(ADMIN), tok, { input: 'ok' }, 'hu');
    expect(bad.ok).toBe(false);
    expect(mockH.comDelete).not.toHaveBeenCalled();
    const good = await ops.executeAction(req(ADMIN), tok, { input: 'igen' }, 'hu');
    expect(good.ok).toBe(true);
    expect(mockH.comDelete).toHaveBeenCalledTimes(1);
  });
  test('token más felhasználónak / cégnek érvénytelen', async () => {
    const r = await tools.prepare(ctxOf(ADMIN, {}), { tool: 'order.set_status', args: { order: '0042', status: 'Finalizat' } });
    const tok = /data-tok="([^"]+)"/.exec(r.html)[1];
    const x = await ops.executeAction(req({ id: 99, company_id: 7, pozicio: 'Admin' }), tok, {}, 'hu');
    expect(x.ok).toBe(false);
    expect(mockH.comUpdate).not.toHaveBeenCalled();
  });
  test('végrehajtáskor a jogot újra ellenőrizzük (Manager jog elvétele után)', async () => {
    mockPerm = true;
    const r = await tools.prepare(ctxOf(MANAGER, {}), { tool: 'order.delete', args: { order: '0042' } });
    const tok = /data-tok="([^"]+)"/.exec(r.html)[1];
    mockPerm = false;
    const x = await ops.executeAction(req(MANAGER), tok, { input: 'IGEN' }, 'hu');
    expect(x.ok).toBe(false);
    expect(mockH.comDelete).not.toHaveBeenCalled();
  });
  test('kiosztás: a sofőr cég-tagságát a végrehajtáskor is ellenőrzi', async () => {
    const r = await tools.prepare(ctxOf(ADMIN, {}), { tool: 'order.assign', args: { order: '0042', driver: 'Peto' } });
    const tok = /data-tok="([^"]+)"/.exec(r.html)[1];
    const x = await ops.executeAction(req(ADMIN), tok, {}, 'hu');
    expect(x.ok).toBe(true);
    expect(mockH.plannerAssign).toHaveBeenCalledWith(expect.anything(), expect.anything(), ['CMDX1', { sofer_type: 'Intern', email_sofer: 'peto@x.ro', nume_sofer: 'Pető-Lőrincz Imre' }]);
  });
  test('navigáció: ismert fül → UI-parancs; ismeretlen → hiba', async () => {
    const r = await tools.prepare(ctxOf(ADMIN, {}), { tool: 'nav.open', args: { page: 'tervezőtábla' } });
    expect(r.ui).toEqual({ op: 'tab', tab: 'orders-planner' });
    const m = await tools.prepare(ctxOf(MANAGER, {}), { tool: 'nav.open', args: { page: 'integrations' } });
    expect(m.ui).toBeFalsy();
  });
});

describe('router', () => {
  test('AI lépés → olvasás azonnal, írás kártyával; ismeretlen tool kiszűrve', async () => {
    mockExtract.mockResolvedValue({ model: 'm', json: { steps: [{ tool: 'nope.x', args: {} }, { tool: 'order.set_status', args: { order: '0042', status: 'Finalizat' } }], confidence: 0.9 } });
    const r = await router.route(req(ADMIN), 'zárd le a 42-t', { lang: 'hu', now: NOW });
    expect(r.html).toContain('data-tok=');
    expect(r.tools).toEqual(['order.set_status']);
    // Az AI csak sémát kap, cég-adatot nem.
    const sent = JSON.stringify(mockExtract.mock.calls[0][0]);
    expect(sent).not.toContain('peto@x.ro');
    expect(sent).not.toContain('B104VLR');
  });
  test('nem értett mondat → alternatívák gombként, nem fuvar-vázlat', async () => {
    mockExtract.mockResolvedValue({ model: 'm', json: { steps: [], alternatives: [{ tool: 'order.list', example: 'Mutasd a mai fuvarokat' }, { tool: 'ismeretlen', example: 'x' }] } });
    const r = await router.route(req(ADMIN), 'izé', { lang: 'hu', now: NOW });
    expect(r.miss).toBe(true);
    expect(r.questions[0].options).toEqual(['Mutasd a mai fuvarokat']);
  });
  test('új fuvar → delegálás a vázlatra', async () => {
    mockExtract.mockResolvedValue({ model: 'm', json: { steps: [{ tool: 'order.create_chat', args: {} }], confidence: 0.9 } });
    const r = await router.route(req(ADMIN), 'holnap Arad Győr', { lang: 'hu', now: NOW });
    expect(r.delegate).toBe('draft');
  });
  test('AI-hiba → err (a hívó a régi útra esik vissza)', async () => {
    mockExtract.mockRejectedValue(Object.assign(new Error('x'), { code: 'NO_KEY' }));
    const r = await router.route(req(ADMIN), 'bármi', { lang: 'hu', now: NOW });
    expect(r.err).toBeTruthy();
  });
  test('ui-kontextus tisztítva (rossz azonosítók eldobva)', () => {
    expect(router.cleanUi({ tab: 'orders-list', order: 'X; DROP', selected: ['A1', '<b>', 'B2'] }, 'Admin'))
      .toEqual({ tab: 'orders-list', order: null, selected_ids: ['A1', 'B2'], selected: 2, role: 'Admin' });
  });
});
