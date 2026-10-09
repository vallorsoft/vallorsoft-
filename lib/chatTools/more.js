// ============================================================
//  VallorSoft — lib/chatTools/more.js
//  A többi terület chatből: ügyfelek, alvállalkozók (+ bejövő számlák),
//  dokumentumok (fuvar-dokumentumok, hiányzó menetlevél, sorszám-foglalás),
//  raktár, levelek (CSAK fejléc), értesítések, kedvenc helyek, operatív
//  összefoglaló. Írás mindig a meglévő handleren vagy cégre szűrt SQL-lel.
//  A dokumentum-/levél-tartalom SOHA nem kerül AI-hoz — a kártyát a szerver rendereli.
// ============================================================
'use strict';

const core = require('./core');
const di = require('../driverInfo');

const { esc, fmtN, fmtD, num, fold } = core.fmt;
const { change, listCard, kvCard } = core.card;
const L = (hu, ro) => ({ hu, ro });
const q = core.q;
const H = core.H;
const d10 = (v) => (v instanceof Date ? di._h.iso(v) : (v ? String(v).slice(0, 10) : ''));
const ok = (reply, extra) => Object.assign({ ok: true, reply }, extra || {});
const hu = (ctx) => ctx.lang === 'hu';
const money = (v, cur) => fmtN(num(v), 2) + ' ' + (cur || 'EUR');

