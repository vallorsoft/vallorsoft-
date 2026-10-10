// ============================================================
//  VallorSoft — lib/chatTools/people.js
//  💬 AI-chat 2.0 — 3. kör: ami eddig csak a felületről ment.
//   - ügyfél kézi felvétele (CUI nélkül is), ügyfél- és alvállalkozói
//     portál-meghívó
//   - beérkező megrendelés / ügyfél-kérés listája, jóváhagyása, elvetése
//   - menetlevél kézi létrehozása és módosítása
//   - árajánlat létrehozása
//   - munkatárs adatainak módosítása, letiltása / visszaengedése, törlése
//   - sofőr kifizetetlen járandóságainak egyben kifizetése (csoportos)
//  Írás MINDIG a meglévő handleren (vagy a REST-logika közös függvényén:
//  routes/inbound-orders approveInbound/rejectInbound, routes/clients
//  insertClient) át, company_id-szűrten.
// ============================================================
'use strict';

const core = require('./core');
const di = require('../driverInfo');

const { esc, fmtN, fmtD, num } = core.fmt;
const { change, listCard } = core.card;
const L = (hu, ro) => ({ hu, ro });
const q = core.q;
const H = core.H;
const hu = (ctx) => ctx.lang === 'hu';
const ok = (reply, extra) => Object.assign({ ok: true, reply }, extra || {});
const money = (v, c) => fmtN(num(v), 2) + ' ' + (c || 'EUR');
const d10 = (v) => (v instanceof Date ? di._h.iso(v) : (v ? String(v).slice(0, 10) : ''));
const ROLE = { Sofer: L('Sofőr', 'Șofer'), Manager: L('Manager', 'Manager'), Admin: L('Admin', 'Admin'), Konyvelo: L('Könyvelő', 'Contabil') };
const roleL = (ctx, r) => (ROLE[r] ? ROLE[r][ctx.lang] || ROLE[r].hu : r || '—');
const PAY_METHODS = ['cash', 'bank', 'card', 'other'];

// REST-logika közös függvényei (nem route-hívás → ugyanaz a req, ugyanaz az ellenőrzés).
const inboundLogic = () => require('../../routes/inbound-orders');

// ─── Munkatárs feloldása (név vagy e-mail), cégre szűrve ───
async function findUser(ctx, raw) {
  const s = String(raw || '').trim();
  if (!s) return { err: hu(ctx) ? 'Melyik munkatársra gondolsz?' : 'La ce coleg te referi?' };
  if (s.includes('@')) {
    const r = await q(`SELECT id, nume, email, tel, pozicio, COALESCE(blocked,false) AS blocked FROM users
                        WHERE company_id = $1 AND LOWER(email) = $2 AND COALESCE(pozicio_dev,false) = false`, [ctx.cid, s.toLowerCase()]);
    return r[0] ? { u: r[0] } : { err: (hu(ctx) ? 'Nincs ilyen munkatárs: ' : 'Nu există colegul: ') + s };
  }
  const f = core.fmt.fold(s);
  const all = await q(`SELECT id, nume, email, tel, pozicio, COALESCE(blocked,false) AS blocked FROM users
                        WHERE company_id = $1 AND COALESCE(pozicio_dev,false) = false ORDER BY nume`, [ctx.cid]);
  const hits = all.filter((u) => core.fmt.fold(u.nume || '').includes(f) || f.split(/\s+/).every((p) => core.fmt.fold(u.nume || '').includes(p)));
  if (!hits.length) return { err: (hu(ctx) ? 'Nincs ilyen munkatárs: ' : 'Nu există colegul: ') + s };
  if (hits.length > 1) return { ask: { text: hu(ctx) ? 'Több munkatárs is illik rá — melyik?' : 'Se potrivesc mai mulți colegi — care?', options: hits.slice(0, 5).map((u) => ctx.retext(u.email, s)) } };
  return { u: hits[0] };
}
// A Manager csak sofőrt kezelhet (ugyanaz, mint a handlerben — itt csak korábbi, érthető jelzés).
function managerGuard(ctx, u) {
  if (ctx.user.pozicio === 'Manager' && u.pozicio !== 'Sofer') return { err: hu(ctx) ? 'Manager csak sofőrt kezelhet.' : 'Managerul poate gestiona doar șoferi.' };
  if (String(u.email).toLowerCase() === String(ctx.user.email || '').toLowerCase()) return { err: hu(ctx) ? 'Saját magadra ezt nem lehet.' : 'Nu se poate pe tine însuți.' };
  return null;
}

// ─── Menetlevél feloldása (MT-2026-0012 / 0012 / belső id), cégre szűrve ───
async function findWaybill(ctx, raw) {
  const s = String(raw || '').trim();
  if (!s) return { err: hu(ctx) ? 'Melyik menetlevél? Írd be a számát (pl. MT-2026-0012).' : 'Ce foaie de parcurs? Scrie numărul (ex. MT-2026-0012).' };
  const own = `(f.company_id = $1 OR f.email_sofer IN (SELECT email FROM users WHERE company_id = $1))`;
  let r = await q(`SELECT f.* FROM fuvarlevelek f WHERE ${own} AND (UPPER(f.numar_fisa) = UPPER($2) OR f.id = $2) LIMIT 2`, [ctx.cid, s]);
  if (!r.length && /^\d{1,6}$/.test(s)) {
    r = await q(`SELECT f.* FROM fuvarlevelek f WHERE ${own} AND f.numar_fisa ~ ('-0*' || $2 || '$')
                  ORDER BY COALESCE(f.erkezes_dt, f.indulas_dt, f.data_completare) DESC LIMIT 6`, [ctx.cid, String(parseInt(s, 10))]);
  }
  if (!r.length) return { err: (hu(ctx) ? 'Nem találom ezt a menetlevelet: ' : 'Nu găsesc foaia de parcurs: ') + s };
  if (r.length > 1) return { ask: { text: hu(ctx) ? 'Több menetlevél is illik rá — melyik?' : 'Se potrivesc mai multe foi — care?', options: r.slice(0, 5).map((w) => ctx.retext(w.numar_fisa || w.id, s)) } };
  return { w: r[0] };
}

