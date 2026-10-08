// ============================================================
//  Unit-teszt — lib/chatOps.js (💬 chat-műveletek, cégszintű kérdések,
//  kiosztási javaslat, árajánlat, WhatsApp-üzenet, napi összefoglaló).
//  DB, handlerek, útvonal/útdíj mockolva — nincs hálózat.
// ============================================================
let mockRules = [];
const mockDbQuery = jest.fn(async (sql, params) => {
  for (const r of mockRules) if (r.match.test(sql)) return r.fn ? r.fn(sql, params) : { rows: r.rows || [] };
  return { rows: [] };
});
jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));
jest.mock('../../lib/vehiclePositions', () => ({ getPositions: async () => ({ ok: true, positions: [] }) }));
jest.mock('../../lib/routeEstimate', () => ({
  geocodeCached: async () => ({ lat: 46, lng: 21 }),
  estimateRoute: jest.fn(async () => ({ km: 450, durationSeconds: 6 * 3600, polyline: [[46, 23], [47.5, 19]] })),
}));
jest.mock('../../lib/tollEstimate', () => ({ estimateFromPolyline: async () => ({ total: 60, byCountry: [{ cc: 'HU', cost: 60 }] }) }));
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: async () => true }));
jest.mock('../../services/bnr', () => ({ fetchBnrEurRon: async () => 5 }));
jest.mock('../../lib/audit', () => ({ fromReq: jest.fn(async () => {}) }));
let mockOrders = [];
jest.mock('../../lib/mailData', () => ({
  resolveOrderRefs: async (cid, refs) => {
    const r = String(refs[0]);
    const o = mockOrders.find((x) => x.fuvar_no.endsWith(r) || x.id === r);
    return o ? { found: [{ id: o.id }], missing: [], ambiguous: [] } : { found: [], missing: [r], ambiguous: [] };
  },
}));
const mockH = {
  comUpdate: jest.fn((req, res, args) => res.json({ result: { ok: true } })),
  plannerAssign: jest.fn((req, res, args) => res.json({ result: { ok: true } })),
  getPlannerMatches: jest.fn((req, res) => res.json({ result: { ok: true, matches: [] } })),
  markOrderPayment: jest.fn((req, res) => res.json({ result: { ok: true } })),
  quoteSave: jest.fn((req, res) => res.json({ result: { ok: true, id: 77 } })),
  pdBulk: jest.fn((req, res, args) => res.json({ result: { ok: true, count: args[0].order_ids.length, updated: args[0].order_ids.length, finalized: 0, finance_synced: 1, skipped: 0 } })),
  pdOne: jest.fn((req, res) => res.json({ result: { ok: true } })),
  getOpsCenter: jest.fn((req, res) => res.json({ result: { ok: true, counters: { aktiv: 5, mai_felrakas: 2, mai_lerakas: 1, keso: 1 }, health: { waiting: 3 } } })),
};
jest.mock('../../handlers/orders', () => ({ comUpdate: (...a) => mockH.comUpdate(...a), plannerAssign: (...a) => mockH.plannerAssign(...a), getPlannerMatches: (...a) => mockH.getPlannerMatches(...a) }));
jest.mock('../../handlers/statisticsHandlers', () => ({ markOrderPayment: (...a) => mockH.markOrderPayment(...a) }));
jest.mock('../../handlers/orderPostDelivery', () => ({ setOrderPostDeliveryBulk: (...a) => mockH.pdBulk(...a), setOrderPostDelivery: (...a) => mockH.pdOne(...a) }));
jest.mock('../../handlers/quotes', () => ({ quoteSave: (...a) => mockH.quoteSave(...a) }));
jest.mock('../../handlers/opsCenter', () => ({ getOpsCenter: (...a) => mockH.getOpsCenter(...a) }));
jest.mock('../../handlers/statsInsights', () => ({ getStatsInsights: (req, res) => res.json({ result: { ok: true, insights: [{ severity: 'danger', title: 'B104VLR', detail: 'ITP lejárt' }] } }) }));
jest.mock('../../handlers/documents', () => ({ getOrdersMissingWaybill: (req, res) => res.json({ result: { ok: true, orders: [{ id: 'X' }] } }) }));
jest.mock('../../handlers/fleetCompliance', () => ({ computeServiceDueAlerts: async () => [{ rendszam: 'B104VLR', km_left: 800, days_left: 12, description: 'Olajcsere' }] }));

const ops = require('../../lib/chatOps');

