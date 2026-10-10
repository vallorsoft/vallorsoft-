// ============================================================
//  VallorSoft — lib/chatTools/extra.js
//  💬 AI-chat 2.0 — 6. kör: a még csak a felületen elérhető, titkot
//  NEM érintő műveletek chatből.
//   - külső (Extern) sofőrök: lista, felvétel, módosítás, törlés
//   - egyéni járandóság-típusok: lista, felvétel, törlés
//   - menetlevél: km-hézagok, régi sofőr menetleveleinek átrendezése,
//     szellem-sofőr adatainak törlése
//   - Manager-jogosultságok, EUR/RON belső árfolyam
//   - dokumentum-nyilvántartás mappák + bejegyzés törlése + keresés
//   - fuvar-sablon átnevezés/törlés, fuvar-sorozat törlés
//   - fuvar-dokumentum adatai / törlése, kampány-párosítás, sablon törlése
//   - WhatsApp-szám, AI bon-scan kapcsoló, reggeli összefoglaló,
//     kalkulátor-beállítások, mentett kalkuláció törlése, postafiók
//     szinkron / levél elrejtése, PDF-munkatér
//  SZABÁLY: kulcs, jelszó, SMTP/IMAP/API-adat chatből NEM olvasható és
//  NEM állítható — ezeket a felület Integrációk oldala kezeli.
// ============================================================
'use strict';

const core = require('./core');
const di = require('../driverInfo');

const { fmtN, fmtD } = core.fmt;
const { change, listCard } = core.card;
const L = (hu, ro) => ({ hu, ro });
const q = core.q;
const H = core.H;
const hu = (ctx) => ctx.lang === 'hu';
const ok = (reply, extra) => Object.assign({ ok: true, reply }, extra || {});
const d10 = (v) => (v instanceof Date ? di._h.iso(v) : (v ? String(v).slice(0, 10) : ''));
const info = (html) => '<div class="och-info">' + html + '</div>';
const onoff = (ctx, v) => (v ? (hu(ctx) ? '✅ be' : '✅ activ') : (hu(ctx) ? '— ki' : '— inactiv'));
const fold = (s) => core.fmt.fold(String(s || ''));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PERMS = ['stats_finance', 'orders_delete', 'invoice_issue', 'data_export', 'users_manage'];
const PERM_L = { stats_finance: L('Pénzügyi statisztika', 'Statistici financiare'), orders_delete: L('Fuvar törlése', 'Ștergere curse'),
  invoice_issue: L('Számla kiállítása', 'Emitere facturi'), data_export: L('Adat-export', 'Export date'), users_manage: L('Felhasználók kezelése', 'Gestionare utilizatori') };

// Név szerinti egyértelmű találat egy listából (a hívó szűr cégre).
function pick(ctx, rows, raw, label, what) {
  const f = fold(raw).trim();
  if (!f) return { err: hu(ctx) ? 'Melyik ' + what + '?' : 'Care ' + what + '?' };
  const exact = rows.filter((r) => fold(label(r)) === f);
  const hits = exact.length ? exact : rows.filter((r) => fold(label(r)).includes(f));
  if (hits.length === 1) return { v: hits[0] };
  if (hits.length > 1) return { ask: { text: hu(ctx) ? 'Több is illik rá — melyik?' : 'Se potrivesc mai multe — care?', options: hits.slice(0, 5).map((r) => ctx.retext(label(r), String(raw))) } };
  return { err: (hu(ctx) ? 'Nem találom: ' : 'Nu găsesc: ') + raw };
}
async function extDrivers(ctx) {
  return q(`SELECT id, nume, firma, telefon, email, rendszam_camion, rendszam_remorca, nota FROM external_drivers WHERE company_id = $1 ORDER BY nume, firma`, [ctx.cid]).catch(() => []);
}
const extLabel = (d) => [d.nume, d.firma].filter(Boolean).join(' — ');

