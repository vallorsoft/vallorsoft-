// ============================================================
//  lib/crypto.js — AES-256-GCM integrációs kulcs titkosítás
// ============================================================
const crypto = require('crypto');
const { encrypt, decrypt, mask } = require('../../lib/crypto');

// 32 byte-os teszt mester-kulcs (hex).
const TEST_KEY = crypto.randomBytes(32).toString('hex');

describe('lib/crypto', () => {
  beforeEach(() => { process.env.INTEGRATION_ENC_KEY = TEST_KEY; });

  test('encrypt → decrypt visszaadja az eredeti szöveget (round-trip)', () => {
    const plain = 'titkos-FGO-PrivateKey-12345';
    const blob = encrypt(plain);
    // A titkosított blob nem egyezik az eredetivel, és iv.tag.ct formátumú.
    expect(blob).not.toBe(plain);
    expect(blob.split('.')).toHaveLength(3);
    expect(decrypt(blob)).toBe(plain);
  });

  test('két titkosítás eltérő blobot ad (random IV)', () => {
    expect(encrypt('ugyanaz')).not.toBe(encrypt('ugyanaz'));
  });

  test('hiányzó INTEGRATION_ENC_KEY esetén dob', () => {
    delete process.env.INTEGRATION_ENC_KEY;
    expect(() => encrypt('x')).toThrow(/INTEGRATION_ENC_KEY/);
  });

  test('rossz hosszúságú kulcs esetén dob', () => {
    process.env.INTEGRATION_ENC_KEY = 'rovidkulcs';
    expect(() => encrypt('x')).toThrow(/32 byte/);
  });

  test('mask csak az utolsó 4 karaktert mutatja', () => {
    expect(mask('abcdefgh1234')).toMatch(/1234$/);
    expect(mask('ab')).toBe('••••');
  });
});