// ─── Beérkező / ügyfél-kérés feloldása (szám vagy „a legutóbbi") ───
async function findInbound(ctx, raw) {
  const pend = await q(`SELECT id, source, status, extracted, received_at, source_email FROM inbound_orders
                         WHERE company_id = $1 AND status NOT IN ('approved','rejected')
                         ORDER BY received_at DESC NULLS LAST, created_at DESC LIMIT 50`, [ctx.cid]);
  const s = String(raw == null ? '' : raw).trim();
  if (!s) {
    if (pend.length === 1) return { i: pend[0] };
    if (!pend.length) return { err: hu(ctx) ? 'Nincs feldolgozatlan beérkező megrendelés.' : 'Nu există comenzi primite neprocesate.' };
    return { ask: { text: hu(ctx) ? 'Melyiket? Írd be a számát (#).' : 'Care? Scrie numărul (#).', options: pend.slice(0, 5).map((p) => ctx.retext('#' + p.id, '')) } };
  }
  const n = parseInt(s.replace(/[^\d]/g, ''), 10);
  if (n) {
    const r = await q(`SELECT id, source, status, extracted, received_at, source_email FROM inbound_orders WHERE company_id = $1 AND id = $2`, [ctx.cid, n]);
    if (r[0]) return { i: r[0] };
  }
  // Megrendelő-név szerint a függőek közt
  const f = core.fmt.fold(s);
  const hits = pend.filter((p) => core.fmt.fold(String((p.extracted || {}).client || '')).includes(f));
  if (hits.length === 1) return { i: hits[0] };
  if (hits.length > 1) return { ask: { text: hu(ctx) ? 'Több kérés is illik rá — melyik?' : 'Se potrivesc mai multe cereri — care?', options: hits.slice(0, 5).map((p) => ctx.retext('#' + p.id, s)) } };
  return { err: (hu(ctx) ? 'Nem találom ezt a beérkező megrendelést: ' : 'Nu găsesc comanda primită: ') + s };
}
const inbRoute = (x) => [x.loc_incarcare, x.loc_descarcare].filter(Boolean).join(' → ') || '—';
const inbSource = (ctx, s) => (s === 'portal' ? (hu(ctx) ? 'Ügyfél-portál' : 'Portal client') : 'E-mail');

