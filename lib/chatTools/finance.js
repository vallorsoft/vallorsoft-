// ============================================================
//  VallorSoft — lib/chatTools/finance.js
//  👷 Sofőr-elszámolás + 💶 pénzügy chatből. Pénzügyi SZÁMOK csak
//  `stats_finance` joggal (Admin mindig); számla kiállítás / storno
//  `invoice_issue` joggal, dupla megerősítéssel.
// ============================================================
'use strict';

const core = require('./core');
const di = require('../driverInfo');
const pool = require('../../db');

const { esc, fmtN, fmtD, num } = core.fmt;
const { change, listCard, kvCard } = core.card;
const L = (hu, ro) => ({ hu, ro });
const q = core.q;
const H = core.H;
const d10 = (v) => (v instanceof Date ? di._h.iso(v) : (v ? String(v).slice(0, 10) : ''));
const ok = (reply, extra) => Object.assign({ ok: true, reply }, extra || {});
const hu = (ctx) => ctx.lang === 'hu';
const money = (v, cur) => fmtN(num(v), 2) + ' ' + (cur || 'EUR');

const EARN_KINDS = ['diurna', 'bonus', 'per_diem', 'salary', 'premium', 'holiday', 'other'];
const PAY_METHODS = ['cash', 'bank', 'card', 'other'];
const KIND_L = {
  diurna: L('Diurna', 'Diurnă'), bonus: L('Bónusz', 'Bonus'), per_diem: L('Napidíj', 'Diurnă/zi'), salary: L('Bér', 'Salariu'),
  premium: L('Prémium', 'Primă'), holiday: L('Szabadság', 'Concediu'), other: L('Egyéb', 'Altele'),
};

// Napok listája „2026-10-01..2026-10-04” vagy vesszős dátumok alapján (diurna-naptár).
function daysOf(raw, now) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const R = require('./resolve');
  const out = new Set();
  for (const part of s.split(/[,;]+/).map((x) => x.trim()).filter(Boolean)) {
    const p = R.parsePeriod(part, now);
    if (p && /\.\.|–/.test(part)) {
      const d = new Date(p.from + 'T00:00:00'); const end = new Date(p.to + 'T00:00:00');
      while (d <= end && out.size < 62) { out.add(di._h.iso(d)); d.setDate(d.getDate() + 1); }
    } else {
      const x = R.parseDate(part, now);
      if (x) out.add(x);
    }
  }
  return out.size ? Array.from(out).sort() : null;
}

