// ============================================================
//  lib/uitDeeplink.buildUrl — helyőrző-behelyettesítés (tiszta)
// ============================================================
const { buildUrl } = require('../../lib/uitDeeplink');

describe('lib/uitDeeplink.buildUrl', () => {
  test('behelyettesít és URL-kódol', () => {
    const url = buildUrl('https://ct.ro/uit?plate={rendszam}&from={incarcare}&id={id}',
      { id: 'CMD-1', rendszam_camion: 'B 104 VLR', loc_incarcare: 'Cluj-Napoca' });
    expect(url).toContain('plate=B%20104%20VLR');
    expect(url).toContain('from=Cluj-Napoca');   // a '-' nem kódolódik
    expect(url).toContain('id=CMD-1');
  });

  test('ismeretlen helyőrző változatlan; hiányzó mező üres', () => {
    const url = buildUrl('x?a={ismeretlen}&r={remorca}', {});
    expect(url).toContain('{ismeretlen}');
    expect(url).toContain('r=');
  });

  test('üres/hiányzó template → null', () => {
    expect(buildUrl('', {})).toBeNull();
    expect(buildUrl(null, {})).toBeNull();
  });
});
