// ============================================================
//  Unit-teszt — services/cargotrack-monitor.js
//  A CargoTrack (Ruptela FM-Track) hitelesítési hiba-figyelő:
//   - 1-2 hiba még nem küld e-mailt
//   - 3+ (küszöb) hiba a rolling ablakban → EGY riasztás megy
//   - Debounce (6h) ideje alatt újabb 3 hiba se küld
//   - Csak 401/403 számít; 500 / 429 nem triggerelik
//   - Sikeres e-mail-küldés nélkül is nyeli a hibát (nem borul)
// ============================================================
'use strict';

// A sendClientEmail-t mockoljuk — nem küldünk valódi levelet.
const sentMails = [];
jest.mock('../../services/email', () => ({
  sendClientEmail: jest.fn(async (opts) => {
    sentMails.push(opts);
    return { ok: true, messageId: 'mock-' + Date.now() };
  }),
}));

const monitor = require('../../services/cargotrack-monitor');
const { sendClientEmail } = require('../../services/email');

beforeEach(() => {
  sentMails.length = 0;
  sendClientEmail.mockClear();
  monitor._resetForTests();
  delete process.env.DEV_NOTIFY_EMAIL;
});

describe('cargotrack-monitor.recordAuthFailure', () => {
  test('küszöb alatt (2 db 403) NEM küld e-mailt', () => {
    const now = 1000000;
    monitor.recordAuthFailure(403, { now: now });
    monitor.recordAuthFailure(403, { now: now + 1000 });
    expect(sendClientEmail).not.toHaveBeenCalled();
    expect(monitor._getStateForTests().count).toBe(2);
  });

  test('küszöb elérésekor (3. hiba) EGY e-mailt küld és nullázza a listát', () => {
    const now = 2000000;
    monitor.recordAuthFailure(403, { now: now });
    monitor.recordAuthFailure(401, { now: now + 1000 });
    monitor.recordAuthFailure(403, { now: now + 2000 });
    expect(sendClientEmail).toHaveBeenCalledTimes(1);
    const mail = sentMails[0];
    expect(mail.to).toBe('vallorsoft@gmail.com'); // fallback ha nincs DEV_NOTIFY_EMAIL
    expect(mail.subject).toMatch(/CargoTrack/i);
    expect(mail.html).toMatch(/209\.71\.106\.103/); // az egress IP a levélben
    expect(mail.html).toMatch(/HTTP státusz.*401.*403|401.*403/); // uniq statuszok
    expect(mail.mailType).toBe('cargotrack_alert');
    expect(monitor._getStateForTests().count).toBe(0); // nullázva
  });

  test('DEV_NOTIFY_EMAIL env felülírja a fallback címzettet', () => {
    process.env.DEV_NOTIFY_EMAIL = 'ops@example.com';
    const now = 3000000;
    monitor.recordAuthFailure(403, { now: now });
    monitor.recordAuthFailure(403, { now: now + 1 });
    monitor.recordAuthFailure(403, { now: now + 2 });
    expect(sentMails[0].to).toBe('ops@example.com');
  });

  test('debounce (6h) idején belül a KÖVETKEZŐ 3 hiba NEM küld új e-mailt', () => {
    const now = 4000000;
    // első alert-round
    monitor.recordAuthFailure(403, { now: now });
    monitor.recordAuthFailure(403, { now: now + 1 });
    monitor.recordAuthFailure(403, { now: now + 2 });
    expect(sendClientEmail).toHaveBeenCalledTimes(1);
    // 3 óra múlva újabb 3 hiba — a debounce-ablakban → nincs új mail
    const later = now + 3 * 60 * 60 * 1000;
    monitor.recordAuthFailure(403, { now: later });
    monitor.recordAuthFailure(403, { now: later + 1 });
    monitor.recordAuthFailure(403, { now: later + 2 });
    expect(sendClientEmail).toHaveBeenCalledTimes(1); // változatlan
  });

  test('debounce lejárta UTÁN újabb küszöb-túllépés MÁSODIK e-mailt küld', () => {
    const now = 5000000;
    monitor.recordAuthFailure(403, { now: now });
    monitor.recordAuthFailure(403, { now: now + 1 });
    monitor.recordAuthFailure(403, { now: now + 2 });
    expect(sendClientEmail).toHaveBeenCalledTimes(1);
    // 6h + 1 másodperc múlva — a debounce lejárt
    const later = now + 6 * 60 * 60 * 1000 + 1000;
    monitor.recordAuthFailure(403, { now: later });
    monitor.recordAuthFailure(403, { now: later + 1 });
    monitor.recordAuthFailure(403, { now: later + 2 });
    expect(sendClientEmail).toHaveBeenCalledTimes(2);
  });

  test('a 10 perces ablakon KÍVÜLI régi hibák NEM számítanak a küszöbbe', () => {
    const now = 6000000;
    // 2 hiba — ablakon KÍVÜL (15 perce)
    const old = now - 15 * 60 * 1000;
    monitor.recordAuthFailure(403, { now: old });
    monitor.recordAuthFailure(403, { now: old + 1000 });
    // Most csak 1 friss — összesen kellene 3 az ablakban, de csak 1 van → NINCS mail
    monitor.recordAuthFailure(403, { now: now });
    expect(sendClientEmail).not.toHaveBeenCalled();
  });

  test('csak 401/403 számít — 500 / 429 / 404 nem triggerel', () => {
    const now = 7000000;
    monitor.recordAuthFailure(500, { now: now });
    monitor.recordAuthFailure(429, { now: now + 1 });
    monitor.recordAuthFailure(404, { now: now + 2 });
    monitor.recordAuthFailure(500, { now: now + 3 });
    expect(sendClientEmail).not.toHaveBeenCalled();
    expect(monitor._getStateForTests().count).toBe(0);
  });

  test('ha a sendClientEmail dob, a monitor NEM borítja a hívót', () => {
    sendClientEmail.mockImplementationOnce(async () => {
      throw new Error('Brevo down');
    });
    const now = 8000000;
    // 3 hiba → egy alert megpróbál kimenni és elbukik — ne dobjon
    expect(() => {
      monitor.recordAuthFailure(403, { now: now });
      monitor.recordAuthFailure(403, { now: now + 1 });
      monitor.recordAuthFailure(403, { now: now + 2 });
    }).not.toThrow();
    // lastAlertAt akkor is beállítódik (debounce őrzi a spamet elbukott mail esetén is)
    expect(monitor._getStateForTests().lastAlertAt).toBe(now + 2);
  });

  test('egyáltalán nem-tömbi status (undefined, negatív) csendben skipppel', () => {
    monitor.recordAuthFailure(undefined, { now: 9000000 });
    monitor.recordAuthFailure(null,      { now: 9000001 });
    monitor.recordAuthFailure(-1,        { now: 9000002 });
    expect(sendClientEmail).not.toHaveBeenCalled();
    expect(monitor._getStateForTests().count).toBe(0);
  });
});

// A cargotrack.js-be beépített hívás integrációs ellenőrzése — nincs valódi HTTP,
// csak megnézzük, hogy a monitor tényleg meghívódik 401 esetén.
describe('cargotrack.js integráció — fmGet -> monitor bekötés', () => {
  test('fmGet 401 esetén meghívja a monitort', async () => {
    // Cargotrack-modult friss betöltés + fetch mock
    jest.resetModules();
    // Újramockoljuk az email-t (mert resetModules után új monitor is jön)
    jest.doMock('../../services/email', () => ({
      sendClientEmail: jest.fn(async () => ({ ok: true })),
    }));
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'invalid api key',
    }));
    const ct = require('../../services/cargotrack');
    const mon = require('../../services/cargotrack-monitor');
    mon._resetForTests();
    // Egy hívás — el kell dobja a mapelt hibát ÉS regisztrálnia kell a monitorba
    await expect(ct.listObjects('bad-key')).rejects.toThrow(/401/);
    expect(mon._getStateForTests().count).toBe(1);
  });
});