module.exports = [
  // ─── Sofőrök ───
  {
    name: 'driver.list', domain: 'drivers', kind: 'read', feature: 'internal-drivers',
    desc: L('Belső sofőrök listája (jármű-párosítással, telefonnal).', 'Lista șoferilor interni.'),
    async run(ctx) {
      const rows = await q(`SELECT u.nume, u.email, u.tel, COALESCE(u.blocked,false) AS blocked, v.rendszam
                              FROM users u LEFT JOIN vehicles v ON LOWER(v.assigned_driver_email) = LOWER(u.email) AND v.company_id = u.company_id
                             WHERE u.company_id = $1 AND u.pozicio = 'Sofer' ORDER BY u.nume LIMIT 300`, [ctx.cid]);
      return { reply: hu(ctx) ? rows.length + ' sofőr.' : rows.length + ' șoferi.', html: '<div class="och-info">' + listCard(ctx, '👷', hu(ctx) ? 'Sofőrök' : 'Șoferi', rows, [
        { k: 'nume', l: L('Név', 'Nume'), f: (v, r) => ({ __html: '<a href="#" onclick="OrderChat.runUi({op:\'driver\',id:\'' + esc(r.email) + '\',name:\'' + esc(String(v || '').replace(/'/g, '')) + '\'});return false;">' + esc(v) + '</a>' }) },
        { k: 'tel', l: L('Telefon', 'Telefon') }, { k: 'rendszam', l: L('Vontató', 'Camion') }, { k: 'blocked', l: L('Letiltva', 'Blocat'), f: (v) => (v ? '⛔' : '') }], 80) + '</div>' };
    },
  },
  {
    name: 'driver.balance', domain: 'drivers', kind: 'read', feature: 'decont',
    desc: L('Egy sofőr elszámolása egy időszakra: járandóság, kifizetve, hátralék (EUR + RON), diurna-napok.', 'Decontul unui șofer: drepturi, plătit, rest.'),
    examples: L(['mennyivel tartozunk Gondosnak?', 'Gondos szeptemberi elszámolása'], ['cât îi datorăm lui Gondos?']),
    params: { driver: { type: 'driver', required: true }, period: { type: 'period' } },
    async run(ctx, a) {
      const r = await core.callH(H('fleetCompliance', 'getDriverBalance'), ctx.req, [{ email: a.driver.email, from: a.period && a.period.from, to: a.period && a.period.to }]);
      if (!r || r.ok === false) return r;
      const rem = r.remaining_period || r.balance || {};
      const rows = [
        [hu(ctx) ? 'Járandóság' : 'Drepturi', money(r.earned.eur, 'EUR') + ' + ' + money(r.earned.ron, 'RON')],
        [hu(ctx) ? 'Kifizetve' : 'Plătit', money((r.settled_period || r.paid).eur, 'EUR') + ' + ' + money((r.settled_period || r.paid).ron, 'RON')],
        [hu(ctx) ? 'Hátralék' : 'Rest de plată', { __html: '<b>' + esc(money(rem.eur, 'EUR') + ' + ' + money(rem.ron, 'RON')) + '</b>' }],
      ];
      if (r.diurna_days) rows.push([hu(ctx) ? 'Diurna-napok (benti / kinti)' : 'Zile diurnă (int./ext.)', (r.diurna_days.int || 0) + ' / ' + (r.diurna_days.ext || 0)]);
      if (r.bnr_rate) rows.push(['BNR', fmtN(num(r.bnr_rate), 4)]);
      const per = a.period ? fmtD(a.period.from) + ' – ' + fmtD(a.period.to) : (hu(ctx) ? 'teljes időszak' : 'toată perioada');
      return { reply: (hu(ctx) ? a.driver.name + ' hátraléka: ' : 'Rest pentru ' + a.driver.name + ': ') + money(rem.eur, 'EUR') + ' + ' + money(rem.ron, 'RON') + '.',
        html: '<div class="och-info">' + kvCard('💶', a.driver.name + ' · ' + per, rows) + '<div class="och-info-btns"><button type="button" class="och-info-btn" onclick="OrderChat.runUi({op:\'decont\',id:\'' + esc(a.driver.email) + '\'})">' + (hu(ctx) ? '📄 Elszámolás megnyitása' : '📄 Deschide decontul') + '</button></div></div>' };
    },
  },
  {
    name: 'driver.settlement_open', domain: 'drivers', kind: 'ui', feature: 'decont',
    desc: L('A sofőr-elszámolás (decont) megnyitása egy sofőrre — innen nyomtatható a Decont lunar / oficial / sumar.', 'Deschide decontul șoferului.'),
    params: { driver: { type: 'driver', required: true } },
    async run(ctx, a) { return { reply: core.tx(ctx.lang).opened(a.driver.name), ui: { op: 'decont', id: a.driver.email } }; },
  },
  {
    name: 'driver.earning_add', domain: 'drivers', kind: 'write', feature: 'decont',
    title: L('Járandóság felvétele', 'Adăugare drept'),
    desc: L('Sofőr-járandóság felvétele: kind (' + EARN_KINDS.join('|') + '), quantity × unit_amount, currency (EUR|RON), date, label. Diurnánál days = napok („2026-10-01..2026-10-04” vagy vesszős dátumok).', 'Adaugă un drept pentru șofer.'),
    examples: L(['Gondosnak 6 nap diurna 70 euró', 'Gondosnak 200 lej bónusz'], ['lui Gondos 6 zile diurnă 70 euro']),
    params: { driver: { type: 'driver', required: true }, kind: { type: 'enum', values: EARN_KINDS, default: 'bonus' }, quantity: { type: 'number', min: 0.01, maxv: 1000, default: 1 },
      unit_amount: { type: 'money', min: 0.01, maxv: 1e6, required: true, ask: L('Mennyi az egységár?', 'Care e suma pe unitate?') }, currency: { type: 'enum', values: ['EUR', 'RON'], default: 'EUR' },
      date: { type: 'date' }, days: { type: 'text', max: 400 }, label: { type: 'text', max: 120 } },
    async preview(ctx, a) {
      a.days_list = (a.kind === 'diurna' || a.kind === 'per_diem') ? daysOf(a.days, ctx.now) : null;
      const qty = a.days_list ? a.days_list.length : a.quantity;
      a.date = a.date || di._h.iso(ctx.now);
      const rows = [[hu(ctx) ? 'Sofőr' : 'Șofer', a.driver.name], [hu(ctx) ? 'Típus' : 'Tip', KIND_L[a.kind][ctx.lang] + (a.label ? ' · ' + a.label : '')],
        [hu(ctx) ? 'Mennyiség × egységár' : 'Cantitate × preț', fmtN(qty, 2) + ' × ' + money(a.unit_amount, a.currency)], [hu(ctx) ? 'Összesen' : 'Total', { __html: '<b>' + esc(money(qty * a.unit_amount, a.currency)) + '</b>' }]];
      if (a.days_list) rows.push([hu(ctx) ? 'Napok' : 'Zile', a.days_list.map((d) => fmtD(d)).join(', ')]);
      else rows.push([hu(ctx) ? 'Dátum' : 'Data', fmtD(a.date)]);
      return { rows, label: a.driver.name };
    },
    async snapshot() { return {}; },
    async undo(ctx, b, res) { return res && res.id ? core.callH(H('fleetCompliance', 'earningDelete'), ctx.req, [{ id: res.id }]) : { ok: false }; },
    async run(ctx, a) {
      const r = await core.callH(H('fleetCompliance', 'earningCreate'), ctx.req, [{ email_sofer: a.driver.email, kind: a.kind, label: a.label, quantity: a.quantity, unit_amount: a.unit_amount, currency: a.currency, earning_date: a.date, days: a.days_list || undefined }]);
      return r && r.ok ? ok(null, { entity_id: r.id || null }) : r;
    },
  },
  {
    name: 'driver.payment_add', domain: 'drivers', kind: 'write', feature: 'decont',
    title: L('Sofőr-kifizetés rögzítése', 'Înregistrare plată șofer'),
    desc: L('Kifizetés rögzítése a sofőrnek: amount, currency (EUR|RON), method (' + PAY_METHODS.join('|') + '), date (jövőbeli = ütemezett), note. A BNR-árfolyam automatikus.', 'Înregistrează o plată către șofer.'),
    examples: L(['fizess ki Gondosnak 500 eurót készpénzben'], ['plătește-i lui Gondos 500 euro cash']),
    params: { driver: { type: 'driver', required: true }, amount: { type: 'money', min: 0.01, maxv: 1e6, required: true }, currency: { type: 'enum', values: ['EUR', 'RON'], default: 'EUR' },
      method: { type: 'enum', values: PAY_METHODS, default: 'cash' }, date: { type: 'date' }, note: { type: 'text', max: 300 } },
    async preview(ctx, a) {
      a.date = a.date || di._h.iso(ctx.now);
      const future = a.date > di._h.iso(ctx.now);
      return { rows: [[hu(ctx) ? 'Sofőr' : 'Șofer', a.driver.name], [hu(ctx) ? 'Összeg' : 'Sumă', { __html: '<b>' + esc(money(a.amount, a.currency)) + '</b>' }], [hu(ctx) ? 'Mód' : 'Metodă', a.method],
        [hu(ctx) ? 'Dátum' : 'Data', fmtD(a.date) + (future ? (hu(ctx) ? ' (ütemezett)' : ' (programată)') : '')], [hu(ctx) ? 'Megjegyzés' : 'Notă', a.note || '—']], label: a.driver.name };
    },
    async snapshot() { return {}; },
    async undo(ctx, b, res) { return res && res.id ? core.callH(H('fleetCompliance', 'paymentDelete'), ctx.req, [{ id: res.id }]) : { ok: false }; },
    async run(ctx, a) {
      const r = await core.callH(H('fleetCompliance', 'paymentCreate'), ctx.req, [{ email_sofer: a.driver.email, amount: a.amount, currency: a.currency, method: a.method, paid_at: a.date, note: a.note }]);
      return r && r.ok ? ok(null, { entity_id: r.id || null, ui: null }) : r;
    },
  },
  {
    name: 'driver.base_salary', domain: 'drivers', kind: 'write', feature: 'decont',
    title: L('Nettó alapbér beállítása', 'Setare salariu de bază'),
    desc: L('A sofőr nettó havi alapbérének (RON) beállítása a Decont oficialhoz.', 'Setează salariul net de bază (RON).'),
    params: { driver: { type: 'driver', required: true }, amount_ron: { type: 'money', min: 0, maxv: 100000, required: true } },
    async preview(ctx, a) {
      const cur = await q(`SELECT net_base_salary_ron FROM users WHERE company_id = $1 AND LOWER(email) = $2`, [ctx.cid, a.driver.email]).catch(() => []);
      return { rows: [[hu(ctx) ? 'Sofőr' : 'Șofer', a.driver.name], [hu(ctx) ? 'Alapbér' : 'Salariu de bază', change(cur[0] && cur[0].net_base_salary_ron != null ? money(cur[0].net_base_salary_ron, 'RON') : null, money(a.amount_ron, 'RON'))]] };
    },
    async snapshot(ctx, a) {
      const cur = await q(`SELECT net_base_salary_ron FROM users WHERE company_id = $1 AND LOWER(email) = $2`, [ctx.cid, a.driver.email]).catch(() => []);
      return cur[0] && cur[0].net_base_salary_ron != null ? { email: a.driver.email, v: num(cur[0].net_base_salary_ron) } : null;
    },
    async undo(ctx, b) { return b ? core.callH(H('fleetCompliance', 'setDriverBaseSalary'), ctx.req, [{ email: b.email, base_salary_ron: b.v }]) : { ok: false }; },
    async run(ctx, a) {
      const r = await core.callH(H('fleetCompliance', 'setDriverBaseSalary'), ctx.req, [{ email: a.driver.email, base_salary_ron: a.amount_ron }]);
      return r && r.ok ? ok(null) : r;
    },
  },
  {
    name: 'user.invite', domain: 'drivers', kind: 'write', feature: 'invites', perm: 'users_manage',
    title: L('Meghívó küldése', 'Trimitere invitație'),
    desc: L('Meghívó új munkatársnak (role: Sofer|Manager|Konyvelo|Admin; Manager csak Sofőrt hívhat) e-mailben, névvel, telefonnal.', 'Invitație pentru un coleg nou.'),
    examples: L(['hívd meg Kiss Pétert sofőrnek, kiss.peter@gmail.com'], ['invită-l pe Ion ca șofer, ion@gmail.com']),
    params: { role: { type: 'enum', values: ['Sofer', 'Manager', 'Konyvelo', 'Admin'], default: 'Sofer' }, email: { type: 'email', required: true }, name: { type: 'text', max: 120 }, phone: { type: 'text', max: 30 } },
    async check(ctx, a) {
      if (ctx.user.pozicio === 'Manager' && a.role !== 'Sofer') return { err: hu(ctx) ? 'Manager csak sofőrt hívhat meg.' : 'Managerul poate invita doar șoferi.' };
      return null;
    },
    async preview(ctx, a) {
      return { rows: [[hu(ctx) ? 'Szerep' : 'Rol', a.role], ['E-mail', a.email], [hu(ctx) ? 'Név' : 'Nume', a.name || '—'], [hu(ctx) ? 'Telefon' : 'Telefon', a.phone || '—']] };
    },
    async run(ctx, a) {
      const r = await core.callH(H('invites', 'invCreate'), ctx.req, [a.role, a.email, a.name || '', a.phone || '']);
      return r && r.ok ? ok((hu(ctx) ? '✅ Meghívó elküldve. Kód: ' : '✅ Invitație trimisă. Cod: ') + r.kod) : r;
    },
  },
  // ─── Pénzügy ───
  {
    name: 'finance.bnr', domain: 'finance', kind: 'read', feature: 'bnr-rate',
    desc: L('Mai BNR EUR/RON árfolyam (és a cég saját átváltási rátája).', 'Cursul BNR EUR/RON de azi.'),
    async run(ctx) {
      const r = await core.callH(H('bnr', 'getBnrRate'), ctx.req, [{}]);
      if (!r || r.ok === false) return r;
      return { reply: 'BNR: 1 EUR = ' + (r.bnr_rate ? fmtN(num(r.bnr_rate), 4) : '—') + ' RON', html: '<div class="och-info">' + kvCard('💱', 'BNR', [['1 EUR', r.bnr_rate ? fmtN(num(r.bnr_rate), 4) + ' RON' : '—'], [hu(ctx) ? 'Céges ráta' : 'Curs firmă', r.company_rate ? fmtN(num(r.company_rate), 4) : '—']]) + '</div>' };
    },
  },
  {
    name: 'finance.revenue', domain: 'finance', kind: 'read', feature: 'stats-finance', perm: 'stats_finance',
    desc: L('Bevétel egy időszakra: lezárt fuvarok száma, fuvardíj összesen, beszedve, kintlévő, átlagár, km.', 'Venit pe o perioadă.'),
    examples: L(['mennyi volt a bevétel szeptemberben?'], ['cât a fost venitul în septembrie?']),
    params: { period: { type: 'period', default: 'this_month' } },
    async run(ctx, a) {
      const r = await q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(pret),0) AS rev, COALESCE(SUM(LEAST(COALESCE(paid_amount,0), COALESCE(pret,0))),0) AS paid, COALESCE(SUM(km),0) AS km
                           FROM orders WHERE company_id = $1 AND status = 'Finalizat'
                            AND COALESCE(finalized_at::date, data_descarcare::date, created_at::date) BETWEEN $2::date AND $3::date`, [ctx.cid, a.period.from, a.period.to]);
      const x = r[0] || {};
      const per = fmtD(a.period.from) + ' – ' + fmtD(a.period.to);
      return { reply: (hu(ctx) ? 'Bevétel (' + per + '): ' : 'Venit (' + per + '): ') + money(x.rev, 'EUR'),
        html: '<div class="och-info">' + kvCard('💶', per, [[hu(ctx) ? 'Lezárt fuvar' : 'Curse finalizate', x.n], [hu(ctx) ? 'Bevétel' : 'Venit', money(x.rev)], [hu(ctx) ? 'Beszedve' : 'Încasat', money(x.paid)],
          [hu(ctx) ? 'Kintlévő' : 'De încasat', money(num(x.rev) - num(x.paid))], [hu(ctx) ? 'Átlag / fuvar' : 'Medie / cursă', x.n ? money(num(x.rev) / x.n) : '—'], ['Km', fmtN(num(x.km), 0)],
          ['€/km', num(x.km) ? fmtN(num(x.rev) / num(x.km), 2) : '—']]) + '</div>' };
    },
  },
  {
    name: 'finance.payment_schedule', domain: 'finance', kind: 'read', feature: 'payment-schedule', perm: 'stats_finance',
    desc: L('Fizetési ütemterv: várható befizetések (ügyfelek) és kifizetések (alvállalkozók), lejártak, 7/30 napon belül.', 'Program plăți: încasări și plăți scadente.'),
    params: { direction: { type: 'enum', values: ['in', 'out', 'all'], default: 'all' } },
    async run(ctx, a) {
      const r = await core.callH(H('paymentSchedule', 'getPaymentSchedule'), ctx.req, [{}]);
      if (!r || r.ok === false) return r;
      const rows = (r.schedule || []).filter((x) => a.direction === 'all' || x.direction === a.direction);
      const tt = r.totals || {};
      return { reply: (hu(ctx) ? 'Lejárt: ' : 'Restant: ') + fmtN(num(tt.overdue), 2) + ' · 7 ' + (hu(ctx) ? 'nap: ' : 'zile: ') + fmtN(num(tt.due7), 2),
        html: '<div class="och-info">' + listCard(ctx, '📅', hu(ctx) ? 'Fizetési ütemterv' : 'Program plăți', rows, [
          { k: 'due_date', l: L('Esedékes', 'Scadent'), f: (v) => fmtD(d10(v)) }, { k: 'direction', l: L('Irány', 'Direcție'), f: (v) => (v === 'out' ? (hu(ctx) ? '⬇ befizetés' : '⬇ încasare') : (hu(ctx) ? '⬆ kifizetés' : '⬆ plată')) },
          { k: 'partner', l: L('Partner', 'Partener') }, { k: 'reference', l: L('Hivatkozás', 'Referință') }, { k: 'amount', l: L('Összeg', 'Sumă'), f: (v, x) => money(v, x.currency) }]) + '</div>' };
    },
  },
  {
    name: 'finance.invoices_out', domain: 'finance', kind: 'read', feature: 'invoices-out', perm: 'stats_finance',
    desc: L('Kimenő számlák listája egy időszakra (szám, ügyfél, összeg, e-Factura állapot).', 'Facturi emise pe o perioadă.'),
    params: { period: { type: 'period', default: 'this_month' } },
    async run(ctx, a) {
      const rows = await q(`SELECT serie, numar, client_name, total, valuta, status, efactura_status, created_at, order_id FROM invoices
                             WHERE company_id = $1 AND created_at::date BETWEEN $2::date AND $3::date ORDER BY created_at DESC LIMIT 300`, [ctx.cid, a.period.from, a.period.to]);
      return { html: '<div class="och-info">' + listCard(ctx, '📤', hu(ctx) ? 'Kimenő számlák' : 'Facturi emise', rows, [
        { k: 'numar', l: L('Szám', 'Număr'), f: (v, x) => [x.serie, v].filter(Boolean).join(' ') }, { k: 'created_at', l: L('Dátum', 'Data'), f: (v) => fmtD(d10(v)) },
        { k: 'client_name', l: L('Ügyfél', 'Client') }, { k: 'total', l: L('Összeg', 'Total'), f: (v, x) => money(v, x.valuta) }, { k: 'status', l: L('Állapot', 'Stare') }, { k: 'efactura_status', l: L('e-Factura', 'e-Factura') }]) + '</div>' };
    },
  },
  {
    name: 'finance.invoice_issue', domain: 'finance', kind: 'danger', feature: ['invoices-out', 'szamlazas-integracio'], perm: 'invoice_issue',
    title: L('Számla kiállítása', 'Emitere factură'),
    desc: L('Számla kiállítása egy lezárt fuvarról a cég számlázó-szolgáltatóján (FGO/SmartBill/Oblio…).', 'Emite factura pentru o cursă prin facturatorul firmei.'),
    params: { order: { type: 'order', required: true, fromHistory: true } },
    async preview(ctx, a) {
      const svc = require('../../services/invoicing');
      const cfg = await svc.getInvoiceConfig(pool, ctx.cid);
      if (!cfg) return { err: hu(ctx) ? 'Nincs bekötött számlázó (Integrációk).' : 'Nu există facturator activat (Integrări).' };
      const o = (await q(`SELECT * FROM orders WHERE id = $1 AND company_id = $2`, [a.order.id, ctx.cid]))[0];
      if (!o) return { err: 'Cursa nu a fost gasita.' };
      const ex = await svc.getStoredInvoice(pool, ctx.cid, o.id).catch(() => null);
      if (ex && ex.status !== 'storno' && ex.numar) return { err: (hu(ctx) ? 'Erre a fuvarra már van számla: ' : 'Cursa are deja factură: ') + [ex.serie, ex.numar].filter(Boolean).join(' ') };
      return { rows: [['#', a.order.no], [hu(ctx) ? 'Ügyfél' : 'Client', o.client || '—'], [hu(ctx) ? 'Összeg' : 'Sumă', money(o.pret)], [hu(ctx) ? 'Szolgáltató' : 'Facturator', cfg.provider || cfg.type || '—']], label: '#' + a.order.no };
    },
    async run(ctx, a) {
      const svc = require('../../services/invoicing');
      try {
        const cfg = await svc.getInvoiceConfig(pool, ctx.cid);
        if (!cfg) return { ok: false, err: 'Nu exista facturator activat.' };
        const o = (await q(`SELECT * FROM orders WHERE id = $1 AND company_id = $2`, [a.order.id, ctx.cid]))[0];
        if (!o) return { ok: false, err: 'Cursa nu a fost gasita.' };
        let client = null;
        if (o.client_id) client = (await q(`SELECT * FROM clients WHERE id = $1 AND company_id = $2`, [o.client_id, ctx.cid]))[0] || null;
        const inv = svc.buildInvoiceFromOrder(o, client, cfg);
        const r = await svc.emitInvoice(pool, ctx.cid, ctx.uid, o.id, inv);
        return ok((hu(ctx) ? '✅ Számla kiállítva: ' : '✅ Factură emisă: ') + [r.serie, r.numar].filter(Boolean).join(' '), { order_id: o.id, entity_id: o.id });
      } catch (e) { return { ok: false, err: String((e && e.message) || 'Eroare').slice(0, 300) }; }
    },
  },
  {
    name: 'finance.invoice_storno', domain: 'finance', kind: 'danger', feature: ['invoices-out', 'szamlazas-integracio'], perm: 'invoice_issue',
    title: L('Számla stornózása', 'Stornare factură'),
    desc: L('A fuvarhoz kiállított számla stornózása (jóváíró számla).', 'Stornează factura emisă pentru cursă.'),
    params: { order: { type: 'order', required: true, fromHistory: true } },
    async preview(ctx, a) {
      const svc = require('../../services/invoicing');
      const ex = await svc.getStoredInvoice(pool, ctx.cid, a.order.id).catch(() => null);
      if (!ex || !ex.numar) return { err: hu(ctx) ? 'Ehhez a fuvarhoz nincs kiállított számla.' : 'Cursa nu are factură emisă.' };
      return { rows: [['#', a.order.no], [hu(ctx) ? 'Számla' : 'Factură', [ex.serie, ex.numar].filter(Boolean).join(' ')], [hu(ctx) ? 'Összeg' : 'Sumă', money(ex.total, ex.valuta)]], label: '#' + a.order.no };
    },
    async run(ctx, a) {
      const svc = require('../../services/invoicing');
      try {
        const r = await svc.emitStorno(pool, ctx.cid, ctx.uid, a.order.id);
        return ok((hu(ctx) ? '✅ Storno kiállítva: ' : '✅ Storno emis: ') + [r.serie, r.numar].filter(Boolean).join(' '), { order_id: a.order.id, entity_id: a.order.id });
      } catch (e) { return { ok: false, err: String((e && e.message) || 'Eroare').slice(0, 300) }; }
    },
  },
  {
    name: 'finance.insights', domain: 'finance', kind: 'read', feature: 'stats-v2',
    desc: L('Anomália-központ: a legfontosabb teendők és figyelmeztetések (fogyasztás, kintlévőség, szerviz, lejáratok, UIT…).', 'Centrul de anomalii: cele mai importante probleme.'),
    examples: L(['mi a legfontosabb teendő ma?', 'van valami gond?'], ['ce probleme sunt azi?']),
    async run(ctx) {
      const r = await core.callH(H('statsInsights', 'getStatsInsights'), ctx.req, [{}]);
      if (!r || r.ok === false) return r;
      const ico = { danger: '🔴', warn: '🟠', info: '🔵' };
      return { html: '<div class="och-info">' + listCard(ctx, '💡', hu(ctx) ? 'Figyelmet igényel' : 'Necesită atenție', r.insights || [], [
        { k: 'severity', l: L('', ''), f: (v) => ico[v] || '•' }, { k: 'title', l: L('Mi', 'Ce') }, { k: 'detail', l: L('Részlet', 'Detaliu') }], 20) + '</div>' };
    },
  },
];
module.exports._daysOf = daysOf;