const NOW = new Date(2026, 9, 8, 12, 0, 0);
const req = (over) => ({ session: { user: Object.assign({ id: 3, company_id: 7, pozicio: 'Admin', email: 'a@x.ro' }, over || {}) } });
const ORDER = { id: 'CMDX1', fuvar_no: 'CMD-2026-0042', status: 'Disponibil', pret: 1200, paid_amount: 0, email_sofer: null, nume_sofer: null,
  rendszam_camion: null, data_incarcare: '2026-10-09', data_descarcare: '2026-10-10', loc_incarcare: 'Brașov, RO', loc_descarcare: 'Bicske, HU', client: 'Bilka' };

function baseRules() {
  return [
    { match: /FROM users WHERE company_id=\$1 AND pozicio='Sofer'/, rows: [{ email: 'peto@x.ro', nume: 'Pető-Lőrincz Imre' }, { email: 'ion@x.ro', nume: 'Ion Popescu' }] },
    { match: /kind='driver_alias'/, rows: [] },
    { match: /SELECT rendszam FROM vehicles WHERE company_id=\$1$/, rows: [{ rendszam: 'B104VLR' }] },
    { match: /SELECT status FROM orders WHERE id = \$1 AND company_id = \$2/, fn: (sql, p) => ({ rows: mockOrders.filter((o) => o.id === p[0] && p[1] === 7).map((o) => ({ status: o.status })) }) },
    { match: /FROM orders o WHERE o.id = \$1 AND o.company_id = \$2/, fn: (sql, p) => ({ rows: mockOrders.filter((o) => o.id === p[0] && p[1] === 7) }) },
    { match: /SELECT rendszam FROM vehicles WHERE company_id = \$1 AND LOWER\(assigned_driver_email\)/, rows: [{ rendszam: 'B104VLR' }] },
    { match: /SELECT LOWER\(email\) AS email, nume FROM users WHERE company_id = \$1 AND LOWER\(email\) = \$2 AND pozicio = 'Sofer'/,
      fn: (sql, p) => ({ rows: p[0] === 7 && p[1] === 'peto@x.ro' ? [{ email: 'peto@x.ro', nume: 'Pető-Lőrincz Imre' }] : [] }) },
  ];
}
beforeEach(() => {
  mockRules = baseRules(); mockOrders = [Object.assign({}, ORDER)];
  mockDbQuery.mockClear(); Object.values(mockH).forEach((f) => f.mockClear());
});
const tokOf = (html) => { const m = /data-tok="([^"]+)"/.exec(html); return m && m[1].replace(/&amp;/g, '&'); };

describe('token', () => {
  test('aláírás + ellenőrzés; módosított token érvénytelen', () => {
    const t = ops.signAction({ t: 'status', oid: 'A', cid: 7, uid: 3, exp: Date.now() + 1000 });
    expect(ops.verifyAction(t).oid).toBe('A');
    const [b, m] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ t: 'status', oid: 'B', cid: 7, uid: 3, exp: Date.now() + 1000 })).toString('base64url') + '.' + m;
    expect(ops.verifyAction(forged)).toBeNull();
    expect(ops.verifyAction(b + '.x')).toBeNull();
  });
});

