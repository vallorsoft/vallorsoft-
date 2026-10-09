// ============================================================
//  VallorSoft — lib/chatTools/orders.js
//  🚚 Fuvar-képességek chatből. Minden írás a MEGLÉVŐ handleren megy
//  (comUpdate / plannerAssign / comDelete / restoreOrder / markOrderPayment /
//  setOrderPostDelivery / resetOrderMilestones / orderTemplate* / quote* /
//  confirm|rejectHandover) — a handler maga is ellenőriz szerepet + céget.
// ============================================================
'use strict';

const core = require('./core');

const { esc, fmtN, fmtD, num } = core.fmt;
const { change, listCard, kvCard } = core.card;
const L = (hu, ro) => ({ hu, ro });
const q = core.q;

const ST = {
  hu: { Finalizat: 'Lezárva', 'In Curs': 'Úton', Disponibil: 'Kiosztásra vár', Alocat: 'Kiosztva', Extern: 'Alvállalkozó', Parkolt: 'Leadva (pótkocsin)', Raktarban: 'Raktárban', Anulat: 'Törölve' },
  ro: { Finalizat: 'Finalizat', 'In Curs': 'În curs', Disponibil: 'Disponibil', Alocat: 'Alocat', Extern: 'Subcontractor', Parkolt: 'Predat (pe remorcă)', Raktarban: 'În depozit', Anulat: 'Anulat' },
};
const st = (ctx, s) => (ST[ctx.lang] || ST.ro)[s] || s;
const city = (s) => require('../driverInfo').cityOf(s);

async function getOrder(cid, id) {
  const r = await q(`SELECT o.*, COALESCE(to_jsonb(o)->>'fuvar_no', o.id) AS fuvar_no_v FROM orders o WHERE o.id = $1 AND o.company_id = $2`, [id, cid]);
  return r[0] || null;
}
const label = (o) => '#' + (o.fuvar_no_v || o.fuvar_no || o.id) + ' · ' + [city(o.loc_incarcare), city(o.loc_descarcare)].filter(Boolean).join(' → ');
const d10 = (v) => (v instanceof Date ? require('../driverInfo')._h.iso(v) : (v ? String(v).slice(0, 10) : ''));
const ok = (reply, extra) => Object.assign({ ok: true, reply }, extra || {});
const H = core.H;

// Mező-katalógus a fuvar-módosításhoz: kulcs → {label, type}
const FIELDS = {
  client: { l: L('Megrendelő', 'Client'), type: 'text' },
  ref: { l: L('Referencia', 'Referință'), type: 'text' },
  loc_incarcare: { l: L('Felrakó helyszín', 'Loc încărcare'), type: 'text' },
  loc_descarcare: { l: L('Lerakó helyszín', 'Loc descărcare'), type: 'text' },
  firma_incarcare: { l: L('Felrakó cég', 'Firmă încărcare'), type: 'text' },
  firma_descarcare: { l: L('Lerakó cég', 'Firmă descărcare'), type: 'text' },
  data_incarcare: { l: L('Felrakás dátuma', 'Data încărcării'), type: 'date' },
  data_descarcare: { l: L('Lerakás dátuma', 'Data descărcării'), type: 'date' },
  pret: { l: L('Fuvardíj (EUR)', 'Preț (EUR)'), type: 'money' },
  km: { l: L('Km', 'Km'), type: 'number' },
  suly_kg: { l: L('Súly (kg)', 'Greutate (kg)'), type: 'number' },
  load_type: { l: L('Rakomány', 'Tip marfă'), type: 'enum', values: ['FTL', 'LTL'] },
  rendszam_remorca: { l: L('Pótkocsi', 'Remorcă'), type: 'trailer' },
  nc_code: { l: L('NC-kód', 'Cod NC'), type: 'text' },
  marfa_value: { l: L('Áru értéke', 'Valoare marfă'), type: 'money' },
  needs_uit: { l: L('UIT szükséges', 'Necesită UIT'), type: 'bool' },
  toll_cost: { l: L('Útdíj (EUR)', 'Taxă drum (EUR)'), type: 'money' },
  carrier_cost: { l: L('Alvállalkozói díj', 'Cost subcontractor'), type: 'money' },
};
const fl = (ctx, k) => (FIELDS[k] ? FIELDS[k].l[ctx.lang] : k);

// ─── Visszavonás: a módosítandó mezők előző értéke (comUpdate-tel visszaállítható) ───
const ASSIGN_KEYS = ['status', 'sofer_type', 'email_sofer', 'nume_sofer', 'rendszam_camion', 'rendszam_remorca', 'firma_extern', 'telefon_extern', 'external_driver_id', 'carrier_id', 'carrier_cost'];
async function snapOrder(ctx, id, keys) {
  const o = await getOrder(ctx.cid, id);
  if (!o) return null;
  const b = { id };
  for (const k of keys) b[k] = o[k] instanceof Date ? d10(o[k]) : (o[k] === undefined ? null : o[k]);
  return b;
}
async function undoOrder(ctx, before) {
  if (!before || !before.id) return { ok: false, err: 'Nu poate fi anulat.' };
  const upd = Object.assign({}, before); delete upd.id;
  return core.callH(H('orders', 'comUpdate'), ctx.req, [before.id, upd]);
}
const PD_KEYS = ['invoice_no', 'postal_sent_at', 'postal_received_at', 'payment_status_ext', 'payment_received_at', 'post_notes'];