module.exports = [
  // ─── Ügyfelek ───
  {
    name: 'client.list', domain: 'clients', kind: 'read', feature: 'clients',
    desc: L('Ügyfelek listája (keresés névre / CUI-ra: search).', 'Lista clienților (căutare: search).'),
    params: { search: { type: 'text', max: 80 } },
    async run(ctx, a) {
      const p = [ctx.cid]; let w = '';
      if (a.search) { p.push('%' + String(a.search).replace(/[%_]/g, '') + '%'); w = ` AND (denumire ILIKE $2 OR cui_cif ILIKE $2)`; }
      const rows = await q(`SELECT id, denumire, cui_cif, localitate, email, telefon, payment_term_days FROM clients WHERE company_id = $1${w} ORDER BY denumire LIMIT 200`, p);
      return { reply: hu(ctx) ? rows.length + ' ügyfél.' : rows.length + ' clienți.', html: '<div class="och-info">' + listCard(ctx, '🏢', hu(ctx) ? 'Ügyfelek' : 'Clienți', rows, [
        { k: 'denumire', l: L('Név', 'Denumire'), f: (v, r) => ({ __html: '<a href="#" onclick="OrderChat.runUi({op:\'client\',id:\'' + esc(r.id) + '\'});return false;">' + esc(v) + '</a>' }) },
        { k: 'cui_cif', l: L('CUI', 'CUI') }, { k: 'localitate', l: L('Helység', 'Localitate') }, { k: 'email', l: L('E-mail', 'E-mail') },
        { k: 'payment_term_days', l: L('Fiz. hat. (nap)', 'Termen (zile)') }], 60) + '</div>' };
    },
  },
  {
    name: 'client.open', domain: 'clients', kind: 'ui', feature: 'clients',
    desc: L('Ügyfél-profil megnyitása (fuvarok, számlák, portál).', 'Deschide profilul clientului.'),
    params: { client: { type: 'client', required: true } },
    async run(ctx, a) { return { reply: core.tx(ctx.lang).opened(a.client.name), ui: { op: 'client', id: String(a.client.id), name: a.client.name } }; },
  },
  {
    name: 'client.create_by_cui', domain: 'clients', kind: 'write', feature: 'clients',
    title: L('Új ügyfél ANAF-ból', 'Client nou din ANAF'),
    desc: L('Új (román) ügyfél felvétele CUI alapján — az adatokat az ANAF-ból tölti ki.', 'Adaugă client nou după CUI (date din ANAF).'),
    examples: L(['vedd fel ügyfélnek a 47859317 CUI-t'], ['adaugă clientul cu CUI 47859317']),
    params: { cui: { type: 'text', required: true, max: 20 } },
    async preview(ctx, a) {
      const svc = require('../../services/clients');
      const cui = svc.normalizeCui(a.cui);
      if (!cui) return { err: hu(ctx) ? 'Érvénytelen CUI.' : 'CUI invalid.' };
      const ex = await q(`SELECT id, denumire FROM clients WHERE company_id = $1 AND regexp_replace(UPPER(COALESCE(cui_cif,'')), '[^0-9]', '', 'g') = $2 LIMIT 1`, [ctx.cid, cui]);
      if (ex[0]) return { reply: (hu(ctx) ? 'Ez az ügyfél már megvan: ' : 'Clientul există deja: ') + ex[0].denumire };
      let an;
      try { an = await svc.anafLookup(cui); } catch (e) { return { err: 'ANAF: ' + String(e.message || e).slice(0, 160) }; }
      if (!an || !an.found || !an.name) return { err: hu(ctx) ? 'Az ANAF nem talál ilyen CUI-t.' : 'ANAF nu găsește acest CUI.' };
      a.cui = cui;
      return { rows: [['CUI', an.cui], [hu(ctx) ? 'Név' : 'Denumire', an.name], ['Reg. Com.', an.regCom || '—'], [hu(ctx) ? 'Cím' : 'Adresă', an.address || '—'], ['TVA', an.vatPayer ? '✓' : '—'], [hu(ctx) ? 'Aktív' : 'Activ', an.active ? '✓' : '⛔']] };
    },
    async run(ctx, a) {
      const svc = require('../../services/clients');
      const ex = await q(`SELECT id FROM clients WHERE company_id = $1 AND regexp_replace(UPPER(COALESCE(cui_cif,'')), '[^0-9]', '', 'g') = $2 LIMIT 1`, [ctx.cid, a.cui]);
      if (ex[0]) return { ok: false, err: hu(ctx) ? 'Az ügyfél közben már létrejött.' : 'Clientul a fost deja creat.' };
      let an; try { an = await svc.anafLookup(a.cui); } catch (e) { return { ok: false, err: 'ANAF: ' + String(e.message || e).slice(0, 160) }; }
      if (!an || !an.found) return { ok: false, err: 'ANAF' };
      const saved = await H('orderChat', '_saveAnafClient')(ctx.cid, an);
      if (!saved) return { ok: false, err: 'Eroare de server' };
      return ok((hu(ctx) ? '✅ Ügyfél mentve: ' : '✅ Client salvat: ') + saved.denumire, { entity_id: saved.id });
    },
  },
  {
    name: 'client.update', domain: 'clients', kind: 'write', feature: 'clients',
    title: L('Ügyfél módosítása', 'Modificare client'),
    desc: L('Ügyfél elérhetőségének / fizetési határidejének módosítása: email, phone, payment_term_days.', 'Modifică e-mail, telefon, termen de plată.'),
    params: { client: { type: 'client', required: true }, email: { type: 'email' }, phone: { type: 'text', max: 40 }, payment_term_days: { type: 'int', min: 0, maxv: 365 } },
    async check(ctx, a) {
      if (a.email == null && a.phone == null && a.payment_term_days == null) return { ask: { text: hu(ctx) ? 'Mit módosítsak az ügyfélen?' : 'Ce modific la client?', options: [] } };
      return null;
    },
    async snapshot(ctx, a) {
      const r = await q(`SELECT id, email, telefon, payment_term_days FROM clients WHERE id = $1 AND company_id = $2`, [a.client.id, ctx.cid]);
      return r[0] || null;
    },
    async preview(ctx, a) {
      const c = (await q(`SELECT email, telefon, payment_term_days FROM clients WHERE id = $1 AND company_id = $2`, [a.client.id, ctx.cid]))[0];
      if (!c) return { err: 'Nu a fost gasit.' };
      const rows = [['🏢', a.client.name]];
      if (a.email != null) rows.push(['E-mail', change(c.email, a.email)]);
      if (a.phone != null) rows.push(['Telefon', change(c.telefon, a.phone)]);
      if (a.payment_term_days != null) rows.push([hu(ctx) ? 'Fizetési határidő (nap)' : 'Termen plată (zile)', change(c.payment_term_days, a.payment_term_days)]);
      return { rows };
    },
    async run(ctx, a) {
      const sets = []; const p = [a.client.id, ctx.cid];
      if (a.email != null) { p.push(a.email); sets.push('email = $' + p.length); }
      if (a.phone != null) { p.push(a.phone); sets.push('telefon = $' + p.length); }
      if (a.payment_term_days != null) { p.push(a.payment_term_days); sets.push('payment_term_days = $' + p.length); }
      try {
        await require('../../db').query(`UPDATE clients SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 AND company_id = $2`, p);
      } catch (e) { return { ok: false, err: 'Eroare de server' }; }
      return ok(null, { entity_id: a.client.id });
    },
    async undo(ctx, b) {
      if (!b) return { ok: false };
      try {
        await require('../../db').query(`UPDATE clients SET email = $3, telefon = $4, payment_term_days = $5, updated_at = NOW() WHERE id = $1 AND company_id = $2`, [b.id, ctx.cid, b.email, b.telefon, b.payment_term_days]);
        return { ok: true };
      } catch (e) { return { ok: false }; }
    },
  },
  // ─── Alvállalkozók ───
  {
    name: 'carrier.list', domain: 'carriers', kind: 'read', feature: 'external-drivers',
    desc: L('Alvállalkozók listája nyitott tartozással.', 'Lista subcontractorilor cu sold deschis.'),
    async run(ctx) {
      const r = await core.callH(H('carriers', 'carrierList'), ctx.req, [{}]);
      if (!r || r.ok === false) return r;
      return { html: '<div class="och-info">' + listCard(ctx, '🚚', hu(ctx) ? 'Alvállalkozók' : 'Subcontractori', r.items || [], [
        { k: 'nev', l: L('Név', 'Nume') }, { k: 'cui', l: L('CUI', 'CUI') }, { k: 'telefon', l: L('Telefon', 'Telefon') },
        { k: 'open_balance', l: L('Tartozásunk', 'Sold'), f: (v) => fmtN(num(v), 2) }, { k: 'cmr_insurance_expiry', l: L('CMR-bizt.', 'Asig. CMR'), f: (v) => fmtD(d10(v)) }]) + '</div>' };
    },
  },
  {
    name: 'carrier.create', domain: 'carriers', kind: 'write', feature: 'external-drivers',
    title: L('Új alvállalkozó', 'Subcontractor nou'),
    desc: L('Új alvállalkozó felvétele: name, cui, email, phone, iban, payment_term_days.', 'Adaugă subcontractor nou.'),
    params: { name: { type: 'text', required: true, max: 200 }, cui: { type: 'text', max: 40 }, email: { type: 'email' }, phone: { type: 'text', max: 40 }, iban: { type: 'text', max: 40 }, payment_term_days: { type: 'int', min: 0, maxv: 365 } },
    async preview(ctx, a) {
      return { rows: [[hu(ctx) ? 'Név' : 'Nume', a.name], ['CUI', a.cui || '—'], ['E-mail', a.email || '—'], ['Telefon', a.phone || '—'], ['IBAN', a.iban || '—'], [hu(ctx) ? 'Fiz. határidő' : 'Termen', (a.payment_term_days != null ? a.payment_term_days : 30) + (hu(ctx) ? ' nap' : ' zile')]] };
    },
    async run(ctx, a) {
      const r = await core.callH(H('carriers', 'carrierSave'), ctx.req, [{ nev: a.name, cui: a.cui, email: a.email, telefon: a.phone, iban: a.iban, payment_term_days: a.payment_term_days }]);
      return r && r.ok ? ok(null, { entity_id: r.id || null }) : r;
    },
  },
  {
    name: 'carrier.invoice_add', domain: 'carriers', kind: 'write', feature: 'invoices-in', perm: 'stats_finance',
    title: L('Bejövő számla rögzítése', 'Înregistrare factură primită'),
    desc: L('Alvállalkozói (bejövő) számla rögzítése: carrier, invoice_number, amount, currency, issue_date, due_date, orders (fuvarszámok vesszővel).', 'Înregistrează factura subcontractorului.'),
    params: { carrier: { type: 'carrier', required: true }, invoice_number: { type: 'text', max: 80 }, amount: { type: 'money', min: 0.01, maxv: 1e7, required: true }, currency: { type: 'enum', values: ['EUR', 'RON', 'HUF', 'PLN', 'USD'], default: 'EUR' },
      issue_date: { type: 'date' }, due_date: { type: 'date' }, orders: { type: 'orders' } },
    async preview(ctx, a) {
      return { rows: [[hu(ctx) ? 'Alvállalkozó' : 'Subcontractor', a.carrier.name], [hu(ctx) ? 'Számlaszám' : 'Nr. factură', a.invoice_number || '—'], [hu(ctx) ? 'Összeg' : 'Sumă', money(a.amount, a.currency)],
        [hu(ctx) ? 'Kiállítva' : 'Emisă', a.issue_date ? fmtD(a.issue_date) : '—'], [hu(ctx) ? 'Esedékes' : 'Scadentă', a.due_date ? fmtD(a.due_date) : '—'], [hu(ctx) ? 'Fuvarok' : 'Curse', (a.orders || []).map((o) => o.no).join(', ') || '—']] };
    },
    async run(ctx, a) {
      const r = await core.callH(H('carriers', 'carrierInvoiceSave'), ctx.req, [{ carrier_id: a.carrier.id, invoice_number: a.invoice_number, amount: a.amount, currency: a.currency, issue_date: a.issue_date, due_date: a.due_date, order_ids: (a.orders || []).map((o) => o.id) }]);
      return r && r.ok ? ok(null, { entity_id: r.id }) : r;
    },
  },
  {
    name: 'carrier.invoice_pay', domain: 'carriers', kind: 'write', feature: 'invoices-in', perm: 'stats_finance',
    title: L('Bejövő számla kifizetése', 'Plată factură primită'),
    desc: L('Alvállalkozói számla fizetettnek jelölése (amount nélkül = teljes): carrier + invoice_number.', 'Marchează plătită factura subcontractorului.'),
    params: { carrier: { type: 'carrier', required: true }, invoice_number: { type: 'text', max: 80 }, amount: { type: 'money', min: 0.01, maxv: 1e7 } },
    async preview(ctx, a) {
      const p = [ctx.cid, a.carrier.id]; let w = '';
      if (a.invoice_number) { p.push(a.invoice_number); w = ' AND invoice_number ILIKE $3'; }
      const r = await q(`SELECT id, invoice_number, amount, paid_amount, currency, due_date FROM carrier_invoices WHERE company_id = $1 AND carrier_id = $2 AND status <> 'paid'${w} ORDER BY due_date NULLS LAST, id LIMIT 5`, p);
      if (!r.length) return { err: hu(ctx) ? 'Nincs nyitott számla ennél az alvállalkozónál.' : 'Nu există facturi deschise.' };
      if (r.length > 1 && !a.invoice_number) return { err: (hu(ctx) ? 'Több nyitott számla van — melyik? ' : 'Mai multe facturi deschise — care? ') + r.map((x) => x.invoice_number || ('#' + x.id)).join(', ') };
      const x = r[0]; a.invoice_id = x.id;
      return { rows: [[hu(ctx) ? 'Alvállalkozó' : 'Subcontractor', a.carrier.name], [hu(ctx) ? 'Számla' : 'Factură', x.invoice_number || ('#' + x.id)],
        [hu(ctx) ? 'Fizetve' : 'Plătit', change(money(x.paid_amount, x.currency), a.amount != null ? money(num(x.paid_amount) + a.amount, x.currency) : money(x.amount, x.currency))]] };
    },
    async run(ctx, a) {
      const r = await core.callH(H('carriers', 'carrierInvoicePayment'), ctx.req, [a.invoice_id, a.amount != null ? a.amount : 'full']);
      return r && r.ok ? ok(null, { entity_id: a.invoice_id }) : r;
    },
  },
  // ─── Dokumentumok ───
  {
    name: 'docs.missing_waybills', domain: 'docs', kind: 'read', feature: 'received-fuv',
    desc: L('Lezárt fuvarok, amelyekhez még nincs menetlevél.', 'Curse finalizate fără foaie de parcurs.'),
    async run(ctx) {
      const r = await core.callH(H('documents', 'getOrdersMissingWaybill'), ctx.req, [{}]);
      if (!r || r.ok === false) return r;
      return { html: '<div class="och-info">' + listCard(ctx, '📄', hu(ctx) ? 'Hiányzó menetlevelek' : 'Foi de parcurs lipsă', r.orders || [], [
        { k: 'fuvar_no', l: L('Fuvar', 'Cursă'), f: (v, x) => v || x.id }, { k: 'client', l: L('Ügyfél', 'Client') },
        { k: 'loc_incarcare', l: L('Útvonal', 'Rută'), f: (v, x) => [di.cityOf(x.loc_incarcare), di.cityOf(x.loc_descarcare)].filter(Boolean).join(' → ') }, { k: 'nume_sofer', l: L('Sofőr', 'Șofer') }]) + '</div>' };
    },
  },
  {
    name: 'docs.search', domain: 'docs', kind: 'read', feature: 'order-docs',
    desc: L('Fuvar-dokumentumok keresése: order (fuvarszám), doc_type (invoice|cmr|pod|order|contract|customs|receipt|other), period, search (szöveg).', 'Caută documente de cursă.'),
    examples: L(['mutasd a 0042 dokumentumait', 'szeptemberi CMR-ek'], ['documentele cursei 0042']),
    params: { order: { type: 'order' }, doc_type: { type: 'enum', values: ['invoice', 'cmr', 'pod', 'order', 'contract', 'customs', 'receipt', 'other'] }, period: { type: 'period' }, search: { type: 'text', max: 80 } },
    async run(ctx, a) {
      const r = await core.callH(H('orderDocs', 'orderDocSearch'), ctx.req, [{ q: a.search || '', doc_type: a.doc_type || '', from: a.period && a.period.from, to: a.period && a.period.to, order_id: a.order && a.order.id, limit: 100 }]);
      if (!r || r.ok === false) return r;
      return { html: '<div class="och-info">' + listCard(ctx, '📎', hu(ctx) ? 'Dokumentumok' : 'Documente', r.rows || [], [
        { k: 'doc_date', l: L('Dátum', 'Data') }, { k: 'fuvar_no', l: L('Fuvar', 'Cursă'), f: (v, x) => v || x.order_id }, { k: 'doc_type', l: L('Típus', 'Tip') },
        { k: 'file_name', l: L('Fájl', 'Fișier') }, { k: 'ref_no', l: L('Szám', 'Nr.') }]) + '</div>' };
    },
  },
  {
    name: 'docs.register_reserve', domain: 'docs', kind: 'write', feature: 'doc-register',
    title: L('Sorszám foglalása', 'Rezervare număr'),
    desc: L('Következő sorszám kiadása a dokumentum-nyilvántartás egy mappájából (folder = mappa neve/előtagja), title, partner, date.', 'Rezervă următorul număr din registrul de documente.'),
    examples: L(['adj egy számot a FCT mappából a Bilka szerződéshez'], ['dă-mi un număr din dosarul FCT']),
    params: { folder: { type: 'text', required: true, max: 60 }, title: { type: 'text', max: 200 }, partner: { type: 'text', max: 200 }, date: { type: 'date' } },
    async preview(ctx, a) {
      const r = await core.callH(H('documentRegister', 'docRegGroupList'), ctx.req, [{}]);
      const gs = (r && r.groups) || [];
      const f = fold(a.folder);
      const g = gs.find((x) => fold(x.prefix || '') === f) || gs.find((x) => fold(x.name) === f) || gs.find((x) => fold(x.name).includes(f) || f.includes(fold(x.prefix || '§§')));
      if (!g) return { err: (hu(ctx) ? 'Nincs ilyen mappa. Mappák: ' : 'Dosar inexistent. Dosare: ') + gs.map((x) => x.name + (x.prefix ? ' (' + x.prefix + ')' : '')).join(', ') };
      a.group_id = g.id; a.date = a.date || di._h.iso(ctx.now);
      return { rows: [[hu(ctx) ? 'Mappa' : 'Dosar', g.name + (g.prefix ? ' (' + g.prefix + ')' : '')], [hu(ctx) ? 'Dátum' : 'Data', fmtD(a.date)], [hu(ctx) ? 'Cím' : 'Titlu', a.title || '—'], ['Partner', a.partner || '—']] };
    },
    async run(ctx, a) {
      const r = await core.callH(H('documentRegister', 'docRegEntryCreate'), ctx.req, [{ group_id: a.group_id, entry_date: a.date, title: a.title, partner: a.partner }]);
      return r && r.ok ? ok((hu(ctx) ? '✅ Kiadott szám: ' : '✅ Număr alocat: ') + r.reg_no, { entity_id: r.id }) : r;
    },
  },
  // ─── Raktár ───
  {
    name: 'warehouse.list', domain: 'orders', kind: 'read', feature: 'warehouse',
    desc: L('Raktárban lévő (leadott) áruk listája.', 'Mărfuri aflate în depozit.'),
    async run(ctx) {
      const r = await core.callH(H('handover', 'getWarehouseItems'), ctx.req, [{}]);
      const rows = (Array.isArray(r) ? r : []).filter((x) => x.status === 'Raktarban');
      return { html: '<div class="och-info">' + listCard(ctx, '📦', hu(ctx) ? 'Raktárban' : 'În depozit', rows, [
        { k: 'order_id', l: L('Fuvar', 'Cursă') }, { k: 'location', l: L('Raktár', 'Depozit') }, { k: 'qty', l: L('Mennyiség', 'Cantitate'), f: (v, x) => [v, x.qty_unit].filter(Boolean).join(' ') },
        { k: 'weight_kg', l: L('Súly', 'Greutate'), f: (v) => (v != null ? fmtN(num(v), 0) + ' kg' : '') }, { k: 'doc_count', l: L('Dok.', 'Doc.'), f: (v) => (v ? '✓' : '⚠️') }]) + '</div>' };
    },
  },
  // ─── Levelek (CSAK fejléc) ───
  {
    name: 'mail.inbox', domain: 'mail', kind: 'read', feature: 'mail-inbox',
    desc: L('Beérkezett levelek fejlécei (feladó, tárgy, dátum) — search a feladóra/tárgyra. A levél tartalmát a chat nem olvassa.', 'Antetele e-mailurilor primite (expeditor, subiect, dată).'),
    examples: L(['jött levél a Bilkától?'], ['am primit e-mail de la Bilka?']),
    params: { search: { type: 'text', max: 80 } },
    async run(ctx, a) {
      const r = await core.callH(H('mailbox', 'mailInboxList'), ctx.req, [{ kind: 'inbox', q: a.search || '' }]);
      if (!r || r.ok === false) return r;
      return { html: '<div class="och-info">' + listCard(ctx, '📥', hu(ctx) ? 'Beérkezett levelek' : 'E-mailuri primite', r.items || [], [
        { k: 'received_at', l: L('Dátum', 'Data'), f: (v) => (v ? String(v instanceof Date ? v.toISOString() : v).replace('T', ' ').slice(0, 16) : '') },
        { k: 'from_name', l: L('Feladó', 'Expeditor'), f: (v, x) => v || x.from_email }, { k: 'subject', l: L('Tárgy', 'Subiect') }], 20) + '</div>', ui: null };
    },
  },
  // ─── Értesítések, áttekintés ───
  {
    name: 'notifications.list', domain: 'admin', kind: 'read', feature: 'notifications',
    desc: L('Legutóbbi értesítések.', 'Ultimele notificări.'),
    async run(ctx) {
      const r = await core.callH(H('notifications', 'notifList'), ctx.req, []);
      if (!r || r.ok === false) return r;
      return { html: '<div class="och-info">' + listCard(ctx, '🔔', hu(ctx) ? 'Értesítések' : 'Notificări', r.items || [], [
        { k: 'created_at', l: L('Mikor', 'Când'), f: (v) => (v ? String(v instanceof Date ? v.toISOString() : v).replace('T', ' ').slice(0, 16) : '') }, { k: 'title', l: L('Cím', 'Titlu') }, { k: 'read_at', l: L('Olvasva', 'Citit'), f: (v) => (v ? '✓' : '•') }], 20) + '</div>' };
    },
  },
  {
    name: 'notifications.read_all', domain: 'admin', kind: 'write', feature: 'notifications',
    title: L('Értesítések olvasottnak jelölése', 'Marchează notificările citite'),
    desc: L('Minden értesítés olvasottnak jelölése.', 'Marchează toate notificările ca citite.'),
    async preview(ctx) { return { rows: [[hu(ctx) ? 'Mit' : 'Ce', hu(ctx) ? 'minden értesítés → olvasott' : 'toate notificările → citite']] }; },
    async run(ctx) { const r = await core.callH(H('notifications', 'notifMarkAllRead'), ctx.req, []); return r && r.ok ? ok(null) : r; },
  },
  {
    name: 'ops.summary', domain: 'admin', kind: 'read', feature: 'ops-center',
    desc: L('Operatív összefoglaló: aktív fuvarok, mai fel-/lerakások, késők, hiányzó UIT/fuvarozó, lejáró számlák/dokumentumok, kihasználtság.', 'Rezumat operațional.'),
    examples: L(['hogy állunk ma?'], ['cum stăm azi?']),
    async run(ctx) {
      const r = await core.callH(H('opsCenter', 'getOpsCenter'), ctx.req, [{}]);
      if (!r || r.ok === false) return r;
      const c = r.counters || {}; const h = r.health || {};
      const T = hu(ctx)
        ? [['Aktív fuvar', c.aktiv], ['Mai felrakás', c.mai_felrakas], ['Mai lerakás', c.mai_lerakas], ['Késésben', c.keso], ['Kiosztásra vár', h.waiting], ['Hiányzó UIT', c.hianyzo_uit], ['Hiányzó fuvarozó', c.hianyzo_fuvarozo], ['Lejáró dokumentum', c.lejaro_dok], ['Lejáró számla (ügyfél)', c.lejaro_szamla], ['Lejáró számla (alvállalkozó)', c.lejaro_ap_szamla], ['Számla nélkül', c.pd_no_invoice], ['Postázatlan', c.pd_no_post], ['Kihasználtság', h.utilization_pct != null ? h.utilization_pct + '%' : '—']]
        : [['Curse active', c.aktiv], ['Încărcări azi', c.mai_felrakas], ['Descărcări azi', c.mai_lerakas], ['Întârzieri', c.keso], ['Nealocate', h.waiting], ['UIT lipsă', c.hianyzo_uit], ['Transportator lipsă', c.hianyzo_fuvarozo], ['Documente care expiră', c.lejaro_dok], ['Facturi scadente (clienți)', c.lejaro_szamla], ['Facturi scadente (subcontr.)', c.lejaro_ap_szamla], ['Fără factură', c.pd_no_invoice], ['Netrimise poștal', c.pd_no_post], ['Grad de utilizare', h.utilization_pct != null ? h.utilization_pct + '%' : '—']];
      return { html: '<div class="och-info">' + kvCard('🎛️', hu(ctx) ? 'Operatív összefoglaló' : 'Rezumat operațional', T.map((x) => [x[0], x[1] == null ? '0' : String(x[1])])) + '</div>' };
    },
  },
  {
    name: 'favloc.add', domain: 'admin', kind: 'write', feature: 'fav-locations',
    title: L('Kedvenc helyszín mentése', 'Salvare locație favorită'),
    desc: L('Kedvenc (gyakori) felrakó/lerakó hely mentése: label, address, type (load|unload|both).', 'Salvează o locație favorită.'),
    params: { label: { type: 'text', required: true, max: 120 }, address: { type: 'text', required: true, max: 300 }, type: { type: 'enum', values: ['load', 'unload', 'both'], default: 'both' } },
    async preview(ctx, a) { return { rows: [[hu(ctx) ? 'Név' : 'Nume', a.label], [hu(ctx) ? 'Cím' : 'Adresă', a.address], [hu(ctx) ? 'Típus' : 'Tip', a.type]] }; },
    async run(ctx, a) { const r = await core.callH(H('favLocations', 'favLocationSave'), ctx.req, [{ label: a.label, address: a.address, type: a.type }]); return r && r.ok ? ok(null, { entity_id: r.id || null }) : r; },
  },
];
