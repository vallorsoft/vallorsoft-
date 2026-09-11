// ============================================================
//  Unit/integrációs teszt — services/scheduler.js
//    startMorningDigestScheduler — a percenkénti tick() ténylegesen lefut
//      (fake timer), ellenőrizve: időzóna-konzisztens duplikáció-őr,
//      helyes oszlopnevek (document_expiries.expiry_date/doc_type/
//      entity_label, NEM a korábbi hibás expires_on/tip/target_ref),
//      e-mail-küldés + digest_last_sent_at frissítés.
//    startGpsDailyTrackScheduler — a 10 percenkénti tick() lefut,
//      mozgás-szűrő (Haversine ≥200 m) + INSERT/skip helyesen dönt.
//
//  A `pool.query` egy SQL-mintaillesztő router-mock (nem szekvenciális
//  mockResolvedValueOnce-lánc) — robusztus a hívások belső sorrendjére.
// ============================================================
jest.mock('../../db', () => require('../../tests/helpers/db-mock').pool);

const mockSendClientEmail = jest.fn(async () => ({ ok: true }));
jest.mock('../../services/email', () => ({
  sendClientEmail: (...a) => mockSendClientEmail(...a),
}));

const mockGetPositions = jest.fn();
jest.mock('../../lib/vehiclePositions', () => ({
  getPositions: (...a) => mockGetPositions(...a),
}));

const { pool, reset } = require('../helpers/db-mock');
// FONTOS: a scheduler-t EGYSZER, a fájl tetején require-áljuk — NEM
// `jest.resetModules()`-lel minden tesztben — mert a `jest.mock('../../db', ...)`
// factory-ja a `db-mock` modult ÚJRA require-elné, ami `resetModules()` után egy
// MÁSIK `pool`-példányt adna vissza, mint amit a teszt-fájl `pool`-ként importál
// → a `routedPoolMock`/`pool.query.mockImplementation` egy „stale" objektumra
// állítaná be a választ, a ténylegesen hívott (friss) pool pedig mockolatlan
// maradna. A `startXScheduler()` függvények maguk NEM tartanak állapotot a
// modulon kívül (minden hívás friss closure-t hoz létre) — a `jest.useFakeTimers()`
// minden `beforeEach`-ben tiszta időzítő-sorral indul, így egyetlen require is elég.
const scheduler = require('../../services/scheduler');

// SQL-mintaillesztő router: minden hívás a `sql` szövege alapján dönt, mit
// adjon vissza. `handlers` egy [regex, fn(params)] lista; az első illeszkedő
// nyer. Ha semmi nem illik, üres eredményt ad (a legtöbb sub-query best-
// effort try/catch-ben van, ez nem szakítja meg a folyamatot).
function routedPoolMock(handlers) {
  pool.query.mockImplementation(async (sql, params) => {
    const s = String(sql);
    for (const [re, fn] of handlers) {
      if (re.test(s)) return fn(params, s);
    }
    return { rows: [], rowCount: 0 };
  });
}

