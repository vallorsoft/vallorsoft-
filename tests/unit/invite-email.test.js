const { buildInviteHtml } = require('../../services/email');

describe('buildInviteHtml — meghívó e-mail sablon', () => {
  const base = { kod: 'VS-3M9PQC', pozicio: 'Sofer', cegNev: 'Vallor Team SRL', registerUrl: 'https://vallorsoft.onrender.com', lang: 'hu' };

  test('alapértelmezett nyelv ROMÁN (lang nélkül)', () => {
    const html = buildInviteHtml({ kod: 'VS-1', pozicio: 'Sofer', registerUrl: 'https://x', meghivottNev: 'Ion' });
    expect(html).toContain('Stimate Ion!');
    expect(html).toContain('Deschide înregistrarea');
  });

  test('a MEGHÍVOTT nevével köszön (nem a cég igazgatójáéval)', () => {
    const html = buildInviteHtml({ ...base, meghivottNev: 'Kovács István' });
    expect(html).toContain('Tisztelt Kovács István!');
  });

  test('név nélkül semleges megszólítás', () => {
    const html = buildInviteHtml({ ...base, meghivottNev: null });
    expect(html).toContain('Tisztelt Címzett!');
  });

  test('a cég neve és a szerepkör megjelenik', () => {
    const html = buildInviteHtml({ ...base, meghivottNev: 'X' });
    expect(html).toContain('Vallor Team SRL');
    expect(html).toContain('Sofer');
  });

  test('a meghívókód megjelenik', () => {
    const html = buildInviteHtml({ ...base, meghivottNev: 'X' });
    expect(html).toContain('VS-3M9PQC');
  });

  test('CTA gomb + tiszta link (nincs nyers URL link-szövegként az ol-ben)', () => {
    const html = buildInviteHtml({ ...base, meghivottNev: 'X' });
    expect(html).toContain('Regisztráció megnyitása');
    expect(html).toContain('https://vallorsoft.onrender.com/register');
    // A lépések listája NE tartalmazzon nyers URL-t link-szövegként (a mobil
    // kliensek ezt csúnyán, markdown-szerűen renderelték).
    expect(html).not.toMatch(/<li>[^<]*<a[^>]*>https?:\/\//);
  });

  test('reszponzív: max-width keret + word-break a kódon', () => {
    const html = buildInviteHtml({ ...base, meghivottNev: 'X' });
    expect(html).toContain('max-width:520px');
    expect(html).toContain('word-break');
  });

  test('XSS: a meghívott neve escape-elve', () => {
    const html = buildInviteHtml({ ...base, meghivottNev: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
