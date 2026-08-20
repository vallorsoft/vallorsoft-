// tests/unit/uit-format.test.js — lib/uitFormat + public/uit-format viselkedés.
'use strict';

const { normalizeUit, formatUit, isValidUit, UIT_MAX } = require('../../lib/uitFormat');

describe('lib/uitFormat.normalizeUit', () => {
  test('nagybetűsít, kötőjelet + szóközt kidob', () => {
    expect(normalizeUit('abcd-1234-xyz0')).toBe('ABCD1234XYZ0');
    expect(normalizeUit('  ab cd  12 34  ')).toBe('ABCD1234');
    expect(normalizeUit('AB-CD-1234')).toBe('ABCD1234');
  });
  test('nem alfanumerikus karaktereket kidob', () => {
    expect(normalizeUit('abcd_1234')).toBe('ABCD1234');
    expect(normalizeUit('AB@CD#12$34')).toBe('ABCD1234');
    expect(normalizeUit('Á-É-Í')).toBe('');
  });
  test('max 16 karakterre vágja', () => {
    expect(normalizeUit('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toHaveLength(UIT_MAX);
    expect(normalizeUit('ABCDEFGHIJKLMNOPQ')).toBe('ABCDEFGHIJKLMNOP');
  });
  test('null/undefined/üres → üres string', () => {
    expect(normalizeUit(null)).toBe('');
    expect(normalizeUit(undefined)).toBe('');
    expect(normalizeUit('')).toBe('');
  });
});

describe('lib/uitFormat.formatUit', () => {
  test('4-esével kötőjellel tagol', () => {
    expect(formatUit('abcd1234xyz0')).toBe('ABCD-1234-XYZ0');
    expect(formatUit('AB')).toBe('AB');
    expect(formatUit('ABCD')).toBe('ABCD');
    expect(formatUit('ABCDE')).toBe('ABCD-E');
    expect(formatUit('ABCDEFGHIJKLMNOP')).toBe('ABCD-EFGH-IJKL-MNOP');
  });
  test('normalizál majd tagol — a bemenet lehet kotojeles is', () => {
    expect(formatUit('ab-cd-12-34')).toBe('ABCD-1234');
    expect(formatUit('abcd 1234 xyz0')).toBe('ABCD-1234-XYZ0');
  });
  test('üres → üres', () => {
    expect(formatUit(null)).toBe('');
    expect(formatUit('')).toBe('');
    expect(formatUit('--')).toBe('');
  });
});

describe('lib/uitFormat.isValidUit', () => {
  test('legalább 1 karakter kell', () => {
    expect(isValidUit('')).toBe(false);
    expect(isValidUit('----')).toBe(false);
    expect(isValidUit('A')).toBe(true);
    expect(isValidUit('ABCDEFGHIJKLMNOP')).toBe(true);
  });
  test('a normalizált forma max 16 → hosszabb is elfogadva (levágja)', () => {
    // A normalizeUit levágja 16-ra, tehát a 17. karakter „lelóg" — az isValidUit
    // szemszögéből a normalizált forma valid, mert 16 karakter.
    expect(isValidUit('ABCDEFGHIJKLMNOPQ')).toBe(true);
  });
});