describe('műveletek', () => {
  test('kiosztás sofőrnek → kártya, majd végrehajtás comUpdate-tel (+ jármű a párosításból)', async () => {
    const r = await ops.answer(req(), 'Rendeld Petőhöz a CMD-2026-0042-t', [], 'hu', NOW);
    expect(r.action).toBe('assign');
    expect(r.html).toMatch(/Pető-Lőrincz Imre/);
    expect(r.html).not.toMatch(/peto@x\.ro/);
    const x = await ops.executeAction(req(), tokOf(r.html), {}, 'hu');
    expect(x.ok).toBe(true);
    const args = mockH.comUpdate.mock.calls[0][2];
    expect(args[0]).toBe('CMDX1');
    expect(args[1]).toMatchObject({ status: 'Disponibil', sofer_type: 'Intern', email_sofer: 'peto@x.ro', rendszam_camion: 'B104VLR' });
  });

  test('a token más cégnél / más felhasználónál érvénytelen', async () => {
    const r = await ops.answer(req(), 'Rendeld Petőhöz a CMD-2026-0042-t', [], 'hu', NOW);
    const tok = tokOf(r.html);
    expect((await ops.executeAction(req({ company_id: 8 }), tok, {}, 'hu')).ok).toBe(false);
    expect((await ops.executeAction(req({ id: 99 }), tok, {}, 'hu')).ok).toBe(false);
    expect(mockH.comUpdate).not.toHaveBeenCalled();
  });

  test('lejárt token', async () => {
    const tok = ops.signAction({ t: 'status', oid: 'CMDX1', status: 'Finalizat', cid: 7, uid: 3, exp: Date.now() - 1 });
    const x = await ops.executeAction(req(), tok, {}, 'hu');
    expect(x.ok).toBe(false);
    expect(x.err).toMatch(/lejárt/);
  });

  test('státusz-váltás lezártra', async () => {
    const r = await ops.answer(req(), 'Állítsd lezártra a CMD-2026-0042-t', [], 'hu', NOW);
    expect(r.action).toBe('status');
    await ops.executeAction(req(), tokOf(r.html), {}, 'hu');
    expect(mockH.comUpdate.mock.calls[0][2][1]).toEqual({ status: 'Finalizat' });
  });

  test('fizetés: csak Finalizat fuvarra, a hátralék összegével', async () => {
    let r = await ops.answer(req(), 'Jelöld fizetettnek a 0042-t', [], 'hu', NOW);
    expect(r.html).toBe('');
    expect(r.reply).toMatch(/Finalizat/);
    mockOrders[0].status = 'Finalizat'; mockOrders[0].paid_amount = 200;
    r = await ops.answer(req(), 'Jelöld fizetettnek a 0042-t', [], 'hu', NOW);
    expect(r.action).toBe('pay');
    await ops.executeAction(req(), tokOf(r.html), {}, 'hu');
    expect(mockH.markOrderPayment.mock.calls[0][2][1].amount).toBe(1000);
  });

  test('dátum-módosítás „holnapra" — a fuvarszám az előzményből', async () => {
    const r = await ops.answer(req(), 'a lerakás holnaputánra csúszik', ['CMD-2026-0042 hol tart?'], 'hu', NOW);
    expect(r.action).toBe('date');
    await ops.executeAction(req(), tokOf(r.html), {}, 'hu');
    expect(mockH.comUpdate.mock.calls[0][2][1]).toEqual({ data_descarcare: '2026-10-10' });
  });

  test('aktív vázlatnál az előzménybeli fuvarszám nem vált ki műveletet', async () => {
    const r = await ops.answer(req(), 'a lerakás holnaputánra csúszik', ['CMD-2026-0042'], 'hu', NOW, { draftActive: true });
    expect(r == null || r.html === '').toBe(true);
  });

  test('ár-módosítás', async () => {
    const r = await ops.answer(req(), 'A 0042 ára legyen 1350 EUR', [], 'hu', NOW);
    expect(r.action).toBe('price');
    await ops.executeAction(req(), tokOf(r.html), {}, 'hu');
    expect(mockH.comUpdate.mock.calls[0][2][1]).toEqual({ pret: 1350 });
  });

  test('ismeretlen fuvarszám', async () => {
    const r = await ops.answer(req(), 'Rendeld Petőhöz a CMD-2026-9999-et', [], 'hu', NOW);
    expect(r.reply).toMatch(/Nem találom/);
  });

  test('fuvar-leírás (nincs fuvarszám) → nem művelet', async () => {
    expect(await ops.answer(req(), 'Holnap Brassóból Bicskére FTL, Peto vigye, ára 900 EUR', [], 'hu', NOW)).toBeNull();
  });
});