module.exports = [
  // ─── Külső sofőrök ───
  {
    name: 'extdriver.list', domain: 'drivers', kind: 'read', feature: 'external-drivers',
    desc: L('A külső (alvállalkozói, Extern) sofőrök listája.', 'Lista șoferilor externi.'),
    async run(ctx) {
      const rows = await extDrivers(ctx);
      return { reply: hu(ctx) ? rows.length + ' külső sofőr.' : rows.length + ' șoferi externi.', html: info(listCard(ctx, '🧑‍✈️', hu(ctx) ? 'Külső sofőrök' : 'Șoferi externi', rows,
        [{ k: 'nume', l: L('Név', 'Nume') }, { k: 'firma', l: L('Cég', 'Firmă') }, { k: 'telefon', l: L('Telefon', 'Telefon') }, { k: 'rendszam_camion', l: L('Vontató', 'Cap tractor') }, { k: 'rendszam_remorca', l: L('Pótkocsi', 'Remorcă') }], 60)) };
    },
  },
  {
    name: 'extdriver.add', domain: 'drivers', kind: 'write', feature: 'external-drivers',
    title: L('Új külső sofőr', 'Șofer extern nou'),
    desc: L('Külső sofőr felvétele: name, company (cég), phone, email, truck (vontató rendszám), trailer (pótkocsi), note. A név vagy a cég kötelező.', 'Adaugă un șofer extern.'),
    params: { name: { type: 'text', max: 160 }, company: { type: 'text', max: 200 }, phone: { type: 'text', max: 40 }, email: { type: 'email' },
      truck: { type: 'text', max: 20 }, trailer: { type: 'text', max: 20 }, note: { type: 'text', max: 500 } },
    async check(ctx, a) { return (a.name || a.company) ? null : { ask: { text: hu(ctx) ? 'Mi a sofőr neve vagy a cége?' : 'Care e numele șoferului sau firma?', options: [] } }; },
    async preview(ctx, a) {
      return { rows: [[hu(ctx) ? 'Név' : 'Nume', a.name || '—'], [hu(ctx) ? 'Cég' : 'Firmă', a.company || '—'], ['☏', a.phone || '—'], ['🚚', [a.truck, a.trailer].filter(Boolean).join(' / ') || '—']], label: a.name || a.company };
    },
    async snapshot() { return {}; },
    async undo(ctx, b, res) { return res && res.id ? core.callH(H('fleet', 'extDriverDelete'), ctx.req, [res.id]) : { ok: false }; },
    async run(ctx, a) {
      const r = await core.callH(H('fleet', 'extDriverCreate'), ctx.req, [{ nume: a.name, firma: a.company, telefon: a.phone, email: a.email, rendszam_camion: a.truck, rendszam_remorca: a.trailer, nota: a.note }]);
      return r && r.ok ? ok(null, { id: r.id, entity_id: r.id }) : r;
    },
  },
  {
    name: 'extdriver.update', domain: 'drivers', kind: 'write', feature: 'external-drivers',
    title: L('Külső sofőr módosítása', 'Modificare șofer extern'),
    desc: L('Külső sofőr adatainak módosítása (csak a megadott mezők változnak): driver (név vagy cég), name, company, phone, email, truck, trailer, note.', 'Modifică un șofer extern.'),
    params: { driver: { type: 'text', required: true, max: 200 }, name: { type: 'text', max: 160 }, company: { type: 'text', max: 200 }, phone: { type: 'text', max: 40 },
      email: { type: 'email' }, truck: { type: 'text', max: 20 }, trailer: { type: 'text', max: 20 }, note: { type: 'text', max: 500 } },
    async check(ctx, a) {
      const f = pick(ctx, await extDrivers(ctx), a.driver, extLabel, hu(ctx) ? 'sofőr' : 'șofer');
      if (!f.v) return f;
      a.d = f.v;
      a.patch = {};
      const map = { name: 'nume', company: 'firma', phone: 'telefon', email: 'email', truck: 'rendszam_camion', trailer: 'rendszam_remorca', note: 'nota' };
      for (const k of Object.keys(map)) if (a[k] != null) a.patch[map[k]] = a[k];
      return Object.keys(a.patch).length ? null : { ask: { text: hu(ctx) ? 'Mit módosítsak?' : 'Ce modific?', options: [] } };
    },
    async preview(ctx, a) { return { rows: Object.keys(a.patch).map((k) => [k, change(a.d[k], a.patch[k])]), label: extLabel(a.d) }; },
    async snapshot(ctx, a) { const o = {}; for (const k of Object.keys(a.patch)) o[k] = a.d[k] == null ? '' : a.d[k]; return { id: a.d.id, o }; },
    async undo(ctx, b) { return core.callH(H('fleet', 'extDriverUpdate'), ctx.req, [b.id, b.o]); },
    async run(ctx, a) { const r = await core.callH(H('fleet', 'extDriverUpdate'), ctx.req, [a.d.id, a.patch]); return r && r.ok ? ok(null, { entity_id: a.d.id }) : r; },
  },
  {
    name: 'extdriver.delete', domain: 'drivers', kind: 'danger', feature: 'external-drivers',
    title: L('Külső sofőr törlése', 'Ștergere șofer extern'),
    desc: L('Külső sofőr törlése a listából: driver (név vagy cég).', 'Șterge un șofer extern.'),
    params: { driver: { type: 'text', required: true, max: 200 } },
    async check(ctx, a) { const f = pick(ctx, await extDrivers(ctx), a.driver, extLabel, hu(ctx) ? 'sofőr' : 'șofer'); if (!f.v) return f; a.d = f.v; return null; },
    async preview(ctx, a) { return { rows: [['🧑‍✈️', extLabel(a.d)], ['☏', a.d.telefon || '—']], label: extLabel(a.d) }; },
    async run(ctx, a) { const r = await core.callH(H('fleet', 'extDriverDelete'), ctx.req, [a.d.id]); return r && r.ok ? ok(null) : r; },
  },
  // ─── Egyéni járandóság-típusok ───
  {
    name: 'earning_kind.list', domain: 'drivers', kind: 'read', feature: 'decont',
    desc: L('A sofőr-járandóság típusai (beépített + a cég saját típusai).', 'Tipurile de drepturi ale șoferilor.'),
    async run(ctx) {
      const r = await core.callH(H('fleetCompliance', 'earningKindList'), ctx.req, []);
      const rows = ((r && r.items) || []).map((k) => ({ key: k.key, label: hu(ctx) ? (k.label_hu || k.label_ro) : k.label_ro, own: hu(ctx) ? 'saját' : 'proprie' }))
        .concat(((r && r.builtin) || []).map((k) => ({ key: typeof k === 'string' ? k : k.key, label: typeof k === 'string' ? k : (hu(ctx) ? (k.label_hu || k.label_ro || k.key) : (k.label_ro || k.key)), own: hu(ctx) ? 'beépített' : 'predefinit' })));
      return { reply: hu(ctx) ? rows.length + ' típus.' : rows.length + ' tipuri.', html: info(listCard(ctx, '🏷️', hu(ctx) ? 'Járandóság-típusok' : 'Tipuri de drepturi', rows,
        [{ k: 'label', l: L('Név', 'Denumire') }, { k: 'key', l: L('Kulcs', 'Cheie') }, { k: 'own', l: L('Fajta', 'Fel') }], 60)) };
    },
  },
  {
    name: 'earning_kind.add', domain: 'drivers', kind: 'write', feature: 'decont',
    title: L('Új járandóság-típus', 'Tip nou de drept'),
    desc: L('Saját járandóság-típus felvétele: label_ro (román név, kötelező), label_hu, key (rövid kulcs; ha nincs, a névből készül).', 'Adaugă un tip propriu de drept.'),
    params: { label_ro: { type: 'text', required: true, max: 120 }, label_hu: { type: 'text', max: 120 }, key: { type: 'text', max: 30 } },
    async check(ctx, a) {
      a.key = fold(a.key || a.label_ro).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
      return a.key.length >= 2 ? null : { err: hu(ctx) ? 'Adj meg legalább 2 betűs nevet.' : 'Introdu un nume de cel puțin 2 litere.' };
    },
    async preview(ctx, a) { return { rows: [['RO', a.label_ro], ['HU', a.label_hu || '—'], [hu(ctx) ? 'Kulcs' : 'Cheie', a.key]], label: a.label_ro }; },
    async snapshot(ctx, a) { return { key: a.key }; },
    async undo(ctx, b) { return core.callH(H('fleetCompliance', 'earningKindDelete'), ctx.req, [{ key: b.key }]); },
    async run(ctx, a) { const r = await core.callH(H('fleetCompliance', 'earningKindCreate'), ctx.req, [{ key: a.key, label_ro: a.label_ro, label_hu: a.label_hu }]); return r && r.ok ? ok(null) : r; },
  },
  {
    name: 'earning_kind.delete', domain: 'drivers', kind: 'write', feature: 'decont',
    title: L('Járandóság-típus törlése', 'Ștergere tip de drept'),
    desc: L('Saját járandóság-típus törlése: kind (név vagy kulcs). Beépített típus nem törölhető.', 'Șterge un tip propriu de drept.'),
    params: { kind: { type: 'text', required: true, max: 120 } },
    async check(ctx, a) {
      const rows = await q(`SELECT key, label_ro, label_hu FROM driver_earning_kinds WHERE company_id = $1`, [ctx.cid]).catch(() => []);
      const f = pick(ctx, rows.map((r) => Object.assign({ lbl: r.label_ro + ' (' + r.key + ')' }, r)), a.kind, (r) => r.lbl, hu(ctx) ? 'típus' : 'tip');
      if (!f.v) return f; a.k = f.v; return null;
    },
    async preview(ctx, a) { return { rows: [['🏷️', a.k.lbl]], label: a.k.lbl }; },
    async run(ctx, a) { const r = await core.callH(H('fleetCompliance', 'earningKindDelete'), ctx.req, [{ key: a.k.key }]); return r && r.ok ? ok(null) : r; },
  },
  // ─── Menetlevél-karbantartás ───
  {
    name: 'waybill.km_gaps', domain: 'docs', kind: 'read', feature: 'received-fuv',
    desc: L('Hol nem folytatja a menetlevél kezdő km-e az előző záró km-et (hiányzó km / átfedés), járművenként.', 'Unde nu continuă km de start ai foii de parcurs km-ul de final anterior.'),
    async run(ctx) {
      const r = await core.callH(H('documents', 'getWaybillKmGaps'), ctx.req, [{}]);
      const rows = ((r && r.gaps) || []).map((g) => ({ plate: g.plate, date: fmtD(d10(g.eff_date)), fisa: g.numar_fisa, sofer: g.nume_sofer, diff: (g.diff > 0 ? '+' : '') + fmtN(g.diff, 0) + ' km' }));
      return { reply: rows.length ? (hu(ctx) ? rows.length + ' km-hézag a menetlevelekben.' : rows.length + ' goluri de km în foile de parcurs.') : (hu(ctx) ? 'Nincs km-hézag — a menetlevelek folytonosak.' : 'Nu există goluri de km.'),
        html: rows.length ? info(listCard(ctx, '🛣️', hu(ctx) ? 'Km-hézagok' : 'Goluri de km', rows,
          [{ k: 'plate', l: L('Rendszám', 'Nr.') }, { k: 'date', l: L('Dátum', 'Data') }, { k: 'fisa', l: L('Menetlevél', 'Foaie') }, { k: 'sofer', l: L('Sofőr', 'Șofer') }, { k: 'diff', l: L('Eltérés', 'Diferență') }], 60)) : '' };
    },
  },
  {
    name: 'waybill.reassign', domain: 'docs', kind: 'danger', feature: 'internal-drivers',
    title: L('Menetlevelek átrendezése másik sofőrre', 'Mutare foi de parcurs pe alt șofer'),
    desc: L('Egy régi / törölt sofőr ÖSSZES menetlevelét és dokumentumát átköti egy aktuális sofőrre (a statisztika is vele megy): from (régi sofőr neve vagy e-mailje), to (aktuális sofőr).', 'Mută toate foile de parcurs ale unui șofer vechi pe un șofer actual.'),
    params: { from: { type: 'text', required: true, max: 200 }, to: { type: 'driver', required: true } },
    async check(ctx, a) {
      const rows = await q(`SELECT LOWER(email_sofer) AS email, MAX(nume_sofer) AS nume, COUNT(*)::int AS n FROM fuvarlevelek
                             WHERE company_id = $1 AND COALESCE(email_sofer,'') <> '' GROUP BY LOWER(email_sofer)`, [ctx.cid]).catch(() => []);
      const s = String(a.from).trim().toLowerCase();
      const f = EMAIL_RE.test(s) ? { v: rows.find((r) => r.email === s) } : pick(ctx, rows, a.from, (r) => (r.nume || r.email), hu(ctx) ? 'sofőr' : 'șofer');
      if (f.ask || f.err) return f;
      if (!f.v) return { err: (hu(ctx) ? 'Ennek a sofőrnek nincs menetlevele: ' : 'Șoferul nu are foi de parcurs: ') + a.from };
      if (f.v.email === String(a.to.email).toLowerCase()) return { err: hu(ctx) ? 'Ugyanaz a sofőr.' : 'Același șofer.' };
      a.f = f.v; return null;
    },
    async preview(ctx, a) { return { rows: [[hu(ctx) ? 'Kitől' : 'De la', (a.f.nume || '') + ' · ' + a.f.email], [hu(ctx) ? 'Kinek' : 'Către', a.to.name], [hu(ctx) ? 'Menetlevél' : 'Foi de parcurs', String(a.f.n)]], label: a.to.name }; },
    async run(ctx, a) { const r = await core.callH(H('documents', 'reassignDriverWaybills'), ctx.req, [a.f.email, a.to.email]); return r && r.ok ? ok(null) : r; },
  },
  {
    name: 'driver.purge_data', domain: 'drivers', kind: 'danger', roles: ['Admin'], feature: 'internal-drivers',
    title: L('Régi sofőr adatainak végleges törlése', 'Ștergere definitivă date șofer vechi'),
    desc: L('Egy volt sofőr menetleveleinek, dokumentumainak és jármű-hozzárendelésének VÉGLEGES törlése: email. Visszavonhatatlan. Csak Admin.', 'Șterge definitiv datele unui fost șofer. Ireversibil.'),
    params: { email: { type: 'email', required: true } },
    async check(ctx, a) {
      if (String(a.email).toLowerCase() === String(ctx.user.email || '').toLowerCase()) return { err: hu(ctx) ? 'Saját magadat nem törölheted.' : 'Nu te poți șterge pe tine.' };
      a.n = ((await q(`SELECT COUNT(*)::int AS n FROM fuvarlevelek WHERE company_id = $1 AND LOWER(email_sofer) = LOWER($2)`, [ctx.cid, a.email]).catch(() => [{ n: 0 }]))[0] || {}).n || 0;
      return null;
    },
    async preview(ctx, a) { return { rows: [['✉', a.email], [hu(ctx) ? 'Menetlevél' : 'Foi de parcurs', String(a.n)], ['⚠️', hu(ctx) ? 'végleges törlés' : 'ștergere definitivă']], label: a.email }; },
    async run(ctx, a) { const r = await core.callH(H('documents', 'purgeDriverData'), ctx.req, [a.email]); return r && r.ok ? ok(null) : r; },
  },
  // ─── Jogosultság, árfolyam ───
  {
    name: 'permission.set', domain: 'settings', kind: 'write', roles: ['Admin'],
    title: L('Manager-jogosultság', 'Permisiune Manager'),
    desc: L('Egy Manager jogosultságának be-/kikapcsolása: user (név vagy e-mail), perm (' + PERMS.join('|') + '), enabled. Csak Admin.', 'Activează / dezactivează o permisiune pentru un Manager.'),
    params: { user: { type: 'text', required: true, max: 160 }, perm: { type: 'enum', values: PERMS, required: true }, enabled: { type: 'bool', default: true } },
    async check(ctx, a) {
      const rows = await q(`SELECT id, nume, email FROM users WHERE company_id = $1 AND pozicio = 'Manager'`, [ctx.cid]);
      const s = String(a.user).toLowerCase();
      const f = s.includes('@') ? { v: rows.find((u) => String(u.email).toLowerCase() === s) } : pick(ctx, rows, a.user, (u) => u.nume || u.email, 'Manager');
      if (f.ask || f.err) return f;
      if (!f.v) return { err: (hu(ctx) ? 'Nincs ilyen Manager: ' : 'Nu există Managerul: ') + a.user };
      a.u = f.v;
      a.cur = !!((await q(`SELECT enabled FROM user_permissions WHERE user_id = $1 AND perm_key = $2`, [a.u.id, a.perm]).catch(() => []))[0] || {}).enabled;
      return null;
    },
    async preview(ctx, a) { return { rows: [['👤', a.u.nume || a.u.email], [PERM_L[a.perm][ctx.lang], change(onoff(ctx, a.cur), onoff(ctx, a.enabled))]], label: a.u.nume }; },
    async snapshot(ctx, a) { return { user_id: a.u.id, perm_key: a.perm, enabled: a.cur }; },
    async undo(ctx, b) { return core.callH(H('permissions', 'setUserPermission'), ctx.req, b); },
    async run(ctx, a) { const r = await core.callH(H('permissions', 'setUserPermission'), ctx.req, { user_id: a.u.id, perm_key: a.perm, enabled: a.enabled }); return r && r.ok ? ok(null) : r; },
  },
  {
    name: 'finance.eur_ron_set', domain: 'finance', kind: 'write', roles: ['Admin'],
    title: L('Belső EUR/RON árfolyam', 'Curs intern EUR/RON'),
    desc: L('A cég saját EUR/RON árfolyama a statisztikához (ha a BNR nem elérhető): rate (0,5–20). Csak Admin.', 'Cursul intern EUR/RON al firmei: rate.'),
    params: { rate: { type: 'number', required: true } },
    async check(ctx, a) {
      a.cur = ((await q(`SELECT eur_ron_rate FROM companies WHERE id = $1`, [ctx.cid]).catch(() => []))[0] || {}).eur_ron_rate;
      return a.rate >= 0.5 && a.rate <= 20 ? null : { err: hu(ctx) ? 'Az árfolyam 0,5 és 20 között lehet.' : 'Cursul trebuie să fie între 0,5 și 20.' };
    },
    async preview(ctx, a) { return { rows: [['EUR/RON', change(a.cur != null ? fmtN(a.cur, 4) : '—', fmtN(a.rate, 4))]] }; },
    async snapshot(ctx, a) { return { r: a.cur }; },
    async undo(ctx, b) { return b && b.r != null ? core.callH(H('statisticsHandlers', 'setEurRonRate'), ctx.req, [Number(b.r)]) : { ok: false }; },
    async run(ctx, a) { const r = await core.callH(H('statisticsHandlers', 'setEurRonRate'), ctx.req, [a.rate]); return r && r.ok ? ok(null) : r; },
  },
  // ─── Dokumentum-nyilvántartás ───
  {
    name: 'docreg.group_save', domain: 'docs', kind: 'write', feature: 'doc-register',
    title: L('Nyilvántartási mappa', 'Dosar registru'),
    desc: L('Dokumentum-nyilvántartási mappa létrehozása vagy módosítása: name, prefix (pl. FCT), year_reset (évente újrakezd, alap igen), new_name (átnevezéshez).', 'Creează / modifică un dosar în registrul de documente.'),
    params: { name: { type: 'text', required: true, max: 120 }, prefix: { type: 'text', max: 20 }, year_reset: { type: 'bool' }, new_name: { type: 'text', max: 120 } },
    async check(ctx, a) {
      a.g = (await q(`SELECT * FROM doc_register_groups WHERE company_id = $1 AND LOWER(name) = LOWER($2)`, [ctx.cid, a.name]).catch(() => []))[0] || null;
      if (!a.g && !a.prefix) a.prefix = fold(a.name).replace(/[^a-z0-9]/g, '').slice(0, 4).toUpperCase();
      return null;
    },
    async preview(ctx, a) {
      const g = a.g || {};
      return { rows: [[hu(ctx) ? 'Mappa' : 'Dosar', a.g ? change(g.name, a.new_name || g.name) : a.name], ['Prefix', change(g.prefix, a.prefix != null ? String(a.prefix).toUpperCase() : g.prefix)],
        [hu(ctx) ? 'Évente újrakezd' : 'Resetare anuală', onoff(ctx, a.year_reset != null ? a.year_reset : (a.g ? g.year_reset : true))]], label: a.name };
    },
    async run(ctx, a) {
      const g = a.g || {};
      const r = await core.callH(H('documentRegister', 'docRegGroupSave'), ctx.req, [{ id: g.id || null, name: a.new_name || a.name, prefix: a.prefix != null ? a.prefix : g.prefix,
        year_reset: a.year_reset != null ? a.year_reset : (a.g ? g.year_reset : true), pad: g.pad || 4, color: g.color, notes: g.notes }]);
      return r && r.ok ? ok(null) : r;
    },
  },
  {
    name: 'docreg.group_delete', domain: 'docs', kind: 'danger', feature: 'doc-register',
    title: L('Nyilvántartási mappa törlése', 'Ștergere dosar registru'),
    desc: L('Dokumentum-nyilvántartási mappa törlése a bejegyzéseivel együtt: name.', 'Șterge un dosar din registru.'),
    params: { name: { type: 'text', required: true, max: 120 } },
    async check(ctx, a) {
      const rows = await q(`SELECT g.id, g.name, (SELECT COUNT(*)::int FROM doc_register_entries e WHERE e.group_id = g.id AND e.company_id = g.company_id) AS n
                             FROM doc_register_groups g WHERE g.company_id = $1`, [ctx.cid]).catch(() => []);
      const f = pick(ctx, rows, a.name, (r) => r.name, hu(ctx) ? 'mappa' : 'dosar'); if (!f.v) return f; a.g = f.v; return null;
    },
    async preview(ctx, a) { return { rows: [['📁', a.g.name], [hu(ctx) ? 'Bejegyzés' : 'Înregistrări', String(a.g.n)]], label: a.g.name }; },
    async run(ctx, a) { const r = await core.callH(H('documentRegister', 'docRegGroupDelete'), ctx.req, [{ id: a.g.id }]); return r && r.ok ? ok(null) : r; },
  },
  {
    name: 'docreg.entry_delete', domain: 'docs', kind: 'danger', feature: 'doc-register',
    title: L('Nyilvántartási bejegyzés törlése', 'Ștergere înregistrare'),
    desc: L('Egy dokumentum-nyilvántartási bejegyzés végleges törlése a sorszáma alapján: number (pl. FCT-2026-0003). A szám nem adódik ki újra.', 'Șterge o înregistrare din registru după număr.'),
    params: { number: { type: 'text', required: true, max: 60 } },
    async check(ctx, a) {
      a.e = (await q(`SELECT id, reg_no, title FROM doc_register_entries WHERE company_id = $1 AND UPPER(reg_no) = UPPER($2)`, [ctx.cid, String(a.number).trim()]).catch(() => []))[0];
      return a.e ? null : { err: (hu(ctx) ? 'Nincs ilyen sorszám: ' : 'Nu există numărul: ') + a.number };
    },
    async preview(ctx, a) { return { rows: [['#', a.e.reg_no], [hu(ctx) ? 'Cím' : 'Titlu', a.e.title || '—']], label: a.e.reg_no }; },
    async run(ctx, a) { const r = await core.callH(H('documentRegister', 'docRegEntryDelete'), ctx.req, [{ id: a.e.id }]); return r && r.ok ? ok(null) : r; },
  },
  // ─── Fuvar-sablon, fuvar-sorozat, fuvar-dokumentum ───
  {
    name: 'order.template_rename', domain: 'orders', kind: 'write', feature: 'orders-form',
    title: L('Fuvar-sablon átnevezése', 'Redenumire șablon cursă'),
    desc: L('Ismétlődő fuvar-sablon átnevezése: template (jelenlegi név), name (új név).', 'Redenumește un șablon de cursă.'),
    params: { template: { type: 'text', required: true, max: 120 }, name: { type: 'text', required: true, max: 120 } },
    async check(ctx, a) { const f = pick(ctx, await q(`SELECT id, name FROM order_templates WHERE company_id = $1`, [ctx.cid]).catch(() => []), a.template, (r) => r.name, hu(ctx) ? 'sablon' : 'șablon'); if (!f.v) return f; a.t = f.v; return null; },
    async preview(ctx, a) { return { rows: [['📋', change(a.t.name, a.name)]], label: a.name }; },
    async snapshot(ctx, a) { return { id: a.t.id, name: a.t.name }; },
    async undo(ctx, b) { return core.callH(H('orderTemplates', 'orderTemplateRename'), ctx.req, [{ id: b.id, name: b.name }]); },
    async run(ctx, a) { const r = await core.callH(H('orderTemplates', 'orderTemplateRename'), ctx.req, [{ id: a.t.id, name: a.name }]); return r && r.ok ? ok(null) : r; },
  },
  {
    name: 'order.template_delete', domain: 'orders', kind: 'write', feature: 'orders-form',
    title: L('Fuvar-sablon törlése', 'Ștergere șablon cursă'),
    desc: L('Ismétlődő fuvar-sablon törlése: template (név).', 'Șterge un șablon de cursă.'),
    params: { template: { type: 'text', required: true, max: 120 } },
    async check(ctx, a) { const f = pick(ctx, await q(`SELECT id, name FROM order_templates WHERE company_id = $1`, [ctx.cid]).catch(() => []), a.template, (r) => r.name, hu(ctx) ? 'sablon' : 'șablon'); if (!f.v) return f; a.t = f.v; return null; },
    async preview(ctx, a) { return { rows: [['📋', a.t.name]], label: a.t.name }; },
    async run(ctx, a) { const r = await core.callH(H('orderTemplates', 'orderTemplateDelete'), ctx.req, [a.t.id]); return r && r.ok ? ok(null) : r; },
  },
  {
    name: 'order_series.delete', domain: 'settings', kind: 'write', roles: ['Admin'],
    title: L('Fuvar-sorozat törlése', 'Ștergere serie curse'),
    desc: L('Fuvar-szám sorozat törlése (az alapértelmezett nem törölhető): prefix. Csak Admin.', 'Șterge o serie de numerotare a curselor.'),
    params: { prefix: { type: 'text', required: true, max: 10 } },
    async check(ctx, a) {
      a.s = (await q(`SELECT id, prefix, is_default FROM order_series WHERE company_id = $1 AND UPPER(prefix) = UPPER($2)`, [ctx.cid, String(a.prefix).trim()]).catch(() => []))[0];
      if (!a.s) return { err: (hu(ctx) ? 'Nincs ilyen sorozat: ' : 'Nu există seria: ') + a.prefix };
      return a.s.is_default ? { err: hu(ctx) ? 'Az alapértelmezett sorozat nem törölhető.' : 'Seria implicită nu poate fi ștearsă.' } : null;
    },
    async preview(ctx, a) { return { rows: [['🔢', a.s.prefix]], label: a.s.prefix }; },
    async run(ctx, a) { const r = await core.callH(H('orderSeries', 'orderSeriesDelete'), ctx.req, [{ id: a.s.id }]); return r && r.ok ? ok(null) : r; },
  },
  {
    name: 'order.doc_delete', domain: 'docs', kind: 'danger', feature: 'order-docs',
    title: L('Fuvar-dokumentum törlése', 'Ștergere document cursă'),
    desc: L('Egy fuvarhoz feltöltött dokumentum törlése: order, document (a fájl neve vagy egy része).', 'Șterge un document încărcat la o cursă.'),
    params: { order: { type: 'order', required: true, fromHistory: true }, document: { type: 'text', required: true, max: 200 } },
    async check(ctx, a) {
      const rows = await q(`SELECT id, file_name AS filename, to_jsonb(d) ->> 'doc_type' AS doc_type FROM order_documents d WHERE company_id = $1 AND order_id = $2`, [ctx.cid, a.order.id]).catch(() => []);
      const f = pick(ctx, rows, a.document, (r) => r.filename || ('#' + r.id), hu(ctx) ? 'dokumentum' : 'document'); if (!f.v) return f; a.d = f.v; return null;
    },
    async preview(ctx, a) { return { rows: [['#', a.order.no], ['📎', a.d.filename || ('#' + a.d.id)]], label: a.order.no }; },
    async run(ctx, a) { const r = await core.callH(H('orderDocs', 'orderDocDelete'), ctx.req, [{ id: a.d.id }]); return r && r.ok ? ok(null, { order_id: a.order.id }) : r; },
  },
  // ─── Kampány-párosítás, vizuális sablon törlése ───
  {
    name: 'campaign.pair', domain: 'mail', kind: 'write', feature: 'email-builder',
    title: L('Sablon ↔ kontakt párosítás', 'Asociere șablon ↔ contacte'),
    desc: L('Mely kontaktok kapják az adott vizuális levél-sablont (a párosítás lecserélődik): template, contacts (nevek vesszővel, vagy „mindenki”).', 'Setează contactele asociate unui șablon vizual.'),
    params: { template: { type: 'text', required: true, max: 160 }, contacts: { type: 'text', required: true, max: 2000 } },
    async check(ctx, a) {
      const f = pick(ctx, await q(`SELECT id, name FROM email_builder_templates WHERE company_id = $1`, [ctx.cid]), a.template, (r) => r.name, hu(ctx) ? 'sablon' : 'șablon');
      if (!f.v) return f; a.t = f.v;
      const all = await q(`SELECT id, name FROM email_contacts WHERE company_id = $1`, [ctx.cid]);
      if (/^(mindenki|osszes|all|toti|toate)/.test(fold(a.contacts).trim())) { a.ids = all.map((c) => c.id); a.names = [hu(ctx) ? 'összes kontakt' : 'toate contactele']; return null; }
      a.ids = []; a.names = [];
      for (const p of String(a.contacts).split(/[,;\n]+|\s+(?:és|es|si|și)\s+/i).map((x) => x.trim()).filter(Boolean)) {
        const g = pick(ctx, all, p, (c) => c.name, hu(ctx) ? 'kontakt' : 'contact'); if (!g.v) return g;
        a.ids.push(g.v.id); a.names.push(g.v.name);
      }
      return a.ids.length ? null : { err: hu(ctx) ? 'Nincs kontakt megadva.' : 'Niciun contact.' };
    },
    async preview(ctx, a) { return { rows: [['🎨', a.t.name], [hu(ctx) ? 'Kontaktok' : 'Contacte', a.names.join(', ') + ' (' + a.ids.length + ')']], label: a.t.name }; },
    async run(ctx, a) { const r = await core.callH(H('emailBuilder', 'ebPairingSave'), ctx.req, [{ template_id: a.t.id, contact_ids: a.ids }]); return r && r.ok ? ok(null) : r; },
  },
  {
    name: 'campaign.template_delete', domain: 'mail', kind: 'danger', feature: 'email-builder',
    title: L('Vizuális levél-sablon törlése', 'Ștergere șablon vizual'),
    desc: L('Mentett vizuális levél-sablon törlése: template.', 'Șterge un șablon vizual de e-mail.'),
    params: { template: { type: 'text', required: true, max: 160 } },
    async check(ctx, a) { const f = pick(ctx, await q(`SELECT id, name FROM email_builder_templates WHERE company_id = $1`, [ctx.cid]), a.template, (r) => r.name, hu(ctx) ? 'sablon' : 'șablon'); if (!f.v) return f; a.t = f.v; return null; },
    async preview(ctx, a) { return { rows: [['🎨', a.t.name]], label: a.t.name }; },
    async run(ctx, a) { const r = await core.callH(H('emailBuilder', 'ebTemplateDelete'), ctx.req, [{ id: a.t.id }]); return r && r.ok ? ok(null) : r; },
  },
  // ─── Cégszintű kapcsolók (titok nélkül) ───
  {
    name: 'whatsapp.set', domain: 'settings', kind: 'write',
    title: L('Cég WhatsApp-száma', 'Număr WhatsApp firmă'),
    desc: L('A cég WhatsApp-száma, amire a sofőrök írnak: number (nemzetközi formában; üres = törlés).', 'Numărul WhatsApp al firmei pentru șoferi.'),
    params: { number: { type: 'text', max: 30 } },
    async check(ctx, a) { a.cur = ((await q(`SELECT whatsapp_number FROM companies WHERE id = $1`, [ctx.cid]).catch(() => []))[0] || {}).whatsapp_number || ''; a.number = a.number || ''; return null; },
    async preview(ctx, a) { return { rows: [['💬', change(a.cur, a.number)]] }; },
    async snapshot(ctx, a) { return { n: a.cur }; },
    async undo(ctx, b) { return core.callH(H('whatsappChat', 'saveCompanyWhatsapp'), ctx.req, [{ number: b.n || '' }]); },
    async run(ctx, a) { const r = await core.callH(H('whatsappChat', 'saveCompanyWhatsapp'), ctx.req, [{ number: a.number }]); return r && r.ok ? ok(null) : r; },
  },
  {
    name: 'bonscan.toggle', domain: 'settings', kind: 'write',
    title: L('AI bon-kiolvasás', 'Citire AI bonuri'),
    desc: L('Az AI bon-kiolvasás be- vagy kikapcsolása a cég sofőrjeinek: enabled.', 'Pornește / oprește citirea AI a bonurilor pentru șoferi.'),
    params: { enabled: { type: 'bool', required: true } },
    async preview(ctx, a) { return { rows: [['📷', onoff(ctx, a.enabled)]] }; },
    async snapshot(ctx, a) { return { e: !a.enabled }; },
    async undo(ctx, b) { return core.callH(H('receiptScan', 'setBonScanEnabled'), ctx.req, [{ key: 'ai-bon-scan', enabled: b.e }]); },
    async run(ctx, a) { const r = await core.callH(H('receiptScan', 'setBonScanEnabled'), ctx.req, [{ key: 'ai-bon-scan', enabled: a.enabled }]); return r && r.ok ? ok(null) : r; },
  },
  {
    name: 'digest.set', domain: 'settings', kind: 'write', roles: ['Admin'],
    title: L('Reggeli összefoglaló e-mail', 'Rezumat de dimineață'),
    desc: L('Reggeli összefoglaló e-mail beállítása: enabled, time (ÓÓ:PP, alap 07:00), recipients (e-mail címek vesszővel). Csak Admin.', 'Setează e-mailul de rezumat de dimineață.'),
    params: { enabled: { type: 'bool', default: true }, time: { type: 'text', max: 5 }, recipients: { type: 'text', max: 2000 } },
    async check(ctx, a) {
      const r = await core.callH(H('morningDigest', 'getMorningDigest'), ctx.req, []);
      a.cur = r && r.ok ? { enabled: r.enabled, time: r.time, recipients: r.recipients } : {};
      a.list = a.recipients != null ? String(a.recipients).split(/[,;\s]+/).filter((e) => EMAIL_RE.test(e)).slice(0, 20) : (Array.isArray(a.cur.recipients) ? a.cur.recipients : []);
      a.t = a.time && /^\d{1,2}:\d{2}$/.test(a.time) ? a.time.padStart(5, '0') : (a.cur.time || '07:00');
      return null;
    },
    async preview(ctx, a) { return { rows: [['☀️', onoff(ctx, a.enabled)], [hu(ctx) ? 'Időpont' : 'Ora', a.t], [hu(ctx) ? 'Címzettek' : 'Destinatari', a.list.join(', ') || '—']] }; },
    async run(ctx, a) { const r = await core.callH(H('morningDigest', 'saveMorningDigest'), ctx.req, [Object.assign({}, a.cur, { enabled: a.enabled, time: a.t, recipients: a.list })]); return r && r.ok ? ok(null) : r; },
  },
  // ─── Költség-kalkulátor ───
  {
    name: 'vcalc.settings', domain: 'finance', kind: 'write', roles: ['Admin'], feature: 'vcalc-settings',
    title: L('Kalkulátor-beállítások', 'Setări calculator'),
    desc: L('Költség-kalkulátor alapbeállításai (a többi megmarad): annual_km (éves km-cél), weeks (munkahét/év). Csak Admin.', 'Setările de bază ale calculatorului de costuri.'),
    params: { annual_km: { type: 'number' }, weeks: { type: 'int' } },
    async check(ctx, a) {
      if (a.annual_km == null && a.weeks == null) return { ask: { text: hu(ctx) ? 'Mit állítsak (éves km-cél, munkahetek)?' : 'Ce setez (km anuali, săptămâni)?', options: [] } };
      const r = await core.callH(H('costCalculator', 'vcalcSettingsGet'), ctx.req, []);
      a.cur = (r && r.settings) || {};
      return null;
    },
    async preview(ctx, a) {
      const rows = [];
      if (a.annual_km != null) rows.push([hu(ctx) ? 'Éves km-cél' : 'Km anuali', change(a.cur.annual_km_target, a.annual_km)]);
      if (a.weeks != null) rows.push([hu(ctx) ? 'Munkahét / év' : 'Săptămâni / an', change(a.cur.working_weeks_per_year, a.weeks)]);
      return { rows };
    },
    async snapshot(ctx, a) { return { c: a.cur }; },
    async undo(ctx, b) { return core.callH(H('costCalculator', 'vcalcSettingsSave'), ctx.req, [b.c || {}]); },
    async run(ctx, a) {
      const r = await core.callH(H('costCalculator', 'vcalcSettingsSave'), ctx.req, [Object.assign({}, a.cur, a.annual_km != null ? { annual_km_target: a.annual_km } : {}, a.weeks != null ? { working_weeks_per_year: a.weeks } : {})]);
      return r && r.ok ? ok(null) : r;
    },
  },
  {
    name: 'vcalc.calc_delete', domain: 'finance', kind: 'write', feature: 'vcalc-saved',
    title: L('Mentett kalkuláció törlése', 'Ștergere calculație salvată'),
    desc: L('Mentett költség-kalkuláció törlése a sorszáma alapján: number.', 'Șterge o calculație salvată după număr.'),
    params: { number: { type: 'text', required: true, max: 40 } },
    async check(ctx, a) {
      a.c = (await q(`SELECT id, serial_no FROM cost_calculations WHERE company_id = $1 AND (UPPER(serial_no) = UPPER($2) OR id::text = $2)`, [ctx.cid, String(a.number).trim()]).catch(() => []))[0];
      return a.c ? null : { err: (hu(ctx) ? 'Nincs ilyen kalkuláció: ' : 'Nu există calculația: ') + a.number };
    },
    async preview(ctx, a) { return { rows: [['📊', a.c.serial_no || ('#' + a.c.id)]] }; },
    async run(ctx, a) { const r = await core.callH(H('costCalculator', 'vcalcCalcDelete'), ctx.req, [{ id: a.c.id }]); return r && r.ok ? ok(null) : r; },
  },
  // ─── Postafiók, PDF-munkatér ───
  {
    name: 'mail.sync', domain: 'mail', kind: 'write', feature: 'mail-inbox',
    title: L('Postafiók frissítése', 'Sincronizare căsuță'),
    desc: L('A bekötött postafiókok azonnali frissítése (új levelek fejléce).', 'Sincronizează acum căsuțele de e-mail.'),
    async preview(ctx) { return { rows: [['📥', hu(ctx) ? 'új levelek lekérése most' : 'preluare e-mailuri noi acum']] }; },
    async run(ctx) { const r = await core.callH(H('mailbox', 'mailSyncNow'), ctx.req, [{}]); return r && r.ok ? ok(hu(ctx) ? '✅ Frissítve.' : '✅ Sincronizat.') : r; },
  },
  {
    name: 'pdf_workspace.list', domain: 'docs', kind: 'read', feature: 'signature',
    desc: L('Az aláírásra / pecsételésre feltöltött PDF-ek (24 óráig tárolva).', 'PDF-urile încărcate pentru semnare (păstrate 24 h).'),
    async run(ctx) {
      const r = await core.callH(H('pdfWorkspace', 'pdfWorkspaceList'), ctx.req, []);
      const rows = ((r && r.docs) || []).map((d) => ({ name: d.file_name, signed: d.has_signed ? '✅' : '—', at: fmtD(d10(d.created_at)) }));
      return { reply: hu(ctx) ? rows.length + ' PDF a munkatérben.' : rows.length + ' PDF-uri.', html: info(listCard(ctx, '📄', hu(ctx) ? 'PDF-munkatér' : 'Spațiu PDF', rows,
        [{ k: 'name', l: L('Fájl', 'Fișier') }, { k: 'signed', l: L('Aláírva', 'Semnat') }, { k: 'at', l: L('Feltöltve', 'Încărcat') }])) };
    },
  },
  {
    name: 'pdf_workspace.delete', domain: 'docs', kind: 'write', feature: 'signature',
    title: L('PDF törlése a munkatérből', 'Ștergere PDF din spațiu'),
    desc: L('Feltöltött PDF törlése az aláírás-munkatérből: file (a fájl neve vagy egy része).', 'Șterge un PDF din spațiul de semnare.'),
    params: { file: { type: 'text', required: true, max: 200 } },
    async check(ctx, a) {
      const r = await core.callH(H('pdfWorkspace', 'pdfWorkspaceList'), ctx.req, []);
      const f = pick(ctx, (r && r.docs) || [], a.file, (d) => d.file_name || '', hu(ctx) ? 'fájl' : 'fișier'); if (!f.v) return f; a.d = f.v; return null;
    },
    async preview(ctx, a) { return { rows: [['📄', a.d.file_name]] }; },
    async run(ctx, a) { const r = await core.callH(H('pdfWorkspace', 'pdfWorkspaceDelete'), ctx.req, [a.d.id]); return r && r.ok ? ok(null) : r; },
  },
];
