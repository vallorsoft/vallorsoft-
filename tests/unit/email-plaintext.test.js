const { htmlToPlainText } = require('../../services/email');

describe('htmlToPlainText — e-mail szöveges rész nyers URL-ekkel', () => {
  test('a követő-linket nyers URL-ként adja vissza (nincs [ ] vagy ( ) a link körül)', () => {
    const url = 'https://vallorsoft.onrender.com/t/564ac078a39bbd1234567890b837f50';
    const html = '<p>🌍 Urmăriți transportul / Kövesse a fuvart: <a href="' + url + '">' + url + '</a></p>';
    const out = htmlToPlainText(html);
    expect(out).toContain(url);
    expect(out).not.toMatch(/[[\]()]/); // a markdown-os [url](url) forma okozta a hibát
  });

  test('eltérő linkszöveg esetén "szöveg: URL" (zárójel nélkül)', () => {
    const out = htmlToPlainText('<a href="https://x.com/reset?token=abc">Setează parolă nouă</a>');
    expect(out).toBe('Setează parolă nouă: https://x.com/reset?token=abc');
  });

  test('tageket eltávolít és entitásokat dekódol', () => {
    const out = htmlToPlainText('<p>Salut &amp; bun venit</p><p>A &lt; B</p>');
    expect(out).toBe('Salut & bun venit\nA < B');
  });
});
