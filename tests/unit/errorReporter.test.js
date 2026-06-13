// ============================================================
//  lib/errorReporter — opcionális Sentry (kulcs nélkül no-op)
// ============================================================
const er = require('../../lib/errorReporter');

describe('lib/errorReporter', () => {
  test('SENTRY_DSN nélkül nincs engedélyezve, a capture biztonságos no-op', () => {
    const old = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    expect(er.init()).toBe(false);
    expect(er.isEnabled()).toBe(false);
    expect(er.capture(new Error('x'))).toBe(false);
    expect(er.capture(new Error('y'), { a: 1 })).toBe(false);
    if (old !== undefined) process.env.SENTRY_DSN = old;
  });
});
