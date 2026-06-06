// ============================================================
//  services/invoiceAdapter.js — számlázó-adapter registry
// ============================================================
const { getAdapter, listProviders } = require('../../services/invoiceAdapter');

describe('services/invoiceAdapter', () => {
  test('listProviders tartalmazza az fgo-t', () => {
    expect(listProviders()).toContain('fgo');
  });

  test('getAdapter("fgo") a szerződéses felületet adja (emit/getStatus)', () => {
    const a = getAdapter('fgo');
    expect(typeof a.emit).toBe('function');
    expect(typeof a.getStatus).toBe('function');
  });

  test('ismeretlen szolgáltató → PROVIDER_NOT_IMPLEMENTED hiba', () => {
    expect(() => getAdapter('nincsilyen')).toThrow();
    try {
      getAdapter('nincsilyen');
    } catch (e) {
      expect(e.code).toBe('PROVIDER_NOT_IMPLEMENTED');
    }
  });
});