module.exports = [
  // ─── Ügyfelek ───
  {
    name: 'client.create', domain: 'clients', kind: 'write', feature: 'clients',
    title: L('Új ügyfél', 'Client nou'),
    desc: L('Új ügyfél kézi felvétele (CUI nélkül is — magánszemély, külföldi cég): name, type (Firma|Persoana fizica), cui, country, city, address, email, phone, payment_term_days. Román CUI-hoz inkább client.create_by_cui.', 'Adaugă manual un client nou (și fără CUI).'),
    examples: L(['vedd fel új ügyfélnek a Müller GmbH-t, Németország, info@muller.de'], ['adaugă clientul Müller GmbH, Germania, info@muller.de']),
    params: { name: { type: 'text', required: true, max: 200 }, type: { type: 'enum', values: ['Firma', 'Persoana fizica'], default: 'Firma' }, cui: { type: 'text', max: 40 },
      country: { type: 'text', max: 60 }, city: { type: 'text', max: 100 }, address: { type: 'text', max: 300 }, email: { type: 'email' }, phone: { type: 'text', max: 40 },
      payment_term_days: { type: 'int', min: 0, maxv: 365 } },
    async preview(ctx, a) {
      const dup = await q(`SELECT denumire FROM clients WHERE company_id = $1 AND LOWER(TRIM(denumire)) = LOWER(TRIM($2)) LIMIT 1`, [ctx.cid, a.name]);
      if (dup[0]) return { reply: (hu(ctx) ? 'Ez az ügyfél már megvan: ' : 'Clientul există deja: ') + dup[0].denumire };
      return { rows: [[hu(ctx) ? 'Név' : 'Denumire', a.name], [hu(ctx) ? 'Típus' : 'Tip', a.type], ['CUI', a.cui || '—'], [hu(ctx) ? 'Ország' : 'Țară', a.country || '—'],
        [hu(ctx) ? 'Helység' : 'Localitate', a.city || '—'], [hu(ctx) ? 'Cím' : 'Adresă', a.address || '—'], ['E-mail', a.email || '—'], ['Telefon', a.phone || '—'],
        [hu(ctx) ? 'Fiz. határidő' : 'Termen plată', a.payment_term_days != null ? a.payment_term_days + (hu(ctx) ? ' nap' : ' zile') : '—']], label: a.name };
    },
    async run(ctx, a) {
      try {
        const c = await require('../../routes/clients').insertClient(ctx.cid, {
          denumire: a.name, tip: a.type, cui_cif: a.cui || null, tara: a.country || null, localitate: a.city || null, oras: a.city || null,
          adresa: a.address || null, email: a.email || null, telefon: a.phone || null, payment_term_days: a.payment_term_days,
        });
        try { await require('../audit').fromReq(ctx.req, 'client.create', 'client', c.id, { via: 'chat' }); } catch (_) {}
        return ok((hu(ctx) ? '✅ Ügyfél mentve: ' : '✅ Client salvat: ') + c.denumire, { entity_id: c.id });
      } catch (e) { console.error('chat client.create hiba:', e.message); return { ok: false, err: 'Eroare de server' }; }
    },
  },
  {
    name: 'client.portal_invite', domain: 'clients', kind: 'write', feature: 'client-portal',
    title: L('Meghívó az ügyfél-portálra', 'Invitație în portalul clientului'),
    desc: L('Az ügyfél kapcsolattartójának meghívó az ügyfél-portálra (saját fuvarjai, követés, dokumentumok): client, email, name.', 'Invită persoana de contact a clientului în portal.'),
    examples: L(['hívd meg a Bilkát az ügyfél-portálra, logistica@bilka.ro'], ['invită Bilka în portal, logistica@bilka.ro']),
    params: { client: { type: 'client', required: true }, email: { type: 'email', required: true }, name: { type: 'text', max: 120 } },
    async preview(ctx, a) {
      return { rows: [[hu(ctx) ? 'Ügyfél' : 'Client', a.client.name], ['E-mail', a.email], [hu(ctx) ? 'Név' : 'Nume', a.name || '—']], label: a.client.name };
    },
    async run(ctx, a) {
      const r = await core.callH(H('clientPortal', 'clientPortalInvite'), ctx.req, [{ client_id: a.client.id, email: a.email, nev: a.name || null }]);
      if (!r || !r.ok) return r;
      return ok(r.emailed === false
        ? (hu(ctx) ? '✅ Hozzáférés létrehozva, de az e-mail nem ment ki. Küldd el neki ezt a linket: ' : '✅ Acces creat, dar e-mailul nu a plecat. Trimite-i acest link: ') + (r.link || '')
        : (hu(ctx) ? '✅ Meghívó elküldve: ' : '✅ Invitație trimisă: ') + a.email);
    },
  },
  // ─── Alvállalkozók ───
  {
    name: 'carrier.portal_invite', domain: 'carriers', kind: 'write', feature: 'carrier-portal',
    title: L('Meghívó az alvállalkozói portálra', 'Invitație în portalul subcontractorului'),
    desc: L('Alvállalkozó meghívása a portálra (a rá osztott fuvarok, dokumentumok, járművek): carrier, email, name.', 'Invită subcontractorul în portal.'),
    examples: L(['hívd meg a Trans Kft-t az alvállalkozói portálra, iroda@trans.hu'], ['invită Trans SRL în portalul subcontractorilor']),
    params: { carrier: { type: 'carrier', required: true }, email: { type: 'email', required: true }, name: { type: 'text', max: 120 } },
    async preview(ctx, a) {
      return { rows: [[hu(ctx) ? 'Alvállalkozó' : 'Subcontractor', a.carrier.name], ['E-mail', a.email], [hu(ctx) ? 'Név' : 'Nume', a.name || '—']], label: a.carrier.name };
    },
    async run(ctx, a) {
      const r = await core.callH(H('carriers', 'carrierPortalInvite'), ctx.req, [{ carrier_id: a.carrier.id, email: a.email, nev: a.name || null }]);
      if (!r || !r.ok) return r;
      return ok(r.emailed === false
        ? (hu(ctx) ? '✅ Hozzáférés létrehozva, de az e-mail nem ment ki. Küldd el neki ezt a linket: ' : '✅ Acces creat, dar e-mailul nu a plecat. Trimite-i acest link: ') + (r.link || '')
        : (hu(ctx) ? '✅ Meghívó elküldve: ' : '✅ Invitație trimisă: ') + a.email);
    },
  },
  // ─── Beérkező megrendelések + ügyfél-kérések ───
  {
    name: 'inbound.list', domain: 'orders', kind: 'read',
    desc: L('A feldolgozatlan beérkező megrendelések (e-mail) és ügyfél-kérések (portál) listája.', 'Lista comenzilor primite neprocesate (e-mail + portal).'),
    examples: L(['milyen beérkező megrendelések vannak?', 'van új ügyfél-kérés?'], ['ce comenzi noi au venit?']),
    async run(ctx) {
      const rows = await q(`SELECT id, source, extracted, received_at FROM inbound_orders
                             WHERE company_id = $1 AND status NOT IN ('approved','rejected')
                             ORDER BY received_at DESC NULLS LAST, created_at DESC LIMIT 50`, [ctx.cid]);
      const list = rows.map((r) => {
        const x = r.extracted || {};
        return { id: '#' + r.id, src: inbSource(ctx, r.source), client: x.client || '—', route: inbRoute(x), date: x.data_incarcare ? fmtD(d10(x.data_incarcare)) : '—', at: r.received_at ? fmtD(d10(r.received_at)) : '—' };
      });
      const html = listCard(ctx, '📥', hu(ctx) ? 'Beérkező megrendelések' : 'Comenzi primite', list, [
        { k: 'id', l: L('#', '#') }, { k: 'src', l: L('Forrás', 'Sursă') }, { k: 'client', l: L('Megrendelő', 'Client') },
        { k: 'route', l: L('Útvonal', 'Traseu') }, { k: 'date', l: L('Felrakás', 'Încărcare') }, { k: 'at', l: L('Érkezett', 'Primit') }]);
      const reply = list.length
        ? (hu(ctx) ? list.length + ' feldolgozatlan beérkező megrendelés van. Jóváhagyáshoz írd: „hagyd jóvá a #' : 'Sunt ' + list.length + ' comenzi neprocesate. Pentru aprobare scrie: „aprobă #') + rows[0].id + '”.'
        : (hu(ctx) ? 'Nincs feldolgozatlan beérkező megrendelés.' : 'Nu există comenzi primite neprocesate.');
      return { reply, html: '<div class="och-info">' + html + '</div>' };
    },
  },
  {
    name: 'inbound.approve', domain: 'orders', kind: 'write',
    title: L('Beérkező megrendelés jóváhagyása', 'Aprobare comandă primită'),
    desc: L('Beérkező megrendelés / ügyfél-kérés jóváhagyása → valódi fuvar lesz (Disponibil). request = a kérés száma (#) vagy a megrendelő neve.', 'Aprobă comanda primită → devine cursă.'),
    examples: L(['hagyd jóvá a #12-es beérkező megrendelést', 'fogadd el a Bilka kérését'], ['aprobă comanda primită #12']),
    params: { request: { type: 'text', max: 120 } },
    async check(ctx, a) {
      const f = await findInbound(ctx, a.request);
      if (f.err || f.ask) return f;
      a.inbound = { id: f.i.id, src: f.i.source, x: f.i.extracted || {} };
      return null;
    },
    async preview(ctx, a) {
      const x = a.inbound.x;
      return { rows: [['#', '#' + a.inbound.id + ' · ' + inbSource(ctx, a.inbound.src)], [hu(ctx) ? 'Megrendelő' : 'Client', x.client || '—'], [hu(ctx) ? 'Útvonal' : 'Traseu', inbRoute(x)],
        [hu(ctx) ? 'Felrakás' : 'Încărcare', x.data_incarcare ? fmtD(d10(x.data_incarcare)) : '—'], [hu(ctx) ? 'Ár' : 'Preț', x.pret ? money(x.pret, x.valuta || 'EUR') : '—'],
        [hu(ctx) ? 'Eredmény' : 'Rezultat', hu(ctx) ? 'új fuvar (kiosztásra vár)' : 'cursă nouă (de alocat)']], label: '#' + a.inbound.id };
    },
    async run(ctx, a) {
      let r;
      try { r = await inboundLogic().approveInbound(ctx.req, a.inbound.id, null); } catch (e) { console.error('chat inbound.approve hiba:', e.message); return { ok: false, err: 'Eroare de server' }; }
      if (r.status !== 200) return { ok: false, err: r.body.error || 'Eroare' };
      try { await require('../audit').fromReq(ctx.req, 'inbound.approve', 'inbound', a.inbound.id, { order_id: r.body.order_id, via: 'chat' }); } catch (_) {}
      return ok((hu(ctx) ? '✅ Jóváhagyva — új fuvar: ' : '✅ Aprobat — cursă nouă: ') + (r.body.fuvar_no || r.body.order_id), { order_id: r.body.order_id, entity_id: r.body.order_id });
    },
  },
  {
    name: 'inbound.reject', domain: 'orders', kind: 'write',
    title: L('Beérkező megrendelés elvetése', 'Respingere comandă primită'),
    desc: L('Beérkező megrendelés / ügyfél-kérés elvetése. request = a kérés száma (#) vagy a megrendelő neve.', 'Respinge comanda primită.'),
    examples: L(['vesd el a #12-es kérést'], ['respinge cererea #12']),
    params: { request: { type: 'text', max: 120 } },
    async check(ctx, a) {
      const f = await findInbound(ctx, a.request);
      if (f.err || f.ask) return f;
      a.inbound = { id: f.i.id, src: f.i.source, x: f.i.extracted || {}, status: f.i.status };
      return null;
    },
    async preview(ctx, a) {
      return { rows: [['#', '#' + a.inbound.id + ' · ' + inbSource(ctx, a.inbound.src)], [hu(ctx) ? 'Megrendelő' : 'Client', a.inbound.x.client || '—'], [hu(ctx) ? 'Útvonal' : 'Traseu', inbRoute(a.inbound.x)]], label: '#' + a.inbound.id };
    },
    async snapshot(ctx, a) { return { id: a.inbound.id, status: a.inbound.status }; },
    async undo(ctx, b) {
      if (!b || !b.id) return { ok: false };
      await q(`UPDATE inbound_orders SET status = $3, updated_at = now() WHERE id = $1 AND company_id = $2 AND status = 'rejected'`, [b.id, ctx.cid, b.status || 'new']);
      return { ok: true };
    },
    async run(ctx, a) {
      let r;
      try { r = await inboundLogic().rejectInbound(ctx.req, a.inbound.id); } catch (e) { console.error('chat inbound.reject hiba:', e.message); return { ok: false, err: 'Eroare de server' }; }
      if (r.status !== 200) return { ok: false, err: r.body.error || 'Eroare' };
      try { await require('../audit').fromReq(ctx.req, 'inbound.reject', 'inbound', a.inbound.id, { via: 'chat' }); } catch (_) {}
      return ok(hu(ctx) ? '✅ Elvetve.' : '✅ Respins.', { entity_id: a.inbound.id });
    },
  },
  // ─── Menetlevél ───
  {
    name: 'waybill.create', domain: 'docs', kind: 'write', feature: 'received-fuv',
    title: L('Új menetlevél', 'Foaie de parcurs nouă'),
    desc: L('Menetlevél kézi létrehozása: driver, truck, trailer, start_date, end_date, km_start, km_end, fuel_start, fuel_end (liter), revenue (nettó EUR), note. A sorszám (MT-ÉÉÉÉ-XXXX) automatikus.', 'Creează manual o foaie de parcurs.'),
    examples: L(['készíts menetlevelet Gondosnak október 1-től 5-ig, 120000-tól 122400 km-ig'], ['fă o foaie de parcurs pentru Gondos 1–5 octombrie']),
    params: { driver: { type: 'driver', required: true }, truck: { type: 'tractor' }, trailer: { type: 'trailer' }, start_date: { type: 'date' }, end_date: { type: 'date' },
      km_start: { type: 'int', min: 0, maxv: 9999999 }, km_end: { type: 'int', min: 0, maxv: 9999999 }, fuel_start: { type: 'number', min: 0, maxv: 5000 }, fuel_end: { type: 'number', min: 0, maxv: 5000 },
      revenue: { type: 'money', min: 0, maxv: 1e7 }, note: { type: 'text', max: 1000 } },
    async check(ctx, a) {
      if (a.km_start != null && a.km_end != null && a.km_end < a.km_start) return { err: hu(ctx) ? 'A záró km nem lehet kisebb a kezdőnél.' : 'Km final nu poate fi mai mic decât km inițial.' };
      if (a.start_date && a.end_date && a.end_date < a.start_date) return { err: hu(ctx) ? 'Az érkezés nem lehet az indulás előtt.' : 'Sosirea nu poate fi înainte de plecare.' };
      return null;
    },
    async preview(ctx, a) {
      const km = a.km_start != null && a.km_end != null ? a.km_end - a.km_start : null;
      return { rows: [[hu(ctx) ? 'Sofőr' : 'Șofer', a.driver.name], [hu(ctx) ? 'Vontató' : 'Camion', a.truck ? a.truck.plate : '—'], [hu(ctx) ? 'Pótkocsi' : 'Remorcă', a.trailer ? a.trailer.plate : '—'],
        [hu(ctx) ? 'Időszak' : 'Perioadă', (a.start_date ? fmtD(a.start_date) : '—') + ' → ' + (a.end_date ? fmtD(a.end_date) : '—')],
        ['Km', (a.km_start != null ? fmtN(a.km_start) : '—') + ' → ' + (a.km_end != null ? fmtN(a.km_end) : '—') + (km != null ? ' (' + fmtN(km) + ' km)' : '')],
        [hu(ctx) ? 'Üzemanyag (L)' : 'Combustibil (L)', (a.fuel_start != null ? fmtN(a.fuel_start) : '—') + ' → ' + (a.fuel_end != null ? fmtN(a.fuel_end) : '—')],
        [hu(ctx) ? 'Bevétel' : 'Venit', a.revenue != null ? money(a.revenue, 'EUR') : '—'], [hu(ctx) ? 'Megjegyzés' : 'Mențiuni', a.note || '—'],
        [hu(ctx) ? 'Sorszám' : 'Număr', hu(ctx) ? 'automatikus' : 'automat']], label: a.driver.name };
    },
    async snapshot() { return {}; },
    async undo(ctx, b, res) { return res && res.id ? core.callH(H('documents', 'fuvarlevelDelete'), ctx.req, [res.id]) : { ok: false }; },
    async run(ctx, a) {
      const r = await core.callH(H('documents', 'fuvarlevelCreate'), ctx.req, [{
        nume_sofer: a.driver.name, email_sofer: a.driver.email, numar_camion: a.truck ? a.truck.plate : null, numar_remorca: a.trailer ? a.trailer.plate : null,
        km_inceput: a.km_start || 0, km_sfarsit: a.km_end || 0, cant_inceput: a.fuel_start || 0, cant_sfarsit: a.fuel_end || 0,
        indulas_date: a.start_date || null, erkezes_date: a.end_date || null, data_completare: a.end_date || a.start_date || null,
        total_pret: a.revenue != null ? a.revenue : null, alte_mentiuni: a.note || null,
      }]);
      if (!r || !r.ok) return r;
      return ok((hu(ctx) ? '✅ Menetlevél létrehozva: ' : '✅ Foaie de parcurs creată: ') + (r.docNumber || r.id), { entity_id: r.id });
    },
  },
  {
    name: 'waybill.update', domain: 'docs', kind: 'write', feature: 'received-fuv',
    title: L('Menetlevél módosítása', 'Modificare foaie de parcurs'),
    desc: L('Meglévő menetlevél módosítása (a többi adata megmarad): waybill (szám, pl. MT-2026-0012), driver, truck, trailer, start_date, end_date, km_start, km_end, fuel_start, fuel_end, revenue, note.', 'Modifică o foaie de parcurs existentă.'),
    examples: L(['az MT-2026-0012 menetlevélen a záró km 122500'], ['pe foaia MT-2026-0012 km final 122500']),
    params: { waybill: { type: 'text', required: true, max: 40 }, driver: { type: 'driver' }, truck: { type: 'tractor' }, trailer: { type: 'trailer' }, start_date: { type: 'date' }, end_date: { type: 'date' },
      km_start: { type: 'int', min: 0, maxv: 9999999 }, km_end: { type: 'int', min: 0, maxv: 9999999 }, fuel_start: { type: 'number', min: 0, maxv: 5000 }, fuel_end: { type: 'number', min: 0, maxv: 5000 },
      revenue: { type: 'money', min: 0, maxv: 1e7 }, note: { type: 'text', max: 1000 } },
    async check(ctx, a) {
      const f = await findWaybill(ctx, a.waybill);
      if (f.err || f.ask) return f;
      a.wb = { id: f.w.id, no: f.w.numar_fisa || f.w.id };
      const keys = ['driver', 'truck', 'trailer', 'start_date', 'end_date', 'km_start', 'km_end', 'fuel_start', 'fuel_end', 'revenue', 'note'];
      if (!keys.some((k) => a[k] != null)) return { ask: { text: hu(ctx) ? 'Mit módosítsak a menetlevélen?' : 'Ce modific pe foaia de parcurs?', options: [] } };
      const kmS = a.km_start != null ? a.km_start : num(f.w.km_inceput), kmE = a.km_end != null ? a.km_end : num(f.w.km_sfarsit);
      if (kmE && kmS && kmE < kmS) return { err: hu(ctx) ? 'A záró km nem lehet kisebb a kezdőnél.' : 'Km final nu poate fi mai mic decât km inițial.' };
      return null;
    },
    async snapshot(ctx, a) { return { id: a.wb.id }; },
    async preview(ctx, a) {
      const w = (await q(`SELECT * FROM fuvarlevelek WHERE id = $1`, [a.wb.id]))[0];
      const rows = [['#', a.wb.no]];
      if (a.driver) rows.push([hu(ctx) ? 'Sofőr' : 'Șofer', change(w.nume_sofer, a.driver.name)]);
      if (a.truck) rows.push([hu(ctx) ? 'Vontató' : 'Camion', change(w.numar_camion, a.truck.plate)]);
      if (a.trailer) rows.push([hu(ctx) ? 'Pótkocsi' : 'Remorcă', change(w.numar_remorca, a.trailer.plate)]);
      if (a.start_date) rows.push([hu(ctx) ? 'Indulás' : 'Plecare', change(w.indulas_dt ? fmtD(d10(w.indulas_dt)) : '', fmtD(a.start_date))]);
      if (a.end_date) rows.push([hu(ctx) ? 'Érkezés' : 'Sosire', change(w.erkezes_dt ? fmtD(d10(w.erkezes_dt)) : '', fmtD(a.end_date))]);
      if (a.km_start != null) rows.push([hu(ctx) ? 'Kezdő km' : 'Km inițial', change(w.km_inceput, a.km_start)]);
      if (a.km_end != null) rows.push([hu(ctx) ? 'Záró km' : 'Km final', change(w.km_sfarsit, a.km_end)]);
      if (a.fuel_start != null) rows.push([hu(ctx) ? 'Kezdő üzemanyag' : 'Combustibil inițial', change(w.cant_inceput, a.fuel_start)]);
      if (a.fuel_end != null) rows.push([hu(ctx) ? 'Záró üzemanyag' : 'Combustibil final', change(w.cant_sfarsit, a.fuel_end)]);
      if (a.revenue != null) rows.push([hu(ctx) ? 'Bevétel' : 'Venit', change(w.total_pret, a.revenue)]);
      if (a.note != null) rows.push([hu(ctx) ? 'Megjegyzés' : 'Mențiuni', change(w.alte_mentiuni, a.note)]);
      return { rows, label: a.wb.no };
    },
    async run(ctx, a) {
      const det = await core.callH(H('documents', 'getFuvarlevelDetail'), ctx.req, [a.wb.id]);
      if (!det || !det.ok) return det;
      const w = det.fuv;
      // A mentő handler MINDEN mezőt felülír → a jelenlegi értékekkel egészítjük ki.
      const r = await core.callH(H('documents', 'fuvarlevelUpdate'), ctx.req, [a.wb.id, {
        nume_sofer: a.driver ? a.driver.name : w.nume_sofer, email_sofer: a.driver ? a.driver.email : null,
        numar_camion: a.truck ? a.truck.plate : w.numar_camion, numar_remorca: a.trailer ? a.trailer.plate : w.numar_remorca, numar_fisa: w.numar_fisa,
        km_inceput: a.km_start != null ? a.km_start : w.km_inceput, km_sfarsit: a.km_end != null ? a.km_end : w.km_sfarsit,
        cant_inceput: a.fuel_start != null ? a.fuel_start : w.cant_inceput, cant_sfarsit: a.fuel_end != null ? a.fuel_end : w.cant_sfarsit,
        diurna_externa: w.diurna_externa, diurna_interna: w.diurna_interna, alte_mentiuni: a.note != null ? a.note : w.alte_mentiuni,
        alimentari: w.alimentari || [], achizitii: w.achizitii || [], puncte: w.puncte || [],
        indulas_date: a.start_date || null, erkezes_date: a.end_date || null, total_pret: a.revenue != null ? a.revenue : null,
      }]);
      return r && r.ok ? ok(null, { entity_id: a.wb.id }) : r;
    },
  },
  // ─── Árajánlat ───
  {
    name: 'quote.create', domain: 'orders', kind: 'write', feature: 'quotes',
    title: L('Új árajánlat', 'Ofertă nouă'),
    desc: L('Árajánlat rögzítése: client (meglévő ügyfél vagy új név), from, to, price, currency, valid_until, note.', 'Înregistrează o ofertă de preț.'),
    examples: L(['készíts ajánlatot a Bilkának Brassó–Budapest 1200 euróért, jövő péntekig érvényes'], ['fă o ofertă pentru Bilka Brașov–Budapesta 1200 euro']),
    params: { client: { type: 'client', required: true, allowNew: true }, from: { type: 'text', max: 200 }, to: { type: 'text', max: 200 }, price: { type: 'money', min: 0, maxv: 1e7 },
      currency: { type: 'enum', values: ['EUR', 'RON', 'HUF', 'PLN', 'USD'], default: 'EUR' }, valid_until: { type: 'date' }, note: { type: 'text', max: 1000 } },
    async preview(ctx, a) {
      return { rows: [[hu(ctx) ? 'Ügyfél' : 'Client', a.client.name + (a.client.id ? '' : (hu(ctx) ? ' (új név)' : ' (nume nou)'))], [hu(ctx) ? 'Útvonal' : 'Traseu', (a.from || '—') + ' → ' + (a.to || '—')],
        [hu(ctx) ? 'Ár' : 'Preț', a.price != null ? money(a.price, a.currency) : '—'], [hu(ctx) ? 'Érvényes' : 'Valabilă până', a.valid_until ? fmtD(a.valid_until) : '—'], [hu(ctx) ? 'Megjegyzés' : 'Notă', a.note || '—']], label: a.client.name };
    },
    async run(ctx, a) {
      const r = await core.callH(H('quotes', 'quoteSave'), ctx.req, [{ client_id: a.client.id || null, client_name: a.client.name, loc_from: a.from, loc_to: a.to,
        price: a.price, valuta: a.currency, valid_until: a.valid_until, note: a.note }]);
      return r && r.ok ? ok(hu(ctx) ? '✅ Árajánlat mentve.' : '✅ Ofertă salvată.', { entity_id: r.id || null }) : r;
    },
  },
  // ─── Munkatársak ───
  {
    name: 'user.list', domain: 'drivers', kind: 'read', feature: 'users',
    desc: L('A cég munkatársai (név, e-mail, szerep, letiltva-e).', 'Colegii firmei (nume, e-mail, rol, blocat).'),
    examples: L(['kik a munkatársaink?', 'listázd a felhasználókat'], ['cine sunt utilizatorii?']),
    async run(ctx) {
      const rows = await q(`SELECT nume, email, tel, pozicio, COALESCE(blocked,false) AS blocked FROM users
                             WHERE company_id = $1 AND COALESCE(pozicio_dev,false) = false ORDER BY pozicio, nume`, [ctx.cid]);
      const html = listCard(ctx, '👥', hu(ctx) ? 'Munkatársak' : 'Colegi', rows, [
        { k: 'nume', l: L('Név', 'Nume') }, { k: 'email', l: L('E-mail', 'E-mail') }, { k: 'tel', l: L('Telefon', 'Telefon') },
        { k: 'pozicio', l: L('Szerep', 'Rol'), f: (v) => roleL(ctx, v) }, { k: 'blocked', l: L('Állapot', 'Stare'), f: (v) => (v ? (hu(ctx) ? '⛔ letiltva' : '⛔ blocat') : (hu(ctx) ? 'aktív' : 'activ')) }], 60);
      return { reply: (hu(ctx) ? rows.length + ' munkatárs.' : rows.length + ' colegi.'), html: '<div class="och-info">' + html + '</div>' };
    },
  },
  {
    name: 'user.update', domain: 'drivers', kind: 'write', feature: 'users', perm: 'users_manage',
    title: L('Munkatárs módosítása', 'Modificare coleg'),
    desc: L('Munkatárs nevének, telefonjának vagy szerepének (Sofer|Manager|Admin) módosítása: user (név vagy e-mail), name, phone, role.', 'Modifică numele, telefonul sau rolul unui coleg.'),
    examples: L(['Kiss Péter telefonszáma legyen 0740123456'], ['telefonul lui Ion să fie 0740123456']),
    params: { user: { type: 'text', required: true, max: 160 }, name: { type: 'text', max: 120 }, phone: { type: 'text', max: 30 }, role: { type: 'enum', values: ['Sofer', 'Manager', 'Admin'] } },
    async check(ctx, a) {
      const f = await findUser(ctx, a.user);
      if (f.err || f.ask) return f;
      const g = managerGuard(ctx, f.u); if (g) return g;
      if (a.name == null && a.phone == null && a.role == null) return { ask: { text: hu(ctx) ? 'Mit módosítsak?' : 'Ce modific?', options: [] } };
      a.u = { email: f.u.email, nume: f.u.nume, tel: f.u.tel, pozicio: f.u.pozicio };
      return null;
    },
    async snapshot(ctx, a) { return { email: a.u.email, nume: a.u.nume, tel: a.u.tel, pozicio: a.u.pozicio }; },
    async undo(ctx, b) { return b ? core.callH(H('users', 'userUpdate'), ctx.req, [b.email, { nume: b.nume, tel: b.tel, pozicio: b.pozicio }]) : { ok: false }; },
    async preview(ctx, a) {
      const rows = [['👤', a.u.nume + ' · ' + a.u.email]];
      if (a.name != null) rows.push([hu(ctx) ? 'Név' : 'Nume', change(a.u.nume, a.name)]);
      if (a.phone != null) rows.push(['Telefon', change(a.u.tel, a.phone)]);
      if (a.role != null) rows.push([hu(ctx) ? 'Szerep' : 'Rol', change(roleL(ctx, a.u.pozicio), roleL(ctx, a.role))]);
      return { rows, label: a.u.nume };
    },
    async run(ctx, a) {
      const f = {};
      if (a.name != null) f.nume = a.name;
      if (a.phone != null) f.tel = a.phone;
      if (a.role != null) f.pozicio = a.role;
      const r = await core.callH(H('users', 'userUpdate'), ctx.req, [a.u.email, f]);
      return r && r.ok ? ok(null, { entity_id: a.u.email }) : r;
    },
  },
  {
    name: 'user.block', domain: 'drivers', kind: 'danger', feature: 'users', perm: 'users_manage',
    title: L('Munkatárs letiltása', 'Blocare coleg'),
    desc: L('Munkatárs letiltása (nem tud belépni, egy percen belül kilépteti a rendszer). Visszaengedés: user.unblock.', 'Blochează accesul unui coleg.'),
    examples: L(['tiltsd le Kiss Pétert'], ['blochează-l pe Ion']),
    params: { user: { type: 'text', required: true, max: 160 } },
    async check(ctx, a) {
      const f = await findUser(ctx, a.user);
      if (f.err || f.ask) return f;
      const g = managerGuard(ctx, f.u); if (g) return g;
      if (f.u.blocked) return { err: hu(ctx) ? 'Ez a munkatárs már le van tiltva.' : 'Colegul este deja blocat.' };
      a.u = { email: f.u.email, nume: f.u.nume, pozicio: f.u.pozicio };
      return null;
    },
    async preview(ctx, a) { return { rows: [['👤', a.u.nume], ['E-mail', a.u.email], [hu(ctx) ? 'Szerep' : 'Rol', roleL(ctx, a.u.pozicio)], [hu(ctx) ? 'Állapot' : 'Stare', change(hu(ctx) ? 'aktív' : 'activ', hu(ctx) ? 'letiltva' : 'blocat')]], label: a.u.nume }; },
    async snapshot(ctx, a) { return { email: a.u.email }; },
    async undo(ctx, b) { return b ? core.callH(H('users', 'userSetBlocked'), ctx.req, [b.email, false]) : { ok: false }; },
    async run(ctx, a) {
      const r = await core.callH(H('users', 'userSetBlocked'), ctx.req, [a.u.email, true]);
      return r && r.ok ? ok(null, { entity_id: a.u.email }) : r;
    },
  },
  {
    name: 'user.unblock', domain: 'drivers', kind: 'write', feature: 'users', perm: 'users_manage',
    title: L('Munkatárs visszaengedése', 'Deblocare coleg'),
    desc: L('Letiltott munkatárs visszaengedése.', 'Deblochează un coleg.'),
    params: { user: { type: 'text', required: true, max: 160 } },
    async check(ctx, a) {
      const f = await findUser(ctx, a.user);
      if (f.err || f.ask) return f;
      const g = managerGuard(ctx, f.u); if (g) return g;
      if (!f.u.blocked) return { err: hu(ctx) ? 'Ez a munkatárs nincs letiltva.' : 'Colegul nu este blocat.' };
      a.u = { email: f.u.email, nume: f.u.nume };
      return null;
    },
    async preview(ctx, a) { return { rows: [['👤', a.u.nume], [hu(ctx) ? 'Állapot' : 'Stare', change(hu(ctx) ? 'letiltva' : 'blocat', hu(ctx) ? 'aktív' : 'activ')]], label: a.u.nume }; },
    async snapshot(ctx, a) { return { email: a.u.email }; },
    async undo(ctx, b) { return b ? core.callH(H('users', 'userSetBlocked'), ctx.req, [b.email, true]) : { ok: false }; },
    async run(ctx, a) {
      const r = await core.callH(H('users', 'userSetBlocked'), ctx.req, [a.u.email, false]);
      return r && r.ok ? ok(null, { entity_id: a.u.email }) : r;
    },
  },
  {
    name: 'user.delete', domain: 'drivers', kind: 'danger', feature: 'users', perm: 'users_manage',
    title: L('Munkatárs törlése', 'Ștergere coleg'),
    desc: L('Munkatárs végleges törlése (a menetlevelei és dokumentumai megmaradnak). Ha csak ideiglenes: user.block.', 'Șterge definitiv un coleg.'),
    params: { user: { type: 'text', required: true, max: 160 } },
    async check(ctx, a) {
      const f = await findUser(ctx, a.user);
      if (f.err || f.ask) return f;
      const g = managerGuard(ctx, f.u); if (g) return g;
      a.u = { email: f.u.email, nume: f.u.nume, pozicio: f.u.pozicio };
      return null;
    },
    async preview(ctx, a) { return { rows: [['👤', a.u.nume], ['E-mail', a.u.email], [hu(ctx) ? 'Szerep' : 'Rol', roleL(ctx, a.u.pozicio)]], label: a.u.nume }; },
    async run(ctx, a) {
      const r = await core.callH(H('users', 'userDelete'), ctx.req, [a.u.email]);
      return r && r.ok ? ok(null, { entity_id: a.u.email }) : r;
    },
  },
  // ─── Sofőr: a kifizetetlen járandóságok egyben ───
  {
    name: 'driver.pay_items', domain: 'drivers', kind: 'write', feature: 'decont',
    title: L('Járandóságok kifizetése egyben', 'Plata drepturilor deodată'),
    desc: L('A sofőr KIFIZETETLEN járandóság-tételeinek (diurna, bónusz…) egyben történő kifizetése egy csoportos kifizetéssel, pénznemenként egy fizetési sorral: driver, period (opcionális — pl. szeptember), method (' + PAY_METHODS.join('|') + '), date. Konkrét összeghez: driver.payment_add.', 'Plătește deodată drepturile neplătite ale șoferului.'),
    examples: L(['fizesd ki Gondos összes szeptemberi járandóságát átutalással'], ['plătește-i lui Gondos toate drepturile din septembrie prin transfer']),
    params: { driver: { type: 'driver', required: true }, period: { type: 'period' }, method: { type: 'enum', values: PAY_METHODS, default: 'bank' }, date: { type: 'date' } },
    async check(ctx, a) {
      const r = await core.callH(H('fleetCompliance', 'earningList'), ctx.req, [{ email: a.driver.email, from: a.period ? a.period.from : null, to: a.period ? a.period.to : null }]);
      if (!r || r.ok === false) return { err: (r && r.err) || 'Eroare' };
      const items = (r.items || r.rows || []).filter((it) => num(it.remaining_ron != null ? it.remaining_ron : it.total_amount) > 0);
      if (!items.length) return { err: hu(ctx) ? 'Ennek a sofőrnek nincs kifizetetlen járandósága' + (a.period ? ' ebben az időszakban.' : '.') : 'Șoferul nu are drepturi neplătite' + (a.period ? ' în această perioadă.' : '.') };
      const sums = {};
      for (const it of items) {
        const cur = String(it.currency || 'RON').toUpperCase();
        sums[cur] = (sums[cur] || 0) + num(it.remaining_cur != null ? it.remaining_cur : it.total_amount);
      }
      a.items = items.map((it) => ({ id: it.id, ron: it.remaining_ron != null ? num(it.remaining_ron) : null, label: it.label || it.kind, date: d10(it.earning_date), amt: num(it.remaining_cur != null ? it.remaining_cur : it.total_amount), cur: it.currency }));
      a.sums = Object.keys(sums).map((c) => ({ cur: c, amount: Math.round(sums[c] * 100) / 100 })).filter((s) => s.amount > 0);
      return null;
    },
    async preview(ctx, a) {
      a.date = a.date || di._h.iso(ctx.now);
      const rows = [[hu(ctx) ? 'Sofőr' : 'Șofer', a.driver.name], [hu(ctx) ? 'Tételek' : 'Poziții', a.items.length + ' (' + a.items.slice(0, 4).map((i) => i.label + ' ' + fmtN(i.amt, 2) + ' ' + i.cur).join(', ') + (a.items.length > 4 ? ' …' : '') + ')']];
      for (const s of a.sums) rows.push([hu(ctx) ? 'Kifizetés' : 'Plată', { __html: '<b>' + esc(money(s.amount, s.cur)) + '</b> · ' + esc(a.method) }]);
      rows.push([hu(ctx) ? 'Dátum' : 'Data', fmtD(a.date)]);
      return { rows, label: a.driver.name };
    },
    async snapshot() { return {}; },
    async undo(ctx, b, res) { return res && res.id ? core.callH(H('fleetCompliance', 'earningPaymentGroupDelete'), ctx.req, [{ id: res.id }]) : { ok: false }; },
    async run(ctx, a) {
      const allPartial = a.items.every((i) => i.ron != null);
      const r = await core.callH(H('fleetCompliance', 'earningPaymentGroupCreate'), ctx.req, [{
        email_sofer: a.driver.email, paid_at: a.date, note: hu(ctx) ? 'Chatből (egyben)' : 'Din chat (deodată)',
        earning_ids: a.items.map((i) => i.id),
        allocations: allPartial ? a.items.map((i) => ({ earning_id: i.id, alloc_ron: i.ron })) : [],
        payments: a.sums.map((s) => ({ method: a.method, amount: s.amount, currency: s.cur, paid_at: a.date })),
      }]);
      return r && r.ok ? ok(null, { entity_id: r.id || r.group_id || null }) : r;
    },
  },
];