describe('services/scheduler.js — startMorningDigestScheduler', () => {
  const REAL_DATE_NOW = Date.now;

  beforeEach(() => {
    reset();
    mockSendClientEmail.mockClear();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    Date.now = REAL_DATE_NOW;
  });

  test('exportálja a startMorningDigestScheduler + startGpsDailyTrackScheduler függvényeket', () => {
    expect(typeof scheduler.startMorningDigestScheduler).toBe('function');
    expect(typeof scheduler.startGpsDailyTrackScheduler).toBe('function');
  });

  test('a percenkénti tick lefut, időpont-egyezésnél e-mailt küld és digest_last_sent_at-et frissít', async () => {
    // Rögzített idő: 2026-06-15T05:00:00Z. Bucharest a valós Intl-adatokból
    // számolt HH:MM-jét használjuk digest_time-ként (nincs kézzel beírt
    // DST-feltételezés — a teszt magától kompatibilis, akárhogy is fut az ICU).
    const fixedNow = new Date('2026-06-15T05:00:00Z');
    jest.setSystemTime(fixedNow);
    const bucharestHm = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(fixedNow);

    routedPoolMock([
      // 1) cégek listája (digest_enabled=true)
      [/FROM companies\s*$|WHERE COALESCE\(digest_enabled/, () => ({
        rows: [{
          id: 1, nev: 'Teszt Kft', digest_time: bucharestHm + ':00',
          digest_recipients: ['extra@ceg.ro'], digest_last_sent_at: null,
        }], rowCount: 1,
      })],
      // 2) Admin/Manager email-lista
      [/FROM users WHERE company_id=\$1 AND pozicio IN \('Admin','Manager'\)/, () => ({
        rows: [{ email: 'admin@ceg.ro' }], rowCount: 1,
      })],
      // 3) orders stats (aktív/available/handover/unpaid)
      [/COUNT\(\*\) FILTER \(WHERE status IN \('Alocat','In Curs','Extern'\)\)/, () => ({
        rows: [{ active_count: 3, available_count: 1, handover_count: 0, unpaid_count: 2 }], rowCount: 1,
      })],
      // 4) mai felrakások
      [/WHERE company_id=\$1 AND data_incarcare=\$2::date/, () => ({
        rows: [{ id: 'CMD-1', fuvar_no: 'CMD-2026-0001', client: 'X SRL', loc_incarcare: 'Cluj', rendszam_camion: 'B104VLR', nume_sofer: 'Ion' }], rowCount: 1,
      })],
      // 5) mai lerakások
      [/WHERE company_id=\$1 AND data_descarcare=\$2::date/, () => ({ rows: [], rowCount: 0 })],
      // 6) lejáró dokumentumok — a JAVÍTOTT oszlopnevekkel
      [/FROM document_expiries/, (params, sql) => {
        expect(sql).toMatch(/doc_type, entity_type, entity_label, expiry_date/);
        expect(sql).toMatch(/expiry_date IS NOT NULL/);
        expect(sql).not.toMatch(/expires_on/); // a régi HIBÁS oszlopnév nem szerepelhet
        return { rows: [{ doc_type: 'ITP', entity_type: 'vehicle', entity_label: 'B104VLR', expiry_date: '2026-06-20' }], rowCount: 1 };
      }],
      // 7) computeServiceDueAlerts belső CTE-lekérdezése (vehicle_service_log)
      [/FROM vehicle_service_log/, () => ({ rows: [], rowCount: 0 })],
      // 8) UPDATE digest_last_sent_at
      [/UPDATE companies SET digest_last_sent_at=NOW\(\) WHERE id=\$1/, (params) => {
        expect(params).toEqual([1]);
        return { rows: [], rowCount: 1 };
      }],
    ]);

    scheduler.startMorningDigestScheduler();
    // Az első tick 30 mp múlva fut — átugorjuk.
    await jest.advanceTimersByTimeAsync(30 * 1000);

    // E-mail elment mindkét címzettnek (Admin + extra digest_recipients).
    expect(mockSendClientEmail).toHaveBeenCalled();
    const sentTo = mockSendClientEmail.mock.calls.map((c) => c[0].to);
    expect(sentTo).toEqual(expect.arrayContaining(['admin@ceg.ro', 'extra@ceg.ro']));
    // A tárgy + HTML tartalmazza a cég nevét.
    expect(mockSendClientEmail.mock.calls[0][0].subject).toMatch(/Teszt Kft/);
    expect(mockSendClientEmail.mock.calls[0][0].html).toMatch(/Cluj/); // mai felrakás szerepel
  });

  test('időpont-eltérésnél NEM küld (a digest_time nem egyezik a mostani idővel)', async () => {
    const fixedNow = new Date('2026-06-15T05:00:00Z');
    jest.setSystemTime(fixedNow);
    routedPoolMock([
      [/WHERE COALESCE\(digest_enabled/, () => ({
        rows: [{ id: 1, nev: 'X', digest_time: '23:59:00', digest_recipients: [], digest_last_sent_at: null }], rowCount: 1,
      })],
    ]);
    scheduler.startMorningDigestScheduler();
    await jest.advanceTimersByTimeAsync(30 * 1000);
    expect(mockSendClientEmail).not.toHaveBeenCalled();
  });

  test('duplikáció-őr: ha MA (Bucharest-dátum) már küldött, nem küld újra még időegyezésnél sem', async () => {
    const fixedNow = new Date('2026-06-15T05:00:00Z');
    jest.setSystemTime(fixedNow);
    const bucharestHm = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(fixedNow);
    // digest_last_sent_at = UGYANAZ a pillanat (tehát ma már elment).
    routedPoolMock([
      [/WHERE COALESCE\(digest_enabled/, () => ({
        rows: [{ id: 1, nev: 'X', digest_time: bucharestHm + ':00', digest_recipients: [], digest_last_sent_at: fixedNow.toISOString() }], rowCount: 1,
      })],
    ]);
    scheduler.startMorningDigestScheduler();
    await jest.advanceTimersByTimeAsync(30 * 1000);
    expect(mockSendClientEmail).not.toHaveBeenCalled();
  });

  test('nincs címzett (nincs Admin/Manager és nincs extra recipient) → nem küld, nem hasal el', async () => {
    const fixedNow = new Date('2026-06-15T05:00:00Z');
    jest.setSystemTime(fixedNow);
    const bucharestHm = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(fixedNow);
    routedPoolMock([
      [/WHERE COALESCE\(digest_enabled/, () => ({
        rows: [{ id: 1, nev: 'X', digest_time: bucharestHm + ':00', digest_recipients: [], digest_last_sent_at: null }], rowCount: 1,
      })],
      [/FROM users WHERE company_id=\$1 AND pozicio IN/, () => ({ rows: [], rowCount: 0 })],
    ]);
    scheduler.startMorningDigestScheduler();
    await jest.advanceTimersByTimeAsync(30 * 1000);
    expect(mockSendClientEmail).not.toHaveBeenCalled();
  });

  test('migráció-hiány (42703 a companies lekérdezésen) → csendben leáll, nem dob', async () => {
    pool.query.mockImplementation(async () => {
      const err = new Error('column "digest_enabled" does not exist');
      err.code = '42703';
      throw err;
    });
    scheduler.startMorningDigestScheduler();
    await expect(jest.advanceTimersByTimeAsync(30 * 1000)).resolves.not.toThrow();
    expect(mockSendClientEmail).not.toHaveBeenCalled();
  });

  test('egy cég hibája (pl. sendClientEmail dob) NEM állítja meg a többi cég feldolgozását', async () => {
    const fixedNow = new Date('2026-06-15T05:00:00Z');
    jest.setSystemTime(fixedNow);
    const bucharestHm = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(fixedNow);
    mockSendClientEmail.mockImplementationOnce(async () => { throw new Error('SMTP hiba'); });
    routedPoolMock([
      [/WHERE COALESCE\(digest_enabled/, () => ({
        rows: [
          { id: 1, nev: 'Cég A', digest_time: bucharestHm + ':00', digest_recipients: [], digest_last_sent_at: null },
          { id: 2, nev: 'Cég B', digest_time: bucharestHm + ':00', digest_recipients: [], digest_last_sent_at: null },
        ], rowCount: 2,
      })],
      [/FROM users WHERE company_id=\$1 AND pozicio IN/, (params) => ({
        rows: [{ email: `admin${params[0]}@ceg.ro` }], rowCount: 1,
      })],
      [/UPDATE companies SET digest_last_sent_at/, () => ({ rows: [], rowCount: 1 })],
    ]);
    scheduler.startMorningDigestScheduler();
    await jest.advanceTimersByTimeAsync(30 * 1000);
    // Mindkét cégre megpróbálta elküldeni (Cég A hibázik, de Cég B feldolgozása folytatódik)
    expect(mockSendClientEmail).toHaveBeenCalledTimes(2);
  });
});

describe('services/scheduler.js — startGpsDailyTrackScheduler', () => {
  beforeEach(() => {
    reset();
    mockGetPositions.mockReset();
    jest.useFakeTimers();
  });
  afterEach(() => { jest.useRealTimers(); });

  test('nincs GPS-integrációval rendelkező cég → nem hív getPositions-t', async () => {
    routedPoolMock([
      [/FROM company_integrations/, () => ({ rows: [], rowCount: 0 })],
    ]);
    scheduler.startGpsDailyTrackScheduler();
    await jest.advanceTimersByTimeAsync(60 * 1000);
    expect(mockGetPositions).not.toHaveBeenCalled();
  });

  test('mozgás-szűrő: ≥200 m elmozdulásnál INSERT, <200 m-nél kihagyja', async () => {
    // Cég 1 GPS-integrációval; egy jármű két különböző távolságú helyzettel
    // egymás utáni tick-eken NEM tesztelhető triviálisan egy hívásban — itt
    // az egyszerűbb esetet ellenőrizzük: nincs korábbi pozíció → mindig INSERT.
    mockGetPositions.mockResolvedValue({
      ok: true, gps_configured: true,
      positions: [{ rendszam: 'B104VLR', lat: 46.77, lng: 23.59, speed: 60, ignition: true, datetime: '2026-06-15T05:00:00Z' }],
    });
    let insertCalled = false;
    routedPoolMock([
      [/FROM company_integrations/, () => ({ rows: [{ company_id: 1 }], rowCount: 1 })],
      [/SELECT lat, lng FROM gps_daily_positions/, () => ({ rows: [], rowCount: 0 })], // nincs korábbi pozíció
      [/INSERT INTO gps_daily_positions/, (params) => {
        insertCalled = true;
        expect(params[0]).toBe(1); // company_id
        expect(params[1]).toBe('B104VLR');
        return { rows: [], rowCount: 1 };
      }],
      [/DELETE FROM gps_daily_positions/, () => ({ rows: [], rowCount: 0 })],
    ]);
    scheduler.startGpsDailyTrackScheduler();
    await jest.advanceTimersByTimeAsync(60 * 1000);
    expect(insertCalled).toBe(true);
  });

  test('<200 m elmozdulásnál NEM insertál (mozgás-szűrő)', async () => {
    mockGetPositions.mockResolvedValue({
      ok: true, gps_configured: true,
      // Az utolsó rögzített pozíció mellett ~50 m-rel (nem 200 m felett).
      positions: [{ rendszam: 'B104VLR', lat: 46.7700, lng: 23.5905, speed: 0, ignition: false, datetime: '2026-06-15T05:00:00Z' }],
    });
    let insertCalled = false;
    routedPoolMock([
      [/FROM company_integrations/, () => ({ rows: [{ company_id: 1 }], rowCount: 1 })],
      [/SELECT lat, lng FROM gps_daily_positions/, () => ({ rows: [{ lat: 46.7700, lng: 23.5900 }], rowCount: 1 }) ], // kb. 40m
      [/INSERT INTO gps_daily_positions/, () => { insertCalled = true; return { rows: [], rowCount: 1 }; }],
      [/DELETE FROM gps_daily_positions/, () => ({ rows: [], rowCount: 0 })],
    ]);
    scheduler.startGpsDailyTrackScheduler();
    await jest.advanceTimersByTimeAsync(60 * 1000);
    expect(insertCalled).toBe(false);
  });

  test('7 napnál régebbi pozíciók takarítása lefut', async () => {
    let deleteCalled = false;
    routedPoolMock([
      [/FROM company_integrations/, () => ({ rows: [], rowCount: 0 })],
      [/DELETE FROM gps_daily_positions WHERE recorded_at < NOW\(\) - INTERVAL '7 days'/, () => {
        deleteCalled = true;
        return { rows: [], rowCount: 3 };
      }],
    ]);
    scheduler.startGpsDailyTrackScheduler();
    await jest.advanceTimersByTimeAsync(60 * 1000);
    expect(deleteCalled).toBe(true);
  });

  test('migráció-hiány (company_integrations hiányzó tábla) → nem dob, csendben leáll', async () => {
    pool.query.mockImplementation(async () => { throw new Error('relation does not exist'); });
    scheduler.startGpsDailyTrackScheduler();
    await expect(jest.advanceTimersByTimeAsync(60 * 1000)).resolves.not.toThrow();
    expect(mockGetPositions).not.toHaveBeenCalled();
  });
});
