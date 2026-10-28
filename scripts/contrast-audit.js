#!/usr/bin/env node
// ============================================================
//  VallorSoft — scripts/contrast-audit.js
//  Kontraszt-ellenőrzés (WCAG AA, ≥ 4,5:1) a futó alkalmazáson: bejelentkezik,
//  végigmegy az admin/manager konzol MINDEN menüpontján világos és sötét
//  témában, és kilistázza a túl gyenge kontrasztú gombokat / címkéket / linkeket.
//
//  Használat (futó szerver mellett):
//    AUDIT_BASE=http://localhost:3000 AUDIT_EMAIL=admin@ceg.ro AUDIT_PASSWORD=... \
//      node scripts/contrast-audit.js [/admin|/manager]
//  Opcionális: AUDIT_LIB_DIR — ha a CDN nem érhető el, innen szolgálja ki a
//  pdf-lib.min.js / html2canvas.min.js fájlokat. Kilépési kód: 1, ha van hiba.
// ============================================================
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const PAGE = process.argv[2] || '/admin';
const MIN = Number(process.env.AUDIT_MIN || 4.5);

// A böngészőben fut: látható, szöveges elemek kontrasztja a tényleges háttér előtt.
function measure(scopeSel) {
  function rgb(s) { const m = String(s).match(/[\d.]+/g); return m ? m.map(Number) : [0, 0, 0]; }
  function lum(c) {
    const a = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function bg(el) {
    while (el) {
      const cs = getComputedStyle(el);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        const m = cs.backgroundImage.match(/rgba?\([^)]+\)/i);
        if (m) { const gc = rgb(m[0]); if (gc.length < 4 || gc[3] > 0.5) return gc; }
      }
      const c = rgb(cs.backgroundColor);
      if (c.length < 4 || c[3] > 0.5) return c;
      el = el.parentElement;
    }
    return [255, 255, 255];
  }
  const out = [];
  const els = document.querySelectorAll(scopeSel + ' button, ' + scopeSel + ' a.btn, ' + scopeSel + ' label, ' +
    scopeSel + ' .badge, ' + scopeSel + ' select, ' + scopeSel + ' h2, ' + scopeSel + ' h3, ' + scopeSel + ' th');
  els.forEach((e) => {
    if (e.offsetParent === null) return;
    const txt = (e.innerText || e.textContent || '').trim();
    if (!txt) return;
    const cs = getComputedStyle(e);
    if (Number(cs.opacity) < 0.6) return;
    const f = rgb(cs.color), g = bg(e);
    const L1 = lum(f), L2 = lum(g);
    const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const sel = e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '') + (e.id ? '#' + e.id : '');
    out.push({ sel, t: txt.replace(/\s+/g, ' ').slice(0, 40), cr: Math.round(cr * 100) / 100, fg: cs.color, bg: 'rgb(' + g.slice(0, 3).join(',') + ')' });
  });
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const lib = process.env.AUDIT_LIB_DIR;
  if (lib) {
    await ctx.route(/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis|fonts\.gstatic/, (r) => {
      const u = r.request().url();
      if (u.includes('pdf-lib')) return r.fulfill({ path: path.join(lib, 'pdf-lib.min.js'), contentType: 'application/javascript' });
      if (u.includes('html2canvas')) return r.fulfill({ path: path.join(lib, 'html2canvas.min.js'), contentType: 'application/javascript' });
      return r.fulfill({ body: '', contentType: u.endsWith('.css') ? 'text/css' : 'application/javascript' });
    });
  }
  const lr = await ctx.request.post(BASE + '/api/login', { data: { email: process.env.AUDIT_EMAIL, password: process.env.AUDIT_PASSWORD } });
  if (!lr.ok()) { console.error('Belépés sikertelen:', lr.status()); process.exit(2); }
  const page = await ctx.newPage();
  await page.goto(BASE + PAGE);
  await page.waitForFunction(() => typeof window.activateTab === 'function');
  const tabs = await page.$$eval('.sidebar [data-tab]', (els) => [...new Set(els.map((e) => e.getAttribute('data-tab')))]);
  let fails = 0;
  for (const theme of ['light', 'dark']) {
    for (const tab of tabs) {
      await page.evaluate(({ th, tb }) => {
        const mc = document.getElementById('mainContent'); if (mc) mc.setAttribute('data-theme', th);
        try { activateTab(tb); } catch (e) {}
      }, { th: theme, tb: tab });
      await page.waitForTimeout(700);
      const bad = (await page.evaluate(measure, '.main-content')).filter((x) => x.cr < MIN);
      if (bad.length) {
        fails += bad.length;
        console.log(`✗ [${theme}] ${tab}:`);
        bad.slice(0, 12).forEach((x) => console.log(`    ${x.cr}:1  ${x.sel}  „${x.t}"  ${x.fg} / ${x.bg}`));
      }
    }
  }
  await browser.close();
  console.log(fails ? `\n${fails} elem a ${MIN}:1 határ alatt.` : `\n✓ Minden mért elem ≥ ${MIN}:1.`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
