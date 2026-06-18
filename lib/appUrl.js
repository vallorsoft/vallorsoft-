// ============================================================
//  VallorSoft — lib/appUrl.js
//  Az APP_URL környezeti változó BIZTONSÁGOS kinyerése.
//
//  MIÉRT: ha az APP_URL hibásan, markdown-osan lett beállítva (pl. a Render
//  env-ben „[https://app.example.com](https://app.example.com)"), akkor a
//  base + '/útvonal' összefűzés érvénytelen linket adott
//  („[url](url)/t/<token>") — a zárójelek elvágták a kattintható linket.
//  Ez a segéd kinyeri a TISZTA URL-t akkor is, ha valaki körítéssel adta meg.
// ============================================================

// Tiszta báziscím az APP_URL-ből (záró / nélkül). fallback: ha nincs/üres APP_URL.
function appBaseUrl(fallback) {
  let raw = String(process.env.APP_URL || '').trim();
  if (!raw) raw = String(fallback || '').trim();
  if (!raw) return '';
  // Markdown [szöveg](URL) → a kerek zárójelben lévő URL-t vesszük.
  const md = raw.match(/\]\(\s*(https?:\/\/[^)\s]+)\s*\)/i);
  if (md) {
    raw = md[1];
  } else {
    // Egyébként az első http(s) URL a stringből (levág minden [ ] / körítést).
    const m = raw.match(/https?:\/\/[^\s\])>"']+/i);
    if (m) raw = m[0];
  }
  return raw.replace(/\/+$/, '');
}

module.exports = { appBaseUrl };