describe('tömeges + dokumentum-nyomkövetés', () => {
  const MONTH = [{ id: 'A1', fuvar_no: 'CMD-2026-0101', status: 'Finalizat', pret: 900, loc_incarcare: 'Cluj', loc_descarcare: 'Arad' },
    { id: 'A2', fuvar_no: 'CMD-2026-0102', status: 'In Curs', pret: 800, loc_incarcare: 'Iasi', loc_descarcare: 'Bacau' }];
  let lastScope = null;
  beforeEach(() => {
    lastScope = null;
    mockRules.push({ match: /SELECT id, denumire FROM clients/, rows: [{ id: 5, denumire: 'Bilka Logistik SRL' }] });
    mockRules.push({ match: /FROM orders o\s+WHERE o.company_id = \$1 AND o.status <> 'Anulat'/, fn: (sql, p) => { lastScope = { sql, p }; return { rows: p[0] === 7 ? MONTH : [] }; } });
  });

  test('hónap-hatókör: név, múlt hónap, év-visszalépés, YYYY-MM', () => {
    expect(ops.monthScope('a szeptemberi fuvarok', NOW)).toMatchObject({ from: '2026-09-01', to: '2026-10-01' });
    expect(ops.monthScope('luna trecuta', NOW).ym).toBe('2026-09');
    expect(ops.monthScope('decemberi', NOW).ym).toBe('2025-12');
    expect(ops.monthScope('toate cursele din 2026-08', NOW).ym).toBe('2026-08');
    expect(ops.monthScope('a mai fuvarok', NOW)).toBeNull();
  });

  test('„a szeptemberi összes fuvart jelöld fizetettnek" → kártya, majd bulk handler', async () => {
    const r = await ops.answer(req(), 'A szeptemberi összes fuvart jelöld fizetettnek', [], 'hu', NOW);
    expect(r.action).toBe('bulk');
    expect(r.html).toMatch(/2 fuvar/);
    expect(r.html).toMatch(/még nincs lezárva/);
    expect(lastScope.p.slice(0, 3)).toEqual([7, '2026-09-01', '2026-10-01']);
    const x = await ops.executeAction(req(), tokOf(r.html), {}, 'hu');
    expect(x.ok).toBe(true);
    const a = mockH.pdBulk.mock.calls[0][2][0];
    expect(a.order_ids).toEqual(['A1', 'A2']);
    expect(a).toMatchObject({ payment_status_ext: 'paid', payment_received_at: '2026-10-08', sync_finance: true });
    expect(x.reply).toMatch(/2 fuvar módosítva/);
  });

  test('több művelet egy mondatban + ügyfél-szűrő (RO)', async () => {
    const r = await ops.answer(req(), 'Toate cursele Bilka din septembrie: finalizează, trimise prin poștă și încasate', [], 'ro', NOW);
    expect(r.action).toBe('bulk');
    expect(lastScope.p[3]).toBe(5);
    await ops.executeAction(req(), tokOf(r.html), {}, 'ro');
    expect(mockH.pdBulk.mock.calls[0][2][0]).toMatchObject({ finalize: true, postal_sent_at: '2026-10-08', payment_status_ext: 'paid' });
  });

  test('„lezárt" mint szűrő, nem művelet', async () => {
    const r = await ops.answer(req(), 'Minden szeptemberi lezárt fuvart jelölj fizetettnek', [], 'hu', NOW);
    expect(r.action).toBe('bulk');
    expect(lastScope.sql).toMatch(/o.status = 'Finalizat'/);
  });

  test('művelet nélkül nem tömeges kártya', async () => {
    const r = await ops.answer(req(), 'Mutasd a szeptemberi összes fuvart', [], 'hu', NOW);
    expect(r == null || r.action !== 'bulk').toBe(true);
  });

  test('a tömeges token más cégnél érvénytelen', async () => {
    const r = await ops.answer(req(), 'A szeptemberi összes fuvart postáztuk', [], 'hu', NOW);
    expect((await ops.executeAction(req({ company_id: 8 }), tokOf(r.html), {}, 'hu')).ok).toBe(false);
    expect(mockH.pdBulk).not.toHaveBeenCalled();
  });

  test('egy fuvar: postázás + számlaszám → setOrderPostDelivery', async () => {
    const r = await ops.answer(req(), 'A 0042-t postáztuk, számlaszám FCT-123', [], 'hu', NOW);
    expect(r.action).toBe('pd');
    await ops.executeAction(req(), tokOf(r.html), {}, 'hu');
    expect(mockH.pdOne.mock.calls[0][2][0]).toEqual({ order_id: 'CMDX1', postal_sent_at: '2026-10-08', invoice_no: 'FCT-123' });
  });
});

