#!/usr/bin/env node
// ============================================================
//  VallorSoft — terheléses teszt (CSAK OLVASÓ műveletek)
//
//  N virtuális admin + M virtuális sofőr egyszerre "dolgozik":
//   - oldalbetöltés (a HTML + minden JS/CSS fájlja, mint a böngésző)
//   - utána ciklusban olvasó RPC-hívások (vezérlőpult, fuvarlista,
//     tervezőtábla / sofőr fuvarjai, statisztika), véletlen szünettel.
//  SEMMIT nem ír az adatbázisba, külső fizetős szolgáltatót (GPS/HERE/AI)
//  nem hív. Belépés fiókonként EGYSZER (a login rate-limit miatt), a
//  virtuális felhasználók ezt a munkamenetet osztják meg.
//
//  Env: BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, DRIVER_EMAIL,
//       DRIVER_PASSWORD, ADMINS (10), DRIVERS (10), DURATION_SEC (180)
//  Belépési adat nélkül csak a nyilvános oldalbetöltést + /readyz-t terheli.
// ============================================================
'use strict';

const BASE = (process.env.BASE_URL || 'https://vallorsoft.fly.dev').replace(/\/+$/, '');
const ADMINS = parseInt(process.env.ADMINS || '10', 10);
const DRIVERS = parseInt(process.env.DRIVERS || '10', 10);
const DURATION = parseInt(process.env.DURATION_SEC || '180', 10) * 1000;

const ADMIN_RPC = [
  ['dashStats', []], ['getRecentOrders', []], ['getVehicleStatusSummary', []],
  ['comList', []], ['getPlannerData', [{}]], ['getMyFeatures', []], ['authMe', []],
];
const DRIVER_RPC = [
  ['getMySoferOrders', []], ['getMySoferStats', []], ['getMyAssignedVehicle', []], ['authMe', []],
];

const stats = {};
function rec(name, ms, ok) {
  const s = stats[name] || (stats[name] = { n: 0, err: 0, t: [] });
  s.n++; if (!ok) s.err++; s.t.push(ms);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = (a, b) => a + Math.random() * (b - a);

async function timed(name, url, opts) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, Object.assign({ redirect: 'manual' }, opts));
    await r.arrayBuffer();
    const ok = r.status < 400;
    rec(name, Date.now() - t0, ok);
    return r;
  } catch (e) {
    rec(name, Date.now() - t0, false);
    return null;
  }
}

async function login(email, password) {
  if (!email || !password) return null;
  const r = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json().catch(() => ({}));
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [])
    .map(c => c.split(';')[0]).join('; ');
  if (!d.success || d.need2fa || !cookie) {
    console.log('⚠️  Belépés sikertelen (' + email.replace(/(.).*@/, '$1***@') + '): ' +
      (d.need2fa ? 'a fiókon 2FA van — tesztfiókon kapcsold ki' : (d.message || r.status)));
    return null;
  }
  return cookie;
}

async function assetsOf(page) {
  const r = await fetch(BASE + page, { redirect: 'follow' });
  const html = await r.text();
  const urls = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)) urls.add(m[1]);
  return [...urls];
}

async function pageLoad(name, page, assets, cookie) {
  const headers = cookie ? { Cookie: cookie } : {};
  await timed(name + ' HTML', BASE + page, { headers });
  // a böngésző ~6 párhuzamos kérést küld egyszerre
  for (let i = 0; i < assets.length; i += 6) {
    await Promise.all(assets.slice(i, i + 6).map(a => timed('static', BASE + a, { headers })));
  }
}

async function rpc(fn, args, cookie) {
  return timed('rpc ' + fn, BASE + '/api/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ functionName: fn, arguments: args }),
  });
}

async function virtualUser(kind, page, assets, cookie, calls, end) {
  await sleep(jitter(0, 3000)); // ne pont egy ezredmásodpercben induljon mind
  await pageLoad(kind, page, assets, cookie);
  while (Date.now() < end) {
    if (cookie) {
      const burst = calls.slice().sort(() => Math.random() - 0.5).slice(0, 3);
      await Promise.all(burst.map(([fn, a]) => rpc(fn, a, cookie)));
    } else {
      await timed('readyz', BASE + '/readyz');
    }
    await sleep(jitter(2000, 6000)); // "gondolkodási idő"
    if (Math.random() < 0.1) await pageLoad(kind, page, assets, cookie); // néha újratölt
  }
}

function pct(a, p) { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0; }

(async () => {
  console.log(`🎯 ${BASE} — ${ADMINS} admin + ${DRIVERS} sofőr, ${DURATION / 1000} mp`);
  const adminCookie = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const driverCookie = await login(process.env.DRIVER_EMAIL, process.env.DRIVER_PASSWORD);
  if (!adminCookie && !driverCookie) console.log('ℹ️  Belépés nélkül: csak nyilvános oldalbetöltés + /readyz.');
  const adminPage = adminCookie ? '/admin' : '/login';
  const driverPage = driverCookie ? '/sofer' : '/login';
  const [aA, dA] = await Promise.all([
    assetsOf('/admin.html').catch(() => []), assetsOf('/sofer.html').catch(() => []),
  ]);
  console.log(`📦 admin oldal ${aA.length} fájl, sofőr oldal ${dA.length} fájl`);

  const end = Date.now() + DURATION;
  const t0 = Date.now();
  const users = [];
  for (let i = 0; i < ADMINS; i++) users.push(virtualUser('admin', adminPage, aA, adminCookie, ADMIN_RPC, end));
  for (let i = 0; i < DRIVERS; i++) users.push(virtualUser('sofer', driverPage, dA, driverCookie, DRIVER_RPC, end));
  const tick = setInterval(() => {
    const n = Object.values(stats).reduce((s, x) => s + x.n, 0);
    console.log(`… ${Math.round((Date.now() - t0) / 1000)} mp, ${n} kérés`);
  }, 30000);
  await Promise.all(users);
  clearInterval(tick);

  const secs = (Date.now() - t0) / 1000;
  let total = 0, errs = 0;
  console.log('\n| kérés | db | hiba | p50 ms | p95 ms | max ms |\n|---|---|---|---|---|---|');
  for (const [k, s] of Object.entries(stats).sort()) {
    total += s.n; errs += s.err;
    console.log(`| ${k} | ${s.n} | ${s.err} | ${pct(s.t, 0.5)} | ${pct(s.t, 0.95)} | ${Math.max(...s.t)} |`);
  }
  console.log(`\nÖsszesen ${total} kérés ${secs.toFixed(0)} mp alatt (${(total / secs).toFixed(1)}/mp), hiba: ${errs}`);
  const lines = ['## Terheléses teszt', `${BASE} — ${ADMINS} admin + ${DRIVERS} sofőr, ${secs.toFixed(0)} mp`, '',
    '| kérés | db | hiba | p50 ms | p95 ms |', '|---|---|---|---|---|',
    ...Object.entries(stats).sort().map(([k, s]) => `| ${k} | ${s.n} | ${s.err} | ${pct(s.t, 0.5)} | ${pct(s.t, 0.95)} |`),
    '', `**Összesen ${total} kérés (${(total / secs).toFixed(1)}/mp), hiba: ${errs}**`];
  if (process.env.GITHUB_STEP_SUMMARY) require('fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
})();
