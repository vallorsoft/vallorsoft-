// ============================================================
//  lib/logger — strukturált logger (tiszta darabok tesztje)
// ============================================================
const log = require('../../lib/logger');

describe('lib/logger', () => {
  test('buildRecord: t/level/msg mindig van, a mezők hozzáfűződnek', () => {
    const r = log.buildRecord('info', 'hello', { a: 1, path: '/x' });
    expect(r.level).toBe('info');
    expect(r.msg).toBe('hello');
    expect(r.a).toBe(1);
    expect(r.path).toBe('/x');
    expect(typeof r.t).toBe('string');
  });

  test('buildRecord: a fields NEM írhatja felül a t/level/msg kulcsokat', () => {
    const r = log.buildRecord('warn', 'm', { level: 'HACK', msg: 'HACK', t: 'HACK', ok: true });
    expect(r.level).toBe('warn');
    expect(r.msg).toBe('m');
    expect(r.t).not.toBe('HACK');
    expect(r.ok).toBe(true);
  });

  test('formatRecord: JSON módban érvényes JSON-sor', () => {
    const old = process.env.LOG_FORMAT;
    process.env.LOG_FORMAT = 'json';
    const s = log.formatRecord(log.buildRecord('error', 'boom', { code: 500 }));
    expect(() => JSON.parse(s)).not.toThrow();
    expect(JSON.parse(s).code).toBe(500);
    process.env.LOG_FORMAT = old;
  });

  test('küszöb: alapból (info) a debug nem naplóz, az info/warn/error igen', () => {
    const old = process.env.LOG_LEVEL;
    delete process.env.LOG_LEVEL;
    expect(log.debug('z')).toBeNull();
    expect(log.info('x')).not.toBeNull();
    expect(log.error('y')).not.toBeNull();
    if (old !== undefined) process.env.LOG_LEVEL = old;
  });
});