describe('javaslat', () => {
  test('radar-találat → kiosztó gomb plannerAssign-nal', async () => {
    mockH.getPlannerMatches.mockImplementationOnce((rq, res) => res.json({ result: { ok: true, matches: [{ order_id: 'CMDX1', suggestions: [{ rendszam: 'B104VLR', km: 35, honnan: 'Sibiu, RO', live: true }] }] } }));
    const r = await ops.answer(req(), 'Ki vihetné a CMD-2026-0042-t?', [], 'hu', NOW);
    expect(r.html).toMatch(/B104VLR/);
    expect(r.html).toMatch(/35 km/);
    await ops.executeAction(req(), tokOf(r.html), {}, 'hu');
    expect(mockH.plannerAssign.mock.calls[0][2]).toEqual(['CMDX1', { rendszam_camion: 'B104VLR' }]);
  });
  test('nincs radar-találat → szabad sofőrök', async () => {
    mockRules.push({ match: /NOT EXISTS \(SELECT 1 FROM orders o/, rows: [{ nume: 'Ion Popescu', email: 'ion@x.ro', rendszam: 'CJ01ABC' }] });
    const r = await ops.answer(req(), 'Ki vihetné a 0042-t?', [], 'hu', NOW);
    expect(r.html).toMatch(/Ion Popescu/);
  });
});

describe('cégszintű kérdések', () => {
  test('napi összefoglaló', async () => {
    const b = await ops.brief(req(), 'hu');
    expect(b.html).toMatch(/Mai összefoglaló/);
    expect(b.html).toMatch(/ITP lejárt/);
    expect(b.html).toMatch(/Hiányzó menetlevél/);
  });
  test('ki tartozik — Manager pénzügyi jog nélkül tiltva', async () => {
    const r = await ops.answer(req({ pozicio: 'Manager' }), 'Ki tartozik nekünk?', [], 'hu', NOW);
    expect(r.html).toMatch(/nincs pénzügyi jogosultságod/);
  });
  test('ki tartozik — Admin, cégre szűrt összesítés', async () => {
    mockRules.push({ match: /GROUP BY 1 ORDER BY 3 DESC/, fn: (sql, p) => { expect(p[0]).toBe(7); return { rows: [{ client: 'Bilka', db: 2, unpaid: 1500, overdue: 500, oldest: '2026-08-01' }] }; } });
    const r = await ops.answer(req(), 'Ki tartozik?', [], 'hu', NOW);
    expect(r.html).toMatch(/Bilka/);
    expect(r.html).toMatch(/1\.500,00/);
  });
  test('lejáró dokumentumok', async () => {
    mockRules.push({ match: /FROM document_expiries/, rows: [{ entity_label: 'B104VLR', doc_type: 'ITP', expiry_date: '2026-10-12', days_left: 4 }] });
    const r = await ops.answer(req(), 'Mi jár le hamarosan? ITP, RCA?', [], 'hu', NOW);
    expect(r.html).toMatch(/ITP/);
  });
  test('esedékes szerviz', async () => {
    const r = await ops.answer(req(), 'Melyik autónak esedékes a szerviz?', [], 'hu', NOW);
    expect(r.html).toMatch(/Olajcsere/);
  });
  test('minden saját lekérdezés company_id-szűrt', async () => {
    await ops.answer(req(), 'Ki tartozik?', [], 'hu', NOW);
    await ops.brief(req(), 'hu');
    for (const [sql, params] of mockDbQuery.mock.calls) {
      expect(sql).toMatch(/company_id/);
      expect(params[0] === 7 || params.includes(7)).toBe(true);
    }
  });
});

describe('árajánlat', () => {
  test('útvonal + javasolt ár + mentés quoteSave-vel', async () => {
    const r = await ops.answer(req(), 'Mennyibe kerülne Kolozsvárról Budapestre 13 t?', [], 'hu', NOW);
    expect(r.kind).toBe('quote');
    expect(r.html).toMatch(/450 km/);
    expect(r.html).toMatch(/Javasolt ár/);
    // alapértelmezett 1,3 EUR/km × 450 = 585 → kerekítve 590
    expect(r.html).toMatch(/590 EUR/);
    const tok = tokOf(r.html);
    expect((await ops.executeAction(req(), tok, {}, 'hu')).ok).toBe(false); // ügyfél-név nélkül nem
    const x = await ops.executeAction(req(), tok, { client_name: 'Bilka SRL' }, 'hu');
    expect(x.ok).toBe(true);
    expect(mockH.quoteSave.mock.calls[0][2][0]).toMatchObject({ client_name: 'Bilka SRL', loc_from: 'Kolozsvár', loc_to: 'Budapest', price: 590 });
  });
  test('útvonal nélkül visszakérdez', async () => {
    const r = await ops.answer(req(), 'Mennyibe kerülne egy fuvar?', [], 'hu', NOW);
    expect(r.reply).toMatch(/Honnan hova/);
  });
});

describe('WhatsApp-üzenet', () => {
  test('wa.me link előre kitöltött szöveggel; e-mail nem kerül ki', async () => {
    mockRules.push({ match: /SELECT tel FROM users WHERE company_id = \$1/, rows: [{ tel: '0745 123 456' }] });
    const r = await ops.answer(req(), 'Írd meg Petőnek, hogy a lerakó 14:00-ra módosult', [], 'hu', NOW);
    expect(r.html).toMatch(/https:\/\/wa\.me\/40745123456\?text=/);
    expect(r.html).toMatch(/Szia Imre! A lerakó 14:00-ra módosult\./);
    expect(r.html).not.toMatch(/peto@x\.ro/);
  });
  test('nincs telefonszám → jelzés', async () => {
    const r = await ops.answer(req(), 'Írd meg Petőnek, hogy hívjon', [], 'hu', NOW);
    expect(r.html).toMatch(/telefonszáma nincs megadva/);
  });
});