module.exports = [
  // ─── OLVASÁS ───
  {
    name: 'order.list', domain: 'orders', kind: 'read', feature: 'orders-list',
    desc: L('Fuvarok listázása szűrőkkel: status (active|waiting|done|cancelled|unpaid|all), client, driver, vehicle, period (felrakás/lezárás időszaka).', 'Listează curse cu filtre: status, client, șofer, vehicul, perioadă.'),
    examples: L(['mutasd a kiosztásra váró fuvarokat', 'Bilka szeptemberi fuvarjai', 'Gondos fuvarjai'], ['arată cursele nealocate', 'cursele Bilka din septembrie']),
    params: {
      status: { type: 'enum', values: ['active', 'waiting', 'done', 'cancelled', 'unpaid', 'all'], default: 'active' },
      client: { type: 'client' }, driver: { type: 'driver' }, vehicle: { type: 'vehicle' }, period: { type: 'period' },
    },
    async run(ctx, a) {
      const w = ['o.company_id = $1']; const p = [ctx.cid];
      const S = { active: `o.status IN ('Alocat','In Curs','Extern','Parkolt','Raktarban')`, waiting: `o.status = 'Disponibil'`, done: `o.status = 'Finalizat'`, cancelled: `o.status = 'Anulat'`,
        unpaid: `o.status = 'Finalizat' AND COALESCE(o.paid_amount,0) < COALESCE(o.pret,0)`, all: `o.status <> 'Anulat'` };
      w.push(S[a.status] || S.active);
      if (a.client) { if (a.client.id) { p.push(a.client.id); w.push(`(o.client_id = $${p.length} OR LOWER(o.client) = LOWER((SELECT denumire FROM clients WHERE id = $${p.length} AND company_id = $1)))`); } }
      if (a.driver) { p.push(a.driver.email); w.push(`LOWER(o.email_sofer) = $${p.length}`); }
      if (a.vehicle) { p.push(a.vehicle.plate); w.push(`(UPPER(o.rendszam_camion) = UPPER($${p.length}) OR UPPER(o.rendszam_remorca) = UPPER($${p.length}))`); }
      if (a.period) { p.push(a.period.from, a.period.to); w.push(`COALESCE(o.data_incarcare::date, o.created_at::date) BETWEEN $${p.length - 1}::date AND $${p.length}::date`); }
      const rows = await q(`SELECT o.id, COALESCE(to_jsonb(o)->>'fuvar_no', o.id) AS fuvar_no, o.client, o.loc_incarcare, o.loc_descarcare, o.data_incarcare,
                                   o.status, o.nume_sofer, o.rendszam_camion, o.pret, o.paid_amount
                              FROM orders o WHERE ${w.join(' AND ')} ORDER BY COALESCE(o.data_incarcare, o.created_at) DESC LIMIT 200`, p);
      const cols = [
        { k: 'fuvar_no', l: L('Fuvar', 'Cursă'), f: (v, r) => ({ __html: '<a href="#" onclick="OrderChat.openOrder(\'' + esc(r.id) + '\');return false;">' + esc(v) + '</a>' }) },
        { k: 'data_incarcare', l: L('Felrakás', 'Încărcare'), f: (v) => fmtD(d10(v)) },
        { k: 'loc_incarcare', l: L('Útvonal', 'Rută'), f: (v, r) => [city(r.loc_incarcare), city(r.loc_descarcare)].filter(Boolean).join(' → ') },
        { k: 'client', l: L('Ügyfél', 'Client') },
        { k: 'nume_sofer', l: L('Sofőr', 'Șofer'), f: (v, r) => [v, r.rendszam_camion].filter(Boolean).join(' · ') },
        { k: 'status', l: L('Státusz', 'Status'), f: (v) => st(ctx, v) },
        { k: 'pret', l: L('Ár', 'Preț'), f: (v) => (v != null ? fmtN(num(v), 0) + ' €' : '') },
      ];
      const title = (ctx.lang === 'hu' ? 'Fuvarok' : 'Curse') + ' (' + rows.length + ')';
      return { reply: ctx.lang === 'hu' ? rows.length + ' fuvart találtam.' : 'Am găsit ' + rows.length + ' curse.', html: '<div class="och-info">' + listCard(ctx, '🚚', title, rows, cols) + '</div>' };
    },
  },
  {
    name: 'order.find_carrier_suggestion', domain: 'orders', kind: 'read', feature: 'visszfuvar-radar',
    desc: L('Visszfuvar-radar: melyik kamion tudná elvinni a kiosztatlan fuvarokat (javaslatok).', 'Radar retur: ce camion poate prelua cursele nealocate.'),
    examples: L(['ki tudná elvinni a kiosztatlan fuvarokat?'], ['cine poate lua cursele nealocate?']),
    async run(ctx) {
      const r = await core.callH(H('orders', 'getPlannerMatches'), ctx.req, [{}]);
      if (!r || r.ok === false) return r;
      const ms = r.matches || [];
      const nos = ms.length ? await q(`SELECT id, COALESCE(to_jsonb(o)->>'fuvar_no', o.id) AS no, loc_descarcare FROM orders o WHERE company_id = $1 AND id = ANY($2::text[])`, [ctx.cid, ms.map((m) => m.order_id)]) : [];
      const byId = Object.fromEntries(nos.map((x) => [x.id, x]));
      const rows = ms.map((m) => {
        const s0 = (m.suggestions || [])[0] || {};
        const o = byId[m.order_id] || {};
        return { order: o.no || m.order_id, route: [city(m.loc_incarcare), city(o.loc_descarcare)].filter(Boolean).join(' → '),
          truck: s0.rendszam || '', km: s0.km != null ? Math.round(s0.km) : null, from: s0.honnan || '' };
      });
      return { reply: '', html: '<div class="och-info">' + listCard(ctx, '💡', ctx.lang === 'hu' ? 'Kiosztási javaslatok' : 'Sugestii de alocare', rows, [
        { k: 'order', l: L('Fuvar', 'Cursă') }, { k: 'route', l: L('Útvonal', 'Rută') }, { k: 'truck', l: L('Kamion', 'Camion') }, { k: 'km', l: L('Km odáig', 'Km până acolo'), f: (v) => (v != null ? fmtN(num(v), 0) : '') }, { k: 'from', l: L('Honnan', 'De unde') }]) + '</div>' };
    },
  },
  {
    name: 'order.tracking_link', domain: 'orders', kind: 'read', feature: 'tracking',
    desc: L('Az ügyfélnek küldhető publikus követő-link egy fuvarhoz.', 'Link public de urmărire pentru client.'),
    params: { order: { type: 'order', required: true, fromHistory: true } },
    async run(ctx, a) {
      const r = await core.callH(H('orders', 'getTrackingLink'), ctx.req, [a.order.id]);
      if (!r || !r.ok) return r;
      const url = require('../appUrl').appBaseUrl('') + '/t/' + r.token;
      return { reply: '#' + a.order.no + ': ' + url, html: '<div class="och-info">' + kvCard('🌍', ctx.lang === 'hu' ? 'Követő-link' : 'Link de urmărire', [['#', a.order.no], ['URL', { __html: '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a>' }]]) + '</div>' };
    },
  },
  {
    name: 'handover.pending', domain: 'orders', kind: 'read', feature: 'warehouse',
    desc: L('Sofőrök által kért, jóváhagyásra váró áru-leadások.', 'Cereri de predare marfă care așteaptă confirmare.'),
    async run(ctx) {
      const r = await core.callH(H('handover', 'getPendingHandovers'), ctx.req, [{}]);
      if (!r || r.ok === false) return r;
      const rows = Array.isArray(r) ? r : [];
      return { reply: '', html: '<div class="och-info">' + listCard(ctx, '⛔', ctx.lang === 'hu' ? 'Leadás-kérések' : 'Cereri de predare', rows, [
        { k: 'id', l: L('Fuvar', 'Cursă') }, { k: 'nume_sofer', l: L('Sofőr', 'Șofer') }, { k: 'handover_type', l: L('Típus', 'Tip') }, { k: 'handover_loc', l: L('Hely', 'Loc') }]) + '</div>' };
    },
  },
  // ─── NAVIGÁCIÓ fuvarra ───
  {
    name: 'order.open', domain: 'orders', kind: 'ui',
    desc: L('Egy fuvar megnyitása: view=details (adatlap) | edit (szerkesztő) | documents (dokumentum-nyomkövetés) | email | handover (áru-leadás) | assignment (megbízás alvállalkozónak).', 'Deschide o cursă: view=details|edit|documents|email|handover|assignment.'),
    examples: L(['nyisd meg a 0042 szerkesztőjét', 'mutasd a 0042 adatlapját'], ['deschide editorul cursei 0042']),
    params: { order: { type: 'order', required: true, fromHistory: true }, view: { type: 'enum', values: ['details', 'edit', 'documents', 'email', 'handover', 'assignment'], default: 'details' } },
    async run(ctx, a) {
      const map = { details: 'openOrder', edit: 'editOrder', documents: 'postDelivery', email: 'orderEmail', handover: 'handover', assignment: 'assignment' };
      return { reply: core.tx(ctx.lang).opened('#' + a.order.no), ui: { op: map[a.view] || 'openOrder', id: a.order.id } };
    },
  },
  // ─── ÍRÁS ───
  {
    name: 'order.update', domain: 'orders', kind: 'write', feature: 'orders-list',
    title: L('Fuvar módosítása', 'Modificare cursă'),
    desc: L('Egy meglévő fuvar mezőinek módosítása. Csak a módosítandó mezőket add meg: ' + Object.keys(FIELDS).join(', ') + '.', 'Modifică câmpurile unei curse existente. Doar câmpurile schimbate: ' + Object.keys(FIELDS).join(', ') + '.'),
    examples: L(['a 0042 ára legyen 1350 euró', 'a 0042 lerakója Győr, Bosch Kft', 'a 0042 súlya 18 tonna'], ['prețul cursei 0042 să fie 1350 euro']),
    params: Object.assign({ order: { type: 'order', required: true, fromHistory: true } },
      Object.fromEntries(Object.entries(FIELDS).map(([k, d]) => [k, d.type === 'text' ? { type: 'text', max: 255 } : { type: d.type, values: d.values, min: (d.type === 'money' || d.type === 'number') ? 0 : undefined, maxv: (d.type === 'money' || d.type === 'number') ? 1e7 : undefined }]))),
    async check(ctx, a) {
      if (!Object.keys(FIELDS).some((k) => a[k] != null)) return { ask: { text: ctx.lang === 'hu' ? 'Mit módosítsak a fuvaron?' : 'Ce modific la cursă?', options: [] } };
      return null;
    },
    async preview(ctx, a) {
      const o = await getOrder(ctx.cid, a.order.id);
      if (!o) return { err: 'Transportul nu a fost gasit.' };
      if (o.status === 'Anulat') return { err: ctx.lang === 'hu' ? 'Törölt fuvar nem módosítható.' : 'Cursa anulată nu poate fi modificată.' };
      const rows = [['#', label(o)]];
      for (const k of Object.keys(FIELDS)) {
        if (a[k] == null) continue;
        let nv = a[k]; let ov = o[k];
        if (k === 'rendszam_remorca') nv = a[k].plate;
        if (FIELDS[k].type === 'date') { ov = fmtD(d10(ov)); nv = fmtD(nv); }
        if (FIELDS[k].type === 'bool') { ov = ov ? '✓' : '—'; nv = nv ? '✓' : '—'; }
        rows.push([fl(ctx, k), change(ov, nv)]);
      }
      return { rows, label: label(o) };
    },
    async snapshot(ctx, a) {
      const keys = Object.keys(FIELDS).filter((k) => a[k] != null);
      if (a.load_type != null) keys.push('hossz_cm', 'szel_cm', 'mag_cm');
      return snapOrder(ctx, a.order.id, keys);
    },
    undo: undoOrder,
    async run(ctx, a) {
      const upd = {};
      for (const k of Object.keys(FIELDS)) if (a[k] != null) upd[k] = k === 'rendszam_remorca' ? a[k].plate : a[k];
      if (upd.load_type === 'LTL') {
        const o = await getOrder(ctx.cid, a.order.id);
        Object.assign(upd, { hossz_cm: o && o.hossz_cm, szel_cm: o && o.szel_cm, mag_cm: o && o.mag_cm });
      } else if (upd.load_type === 'FTL') {
        const o = await getOrder(ctx.cid, a.order.id);
        Object.assign(upd, { hossz_cm: o && o.hossz_cm, szel_cm: o && o.szel_cm, mag_cm: o && o.mag_cm });
      }
      const r = await core.callH(H('orders', 'comUpdate'), ctx.req, [a.order.id, upd]);
      if (!r || !r.ok) return r;
      return ok(null, { order_id: a.order.id, entity_id: a.order.id });
    },
  },
  {
    name: 'order.set_status', domain: 'orders', kind: 'write', feature: 'orders-list',
    title: L('Státusz-váltás', 'Schimbare status'),
    desc: L('Fuvar státuszának átállítása: Disponibil (kiosztásra vár) | Alocat | In Curs (úton) | Finalizat (lezárva).', 'Schimbă statusul cursei.'),
    params: { order: { type: 'order', required: true, fromHistory: true }, status: { type: 'enum', values: ['Disponibil', 'Alocat', 'In Curs', 'Finalizat'], required: true } },
    async preview(ctx, a) {
      const o = await getOrder(ctx.cid, a.order.id);
      if (!o) return { err: 'Transportul nu a fost gasit.' };
      if (o.status === a.status) return { reply: ctx.lang === 'hu' ? 'A fuvar már ebben a státuszban van.' : 'Cursa are deja acest status.' };
      return { rows: [['#', label(o)], [ctx.lang === 'hu' ? 'Státusz' : 'Status', change(st(ctx, o.status), st(ctx, a.status))]], label: label(o) };
    },
    async snapshot(ctx, a) { return snapOrder(ctx, a.order.id, ASSIGN_KEYS); },
    undo: undoOrder,
    async run(ctx, a) {
      const r = await core.callH(H('orders', 'comUpdate'), ctx.req, [a.order.id, { status: a.status }]);
      return r && r.ok ? ok(null, { order_id: a.order.id, entity_id: a.order.id }) : r;
    },
  },
  {
    name: 'order.assign', domain: 'orders', kind: 'write', feature: 'orders-list',
    title: L('Kiosztás', 'Alocare'),
    desc: L('Fuvar kiosztása belső sofőrre és/vagy vontatóra (+ opcionálisan pótkocsira). A hiányzó párt a rendszer kitölti.', 'Alocă cursa unui șofer intern și/sau camion (+ remorcă).'),
    examples: L(['rendeld a 0042-t Gondosnak', 'a 0042 menjen a B123ABC-rel'], ['alocă 0042 lui Gondos']),
    params: { order: { type: 'order', required: true, fromHistory: true }, driver: { type: 'driver' }, tractor: { type: 'tractor' }, trailer: { type: 'trailer' } },
    async check(ctx, a) {
      if (!a.driver && !a.tractor && !a.trailer) return { ask: { text: ctx.lang === 'hu' ? 'Kinek / melyik járműnek osszam ki?' : 'Cui / cărui vehicul aloc?', options: [] } };
      return null;
    },
    async preview(ctx, a) {
      const o = await getOrder(ctx.cid, a.order.id);
      if (!o) return { err: 'Transportul nu a fost gasit.' };
      const rows = [['#', label(o)]];
      if (a.driver) rows.push([ctx.lang === 'hu' ? 'Sofőr' : 'Șofer', change(o.nume_sofer, a.driver.name)]);
      if (a.tractor) rows.push([ctx.lang === 'hu' ? 'Vontató' : 'Camion', change(o.rendszam_camion, a.tractor.plate)]);
      if (a.trailer) rows.push([ctx.lang === 'hu' ? 'Pótkocsi' : 'Remorcă', change(o.rendszam_remorca, a.trailer.plate)]);
      return { rows, label: label(o) };
    },
    async snapshot(ctx, a) { return snapOrder(ctx, a.order.id, ASSIGN_KEYS); },
    undo: undoOrder,
    async run(ctx, a) {
      // Sofőr → comUpdate (a Disponibil → Alocat léptetéssel); vontató → plannerAssign
      // (sofőr- és pótkocsi-auto-párosítással); pótkocsi → comUpdate.
      const cur = await getOrder(ctx.cid, a.order.id);
      if (!cur) return { ok: false, err: 'Transportul nu a fost gasit.' };
      let tractor = a.tractor ? a.tractor.plate : null;
      if (a.driver) {
        const d = await q(`SELECT LOWER(email) AS email, nume FROM users WHERE company_id = $1 AND LOWER(email) = $2 AND pozicio = 'Sofer'`, [ctx.cid, String(a.driver.email || '').toLowerCase()]);
        if (!d.length) return { ok: false, err: core.tx(ctx.lang).badToken };
        const upd = { sofer_type: 'Intern', email_sofer: d[0].email, nume_sofer: d[0].nume };
        if (cur.status === 'Disponibil') upd.status = 'Disponibil';
        if (!tractor && !cur.rendszam_camion) {
          const v = await q(`SELECT rendszam FROM vehicles WHERE company_id = $1 AND LOWER(assigned_driver_email) = $2 AND tip = 'Vontato' ORDER BY id LIMIT 1`, [ctx.cid, d[0].email]);
          if (v[0]) tractor = v[0].rendszam;
        }
        const r1 = await core.callH(H('orders', 'comUpdate'), ctx.req, [a.order.id, upd]);
        if (!r1 || !r1.ok) return r1;
      }
      if (tractor) {
        const r2 = await core.callH(H('orders', 'plannerAssign'), ctx.req, [a.order.id, { rendszam_camion: tractor }]);
        if (!r2 || !r2.ok) return r2;
      }
      if (a.trailer) {
        const r3 = await core.callH(H('orders', 'comUpdate'), ctx.req, [a.order.id, { rendszam_remorca: a.trailer.plate }]);
        if (!r3 || !r3.ok) return r3;
      }
      return ok(null, { order_id: a.order.id, entity_id: a.order.id });
    },
  },
  {
    name: 'order.unassign', domain: 'orders', kind: 'write', feature: 'orders-list',
    title: L('Kiosztás visszavonása', 'Anulare alocare'),
    desc: L('A sofőr és a jármű levétele a fuvarról (újra kiosztásra vár).', 'Scoate șoferul și vehiculul de pe cursă.'),
    params: { order: { type: 'order', required: true, fromHistory: true } },
    async preview(ctx, a) {
      const o = await getOrder(ctx.cid, a.order.id);
      if (!o) return { err: 'Transportul nu a fost gasit.' };
      if (!['Alocat', 'Disponibil', 'Extern'].includes(o.status)) return { err: ctx.lang === 'hu' ? 'Csak még el nem indult fuvarról vehető le a sofőr.' : 'Doar de pe curse neîncepute.' };
      return { rows: [['#', label(o)], [ctx.lang === 'hu' ? 'Sofőr' : 'Șofer', change(o.nume_sofer, null)], [ctx.lang === 'hu' ? 'Vontató' : 'Camion', change(o.rendszam_camion, null)]], label: label(o) };
    },
    async snapshot(ctx, a) { return snapOrder(ctx, a.order.id, ASSIGN_KEYS); },
    undo: undoOrder,
    async run(ctx, a) {
      const r = await core.callH(H('orders', 'comUpdate'), ctx.req, [a.order.id, { status: 'Disponibil', sofer_type: null, email_sofer: null, nume_sofer: null, rendszam_camion: null, rendszam_remorca: null, firma_extern: null, telefon_extern: null, external_driver_id: null }]);
      return r && r.ok ? ok(null, { order_id: a.order.id, entity_id: a.order.id }) : r;
    },
  },
  {
    name: 'order.assign_carrier', domain: 'orders', kind: 'write', feature: 'orders-list',
    title: L('Alvállalkozóra adás', 'Atribuire subcontractor'),
    desc: L('Fuvar kiadása alvállalkozónak (Extern), opcionális alvállalkozói díjjal.', 'Dă cursa unui subcontractor, cu cost opțional.'),
    params: { order: { type: 'order', required: true, fromHistory: true }, carrier: { type: 'carrier', required: true }, cost: { type: 'money', min: 0 } },
    async preview(ctx, a) {
      const o = await getOrder(ctx.cid, a.order.id);
      if (!o) return { err: 'Transportul nu a fost gasit.' };
      const rows = [['#', label(o)], [ctx.lang === 'hu' ? 'Alvállalkozó' : 'Subcontractor', change(o.firma_extern, a.carrier.name)]];
      if (a.cost != null) rows.push([fl(ctx, 'carrier_cost'), change(o.carrier_cost != null ? fmtN(num(o.carrier_cost), 2) : null, fmtN(a.cost, 2))]);
      if (a.cost != null && num(o.pret)) rows.push([ctx.lang === 'hu' ? 'Árrés' : 'Marjă', fmtN(num(o.pret) - a.cost, 2) + ' €']);
      return { rows, label: label(o) };
    },
    async snapshot(ctx, a) { return snapOrder(ctx, a.order.id, ASSIGN_KEYS); },
    undo: undoOrder,
    async run(ctx, a) {
      const own = await q(`SELECT id, nev FROM carriers WHERE id = $1 AND company_id = $2`, [a.carrier.id, ctx.cid]);
      if (!own.length) return { ok: false, err: core.tx(ctx.lang).badToken };
      const upd = { sofer_type: 'Extern', status: 'Disponibil', email_sofer: null, nume_sofer: null, firma_extern: own[0].nev, carrier_id: own[0].id };
      if (a.cost != null) upd.carrier_cost = a.cost;
      const cur = await getOrder(ctx.cid, a.order.id);
      if (cur && cur.status !== 'Disponibil') delete upd.status;
      const r = await core.callH(H('orders', 'comUpdate'), ctx.req, [a.order.id, upd]);
      return r && r.ok ? ok(null, { order_id: a.order.id, entity_id: a.order.id }) : r;
    },
  },
  {
    name: 'order.payment', domain: 'orders', kind: 'write', feature: 'orders-list', perm: 'stats_finance',
    title: L('Fizetés rögzítése', 'Înregistrare plată'),
    desc: L('Ügyfél-fizetés rögzítése lezárt fuvarra (összeg nélkül = a teljes hátralék). reset=true → fizetés törlése.', 'Înregistrează plata clientului pe o cursă finalizată.'),
    params: { order: { type: 'order', required: true, fromHistory: true }, amount: { type: 'money', min: 0.01 }, reset: { type: 'bool' } },
    async preview(ctx, a) {
      const o = await getOrder(ctx.cid, a.order.id);
      if (!o) return { err: 'Transportul nu a fost gasit.' };
      if (o.status !== 'Finalizat') return { err: ctx.lang === 'hu' ? 'Fizetést csak lezárt fuvarra lehet rögzíteni.' : 'Plata se înregistrează doar pe curse finalizate.' };
      if (a.reset) return { rows: [['#', label(o)], [ctx.lang === 'hu' ? 'Fizetve' : 'Plătit', change(fmtN(num(o.paid_amount), 2) + ' €', '0')]], label: label(o) };
      const rem = Math.round((num(o.pret) - num(o.paid_amount)) * 100) / 100;
      const amt = a.amount != null ? a.amount : rem;
      if (!(amt > 0)) return { reply: ctx.lang === 'hu' ? 'Ez a fuvar már ki van fizetve.' : 'Cursa este deja plătită.' };
      a.amount = amt;
      return { rows: [['#', label(o)], [ctx.lang === 'hu' ? 'Összeg' : 'Sumă', fmtN(amt, 2) + ' €'], [ctx.lang === 'hu' ? 'Fuvardíj' : 'Preț', fmtN(num(o.pret), 2) + ' €']], label: label(o) };
    },
    async snapshot(ctx, a) { return snapOrder(ctx, a.order.id, ['paid_amount']); },
    async undo(ctx, b) {
      if (!b) return { ok: false };
      const r = await core.callH(H('statisticsHandlers', 'markOrderPayment'), ctx.req, [b.id, { reset: true }]);
      if (r && r.ok && num(b.paid_amount) > 0) return core.callH(H('statisticsHandlers', 'markOrderPayment'), ctx.req, [b.id, { amount: num(b.paid_amount), method: 'chat-undo' }]);
      return r;
    },
    async run(ctx, a) {
      const r = await core.callH(H('statisticsHandlers', 'markOrderPayment'), ctx.req, [a.order.id, a.reset ? { reset: true } : { amount: a.amount, method: 'chat' }]);
      if (!r || !r.ok) return r;
      if (!a.reset && r.payment_status === 'paid') {
        try { await core.callH(H('orderPostDelivery', 'setOrderPostDelivery'), ctx.req, [{ order_id: a.order.id, payment_status_ext: 'paid', payment_received_at: require('../driverInfo')._h.iso(new Date()) }]); } catch (_) {}
      }
      return ok(null, { order_id: a.order.id, entity_id: a.order.id });
    },
  },
  {
    name: 'order.post_delivery', domain: 'orders', kind: 'write', feature: 'orders-list',
    title: L('Dokumentum-nyomkövetés', 'Urmărire documente'),
    desc: L('Lezárás utáni teendők egy fuvarra: invoice_no (számlaszám), postal_sent (postázás dátuma), postal_received (megérkezés dátuma), payment_status (pending|paid|delayed), note.', 'Pași după livrare: număr factură, trimis poștă, primit, status plată, notă.'),
    examples: L(['a 0042-t ma postáztuk', 'a 0042 számlaszáma FCT-123'], ['factura 0042 este FCT-123']),
    params: { order: { type: 'order', required: true, fromHistory: true }, invoice_no: { type: 'text', max: 50 }, postal_sent: { type: 'date' }, postal_received: { type: 'date' }, payment_status: { type: 'enum', values: ['pending', 'paid', 'delayed'] }, note: { type: 'text', max: 500 } },
    async check(ctx, a) {
      if (!['invoice_no', 'postal_sent', 'postal_received', 'payment_status', 'note'].some((k) => a[k] != null)) return { ask: { text: ctx.lang === 'hu' ? 'Mit rögzítsek (számlaszám, postázás, megérkezés, fizetés)?' : 'Ce înregistrez?', options: [] } };
      return null;
    },
    async preview(ctx, a) {
      const o = await getOrder(ctx.cid, a.order.id);
      if (!o) return { err: 'Transportul nu a fost gasit.' };
      const g = (k) => (o[k] instanceof Date ? d10(o[k]) : o[k]);
      const rows = [['#', label(o)]];
      if (a.invoice_no != null) rows.push([ctx.lang === 'hu' ? 'Számlaszám' : 'Nr. factură', change(g('invoice_no'), a.invoice_no)]);
      if (a.postal_sent != null) rows.push([ctx.lang === 'hu' ? 'Postázva' : 'Trimis poștă', change(fmtD(d10(o.postal_sent_at)), fmtD(a.postal_sent))]);
      if (a.postal_received != null) rows.push([ctx.lang === 'hu' ? 'Megérkezett' : 'Primit', change(fmtD(d10(o.postal_received_at)), fmtD(a.postal_received))]);
      if (a.payment_status != null) rows.push([ctx.lang === 'hu' ? 'Fizetés' : 'Plată', change(g('payment_status_ext'), a.payment_status)]);
      if (a.note != null) rows.push([ctx.lang === 'hu' ? 'Megjegyzés' : 'Notă', a.note]);
      return { rows, label: label(o) };
    },
    async snapshot(ctx, a) { return snapOrder(ctx, a.order.id, PD_KEYS); },
    async undo(ctx, b) {
      if (!b) return { ok: false };
      const p = { order_id: b.id };
      PD_KEYS.forEach((k) => { p[k] = b[k]; });
      return core.callH(H('orderPostDelivery', 'setOrderPostDelivery'), ctx.req, [p]);
    },
    async run(ctx, a) {
      const p = { order_id: a.order.id };
      if (a.invoice_no != null) p.invoice_no = a.invoice_no;
      if (a.postal_sent != null) p.postal_sent_at = a.postal_sent;
      if (a.postal_received != null) p.postal_received_at = a.postal_received;
      if (a.payment_status != null) { p.payment_status_ext = a.payment_status; if (a.payment_status === 'paid') p.payment_received_at = require('../driverInfo')._h.iso(new Date()); }
      if (a.note != null) p.post_notes = a.note;
      const r = await core.callH(H('orderPostDelivery', 'setOrderPostDelivery'), ctx.req, [p]);
      return r && r.ok ? ok(null, { order_id: a.order.id, entity_id: a.order.id }) : r;
    },
  },
  {
    name: 'order.delete', domain: 'orders', kind: 'danger', feature: 'orders-list', perm: 'orders_delete',
    title: L('Fuvar törlése', 'Anulare cursă'),
    desc: L('Fuvar törlése (Anulat → a Törölt fuvarok közé kerül, visszaállítható).', 'Anulează cursa (poate fi restaurată din Curse anulate).'),
    params: { order: { type: 'order', required: true, fromHistory: true } },
    async preview(ctx, a) {
      const o = await getOrder(ctx.cid, a.order.id);
      if (!o) return { err: 'Transportul nu a fost gasit.' };
      if (o.status === 'Anulat') return { reply: ctx.lang === 'hu' ? 'Ez a fuvar már törölve van.' : 'Cursa este deja anulată.' };
      return { rows: [['#', label(o)], [ctx.lang === 'hu' ? 'Ügyfél' : 'Client', o.client], [ctx.lang === 'hu' ? 'Státusz' : 'Status', change(st(ctx, o.status), st(ctx, 'Anulat'))]], label: label(o) };
    },
    async snapshot(ctx, a) { return { id: a.order.id }; },
    async undo(ctx, b) { return core.callH(H('orders', 'restoreOrder'), ctx.req, [b.id]); },
    async run(ctx, a) {
      const r = await core.callH(H('orders', 'comDelete'), ctx.req, [a.order.id]);
      return r && r.ok ? ok(null, { order_id: a.order.id, entity_id: a.order.id }) : r;
    },
  },
  {
    name: 'order.restore', domain: 'orders', kind: 'write', feature: 'orders-deleted', perm: 'orders_delete',
    title: L('Törölt fuvar visszaállítása', 'Restaurare cursă anulată'),
    desc: L('Törölt (Anulat) fuvar visszaállítása kiosztásra várónak.', 'Restaurează o cursă anulată.'),
    params: { order: { type: 'order', required: true, fromHistory: true } },
    async preview(ctx, a) {
      const o = await getOrder(ctx.cid, a.order.id);
      if (!o) return { err: 'Transportul nu a fost gasit.' };
      if (o.status !== 'Anulat') return { reply: ctx.lang === 'hu' ? 'Ez a fuvar nincs törölve.' : 'Cursa nu este anulată.' };
      return { rows: [['#', label(o)], [ctx.lang === 'hu' ? 'Státusz' : 'Status', change(st(ctx, 'Anulat'), st(ctx, 'Disponibil'))]], label: label(o) };
    },
    async snapshot(ctx, a) { return { id: a.order.id }; },
    async undo(ctx, b) { return core.callH(H('orders', 'comDelete'), ctx.req, [b.id]); },
    async run(ctx, a) {
      const r = await core.callH(H('orders', 'restoreOrder'), ctx.req, [a.order.id]);
      return r && r.ok ? ok(null, { order_id: a.order.id, entity_id: a.order.id }) : r;
    },
  },
  {
    name: 'order.reset_milestones', domain: 'orders', kind: 'write', feature: 'orders-list',
    title: L('Lezárás visszavonása', 'Anulare finalizare'),
    desc: L('A tévesen lezárt fuvar lerakás-állomásainak visszavonása (scope=unload) vagy minden állomás (scope=all).', 'Anulează etapele de descărcare (unload) sau toate (all).'),
    params: { order: { type: 'order', required: true, fromHistory: true }, scope: { type: 'enum', values: ['unload', 'all'], default: 'unload' } },
    async preview(ctx, a) {
      const o = await getOrder(ctx.cid, a.order.id);
      if (!o) return { err: 'Transportul nu a fost gasit.' };
      return { rows: [['#', label(o)], [ctx.lang === 'hu' ? 'Mit' : 'Ce', a.scope === 'all' ? (ctx.lang === 'hu' ? 'minden állomás' : 'toate etapele') : (ctx.lang === 'hu' ? 'lerakás-állomások' : 'etapele de descărcare')], [ctx.lang === 'hu' ? 'Státusz most' : 'Status acum', st(ctx, o.status)]], label: label(o) };
    },
    async run(ctx, a) {
      const r = await core.callH(H('orders', 'resetOrderMilestones'), ctx.req, [a.order.id, { scope: a.scope }]);
      return r && r.ok ? ok(null, { order_id: a.order.id, entity_id: a.order.id }) : r;
    },
  },
  {
    name: 'order.toll_estimate', domain: 'orders', kind: 'write', feature: 'toll-becsles',
    title: L('Útdíj-becslés', 'Estimare taxe drum'),
    desc: L('Útdíj kiszámolása és mentése a fuvarra (precise=true → pontos HERE-alapú, ha be van kötve).', 'Calculează și salvează taxa de drum pe cursă.'),
    params: { order: { type: 'order', required: true, fromHistory: true }, precise: { type: 'bool' } },
    async preview(ctx, a) {
      const o = await getOrder(ctx.cid, a.order.id);
      if (!o) return { err: 'Transportul nu a fost gasit.' };
      return { rows: [['#', label(o)], [fl(ctx, 'toll_cost'), change(o.toll_cost != null ? fmtN(num(o.toll_cost), 2) : null, ctx.lang === 'hu' ? 'új becslés' : 'estimare nouă')]], label: label(o) };
    },
    async run(ctx, a) {
      const r = await core.callH(H('toll', 'estimateToll'), ctx.req, [a.order.id, { precise: !!a.precise }]);
      if (!r || !r.ok) return r;
      const tot = r.toll && r.toll.total != null ? r.toll.total : null;
      return ok((ctx.lang === 'hu' ? '✅ Útdíj: ' : '✅ Taxă drum: ') + (tot != null ? fmtN(num(tot), 2) + ' €' : '—'), { order_id: a.order.id, entity_id: a.order.id });
    },
  },
  {
    name: 'handover.decide', domain: 'orders', kind: 'write', feature: 'warehouse',
    title: L('Leadás-kérés elbírálása', 'Decizie cerere predare'),
    desc: L('Sofőr áru-leadás kérésének jóváhagyása (approve) vagy elutasítása (reject).', 'Aprobă sau respinge cererea de predare a șoferului.'),
    params: { order: { type: 'order', required: true, fromHistory: true }, decision: { type: 'enum', values: ['approve', 'reject'], required: true } },
    async preview(ctx, a) {
      const o = await getOrder(ctx.cid, a.order.id);
      if (!o) return { err: 'Transportul nu a fost gasit.' };
      return { rows: [['#', label(o)], [ctx.lang === 'hu' ? 'Döntés' : 'Decizie', a.decision === 'approve' ? '✅' : '✕']], label: label(o) };
    },
    async run(ctx, a) {
      const r = await core.callH(H('handover', a.decision === 'approve' ? 'confirmHandover' : 'rejectHandover'), ctx.req, [a.order.id]);
      return r && r.ok ? ok(null, { order_id: a.order.id, entity_id: a.order.id }) : r;
    },
  },
  {
    name: 'order.template_save', domain: 'orders', kind: 'write', feature: 'orders-form',
    title: L('Mentés sablonként', 'Salvare ca șablon'),
    desc: L('Egy fuvar elmentése ismétlődő sablonként (névvel).', 'Salvează o cursă ca șablon.'),
    params: { order: { type: 'order', required: true, fromHistory: true }, name: { type: 'text', max: 80 } },
    async preview(ctx, a) {
      const o = await getOrder(ctx.cid, a.order.id);
      if (!o) return { err: 'Transportul nu a fost gasit.' };
      a.name = a.name || [o.client, city(o.loc_incarcare) + ' → ' + city(o.loc_descarcare)].filter(Boolean).join(' · ').slice(0, 80);
      return { rows: [['#', label(o)], [ctx.lang === 'hu' ? 'Sablon neve' : 'Nume șablon', a.name]], label: label(o) };
    },
    async run(ctx, a) {
      const r = await core.callH(H('orderTemplates', 'orderTemplateSaveFromOrder'), ctx.req, [{ order_id: a.order.id, name: a.name }]);
      return r && r.ok ? ok(null, { entity_id: r.id }) : r;
    },
  },
  {
    name: 'order.template_list', domain: 'orders', kind: 'read', feature: 'orders-form',
    desc: L('Mentett fuvar-sablonok listája (újra kiíráshoz).', 'Lista șabloanelor de curse.'),
    async run(ctx) {
      const r = await core.callH(H('orderTemplates', 'orderTemplateList'), ctx.req, []);
      if (!r || r.ok === false) return r;
      const rows = r.items || [];
      return { html: '<div class="och-info">' + listCard(ctx, '📋', ctx.lang === 'hu' ? 'Fuvar-sablonok' : 'Șabloane curse', rows, [{ k: 'name', l: L('Név', 'Nume') }, { k: 'route', l: L('Útvonal', 'Rută') }, { k: 'use_count', l: L('Használva', 'Folosit') }]) + '</div>',
        reply: ctx.lang === 'hu' ? 'Sablonból kiíráshoz nyisd meg a Fuvar kiírást („📋 Din șablon").' : 'Pentru a crea din șablon, deschide Creare cursă („📋 Din șablon").' };
    },
  },
  {
    name: 'quote.list', domain: 'orders', kind: 'read', feature: 'quotes',
    desc: L('Árajánlatok listája.', 'Lista cotațiilor.'),
    async run(ctx) {
      const r = await core.callH(H('quotes', 'quoteList'), ctx.req, [{}]);
      if (!r || r.ok === false) return r;
      const rows = r.items || [];
      return { html: '<div class="och-info">' + listCard(ctx, '💶', ctx.lang === 'hu' ? 'Árajánlatok' : 'Cotații', rows, [
        { k: 'id', l: L('#', '#') }, { k: 'client_name', l: L('Ügyfél', 'Client') }, { k: 'loc_from', l: L('Útvonal', 'Rută'), f: (v, x) => [city(x.loc_from), city(x.loc_to)].filter(Boolean).join(' → ') },
        { k: 'price', l: L('Ár', 'Preț'), f: (v, x) => (v != null ? fmtN(num(v), 0) + ' ' + (x.valuta || 'EUR') : '') }, { k: 'status', l: L('Státusz', 'Status') }]) + '</div>' };
    },
  },
  {
    name: 'quote.set_status', domain: 'orders', kind: 'write', feature: 'quotes',
    title: L('Árajánlat státusza', 'Status cotație'),
    desc: L('Árajánlat státuszának állítása (id = az ajánlat száma): draft | sent | awarded (elnyert) | lost (elvesztett).', 'Setează statusul cotației.'),
    params: { id: { type: 'int', required: true, min: 1 }, status: { type: 'enum', values: ['draft', 'sent', 'awarded', 'lost'], required: true } },
    async preview(ctx, a) {
      const r = await q(`SELECT id, client_name, status FROM quotes WHERE id = $1 AND company_id = $2`, [a.id, ctx.cid]);
      if (!r[0]) return { err: ctx.lang === 'hu' ? 'Nincs ilyen árajánlat.' : 'Cotația nu există.' };
      return { rows: [['#', r[0].id + ' · ' + (r[0].client_name || '')], ['Status', change(r[0].status, a.status)]] };
    },
    async snapshot(ctx, a) { const r = await q(`SELECT status FROM quotes WHERE id = $1 AND company_id = $2`, [a.id, ctx.cid]); return r[0] ? { id: a.id, status: r[0].status } : null; },
    async undo(ctx, b) { return core.callH(H('quotes', 'quoteSetStatus'), ctx.req, [{ id: b.id, status: b.status }]); },
    async run(ctx, a) {
      const r = await core.callH(H('quotes', 'quoteSetStatus'), ctx.req, [{ id: a.id, status: a.status }]);
      return r && r.ok ? ok(null, { entity_id: a.id }) : r;
    },
  },
  {
    name: 'quote.to_order', domain: 'orders', kind: 'write', feature: 'quotes',
    title: L('Árajánlatból fuvar', 'Cotație → cursă'),
    desc: L('Elfogadott árajánlat átalakítása fuvarrá (id = az ajánlat száma).', 'Transformă cotația în cursă.'),
    params: { id: { type: 'int', required: true, min: 1 } },
    async preview(ctx, a) {
      const r = await q(`SELECT id, client_name, loc_from, loc_to, price, order_id FROM quotes WHERE id = $1 AND company_id = $2`, [a.id, ctx.cid]);
      if (!r[0]) return { err: ctx.lang === 'hu' ? 'Nincs ilyen árajánlat.' : 'Cotația nu există.' };
      if (r[0].order_id) return { reply: ctx.lang === 'hu' ? 'Ebből az ajánlatból már lett fuvar.' : 'Cotația a fost deja convertită.' };
      return { rows: [['#', r[0].id], [ctx.lang === 'hu' ? 'Ügyfél' : 'Client', r[0].client_name], [ctx.lang === 'hu' ? 'Útvonal' : 'Rută', [city(r[0].loc_from), city(r[0].loc_to)].join(' → ')], [ctx.lang === 'hu' ? 'Ár' : 'Preț', fmtN(num(r[0].price), 2)]] };
    },
    async run(ctx, a) {
      const r = await core.callH(H('quotes', 'quoteToOrder'), ctx.req, [{ id: a.id }]);
      return r && r.ok ? ok(null, { order_id: r.order_id || null, entity_id: r.order_id || null }) : r;
    },
  },
];
module.exports._getOrder = getOrder;
module.exports._label = label;
