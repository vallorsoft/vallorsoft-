const { validatePassword, MIN_LEN } = require('../../lib/passwordPolicy');

describe('passwordPolicy.validatePassword', () => {
  test('elfogad egy szabályos jelszót (8+ kis/nagy/szám/szimbólum)', () => {
    expect(validatePassword('Abcdef1_').ok).toBe(true);
    expect(validatePassword('Hello_World9').ok).toBe(true);
    expect(validatePassword('Xy9$abcd').ok).toBe(true); // más szimbólum is jó
  });

  test('elutasít, ha túl rövid (< 8)', () => {
    const r = validatePassword('Abc1_de');
    expect(r.ok).toBe(false);
    expect(typeof r.err).toBe('string');
  });

  test('elutasít kisbetű nélkül', () => {
    expect(validatePassword('ABCDEF1_').ok).toBe(false);
  });

  test('elutasít nagybetű nélkül', () => {
    expect(validatePassword('abcdef1_').ok).toBe(false);
  });

  test('elutasít számjegy nélkül', () => {
    expect(validatePassword('Abcdefg_').ok).toBe(false);
  });

  test('elutasít szimbólum nélkül', () => {
    expect(validatePassword('Abcdefg1').ok).toBe(false);
  });

  test('elutasít üres / null / undefined értéket', () => {
    expect(validatePassword('').ok).toBe(false);
    expect(validatePassword(null).ok).toBe(false);
    expect(validatePassword(undefined).ok).toBe(false);
  });

  test('a minimum hossz 8', () => {
    expect(MIN_LEN).toBe(8);
  });
});
