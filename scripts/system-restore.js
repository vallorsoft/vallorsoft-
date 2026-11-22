#!/usr/bin/env node
// ============================================================
//  VallorSoft — scripts/system-restore.js
//  A TELJES rendszer visszaállítása a Cloudflare R2-n lévő mentésekből
//  (services/systemBackup → services/systemRestore).
//
//  Kell hozzá (env): INTEGRATION_ENC_KEY (ugyanaz, mint az élesen!),
//                    R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT (vagy R2_ACCOUNT_ID)
//  és a pg_restore (legalább akkora főverzió, mint a mentést készítő pg_dump).
//
//  Használat:
//    node scripts/system-restore.js --list
//    node scripts/system-restore.js --target "postgres://user:pass@host/db?sslmode=require" [--at 2026-12-01T03:00:00Z] --yes
//
//  A cél-adatbázis legyen ÜRES (új Neon-adatbázis / branch). A visszaállítás után
//  a szerver DATABASE_URL-jét erre kell állítani.
// ============================================================
'use strict';
require('dotenv').config();
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const has = (n) => args.includes(n);

(async () => {
  const rst = require('../services/systemRestore');
  if (has('--list')) {
    const list = await rst.listBackups();
    if (!list.length) { console.log('Nincs rendszer-mentés az R2-n.'); return; }
    list.forEach((m) => console.log(m.created_at, m.kind.padEnd(5), m.key, m.kind === 'delta' ? '← ' + m.base_key : ''));
    return;
  }
  const target = arg('--target') || process.env.TARGET_DATABASE_URL;
  if (!target) { console.error('Add meg a cél-adatbázist: --target "postgres://..."'); process.exit(2); }
  if (process.env.DATABASE_URL && target === process.env.DATABASE_URL && !has('--yes-overwrite-live')) {
    console.error('A cél megegyezik az élő DATABASE_URL-lel. Ha tényleg ezt akarod, add hozzá: --yes-overwrite-live');
    process.exit(2);
  }
  const at = arg('--at');
  const plan = rst.planRestore(await rst.listBackups(), at);
  if (!plan) { console.error('Nincs megfelelő teljes mentés.'); process.exit(1); }
  console.log('Terv: teljes mentés', plan.full.created_at, '+', plan.deltas.length, 'változás-mentés',
    plan.deltas.length ? '(utolsó: ' + plan.deltas[plan.deltas.length - 1].created_at + ')' : '');
  if (!has('--yes')) { console.log('Futtatáshoz add hozzá: --yes'); return; }
  const r = await rst.restore({ targetUrl: target, at, log: (m) => console.log(' ·', m) });
  console.log('✅ Kész. Visszaállítva erre az állapotra:', r.restored_to, '—', r.deltas, 'változás-mentés,', r.rows, 'sor.');
})().catch((e) => { console.error('❌ Hiba:', e.message); process.exit(1); });
