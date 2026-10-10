'use strict';
const { sanitizeUploads } = require('../../lib/mailUploads');

const b64 = (n) => Buffer.alloc(n, 7).toString('base64');

describe('mailUploads.sanitizeUploads', () => {
  test('üres / hiányzó → nincs csatolmány', () => {
    expect(sanitizeUploads(undefined)).toEqual({ ok: true, files: [] });
    expect(sanitizeUploads([])).toEqual({ ok: true, files: [] });
  });
  test('PDF + kép + Excel elfogadva, data-URL lecsupaszítva, név tisztítva', () => {
    const r = sanitizeUploads([
      { name: 'arlista.pdf', mime: 'application/pdf', b64: 'data:application/pdf;base64,' + b64(100) },
      { name: 'foto.JPG', mime: 'image/jpeg', b64: b64(50) },
      { name: 'a/b\\c:táblázat.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', b64: b64(10) },
    ]);
    expect(r.ok).toBe(true);
    expect(r.files).toHaveLength(3);
    expect(r.files[0].contentBase64).toBe(b64(100));
    expect(r.files[2].name).toBe('a_b_c_táblázat.xlsx');
  });
  test('futtatható fájl tiltva', () => {
    expect(sanitizeUploads([{ name: 'virus.exe', b64: b64(10) }]).ok).toBe(false);
    expect(sanitizeUploads([{ name: 'x.js', b64: b64(10) }]).ok).toBe(false);
  });
  test('MIME és kiterjesztés eltérése tiltva', () => {
    expect(sanitizeUploads([{ name: 'kep.pdf', mime: 'image/png', b64: b64(10) }]).ok).toBe(false);
  });
  test('max 5 fájl, 10 MB/fájl, 15 MB összesen', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ name: i + '.txt', b64: b64(5) }));
    expect(sanitizeUploads(six).ok).toBe(false);
    expect(sanitizeUploads([{ name: 'nagy.pdf', b64: b64(10 * 1024 * 1024 + 3) }]).ok).toBe(false);
    const big = [1, 2].map((i) => ({ name: i + '.pdf', b64: b64(8 * 1024 * 1024) }));
    expect(sanitizeUploads(big).ok).toBe(false);
  });
  test('hibás base64 / üres fájl tiltva', () => {
    expect(sanitizeUploads([{ name: 'a.pdf', b64: '!!!' }]).ok).toBe(false);
    expect(sanitizeUploads([{ name: 'a.pdf', b64: '' }]).ok).toBe(false);
  });
});
